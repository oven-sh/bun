//! draft-cardwell-iccrg-bbr-congestion-control-00.

use super::bandwidth_sampler::BandwidthSampler;
use super::windowed_filter::WindowedMax;
use super::{Feedback, Flight, INITIAL_WINDOW, MAX_WINDOW, MICROS_PER_SECOND, Rtt, SEGMENT};
use crate::time::{Duration, Instant};

const MIN_SEGMENTS: u64 = 4;
/// Up to here, the window does not have to be in proportion to the path.
const UNCONDITIONAL_WINDOW: u64 = 2000 * SEGMENT;
const DEFAULT_RTT: Duration = Duration::from_millis(25);
const MIN_RTT_EXPIRY: Duration = Duration::from_secs(10);
const PROBE_RTT_TIME: Duration = Duration::from_millis(200);
const ROUNDS_WITHOUT_GROWTH: u8 = 3;
/// After how many they are forgotten, unless loss has been high.
const ROUNDS_WITHOUT_LIMIT: u64 = 8;
/// To lose this many in a round, and more than one in `HIGH_LOSS_RATIO`, is no accident.
const HIGH_LOSS_SEGMENTS: u64 = 6;
const HIGH_LOSS_RATIO: u64 = 50;
const PHASES: u8 = 8;

/// In 1024ths.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct Gain(u64);

impl Gain {
    const UNIT: Self = Self(1024);
    /// 2/ln(2).
    const HIGH: Self = Self(2954);
    const DRAIN: Self = Self(355);
    const PROBE_UP: Self = Self(1280);
    const PROBE_DOWN: Self = Self(768);
    const WINDOW: Self = Self(2048);
    const MAX_WINDOW: Self = Self(3072);

    fn of(self, value: u64) -> u64 {
        value.saturating_mul(self.0) / Self::UNIT.0
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Startup,
    Drain,
    ProbeBandwidth {
        phase: u8,
        since: Instant,
    },
    ProbeRtt {
        /// Not set until the flight is small enough.
        until: Option<Instant>,
        has_round_passed: bool,
    },
}

/// §4.2.3.4.
struct Recovery {
    window: u64,
    /// The last packet that was sent before the latest loss.
    end: u64,
    /// What counts as lost.
    lost: u64,
    /// For the first round at most.
    conserves_packets: bool,
    /// The application made the flight as small as it was, and thus the window.
    is_application_limited: bool,
    /// Nothing got through for a while.
    has_collapsed: bool,
}

pub(super) struct Bbr {
    pub(super) segment: u64,
    sampler: BandwidthSampler,
    mode: Mode,
    window: u64,
    recovery: Option<Recovery>,
    /// In bytes per second, like the bandwidth.
    pacing_rate: u64,
    bandwidth: WindowedMax,
    /// Zero until there is a sample.
    min_rtt: Duration,
    min_rtt_at: Instant,
    round: u64,
    /// The last packet of the round.
    round_end: u64,
    /// The last packet that the application had nothing to send after.
    ran_dry_at: u64,
    acked_in_round: u64,
    lost_in_round: u64,
    was_congested_in_round: bool,
    acked_in_last_round: u64,
    is_pipe_filled: bool,
    is_last_sample_limited: bool,
    is_restarting: bool,
    has_lost_packets: bool,
    rounds_without_growth: u8,
    /// The last round without growth, or with a queue.
    limited_in: u64,
    was_loss_high: bool,
    bandwidth_to_beat: u64,
    /// What is acknowledged in excess of the bandwidth, as paths and peers bunch acknowledgments.
    excess_acked: WindowedMax,
    bunch_start: Instant,
    bunch_len: u64,
    pub(super) random: u32,
}

/// In bytes.
fn delivered_in(duration: Duration, bandwidth: u64) -> u64 {
    bandwidth.saturating_mul(duration.as_micros()) / MICROS_PER_SECOND
}

impl Bbr {
    pub(super) fn new(segment: u64, random: u32) -> Self {
        Self {
            segment,
            sampler: BandwidthSampler::new(),
            mode: Mode::Startup,
            window: INITIAL_WINDOW,
            recovery: None,
            pacing_rate: 0,
            bandwidth: WindowedMax::default(),
            min_rtt: Duration::ZERO,
            min_rtt_at: Instant::default(),
            round: 0,
            round_end: 0,
            ran_dry_at: 0,
            acked_in_round: 0,
            lost_in_round: 0,
            was_congested_in_round: false,
            acked_in_last_round: 0,
            is_pipe_filled: false,
            is_last_sample_limited: false,
            is_restarting: false,
            has_lost_packets: false,
            rounds_without_growth: 0,
            limited_in: 0,
            was_loss_high: false,
            bandwidth_to_beat: 0,
            excess_acked: WindowedMax::default(),
            bunch_start: Instant::default(),
            bunch_len: 0,
            random,
        }
    }

