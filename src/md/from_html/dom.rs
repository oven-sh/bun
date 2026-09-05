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
use html5ever::{Attribute, LocalName, QualName, ns};

pub(crate) type Arena<'a> = &'a typed_arena::Arena<Node<'a>>;
pub(crate) type Ref<'a> = &'a Node<'a>;
type Link<'a> = Cell<Option<Ref<'a>>>;

pub(crate) struct Node<'a> {
    pub(crate) parent: Link<'a>,
    pub(crate) previous_sibling: Link<'a>,
    pub(crate) next_sibling: Link<'a>,
    pub(crate) first_child: Link<'a>,
    pub(crate) last_child: Link<'a>,
    pub(crate) data: NodeData<'a>,
    /// Distance from the document node at insertion time. Only maintained
    /// during parsing as a hint for the depth limiter; later re-parenting
    /// does not update it.
    depth: Cell<u32>,
    /// Subtree facts filled in by [`compute_subtree_flags`] after parsing;
    /// see the `FLAG_*` constants.
    flags: Cell<u8>,
}

pub(crate) enum NodeData<'a> {
    Document,
    /// Doctype / comment / processing instruction. None of these produce
    /// Markdown, so their payloads are not retained.
    Ignored,
    Text(RefCell<StrTendril>),
    Element {
        name: QualName,
        tag: Tag,
        attrs: RefCell<Vec<Attribute>>,
        template_contents: Option<Ref<'a>>,
        mathml_annotation_xml_integration_point: bool,
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

impl<'a> Node<'a> {
    fn new(data: NodeData<'a>) -> Self {
        Node {
            parent: Cell::new(None),
            previous_sibling: Cell::new(None),
            next_sibling: Cell::new(None),
            first_child: Cell::new(None),
            last_child: Cell::new(None),
            data,
            depth: Cell::new(0),
            flags: Cell::new(0),
        }
    }

    #[inline]
    pub(crate) fn flags(&self) -> u8 {
        self.flags.get()
    }

    #[inline]
    pub(crate) fn tag(&self) -> Tag {
        match self.data {
            NodeData::Element { tag, .. } => tag,
            _ => Tag::NotAnElement,
        }
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
    pub(crate) fn attr(&self, name: &LocalName) -> Option<core::cell::Ref<'_, str>> {
        let NodeData::Element { attrs, .. } = &self.data else {
            return None;
        };
        let attrs = attrs.borrow();
        let idx = attrs
            .iter()
            .position(|a| a.name.local == *name && a.name.ns == ns!())?;
        Some(core::cell::Ref::map(attrs, |a| &*a[idx].value))
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

/// Fills in every node's `FLAG_*` bits under `root` with one iterative
/// post-order walk, so `is_blank`-style queries during emission are O(1)
/// instead of re-scanning each subtree (which would be quadratic on deep
/// documents).
pub(crate) fn compute_subtree_flags(root: Ref<'_>) {
    // Iterative post-order: descend to the leftmost leaf, finish it, then
    // either step to the next sibling (and descend again) or finish the
    // parent on the way back up.
    let mut node = root;
    'outer: loop {
        while let Some(c) = node.first_child.get() {
            node = c;
        }
        loop {
            finish(node);
            if ptr::eq(node, root) {
                break 'outer;
            }
            if let Some(s) = node.next_sibling.get() {
                node = s;
                continue 'outer;
            }
            node = node.parent.get().expect("walk stays under root");
        }
    }

    fn finish(node: Ref<'_>) {
        let flags = match &node.data {
            NodeData::Text(t) => {
                if t.borrow().chars().all(super::text::is_js_whitespace) {
                    FLAG_WS_ONLY
                } else {
                    0
                }
            }
            NodeData::Ignored => FLAG_WS_ONLY,
            NodeData::Document | NodeData::Element { .. } => {
                let mut f = FLAG_WS_ONLY;
                for c in node.children() {
                    let cf = c.flags();
                    f &= cf | !FLAG_WS_ONLY;
                    f |= cf & (FLAG_HAS_VOID | FLAG_HAS_MEANINGFUL | FLAG_HAS_TABLE);
                    let tag = c.tag();
                    if tag.is_void() {
                        f |= FLAG_HAS_VOID;
                    }
                    if tag.is_meaningful_when_blank() {
                        f |= FLAG_HAS_MEANINGFUL;
                    }
                    if tag == Tag::Table {
                        f |= FLAG_HAS_TABLE;
                    }
                }
                f
            }
        };
        node.flags.set(flags);
    }
}

pub(crate) struct Sink<'a> {
    arena: Arena<'a>,
    document: Ref<'a>,
    /// Depth of the most recently inserted element; see [`super::depth`].
    last_insert_depth: Cell<u32>,
}

impl<'a> Sink<'a> {
    pub(crate) fn new(arena: Arena<'a>) -> Self {
        Sink {
            arena,
            document: arena.alloc(Node::new(NodeData::Document)),
            last_insert_depth: Cell::new(0),
        }
    }

    #[inline]
    pub(crate) fn depth_hint(&self) -> u32 {
        self.last_insert_depth.get()
    }

    #[inline]
    fn new_node(&self, data: NodeData<'a>) -> Ref<'a> {
        self.arena.alloc(Node::new(data))
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
                self.new_node(NodeData::Text(RefCell::new(text)))
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
        = &'b QualName
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

    fn elem_name<'b>(&'b self, target: &'b Ref<'a>) -> &'b QualName {
        match target.data {
            NodeData::Element { ref name, .. } => name,
            _ => panic!("not an element"),
        }
    }

    fn get_template_contents(&self, target: &Ref<'a>) -> Ref<'a> {
        if let NodeData::Element {
            template_contents: Some(contents),
            ..
        } = target.data
        {
            contents
        } else {
            panic!("not a template element")
        }
    }

    fn is_mathml_annotation_xml_integration_point(&self, target: &Ref<'a>) -> bool {
        if let NodeData::Element {
            mathml_annotation_xml_integration_point,
            ..
        } = target.data
        {
            mathml_annotation_xml_integration_point
        } else {
            panic!("not an element")
        }
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
        self.new_node(NodeData::Element {
            name,
            tag,
            attrs: RefCell::new(attrs),
            template_contents: if flags.template {
                Some(self.new_node(NodeData::Document))
            } else {
                None
            },
            mathml_annotation_xml_integration_point: flags.mathml_annotation_xml_integration_point,
        })
    }

    fn create_comment(&self, _text: StrTendril) -> Ref<'a> {
        self.new_node(NodeData::Ignored)
    }

    fn create_pi(&self, _target: StrTendril, _data: StrTendril) -> Ref<'a> {
        self.new_node(NodeData::Ignored)
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
        self.document.append(self.new_node(NodeData::Ignored));
    }

    fn add_attrs_if_missing(&self, target: &Ref<'a>, attrs: Vec<Attribute>) {
        let NodeData::Element {
            attrs: ref existing,
            ..
        } = target.data
        else {
            panic!("not an element")
        };
        let mut existing = existing.borrow_mut();
        for attr in attrs {
            if !existing.iter().any(|e| e.name == attr.name) {
                existing.push(attr);
            }
        }
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
    fn from_local_name(name: &LocalName) -> Tag {
        match &**name {
            "a" => Tag::A,
            "address" => Tag::Address,
            "area" => Tag::Area,
            "article" => Tag::Article,
            "aside" => Tag::Aside,
            "audio" => Tag::Audio,
            "b" => Tag::B,
            "base" => Tag::Base,
            "blockquote" => Tag::Blockquote,
            "body" => Tag::Body,
            "br" => Tag::Br,
            "canvas" => Tag::Canvas,
            "caption" => Tag::Caption,
            "center" => Tag::Center,
            "code" => Tag::Code,
            "col" => Tag::Col,
            "colgroup" => Tag::Colgroup,
            "command" => Tag::Command,
            "dd" => Tag::Dd,
            "del" => Tag::Del,
            "details" => Tag::Details,
            "dialog" => Tag::Dialog,
            "dir" => Tag::Dir,
            "div" => Tag::Div,
            "dl" => Tag::Dl,
            "dt" => Tag::Dt,
            "em" => Tag::Em,
            "embed" => Tag::Embed,
            "fieldset" => Tag::Fieldset,
            "figcaption" => Tag::Figcaption,
            "figure" => Tag::Figure,
            "footer" => Tag::Footer,
            "form" => Tag::Form,
            "frameset" => Tag::Frameset,
            "h1" => Tag::H1,
            "h2" => Tag::H2,
            "h3" => Tag::H3,
            "h4" => Tag::H4,
            "h5" => Tag::H5,
            "h6" => Tag::H6,
            "head" => Tag::Head,
            "header" => Tag::Header,
            "hgroup" => Tag::Hgroup,
            "hr" => Tag::Hr,
            "html" => Tag::Html,
            "i" => Tag::I,
            "iframe" => Tag::Iframe,
            "img" => Tag::Img,
            "input" => Tag::Input,
            "isindex" => Tag::Isindex,
            "keygen" => Tag::Keygen,
            "li" => Tag::Li,
            "link" => Tag::Link,
            "main" => Tag::Main,
            "menu" => Tag::Menu,
            "meta" => Tag::Meta,
            "nav" => Tag::Nav,
            "noframes" => Tag::Noframes,
            "noscript" => Tag::Noscript,
            "ol" => Tag::Ol,
            "output" => Tag::Output,
            "p" => Tag::P,
            "param" => Tag::Param,
            "pre" => Tag::Pre,
            "s" => Tag::S,
            "script" => Tag::Script,
            "section" => Tag::Section,
            "source" => Tag::Source,
            "strike" => Tag::Strike,
            "strong" => Tag::Strong,
            "style" => Tag::Style,
            "summary" => Tag::Summary,
            "table" => Tag::Table,
            "tbody" => Tag::Tbody,
            "td" => Tag::Td,
            "template" => Tag::Template,
            "tfoot" => Tag::Tfoot,
            "th" => Tag::Th,
            "thead" => Tag::Thead,
            "title" => Tag::Title,
            "tr" => Tag::Tr,
            "track" => Tag::Track,
            "ul" => Tag::Ul,
            "video" => Tag::Video,
            "wbr" => Tag::Wbr,
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
