//! The ESTree of a file as arrays of numbers.
//!
//! The nodes are numbered in the order in which ESLint comes to them: a node before what is in it,
//! the fields in the order of the visitor keys. The `Program` is 0. For each node there is its type,
//! its range, its parent, and one word for each field that the table of [`crate::estree`] has for
//! the type in the dialect of the file, in the order of the table. So where the words of a node
//! are follows from the types of the nodes before it.
//!
//! A word is a [`Tag`] in its low 4 bits and a number above them. Most strings are in the text of
//! the file, and are sent as where.
//!
//! The message: [`HEADER`] words with the lengths of the parts, then the parts in the order of the
//! fields of [`Tree`]: the 8-byte numbers first, the bytes last.

use super::wire;
use crate::ast::File;
use crate::estree::{Dialect, Nodes, Object, Sink, VNode, Value};
use crate::selector::{EsNode, Selector};
use crate::span::Span;
use bun_core::strings::Utf16OffsetTable;

/// What the number in a word is.
#[derive(Copy, Clone)]
#[repr(u32)]
enum Tag {
    /// One of the constants below.
    Constant = 0,
    Node = 1,
    /// Where in `lists` a list of nodes is: its length, then the nodes. 0 is a hole.
    List = 2,
    /// The index of a pair in `strings`.
    String = 3,
    /// The index of one of [`STRINGS`].
    Known = 4,
    /// Itself.
    Integer = 5,
    /// An index in `numbers`.
    Number = 6,
    /// Where in `lists` the length and the UTF-16 code units of a string are.
    Units = 7,
    /// Where in `lists` two words are: the pattern and the flags of a `RegExp`.
    RegExp = 8,
    /// The same for `{ pattern, flags }`.
    RegExpParts = 9,
    /// The same for `{ cooked, raw }`.
    Template = 10,
    /// Where in `lists` a word is: the digits of a `bigint`.
    BigInt = 11,
}

#[inline]
const fn word(tag: Tag, number: usize) -> u32 {
    (number as u32) << 4 | tag as u32
}

const UNDEFINED: u32 = word(Tag::Constant, 0);
const NULL: u32 = word(Tag::Constant, 1);
const FALSE: u32 = word(Tag::Constant, 2);
const TRUE: u32 = word(Tag::Constant, 3);
/// The text of the node.
const TEXT: u32 = word(Tag::Constant, 4);
/// The text of the node without its first and its last character.
const INNER_TEXT: u32 = word(Tag::Constant, 5);

/// Strings that are frequent and not where their node starts. Sorted.
pub(super) const STRINGS: &[&str] = &[
    "!",
    "!=",
    "!==",
    "%",
    "%=",
    "&",
    "&&",
    "&&=",
    "&=",
    "*",
    "**",
    "**=",
    "*=",
    "+",
    "++",
    "+=",
    "-",
    "--",
    "-=",
    "/",
    "/=",
    "<",
    "<<",
    "<<=",
    "<=",
    "=",
    "==",
    "===",
    ">",
    ">=",
    ">>",
    ">>=",
    ">>>",
    ">>>=",
    "??",
    "??=",
    "^",
    "^=",
    "await using",
    "const",
    "constructor",
    "delete",
    "get",
    "in",
    "init",
    "instanceof",
    "keyof",
    "let",
    "method",
    "module",
    "namespace",
    "private",
    "protected",
    "public",
    "readonly",
    "script",
    "set",
    "type",
    "typeof",
    "unique",
    "using",
    "value",
    "var",
    "void",
    "|",
    "|=",
    "||",
    "||=",
    "~",
];

/// The nodes of a file, by their numbers.
pub(super) type Numbered<'a> = Vec<VNode<'a>>;

const HEADER: usize = 10;
/// In the start of a pair of `strings`: it is in `extra`.
const IN_EXTRA: u32 = 1 << 31;

#[derive(Default)]
struct Tree {
    numbers: Vec<f64>,
    starts: Vec<u32>,
    ends: Vec<u32>,
    parents: Vec<u32>,
    fields: Vec<u32>,
    lists: Vec<u32>,
    /// Pairs: where a string starts and ends, in the text of the file or in `extra`.
    strings: Vec<u32>,
    /// The nodes that are in two fields of their parent, which ESLint comes to twice.
    twice: Vec<u32>,
    types: Vec<u8>,
    /// UTF-8.
    extra: Vec<u8>,
}

