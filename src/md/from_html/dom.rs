//! Arena-backed DOM that html5ever's tree builder writes into.
//!
//! Nodes are bump-allocated in a `typed_arena::Arena` and linked with
//! `Cell<Option<&Node>>` pointers (the shape of html5ever's own `arena.rs`
//! example). Handles are plain shared references, so `elem_name` can borrow
//! the name straight out of the node without going through the sink, and
//! dropping the arena frees every node in one flat sweep — there is no
//! recursive `Drop`, so pathological nesting cannot overflow the stack on
//! teardown.

use core::cell::{Cell, RefCell};
use core::ptr;
use std::borrow::Cow;

use html5ever::interface::tree_builder::{ElementFlags, NodeOrText, QuirksMode, TreeSink};
use html5ever::tendril::StrTendril;
use html5ever::{Attribute, ExpandedName, LocalName, Namespace, QualName, local_name, ns};

/// Backing storage for one document: nodes in one arena, attribute lists
/// in another (so a start tag's attributes cost no allocation of their own
/// and are dropped in one sweep with everything else).
pub(crate) struct Arenas<'a> {
    nodes: typed_arena::Arena<Node<'a>>,
    attrs: typed_arena::Arena<Attribute>,
}

impl Arenas<'_> {
    pub(crate) fn with_capacity(nodes: usize) -> Self {
        Arenas {
            nodes: typed_arena::Arena::with_capacity(nodes),
            attrs: typed_arena::Arena::with_capacity(nodes),
        }
    }
}

pub(crate) type Arena<'a> = &'a Arenas<'a>;
pub(crate) type Ref<'a> = &'a Node<'a>;
type Link<'a> = Cell<Option<Ref<'a>>>;

/// Kept to 96 bytes (links + one cache line of payload): every pass over the
/// document is a pointer walk, so node size is traversal speed.
pub(crate) struct Node<'a> {
    pub(crate) parent: Link<'a>,
    pub(crate) previous_sibling: Link<'a>,
    pub(crate) next_sibling: Link<'a>,
    pub(crate) first_child: Link<'a>,
    pub(crate) last_child: Link<'a>,
    /// `Tag::NotAnElement` for non-element nodes.
    tag: Tag,
    /// Subtree facts (the `FLAG_*` constants), accumulated by the
    /// whitespace pass via [`contribute_flags`] once parsing is done.
    flags: Cell<u8>,
    mathml_annotation_xml_integration_point: bool,
    /// Distance from the document node at insertion time. Only maintained
    /// during parsing as a hint for the depth limiter; later re-parenting
    /// does not update it.
    depth: Cell<u32>,
    pub(crate) data: NodeData<'a>,
}

pub(crate) enum NodeData<'a> {
    Document,
    /// Doctype / comment / processing instruction. None of these produce
    /// Markdown, so their payloads are not retained.
    Ignored,
    Text(RefCell<StrTendril>),
    Element {
        ns: Namespace,
        local: LocalName,
        /// Lives in [`Arenas::attrs`]; replaced wholesale in the rare case
        /// the tree builder merges attributes into an existing element.
        attrs: Cell<&'a [Attribute]>,
    },
}

/// The subtree's text content is entirely (JS `\s`) whitespace.
pub(crate) const FLAG_WS_ONLY: u8 = 1 << 0;
/// Some strict descendant is a void element (`<img>`, `<br>`, …).
pub(crate) const FLAG_HAS_VOID: u8 = 1 << 1;
/// Some strict descendant is "meaningful when blank" (`<a>`, `<td>`, …).
pub(crate) const FLAG_HAS_MEANINGFUL: u8 = 1 << 2;
/// Some strict descendant is a `<table>`.
pub(crate) const FLAG_HAS_TABLE: u8 = 1 << 3;

