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

/// Inbound (recv) window. The peer may send `size - consumed` more bytes.
#[derive(Clone, Copy, Debug)]
pub struct RecvWindow {
    /// The window we want (nghttp2's `local_window_size`).
    pub size: i64,
    /// Credit still to give back (`recv_window_size`). Negative after a `LocalWindow` decrease.
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

    #[inline]
    pub fn apply(&mut self, change: RecvWindowChange) {
        self.size += change.size;
        self.consumed += change.consumed;
    }
}

/// A move of a `RecvWindow` that the embedder makes (see `LocalWindow::resize`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct RecvWindowChange {
    pub size: i64,
    pub consumed: i64,
}

impl RecvWindowChange {
    /// The WINDOW_UPDATE increment for this change: the change in `size - consumed`.
    #[inline]
    pub fn increment(self) -> i64 {
        self.size - self.consumed
    }
}

impl core::ops::Add for RecvWindowChange {
    type Output = RecvWindowChange;

    fn add(self, other: RecvWindowChange) -> RecvWindowChange {
        RecvWindowChange {
            size: self.size + other.size,
            consumed: self.consumed + other.consumed,
        }
    }
}

/// nghttp2's `local_window_size` and `recv_reduction`: the window asked for, and withheld credit.
#[derive(Clone, Copy, Debug)]
pub struct LocalWindow {
    pub size: i64,
    pub reduction: i64,
}

impl Default for LocalWindow {
    fn default() -> Self {
        LocalWindow {
            size: DEFAULT_WINDOW_SIZE as i64,
            reduction: 0,
        }
    }
}

impl LocalWindow {
    /// nghttp2_session_set_local_window_size() for stream 0. A raise repays withheld credit first.
    pub fn resize(&mut self, new_size: i64) -> RecvWindowChange {
        let delta = new_size - self.size;
        self.size = new_size;
        if delta < 0 {
            self.reduction -= delta;
            return RecvWindowChange {
                size: delta,
                consumed: delta,
            };
        }
        let repaid = self.reduction.min(delta);
        self.reduction -= repaid;
        RecvWindowChange {
            size: delta,
            consumed: repaid,
        }
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

    #[test]
    fn local_window_decrease_withholds_credit() {
        let mut local = LocalWindow::default();
        let mut w = RecvWindow::default();

        let shrink = local.resize(20);
        assert_eq!(shrink.increment(), 0);
        w.apply(shrink);
        assert_eq!((w.size, w.consumed), (20, -65515));

        // The peer fills the window it was told about. Only 20 bytes are granted back.
        w.on_data(65535);
        assert!(!w.is_overflowed());
        assert_eq!(w.take_update(), 20);
        w.on_data(21);
        assert!(w.is_overflowed());
    }

    #[test]
    fn local_window_raise_repays_the_reduction_first() {
        let mut local = LocalWindow::default();
        let mut w = RecvWindow::default();
        w.apply(local.resize(20));

        let raise = local.resize(1 << 20);
        assert_eq!(raise.increment(), 983041);
        w.apply(raise);
        assert_eq!((w.size, w.consumed, local.reduction), (1 << 20, 0, 0));

        // A raise that the reduction absorbs sends nothing.
        let mut local = LocalWindow::default();
        let change = local.resize(20) + local.resize(30000);
        assert_eq!(change.increment(), 0);
        assert_eq!(local.reduction, 35535);
    }
}
