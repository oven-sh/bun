#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{math::Minifloat, *};
use framework::*;

#[derive(Copy, Clone, PartialEq)]
enum Kind {
    Ieee,
    Fn,
    Fnuz,
    Finite,
}
use Kind::*;
type Format = (Minifloat, u32, u32, i32, Kind);
const NAMED: [Format; 7] = [
    (Minifloat::E4M3FN, 4, 3, 7, Fn),
    (Minifloat::E5M2, 5, 2, 15, Ieee),
    (Minifloat::E4M3FNUZ, 4, 3, 8, Fnuz),
    (Minifloat::E5M2FNUZ, 5, 2, 16, Fnuz),
    (Minifloat::E3M2FN, 3, 2, 3, Finite),
    (Minifloat::E2M3FN, 2, 3, 1, Finite),
    (Minifloat::E2M1FN, 2, 1, 1, Finite),
];
/// Chosen at run time.
fn any(n: u64) -> Format {
    let shapes: Vec<(u32, u32)> = (2..7).flat_map(|e| (1..8 - e).map(move |m| (e, m))).collect();
    match n as usize % (shapes.len() + 7) {
        i @ ..7 => NAMED[i],
        i => {
            let (e, m) = shapes[i - 7];
            (ieee(e, m), e, m, (1 << (e - 1)) - 1, Ieee)
        }
    }
}
/// As if no code were special.
fn plain((_, _, m, bias, _): Format, magnitude: i32) -> f64 {
    let (high, low) = (magnitude >> m, (magnitude & !(!0 << m)) as f64);
    if high == 0 {
        low * 2f64.powi(1 - bias - m as i32)
    } else {
        (low + (1 << m) as f64) * 2f64.powi(high - bias - m as i32)
    }
}
fn value(f: Format, code: i128) -> f64 {
    let (sign, code) = (1 << (f.1 + f.2), code as i32);
    let (magnitude, infinity) = (code & (sign - 1), sign - (1 << f.2));
    let abs = match f.4 {
        Ieee if magnitude == infinity => f64::INFINITY,
        Ieee if magnitude > infinity => f64::NAN,
        Fn if magnitude == sign - 1 => f64::NAN,
        Fnuz if code == sign => f64::NAN,
        _ => plain(f, magnitude),
    };
    if code & sign != 0 { -abs } else { abs }
}
fn code(f: Format, saturates: bool, t: Ty, bits: i128) -> i128 {
    let (x, sign) = (t.float(bits).abs(), 1 << (f.1 + f.2));
    let negative = if bits >> (t.bits() - 1) & 1 == 1 { sign } else { 0 };
    let beyond = match f.4 {
        Ieee => sign - (1 << f.2),
        Fn => sign - 1,
        _ => sign,
    };
    if x.is_nan() {
        return match f.4 {
            Ieee | Fn => (sign - 1) | negative,
            Fnuz => sign,
            Finite => 0,
        } as i128;
    }
    // The midpoints are exact.
    let up = |i: i32| {
        let middle = (plain(f, i) + plain(f, i + 1)) / 2.0;
        x > middle || x == middle && i % 2 == 1
    };
    let nearest = (0..beyond - (saturates || f.4 == Finite) as i32).take_while(|&i| up(i)).count() as i32;
    (if f.4 == Fnuz && nearest == 0 { 0 } else { nearest | negative }) as i128
}
/// Near the numbers of the formats, their midpoints, and the neighbors of those.
#[inline(always)]
fn near<T: Float, W: Width, S: Isa>(a: Simd<T, W, S>, b: Simd<T, W, S>) -> Simd<T, W, S> {
    let (a, b, of) = (a.to_bits(), b.to_bits(), <T::Unsigned as Lane>::from_u64);
    let one = a.isa().splat::<T, W>(T::ONE).to_bits();
    let low = one[0].to_u64().trailing_zeros();
    let exponent = one + ((b & of(31)) << low) - of(15 << low);
    let moved = exponent + (a >> (T::BITS - 6) << (low - 6)) + (b >> 5 & of(1)) - (b >> 6 & of(1));
    (moved | b << (T::BITS - 8) >> (T::BITS - 1) << (T::BITS - 1)).bitcast()
}
fn near_model(m: &Model) -> Lanes {
    let (bits, one) = (m.t.bits(), m.t.of(1.0));
    let low = one.trailing_zeros();
    m.map2(|a, b| {
        let moved =
            one + ((b & 31) << low) - (15 << low) + (a >> (bits - 6) << (low - 6)) + (b >> 5 & 1) - (b >> 6 & 1);
        m.t.unsigned(moved | (b >> 7 & 1) << (bits - 1))
    })
}
macro_rules! each {
    (|$f:ident| $e:expr) => {{
        macro_rules! one {
            ($i:literal) => {{
                let $f = const { NAMED[$i].0 };
                $e
            }};
        }
        [one!(0), one!(1), one!(2), one!(3), one!(4), one!(5), one!(6)]
    }};
}
fn codes(m: &Model, f: Format, saturates: bool) -> Lanes {
    [&m.a, &near_model(m)].iter().flat_map(|v| v.iter().map(|&x| code(f, saturates, m.t, x))).collect()
}
fn values(m: &Model, f: Format, t: Ty) -> Lanes {
    m.map1(|x| t.of(value(f, x)))
}

