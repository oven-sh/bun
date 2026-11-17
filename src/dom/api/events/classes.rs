//! The events that dispatching knows about.

use bun_jsc::bindgen::{ClassStructure, JsLocal};

use super::*;
use crate::generated_bindgen::events::{
    DesktopCustomEventInit, DesktopErrorEventInit, js_BeforeUnloadEvent,
    js_DesktopCustomEvent as js_CustomEvent, js_DesktopErrorEvent as js_ErrorEvent,
};

macro_rules! event_init {
    ($init:expr) => {
        EventInit {
            bubbles: $init.bubbles,
            cancelable: $init.cancelable,
            composed: $init.composed,
        }
    };
}
pub(crate) use event_init;

#[repr(C)]
pub(crate) struct CustomEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_CustomEvent::Fields,
}

impl CustomEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &DesktopCustomEventInit<'a>,
    ) -> &'a Self {
        let this = structure.create(
            heap,
            CustomEvent {
                base: Event::base(name, event_init!(init), Trusted::No),
                fields: Default::default(),
            },
        );
        this.set_detail(init.detail);
        this
    }

    fn set_detail(&self, detail: JsLocal<'_>) {
        js_CustomEvent::set_detail(
            self,
            if detail.is_undefined() {
                JSValue::NULL
            } else {
                detail.to_js()
            },
        );
    }

    pub(crate) fn get_detail(&self) -> JSValue {
        js_CustomEvent::detail(self).unwrap_or(JSValue::NULL)
    }

    pub(crate) fn init_custom_event(
        &self,
        name: Atom,
        bubbles: bool,
        cancelable: bool,
        detail: JsLocal<'_>,
    ) {
        if self.init(name, bubbles, cancelable) {
            self.set_detail(detail);
        }
    }
}

#[repr(C)]
pub(crate) struct ErrorEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_ErrorEvent::Fields,
    message: DomString,
    filename: DomString,
    lineno: u32,
    colno: u32,
}

#[derive(Default)]
pub(crate) struct ErrorDescription {
    pub(crate) message: DomString,
    pub(crate) filename: DomString,
    pub(crate) lineno: u32,
    pub(crate) colno: u32,
}

impl ErrorEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &DesktopErrorEventInit<'a>,
    ) -> &'a Self {
        let (base, message, filename) = (
            Event::base(name, event_init!(init), Trusted::No),
            init.message.clone(),
            init.filename.clone(),
        );
        let this = structure.create(
            heap,
            ErrorEvent {
                base,
                fields: Default::default(),
                message,
                filename,
                lineno: init.lineno,
                colno: init.colno,
            },
        );
        js_ErrorEvent::set_error(this, init.error.to_js());
        this
    }

    pub(crate) fn get_message(&self, _: &JsHeap<'_>) -> &DomString {
        &self.message
    }

    pub(crate) fn trusted<'a>(
        heap: &JsHeap<'a>,
        name: crate::api::core::Known,
        message: DomString,
        error: JSValue,
    ) -> &'a Self {
        ErrorEvent::described(
            heap,
            name,
            ErrorDescription {
                message,
                ..Default::default()
            },
            error,
        )
    }

    pub(crate) fn described<'a>(
        heap: &JsHeap<'a>,
        name: crate::api::core::Known,
        description: ErrorDescription,
        error: JSValue,
    ) -> &'a Self {
        let (
            base,
            ErrorDescription {
                message,
                filename,
                lineno,
                colno,
            },
        ) = (
            Event::base(name, Default::default(), Trusted::Yes),
            description,
        );
        let this = js_ErrorEvent::create(
            heap,
            ErrorEvent {
                base,
                fields: Default::default(),
                message,
                filename,
                lineno,
                colno,
            },
        );
        js_ErrorEvent::set_error(this, error);
        this
    }

    pub(crate) fn of_script<'a>(
        heap: &JsHeap<'a>,
        message: DomString,
        at: &bun_web::client::ScriptLocation,
        error: JSValue,
    ) -> &'a Self {
        let base = Event::base(
            atom!("error"),
            EventInit {
                cancelable: true,
                ..Default::default()
            },
            Trusted::Yes,
        );
        let filename = DomString::from_utf8(&bstr::ByteSlice::to_str_lossy(&*at.url));
        let this = js_ErrorEvent::create(
            heap,
            ErrorEvent {
                base,
                fields: Default::default(),
                message,
                filename,
                lineno: at.line,
                colno: at.column,
            },
        );
        js_ErrorEvent::set_error(this, error);
        this
    }

    pub(crate) fn get_filename(&self, _: &JsHeap<'_>) -> &DomString {
        &self.filename
    }

    pub(crate) fn get_lineno(&self) -> u32 {
        self.lineno
    }

    pub(crate) fn get_colno(&self) -> u32 {
        self.colno
    }

    pub(crate) fn get_error(&self) -> JSValue {
        js_ErrorEvent::error(self).unwrap_or(JSValue::UNDEFINED)
    }

    pub(super) fn arguments_of_handler(&self, heap: &JsHeap<'_>) -> [JSValue; 5] {
        let [lineno, colno] = [self.lineno, self.colno].map(|it| JSValue::js_number(it.into()));
        [
            self.message.to_js(heap).to_js(),
            self.filename.to_js(heap).to_js(),
            lineno,
            colno,
            self.get_error(),
        ]
    }
}

