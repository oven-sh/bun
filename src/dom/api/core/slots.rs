//! Shadow roots, and <https://dom.spec.whatwg.org/#shadow-tree-slots>

use core::cell::RefCell;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsScope};

use super::{NodeFlags as F, *};
use crate::generated_bindgen::core::{ShadowRootInit, ShadowRootMode, SlotAssignmentMode};
use crate::name::Map;
use crate::order::Order as _;
use crate::tree::NodeId;

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    pub(crate) struct ShadowFlags: u16 {
        const CLOSED = 1;
        const DELEGATES_FOCUS = 1 << 1;
        const MANUAL_SLOTS = 1 << 2;
        const CLONABLE = 1 << 3;
        const SERIALIZABLE = 1 << 4;
        const DECLARATIVE = 1 << 5;
        const KEEPS_REGISTRY_NULL = 1 << 6;
        const AVAILABLE_TO_INTERNALS = 1 << 7;
        /// The control has two slots, and says which child goes to the first.
        const OWN_SLOTTING = 1 << 8;
        /// It has had some.
        const HAS_SLOTS = 1 << 9;
    }
}

#[derive(Default)]
struct ReferenceTarget(RefCell<Option<DomString>>);

impl ShadowRoot {
    #[inline]
    pub(crate) fn is(&self, flags: ShadowFlags) -> bool {
        ShadowFlags::from_bits_retain(self.bits_of_kind().get()).intersects(flags)
    }

    pub(crate) fn set_shadow_flags(&self, flags: ShadowFlags, on: bool) {
        let old = ShadowFlags::from_bits_retain(self.bits_of_kind().get());
        self.bits_of_kind()
            .set(if on { old | flags } else { old - flags }.bits());
    }

    pub(crate) fn host_element(&self) -> &Element {
        self.host()
            .and_then(Node::as_element)
            .expect("a shadow root has a host")
    }

    pub(crate) fn reference_target(&self) -> Option<DomString> {
        self.try_extra::<ReferenceTarget>()?.0.borrow().clone()
    }

    pub(crate) fn set_reference_target(&self, id: Option<DomString>) {
        if id.is_some() || self.try_extra::<ReferenceTarget>().is_some() {
            *self.extra::<ReferenceTarget>().0.borrow_mut() = id;
            self.ties_changed();
        }
    }
}

impl Element {
    /// That of a control too.
    #[inline]
    pub(crate) fn shadow_root(&self) -> Option<&ShadowRoot> {
        if self.has(F::HOST) {
            self.edge_node(Edge::ShadowRoot)?.as_shadow_root()
        } else {
            None
        }
    }

