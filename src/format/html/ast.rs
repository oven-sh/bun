//! The tree: what `angular-html-parser` makes, with what Prettier's `parse/ast.js`, `parse/postprocess.js`
//! and `print-preprocess.js` add to it.
//!
//! All nodes are in one list. A node knows its parent, the siblings next to it, and its first and last child, so
//! that taking one out and putting one in costs the same wherever it is. Attributes are in a list of their own,
//! those of an element next to each other.

use super::data::{Display, TagDefinition};
pub(crate) use super::lexer::Span;
use std::borrow::Cow;

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub(crate) enum Kind {
    Root,
    FrontMatter,
    Element,
    Text,
    Cdata,
    Comment,
    DocType,
    IeConditionalComment,
    IeConditionalStartComment,
    IeConditionalEndComment,
    Interpolation,
    AngularControlFlowBlock,
    AngularControlFlowBlockParameters,
    AngularControlFlowBlockParameter,
    AngularLetDeclaration,
    AngularIcuExpression,
    AngularIcuCase,
}

pub(crate) type Id = u32;

/// In the place of an `Id`: there is no such node.
const NONE: Id = Id::MAX;

bitflags::bitflags! {
    #[derive(Debug, Copy, Clone, PartialEq, Eq, Default)]
    pub(crate) struct Flags: u32 {
        const HAS_START_SPAN = 1;
        const HAS_END_SPAN = 1 << 1;
        const HAS_EXPLICIT_NAMESPACE = 1 << 2;
        /// Of a conditional comment: what is in it could be parsed.
        const IS_COMPLETE = 1 << 3;
        const HAS_LEADING_SPACES = 1 << 4;
        const HAS_TRAILING_SPACES = 1 << 5;
        const HAS_DANGLING_SPACES = 1 << 6;
        const IS_WHITESPACE_SENSITIVE = 1 << 7;
        const IS_INDENTATION_SENSITIVE = 1 << 8;
        const IS_LEADING_SPACE_SENSITIVE = 1 << 9;
        const IS_TRAILING_SPACE_SENSITIVE = 1 << 10;
        const IS_DANGLING_SPACE_SENSITIVE = 1 << 11;
        const IS_SELF_CLOSING = 1 << 12;
        const HAS_HTM_COMPONENT_CLOSING_TAG = 1 << 13;
        /// Of an element: a conditional comment has been merged into its start tag.
        const HAS_CONDITION = 1 << 14;
    }
}

#[derive(Debug)]
pub(crate) struct Node<'a> {
    pub(crate) kind: Kind,
    pub(crate) css_display: Display,
    pub(crate) flags: Flags,
    parent: Id,
    prev: Id,
    next: Id,
    /// `$children`: the `children`, the `cases` of an ICU expression, the `expression` of an ICU case.
    first_child: Id,
    last_child: Id,
    /// Of a block: its parameters.
    parameters: Id,
    /// `sourceSpan`
    pub(crate) span: Span,
    pub(crate) start_span: Span,
    pub(crate) end_span: Span,
    /// Of a declaration: of the value.
    pub(crate) name_span: Span,
    /// A range of `Tree::attrs`.
    pub(crate) attrs: (u32, u32),
    /// A range of `Tree::start_tag_comments`.
    pub(crate) start_tag_comments: (u32, u32),
    /// Of an element and a block. Of a declaration: the `id`. Of an ICU expression: the `type`.
    pub(crate) name: Cow<'a, [u8]>,
    /// Empty: none.
    pub(crate) namespace: &'a [u8],
    /// Of an ICU expression: the `switchValue`. Of a parameter of a block: the `expression`. Of a conditional
    /// comment, and of an element that one has been merged into: the `condition`.
    pub(crate) value: Cow<'a, [u8]>,
    pub(crate) tag_definition: &'static TagDefinition,
}

#[derive(Debug)]
pub(crate) struct Attribute<'a> {
    pub(crate) span: Span,
    pub(crate) name_span: Span,
    /// With the quotes.
    pub(crate) value_span: Option<Span>,
    pub(crate) name: Cow<'a, [u8]>,
    /// Empty: none.
    pub(crate) namespace: &'a [u8],
    pub(crate) has_explicit_namespace: bool,
    pub(crate) value: Option<&'a [u8]>,
}

/// A comment in a start tag.
#[derive(Debug, Copy, Clone)]
pub(crate) struct StartTagComment<'a> {
    pub(crate) span: Span,
    pub(crate) value: &'a [u8],
    /// It ends with the line.
    pub(crate) is_single_line: bool,
}

/// `fullName === name`
fn is_full_name(namespace: &[u8], own: &[u8], name: &[u8]) -> bool {
    match namespace {
        b"" => own == name,
        _ => name.strip_prefix(namespace).and_then(|rest| rest.strip_prefix(b":")) == Some(own),
    }
}