cases! {
    to_named [half bf16 f32 f64] 2 * size_of::<T>()..=64, |d, a, b, _, _| each!(|f| [a.to_minifloat(f), near(a, b).to_minifloat(f)])
        => |m| NAMED.map(|f| codes(m, f, false)).concat();
    to_named_saturating [half bf16 f32 f64] 2 * size_of::<T>()..=64, |d, a, b, _, _| each!(|f| [a.to_minifloat(f.saturating()), near(a, b).to_minifloat(f.saturating())])
        => |m| NAMED.map(|f| codes(m, f, true)).concat();
    to_any [half bf16 f32 f64] 2 * size_of::<T>()..=64, |d, a, b, _, io| {
        let f = any(io.n).0;
        let f = if io.n >> 8 & 1 == 1 { f.saturating() } else { f };
        [a.to_minifloat(f), near(a, b).to_minifloat(f)]
    } => |m| codes(m, any(m.io.n), m.io.n >> 8 & 1 == 1);
    from_named [u8] 0..=16, |d, a, _, _, _| (each!(|f| a.from_minifloat::<f32>(f)), each!(|f| a.from_minifloat::<bf16>(f)))
        => |m| [F(32), BF].map(|t| NAMED.map(|f| values(m, f, t)).concat()).concat();
    from_named_more [u8] 0..=8, |d, a, _, _, _| (each!(|f| a.from_minifloat::<f64>(f)), each!(|f| a.from_minifloat::<half>(f)))
        => |m| [F(64), F(16)].map(|t| NAMED.map(|f| values(m, f, t)).concat()).concat();
    from_wide [u8] 0..=32, |d, a, _, _, io| (a.from_minifloat::<half>(any(io.n).0), a.from_minifloat::<bf16>(any(io.n).0))
        => |m| [F(16), BF].map(|t| values(m, any(m.io.n), t)).concat();
    from_any [u8] 0..=8, |d, a, _, _, io| (a.from_minifloat::<f32>(any(io.n).0), a.from_minifloat::<f64>(any(io.n).0.saturating()))
        => |m| [F(32), F(64)].map(|t| values(m, any(m.io.n), t)).concat();
}

#[test]
fn known_values() {
    use bun_simd::prelude::*;
    #[bun_simd::simd]
    fn on() {
        let largest =
            |f: Minifloat| f32x2::splat(f32::INFINITY).to_minifloat(f.saturating()).from_minifloat::<f32>(f)[0];
        assert_eq!(NAMED.map(|f| largest(f.0)), [448.0, 57344.0, 240.0, 57344.0, 28.0, 7.5, 6.0]);
        assert_eq!(u8x8::iota(0).from_minifloat::<f32>(Minifloat::E2M1FN), [0.0, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0]);
        assert_eq!(
            f32x4::from([464.0, 464.1, -0.0, 0.001953125]).to_minifloat(Minifloat::E4M3FN),
            [0x7e, 0x7f, 0x80, 1]
        );
        assert_eq!(f32x4::from([61439.0, 61440.0, -1e-9, 1.0]).to_minifloat(Minifloat::E5M2), [0x7b, 0x7c, 0x80, 0x3c]);
        assert_eq!(f32x4::from([247.9, 248.0, -1e-9, 1.0]).to_minifloat(Minifloat::E4M3FNUZ), [0x7f, 0x80, 0, 0x40]);
    }
    on::<bun_simd::target::Baseline>()
}

fn ieee(e: u32, m: u32) -> Minifloat {
    macro_rules! all { ($($e:literal $m:literal),*) => { match (e, m) { $(($e, $m) => Minifloat::ieee::<$e, $m>(),)* _ => panic!() } }; }
    all!(2 1, 2 2, 2 3, 2 4, 2 5, 3 1, 3 2, 3 3, 3 4, 4 1, 4 2, 4 3, 5 1, 5 2, 6 1)
}
