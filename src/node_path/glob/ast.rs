//! The class `AST` of minimatch, which makes the source of a regular expression of what is between two slashes.

use core::ops::Range;

use super::{Stop, Work, class};
use crate::{BACKSLASH, DOT, Unit, byte_at};

const NO_DOTS: &[u8] = br"(?!(?:^|/)\.\.?(?:$|/))";
pub(super) const NO_DOT: &[u8] = br"(?!\.)";
const ANY: &[u8] = b"[^/]";
const STAR: &[u8] = b"[^/]*?";
const STAR_NOT_EMPTY: &[u8] = b"[^/]+?";
const MOST_NESTED: usize = 2;
/// The `kind` of a node whose parts follow each other. That of the others is what is in front of their parenthesis.
const PLAIN: u8 = 0;
const ROOT: usize = 0;
const WORK_PER_NODE: usize = 64;

pub(super) fn append_ascii(source: &mut Vec<u16>, ascii: &[u8]) {
    source.extend(ascii.iter().map(|&byte| u16::from(byte)));
}

/// `/\s/`
fn is_space(unit: u16) -> bool {
    matches!(
        unit,
        0x9..=0xD
            | 0x20
            | 0xA0
            | 0x1680
            | 0x2000..=0x200A
            | 0x2028
            | 0x2029
            | 0x202F
            | 0x205F
            | 0x3000
            | 0xFEFF
    )
}

pub(super) fn append_escaped(source: &mut Vec<u16>, unit: u16) {
    let is_special = matches!(
        unit.byte(),
        b'#' | b'$' | b'('..=b'.' | b'?' | b'['..=b'^' | b'{'..=b'}'
    );
    if is_special || is_space(unit) {
        source.push(BACKSLASH.into());
    }
    source.push(unit);
}

fn adopts(parent: u8, child: u8) -> bool {
    matches!(
        (parent, child),
        (b'!' | b'?' | b'@' | b'*' | b'+', b'@')
            | (b'?' | b'*', b'?')
            | (b'*' | b'+', b'+')
            | (b'*', b'*')
    )
}

fn adopts_with_space(parent: u8, child: u8) -> bool {
    matches!((parent, child), (b'!' | b'@' | b'+', b'?') | (b'+', b'*'))
}

/// The kind that `parent` becomes.
fn usurps(parent: u8, child: u8) -> Option<u8> {
    match (parent, child) {
        (b'!', b'!') => Some(b'@'),
        (b'?', b'*' | b'+') | (b'+', b'?' | b'*') => Some(b'*'),
        (b'@', _) => Some(child),
        _ => None,
    }
}

#[derive(Clone)]
enum Part {
    /// A range of `Tree::text`.
    Text(Range<usize>),
    Node(usize),
}

#[derive(Clone, Copy)]
struct Node {
    kind: u8,
    is_empty: bool,
    parent: Option<usize>,
    /// How many parts the parent had when this was made.
    index: usize,
    /// An index of `Tree::parts`, which a node shares with one that it took the place of.
    parts: usize,
}

struct Tree<'w, 'a> {
    text: Vec<u16>,
    nodes: Vec<Node>,
    parts: Vec<Vec<Part>>,
    negations: Vec<usize>,
    is_unicode: bool,
    work: &'w mut Work<'a>,
}

pub(super) enum Parsed {
    Literal(Vec<u16>),
    RegExp { source: Vec<u16>, is_unicode: bool },
}

/// `AST.fromGlob(glob).toMMPattern()`
pub(super) fn parse(glob: &[u16], work: &mut Work<'_>) -> Result<Parsed, Stop> {
    let mut tree = Tree {
        text: glob.to_vec(),
        nodes: Vec::new(),
        parts: Vec::new(),
        negations: Vec::new(),
        is_unicode: false,
        work,
    };
    tree.add(PLAIN, None)?;
    tree.parse(ROOT, 0, 0)?;
    tree.flatten(ROOT)?;
    tree.fill_negations()?;
    let place = Place {
        is_start: true,
        is_end: true,
        is_negated: false,
    };
    let (mut source, has_magic) = tree.source_of(ROOT, place, false)?;
    if has_magic {
        source.insert(0, b'^'.into());
        source.push(b'$'.into());
        let is_unicode = tree.is_unicode;
        return Ok(Parsed::RegExp { source, is_unicode });
    }
    source.retain(|unit| !unit.is(BACKSLASH));
    Ok(Parsed::Literal(source))
}

/// Tells what is in brackets, as the parser takes it. That is not quite what [`class::parse`] takes.
#[derive(Default)]
struct Brackets {
    start: Option<usize>,
    is_negated: bool,
}

