//! Shared memory at addresses that only pointers give, and its order among atomics.
#![allow(dead_code, unreachable_pub)]
#![cfg(not(target_family = "wasm"))]
#![allow(unused_imports)]
use bun_simd::{mem::*, target::*, *};
use core::sync::atomic::{AtomicU8, Ordering::*, fence};

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn read<W: Width>(from: &[AtomicU8], _of: W) -> u8 {
    let s: S = bun_simd::prelude::isa();
    s.load_or_default::<u8, W>(from).reduce_max()
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn write<W: Width>(mut to: &[AtomicU8], x: u8, _of: W) {
    let s: S = bun_simd::prelude::isa();
    s.splat::<u8, W>(x).store_partial_at(&mut to, 0)
}
macro_rules! widths {
    ($t:ident, $w:ident, $e:expr) => {
        for &$t in Target::ALL.iter().filter(|it| it.is_supported()) {
            {
                let $w = B2;
                $e
            }
            {
                let $w = B4;
                $e
            }
            {
                let $w = B8;
                $e
            }
            {
                let $w = B16;
                $e
            }
            {
                let $w = B32;
                $e
            }
            {
                let $w = B64;
                $e
            }
        }
    };
}

/// An empty slice can be anywhere: in the kernel, where there is no address, or at the end of all.
#[test]
fn empty() {
    for shift in 0..usize::BITS {
        for address in [
            1 << shift,
            (1usize << shift).wrapping_neg(),
            (2usize << shift).wrapping_sub(1),
            (1usize << shift).wrapping_sub(5),
        ] {
            let it = unsafe { core::slice::from_raw_parts(core::ptr::without_provenance::<AtomicU8>(address), 0) };
            widths!(target, w, {
                assert_eq!(read::to(target, it, w), Some(0));
                write::to(target, it, 1, w);
            });
        }
    }
}

/// Loads write nothing, and stores nothing behind the slice.
#[test]
#[cfg(all(target_os = "linux", target_pointer_width = "64", not(miri)))]
fn read_only() {
    unsafe extern "C" {
        fn mmap(at: *mut u8, len: usize, protection: i32, flags: i32, file: i32, offset: i64) -> *mut u8;
        fn mprotect(at: *mut u8, len: usize, protection: i32) -> i32;
    }
    const PAGE: usize = 65536;
    let all = unsafe {
        let at = mmap(core::ptr::null_mut(), 3 * PAGE, 3, 0x22, -1, 0);
        at.write_bytes(7, 2 * PAGE);
        assert_eq!(mprotect(at.add(PAGE), PAGE, 1), 0);
        core::slice::from_raw_parts(at.cast::<AtomicU8>(), 2 * PAGE)
    };
    for len in 0..=130 {
        widths!(target, w, {
            assert_eq!(read::to(target, &all[PAGE + 3..][..len], w), Some(if len > 0 { 7 } else { 0 }));
            write::to(target, &all[PAGE - len..PAGE], 7, w);
            write::to(target, &all[PAGE + len..][..0], 7, w);
        });
    }
    // Nothing can be read around the rest.
    let one = if cfg!(target_arch = "x86_64") { 4096 } else { PAGE };
    let (start, all) = (all.as_ptr().cast_mut().cast::<u8>(), &all[PAGE..][..one]);
    assert_eq!(unsafe { mprotect(start, PAGE, 0) | mprotect(start.add(PAGE + one), 2 * PAGE - one, 0) }, 0);
    for (at, len) in (0..70).chain(one - 70..one).flat_map(|at| (1..=70.min(one - at)).map(move |len| (at, len))) {
        widths!(target, w, assert_eq!(read::to(target, &all[at..][..len], w), Some(7)));
    }
}

#[cfg(not(miri))]
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn turn<W: Width>(mut it: &[AtomicU8], seen: &mut [u8], _of: W) -> usize {
    let s: S = bun_simd::prelude::isa();
    let v = s.load_or_default::<u8, W>(it);
    assert!(v == s.load_or::<u8, W>(it, 0));
    v.store(seen);
    (!v).store_partial_at(&mut it, 0);
    W::BYTES
}

fn zeros() -> Vec<AtomicU8> {
    (0..4500).map(|_| AtomicU8::new(0)).collect()
}
/// Index 200 is aligned to 4096.
fn around(all: &[AtomicU8]) -> &[AtomicU8] {
    &all[all[200..].as_ptr().addr().wrapping_neg() % 4096..][..400]
}

/// Each byte is in its lane, and the neighbors stay, wherever a page ends.
#[test]
#[cfg(not(miri))]
fn around_a_page() {
    let value = |i: usize| (i % 251) as u8 + 1;
    let all = zeros();
    let all = &around(&all)[120..320];
    for at in 10..120 {
        for len in 0..=70 {
            widths!(target, w, {
                all.iter().enumerate().for_each(|(i, it)| it.store(value(i), Relaxed));
                let mut seen = [0; 64];
                let n = turn::to(target, &all[at..][..len], &mut seen, w).unwrap().min(len);
                assert_eq!(
                    seen,
                    core::array::from_fn(|i| if i < n { value(at + i) } else { 0 }),
                    "{target:?} {at} {len}"
                );
                for (i, it) in all.iter().enumerate() {
                    assert_eq!(it.load(Relaxed), if (at..at + n).contains(&i) { !value(i) } else { value(i) });
                }
            });
        }
    }
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn count<W: Width>(mut to: &[AtomicU8], data: &AtomicU8, _of: W) {
    let s: S = bun_simd::prelude::isa();
    for x in 1..=255 {
        data.store(x, Relaxed);
        fence(Release);
        s.splat::<u8, W>(x).store_partial_at(&mut to, 0);
    }
}
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn watch<W: Width>(from: &[AtomicU8], data: &AtomicU8, _of: W) {
    let s: S = bun_simd::prelude::isa();
    let mut before = s.zero::<u8, W>();
    loop {
        let first = from[0].load(Relaxed);
        let now = s.load_or_default::<u8, W>(from);
        let last = from[0].load(Relaxed);
        fence(Acquire);
        assert!(data.load(Relaxed) >= now.reduce_max());
        assert!(
            first <= now.to_array().as_ref()[0] && now.to_array().as_ref()[0] <= last && now.simd_lt(before).none()
        );
        if last == 255 {
            return;
        }
        before = now;
    }
}

/// No byte goes back in time, a loop sees stores, and fences work. The bytes cross a line of the cache, or are near the end of a page.
#[test]
fn order() {
    for round in 0..if cfg!(miri) { 1 } else { 120 } {
        widths!(target, w, {
            let (lines, data) = (zeros(), AtomicU8::new(0));
            let bytes = &around(&lines)[[71, 199, 180, 150][round % 4] - round % 7..][..1 + round * 13 % 70];
            std::thread::scope(|scope| {
                scope.spawn(|| watch::to(target, bytes, &data, w));
                count::to(target, bytes, &data, w);
            });
        });
    }
}

/// A neighbor that is written all the time is never set back by a partial store.
#[test]
fn neighbors() {
    widths!(
        target,
        w,
        for len in [0, 1, 2, 3, 5, 9, 15, 17, 31, 33, 63] {
            let all = [const { AtomicU8::new(0) }; 130];
            let done = AtomicU8::new(0);
            std::thread::scope(|scope| {
                scope.spawn(|| {
                    while done.load(Relaxed) == 0 {
                        write::to(target, &all[1..][..len], 9, w);
                    }
                });
                for x in 0..if cfg!(miri) { 2u32 } else { 3000 } {
                    for it in [&all[0], &all[1 + len], &all[2 + len]] {
                        // No `fetch_add`: `stxrb` starves next to these stores.
                        let old = it.load(Relaxed);
                        it.store(old.wrapping_add(1), Relaxed);
                        if old != x as u8 {
                            done.store(1, Relaxed);
                            panic!("{target:?} {len}")
                        }
                    }
                }
                done.store(1, Relaxed);
            });
        }
    );
}

/// Neighbors that are written all the time don't show in a partial load.
#[test]
#[cfg(not(miri))]
fn others() {
    let all = zeros();
    let all = around(&all);
    for (at, len) in [(199, 1), (190, 3), (185, 15), (170, 17), (190, 31), (150, 33), (140, 60), (199, 63)] {
        let fill = |x| all[..at].iter().chain(&all[at + len..]).for_each(|it| it.store(x, Relaxed));
        all.iter().for_each(|it| it.store(0, Relaxed));
        fill(1);
        std::thread::scope(|scope| {
            let reader = scope.spawn(|| {
                widths!(target, w, (0..3000).for_each(|_| assert_eq!(read::to(target, &all[at..][..len], w), Some(0))))
            });
            (1..=255).cycle().take_while(|_| !reader.is_finished()).for_each(fill);
        });
    }
}
