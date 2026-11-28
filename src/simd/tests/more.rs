#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{mem::*, *};
use framework::*;

fn first(m: &Model) -> usize {
    m.ma.iter().position(|&it| it).unwrap_or(m.n)
}
fn wide(v: &[i128]) -> u128 {
    v[0] as u128 | (v[1] as u128) << 64
}
fn sub(m: &Model, x: i128, y: i128) -> i128 {
    if let F(_) = m.t { m.t.of(m.t.float(x) - m.t.float(y)) } else { x - y }
}
fn gf(a: u8, b: u8) -> u8 {
    (0..8).fold((0, a), |(sum, a), i| (sum ^ (a * (b >> i & 1)), (a << 1) ^ ((a >> 7) * 0x1b))).0
}
fn s_box(x: u8) -> u8 {
    let inverse = (0..=255).find(|&y| gf(x, y) == 1).unwrap_or(0);
    (0..5).fold(0x63, |all, i| all ^ inverse.rotate_left(i))
}
fn mix(v: &[i128], j: usize, by: [u8; 4]) -> i128 {
    (0..4).fold(0, |all, k| all ^ gf(v[j & !3 | (j + k) & 3] as u8, by[k])) as i128
}
fn shifted(v: &[i128]) -> Lanes {
    (0..16).map(|j| s_box(v[(j + 4 * (j % 4)) % 16] as u8) as i128).collect()
}

fn quiet(m: &Model, f: fn(f64, f64) -> f64) -> Lanes {
    let signaling = |x: i128| m.t.is_nan(x) && x >> (if m.t == F(32) { 22 } else { 51 }) & 1 == 0;
    m.map2(|x, y| if signaling(x) || signaling(y) { ANY } else { m.t.of(f(m.t.float(x), m.t.float(y)) + 0.0) })
}

