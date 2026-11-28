#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn count(m: &Model, y: i128) -> u32 {
    y as u32 % m.t.bits()
}

cases! {
    logic sizes 0..=64, |d, a, b, c, _| [a & b, a | b, a ^ b, !a, !a & b, a.bit_select(b, c)].map(|v| v.cast_unsigned())
        => |m| [m.map2(|x, y| x & y), m.map2(|x, y| x | y), m.map2(|x, y| x ^ y), m.map1(|x| !x), m.map2(|x, y| !x & y),
            m.map3(|x, y, z| x & y | !x & z)].concat();
    shift_same int 0..=64, |d, a, _, _, io| (a << io.n as u32, a >> io.n as u32)
        => |m| [m.map1(|x| x << count(m, m.io.n as i128)), m.map1(|x| x >> count(m, m.io.n as i128))].concat();
    shift_const int 0..=64, |d, a, _, _, _| [a << 1, a >> 1, a << 7, a >> 7, a << 0]
        => |m| [m.map1(|x| x << 1), m.map1(|x| x >> 1), m.map1(|x| x << 7), m.map1(|x| x >> 7), m.a.clone()].concat();
    shift_lanes int 0..=64, |d, a, b, _, _| (a << b, a >> b)
        => |m| [m.map2(|x, y| x << count(m, y)), m.map2(|x, y| x >> count(m, y))].concat();
    rotate_known int 0..=64, |d, a, _, _, _| {
        [a.rotate_right(8), a.rotate_right(16), a.rotate_right(24), a.rotate_right(32), a.rotate_right(40), a.rotate_right(56), a.rotate_right(7), a.rotate_right(63)]
    } => |m| [8, 16, 24, 32, 40, 56, 7, 63].map(|n| {
        let (bits, n) = (m.t.bits(), n % m.t.bits());
        m.each(|i| { let x = m.a[i] & ((1 << bits) - 1); x >> n | x << (bits - n) })
    }).concat();
    rotate int 0..=64, |d, a, _, _, io| [a.rotate_right(io.n as u32), a.rotate_left(io.n as u32), a.rotate_left(3)] => |m| {
        let (by, bits) = (count(m, m.io.n as i128), m.t.bits());
        let right = |by: u32| m.map1(|x| m.t.unsigned(x) >> by | (m.t.unsigned(x) as u128).wrapping_shl(bits - by) as i128);
        [right(by), right(bits - by), right(bits - 3)].concat()
    };
    rounding_shift_right int 0..=64, |d, a, _, _, _| [a.rounding_shr(1), a.rounding_shr(5), a.rounding_shr(T::BITS - 1)]
        => |m| [1, 5, m.t.bits() - 1].map(|by| m.map1(|x| (x + (1 << (by - 1))) >> by)).concat();
    rounding_shr_relaxed int 0..=64, |d, a, b, _, io| { let a = a >> 1; [a.rounding_shr_relaxed(0), a.rounding_shr_relaxed(5), a.rounding_shr_relaxed(2 * T::BITS - 1), a.rounding_shr_relaxed(io.n as u32), a.rounding_shr_relaxed(b)] }
        => |m| { let of = |x: i128, by: i128| { let by = by & (m.t.bits() as i128 - 1); ((x >> 1) + (1 << by >> 1)) >> by }; [[0, 5, -1, m.io.n as i128].map(|by| m.map1(|x| of(x, by))).concat(), m.map2(of)].concat() };
    reverse_lane_bytes int 0..=64, |d, a, _, _, _| a.swap_bytes() => |m| m.map1(|x| x.swap_bytes() >> (128 - m.t.bits()));
    reverse_bits int 0..=64, |d, a, _, _, _| a.reverse_bits() => |m| m.map1(|x| x.reverse_bits() >> (128 - m.t.bits()));
    population_count int 0..=64, |d, a, _, _, _| a.count_ones() => |m| m.map1(|x| m.t.unsigned(x).count_ones() as _);
    leading_zero_count int 0..=64, |d, a, _, _, _| a.leading_zeros()
        => |m| m.map1(|x| (m.t.unsigned(x).leading_zeros() - (128 - m.t.bits())) as _);
    trailing_zero_count int 0..=64, |d, a, _, _, _| a.trailing_zeros()
        => |m| m.map1(|x| x.trailing_zeros().min(m.t.bits()) as _);
    in_range uint 0..=64, |d, a, b, c, _| a.within(b[0].min(c[0])..=b[0].max(c[0]))
        => |m| m.mask(|i| m.b[0].min(m.c[0]) <= m.a[i] && m.a[i] <= m.b[0].max(m.c[0]));
    test_bit int 0..=64, |d, a, b, _, _| a.all_bits(b) => |m| m.mask(|i| m.a[i] & m.b[i] == m.b[i]);
    any_bit int 0..=64, |d, a, b, c, _| (a.any_bits(b), a.any_bits(b).select(b, c))
        => |m| [m.mask(|i| m.a[i] & m.b[i] != 0), m.each(|i| if m.a[i] & m.b[i] != 0 { m.b[i] } else { m.c[i] })].concat();
    any_known_bit int 0..=64, |d, a, b, c, _| {
        let last = d.lanes() - 1;
        let (each, but_last) = (d.from_fn(#[inline(always)] |i| T::of::<1>() << (i as u32 % 7)), d.from_fn(#[inline(always)] |i| if i == last { T::of::<0>() } else { T::of::<2>() }));
        let (more, top) = (d.from_fn(#[inline(always)] |i| if i == last { T::of::<6>() } else { T::of::<4>() }), d.from_fn(#[inline(always)] |i| if i == last { d.sign_bit()[0] } else { T::of::<1>() }));
        [a.any_bits(0).select(b, c), a.any_bits(64).select(b, c), a.any_bits(each).select(b, c), a.any_bits(but_last).select(b, c), a.any_bits(more).select(b, c), a.any_bits(top).select(b, c)]
    } => |m| {
        let by = |f: &dyn Fn(usize) -> i128| m.each(|i| if m.a[i] & f(i) != 0 { m.b[i] } else { m.c[i] });
        let but = |last: i128, others: i128| by(&|i| if i == m.n - 1 { last } else { others });
        [by(&|_| 0), by(&|_| 64), by(&|i| 1 << (i % 7)), but(0, 2), but(6, 4), but(1 << (m.t.bits() - 1), 1)].concat()
    };
    all_bits_0 sizes 0..=64, |d, a, b, _, _| (a.cast_unsigned() == 0, a.cast_unsigned() == b.cast_unsigned())
        => |m| vec![m.a.iter().all(|&x| x == 0) as _, (m.a == m.b) as _];
}
