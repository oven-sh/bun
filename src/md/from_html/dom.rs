//! Arena-backed DOM the tree builder ([`super::tree`]) writes into.
//!
//! Nodes are bump-allocated in a `typed_arena::Arena` and linked with
//! `Cell<Option<&Node>>` pointers. Handles are plain shared references, text
//! and attribute strings live in a byte arena beside the nodes, and dropping
//! the arenas frees everything in a few flat sweeps — there is no recursive
//! `Drop`, so pathological nesting cannot overflow the stack on teardown.

use core::cell::{Cell, RefCell};
use core::marker::PhantomData;
use core::ptr::{self, NonNull};

/// Backing storage for one document.
pub(crate) struct Arenas<'a> {
    nodes: typed_arena::Arena<Node<'a>>,
    attrs: typed_arena::Arena<Attr<'a>>,
    strs: ByteArena,
}

impl<'a> Arenas<'a> {
    pub(crate) fn with_capacity(nodes: usize, text_bytes: usize) -> Self {
        Arenas {
            nodes: typed_arena::Arena::with_capacity(nodes),
            attrs: typed_arena::Arena::with_capacity(nodes / 4),
            strs: ByteArena::with_capacity(text_bytes),
        }
    }

    pub(crate) fn alloc_str(&'a self, s: &str) -> &'a str {
        if s.is_empty() {
            return "";
        }
        let buf = self.strs.alloc(s.len());
        buf.copy_from_slice(s.as_bytes());
        // SAFETY: copied from a `str`.
        unsafe { core::str::from_utf8_unchecked(buf) }
    }

    /// `bytes` copied and ASCII-lowercased (`""` if not UTF-8, which input
    /// validated up front never produces).
    pub(crate) fn alloc_ascii_lowercase(&'a self, bytes: &[u8]) -> &'a str {
        let Ok(s) = core::str::from_utf8(bytes) else {
            return "";
        };
        let buf = self.strs.alloc(s.len());
        for (d, b) in buf.iter_mut().zip(s.bytes()) {
            *d = b.to_ascii_lowercase();
        }
        // SAFETY: ASCII-lowercasing valid UTF-8 keeps it valid.
        unsafe { core::str::from_utf8_unchecked(buf) }
    }

    pub(crate) fn new_document(&'a self) -> Ref<'a> {
        self.nodes
            .alloc(Node::new(NodeData::Document, Tag::NotAnElement))
    }

    pub(crate) fn new_ignored(&'a self) -> Ref<'a> {
        self.nodes
            .alloc(Node::new(NodeData::Ignored, Tag::NotAnElement))
    }

    /// `tag` is `Other` for foreign elements whatever their name. `attrs`
    /// are copied into the attribute arena.
    pub(crate) fn new_element(&'a self, tag: Tag, html: bool, attrs: &[Attr<'a>]) -> Ref<'a> {
        debug_assert!(html || tag == Tag::Other);
        let attrs: &'a [Attr<'a>] = if attrs.is_empty() {
            &[]
        } else {
            self.attrs.alloc_extend(attrs.iter().copied())
        };
        self.nodes
            .alloc(Node::new(NodeData::Element { html, attrs }, tag))
    }

    /// A fresh element with the same name and attributes as `node` (the
    /// tree builder's "create an element for the token" when it reopens a
    /// formatting element).
    pub(crate) fn clone_element(&'a self, node: Ref<'a>) -> Ref<'a> {
        match node.data {
            NodeData::Element { html, attrs } => self
                .nodes
                .alloc(Node::new(NodeData::Element { html, attrs }, node.tag)),
            _ => unreachable!("clone_element on a non-element"),
        }
    }

    /// Appends text to `parent`, merging with a trailing text child.
    pub(crate) fn append_text(&'a self, parent: Ref<'a>, text: &str) {
        if let Some(prev) = parent.last_child.get()
            && let NodeData::Text(t) = &prev.data
        {
            t.push_str(self, text);
            return;
        }
        parent.append(self.new_text(text));
    }

    /// Inserts text before `sibling`, merging with a preceding text node.
    pub(crate) fn insert_text_before(&'a self, sibling: Ref<'a>, text: &str) {
        if let Some(prev) = sibling.previous_sibling.get()
            && let NodeData::Text(t) = &prev.data
        {
            t.push_str(self, text);
            return;
        }
        sibling.insert_before(self.new_text(text));
    }

