//! The class `AST`, which turns one part of a glob into RegExp source: <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L456-L1095>

use core::ops::Range;

use bun_core::strings;
use bun_paths::PathChar;

use super::append_ascii;
use super::budget::{ALLOCATION_OVERHEAD, Abort, Budget, check_stack, cost};
use super::class::parse_class;
use super::regexp::BYTES_PER_SOURCE_UNIT;
use crate::{BACKSLASH, CodeUnit, DOT, byte_at};

const START_NO_DOT_SEGMENT: &[u8] = br"(?!(?:^|/)\.\.?(?:$|/))";
pub(super) const START_NO_DOT: &[u8] = br"(?!\.)";
pub(super) const QMARK: &[u8] = b"[^/]";
const STAR: &[u8] = b"[^/]*?";
const STAR_NO_EMPTY: &[u8] = b"[^/]+?";
/// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L662>
const MAX_EXTGLOB_RECURSION: usize = 2;
/// <https://github.com/nodejs/node/blob/v26.12.1/deps/minimatch/index.js#L1032>
const MAX_FLATTEN_ITERATIONS: usize = 10;

const ROOT: usize = 0;
const BYTES_PER_NODE: usize = (size_of::<Node>() + size_of::<Vec<Part>>() + size_of::<Part>())
    .next_multiple_of(ALLOCATION_OVERHEAD);

pub(super) fn append_regexp_escaped(source: &mut Vec<u16>, unit: u16) {
    let is_special = matches!(
        unit.to_u8_saturating(),
        b'#' | b'$' | b'('..=b'.' | b'?' | b'['..=b'^' | b'{'..=b'}'
    );
    if is_special || strings::is_js_whitespace(unit.into()) {
        source.push(BACKSLASH.into());
    }
    source.push(unit);
}

#[derive(Clone, Copy, PartialEq)]
#[repr(u8)]
enum ExtglobType {
    Not = b'!',
    Optional = b'?',
    OneOrMore = b'+',
    ZeroOrMore = b'*',
    One = b'@',
}
use ExtglobType::*;

impl ExtglobType {
    fn parse(byte: u8) -> Option<Self> {
        [Not, Optional, OneOrMore, ZeroOrMore, One]
            .into_iter()
            .find(|&it| it as u8 == byte)
    }

    /// `adoptionMap`
    fn can_adopt(self, child: Self) -> bool {
        matches!(
            (self, child),
            (_, One)
                | (Optional | ZeroOrMore, Optional)
                | (ZeroOrMore | OneOrMore, OneOrMore)
                | (ZeroOrMore, ZeroOrMore)
        )
    }

    /// `adoptionWithSpaceMap`
    fn can_adopt_with_space(self, child: Self) -> bool {
        matches!(
            (self, child),
            (Not | One | OneOrMore, Optional) | (OneOrMore, ZeroOrMore)
        )
    }

    /// `usurpMap`
    fn usurped_type(self, child: Self) -> Option<Self> {
        match (self, child) {
            (Not, Not) => Some(One),
            (Optional, ZeroOrMore | OneOrMore) | (OneOrMore, Optional | ZeroOrMore) => {
                Some(ZeroOrMore)
            }
            (One, _) => Some(child),
            _ => None,
        }
    }
}

#[derive(Clone)]
enum Part {
    /// A range of [`Ast::text`].
    Text(Range<usize>),
    Node(usize),
}

#[derive(Clone, Copy)]
struct Node {
    extglob: Option<ExtglobType>,
    empty_ext: bool,
    parent: Option<usize>,
    parent_index: usize,
    /// An index into [`Ast::parts`]. A node shares the list with the node that it usurped.
    parts: usize,
}

struct Ast<'b, 'a> {
    text: Vec<u16>,
    nodes: Vec<Node>,
    parts: Vec<Vec<Part>>,
    negs: Vec<usize>,
    needs_unicode: bool,
    budget: &'b mut Budget<'a>,
}

pub(super) enum MmPattern {
    Literal(Vec<u16>),
    RegExp {
        source: Vec<u16>,
        needs_unicode: bool,
    },
}

