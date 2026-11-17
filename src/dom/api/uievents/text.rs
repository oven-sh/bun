use core::cell::RefCell;

use super::*;
use crate::api::transfer::DataTransfer;
use crate::generated_bindgen::uievents::{
    CompositionEventInit, InputEventInit, KeyboardEventInit, js_CompositionEvent, js_InputEvent,
    js_KeyboardEvent, js_TextEvent,
};

#[derive(Clone)]
pub(crate) struct Keyboard {
    pub(crate) key: Atom,
    pub(crate) code: Atom,
    pub(crate) location: u32,
    pub(crate) repeat: bool,
    pub(crate) is_composing: bool,
    pub(crate) char_code: u32,
    pub(crate) key_code: u32,
    pub(crate) modifiers: Modifiers,
}

#[repr(C)]
pub(crate) struct KeyboardEvent {
    pub(crate) base: UIEvent,
    keyboard: RefCell<Keyboard>,
    location: Cell<u32>,
    modifiers: Cell<Modifiers>,
}

modifier_getters!(KeyboardEvent);

impl KeyboardEvent {
    fn from_base(base: UIEvent, keyboard: Keyboard) -> KeyboardEvent {
        base.which.set(
            [base.which.get(), keyboard.key_code, keyboard.char_code]
                .into_iter()
                .find(|it| *it != 0)
                .unwrap_or(0),
        );
        KeyboardEvent {
            base,
            location: keyboard.location.into(),
            modifiers: keyboard.modifiers.into(),
            keyboard: keyboard.into(),
        }
    }

    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        name: Known,
        keyboard: Keyboard,
    ) -> &'a KeyboardEvent {
        let base = UIEvent::base(
            name,
            EventInit {
                cancelable: true,
                ..COMPOSED
            },
            Trusted::Yes,
            0,
            0,
        );
        let this =
            js_KeyboardEvent::create(doc.heap(heap), KeyboardEvent::from_base(base, keyboard));
        this.set_view(host::window(doc));
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &KeyboardEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let keyboard = Keyboard {
            key: init.key.clone(),
            code: init.code.clone(),
            location: init.location,
            repeat: init.repeat,
            is_composing: init.is_composing,
            char_code: init.char_code,
            key_code: init.key_code,
            modifiers: modifiers!(init),
        };
        let this = structure.create(
            heap,
            KeyboardEvent::from_base(ui_base!(name, init), keyboard),
        );
        this.set_view(window(heap, init.view)?);
        Ok(this)
    }

    /// `Other` for most characters.
    pub(crate) fn key(&self) -> Known {
        self.keyboard.borrow().key.known()
    }

    pub(crate) fn modifiers(&self) -> Modifiers {
        self.modifiers.get()
    }

    pub(crate) fn get_modifier_state(&self, key: &DomString) -> bool {
        self.modifiers().has_named(key)
    }

    pub(crate) fn get_key(&self) -> Atom {
        self.keyboard.borrow().key.clone()
    }

    pub(crate) fn get_code(&self) -> Atom {
        self.keyboard.borrow().code.clone()
    }

    pub(crate) fn get_location(&self) -> u32 {
        self.location.get()
    }

    pub(crate) fn get_repeat(&self) -> bool {
        self.keyboard.borrow().repeat
    }

    pub(crate) fn get_is_composing(&self) -> bool {
        self.keyboard.borrow().is_composing
    }

    pub(crate) fn get_char_code(&self) -> u32 {
        self.keyboard.borrow().char_code
    }

    pub(crate) fn get_key_code(&self) -> u32 {
        self.keyboard.borrow().key_code
    }

    #[expect(clippy::too_many_arguments, clippy::fn_params_excessive_bools)]
    pub(crate) fn init_keyboard_event<'a>(
        &self,
        heap: &JsHeap<'a>,
        name: Atom,
        bubbles: bool,
        cancelable: bool,
        view: Object<'a>,
        key: Atom,
        location: u32,
        ctrl: bool,
        alt: bool,
        shift: bool,
        meta: bool,
    ) -> bindgen::Result<'a, ()> {
        if self.base.init(heap, name, bubbles, cancelable, view, 0)? {
            self.keyboard.borrow_mut().key = key;
            self.location.set(location);
            self.modifiers
                .set(Modifiers::from_bools(&[shift, ctrl, alt, meta]));
        }
        Ok(())
    }
}