    pub(crate) fn attach_shadow_unchecked<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        user_agent: bool,
    ) -> &'a ShadowRoot {
        if let Some(existing) = self.shadow_root() {
            return existing;
        }
        self.first_child();
        let flags = F::SHADOW_ROOT
            | if user_agent {
                F::USER_AGENT
            } else {
                F::empty()
            }
            | self.flags() & (F::CONNECTED | F::RENDERED);
        let root = self
            .doc()
            .create_node(&cx.heap, Kind::ShadowRoot, flags, |engine| {
                engine.attach_shadow(self.id(), user_agent)
            });
        root.set_edge(&cx.heap, Edge::Host, self.to_js());
        self.set_edge(&cx.heap, Edge::ShadowRoot, root.to_js());
        self.set(F::HOST);
        if self.is_rendered() {
            self.doc().invalidate(cx);
        }
        // SAFETY: of that kind.
        unsafe { root.cast() }
    }

    /// <https://dom.spec.whatwg.org/#concept-attach-a-shadow-root>
    pub(crate) fn attach_shadow<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        flags: ShadowFlags,
        registry: JSValue,
    ) -> bindgen::Result<'a, &'a ShadowRoot> {
        let is_host = matches!(
            self.html_tag(),
            atom!("article")
                | atom!("aside")
                | atom!("blockquote")
                | atom!("body")
                | atom!("div")
                | atom!("footer")
                | atom!("h1")
                | atom!("h2")
                | atom!("h3")
                | atom!("h4")
                | atom!("h5")
                | atom!("h6")
                | atom!("header")
                | atom!("main")
                | atom!("nav")
                | atom!("p")
                | atom!("section")
                | atom!("span")
        );
        if !(is_host || self.kind().is_html() && is_valid_custom_element_name(&self.local()))
            || custom::disables_shadow(self)
        {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "This element does not support attachShadow",
            ));
        }
        if let Some(existing) = self.shadow_root() {
            if !existing.is(ShadowFlags::DECLARATIVE)
                || existing.is(ShadowFlags::CLOSED) != flags.contains(ShadowFlags::CLOSED)
            {
                return Err(dom_error(
                    &cx.heap,
                    DomError::NotSupportedError,
                    "Shadow root cannot be created on a host which already hosts a shadow tree.",
                ));
            }
            replace_all(cx, None, existing);
            existing.set_shadow_flags(ShadowFlags::DECLARATIVE, false);
            return Ok(existing);
        }
        let root = self.attach_shadow_unchecked(cx, false);
        root.set_shadow_flags(flags, true);
        root.set_shadow_flags(
            ShadowFlags::AVAILABLE_TO_INTERNALS,
            root.is(ShadowFlags::DECLARATIVE) || custom::definition_of(self).is_some(),
        );
        custom::set_own_registry(
            &cx.heap,
            root,
            custom::as_own_registry(&cx.heap, registry, self.doc()),
        );
        Ok(root)
    }

    pub(crate) fn js_attach_shadow<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        init: &ShadowRootInit<'a>,
    ) -> bindgen::Result<'a, &'a ShadowRoot> {
        let registry =
            custom::registry_option(&cx.heap, init.custom_element_registry.to_js(), self.doc())?;
        let reference_target = init
            .reference_target
            .map(|it| DomString::from_js_string(&cx.heap, it))
            .transpose()?;
        let mut flags = ShadowFlags::empty();
        flags.set(ShadowFlags::CLOSED, init.mode == ShadowRootMode::Closed);
        flags.set(ShadowFlags::DELEGATES_FOCUS, init.delegates_focus);
        flags.set(
            ShadowFlags::MANUAL_SLOTS,
            init.slot_assignment == SlotAssignmentMode::Manual,
        );
        flags.set(ShadowFlags::CLONABLE, init.clonable);
        flags.set(ShadowFlags::SERIALIZABLE, init.serializable);
        let is_new = !self.has(F::HOST);
        let root = self.attach_shadow(cx, flags, registry)?;
        if is_new {
            root.set_reference_target(reference_target);
        }
        Ok(root)
    }

    pub(crate) fn attach_ua_shadow<'a>(&'a self, cx: &mut JsScope<'a>) -> &'a ShadowRoot {
        self.attach_shadow_unchecked(cx, true)
    }

    /// The element that a reference to this one from outside of its shadow tree applies to.
    pub(crate) fn reference_target(&self) -> Option<&Element> {
        let mut at = self;
        while let Some(root) = at.shadow_root()
            && let Some(id) = root.reference_target()
        {
            at = root.element_by_id(&Atom::from_string(&id))?;
        }
        Some(at)
    }

    /// The elements that can refer to it, in tree order.
    pub(crate) fn referrers(&self) -> impl Iterator<Item = &Element> {
        let targets = move |root: &&Node| {
            root.as_shadow_root().is_some_and(|it| {
                it.reference_target().is_some()
                    && it.host_element().reference_target() == Some(self)
            })
        };
        let hosts: smallvec::SmallVec<[&Node; 1]> =
            core::iter::successors(Some(self.root()).filter(targets), |it| {
                Some(it.host()?.root()).filter(targets)
            })
            .filter_map(Node::host)
            .collect();
        let top = hosts.last().map_or_else(|| self.root(), |it| it.root());
        let next = move |at: &&'_ Node| -> Option<*const Node> {
            let inside = at
                .as_element()
                .filter(|_| hosts.contains(at))
                .and_then(Element::shadow_root)
                .map(|it| &***it);
            let after = || {
                at.following(None).or_else(|| {
                    core::iter::successors(at.root().host(), |it| it.root().host())
                        .take_while(|it| hosts.contains(it))
                        .find_map(|it| it.following(None))
                })
            };
            inside.or_else(after).map(core::ptr::from_ref)
        };
        // SAFETY: they are in the tree that `self` is in.
        core::iter::successors(Some(top), move |it| next(it).map(|it| unsafe { &*it }))
            .skip(1)
            .filter_map(Node::as_element)
    }

    pub(crate) fn become_slot(&self) {
        self.set(F::SLOT);
        self.arena().has_slots.set(true);
    }

    fn has_assigned_nodes(&self) -> bool {
        self.read(|tree, id| tree.element(id).is_some_and(|it| !it.assigned.is_empty()))
    }

    /// `HTMLSlotElement.assign()`
    pub(crate) fn assign_manually<'a>(&'a self, cx: &mut JsScope<'a>, nodes: &Rooted<'a>) {
        let manual = self.edge_list(&cx.heap, Edge::ManuallyAssigned);
        manual
            .nodes()
            .for_each(|it| it.clear_edge(&cx.heap, Edge::ManualSlot));
        manual.clear(&cx.heap);
        for node in nodes.iter().filter(|it| !manual.contains(it.to_js())) {
            manual.push(&cx.heap, node.to_js());
            node.set_edge(&cx.heap, Edge::ManualSlot, self.to_js());
        }
        if let Some(root) = self.root().as_shadow_root() {
            assign_slottables(cx, root);
        }
    }
}

