//! <https://dom.spec.whatwg.org/#mutation-observers>

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{self, Callable, ClassStructure, JsHeap, JsInterface, JsLocal, JsScope};
use bun_jsc::{JSString, JSValue};
use smallvec::SmallVec;

use super::{NodeFlags as F, *};
use crate::generated_bindgen::observers::{
    MutationObserverInit, js_DomAgent, js_MutationObserver, js_MutationRecord,
};
use crate::order::Order as _;

type Str<'a> = JsLocal<'a, JSString>;

pub(crate) struct MutationObserver {
    serial: u64,
    is_active: Cell<bool>,
}

pub(crate) struct MutationRecord {
    kind: Known,
    name: Option<QualName>,
    old_value: Option<DomString>,
    _interior: bun_jsc::bindgen::Interior,
}

struct Options {
    types: DocFlags,
    old_values: DocFlags,
    subtree: bool,
    filter: Option<Box<[Atom]>>,
}

#[derive(Clone)]
struct Registration {
    /// One that is transient shares them with its source.
    options: Rc<Options>,
    is_transient: bool,
}

/// In the order of the links at `Edge::Observers`.
#[derive(Default)]
struct Registrations(RefCell<Vec<Registration>>);

#[derive(Clone, Copy)]
pub(crate) enum Record<'r, 'a> {
    Children {
        added: &'r Rooted<'a>,
        removed: &'r Rooted<'a>,
        previous: Option<&'a Node>,
        next: Option<&'a Node>,
    },
    Attribute {
        name: &'r QualName,
        old: Option<&'r DomString>,
    },
    Data {
        old: &'r DomString,
    },
}

fn observer_of<'a>(link: JSValue) -> Option<&'a MutationObserver> {
    // SAFETY: it has nothing else, and the node holds it.
    Some(List::from_value(link).get(0))
        .filter(|it| !it.is_empty())
        .map(|it| unsafe { MutationObserver::from_js_unchecked(it) })
}

impl Node {
    fn register(&self, heap: &JsHeap<'_>, link: JSValue, registration: Registration) {
        self.edge_list(heap, Edge::Observers).push(heap, link);
        self.extra::<Registrations>()
            .0
            .borrow_mut()
            .push(registration);
        self.set(F::OBSERVED);
    }

    /// Those of observers that were disconnected go too.
    fn unregister(
        &self,
        heap: &JsHeap<'_>,
        goes: impl Fn(&MutationObserver, &Registration) -> bool,
    ) {
        let Some(links) = self.try_edge_list(Edge::Observers) else {
            return;
        };
        let mut all = self.extra::<Registrations>().0.borrow_mut();
        for index in (0..all.len()).rev() {
            if observer_of(links.get(index as u32)).is_none_or(|it| goes(it, &all[index])) {
                all.remove(index);
                links.remove_range(heap, index as u32, 1);
            }
        }
        self.toggle(F::OBSERVED, !all.is_empty());
    }

    /// Of itself and its ancestors.
    #[inline]
    fn for_each_registration<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        mut visit: impl FnMut(&'a Node, &'a MutationObserver, &Rc<Options>),
    ) {
        for node in self.inclusive_ancestors().filter(|it| it.has(F::OBSERVED)) {
            let (Some(links), mut has_stale) = (node.try_edge_list(Edge::Observers), false) else {
                continue;
            };
            for (index, it) in node.extra::<Registrations>().0.borrow().iter().enumerate() {
                match observer_of(links.get(index as u32)) {
                    Some(observer) => visit(node, observer, &it.options),
                    None => has_stale = true,
                }
            }
            if has_stale {
                node.unregister(heap, |_, _| false);
            }
        }
    }
}

fn nodes_of<'a>(heap: &JsHeap<'a>, nodes: &Rooted<'a>) -> JSValue {
    match nodes.len() {
        0 => JSValue::ZERO,
        1 => nodes.get(0).map_or(JSValue::ZERO, Node::to_js),
        _ => nodes.to_list(heap).to_js(),
    }
}

