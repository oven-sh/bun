//! The kernels of `bun_zlib`, from src/jsc/bindings/highway_zlib.cpp.

use core::cell::Cell;
use core::hint::{Locality, prefetch_write};
use core::mem::MaybeUninit;

unsafe extern "C" {
    fn highway_repeat(from: *const u8, to: *mut u8, period: usize, len: usize);
    fn highway_subtract_saturating(values: *mut [u16; 64], groups: usize, amount: u16);
}

#[inline]
pub fn subtract_saturating(values: &mut [[u16; 64]], amount: u16) {
    // SAFETY: the kernel reads and writes so many groups.
    unsafe { highway_subtract_saturating(values.as_mut_ptr(), values.len(), amount) }
}

pub const MATCH_SPAN: usize = 320;
const CHUNK: usize = 32;
const MAX_LEN: usize = MATCH_SPAN - (CHUNK - 1);

/// About where the one behind a long match is written.
pub const NEXT_MATCH_OFFSET: usize = 256;

/// A match is read from one and written to another, and they may overlap.
pub type Span<T = u8> = [Cell<T>; MATCH_SPAN];

/// With long matches, writing would wait for memory.
#[inline(always)]
fn prefetch<T>(span: &Span<T>, offset: usize) {
    const CACHE_LINE: usize = 64;
    let start = span.as_ptr().cast_mut().wrapping_add(offset);
    for line in 0..4 {
        prefetch_write(start.wrapping_add(CACHE_LINE * line), Locality::L1);
    }
}

/// If `to` starts `distance` bytes behind the start of `from` and those are initialized, so are the first `len` of `to`
/// afterwards, up to `MAX_LEN`: the kernel repeats them, or `len` is no more, or each chunk ends in front of its copy.
#[inline(always)]
fn copy_cells<T: Copy>(
    from: &Span<T>,
    to: &Span<T>,
    distance: usize,
    len: usize,
    next_offset: Option<usize>,
    initializer: Option<T>,
) {
    const { assert!(size_of::<T>() == 1) };
    const LONG: usize = 3 * CHUNK;
    if distance < len.min(CHUNK) {
        if let Some(offset) = next_offset.filter(|_| len > LONG) {
            prefetch(to, offset);
        }
        // The kernel loads 16 bytes for a shorter period.
        if let Some(byte) = initializer {
            to[..16].iter().for_each(|to| to.set(byte));
        }
        let (from, to) = (from.as_ptr().cast(), to.as_ptr().cast_mut().cast());
        // SAFETY: with a period of 1 to 31 it reads 31 bytes at most, and writes `len + 31`.
        return unsafe { highway_repeat(from, to, distance.max(1), len.min(MAX_LEN)) };
    }
    let copy_chunk = |at: usize| {
        let (from, to) = (&from[at..at + CHUNK], &to[at..at + CHUNK]);
        let bytes: [T; CHUNK] = core::array::from_fn(|i| from[i].get());
        // Not `zip()`, which takes LTO to be inlined.
        for (i, to) in to.iter().enumerate() {
            to.set(bytes[i]);
        }
    };
    copy_chunk(0);
    for at in (CHUNK..MAX_LEN).step_by(CHUNK) {
        if at >= len {
            break;
        }
        if let Some(offset) = next_offset.filter(|_| at == LONG) {
            prefetch(to, offset);
        }
        copy_chunk(at);
    }
}

/// `from` starts `distance` bytes in front of `to`, or does not overlap it. May write up to 32 bytes too many.
/// Something will soon be written `next_offset` bytes behind the start of `to`.
#[inline(always)]
pub fn copy_match(from: &Span, to: &Span, distance: usize, len: usize, next_offset: Option<usize>) {
    copy_cells(from, to, distance, len, next_offset, None);
}

/// Writes literals and matches to the spare capacity of a `Vec`, which has them once this is dropped.
pub struct Appender<'a> {
    vec: &'a mut Vec<u8>,
    all: &'a [Cell<MaybeUninit<u8>>],
    /// The end of `all`. Everything in front of it is initialized, and stays so.
    rest: &'a [Cell<MaybeUninit<u8>>],
    /// The length of `vec` if `rest` is empty.
    full_len: usize,
}

impl<'a> Appender<'a> {
    /// Matches copy from no more than the last `history` bytes of `vec`, and no more than `room` are written to.
    #[inline(always)]
    pub fn new(vec: &'a mut Vec<u8>, history: usize, room: usize) -> Self {
        let history = history.min(vec.len());
        let room = room.min(vec.capacity() - vec.len());
        // SAFETY: that is within the allocation, and nothing else gets at it for as long as `vec` is borrowed.
        let all = unsafe {
            let start = vec.as_mut_ptr().add(vec.len() - history);
            core::slice::from_raw_parts(start.cast(), history + room)
        };
        Self {
            all,
            rest: all.split_at(history).1,
            full_len: vec.len() + room,
            vec,
        }
    }

