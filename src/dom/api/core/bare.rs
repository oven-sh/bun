//! Nodes that have no object yet. Either all children of a node have one, or none of its descendants has.
//!
//! Text, comments and elements without steps can be bare. The closest ancestor that has an object owns them.

use core::ffi::c_void;

use bun_jsc::JSGlobalObject;
use bun_jsc::bindgen::{JsHeap, JsScope};
use smallvec::SmallVec;

use super::element::bits_for;
use super::mutation::{children_changed, let_go_before_changing};
use super::node::Link;
use super::steps::Has;
use super::{NodeFlags as F, *};
use crate::document::{Above, Document};
use crate::name::{Name, name};
use crate::selector::{filter, key};
use crate::tree::{Data, Inert, Namespace, NodeId, Step, Tree, Walk};

unsafe extern "C" {
    fn Bun__DOM__withoutCollecting(
        global: &JSGlobalObject,
        context: *mut c_void,
        run: unsafe extern "C" fn(*mut c_void),
    );
}

const BYTES_PER_NODE: usize = 192;
const MOST_UNREPORTED: u32 = 1 << 13;

/// What a bare node has in the place of its object, which can be made without a look at the element.
#[derive(Clone, Copy)]
pub(crate) struct Sketch(usize);

impl Sketch {
    const IS_ONE: usize = 1;
    const HAS_ID: usize = 2;

    #[inline(always)]
    pub(crate) fn of(data: &Data) -> Sketch {
        let Data::Element(it) = data else {
            return Sketch(
                Sketch::IS_ONE
                    | (Kind::Text as usize) << 8
                    | usize::from(bits_for(atom!("#text"))) << 16,
            );
        };
        let tag = it.local.known();
        let kind = match it.namespace {
            Namespace::Html => Kind::of_html(tag),
            Namespace::Svg => Kind::of_svg(tag),
            Namespace::MathMl => Kind::MathMl,
            Namespace::Other => Kind::Element,
        };
        let bits = if it.space.is_none() { bits_for(tag) } else { 0 };
        Sketch(
            Sketch::IS_ONE
                | if it.id == Name::NONE {
                    0
                } else {
                    Sketch::HAS_ID
                }
                | (kind as usize) << 8
                | usize::from(bits) << 16,
        )
    }

    #[inline(always)]
    pub(crate) fn from_cell(cell: *const Node) -> Option<Sketch> {
        (cell.addr() & Sketch::IS_ONE != 0).then(|| Sketch(cell.addr()))
    }

    #[inline(always)]
    pub(crate) fn to_cell(self) -> *const Node {
        core::ptr::without_provenance(self.0)
    }
}

unsafe extern "C" fn make_children(context: *mut c_void) {
    // SAFETY: what `Node::make_children_in` passes.
    let (parent, tree, global) = unsafe { *context.cast::<(&Node, &Tree, &JSGlobalObject)>() };
    let (doc, inherited) = (
        parent.doc(),
        parent.flags() & (F::CONNECTED | F::RENDERED | F::USER_AGENT | F::IN_SELECT),
    );
    let heap = JsHeap::from_global(global);
    let (mut comments, mut last) = (tree.take_comments(parent.id()), None::<&Node>);
    let mut make = |id: NodeId| {
        let Sketch(sketch) = tree
            .sketch(id)
            .unwrap_or(Sketch((Kind::Comment as usize) << 8));
        debug_assert!(
            (sketch & Sketch::HAS_ID != 0)
                == tree.element(id).is_some_and(|it| it.id != Name::NONE)
        );
        let mut flags = inherited
            | if sketch & Sketch::HAS_ID != 0 {
                F::HAS_ID
            } else {
                F::empty()
            };
        if tree.has_children(id) {
            flags |= F::HAS_BARE_CHILDREN;
            tree.prefetch_children(id);
        }
        let node = doc.object_for(heap, tree, id, Kind::ALL[sketch >> 8 & 0xff], flags);
        node.bits_of_kind().set((sketch >> 16) as u16);
        node.set_link(Link::Parent, Some(parent));
        node.set_link(Link::Previous, last);
        node.written();
        let (holder, link) = last.map_or((parent, Link::First), |it| (it, Link::Next));
        holder.set_link(link, Some(node));
        holder.written();
        last = Some(node);
    };
    for id in core::iter::once(0).chain(tree.children(parent.id())) {
        if id != 0 {
            make(id);
        }
        while let Some((comment, _)) = comments.last().copied().filter(|it| it.1 == id) {
            comments.pop();
            make(comment);
        }
    }
    parent.set_link(Link::Last, last);
    parent.written();
}

