//! <https://drafts.csswg.org/web-animations/#the-animation-interface>

use core::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsLocal, JsScope, Result};
use bun_jsc::{JSPromise, JSString, JSValue};

use super::document::{
    Collected, DocumentAnimations, PlaybackEvent, relevant_animations, take_events, time_origin,
};
use super::effect::timing_of;
use super::{
    AnimationEffect, AnimationTimeline, AnimationTrigger, milliseconds, nullable, percent, range,
    settle,
};
use crate::animation::{Behavior, Control, Playing, ReplaceState, State, TimelineId};
use crate::api::core::{
    Doc, DocFlags, DomError, Edge, Element, EventTarget, NodeFlags, Ns, dom_error, seams,
};
use crate::api::cssom;
use crate::calc::{Kind, Unit};
use crate::document::Document;
use crate::engine_event::Playback;
use crate::generated_bindgen::animation::*;
use crate::generated_bindgen::typed::CSSNumberish;
use crate::selector::Pseudo;
use crate::tree::NodeId;
use crate::values::{Out, Str};

struct OfStyle {
    name: Str,
    collected: Rc<Collected>,
}

#[repr(C)]
pub(crate) struct Animation {
    pub(crate) base: EventTarget,
    pub(crate) fields: js_Animation::Fields,
    id: u32,
    /// The target that the engine knows.
    node: Cell<NodeId>,
    /// Whether the engine has it. If not, `last` is what it was like when it went away.
    is_live: Cell<bool>,
    has_notified: Cell<bool>,
    last: Cell<State>,
    range: RefCell<[Option<Out>; 2]>,
    pub(super) behaviors: Cell<Option<[Behavior; 2]>>,
    of_style: OnceCell<OfStyle>,
}

impl Drop for Animation {
    fn drop(&mut self) {
        self.of_style
            .get()
            .into_iter()
            .for_each(|it| it.collected.animations.borrow_mut().push(self.id));
    }
}

#[derive(Clone, Copy)]
enum Promised {
    Ready,
    Finished,
}

impl Animation {
    fn new(id: u32) -> Animation {
        Animation {
            base: Default::default(),
            fields: Default::default(),
            id,
            node: Cell::new(0),
            is_live: Cell::new(false),
            has_notified: Cell::new(false),
            last: Cell::default(),
            range: RefCell::default(),
            behaviors: Cell::new(None),
            of_style: OnceCell::new(),
        }
    }