pub(crate) fn queue_mutation_record<'a>(
    heap: &JsHeap<'a>,
    target: &'a Node,
    record: Record<'_, 'a>,
) {
    if target.doc().is(DocFlags::RECORDS_EDITS) {
        crate::api::editing::history::note(heap, target, &record);
    }
    let (wanted, kind) = match record {
        Record::Children { .. } => (DocFlags::OBSERVES_CHILDREN, atom!("childList")),
        Record::Attribute { .. } => (DocFlags::OBSERVES_ATTRIBUTES, atom!("attributes")),
        Record::Data { .. } => (DocFlags::OBSERVES_DATA, atom!("characterData")),
    };
    // The nodes hold them.
    let mut interested = SmallVec::<[(&MutationObserver, bool); 4]>::new();
    target.for_each_registration(heap, |node, observer, it| {
        let is_filtered = matches!((&record, &it.filter), (Record::Attribute { name, .. }, Some(filter)) if name.ns != Ns::None || !filter.contains(&name.local));
        if !it.types.intersects(wanted) || node != target && !it.subtree || is_filtered {
            return;
        }
        match interested.iter_mut().find(|it| core::ptr::eq(it.0, observer)) {
            Some(known) => known.1 |= it.old_values.intersects(wanted),
            None => interested.push((observer, it.old_values.intersects(wanted))),
        }
    });
    for (observer, wants_old) in interested {
        let (name, old) = match record {
            Record::Children { .. } => (None, None),
            Record::Attribute { name, old } => (Some(name.clone()), old),
            Record::Data { old } => (None, Some(old)),
        };
        let heap = observer.realm(heap);
        let made = js_MutationRecord::create(
            heap,
            MutationRecord {
                kind,
                name,
                old_value: old.filter(|_| wants_old).cloned(),
                _interior: Default::default(),
            },
        );
        js_MutationRecord::set_target(made, Some(target));
        if let Record::Children {
            added,
            removed,
            previous,
            next,
        } = record
        {
            js_MutationRecord::set_previous(made, previous);
            js_MutationRecord::set_next(made, next);
            js_MutationRecord::set_added(made, nodes_of(heap, added));
            js_MutationRecord::set_removed(made, nodes_of(heap, removed));
        }
        observer
            .list(
                heap,
                js_MutationObserver::records,
                js_MutationObserver::set_records,
            )
            .push(heap, made.to_js());
        observer.activate(heap, target);
    }
}

/// `node` was removed from `parent`.
pub(crate) fn observe_transiently<'a>(heap: &JsHeap<'a>, node: &'a Node, parent: &'a Node) {
    parent.for_each_registration(heap, |at, observer, it| {
        if it.subtree && at != node {
            node.register(
                heap,
                observer.link(heap),
                Registration {
                    options: Rc::clone(it),
                    is_transient: true,
                },
            );
            observer
                .list(
                    heap,
                    js_MutationObserver::transient,
                    js_MutationObserver::set_transient,
                )
                .push(heap, node.to_js());
            observer.activate(heap, node);
        }
    });
}

pub(crate) fn signal_slot_change<'a>(heap: &JsHeap<'a>, slot: &'a Element) {
    if !slot.has(F::IS_SIGNALED) {
        slot.set(F::IS_SIGNALED);
        let agent = slot.agent();
        agent.slots().push(heap, slot.to_js());
        agent.queue_notification();
    }
}

pub(crate) fn notify_observers<'a>(cx: &mut JsScope<'a>, agent: &'a Agent) {
    agent.is_notification_queued.set(false);
    let (active, slots) = (agent.observers(), agent.slots());
    js_DomAgent::set_observers(agent, List::new(&cx.heap).to_js());
    if !slots.is_empty() {
        js_DomAgent::set_slots(agent, List::new(&cx.heap).to_js());
        slots.nodes().for_each(|it| it.unset(F::IS_SIGNALED));
    }
    // SAFETY: `active` has nothing else, and holds them.
    let mut observers: SmallVec<[&MutationObserver; 4]> = active
        .values()
        .map(|it| unsafe { MutationObserver::from_js_unchecked(it) })
        .collect();
    observers.order_by_key(|it| it.serial);
    observers.iter().for_each(|it| it.is_active.set(false));
    for observer in observers {
        observer.drop_transient(&cx.heap);
        if let (Some(records), Some(callback)) = (
            js_MutationObserver::records(observer),
            js_MutationObserver::callback(observer),
        ) {
            js_MutationObserver::set_records(observer, JSValue::ZERO);
            agent.call_back(cx, callback, observer.to_js(), &[records, observer.to_js()]);
        }
    }
    active.to_js().ensure_still_alive();
    let count = slots.len();
    slots.nodes().take(count as usize).for_each(|it| {
        _ = fire(
            cx,
            it,
            atom!("slotchange"),
            EventInit {
                bubbles: true,
                ..EventInit::default()
            },
        )
    });
}