const _: () = assert!(core::mem::size_of::<Node<'static>>() <= 88, "Node grew");

impl<'a> Node<'a> {
    fn new(data: NodeData<'a>, tag: Tag) -> Self {
        Node {
            parent: Cell::new(None),
            previous_sibling: Cell::new(None),
            next_sibling: Cell::new(None),
            first_child: Cell::new(None),
            last_child: Cell::new(None),
            tag,
            flags: Cell::new(FLAG_WS_ONLY),
            mathml_annotation_xml_integration_point: false,
            depth: Cell::new(0),
            data,
        }
    }

    #[inline]
    pub(crate) fn flags(&self) -> u8 {
        self.flags.get()
    }

    #[inline]
    pub(crate) fn set_flags(&self, flags: u8) {
        self.flags.set(flags);
    }

    #[inline]
    pub(crate) fn tag(&self) -> Tag {
        self.tag
    }

    #[inline]
    pub(crate) fn is_element(&self) -> bool {
        matches!(self.data, NodeData::Element { .. })
    }

    #[inline]
    pub(crate) fn as_text(&self) -> Option<&RefCell<StrTendril>> {
        match &self.data {
            NodeData::Text(t) => Some(t),
            _ => None,
        }
    }

    /// Value of the (namespace-less) attribute `name`, if present.
    pub(crate) fn attr(&self, name: &LocalName) -> Option<&'a str> {
        let NodeData::Element { attrs, .. } = &self.data else {
            return None;
        };
        attrs
            .get()
            .iter()
            .find(|a| a.name.local == *name && a.name.ns == ns!())
            .map(|a| &*a.value)
    }

    pub(crate) fn children(&self) -> Children<'a> {
        Children(self.first_child.get())
    }

    pub(crate) fn first_element_child(&self) -> Option<Ref<'a>> {
        self.children().find(|c| c.is_element())
    }

    pub(crate) fn last_element_child(&self) -> Option<Ref<'a>> {
        let mut node = self.last_child.get();
        while let Some(n) = node {
            if n.is_element() {
                return Some(n);
            }
            node = n.previous_sibling.get();
        }
        None
    }

    pub(crate) fn detach(&self) {
        let parent = self.parent.take();
        let previous_sibling = self.previous_sibling.take();
        let next_sibling = self.next_sibling.take();

        if let Some(next_sibling) = next_sibling {
            next_sibling.previous_sibling.set(previous_sibling);
        } else if let Some(parent) = parent {
            parent.last_child.set(previous_sibling);
        }

        if let Some(previous_sibling) = previous_sibling {
            previous_sibling.next_sibling.set(next_sibling);
        } else if let Some(parent) = parent {
            parent.first_child.set(next_sibling);
        }
    }

    fn append(&'a self, new_child: Ref<'a>) {
        new_child.detach();
        new_child.parent.set(Some(self));
        new_child.depth.set(self.depth.get() + 1);
        if let Some(last_child) = self.last_child.take() {
            new_child.previous_sibling.set(Some(last_child));
            debug_assert!(last_child.next_sibling.get().is_none());
            last_child.next_sibling.set(Some(new_child));
        } else {
            debug_assert!(self.first_child.get().is_none());
            self.first_child.set(Some(new_child));
        }
        self.last_child.set(Some(new_child));
    }

    fn insert_before(&'a self, new_sibling: Ref<'a>) {
        new_sibling.detach();
        new_sibling.parent.set(self.parent.get());
        new_sibling.depth.set(self.depth.get());
        new_sibling.next_sibling.set(Some(self));
        if let Some(previous_sibling) = self.previous_sibling.take() {
            new_sibling.previous_sibling.set(Some(previous_sibling));
            debug_assert!(ptr::eq::<Node>(
                previous_sibling.next_sibling.get().unwrap(),
                self
            ));
            previous_sibling.next_sibling.set(Some(new_sibling));
        } else if let Some(parent) = self.parent.get() {
            debug_assert!(ptr::eq::<Node>(parent.first_child.get().unwrap(), self));
            parent.first_child.set(Some(new_sibling));
        }
        self.previous_sibling.set(Some(new_sibling));
    }
}

pub(crate) struct Children<'a>(Option<Ref<'a>>);

impl<'a> Iterator for Children<'a> {
    type Item = Ref<'a>;
    #[inline]
    fn next(&mut self) -> Option<Ref<'a>> {
        let cur = self.0?;
        self.0 = cur.next_sibling.get();
        Some(cur)
    }
}

/// Pre-order successor of `node` within the subtree rooted at `root`
/// (`None` once the walk returns to `root`). `descend` controls whether
/// `node`'s own children are visited.
pub(crate) fn next_in_preorder<'a>(node: Ref<'a>, root: Ref<'a>, descend: bool) -> Option<Ref<'a>> {
    if descend {
        if let Some(c) = node.first_child.get() {
            return Some(c);
        }
    }
    let mut cur = node;
    loop {
        if ptr::eq(cur, root) {
            return None;
        }
        if let Some(s) = cur.next_sibling.get() {
            return Some(s);
        }
        cur = cur.parent.get()?;
    }
}

