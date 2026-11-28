use super::Stop;
use crate::{DecodeError, memory, transform};
use bun_core::vec::BorrowedCursor;
/// What a copy may spoil after its end, and where a word of the dictionary ends that starts before [`RingBuffer::limit`].
pub(super) use bun_highway::brotli_decoder::SLACK;
use bun_highway::brotli_decoder::{Destination, SPOILT, extend_unzeroed};

const MIN_SIZE: usize = 1024;
const GROWTH: usize = 64 * 1024;
const CHUNK: usize = size_of::<u128>();
pub(super) const WIDE_CHUNK: usize = 3 * CHUNK;
const _: () = assert!(transform::ROOM <= SLACK && WIDE_CHUNK <= SLACK);
const ENDLESS: usize = 1 << 62;

/// The window. It is no larger than what the meta-blocks so far need, and its bytes exist once decoding gets near them.
#[derive(Default)]
pub(super) struct RingBuffer {
    bytes: Vec<u8>,
    /// How much it holds until there is room for output: a power of two, or zero.
    size: usize,
    window_size: usize,
    pub(super) position: usize,
    /// Below zero in the last lap.
    flushed: isize,
    full_at: usize,
    wrapped: bool,
    meta_block_end: usize,
    /// Where position zero is in `bytes`.
    origin: usize,
    lent: Option<Lent>,
}

/// `bytes` is the output, which makes a window that never wraps.
#[derive(Clone, Copy)]
struct Lent {
    start: usize,
    max_len: usize,
    input_len: usize,
    /// How much has to be written until it is time to guess the length again.
    next_guess: usize,
    times_full: u32,
}

impl RingBuffer {
    /// For a stream of about `input_len` bytes. No meta-block begins that would make it longer than `max_len`.
    pub(super) fn begin_in(&mut self, output: &mut Vec<u8>, max_len: usize, input_len: usize) {
        let start = output.len();
        self.swap_bytes(output);
        (self.size, self.full_at, self.origin) = (ENDLESS, ENDLESS, start);
        self.lent = Some(Lent {
            start,
            max_len,
            input_len,
            next_guess: 2 * GROWTH,
            times_full: 0,
        });
    }

    pub(super) fn give_back(&mut self, output: &mut Vec<u8>) {
        self.swap_bytes(output);
        output.truncate(self.origin + self.position);
    }

    /// While they do not matter.
    pub(super) fn swap_bytes(&mut self, other: &mut Vec<u8>) {
        core::mem::swap(&mut self.bytes, other);
    }

    /// After [`give_back`](Self::give_back), becomes what it would be if all of that had been flushed.
    pub(super) fn go_on_after(&mut self, output: &[u8], whole_window: bool) -> memory::Result<()> {
        let total = output.len() - self.lent.map_or(0, |lent| lent.start);
        let kept = total.min(self.window_size);
        let has_begun = self.meta_block_end != 0;
        let rest = self.meta_block_end.saturating_sub(self.position);
        self.bytes.clear();
        *self = Self {
            bytes: core::mem::take(&mut self.bytes),
            window_size: self.window_size,
            position: kept,
            flushed: kept as isize,
            ..Self::default()
        };
        if has_begun {
            self.resize_for(rest, whole_window)?;
            (self.bytes).extend_from_slice(output.split_at(output.len() - kept).1);
            if kept == self.window_size {
                self.full_at += kept - total % kept;
            }
            self.extend();
        }
        Ok(())
    }

    pub(super) fn set_window_bits(&mut self, window_bits: u32) {
        self.window_size = 1 << window_bits;
    }

    /// Longer than the window, so that nothing is spoilt that a distance reaches.
    fn lap(&self) -> usize {
        self.size + SPOILT
    }

    /// What to add to the position to compare it with a distance, and where the bytes before position zero end.
    pub(super) fn last_lap(&self) -> usize {
        if self.wrapped { self.lap() } else { 0 }
    }

    fn end(&self) -> usize {
        self.full_at.min(self.lap())
    }

    pub(super) fn room(&self) -> usize {
        self.end() - self.position
    }

    /// Where decoding has to stop for [`flush`](Self::flush) or [`grow`](Self::grow).
    pub(super) fn limit(&self) -> usize {
        (self.end()).min(self.bytes.len().saturating_sub(self.origin + SLACK))
    }

