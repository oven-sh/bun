//! One name of a pattern of minimatch 10.2.6: `Minimatch.parse` and `ast.js`, written as pieces. It never sees a path.

use crate::class::{self, Read};
use crate::node::{Assertion, Node, Open, Piece, lower, nest};
use crate::segments::Part;
use crate::unit::{Text, Unit, push_utf8};
use bun_core::strings;
use std::rc::Rc;

/// `Minimatch.parse`. `pattern`: without a `/`.
pub(crate) fn part(pattern: &[u8], dot: bool) -> Part {
    if pattern == b"**" {
        return Part::GlobStar;
    }
    if pattern.is_empty() {
        return Part::Literal(Box::default());
    }
    let count = |byte: u8, text: &[u8]| text.iter().take_while(|b| **b == byte).count();
    // `[^+@!?*[(]*`
    let is_plain = |text: &[u8]| !strings::contains_any(text, b"+@!?*[(");
    let (stars, marks) = (count(b'*', pattern), count(b'?', pattern));
    let (after_stars, after_marks) = (&pattern[stars..], &pattern[marks..]);
    if stars > 0 && after_stars.is_empty() {
        return Part::Star;
    }
    if stars > 0 && is_plain(after_stars) {
        return Part::StarExt(after_stars.into());
    }
    if marks > 0 && is_plain(after_marks) {
        return Part::QuestionMarks(Text::UTF16.count_units(pattern), after_marks.into());
    }
    let is_dot_and_stars = |text: &[u8]| match text {
        [b'.', rest @ ..] => !rest.is_empty() && count(b'*', rest) == rest.len(),
        _ => false,
    };
    if stars > 0 && is_dot_and_stars(after_stars) {
        return Part::StarDotStar;
    }
    if is_dot_and_stars(pattern) {
        return Part::DotStar;
    }
    // A POSIX class that needs the flag `u` makes code points of the units of the whole name, in every class of it too.
    into_part(pattern, dot, false)
        .or_else(|| into_part(pattern, dot, true))
        .unwrap_or(Part::Never)
}

// ───────────────────────────── ast.js ─────────────────────────────

const MAX_EXTGLOB_RECURSION: usize = 2;
/// minimatch has no such limit: extglobs that could be merged with the one around them nest as deep as the pattern is long.
const MAX_OPEN_EXTGLOBS: usize = 100;
/// What `#fillNegs` may copy. `!(a)` x k in a row is 2^k.
const MAX_NODES: usize = 65_536;
/// Each `!(..)` is a lookahead later, copies counted: as many as a program may have. So reading stops where the program would.
const MAX_BANGS: usize = 1_024;
/// `!(a|a|a|..)` with 10,000 branches before 30,000 characters would be 300 MB.
const MAX_COPIED_BYTES: usize = 262_144;

fn is_extglob_type(byte: u8) -> bool {
    matches!(byte, b'!' | b'?' | b'+' | b'*' | b'@')
}

fn adoption(parent: u8) -> &'static [u8] {
    match parent {
        b'!' | b'@' => b"@",
        b'?' => b"?@",
        b'*' => b"*+?@",
        b'+' => b"+@",
        _ => b"",
    }
}

fn adoption_with_space(parent: u8) -> &'static [u8] {
    match parent {
        b'!' | b'@' => b"?",
        b'+' => b"?*",
        _ => b"",
    }
}

fn adoption_any(parent: u8) -> &'static [u8] {
    match parent {
        b'!' | b'?' | b'@' => b"?@",
        b'*' => b"*+?@",
        b'+' => b"+@?*",
        _ => b"",
    }
}

/// The type that an extglob `parent` becomes when it takes the place of its only child `child`.
fn usurped(parent: u8, child: u8) -> Option<u8> {
    match (parent, child) {
        (b'!', b'!') => Some(b'@'),
        (b'?' | b'+', b'*') | (b'?', b'+') | (b'+', b'?') => Some(b'*'),
        (b'@', child) if is_extglob_type(child) => Some(child),
        _ => None,
    }
}

