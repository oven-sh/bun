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

    /// The bytes from `start` on are a datagram.
    #[inline]
    pub(crate) fn commit(&mut self, addresses: &Addresses, start: usize) {
        let len = self.bytes.len() - start;
        self.len += 1;
        if let Some(run) = self.runs.last()
            && len <= run.segment_len
            && (start - run.start).is_multiple_of(run.segment_len)
            && self.bytes.len() - run.start <= MAX_RUN_LEN.min(MAX_SEGMENTS * run.segment_len)
            && run.addresses == *addresses
        {
            return;
        }
        self.runs.push(Run {
            addresses: *addresses,
            start,
            segment_len: len,
        });
    }
}
