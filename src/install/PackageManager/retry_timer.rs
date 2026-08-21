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

use bun_threading::{Condition, Guarded};

use crate::PackageManager;

struct State {
    /// earliest not-before timestamp (ms since epoch) the loop must be woken for
    next_deadline_ms: Option<u64>,
}

static STATE: Guarded<State> = Guarded::new(State {
    next_deadline_ms: None,
});
static COND: Condition = Condition::new();
static STARTED: AtomicBool = AtomicBool::new(false);

/// Ask for the install loop to be woken no later than `deadline_ms`.
pub(crate) fn arm(manager: *mut PackageManager, deadline_ms: u64) {
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
            // Without the thread the loop still makes progress whenever any other
            // I/O completes; fall back to that rather than failing the install.
            STARTED.store(false, Ordering::Release);
            return;
        }
    }
    COND.signal();
}

fn now_ms() -> u64 {
    bun_core::time::milli_timestamp().max(0) as u64
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
