//! Until they leave the host, datagrams that are sent in a run are taken or dropped as a whole. A queue that has no
//! room for a long run may have it for the same datagrams in short ones.

use super::sent::SentPacket;
use crate::batch::{MAX_SEGMENTS, Position};

const MIN_PATIENCE: u64 = 512;
const MAX_PATIENCE: u64 = 64 * 1024;
/// It comes to this if longer runs have failed twice. The queue is short, and has to hold more than one run.
const WARY: u64 = 16 * MIN_PATIENCE;
/// For how many packets a run that has arrived shows that its length is not the problem.
const MEMORY: u64 = 1024;

pub(super) struct Runs {
    /// In datagrams.
    pub(super) max_len: usize,
    /// The packet number from which on it is too small.
    longer_from: u64,
    /// After how many runs the next ones can be twice as long.
    patience: u64,
    has_grown: bool,
    /// In bytes.
    longest_arrived: u16,
    /// The last packet number that it counts for.
    remembered_until: u64,
    /// The sequence numbers of the last packets that were lost in a row.
    first_lost: u64,
    last_lost: u64,
}

impl Default for Runs {
    fn default() -> Self {
        Self {
            max_len: MAX_SEGMENTS,
            longer_from: u64::MAX,
            patience: MIN_PATIENCE,
            has_grown: false,
            longest_arrived: 0,
            remembered_until: 0,
            first_lost: 1,
            last_lost: 0,
        }
    }
}

impl Runs {
    #[inline]
    pub(super) fn on_acked(&mut self, packet: &SentPacket) {
        let len = match packet.position.index {
            0 => 0,
            _ => packet.position.offset + packet.flight.len,
        };
        if len >= self.longest_arrived || packet.number > self.remembered_until {
            (self.longest_arrived, self.remembered_until) = (len, packet.number + MEMORY);
        }
    }

    pub(super) fn on_lost(&mut self, packet: &SentPacket, ends_run: bool, next_number: u64) {
        let (sequence, Position { index, offset }) = (packet.flight.sequence, packet.position);
        if sequence != self.last_lost + 1 {
            self.first_lost = sequence;
        }
        self.last_lost = sequence;
        let is_whole = ends_run && index > 0 && self.first_lost + u64::from(index) == sequence;
        let may_fit = offset + packet.flight.len <= self.longest_arrived && self.patience < WARY;
        if is_whole && !may_fit {
            if core::mem::take(&mut self.has_grown) {
                self.patience = MAX_PATIENCE.min(self.patience * 4);
            }
            self.set_max_len(self.max_len.min(usize::from(index / 2) + 1), next_number);
        }
    }

    #[inline]
    pub(super) fn try_longer(&mut self, next_number: u64) {
        if next_number >= self.longer_from {
            if core::mem::replace(&mut self.has_grown, true) {
                self.patience = MIN_PATIENCE.max(self.patience / 2);
            }
            self.set_max_len(MAX_SEGMENTS.min(self.max_len * 2), next_number);
        }
    }

    fn set_max_len(&mut self, len: usize, next_number: u64) {
        self.max_len = len;
        self.longer_from = next_number + self.patience * len as u64;
    }
}

#[cfg(test)]
mod tests {
    use super::super::sent::{Control, Fate};
    use super::*;
    use crate::congestion::Flight;

    #[derive(Default)]
    struct Sender {
        runs: Runs,
        sent: u64,
    }

    impl Sender {
        /// `x` and `y` get lost, `y` and `,` are shorter.
        fn send(&mut self, runs: &str) -> usize {
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
                        b'x' | b'.' => 100,
                        _ => 50,
                    };
                    offset += packet.flight.len;
                    let ends_run = usize::from(index) + 1 == run.len();
                    match fate {
                        b'x' | b'y' => self.runs.on_lost(&packet, ends_run, self.sent),
                        _ => self.runs.on_acked(&packet),
                    }
                }
            }
            self.runs.try_longer(self.sent);
            self.runs.max_len
        }

        /// Returns how many packets it takes.
        fn send_until_runs_grow(&mut self) -> usize {
            let before = self.runs.max_len;
            1 + (0..).take_while(|_| self.send(".") == before).count()
        }
    }

    #[test]
    fn get_shorter_if_they_are_lost_as_a_whole() {
        for (runs, max) in [
            ("x", 64),
            ("xx", 1),
            ("xxx", 2),
            ("xxx.", 64),
            (".xxx", 64),
            ("xx.x", 64),
            ("xxxxxx xx", 3),
            ("xxxxxx . xx", 1),
            ("xxxx . xxxxxxxx", 2),
            (".x xxxx", 64),
            ("... xxxx", 2),
            (".... xxxx", 64),
            (".... .. xxxx", 64),
            (". yy", 1),
            ("..., xxxx", 2),
            ("..., xxxy", 64),
        ] {
            assert_eq!(Sender::default().send(runs), max, "{runs}");
        }
    }

    #[test]
    fn what_has_arrived_is_forgotten() {
        for (count, max) in [(1024, 64), (1025, 2)] {
            let mut sender = Sender::default();
            sender.send(".... ....");
            sender.send(&". ".repeat(count));
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
        sender.send("xxxxxxxx . xxxxxx");
        for (len, patience) in [(3, 2048), (6, 2048), (12, 1024), (24, 512), (48, 512)] {
            assert_eq!(sender.runs.max_len, len);
            assert_eq!(sender.send_until_runs_grow(), len * patience);
        }
        assert_eq!(sender.runs.max_len, 64);
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