fn is_dots(name: &[u8]) -> bool {
    matches!(name, b"." | b"..")
}

#[derive(Clone)]
enum Child {
    Text(Rc<[u8]>),
    Node(usize),
}

struct Ext {
    /// `!`, `?`, `+`, `*`, `@`. `None`: not an extglob.
    kind: Option<u8>,
    has_magic: Option<bool>,
    needs_u_flag: bool,
    children: Vec<Child>,
    parent: Option<usize>,
    parent_index: usize,
    is_empty_ext: bool,
}

/// What `toRegExpSource` returns.
struct Source {
    pieces: Vec<Piece>,
    has_magic: bool,
    needs_u_flag: bool,
}

/// The class `AST`: all nodes of the tree for one name. The root is at 0.
struct Ast {
    nodes: Vec<Ext>,
    negs: Vec<usize>,
    has_filled_negs: bool,
    /// How many extglobs are being parsed.
    nesting: usize,
    /// The option `dot`.
    dot: bool,
    code_points: bool,
    copied_bytes: usize,
    bangs: usize,
    is_too_big: bool,
}

fn push_bytes(pieces: &mut Vec<Piece>, bytes: &[u8]) {
    match pieces.last_mut() {
        Some(Piece::Node(Node::Lit(last))) => last.extend_from_slice(bytes),
        _ => pieces.push(Piece::Node(Node::Lit(bytes.to_vec()))),
    }
}

fn group(inner: Vec<Piece>) -> Vec<Piece> {
    let mut out = Vec::with_capacity(inner.len() + 2);
    out.push(Piece::Open(Open::Group));
    out.extend(inner);
    out.push(Piece::Close);
    out
}

fn assert(assertion: Assertion) -> Piece {
    Piece::Node(Node::Assert(assertion))
}

/// What the reference asks of a character of the expression.
#[derive(PartialEq, Eq)]
enum Written {
    /// A `.` that is a character.
    Dot,
    /// What is written with a `[` at its start: `?`, `*`, a class.
    Bracket,
    Other,
}

/// What the `n`th character of the pattern is written as, if those before it are `.`.
fn kind_at(pieces: &[Piece], n: usize) -> Written {
    let mut at = 0;
    for piece in pieces {
        match piece {
            Piece::Node(Node::Lit(bytes)) => {
                for byte in bytes {
                    if *byte != b'.' {
                        return Written::Other;
                    }
                    if at == n {
                        return Written::Dot;
                    }
                    at += 1;
                }
            }
            Piece::Node(Node::Any | Node::Star | Node::Plus) if at == n => return Written::Bracket,
            Piece::Node(Node::Class(class)) if at == n && !class.is_written_in_parens() => {
                return Written::Bracket;
            }
            _ => return Written::Other,
        }
    }
    Written::Other
}

/// `kind(||)`: an extglob that can only match nothing is written as the characters that it is, into an expression.
fn raw_extglob(kind: u8, bars: usize) -> Vec<Piece> {
    let first = match kind {
        b'@' => Piece::Node(Node::Lit(vec![b'@'])),
        _ => Piece::Quant {
            min: u8::from(kind == b'+'),
            unbounded: kind != b'?',
        },
    };
    let mut out = vec![first, Piece::Open(Open::Capture)];
    out.extend((0..bars).map(|_| Piece::Bar));
    out.push(Piece::Close);
    out
}

/// What pieces without magic are as characters: `unescape(src)`.
fn literal_of(pieces: &[Piece]) -> Box<[u8]> {
    let mut out = Vec::new();
    for piece in pieces {
        match piece {
            Piece::Node(Node::Lit(bytes)) => out.extend_from_slice(bytes),
            Piece::Open(_) => out.push(b'('),
            Piece::Close => out.push(b')'),
            Piece::Bar => out.push(b'|'),
            Piece::Quant { min: 1, .. } => out.push(b'+'),
            Piece::Quant {
                unbounded: true, ..
            } => out.push(b'*'),
            Piece::Quant { .. } => out.push(b'?'),
            Piece::Node(_) | Piece::Reference { .. } => {}
        }
    }
    out.into()
}