    fn new_text(&'a self, text: &str) -> Ref<'a> {
        let t = Text::default();
        t.set(self.alloc_str(text));
        self.nodes
            .alloc(Node::new(NodeData::Text(t), Tag::NotAnElement))
    }
}

/// Bump allocator for the document's text and attribute bytes: hands out
/// zeroed `&mut [u8]` runs from large chunks and frees them all on drop.
/// (`typed_arena::Arena<u8>` fills byte by byte through an iterator, which
/// showed up as the largest line in the profile after the tokenizer.)
struct ByteArena {
    /// Owned allocations (from `Box<[u8]>::into_raw`), freed on drop. Kept
    /// as raw pointers so that no `Box` is moved while slices into it are
    /// live.
    chunks: RefCell<Vec<(*mut u8, usize)>>,
    /// Unused tail of the last chunk: `next..end`.
    next: Cell<*mut u8>,
    end: Cell<*mut u8>,
}

impl ByteArena {
    const MIN_CHUNK: usize = 64 << 10;

    fn with_capacity(bytes: usize) -> Self {
        let arena = ByteArena {
            chunks: RefCell::new(Vec::new()),
            next: Cell::new(ptr::null_mut()),
            end: Cell::new(ptr::null_mut()),
        };
        arena.grow(bytes);
        arena
    }

    fn grow(&self, at_least: usize) {
        let size = at_least.max(Self::MIN_CHUNK);
        let start = Box::into_raw(vec![0u8; size].into_boxed_slice()).cast::<u8>();
        self.chunks.borrow_mut().push((start, size));
        self.next.set(start);
        // SAFETY: one past the end of the allocation just made.
        self.end.set(unsafe { start.add(size) });
    }

    /// `len` zeroed bytes, valid for as long as the arena is.
    #[allow(clippy::mut_from_ref)] // each call hands out a disjoint region
    fn alloc(&self, len: usize) -> &mut [u8] {
        if (self.end.get() as usize) - (self.next.get() as usize) < len {
            self.grow(len);
        }
        let start = self.next.get();
        // SAFETY: `start..start+len` lies within the last chunk (checked or
        // grown above), chunks are neither moved nor freed before `self`
        // is dropped, and `next` is bumped past the region so it is never
        // handed out twice.
        unsafe {
            self.next.set(start.add(len));
            core::slice::from_raw_parts_mut(start, len)
        }
    }
}

impl Drop for ByteArena {
    fn drop(&mut self) {
        for &(start, size) in self.chunks.get_mut().iter() {
            // SAFETY: exactly the pointer/length pair `Box::into_raw` gave.
            drop(unsafe { Box::from_raw(ptr::slice_from_raw_parts_mut(start, size)) });
        }
    }
}

pub(crate) type Arena<'a> = &'a Arenas<'a>;
pub(crate) type Ref<'a> = &'a Node<'a>;
type Link<'a> = Cell<Option<Ref<'a>>>;

/// One attribute. Only the attributes the converter reads are kept (see
/// [`super::tree`]); values are entity-decoded.
#[derive(Clone, Copy)]
pub(crate) struct Attr<'a> {
    pub(crate) name: &'a str,
    pub(crate) value: &'a str,
}

/// A text node's content: a string in the byte arena (or a `'static` one).
/// The tree builder appends to it as character tokens arrive — in place
/// while the allocation behind it has room, otherwise into a fresh,
/// geometrically larger one, so a text node assembled from many pieces costs
/// amortised linear space — and the whitespace pass later swaps in its
/// collapsed form with [`Text::set`].
pub(crate) struct Text<'a> {
    ptr: Cell<NonNull<u8>>,
    len: Cell<usize>,
    /// Writable bytes at `ptr` (zero when `ptr` came from a shared `&str`).
    cap: Cell<usize>,
    _marker: PhantomData<&'a str>,
}

impl Default for Text<'_> {
    fn default() -> Self {
        Text {
            ptr: Cell::new(NonNull::dangling()),
            len: Cell::new(0),
            cap: Cell::new(0),
            _marker: PhantomData,
        }
    }
}

