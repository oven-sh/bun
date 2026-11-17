//! The literals section.

use bun_zstd_decoder::array::get_or_allocate;
use bun_zstd_decoder::format::Encoding;
use bun_zstd_decoder::{Error, Result};

use super::Reuse;
use super::histogram::Histogram;
use super::huffman::{Description, JUMP_TABLE_LEN, Table};
use crate::bytes::{is_one_byte_repeated, put};
use crate::parameters::{Strategy, Tuning};

const FOUR_STREAMS_FROM: usize = 256;

/// `content` is all `len` literals, or the one that they repeat.
fn write_plain(encoding: Encoding, len: usize, content: &[u8], out: &mut [u8]) -> Result<usize> {
    let (header, header_len) = match len as u32 {
        len @ ..32 => (len << 3, 1),
        len @ ..4096 => (len << 4 | 1 << 2, 2),
        len => (len << 4 | 3 << 2, 3),
    };
    let header = (header | encoding as u32).to_le_bytes();
    let mut write = || {
        let (start, rest) = out.split_at_mut_checked(header_len)?;
        put(start, header.get(..header_len)?)?;
        put(rest, content)
    };
    write().ok_or(Error::DstSizeTooSmall)?;
    Ok(header_len + content.len())
}

fn write_raw(literals: &[u8], out: &mut [u8]) -> Result<usize> {
    write_plain(Encoding::Basic, literals.len(), literals, out)
}

fn write_repeated(literals: &[u8], out: &mut [u8]) -> Result<usize> {
    let first = literals.get(..1).ok_or(Error::Internal)?;
    write_plain(Encoding::Rle, literals.len(), first, out)
}

fn compressed_header_len(len: usize) -> usize {
    3 + usize::from(len >= 1 << 10) + usize::from(len >= 16 << 10)
}

/// Fills `header`, which is 3 to 5 bytes long.
fn write_compressed_header(
    header: &mut [u8],
    encoding: Encoding,
    is_single_stream: bool,
    len: usize,
    compressed_len: usize,
) {
    let (format, bits) = match header.len() {
        3 => (u64::from(!is_single_stream), 10),
        4 => (2, 14),
        _ => (3, 18),
    };
    let value =
        encoding as u64 | format << 2 | (len as u64) << 4 | (compressed_len as u64) << (4 + bits);
    for (to, from) in header.iter_mut().zip(value.to_le_bytes()) {
        *to = from;
    }
}

fn is_too_even(largest_count: usize, len: usize) -> bool {
    largest_count <= (len >> 7) + 4
}

/// Going by samples.
pub(crate) fn looks_random(literals: &[u8]) -> bool {
    const SAMPLE_LEN: usize = 4096;
    if literals.len() < 10 * SAMPLE_LEN {
        return false;
    }
    let samples = [literals.first_chunk::<SAMPLE_LEN>(), literals.last_chunk()];
    let largest = |sample: &[u8; SAMPLE_LEN]| Histogram::of(sample).largest_count;
    is_too_even(
        samples.into_iter().flatten().map(largest).sum(),
        2 * SAMPLE_LEN,
    )
}

/// How literals are going to be encoded.
pub(crate) struct LiteralsPlan {
    pub(crate) encoding: Encoding,
    description: Description,
    /// Of the streams, if there are any.
    estimated_len: usize,
}

impl LiteralsPlan {
    fn plain(encoding: Encoding) -> Self {
        Self {
            encoding,
            description: Description::EMPTY,
            estimated_len: 0,
        }
    }

    /// For the `len` literals that it was made for, given what headers add to compressed ones.
    pub(crate) fn estimated_len(&self, len: usize, overhead: usize) -> usize {
        match self.encoding {
            Encoding::Basic => len,
            Encoding::Rle => 1,
            _ => self.estimated_len + self.description.len + overhead,
        }
    }

    pub(crate) fn overhead(len: usize) -> usize {
        compressed_header_len(len)
            + if len < FOUR_STREAMS_FROM {
                0
            } else {
                JUMP_TABLE_LEN
            }
    }
}

fn reusable<'a>(table: &'a Option<Box<Table>>, reuse: Reuse, counts: &[u32]) -> Option<&'a Table> {
    table.as_deref().filter(|table| match reuse {
        Reuse::Never => false,
        Reuse::IfComplete => table.has_codes_for(counts),
        Reuse::Always => true,
    })
}