/// `AST.fromGlob(glob).toMMPattern()`
pub(super) fn to_mm_pattern(glob: &[u16], budget: &mut Budget<'_>) -> Result<MmPattern, Abort> {
    let mut ast = Ast {
        text: glob.to_vec(),
        nodes: Vec::new(),
        parts: Vec::new(),
        negs: Vec::new(),
        needs_unicode: false,
        budget,
    };
    ast.new_node(None, None)?;
    ast.parse_ast(ROOT, 0, 0)?;
    ast.flatten(ROOT)?;
    ast.fill_negs()?;
    let place = Place {
        is_start: true,
        is_end: true,
        parent_is_negation: false,
        allow_dot: false,
    };
    let (mut source, has_magic) = ast.to_regexp_source(ROOT, place)?;
    if has_magic {
        source.insert(0, b'^'.into());
        source.push(b'$'.into());
        let needs_unicode = ast.needs_unicode;
        return Ok(MmPattern::RegExp {
            source,
            needs_unicode,
        });
    }
    // `unescape(src)`: every backslash is one that `append_regexp_escaped` added.
    source.retain(|unit| !unit.eq_ascii(BACKSLASH));
    Ok(MmPattern::Literal(source))
}

/// The `inBrace` state of `#parseAST`, which does not quite agree with [`parse_class`].
#[derive(Default)]
struct BraceState {
    brace_start: Option<usize>,
    brace_neg: bool,
}

impl BraceState {
    /// Returns whether `unit` is inside brackets.
    fn step(&mut self, unit: u8, at: usize) -> bool {
        match self.brace_start {
            Some(start) if at == start => self.brace_neg = matches!(unit, b'^' | b'!'),
            Some(start) if unit == b']' && !(at == start + 1 && self.brace_neg) => {
                self.brace_start = None;
            }
            Some(_) => {}
            None if unit == b'[' => self.brace_start = Some(at + 1),
            None => return false,
        }
        true
    }
}

/// What `toRegExpSource` learns from the ancestors of a node.
#[derive(Clone, Copy)]
struct Place {
    is_start: bool,
    is_end: bool,
    parent_is_negation: bool,
    allow_dot: bool,
}

impl Ast<'_, '_> {
    fn charge_for_node(&mut self) -> Result<(), Abort> {
        self.budget.spend(cost::ALLOCATION)?;
        self.budget.charge_memory(BYTES_PER_NODE)
    }

    fn new_node(
        &mut self,
        extglob: Option<ExtglobType>,
        parent: Option<usize>,
    ) -> Result<usize, Abort> {
        self.charge_for_node()?;
        self.nodes.push(Node {
            extglob,
            empty_ext: false,
            parent,
            parent_index: parent.map_or(0, |parent| self.parts_of(parent).len()),
            parts: self.parts.len(),
        });
        self.parts.push(Vec::new());
        Ok(self.nodes.len() - 1)
    }

    fn parts_of(&self, node: usize) -> &[Part] {
        &self.parts[self.nodes[node].parts]
    }

    fn is_negation(&self, node: usize) -> bool {
        self.nodes[node].extglob == Some(Not)
    }

    fn push(&mut self, node: usize, part: Part) {
        if !matches!(&part, Part::Text(text) if text.is_empty()) {
            self.parts[self.nodes[node].parts].push(part);
        }
    }

    fn demote_to_text(&mut self, node: usize, text: Range<usize>) {
        self.nodes[node].extglob = None;
        self.nodes[node].parts = self.parts.len();
        self.parts.push(vec![Part::Text(text)]);
    }

