//! From the parts of a pattern to its tree.

mod class;
mod known_sets;
mod length_limit;
mod names;
mod strings;
mod trie;

use bun_engine_text::{CodeUnit, Text};
use bun_engine_unicode::IgnoreCase;
use smallvec::SmallVec;

use crate::parser::{
    self, Assertion, ClassEscape, GroupKind, NameId, Quantifier, SetOperator, Sink,
};
use crate::set::Set;
use crate::tree::{Group, Groups, Node, NodeId, SetId, Span, Tree};
use crate::{Error, Flags};
use class::Classes;
use known_sets::KnownSets;
pub use names::GroupNames;
use names::NamedGroups;

/// `tree` is new, and has the `flags`.
#[inline]
pub(crate) fn build(
    pattern: Text<'_>,
    flags: Flags,
    tree: &mut Tree,
) -> Result<Option<Box<GroupNames>>, Error> {
    let mut builder = Builder {
        tree,
        flags,
        is_backward: false,
        stack: SmallVec::new(),
        alternatives_start: 0,
        terms_start: 0,
        text_start: 0,
        text_end: 0,
        text_ignores_case: false,
        atom: Atom::Nothing,
        classes: Classes::default(),
        known_sets: KnownSets::default(),
        common_sets: [None; COMMON_SETS],
        named_groups: None,
    };
    let summary = parser::parse(pattern, flags, &mut builder)?;
    if summary.is_too_deep {
        return Err(Error::TooDeeplyNested);
    }
    builder.end_disjunction()?;
    builder.tree.set_group_count(summary.group_count);
    if summary.has_large_counts {
        length_limit::check(builder.tree)?;
    }
    let names = builder.named_groups.map(|it| it.resolve(builder.tree));
    Ok(names.transpose()?.map(Box::new))
}

/// `\d`, `\D`, `\s`, `\S`, `\w`, `\W` and the dot.
const COMMON_SETS: usize = 7;
const DOT: usize = 6;

struct Builder<'a> {
    tree: &'a mut Tree,
    /// Those in force.
    flags: Flags,
    is_backward: bool,
    /// For each open group the alternatives that have ended, then the terms of the current one.
    stack: SmallVec<[NodeId; 32]>,
    alternatives_start: usize,
    terms_start: usize,
    /// The last characters of the tree come after the last term and have no node yet.
    text_start: usize,
    text_end: usize,
    text_ignores_case: bool,
    atom: Atom,
    classes: Classes,
    known_sets: KnownSets,
    /// Under the flags in force.
    common_sets: [Option<SetId>; COMMON_SETS],
    named_groups: Option<Box<NamedGroups>>,
}

/// What a quantifier would apply to.
#[derive(Clone, Copy)]
enum Atom {
    Character,
    Term,
    Nothing,
}

pub(crate) struct Outer {
    kind: GroupKind,
    flags: Flags,
    is_backward: bool,
    alternatives_start: u32,
    terms_start: u32,
    first_node: u32,
}

const NO_CAPTURES: Groups = Groups { first: 1, end: 1 };

