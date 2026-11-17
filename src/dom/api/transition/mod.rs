//! <https://drafts.csswg.org/css-view-transitions-2/>

use core::cell::Cell;

use bun_jsc::bindgen::{
    Callable, CallbackBody, ClassStructure, JsHeap, JsInterface, JsLocal, JsScope, Result, to_js,
};
use bun_jsc::{JSPromise, JSString, JSValue};

use crate::api::core::{Atom, Doc, DomError, DomString, Edge, Element, List, atom};
use crate::api::events::{Event, EventInit, Trusted};
use crate::api::images::Pictures;
use crate::api::ui::{Ui, host};
use crate::api::window::{Is, Window};
use crate::document::Document;
use crate::generated_bindgen::view_transition::*;
use crate::tree::NodeId;

#[derive(Clone, Copy, Default, PartialEq)]
enum Phase {
    #[default]
    PendingCapture,
    UpdateCallbackCalled,
    Animating,
    Done,
}

#[derive(Default)]
pub(crate) struct ViewTransition {
    phase: Cell<Phase>,
    suppresses_rendering: Cell<bool>,
    is_inbound: Cell<bool>,
    wait_until_count: Cell<u32>,
}

fn transitions(list: List<'_>) -> impl Iterator<Item = &ViewTransition> {
    // SAFETY: the list has transitions.
    list.values()
        .map(|it| unsafe { ViewTransition::from_js_unchecked(it) })
}

fn all_active(doc: &Doc) -> impl Iterator<Item = &ViewTransition> {
    doc.try_edge_list(Edge::ViewTransitions)
        .into_iter()
        .flat_map(transitions)
}

/// They may end meanwhile.
fn for_each_active<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    mut run: impl FnMut(&mut JsScope<'a>, &'a ViewTransition),
) {
    let Some(all) = doc.try_edge_list(Edge::ViewTransitions) else {
        return;
    };
    transitions(List::from_fn(&cx.heap, all.len(), |it| all.get(it))).for_each(|it| run(cx, it));
}

fn active<'a>(doc: &'a Doc, scope: Option<&Element>) -> Option<&'a ViewTransition> {
    all_active(doc).find(|it| it.scope() == scope)
}

fn promise<'a>(heap: &JsHeap<'a>, field: Option<JSValue>) -> JsLocal<'a, JSPromise> {
    field
        .and_then(|it| JsLocal::new(heap, it).as_promise())
        .expect("set when it is made")
}

fn from_job<'a>(captured: JSValue) -> &'a ViewTransition {
    // SAFETY: jobs and callbacks capture a transition, and keep it alive.
    unsafe { ViewTransition::from_js_unchecked(captured) }
}

fn is_visible(doc: &Doc) -> bool {
    doc.window()
        .and_then(|it| it.downcast::<Window>())
        .is_some_and(|it| it.is(Is::VISIBLE))
}

macro_rules! step {
    (|$cx:ident, $this:ident, $argument:pat_param| $body:expr) => {
        |$cx, [this, _], _, arguments| {
            let ($this, $argument) = (
                from_job(this.to_js()),
                arguments
                    .first()
                    .map_or(JSValue::UNDEFINED, |it| it.to_js()),
            );
            $body;
            Ok(JSValue::UNDEFINED)
        }
    };
}

