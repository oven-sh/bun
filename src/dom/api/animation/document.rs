//! What a document has for its animations, and the events that the engine has for the next frame.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{JsHeap, JsInterface, JsScope};
use bun_jsc::virtual_machine_exports::read_origin_timer;
use bun_jsc::{JSFunction, JSPromise, JSValue, Weak};

use super::{Animation, AnimationTimeline, percent};
use crate::animation::Control;
use crate::api::core::{Atom, Doc, DocFlags, Edge, Element, List, Node, Rooted, global_of};
use crate::api::events::{Event, EventInit, EventType, dispatch};
use crate::api::style_events::*;
use crate::engine_event::{CssEvent, EngineEvent, ForNode, TimeEvent};
use crate::generated_bindgen::animation::*;
use crate::name::Map;
use crate::selector::Pseudo;

/// What the engine keeps for objects that are gone.
#[derive(Default)]
pub(super) struct Collected {
    pub(super) animations: RefCell<Vec<u32>>,
    pub(super) timelines: RefCell<Vec<u32>>,
}

pub(super) struct PlaybackEvent {
    pub(super) kind: &'static str,
    pub(super) current_time: Option<f64>,
    pub(super) timeline_time: Option<f64>,
    pub(super) follows_scroll: bool,
    pub(super) scheduled: f64,
    pub(super) composite_order: u8,
}

enum Pending {
    Node(ForNode),
    Playback(PlaybackEvent),
}

impl Pending {
    fn order(&self) -> (f64, u8) {
        let (time, class) = match self {
            Pending::Node(ForNode::Css(it)) => (it.scheduled, u8::MAX),
            Pending::Node(_) => (f64::NEG_INFINITY, u8::MAX),
            Pending::Playback(it) => (it.scheduled, it.composite_order),
        };
        ((time * 1000.0).round(), class)
    }
}

#[derive(Default)]
pub(crate) struct DocumentAnimations {
    /// `None` without a window.
    is_rendering: Cell<bool>,
    /// The iteration of the event loop in which the clock was looked at.
    clock_read_in: Cell<Option<u64>>,
    /// Where they are in `live`.
    slots: RefCell<Map<u32, u32>>,
    /// Those that styles have started, which stay in the engine for as long as scripts have them.
    of_styles: RefCell<Map<u32, Weak<()>>>,
    /// With where the target is in `targets`.
    pending: RefCell<Vec<(Pending, u32)>>,
    pub(super) collected: Rc<Collected>,
}

/// The timelines that scripts have made for the element.
#[derive(Default)]
pub(super) struct WatchedBy(pub(super) RefCell<Vec<(Rc<Collected>, u32)>>);

fn list(field: Option<JSValue>) -> List<'static> {
    List::from_value(field.expect("set when it is made"))
}

