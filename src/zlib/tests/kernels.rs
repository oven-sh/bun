//! In the place of Highway's, which are not linked.

use std::cell::Cell;
use std::mem::MaybeUninit;
use std::slice;

use bun_highway::zlib::{MATCH_SPAN, copy_match};

use crate::plain;

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_crc32(state: u32, bytes: *const u8, len: usize) -> u64 {
    assert!(len >= 4 || !cfg!(target_arch = "x86_64"));
    if cfg!(target_arch = "x86_64") && state % 2 == 0 {
        // As on a CPU that has no instruction for it.
        return u64::MAX;
    }
    // SAFETY: the caller passes a slice.
    u64::from(!plain::crc32(!state, unsafe {
        slice::from_raw_parts(bytes, len)
    }))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_copy_and_crc32(
    state: u32,
    bytes: *const u8,
    copy: *mut u8,
    len: usize,
) -> u64 {
    // SAFETY: the caller passes a slice, and room for it.
    unsafe {
        copy.copy_from_nonoverlapping(bytes, len);
        highway_crc32(state, bytes, len)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_adler32(adler: u32, bytes: *const u8, len: usize) -> u32 {
    let max = if cfg!(target_arch = "x86_64") {
        65536
    } else {
        16384
    };
    assert!((16..=max).contains(&len));
    // SAFETY: the caller passes a slice.
    plain::adler32(adler, unsafe { slice::from_raw_parts(bytes, len) })
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_copy_and_adler32(
    adler: u32,
    bytes: *const u8,
    copy: *mut u8,
    len: usize,
) -> u32 {
    // SAFETY: the caller passes a slice, and room for it.
    unsafe {
        copy.copy_from_nonoverlapping(bytes, len);
        highway_adler32(adler, bytes, len)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_subtract_saturating(values: *mut u16, groups: usize, amount: u16) {
    // SAFETY: the caller passes a slice of groups of 64.
    for value in unsafe { slice::from_raw_parts_mut(values, 64 * groups) } {
        *value = value.saturating_sub(amount);
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_repeat(from: *const u8, to: *mut u8, period: usize, len: usize) {
    assert!((1..32).contains(&period) && (1..=MATCH_SPAN - 31).contains(&len));
    // SAFETY: both have `MATCH_SPAN` bytes.
    let (from, to) = unsafe {
        (
            from.cast::<[MaybeUninit<u8>; 32]>().read(),
            slice::from_raw_parts_mut(to.cast::<MaybeUninit<u8>>(), len + 31),
        )
    };
    to[len..].fill(MaybeUninit::new(0xa5));
    for (to, &from) in to[..len].iter_mut().zip(from[..period].iter().cycle()) {
        *to = from;
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_common_prefix_length(a: *const u8, b: *const u8, len: usize) -> usize {
    // SAFETY: the caller passes two slices.
    let (a, b) = unsafe { (slice::from_raw_parts(a, len), slice::from_raw_parts(b, len)) };
    a.iter().zip(b).take_while(|(a, b)| a == b).count()
}

#[unsafe(no_mangle)]
unsafe extern "C" fn highway_index_of_char(bytes: *const u8, len: usize, wanted: u8) -> usize {
    // SAFETY: the caller passes a slice.
    let bytes = unsafe { slice::from_raw_parts(bytes, len) };
    bytes.iter().take_while(|&&byte| byte != wanted).count()
}

#[test]
fn any_match_is_copied_with_little_too_much() {
    for distance in [0, 1, 16, 31, 32, 33, 64] {
        for len in [0, 1, 31, 32, 33, 64, 258, usize::MAX] {
            let mut bytes: [u8; 64 + MATCH_SPAN] = std::array::from_fn(|at| (at % 251) as u8);
            let before = bytes;
            let cells = Cell::from_mut(&mut bytes[..]).as_slice_of_cells();
            let span = |at: usize| cells[at..].first_chunk().unwrap();
            copy_match(span(64 - distance), span(64), distance, len, None);
            let end = 64 + len.min(MATCH_SPAN - 31);
            // Without a distance, the first byte is repeated.
            assert!((65..end).all(|at| bytes[at] == bytes[at - distance.max(1)]));
            let untouched = (end + 32).min(bytes.len());
            assert!(bytes[..64] == before[..64] && bytes[untouched..] == before[untouched..]);
            assert!(len == 0 || bytes[64] == before[64 - distance]);
        }
    }
}
