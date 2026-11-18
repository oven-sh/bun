//! <https://dom.spec.whatwg.org/#events>

pub(crate) mod attributes;
mod classes;
mod dispatch;
mod errors;
mod handlers;
pub(crate) mod listeners;
pub(crate) mod page_events;
mod script;
mod types;
mod window;

use core::cell::{Cell, RefCell};

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsInterface, JsScope};

pub(crate) use attributes::{handler_attribute_changed, is_handler_attribute};
pub(crate) use classes::{
    BeforeUnloadEvent, CustomEvent, ErrorDescription, ErrorEvent, create_event, event_init,
};
pub(crate) use dispatch::{
    TIMED, dispatch, dispatch_along, dispatch_below, dispatch_for_document, fire,
    twin_of_native_event,
};
pub(crate) use errors::{describe, is_parse_error_of, report_to_realm, stack_of, where_thrown};
pub(crate) use page_events::{HashChangeEvent, PageTransitionEvent, PopStateEvent};
pub(crate) use script::{
    HandlingInput, after_microtasks, as_task, call_back, call_operation_in_its_realm,
    calling_scripts, from_event_loop, microtask_checkpoint, now, queue_task_after, queue_task_for,
    report, report_exception_to, report_for, run_script, swap_top_level,
};
pub(crate) use types::{EventType, is_listened_to};
pub(crate) use window::{WindowTarget, is_fully_active, report_exception};

use crate::api::core::*;
use crate::generated_bindgen::events::{DesktopEventInit, js_DesktopEvent as js_Event};

