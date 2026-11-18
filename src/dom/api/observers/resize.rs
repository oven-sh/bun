use bun_jsc::bindgen::{Callable, ClassStructure, JsHeap, JsInterface, JsLocal, JsScope, Result};

use super::{BoxObservation, BoxObserver, ObservedBoxes, Reported, Watches, observations};
use crate::api::core::{Doc, Element, List, Node, seams};
use crate::api::geometry::DOMRectReadOnly;
use crate::document::Document;
use crate::generated_bindgen::box_observers::*;
use crate::tree::NodeId;

pub(crate) struct ResizeObserverSize([f64; 2]);

impl ResizeObserverSize {
    pub(crate) fn get_inline_size(&self) -> f64 {
        self.0[0]
    }

    pub(crate) fn get_block_size(&self) -> f64 {
        self.0[1]
    }
}

#[derive(Default)]
pub(crate) struct ResizeObserverEntry {
    content_rect: [f64; 4],
    /// For each of `ResizeObserverBoxOptions`.
    sizes: [[f64; 2]; 3],
    _interior: bun_jsc::bindgen::Interior,
}

impl ResizeObserverEntry {
    fn measure(engine: &Document, node: NodeId, counts_pixels: bool) -> ResizeObserverEntry {
        if node == 0 {
            return ResizeObserverEntry::default();
        }
        let [x, y, width, height, border_width, border_height] =
            engine.box_sizes(node).map(f64::from);
        let pixels = if counts_pixels {
            engine.device_pixel_size(node).map(f64::from)
        } else {
            [0.0; 2]
        };
        let mut sizes = [[width, height], [border_width, border_height], pixels];
        if engine.is_vertical(node) {
            sizes.iter_mut().for_each(|it| it.reverse());
        }
        ResizeObserverEntry {
            content_rect: [x, y, width, height],
            sizes,
            _interior: Default::default(),
        }
    }

    fn size<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        of: ResizeObserverBoxOptions,
    ) -> [&'a ResizeObserverSize; 1] {
        [js_ResizeObserverSize::create(
            self.realm(heap),
            ResizeObserverSize(self.sizes[of as usize]),
        )]
    }

    pub(crate) fn get_content_rect<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DOMRectReadOnly {
        DOMRectReadOnly::new(self.realm(heap), self.content_rect)
    }

    pub(crate) fn get_border_box_size<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> [&'a ResizeObserverSize; 1] {
        self.size(heap, ResizeObserverBoxOptions::BorderBox)
    }

    pub(crate) fn get_content_box_size<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> [&'a ResizeObserverSize; 1] {
        self.size(heap, ResizeObserverBoxOptions::ContentBox)
    }

    pub(crate) fn get_device_pixel_content_box_size<'a>(
        &'a self,
        heap: &JsHeap<'a>,
    ) -> [&'a ResizeObserverSize; 1] {
        self.size(heap, ResizeObserverBoxOptions::DevicePixelContentBox)
    }
}

impl ResizeObserver {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        callback: JsLocal<'a, Callable>,
    ) -> Result<'a, &'a Self> {
        let (doc, made) = (
            seams::current_document(cx)?,
            structure.create(&cx.heap, BoxObserver::new(None)),
        );
        made.init(&cx.heap, callback.to_js(), doc);
        Ok(made)
    }

    pub(crate) fn observe<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        target: &'a Element,
        options: &ResizeObserverOptions,
    ) {
        if !self.find(target).is_some_and(
            |it| matches!(it.reported.get(), Reported::Size(of, _) if of == options.r#box),
        ) {
            self.start(cx, target, Reported::Size(options.r#box, None));
        }
    }

    pub(crate) fn unobserve<'a>(&'a self, heap: &JsHeap<'a>, target: &'a Element) {
        self.stop(heap, target);
    }

    pub(crate) fn disconnect<'a>(&'a self, heap: &JsHeap<'a>) {
        self.stop_all(heap);
    }
}

