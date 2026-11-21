//! Readers of bitstreams.

use crate::bounded::Bounded;
use crate::error::{Error, Result};

/// A number of bits. The compiler knows that it can shift by it.
#[derive(Clone, Copy)]
#[repr(u8)]
#[rustfmt::skip]
pub(crate) enum Width {
    W0, W1, W2, W3, W4, W5, W6, W7, W8, W9, W10, W11, W12, W13, W14, W15,
    W16, W17, W18, W19, W20, W21, W22, W23, W24, W25, W26, W27, W28, W29, W30, W31,
}

impl Width {
    #[inline(always)]
    #[rustfmt::skip]
    pub(crate) const fn new(bits: u32) -> Self {
        use Width::*;
        match bits % 32 {
            0 => W0, 1 => W1, 2 => W2, 3 => W3, 4 => W4, 5 => W5, 6 => W6, 7 => W7,
            8 => W8, 9 => W9, 10 => W10, 11 => W11, 12 => W12, 13 => W13, 14 => W14, 15 => W15,
            16 => W16, 17 => W17, 18 => W18, 19 => W19, 20 => W20, 21 => W21, 22 => W22, 23 => W23,
            24 => W24, 25 => W25, 26 => W26, 27 => W27, 28 => W28, 29 => W29, 30 => W30, _ => W31,
        }
    }
}

/// The 8 bytes of `src` from `start` on. Zeros follow its end.
#[inline(always)]
pub(crate) fn load_from(src: &[u8], start: usize) -> u64 {
    #[cold]
    #[inline(never)]
    fn padded(src: &[u8], start: usize) -> u64 {
        let bytes = src.get(start..).unwrap_or_default();
        (bytes.iter().rev()).fold(0, |word, &byte| word << 8 | u64::from(byte))
    }

    match src.get(start..).and_then(<[u8]>::first_chunk) {
        Some(bytes) => u64::from_le_bytes(*bytes),
        None => padded(src, start),
    }
}

/// How many bits of `src` are below the mark that ends the stream at its end, which starts at byte `start`.
#[inline(always)]
pub(crate) fn bits_below_mark(src: &[u8], start: usize) -> Result<usize> {
    match src.get(start..) {
        Some(&[.., last @ 1..=u8::MAX]) => Ok(8 * (src.len() - 1) + last.ilog2() as usize),
        _ => Err(Error::CorruptionDetected),
    }
}

/// Reads a stream from its last bit to its first. What it reads beyond the first means nothing.
#[derive(Clone, Copy)]
pub(crate) struct BackwardBits<'a> {
    pub(crate) src: &'a [u8],
    /// Where in `src` the bytes in `container` start.
    pub(crate) position: usize,
    pub(crate) container: u64,
    /// The low bits of `container` that are yet to be read.
    pub(crate) available: isize,
    /// Where in `src` the stream starts.
    pub(crate) start: usize,
}

/// The first bytes of a source, behind [`BackwardBits::PADDING`].
pub(crate) type PaddedStart = [u8; BackwardBits::PADDING + 32];

impl<'a> BackwardBits<'a> {
    /// What [`Self::refill`] makes available, if there are as many.
    pub(crate) const IN_REFILL: u32 = 56;

    /// With as many bytes in front of it, a stream is over before a refill goes below the start of `src`.
    pub(crate) const PADDING: usize = 8;

    /// For the stream in `src[start..]`.
    #[inline(always)]
    pub(crate) fn new(src: &'a [u8], start: usize) -> Result<Self> {
        let position = src.len().saturating_sub(8);
        Ok(Self {
            src,
            position,
            container: load_from(src, position),
            available: (bits_below_mark(src, start)? - 8 * position) as isize,
            start,
        })
    }

    #[inline(always)]
    pub(crate) fn read(&mut self, count: u32) -> u64 {
        self.available = self.available.minus(count as isize);
        self.container.wrapping_shr(self.available as u32) & !u64::MAX.wrapping_shl(count)
    }

    #[inline(always)]
    pub(crate) fn refill(&mut self) {
        let bytes = self
            .position
            .min(63isize.minus(self.available) as usize / 8);
        self.position -= bytes;
        self.available = self.available.plus(8 * bytes as isize);
        self.container = load_from(self.src, self.position);
    }

    #[inline(always)]
    pub(crate) fn is_padded(&self) -> bool {
        self.start >= Self::PADDING
    }

    pub(crate) fn pad_start(&self, padded: &mut PaddedStart) {
        (padded.iter_mut().skip(Self::PADDING).zip(self.src)).for_each(|(to, from)| *to = *from);
    }

    /// Goes on in what [`Self::pad_start`] filled, once that has all that is left.
    #[inline(always)]
    pub(crate) fn move_to(&mut self, padded: &'a PaddedStart) {
        if !self.is_padded() && Self::PADDING + self.position + 8 <= padded.len() {
            self.src = padded;
            self.position += Self::PADDING;
            self.start += Self::PADDING;
            self.refill();
        }
    }

    /// How many bits of the stream are yet to be read. Negative once more were read than it has.
    #[inline(always)]
    pub(crate) fn left(&self) -> isize {
        let bytes = (self.position as isize).minus(self.start as isize);
        bytes.times(8).plus(self.available)
    }
}
