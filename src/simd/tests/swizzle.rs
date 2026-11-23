#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn both(m: &Model) -> Lanes {
    [&m.a[..], &m.b].concat()
}

/// Rows that differ: `a + i` in the bits.
#[inline(always)]
fn rows<S: Isa, T: Lane, W: Width, const N: usize>(a: Simd<T, W, S>) -> [Simd<T, W, S>; N] {
    let mut rows = [a; N];
    for (i, row) in rows.iter_mut().enumerate() {
        *row = (a.cast_unsigned() ^ a.like().to_unsigned().splat(Lane::from_usize(i * 5))).bitcast();
    }
    rows
}
fn transposed(m: &Model, rows: usize, side: usize) -> Lanes {
    let at = |row: usize, lane: usize| m.a[lane] ^ (row * 5) as i128;
    (0..rows * m.n)
        .map(|i| (i / m.n, i % m.n))
        .map(|(r, l)| at(r / side * side + l % side, l / side * side + r % side))
        .collect()
}

cases! {
    from_fn [u8 i32 f64] 0..=64, |d, _, _, _, io| d.from_fn(|i| T::from_usize(i * 3 + io.up_to(9))) => |m| m.each(|i| {
        let x = i * 3 + m.io.up_to(9);
        if let F(_) = m.t { m.t.of(x as f64) } else { x as i128 }
    });
    permute [u8 i16 f32 u64] 0..=64, |d, a, b, _, _| [a.swizzle(|i| (i * 5 + 3) % d.lanes()), a.concat_swizzle(b, |i| (i * 7 + 3) % (2 * d.lanes()))]
        => |m| [m.each(|i| m.a[(i * 5 + 3) % m.n]), m.each(|i| both(m)[(i * 7 + 3) % (2 * m.n)])].concat();
    permute_by_variable [u32] 0..=32, |d, a, b, _, io| a.concat_swizzle(b, |i| (i * 3 + io.up_to(200)) % (2 * d.lanes()))
        => |m| m.each(|i| both(m)[(i * 3 + m.io.up_to(200)) % (2 * m.n)]);
    permute_groups [u8 f32] 4 * LANE..=64, |d, a, b, _, _| [a.swizzle_groups([2, 0, 3, 3]), a.concat_swizzle_groups(b, [7, 0, 5, 2])]
        => |m| [m.each(|i| m.a[i / 4 * 4 + [2, 0, 3, 3][i % 4]]), m.each(|i| [m.b[i | 3], m.a[i & !3], m.b[i & !3 | 1], m.a[i & !3 | 2]][i % 4])].concat();
    slide_blocks sizes 0..=64, |d, a, _, _, _|
        [a.as_u128s().shift_elements_right::<0>(T::ZERO), a.as_u128s().shift_elements_right::<1>(T::ZERO), a.as_u128s().shift_elements_right::<3>(T::ZERO), a.as_u128s().shift_elements_left::<1>(T::ZERO), a.as_u128s().shift_elements_left::<2>(T::ZERO)]
        => |m| [0, 1, 3, -1, -2].map(|k| m.each(|i| *m.a.get((i as isize - k * m.block as isize) as usize).unwrap_or(&0))).concat();
    interleave_blocks sizes 32..=64, |d, a, b, _, _| [a.as_u128s().interleave(b)[0], a.as_u128s().interleave(b)[1]]
        => |m| [0, m.n / 2].map(|first| m.each(|i| [&m.a, &m.b][i / m.block % 2][first + i / m.block / 2 * m.block + i % m.block])).concat();
    compress_not_and_partition sizes 0..=64, |d, a, b, _, _| [a.compress_relaxed(!b.cast_signed().is_negative()), a.partition(b.cast_signed().is_negative())] => |m| {
        let with = |yes: bool| (0..m.n).filter(|&i| m.mb[i] == yes).map(|i| m.a[i]).collect::<Lanes>();
        let mut not = with(false);
        not.resize(m.n, ANY);
        [not, with(true), with(false)].concat()
    };
    transpose_in_blocks [u8 i16 f32 u64] 16..=64, |d, a, _, _, _| Simd::transpose_in_blocks::<16>(rows(a))
        => |m| transposed(m, 16, m.block);
    transpose2 sizes 2 * LANE..=2 * LANE, |d, a, _, _, _| Simd::transpose::<2>(rows(a)) => |m| transposed(m, 2, 2);
    transpose4 sizes 4 * LANE..=4 * LANE, |d, a, _, _, _| Simd::transpose::<4>(rows(a)) => |m| transposed(m, 4, 4);
    transpose8 sizes 8 * LANE..=8 * LANE, |d, a, _, _, _| Simd::transpose::<8>(rows(a)) => |m| transposed(m, 8, 8);
    transpose16 [u8 i16 f32] 16 * LANE..=16 * LANE, |d, a, _, _, _| Simd::transpose::<16>(rows(a)) => |m| transposed(m, 16, 16);
    transpose32 [i16] 32 * LANE..=32 * LANE, |d, a, _, _, _| Simd::transpose::<32>(rows(a)) => |m| transposed(m, 32, 32);
    lookup [u8 i16 f32 u64] 0..=64, |d, _, b, _, io| {
        let (table, b, u) = (io.slice::<T>(), b.cast_unsigned(), d.to_unsigned());
        macro_rules! of { ($n:expr) => { b.simd_min(u.splat(Lane::from_usize($n - 1))).lookup_relaxed(table.first_chunk::<{ $n }>().unwrap()) }; }
        [of!(8), of!(24 / LANE), of!(64 / LANE), of!(128 / LANE)]
    } => |m| [8, 24 / m.t.size(), 64 / m.t.size(), 128 / m.t.size()]
        .map(|n| m.each(|i| m.slice()[m.t.unsigned(m.b[i]).min(n as i128 - 1) as usize])).concat();
    bit_shuffle [u64] 8..=64, |d, a, b, _, _| a.bit_shuffle(b.bitcast::<u8>() & 63)
        => |m| m.each(|i| (0..8).map(|j| (m.a[i] >> (m.b[i] >> (8 * j) & 63) & 1) << j).sum());
}