/// With where they are in the list.
fn measure_active(doc: &Doc, all: List<'_>) -> Vec<(u32, ResizeObserverEntry)> {
    doc.engine(|engine, _| {
        let targets: Vec<NodeId> = observations(all).map(|it| it.id_in(doc)).collect();
        engine.prefetch_box_sizes(&targets);
        let is_active = |it: &BoxObservation, id: NodeId| {
            let Reported::Size(of, last) = it.reported.get() else {
                return None;
            };
            let now = ResizeObserverEntry::measure(
                engine,
                id,
                of == ResizeObserverBoxOptions::DevicePixelContentBox,
            );
            (last != Some(now.sizes[of as usize]) && !engine.is_in_skipped_contents(id))
                .then(|| ResizeObserverEntry::measure(engine, id, true))
        };
        (0..)
            .zip(observations(all).zip(targets))
            .filter_map(|(index, (it, id))| Some((index, is_active(it, id)?)))
            .collect()
    })
}

/// In width, among those that were visible and still are.
pub(crate) fn has_resized_boxes<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> bool {
    let Some(all) = ObservedBoxes::if_any(doc).map(|it| it.active(heap, doc, Watches::Sizes))
    else {
        return false;
    };
    measure_active(doc, all).into_iter().any(|(index, now)| {
        // SAFETY: the list has observations.
        let Reported::Size(of, Some([before, _])) =
            unsafe { BoxObservation::from_js_unchecked(all.get(index)) }
                .reported
                .get()
        else {
            return false;
        };
        let [now, _] = now.sizes[of as usize];
        of != ResizeObserverBoxOptions::DevicePixelContentBox
            && before > 0.0
            && now > 0.0
            && (now - before).abs() > 1.0
    })
}

enum Broadcast {
    /// With the depth of the shallowest target.
    Some(usize),
    OnlySkipped,
    None,
}

/// <https://drafts.csswg.org/resize-observer/#gather-active-observations-h> and broadcast them
fn gather_and_broadcast<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    boxes: &'a ObservedBoxes,
    below: usize,
) -> Broadcast {
    let all = boxes.active(&cx.heap, doc, Watches::Sizes);
    let active = measure_active(doc, all);
    if active.is_empty() {
        return Broadcast::None;
    }
    let (observers, mut shallowest) = (List::new(&cx.heap), usize::MAX);
    for (index, entry) in active {
        // SAFETY: the list has observations.
        let it = unsafe { BoxObservation::from_js_unchecked(all.get(index)) };
        let (Reported::Size(of, _), observer) = (it.reported.get(), it.observer()) else {
            continue;
        };
        let depth =
            core::iter::successors(Some::<&Node>(it.target()), |it| it.flat_parent()).count();
        if depth <= below {
            continue;
        }
        shallowest = shallowest.min(depth);
        it.report(Reported::Size(of, Some(entry.sizes[of as usize])));
        if observer.entries().is_empty() {
            observers.push(&cx.heap, observer.to_js());
        }
        let entry = js_ResizeObserverEntry::create(observer.realm(&cx.heap), entry);
        js_ResizeObserverEntry::set_target(entry, Some(it.target()));
        observer.entries().push(&cx.heap, entry.to_js());
    }
    // SAFETY: what is pushed above.
    observers
        .values()
        .for_each(|it| unsafe { BoxObserver::from_js_unchecked(it) }.deliver(cx, doc));
    if observers.is_empty() {
        Broadcast::OnlySkipped
    } else {
        Broadcast::Some(shallowest)
    }
}

pub(crate) fn deliver_resizes<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    only_if_needed: bool,
) -> bool {
    let Some(boxes) = ObservedBoxes::if_any(doc) else {
        return false;
    };
    let version = || Some(doc.engine(|engine, _| engine.sizes_version));
    if only_if_needed && !boxes.has_new.get() && boxes.sizes_version.get() == version() {
        return false;
    }
    let (mut depth, is_first) = (0, core::cell::Cell::new(true));
    let has_skipped = loop {
        let before = version();
        match gather_and_broadcast(cx, doc, boxes, depth) {
            Broadcast::Some(shallowest) => depth = shallowest,
            other => break matches!(other, Broadcast::OnlySkipped),
        }
        doc.synced_engine(cx, |engine, _| engine.update_layout());
        if is_first.take() && version() == before && !boxes.is_stale[Watches::Sizes as usize].get()
        {
            break false;
        }
    };
    boxes.sizes_version.set(version().filter(|_| !has_skipped));
    has_skipped
}
