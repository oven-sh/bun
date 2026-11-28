#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn bits(mask: &[bool]) -> i128 {
    mask.iter().rev().fold(0, |all, &it| all << 1 | it as i128)
}
fn first(m: &Model) -> Option<usize> {
    m.ma.iter().position(|&it| it)
}

cases! {
    compare all 0..=64, |d, a, b, _, _| [a.simd_eq(b), a.simd_ne(b), a.simd_lt(b), a.simd_le(b), a.simd_gt(b), a.simd_ge(b)] => |m| {
        let (lt, eq) = (|x, y| m.t.lt(x, y), |x, y| m.t.eq(x, y));
        let with = |f: &dyn Fn(i128, i128) -> bool| m.mask(|i| f(m.a[i], m.b[i]));
        [with(&eq), with(&|x, y| !eq(x, y)), with(&lt), with(&|x, y| lt(x, y) || eq(x, y)), with(&|x, y| lt(y, x)),
            with(&|x, y| lt(y, x) || eq(x, y))].concat()
    };
    to_mask all 0..=64, |d, a, _, _, _| a.cast_signed().is_negative() => |m| m.mask(|i| m.ma[i]);
    is_negative signed 16..=16, |d, a, _, _, _| a.is_negative() => |m| m.mask(|i| m.ma[i]);
    mask_logic sizes 0..=64, |d, a, b, _, _| {
        let (a, b) = (a.cast_signed().is_negative(), b.cast_signed().is_negative());
        let (mut x, mut y, mut z) = (a, a, a);
        x &= b; y |= b; z ^= b;
        [a & b, a | b, a ^ b, !a, !a & b, x, y, z, d.mask_splat(false), d.mask_splat(true)]
    } => |m| {
        let with = |f: fn(bool, bool) -> bool| m.mask(|i| f(m.ma[i], m.mb[i]));
        [with(|x, y| x & y), with(|x, y| x | y), with(|x, y| x ^ y), with(|x, _| !x), with(|x, y| !x & y),
            with(|x, y| x & y), with(|x, y| x | y), with(|x, y| x ^ y), with(|_, _| false), with(|_, _| true)].concat()
    };
    mask_bits sizes 0..=64, |d, a, _, _, _| a.cast_signed().is_negative().to_bitmask() => |m| vec![bits(&m.ma)];
    mask_from_bits sizes 0..=64, |d, _, _, _, io| (d.mask_from_bitmask(io.n), d.mask_from_bitmask(io.n).to_bitmask())
        => |m| [m.mask(|i| m.io.n >> i & 1 == 1), vec![m.io.n as i128 & ((1 << m.n) - 1)]].concat();
    all_any sizes 0..=64, |d, a, _, _, _| { let a = a.cast_signed().is_negative(); [a.none(), a.all(), a.any()] }
        => |m| vec![!m.ma.contains(&true) as _, !m.ma.contains(&false) as _, m.ma.contains(&true) as _];
    count_true sizes 0..=64, |d, a, _, _, _| a.cast_signed().is_negative().count() => |m| vec![m.ma.iter().filter(|it| **it).count() as _];
    find sizes 0..=64, |d, a, _, _, _| {
        let a = a.cast_signed().is_negative();
        ([a.first_set(), a.last_set()], a.count_before_first())
    } => |m| vec![first(m).map_or(-1, |it| it as _), m.ma.iter().rposition(|&it| it).map_or(-1, |it| it as _), first(m).unwrap_or(m.n) as _];
    set_first sizes 0..=64, |d, a, _, _, _| [a.cast_signed().is_negative().only_first(), a.cast_signed().is_negative().before_first()]
        => |m| [m.mask(|i| Some(i) == first(m)), m.mask(|i| i < first(m).unwrap_or(m.n))].concat();
    first_n sizes 0..=64, |d, _, _, _, io| [d.mask_first_n(io.up_to(70)), d.mask_first_n(io.n as usize)]
        => |m| [m.mask(|i| i < m.io.up_to(70)), m.mask(|i| i < m.io.n as usize)].concat();
    if_then_else sizes 0..=64, |d, a, b, c, _| {
        let a = a.cast_signed().is_negative();
        [a.select(b, c), a.select(b, T::ZERO), a.select(T::ZERO, c)].map(|v| v.cast_unsigned())
    } => |m| [m.each(|i| if m.ma[i] { m.b[i] } else { m.c[i] }), m.each(|i| if m.ma[i] { m.b[i] } else { 0 }),
        m.each(|i| if m.ma[i] { 0 } else { m.c[i] })].concat();
    select_known sizes 0..=64, |d, a, b, _, _| {
        let (some, none, all) = (d.mask_from_bitmask(0x8d55_0ff0_3333_aaa6), d.mask_from_bitmask(0), d.mask_from_bitmask(!0));
        [some.select(a, T::ZERO), some.select(T::ZERO, b), none.select(a, T::ZERO), all.select(a, T::ZERO), all.select(T::ZERO, b)].map(|v| v.cast_unsigned())
    } => |m| {
        let some = |i: usize| i < 64 && 0x8d55_0ff0_3333_aaa6u64 >> i & 1 == 1;
        [m.each(|i| if some(i) { m.a[i] } else { 0 }), m.each(|i| if some(i) { 0 } else { m.b[i] }), m.each(|_| 0),
            m.each(|i| if i < 64 { m.a[i] } else { 0 }), m.each(|i| if i < 64 { 0 } else { m.b[i] })].concat()
    };
    joined_to_simd sizes 0..=64, |d, a, b, c, _| {
        let (a, b, c) = (a.cast_unsigned(), b.cast_unsigned(), c.cast_unsigned());
        (!a.simd_gt(b) & b.simd_ne(c) | a.simd_eq(c)).to_simd() & c
    } => |m| {
        let (a, b, c) = (|i: usize| m.t.unsigned(m.a[i]), |i: usize| m.t.unsigned(m.b[i]), |i: usize| m.t.unsigned(m.c[i]));
        m.each(|i| if a(i) <= b(i) && b(i) != c(i) || a(i) == c(i) { m.c[i] } else { 0 })
    };
    mask_halves sizes 2 * LANE + 1 / LANE * 2..=64, |d, a, _, _, _| {
        let a = a.cast_signed().is_negative();
        ([a.split()[0], a.split()[1]], a.split()[1].concat(a.split()[0]))
    } => |m| [m.mask(|i| m.ma[i]), m.mask(|i| m.ma[(i + m.n / 2) % m.n])].concat();
    mask_of_size sizes 0..=64, |d, a, b, _, _| a.cast_signed().is_negative() & b.cast_unsigned().simd_eq(b.cast_unsigned()) => |m| m.mask(|i| m.ma[i]);
    mask_promote [u8 i16 f32] 0..=32, |d, a, _, _, _| a.cast_signed().is_negative().cast::<<<T as Lane>::Signed as Int>::Wide>() => |m| m.mask(|i| m.ma[i]);
    mask_promote_8 [u8] 0..=8, |d, a, _, _, _| a.cast_signed().is_negative().cast::<i64>() => |m| m.mask(|i| m.ma[i]);
    mask_promote_4 [u8] 0..=16, |d, a, _, _, _| a.cast_signed().is_negative().cast::<i32>() => |m| m.mask(|i| m.ma[i]);
    mask_promote_2_to_8 [u16] 0..=16, |d, a, _, _, _| a.cast_signed().is_negative().cast::<i64>() => |m| m.mask(|i| m.ma[i]);
    mask_promote_far [u8 u16] 4..=64, |d, a, _, _, _| {
        let m = a.cast_signed().is_negative();
        [m.cast::<i32>().to_simd::<u32>().cast::<u8>().simd_eq(255).to_bitmask(), m.cast::<i64>().to_simd::<u64>().cast::<u8>().simd_eq(255).to_bitmask()]
    } => |m| vec![bits(&m.ma); 2];
    mask_demote [u16 i32 f64] 4..=64, |d, a, _, _, _| a.cast_signed().is_negative().cast::<<<T as Lane>::Signed as Int>::Narrow>() => |m| m.mask(|i| m.ma[i]);
    mask_demote_4 [u32] 8..=64, |d, a, _, _, _| a.cast_signed().is_negative().cast::<i8>() => |m| m.mask(|i| m.ma[i]);
    ordered_demote2_masks_to [u16 i32 u64] 0..=64, |d, a, b, _, _|
        a.cast_signed().is_negative().narrow(b.cast_signed().is_negative())
        => |m| [m.mask(|i| m.ma[i]), m.mask(|i| m.mb[i])].concat();
}