fn signal<'a>(cx: &mut JsScope<'a>, slot: &'a Element) {
    if !slot.has(F::USER_AGENT) {
        observers::signal_slot_change(&cx.heap, slot);
    }
}

fn slots_in(root: &Node) -> impl Iterator<Item = &Element> {
    root.as_element()
        .into_iter()
        .chain(root.objects_with_tag(atom!("slot")))
        .filter(|it| it.has(F::SLOT))
}

fn is_slottable(node: &Node) -> bool {
    node.is_element() || node.kind() == Kind::Text
}

fn slot_name_of(node: &Node) -> DomString {
    node.as_element()
        .and_then(|it| it.attr(atom!("slot")))
        .unwrap_or_default()
}

fn name_of(slot: &Element) -> DomString {
    slot.attr(atom!("name")).unwrap_or_default()
}

fn slot_named<'a>(shadow: &'a ShadowRoot, name: &DomString) -> Option<&'a Element> {
    const FEW: usize = 8;
    static SLOTS: Test = Test {
        tags: &[atom!("slot")],
        bare: Bare::None,
        matches: |it| it.has(F::SLOT),
        ..Test::ALL
    };
    let mut all = slots_in(shadow);
    all.by_ref()
        .take(FEW)
        .find(|it| {
            it.with_attr_string(atom!("name"), |it| it == name)
                .unwrap_or_else(|| name.is_empty())
        })
        .or_else(|| {
            all.next()?;
            shadow
                .unseen_collection(16, &SLOTS)
                .all_named(&Atom::from_string(name), |it| [Some(name_of(it)), None])
                .first()
                .copied()
        })
}

fn goes_by_names(shadow: &ShadowRoot) -> bool {
    !shadow.is(ShadowFlags::MANUAL_SLOTS) && !shadow.is(ShadowFlags::OWN_SLOTTING)
}

