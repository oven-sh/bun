#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
#[path = "framework/fma.rs"]
mod fma;
use bun_simd::*;
use framework::*;

/// `x * y + z` as on the target.
fn fma(m: &Model, x: f64, y: f64, z: f64) -> f64 {
    let t = m.t;
    t.float(t.of(match (m.has_word("fma"), t) {
        (true, F(32)) => fma::fma(x, y, z, 24, -149),
        (true, _) => fma::fma(x, y, z, 53, -1074),
        _ => t.float(t.of(x * y)) + z,
    }))
}
fn fused(m: &Model, signs: impl Fn(usize) -> (i128, i128)) -> Lanes {
    m.each(|i| {
        let ((p, q), t) = (signs(i), m.t);
        if let F(_) = t {
            t.of(fma(m, p as f64 * t.float(m.a[i]), t.float(m.b[i]), q as f64 * t.float(m.c[i])))
        } else {
            (p * m.a[i]).wrapping_mul(m.b[i]).wrapping_add(q * m.c[i])
        }
    })
}
/// `conj` is -1 for the conjugate.
fn complex(m: &Model, conj: f64, add: bool) -> Lanes {
    let f = |v: &Lanes, i: usize| m.t.float(v[i]);
    m.each(|i| {
        let (re, im, even) = (i & !1, i | 1, i % 2 == 0);
        let (first, second) = if conj > 0.0 {
            ((f(&m.a, re), f(&m.b, i)), (f(&m.a, im), f(&m.b, i ^ 1)))
        } else {
            ((f(&m.a, i), f(&m.b, re)), (f(&m.a, i ^ 1), f(&m.b, im)))
        };
        let sign = if even { -conj } else { conj };
        let inner =
            if add { fma(m, second.0, second.1, sign * f(&m.c, i)) } else { m.t.float(m.t.of(second.0 * second.1)) };
        let all = fma(m, first.0, first.1, sign * inner);
        if add && inner == 0.0 && all == 0.0 { ANY } else { m.t.of(all) }
    })
}
/// Rounds once.
fn ldexp(t: Ty, x: i128, n: i128) -> i128 {
    let (fraction, bias, value) = (if t == F(32) { 23 } else { 52 }, if t == F(32) { 127 } else { 1023 }, t.float(x));
    if value == 0.0 || !value.is_finite() {
        return t.quiet(x);
    }
    let (sign, mut e, mut digits) =
        (x >> (t.bits() - 1) << (t.bits() - 1), x >> fraction & (2 * bias + 1), x & ((1 << fraction) - 1));
    if e == 0 {
        e = 1
    } else {
        digits |= 1 << fraction
    }
    while digits >> fraction == 0 {
        digits <<= 1;
        e -= 1
    }
    e += n.clamp(-5000, 5000);
    if e > 2 * bias {
        return sign | (2 * bias + 1) << fraction;
    }
    if e > 0 {
        return sign | e << fraction | digits & ((1 << fraction) - 1);
    }
    let shift = (1 - e).min(fraction + 2);
    let (kept, lost, half) = (digits >> shift, digits & ((1 << shift) - 1), 1 << (shift - 1));
    sign | (kept + (lost > half || lost == half && kept & 1 == 1) as i128)
}
fn magnitude_lt(m: &Model, x: i128, y: i128) -> bool {
    let (x, y, exact) = (m.t.float(x), m.t.float(y), (x, y));
    if let F(_) = m.t {
        x.abs() < y.abs() || x.abs() == y.abs() && x.total_cmp(&y).is_lt()
    } else {
        (exact.0.abs(), exact.0) < (exact.1.abs(), exact.1)
    }
}
fn galois(x: i128, y: i128) -> i128 {
    let product = (0..8).fold(0, |all, bit| all ^ ((y >> bit & 1) * x) << bit);
    (8..15).rev().fold(product, |all, bit| all ^ ((all >> bit & 1) * 0x11b) << (bit - 8))
}
fn s_box(x: i128) -> i128 {
    let inverse = (0..256).find(|&y| galois(x, y) == 1).unwrap_or(0) as u8;
    (0..5).fold(0x63, |all, k| all ^ inverse.rotate_left(k)) as _
}
fn masked(m: &Model, f: impl Fn(i128, i128) -> i128) -> Lanes {
    if m.a.iter().any(|&x| m.t.is_nan(x) || matches!(m.t, F(_)) && m.t.float(x) == 0.0) {
        return vec![ANY];
    }
    vec![(0..m.n).filter(|&i| m.mb[i]).map(|i| m.a[i]).reduce(f).unwrap_or(ANY)]
}
/// Small integers, for which each order is exact. The coefficients are bits of the first lane of `b`.
macro_rules! polynomials { ($a:ident $b:ident $($n:literal)*) => {{
    let small = |v: Simd<T, W, S>, by: u32| (v.to_bits() >> by & 7).cast::<T>().resize::<W>() - T::from_f64(4.0);
    [$(small($a, 0).polynomial_relaxed::<$n>(core::array::from_fn(|i| small($b, 2 * i as u32).to_array().as_ref()[0])) + T::ZERO),*]
}}; }
fn polynomials(m: &Model, sizes: &[u32]) -> Lanes {
    let small = |x: i128, by| (x >> by & 7) as f64 - 4.0;
    let of = |n| m.map1(|x| m.t.of((0..n).rev().fold(0.0, |sum, i| sum * small(x, 0) + small(m.b[0], 2 * i)) + 0.0));
    sizes.iter().flat_map(|&n| of(n)).collect()
}
fn close(m: &Model) -> Lanes {
    m.mask(|_| true)
}