/// For llvm/llvm-project#226741.
#[test]
fn wide_bitmasks_in_order() {
    use bun_simd::{target::Target, *};
    use std::hint::black_box;
    macro_rules! each { ($($t:ident $w:ident $bits:ident;)*) => {$({
        #[kernel(targets = bun_simd::target::Targets::ALL)]
        fn short(from: &[$t; 64], x: u16) -> $bits {
            let s: S = bun_simd::prelude::isa();
            s.over(&from[..x.leading_zeros() as usize]).by::<$w>().bitmask(#[inline(always)] |v| v.simd_gt(0)) as $bits
        }
        #[kernel(targets = bun_simd::target::Targets::ALL)]
        fn padded(from: &[$t]) -> $bits { let s: S = bun_simd::prelude::isa(); s.load_or_default::<$t, $w>(from).simd_ne(0).to_bitmask() as $bits }
        #[kernel(targets = bun_simd::target::Targets::ALL)]
        fn joined(from: &[$t; 64], than: $t) -> $bits {
            let s: S = bun_simd::prelude::isa();
            let half = s.load::<$t, <$w as Width>::Half>(from);
            s.from_halves::<$t, $w>([half, half + 1]).simd_gt(than).to_bitmask() as $bits
        }
        for &target in Target::ALL {
            for n in [0, 7, 16] {
                let all = Some(!(!0 << n));
                assert!(short::to(target, &[7; 64], black_box((0xffffu32 >> n) as u16)).is_none_or(|it| Some(it) == all), "{target:?} {n}");
                assert!(padded::to(target, black_box(&[7; 64][..n])).is_none_or(|it| Some(it) == all), "{target:?} {n}");
            }
            assert!(joined::to(target, black_box(&[7; 64]), black_box(7)).is_none_or(|it| it == !0 << ($bits::BITS / 2)), "{target:?}");
        }
    })*}; }
    each! { u8 B32 u32; u8 B64 u64; u16 B64 u32; u16 B128 u64; u32 B128 u32; u32 B256 u64; u64 B256 u32; u64 B512 u64; }
}