cases! {
    at sizes 0..=64, |d, a, _, _, io| { let mut all = io.slice::<T>(); let at = io.up_to(7); let v = d.load_at(&all, at); a.store_at(&mut all, at); (v, all) }
        => |m| { let (mut all, at) = (m.slice(), m.io.up_to(7)); let v = all[at..][..m.n].to_vec(); all[at..][..m.n].copy_from_slice(&m.a); [v, all].concat() };
    take_put sizes 0..=64, |d, _, _, _, io| {
        let (all, mut out, mut bytes) = (io.slice::<T>(), io.slice::<T>(), [0; STEP]);
        let (mut from, to) = (&all[1..][..io.up_to(2 * d.lanes())], &mut out[..]);
        let (vectors, rest) = d.over(from).exact();
        for (i, v) in vectors.enumerate() { v.store_at(to, i * d.lanes()) }
        from = rest;
        d.load_bytes(&io.bytes[STEP..]).store_bytes(&mut bytes);
        ((from.len(), d.load_bytes(&bytes)), out)
    } => |m| {
        let (mut all, n) = (m.slice(), m.io.up_to(2 * m.n));
        all.copy_within(1..1 + n - n % m.n, 0);
        [vec![(n % m.n) as _], m.b.clone(), all].concat()
    };
    masked_memory sizes 0..=64, |d, a, b, _, io| {
        let (mut all, mut kept) = (io.slice::<T>(), io.slice::<T>());
        let v = d.load_select_or_default(&all[1..][..io.up_to(d.lanes())], b.cast_signed().is_negative());
        a.store_select(&mut all[1..], b.cast_signed().is_negative());
        let count = a.compress_store_exact(&mut kept[1..], b.cast_signed().is_negative());
        ((v, count), (all, kept))
    } => |m| {
        let (mut all, mut kept) = (m.slice(), m.slice());
        let v = m.each(|i| if m.mb[i] && i < m.io.up_to(m.n) { all[1 + i] } else { 0 });
        let mut count = 0;
        for i in (0..m.n).filter(|&i| m.mb[i]) { all[1 + i] = m.a[i]; kept[1 + count] = m.a[i]; count += 1 }
        [v, vec![count as _], all, kept].concat()
    };
    expand sizes 0..=64, |d, a, b, _, _| a.expand(b.cast_signed().is_negative()) => |m| { let mut at = 0; m.each(|i| if m.mb[i] { at += 1; m.a[at - 1] } else { 0 }) };
    expand_by_bits sizes 0..=64, |_d, a, b, _, _| a.expand(b.cast_signed().is_negative().to_bitmask() | (!0u64).unbounded_shl(a.to_array().as_ref().len() as u32)) => |m| { let mut at = 0; m.each(|i| if m.mb[i] { at += 1; m.a[at - 1] } else { 0 }) };
    scatter sizes 0..=64, |d, a, b, _, io| { let mut all = io.slice::<T>(); a.scatter(&mut all[..20], b.cast_unsigned() & 31); all }
        => |m| { let mut all = m.slice(); for i in 0..m.n { if m.b[i] & 31 < 20 { all[(m.b[i] & 31) as usize] = m.a[i] } } all };
    prefix_sum int 0..=64, |d, a, _, _, _| a.prefix_sum() => |m| m.each(|i| m.a[..=i].iter().sum());
    black_box all 0..=64, |_d, a, _, _, _| a.black_box() => |m| m.each(|i| m.a[i]);
    majority all 0..=64, |_d, a, b, c, _| a.majority(b, c) => |m| m.each(|i| m.a[i] & m.b[i] | m.c[i] & (m.a[i] | m.b[i]));
    xor3 all 0..=64, |_d, a, b, c, _| a.xor3(b, c) => |m| m.each(|i| m.a[i] ^ m.b[i] ^ m.c[i]);
    sign_bit all 0..=64, |d, _, _, _, _| d.sign_bit() => |m| m.each(|_| 1 << (m.t.bits() - 1));
    shift_right_lanes sizes 2 * LANE..=64, |d, a, b, _, _| a.in_blocks().shift_elements_left::<1>(b) => |m| m.blocks(|a, b, j| [a, b].concat()[j + 1]);
    mask_bits sizes 0..=64, |d, a, _, _, io| { let (k, n) = (a.cast_signed().is_negative(), io.up_to(70));
        [d.mask_repeat_bitmask(io.n), k.from_first(), k.through_first(), k.shift_elements_right_dyn(n, false), k.shift_elements_left_dyn(n, false)] }
        => |m| { let n = m.io.up_to(70); [m.mask(|i| m.io.n >> (i % m.block) & 1 != 0), m.mask(|i| i >= first(m)), m.mask(|i| i <= first(m)),
            m.mask(|i| i >= n && m.ma[i - n]), m.mask(|i| i + n < m.n && m.ma[i + n])].concat() };
    mask_slide_1 sizes 0..=64, |d, a, _, _, _| [a.cast_signed().is_negative().shift_elements_right::<1>(false), a.cast_signed().is_negative().shift_elements_left::<1>(false)]
        => |m| [m.mask(|i| i >= 1 && m.ma[i - 1]), m.mask(|i| i + 1 < m.n && m.ma[i + 1])].concat();
    clamp int 0..=64, |d, a, b, c, _| (a.simd_clamp(b, c), a == T::from_i64(-1)) => |m| [m.map3(|x, y, z| x.max(y).min(z)), vec![m.a.iter().all(|&x| m.t.unsigned(!x) == 0) as _]].concat();
    of_lanes int 0..=64, |d, a, _, _, _| [a.splat_sum(), a.splat_min(), a.splat_max()]
        => |m| [m.a.iter().sum(), *m.a.iter().min().unwrap(), *m.a.iter().max().unwrap()].map(|it| vec![it; m.n]).concat();
    pairwise all 2 * LANE..=64, |d, a, b, _, _| [{ let [even, odd] = a.transpose_pairs(b); even + odd }, { let [even, odd] = a.transpose_pairs(b); odd - even }, a.in_blocks().sub_pairs(b), a.add_sub(b)] => |m| {
        let of = |i: usize| if i % 2 == 0 { &m.a[i..] } else { &m.b[i - 1..] };
        [m.each(|i| m.t.add(of(i)[0], of(i)[1])), m.each(|i| sub(m, of(i)[1], of(i)[0])),
            m.blocks(|a, b, j| { let both = [a, b].concat(); sub(m, both[2 * j + 1], both[2 * j]) }),
            m.each(|i| if i % 2 == 0 { sub(m, m.a[i], m.b[i]) } else { m.t.add(m.a[i], m.b[i]) })].concat()
    };
    negative signed 0..=64, |d, a, b, c, _| (a.is_negative().select(b, c), a.is_negative().select(T::ZERO, a))
        => |m| [m.each(|i| if m.ma[i] { m.b[i] } else { m.c[i] }), m.each(|i| if m.ma[i] { 0 } else { m.a[i] })].concat();
    saturated sint 0..=64, |d, a, _, _, _| (a.saturating_neg(), a.saturating_abs()) => |m| [m.map1(|x| m.t.clamp(-x)), m.map1(|x| m.t.clamp(x.abs()))].concat();
    rotate int 0..=64, |d, a, b, _, _| [a.rotate_left(b), a.rotate_right(b), a.ilog2(), -a] => |m| {
        let bits = m.t.bits() as i128;
        let rol = |x, n: i128| m.t.unsigned(x) << n.rem_euclid(bits) | m.t.unsigned(x) >> (bits - n.rem_euclid(bits));
        [m.map2(rol), m.map2(|x, n| rol(x, -n)), m.map1(|x| 127 - m.t.unsigned(x).leading_zeros() as i128), m.map1(|x| -x)].concat()
    };
    classes float 0..=64, |d, a, b, _, _| ([a.is_nan(), a.is_infinite(), a.is_finite()], [a.copysign(b).cast_unsigned().bitcast::<T>(), a.simd_min(b) + T::from_f64(0.0), a.simd_max(b) + T::from_f64(0.0)]) => |m| {
        let (f, top) = (|i: usize| m.t.float(m.a[i]), 1 << (m.t.bits() - 1));
        [m.mask(|i| f(i).is_nan()), m.mask(|i| f(i).is_infinite()), m.mask(|i| f(i).is_finite()), m.map2(|x, y| x & !top | y & top),
            quiet(m, f64::min), quiet(m, f64::max)].concat()
    };
    wide128 [u64] 16..=64, |d, a, b, _, _| ([a.as_u128s().simd_eq(b), a.as_u128s().simd_lt(b)], [a.as_u128s().simd_min(b), a.as_u128s().simd_max(b)]) => |m| [
        m.blocks(|a, b, _| -((a == b) as i128)), m.blocks(|a, b, _| -((wide(a) < wide(b)) as i128)),
        m.blocks(|a, b, j| if wide(a) < wide(b) { a[j] } else { b[j] }), m.blocks(|a, b, j| if wide(a) < wide(b) { b[j] } else { a[j] })].concat();
    number_first int 0..=64, |d, a, _, _, _| [7 - a, 7 + a, 7 * a, 7 & a, 7 | a, 7 ^ a]
        => |m| [m.map1(|x| 7 - x), m.map1(|x| 7 + x), m.map1(|x| 7 * x), m.map1(|x| 7 & x), m.map1(|x| 7 | x), m.map1(|x| 7 ^ x)].concat();
    round_int [f32] 0..=64, |d, a, _, _, _| (a.ceil().cast_relaxed::<i32>(), a.floor().cast_relaxed::<i32>()) => |m| {
        let of = |x: f64| if x.abs() < 2e9 { x as i128 } else { ANY };
        [m.map1(|x| of(m.t.float(x).ceil())), m.map1(|x| of(m.t.float(x).floor()))].concat()
    };
    approximate [f32] 0..=64, |d, a, _, _, _| {
        let x = a.abs().is_finite().select(a.abs(), 1.0).simd_clamp_relaxed(1e-18, 1e18);
        let close = |one: Simd<f32, _, _>| (one - 1.0).abs().simd_lt(1.0 / 256.0);
        close(x.recip_relaxed() * x) & close(x.recip_sqrt_relaxed() * x.sqrt())
    } => |m| m.mask(|_| true);
    aes [u8] 16..=64, |d, a, b, c, _| [a.aes_round(b), a.aes_last_round(b), a.aes_inv_mix_columns(),
        (a.aes_last_round(b) ^ b).aes_last_round_inv(c), a.aes_round_inv(c) ^ a.aes_last_round_inv(0).aes_inv_mix_columns()] => |m| [
        m.blocks(|a, b, j| mix(&shifted(a), j, [2, 3, 1, 1]) ^ b[j]), m.blocks(|a, b, j| shifted(a)[j] ^ b[j]),
        m.blocks(|a, _, j| mix(a, j, [14, 11, 13, 9])), m.each(|i| m.a[i] ^ m.c[i]), m.c.clone()].concat();
}

#[test]
fn prefetch_out_of_bounds() {
    prefetch(&[1u8], usize::MAX / 2);
    for how in [Prefetch::L1, Prefetch::L2, Prefetch::L3, Prefetch::Once, Prefetch::Write, Prefetch::Write] {
        static READ_ONLY: [u64; 2] = [1, 2];
        for at in [0, 1, 2, 1 << 20, usize::MAX / 16, usize::MAX / 2, usize::MAX] {
            prefetch_with(&READ_ONLY, at, how);
            prefetch_with::<u8>(&[], at, how);
        }
        assert_eq!(std::hint::black_box(&READ_ONLY), &[1, 2]);
    }
}
