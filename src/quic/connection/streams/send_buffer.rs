use core::ops::Range;
use std::collections::VecDeque;

use crate::range_set::RangeSet;

/// The bytes of a stream from the first one that is not acknowledged.
#[derive(Default)]
pub(crate) struct SendBuffer {
    bytes: VecDeque<u8>,
    start: u64,
    /// What follows has never been sent.
    sent: u64,
    /// Above `start`.
    acked: RangeSet,
    lost: RangeSet,
}

impl SendBuffer {
    #[inline]
    pub(crate) fn write(&mut self, data: &[u8]) {
        self.bytes.extend(data);
    }

    /// The offset after the last byte written.
    #[inline]
    pub(crate) fn end(&self) -> u64 {
        self.start + self.bytes.len() as u64
    }

    /// The offset after the last byte sent.
    #[inline]
    pub(crate) fn sent(&self) -> u64 {
        self.sent
    }

    #[inline]
    pub(crate) fn unsent_len(&self) -> u64 {
        self.end() - self.sent
    }

    #[inline]
    pub(crate) fn is_acked(&self) -> bool {
        self.bytes.is_empty()
    }

    #[inline]
    pub(crate) fn first_lost(&self) -> Option<Range<u64>> {
        self.lost.first()
    }

    /// `range` starts where [`Self::first_lost`] does, or at [`Self::sent`].
    #[inline]
    pub(crate) fn send(&mut self, range: Range<u64>, out: &mut Vec<u8>) {
        let (start, end) = (range.start - self.start, range.end - self.start);
        let (start, end) = (start as usize, end as usize);
        let (front, back) = self.bytes.as_slices();
        let split = front.len();
        out.extend_from_slice(front.get(start..end.min(split)).unwrap_or_default());
        if let Some(end) = end.checked_sub(split) {
            let back = back.get(start.saturating_sub(split)..end);
            out.extend_from_slice(back.unwrap_or_default());
        }
        if range.start < self.sent {
            self.lost.remove_below(range.end);
        }
        self.sent = self.sent.max(range.end);
    }

    #[inline]
    pub(crate) fn on_acked(&mut self, range: Range<u64>) {
        if !self.lost.is_empty() {
            self.lost.remove(range.clone());
        }
        if range.start > self.start {
            return self.acked.insert(range);
        }
        let mut start = self.start.max(range.end);
        while let Some(first) = self.acked.first()
            && first.start <= start
        {
            start = start.max(first.end);
            self.acked.pop_first();
        }
        let len = ((start - self.start) as usize).min(self.bytes.len());
        self.bytes.drain(..len);
        self.start += len as u64;
    }

    pub(crate) fn on_lost(&mut self, range: Range<u64>) {
        for gap in self.acked.gaps(range.start.max(self.start)..range.end) {
            self.lost.insert(gap);
        }
    }

    /// Forgets the bytes, and ends the stream after the last one sent.
    pub(crate) fn discard(&mut self) {
        *self = Self {
            start: self.sent,
            sent: self.sent,
            ..Self::default()
        };
    }
}
