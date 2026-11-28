#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

/// Lane `i` of the result is lane `f(i)` of `a` followed by `b`.
fn pick(m: &Model, f: impl Fn(usize) -> usize) -> Lanes {
    let both = [&m.a[..], &m.b].concat();
    m.each(|i| both[f(i)])
}
/// For the operations that take `hi` and `lo`, which are `b` and `a`.
fn halves(m: &Model, lo: usize, hi: usize) -> Lanes {
    [&m.a[lo * m.n / 2..][..m.n / 2], &m.b[hi * m.n / 2..][..m.n / 2]].concat()
}
/// In each block, bytes of `lo` followed by `hi`, from `k` on.
fn align(m: &Model, hi: Option<usize>, lo: Option<usize>, k: usize) -> Lanes {
    let (size, of) = (m.bytes.min(16), |it: Option<usize>| it.map_or(vec![0; STEP], |it| m.view(it, U(8))));
    let (hi, lo) = (of(hi), of(lo));
    m.from_bytes((0..m.bytes).map(|i| if i % size + k < size { lo[i + k] } else { hi[i + k - size] }))
}
fn slide(m: &Model, lo: &[i128], hi: &[i128], k: usize) -> Lanes {
    [lo, hi].concat()[k..][..m.n].to_vec()
}
fn block_at(m: &Model, i: usize, f: impl Fn(usize, usize) -> usize) -> usize {
    f(i / m.block, m.n / m.block) * m.block + i % m.block
}

