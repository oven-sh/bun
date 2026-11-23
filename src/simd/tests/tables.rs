#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn value(i: usize, seed: i128, bits: u32) -> u64 {
    (i as u64 + 1).wrapping_mul(0x9e37_79b9_7f4a_7c15 ^ seed as u64 | 1).rotate_left(29) & !0 >> (64 - bits)
}
macro_rules! looked_up { ($a:ident $b:ident $u:ident $f:ident: $($n:literal)*) => {
    [$($a.$f(&core::array::from_fn::<$u, $n, _>(|i| value(i, $b[0] as i128, $u::BITS) as $u)).to_array().as_ref().to_vec()),*].concat()
}; }
fn exact(m: &Model, bits: u32, lengths: &[usize]) -> Lanes {
    lengths.iter().flat_map(|&n| m.each(|i| value(m.a[i] as usize % n, m.b[0], bits) as i128)).collect()
}
fn relaxed(m: &Model, bits: u32, lengths: &[usize]) -> Lanes {
    let at = |i: usize| (m.a[i] & 1023) as usize >> (m.b[0] & 7);
    lengths.iter().flat_map(|&n| m.each(|i| if at(i) < n { value(at(i), m.b[0], bits) as i128 } else { ANY })).collect()
}
macro_rules! or_else { ($a:ident $b:ident $u:ident: $($n:literal)*) => {
    [$({
        let table = core::array::from_fn::<$u, $n, _>(|i| value(i, $b[0] as i128, $u::BITS) as $u);
        [$a.lookup_or(&table, 0), $a.lookup_or(&table, $b.cast::<$u>()[0]), $a.lookup_or(&table, $b.cast::<$u>())].map(|it| it.to_array().as_ref().to_vec()).concat()
    }),*].concat()
}; }
fn or(m: &Model, bits: u32, lengths: &[usize]) -> Lanes {
    let at = |i: usize| (m.a[i] >> (m.b[0] % m.t.bits() as i128)) as u64;
    let one = |n: usize, other: &dyn Fn(usize) -> i128| {
        m.each(|i| {
            if at(i) < n as u64 { value(at(i) as usize, m.b[0], bits) as i128 } else { other(i) & ((1 << bits) - 1) }
        })
    };
    lengths.iter().flat_map(|&n| [one(n, &|_| 0), one(n, &|_| m.b[0]), one(n, &|i| m.b[i])].concat()).collect()
}
macro_rules! near {
    ($d:ident $a:ident $b:ident) => {
        ($a & T::from_usize(1023)) >> ($b[0] & 7) as u32
    };
}

/// Also where a branch is dead for the width, and with lanes that are generic.
#[kernel(targets = target::Targets::ALL)]
fn generic<T: Unsigned, W: Width>(at: T, table: &[T; 2]) -> T {
    let s: S = bun_simd::prelude::isa();
    if const { W::BYTES >= size_of::<T>() } { s.splat::<T, W>(at).lookup(table).resize::<W>()[0] } else { table[0] }
}
#[test]
fn generic_lanes() {
    for target in generic::targets() {
        assert_eq!(
            (generic::to::<u64, B4>(target, 1, &[5, 6]), generic::to::<u64, B64>(target, 1, &[5, 6])),
            (Some(5), Some(6))
        );
    }
}