impl DocumentAnimations {
    pub(super) fn of<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> &'a Self {
        let it = doc.same_object(heap, Edge::Animations, || {
            let (made, global) = (
                js_DocumentAnimations::create(heap, Self::default()),
                global_of(heap),
            );
            js_DocumentAnimations::set_css_timelines(made, List::new(heap).to_js());
            js_DocumentAnimations::set_live(made, List::new(heap).to_js());
            js_DocumentAnimations::set_targets(made, List::new(heap).to_js());
            js_DocumentAnimations::set_scroll_requests(made, List::new(heap).to_js());
            js_DocumentAnimations::set_notify(
                made,
                JSFunction::create(global, "", Bun__DOM__notifyFinished, 1, Default::default()),
            );
            js_DocumentAnimations::set_release(
                made,
                JSFunction::create(
                    global,
                    "",
                    Bun__DOM__releaseAnimationsOf,
                    1,
                    Default::default(),
                ),
            );
            made.to_js()
        });
        // SAFETY: the edge holds what is made above.
        unsafe { Self::from_js_unchecked(it) }
    }

    pub(super) fn timeline<'a>(&'a self, heap: &JsHeap<'a>, doc: &'a Doc) -> &'a AnimationTimeline {
        js_DocumentAnimations::timeline(self).unwrap_or_else(|| {
            let made = AnimationTimeline::of_document(heap, doc);
            js_DocumentAnimations::set_timeline(self, Some(made));
            made
        })
    }

    pub(super) fn css_timeline<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        doc: &'a Doc,
        id: u32,
    ) -> &'a AnimationTimeline {
        let (known, key) = (
            list(js_DocumentAnimations::css_timelines(self)),
            JSValue::js_number(id.into()),
        );
        let index = known.position_of_key(key).unwrap_or_else(|| {
            [key, AnimationTimeline::of_style(heap, doc, id).to_js()]
                .into_iter()
                .for_each(|it| known.push(heap, it));
            known.len() - 2
        });
        // SAFETY: the list has what is made above.
        unsafe { AnimationTimeline::from_js_unchecked(known.get(index + 1)) }
    }

    /// The time does not change within a task.
    pub(super) fn advance_clock<'a>(&'a self, cx: &mut JsScope<'a>, doc: &'a Doc) {
        const FRAME: f64 = 17.0;
        let (vm, Some(origin)) = (
            cx.global().bun_vm(),
            active_time_origin(doc).filter(|_| !self.is_rendering.get()),
        ) else {
            return;
        };
        let iteration = Some(vm.uws_loop().iteration_number());
        if self.clock_read_in.replace(iteration) == iteration {
            return;
        }
        let now = read_origin_timer(vm) as f64 / 1e6 - origin;
        if now - doc.engine(|engine, _| engine.clock()) >= FRAME {
            doc.engine(|engine, _| engine.advance_clock(now));
            take_events(cx, doc);
        }
    }

    pub(super) fn hold(&self, heap: &JsHeap<'_>, animation: &Animation) {
        let live = list(js_DocumentAnimations::live(self));
        if !self.slots.borrow().contains_key(&animation.id()) {
            self.slots.borrow_mut().insert(animation.id(), live.len());
            live.push(heap, animation.to_js());
        }
    }

    pub(super) fn let_go(&self, heap: &JsHeap<'_>, animation: &Animation) {
        let Some(slot) = self.slots.borrow_mut().remove(&animation.id()) else {
            return;
        };
        let live = list(js_DocumentAnimations::live(self));
        let (end, last) = (live.len() - 1, live.get(live.len() - 1));
        if slot != end {
            live.set(heap, slot, last);
            // SAFETY: the list has animations.
            self.slots
                .borrow_mut()
                .insert(unsafe { Animation::from_js_unchecked(last) }.id(), slot);
        }
        live.remove_range(heap, end, 1);
    }

    pub(super) fn find(&self, id: u32) -> Option<&Animation> {
        let held = self
            .slots
            .borrow()
            .get(&id)
            .map(|it| list(js_DocumentAnimations::live(self)).get(*it));
        // SAFETY: both have animations that are alive.
        held.or_else(|| self.of_styles.borrow().get(&id)?.get())
            .map(|it| unsafe { Animation::from_js_unchecked(it) })
    }

    pub(super) fn remember(&self, heap: &JsHeap<'_>, animation: &Animation) {
        self.of_styles.borrow_mut().insert(
            animation.id(),
            Weak::create_passive(animation.to_js(), global_of(heap)),
        );
    }

    pub(super) fn queue_finish_notification(&self, heap: &JsHeap<'_>, animation: &Animation) {
        global_of(heap).queue_microtask(
            js_DocumentAnimations::notify(self).expect("set when it is made"),
            &[animation.to_js()],
        );
    }

    fn queue(&self, heap: &JsHeap<'_>, event: Pending, targets: &[JSValue]) {
        let all = list(js_DocumentAnimations::targets(self));
        self.pending.borrow_mut().push((event, all.len()));
        targets.iter().for_each(|it| all.push(heap, *it));
    }

    pub(super) fn queue_playback_event(
        &self,
        heap: &JsHeap<'_>,
        animation: &Animation,
        event: PlaybackEvent,
    ) {
        self.queue(heap, Pending::Playback(event), &[animation.to_js()]);
    }

    fn release_collected(&self, doc: &Doc) {
        for id in self.collected.animations.take() {
            if self.find(id).is_none() {
                self.of_styles.borrow_mut().remove(&id);
                doc.engine(|engine, _| engine.control_animation(id, Control::Release));
            }
        }
        self.collected
            .timelines
            .take()
            .into_iter()
            .for_each(|id| doc.engine(|engine, _| engine.set_watched_node(id, None)));
    }

    fn finish_scroll<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        doc: &'a Doc,
        request: u32,
        was_interrupted: bool,
    ) {
        let requests = list(js_DocumentAnimations::scroll_requests(self));
        let Some(index) = requests.position_of_key(JSValue::js_number(request.into())) else {
            return;
        };
        let promise = requests.get(index + 1);
        requests.remove_range(&cx.heap, index, 2);
        super::settle(cx, promise, Ok(scroll_result_value(doc, was_interrupted)));
    }
}

