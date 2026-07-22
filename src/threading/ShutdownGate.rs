//! A counted guest gate protecting an allocation shared with other threads.
//!
//! Guests bracket every access to the protected memory with `enter()`/
//! `leave()`. The owner calls `close_and_wait()` before freeing the memory:
//! it refuses new guests, then blocks until every guest inside has left.
//! The gate itself must live OUTSIDE the protected allocation (e.g. in an
//! `Arc` cloned by each guest) so that a late `enter()` after the close is a
//! safe "gate closed" answer instead of a use-after-free.

use core::sync::atomic::{AtomicU32, Ordering};

use crate::futex;

/// Bit 0: closed. Remaining bits: number of guests currently inside ×2.
const CLOSED: u32 = 1;
const GUEST: u32 = 2;

#[derive(Default)]
pub struct ShutdownGate {
    state: AtomicU32,
}

impl ShutdownGate {
    pub const fn new() -> Self {
        Self {
            state: AtomicU32::new(0),
        }
    }

    /// Try to enter the gate. Returns `false` if the gate is closed — the
    /// protected memory may already be freed and must not be touched.
    #[must_use]
    pub fn enter(&self) -> bool {
        // Optimistic add, undo on closed: `close_and_wait` tolerates the
        // transient count because it re-reads state until it settles.
        let prev = self.state.fetch_add(GUEST, Ordering::Acquire);
        if prev & CLOSED == 0 {
            return true;
        }
        self.leave();
        false
    }

    /// Leave the gate. Must pair with an `enter()` that returned `true` (or
    /// the internal undo above). After this call the guest must not touch the
    /// protected memory again.
    pub fn leave(&self) {
        let prev = self.state.fetch_sub(GUEST, Ordering::Release);
        if prev == CLOSED | GUEST {
            // Last guest out of a closed gate: wake `close_and_wait` (all
            // waiters — `close_and_wait` is callable from several owners).
            futex::wake(&self.state, u32::MAX);
        }
    }

    /// Set the CLOSED bit without waiting for guests. Only sound when the
    /// protected memory is never actually freed (the main VM's box lives for
    /// the process) — new guests are refused, in-flight ones finish on their
    /// own time.
    pub fn close_without_waiting(&self) {
        self.state.fetch_or(CLOSED, Ordering::AcqRel);
    }

    /// Close the gate and block until every guest has left. After this
    /// returns, no guest is inside and none can enter; the protected memory
    /// may be freed. Idempotent; must never be called from a guest section.
    pub fn close_and_wait(&self) {
        let mut state = self.state.fetch_or(CLOSED, Ordering::AcqRel) | CLOSED;
        while state != CLOSED {
            let _ = futex::wait(&self.state, state, None);
            state = self.state.load(Ordering::Acquire);
        }
    }
}

/// RAII guest of a [`ShutdownGate`]: holds the gate open (via its own `Arc`,
/// so it may outlive whatever produced it) until dropped.
pub struct GateGuest {
    gate: std::sync::Arc<ShutdownGate>,
}

impl GateGuest {
    /// Enter `gate`; `None` if it is already closed.
    #[must_use]
    pub fn enter(gate: &std::sync::Arc<ShutdownGate>) -> Option<Self> {
        gate.enter().then(|| Self {
            gate: std::sync::Arc::clone(gate),
        })
    }
}

impl Drop for GateGuest {
    fn drop(&mut self) {
        self.gate.leave();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::AtomicUsize;

    #[test]
    fn close_and_wait_drains_racing_guests() {
        for _ in 0..64 {
            let gate = Arc::new(ShutdownGate::new());
            let inside = Arc::new(AtomicUsize::new(0));
            let guests: Vec<_> = (0..8)
                .map(|_| {
                    let (gate, inside) = (Arc::clone(&gate), Arc::clone(&inside));
                    std::thread::spawn(move || {
                        for _ in 0..500 {
                            if !gate.enter() {
                                return;
                            }
                            inside.fetch_add(1, Ordering::SeqCst);
                            std::hint::spin_loop();
                            inside.fetch_sub(1, Ordering::SeqCst);
                            gate.leave();
                        }
                    })
                })
                .collect();
            // A second concurrent closer: close_and_wait must be callable
            // from several owners and both must drain.
            let second_closer = {
                let gate = Arc::clone(&gate);
                std::thread::spawn(move || gate.close_and_wait())
            };
            gate.close_and_wait();
            // After close_and_wait returns, no guest is inside and none can enter.
            assert_eq!(inside.load(Ordering::SeqCst), 0);
            assert!(!gate.enter());
            gate.close_and_wait(); // idempotent
            second_closer.join().unwrap();
            for g in guests {
                g.join().unwrap();
            }
        }
    }

    #[test]
    fn enter_is_rejected_while_a_guest_holds_the_gate_closed() {
        let gate = Arc::new(ShutdownGate::new());
        assert!(gate.enter());
        let closer = {
            let gate = Arc::clone(&gate);
            std::thread::spawn(move || gate.close_and_wait())
        };
        // The closer sets CLOSED immediately; wait until new entries bounce.
        while gate.enter() {
            gate.leave();
            std::hint::spin_loop();
        }
        // Release the in-flight guest so the blocked closer drains.
        gate.leave();
        closer.join().unwrap();
        assert!(!gate.enter());
    }
}