    /// `pos` is the index of the "(" unless `node` is the root. Returns the index after the node.
    fn parse_ast(&mut self, node: usize, pos: usize, ext_depth: usize) -> Result<usize, Abort> {
        check_stack()?;
        let extglob = self.nodes[node].extglob;
        let is_root = node == ROOT;
        let mut at = pos + usize::from(!is_root);
        let mut part = if is_root {
            ROOT
        } else {
            self.new_node(None, Some(node))?
        };
        let mut parts = Vec::new();
        let mut brace_state = BraceState::default();
        let mut acc_start = at;
        while at < self.text.len() {
            let (acc, unit) = (Part::Text(acc_start..at), byte_at(&self.text, at));
            at += 1;
            if brace_state.step(unit, at - 1) {
                continue;
            }
            let can_adopt_type = |child| {
                extglob.is_some_and(|it| it.can_adopt(child) || it.can_adopt_with_space(child))
            };
            if byte_at(&self.text, at) == b'('
                && let Some(child) = ExtglobType::parse(unit)
                && (ext_depth <= MAX_EXTGLOB_RECURSION || can_adopt_type(child))
            {
                self.push(part, acc);
                let ext = self.new_node(Some(child), Some(part))?;
                if child == Not {
                    self.negs.push(ext);
                }
                self.push(part, Part::Node(ext));
                at = self.parse_ast(ext, at, ext_depth + usize::from(!can_adopt_type(child)))?;
            } else if unit == b'|' && !is_root {
                self.push(part, acc);
                parts.push(Part::Node(part));
                part = self.new_node(None, Some(node))?;
            } else if unit == b')' && !is_root {
                self.nodes[node].empty_ext = acc_start + 1 == at;
                self.push(part, acc);
                parts.push(Part::Node(part));
                self.parts[self.nodes[node].parts] = parts;
                return Ok(at);
            } else {
                continue;
            }
            acc_start = at;
        }
        if is_root {
            self.push(ROOT, Part::Text(acc_start..at));
        } else {
            self.demote_to_text(node, pos - 1..at);
        }
        Ok(at)
    }

    fn flatten(&mut self, node: usize) -> Result<(), Abort> {
        check_stack()?;
        for _ in 0..MAX_FLATTEN_ITERATIONS {
            let mut done = true;
            let mut index = 0;
            while let Some(part) = self.parts_of(node).get(index) {
                if let Part::Node(child) = *part {
                    self.budget.spend(cost::RECURSION)?;
                    self.flatten(child)?;
                    done &= !self.adopt_or_usurp(node, child, index)?;
                }
                index += 1;
            }
            if done {
                break;
            }
        }
        Ok(())
    }

    /// `child` is `parts_of(node)[index]`. Returns whether anything changed.
    fn adopt_or_usurp(&mut self, node: usize, child: usize, index: usize) -> Result<bool, Abort> {
        let [Part::Node(grandchild)] = *self.parts_of(child) else {
            return Ok(false);
        };
        let (outer, inner) = (self.nodes[node], self.nodes[grandchild]);
        let (Some(outer_type), Some(inner_type)) = (outer.extglob, inner.extglob) else {
            return Ok(false);
        };
        let with_space = outer_type.can_adopt_with_space(inner_type);
        if outer_type.can_adopt(inner_type) || with_space {
            if with_space {
                let blank = self.new_node(None, Some(grandchild))?;
                self.demote_to_text(blank, 0..0);
                self.push(grandchild, Part::Node(blank));
            }
            let adopted = self.parts[inner.parts].clone();
            self.budget
                .spend(adopted.len() + self.parts[outer.parts].len())?;
            // A list grows by doubling.
            self.budget.charge_memory(2 * size_of_val(&adopted[..]))?;
            self.parts[outer.parts].splice(index..=index, adopted);
        } else if self.parts[outer.parts].len() == 1
            && let Some(usurped_type) = outer_type.usurped_type(inner_type)
        {
            self.nodes[node] = Node {
                extglob: Some(usurped_type),
                empty_ext: false,
                parts: inner.parts,
                ..outer
            };
        } else {
            return Ok(false);
        }
        for part in &self.parts[inner.parts] {
            if let Part::Node(part) = *part {
                self.nodes[part].parent = Some(node);
            }
        }
        Ok(true)
    }

    /// Appends what follows each `!()` to each of its alternatives.
    fn fill_negs(&mut self) -> Result<(), Abort> {
        while let Some(neg) = self.negs.pop() {
            if !self.is_negation(neg) {
                continue;
            }
            let mut node = neg;
            while let Some(parent) = self.nodes[node].parent {
                self.budget.spend(cost::STEP)?;
                let mut index = self.nodes[node].parent_index + 1;
                while self.nodes[parent].extglob.is_none() && index < self.parts_of(parent).len() {
                    for alternative in 0..self.parts_of(neg).len() {
                        if let Part::Node(alternative) = self.parts_of(neg)[alternative] {
                            self.copy_in(alternative, self.parts_of(parent)[index].clone())?;
                        }
                    }
                    index += 1;
                }
                node = parent;
            }
        }
        Ok(())
    }