/// The table that a decoder has, and the one that may replace it.
pub(crate) struct LiteralTables {
    current: Option<Box<Table>>,
    candidate: Option<Box<Table>>,
    pub(super) reuse: Reuse,
}

impl LiteralTables {
    pub(super) const EMPTY: Self = Self {
        current: None,
        candidate: None,
        reuse: Reuse::Never,
    };

    /// The table, if it has codes for all bytes.
    pub(crate) fn complete(&self) -> Option<&Table> {
        self.current
            .as_deref()
            .filter(|_| self.reuse == Reuse::Always)
    }

    pub(crate) fn load(&mut self, weights: &[u8], log: u32, reuse: Reuse) -> Result<()> {
        get_or_allocate(&mut self.current, || Table::EMPTY)?.build_from_weights(weights, log);
        self.reuse = reuse;
        Ok(())
    }

    pub(super) fn accept_candidate(&mut self) {
        core::mem::swap(&mut self.current, &mut self.candidate);
        self.reuse = Reuse::IfComplete;
    }

    pub(super) fn copy_from(&mut self, other: &Self) -> Result<()> {
        if let Some(table) = &other.current {
            *get_or_allocate(&mut self.current, || Table::EMPTY)? = **table;
        }
        self.reuse = other.reuse;
        Ok(())
    }

    /// Returns the length of the section.
    pub(super) fn compress(
        &mut self,
        literals: &[u8],
        tuning: &Tuning,
        has_few_matches: bool,
        out: &mut [u8],
    ) -> Result<(usize, Encoding)> {
        let len = literals.len();
        let min_len = match self.reuse {
            Reuse::Always => 6,
            _ => 8 << (9 - tuning.strategy as usize).min(3),
        };
        if tuning.compresses_literals() && len >= min_len {
            let header_len = compressed_header_len(len);
            if out.len() <= header_len {
                return Err(Error::DstSizeTooSmall);
            }
            let (header, rest) = out.split_at_mut(header_len);
            let is_single_stream =
                len < FOUR_STREAMS_FROM || (self.reuse == Reuse::Always && header_len == 3);
            let compressed = self.compress_streams(
                literals,
                tuning.strategy,
                has_few_matches,
                is_single_stream,
                rest,
            )?;
            if let Some((written, encoding)) = compressed
                && written < tuning.strategy.worth_it_below(len)
            {
                if written == 1 && (len >= 8 || is_one_byte_repeated(literals)) {
                    return Ok((write_repeated(literals, out)?, Encoding::Rle));
                }
                write_compressed_header(header, encoding, is_single_stream, len, written);
                return Ok((header_len + written, encoding));
            }
        }
        Ok((write_raw(literals, out)?, Encoding::Basic))
    }

    /// A length of 1 can stand for literals that are all the same.
    fn compress_streams(
        &mut self,
        literals: &[u8],
        strategy: Strategy,
        has_few_matches: bool,
        is_single_stream: bool,
        out: &mut [u8],
    ) -> Result<Option<(usize, Encoding)>> {
        let len = literals.len();
        let prefers_reuse = strategy < Strategy::Lazy && len <= 1024;
        let repeat = |table: &Table, out: &mut [u8]| {
            let written = table.compress(literals, out, is_single_stream);
            Ok(written.map(|written| (written, Encoding::Repeat)))
        };

        if let Some(current) = self.complete().filter(|_| prefers_reuse) {
            return repeat(current, out);
        }
        if has_few_matches && looks_random(literals) {
            return Ok(None);
        }
        let histogram = Histogram::of(literals);
        if histogram.largest_count == len {
            return Ok(Some((1, Encoding::Rle)));
        }
        if is_too_even(histogram.largest_count, len) {
            return Ok(None);
        }
        let counts = histogram.used();
        let current = reusable(&self.current, self.reuse, counts);
        if let Some(current) = current.filter(|_| prefers_reuse) {
            return repeat(current, out);
        }

        let candidate = get_or_allocate(&mut self.candidate, || Table::EMPTY)?;
        candidate.build(counts, len, strategy >= Strategy::Ultra);
        let Ok(description_len) = candidate.describe(out) else {
            return Ok(None);
        };
        let is_too_long = description_len + 12 >= len;
        if let Some(current) = current {
            let new_len = description_len + candidate.compressed_len(counts);
            if current.compressed_len(counts) <= new_len || is_too_long {
                return repeat(current, out);
            }
        }
        if is_too_long {
            return Ok(None);
        }
        let out = out.get_mut(description_len..).ok_or(Error::Internal)?;
        let written = candidate.compress(literals, out, is_single_stream);
        Ok(written.map(|written| (description_len + written, Encoding::Compressed)))
    }

