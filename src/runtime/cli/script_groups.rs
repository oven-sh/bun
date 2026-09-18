//! Process groups of the scripts a runner (`--filter`, `--parallel`,
//! `--sequential`) runs under the Bun shell. Each such script is its own
//! process group, so one `kill(-pgid, sig)` stops the script's whole tree.
//! A terminal Ctrl+C does not reach those groups, so the runner's SIGINT
//! handler relays it through `signal_all`.

use core::sync::atomic::{AtomicI32, AtomicPtr, AtomicUsize, Ordering};

static TABLE: AtomicPtr<AtomicI32> = AtomicPtr::new(core::ptr::null_mut());
static LEN: AtomicUsize = AtomicUsize::new(0);

/// One slot per script. Called once, before the runner's signal handler is
/// installed. The table lives for the process.
pub(crate) fn init(len: usize) {
    let table: &'static mut [AtomicI32] = Box::leak(
        (0..len)
            .map(|_| AtomicI32::new(0))
            .collect::<Box<[AtomicI32]>>(),
    );
    LEN.store(table.len(), Ordering::SeqCst);
    TABLE.store(table.as_mut_ptr(), Ordering::SeqCst);
}

fn slots() -> &'static [AtomicI32] {
    let ptr = TABLE.load(Ordering::SeqCst);
    if ptr.is_null() {
        return &[];
    }
    // SAFETY: `init` leaked a `[AtomicI32; LEN]` at `ptr` for the process lifetime.
    unsafe { core::slice::from_raw_parts(ptr, LEN.load(Ordering::SeqCst)) }
}

pub(crate) fn set(index: usize, pgid: i32) {
    if let Some(slot) = slots().get(index) {
        slot.store(pgid, Ordering::SeqCst);
    }
}

/// A no-op for a runner that did not `init` (its scripts share its group).
pub(crate) fn clear(index: usize) {
    if let Some(slot) = slots().get(index) {
        slot.store(0, Ordering::SeqCst);
    }
}

/// Sends `sig` to every live group. Async-signal-safe: atomics and kill(2) only.
pub(crate) fn signal_all(sig: i32) {
    for slot in slots() {
        let pgid = slot.load(Ordering::SeqCst);
        if pgid > 0 {
            // SAFETY: `kill` is async-signal-safe; a gone group is ESRCH.
            unsafe { libc::kill(-pgid, sig) };
        }
    }
}
