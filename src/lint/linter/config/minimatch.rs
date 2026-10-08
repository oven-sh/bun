//! The `minimatch` package, version 10, as `@eslint/config-array` uses it: `{ dot: true }` on paths
//! that are separated by `/`.
//!
//! A pattern is split at its slashes. The common parts (a name, `*`, `*.js`, `**`) are tested
//! directly, and so are those of characters, `?`, `*` and classes. Only one with an extglob or a POSIX
//! class becomes the same regular expression as in `minimatch`.

use super::brace_expansion;
use super::glob_part::{self, GlobPart};
use crate::linter::space::{char_len, space_len};
use crate::regex::Regex;
use crate::source::utf16_len;
use bun_core::strings;
use smallvec::SmallVec;

// ───────────────────────────── a part of a pattern ─────────────────────────────

enum Part {
    /// `**`
    GlobStar,
    /// Without magic.
    Literal(Vec<u8>),
    /// `*`
    Star,
    /// `*.js`: what follows the stars.
    StarExt(Vec<u8>),
    /// `??`, `??.js`: the length of all of it in UTF-16 code units, and what follows the question
    /// marks.
    QuestionMarks(u32, Vec<u8>),
    /// `*.*`
    StarDotStar,
    /// `.*`
    DotStar,
    /// Characters, `?`, `*` and classes.
    Glob(GlobPart),
    Regex(Box<Regex>),
    /// It can match nothing, or the regular expression is invalid.
    Never,
}

fn is_dots(name: &[u8]) -> bool {
    matches!(name, b"." | b"..")
}

impl Part {
    fn test(&self, name: &[u8]) -> bool {
        match self {
            Part::GlobStar | Part::Never => false,
            Part::Literal(literal) => name == &literal[..],
            Part::Star => !name.is_empty() && !is_dots(name),
            Part::StarExt(ext) => name.ends_with(ext),
            Part::QuestionMarks(len, ext) => {
                utf16_len(name) == *len && !is_dots(name) && name.ends_with(ext)
            }
            Part::StarDotStar => !is_dots(name) && strings::contains_char(name, b'.'),
            Part::DotStar => !is_dots(name) && name.starts_with(b"."),
            Part::Glob(glob) => glob.test(name),
            Part::Regex(regex) => regex.test(name),
        }
    }

    /// `Minimatch.parse`
    fn parse(pattern: &[u8]) -> Part {
        if pattern == b"**" {
            return Part::GlobStar;
        }
        if pattern.is_empty() {
            return Part::Literal(Vec::new());
        }
        let count = |byte: u8, text: &[u8]| text.iter().take_while(|b| **b == byte).count();
        // `[^+@!?*[(]*`
        let is_plain = |text: &[u8]| !strings::contains_any(text, b"+@!?*[(");
        let (stars, marks) = (count(b'*', pattern), count(b'?', pattern));
        let after_stars = &pattern[stars..];
        if stars > 0 && after_stars.is_empty() {
            return Part::Star;
        }
        if stars > 0 && is_plain(after_stars) {
            return Part::StarExt(after_stars.to_vec());
        }
        if marks > 0 && is_plain(&pattern[marks..]) {
            return Part::QuestionMarks(utf16_len(pattern), pattern[marks..].to_vec());
        }
        if stars > 0
            && after_stars[0] == b'.'
            && after_stars.len() > 1
            && count(b'*', &after_stars[1..]) == after_stars.len() - 1
        {
            return Part::StarDotStar;
        }
        if pattern[0] == b'.'
            && pattern.len() > 1
            && count(b'*', &pattern[1..]) == pattern.len() - 1
        {
            return Part::DotStar;
        }
        // Without a parenthesis there is no extglob.
        if !strings::contains_char(pattern, b'(') {
            match glob_part::parse(pattern) {
                glob_part::Parsed::Literal(literal) => return Part::Literal(literal),
                glob_part::Parsed::Glob(glob) => return Part::Glob(glob),
                glob_part::Parsed::Never => return Part::Never,
                glob_part::Parsed::Unsupported => {}
            }
        }
        Ast::from_glob(pattern).into_part()
    }
}

// ───────────────────────────── ast.js ─────────────────────────────

const START_NO_TRAVERSAL: &[u8] = b"(?!(?:^|/)\\.\\.?(?:$|/))";
const START_NO_DOT: &[u8] = b"(?!\\.)";
const QMARK: &[u8] = b"[^/]";
const STAR: &[u8] = b"[^/]*?";
const STAR_NO_EMPTY: &[u8] = b"[^/]+?";
const MAX_EXTGLOB_RECURSION: usize = 2;
/// `minimatch` has no such limit: extglobs that can be merged with the one around them nest as deep
/// as the pattern is long.
const MAX_NESTING: usize = 128;

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

/// `s.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")`
fn push_regexp_escaped(out: &mut Vec<u8>, text: &[u8]) {
    let mut at = 0;
    while at < text.len() {
        let len = char_len(&text[at..]);
        let is_special = matches!(
            text[at],
            b'-' | b'['
                | b']'
                | b'{'
                | b'}'
                | b'('
                | b')'
                | b'*'
                | b'+'
                | b'?'
                | b'.'
                | b','
                | b'\\'
                | b'^'
                | b'$'
                | b'|'
                | b'#'
        );
        if is_special || space_len(&text[at..]) > 0 {
            out.push(b'\\');
        }
        out.extend_from_slice(&text[at..at + len]);
        at += len;
    }
}