    #[inline]
    pub(super) fn window(&self) -> u64 {
        match (self.mode, &self.recovery) {
            (Mode::ProbeRtt { .. }, _) => self.min_window(),
            (_, Some(recovery)) => self.window.min(recovery.window),
            (_, None) => self.window,
        }
    }

    #[inline]
    fn min_window(&self) -> u64 {
        MIN_SEGMENTS * self.segment
    }

    pub(super) fn is_recovering(&self) -> bool {
        self.recovery.is_some()
    }

    fn min_rtt(&self, rtt: &Rtt) -> Duration {
        match (self.min_rtt.is_zero(), rtt.has_sample()) {
            (false, _) => self.min_rtt,
            (true, true) => rtt.min,
            (true, false) => DEFAULT_RTT,
        }
    }

    /// §4.2.1.
    pub(super) fn pacing_rate(&self, rtt: &Rtt) -> (u64, Duration) {
        let initial = match self.has_lost_packets {
            true => INITIAL_WINDOW,
            false => Gain::HIGH.of(INITIAL_WINDOW),
        };
        let min_rtt = self.min_rtt(rtt);
        match self.is_pipe_filled || delivered_in(min_rtt, self.pacing_rate) > initial {
            true => (self.pacing_rate, Duration::from_secs(1)),
            false => (initial, min_rtt),
        }
    }

    fn pacing_gain(&self) -> Gain {
        match self.mode {
            Mode::Startup => Gain::HIGH,
            Mode::Drain => Gain::DRAIN,
            Mode::ProbeBandwidth { phase: 0, .. } => Gain::PROBE_UP,
            Mode::ProbeBandwidth { phase: 1, .. } => Gain::PROBE_DOWN,
            Mode::ProbeBandwidth { .. } | Mode::ProbeRtt { .. } => Gain::UNIT,
        }
    }

    pub(super) fn on_application_limited(&mut self, last_sent: u64) {
        self.sampler.on_application_limited(last_sent);
        self.ran_dry_at = last_sent;
    }

    /// §4.3.4.4.
    pub(super) fn on_idle_restart(&mut self, now: Instant) {
        self.sampler.on_idle_restart(now);
        self.is_restarting = self.sampler.is_application_limited();
    }

    #[inline]
    pub(super) fn on_sent(&self, flight: &mut Flight) {
        self.sampler.on_sent(flight);
    }

    pub(super) fn on_late(&mut self, len: u64) {
        self.sampler.delivered += len;
        self.lost_in_round = self.lost_in_round.saturating_sub(len);
        self.recovery.take_if(|it| {
            it.lost = it.lost.saturating_sub(len);
            it.lost == 0
        });
    }

    pub(super) fn on_feedback(&mut self, now: Instant, feedback: &Feedback, rtt: &Rtt) {
        let (mut is_round_start, mut has_min_rtt_expired) = (false, false);
        if let Some(newest) = &feedback.newest_acked {
            is_round_start = newest.sequence > self.round_end;
            if is_round_start {
                self.round += 1;
                self.round_end = feedback.last_sent;
            }
            self.update_bandwidth(now, feedback.acked, newest);
            has_min_rtt_expired = self.update_min_rtt(now, now - newest.at);
            has_min_rtt_expired &= !core::mem::take(&mut self.is_restarting);
            self.update_excess_acked(now, feedback.acked);
        }
        // Loss alone does not tell that there is a queue.
        let is_congested = feedback.is_overflow
            || feedback.lost > 0
                && rtt.latest.as_micros() > Gain::PROBE_UP.of(self.min_rtt.as_micros());
        self.update_recovery(feedback, is_round_start, is_congested);
        if let Some(recovery) = &mut self.recovery {
            if feedback.is_persistent_congestion {
                recovery.window = MIN_SEGMENTS * self.segment;
                recovery.has_collapsed = true;
            }
            if recovery.has_collapsed
                || recovery.is_application_limited && recovery.conserves_packets
            {
                self.sampler.on_application_limited(feedback.last_sent);
            }
        }

        let min_rtt = self.min_rtt(rtt);
        let capacity = match delivered_in(min_rtt, self.bandwidth.get()) {
            0 => INITIAL_WINDOW,
            capacity => capacity,
        };
        self.advance_phase(now, feedback, min_rtt, capacity);
        if !self.is_pipe_filled {
            if is_round_start {
                self.check_pipe_filled();
            }
            self.acked_in_round += feedback.acked;
            self.lost_in_round += feedback.lost;
            self.was_congested_in_round |= is_congested;
            if feedback.is_persistent_congestion {
                self.lost_in_round = 0;
            }
        }
        if self.mode == Mode::Startup && self.is_pipe_filled {
            self.mode = Mode::Drain;
        }
        if self.mode == Mode::Drain && feedback.in_flight <= capacity.max(self.min_window()) {
            self.probe_bandwidth(now);
        }
        self.probe_rtt(now, feedback, is_round_start, has_min_rtt_expired);

        let pacing_rate = self.pacing_gain().of(self.bandwidth.get());
        self.pacing_rate = match self.is_pipe_filled {
            true => pacing_rate,
            false => pacing_rate.max(self.pacing_rate),
        };
        self.update_window(feedback.acked, capacity);
    }

