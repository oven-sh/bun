//! Copies matches.

use core::cell::Cell;
use core::hint::{Locality, prefetch_write};

use bun_simd::prelude::{Baseline, Simd, u8x16};

const MATCH_SPAN: usize = 320;
const CHUNK: usize = 32;
pub(super) const MAX_LEN: usize = MATCH_SPAN - (CHUNK - 1);
const LONG: usize = 3 * CHUNK;

/// Roughly how far after the start of a long match the next match is written.
pub(super) const NEXT_MATCH_OFFSET: usize = 256;

/// The source or the destination of a match. Cells, because the two may overlap.
pub(super) type Span = [Cell<u8>; MATCH_SPAN];

/// With long matches, writing would wait for memory.
#[inline(always)]
fn prefetch(start: *const u8, offset: usize) {
    const CACHE_LINE: usize = 64;
    let start = start.cast_mut().wrapping_add(offset);
    for line in 0..4 {
        prefetch_write(start.wrapping_add(CACHE_LINE * line), Locality::L1);
    }
}

/// For each period up to 16, where in it each of 32 bytes is, and how many bytes the whole periods leave.
#[repr(C, align(32))]
struct Periods {
    indices: [[[u8; 16]; 2]; 17],
    left: [u8; 17],
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static PERIODS: Periods = {
    let mut periods = Periods {
        indices: [[[0; 16]; 2]; 17],
        left: [0; 17],
    };
    let mut period = 1;
    while period <= 16 {
        let mut at = 0;
        while at < CHUNK {
            periods.indices[period][at / 16][at % 16] = (at % period) as u8;
            at += 1;
        }
        periods.left[period] = (CHUNK % period) as u8;
        period += 1;
    }
    periods
};

/// `period` is less than a chunk.
#[inline(always)]
fn repeat(from: &Span, to: &Span, period: usize, len: usize) {
    let (first, second, second_at, step);
    if period <= 1 {
        // A wider load could span several recent stores and have to wait for them.
        first = u8x16::<Baseline>::splat(from[0].get());
        (second, second_at, step) = (first, 16, CHUNK);
    } else if let (Some(&[lower, upper]), Some(&left)) =
        (PERIODS.indices.get(period), PERIODS.left.get(period))
    {
        let bytes = u8x16::<Baseline>::load(from).in_blocks();
        first = bytes.lookup_bytes_relaxed(lower);
        second = bytes.lookup_bytes_relaxed(upper);
        (second_at, step) = (16, CHUNK - usize::from(left % 16));
    } else {
        (second_at, step) = ((period - 16) % 16, period);
        (first, second) = (Simd::load(from), Simd::load_at(from, second_at));
    }
    let (mut at, len) = (0, len.min(MAX_LEN));
    while let Some(mut chunk) = to.get(at..at + CHUNK) {
        first.store_at(&mut chunk, 0);
        second.store_at(&mut chunk, second_at);
        at += step;
        if at >= len {
            break;
        }
    }
}

/// `from` starts `distance` bytes in front of `to`, or does not overlap it. May write up to 32 bytes too many.
/// Something will soon be written `next_offset` bytes behind the start of `to`.
#[inline(always)]
#[expect(clippy::indexing_slicing, reason = "the last chunk ends with the span")]
pub(super) fn copy_match(
    from: &Span,
    to: &Span,
    distance: usize,
    len: usize,
    next_offset: Option<usize>,
) {
    if distance < len.min(CHUNK) {
        if let Some(offset) = next_offset.filter(|_| len > LONG) {
            prefetch(to.as_ptr().cast(), offset);
        }
        return repeat(from, to, distance, len);
    }
    let copy_chunk = #[inline(always)]
    |at: usize| {
        let (from, to) = (&from[at..at + CHUNK], &to[at..at + CHUNK]);
        let bytes: [u8; CHUNK] = core::array::from_fn(|i| from[i].get());
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
            prefetch(to.as_ptr().cast(), offset);
        }
        copy_chunk(at);
    }
}

#[cfg(test)]
#[expect(clippy::indexing_slicing, clippy::unwrap_used)]
mod tests {
    use super::super::codes::{Reel, Tape, end_of};
    use super::super::window::SLACK;
    use super::*;

    #[test]
    fn any_match_is_copied_with_little_too_much() {
        for distance in 0..=64 {
            for len in [0, 1, 15, 16, 17, 31, 32, 33, 64, 258, usize::MAX] {
                let mut bytes: [u8; 64 + MATCH_SPAN] = core::array::from_fn(|at| (at % 251) as u8);
                let before = bytes;
                let cells = Cell::from_mut(&mut bytes[..]).as_slice_of_cells();
                let span = |at: usize| cells[at..].first_chunk().unwrap();
                copy_match(span(64 - distance), span(64), distance, len, None);
                let end = 64 + len.min(MAX_LEN);
                // Without a distance, the first byte is repeated.
                assert!((65..end).all(|at| bytes[at] == bytes[at - distance.max(1)]));
                let untouched = (end + 32).min(bytes.len());
                assert!(bytes[..64] == before[..64] && bytes[untouched..] == before[untouched..]);
                assert!(len == 0 || bytes[64] == before[64 - distance]);
            }
        }
    }

    #[test]
    fn any_match_is_appended() {
        for history in [0, 1, 2, 15, 16, 17, 31, 65] {
            let distances = (0..=66).chain([usize::MAX]);
            for distance in distances.filter(|it| !cfg!(miri) || it % 15 == 2) {
                for len in [0, 3, 16, 32, 33, 97, 288, 289, 290, usize::MAX] {
                    let before: [u8; 70] = core::array::from_fn(|at| (at * at % 251) as u8);
                    let mut vec = crate::vec::with_room(70 + SLACK).unwrap();
                    crate::vec::write_at(&mut vec, 0, &before);
                    let mut out = end_of(&mut vec, history, usize::MAX);
                    let is_appended = out.round().unwrap().copy(distance, len);
                    drop(out);
                    assert_eq!(is_appended, (1..=history).contains(&distance));
                    let added = if is_appended { len.min(MAX_LEN) } else { 0 };
                    assert!(vec.len() == 70 + added && vec[..70] == before);
                    assert!((70..vec.len()).all(|at| vec[at] == vec[at - distance]));
                }
            }
        }
    }

    #[test]
    fn literals_are_appended_within_the_capacity() {
        let mut vec = crate::vec::with_room(SLACK + 9).unwrap();
        crate::vec::write_at(&mut vec, 0, &[1, 2, 3]);
        let capacity = vec.capacity();
        let mut out = end_of(&mut vec, 1, usize::MAX);
        while let Some(mut tape) = out.round() {
            tape.push([1, 2, 0, 0], 2);
            tape.push([0; 4], 0);
            tape.push([3, 0, 0, 0], 1);
        }
        drop(out);
        assert_eq!(vec.capacity(), capacity);
        assert_eq!(vec.len(), (capacity + 1 - SLACK).next_multiple_of(3));
        assert!(vec.chunks(3).all(|it| it == [1, 2, 3]));
    }
}
