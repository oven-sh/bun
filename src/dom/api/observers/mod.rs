//! <https://drafts.csswg.org/resize-observer/>, <https://w3c.github.io/IntersectionObserver/>

mod intersection;
mod resize;

pub(crate) use intersection::{
    IntersectionObserverEntry, frame_moved, notify_intersection_observers, update_intersections,
};
pub(crate) use resize::{
    ResizeObserverEntry, ResizeObserverSize, deliver_resizes, has_resized_boxes,
};

use core::cell::Cell;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{JsHeap, JsInterface, JsScope};

use crate::api::core::{Doc, DocFlags, Edge, Element, List, NodeFlags};
use crate::api::events;
use crate::generated_bindgen::box_observers::*;
use crate::tree::NodeId;

fn next_serial() -> u64 {
    thread_local! {
        static NEXT: Cell<u64> = const { Cell::new(0) };
    }
    NEXT.replace(NEXT.get() + 1)
}

pub(crate) struct BoxObserver {
    serial: u64,
    /// It changes with `disconnect`.
    generation: Cell<u32>,
    /// `None` if it observes sizes.
    intersection: Option<Box<intersection::Settings>>,
}

#[derive(Clone, Copy)]
enum Reported {
    Size(ResizeObserverBoxOptions, Option<[f64; 2]>),
    Intersection {
        thresholds_crossed: Option<usize>,
        is_visible: bool,
        at: f64,
    },
}

/// The target holds it, and so does its document while there can be something to report.
pub(crate) struct BoxObservation {
    serial: u64,
    /// `None` after `unobserve`.
    generation: Cell<Option<u32>>,
    reported: Cell<Reported>,
}

#[derive(Clone, Copy)]
enum Watches {
    Sizes,
    Intersections,
}

#[derive(Default)]
pub(crate) struct ObservedBoxes {
    is_stale: [Cell<bool>; 2],
    has_new: Cell<bool>,
    sizes_version: Cell<Option<u32>>,
    /// What can change without a layout.
    is_volatile: Cell<bool>,
    is_across_frames: Cell<bool>,
}

fn observations(list: List<'_>) -> impl Iterator<Item = &BoxObservation> {
    // SAFETY: the list has observations.
    list.values()
        .map(|it| unsafe { BoxObservation::from_js_unchecked(it) })
}

impl ObservedBoxes {
    fn of<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> &'a Self {
        let it = doc.same_object(heap, Edge::BoxObservations, || {
            let made = js_ObservedBoxes::create(heap, Self::default());
            js_ObservedBoxes::set_sizes(made, List::new(heap).to_js());
            js_ObservedBoxes::set_intersections(made, List::new(heap).to_js());
            js_ObservedBoxes::set_notified(made, List::new(heap).to_js());
            made.to_js()
        });
        // SAFETY: the edge holds what is made above.
        unsafe { Self::from_js_unchecked(it) }
    }

    fn if_any(doc: &Doc) -> Option<&Self> {
        // SAFETY: as above.
        doc.edge(Edge::BoxObservations)
            .map(|it| unsafe { Self::from_js_unchecked(it) })
    }

    fn list(&self, kind: Watches) -> List<'_> {
        let list = match kind {
            Watches::Sizes => js_ObservedBoxes::sizes(self),
            Watches::Intersections => js_ObservedBoxes::intersections(self),
        };
        List::from_value(list.expect("set when it is made"))
    }

    /// In the order in which they are reported.
    fn active<'a>(&'a self, heap: &JsHeap<'a>, doc: &'a Doc, kind: Watches) -> List<'a> {
        let old = self.list(kind);
        if !self.is_stale[kind as usize].take() {
            return old;
        }
        let mut kept = Vec::new();
        for (index, it) in (0..)
            .zip(observations(old))
            .filter(|it| js_BoxObservation::home(it.1) == Some(doc))
        {
            match it.is_current() && !it.is_dormant() {
                true => kept.push((it.observer().serial, it.serial, index)),
                false => js_BoxObservation::set_home(it, None),
            }
        }
        bun_collections::index_sort::sort_slice_unstable(&mut kept);
        kept.dedup_by_key(|it| it.1);
        let new = List::from_fn(heap, kept.len() as u32, |it| old.get(kept[it as usize].2));
        match kind {
            Watches::Sizes => js_ObservedBoxes::set_sizes(self, new.to_js()),
            Watches::Intersections => js_ObservedBoxes::set_intersections(self, new.to_js()),
        }
        new
    }
}

impl BoxObservation {
    fn observer(&self) -> &BoxObserver {
        js_BoxObservation::observer(self).expect("set when it is made")
    }

    fn target(&self) -> &Element {
        js_BoxObservation::target(self).expect("set when it is made")
    }

    fn id_in(&self, doc: &Doc) -> NodeId {
        Some(self.target())
            .filter(|it| it.is_rendered() && it.doc() == doc)
            .map_or(0, |it| it.id())
    }

    fn is_current(&self) -> bool {
        self.generation.get() == Some(self.observer().generation.get())
    }

    /// There is nothing to report until the target is connected again.
    fn is_dormant(&self) -> bool {
        !self.target().is_connected()
            && matches!(
                self.reported.get(),
                Reported::Size(_, Some([0.0, 0.0]))
                    | Reported::Intersection {
                        thresholds_crossed: Some(0),
                        ..
                    }
            )
    }

