//! Until they leave the host, datagrams that are sent in a run are taken or dropped as a whole. A queue that has no
//! room for a long run may have it for the same datagrams in short ones.

use core::ops::Range;

use super::sent::SentPacket;
use crate::batch::Position;
use crate::packet::MIN_DATAGRAM_LEN;

const MIN_PATIENCE: u64 = 512;
const MAX_PATIENCE: u64 = 64 * 1024;
/// It comes to this if longer runs have failed twice. The queue is short, and has to hold more than one run.
const WARY: u64 = 16 * MIN_PATIENCE;
/// For how many packets a run that has arrived shows that its length is not the problem.
const MEMORY: u64 = 1024;
/// After how many packets to give up on a trial that nothing is heard of, or that there is no occasion for.
const OVERDUE: u64 = 8192;
/// With that much to follow, it does not take a timeout to notice that a run is lost.
const FOLLOWING: u64 = 4096;
/// Up to this packet number, a round trip more or less makes a difference.
const EARLY: u64 = 256;

/// Lengths are in bytes.
pub(super) struct Runs {
    max_len: u16,
    /// The packet number from which on one run can be twice as long.
    longer_from: u64,
    /// The number of the first packet that makes it longer.
    trial: u64,
    trial_len: u16,
    /// After how many runs the next trial is due. It is at once until a run was too long.
    patience: u64,
    has_grown: bool,
    has_failed: bool,
    /// The number of the packet that ended the last run that was too long.
    failure: u64,
    patience_before_failure: u64,
    longest_arrived: u16,
    /// The last packet number that it counts for.
    remembered_until: u64,
    /// The sequence numbers of the last packets that were lost in a row.
    first_lost: u64,
    last_lost: u64,
}

/// Up to and including this packet. A single one does not count.
#[inline]
fn len_so_far(packet: &SentPacket) -> u16 {
    match packet.position {
        Position { index: 0, .. } => 0,
        Position { offset, .. } => offset.saturating_add(packet.flight.len),
    }
}

impl Default for Runs {
    fn default() -> Self {
        Self {
            max_len: 0,
            longer_from: 0,
            trial: u64::MAX,
            trial_len: 0,
            patience: MIN_PATIENCE,
            has_grown: false,
            has_failed: false,
            failure: u64::MAX,
            patience_before_failure: MIN_PATIENCE,
            longest_arrived: 0,
            remembered_until: 0,
            first_lost: 1,
            last_lost: 0,
        }
    }
}

impl Runs {
    /// `room` is what the congestion window has left.
    #[inline]
    pub(super) fn max_len(
        &self,
        next_number: u64,
        unsent: u64,
        room: u64,
        datagram_len: u16,
    ) -> usize {
        let is_affordable = match next_number < EARLY {
            // What gets lost can go with the next flight.
            true => unsent >= room + FOLLOWING + 8 * u64::from(self.max_len),
            false => unsent >= FOLLOWING || !self.has_failed,
        };
        match next_number >= self.longer_from && is_affordable {
            true => {
                let part = u16::from(self.has_failed) * (self.max_len % datagram_len);
                2 * usize::from((self.max_len - part).max(datagram_len))
            }
            false => self.max_len.into(),
        }
    }

    /// For a packet that goes on its own for other reasons.
    #[inline]
    pub(super) fn suspend(&mut self, next_number: u64) {
        self.remembered_until = next_number + MEMORY;
        self.longer_from = self.longer_from.max(next_number);
    }

    #[inline]
    pub(super) fn on_sent(&mut self, packet: &SentPacket) {
        let len = len_so_far(packet);
        if len > self.max_len {
            (self.trial, self.trial_len) = (self.trial.min(packet.number), len);
        } else if self.trial != u64::MAX {
            self.longer_from = u64::MAX;
        }
    }

    #[inline]
    fn is_trial(&self, packet: &SentPacket) -> bool {
        packet.number >= self.trial && len_so_far(packet) > self.max_len
    }

    #[inline]
    pub(super) fn on_acked(&mut self, packet: &SentPacket, next_number: u64) {
        if self.is_trial(packet) {
            if core::mem::replace(&mut self.has_grown, true) {
                self.patience = MIN_PATIENCE.max(self.patience / 2);
            }
            self.set_max_len(self.trial_len, next_number);
        } else if packet.number.saturating_sub(self.trial) > OVERDUE {
            self.call_off_trial(next_number);
        } else if packet.number.saturating_sub(self.longer_from) > OVERDUE {
            (self.has_failed, self.patience) = (false, MIN_PATIENCE);
        }
        let len = len_so_far(packet);
        if len >= self.longest_arrived || packet.number > self.remembered_until {
            (self.longest_arrived, self.remembered_until) = (len, packet.number + MEMORY);
        }
    }

