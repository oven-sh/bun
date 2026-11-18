//! https://w3c.github.io/uievents/, and the other events that the user causes.

mod mouse;
mod simple;
mod text;
mod touch;

use core::cell::Cell;

use bun_jsc::JSObject;

use crate::api::events::EventFlags;
use crate::api::ui::prelude::*;
pub(crate) use crate::generated_bindgen::uievents::{FocusEvent, TouchList};
use crate::generated_bindgen::uievents::{FocusEventInit, UIEventInit, js_FocusEvent, js_UIEvent};
pub(crate) use {mouse::*, simple::*, text::*, touch::*};

bitflags::bitflags! {
    /// As the library has them.
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub(crate) struct Modifiers: u32 {
        const SHIFT = 1;
        const CONTROL = 1 << 1;
        const ALT = 1 << 2;
        const META = 1 << 3;
        const ALT_GRAPH = 1 << 4;
        const CAPS_LOCK = 1 << 5;
        const FN = 1 << 6;
        const FN_LOCK = 1 << 7;
        const HYPER = 1 << 8;
        const NUM_LOCK = 1 << 9;
        const SCROLL_LOCK = 1 << 10;
        const SUPER = 1 << 11;
        const SYMBOL = 1 << 12;
        const SYMBOL_LOCK = 1 << 13;
    }
}

impl Modifiers {
    fn from_bools(values: &[bool]) -> Modifiers {
        Modifiers::from_bits_retain(
            values
                .iter()
                .rev()
                .fold(0, |all, it| all << 1 | u32::from(*it)),
        )
    }

    fn has_named(self, key: &DomString) -> bool {
        const NAMES: [&str; 14] = [
            "Shift",
            "Control",
            "Alt",
            "Meta",
            "AltGraph",
            "CapsLock",
            "Fn",
            "FnLock",
            "Hyper",
            "NumLock",
            "ScrollLock",
            "Super",
            "Symbol",
            "SymbolLock",
        ];
        NAMES
            .iter()
            .position(|it| key.eq_str(it))
            .is_some_and(|it| self.bits() >> it & 1 != 0)
    }
}

macro_rules! event_init {
    ($init:expr) => {
        EventInit {
            bubbles: $init.bubbles,
            cancelable: $init.cancelable,
            composed: $init.composed,
        }
    };
}

macro_rules! modifiers {
    ($it:expr) => {
        Modifiers::from_bools(&[
            $it.shift_key,
            $it.ctrl_key,
            $it.alt_key,
            $it.meta_key,
            $it.modifier_alt_graph,
            $it.modifier_caps_lock,
            $it.modifier_fn,
            $it.modifier_fn_lock,
            $it.modifier_hyper,
            $it.modifier_num_lock,
            $it.modifier_scroll_lock,
            $it.modifier_super,
            $it.modifier_symbol,
            $it.modifier_symbol_lock,
        ])
    };
}

macro_rules! modifier_getters {
    ($class:ty) => {
        impl $class {
            pub(crate) fn get_shift_key(&self) -> bool {
                self.modifiers().contains(Modifiers::SHIFT)
            }
            pub(crate) fn get_ctrl_key(&self) -> bool {
                self.modifiers().contains(Modifiers::CONTROL)
            }
            pub(crate) fn get_alt_key(&self) -> bool {
                self.modifiers().contains(Modifiers::ALT)
            }
            pub(crate) fn get_meta_key(&self) -> bool {
                self.modifiers().contains(Modifiers::META)
            }
        }
    };
}

/// The `UIEvent` in the payload of one that a script makes.
macro_rules! ui_base {
    ($name:expr, $init:expr) => {
        UIEvent::base(
            $name,
            event_init!($init),
            Trusted::No,
            $init.detail,
            $init.which,
        )
    };
}
use {event_init, modifier_getters, modifiers, ui_base};

type Object<'a> = Option<JsLocal<'a, JSObject>>;

fn window<'a>(heap: &JsHeap<'a>, view: Object<'a>) -> bindgen::Result<'a, Option<JSValue>> {
    match view.map(JsLocal::to_js) {
        Some(view) if !host::is_window(heap, view) => {
            Err(heap.type_error(format_args!("The provided value is not of type 'Window'.")))
        }
        view => Ok(view),
    }
}

fn event_target<'a>(heap: &JsHeap<'a>, target: Object<'a>) -> bindgen::Result<'a, Option<JSValue>> {
    match target.map(JsLocal::to_js) {
        Some(target) if EventTarget::resolve(heap, target).is_none() => Err(heap.type_error(
            format_args!("The provided value is not of type 'EventTarget'."),
        )),
        target => Ok(target),
    }
}

#[repr(C)]
pub(crate) struct UIEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_UIEvent::Fields,
    detail: Cell<i32>,
    which: Cell<u32>,
}

impl UIEvent {
    fn base(
        name: impl Into<Atom>,
        init: EventInit,
        trusted: Trusted,
        detail: i32,
        which: u32,
    ) -> UIEvent {
        UIEvent {
            base: Event::base(name, init, trusted),
            fields: Default::default(),
            detail: detail.into(),
            which: which.into(),
        }
    }

    fn set_view(&self, view: Option<JSValue>) {
        js_UIEvent::set_view(self, view.unwrap_or_default());
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &UIEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let this = structure.create(heap, ui_base!(name, init));
        this.set_view(window(heap, init.view)?);
        Ok(this)
    }

    pub(crate) fn get_detail(&self) -> i32 {
        self.detail.get()
    }

    pub(crate) fn get_which(&self) -> u32 {
        self.which.get()
    }

    pub(crate) fn get_source_capabilities(&self) -> JSValue {
        JSValue::NULL
    }

    /// False while it is being dispatched.
    fn init<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: Atom,
        bubbles: bool,
        cancelable: bool,
        view: Object<'a>,
        detail: i32,
    ) -> bindgen::Result<'a, bool> {
        let view = window(heap, view)?;
        let is_idle = self.base.init(name, bubbles, cancelable);
        if is_idle {
            self.set_view(view);
            self.detail.set(detail);
        }
        Ok(is_idle)
    }

    pub(crate) fn init_ui_event<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: Atom,
        bubbles: bool,
        cancelable: bool,
        view: Object<'a>,
        detail: i32,
    ) -> bindgen::Result<'a, ()> {
        self.init(heap, name, bubbles, cancelable, view, detail)
            .map(drop)
    }

    pub(crate) fn get_pseudo_target(&self) -> JSValue {
        self.pseudo_target().unwrap_or(JSValue::NULL)
    }
}

impl FocusEvent {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        name: Known,
        init: EventInit,
        related: Option<&Element>,
    ) -> &'a Event {
        let this = js_FocusEvent::create(
            doc.heap(heap),
            UIEvent::base(name, init, Trusted::Yes, 0, 0),
        );
        this.set_view(host::window(doc));
        this.set_related_node(related.map(|it| &**it));
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &FocusEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let this = structure.create(heap, ui_base!(name, init));
        this.set_view(window(heap, init.view)?);
        this.set_related_target(event_target(heap, init.related_target)?);
        Ok(this)
    }
}