/// Folds a finished child's flags into its parent's. A node starts out as
/// `FLAG_WS_ONLY` with no `HAS_*` bits (the empty subtree); each child can
/// only clear the former and set the latter.
#[inline]
pub(crate) fn contribute_flags(parent: Ref<'_>, child: Ref<'_>) {
    if child.tag.is_skipped() {
        // Subtrees the converter drops (`<script>`, `<template>`, …) are
        // treated as absent throughout, so an element holding nothing else
        // is blank rather than an empty shell (`[](/x)`, a lone `-`).
        return;
    }
    let cf = child.flags.get();
    let mut f = parent.flags.get();
    f &= cf | !FLAG_WS_ONLY;
    f |= cf & (FLAG_HAS_VOID | FLAG_HAS_MEANINGFUL | FLAG_HAS_TABLE);
    let tag = child.tag;
    if tag.is_void() {
        f |= FLAG_HAS_VOID;
    }
    if tag.is_meaningful_when_blank() {
        f |= FLAG_HAS_MEANINGFUL;
    }
    if tag == Tag::Table {
        f |= FLAG_HAS_TABLE;
    }
    parent.flags.set(f);
}

/// Computes the `FLAG_*` bits for `root` and everything under it with one
/// iterative post-order walk. The whitespace pass does this incrementally
/// for the part of the tree it walks; this covers the subtrees it skips.
pub(crate) fn compute_subtree_flags(root: Ref<'_>) {
    let mut node = root;
    'outer: loop {
        while let Some(c) = node.first_child.get() {
            node = c;
        }
        loop {
            if let NodeData::Text(t) = &node.data {
                let ws_only = t.borrow().chars().all(super::text::is_js_whitespace);
                node.flags.set(if ws_only { FLAG_WS_ONLY } else { 0 });
            }
            if ptr::eq(node, root) {
                break 'outer;
            }
            let parent = node.parent.get().expect("walk stays under root");
            contribute_flags(parent, node);
            if let Some(s) = node.next_sibling.get() {
                node = s;
                continue 'outer;
            }
            node = parent;
        }
    }
}

pub(crate) struct Sink<'a> {
    arena: Arena<'a>,
    document: Ref<'a>,
    /// Depth of the most recently inserted element; see [`super::depth`].
    last_insert_depth: Cell<u32>,
    /// An emptied attribute vector (capacity intact) for the tokenizer to
    /// build the next tag's attributes in; see [`Sink::take_attr_buf`].
    spare_attrs: Cell<Vec<Attribute>>,
}

impl<'a> Sink<'a> {
    pub(crate) fn new(arena: Arena<'a>) -> Self {
        Sink {
            arena,
            document: arena
                .nodes
                .alloc(Node::new(NodeData::Document, Tag::NotAnElement)),
            last_insert_depth: Cell::new(0),
            spare_attrs: Cell::new(Vec::new()),
        }
    }

    #[inline]
    pub(crate) fn depth_hint(&self) -> u32 {
        self.last_insert_depth.get()
    }

    /// html5ever's `Tag` carries attributes as a `Vec`, so every start tag
    /// with attributes would cost an allocation and, at teardown, a free.
    /// Instead the vector's contents are moved into the attribute arena when
    /// the element is created and the empty vector is parked here for the
    /// tokenizer to pick up for the next tag: one buffer cycles between the
    /// two for the whole document.
    #[inline]
    pub(crate) fn take_attr_buf(&self) -> Vec<Attribute> {
        self.spare_attrs.take()
    }

