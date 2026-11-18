//! A node is its JavaScript object, which has the links that keep the tree alive, and a slot in the arena.

use core::any::TypeId;
use core::cell::{Cell, UnsafeCell};
use core::cmp::Ordering;
use core::iter::successors;
use core::marker::PhantomData;
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsInterface, JsLocal, JsPayload, JsScope};

use super::arena::Arena;
use super::steps::Has;
use super::{
    CharacterData, Doc, DocumentFragment, DomString, Edge, Element, EventTarget, Kind, Known, List,
    NodeType, ShadowRoot, StringBuilder, Text,
};
use crate::document::Document;
use crate::generated_bindgen::core::js_Node;
use crate::tree::{DOCUMENT, Data, NodeId, Tree};

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(crate) struct NodeFlags: u32 {
        const CONNECTED = 1;
        const SHADOW_ROOT = 1 << 1;
        const HOST = 1 << 2;
        /// On a shadow root and on what is in it.
        const USER_AGENT = 1 << 3;
        const CUSTOM = 1 << 4;
        const UNDEFINED = 1 << 5;
        /// The attribute does not say what `style` has.
        const STYLE_DIRTY = 1 << 6;
        const OBSERVED = 1 << 7;
        const HAS_RANGES = 1 << 8;
        const CHILD_CACHE = 1 << 9;
        const SLOT = 1 << 10;
        /// It is in the document of a window.
        const RENDERED = 1 << 11;
        const HAS_ID = 1 << 12;
        const FAILED_CUSTOM = 1 << 13;
        const BLOCKS_WHEEL = 1 << 14;
        /// For its size or its intersections.
        const WATCHED = 1 << 15;
        /// It can be a property of the document.
        const NAMED = 1 << 16;
        const HAS_NAMESPACED_ATTR = 1 << 17;
        const AUTOFOCUS = 1 << 18;
        /// It has children, and `first` and `last` are empty.
        const HAS_BARE_CHILDREN = 1 << 19;
        const HAS_ATTR_NODES = 1 << 20;
        /// A descendant of a `select`, which hears of what changes in it.
        const IN_SELECT = 1 << 21;
        const CHILD_NODES_ARE_CACHED = 1 << 22;
        const CHILDREN_ARE_CACHED = 1 << 23;
        /// By an animation or a timeline that a script has.
        const ANIMATED = 1 << 24;
        /// A slot that is going to get `slotchange`.
        const IS_SIGNALED = 1 << 25;
        const HAS_NONCE = 1 << 30;
        const HAS_EXPLICIT_ELEMENTS = 1 << 27;
        /// The parser has yet to run its `finished_parsing` steps.
        const BEING_PARSED = 1 << 26;
        const AWAITS_CONNECTION_STEPS = 1 << 28;
        const SHOWS_AS_POPOVER = 1 << 29;
        /// `forms::dormant`
        const DORMANT = 1 << 31;
    }
}

/// In the order of `internalFields`. `null` stands for no node. `First` and `Last` are empty while the children are bare.
#[derive(Clone, Copy)]
pub(super) enum Link {
    First,
    Next,
    Parent,
    Last,
    Previous,
    Document,
    Rare,
}

/// More are looked up in a list.
const FEW_CHILDREN: usize = 16;

#[repr(C)]
struct Extra<T = ()> {
    /// That of `value`.
    kind: TypeId,
    next: Cell<*const Extra>,
    free: unsafe fn(*const Extra),
    value: T,
}

/// # Safety
/// It is a `Box<Extra<T>>`.
unsafe fn free_extra<T>(extra: *const Extra) {
    // SAFETY: the caller's contract.
    drop(unsafe { Box::from_raw(extra.cast::<Extra<T>>().cast_mut()) });
}

/// Two bytes, and an address in the six that it needs, as in `WTF::PackedPtr`.
#[repr(C, align(8))]
pub(crate) struct Packed<Low, T> {
    pub(crate) low: Low,
    address: UnsafeCell<[u16; 3]>,
    pointee: PhantomData<*const T>,
}

impl<T> Packed<Cell<u16>, T> {
    #[inline(always)]
    fn null(low: u16) -> Self {
        const { assert!(size_of::<Self>() == 8 && cfg!(target_endian = "little")) };
        Packed {
            low: Cell::new(low),
            address: UnsafeCell::new([0; 3]),
            pointee: PhantomData,
        }
    }

    #[inline(always)]
    fn get(&self) -> *const T {
        // SAFETY: eight aligned bytes without padding.
        core::ptr::with_exposed_provenance(
            unsafe { core::ptr::from_ref(self).cast::<usize>().read() } >> 16,
        )
    }

    #[inline(always)]
    fn set(&self, pointer: *const T) {
        let address = pointer.expose_provenance();
        assert!(address >> 48 == 0);
        // SAFETY: eight aligned bytes, in cells.
        unsafe { &*core::ptr::from_ref(self).cast::<Cell<usize>>() }
            .update(|it| it & 0xffff | address << 16);
    }
}