impl<'a> Attribute<'a> {
    pub(crate) fn is_full_name(&self, name: &[u8]) -> bool {
        is_full_name(self.namespace, &self.name, name)
    }

    /// `fullName`
    pub(crate) fn full_name(&self) -> Cow<'_, [u8]> {
        match self.namespace {
            b"" => Cow::Borrowed(&self.name),
            namespace => Cow::Owned([namespace, b":", &self.name].concat()),
        }
    }

    /// `rawName`, in two parts.
    pub(crate) fn raw_name(&self) -> (&[u8], &[u8]) {
        (if self.has_explicit_namespace { self.namespace } else { b"" }, &self.name)
    }
}

impl<'a> Node<'a> {
    pub(crate) fn new(kind: Kind, span: Span) -> Node<'a> {
        Node {
            kind,
            css_display: Display::Inline,
            flags: Flags::empty(),
            parent: NONE,
            prev: NONE,
            next: NONE,
            first_child: NONE,
            last_child: NONE,
            parameters: NONE,
            span,
            start_span: Span::default(),
            end_span: Span::default(),
            name_span: Span::default(),
            attrs: (0, 0),
            start_tag_comments: (0, 0),
            name: Cow::Borrowed(b""),
            namespace: b"",
            value: Cow::Borrowed(b""),
            tag_definition: &super::data::DEFAULT_TAG_DEFINITION,
        }
    }

    pub(crate) fn text(value: Cow<'a, [u8]>, span: Span) -> Node<'a> {
        Node {
            value,
            ..Node::new(Kind::Text, span)
        }
    }

    #[inline]
    pub(crate) fn has(&self, flags: Flags) -> bool {
        self.flags.contains(flags)
    }

    pub(crate) fn start_span(&self) -> Option<Span> {
        self.has(Flags::HAS_START_SPAN).then_some(self.start_span)
    }

    pub(crate) fn end_span(&self) -> Option<Span> {
        self.has(Flags::HAS_END_SPAN).then_some(self.end_span)
    }

    pub(crate) fn set_start_span(&mut self, span: Span) {
        self.start_span = span;
        self.flags.insert(Flags::HAS_START_SPAN);
    }

    pub(crate) fn set_end_span(&mut self, span: Option<Span>) {
        self.end_span = span.unwrap_or_default();
        self.flags.set(Flags::HAS_END_SPAN, span.is_some());
    }

    /// Whether there is a `children` property.
    pub(crate) fn has_children_property(&self) -> bool {
        matches!(
            self.kind,
            Kind::Root
                | Kind::Element
                | Kind::IeConditionalComment
                | Kind::Interpolation
                | Kind::AngularControlFlowBlock
                | Kind::AngularControlFlowBlockParameters
        )
    }

    pub(crate) fn is_full_name(&self, name: &[u8]) -> bool {
        is_full_name(self.namespace, &self.name, name)
    }

    /// `rawName`, in two parts: the namespace, if it is written, and the name.
    pub(crate) fn raw_name(&self) -> (&[u8], &[u8]) {
        (if self.has(Flags::HAS_EXPLICIT_NAMESPACE) { self.namespace } else { b"" }, &self.name)
    }

    pub(crate) fn has_attrs(&self) -> bool {
        self.attrs.0 < self.attrs.1
    }

    pub(crate) fn has_start_tag_comments(&self) -> bool {
        self.start_tag_comments.0 < self.start_tag_comments.1
    }
}

#[derive(Default)]
pub(crate) struct Tree<'a> {
    pub(crate) nodes: Vec<Node<'a>>,
    pub(crate) attrs: Vec<Attribute<'a>>,
    pub(crate) start_tag_comments: Vec<StartTagComment<'a>>,
    pub(crate) root: Id,
}

impl<'a> std::ops::Index<Id> for Tree<'a> {
    type Output = Node<'a>;

    #[inline]
    fn index(&self, id: Id) -> &Node<'a> {
        &self.nodes[id as usize]
    }
}

impl<'a> std::ops::IndexMut<Id> for Tree<'a> {
    #[inline]
    fn index_mut(&mut self, id: Id) -> &mut Node<'a> {
        &mut self.nodes[id as usize]
    }
}

#[inline]
fn some(id: Id) -> Option<Id> {
    (id != NONE).then_some(id)
}

/// The children of a node, from the first to the last.
pub(crate) struct Children<'t, 'a> {
    tree: &'t Tree<'a>,
    next: Id,
}

impl Iterator for Children<'_, '_> {
    type Item = Id;

    fn next(&mut self) -> Option<Id> {
        let id = some(self.next)?;
        self.next = self.tree[id].next;
        Some(id)
    }
}