/// With the siblings and the ancestors.
#[cold]
#[inline(never)]
pub(crate) fn make_object(tree: &Tree, id: NodeId) -> *const Node {
    let path =
        SmallVec::<[NodeId; 16]>::from_iter(core::iter::successors(Some(tree[id].parent), |it| {
            tree.is_bare(*it).then(|| tree[*it].parent)
        }));
    for parent in path.into_iter().rev() {
        // SAFETY: the rules for ids, in mod.rs, or else it has just been made.
        let Some(parent) = (unsafe { tree.object(parent).as_ref() }) else {
            return core::ptr::null();
        };
        parent.make_children_in(tree);
    }
    tree.object(id)
}

impl Node {
    fn make_children_in(&self, tree: &Tree) {
        debug_assert!(self.has(F::HAS_BARE_CHILDREN));
        self.unset(F::HAS_BARE_CHILDREN);
        let global = self.doc().global();
        let mut context = (self, tree, global);
        // SAFETY: `context` outlives the call.
        unsafe { Bun__DOM__withoutCollecting(global, (&raw mut context).cast(), make_children) };
    }

    #[cold]
    #[inline(never)]
    pub(super) fn make_children(&self) {
        // SAFETY: it reads links, and writes cells.
        self.make_children_in(unsafe { &(*self.arena().engine_unchecked()).tree });
    }

    #[inline]
    pub(crate) fn has_children(&self) -> bool {
        self.has(F::HAS_BARE_CHILDREN) || self.first_object().is_some()
    }

    /// Whether what is appended to it can be bare.
    #[inline]
    pub(crate) fn takes_bare(&self) -> bool {
        !self.has(F::HOST | F::SLOT | F::USER_AGENT | F::IN_SELECT)
            && self.first_object().is_none()
            && !self.steps().contains(Has::CHILDREN_CHANGED)
            && (self.is_element() || self.as_fragment().is_some())
            && !self
                .doc()
                .is(DocFlags::RECORDS_EDITS | DocFlags::WATCHES_IDS)
            && !(self.doc().is(DocFlags::OBSERVES_CHILDREN)
                && self.inclusive_ancestors().any(|it| it.has(F::OBSERVED)))
    }

    /// After what `takes_bare` allows.
    #[inline]
    pub(crate) fn got_bare(&self) {
        self.set(F::HAS_BARE_CHILDREN);
        children_changed(self);
    }

    /// For what it or its bare descendants have got.
    pub(crate) fn bare_changed<'a>(&'a self, cx: &mut JsScope<'a>, added: u32) {
        children_changed(self);
        if self.is_rendered() {
            self.arena().write(Document::new_nodes_appended);
            self.doc().invalidate(cx);
        }
        let unreported = &self.arena().unreported;
        unreported.set(unreported.get() + added);
    }

    /// What it is to its children, and what its descendants are to theirs until `bare_changed`.
    #[inline]
    pub(crate) fn above_bare(&self) -> [Above; 2] {
        match self.is_rendered() {
            false => [Above::Detached; 2],
            true if self.arena().write(Document::overlooks_new_nodes) => {
                [Above::Rendered, Above::New]
            }
            true => [Above::Rendered; 2],
        }
    }

    /// `parent` is this one, or one of its bare descendants.
    pub(crate) fn finish_appending(&self, parent: NodeId, child: NodeId) -> NodeId {
        self.restructure(|engine, _| engine.append_new(parent, child));
        child
    }

    pub(crate) fn append_bare_comment(&self, parent: NodeId, data: DomString) {
        let inert = Inert {
            name: QualName::plain(Atom::EMPTY),
            data,
            system_id: DomString::default(),
        };
        self.arena().write(|engine| {
            let comment = engine.tree.create(Data::Inert(Box::new(inert)));
            engine.tree.append_comment(parent, comment);
        });
    }

    /// Of a bare descendant that was appended.
    pub(crate) fn note_id_of_bare(&self, heap: &JsHeap<'_>, element: NodeId) {
        if let Some(scope) = self.scope()
            && let Some(id) = self
                .read(|tree, _| Some(tree.element(element)?.id))
                .filter(|it| *it != Name::NONE)
        {
            scope.add_id(heap, id, element);
        }
    }
}

