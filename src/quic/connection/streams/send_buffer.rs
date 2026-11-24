use core::ops::Range;
use std::collections::VecDeque;

use crate::range_set::RangeSet;

const CHUNK_LEN: usize = 16 * 1024;
const MIN_CAPACITY: usize = 256;
const MAX_IDLE_CAPACITY: usize = 2048;

/// The bytes of a stream from the first one that is not acknowledged.
#[derive(Default)]
pub(crate) struct SendBuffer {
    /// They have the length [`CHUNK_LEN`].
    chunks: VecDeque<Vec<u8>>,
    /// What follows them, which is less.
    rest: Vec<u8>,
    /// Where the first chunk starts.
    base: u64,
    start: u64,
    end: u64,
    /// What follows has never been sent.
    sent: u64,
    /// Above `start`.
    acked: RangeSet,
    lost: RangeSet,
}

impl SendBuffer {
    #[inline]
    pub(crate) fn write(&mut self, mut data: &[u8]) {
        self.end += data.len() as u64;
        while let Some(piece) = data.split_off(..CHUNK_LEN - self.rest.len()) {
            self.rest.reserve_exact(piece.len());
            self.rest.extend_from_slice(piece);
            let chunk = core::mem::replace(&mut self.rest, Vec::with_capacity(CHUNK_LEN));
            self.chunks.push_back(chunk);
        }
        if self.rest.capacity() == 0 && !data.is_empty() {
            self.rest.reserve_exact(data.len().max(MIN_CAPACITY));
        }
        self.rest.extend_from_slice(data);
    }

    #[inline]
    pub(crate) fn len(&self) -> u64 {
        self.end - self.start
    }

    /// The offset after the last byte written.
    #[inline]
    pub(crate) fn end(&self) -> u64 {
        self.end
    }

    /// The offset after the last byte sent.
    #[inline]
    pub(crate) fn sent(&self) -> u64 {
        self.sent
    }

    /// The offset after the last byte acknowledged.
    #[inline]
    pub(crate) fn reached(&self) -> u64 {
        self.acked.last().map_or(self.start, |it| it.end)
    }

    #[inline]
    pub(crate) fn unsent_len(&self) -> u64 {
        self.end - self.sent
    }

    #[inline]
    pub(crate) fn is_acked(&self) -> bool {
        self.start == self.end
    }

    #[inline]
    pub(crate) fn first_lost(&self) -> Option<Range<u64>> {
        self.lost.first()
    }

    /// `range` starts where [`Self::first_lost`] does, or at [`Self::sent`].
    #[inline]
    pub(crate) fn send(&mut self, range: Range<u64>, out: &mut Vec<u8>) {
        let (mut at, end) = (range.start - self.base, range.end - self.base);
        while at < end {
            let (index, start) = (at as usize / CHUNK_LEN, at as usize % CHUNK_LEN);
            let len = (CHUNK_LEN - start).min((end - at) as usize);
            let chunk = self.chunks.get(index).unwrap_or(&self.rest);
            out.extend_from_slice(chunk.get(start..start + len).unwrap_or_default());
            at += len as u64;
        }
        if range.start < self.sent {
            self.lost.remove_below(range.end);
        }
        self.sent = self.sent.max(range.end);
    }

    #[inline]
    pub(crate) fn unacked_len(&self, range: Range<u64>) -> u64 {
        let gaps = self.acked.gaps(range.start.max(self.start)..range.end);
        gaps.map(|it| it.end - it.start).sum()
    }

    /// Returns how many bytes it lets go of.
    #[inline]
    pub(crate) fn on_acked(&mut self, range: Range<u64>) -> u64 {
        if !self.lost.is_empty() {
            self.lost.remove(range.clone());
        }
        if range.start > self.start {
            self.acked.insert(range);
            return 0;
        }
        let mut start = self.start.max(range.end);
        while let Some(first) = self.acked.first()
            && first.start <= start
        {
            start = start.max(first.end);
            self.acked.pop_first();
        }
        while start - self.base >= CHUNK_LEN as u64 && self.chunks.pop_front().is_some() {
            self.base += CHUNK_LEN as u64;
        }
        if start == self.end {
            match self.rest.capacity() > MAX_IDLE_CAPACITY {
                true => self.rest = Vec::new(),
                false => self.rest.clear(),
            }
            self.base = start;
        }
        if self.chunks.is_empty() {
            self.chunks = VecDeque::new();
        }
        start - core::mem::replace(&mut self.start, start)
    }

    pub(crate) fn on_lost(&mut self, range: Range<u64>) {
        for gap in self.acked.gaps(range.start.max(self.start)..range.end) {
            self.lost.insert(gap);
        }
    }

    /// Forgets the bytes, and ends the stream after the last one sent.
    pub(crate) fn discard(&mut self) {
        *self = Self {
            base: self.sent,
            start: self.sent,
            end: self.sent,
            sent: self.sent,
            ..Self::default()
        };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_what_is_not_acknowledged() {
        let mut buffer = SendBuffer::default();
        buffer.write(&[0; 100]);
        buffer.send(0..100, &mut Vec::new());
        for range in [0..10, 20..30, 40..50] {
            buffer.on_acked(range);
        }
        let lens = [0..5, 5..15, 25..45, 20..30, 0..100].map(|it| buffer.unacked_len(it));
        assert_eq!(lens, [0, 5, 10, 0, 70]);
    }

    #[test]
    fn keeps_little_room_when_all_is_acknowledged() {
        for (len, kept) in [(2048, 2048), (2049, 0), (20_000, 0)] {
            let mut buffer = SendBuffer::default();
            buffer.write(&vec![0; len]);
            buffer.send(0..len as u64, &mut Vec::new());
            buffer.on_acked(0..len as u64);
            assert_eq!((buffer.rest.len(), buffer.rest.capacity()), (0, kept));
        }
    }
}
