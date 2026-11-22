use core::ops::Range;

use crate::path::Addresses;

/// The least that `UDP_MAX_SEGMENTS` has been on Linux.
const MAX_SEGMENTS: usize = 64;
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

    /// The bytes from `start` on are a datagram, which can be part of a run of up to `max_len` bytes.
    #[inline]
    pub(crate) fn commit(
        &mut self,
        addresses: &Addresses,
        start: usize,
        max_len: usize,
    ) -> Position {
        let len = self.bytes.len() - start;
        self.len += 1;
        if let Some(run) = self.runs.last_mut()
            && len <= run.segment_len
            && (start - run.start).is_multiple_of(run.segment_len)
            && self.bytes.len() - run.start <= run.max_len.min(max_len)
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
            max_len: MAX_RUN_LEN.min(MAX_SEGMENTS * len).min(max_len),
            segments: 1,
        });
        Position::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_last_datagram_of_a_run_can_be_shorter() {
        let mut batch = Batch::default();
        let datagrams = [
            (1, 40),
            (1, 40),
            (1, 30),
            (1, 30),
            (1, 40),
            (2, 40),
            (3, 30),
        ];
        for (port, len) in datagrams.into_iter().chain([(3, 40); 65]) {
            let address = ([192, 0, 2, 1], port).into();
            let addresses = Addresses {
                local: address,
                peer: address,
            };
            let start = batch.bytes.len();
            batch.bytes.resize(start + len, 0);
            batch.commit(&addresses, start, usize::MAX);
        }
        let runs = batch.runs().map(|it| (it.0.peer.port(), it.1.len(), it.2));
        let expected = [
            (1, 110, 40),
            (1, 30, 30),
            (1, 40, 40),
            (2, 40, 40),
            (3, 30, 30),
            (3, 64 * 40, 40),
            (3, 40, 40),
        ];
        assert_eq!(runs.collect::<Vec<_>>(), expected);
    }

    #[test]
    fn runs_have_limits() {
        let address = ([192, 0, 2, 1], 1).into();
        let addresses = Addresses {
            local: address,
            peer: address,
        };
        for (first, count, last, position) in [
            ((1200, 70_000), 54, (707, 70_000), 54),
            ((1200, 70_000), 54, (708, 70_000), 0),
            ((40, 120), 2, (40, 999), 2),
            ((40, 120), 3, (1, 999), 0),
            ((40, 999), 2, (40, 120), 2),
            ((40, 999), 3, (1, 120), 0),
        ] {
            let mut batch = Batch::default();
            let mut add = |(len, max_len)| {
                let start = batch.bytes.len();
                batch.bytes.resize(start + len, 0);
                let position = batch.commit(&addresses, start, max_len);
                assert_eq!(position.offset, first.0 as u16 * u16::from(position.index));
                position.index
            };
            assert!((0..count).all(|it| add(first) == it));
            assert_eq!(add(last), position);
        }
    }
}