impl Doc {
    /// Whether that is possible for nodes of the kind.
    pub(crate) fn prepare_for_bare(&self, kind: Kind) -> bool {
        const OF_EVENTS: Has = Has::PRE_ACTIVATE
            .union(Has::ACTIVATE)
            .union(Has::CANCEL_ACTIVATE)
            .union(Has::DEFAULT_ACTION);
        let is_possible = OF_EVENTS.contains(self.arena().steps[kind as usize])
            && !matches!(kind, Kind::Html | Kind::Head | Kind::FrameSet);
        is_possible && !self.structure(kind).is_null()
    }

    /// The collector does not see them.
    #[inline]
    pub(crate) fn report_bare<'a>(&'a self, cx: &mut JsScope<'a>) {
        let unreported = &self.arena().unreported;
        if unreported.get() > MOST_UNREPORTED {
            cx.global()
                .vm()
                .report_extra_memory(unreported.take() as usize * BYTES_PER_NODE);
        }
    }
}

/// Whether an attribute in no namespace does something to an element without steps.
#[inline]
pub(crate) fn needs_object(name: &Atom) -> bool {
    !matches!(name.known(), atom!("name") | atom!("slot")) && super::element::is_global(name)
}

pub(super) fn id_of(tree: &Tree, element: NodeId) -> Option<Atom> {
    let element = tree.element(element).filter(|it| it.id != Name::NONE)?;
    element
        .attributes
        .iter()
        .find(|it| it.local == atom!("id") && it.space.is_none())
        .map(|it| Atom::from_string(it.value.string()))
}

/// Of the descendants, which are bare.
pub(super) fn for_each_id(parent: &Node, mut visit: impl FnMut(Name, NodeId)) {
    let keys = filter(core::iter::once(key::attribute(name!("id"))));
    parent.read(|tree, parent| {
        tree.descendants_with(parent, keys).for_each(|it| {
            tree.element(it)
                .filter(|it| it.id != Name::NONE)
                .into_iter()
                .for_each(|element| visit(element.id, it))
        })
    });
}

/// Removes them all, if they are bare and nothing would notice.
#[inline]
pub(super) fn drop_children<'a>(cx: &mut JsScope<'a>, parent: &'a Node) {
    if !parent.has(F::HAS_BARE_CHILDREN) {
        return;
    }
    let_go_before_changing(cx, parent);
    let doc = parent.doc();
    if !parent.has(F::HAS_BARE_CHILDREN)
        || parent.has(F::HAS_RANGES)
        || !parent.takes_bare()
        || doc.is(DocFlags::IS_ACCESSIBLE)
    {
        return;
    }
    if let Some(scope) = parent.scope() {
        for_each_id(parent, |id, element| scope.remove_id(id, element));
    }
    parent.unset(F::HAS_BARE_CHILDREN);
    children_changed(parent);
    let (count, has_events) = parent.restructure(|engine, id| {
        (
            engine.drop_children(id),
            parent.is_rendered() && engine.has_events(),
        )
    });
    let unreported = &parent.arena().unreported;
    unreported.set(unreported.get().saturating_sub(count));
    if has_events {
        crate::api::animation::take_events_after_removing(cx, doc, None);
    }
    if parent.is_rendered() {
        doc.invalidate(cx);
    }
}

/// Whether what is bare in one can stay so in the other.
#[inline]
pub(super) fn are_alike(from: &Doc, to: &Doc) -> bool {
    from == to
        || from.is_in_arena_of(to)
            && from.quirks() == to.quirks()
            && !to.is(DocFlags::CHECKS_STYLE_ATTRIBUTES)
            && !has_scoped_registries()
}

