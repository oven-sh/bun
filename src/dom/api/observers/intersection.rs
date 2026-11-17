use bun_jsc::JSValue;
use bun_jsc::bindgen::{Callable, ClassStructure, JsHeap, JsInterface, JsLocal, JsScope, Result};

use super::{BoxObservation, BoxObserver, ObservedBoxes, Reported, Watches, observations};
use crate::abi::Rect;
use crate::api::core::{Doc, DocFlags, DomError, Element, List, Node, Ns, dom_error, seams};
use crate::api::geometry::DOMRectReadOnly;
use crate::api::typed::numeric;
use crate::api::ui::host;
use crate::api::{animation, frames};
use crate::calc::{self, Unit};
use crate::document::Document;
use crate::generated_bindgen::box_observers::*;
use crate::geometry::ObservedRoot;
use crate::tree::{DOCUMENT, NodeId};
use crate::types::{IDENTITY, invert, multiply};
use crate::values::Out;

#[derive(Clone, Copy, PartialEq)]
enum Margin {
    Pixels(f64),
    Percent(f64),
}

/// Top, right, bottom, left
type Margins = [Margin; 4];
const NO_MARGINS: Margins = [Margin::Pixels(0.0); 4];

/// <https://w3c.github.io/IntersectionObserver/#parse-a-margin>
fn parse_margin<'a>(heap: &JsHeap<'a>, source: &[u8]) -> Result<'a, Margins> {
    let side = |word: &[u8]| match numeric::parse(word)? {
        calc::Node::Value(it, Unit::Percent) => Some(Margin::Percent(it)),
        calc::Node::Value(0.0, Unit::Number) => Some(Margin::Pixels(0.0)),
        calc::Node::Value(it, unit) => Some(Margin::Pixels(
            numeric::convert(it, unit, Unit::Px)?.floor(),
        )),
        _ => None,
    };
    let all = crate::hooks::words(source)
        .into_iter()
        .map(side)
        .collect::<Option<Vec<_>>>()
        .filter(|it| it.len() <= 4);
    let all = all.ok_or_else(|| {
        dom_error(
            heap,
            DomError::SyntaxError,
            "The margin must be specified in absolute length units or percent.",
        )
    })?;
    Ok([[0, 0], [1, 0], [2, 0], [3, 1]].map(|[own, other]| {
        all.get(own)
            .or_else(|| all.get(other))
            .or_else(|| all.first())
            .copied()
            .unwrap_or(NO_MARGINS[0])
    }))
}

fn serialize(margins: &Margins) -> Out {
    let side = |it: &Margin| match *it {
        Margin::Pixels(it) => format!("{it}px"),
        Margin::Percent(it) => format!("{it}%"),
    };
    margins.each_ref().map(side).join(" ").into()
}

pub(super) struct Settings {
    root_margin: Margins,
    scroll_margin: Margins,
    thresholds: Vec<f64>,
    delay: i32,
    tracks_visibility: bool,
}

fn root_with_margins(engine: &Document, root: NodeId, margins: [&Margins; 2]) -> ObservedRoot {
    let [root_margin, scroll_margin] = margins.map(|all| {
        all.map(|it| match it {
            Margin::Pixels(it) => [it as f32, 0.0],
            Margin::Percent(it) => [0.0, it as f32 / 100.0],
        })
    });
    engine
        .observed_root(root)
        .with_margins(&root_margin, scroll_margin)
}

#[derive(Clone, Copy, Default)]
struct Geometry {
    target: Rect,
    intersection: Option<Rect>,
    root: Option<Rect>,
}

impl Geometry {
    fn measure(engine: &Document, node: NodeId, root: &mut ObservedRoot) -> Geometry {
        Geometry {
            target: engine.bounding_rect(node),
            intersection: engine.intersect(node, root),
            root: Some(root.rect),
        }
    }

    fn ratio(&self) -> f64 {
        let area = |it: Rect| f64::from(it.width) * f64::from(it.height);
        self.intersection.map_or(0.0, |it| {
            if area(self.target) > 0.0 {
                (area(it) / area(self.target)).min(1.0)
            } else {
                1.0
            }
        })
    }

    fn crosses(&self, thresholds: &[f64]) -> usize {
        self.intersection
            .map_or(0, |_| thresholds.partition_point(|it| *it <= self.ratio()))
    }
}