/// Of a child of the host.
pub(super) fn slot_attribute_changed<'a>(
    cx: &mut JsScope<'a>,
    shadow: &'a ShadowRoot,
    child: &'a Element,
) {
    if !shadow.is(ShadowFlags::HAS_SLOTS) || !goes_by_names(shadow) {
        return;
    }
    let (old, new) = (
        child.assigned_slot(),
        slot_named(shadow, &slot_name_of(child)),
    );
    if old == new {
        return;
    }
    old.inspect(|it| it.restructure(|engine, slot| engine.remove_from_slot(slot, child.id())));
    new.inspect(|it| it.restructure(|engine, slot| engine.add_to_slot(slot, child.id())));
    old.into_iter().chain(new).for_each(|it| signal(cx, it));
    if shadow.is_rendered() {
        shadow.doc().invalidate(cx);
    }
}

/// If `moved` has come or gone, and has not been assigned anew.
fn other_children_stay(shadow: &ShadowRoot, moved: &Node) -> bool {
    if !shadow.is(ShadowFlags::OWN_SLOTTING) {
        return true;
    }
    let (wanted, first) = (
        seams::slotted_first(shadow.host_element()).map(|it| it.id()),
        slots_in(shadow).next(),
    );
    wanted != Some(moved.id())
        && first.is_some_and(|it| it.with(|it| it.assigned.first().copied()) == wanted)
}

/// <https://dom.spec.whatwg.org/#assign-a-slot>
fn assign_a_slot<'a>(cx: &mut JsScope<'a>, shadow: &'a ShadowRoot, node: &'a Node) {
    let is_manual = shadow.is(ShadowFlags::MANUAL_SLOTS);
    if !shadow.is(ShadowFlags::HAS_SLOTS)
        || !is_slottable(node)
        || is_manual && node.edge(Edge::ManualSlot).is_none()
    {
        return;
    }
    if is_manual || !other_children_stay(shadow, node) {
        return assign_slottables(cx, shadow);
    }
    let slot = match shadow.is(ShadowFlags::OWN_SLOTTING) {
        true => slots_in(shadow).nth(1),
        false => slot_named(shadow, &slot_name_of(node)),
    };
    if let Some(slot) = slot {
        slot.restructure(|engine, slot| engine.add_to_slot(slot, node.id()));
        signal(cx, slot);
    }
}

pub(crate) fn assign_slottables<'a>(cx: &mut JsScope<'a>, shadow: &'a ShadowRoot) {
    assign(cx, shadow, None);
}

/// The slots, and what belongs to each.
fn find_slottables<'a>(
    heap: &JsHeap<'a>,
    shadow: &'a ShadowRoot,
) -> (Rooted<'a>, Vec<Vec<NodeId>>) {
    let slots = Rooted::from_nodes(heap, slots_in(shadow).map(|it| &**it));
    let mut names = Map::default();
    for (index, slot) in slots.iter().filter_map(Node::as_element).enumerate() {
        names
            .entry(Atom::from_string(&name_of(slot)))
            .or_insert(index);
    }
    let mut assigned = vec![Vec::<NodeId>::new(); slots.len() as usize];
    let first = shadow
        .is(ShadowFlags::OWN_SLOTTING)
        .then(|| seams::slotted_first(shadow.host_element()).map(|it| &**it));
    for child in shadow
        .host_element()
        .children()
        .filter(|it| is_slottable(it))
    {
        let index = if shadow.is(ShadowFlags::MANUAL_SLOTS) {
            slots
                .iter()
                .position(|it| Some(it) == child.edge_node(Edge::ManualSlot))
        } else if let Some(first) = first {
            Some(usize::from(first != Some(child)))
        } else {
            names.get(&Atom::from_string(&slot_name_of(child))).copied()
        };
        index
            .and_then(|it| assigned.get_mut(it))
            .into_iter()
            .for_each(|it| it.push(child.id()));
    }
    (slots, assigned)
}