impl Brackets {
    /// To be called with each unit in turn.
    fn include(&mut self, unit: u8, at: usize) -> bool {
        match self.start {
            Some(start) if at == start => self.is_negated = matches!(unit, b'^' | b'!'),
            Some(start) if unit == b']' && !(at == start + 1 && self.is_negated) => {
                self.start = None;
            }
            Some(_) => {}
            None if unit == b'[' => self.start = Some(at + 1),
            None => return false,
        }
        true
    }
}

#[derive(Clone, Copy)]
struct Place {
    is_start: bool,
    is_end: bool,
    /// The parent is `!()`.
    is_negated: bool,
}

impl Tree<'_, '_> {
    fn add(&mut self, kind: u8, parent: Option<usize>) -> Result<usize, Stop> {
        self.work.spend(WORK_PER_NODE)?;
        self.nodes.push(Node {
            kind,
            is_empty: false,
            parent,
            index: parent.map_or(0, |parent| self.parts_of(parent).len()),
            parts: self.parts.len(),
        });
        self.parts.push(Vec::new());
        Ok(self.nodes.len() - 1)
    }

    fn parts_of(&self, node: usize) -> &[Part] {
        &self.parts[self.nodes[node].parts]
    }

    fn push(&mut self, node: usize, part: Part) {
        if !matches!(&part, Part::Text(text) if text.is_empty()) {
            self.parts[self.nodes[node].parts].push(part);
        }
    }

    fn make_plain(&mut self, node: usize, text: Range<usize>) {
        self.nodes[node].kind = PLAIN;
        self.nodes[node].parts = self.parts.len();
        self.parts.push(vec![Part::Text(text)]);
    }

    /// `node` is the root, or `start` is where its parenthesis opens. Answers where it ends.
    fn parse(&mut self, node: usize, start: usize, depth: usize) -> Result<usize, Stop> {
        self.work.check_stack()?;
        let kind = self.nodes[node].kind;
        let is_root = node == ROOT;
        let mut at = start + usize::from(!is_root);
        let mut part = if is_root {
            ROOT
        } else {
            self.add(PLAIN, Some(node))?
        };
        let mut finished = Vec::new();
        let mut brackets = Brackets::default();
        let mut text_start = at;
        while at < self.text.len() {
            let (text, unit) = (Part::Text(text_start..at), self.text[at].byte());
            at += 1;
            if brackets.include(unit, at - 1) {
                continue;
            }
            let is_adopted = adopts(kind, unit) || adopts_with_space(kind, unit);
            if matches!(unit, b'!' | b'?' | b'+' | b'*' | b'@')
                && byte_at(&self.text, at) == b'('
                && (depth <= MOST_NESTED || is_adopted)
            {
                self.push(part, text);
                let inner = self.add(unit, Some(part))?;
                if unit == b'!' {
                    self.negations.push(inner);
                }
                self.push(part, Part::Node(inner));
                at = self.parse(inner, at, depth + usize::from(!is_adopted))?;
            } else if unit == b'|' && !is_root {
                self.push(part, text);
                finished.push(Part::Node(part));
                part = self.add(PLAIN, Some(node))?;
            } else if unit == b')' && !is_root {
                self.nodes[node].is_empty = text_start + 1 == at;
                self.push(part, text);
                finished.push(Part::Node(part));
                self.parts[self.nodes[node].parts] = finished;
                return Ok(at);
            } else {
                continue;
            }
            text_start = at;
        }
        if is_root {
            self.push(ROOT, Part::Text(text_start..at));
        } else {
            self.make_plain(node, start - 1..at);
        }
        Ok(at)
    }

    /// The one part of `child`, if that has parentheses.
    fn only_grandchild(&self, child: usize) -> Option<usize> {
        match *self.parts_of(child) {
            [Part::Node(grandchild)] if self.nodes[grandchild].kind != PLAIN => Some(grandchild),
            _ => None,
        }
    }

    fn become_parent_of_parts(&mut self, node: usize, parts: usize) {
        for part in &self.parts[parts] {
            if let Part::Node(part) = *part {
                self.nodes[part].parent = Some(node);
            }
        }
    }

    fn flatten(&mut self, node: usize) -> Result<(), Stop> {
        self.work.check_stack()?;
        let is_plain = self.nodes[node].kind == PLAIN;
        for _ in 0..10 {
            let mut is_done = true;
            let mut index = 0;
            while let Some(part) = self.parts_of(node).get(index) {
                if let Part::Node(child) = *part {
                    self.work.spend(1)?;
                    self.flatten(child)?;
                    is_done &= is_plain || !self.take_in(node, child, index)?;
                }
                index += 1;
            }
            if is_done {
                break;
            }
        }
        Ok(())
    }