fn scroll_result_value(doc: &Doc, was_interrupted: bool) -> JSValue {
    let result = JSValue::create_empty_object(doc.global(), 1);
    result.put(
        doc.global(),
        b"interrupted",
        JSValue::js_boolean(was_interrupted),
    );
    result
}

pub(crate) fn no_scroll(doc: &Doc) -> JSValue {
    JSPromise::resolved_promise_value(doc.global(), scroll_result_value(doc, false))
}

/// For the scroll that was last asked for.
pub(crate) fn scroll_result<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) -> JSValue {
    let request = doc.engine(|engine, _| engine.last_scroll_request());
    if request == 0 {
        return no_scroll(doc);
    }
    let (promise, requests) = (
        JSPromise::create(doc.global()).to_js(),
        list(js_DocumentAnimations::scroll_requests(
            DocumentAnimations::of(&cx.heap, doc),
        )),
    );
    [JSValue::js_number(request.into()), promise]
        .into_iter()
        .for_each(|it| requests.push(&cx.heap, it));
    promise
}

impl ForNode {
    fn event_type(&self) -> &'static str {
        match self {
            ForNode::Css(CssEvent {
                is_transition: true,
                stage,
                ..
            }) => [
                "transitionrun",
                "transitionstart",
                "",
                "transitionend",
                "transitioncancel",
            ][*stage as usize],
            ForNode::Css(it) => [
                "",
                "animationstart",
                "animationiteration",
                "animationend",
                "animationcancel",
            ][it.stage as usize],
            ForNode::Scroll { has_ended } => ["scroll", "scrollend"][usize::from(*has_ended)],
            ForNode::Snap { has_ended, .. } => {
                ["scrollsnapchanging", "scrollsnapchange"][usize::from(*has_ended)]
            }
            ForNode::ContentVisibility { .. } => "contentvisibilityautostatechange",
            ForNode::Smil(TimeEvent::Begin) => "beginEvent",
            ForNode::Smil(TimeEvent::Repeat) => "repeatEvent",
            ForNode::Smil(TimeEvent::End) => "endEvent",
        }
    }
}

pub(crate) fn take_events<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    take_events_after_removing(cx, doc, None);
}

/// Queues events with the nodes in place of their ids, which the engine uses again, and settles promises.
pub(crate) fn take_events_after_removing<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    removed: Option<&'a Node>,
) {
    take_events_of(cx, doc, &|id| removed?.node_within(id));
}

pub(crate) fn take_events_after_removing_all<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    removed: &Rooted<'a>,
) {
    let by_id: crate::name::Map<_, _> = removed.iter().map(|it| (it.id(), it)).collect();
    let root_of = |id| {
        doc.read(|tree, _| {
            core::iter::successors(Some(id), |it| {
                Some(if tree[*it].parent != 0 {
                    tree[*it].parent
                } else {
                    tree.host_of(*it)
                })
                .filter(|it| *it != 0)
            })
            .last()
        })
    };
    take_events_of(cx, doc, &|id| by_id.get(&root_of(id)?)?.node_within(id));
}

