use std::collections::{BTreeSet, VecDeque};
use std::ops::{Range, RangeInclusive};

use super::bandwidth_sampler::BandwidthSampler;
use super::catch_up::CatchUp;
use super::ceiling::Ceiling;
use super::crowd::Crowd;
use super::foreign_delay::{ForeignDelay, Verdict};
use super::pacer::MAX_OVERFLOWS;
use super::spread::Spread;
use super::trial::Trial;
use super::windowed_filter::WindowedMax;
use super::*;
use crate::time::Duration;

const ALGORITHMS: [Algorithm; 2] = [Algorithm::Cubic, Algorithm::Bbr];
const START: Instant = Instant::from_micros(1_000_000);

const fn micros(micros: u64) -> Duration {
    Duration::from_micros(micros)
}

const fn millis(millis: u64) -> Duration {
    Duration::from_millis(millis)
}

#[track_caller]
fn assert_within(value: u64, range: RangeInclusive<u64>) {
    assert!(range.contains(&value), "{value} is not in {range:?}");
}

/// In bytes per second.
fn pacing_rate(controller: &Controller, rtt: &Rtt) -> u64 {
    let (len, per) = match &controller.model {
        Model::Cubic(cubic) => cubic.pacing_rate(rtt),
        Model::Bbr(bbr) => bbr.pacing_rate(rtt),
    };
    len * MICROS_PER_SECOND / per.as_micros()
}

struct Random(u64);

impl Random {
    fn below(&mut self, limit: u64) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0 % limit
    }
}

/// Sends segments when it is told to, whatever the pacer says.
struct Sender {
    controller: Controller,
    rtt: Rtt,
    now: Instant,
    flights: VecDeque<Flight>,
}

impl Sender {
    fn new(algorithm: Algorithm) -> Self {
        Self {
            controller: Controller::new(algorithm, 1200, 0),
            rtt: Rtt::default(),
            now: START,
            flights: VecDeque::new(),
        }
    }

    fn send(&mut self, count: u64) -> &mut Self {
        for _ in 0..count {
            let flight = (self.controller).on_sent(self.now, SEGMENT as u16, &self.rtt);
            self.flights.push_back(flight);
        }
        self
    }

    fn fill(&mut self) -> &mut Self {
        while self.controller.permit(self.now, 0, || true) != Permit::Blocked {
            self.send(1);
        }
        self
    }

    /// Returns how many packets are permitted right now.
    fn burst(&mut self) -> u64 {
        let before = self.controller.in_flight();
        while self.controller.permit(self.now, 0, || true) == Permit::Now {
            self.send(1);
        }
        (self.controller.in_flight() - before) / SEGMENT
    }

    fn run_dry(&mut self) -> &mut Self {
        self.controller.on_application_limited();
        self
    }

    fn wait(&mut self, duration: Duration) -> &mut Self {
        self.now = self.now + duration;
        self
    }

    /// The oldest packets are lost, and those that follow are acknowledged.
    fn feedback(&mut self, lost: usize, acked: usize) -> &mut Self {
        for flight in self.flights.drain(..lost) {
            self.controller.on_lost(&flight, false);
        }
        for flight in self.flights.drain(..acked.min(self.flights.len())) {
            self.controller.on_acked(&flight);
            self.rtt.update(self.now - flight.at, Duration::ZERO);
        }
        self.controller.end_ack(self.now, &self.rtt);
        self
    }

    fn rounds(&mut self, count: u64, rtt: Duration) -> &mut Self {
        for _ in 0..count {
            self.fill().wait(rtt).feedback(0, usize::MAX);
        }
        self
    }

    fn rounds_of(&mut self, segments: u64, count: u64, rtt: Duration) -> &mut Self {
        for _ in 0..count {
            self.send(segments).wait(rtt).feedback(0, usize::MAX);
        }
        self
    }

    fn window(&self) -> u64 {
        self.controller.window()
    }

    fn segments(&self) -> u64 {
        self.window() / SEGMENT
    }

    fn pacing_rate(&self) -> u64 {
        pacing_rate(&self.controller, &self.rtt)
    }
}

const LEN: u64 = 1250;

/// A bottleneck with a sender on one side, and on the other a peer that acknowledges each packet.
struct Path {
    controller: Controller,
    rtt: Rtt,
    now: Instant,
    time_per_packet: Duration,
    delay: Duration,
    /// In packets.
    buffer: u64,
    /// Of a thousand packets, for no reason.
    drops: u64,
    /// In microseconds. Acknowledgments arrive at multiples.
    ack_period: u64,
    /// Likewise for when the sender gets to run.
    wake_period: u64,
    /// For how long the sender does not get to run, and at the multiples of what.
    busy: (u64, u64),
    random: Random,
    free_at: Instant,
    /// When the sender learns whether they have arrived.
    pending: VecDeque<(Instant, Flight, bool)>,
    unsent: u64,
    delivered: u64,
    lost: u64,
    longest_burst: u64,
}

fn round_up(time: Instant, period: u64) -> Instant {
    Instant::from_micros(time.as_micros().next_multiple_of(period))
}

impl Path {
    fn new(algorithm: Algorithm, time_per_packet: Duration, delay: Duration, buffer: u64) -> Self {
        Self {
            controller: Controller::new(algorithm, LEN as u16, 0),
            rtt: Rtt::default(),
            now: START,
            time_per_packet,
            delay,
            buffer,
            drops: 0,
            ack_period: 1,
            wake_period: 1,
            busy: (0, 1),
            random: Random(1),
            free_at: START,
            pending: VecDeque::new(),
            unsent: 0,
            delivered: 0,
            lost: 0,
            longest_burst: 0,
        }
    }

    /// 100 Mbit/s, which makes 200 packets per round trip.
    fn fast(algorithm: Algorithm, buffer: u64) -> Self {
        Self::new(algorithm, micros(100), millis(20), buffer)
    }

    /// 10 Mbit/s, which makes 40 packets per round trip.
    fn slow(algorithm: Algorithm, buffer: u64) -> Self {
        Self::new(algorithm, millis(1), millis(40), buffer)
    }

    fn send(&mut self) {
        let flight = self.controller.on_sent(self.now, LEN as u16, &self.rtt);
        self.unsent -= 1;
        self.free_at = self.free_at.max(self.now);
        let arrives = self.free_at - self.now <= self.time_per_packet * self.buffer
            && self.random.below(1000) >= self.drops;
        if arrives {
            self.free_at = self.free_at + self.time_per_packet;
        }
        let known_at = round_up(self.free_at + self.delay, self.ack_period);
        self.pending.push_back((known_at, flight, arrives));
    }

    fn step(&mut self) {
        while let Some((_, flight, has_arrived)) = self.pending.pop_front_if(|it| it.0 <= self.now)
        {
            if has_arrived {
                self.controller.on_acked(&flight);
                self.rtt.update(self.now - flight.at, Duration::ZERO);
                self.delivered += 1;
            } else {
                let ends_burst = self.pending.front().is_some_and(|it| it.1.starts_burst());
                self.controller.on_lost(&flight, ends_burst);
                self.lost += 1;
                self.unsent += 1;
            }
        }
        self.controller.end_ack(self.now, &self.rtt);
        let (mut next, mut burst) = (Instant::NEVER, 0);
        while self.unsent > 0 {
            match (self.controller).permit(self.now, self.unsent.saturating_mul(LEN), || false) {
                Permit::Now => self.send(),
                Permit::At(time) => {
                    next = time;
                    break;
                }
                Permit::Blocked => break,
            }
            burst += 1;
        }
        if self.unsent == 0 {
            self.controller.on_application_limited();
        }
        self.longest_burst = self.longest_burst.max(burst);
        if let Some((known_at, ..)) = self.pending.front() {
            self.now = round_up(next.min(*known_at), self.wake_period);
            let (len, period) = self.busy;
            self.now = self.now + micros(len.saturating_sub(self.now.as_micros() % period));
        }
    }

    /// Never runs out of data. Returns how much of the capacity was used, in percent.
    fn saturate(&mut self, duration: Duration, mut observe: impl FnMut(&Self)) -> u64 {
        let (end, before) = (self.now + duration, self.delivered);
        self.unsent = u64::MAX / 2;
        while self.now < end {
            self.step();
            observe(self);
        }
        let busy = self.time_per_packet * (self.delivered - before);
        busy.as_micros() * 100 / duration.as_micros()
    }

    /// Returns how long it takes until all is acknowledged.
    fn transfer(&mut self, packets: u64, mut observe: impl FnMut(&Self)) -> Duration {
        let start = self.now;
        self.unsent = packets;
        while self.unsent > 0 || !self.pending.is_empty() {
            self.step();
            observe(self);
        }
        self.now - start
    }

    /// In percent of the rate of the bottleneck.
    fn pace(&self) -> u64 {
        let per_second = MICROS_PER_SECOND / self.time_per_packet.as_micros() * LEN;
        (pacing_rate(&self.controller, &self.rtt) * 100 + per_second / 2) / per_second
    }
}

#[test]
fn rtt_is_adjusted_by_the_ack_delay() {
    let mut rtt = Rtt::default();
    for (sample, ack_delay, smoothed, probe_timeout, loss_delay) in [
        (None, 0, 0, 150_000, 56_250),
        (Some(8000), 5000, 8000, 24_000, 9000),
        (Some(16_000), 8000, 8000, 20_000, 18_000),
        (Some(16_000), 8001, 9000, 26_000, 18_000),
        (Some(0), 0, 7875, 29_623, 8859),
    ] {
        if let Some(sample) = sample {
            rtt.update(micros(sample), micros(ack_delay));
        }
        assert_eq!(
            [rtt.smoothed, rtt.probe_timeout(), rtt.loss_delay()],
            [smoothed, probe_timeout, loss_delay].map(micros),
        );
    }
}

#[test]
fn probes_do_not_wait_for_the_variation_to_settle() {
    let mut rtt = Rtt::default();
    for (samples, expected) in [
        (0, [150_000, 175_000, 250_000]),
        (1, [200_000, 200_000, 250_000]),
        (8, [120_016, 145_016, 220_016]),
    ] {
        (0..samples).for_each(|_| rtt.update(micros(100_000), Duration::ZERO));
        assert_eq!(
            [0, 25_000, 100_000].map(|it| rtt.probe_delay(micros(it))),
            expected.map(micros),
        );
    }
    let mut rtt = Rtt::default();
    rtt.update(micros(200), Duration::ZERO);
    assert_eq!(rtt.probe_delay(millis(25)), micros(26_200));
}

#[test]
fn loss_delay_grows_with_packets_that_are_late() {
    let mut rtt = Rtt::default();
    rtt.update(millis(8), Duration::ZERO);
    rtt.update(millis(16), Duration::ZERO);
    for (elapsed, loss_delay) in [(1, 18), (15, 18), (16, 20), (20, 24), (16, 24), (99, 36)] {
        rtt.on_late(millis(elapsed));
        assert_eq!(rtt.loss_delay(), millis(loss_delay));
    }
    let mut unknown = Rtt::default();
    unknown.on_late(millis(1));
    assert_eq!(unknown.loss_delay(), micros(112_500));
}

#[test]
fn filter_keeps_the_maximum_of_ten_rounds() {
    for (updates, expected) in [
        (&[][..], 0),
        (&[(1, 5)], 5),
        (&[(1, 5), (2, 7)], 7),
        (&[(1, 7), (11, 5)], 7),
        (&[(1, 7), (12, 5)], 5),
        (&[(1, 7), (11, 7), (21, 5)], 7),
        (&[(1, 9), (3, 5), (12, 1)], 1),
        (&[(1, 9), (4, 5), (12, 1)], 5),
        (&[(1, 9), (4, 5), (14, 1)], 5),
        (&[(1, 9), (4, 5), (6, 3), (15, 1)], 1),
        (&[(1, 9), (4, 5), (5, 6), (12, 1)], 6),
        (&[(1, 9), (4, 5), (7, 3), (15, 1)], 3),
        (&[(1, 9), (4, 5), (7, 3), (8, 4), (15, 1)], 4),
        (&[(1, 9), (4, 5), (7, 3), (12, 1), (15, 1)], 3),
        (&[(1, 9), (4, 5), (7, 3), (100, 1)], 1),
    ] {
        let mut filter = WindowedMax::default();
        for &(round, value) in updates {
            filter.update(round, value);
        }
        assert_eq!(filter.get(), expected, "{updates:?}");
    }
}

#[test]
fn filter_outlasts_its_integers() {
    let mut filter = WindowedMax::default();
    let start = u64::from(u32::MAX) - 5;
    filter.update(start, u64::MAX);
    filter.extend(start + 7);
    filter.update(start + 10, 1);
    assert_eq!(filter.get(), u32::MAX.into());
    filter.update(start + 11, 1);
    assert_eq!(filter.get(), 1);
}

#[test]
fn filter_outlasts_a_gap() {
    let mut filter = WindowedMax::default();
    filter.update(1, 9);
    filter.extend(2);
    filter.extend(50);
    for (round, value, expected) in [(51, 1, 9), (52, 4, 9), (53, 2, 9), (54, 3, 4)] {
        filter.update(round, value);
        assert_eq!(filter.get(), expected);
    }
}

#[test]
fn filter_gains_no_time_by_being_held() {
    let mut filter = WindowedMax::default();
    let start = u64::from(u32::MAX) - 20;
    filter.update(start, 9);
    (1..40).for_each(|it| filter.hold(start + it));
    for (round, expected) in [(40, 9), (42, 9), (44, 9), (46, 1)] {
        filter.update(start + round, 1);
        assert_eq!(filter.get(), expected);
        filter.hold(start + round + 1);
    }
}

/// Returns how many packets go out, and how long the next one has to wait.
fn pace(pacer: &mut Pacer, now: Instant) -> (u64, Duration) {
    let mut count = 0;
    loop {
        if let Some(next) = pacer.delay(now) {
            return (count, next - now);
        }
        pacer.on_sent(now, 1000);
        count += 1;
    }
}

fn losing(lost: u64) -> Feedback {
    Feedback {
        lost,
        ..Feedback::default()
    }
}

fn pacer_at(len: u64, per: Duration) -> Pacer {
    let mut pacer = Pacer::default();
    let mut rtt = Rtt::default();
    rtt.update(micros(16_668), Duration::ZERO);
    pacer.set_rate(len, per, &rtt);
    pacer
}

#[test]
fn pacer_sends_more_at_once_on_short_paths() {
    for (rtt, expected) in [(511, 66), (512, 33), (2000, 9), (4000, 1)] {
        let (mut pacer, mut estimate) = (Pacer::default(), Rtt::default());
        estimate.update(micros(rtt), Duration::ZERO);
        pacer.set_rate(1000, millis(5), &estimate);
        assert_eq!(pace(&mut pacer, START).0, expected, "{rtt}");
    }
}

#[test]
fn pacer_looks_ahead_by_the_granularity() {
    for (len, per, expected) in [
        (1000, millis(5), (1, millis(5))),
        (1000, micros(500), (4, micros(2000))),
        (4096, micros(1), (4158, micros(1015))),
        (0, micros(2), (1, millis(2))),
    ] {
        assert_eq!(pace(&mut pacer_at(len, per), START), expected);
    }
}

#[test]
fn pacer_lets_small_writes_gather_for_no_longer_than_the_granularity() {
    for (per, expected) in [(micros(500), 600), (millis(50), 6000)] {
        let mut pacer = pacer_at(1000, per);
        pacer.on_sent(START, 0);
        for _ in 0..10 {
            pacer.on_application_limited(false);
            pacer.on_sent(START, 100);
        }
        assert_eq!(pacer.delay(START), Some(START + micros(expected) * 10));
    }
}

fn watching_crowd() -> Crowd {
    let mut crowd = Crowd::default();
    crowd.on_feedback(START, &steady(millis(16)));
    crowd
}

/// On a path that has once taken 16 ms.
fn steady(smoothed: Duration) -> Rtt {
    let mut rtt = Rtt::default();
    rtt.update(millis(16), Duration::ZERO);
    (rtt.latest, rtt.smoothed, rtt.variation) = (smoothed, smoothed, millis(1));
    rtt
}

#[test]
fn many_small_packets_are_a_crowd() {
    for (packets, unsent, in_flight, expected) in [
        (12, 599, 7199, true),
        (11, 599, 6599, false),
        (12, 600, 7199, false),
        (12, 599, 7200, false),
    ] {
        let mut crowd = Crowd::default();
        (0..=packets).for_each(|_| crowd.on_sent());
        crowd.on_settled();
        assert_eq!(crowd.would_grow(unsent, in_flight), expected);
    }
}

#[test]
fn small_writes_wait_if_there_seems_to_be_a_queue() {
    for (rtt, expected) in [(20_001, 1250), (20_000, 0), (400_000, 20_000)] {
        let wait = watching_crowd().wait(START, &steady(micros(rtt)), || false);
        assert_eq!(wait, micros(expected));
    }
    for (ack_delay, expected) in [(0, millis(20) / 16), (16, Duration::ZERO)] {
        let mut rtt = steady(millis(16));
        rtt.update(millis(48), millis(ack_delay));
        rtt.variation = millis(13);
        assert_eq!(watching_crowd().wait(START, &rtt, || false), expected);
    }
}

/// For how many round trips of `rtt` small writes wait from `now` on.
fn trial_len(crowd: &mut Crowd, now: &mut Instant, rtt: u64) -> u64 {
    let (rtt, start) = (steady(millis(rtt)), *now);
    while !crowd.wait(*now, &rtt, || false).is_zero() {
        *now = *now + rtt.smoothed;
        crowd.on_feedback(*now, &rtt);
    }
    (*now - start).as_micros() / rtt.smoothed.as_micros()
}

#[test]
fn small_writes_stop_waiting_if_the_path_has_become_longer() {
    let (mut crowd, mut now) = (watching_crowd(), START);
    assert_eq!(trial_len(&mut crowd, &mut now, 80), 4);
    now = now + millis(1000);
    assert_eq!(trial_len(&mut crowd, &mut now, 92), 0);
    assert_eq!(trial_len(&mut crowd, &mut now, 93), 4);
    now = now + millis(1000);
    crowd.on_feedback(now, &steady(millis(40)));
    assert_eq!(trial_len(&mut crowd, &mut now, 80), 4);
}

#[test]
fn small_writes_wait_for_longer_if_the_queue_grows_when_they_stop() {
    let (mut crowd, mut now) = (watching_crowd(), START);
    let lens = [30, 40, 50, 60, 70].map(|rtt| trial_len(&mut crowd, &mut now, rtt));
    assert_eq!(lens, [4, 16, 64, 256, 256]);
    now = now + millis(90 * 4);
    assert_eq!(trial_len(&mut crowd, &mut now, 90), 4);
    // It is back to what it was before, which was not the path after all.
    assert!(!crowd.wait(now, &steady(millis(110)), || false).is_zero());
    assert_eq!(trial_len(&mut crowd, &mut now, 90), 16);
}

#[test]
fn small_writes_stop_waiting_if_the_queue_is_gone() {
    for (smoothed, is_gone) in [(19_000, true), (19_001, false)] {
        let (mut crowd, rtt) = (watching_crowd(), steady(micros(smoothed)));
        assert!(!crowd.wait(START, &steady(millis(30)), || false).is_zero());
        crowd.on_feedback(START, &rtt);
        assert_eq!(crowd.wait(START, &rtt, || false).is_zero(), is_gone);
        assert!(
            !crowd
                .wait(START, &steady(micros(20_001)), || false)
                .is_zero()
        );
    }
}

#[test]
fn one_short_sample_does_not_mean_that_the_queue_is_gone() {
    let (mut crowd, mut rtt) = (watching_crowd(), steady(millis(30)));
    assert!(!crowd.wait(START, &rtt, || false).is_zero());
    rtt.latest = millis(16);
    crowd.on_feedback(START, &rtt);
    assert!(!crowd.wait(START, &rtt, || false).is_zero());
}

#[test]
fn small_writes_go_on_waiting_if_the_queue_has_come_back_before() {
    let (mut crowd, mut now) = (watching_crowd(), START);
    for len in [1, 16, 64] {
        assert!(!crowd.wait(now, &steady(millis(30)), || false).is_zero());
        assert_eq!(trial_len(&mut crowd, &mut now, 16), len);
    }
}

#[test]
fn small_writes_in_a_series_wait_after_a_loss() {
    for (packets, len, elapsed, continues_series, waits) in [
        (12, 0, 32 * 16 - 1, true, true),
        (12, 0, 32 * 16, true, false),
        (12, 0, 0, false, false),
        (11, 0, 0, true, false),
        (12, 599, 0, true, true),
        (12, 600, 0, true, false),
    ] {
        let (mut crowd, rtt) = (watching_crowd(), steady(millis(16)));
        (0..packets).for_each(|_| crowd.on_sent());
        crowd.on_loss(START, packets * len, &rtt);
        let wait = crowd.wait(START + millis(elapsed), &rtt, || continues_series);
        assert_eq!(!wait.is_zero(), waits);
    }
}

#[test]
fn small_writes_do_not_wait_on_short_paths() {
    for (smoothed, expected) in [(7999, 0), (8000, 500)] {
        let mut rtt = steady(micros(smoothed));
        rtt.latest = millis(30);
        let wait = watching_crowd().wait(START, &rtt, || false);
        assert_eq!(wait, micros(expected));
    }
}

#[test]
fn waiting_for_more_is_not_made_up_for() {
    let mut sender = Sender::new(Algorithm::Cubic);
    sender.rounds_of(10, 1, millis(40)).wait(millis(40)).burst();
    (sender.rtt.latest, sender.rtt.smoothed) = (millis(320), millis(320));
    sender.now = (sender.controller).gathers_until(sender.now, &sender.rtt, || false);
    assert_eq!(sender.burst(), 2);
}

#[test]
fn small_writes_stop_waiting_after_a_long_pause() {
    for (idle, waits) in [(120_000, true), (120_001, false)] {
        let (mut crowd, rtt) = (watching_crowd(), steady(millis(30)));
        assert!(!crowd.wait(START, &rtt, || false).is_zero());
        crowd.on_idle_restart(micros(idle), &rtt);
        assert_eq!(!crowd.wait(START, &rtt, || false).is_zero(), waits);
        crowd.on_feedback(START, &rtt);
        assert!(!crowd.wait(START, &rtt, || false).is_zero());
    }
}

#[test]
fn ack_delay_is_left_out_if_it_is_plausible() {
    for (ack_delay, expected) in [
        (0, 48_000),
        (31_000, 17_000),
        (34_000, 16_000),
        (34_001, 48_000),
    ] {
        let mut rtt = steady(millis(16));
        rtt.update(millis(48), micros(ack_delay));
        assert_eq!(rtt.latest_without_ack_delay(), micros(expected));
    }
}

#[test]
fn path_that_has_become_longer_goes_by_the_latest_sample() {
    let (mut crowd, mut rtt) = (watching_crowd(), steady(millis(18)));
    rtt.latest = millis(80);
    for (elapsed, waits) in [(0, true), (71, true), (72, false)] {
        crowd.on_feedback(START + millis(elapsed), &rtt);
        let wait = crowd.wait(START + millis(elapsed), &rtt, || false);
        assert_eq!(!wait.is_zero(), waits);
    }
}