fn is_line_terminator(text: &[u8]) -> bool {
    matches!(text, [b'\n' | b'\r', ..] | [0xE2, 0x80, 0xA8 | 0xA9, ..])
}

/// `unescape(s)`
fn unescape(text: &[u8]) -> Vec<u8> {
    // The length of `[x]` at the start of `text`, where `x` is one UTF-16 code unit other than a
    // slash and a backslash.
    let bracketed = |text: &[u8]| -> Option<usize> {
        let inner = text.strip_prefix(b"[")?;
        let len = char_len(inner.get(..1).map(|_| inner)?);
        (len < 4 && !matches!(inner[0], b'/' | b'\\') && inner.get(len) == Some(&b']'))
            .then_some(len + 2)
    };
    // `.replace(/((?!\\).|^)\[([^/\\])\]/g, "$1$2")`
    let mut first = Vec::with_capacity(text.len());
    let mut at = 0;
    while at < text.len() {
        let len = char_len(&text[at..]);
        if text[at] != b'\\'
            && !is_line_terminator(&text[at..])
            && let Some(brackets) = bracketed(&text[at + len..])
        {
            first.extend_from_slice(&text[at..at + len]);
            first.extend_from_slice(&text[at + len + 1..at + len + brackets - 1]);
            at += len + brackets;
        } else if at == 0
            && let Some(brackets) = bracketed(text)
        {
            first.extend_from_slice(&text[1..brackets - 1]);
            at = brackets;
        } else {
            first.extend_from_slice(&text[at..at + len]);
            at += len;
        }
    }
    // `.replace(/\\([^/])/g, "$1")`
    let mut out = Vec::with_capacity(first.len());
    let mut at = 0;
    while at < first.len() {
        if first[at] == b'\\' && first.get(at + 1).is_some_and(|next| *next != b'/') {
            at += 1;
        }
        out.push(first[at]);
        at += 1;
    }
    out
}

const POSIX_CLASSES: [(&[u8], &[u8], bool, bool); 14] = [
    (b"[:alnum:]", b"\\p{L}\\p{Nl}\\p{Nd}", true, false),
    (b"[:alpha:]", b"\\p{L}\\p{Nl}", true, false),
    (b"[:ascii:]", b"\\x00-\\x7f", false, false),
    (b"[:blank:]", b"\\p{Zs}\\t", true, false),
    (b"[:cntrl:]", b"\\p{Cc}", true, false),
    (b"[:digit:]", b"\\p{Nd}", true, false),
    (b"[:graph:]", b"\\p{Z}\\p{C}", true, true),
    (b"[:lower:]", b"\\p{Ll}", true, false),
    (b"[:print:]", b"\\p{C}", true, false),
    (b"[:punct:]", b"\\p{P}", true, false),
    (b"[:space:]", b"\\p{Z}\\t\\r\\n\\v\\f", true, false),
    (b"[:upper:]", b"\\p{Lu}", true, false),
    (b"[:word:]", b"\\p{L}\\p{Nl}\\p{Nd}\\p{Pc}", true, false),
    (b"[:xdigit:]", b"A-Fa-f0-9", false, false),
];

/// What `parseClass` returns.
struct Class {
    source: Vec<u8>,
    needs_u_flag: bool,
    /// 0: it is not a class.
    consumed: usize,
    is_magic: bool,
}

/// `s.replace(/[[\]\\-]/g, "\\$&")`
fn brace_escaped(text: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(text.len() + 1);
    for &byte in text {
        if matches!(byte, b'[' | b']' | b'\\' | b'-') {
            out.push(b'\\');
        }
        out.push(byte);
    }
    out
}

