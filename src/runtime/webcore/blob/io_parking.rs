//! Ownership handshake for a `ReadFile`/`WriteFile` parked on the io loop —
//! see [`IoParking`].

use core::sync::atomic::{AtomicU8, Ordering};

/// Who currently owns a `ReadFile`/`WriteFile` that may park on the io
/// loop waiting for a pipe/tty/socket to become ready — the one wait a
/// `Bun.file` read or write can be stuck on indefinitely, and so the one
/// its VM's stop phase must be able to end
/// ([`bun_jsc::JobContext::cancel`]). All transitions are
/// compare-exchanges on one byte, so the JS thread's cancel, the io
/// thread's arm/fire, and the pool thread's park agree on who completes
/// the job, exactly once. Cancellation is sticky: once cancelled the job
/// never parks again.
pub(crate) struct IoParking(AtomicU8);

/// A pool thread has it (running, or about to).
const IDLE: u8 = 0;
/// Its wait request is queued for the io thread, not yet processed.
const PARKED: u8 = 1;
/// The io thread registered its poll; readiness sends it back to the pool.
const ARMED: u8 = 2;
/// Cancelled while parked/armed: the io thread closes it out.
const CANCELLED: u8 = 3;
/// Cancelled while a pool thread had it: that thread fails it at its next
/// attempt to park.
const DOOMED: u8 = 4;

impl IoParking {
    pub(crate) const fn new() -> Self {
        Self(AtomicU8::new(IDLE))
    }

    /// Pool thread, before queuing the wait request: `false` ⇒ cancelled
    /// already — fail the operation instead of parking.
    pub(crate) fn park(&self) -> bool {
        self.0
            .compare_exchange(IDLE, PARKED, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    /// io thread, processing the wait request: `true` ⇒ register the poll;
    /// `false` ⇒ cancelled meanwhile — close it out instead.
    pub(crate) fn arm(&self) -> bool {
        let r = self
            .0
            .compare_exchange(PARKED, ARMED, Ordering::SeqCst, Ordering::SeqCst);
        debug_assert!(
            matches!(r, Ok(_) | Err(CANCELLED)),
            "io wait request processed while not parked ({r:?})"
        );
        r.is_ok()
    }

    /// io thread, the poll fired or errored: `true` ⇒ hand back to the
    /// pool; `false` ⇒ cancelled meanwhile — do nothing, the re-queued
    /// wait request closes it out.
    pub(crate) fn fire(&self) -> bool {
        self.0
            .compare_exchange(ARMED, IDLE, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    /// JS thread (the VM's stop phase): cancel, whichever thread has it.
    /// `true` ⇒ the poll was registered: re-queue the wait request so the
    /// io thread sees the cancellation (it is not queued, and no other
    /// thread queues it once cancelled). `false` ⇒ nothing more to do
    /// here: the still-queued wait request will see the flag, or the pool
    /// thread that has the job fails it when it next tries to park (or
    /// just finishes).
    pub(crate) fn cancel(&self) -> bool {
        loop {
            let cur = self.0.load(Ordering::SeqCst);
            let next = match cur {
                IDLE => DOOMED,
                PARKED | ARMED => CANCELLED,
                _ => return false,
            };
            if self
                .0
                .compare_exchange(cur, next, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                return cur == ARMED;
            }
        }
    }
}
