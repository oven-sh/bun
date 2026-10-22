//! HTTP/2 flow-control windows (RFC 9113 §6.9), per connection and per stream.

use super::frame::ErrorCode;

pub const DEFAULT_WINDOW_SIZE: u32 = 65_535;
pub const MAX_WINDOW_SIZE: u32 = 0x7fff_ffff;

/// How much DATA we may still send. Negative after the peer lowers SETTINGS_INITIAL_WINDOW_SIZE (§6.9.2).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct SendWindow(i64);

impl SendWindow {
    pub fn new(initial: u32) -> Self {
        SendWindow(i64::from(initial))
    }

    #[inline]
    pub fn available(self) -> usize {
        self.0.max(0) as usize
    }

    #[inline]
    pub fn consume(&mut self, octets: usize) {
        self.0 -= octets as i64;
    }

    /// Applies a WINDOW_UPDATE. A window past 2^31-1 is a FLOW_CONTROL_ERROR and stays as it was (§6.9.1).
    pub fn increase(&mut self, increment: u32) -> Result<(), ErrorCode> {
        self.shift(i64::from(increment))
    }

    /// Applies a change of the peer's SETTINGS_INITIAL_WINDOW_SIZE, under the same limit (§6.9.2).
    pub fn shift(&mut self, delta: i64) -> Result<(), ErrorCode> {
        let next = self.0 + delta;
        if next > i64::from(MAX_WINDOW_SIZE) {
            return Err(ErrorCode::FLOW_CONTROL_ERROR);
        }
        self.0 = next;
        Ok(())
    }
}

/// How much DATA the peer may still send: the advertised size and what it has used of it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RecvWindow {
    size: i64,
    consumed: i64,
}

impl RecvWindow {
    pub fn new(initial: u32) -> Self {
        RecvWindow {
            size: i64::from(initial),
            consumed: 0,
        }
    }

    #[inline]
    pub fn on_data(&mut self, octets: usize) {
        self.consumed += octets as i64;
    }

    /// Returns true if the peer overran the window. `floor` is a larger size it may still go by (§6.5.3).
    #[inline]
    pub fn is_overflowed(&self, floor: u32) -> bool {
        self.consumed > self.size.max(i64::from(floor))
    }

    /// Returns true once half the window is used.
    #[inline]
    pub fn needs_update(&self) -> bool {
        self.consumed > 0 && self.consumed >= self.size / 2
    }

    /// The increment of the next WINDOW_UPDATE, or 0. Gives those octets back to the peer.
    pub fn take_update(&mut self) -> u32 {
        let increment = self.consumed.clamp(0, i64::from(MAX_WINDOW_SIZE));
        self.consumed -= increment;
        increment as u32
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
    fn send_window_stops_at_the_maximum() {
        let mut window = SendWindow::new(MAX_WINDOW_SIZE);
        assert_eq!(window.increase(1), Err(ErrorCode::FLOW_CONTROL_ERROR));
        assert_eq!(window.available(), MAX_WINDOW_SIZE as usize);
        window.consume(1);
        assert_eq!(window.increase(1), Ok(()));
    }

    #[test]
    fn send_window_goes_negative_and_recovers() {
        let mut window = SendWindow::new(100);
        window.consume(80);
        assert_eq!(window.shift(-50), Ok(()));
        assert_eq!(window.available(), 0);
        assert_eq!(window.increase(40), Ok(()));
        assert_eq!(window.available(), 10);
    }

    #[test]
    fn recv_window_replenishes_at_half() {
        let mut window = RecvWindow::new(100);
        window.on_data(49);
        assert!(!window.needs_update());
        window.on_data(11);
        assert!(window.needs_update());
        assert_eq!(window.take_update(), 60);
        assert_eq!(window.take_update(), 0);
    }

    #[test]
    fn recv_window_overflow_honors_the_floor() {
        let mut window = RecvWindow::new(10);
        window.on_data(11);
        assert!(window.is_overflowed(0));
        assert!(!window.is_overflowed(65_535));
    }
}
