//! What the documents share whose nodes can be moved to one another.

use core::cell::Cell;

use bun_jsc::bindgen::{JsHeap, JsInterface, JsScope};
use bun_jsc::{JSFunction, JSGlobalObject, JSValue};

use super::arena::Arena;
use super::gc::global_of;
use super::{Doc, DomString, Kind, List, Node, ReadyState};
use crate::api::events::{WindowTarget, report_for};

unsafe extern "C" {
    safe fn Bun__DOM__setAgentOfRealm(global: &JSGlobalObject, agent: JSValue);
    safe fn Bun__DOM__agentOfRealm(global: &JSGlobalObject) -> JSValue;
}
use crate::generated_bindgen::custom::Bun__DOM__reactLater;
use crate::generated_bindgen::observers::{Bun__DOM__notifyObservers, js_DomAgent};

pub(crate) struct Agent {
    pub(super) is_notification_queued: Cell<bool>,
    pub(super) is_backup_queued: Cell<bool>,
}

impl Agent {
    /// That of the realm.
    pub(crate) fn of<'a>(heap: &JsHeap<'a>) -> &'a Agent {
        Agent::existing(heap).unwrap_or_else(|| Agent::new(heap))
    }

    pub(crate) fn existing<'a>(heap: &JsHeap<'a>) -> Option<&'a Agent> {
        let agent = Bun__DOM__agentOfRealm(global_of(heap));
        // SAFETY: what `serve` has put there.
        (!agent.is_empty()).then(|| unsafe { Agent::from_js_unchecked(agent) })
    }

    pub(crate) fn serve(&self, realm: &JsHeap<'_>) {
        Bun__DOM__setAgentOfRealm(global_of(realm), self.to_js());
    }

    fn new<'a>(heap: &JsHeap<'a>) -> &'a Agent {
        thread_local! {
            static FORGETS: () = bun_ui::at_end_of_worker(|| {
                super::atom::forget_cases();
                super::custom::forget_queue();
                crate::api::cssom::forget_attributes();
            });
        }
        FORGETS.with(|_| ());
        let made = js_DomAgent::create(
            heap,
            Agent {
                is_notification_queued: Cell::new(false),
                is_backup_queued: Cell::new(false),
            },
        );
        made.serve(heap);
        js_DomAgent::set_observers(made, List::new(heap).to_js());
        js_DomAgent::set_slots(made, List::new(heap).to_js());
        js_DomAgent::set_notify(
            made,
            JSFunction::create(
                global_of(heap),
                "",
                Bun__DOM__notifyObservers,
                1,
                Default::default(),
            ),
        );
        js_DomAgent::set_react(
            made,
            JSFunction::create(
                global_of(heap),
                "",
                Bun__DOM__reactLater,
                1,
                Default::default(),
            ),
        );
        js_DomAgent::set_constructing(made, List::new(heap).to_js());
        made
    }

    /// The realm that has made it, which outlives the others.
    pub(crate) fn global(&self) -> &JSGlobalObject {
        super::document::global_of_cell(self)
    }

    /// For a program whose global object is none.
    pub(crate) fn window(&self) -> Option<&WindowTarget> {
        // SAFETY: what `offer_window` has put there.
        js_DomAgent::window(self).map(|it| unsafe { WindowTarget::from_js_unchecked(it) })
    }

    pub(crate) fn offer_window(&self, window: &WindowTarget) {
        if self.window().is_none_or(WindowTarget::is_disposed) {
            js_DomAgent::set_window(self, window.to_js());
        }
    }

    /// For what a worker has of documents.
    pub(super) fn scratch<'a>(&'a self, cx: &mut JsScope<'a>, url: DomString) -> &'a Doc {
        js_DomAgent::scratch(self)
            .and_then(|it| Doc::from_js(&cx.heap, it))
            .unwrap_or_else(|| {
                let arena = Arena::new(cx.global(), 0, b"about:blank");
                let doc = Doc::create(cx, arena, None, Kind::Document, self);
                doc.set_base_url(url.clone());
                doc.set_url(url);
                doc.set_ready_state(ReadyState::Complete);
                js_DomAgent::set_scratch(self, doc.to_js());
                doc
            })
    }

    pub(super) fn observers(&self) -> List<'_> {
        List::from_value(js_DomAgent::observers(self).expect("set when it is made"))
    }

    pub(super) fn slots(&self) -> List<'_> {
        List::from_value(js_DomAgent::slots(self).expect("set when it is made"))
    }

    /// The definitions whose constructors are being called to make or upgrade an element.
    pub(super) fn constructing(&self) -> List<'_> {
        List::from_value(js_DomAgent::constructing(self).expect("set when it is made"))
    }

    pub(super) fn queue_microtask(&self, function: Option<JSValue>) {
        self.global()
            .queue_microtask(function.expect("set when it is made"), &[self.to_js()]);
    }

    pub(super) fn queue_notification(&self) {
        if !self.is_notification_queued.replace(true) {
            self.queue_microtask(js_DomAgent::notify(self));
        }
    }

    pub(super) fn queue_backup(&self) {
        if !self.is_backup_queued.replace(true) {
            self.queue_microtask(js_DomAgent::react(self));
        }
    }

    /// What it throws is reported.
    pub(crate) fn call_back(
        &self,
        cx: &mut JsScope<'_>,
        callback: JSValue,
        this: JSValue,
        arguments: &[JSValue],
    ) {
        if let Err(error) = callback.call(cx.global(), this, arguments) {
            report_for(cx, callback, error);
        }
    }
}

impl Node {
    #[inline]
    pub(crate) fn agent(&self) -> &Agent {
        // SAFETY: the document holds it.
        unsafe { &*self.arena().agent.get() }
    }
}
