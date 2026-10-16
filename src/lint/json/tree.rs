//! The tree of a document: Momoa's, as far as the rules look at it.
//!
//! | Momoa | here |
//! | --- | --- |
//! | `Document` | [`Document`]. `body` is [`Document::body`] |
//! | `Object`, `Array`, `String`, `Number`, `Boolean`, `Null`, `Identifier`, `NaN`, `Infinity` | [`Node`], by [`Node::kind`] |
//! | `Member` | [`Member`], from [`Node::members`] |
//! | `Element` | Not a node. Its range is that of its value: [`Node::elements`] |
//! | `node.loc`, `node.range` | [`Node::span`] |
//! | `getKey(member)`, `getRawKey(member, sourceCode)` | [`Member::key`], [`Member::raw_key`] |

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
    /// A name without quotes.
    Identifier,
    NaN,
    Infinity,
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Entry {
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// The index of the node after this one and all that is in it.
    pub(crate) next: u32,
    pub(crate) kind: NodeKind,
}

/// The nodes in the order of the text: an object or an array is followed by what is in it. In an object names and values take turns.
#[derive(Default)]
pub struct Tree {
    pub(crate) nodes: Vec<Entry>,
    /// The names that are not written as what they stand for, by their indices, which ascend: where that is in `texts`.
    pub(crate) unescaped: Vec<(u32, Span)>,
    pub(crate) texts: Vec<u8>,
}

/// A tree and the text that it is of.
#[derive(Copy, Clone)]
pub struct Document<'a> {
    tree: &'a Tree,
    text: &'a [u8],
}

impl<'a> Document<'a> {
    /// `None`: the file is not JSON.
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

    /// All nodes but the members, each before what is in it.
    pub fn nodes(self) -> impl Iterator<Item = Node<'a>> {
        (0..self.tree.nodes.len() as u32).filter_map(move |index| self.node(index))
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
        self.document
            .text
            .get(self.span().range())
            .unwrap_or_default()
    }

    /// The nodes that are right in it: of an object, names and values in turns.
    fn children(self) -> impl Iterator<Item = Node<'a>> {
        let first = self.document.node(self.index + 1);
        std::iter::successors(first, |it| it.document.node(it.entry.next))
            .take_while(move |it| it.index < self.entry.next)
    }

    /// `members` of an `Object`. Nothing for any other node.
    pub fn members(self) -> impl Iterator<Item = Member<'a>> {
        let mut children = self
            .children()
            .filter(move |_| self.kind() == NodeKind::Object);
        std::iter::from_fn(move || {
            Some(Member {
                name: children.next()?,
                value: children.next()?,
            })
        })
    }

    /// The values of the `elements` of an `Array`. Nothing for any other node.
    pub fn elements(self) -> impl Iterator<Item = Node<'a>> {
        self.children()
            .filter(move |_| self.kind() == NodeKind::Array)
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
    /// The name as it is written, without its quotes.
    pub fn raw_key(self) -> &'a [u8] {
        match (self.name.kind(), self.name.text()) {
            (NodeKind::String, [_, inner @ .., _]) => inner,
            (_, text) => text,
        }
    }

    /// What the name stands for.
    pub fn key(self) -> &'a [u8] {
        let tree = self.name.document.tree;
        let found = tree
            .unescaped
            .binary_search_by_key(&self.name.index, |it| it.0);
        match found.ok().and_then(|at| tree.unescaped.get(at)) {
            Some((_, span)) => tree.texts.get(span.range()).unwrap_or_default(),
            None => self.raw_key(),
        }
    }
}

impl Spanned for Member<'_> {
    #[inline]
    fn span(&self) -> Span {
        self.name.span().to(self.value.span())
    }
}
