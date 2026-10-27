//! Slice access that reports a broken invariant instead of panicking, and `mem.h` / `bits.h`.

use core::slice::SliceIndex;

use crate::error::{ErrorCode, Result};

/// An index or a length that the algorithm keeps in range was out of range. No input should be able to cause it.
pub(crate) const BUG: ErrorCode = ErrorCode::Generic;

pub(crate) trait SliceExt<T> {
    fn at(&self, index: usize) -> Result<T>
    where
        T: Copy;
    fn at_mut(&mut self, index: usize) -> Result<&mut T>;
    fn put(&mut self, index: usize, value: T) -> Result<()>;
    fn sub<I: SliceIndex<[T], Output = [T]>>(&self, range: I) -> Result<&[T]>;
    fn sub_mut<I: SliceIndex<[T], Output = [T]>>(&mut self, range: I) -> Result<&mut [T]>;
    /// The `len` elements from `start` on.
    fn span(&self, start: usize, len: usize) -> Result<&[T]>;
    fn span_mut(&mut self, start: usize, len: usize) -> Result<&mut [T]>;
    /// The `N` elements from `start` on.
    fn array_at<const N: usize>(&self, start: usize) -> Result<&[T; N]>;
    fn array_at_mut<const N: usize>(&mut self, start: usize) -> Result<&mut [T; N]>;
    /// `memmove(&self[dst], &self[src], len)`.
    fn move_within(&mut self, src: usize, dst: usize, len: usize) -> Result<()>
    where
        T: Copy;
    /// `memcpy(&self[start], from, from.len())`.
    fn write_at(&mut self, start: usize, from: &[T]) -> Result<()>
    where
        T: Copy;
}

impl<T> SliceExt<T> for [T] {
    #[inline(always)]
    fn at(&self, index: usize) -> Result<T>
    where
        T: Copy,
    {
        self.get(index).copied().ok_or(BUG)
    }

    #[inline(always)]
    fn at_mut(&mut self, index: usize) -> Result<&mut T> {
        self.get_mut(index).ok_or(BUG)
    }

    #[inline(always)]
    fn put(&mut self, index: usize, value: T) -> Result<()> {
        *self.get_mut(index).ok_or(BUG)? = value;
        Ok(())
    }

    #[inline(always)]
    fn sub<I: SliceIndex<[T], Output = [T]>>(&self, range: I) -> Result<&[T]> {
        self.get(range).ok_or(BUG)
    }

    #[inline(always)]
    fn sub_mut<I: SliceIndex<[T], Output = [T]>>(&mut self, range: I) -> Result<&mut [T]> {
        self.get_mut(range).ok_or(BUG)
    }

    #[inline(always)]
    fn span(&self, start: usize, len: usize) -> Result<&[T]> {
        self.get(start..).and_then(|s| s.get(..len)).ok_or(BUG)
    }

    #[inline(always)]
    fn span_mut(&mut self, start: usize, len: usize) -> Result<&mut [T]> {
        self.get_mut(start..)
            .and_then(|s| s.get_mut(..len))
            .ok_or(BUG)
    }

    #[inline(always)]
    fn array_at<const N: usize>(&self, start: usize) -> Result<&[T; N]> {
        self.get(start..).and_then(<[T]>::first_chunk).ok_or(BUG)
    }

    #[inline(always)]
    fn array_at_mut<const N: usize>(&mut self, start: usize) -> Result<&mut [T; N]> {
        self.get_mut(start..)
            .and_then(<[T]>::first_chunk_mut)
            .ok_or(BUG)
    }

    #[inline(always)]
    fn move_within(&mut self, src: usize, dst: usize, len: usize) -> Result<()>
    where
        T: Copy,
    {
        let src_end = src.checked_add(len).ok_or(BUG)?;
        let dst_end = dst.checked_add(len).ok_or(BUG)?;
        if src_end > self.len() || dst_end > self.len() {
            return Err(BUG);
        }
        self.copy_within(src..src_end, dst);
        Ok(())
    }

    #[inline(always)]
    fn write_at(&mut self, start: usize, from: &[T]) -> Result<()>
    where
        T: Copy,
    {
        self.span_mut(start, from.len())?.copy_from_slice(from);
        Ok(())
    }
}

#[inline(always)]
pub(crate) fn read_le16(data: &[u8], pos: usize) -> Result<u16> {
    Ok(u16::from_le_bytes(*data.array_at(pos)?))
}

#[inline(always)]
pub(crate) fn read_le24(data: &[u8], pos: usize) -> Result<u32> {
    let [a, b, c] = *data.array_at(pos)?;
    Ok(u32::from_le_bytes([a, b, c, 0]))
}

#[inline(always)]
pub(crate) fn read_le32(data: &[u8], pos: usize) -> Result<u32> {
    Ok(u32::from_le_bytes(*data.array_at(pos)?))
}

#[inline(always)]
pub(crate) fn read_le64(data: &[u8], pos: usize) -> Result<u64> {
    Ok(u64::from_le_bytes(*data.array_at(pos)?))
}

#[inline(always)]
pub(crate) fn write_le16(data: &mut [u8], pos: usize, value: u16) -> Result<()> {
    *data.array_at_mut(pos)? = value.to_le_bytes();
    Ok(())
}

#[inline(always)]
pub(crate) fn write_le24(data: &mut [u8], pos: usize, value: u32) -> Result<()> {
    let [a, b, c, _] = value.to_le_bytes();
    *data.array_at_mut(pos)? = [a, b, c];
    Ok(())
}

#[inline(always)]
pub(crate) fn write_le32(data: &mut [u8], pos: usize, value: u32) -> Result<()> {
    *data.array_at_mut(pos)? = value.to_le_bytes();
    Ok(())
}

#[inline(always)]
pub(crate) fn write_le64(data: &mut [u8], pos: usize, value: u64) -> Result<()> {
    *data.array_at_mut(pos)? = value.to_le_bytes();
    Ok(())
}

/// `ZSTD_highbit32`: the position of the highest bit set. `value` is not 0.
#[inline(always)]
pub(crate) const fn highbit32(value: u32) -> u32 {
    31 - (value | 1).leading_zeros()
}

/// `len` zeros, or [`ErrorCode::MemoryAllocation`]. An allocator that reuses memory has to clear all of it.
pub(crate) fn try_zeroed<T: bun_pod::Zeroable>(len: usize) -> Result<Vec<T>> {
    bun_pod::try_zeroed_vec(len).ok_or(ErrorCode::MemoryAllocation)
}

/// A copy of `bytes`, or [`ErrorCode::MemoryAllocation`].
pub(crate) fn try_copy(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(bytes.len())
        .map_err(|_| ErrorCode::MemoryAllocation)?;
    vec.extend_from_slice(bytes);
    Ok(vec)
}
