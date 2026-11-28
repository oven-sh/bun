//! draft-cardwell-iccrg-bbr-congestion-control-00.

use super::bandwidth_sampler::{BandwidthSampler, micros};
use super::ceiling::Ceiling;
use super::foreign_delay::{ForeignDelay, saturate};
use super::rtt::GRANULARITY;
use super::windowed_filter::WindowedMax;
use super::{Feedback, Flight, INITIAL_WINDOW, MAX_WINDOW, MICROS_PER_SECOND, Rtt, SEGMENT};
use crate::time::{Duration, Instant};

const MIN_SEGMENTS: u64 = 4;
/// What the window has on top (§4.2.3.2). Among those who fill their windows, the shares are in proportion to that.
const EXTRA_SEGMENTS: u64 = 3;
/// They end up in the queue.
const MAX_EXTRA_TIME: Duration = Duration::from_millis(15);
/// After it has overflowed.
const ROUNDS_WITHOUT_EXTRA: u8 = 3;
/// Up to here, the window does not have to be in proportion to the path.
const UNCONDITIONAL_WINDOW: u64 = 2000 * SEGMENT;
const DEFAULT_RTT: Duration = Duration::from_millis(25);
const MIN_RTT_EXPIRY: Duration = Duration::from_secs(10);
const PROBE_RTT_TIME: Duration = Duration::from_millis(200);
/// The factor by which a flight can be slower than expected on a path that has not changed.
const MAX_SLOWDOWN: u64 = 4;
/// What is shorter may be due to the hosts.
const MIN_TRICKLE_TIME: Duration = Duration::from_millis(50);
const ROUNDS_WITHOUT_GROWTH: u8 = 3;
/// draft-ietf-ccwg-bbr-06 §5.3.2.
const MAX_DRAIN_ROUNDS: u64 = 3;
/// After how many they are forgotten, or twice as many if there was a queue.
const CLEAR_ROUNDS: u8 = 4;
/// To lose this many in a round, and more than one in `HIGH_LOSS_RATIO`, is no accident.
const HIGH_LOSS_SEGMENTS: u64 = 6;
const HIGH_LOSS_RATIO: u64 = 50;
const PHASES: u8 = 8;
const PHASES_IF_GROWING: u8 = 3;

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
    /// What probing has to yield to be repeated soon.
    const GROWTH: Self = Self(1229);
    const WINDOW: Self = Self(2048);
    const MAX_WINDOW: Self = Self(3072);

    fn of(self, value: u64) -> u64 {
        value.saturating_mul(self.0) / Self::UNIT.0
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Startup,
    Drain {
        last_round: u64,
    },
    ProbeBandwidth {
        phase: u8,
        since: Instant,
    },
    ProbeRtt {
        arrival: Arrival,
        /// Not set until the flight is small enough.
        until: Instant,
        has_round_passed: bool,
    },
}

/// Of what is in flight when no more is added.
#[derive(Default, Clone, Copy, PartialEq, Eq)]
struct Arrival {
    last_at: Instant,
    last_sent_at: Instant,
    len: u32,
    micros: u32,
    longest_pause_micros: u32,
    /// How much of the time is due to the application, which did not write any faster.
    writing_micros: u32,
    /// How much of the last pause is not.
    unexplained_micros: u32,
}

impl Arrival {
    fn add(&mut self, len: u64) {
        self.len = self.len.saturating_add(saturate(len));
    }

    fn on_feedback(&mut self, now: Instant, sent_at: Instant, is_limited: bool, it: &Feedback) {
        let pause = now - core::mem::replace(&mut self.last_at, now);
        let gap = micros(sent_at - core::mem::replace(&mut self.last_sent_at, sent_at));
        if pause >= GRANULARITY {
            self.unexplained_micros = 0;
        }
        // Or else it may have been the wait for the loss to be found.
        if it.lost == 0 {
            let pause = micros(pause);
            self.micros = self.micros.saturating_add(pause);
            self.longest_pause_micros = self.longest_pause_micros.max(pause);
            self.unexplained_micros = self.unexplained_micros.saturating_add(pause);
        }
        if is_limited {
            let explained = gap.min(self.unexplained_micros);
            self.unexplained_micros -= explained;
            self.writing_micros = self.writing_micros.saturating_add(explained);
        }
        self.add(it.acked);
    }

