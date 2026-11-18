//! For testing: one thread waits in the middle of what it does, so that another gets in between.

use core::cell::Cell;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_engine_platform::clock;

use crate::options;

static PAUSES: AtomicU32 = AtomicU32::new(0);

#[inline(always)]
pub(crate) fn is_enabled() -> bool {
    cfg!(debug_assertions) && options().delay_gc_threads
}

fn random() -> u64 {
    #[thread_local]
    static STATE: Cell<u64> = Cell::new(0);
    let mut state = STATE.get();
    if state == 0 {
        state = clock::monotonic_seconds().to_bits() | 1;
    }
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    STATE.set(state);
    state >> 8
}

#[cold]
fn wait(one_in: u64, longest_seconds: f64) {
    let bits = random();
    if (bits >> 8).is_multiple_of(one_in) {
        let end = clock::monotonic_seconds() + longest_seconds * (bits % 256) as f64 / 256.0;
        while PAUSES.load(Ordering::Relaxed) == 0 && clock::monotonic_seconds() < end {
            core::hint::spin_loop();
        }
    }
}

/// `rarity`: in proportion to how often the place is passed.
#[inline(always)]
pub(crate) fn of_helper(rarity: u64) {
    if is_enabled() && super::is_helper_thread() {
        wait(rarity * 20, 200e-6);
    }
}

#[inline(always)]
pub(crate) fn of_mutator() {
    if is_enabled() && super::barrier::is_fenced() {
        wait(8, 60e-6);
    }
}

/// Nobody waits meanwhile.
#[inline(always)]
pub(super) fn suspended_during(pause: impl FnOnce()) {
    if !is_enabled() {
        return pause();
    }
    PAUSES.fetch_add(1, Ordering::Relaxed);
    pause();
    PAUSES.fetch_sub(1, Ordering::Relaxed);
}