    fn outdate_list(&self) {
        js_BoxObservation::home(self)
            .and_then(ObservedBoxes::if_any)
            .into_iter()
            .for_each(|it| it.is_stale[self.observer().watches() as usize].set(true));
    }

    fn report(&self, reported: Reported) {
        self.reported.set(reported);
        if self.is_dormant() {
            self.outdate_list();
        }
    }

    fn activate<'a>(&'a self, heap: &JsHeap<'a>) -> &'a Doc {
        let home = Some(self.target().doc())
            .filter(|it| it.is(DocFlags::HAS_PAGE))
            .unwrap_or_else(|| self.observer().doc());
        if js_BoxObservation::home(self) != Some(home) {
            self.outdate_list();
            js_BoxObservation::set_home(self, Some(home));
            ObservedBoxes::of(heap, home)
                .list(self.observer().watches())
                .push(heap, self.to_js());
            self.outdate_list();
        }
        home
    }
}

fn forget_ended<'a>(heap: &JsHeap<'a>, target: &'a Element) -> List<'a> {
    let all = target.edge_list(heap, Edge::BoxObservations);
    while let Some(index) = observations(all).position(|it| !it.is_current()) {
        all.remove_range(heap, index as u32, 1);
    }
    all
}

pub(crate) fn rendered<'a>(heap: &JsHeap<'a>, target: &'a Element) {
    observations(forget_ended(heap, target)).for_each(|it| _ = it.activate(heap));
}

pub(crate) fn observe_again<'a>(heap: &JsHeap<'a>, doc: &'a Doc) {
    ObservedBoxes::of(heap, doc).has_new.set(true);
}

impl BoxObserver {
    fn new(intersection: Option<intersection::Settings>) -> BoxObserver {
        BoxObserver {
            serial: next_serial(),
            generation: Cell::new(0),
            intersection: intersection.map(Box::new),
        }
    }

    fn init<'a>(&'a self, heap: &JsHeap<'a>, callback: JSValue, doc: &'a Doc) {
        js_BoxObserver::set_callback(self, callback);
        js_BoxObserver::set_document(self, Some(doc));
        js_BoxObserver::set_entries(self, List::new(heap).to_js());
    }

    fn doc(&self) -> &Doc {
        js_BoxObserver::document(self).expect("set when it is made")
    }

    fn watches(&self) -> Watches {
        if self.intersection.is_some() {
            Watches::Intersections
        } else {
            Watches::Sizes
        }
    }

    fn entries(&self) -> List<'_> {
        List::from_value(js_BoxObserver::entries(self).expect("set when it is made"))
    }

    fn take_entries<'a>(&'a self, heap: &JsHeap<'a>) -> List<'a> {
        let entries = self.entries();
        js_BoxObserver::set_entries(self, List::new(self.realm(heap)).to_js());
        entries
    }

    fn find<'a>(&self, target: &'a Element) -> Option<&'a BoxObservation> {
        observations(List::from_value(target.edge(Edge::BoxObservations)?))
            .find(|it| core::ptr::eq(it.observer(), self) && it.is_current())
    }

    fn start<'a>(&'a self, cx: &mut JsScope<'a>, target: &'a Element, reported: Reported) {
        self.stop(&cx.heap, target);
        let made = js_BoxObservation::create(
            &cx.heap,
            BoxObservation {
                serial: next_serial(),
                generation: Some(self.generation.get()).into(),
                reported: reported.into(),
            },
        );
        js_BoxObservation::set_observer(made, Some(self));
        js_BoxObservation::set_target(made, Some(target));
        forget_ended(&cx.heap, target).push(&cx.heap, made.to_js());
        target.set(NodeFlags::WATCHED);
        let home = made.activate(&cx.heap);
        observe_again(&cx.heap, home);
        home.invalidate(cx);
    }

    fn stop<'a>(&'a self, heap: &JsHeap<'a>, target: &'a Element) {
        if let Some(found) = self.find(target) {
            found.generation.set(None);
            found.outdate_list();
            forget_ended(heap, target);
        }
    }

    fn stop_all<'a>(&'a self, heap: &JsHeap<'a>) {
        self.generation.update(|it| it + 1);
        self.entries().clear(heap);
        let Some(all) = ObservedBoxes::if_any(self.doc()) else {
            return;
        };
        all.is_stale[self.watches() as usize].set(true);
        observations(all.list(self.watches()))
            .filter(|it| core::ptr::eq(it.observer(), self))
            .for_each(|it| _ = forget_ended(heap, it.target()));
    }

    fn deliver<'a>(&'a self, cx: &mut JsScope<'a>, doc: &'a Doc) {
        if !self.entries().is_empty() {
            let (entries, callback) = (
                self.take_entries(&cx.heap),
                js_BoxObserver::callback(self).expect("set when it is made"),
            );
            doc.window()
                .filter(|it| !it.is_disposed())
                .into_iter()
                .for_each(|it| {
                    events::call_back(
                        cx,
                        Some(it),
                        callback,
                        self.to_js(),
                        &[entries.to_js(), self.to_js()],
                    )
                });
        }
    }
}
