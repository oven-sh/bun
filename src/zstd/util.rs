//! Slice access that reports a broken invariant instead of panicking, and `mem.h` / `bits.h`.

use core::slice::SliceIndex;

use crate::error::{Error, Result};

/// An index or a length that the algorithm keeps in range was out of range. No input should be able to cause it.
pub(crate) const BUG: Error = Error::Generic;

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
        let size = size_of::<T>();
        if dst >= src_end && is_slow_to_copy((dst - src) * size, len * size) {
            move_in_parts(self, src, dst, len);
        } else {
            self.copy_within(src..src_end, dst);
        }
        Ok(())
    }

    #[inline(always)]
    fn write_at(&mut self, start: usize, from: &[T]) -> Result<()>
    where
        T: Copy,
    {
        copy(self.span_mut(start, from.len())?, from)
    }
}

/// `to.copy_from_slice(from)`
#[inline(always)]
pub(crate) fn copy<T: Copy>(to: &mut [T], from: &[T]) -> Result<()> {
    if to.len() != from.len() {
        return Err(BUG);
    }
    let distance = to.as_ptr().addr().wrapping_sub(from.as_ptr().addr());
    if is_slow_to_copy(distance, size_of_val(from)) {
        copy_in_parts(to, from);
    } else {
        to.copy_from_slice(from);
    }
    Ok(())
}

/// glibc 2.39 copies more than 2112 bytes at once with `rep movsb`, which takes up to 25 times as long on Zen 4
/// if the destination is a little further into its page than the source:
/// <https://sourceware.org/bugzilla/show_bug.cgi?id=30994>.
const MAX_COPY: usize = 2048;

/// Whether `size` bytes are, at once, to `distance` bytes after where they are.
#[inline(always)]
fn is_slow_to_copy(distance: usize, size: usize) -> bool {
    cfg!(all(target_arch = "x86_64", target_env = "gnu"))
        && size > MAX_COPY
        && distance.wrapping_sub(1) % 4096 < 127
}

#[cold]
#[inline(never)]
fn copy_in_parts<T: Copy>(to: &mut [T], from: &[T]) {
    let part = (MAX_COPY / size_of::<T>()).max(1);
    for (to, from) in to.chunks_mut(part).zip(from.chunks(part)) {
        to.copy_from_slice(from);
    }
}

/// `slice.copy_within(src..src + len, dst)`, which is in it and starts no earlier than the source ends.
#[cold]
#[inline(never)]
fn move_in_parts<T: Copy>(slice: &mut [T], src: usize, dst: usize, len: usize) {
    let part = (MAX_COPY / size_of::<T>()).max(1);
    for done in (0..len).step_by(part) {
        let end = src + (done + part).min(len);
        slice.copy_within(src + done..end, dst + done);
    }
}

/// `to.extend_from_slice(from)`, without a new allocation.
#[inline]
pub(crate) fn append(to: &mut Vec<u8>, from: &[u8]) -> Result<()> {
    if from.len() > to.capacity() - to.len() {
        return Err(BUG);
    }
    let distance = (to.as_ptr_range().end.addr()).wrapping_sub(from.as_ptr().addr());
    if is_slow_to_copy(distance, from.len()) {
        from.chunks(MAX_COPY)
            .for_each(|part| to.extend_from_slice(part));
    } else {
        to.extend_from_slice(from);
    }
    Ok(())
}

/// `to.extend_from_within(start..start + len)`, without a new allocation.
#[inline]
pub(crate) fn append_within(to: &mut Vec<u8>, start: usize, len: usize) -> Result<()> {
    let end = start + len;
    if end > to.len() || len > to.capacity() - to.len() {
        return Err(BUG);
    }
    if is_slow_to_copy(to.len() - start, len) {
        (start..end)
            .step_by(MAX_COPY)
            .for_each(|part| to.extend_from_within(part..(part + MAX_COPY).min(end)));
    } else {
        to.extend_from_within(start..end);
    }
    Ok(())
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

/// `len` zeros, or [`Error::MemoryAllocation`]. An allocator that reuses memory has to clear all of it.
pub(crate) fn try_zeroed<T: bun_pod::Zeroable>(len: usize) -> Result<Vec<T>> {
    bun_pod::try_zeroed_vec(len).ok_or(Error::MemoryAllocation)
}

/// Gives `table` the length `len`. What it holds is 0, or if `clean` is false possibly what it held before.
pub(crate) fn reset_table<T: bun_pod::Zeroable + Copy + Default>(
    table: &mut Vec<T>,
    len: usize,
    clean: bool,
) -> Result<()> {
    if len > table.capacity() {
        // First, so that both are not allocated at once.
        *table = Vec::new();
        *table = try_zeroed(len)?;
        return Ok(());
    }
    if clean {
        table.clear();
    }
    table.resize(len, T::default());
    Ok(())
}

/// Makes the capacity of `vec` at least `len`. A `vec` that has to grow is emptied first, so that nothing is copied and
/// both are not allocated at once. It gets twice its capacity, or `max` if that is less.
pub(crate) fn make_room<T>(vec: &mut Vec<T>, len: usize, max: usize) -> Result<()> {
    if len <= vec.capacity() {
        return Ok(());
    }
    let capacity = len.max((2 * vec.capacity()).min(max));
    *vec = Vec::new();
    vec.try_reserve_exact(capacity)
        .map_err(|_| Error::MemoryAllocation)
}

/// A copy of `bytes`, or [`Error::MemoryAllocation`].
pub(crate) fn try_copy(bytes: &[u8]) -> Result<Vec<u8>> {
    let mut vec = Vec::new();
    vec.try_reserve_exact(bytes.len())
        .map_err(|_| Error::MemoryAllocation)?;
    append(&mut vec, bytes)?;
    Ok(vec)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_copies_are_whole_at_every_distance() -> Result<()> {
        const PAGE: usize = 4096;
        // Miri takes its time. The distances that are slow come first.
        let step = if cfg!(miri) { 61 } else { 1 };
        let from: Vec<u8> = (0..2 * MAX_COPY + 77).map(|i| (i % 251) as u8).collect();
        let mut to = vec![0; 3 * PAGE + from.len() + 1];
        // As far into its page as `from`.
        let base = PAGE + from.as_ptr().addr() % PAGE - to.as_ptr().addr() % PAGE;
        for start in (base..base + PAGE).step_by(step) {
            to.write_at(start, &from)?;
            assert!(*to.span(start, from.len())? == *from);
            assert_eq!((to.at(start - 1)?, to.at(start + from.len())?), (0, 0));
            to.fill(0);

            let mut vec = vec![0; start];
            vec.reserve_exact(from.len());
            let too_long = vec.capacity() - vec.len() + 1;
            assert_eq!(append(&mut vec, to.sub(..too_long)?), Err(BUG));
            append(&mut vec, &from)?;
            assert!(*vec.sub(start..)? == *from);
        }
        let mut within = from.repeat(3);
        let len = MAX_COPY + 9;
        for distance in (PAGE..PAGE + 200).chain(len..PAGE).step_by(step) {
            within.truncate(3 * from.len());
            within.reserve(len);
            append_within(&mut within, 3 * from.len() - distance, len)?;
            assert!(within.span(3 * from.len() - distance, len)? == within.sub(3 * from.len()..)?);

            let expected = within.span(5, len)?.to_vec();
            within.move_within(5, 5 + distance, len)?;
            assert!(*within.span(5 + distance, len)? == *expected);
            within.clear();
            (0..3).for_each(|_| within.extend_from_slice(&from));
        }
        Ok(())
    }
}