    /// Whether `node` has taken over what is in `child`, which is its part with that `index`.
    fn take_in(&mut self, node: usize, child: usize, index: usize) -> Result<bool, Stop> {
        let Some(grandchild) = self.only_grandchild(child) else {
            return Ok(false);
        };
        let (outer, inner) = (self.nodes[node], self.nodes[grandchild]);
        let needs_space = adopts_with_space(outer.kind, inner.kind);
        if adopts(outer.kind, inner.kind) || needs_space {
            if needs_space {
                let space = self.add(PLAIN, Some(grandchild))?;
                self.make_plain(space, 0..0);
                self.push(grandchild, Part::Node(space));
            }
            let adopted = self.parts[inner.parts].clone();
            self.work
                .spend(adopted.len() + self.parts[outer.parts].len())?;
            self.parts[outer.parts].splice(index..=index, adopted);
        } else if let (Some(kind), 1) = (
            usurps(outer.kind, inner.kind),
            self.parts[outer.parts].len(),
        ) {
            self.nodes[node] = Node {
                kind,
                is_empty: false,
                parts: inner.parts,
                ..outer
            };
        } else {
            return Ok(false);
        }
        self.become_parent_of_parts(node, inner.parts);
        Ok(true)
    }

    /// Appends what follows each `!()` to each of its alternatives.
    fn fill_negations(&mut self) -> Result<(), Stop> {
        while let Some(negation) = self.negations.pop() {
            if self.nodes[negation].kind != b'!' {
                continue;
            }
            let mut node = negation;
            while let Some(parent) = self.nodes[node].parent {
                self.work.spend(1)?;
                let mut index = self.nodes[node].index + 1;
                while self.nodes[parent].kind == PLAIN && index < self.parts_of(parent).len() {
                    for alternative in 0..self.parts_of(negation).len() {
                        if let Part::Node(alternative) = self.parts_of(negation)[alternative] {
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

    fn copy_in(&mut self, node: usize, part: Part) -> Result<(), Stop> {
        self.work.spend(WORK_PER_NODE)?;
        let Part::Node(original) = part else {
            self.push(node, part);
            return Ok(());
        };
        self.work.check_stack()?;
        let copy = self.add(self.nodes[original].kind, Some(node))?;
        for index in 0..self.parts_of(original).len() {
            self.copy_in(copy, self.parts_of(original)[index].clone())?;
        }
        self.push(node, Part::Node(copy));
        Ok(())
    }

    /// The source of each part of `node`, and whether that has magic.
    fn sources_of_parts(
        &mut self,
        node: usize,
        place: Place,
        allows_dot: bool,
        take: &mut dyn FnMut(Vec<u16>, bool),
    ) -> Result<(), Stop> {
        let parts = self.parts_of(node);
        let count = parts.len();
        let is_negation =
            |part: &&Part| matches!(**part, Part::Node(part) if self.nodes[part].kind == b'!');
        let leading_negations = parts.iter().take_while(is_negation).count();
        let is_all_text = parts.iter().all(|part| matches!(part, Part::Text(_)));
        let is_negated = self.nodes[node].kind == b'!';
        for index in 0..count {
            let (source, has_magic) = match self.parts_of(node)[index].clone() {
                Part::Text(text) => {
                    self.source_of_text(text, place.is_start && place.is_end && is_all_text)?
                }
                Part::Node(part) => {
                    let Node { kind, index, .. } = self.nodes[part];
                    let place = Place {
                        is_start: place.is_start && index <= leading_negations,
                        is_end: is_negated
                            || (place.is_end && (kind == PLAIN || index + 1 == count)),
                        is_negated,
                    };
                    self.source_of(part, place, allows_dot)?
                }
            };
            self.work.spend(8 + source.len())?;
            take(source, has_magic);
        }
        Ok(())
    }

    fn source_of_alternatives(
        &mut self,
        node: usize,
        place: Place,
        allows_dot: bool,
    ) -> Result<Vec<u16>, Stop> {
        let (mut body, mut is_first) = (Vec::new(), true);
        self.sources_of_parts(node, place, allows_dot, &mut |source, _| {
            if source.is_empty() && place.is_start && place.is_end {
                return;
            }
            if !is_first {
                body.push(b'|'.into());
            }
            body.extend_from_slice(&source);
            is_first = false;
        })?;
        Ok(body)
    }

    /// `toRegExpSource(allows_dot)`: the source, and whether it has magic.
    fn source_of(
        &mut self,
        node: usize,
        place: Place,
        allows_dot: bool,
    ) -> Result<(Vec<u16>, bool), Stop> {
        self.work.check_stack()?;
        let Node { kind, is_empty, .. } = self.nodes[node];
        if kind == PLAIN {
            return self.source_of_plain(node, place, allows_dot);
        }
        let body = self.source_of_alternatives(node, place, allows_dot)?;
        if place.is_start && place.is_end && body.is_empty() && kind != b'!' {
            let start = self.text.len();
            let bars = self.parts_of(node).len().saturating_sub(1);
            append_ascii(&mut self.text, &[kind, b'(']);
            self.text
                .extend(core::iter::repeat_n(u16::from(b'|'), bars));
            append_ascii(&mut self.text, b")");
            self.make_plain(node, start..self.text.len());
            return Ok((self.text[start..].to_vec(), false));
        }
        let no_dot = if place.is_start && !allows_dot {
            NO_DOT
        } else {
            b""
        };
        let mut source = Vec::with_capacity(body.len() + 32);
        if kind == b'!' && is_empty {
            append_ascii(&mut source, no_dot);
            append_ascii(&mut source, STAR_NOT_EMPTY);
        } else if kind == b'!' {
            append_ascii(&mut source, b"(?:(?!(?:");
            source.extend_from_slice(&body);
            for piece in [b"))", no_dot, STAR, b")"] {
                append_ascii(&mut source, piece);
            }
        } else {
            let mut with_dot = Vec::new();
            if matches!(kind, b'*' | b'+') && !allows_dot {
                with_dot = self.source_of_alternatives(node, place, true)?;
            }
            append_ascii(&mut source, b"(?:");
            if with_dot.is_empty() || with_dot == body {
                source.extend_from_slice(&body);
                append_ascii(&mut source, b")");
                if kind != b'@' {
                    source.push(kind.into());
                }
            } else {
                append_ascii(&mut source, b"(?:");
                source.extend_from_slice(&body);
                append_ascii(&mut source, b")(?:");
                source.extend_from_slice(&with_dot);
                append_ascii(&mut source, if kind == b'+' { b")*?)" } else { b")*?)?" });
            }
        }
        Ok((source, true))
    }

    fn source_of_plain(
        &mut self,
        node: usize,
        place: Place,
        allows_dot: bool,
    ) -> Result<(Vec<u16>, bool), Stop> {
        let (mut source, mut has_magic) = (Vec::new(), false);
        self.sources_of_parts(node, place, allows_dot, &mut |of_part, is_magic| {
            source.extend_from_slice(&of_part);
            has_magic |= is_magic;
        })?;
        if let (true, [Part::Text(first), others @ ..]) = (place.is_start, self.parts_of(node)) {
            let first = &self.text[first.clone()];
            let is_dots = matches!(first.len(), 1 | 2) && first.iter().all(|unit| unit.is(DOT));
            let has_dot_at =
                |at: usize| byte_at(&source, at) == BACKSLASH && byte_at(&source, at + 1) == DOT;
            let may_match_dot_at = |at: usize| matches!(byte_at(&source, at), b'[' | DOT);
            let start = if is_dots && others.is_empty() {
                b""
            } else if (allows_dot && may_match_dot_at(0))
                || (has_dot_at(0) && may_match_dot_at(2))
                || (has_dot_at(0) && has_dot_at(2) && may_match_dot_at(4))
            {
                NO_DOTS
            } else if !allows_dot && may_match_dot_at(0) {
                NO_DOT
            } else {
                b""
            };
            source.splice(..0, start.iter().map(|&byte| u16::from(byte)));
        }
        if place.is_negated {
            append_ascii(&mut source, br"(?:$|\/)");
        }
        Ok((source, has_magic))
    }

    /// `#parseGlob`
    fn source_of_text(
        &mut self,
        text: Range<usize>,
        is_everything: bool,
    ) -> Result<(Vec<u16>, bool), Stop> {
        let glob = &self.text[text];
        let star = if is_everything && glob.iter().all(|unit| unit.is(b'*')) {
            STAR_NOT_EMPTY
        } else {
            STAR
        };
        let (mut source, mut has_magic) = (Vec::with_capacity(glob.len() + 16), false);
        let (mut at, mut follows_star) = (0, false);
        while let Some(&unit) = glob.get(at) {
            let is_star = unit.is(b'*');
            if is_star {
                append_ascii(&mut source, if follows_star { b"" } else { star });
                has_magic = true;
            } else if unit.is(b'?') {
                append_ascii(&mut source, ANY);
                has_magic = true;
            } else if let Some(class) = class::parse(&glob[at..], &mut source, self.work)? {
                has_magic |= class.has_magic;
                self.is_unicode |= class.is_unicode;
                at += class.length - 1;
            } else {
                append_escaped(&mut source, unit);
            }
            follows_star = is_star;
            at += 1;
        }
        Ok((source, has_magic))
    }
}