    pub(super) fn bytes_mut(&mut self) -> &mut [u8] {
        self.bytes.get_mut(self.origin..).unwrap_or_default()
    }

    pub(super) fn unflushed_len(&self) -> usize {
        match self.lent {
            None => (self.position.min(self.full_at) as isize - self.flushed) as usize,
            Some(_) => 0,
        }
    }

    pub(super) fn destination(&self, output: &mut BorrowedCursor<'_, u8>) -> Destination {
        Destination::new(output, self.flushed)
    }

    pub(super) fn is_lent(&self) -> bool {
        self.lent.is_some()
    }

    pub(super) fn is_full(&self) -> bool {
        self.position >= self.full_at
    }

    pub(super) fn has_final_size(&self) -> bool {
        self.size >= self.window_size
    }

    pub(super) fn begin_meta_block(
        &mut self,
        length: usize,
        whole_window: bool,
        refusal: DecodeError,
    ) -> Result<(), Stop> {
        match self.lent {
            None => (self.resize_for(length, whole_window)).map_err(|_| refusal.into()),
            Some(lent) if length > lent.max_len - (self.origin + self.position) => {
                Err(Stop::NeedsOutput)
            }
            Some(_) => {
                // Positions stay within 32 bits.
                if let Some(unreachable) = self.position.checked_sub(1 << 30) {
                    self.origin += unreachable;
                    self.position -= unreachable;
                }
                self.meta_block_end = self.position + length;
                Ok(())
            }
        }
    }

    fn resize_for(&mut self, length: usize, whole_window: bool) -> memory::Result<()> {
        self.meta_block_end = self.position + length;
        let size = if whole_window {
            self.window_size
        } else {
            let needed = self.meta_block_end.max(self.size).max(MIN_SIZE);
            needed.next_power_of_two().min(self.window_size)
        };
        let wraps = size == self.window_size;
        let capacity = size + SPOILT * usize::from(wraps) + SLACK;
        if capacity > self.bytes.capacity() {
            self.bytes.truncate(self.position);
            memory::try_reserve_total(&mut self.bytes, capacity)?;
        }
        if size != self.size {
            (self.size, self.full_at) = (size, size);
        }
        Ok(())
    }

    /// Of the output, for `wanted` more bytes. `unread` is what is left of the input, unless this is the last meta-block.
    pub(super) fn make_room(&mut self, wanted: usize, unread: Option<usize>) -> Result<(), Stop> {
        const MAX_AHEAD: usize = 32 << 20;
        const MAX_RATIO: f64 = 128.0;
        let Some(lent) = &mut self.lent else {
            return Ok(());
        };
        let [len, end] = [self.position, self.meta_block_end].map(|at| self.origin + at);
        let (needed, written) = ((len + wanted).min(end), len - lent.start);
        let credible = lent.input_len.max(written).saturating_mul(32);
        let credible = len.saturating_add(credible.max(self.window_size));
        let (end, is_credible) = (end.min(credible), end <= credible);
        let capacity = self.bytes.capacity().saturating_sub(1 + SLACK);
        let fits = needed <= capacity && capacity != 0;
        let guess = match unread {
            _ if fits && written < lent.next_guess => return Ok(()),
            None if fits && (capacity >= end || !is_credible) => return Ok(()),
            None => end,
            Some(_) if written == 0 => {
                (end.min(len + 2 * GROWTH)).max(lent.max_len.min(len + lent.input_len))
            }
            Some(unread) => {
                lent.next_guess = 2 * written;
                let ratio = written as f64 / (lent.input_len - unread) as f64;
                let more = ((unread as f64 * ratio.min(MAX_RATIO)) as usize).min(256 * written);
                let percent = |n| end.max(lent.max_len.min((len + more) / 100 * n));
                let will_do =
                    percent(if ratio > 1.0 { 107 } else { 100 }).min(MAX_AHEAD)..=percent(140);
                // Moving is only cheap at first.
                if fits && (more < 3 * len || will_do.contains(&capacity)) {
                    return Ok(());
                }
                lent.times_full += u32::from(!fits);
                // The first time there was nothing to go by, and the second time there was little.
                let doubled = if lent.times_full > 2 { 2 * len } else { 0 };
                percent(120).max(doubled.min(lent.max_len))
            }
        };
        let moved = [2 * len + MAX_AHEAD, 2 * len, len + len / 8]
            .into_iter()
            .find_map(|most| memory::empty(guess.min(most).max(needed) + 1 + SLACK).ok());
        let mut moved = moved.ok_or(DecodeError::AllocRingBuffer2)?;
        moved.extend_from_slice(self.bytes.get(..len).ok_or(Stop::UNREACHABLE)?);
        self.bytes = moved;
        Ok(())
    }