pub(crate) struct IntersectionObserverEntry {
    time: f64,
    geometry: Geometry,
    is_intersecting: bool,
    is_visible: bool,
    _interior: bun_jsc::bindgen::Interior,
}

impl IntersectionObserverEntry {
    fn rect<'a>(&'a self, heap: &JsHeap<'a>, rect: Rect) -> &'a DOMRectReadOnly {
        DOMRectReadOnly::new(self.realm(heap), rect.to_array().map(f64::from))
    }

    pub(crate) fn get_time(&self) -> f64 {
        self.time
    }

    pub(crate) fn get_root_bounds<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a DOMRectReadOnly> {
        self.geometry.root.map(|it| self.rect(heap, it))
    }

    pub(crate) fn get_bounding_client_rect<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DOMRectReadOnly {
        self.rect(heap, self.geometry.target)
    }

    pub(crate) fn get_intersection_rect<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DOMRectReadOnly {
        self.rect(heap, self.geometry.intersection.unwrap_or_default())
    }

    pub(crate) fn get_is_intersecting(&self) -> bool {
        self.is_intersecting
    }

    pub(crate) fn get_is_visible(&self) -> bool {
        self.is_visible
    }

    pub(crate) fn get_intersection_ratio(&self) -> f64 {
        self.geometry.ratio()
    }
}

impl BoxObserver {
    fn settings(&self) -> &Settings {
        self.intersection
            .as_deref()
            .expect("it observes intersections")
    }

    fn margins(&self) -> [&Margins; 2] {
        [&self.settings().root_margin, &self.settings().scroll_margin]
    }

    fn has_implicit_root(&self) -> bool {
        js_BoxObserver::root(self).is_none()
    }

    fn root_in(&self, doc: &Doc) -> NodeId {
        js_BoxObserver::root(self).map_or(DOCUMENT, |it| {
            if it.is_connected() && it.doc() == doc {
                it.id()
            } else {
                0
            }
        })
    }
}

impl IntersectionObserver {
    /// <https://w3c.github.io/IntersectionObserver/#initialize-a-new-intersectionobserver>
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        callback: JsLocal<'a, Callable>,
        options: &IntersectionObserverInit<'a>,
    ) -> Result<'a, &'a Self> {
        let (root_margin, scroll_margin) = (
            parse_margin(&cx.heap, options.root_margin)?,
            parse_margin(&cx.heap, options.scroll_margin)?,
        );
        let mut thresholds = match &options.threshold {
            Some(Threshold::Many(all)) if !all.is_empty() => all.clone(),
            Some(Threshold::One(it)) => vec![*it],
            _ => vec![0.0],
        };
        thresholds
            .iter()
            .all(|it| (0.0..=1.0).contains(it))
            .ok_or_else(|| {
                cx.heap
                    .range_error(format_args!("Threshold values must be between 0 and 1"))
            })?;
        bun_collections::index_sort::sort_slice_by(&mut thresholds, f64::total_cmp);
        if options.track_visibility && options.delay < 100 {
            let message = "To enable the 'trackVisibility' option, you must also use a 'delay' option with a value of at least 100.";
            return Err(dom_error(&cx.heap, DomError::NotSupportedError, message));
        }
        let settings = Settings {
            root_margin,
            scroll_margin,
            thresholds,
            delay: options.delay,
            tracks_visibility: options.track_visibility,
        };
        let (doc, made) = (
            seams::current_document(cx)?,
            structure.create(&cx.heap, BoxObserver::new(Some(settings))),
        );
        made.init(&cx.heap, callback.to_js(), doc);
        let root = options.root.as_ref().map(|it| -> &Node {
            match *it {
                ElementOrDocument::Element(it) => it,
                ElementOrDocument::Document(it) => it,
            }
        });
        js_BoxObserver::set_root(made, root);
        Ok(made)
    }

    pub(crate) fn get_root_margin(&self) -> Out {
        serialize(&self.settings().root_margin)
    }

    pub(crate) fn get_scroll_margin(&self) -> Out {
        serialize(&self.settings().scroll_margin)
    }

    pub(crate) fn get_thresholds(&self) -> impl Iterator<Item = f64> {
        self.settings().thresholds.iter().copied()
    }

    pub(crate) fn get_delay(&self) -> i32 {
        self.settings().delay
    }

    pub(crate) fn get_track_visibility(&self) -> bool {
        self.settings().tracks_visibility
    }

    pub(crate) fn observe<'a>(&'a self, cx: &mut JsScope<'a>, target: &'a Element) {
        if self.find(target).is_none() {
            self.start(
                cx,
                target,
                Reported::Intersection {
                    thresholds_crossed: None,
                    is_visible: false,
                    at: f64::NEG_INFINITY,
                },
            );
        }
    }

    pub(crate) fn unobserve<'a>(&'a self, heap: &JsHeap<'a>, target: &'a Element) {
        self.stop(heap, target);
    }

    pub(crate) fn disconnect<'a>(&'a self, heap: &JsHeap<'a>) {
        self.stop_all(heap);
    }

    pub(crate) fn take_records<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        self.take_entries(heap).to_js()
    }
}

