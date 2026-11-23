#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
#[path = "framework/fma.rs"]
mod fma;
use bun_simd::*;
use framework::*;

cases! {
    add all 0..=64, |d, a, b, _, _| a + b => |m| m.num2(|x, y| x + y, |x, y| x + y);
    sub all 0..=64, |d, a, b, _, _| a - b => |m| m.num2(|x, y| x - y, |x, y| x - y);
    mul all 0..=64, |d, a, b, _, _| a * b => |m| m.num2(|x, y| x.wrapping_mul(y), |x, y| x * y);
    div float 0..=64, |d, a, b, _, _| a / b => |m| m.num2(|_, _| 0, |x, y| x / y);
    assign all 16..=16, |d, a, b, c, _| { let mut v = a; v += b; v -= c; v *= b; v &= a; v |= c; v ^= b; v } => |m| m.map3(|x, y, z| {
        let t = m.t;
        let v = if let F(_) = t {
            let round = |it| t.float(t.of(it));
            let v = round(round(t.float(x) + t.float(y)) - t.float(z)) * t.float(y);
            if v.is_nan() { return ANY; }
            t.of(v)
        } else { (x + y - z).wrapping_mul(y) };
        (v & x | z) ^ y
    });
    neg signed 0..=64, |d, a, _, _, _| -a => |m| m.map1(|x| if let F(_) = m.t { x ^ 1 << (m.t.bits() - 1) } else { -x });
    abs signed 0..=64, |d, a, _, _, _| a.abs() => |m| m.map1(|x| if let F(_) = m.t { x & m.t.max() >> 1 } else { x.abs() });
    min all 0..=64, |d, a, b, _, _| a.simd_min_relaxed(b) => |m| m.map2(|x, y| if m.t.lt(x, y) || x == y { m.t.quiet(x) } else if m.t.lt(y, x) { y } else { ANY });
    max all 0..=64, |d, a, b, _, _| a.simd_max_relaxed(b) => |m| m.map2(|x, y| if m.t.lt(y, x) || x == y { m.t.quiet(x) } else if m.t.lt(x, y) { y } else { ANY });
    abs_diff int 0..=64, |d, a, b, _, _| a.abs_diff(b) => |m| m.map2(|x, y| (x - y).abs());
    saturated_add int 0..=64, |d, a, b, _, _| a.saturating_add(b) => |m| m.map2(|x, y| m.t.clamp(x + y));
    saturated_sub int 0..=64, |d, a, b, _, _| a.saturating_sub(b) => |m| m.map2(|x, y| m.t.clamp(x - y));
    average_round uint 0..=64, |d, a, b, _, _| a.midpoint_up(b) => |m| m.map2(|x, y| (x + y + 1) / 2);
    if_negative_then_neg signed 0..=64, |d, a, b, _, _| b.neg_if_negative(a)
        => |m| m.each(|i| if !m.ma[i] { m.b[i] } else if let F(_) = m.t { m.b[i] ^ 1 << (m.t.bits() - 1) } else { -m.b[i] });
    broadcast_sign_bit sint 0..=64, |d, a, _, _, _| (a >> (T::BITS - 1)) => |m| m.mask(|i| m.ma[i]);
    reduce_sum all 0..=64, |d, a, _, _, _| a.reduce_sum() => |m| {
        let mut v = m.a.clone();
        while v.len() > 1 { let half = v.len() / 2; v = (0..half).map(|i| m.t.add(v[i], v[i + half])).collect(); }
        vec![m.t.quiet(v[0])]
    };
    reduce_min int 0..=64, |d, a, _, _, _| a.reduce_min() => |m| vec![*m.a.iter().min().unwrap()];
    reduce_max int 0..=64, |d, a, _, _, _| a.reduce_max() => |m| vec![*m.a.iter().max().unwrap()];
    reduce_min_max_float float 0..=64, |d, a, _, _, _| (a.reduce_min_relaxed() + T::from_f64(0.0), a.reduce_max_relaxed() + T::from_f64(0.0)) => |m| {
        if m.a.iter().any(|&x| m.t.is_nan(x)) { return vec![ANY; 2]; }
        let all = || m.a.iter().map(|&x| m.t.float(x));
        vec![m.t.of(all().fold(f64::INFINITY, f64::min) + 0.0), m.t.of(all().fold(f64::NEG_INFINITY, f64::max) + 0.0)]
    };
    pairwise_add128 all 2 * LANE..=64, |d, a, b, _, _| a.in_blocks().add_pairs(b) => |m| m.blocks(|a, b, j| {
        let both = [a, b].concat();
        m.t.add(both[2 * j], both[2 * j + 1])
    });
    sqrt float 0..=64, |d, a, _, _, _| a.sqrt() => |m| m.float1(f64::sqrt);
    floor float 0..=64, |d, a, _, _, _| a.floor() => |m| m.float1(f64::floor);
    ceil float 0..=64, |d, a, _, _, _| a.ceil() => |m| m.float1(f64::ceil);
    trunc float 0..=64, |d, a, _, _, _| a.trunc() => |m| m.float1(f64::trunc);
    round float 0..=64, |d, a, _, _, _| a.round_ties_even() => |m| m.float1(f64::round_ties_even);
    mul_add float 0..=64, |d, a, b, c, _| (a.mul_add_relaxed(b, c), (-a).mul_add_relaxed(b, c)) => |m| {
        let t = m.t;
        let f = |x: f64, y: f64, z: f64| match (m.has_word("fma"), t) {
            (true, F(32)) => fma::fma(x, y, z, 24, -149),
            (true, _) => fma::fma(x, y, z, 53, -1074),
            _ => t.float(t.of(x * y)) + z,
        };
        [1.0, -1.0].map(|sign| m.map3(|x, y, z| t.of(f(sign * t.float(x), t.float(y), t.float(z))))).concat()
    };
}

/// The model against the C library.
#[test]
#[cfg(target_os = "linux")]
fn fma_model() {
    let mut state = 1u64;
    let mut next = || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for i in 0..300_000 {
        let (x, y, z) = (f64::from_bits(next()), f64::from_bits(next()), f64::from_bits(next()));
        let z = [z, -x * y, f64::from_bits((x * y).to_bits() ^ next() >> 6), f64::from_bits(next() >> 12)][i % 4];
        let (got, want) = (fma::fma(x, y, z, 53, -1074), x.mul_add(y, z));
        assert!(got.to_bits() == want.to_bits() || got.is_nan() && want.is_nan(), "{x:e} {y:e} {z:e}");
        let (x, y, z) = (f32::from_bits(next() as u32), f32::from_bits(next() as u32), f32::from_bits(next() as u32));
        let z = [z, -x * y, f32::from_bits((x * y).to_bits() ^ next() as u32 >> 4), f32::from_bits(next() as u32 >> 9)]
            [i % 4];
        let (got, want) = (fma::fma(x as f64, y as f64, z as f64, 24, -149) as f32, x.mul_add(y, z));
        assert!(got.to_bits() == want.to_bits() || got.is_nan() && want.is_nan(), "{x:e} {y:e} {z:e}");
    }
}
