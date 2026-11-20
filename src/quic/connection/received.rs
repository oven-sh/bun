use core::ops::Range;
use std::collections::VecDeque;

use crate::coding::{Write, varint_len};
use crate::frame::{Ack, kind};
use crate::range_set::RangeSet;
use crate::time::{Duration, Instant};

const MAX_RANGES: usize = 1000;
/// After the first. They are counted in one byte.
const MAX_RANGES_IN_FRAME: usize = 63;
/// So many of them are those at the top, and so many those below a packet that was late.
const TOP_RANGES: usize = 31;
const RANGES_BELOW_LATE: usize = 8;
const MAX_TRACKED_ACKS: usize = 16;
pub(super) const ACK_DELAY_EXPONENT: u64 = 3;

struct SentAck {
    packet: u64,
    at: Instant,
    /// It has named everything below that has arrived.
    end: u64,
}

/// Of an ack-eliciting packet among the others (RFC 9000 §13.2.1).
#[derive(PartialEq, Eq)]
pub(super) enum Order {
    Expected,
    AfterGap,
    Late,
}

/// The packet numbers that have to be acknowledged (RFC 9000 §13.2).
#[derive(Default)]
pub(super) struct Received {
    ranges: RangeSet,
    /// What is below counts as a duplicate.
    floor: u64,
    /// The peer knows what has arrived below.
    reported: u64,
    /// What `floor` is going to be, and when.
    next_floor: (u64, Instant),
    /// Follows the largest packet number.
    pub(super) expected: u64,
    largest_at: Instant,
    /// When a packet has last turned out to be missing.
    pub(super) gap_at: Instant,
    /// Follows the largest number of an ack-eliciting packet.
    expected_eliciting: u64,
    /// Since the last ACK frame.
    pub(super) unacked_eliciting: u64,
    lowest_late: Option<u64>,
    pub(super) is_ack_due: bool,
    sent_acks: VecDeque<SentAck>,
}

impl Received {
    #[inline]
    pub(super) fn is_duplicate(&self, number: u64) -> bool {
        number < self.expected && (number < self.floor || self.ranges.contains(number))
    }

    #[inline]
    pub(super) fn insert(&mut self, now: Instant, number: u64, is_eliciting: bool) -> Order {
        self.ranges.insert(number..number + 1);
        if self.ranges.len() > MAX_RANGES {
            self.floor = (self.floor).max(self.ranges.pop_first().map_or(0, |it| it.end));
        }
        if number >= self.expected {
            self.expected = number + 1;
            self.largest_at = now;
        } else if is_eliciting {
            self.reported = self.reported.min(number);
            self.lowest_late = Some(self.lowest_late.map_or(number, |it| it.min(number)));
            (self.sent_acks.iter_mut()).for_each(|it| it.end = it.end.min(number));
        }
        if !is_eliciting {
            return Order::Expected;
        }
        self.unacked_eliciting += 1;
        let expected = self.expected_eliciting.max(self.floor);
        self.expected_eliciting = expected.max(number + 1);
        if number < expected {
            Order::Late
        } else if self.ranges.last().is_some_and(|top| top.start > expected) {
            Order::AfterGap
        } else {
            Order::Expected
        }
    }

    /// Writes as many ranges as end before `out` has the length `end`.
    pub(super) fn write_ack(&mut self, now: Instant, packet: u64, out: &mut Vec<u8>, end: usize) {
        let reported = self.reported;
        let mut ranges = (self.ranges.iter().rev())
            .take_while(|it| it.end > reported)
            .map(|it| it.start.max(reported)..it.end);
        let Some(Range { start, end: top }) = ranges.next() else {
            self.is_ack_due = false;
            return;
        };
        let (largest, first_range) = (top - 1, top - 1 - start);
        let delay = (now - self.largest_at).as_micros() >> ACK_DELAY_EXPONENT;
        if out.len() + 2 + varint_len(largest) + varint_len(delay) + varint_len(first_range) > end {
            return;
        }
        out.push(kind::ACK as u8);
        out.varint(largest);
        out.varint(delay);
        let count_at = out.len();
        out.push(0);
        out.varint(first_range);
        // What is left out has been acknowledged before.
        let above_late = (self.lowest_late.take()).map_or(0, |it| self.ranges.count_above(it));
        let omitted = (above_late + RANGES_BELOW_LATE).saturating_sub(MAX_RANGES_IN_FRAME);
        let (mut count, mut above) = (0, start);
        let chosen = (ranges.enumerate())
            .filter(|(at, _)| !(TOP_RANGES..TOP_RANGES + omitted).contains(at))
            .take(MAX_RANGES_IN_FRAME);
        for (_, range) in chosen {
            let (gap, len) = (above - range.end - 1, range.end - range.start - 1);
            if out.len() + varint_len(gap) + varint_len(len) > end {
                break;
            }
            out.varint(gap);
            out.varint(len);
            (count, above) = (count + 1, range.start);
        }
        crate::with(out.get_mut(count_at), |it| *it = count);
        self.unacked_eliciting = 0;
        self.is_ack_due = false;
        if self.sent_acks.len() < MAX_TRACKED_ACKS {
            self.sent_acks.push_back(SentAck {
                packet,
                at: now,
                end: top,
            });
        }
    }

    pub(super) fn forget_sent_acks(&mut self) {
        self.sent_acks.clear();
    }

    /// Stops repeating what the peer knows to be acknowledged (RFC 9000 §13.2.4). Returns when the largest packet that `ack`
    /// names was sent, if it had an ACK frame.
    #[inline]
    pub(super) fn on_ack(&mut self, ack: &Ack) -> Option<Instant> {
        let mut largest_sent_at = None;
        while let Some(sent) = self.sent_acks.pop_front_if(|it| it.packet <= ack.largest) {
            if sent.packet >= ack.first_range().start {
                self.reported = self.reported.max(sent.end);
            }
            largest_sent_at = (sent.packet == ack.largest).then_some(sent.at);
        }
        largest_sent_at
    }

    /// Stops waiting for packets that have been missing for `patience` or more.
    #[inline]
    pub(super) fn forget_old_gaps(&mut self, now: Instant, patience: Duration) {
        if now >= self.next_floor.1 {
            self.floor = (self.floor).max(self.next_floor.0.min(self.reported));
            self.ranges.remove_below(self.floor);
            self.next_floor = (self.reported, now + patience);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acks_fit_or_wait() {
        let (now, mut received) = (Instant::default(), Received::default());
        received.insert(now, 0, true);
        received.insert(now, 2, true);
        for (end, ack) in [
            (4, &[][..]),
            (5, &[2, 2, 0, 0, 0]),
            (6, &[2, 2, 0, 0, 0]),
            (7, &[2, 2, 0, 1, 0, 0, 0]),
        ] {
            let mut out = Vec::new();
            received.is_ack_due = true;
            received.write_ack(now, 0, &mut out, end);
            assert_eq!((&out[..], received.is_ack_due), (ack, ack.is_empty()));
        }
    }

    #[test]
    fn old_gaps_take_no_room() {
        let (now, mut received) = (Instant::default(), Received::default());
        for number in [0, 2, 4] {
            received.insert(now, number, true);
        }
        received.reported = 3;
        for ranges in [3, 1] {
            received.forget_old_gaps(now, Duration::ZERO);
            assert_eq!(received.ranges.len(), ranges);
        }
    }
}