impl ViewTransition {
    fn new<'a>(heap: &JsHeap<'a>, doc: &'a Doc, scope: Option<&'a Element>) -> &'a ViewTransition {
        let realm = doc.realm(heap);
        let made = js_ViewTransition::create(realm, ViewTransition::default());
        js_ViewTransition::set_document(made, Some(doc));
        js_ViewTransition::set_scope(made, scope);
        js_ViewTransition::set_update_callback_done(made, realm.create_promise().to_js());
        js_ViewTransition::set_ready(made, realm.create_promise().to_js());
        js_ViewTransition::set_finished(made, realm.create_promise().to_js());
        let types = js_ViewTransitionTypeSet::create(realm, Default::default());
        js_ViewTransitionTypeSet::set_transition(types, Some(made));
        js_ViewTransition::set_types(made, Some(types));
        made
    }

    fn doc(&self) -> &Doc {
        js_ViewTransition::document(self).expect("set when it is made")
    }

    fn scope(&self) -> Option<&Element> {
        js_ViewTransition::scope(self)
    }

    fn types(&self) -> &ViewTransitionTypeSet {
        js_ViewTransition::types(self).expect("set when it is made")
    }

    fn callback<'a>(&'a self, heap: &JsHeap<'a>, body: CallbackBody) -> JsLocal<'a, Callable> {
        self.realm(heap)
            .create_callback(body, [self.to_js(), JSValue::UNDEFINED], 0)
    }

    fn is_active(&self) -> bool {
        all_active(self.doc()).any(|it| core::ptr::eq(it, self))
    }

    /// The default if the scope is gone.
    fn engine<'a, R: Default>(
        &'a self,
        cx: &mut JsScope<'a>,
        run: impl FnOnce(&mut Document, NodeId) -> R,
    ) -> R {
        match self.scope() {
            Some(scope) if !scope.is_rendered() || scope.doc() != self.doc() => R::default(),
            scope => self
                .doc()
                .synced_engine(cx, |engine, _| run(engine, scope.map_or(0, |it| it.id()))),
        }
    }

    fn set_state<'a>(&'a self, cx: &mut JsScope<'a>, name: &str, on: bool) {
        if let Some(root) = self
            .get_transition_root()
            .filter(|it| it.doc() == self.doc())
        {
            self.doc().sync(cx);
            root.set_custom_state(cx, name, on);
        }
    }

    fn show_type<'a>(&'a self, cx: &mut JsScope<'a>, name: JSValue, on: bool) -> Result<'a, ()> {
        let name = DomString::from_js(cx, JsLocal::new(&cx.heap, name))?;
        let name = name.to_utf8();
        let is_reserved = name.eq_ignore_ascii_case("none")
            || name
                .get(..4)
                .is_some_and(|it| it.eq_ignore_ascii_case("-ua-"));
        if self.is_active() && !is_reserved {
            self.set_state(cx, &format!(":type {name}"), on);
        }
        Ok(())
    }

    fn show_states<'a>(&'a self, cx: &mut JsScope<'a>, on: bool) {
        _ = self.types().show_all(cx, on);
        self.set_state(cx, ":active-view-transition", on);
    }

    fn become_active<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.doc()
            .edge_list(&cx.heap, Edge::ViewTransitions)
            .push(&cx.heap, self.to_js());
        Pictures::of(&cx.heap, self.doc()).set_keeps_unused(true);
        self.show_states(cx, true);
    }

    /// <https://drafts.csswg.org/css-view-transitions-2/#clear-view-transition>
    fn clear<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.show_states(cx, false);
        self.doc()
            .edge_list(&cx.heap, Edge::ViewTransitions)
            .remove(&cx.heap, self.to_js());
        Pictures::of(&cx.heap, self.doc()).set_keeps_unused(has_view_transitions(self.doc()));
        match self.scope() {
            Some(scope) if scope.doc() == self.doc() => {
                scope.synced_engine(cx, |engine, id| engine.end_view_transition(id))
            }
            _ => self.engine(cx, Document::end_view_transition),
        }
    }

    /// <https://drafts.csswg.org/css-view-transitions-2/#schedule-the-update-callback>
    fn schedule_update_callback<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.doc()
            .edge_list(&cx.heap, Edge::UpdateCallbackQueue)
            .push(&cx.heap, self.to_js());
        match has_window(self.doc()) {
            true => host::queue_task(cx, self.doc(), [self.to_js()], |cx, [this]| {
                flush_update_callback_queue(cx, from_job(this).doc())
            }),
            false => host::queue_microtask(cx, [self.to_js()], |cx, [this]| {
                flush_update_callback_queue(cx, from_job(this).doc())
            }),
        }
    }

    /// <https://drafts.csswg.org/css-view-transitions-2/#call-the-update-callback>
    fn call_update_callback<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        const TIMEOUT: f64 = 4000.0;
        if self.phase.get() != Phase::Done {
            self.phase.set(Phase::UpdateCallbackCalled);
        }
        if let Some(ui) = Ui::of(self.doc()).filter(|_| self.is_active()) {
            host::set_timeout(cx, ui, TIMEOUT, [self.to_js()], |cx, [this]| {
                if from_job(this).phase.get() == Phase::UpdateCallbackCalled {
                    from_job(this).skip_for(
                        cx,
                        DomError::TimeoutError,
                        "Transition was aborted because of timeout in DOM update",
                    );
                }
            });
        }
        let called = self.realm(&cx.heap).create_promise();
        match js_ViewTransition::update(self).map_or(Ok(JSValue::UNDEFINED), |it| {
            it.call(cx.global(), JSValue::UNDEFINED, &[])
        }) {
            Ok(result) => called.resolve(cx, result)?,
            Err(error) => {
                let error = cx.catch(error.into())?;
                called.reject(cx, error)?;
            }
        }
        let fulfilled: CallbackBody = step!(|cx, this, _| {
            promise(&cx.heap, js_ViewTransition::update_callback_done(this))
                .resolve(cx, JSValue::UNDEFINED)?;
            match this.phase.get() {
                Phase::Done => this.finish(cx)?,
                _ => activate_transition(cx, this),
            }
        });
        let rejected: CallbackBody = step!(|cx, this, reason| {
            promise(&cx.heap, js_ViewTransition::update_callback_done(this)).reject(cx, reason)?;
            promise(&cx.heap, js_ViewTransition::ready(this)).reject(cx, reason)?;
            promise(&cx.heap, js_ViewTransition::finished(this)).reject(cx, reason)?;
            this.skip(cx, reason);
        });
        called.react(
            &cx.heap,
            Some(self.callback(&cx.heap, fulfilled)),
            Some(self.callback(&cx.heap, rejected)),
        );
        Ok(())
    }

    /// <https://drafts.csswg.org/css-view-transitions-2/#skip-the-view-transition>
    fn skip<'a>(&'a self, cx: &mut JsScope<'a>, reason: JSValue) {
        if self.phase.get() == Phase::Done {
            return;
        }
        if self.phase.get() == Phase::PendingCapture {
            self.schedule_update_callback(cx);
        }
        if self.is_active() {
            self.clear(cx);
        }
        self.phase.set(Phase::Done);
        _ = promise(&cx.heap, js_ViewTransition::ready(self)).reject(cx, reason);
        if !promise(&cx.heap, js_ViewTransition::update_callback_done(self)).is_pending() {
            _ = self.finish(cx);
        }
    }

    fn skip_for<'a>(&'a self, cx: &mut JsScope<'a>, code: DomError, message: &str) {
        let reason = self
            .realm(&cx.heap)
            .create_dom_exception(code, format_args!("{message}"))
            .to_js();
        self.skip(cx, reason);
    }

    fn fail<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.skip_for(
            cx,
            DomError::InvalidStateError,
            "Transition was aborted because of invalid state",
        );
    }

    /// <https://drafts.csswg.org/css-view-transitions-2/#setup-view-transition>
    fn set_up<'a>(&'a self, cx: &mut JsScope<'a>, canvas: u32) {
        flush_update_callback_queue(cx, self.doc());
        if !self.is_active() {
            return;
        }
        if !self.engine(cx, |engine, scope| engine.capture_old_state(scope, canvas)) {
            return self.fail(cx);
        }
        self.suppresses_rendering.set(self.scope().is_none());
        self.phase.set(Phase::UpdateCallbackCalled);
        self.schedule_update_callback(cx);
    }

    /// <https://drafts.csswg.org/css-view-transitions-2/#handle-transition-frame>
    fn handle_frame<'a>(&'a self, cx: &mut JsScope<'a>) {
        let Some(is_animated) = self.engine(cx, Document::update_view_transition) else {
            return self.fail(cx);
        };
        if self.is_inbound.get()
            && self
                .engine(cx, |engine, _| engine.navigation_transition())
                .is_none()
        {
            return self.fail(cx);
        }
        if !is_animated && self.wait_until_count.get() == 0 {
            host::queue_task(cx, self.doc(), [self.to_js()], |cx, [this]| {
                _ = from_job(this).finish(cx)
            });
        }
    }

    fn finish<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        if self.phase.replace(Phase::Done) != Phase::Done {
            self.clear(cx);
        }
        promise(&cx.heap, js_ViewTransition::finished(self)).resolve(cx, JSValue::UNDEFINED)
    }

    /// <https://drafts.csswg.org/css-view-transitions-2/#resolve-inbound-cross-document-view-transition>
    fn for_navigation<'a>(
        cx: &mut JsScope<'a>,
        doc: &'a Doc,
        types: &[u8],
    ) -> Result<'a, &'a ViewTransition> {
        let made = ViewTransition::new(&cx.heap, doc, None);
        for it in crate::hooks::words(types) {
            js_ViewTransitionTypeSet::backing(&cx.heap, made.types())
                .add(&cx.heap, to_js::utf8(&cx.heap, it)?.to_js())?;
        }
        promise(&cx.heap, js_ViewTransition::ready(made)).mark_as_handled();
        promise(&cx.heap, js_ViewTransition::update_callback_done(made))
            .resolve(cx, JSValue::UNDEFINED)?;
        made.phase.set(Phase::UpdateCallbackCalled);
        made.become_active(cx);
        Ok(made)
    }

    pub(crate) fn skip_transition<'a>(&'a self, cx: &mut JsScope<'a>) {
        self.skip_for(cx, DomError::AbortError, "Transition was skipped");
    }

    pub(crate) fn get_transition_root(&self) -> Option<&Element> {
        self.scope().or_else(|| self.doc().document_element())
    }

    pub(crate) fn wait_until<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        promise: JsLocal<'a>,
    ) -> Result<'a, ()> {
        let settled: CallbackBody = step!(|cx, this, _| {
            this.wait_until_count.update(|it| it - 1);
            this.doc().invalidate(cx);
        });
        let (promise, settled) = (
            cx.promise_resolve(promise.to_js())?,
            self.callback(&cx.heap, settled),
        );
        self.wait_until_count.update(|it| it + 1);
        promise.react(&cx.heap, Some(settled), Some(settled));
        Ok(())
    }
}

