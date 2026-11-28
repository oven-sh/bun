//! Each kind of piece, in each room.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::prelude::*;
use bun_simd::target::{Target, set_cpu};

/// Pushes with each room from none to more than enough.
#[simd]
#[inline(never)]
fn tried<T: Copy + PartialEq + core::fmt::Debug>(piece: impl Piece<T>, want: &[T], mark: T, most: usize) {
    let step = if cfg!(miri) { 7 } else { 1 };
    let near = want.len().saturating_sub(1)..want.len() + 2;
    for (room, before) in (0..most + 2).step_by(step).chain(near).zip([0, 3].into_iter().cycle()) {
        let mut all = vec![mark; before + room + 8];
        let mut out = Output::overwrite(&mut all[..before + room]);
        out.push(&[mark; 3][..before]);
        assert_eq!(out.try_push(piece).is_some(), room >= want.len(), "{room} {want:?}");
        assert_eq!(out.filled()[before..], want[..if room >= want.len() { want.len() } else { 0 }]);
        if room >= want.len() {
            out.truncate(before);
            out.push(piece);
            assert_eq!(&out.filled()[before..], want);
        }
        if room >= most {
            out.truncate(before);
            out.push_with_slack(piece);
            assert_eq!(&out.filled()[before..], want);
        }
        assert!(all[..before].iter().chain(&all[before + room..]).all(|&it| it == mark));
        let mut vec = Vec::with_capacity(room);
        let fits = Output::append(&mut vec, room).try_push(piece).is_some();
        assert_eq!(vec, want[..if fits { want.len() } else { 0 }]);
    }
}

#[kernel(icelake, avx512, avx2, sse4, sve2, neon, wasm)]
fn vectors<T: Unsigned, W: Width>(n: usize, bits: u64, _: T, _of: W) {
    let (v, lanes, mark) = (Simd::<T, W, S>::iota(T::ONE), Simd::<T, W, S>::LANES, T::MAX);
    let all = v.to_array().as_ref().to_vec();
    let first = &all[..n.min(lanes)];
    tried(v, &all, mark, lanes);
    tried(v.first_n(n), first, mark, lanes);
    tried((T::ZERO, v.first_n(n), v), &[&[T::ZERO], first, &all].concat(), mark, 2 * lanes + 1);
    tried([v.first_n(n); 3], &first.repeat(3), mark, 3 * lanes);
    tried((v.first_n(n), first, v.first_n(1)), &[first, first, &all[..1]].concat(), mark, 3 * lanes);
    if const { Simd::<T, W, S>::LANES <= 64 } {
        let kept: Vec<T> = (0..lanes).filter(|i| bits >> i & 1 == 1).map(|i| all[i]).collect();
        tried(v.selected(bits), &kept, mark, lanes);
        let among = (0..n.min(lanes)).filter(|i| bits >> i & 1 == 1).count();
        tried(v.first_n(n).selected(MaskOf::<T, W, S>::from_bitmask(bits)), &kept[..among], mark, lanes);
        tried(v.selected(MaskOf::<T, W, S>::from_bitmask(bits)), &kept, mark, lanes);
        tried(
            (v.selected(bits), v.selected(bits)).first_n(n),
            &kept.repeat(2)[..n.min(2 * kept.len())],
            mark,
            2 * lanes,
        );
    }
}

#[kernel(icelake, avx512, avx2, sse4, sve2, neon, wasm)]
fn low<T: Unsigned, W: Width>(n: usize, more: u64, _: T, _of: W) {
    let (bytes, size) = (Simd::<u8, W, S>::iota(1), size_of::<T>());
    let want = |n: usize| -> Vec<u8> {
        let more = |i: usize| (more >> (i * size.ilog2() as usize)) as usize % size;
        (0..n.min(W::BYTES / size)).flat_map(|i| (0..=more(i)).map(move |j| (1 + i * size + j) as u8)).collect()
    };
    tried(bytes.bitcast::<T>().low_bytes(more), &want(usize::MAX), 255, W::BYTES);
    tried(bytes.bitcast::<T>().first_n(n).low_bytes(more), &want(n), 255, W::BYTES);
}

#[kernel(icelake, avx512, avx2, sse4, sve2, neon, wasm)]
fn others(n: usize) {
    tried(7u16, &[7], 0, 1);
    tried(7u16.first_n(n), &[7][..n.min(1)], 0, 1);
    tried([1.0f32, 2.0], &[1.0, 2.0], 0.0, 2);
    tried([1u8, 2, 3].first_n(n), &[1, 2, 3][..n.min(3)], 0, 3);
    tried(&[true], &[true], false, 1);
    tried((&[[1u8; 3], [2; 3], [3; 3], [4; 3]]).first_n(n), &[[1; 3], [2; 3], [3; 3], [4; 3]][..n.min(4)], [0; 3], 4);
    tried((&[(); 5]).first_n(n), &[(); 5][..n.min(5)], (), 5);
    tried((&[0u8; 0]).first_n(n), &[], 0, 0);
    tried(b"abc"[..].first_n(n), &b"abc"[..n.min(3)], 0, 3);
    tried((&[5u8; 600]).first_n(n), &[5; 600][..n.min(600)], 0, 600);
    tried([&b"ab"[..], b"c"], b"abc", 0, 3);
    tried((1u8, (2, 3), [4, 5], &[6], 7, 8), &[1, 2, 3, 4, 5, 6, 7, 8], 0, 8);
    let mut text = String::new();
    Output::append(&mut text, 16 + n.min(16)).push((u8x16::splat(0xe1).ascii(), u8x16::splat(b'b').ascii().first_n(n)));
    let mut other = String::new();
    Output::append(&mut other, n.min(16)).push(u8x16::splat(0xe2).first_n(n).ascii());
    assert_eq!(other, text[16..]);
    assert_eq!(text, "a".repeat(16) + &"b".repeat(n.min(16)));
}

#[test]
fn all_need_room_only_for_what_they_add() {
    for _ in Target::ALL.iter().filter(|&&it| set_cpu(it)) {
        let mut bits = 0x9e37_79b9_7f4a_7c15u64;
        let some: &[usize] =
            if cfg!(miri) { &[0, 9] } else { &[0, 1, 2, 3, 5, 7, 8, 9, 15, 17, 31, 33, 63, 64, 200, usize::MAX] };
        for &n in some {
            bits = bits.wrapping_mul(0xbf58_476d_1ce4_e5b9).rotate_left(17);
            let bits = [bits, 0, !0, bits & bits >> 7][n % 4];
            vectors(n, bits, 0u8, B4);
            vectors(n, bits, 0u8, B16);
            vectors(n, bits, 0u8, B64);
            vectors(n, bits, 0u16, B64);
            vectors(n, bits, 0u32, B16);
            vectors(n, bits, 0u32, B32);
            vectors(n, bits, 0u64, B128);
            if !cfg!(miri) {
                vectors(n, bits, 0u16, B512);
            }
            low(n, bits, 0u16, B16);
            low(n, bits, 0u16, B64);
            low(n, bits, 0u32, B32);
            low(n, bits, 0u64, B64);
            others(n);
        }
    }
}

#[test]
#[should_panic = "is full"]
fn a_part_that_does_not_fit() {
    Output::overwrite(&mut [0; 2]).push(u8x16::<Baseline>::zero().first_n(3));
}

#[test]
#[should_panic]
fn a_tuple_that_does_not_fit() {
    Output::overwrite(&mut [0u8; 2]).push((1, 2, 3));
}