    fn store_attrs(&self, mut attrs: Vec<Attribute>) -> &'a [Attribute] {
        if attrs.is_empty() {
            return &[];
        }
        let stored: &'a [Attribute] = self.arena.attrs.alloc_extend(attrs.drain(..));
        // Park the (now empty) buffer unless a roomier one is already there.
        let parked = self.spare_attrs.take();
        self.spare_attrs
            .set(if parked.capacity() > attrs.capacity() {
                parked
            } else {
                attrs
            });
        stored
    }

    #[inline]
    fn new_node(&self, data: NodeData<'a>, tag: Tag) -> Ref<'a> {
        self.arena.nodes.alloc(Node::new(data, tag))
    }

    fn append_common<P, A>(&self, child: NodeOrText<Ref<'a>>, previous: P, append: A)
    where
        P: FnOnce() -> Option<Ref<'a>>,
        A: FnOnce(Ref<'a>),
    {
        let new_node = match child {
            NodeOrText::AppendText(text) => {
                // Merge with an existing adjacent text node if there is one.
                if let Some(&Node {
                    data: NodeData::Text(ref contents),
                    ..
                }) = previous()
                {
                    contents.borrow_mut().push_tendril(&text);
                    return;
                }
                self.new_node(NodeData::Text(RefCell::new(text)), Tag::NotAnElement)
            }
            NodeOrText::AppendNode(node) => node,
        };
        append(new_node);
        if new_node.is_element() {
            self.last_insert_depth.set(new_node.depth.get());
        }
    }
}

impl<'a> TreeSink for Sink<'a> {
    type Handle = Ref<'a>;
    type Output = Ref<'a>;
    type ElemName<'b>
        = ExpandedName<'b>
    where
        Self: 'b;

    fn finish(self) -> Ref<'a> {
        self.document
    }

    fn parse_error(&self, _: Cow<'static, str>) {}

    fn get_document(&self) -> Ref<'a> {
        self.document
    }

    fn set_quirks_mode(&self, _mode: QuirksMode) {}

    fn same_node(&self, x: &Ref<'a>, y: &Ref<'a>) -> bool {
        ptr::eq::<Node>(*x, *y)
    }

    fn elem_name<'b>(&'b self, target: &'b Ref<'a>) -> ExpandedName<'b> {
        match &target.data {
            NodeData::Element { ns, local, .. } => ExpandedName { ns, local },
            _ => panic!("not an element"),
        }
    }

    /// `<template>` children are hung directly off the element (the
    /// converter skips the subtree either way), so no separate fragment
    /// node is allocated.
    fn get_template_contents(&self, target: &Ref<'a>) -> Ref<'a> {
        target
    }

    fn is_mathml_annotation_xml_integration_point(&self, target: &Ref<'a>) -> bool {
        target.mathml_annotation_xml_integration_point
    }

    fn create_element(
        &self,
        name: QualName,
        attrs: Vec<Attribute>,
        flags: ElementFlags,
    ) -> Ref<'a> {
        let tag = if name.ns == ns!(html) {
            Tag::from_local_name(&name.local)
        } else {
            Tag::Other
        };
        let attrs = self.store_attrs(attrs);
        self.arena.nodes.alloc(Node {
            mathml_annotation_xml_integration_point: flags.mathml_annotation_xml_integration_point,
            ..Node::new(
                NodeData::Element {
                    ns: name.ns,
                    local: name.local,
                    attrs: Cell::new(attrs),
                },
                tag,
            )
        })
    }

    fn create_comment(&self, _text: StrTendril) -> Ref<'a> {
        self.new_node(NodeData::Ignored, Tag::NotAnElement)
    }

    fn create_pi(&self, _target: StrTendril, _data: StrTendril) -> Ref<'a> {
        self.new_node(NodeData::Ignored, Tag::NotAnElement)
    }

    fn append(&self, parent: &Ref<'a>, child: NodeOrText<Ref<'a>>) {
        self.append_common(
            child,
            || parent.last_child.get(),
            |new_node| parent.append(new_node),
        )
    }

    fn append_before_sibling(&self, sibling: &Ref<'a>, child: NodeOrText<Ref<'a>>) {
        self.append_common(
            child,
            || sibling.previous_sibling.get(),
            |new_node| sibling.insert_before(new_node),
        )
    }

    fn append_based_on_parent_node(
        &self,
        element: &Ref<'a>,
        prev_element: &Ref<'a>,
        child: NodeOrText<Ref<'a>>,
    ) {
        if element.parent.get().is_some() {
            self.append_before_sibling(element, child)
        } else {
            self.append(prev_element, child)
        }
    }

    fn append_doctype_to_document(
        &self,
        _name: StrTendril,
        _public_id: StrTendril,
        _system_id: StrTendril,
    ) {
        self.document
            .append(self.new_node(NodeData::Ignored, Tag::NotAnElement));
    }

    fn add_attrs_if_missing(&self, target: &Ref<'a>, attrs: Vec<Attribute>) {
        let NodeData::Element {
            attrs: ref existing,
            ..
        } = target.data
        else {
            panic!("not an element")
        };
        // Only reached for a repeated `<html>`/`<body>` tag: rebuild the
        // list with the additions (the old slice stays in the arena).
        let current = existing.get();
        let mut merged: Vec<Attribute> = Vec::new();
        for attr in attrs {
            if !current.iter().any(|e| e.name == attr.name)
                && !merged.iter().any(|e| e.name == attr.name)
            {
                merged.push(attr);
            }
        }
        if merged.is_empty() {
            return;
        }
        let mut all = current.to_vec();
        all.append(&mut merged);
        existing.set(self.arena.attrs.alloc_extend(all));
    }

    fn remove_from_parent(&self, target: &Ref<'a>) {
        target.detach()
    }

    fn reparent_children(&self, node: &Ref<'a>, new_parent: &Ref<'a>) {
        let mut next_child = node.first_child.get();
        while let Some(child) = next_child {
            debug_assert!(ptr::eq::<Node>(child.parent.get().unwrap(), *node));
            next_child = child.next_sibling.get();
            new_parent.append(child)
        }
    }
}

