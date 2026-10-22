//! A file's ESTree as arrays of numbers.
//!
//! The nodes are numbered in ESLint's traversal order: a node before its children, the fields in visitor key order. The
//! `Program` is 0. Each node has its type, its range, its parent, and one word for each field that the table in
//! [`crate::estree`] lists for the type in the file's dialect, in table order. So the position of a node's words
//! follows from the types of the nodes before it. Nodes that aren't in any field can follow the tree
//! ([`Writer::write_detached`]), and the header's last word says how many.
//!
//! A word is a [`Tag`] in its low 4 bits and a number above them. Most strings are slices of the file's text and are
//! sent as offsets.
//!
//! The message is [`HEADER`] words with the lengths of the parts, then the parts in the order of [`Tree`]'s fields: the
//! 8-byte numbers first, the bytes last.

use super::units::Units;
use super::wire;
use crate::ast::File;
use crate::code_path;
use crate::estree::{Dialect, Field, NodeType, Nodes, Object, Sink, VNode, Value};
use crate::selector::{EsNode, Selector};
use crate::span::Span;
use rustc_hash::FxHashMap;

/// The meaning of the number in a word.
#[derive(Copy, Clone)]
#[repr(u32)]
enum Tag {
    /// One of the constants below.
    Constant = 0,
    Node = 1,
    /// The offset in `lists` of a list of nodes: its length, then the nodes. 0 is a hole.
    List = 2,
    /// The index of a pair in `strings`.
    String = 3,
    /// The index of one of [`STRINGS`].
    Known = 4,
    /// The integer itself.
    Integer = 5,
    /// An index into `numbers`.
    Number = 6,
    /// The offset in `lists` of a string's length and UTF-16 code units.
    Units = 7,
    /// The offset in `lists` of two words: a `RegExp`'s pattern and flags.
    RegExp = 8,
    /// The same for `{ pattern, flags }`.
    RegExpParts = 9,
    /// The same for `{ cooked, raw }`.
    Template = 10,
    /// The offset in `lists` of one word: a `bigint`'s digits.
    BigInt = 11,
    /// The position of a list of strings in `lists`: its length, then a word for each.
    Strings = 12,
}

#[inline]
const fn word(tag: Tag, number: usize) -> u32 {
    (number as u32) << 4 | tag as u32
}

const UNDEFINED: u32 = word(Tag::Constant, 0);
const NULL: u32 = word(Tag::Constant, 1);
const FALSE: u32 = word(Tag::Constant, 2);
const TRUE: u32 = word(Tag::Constant, 3);
/// The node's text.
const TEXT: u32 = word(Tag::Constant, 4);
/// The node's text without its first and last characters.
const INNER_TEXT: u32 = word(Tag::Constant, 5);
/// An undefined field that must be present even in a layout that can leave it out.
const PRESENT_UNDEFINED: u32 = word(Tag::Constant, 6);

/// Frequent strings that aren't at the start of their node. Sorted.
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

/// A file's numbered nodes. Later requests about the same tree read them.
pub(super) struct Numbered<'a> {
    pub(super) nodes: Vec<VNode<'a>>,
    /// Each node's [`NodeType`](crate::estree::NodeType).
    pub(super) types: Vec<u8>,
    pub(super) parents: Vec<u32>,
    /// See [`Tree::twice`].
    pub(super) twice: Vec<u32>,
    /// The number of `nodes` in the tree: see [`Writer::write_detached`].
    pub(super) reachable: usize,
    /// The node each node after the tree is a copy of.
    pub(super) copied: Vec<u32>,
}

const HEADER: usize = 8;
/// Set in the start of a `strings` pair if the string is in `extra`.
const IN_EXTRA: u32 = 1 << 31;

