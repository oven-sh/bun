//! Loops in order, groups of lanes in loops that map, and bytes as wider lanes.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]

#[bun_simd::simd]
mod simd {
    use bun_simd::prelude::*;
    use core::cell::Cell;

    #[kernel]
    pub fn scans(x: &[u32], y: &[u32]) {
        let (n, len) = (u32xN::LANES as u32, x.len());
        let want: Vec<u32> = (0..len).map(|i| x[i] ^ i as u32).collect();
        let both: Vec<u32> = (0..len).map(|i| want[i].wrapping_add(y[i])).collect();
        let sum = x.iter().fold(0u32, |a, b| a.wrapping_add(*b));
        macro_rules! step {
            ($at:ident, $v:expr) => {{
                let r = $v ^ $at;
                $at += n;
                r
            }};
        }
        let (mut to, mut at, mut seen) = (vec![7; len + 1], u32xN::iota(0), u32xN::zero());
        over(x).scan_into(&mut to, |v| {
            seen += v;
            step!(at, v)
        });
        assert!(
            to.pop() == Some(7)
                && to == want
                && seen.reduce_sum() == sum
                && at[0] == len.div_ceil(n as usize) as u32 * n
        );
        let (mut to, mut at) = (vec![7], u32xN::iota(0));
        over(x).zip(y).scan_into(&mut Output::append(&mut to, len), |(a, b)| step!(at, a) + b);
        assert!(to[1..] == both);
        let (mut to, mut at) = (vec![7; 2 * len + 1], u32xN::iota(0));
        u32xN::over_all([x, y]).scan_into(&mut to, |[a, b]| [step!(at, a), b]);
        assert!(to.pop() == Some(7) && (0..len).all(|i| to[2 * i..][..2] == [want[i], y[i]]));
        let (mut to, mut at) = (x.to_vec(), u32xN::iota(0));
        over_mut(&mut to).scan(|v| step!(at, v));
        assert!(to == want);
        let (mut to, mut at) = (x.to_vec(), u32xN::iota(0));
        over_mut(&mut to).zip(y).scan(|(a, b)| step!(at, a) + b);
        assert!(to == both);
        let (mut to, mut at) = (x.to_vec(), u32xN::iota(0));
        let mut cells = Cell::from_mut(&mut to[..]).as_slice_of_cells();
        over(cells).scan_into(&mut cells, |v| step!(at, v));
        assert!(to == want);
        // What the closure changes in cells that were written stays.
        let (mut to, mut other, mut at) = (vec![0; len], vec![0; len], 0);
        let amended =
            |to: &[u32]| (0..len).all(|i| to[i] == if (i + 1) % n as usize == 0 && i + 1 < len { 9 } else { x[i] });
        let mut cells = Cell::from_mut(&mut to[..]).as_slice_of_cells();
        let again = cells;
        let mut amend = |v| {
            if at > 0 {
                again[at - 1].set(9)
            }
            at = (at + n as usize) % len.next_multiple_of(n as usize);
            v
        };
        over(x).scan_into(&mut cells, &mut amend);
        assert!(amended(&again.iter().map(Cell::get).collect::<Vec<_>>()));
        over(x).unzip_into((cells, &mut other), |v| (amend(v), v));
        assert!(amended(&to) && other == x);
        let mut fewer = vec![7u64; len.div_ceil(2) + 1];
        over(x).scan_into(&mut fewer, |v| v.sum_groups::<u64>());
        assert!(
            fewer.pop() == Some(7)
                && fewer.iter().zip(x.chunks(2)).all(|(a, b)| *a == b.iter().map(|&it| it as u64).sum())
        );
        let rest = len % n as usize;
        let mut pairs = vec![7u64; len / n as usize * n as usize + rest + 1];
        over(x).scan_into(&mut pairs, |v| [v.sum_groups::<u64>(), u64xN::splat(9)]);
        assert!(
            pairs.pop() == Some(7)
                && pairs.iter().enumerate().all(|(i, &it)| it == if i % 2 == 0 { fewer[i / 2] } else { 9 })
        );
        let mut appended = vec![];
        over(x).scan_into(&mut Output::append(&mut appended, len), |v| [v.sum_groups::<u64>(), u64xN::splat(9)]);
        assert!(appended == pairs);
        let mut more = vec![7u16; 2 * len + 1];
        over(x).scan_into(&mut more, |v| v.bitcast());
        assert!(more.pop() == Some(7) && (0..len).all(|i| more[2 * i..][..2] == [x[i] as u16, (x[i] >> 16) as u16]));
    }

