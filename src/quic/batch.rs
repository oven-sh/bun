use core::ops::Range;

use crate::path::Addresses;

/// The least that `UDP_MAX_SEGMENTS` has been on Linux.
pub(crate) const MAX_SEGMENTS: usize = 64;
/// What a UDP datagram can carry over IPv4.
const MAX_RUN_LEN: usize = 65507;

/// Datagrams to send.
#[derive(Default)]
pub struct Batch {
    pub(crate) bytes: Vec<u8>,
    runs: Vec<Run>,
    len: usize,
}

/// Datagrams that go the same way and have the same length, but for the last one, which can be shorter.
struct Run {
    addresses: Addresses,
    start: usize,
    segment_len: usize,
    max_len: usize,
    segments: u8,
}

/// Of a datagram in its run.
#[derive(Default, Clone, Copy)]
pub(crate) struct Position {
    pub(crate) index: u8,
    /// In bytes.
    pub(crate) offset: u16,
}

impl Batch {
    /// The number of datagrams.
    #[inline]
    pub fn len(&self) -> usize {
        self.len
    }

    pub fn clear(&mut self) {
        self.bytes.clear();
        self.runs.clear();
        self.len = 0;
    }

    /// The datagrams one after the other.
    #[inline]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Where they go, where they are in [`Self::bytes`], and the length of all but the last one.
    pub fn runs(&self) -> impl Iterator<Item = (&Addresses, Range<usize>, usize)> {
        let ends = (self.runs.iter().skip(1).map(|it| it.start)).chain([self.bytes.len()]);
        (self.runs.iter().zip(ends))
            .map(|(run, end)| (&run.addresses, run.start..end, run.segment_len))
    }

    /// The bytes from `start` on are a datagram, which can be one of up to `max_segments` in a run.
    #[inline]
    pub(crate) fn commit(
        &mut self,
        addresses: &Addresses,
        start: usize,
        max_segments: usize,
    ) -> Position {
        let len = self.bytes.len() - start;
        self.len += 1;
        if let Some(run) = self.runs.last_mut()
            && len <= run.segment_len
            && (start - run.start).is_multiple_of(run.segment_len)
            && self.bytes.len() - run.start <= run.max_len.min(max_segments * run.segment_len)
            && run.addresses == *addresses
        {
            run.segments += 1;
            return Position {
                index: run.segments - 1,
                offset: (start - run.start) as u16,
            };
        }
        self.runs.push(Run {
            addresses: *addresses,
            start,
            segment_len: len,
            max_len: MAX_RUN_LEN.min(max_segments * len),
            segments: 1,
        });
        Position::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_have_limits() {
        let address = ([192, 0, 2, 1], 1).into();
        let addresses = Addresses {
            local: address,
            peer: address,
        };
        for (first, count, last, position) in [
            ((1200, 64), 54, (707, 64), 54),
            ((1200, 64), 54, (708, 64), 0),
            ((40, 3), 2, (40, 64), 2),
            ((40, 3), 3, (1, 64), 0),
            ((40, 64), 2, (40, 3), 2),
            ((40, 64), 3, (1, 3), 0),
        ] {
            let mut batch = Batch::default();
            let mut add = |(len, max_segments)| {
                let start = batch.bytes.len();
                batch.bytes.resize(start + len, 0);
                let position = batch.commit(&addresses, start, max_segments);
                assert_eq!(position.offset, first.0 as u16 * u16::from(position.index));
                position.index
            };
            assert!((0..count).all(|it| add(first) == it));
            assert_eq!(add(last), position);
        }
    }
}