    /// `None` unless the path is what limits the rate.
    pub(super) fn starts_cycle(&self, now: Instant) -> Option<bool> {
        match self.mode {
            Mode::ProbeBandwidth { phase, since } if !self.is_last_sample_limited => {
                Some(phase == 0 && since == now)
            }
            _ => None,
        }
    }

    /// §4.1.1.
    fn update_bandwidth(&mut self, now: Instant, acked: u64, newest: &Flight) {
        if let Some(sample) = self.sampler.on_delivered(now, acked, newest) {
            self.is_last_sample_limited = newest.is_application_limited;
            match newest.is_application_limited && sample < self.bandwidth.get() {
                true => self.bandwidth.extend(self.round),
                false => self.bandwidth.update(self.round, sample),
            }
        }
    }

    /// Returns whether it had expired (§4.1.2).
    fn update_min_rtt(&mut self, now: Instant, sample: Duration) -> bool {
        if sample.is_zero() {
            return false;
        }
        let is_unknown = self.min_rtt.is_zero();
        let expiry = match self.is_restarting {
            // There is no queue to drain, so the new sample comes for free.
            true => MIN_RTT_EXPIRY / 2,
            false => MIN_RTT_EXPIRY,
        };
        let has_expired = !is_unknown && now > self.min_rtt_at + expiry;
        if is_unknown || has_expired || sample < self.min_rtt {
            (self.min_rtt, self.min_rtt_at) = (sample, now);
        }
        has_expired
    }

    /// draft-cardwell-iccrg-bbr-congestion-control-02 §4.5.5.
    fn update_excess_acked(&mut self, now: Instant, acked: u64) {
        let mut expected = delivered_in(now - self.bunch_start, self.bandwidth.get());
        if self.bunch_len <= expected {
            (self.bunch_start, self.bunch_len, expected) = (now, 0, 0);
        }
        self.bunch_len += acked;
        (self.excess_acked).update(self.round, self.bunch_len - expected);
    }

    fn update_recovery(&mut self, feedback: &Feedback, is_round_start: bool, is_congested: bool) {
        let min_window = self.min_window();
        let Some(recovery) = &mut self.recovery else {
            if feedback.lost > 0 {
                let window = feedback.prior_in_flight.saturating_sub(feedback.lost);
                let floor = match self.is_pipe_filled {
                    true => (delivered_in(self.min_rtt, self.bandwidth.get()))
                        .saturating_add(self.excess_acked.get()),
                    false => 0,
                };
                let is_application_limited = self.ran_dry_at == feedback.last_sent;
                self.recovery = Some(Recovery {
                    window: (window.max(feedback.in_flight + 1)).max(floor.max(min_window)),
                    end: feedback.last_sent,
                    lost: feedback.lost,
                    has_collapsed: false,
                    conserves_packets: self.is_pipe_filled
                        || is_congested
                        || is_application_limited,
                    is_application_limited,
                });
                self.round_end = feedback.last_sent;
                self.has_lost_packets = true;
            }
            return;
        };
        if feedback.lost > 0 {
            recovery.end = feedback.last_sent;
            recovery.lost += feedback.lost;
        } else if (feedback.newest_acked).is_some_and(|it| it.sequence > recovery.end) {
            self.recovery = None;
            return;
        }
        recovery.conserves_packets &= !is_round_start;
        recovery.window = recovery.window.saturating_sub(feedback.lost);
        if !recovery.conserves_packets {
            recovery.window += feedback.acked;
        }
        let floor = min_window.max(feedback.in_flight + feedback.acked);
        recovery.window = recovery.window.max(floor);
    }