type Cx<'c, 'a> = &'c mut JsScope<'a>;

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(crate) struct EventFlags: u16 {
        const BUBBLES = 1;
        const CANCELABLE = 1 << 1;
        const COMPOSED = 1 << 2;
        const TRUSTED = 1 << 3;
        const CANCELED = 1 << 4;
        const STOPPED = 1 << 5;
        const STOPPED_IMMEDIATELY = 1 << 6;
        const IN_PASSIVE_LISTENER = 1 << 7;
        const DISPATCHING = 1 << 8;
        const UNINITIALIZED = 1 << 9;
        const IS_MOUSE_EVENT = 1 << 10;
        /// A click that no pointer has caused.
        const HAS_NO_POSITION = 1 << 11;
        /// <https://w3c.github.io/IndexedDB/#fire-success-event>
        const LISTENER_THREW = 1 << 12;
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct EventInit {
    pub(crate) bubbles: bool,
    pub(crate) cancelable: bool,
    pub(crate) composed: bool,
}

impl From<&DesktopEventInit> for EventInit {
    fn from(init: &DesktopEventInit) -> EventInit {
        EventInit {
            bubbles: init.bubbles,
            cancelable: init.cancelable,
            composed: init.composed,
        }
    }
}

impl EventInit {
    fn flags(self) -> EventFlags {
        EventFlags::from_bits_retain(
            u16::from(self.bubbles)
                | u16::from(self.cancelable) << 1
                | u16::from(self.composed) << 2,
        )
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Trusted {
    No,
    Yes,
}

#[derive(Clone, Copy)]
enum Phase {
    None,
    Capturing,
    AtTarget,
    Bubbling,
}

#[repr(C)]
pub(crate) struct Event {
    name: RefCell<Atom>,
    time: Cell<f64>,
    /// In the frame of `Path::run`, or null.
    path: Cell<*const ()>,
    flags: Cell<EventFlags>,
    phase: Cell<Phase>,
}

fn field(value: Option<JSValue>) -> JSValue {
    value.unwrap_or_default()
}

impl Event {
    /// For the struct of an interface that extends it.
    pub(crate) fn base(name: impl Into<Atom>, init: EventInit, trusted: Trusted) -> Event {
        let flags = init.flags()
            | if trusted == Trusted::Yes {
                EventFlags::TRUSTED
            } else {
                EventFlags::empty()
            };
        Event {
            name: name.into().into(),
            time: now().into(),
            path: core::ptr::null::<()>().into(),
            flags: flags.into(),
            phase: Phase::None.into(),
        }
    }

    pub(crate) fn new<'a>(heap: &JsHeap<'a>, name: impl Into<Atom>, init: EventInit) -> &'a Event {
        js_Event::create(heap, Event::base(name, init, Trusted::Yes))
    }

    pub(crate) fn constructor(name: Atom, init: &DesktopEventInit) -> Event {
        Event::base(name, init.into(), Trusted::No)
    }

    #[inline]
    pub(crate) fn has(&self, flags: EventFlags) -> bool {
        self.flags.get().intersects(flags)
    }

    #[inline]
    pub(crate) fn set(&self, flags: EventFlags) {
        self.flags.update(|it| it | flags);
    }

    #[inline]
    fn unset(&self, flags: EventFlags) {
        self.flags.update(|it| it - flags);
    }

    /// `Known::Other` for what scripts have made up.
    #[inline]
    pub(crate) fn name(&self) -> Known {
        self.name.borrow().known()
    }

    pub(crate) fn is_trusted(&self) -> bool {
        self.has(EventFlags::TRUSTED)
    }

    /// On the clock of `now`.
    pub(crate) fn time(&self) -> f64 {
        self.time.get()
    }

    pub(crate) fn set_time(&self, time: f64) {
        self.time.set(time);
    }

    /// What listeners get.
    #[inline]
    fn exposed(&self) -> JSValue {
        js_Event::native(self).unwrap_or_else(|| self.to_js())
    }

    pub(crate) fn target(&self) -> Option<JSValue> {
        js_Event::target(self)
    }

    /// Of one that is not dispatched.
    pub(crate) fn set_target(&self, target: Option<JSValue>) {
        js_Event::set_target(self, field(target));
    }

    pub(crate) fn target_node(&self) -> Option<&Node> {
        Node::in_field(js_Event::target(self))
    }

    pub(crate) fn current_node(&self) -> Option<&Node> {
        Node::in_field(js_Event::current_target(self))
    }

    pub(crate) fn related_node(&self) -> Option<&Node> {
        Node::in_field(js_Event::related_target(self))
    }

    pub(crate) fn related_target(&self) -> Option<JSValue> {
        js_Event::related_target(self)
    }

    pub(crate) fn set_related_target(&self, target: Option<JSValue>) {
        js_Event::set_related_target(self, field(target));
    }

    pub(crate) fn set_related_node(&self, node: Option<&Node>) {
        self.set_related_target(node.map(Node::to_js));
    }

    pub(crate) fn pseudo_target(&self) -> Option<JSValue> {
        js_Event::pseudo_target(self)
    }

    pub(crate) fn trust(&self) {
        self.set(EventFlags::TRUSTED);
    }

    /// <https://dom.spec.whatwg.org/#set-the-canceled-flag>
    pub(crate) fn cancel(&self) {
        if self.has(EventFlags::CANCELABLE) && !self.has(EventFlags::IN_PASSIVE_LISTENER) {
            self.set(EventFlags::CANCELED);
        }
    }

    /// False while it is being dispatched.
    pub(crate) fn init(&self, name: Atom, bubbles: bool, cancelable: bool) -> bool {
        let is_idle = !self.has(EventFlags::DISPATCHING);
        if is_idle {
            self.name.replace(name);
            self.flags.update(|it| {
                it & (EventFlags::IS_MOUSE_EVENT | EventFlags::COMPOSED)
                    | EventInit {
                        bubbles,
                        cancelable,
                        composed: false,
                    }
                    .flags()
            });
            js_Event::set_target(self, JSValue::ZERO);
        }
        is_idle
    }

    pub(crate) fn init_event(&self, name: Atom, bubbles: bool, cancelable: bool) {
        self.init(name, bubbles, cancelable);
    }

    pub(crate) fn get_type(&self, _: &JsHeap<'_>) -> Atom {
        self.name.borrow().clone()
    }

    pub(crate) fn get_event_phase(&self) -> u16 {
        self.phase.get() as u16
    }

    pub(crate) fn get_bubbles(&self) -> bool {
        self.has(EventFlags::BUBBLES)
    }

    pub(crate) fn get_cancelable(&self) -> bool {
        self.has(EventFlags::CANCELABLE)
    }

    pub(crate) fn get_composed(&self) -> bool {
        self.has(EventFlags::COMPOSED)
    }

    pub(crate) fn get_trusted(&self) -> bool {
        self.is_trusted()
    }

    pub(crate) fn get_default_prevented(&self) -> bool {
        self.has(EventFlags::CANCELED)
    }

    pub(crate) fn get_time_stamp(&self, heap: &JsHeap<'_>) -> f64 {
        let origin =
            WindowTarget::of_realm(self.realm(heap)).map_or(0.0, WindowTarget::time_origin);
        ((self.time.get() - origin) * 10.0).floor() / 10.0
    }

    pub(crate) fn get_cancel_bubble(&self) -> bool {
        self.has(EventFlags::STOPPED)
    }

    pub(crate) fn set_cancel_bubble(&self, value: bool) {
        if value {
            self.stop_propagation();
        }
    }

    pub(crate) fn get_return_value(&self) -> bool {
        !self.has(EventFlags::CANCELED)
    }

    pub(crate) fn set_return_value(&self, value: bool) {
        if !value {
            self.cancel();
        }
    }

    pub(crate) fn stop_propagation(&self) {
        self.set(EventFlags::STOPPED);
    }

    pub(crate) fn stop_immediate_propagation(&self) {
        self.set(EventFlags::STOPPED | EventFlags::STOPPED_IMMEDIATELY);
    }
}

impl Node {
    /// Of what lives as long as the result.
    fn in_field<'a>(value: Option<JSValue>) -> Option<&'a Node> {
        // SAFETY: it is a node, which the reference holds while it is on the stack.
        value
            .filter(|it| <Node as JsInterface>::is(*it))
            .map(|it| unsafe { Node::from_js_unchecked(it) })
    }
}

impl PartialEq for EventTarget {
    #[inline(always)]
    fn eq(&self, other: &EventTarget) -> bool {
        core::ptr::eq(self, other)
    }
}

impl EventTarget {
    #[inline]
    pub(crate) fn as_node(&self) -> Option<&Node> {
        JsInterface::downcast(self)
    }

    #[inline]
    pub(crate) fn as_window(&self) -> Option<&WindowTarget> {
        JsInterface::downcast(self)
    }

    /// What scripts know it as.
    #[inline]
    pub(crate) fn exposed(&self) -> JSValue {
        self.as_window()
            .map_or_else(|| self.to_js(), WindowTarget::window)
    }

    /// The other way round.
    pub(crate) fn resolve<'a>(heap: &JsHeap<'a>, value: JSValue) -> Option<&'a EventTarget> {
        EventTarget::from_js(heap, value).or_else(|| WindowTarget::of(heap, value).map(|it| &**it))
    }

    pub(crate) fn constructor() -> EventTarget {
        EventTarget::default()
    }
}
