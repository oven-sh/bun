//! Documents, and how nodes are made.

use core::cell::Cell;
use core::ffi::c_void;
use std::rc::Rc;

use bun_jsc::bindgen::{self, Class, ClassStructure, JsHeap, JsInterface, JsScope};
use bun_jsc::{JSGlobalObject, JSValue};
use smallvec::SmallVec;

use super::arena::Arena;
use super::gc::global_of;
use super::named::Register;
use super::node::Link;
use super::steps::Has;
use super::*;
use crate::api::ui::entry as ui;
use crate::api::window::Window;
use crate::document::Quirks;
use crate::name::Name;
use crate::tree::{DOCUMENT, Data, Flags, Inert, Namespace, NodeId, Space};

unsafe extern "C" {
    safe fn Bun__DOM__globalOf(cell: JSValue) -> *const JSGlobalObject;
    /// With the prototype of the class if `prototype` is empty.
    safe fn Bun__DOM__structure(
        global: &JSGlobalObject,
        class: u32,
        prototype: JSValue,
    ) -> *mut c_void;
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub(crate) struct DocFlags: u16 {
        const OBSERVES_CHILDREN = 1;
        const OBSERVES_ATTRIBUTES = 1 << 1;
        const OBSERVES_DATA = 1 << 2;
        const IS_XML = 1 << 3;
        const QUIRKS = 1 << 4;
        /// Without having a page.
        const ALLOWS_SHADOW_ROOTS = 1 << 5;
        const HAS_RANGES = 1 << 6;
        const HAS_ITERATORS = 1 << 7;
        const WATCHES_IDS = 1 << 8;
        const CHECKS_STYLE_ATTRIBUTES = 1 << 9;
        const HAS_PAGE = 1 << 10;
        const IS_XHTML = 1 << 11;
        const IN_FRAME = 1 << 12;
        const IS_ACCESSIBLE = 1 << 13;
        const DESIGN_MODE = 1 << 14;
        const RECORDS_EDITS = 1 << 15;
    }
}

/// With the strings that have a lone surrogate there.
fn shares_name(text: &str) -> bool {
    !text.is_ascii() && text.chars().any(|it| it == char::REPLACEMENT_CHARACTER)
}

/// The connected elements of a document or of a shadow root, by their ids.
#[derive(Default)]
struct Ids(Register<Name>);

#[thread_local]
static HAS_SCOPED_REGISTRIES: Cell<bool> = Cell::new(false);

pub(crate) fn has_scoped_registries() -> bool {
    HAS_SCOPED_REGISTRIES.get()
}

