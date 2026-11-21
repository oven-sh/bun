use std::collections::{BTreeSet, VecDeque};
use std::ops::RangeInclusive;

use super::bandwidth_sampler::BandwidthSampler;
use super::pacer::MAX_OVERFLOWS;
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
fn pacer_allows_a_burst_after_a_pause() {
    let mut pacer = pacer_at(1000, millis(5));
    pacer.on_idle_restart(START, false);
    assert_eq!(pace(&mut pacer, START), (11, millis(5)));
    pacer.on_idle_restart(START, true);
    assert_eq!(pace(&mut pacer, START), (1, millis(5)));
    pacer.on_idle_restart(START, false);
    pacer.on_loss();
    assert_eq!(pace(&mut pacer, START), (1, millis(5)));
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
    pacer.on_loss();
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
            (0..overflows).for_each(|_| pacer.on_overflow());
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
        (0..5).for_each(|_| pacer.on_overflow());
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
        (0..5).for_each(|_| pacer.on_overflow());
        (0..lost).for_each(|_| pacer.on_start_settled(true));
        let (_, delay) = pace(&mut pacer, START);
        let result = pacer.delay(START + delay - micros(early));
        assert_eq!(result.is_none(), is_permitted, "{lost} {early}");
    }
}

#[test]
fn pacer_forgets_overflows_one_by_one() {
    let mut pacer = pacer_at(1024, micros(16));
    (0..2).for_each(|_| pacer.on_overflow());
    for (packets, max_turn) in [(4096, 4), (1, 8), (8192, 8), (1, usize::MAX)] {
        (0..packets).for_each(|_| _ = pacer.on_sent(START, 1024));
        assert_eq!(pacer.max_turn(), max_turn);
    }
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
                    self.pacer.on_overflow();
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
            (0..5).for_each(|_| sender.controller.pacer.on_overflow());
        }
        assert_eq!(sender.controller.max_turn(), max_turn);
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
fn bbr_forgets_rounds_without_growth_that_are_long_ago() {
    for (before, limited, lost, rtt, is_over) in [
        (3, 7, 1, 12_500, true),
        (3, 8, 1, 12_500, false),
        (3, 11, 1, 12_501, true),
        (3, 12, 1, 12_501, false),
        (2, 20, 5, 12_501, false),
        (2, 20, 6, 12_501, true),
    ] {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.rounds_of(60, before, millis(10));
        for round in 0..limited {
            let (lost, rtt) = if round == 2 { (lost, rtt) } else { (0, 10_000) };
            sender.run_dry().send(60).wait(micros(rtt));
            sender.feedback(0, 30).feedback(lost, usize::MAX);
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
            assert_eq!(sender.pacing_rate() < startup_rate, is_high && round == 4);
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
fn bbr_enters_the_cycle_at_random() {
    let rounds_until_probe = (0..64).map(|random| {
        let mut sender = Sender::new(Algorithm::Bbr);
        sender.controller = Controller::new(Algorithm::Bbr, 1200, random * 1000);
        sender.rounds_of(1, 1, millis(10));
        sender.rounds_of(66, 3, millis(11));
        (0..).position(|_| gain(sender.rounds_of(66, 1, millis(11))) == 125)
    });
    let expected = (0..7).map(Some).collect::<BTreeSet<_>>();
    assert_eq!(rounds_until_probe.collect::<BTreeSet<_>>(), expected);
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