impl<'a> Text<'a> {
    #[inline]
    pub(crate) fn get(&self) -> &'a str {
        // SAFETY: `ptr[..len]` is always either a `&'a str` handed to `set`
        // or arena bytes `push_str` copied whole `str`s into.
        unsafe {
            core::str::from_utf8_unchecked(core::slice::from_raw_parts(
                self.ptr.get().as_ptr(),
                self.len.get(),
            ))
        }
    }

    #[inline]
    pub(crate) fn set(&self, s: &'a str) {
        self.ptr.set(NonNull::from(s.as_bytes()).cast());
        self.len.set(s.len());
        self.cap.set(0); // read-only provenance: the next append must copy
    }

    fn push_str(&self, arena: &'a Arenas<'a>, s: &str) {
        let len = self.len.get();
        let new_len = len + s.len();
        if new_len > self.cap.get() {
            let cap = new_len.max(len.saturating_mul(2)).max(16);
            let buf = arena.strs.alloc(cap);
            buf[..len].copy_from_slice(self.get().as_bytes());
            self.ptr.set(NonNull::from(&mut *buf).cast());
            self.cap.set(cap);
        }
        // SAFETY: `ptr` has `cap >= new_len` writable bytes (it came from
        // the arena's `&mut [u8]` above, now or on an earlier call), and no
        // `&str` handed out by `get` extends past `len`.
        unsafe {
            core::ptr::copy_nonoverlapping(s.as_ptr(), self.ptr.get().as_ptr().add(len), s.len())
        };
        self.len.set(new_len);
    }
}

/// Kept small (five links plus payload): every pass over the document is a
/// pointer walk, so node size is traversal speed.
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
    pub(crate) data: NodeData<'a>,
}