impl Builder<'_> {
    #[inline]
    fn ignores_case(&self) -> bool {
        self.flags.contains(Flags::IGNORE_CASE)
    }

    #[inline]
    fn ignore_case(&self) -> Option<IgnoreCase> {
        self.ignores_case().then(|| self.tree.case_equivalence())
    }

    #[inline(always)]
    fn push(&mut self, id: NodeId) -> Result<(), Error> {
        parser::try_push(&mut self.stack, id)
    }

    #[inline(always)]
    fn add_term(&mut self, node: Node) -> Result<(), Error> {
        self.end_text()?;
        let id = self.tree.add(node)?;
        self.atom = Atom::Term;
        self.push(id)
    }

    #[inline]
    fn add_set(&mut self, set: Set) -> Result<(), Error> {
        let set = self.known_sets.find_or_add(self.tree, set)?;
        self.add_known_set(set)
    }

    fn add_known_set(&mut self, set: SetId) -> Result<(), Error> {
        self.add_term(Node::Set(set))
    }

    #[inline(always)]
    fn add_common_set(
        &mut self,
        index: usize,
        set: impl FnOnce(Flags) -> Result<Set, Error>,
    ) -> Result<(), Error> {
        let set = match self.common_sets[index] {
            Some(known) => known,
            None => {
                let new = self.known_sets.find_or_add(self.tree, set(self.flags)?)?;
                *self.common_sets[index].insert(new)
            }
        };
        self.add_known_set(set)
    }

    #[inline]
    fn set_flags(&mut self, flags: Flags) {
        if self.flags != flags {
            self.flags = flags;
            self.common_sets = [None; COMMON_SETS];
        }
    }

    #[inline(always)]
    fn text_node(&mut self, end: usize) -> Result<NodeId, Error> {
        let chars = Span::new(self.text_start..end);
        self.text_start = end;
        let ignore_case = self.text_ignores_case;
        self.tree.add(Node::Text { chars, ignore_case })
    }

    #[inline(always)]
    fn end_text_at(&mut self, end: usize) -> Result<(), Error> {
        match self.text_start < end {
            true => self.push_text(end),
            false => Ok(()),
        }
    }

    fn push_text(&mut self, end: usize) -> Result<(), Error> {
        let id = self.text_node(end)?;
        self.push(id)
    }

    #[inline(always)]
    fn end_text(&mut self) -> Result<(), Error> {
        self.end_text_at(self.text_end)
    }

    #[inline(always)]
    fn start_text(&mut self, ignore_case: bool) -> Result<(), Error> {
        if self.text_ignores_case != ignore_case {
            self.end_text()?;
            self.text_ignores_case = ignore_case;
        }
        self.atom = Atom::Character;
        Ok(())
    }

    /// Lets text that was ended for a group go on, now that the group turns out to be nothing but text.
    fn resume_text(&mut self) {
        let has_text = self.text_start < self.text_end;
        if let [.., last] = self.stack[self.terms_start..]
            && last == self.tree.root()
            && let Node::Text { chars, ignore_case } = self.tree[last]
            && chars.range().end == self.text_start
            && (!has_text || ignore_case == self.text_ignores_case)
        {
            self.stack.pop();
            self.tree.truncate(last.index());
            self.text_start = chars.range().start;
            self.text_ignores_case = ignore_case;
        }
    }

    fn end_alternative(&mut self) -> Result<NodeId, Error> {
        if self.stack.len() == self.terms_start {
            let end = self.text_end;
            return match self.text_start < end {
                true => self.text_node(end),
                false => self.tree.add(Node::Empty),
            };
        }
        self.end_text()?;
        self.join(self.terms_start, Node::Sequence)
    }

    fn end_disjunction(&mut self) -> Result<NodeId, Error> {
        let last = self.end_alternative()?;
        if self.stack.len() == self.alternatives_start {
            return Ok(last);
        }
        self.push(last)?;
        self.join(self.alternatives_start, Node::Alternation)
    }

    /// Takes the nodes from `start` on off the stack.
    #[inline(always)]
    fn join(
        &mut self,
        start: usize,
        node: impl FnOnce(Span<NodeId>) -> Node,
    ) -> Result<NodeId, Error> {
        let joined = match self.stack[start..] {
            [only] => only,
            ref children => {
                let children = self.tree.add_children(children)?;
                self.tree.add(node(children))?
            }
        };
        self.stack.truncate(start);
        Ok(joined)
    }

    /// The nodes from `first_node` on are `body` and what it holds. The quantifier is not `{1}`.
    fn repeat(
        &mut self,
        body: NodeId,
        first_node: usize,
        captures: Groups,
        Quantifier { min, max, greedy }: Quantifier,
    ) -> Result<(), Error> {
        // RepeatMatcher rejects an empty iteration beyond the minimum, and those within it all do the same.
        let (is_needless, runs_once) = match self.tree[body] {
            Node::Empty => (true, false),
            Node::Look { .. }
            | Node::InputStart
            | Node::InputEnd
            | Node::LineStart
            | Node::LineEnd
            | Node::WordBoundary { .. } => (min == 0, true),
            _ => (max == 0, false),
        };
        if is_needless {
            self.tree.truncate(first_node);
            if let Some(named_groups) = &mut self.named_groups {
                named_groups.forget_references_from(first_node);
            }
            return Ok(());
        }
        let id = match runs_once {
            true => body,
            false => self.tree.add(Node::Repeat {
                body,
                min,
                max,
                greedy,
                captures,
            })?,
        };
        self.push(id)
    }
}