/// `changed` has lost a node already.
fn assign<'a>(cx: &mut JsScope<'a>, shadow: &'a ShadowRoot, changed: Option<&'a Element>) {
    if !shadow.is(ShadowFlags::HAS_SLOTS) {
        return;
    }
    let (slots, mut assigned) = find_slottables(&cx.heap, shadow);
    let mut differs = Vec::with_capacity(assigned.len());
    for (slot, ids) in slots.iter().zip(&mut assigned) {
        if let Some(manual) = slot
            .try_edge_list(Edge::ManuallyAssigned)
            .filter(|_| shadow.is(ShadowFlags::MANUAL_SLOTS))
        {
            ids.order_by_key(|id| manual.nodes().position(|it| it.id() == *id));
        }
        differs.push(
            changed.is_some_and(|it| **it == *slot)
                || slot.read(|tree, id| tree.element(id).is_some_and(|it| *it.assigned != **ids)),
        );
    }
    let needs_frame = shadow.is_rendered() && differs.contains(&true);
    for ((slot, ids), differs) in slots
        .iter()
        .filter_map(Node::as_element)
        .zip(assigned)
        .zip(differs)
    {
        if differs {
            slot.restructure(|engine, id| engine.assign_slot(id, ids.clone()));
            signal(cx, slot);
        }
    }
    if needs_frame {
        shadow.doc().invalidate(cx);
    }
}

#[inline]
fn shadow_root_around(node: &Node) -> Option<&ShadowRoot> {
    node.is_in_shadow_tree()
        .then(|| node.root().as_shadow_root())?
}

pub(super) fn after_insert<'a>(cx: &mut JsScope<'a>, node: &'a Node, parent: &'a Node) {
    if let Some(shadow) = parent.as_element().and_then(Element::shadow_root) {
        assign_a_slot(cx, shadow, node);
    }
    let Some(root) = shadow_root_around(parent) else {
        return;
    };
    if let Some(slot) = parent
        .as_element()
        .filter(|it| it.has(F::SLOT) && !it.has_assigned_nodes())
    {
        signal(cx, slot);
    }
    if slots_in(node).next().is_some() {
        root.set_shadow_flags(ShadowFlags::HAS_SLOTS, true);
        let is_wanted = |slot: &Element| {
            let name = name_of(slot);
            root.host_element()
                .children()
                .any(|it| is_slottable(it) && slot_name_of(it) == name)
                && slot_named(root, &name) == Some(slot)
        };
        if !goes_by_names(root) || slots_in(node).nth(1).is_some() || slots_in(node).any(is_wanted)
        {
            assign_slottables(cx, root);
        }
    }
}

/// `None` if there is no slot in `node`. Else those that had nodes.
pub(super) fn unassign_removed<'a>(
    heap: &JsHeap<'a>,
    node: &'a Node,
    parent: &'a Node,
) -> Option<Rooted<'a>> {
    let root = shadow_root_around(parent)?;
    slots_in(node).next()?;
    let emptied = Rooted::from_nodes(
        heap,
        slots_in(node)
            .filter(|it| it.has_assigned_nodes())
            .map(|it| &**it),
    );
    emptied
        .iter()
        .for_each(|it| root.restructure(|engine, _| engine.unassign_all(it.id())));
    Some(emptied)
}

pub(super) fn after_remove<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    parent: &'a Node,
    slot: Option<&'a Element>,
    emptied: Option<Rooted<'a>>,
) {
    if let Some(shadow) = parent.as_element().and_then(Element::shadow_root) {
        if node.parent().is_some() || !other_children_stay(shadow, node) {
            assign(cx, shadow, slot);
        } else if let Some(slot) = slot {
            let id = if node.is_in_arena_of(slot) {
                node.id()
            } else {
                0
            };
            slot.restructure(|engine, slot| engine.remove_from_slot(slot, id));
            signal(cx, slot);
        }
    }
    let Some(root) = shadow_root_around(parent) else {
        return;
    };
    if let Some(slot) = parent
        .as_element()
        .filter(|it| it.has(F::SLOT) && !it.has_assigned_nodes())
    {
        signal(cx, slot);
    }
    if let Some(emptied) = emptied {
        emptied
            .iter()
            .filter_map(Node::as_element)
            .for_each(|it| signal(cx, it));
        if !emptied.is_empty() || !goes_by_names(root) {
            assign_slottables(cx, root);
        }
    }
}
