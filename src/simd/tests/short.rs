//! Short slices next to memory that is not theirs.
#![allow(dead_code, unreachable_pub)]
#![cfg(not(target_family = "wasm"))]
use bun_simd::{target::*, *};

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn same<T: Int, W: Width>(from: &[T], _of: W) -> bool {
    let s: S = bun_simd::prelude::isa();
    let (v, n, zero) = (s.load_or_default::<T, W>(from).to_array(), W::BYTES / size_of::<T>(), T::default());
    let over = s.over(from).by::<W>();
    (0..n).all(|i| v.as_ref()[i] == from.get(i).copied().unwrap_or(zero))
        && over.position(|v| v.simd_eq(zero)) == from.iter().position(|&it| it == zero)
        && over.rposition(|v| v.simd_ne(zero)) == from.iter().rposition(|&it| it != zero)
        && over.rposition(|v| v.simd_eq(zero)) == from.iter().rposition(|&it| it == zero)
        && over.any(|v| v.simd_eq(zero)) == from.contains(&zero)
        && over.all(|v| v.simd_ne(zero)) != from.contains(&zero)
        && over.count(|v| v.simd_eq(zero)) == from.iter().filter(|&&it| it == zero).count()
}
fn check<T: Int>(from: &[T]) {
    for &target in Target::ALL.iter().filter(|it| it.is_supported()) {
        macro_rules! at { ($($w:ident)*) => {$( assert_eq!(same::to(target, from, $w), Some(true), "{target:?} {} {:p} {}", $w::BYTES, from.as_ptr(), from.len()); )*}; }
        at!(B8 B16 B32 B64);
    }
}
/// As lanes of each size that fits.
fn check_all(bytes: &[u8]) {
    check(bytes);
    macro_rules! of { ($($t:ident)*) => {$( if let ([], all, []) = unsafe { bytes.align_to::<$t>() } { check(all) } )*}; }
    of!(u16 u32 u64);
}
const STEP: usize = if cfg!(miri) { 23 } else { 1 };

/// The instructions move bytes in a way that depends on the offset and the length only.
#[test]
fn all_offsets_and_lengths() {
    #[repr(align(64))]
    struct Lines([u8; 256]);
    for other in [0xa5, 0, 255].into_iter().step_by(STEP) {
        for (at, len) in (64..128).step_by(STEP).flat_map(|at| (0..=66).step_by(STEP).map(move |len| (at, len))) {
            for zero in [usize::MAX, 0, len / 2, len.wrapping_sub(1)] {
                let mut all = Lines([other; 256]);
                for i in 0..len {
                    all.0[at + i] = if i / 8 == zero / 8 { 0 } else { 1 + i as u8 }
                }
                check_all(&all.0[at..at + len]);
            }
        }
    }
}

#[test]
fn empty_anywhere() {
    for shift in (3..usize::BITS).step_by(STEP) {
        for address in [
            1 << shift,
            (1usize << shift).wrapping_neg(),
            (2usize << shift).wrapping_sub(8),
            (1usize << shift).wrapping_add(8),
        ] {
            if address != 0 {
                check_all(unsafe { core::slice::from_raw_parts(core::ptr::without_provenance(address), 0) })
            }
        }
    }
}

/// What is around was never allocated, or never written.
#[test]
fn exact_allocations() {
    for len in (0..=66).step_by(STEP) {
        let exact: Box<[u8]> = (1..=len as u8).collect();
        for skip in (0..=len).step_by(STEP) {
            check_all(&exact[skip..])
        }
        for at in (0..32).step_by(STEP) {
            let mut all = Box::<[u8]>::new_uninit_slice(128);
            check_all(all[at..at + len].write_copy_of_slice(&exact));
        }
    }
}

#[test]
fn neighbors_are_written() {
    let mut all = vec![1u8; 256];
    for (at, len) in [(70, 5), (65, 1), (79, 2), (64, 15), (75, 31), (81, 17)].into_iter().step_by(STEP) {
        let (before, rest) = all.split_at_mut(at);
        let (part, after) = rest.split_at_mut(len);
        part.fill(1);
        let done = std::sync::atomic::AtomicBool::new(false);
        std::thread::scope(|scope| {
            for other in [before, after] {
                scope.spawn(|| {
                    while !done.load(std::sync::atomic::Ordering::Relaxed) {
                        for x in [0, 255] {
                            std::hint::black_box(&mut *other).fill(x)
                        }
                    }
                });
            }
            for _ in 0..if cfg!(miri) { 1 } else { 2000 } {
                check_all(part)
            }
            done.store(true, std::sync::atomic::Ordering::Relaxed);
        });
    }
}

#[test]
fn of_arrays() {
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    fn sums(len: usize) -> u32 {
        let s: S = bun_simd::prelude::isa();
        let (mut all, mut sum) = ([0u8; 64], 0);
        let (part, after) = all.split_at_mut(len);
        for x in 1..5 {
            part.fill(x);
            after[0] = 100 + x;
            sum += s.load_or_default::<u8, S::Native>(part).sum_groups::<u64>().reduce_sum() as u32;
        }
        sum
    }
    for len in 0..16 {
        for target in sums::targets() {
            assert_eq!(sums::to(target, std::hint::black_box(len)), Some(10 * len as u32))
        }
    }
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    fn short(outer: &mut [u8; 64], len: usize) -> [u8; 4] {
        let s: S = bun_simd::prelude::isa();
        let mut all = [0u8; 64];
        let (outer, own) = (&mut outer[3..][..1 + len % 15], &mut all[..1 + len % 15]);
        let first = |of: &[u8]| s.load_or_default::<u8, S::Native>(of).to_array().as_ref()[0];
        (outer[0], own[0]) = (1, 2);
        let (a, b) = (first(outer), first(own));
        (outer[0], own[0]) = (3, 4);
        let (c, d) = (first(outer), first(own));
        outer[0] = 0;
        [a, b, c, d]
    }
    for len in 0..16 {
        for target in short::targets() {
            assert_eq!(short::to(target, &mut [0; 64], std::hint::black_box(len)), Some([1, 2, 3, 4]))
        }
    }
}

#[cfg(all(target_os = "linux", target_pointer_width = "64", not(miri)))]
mod linux {
    use super::*;
    unsafe extern "C" {
        fn mmap(at: *mut u8, len: usize, protection: i32, flags: i32, file: i32, offset: i64) -> *mut u8;
        fn mprotect(at: *mut u8, len: usize, protection: i32) -> i32;
    }
    const PAGE: usize = 65536;

    #[test]
    fn between_absent_pages() {
        let page = unsafe {
            let at = mmap(core::ptr::null_mut(), 3 * PAGE, 0, 0x22, -1, 0).add(PAGE);
            assert_eq!(mprotect(at, PAGE, 3), 0);
            at.write_bytes(7, PAGE);
            core::slice::from_raw_parts(at, PAGE)
        };
        for len in 0..=66 {
            for gap in 0..34 {
                check_all(&page[gap..][..len]);
                check_all(&page[PAGE - gap - len..][..len]);
            }
        }
    }
}
