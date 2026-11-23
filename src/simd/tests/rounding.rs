//! Rounding in a direction, against exact comparisons.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{math::Round, *};
use core::cmp::Ordering::{self, *};
use framework::*;

const MODES: [Round; 4] = [Round::TiesEven, Round::Down, Round::Up, Round::TowardZero];

/// The sign of a sum of products of finite numbers, in digits of 32 bits.
fn sign(terms: &[(f64, f64)]) -> Ordering {
    let split = |v: f64| {
        let (e, m) = ((v.to_bits() >> 52 & 0x7ff) as usize, (v.to_bits() & !(!0 << 52)) as u128);
        if e == 0 { (m, 0) } else { (m | 1 << 52, e - 1) }
    };
    let mut digits = [0i128; 140];
    for &(x, y) in terms {
        let ((a, e), (b, f)) = (split(x), split(y));
        for k in 0..4 {
            let digit = (((a * b) >> (32 * k) & 0xffff_ffff) as i128) << ((e + f) % 32);
            digits[(e + f) / 32 + k] += if (x < 0.0) != (y < 0.0) { -digit } else { digit };
        }
    }
    let (mut carry, mut any) = (0, false);
    for digit in digits {
        any |= (digit + carry) as u32 != 0;
        carry = (digit + carry) >> 32;
    }
    if carry < 0 { Less } else { any.cmp(&false) }
}
/// `near` is near the exact result, which `exact` compares with a finite number.
fn toward(t: Ty, mode: Round, near: f64, exact: impl Fn(f64) -> Ordering) -> i128 {
    let top = 1 << (t.bits() - 1);
    let value = |key: i128| t.float(if key < 0 { top | -key } else { key });
    let exact = |key: i128| match value(key) {
        f64::INFINITY => Less,
        f64::NEG_INFINITY => Greater,
        x => exact(x),
    };
    let mut floor = if near < 0.0 { top - t.of(near) } else { t.of(near.abs()) };
    while exact(floor) == Less {
        floor -= 1;
    }
    while exact(floor + 1) != Less {
        floor += 1;
    }
    let (negative, above) = (exact(0) == Less, floor + (exact(floor) != Equal) as i128);
    let key = match mode {
        Round::Down => floor,
        Round::Up => above,
        Round::TowardZero => {
            if negative {
                above
            } else {
                floor
            }
        }
        Round::TiesEven => unreachable!(),
    };
    key.abs() | if negative { top } else { 0 }
}
fn fused(t: Ty, mode: Round, a: i128, b: i128, c: i128) -> i128 {
    let (a, b, c) = (t.float(a), t.float(b), t.float(c));
    if !(a.is_finite() && b.is_finite()) {
        t.of(a * b + c)
    } else if !c.is_finite() {
        t.of(c)
    } else if sign(&[(a, b), (c, 1.0)]) == Equal {
        let (p, c) = (if a == 0.0 || b == 0.0 { a * b } else { -c }, c);
        t.of(if mode == Round::Down { -(-p - c) } else { p + c })
    } else {
        toward(t, mode, a.mul_add(b, c), |x| sign(&[(a, b), (c, 1.0), (-x, 1.0)]))
    }
}
fn product(t: Ty, mode: Round, a: i128, b: i128) -> i128 {
    if t.float(a) == 0.0 || t.float(b) == 0.0 { t.of(t.float(a) * t.float(b)) } else { fused(t, mode, a, b, 0) }
}
fn quotient(t: Ty, mode: Round, a: i128, b: i128) -> i128 {
    let (a, b) = (t.float(a), t.float(b));
    if !(a.is_finite() && b.is_finite()) || a == 0.0 || b == 0.0 {
        return t.of(a / b);
    }
    toward(t, mode, a / b, |x| sign(&[(a, b.signum()), (-x, b.abs())]))
}
fn root(t: Ty, mode: Round, a: i128) -> i128 {
    let a = t.float(a);
    if !(a > 0.0 && a.is_finite()) {
        return t.of(a.sqrt());
    }
    toward(t, mode, a.sqrt(), |x| if x < 0.0 { Greater } else { sign(&[(a, 1.0), (-x, x)]) })
}
fn cast(from: Ty, to: Ty, mode: Round, x: i128) -> i128 {
    let v = from.float(x);
    match (from, to) {
        (F(_), F(_)) if v == 0.0 || !v.is_finite() => to.of(v),
        (F(_), F(_)) => toward(to, mode, v, |it| v.partial_cmp(&it).unwrap()),
        (_, F(_)) => {
            toward(to, mode, v, |it| sign(&[((x >> 32) as f64, 4294967296.0), (x as u32 as f64, 1.0), (-it, 1.0)]))
        }
        (F(_), _) => to.clamp(match mode {
            Round::TiesEven => v.round_ties_even(),
            Round::Down => v.floor(),
            Round::Up => v.ceil(),
            Round::TowardZero => v,
        } as i128),
        _ => x,
    }
}
fn each(f: impl Fn(Round) -> Lanes) -> Lanes {
    MODES[1..].iter().flat_map(|&mode| f(mode)).collect()
}
macro_rules! each {
    (|$mode:ident| $v:expr) => {
        [
            {
                let $mode = Round::Down;
                $v
            },
            {
                let $mode = Round::Up;
                $v
            },
            {
                let $mode = Round::TowardZero;
                $v
            },
        ]
    };
}