    fn copy_in(&mut self, node: usize, part: Part) -> Result<(), Abort> {
        self.charge_for_node()?;
        let Part::Node(original) = part else {
            self.push(node, part);
            return Ok(());
        };
        check_stack()?;
        let clone = self.new_node(self.nodes[original].extglob, Some(node))?;
        for index in 0..self.parts_of(original).len() {
            self.copy_in(clone, self.parts_of(original)[index].clone())?;
        }
        self.push(node, Part::Node(clone));
        Ok(())
    }

    /// Calls `callback` with the source of each part of `node` and whether it has magic.
    fn for_each_part_source(
        &mut self,
        node: usize,
        place: Place,
        callback: &mut dyn FnMut(&[u16], bool),
    ) -> Result<(), Abort> {
        let parts = self.parts_of(node);
        let count = parts.len();
        let is_negation = |part: &&Part| matches!(**part, Part::Node(it) if self.is_negation(it));
        let leading_negations = parts.iter().take_while(is_negation).count();
        let is_all_text = parts.iter().all(|part| matches!(part, Part::Text(_)));
        let no_empty = place.is_start && place.is_end && is_all_text;
        let parent_is_negation = self.is_negation(node);
        for index in 0..count {
            let checkpoint = self.budget.bytes_in_use();
            let (source, has_magic) = match self.parts_of(node)[index].clone() {
                Part::Text(text) => self.parse_glob(text, no_empty)?,
                Part::Node(part) => {
                    let Node {
                        extglob,
                        parent_index,
                        ..
                    } = self.nodes[part];
                    let place = Place {
                        is_start: place.is_start && parent_index <= leading_negations,
                        is_end: parent_is_negation
                            || (place.is_end && (extglob.is_none() || parent_index + 1 == count)),
                        parent_is_negation,
                        allow_dot: place.allow_dot,
                    };
                    self.to_regexp_source(part, place)?
                }
            };
            self.budget.spend(cost::CALL + source.len())?;
            self.budget
                .settle_memory(checkpoint, BYTES_PER_SOURCE_UNIT * source.len())?;
            callback(&source, has_magic);
        }
        Ok(())
    }

    fn parts_to_regexp(&mut self, node: usize, place: Place) -> Result<Vec<u16>, Abort> {
        let (mut body, mut is_first) = (Vec::new(), true);
        self.for_each_part_source(node, place, &mut |source, _| {
            if source.is_empty() && place.is_start && place.is_end {
                return;
            }
            if !is_first {
                body.push(b'|'.into());
            }
            body.extend_from_slice(source);
            is_first = false;
        })?;
        Ok(body)
    }

