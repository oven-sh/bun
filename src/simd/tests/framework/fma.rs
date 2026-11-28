//! `x * y + z` rounded once, in integers, without the C library.

/// For a format with `p` bits of precision whose smallest subnormal is `2^tiny`. The result is a value of that format,
/// or too large for it.
pub fn fma(x: f64, y: f64, z: f64, p: i32, tiny: i32) -> f64 {
    if !(x.is_finite() && y.is_finite()) || x == 0.0 || y == 0.0 {
        return x * y + z;
    }
    if !z.is_finite() {
        return z;
    }
    let split = |v: f64| {
        let (e, m) = ((v.to_bits() >> 52 & 0x7ff) as i32, (v.to_bits() & ((1 << 52) - 1)) as u128);
        if e == 0 { (m, -1074) } else { (m | 1 << 52, e - 1075) }
    };
    // The highest bit goes to bit 124, so that at least 18 low bits are zero.
    let normal = |(m, e): (u128, i32)| {
        let s = m.leading_zeros() as i32 - 3;
        (m << s, e - s)
    };
    // The lowest bit of the result is set if any of the bits that are shifted out is.
    let shift = |m: u128, s: i32| if s >= 127 { (m != 0) as u128 } else { m >> s | (m & ((1 << s) - 1) != 0) as u128 };
    let ((mx, ex), (my, ey)) = (split(x), split(y));
    let (mut m, mut e) = normal((mx * my, ex + ey));
    let mut negative = (x < 0.0) != (y < 0.0);
    if z != 0.0 {
        let (mz, ez) = normal(split(z));
        let common = e.max(ez);
        let sum = shift(m, common - e) as i128 * if negative { -1 } else { 1 }
            + shift(mz, common - ez) as i128 * if z < 0.0 { -1 } else { 1 };
        if sum == 0 {
            return 0.0;
        }
        (m, e, negative) = (sum.unsigned_abs(), common, sum < 0);
    }
    let drop = (128 - m.leading_zeros() as i32 - p).max(tiny - e);
    if drop > 0 {
        let wide = if drop >= 2 { shift(m, drop - 2) } else { m << 1 };
        (m, e) = ((wide >> 2) + (wide & 3 == 3 || wide & 7 == 6) as u128, e + drop);
    }
    // Exact, but for an overflow: `m` has at most 54 bits, and each factor is normal.
    let pow2 = |e: i32| f64::from_bits(((e + 1023) as u64) << 52);
    let (mut v, mut e) = (m as u64 as f64, e);
    while e != 0 {
        let step = e.clamp(-1000, 1000);
        v *= pow2(step);
        e -= step;
    }
    if negative { -v } else { v }
}
