//! The speed of most kernels rests on inlined helpers, which a new compiler can change.

use bun_simd::prelude::*;
use core::hint::black_box;

/// The same for all calls from one frame.
#[inline(never)]
fn depth() -> usize {
    let it = 0u8;
    black_box(&raw const it).addr()
}

#[simd]
fn long(mut v: u32xN<S>, rows: &[u32]) -> (u32xN<S>, usize) {
    let here = depth();
    unroll!(for i in 0..32 {
        v = (v * v + 1) ^ u32xN::load(&rows[16 * i..]);
    });
    (v, here)
}

#[kernel]
fn depths(rows: &mut [u32]) -> [usize; 3] {
    let here = depth();
    let (v, first) = long(u32xN::load(rows), rows);
    let (v, second) = long(v, &rows[1..]);
    v.store(rows);
    [here, first, second]
}

#[test]
#[cfg_attr(debug_assertions, ignore = "for release builds")]
fn long_helpers_are_inlined() {
    for target in depths::targets() {
        if let Some([here, first, second]) = depths::to(target, black_box(&mut [0; 600])) {
            assert_eq!([first, second], [here; 2], "{target:?}");
        }
    }
}
