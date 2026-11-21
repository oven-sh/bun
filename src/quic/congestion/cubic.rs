//! RFC 9438, with a gentler decrease and a steeper Reno-friendly increase.

use super::{Feedback, INITIAL_WINDOW, MAX_WINDOW, MICROS_PER_SECOND, Rtt};
use crate::time::{Duration, Instant};

/// In segments per cubed second.
const C: f64 = 0.4;
const BETA: f64 = 0.8;
/// In segments per round trip.
const ALPHA: f64 = 0.8;
const MIN_SEGMENTS: u64 = 2;
const DEFAULT_RTT: Duration = Duration::from_millis(50);

pub(super) struct Cubic {
    pub(super) window: u64,
    pub(super) segment: u64,
    slow_start_threshold: u64,
    /// W_max.
    plateau: u64,
    /// K, in seconds.
    time_to_plateau: f64,
    /// t, which stands still while the window is not in use (§4.2).
    elapsed: Duration,
    updated_at: Instant,
    /// W_est.
    reno_window: f64,
    /// The last packet that was sent before the window was reduced.
    recovery_end: u64,
    pub(super) is_recovering: bool,
    /// The last packet that filled half of the window or more (RFC 7661 §4.3).
    used_by: u64,
}

impl Cubic {
    pub(super) fn new(segment: u64) -> Self {
        Self {
            window: INITIAL_WINDOW,
            segment,
            slow_start_threshold: MAX_WINDOW,
            plateau: 0,
            time_to_plateau: 0.0,
            elapsed: Duration::ZERO,
            updated_at: Instant::default(),
            reno_window: MAX_WINDOW as f64,
            recovery_end: 0,
            is_recovering: false,
            used_by: 0,
        }
    }

    pub(super) fn pacing_rate(&self, rtt: &Rtt) -> (u64, Duration) {
        let len = if self.window < self.slow_start_threshold {
            self.window * 2
        } else if self.is_recovering {
            self.window
        } else {
            self.window * 5 / 4
        };
        match rtt.has_sample() {
            true => (len, rtt.smoothed),
            false => (len, DEFAULT_RTT),
        }
    }

    pub(super) fn on_idle_restart(&mut self, now: Instant) {
        self.updated_at = now;
    }

    /// `in_flight` includes the packet.
    #[inline]
    pub(super) fn on_sent(&mut self, sequence: u64, in_flight: u64) {
        if 2 * in_flight >= self.window {
            self.used_by = sequence;
        }
    }

    pub(super) fn is_congested(&self, feedback: &Feedback) -> bool {
        feedback.newest_lost > self.recovery_end
    }

    pub(super) fn on_feedback(&mut self, now: Instant, feedback: &Feedback, rtt: &Rtt) {
        let is_congested = self.is_congested(feedback);
        if is_congested {
            self.reduce(feedback.last_sent);
        }
        if feedback.is_persistent_congestion {
            self.collapse();
        }
        let since_update = now - core::mem::replace(&mut self.updated_at, now);
        let Some(newest) = feedback.newest_acked else {
            return;
        };
        if is_congested || feedback.is_persistent_congestion {
            return;
        }
        self.is_recovering &= newest.sequence <= self.recovery_end;
        // RFC 9002 §7.8.
        if newest.sequence > self.used_by {
            return;
        }
        let limit = if self.window < self.slow_start_threshold {
            (self.window + feedback.acked).min(self.slow_start_threshold)
        } else {
            self.elapsed = self.elapsed + since_update;
            self.avoid_congestion(feedback.acked, rtt)
        };
        if !self.is_recovering {
            self.window = self.window.max(limit);
        }
    }

    /// Returns what the window may grow to (§4.2 to §4.5).
    fn avoid_congestion(&mut self, acked: u64, rtt: &Rtt) -> u64 {
        let segment = self.segment as f64;
        self.reno_window += ALPHA * segment * acked as f64 / self.reno_window;
        let time = (self.elapsed + rtt.min).as_micros() as f64 / MICROS_PER_SECOND as f64;
        let offset = C * segment * (time - self.time_to_plateau).powi(3);
        let target = (self.plateau as f64 + offset).max(self.reno_window);
        (target as u64).min(self.window + acked / 2).min(MAX_WINDOW)
    }

    /// §4.6 and §4.7.
    fn reduce(&mut self, last_sent: u64) {
        let window = self.window as f64;
        let plateau = match self.window < self.plateau {
            true => (window * (1.0 + BETA) / 2.0) as u64,
            false => self.window,
        };
        self.window = ((window * BETA) as u64).max(MIN_SEGMENTS * self.segment);
        self.slow_start_threshold = self.window;
        self.start_epoch(plateau.max(self.window));
        (self.recovery_end, self.is_recovering) = (last_sent, true);
    }

    /// §4.8.
    fn collapse(&mut self) {
        self.window = MIN_SEGMENTS * self.segment;
        self.is_recovering = false;
        self.start_epoch(self.slow_start_threshold);
    }

    /// The curve leads from the threshold to `plateau`.
    fn start_epoch(&mut self, plateau: u64) {
        let rise = (plateau - self.slow_start_threshold) as f64;
        self.plateau = plateau;
        self.time_to_plateau = (rise / (C * self.segment as f64)).cbrt();
        self.elapsed = Duration::ZERO;
        self.reno_window = self.slow_start_threshold as f64;
    }
}