    fn init<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        doc: &'a Doc,
        timeline: Option<&'a AnimationTimeline>,
        effect: Option<&'a AnimationEffect>,
    ) -> &'a Self {
        js_Animation::set_document(self, Some(doc));
        js_Animation::set_timeline(self, timeline);
        self.set_effect(cx, effect);
        self
    }

    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        structure: ClassStructure<'a, Self>,
        effect: Option<&'a AnimationEffect>,
        timeline: JsLocal<'a>,
    ) -> Result<'a, &'a Self> {
        let timeline = nullable::<AnimationTimeline>(&cx.heap, timeline.to_js())?;
        let current = seams::current_document(cx)?;
        let timeline = timeline.unwrap_or_else(|| {
            Some(DocumentAnimations::of(&cx.heap, current).timeline(&cx.heap, current))
        });
        let target = effect
            .and_then(AnimationEffect::target)
            .filter(|_| !timeline.is_some_and(AnimationTimeline::follows_scroll));
        let doc = [
            target.map(|it| it.doc()),
            timeline.map(AnimationTimeline::doc),
        ]
        .into_iter()
        .flatten()
        .find(|it| it.is(DocFlags::HAS_PAGE))
        .unwrap_or(current);
        Ok(structure
            .create(
                &cx.heap,
                Animation::new(doc.engine(|engine, _| engine.reserve_animation())),
            )
            .init(cx, doc, timeline, effect))
    }

    /// `target` and `pseudo` are for one that the engine has taken from its element.
    pub(super) fn with_id<'a>(
        cx: &mut JsScope<'a>,
        doc: &'a Doc,
        id: u32,
        target: Option<&'a Element>,
        pseudo: &str,
    ) -> Option<&'a Animation> {
        let all = DocumentAnimations::of(&cx.heap, doc);
        if let Some(known) = all.find(id) {
            return Some(known);
        }
        let origin = doc.engine(|engine, _| engine.expose_animation(id))?;
        let realm = doc.realm(&cx.heap);
        let effect = js_KeyframeEffect::create(
            realm,
            AnimationEffect::of_style(if pseudo.is_empty() {
                &origin.pseudo
            } else {
                pseudo
            }),
        );
        js_AnimationEffect::set_target(
            effect,
            target.or_else(|| doc.rendered_node(origin.node)?.as_element()),
        );
        let class = if origin.is_transition {
            js_CSSTransition::CLASS.widen()
        } else {
            js_CSSAnimation::CLASS.widen()
        };
        let made: &Animation = class.create(realm, Animation::new(id));
        let timeline = all.timeline(&cx.heap, doc);
        made.init(cx, doc, Some(timeline), Some(effect));
        _ = made.of_style.set(OfStyle {
            name: origin.name,
            collected: Rc::clone(&all.collected),
        });
        made.node.set(origin.node);
        made.adopt(&cx.heap);
        if origin.node == 0 {
            made.retarget(cx);
        }
        all.remember(&cx.heap, made);
        made.has_notified
            .set(made.state(cx).play_state == Playing::Finished);
        made.release_if_over(cx);
        Some(made)
    }

    pub(super) fn id(&self) -> u32 {
        self.id
    }

    fn doc(&self) -> &Doc {
        js_Animation::document(self).expect("set when it is made")
    }

    fn effect(&self) -> Option<&AnimationEffect> {
        js_Animation::effect(self)
    }

    fn target(&self) -> Option<&Element> {
        self.effect()?.target()
    }

    pub(super) fn trigger(&self) -> Option<&AnimationTrigger> {
        js_Animation::trigger(self)
    }

    pub(super) fn is_live(&self) -> bool {
        self.is_live.get()
    }

    pub(super) fn is_css(&self) -> bool {
        self.of_style.get().is_some()
    }

    pub(super) fn engine<R: Default>(&self, run: impl FnOnce(&mut Document, u32) -> R) -> R {
        self.doc().engine(|engine, _| run(engine, self.id))
    }

    fn all<'a>(&'a self, heap: &JsHeap<'a>) -> &'a DocumentAnimations {
        DocumentAnimations::of(heap, self.doc())
    }

    fn adopt<'a>(&'a self, heap: &JsHeap<'a>) {
        self.is_live.set(true);
        self.all(heap).hold(heap, self);
    }

    pub(super) fn state<'a>(&'a self, cx: &mut JsScope<'a>) -> State {
        if self.is_live() {
            self.all(&cx.heap).advance_clock(cx, self.doc());
            self.doc().sync(cx);
            self.last.set(
                self.engine(|engine, id| engine.animation_state(id))
                    .unwrap_or_default(),
            );
        }
        self.last.get()
    }

    fn follows_scroll<'a>(&'a self, cx: &mut JsScope<'a>) -> bool {
        self.get_timeline(cx)
            .is_some_and(AnimationTimeline::follows_scroll)
    }

    pub(super) fn time_to_js<'a>(&'a self, cx: &mut JsScope<'a>, time: Option<f64>) -> JSValue {
        time.map_or(JSValue::NULL, |it| {
            if self.follows_scroll(cx) {
                percent(self.realm(&cx.heap), it)
            } else {
                JSValue::js_number(it)
            }
        })
    }

    fn time_from_js<'a>(&'a self, cx: &mut JsScope<'a>, time: CSSNumberish<'a>) -> Result<'a, f64> {
        match (time, self.follows_scroll(cx)) {
            (CSSNumberish::Number(it), false) => Ok(it),
            (CSSNumberish::Value(it), false) => milliseconds(&cx.heap, it),
            (CSSNumberish::Value(it), true) if it.numeric_type().matches(Kind::Percentage) => {
                it.amount(&cx.heap, Unit::Percent)
            }
            _ => Err(cx.heap.type_error(format_args!(
                "An animation that is based on progress takes a percentage."
            ))),
        }
    }

    /// The element tells those in its list when it is rendered.
    fn attach_to_target<'a>(&'a self, heap: &JsHeap<'a>) -> NodeId {
        if let Some(target) = self.target() {
            let list = target.edge_list(heap, Edge::Animations);
            if !list.contains(self.to_js()) {
                list.push(heap, self.to_js());
            }
            target.set(NodeFlags::ANIMATED);
        }
        self.node.set(
            self.target()
                .filter(|it| it.is_rendered() && it.doc() == self.doc())
                .map_or(0, |it| it.id()),
        );
        self.node.get()
    }

    pub(super) fn detach_from_target<'a>(&'a self, heap: &JsHeap<'a>) {
        if let Some(target) = self
            .target()
            .filter(|it| it.edge(Edge::Animations).is_some())
        {
            target
                .edge_list(heap, Edge::Animations)
                .remove(heap, self.to_js());
        }
    }

    fn pseudo(&self) -> Pseudo {
        self.effect().map_or(Pseudo::None, AnimationEffect::pseudo)
    }

    fn timeline_id(&self) -> TimelineId {
        let Some(timeline) = js_Animation::timeline(self) else {
            return TimelineId::None;
        };
        match timeline.id_if_active() {
            TimelineId::Document(origin) => TimelineId::Document(
                origin + (time_origin(timeline.doc()) - time_origin(self.doc())),
            ),
            id => id,
        }
    }

    pub(super) fn revive<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.all(&cx.heap).advance_clock(cx, self.doc());
        if !self.is_live() {
            self.doc().sync(cx);
            let (node, timeline) = (self.attach_to_target(&cx.heap), self.timeline_id());
            self.engine(|engine, id| {
                engine.create_animation(
                    id,
                    node,
                    self.pseudo(),
                    self.effect().map_or_else(
                        || AnimationEffect::default().timing(),
                        AnimationEffect::timing,
                    ),
                );
                self.effect()
                    .into_iter()
                    .for_each(|it| it.send_keyframes(engine, id));
                if timeline != TimelineId::Document(0.0) {
                    engine.set_timeline(id, timeline);
                }
                self.range
                    .borrow()
                    .iter()
                    .enumerate()
                    .for_each(|(edge, it)| it.iter().for_each(|it| engine.set_range(id, edge, it)));
                engine.restore_animation(id, &self.last.get());
            });
        }
        self.adopt(&cx.heap);
    }

    pub(super) fn retarget<'a>(&'a self, cx: &mut JsScope<'a>) {
        if self.is_live() {
            self.doc().sync(cx);
            let node = self.attach_to_target(&cx.heap);
            self.engine(|engine, id| engine.set_target(id, node, self.pseudo()));
            self.doc().invalidate(cx);
        }
    }

    pub(super) fn target_is_rendered<'a>(&'a self, cx: &mut JsScope<'a>) {
        if !self.is_live() {
            if self.doc().is(DocFlags::HAS_PAGE) && self.last.get().play_state != Playing::Idle {
                self.revive(cx);
            }
        } else if self.target().is_some_and(|it| {
            it.id() != self.node.get() || self.engine(|engine, id| engine.has_lost_target(id))
        }) {
            self.retarget(cx);
        }
    }

    pub(super) fn changed<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.doc().invalidate(cx);
        take_events(cx, self.doc());
        if self.is_ready_settled() && self.state(cx).is_pending {
            self.forget_promise(Promised::Ready);
        }
    }

    fn control<'a>(&'a self, cx: &mut JsScope<'a>, control: Control) -> Result<'a, ()> {
        self.doc().sync(cx);
        self.revive(cx);
        if self.engine(|engine, id| !engine.control_animation(id, control)) {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "The animation would have to seek to an end that it does not have.",
            ));
        }
        self.changed(cx);
        Ok(())
    }

    pub(super) fn engine_did<'a>(&'a self, cx: &mut JsScope<'a>, playback: Playback) {
        let kind = match playback {
            Playback::Ready => {
                self.resolve(cx, Promised::Ready);
                if self.has_notified.get() {
                    self.release_if_over(cx);
                }
                return;
            }
            Playback::Finish => {
                return self.all(&cx.heap).queue_finish_notification(&cx.heap, self);
            }
            Playback::Unfinish => {
                self.adopt(&cx.heap);
                if self.has_notified.take() {
                    self.forget_promise(Promised::Finished);
                }
                return;
            }
            Playback::Cancel { was_pending } => {
                if was_pending {
                    self.abort(cx, Promised::Ready);
                }
                self.abort(cx, Promised::Finished);
                self.has_notified.set(false);
                "cancel"
            }
            Playback::Remove => "remove",
        };
        let state = self.state(cx);
        self.queue_event(cx, kind, state.timeline_time);
        self.release_if_over(cx);
    }

    /// `due` is a time of the timeline.
    fn queue_event<'a>(&'a self, cx: &mut JsScope<'a>, kind: &'static str, due: Option<f64>) {
        let (follows_scroll, state) = (self.follows_scroll(cx), self.last.get());
        let origin = if let TimelineId::Document(origin) = self.timeline_id() {
            origin
        } else {
            0.0
        };
        let event = PlaybackEvent {
            kind,
            current_time: state.current_time,
            timeline_time: state.timeline_time,
            follows_scroll,
            scheduled: due
                .filter(|it| !follows_scroll && !it.is_nan())
                .map_or(f64::NEG_INFINITY, |it| it + origin),
            composite_order: if self.is_css() {
                self.is_a::<CSSAnimation>().into()
            } else {
                2
            },
        };
        self.all(&cx.heap)
            .queue_playback_event(&cx.heap, self, event);
        self.doc().invalidate(cx);
    }

    /// It has no effect any more. `revive` makes it again if a script changes it.
    pub(super) fn release_if_over<'a>(&'a self, cx: &mut JsScope<'a>) {
        let state = self.state(cx);
        let is_filling = state.replace_state != ReplaceState::Removed && state.progress.is_some();
        let is_driven = self.follows_scroll(cx) || self.trigger().is_some();
        let has_ended = self.has_notified.get() && !is_driven;
        let waits_for_target = is_filling
            && has_ended
            && !self.is_css()
            && self.target().is_some_and(|it| !it.is_rendered());
        let is_over = state.play_state == Playing::Idle || has_ended && !is_filling;
        if !self.is_live() || !(is_over || waits_for_target) || state.is_pending {
            return;
        }
        if !waits_for_target {
            self.detach_from_target(&cx.heap);
        }
        self.all(&cx.heap).let_go(&cx.heap, self);
        if !self.is_css() {
            self.engine(|engine, id| engine.control_animation(id, Control::Release));
            self.is_live.set(false);
        }
    }

    fn promise(&self, which: Promised) -> Option<JSValue> {
        match which {
            Promised::Ready => js_Animation::ready(self),
            Promised::Finished => js_Animation::finished(self),
        }
    }

    fn set_promise(&self, which: Promised, value: JSValue) {
        match which {
            Promised::Ready => js_Animation::set_ready(self, value),
            Promised::Finished => js_Animation::set_finished(self, value),
        }
    }

    fn forget_promise(&self, which: Promised) {
        self.set_promise(which, JSValue::ZERO);
    }

    fn is_ready_settled(&self) -> bool {
        self.promise(Promised::Ready)
            .is_some_and(|it| !super::is_pending(it))
    }

    fn current_promise<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        which: Promised,
        is_done: bool,
    ) -> JSValue {
        self.promise(which).unwrap_or_else(|| {
            let made = JSPromise::create(self.doc().global()).to_js();
            self.set_promise(which, made);
            if is_done {
                self.resolve(cx, which);
            }
            made
        })
    }

    fn resolve<'a>(&'a self, cx: &mut JsScope<'a>, which: Promised) {
        self.promise(which)
            .into_iter()
            .for_each(|it| settle(cx, it, Ok(self.to_js())));
    }

    fn abort<'a>(&'a self, cx: &mut JsScope<'a>, which: Promised) {
        let Some(promise) = self.promise(which) else {
            return;
        };
        self.forget_promise(which);
        let error = self
            .realm(&cx.heap)
            .create_dom_exception(
                DomError::AbortError,
                format_args!("The user aborted a request."),
            )
            .to_js();
        settle(cx, promise, Err(error));
    }

    pub(crate) fn get_id<'a>(&self, heap: &JsHeap<'a>) -> JSValue {
        js_Animation::id(self).unwrap_or_else(|| heap.create_latin1_string(b"").to_js())
    }

    pub(crate) fn set_id<'a>(&self, _: &JsHeap<'a>, value: JsLocal<'a, JSString>) {
        js_Animation::set_id(self, value.to_js());
    }

    pub(crate) fn get_effect<'a>(&'a self, _: &mut JsScope<'a>) -> Option<&'a AnimationEffect> {
        self.effect()
    }

    /// <https://drafts.csswg.org/web-animations/#setting-the-associated-effect>
    pub(crate) fn set_effect<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        effect: Option<&'a AnimationEffect>,
    ) {
        if effect.map(core::ptr::from_ref) == self.effect().map(core::ptr::from_ref) {
            return;
        }
        effect
            .and_then(js_AnimationEffect::animation)
            .into_iter()
            .for_each(|it| it.set_effect(cx, None));
        if self.last.get().play_state != Playing::Idle {
            self.revive(cx);
        }
        if let Some(old) = self.effect() {
            old.refresh(cx, true);
            self.detach_from_target(&cx.heap);
            js_AnimationEffect::set_animation(old, None);
        }
        js_Animation::set_effect(self, effect);
        effect
            .into_iter()
            .for_each(|it| js_AnimationEffect::set_animation(it, Some(self)));
        if self.is_live() {
            let none = AnimationEffect::default();
            let sent = effect.unwrap_or(&none);
            self.retarget(cx);
            self.engine(|engine, id| {
                sent.send_keyframes(engine, id);
                engine.set_timing(id, sent.timing(), u16::MAX);
            });
            self.changed(cx);
        }
    }

    pub(crate) fn get_timeline<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
    ) -> Option<&'a AnimationTimeline> {
        if self.is_css() {
            let (current, all) = (self.state(cx).timeline, self.all(&cx.heap));
            if current != self.timeline_id() {
                js_Animation::set_timeline(
                    self,
                    match current {
                        TimelineId::None => None,
                        TimelineId::Document(_) => Some(all.timeline(&cx.heap, self.doc())),
                        TimelineId::Progress(id) => {
                            Some(all.css_timeline(&cx.heap, self.doc(), id))
                        }
                    },
                );
            }
        }
        js_Animation::timeline(self)
    }

    pub(crate) fn set_timeline<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        timeline: Option<&'a AnimationTimeline>,
    ) {
        self.revive(cx);
        js_Animation::set_timeline(self, timeline);
        let timeline = self.timeline_id();
        self.engine(|engine, id| engine.set_timeline(id, timeline));
        self.changed(cx);
    }

    pub(crate) fn get_start_time<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, JSValue> {
        let time = self.state(cx).start_time;
        Ok(self.time_to_js(cx, time))
    }

    pub(crate) fn set_start_time<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: Option<CSSNumberish<'a>>,
    ) -> Result<'a, ()> {
        let time = value.map(|it| self.time_from_js(cx, it)).transpose()?;
        self.control(cx, Control::SetStart(time))
    }

    pub(crate) fn get_current_time<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, JSValue> {
        let time = self.state(cx).current_time;
        Ok(self.time_to_js(cx, time))
    }

    pub(crate) fn set_current_time<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: Option<CSSNumberish<'a>>,
    ) -> Result<'a, ()> {
        let Some(value) = value else {
            return self.state(cx).current_time.is_none().ok_or_else(|| {
                cx.heap.type_error(format_args!(
                    "currentTime may not be changed from resolved to unresolved"
                ))
            });
        };
        let time = self.time_from_js(cx, value)?;
        self.control(cx, Control::Seek(time))
    }

    pub(crate) fn get_overall_progress<'a>(&'a self, cx: &mut JsScope<'a>) -> Option<f64> {
        self.effect()?;
        self.revive(cx);
        let state = self.state(cx);
        let time = state.current_time?;
        Some(if state.end_time == 0.0 {
            f64::from(time >= 0.0)
        } else {
            (time / state.end_time).clamp(0.0, 1.0)
        })
    }

    pub(crate) fn get_playback_rate<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, f64> {
        Ok(self.state(cx).playback_rate)
    }

    pub(crate) fn set_playback_rate<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: f64,
    ) -> Result<'a, ()> {
        self.control(cx, Control::SetRate(value))
    }

    fn get_range<'a>(&'a self, cx: &mut JsScope<'a>, edge: usize) -> Result<'a, JSValue> {
        let of_style = (self.is_css() && self.is_live()).then(|| {
            self.doc()
                .synced_engine(cx, |engine, _| engine.animation_range(self.id, edge))
        });
        range::to_js(
            self.realm(&cx.heap),
            edge,
            of_style
                .unwrap_or_else(|| self.range.borrow()[edge].clone())
                .as_deref()
                .unwrap_or(b"normal"),
        )
    }

    fn set_range<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        edge: usize,
        value: Option<&RangeEdge<'a>>,
    ) -> Result<'a, ()> {
        let range = range::parse(&cx.heap, edge, value)?;
        if self.is_live() {
            self.doc()
                .synced_engine(cx, |engine, _| engine.set_range(self.id, edge, &range));
        }
        self.range.borrow_mut()[edge] = (range != b"normal").then_some(range);
        if self.is_live() {
            self.changed(cx);
        }
        Ok(())
    }

    pub(crate) fn get_range_start<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, JSValue> {
        self.get_range(cx, 0)
    }

    pub(crate) fn set_range_start<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: &RangeEdge<'a>,
    ) -> Result<'a, ()> {
        self.set_range(cx, 0, Some(value))
    }

    pub(crate) fn get_range_end<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, JSValue> {
        self.get_range(cx, 1)
    }

    pub(crate) fn set_range_end<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: &RangeEdge<'a>,
    ) -> Result<'a, ()> {
        self.set_range(cx, 1, Some(value))
    }

    pub(crate) fn get_play_state<'a>(&'a self, cx: &mut JsScope<'a>) -> AnimationPlayState {
        use AnimationPlayState::*;
        [Idle, Running, Paused, Finished][self.state(cx).play_state as usize]
    }

    pub(crate) fn get_replace_state<'a>(&'a self, cx: &mut JsScope<'a>) -> AnimationReplaceState {
        use AnimationReplaceState::*;
        [Active, Removed, Persisted][self.state(cx).replace_state as usize]
    }

    pub(crate) fn get_pending<'a>(&'a self, cx: &mut JsScope<'a>) -> bool {
        self.state(cx).is_pending
    }

    pub(crate) fn get_ready<'a>(&'a self, cx: &mut JsScope<'a>) -> JSValue {
        let is_pending = self.state(cx).is_pending;
        take_events(cx, self.doc());
        if is_pending && self.is_ready_settled() {
            self.forget_promise(Promised::Ready);
        }
        self.current_promise(cx, Promised::Ready, !is_pending)
    }

    pub(crate) fn get_finished<'a>(&'a self, cx: &mut JsScope<'a>) -> JSValue {
        self.state(cx);
        take_events(cx, self.doc());
        self.current_promise(cx, Promised::Finished, self.has_notified.get())
    }

    pub(crate) fn cancel<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.trigger()
            .into_iter()
            .for_each(|it| it.detach(&cx.heap, self));
        if self.state(cx).play_state == Playing::Idle {
            Ok(())
        } else {
            self.control(cx, Control::Cancel)
        }
    }

    pub(crate) fn finish<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.control(cx, Control::Finish)?;
        notify_finished(cx, self);
        Ok(())
    }

    pub(crate) fn play<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.control(cx, Control::Play)
    }

    pub(crate) fn pause<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.control(cx, Control::Pause)
    }

    pub(crate) fn update_playback_rate<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        rate: f64,
    ) -> Result<'a, ()> {
        self.control(cx, Control::UpdateRate(rate))
    }

    pub(crate) fn reverse<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.control(cx, Control::Reverse)
    }

    pub(crate) fn persist<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.control(cx, Control::Persist)
    }

    pub(crate) fn commit_styles<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        let Some((effect, target)) = self.effect().zip(self.target()) else {
            return Ok(());
        };
        if effect.has_pseudo() || !matches!(target.ns(), Ns::Html | Ns::Svg | Ns::MathMl) {
            return Err(dom_error(
                &cx.heap,
                DomError::NoModificationAllowedError,
                "The target has no style attribute.",
            ));
        }
        if !target.is_rendered() || !target.synced_engine(cx, |engine, id| engine.is_displayed(id))
        {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "Target element is not rendered.",
            ));
        }
        self.revive(cx);
        let values = self.engine(|engine, id| engine.committed_styles(id));
        cssom::set_all_unless_important(cx, target, values.iter().map(|it| (it.0, &it.1[..])));
        self.release_if_over(cx);
        Ok(())
    }
}

