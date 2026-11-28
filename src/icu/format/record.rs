//! A cell has the records of the bundles of a unit in a tree. A record says which parts the bundle has, and has its chunks.

use crate::schema::MAX_PARTS;
use crate::words::{Slots, take_length, take_number};

/// A cell is the number of records, their lengths, and the records. Returns the offset of a record unless it is empty.
pub fn record_in(cell: &[u8], index: usize) -> Option<usize> {
    let (mut rest, mut start, mut length) = (cell, 0, 0);
    for i in 0..take_length(&mut rest) {
        let next = take_number(&mut rest);
        if i < index {
            start += next;
        } else if i == index {
            length = next;
        }
    }
    (length != 0).then_some(cell.len() - rest.len() + start)
}

/// The number of runs of parts, the runs, the lengths of all chunks but the last, the chunks.
#[derive(Clone, Copy)]
pub struct Record<'a> {
    parts: [u64; MAX_PARTS / 64],
    /// For each number in `parts`, the rank of its first part. It wraps around below that of the first chunk.
    ranks: [u8; MAX_PARTS / 64],
    chunks: usize,
    lengths: &'a [u8],
}

impl<'a> Record<'a> {
    /// A run is a number with the distance from the last run and the length less one. If that is all ones, the rest follows.
    pub const RUN_BITS: u32 = 2;

    /// `bytes` can go on after the record. `hosts` is the number of hosts of the schema.
    pub fn new(mut bytes: &'a [u8], hosts: usize) -> Self {
        const LONG: usize = (1 << Record::RUN_BITS) - 1;
        let (mut parts, mut part) = ([0u64; _], 0);
        for _ in 0..take_length(&mut bytes) {
            let run = take_number(&mut bytes);
            part += run >> Self::RUN_BITS;
            let mut end = part + 1 + (run & LONG);
            if run & LONG == LONG {
                end += take_number(&mut bytes);
            }
            while part < end.min(MAX_PARTS) {
                let count = (end - part).min(64 - part % 64);
                let bits = parts.at(part / 64) | u64::MAX >> (64 - count) << (part % 64);
                parts.put(part / 64, bits);
                part += count;
            }
        }
        let mut count = 0u8;
        let mut record = Self {
            parts,
            ranks: parts.map(|it| {
                let before = count;
                count = count.wrapping_add(it.count_ones() as u8);
                before
            }),
            chunks: 0,
            lengths: bytes,
        };
        let hosts = record.rank(hosts) as u8;
        record.ranks = record.ranks.map(|it| it.wrapping_sub(hosts));
        record.chunks = count.wrapping_sub(hosts).into();
        record
    }

    #[inline]
    pub fn has(&self, part: usize) -> bool {
        self.parts.at(part / 64) >> (part % 64) & 1 != 0
    }

    /// The number of chunks that the bundle has.
    pub fn chunks(&self) -> usize {
        self.chunks
    }

    /// The number of chunks before `part` that the bundle has.
    #[inline]
    pub fn rank(&self, part: usize) -> usize {
        let rest = self.parts.at(part / 64) & ((1 << (part % 64)) - 1);
        (self
            .ranks
            .at(part / 64)
            .wrapping_add(rest.count_ones() as u8))
        .into()
    }

    /// The first chunk and what follows it.
    pub(crate) fn coded(&self) -> &'a [u8] {
        let mut rest = self.lengths;
        (1..self.chunks).for_each(|_| _ = take_length(&mut rest));
        rest
    }

    /// The offset of a chunk in `coded`.
    pub(crate) fn offset(&self, rank: usize) -> usize {
        let mut rest = self.lengths;
        (0..rank).map(|_| take_length(&mut rest)).sum()
    }
}
