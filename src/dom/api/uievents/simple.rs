use super::*;
use crate::api::transfer::DataTransfer;
use crate::generated_bindgen::uievents::*;

/// An event with one object.
macro_rules! events_about {
    ($($class:ident, $init:ident, $js:ident, $field:ident: $type:ty;)+) => {$(
        #[repr(C)]
        pub(crate) struct $class {
            pub(crate) base: Event,
            pub(crate) fields: $js::Fields,
        }

        slots!($class = $js set { $field: $type, });

        paste::paste! { impl $class {
            pub(crate) fn constructor<'a>(heap: &JsHeap<'a>, structure: ClassStructure<'a, Self>, name: Atom, init: &$init<'a>) -> &'a Self {
                let base = Event::base(name, event_init!(init), Trusted::No);
                let this = structure.create(heap, $class { base, fields: Default::default() });
                this.[<set_ $field>](init.$field.map(|it| -> &$type { it }));
                this
            }
        } }
    )+};
}
events_about! {
    ClipboardEvent, ClipboardEventInit, js_ClipboardEvent, clipboard_data: DataTransfer;
    InterestEvent, InterestEventInit, js_InterestEvent, source: Element;
    SubmitEvent, SubmitEventInit, js_SubmitEvent, submitter: Element;
}

macro_rules! fired {
    ($($class:ident, $js:ident, $set:ident: $type:ty;)+) => {$(
        impl $class {
            pub(crate) fn new<'a>(heap: &JsHeap<'a>, doc: &Doc, name: Known, init: EventInit, about: Option<&$type>) -> &'a Event {
                let this = $js::create(doc.heap(heap), $class { base: Event::base(name, init, Trusted::Yes), fields: Default::default() });
                this.$set(about);
                this
            }
        }
    )+};
}
fired! {
    ClipboardEvent, js_ClipboardEvent, set_clipboard_data: DataTransfer;
    SubmitEvent, js_SubmitEvent, set_submitter: Element;
}

fn retargeted<'a>(source: Option<&'a Element>, event: &Event) -> Option<&'a Node> {
    Some(source?.retarget(event.current_node()))
}

#[repr(C)]
pub(crate) struct ToggleEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_ToggleEvent::Fields,
    old_state: Atom,
    new_state: Atom,
}

slots!(ToggleEvent = js_ToggleEvent { source: Element });

impl ToggleEvent {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        name: Known,
        init: EventInit,
        [old, new]: [Known; 2],
        source: Option<&Element>,
    ) -> &'a Event {
        let base = Event::base(name, init, Trusted::Yes);
        let this = js_ToggleEvent::create(
            doc.heap(heap),
            ToggleEvent {
                base,
                fields: Default::default(),
                old_state: old.into(),
                new_state: new.into(),
            },
        );
        this.set_source(source);
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &ToggleEventInit<'a>,
    ) -> &'a Self {
        let this = structure.create(
            heap,
            ToggleEvent {
                base: Event::base(name, event_init!(init), Trusted::No),
                fields: Default::default(),
                old_state: init.old_state.clone(),
                new_state: init.new_state.clone(),
            },
        );
        this.set_source(init.source);
        this
    }

    pub(crate) fn get_old_state(&self) -> &Atom {
        &self.old_state
    }

    pub(crate) fn get_new_state(&self) -> &Atom {
        &self.new_state
    }

    pub(crate) fn get_source(&self) -> Option<&Node> {
        retargeted(self.source(), self)
    }
}

#[repr(C)]
pub(crate) struct CommandEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_CommandEvent::Fields,
    command: DomString,
}

slots!(CommandEvent = js_CommandEvent { source: Element });

impl CommandEvent {
    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        doc: &Doc,
        command: DomString,
        source: &Element,
    ) -> &'a Event {
        let base = Event::base(
            atom!("command"),
            EventInit {
                composed: true,
                ..CANCELABLE
            },
            Trusted::Yes,
        );
        let this = js_CommandEvent::create(
            doc.heap(heap),
            CommandEvent {
                base,
                fields: Default::default(),
                command,
            },
        );
        this.set_source(Some(source));
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &CommandEventInit<'a>,
    ) -> &'a Self {
        let base = Event::base(name, event_init!(init), Trusted::No);
        let this = structure.create(
            heap,
            CommandEvent {
                base,
                fields: Default::default(),
                command: init.command.clone(),
            },
        );
        this.set_source(init.source);
        this
    }

    pub(crate) fn get_command(&self) -> &DomString {
        &self.command
    }

    pub(crate) fn get_source(&self) -> Option<&Node> {
        retargeted(self.source(), self)
    }
}

#[repr(C)]
pub(crate) struct FormDataEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_FormDataEvent::Fields,
}

impl FormDataEvent {
    pub(crate) fn new<'a>(heap: &JsHeap<'a>, doc: &Doc, data: JSValue) -> &'a Event {
        let base = Event::base(atom!("formdata"), BUBBLES, Trusted::Yes);
        let this = js_FormDataEvent::create(
            doc.heap(heap),
            FormDataEvent {
                base,
                fields: Default::default(),
            },
        );
        js_FormDataEvent::set_form_data(this, data);
        this
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &FormDataEventInit<'a>,
    ) -> &'a Self {
        let base = Event::base(name, event_init!(init), Trusted::No);
        let this = structure.create(
            heap,
            FormDataEvent {
                base,
                fields: Default::default(),
            },
        );
        js_FormDataEvent::set_form_data(this, init.form_data.to_js());
        this
    }
}
