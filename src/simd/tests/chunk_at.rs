//! `chunk_at` against `get`.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::mem::ChunkAt;
use std::hint::black_box;

fn each<const N: usize>() {
    for len in 0..20 {
        let mut values: Vec<usize> = (0..len).collect();
        for at in (0..24).chain((0..24).map(|i| usize::MAX - i)).chain([isize::MAX as usize, 1 << (usize::BITS - 1)]) {
            let expected = values.get(at..).and_then(|rest| rest.first_chunk::<N>()).copied();
            assert_eq!(black_box(&values[..]).chunk_at::<N>(black_box(at)).copied(), expected);
            assert_eq!(black_box(&mut values[..]).chunk_at_mut::<N>(black_box(at)).copied(), expected);
        }
    }
}

#[test]
fn all_places() {
    each::<0>();
    each::<1>();
    each::<2>();
    each::<7>();
    each::<16>();
    each::<19>();
    each::<20>();
}

#[test]
fn changes_the_slice() {
    let mut values = [0u8; 6];
    *values.chunk_at_mut(3).unwrap() = [1, 2];
    assert_eq!(values, [0, 0, 0, 1, 2, 0]);
}

#[test]
fn values_without_a_size() {
    let all = &[(); usize::MAX][..];
    assert!(all.chunk_at::<0>(usize::MAX).is_some());
    assert!(all.chunk_at::<1>(usize::MAX).is_none());
    assert!(all.chunk_at::<2>(usize::MAX - 2).is_some());
    assert!(all.chunk_at::<{ usize::MAX }>(0).is_some());
    assert!(all.chunk_at::<{ usize::MAX }>(1).is_none());
}

#[bun_simd::simd]
mod simd {
    use bun_simd::prelude::*;

    #[kernel]
    pub fn odd(from: &[u8], to: &mut [u8]) -> usize {
        let (mut at, mut len) = (0, 0);
        while let Some(from) = from.chunk_at::<{ u8xN::<S>::LANES }>(at)
            && let Some(to) = to.chunk_at_mut::<{ u8xN::<S>::LANES }>(len)
        {
            let v = u8xN::load(from);
            len += v.compress_store(to, v.any_bits(1) & mask8xN::first_n(12));
            at += 12;
        }
        len
    }
}

#[test]
fn in_a_kernel() {
    let from: Vec<u8> = (0..200).collect();
    for target in simd::odd::targets() {
        let mut to = [0; 200];
        let len = simd::odd::to(target, &from, &mut to).unwrap();
        assert!(len >= 6 * 12);
        assert!(to[..len].iter().enumerate().all(|(i, &it)| it as usize == 2 * i + 1));
    }
}
