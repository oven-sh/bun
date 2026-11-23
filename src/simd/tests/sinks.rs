//! The loops that read, from each kind of `Readable`. sinks_*.rs have those that write.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(unused_imports)]
include!("framework/sinks.rs");

type Read = (u8, Option<(u8, u8)>, [Option<usize>; 4], u64, Vec<usize>, u32, u8, [bool; 2]);
#[kernel(targets = bun_simd::target::Targets::ALL)]
fn read<W: Width, E: Readable<u8>, F: Readable<u8>>(x: &[E], y: &[F], _of: W) -> Read {
    let s: S = bun_simd::prelude::isa();
    let all = s.over(x).by::<W>();
    let (zero, odd) = (
        s.zero::<u8, W>(),
        #[inline(always)]
        |v: Simd<u8, W, S>| v.any_bits(1),
    );
    assert_eq!(all.min().zip(all.max()), all.min_max());
    let positions = [
        all.position_min(),
        all.position_max(),
        all.position_of_any(&[7, 200]),
        all.zip(y).position(
            #[inline(always)]
            |(a, b)| a.simd_eq(b),
        ),
    ];
    let bits = s.over(&x[..x.len().min(64)]).by::<W>().bitmask(odd);
    let xor = all
        .fold(
            zero,
            #[inline(always)]
            |a, v| a ^ v,
            #[inline(always)]
            |a, b| a ^ b,
        )
        .reduce_xor();
    (
        all.sum(),
        all.min_max(),
        positions,
        bits,
        all.positions(odd).collect(),
        all.zip(y).dot_wide(),
        xor,
        [all.any(odd), all.all(odd)],
    )
}

fn reads<W: Width + Copy>(w: W) {
    for (x, y) in inputs() {
        let at = |it: Option<&u8>| x.iter().position(|v| Some(v) == it);
        let want: Read = (
            x.iter().fold(0, |a, b| a.wrapping_add(*b)),
            x.iter().copied().min().zip(x.iter().copied().max()),
            [at(x.iter().min()), at(x.iter().max()), at(Some(&7)), x.iter().zip(&y).position(|(a, b)| a == b)],
            x.iter().take(64).rev().fold(0, |a, b| a << 1 | (b & 1) as u64),
            (0..x.len()).filter(|&i| x[i] & 1 == 1).collect(),
            x.iter().zip(&y).map(|(&a, &b)| a as u32 * b as u32).sum(),
            x.iter().fold(0, |a, b| a ^ b),
            [x.iter().any(|it| it & 1 == 1), x.iter().all(|it| it & 1 == 1)],
        );
        for &target in Target::ALL {
            for got in
                [read::to(target, &x, &y, w), read::to(target, &cells(&x), &atomics(&y), w)].into_iter().flatten()
            {
                assert_eq!(got, want, "{target:?} {}", x.len());
            }
        }
    }
}
#[test]
fn from_any_readable() {
    reads(B8);
    reads(B64);
}

#[test]
fn floats() {
    let s = baseline();
    for n in 0..100 {
        let x: Vec<f32> = (0..n).map(|i| (i * 7 % 23) as f32 * 0.37 - 3.0).collect();
        let bytes = atomics(&x.iter().flat_map(|it| it.to_ne_bytes()).collect::<Vec<_>>());
        let (plain, shared) = (s.over(&x), s.over::<f32, _>(bytes.as_chunks::<4>().0));
        assert_eq!(
            (plain.sum(), plain.min_max(), plain.position_max(), plain.zip(&x).dot()),
            (shared.sum(), shared.min_max(), shared.position_max(), shared.zip(&x).dot())
        );
        let mut y = x.clone();
        s.over_mut(&mut y).zip::<f32, _>(bytes.as_chunks::<4>().0).map(|(a, b)| a - b);
        assert!(y.iter().all(|it| *it == 0.0));
    }
}

/// A reference can be used again.
#[test]
fn again() {
    let (s, mut room) = (baseline(), [MaybeUninit::<u8>::uninit(); 9]);
    let out = &mut Output::new(&mut room);
    for row in [[1u8, 2, 3], [4, 5, 6], [7, 8, 9]] {
        s.over(&row).map_into(out, |v| v + 1);
    }
    assert_eq!(out.filled(), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
}

#[test]
fn filled_by_reference() {
    let mut room = [MaybeUninit::<u8>::uninit(); 4];
    let mut out = Output::new(&mut room);
    assert!(out.filled().is_empty());
    out.push(&[1, 2]);
    out.filled_mut()[0] = 3;
    let (a, b) = (&out, &out);
    assert_eq!((a.filled(), b.filled().len()), (&[3, 2][..], a.len()));
}

#[kernel(targets = bun_simd::target::Targets::ALL)]
fn odd(from: &[u8], mut to: &[Cell<u8>]) -> usize {
    bun_simd::prelude::over(from).by::<B16>().filter_into(&mut to, |v| v.any_bits(1))
}

#[test]
fn filters_need_room_for_what_is_kept() {
    for (len, target) in (1..50).flat_map(|len| odd::targets().map(move |it| (len, it))) {
        let (from, to): (Vec<u8>, _) = ((0..2 * len as u8).collect(), cells(&[0; 70]));
        assert_eq!(odd::to(target, &from, &to[..len]), Some(len), "{target:?}");
        assert!((0..70).all(|i| to[i].get() as usize == if i < len { 2 * i + 1 } else { 0 }), "{target:?} {len}");
        let (ones, to) = (vec![1; len], cells(&[0; 70]));
        let short = std::panic::AssertUnwindSafe(|| odd::to(target, &ones, &to[..len - 1]));
        assert!(!cfg!(panic = "unwind") || std::panic::catch_unwind(short).is_err(), "{target:?} {len}");
        assert!(to[len - 1..].iter().all(|it| it.get() == 0), "{target:?} {len}");
    }
}
