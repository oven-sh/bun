//! Wakes the install loop when a queued network retry becomes due.
//!
//! Retries that are backing off sit in `PackageManager::retry_queue` with a
//! not-before timestamp. The install loop blocks in its event loop until some I/O
//! completes; when the *only* outstanding work is a backing-off retry there is no
//! I/O to wake it, so a small helper thread sleeps until the earliest deadline and
//! then calls `PackageManager::wake_raw` — the same cross-thread wake the HTTP
//! thread uses when a response arrives. This keeps the event loops themselves
//! untouched and behaves identically for the Mini and JS loops on every platform.

use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Instant;

use bun_threading::{Condition, Guarded};

use crate::PackageManager;

/// Monotonic milliseconds (immune to wall-clock steps) used for every retry deadline.
pub(crate) fn now_ms() -> u64 {
    static START: OnceLock<Instant> = OnceLock::new();
    let start = *START.get_or_init(Instant::now);
    u64::try_from(start.elapsed().as_millis()).unwrap_or(u64::MAX)
}

struct State {
    /// earliest not-before deadline (monotonic ms, a `now_ms()` value) the loop must be
    /// woken for
    next_deadline_ms: Option<u64>,
}

static STATE: Guarded<State> = Guarded::new(State {
    next_deadline_ms: None,
});
static COND: Condition = Condition::new();
static STARTED: AtomicBool = AtomicBool::new(false);

/// Ask for the install loop to be woken no later than `deadline_ms` (a `now_ms()` value).
/// Returns false if no timer thread could be started; the caller must then not rely
/// on being woken (it retries immediately instead of backing off).
pub(crate) fn arm(manager: *mut PackageManager, deadline_ms: u64) -> bool {
    {
        let mut st = STATE.lock();
        st.next_deadline_ms = Some(match st.next_deadline_ms {
            Some(cur) => cur.min(deadline_ms),
            None => deadline_ms,
        });
    }
    if !STARTED.swap(true, Ordering::AcqRel) {
        let pm = manager as usize;
        let spawned = std::thread::Builder::new()
            .name("install retry timer".into())
            .stack_size(256 * 1024)
            .spawn(move || run(pm as *mut PackageManager));
        if spawned.is_err() {
            STARTED.store(false, Ordering::Release);
            STATE.lock().next_deadline_ms = None;
            return false;
        }
    }
    COND.signal();
    true
}

fn run(manager: *mut PackageManager) {
    let mut st = STATE.lock();
    loop {
        match st.next_deadline_ms {
            None => COND.wait_guarded(&mut st),
            Some(deadline) => {
                let now = now_ms();
                if deadline <= now {
                    st.next_deadline_ms = None;
                    drop(st);
                    // SAFETY: the PackageManager singleton lives for the process and
                    // `wake_raw` is the documented cross-thread wake.
                    unsafe { PackageManager::wake_raw(manager) };
                    st = STATE.lock();
                } else {
                    let ns = (deadline - now).saturating_mul(1_000_000);
                    let _ = COND.timed_wait_guarded(&mut st, ns);
                }
            }
        }
    }
}
