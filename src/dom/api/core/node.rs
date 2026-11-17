//! A node is its JavaScript object, which has the links that keep the tree alive, and a slot in the arena.

use core::any::{Any, TypeId};
use core::cell::{Cell, OnceCell, UnsafeCell};
use core::cmp::Ordering;
use core::iter::successors;
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
    }
}

/// In the order of `internalFields`.
#[derive(Clone, Copy)]
pub(super) enum Link {
    Parent,
    First,
    Last,
    Previous,
    Next,
    Document,
    Rare,
}

struct Extra {
    /// That of `value`, which would answer through its vtable.
    kind: TypeId,
    value: Box<dyn Any>,
    next: OnceCell<Box<Extra>>,
}

impl Extra {
    #[inline(always)]
    fn get<T: 'static>(&self) -> Option<&T> {
        // SAFETY: of that type.
        (self.kind == TypeId::of::<T>())
            .then(|| unsafe { &*core::ptr::from_ref(&*self.value).cast() })
    }
}

#[repr(C)]
pub(crate) struct Node {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_Node::Fields,
    arena: UnsafeCell<Rc<Arena>>,
    extras: OnceCell<Box<Extra>>,
    id: Cell<NodeId>,
    flags: Cell<NodeFlags>,
    kind: Cell<Kind>,
    bits_of_kind: Cell<u16>,
}

impl Drop for Node {
    fn drop(&mut self) {
        self.arena()
            .collected(self.id.get(), self.has(NodeFlags::HAS_BARE_CHILDREN));
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
        let (arena, id, flags, kind) = (
            UnsafeCell::new(arena),
            Cell::new(id),
            Cell::new(flags),
            Cell::new(kind),
        );
        Node {
            base: Default::default(),
            fields: Default::default(),
            arena,
            extras: OnceCell::new(),
            id,
            flags,
            kind,
            bits_of_kind: Cell::new(0),
        }
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
        (!value.is_empty()).then(|| unsafe { Node::from_cell(value) })
    }

    /// The caller tells the collector, with `written`.
    #[inline(always)]
    pub(super) fn set_link(&self, link: Link, to: Option<&Node>) {
        self.slot(link).set(to.map_or(JSValue::ZERO, Node::to_js));
    }

    #[inline(always)]
    pub(super) fn written(&self) {
        self.arena().barrier.written(self.to_js());
    }

    #[inline(always)]
    pub(crate) fn arena(&self) -> &Rc<Arena> {
        // SAFETY: only `move_to` writes it, and the document that the node has left holds the old one.
        unsafe { &*self.arena.get() }
    }

    pub(super) fn move_to(&self, arena: Rc<Arena>, id: NodeId) {
        // SAFETY: as above.
        unsafe { *self.arena.get() = arena };
        self.id.set(id);
    }

    #[inline(always)]
    pub(crate) fn id(&self) -> NodeId {
        self.id.get()
    }

    #[inline(always)]
    pub(crate) fn kind(&self) -> Kind {
        self.kind.get()
    }

    /// `DocFlags` or `ShadowFlags`. The steps of an element may use them.
    #[inline(always)]
    pub(crate) fn bits_of_kind(&self) -> &Cell<u16> {
        &self.bits_of_kind
    }

    /// The prototype stays.
    pub(crate) fn set_kind(&self, kind: Kind) {
        self.kind.set(kind);
    }

    #[inline(always)]
    pub(crate) fn steps(&self) -> Has {
        self.arena().steps[self.kind() as usize]
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
        self.flags.set(self.flags.get() | flags);
    }

    #[inline(always)]
    pub(crate) fn unset(&self, flags: NodeFlags) {
        self.flags.set(self.flags.get() - flags);
    }

    #[inline(always)]
    pub(crate) fn toggle(&self, flags: NodeFlags, on: bool) {
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
        if let Some(first) = self.first_child() {
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
        self.has(NodeFlags::HAS_BARE_CHILDREN)
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
    pub(super) fn restructure<R>(&self, run: impl Fn(&mut Document, NodeId) -> R) -> R {
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

    pub(crate) fn try_extra<T: 'static>(&self) -> Option<&T> {
        successors(self.extras.get(), |it| it.next.get()).find_map(|it| it.get())
    }

    /// If it has none yet.
    pub(crate) fn extra_with<T: 'static>(&self, make: impl FnOnce() -> T) -> &T {
        let mut slot = &self.extras;
        while let Some(extra) = slot.get() {
            match extra.get() {
                Some(found) => return found,
                None => slot = &extra.next,
            }
        }
        slot.get_or_init(|| {
            Box::new(Extra {
                kind: TypeId::of::<T>(),
                value: Box::new(make()),
                next: OnceCell::new(),
            })
        })
        .get()
        .expect("it was made")
    }

    pub(crate) fn extra<T: Default + 'static>(&self) -> &T {
        self.extra_with(T::default)
    }

    #[inline]
    fn rare(&self) -> Option<List<'_>> {
        Some(self.slot(Link::Rare).get())
            .filter(|it| !it.is_empty())
            .map(List::from_value)
    }

    #[inline]
    pub(crate) fn edge(&self, edge: Edge) -> Option<JSValue> {
        self.rare()?
            .value_of_key(JSValue::js_number_from_int32(edge as i32))
    }

    /// Of an edge to a node.
    #[inline]
    pub(crate) fn edge_node(&self, edge: Edge) -> Option<&Node> {
        // SAFETY: the edge holds it.
        self.edge(edge).map(|it| unsafe { Node::from_cell(it) })
    }

    pub(crate) fn set_edge(&self, heap: &JsHeap<'_>, edge: Edge, value: JSValue) {
        let key = JSValue::js_number_from_int32(edge as i32);
        let rare = self.rare().unwrap_or_else(|| {
            let rare = List::with_capacity(heap, 4);
            self.slot(Link::Rare).set(rare.to_js());
            self.written();
            List::from_value(rare.to_js())
        });
        match rare.position_of_key(key) {
            Some(index) => rare.set(heap, index + 1, value),
            None => [key, value].into_iter().for_each(|it| rare.push(heap, it)),
        }
    }

    pub(crate) fn clear_edge(&self, heap: &JsHeap<'_>, edge: Edge) {
        if let Some(rare) = self.rare()
            && let Some(index) = rare.position_of_key(JSValue::js_number_from_int32(edge as i32))
        {
            rare.remove_range(heap, index, 2);
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
        self.previous_siblings().count() as u32
    }

    /// <https://dom.spec.whatwg.org/#concept-node-length>
    pub(crate) fn length(&self) -> u32 {
        self.as_character_data().map_or_else(
            || self.children().count() as u32,
            CharacterData::data_length,
        )
    }

    pub(crate) fn child_at(&self, index: u32) -> Option<&Node> {
        self.children().nth(index as usize)
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
        loop {
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