    fn duration(&self) -> Duration {
        Duration::from_micros(self.micros.into())
    }

    /// `None` if it has stalled, if nobody was there to take note, or if it has not been up to the path.
    fn bandwidth(&self) -> Option<u64> {
        (self.longest_pause_micros.max(self.writing_micros) < self.micros / 4)
            .then(|| u64::from(self.len) * MICROS_PER_SECOND / u64::from(self.micros))
    }
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

/// What has kept a flight from being longer. The greatest one counts.
#[derive(Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum Limit {
    #[default]
    None,
    Window,
    Application,
    Credit,
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
    /// In microseconds. It counts instead if it is longer.
    assumed_rtt: u32,
    foreign_delay: ForeignDelay,
    round: u64,
    /// The last packet of the round.
    round_end: u64,
    /// The last packet that the application had nothing to send after.
    ran_dry_at: u64,
    acked_in_round: u64,
    lost_in_round: u64,
    was_congested_in_round: bool,
    has_overflowed_in_round: bool,
    limit_in_round: Limit,
    /// The flight was too short to queue.
    has_drained_in_round: bool,
    acked_in_last_round: u32,
    is_pipe_filled: bool,
    is_last_sample_limited: bool,
    is_restarting: bool,
    /// Nothing was in flight before that for as long as probing the round-trip time takes.
    has_rested: bool,
    /// The last flight that the application did not limit took much longer than the path and the sender account for.
    was_delayed: bool,
    has_lost_packets: bool,
    rounds_without_growth: u8,
    /// Those that were about as long as `limited_len` and got through, since the last one without growth.
    clear_rounds: u8,
    /// Of the longest round that met a queue since they count. Shorter ones say nothing about it.
    limited_len: u32,
    bandwidth_to_beat: u64,
    ceiling: Ceiling,
    was_congested_in_cycle: bool,
    /// Those that are left.
    rounds_without_extra: u8,
    /// What is acknowledged in excess of the bandwidth, as paths and peers bunch acknowledgments.
    excess_acked: WindowedMax,
    bunch_start: Instant,
    bunch_len: u32,
    /// In microseconds. For how long nothing was acknowledged before it.
    bunch_pause: u32,
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
            assumed_rtt: 0,
            foreign_delay: ForeignDelay::default(),
            round: 0,
            round_end: 0,
            ran_dry_at: 0,
            acked_in_round: 0,
            lost_in_round: 0,
            was_congested_in_round: false,
            has_overflowed_in_round: false,
            limit_in_round: Limit::None,
            has_drained_in_round: false,
            acked_in_last_round: 0,
            is_pipe_filled: false,
            is_last_sample_limited: false,
            is_restarting: false,
            has_rested: false,
            was_delayed: false,
            has_lost_packets: false,
            rounds_without_growth: 0,
            clear_rounds: 0,
            limited_len: 0,
            bandwidth_to_beat: 0,
            ceiling: Ceiling::NONE,
            was_congested_in_cycle: false,
            rounds_without_extra: 0,
            excess_acked: WindowedMax::default(),
            bunch_start: Instant::default(),
            bunch_len: 0,
            bunch_pause: 0,
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

    #[inline]
    pub(super) fn is_draining(&self) -> bool {
        matches!(self.mode, Mode::Drain { .. } | Mode::ProbeRtt { .. })
    }

    pub(super) fn min_rtt(&self, rtt: &Rtt) -> Duration {
        match (self.min_rtt.is_zero(), rtt.has_sample()) {
            (false, _) => self.min_or_assumed_rtt(),
            (true, true) => rtt.min,
            (true, false) => DEFAULT_RTT,
        }
    }

