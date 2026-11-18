//! Running sequences with copies that go a little too far.

use core::cell::Cell;
use core::hint::{
    Locality, black_box, cold_path, prefetch_read, prefetch_write, select_unpredictable,
};

use crate::array::At;
use crate::destination::OVERSHOOT;
use crate::literals::LITERALS_PADDING;

const CHUNK: usize = 16;
const _: () = assert!(2 * CHUNK <= OVERSHOOT && 2 * CHUNK <= LITERALS_PADDING);

pub(super) const REPEATS: usize = 3;
/// The most room that is cleared ahead.
pub(super) const LOAN_MAX: usize = 16 << 10;

/// A sequence on its way from the reader to the copies. What is in memory takes no registers from them.
#[derive(Clone, Copy, Default)]
#[repr(C)]
pub(super) struct Slot {
    /// As in [`Sequence`](super::reader::Sequence). Those of the three slots before the next to run are the offsets to repeat.
    pub(super) offset: u32,
    pub(super) literal_len: u16,
    pub(super) match_len: u16,
    /// In the output and in the literals. The sequence before sets them.
    pub(super) position: u32,
    pub(super) literal_position: u32,
}

/// The offset that `code` stands for, unless that is 0. It makes it the first to repeat once it is in the next slot.
#[inline(always)]
pub(super) fn repeat_offset(
    code: i32,
    literal_len: usize,
    [third, second, first]: [&mut Slot; REPEATS],
) -> Option<u32> {
    let code = code.wrapping_add((literal_len == 0).into());
    let (old_first, old_second, old_third) = (first.offset, second.offset, third.offset);
    if code > 0 && old_first == 1 {
        cold_path();
        return None;
    }
    first.offset = select_unpredictable(code < -1, old_second, old_first);
    second.offset = select_unpredictable(code < 0, old_third, old_second);
    Some(select_unpredictable(
        code < 0,
        select_unpredictable(code < -1, old_first, old_second),
        select_unpredictable(code > 0, old_first.wrapping_sub(1), old_third),
    ))
}

#[inline(always)]
fn chunk_at<const N: usize>(bytes: &[u8], position: usize) -> Option<[u8; N]> {
    bytes.get(position..)?.first_chunk().copied()
}

#[inline(always)]
fn set_chunk<const N: usize>(bytes: &mut [u8], position: usize, chunk: [u8; N]) -> Option<()> {
    *bytes.get_mut(position..)?.first_chunk_mut()? = chunk;
    Some(())
}

/// `len` bytes and some more.
#[inline(always)]
fn copy_start(from: &[u8], to: &mut [u8], len: usize) -> Option<()> {
    let (first, mut from) = from.split_first_chunk::<CHUNK>()?;
    let (to_first, mut to) = to.split_first_chunk_mut()?;
    *to_first = *first;
    if len > CHUNK {
        cold_path();
        from = from.get(..len + CHUNK - 1)?;
        to = to.get_mut(..len + CHUNK - 1)?;
        let (to, from) = (to.as_chunks_mut::<{ 2 * CHUNK }>().0, from.as_chunks().0);
        // `zip()` is not inlined in hardened builds.
        for index in 0..to.len().min(from.len()) {
            let to = to.get_mut(index)?;
            prefetch_write(to.as_mut_ptr().wrapping_add(LOAN_MAX), Locality::L1);
            *to = *from.get(index)?;
            // Most are short: neither unrolling nor a call of `memcpy()` pays.
            black_box(());
        }
    }
    Some(())
}

/// For an `offset` of at least a chunk.
#[inline(always)]
fn copy_distant_match(
    out: &mut [u8],
    from: usize,
    offset: usize,
    start: usize,
    len: usize,
) -> Option<()> {
    #[inline(always)]
    fn copy(from: &[Cell<u8>; CHUNK], to: &[Cell<u8>; CHUNK]) {
        let mut bytes = [0; CHUNK];
        bytes
            .iter_mut()
            .zip(from)
            .for_each(|(byte, from)| *byte = from.get());
        bytes.iter().zip(to).for_each(|(byte, to)| to.set(*byte));
    }

    set_chunk(out, start, chunk_at::<CHUNK>(out, from)?)?;
    set_chunk(out, start + CHUNK, chunk_at::<CHUNK>(out, from + CHUNK)?)?;
    if len > 2 * CHUNK {
        let both = out.get_mut(from + 2 * CHUNK..start + len + 2 * CHUNK - 1)?;
        let both = Cell::from_mut(both).as_slice_of_cells();
        let to = both.get(offset..)?;
        let (from, to) = (both.get(..to.len())?.as_chunks().0, to.as_chunks().0);
        let (to, from) = (to.as_chunks().0, from.as_chunks().0);
        // Like in `copy_start()`.
        for index in 0..to.len().min(from.len()) {
            let ([to_0, to_1], [from_0, from_1]) = (to.get(index)?, from.get(index)?);
            prefetch_write(to_0[0].as_ptr().wrapping_add(LOAN_MAX), Locality::L1);
            copy(from_0, to_0);
            copy(from_1, to_1);
            black_box(());
        }
    }
    Some(())
}

