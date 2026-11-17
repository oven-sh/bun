//! The events of animations, scrolling and media queries.

use bun_jsc::JSValue;
use bun_jsc::bindgen::{ClassStructure, JsHeap, JsInterface, JsScope};

use crate::api::animation::animation_for;
use crate::api::core::{Atom, DomString, Element, Node, atom};
use crate::api::cssom::{CSSPseudoElement, pseudo_element};
use crate::api::events::{Event, EventInit, Trusted};
use crate::engine_event::CssEvent;
use crate::generated_bindgen::animation::{CSSAnimation, CSSTransition};
use crate::generated_bindgen::style_events::*;
use crate::generated_bindgen::typed::CSSNumberish;

macro_rules! from_script {
    ($name:expr, $init:expr) => {
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

fn trusted(name: impl Into<Atom>, bubbles: bool) -> Event {
    Event::base(
        name,
        EventInit {
            bubbles,
            ..EventInit::default()
        },
        Trusted::Yes,
    )
}

macro_rules! of_style {
    ($($Event:ident $js:ident $Init:ident $name:ident $Animation:ident)+) => {$(
        #[repr(C)]
        pub(crate) struct $Event {
            pub(crate) base: Event,
            pub(crate) fields: $js::Fields,
            name: DomString,
            elapsed_time: f64,
            pseudo_element: DomString,
            /// In the engine.
            id: u32,
        }

        impl $Event {
            pub(crate) fn constructor<'a>(heap: &JsHeap<'a>, structure: ClassStructure<'a, Self>, kind: Atom, init: &$Init<'a>) -> &'a Self {
                let (name, pseudo_element) = (init.$name.clone(), init.pseudo_element.clone());
                let made = structure.create(heap, Self { base: from_script!(kind, init), fields: Default::default(), name, elapsed_time: init.elapsed_time, pseudo_element, id: 0 });
                $js::set_animation(made, init.animation);
                made
            }

            pub(crate) fn new<'a>(heap: &JsHeap<'a>, kind: Atom, event: &CssEvent, origin: &'a Node) -> &'a Event {
                let init = EventInit { bubbles: true, cancelable: kind == atom!("transitionend"), composed: false };
                let [name, pseudo_element] = [&*event.name, &*event.pseudo].map(DomString::from_utf8);
                let base = Event::base(kind, init, Trusted::Yes);
                let made = $js::create(heap, Self { base, fields: Default::default(), name, elapsed_time: event.elapsed_seconds, pseudo_element, id: event.animation });
                $js::set_origin(made, origin.as_element());
                made
            }

            fn origin(&self) -> Option<&Element> {
                $js::origin(self)
            }

            pub(crate) fn get_name(&self, _: &JsHeap<'_>) -> &DomString {
                &self.name
            }

            pub(crate) fn get_elapsed_time(&self) -> f64 {
                self.elapsed_time
            }

            pub(crate) fn get_pseudo_element(&self, _: &JsHeap<'_>) -> &DomString {
                &self.pseudo_element
            }

            pub(crate) fn get_pseudo_target<'a>(&'a self, heap: &JsHeap<'a>) -> Option<&'a CSSPseudoElement> {
                pseudo_element(heap, self.origin()?, self.pseudo_element.to_utf8().as_bytes())
            }

            pub(crate) fn get_animation<'a>(&'a self, cx: &mut JsScope<'a>) -> Option<&'a $Animation> {
                $js::animation(self).or_else(|| {
                    let found = animation_for(cx, self.origin()?, self.id, self.pseudo_element.to_utf8().as_bytes())?.downcast();
                    $js::set_animation(self, found);
                    found
                })
            }
        }
    )+};
}

of_style! {
    AnimationEvent js_AnimationEvent AnimationEventInit animation_name CSSAnimation
    TransitionEvent js_TransitionEvent TransitionEventInit property_name CSSTransition
}

#[repr(C)]
pub(crate) struct AnimationPlaybackEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_AnimationPlaybackEvent::Fields,
}

