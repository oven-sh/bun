use super::Stop;
use crate::format::WINDOW_GAP;
use crate::{memory, transform};
use bun_core::vec::BorrowedCursor;

/// Past [`RingBuffer::limit`], for a word of the dictionary that starts before it and for copies that round up.
pub(super) const SLACK: usize = 64;
const MIN_SIZE: usize = 1024;
const GROWTH: usize = 64 * 1024;
/// A copy may spoil this many bytes after its end, which no distance reaches.
const CHUNK: usize = size_of::<u128>();
/// What a copy may spoil as long as the ring did not wrap, and nothing comes after the position.
pub(super) const WIDE_CHUNK: usize = 3 * CHUNK;
const _: () = assert!(CHUNK <= WINDOW_GAP && transform::ROOM <= SLACK && WIDE_CHUNK <= SLACK);

/// The window. It is no larger than what the meta-blocks so far need, and its bytes exist once decoding gets near them.
#[derive(Default)]
pub(super) struct RingBuffer {
    bytes: Vec<u8>,
    /// A power of two, or zero.
    size: usize,
    window_size: usize,
    pub(super) position: usize,
    flushed: usize,
    wrapped: bool,
    meta_block_end: usize,
}

impl RingBuffer {
    pub(super) fn set_window_bits(&mut self, window_bits: u32) {
        self.window_size = 1 << window_bits;
    }

    pub(super) fn size(&self) -> usize {
        self.size
    }

    /// What to add to the position to compare it with a distance.
    pub(super) fn earlier_laps(&self) -> usize {
        if self.wrapped { self.size } else { 0 }
    }

    /// Where decoding has to stop for [`flush`](Self::flush) or [`grow`](Self::grow).
    pub(super) fn limit(&self) -> usize {
        self.size.min(self.bytes.len().saturating_sub(SLACK))
    }

    pub(super) fn bytes_mut(&mut self) -> &mut [u8] {
        &mut self.bytes
    }

    pub(super) fn has_unflushed(&self) -> bool {
        self.flushed < self.position.min(self.size)
    }

    pub(super) fn is_at_window_end(&self) -> bool {
        self.position >= self.window_size
    }

    pub(super) fn begin_meta_block(
        &mut self,
        length: usize,
        whole_window: bool,
    ) -> memory::Result<()> {
        self.meta_block_end = self.position + length;
        let size = if whole_window {
            self.window_size
        } else {
            let needed = self.meta_block_end.max(self.size).max(MIN_SIZE);
            needed.next_power_of_two().min(self.window_size)
        };
        if size != self.size {
            self.bytes.truncate(self.position);
            memory::try_reserve_total(&mut self.bytes, size + SLACK)?;
            self.size = size;
        }
        Ok(())
    }

    /// Moves the limit past the position, unless that is at the end.
    pub(super) fn grow(&mut self) {
        if self.position < self.limit() {
            return;
        }
        let mut limit = self.position + GROWTH;
        if self.position <= self.meta_block_end {
            limit = limit.min(self.meta_block_end + 1);
        }
        memory::resize(&mut self.bytes, limit.min(self.size) + SLACK, 0);
    }

    /// Appends what fits before the end, and returns how much that is.
    pub(super) fn append(&mut self, bytes: &[u8]) -> Result<usize, Stop> {
        let (bytes, _) = bytes.split_at(bytes.len().min(self.size - self.position));
        let existing = self
            .bytes
            .get_mut(self.position..)
            .ok_or(Stop::UNREACHABLE)?;
        let (overwrites, extends) = bytes.split_at(bytes.len().min(existing.len()));
        existing
            .split_at_mut(overwrites.len())
            .0
            .copy_from_slice(overwrites);
        self.bytes.extend_from_slice(extends);
        self.position += bytes.len();
        Ok(bytes.len())
    }

    /// Copies up to `length` bytes, as far as neither end wraps, and returns how many.
    pub(super) fn copy_part(&mut self, distance: usize, length: usize) -> Result<usize, Stop> {
        let source = self.position.wrapping_sub(distance) & (self.size - 1);
        let length = length
            .min(self.limit() - self.position)
            .min(self.size - source);
        copy(&mut self.bytes, source, self.position, distance, length).ok_or(Stop::UNREACHABLE)?;
        self.position += length;
        Ok(length)
    }