#[derive(Default)]
struct Tree {
    numbers: Vec<f64>,
    starts: Vec<u32>,
    ends: Vec<u32>,
    parents: Vec<u32>,
    fields: Vec<u32>,
    lists: Vec<u32>,
    /// Pairs: a string's start and end, in the file's text or in `extra`.
    strings: Vec<u32>,
    /// The nodes that are in two fields of their parent, which ESLint visits twice. It isn't part of the message:
    /// `calls.rs` reads it.
    twice: Vec<u32>,
    types: Vec<u8>,
    /// UTF-8.
    extra: Vec<u8>,
}

/// The slot that a node's number gets written to.
#[derive(Copy, Clone)]
enum Slot {
    /// Nowhere: it's the `Program`.
    None,
    /// An index into [`Tree::fields`].
    Field(u32),
    /// Two such indices: the node is in two fields of its parent.
    Fields(u32, u32),
    /// An index into [`Tree::lists`].
    List(u32),
}

/// A node that hasn't been written yet.
struct Pending<'a> {
    node: VNode<'a>,
    parent: u32,
    to: Slot,
}

pub(super) struct Writer<'a, 's> {
    text: &'a [u8],
    /// The text of the component whose program the file is, if the tree is svelte-eslint-parser's. Empty otherwise.
    component: &'a [u8],
    dialect: Dialect,
    shortens_nodes: bool,
    offsets: &'s Units<'s>,
    selectors: &'s [Option<&'s Selector>],
    /// The nodes that match each of `selectors`.
    matches: Vec<Vec<u32>>,
    nodes: Vec<VNode<'a>>,
    tree: Tree,
    /// The length of [`Tree::extra`] in UTF-16 code units.
    extra_units: u32,
    /// A stack: the last entry is written next.
    open: Vec<Pending<'a>>,
    /// The number of nodes in the tree. The ones after it are in no other node's field ([`Writer::write_detached`]).
    reachable: usize,
    /// The node each node after the tree is a copy of.
    copied: Vec<u32>,
    /// While those are written: the tree's nodes, keyed to their numbers.
    known: Option<FxHashMap<VNode<'a>, u32>>,
}

/// Writes a node's fields.
struct Fields<'w, 'a, 's> {
    writer: &'w mut Writer<'a, 's>,
    id: u32,
    span: Span,
    /// True if `span` is in the component's text.
    is_in_component: bool,
    /// The length of [`Writer::open`] before this node.
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
        let word = self.writer.string(value, self.span, self.is_in_component);
        self.put(word);
    }

    #[inline(never)]
    fn node(&mut self, node: VNode<'a>) {
        if let Some(known) = &self.writer.known {
            let word = known
                .get(&node)
                .map_or(UNDEFINED, |&it| word(Tag::Node, it as usize));
            return self.put(word);
        }
        let at = self.writer.tree.fields.len() as u32;
        self.put(UNDEFINED);
        // In espree, both names of `import { a }` are the same node.
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
        if let Some(known) = &self.writer.known {
            lists.extend((*nodes).map(|it| it.and_then(|it| known.get(&it)).copied().unwrap_or(0)));
            lists[at] = (lists.len() - at - 1) as u32;
            return self.put(word(Tag::List, at));
        }
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
        let word = self.writer.other(value, self.span, self.is_in_component);
        self.put(word);
    }
}

impl<'a> Numbered<'a> {
    /// The tree, without the nodes that are in no field.
    pub(super) fn view(&self) -> code_path::estree::Tree<'_, 'a> {
        let reachable = self.reachable;
        code_path::estree::Tree {
            nodes: self.nodes.get(..reachable).unwrap_or_default(),
            types: self.types.get(..reachable).unwrap_or_default(),
            parents: self.parents.get(..reachable).unwrap_or_default(),
            twice: &self.twice,
        }
    }
}

