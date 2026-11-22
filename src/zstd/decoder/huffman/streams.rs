//! Readers of streams of literals.

use core::hint::{Locality, prefetch_write};

use super::QUICK_LOG;
use crate::bits::load_from;
use crate::error::{Error, Result};

/// The lookups from one load to the next. What a load gives is enough for one more, so that it does not have to wait.
pub(super) const LOOKUPS: usize = 4;
const _: () = assert!((LOOKUPS as u32 + 1) * QUICK_LOG <= 56);

/// A stream on its own.
#[derive(Clone, Copy)]
pub(super) struct Stream {
    /// The next bit is the highest.
    pub(super) bits: u64,
    /// How many bits of the source are below those that were read.
    pub(super) position: usize,
}

impl Stream {
    /// Zeros are below the start of `src`.
    #[inline(always)]
    pub(super) fn new(src: &[u8], position: usize) -> Self {
        let bits = Self::load(src, position).unwrap_or_else(|| {
            load_from(src, 0).unbounded_shl(64u32.wrapping_sub(position as u32))
        });
        Self { bits, position }
    }

    /// At least 57 bits below `position`, if `src` has them.
    #[inline(always)]
    pub(super) fn load(src: &[u8], position: usize) -> Option<u64> {
        let start = (position.wrapping_add(7) / 8).wrapping_sub(8);
        let bytes = src.get(start..)?.first_chunk()?;
        Some(u64::from_le_bytes(*bytes) << (position.wrapping_neg() % 8))
    }

    /// Fills `out`, however close to the start of `src`. `look_up` returns the next symbol and the length of its code.
    #[inline(always)]
    pub(super) fn decode_carefully(
        &mut self,
        src: &[u8],
        out: &mut [u8],
        look_up: impl Fn(u64) -> Option<(u8, u8)>,
    ) -> Result<()> {
        for round in out.chunks_mut(LOOKUPS) {
            *self = Self::new(src, self.position);
            for to in round {
                let (symbol, length) = look_up(self.bits).ok_or(Error::Internal)?;
                *to = symbol;
                self.skip(length);
            }
        }
        Ok(())
    }

    #[inline(always)]
    pub(super) fn skip(&mut self, length: u8) {
        self.bits = self.bits.wrapping_shl(length.into());
        self.position = self.position.wrapping_sub(length.into());
    }
}

/// An index of 8 bits, and the 8 bytes that start there.
const WINDOW_LEN: usize = 255 + 8;
type Window = [u8; WINDOW_LEN];

/// In which loads need no check. Zeros are below the start of the source.
pub(super) struct Windows<'a> {
    src: &'a [u8],
    padded_start: [Window; 2],
}

impl<'a> Windows<'a> {
    #[inline(always)]
    pub(super) fn new(src: &'a [u8]) -> Self {
        let mut padded_start = [[0; _]; _];
        let len = src.len().min(WINDOW_LEN);
        if let (Some(to), Some(from)) = (padded_start[1].get_mut(..len), src.get(..len)) {
            to.copy_from_slice(from);
        }
        Self { src, padded_start }
    }

    #[inline(always)]
    fn before(&self, end: usize) -> Option<&Window> {
        match end.checked_sub(WINDOW_LEN) {
            Some(start) => self.src.get(start..)?.first_chunk(),
            None => self.padded_start.as_flattened().get(end..)?.first_chunk(),
        }
    }
}

/// One of four streams, whose position takes no register between loads.
#[derive(Clone, Copy)]
pub(super) struct Lane {
    /// The next bit is the highest. The lowest that is set was the lowest of the load.
    bits: u64,
    /// Of the last load, in the source.
    end: usize,
}

impl Lane {
    #[inline(always)]
    pub(super) fn new(windows: &Windows<'_>, position: usize) -> Option<Self> {
        let end = position.div_ceil(8);
        let bytes = windows.before(end)?.last_chunk()?;
        let bits = (u64::from_le_bytes(*bytes) | 1) << (8 * end - position);
        Some(Self { bits, end })
    }