impl MutationObserver {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        callback: JsLocal<'a, Callable>,
    ) -> &'a Self {
        thread_local! {
            static SERIAL: Cell<u64> = const { Cell::new(0) };
        }
        let made = structure.create(
            heap,
            MutationObserver {
                serial: SERIAL.replace(SERIAL.get() + 1),
                is_active: Cell::new(false),
            },
        );
        js_MutationObserver::set_callback(made, callback.to_js());
        made
    }

    fn list<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        get: fn(&Self) -> Option<JSValue>,
        set: fn(&Self, JSValue),
    ) -> List<'a> {
        List::from_value(get(self).unwrap_or_else(|| {
            let made = List::new(self.realm(heap)).to_js();
            set(self, made);
            made
        }))
    }

    fn link<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        let link = self.list(
            heap,
            js_MutationObserver::link,
            js_MutationObserver::set_link,
        );
        if link.is_empty() {
            link.push(heap, self.to_js());
        }
        link.to_js()
    }

    fn activate(&self, heap: &JsHeap<'_>, node: &Node) {
        if !self.is_active.replace(true) {
            let agent = node.agent();
            agent.observers().push(heap, self.to_js());
            agent.queue_notification();
        }
    }

    fn drop_transient(&self, heap: &JsHeap<'_>) {
        if let Some(nodes) = js_MutationObserver::transient(self) {
            js_MutationObserver::set_transient(self, JSValue::ZERO);
            List::from_value(nodes).nodes().for_each(|it| {
                it.unregister(heap, |observer, it| {
                    it.is_transient && core::ptr::eq(observer, self)
                })
            });
        }
    }

    pub(crate) fn observe<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        target: &'a Node,
        options: &MutationObserverInit<'a>,
    ) -> bindgen::Result<'a, ()> {
        let attributes = options.attributes.unwrap_or_else(|| {
            options.attribute_old_value.is_some() || options.attribute_filter.is_some()
        });
        let data = options
            .character_data
            .unwrap_or_else(|| options.character_data_old_value.is_some());
        let (old_attributes, old_data) = (
            options.attribute_old_value == Some(true),
            options.character_data_old_value == Some(true),
        );
        if !(options.child_list || attributes || data) {
            return Err(heap.type_error(format_args!("The options object must set at least one of 'attributes', 'characterData', or 'childList'.")));
        }
        if (old_attributes || options.attribute_filter.is_some()) && !attributes
            || old_data && !data
        {
            return Err(heap.type_error(format_args!(
                "The options object asks for details of what it does not observe."
            )));
        }
        let flags = |children: bool, attributes: bool, data: bool| {
            DocFlags::from_bits_retain(
                u16::from(children) | u16::from(attributes) << 1 | u16::from(data) << 2,
            )
        };
        let filter = options
            .attribute_filter
            .as_ref()
            .map(|it| it.iter().map(|it| Atom::from_impl(it.get())).collect());
        let options = Rc::new(Options {
            types: flags(options.child_list, attributes, data),
            old_values: flags(false, old_attributes, old_data),
            subtree: options.subtree,
            filter,
        });
        target.doc().set_doc_flags(options.types, true);
        target.unregister(heap, |_, _| false);
        let link = self.link(heap);
        let replaced = target.try_edge_list(Edge::Observers).and_then(|links| {
            let mut all = target.extra::<Registrations>().0.borrow_mut();
            let (_, existing) = all
                .iter_mut()
                .enumerate()
                .find(|(index, it)| !it.is_transient && links.get(*index as u32) == link)?;
            Some(core::mem::replace(
                &mut existing.options,
                Rc::clone(&options),
            ))
        });
        match (replaced, js_MutationObserver::transient(self)) {
            (None, _) => target.register(
                heap,
                link,
                Registration {
                    options,
                    is_transient: false,
                },
            ),
            (Some(old), Some(nodes)) => List::from_value(nodes)
                .nodes()
                .for_each(|it| it.unregister(heap, |_, it| Rc::ptr_eq(&it.options, &old))),
            (Some(_), None) => {}
        }
        Ok(())
    }

    pub(crate) fn disconnect<'a>(&'a self, heap: &JsHeap<'a>) {
        if let Some(link) = js_MutationObserver::link(self) {
            List::from_value(link).clear(heap);
        }
        [
            js_MutationObserver::set_link,
            js_MutationObserver::set_records,
            js_MutationObserver::set_transient,
        ]
        .into_iter()
        .for_each(|set| set(self, JSValue::ZERO));
    }

    pub(crate) fn take_records<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        let records = self.list(
            heap,
            js_MutationObserver::records,
            js_MutationObserver::set_records,
        );
        js_MutationObserver::set_records(self, JSValue::ZERO);
        records.to_js()
    }
}

impl MutationRecord {
    pub(crate) fn get_type<'a>(&self, heap: &JsHeap<'a>) -> Str<'a> {
        Atom::of(self.kind).to_js(heap)
    }

    fn node_list<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        nodes: Option<JSValue>,
        set: fn(&Self, JSValue),
    ) -> JSValue {
        let heap = self.realm(heap);
        let made = match nodes {
            Some(list) if NodeList::is(list) => return list,
            Some(list) if !Node::is(list) => NodeList::from_list(heap, List::from_value(list)),
            one => NodeList::from_nodes(heap, one.and_then(|it| Node::from_js(heap, it))),
        };
        set(self, made.to_js());
        made.to_js()
    }

    pub(crate) fn get_added_nodes<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.node_list(
            heap,
            js_MutationRecord::added(self),
            js_MutationRecord::set_added,
        )
    }

    pub(crate) fn get_removed_nodes<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.node_list(
            heap,
            js_MutationRecord::removed(self),
            js_MutationRecord::set_removed,
        )
    }

    pub(crate) fn get_attribute_name<'a>(&self, heap: &JsHeap<'a>) -> Option<Str<'a>> {
        Some(self.name.as_ref()?.local.to_js(heap))
    }

    pub(crate) fn get_attribute_namespace<'a>(&self, heap: &JsHeap<'a>) -> Option<Str<'a>> {
        Some(self.name.as_ref()?.ns.uri()?.to_js(heap))
    }

    pub(crate) fn get_old_value<'a>(&self, heap: &JsHeap<'a>) -> Option<Str<'a>> {
        Some(self.old_value.as_ref()?.to_js(heap))
    }
}