/// <https://drafts.csswg.org/css-view-transitions-2/#flush-the-update-callback-queue>
fn flush_update_callback_queue<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    let Some(queue) = doc.try_edge_list(Edge::UpdateCallbackQueue) else {
        return;
    };
    doc.clear_edge(&cx.heap, Edge::UpdateCallbackQueue);
    transitions(queue).for_each(|it| _ = it.call_update_callback(cx));
}

impl ViewTransitionTypeSet {
    fn transition(&self) -> &ViewTransition {
        js_ViewTransitionTypeSet::transition(self).expect("set when it is made")
    }

    fn show_all<'a>(&'a self, cx: &mut JsScope<'a>, on: bool) -> Result<'a, ()> {
        js_ViewTransitionTypeSet::backing(&cx.heap, self)
            .values(&cx.heap)?
            .iter()
            .try_for_each(|it| self.transition().show_type(cx, it.to_js(), on))
    }

    pub(crate) fn add<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: JsLocal<'a, JSString>,
    ) -> Result<'a, &'a Self> {
        js_ViewTransitionTypeSet::backing(&cx.heap, self).add(&cx.heap, value.to_js())?;
        self.transition().show_type(cx, value.to_js(), true)?;
        Ok(self)
    }

    pub(crate) fn delete<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        value: JsLocal<'a, JSString>,
    ) -> Result<'a, bool> {
        self.transition().show_type(cx, value.to_js(), false)?;
        js_ViewTransitionTypeSet::backing(&cx.heap, self).remove(&cx.heap, value.to_js())
    }

    pub(crate) fn clear<'a>(&'a self, cx: &mut JsScope<'a>) -> Result<'a, ()> {
        self.show_all(cx, false)?;
        js_ViewTransitionTypeSet::backing(&cx.heap, self).clear(&cx.heap)
    }
}