cases! {
    to_u8 [u8 u16 u32 u64] 2 * LANE..=64, |_d, a, b, _, _| looked_up!(a b u8 lookup: 1 8 16 32 128 256 512 1024)
        => |m| exact(m, 8, &[1, 8, 16, 32, 128, 256, 512, 1024]);
    to_u16 [u8 u16 u32 u64] 0..=64, |_d, a, b, _, _| looked_up!(a b u16 lookup: 2 8 16 32 64 128 256 512)
        => |m| exact(m, 16, &[2, 8, 16, 32, 64, 128, 256, 512]);
    to_u32 [u8 u16 u32 u64] 0..=64, |_d, a, b, _, _| looked_up!(a b u32 lookup: 1 4 8 16 32 64 128 256)
        => |m| exact(m, 32, &[1, 4, 8, 16, 32, 64, 128, 256]);
    to_u64 [u8 u16 u32 u64] 0..=64, |_d, a, b, _, _| looked_up!(a b u64 lookup: 2 8 16 32 64 128)
        => |m| exact(m, 64, &[2, 8, 16, 32, 64, 128]);
    relaxed_to_u8 [u8 u16 u32] 2 * LANE..=64, |_d, a, b, _, _| { let a = near!(_d a b); looked_up!(a b u8 lookup_relaxed: 0 5 129 255 257 1000) }
        => |m| relaxed(m, 8, &[0, 5, 129, 255, 257, 1000]);
    relaxed_to_u16 [u8 u16 u64] 0..=64, |_d, a, b, _, _| { let a = near!(_d a b); looked_up!(a b u16 lookup_relaxed: 0 11 17 33 65 200 300) }
        => |m| relaxed(m, 16, &[0, 11, 17, 33, 65, 200, 300]);
    relaxed_to_u32 [u8 u16 u32] 0..=64, |_d, a, b, _, _| { let a = near!(_d a b); looked_up!(a b u32 lookup_relaxed: 3 9 17 33 49 65 100 129 255) }
        => |m| relaxed(m, 32, &[3, 9, 17, 33, 49, 65, 100, 129, 255]);
    relaxed_to_u64 [u8 u32 u64] 0..=64, |_d, a, b, _, _| { let a = near!(_d a b); looked_up!(a b u64 lookup_relaxed: 3 15 17 25 33 63 100) }
        => |m| relaxed(m, 64, &[3, 15, 17, 25, 33, 63, 100]);
    bytes_or [u8] 0..=64, |_d, a, b, _, _| { let a = a >> b.splat_lane::<0>(); or_else!(a b u8: 0 1 10 16 17 32 33 48 49 64 65 80 100 112 128 129 255 256 300) }
        => |m| or(m, 8, &[0, 1, 10, 16, 17, 32, 33, 48, 49, 64, 65, 80, 100, 112, 128, 129, 255, 256, 300]);
    or_to_u8 [u16 u32 u64] 2 * LANE..=64, |_d, a, b, _, _| { let a = a >> b.splat_lane::<0>(); or_else!(a b u8: 0 16 100 256 257 1024) }
        => |m| or(m, 8, &[0, 16, 100, 256, 257, 1024]);
    or_to_u16 [u8 u16 u64] 0..=64, |_d, a, b, _, _| { let a = a >> b.splat_lane::<0>(); or_else!(a b u16: 8 11 64 256 300) }
        => |m| or(m, 16, &[8, 11, 64, 256, 300]);
    or_to_u32 [u8 u32] 0..=64, |_d, a, b, _, _| { let a = a >> b.splat_lane::<0>(); or_else!(a b u32: 0 5 16 33 256) }
        => |m| or(m, 32, &[0, 5, 16, 33, 256]);
    or_to_u64 [u8 u64] 0..=64, |_d, a, b, _, _| { let a = a >> b.splat_lane::<0>(); or_else!(a b u64: 2 9 128) }
        => |m| or(m, 64, &[2, 9, 128]);
    or_of_other_kinds [u8] 0..=64, |_d, a, b, _, _| {
        let (signed, floats): ([i8; 40], [f32; 20]) = (core::array::from_fn(|i| value(i, 0, 8) as i8), core::array::from_fn(|i| f32::from_bits(value(i, 0, 32) as u32)));
        let wide = |it: &[i8]| it.iter().map(|&x| x as u8 as u32).collect::<Vec<_>>();
        [wide((a >> 2).lookup_or(&signed, -3).to_array().as_ref()), wide((a >> 2).lookup_or(signed.first_chunk::<16>().unwrap(), b.cast_signed()).to_array().as_ref()),
            (a >> 3).lookup_or(&floats, f32::from_bits(!0)).to_bits().to_array().as_ref().to_vec()].concat()
    } => |m| [(2, 40, 8, 253), (2, 16, 8, -1), (3, 20, 32, 0xffff_ffff)].map(|(by, n, bits, or)| m.each(|i| {
        let at = m.a[i] >> by;
        if at < n { value(at as usize, 0, bits) as i128 } else if or < 0 { m.b[i] } else { or }
    })).concat();
    to_floats [u8 u32] 0..=64, |_d, a, b, _, _| {
        let table: [f32; 128] = core::array::from_fn(|i| f32::from_bits(value(i, b[0] as i128, 32) as u32));
        [a.lookup(&table).to_bits(), a.lookup(table.first_chunk::<16>().unwrap()).to_bits()].map(|it| it.to_array().as_ref().to_vec()).concat()
    } => |m| exact(m, 32, &[128, 16]);
}