    /// `None` if there is a gain, but the table for it cannot be described.
    pub(crate) fn plan(
        &mut self,
        literals: &[u8],
        tuning: &Tuning,
    ) -> Result<Option<LiteralsPlan>> {
        let len = literals.len();
        let plain = |encoding| Ok(Some(LiteralsPlan::plain(encoding)));
        let too_few = if self.reuse == Reuse::Always { 6 } else { 63 };
        if !tuning.compresses_literals() || len <= too_few {
            return plain(Encoding::Basic);
        }
        let histogram = Histogram::of(literals);
        if histogram.largest_count == len {
            return plain(Encoding::Rle);
        }
        if is_too_even(histogram.largest_count, len) {
            return plain(Encoding::Basic);
        }

        let counts = histogram.used();
        let candidate = get_or_allocate(&mut self.candidate, || Table::EMPTY)?;
        candidate.build(counts, len, tuning.strategy >= Strategy::Ultra);
        let estimated_len = candidate.compressed_len(counts);
        let description = Description::of(candidate).ok();
        // One that there is no room for counts as -1.
        let description_len = description.as_ref().map_or(usize::MAX, |it| it.len);
        let new_len = estimated_len.wrapping_add(description_len);

        if let Some(current) = reusable(&self.current, self.reuse, counts) {
            let old_len = current.compressed_len(counts);
            if old_len < len && (old_len <= new_len || description_len.wrapping_add(12) >= len) {
                return Ok(Some(LiteralsPlan {
                    estimated_len: old_len,
                    ..LiteralsPlan::plain(Encoding::Repeat)
                }));
            }
        }
        if new_len >= len {
            return plain(Encoding::Basic);
        }
        Ok(description.map(|description| LiteralsPlan {
            encoding: Encoding::Compressed,
            description,
            estimated_len,
        }))
    }

    /// For a part of the literals of `plan`. Also tells whether later parts can repeat its table.
    pub(crate) fn write_part(
        &self,
        plan: &LiteralsPlan,
        literals: &[u8],
        describes_table: bool,
        out: &mut [u8],
    ) -> Result<Option<(usize, bool)>> {
        let len = literals.len();
        let table = match plan.encoding {
            Encoding::Rle if len != 0 => return Ok(Some((write_repeated(literals, out)?, false))),
            Encoding::Compressed if len != 0 => &self.candidate,
            Encoding::Repeat if len != 0 => &self.current,
            _ => return Ok(Some((write_raw(literals, out)?, false))),
        };
        let table = table.as_ref().ok_or(Error::Internal)?;

        // The header comes first, so it has room for the description as well.
        let header_len = compressed_header_len(len + if describes_table { 200 } else { 0 });
        let is_single_stream = header_len == 3;
        let (header, mut rest) = out
            .split_at_mut_checked(header_len)
            .ok_or(Error::DstSizeTooSmall)?;
        let (mut encoding, mut written) = (Encoding::Repeat, 0);
        if describes_table {
            plan.description.write(rest).ok_or(Error::DstSizeTooSmall)?;
            (encoding, written) = (Encoding::Compressed, plan.description.len);
            rest = rest.get_mut(written..).unwrap_or_default();
        }
        let Some(streams_len) = table.compress(literals, rest, is_single_stream) else {
            return Ok(None);
        };
        written += streams_len;
        if (!describes_table && written >= len) || header_len < compressed_header_len(written) {
            return Ok(Some((write_raw(literals, out)?, false)));
        }
        write_compressed_header(header, encoding, is_single_stream, len, written);
        Ok(Some((header_len + written, true)))
    }
}

#[test]
fn a_part_without_literals_is_raw() -> Result<()> {
    let plan = LiteralsPlan::plain(Encoding::Rle);
    let mut out = [0xFF; 2];
    let written = LiteralTables::EMPTY.write_part(&plan, &[], false, &mut out)?;
    assert_eq!((written, out), (Some((1, false)), [0, 0xFF]));
    Ok(())
}