/// All triples of numbers at the ends of the range.
fn edges<T: Float + Test>() {
    #[kernel(icelake + fp16, avx512, avx2, sse4, sve2, neon)]
    fn all<T: Float, W: Width>(mode: Round, x: &[[T; 3]], out: &mut Vec<[T; 5]>, _of: W) {
        let s: S = bun_simd::prelude::isa();
        for x in x.chunks_exact(Simd::<T, W, S>::LANES) {
            let [a, b, c]: [Simd<T, W, S>; 3] = s.load_interleaved(x.as_flattened());
            let v: Rounding<T, W, S> = a.rounding(mode);
            let all = [v + b, v * b, v / b, v.sqrt(), v.mul_add(b, c)];
            out.extend((0..x.len()).map(|i| all.map(|v| v[i])));
        }
    }
    let (t, least) = (T::TY, T::TY.of(f64::INFINITY) & -T::TY.of(f64::INFINITY));
    let (max, one) = (t.of(f64::INFINITY) - 1, t.of(1.0));
    let half_step = max + 1 - least * (least.trailing_zeros() as i128 + 2);
    let positive = [
        0,
        1,
        3,
        least - 1,
        least,
        one - 1,
        one,
        one + 1,
        one + least,
        one / 2,
        one / 2 + 1,
        one + one / 2 - 1,
        half_step,
        half_step + 1,
        max - least,
        max - 1,
        max,
        max + 1,
    ];
    let values: Vec<i128> = positive.iter().flat_map(|&it| [it, it | t.of(-0.0)]).collect();
    let n = values.len();
    let triples: Vec<[i128; 3]> =
        (0..n * n * n).map(|i| [values[i % n], values[i / n % n], values[i / n / n]]).collect();
    let lanes: Vec<[T; 3]> = triples.iter().map(|it| it.map(|it| Test::from_bits(it as u64))).collect();
    for mode in &MODES[1..] {
        let model = |&[a, b, c]: &[i128; 3]| {
            [
                fused(t, *mode, a, one, b),
                product(t, *mode, a, b),
                quotient(t, *mode, a, b),
                root(t, *mode, a),
                fused(t, *mode, a, b, c),
            ]
        };
        let want: Vec<_> = triples.iter().map(model).collect();
        for target in all::targets() {
            let mut out = vec![];
            all::to(target, *mode, &lanes, &mut out, B64);
            // One lane that takes the slow way takes the others along.
            all::to(target, *mode, &lanes, &mut out, B8);
            assert_eq!(out.len(), 2 * want.len());
            for ((got, want), x) in out.iter().zip(want.iter().cycle()).zip(lanes.iter().cycle()) {
                let got = got.map(|it| Test::to_bits(it) as i128);
                assert!(
                    (0..5).all(|i| got[i] == want[i] || t.is_nan(got[i]) && t.is_nan(want[i])),
                    "{x:?} {mode:?} on {target:?}: {got:x?}, not {want:x?}"
                );
            }
        }
    }
}
macro_rules! ends { ($($name:ident $t:ident)*) => {$(
    #[test]
    #[cfg_attr(miri, ignore)]
    fn $name() {
        edges::<$t>();
    }
)*}; }
ends! { ends_of_f32 f32 ends_of_f64 f64 ends_of_f16 half ends_of_bf16 bf16 }

macro_rules! casts { ($($name:ident $from:ident $to:ident $bytes:expr;)*) => { cases! { $(
    $name [$from] $bytes, |d, a, _, _, _| (each!(|mode| a.rounding(mode).cast::<$to>()), a.rounding(Round::TiesEven).cast::<$to>()) => |m| { let to = <$to as Test>::TY;
        [each(|mode| m.map1(|x| cast(m.t, to, mode, x))), m.map1(|x| match (m.t, to) {
            (F(_), F(16) | BF) => { let (a, b) = (cast(m.t, to, Round::Down, x), cast(m.t, to, Round::Up, x)); if a == b { a } else { ANY } }
            (F(_), F(_)) => to.of(m.t.float(x)),
            (_, F(_)) => ANY,
            _ => cast(m.t, to, Round::TiesEven, x),
        })].concat() };
)* } }; }
casts! { f64_f32 f64 f32 64..=64; f32_f16 f32 half 32..=32; u32_f32 u32 f32 64..=64; i64_f64 i64 f64 64..=64; f32_i32 f32 i32 64..=64; }
