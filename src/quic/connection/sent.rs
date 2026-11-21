use core::ops::Range;
use std::collections::VecDeque;

use super::streams::Flags;
use crate::batch::Position;
use crate::congestion::Flight;
use crate::stream_id::StreamId;
use crate::time::Instant;

const MAX_LOST: usize = 256;
const MAX_IDLE_CAPACITY: usize = 256;

bitflags::bitflags! {
    /// The frames of which only the latest counts.
    #[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
    pub(crate) struct Control: u16 {
        const HANDSHAKE_DONE = 1 << 0;
        const MAX_DATA = 1 << 1;
        const MAX_STREAMS_BIDI = 1 << 2;
        const MAX_STREAMS_UNI = 1 << 3;
        const DATA_BLOCKED = 1 << 4;
        const NEW_TOKEN = 1 << 5;
        const ACK_FREQUENCY = 1 << 6;
        const PING = 1 << 7;
    }
}

#[derive(Clone, Copy)]
pub(crate) enum SentFrame {
    Stream {
        id: StreamId,
        offset: u64,
        len: u16,
        fin: bool,
    },
    Crypto {
        offset: u64,
        len: u16,
    },
    Owed(StreamId, Flags),
    NewConnectionId(u64),
    RetireConnectionId(u64),
    Datagram(u64),
    MtuProbe,
}

/// The frames of all packets in [`Sent`], in order.
#[derive(Default)]
pub(crate) struct Frames {
    list: VecDeque<SentFrame>,
    /// How many have been removed. It wraps.
    removed: u32,
}

impl Frames {
    #[inline]
    pub(crate) fn push(&mut self, frame: SentFrame) {
        self.list.push_back(frame);
    }

    #[inline]
    pub(super) fn end(&self) -> u32 {
        self.removed.wrapping_add(self.list.len() as u32)
    }

    #[inline]
    pub(super) fn of(&self, packet: &SentPacket) -> impl Iterator<Item = SentFrame> {
        let start = packet.first_frame.wrapping_sub(self.removed) as usize;
        (start..start + usize::from(packet.frame_count)).filter_map(|at| self.list.get(at).copied())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Fate {
    Unknown,
    /// Not known either, but the frames have been queued again.
    Probed,
    Acked,
    Lost,
}

/// An ack-eliciting packet.
#[derive(Clone, Copy)]
pub(super) struct SentPacket {
    pub(super) number: u64,
    pub(super) flight: Flight,
    pub(super) first_frame: u32,
    pub(super) frame_count: u16,
    pub(super) control: Control,
    pub(super) fate: Fate,
    /// How many packets from this one on are known not to be in flight.
    pub(super) settled: u16,
    pub(super) position: Position,
}

impl SentPacket {
    #[inline]
    pub(super) fn is_in_flight(&self) -> bool {
        matches!(self.fate, Fate::Unknown | Fate::Probed)
    }

    /// For the first of `len` packets that are acknowledged. Returns the distance to the next one that may be news.
    #[inline]
    pub(super) fn settle(&mut self, len: usize) -> usize {
        let known = self.settled;
        self.settled = known.max(len.try_into().unwrap_or(u16::MAX));
        known.max(1).into()
    }
}

pub(super) struct Sent {
    /// In ascending order. The first one is in flight.
    pub(super) packets: VecDeque<SentPacket>,
    pub(super) frames: Frames,
    pub(super) largest_acked: Option<u64>,
    pub(super) last_at: Instant,
    /// When the next packet counts as lost (RFC 9002 §6.1.2).
    pub(super) loss_time: Instant,
    /// To tell when a packet was not lost after all.
    lost: VecDeque<Lost>,
}

struct Lost {
    number: u64,
    at: Instant,
    len: u16,
}

/// The packets that are acknowledged after they counted as lost.
pub(super) struct Late {
    /// Of the oldest one.
    pub(super) number: u64,
    pub(super) at: Instant,
    /// Of all.
    pub(super) len: u64,
}

impl Default for Sent {
    fn default() -> Self {
        Self {
            packets: VecDeque::new(),
            frames: Frames::default(),
            largest_acked: None,
            last_at: Instant::default(),
            loss_time: Instant::NEVER,
            lost: VecDeque::new(),
        }
    }
}

impl Sent {
    #[inline]
    pub(super) fn has_in_flight(&self) -> bool {
        !self.packets.is_empty()
    }

    /// Where the packets with these numbers are.
    #[inline]
    pub(super) fn find(packets: &VecDeque<SentPacket>, numbers: &Range<u64>) -> Range<usize> {
        let below = |number| match (packets.front(), packets.back()) {
            (Some(first), _) if number <= first.number => 0,
            (_, Some(last)) if number > last.number => packets.len(),
            _ => packets.partition_point(|it| it.number < number),
        };
        below(numbers.start)..below(numbers.end)
    }

    #[inline]
    pub(super) fn remove_settled(&mut self) {
        while let Some(packet) = self.packets.pop_front_if(|it| !it.is_in_flight()) {
            self.frames.list.drain(..usize::from(packet.frame_count));
            self.frames.removed = self.frames.removed.wrapping_add(packet.frame_count.into());
        }
        if self.packets.is_empty()
            && (self.packets.capacity()).max(self.frames.list.capacity()) > MAX_IDLE_CAPACITY
        {
            self.packets.shrink_to_fit();
            self.frames.list.shrink_to_fit();
        }
    }

    /// In ascending order.
    pub(super) fn remember_lost(&mut self, packet: &SentPacket) {
        if self.lost.len() == MAX_LOST {
            self.lost.pop_front();
        }
        self.lost.push_back(Lost {
            number: packet.number,
            at: packet.flight.at,
            len: packet.flight.len,
        });
    }

    pub(super) fn forget_lost(&mut self) {
        self.lost = VecDeque::new();
    }

    /// What was sent before `oldest` is not going to arrive.
    #[inline]
    pub(super) fn find_late(
        &mut self,
        oldest: Instant,
        acked: impl Iterator<Item = Range<u64>>,
    ) -> Option<Late> {
        while self.lost.pop_front_if(|it| it.at < oldest).is_some() {}
        let (first, mut late) = (self.lost.front()?.number, None);
        for range in acked.take_while(|it| it.end > first) {
            let below = |number| self.lost.partition_point(|it| it.number < number);
            let positions = below(range.start)..below(range.end);
            for Lost { number, at, len } in self.lost.drain(positions).rev() {
                let len = u64::from(len) + late.map_or(0, |it: Late| it.len);
                late = Some(Late { number, at, len });
            }
        }
        late
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_is_settled_is_skipped() {
        let mut packet = SentPacket {
            number: 0,
            flight: Flight::default(),
            first_frame: 0,
            frame_count: 0,
            control: Control::empty(),
            fate: Fate::Acked,
            settled: 0,
            position: Position::default(),
        };
        let distances = [3, 2, 70_000, 1].map(|len| packet.settle(len));
        assert_eq!(distances, [1, 3, 3, 65_535]);
    }

    #[test]
    fn room_is_given_back_when_nothing_is_in_flight() {
        for (packets, frames, is_kept) in [(9, 9, true), (999, 9, false), (9, 999, false)] {
            let mut sent = Sent::default();
            sent.packets.reserve(packets);
            sent.frames.list.reserve(frames);
            sent.remove_settled();
            let room = [sent.packets.capacity(), sent.frames.list.capacity()];
            assert_eq!(room.map(|it| it > 0), [is_kept; 2]);
        }
    }
}
