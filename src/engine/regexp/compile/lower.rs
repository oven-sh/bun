//! From the tree to the graph.

use smallvec::SmallVec;

use super::character::{Encoding, set_of};
use super::graph::{Graph, Id, Kind, Span, Step, Traits};
use super::groups::Groups;
use super::memory::{StackLimit, fill, push, reserve};
use super::{Mode, Options, Purpose};
use crate::Error;
use crate::analysis::Next;
use crate::program::{Direction, Pairs, UNBOUNDED, Width};
use crate::set::{CharRange, Set, SetBuilder};
use crate::surrogate::{ASTRAL, SURROGATES, lead_of, trail_of};
use crate::tree::{self, Group, Node, NodeId, Tree};

pub(super) struct Lowered {
    pub(super) root: Id,
    pub(super) pair_count: u16,
    /// Those that a reference names, ascending, if the program memoizes.
    pub(super) referenced_pairs: Option<Vec<u16>>,
}

pub(super) struct Memory {
    groups: Groups,
    encodings: Vec<Option<Encoding>>,
    terms: Vec<Id>,
}

impl Memory {
    pub(super) const fn new() -> Memory {
        Memory {
            groups: Groups::new(),
            encodings: Vec::new(),
            terms: Vec::new(),
        }
    }
}

pub(super) fn lower(
    tree: &Tree,
    options: &Options<'_>,
    purpose: Purpose,
    graph: &mut Graph,
    memory: &mut Memory,
) -> Result<Lowered, Error> {
    let memoizes = purpose == Purpose::Memoizing;
    graph.start(options.width, tree.node_count() * 2)?;
    memory.groups.start(tree, options.mode)?;
    fill(&mut memory.encodings, tree.set_count(), None)?;
    memory.terms.clear();
    let mut lowering = Lowering {
        tree,
        graph,
        groups: &mut memory.groups,
        encodings: &mut memory.encodings,
        terms: &mut memory.terms,
        has_boundary: false,
        memoizes,
        choices: 0,
        last_reference: None,
        direction: Direction::Forward,
        nodes_to_unroll: NODES_TO_UNROLL,
        stack: StackLimit(options.stack_limit),
    };
    Ok(Lowered {
        root: lowering.root(options.mode)?,
        pair_count: lowering.groups.pair_count(),
        referenced_pairs: match memoizes {
            true => Some(lowering.groups.referenced_pairs()?),
            false => None,
        },
    })
}

const NODES_TO_UNROLL: usize = 1 << 10;
const TERMS_SUMMARIZED: usize = 64;
const ALTERNATIVES_TAKEN_OVER: usize = 32;

pub(super) struct Lowering<'a> {
    pub(super) tree: &'a Tree,
    pub(super) graph: &'a mut Graph,
    pub(super) groups: &'a mut Groups,
    encodings: &'a mut [Option<Encoding>],
    /// The children of the nodes that are being built.
    pub(super) terms: &'a mut Vec<Id>,
    /// Among the terms of the innermost sequence.
    has_boundary: bool,
    memoizes: bool,
    /// The number of nodes so far that have more than one way to match.
    pub(super) choices: usize,
    /// Its groups, the changes to what is visible until then, and its pairs.
    last_reference: Option<((tree::Span<Group>, usize), Span)>,
    pub(super) direction: Direction,
    pub(super) nodes_to_unroll: usize,
    pub(super) stack: StackLimit,
}