#[repr(C)]
pub(crate) struct BeforeUnloadEvent {
    pub(crate) base: Event,
    message: RefCell<DomString>,
}

impl BeforeUnloadEvent {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, name: Atom) -> &'a Self {
        let init = EventInit {
            cancelable: name != atom!(""),
            ..Default::default()
        };
        let base = Event::base(name, init, Trusted::No);
        js_BeforeUnloadEvent::create(
            heap,
            BeforeUnloadEvent {
                base,
                message: Default::default(),
            },
        )
    }

    pub(crate) fn get_message(&self, _: &JsHeap<'_>) -> DomString {
        self.message.borrow().clone()
    }

    pub(crate) fn set_message(&self, _: &JsHeap<'_>, message: DomString) {
        self.message.replace(message);
    }

    pub(super) fn set_message_unless_set(&self, message: DomString) {
        if self.message.borrow().is_empty() {
            self.message.replace(message);
        }
    }
}

/// <https://dom.spec.whatwg.org/#dom-document-createevent>
pub(crate) fn create_event<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    interface: &[u8],
) -> bindgen::Result<'a, JSValue> {
    unsafe extern "C" {
        safe fn Bun__DOM__constructWith(
            global: &bun_jsc::JSGlobalObject,
            class: JSValue,
            argument: JSValue,
        ) -> JSValue;
    }
    const CONSTRUCTED: [&str; 13] = [
        "CompositionEvent",
        "CustomEvent",
        "DeviceMotionEvent",
        "DeviceOrientationEvent",
        "DragEvent",
        "Event",
        "FocusEvent",
        "HashChangeEvent",
        "KeyboardEvent",
        "MessageEvent",
        "MouseEvent",
        "StorageEvent",
        "UIEvent",
    ];
    let lowercase = interface.to_ascii_lowercase();
    let wanted: &[u8] = match &*lowercase {
        b"events" | b"htmlevents" | b"svgevents" => b"event",
        b"mouseevents" => b"mouseevent",
        b"uievents" => b"uievent",
        it => it,
    };
    let event: &Event = match wanted {
        b"beforeunloadevent" => BeforeUnloadEvent::new(&cx.heap, Atom::EMPTY),
        b"textevent" => crate::api::ui::entry::new_text_event(&cx.heap, doc),
        _ => {
            let unknown = || {
                dom_error(
                    &cx.heap,
                    DomError::NotSupportedError,
                    &format!(
                        "The provided event type ('{}') is invalid.",
                        bstr::BStr::new(interface)
                    ),
                )
            };
            let name = CONSTRUCTED
                .iter()
                .find(|it| it.as_bytes().eq_ignore_ascii_case(wanted))
                .ok_or_else(unknown)?;
            let (class, global) = (
                cx.heap
                    .interface_object(Atom::from_latin1(name.as_bytes()).as_impl())
                    .to_js(),
                global_of(&cx.heap),
            );
            let made = bun_jsc::call_zero_is_throw(global, || {
                Bun__DOM__constructWith(global, class, Atom::EMPTY.to_js(&cx.heap).to_js())
            })?;
            Event::from_js(&cx.heap, made).expect("the constructor of an event")
        }
    };
    event.set(EventFlags::UNINITIALIZED);
    Ok(event.to_js())
}