/// Appends those of a fragment, if they are bare and can stay so.
#[inline]
pub(super) fn move_children<'a>(cx: &mut JsScope<'a>, from: &'a Node, parent: &'a Node) -> bool {
    if !from.has(F::HAS_BARE_CHILDREN)
        || from.has(F::HAS_RANGES | F::SHADOW_ROOT)
        || !from.takes_bare()
        || !parent.takes_bare()
        || !are_alike(from.doc(), parent.doc())
    {
        return false;
    }
    if let Some(scope) = parent.scope() {
        for_each_id(from, |id, element| scope.add_id(&cx.heap, id, element));
    }
    from.unset(F::HAS_BARE_CHILDREN);
    children_changed(from);
    parent.got_bare();
    let first = parent
        .arena()
        .write(|engine| engine.tree.move_children(from.id(), parent.id()));
    parent.restructure(|engine, id| engine.children_appended(id, first));
    if parent.is_rendered() {
        parent.doc().invalidate(cx);
    }
    true
}

/// <https://dom.spec.whatwg.org/#string-replace-all>, if the text can be bare. It comes back otherwise.
#[inline]
pub(super) fn replace_with_text<'a>(
    cx: &mut JsScope<'a>,
    text: DomString,
    parent: &'a Node,
) -> Option<DomString> {
    let_go_before_changing(cx, parent);
    if !parent.takes_bare() || parent.has(F::HAS_RANGES) {
        return Some(text);
    }
    if parent.has(F::HAS_BARE_CHILDREN) {
        if let Some(only) = parent.read(Tree::only_text_in).filter(|_| !text.is_empty()) {
            parent.change(|engine, _| engine.set_text(only, text.into()));
            if parent.is_rendered() {
                parent.doc().invalidate(cx);
            }
            return None;
        }
        drop_children(cx, parent);
        if parent.has_children() {
            return Some(text);
        }
    }
    if !text.is_empty() {
        parent.doc().prepare_for_bare(Kind::Text);
        let above = if parent.is_rendered() {
            Above::Rendered
        } else {
            Above::Detached
        };
        let appended = parent.arena().write(|engine| {
            parent.arena().free_dead(engine);
            engine.append_bare_text(parent.id(), above, text.into())
        });
        appended.unwrap_or_else(|it| parent.finish_appending(parent.id(), it));
        parent.set(F::HAS_BARE_CHILDREN);
        parent.bare_changed(cx, 0);
        parent.arena().record_bare_text(parent);
    }
    None
}

/// Whether a copy of it can be bare.
#[inline]
pub(super) fn is_plain(node: &Node, doc: &Doc) -> bool {
    const SPECIAL: F = F::CUSTOM
        .union(F::UNDEFINED)
        .union(F::FAILED_CUSTOM)
        .union(F::HAS_NONCE)
        .union(F::HOST)
        .union(F::HAS_NAMESPACED_ATTR)
        .union(F::STYLE_DIRTY);
    match node.as_element() {
        None => {
            matches!(node.kind(), Kind::Text | Kind::Comment) && doc.prepare_for_bare(node.kind())
        }
        Some(element) => {
            !node.has(SPECIAL)
                && doc.prepare_for_bare(node.kind())
                && !element.may_be_custom()
                && element.is_value().is_none()
                && element.with(|it| {
                    it.has_only_classes()
                        || it
                            .attributes
                            .iter()
                            .all(|it| it.space.is_none() && !needs_object(&it.local))
                })
        }
    }
}

impl Document {
    /// Without the descendants. 0 for a comment.
    #[inline]
    pub(super) fn append_bare_copy(&mut self, of: NodeId, parent: NodeId) -> NodeId {
        match &self.tree[of].data {
            Data::Text(text) => {
                let text = Data::Text(text.clone());
                self.tree.append_bare(parent, text, 0)
            }
            Data::Inert(comment) => {
                let comment = Data::Inert(comment.clone());
                let copy = self.tree.create(comment);
                self.tree.append_comment(parent, copy);
                0
            }
            _ => {
                let copy = self.tree.append_bare_like(of, parent);
                if self.has_edited_style(of) {
                    self.count_style_as_edited(copy);
                }
                copy
            }
        }
    }

    /// Of a node whose children are bare, to one that is not connected. Returns how many they are.
    pub(super) fn copy_children(&mut self, of: NodeId, mut parent: NodeId) -> u32 {
        let (mut walk, mut count) = (Walk::below(&self.tree, of), 0);
        while let Some(step) = walk.step(&self.tree) {
            match step {
                Step::Enter(id) => parent = self.append_bare_copy(id, parent),
                Step::Visit(id) => _ = self.append_bare_copy(id, parent),
                Step::Leave => {
                    parent = self.tree[parent].parent;
                    continue;
                }
            }
            count += 1;
        }
        count
    }
}