impl StartsViewTransitions {
    fn scope(&self) -> Option<&Element> {
        self.as_element()
            .filter(|it| Some(*it) != self.doc().document_element())
    }

    pub(crate) fn start_view_transition<'a>(
        &'a self,
        cx: &mut JsScope<'a>,
        given: Option<UpdateCallbackOrOptions<'a>>,
    ) -> Result<'a, &'a ViewTransition> {
        let (update, types) = match given {
            Some(UpdateCallbackOrOptions::Update(it)) => (Some(it), None),
            Some(UpdateCallbackOrOptions::Options(it)) => (it.update, it.types),
            None => (None, None),
        };
        let made = ViewTransition::new(&cx.heap, self.doc(), self.scope());
        update
            .into_iter()
            .for_each(|it| js_ViewTransition::set_update(made, it.to_js()));
        types
            .into_iter()
            .flat_map(|it| it.iter())
            .try_for_each(|it| {
                js_ViewTransitionTypeSet::backing(&cx.heap, made.types()).add(&cx.heap, it.to_js())
            })?;
        if !has_window(self.doc()) {
            made.skip_for(cx, DomError::AbortError, "The document has no window");
        } else if !is_visible(self.doc()) {
            made.fail(cx);
        } else {
            self.get_active_view_transition()
                .into_iter()
                .for_each(|it| {
                    it.skip_for(
                        cx,
                        DomError::AbortError,
                        "Transition was skipped because a new one started",
                    )
                });
            made.become_active(cx);
        }
        Ok(made)
    }

    pub(crate) fn get_active_view_transition(&self) -> Option<&ViewTransition> {
        active(self.doc(), self.scope())
    }
}

fn has_window(doc: &Doc) -> bool {
    doc.window().is_some_and(|it| !it.is_disposed())
}

