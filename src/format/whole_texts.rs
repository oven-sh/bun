//! How many texts the short cuts of this thread have printed from start to end, without the parser of their language. `--bench` says it.
//! The output doesn't show whether a short cut is taken: one that refuses everything passes every test that compares the two ways.
//! Scripts are counted by `js::quick::Counts`.

use std::cell::Cell;

thread_local! {
    static COUNT: Cell<u32> = const { Cell::new(0) };
}

#[inline]
pub(crate) fn note() {
    COUNT.with(|count| count.set(count.get().wrapping_add(1)));
}

/// The number since the last call on this thread.
pub fn take() -> u32 {
    COUNT.with(|count| count.replace(0))
}