    #[inline(always)]
    pub fn room(&self) -> usize {
        self.rest.len()
    }

    /// From the start of the history.
    #[inline(always)]
    pub fn position(&self) -> usize {
        self.all.len() - self.rest.len()
    }

    /// The first `count` of `bytes`, if there is room for all.
    #[inline(always)]
    pub fn push(&mut self, bytes: [u8; 4], count: usize) {
        if let Some(to) = self.rest.first_chunk::<4>() {
            for (i, to) in to.iter().enumerate() {
                to.set(MaybeUninit::new(bytes[i]));
            }
            self.rest = self.rest.split_at(count.min(4)).1;
        }
    }

    /// `false` if `distance` is out of range, or there is no room for a `Span`.
    #[inline(always)]
    pub fn copy(&mut self, distance: usize, len: usize) -> bool {
        let Some(to) = self.rest.first_chunk() else {
            return false;
        };
        if distance.wrapping_sub(1) >= self.position() {
            return false;
        }
        // SAFETY: it starts within `all` and in front of `to`, so it ends in front of the end of `to`.
        let from = unsafe { &*self.all.as_ptr().add(self.position() - distance).cast() };
        let zero = MaybeUninit::new(0);
        copy_cells(from, to, distance, len, Some(NEXT_MATCH_OFFSET), Some(zero));
        self.rest = self.rest.split_at(len.min(MAX_LEN)).1;
        true
    }
}

impl Drop for Appender<'_> {
    #[inline(always)]
    fn drop(&mut self) {
        // SAFETY: `rest` has lost nothing but what `push()` and `copy_cells()` have initialized.
        unsafe { self.vec.set_len(self.full_len - self.rest.len()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Looks at all that the kernel loads, and leaves nothing usable behind `len`.
    #[unsafe(no_mangle)]
    unsafe extern "C" fn highway_repeat(from: *const u8, to: *mut u8, period: usize, len: usize) {
        assert!((1..CHUNK).contains(&period) && (1..=MAX_LEN).contains(&len));
        // SAFETY: the promises that `copy_cells()` makes.
        let (from, to) = unsafe {
            (
                core::slice::from_raw_parts(from, period.max(16)).to_vec(),
                core::slice::from_raw_parts_mut(to.cast(), len + 31),
            )
        };
        assert!(from.iter().fold(0, |sum, &byte| sum + usize::from(byte)) < 9999);
        to.fill(MaybeUninit::uninit());
        for (to, &from) in to[..len].iter_mut().zip(from[..period].iter().cycle()) {
            to.write(from);
        }
    }

    fn start(len: usize, capacity: usize) -> Vec<u8> {
        let mut vec = Vec::with_capacity(capacity);
        vec.extend((0..len).map(|at| (at * at % 251) as u8));
        vec
    }

    #[test]
    fn matches_copy_what_is_there() {
        for distance in [1, 2, 31, 32, 33, 65] {
            for len in [0, 3, 32, 33, 288, 289, 290, usize::MAX] {
                let mut vec = start(65, 65 + MATCH_SPAN);
                let mut expected = vec.clone();
                assert!(Appender::new(&mut vec, 65, usize::MAX).copy(distance, len));
                for _ in 0..len.min(MAX_LEN) {
                    expected.push(expected[expected.len() - distance]);
                }
                assert_eq!(vec, expected);
            }
        }
    }

    #[test]
    fn nothing_is_added_that_is_out_of_range() {
        let mut vec = start(40, 999);
        for (history, reach) in [(0, 0), (9, 9), (usize::MAX, 40)] {
            for distance in [0, reach + 1, 1 << 16, u32::MAX as usize, usize::MAX] {
                assert!(!Appender::new(&mut vec, history, usize::MAX).copy(distance, 9));
            }
        }
        assert!(!Appender::new(&mut vec, 40, MATCH_SPAN - 1).copy(1, 9));
        Appender::new(&mut vec, 40, 3).push([1; 4], 1);
        assert_eq!(vec, start(40, 40));
        Appender::new(&mut Vec::new(), 9, 9).push([1; 4], 1);
    }

    #[test]
    fn what_follows_replaces_what_was_written_too_many() {
        let mut vec = start(5, 999);
        let mut appender = Appender::new(&mut vec, 2, 700);
        assert_eq!((appender.position(), appender.room()), (2, 700));
        for count in [0, 1, 4, usize::MAX] {
            appender.push([1, 2, 3, 4], count);
        }
        assert!(appender.copy(9, 2) && appender.copy(3, 7) && appender.copy(20, 1));
        assert_eq!((appender.position(), appender.room()), (21, 681));
        drop(appender);
        let added = [1, 1, 2, 3, 4, 1, 2, 3, 4, 1, 1, 4, 1, 1, 4, 1, 1, 4, 9];
        assert_eq!(vec[5..], added);
    }
}