impl<'a> Tree<'a> {
    pub(crate) fn add(&mut self, node: Node<'a>) -> Id {
        self.nodes.push(node);
        self.nodes.len() as Id - 1
    }

    #[inline]
    pub(crate) fn parent(&self, id: Id) -> Option<Id> {
        some(self[id].parent)
    }

    #[inline]
    pub(crate) fn prev(&self, id: Id) -> Option<Id> {
        some(self[id].prev)
    }

    #[inline]
    pub(crate) fn next(&self, id: Id) -> Option<Id> {
        some(self[id].next)
    }

    #[inline]
    pub(crate) fn first_child(&self, id: Id) -> Option<Id> {
        some(self[id].first_child)
    }

    #[inline]
    pub(crate) fn last_child(&self, id: Id) -> Option<Id> {
        some(self[id].last_child)
    }

    pub(crate) fn parameters(&self, id: Id) -> Option<Id> {
        some(self[id].parameters)
    }

    pub(crate) fn set_parameters(&mut self, id: Id, parameters: Id) {
        self[id].parameters = parameters;
        self[parameters].parent = id;
    }

    pub(crate) fn has_children(&self, id: Id) -> bool {
        self[id].first_child != NONE
    }

    /// The child of `id`, if there is exactly one.
    pub(crate) fn only_child(&self, id: Id) -> Option<Id> {
        let node = &self[id];
        some(node.first_child).filter(|&first| first == node.last_child)
    }

    pub(crate) fn children(&self, id: Id) -> Children<'_, 'a> {
        Children {
            tree: self,
            next: self[id].first_child,
        }
    }

    pub(crate) fn attrs(&self, id: Id) -> &[Attribute<'a>] {
        let (start, end) = self[id].attrs;
        self.attrs.get(start as usize..end as usize).unwrap_or_default()
    }

    pub(crate) fn start_tag_comments(&self, id: Id) -> &[StartTagComment<'a>] {
        let (start, end) = self[id].start_tag_comments;
        self.start_tag_comments.get(start as usize..end as usize).unwrap_or_default()
    }

    /// Makes `child`, which is nowhere, the last child of `parent`.
    pub(crate) fn append_child(&mut self, parent: Id, child: Id) {
        let last = self[parent].last_child;
        let node = &mut self[child];
        (node.parent, node.prev, node.next) = (parent, last, NONE);
        self[parent].last_child = child;
        match some(last) {
            Some(last) => self[last].next = child,
            None => self[parent].first_child = child,
        }
    }

    /// Puts `child`, which is nowhere, before `target`.
    pub(crate) fn insert_before(&mut self, target: Id, child: Id) {
        let (parent, prev) = (self[target].parent, self[target].prev);
        let node = &mut self[child];
        (node.parent, node.prev, node.next) = (parent, prev, target);
        self[target].prev = child;
        match some(prev) {
            Some(prev) => self[prev].next = child,
            None => {
                if let Some(parent) = some(parent) {
                    self[parent].first_child = child;
                }
            }
        }
    }

    /// Takes `child` out of its parent.
    pub(crate) fn remove(&mut self, child: Id) {
        let node = &mut self[child];
        let (parent, prev, next) = (node.parent, node.prev, node.next);
        (node.parent, node.prev, node.next) = (NONE, NONE, NONE);
        match some(prev) {
            Some(prev) => self[prev].next = next,
            None => {
                if let Some(parent) = some(parent) {
                    self[parent].first_child = next;
                }
            }
        }
        match some(next) {
            Some(next) => self[next].prev = prev,
            None => {
                if let Some(parent) = some(parent) {
                    self[parent].last_child = prev;
                }
            }
        }
    }

    /// Puts `replacement`, which is nowhere, in the place of `target`.
    pub(crate) fn replace(&mut self, target: Id, replacement: Id) {
        self.insert_before(target, replacement);
        self.remove(target);
    }

    /// Takes all children out of `id`. They keep each other as siblings.
    pub(crate) fn clear_children(&mut self, id: Id) {
        let node = &mut self[id];
        (node.first_child, node.last_child) = (NONE, NONE);
    }

    /// `attrMap[name]`: `None` if there is no such attribute, `Some(None)` if it has no value.
    pub(crate) fn attribute(&self, id: Id, name: &[u8]) -> Option<Option<&'a [u8]>> {
        // The last with the name counts.
        self.attrs(id).iter().rev().find(|attr| attr.is_full_name(name)).map(|attr| attr.value)
    }

    /// `attrMap[name]`, if it is a string that is not empty.
    pub(crate) fn attribute_value(&self, id: Id, name: &[u8]) -> Option<&'a [u8]> {
        self.attribute(id, name).flatten().filter(|value| !value.is_empty())
    }
}
