//! Slice access that reports a broken invariant instead of panicking.

use core::slice::SliceIndex;

/// An index or a length that the algorithm keeps in range was out of range. No input should be able to cause it.
/// The decoder reports it as [`crate::DecoderErrorCode::Unreachable`] and the encoder as a failed call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Bug;

pub(crate) type Checked<T = ()> = Result<T, Bug>;

pub(crate) trait SliceExt<T> {
    fn at(&self, index: usize) -> Checked<T>
    where
        T: Copy;
    fn at_mut(&mut self, index: usize) -> Checked<&mut T>;
    fn put(&mut self, index: usize, value: T) -> Checked;
    fn sub<I: SliceIndex<[T], Output = [T]>>(&self, range: I) -> Checked<&[T]>;
    fn sub_mut<I: SliceIndex<[T], Output = [T]>>(&mut self, range: I) -> Checked<&mut [T]>;
    /// The `N` elements from `start` on.
    fn array_at<const N: usize>(&self, start: usize) -> Checked<&[T; N]>;
    fn array_at_mut<const N: usize>(&mut self, start: usize) -> Checked<&mut [T; N]>;
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
        self.get_mut(start..).and_then(<[T]>::first_chunk_mut).ok_or(Bug)
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

#[inline(always)]
pub(crate) fn load_u32_le(data: &[u8], pos: usize) -> Checked<u32> {
    Ok(u32::from_le_bytes(*data.array_at(pos)?))
}

#[inline(always)]
pub(crate) fn load_u64_le(data: &[u8], pos: usize) -> Checked<u64> {
    Ok(u64::from_le_bytes(*data.array_at(pos)?))
}

/// The allocation failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct OutOfMemory;

/// `len` copies of `value`, or nothing if there is no memory for them.
pub(crate) fn try_vec<T: Clone>(value: T, len: usize) -> Result<Vec<T>, OutOfMemory> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(len).map_err(|_| OutOfMemory)?;
    vec.resize(len, value);
    Ok(vec)
}