impl Sink for Builder<'_> {
    type Outer = Outer;

    #[inline]
    fn text<C: CodeUnit>(&mut self, units: &[C]) -> Result<(), Error> {
        if let [unit] = units {
            return self.character(unit.to_u32());
        }
        self.start_text(self.ignores_case())?;
        let (ignore_case, most) = (self.ignore_case(), units.len());
        let chars = units.iter().map(|unit| unit.to_u32());
        self.text_end = if !C::IS_LATIN1 && self.tree.is_unicode_aware() {
            let canonical = |c| ignore_case.map_or(c, |it| it.canonicalize(c));
            let chars = C::text(units).code_points();
            self.tree.extend_chars(most, chars.map(canonical))?
        } else if let Some(ignore_case) = ignore_case {
            let canonical = |c| ignore_case.canonicalize(c);
            self.tree.extend_chars(most, chars.map(canonical))?
        } else {
            self.tree.extend_chars(most, chars)?
        };
        Ok(())
    }

    #[inline]
    fn character(&mut self, c: u32) -> Result<(), Error> {
        self.start_text(self.ignores_case())?;
        let c = self.ignore_case().map_or(c, |it| it.canonicalize(c));
        self.text_end = self.tree.push_char(c)?;
        Ok(())
    }

    fn assertion(&mut self, assertion: Assertion) -> Result<(), Error> {
        let is_multiline = self.flags.contains(Flags::MULTILINE);
        self.add_term(match assertion {
            Assertion::Start if is_multiline => Node::LineStart,
            Assertion::Start => Node::InputStart,
            Assertion::End if is_multiline => Node::LineEnd,
            Assertion::End => Node::InputEnd,
            Assertion::WordBoundary { negated } => Node::WordBoundary {
                negated,
                unicode_ignore_case: self.ignore_case() == Some(IgnoreCase::CodePoints),
            },
        })
    }

    fn dot(&mut self) -> Result<(), Error> {
        self.add_common_set(DOT, |flags| match flags.contains(Flags::DOT_ALL) {
            true => Ok(Set::ALL),
            false => Ok(Set::NOT_LINE_TERMINATOR),
        })
    }

    fn class_escape(&mut self, escape: ClassEscape) -> Result<(), Error> {
        let index = match escape {
            ClassEscape::Digit => 0,
            ClassEscape::NotDigit => 1,
            ClassEscape::Space => 2,
            ClassEscape::NotSpace => 3,
            ClassEscape::Word => 4,
            ClassEscape::NotWord => 5,
            ClassEscape::Property(_) | ClassEscape::NotProperty(_) => {
                return self.add_set(class::set_of_escape(escape, self.flags)?);
            }
        };
        self.add_common_set(index, |flags| class::set_of_escape(escape, flags))
    }

    fn back_reference(&mut self, group: Option<Group>) -> Result<(), Error> {
        let Some(group) = group else {
            self.atom = Atom::Nothing;
            return Ok(());
        };
        let groups = self.tree.add_groups(&[group])?;
        let ignore_case = self.ignores_case();
        self.add_term(Node::BackReference {
            groups,
            ignore_case,
        })
    }

    fn named_reference(&mut self, name: NameId, candidates: Groups) -> Result<(), Error> {
        self.add_term(Node::BackReference {
            groups: Span::new(0..0),
            ignore_case: self.ignores_case(),
        })?;
        self.named_groups
            .get_or_insert_default()
            .add_reference(self.tree.root(), name, candidates)
    }

    fn quantify(&mut self, quantifier: Quantifier) -> Result<(), Error> {
        if (quantifier.min, quantifier.max) == (1, 1) {
            return Ok(());
        }
        let body = match self.atom {
            Atom::Character => {
                let end = self.text_end;
                self.end_text_at(end - 1)?;
                self.text_node(end)?
            }
            Atom::Term => {
                self.stack.pop();
                self.tree.root()
            }
            Atom::Nothing => return Ok(()),
        };
        self.repeat(body, body.index(), NO_CAPTURES, quantifier)
    }

    fn name_group(&mut self, group: Group, name: NameId, text: Text<'_>) -> Result<(), Error> {
        self.named_groups
            .get_or_insert_default()
            .add_group(group, name, text)
    }

    #[inline]
    fn open(&mut self, kind: GroupKind) -> Result<Outer, Error> {
        self.end_text()?;
        let outer = Outer {
            kind,
            flags: self.flags,
            is_backward: self.is_backward,
            alternatives_start: self.alternatives_start as u32,
            terms_start: self.terms_start as u32,
            first_node: self.tree.node_count() as u32,
        };
        match kind {
            GroupKind::Capture(_) => {}
            GroupKind::Plain { set, cleared } => self.set_flags((self.flags | set) - cleared),
            GroupKind::Look { behind, .. } => self.is_backward = behind,
        }
        self.alternatives_start = self.stack.len();
        self.terms_start = self.stack.len();
        Ok(outer)
    }

    #[inline]
    fn next_alternative(&mut self) -> Result<(), Error> {
        let alternative = self.end_alternative()?;
        self.push(alternative)?;
        self.terms_start = self.stack.len();
        Ok(())
    }

    fn close(
        &mut self,
        outer: Outer,
        captures: Groups,
        quantifier: Option<Quantifier>,
    ) -> Result<(), Error> {
        let quantifier = quantifier.filter(|it| (it.min, it.max) != (1, 1));
        let is_spliced = matches!(outer.kind, GroupKind::Plain { .. })
            && quantifier.is_none()
            && self.alternatives_start == self.terms_start;
        let has_terms = self.stack.len() > self.terms_start;
        let body = match is_spliced {
            true => None,
            false => Some(self.end_disjunction()?),
        };
        self.set_flags(outer.flags);
        self.is_backward = outer.is_backward;
        self.alternatives_start = outer.alternatives_start as usize;
        self.terms_start = outer.terms_start as usize;
        let Some(body) = body else {
            if !has_terms {
                self.resume_text();
            }
            return Ok(());
        };
        let atom = match outer.kind {
            GroupKind::Plain { .. } => body,
            GroupKind::Capture(group) => self.tree.add(Node::Capture { group, body })?,
            GroupKind::Look { behind, negated } => self.tree.add(Node::Look {
                body,
                behind,
                negated,
                captures,
            })?,
        };
        match quantifier {
            Some(quantifier) => self.repeat(atom, outer.first_node as usize, captures, quantifier),
            None => self.push(atom),
        }
    }

    #[inline]
    fn class_character(&mut self, c: u32) -> Result<(), Error> {
        self.classes.add_character(c)
    }

    #[inline]
    fn class_range(&mut self, first: u32, last: u32) -> Result<(), Error> {
        self.classes.add_range(first, last)
    }

    fn class_member(&mut self, escape: ClassEscape) -> Result<(), Error> {
        self.classes.add_escape(escape, self.flags)
    }

    fn close_class(&mut self, negated: bool, quantifier: Option<Quantifier>) -> Result<(), Error> {
        let set = if self.classes.has_only_characters() {
            self.classes.close_characters(negated, self.ignore_case())?
        } else {
            let (set, strings) = self.classes.close(negated, self.ignore_case())?;
            if !strings.is_empty() {
                let outer = self.open(GroupKind::PLAIN)?;
                self.add_strings(&set, strings)?;
                return self.close(outer, NO_CAPTURES, quantifier);
            }
            set
        };
        self.add_class(set)?;
        quantifier.map_or(Ok(()), |quantifier| self.quantify(quantifier))
    }

    fn open_nested_class(&mut self) -> Result<(), Error> {
        self.classes.open_nested()
    }

    fn close_nested_class(&mut self, negated: bool) -> Result<(), Error> {
        self.classes.close_nested(negated, self.ignore_case())
    }

    fn set_operator(&mut self, operator: SetOperator) -> Result<(), Error> {
        self.classes.set_operator(operator, self.ignore_case())
    }

    fn class_string_character(&mut self, c: u32) -> Result<(), Error> {
        let c = self.ignore_case().map_or(c, |it| it.canonicalize(c));
        self.classes.extend_string(c)
    }

    fn close_class_string(&mut self) -> Result<(), Error> {
        self.classes.close_string()
    }
}