/// What differs between `InputEvent`s of one type.
#[derive(Clone, Default)]
pub(crate) struct InputDetails<'a> {
    pub(crate) data: Option<DomString>,
    pub(crate) data_transfer: Option<&'a DataTransfer>,
    pub(crate) is_composing: bool,
}

#[repr(C)]
pub(crate) struct InputEvent {
    pub(crate) base: UIEvent,
    pub(crate) fields: js_InputEvent::Fields,
    data: Option<DomString>,
    input_type: Atom,
    is_composing: bool,
}

slots!(InputEvent = js_InputEvent {} [target_ranges: Range,]);
slots!(InputEvent = js_InputEvent set { data_transfer: DataTransfer, });

impl InputEvent {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        name: Known,
        init: EventInit,
        input_type: Known,
        details: &InputDetails<'_>,
    ) -> &'a InputEvent {
        let this = InputEvent {
            base: UIEvent::base(name, init, Trusted::Yes, 0, 0),
            fields: Default::default(),
            data: details.data.clone(),
            input_type: input_type.into(),
            is_composing: details.is_composing,
        };
        let this = js_InputEvent::create(doc.heap(heap), this);
        this.set_view(host::window(doc));
        this.set_data_transfer(details.data_transfer);
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &InputEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let this = structure.create(
            heap,
            InputEvent {
                base: ui_base!(name, init),
                fields: Default::default(),
                data: init.data.clone(),
                input_type: init.input_type.clone(),
                is_composing: init.is_composing,
            },
        );
        this.set_view(window(heap, init.view)?);
        this.set_data_transfer(init.data_transfer);
        let mut ranges = Refs::default();
        for range in init.target_ranges.into_iter().flatten() {
            if [range.start(), range.end()]
                .iter()
                .any(|it| it.offset > it.node.length())
            {
                return Err(dom_error(
                    heap,
                    DomError::IndexSizeError,
                    "The offset is larger than the length of the node.",
                ));
            }
            ranges.push(heap, Range::new(heap, range.start(), range.end()));
        }
        this.set_target_ranges(ranges);
        Ok(this)
    }

    pub(crate) fn get_data(&self) -> Option<&DomString> {
        self.data.as_ref()
    }

    pub(crate) fn get_is_composing(&self) -> bool {
        self.is_composing
    }

    pub(crate) fn get_input_type(&self) -> &Atom {
        &self.input_type
    }

    pub(crate) fn get_target_ranges<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, JSValue> {
        let frozen = |heap: &JsHeap<'a>, it: &Range| {
            Ok(JsLocal::new(
                heap,
                range::static_range(heap, it.start(), it.end()).to_js(),
            ))
        };
        Ok(heap
            .create_array(self.target_ranges().iter(), frozen)?
            .to_js())
    }
}

macro_rules! events_with_data {
    ($($class:ident, $js:ident, $init:ident;)+) => {$(
        #[repr(C)]
        pub(crate) struct $class {
            pub(crate) base: UIEvent,
            data: RefCell<DomString>,
        }

        impl $class {
            pub(crate) fn new<'a>(heap: &JsHeap<'a>, doc: &Doc, name: Known, init: EventInit, trusted: Trusted, data: DomString) -> &'a Event {
                let this = $js::create(doc.heap(heap), $class { base: UIEvent::base(name, init, trusted, 0, 0), data: data.into() });
                this.set_view(host::window(doc).filter(|_| trusted == Trusted::Yes));
                this
            }

            pub(crate) fn get_data(&self) -> DomString {
                self.data.borrow().clone()
            }

            pub(crate) fn $init<'a>(&self, heap: &JsHeap<'a>, name: Atom, bubbles: bool, cancelable: bool, view: Object<'a>, data: DomString) -> bindgen::Result<'a, ()> {
                if self.base.init(heap, name, bubbles, cancelable, view, 0)? {
                    self.data.replace(data);
                }
                Ok(())
            }
        }
    )+};
}
events_with_data! {
    CompositionEvent, js_CompositionEvent, init_composition_event;
    TextEvent, js_TextEvent, init_text_event;
}

impl CompositionEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &CompositionEventInit<'a>,
    ) -> bindgen::Result<'a, &'a Self> {
        let this = structure.create(
            heap,
            CompositionEvent {
                base: ui_base!(name, init),
                data: init.data.clone().into(),
            },
        );
        this.set_view(window(heap, init.view)?);
        Ok(this)
    }
}