#[test]
fn pacer_allows_a_burst_after_a_pause() {
    let mut pacer = pacer_at(1000, millis(5));
    pacer.on_idle_restart(START, false);
    assert_eq!(pace(&mut pacer, START), (11, millis(5)));
    pacer.on_idle_restart(START, true);
    assert_eq!(pace(&mut pacer, START), (1, millis(5)));
    pacer.on_idle_restart(START, false);
    pacer.on_feedback(&losing(1));
    assert_eq!(pace(&mut pacer, START), (1, millis(5)));
    pacer.on_overflow(true, 0);
    for (lost_starts, burst) in [(0, 6), (15, 6), (1, 11)] {
        (0..lost_starts).for_each(|_| pacer.on_start_settled(true));
        pacer.on_idle_restart(START, false);
        assert_eq!(pace(&mut pacer, START), (burst, millis(5)));
    }
}

#[test]
fn pacer_knows_how_much_it_lets_go_out() {
    let mut pacer = pacer_at(1000, millis(5));
    assert_eq!(pacer.allowance(START, true, 1000), 11_400);
    pacer.on_idle_restart(START, false);
    pacer.on_sent(START, 1000);
    assert_eq!(pacer.allowance(START, false, 1000), 10_400);
    let delay = pace(&mut pacer, START).1;
    for (late, expected) in [(0, 1400), (10, 3400), (50, 11_400), (51, 1400)] {
        let now = START + delay + millis(late);
        assert_eq!(pacer.allowance(now, false, 1000), expected);
    }
    let early = START + delay - millis(1);
    assert_eq!(pacer.allowance(early, false, 1000), 1400);
    assert_eq!(pacer.allowance(early - micros(1), false, 1000), 0);
    assert_eq!(pacer.allowance(early - micros(1), true, 1000), 11_400);
    assert!(pacer.delay(early).is_none());
    assert_eq!(pacer.allowance(early - micros(1), false, 1000), 1400);
}

#[test]
fn pacer_is_early_by_single_packets_while_the_burst_is_unheard_of() {
    for (len, has_run_dry, is_recovering, is_heard_of, early, on_time) in [
        (9500, true, false, false, 1, 10),
        (9500, false, false, false, 10, 10),
        (9500, true, false, true, 10, 10),
        (9500, true, true, false, 10, 10),
        (200_000, true, false, false, 20, 201),
        (200_000, true, false, true, 66, 264),
    ] {
        let mut pacer = pacer_at(len, millis(1));
        pacer.on_application_limited(false);
        if !has_run_dry {
            pacer.on_sent(START - millis(9), 1);
        }
        pacer.on_idle_restart(START, is_recovering);
        pace(&mut pacer, START);
        if is_heard_of {
            pacer.on_feedback(&losing(0));
        }
        let (count, delay) = pace(&mut pacer, START + micros(100));
        assert_eq!(count, early, "{len}");
        let (count, _) = pace(&mut pacer, START + micros(100) + delay);
        assert_eq!(count, on_time, "{len}");
    }
}

#[test]
fn feedback_ends_the_caution_after_a_pause() {
    for (acked, early) in [(0, 1), (1, 8)] {
        let mut sender = bbr_probing();
        assert_eq!(sender.run_dry().burst(), 18);
        assert_eq!(sender.run_dry().wait(millis(10)).burst(), 8);
        assert_eq!(sender.feedback(0, acked).wait(micros(100)).burst(), early);
    }
}

#[test]
fn pacer_makes_up_for_waking_late() {
    let nothing: fn(&mut Pacer) = |_| {};
    for (late, before, expected) in [
        (0, nothing, 1),
        (20, nothing, 5),
        (50, nothing, 11),
        (51, nothing, 1),
        (20, Pacer::on_limited_otherwise, 1),
        (5000, Pacer::catch_up_however_late, 1001),
    ] {
        let mut pacer = pacer_at(1000, millis(5));
        let (_, delay) = pace(&mut pacer, START);
        before(&mut pacer);
        let (count, _) = pace(&mut pacer, START + delay + millis(late));
        assert_eq!(count, expected, "{late}");
    }
}

#[test]
fn pacer_makes_up_for_waking_late_once_the_window_has_room() {
    let nothing: fn(&mut Pacer) = |_| {};
    let double: fn(&mut Pacer) = |it| it.set_rate(2000, millis(1), &steady(millis(17)));
    let halve: fn(&mut Pacer) = |it| it.set_rate(500, millis(1), &steady(millis(17)));
    for (late, max_owed, before, after, wait, expected) in [
        (40_000, 50_000, nothing, nothing, 0, 42),
        (40_000, 50_000, nothing, nothing, 1000, 43),
        (40_000, 50_000, nothing, nothing, 1001, 2),
        (40_000, 20_000, nothing, nothing, 0, 22),
        (40_000, 1000, nothing, nothing, 0, 3),
        (40_000, 50_000, Pacer::on_limited_otherwise, nothing, 0, 2),
        (40_000, 50_000, nothing, Pacer::stop_catching_up, 0, 2),
        (40_000, 20_000, nothing, double, 0, 24),
        (40_000, 20_000, nothing, halve, 0, 11),
        (1001, 50_000, nothing, nothing, 1000, 4),
        (1000, 50_000, nothing, nothing, 1000, 2),
    ] {
        let mut pacer = pacer_at(1000, millis(1));
        let now = START + pace(&mut pacer, START).1 + micros(late);
        before(&mut pacer);
        (0..2).for_each(|_| pacer.on_window_full(now, max_owed, false));
        after(&mut pacer);
        assert_eq!(pace(&mut pacer, now + micros(wait)).0, expected, "{late}");
    }
}

#[test]
fn pacer_is_only_stopped_if_the_window_has_been_full() {
    let mut pacer = pacer_at(1000, millis(1));
    pacer.on_window_full(START, 50_000, false);
    let now = START + pace(&mut pacer, START).1 + millis(40);
    pacer.stop_catching_up();
    assert_eq!(pace(&mut pacer, now).0, 42);
}

fn settle(pacer: &mut Pacer, packets: Range<u64>) {
    packets.for_each(|it| pacer.on_settled(it));
    pacer.on_feedback(&Feedback::default());
}

/// `lost` counts from the first packet.
fn catch_up(it: &mut CatchUp, len: u64, is_cut_short: bool, lost: impl Iterator<Item = u64>) {
    let first = u64::from(u32::MAX) - 5;
    it.start(first, 1, is_cut_short);
    (0..len).for_each(|_| it.on_sent());
    it.end();
    lost.for_each(|at| it.on_lost(first + at));
    (0..len).for_each(|at| it.on_settled(first + at));
    it.on_feedback(&Feedback::default());
}

#[test]
fn catching_up_is_limited_by_what_gets_through() {
    for (limit, len, early, late, expected) in [
        (u32::MAX, 100, 0..0, 98..100, u32::MAX),
        (u32::MAX, 100, 0..0, 97..100, 85),
        (u32::MAX, 100, 0..0, 97..200, 85),
        (u32::MAX, 100, 45..50, 50..62, u32::MAX),
        (u32::MAX, 100, 45..50, 50..63, 81),
        (u32::MAX, 100, 25..50, 76..100, u32::MAX),
        (u32::MAX, 100, 25..50, 75..100, 44),
        (u32::MAX, 101, 25..50, 76..101, u32::MAX),
        (u32::MAX, 100, 1..50, 50..100, 10),
        (u32::MAX, 100, 0..50, 50..100, u32::MAX),
        (u32::MAX, 10, 0..0, 5..10, u32::MAX),
        (u32::MAX, 11, 0..0, 5..11, 10),
        (100, 100, 0..0, 50..100, 88),
        (100, 120, 0..0, 110..120, 97),
        (11, 11, 0..0, 5..11, 10),
        (100, 200, 0..0, 190..200, 100),
        (100, 100, 0..0, 0..0, 100),
    ] {
        let mut it = CatchUp::default();
        it.limit = limit;
        catch_up(&mut it, len, false, early.chain(late));
        assert_eq!(it.limit, expected);
    }
}

#[test]
fn limit_of_catching_up_is_in_bytes() {
    let mut it = CatchUp::default();
    let bursts = [
        (1200, 50, 10),
        (1500, 28, 0),
        (1500, 30, 5),
        (1500, 27, 0),
        (1500, 30, 7),
        (1500, 27, 0),
        (100, 11, 9),
    ];
    let limits = bursts.map(|(datagram_len, len, lost)| {
        it.start(0, datagram_len, true);
        (0..len).for_each(|_| it.on_sent());
        it.end();
        (len - lost..len).for_each(|at| it.on_lost(at));
        (0..len).for_each(|at| it.on_settled(at));
        it.on_feedback(&Feedback::default());
        it.limit
    });
    let expected = [42_000, 46_125, 40_360, 44_382, 38_835, 42_762, 37_417];
    assert_eq!(limits, expected);

    let mut it = CatchUp::default();
    it.start(0, 1500, false);
    (0..11).for_each(|_| it.on_sent());
    (2..11).for_each(|at| it.on_lost(at));
    (0..11).for_each(|at| it.on_settled(at));
    it.on_feedback(&Feedback::default());
    assert_eq!(it.limit, 15_000);
}

#[test]
fn what_has_arrived_only_counts_if_the_end_is_spared() {
    for (early, late, expected) in [
        (0, 0, Some(40_000)),
        (0, 1, None),
        (1, 2, Some(37_000)),
        (1, 3, None),
        (3, 0, Some(37_000)),
    ] {
        let mut it = CatchUp::default();
        it.start(0, 1000, false);
        (0..40).for_each(|_| it.on_sent());
        (0..early)
            .chain(40 - late..40)
            .for_each(|at| it.on_lost(at));
        (0..40).for_each(|at| it.on_settled(at));
        assert_eq!(it.arrived(), expected);
    }
}

#[test]
fn burst_that_takes_all_there_is_has_not_been_cut_short() {
    for (dry_after, expected) in [(19, 171), (20, 160), (21, 171)] {
        let mut it = CatchUp::default();
        it.limit = 160;
        it.start(0, 1, true);
        for sent in 1..=21 {
            it.on_sent();
            if sent == dry_after {
                it.on_run_dry();
            }
            if sent == 20 {
                it.end();
                if sent != dry_after {
                    it.on_run_dry();
                }
            }
        }
        (0..21).for_each(|at| it.on_settled(at));
        it.on_feedback(&Feedback::default());
        assert_eq!(it.limit, expected);
    }
}

#[test]
fn limit_of_catching_up_grows_ever_faster() {
    let mut it = CatchUp::default();
    it.limit = 160;
    let mut grow = |lost| {
        let len = u64::from(it.limit);
        catch_up(&mut it, len, true, len - lost..len);
        it.limit
    };
    let lens = [0; 11].map(&mut grow);
    assert_eq!(
        lens,
        [171, 182, 194, 219, 247, 278, 348, 436, 546, 820, 1231]
    );
    assert_eq!([31, 0].map(&mut grow), [1078, 1146]);

    (0..300).for_each(|_| catch_up(&mut it, 40, true, 0..0));
    it.limit = 1000;
    catch_up(&mut it, 40, true, 0..0);
    assert_eq!(it.limit, 1501);

    it.limit = u32::MAX - 100;
    catch_up(&mut it, 40, true, 0..0);
    assert_eq!(it.limit, u32::MAX);
}

#[test]
fn limit_of_catching_up_grows_fast_if_there_is_more_room_than_last_time() {
    for (room, expected) in [(124, [149, 159]), (123, [211, 317])] {
        let mut it = CatchUp::default();
        it.limit = 160;
        catch_up(&mut it, 160, true, room..160);
        let lens = [false, true, true].map(|is_cut_short| {
            catch_up(&mut it, 140, is_cut_short, 0..0);
            it.limit
        });
        assert_eq!((lens[0], &lens[1..]), (140, &expected[..]));
    }

    let mut it = CatchUp::default();
    it.limit = 160;
    for (lost, expected) in [(100, 140), (3, 123), (0, 131)] {
        let len = u64::from(it.limit);
        catch_up(&mut it, len, true, len - lost..len);
        assert_eq!(it.limit, expected);
    }
}

#[test]
fn limit_of_catching_up_is_proven_by_a_burst_that_it_has_cut_short() {
    let mut it = CatchUp::default();
    for (is_cut_short, lost, expected) in [
        (false, 0, false),
        (true, 0, true),
        (false, 0, true),
        (true, 40, true),
        (false, 3, false),
    ] {
        catch_up(&mut it, 40, is_cut_short, 40 - lost..40);
        assert_eq!(it.is_limit_proven(), expected);
    }
}

#[test]
fn bursts_that_are_short_or_lost_altogether_tell_nothing() {
    for (len, lost) in [(10, 5..10), (160, 0..160), (0, 0..0)] {
        let mut it = CatchUp::default();
        it.limit = 160;
        catch_up(&mut it, len, true, lost);
        assert_eq!((it.limit, it.is_watching()), (160, false));
    }
}

#[test]
fn catching_up_is_judged_when_its_fate_is_known() {
    let mut it = CatchUp::default();
    it.start(100, 1, false);
    (0..40).for_each(|_| it.on_sent());
    it.end();
    it.start(140, 1, true);
    it.on_sent();
    it.end();
    for (settled, are_lost, arrived, expected) in [
        (90..100, true, Some(0), u32::MAX),
        (140..150, false, Some(0), u32::MAX),
        (100..120, false, Some(20), u32::MAX),
        (121..150, true, None, u32::MAX),
        (120..121, true, None, 18),
        (150..151, false, None, 18),
    ] {
        for at in settled {
            it.on_settled(at);
            if are_lost {
                it.on_lost(at);
            }
        }
        it.on_feedback(&Feedback::default());
        assert_eq!((it.arrived(), it.limit), (arrived, expected));
    }

    it.start(200, 1, false);
    assert_eq!(it.arrived(), Some(0));
    (0..40).for_each(|_| it.on_sent());
    it.end();
    (210..240).for_each(|at| it.on_lost(at));
    (200..240).for_each(|at| it.on_settled(at));
    it.on_feedback(&Feedback {
        is_persistent_congestion: true,
        ..Feedback::default()
    });
    it.on_feedback(&Feedback::default());
    assert_eq!(it.limit, 18);
}

#[test]
fn catching_up_is_watched_afresh_after_persistent_congestion() {
    let mut it = CatchUp::default();
    catch_up(&mut it, 40, false, 0..0);
    it.start(100, 1, false);
    (0..40).for_each(|_| it.on_sent());
    it.on_feedback(&Feedback {
        is_persistent_congestion: true,
        ..Feedback::default()
    });
    catch_up(&mut it, 40, false, 20..40);
    assert_eq!(it.limit, 18);
}

#[test]
fn only_so_much_of_a_burst_is_watched() {
    let mut it = CatchUp::default();
    catch_up(&mut it, 70_000, false, 60_000..70_000);
    assert_eq!(it.limit, 52_500);
}

#[test]
fn what_is_sent_after_the_start_has_arrived_is_not_part_of_a_burst() {
    for (arrived, expected) in [(99, 35), (100, u32::MAX)] {
        let mut it = CatchUp::default();
        it.start(100, 1, false);
        (0..40).for_each(|_| it.on_sent());
        it.on_settled(arrived);
        it.on_feedback(&Feedback::default());
        (0..40).for_each(|_| it.on_sent());
        it.end();
        (140..180).for_each(|at| it.on_lost(at));
        (arrived + 1..180).for_each(|at| it.on_settled(at));
        it.on_feedback(&Feedback::default());
        assert_eq!(it.limit, expected);
    }
}

#[test]
fn burst_that_arrives_at_once_is_judged_at_once() {
    let mut it = CatchUp::default();
    it.start(100, 1, false);
    (0..40).for_each(|_| it.on_sent());
    (100..140).for_each(|at| it.on_settled(at));
    it.on_feedback(&Feedback::default());
    assert!(!it.is_watching());
}

/// Like [`pace`], for no more than the packets with these sequence numbers.
fn pace_late(pacer: &mut Pacer, now: Instant, packets: Range<u64>) -> (Range<u64>, Instant) {
    let mut sent = packets.start;
    while sent < packets.end {
        pacer.limit_catching_up(now, sent, 1000, 60_000);
        if let Some(next) = pacer.delay(now) {
            return (packets.start..sent, next);
        }
        pacer.on_sent(now, 1000);
        sent += 1;
    }
    (packets, now)
}

#[test]
fn pacer_remembers_how_late_it_was_for_a_second() {
    let (pacer, now) = pacer_with_full_window(millis(20), 5);
    assert_eq!(pacer.lateness(now + micros(999_999)), millis(20));
    assert_eq!(pacer.lateness(now + micros(999_999 + 1)), Duration::ZERO);
}

#[test]
fn pacer_keeps_to_the_limit_of_catching_up() {
    for (per, room, late, expected) in [
        (1000, 30, [40_000; 3], [(42, 43), (28, 29), (30, 31)]),
        (1000, 30, [20_000; 3], [(22, 23), (22, 23), (22, 23)]),
        (
            1000,
            30,
            [40_000, 26_250, 40_000],
            [(42, 43), (28, 29), (28, 29)],
        ),
        (50, 60, [2000, 9000, 0], [(80, 81), (220, 221), (40, 41)]),
        (50, 60, [2001, 9000, 0], [(80, 81), (80, 93), (40, 41)]),
        (50, 10, [3000; 3], [(100, 101), (80, 81), (80, 81)]),
    ] {
        let mut pacer = pacer_at(1000, micros(per));
        let (mut now, mut sent) = (START + pace(&mut pacer, START).1, 0..0);
        let lens = late.map(|late| {
            now = now + micros(late);
            let allowance = pacer.allowance(now, false, 1000);
            (sent, now) = pace_late(&mut pacer, now, sent.end..u64::MAX);
            if sent.start == 0 {
                sent.clone().skip(room).for_each(|it| pacer.on_lost(it));
            }
            settle(&mut pacer, sent.clone());
            (sent.end - sent.start, allowance / 1000)
        });
        assert_eq!(lens, expected);
    }
}

#[test]
fn catching_up_ends_with_whatever_else_holds_the_sender_back() {
    let nothing: fn(&mut Pacer, Instant) = |_, _| {};
    let full: fn(&mut Pacer, Instant) = |it, now| it.on_window_full(now, 90_000, false);
    for (end, wait, expected) in [
        (nothing, 0, 22),
        (|it, _| it.on_limited_otherwise(), 0, 43),
        (full, 1000, 22),
        (full, 1001, 43),
    ] {
        let mut pacer = pacer_at(1000, millis(1));
        let now = START + pace(&mut pacer, START).1 + millis(40);
        pace_late(&mut pacer, now, 0..22);
        end(&mut pacer, now);
        pacer.limit_catching_up(now + micros(wait), 22, 1000, 60_000);
        (22..25).for_each(|_| _ = pacer.on_sent(now + micros(wait), 1000));
        let (sent, next) = pace_late(&mut pacer, now + micros(wait), 25..u64::MAX);
        (22..sent.end).for_each(|it| pacer.on_lost(it));
        settle(&mut pacer, 0..sent.end);
        assert_eq!(
            pacer.allowance(next + millis(40), false, 1000) / 1000,
            expected
        );
    }
}

#[test]
fn a_burst_is_only_watched_from_its_start() {
    let mut pacer = pacer_at(1000, millis(1));
    let now = START + pace(&mut pacer, START).1 + millis(40);
    let now = pace_late(&mut pacer, now, 0..u64::MAX).1 + millis(40);
    pace_late(&mut pacer, now, 42..60);
    settle(&mut pacer, 0..46);
    let (sent, next) = pace_late(&mut pacer, now, 60..u64::MAX);
    (70..sent.end).for_each(|it| pacer.on_lost(it));
    settle(&mut pacer, 46..sent.end);
    assert_eq!(pacer.allowance(next + millis(40), false, 1000), 43_000);
}

#[test]
fn limit_of_catching_up_counts_datagrams() {
    let bursts = [(2, 1460), (3, 1460), (3, 730)].map(|(lost, datagram_len)| {
        let mut sender = bbr_probing();
        sender.controller.set_datagram_len(datagram_len);
        sender.burst();
        sender.wait(millis(8)).burst();
        let arrived = sender.flights.len() - lost;
        sender.wait(millis(10)).feedback(0, arrived).send(4);
        sender.wait(millis(10)).feedback(lost, 4).send(1);
        sender.wait(millis(10)).feedback(0, 1).burst()
    });
    assert_eq!(bursts, [184, 70, 46]);
}

#[test]
fn only_bbr_catches_up_however_late() {
    for (algorithm, expected) in [(Algorithm::Bbr, 19), (Algorithm::Cubic, 2)] {
        let mut sender = Sender::new(algorithm);
        sender.rtt.update(millis(40), Duration::ZERO);
        sender.send(10).burst();
        assert_eq!(sender.wait(millis(500)).burst(), expected);
    }
}

#[test]
fn bbr_owes_a_whole_window_once_it_has_started_up() {
    let mut sender = bbr_probing();
    sender.send(170).burst();
    sender.wait(millis(500)).burst();
    assert_eq!(sender.segments(), 189);
    assert_eq!(sender.feedback(0, 170).burst(), 120);
}

#[test]
fn a_full_window_only_ends_catching_up_once_it_has_stopped_growing() {
    let bursts = [Sender::new(Algorithm::Bbr), bbr_probing()].map(|mut sender| {
        sender.rtt.update(millis(10), Duration::ZERO);
        sender.send(10).burst();
        sender.wait(millis(50)).burst();
        sender.wait(millis(50)).burst();
        let len = sender.flights.len() - 1;
        let burst = sender.wait(millis(50)).feedback(0, len).burst();
        (burst, sender.segments())
    });
    assert_eq!(bursts, [(34, 63), (5, 311)]);
}

/// Of 1000 bytes per millisecond, whose window of 60,000 bytes has stopped a burst of `len` packets.
fn pacer_with_full_window(late: Duration, len: u64) -> (Pacer, Instant) {
    let mut pacer = pacer_at(1000, millis(1));
    let now = START + pace(&mut pacer, START).1 + late;
    pacer.catch_up_however_late();
    pace_late(&mut pacer, now, 0..len);
    pacer.on_window_full(now, 60_000, true);
    (pacer, now)
}

#[test]
fn growing_window_is_filled_in_steps() {
    for (len, arrived, wait, expected) in [
        (5, 0..5, 0, 32),
        (5, 0..5, 40, 32),
        (21, 0..21, 40, 32),
        (24, 0..24, 40, 35),
        (24, 0..23, 40, 33),
        (40, 0..40, 40, 47),
    ] {
        let (mut pacer, now) = pacer_with_full_window(millis(45), len);
        settle(&mut pacer, arrived);
        let (sent, _) = pace_late(&mut pacer, now + millis(wait), len..u64::MAX);
        assert_eq!(sent.end - len, expected);
    }
}

#[test]
fn step_does_not_outdo_a_burst_that_has_lost_its_end() {
    let (mut pacer, now) = pacer_with_full_window(millis(45), 40);
    pacer.on_lost(39);
    settle(&mut pacer, 0..40);
    let now = now + millis(40);
    assert_eq!(pace_late(&mut pacer, now, 40..u64::MAX).0, 40..72);
}

#[test]
fn steps_do_not_prove_the_limit_of_catching_up() {
    let (mut pacer, now) = pacer_with_full_window(millis(45), 5);
    settle(&mut pacer, 0..5);
    let (sent, next) = pace_late(&mut pacer, now, 5..u64::MAX);
    settle(&mut pacer, sent.clone());
    pacer.on_window_full(next + millis(45), 60_000, false);
    assert!(!pacer.limit_catching_up(next + millis(45), sent.end, 1000, 10_000));
}