cases! {
    fused_all all 0..=64, |d, a, b, c, _| [a.mul_add_relaxed(b, c), (-a).mul_add_relaxed(b, c), a.mul_add_relaxed(b, -c), (-a).mul_add_relaxed(b, -c)]
        => |m| [(1, 1), (-1, 1), (1, -1), (-1, -1)].map(|it| fused(m, |_| it)).concat();
    polynomial_short float 0..=64, |d, a, b, _, _| polynomials!(a b 1 2 3 4 5 6) => |m| polynomials(m, &[1, 2, 3, 4, 5, 6]);
    polynomial_long float 0..=64, |d, a, b, _, _| polynomials!(a b 7 8 9 10 11) => |m| polynomials(m, &[7, 8, 9, 10, 11]);
    polynomial_of_constants float 0..=64, |d, a, _, _, _| { let x = (a.to_bits() & 3).cast::<T>().resize::<W>(); [x.polynomial_relaxed([3.0, 5.0, 7.0, 2.0].map(T::from_f64)), x.polynomial_relaxed([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0].map(T::from_f64))] }
        => |m| [m.map1(|x| m.t.of((3 + 5 * (x & 3) + 7 * (x & 3).pow(2) + 2 * (x & 3).pow(3)) as f64)), m.map1(|x| m.t.of((0..13).map(|i| (i as i128 + 1) * (x & 3).pow(i)).sum::<i128>() as f64))].concat();
    // All steps are integers below 256, which are exact in 8 bits.
    polynomial_of_few_bits float 0..=64, |d, a, _, _, _| { let x = (a.to_bits() & 3).cast::<T>().resize::<W>() - T::from_f64(2.0); [x.polynomial_relaxed([3.0, -2.0].map(T::from_f64)), x.polynomial_relaxed([1.0, -2.0, 3.0, 2.0, -1.0, 2.0].map(T::from_f64))] }
        => |m| [m.map1(|x| m.t.of((3 - 2 * ((x & 3) - 2)) as f64)), m.map1(|x| m.t.of([2, -1, 2, 3, -2, 1].iter().fold(0, |sum, c| sum * ((x & 3) - 2) + c) as f64))].concat();
    polynomial_of_nan float 0..=64, |d, a, _, _, _| { let (nan, one) = (T::from_f64(f64::NAN), T::ONE); [(a + nan).polynomial_relaxed([one; 2]), (a + nan).polynomial_relaxed([one; 9]), a.polynomial_relaxed([one, one, nan, one, one, one, one]), (a + nan).polynomial_relaxed([one])] }
        => |m| [m.each(|_| m.t.of(f64::NAN)).repeat(3), m.each(|_| m.t.of(1.0))].concat();
    polynomial_error float 0..=64, |d, a, _, _, _| {
        let x = (a.to_bits() & 0xffff).cast::<T>().resize::<W>() * T::from_f64(1.0 / 65536.0);
        let c = [1.0, 1.0, 0.5, 1.0 / 6.0, 1.0 / 24.0, 1.0 / 120.0, 1.0 / 720.0, 1.0 / 5040.0, 1.0 / 40320.0, 1.0 / 362880.0, 1.0 / 3628800.0].map(T::from_f64);
        (x.polynomial_relaxed(c) - x.exp()).abs().simd_lt(T::from_f64(1e-6))
    } => |m| close(m);
    alternating all 2 * LANE..=64, |d, a, b, c, _| [a.mul_add_sub_relaxed(b, c), a.mul_sub_add_relaxed(b, c)]
        => |m| [-1, 1].map(|even| fused(m, |i| (1, if i % 2 == 0 { even } else { -even }))).concat();
    complex_conj float 2 * LANE..=64, |d, a, _, _, _| a.complex_conj() => |m| m.each(|i| m.a[i] ^ ((i % 2) as i128) << (m.t.bits() - 1));
    times_i float 2 * LANE..=64, |d, a, b, _, _| [a.add_times_i(b), a.sub_times_i(b)] => |m| [1.0, -1.0].map(|sign| {
        m.each(|i| m.t.of(m.t.float(m.a[i]) + if i % 2 == 0 { -sign } else { sign } * m.t.float(m.b[i ^ 1])))
    }).concat();
    mul_complex float 2 * LANE..=64, |d, a, b, c, _|
        [a.complex_mul_relaxed(b), a.complex_mul_conj_relaxed(b), a.complex_mul_add_relaxed(b, c), a.complex_mul_conj_add_relaxed(b, c)]
        => |m| [complex(m, 1.0, false), complex(m, -1.0, false), complex(m, 1.0, true), complex(m, -1.0, true)].concat();
    magnitude signed 0..=64, |d, a, b, _, _| [a.min_magnitude(b), a.max_magnitude(b)] => |m| [true, false].map(|min| {
        m.map2(|x, y| if m.t.is_nan(x) || m.t.is_nan(y) { ANY } else if magnitude_lt(m, x, y) == min { x } else { y })
    }).concat();
    is_either_nan float 0..=64, |d, a, b, _, _| (a.is_nan() | b.is_nan()) => |m| m.mask(|i| m.t.is_nan(m.a[i]) || m.t.is_nan(m.b[i]));
    copy_sign_to_abs float 0..=64, |d, a, b, _, _| (a.abs() | b & -T::from_f64(0.0)) => |m| { let sign = 1 << (m.t.bits() - 1); m.map2(|x, y| x & !sign | y & sign) };
    exponent float 0..=64, |d, a, _, _, _| (a.biased_exponent(), a.exponent_relaxed()) => |m| {
        let (fraction, bias) = if m.t == F(32) { (23, 127) } else { (52, 1023) };
        let biased = m.map1(|x| x >> fraction & (2 * bias + 1));
        let exponent = biased.iter().map(|&e| if e == 0 || e > 2 * bias { ANY } else { m.t.of((e - bias) as f64) }).collect();
        [biased, exponent].concat()
    };
    mul_round float 0..=64, |d, a, b, _, _| (a * b).round_ties_even() => |m| m.num2(|_, _| 0, |x, y| m.t.float(m.t.of(x * y)).round_ties_even());
    mul_by_pow2 float 0..=64, |d, a, b, _, _| [a.ldexp(b.cast_signed()), a.ldexp(b.cast_signed() >> if LANE == 4 { 22 } else { 51 })]
        => |m| [0, m.t.bits() - if m.t == F(32) { 10 } else { 13 }].map(|by| m.map2(|x, y| ldexp(m.t, x, I(m.t.bits()).wrap(y) >> by))).concat();
    mul_by_normal_pow2 [f32 f64 half bf16] 0..=64, |d, a, b, _, _| a.ldexp_relaxed(b.cast_signed() >> (8 * LANE as u32 - if LANE == 8 { 11 } else { 8 })) => |m| m.map2(|x, y| {
        let (n, bias) = (I(m.t.bits()).wrap(y) >> (m.t.bits() - if m.t == F(64) { 11 } else { 8 }), match m.t { F(16) => 15, F(64) => 1023, _ => 127 });
        if (1 - bias..=bias).contains(&n) { m.t.of(m.t.float(x) * f64::from_bits(((1023 + n) as u64) << 52)) } else { ANY }
    });
    mul_by_normal_floor_pow2 [f32 f64 half bf16] 0..=64, |d, a, b, _, _| [a.ldexp_floor_relaxed(b), a.ldexp_floor_relaxed(b * T::from_f64(0.03125))] => |m| [1.0, 0.03125].map(|by| m.map2(|x, y| {
        let (n, bias) = (m.t.float(m.t.of(m.t.float(y) * by)).floor(), match m.t { F(16) => 15.0, F(64) => 1023.0, _ => 127.0 });
        if (1.0 - bias..=bias).contains(&n) { m.t.of(m.t.float(x) * f64::from_bits(((1023.0 + n) as u64) << 52)) } else { ANY }
    })).concat();
    mul_by_floor_pow2 float 0..=64, |d, a, b, _, _| a.ldexp_floor(b) => |m| m.map2(|x, y| {
        let (value, by) = (m.t.float(x), m.t.float(y));
        if by.is_finite() { ldexp(m.t, x, by.floor() as i128) } else if value.is_nan() && !by.is_nan() { ANY }
        else { m.t.of(value * if by < 0.0 { 0.0 } else { by }) }
    });
    approximate float 0..=64, |d, a, _, _, _| {
        let a = a.abs().simd_min(d.splat(T::from_f64(1e30))).simd_max_relaxed(T::from_f64(1e-30));
        (a * a.recip_relaxed() - T::from_f64(1.0)).abs().simd_lt(T::from_f64(0.01)) & (a.sqrt() * a.recip_sqrt_relaxed() - T::from_f64(1.0)).abs().simd_lt(T::from_f64(0.01))
    } => |m| close(m);
    upper128 [u64] 16..=64, |d, a, b, _, _| ((a.as_u128s().by_upper().simd_lt(b), a.as_u128s().by_upper().simd_eq(b)), [a.as_u128s().by_upper().simd_min(b), a.as_u128s().by_upper().simd_max(b)]) => |m| [
        m.mask(|i| m.a[i | 1] < m.b[i | 1]), m.mask(|i| m.a[i | 1] == m.b[i | 1]),
        m.each(|i| if m.a[i | 1] < m.b[i | 1] { m.a[i] } else { m.b[i] }), m.each(|i| if m.a[i | 1] > m.b[i | 1] { m.a[i] } else { m.b[i] }),
    ].concat();
    multi_rotate_right [u64] 8..=64, |d, a, b, _, _| a.rotate_bytes_from(b.bitcast())
        => |m| m.map2(|x, y| (0..8).map(|j| (((x as u64).rotate_right((y >> (8 * j)) as u32 & 63) & 255) as i128) << (8 * j)).sum());
    aes_key_gen_assist [u8] 16..=64, |d, a, _, _, _| a.aes_key_gen_assist::<0x36>() => |m| m.blocks(|a, _, j| {
        s_box(a[[4, 5, 6, 7, 5, 6, 7, 4, 12, 13, 14, 15, 13, 14, 15, 12][j]]) ^ if j % 8 == 4 { 0x36 } else { 0 }
    });
    galois_mul [u8] 0..=64, |d, a, b, _, _| a.galois_mul(b) => |m| m.map2(galois);
    galois_by_number [u8] 0..=64, |d, a, _, _, io| [a.galois_mul(io.n as u8), a.galois_mul(2), a.galois_affine(bun_simd::math::galois_matrix(io.n as u8, 0x1b))]
        => |m| [m.map1(|x| galois(x, m.io.n as u8 as i128)), m.map1(|x| galois(x, 2)), m.map1(|x| galois(x, m.io.n as u8 as i128))].concat();
    galois_affine_by_number [u8] 0..=64, |d, a, _, _, io| a.galois_affine(io.n.wrapping_mul(0x9e37_79b9_7f4a_7c15))
        => |m| m.map1(|x| (0..8).map(|bit| (((x as u64 & m.io.n.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> (8 * (7 - bit)) & 255).count_ones() & 1) as i128) << bit).sum());
    top_bits all 0..=64, |d, a, _, _, _| a.to_mask() => |m| m.mask(|i| m.ma[i]);
    galois_affine [u8] 8..=64, |d, a, b, _, _| a.galois_affine(b.bitcast::<u64>())
        => |m| m.each(|i| (0..8).map(|bit| (((m.a[i] & m.b[i / 8 * 8 + 7 - bit]).count_ones() & 1) as i128) << bit).sum());
    galois_affine_inverse [u8] 8..=64, |d, a, b, _, _| a.galois_affine_inverse(b.bitcast::<u64>()) => |m| m.each(|i| {
        let inverse = (0..256).find(|&y| galois(m.a[i], y) == 1).unwrap_or(0);
        (0..8).map(|bit| (((inverse & m.b[i / 8 * 8 + 7 - bit]).count_ones() & 1) as i128) << bit).sum()
    });
    galois_affine_inverse_by_number [u8] 0..=64, |d, a, _, _, io| a.galois_affine_inverse(bun_simd::math::galois_matrix(io.n as u8, 0x1b))
        => |m| m.map1(|x| galois((0..256).find(|&y| galois(x, y) == 1).unwrap_or(0), m.io.n as u8 as i128));
    masked_reduce_sum int 0..=64, |d, a, b, _, _| b.cast_signed().is_negative().select(a, T::default()).reduce_sum() => |m| masked(m, |x, y| x + y);
    set_mask sizes 0..=64, |d, _, _, _, io| d.mask_splat(io.n & 1 == 1) => |m| m.mask(|_| m.io.n & 1 == 1);
    find_known sizes 0..=64, |d, a, _, _, _| (a.cast_signed().is_negative().first_set_relaxed(), a.cast_signed().is_negative().last_set_relaxed())
        => |m| [m.ma.iter().position(|&it| it), m.ma.iter().rposition(|&it| it)].map(|it| it.map_or(ANY, |at| at as _)).to_vec();
}