/// `parseClass(glob, 0)`: `glob` starts with `[`.
fn parse_class(glob: &[u8]) -> Class {
    let poisoned = || Class {
        source: b"$.".to_vec(),
        needs_u_flag: false,
        consumed: glob.len(),
        is_magic: true,
    };
    let (mut ranges, mut negs): (Vec<Vec<u8>>, Vec<&[u8]>) = (Vec::new(), Vec::new());
    let (mut saw_start, mut needs_u_flag, mut escaping, mut negate) = (false, false, false, false);
    let mut range_start: &[u8] = b"";
    let (mut i, mut end) = (1, 0);
    'chars: while i < glob.len() {
        let c = &glob[i..i + char_len(&glob[i..])];
        if matches!(c, b"!" | b"^") && i == 1 {
            negate = true;
            i += 1;
            continue;
        }
        if c == b"]" && saw_start && !escaping {
            end = i + 1;
            break;
        }
        saw_start = true;
        if c == b"\\" && !escaping {
            escaping = true;
            i += 1;
            continue;
        }
        if c == b"[" && !escaping {
            for (class, source, u, is_negated) in POSIX_CLASSES {
                if glob[i..].starts_with(class) {
                    if !range_start.is_empty() {
                        return poisoned();
                    }
                    i += class.len();
                    match is_negated {
                        true => negs.push(source),
                        false => ranges.push(source.to_vec()),
                    }
                    needs_u_flag |= u;
                    continue 'chars;
                }
            }
        }
        escaping = false;
        if !range_start.is_empty() {
            // UTF-8 sorts as code points do.
            if c > range_start {
                ranges.push([&brace_escaped(range_start)[..], b"-", &brace_escaped(c)].concat());
            } else if c == range_start {
                ranges.push(brace_escaped(c));
            }
            range_start = b"";
            i += c.len();
            continue;
        }
        let after = &glob[i + c.len()..];
        if after.starts_with(b"-]") {
            ranges.push(brace_escaped(&[c, b"-"].concat()));
            i += c.len() + 1;
            continue;
        }
        if after.starts_with(b"-") {
            range_start = c;
            i += c.len() + 1;
            continue;
        }
        ranges.push(brace_escaped(c));
        i += c.len();
    }
    if end < i {
        return Class {
            source: Vec::new(),
            needs_u_flag: false,
            consumed: 0,
            is_magic: false,
        };
    }
    if ranges.is_empty() && negs.is_empty() {
        return poisoned();
    }
    // A class of one character is that character.
    if negs.is_empty()
        && !negate
        && let [only] = &ranges[..]
    {
        let character = only
            .strip_prefix(b"\\")
            .filter(|it| !it.is_empty())
            .unwrap_or(only);
        if char_len(character) == character.len()
            && character.len() < 4
            && !is_line_terminator(character)
        {
            let mut source = Vec::new();
            push_regexp_escaped(&mut source, character);
            return Class {
                source,
                needs_u_flag: false,
                consumed: end,
                is_magic: false,
            };
        }
    }
    let positive = [
        if negate { &b"[^"[..] } else { b"[" },
        &ranges.concat(),
        b"]",
    ]
    .concat();
    let negative = [if negate { &b"["[..] } else { b"[^" }, &negs.concat(), b"]"].concat();
    Class {
        source: match (ranges.is_empty(), negs.is_empty()) {
            (false, false) => [b"(", &positive[..], b"|", &negative, b")"].concat(),
            (false, true) => positive,
            _ => negative,
        },
        needs_u_flag,
        consumed: end,
        is_magic: true,
    }
}

#[derive(Clone)]
enum Piece {
    Text(Vec<u8>),
    Node(usize),
}

struct Node {
    /// `!`, `?`, `+`, `*`, `@`. `None`: not an extglob.
    kind: Option<u8>,
    has_magic: Option<bool>,
    needs_u_flag: bool,
    pieces: Vec<Piece>,
    parent: Option<usize>,
    parent_index: usize,
    written: Option<Vec<u8>>,
    is_empty_ext: bool,
}

/// What `toRegExpSource` returns.
struct Source {
    regexp: Vec<u8>,
    body: Vec<u8>,
    has_magic: bool,
    needs_u_flag: bool,
}

/// The class `AST`: all nodes of the tree for one part of a pattern. The root is at 0.
struct Ast {
    nodes: Vec<Node>,
    negs: Vec<usize>,
    has_filled_negs: bool,
    /// How many extglobs are being parsed.
    nesting: usize,
}

impl Ast {
    fn create(&mut self, kind: Option<u8>, parent: Option<usize>) -> usize {
        let id = self.nodes.len();
        if kind == Some(b'!') && !self.has_filled_negs {
            self.negs.push(id);
        }
        self.nodes.push(Node {
            kind,
            has_magic: kind.map(|_| true),
            needs_u_flag: false,
            pieces: Vec::new(),
            parent,
            parent_index: parent.map_or(0, |it| self.nodes[it].pieces.len()),
            written: None,
            is_empty_ext: false,
        });
        id
    }

    fn push_text(&mut self, node: usize, text: Vec<u8>) {
        if !text.is_empty() {
            self.nodes[node].pieces.push(Piece::Text(text));
        }
    }

    fn push_node(&mut self, node: usize, child: usize) {
        self.nodes[node].pieces.push(Piece::Node(child));
    }

    fn from_glob(pattern: &[u8]) -> Ast {
        let mut ast = Ast {
            nodes: Vec::new(),
            negs: Vec::new(),
            has_filled_negs: false,
            nesting: 0,
        };
        let root = ast.create(None, None);
        ast.parse(pattern, root, 0, 0);
        ast
    }

    fn can_adopt_type(&self, node: usize, kind: u8, map: fn(u8) -> &'static [u8]) -> bool {
        self.nodes[node]
            .kind
            .is_some_and(|parent| strings::contains_char(map(parent), kind))
    }

