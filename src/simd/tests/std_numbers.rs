//! The names that come from the integers of std.
#![allow(dead_code, unreachable_pub)]
#![allow(clippy::manual_isolate_lowest_one)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn over(m: &Model, f: impl Fn(usize) -> i128) -> Lanes {
    [m.each(&f), m.mask(|i| m.t.clamp(f(i)) != f(i))].concat()
}
fn product(m: &Model, i: usize) -> i128 {
    m.a[i].checked_mul(m.b[i]).unwrap_or(i128::MAX)
}
fn shl(t: Ty, x: i128, n: i128) -> i128 {
    if n < t.bits() as i128 { x << n } else { 0 }
}
fn shr(x: i128, n: i128) -> i128 {
    x >> n.min(127)
}
fn other(t: Ty, x: i128) -> i128 {
    if let I(bits) = t { U(bits).wrap(x) } else { I(t.bits()).wrap(x) }
}

cases! {
    euclid int 0..=64, |d, a, b, _, _| [a.rem_euclid(b), a.div_euclid(b), a.rem_euclid(T::of::<7>()), a.div_euclid(math::Divisor::new(T::of::<60>()).unwrap())] => |m| [
        m.map2(|x, y| if y == 0 { x } else { x.rem_euclid(y) }), m.map2(|x, y| if y == 0 { 0 } else { x.div_euclid(y) }), m.map1(|x| x.rem_euclid(7)), m.map1(|x| x.div_euclid(60))].concat();
    midpoint int 0..=64, |d, a, b, _, _| a.midpoint(b) => |m| m.map2(|x, y| (x + y) / 2);
    isolate int 0..=64, |d, a, _, _, _| [a.isolate_lowest_one(), a.isolate_highest_one()]
        => |m| [m.map1(|x| x & -x), m.map1(|x| if x == 0 { 0 } else { 1 << m.t.unsigned(x).ilog2() })].concat();
    unbounded int 0..=64, |d, a, b, _, io| { let small = b & T::of::<0x7f>();
        [a.unbounded_shl(b), a.unbounded_shr(b), a.unbounded_shl(small), a.unbounded_shr(small), a.unbounded_shl(io.n as u32), a.unbounded_shr(io.n as u32), a.unbounded_shl(7), a.unbounded_shr(64)] } => |m| {
        let n = m.io.n as u32 as i128;
        [m.map2(|x, y| shl(m.t, x, m.t.unsigned(y))), m.map2(|x, y| shr(x, m.t.unsigned(y))), m.map2(|x, y| shl(m.t, x, y & 0x7f)), m.map2(|x, y| shr(x, y & 0x7f)),
            m.map1(|x| shl(m.t, x, n)), m.map1(|x| shr(x, n)), m.map1(|x| x << 7), m.map1(|x| x >> 64)].concat() };
    other_counts int 0..=64, |d, a, _, _, io| { let (n, wide) = (io.n, (io.n as u128) << (io.n >> 8 & 64));
        [a << n, a >> n as i8, a << n as i16, a >> n as usize, a >> wide, a.rotate_left(n as i8), a.rotate_right(n as i64), a.unbounded_shl(n), a.unbounded_shr(n as i64), a.unbounded_shl(n as i8), a.unbounded_shr(n as u16),
            a.unbounded_shl(wide), a.unbounded_shr(wide as i128), a.unbounded_shl(-1), a.unbounded_shr(1u64 << 32), a << -1i8, a >> (1u64 << 32 | 1)] } => |m| {
        let (n, bits) = (m.io.n, m.t.bits() as i128);
        let wide = (n as u128) << (n >> 8 & 64);
        let (low, most) = (n as i128 % bits, wide.min(200) as i128);
        let left = |x: i128, by: i128| m.t.unsigned(x) << by | m.t.unsigned(x) >> (bits - by);
        [m.map1(|x| shl(m.t, x, low)), m.map1(|x| x >> low), m.map1(|x| shl(m.t, x, low)), m.map1(|x| x >> low), m.map1(|x| x >> (wide % bits as u128)), m.map1(|x| left(x, low)), m.map1(|x| left(x, (bits - low) % bits)),
            m.map1(|x| shl(m.t, x, n as i128)), m.map1(|x| shr(x, n as i128)), m.map1(|x| shl(m.t, x, n as u8 as i128)), m.map1(|x| shr(x, n as u16 as i128)),
            m.map1(|x| shl(m.t, x, most)), m.map1(|x| shr(x, most)), m.map1(|_| 0), m.map1(|x| x >> 64), m.map1(|x| shl(m.t, x, bits - 1)), m.map1(|x| x >> 1)].concat() };
    overflowing int 0..=64, |d, a, b, _, _| (a.overflowing_add(b), a.overflowing_sub(b)) => |m| [over(m, |i| m.a[i] + m.b[i]), over(m, |i| m.a[i] - m.b[i])].concat();
    products int 0..=64, |d, a, b, _, _| (a.overflowing_mul(b), a.saturating_mul(b))
        => |m| [m.map2(i128::wrapping_mul), m.mask(|i| m.t.clamp(product(m, i)) != product(m, i)), m.each(|i| m.t.clamp(product(m, i)))].concat();
    of_signed sint 0..=64, |d, a, b, _, _| ((a.is_positive(), a.unsigned_abs()), [a.saturating_add_unsigned(b.cast_unsigned()), a.saturating_sub_unsigned(b.cast_unsigned())])
        => |m| [m.mask(|i| m.a[i] > 0), m.map1(i128::abs), m.map2(|x, y| m.t.clamp(x + other(m.t, y))), m.map2(|x, y| m.t.clamp(x - other(m.t, y)))].concat();
    of_unsigned uint 0..=64, |d, a, b, _, _| ([a.saturating_add_signed(b.cast_signed()), a.saturating_sub_signed(b.cast_signed()), a.bit_width(), a.next_power_of_two(), a.div_ceil(b), a.div_ceil(T::of::<10>())], a.is_power_of_two())
        => |m| [m.map2(|x, y| m.t.clamp(x + other(m.t, y))), m.map2(|x, y| m.t.clamp(x - other(m.t, y))), m.map1(|x| (128 - x.leading_zeros()) as _), m.map1(|x| (x as u128).next_power_of_two() as _),
            m.map2(|x, y| if y == 0 { 0 } else { (x + y - 1) / y }), m.map1(|x| (x + 9) / 10), m.mask(|i| m.a[i].count_ones() == 1)].concat();
    carries uint 0..=64, |d, a, b, c, _| (a.carrying_add(b, c.to_mask()), a.borrowing_sub(b, c.to_mask()))
        => |m| [over(m, |i| m.a[i] + m.b[i] + m.mc[i] as i128), over(m, |i| m.a[i] - m.b[i] - m.mc[i] as i128)].concat();
    funnels uint 0..=64, |d, a, b, c, io| [a.funnel_shl(b, c), a.funnel_shr(b, c), a.funnel_shl(b, io.n as u32), a.funnel_shr(b, io.n as u32), a.funnel_shl(b, 3), a.funnel_shr(b, 5), a.funnel_shl(b, 0), a.funnel_shr(b, 0)] => |m| {
        let bits = m.t.bits();
        let both = |i: usize| (m.a[i] as u128) << bits | m.b[i] as u128;
        let (left, right) = (|i, n: i128| (both(i) << (n as u32 % bits) >> bits) as u64 as i128, |i, n: i128| (both(i) >> (n as u32 % bits)) as u64 as i128);
        let n = m.io.n as u32 as i128;
        [m.each(|i| left(i, m.c[i])), m.each(|i| right(i, m.c[i])), m.each(|i| left(i, n)), m.each(|i| right(i, n)), m.each(|i| left(i, 3)), m.each(|i| right(i, 5)), m.a.clone(), m.b.clone()].concat() };
}