#[test]
fn waiting_for_the_window_counts_for_as_long_as_the_pacer_was_late() {
    let (mut pacer, mut now) = pacer_with_full_window(millis(20), 5);
    let lens = [5, 6, 7, 8, 9, 10].map(|sent| {
        now = now + millis(40);
        pacer.limit_catching_up(now, sent, 1000, 60_000);
        let allowance = pacer.allowance(now, false, 1000);
        pacer.on_sent(now, 1000);
        allowance / 1000 - 3
    });
    assert_eq!(lens, [20, 10, 5, 2, 1, 0]);
}

#[test]
fn growing_window_that_fills_in_time_ends_catching_up_unless_a_burst_is_on_its_way() {
    for (is_growing, arrived, expected) in [(true, 21, 22), (true, 22, 2), (false, 21, 2)] {
        let mut pacer = pacer_at(1000, millis(1));
        let now = START + pace(&mut pacer, START).1 + millis(20);
        let (sent, now) = pace_late(&mut pacer, now, 0..u64::MAX);
        pacer.catch_up_however_late();
        settle(&mut pacer, 0..arrived);
        pacer.on_window_full(now, 60_000, is_growing);
        let (sent, _) = pace_late(&mut pacer, now + millis(40), sent.end..u64::MAX);
        assert_eq!(sent.end - sent.start, expected);
    }
}

#[test]
fn an_empty_flight_starts_another_burst() {
    let (mut pacer, now) = pacer_with_full_window(millis(20), 5);
    pace_late(&mut pacer, now, 5..10);
    let now = now + millis(40);
    pacer.on_idle_restart(now, true);
    pacer.on_sent(now, 1000);
    assert_eq!(pace_late(&mut pacer, now, 11..u64::MAX).0, 11..23);
}

#[test]
fn being_very_late_is_only_made_up_for_if_it_is_common() {
    for (late, period, expected) in [
        (50_004, 1_000_000, [52, 52]),
        (50_005, 1_000_000, [2, 2]),
        (100_000, 500_000, [2, 102]),
        (100_000, 500_001, [2, 2]),
    ] {
        let mut pacer = pacer_at(1000, millis(1));
        let mut sent = 0..0;
        let lens = [0, period].map(|at| {
            let now = START + millis(1000) + micros(at);
            let start = now - micros(late) - millis(2);
            pacer.on_limited_otherwise();
            (sent, _) = pace_late(&mut pacer, start, sent.end..u64::MAX);
            pacer.catch_up_however_late();
            let allowance = pacer.allowance(now, false, 1000);
            (sent, _) = pace_late(&mut pacer, now, sent.end..u64::MAX);
            assert_eq!(allowance / 1000, sent.end - sent.start + 1);
            sent.end - sent.start
        });
        assert_eq!(lens, expected, "{late} {period}");
    }
}

#[test]
fn being_very_late_for_once_keeps_nothing_back() {
    let mut pacer = pacer_at(1000, millis(1));
    let now = START + millis(1000);
    let next = now + pace(&mut pacer, now).1;
    pacer.catch_up_however_late();
    assert!(!pacer.limit_catching_up(next + millis(60), 0, 1000, 60_000));
}

#[test]
fn limit_of_catching_up_is_not_proven_by_what_little_is_left() {
    for (runs_dry, expected) in [(false, 24), (true, 22)] {
        let mut pacer = pacer_at(1000, millis(1));
        let now = START + pace(&mut pacer, START).1 + millis(40);
        let (sent, now) = pace_late(&mut pacer, now, 0..u64::MAX);
        (22..sent.end).for_each(|it| pacer.on_lost(it));
        settle(&mut pacer, sent);
        let (sent, now) = pace_late(&mut pacer, now + millis(40), 50..55);
        if runs_dry {
            pacer.on_application_limited(true);
        }
        settle(&mut pacer, sent);
        assert_eq!(
            pacer.allowance(now + millis(10), false, 1000) / 1000,
            expected
        );
    }
}

#[test]
fn what_is_owed_stays_so_while_it_is_made_up_for() {
    let mut pacer = pacer_at(1000, millis(1));
    let now = START + pace(&mut pacer, START).1 + millis(40);
    let (sent, now) = pace_late(&mut pacer, now, 0..u64::MAX);
    pacer.on_limited_otherwise();
    let (sent, now) = pace_late(&mut pacer, now + millis(300), sent.end..u64::MAX);
    pacer.catch_up_however_late();
    let now = now + millis(100);
    pace_late(&mut pacer, now, sent.end..sent.end + 30);
    assert_eq!(pacer.allowance(now, false, 1000), 73_000);
}

#[test]
fn being_very_late_counts_while_a_burst_is_watched() {
    let mut pacer = pacer_at(1000, millis(1));
    let now = START + pace(&mut pacer, START).1 + millis(20);
    let (mut sent, mut now) = pace_late(&mut pacer, now, 0..u64::MAX);
    let lens = [400, 0].map(|idle| {
        pacer.on_limited_otherwise();
        (sent, now) = pace_late(&mut pacer, now + millis(idle), sent.end..u64::MAX);
        pacer.catch_up_however_late();
        (sent, now) = pace_late(&mut pacer, now + millis(60), sent.end..u64::MAX);
        sent.end - sent.start
    });
    assert_eq!(lens, [2, 62]);
}

#[test]
fn time_of_waking_late_is_that_of_the_burst_being_watched() {
    let mut pacer = pacer_at(1000, millis(1));
    let woke_at = START + pace(&mut pacer, START).1 + millis(20);
    let (sent, now) = pace_late(&mut pacer, woke_at, 10..u64::MAX);
    pace_late(&mut pacer, now + millis(20), sent.end..u64::MAX);
    let times = [8, 9, 10, sent.end - 1].map(|it| pacer.woke_after(it));
    assert_eq!(times, [None, Some(woke_at), None, None]);
}

#[test]
fn growing_window_keeps_to_the_limit_of_catching_up() {
    let mut pacer = pacer_at(1000, millis(1));
    let now = START + pace(&mut pacer, START).1 + millis(40);
    let (sent, now) = pace_late(&mut pacer, now, 0..u64::MAX);
    (22..sent.end).for_each(|it| pacer.on_lost(it));
    settle(&mut pacer, sent.clone());
    pacer.catch_up_however_late();
    let now = now + millis(40);
    let (sent, _) = pace_late(&mut pacer, now, sent.end..sent.end + 5);
    pacer.on_window_full(now, 60_000, true);
    let (sent, _) = pace_late(&mut pacer, now + millis(40), sent.end..u64::MAX);
    assert_eq!(sent.end - sent.start, 21);
}

#[test]
fn only_a_limit_that_is_proven_and_reached_keeps_anything_back() {
    let mut pacer = pacer_at(1000, millis(1));
    let (mut now, mut sent) = (START + pace(&mut pacer, START).1, 0..0);
    let wakes = [(40, 20), (40, 0), (21, 0), (22, 0), (40, 3), (40, 0)];
    let results = wakes.map(|(late, lost)| {
        now = now + millis(late);
        let first = sent.end;
        let result = pacer.limit_catching_up(now, first, 1000, 60_000);
        pacer.delay(now);
        pacer.on_sent(now, 1000);
        (sent, now) = pace_late(&mut pacer, now, first + 1..u64::MAX);
        (sent.end - lost..sent.end).for_each(|it| pacer.on_lost(it));
        settle(&mut pacer, first..sent.end);
        result
    });
    assert_eq!(results, [false, false, false, true, true, false]);
}

#[test]
fn what_is_cut_short_says_nothing_about_the_bandwidth_once_the_limit_is_proven() {
    let mut sender = bbr_probing();
    sender.burst();
    let are_limited = [40, 0, 0, 0, 3, 0].map(|lost| {
        let before = sender.flights.len();
        let len = sender.wait(millis(9)).burst() as usize;
        let first = sender.flights.get(before);
        let is_limited = first.is_some_and(|it| it.is_application_limited);
        sender.wait(millis(1)).feedback(0, before + len - lost);
        sender.feedback(lost, 0).send(2).burst();
        is_limited
    });
    assert_eq!(are_limited, [false, false, false, true, true, false]);
}

#[test]
fn last_burst_says_nothing_about_the_bandwidth_during_startup() {
    for (is_starting, in_flight, late, excess, expects_more, expected) in [
        (true, 49, 9, 0, false, true),
        (true, 50, 9, 0, false, false),
        (true, 49, 9, 1, false, false),
        (true, 49, 9, 0, true, false),
        (true, 49, 4, 0, false, false),
        (false, 49, 9, 0, false, false),
    ] {
        let mut sender = match is_starting {
            true => Sender::new(Algorithm::Bbr),
            false => bbr_probing(),
        };
        sender.rounds_of(40, 1, millis(10)).send(in_flight).burst();
        let unsent = sender.window() - sender.controller.in_flight() + excess;
        let now = sender.wait(millis(late)).now;
        sender.controller.permit(now, unsent, || expects_more);
        let last = sender.send(1).flights.back();
        assert_eq!(last.map(|it| it.is_application_limited), Some(expected));
    }
}

#[test]
fn end_of_a_long_burst_is_followed_up_once() {
    for (late, len, expected) in [
        (2001, 10, false),
        (2001, 11, true),
        (2000, 11, false),
        (2001, 45, false),
    ] {
        let mut pacer = pacer_at(1000, micros(100));
        let now = START + pace(&mut pacer, START).1 + micros(late);
        let (sent, now) = pace_late(&mut pacer, now, 0..len);
        pace_late(&mut pacer, now, sent.end..len);
        assert!(!pacer.ends_with_burst());
        pacer.on_application_limited(false);
        assert_eq!(pacer.ends_with_burst(), expected, "{late} {len}");
    }

    let mut sender = bbr_probing();
    sender.burst();
    let now = sender.wait(millis(8)).now;
    sender.controller.permit(now, 0, || true);
    sender.send(300).run_dry();
    let takes = [(); 2].map(|()| sender.controller.take_end_of_burst());
    assert_eq!(takes, [true, false]);
}

#[test]
fn bursts_are_only_followed_up_while_packets_get_lost() {
    let mut pacer = pacer_at(1000, micros(100));
    let mut now = START;
    for _ in 0..2 {
        let results = [11, 10, 11, 11, 11, 11, 20].map(|len| {
            now = now + pace(&mut pacer, now).1 + millis(3);
            pace_late(&mut pacer, now, 1..1 + len);
            pacer.on_application_limited(false);
            let ends_with_burst = pacer.ends_with_burst();
            pacer.end_burst();
            ends_with_burst
        });
        assert_eq!(results, [true, false, true, true, true, false, false]);
        pacer.on_lost(0);
    }
}

#[test]
fn what_is_sent_aside_does_not_count() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.send(5);
    let flight = Flight::aside(sender.now);
    assert!(flight.starts_burst());
    assert!(!sender.controller.discard(&flight));
    assert_eq!(sender.controller.in_flight(), 5 * SEGMENT);
}

#[test]
fn discarded_packets_do_not_keep_a_burst_from_being_judged() {
    let mut sender = bbr_probing();
    sender.burst();
    let before = sender.flights.len();
    let len = sender.wait(millis(8)).burst() as usize;
    for flight in sender.flights.drain(before..=before) {
        sender.controller.discard(&flight);
    }
    sender.wait(millis(10)).feedback(0, before + len - 21);
    sender
        .feedback(20, 0)
        .send(2)
        .wait(millis(10))
        .feedback(0, 1);
    sender.burst();
    assert_eq!((len, sender.wait(millis(10)).burst()), (64, 42));
}

#[test]
fn a_pause_starts_another_burst() {
    for (pause, expected) in [(2000, 220), (2001, 40)] {
        let mut pacer = pacer_at(1000, millis(1));
        let now = START + pace(&mut pacer, START).1 + millis(40);
        let (sent, now) = pace_late(&mut pacer, now, 0..u64::MAX);
        (20..sent.end).for_each(|it| pacer.on_lost(it));
        settle(&mut pacer, sent);
        let now = now + millis(40);
        pace_late(&mut pacer, now, 50..51);
        pacer.set_rate(1000, micros(100), &steady(millis(17)));
        let (sent, _) = pace_late(&mut pacer, now + micros(pause), 51..u64::MAX);
        assert_eq!(sent.end - sent.start, expected);
    }
}

#[test]
fn time_away_does_not_count_as_time_of_sending() {
    let gains = [0, 1].map(|unheard_of| {
        let mut sender = bbr_probing();
        sender.burst();
        sender.wait(millis(15)).burst();
        let len = sender.flights.len() - unheard_of;
        sender.wait(millis(15)).burst();
        sender.feedback(0, len).send(1);
        gain(sender.wait(millis(10)).feedback(0, usize::MAX))
    });
    assert_eq!(gains, [201, 135]);
}

#[test]
fn bbr_does_not_make_up_for_probing_the_round_trip() {
    let mut path = Path::fast(Algorithm::Bbr, 400);
    path.unsent = u64::MAX / 2;
    while path.controller.window() > 4 * SEGMENT {
        path.now = path.now + millis(5);
        path.step();
    }
    path.longest_burst = 0;
    path.saturate(millis(400), |_| {});
    assert_within(path.longest_burst, 1..=30);
}

#[test]
fn what_is_owed_to_a_growing_window_stays_as_much_time() {
    let (mut pacer, now) = pacer_with_full_window(millis(20), 5);
    pacer.set_rate(2000, millis(1), &steady(millis(17)));
    assert_eq!(pace_late(&mut pacer, now, 5..u64::MAX).0, 5..39);
}

#[test]
fn bursts_after_a_pause_of_the_application_are_not_watched() {
    let mut pacer = pacer_at(1000, millis(1));
    let now = START + pace(&mut pacer, START).1 + millis(40);
    let (sent, now) = pace_late(&mut pacer, now, 0..u64::MAX);
    (20..sent.end).for_each(|it| pacer.on_lost(it));
    settle(&mut pacer, sent);
    pacer.on_application_limited(false);
    let (sent, now) = pace_late(&mut pacer, now + millis(40), 50..u64::MAX);
    settle(&mut pacer, sent);
    assert_eq!(pacer.allowance(now + millis(40), false, 1000), 22_250);
}

#[test]
fn acknowledgments_that_are_read_late_let_bbr_go_on() {
    for (algorithm, expected) in [(Algorithm::Bbr, 28), (Algorithm::Cubic, 3)] {
        let mut sender = Sender::new(algorithm);
        sender.rtt.update(millis(40), Duration::ZERO);
        sender.send(20).burst();
        let len = sender.flights.len();
        sender.wait(millis(50)).burst();
        assert_eq!(sender.controller.room(), 0);
        sender.wait(micros(100)).feedback(0, len);
        assert_eq!(sender.burst(), expected);
    }
}

#[test]
fn pacer_starts_a_burst_after_three_packets_or_a_quarter_of_a_millisecond() {
    for (per, pause) in [(micros(16), 48), (micros(64), 192), (micros(128), 250)] {
        let mut pacer = pacer_at(1024, per);
        assert_ne!(pacer.on_sent(START, 1024), Place::Later);
        assert_eq!(pacer.on_sent(START + micros(pause), 1024), Place::Later);
        assert_ne!(
            pacer.on_sent(START + micros(2 * pause + 1), 1024),
            Place::Later
        );
        pacer.on_idle_restart(START, false);
        assert_ne!(
            pacer.on_sent(START + micros(3 * pause + 2), 1024),
            Place::Later
        );
    }
}

#[test]
fn pacer_knows_when_the_last_burst_may_still_be_leaving() {
    for (pause, was_idle, place) in [
        (479, false, Place::First),
        (480, false, Place::FirstAfterGap),
        (479, true, Place::FirstAfterGap),
    ] {
        let mut pacer = pacer_at(1024, micros(16));
        (0..40).for_each(|_| _ = pacer.on_sent(START, 1024));
        if was_idle {
            pacer.on_idle_restart(START + micros(pause), false);
        }
        assert_eq!(pacer.on_sent(START + micros(pause), 1024), place);
    }
}

#[test]
fn pacer_drops_the_rest_of_a_quantum_after_a_loss() {
    let (mut pacer, mut rtt) = (Pacer::default(), Rtt::default());
    rtt.update(micros(500), Duration::ZERO);
    pacer.set_rate(1000, millis(5), &rtt);
    assert_eq!(pacer.delay(START), None);
    pacer.on_sent(START, 1000);
    pacer.on_feedback(&losing(1));
    assert_eq!(pacer.delay(START), Some(START + millis(5)));
}

#[test]
fn pacer_sends_in_proportion_to_the_rate_while_bursts_lose_their_starts() {
    for (per, alone, shared) in [
        (micros(1), 3, 66),
        (micros(50), 3, 10),
        (micros(200), 3, 5),
        (micros(500), 2, 2),
    ] {
        let mut pacer = pacer_at(1000, per);
        let mut burst = |overflows, lost, arrived| {
            (0..overflows).for_each(|_| pacer.on_overflow(true, 0));
            (0..lost).for_each(|_| pacer.on_start_settled(true));
            (0..arrived).for_each(|_| pacer.on_start_settled(false));
            let mut rtt = Rtt::default();
            rtt.update(millis(20), Duration::ZERO);
            pacer.set_rate(1000, per, &rtt);
            pacer.quantum().div_ceil(1000)
        };
        assert_eq!(burst(5, 5, 0), alone);
        assert_eq!(burst(0, 1, 0), shared);
        assert_eq!(burst(0, 0, 600), shared);
        assert_eq!(burst(0, 0, 150), alone);
    }
}

#[test]
fn pacer_adds_nothing_for_a_short_path_in_a_shared_queue() {
    for (lost, expected, bonus) in [(5, 3, 2048), (6, 1, 0)] {
        let mut pacer = pacer_at(1000, millis(2));
        (0..5).for_each(|_| pacer.on_overflow(true, 0));
        (0..lost).for_each(|_| pacer.on_start_settled(true));
        let mut rtt = Rtt::default();
        rtt.update(millis(1), Duration::ZERO);
        pacer.set_rate(1000, millis(2), &rtt);
        assert_eq!(pacer.quantum().div_ceil(1000), expected);
        assert_eq!(pacer.bonus(), bonus);
    }
}

#[test]
fn pacer_looks_further_ahead_in_a_shared_queue() {
    for (lost, early, is_permitted) in [
        (0, 31, true),
        (0, 32, false),
        (6, 250, true),
        (6, 251, false),
    ] {
        let mut pacer = pacer_at(1000, millis(5));
        (0..5).for_each(|_| pacer.on_overflow(true, 0));
        (0..lost).for_each(|_| pacer.on_start_settled(true));
        let (_, delay) = pace(&mut pacer, START);
        let result = pacer.delay(START + delay - micros(early));
        assert_eq!(result.is_none(), is_permitted, "{lost} {early}");
    }
}

#[test]
fn pacer_forgets_overflows_one_by_one() {
    let mut pacer = pacer_at(1024, micros(16));
    (0..2).for_each(|_| pacer.on_overflow(true, 0));
    for (packets, max_turn) in [(4096, 4), (1, 8), (8192, 8), (1, usize::MAX)] {
        (0..packets).for_each(|_| _ = pacer.on_sent(START, 1024));
        assert_eq!(pacer.max_turn(), max_turn);
    }
}

#[test]
fn pacer_takes_longer_to_forget_overflows_that_come_back() {
    let mut pacer = pacer_at(1024, micros(16));
    for (fine, in_flight, overflows, until_forgotten) in [
        (0, 0, 1, 8193),
        (2048, 0, 1, 4 * 8192 + 1),
        (2049, 1024, 1, 16 * 8192 + 1),
        (0, 0, 2, 4097 + 64 * 8192 + 1),
        (0, 0, 1, 64 * 8192 + 1),
        (2049, 1023, 1, 8193),
        (0, 0, 1, 4 * 8192 + 1),
        (16_385, 0, 1, 8193),
    ] {
        (0..fine).for_each(|_| _ = pacer.on_sent(START, 1024));
        (0..overflows).for_each(|_| pacer.on_overflow(true, in_flight));
        let sent = (1..).find(|_| {
            pacer.on_sent(START, 1024);
            pacer.max_turn() == usize::MAX
        });
        assert_eq!(sent, Some(until_forgotten));
    }
}

#[test]
fn pacer_does_not_blame_bursts_for_the_overflow_of_a_long_queue() {
    for (queue_delay, is_short) in [(1535, true), (1536, false)] {
        let mut pacer = pacer_at(1024, micros(16));
        for max_turn in [usize::MAX, if is_short { 8 } else { usize::MAX }] {
            pacer.on_overflow(pacer.is_queue_short(micros(queue_delay)), 0);
            (0..8193).for_each(|_| _ = pacer.on_sent(START, 1024));
            assert_eq!(pacer.max_turn(), max_turn);
        }
    }
}

#[test]
fn pacer_counts_for_one_overflow_at_a_time_how_often_it_comes_back() {
    let mut pacer = pacer_at(1024, micros(16));
    let mut turn_after = |overflows, packets| {
        (0..overflows).for_each(|_| pacer.on_overflow(true, 0));
        (0..packets).for_each(|_| _ = pacer.on_sent(START, 1024));
        pacer.max_turn()
    };
    assert_eq!(turn_after(1, 8193), usize::MAX);
    assert_eq!(turn_after(2, 4097), 8);
    assert_eq!(turn_after(1, 4 * 4096), 4);
    assert_eq!(turn_after(0, 1), 8);
    assert_eq!(turn_after(0, 8193), usize::MAX);
}

#[test]
fn bursts_that_lose_their_ends_overflow_a_queue() {
    for (bursts, expected) in [
        (&["...xxx"][..], 1),
        (&["....xx"], 0),
        (&["..xxx."], 0),
        (&["xxxxxx"], 0),
        (&["xxx.xx"], 0),
        (&["....xx", ".....x"], 1),
        (&[".....x", ".....x", ".....x"], 1),
        (&["....xx", "......", "......", "......", ".....x"], 1),
        (
            &["....xx", "......", "......", "......", "......", ".....x"],
            0,
        ),
        (
            &["....xx", "......", "......", "......", "......", "....xx"],
            0,
        ),
        (&[".....x", "xxxxxx"], 1),
        (&["...xxx", "....xx"], 1),
        (&["...xxx", "...xxx"], 2),
    ] {
        let mut sender = Sender::new(Algorithm::Cubic);
        sender.rtt.update(millis(11), Duration::ZERO);
        for _ in bursts {
            sender.wait(millis(1)).send(6);
        }
        assert_eq!(sender.controller.pacer.quantum().div_ceil(SEGMENT), 6);
        let mut overflows = 0;
        for (flight, fate) in sender.flights.iter().zip(bursts.concat().bytes()) {
            match fate {
                b'x' => (sender.controller).on_lost(flight, flight.sequence % 6 == 0),
                _ => sender.controller.on_acked(flight),
            }
            let feedback = &mut sender.controller.feedback;
            overflows += u32::from(core::mem::take(&mut feedback.is_overflow));
        }
        assert_eq!(overflows, expected, "{bursts:?}");
    }
}

#[test]
fn few_of_the_starts_that_are_lost_at_once_count() {
    let mut sender = Sender::new(Algorithm::Bbr);
    for outages in 1..=8 {
        (0..50).for_each(|_| _ = sender.wait(millis(10)).send(1));
        sender.feedback(50, 0);
        assert_eq!(sender.controller.pacer.loses_starts(), outages == 8);
    }
}