pub(crate) fn has_view_transitions(doc: &Doc) -> bool {
    all_active(doc).next().is_some()
}

pub(crate) fn suppresses_rendering(doc: &Doc) -> bool {
    all_active(doc).any(|it| it.suppresses_rendering.get())
}

pub(crate) fn skip_view_transitions<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) {
    for_each_active(cx, doc, |cx, it| it.fail(cx));
}

/// <https://drafts.csswg.org/css-view-transitions-2/#perform-pending-transition-operations>
pub(crate) fn perform_view_transitions<'a>(cx: &mut JsScope<'a>, doc: &'a Doc, canvas: u32) {
    for_each_active(cx, doc, |cx, it| match it.phase.get() {
        Phase::PendingCapture => it.set_up(cx, canvas),
        Phase::Animating => it.handle_frame(cx),
        _ => {}
    });
}

/// <https://drafts.csswg.org/css-view-transitions-2/#activate-view-transition>
pub(crate) fn activate_transition<'a>(cx: &mut JsScope<'a>, transition: &'a ViewTransition) {
    if transition.phase.get() == Phase::Done {
        return;
    }
    transition.suppresses_rendering.set(false);
    if !transition.engine(cx, Document::capture_new_state) {
        return transition.fail(cx);
    }
    transition.phase.set(Phase::Animating);
    _ = promise(&cx.heap, js_ViewTransition::ready(transition)).resolve(cx, JSValue::UNDEFINED);
    transition.doc().invalidate(cx);
}

fn types_for_navigation<'a>(cx: &mut JsScope<'a>, doc: &'a Doc) -> Option<Vec<u8>> {
    is_visible(doc).then(|| doc.synced_engine(cx, |engine, _| engine.navigation_transition()))?
}

/// <https://drafts.csswg.org/css-view-transitions-2/#setup-cross-document-view-transition>
pub(crate) fn start_outbound_transition<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
) -> Result<'a, Option<&'a ViewTransition>> {
    let Some(types) = types_for_navigation(cx, doc) else {
        return Ok(None);
    };
    active(doc, None).into_iter().for_each(|it| {
        it.skip_for(
            cx,
            DomError::AbortError,
            "Transition was skipped because navigation started",
        )
    });
    ViewTransition::for_navigation(cx, doc, &types).map(Some)
}

pub(crate) fn hand_over_transition<'a>(
    cx: &mut JsScope<'a>,
    transition: &'a ViewTransition,
) -> u32 {
    let window = transition
        .doc()
        .window()
        .and_then(|it| it.downcast::<Window>())
        .filter(|_| transition.is_active());
    let Some(canvas) = window.map(Window::canvas_color) else {
        return 0;
    };
    let ticket = transition.engine(cx, |engine, _| {
        if engine.capture_old_state(0, canvas) {
            engine.hand_over_old_state()
        } else {
            0
        }
    });
    transition.fail(cx);
    ticket
}

pub(crate) fn start_inbound_transition<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    ticket: u32,
) -> Result<'a, Option<&'a ViewTransition>> {
    let types = active(doc, None)
        .is_none()
        .then(|| types_for_navigation(cx, doc))
        .flatten();
    let Some(types) = types.filter(|_| doc.engine(|engine, _| engine.take_over_old_state(ticket)))
    else {
        return Ok(None);
    };
    let made = ViewTransition::for_navigation(cx, doc, &types)?;
    made.is_inbound.set(true);
    Ok(Some(made))
}

#[repr(C)]
pub(crate) struct PageRevealEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_PageRevealEvent::Fields,
}

impl PageRevealEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        kind: Atom,
        init: &PageRevealEventInit<'a>,
    ) -> &'a Self {
        let base = Event::base(
            kind,
            EventInit {
                bubbles: init.bubbles,
                cancelable: init.cancelable,
                composed: init.composed,
            },
            Trusted::No,
        );
        let made = structure.create(
            heap,
            Self {
                base,
                fields: Default::default(),
            },
        );
        js_PageRevealEvent::set_transition(made, init.view_transition);
        made
    }

    pub(crate) fn new<'a>(heap: &JsHeap<'a>, transition: Option<&'a ViewTransition>) -> &'a Event {
        let made = js_PageRevealEvent::create(
            heap,
            Self {
                base: Event::base(atom!("pagereveal"), EventInit::default(), Trusted::Yes),
                fields: Default::default(),
            },
        );
        js_PageRevealEvent::set_transition(made, transition);
        made
    }
}
