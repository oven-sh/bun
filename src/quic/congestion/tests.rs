use std::collections::{BTreeSet, VecDeque};
use std::ops::RangeInclusive;

use super::bandwidth_sampler::BandwidthSampler;
use super::ceiling::Ceiling;
use super::crowd::Crowd;
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
        while self.controller.permit(self.now, 0) != Permit::Blocked {
            self.send(1);
        }
        self
    }

    /// Returns how many packets are permitted right now.
    fn burst(&mut self) -> u64 {
        let before = self.controller.in_flight();
        while self.controller.permit(self.now, 0) == Permit::Now {
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
            match (self.controller).permit(self.now, self.unsent.saturating_mul(LEN)) {
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
            pacer.on_application_limited();
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
fn small_writes_go_on_waiting_if_the_queue_has_come_back_before() {
    let (mut crowd, mut now) = (watching_crowd(), START);
    for len in [1, 16, 64] {
        assert!(!crowd.wait(now, &steady(millis(30)), || false).is_zero());
        assert_eq!(trial_len(&mut crowd, &mut now, 16), len);
    }
}

#[test]
fn small_writes_in_a_series_wait_after_a_loss() {
    for (packets, elapsed, continues_series, waits) in [
        (12, 32 * 16 - 1, true, true),
        (12, 32 * 16, true, false),
        (12, 0, false, false),
        (11, 0, true, false),
    ] {
        let (mut crowd, rtt) = (watching_crowd(), steady(millis(16)));
        (0..packets).for_each(|_| crowd.on_sent());
        crowd.on_loss(START, 0, &rtt);
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
    pacer.on_feedback(true);
    assert_eq!(pace(&mut pacer, START), (1, millis(5)));
    pacer.on_overflow(true, 0);
    for (lost_starts, burst) in [(0, 6), (15, 6), (1, 11)] {
        (0..lost_starts).for_each(|_| pacer.on_start_settled(true));
        pacer.on_idle_restart(START, false);
        assert_eq!(pace(&mut pacer, START), (burst, millis(5)));
    }
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
        pacer.on_application_limited();
        if !has_run_dry {
            pacer.on_sent(START - millis(9), 1);
        }
        pacer.on_idle_restart(START, is_recovering);
        pace(&mut pacer, START);
        if is_heard_of {
            pacer.on_feedback(false);
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
    for (late, is_limited_otherwise, expected) in [
        (0, false, 1),
        (20, false, 5),
        (50, false, 11),
        (51, false, 1),
        (20, true, 1),
    ] {
        let mut pacer = pacer_at(1000, millis(5));
        let (_, delay) = pace(&mut pacer, START);
        if is_limited_otherwise {
            pacer.on_limited_otherwise();
        }
        let (count, _) = pace(&mut pacer, START + delay + millis(late));
        assert_eq!(count, expected, "{late}");
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
    pacer.on_feedback(true);
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
fn judge(trial: &mut Trial, now: &mut Instant, acked: u64, lost: u64, starts_cycle: bool) -> u32 {
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
        assert_eq!(sender.controller.permit(START, 0), Permit::At(next));
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
    for algorithm in ALGORITHMS {
        let mut sender = Sender::new(algorithm);
        sender.rtt.update(millis(100), Duration::ZERO);
        assert_eq!(sender.burst(), 11);
        assert_within(sender.wait(millis(8)).burst(), 5..=8);
        assert_eq!(sender.run_dry().wait(millis(8)).burst(), 1);
        while sender.wait(millis(2)).burst() > 0 {}
        sender.wait(millis(80)).feedback(0, 20);
        assert_within(sender.burst(), 1..=3);
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
            sender.controller.permit(sender.now, unsent);
            let before = sender.wait(micros(later)).flights.len();
            while sender.controller.permit(sender.now, unsent) == Permit::Now {
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
            match controller.permit(now, 0) {
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
        assert_within(path.controller.window(), 82 * LEN..=85 * LEN);
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
    assert_eq!(sender.wait(millis(1)).segments(), 2 * 60 + 66);
    for _ in 0..11 {
        sender.send(66).wait(millis(10)).feedback(0, 33);
        sender.wait(millis(1)).feedback(0, 33);
    }
    assert_eq!(sender.segments(), 2 * 60 + 66 - 6);
}

#[test]
fn bbr_keeps_large_windows_in_proportion_to_the_path() {
    for (segments, expected) in [(500, 1000), (1200, 2000), (3000, 4500)] {
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
        (31, true, true, 0, 15),
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
}

#[test]
fn bbr_keeps_what_the_first_long_flight_finds_for_as_long_as_any_sample() {
    let mut sender = Sender::new(Algorithm::Bbr);
    sender.rounds_of(5, 1, millis(10)).run_dry();
    sender.wait(millis(4000)).rounds(300, millis(30));
    assert_eq!(min_rtt(&sender), millis(15));
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
    assert_eq!(min_rtt(&sender), millis(10));

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
    assert_ne!(sender.controller.permit(sender.now, 0), Permit::Blocked);
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
