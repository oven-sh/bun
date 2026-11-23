//! A function without a mark is right and slow. With `--cfg bun_simd_check`, this doesn't link.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{Isa, prelude::*};

#[inline(never)]
fn twice<S: Isa>(v: u8xN<S>) -> u8xN<S> {
    v.saturating_add(v)
}

#[test]
#[kernel(avx2, sve2)]
fn right() {
    assert_eq!(twice(u8xN::splat(std::hint::black_box(3))), 6);
}