    /// `#parseAST`
    fn parse(&mut self, text: &[u8], node: usize, pos: usize, depth: usize) -> usize {
        let (mut escaping, mut in_class, mut class_start, mut class_is_negated) =
            (false, false, usize::MAX, false);
        let is_extglob = self.nodes[node].kind.is_some();
        let mut i = if is_extglob { pos + 1 } else { pos };
        let mut acc: Vec<u8> = Vec::new();
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
                acc.push(c);
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
                acc.push(c);
                continue;
            }
            if c == b'[' {
                in_class = true;
                class_start = i;
                class_is_negated = false;
                acc.push(c);
                continue;
            }
            let can_adopt = is_extglob && self.can_adopt_type(node, c, adoption_any);
            let is_nested = depth <= MAX_EXTGLOB_RECURSION || can_adopt;
            if is_extglob_type(c)
                && text.get(i) == Some(&b'(')
                && is_nested
                && self.nesting < MAX_NESTING
            {
                self.push_text(part, std::mem::take(&mut acc));
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
                continue;
            }
            if is_extglob && c == b'|' {
                self.push_text(part, std::mem::take(&mut acc));
                parts.push(part);
                part = self.create(None, Some(node));
                continue;
            }
            if is_extglob && c == b')' {
                if acc.is_empty() && self.nodes[node].pieces.is_empty() {
                    self.nodes[node].is_empty_ext = true;
                }
                self.push_text(part, acc);
                parts.push(part);
                for part in parts {
                    self.push_node(node, part);
                }
                return i;
            }
            acc.push(c);
        }
        if is_extglob {
            // It is not closed, so it is not an extglob.
            let node = &mut self.nodes[node];
            node.kind = None;
            node.has_magic = None;
            node.pieces = vec![Piece::Text(text[pos - 1..].to_vec())];
        } else {
            self.push_text(node, acc);
        }
        i
    }

    fn written(&mut self, node: usize) -> Vec<u8> {
        if let Some(written) = &self.nodes[node].written {
            return written.clone();
        }
        let pieces = self.nodes[node].pieces.clone();
        let written: Vec<Vec<u8>> = (pieces.into_iter())
            .map(|piece| match piece {
                Piece::Text(text) => text,
                Piece::Node(child) => self.written(child),
            })
            .collect();
        let written = match self.nodes[node].kind {
            None => written.concat(),
            Some(kind) => [&[kind, b'('][..], &written.join(&b'|'), b")"].concat(),
        };
        self.nodes[node].written = Some(written.clone());
        written
    }

    fn copy_in(&mut self, node: usize, piece: &Piece) {
        match piece {
            Piece::Text(text) => self.push_text(node, text.clone()),
            Piece::Node(other) => {
                let clone = self.clone_node(*other, node);
                self.push_node(node, clone);
            }
        }
    }

    fn clone_node(&mut self, node: usize, parent: usize) -> usize {
        let clone = self.create(self.nodes[node].kind, Some(parent));
        for piece in self.nodes[node].pieces.clone() {
            self.copy_in(clone, &piece);
        }
        clone
    }

    /// What follows a `!(..)` is copied into it, because what it must not match depends on it.
    fn fill_negs(&mut self) {
        if self.has_filled_negs {
            return;
        }
        self.written(0);
        self.has_filled_negs = true;
        while let Some(neg) = self.negs.pop() {
            if self.nodes[neg].kind != Some(b'!') {
                continue;
            }
            let mut child = neg;
            while let Some(parent) = self.nodes[child].parent {
                let mut i = self.nodes[child].parent_index + 1;
                while self.nodes[parent].kind.is_none() && i < self.nodes[parent].pieces.len() {
                    let piece = self.nodes[parent].pieces[i].clone();
                    for part in self.nodes[neg].pieces.clone() {
                        if let Piece::Node(part) = part {
                            self.copy_in(part, &piece);
                        }
                    }
                    i += 1;
                }
                child = parent;
            }
        }
    }

    fn is_start(&self, node: usize) -> bool {
        let Some(parent) = self.nodes[node].parent else {
            return true;
        };
        if !self.is_start(parent) {
            return false;
        }
        (0..self.nodes[node].parent_index).all(|i| {
            matches!(self.nodes[parent].pieces.get(i), Some(Piece::Node(it)) if self.nodes[*it].kind == Some(b'!'))
        })
    }

    fn is_end(&self, node: usize) -> bool {
        let Some(parent) = self.nodes[node].parent else {
            return true;
        };
        if self.nodes[parent].kind == Some(b'!') {
            return true;
        }
        if !self.is_end(parent) {
            return false;
        }
        self.nodes[node].kind.is_none()
            || self.nodes[node].parent_index + 1 == self.nodes[parent].pieces.len()
    }

    /// The only piece of `child`, if `child` is not an extglob and that piece is one.
    fn only_grandchild(&self, node: usize, child: &Piece) -> Option<usize> {
        let Piece::Node(child) = child else {
            return None;
        };
        self.nodes[node].kind?;
        match (&self.nodes[*child].kind, &self.nodes[*child].pieces[..]) {
            (None, [Piece::Node(grandchild)]) if self.nodes[*grandchild].kind.is_some() => {
                Some(*grandchild)
            }
            _ => None,
        }
    }

    fn adopt(&mut self, node: usize, grandchild: usize, index: usize) {
        let pieces = self.nodes[grandchild].pieces.clone();
        for piece in &pieces {
            if let Piece::Node(it) = piece {
                self.nodes[*it].parent = Some(node);
            }
        }
        self.nodes[node].pieces.splice(index..=index, pieces);
        self.nodes[node].written = None;
    }

    /// `#flatten`
    fn flatten(&mut self, node: usize) {
        if self.nodes[node].kind.is_none() {
            for piece in self.nodes[node].pieces.clone() {
                if let Piece::Node(child) = piece {
                    self.flatten(child);
                }
            }
        } else {
            for _ in 0..10 {
                let mut is_done = true;
                let mut i = 0;
                while let Some(piece) = self.nodes[node].pieces.get(i).cloned() {
                    i += 1;
                    let Piece::Node(child) = piece else {
                        continue;
                    };
                    self.flatten(child);
                    let Some(grandchild) = self.only_grandchild(node, &piece) else {
                        continue;
                    };
                    let kind = self.nodes[grandchild].kind.unwrap_or_default();
                    if self.can_adopt_type(node, kind, adoption) {
                        is_done = false;
                        self.adopt(node, grandchild, i - 1);
                    } else if self.can_adopt_type(node, kind, adoption_with_space) {
                        is_done = false;
                        let blank = self.create(None, Some(grandchild));
                        self.nodes[blank].pieces.push(Piece::Text(Vec::new()));
                        self.push_node(grandchild, blank);
                        self.adopt(node, grandchild, i - 1);
                    } else if self.nodes[node].pieces.len() == 1
                        && let Some(new_kind) =
                            self.nodes[node].kind.and_then(|it| usurped(it, kind))
                    {
                        is_done = false;
                        let pieces = self.nodes[grandchild].pieces.clone();
                        for piece in &pieces {
                            if let Piece::Node(it) = piece {
                                self.nodes[*it].parent = Some(node);
                            }
                        }
                        let node = &mut self.nodes[node];
                        node.pieces = pieces;
                        node.kind = Some(new_kind);
                        node.written = None;
                        node.is_empty_ext = false;
                    }
                }
                if is_done {
                    break;
                }
            }
        }
        self.nodes[node].written = None;
    }

    /// `#parseGlob`
    fn parse_glob(glob: &[u8], mut has_magic: bool, no_empty: bool) -> Source {
        let (mut escaping, mut in_star, mut needs_u_flag) = (false, false, false);
        let mut re = Vec::with_capacity(glob.len() * 2);
        let is_only_stars = glob.iter().all(|b| *b == b'*');
        let mut i = 0;
        while i < glob.len() {
            let len = char_len(&glob[i..]);
            let c = &glob[i..i + len];
            i += len;
            if escaping {
                escaping = false;
                if strings::contains_char(b"().*{}+?[]^$\\!", c[0]) {
                    re.push(b'\\');
                }
                re.extend_from_slice(c);
                continue;
            }
            if c == b"*" {
                if !in_star {
                    in_star = true;
                    re.extend_from_slice(if no_empty && is_only_stars {
                        STAR_NO_EMPTY
                    } else {
                        STAR
                    });
                    has_magic = true;
                }
                continue;
            }
            in_star = false;
            if c == b"\\" {
                match i == glob.len() {
                    true => re.extend_from_slice(b"\\\\"),
                    false => escaping = true,
                }
                continue;
            }
            if c == b"[" {
                let class = parse_class(&glob[i - 1..]);
                if class.consumed > 0 {
                    re.extend_from_slice(&class.source);
                    needs_u_flag |= class.needs_u_flag;
                    i += class.consumed - 1;
                    has_magic |= class.is_magic;
                    continue;
                }
            }
            if c == b"?" {
                re.extend_from_slice(QMARK);
                has_magic = true;
                continue;
            }
            push_regexp_escaped(&mut re, c);
        }
        Source {
            regexp: re,
            body: unescape(glob),
            has_magic,
            needs_u_flag,
        }
    }

    /// `#partsToRegExp`
    fn pieces_to_regexp(&mut self, node: usize, dot: bool) -> Vec<u8> {
        let mut sources = Vec::new();
        for piece in self.nodes[node].pieces.clone() {
            if let Piece::Node(child) = piece {
                let source = self.to_regexp_source(child, Some(dot));
                self.nodes[node].needs_u_flag |= source.needs_u_flag;
                sources.push(source.regexp);
            }
        }
        if self.is_start(node) && self.is_end(node) {
            sources.retain(|it| !it.is_empty());
        }
        sources.join(&b'|')
    }

    /// `toRegExpSource`. The option `dot` is set.
    fn to_regexp_source(&mut self, node: usize, allow_dot: Option<bool>) -> Source {
        let dot = allow_dot.unwrap_or(true);
        if node == 0 {
            self.flatten(0);
            self.fill_negs();
        }
        let Some(kind) = self.nodes[node].kind else {
            let pieces = self.nodes[node].pieces.clone();
            let no_empty = self.is_start(node)
                && self.is_end(node)
                && pieces.iter().all(|it| matches!(it, Piece::Text(_)));
            let mut src = Vec::new();
            for piece in &pieces {
                let source = match piece {
                    Piece::Text(text) => {
                        Self::parse_glob(text, self.nodes[node].has_magic == Some(true), no_empty)
                    }
                    Piece::Node(child) => self.to_regexp_source(*child, allow_dot),
                };
                let it = &mut self.nodes[node];
                it.has_magic = Some(it.has_magic == Some(true) || source.has_magic);
                it.needs_u_flag |= source.needs_u_flag;
                src.extend_from_slice(&source.regexp);
            }
            let mut start: &[u8] = b"";
            if self.is_start(node)
                && let Some(Piece::Text(first)) = pieces.first()
                && !(pieces.len() == 1 && is_dots(first))
            {
                let is_start_at = |at: usize| matches!(src.get(at), Some(b'[' | b'.'));
                let needs_no_traversal = dot && is_start_at(0)
                    || src.starts_with(b"\\.") && is_start_at(2)
                    || src.starts_with(b"\\.\\.") && is_start_at(4);
                let needs_no_dot = !dot && allow_dot != Some(true) && is_start_at(0);
                start = match (needs_no_traversal, needs_no_dot) {
                    (true, _) => START_NO_TRAVERSAL,
                    (_, true) => START_NO_DOT,
                    _ => b"",
                };
            }
            let is_in_negation = self.nodes[node]
                .parent
                .is_some_and(|it| self.nodes[it].kind == Some(b'!'));
            let end: &[u8] = if self.is_end(node) && self.has_filled_negs && is_in_negation {
                b"(?:$|\\/)"
            } else {
                b""
            };
            let it = &mut self.nodes[node];
            it.has_magic = Some(it.has_magic == Some(true));
            return Source {
                regexp: [start, &src, end].concat(),
                body: unescape(&src),
                has_magic: it.has_magic == Some(true),
                needs_u_flag: it.needs_u_flag,
            };
        };
        let is_repeated = matches!(kind, b'*' | b'+');
        let start: &[u8] = if kind == b'!' { b"(?:(?!(?:" } else { b"(?:" };
        let mut body = self.pieces_to_regexp(node, dot);
        if self.is_start(node) && self.is_end(node) && body.is_empty() && kind != b'!' {
            let written = self.written(node);
            let it = &mut self.nodes[node];
            it.pieces = vec![Piece::Text(written.clone())];
            it.kind = None;
            it.has_magic = None;
            return Source {
                body: unescape(&written),
                regexp: written,
                has_magic: false,
                needs_u_flag: false,
            };
        }
        let mut body_dot_allowed = match !is_repeated || allow_dot == Some(true) || dot {
            true => Vec::new(),
            false => self.pieces_to_regexp(node, true),
        };
        if body_dot_allowed == body {
            body_dot_allowed.clear();
        }
        if !body_dot_allowed.is_empty() {
            body = [b"(?:", &body[..], b")(?:", &body_dot_allowed, b")*?"].concat();
        }
        let no_dot: &[u8] = if self.is_start(node) && !dot {
            START_NO_DOT
        } else {
            b""
        };
        let regexp = if kind == b'!' && self.nodes[node].is_empty_ext {
            [no_dot, STAR_NO_EMPTY].concat()
        } else {
            let close: Vec<u8> = match kind {
                b'!' => [
                    &b"))"[..],
                    if allow_dot == Some(true) { b"" } else { no_dot },
                    STAR,
                    b")",
                ]
                .concat(),
                b'@' => b")".to_vec(),
                b'?' => b")?".to_vec(),
                b'+' if !body_dot_allowed.is_empty() => b")".to_vec(),
                b'*' if !body_dot_allowed.is_empty() => b")?".to_vec(),
                kind => vec![b')', kind],
            };
            [start, &body, &close].concat()
        };
        let it = &mut self.nodes[node];
        it.has_magic = Some(it.has_magic == Some(true));
        Source {
            regexp,
            body: unescape(&body),
            has_magic: it.has_magic == Some(true),
            needs_u_flag: it.needs_u_flag,
        }
    }

    /// `toMMPattern`
    fn into_part(mut self) -> Part {
        let source = self.to_regexp_source(0, None);
        if !source.has_magic && self.nodes[0].has_magic != Some(true) {
            return Part::Literal(source.body);
        }
        let pattern = [b"^", &source.regexp[..], b"$"].concat();
        let regex = std::str::from_utf8(&pattern)
            .ok()
            .and_then(|it| Regex::new(it, if source.needs_u_flag { "u" } else { "" }).ok());
        regex.map_or(Part::Never, |regex| Part::Regex(Box::new(regex)))
    }
}