impl AnimationPlaybackEvent {
    fn with_times(&self, [current, timeline]: [JSValue; 2]) -> &Self {
        js_AnimationPlaybackEvent::set_current_time(self, current);
        js_AnimationPlaybackEvent::set_timeline_time(self, timeline);
        self
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        kind: Atom,
        init: &AnimationPlaybackEventInit<'a>,
    ) -> &'a Self {
        let times = [&init.current_time, &init.timeline_time].map(|it| match *it {
            Some(CSSNumberish::Value(it)) => it.to_js(),
            Some(CSSNumberish::Number(it)) => JSValue::js_number(it),
            None => JSValue::NULL,
        });
        structure
            .create(
                heap,
                Self {
                    base: from_script!(kind, init),
                    fields: Default::default(),
                },
            )
            .with_times(times)
    }

    pub(crate) fn new<'a>(heap: &JsHeap<'a>, kind: Atom, times: [JSValue; 2]) -> &'a Event {
        js_AnimationPlaybackEvent::create(
            heap,
            Self {
                base: trusted(kind, false),
                fields: Default::default(),
            },
        )
        .with_times(times)
    }
}

#[repr(C)]
pub(crate) struct SnapEvent {
    pub(crate) base: Event,
    pub(crate) fields: js_SnapEvent::Fields,
}

impl SnapEvent {
    fn with_targets(&self, [block, inline]: [Option<&Node>; 2]) -> &Self {
        js_SnapEvent::set_block(self, block);
        js_SnapEvent::set_inline(self, inline);
        self
    }

    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        kind: Atom,
        init: &SnapEventInit<'a>,
    ) -> &'a Self {
        structure
            .create(
                heap,
                Self {
                    base: from_script!(kind, init),
                    fields: Default::default(),
                },
            )
            .with_targets([init.snap_target_block, init.snap_target_inline])
    }

    pub(crate) fn new<'a>(
        heap: &JsHeap<'a>,
        kind: Atom,
        bubbles: bool,
        targets: [Option<&'a Node>; 2],
    ) -> &'a Event {
        js_SnapEvent::create(
            heap,
            Self {
                base: trusted(kind, bubbles),
                fields: Default::default(),
            },
        )
        .with_targets(targets)
    }
}

#[repr(C)]
pub(crate) struct ContentVisibilityAutoStateChangeEvent {
    pub(crate) base: Event,
    skipped: bool,
}

impl ContentVisibilityAutoStateChangeEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        kind: Atom,
        init: &ContentVisibilityAutoStateChangeEventInit,
    ) -> &'a Self {
        structure.create(
            heap,
            Self {
                base: from_script!(kind, init),
                skipped: init.skipped,
            },
        )
    }

    pub(crate) fn new<'a>(heap: &JsHeap<'a>, kind: Atom, skipped: bool) -> &'a Event {
        js_ContentVisibilityAutoStateChangeEvent::create(
            heap,
            Self {
                base: trusted(kind, true),
                skipped,
            },
        )
    }

    pub(crate) fn get_skipped(&self) -> bool {
        self.skipped
    }
}

#[repr(C)]
pub(crate) struct MediaQueryListEvent {
    pub(crate) base: Event,
    media: DomString,
    matches: bool,
}

impl MediaQueryListEvent {
    pub(crate) fn constructor<'a>(
        heap: &JsHeap<'a>,
        structure: ClassStructure<'a, Self>,
        kind: Atom,
        init: &MediaQueryListEventInit<'a>,
    ) -> &'a Self {
        structure.create(
            heap,
            Self {
                base: from_script!(kind, init),
                media: DomString::from_impl(init.media.get()),
                matches: init.matches,
            },
        )
    }

    pub(crate) fn new<'a>(heap: &JsHeap<'a>, media: DomString, matches: bool) -> &'a Event {
        js_MediaQueryListEvent::create(
            heap,
            Self {
                base: trusted(atom!("change"), false),
                media,
                matches,
            },
        )
    }

    pub(crate) fn get_media(&self, _: &JsHeap<'_>) -> &DomString {
        &self.media
    }

    pub(crate) fn get_matches(&self) -> bool {
        self.matches
    }
}