/// The address of the arena, which is an `Rc`, takes five bytes. It is written as a whole: a load has to wait for stores that are narrower.
#[repr(C, align(8))]
pub(crate) struct Head {
    kind: Cell<Kind>,
    pub(crate) node_type: Cell<u8>,
    /// What `rare` has: `NO_EDGE`, `MANY_EDGES`, or else the value of the edge before that number.
    edge: Cell<u8>,
    arena: UnsafeCell<[u8; 5]>,
}

const NO_EDGE: u8 = 0;
/// Their numbers and their values are in a list.
const MANY_EDGES: u8 = u8::MAX;

impl Head {
    #[inline(always)]
    fn new(kind: Kind, arena: *const Arena) -> Head {
        const {
            assert!(
                align_of::<Arena>() == 256
                    && size_of::<Head>() == 8
                    && cfg!(target_endian = "little")
            )
        };
        // SAFETY: the fields, from the lowest byte up.
        unsafe {
            core::mem::transmute(
                kind as usize
                    | (kind.node_type() as usize) << 8
                    | usize::from(NO_EDGE) << 16
                    | arena.expose_provenance() << 16,
            )
        }
    }

    #[inline(always)]
    fn replace(&self, old: usize, new: usize) {
        // SAFETY: eight aligned bytes, in cells.
        unsafe { &*core::ptr::from_ref(self).cast::<Cell<usize>>() }.update(|it| it & !old | new);
    }

    #[inline(always)]
    fn set_edge(&self, edge: u8) {
        self.replace(0xff << 16, usize::from(edge) << 16);
    }

    #[inline(always)]
    fn arena(&self) -> *const Arena {
        // SAFETY: eight aligned bytes without padding.
        core::ptr::with_exposed_provenance(
            unsafe { core::ptr::from_ref(self).cast::<usize>().read() } >> 24 << 8,
        )
    }
}

/// `NodeLayout` in DesktopDOMJIT.cpp
#[repr(C)]
struct Layout {
    in_cell: [u32; 6],
    in_arena: [u32; 2],
    constants: [u32; 5],
    edges: [u32; 8],
}

#[unsafe(no_mangle)]
static Bun__DOM__nodeLayout: Layout = {
    macro_rules! numbers {
        ($($it:expr),*) => { [$(($it) as u32),*] };
    }
    macro_rules! in_cell {
        ($($($member:ident).+),*) => { numbers![$(Node::PAYLOAD_OFFSET + core::mem::offset_of!(Node, $($member).+)),*] };
    }
    assert!((Edge::Structures as usize) < 128 && super::DocFlags::IS_XML.bits() <= u16::MAX as _);
    Layout {
        in_cell: in_cell![
            head,
            head.kind,
            head.node_type,
            head.edge,
            extras.low,
            flags
        ],
        in_arena: numbers![
            core::mem::offset_of!(Arena, places_of_edges),
            core::mem::offset_of!(Arena, names)
        ],
        constants: numbers![
            NodeFlags::CONNECTED.bits(),
            super::DocFlags::IS_XML.bits(),
            super::element::OWN_BITS,
            Kind::HtmlElement,
            MANY_EDGES
        ],
        edges: numbers![
            Edge::ChildNodes,
            Edge::Children,
            Edge::ClassList,
            Edge::Attributes,
            Edge::Style,
            Edge::Dataset,
            Edge::Rows,
            Edge::Implementation
        ],
    }
};

/// With the header it fills two cache lines. The first has all that a walk down the tree reads.
#[repr(C)]
pub(crate) struct Node {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_Node::Fields,
    pub(crate) head: Head,
    /// A `Box`, or null.
    extras: Packed<Cell<u16>, Extra>,
    id: Cell<NodeId>,
    flags: Cell<NodeFlags>,
}

impl Drop for Node {
    fn drop(&mut self) {
        self.arena()
            .collected(self.id.get(), self.has(NodeFlags::HAS_BARE_CHILDREN));
        if self.kind().is_document() {
            self.arena().document_collected();
        }
        let mut next = self.extras.get();
        // SAFETY: it owns them, and a share of the arena.
        unsafe {
            while !next.is_null() {
                let extra = next;
                next = (*extra).next.get();
                ((*extra).free)(extra);
            }
            drop(Rc::from_raw(self.head.arena()));
        }
    }
}

impl PartialEq for Node {
    #[inline(always)]
    fn eq(&self, other: &Node) -> bool {
        core::ptr::eq(self, other)
    }
}

impl Eq for Node {}

/// An interface that inherits from `Node`.
///
/// # Safety
/// It is a transparent newtype of `Node`.
pub(crate) unsafe trait NodeInterface {
    fn is(node: &Node) -> bool;
}

/// `node_interface!(HTMLInputElement, Kind::Input)` lets `downcast` find it.
macro_rules! node_interface {
    ($name:ty, $($kinds:tt)+) => {
        // SAFETY: bindgen has generated it as such.
        unsafe impl $crate::api::core::NodeInterface for $name {
            #[inline(always)]
            fn is(node: &$crate::api::core::Node) -> bool {
                matches!(node.kind(), $($kinds)+)
            }
        }

        impl PartialEq for $name {
            #[inline(always)]
            fn eq(&self, other: &$name) -> bool {
                core::ptr::eq(self, other)
            }
        }
    };
}
pub(crate) use node_interface;