// ───────────────────────────── a pattern ─────────────────────────────

/// A path, split at its slashes.
pub(crate) type PathParts<'p> = SmallVec<[&'p [u8]; 16]>;

/// A path to match patterns with.
pub(crate) struct SplitPath<'p> {
    /// The path, if its parts are separated by one slash each.
    text: Option<&'p [u8]>,
    parts: PathParts<'p>,
}

impl<'p> SplitPath<'p> {
    pub(crate) fn new(path: &'p [u8]) -> SplitPath<'p> {
        SplitPath {
            text: (!strings::contains(path, b"//")).then_some(path),
            parts: split_path(path),
        }
    }
}

/// `slashSplit`: `path.split(/\/+/)`
fn split_path(path: &[u8]) -> PathParts<'_> {
    let mut parts = PathParts::new();
    let mut rest = path;
    while let Some(slash) = strings::index_of_char_usize(rest, b'/') {
        parts.push(&rest[..slash]);
        rest = &rest[slash..];
        rest = &rest[rest.iter().take_while(|b| **b == b'/').count()..];
    }
    parts.push(rest);
    parts
}

/// `new Minimatch(pattern, { dot: true })`
pub(crate) struct Minimatch {
    /// It matches nothing.
    is_comment: bool,
    is_empty: bool,
    is_negated: bool,
    /// One for each expansion of the braces in the pattern.
    set: Vec<Expansion>,
}

