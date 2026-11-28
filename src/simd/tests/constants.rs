#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(clippy::precedence)]
#[macro_use]
mod framework;
use bun_simd::{text::*, *};
use framework::*;

const fn table<const N: usize>(kind: u8) -> [u8; N] {
    let (mut all, mut i) = ([0; N], 0);
    while i < N {
        let at = i as u8;
        all[i] = match kind {
            0 => b"0123456789abcdef"[i % 16],
            1 => b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"[i],
            2 => 7,
            3 => at.wrapping_add(250),
            4 => {
                if i + 1 == N {
                    255
                } else {
                    0
                }
            }
            5 => {
                if i == 0 {
                    128
                } else {
                    0
                }
            }
            6 => at / 3 * 11,
            7 => {
                if i < 13 {
                    at * at
                } else {
                    144
                }
            }
            8 => {
                if i < 14 {
                    at * at
                } else {
                    169
                }
            }
            _ => at.wrapping_mul(37) ^ 0x5a,
        };
        i += 1;
    }
    all
}

/// Patterns of unpacking, packing and shifting, with few and with many distances, and chance.
const fn source(kind: usize, i: usize) -> usize {
    match kind {
        0 => i / 2,
        1 => i / 2 + 8,
        2 => i / 2 + i % 2 * 16,
        3 => 2 * i,
        4 => 2 * i + 1,
        5 => i + 3,
        6 => i ^ 1,
        7 => i ^ 2,
        8 => i / 3 * 4 + i % 3,
        9 => i / 4 * 3 + i % 4,
        10 => 255 - i,
        11 => i & !7,
        12 => i / 8,
        13 => i % 4 * 4 + i / 4,
        14 => i + i / 8 * 5,
        15 => 5,
        16 => i / 2 + 4,
        17 => i & !1 | 16,
        18 => i / 2 * 18 + i % 2,
        _ => (i * i * 7 + i * kind + (kind >> 1)) ^ i >> 1,
    }
}
const fn order(kind: usize, zeros: u16) -> [u8; 16] {
    let (mut all, mut i) = ([0; 16], 0);
    while i < 16 {
        all[i] = source(kind, i) as u8 % 128 | ((zeros >> i & 1) as u8) << 7;
        i += 1;
    }
    all
}
macro_rules! kinds {
    (@ [one $d:ident $a:ident] $($k:literal)*) => { [$($a.swizzle(#[inline(always)] |i| source($k, i) % $d.lanes())),*] };
    (@ [two $d:ident $a:ident $b:ident] $($k:literal)*) => { [$($a.concat_swizzle($b, #[inline(always)] |i| source($k, i) % (2 * $d.lanes()))),*] };
    (@ [bytes $d:ident $a:ident $zeros:literal] $($k:literal)*) => { [$($a.in_blocks().lookup_bytes($d.repeat(&const { order($k, $zeros) }))),*] };
    ($($how:tt)+) => { kinds!(@ [$($how)+] 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23) };
}
fn looked_up(m: &Model, zeros: u16) -> Lanes {
    (0..24)
        .flat_map(|kind| {
            m.blocks(|a, _, j| {
                let at = order(kind, zeros)[j] as usize;
                if at < 128 { a[at % 16] } else { 0 }
            })
        })
        .collect()
}

macro_rules! sets {
    ($($how:ident)+) => { sets!(@ [$($how)+] [] [0..=255] [0..=0] [255..=255] [127..=128] [0..=127] [128..=255] [1..=254] [0..=0, 255..=255] [3..=9, 10..=20, 15..=16]
        [0..=126, 128..=254] [1..=1, 3..=3, 5..=5, 7..=7, 9..=9, 11..=11, 13..=13, 250..=255] [1..=1, 3..=3, 5..=5, 7..=7, 9..=9, 11..=11, 13..=13, 15..=130, 255..=255]) };
    (@ [$kind:ident $a:ident] $([$($range:expr),*])*) => { [$(const { $kind::new(&[$($range),*]) }.contains($a)),*] };
    (@ [$m:ident] $([$($range:expr),*])*) => { [$($m.mask(|_i| false $(|| ($range).contains(&$m.a[_i]))*)),*].concat() };
}

macro_rules! tables { ($($name:ident $n:literal: $($kind:literal)*;)*) => { cases! {$(
    $name [u8] 0..=64, |d, a, _, _, _| [$(a.lookup(&const { table::<$n>($kind) })),*]
        => |m| [$(m.each(|i| table::<$n>($kind)[m.a[i] as usize % $n] as i128)),*].concat();
)*
    bytes [u8] 16..=64, |d, a, _, _, _| [
        d.repeat(&const { table::<16>(0) }).in_blocks().lookup_bytes(a), d.repeat(&const { table::<16>(3) }).in_blocks().lookup_bytes(a),
        d.repeat(&const { table::<16>(5) }).in_blocks().lookup_bytes(a), d.repeat(&const { table::<16>(9) }).in_blocks().lookup_bytes(a),
    ] => |m| [0, 3, 5, 9].map(|kind| m.each(|i| if m.a[i] < 128 { table::<16>(kind)[m.a[i] as usize % 16] as i128 } else { 0 })).concat();
    in_order [u8] 16..=64, |d, a, _, _, _| a.in_blocks().lookup_bytes(d.repeat(&const { table::<16>(9) }))
        => |m| m.blocks(|a, _, j| { let at = table::<16>(9)[j] as usize; if at < 128 { a[at % 16] } else { 0 } });
    swizzles [u8 u16] 8..=32, |d, a, _, _, _| kinds!(one d a) => |m| (0..24).flat_map(|kind| m.each(|i| m.a[source(kind, i) % m.n])).collect();
    concat_swizzles [u8 u16] 8..=32, |d, a, b, _, _| kinds!(two d a b)
        => |m| (0..24).flat_map(|kind| m.each(|i| [&m.a[..], &m.b].concat()[source(kind, i) % (2 * m.n)])).collect();
    odd_zeros [u8] 16..=32, |d, a, _, _, _| kinds!(bytes d a 0xaaaa) => |m| looked_up(m, 0xaaaa);
    pairs_of_zeros [u8] 16..=32, |d, a, _, _, _| kinds!(bytes d a 0xc30c) => |m| looked_up(m, 0xc30c);
    some_zeros [u8] 16..=32, |d, a, _, _, _| kinds!(bytes d a 0x8889) => |m| looked_up(m, 0x8889);
    halfway [u64 i64] 8..=64, |d, a, _, _, _| {
        let (low, high) = (d.repartition::<i64>().splat(i64::MAX).bitcast::<T>(), d.repartition::<i64>().splat(i64::MIN).bitcast::<T>());
        [a.simd_gt(low), a.simd_ge(low), a.simd_lt(low), a.simd_le(low), a.simd_gt(high), a.simd_ge(high), a.simd_lt(high), a.simd_le(high)]
    } => |m| [i64::MAX as i128, if matches!(m.t, I(_)) { i64::MIN as i128 } else { 1 << 63 }].map(|it| [
        m.mask(|i| m.a[i] > it), m.mask(|i| m.a[i] >= it), m.mask(|i| m.a[i] < it), m.mask(|i| m.a[i] <= it),
    ].concat()).concat();
    sets [u8] 0..=64, |d, a, _, _, _| sets!(ByteSet a) => |m| sets!(m);
    classes [u8] 0..=64, |d, a, _, _, _| sets!(ByteClasses a) => |m| sets!(m);
    listed [u8] 0..=64, |d, a, _, _, _| [
        const { ByteSet::of(b"") }.contains(a), const { ByteSet::of(b"\0") }.contains(a), const { ByteSet::of(b"\xff\x01\x02\x80\x7f\x03\x04\x05") }.contains(a),
        const { ByteSet::of(b"\xff\x01\x02\x80\x7f\x03\x04\x05\x06") }.contains(a),
    ] => |m| [&b""[..], b"\0", b"\xff\x01\x02\x80\x7f\x03\x04\x05", b"\xff\x01\x02\x80\x7f\x03\x04\x05\x06"].map(|set| m.mask(|i| set.contains(&(m.a[i] as u8)))).concat();
} }; }

tables! { sixteen 16: 0 2 3 4 5 6 7 8 9; eight 8: 0 3 4 9; thirty_two 32: 0 1 3 4 6 9; sixty_four 64: 1 3 4 7 8 9; }
