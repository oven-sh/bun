//! Slice access that reports a broken invariant instead of panicking, and allocation that can fail.

use crate::Result;
use core::slice::SliceIndex;

/// An index or a length that the algorithm keeps in range was out of range. No input should be able to cause it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Bug;

pub(crate) type Checked<T = ()> = Result<T, Bug>;

pub(crate) trait SliceExt<T> {
    fn at(&self, index: usize) -> Checked<T>
    where
        T: Copy;
    fn at_ref(&self, index: usize) -> Checked<&T>;
    fn at_mut(&mut self, index: usize) -> Checked<&mut T>;
    fn put(&mut self, index: usize, value: T) -> Checked;
    fn sub<I: SliceIndex<[T], Output = [T]>>(&self, range: I) -> Checked<&[T]>;
    fn sub_mut<I: SliceIndex<[T], Output = [T]>>(&mut self, range: I) -> Checked<&mut [T]>;
    /// The `N` elements from `start` on.
    fn array_at<const N: usize>(&self, start: usize) -> Checked<&[T; N]>;
    fn array_at_mut<const N: usize>(&mut self, start: usize) -> Checked<&mut [T; N]>;
    fn split_at_mid(&mut self, mid: usize) -> Checked<(&mut [T], &mut [T])>;
    /// `memmove(&self[dst], &self[src], len)`.
    fn move_within(&mut self, src: usize, dst: usize, len: usize) -> Checked
    where
        T: Copy;
    /// `memcpy(&self[start], from, from.len())`.
    fn write_at(&mut self, start: usize, from: &[T]) -> Checked
    where
        T: Copy;
}

impl<T> SliceExt<T> for [T] {
    #[inline(always)]
    fn at(&self, index: usize) -> Checked<T>
    where
        T: Copy,
    {
        self.get(index).copied().ok_or(Bug)
    }

    #[inline(always)]
    fn at_ref(&self, index: usize) -> Checked<&T> {
        self.get(index).ok_or(Bug)
    }

    #[inline(always)]
    fn at_mut(&mut self, index: usize) -> Checked<&mut T> {
        self.get_mut(index).ok_or(Bug)
    }

    #[inline(always)]
    fn put(&mut self, index: usize, value: T) -> Checked {
        *self.get_mut(index).ok_or(Bug)? = value;
        Ok(())
    }

    #[inline(always)]
    fn sub<I: SliceIndex<[T], Output = [T]>>(&self, range: I) -> Checked<&[T]> {
        self.get(range).ok_or(Bug)
    }

    #[inline(always)]
    fn sub_mut<I: SliceIndex<[T], Output = [T]>>(&mut self, range: I) -> Checked<&mut [T]> {
        self.get_mut(range).ok_or(Bug)
    }

    #[inline(always)]
    fn array_at<const N: usize>(&self, start: usize) -> Checked<&[T; N]> {
        self.get(start..).and_then(<[T]>::first_chunk).ok_or(Bug)
    }

    #[inline(always)]
    fn array_at_mut<const N: usize>(&mut self, start: usize) -> Checked<&mut [T; N]> {
        self.get_mut(start..)
            .and_then(<[T]>::first_chunk_mut)
            .ok_or(Bug)
    }

    #[inline(always)]
    fn split_at_mid(&mut self, mid: usize) -> Checked<(&mut [T], &mut [T])> {
        self.split_at_mut_checked(mid).ok_or(Bug)
    }

    #[inline(always)]
    fn move_within(&mut self, src: usize, dst: usize, len: usize) -> Checked
    where
        T: Copy,
    {
        let src_end = src.checked_add(len).ok_or(Bug)?;
        let dst_end = dst.checked_add(len).ok_or(Bug)?;
        if src_end > self.len() || dst_end > self.len() {
            return Err(Bug);
        }
        self.copy_within(src..src_end, dst);
        Ok(())
    }

    #[inline(always)]
    fn write_at(&mut self, start: usize, from: &[T]) -> Checked
    where
        T: Copy,
    {
        let end = start.checked_add(from.len()).ok_or(Bug)?;
        self.get_mut(start..end).ok_or(Bug)?.copy_from_slice(from);
        Ok(())
    }
}

/// An empty vector with room for `capacity` elements.
pub(crate) fn try_with_capacity<T>(capacity: usize) -> Result<Vec<T>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity)?;
    Ok(vec)
}

/// `len` copies of `value`.
pub(crate) fn try_vec<T: Clone>(value: T, len: usize) -> Result<Vec<T>> {
    let mut vec = try_with_capacity(len)?;
    vec.resize(len, value);
    Ok(vec)
}

/// How often each value of a byte occurs.
pub(crate) type ByteHistogram = [u32; 256];

#[inline(always)]
pub(crate) fn increment(histogram: &mut ByteHistogram, value: u8) {
    if let Some(count) = histogram.get_mut(usize::from(value)) {
        *count += 1;
    }
}