cases! {
    lanes sizes 0..=64, |d, a, b, _, io| {
        let i = io.up_to(d.lanes() - 1);
        ([a[0], a.lane_dyn(i)], a.with_lane_dyn(i, b[0]))
    } => |m| { let i = m.io.up_to(m.n - 1); [vec![m.a[0], m.a[i]], m.each(|j| if i == j { m.b[0] } else { m.a[j] })].concat() };
    halves_and_combine sizes 2 * LANE + 1 / LANE * 2..=64, |d, a, b, _, _|
        ([a.split()[1], a.split()[0]], [d.from_halves([a.split()[1], b.split()[0]]), a.split()[0].resize::<W>()])
        => |m| [&m.a[m.n / 2..], &m.a[..m.n / 2], &m.a[m.n / 2..], &m.b[..m.n / 2], &m.a[..m.n / 2], &vec![0; m.n / 2]].concat();
    concat sizes 2 * LANE..=64, |d, a, b, _, _| [a.deinterleave(b)[0], a.deinterleave(b)[1], a.concat_halves::<0, 0>(b),
        a.concat_halves::<1, 1>(b), a.concat_halves::<1, 0>(b), a.concat_halves::<0, 1>(b)]
        => |m| [pick(m, |i| 2 * i), pick(m, |i| 2 * i + 1), halves(m, 0, 0), halves(m, 1, 1), halves(m, 1, 0), halves(m, 0, 1)].concat();
    block_0 sizes 16..=64, |d, a, b, _, _| (a.block::<0>(), [a.with_block::<0>(b.block::<0>()), a.as_u128s().splat_lane::<0>()])
        => |m| [m.a[..m.block].to_vec(), pick(m, |i| if i < m.block { m.n + i } else { i }), pick(m, |i| i % m.block)].concat();
    block_1 sizes 32..=64, |d, a, b, _, _| (a.block::<1>(), [a.with_block::<1>(b.block::<0>()), a.as_u128s().splat_lane::<1>()])
        => |m| [m.a[m.block..][..m.block].to_vec(), pick(m, |i| if i / m.block == 1 { m.n + i % m.block } else { i }),
            pick(m, |i| m.block + i % m.block)].concat();
    block_3 sizes 64..=64, |d, a, b, _, _| (a.block::<3>(), [a.with_block::<3>(b.block::<2>()), a.as_u128s().splat_lane::<3>()])
        => |m| [m.a[3 * m.block..].to_vec(), pick(m, |i| if i / m.block == 3 { m.n + i - m.block } else { i }),
            pick(m, |i| 3 * m.block + i % m.block)].concat();
    reverse sizes 0..=64, |d, a, _, _, _| [a.reverse(), a.as_u128s().reverse(), a.as_u128s().swap_pairs()]
        => |m| [pick(m, |i| m.n - 1 - i), pick(m, |i| block_at(m, i, |b, n| n - 1 - b)), pick(m, |i| block_at(m, i, |b, n| (b ^ 1) % n))].concat();
    reverse2 sizes 2 * LANE..=64, |d, a, _, _, _| [a.swap_pairs(), a.swizzle_groups([0, 0]), a.swizzle_groups([1, 1])]
        => |m| [pick(m, |i| i / 2 * 2 + 1 - i % 2), pick(m, |i| i / 2 * 2), pick(m, |i| i / 2 * 2 + 1)].concat();
    reverse4 sizes 4 * LANE..=64, |d, a, _, _, _|
        [a.swizzle_groups([3, 2, 1, 0]), a.swizzle_groups([2, 3, 0, 1]), a.swizzle_groups([1, 2, 3, 0]), a.swizzle_groups([3, 0, 1, 2]), a.swizzle_groups([2, 0, 0, 3])]
        => |m| [[3, 2, 1, 0], [2, 3, 0, 1], [1, 2, 3, 0], [3, 0, 1, 2], [2, 0, 0, 3]].map(|it| pick(m, |i| i / 4 * 4 + it[i % 4])).concat();
    reverse8 sizes 8 * LANE..=64, |d, a, _, _, _| a.swizzle_groups([7, 6, 5, 4, 3, 2, 1, 0]) => |m| pick(m, |i| i / 8 * 8 + 7 - i % 8);
    interleave sizes 2 * LANE..=64, |d, a, b, _, _| [a.in_blocks().interleave(b)[0], a.in_blocks().interleave(b)[1], a.interleave(b)[0],
        a.interleave(b)[1], a.transpose_pairs(b)[0], a.transpose_pairs(b)[1], b.alternate(a)]
        => |m| [m.blocks(|a, b, j| [a, b][j % 2][j / 2]), m.blocks(|a, b, j| [a, b][j % 2][m.block / 2 + j / 2]),
            m.each(|i| [&m.a, &m.b][i % 2][i / 2]), m.each(|i| [&m.a, &m.b][i % 2][m.n / 2 + i / 2]),
            m.each(|i| [&m.a, &m.b][i % 2][i / 2 * 2]), m.each(|i| [&m.a, &m.b][i % 2][i / 2 * 2 + 1]),
            m.each(|i| [&m.b, &m.a][i % 2][i])].concat();
    interleave_blocks sizes 32..=64, |d, a, b, _, _| [a.as_u128s().transpose_pairs(b)[0], a.as_u128s().transpose_pairs(b)[1], b.as_u128s().alternate(a)]
        => |m| [m.each(|i| [&m.a, &m.b][i / m.block % 2][block_at(m, i, |b, _| b / 2 * 2)]),
            m.each(|i| [&m.a, &m.b][i / m.block % 2][block_at(m, i, |b, _| b / 2 * 2 + 1)]),
            m.each(|i| [&m.b, &m.a][i / m.block % 2][i])].concat();
    one_block sizes 16..=16, |d, a, b, _, _| [a.as_u128s().transpose_pairs(b)[0], b.as_u128s().alternate(a)] => |m| [&m.a[..], &m.b].concat();
    broadcast sizes 2 * LANE..=64, |d, a, _, _, _| [a.in_blocks().splat_lane::<0>(), a.in_blocks().splat_lane::<1>(), a.splat_lane::<1>()]
        => |m| [m.blocks(|a, _, _| a[0]), m.blocks(|a, _, _| a[1]), pick(m, |_| 1)].concat();
    broadcast_7 sizes 8 * LANE..=64, |d, a, _, _, _| a.splat_lane::<7>() => |m| pick(m, |_| 7);
    shift_bytes sizes 0..=64, |d, a, b, _, _| [a.bitcast::<u8>().in_blocks().shift_elements_right::<1>(0).bitcast::<T>(), a.bitcast::<u8>().in_blocks().shift_elements_left::<1>(0).bitcast::<T>(), a.bitcast::<u8>().in_blocks().shift_elements_left::<1>(b.bitcast::<u8>()).bitcast::<T>(),
        a.bitcast::<u8>().in_blocks().shift_elements_right::<0>(0).bitcast::<T>(), a.bitcast::<u8>().in_blocks().shift_elements_left::<2>(b.bitcast::<u8>()).bitcast::<T>()].map(|v| v.cast_unsigned())
        => |m| [align(m, Some(0), None, m.bytes.min(16) - 1), align(m, None, Some(0), 1), align(m, Some(1), Some(0), 1), m.a.clone(),
            align(m, Some(1), Some(0), 2)].concat();
    shift_many_bytes sizes 16..=64, |d, a, b, _, _| [a.bitcast::<u8>().in_blocks().shift_elements_right::<11>(0).bitcast::<T>(), a.bitcast::<u8>().in_blocks().shift_elements_left::<15>(0).bitcast::<T>(),
        a.bitcast::<u8>().in_blocks().shift_elements_left::<8>(b.bitcast::<u8>()).bitcast::<T>(), a.bitcast::<u8>().in_blocks().shift_elements_right::<16>(0).bitcast::<T>(), a.bitcast::<u8>().in_blocks().shift_elements_left::<16>(b.bitcast::<u8>()).bitcast::<T>()].map(|v| v.cast_unsigned())
        => |m| [align(m, Some(0), None, 5), align(m, None, Some(0), 15), align(m, Some(1), Some(0), 8), vec![0; m.n], m.b.clone()].concat();
    shift_lanes sizes 0..=64, |d, a, _, _, _| [a.in_blocks().shift_elements_right::<1>(T::ZERO), a.in_blocks().shift_elements_left::<1>(T::ZERO)]
        => |m| [align(m, Some(0), None, m.bytes.min(16) - m.t.size()), align(m, None, Some(0), m.t.size())].concat();
    slide_1 sizes 0..=64, |d, a, b, _, _|
        [a.shift_elements_right::<1>(T::ZERO), a.shift_elements_left::<1>(T::ZERO), b.shift_elements_right::<1>(a), a.shift_elements_left::<1>(b), b.shift_elements_right::<0>(a)]
        => |m| [slide(m, &vec![0; m.n], &m.a, m.n - 1), slide(m, &m.a, &vec![0; m.n], 1), slide(m, &m.a, &m.b, m.n - 1),
            slide(m, &m.a, &m.b, 1), m.b.clone()].concat();
    slide_3 sizes 4 * LANE..=64, |d, a, b, _, _|
        [a.shift_elements_right::<3>(T::ZERO), a.shift_elements_left::<3>(T::ZERO), b.shift_elements_right::<3>(a), a.shift_elements_left::<4>(b), b.shift_elements_right::<4>(a)]
        => |m| [slide(m, &vec![0; m.n], &m.a, m.n - 3), slide(m, &m.a, &vec![0; m.n], 3), slide(m, &m.a, &m.b, m.n - 3),
            slide(m, &m.a, &m.b, 4), slide(m, &m.a, &m.b, m.n - 4)].concat();
    splice all 0..=64, |d, a, b, _, io| { let n = io.up_to(d.lanes() + 1); [a.shift_elements_right_dyn(n, b), a.shift_elements_left_dyn(n, b), a.shift_elements_right_dyn(n, b[0]), a.shift_elements_left_dyn(n, b[0])] }
        => |m| { let (n, both) = (m.io.up_to(m.n + 1).min(m.n), |x: &[_], y: &[_], at: usize| [x, y].concat()[at..][..m.n].to_vec()); let fill = vec![m.b[0]; m.n];
            [both(&m.b, &m.a, m.n - n), both(&m.a, &m.b, n), both(&fill, &m.a, m.n - n), both(&m.a, &fill, n)].concat() };
    slide_lanes sizes 0..=64, |d, a, _, _, io| [a.shift_elements_right_dyn(io.up_to(d.lanes()), T::ZERO), a.shift_elements_left_dyn(io.up_to(d.lanes()), T::ZERO)]
        => |m| [slide(m, &vec![0; m.n], &m.a, m.n - m.io.up_to(m.n)), slide(m, &m.a, &vec![0; m.n], m.io.up_to(m.n))].concat();
}