    fn min_or_assumed_rtt(&self) -> Duration {
        (self.min_rtt).max(Duration::from_micros(self.assumed_rtt.into()))
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
            Mode::Drain { .. } => Gain::DRAIN,
            Mode::ProbeBandwidth { phase: 0, .. } => Gain::PROBE_UP,
            Mode::ProbeBandwidth { phase: 1, .. } => Gain::PROBE_DOWN,
            Mode::ProbeBandwidth { .. } | Mode::ProbeRtt { .. } => Gain::UNIT,
        }
    }

    pub(super) fn on_application_limited(&mut self, last_sent: u64) {
        self.sampler.on_application_limited(last_sent);
        self.ran_dry_at = last_sent;
    }

    #[inline]
    pub(super) fn on_limit(&mut self, limit: Limit) {
        self.limit_in_round = self.limit_in_round.max(limit);
    }

    pub(super) fn fills_path(&self, in_flight: u64) -> bool {
        let capacity = delivered_in(self.min_or_assumed_rtt(), self.bandwidth.get());
        capacity > 0 && in_flight >= Gain::PROBE_UP.of(capacity)
    }

    /// For when the rate of what follows is not up to the path.
    pub(super) fn on_held_back(&mut self, last_sent: u64) {
        self.sampler.on_application_limited(last_sent);
    }

    /// For time in which the sender did not get to run, which says nothing about the path.
    pub(super) fn skip_until(&mut self, time: Instant) {
        self.sampler.sent_at = self.sampler.sent_at.max(time);
    }

    /// §4.3.4.4.
    pub(super) fn on_idle_restart(&mut self, now: Instant) {
        self.has_rested = now >= self.sampler.delivered_at + PROBE_RTT_TIME;
        self.sampler.on_idle_restart(now);
        self.is_restarting = self.sampler.is_application_limited();
    }

    #[inline]
    pub(super) fn on_sent(&mut self, flight: &mut Flight, last_sent_at: Instant) {
        self.sampler.on_sent(flight);
        // Or else it has only gone for more.
        if flight.sequence == self.ran_dry_at + 1 && flight.at > last_sent_at + GRANULARITY {
            self.on_limit(Limit::Application);
        }
    }

    pub(super) fn on_late(&mut self, len: u64) {
        self.sampler.delivered += len;
        if let Mode::ProbeRtt { arrival, .. } = &mut self.mode {
            arrival.add(len);
        }
        self.lost_in_round = self.lost_in_round.saturating_sub(len);
        self.recovery.take_if(|it| {
            it.lost = it.lost.saturating_sub(len);
            it.lost == 0
        });
    }

    /// `lateness` is how long it may have waited to be read.
    pub(super) fn on_feedback(
        &mut self,
        now: Instant,
        feedback: &Feedback,
        rtt: &Rtt,
        lateness: Duration,
    ) {
        let (mut is_round_start, mut has_min_rtt_expired) = (false, false);
        if let Some(newest) = &feedback.newest_acked {
            is_round_start = newest.sequence > self.round_end;
            if is_round_start {
                if self.ran_dry_at <= self.round_end {
                    // The samples are going to tell.
                    self.limit_in_round = Limit::None;
                }
                self.round += 1;
                self.round_end = feedback.last_sent;
            }
            let pause = now - self.sampler.delivered_at;
            let bandwidth = self.update_bandwidth(now, feedback.acked, newest, is_round_start);
            let mut sample = now - newest.at;
            let is_latest = sample == rtt.latest;
            let on_path = match is_latest {
                true => rtt.latest_without_ack_delay(),
                false => sample,
            };
            let is_delayed = on_path > rtt.min * 2 + lateness + GRANULARITY;
            if !newest.is_application_limited {
                self.was_delayed = is_delayed;
            }
            let bandwidth = bandwidth.filter(|_| is_round_start);
            self.watch_delay(on_path, feedback.prior_in_flight, bandwidth);
            let starts_first_long_flight = self.is_restarting
                && is_latest
                && self.sampler.delivered < INITIAL_WINDOW + feedback.acked
                && self.ran_dry_at != feedback.last_sent
                && feedback.lost == 0;
            let is_probing = matches!(self.mode, Mode::ProbeRtt { .. });
            if is_probing || starts_first_long_flight {
                // The peer may wait for more packets than there are.
                sample = on_path;
            }
            // What is longer may be due to the queue of others.
            let is_free = self.is_restarting && sample <= rtt.min + rtt.min / 4 + lateness;
            has_min_rtt_expired = self.update_min_rtt(now, sample, is_free);
            let is_longer = sample > self.min_rtt + self.min_rtt / 4;
            self.assumed_rtt = match starts_first_long_flight && is_longer {
                // A window for the earlier samples would not get through.
                true => micros(sample),
                // Twice that is the window from now on.
                false if self.is_draining() => self.assumed_rtt.min(micros(on_path) / 2),
                false => self.assumed_rtt.min(micros(sample)),
            };
            // That only goes away if all hold back for a while.
            has_min_rtt_expired &=
                !core::mem::take(&mut self.is_restarting) || is_delayed && !self.has_rested;
            self.update_excess_acked(now, feedback.acked, pause);
        }
        self.foreign_delay.has_lost |= feedback.lost > 0;
        let min_rtt = self.min_rtt(rtt);
        // Loss alone does not tell that there is a queue.
        let has_met_queue =
            feedback.lost > 0 && rtt.latest.as_micros() > Gain::PROBE_UP.of(min_rtt.as_micros());
        let is_congested = feedback.is_overflow || has_met_queue;
        self.rounds_without_extra = match is_congested {
            true => ROUNDS_WITHOUT_EXTRA,
            false => (self.rounds_without_extra).saturating_sub(is_round_start.into()),
        };
        self.update_recovery(feedback, min_rtt, is_round_start, is_congested);
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

        let capacity = match delivered_in(min_rtt, self.bandwidth.get()) {
            0 => INITIAL_WINDOW,
            capacity => capacity,
        };
        let holds_cycle = has_met_queue || feedback.is_overflow && !feedback.loses_starts;
        self.was_congested_in_cycle |= holds_cycle;
        self.advance_phase(now, feedback, min_rtt, capacity, holds_cycle);
        if !self.is_pipe_filled {
            let has_queue = rtt.smoothed.as_micros() > Gain::PROBE_UP.of(min_rtt.as_micros());
            if is_round_start {
                self.check_pipe_filled(capacity, has_queue, feedback.loses_starts);
            }
            self.acked_in_round += feedback.acked;
            self.lost_in_round += feedback.lost;
            // The queue is gone by the time that the end of a flight is found to be lost.
            self.was_congested_in_round |= is_congested || feedback.lost > 0 && has_queue;
            self.has_overflowed_in_round |= feedback.is_overflow;
            self.has_drained_in_round |= !self.fills_path(feedback.in_flight);
            if feedback.is_persistent_congestion {
                self.lost_in_round = 0;
            }
        }
        if self.mode == Mode::Startup && self.is_pipe_filled {
            self.assumed_rtt /= 2;
            self.mode = Mode::Drain {
                last_round: self.round + MAX_DRAIN_ROUNDS,
            };
        }
        if let Mode::Drain { last_round } = self.mode
            && (feedback.in_flight <= capacity.max(self.min_window()) || self.round > last_round)
        {
            self.probe_bandwidth(now);
        }
        self.probe_rtt(now, feedback, rtt, is_round_start, has_min_rtt_expired);

        let pacing_rate = self.pacing_gain().of(self.bandwidth.get());
        self.pacing_rate = match self.is_pipe_filled {
            true => pacing_rate.max(self.foreign_delay.trial_rate()),
            false => (pacing_rate.max(self.pacing_rate))
                .min((self.ceiling.rate).max(self.min_startup_rate())),
        };
        self.update_window(feedback.acked, capacity);
    }

    fn min_startup_rate(&self) -> u64 {
        Gain::WINDOW.of(self.bandwidth.get())
    }

    #[inline]
    pub(super) fn is_cycling(&self) -> bool {
        matches!(self.mode, Mode::ProbeBandwidth { .. })
    }

    pub(super) fn suspects_short_queue(&self) -> bool {
        self.ceiling.suspects_short_queue()
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

    /// Returns the sample (§4.1.1).
    fn update_bandwidth(
        &mut self,
        now: Instant,
        acked: u64,
        newest: &Flight,
        is_round_start: bool,
    ) -> Option<u64> {
        let sample = self.sampler.on_delivered(now, acked, newest)?;
        self.is_last_sample_limited = newest.is_application_limited;
        if !newest.is_application_limited || sample >= self.bandwidth.get() {
            self.bandwidth.update(self.round, sample);
        } else if !self.was_delayed {
            self.bandwidth.extend(self.round);
        } else if is_round_start && !matches!(self.mode, Mode::ProbeRtt { .. }) {
            // Or else those who pause every few rounds never find out that they get less through.
            self.bandwidth.hold(self.round);
        }
        Some(sample)
    }

    /// Returns whether it had expired (§4.1.2).
    fn update_min_rtt(&mut self, now: Instant, sample: Duration, is_free: bool) -> bool {
        if sample.is_zero() {
            return false;
        }
        let is_unknown = self.min_rtt.is_zero();
        let expiry = match is_free {
            // There is no queue to drain.
            true => MIN_RTT_EXPIRY / 2,
            false => MIN_RTT_EXPIRY,
        };
        let has_expired = !is_unknown && now > self.min_rtt_at + expiry;
        if is_unknown || has_expired || sample < self.min_rtt {
            (self.min_rtt, self.min_rtt_at) = (sample, now);
        } else if self.is_last_sample_limited
            && sample <= self.min_rtt + self.min_rtt / 8
            && now > self.min_rtt_at + MIN_RTT_EXPIRY * 3 / 4
        {
            // Sending even less would not tell anything new.
            self.min_rtt_at = now;
        }
        has_expired
    }

    /// `bandwidth` is the sample that starts a round.
    fn watch_delay(&mut self, rtt: Duration, in_flight: u64, bandwidth: Option<u64>) {
        if matches!(self.mode, Mode::ProbeRtt { .. }) {
            self.foreign_delay = ForeignDelay::default();
            return;
        }
        if self.is_last_sample_limited {
            self.foreign_delay.on_limited();
        }
        if let Some(bandwidth) = bandwidth {
            let may_try = self.is_cycling();
            if let Some(it) = (self.foreign_delay).end_round(self.min_rtt, bandwidth, may_try) {
                self.assumed_rtt = micros(it.rtt);
                self.bandwidth = WindowedMax::default();
                self.bandwidth.update(self.round, it.bandwidth);
            }
            if self.foreign_delay.keeps_losing() {
                self.assumed_rtt = 0;
            }
        }
        if !self.is_last_sample_limited {
            self.foreign_delay.on_acked(rtt, in_flight);
        }
    }

    /// draft-cardwell-iccrg-bbr-congestion-control-02 §4.5.5. `pause` is the time since the last acknowledgment.
    fn update_excess_acked(&mut self, now: Instant, acked: u64, pause: Duration) {
        let bandwidth = self.bandwidth.get();
        let mut expected = delivered_in(now - self.bunch_start, bandwidth);
        if u64::from(self.bunch_len) <= expected {
            (self.bunch_start, self.bunch_len, expected) = (now, 0, 0);
            self.bunch_pause = micros(pause);
        }
        self.bunch_len = self.bunch_len.saturating_add(saturate(acked));
        // Any more was not held back. Those who share the queue have just left some room for a while.
        let held_back = delivered_in(Duration::from_micros(self.bunch_pause.into()), bandwidth);
        let excess = held_back.min(u64::from(self.bunch_len) - expected);
        self.excess_acked.update(self.round, excess);
    }

    fn update_recovery(
        &mut self,
        feedback: &Feedback,
        min_rtt: Duration,
        is_round_start: bool,
        is_congested: bool,
    ) {
        let min_window = self.min_window();
        let Some(recovery) = &mut self.recovery else {
            if feedback.lost > 0 {
                let window = feedback.prior_in_flight.saturating_sub(feedback.lost);
                let floor = match self.is_pipe_filled {
                    true => (delivered_in(min_rtt, self.bandwidth.get()))
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
    fn check_pipe_filled(&mut self, capacity: u64, has_queue: bool, loses_starts: bool) {
        let acked = core::mem::take(&mut self.acked_in_round);
        let lost = core::mem::take(&mut self.lost_in_round);
        let len = acked + lost;
        if self.rounds_without_growth == 0 {
            self.limited_len = 0;
        }
        let has_lost_many = lost >= HIGH_LOSS_SEGMENTS * self.segment;
        let is_share_high = lost * HIGH_LOSS_RATIO > len;
        if self.was_congested_in_round {
            self.clear_rounds = 0;
            if lost > 0 {
                self.limited_len = self.limited_len.max(saturate(len));
                match self.ceiling.rate < self.min_startup_rate() {
                    // It only keeps loss from being high enough to end startup.
                    true => self.ceiling = Ceiling::NONE,
                    false => self.ceiling.on_congestion(self.pacing_rate),
                }
            }
        } else {
            if acked >= capacity / 2 {
                self.ceiling.on_clear_round(self.pacing_rate, lost > 0);
            }
            self.clear_rounds += u8::from(
                self.is_last_sample_limited
                    && len >= u64::from(self.limited_len - self.limited_len / 8)
                    && !(has_lost_many && is_share_high),
            );
        }
        if self.clear_rounds >= CLEAR_ROUNDS << u8::from(self.limited_len > 0 && !loses_starts) {
            (self.clear_rounds, self.rounds_without_growth) = (0, 0);
        }
        let has_drained = core::mem::take(&mut self.has_drained_in_round);
        let limit = core::mem::take(&mut self.limit_in_round);
        // There is more to send than gets through.
        let has_overshot = matches!(limit, Limit::Window | Limit::Credit) && !has_drained;
        let is_limited = self.is_last_sample_limited && !has_overshot;
        if !is_limited {
            self.ceiling = Ceiling::NONE;
        }
        // It has taken long enough to measure the bandwidth.
        let was_too_much =
            core::mem::take(&mut self.has_overflowed_in_round) && acked >= Gain::HIGH.of(capacity);
        let is_loss_high = core::mem::take(&mut self.was_congested_in_round)
            && (has_lost_many || was_too_much)
            && is_share_high;
        if is_limited && !is_loss_high {
            return;
        }
        let acked_to_beat = Gain::PROBE_UP.of(self.acked_in_last_round.into());
        self.acked_in_last_round = saturate(acked);
        // The window is on its way back to where the bandwidth was measured.
        let is_catching_up =
            self.window() < self.window && acked > acked_to_beat && !self.is_last_sample_limited;
        let bandwidth = self.bandwidth.get();
        if bandwidth >= self.bandwidth_to_beat {
            self.bandwidth_to_beat = Gain::PROBE_UP.of(bandwidth);
            self.rounds_without_growth = 0;
        } else if !is_catching_up {
            self.clear_rounds = 0;
            if has_queue {
                self.limited_len = self.limited_len.max(saturate(len.max(capacity)));
            }
            self.rounds_without_growth += 1;
            self.is_pipe_filled = self.rounds_without_growth >= ROUNDS_WITHOUT_GROWTH;
        }
    }

    /// Starts anywhere in the cycle but at the phase that drains what the one before it queues (§4.3.4.2).
    fn probe_bandwidth(&mut self, now: Instant) {
        self.random = (self.random.wrapping_mul(1_664_525)).wrapping_add(1_013_904_223);
        let phase = (self.random >> 24) as u8 % (PHASES - 1);
        self.bandwidth_to_beat = Gain::GROWTH.of(self.bandwidth.get());
        self.mode = Mode::ProbeBandwidth {
            phase: match phase > 0 || self.was_congested_in_cycle {
                true => phase.max(1) + 1,
                false => 0,
            },
            since: now,
        };
    }

    /// §4.3.4.3.
    fn advance_phase(
        &mut self,
        now: Instant,
        feedback: &Feedback,
        rtt: Duration,
        capacity: u64,
        is_congested: bool,
    ) {
        let Mode::ProbeBandwidth { phase, since } = self.mode else {
            return;
        };
        let (gain, is_full_length) = (self.pacing_gain(), now - since > rtt);
        let is_over = if gain > Gain::UNIT {
            let target = gain.of(capacity).max(self.min_window());
            is_full_length
                && (feedback.lost > 0
                    || self.was_congested_in_cycle
                    || feedback.prior_in_flight >= target)
        } else if gain < Gain::UNIT {
            is_full_length || feedback.in_flight <= capacity.max(self.min_window())
        } else {
            // Or else every large response among small ones starts with what was too much for the last one.
            is_full_length
                && (!self.was_congested_in_cycle || feedback.prior_in_flight >= capacity / 2)
        };
        if is_over {
            let bandwidth = self.bandwidth.get();
            let has_paid = phase == PHASES_IF_GROWING - 1
                && bandwidth >= self.bandwidth_to_beat
                && !self.was_congested_in_cycle
                && !self.is_last_sample_limited;
            let phase = if has_paid { 0 } else { (phase + 1) % PHASES };
            if phase == 0 {
                self.bandwidth_to_beat = Gain::GROWTH.of(bandwidth);
            }
            self.was_congested_in_cycle &= phase > 0 || is_congested;
            self.mode = Mode::ProbeBandwidth { phase, since: now };
        }
    }

    /// §4.3.5.
    fn probe_rtt(
        &mut self,
        now: Instant,
        feedback: &Feedback,
        rtt: &Rtt,
        is_round_start: bool,
        has_min_rtt_expired: bool,
    ) {
        if let Mode::ProbeRtt { arrival, until, .. } = &mut self.mode {
            if *until == Instant::NEVER {
                let is_limited = self.is_last_sample_limited;
                arrival.on_feedback(now, self.sampler.sent_at, is_limited, feedback);
            }
        } else if has_min_rtt_expired {
            self.mode = Mode::ProbeRtt {
                arrival: Arrival {
                    last_at: now,
                    last_sent_at: self.sampler.sent_at,
                    ..Arrival::default()
                },
                until: Instant::NEVER,
                has_round_passed: false,
            };
        }
        let min_window = self.min_window();
        let Mode::ProbeRtt {
            arrival,
            until,
            has_round_passed,
        } = &mut self.mode
        else {
            return;
        };
        self.sampler.on_application_limited(feedback.last_sent);
        if *until == Instant::NEVER {
            if feedback.in_flight < min_window + self.segment {
                *until = now + PROBE_RTT_TIME;
                if arrival.bandwidth().is_some() {
                    self.round_end = feedback.last_sent;
                }
            }
            return;
        }
        *has_round_passed |= is_round_start;
        if *has_round_passed && now >= *until {
            let arrival = *arrival;
            self.min_rtt_at = now;
            match self.lower_bandwidth(now, &arrival, rtt) {
                Some(bandwidth) => self.start_over(bandwidth),
                None if self.is_pipe_filled => self.probe_bandwidth(now),
                None => self.mode = Mode::Startup,
            }
        }
    }

    /// Of a path that has slowed down so much that it would take too long for the former one to expire.
    fn lower_bandwidth(&self, now: Instant, arrival: &Arrival, rtt: &Rtt) -> Option<u64> {
        let bandwidth = arrival.bandwidth()?;
        let own_queue = self.min_window() * MICROS_PER_SECOND / bandwidth.max(1);
        let rtt = rtt.min.max(self.min_rtt - Duration::from_micros(own_queue));
        (bandwidth < self.bandwidth.get() / MAX_SLOWDOWN
            && arrival.duration() > MIN_TRICKLE_TIME.max(rtt * MAX_SLOWDOWN)
            && now <= arrival.last_at + MIN_RTT_EXPIRY / 2)
            .then_some(bandwidth)
    }

    fn start_over(&mut self, bandwidth: u64) {
        *self = Self {
            sampler: core::mem::replace(&mut self.sampler, BandwidthSampler::new()),
            window: delivered_in(self.min_rtt, bandwidth),
            recovery: self.recovery.take(),
            min_rtt: self.min_rtt,
            min_rtt_at: self.min_rtt_at,
            round_end: self.round_end,
            ran_dry_at: self.ran_dry_at,
            has_lost_packets: self.has_lost_packets,
            ..Self::new(self.segment, self.random)
        };
        self.bandwidth.update(self.round, bandwidth);
    }

    /// §4.2.3.
    fn update_window(&mut self, acked: u64, capacity: u64) {
        let gain = match self.mode {
            Mode::Startup | Mode::Drain { .. } => Gain::HIGH,
            Mode::ProbeBandwidth { .. } => Gain::WINDOW,
            Mode::ProbeRtt { .. } => return,
        };
        let target = gain.of(capacity);
        let trial_len = u64::from(self.foreign_delay.trial_len);
        if self.is_pipe_filled {
            let extra = match self.rounds_without_extra {
                0 => delivered_in(MAX_EXTRA_TIME, self.bandwidth.get()),
                _ => 0,
            };
            let target = (target + extra.min(EXTRA_SEGMENTS * self.segment)).max(self.min_window());
            let target = (target.saturating_add(self.excess_acked.get())).max(trial_len);
            self.window = target.min(self.window + acked);
        } else if self.window < target.max(self.min_window())
            || self.sampler.delivered < INITIAL_WINDOW
        {
            self.window += acked;
        }
        let max_window = (Gain::MAX_WINDOW.of(capacity)).max(UNCONDITIONAL_WINDOW.max(trial_len));
        self.window = (self.window.min(max_window).min(MAX_WINDOW)).max(self.min_window());
    }
}
