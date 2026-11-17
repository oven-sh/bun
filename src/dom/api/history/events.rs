//! The events that only have the members of their dictionaries.

use super::*;
use crate::api::transition::ViewTransition;

macro_rules! from_init {
    ($name:ident, $init:ident) => {
        Event::base(
            $name,
            EventInit {
                bubbles: $init.bubbles,
                cancelable: $init.cancelable,
                composed: $init.composed,
            },
            Trusted::No,
        )
    };
}

#[repr(C)]
pub(crate) struct NavigationCurrentEntryChangeEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_NavigationCurrentEntryChangeEvent::Fields,
    kind: Option<NavigationType>,
}

impl NavigationCurrentEntryChangeEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &NavigationCurrentEntryChangeEventInit<'a>,
    ) -> &'a Self {
        let this = structure.create(
            heap,
            Self {
                base: from_init!(name, init),
                fields: Default::default(),
                kind: init.navigation_type,
            },
        );
        js_NavigationCurrentEntryChangeEvent::set_from(this, init.from.to_js());
        this
    }

    pub(super) fn new<'a>(
        heap: &JsHeap<'a>,
        kind: Option<NavigationType>,
        from: &'a NavigationHistoryEntry,
    ) -> &'a Self {
        let this = js_NavigationCurrentEntryChangeEvent::create(
            heap,
            Self {
                base: Event::base(atom!("currententrychange"), PLAIN, Trusted::Yes),
                fields: Default::default(),
                kind,
            },
        );
        js_NavigationCurrentEntryChangeEvent::set_from(this, from.to_js());
        this
    }

    pub(crate) fn get_navigation_type(&self) -> Option<NavigationType> {
        self.kind
    }
}

#[repr(C)]
pub(crate) struct PageSwapEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_PageSwapEvent::Fields,
}

slots!(PageSwapEvent = js_PageSwapEvent set { activation: NavigationActivation, view_transition: ViewTransition, });

impl PageSwapEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        name: Atom,
        init: &PageSwapEventInit<'a>,
    ) -> &'a Self {
        let this = structure.create(
            heap,
            Self {
                base: from_init!(name, init),
                fields: Default::default(),
            },
        );
        this.set_activation(init.activation);
        this.set_view_transition(init.view_transition);
        this
    }

    pub(super) fn new<'a>(
        heap: &JsHeap<'a>,
        activation: Option<&'a NavigationActivation>,
        transition: Option<&'a ViewTransition>,
    ) -> &'a Self {
        let this = js_PageSwapEvent::create(
            heap,
            Self {
                base: Event::base(atom!("pageswap"), PLAIN, Trusted::Yes),
                fields: Default::default(),
            },
        );
        this.set_activation(activation);
        this.set_view_transition(transition);
        this
    }
}