#[test]
fn bursts_that_lose_their_starts_share_a_queue() {
    let mut sender = Sender::new(Algorithm::Bbr);
    for (bursts, lost, is_shared) in [(5, 1, false), (1, 1, true), (600, 0, true), (150, 0, false)]
    {
        for _ in 0..bursts {
            sender.wait(millis(1)).send(3).wait(millis(1));
            sender.feedback(lost, 3);
        }
        assert_eq!(sender.controller.pacer.bonus() == 0, is_shared);
    }
}

#[test]
fn bursts_get_shorter_after_an_overflow_and_whenever_cubic_backs_off() {
    for (algorithm, max_turns) in [
        (Algorithm::Cubic, [8, 8, 4]),
        (Algorithm::Bbr, [usize::MAX, usize::MAX, 8]),
    ] {
        let mut sender = Sender::new(algorithm);
        sender.fill().wait(millis(10));
        let lose_one = |is_overflow| {
            sender.controller.feedback.is_overflow = is_overflow;
            sender.feedback(1, 1).controller.max_turn()
        };
        assert_eq!([false, false, true].map(lose_one), max_turns);
    }
}

#[test]
fn queues_are_measured_by_the_smoothed_round_trip_time() {
    for (rtt, is_short) in [(170, true), (190, false)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.send(2).wait(millis(10)).feedback(1, 1);
        sender.send(1).wait(millis(rtt)).feedback(0, 1);
        assert_eq!(sender.controller.is_queue_short(&sender.rtt), is_short);
    }
    let mut sender = bbr_probing();
    sender.rounds_of(200, 100, millis(40));
    assert!(!sender.controller.is_queue_short(&sender.rtt));
    sender.rounds_of(200, 200, millis(40));
    assert!(sender.controller.is_queue_short(&sender.rtt));
}

#[test]
fn overflows_come_back_if_bursts_can_be_at_fault() {
    for (algorithm, rtt, is_overflow, segments, is_back) in [
        (Algorithm::Bbr, 10, true, 1, true),
        (Algorithm::Bbr, 190, true, 1, false),
        (Algorithm::Bbr, 10, true, 2000, true),
        (Algorithm::Cubic, 10, true, 1, true),
        (Algorithm::Cubic, 10, false, 1, false),
    ] {
        let mut sender = Sender::new(algorithm);
        sender.send(1).wait(millis(10)).feedback(0, 1);
        sender.send(2).wait(millis(rtt)).feedback(1, 1);
        let forget = |pacer: &mut Pacer| {
            let sent = (0..).find(|_| {
                pacer.on_sent(START, 1024);
                pacer.max_turn() == usize::MAX
            });
            sent > Some(10_000)
        };
        sender.controller.pacer.on_overflow(true, 0);
        forget(&mut sender.controller.pacer);
        sender.controller.feedback.is_overflow = is_overflow;
        sender.send(segments).feedback(1, 0);
        assert!(sender.controller.max_turn() < usize::MAX);
        assert_eq!(forget(&mut sender.controller.pacer), is_back);
    }
}

/// Of a pacer that has met a short queue.
struct Periods {
    pacer: Pacer,
    now: Instant,
    is_path_limit: bool,
    overflows: bool,
    sends: bool,
}

impl Periods {
    fn new() -> Self {
        let mut periods = Self {
            pacer: Pacer::default(),
            now: START,
            is_path_limit: true,
            overflows: true,
            sends: true,
        };
        assert_eq!(periods.run(1, |_| (110, 10)), [2]);
        periods
    }

    /// Takes what is delivered and lost in a tenth of a period with a given quantum, and returns the quantum after
    /// each period. Both are in KiB.
    fn run(&mut self, count: usize, mut outcome: impl FnMut(u64) -> (u64, u64)) -> Vec<u64> {
        let period = |_| {
            for step in 1..=10 {
                let (acked, lost) = outcome(self.pacer.quantum() / 1024);
                let feedback = Feedback {
                    acked: acked * SEGMENT,
                    lost: lost * SEGMENT,
                    ..Feedback::default()
                };
                self.now = self.now + millis(10);
                if self.sends {
                    self.pacer.on_sent(self.now, 1);
                }
                if self.overflows {
                    self.pacer.on_overflow(true, 0);
                }
                let starts_cycle = self.is_path_limit.then_some(step == 10);
                (self.pacer).try_longer_bursts(self.now, &feedback, starts_cycle);
                (self.pacer).set_rate(16 * 1024, millis(1), &Rtt::default());
            }
            self.pacer.quantum() / 1024
        };
        (0..count).map(period).collect()
    }
}

#[test]
fn bursts_get_longer_as_far_as_it_makes_no_difference() {
    let expected = [4, 8, 16, 16, 16];
    assert_eq!(Periods::new().run(5, |_| (110, 10)), expected);
    let slightly_worse = |len| (110 - len / 8, 10 + len / 3);
    assert_eq!(Periods::new().run(5, slightly_worse), expected);
    for worse in [(105, 10), (110, 18), (110, 90)] {
        let quanta = Periods::new().run(40, |len| if len > 4 { worse } else { (110, 10) });
        let trials = quanta.chunk_by(|a, b| a == b).filter(|it| it.contains(&8));
        assert_eq!(trials.count(), 3);
        assert!(quanta.iter().all(|it| (4..=8).contains(it)));
    }
}

#[test]
fn losses_at_first_do_not_excuse_longer_bursts() {
    let quanta = Periods::new().run(4, |len| match len {
        2 => (110, 30),
        4 => (110, 1),
        _ => (110, 25),
    });
    assert_eq!(quanta, [4, 8, 4, 4]);
}

#[test]
fn bursts_get_short_again_when_the_path_changes() {
    for (is_path_limit, outcome, expected) in [
        (true, (104, 10), [16, 2]),
        (true, (110, 30), [2, 2]),
        (false, (104, 10), [16, 16]),
        (false, (110, 30), [2, 2]),
        (false, (20, 20), [8, 2]),
    ] {
        let mut periods = Periods::new();
        assert_eq!(periods.run(4, |_| (110, 10)), [4, 8, 16, 16]);
        periods.is_path_limit = is_path_limit;
        assert_eq!(periods.run(2, |_| outcome), expected);
    }
}

#[test]
fn bursts_only_get_short_for_an_overflow() {
    let mut periods = Periods::new();
    assert_eq!(periods.run(4, |_| (110, 10)), [4, 8, 16, 16]);
    periods.overflows = false;
    assert_eq!(periods.run(2, |_| (104, 0)), [16, 16]);
}

#[test]
fn bursts_stay_short_unless_the_outcome_is_comparable() {
    let mut periods = Periods::new();
    periods.is_path_limit = false;
    assert_eq!(periods.run(3, |_| (110, 10)), [2, 2, 2]);
    periods.is_path_limit = true;
    assert_eq!(periods.run(2, |_| (110, 10)), [2, 4]);

    let mut periods = Periods::new();
    (periods.sends, periods.now) = (false, periods.now + millis(150));
    assert_eq!(periods.run(3, |_| (110, 10)), [2, 2, 2]);

    let mut periods = Periods::new();
    assert_eq!(periods.run(4, |_| (110, 10)), [4, 8, 16, 16]);
    (0..10).for_each(|_| periods.pacer.on_start_settled(true));
    assert_eq!(periods.run(3, |_| (110, 10)), [8, 8, 8]);
    assert_eq!(periods.pacer.max_turn(), 1);
}

#[test]
fn bursts_on_trial_do_not_tell_whether_a_queue_is_shared() {
    let mut periods = Periods::new();
    for (outcome, expected) in [((110, 10), 4), ((104, 10), 4), ((110, 10), 2)] {
        assert_eq!(periods.run(1, |_| outcome), [expected]);
        if expected > 2 {
            (0..10).for_each(|_| periods.pacer.on_start_settled(true));
        }
    }
}

#[test]
fn bursts_that_were_fine_are_tried_again_at_once() {
    let mut periods = Periods::new();
    let outcome = |len| if len > 4 { (105, 10) } else { (110, 10) };
    assert_eq!(periods.run(4, outcome), [4, 8, 8, 4]);
    assert_eq!(periods.run(1, |_| (104, 10)), [4]);
    assert_eq!(periods.run(4, outcome), [2, 4, 4, 4]);
}

#[test]
fn period_takes_some_time() {
    let mut periods = Periods::new();
    let feedback = Feedback {
        acked: 2000 * SEGMENT,
        ..Feedback::default()
    };
    (periods.pacer).try_longer_bursts(periods.now, &feedback, Some(true));
    assert_eq!(periods.pacer.max_turn(), 1);
}

#[test]
fn bursts_have_to_prove_themselves_again_after_a_pause() {
    let mut path = Path::new(Algorithm::Bbr, micros(20), micros(500), 20);
    path.transfer(60_000, |_| {});
    assert_eq!(path.controller.max_turn(), 4);
    (path.lost, path.delivered) = (0, 0);
    for _ in 0..50 {
        path.now = path.now + millis(2000);
        path.transfer(600, |_| {});
    }
    assert!(path.lost * 1000 < path.delivered * 15);
}

#[test]
fn trial_that_cannot_be_judged_is_called_off() {
    let mut periods = Periods::new();
    assert_eq!(periods.run(2, |_| (110, 10)), [4, 8]);
    periods.is_path_limit = false;
    assert_eq!(periods.run(3, |_| (110, 10)), [8, 4, 4]);
    (0..10).for_each(|_| periods.pacer.on_start_settled(true));
    periods.run(1, |_| (110, 10));
    assert_eq!(periods.pacer.max_turn(), 1);
}

#[test]
fn trial_that_is_interrupted_is_called_off() {
    let (mut trial, mut now) = (Trial::default(), START);
    judge(&mut trial, &mut now, 1024, 0, true);
    assert_eq!(judge(&mut trial, &mut now, 2000, 0, true), 1);
    trial.update(now, &Feedback::default(), None, 0);
    assert_eq!(judge(&mut trial, &mut now, 2000, 0, true), 0);
}

#[test]
fn period_with_a_pause_is_not_comparable() {
    let (mut trial, mut now) = (Trial::default(), START);
    judge(&mut trial, &mut now, 1024, 0, true);
    trial.abandon();
    let spared = [(); 2].map(|()| judge(&mut trial, &mut now, 2000, 0, true));
    assert_eq!(spared, [0, 1]);
}

#[test]
fn trial_starts_from_the_shortest_bursts_of_a_period() {
    let (mut trial, mut now) = (Trial::default(), START);
    judge(&mut trial, &mut now, 1024, 0, true);
    judge(&mut trial, &mut now, 2000, 0, false);
    trial.update(now, &Feedback::default(), Some(true), MAX_OVERFLOWS - 2);
    assert_eq!(trial.max_overflows(), MAX_OVERFLOWS - 1);
}

#[test]
fn pause_ends_a_trial() {
    for lost in [10, 90] {
        let mut periods = Periods::new();
        assert_eq!(periods.run(1, |_| (110, 10)), [4]);
        let feedback = Feedback {
            lost: 3 * lost * SEGMENT,
            ..Feedback::default()
        };
        (periods.pacer).try_longer_bursts(periods.now, &feedback, Some(false));
        (periods.pacer).on_idle_restart(periods.now + millis(151), false);
        (0..10).for_each(|_| periods.pacer.on_start_settled(true));
        (periods.pacer).set_rate(16 * 1024, millis(1), &Rtt::default());
        assert_eq!(periods.pacer.quantum(), 8192);
    }
}

#[test]
fn pauses_do_not_make_failed_trials_more_frequent() {
    let mut path = Path::new(Algorithm::Bbr, micros(120), millis(1), 3);
    for _ in 0..40 {
        path.transfer(4000, |_| {});
        path.now = path.now + millis(100);
    }
    assert!(path.lost * 100 < path.delivered * 4);
}

/// A second later. Returns how many halvings are spared.
fn judge(trial: &mut Trial, now: &mut Instant, acked: u64, lost: u64, starts_cycle: bool) -> u8 {
    let feedback = Feedback {
        acked: acked * SEGMENT,
        lost: lost * SEGMENT,
        ..Feedback::default()
    };
    *now = *now + millis(1000);
    trial.update(*now, &feedback, Some(starts_cycle), trial.max_overflows());
    MAX_OVERFLOWS - trial.max_overflows()
}

#[test]
fn longer_bursts_are_judged_by_whole_cycles() {
    for steps in [
        &[(1023, 0, true, 0), (1, 0, true, 1), (1024, 0, true, 2)][..],
        &[(2000, 0, false, 0), (2000, 0, true, 1), (1950, 0, true, 2)],
        &[(2000, 0, false, 0), (2000, 0, true, 1), (1949, 0, true, 0)],
        &[(2000, 0, true, 1), (2400, 0, true, 2), (2000, 0, true, 1)],
        &[(2000, 0, true, 1), (1950, 0, true, 2), (1949, 0, true, 1)],
        &[
            (2000, 20, true, 1),
            (2000, 141, true, 2),
            (2000, 142, true, 1),
        ],
        &[
            (2000, 600, true, 1),
            (2000, 0, true, 2),
            (2000, 241, true, 3),
        ],
        &[
            (2000, 600, true, 1),
            (2000, 0, true, 2),
            (2000, 242, true, 1),
        ],
        &[(2000, 0, true, 1), (1, 121, false, 1), (1, 1, false, 0)],
        &[(2000, 0, true, 1), (2999, 182, false, 1), (1, 1, false, 0)],
        &[
            (2000, 0, true, 1),
            (2000, 0, true, 2),
            (1500, 0, true, 1),
            (1500, 0, true, 1),
            (1500, 0, true, 0),
        ],
    ] {
        let (mut trial, mut now) = (Trial::default(), START);
        judge(&mut trial, &mut now, 1024, 0, true);
        for &(acked, lost, starts_cycle, spared) in steps {
            let judged = judge(&mut trial, &mut now, acked, lost, starts_cycle);
            assert_eq!(judged, spared, "{steps:?}");
        }
    }
}

#[test]
fn longer_bursts_are_tried_less_and_less_often() {
    let (mut trial, mut now, mut spared) = (Trial::default(), START, 0);
    let tries = (0..220).filter(|_| {
        let acked = if spared > 0 { 1500 } else { 2000 };
        spared = judge(&mut trial, &mut now, acked, 0, true);
        spared > 0
    });
    assert!(tries.eq([1, 10, 27, 60, 125, 190]));
}

#[test]
fn bbr_tries_longer_bursts_while_the_path_is_the_limit() {
    type Step = fn(&mut Sender);
    let share: Step = |it| (0..9).for_each(|_| it.controller.pacer.on_start_settled(true));
    let lose: Step = |it| {
        _ = it
            .send(900)
            .wait(millis(11))
            .feedback(0, 1)
            .feedback(800, 99)
    };
    let cases: [(u64, Step, Step, usize); 5] = [
        (150, |_| {}, |_| {}, 8),
        (150, |it| _ = it.run_dry(), |_| {}, 1),
        (150, share, |_| {}, 1),
        (1000, |_| {}, |_| {}, usize::MAX),
        (1000, |_| {}, lose, 1),
    ];
    for (segments, always, at_last, max_turn) in cases {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(segments, 10, millis(10));
        for round in 0..=70 {
            always(&mut sender);
            if round == 70 {
                at_last(&mut sender);
            }
            sender.send(segments).wait(millis(11));
            sender.feedback(0, 1).feedback(1, usize::MAX);
            (0..5).for_each(|_| sender.controller.pacer.on_overflow(true, 0));
        }
        assert_eq!(sender.controller.max_turn(), max_turn);
    }
}

/// Sends 1024 segments in each period. `outcome` says how many get lost, and how many microseconds that takes.
fn spread(periods: usize, mut outcome: impl FnMut(usize, bool) -> (u64, u64)) -> String {
    let (mut spread, mut rtt) = (Spread::default(), Rtt::default());
    rtt.update(micros(100), Duration::ZERO);
    let (mut now, mut feedback) = (START, Feedback::default());
    spread.start_period(now, 0);
    let period = |at| {
        let is_on = spread.is_on;
        let (lost, time) = outcome(at, is_on);
        now = now + micros(time);
        feedback.last_sent += 1024;
        feedback.newest_acked = Some(Flight {
            sequence: feedback.last_sent,
            ..Flight::default()
        });
        (feedback.acked, feedback.lost) = ((1024 - lost) * SEGMENT, lost * SEGMENT);
        spread.update(now, &feedback, &rtt, true);
        if is_on { '+' } else { '.' }
    };
    (0..periods).map(period).collect()
}

#[test]
fn bursts_are_spread_out_if_that_halves_the_loss() {
    for (off, on, expected) in [
        ((30, 1000), (0, 1000), "................"),
        ((31, 1000), (0, 1000), ".++.++++.+++++++"),
        ((200, 1000), (100, 1000), ".++.++++.+++++++"),
        ((200, 1000), (101, 900), ".+..+....+......"),
        ((200, 1000), (0, 1380), ".++.++++.+++++++"),
        ((200, 1000), (0, 1381), ".+..+....+......"),
        ((200, 801), (0, 801), ".++.++++.+++++++"),
        ((200, 800), (0, 800), "..++++..++++++++"),
    ] {
        let periods = spread(16, |_, is_on| if is_on { on } else { off });
        assert_eq!(periods, expected, "{off:?} {on:?}");
    }
}

#[test]
fn other_way_of_sending_bursts_is_tried_now_and_then() {
    for lost in [0, 200] {
        let periods = spread(400, |_, is_on| (if is_on { lost } else { 200 }, 1000));
        let stays = periods.as_bytes().chunk_by(|a, b| a == b);
        assert_eq!(stays.map(<[u8]>::len).max(), Some(64));
    }
}

#[test]
fn spreading_out_follows_the_path() {
    let periods = spread(24, |at, is_on| match (at, is_on) {
        (4..9, true) | (14.., true) => (0, 1000),
        _ => (200, 1000),
    });
    assert_eq!(periods, ".+..++.+++..+....++.++++");
}

#[test]
fn spikes_of_loss_do_not_add_up() {
    let periods = spread(24, |at, _| (if at % 6 == 0 { 200 } else { 0 }, 1000));
    assert_eq!(periods, ".++...".repeat(4));
}

#[test]
fn spreading_out_is_judged_by_what_it_has_a_part_in() {
    enum Step {
        /// Acknowledged, lost, and the newest of them.
        Feedback(u64, u64, u64),
        Late(u64),
        Restart,
    }
    use Step::*;
    for (steps, stays_on) in [
        (
            &[(9, Feedback(0, 476, 1500)), (10, Feedback(1024, 0, 1501))][..],
            true,
        ),
        (&[(10, Feedback(1024, 0, 1501))], false),
        (
            &[
                (2, Feedback(9, 0, 1501)),
                (9, Feedback(0, 1, 1500)),
                (10, Feedback(1015, 0, 1502)),
            ],
            false,
        ),
        (
            &[
                (1, Feedback(9, 0, 1501)),
                (9, Restart),
                (10, Feedback(1015, 0, 1502)),
            ],
            true,
        ),
        (
            &[(1, Feedback(0, 101, 1501)), (2, Feedback(923, 0, 1502))],
            false,
        ),
        (
            &[
                (1, Feedback(0, 101, 1501)),
                (1, Late(1)),
                (2, Feedback(923, 0, 1502)),
                (3, Feedback(0, 1000, 1503)),
            ],
            true,
        ),
        (&[(1, Late(5000)), (10, Feedback(1024, 0, 1501))], false),
    ] {
        let (mut spread, mut rtt) = (Spread::default(), Rtt::default());
        rtt.update(micros(100), Duration::ZERO);
        spread.start_period(START, 0);
        for (at, step) in [(1, Feedback(824, 200, 1024))].iter().chain(steps) {
            let now = START + millis(*at);
            match *step {
                Feedback(acked, lost, newest_lost) => {
                    let feedback = super::Feedback {
                        acked: acked * SEGMENT,
                        lost: lost * SEGMENT,
                        newest_lost,
                        last_sent: 1500,
                        ..super::Feedback::default()
                    };
                    spread.update(now, &feedback, &rtt, true);
                }
                Late(len) => spread.on_late(len * SEGMENT),
                Restart => spread.on_idle_restart(now),
            }
        }
        assert_eq!(spread.is_on, stays_on);
    }
}

#[test]
fn spreading_out_is_only_tried_for_short_queues() {
    let (mut spread, mut now, mut last_sent) = (Spread::default(), START, 0);
    spread.start_period(now, 0);
    let periods = [false, true, false, false, false].map(|is_queue_short| {
        (now, last_sent) = (now + millis(3000), last_sent + 1);
        let feedback = Feedback {
            acked: 1024 * SEGMENT,
            lost: if spread.is_on { 0 } else { 200 * SEGMENT },
            newest_lost: last_sent,
            last_sent,
            ..Feedback::default()
        };
        spread.update(now, &feedback, &Rtt::default(), is_queue_short);
        spread.is_on
    });
    assert_eq!(periods, [false, true, true, false, true]);
}

#[test]
fn bbr_spreads_out_bursts_once_it_knows_the_bandwidth() {
    type Step = fn(&mut Sender);
    let lossy_rounds = |sender: &mut Sender, rtt, always: Step| {
        for _ in 0..20 {
            sender.run_dry().send(60).wait(rtt).feedback(5, usize::MAX);
            always(sender);
        }
        sender.controller.spreads_out()
    };
    let late: Step = |it| it.controller.on_late(4 * SEGMENT);
    let cases: [(Sender, u64, Step, bool); 5] = [
        (Sender::new(Algorithm::Cubic), 10, |_| {}, false),
        (Sender::new(Algorithm::Bbr), 10, |_| {}, false),
        (bbr_probing(), 10, |_| {}, true),
        (bbr_probing(), 40, |_| {}, false),
        (bbr_probing(), 10, late, false),
    ];
    for (mut sender, rtt, always, expected) in cases {
        assert_eq!(lossy_rounds(&mut sender, millis(rtt), always), expected);
    }
}

#[test]
fn an_outage_is_no_reason_to_spread_bursts_out() {
    let mut sender = bbr_probing();
    sender.send(60).controller.on_persistent_congestion();
    sender.wait(millis(10)).feedback(59, 1);
    for _ in 0..40 {
        sender.rounds_of(60, 1, millis(10));
        assert!(!sender.controller.spreads_out());
    }
}

#[test]
fn bursts_can_be_excused() {
    let mut sender = bbr_probing();
    sender.send(60).controller.excuse_bursts(START);
    sender.wait(millis(10)).feedback(60, 0);
    for _ in 0..40 {
        sender.rounds_of(60, 1, millis(10));
        assert!(!sender.controller.spreads_out());
    }
}

#[test]
fn pauses_do_not_count_against_spreading_out() {
    let mut sender = bbr_probing();
    while !sender.controller.spreads_out() {
        sender.run_dry().send(60).wait(millis(10));
        sender.feedback(5, usize::MAX);
    }
    for _ in 0..30 {
        sender.run_dry().wait(millis(20));
        sender.rounds_of(60, 1, millis(10));
        assert!(sender.controller.spreads_out());
    }
}

#[test]
fn longer_bursts_on_trial_are_no_reason_to_spread_them_out() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(150, 10, millis(10));
    let mut trials = 0;
    for _ in 0..200 {
        let is_on_trial = sender.controller.pacer.is_on_trial();
        trials += u32::from(is_on_trial);
        sender.send(150).wait(millis(11)).feedback(0, 1);
        sender.feedback(if is_on_trial { 8 } else { 1 }, usize::MAX);
        (0..5).for_each(|_| sender.controller.pacer.on_overflow(true, 0));
        assert!(!sender.controller.spreads_out());
    }
    assert!(trials > 0);
}