impl<'a> Writer<'a, '_> {
    /// The tree, without the nodes that are in no field.
    pub(super) fn view(&self) -> code_path::estree::Tree<'_, 'a> {
        let reachable = self.reachable;
        code_path::estree::Tree {
            nodes: self.nodes.get(..reachable).unwrap_or_default(),
            types: self.tree.types.get(..reachable).unwrap_or_default(),
            parents: self.tree.parents.get(..reachable).unwrap_or_default(),
            twice: &self.tree.twice,
        }
    }

    /// The nodes that match each of the selectors.
    pub(super) fn matches(&self) -> &[Vec<u32>] {
        &self.matches
    }

    pub(super) fn into_numbered(self) -> Numbered<'a> {
        Numbered {
            nodes: self.nodes,
            types: self.tree.types,
            parents: self.tree.parents,
            twice: self.tree.twice,
            reachable: self.reachable,
            copied: self.copied,
        }
    }

    /// Writes a copy of each node in `copied` after the tree, in no other node's field and with the `Program` as its
    /// parent, like svelte-eslint-parser's `{ ...node }`: their fields hold the tree's nodes.
    fn write_detached(&mut self, copied: Vec<u32>) {
        self.reachable = self.nodes.len();
        if !copied.is_empty() {
            self.known = Some(self.nodes.iter().copied().zip(0..).collect());
            for &id in &copied {
                if let Some(&node) = self.nodes.get(id as usize) {
                    self.write_node(node, 0);
                }
            }
            self.known = None;
        }
        self.copied = copied;
    }

    /// Writes `node` and queues its children. Returns its number.
    fn write_node(&mut self, node: VNode<'a>, parent: u32) -> u32 {
        let id = self.tree.types.len() as u32;
        let (node_type, span) = node.type_and_span();
        self.nodes.push(node);
        if !self.selectors.is_empty() && self.known.is_none() {
            let es_node = EsNode::of(node, node_type);
            for (selector, matches) in self.selectors.iter().zip(&mut self.matches) {
                if selector.is_some_and(|it| it.matches(es_node)) {
                    matches.push(id);
                }
            }
        }
        self.tree.types.push(node_type as u8);
        let is_in_component = node.is_in_component();
        let (start, end) = match is_in_component {
            true => (
                self.offsets.text_to_utf16(span.start),
                self.offsets.text_to_utf16(span.end),
            ),
            false => (
                self.offsets.to_utf16(span.start),
                self.offsets.end_to_utf16(span.start, span.end),
            ),
        };
        self.tree.starts.push(start);
        self.tree.ends.push(end);
        self.tree.parents.push(parent);
        let open_before = self.open.len();
        let without_typescript =
            self.dialect == Dialect::Espree || (self.shortens_nodes && is_short(node_type));
        let fields_before = self.tree.fields.len();
        node_type.emit_fields(
            node,
            without_typescript,
            &mut Fields {
                writer: self,
                id,
                span,
                is_in_component,
                open_before,
            },
        );
        // svelte-eslint-parser removes the synthetic annotation of an await/let pattern, including the property itself.
        if !without_typescript
            && matches!(
                node_type,
                NodeType::Identifier | NodeType::ObjectPattern | NodeType::ArrayPattern
            )
        {
            let removes_annotation = self.offsets.is_in_component()
                && node.parent_in_component().is_some_and(|parent| {
                    matches!(
                        parent.node_type(),
                        NodeType::SvelteAwaitThenBlock | NodeType::SvelteAwaitCatchBlock
                    ) || (parent.node_type() == NodeType::SvelteDirective
                        && matches!(parent.field(Field::Kind), Value::Str(b"Let")))
                });
            let annotation = node_type
                .fields()
                .iter()
                .filter(|it| !it.is_hidden && !it.is_espree_only)
                .position(|it| it.field == Field::TypeAnnotation);
            if !removes_annotation
                && let Some(word) =
                    annotation.and_then(|at| self.tree.fields.get_mut(fields_before + at))
                && *word == UNDEFINED
            {
                *word = PRESENT_UNDEFINED;
            }
        }
        // The first child has to be popped first.
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

    /// The word for a `RegExp`, a `bigint` or an object in a field of the node at `span`, which is in the component's
    /// text if `is_in_component`.
    fn other(&mut self, value: &Value<'a>, span: Span, is_in_component: bool) -> u32 {
        match *value {
            Value::Regex { pattern, flags } => {
                self.pair(Tag::RegExp, Some(pattern), flags, span, is_in_component)
            }
            Value::BigInt(digits) => {
                let digits = self.string(digits, span, is_in_component);
                self.tree.lists.push(digits);
                word(Tag::BigInt, self.tree.lists.len() - 1)
            }
            Value::Object(Object::Regex { pattern, flags }) => self.pair(
                Tag::RegExpParts,
                Some(pattern),
                flags,
                span,
                is_in_component,
            ),
            Value::Object(Object::Template { cooked, raw }) => {
                self.pair(Tag::Template, cooked, raw, span, is_in_component)
            }
            Value::Object(object @ Object::Modifiers(_)) => {
                let words: Vec<u32> = (object.strings())
                    .map(|it| self.string(it, span, is_in_component))
                    .collect();
                let list = self.tree.lists.len();
                self.tree.lists.push(words.len() as u32);
                self.tree.lists.extend_from_slice(&words);
                word(Tag::Strings, list)
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

    fn pair(
        &mut self,
        tag: Tag,
        first: Option<&[u8]>,
        second: &[u8],
        span: Span,
        is_in_component: bool,
    ) -> u32 {
        let second_word = self.string(second, span, is_in_component);
        let first_word = match first {
            None => NULL,
            Some(first) if first == second => second_word,
            Some(first) => self.string(first, span, is_in_component),
        };
        self.tree
            .lists
            .extend_from_slice(&[first_word, second_word]);
        word(tag, self.tree.lists.len() - 2)
    }

    /// The position of the bytes `value`, if they're in the file's or the component's text, in UTF-16 code units.
    fn place_of(&self, value: &[u8]) -> Option<(u32, u32)> {
        let value = value.as_ptr_range();
        let offset_in = |text: &[u8]| {
            let text = text.as_ptr_range();
            let is_inside = text.start <= value.start && value.end <= text.end;
            is_inside.then(|| (value.start.addr() - text.start.addr()) as u32)
        };
        let len = (value.end.addr() - value.start.addr()) as u32;
        if let Some(start) = offset_in(self.text) {
            return Some((
                self.offsets.to_utf16(start),
                self.offsets.end_to_utf16(start, start + len),
            ));
        }
        let start = offset_in(self.component)?;
        Some((
            self.offsets.text_to_utf16(start),
            self.offsets.text_to_utf16(start + len),
        ))
    }

    /// The word for a string in a field of the node at `span`, which is in the component's text if `is_in_component`.
    fn string(&mut self, value: &[u8], span: Span, is_in_component: bool) -> u32 {
        let text = match is_in_component {
            true => self.component,
            false => self.text,
        };
        let whole = text
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
        let place = match whole.starts_with(value) {
            true => whole.get(..value.len()).and_then(|it| self.place_of(it)),
            false => self.place_of(value),
        };
        let (start, end) = match place {
            Some(place) => place,
            None if bun_core::strings::wtf8_has_surrogate(value) => return self.units(value),
            None => {
                let start = self.extra_units;
                self.tree.extra.extend_from_slice(value);
                self.extra_units += bun_core::strings::utf8_decoded_len_utf16(value);
                (start | IN_EXTRA, self.extra_units)
            }
        };
        self.tree.strings.extend_from_slice(&[start, end]);
        word(Tag::String, self.tree.strings.len() / 2 - 1)
    }

    /// The word for a string that isn't valid UTF-8 because it has an unpaired surrogate.
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

/// True if the fields that only TypeScript can fill in aren't written for the types that [`is_short`] lists. In oxlint,
/// a node of a JavaScript file has them anyway: an `Identifier` has `decorators`, `optional` and `typeAnnotation`.
/// There they're always `[]`, `false` and `null`, which `layouts.rs` sends once per type.
pub(super) fn shortens_nodes(file: &File) -> bool {
    file.language().is_oxlint && file.is_javascript()
}

/// The types whose TypeScript-only fields are the same in every node of a JavaScript file, because anything that would
/// change one is a syntax error there, both in oxlint and in Bun. That doesn't hold for every type: JavaScript has
/// decorators on classes and their members and `import defer`, and both parsers accept `class C { m?() {} p?; }`. None
/// of these types has an espree-only field, which `emit_fields` would write for them.
pub(super) fn is_short(node_type: NodeType) -> bool {
    matches!(
        node_type,
        NodeType::Identifier
            | NodeType::CallExpression
            | NodeType::NewExpression
            | NodeType::TaggedTemplateExpression
            | NodeType::VariableDeclaration
            | NodeType::VariableDeclarator
            | NodeType::ArrowFunctionExpression
            | NodeType::FunctionExpression
            | NodeType::FunctionDeclaration
            | NodeType::Property
            | NodeType::ObjectPattern
            | NodeType::ArrayPattern
            | NodeType::AssignmentPattern
            | NodeType::RestElement
            | NodeType::JSXOpeningElement
            | NodeType::ImportSpecifier
            | NodeType::ExportSpecifier
            | NodeType::ExportNamedDeclaration
            | NodeType::ExportDefaultDeclaration
            | NodeType::ExportAllDeclaration
    )
}

/// Walks `file`'s tree, numbers the nodes, and records which ones match `selectors`.
pub(super) fn walk<'a, 's>(
    file: &'a File<'a>,
    offsets: &'s Units<'s>,
    selectors: &'s [Option<&'s Selector>],
) -> Writer<'a, 's> {
    let component = file.svelte().filter(|_| offsets.is_in_component());
    let mut writer = Writer {
        text: file.text(),
        component: component.map_or(&[][..], |it| it.text()),
        dialect: Dialect::of(file),
        shortens_nodes: shortens_nodes(file),
        offsets,
        selectors,
        matches: vec![Vec::new(); selectors.len()],
        nodes: Vec::new(),
        tree: Tree::default(),
        extra_units: 0,
        open: Vec::new(),
        reachable: 0,
        copied: Vec::new(),
        known: None,
    };
    let nodes = file.text().len() / 8;
    writer.nodes.reserve(nodes);
    writer.tree.types.reserve(nodes);
    writer.tree.starts.reserve(nodes);
    writer.tree.ends.reserve(nodes);
    writer.tree.parents.reserve(nodes);
    writer.tree.fields.reserve(nodes * 3);
    writer.run(match component {
        Some(_) => VNode::svelte_program(file),
        None => VNode::program(file),
    });
    let copied = match component {
        Some(_) => {
            super::scopes::svelte::copied_identifiers(file, &writer.nodes, &writer.tree.parents)
        }
        None => Vec::new(),
    };
    writer.write_detached(copied);
    writer
}

impl Writer<'_, '_> {
    /// Appends the tree. For `alternates`, see `layouts.rs`.
    pub(super) fn append(&self, alternates: &[u32], out: &mut Vec<u8>) {
        let tree = &self.tree;
        let header: [u32; HEADER] = [
            tree.types.len() as u32,
            tree.fields.len() as u32,
            tree.lists.len() as u32,
            tree.strings.len() as u32,
            tree.numbers.len() as u32,
            tree.extra.len() as u32,
            alternates.len() as u32,
            (self.nodes.len() - self.reachable) as u32,
        ];
        wire::words(out, &header);
        for number in &tree.numbers {
            out.extend_from_slice(&number.to_le_bytes());
        }
        for part in [
            &tree.starts[..],
            &tree.ends,
            &tree.parents,
            &tree.fields,
            &tree.lists,
            &tree.strings,
            alternates,
        ] {
            wire::words(out, part);
        }
        out.extend_from_slice(&tree.types);
        out.extend_from_slice(&tree.extra);
    }
}
