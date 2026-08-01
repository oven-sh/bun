//! HTTP/2 flow control (RFC 9113 §6.9). Pure. Part of the from-scratch rewrite.
//!
//! Two directions per connection and per stream:
//!   * Send window  — how much DATA we may still send (governed by the peer's advertised window +
//!     WINDOW_UPDATE). May go negative when the peer lowers INITIAL_WINDOW_SIZE (§6.9.2).
//!   * Recv window  — how much DATA the peer may still send us; replenished by emitting
//!     WINDOW_UPDATE once enough has been consumed.

#![allow(dead_code)]

use super::wire::{DEFAULT_WINDOW_SIZE, ErrorCode, MAX_WINDOW_SIZE};

/// Outbound (send) window. Signed because a SETTINGS-driven INITIAL_WINDOW_SIZE decrease can push
/// it negative (§6.9.2) — legal; we just stop sending until it recovers.
#[derive(Clone, Copy, Debug)]
pub struct SendWindow {
    pub remaining: i64,
}

impl Default for SendWindow {
    fn default() -> Self {
        SendWindow {
            remaining: DEFAULT_WINDOW_SIZE as i64,
        }
    }
}

impl SendWindow {
    pub fn new(initial: u32) -> Self {
        SendWindow {
            remaining: initial as i64,
        }
    }

    /// Bytes we may send right now (never negative for sizing).
    #[inline]
    pub fn available(self) -> i64 {
        if self.remaining > 0 {
            self.remaining
        } else {
            0
        }
    }

    #[inline]
    pub fn consume(&mut self, n: i64) {
        self.remaining -= n;
    }

    /// Apply a WINDOW_UPDATE increment. §6.9.1: the window MUST NOT exceed 2^31-1; exceeding it is a
    /// FLOW_CONTROL_ERROR. A zero increment is rejected by the caller before reaching here.
    pub fn increase(&mut self, increment: u32) -> Result<(), ErrorCode> {
        let next = self.remaining + increment as i64;
        if next > MAX_WINDOW_SIZE as i64 {
            return Err(ErrorCode::FlowControlError);
        }
        self.remaining = next;
        Ok(())
    }

    /// §6.9.2: shift by (new_initial - old_initial) on a peer INITIAL_WINDOW_SIZE change.
    #[inline]
    pub fn apply_initial_delta(&mut self, delta: i64) {
        // 6.9.2: the result may legitimately go negative; cap the upper bound so repeated
        // positive deltas cannot push past the protocol maximum while outbound is legacy-driven.
        self.remaining = (self.remaining + delta).min(MAX_WINDOW_SIZE as i64);
    }
}

/// Inbound (recv) window. We advertise `size` and track `consumed`; once enough is consumed we
/// emit a WINDOW_UPDATE of the consumed amount and reset.
#[derive(Clone, Copy, Debug)]
pub struct RecvWindow {
    pub size: i64,
    pub consumed: i64,
}

impl Default for RecvWindow {
    fn default() -> Self {
        RecvWindow {
            size: DEFAULT_WINDOW_SIZE as i64,
            consumed: 0,
        }
    }
}

impl RecvWindow {
    pub fn new(initial: u32) -> Self {
        RecvWindow {
            size: initial as i64,
            consumed: 0,
        }
    }

    #[inline]
    pub fn on_data(&mut self, n: i64) {
        self.consumed += n;
    }

    /// Whether the peer exceeded our advertised window (a FLOW_CONTROL_ERROR, §6.9.1).
    #[inline]
    pub fn is_overflowed(&self) -> bool {
        self.consumed > self.size
    }

    /// Overflow check with an enforcement limit that may exceed the advertised size:
    /// until our SETTINGS shrinking the window is ACKed, the peer may legitimately send
    /// according to the previous (larger) value (RFC 9113 6.5.3).
    pub fn is_overflowed_with(&self, limit: i64) -> bool {
        self.consumed > limit.max(self.size)
    }

    /// Replenish heuristic: update once at least half the window has been consumed.
    #[inline]
    pub fn needs_update(&self) -> bool {
        self.consumed > 0 && self.consumed >= self.size / 2
    }

    /// Take the pending WINDOW_UPDATE increment and reset the consumed counter (0 if none).
    pub fn take_update(&mut self) -> u32 {
        if self.consumed <= 0 {
            return 0;
        }
        let inc = self.consumed.min(MAX_WINDOW_SIZE as i64);
        self.consumed -= inc;
        inc as u32
    }

    #[inline]
    pub fn grow(&mut self, delta: i64) {
        self.size += delta;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn send_window_overflow_is_flow_control_error() {
        let mut w = SendWindow::new(MAX_WINDOW_SIZE);
        assert_eq!(w.increase(1), Err(ErrorCode::FlowControlError));
    }

    #[test]
    fn recv_window_replenish() {
        let mut w = RecvWindow::new(100);
        w.on_data(60);
        assert!(w.needs_update());
        assert_eq!(w.take_update(), 60);
        assert_eq!(w.consumed, 0);
    }
}
