//! A number in the place of a vector, at run time and as a constant.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(clippy::precedence)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn x(m: &Model) -> i128 {
    m.t.wrap(m.io.n as i128)
}
fn galois(x: i128, y: i128) -> i128 {
    (0..8).fold((0, x), |(all, x), bit| (all ^ x * (y >> bit & 1), (x << 1 ^ (x >> 7) * 0x11b) & 255)).0
}
fn affine_inverse(x: i128, rows: u64) -> i128 {
    let inverse = (0..256).find(|&y| galois(x, y) == 1).unwrap_or(0) as u64;
    (0..8).map(|bit| (((inverse & rows >> (8 * (7 - bit))).count_ones() & 1) as i128) << bit).sum()
}
macro_rules! times {
    ($a:ident) => { times!($a; 0 1 2 3 5 6 7 9 15 17 255 256 257 0xffff_ffff 0x1_0000_0000 0x1_0000_0001 0x7fff_ffff_ffff_ffff 0x8000_0000_0000_0000 0x8000_0000_0000_0001 0xffff_ffff_ffff_ffff) };
    (model $m:ident) => { times!(model $m; 0 1 2 3 5 6 7 9 15 17 255 256 257 0xffff_ffff 0x1_0000_0000 0x1_0000_0001 0x7fff_ffff_ffff_ffff 0x8000_0000_0000_0000 0x8000_0000_0000_0001 0xffff_ffff_ffff_ffff) };
    ($a:ident; $($k:literal)*) => { [$($a * { const K: u64 = $k; K as T }),*] };
    (model $m:ident; $($k:literal)*) => { [$($m.map1(|p| p.wrapping_mul($k))),*].concat() };
}

cases! {
    arithmetic int 0..=64, |d, a, _, _, io| { let x = io.n as T; [a + x, a - x, a * x, x - a, a & x, a | x, a ^ x, a.saturating_add(x), a.saturating_sub(x), a.simd_min(x), a.simd_max(x)] } => |m| {
        let (t, x) = (m.t, x(m));
        [m.map1(|p| p + x), m.map1(|p| p - x), m.map1(|p| p.wrapping_mul(x)), m.map1(|p| x - p), m.map1(|p| p & x), m.map1(|p| p | x), m.map1(|p| p ^ x),
            m.map1(|p| t.clamp(p + x)), m.map1(|p| t.clamp(p - x)), m.map1(|p| p.min(x)), m.map1(|p| p.max(x))].concat()
    };
    comparisons_with_ends int 0..=64, |d, a, _, _, _| {
        macro_rules! all { ($x:expr) => { [a.simd_eq($x), a.simd_ne($x), a.simd_lt($x), a.simd_le($x), a.simd_gt($x), a.simd_ge($x)] }; }
        ((all!(T::MIN), all!(T::MAX)), (all!(0), (all!(1), (all!(T::MAX / 2 + 1), all!(T::MAX - 1)))))
    } => |m| [m.t.min(), m.t.max(), 0, 1, m.t.max() / 2 + 1, m.t.max() - 1].map(|x|
        [m.mask(|i| m.a[i] == x), m.mask(|i| m.a[i] != x), m.mask(|i| m.a[i] < x), m.mask(|i| m.a[i] <= x), m.mask(|i| m.a[i] > x), m.mask(|i| m.a[i] >= x)].concat()).concat();
    comparisons int 0..=64, |d, a, _, _, io| { let x = io.n as T; [a.simd_eq(x), a.simd_ne(x), a.simd_lt(x), a.simd_le(x), a.simd_gt(x), a.simd_ge(x)] }
        => |m| { let x = x(m); [m.mask(|i| m.a[i] == x), m.mask(|i| m.a[i] != x), m.mask(|i| m.a[i] < x), m.mask(|i| m.a[i] <= x), m.mask(|i| m.a[i] > x), m.mask(|i| m.a[i] >= x)].concat() };
    division int 0..=64, |d, a, _, _, io| { let x = io.n as T | (io.n as T == 0) as T; [a / x, a % x] } => |m| { let x = x(m) | (x(m) == 0) as i128; [m.map1(|p| p / x), m.map1(|p| p % x)].concat() };
    assigned int 0..=64, |d, a, b, _, io| { let (mut p, mut q, mut r, mut s) = (a, a, a, a); p <<= io.n as u32; q >>= io.n as u32; r <<= b; s >>= b; [p, q, r, s] } => |m| {
        let (bits, n) = (m.t.bits() as i128, m.io.n as u32 % m.t.bits());
        [m.map1(|p| p << n), m.map1(|p| p >> n), m.map2(|p, q| p << (q & bits - 1)), m.map2(|p, q| p >> (q & bits - 1))].concat()
    };
    times_constants [u64 i64] 0..=64, |d, a, _, _, _| times!(a) => |m| times!(model m);
    inverse [u8] 0..=64, |d, a, _, _, io| [a.galois_affine_inverse(io.n), a.galois_affine_inverse(0xf1e3_c78f_1f3e_7cf8)]
        => |m| [m.map1(|p| affine_inverse(p, m.io.n)), m.map1(|p| affine_inverse(p, 0xf1e3_c78f_1f3e_7cf8))].concat();
    matrix [u8] 0..=64, |d, a, _, _, io| a.galois_affine(math::galois_matrix(io.n as u8, (io.n >> 8) as u8)) => |m| {
        let (factor, polynomial) = (m.io.n as u8 as i128, (m.io.n >> 8) as u8 as i128);
        m.map1(|p| (0..8).fold((0, factor), |(all, x), bit| (all ^ x * (p >> bit & 1), (x << 1 ^ (x >> 7) * polynomial) & 255)).0)
    };
    brain_of_integers [u64] 8..=8, |d, a, _, _, _| vec![bf16::from_u64(a[0]), bf16::from_i64(a[0] as i64)] => |m| [m.a[0], m.a[0] as i64 as i128].map(|x| {
        // Eight bits, to the nearest and then to even.
        let (abs, lost) = (x.abs(), (128 - x.abs().leading_zeros()).saturating_sub(8));
        let up = lost > 0 && (abs & (1 << lost) - 1) + (abs >> lost & 1) > 1 << lost - 1;
        BF.of((((abs >> lost) + up as i128) << lost) as f64 * x.signum() as f64)
    }).to_vec();
    brain [u64] 8..=8, |d, a, _, _, io| {
        let (x, p, q) = (f64::from_bits(a[0]), bf16::from_bits(io.n as u16), bf16::from_bits((io.n >> 16) as u16));
        (vec![bf16::from_f64(x), bf16::from_f32(x as f32), -p, p + q, p - q, p * q, p / q, p % q], (vec![p.to_f64(), f64::from(q), f32::from(p) as f64], (p.is_nan(), p < q)))
    } => |m| {
        let (x, p, q) = (f64::from_bits(m.a[0] as u64), BF.float(m.io.n as u16 as i128), BF.float((m.io.n >> 16) as u16 as i128));
        [x, x as f32 as f64, -p, p + q, p - q, p * q, p / q, p % q].map(|it| BF.of(it)).into_iter().chain([p, q, p].map(|it| F(64).of(it))).chain([p.is_nan() as i128, (p < q) as i128]).collect()
    };
}
