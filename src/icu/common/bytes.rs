//! Typed views of ICU's data: slices of byte arrays in native byte order, decoded on access by one unaligned load.

use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, UErrorCode};
use std::marker::PhantomData;
use std::ops::{Range, RangeFrom};

pub(crate) const U_IS_BIG_ENDIAN: u8 = cfg!(target_endian = "big") as u8;

/// Returns the two halves of a `uint32_t`, in memory order.
pub(crate) const fn u16_halves(word: u32) -> [u16; 2] {
    let [a, b, c, d] = word.to_ne_bytes();
    [u16::from_ne_bytes([a, b]), u16::from_ne_bytes([c, d])]
}

/// Returns the header of a trie as 16-bit units.
pub(crate) const fn u16_array(bytes: &[u8; 16]) -> [u16; 8] {
    let [a, b, c, d, e, f, g, h, i, j, k, l, m, n, o, p] = *bytes;
    [
        u16::from_ne_bytes([a, b]),
        u16::from_ne_bytes([c, d]),
        u16::from_ne_bytes([e, f]),
        u16::from_ne_bytes([g, h]),
        u16::from_ne_bytes([i, j]),
        u16::from_ne_bytes([k, l]),
        u16::from_ne_bytes([m, n]),
        u16::from_ne_bytes([o, p]),
    ]
}

/// An integer of `N` bytes.
pub(crate) trait Word<const N: usize>: Copy + Default {
    fn from_bytes(bytes: &[u8; N]) -> Self;
}

macro_rules! words {
    ($($int:ident $size:literal,)*) => {$(
        impl Word<$size> for $int {
            #[inline(always)]
            fn from_bytes(bytes: &[u8; $size]) -> Self {
                Self::from_ne_bytes(*bytes)
            }
        }
    )*};
}

words!(u8 1, u16 2, u32 4, i32 4, u64 8,);

pub(crate) type U16s<'a> = View<'a, u16, 2>;
pub(crate) type U32s<'a> = View<'a, u32, 4>;
pub(crate) type I32s<'a> = View<'a, i32, 4>;
pub(crate) type U64s<'a> = View<'a, u64, 8>;

/// The argument of `View::slice`: `start..end` or `start..`.
pub(crate) trait ViewRange {
    fn with_len(self, len: usize) -> Range<usize>;
}

impl ViewRange for Range<usize> {
    #[inline(always)]
    fn with_len(self, _: usize) -> Range<usize> {
        self
    }
}

impl ViewRange for RangeFrom<usize> {
    #[inline(always)]
    fn with_len(self, len: usize) -> Range<usize> {
        self.start..len.max(self.start)
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct View<'a, T, const N: usize>(&'a [[u8; N]], PhantomData<T>);

impl<'a, T: Word<N> + 'a, const N: usize> View<'a, T, N> {
    pub(crate) const EMPTY: Self = Self(&[], PhantomData);

    /// Ignores an incomplete last element.
    #[inline(always)]
    pub(crate) const fn of(bytes: &'a [u8]) -> Self {
        Self::from_chunks(bytes.as_chunks().0)
    }

    #[inline(always)]
    pub(crate) const fn from_chunks(chunks: &'a [[u8; N]]) -> Self {
        Self(chunks, PhantomData)
    }

    /// Returns `count` elements from byte `offset`, or `U_INVALID_FORMAT_ERROR` if `bytes` is too short.
    pub(crate) fn from_offset(
        bytes: &'a [u8],
        offset: usize,
        count: usize,
    ) -> Result<Self, UErrorCode> {
        Self::try_from_offset(bytes, offset, count).ok_or(U_INVALID_FORMAT_ERROR)
    }

    /// Like `from_offset`, usable in constants.
    pub(crate) const fn try_from_offset(
        bytes: &'a [u8],
        offset: usize,
        count: usize,
    ) -> Option<Self> {
        if let Some((_, rest)) = bytes.split_at_checked(offset)
            && let Some((chunks, _)) = rest.as_chunks().0.split_at_checked(count)
        {
            Some(Self::from_chunks(chunks))
        } else {
            None
        }
    }

    #[inline(always)]
    pub(crate) const fn len(self) -> usize {
        self.0.len()
    }

    #[inline(always)]
    pub(crate) fn is_empty(self) -> bool {
        self.0.is_empty()
    }

    #[inline(always)]
    #[cfg_attr(debug_assertions, track_caller)]
    pub(crate) fn at(self, index: usize) -> T {
        // Calling `get` here costs the normalizer more instructions.
        match self.0.get(index) {
            Some(bytes) => T::from_bytes(bytes),
            None => None.soft_unwrap(),
        }
    }

    #[inline(always)]
    pub(crate) fn get(self, index: usize) -> Option<T> {
        self.0.get(index).map(T::from_bytes)
    }

    /// Like `get`, usable in constants.
    pub(crate) const fn bytes_at(self, index: usize) -> Option<[u8; N]> {
        match self.0.split_at_checked(index) {
            Some((_, [bytes, ..])) => Some(*bytes),
            _ => None,
        }
    }

    /// Returns `[range]`, clamped to the length. Only damaged data produce a range out of bounds.
    #[inline]
    #[cfg_attr(debug_assertions, track_caller)]
    pub(crate) fn slice(self, range: impl ViewRange) -> Self {
        let range = range.with_len(self.0.len());
        crate::common::soft_assert!(range.start <= range.end && range.end <= self.0.len());
        self.slice_clamped(range)
    }

    /// Returns `[range]`, clamped to the length, for a caller that checks each index later.
    #[inline]
    pub(crate) fn slice_clamped(self, range: Range<usize>) -> Self {
        let end = range.end.min(self.0.len());
        Self::from_chunks(self.0.slice(range.start.min(end)..end))
    }

    /// Copies `[start, start + out.len())`. Elements past the end read as 0.
    #[inline]
    #[cfg_attr(debug_assertions, track_caller)]
    pub(crate) fn copy_to(self, start: usize, out: &mut [T]) {
        let source = self.0.get(start..).unwrap_or_default();
        let (inside, outside) = out.split_at_mut(out.len().min(source.len()));
        inside
            .iter_mut()
            .zip(source)
            .for_each(|(element, bytes)| *element = T::from_bytes(bytes));
        outside
            .iter_mut()
            .for_each(|element| *element = self.at(self.len()));
    }

    #[inline]
    pub(crate) fn iter(self) -> impl ExactSizeIterator<Item = T> + Clone + 'a {
        self.0.iter().map(T::from_bytes)
    }

    pub(crate) fn try_to_vec(self) -> Result<Vec<T>, UErrorCode> {
        crate::common::memory::try_collect(self.iter())
    }

    #[inline]
    pub(crate) const fn as_bytes(self) -> &'a [u8] {
        self.0.as_flattened()
    }
}

impl U16s<'_> {
    /// `cstring::until_nul`
    pub(crate) fn until_nul(self) -> Self {
        self.slice(0..self.iter().take_while(|&unit| unit != 0).count())
    }

    /// Returns whether the units equal `bytes`, each byte read as a code unit.
    pub(crate) fn eq_bytes(self, bytes: &[u8]) -> bool {
        self.iter().eq(bytes.iter().map(|&byte| u16::from(byte)))
    }
}