/// Clips what is in the viewport of `doc` by the frames around it.
fn intersect_across_frames<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    node: NodeId,
    margins: [&Margins; 2],
) -> Geometry {
    let is_same_origin = frames::is_same_origin_with_top(doc);
    let inner = [
        &NO_MARGINS,
        if is_same_origin {
            margins[1]
        } else {
            &NO_MARGINS
        },
    ];
    let mut result = doc.engine(|engine, _| {
        Geometry::measure(
            engine,
            node,
            &mut root_with_margins(engine, DOCUMENT, inner),
        )
    });
    let (mut at, mut to_viewport) = (doc, IDENTITY);
    while let Some(frame) = frames::container(at) {
        at = frame.doc();
        let margins = if is_same_origin && !at.is(DocFlags::IN_FRAME) {
            margins
        } else {
            inner
        };
        let (root, shown) = frame.synced_engine(cx, |engine, id| {
            let mut root = root_with_margins(engine, DOCUMENT, margins);
            (
                root.rect,
                result
                    .intersection
                    .and_then(|it| engine.intersect_contents(id, it, &mut root)),
            )
        });
        (result.root, result.intersection) = (is_same_origin.then_some(root), shown.map(|it| it.0));
        to_viewport = multiply(&shown.map_or(IDENTITY, |it| it.1), &to_viewport);
    }
    result.intersection = result
        .intersection
        .zip(invert(&to_viewport))
        .map(|(it, back)| it.transformed(&back).intersection(&result.target));
    result
}

fn is_unobscured<'a>(cx: &mut JsScope<'a>, node: &'a Element) -> bool {
    let is_on_top = node.engine(|engine, id| {
        engine.update_hits();
        engine.is_unobscured(id)
    });
    is_on_top && frames::container(node.doc()).is_none_or(|it| is_unobscured(cx, it))
}

/// Of those that may have something to report, where they are in the list, and what can be told from this document.
fn measure_changed(doc: &Doc, all: List<'_>, is_in_frame: bool) -> Vec<(u32, Option<Geometry>)> {
    doc.engine(|engine, _| {
        let mut roots: Vec<((NodeId, [&Margins; 2]), ObservedRoot)> = Vec::new();
        let mut measure = |it: &BoxObservation, key @ (root, margins)| {
            let (
                Reported::Intersection {
                    thresholds_crossed, ..
                },
                settings,
                node,
            ) = (it.reported.get(), it.observer().settings(), it.id_in(doc))
            else {
                return None;
            };
            let without_box = (thresholds_crossed != Some(0)).then_some(Some(Geometry {
                root: Some(Rect::default()),
                ..Geometry::default()
            }));
            if node == 0 || root == 0 {
                return without_box;
            }
            if is_in_frame && it.observer().has_implicit_root() {
                return if engine.has_box(node) {
                    Some(None)
                } else {
                    without_box
                };
            }
            let known = roots.iter().position(|it| it.0 == key).unwrap_or_else(|| {
                roots.push((key, root_with_margins(engine, root, margins)));
                roots.len() - 1
            });
            let root = &mut roots[known].1;
            let intersection = engine.intersect(node, root);
            if settings.thresholds == [0.0]
                && !settings.tracks_visibility
                && thresholds_crossed == Some(intersection.is_some().into())
            {
                return None;
            }
            if intersection.is_none() && !engine.has_box(node) {
                return without_box;
            }
            let geometry = Geometry {
                target: engine.bounding_rect(node),
                intersection,
                root: Some(root.rect),
            };
            (settings.tracks_visibility
                || thresholds_crossed != Some(geometry.crosses(&settings.thresholds)))
            .then_some(Some(geometry))
        };
        (0..)
            .zip(observations(all))
            .filter_map(|(index, it)| {
                Some((
                    index,
                    measure(it, (it.observer().root_in(doc), it.observer().margins()))?,
                ))
            })
            .collect()
    })
}