fn has_bar_at_top(pieces: &[Piece]) -> bool {
    let mut depth = 0_usize;
    for piece in pieces {
        match piece {
            Piece::Open(_) => depth += 1,
            Piece::Close => depth = depth.saturating_sub(1),
            Piece::Bar if depth == 0 => return true,
            _ => {}
        }
    }
    false
}

impl Ast {
    fn create(&mut self, kind: Option<u8>, parent: Option<usize>) -> usize {
        let id = self.nodes.len();
        self.bangs += usize::from(kind == Some(b'!'));
        if id >= MAX_NODES || self.bangs > MAX_BANGS {
            self.is_too_big = true;
        }
        if kind == Some(b'!') && !self.has_filled_negs {
            self.negs.push(id);
        }
        self.nodes.push(Ext {
            kind,
            has_magic: kind.map(|_| true),
            needs_u_flag: false,
            children: Vec::new(),
            parent,
            parent_index: parent.map_or(0, |it| self.nodes[it].children.len()),
            is_empty_ext: false,
        });
        id
    }

    fn push_text(&mut self, node: usize, text: &[u8]) {
        if !text.is_empty() {
            self.nodes[node].children.push(Child::Text(text.into()));
        }
    }

    fn push_node(&mut self, node: usize, child: usize) {
        self.nodes[node].children.push(Child::Node(child));
    }

    fn can_adopt_type(&self, node: usize, kind: u8, map: fn(u8) -> &'static [u8]) -> bool {
        self.nodes[node]
            .kind
            .is_some_and(|parent| strings::contains_char(map(parent), kind))
    }

    /// `#parseAST`. Recursion: at most `MAX_OPEN_EXTGLOBS` deep.
    fn parse(&mut self, text: &[u8], node: usize, pos: usize, depth: usize) -> usize {
        let (mut escaping, mut in_class, mut class_start, mut class_is_negated) =
            (false, false, usize::MAX, false);
        let is_extglob = self.nodes[node].kind.is_some();
        let mut i = if is_extglob { pos + 1 } else { pos };
        // Where what has not been pushed yet starts.
        let mut acc = i;
        let mut part = if is_extglob {
            self.create(None, Some(node))
        } else {
            node
        };
        let mut parts: Vec<usize> = Vec::new();
        while i < text.len() {
            let c = text[i];
            i += 1;
            if escaping || c == b'\\' {
                escaping = !escaping;
                continue;
            }
            if in_class {
                if i == class_start + 1 {
                    if matches!(c, b'^' | b'!') {
                        class_is_negated = true;
                    }
                } else if c == b']' && !(i == class_start + 2 && class_is_negated) {
                    in_class = false;
                }
                continue;
            }
            if c == b'[' {
                in_class = true;
                class_start = i;
                class_is_negated = false;
                continue;
            }
            let can_adopt = is_extglob && self.can_adopt_type(node, c, adoption_any);
            let is_nested = depth <= MAX_EXTGLOB_RECURSION || can_adopt;
            if is_extglob_type(c)
                && text.get(i) == Some(&b'(')
                && is_nested
                && self.nesting < MAX_OPEN_EXTGLOBS
            {
                self.push_text(part, &text[acc..i - 1]);
                let ext = self.create(Some(c), Some(part));
                self.nesting += 1;
                if is_extglob {
                    self.push_node(part, ext);
                    i = self.parse(text, ext, i, depth + usize::from(!can_adopt));
                } else {
                    i = self.parse(text, ext, i, depth + 1);
                    self.push_node(part, ext);
                }
                self.nesting -= 1;
                acc = i;
                continue;
            }
            if is_extglob && c == b'|' {
                self.push_text(part, &text[acc..i - 1]);
                acc = i;
                parts.push(part);
                part = self.create(None, Some(node));
                continue;
            }
            if is_extglob && c == b')' {
                if acc == i - 1 && self.nodes[node].children.is_empty() {
                    self.nodes[node].is_empty_ext = true;
                }
                self.push_text(part, &text[acc..i - 1]);
                parts.push(part);
                for part in parts {
                    self.push_node(node, part);
                }
                return i;
            }
        }
        if is_extglob {
            // It is not closed, so it is not an extglob.
            let node = &mut self.nodes[node];
            node.kind = None;
            node.has_magic = None;
            node.children = vec![Child::Text(text[pos - 1..].into())];
        } else {
            self.push_text(node, &text[acc..]);
        }
        i
    }

