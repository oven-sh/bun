//! Operations with one result for all operands, and some that write.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
#[path = "framework/fma.rs"]
mod fma;
use bun_simd::{math::Round, mem::*, *};
use framework::*;

/// The sign of `c` is that of the even lanes.
fn alternating(m: &Model, even: i128) -> Lanes {
    m.each(|i| {
        let (t, sign) = (m.t, if i % 2 == 0 { even } else { -even });
        let [x, y, z] = [m.a[i], m.b[i], m.c[i]].map(|it| t.float(it));
        match t {
            F(32) => t.of(fma::fma(x, y, sign as f64 * z, 24, -149)),
            F(_) => t.of(fma::fma(x, y, sign as f64 * z, 53, -1074)),
            _ => m.a[i] * m.b[i] + sign * m.c[i],
        }
    })
}
fn tree(mut all: Lanes, f: impl Fn(i128, i128) -> i128) -> i128 {
    while all.len() > 1 {
        let upper = all.split_off(all.len() / 2);
        all.iter_mut().zip(upper).for_each(|(x, y)| *x = f(*x, y));
    }
    all[0]
}
fn fixed(m: &Model) -> Lanes {
    let of = |x: i128, y, z| m.t.clamp(((x * y + (1 << (m.t.bits() - 2))) >> (m.t.bits() - 1)) + z);
    let by = |y| [m.map1(|x| of(x, y, 0)), m.map3(|x, _, z| of(x, y, z))].concat();
    [m.map2(|x, y| of(x, y, 0)), m.map3(of), m.map3(|x, _, z| of(x, x, z)), by(m.t.min()), by(77)].concat()
}

cases! {
    alternate [i16 f32 f64] 16..=32, |d, a, b, c, _| [a.mul_add_sub(b, c), a.mul_sub_add(b, c)] => |m| [alternating(m, -1), alternating(m, 1)].concat();
    q15 [i16] 8..=64, |d, a, b, c, _| [a.mul_q15(b), a.mul_q15_add(b, c), a.mul_q15_add(a, c), a.mul_q15(T::MIN), a.mul_q15_add(T::MIN, c), a.mul_q15(77), a.mul_q15_add(77, c)] => |m| fixed(m);
    q31 [i32] 8..=64, |d, a, b, c, _| [a.mul_q31(b), a.mul_q31_add(b, c), a.mul_q31_add(a, c), a.mul_q31(T::MIN), a.mul_q31_add(T::MIN, c), a.mul_q31(77), a.mul_q31_add(77, c)] => |m| fixed(m);
    signs sint 16..=64, |d, a, b, _, _| a.neg_if_negative_relaxed(b) => |m| m.map2(|x, y| if y == 0 { ANY } else { x * y.signum() });
    reciprocals [f32 f64] 32..=32, |d, a, _, _, _| [a.recip(), a.recip_sqrt()] => |m| [m.float1(|x| 1.0 / x), m.float1(|x| 1.0 / m.t.float(m.t.of(x.sqrt())))].concat();
    any_bits [u8 u32 i64] 0..=64, |d, a, b, _, io| [(a & b).reduce_or(), d.zero().with_lane_dyn(io.up_to(d.lanes() - 1), a[0]).reduce_or()]
        => |m| vec![tree(m.map2(|x, y| x & y), |x, y| x | y), m.a[0]];
    products [u8 i64] 8..=64, |d, a, _, _, _| (a | 1).reduce_product() => |m| vec![tree(m.map1(|x| x | 1), |x, y| m.t.wrap(x * y))];
    products_of_floats [f32] 8..=64, |d, a, _, _, _| a.reduce_product() => |m| vec![m.t.quiet(tree(m.a.clone(), |x, y| m.t.of(m.t.float(x) * m.t.float(y))))];
    differences [f32] 16..=16, |d, a, b, c, _| {
        let (up, even, bits) = (a.rounding(Round::Up), a.rounding(Round::TiesEven), |all: [Simd<T, _, _>; 7]| all.map(|v| v.is_nan().select(0.0, v).to_bits()));
        bits([up - b, even + b, even - b, even * b, even / b, even.sqrt(), even.mul_add(b, c)]) == bits([up + -b, a + b, a - b, a * b, a / b, a.sqrt(), a.mul_add(b, c)])
    } => |_m| vec![1];
    meanwhile [u8] 16..=64, |d, a, b, _, io| {
        let (keys, mut calls) = (&io.bytes.as_chunks().0[..2 + io.up_to(13)], 0usize);
        (Simd::aes_encrypt_and([a, b], keys, || calls += 1) == Simd::aes_encrypt([a, b], keys), calls)
    } => |m| vec![1, m.io.up_to(13) as i128];
    rows [u8 i32] 16..=64, |d, a, b, _, io| {
        let (n, mut all) = (d.lanes(), [T::ONE; 4 * 64]);
        let mut rows = RowsMut::new(&mut all[1..], n + 2, io.up_to(n + 1), 2);
        b.store_row(&mut rows, 1);
        a.store_row(&mut rows, 0);
        [0, 1, n + 1, n + 3, 2 * n + 3].map(|at| d.load(&all[at..]))
    } => |m| {
        let (width, mut all) = (m.io.up_to(m.n + 1).min(m.n), [1; 4 * 64]);
        all[1..][..width].copy_from_slice(&m.a[..width]);
        all[m.n + 3..][..width].copy_from_slice(&m.b[..width]);
        [0, 1, m.n + 1, m.n + 3, 2 * m.n + 3].map(|at| &all[at..][..m.n]).concat()
    };
}

#[test]
#[should_panic]
#[kernel]
fn no_such_row() {
    prelude::u8x16::zero().store_row(&mut RowsMut::new(&mut [0; 9], 3, 0, 2), 2);
}

#[test]
fn sums_of_halves() {
    #[kernel(targets = target::Targets::ALL)]
    fn dots(a: &[f16], b: &[f16], c: &[bf16], d: &[bf16]) -> [f32; 2] {
        use bun_simd::prelude::*;
        [over(a).zip(b).dot_wide_relaxed(), over(c).zip(d).dot_wide_relaxed()]
    }
    let [x, y] = [3, 5].map(|k| (0..300).map(|i| (i * k % 127 - 50) as f32).collect::<Vec<_>>());
    let [a, b] = [&x, &y].map(|it| it.iter().map(|&it| f16::from_f32(it)).collect::<Vec<_>>());
    let [c, d] = [&x, &y].map(|it| it.iter().map(|&it| bf16::from_f32(it)).collect::<Vec<_>>());
    for (target, n) in targets().into_iter().flat_map(|it| (0..300).step_by(7).map(move |n| (it, n))) {
        let want = x[..n].iter().zip(&y).map(|(x, y)| x * y).sum();
        assert_eq!(dots::to(target, &a[..n], &b, &c, &d[..n]), Some([want; 2]), "{target:?} {n}");
    }
}

#[test]
fn the_place_of_an_array() {
    let mut all = vec![1];
    let mut out = Output::resume(&mut all, 1, 4);
    out.push_array([2, 3])[1] = 4;
    let [] = out.push_array([]);
    out.push_array([5, 6]).reverse();
    assert_eq!(out.filled(), [1, 2, 4, 6, 5]);
}

#[test]
#[should_panic = "is too small"]
fn no_place_for_an_array() {
    Output::overwrite(&mut [0; 2]).push_array([1; 3]);
}
