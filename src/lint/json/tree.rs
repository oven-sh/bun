//! A document's tree: the subset of the tree built by Momoa, the plugin's parser, that the rules need.
//!
//! | Momoa | here |
//! | --- | --- |
//! | `Document` | [`Document`]. `body` is [`Document::body`] |
//! | `Object`, `Array`, `String`, `Number`, `Boolean`, `Null`, `Identifier`, `NaN`, `Infinity` | [`Node`], by [`Node::kind`] |
//! | `Member` | [`Member`], from [`Node::members`] |
//! | `Element` | Not a node |
//! | `node.loc`, `node.range` | [`Node::span`] |
//! | `string.value` | [`Node::value`] |
//! | `getKey(member)`, `getRawKey(member, sourceCode)` | [`Member::key`], [`Member::raw_key`] |
//! | `sourceCode.comments` | [`Document::comments`] |

use bun_lint::ast::File;
use bun_lint::span::{Span, Spanned};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum NodeKind {
    Object,
    Array,
    String,
    Number,
    Boolean,
    Null,
    /// An unquoted key.
    Identifier,
    NaN,
    Infinity,
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Entry {
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// The index of the first node after this one and its descendants.
    pub(crate) next: u32,
    pub(crate) kind: NodeKind,
}

/// The nodes in source order. An object or array is followed by its contents. In an object, keys and values alternate.
#[derive(Default)]
pub struct Tree {
    pub(crate) nodes: Vec<Entry>,
    /// The unescaped values of strings and keys: a node index and a span in `texts`, sorted by node index. It only has
    /// the keys whose value differs from their source text, and the string values that contain a lone surrogate.
    pub(crate) unescaped: Vec<(u32, Span)>,
    pub(crate) texts: Vec<u8>,
    pub(crate) comments: Vec<Span>,
}

/// A tree and its source text.
#[derive(Copy, Clone)]
pub struct Document<'a> {
    tree: &'a Tree,
    text: &'a [u8],
}

impl<'a> Document<'a> {
    /// Returns `None` if the file isn't JSON.
    pub fn of(file: &'a File<'a>) -> Option<Document<'a>> {
        Some(Document {
            tree: file.tree()?,
            text: file.text(),
        })
    }

    fn node(self, index: u32) -> Option<Node<'a>> {
        let entry = *self.tree.nodes.get(index as usize)?;
        Some(Node {
            document: self,
            index,
            entry,
        })
    }

    pub fn body(self) -> Option<Node<'a>> {
        self.node(0)
    }

    /// All nodes, parents before children.
    pub fn nodes(self) -> impl Iterator<Item = Node<'a>> {
        (0..self.tree.nodes.len() as u32).filter_map(move |index| self.node(index))
    }

    /// All members, parents before children.
    pub fn members(self) -> impl Iterator<Item = Member<'a>> {
        self.nodes().flat_map(Node::members)
    }

    /// The strings and keys whose [value](Node::value) is stored separately from the source text.
    pub fn unescaped(self) -> impl Iterator<Item = Node<'a>> {
        let indices = self.tree.unescaped.iter().map(|it| it.0);
        indices.filter_map(move |index| self.node(index))
    }

    /// In source order.
    pub fn comments(self) -> &'a [Span] {
        &self.tree.comments
    }

    pub fn text(self) -> &'a [u8] {
        self.text
    }
}

#[derive(Copy, Clone)]
pub struct Node<'a> {
    document: Document<'a>,
    index: u32,
    entry: Entry,
}

impl<'a> Node<'a> {
    #[inline]
    pub fn kind(self) -> NodeKind {
        self.entry.kind
    }

    /// `sourceCode.getText(node)`
    pub fn text(self) -> &'a [u8] {
        let text = self.document.text;
        text.get(self.span().range()).unwrap_or_default()
    }

    /// The source text, without the quotes if it's a string.
    fn unquoted_text(self) -> &'a [u8] {
        match (self.kind(), self.text()) {
            (NodeKind::String, [_, inner @ .., _]) => inner,
            (_, text) => text,
        }
    }

    /// The unescaped value of a key. A string that's a value is only unescaped if it contains a lone surrogate.
    pub fn value(self) -> &'a [u8] {
        let tree = self.document.tree;
        let found = tree.unescaped.binary_search_by_key(&self.index, |it| it.0);
        match found.ok().and_then(|at| tree.unescaped.get(at)) {
            Some((_, span)) => tree.texts.get(span.range()).unwrap_or_default(),
            None => self.unquoted_text(),
        }
    }

    /// The `members` of an `Object`. Empty for any other node.
    pub fn members(self) -> impl Iterator<Item = Member<'a>> {
        let is_object = self.kind() == NodeKind::Object;
        let first = self.document.node(self.index + 1).filter(|_| is_object);
        let mut children = std::iter::successors(first, |it| it.document.node(it.entry.next))
            .take_while(move |it| it.index < self.entry.next);
        std::iter::from_fn(move || {
            Some(Member {
                name: children.next()?,
                value: children.next()?,
            })
        })
    }
}

impl Spanned for Node<'_> {
    #[inline]
    fn span(&self) -> Span {
        Span::new(self.entry.start, self.entry.end)
    }
}

#[derive(Copy, Clone)]
pub struct Member<'a> {
    /// A `String` or an `Identifier`.
    pub name: Node<'a>,
    pub value: Node<'a>,
}

impl<'a> Member<'a> {
    /// The key's source text, without its quotes.
    pub fn raw_key(self) -> &'a [u8] {
        self.name.unquoted_text()
    }

    /// The key with its escape sequences resolved.
    pub fn key(self) -> &'a [u8] {
        self.name.value()
    }
}

impl Spanned for Member<'_> {
    #[inline]
    fn span(&self) -> Span {
        self.name.span().to(self.value.span())
    }
}