    fn copy_in(&mut self, node: usize, child: &Child) {
        if self.is_too_big {
            return;
        }
        match child {
            Child::Text(text) => {
                self.copied_bytes += text.len();
                self.is_too_big = self.copied_bytes > MAX_COPIED_BYTES;
                if !text.is_empty() {
                    self.nodes[node].children.push(child.clone());
                }
            }
            Child::Node(other) => {
                let clone = self.clone_node(*other, node);
                self.push_node(node, clone);
            }
        }
    }

    /// As deep as the tree.
    fn clone_node(&mut self, original: usize, parent: usize) -> usize {
        let clone = self.create(self.nodes[original].kind, Some(parent));
        for child in self.nodes[original].children.clone() {
            self.copy_in(clone, &child);
        }
        clone
    }

    /// What follows a `!(..)` is copied into it, because what it must not match depends on it.
    fn fill_negs(&mut self) {
        if self.has_filled_negs {
            return;
        }
        self.has_filled_negs = true;
        while !self.is_too_big
            && let Some(neg) = self.negs.pop()
        {
            if self.nodes[neg].kind != Some(b'!') {
                continue;
            }
            let mut child = neg;
            while let Some(parent) = self.nodes[child].parent {
                let mut i = self.nodes[child].parent_index + 1;
                while self.nodes[parent].kind.is_none() && i < self.nodes[parent].children.len() {
                    let following = self.nodes[parent].children[i].clone();
                    for part in self.nodes[neg].children.clone() {
                        if let Child::Node(part) = part {
                            self.copy_in(part, &following);
                        }
                    }
                    i += 1;
                }
                child = parent;
            }
        }
    }

    fn is_start(&self, mut node: usize) -> bool {
        while let Some(parent) = self.nodes[node].parent {
            let before = self.nodes[parent].children.iter();
            let is_negation =
                |it: &Child| matches!(it, Child::Node(it) if self.nodes[*it].kind == Some(b'!'));
            let index = self.nodes[node].parent_index;
            if index > self.nodes[parent].children.len() || !before.take(index).all(is_negation) {
                return false;
            }
            node = parent;
        }
        true
    }

    fn is_end(&self, mut node: usize) -> bool {
        while let Some(parent) = self.nodes[node].parent {
            if self.nodes[parent].kind == Some(b'!') {
                return true;
            }
            let is_last = self.nodes[node].parent_index + 1 == self.nodes[parent].children.len();
            if self.nodes[node].kind.is_some() && !is_last {
                return false;
            }
            node = parent;
        }
        true
    }

    /// The only child of `child`, if `child` is not an extglob and that one is.
    fn only_grandchild(&self, node: usize, child: usize) -> Option<usize> {
        self.nodes[node].kind?;
        match (&self.nodes[child].kind, &self.nodes[child].children[..]) {
            (None, [Child::Node(grandchild)]) if self.nodes[*grandchild].kind.is_some() => {
                Some(*grandchild)
            }
            _ => None,
        }
    }

    /// The children of `grandchild`, which now belong to `node`.
    fn taken_from(&mut self, grandchild: usize, node: usize) -> Vec<Child> {
        let children = self.nodes[grandchild].children.clone();
        for child in &children {
            if let Child::Node(it) = child {
                self.nodes[*it].parent = Some(node);
            }
        }
        children
    }