    /// A long queue that is full has no room for runs of any length.
    pub(super) fn on_lost(
        &mut self,
        packet: &SentPacket,
        ends_run: bool,
        is_queue_short: bool,
        next_number: u64,
    ) {
        let (sequence, index) = (packet.flight.sequence, packet.position.index);
        if sequence != self.last_lost + 1 {
            self.first_lost = sequence;
        }
        self.last_lost = sequence;
        let len = len_so_far(packet);
        let is_whole = ends_run && index > 0 && self.first_lost + u64::from(index) == sequence;
        let may_fit = len <= self.longest_arrived && self.patience < WARY;
        let ends_trial = ends_run && self.is_trial(packet);
        if is_whole && !may_fit {
            (self.failure, self.patience_before_failure) = (packet.number, self.patience);
            let has_grown = core::mem::take(&mut self.has_grown);
            if core::mem::replace(&mut self.has_failed, true) && (ends_trial || has_grown) {
                let max = match is_queue_short {
                    true => MAX_PATIENCE,
                    false => self.patience.max(WARY / 2),
                };
                self.patience = max.min(self.patience * 4);
            }
            let len = match ends_trial {
                true => self.max_len,
                false => self.max_len.min(len / 2),
            };
            self.set_max_len(len, next_number);
        } else if ends_trial {
            self.call_off_trial(next_number);
        }
    }

    /// For when some of what is `acked` has arrived after all.
    pub(super) fn on_late(&mut self, mut acked: impl Iterator<Item = Range<u64>>) {
        if acked.any(|it| it.contains(&self.failure)) {
            let failure = core::mem::replace(&mut self.failure, u64::MAX);
            self.has_failed = self.patience_before_failure >= WARY;
            self.patience = match self.has_failed {
                true => self.patience_before_failure,
                false => MIN_PATIENCE.max(self.patience / 4),
            };
            self.call_off_trial(failure);
        }
    }

    pub(super) fn on_all_lost(&mut self, next_number: u64) {
        if self.trial != u64::MAX {
            self.call_off_trial(next_number);
        }
    }

    fn call_off_trial(&mut self, longer_from: u64) {
        (self.trial, self.longer_from) = (u64::MAX, longer_from);
    }

