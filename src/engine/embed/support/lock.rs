//! The slow paths of `Lock` and `Condition`.

use core::sync::atomic::{AtomicU32, Ordering};

use bun_threading::Futex;

const UNLOCKED: u32 = 0;
const LOCKED: u32 = 1;
const LOCKED_WITH_WAITERS: u32 = 2;

const SPIN_LIMIT: u32 = 100;

/// Waits a moment for a holder that nobody else waits for. Returns the state.
fn spin(state: &AtomicU32) -> u32 {
    for _ in 0..SPIN_LIMIT {
        let current = state.load(Ordering::Relaxed);
        if current != LOCKED {
            return current;
        }
        core::hint::spin_loop();
    }
    LOCKED
}

#[cold]
#[unsafe(no_mangle)]
extern "C" fn Support__Lock__lockSlow(state: &AtomicU32) {
    let mut current = spin(state);
    if current == UNLOCKED {
        match state.compare_exchange(UNLOCKED, LOCKED, Ordering::Acquire, Ordering::Relaxed) {
            Ok(_) => return,
            Err(changed) => current = changed,
        }
    }
    // A thread that has waited cannot tell whether it was the only one.
    while current == LOCKED_WITH_WAITERS
        || state.swap(LOCKED_WITH_WAITERS, Ordering::Acquire) != UNLOCKED
    {
        Futex::wait_forever(state, LOCKED_WITH_WAITERS);
        current = spin(state);
    }
}

/// The next holder may have freed the lock by now.
#[cold]
#[unsafe(no_mangle)]
extern "C" fn Support__Lock__wakeOne(state: *const AtomicU32) {
    Futex::wake_raw(state, 1);
}

/// Returns when `sequence` is not `seen` any more, or false after `seconds`, which may be infinite.
#[unsafe(no_mangle)]
extern "C" fn Support__Condition__wait(sequence: &AtomicU32, seen: u32, seconds: f64) -> bool {
    let start = std::time::Instant::now();
    let limit = (seconds != f64::INFINITY).then_some((seconds * 1e9) as u64);
    while sequence.load(Ordering::Relaxed) == seen {
        let left = limit.map(|limit| limit.saturating_sub(start.elapsed().as_nanos() as u64));
        if Futex::wait(sequence, seen, left).is_err() && limit.is_some() {
            return false;
        }
    }
    true
}

#[unsafe(no_mangle)]
extern "C" fn Support__Condition__wakeAll(sequence: *const AtomicU32) {
    Futex::wake_raw(sequence, u32::MAX);
}