    /// `#flatten`. As deep as the tree. A round writes the list anew: the `splice` of the reference is quadratic.
    fn flatten(&mut self, node: usize) {
        if self.nodes[node].kind.is_none() {
            for child in self.nodes[node].children.clone() {
                if let Child::Node(child) = child {
                    self.flatten(child);
                }
            }
            return;
        }
        for _ in 0..10 {
            let mut is_done = true;
            // What the loop has passed, and what it has not come to, the next one last.
            let mut done: Vec<Child> = Vec::new();
            let mut ahead = self.nodes[node].children.clone();
            ahead.reverse();
            while let Some(child) = ahead.pop() {
                let grandchild = match child {
                    Child::Node(child) => {
                        self.flatten(child);
                        self.only_grandchild(node, child)
                    }
                    Child::Text(_) => None,
                };
                let Some(grandchild) = grandchild else {
                    done.push(child);
                    continue;
                };
                let kind = self.nodes[grandchild].kind.unwrap_or_default();
                let parent_kind = self.nodes[node].kind.unwrap_or_default();
                let is_adopted = if self.can_adopt_type(node, kind, adoption) {
                    true
                } else if self.can_adopt_type(node, kind, adoption_with_space) {
                    let blank = self.create(None, Some(grandchild));
                    self.nodes[blank].children.push(Child::Text(Rc::default()));
                    self.push_node(grandchild, blank);
                    true
                } else if done.is_empty()
                    && ahead.is_empty()
                    && let Some(new_kind) = usurped(parent_kind, kind)
                {
                    let node = &mut self.nodes[node];
                    node.kind = Some(new_kind);
                    node.is_empty_ext = false;
                    true
                } else {
                    false
                };
                if !is_adopted {
                    done.push(child);
                    continue;
                }
                // The children of `grandchild` take the place of the one that the loop is at.
                is_done = false;
                let mut adopted = self.taken_from(grandchild, node).into_iter();
                done.extend(adopted.next());
                ahead.extend(adopted.rev());
            }
            self.nodes[node].children = done;
            if is_done {
                break;
            }
        }
    }

    /// `#parseGlob`
    fn parse_glob(&self, glob: &[u8], mut has_magic: bool, no_empty: bool) -> Source {
        let (mut escaping, mut in_star, mut needs_u_flag) = (false, false, false);
        let mut re: Vec<Piece> = Vec::new();
        let is_only_stars = glob.iter().all(|b| *b == b'*');
        // Looked for at the first `[`.
        let mut last_close: Option<Option<usize>> = None;
        let mut i = 0;
        while let Some(&c) = glob.get(i) {
            i += 1;
            if escaping {
                escaping = false;
                // The reference escapes `().*{}+?[]^$\!` here and forgets the `|`, which then divides the group that it lands in.
                match c {
                    b'|' => re.push(Piece::Bar),
                    _ => push_bytes(&mut re, &[c]),
                }
                continue;
            }
            if c == b'*' {
                if !in_star {
                    in_star = true;
                    re.push(Piece::Node(match no_empty && is_only_stars {
                        true => Node::Plus,
                        false => Node::Star,
                    }));
                    has_magic = true;
                }
                continue;
            }
            in_star = false;
            match c {
                b'\\' if i < glob.len() => escaping = true,
                b'?' => {
                    re.push(Piece::Node(Node::Any));
                    has_magic = true;
                }
                b'[' if !class::minimatch_can_close(
                    glob,
                    i - 1,
                    *last_close.get_or_insert_with(|| class::minimatch_last_close(glob)),
                ) =>
                {
                    push_bytes(&mut re, b"[");
                }
                b'[' => match class::minimatch(glob, i - 1, self.code_points) {
                    Read::NotAClass => push_bytes(&mut re, b"["),
                    Read::Never => {
                        re.push(Piece::Node(Node::Fail));
                        has_magic = true;
                        i = glob.len();
                    }
                    Read::One { unit, len } => {
                        let mut bytes = Vec::with_capacity(3);
                        push_utf8(&mut bytes, unit);
                        push_bytes(&mut re, &bytes);
                        i += len - 1;
                    }
                    Read::Class {
                        class,
                        len,
                        needs_code_points,
                    } => {
                        re.push(Piece::Node(Node::Class(class)));
                        needs_u_flag |= needs_code_points;
                        has_magic = true;
                        i += len - 1;
                    }
                },
                _ => push_bytes(&mut re, &[c]),
            }
        }
        Source {
            pieces: re,
            has_magic,
            needs_u_flag,
        }
    }