/// Where the number of a node goes.
#[derive(Copy, Clone)]
enum Slot {
    /// Nowhere: it is the `Program`.
    None,
    /// An index in [`Tree::fields`].
    Field(u32),
    /// Two of them: it is in two fields of its parent.
    Fields(u32, u32),
    /// An index in [`Tree::lists`].
    List(u32),
}

/// A node that is still to be written.
struct Pending<'a> {
    node: VNode<'a>,
    parent: u32,
    to: Slot,
}

struct Writer<'a, 's> {
    text: &'a [u8],
    dialect: Dialect,
    offsets: &'s Utf16OffsetTable,
    selectors: &'s [Option<&'s Selector>],
    /// The nodes that match each of `selectors`.
    matches: Vec<Vec<u32>>,
    nodes: Numbered<'a>,
    tree: Tree,
    /// The length of [`Tree::extra`] in UTF-16 code units.
    extra_units: u32,
    /// The last is the next.
    open: Vec<Pending<'a>>,
}

/// Writes the fields of a node.
struct Fields<'w, 'a, 's> {
    writer: &'w mut Writer<'a, 's>,
    id: u32,
    span: Span,
    /// How many were [`Writer::open`] before.
    open_before: usize,
}

impl<'a> Fields<'_, 'a, '_> {
    #[inline]
    fn put(&mut self, word: u32) {
        self.writer.tree.fields.push(word);
    }
}

impl<'a> Sink<'a> for Fields<'_, 'a, '_> {
    #[inline]
    fn undefined(&mut self) {
        self.put(UNDEFINED);
    }

    #[inline]
    fn null(&mut self) {
        self.put(NULL);
    }

    #[inline]
    fn bool(&mut self, value: bool) {
        self.put(if value { TRUE } else { FALSE });
    }

    #[inline]
    fn number(&mut self, value: f64) {
        let word = self.writer.number(value);
        self.put(word);
    }

    #[inline]
    fn str(&mut self, value: &'a [u8]) {
        let word = self.writer.string(value, self.span);
        self.put(word);
    }

    #[inline]
    fn node(&mut self, node: VNode<'a>) {
        let at = self.writer.tree.fields.len() as u32;
        self.put(UNDEFINED);
        // For espree both names of `import { a }` are one node.
        if let Some(last) = self.writer.open[self.open_before..].last_mut()
            && let Slot::Field(first) = last.to
            && last.node == node
        {
            last.to = Slot::Fields(first, at);
            return;
        }
        self.writer.open.push(Pending {
            node,
            parent: self.id,
            to: Slot::Field(at),
        });
    }

    fn nodes(&mut self, nodes: &Nodes<'a>) {
        let (lists, open) = (&mut self.writer.tree.lists, &mut self.writer.open);
        let at = lists.len();
        lists.push(0);
        for node in *nodes {
            if let Some(node) = node {
                open.push(Pending {
                    node,
                    parent: self.id,
                    to: Slot::List(lists.len() as u32),
                });
            }
            lists.push(0);
        }
        lists[at] = (lists.len() - at - 1) as u32;
        self.put(word(Tag::List, at));
    }

    fn other(&mut self, value: &Value<'a>) {
        let word = self.writer.other(value, self.span);
        self.put(word);
    }
}