/// <https://drafts.csswg.org/web-animations/#finish-notification-steps>
pub(crate) fn notify_finished<'a>(cx: &mut JsScope<'a>, animation: &'a Animation) {
    let state = animation.state(cx);
    if state.play_state != Playing::Finished || animation.has_notified.replace(true) {
        return;
    }
    animation.resolve(cx, Promised::Finished);
    let end = if state.playback_rate > 0.0 {
        state.end_time
    } else {
        0.0
    };
    animation.queue_event(
        cx,
        "finish",
        state.start_time.map(|it| it + end / state.playback_rate),
    );
    animation.release_if_over(cx);
}

impl CSSAnimation {
    pub(crate) fn get_animation_name(&self) -> &str {
        self.of_style.get().map_or("", |it| &it.name)
    }
}

impl CSSTransition {
    pub(crate) fn get_transition_property(&self) -> &str {
        self.of_style.get().map_or("", |it| &it.name)
    }
}

impl Animatable {
    pub(crate) fn animate<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        keyframes: Keyframes<'a>,
        options: Option<DurationOrAnimationOptions<'a>>,
    ) -> Result<'a, &'a Animation> {
        let (effect, options) = match options {
            Some(DurationOrAnimationOptions::Options(it)) => (
                KeyframeEffect::parse(
                    cx,
                    keyframes,
                    &timing_of!(&it),
                    it.composite,
                    it.pseudo_element,
                )?,
                Some(it),
            ),
            Some(DurationOrAnimationOptions::Duration(it)) => (
                KeyframeEffect::with_duration(cx, keyframes, Some(it))?,
                None,
            ),
            None => (KeyframeEffect::with_duration(cx, keyframes, None)?, None),
        };
        let timeline = options.as_ref().map_or(Ok(None), |it| {
            nullable::<AnimationTimeline>(&cx.heap, it.timeline.to_js())
        })?;
        let effect = js_KeyframeEffect::create(self.realm(&cx.heap), effect);
        js_AnimationEffect::set_target(effect, Some(self));
        let timeline = timeline.unwrap_or_else(|| {
            Some(DocumentAnimations::of(&cx.heap, self.doc()).timeline(&cx.heap, self.doc()))
        });
        let doc = Some(timeline.map_or_else(|| self.doc(), AnimationTimeline::doc))
            .filter(|it| it.is(DocFlags::HAS_PAGE))
            .map_or_else(|| seams::current_document(cx), Ok)?;
        let animation = js_Animation::create(
            self.realm(&cx.heap),
            Animation::new(doc.engine(|engine, _| engine.reserve_animation())),
        )
        .init(cx, doc, timeline, Some(effect));
        if let Some(options) = options {
            options
                .id
                .into_iter()
                .for_each(|it| animation.set_id(&cx.heap, it));
            for (edge, range) in [options.range_start, options.range_end]
                .iter()
                .enumerate()
                .filter(|it| it.1.is_some())
            {
                animation.set_range(cx, edge, range.as_ref())?;
            }
        }
        animation.play(cx)?;
        Ok(animation)
    }

    pub(crate) fn get_animations<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        options: &GetAnimationsOptions,
    ) -> JSValue {
        relevant_animations(cx, self, options.subtree)
    }
}
