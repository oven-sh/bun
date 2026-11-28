//! Loops at each length up to beyond their last class, and at several addresses.
#![allow(dead_code, unreachable_pub)]

use bun_simd::prelude::*;
use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

fn next(state: &mut u64) -> u64 {
    *state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
    *state >> 20
}

macro_rules! ints { ($($name:ident $t:ident)*) => {$(
    #[test]
    fn $name() {
        #[kernel(icelake, avx2, sse4, sve2, neon86, neon82, neon)]
        fn check(x: &[$t], y: &[$t], room: &mut [$t]) {
            let len = x.len();
            assert_eq!(over(x).sum(), x.iter().fold(0, |a: $t, b| a.wrapping_add(*b)), "{len}");
            assert_eq!((over(x).min(), over(x).max()), (x.iter().min().copied(), x.iter().max().copied()), "{len}");
            assert_eq!(over(x).zip(y).count(|(a, b)| a.simd_lt(b)), x.iter().zip(y).filter(|(a, b)| a < b).count(), "{len}");
            over(x).zip(y).map_into(room, |(a, b)| a ^ b);
            assert!(room.iter().copied().eq(x.iter().zip(y).map(|(a, b)| a ^ b)), "{len}");
            over_mut(room).zip(y).map(|(a, b)| a ^ b);
            assert_eq!(room, x);
            over_mut(room).reverse();
            assert!(room.iter().eq(x.iter().rev()), "{len}");
            over(x).map_into(room, |v| v & 1);
            over_mut(room).map(|v| v + 1);
            let mut model: Vec<$t> = x.iter().map(|v| (v & 1) + 1).collect();
            assert_eq!(room, model);
            model.dedup();
            let kept = over_mut(room).dedup();
            assert_eq!(room[..kept], model);
            over_mut(room).fill_with(|i| i + 3);
            assert!(room.iter().copied().eq((0..len).map(|i| (i + 3) as $t)), "{len}");
            over_mut(room).prefix_sum();
            assert!(room.iter().copied().eq((0..len).map(|i| ((i + 1) * (i + 6) / 2) as $t)), "{len}");
            // One match, and then two that are far apart.
            room.fill(0);
            for at in [x.first().map_or(0, |it| (*it as usize).wrapping_mul(97)), len * 3 / 4, usize::MAX].map(|it| it % len.max(1)) {
                let Some(it) = room.get_mut(at) else { break };
                *it = 1;
                let all = || room.iter().enumerate().filter(|it| *it.1 == 1).map(|it| it.0);
                assert!(over(room).positions(|v| v.simd_eq(1)).eq(all()), "{len}");
                assert!(over(room).zip(x).positions(|(v, _)| v.simd_eq(1)).eq(all()), "{len}");
                assert_eq!(over(room).position(|v| v.simd_ne(0)), all().next());
                assert_eq!(over(room).rposition(|v| v.simd_ne(0)), all().next_back());
                assert!(over(room).any(|v| v.simd_eq(1)), "{len}");
            }
        }
        let mut state = 1;
        let [x, y] = [(); 2].map(|_| (0..1500).map(|_| next(&mut state) as $t).collect::<Vec<_>>());
        for target in check::targets() {
            for len in 0..1400 / size_of::<$t>() {
                let (at, mut room) = (next(&mut state) as usize % 32, vec![7; len + 64]);
                check::to(target, &x[at..][..len], &y[len % 7..][..len], &mut room[32 - at / 2..][..len]);
                assert!(room[..32 - at / 2].iter().chain(&room[32 - at / 2 + len..]).all(|it| *it == 7));
            }
        }
    }
)*}; }
ints! { of_8 u8 of_16 u16 of_32 u32 of_64 u64 }

#[test]
fn floats_and_products() {
    #[kernel(icelake, avx2, sse4, sve2, neon86, neon82, neon)]
    fn check(x: &[u8], y: &[u8]) {
        let dot: u32 = x.iter().zip(y).map(|(a, b)| *a as u32 * *b as u32).sum();
        assert_eq!(over(x).zip(y).dot_wide(), dot);
        let [a, b] = [x, y].map(|it| it.iter().map(|it| *it as i16).collect::<Vec<_>>());
        assert_eq!(over(&a).zip(&b).dot_wide(), dot as i32);
        let [a, mut b] = [x, y].map(|it| it.iter().map(|it| *it as f64).collect::<Vec<_>>());
        assert_eq!(over(&a).zip(&b).dot_relaxed(), dot as f64);
        assert_eq!(over(&a).sum_relaxed(), a.iter().sum());
        // What is seen twice is left out on both sides.
        for at in b.len().saturating_sub(9)..b.len() {
            let (before, ones) = (core::mem::replace(&mut b[at], f64::INFINITY), vec![1.0; b.len()]);
            assert_eq!([over(&ones).zip(&b).dot_relaxed(), over(&b).zip(&ones).dot_relaxed()], [f64::INFINITY; 2]);
            b[at] = before;
        }
    }
    let mut state = 2;
    let x: Vec<u8> = (0..1500).map(|_| next(&mut state) as u8).collect();
    for target in check::targets() {
        for len in 0..1200 {
            check::to(target, &x[len % 17..][..len], &x[200..][..len]);
        }
    }
}

#[test]
fn shared() {
    #[kernel(icelake, avx2, sse4, sve2, neon)]
    fn check(x: &[AtomicU8], model: &[u8]) {
        over(x).map_into(&mut { x }, |v: u8xN<S>| v + 1);
        let mut copy = vec![0; x.len()];
        over(x).map_into(&mut copy[..], |v: u8xN<S>| v - 1);
        assert_eq!(copy, model);
        assert_eq!(over(x).count(|v: u8xN<S>| v.simd_eq(9)), model.iter().filter(|it| **it == 8).count());
        assert_eq!(over(x).position(|v: u8xN<S>| v.simd_eq(9)), model.iter().position(|it| *it == 8));
        assert_eq!(over(x).rposition(|v: u8xN<S>| v.simd_eq(9)), model.iter().rposition(|it| *it == 8));
    }
    let mut state = 3;
    for target in check::targets() {
        for len in 0..600 {
            let model: Vec<u8> = (0..len + 40).map(|_| next(&mut state) as u8).collect();
            let x: Vec<_> = model.iter().map(|it| AtomicU8::new(*it)).collect();
            check::to(target, &x[len % 19..][..len], &model[len % 19..][..len]);
            assert!((0..len % 19).chain(len % 19 + len..len + 40).all(|i| x[i].load(Relaxed) == model[i]));
        }
    }
}