struct Expansion {
    parts: Vec<Part>,
    /// Where the first `**` is, and the last one.
    globstars: Option<(usize, usize)>,
    /// The parts at the start that are without magic, joined by slashes: what matches starts with them.
    head: Vec<u8>,
    /// What the last part ends with, and so what matches, unless that ends with a slash.
    tail: Vec<u8>,
    /// The longest run of characters without magic in the parts between these, which is somewhere in what matches.
    inner: Vec<u8>,
}

impl Expansion {
    fn new(parts: Vec<Part>) -> Expansion {
        let is_globstar = |part: &Part| matches!(part, Part::GlobStar);
        let literals = parts.iter().map_while(|it| match it {
            Part::Literal(literal) => Some(&literal[..]),
            _ => None,
        });
        let head = literals.collect::<Vec<_>>().join(&b'/');
        let tail = match parts.last() {
            Some(Part::Literal(end) | Part::StarExt(end)) => end.clone(),
            _ => Vec::new(),
        };
        // What neither of them covers.
        let after_head = parts
            .iter()
            .take_while(|it| matches!(it, Part::Literal(_)))
            .count();
        let before_tail = parts.len() - usize::from(!tail.is_empty());
        let between = parts.get(after_head..before_tail).unwrap_or_default();
        let literals_between = between.iter().filter_map(|it| match it {
            Part::Literal(literal) => Some(literal.clone()),
            Part::Glob(glob) => Some(glob.longest_literal()),
            _ => None,
        });
        Expansion {
            inner: literals_between.max_by_key(Vec::len).unwrap_or_default(),
            head,
            tail,
            globstars: (parts.iter().position(is_globstar))
                .zip(parts.iter().rposition(is_globstar)),
            parts,
        }
    }

