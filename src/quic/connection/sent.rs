use core::ops::Range;
use std::collections::VecDeque;

use super::streams::Flags;
use crate::congestion::Flight;
use crate::range_set::RangeSet;
use crate::stream_id::StreamId;
use crate::time::Instant;

const MAX_LOST_RANGES: usize = 32;

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
}

impl SentPacket {
    #[inline]
    pub(super) fn is_in_flight(&self) -> bool {
        matches!(self.fate, Fate::Unknown | Fate::Probed)
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
    lost: RangeSet,
}

impl Default for Sent {
    fn default() -> Self {
        Self {
            packets: VecDeque::new(),
            frames: Frames::default(),
            largest_acked: None,
            last_at: Instant::default(),
            loss_time: Instant::NEVER,
            lost: RangeSet::default(),
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
    }

    pub(super) fn remember_lost(&mut self, number: u64) {
        self.lost.insert(number..number + 1);
        if self.lost.len() > MAX_LOST_RANGES {
            self.lost.pop_first();
        }
    }

    /// Returns the smallest number that is acknowledged after it counted as lost.
    #[inline]
    pub(super) fn find_late(&mut self, acked: impl Iterator<Item = Range<u64>>) -> Option<u64> {
        let (mut late, mut smallest) = (None, 0);
        for range in acked {
            let first = self.lost.first()?;
            smallest = range.start;
            if range.end <= first.start {
                break;
            }
            let gap = self.lost.gaps(range.clone()).next();
            if gap.as_ref() != Some(&range) {
                late = Some(
                    gap.filter(|it| it.start == range.start)
                        .map_or(range.start, |it| it.end),
                );
                self.lost.remove(range);
            }
        }
        self.lost.remove_below(smallest);
        late
    }
}
