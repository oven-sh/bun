//! Slice access that reports a broken invariant instead of panicking.

use core::slice::SliceIndex;

use bun_core::AllocError;

/// An index or a length that the algorithm keeps in range was out of range. No input should be able to cause it.
/// The decoder reports it as [`crate::DecoderErrorCode::Unreachable`] and the encoder as [`crate::EncoderError::Internal`].
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
        self.get_mut(start..)
            .and_then(<[T]>::first_chunk_mut)
            .ok_or(Bug)
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

/// Reads 4 bytes at a time from anywhere in a slice, at the cost of one comparison each.
#[derive(Clone, Copy)]
pub(crate) struct Loads<'a> {
    data: &'a [u8],
    /// The last position that can be read.
    last: usize,
}

impl<'a> Loads<'a> {
    /// `data` has at least 4 bytes.
    #[inline(always)]
    pub(crate) fn new(data: &'a [u8]) -> Checked<Self> {
        let last = data.len().checked_sub(4).ok_or(Bug)?;
        Ok(Self { data, last })
    }

    /// The 4 bytes from `pos` on, if they are all inside.
    #[inline(always)]
    pub(crate) fn u32_le(&self, pos: usize) -> Option<u32> {
        if pos > self.last {
            return None;
        }
        // The compiler sees that this cannot fail.
        let bytes = self.data.get(pos..).and_then(<[u8]>::first_chunk)?;
        Some(u32::from_le_bytes(*bytes))
    }
}

/// `len` zeros, or nothing if there is no memory for them. Of a large table, the parts that are never used cost nothing.
pub(crate) use bun_core::vec::try_zeroed;

/// `value` on the heap, or nothing if there is no memory for it.
pub(crate) fn try_box<T>(value: T) -> Result<Box<T>, AllocError> {
    Box::try_new(value).map_err(|_| AllocError)
}

/// An empty `Vec` with room for `capacity` elements, or nothing if there is no memory for them.
pub(crate) fn try_with_capacity<T>(capacity: usize) -> Result<Vec<T>, AllocError> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(capacity).map_err(|_| AllocError)?;
    Ok(vec)
}

/// `len` copies of `value`, or nothing if there is no memory for them.
pub(crate) fn try_vec<T: Clone>(value: T, len: usize) -> Result<Vec<T>, AllocError> {
    let mut vec = try_with_capacity(len)?;
    vec.resize(len, value);
    Ok(vec)
}

/// Makes room for `needed` elements in all. The capacity at least doubles when it grows, but does not go beyond `most`,
/// which is as much as is ever needed.
pub(crate) fn try_reserve_up_to<T>(
    vec: &mut Vec<T>,
    needed: usize,
    most: usize,
) -> Result<(), AllocError> {
    if needed <= vec.capacity() {
        return Ok(());
    }
    let capacity = needed.max((2 * vec.capacity()).min(most));
    vec.try_reserve_exact(capacity - vec.len())
        .map_err(|_| AllocError)
}

/// A checksum for tables that are too large to spell out in a test.
#[cfg(test)]
pub(crate) fn fnv1a(bytes: impl Iterator<Item = u8>) -> u64 {
    bytes.fold(0xCBF2_9CE4_8422_2325, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100_0000_01B3)
    })
}