/// HTML element names the converter distinguishes. Anything else in the
/// HTML namespace, and every foreign (SVG/MathML) element, is `Other`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub(crate) enum Tag {
    NotAnElement,
    Other,
    A,
    Address,
    Area,
    Article,
    Aside,
    Audio,
    B,
    Base,
    Blockquote,
    Body,
    Br,
    Canvas,
    Caption,
    Center,
    Code,
    Col,
    Colgroup,
    Command,
    Dd,
    Del,
    Details,
    Dialog,
    Dir,
    Div,
    Dl,
    Dt,
    Em,
    Embed,
    Fieldset,
    Figcaption,
    Figure,
    Footer,
    Form,
    Frameset,
    H1,
    H2,
    H3,
    H4,
    H5,
    H6,
    Head,
    Header,
    Hgroup,
    Hr,
    Html,
    I,
    Iframe,
    Img,
    Input,
    Isindex,
    Keygen,
    Li,
    Link,
    Main,
    Menu,
    Meta,
    Nav,
    Noframes,
    Noscript,
    Ol,
    Output,
    P,
    Param,
    Pre,
    S,
    Script,
    Section,
    Source,
    Strike,
    Strong,
    Style,
    Summary,
    Table,
    Tbody,
    Td,
    Template,
    Tfoot,
    Th,
    Thead,
    Title,
    Tr,
    Track,
    Ul,
    Video,
    Wbr,
}

impl Tag {
    pub(crate) fn from_local_name(name: &LocalName) -> Tag {
        // Static atoms compare as packed integers, so this is a jump table
        // rather than string comparisons.
        match *name {
            local_name!("a") => Tag::A,
            local_name!("address") => Tag::Address,
            local_name!("area") => Tag::Area,
            local_name!("article") => Tag::Article,
            local_name!("aside") => Tag::Aside,
            local_name!("audio") => Tag::Audio,
            local_name!("b") => Tag::B,
            local_name!("base") => Tag::Base,
            local_name!("blockquote") => Tag::Blockquote,
            local_name!("body") => Tag::Body,
            local_name!("br") => Tag::Br,
            local_name!("canvas") => Tag::Canvas,
            local_name!("caption") => Tag::Caption,
            local_name!("center") => Tag::Center,
            local_name!("code") => Tag::Code,
            local_name!("col") => Tag::Col,
            local_name!("colgroup") => Tag::Colgroup,
            local_name!("command") => Tag::Command,
            local_name!("dd") => Tag::Dd,
            local_name!("del") => Tag::Del,
            local_name!("details") => Tag::Details,
            local_name!("dialog") => Tag::Dialog,
            local_name!("dir") => Tag::Dir,
            local_name!("div") => Tag::Div,
            local_name!("dl") => Tag::Dl,
            local_name!("dt") => Tag::Dt,
            local_name!("em") => Tag::Em,
            local_name!("embed") => Tag::Embed,
            local_name!("fieldset") => Tag::Fieldset,
            local_name!("figcaption") => Tag::Figcaption,
            local_name!("figure") => Tag::Figure,
            local_name!("footer") => Tag::Footer,
            local_name!("form") => Tag::Form,
            local_name!("frameset") => Tag::Frameset,
            local_name!("h1") => Tag::H1,
            local_name!("h2") => Tag::H2,
            local_name!("h3") => Tag::H3,
            local_name!("h4") => Tag::H4,
            local_name!("h5") => Tag::H5,
            local_name!("h6") => Tag::H6,
            local_name!("head") => Tag::Head,
            local_name!("header") => Tag::Header,
            local_name!("hgroup") => Tag::Hgroup,
            local_name!("hr") => Tag::Hr,
            local_name!("html") => Tag::Html,
            local_name!("i") => Tag::I,
            local_name!("iframe") => Tag::Iframe,
            local_name!("img") => Tag::Img,
            local_name!("input") => Tag::Input,
            local_name!("isindex") => Tag::Isindex,
            local_name!("keygen") => Tag::Keygen,
            local_name!("li") => Tag::Li,
            local_name!("link") => Tag::Link,
            local_name!("main") => Tag::Main,
            local_name!("menu") => Tag::Menu,
            local_name!("meta") => Tag::Meta,
            local_name!("nav") => Tag::Nav,
            local_name!("noframes") => Tag::Noframes,
            local_name!("noscript") => Tag::Noscript,
            local_name!("ol") => Tag::Ol,
            local_name!("output") => Tag::Output,
            local_name!("p") => Tag::P,
            local_name!("param") => Tag::Param,
            local_name!("pre") => Tag::Pre,
            local_name!("s") => Tag::S,
            local_name!("script") => Tag::Script,
            local_name!("section") => Tag::Section,
            local_name!("source") => Tag::Source,
            local_name!("strike") => Tag::Strike,
            local_name!("strong") => Tag::Strong,
            local_name!("style") => Tag::Style,
            local_name!("summary") => Tag::Summary,
            local_name!("table") => Tag::Table,
            local_name!("tbody") => Tag::Tbody,
            local_name!("td") => Tag::Td,
            local_name!("template") => Tag::Template,
            local_name!("tfoot") => Tag::Tfoot,
            local_name!("th") => Tag::Th,
            local_name!("thead") => Tag::Thead,
            local_name!("title") => Tag::Title,
            local_name!("tr") => Tag::Tr,
            local_name!("track") => Tag::Track,
            local_name!("ul") => Tag::Ul,
            local_name!("video") => Tag::Video,
            local_name!("wbr") => Tag::Wbr,
            _ => Tag::Other,
        }
    }