pub(crate) enum NodeData<'a> {
    Document,
    /// Comment / doctype. Neither produces Markdown, but a comment still
    /// separates the text nodes on either side of it, as it does in a DOM.
    Ignored,
    Text(Text<'a>),
    Element {
        /// In the HTML namespace (as opposed to SVG / MathML).
        html: bool,
        attrs: &'a [Attr<'a>],
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
    pub(crate) fn as_text(&self) -> Option<&Text<'a>> {
        match &self.data {
            NodeData::Text(t) => Some(t),
            _ => None,
        }
    }

    pub(crate) fn attrs(&self) -> &'a [Attr<'a>] {
        match self.data {
            NodeData::Element { attrs, .. } => attrs,
            _ => &[],
        }
    }

    /// Value of the attribute `name`, if present. Only the attributes the
    /// tree builder keeps for this kind of element are visible (see
    /// `tree::Builder::take_attrs`); reading a new one means listing it there.
    pub(crate) fn attr(&self, name: &str) -> Option<&'a str> {
        self.attrs()
            .iter()
            .find(|a| a.name == name)
            .map(|a| a.value)
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

    pub(crate) fn append(&'a self, new_child: Ref<'a>) {
        new_child.detach();
        new_child.parent.set(Some(self));
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

    pub(crate) fn insert_before(&'a self, new_sibling: Ref<'a>) {
        new_sibling.detach();
        new_sibling.parent.set(self.parent.get());
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

    /// Moves all of `self`'s children to the end of `new_parent`.
    pub(crate) fn reparent_children(&self, new_parent: Ref<'a>) {
        let mut next_child = self.first_child.get();
        while let Some(child) = next_child {
            next_child = child.next_sibling.get();
            new_parent.append(child)
        }
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
                let ws_only = t.get().chars().all(super::text::is_js_whitespace);
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

/// Declares [`Tag`]: the HTML element names the converter or the tree
/// builder distinguish, each with the tokenizer's packed form of its name
/// (`lol_html`'s `LocalNameHash`) so a scanned tag maps to a variant by
/// integer `match` rather than by string.
macro_rules! html_tags {
    ($($variant:ident = $name:literal,)*) => {
        /// An HTML element name the converter knows. Anything else in the
        /// HTML namespace, and every foreign (SVG/MathML) element, is `Other`.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub(crate) enum Tag {
            NotAnElement,
            Other,
            $($variant,)*
        }

        impl Tag {
            /// Number of variants (for tables indexed by `tag as usize`).
            pub(crate) const COUNT: usize = 2 + [$(Tag::$variant,)*].len();

            /// From `lol_html::transform::LocalNameHash::as_u64`.
            pub(crate) fn from_name_hash(hash: u64) -> Tag {
                $(
                    #[allow(non_upper_case_globals)]
                    const $variant: u64 = lol_html::transform::LocalNameHash::from_ascii($name).as_u64();
                )*
                match hash {
                    $($variant => Tag::$variant,)*
                    _ => Tag::Other,
                }
            }
        }
    };
}

html_tags! {
    A = b"a",
    Abbr = b"abbr",
    Address = b"address",
    Annotation = b"annotation",
    Applet = b"applet",
    Area = b"area",
    Article = b"article",
    Aside = b"aside",
    Audio = b"audio",
    B = b"b",
    Base = b"base",
    Basefont = b"basefont",
    Bdi = b"bdi",
    Bdo = b"bdo",
    Bgsound = b"bgsound",
    Big = b"big",
    Blockquote = b"blockquote",
    Body = b"body",
    Br = b"br",
    Button = b"button",
    Canvas = b"canvas",
    Caption = b"caption",
    Center = b"center",
    Circle = b"circle",
    Cite = b"cite",
    Clippath = b"clippath",
    Code = b"code",
    Col = b"col",
    Colgroup = b"colgroup",
    Command = b"command",
    Data = b"data",
    Dd = b"dd",
    Defs = b"defs",
    Del = b"del",
    Desc = b"desc",
    Details = b"details",
    Dfn = b"dfn",
    Dialog = b"dialog",
    Dir = b"dir",
    Div = b"div",
    Dl = b"dl",
    Dt = b"dt",
    Ellipse = b"ellipse",
    Em = b"em",
    Embed = b"embed",
    Fieldset = b"fieldset",
    Figcaption = b"figcaption",
    Figure = b"figure",
    Filter = b"filter",
    Font = b"font",
    Footer = b"footer",
    Form = b"form",
    Frame = b"frame",
    Frameset = b"frameset",
    G = b"g",
    H1 = b"h1",
    H2 = b"h2",
    H3 = b"h3",
    H4 = b"h4",
    H5 = b"h5",
    H6 = b"h6",
    Head = b"head",
    Header = b"header",
    Hgroup = b"hgroup",
    Hr = b"hr",
    Html = b"html",
    I = b"i",
    Iframe = b"iframe",
    Image = b"image",
    Img = b"img",
    Input = b"input",
    Ins = b"ins",
    Isindex = b"isindex",
    Kbd = b"kbd",
    Keygen = b"keygen",
    Label = b"label",
    Legend = b"legend",
    Li = b"li",
    Line = b"line",
    Link = b"link",
    Listing = b"listing",
    Main = b"main",
    Mark = b"mark",
    Marquee = b"marquee",
    Mask = b"mask",
    Math = b"math",
    Menu = b"menu",
    Meta = b"meta",
    Meter = b"meter",
    Mfrac = b"mfrac",
    Mi = b"mi",
    Mn = b"mn",
    Mo = b"mo",
    Mrow = b"mrow",
    Ms = b"ms",
    Msub = b"msub",
    Msup = b"msup",
    Mtext = b"mtext",
    Nav = b"nav",
    Nobr = b"nobr",
    Noembed = b"noembed",
    Noframes = b"noframes",
    Noscript = b"noscript",
    Object = b"object",
    Ol = b"ol",
    Optgroup = b"optgroup",
    Option = b"option",
    Output = b"output",
    P = b"p",
    Param = b"param",
    Path = b"path",
    Pattern = b"pattern",
    Picture = b"picture",
    Plaintext = b"plaintext",
    Polygon = b"polygon",
    Polyline = b"polyline",
    Pre = b"pre",
    Progress = b"progress",
    Q = b"q",
    Rb = b"rb",
    Rect = b"rect",
    Rp = b"rp",
    Rt = b"rt",
    Rtc = b"rtc",
    Ruby = b"ruby",
    S = b"s",
    Samp = b"samp",
    Script = b"script",
    Search = b"search",
    Section = b"section",
    Select = b"select",
    Semantics = b"semantics",
    Slot = b"slot",
    Small = b"small",
    Source = b"source",
    Span = b"span",
    Stop = b"stop",
    Strike = b"strike",
    Strong = b"strong",
    Style = b"style",
    Sub = b"sub",
    Summary = b"summary",
    Sup = b"sup",
    Svg = b"svg",
    Symbol = b"symbol",
    Table = b"table",
    Tbody = b"tbody",
    Td = b"td",
    Template = b"template",
    SvgText = b"text",
    Textarea = b"textarea",
    Tfoot = b"tfoot",
    Th = b"th",
    Thead = b"thead",
    Time = b"time",
    Title = b"title",
    Tr = b"tr",
    Track = b"track",
    Tspan = b"tspan",
    Tt = b"tt",
    U = b"u",
    Ul = b"ul",
    Use = b"use",
    Var = b"var",
    Video = b"video",
    Wbr = b"wbr",
    Xmp = b"xmp",
}

impl Tag {
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