    #[inline(always)]
    pub(super) fn position(self) -> Option<usize> {
        (8 * self.end).checked_sub(self.bits.trailing_zeros() as usize)
    }
}

/// The most rounds of [`LOOKUPS`] in a window.
pub(super) const ROUNDS_MAX: usize = 32;
const _: () = assert!(7 + ROUNDS_MAX * LOOKUPS * QUICK_LOG as usize <= 8 * 255);

/// `find` returns the row for the next bits and how many it takes. `write` gets the lane, round, lookup and row.
#[inline(always)]
pub(super) fn interleave(
    windows: &Windows<'_>,
    lanes: &mut [Lane; 4],
    rounds: usize,
    find: impl Fn(u64) -> (usize, u8),
    mut write: impl FnMut(usize, usize, usize, usize),
) -> Result<()> {
    let window = |lane: &Lane| windows.before(lane.end).ok_or(Error::Internal);
    let [a, b, c, d] = &*lanes;
    let windows = [window(a)?, window(b)?, window(c)?, window(d)?];
    let mut bits = [a.bits, b.bits, c.bits, d.bits];
    let mut starts = [255usize; 4];
    for round in 0..rounds.min(ROUNDS_MAX) {
        macro_rules! first_lookup {
            ($($lane:literal)*) => {$(
                let used = bits[$lane].trailing_zeros();
                starts[$lane] = starts[$lane].wrapping_sub(used as usize / 8);
                let bytes = windows[$lane].get(starts[$lane] % 256..).and_then(<[u8]>::first_chunk);
                let loaded = u64::from_le_bytes(*bytes.ok_or(Error::Internal)?) | 1;
                let (row, length) = find(bits[$lane]);
                bits[$lane] = loaded.wrapping_shl(used % 8 + u32::from(length));
                write($lane, round, 0, row);
            )*};
        }
        macro_rules! lookup {
            ($lookup:literal: $($lane:literal)*) => {$(
                let (row, length) = find(bits[$lane]);
                bits[$lane] = bits[$lane].wrapping_shl(length.into());
                write($lane, round, $lookup, row);
            )*};
        }
        first_lookup!(0 1 2 3);
        lookup!(1: 0 1 2 3);
        lookup!(2: 0 1 2 3);
        lookup!(3: 0 1 2 3);
    }
    for ((lane, &bits), &start) in lanes.iter_mut().zip(&bits).zip(&starts) {
        let end = lane.end.checked_sub(255usize.wrapping_sub(start));
        (lane.bits, lane.end) = (bits, end.ok_or(Error::CorruptionDetected)?);
    }
    Ok(())
}

/// Out of line, or the compiler makes it one with copies whose length it knows.
#[inline(never)]
fn copy_some(from: &[u8], to: &mut [u8], len: usize) {
    if let (Some(from), Some(to)) = (from.get(..len), to.get_mut(..len)) {
        to.copy_from_slice(from);
    }
}

#[inline(always)]
pub(super) fn prefetch(start: *const u8, len: usize) {
    const LINE_LEN: usize = 64;
    for line in (0..len).step_by(LINE_LEN) {
        prefetch_write(start.wrapping_add(line).cast_mut(), Locality::L1);
    }
}

/// Moves the first `len` bytes of `stage` to `out`, and `out` on.
#[inline(always)]
pub(super) fn unload<const N: usize>(
    stage: &[[u8; 128]; N],
    len: usize,
    out: &mut &mut [u8],
) -> Result<()> {
    let room = core::mem::take(out);
    if let Some(chunks) = room.as_chunks_mut().0.first_chunk_mut::<N>() {
        chunks
            .iter_mut()
            .zip(stage)
            .for_each(|(to, from)| *to = *from);
    } else {
        copy_some(stage.as_flattened(), room, len);
    }
    *out = room.get_mut(len..).ok_or(Error::Internal)?;
    Ok(())
}