    /// Whether `path` can match, as far as that shows without looking at its parts.
    fn can_match(&self, path: &[u8]) -> bool {
        // Most heads are empty and most tails are a few bytes, which are compared without a call.
        let ends_with_tail = || {
            path.len() >= self.tail.len() && path.iter().rev().zip(self.tail.iter().rev()).all(|(a, b)| a == b)
        };
        (self.head.is_empty()
            || path.starts_with(&self.head) && matches!(path.get(self.head.len()), None | Some(b'/')))
            && (ends_with_tail() || path.last() == Some(&b'/'))
            && (self.inner.is_empty() || strings::contains(path, &self.inner))
    }
}

/// `/\{(?:(?!\{).)*\}/.test(pattern)`
fn has_braces(pattern: &[u8]) -> bool {
    let mut is_open = false;
    let mut at = 0;
    while at < pattern.len() {
        match pattern[at] {
            b'{' => is_open = true,
            b'}' if is_open => return true,
            _ if is_line_terminator(&pattern[at..]) => is_open = false,
            _ => {}
        }
        at += 1;
    }
    false
}

/// A file name that `**` does not match.
fn stops_globstar(name: &[u8]) -> bool {
    is_dots(name)
}

const MAX_GLOBSTAR_RECURSION: usize = 200;

impl Minimatch {
    pub(crate) fn new(pattern: &[u8]) -> Minimatch {
        // `assertValidPattern` throws for a longer one.
        const MAX_PATTERN_LENGTH: usize = 1024 * 64;
        let mut it = Minimatch {
            is_comment: pattern.first() == Some(&b'#') || pattern.len() > MAX_PATTERN_LENGTH,
            is_empty: pattern.is_empty(),
            is_negated: false,
            set: Vec::new(),
        };
        if it.is_comment || it.is_empty {
            return it;
        }
        let bangs = pattern.iter().take_while(|b| **b == b'!').count();
        it.is_negated = bangs % 2 == 1;
        let pattern = &pattern[bangs..];
        let mut globs = match has_braces(pattern) {
            true => brace_expansion::expand(pattern),
            false => vec![pattern.to_vec()],
        };
        if globs.len() > 1 {
            let mut seen = rustc_hash::FxHashSet::default();
            globs.retain(|glob| seen.insert(glob.clone()));
        }
        for glob in &globs {
            // `levelOneOptimize`
            let mut parts: Vec<&[u8]> = Vec::new();
            for part in split_path(glob) {
                let previous = parts.last().copied();
                if part == b"**" && previous == Some(b"**") {
                    continue;
                }
                if part == b".."
                    && let Some(previous) = previous
                    && !previous.is_empty()
                    && !matches!(previous, b".." | b"." | b"**")
                {
                    parts.pop();
                    continue;
                }
                parts.push(part);
            }
            if parts.is_empty() {
                parts.push(b"");
            }
            it.set
                .push(Expansion::new(parts.into_iter().map(Part::parse).collect()));
        }
        it
    }

    /// `#matchOne`. `partial`: it is enough that the path matches the start of the pattern.
    fn match_plain(file: &[&[u8]], pattern: &[Part], partial: bool) -> bool {
        let common = file.len().min(pattern.len());
        let fits = match (file.len() == common, pattern.len() == common) {
            (true, true) => true,
            (true, false) => partial,
            // `a/*` matches `a/b/`.
            _ => common + 1 == file.len() && file[common].is_empty(),
        };
        // From the end: paths differ less in what they start with.
        fits && (file[..common].iter().zip(&pattern[..common]).rev())
            .all(|(name, part)| part.test(name))
    }