fn take_events_of<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    removed: &dyn Fn(crate::tree::NodeId) -> Option<&'a Node>,
) {
    let mut taken = doc.engine(|engine, _| engine.take_events());
    if taken.is_empty() {
        return;
    }
    let all = DocumentAnimations::of(&cx.heap, doc);
    let node = |id| removed(id).or_else(|| doc.rendered_node(id));
    bun_collections::index_sort::stable_partition(&mut taken, |it| {
        matches!(it, EngineEvent::Node(..))
    });
    for event in taken {
        match event {
            EngineEvent::ScrollRequest {
                request,
                was_interrupted,
            } => all.finish_scroll(cx, doc, request, was_interrupted),
            EngineEvent::Playback(id, playback) => all
                .find(id)
                .into_iter()
                .for_each(|it| it.engine_did(cx, playback)),
            EngineEvent::Node(id, event) => {
                let Some(target) = EventType::of(&Atom::new(event.event_type()))
                    .is_some()
                    .then(|| node(id))
                    .flatten()
                else {
                    continue;
                };
                match event {
                    ForNode::Snap {
                        targets: [block, inline],
                        ..
                    } => all.queue(
                        &cx.heap,
                        Pending::Node(event),
                        &[id, block, inline].map(|it| node(it).map_or(JSValue::NULL, Node::to_js)),
                    ),
                    _ => all.queue(&cx.heap, Pending::Node(event), &[target.to_js()]),
                }
            }
        }
    }
    if !all.pending.borrow().is_empty() {
        doc.invalidate(cx);
    }
}

fn fire_at_node<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    event: &ForNode,
    target: &'a Node,
    snapped: [Option<&'a Node>; 2],
) {
    let (realm, kind, is_document) = (
        doc.realm(&cx.heap),
        Atom::new(event.event_type()),
        target.as_doc().is_some(),
    );
    let is_editor = matches!(event, ForNode::Scroll { .. })
        && target
            .as_element()
            .is_some_and(|it| it.pseudo() == Pseudo::from_name(b"-internal-editor"));
    let event = match event {
        ForNode::Css(it) if it.is_transition => TransitionEvent::new(realm, kind, it, target),
        ForNode::Css(it) => AnimationEvent::new(realm, kind, it, target),
        ForNode::Scroll { .. } => Event::new(
            realm,
            kind,
            EventInit {
                bubbles: is_document,
                ..EventInit::default()
            },
        ),
        ForNode::Snap { .. } => SnapEvent::new(realm, kind, is_document, snapped),
        ForNode::ContentVisibility { skipped } => {
            ContentVisibilityAutoStateChangeEvent::new(realm, kind, *skipped)
        }
        ForNode::Smil(_) => Event::new(realm, kind, EventInit::default()),
    };
    dispatch(
        cx,
        if is_editor {
            target.out_of_control()
        } else {
            target
        },
        event,
    );
}

/// <https://drafts.csswg.org/web-animations/#update-animations-and-send-events>, once the engine has the time.
pub(crate) fn dispatch_events<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    let all = DocumentAnimations::of(&cx.heap, doc);
    all.release_collected(doc);
    if doc.engine(|engine, _| engine.has_news()) {
        take_events(cx, doc);
        if !all.slots.borrow().is_empty() {
            cx.global().bun_vm().drain_microtasks();
        }
    }
    let mut pending = all.pending.take();
    if pending.is_empty() {
        return;
    }
    let targets = list(js_DocumentAnimations::targets(all));
    js_DocumentAnimations::set_targets(all, List::new(&cx.heap).to_js());
    bun_collections::index_sort::sort_slice_by(&mut pending, |a, b| {
        a.0.order()
            .0
            .total_cmp(&b.0.order().0)
            .then(a.0.order().1.cmp(&b.0.order().1))
    });
    for (event, at) in &pending {
        match event {
            Pending::Node(event) => {
                let snapped = [1, 2].map(|it| Node::from_js(&cx.heap, targets.get(at + it)));
                targets
                    .node(*at)
                    .into_iter()
                    .for_each(|it| fire_at_node(cx, doc, event, it, snapped));
            }
            Pending::Playback(it) => {
                let time = |time: Option<f64>| {
                    time.map_or(JSValue::NULL, |time| {
                        if it.follows_scroll {
                            percent(doc.realm(&cx.heap), time)
                        } else {
                            JSValue::js_number(time)
                        }
                    })
                };
                let (kind, Some(target)) = (
                    Atom::new(it.kind),
                    Animation::from_js(&cx.heap, targets.get(*at)),
                ) else {
                    continue;
                };
                if target.has_listeners(kind.known()) {
                    let event = AnimationPlaybackEvent::new(
                        target.realm(&cx.heap),
                        kind,
                        [time(it.current_time), time(it.timeline_time)],
                    );
                    dispatch(cx, target, event);
                }
            }
        }
    }
    targets.to_js().ensure_still_alive();
}

pub(crate) fn has_queued_events<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> bool {
    !DocumentAnimations::of(heap, doc)
        .pending
        .borrow()
        .is_empty()
}