/// How to repeat the bytes of a period of less than a chunk.
struct Period {
    /// For those among the first 8.
    mask: u64,
    /// Has a bit where each repetition starts.
    multiplier: u64,
    /// Where in the first 8 bytes the second 8 start, in bits.
    phase: u8,
    /// As many whole periods as a chunk holds.
    stride: u8,
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static PERIODS: [Period; CHUNK] = {
    let mut periods = [const {
        Period {
            mask: u64::MAX,
            multiplier: 1,
            phase: 0,
            stride: 1,
        }
    }; _];
    let mut len = 1;
    while len < CHUNK {
        periods[len].stride = (CHUNK - CHUNK % len) as u8;
        if len < 8 {
            periods[len].mask = (1 << (8 * len)) - 1;
            let mut start = len;
            while start < 8 {
                periods[len].multiplier |= 1 << (8 * start);
                start += len;
            }
            periods[len].phase = 8 * (8 % len) as u8;
        }
        len += 1;
    }
    periods
};

/// For an `offset` of less than a chunk.
#[inline(always)]
fn copy_close_match(
    out: &mut [u8],
    from: usize,
    offset: usize,
    start: usize,
    len: usize,
) -> Option<()> {
    let bytes = u128::from_le_bytes(chunk_at(out, from)?);
    let period = PERIODS.at(offset);
    let repeated = |bytes: u64| (bytes & period.mask).wrapping_mul(period.multiplier);
    let low = repeated(bytes as u64);
    set_chunk(out, start, low.to_le_bytes())?;
    if len > 8 {
        let high = if offset <= 8 {
            repeated(low.wrapping_shr(period.phase.into()))
        } else {
            let bits = 8 * offset as u32 - 64;
            (bytes >> 64) as u64 & !u64::MAX.wrapping_shl(bits) | low.wrapping_shl(bits)
        };
        let chunk = (u128::from(high) << 64 | u128::from(low)).to_le_bytes();
        let mut position = start as u32;
        while (position as usize) < start + len {
            set_chunk(out, position as usize, chunk)?;
            position = position.wrapping_add(period.stride.into());
        }
    }
    Some(())
}

/// If all of it, and the overshoot, is in the last `distance` bytes of `detached`.
#[inline(always)]
fn copy_detached_match(
    detached: &[u8],
    distance: usize,
    out: &mut [u8],
    start: usize,
    len: usize,
) -> Option<()> {
    let from = detached.get(detached.len().checked_sub(distance)?..)?;
    let from = from.get(..len + OVERSHOOT)?;
    copy_start(from, out.get_mut(start..)?, len)
}

/// What the copies go between.
pub(super) struct Buffers<'a> {
    literals: &'a [u8],
    /// Where the room for the overshoot starts.
    literals_limit: usize,
    /// The history before `out`.
    detached: &'a [u8],
    out: &'a mut [u8],
    /// Where the room for the overshoot starts.
    out_limit: usize,
}

impl<'a> Buffers<'a> {
    #[inline(always)]
    pub(super) fn new(literals: &'a [u8], detached: &'a [u8], out: &'a mut [u8]) -> Option<Self> {
        Some(Self {
            literals_limit: literals.len().checked_sub(LITERALS_PADDING)?,
            out_limit: out.len().checked_sub(OVERSHOOT)?,
            literals,
            detached,
            out,
        })
    }

    /// Returns `None` if `current` needs care. It can be run again then.
    #[inline(always)]
    pub(super) fn run(
        &mut self,
        repeats: [&mut Slot; REPEATS],
        current: &mut Slot,
        following: &mut Slot,
    ) -> Option<()> {
        let (literal_len, literal_start) = (
            current.literal_len.into(),
            current.literal_position as usize,
        );
        following.literal_position = (literal_start + literal_len) as u32;
        if literal_start + literal_len > self.literals_limit {
            cold_path();
            return None;
        }
        let (start, match_len) = (current.position as usize, usize::from(current.match_len));
        let match_start = start + literal_len;
        following.position = (match_start + match_len) as u32;
        if match_start + match_len > self.out_limit {
            cold_path();
            return None;
        }
        // For the next loan, which would wait for its memory with nothing else to do.
        prefetch_write(
            self.out.as_mut_ptr().wrapping_add(start + LOAN_MAX),
            Locality::L1,
        );
        copy_start(
            self.literals.get(literal_start..)?,
            self.out.get_mut(start..)?,
            literal_len,
        )?;

        if current.offset as i32 <= 0 {
            current.offset = repeat_offset(current.offset as i32, literal_len, repeats)?;
        }
        let offset = current.offset as usize;
        match match_start.checked_sub(offset) {
            Some(from) if offset >= CHUNK => {
                copy_distant_match(self.out, from, offset, match_start, match_len)
            }
            Some(from) => {
                cold_path();
                copy_close_match(self.out, from, offset, match_start, match_len)
            }
            None => {
                cold_path();
                copy_detached_match(
                    self.detached,
                    offset - match_start,
                    self.out,
                    match_start,
                    match_len,
                )
            }
        }
    }

    /// For a match that starts at `position`.
    #[inline(always)]
    pub(super) fn prefetch(&self, position: u32, offset: u32) {
        let detached_end = self.detached.as_ptr_range().end;
        let base = select_unpredictable(offset > position, detached_end, self.out.as_ptr());
        let from = base
            .wrapping_add(position as usize)
            .wrapping_sub(offset as usize);
        prefetch_read(from, Locality::L1);
        prefetch_read(from.wrapping_add(64), Locality::L1);
    }
}