    /// `#partsToRegExp`
    fn children_to_regexp(&mut self, node: usize, dot: bool) -> Vec<Piece> {
        let mut sources: Vec<Vec<Piece>> = Vec::new();
        for child in self.nodes[node].children.clone() {
            if let Child::Node(child) = child {
                let source = self.to_regexp_source(child, Some(dot));
                self.nodes[node].needs_u_flag |= source.needs_u_flag;
                sources.push(source.pieces);
            }
        }
        if self.is_start(node) && self.is_end(node) {
            sources.retain(|it| !it.is_empty());
        }
        let mut out = Vec::new();
        for (i, source) in sources.into_iter().enumerate() {
            if i > 0 {
                out.push(Piece::Bar);
            }
            out.extend(source);
        }
        out
    }

    /// `toRegExpSource`. As deep as the tree.
    fn to_regexp_source(&mut self, node: usize, allow_dot: Option<bool>) -> Source {
        let dot = allow_dot.unwrap_or(self.dot);
        if node == 0 {
            self.flatten(0);
            self.fill_negs();
        }
        if self.is_too_big {
            return Source {
                pieces: vec![Piece::Node(Node::Fail)],
                has_magic: true,
                needs_u_flag: false,
            };
        }
        let Some(kind) = self.nodes[node].kind else {
            return self.text_to_regexp_source(node, allow_dot, dot);
        };
        let is_repeated = matches!(kind, b'*' | b'+');
        let mut body = self.children_to_regexp(node, dot);
        if self.is_start(node) && self.is_end(node) && body.is_empty() && kind != b'!' {
            let it = &mut self.nodes[node];
            let bars = it.children.len().saturating_sub(1);
            let written = [&[kind, b'('][..], &vec![b'|'; bars], b")"].concat();
            it.children = vec![Child::Text(written.into())];
            it.kind = None;
            it.has_magic = None;
            return Source {
                pieces: raw_extglob(kind, bars),
                has_magic: false,
                needs_u_flag: false,
            };
        }
        let mut body_dot_allowed = match !is_repeated || allow_dot == Some(true) || dot {
            true => Vec::new(),
            false => self.children_to_regexp(node, true),
        };
        if body_dot_allowed == body {
            body_dot_allowed.clear();
        }
        let has_two_bodies = !body_dot_allowed.is_empty();
        if has_two_bodies {
            body = group(body);
            body.extend(group(body_dot_allowed));
            body.push(Piece::Quant {
                min: 0,
                unbounded: true,
            });
        }
        let no_dot = self.is_start(node) && !dot;
        let mut pieces = Vec::with_capacity(body.len() + 8);
        if kind == b'!' && self.nodes[node].is_empty_ext {
            pieces.extend(no_dot.then(|| assert(Assertion::NotDot)));
            pieces.push(Piece::Node(Node::Plus));
        } else if kind == b'!' {
            // `(?:(?!(?:` body `))[^/]*?)`
            pieces.extend([Piece::Open(Open::Group), Piece::Open(Open::NotLook)]);
            pieces.extend(group(body));
            pieces.push(Piece::Close);
            pieces.extend((no_dot && allow_dot != Some(true)).then(|| assert(Assertion::NotDot)));
            pieces.extend([Piece::Node(Node::Star), Piece::Close]);
        } else {
            pieces = group(body);
            pieces.extend(
                match (kind, has_two_bodies) {
                    (b'?', _) | (b'*', true) => Some((0, false)),
                    (b'+', false) => Some((1, true)),
                    (b'*', false) => Some((0, true)),
                    _ => None,
                }
                .map(|(min, unbounded)| Piece::Quant { min, unbounded }),
            );
        }
        let it = &mut self.nodes[node];
        it.has_magic = Some(it.has_magic == Some(true));
        Source {
            pieces,
            has_magic: it.has_magic == Some(true),
            needs_u_flag: it.needs_u_flag,
        }
    }