/// <https://w3c.github.io/IntersectionObserver/#update-intersection-observations-algo>
pub(crate) fn update_intersections<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    has_moved: bool,
) -> bool {
    let Some(boxes) = ObservedBoxes::if_any(doc)
        .filter(|it| it.has_new.take() || has_moved || it.is_volatile.get())
    else {
        return false;
    };
    let (was_stale, is_in_frame) = (
        boxes.is_stale[Watches::Intersections as usize].get(),
        doc.is(DocFlags::IN_FRAME),
    );
    let all = boxes.active(&cx.heap, doc, Watches::Intersections);
    if was_stale {
        boxes.is_volatile.set(
            observations(all).any(|it| {
                it.observer().settings().tracks_visibility || it.target().ns() == Ns::Svg
            }),
        );
        let is_across =
            is_in_frame && observations(all).any(|it| it.observer().has_implicit_root());
        if !boxes.is_across_frames.replace(is_across) && is_across {
            frames::report_moves(doc);
        }
    }
    let (notified, time) = (
        List::from_value(js_ObservedBoxes::notified(boxes).expect("set when it is made")),
        crate::api::events::now(),
    );
    for (index, geometry) in measure_changed(doc, all, is_in_frame) {
        // SAFETY: the list has observations.
        let it = unsafe { BoxObservation::from_js_unchecked(all.get(index)) };
        let (
            Reported::Intersection {
                thresholds_crossed,
                is_visible: was_visible,
                at,
            },
            observer,
        ) = (it.reported.get(), it.observer())
        else {
            continue;
        };
        if !it.target().doc().is(DocFlags::HAS_PAGE) && observer.has_implicit_root() {
            continue;
        }
        if time - at < observer.settings().delay.into() {
            boxes.has_new.set(true);
            continue;
        }
        let geometry = geometry.unwrap_or_else(|| {
            intersect_across_frames(cx, doc, it.target().id(), observer.margins())
        });
        let crossed = geometry.crosses(&observer.settings().thresholds);
        let is_visible = observer.settings().tracks_visibility
            && geometry.intersection.is_some()
            && is_unobscured(cx, it.target());
        if (Some(crossed), is_visible) == (thresholds_crossed, was_visible) {
            continue;
        }
        it.report(Reported::Intersection {
            thresholds_crossed: Some(crossed),
            is_visible,
            at: time,
        });
        if observer.entries().is_empty() {
            if notified.is_empty() {
                host::queue_task(cx, doc, [doc.to_js()], |cx, [doc]| {
                    Doc::from_js(&cx.heap, doc)
                        .into_iter()
                        .for_each(|it| notify_intersection_observers(cx, it))
                });
            }
            notified.push(&cx.heap, observer.to_js());
        }
        let time = ((time - animation::time_origin(observer.doc())) * 10.0).floor() / 10.0;
        let entry = js_IntersectionObserverEntry::create(
            observer.realm(&cx.heap),
            IntersectionObserverEntry {
                time,
                geometry,
                is_intersecting: crossed > 0,
                is_visible,
                _interior: Default::default(),
            },
        );
        js_IntersectionObserverEntry::set_target(entry, Some(it.target()));
        observer.entries().push(&cx.heap, entry.to_js());
    }
    boxes.has_new.get()
}

/// <https://w3c.github.io/IntersectionObserver/#notify-intersection-observers-algo>
pub(crate) fn notify_intersection_observers<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    let Some(boxes) = ObservedBoxes::if_any(doc) else {
        return;
    };
    let notified =
        List::from_value(js_ObservedBoxes::notified(boxes).expect("set when it is made"));
    if notified.is_empty() {
        return;
    }
    js_ObservedBoxes::set_notified(boxes, List::new(&cx.heap).to_js());
    // SAFETY: the list has observers.
    notified
        .values()
        .for_each(|it| unsafe { BoxObserver::from_js_unchecked(it) }.deliver(cx, doc));
}

pub(crate) fn frame_moved<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    if let Some(boxes) = ObservedBoxes::if_any(doc).filter(|it| it.is_across_frames.get()) {
        boxes.has_new.set(true);
        doc.invalidate(cx);
    }
}