#[test]
fn lost_starts_say_nothing_while_bursts_are_spread_out() {
    for is_on in [false, true] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.controller.spread.is_on = is_on;
        for _ in 0..6 {
            sender.wait(millis(10)).send(2).wait(micros(10));
            sender.feedback(1, 1);
        }
        assert_eq!(sender.controller.pacer.bonus() > 0, is_on);
    }
}

#[test]
fn sampler_takes_the_lower_of_both_rates() {
    // The second packet follows the delivery of the first.
    for (first_rtt, gap, second_rtt, expected) in [
        (10, 0, 10, Some(100_000)),
        (10, 0, 20, Some(50_000)),
        (10, 10, 10, Some(50_000)),
        (40, 0, 10, Some(25_000)),
        (10, 0, 0, None),
        (10, 5_000_000, 0, Some(0)),
    ] {
        let mut sampler = BandwidthSampler::new();
        sampler.delivered = u64::from(u32::MAX) - 1500;
        sampler.on_idle_restart(START);
        let mut now = START;
        let mut sample = None;
        for (sequence, rtt) in [(1, first_rtt), (2, second_rtt)] {
            let mut flight = Flight {
                at: now,
                len: 1000,
                sequence,
                ..Flight::default()
            };
            sampler.on_sent(&mut flight);
            sample = sampler.on_delivered(now + millis(rtt), 1000, &flight);
            assert!(sequence > 1 || sample == Some(1_000_000 / rtt));
            now = now + millis(rtt + gap);
        }
        assert_eq!(sample, expected);
    }
}

#[test]
fn sampler_is_limited_until_a_later_packet_is_delivered() {
    let mut sampler = BandwidthSampler::new();
    sampler.on_application_limited(2);
    for (sequence, expected) in [(1, true), (2, true), (3, false)] {
        let flight = Flight {
            sequence,
            ..Flight::default()
        };
        sampler.on_delivered(START, 1000, &flight);
        assert_eq!(sampler.is_application_limited(), expected);
    }
}

#[test]
fn window_and_pace_limit_the_first_flight() {
    // Twice the window in 50 ms, and 2/ln(2) times the window in 25 ms.
    for (algorithm, burst, delay) in [(Algorithm::Cubic, 12, 1562), (Algorithm::Bbr, 14, 1083)] {
        let mut sender = Sender::new(algorithm);
        assert_eq!(sender.burst(), burst);
        let next = START + micros(delay);
        assert_eq!(
            sender.controller.permit(START, 0, || true),
            Permit::At(next)
        );
        assert_eq!(sender.fill().controller.in_flight(), INITIAL_WINDOW);
    }
}

#[test]
fn loss_ends_the_burst() {
    for algorithm in ALGORITHMS {
        for (lost, acked, burst) in [(0, 1, 8..=12), (1, 0, 1..=2)] {
            let mut sender = Sender::new(algorithm);
            sender.send(2).wait(millis(50)).feedback(lost, acked);
            assert_within(sender.burst(), burst);
        }
    }
}

#[test]
fn only_the_pacer_is_caught_up_with() {
    for (algorithm, expected) in [(Algorithm::Cubic, 1..=3), (Algorithm::Bbr, 5..=8)] {
        let mut sender = Sender::new(algorithm);
        sender.rtt.update(millis(100), Duration::ZERO);
        assert_eq!(sender.burst(), 11);
        assert_within(sender.wait(millis(8)).burst(), 5..=8);
        assert_eq!(sender.run_dry().wait(millis(8)).burst(), 1);
        while sender.wait(millis(2)).burst() > 0 {}
        sender.wait(millis(80)).feedback(0, 20);
        assert_within(sender.burst(), expected);
    }
}

#[test]
fn a_full_window_is_refilled_in_larger_pieces_on_short_paths() {
    for algorithm in ALGORITHMS {
        for (lost, acked, unsent, later, burst) in [
            (0, 6, u64::MAX, 0, 0..=0),
            (0, 7, u64::MAX, 0, 14..=14),
            (0, 1, u64::MAX, 999, 0..=0),
            (0, 1, u64::MAX, 1000, 2..=2),
            (0, 1, SEGMENT, 0, 2..=2),
            (1, 9, u64::MAX, 0, 4..=9),
        ] {
            let mut sender = Sender::new(algorithm);
            sender.rtt.update(micros(100), Duration::ZERO);
            sender.fill().wait(micros(100)).feedback(lost, acked);
            sender.controller.permit(sender.now, unsent, || true);
            let before = sender.wait(micros(later)).flights.len();
            while sender.controller.permit(sender.now, unsent, || true) == Permit::Now {
                sender.send(1);
            }
            assert_within((sender.flights.len() - before) as u64, burst);
        }
    }
}

#[test]
fn discarded_packets_say_nothing() {
    for algorithm in ALGORITHMS {
        let mut sender = Sender::new(algorithm);
        sender.fill().wait(millis(10));
        for flight in sender.flights.drain(..) {
            assert!(sender.controller.discard(&flight));
        }
        sender.feedback(0, 0);
        assert_eq!(sender.controller.in_flight(), 0);
        assert_eq!(sender.window(), INITIAL_WINDOW);
    }
}

#[test]
fn packets_of_the_old_path_say_nothing() {
    for algorithm in ALGORITHMS {
        let mut sender = Sender::new(algorithm);
        sender.rounds(2, millis(10)).fill();
        let old = sender.flights.len();
        sender.controller.restart(1200);
        assert_eq!(sender.controller.in_flight(), 0);
        sender.send(1).wait(millis(10)).feedback(5, old - 5);
        assert_eq!(sender.controller.in_flight(), SEGMENT);
        assert_eq!(sender.window(), INITIAL_WINDOW);
        assert_eq!(sender.feedback(0, 1).controller.in_flight(), 0);
    }
}

#[test]
fn acknowledgments_come_in_any_order() {
    for algorithm in ALGORITHMS {
        let [ascending, descending] = [false, true].map(|reverses| {
            let mut sender = Sender::new(algorithm);
            sender.send(16).wait(millis(5)).send(16).wait(millis(10));
            sender.rtt.update(millis(10), Duration::ZERO);
            if reverses {
                sender.flights.make_contiguous().reverse();
            }
            for flight in &sender.flights {
                sender.controller.on_acked(flight);
            }
            sender.feedback(0, 0);
            (sender.window(), sender.pacing_rate())
        });
        assert_eq!(ascending, descending);
    }
}

#[test]
fn persistent_congestion_leaves_the_minimum() {
    for (algorithm, segments) in [(Algorithm::Cubic, 2), (Algorithm::Bbr, 4)] {
        for (datagram_len, segment) in [(1200, SEGMENT), (9000, 9000)] {
            let mut sender = Sender::new(algorithm);
            sender.controller.set_datagram_len(datagram_len);
            sender.rounds(1, millis(10)).fill().wait(millis(10));
            sender.controller.on_persistent_congestion();
            assert_eq!(sender.feedback(20, 1).window(), segments * segment);
        }
    }
}

#[test]
fn window_has_a_limit() {
    for algorithm in ALGORITHMS {
        let mut sender = Sender::new(algorithm);
        assert_eq!(sender.rounds(15, millis(100)).window(), MAX_WINDOW);
    }
}

#[test]
fn window_does_not_grow_unused() {
    for (algorithm, limit) in [(Algorithm::Cubic, 52), (Algorithm::Bbr, 72)] {
        let mut sender = Sender::new(algorithm);
        for _ in 0..1000 {
            sender.send(20).run_dry().wait(millis(10)).feedback(0, 20);
        }
        assert_eq!(sender.segments(), limit);
    }
}

#[test]
fn links_are_filled() {
    for algorithm in ALGORITHMS {
        for buffer in [50, 200, 800] {
            let mut path = Path::fast(algorithm, buffer);
            path.saturate(millis(1000), |_| {});
            let lost = path.lost;
            assert_within(path.saturate(millis(2000), |_| {}), 97..=100);
            assert_within(path.lost - lost, 0..=150);
        }
    }
}

#[test]
fn links_are_filled_through_short_queues() {
    for (delay, buffer) in [(micros(200), 3), (millis(1), 3), (millis(20), 4)] {
        let mut path = Path::new(Algorithm::Bbr, micros(100), delay, buffer);
        path.saturate(millis(1000), |_| {});
        assert_within(path.saturate(millis(2000), |_| {}), 88..=100);
    }
}

#[test]
fn links_are_filled_by_senders_that_wake_late() {
    for algorithm in ALGORITHMS {
        for wake_period in [1000, 5000, 30_000] {
            let mut path = Path::fast(algorithm, 800);
            path.wake_period = wake_period;
            path.saturate(millis(3000), |_| {});
            assert_within(path.saturate(millis(2000), |_| {}), 90..=101);
        }
    }
}

#[test]
fn links_are_filled_by_senders_that_are_busy_at_times() {
    for (buffer, drops, used, lost) in [
        (2000, 0, 90..=101, 0..=0),
        (2000, 30, 85..=101, 2..=4),
        (300, 0, 58..=66, 0..=3),
        (300, 30, 56..=66, 2..=6),
    ] {
        let mut path = Path::fast(Algorithm::Bbr, buffer);
        (path.busy, path.drops) = ((100_000, 200_000), drops);
        path.saturate(millis(5000), |_| {});
        (path.delivered, path.lost) = (0, 0);
        assert_within(path.saturate(millis(5000), |_| {}), used);
        assert_within(path.lost * 100 / path.delivered, lost);
    }
}

#[test]
fn links_are_filled_if_acknowledgments_are_bunched() {
    for algorithm in ALGORITHMS {
        let mut path = Path::new(algorithm, micros(100), millis(2), 400);
        path.ack_period = 10_000;
        path.saturate(millis(11_000), |_| {});
        assert_within(path.saturate(millis(2000), |_| {}), 90..=101);
    }
}

#[test]
fn pauses_are_not_followed_by_a_window_at_once() {
    for algorithm in ALGORITHMS {
        let mut path = Path::fast(algorithm, 200);
        path.transfer(10_000, |_| {});
        path.now = path.now + millis(5000);
        path.longest_burst = 0;
        path.transfer(1000, |_| {});
        assert_within(path.longest_burst, 10..=40);
    }
}

#[test]
fn any_sequence_of_calls_is_fine() {
    let mut random = Random(1);
    for case in 0..400 {
        let algorithm = match case % 2 {
            0 => Algorithm::Cubic,
            _ => Algorithm::Bbr,
        };
        let mut controller = Controller::new(algorithm, 1200, case);
        let (mut rtt, mut now, mut in_flight) = (Rtt::default(), Instant::default(), 0);
        let mut flights = VecDeque::new();
        for _ in 0..500 {
            let magnitude = random.below(8 + u64::from(case) / 7);
            let step = micros(random.below(1 << magnitude.min(63)));
            now = match random.below(16) {
                0 => now - step,
                1..4 => now,
                _ => now + step,
            };
            let len = random.below(1 << 16) as u16 >> random.below(16);
            match random.below(64) {
                0 => {
                    controller.restart(len);
                    flights.iter_mut().for_each(|(_, counts)| *counts = false);
                    in_flight = 0;
                }
                1 => controller.set_datagram_len(len),
                2 => controller.on_persistent_congestion(),
                3..6 => controller.on_application_limited(),
                6..10 => rtt.update(step, Duration::ZERO),
                10..24 => controller.end_ack(now, &rtt),
                24..44 => {
                    flights.push_back((controller.on_sent(now, len, &rtt), true));
                    in_flight += u64::from(len);
                }
                fate => {
                    let at = random.below(4) as usize;
                    let Some((flight, counts)) = flights.remove(at) else {
                        continue;
                    };
                    match fate {
                        44 => assert_eq!(controller.discard(&flight), counts),
                        45..48 => controller.on_lost(&flight, fate == 45),
                        _ => controller.on_acked(&flight),
                    }
                    in_flight -= u64::from(flight.len) * u64::from(counts);
                }
            }
            assert_eq!(controller.in_flight(), in_flight);
            assert_within(controller.window(), 2 * SEGMENT..=MAX_WINDOW);
            match controller.permit(now, 0, || true) {
                Permit::Now => assert!(in_flight < controller.window()),
                Permit::At(time) => assert!(time > now && in_flight > 0),
                Permit::Blocked => assert!(in_flight >= controller.window()),
            }
        }
    }
}

#[test]
fn cubic_doubles_in_slow_start() {
    let mut sender = Sender::new(Algorithm::Cubic);
    for segments in [64, 128, 256] {
        assert_eq!(sender.rounds(1, millis(10)).segments(), segments);
        assert_eq!(sender.pacing_rate(), 2 * 100 * sender.window());
    }
}

#[test]
fn cubic_reduces_once_per_recovery_period() {
    let mut sender = Sender::new(Algorithm::Cubic);
    let reduced = INITIAL_WINDOW * 4 / 5;
    sender.fill().wait(millis(10));
    assert_eq!(sender.feedback(1, 1).window(), reduced);
    assert_eq!(sender.feedback(1, 0).window(), reduced);
    assert_eq!(sender.feedback(1, usize::MAX).window(), reduced);
    assert_eq!(sender.pacing_rate(), 100 * reduced);

    sender.send(2).wait(millis(10)).feedback(0, 1);
    assert_eq!(sender.pacing_rate(), 125 * reduced);
    assert_eq!(sender.feedback(1, 0).window(), reduced * 4 / 5);
    for _ in 0..20 {
        sender.send(1).feedback(1, 0);
    }
    assert_eq!(sender.window(), 2 * SEGMENT);
}

/// With a window that was reduced from 1024 segments, and nothing in flight.
fn cubic_after_loss(rtt: Duration) -> Sender {
    let mut sender = Sender::new(Algorithm::Cubic);
    sender.rounds(5, rtt).fill().wait(rtt);
    assert_eq!(sender.feedback(1, usize::MAX).segments(), 819);
    sender
}

#[test]
fn cubic_follows_the_curve() {
    // K is 8 seconds.
    let mut sender = cubic_after_loss(millis(100));
    for segments in [941, 1000, 1021, 1024, 1027, 1051, 1114] {
        assert_eq!(sender.rounds(20, millis(100)).segments(), segments);
    }
}

#[test]
fn cubic_stops_the_clock_while_the_window_is_not_in_use() {
    let mut sender = cubic_after_loss(millis(100));
    sender.rounds(20, millis(100));
    assert_eq!(sender.rounds_of(470, 20, millis(100)).segments(), 941);
    sender.wait(millis(60_000));
    assert_eq!(sender.rounds_of(471, 1, millis(100)).segments(), 945);
    assert_eq!(sender.rounds(19, millis(100)).segments(), 1000);
}

#[test]
fn cubic_converges_fast() {
    let mut sender = cubic_after_loss(millis(100));
    sender.rounds(20, millis(100)).fill().wait(millis(100));
    assert_eq!(sender.feedback(1, usize::MAX).segments(), 753);
    assert_eq!(sender.rounds(20, millis(100)).segments(), 820);
    assert_eq!(sender.rounds(40, millis(100)).segments(), 847);
}

#[test]
fn cubic_keeps_up_with_reno() {
    let mut sender = cubic_after_loss(micros(100));
    assert_within(sender.rounds(100, micros(100)).segments(), 898..=900);
}

#[test]
fn cubic_grows_by_half_at_most() {
    let mut sender = cubic_after_loss(millis(30_000));
    assert_eq!(sender.rounds(1, millis(30_000)).segments(), 1229);
    assert_eq!(sender.rounds(10, millis(30_000)).window(), MAX_WINDOW);
}

#[test]
fn cubic_starts_slowly_after_persistent_congestion() {
    let mut sender = cubic_after_loss(millis(100));
    sender.send(1).controller.on_persistent_congestion();
    sender.feedback(1, 0);
    assert_eq!(sender.rounds(8, millis(100)).segments(), 512);
    assert_eq!(sender.rounds(1, millis(100)).segments(), 655);
    assert_eq!(sender.rounds(20, millis(100)).segments(), 671);

    sender.fill().controller.on_persistent_congestion();
    assert_eq!(sender.feedback(20, 1).feedback(0, 1).segments(), 3);
}

#[test]
fn bbr_paces_by_the_initial_window_at_first() {
    let mut sender = Sender::new(Algorithm::Bbr);
    let high = INITIAL_WINDOW * 2954 / 1024;
    assert_eq!(sender.pacing_rate(), high * 40);
    sender.rtt.update(millis(20), Duration::ZERO);
    assert_eq!(sender.pacing_rate(), high * 50);
    sender.send(3).wait(millis(10)).feedback(0, 1);
    assert_eq!(sender.pacing_rate(), high * 100);
    sender.feedback(1, 1);
    assert_eq!(sender.pacing_rate(), INITIAL_WINDOW * 100);
}

#[test]
fn bbr_does_without_samples_while_time_stands_still() {
    let mut sender = Sender::new(Algorithm::Bbr);
    assert_eq!(sender.rounds(10, Duration::ZERO).segments(), 128);
}

#[test]
fn bbr_starts_up_drains_and_cycles() {
    let mut first_paces = BTreeSet::new();
    for random in 0..32 {
        let mut path = Path::slow(Algorithm::Bbr, 200);
        path.controller = Controller::new(Algorithm::Bbr, LEN as u16, random << 20);
        let mut paces = Vec::new();
        path.saturate(millis(2000), |path| paces.push(path.pace()));
        paces.dedup();
        let mut paces = paces.into_iter().skip_while(|&pace| pace != 288);
        assert_eq!((paces.next(), paces.next()), (Some(288), Some(35)));
        let first = paces.next();
        first_paces.insert(first);
        let cycle = [100, 125, 75].into_iter().cycle();
        let expected = cycle.skip_while(|&pace| Some(pace) != first).skip(1);
        assert!(paces.zip(expected).all(|(a, b)| a == b));
        assert_within(path.controller.window(), 85 * LEN..=88 * LEN);
    }
    assert_eq!(first_paces, BTreeSet::from([Some(100), Some(125)]));
}

#[test]
fn bbr_starts_up_until_the_bandwidth_stops_growing() {
    for (rounds, is_over) in [
        (&[60, 60, 60, 60][..], false),
        (&[60, 60, 60, 60, 60], true),
        (&[60, 60, 60, 60, 74], true),
        (&[60, 60, 60, 60, 75, 75, 75], false),
        (&[60, 60, 60, 60, 75, 75, 75, 75], true),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        for &segments in rounds {
            sender.rounds_of(segments, 1, millis(10));
        }
        assert_eq!(sender.pacing_rate() < 100 * 100 * SEGMENT, is_over);
    }
}

#[test]
fn bbr_ends_startup_if_the_credit_allows_for_a_queue() {
    for (left, blocked_every, dip, is_over) in [
        (75, 1, 0, true),
        (75, 13, 0, true),
        (74, 1, 0, false),
        (75, 200, 0, false),
        (80, 1, 5, true),
        (79, 1, 5, false),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 2, millis(10)).run_dry();
        sender.send(left + 6).wait(millis(9));
        for time in 1..70 {
            let len = match time % 7 {
                1 => 6 - dip,
                2 => 6 + dip,
                _ => 6,
            };
            sender.wait(millis(1)).feedback(0, 6).send(len).run_dry();
            if time % blocked_every == 0 {
                sender.controller.on_out_of_credit();
            }
        }
        assert_eq!(gain(&sender) < 200, is_over, "{left} {blocked_every} {dip}");
    }
}

#[test]
fn bbr_ends_startup_if_the_application_only_runs_dry_on_its_way_for_more() {
    for (acked, expects_more, dry_every, long_pause_every, is_over) in [
        (20, true, 1, 1000, true),
        (20, true, 5, 1000, true),
        (20, true, 1, 20, true),
        (20, true, 1, 5, false),
        (20, false, 1, 1000, false),
        (127, true, 1, 1000, true),
        (128, true, 1, 1000, false),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 2, millis(10)).run_dry();
        sender.send(sender.segments()).wait(millis(10));
        sender.feedback(0, 50).send(50).wait(millis(10));
        let interval = millis(11) * acked / 60;
        for time in 1..2000 / acked {
            sender.wait(interval - millis(2));
            sender.feedback(0, acked as usize).send(acked - 10);
            if time % dry_every == 0 {
                sender.run_dry();
            }
            let pause = micros(1000 + u64::from(time % long_pause_every == 0));
            sender.wait(pause);
            while (sender.controller).permit(sender.now, 1, || expects_more) != Permit::Blocked {
                sender.send(1);
            }
            sender.wait(millis(2) - pause);
        }
        let case = (acked, expects_more, dry_every, long_pause_every);
        assert_eq!(gain(&sender) < 200, is_over, "{case:?}");
    }
}

#[test]
fn bbr_waits_for_the_samples_of_rounds_in_which_the_application_has_kept_up() {
    for (dry_at, len) in [(5, 48), (6, 38), (17, 38), (18, 28)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 2, millis(10)).run_dry();
        sender.send(sender.segments()).wait(millis(10));
        let startup = (0..100).take_while(|&time| {
            sender.wait(millis(3)).feedback(0, 18);
            match time % 22 == dry_at {
                true => sender.send(17).run_dry(),
                false => sender.fill(),
            };
            gain(&sender) > 200
        });
        assert_eq!(startup.count(), len, "{dry_at}");
    }
}

#[test]
fn bbr_takes_the_path_to_hold_what_the_first_long_flight_finds() {
    let fills = |sender: &Sender, segments| match &sender.controller.model {
        Model::Bbr(bbr) => bbr.fills_path(segments * SEGMENT),
        Model::Cubic(_) => false,
    };
    let mut sender = Sender::new(Algorithm::Bbr);
    assert!(!fills(&sender, 1000));
    sender.rounds_of(5, 1, millis(10)).run_dry();
    sender.rounds_of(20, 1, millis(40));
    assert_eq!([24, 25].map(|it| fills(&sender, it)), [false, true]);
}

#[test]
fn bbr_does_not_suspect_a_short_queue_once_the_credit_fills_a_long_one() {
    let suspects = |sender: &Sender| match &sender.controller.model {
        Model::Bbr(bbr) => bbr.suspects_short_queue(),
        Model::Cubic(_) => false,
    };
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(60, 2, millis(10));
    while !suspects(&sender) {
        sender.run_dry().send(60).wait(millis(10)).feedback(0, 15);
        sender.feedback(usize::from(!suspects(&sender)), usize::MAX);
    }
    sender.run_dry().send(90).wait(millis(9));
    while gain(&sender) > 200 {
        sender.wait(millis(1)).feedback(0, 6).run_dry().send(6);
        sender.controller.on_out_of_credit();
    }
    assert!(!suspects(&sender));
}

#[test]
fn bbr_only_counts_rounds_that_were_both_long_and_out_of_credit() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(60, 2, millis(10));
    for _ in 0..10 {
        sender.controller.on_out_of_credit();
        sender.run_dry().rounds_of(60, 1, millis(10)).run_dry();
        sender.send(160).wait(millis(20)).feedback(0, 80);
        sender.run_dry().send(80).wait(millis(20)).feedback(0, 80);
        sender.run_dry().send(1).wait(millis(20)).feedback(0, 81);
    }
    assert!(gain(&sender) > 200);
}