pub(crate) fn note_scoped_registry() {
    HAS_SCOPED_REGISTRIES.set(true);
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Synchronous {
    No,
    Yes,
}

/// <https://html.spec.whatwg.org/#valid-custom-element-name>
pub(crate) fn is_valid_custom_element_name(name: &Atom) -> bool {
    let text = name.as_utf8();
    text.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && bun_core::strings::contains_char(text.as_bytes(), b'-')
        && !text.bytes().any(|it| {
            matches!(
                it,
                0 | b'\t' | b'\n' | 0xc | b'\r' | b' ' | b'/' | b'>' | b'A'..=b'Z'
            )
        })
        && !matches!(
            name.known(),
            atom!("annotation-xml")
                | atom!("color-profile")
                | atom!("font-face")
                | atom!("font-face-src")
                | atom!("font-face-uri")
                | atom!("font-face-format")
                | atom!("font-face-name")
                | atom!("missing-glyph")
        )
}

impl Node {
    #[inline]
    fn ids(&self) -> &Register<Name> {
        if self.id() == DOCUMENT {
            &self.arena().ids
        } else {
            &self.extra::<Ids>().0
        }
    }

    /// The element has it.
    pub(super) fn add_id(&self, heap: &JsHeap<'_>, id: Name, element: NodeId) {
        super::named::announce_id_in_window(heap, || {
            self.read(|tree, _| bare::id_of(tree, element))
        });
        self.ids().add(id, element);
    }

    pub(super) fn remove_id(&self, id: Name, element: NodeId) {
        self.ids().remove(&id, element);
    }

    /// Of a document or a fragment.
    pub(crate) fn element_by_id(&self, id: &Atom) -> Option<&Element> {
        let text = id.as_utf8();
        if !shares_name(&text) {
            return self.element_by_id_text(text.as_bytes());
        }
        let found = self.read(|tree, root| {
            tree.descendants(root)
                .find(|it| bare::id_of(tree, *it).as_ref() == Some(id))
        });
        self.node(found?)?.as_element()
    }

    /// In UTF-8, for which `shares_name` does not hold.
    #[inline]
    pub(super) fn element_by_id_text(&self, id: &[u8]) -> Option<&Element> {
        if id.is_empty() {
            return None;
        }
        let id = Name::sought(id);
        let keys = || crate::selector::filter(core::iter::once(crate::selector::key::id(id)));
        if !self.is_connected() || self.parent().is_some() {
            let found = self.read(|tree, root| {
                tree.descendants_with(root, keys())
                    .find(|it| tree.element(*it).is_some_and(|it| it.id == id))
            });
            return self.node(found?)?.as_element();
        }
        self.element_in_scope(self.ids().first(&id, self, keys)?)
    }

    /// Of a document or a connected shadow root, no more than two.
    pub(crate) fn some_elements_by_id(&self, id: &Atom) -> SmallVec<[&Element; 2]> {
        let text = id.as_utf8();
        let is_shared = shares_name(&text);
        self.ids().some(&Name::sought(text.as_bytes()), self, |it| {
            !is_shared || it.attr(atom!("id")) == Some(id.to_dom_string())
        })
    }

    #[inline]
    pub(super) fn element_in_scope(&self, element: NodeId) -> Option<&Element> {
        self.read(|tree, id| tree[element].scope == tree[id].scope)
            .then(|| self.node(element)?.as_element())?
    }
}

impl Doc {
    /// The one that `arena` shows, if `other` is `None`. Otherwise one without a window, next to that one.
    pub(crate) fn create<'a>(
        cx: &mut JsScope<'a>,
        arena: Rc<Arena>,
        other: Option<&'a Doc>,
        kind: Kind,
        agent: &'a Agent,
    ) -> &'a Doc {
        arena.agent.set(agent);
        arena.document_created();
        let structures = other.map_or_else(
            || List::new(&cx.heap),
            |it| it.edge_list(&cx.heap, Edge::Structures),
        );
        let global = other.map_or_else(
            || core::ptr::from_ref(global_of(&cx.heap)),
            |it| core::ptr::from_ref(it.global()),
        );
        // SAFETY: `other`, or the caller, holds it.
        let structure = find_structure(unsafe { &*global }, &arena, kind, structures);
        let id = arena.write(|engine| {
            let id = if other.is_some() {
                engine.tree.create(Data::Root)
            } else {
                DOCUMENT
            };
            if other.is_some() {
                engine.tree[id].set(Flags::OTHER_DOCUMENT);
            }
            id
        });
        let node = allocate(
            &cx.heap,
            kind,
            structure,
            Node::new(arena, id, kind, NodeFlags::CONNECTED),
        );
        node.set_link(Link::Document, Some(node));
        node.set_edge(&cx.heap, Edge::Agent, agent.to_js());
        node.set_edge(&cx.heap, Edge::Structures, structures.to_js());
        node.doc()
    }

    /// In the realm that is calling.
    pub(crate) fn new_for_window<'a>(
        cx: &mut JsScope<'a>,
        font_scope: u32,
        url: DomString,
    ) -> &'a Doc {
        let arena = Arena::new(cx.global(), font_scope, url.to_utf8().as_bytes());
        let doc = Doc::create(cx, arena, None, Kind::HtmlDocument, Agent::of(&cx.heap));
        doc.set(NodeFlags::RENDERED);
        doc.set_base_url(url.clone());
        doc.set_url(url);
        doc.arena().is_scheduled.set(false);
        doc
    }

    /// It has to be empty.
    pub(crate) fn leave_window(&self) {
        self.set_doc_flags(DocFlags::HAS_PAGE, false);
        self.arena().is_scheduled.set(true);
        self.unset(NodeFlags::RENDERED);
    }

    pub(crate) fn new_windowless<'a>(&'a self, cx: &mut JsScope<'a>, kind: Kind) -> &'a Doc {
        Doc::create(cx, self.share_arena(), Some(self), kind, self.agent())
    }

    fn new_of_same_type<'a>(&'a self, cx: &mut JsScope<'a>, kind: Kind) -> &'a Doc {
        let doc = self.new_windowless(cx, kind);
        doc.set_doc_flags(DocFlags::IS_XML, self.is(DocFlags::IS_XML));
        doc.set_content_type(self.content_type());
        doc
    }

    /// <https://dom.spec.whatwg.org/#clone-a-single-node>
    pub(super) fn copy<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a Doc {
        let doc = self.new_of_same_type(cx, self.kind());
        doc.set_url(self.url());
        doc.set_base_url(self.base_url());
        doc.set_inherited_base_url(self.inherited_base_url());
        doc.set_doc_flags(DocFlags::QUIRKS, self.quirks());
        doc.set_doc_flags(
            DocFlags::ALLOWS_SHADOW_ROOTS,
            self.is(DocFlags::HAS_PAGE | DocFlags::ALLOWS_SHADOW_ROOTS),
        );
        custom::set_own_registry(
            &cx.heap,
            doc,
            Some(custom::own_registry(self))
                .filter(|it| !it.is_null())
                .unwrap_or(JSValue::UNDEFINED),
        );
        doc
    }

    pub(crate) fn set_quirks(&self, quirks: Quirks) {
        let quirks = if self.url().eq_str("about:srcdoc") {
            Quirks::None
        } else {
            quirks
        };
        self.set_doc_flags(DocFlags::QUIRKS, quirks == Quirks::All);
        self.arena().classes_changed();
        if self.is(DocFlags::HAS_PAGE) {
            self.engine(|engine, _| engine.set_mode(quirks, false));
        }
    }

    /// Of the realm that what it makes belongs to.
    #[inline]
    pub(crate) fn global(&self) -> &JSGlobalObject {
        global_of_cell(self)
    }

    /// What allocates in its realm.
    pub(crate) fn heap<'h, 'a>(&self, heap: &'h JsHeap<'a>) -> &'h JsHeap<'a> {
        bindgen::JsInterface::realm(self, heap)
    }

    #[inline(always)]
    pub(crate) fn doc_flags(&self) -> DocFlags {
        DocFlags::from_bits_retain(self.bits_of_kind().get())
    }

    pub(crate) fn set_doc_flags(&self, flags: DocFlags, on: bool) {
        self.bits_of_kind().set(
            if on {
                self.doc_flags() | flags
            } else {
                self.doc_flags() - flags
            }
            .bits(),
        );
    }

    #[inline(always)]
    pub(crate) fn is(&self, flags: DocFlags) -> bool {
        self.doc_flags().intersects(flags)
    }

    #[inline(always)]
    pub(crate) fn is_html_doc(&self) -> bool {
        !self.is(DocFlags::IS_XML)
    }

    #[inline(always)]
    pub(crate) fn quirks(&self) -> bool {
        self.is(DocFlags::QUIRKS)
    }

    /// It changes with the tree of any document of the page.
    #[inline(always)]
    pub(crate) fn version(&self) -> u64 {
        self.arena().version.get()
    }

    #[inline(always)]
    pub(crate) fn attribute_version(&self) -> u64 {
        self.arena().attribute_version.get()
    }

    pub(crate) fn document_element(&self) -> Option<&Element> {
        self.element_children().next()
    }

    fn child_of_root(&self, is_it: impl Fn(Known) -> bool) -> Option<&Element> {
        self.document_element()
            .filter(|it| it.is_html(atom!("html")))?
            .element_children()
            .find(|it| is_it(it.html_tag()))
    }

    pub(crate) fn head(&self) -> Option<&Element> {
        self.child_of_root(|it| it == atom!("head"))
    }

    pub(crate) fn body(&self) -> Option<&Element> {
        self.child_of_root(|it| matches!(it, atom!("body") | atom!("frameset")))
    }

    /// Asks for a frame.
    #[inline]
    pub(crate) fn invalidate<'a>(&'a self, cx: &mut JsScope<'a>) {
        if !self.arena().is_scheduled.replace(true) {
            self.window()
                .and_then(|it| it.downcast::<Window>())
                .into_iter()
                .for_each(|it| it.schedule(cx, true));
        }
    }

    pub(super) fn id_changed<'a>(&'a self, cx: &mut JsScope<'a>, id: &Atom) {
        if self.is(DocFlags::WATCHES_IDS) {
            seams::id_changed(cx, self, id);
        }
    }

    /// After a change that no style may depend on.
    #[inline]
    pub(crate) fn invalidate_if_dirty<'a>(&'a self, cx: &mut JsScope<'a>) {
        if !self.arena().is_scheduled.get()
            && (self.is(DocFlags::IS_ACCESSIBLE)
                || self.engine(|engine, _| engine.needs_attention()))
        {
            self.invalidate(cx);
        }
    }

    pub(crate) fn set_needs_sync(&self) {
        self.arena().needs_sync.set(true);
    }

    #[inline]
    pub(crate) fn sync<'a>(&'a self, cx: &mut JsScope<'a>) {
        if self.arena().needs_sync.get() || self.is(DocFlags::IN_FRAME) {
            self.catch_up(cx);
        }
    }

    pub(crate) fn needs_sync(&self) -> bool {
        self.is_rendered() && self.arena().needs_sync.get()
    }

    fn catch_up<'a>(&'a self, cx: &mut JsScope<'a>) {
        if self.is(DocFlags::IN_FRAME) {
            crate::api::ui::Ui::of(self)
                .and_then(|it| it.container())
                .into_iter()
                .for_each(|it| it.measure(cx));
        }
        if self.is_rendered() && self.arena().needs_sync.replace(false) {
            if self.arena().has_new_color_scheme.take() {
                super::metadata::update_color_scheme(self);
            }
            ui::flush_controls(cx, self);
            crate::api::cssom::flush_sheets(&cx.heap, self);
            ui::flush_selection(cx, self);
        }
    }

    // ───────────────────────────── creation ─────────────────────────────

    #[inline]
    pub(super) fn structure(&self, kind: Kind) -> *mut c_void {
        let known = self.arena().structures[kind as usize].get();
        if known.is_null() {
            self.new_structure(kind)
        } else {
            known
        }
    }

    #[cold]
    fn new_structure(&self, kind: Kind) -> *mut c_void {
        find_structure(
            self.global(),
            self.arena(),
            kind,
            self.try_edge_list(Edge::Structures)
                .expect("a document has them"),
        )
    }

    #[inline]
    pub(super) fn create_node<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        kind: Kind,
        flags: NodeFlags,
        slot: impl FnOnce(&mut crate::document::Document) -> NodeId,
    ) -> &'a Node {
        let (structure, arena) = (self.structure(kind), self.arena());
        let id = arena.write(|engine| {
            arena.free_dead(engine);
            slot(engine)
        });
        // SAFETY: it is the one of that kind.
        unsafe { self.create_object(heap, structure, id, kind, flags) }
    }

    /// # Safety
    /// `structure` is the one of `kind`.
    #[inline]
    unsafe fn create_object<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        structure: *mut c_void,
        id: NodeId,
        kind: Kind,
        flags: NodeFlags,
    ) -> &'a Node {
        let class: Class<Node> = kind.interface().class;
        // SAFETY: it was made for that class.
        let structure = unsafe { class.structure_from_extern(structure, heap) };
        let node = structure.create(heap, Node::new(self.share_arena(), id, kind, flags));
        self.arena().read(|engine| engine.tree.clothe(id, node));
        node.set_link(Link::Document, Some(self));
        node
    }

    /// Of a bare node.
    #[inline(always)]
    pub(super) fn object_for<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        tree: &crate::tree::Tree,
        id: NodeId,
        kind: Kind,
        flags: NodeFlags,
    ) -> &'a Node {
        let (class, structure): (Class<Node>, _) = (
            kind.interface().class,
            self.arena().structures[kind as usize].get(),
        );
        debug_assert!(!structure.is_null());
        // SAFETY: it was made for that class, by `prepare_for_bare`.
        let node = unsafe { class.structure_from_extern(structure, heap) }
            .create(heap, Node::new(self.share_arena(), id, kind, flags));
        tree.clothe(id, node);
        if kind == Kind::Comment {
            tree.dirty_child(id).set(0);
            tree.visit(id).set(0);
        }
        node.set_link(Link::Document, Some(self));
        node
    }

    /// For `new`.
    pub(super) fn construct<'a, T: JsInterface<Struct = Node>>(
        &'a self,
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, T>,
        kind: Kind,
        data: Data,
    ) -> &'a T {
        let id = self.arena().write(|engine| engine.tree.create(data));
        let wrapper = structure.create(
            heap,
            Node::new(self.share_arena(), id, kind, NodeFlags::empty()),
        );
        // SAFETY: the stack holds it.
        let node = unsafe { Node::from_cell(wrapper.to_js()) };
        self.arena().write(|engine| engine.tree.set_cell(id, node));
        node.set_link(Link::Document, Some(self));
        wrapper
    }

    #[inline]
    pub(super) fn create_of_kind<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        kind: Kind,
        slot: impl FnOnce(&mut crate::document::Document) -> NodeId,
    ) -> &'a Element {
        // SAFETY: the kind is that of an element.
        let element: &Element = unsafe {
            self.create_node(heap, kind, NodeFlags::empty(), slot)
                .cast()
        };
        if self.arena().steps[kind as usize].contains(Has::CREATED) {
            seams::created(heap, element);
        }
        element
    }

    #[inline]
    pub(crate) fn create_html<'a>(&'a self, heap: &JsHeap<'a>, tag: Known) -> &'a Element {
        let element = self.create_of_kind(heap, Kind::of_html(tag), |engine| {
            engine.create_element(tag.into(), Namespace::Html, None)
        });
        element
            .bits_of_kind()
            .update(|it| it | super::element::bits_for(tag));
        element
    }

    /// It is never a custom element.
    pub(crate) fn create_plain<'a>(&'a self, heap: &JsHeap<'a>, name: QualName) -> &'a Element {
        let (kind, namespace) = match name.ns {
            Ns::Html => match Kind::of_html(name.local.known()) {
                Kind::Unknown if is_valid_custom_element_name(&name.local) => {
                    (Kind::HtmlElement, Namespace::Html)
                }
                kind => (kind, Namespace::Html),
            },
            Ns::Svg => (Kind::of_svg(name.local.known()), Namespace::Svg),
            Ns::MathMl => (Kind::MathMl, Namespace::MathMl),
            _ => (Kind::Element, Namespace::Other),
        };
        self.create_named(heap, kind, namespace, name)
    }

    pub(crate) fn create_unknown<'a>(&'a self, heap: &JsHeap<'a>, local: Atom) -> &'a Element {
        self.create_named(heap, Kind::Unknown, Namespace::Html, QualName::html(local))
    }

    fn create_named<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        kind: Kind,
        namespace: Namespace,
        name: QualName,
    ) -> &'a Element {
        let space = (name.prefix.is_some() || namespace == Namespace::Other)
            .then(|| Space::new(name.ns, name.prefix));
        self.create_of_kind(heap, kind, |engine| {
            engine.create_element(name.local, namespace, space)
        })
    }

    /// <https://dom.spec.whatwg.org/#concept-create-element>. `registry`: undefined for that of the document.
    pub(crate) fn create_element<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        name: QualName,
        is: Option<&Atom>,
        synchronous: Synchronous,
        registry: JSValue,
    ) -> &'a Element {
        let registry = if registry.is_undefined() {
            registry
        } else {
            custom::as_own_registry(&cx.heap, registry, self)
        };
        if name.ns == Ns::Html
            && (is.is_some()
                || Kind::of_html(name.local.known()) == Kind::Unknown
                    && is_valid_custom_element_name(&name.local))
        {
            return custom::create(cx, self, name, is, synchronous, registry);
        }
        let element = self.create_plain(&cx.heap, name);
        if is.is_some() || !registry.is_undefined() {
            element.set_is_value(is);
            custom::set_own_registry(&cx.heap, element, registry);
        }
        element
    }

    #[inline]
    pub(crate) fn create_text<'a>(&'a self, heap: &JsHeap<'a>, data: DomString) -> &'a Text {
        // SAFETY: of that kind.
        unsafe {
            self.create_node(heap, Kind::Text, NodeFlags::empty(), |engine| {
                engine.tree.create(Data::Text(data.into()))
            })
            .cast()
        }
    }

    pub(crate) fn create_cdata<'a>(&'a self, heap: &JsHeap<'a>, data: DomString) -> &'a Text {
        // SAFETY: of that kind.
        unsafe {
            self.create_node(heap, Kind::CData, NodeFlags::empty(), |engine| {
                engine.tree.create(Data::Text(data.into()))
            })
            .cast()
        }
    }

    pub(super) fn create_inert<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        kind: Kind,
        inert: Inert,
    ) -> &'a Node {
        self.create_node(heap, kind, NodeFlags::empty(), |engine| {
            engine.tree.create(Data::Inert(Box::new(inert)))
        })
    }

    pub(crate) fn create_comment<'a>(&'a self, heap: &JsHeap<'a>, data: DomString) -> &'a Node {
        self.create_inert(
            heap,
            Kind::Comment,
            Inert {
                name: QualName::plain(Atom::EMPTY),
                data,
                system_id: DomString::default(),
            },
        )
    }

    pub(crate) fn create_pi<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        target: Atom,
        data: DomString,
    ) -> &'a Node {
        self.create_inert(
            heap,
            Kind::Instruction,
            Inert {
                name: QualName::plain(target),
                data,
                system_id: DomString::default(),
            },
        )
    }

    pub(crate) fn create_doctype<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: Atom,
        public_id: DomString,
        system_id: DomString,
    ) -> &'a Node {
        self.create_inert(
            heap,
            Kind::Doctype,
            Inert {
                name: QualName::plain(name),
                data: public_id,
                system_id,
            },
        )
    }

    pub(crate) fn create_attr<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        name: QualName,
        value: DomString,
    ) -> &'a Attr {
        // SAFETY: of that kind.
        unsafe {
            self.create_inert(
                heap,
                Kind::Attr,
                Inert {
                    name,
                    data: value,
                    system_id: DomString::default(),
                },
            )
            .cast()
        }
    }

    pub(crate) fn create_fragment<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DocumentFragment {
        // SAFETY: of that kind.
        unsafe {
            self.create_node(heap, Kind::Fragment, NodeFlags::empty(), |engine| {
                engine.tree.create(Data::Root)
            })
            .cast()
        }
    }

    pub(crate) fn template_contents_owner<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a Doc {
        self.edge_node(Edge::TemplateContentsOwner)
            .map_or_else(|| self.new_template_contents_owner(cx), Node::doc)
    }

    #[cold]
    fn new_template_contents_owner<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a Doc {
        let owner = self.new_of_same_type(cx, Kind::Document);
        [self, owner]
            .iter()
            .for_each(|it| it.set_edge(&cx.heap, Edge::TemplateContentsOwner, owner.to_js()));
        owner
    }
}

#[inline]
pub(crate) fn global_of_cell<T: JsInterface>(it: &T) -> &JSGlobalObject {
    // SAFETY: its structure holds it.
    unsafe { &*Bun__DOM__globalOf(it.to_js()) }
}

#[inline]
fn allocate<'a>(heap: &JsHeap<'a>, kind: Kind, structure: *mut c_void, node: Node) -> &'a Node {
    let class: Class<Node> = kind.interface().class;
    // SAFETY: it was made for that class.
    let node = unsafe { class.structure_from_extern(structure, heap) }.create(heap, node);
    node.arena()
        .write(|engine| engine.tree.set_cell(node.id(), node));
    node
}

fn find_structure(
    global: &JSGlobalObject,
    arena: &Arena,
    kind: Kind,
    structures: List<'_>,
) -> *mut c_void {
    let slot = &arena.structures[kind as usize];
    if slot.get().is_null() {
        slot.set(Bun__DOM__structure(
            global,
            kind.interface().number,
            JSValue::ZERO,
        ));
        structures.push(JsHeap::from_global(global), JSValue::from_cell(slot.get()));
    }
    slot.get()
}
