//! The events about a page as a whole.

use bun_jsc::bindgen::ClassStructure;

use super::classes::event_init;
use super::*;
use crate::generated_bindgen::page_events::*;

macro_rules! getters {
    ($class:ident: $($field:ident: $type:ty),+) => {
        paste::paste! { impl $class {$(
            pub(crate) fn [<get_ $field>](&self) -> $type {
                self.$field
            }
        )+} }
    };
}

/// Their members are those of their dictionaries.
macro_rules! plain_events {
    ($($class:ident($init:ident) { $($field:ident: $type:ty),+ })+) => {$(
        #[repr(C)]
        pub(crate) struct $class {
            pub(crate) base: Event,
            $($field: $type,)+
        }

        impl $class {
            pub(crate) fn constructor<'a>(heap: &JsHeap<'a>, structure: ClassStructure<'a, Self>, name: Atom, init: &$init) -> &'a Self {
                structure.create(heap, $class { base: Event::base(name, event_init!(init), Trusted::No), $($field: init.$field),+ })
            }
        }

        getters!($class: $($field: $type),+);
    )+};
}
plain_events! {
    PageTransitionEvent(PageTransitionEventInit) { persisted: bool }
    DeviceOrientationEvent(DeviceOrientationEventInit) { alpha: Option<f64>, beta: Option<f64>, gamma: Option<f64>, absolute: bool }
}

#[repr(C)]
pub(crate) struct HashChangeEvent {
    pub(crate) base: Event,
    old_url: DomString,
    new_url: DomString,
}

impl PageTransitionEvent {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, name: crate::api::core::Known) -> &'a Self {
        let base = Event::base(
            name,
            EventInit {
                bubbles: true,
                cancelable: true,
                composed: false,
            },
            Trusted::Yes,
        );
        js_PageTransitionEvent::create(
            heap,
            PageTransitionEvent {
                base,
                persisted: false,
            },
        )
    }
}

impl HashChangeEvent {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, old_url: DomString, new_url: DomString) -> &'a Self {
        js_HashChangeEvent::create(
            heap,
            HashChangeEvent {
                base: Event::base(atom!("hashchange"), Default::default(), Trusted::Yes),
                old_url,
                new_url,
            },
        )
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &HashChangeEventInit<'a>,
    ) -> &'a Self {
        let base = Event::base(name, event_init!(init), Trusted::No);
        structure.create(
            heap,
            HashChangeEvent {
                base,
                old_url: init.old_url.into(),
                new_url: init.new_url.into(),
            },
        )
    }

    pub(crate) fn get_old_url(&self) -> &DomString {
        &self.old_url
    }

    pub(crate) fn get_new_url(&self) -> &DomString {
        &self.new_url
    }
}

#[repr(C)]
pub(crate) struct PopStateEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_PopStateEvent::Fields,
    has_visual_transition: bool,
}

getters!(PopStateEvent: has_visual_transition: bool);

impl PopStateEvent {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, state: JSValue) -> &'a Self {
        let base = Event::base(atom!("popstate"), Default::default(), Trusted::Yes);
        let this = js_PopStateEvent::create(
            heap,
            PopStateEvent {
                base,
                fields: Default::default(),
                has_visual_transition: false,
            },
        );
        js_PopStateEvent::set_state(this, state);
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &PopStateEventInit<'a>,
    ) -> &'a Self {
        let base = Event::base(name, event_init!(init), Trusted::No);
        let this = structure.create(
            heap,
            PopStateEvent {
                base,
                fields: Default::default(),
                has_visual_transition: init.has_ua_visual_transition,
            },
        );
        js_PopStateEvent::set_state(this, init.state.to_js());
        this
    }

    pub(crate) fn get_state(&self) -> JSValue {
        js_PopStateEvent::state(self)
            .filter(|it| !it.is_undefined())
            .unwrap_or(JSValue::NULL)
    }
}

#[repr(C)]
pub(crate) struct PromiseRejectionEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_PromiseRejectionEvent::Fields,
}

impl PromiseRejectionEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &PromiseRejectionEventInit<'a>,
    ) -> &'a Self {
        let this = structure.create(
            heap,
            PromiseRejectionEvent {
                base: Event::base(name, event_init!(init), Trusted::No),
                fields: Default::default(),
            },
        );
        js_PromiseRejectionEvent::set_promise(this, init.promise.to_js());
        js_PromiseRejectionEvent::set_reason(this, init.reason.to_js());
        this
    }

    pub(super) fn trusted<'a>(
        heap: &JsHeap<'a>,
        name: Known,
        promise: JSValue,
        reason: JSValue,
    ) -> &'a Self {
        let init = EventInit {
            cancelable: name == atom!("unhandledrejection"),
            ..Default::default()
        };
        let this = js_PromiseRejectionEvent::create(
            heap,
            PromiseRejectionEvent {
                base: Event::base(name, init, Trusted::Yes),
                fields: Default::default(),
            },
        );
        js_PromiseRejectionEvent::set_promise(this, promise);
        js_PromiseRejectionEvent::set_reason(this, reason);
        this
    }

    pub(crate) fn get_reason(&self) -> JSValue {
        js_PromiseRejectionEvent::reason(self).unwrap_or(JSValue::UNDEFINED)
    }
}

#[repr(C)]
pub(crate) struct GamepadEvent {
    pub(crate) base: Event,
}

impl GamepadEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &DesktopEventInit,
    ) -> &'a Self {
        structure.create(
            heap,
            GamepadEvent {
                base: Event::base(name, event_init!(init), Trusted::No),
            },
        )
    }

    pub(crate) fn get_gamepad(&self) -> JSValue {
        JSValue::NULL
    }
}

pub(crate) struct Acceleration {
    x: Option<f64>,
    y: Option<f64>,
    z: Option<f64>,
}

getters!(Acceleration: x: Option<f64>, y: Option<f64>, z: Option<f64>);

pub(crate) struct RotationRate {
    alpha: Option<f64>,
    beta: Option<f64>,
    gamma: Option<f64>,
}

getters!(RotationRate: alpha: Option<f64>, beta: Option<f64>, gamma: Option<f64>);

#[repr(C)]
pub(crate) struct DeviceMotionEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_DeviceMotionEvent::Fields,
    interval: f64,
}

getters!(DeviceMotionEvent: interval: f64);

impl DeviceMotionEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &DeviceMotionEventInit,
    ) -> &'a Self {
        let base = Event::base(name, event_init!(init), Trusted::No);
        let this = structure.create(
            heap,
            DeviceMotionEvent {
                base,
                fields: Default::default(),
                interval: init.interval,
            },
        );
        let acceleration = |it: &AccelerationInit| {
            js_DeviceMotionEventAcceleration::create(
                heap,
                Acceleration {
                    x: it.x,
                    y: it.y,
                    z: it.z,
                },
            )
            .to_js()
        };
        let rotation = |it: &RotationRateInit| {
            js_DeviceMotionEventRotationRate::create(
                heap,
                RotationRate {
                    alpha: it.alpha,
                    beta: it.beta,
                    gamma: it.gamma,
                },
            )
            .to_js()
        };
        js_DeviceMotionEvent::set_acceleration(
            this,
            init.acceleration
                .as_ref()
                .map_or(JSValue::NULL, acceleration),
        );
        js_DeviceMotionEvent::set_acceleration_including_gravity(
            this,
            init.acceleration_including_gravity
                .as_ref()
                .map_or(JSValue::NULL, acceleration),
        );
        js_DeviceMotionEvent::set_rotation_rate(
            this,
            init.rotation_rate.as_ref().map_or(JSValue::NULL, rotation),
        );
        this
    }
}