#[test]
fn bbr_forgets_rounds_without_growth_if_as_much_gets_through() {
    for (limited, segments, lost, rtt, is_over) in [
        (3, 60, 1, 12_500, true),
        (4, 60, 1, 12_500, false),
        (11, 60, 1, 12_501, true),
        (12, 60, 1, 12_501, false),
        (4, 60, 5, 12_500, false),
        (4, 60, 6, 12_500, true),
        (5, 60, 6, 12_500, false),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 3, millis(10));
        for round in 0..limited {
            let (lost, rtt) = if round == 2 { (lost, rtt) } else { (0, 10_000) };
            sender.run_dry().send(segments).wait(micros(rtt));
            sender.feedback(0, 15).feedback(lost, usize::MAX);
        }
        sender.rounds_of(60, 2, millis(10));
        let result = sender.pacing_rate() < 100 * 100 * SEGMENT;
        assert_eq!(result, is_over, "{limited} {segments} {lost} {rtt}");
    }
}

#[test]
fn bbr_forgets_rounds_without_growth_as_usual_if_bursts_lose_their_starts() {
    for (limited, is_over) in [(7, true), (8, false)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        (0..32).for_each(|_| sender.controller.pacer.on_start_settled(true));
        sender.rounds_of(60, 3, millis(10));
        for round in 0..limited {
            sender.run_dry().send(60).wait(millis(10)).feedback(0, 15);
            sender.controller.feedback.is_overflow = round == 2;
            sender.feedback(usize::from(round == 2), usize::MAX);
        }
        sender.rounds_of(60, 2, millis(10));
        assert_eq!(sender.pacing_rate() < 100 * 100 * SEGMENT, is_over);
    }
}

#[test]
fn bbr_starts_up_for_longer_if_recovery_holds_it_back() {
    for (rounds, is_over) in [
        (&[8, 8, 8][..], false),
        (&[8, 8, 8, 8], true),
        (&[8, 10, 12, 15], true),
        (&[8, 11, 14, 18, 18, 18], false),
        (&[8, 11, 14, 18, 18, 18, 18], true),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(200, 1, millis(10));
        for &segments in rounds {
            sender.send(segments + 1).wait(millis(10));
            sender.feedback(1, usize::MAX);
        }
        assert_eq!(sender.pacing_rate() < 400 * 100 * SEGMENT, is_over);
    }
}

#[test]
fn bbr_starts_up_until_short_transfers_suffer_high_loss() {
    for (segments, lost, late, rtt, is_high) in [
        (100, 5, 0, 12_501, false),
        (100, 6, 0, 12_501, true),
        (100, 6, 1, 12_501, false),
        (100, 6, 0, 12_500, false),
        (299, 6, 0, 12_501, true),
        (300, 6, 0, 12_501, false),
        (1000, 20, 0, 12_501, false),
        (1000, 21, 0, 12_501, true),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        let startup_rate = sender.rounds(6, millis(10)).pacing_rate();
        for round in 1..=4 {
            sender.run_dry().send(segments).wait(micros(rtt));
            sender.feedback(lost, segments as usize - lost - 1);
            sender.wait(micros(1)).feedback(0, 1);
            sender.controller.on_late(late * SEGMENT);
            let is_over = sender.pacing_rate() < startup_rate / 2;
            assert_eq!(is_over, is_high && round == 4);
        }
    }
}

/// One letter per round: `c` is for congestion, `x` for loss without it. `.9` stands for nine rounds without either.
/// Returns the pace, which would be 8000, and whether a short queue is suspected.
fn ceiling_after(rounds: &str) -> (u64, bool) {
    let mut ceiling = Ceiling::NONE;
    for word in rounds.split_ascii_whitespace() {
        let (kind, count) = word.split_at(1);
        for _ in 0..count.parse().unwrap_or(1) {
            let pacing_rate = ceiling.rate.min(8000);
            match kind {
                "c" => ceiling.on_congestion(pacing_rate),
                kind => ceiling.on_clear_round(pacing_rate, kind == "x"),
            }
        }
    }
    (ceiling.rate.min(8000), ceiling.suspects_short_queue())
}

#[test]
fn ceiling_comes_down_on_trial_if_loss_recurs() {
    for (rounds, expected) in [
        (".300", (8000, false)),
        ("x2", (8000, false)),
        ("x3", (7000, true)),
        ("x2 . x", (8000, false)),
        ("x2 . x2", (7000, true)),
        ("x2 .4 x2", (8000, false)),
        ("x3 x", (8000, false)),
        ("x3 .3 x", (8000, false)),
        ("x3 .3 x3", (8000, false)),
        ("x3 .3 x4", (7000, true)),
        ("x3 .4 x", (7000, true)),
        ("x3 .4 x3", (6125, true)),
        ("x3 .4 x4", (7000, false)),
        ("x3 c", (6125, false)),
        ("x3 c x", (6125, false)),
        ("c x3", (6125, true)),
        ("c x4", (7000, false)),
        ("c x8", (7000, false)),
        ("c x9", (7875, false)),
        ("c x11", (7875, false)),
    ] {
        assert_eq!(ceiling_after(rounds), expected, "{rounds}");
    }
}

#[test]
fn ceiling_stays_longer_if_it_went_up_too_far() {
    for (rounds, expected) in [
        ("c .8", (7000, false)),
        ("c .9", (7875, false)),
        ("c .7 x2", (7875, false)),
        ("x3 .8", (7000, true)),
        ("x3 .9", (7875, false)),
        ("c .17", (7875, false)),
        ("c .18", (8000, false)),
        ("c .18 .9 x", (8000, false)),
        ("c .9 .2 x", (6891, true)),
        ("c .9 .3 x", (7875, false)),
        ("c .9 x .17", (6891, true)),
        ("c .9 x .18", (7752, false)),
        ("c .9 .4 c .17", (6891, false)),
        ("c .9 .5 c .9", (7752, false)),
        ("c .9 c2 .17", (6030, false)),
        ("c .9 c2 .18", (6783, false)),
        ("c .9 c .18 c .35", (6783, false)),
        ("c .9 c .18 c .36 c .71", (6677, false)),
        ("c .9 c .18 c .36 c .72 c .71", (6573, false)),
        ("c .9 c .18 c .36 c .72 c .72", (7394, false)),
        ("c2 .9 c .18 .9", (7629, false)),
        ("c2 .9 c .18 .9 c .17", (6676, false)),
        ("c2 .9 c .18 .9 c .18", (7510, false)),
        ("c .9 x2 c .9", (7752, false)),
    ] {
        assert_eq!(ceiling_after(rounds), expected, "{rounds}");
    }
}

#[test]
fn bbr_needs_long_rounds_to_forget_those_that_met_a_queue() {
    for (rtt, segments, is_over) in [(12_500, 1, false), (12_600, 52, true), (12_600, 53, false)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(1, 1, millis(10));
        sender.rounds_of(60, 3, micros(rtt));
        for _ in 0..20 {
            sender.run_dry().rounds_of(segments, 1, millis(10));
        }
        sender.rounds_of(60, 2, micros(rtt));
        assert_eq!(sender.pacing_rate() < 100 * 100 * SEGMENT, is_over);
    }
}

#[test]
fn bbr_measures_rounds_against_the_longest_one_that_met_a_queue() {
    for (segments, is_over) in [(68, false), (69, true)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 3, millis(10));
        sender.run_dry().send(segments).wait(micros(12_501));
        sender.feedback(0, 1).feedback(1, usize::MAX);
        for _ in 0..12 {
            sender.run_dry().rounds_of(60, 1, millis(10));
        }
        sender.rounds_of(60, 2, millis(10));
        assert_eq!(sender.pacing_rate() < 100 * 100 * SEGMENT, is_over);
    }
}

#[test]
fn bbr_does_not_measure_rounds_against_one_that_did_not_count() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(60, 2, millis(10));
    sender.run_dry().send(200).wait(micros(40_000));
    sender.feedback(0, 1).feedback(1, usize::MAX);
    for round in 0..60 {
        let (lost, rtt) = if round % 10 == 9 {
            (6, 12_501)
        } else {
            (0, 10_000)
        };
        sender.run_dry().send(60).wait(micros(rtt));
        sender.feedback(0, 1).feedback(lost, usize::MAX);
    }
    assert!(sender.pacing_rate() > 100 * 100 * SEGMENT);
}

#[test]
fn bbr_blames_the_queue_for_the_lost_end_of_a_flight() {
    for (rtt, is_lower) in [(12_500, false), (13_000, true)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        let startup_rate = sender.rounds_of(100, 2, millis(10)).pacing_rate();
        sender.run_dry().send(100).wait(micros(rtt)).feedback(0, 99);
        sender.wait(millis(30)).send(1).wait(millis(10));
        sender.feedback(1, 1).run_dry().rounds_of(1, 1, millis(10));
        assert_eq!(sender.pacing_rate() < startup_rate, is_lower);
    }
}

#[test]
fn bbr_does_not_measure_rounds_against_a_short_one_if_there_is_a_queue() {
    for (segments, is_over) in [(41, true), (42, false)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(1, 1, millis(10));
        sender.rounds_of(60, 1, micros(12_600));
        sender.run_dry().rounds_of(5, 2, micros(12_600));
        for _ in 0..20 {
            sender.run_dry().rounds_of(segments, 1, millis(10));
        }
        sender.rounds_of(5, 2, micros(12_600));
        assert_eq!(sender.pacing_rate() < 100 * 100 * SEGMENT, is_over);
    }
}

#[test]
fn ceiling_only_hears_of_rounds_that_use_the_path() {
    for (segments, is_lower) in [(29, false), (30, true)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        let startup_rate = sender.rounds_of(60, 2, millis(10)).pacing_rate();
        for _ in 0..4 {
            sender.run_dry().send(segments + 1).wait(millis(10));
            sender.feedback(0, 1).feedback(1, usize::MAX);
        }
        assert_eq!(sender.pacing_rate() < startup_rate, is_lower);
    }
}

#[test]
fn bbr_starts_short_transfers_with_a_shorter_burst_if_loss_recurs() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(15, 2, millis(20));
    let bursts = [1, 1, 1, 0, 0, 1, 0].map(|lost| {
        let burst = sender.burst();
        sender.send(15 - burst).run_dry().wait(millis(20));
        sender.feedback(0, 1).feedback(lost, usize::MAX);
        sender.send(1).run_dry().wait(millis(20)).feedback(0, 1);
        burst
    });
    assert_eq!(bursts, [15, 13, 13, 7, 7, 7, 13]);
}

#[test]
fn bbr_starts_up_more_slowly_if_short_transfers_meet_a_queue() {
    let mut sender = Sender::new(Algorithm::Bbr);
    let startup_rate = sender.rounds_of(100, 2, millis(10)).pacing_rate();
    let mut rates = |rounds, lost, late, rtt, is_limited| {
        let round = |_| {
            if is_limited {
                sender.run_dry();
            }
            sender.send(100).wait(micros(rtt));
            sender.feedback(0, 1).feedback(lost, usize::MAX);
            sender.controller.on_late(late * SEGMENT);
            sender.pacing_rate() * 1000 / startup_rate
        };
        (0..rounds).map(round).collect::<Vec<_>>()
    };
    assert_eq!(rates(2, 1, 0, 12_500, true), [1000, 1000]);
    assert_eq!(rates(2, 1, 1, 12_501, true), [1000, 1000]);
    assert_eq!(rates(2, 1, 0, 12_501, true), [1000, 875]);
    assert_eq!(
        rates(10, 0, 0, 10_000, true)[..],
        [[765; 9].as_slice(), &[861]].concat()
    );
    assert_eq!(rates(5, 1, 0, 12_501, true), [861, 753, 693, 1000, 875]);
    assert_eq!(rates(1, 0, 0, 10_000, false), [1000]);
}

#[test]
fn bbr_starts_up_until_long_rounds_overflow_a_queue() {
    for (segments, overflows, is_high) in [
        (28, 4, false),
        (30, 4, true),
        (30, 2, false),
        (49, 4, true),
        (50, 4, false),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(10, 2, millis(10));
        for round in 1..=4 {
            sender.run_dry().send(segments).wait(millis(segments));
            sender.controller.feedback.is_overflow = round <= overflows;
            sender.feedback(1, segments as usize - 2);
            sender.wait(micros(1)).feedback(0, 1);
            let is_over = sender.pacing_rate() < 2000 * SEGMENT;
            assert_eq!(is_over, is_high && round == 4, "{segments} {round}");
        }
    }
}

/// On a path that delivers 6 segments per millisecond and holds 60, about to probe for more.
fn bbr_probing() -> Sender {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(1, 1, millis(10));
    while gain(&sender) != 125 {
        sender.rounds_of(66, 1, millis(11));
    }
    sender
}

/// In percent.
fn gain(sender: &Sender) -> u64 {
    sender.pacing_rate() / (60 * SEGMENT)
}

#[test]
fn bbr_enters_the_cycle_at_random_but_does_not_probe_right_after_a_queue() {
    for (lost, first) in [(0, 0), (1, 1)] {
        let rounds_until_probe = (0..64).map(|random| {
            let mut sender = Sender::new(Algorithm::Bbr);
            sender.controller = Controller::new(Algorithm::Bbr, 1200, random * 1000);
            sender.rounds_of(1, 1, millis(10));
            sender.send(2).wait(millis(13)).feedback(lost, 2);
            sender.rounds_of(66, 3, millis(11));
            (0..).position(|_| gain(sender.rounds_of(66, 1, millis(11))) == 125)
        });
        let expected = (first..7).map(Some).collect::<BTreeSet<_>>();
        assert_eq!(rounds_until_probe.collect::<BTreeSet<_>>(), expected);
    }
}

#[test]
fn bbr_probes_until_there_is_a_queue() {
    let mut sender = bbr_probing();
    assert_eq!(gain(sender.rounds_of(66, 3, millis(11))), 125);
    assert_eq!(gain(sender.send(74).wait(millis(13)).feedback(0, 74)), 125);
    assert_eq!(gain(sender.send(75).wait(millis(13)).feedback(0, 5)), 75);
    assert_eq!(gain(sender.feedback(0, 9)), 75);
    assert_eq!(gain(sender.feedback(0, 1)), 100);
    assert_eq!(gain(sender.feedback(0, 60)), 100);
    for expected in [100, 100, 100, 100, 100, 125] {
        assert_eq!(gain(sender.rounds_of(33, 1, millis(11))), expected);
    }
}

#[test]
fn bbr_probes_until_there_is_loss() {
    let mut sender = bbr_probing();
    sender.send(74).wait(millis(10));
    assert_eq!(gain(sender.feedback(1, 1)), 125);
    assert_eq!(gain(sender.wait(micros(1)).feedback(0, 1)), 125);
    assert_eq!(gain(sender.feedback(1, 1)), 75);
    assert_eq!(gain(sender.wait(millis(10)).feedback(0, 1)), 75);
    assert_eq!(gain(sender.wait(micros(1)).feedback(0, 1)), 100);
}

#[test]
fn bbr_probes_again_soon_if_that_has_paid() {
    for (segments, lost, runs_dry, expected) in [
        (80, 0, false, [0, 5]),
        (79, 0, false, [5, 5]),
        (80, 1, false, [5, 5]),
        (80, 0, true, [5, 5]),
    ] {
        let mut sender = bbr_probing();
        let rounds_until_probe = [lost, 0].map(|lost| {
            sender.rounds_of(segments, 1, millis(11));
            sender.send(200).wait(millis(40)).feedback(0, 1);
            sender.feedback(lost, usize::MAX);
            (0..20).position(|_| {
                if runs_dry {
                    sender.send(1).run_dry();
                }
                gain(sender.rounds_of(60, 1, millis(11))) > 140
            })
        });
        assert_eq!(rounds_until_probe, expected.map(Some));
    }
}

#[test]
fn bbr_does_not_wait_for_a_probe_that_starts_with_a_queue() {
    for acked_first in [0, 1] {
        let mut sender = bbr_probing();
        sender.send(66).wait(millis(11)).feedback(1, usize::MAX);
        sender.rounds_of(66, 6, millis(11));
        sender.send(66).wait(millis(13)).feedback(0, acked_first);
        assert_eq!(gain(sender.feedback(1, usize::MAX)), 125);
        assert_eq!(gain(sender.run_dry().rounds_of(1, 1, millis(11))), 75);
    }
}

#[test]
fn bbr_does_not_get_closer_to_a_probe_by_sending_little_after_a_queue() {
    let rounds_until_probe = |sender: &mut Sender, segments| {
        (0..20).position(|_| gain(sender.run_dry().rounds_of(segments, 1, millis(11))) == 125)
    };
    for (acked_first, rtt, segments, expected) in [
        (1, 12_500, 29, Some(5)),
        (1, 12_501, 29, None),
        (0, 12_501, 29, None),
        (1, 12_501, 30, Some(5)),
    ] {
        let mut sender = bbr_probing();
        sender.send(75).wait(micros(rtt)).feedback(0, acked_first);
        sender.feedback(1, 1).feedback(0, usize::MAX);
        assert_eq!(rounds_until_probe(&mut sender, segments), expected);
        if expected.is_some() {
            sender.send(75).wait(micros(rtt)).feedback(0, 1);
            sender.feedback(0, usize::MAX);
            assert_eq!(rounds_until_probe(&mut sender, 1), Some(5));
        }
    }
}

#[test]
fn bbr_keeps_cycling_after_an_overflow_if_bursts_lose_their_starts() {
    for (lost_starts, rtt, expected) in
        [(0, 12_500, None), (32, 12_500, Some(5)), (32, 12_501, None)]
    {
        let mut sender = bbr_probing();
        (0..lost_starts).for_each(|_| sender.controller.pacer.on_start_settled(true));
        sender.send(75).wait(micros(rtt)).feedback(0, 1);
        sender.controller.feedback.is_overflow = true;
        sender.feedback(1, 1).feedback(0, usize::MAX);
        let rounds_until_probe =
            (0..20).position(|_| gain(sender.run_dry().rounds_of(29, 1, millis(11))) == 125);
        assert_eq!(rounds_until_probe, expected);
    }
}

#[test]
fn bbr_waits_for_a_probe_that_starts_with_an_overflow_if_bursts_lose_their_starts() {
    for (lost_starts, expected) in [(0, 75), (32, 125)] {
        let mut sender = bbr_probing();
        sender.send(66).wait(millis(13)).feedback(1, usize::MAX);
        sender.rounds_of(66, 6, millis(11));
        (0..lost_starts).for_each(|_| sender.controller.pacer.on_start_settled(true));
        sender.send(66).wait(millis(11));
        sender.controller.feedback.is_overflow = true;
        assert_eq!(gain(sender.feedback(1, usize::MAX)), 125);
        let after = gain(sender.run_dry().rounds_of(1, 1, millis(11)));
        assert_eq!(after, expected);
    }
}

#[test]
fn bbr_remembers_the_bandwidth_for_ten_rounds() {
    let mut sender = bbr_probing();
    assert_eq!(gain(sender.rounds_of(33, 10, millis(11))), 125);
    assert_eq!(gain(sender.rounds_of(33, 1, millis(11))), 62);
}

#[test]
fn bbr_remembers_the_bandwidth_while_the_application_is_the_limit() {
    let mut sender = bbr_probing();
    for _ in 0..50 {
        sender.run_dry().rounds_of(5, 1, millis(11));
    }
    assert_eq!(gain(sender.rounds_of(33, 3, millis(11))), 125);
    assert_eq!(gain(sender.rounds_of(33, 1, millis(11))), 62);
}

#[test]
fn bbr_makes_room_for_bunched_acknowledgments() {
    let mut sender = bbr_probing();
    assert_eq!(sender.wait(millis(1)).segments(), 2 * 60 + 66 + 3);
    for _ in 0..11 {
        sender.send(66).wait(millis(10)).feedback(0, 33);
        sender.wait(millis(1)).feedback(0, 33);
    }
    assert_eq!(sender.segments(), 2 * 60 + 66 + 3 - 6);
}

#[test]
fn bbr_makes_room_for_no_more_than_was_held_back() {
    let windows = [(10, 1), (21, 1), (21, 3), (21, 8)].map(|(rtt, pause)| {
        let mut sender = bbr_probing();
        for _ in 0..12 {
            sender.send(61).wait(millis(rtt)).feedback(0, 1);
            sender.wait(millis(pause)).feedback(0, 10);
            for _ in 0..5 {
                sender.wait(micros(500)).feedback(0, 10);
            }
        }
        sender.segments()
    });
    assert_eq!(windows, [99, 58, 67, 86]);
}

#[test]
fn bbr_adds_three_datagrams_to_the_window() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.controller = Controller::new(Algorithm::Bbr, 4 * SEGMENT as u16, 0);
    sender.rounds_of(1, 1, millis(1));
    assert_eq!(sender.rounds_of(500, 8, millis(2)).segments(), 1012);
}

#[test]
fn bbr_adds_less_to_the_window_on_slow_paths() {
    for (segments, rtt, tenths) in [(10, 50, 330), (10, 75, 319), (10, 150, 309), (1, 50, 50)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(segments, 8, millis(rtt));
        assert_eq!(sender.window() * 10 / SEGMENT, tenths);
    }
}

#[test]
fn bbr_adds_nothing_to_the_window_right_after_an_overflow() {
    for (rtt, ends_burst, rounds) in [(12, false, 0), (13, false, 2), (12, true, 2)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 8, millis(10));
        sender.send(60).wait(millis(rtt)).feedback(0, 57);
        for flight in sender.flights.drain(..) {
            (sender.controller).on_lost(&flight, ends_burst && flight.sequence % 60 == 0);
        }
        sender.feedback(0, 0);
        for round in 0..5 {
            sender.send(60).wait(millis(rtt)).feedback(0, 30);
            let expected = if round < rounds { 180 } else { 183 };
            assert_eq!(sender.feedback(0, 30).segments(), expected);
        }
    }
}

#[test]
fn bbr_keeps_large_windows_in_proportion_to_the_path() {
    for (segments, expected) in [(500, 1003), (1200, 2000), (3000, 4500)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(1, 1, millis(1));
        sender.rounds_of(segments, 8, millis(2));
        assert_eq!(sender.segments(), expected);
    }
}

#[test]
fn bbr_probes_the_round_trip_time() {
    for delay in [millis(2), millis(40), millis(100)] {
        let mut path = Path::new(Algorithm::Bbr, millis(1), delay, 1000);
        let (mut start, mut end) = (Instant::NEVER, START);
        path.saturate(millis(5000), |_| {});
        path.delay = delay * 2;
        path.saturate(millis(8000), |path| {
            if path.controller.window() == 4 * SEGMENT {
                (start, end) = (start.min(path.now), path.now);
            }
            assert_within(path.pace(), 60..=125);
        });
        assert_within((start - START).as_millis(), 10_000..=10_700);
        let longest = 220 + 5 * delay.as_millis();
        assert_within((end - start).as_millis(), 195..=longest);
        assert_within(path.saturate(millis(5000), |_| {}), 97..=101);
    }
}

#[test]
fn bbr_probes_the_round_trip_time_for_at_least_a_round() {
    let mut sender = Sender::new(Algorithm::Bbr);
    let window = sender.rounds_of(60, 34, millis(300)).segments();
    sender.send(60).wait(millis(300));
    assert_eq!(sender.feedback(0, 57).segments(), 4);
    assert_eq!(sender.wait(millis(250)).feedback(0, 1).segments(), 4);
    assert_eq!(sender.rounds_of(1, 1, millis(300)).segments(), window);
    assert_eq!(sender.rounds_of(60, 33, millis(300)).segments(), window);
    assert_eq!(sender.rounds_of(60, 1, millis(300)).segments(), 4);
}