    /// `#matchGlobStarBodySections`. `None`: no match, and no later position can match either.
    fn match_sections(
        file: &[&[u8]],
        sections: &[(&[Part], isize)],
        mut at: usize,
        depth: usize,
        mut saw_tail: bool,
        partial: bool,
    ) -> Option<bool> {
        let Some(&(section, last)) = sections.first() else {
            for name in &file[at.min(file.len())..] {
                saw_tail = true;
                if stops_globstar(name) {
                    return Some(false);
                }
            }
            return Some(saw_tail);
        };
        while at as isize <= last {
            let end = (at + section.len()).min(file.len());
            if Self::match_plain(&file[at.min(end)..end], section, partial)
                && depth < MAX_GLOBSTAR_RECURSION
            {
                let rest = Self::match_sections(
                    file,
                    &sections[1..],
                    at + section.len(),
                    depth + 1,
                    saw_tail,
                    partial,
                );
                if rest != Some(false) {
                    return rest;
                }
            }
            if file.get(at).is_some_and(|name| stops_globstar(name)) {
                return Some(false);
            }
            at += 1;
        }
        partial.then_some(true)
    }

    /// `#matchGlobstar`
    fn match_globstar(
        file: &[&[u8]],
        pattern: &[Part],
        (first, last): (usize, usize),
        partial: bool,
    ) -> bool {
        let is_globstar = |part: &Part| matches!(part, Part::GlobStar);
        if !partial && first + (pattern.len() - 1 - last) > file.len() {
            return false;
        }
        let (head, body, tail) = match partial {
            true => (&pattern[..first], &pattern[first + 1..], &pattern[..0]),
            false => (
                &pattern[..first],
                &pattern[(first + 1).min(last)..last],
                &pattern[last + 1..],
            ),
        };
        if !head.is_empty()
            && !Self::match_plain(&file[..head.len().min(file.len())], head, partial)
        {
            return false;
        }
        let at = head.len();
        let mut tail_len = 0;
        if !tail.is_empty() {
            if tail.len() + at > file.len() {
                return false;
            }
            let start = file.len() - tail.len();
            if Self::match_plain(&file[start..], tail, partial) {
                tail_len = tail.len();
            } else {
                // `a/**/*` matches `a/b/`.
                if file.last().is_some_and(|it| !it.is_empty()) || at + tail.len() == file.len() {
                    return false;
                }
                if !Self::match_plain(&file[start - 1..], tail, partial) {
                    return false;
                }
                tail_len = tail.len() + 1;
            }
        }
        if body.is_empty() {
            let between = &file[at.min(file.len() - tail_len)..file.len() - tail_len];
            return !between.iter().any(|name| stops_globstar(name))
                && (partial || tail_len > 0 || !between.is_empty());
        }
        let sections: SmallVec<[&[Part]; 4]> = body.split(is_globstar).collect();
        // How many parts are before each section.
        let mut before: SmallVec<[usize; 4]> = SmallVec::new();
        let mut count = 0;
        for section in &sections {
            before.push(count);
            count += section.len();
        }
        // The last position at which each section is looked for. `minimatch` takes the counts in
        // reverse order.
        let file_len = (file.len() - tail_len) as isize;
        let with_last: SmallVec<[(&[Part], isize); 4]> = (sections.iter().zip(before.iter().rev()))
            .map(|(section, before)| (*section, file_len - (before + section.len()) as isize))
            .collect();
        Self::match_sections(file, &with_last, at, 0, tail_len > 0, partial) == Some(true)
    }

    /// What a path that matches starts with, up to a slash or to its end: one of these. `None` if the pattern does not say.
    pub(crate) fn heads(&self) -> Option<impl Iterator<Item = &[u8]>> {
        let says = !self.is_comment
            && !self.is_empty
            && !self.is_negated
            && self.set.iter().all(|it| !it.head.is_empty());
        says.then(|| self.set.iter().map(|it| &it.head[..]))
    }

    /// `match(path)`. `flip_negate`: the option `flipNegate`, with which a `!` at the start of the
    /// pattern is ignored.
    pub(crate) fn matches(&self, path: &SplitPath, flip_negate: bool) -> bool {
        self.matches_with(path, flip_negate, false)
    }

    /// `match(path, partial)`
    pub(crate) fn matches_path(&self, path: &[u8], flip_negate: bool, partial: bool) -> bool {
        let is_root = partial && path == b"/" && !self.is_comment && !self.is_empty;
        is_root || self.matches_with(&SplitPath::new(path), flip_negate, partial)
    }

    fn matches_with(&self, path: &SplitPath, flip_negate: bool, partial: bool) -> bool {
        if self.is_comment {
            return false;
        }
        let text = path.text.filter(|_| !partial);
        let path = &path.parts[..];
        if self.is_empty {
            return matches!(path, [b""]);
        }
        let hit = self.set.iter().any(|it| match it.globstars {
            _ if text.is_some_and(|text| !it.can_match(text)) => false,
            Some(globstars) => Self::match_globstar(path, &it.parts, globstars, partial),
            None => Self::match_plain(path, &it.parts, partial),
        });
        if flip_negate {
            hit
        } else {
            hit != self.is_negated
        }
    }
}
