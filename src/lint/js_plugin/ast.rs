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

use super::offsets::Offsets;
use super::wire;
use crate::ast::File;
use crate::estree::{Dialect, FieldEntry, Nodes, Object, VNode, Value};
use crate::selector::{EsNode, Selector};
use crate::span::Span;
use rustc_hash::FxHashMap;

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

/// The numbers of the nodes of a file.
pub(super) type NodeIds<'a> = FxHashMap<VNode<'a>, u32>;

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

struct OpenNode<'a> {
    node: VNode<'a>,
    id: u32,
    fields: &'static [FieldEntry],
    /// The index in `fields` of the next field.
    next: usize,
    /// Where in [`Tree::fields`] the word of the next field goes.
    at: usize,
    last_child: Option<(VNode<'a>, u32)>,
}

/// What is being written.
enum Open<'a> {
    Node(OpenNode<'a>),
    /// The rest of a list, the node that has it, and where in [`Tree::lists`] the next element goes.
    List(Nodes<'a>, u32, usize),
}

struct Writer<'a, 's> {
    text: &'a [u8],
    dialect: Dialect,
    offsets: &'s Offsets,
    selectors: &'s [Option<&'s Selector>],
    /// The nodes that match each of `selectors`.
    matches: Vec<Vec<u32>>,
    ids: NodeIds<'a>,
    tree: Tree,
    /// The length of [`Tree::extra`] in UTF-16 code units.
    extra_units: u32,
    open: Vec<Open<'a>>,
}

impl<'a> Writer<'a, '_> {
    /// Adds `node`, and returns its number.
    fn start_node(&mut self, node: VNode<'a>, parent: u32) -> u32 {
        let id = self.tree.types.len() as u32;
        let node_type = node.node_type();
        self.ids.insert(node, id);
        if !self.selectors.is_empty() {
            let es_node = EsNode::of(node, node_type);
            for (selector, matches) in self.selectors.iter().zip(&mut self.matches) {
                if selector.is_some_and(|it| it.matches(es_node)) {
                    matches.push(id);
                }
            }
        }
        let span = node.span();
        self.tree.types.push(node_type as u8);
        self.tree.starts.push(self.offsets.to_utf16(span.start));
        self.tree.ends.push(self.offsets.to_utf16(span.end));
        self.tree.parents.push(parent);
        let fields = node_type.fields();
        let at = self.tree.fields.len();
        let count = fields
            .iter()
            .filter(|it| it.is_in(self.dialect) && !it.is_hidden)
            .count();
        self.tree.fields.resize(at + count, UNDEFINED);
        self.open.push(Open::Node(OpenNode {
            node,
            id,
            fields,
            next: 0,
            at,
            last_child: None,
        }));
        id
    }

    fn run(&mut self) {
        while let Some(open) = self.open.last_mut() {
            match open {
                Open::Node(open) => {
                    let Some(entry) = open.fields.get(open.next) else {
                        self.open.pop();
                        continue;
                    };
                    open.next += 1;
                    if entry.is_hidden || !entry.is_in(self.dialect) {
                        continue;
                    }
                    let (node, id, to) = (open.node, open.id, open.at);
                    open.at += 1;
                    let value = (entry.get)(node);
                    let word = match (value, open.last_child) {
                        // For espree both names of `import { a }` are one node.
                        (Value::Node(child), Some((last, last_id))) if child == last => {
                            self.tree.twice.push(last_id);
                            word(Tag::Node, last_id as usize)
                        }
                        (Value::Node(child), _) => {
                            open.last_child = Some((child, self.tree.types.len() as u32));
                            word(Tag::Node, self.start_node(child, id) as usize)
                        }
                        _ => self.value(&value, node.span(), id),
                    };
                    if let Some(field) = self.tree.fields.get_mut(to) {
                        *field = word;
                    }
                }
                Open::List(list, parent, at) => {
                    let Some(element) = list.next() else {
                        self.open.pop();
                        continue;
                    };
                    let (parent, to) = (*parent, *at);
                    *at += 1;
                    if let Some(element) = element {
                        let id = self.start_node(element, parent);
                        if let Some(word) = self.tree.lists.get_mut(to) {
                            *word = id;
                        }
                    }
                }
            }
        }
    }

    /// The word for `value`, which is not a node, in a field of the node `id` at `span`.
    fn value(&mut self, value: &Value<'a>, span: Span, id: u32) -> u32 {
        match *value {
            Value::Undefined | Value::Node(_) => UNDEFINED,
            Value::Null => NULL,
            Value::Bool(false) => FALSE,
            Value::Bool(true) => TRUE,
            Value::Number(value) => self.number(value),
            Value::Str(value) => self.string(value, span),
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
            Value::Nodes(list) => {
                let (at, len) = (self.tree.lists.len(), list.len());
                self.tree.lists.push(len as u32);
                self.tree.lists.resize(at + 1 + len, 0);
                self.open.push(Open::List(list, id, at + 1));
                word(Tag::List, at)
            }
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
            None if has_surrogate(value) => return self.units(value),
            None => {
                let start = self.extra_units;
                self.tree.extra.extend_from_slice(value);
                self.extra_units += crate::source::utf16_len(value);
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

/// Whether WTF-8 has a surrogate.
fn has_surrogate(text: &[u8]) -> bool {
    let mut rest = text;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, 0xED) {
        if matches!(rest.get(at + 1), Some(0xA0..=0xBF)) {
            return true;
        }
        rest = &rest[at + 1..];
    }
    false
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
    offsets: &'s Offsets,
    selectors: &'s [Option<&'s Selector>],
) -> Writer<'a, 's> {
    let mut writer = Writer {
        text: file.text(),
        dialect: Dialect::of(file),
        offsets,
        selectors,
        matches: vec![Vec::new(); selectors.len()],
        ids: NodeIds::default(),
        tree: Tree::default(),
        extra_units: 0,
        open: Vec::new(),
    };
    let nodes = file.text().len() / 8;
    writer.ids.reserve(nodes);
    writer.tree.types.reserve(nodes);
    writer.tree.starts.reserve(nodes);
    writer.tree.ends.reserve(nodes);
    writer.tree.parents.reserve(nodes);
    writer.tree.fields.reserve(nodes * 3);
    writer.start_node(VNode::program(file), 0);
    writer.run();
    writer
}

/// Appends the tree of `file`, and what matches `selectors`.
pub(super) fn write<'a>(
    file: &'a File<'a>,
    offsets: &Offsets,
    selectors: &[Option<&Selector>],
    out: &mut Vec<u8>,
) -> NodeIds<'a> {
    let writer = walk(file, offsets, selectors);
    let tree = &writer.tree;
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
    writer.ids
}

/// Appends only what matches `selectors`.
pub(super) fn write_only_matches<'a>(
    file: &'a File<'a>,
    offsets: &Offsets,
    selectors: &[Option<&Selector>],
    out: &mut Vec<u8>,
) {
    write_matches(&walk(file, offsets, selectors).matches, out);
}