impl Lowering<'_> {
    fn root(&mut self, mode: Mode) -> Result<Id, Error> {
        self.push_all_terms_of(self.tree.root(), 0)?;
        let mut ending = SmallVec::<[Id; 4]>::new();
        if mode == Mode::Captures {
            for pairs in self.groups.never_set() {
                ending.try_reserve(1).map_err(|_| Error::OutOfMemory)?;
                ending.push(self.graph.leaf(Kind::Clear(pairs))?);
            }
        }
        ending.try_reserve(1).map_err(|_| Error::OutOfMemory)?;
        ending.push(self.graph.leaf(Kind::Accept)?);
        self.finish_with_ending(0, &ending, 0, 0)
    }

    pub(super) fn node(&mut self, id: NodeId) -> Result<Id, Error> {
        self.stack.check()?;
        match self.tree[id] {
            Node::Sequence(_) | Node::Capture { .. } => self.sequence(id),
            Node::Alternation(children) => self.alternation(children),
            Node::Repeat {
                body,
                min,
                max,
                greedy,
                ..
            } => self.repeat(body, min, max, greedy),
            Node::Look {
                body,
                behind,
                negated,
                ..
            } => self.look(body, behind, negated),
            leaf => self.leaf(leaf),
        }
    }

    pub(super) fn push_term(&mut self, start: usize, term: Id) -> Result<(), Error> {
        self.graph.push_term(self.terms, start, term)
    }

    pub(super) fn finish_sequence(&mut self, start: usize) -> Result<Id, Error> {
        let sequence = self.graph.sequence(&self.terms[start..]);
        self.terms.truncate(start);
        sequence
    }

    pub(super) fn join(&mut self, terms: &[Id]) -> Result<Id, Error> {
        let start = self.terms.len();
        for &term in terms {
            self.push_term(start, term)?;
        }
        self.finish_sequence(start)
    }

    fn sequence(&mut self, id: NodeId) -> Result<Id, Error> {
        let start = self.terms.len();
        self.push_all_terms_of(id, start)?;
        self.finish_sequence(start)
    }

    /// There are no terms from `start` on yet.
    fn push_all_terms_of(&mut self, id: NodeId, start: usize) -> Result<(), Error> {
        let outer = core::mem::take(&mut self.has_boundary);
        self.push_terms_of(id, start)?;
        if core::mem::replace(&mut self.has_boundary, outer) {
            self.simplify_boundaries(start)?;
        }
        if !self.memoizes {
            self.move_tests_into_alternatives(start)?;
        }
        Ok(())
    }

    fn push_terms_of(&mut self, id: NodeId, start: usize) -> Result<(), Error> {
        self.stack.check()?;
        match self.tree[id] {
            Node::Sequence(children) => {
                let count = children.len();
                for index in 0..count {
                    let child = self.tree[children][match self.direction {
                        Direction::Forward => index,
                        Direction::Backward => count - 1 - index,
                    }];
                    self.push_terms_of(child, start)?;
                }
                Ok(())
            }
            Node::Capture { group, body } => match self.groups.pair(group) {
                None => self.push_terms_of(body, start),
                Some(pair) => {
                    let open = self.graph.leaf(Kind::Open(pair))?;
                    push(self.terms, open)?;
                    let inside = self.terms.len();
                    self.push_terms_of(body, start)?;
                    self.close_group(group, pair, inside)
                }
            },
            node => {
                self.has_boundary |= matches!(node, Node::WordBoundary { .. });
                let term = self.node(id)?;
                self.push_term(start, term)
            }
        }
    }

    /// The terms from `inside` on are in the group.
    #[inline(never)]
    fn close_group(&mut self, group: Group, pair: u16, inside: usize) -> Result<(), Error> {
        let close = self.graph.leaf(Kind::Close(pair))?;
        let mut reference = Graph::EMPTY;
        if self.groups.is_referenced(group) {
            self.graph[close].traits |= Traits::REFERENCED;
            let terms = &self.terms[inside..];
            let ((min, max), first) = match terms.len() {
                ..=TERMS_SUMMARIZED => (
                    self.graph.lengths(terms),
                    self.graph.first_of_terms(terms).0,
                ),
                _ => ((0, UNBOUNDED), Next::ANYTHING),
            };
            reference = self.graph.leaf_with_first(Kind::Empty, first)?;
            (self.graph[reference].min, self.graph[reference].max) = (min, max);
        }
        self.groups.close(pair, reference, self.direction)?;
        push(self.terms, close)
    }

    fn look(&mut self, body: NodeId, behind: bool, negated: bool) -> Result<Id, Error> {
        let direction = match behind {
            true => Direction::Backward,
            false => Direction::Forward,
        };
        let outer = core::mem::replace(&mut self.direction, direction);
        let closed = self.groups.closed_so_far();
        let body = self.node(body)?;
        self.direction = outer;
        if negated {
            self.groups.forget(closed);
        }
        self.finish_look(body, direction, negated)
    }

    #[inline(never)]
    fn finish_look(&mut self, body: Id, direction: Direction, negated: bool) -> Result<Id, Error> {
        let node = self.graph[body];
        match node.kind {
            Kind::Fail if negated => return Ok(Graph::EMPTY),
            Kind::Fail => return Ok(Graph::FAIL),
            _ if negated && node.is(Traits::CANNOT_FAIL) => return Ok(Graph::FAIL),
            _ if node.is(Traits::CANNOT_FAIL) && node.pairs.is_empty() => return Ok(Graph::EMPTY),
            Kind::Steps(steps) if steps.len() == 1 => {
                let step = self.graph.steps[steps.range().start];
                return self.peek(direction, step, negated);
            }
            _ => {}
        }
        let constrains = !negated && direction == self.direction && !node.is(Traits::OPEN);
        self.graph.look(body, direction, negated, constrains)
    }

    /// The unit on that side passes the step, or if `negated` there is none that does.
    pub(super) fn peek(&mut self, side: Direction, step: Step, negated: bool) -> Result<Id, Error> {
        let step = match negated {
            false => Some(step),
            true => {
                let class = self.graph.class_of_step(step)?;
                let others = self.graph[class].complement()?;
                self.graph.step(&others)?
            }
        };
        let Some(step) = step else {
            return self.edge(side);
        };
        let kind = Kind::Peek {
            side,
            step,
            or_edge: negated,
        };
        if side != self.direction {
            return self.graph.leaf(kind);
        }
        let edge = if negated { Next::EDGE } else { Next::NOTHING };
        let first = self.graph.units_of_step(step) | edge;
        self.graph.closed_leaf(kind, first)
    }

    fn edge(&mut self, side: Direction) -> Result<Id, Error> {
        match side == self.direction {
            true => self.graph.closed_leaf(Kind::Edge(side), Next::EDGE),
            false => self.graph.leaf(Kind::Edge(side)),
        }
    }

    fn line_edge(&mut self, side: Direction) -> Result<Id, Error> {
        let inside = Step::Class(self.graph.add_class(Set::NOT_LINE_TERMINATOR)?);
        self.peek(side, inside, true)
    }

    #[inline(never)]
    fn leaf(&mut self, node: Node) -> Result<Id, Error> {
        match node {
            Node::Text { chars, ignore_case } => self.text(chars, ignore_case),
            Node::Set(set) => {
                let encoding = self.encoding(set)?;
                self.graph.character(encoding, self.direction)
            }
            Node::BackReference {
                groups,
                ignore_case,
            } => self.back_reference(groups, ignore_case),
            Node::InputStart => self.edge(Direction::Backward),
            Node::InputEnd => self.edge(Direction::Forward),
            Node::LineStart => self.line_edge(Direction::Backward),
            Node::LineEnd => self.line_edge(Direction::Forward),
            Node::WordBoundary {
                negated,
                unicode_ignore_case,
            } => {
                let word = match unicode_ignore_case {
                    true => Set::WORD_IGNORING_CASE,
                    false => Set::WORD,
                };
                let other = self.graph.add_class(word.complement()?)?;
                let word = self.graph.add_class(word)?;
                self.graph.leaf(Kind::Boundary {
                    word,
                    other,
                    negated,
                })
            }
            _ => Ok(Graph::EMPTY),
        }
    }

    fn encoding(&mut self, set: tree::SetId) -> Result<Encoding, Error> {
        if let Some(known) = self.encodings[set.index()] {
            return Ok(known);
        }
        let unicode_aware = self.tree.is_unicode_aware();
        let encoding = self.graph.encode(&self.tree[set], unicode_aware)?;
        self.encodings[set.index()] = Some(encoding);
        Ok(encoding)
    }

    fn text(&mut self, chars: tree::Span<u32>, ignore_case: bool) -> Result<Id, Error> {
        let (start, chars) = (self.terms.len(), &self.tree[chars]);
        if chars.iter().fold(0, |all, &c| all | c) < 0x80 {
            return self.ascii_text(chars, ignore_case);
        }
        let mut pending = self.graph.steps.len();
        for index in 0..chars.len() {
            let c = chars[match self.direction {
                Direction::Forward => index,
                Direction::Backward => chars.len() - 1 - index,
            }];
            match self.encode_char(c, ignore_case)? {
                Encoding::Unit(step) => push(&mut self.graph.steps, step)?,
                encoding => {
                    self.push_steps_since(start, pending)?;
                    let character = self.graph.character(encoding, self.direction)?;
                    self.push_term(start, character)?;
                    pending = self.graph.steps.len();
                }
            }
        }
        self.push_steps_since(start, pending)?;
        self.finish_sequence(start)
    }

    fn ascii_text(&mut self, chars: &[u32], ignore_case: bool) -> Result<Id, Error> {
        // Among code points, two letters are equal to characters that are not ASCII.
        let folds_wide = self.tree.is_unicode_aware() && self.graph.width == Width::Utf16;
        let (first, length) = (self.graph.steps.len(), chars.len());
        reserve(&mut self.graph.steps, length)?;
        for &c in chars {
            let has_cases = ignore_case && (c as u8).is_ascii_alphabetic();
            let mask = if has_cases { 0x20 } else { 0 };
            let value = c as u16 | mask;
            let step = match (has_cases && folds_wide, value as u8) {
                (true, b'k' | b's') => match self.encode_equivalents(c)? {
                    Encoding::Unit(step) => step,
                    _ => unreachable!("the equivalents fit in a unit"),
                },
                _ => Step::Unit { value, mask },
            };
            self.graph.steps.push(step);
        }
        if self.direction == Direction::Backward {
            self.graph.steps[first..].reverse();
        }
        (self.graph).leaf(Kind::Steps(Span::new(first..first + length)))
    }

    fn push_steps_since(&mut self, start: usize, first_step: usize) -> Result<(), Error> {
        let steps = Span::new(first_step..self.graph.steps.len());
        if steps.len() == 0 {
            return Ok(());
        }
        let steps = self.graph.leaf(Kind::Steps(steps))?;
        self.push_term(start, steps)
    }

    #[inline]
    fn encode_char(&mut self, c: u32, ignore_case: bool) -> Result<Encoding, Error> {
        let exact = |value| Step::Unit { value, mask: 0 };
        let has_no_case = c < 0x80 && !(c as u8).is_ascii_alphabetic();
        if ignore_case && !has_no_case {
            return self.encode_equivalents(c);
        }
        let unicode_aware = self.tree.is_unicode_aware();
        Ok(match (self.graph.width, u16::try_from(c)) {
            (Width::Latin1, Ok(unit @ ..=0xff)) => Encoding::Unit(exact(unit)),
            (Width::Latin1, _) => Encoding::Never,
            (Width::Utf16, Err(_)) => Encoding::TwoUnits(exact(lead_of(c)), exact(trail_of(c))),
            (Width::Utf16, Ok(_))
                if unicode_aware && (SURROGATES.first..=SURROGATES.last).contains(&c) =>
            {
                let alone = set_of([CharRange::single(c)].into_iter())?;
                self.graph.encode(&alone, true)?
            }
            (Width::Utf16, Ok(unit)) => Encoding::Unit(exact(unit)),
        })
    }

    fn encode_equivalents(&mut self, c: u32) -> Result<Encoding, Error> {
        let max = match self.graph.width {
            Width::Latin1 => 0xff,
            Width::Utf16 => ASTRAL.last,
        };
        let equivalents = self.tree.case_equivalence().equivalents(c);
        let members = core::iter::once(c).chain(equivalents);
        let members: SmallVec<[u32; 4]> = members.filter(|&it| it <= max).collect();
        match members[..] {
            [] => Ok(Encoding::Never),
            [only] => self.encode_char(only, false),
            [a, b] if a | b <= 0xffff && (a ^ b).is_power_of_two() => {
                Ok(Encoding::Unit(Step::Unit {
                    value: (a | b) as u16,
                    mask: (a ^ b) as u16,
                }))
            }
            _ => {
                let set = set_of(members.into_iter().map(CharRange::single))?;
                self.graph.encode(&set, self.tree.is_unicode_aware())
            }
        }
    }

    fn back_reference(
        &mut self,
        groups: tree::Span<Group>,
        ignore_case: bool,
    ) -> Result<Id, Error> {
        self.choices += 1;
        let pairs = self.visible_pairs(groups)?;
        let kind = Kind::BackReference { pairs, ignore_case };
        let captured = match self.graph.referenced_pairs[pairs.range()] {
            [] => return Ok(Graph::EMPTY),
            [only] if !ignore_case => self.groups.certain_reference(only),
            _ => None,
        };
        let id = self.graph.leaf(kind)?;
        if let Some((model, direction)) = captured {
            let (min, max) = (self.graph[model].min, self.graph[model].max);
            (self.graph[id].min, self.graph[id].max) = (min, max);
            if direction == self.direction {
                self.graph.set_first(id, self.graph.first(model))?;
                self.graph[id].traits.set(Traits::OPEN, min == 0);
            }
        }
        Ok(id)
    }

    fn visible_pairs(&mut self, groups: tree::Span<Group>) -> Result<Span, Error> {
        let wanted = (groups, self.groups.changes());
        if let Some((_, pairs)) = self.last_reference.filter(|it| it.0 == wanted) {
            return Ok(pairs);
        }
        let start = self.graph.referenced_pairs.len();
        for &group in &self.tree[groups] {
            if let Some(pair) = self.groups.visible_pair(group) {
                push(&mut self.graph.referenced_pairs, pair)?;
            }
        }
        let pairs = Span::new(start..self.graph.referenced_pairs.len());
        self.last_reference = Some((wanted, pairs));
        Ok(pairs)
    }

    /// Looks through the groups whose captures nothing reads.
    pub(super) fn without_unread_groups(&self, mut id: NodeId) -> NodeId {
        while let Node::Capture { group, body } = self.tree[id]
            && self.groups.pair(group).is_none()
        {
            id = body;
        }
        id
    }

    pub(super) fn is_one_character(&self, id: NodeId) -> bool {
        match self.tree[id] {
            Node::Set(_) => true,
            Node::Text { chars, .. } => chars.len() == 1,
            _ => false,
        }
    }

    #[inline(never)]
    fn any_of(&mut self, characters: &[NodeId]) -> Result<Id, Error> {
        let mut builder = SetBuilder::default();
        for &id in characters {
            match self.tree[self.without_unread_groups(id)] {
                Node::Set(set) => builder.add_set(&self.tree[set])?,
                Node::Text { chars, ignore_case } => {
                    let c = self.tree[chars][0];
                    builder.add(c)?;
                    if ignore_case {
                        for equal in self.tree.case_equivalence().equivalents(c) {
                            builder.add(equal)?;
                        }
                    }
                }
                _ => unreachable!("the node is one character"),
            }
        }
        let set = builder.finish(None)?;
        let encoding = self.graph.encode(&set, self.tree.is_unicode_aware())?;
        self.graph.character(encoding, self.direction)
    }

    fn alternation(&mut self, children: tree::Span<NodeId>) -> Result<Id, Error> {
        let (start, tree) = (self.terms.len(), self.tree);
        let mut rest = &tree[children];
        let (mut earlier, closed_before) = (Pairs::NONE, self.groups.closed_so_far());
        while let [child, ..] = *rest {
            let is_character = |&&it: &&_| self.is_one_character(self.without_unread_groups(it));
            let (taken, after) = rest.split_at(rest.iter().take_while(is_character).count().max(1));
            rest = after;
            self.choices += usize::from(!rest.is_empty());
            let closed = self.groups.closed_so_far();
            let alternative = if taken.len() > 1 {
                self.any_of(taken)?
            } else {
                self.groups.hide(earlier)?;
                let alternative = self.node(child)?;
                self.groups.reveal();
                alternative
            };
            earlier = earlier.hull(self.graph[alternative].pairs);
            match alternative {
                Graph::FAIL => self.groups.forget(closed),
                _ => self.push_alternative(alternative)?,
            }
        }
        self.groups.make_optional(closed_before)?;
        self.finish_alternation(start)
    }

    pub(super) fn push_alternative(&mut self, alternative: Id) -> Result<(), Error> {
        match self.graph[alternative].kind {
            Kind::Alternation(nested) if nested.len() <= ALTERNATIVES_TAKEN_OVER => nested
                .range()
                .try_for_each(|index| push(self.terms, self.graph.children[index])),
            _ => push(self.terms, alternative),
        }
    }
}
