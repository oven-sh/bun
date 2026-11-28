//! Making up for waking late takes a burst, which should be no longer than what the queue on the path can take in.

use super::Feedback;

/// In packets, like all lengths but the limit.
const MIN_LEN: u32 = 10;
/// Fewer can get lost by chance.
const MIN_LOST: u32 = 3;
/// The limit grows by a sixteenth with each burst that gets through, and twice as fast after so many of them.
const BURSTS_PER_DOUBLING: u8 = 3;
const MAX_DOUBLINGS: u8 = 3;
/// After so many that have found nothing missing, the queue is taken to be long enough.
const MAX_FOLLOW_UPS: u8 = 4;

#[derive(Default, Clone, Copy, PartialEq, Eq)]
enum Watch {
    #[default]
    Nothing,
    Sending,
    Waiting,
}

pub(super) struct CatchUp {
    pub(super) is_on: bool,
    /// Since the last one ended.
    sent: u8,
    /// Since a packet was last lost.
    follow_ups: u8,
    /// In bytes.
    pub(super) limit: u32,
    /// How many in a row have been cut short and got through.
    arrivals: u8,
    /// The last one that overflowed a queue found less room in it than the limit.
    exceeds_room: bool,
    /// One burst at a time, which the rest is about.
    watch: Watch,
    /// The low bits of the sequence number.
    first: u32,
    datagram_len: u16,
    len: u16,
    in_flight: u16,
    /// In the first half and in the second one.
    lost: (u16, u16),
    is_cut_short: bool,
    /// With its last packet so far.
    has_run_dry: bool,
}

impl Default for CatchUp {
    fn default() -> Self {
        Self {
            is_on: false,
            sent: 0,
            follow_ups: 0,
            limit: u32::MAX,
            arrivals: 0,
            exceeds_room: false,
            watch: Watch::Nothing,
            first: 0,
            datagram_len: 0,
            len: 0,
            in_flight: 0,
            lost: (0, 0),
            is_cut_short: false,
            has_run_dry: false,
        }
    }
}

impl CatchUp {
    pub(super) fn start(&mut self, first: u64, datagram_len: u16, is_cut_short: bool) {
        self.is_on = true;
        if !self.is_watching() {
            (self.watch, self.first) = (Watch::Sending, first as u32);
            (self.len, self.in_flight, self.lost) = (0, 0, (0, 0));
            (self.datagram_len, self.is_cut_short) = (datagram_len, is_cut_short);
        }
    }

    #[inline]
    pub(super) fn is_watching(&self) -> bool {
        self.watch != Watch::Nothing
    }

    #[inline]
    pub(super) fn started_after(&self, sequence: u64) -> bool {
        self.first == (sequence as u32).wrapping_add(1)
    }

    /// Whether the last one that has told anything about it got through.
    pub(super) fn is_limit_proven(&self) -> bool {
        self.arrivals > 0
    }

    /// So far, in bytes. None unless the end is spared.
    pub(super) fn arrived(&self) -> Option<u64> {
        let (early, late) = self.lost;
        let settled = self.len - self.in_flight;
        let arrived = settled.saturating_sub(early.saturating_add(late));
        (late.div_ceil(2) <= early).then_some(u64::from(arrived) * u64::from(self.datagram_len))
    }

    #[inline]
    pub(super) fn on_sent(&mut self) {
        self.sent = self.sent.saturating_add(self.is_on.into());
        if self.watch == Watch::Sending && self.len < u16::MAX {
            (self.len, self.in_flight) = (self.len + 1, self.in_flight + 1);
            self.has_run_dry = false;
        }
    }

    pub(super) fn on_run_dry(&mut self) {
        self.has_run_dry |= self.watch == Watch::Sending;
    }

    /// Whether a queue may have had no room for all of it.
    #[inline]
    pub(super) fn is_long(&self) -> bool {
        u32::from(self.sent) > MIN_LEN && self.follow_ups < MAX_FOLLOW_UPS
    }

    pub(super) fn on_followed_up(&mut self) {
        self.follow_ups += u8::from(self.is_long());
        self.end();
    }

    #[inline]
    pub(super) fn end(&mut self) {
        (self.is_on, self.sent) = (false, 0);
        if self.watch == Watch::Sending {
            self.watch = Watch::Waiting;
        }
    }

    /// For a packet that is not in flight any more, for whatever reason.
    #[inline]
    pub(super) fn on_settled(&mut self, sequence: u64) {
        if (sequence as u32).wrapping_sub(self.first) < u32::from(self.len) {
            self.in_flight = self.in_flight.saturating_sub(1);
        }
    }

    #[inline]
    pub(super) fn on_lost(&mut self, sequence: u64) {
        self.follow_ups = 0;
        let at = (sequence as u32).wrapping_sub(self.first);
        if at < u32::from(self.len / 2) {
            self.lost.0 = self.lost.0.saturating_add(1);
        } else if at < u32::from(self.len) {
            self.lost.1 = self.lost.1.saturating_add(1);
        }
    }

    #[inline]
    pub(super) fn on_feedback(&mut self, feedback: &Feedback) {
        if feedback.is_persistent_congestion {
            self.watch = Watch::Nothing;
        } else if self.watch == Watch::Sending && self.in_flight < self.len {
            // It has begun to make way for what follows.
            self.watch = Watch::Waiting;
        }
        if self.watch == Watch::Waiting && self.in_flight == 0 {
            self.judge();
        }
    }

    fn judge(&mut self) {
        self.watch = Watch::Nothing;
        let [len, early, late] = [self.len, self.lost.0, self.lost.1].map(u32::from);
        let datagram_len = u32::from(self.datagram_len);
        if early + late >= len {
            return;
        }
        // It is the end that a queue has no room for. What is lost before that would have been lost anyway.
        let excess = if late >= 2 * early + MIN_LOST {
            late - early
        } else if early + late >= len.div_ceil(2) {
            early + late
        } else {
            0
        };
        if excess == 0 && self.is_cut_short && !self.has_run_dry {
            if core::mem::take(&mut self.exceeds_room) {
                // Others have had a part of the queue.
                self.arrivals = MAX_DOUBLINGS * BURSTS_PER_DOUBLING;
            }
            let halvings = 4 - (self.arrivals / BURSTS_PER_DOUBLING).min(MAX_DOUBLINGS);
            self.limit = (self.limit).saturating_add((self.limit >> halvings) + datagram_len);
            self.arrivals = self.arrivals.saturating_add(1);
        } else if excess > 0 && len > MIN_LEN {
            let room = (len - excess) * datagram_len;
            let too_much = match self.limit {
                u32::MAX => room,
                // The queue may not have been empty.
                limit => limit.max(room),
            };
            self.limit = (too_much - too_much / 8)
                .min(self.limit)
                .max(MIN_LEN * datagram_len);
            self.arrivals = 0;
            self.exceeds_room = self.limit > room.saturating_add(room / 8 + datagram_len);
        }
    }
}