    /// turndown's `blockElements`, plus the HTML5 sectioning elements it
    /// predates (`details`, `summary`, `dialog`). Block-ness only decides
    /// where blank lines go, so the additions are whitespace-only changes.
    pub(crate) fn is_block(self) -> bool {
        use Tag::*;
        matches!(
            self,
            Address
                | Article
                | Aside
                | Audio
                | Blockquote
                | Body
                | Canvas
                | Center
                | Dd
                | Details
                | Dialog
                | Dir
                | Div
                | Dl
                | Dt
                | Fieldset
                | Figcaption
                | Figure
                | Footer
                | Form
                | Frameset
                | H1
                | H2
                | H3
                | H4
                | H5
                | H6
                | Header
                | Hgroup
                | Hr
                | Html
                | Isindex
                | Li
                | Main
                | Menu
                | Nav
                | Noframes
                | Noscript
                | Ol
                | Output
                | P
                | Pre
                | Section
                | Summary
                | Table
                | Tbody
                | Td
                | Tfoot
                | Th
                | Thead
                | Tr
                | Ul
        )
    }

    pub(crate) fn is_void(self) -> bool {
        use Tag::*;
        matches!(
            self,
            Area | Base
                | Br
                | Col
                | Command
                | Embed
                | Hr
                | Img
                | Input
                | Keygen
                | Link
                | Meta
                | Param
                | Source
                | Track
                | Wbr
        )
    }

    /// Elements turndown never treats as blank even with no text content.
    pub(crate) fn is_meaningful_when_blank(self) -> bool {
        use Tag::*;
        matches!(
            self,
            A | Table | Thead | Tbody | Tfoot | Th | Td | Iframe | Script | Audio | Video
        )
    }

    /// Elements whose entire subtree is dropped: they never carry prose, and
    /// leaving `<script>`/`<style>` bodies in would bury the page text.
    pub(crate) fn is_skipped(self) -> bool {
        use Tag::*;
        matches!(self, Script | Style | Template | Noscript | Head | Title)
    }

    pub(crate) fn heading_level(self) -> Option<u8> {
        use Tag::*;
        match self {
            H1 => Some(1),
            H2 => Some(2),
            H3 => Some(3),
            H4 => Some(4),
            H5 => Some(5),
            H6 => Some(6),
            _ => None,
        }
    }
}