    /// Moves the limit past the position, unless the ring is full.
    pub(super) fn grow(&mut self, unread: Option<usize>) -> Result<(), Stop> {
        if let Some(position) = self.position.checked_sub(self.lap()) {
            let lap = self.lap();
            extend_unzeroed(&mut self.bytes, lap + SLACK);
            self.bytes.copy_within(lap..self.position, 0);
            self.position = position;
            self.flushed -= lap as isize;
            self.full_at -= lap;
            self.wrapped = true;
        }
        if self.position >= self.limit() {
            self.make_room(1, unread)?;
            self.extend();
        }
        Ok(())
    }

    fn extend(&mut self) {
        let mut limit = self.position + GROWTH;
        if self.position <= self.meta_block_end {
            limit = limit.min(self.meta_block_end + 1);
        }
        let len = self.origin + limit.min(self.lap()) + SLACK;
        extend_unzeroed(&mut self.bytes, len);
    }

    /// Appends what fits before the end, and returns how much that is.
    pub(super) fn append(&mut self, bytes: &[u8]) -> Result<usize, Stop> {
        let at = self.origin + self.position;
        let room = self
            .room()
            .min(self.bytes.capacity().saturating_sub(at + SLACK));
        let (bytes, _) = bytes.split_at(bytes.len().min(room));
        let existing = self.bytes.get_mut(at..).ok_or(Stop::UNREACHABLE)?;
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
        let target = self.position;
        let length = length.min(self.limit() - target);
        let (source, length) = source_of(target, distance, length, self.last_lap());
        copy(self.bytes_mut(), source, target, distance, length).ok_or(Stop::UNREACHABLE)?;
        self.position += length;
        Ok(length)
    }

    pub(super) fn flush(&mut self, output: &mut BorrowedCursor<'_, u8>) -> Result<(), Stop> {
        if self.unflushed_len() == 0 {
            return Ok(());
        }
        if self.flushed < 0 {
            let unflushed = self.lap().wrapping_add_signed(self.flushed)..self.lap();
            let unflushed = self.bytes.get(unflushed).ok_or(Stop::UNREACHABLE)?;
            self.flushed += memory::append_what_fits(output, unflushed) as isize;
        }
        let start = usize::try_from(self.flushed).map_err(|_| Stop::NeedsOutput)?;
        let unflushed = self.bytes.get(start..self.position.min(self.full_at));
        let unflushed = unflushed.ok_or(Stop::UNREACHABLE)?;
        let flushed = memory::append_what_fits(output, unflushed);
        self.flushed += flushed as isize;
        if flushed < unflushed.len() {
            return Err(Stop::NeedsOutput);
        }
        if self.is_full() && self.has_final_size() {
            self.full_at += self.size;
        }
        Ok(())
    }
}

/// And how much of `length` there is before it wraps. `distance` is within the window.
#[inline(always)]
pub(super) fn source_of(
    target: usize,
    distance: usize,
    length: usize,
    last_lap: usize,
) -> (usize, usize) {
    match target.checked_sub(distance) {
        Some(source) => (source, length),
        None => (target + last_lap - distance, length.min(distance - target)),
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
    const SOON_COPIED: usize = 256;
    if period == 0 {
        return None;
    }
    if let Some(rest @ 1..) = length.checked_sub(SOON_COPIED) {
        repeat(bytes, source, target, period, SOON_COPIED)?;
        let (mut at, end) = (target + SOON_COPIED, target + SOON_COPIED + rest);
        let mut whole_periods = (SOON_COPIED / period + 1) * period;
        while at < end {
            let part = whole_periods.min(end - at);
            copy_long(bytes, at - whole_periods, at, part)?;
            at += part;
            whole_periods <<= u32::from(whole_periods < 4096);
        }
        return Some(());
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