    #[kernel]
    pub fn groups(room: &mut [u32], x: &[u32], four: bool) {
        let turn = |v: u32xN<S>| if four { v.in_blocks().reverse() } else { v.swap_pairs() };
        let want: Vec<u32> = x.chunks(if four { 4 } else { 2 }).flat_map(|it| it.iter().rev().copied()).collect();
        over(x).map_into(room, |v| turn(v));
        assert!(room == want);
        over(x).zip(x).map_into(room, |(a, b)| turn(a) ^ b);
        assert!((0..x.len()).all(|i| room[i] == want[i] ^ x[i]));
        u32xN::over_all([x, x]).map_into(room, |[a, _]| turn(a));
        assert!(room == want);
        over_mut(room).map(|v| turn(v));
        assert!(room == x);
        over_mut(room).zip(x).map(|(a, b)| turn(a) ^ b);
        assert!((0..x.len()).all(|i| room[i] == want[i] ^ x[i]));
        let mut bits = vec![0; x.len().div_ceil(64)];
        over(x).bitmask_into(&mut bits, |v| turn(v).any_bits(1));
        assert!((0..x.len()).all(|i| bits[i / 64] >> (i % 64) & 1 == want[i] as u64 & 1));
    }

    #[kernel]
    pub fn groups_of_bytes(room: &mut [u8], x: &[u8], size: usize) {
        let turn = |v: u8xN<S>| match size {
            1 => v,
            2 => v.bitcast::<u16>().swap_bytes().bitcast(),
            4 => v.bitcast::<u32>().swap_bytes().bitcast(),
            _ => v.bitcast::<u64>().swap_bytes().bitcast(),
        };
        let want: Vec<u8> = x.chunks(size).flat_map(|it| it.iter().rev().map(|it| !it)).collect();
        over(x).map_into(room, |v| !turn(v));
        assert!(room == want);
        over_mut(room).map(|v| !turn(v));
        assert!(room == x);
        let mut all = vec![7];
        over(x).map_into(&mut *Output::append(&mut all, x.len()), |v| !turn(v));
        assert!(all[1..] == want);
        assert!(
            over(x).map_until(room, |v| v.simd_ne(v), |v| !v) == x.len() && room.iter().zip(x).all(|(a, b)| *a == !b)
        );
    }

    #[kernel]
    pub fn bytes(from: &[u8]) {
        macro_rules! of { ($($t:ident $v:ident $n:literal)*) => {$(
            let chunks = from.as_chunks::<$n>().0;
            let want: Vec<$t> = chunks.iter().map(|it| $t::from_le_bytes(*it)).collect();
            let mut to = vec![0; want.len()];
            $v::over(chunks).map_into(&mut to, |v| v);
            assert!(to == want && $v::load_or_default(chunks) == $v::load_or_default(&want) && $v::over(chunks).sum() == over(&want).sum());
            assert!($v::over(chunks).position(|v| v.any_bits(16)) == want.iter().position(|it| it & 16 != 0) && $v::over(chunks).max() == want.iter().max().copied());
            $v::over(chunks).interleaved().map_into(&mut to, |[a, b, c]| a ^ b ^ c);
            assert!(want.as_chunks::<3>().0.iter().zip(&to).all(|(a, b)| a[0] ^ a[1] ^ a[2] == *b));
        )*}; }
        of! { u16 u16xN 2 i32 i32xN 4 u64 u64xN 8 }
    }
}

fn numbers(len: usize, seed: u32) -> Vec<u32> {
    (0..len as u32).map(|i| (i ^ seed).wrapping_mul(0x9e37_79b1).rotate_left(11)).collect()
}

#[test]
fn in_order() {
    for (target, len) in simd::scans::targets().flat_map(|it| (0..70).map(move |len| (it, len))) {
        simd::scans::to(target, &numbers(len, 1), &numbers(len, 2)).unwrap();
    }
}

#[test]
fn groups_stay_together() {
    let mut room = vec![0; 1300];
    for target in simd::groups::targets() {
        for (len, at) in (0..80)
            .chain(120..140)
            .chain(250..270)
            .chain(510..520)
            .chain(1020..1030)
            .step_by(2)
            .flat_map(|len| (0..17).map(move |at| (len, at)))
        {
            simd::groups::to(target, &mut room[at..][..len], &numbers(len, 3), len % 4 == 0).unwrap();
        }
    }
}

#[test]
fn groups_of_bytes_stay_together() {
    let all: Vec<u8> = (1..=140).collect();
    for (target, size) in simd::groups_of_bytes::targets().flat_map(|it| [1, 2, 4, 8].map(|size| (it, size))) {
        for len in (0..all.len()).step_by(size) {
            let mut room = [0xee; 150];
            simd::groups_of_bytes::to(target, &mut room[3..][..len], &all[..len], size).unwrap();
            assert!(room[..3].iter().chain(&room[3 + len..]).all(|&it| it == 0xee));
        }
    }
}

#[test]
fn bytes_as_lanes() {
    let all: Vec<u8> = numbers(700, 4).iter().map(|&it| it as u8).collect();
    for (target, len) in simd::bytes::targets().flat_map(|it| (0..600).map(move |len| (it, len))) {
        simd::bytes::to(target, &all[len % 7..][..len]).unwrap();
    }
}