impl<'a> Writer<'a, '_> {
    /// Writes `node`, and notes what is in it. Returns its number.
    fn write_node(&mut self, node: VNode<'a>, parent: u32) -> u32 {
        let id = self.tree.types.len() as u32;
        let (node_type, span) = node.type_and_span();
        self.nodes.push(node);
        if !self.selectors.is_empty() {
            let es_node = EsNode::of(node, node_type);
            for (selector, matches) in self.selectors.iter().zip(&mut self.matches) {
                if selector.is_some_and(|it| it.matches(es_node)) {
                    matches.push(id);
                }
            }
        }
        self.tree.types.push(node_type as u8);
        self.tree.starts.push(self.offsets.to_utf16(span.start));
        self.tree.ends.push(self.offsets.to_utf16(span.end));
        self.tree.parents.push(parent);
        let (open_before, is_espree) = (self.open.len(), self.dialect == Dialect::Espree);
        node_type.emit_fields(
            node,
            is_espree,
            &mut Fields {
                writer: self,
                id,
                span,
                open_before,
            },
        );
        // The first of them is the next.
        self.open[open_before..].reverse();
        id
    }

    fn run(&mut self, program: VNode<'a>) {
        self.open.push(Pending {
            node: program,
            parent: 0,
            to: Slot::None,
        });
        while let Some(Pending { node, parent, to }) = self.open.pop() {
            let id = self.write_node(node, parent);
            let (fields, in_field) = (&mut self.tree.fields, word(Tag::Node, id as usize));
            match to {
                Slot::None => {}
                Slot::Field(at) => fields[at as usize] = in_field,
                Slot::Fields(first, second) => {
                    fields[first as usize] = in_field;
                    fields[second as usize] = in_field;
                    self.tree.twice.push(id);
                }
                Slot::List(at) => self.tree.lists[at as usize] = id,
            }
        }
    }

    /// The word for a `RegExp`, a `bigint` or an object in a field of the node at `span`.
    fn other(&mut self, value: &Value<'a>, span: Span) -> u32 {
        match *value {
            Value::Regex { pattern, flags } => self.pair(Tag::RegExp, Some(pattern), flags, span),
            Value::BigInt(digits) => {
                let digits = self.string(digits, span);
                self.tree.lists.push(digits);
                word(Tag::BigInt, self.tree.lists.len() - 1)
            }
            Value::Object(Object::Regex { pattern, flags }) => {
                self.pair(Tag::RegExpParts, Some(pattern), flags, span)
            }
            Value::Object(Object::Template { cooked, raw }) => {
                self.pair(Tag::Template, cooked, raw, span)
            }
            _ => UNDEFINED,
        }
    }

    fn number(&mut self, value: f64) -> u32 {
        let integer = value as u32;
        if integer < 1 << 28 && f64::from(integer).to_bits() == value.to_bits() {
            return word(Tag::Integer, integer as usize);
        }
        self.tree.numbers.push(value);
        word(Tag::Number, self.tree.numbers.len() - 1)
    }

    fn pair(&mut self, tag: Tag, first: Option<&[u8]>, second: &[u8], span: Span) -> u32 {
        let second_word = self.string(second, span);
        let first_word = match first {
            None => NULL,
            Some(first) if first == second => second_word,
            Some(first) => self.string(first, span),
        };
        self.tree
            .lists
            .extend_from_slice(&[first_word, second_word]);
        word(tag, self.tree.lists.len() - 2)
    }

    /// The word for a string in a field of the node at `span`.
    fn string(&mut self, value: &[u8], span: Span) -> u32 {
        let whole = self
            .text
            .get(span.start as usize..span.end as usize)
            .unwrap_or_default();
        if value == whole {
            return TEXT;
        }
        if let [_, inner @ .., _] = whole
            && inner == value
        {
            return INNER_TEXT;
        }
        if value.len() <= 11
            && let Ok(at) = STRINGS.binary_search_by(|it| it.as_bytes().cmp(value))
        {
            return word(Tag::Known, at);
        }
        let start_in_text = match whole.starts_with(value) {
            true => Some(span.start),
            false => {
                let (text, value) = (self.text.as_ptr_range(), value.as_ptr_range());
                let is_inside = text.start <= value.start && value.end <= text.end;
                is_inside.then(|| (value.start.addr() - text.start.addr()) as u32)
            }
        };
        let (start, end) = match start_in_text {
            Some(start) => (
                self.offsets.to_utf16(start),
                self.offsets.to_utf16(start + value.len() as u32),
            ),
            None if bun_core::strings::wtf8_has_surrogate(value) => return self.units(value),
            None => {
                let start = self.extra_units;
                self.tree.extra.extend_from_slice(value);
                self.extra_units += bun_core::strings::utf8_lossy_len_utf16(value);
                (start | IN_EXTRA, self.extra_units)
            }
        };
        self.tree.strings.extend_from_slice(&[start, end]);
        word(Tag::String, self.tree.strings.len() / 2 - 1)
    }

    /// The word for a string that is not valid UTF-8, because it has half of a surrogate pair.
    fn units(&mut self, value: &[u8]) -> u32 {
        let at = self.tree.lists.len();
        self.tree.lists.push(0);
        let mut i = 0;
        while i < value.len() {
            if let [0xED, second @ 0xA0..=0xBF, third @ 0x80..=0xBF, ..] = value[i..] {
                self.tree
                    .lists
                    .push(0xD000 | u32::from(second & 0x3F) << 6 | u32::from(third & 0x3F));
                i += 3;
                continue;
            }
            let (c, size) = bun_core::lexer::char_and_size(value, i);
            i += size.max(1);
            match u32::try_from(c).unwrap_or(0xFFFD) {
                c @ 0x1_0000.. => self
                    .tree
                    .lists
                    .extend_from_slice(&[0xD800 + ((c - 0x1_0000) >> 10), 0xDC00 + (c & 0x3FF)]),
                c => self.tree.lists.push(c),
            }
        }
        self.tree.lists[at] = (self.tree.lists.len() - at - 1) as u32;
        word(Tag::Units, at)
    }
}