    /// Returns the source and whether it has magic.
    fn to_regexp_source(&mut self, node: usize, place: Place) -> Result<(Vec<u16>, bool), Abort> {
        check_stack()?;
        let Some(extglob) = self.nodes[node].extglob else {
            return self.sequence_to_regexp_source(node, place);
        };
        let body = self.parts_to_regexp(node, place)?;
        if place.is_start && place.is_end && body.is_empty() && extglob != Not {
            // `@(|)` is taken literally.
            let start = self.text.len();
            let bars = self.parts_of(node).len().saturating_sub(1);
            append_ascii(&mut self.text, &[extglob as u8, b'(']);
            self.text
                .extend(core::iter::repeat_n(u16::from(b'|'), bars));
            append_ascii(&mut self.text, b")");
            self.demote_to_text(node, start..self.text.len());
            let has_magic = false;
            return Ok((self.text[start..].to_vec(), has_magic));
        }
        let no_dot = if place.is_start && !place.allow_dot {
            START_NO_DOT
        } else {
            b""
        };
        let mut source = Vec::new();
        if extglob == Not && self.nodes[node].empty_ext {
            append_ascii(&mut source, no_dot);
            append_ascii(&mut source, STAR_NO_EMPTY);
        } else if extglob == Not {
            append_ascii(&mut source, b"(?:(?!(?:");
            source.extend_from_slice(&body);
            for piece in [b"))", no_dot, STAR, b")"] {
                append_ascii(&mut source, piece);
            }
        } else {
            let mut body_dot_allowed = Vec::new();
            if matches!(extglob, ZeroOrMore | OneOrMore) && !place.allow_dot {
                let allow_dot = true;
                body_dot_allowed = self.parts_to_regexp(node, Place { allow_dot, ..place })?;
            }
            append_ascii(&mut source, b"(?:");
            if body_dot_allowed.is_empty() || body_dot_allowed == body {
                source.extend_from_slice(&body);
                append_ascii(&mut source, b")");
                if extglob != One {
                    append_ascii(&mut source, &[extglob as u8]);
                }
            } else {
                append_ascii(&mut source, b"(?:");
                source.extend_from_slice(&body);
                append_ascii(&mut source, b")(?:");
                source.extend_from_slice(&body_dot_allowed);
                append_ascii(&mut source, b")*?)");
                if extglob == ZeroOrMore {
                    append_ascii(&mut source, b"?");
                }
            }
        }
        let has_magic = true;
        Ok((source, has_magic))
    }

    fn sequence_to_regexp_source(
        &mut self,
        node: usize,
        place: Place,
    ) -> Result<(Vec<u16>, bool), Abort> {
        let (mut source, mut has_magic) = (Vec::new(), false);
        self.for_each_part_source(node, place, &mut |part_source, part_has_magic| {
            source.extend_from_slice(part_source);
            has_magic |= part_has_magic;
        })?;
        if let (true, [Part::Text(first), others @ ..]) = (place.is_start, self.parts_of(node)) {
            let first = &self.text[first.clone()];
            let is_just_dots = others.is_empty()
                && matches!(first.len(), 1 | 2)
                && first.iter().all(|unit| unit.eq_ascii(DOT));
            let may_match_dot_after = |prefix: &'static [u8]| {
                strings::has_prefix_comptime_utf16(&source, prefix)
                    && matches!(byte_at(&source, prefix.len()), b'[' | DOT)
            };
            let start = if is_just_dots {
                b""
            } else if (place.allow_dot && may_match_dot_after(b""))
                || may_match_dot_after(br"\.")
                || may_match_dot_after(br"\.\.")
            {
                START_NO_DOT_SEGMENT
            } else if !place.allow_dot && may_match_dot_after(b"") {
                START_NO_DOT
            } else {
                b""
            };
            source.splice(..0, start.iter().map(|&byte| u16::from(byte)));
        }
        if place.parent_is_negation {
            append_ascii(&mut source, br"(?:$|\/)");
        }
        Ok((source, has_magic))
    }

    fn parse_glob(
        &mut self,
        text: Range<usize>,
        no_empty: bool,
    ) -> Result<(Vec<u16>, bool), Abort> {
        let glob = &self.text[text];
        self.budget.spend(cost::CALL * glob.len())?;
        let star = if no_empty && glob.iter().all(|unit| unit.eq_ascii(b'*')) {
            STAR_NO_EMPTY
        } else {
            STAR
        };
        let (mut source, mut has_magic) = (Vec::with_capacity(glob.len()), false);
        let (mut at, mut in_star) = (0, false);
        while let Some(&unit) = glob.get(at) {
            let is_star = unit.eq_ascii(b'*');
            if is_star {
                append_ascii(&mut source, if in_star { b"" } else { star });
                has_magic = true;
            } else if unit.eq_ascii(b'?') {
                append_ascii(&mut source, QMARK);
                has_magic = true;
            } else if let Some(class) = parse_class(&glob[at..], &mut source, self.budget)? {
                has_magic |= class.has_magic;
                self.needs_unicode |= class.needs_unicode;
                at += class.consumed - 1;
            } else {
                append_regexp_escaped(&mut source, unit);
            }
            in_star = is_star;
            at += 1;
        }
        Ok((source, has_magic))
    }
}