    /// `toRegExpSource` of what is not an extglob.
    fn text_to_regexp_source(&mut self, node: usize, allow_dot: Option<bool>, dot: bool) -> Source {
        let children = self.nodes[node].children.clone();
        let no_empty = self.is_start(node)
            && self.is_end(node)
            && children.iter().all(|it| matches!(it, Child::Text(_)));
        let mut src: Vec<Piece> = Vec::new();
        for child in &children {
            let source = match child {
                Child::Text(text) => {
                    self.parse_glob(text, self.nodes[node].has_magic == Some(true), no_empty)
                }
                Child::Node(child) => self.to_regexp_source(*child, allow_dot),
            };
            let it = &mut self.nodes[node];
            it.has_magic = Some(it.has_magic == Some(true) || source.has_magic);
            it.needs_u_flag |= source.needs_u_flag;
            src.extend(source.pieces);
        }
        let mut out = Vec::with_capacity(src.len() + 2);
        if self.is_start(node)
            && let [Child::Text(first), rest @ ..] = &children[..]
            && !(rest.is_empty() && is_dots(first))
        {
            let kinds = [0, 1, 2].map(|n| kind_at(&src, n));
            let starts_with_bracket = kinds[0] == Written::Bracket;
            let needs_no_traversal = dot && starts_with_bracket
                || matches!(
                    kinds,
                    [Written::Dot, Written::Bracket, _]
                        | [Written::Dot, Written::Dot, Written::Bracket]
                );
            if needs_no_traversal {
                out.push(assert(Assertion::NotDotsBehindStart));
            } else if !dot && allow_dot != Some(true) && starts_with_bracket {
                out.push(assert(Assertion::NotDot));
            }
        }
        out.extend(src);
        let is_in_negation =
            (self.nodes[node].parent).is_some_and(|it| self.nodes[it].kind == Some(b'!'));
        if self.is_end(node) && self.has_filled_negs && is_in_negation {
            out.push(assert(Assertion::EndOrSlash));
        }
        let it = &mut self.nodes[node];
        it.has_magic = Some(it.has_magic == Some(true));
        Source {
            pieces: out,
            has_magic: it.has_magic == Some(true),
            needs_u_flag: it.needs_u_flag,
        }
    }
}

/// `AST.fromGlob(pattern).toMMPattern()`. `None`: it has to be read again, with `code_points`.
fn into_part(pattern: &[u8], dot: bool, code_points: bool) -> Option<Part> {
    let mut ast = Ast {
        nodes: Vec::new(),
        negs: Vec::new(),
        has_filled_negs: false,
        nesting: 0,
        dot,
        code_points,
        copied_bytes: 0,
        bangs: 0,
        is_too_big: false,
    };
    let root = ast.create(None, None);
    ast.parse(pattern, root, 0, 0);
    let source = ast.to_regexp_source(root, None);
    if !source.has_magic && ast.nodes[root].has_magic != Some(true) {
        return Some(Part::Literal(literal_of(&source.pieces)));
    }
    if source.needs_u_flag && !code_points {
        return None;
    }
    // `^` .. `$`. An escaped `|` divides even that: before it the end is free, behind it the start.
    let floats = has_bar_at_top(&source.pieces);
    let mut pieces = Vec::with_capacity(source.pieces.len() + 2);
    pieces.push(assert(Assertion::Start));
    pieces.extend(source.pieces);
    pieces.push(assert(Assertion::End));
    // No expression: the reference throws.
    let Some(tree) = nest(pieces) else {
        return Some(Part::Never);
    };
    let whole = match floats {
        true => Node::Seq(vec![
            Node::repeat(Node::Dot { newlines: true }, 0, true),
            tree,
        ]),
        false => tree,
    };
    let unit = match code_points {
        true => Unit::CodePoint,
        false => Unit::Utf16,
    };
    let program = lower(whole, Text { unit, folds: false });
    Some(match program.is_never() {
        true => Part::Never,
        false => Part::Name(program),
    })
}
