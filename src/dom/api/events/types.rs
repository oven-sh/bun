//! The names of events, as numbers.

use core::cell::{Cell, RefCell};

use crate::api::core::{Atom, Known, atom};
use crate::name::Map;

const KNOWN: usize = Known::Other as usize;

/// A bit for each known type that has ever had a listener.
#[thread_local]
static LISTENED: [Cell<u64>; KNOWN / 64 + 1] = [const { Cell::new(0) }; KNOWN / 64 + 1];

thread_local! {
    /// The others that have.
    static MADE_UP: RefCell<Map<Atom, u32>> = RefCell::default();
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct EventType(pub(super) u32);

impl From<Known> for EventType {
    #[inline(always)]
    fn from(name: Known) -> EventType {
        EventType(name as u32)
    }
}

fn has_had_listener(name: Known) -> bool {
    LISTENED[name as usize / 64].get() >> (name as usize % 64) & 1 != 0
}

/// What an event is called for a target that only listens to that.
pub(super) fn legacy_name(name: Known) -> Option<Known> {
    Some(match name {
        atom!("wheel") => atom!("mousewheel"),
        atom!("animationend") => atom!("webkitAnimationEnd"),
        atom!("animationiteration") => atom!("webkitAnimationIteration"),
        atom!("animationstart") => atom!("webkitAnimationStart"),
        atom!("transitionend") => atom!("webkitTransitionEnd"),
        _ => return None,
    })
    .filter(|it| has_had_listener(*it))
}

/// Anywhere, now or before.
#[inline]
pub(crate) fn is_listened_to(name: Known) -> bool {
    has_had_listener(name) || legacy_name(name).is_some()
}

impl EventType {
    pub(crate) fn for_listener(name: &Atom) -> EventType {
        match name.known() {
            Known::Other => MADE_UP.with_borrow_mut(|all| {
                let next = (KNOWN + all.len()) as u32;
                EventType(*all.entry(name.clone()).or_insert(next))
            }),
            known => {
                LISTENED[known as usize / 64].update(|it| it | 1 << (known as usize % 64));
                known.into()
            }
        }
    }

    /// `None` if nothing listens to it.
    pub(crate) fn of(name: &Atom) -> Option<EventType> {
        match name.known() {
            Known::Other => MADE_UP.with_borrow(|all| all.get(name).map(|it| EventType(*it))),
            known => is_listened_to(known).then_some(known.into()),
        }
    }

    pub(super) fn is_press(self) -> bool {
        self == atom!("click").into()
            || self == atom!("mousedown").into()
            || self == atom!("mouseup").into()
    }

    pub(super) fn is_wheel(self) -> bool {
        self == atom!("wheel").into() || self == atom!("mousewheel").into()
    }

    /// <https://dom.spec.whatwg.org/#default-passive-value>
    pub(super) fn blocks_scrolling(self) -> bool {
        self.is_wheel() || self == atom!("touchstart").into() || self == atom!("touchmove").into()
    }
}