    /// §4.3.2.2, and draft-ietf-ccwg-bbr-06 §5.3.1.3 for those that never send for three rounds on end.
    fn check_pipe_filled(&mut self) {
        let acked = core::mem::take(&mut self.acked_in_round);
        let lost = core::mem::take(&mut self.lost_in_round);
        if self.round > self.limited_in + ROUNDS_WITHOUT_LIMIT && !self.was_loss_high {
            self.rounds_without_growth = 0;
        }
        if self.was_congested_in_round {
            self.limited_in = self.round;
        }
        let is_loss_high = core::mem::take(&mut self.was_congested_in_round)
            && lost >= HIGH_LOSS_SEGMENTS * self.segment
            && lost * HIGH_LOSS_RATIO > acked + lost;
        self.was_loss_high |= is_loss_high;
        if self.is_last_sample_limited && !is_loss_high {
            return;
        }
        let acked_to_beat =
            Gain::PROBE_UP.of(core::mem::replace(&mut self.acked_in_last_round, acked));
        // The window is on its way back to where the bandwidth was measured.
        let is_catching_up =
            self.window() < self.window && acked > acked_to_beat && !self.is_last_sample_limited;
        let bandwidth = self.bandwidth.get();
        if bandwidth >= self.bandwidth_to_beat {
            self.bandwidth_to_beat = Gain::PROBE_UP.of(bandwidth);
            self.rounds_without_growth = 0;
        } else if !is_catching_up {
            self.limited_in = self.round;
            self.rounds_without_growth += 1;
            self.is_pipe_filled = self.rounds_without_growth >= ROUNDS_WITHOUT_GROWTH;
        }
    }

    /// Starts anywhere in the cycle but at the phase that drains what the one before it queues (§4.3.4.2).
    fn probe_bandwidth(&mut self, now: Instant) {
        self.random = (self.random.wrapping_mul(1_664_525)).wrapping_add(1_013_904_223);
        let phase = (self.random >> 24) as u8 % (PHASES - 1);
        self.mode = Mode::ProbeBandwidth {
            phase: phase + u8::from(phase > 0),
            since: now,
        };
    }

    /// §4.3.4.3.
    fn advance_phase(&mut self, now: Instant, feedback: &Feedback, rtt: Duration, capacity: u64) {
        let Mode::ProbeBandwidth { phase, since } = self.mode else {
            return;
        };
        let (gain, is_full_length) = (self.pacing_gain(), now - since > rtt);
        let is_over = if gain > Gain::UNIT {
            let target = gain.of(capacity).max(self.min_window());
            is_full_length && (feedback.lost > 0 || feedback.prior_in_flight >= target)
        } else if gain < Gain::UNIT {
            is_full_length || feedback.in_flight <= capacity.max(self.min_window())
        } else {
            is_full_length
        };
        if is_over {
            self.mode = Mode::ProbeBandwidth {
                phase: (phase + 1) % PHASES,
                since: now,
            };
        }
    }

    /// §4.3.5.
    fn probe_rtt(
        &mut self,
        now: Instant,
        feedback: &Feedback,
        is_round_start: bool,
        has_min_rtt_expired: bool,
    ) {
        let (until, has_round_passed) = match self.mode {
            Mode::ProbeRtt {
                until,
                has_round_passed,
            } => (until, has_round_passed),
            _ if has_min_rtt_expired => (None, false),
            _ => return,
        };
        self.sampler.on_application_limited(feedback.last_sent);
        let has_round_passed = has_round_passed || (until.is_some() && is_round_start);
        if has_round_passed && until.is_some_and(|until| now >= until) {
            self.min_rtt_at = now;
            return match self.is_pipe_filled {
                true => self.probe_bandwidth(now),
                false => self.mode = Mode::Startup,
            };
        }
        let is_drained = feedback.in_flight < self.min_window() + self.segment;
        self.mode = Mode::ProbeRtt {
            until: until.or_else(|| is_drained.then(|| now + PROBE_RTT_TIME)),
            has_round_passed,
        };
    }

    /// §4.2.3.
    fn update_window(&mut self, acked: u64, capacity: u64) {
        let gain = match self.mode {
            Mode::Startup | Mode::Drain => Gain::HIGH,
            Mode::ProbeBandwidth { .. } => Gain::WINDOW,
            Mode::ProbeRtt { .. } => return,
        };
        let target = gain.of(capacity).max(self.min_window());
        if self.is_pipe_filled {
            let target = target.saturating_add(self.excess_acked.get());
            self.window = target.min(self.window + acked);
        } else if self.window < target || self.sampler.delivered < INITIAL_WINDOW {
            self.window += acked;
        }
        let max_window = Gain::MAX_WINDOW.of(capacity).max(UNCONDITIONAL_WINDOW);
        self.window = (self.window.min(max_window).min(MAX_WINDOW)).max(self.min_window());
    }
}