impl Node {
    pub(super) fn new(arena: Rc<Arena>, id: NodeId, kind: Kind, flags: NodeFlags) -> Node {
        let (head, extras) = (Head::new(kind, Rc::into_raw(arena)), Packed::null(0));
        let node = Node {
            base: Default::default(),
            fields: Default::default(),
            head,
            extras,
            id: Cell::new(id),
            flags: Cell::new(flags),
        };
        let child = if flags.contains(NodeFlags::HAS_BARE_CHILDREN) {
            JSValue::ZERO
        } else {
            JSValue::NULL
        };
        [Link::First, Link::Last]
            .into_iter()
            .for_each(|it| node.slot(it).set(child));
        [Link::Next, Link::Parent, Link::Previous]
            .into_iter()
            .for_each(|it| node.set_link(it, None));
        node
    }

    /// # Safety
    /// It is a node, which something holds for `'a`.
    #[inline(always)]
    pub(crate) unsafe fn from_cell<'a>(cell: JSValue) -> &'a Node {
        // SAFETY: the payload is there.
        unsafe { &*(cell.encoded() as *const Node).byte_add(Node::PAYLOAD_OFFSET) }
    }

    #[inline]
    pub(crate) fn from_js<'a>(heap: &JsHeap<'a>, value: JSValue) -> Option<&'a Node> {
        <Node as JsInterface>::from_js(heap, value)
    }

    #[inline(always)]
    pub(crate) fn to_js(&self) -> JSValue {
        // SAFETY: there is no node outside of its object but for the moment in which it is made.
        unsafe { self.wrapper_value() }
    }

    #[inline(always)]
    pub(crate) fn to_local<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        JsLocal::new(heap, self.to_js())
    }

    #[inline(always)]
    fn slot(&self, link: Link) -> &Cell<JSValue> {
        const { assert!(size_of::<js_Node::Fields>() == 7 * size_of::<JSValue>()) };
        // SAFETY: a `WriteBarrier<Unknown>` for each.
        unsafe {
            &*(&raw const self.fields)
                .cast::<Cell<JSValue>>()
                .add(link as usize)
        }
    }

    #[inline(always)]
    fn link(&self, link: Link) -> Option<&Node> {
        let value = self.slot(link).get();
        // SAFETY: it is alive, and the stack holds it from now on.
        (value.encoded() as usize > JSValue::NULL.encoded() as usize)
            .then(|| unsafe { Node::from_cell(value) })
    }

    /// The caller tells the collector, with `written`. It need not for `Last` and `Previous`: the other links lead there too.
    #[inline(always)]
    pub(super) fn set_link(&self, link: Link, to: Option<&Node>) {
        self.slot(link).set(to.map_or(JSValue::NULL, Node::to_js));
    }

    #[inline(always)]
    pub(super) fn written(&self) {
        self.arena().barrier.written(self.to_js());
    }

    #[inline(always)]
    pub(crate) fn arena(&self) -> &Arena {
        // SAFETY: only `move_to` writes it, and the document that the node has left holds the old one.
        unsafe { &*self.head.arena() }
    }

    #[inline(always)]
    pub(super) fn share_arena(&self) -> Rc<Arena> {
        // SAFETY: it is from `Rc::into_raw`, and this node has a share.
        unsafe {
            Rc::increment_strong_count(self.head.arena());
            Rc::from_raw(self.head.arena())
        }
    }

    #[inline(always)]
    pub(crate) fn is_in_arena_of(&self, other: &Node) -> bool {
        self.head.arena() == other.head.arena()
    }

    pub(super) fn move_to(&self, arena: Rc<Arena>, id: NodeId) {
        let old = self.head.arena();
        self.id.set(id);
        self.head.replace(
            usize::MAX << 24,
            Rc::into_raw(arena).expose_provenance() << 16,
        );
        // SAFETY: the share that it had.
        drop(unsafe { Rc::from_raw(old) });
    }

    #[inline(always)]
    pub(crate) fn id(&self) -> NodeId {
        self.id.get()
    }

    #[inline(always)]
    pub(crate) fn kind(&self) -> Kind {
        self.head.kind.get()
    }

    /// `DocFlags` or `ShadowFlags`. The steps of an element may use them.
    #[inline(always)]
    pub(crate) fn bits_of_kind(&self) -> &Cell<u16> {
        &self.extras.low
    }

    /// The prototype stays.
    pub(crate) fn set_kind(&self, kind: Kind) {
        debug_assert!(kind.node_type() == self.node_type());
        self.head.replace(0xff, kind as usize);
    }

    #[inline(always)]
    pub(crate) fn steps(&self) -> Has {
        self.arena().steps[self.kind() as usize]
    }

    /// Those that it needs when it is inserted or removed.
    #[inline]
    pub(super) fn steps_for_moving(&self) -> Has {
        if self.has(NodeFlags::DORMANT) {
            Has::empty()
        } else {
            self.steps()
        }
    }

    #[inline]
    pub(crate) fn node_type(&self) -> NodeType {
        self.kind().node_type()
    }

    #[inline(always)]
    pub(crate) fn flags(&self) -> NodeFlags {
        self.flags.get()
    }

    /// Any of them.
    #[inline(always)]
    pub(crate) fn has(&self, flags: NodeFlags) -> bool {
        self.flags.get().intersects(flags)
    }

    #[inline(always)]
    pub(crate) fn set(&self, flags: NodeFlags) {
        if flags.contains(NodeFlags::HAS_BARE_CHILDREN) {
            assert!(self.first_object().is_none());
            [Link::First, Link::Last]
                .into_iter()
                .for_each(|it| self.slot(it).set(JSValue::ZERO));
        }
        self.flags.set(self.flags.get() | flags);
    }

    #[inline(always)]
    pub(crate) fn unset(&self, flags: NodeFlags) {
        if flags.contains(NodeFlags::HAS_BARE_CHILDREN) && self.has(NodeFlags::HAS_BARE_CHILDREN) {
            [Link::First, Link::Last]
                .into_iter()
                .for_each(|it| self.set_link(it, None));
        }
        self.flags.set(self.flags.get() - flags);
    }

    #[inline(always)]
    pub(crate) fn toggle(&self, flags: NodeFlags, on: bool) {
        debug_assert!(!flags.contains(NodeFlags::HAS_BARE_CHILDREN));
        self.flags.set(if on {
            self.flags.get() | flags
        } else {
            self.flags.get() - flags
        });
    }

    #[inline(always)]
    pub(crate) fn is_connected(&self) -> bool {
        self.has(NodeFlags::CONNECTED)
    }

    #[inline(always)]
    pub(crate) fn is_rendered(&self) -> bool {
        self.has(NodeFlags::RENDERED)
    }

    #[inline(always)]
    pub(crate) fn parent(&self) -> Option<&Node> {
        self.link(Link::Parent)
    }

    /// What was made after it is likely to be visited after it.
    #[inline(always)]
    pub(crate) fn prefetch_after(&self) {
        let later = core::ptr::from_ref(self).cast::<u8>().wrapping_add(1024);
        [0, 64].into_iter().for_each(|it| {
            core::hint::prefetch_read(later.wrapping_add(it), core::hint::Locality::L1)
        });
    }

    /// What `prefetch_after` comes too late for.
    pub(crate) fn prefetch_first_below(&self) {
        if let Some(first) = self.first_object() {
            (0..16).for_each(|it| {
                core::hint::prefetch_read(
                    core::ptr::from_ref(first)
                        .cast::<u8>()
                        .wrapping_add(it * 64),
                    core::hint::Locality::L1,
                )
            });
        }
    }

    #[inline(always)]
    pub(crate) fn first_child(&self) -> Option<&Node> {
        self.link(Link::First).or_else(|| self.made(Link::First))
    }

    #[inline(always)]
    fn made(&self, link: Link) -> Option<&Node> {
        self.slot(link)
            .get()
            .is_empty()
            .then(|| self.make_children())?;
        self.link(link)
    }

    /// The first child, unless it is bare.
    #[inline(always)]
    pub(crate) fn first_object(&self) -> Option<&Node> {
        self.link(Link::First)
    }

    #[inline(always)]
    pub(crate) fn last_child(&self) -> Option<&Node> {
        self.link(Link::Last).or_else(|| self.made(Link::Last))
    }

    #[inline(always)]
    pub(crate) fn previous_sibling(&self) -> Option<&Node> {
        self.link(Link::Previous)
    }

    #[inline(always)]
    pub(crate) fn next_sibling(&self) -> Option<&Node> {
        self.link(Link::Next)
    }

    /// The node document.
    #[inline(always)]
    pub(crate) fn doc(&self) -> &Doc {
        // SAFETY: every node has one.
        unsafe { Node::from_cell(self.slot(Link::Document).get()).cast() }
    }

    /// # Safety
    /// It is a `T`.
    #[inline(always)]
    pub(crate) unsafe fn cast<T: NodeInterface>(&self) -> &T {
        // SAFETY: `NodeInterface`'s contract.
        unsafe { &*core::ptr::from_ref(self).cast() }
    }

    #[inline(always)]
    pub(crate) fn downcast<T: NodeInterface>(&self) -> Option<&T> {
        // SAFETY: it says so.
        T::is(self).then(|| unsafe { self.cast() })
    }

    #[inline(always)]
    pub(crate) fn as_element(&self) -> Option<&Element> {
        self.downcast()
    }

    /// A CDATA section too.
    #[inline(always)]
    pub(crate) fn as_text(&self) -> Option<&Text> {
        self.downcast()
    }

    #[inline(always)]
    pub(crate) fn as_character_data(&self) -> Option<&CharacterData> {
        self.downcast()
    }

    #[inline(always)]
    pub(crate) fn as_doc(&self) -> Option<&Doc> {
        self.downcast()
    }

    /// A shadow root too.
    #[inline(always)]
    pub(crate) fn as_fragment(&self) -> Option<&DocumentFragment> {
        self.downcast()
    }

    #[inline(always)]
    pub(crate) fn as_shadow_root(&self) -> Option<&ShadowRoot> {
        self.downcast()
    }

    #[inline(always)]
    pub(crate) fn is_element(&self) -> bool {
        self.kind().is_element()
    }

    /// `Known::Other` for what is not an HTML element.
    #[inline]
    pub(crate) fn html_tag(&self) -> Known {
        match self.kind().only_tag() {
            Known::Other if self.kind().is_html() => {
                self.read(|tree, id| tree.element(id).map_or(Known::Other, |it| it.local.known()))
            }
            tag => tag,
        }
    }

    #[inline]
    pub(crate) fn is_html(&self, tag: Known) -> bool {
        self.kind() == Kind::of_html(tag) && self.html_tag() == tag
    }

    // ───────────────────────────── the engine ─────────────────────────────

    #[inline(always)]
    pub(crate) fn read<R>(&self, read: impl FnOnce(&Tree, NodeId) -> R) -> R {
        self.arena().read(|engine| read(&engine.tree, self.id()))
    }

    #[inline]
    pub(crate) fn engine<R: Default>(&self, run: impl FnOnce(&mut Document, NodeId) -> R) -> R {
        self.arena()
            .attempt(|engine| run(engine, self.id()))
            .unwrap_or_default()
    }

    /// After it was told what was put off.
    #[inline]
    pub(crate) fn synced_engine<'a, R: Default>(
        &'a self,
        cx: &mut JsScope<'a>,
        run: impl FnOnce(&mut Document, NodeId) -> R,
    ) -> R {
        self.doc().sync(cx);
        self.engine(run)
    }

    /// As `synced_engine`, for what only looks something up.
    #[inline]
    pub(crate) fn at_a_glance<'a, R>(
        &'a self,
        cx: &mut JsScope<'a>,
        look: impl FnOnce(&Document, NodeId) -> Option<R>,
    ) -> Option<R> {
        self.doc().sync(cx);
        (self.is_rendered() && !self.arena().is_broken())
            .then(|| self.arena().read(|engine| look(engine, self.id())))?
    }

    /// For what is harmless if the node is not rendered.
    #[inline]
    pub(crate) fn change<R: Default>(&self, run: impl FnOnce(&mut Document, NodeId) -> R) -> R {
        match self.is_rendered() && !self.arena().is_broken() {
            true => self.engine(run),
            false => self.arena().write(|engine| run(engine, self.id())),
        }
    }

    /// As `change`, for what the links between objects rely on. It is run again if it panics.
    #[inline]
    pub(crate) fn restructure<R>(&self, run: impl Fn(&mut Document, NodeId) -> R) -> R {
        while self.is_rendered() && !self.arena().is_broken() {
            if let Some(result) = self.arena().attempt(|engine| run(engine, self.id())) {
                return result;
            }
        }
        self.arena().write(|engine| run(engine, self.id()))
    }

    /// For an id that may be out of date.
    pub(crate) fn rendered_node(&self, id: NodeId) -> Option<&Node> {
        let is_there = self.doc().is_rendered()
            && self.read(|tree, _| tree.contains(id) && tree.is_rendered(id));
        is_there.then(|| self.node(id))?
    }

    /// The one with that id in the arena of this one. `None` for 0, and for what only the engine has.
    #[inline]
    pub(crate) fn node(&self, id: NodeId) -> Option<&Node> {
        // SAFETY: the rules for ids, in mod.rs.
        self.read(|tree, _| unsafe { tree.cell(id).as_ref() })
    }

    /// The shadow-including inclusive descendant with that id, which may be out of date.
    pub(crate) fn node_within(&self, id: NodeId) -> Option<&Node> {
        let is_within = self.read(|tree, root| {
            tree.contains(id)
                && successors(Some(id), |it| {
                    Some(tree.parent_or_host(*it)).filter(|it| *it != 0)
                })
                .any(|it| it == root)
        });
        is_within.then(|| self.node(id))?
    }

    // ───────────────────────────── state ─────────────────────────────

    #[inline]
    pub(crate) fn try_extra<T: 'static>(&self) -> Option<&T> {
        // SAFETY: of that type, and once it is there it stays.
        unsafe {
            self.find_extra(TypeId::of::<T>())
                .cast::<Extra<T>>()
                .as_ref()
        }
        .map(|it| &it.value)
    }

    /// One that is far from the start of the list goes there.
    fn find_extra(&self, kind: TypeId) -> *const Extra {
        let (first, mut before, mut passed) = (self.extras.get(), None::<&Extra>, 0);
        let mut at = first;
        // SAFETY: the node owns them.
        while let Some(it) = unsafe { at.as_ref() } {
            if it.kind == kind {
                if let Some(before) = before.filter(|_| passed > 1) {
                    before.next.set(it.next.replace(first));
                    self.extras.set(at);
                }
                break;
            }
            (before, at, passed) = (Some(it), it.next.get(), passed + 1);
        }
        at
    }

    /// If it has none yet.
    #[inline]
    pub(crate) fn extra_with<T: 'static>(&self, make: impl FnOnce() -> T) -> &T {
        self.try_extra().unwrap_or_else(|| self.add_extra(make))
    }

    #[inline(never)]
    fn add_extra<T: 'static>(&self, make: impl FnOnce() -> T) -> &T {
        let value = make();
        let made = Box::into_raw(Box::new(Extra {
            kind: TypeId::of::<T>(),
            next: Cell::new(self.extras.get()),
            free: free_extra::<T>,
            value,
        }));
        self.extras.set(made.cast());
        // SAFETY: once it is there it stays.
        unsafe { &(*made).value }
    }

    #[inline]
    pub(crate) fn extra<T: Default + 'static>(&self) -> &T {
        self.extra_with(T::default)
    }

    #[inline]
    pub(crate) fn edge(&self, edge: Edge) -> Option<JSValue> {
        match self.head.edge.get() {
            MANY_EDGES => self.edge_among_many(edge),
            only => Some(self.slot(Link::Rare).get())
                .filter(|it| only == edge as u8 + 1 && !it.is_empty()),
        }
    }

    fn edge_among_many(&self, edge: Edge) -> Option<JSValue> {
        let (rare, key) = (
            List::from_value(self.slot(Link::Rare).get()),
            JSValue::js_number_from_int32(edge as i32),
        );
        let Some(pairs) = rare.contiguous().map(|it| it.as_chunks::<2>().0) else {
            return rare.value_of_key(key);
        };
        let place = &self.arena().places_of_edges[edge as usize % 128];
        let [_, value] = pairs
            .get(usize::from(place.get()))
            .filter(|it| it[0] == key)
            .or_else(|| {
                let found = pairs.iter().position(|it| it[0] == key)?;
                place.set(found as u8);
                pairs.get(found)
            })?;
        Some(*value).filter(|it| !it.is_empty())
    }

    /// Of an edge to a node.
    #[inline]
    pub(crate) fn edge_node(&self, edge: Edge) -> Option<&Node> {
        // SAFETY: the edge holds it.
        self.edge(edge).map(|it| unsafe { Node::from_cell(it) })
    }

    pub(crate) fn set_edge(&self, heap: &JsHeap<'_>, edge: Edge, value: JSValue) {
        let (key, only, slot) = (
            JSValue::js_number_from_int32(edge as i32),
            self.head.edge.get(),
            self.slot(Link::Rare),
        );
        if only == MANY_EDGES {
            let rare = List::from_value(slot.get());
            return match rare.position_of_key(key) {
                Some(index) => rare.set(heap, index + 1, value),
                None => [key, value].into_iter().for_each(|it| rare.push(heap, it)),
            };
        }
        if only == NO_EDGE || only == edge as u8 + 1 {
            slot.set(value);
            self.head.set_edge(edge as u8 + 1);
        } else {
            let both = [
                JSValue::js_number_from_int32(i32::from(only) - 1),
                slot.get(),
                key,
                value,
            ];
            slot.set(List::from_fn(heap, 4, |it| both[it as usize]).to_js());
            self.head.set_edge(MANY_EDGES);
        }
        self.written();
    }

    pub(crate) fn clear_edge(&self, heap: &JsHeap<'_>, edge: Edge) {
        let (only, slot) = (self.head.edge.get(), self.slot(Link::Rare));
        if only == edge as u8 + 1 {
            slot.set(JSValue::ZERO);
            self.head.set_edge(NO_EDGE);
        } else if only == MANY_EDGES
            && let Some(index) = List::from_value(slot.get())
                .position_of_key(JSValue::js_number_from_int32(edge as i32))
        {
            List::from_value(slot.get()).remove_range(heap, index, 2);
        }
    }

    pub(crate) fn same_object(
        &self,
        heap: &JsHeap<'_>,
        edge: Edge,
        make: impl FnOnce() -> JSValue,
    ) -> JSValue {
        self.edge(edge).unwrap_or_else(|| {
            let made = make();
            self.set_edge(heap, edge, made);
            made
        })
    }

    pub(crate) fn edge_list(&self, heap: &JsHeap<'_>, edge: Edge) -> List<'_> {
        List::from_value(self.same_object(heap, edge, || List::new(heap).to_js()))
    }

    pub(crate) fn try_edge_list(&self, edge: Edge) -> Option<List<'_>> {
        self.edge(edge).map(List::from_value)
    }

    // ───────────────────────────── traversal ─────────────────────────────

    #[inline]
    pub(crate) fn children(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(self.first_child(), |it| it.next_sibling())
    }

    #[inline]
    pub(crate) fn element_children(&self) -> impl Iterator<Item = &Element> + Clone {
        self.children().filter_map(Node::as_element)
    }

    #[inline]
    pub(crate) fn previous_siblings(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(self.previous_sibling(), |it| it.previous_sibling())
    }

    #[inline]
    pub(crate) fn next_siblings(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(self.next_sibling(), |it| it.next_sibling())
    }

    #[inline]
    pub(crate) fn ancestors(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(self.parent(), |it| it.parent())
    }

    #[inline]
    pub(crate) fn inclusive_ancestors(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(Some(self), |it| it.parent())
    }

    #[inline]
    pub(crate) fn descendants(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(self.first_child(), move |it| it.following(Some(self)))
    }

    #[inline]
    pub(crate) fn inclusive_descendants(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(Some(self), move |it| it.following(Some(self)))
    }

    #[inline]
    pub(crate) fn descendant_elements(&self) -> impl Iterator<Item = &Element> + Clone {
        self.descendants().filter_map(Node::as_element)
    }

    /// With itself, and with the shadow roots.
    pub(crate) fn shadow_including_descendants(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(Some(self), move |it| {
            it.shadow_including_following(self, Node::first_child)
        })
    }

    /// As `shadow_including_descendants`, without what is bare.
    pub(crate) fn shadow_including_objects(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(Some(self), move |it| {
            it.shadow_including_following(self, Node::first_object)
        })
    }

    /// As `inclusive_descendants`, without what is bare.
    #[inline]
    pub(crate) fn objects(&self) -> impl Iterator<Item = &Node> + Clone {
        successors(Some(self), move |it| {
            it.first_object().or_else(|| it.following_skip(Some(self)))
        })
    }

    /// The descendants among which all are that have steps.
    #[inline]
    pub(crate) fn elements_with_objects(&self) -> impl Iterator<Item = &Element> + Clone {
        self.objects().skip(1).filter_map(Node::as_element)
    }

    #[inline]
    pub(crate) fn shadow_including_following<'a>(
        &'a self,
        root: &'a Node,
        first_child: impl Fn(&'a Node) -> Option<&'a Node>,
    ) -> Option<&'a Node> {
        if self.has(NodeFlags::HOST) {
            return self.edge_node(Edge::ShadowRoot);
        }
        let mut at = self;
        if let Some(child) = first_child(at) {
            return Some(child);
        }
        while at != root {
            if let Some(next) = at.next_sibling() {
                return Some(next);
            }
            at = match at.parent() {
                Some(parent) => parent,
                None => {
                    let host = at.host()?;
                    if let Some(child) = first_child(host) {
                        return Some(child);
                    }
                    host
                }
            };
        }
        None
    }

    /// The next one in tree order within `root`.
    #[inline]
    pub(crate) fn following<'a>(&'a self, root: Option<&Node>) -> Option<&'a Node> {
        self.first_child().or_else(|| self.following_skip(root))
    }

    /// Without its descendants.
    #[inline]
    pub(crate) fn following_skip<'a>(&'a self, root: Option<&Node>) -> Option<&'a Node> {
        self.inclusive_ancestors()
            .take_while(|it| Some(*it) != root)
            .find_map(Node::next_sibling)
    }

    pub(crate) fn preceding<'a>(&'a self, root: Option<&Node>) -> Option<&'a Node> {
        if Some(self) == root {
            return None;
        }
        successors(self.previous_sibling(), |it| it.last_child())
            .last()
            .or_else(|| self.parent())
    }

    #[inline]
    pub(crate) fn parent_element(&self) -> Option<&Element> {
        self.parent()?.as_element()
    }

    /// Of a shadow root.
    #[inline]
    pub(crate) fn host(&self) -> Option<&Node> {
        if self.has(NodeFlags::SHADOW_ROOT) {
            self.edge_node(Edge::Host)
        } else {
            None
        }
    }

    #[inline]
    pub(crate) fn parent_or_host(&self) -> Option<&Node> {
        self.parent().or_else(|| self.host())
    }

    #[inline]
    pub(crate) fn assigned_slot(&self) -> Option<&Element> {
        self.parent().filter(|it| it.has(NodeFlags::HOST))?;
        self.node(self.read(|tree, id| tree[id].slot))?.as_element()
    }

    pub(crate) fn flat_parent(&self) -> Option<&Node> {
        let Some(parent) = self.parent() else {
            return self.host();
        };
        match parent.has(NodeFlags::HOST) {
            true => self.assigned_slot().map(|it| &**it),
            false => parent.host().or(Some(parent)),
        }
    }

    /// Of a slot.
    pub(crate) fn assigned_nodes(&self) -> impl Iterator<Item = &Node> {
        let ids = if self.has(NodeFlags::SLOT) {
            self.read(|tree, id| tree.element(id).map(|it| it.assigned.clone()))
        } else {
            None
        };
        ids.into_iter().flatten().filter_map(|it| self.node(it))
    }

    pub(crate) fn flat_children(&self) -> impl Iterator<Item = &Node> {
        let mut assigned = self.assigned_nodes().peekable();
        let parent = if self.has(NodeFlags::HOST) {
            self.edge_node(Edge::ShadowRoot)
        } else {
            assigned.peek().is_none().then_some(self)
        };
        assigned.chain(parent.into_iter().flat_map(Node::children))
    }

    /// The document or the shadow root that it is in, while it is connected.
    #[inline]
    pub(crate) fn scope(&self) -> Option<&Node> {
        if !self.is_connected() {
            return None;
        }
        match self
            .kind()
            .is_linked()
            .then(|| self.read(|tree, id| tree[id].scope))
        {
            Some(0 | DOCUMENT) => Some(self.doc()),
            Some(shadow_root) => self.node(shadow_root),
            None => self.parent().map_or(Some(self), Node::scope),
        }
    }

    #[inline]
    pub(crate) fn root(&self) -> &Node {
        self.scope()
            .unwrap_or_else(|| self.inclusive_ancestors().last().unwrap_or(self))
    }

    pub(crate) fn shadow_including_root(&self) -> &Node {
        match self.is_connected() {
            true => self.doc(),
            false => successors(Some(self.root()), |it| Some(it.host()?.root()))
                .last()
                .unwrap_or(self),
        }
    }

    /// Connected or not.
    #[inline]
    pub(super) fn is_in_shadow_tree(&self) -> bool {
        self.read(|tree, id| matches!(tree[tree[id].scope].data, Data::ShadowRoot { .. }))
    }

    /// Itself too.
    #[inline]
    pub(crate) fn contains(&self, other: &Node) -> bool {
        other.inclusive_ancestors().any(|it| it == self)
    }

    pub(crate) fn contains_composed(&self, other: &Node) -> bool {
        successors(Some(other), |it| it.parent_or_host()).any(|it| it == self)
    }

    pub(crate) fn contains_flat(&self, other: &Node) -> bool {
        successors(Some(other), |it| it.flat_parent()).any(|it| it == self)
    }

    /// <https://dom.spec.whatwg.org/#retarget>
    pub(crate) fn retarget(&self, against: Option<&Node>) -> &Node {
        let mut node = self;
        loop {
            let root = node.root();
            match root.host() {
                Some(host) if !against.is_some_and(|it| root.contains_composed(it)) => node = host,
                _ => return node,
            }
        }
    }

    /// The control, for what is in its shadow tree.
    pub(crate) fn out_of_control(&self) -> &Node {
        successors(Some(self), |it| {
            if it.has(NodeFlags::USER_AGENT) {
                it.root().host()
            } else {
                None
            }
        })
        .last()
        .unwrap_or(self)
    }

    pub(crate) fn index(&self) -> u32 {
        match self.previous_siblings().take(FEW_CHILDREN).count() {
            FEW_CHILDREN => self
                .parent()
                .and_then(|it| it.list_of_children().index_of(self))
                .unwrap_or_default(),
            count => count as u32,
        }
    }

    pub(crate) fn is_index_below(&self, limit: u32) -> bool {
        if limit as usize > FEW_CHILDREN {
            self.index() < limit
        } else {
            self.previous_siblings().take(limit as usize).count() < limit as usize
        }
    }

    /// <https://dom.spec.whatwg.org/#concept-node-length>
    pub(crate) fn length(&self) -> u32 {
        self.as_character_data()
            .map_or_else(|| self.count_children(), CharacterData::data_length)
    }

    pub(crate) fn child_at(&self, index: u32) -> Option<&Node> {
        if index as usize <= FEW_CHILDREN {
            self.children().nth(index as usize)
        } else {
            self.list_of_children().node(index)
        }
    }

    fn count_children(&self) -> u32 {
        match self.children().take(FEW_CHILDREN).count() {
            FEW_CHILDREN => self.list_of_children().len(),
            count => count as u32,
        }
    }

    /// Itself too.
    pub(crate) fn closest_html(&self, tag: Known) -> Option<&Element> {
        self.inclusive_ancestors()
            .find(|it| it.is_html(tag))?
            .as_element()
    }

    /// `Equal` for nodes of different trees too.
    pub(crate) fn compare_order(&self, other: &Node) -> Ordering {
        if self == other {
            return Ordering::Equal;
        }
        let (depth, other_depth) = (self.ancestors().count(), other.ancestors().count());
        let up = |from, by| Node::inclusive_ancestors(from).skip(by);
        let pairs = up(self, depth.saturating_sub(other_depth))
            .zip(up(other, other_depth.saturating_sub(depth)));
        let Some((x, y)) = pairs.clone().find(|(x, y)| x.parent() == y.parent()) else {
            return Ordering::Equal;
        };
        if x == y {
            return depth.cmp(&other_depth);
        }
        if x.parent().is_none() {
            return Ordering::Equal;
        }
        let (mut forward, mut backward) = (x.next_sibling(), x.previous_sibling());
        for _ in 0..FEW_CHILDREN {
            match (forward, backward) {
                (_, None) => return Ordering::Less,
                (Some(it), _) if it == y => return Ordering::Less,
                (None, _) => return Ordering::Greater,
                (_, Some(it)) if it == y => return Ordering::Greater,
                (Some(next), Some(previous)) => {
                    (forward, backward) = (next.next_sibling(), previous.previous_sibling())
                }
            }
        }
        x.index().cmp(&y.index())
    }

    fn text_of(tree: &Tree, nodes: impl Iterator<Item = NodeId>) -> DomString {
        let mut texts = nodes.filter_map(|it| {
            if let Data::Text(text) = &tree[it].data {
                Some(text.string())
            } else {
                None
            }
        });
        let Some(first) = texts.next() else {
            return DomString::default();
        };
        let Some(second) = texts.next() else {
            return first.clone();
        };
        let mut all = StringBuilder::default();
        [first, second]
            .into_iter()
            .chain(texts)
            .for_each(|it| all.push(it));
        all.finish()
    }

    pub(crate) fn child_text_content(&self) -> DomString {
        self.read(|tree, id| Node::text_of(tree, tree.children(id)))
    }

    pub(crate) fn descendant_text_content(&self) -> DomString {
        match self.as_doc() {
            Some(doc) => doc
                .document_element()
                .map(|it| it.descendant_text_content())
                .unwrap_or_default(),
            None => self.read(|tree, id| Node::text_of(tree, tree.descendants(id))),
        }
    }
}