    fn set_max_len(&mut self, len: u16, next_number: u64) {
        let packets = (usize::from(len) / MIN_DATAGRAM_LEN).max(1);
        self.max_len = len;
        self.trial = u64::MAX;
        self.longer_from =
            next_number + u64::from(self.has_failed) * self.patience * packets as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::super::sent::{Control, Fate};
    use super::*;
    use crate::congestion::Flight;

    const LEN: u16 = 1200;

    struct Sender {
        runs: Runs,
        sent: u64,
        is_queue_long: bool,
    }

    impl Default for Sender {
        fn default() -> Self {
            Self::starting_with(48)
        }
    }

    impl Sender {
        fn starting_with(datagrams: u16) -> Self {
            Self {
                runs: Runs {
                    max_len: datagrams * LEN,
                    ..Runs::default()
                },
                sent: 0,
                is_queue_long: false,
            }
        }

        /// `x` and `y` get lost, `y` and `,` are shorter, and nothing is heard of `?`.
        fn send(&mut self, runs: &str) -> usize {
            let mut packets = Vec::new();
            for run in runs.split_ascii_whitespace() {
                let mut offset = 0;
                for (index, fate) in (0..).zip(run.bytes()) {
                    self.sent += 1;
                    let mut packet = SentPacket {
                        number: self.sent,
                        flight: Flight::default(),
                        first_frame: 0,
                        frame_count: 0,
                        control: Control::empty(),
                        fate: Fate::Unknown,
                        settled: 0,
                        position: Position { index, offset },
                    };
                    packet.flight.sequence = self.sent;
                    packet.flight.len = match fate {
                        b'y' | b',' => LEN / 2,
                        _ => LEN,
                    };
                    offset += packet.flight.len;
                    self.runs.on_sent(&packet);
                    packets.push((packet, fate, usize::from(index) + 1 == run.len()));
                }
            }
            for (packet, fate, ends_run) in packets {
                match fate {
                    b'x' | b'y' => {
                        (self.runs).on_lost(&packet, ends_run, !self.is_queue_long, self.sent)
                    }
                    b'?' => {}
                    _ => self.runs.on_acked(&packet, self.sent),
                }
            }
            (self.runs.max_len(self.sent, u64::MAX, 0, LEN) / usize::from(LEN)).clamp(1, 48)
        }

        /// The packet that so many have followed.
        fn arrive_late(&mut self, distance: u64) {
            let number = self.sent - distance;
            self.runs.on_late(core::iter::once(number..number + 1));
        }

        /// Returns how many packets it takes.
        fn send_until_runs_grow(&mut self) -> usize {
            let before = usize::from(self.runs.max_len / LEN).max(1);
            1 + (0..).take_while(|_| self.send(".") == before).count()
        }
    }

    #[test]
    fn get_shorter_if_they_are_lost_as_a_whole() {
        for (runs, max) in [
            ("x", 48),
            ("xx", 1),
            ("xxx", 1),
            ("xxx.", 48),
            (".xxx", 48),
            ("xx.x", 48),
            ("xxxxxx xx", 3),
            ("xxxxxx . xx", 1),
            ("xxxx . xxxxxxxx", 2),
            ("xxxx ...", 2),
            (".x xxxx", 48),
            ("... xxxx", 2),
            (".... xxxx", 48),
            (".... .. xxxx", 48),
            (". yy", 1),
            ("..., xxxx", 2),
            ("..., xxxy", 48),
        ] {
            assert_eq!(Sender::default().send(runs), max, "{runs}");
        }
    }

    #[test]
    fn what_has_arrived_is_forgotten() {
        for (count, max) in [(1024, 48), (1025, 2)] {
            let mut sender = Sender::default();
            sender.send(".... ....");
            sender.send(&". ".repeat(count));
            assert_eq!(sender.send("xxxx"), max);
        }
    }

    #[test]
    fn what_has_arrived_is_not_forgotten_while_there_are_none() {
        for (count, max) in [(1024, 48), (1025, 2)] {
            let mut sender = Sender::default();
            sender.send(".... ....");
            sender.runs.suspend(2008);
            sender.send(&". ".repeat(2000 + count));
            assert_eq!(sender.send("xxxx"), max);
        }
    }

    #[test]
    fn get_longer_again_unless_that_keeps_failing() {
        let mut sender = Sender::default();
        assert_eq!(sender.send("xxxxxxxx"), 4);
        for patience in [512, 2048, 8192, 32768, 65536, 65536] {
            assert_eq!(sender.send_until_runs_grow(), 4 * patience);
            assert_eq!(sender.send("xxxxxxxx"), 4);
        }
        let mut sender = Sender::default();
        sender.send("xxxxxx");
        sender.send_until_runs_grow();
        sender.send("......");
        sender.send(&". ".repeat(1025));
        sender.send("xxxxxx");
        for (len, patience) in [(3, 2048), (6, 2048), (12, 1024), (24, 512)] {
            assert_eq!(usize::from(sender.runs.max_len / LEN), len);
            assert_eq!(sender.send_until_runs_grow(), len * patience);
            sender.send(&".".repeat(2 * len));
        }
        assert_eq!(sender.runs.max_len, 48 * LEN);
    }

    #[test]
    fn long_queue_does_not_make_wary() {
        let mut sender = Sender {
            is_queue_long: true,
            ..Sender::default()
        };
        for patience in [512, 2048, 4096, 4096] {
            assert_eq!(sender.send("xxxxxxxx"), 4);
            assert_eq!(sender.send_until_runs_grow(), 4 * patience);
        }
        sender.is_queue_long = false;
        for patience in [16_384, 16_384] {
            assert_eq!(sender.send("xxxxxxxx"), 4);
            assert_eq!(sender.send_until_runs_grow(), 4 * patience);
            sender.is_queue_long = true;
        }
    }

    #[test]
    fn were_not_too_long_if_they_arrive_after_all() {
        for (late, max) in [(2, 2), (3, 1)] {
            let mut sender = Sender::starting_with(1);
            assert_eq!(sender.send("xx ."), 1);
            sender.runs.on_late([9..10, late..late + 1].into_iter());
            assert_eq!(sender.send(""), max);
            assert_eq!(sender.runs.patience, 512);
        }
        let mut sender = Sender::starting_with(1);
        for patience in [512, 2048] {
            sender.send("xx");
            assert_eq!(sender.send_until_runs_grow(), patience);
        }
        for patience in [2048, 512] {
            sender.send(". xx");
            sender.arrive_late(0);
            assert_eq!(sender.runs.patience, patience);
        }
        assert_eq!(sender.send(".."), 4);
        sender.send("xxxx");
        assert_eq!(sender.send_until_runs_grow(), 2 * 512);
        sender.send("xxxx .");
        for (distance, max) in [(0, 2), (2, 2), (1, 4)] {
            sender.arrive_late(distance);
            assert_eq!(sender.send(""), max);
        }
    }

    #[test]
    fn one_that_arrives_after_all_does_not_make_up_for_earlier_failures() {
        let mut sender = Sender::starting_with(2);
        for _ in 0..3 {
            sender.send("xxxx");
            sender.send_until_runs_grow();
        }
        for _ in 0..2 {
            sender.send("xxxx");
            sender.arrive_late(0);
            assert_eq!((sender.send(""), sender.runs.patience), (4, WARY));
        }
        sender.send("....");
        assert_eq!(sender.send_until_runs_grow(), 4 * 8192);
    }

    #[test]
    fn one_at_a_time_is_longer() {
        for (runs, max) in [
            ("....", 8),
            ("?????", 8),
            ("????? ?", 4),
            ("????? ....", 4),
            ("..... ?", 10),
            (",,,,,,,, ?", 8),
            (",,,,,,,,, ?", 9),
            ("........ ?", 16),
            ("....x .", 8),
            ("x...xxxx .", 8),
            ("xxxxx .", 4),
            ("xxxxxxxx .", 4),
            ("xxxx .", 2),
        ] {
            assert_eq!(Sender::starting_with(4).send(runs), max, "{runs}");
        }
    }

    #[test]
    fn get_longer_although_nothing_is_heard_of_the_last_attempt() {
        let mut sender = Sender::starting_with(4);
        sender.send("?????");
        assert_eq!(sender.send_until_runs_grow(), 8193);
    }

    #[test]
    fn failures_are_forgotten_if_there_is_no_occasion_for_longer_ones() {
        for (pause, count, is_forgotten) in [(0, 8192, false), (0, 8193, true), (9, 8201, false)] {
            let mut sender = Sender::starting_with(2);
            for _ in 0..3 {
                sender.send("xxxx");
                sender.send_until_runs_grow();
            }
            sender.runs.suspend(sender.sent + pause);
            sender.send(&". ".repeat(count));
            let max_len = sender.runs.max_len(sender.sent, 0, 0, LEN);
            assert_eq!(max_len > 2400, is_forgotten);
            assert_eq!(sender.runs.patience < WARY, is_forgotten);
        }
    }

    #[test]
    fn only_a_trial_is_called_off_if_all_is_lost() {
        for (runs, max) in [("????? ?", 8), ("xxxxx .", 4)] {
            let mut sender = Sender::starting_with(4);
            sender.send(runs);
            sender.runs.on_all_lost(sender.sent);
            assert_eq!(sender.send(""), max);
        }
    }

    #[test]
    fn double_in_whole_datagrams_after_a_failure() {
        for (runs, max_len) in [(".", 4800), ("xxx", 2944)] {
            let mut sender = Sender::starting_with(2);
            sender.send(runs);
            assert_eq!(sender.runs.max_len(3000, u64::MAX, 0, 1472), max_len);
        }
    }

    #[test]
    fn start_with_a_pair() {
        let mut sender = Sender::starting_with(0);
        for (runs, max) in [("", 2), ("..", 4), ("...", 6), ("......", 12)] {
            assert_eq!(sender.send(runs), max);
        }
    }

    #[test]
    fn longer_ones_need_something_to_follow() {
        for (next_number, runs, following) in [
            (255, ".", 1000 + 4096 + 8 * 4800),
            (256, ".", 0),
            (3000, "xxxxx", 4096),
        ] {
            let mut sender = Sender::starting_with(4);
            sender.send(runs);
            let is_short = |&it: &u64| sender.runs.max_len(next_number, it, 1000, LEN) == 4800;
            assert_eq!((0..).take_while(is_short).count(), following);
        }
    }

    #[test]
    fn get_shorter_than_what_fits_if_longer_ones_keep_failing() {
        let mut sender = Sender::default();
        sender.send("xxxxxxxx");
        for max in [4, 2] {
            sender.send_until_runs_grow();
            assert_eq!(sender.send("xxxxxxxx .... xxxx"), max);
        }
    }
}