/// Scripts count on being told of animations in the frame that shows it.
pub(crate) fn has_events_for_frame<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> bool {
    let all = DocumentAnimations::of(heap, doc);
    let targets = list(js_DocumentAnimations::targets(all));
    all.pending.borrow().iter().any(|(event, at)| match event {
        Pending::Node(event) => !matches!(event, ForNode::Scroll { .. }),
        Pending::Playback(it) => Animation::from_js(heap, targets.get(*at))
            .is_some_and(|target| target.has_listeners(Atom::new(it.kind).known())),
    })
}

/// `None` if its timelines are inactive.
pub(super) fn active_time_origin(doc: &Doc) -> Option<f64> {
    doc.window()
        .filter(|it| !it.is_disposed())
        .map(|it| it.time_origin())
}

pub(crate) fn time_origin(doc: &Doc) -> f64 {
    active_time_origin(doc).unwrap_or(0.0)
}

pub(crate) fn set_rendering<'a>(heap: &JsHeap<'a>, doc: &'a Doc, on: bool) {
    DocumentAnimations::of(heap, doc).is_rendering.set(on);
}

pub(crate) fn animation_for<'a>(
    cx: &mut JsScope<'a>,
    target: &'a Node,
    id: u32,
    pseudo: &[u8],
) -> Option<&'a Animation> {
    let doc = Some(target.doc()).filter(|it| it.is(DocFlags::HAS_PAGE))?;
    Animation::with_id(
        cx,
        doc,
        id,
        target.as_element(),
        crate::values::text(pseudo),
    )
}

fn animations_of<'a>(
    heap: &JsHeap<'a>,
    element: &'a Element,
) -> impl Iterator<Item = &'a Animation> + use<'a> {
    let copy = element
        .try_edge_list(Edge::Animations)
        .map(|list| List::from_fn(heap, list.len(), |it| list.get(it)));
    // SAFETY: the list has animations.
    copy.into_iter()
        .flat_map(List::values)
        .map(|it| unsafe { Animation::from_js_unchecked(it) })
}

pub(crate) fn rendered<'a>(cx: &mut JsScope<'a>, element: &'a Element) {
    animations_of(&cx.heap, element).for_each(|it| it.target_is_rendered(cx));
    let Some(watched) = element.try_extra::<WatchedBy>() else {
        return;
    };
    let collected = &DocumentAnimations::of(&cx.heap, element.doc()).collected;
    for (_, timeline) in watched
        .0
        .borrow()
        .iter()
        .filter(|it| Rc::ptr_eq(&it.0, collected))
    {
        element.engine(|engine, id| engine.watch_again(*timeline, id));
    }
}

pub(crate) fn unrendered<'a>(heap: &JsHeap<'a>, element: &'a Element) {
    if element.edge(Edge::Animations).is_some() {
        let release = js_DocumentAnimations::release(DocumentAnimations::of(heap, element.doc()));
        global_of(heap).queue_microtask(release.expect("set when it is made"), &[element.to_js()]);
    }
}

pub(crate) fn release_animations_of<'a>(cx: &mut JsScope<'a>, element: &'a Element) {
    if !element.is_rendered() {
        animations_of(&cx.heap, element).for_each(|it| it.release_if_over(cx));
    }
}

pub(super) fn relevant_animations<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    subtree: bool,
) -> JSValue {
    let (doc, all) = (node.doc(), List::new(node.realm(&cx.heap)));
    if node.is_rendered() {
        let ids = node.synced_engine(cx, |engine, id| engine.relevant_animations(id, subtree));
        doc.invalidate(cx);
        for id in ids {
            Animation::with_id(cx, doc, id, None, "")
                .into_iter()
                .for_each(|it| all.push(&cx.heap, it.to_js()));
        }
    }
    all.to_js()
}

impl HasTimeline {
    pub(crate) fn get_timeline<'a>(&'a self, heap: &JsHeap<'a>) -> &'a AnimationTimeline {
        DocumentAnimations::of(heap, self).timeline(heap, self)
    }
}

impl HasAnimations {
    pub(crate) fn get_animations<'a>(&'a self, cx: &mut JsScope<'a>) -> JSValue {
        relevant_animations(cx, self, true)
    }
}