#[test]
fn bbr_resumes_startup_after_probing_the_round_trip_time() {
    let mut sender = Sender::new(Algorithm::Bbr);
    let mut windows = Vec::new();
    sender.send(2);
    for _ in 0..1100 {
        sender.send(2).run_dry().wait(millis(10)).feedback(0, 2);
        windows.push(sender.segments());
    }
    windows.dedup();
    assert!(windows.ends_with(&[60, 62, 4, 62]));
    assert_eq!(sender.rounds(1, millis(20)).segments(), 124);
}

#[test]
fn bbr_measures_what_has_paid_from_the_start_of_the_cycle() {
    let rounds_until_probe = (0..64).map(|random| {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.controller = Controller::new(Algorithm::Bbr, 1200, random * 1000);
        sender.rounds_of(1, 1, millis(10));
        sender.rounds_of(66, 1, millis(11));
        sender.rounds_of(80, 3, millis(11));
        (0..).position(|_| gain(sender.rounds_of(84, 1, millis(11))) > 140)
    });
    assert_eq!(rounds_until_probe.max(), Some(Some(5)));
}

#[test]
fn bbr_does_not_probe_the_round_trip_time_if_it_sees_it_without_filling_the_path() {
    for (rtt, until, runs_dry, probes) in [
        (11_250, 10_100, true, false),
        (11_252, 10_100, true, true),
        (11_250, 10_100, false, true),
        (11_250, 7600, true, false),
        (11_250, 7400, true, true),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(1, 1, millis(10)).send(10).wait(millis(10));
        let mut smallest = u64::MAX;
        while sender.now < START + millis(10_200) {
            let rtt = match sender.now < START + millis(until) {
                true => micros(rtt),
                false => millis(20),
            };
            sender.send(10);
            if runs_dry {
                sender.run_dry();
            }
            sender.wait(rtt / 2).feedback(0, 10);
            smallest = smallest.min(sender.segments());
        }
        assert_eq!(smallest == 4, probes, "{rtt} {until}");
    }
}

#[test]
fn bbr_does_not_fill_the_queue_again_after_the_path_has_become_much_slower() {
    let mut path = Path::fast(Algorithm::Bbr, 3000);
    path.saturate(millis(3000), |_| {});
    path.time_per_packet = millis(5);
    path.saturate(millis(15_000), |_| {});
    let used = path.saturate(millis(15_000), |it| assert!(it.rtt.latest < millis(100)));
    assert_within(used, 97..=100);
}

#[test]
fn bbr_starts_over_in_startup_too() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(60, 1, millis(10)).send(120);
    sender.wait(millis(10_001)).feedback(0, 60);
    for _ in 0..5 {
        sender.wait(millis(12)).feedback(0, 12);
    }
    assert_eq!(sender.rounds_of(1, 20, millis(10)).segments(), 11);
}

#[test]
fn bbr_does_not_go_by_an_old_trickle() {
    for (pause, expected) in [(4_990_000, 11), (4_990_001, 183)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 1000, millis(10)).send(120);
        sender.wait(micros(10_001)).feedback(0, 60);
        for _ in 0..5 {
            sender.wait(millis(12)).feedback(0, 12);
        }
        sender.wait(micros(pause)).rounds_of(1, 1, millis(10));
        assert_eq!(sender.segments(), expected);
    }
}

#[test]
fn what_arrives_among_losses_or_late_is_part_of_a_trickle() {
    let among_losses: fn(&mut Sender) = |it| _ = it.feedback(0, 5).feedback(1, 13);
    let late: fn(&mut Sender) = |it| {
        it.controller.on_late(13 * SEGMENT);
        it.feedback(0, 5);
    };
    for (len, step) in [(19, among_losses), (5, late)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 1000, millis(10)).send(60 + 5 * len);
        sender.wait(micros(10_001)).feedback(0, 60);
        (0..5).for_each(|_| step(sender.wait(millis(12))));
        assert_eq!(gain(sender.rounds_of(1, 20, millis(10))), 100);
    }
}

/// Probes the round-trip time up to the last round, with `len` packets arriving after each pause.
fn trickle(former_rtt: Duration, pauses: &[u64], len: u64, rtt: Duration) -> Sender {
    let mut sender = Sender::new(Algorithm::Bbr);
    let per_second = MICROS_PER_SECOND / former_rtt.as_micros();
    sender.rounds_of(6000 / per_second, 10 * per_second, former_rtt);
    sender.send(60 + len * pauses.len() as u64);
    sender.wait(rtt + micros(1)).feedback(0, 60);
    assert_eq!(sender.segments(), 4);
    for &pause in pauses {
        sender.wait(micros(pause)).feedback(0, len as usize);
    }
    sender.rounds_of(
        1,
        (millis(200) - micros(1)).as_micros() / rtt.as_micros(),
        rtt,
    );
    sender
}

#[test]
fn bbr_starts_over_if_a_flight_trickles_in() {
    let uneven = |longest| vec![15_000, 15_000, longest, 15_000, 15_000];
    for (former_rtt, pauses, len, rtt, expected) in [
        (10, vec![10_001; 5], 12, 10_000, (12, 153)),
        (10, vec![10_000; 5], 12, 10_000, (124, 100)),
        (10, vec![12_000; 5], 17, 10_000, (15, 153)),
        (10, vec![12_000; 5], 18, 10_000, (124, 100)),
        (10, uneven(19_998), 12, 10_000, (8, 153)),
        (10, uneven(20_000), 12, 10_000, (124, 100)),
        (100, vec![100_000; 5], 100, 128_999, (129, 48)),
        (100, vec![100_000; 5], 100, 129_000, (1804, 100)),
        (10, vec![3_000_000; 5], 100, 10_000, (4, 153)),
    ] {
        let mut sender = trickle(millis(former_rtt), &pauses, len, micros(rtt));
        sender.rounds_of(1, 1, micros(rtt));
        assert_eq!((sender.segments(), gain(&sender)), expected);
        sender.rounds_of(1, 1, micros(2 * rtt));
        assert_eq!(min_rtt(&sender), micros(rtt));
    }
}

#[test]
fn bbr_keeps_what_it_knows_about_packets_when_it_starts_over() {
    let mut sender = trickle(millis(100), &[100_000; 5], 100, millis(100));
    sender.send(4).wait(millis(100));
    sender.controller.on_persistent_congestion();
    assert_eq!(sender.feedback(3, 1).segments(), 4);
    sender.send(1).wait(millis(100)).feedback(0, 1);
    assert_eq!((sender.segments(), gain(&sender)), (102, 48));

    let mut sender = trickle(millis(10), &[3_000_000; 5], 100, millis(10));
    sender.controller.set_datagram_len(9000);
    sender.rounds_of(1, 1, millis(10)).send(5).wait(millis(10));
    assert_eq!(sender.feedback(4, 1).window(), 4 * 9000);

    let mut sender = trickle(millis(100), &[100_000; 5], 100, millis(100));
    sender.send(3).run_dry().wait(millis(100)).feedback(0, 1);
    assert_eq!(sender.feedback(1, 0).feedback(0, 1).segments(), 4);

    let mut sender = trickle(millis(100), &[100_000; 5], 100, millis(100));
    sender
        .send(2)
        .wait(millis(100))
        .feedback(0, 1)
        .feedback(0, 1);
    assert!(matches!(&sender.controller.model, Model::Bbr(it) if it.random != 0));
    assert_eq!(sender.rounds_of(10, 10, millis(100)).segments(), 202);
    assert_eq!(sender.rounds_of(10, 1, millis(100)).segments(), 31);
}

#[test]
fn bbr_does_not_catch_up_while_it_drains_the_queue() {
    let mut path = Path::fast(Algorithm::Bbr, 400);
    path.unsent = u64::MAX / 2;
    while path.pace() > 50 || path.delivered < 200 || path.controller.room() < 20 * LEN {
        path.step();
    }
    path.now = path.now + millis(60);
    while path.controller.permit(path.now, u64::MAX, || true) == Permit::Now {
        path.send();
    }
    path.longest_burst = 0;
    path.step();
    assert_within(path.longest_burst, 1..=20);
}

#[test]
fn bbr_stops_catching_up_when_it_starts_to_drain_the_queue() {
    let bursts = [2, 3].map(|rounds| {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(1, 1, millis(10));
        sender.rounds_of(66, rounds, millis(11)).send(10).burst();
        sender.wait(millis(30)).burst();
        let len = sender.flights.len();
        sender.wait(millis(30)).burst();
        sender.feedback(0, len).burst()
    });
    assert_eq!(bursts, [92, 13]);
}

#[test]
fn bbr_does_not_allow_for_more_of_a_queue_than_there_can_be() {
    for (pause, expected) in [(80_001, 15), (80_000, 100)] {
        let mut sender = trickle(millis(100), &[pause; 5], 5, millis(100));
        assert_eq!(gain(sender.rounds_of(1, 1, millis(100))), expected);
    }
}

#[test]
fn waiting_for_a_loss_to_be_found_is_not_part_of_a_trickle() {
    for (pause, acked, expected) in [(10_001, 1, 58), (10_000, 1, 100), (10_001, 0, 57)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 1000, millis(10)).send(130 + acked);
        sender.wait(micros(10_001)).feedback(0, 60);
        for _ in 0..4 {
            sender.wait(micros(pause)).feedback(0, 12);
        }
        sender.wait(millis(500)).feedback(10, acked as usize);
        sender.wait(micros(pause)).feedback(0, 12);
        assert_eq!(gain(sender.rounds_of(1, 20, millis(10))), expected);
    }
}

#[test]
fn bbr_is_not_limited_by_an_application_that_has_gone_for_more() {
    for awaits_more in [false, true] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.send(1).wait(millis(10)).feedback(0, 1).send(1);
        sender.controller.on_run_dry(awaits_more);
        let flight = sender.send(1).flights.back();
        assert_eq!(
            flight.map(|it| it.is_application_limited),
            Some(!awaits_more)
        );
    }
}

#[test]
fn bbr_does_not_take_the_pace_of_the_application_for_that_of_the_path() {
    for (gaps, runs_dry, expected) in [
        ([4999; 5], true, 153),
        ([5000; 5], true, 100),
        ([5000; 5], false, 153),
        ([0, 0, 90_000, 0, 4999], true, 153),
        ([0, 0, 90_000, 0, 5000], true, 100),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 1000, millis(10)).send(1);
        if runs_dry {
            sender.run_dry();
        }
        for gap in gaps {
            sender.wait(micros(gap)).send(12);
        }
        assert_eq!(sender.wait(millis(10)).feedback(0, 1).segments(), 4);
        for _ in 0..5 {
            sender.wait(millis(20)).feedback(0, 12);
        }
        assert_eq!(gain(sender.rounds_of(1, 20, millis(10))), expected);
    }
}

#[test]
fn acknowledgments_that_are_read_together_share_the_pause_before_them() {
    for (gaps, apart, expected) in [
        ([0, 19].repeat(5), 999, 100),
        ([0, 19].repeat(5), 1000, 153),
        ([vec![15; 2], vec![0; 8]].concat(), 0, 153),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 1000, millis(10)).send(1).run_dry();
        for gap in gaps {
            sender.wait(millis(gap)).send(6);
        }
        sender.wait(millis(10)).feedback(0, 1);
        for _ in 0..5 {
            sender.wait(millis(20)).feedback(0, 6);
            sender.wait(micros(apart)).feedback(0, 6);
        }
        assert_eq!(gain(sender.rounds_of(1, 20, millis(10))), expected);
    }
}

#[test]
fn bbr_does_not_take_the_end_of_a_trickle_for_a_round_of_probing() {
    for (pause, is_over) in [(10, false), (0, true)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender
            .rounds_of(60, 1000, millis(10))
            .send(61)
            .wait(millis(10));
        sender.send(1).wait(micros(1)).feedback(0, 1).send(3);
        for _ in 0..5 {
            sender.wait(millis(pause)).feedback(0, 12);
        }
        sender.wait(millis(300)).send(1).feedback(0, 4);
        assert_eq!(sender.segments() > 4, is_over);
    }
}

fn min_rtt(sender: &Sender) -> Duration {
    match &sender.controller.model {
        Model::Bbr(bbr) => bbr.min_rtt(&sender.rtt),
        Model::Cubic(_) => Duration::ZERO,
    }
}

fn ack_oldest_with_delay(sender: &mut Sender, ack_delay: Duration) {
    if let Some(flight) = sender.flights.pop_front() {
        sender.controller.on_acked(&flight);
        sender.rtt.update(sender.now - flight.at, ack_delay);
        sender.controller.end_ack(sender.now, &sender.rtt);
    }
}

#[test]
fn bbr_makes_room_for_what_the_first_long_flight_finds() {
    for (before, has_paused, is_long, lost, expected) in [
        (31, true, true, 0, 30),
        (32, true, true, 0, 10),
        (31, false, true, 0, 10),
        (31, true, false, 0, 10),
        (31, true, true, 1, 10),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(before, 1, millis(10));
        if has_paused {
            sender.run_dry();
        }
        sender.send(20);
        if !is_long {
            sender.run_dry();
        }
        sender.wait(millis(30)).feedback(lost, 2);
        assert_eq!(min_rtt(&sender), millis(expected));
    }
    for (rtt, expected) in [(12_500, 10_000), (12_501, 12_501)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(5, 1, millis(10)).run_dry().send(20);
        sender.wait(micros(rtt)).feedback(0, 2);
        assert_eq!(min_rtt(&sender), micros(expected));
    }
}

#[test]
fn bbr_goes_by_what_the_first_long_flight_finds_while_it_starts_up() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(5, 1, millis(10)).run_dry();
    assert_eq!(min_rtt(sender.rounds_of(20, 3, millis(30))), millis(30));
    assert_eq!(min_rtt(sender.rounds_of(1, 1, millis(12))), millis(12));
    assert_eq!(min_rtt(sender.rounds_of(20, 3, millis(30))), millis(10));
}

#[test]
fn bbr_keeps_half_of_that_unless_draining_helps() {
    for (drained, ack_delay, expected) in [(40, 0, 15), (26, 0, 13), (40, 16, 12), (18, 0, 10)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(5, 1, millis(10)).run_dry();
        sender.rounds_of(20, 4, millis(30)).send(80);
        assert_eq!(min_rtt(sender.wait(millis(30)).feedback(0, 1)), millis(15));
        sender.send(1).flights.rotate_right(1);
        ack_oldest_with_delay(sender.wait(millis(drained)), millis(ack_delay));
        assert_eq!(min_rtt(sender.feedback(0, 79)), millis(expected));
        assert_eq!(
            min_rtt(sender.rounds_of(20, 1, millis(20))),
            millis(expected)
        );
    }
}

#[test]
fn bbr_drains_for_three_rounds_at_most() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(1, 1, millis(10)).send(59);
    let mut rounds = 0;
    for _ in 0..20 {
        sender.send(60).wait(millis(50)).feedback(0, 60);
        rounds += u64::from(matches!(&sender.controller.model, Model::Bbr(it) if it.is_draining()));
    }
    assert_eq!(rounds, 4);
}

/// Round trips are in milliseconds. The shortest one there was took 10.
fn end_round(delay: &mut ForeignDelay, flight: u64, rtt: u64, bandwidth: u64) -> Option<Verdict> {
    delay.on_acked(millis(rtt + 50), flight / 2);
    delay.on_acked(millis(rtt), flight);
    delay.on_acked(millis(rtt + 50), flight / 2);
    delay.end_round(millis(10), bandwidth, true)
}

/// Takes how many rounds there are of each kind. Returns the one that starts a trial.
fn first_trial(rounds: &[(usize, u64, u64)]) -> Option<usize> {
    let mut delay = ForeignDelay::default();
    (rounds.iter())
        .flat_map(|&(count, flight, rtt)| core::iter::repeat_n((flight, rtt), count))
        .position(|(flight, rtt)| {
            end_round(&mut delay, flight, rtt, 0);
            delay.trial_len > 0
        })
}

#[test]
fn delays_may_be_foreign_if_smaller_flights_do_not_shorten_them() {
    for (rounds, expected) in [
        (&[(2, 800, 200), (9, 600, 200)][..], Some(5)),
        (&[(1, 800, 200), (9, 600, 200)], None),
        (&[(2, 800, 200), (9, 601, 200)], None),
        (&[(2, 800, 160), (9, 600, 146)], Some(5)),
        (&[(2, 800, 160), (9, 600, 145)], None),
        (&[(2, 800, 160), (9, 400, 131)], Some(5)),
        (&[(2, 800, 160), (9, 400, 130)], None),
        (&[(2, 800, 100), (9, 600, 100)], Some(5)),
        (&[(2, 800, 99), (9, 600, 99)], Some(6)),
        (&[(2, 800, 21), (99, 600, 21)], Some(21)),
        (&[(2, 800, 20), (99, 600, 20)], None),
        // They shorten them little by little.
        (
            &[(2, 800, 160), (1, 610, 160), (1, 610, 146), (9, 600, 146)],
            Some(7),
        ),
        (
            &[(2, 800, 160), (1, 610, 160), (1, 610, 145), (9, 600, 145)],
            None,
        ),
        // It is interrupted.
        (
            &[(2, 800, 200), (3, 600, 200), (2, 601, 200), (9, 600, 200)],
            Some(5),
        ),
        (
            &[(2, 800, 200), (2, 600, 200), (2, 601, 200), (9, 600, 200)],
            Some(9),
        ),
        (
            &[(2, 800, 50), (6, 600, 50), (2, 601, 50), (9, 600, 50)],
            Some(17),
        ),
        (
            &[(2, 800, 200), (3, 600, 200), (1, 600, 100), (9, 600, 200)],
            None,
        ),
    ] {
        assert_eq!(first_trial(rounds), expected, "{rounds:?}");
    }
}

#[test]
fn delays_are_compared_with_those_of_the_largest_recent_flight() {
    for (rounds, expected) in [
        (&[(2, 800, 200), (20, 700, 200)][..], true),
        (&[(2, 800, 200), (21, 700, 200)], false),
        (&[(30, 800, 200), (20, 700, 200)], true),
        (&[(2, 700, 200), (2, 800, 200)], true),
        (&[(2, 800, 400), (1, 800, 200)], true),
        (&[(2, 800, 200), (1, 800, 400)], false),
    ] {
        let rounds = [rounds, &[(9, 600, 200)]].concat();
        assert_eq!(first_trial(&rounds).is_some(), expected, "{rounds:?}");
    }
}

#[test]
fn delays_are_not_foreign_if_they_give_way_at_a_single_step() {
    for (step, expected) in [
        ((1400, 306), true),
        ((1400, 305), false),
        ((1401, 305), true),
    ] {
        let rounds = [(2, 1800, 200), (1, 1600, 320), (1, step.0, step.1)];
        let rounds = [&rounds[..], &[(9, 1350, 320)]].concat();
        assert_eq!(first_trial(&rounds).is_some(), expected, "{step:?}");
    }
    let rounds = [(2, 800, 100), (2, 600, 200), (9, 400, 150)];
    assert_eq!(first_trial(&rounds), None);
}

/// Takes the last samples of the bandwidth.
fn start_trial(samples: [u64; 3]) -> ForeignDelay {
    let mut delay = ForeignDelay::default();
    for (flight, rtt, sample) in [
        (800, 100, 0),
        (800, 100, 0),
        (600, 200, 0),
        (600, 200, samples[0]),
        (600, 200, samples[1]),
    ] {
        assert_eq!(end_round(&mut delay, flight, rtt, sample), None);
    }
    assert_eq!((delay.trial_len, delay.trial_rate()), (0, 0));
    assert_eq!(end_round(&mut delay, 480, 200, samples[2]), None);
    assert_eq!(delay.trial_len, 720);
    delay
}

#[test]
fn trials_go_by_what_has_just_got_through() {
    for (samples, expected) in [
        ([2300, 1600, 2000], 3000),
        ([2300, 2000, 1600], 3000),
        ([0, 0, 9000], 3600),
    ] {
        assert_eq!(start_trial(samples).trial_rate(), expected);
    }
}

#[test]
fn delays_are_foreign_if_a_larger_flight_gets_more_through() {
    for (rounds, expected) in [
        (&[(2250, false)][..], (120, 3333)),
        (&[(2249, false), (9000, false)], (120, 9000)),
        (&[(0, false), (2249, false)], (0, 2249)),
        (&[(0, true), (0, false), (0, true), (7, false)], (0, 2000)),
        (&[(0, true), (0, true), (2250, true)], (120, 3333)),
        (&[(0, true), (0, true), (7, true)], (0, 2000)),
    ] {
        let mut delay = start_trial([2000; 3]);
        for (left, &(bandwidth, has_lost)) in (0..rounds.len()).rev().zip(rounds) {
            delay.has_lost = has_lost;
            let expected = (left == 0).then_some(Verdict {
                rtt: millis(expected.0),
                bandwidth: expected.1,
            });
            assert_eq!(end_round(&mut delay, 900, 240, bandwidth), expected);
            assert_eq!(delay.trial_len > 0, left > 0);
        }
    }
}

#[test]
fn flights_get_no_larger_than_they_were() {
    for (rtt, expected) in [(400, 2250), (200, 4000), (100, 8000), (50, 8000)] {
        let mut delay = start_trial([2000; 3]);
        let verdict = end_round(&mut delay, 900, rtt, 2250);
        assert_eq!(verdict.map(|it| it.bandwidth), Some(expected));
    }
}

#[test]
fn trials_are_repeated_unless_the_delay_gives_way_afterwards() {
    for (verdict, has_lost, rtt, expected) in [
        (0, false, 190, Some(3)),
        (0, false, 189, None),
        (0, true, 240, None),
        (9000, false, 240, None),
    ] {
        let mut delay = start_trial([2000; 3]);
        while delay.trial_len > 0 {
            delay.has_lost = has_lost;
            end_round(&mut delay, 900, 240, verdict);
        }
        let next = (0..9).position(|_| {
            end_round(&mut delay, 400, rtt, 1);
            delay.trial_len > 0
        });
        assert_eq!(next, expected);
    }
    let mut delay = ForeignDelay::default();
    let trials = (0..40).filter(|&round| {
        let flight = if round < 2 { 800 } else { 400 };
        end_round(&mut delay, flight, 50, 2000).is_some()
    });
    assert!(trials.eq([11, 21, 31]));
}

#[test]
fn flights_that_suffer_loss_say_nothing_about_delays() {
    for (rounds, expected) in [
        ("88666666666", Some(5)),
        ("88x66666666", Some(7)),
        ("8866x666666", Some(7)),
        ("88xx6666666", Some(8)),
        ("88xxx666666", None),
        ("66x86666666", None),
        ("66x88666666", Some(8)),
    ] {
        let mut delay = ForeignDelay::default();
        let trial = rounds.bytes().position(|it| {
            delay.has_lost |= it == b'x';
            let flight = if it == b'6' { 600 } else { 800 };
            end_round(&mut delay, flight, 200, 0);
            delay.trial_len > 0
        });
        assert_eq!(trial, expected, "{rounds}");
    }

    let mut delay = ForeignDelay::default();
    for (count, has_lost, keeps_losing) in [
        (2, true, false),
        (1, false, false),
        (2, true, false),
        (999, true, true),
        (1, false, false),
    ] {
        for _ in 0..count {
            delay.has_lost |= has_lost;
            end_round(&mut delay, 600, 200, 0);
            assert_eq!(delay.keeps_losing(), keeps_losing);
        }
    }
}

