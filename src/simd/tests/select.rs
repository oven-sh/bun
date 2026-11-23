//! partial_sort and select_nth.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{mem::bitcast_slice, *};
use framework::*;

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn both<T: Lane>(x: &mut [T], y: &mut [T], from: usize, to: usize) -> Option<T> {
    let s: S = bun_simd::prelude::isa();
    s.over_mut(x).partial_sort(from..to);
    if from < y.len() { Some(s.over_mut(y).select_nth(from)) } else { None }
}

fn one<T: Test>(values: &[T], sorted: &[T], from: usize, to: usize) {
    for target in targets() {
        let (mut x, mut y) = (values.to_vec(), values.to_vec());
        let Some(nth) = both::to(target, &mut x, &mut y, from, to) else { continue };
        sort(&mut x[..from]);
        sort(&mut x[to..]);
        assert_eq!(bitcast_slice::<T::Unsigned>(&x), bitcast_slice::<T::Unsigned>(sorted), "{target:?} {from} {to}");
        assert_eq!(nth.map(Test::to_bits), sorted.get(from).map(|it| it.to_bits()));
    }
}

fn check<T: Test>() {
    let mut state = 1u64;
    let mut next = || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        state >> 20 ^ state << 30
    };
    for round in 0..if cfg!(miri) { 3 } else { 600 } {
        let (len, few) = (next() as usize % [10, 300, 3000][round % 3], [3, 1000, u64::MAX][next() as usize % 3]);
        let values: Vec<T> =
            (0..len).map(|_| T::from_bits((next() % few).wrapping_mul(0x9e37_79b9_7f4a_7c15))).collect();
        let (to, mut sorted) = (next() as usize % (len + 1), values.clone());
        let from = next() as usize % (to + 1);
        sort(&mut sorted);
        one(&values, &sorted, from, to);
    }
}

/// Up to the end, and next to many values that are the least.
fn edges<T: Test>() {
    for (len, others) in
        [(1, 1), (9, 1), (200, 1), (300, 1), (1500, 5)].into_iter().take(if cfg!(miri) { 2 } else { 5 })
    {
        let mut values: Vec<T> =
            (0..len as u64).map(|i| T::from_bits((i + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 7)).collect();
        let mut sorted = values.clone();
        sort(&mut sorted);
        values.iter_mut().enumerate().filter(|(i, _)| i % others != 0).for_each(|(_, it)| *it = sorted[0]);
        sorted.copy_from_slice(&values);
        sort(&mut sorted);
        let least = len - len / others;
        for (from, to) in [
            (0, len),
            (len - 1, len),
            (len / 2, len - 1),
            (least / 2, least),
            (least / 2, len),
            (least, least + 1),
            (len - len / 9, len - len / 10),
        ] {
            one(&values, &sorted, from, to);
        }
    }
}

/// Few of many, at both ends: at random, with the best values first, last, or in an order in which nearly all beat those before them.
fn few<T: Test>() {
    let mut state = 1u64;
    let mut next = || {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        state >> 20 ^ state << 30
    };
    for round in 0..if cfg!(miri) { 2 } else { 120 } {
        let (len, few) = (250 + next() as usize % [900, 9000][round % 2], [2, 40, u64::MAX][round % 3]);
        let mut values: Vec<T> =
            (0..len).map(|_| T::from_bits((next() % few).wrapping_mul(0x9e37_79b9_7f4a_7c15))).collect();
        let mut sorted = values.clone();
        sort(&mut sorted);
        if round % 5 > 1 {
            values.copy_from_slice(&sorted);
            if round % 5 == 2 {
                values.reverse();
            }
            values.rotate_left([1, 19, 150, len / 2, len - 19, len - 1][next() as usize % 6]);
            values.swap(next() as usize % len, next() as usize % len);
        }
        let count = 1 + next() as usize % (len / [100, 400, 2000][next() as usize % 3] + 1);
        let part = next() as usize % count;
        for (from, to) in [(0, count), (part, count), (len - count, len), (len - count, len - part)] {
            one(&values, &sorted, from, to);
        }
    }
}

#[test]
fn few_of_many() {
    few::<u16>();
    few::<f32>();
    few::<i64>();
}

/// The x87 would make these quiet.
#[test]
fn few_of_signaling_nans() {
    #[bun_simd::simd]
    fn on() {
        let mut bits: Vec<u32> =
            (0..4001u32).map(|i| 0x7f80_0001 + (i.wrapping_mul(2654435761) >> 7) % 0x3f_fff0).collect();
        let mut sorted = bits.clone();
        sorted.sort();
        bun_simd::prelude::over_mut(bun_simd::prelude::bitcast_slice_mut::<f32>(&mut bits)).partial_sort(3999..4001);
        assert_eq!(bits[3999..], sorted[3999..]);
        bits.sort();
        assert_eq!(bits, sorted);
    }
    on::<bun_simd::target::Baseline>()
}

#[test]
fn edges_8() {
    edges::<i8>();
    edges::<u8>()
}
#[test]
fn edges_16() {
    edges::<u16>()
}
#[test]
fn edges_32() {
    edges::<f32>()
}
#[test]
fn edges_64() {
    edges::<i64>()
}

#[test]
fn parts() {
    check::<i8>();
    check::<u16>();
    check::<f32>();
    check::<i64>();
}

#[test]
#[cfg_attr(not(panic = "unwind"), ignore = "needs unwinding")]
fn out_of_bounds() {
    use bun_simd::prelude::*;
    #[bun_simd::simd]
    fn on() {
        assert!(std::panic::catch_unwind(|| over_mut(&mut [1, 2]).select_nth(2)).is_err());
        assert!(std::panic::catch_unwind(|| over_mut(&mut [1, 2]).partial_sort(1..3)).is_err());
    }
    on::<bun_simd::target::Baseline>()
}