    /// Wraps around once everything up to the end of the window is out.
    pub(super) fn flush(&mut self, output: &mut BorrowedCursor<'_, u8>) -> Result<(), Stop> {
        if !self.has_unflushed() {
            return Ok(());
        }
        let end = self.position.min(self.size);
        let unflushed = self.bytes.get(self.flushed..end).ok_or(Stop::UNREACHABLE)?;
        self.flushed += memory::append_what_fits(output, unflushed);
        if self.flushed < end {
            return Err(Stop::NeedsOutput);
        }
        if self.is_at_window_end() {
            memory::resize(&mut self.bytes, self.size + SLACK, 0);
            self.bytes.copy_within(self.size..self.position, 0);
            self.position -= self.size;
            self.flushed = 0;
            self.wrapped = true;
        }
        Ok(())
    }
}

#[inline(always)]
pub(super) fn copy_chunk<const N: usize>(
    bytes: &mut [u8],
    source: usize,
    target: usize,
) -> Option<()> {
    let chunk: [u8; N] = *bytes.get(source..)?.first_chunk()?;
    *bytes.get_mut(target..)?.first_chunk_mut()? = chunk;
    Some(())
}

/// As if byte by byte. Neither range wraps. Fails if `distance` is zero.
#[inline(always)]
pub(super) fn copy(
    bytes: &mut [u8],
    source: usize,
    target: usize,
    distance: usize,
    length: usize,
) -> Option<()> {
    if distance < length {
        core::hint::cold_path();
        if distance < CHUNK || length > 2 * CHUNK {
            return repeat(bytes, source, target, distance, length);
        }
    }
    copy_chunk::<CHUNK>(bytes, source, target)?;
    if length > CHUNK {
        if length <= 2 * CHUNK {
            copy_chunk::<CHUNK>(bytes, source + CHUNK, target + CHUNK)?;
        } else {
            copy_long(bytes, source, target, length)?;
        }
    }
    Some(())
}

/// The first `length` bytes of `source`.
#[inline(always)]
pub(super) fn copy_from(
    source: &[u8],
    bytes: &mut [u8],
    target: usize,
    length: usize,
) -> Option<()> {
    let target = bytes.get_mut(target..)?;
    match source.first_chunk::<CHUNK>() {
        Some(chunk) if length <= CHUNK => *target.first_chunk_mut()? = *chunk,
        _ => target
            .get_mut(..length)?
            .copy_from_slice(source.get(..length)?),
    }
    Some(())
}

#[inline(never)]
fn copy_long(bytes: &mut [u8], source: usize, target: usize, length: usize) -> Option<()> {
    bytes.get(source.max(target)..)?.get(..length)?;
    bytes.copy_within(source..source + length, target);
    Some(())
}

#[inline(never)]
fn repeat(
    bytes: &mut [u8],
    source: usize,
    target: usize,
    period: usize,
    length: usize,
) -> Option<()> {
    /// What keeps the first `period` bytes, what to multiply them by to fill a chunk, and how far whole periods go.
    #[allow(clippy::indexing_slicing)] // Runs at compile time.
    static BY_PERIOD: [(u128, u128, usize); CHUNK] = {
        let mut all = [(0, 0, 0); CHUNK];
        let mut period = 1;
        while period < CHUNK {
            let (mask, mut at) = ((1 << (8 * period)) - 1, 0);
            all[period] = (mask, 0, CHUNK - CHUNK % period);
            while at < CHUNK {
                all[period].1 |= 1 << (8 * at);
                at += period;
            }
            period += 1;
        }
        all
    };
    if period == 0 {
        return None;
    }
    let Some(&(mask, multiplier, step)) = BY_PERIOD.get(period) else {
        return (0..length)
            .step_by(CHUNK)
            .try_for_each(|offset| copy_chunk::<CHUNK>(bytes, source + offset, target + offset));
    };
    let chunk = u128::from_le_bytes(*bytes.get(source..)?.first_chunk()?);
    let pattern = (chunk & mask).wrapping_mul(multiplier).to_le_bytes();
    let mut at = target;
    while at < target + length {
        *bytes.get_mut(at..)?.first_chunk_mut()? = pattern;
        at += step;
    }
    Some(())
}