#[test]
fn flights_that_the_path_did_not_limit_say_nothing_about_delays() {
    for (before, limited, expected) in [
        (0, 1, Some(4)),
        (2, 1, Some(2)),
        (3, 9, Some(1)),
        (0, 19, Some(4)),
        (0, 20, None),
        (0, 999, None),
    ] {
        let mut delay = ForeignDelay::default();
        for flight in [800; 2].into_iter().chain(vec![600; before]) {
            end_round(&mut delay, flight, 200, 0);
        }
        for _ in 0..limited {
            delay.on_acked(millis(200), 600);
            delay.on_limited();
            delay.end_round(millis(10), 0, true);
        }
        let trial = (0..9).position(|_| {
            end_round(&mut delay, 600, 200, 0);
            delay.trial_len > 0
        });
        assert_eq!(trial, expected, "{before} {limited}");
    }

    // The rest of such a round only tells how much is in flight.
    let mut delay = start_trial([2000; 3]);
    assert_eq!(end_round(&mut delay, 900, 240, 0), None);
    delay.on_limited();
    assert_eq!((delay.trial_len, delay.trial_rate()), (0, 0));
    let next = (0..9).position(|_| {
        assert_eq!(end_round(&mut delay, 400, 200, 9000), None);
        delay.trial_len > 0
    });
    assert_eq!(next, Some(4));
}

#[test]
fn foreign_delays_can_be_of_any_size() {
    for (former_rtt, rtt, flight, rounds) in [
        (micros(100), micros(100), 400, 4000),
        (micros(100), micros(100), 3_000_000_000, 4000),
        (Duration::ZERO, millis(100), 400, 4),
        (Duration::MAX, Duration::MAX, 1, 4),
    ] {
        let mut delay = ForeignDelay::default();
        for _ in 0..2 {
            delay.on_acked(former_rtt, u64::MAX);
            delay.end_round(micros(1), 0, true);
        }
        let mut end_round = |rtt| {
            delay.on_acked(rtt, flight);
            delay.end_round(micros(1), u64::MAX, true);
            delay.trial_len > 0
        };
        assert_eq!((1..).find(|_| end_round(rtt)), Some(rounds));
        assert!(!end_round(former_rtt));
    }
}

/// One round before the trial.
fn bbr_squeezed() -> Sender {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(60, 20, millis(10));
    sender.rounds_of(80, 12, millis(160));
    sender.rounds_of(40, 4, millis(160));
    sender
}

fn bbr_convinced() -> Sender {
    let mut sender = bbr_squeezed();
    assert_eq!(min_rtt(sender.rounds_of(40, 1, millis(160))), millis(10));
    assert_eq!(min_rtt(sender.rounds_of(60, 1, millis(160))), millis(80));
    sender
}

/// In segments per 160 ms, for each phase of the cycle.
fn is_bandwidth(sender: &Sender, segments: u64) -> bool {
    let pace = sender.pacing_rate() * 160 / 1000 * 4;
    [3, 4, 5].contains(&(pace / (segments * SEGMENT))) && pace.is_multiple_of(segments * SEGMENT)
}

#[test]
fn bbr_tries_a_larger_flight_if_delays_may_be_foreign() {
    let mut path = Path::new(Algorithm::Bbr, micros(100), millis(10), 200);
    path.saturate(millis(2000), |_| {});
    path.delay = millis(100);
    let windows = [1500, 250, 400].map(|it| {
        path.saturate(millis(it), |_| {});
        path.controller.window() / LEN
    });
    assert!(matches!(windows, [83, 126, 200..=300]), "{windows:?}");

    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(30, 20, millis(10));
    sender.rounds_of(80, 2, millis(32));
    assert!(is_bandwidth(sender.rounds_of(40, 13, millis(32)), 5 * 40));
    assert!(is_bandwidth(sender.rounds_of(40, 1, millis(32)), 5 * 60));

    // It leaves nothing behind if it is cut short.
    sender.run_dry().rounds_of(20, 2, millis(32));
    assert!(is_bandwidth(&sender, 5 * 40));

    // It may be out of proportion to the shortest round trip.
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(60, 20, millis(10));
    sender.rounds_of(4000, 12, millis(160));
    assert_eq!(sender.rounds_of(2000, 4, millis(160)).segments(), 2000);
    assert_eq!(sender.rounds_of(2000, 1, millis(160)).segments(), 3000);
}

#[test]
fn bbr_goes_by_the_verdict() {
    assert!(is_bandwidth(&bbr_convinced(), 80));

    let mut sender = bbr_squeezed();
    assert!(is_bandwidth(sender.rounds_of(40, 2, millis(160)), 80));
    assert!(is_bandwidth(sender.rounds_of(40, 1, millis(160)), 40));

    let mut sender = bbr_convinced();
    sender.rounds_of(60, 11, millis(160));
    assert_eq!(min_rtt(sender.rounds_of(40, 6, millis(160))), millis(80));
    assert_eq!(min_rtt(sender.rounds_of(40, 1, millis(160))), millis(10));
}

#[test]
fn bbr_only_tries_that_while_it_cycles() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(1, 1, millis(10));
    sender.rounds_of(80, 2, millis(160)).send(29);
    for _ in 0..6 {
        sender.send(30).wait(millis(160)).feedback(0, 30);
    }
    sender.send(90).wait(millis(160)).feedback(0, 90);
    assert_eq!(min_rtt(&sender), millis(10));

    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(60, 20, millis(10));
    sender.rounds_of(80, 56, millis(160));
    sender.rounds_of(40, 5, millis(160));
    sender.send(40).wait(millis(10)).feedback(0, 1);
    sender.send(40).wait(millis(300)).feedback(0, 39);
    assert_eq!(sender.segments(), 4);
    sender.wait(millis(10)).feedback(0, 1).feedback(0, 39);
    sender.rounds_of(4, 1, millis(10));
    sender.rounds_of(4, 2, millis(160));
    assert!(is_bandwidth(&sender, 80));

    // What was before is forgotten.
    sender.rounds_of(40, 6, millis(160));
    assert_eq!(min_rtt(sender.rounds_of(60, 2, millis(160))), millis(10));
}

fn lossy_rounds(sender: &mut Sender, count: u64) {
    for _ in 0..count {
        sender.send(40).wait(millis(160)).feedback(0, 20);
        sender.feedback(1, 0).feedback(0, 19);
    }
    sender.rounds_of(40, 1, millis(160));
}

#[test]
fn bbr_gives_up_the_room_for_foreign_delays() {
    let cases: [(fn(&mut Sender), u64); 6] = [
        (|it| _ = it.rounds_of(60, 30, millis(160)), 80),
        (|it| _ = it.rounds_of(60, 60, millis(160)), 160),
        (|it| _ = it.run_dry().rounds_of(5, 1, millis(160)), 80),
        (|it| _ = it.rounds_of(60, 1, millis(50)), 50),
        (|it| lossy_rounds(it, 2), 80),
        (|it| lossy_rounds(it, 3), 10),
    ];
    for (then, expected) in cases {
        let mut sender = bbr_convinced();
        then(&mut sender);
        assert_eq!(min_rtt(&sender), millis(expected));
    }
}

#[test]
fn bbr_keeps_the_room_for_foreign_delays_while_it_recovers() {
    let mut sender = bbr_convinced();
    sender.rounds_of(60, 3, millis(160)).send(2);
    assert_eq!(sender.wait(millis(160)).feedback(1, 1).segments(), 120);
}

#[test]
fn bbr_does_not_take_what_it_has_made_room_for_for_a_queue() {
    for (rtt, expected) in [(37_500, 59), (37_501, 49)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(5, 1, millis(10)).run_dry();
        sender.rounds_of(20, 1, millis(30)).send(50);
        sender.wait(micros(rtt)).feedback(1, 9).feedback(0, 10);
        assert_eq!(sender.segments(), expected);
    }
}

#[test]
fn bbr_does_not_take_what_the_application_or_the_peer_does_for_a_foreign_delay() {
    let mut sender = bbr_squeezed();
    sender.run_dry().rounds_of(40, 2, millis(160));
    assert_eq!(min_rtt(sender.rounds_of(60, 1, millis(160))), millis(10));

    let mut sender = bbr_squeezed();
    sender.rounds_of(40, 1, millis(160)).run_dry();
    assert_eq!(min_rtt(sender.rounds_of(60, 3, millis(160))), millis(10));

    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(60, 20, millis(10));
    sender.rounds_of(80, 2, millis(160));
    for _ in 0..5 {
        sender.send(40).wait(millis(160)).feedback(0, 39);
        ack_oldest_with_delay(&mut sender, millis(80));
    }
    assert_eq!(min_rtt(sender.rounds_of(60, 2, millis(160))), millis(10));
}

#[test]
fn bbr_carries_its_suspicion_over_a_pause() {
    for (rounds, expected) in [(3, 10), (4, 80)] {
        let mut sender = bbr_squeezed();
        sender.run_dry().rounds_of(40, rounds, millis(160));
        sender.rounds_of(60, 1, millis(160));
        assert_eq!(min_rtt(&sender), millis(expected));
    }
}

#[test]
fn bbr_follows_a_route_that_gets_longer() {
    let mut path = Path::new(Algorithm::Bbr, micros(200), millis(5), 200);
    path.saturate(millis(2000), |_| {});
    path.delay = millis(50);
    path.saturate(millis(3000), |_| {});
    assert_within(path.saturate(millis(3000), |_| {}), 55..=101);
}

#[test]
fn bbr_follows_a_route_that_gets_longer_and_slower() {
    let mut path = Path::new(Algorithm::Bbr, micros(100), millis(2), 3000);
    path.saturate(millis(2000), |_| {});
    (path.time_per_packet, path.delay) = (millis(1), millis(40));
    path.saturate(millis(3000), |path| assert!(path.rtt.latest < millis(120)));
    assert_within(path.saturate(millis(3000), |_| {}), 90..=101);
}

#[test]
fn bbr_does_not_take_its_own_queue_for_that_of_others() {
    for slowdown in [2, 5, 10, 50] {
        let mut path = Path::fast(Algorithm::Bbr, 2000);
        path.saturate(millis(2000), |_| {});
        path.time_per_packet = path.time_per_packet * slowdown;
        path.saturate(millis(7000), |path| {
            assert!(matches!(&path.controller.model, Model::Bbr(it) if it.min_rtt(&path.rtt) < millis(21)));
        });
    }
}

#[test]
fn bbr_does_not_fill_the_queue_of_a_path_that_keeps_getting_slower() {
    for (steps, ack_period) in [(20, 1), (60, 1), (120, 1), (60, 10_000), (120, 10_000)] {
        let mut path = Path::fast(Algorithm::Bbr, 2000);
        path.ack_period = ack_period;
        path.saturate(millis(2000), |_| {});
        for step in 1..=steps {
            path.time_per_packet = micros((100.0 * 10f64.powf(step as f64 / steps as f64)) as u64);
            path.saturate(millis(50), |_| {});
        }
        path.saturate(millis(7500 - 50 * steps), |_| {});
        assert!(path.rtt.smoothed < millis(60));
    }
}

#[test]
fn bbr_flows_that_squeeze_one_another_get_rid_of_their_queue() {
    for (count, gap, response, seconds) in [
        (3, 1100, u64::MAX / 2, 45),
        (4, 3000, u64::MAX / 2, 45),
        (5, 2000, u64::MAX / 2, 45),
        (3, 1100, 800, 60),
        (5, 1100, 800, 60),
        (4, 2000, 2000, 60),
        (5, 2000, 300, 60),
    ] {
        let mut paths = Vec::from_iter((0..count).map(|it| Path {
            controller: Controller::new(Algorithm::Bbr, LEN as u16, (it as u32) << 28),
            now: START + millis(it * gap),
            ..Path::new(Algorithm::Bbr, micros(400), millis(10), 5000)
        }));
        let (mut free_at, mut rtts) = (START, Vec::new());
        while let Some(path) = paths.iter_mut().min_by_key(|it| it.now)
            && path.now < START + millis(seconds * 1000)
        {
            if path.unsent == 0 && path.pending.is_empty() {
                (path.unsent, path.now) = (response, path.now + millis(2));
                continue;
            }
            path.free_at = free_at;
            path.step();
            free_at = path.free_at;
            if path.now > START + millis((seconds - 5) * 1000) {
                rtts.push(path.rtt.latest.as_millis());
            }
        }
        assert_within(rtts.iter().sum::<u64>() / rtts.len() as u64, 10..=50);
    }
}

#[test]
fn bbr_makes_no_room_without_a_sample() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(5, 1, millis(10)).run_dry().send(20);
    sender
        .wait(millis(50))
        .rtt
        .update(millis(30), Duration::ZERO);
    (sender.flights.iter().take(1)).for_each(|it| sender.controller.on_acked(it));
    sender.controller.end_ack(sender.now, &sender.rtt);
    assert_eq!(min_rtt(&sender), millis(10));
}

#[test]
fn bbr_does_not_take_the_delay_of_acknowledgments_for_a_queue() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(5, 1, millis(10)).run_dry().send(20);
    ack_oldest_with_delay(sender.wait(millis(30)), millis(15));
    assert_eq!(min_rtt(&sender), millis(15));

    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(40, 1, millis(10));
    while sender.window() > 4 * SEGMENT {
        sender.rounds_of(40, 1, millis(50));
    }
    ack_oldest_with_delay(sender.send(2).wait(millis(45)), millis(25));
    assert_eq!(min_rtt(&sender), millis(20));
    // This frame makes for no new sample.
    sender.rtt.update(millis(40), millis(25));
    (sender.flights.iter()).for_each(|it| sender.controller.on_acked(it));
    sender.controller.end_ack(sender.now, &sender.rtt);
    assert_eq!(min_rtt(&sender), millis(20));

    sender.flights.clear();
    while sender.window() <= 4 * SEGMENT {
        sender.rounds_of(2, 1, millis(50));
    }
    ack_oldest_with_delay(sender.send(2).wait(millis(30)), millis(15));
    assert_eq!(min_rtt(&sender), millis(20));
}

#[test]
fn bbr_probes_more_often_while_the_bandwidth_grows() {
    let mut path = Path::new(Algorithm::Bbr, micros(500), millis(80), 4000);
    path.saturate(millis(3000), |_| {});
    path.time_per_packet = micros(100);
    assert_within(path.saturate(millis(4000), |_| {}), 68..=80);
}

#[test]
fn bbr_measures_the_round_trip_time_after_pauses() {
    for pause in [millis(10), millis(3000), millis(20_000)] {
        let mut path = Path::slow(Algorithm::Bbr, 200);
        for _ in 0..30 {
            path.transfer(500, |path| {
                assert!(path.controller.window() >= INITIAL_WINDOW);
            });
            path.now = path.now + pause;
        }
    }
}

#[test]
fn bbr_takes_what_it_measures_after_a_pause_early_unless_that_is_much_longer() {
    for (age, rtt, expected) in [
        (5000, 12_500, 10_000),
        (5001, 12_500, 12_500),
        (5001, 12_501, 10_000),
        (10_000, 12_501, 10_000),
        (10_001, 12_501, 12_501),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(40, 1, millis(10)).run_dry();
        sender.wait(millis(age) - micros(rtt));
        assert_eq!(
            min_rtt(sender.rounds_of(40, 1, micros(rtt))),
            micros(expected)
        );
        assert!(sender.segments() > 4);
    }
}

#[test]
fn bbr_does_not_get_used_to_longer_round_trips_pause_by_pause() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(40, 1, millis(10));
    for (rtt, expected) in [(12, 12), (13, 12)] {
        sender.run_dry().wait(millis(5000));
        assert_eq!(
            min_rtt(sender.rounds_of(40, 1, millis(rtt))),
            millis(expected)
        );
    }
}

#[test]
fn bbr_probes_the_round_trip_time_after_a_short_pause_if_there_is_a_queue() {
    for (rounds, pause, rtt, ack_delay, late, probes) in [
        (198, 199_999, 21_001, 0, 0, true),
        (198, 200_000, 21_001, 0, 0, false),
        (198, 199_999, 21_000, 0, 0, false),
        (198, 199_999, 30_001, 9, 0, true),
        (198, 199_999, 30_000, 9, 0, false),
        (198, 199_999, 30_001, 0, 9, true),
        (198, 199_999, 30_000, 0, 9, false),
        (402, 199_999, 50_000, 0, 0, true),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(40, 1, millis(10));
        sender.rounds_of(40, rounds, millis(50)).run_dry();
        sender.wait(micros(pause)).send(1);
        let pacer = &mut sender.controller.pacer;
        *pacer = pacer_at(1000, millis(1));
        let now = sender.now + pace(pacer, sender.now).1 + millis(late);
        pacer.catch_up_however_late();
        pace_late(pacer, now, 0..1);
        ack_oldest_with_delay(sender.wait(micros(rtt)), millis(ack_delay));
        assert_eq!(sender.segments() == 4, probes);
    }
}

#[test]
fn bbr_measures_the_bandwidth_anew_after_probing_the_round_trip_time_for_a_queue() {
    for (rtt, is_kept) in [(20, true), (22, false)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, 1, millis(10));
        while sender.segments() > 4 {
            sender.rounds_of(6 * rtt, 1, millis(rtt));
        }
        while sender.segments() == 4 {
            sender.rounds_of(4, 1, millis(10));
        }
        sender.rounds_of(30, 2, millis(10));
        assert_eq!(is_bandwidth(&sender, 6 * 160), is_kept);
    }
}

#[test]
fn bbr_gives_up_the_bandwidth_in_spite_of_pauses_if_there_is_a_queue() {
    for (rtt, responses, is_kept) in [(21_000, 20, true), (21_001, 6, true), (21_001, 7, false)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(1, 1, millis(10));
        sender.rounds_of(80, 8, millis(20));
        for _ in 0..responses {
            sender.run_dry().rounds_of(10, 2, micros(rtt));
        }
        assert_eq!(is_bandwidth(&sender, 8 * 80), is_kept);
    }
}

#[test]
fn bbr_follows_the_bandwidth_response_by_response() {
    let mut path = Path::fast(Algorithm::Bbr, 5000);
    for (slowdown, count) in [(1, 20), (10, 8)] {
        path.time_per_packet = path.time_per_packet * slowdown;
        for _ in 0..count {
            path.transfer(900, |_| {});
        }
    }
    assert_within(path.pace(), 70..=130);
}

#[test]
fn bbr_does_not_take_being_late_for_a_queue() {
    let mut path = Path::new(Algorithm::Bbr, micros(100), millis(10), 20);
    path.busy = (20_000, 23_000);
    let times = Vec::from_iter((0..60).map(|_| path.transfer(350, |_| {}).as_millis()));
    assert!(times.iter().skip(30).all(|&it| it < 400), "{times:?}");
}

#[test]
fn bbr_puts_up_with_random_loss() {
    let mut path = Path::fast(Algorithm::Bbr, 200);
    path.drops = 20;
    path.saturate(millis(1000), |_| {});
    assert_within(path.saturate(millis(3000), |_| {}), 94..=100);
}

#[test]
fn bbr_follows_the_bandwidth() {
    let mut path = Path::slow(Algorithm::Bbr, 40);
    path.saturate(millis(2000), |_| {});
    for time_per_packet in [millis(4), millis(1)] {
        path.time_per_packet = time_per_packet;
        path.saturate(millis(3500), |_| {});
        path.saturate(millis(500), |path| assert_within(path.pace(), 70..=130));
    }
}

#[test]
fn bbr_conserves_packets_for_a_round() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.fill().wait(millis(7)).feedback(0, 10).send(10);
    assert_eq!(sender.wait(millis(3)).feedback(1, 5).segments(), 31);
    assert_eq!(sender.feedback(1, 0).segments(), 30);
    assert_eq!(sender.send(5).feedback(0, 15).segments(), 30);
    assert_eq!(sender.send(15).feedback(0, 10).segments(), 30);
    assert_eq!(sender.send(12).feedback(1, 0).segments(), 31);
    sender.wait(millis(10));
    assert_eq!(sender.feedback(1, 3).segments(), 33);
    assert_eq!(sender.feedback(0, usize::MAX).segments(), 60);
    sender.send(1).wait(millis(10));
    assert_eq!(sender.feedback(0, 1).segments(), 62);
}

#[test]
fn bbr_does_not_conserve_packets_in_startup_unless_there_is_a_queue() {
    for (delay, expected) in [(2500, 36), (2501, 31)] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.fill().wait(millis(10)).feedback(0, 10).send(10);
        sender.wait(micros(delay)).feedback(1, 5);
        assert_eq!(sender.feedback(0, 5).segments(), expected);
    }
}

#[test]
fn bbr_does_not_care_how_acknowledgments_are_split() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.fill().wait(millis(10)).feedback(0, 10);
    assert_eq!(sender.feedback(0, 10).feedback(2, 1).segments(), 30);
}

#[test]
fn bbr_recovers_at_once_if_all_that_was_lost_arrives() {
    for last in [SEGMENT, SEGMENT + 1] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.fill().wait(millis(10)).feedback(2, 1).feedback(1, 1);
        for (len, is_recovering) in [(SEGMENT, true), (SEGMENT, true), (last, false)] {
            sender.controller.on_late(len);
            assert_eq!(sender.controller.is_recovering(), is_recovering);
        }
    }
}

#[test]
fn bbr_counts_what_arrives_late_as_delivered() {
    let [in_time, late] = [0, 16].map(|late| {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds(1, millis(10)).fill().wait(millis(10));
        sender.feedback(late, 0);
        sender.controller.on_late(late as u64 * SEGMENT);
        sender.feedback(0, usize::MAX).pacing_rate()
    });
    assert_eq!(in_time, late);
}

#[test]
fn bbr_does_not_end_startup_for_an_outage() {
    let mut sender = Sender::new(Algorithm::Bbr);
    let startup_rate = sender.rounds(3, millis(10)).pacing_rate();
    sender.rounds_of(128, 1, millis(10)).send(128);
    sender.controller.on_persistent_congestion();
    sender.wait(millis(20)).feedback(120, 1);
    for _ in 0..2 {
        sender.fill().wait(millis(10)).feedback(0, 4);
    }
    assert_eq!(sender.pacing_rate(), startup_rate);
}

#[test]
fn bbr_allows_for_a_retransmission() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.fill().wait(millis(10)).feedback(1, 0);
    assert_ne!(
        sender.controller.permit(sender.now, 0, || true),
        Permit::Blocked
    );
}

#[test]
fn bbr_learns_from_short_transfers_that_overflow_the_buffer() {
    let mut path = Path::fast(Algorithm::Bbr, 100);
    let mut transfer = || {
        let lost = path.lost;
        let duration = path.transfer(400, |_| {});
        path.now = path.now + millis(100);
        (path.lost - lost, duration.as_millis())
    };
    let early = (0..8).map(|_| transfer().0).sum();
    assert_within(early, 200..=1000);
    for _ in 0..30 {
        transfer();
    }
    let (lost, duration) = transfer();
    assert_eq!(lost, 0);
    assert_within(duration, 60..=63);
}

#[test]
fn bbr_learns_from_recovery_unless_the_application_ran_dry() {
    for runs_dry in [true, false] {
        let mut sender = Sender::new(Algorithm::Bbr);
        let startup_rate = sender.rounds(3, millis(10)).run_dry().pacing_rate();
        for _ in 0..10 {
            sender.send(3);
            if runs_dry {
                sender.run_dry();
            }
            sender.wait(millis(10)).feedback(1, 1);
            sender.fill().feedback(0, 1);
            sender.wait(millis(10)).feedback(0, 3);
        }
        assert_eq!(sender.pacing_rate() == startup_rate, runs_dry);
    }
}