/// For each of the selectors: how many nodes match it, then these, in the order of their numbers.
fn write_matches(matches: &[Vec<u32>], out: &mut Vec<u8>) {
    for matches in matches {
        wire::words(out, &[matches.len() as u32]);
        wire::words(out, matches);
    }
}

fn walk<'a, 's>(
    file: &'a File<'a>,
    offsets: &'s Utf16OffsetTable,
    selectors: &'s [Option<&'s Selector>],
) -> Writer<'a, 's> {
    let mut writer = Writer {
        text: file.text(),
        dialect: Dialect::of(file),
        offsets,
        selectors,
        matches: vec![Vec::new(); selectors.len()],
        nodes: Numbered::default(),
        tree: Tree::default(),
        extra_units: 0,
        open: Vec::new(),
    };
    let nodes = file.text().len() / 8;
    writer.nodes.reserve(nodes);
    writer.tree.types.reserve(nodes);
    writer.tree.starts.reserve(nodes);
    writer.tree.ends.reserve(nodes);
    writer.tree.parents.reserve(nodes);
    writer.tree.fields.reserve(nodes * 3);
    writer.run(VNode::program(file));
    writer
}

/// Appends the tree of `file`, and what matches `selectors`. `listened`: by the number of a type, whether somebody listens to it. A
/// tree without nodes is appended if no such node is in the file and nothing matches: making the nodes is dearer than this.
pub(super) fn write<'a>(
    file: &'a File<'a>,
    offsets: &Utf16OffsetTable,
    selectors: &[Option<&Selector>],
    listened: Option<&[bool; 256]>,
    out: &mut Vec<u8>,
) -> Numbered<'a> {
    let writer = walk(file, offsets, selectors);
    let tree = &writer.tree;
    let is_listened = |listened: &[bool; 256]| tree.types.iter().any(|&it| listened[it as usize]);
    if listened.is_some_and(|it| !is_listened(it)) && writer.matches.iter().all(Vec::is_empty) {
        wire::words(out, &[0; HEADER]);
        return writer.nodes;
    }
    let matches: usize = writer.matches.iter().map(|it| it.len() + 1).sum();
    let header: [u32; HEADER] = [
        tree.types.len() as u32,
        tree.fields.len() as u32,
        tree.lists.len() as u32,
        tree.strings.len() as u32,
        tree.twice.len() as u32,
        matches as u32,
        tree.numbers.len() as u32,
        tree.extra.len() as u32,
        u32::from(writer.dialect == Dialect::Espree),
        0,
    ];
    wire::words(out, &header);
    for number in &tree.numbers {
        out.extend_from_slice(&number.to_le_bytes());
    }
    for part in [
        &tree.starts,
        &tree.ends,
        &tree.parents,
        &tree.fields,
        &tree.lists,
        &tree.strings,
        &tree.twice,
    ] {
        wire::words(out, part);
    }
    write_matches(&writer.matches, out);
    out.extend_from_slice(&tree.types);
    out.extend_from_slice(&tree.extra);
    writer.nodes
}

/// Appends only what matches `selectors`.
pub(super) fn write_only_matches<'a>(
    file: &'a File<'a>,
    offsets: &Utf16OffsetTable,
    selectors: &[Option<&Selector>],
    out: &mut Vec<u8>,
) {
    write_matches(&walk(file, offsets, selectors).matches, out);
}
