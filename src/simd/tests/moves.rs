#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

/// Lane i of the result is lane f(i) of a followed by b.
fn pick(m: &Model, f: impl Fn(usize) -> usize) -> Lanes {
    let both = [&m.a[..], &m.b].concat();
    m.each(|i| both[f(i)])
}
fn index(m: &Model, x: i128, end: usize) -> usize {
    m.t.unsigned(x) as usize % end
}
fn bytes(m: &Model, tables: usize, at: impl Fn(usize) -> Option<usize>) -> Lanes {
    let (size, a, b, c) = (m.bytes.min(16), m.view(0, U(8)), m.view(1, U(8)), m.view(2, U(8)));
    m.from_bytes((0..m.bytes).map(|i| {
        let start = i / size * size;
        at(c[i] as usize).map_or(0, |at| {
            let at = at % (tables * size);
            if at < size { a[start + at] } else { b[start + at - size] }
        })
    }))
}

cases! {
    pairs_of_results sizes 2 * LANE..=64, |d, a, b, _, _| ([a.interleave(b), a.deinterleave(b), a.transpose_pairs(b)], a.alternate(b))
        => |m| [pick(m, |i| i / 2 + i % 2 * m.n), pick(m, |i| (m.n + i) / 2 + i % 2 * m.n), pick(m, |i| 2 * i), pick(m, |i| 2 * i + 1),
            pick(m, |i| i / 2 * 2 + i % 2 * m.n), pick(m, |i| i / 2 * 2 + 1 + i % 2 * m.n), pick(m, |i| i + i % 2 * m.n)].concat();
    concat_halves sizes 2 * LANE..=64, |d, a, b, _, _|
        [a.concat_halves::<0, 0>(b), a.concat_halves::<0, 1>(b), a.concat_halves::<1, 0>(b), a.concat_halves::<1, 1>(b)]
        => |m| [(0, 0), (0, 1), (1, 0), (1, 1)].map(|(x, y)| [&m.a[x * m.n / 2..][..m.n / 2], &m.b[y * m.n / 2..][..m.n / 2]].concat()).concat();
    shift_elements sizes 0..=64, |d, a, b, _, _| [a.shift_elements_left::<1>(b), a.shift_elements_right::<1>(b), a.shift_elements_left::<1>(T::of::<7>())]
        => |m| [pick(m, |i| i + 1), pick(m, |i| (2 * m.n + i - 1) % (2 * m.n)),
            m.each(|i| if i + 1 < m.n { m.a[i + 1] } else if let F(_) = m.t { m.t.of(7.0) } else { 7 })].concat();
    rotate_elements sizes 0..=64, |d, a, _, _, io| {
        let n = io.n as usize;
        [a.rotate_elements_left::<1>(), a.rotate_elements_right::<1>(), a.rotate_elements_left::<67>(), a.rotate_elements_right::<131>(),
            a.rotate_elements_left_dyn(n), a.rotate_elements_right_dyn(n)]
    } => |m| { let n = m.io.n as usize % m.n; [1, m.n - 1, 67, 131 * m.n - 131, n, m.n - n].map(|k| pick(m, |i| (i + k) % m.n)).concat() };
    groups_of_2 sizes 2 * LANE..=64, |d, a, _, _, _|
        [a.swizzle_groups([1, 0]), a.swizzle_groups([0, 0]), a.swizzle_groups([1, 1]), a.swizzle_groups([0, 1]), a.swap_pairs()]
        => |m| [[1, 0], [0, 0], [1, 1], [0, 1], [1, 0]].map(|it| pick(m, |i| i / 2 * 2 + it[i % 2])).concat();
    groups_of_4 sizes 4 * LANE..=64, |d, a, _, _, _| [a.swizzle_groups([3, 2, 1, 0]), a.swizzle_groups([2, 3, 0, 1]), a.swizzle_groups([1, 2, 3, 0]),
        a.swizzle_groups([3, 0, 1, 2]), a.swizzle_groups([0, 2, 1, 3]), a.swizzle_groups([2, 0, 0, 3])]
        => |m| [[3, 2, 1, 0], [2, 3, 0, 1], [1, 2, 3, 0], [3, 0, 1, 2], [0, 2, 1, 3], [2, 0, 0, 3]].map(|it| pick(m, |i| i / 4 * 4 + it[i % 4])).concat();
    groups_of_8 sizes 8 * LANE..=64, |d, a, _, _, _| [a.swizzle_groups([7, 6, 5, 4, 3, 2, 1, 0]), a.swizzle_groups([0, 7, 1, 6, 2, 5, 3, 4])]
        => |m| [[7, 6, 5, 4, 3, 2, 1, 0], [0, 7, 1, 6, 2, 5, 3, 4]].map(|it| pick(m, |i| i / 8 * 8 + it[i % 8])).concat();
    swizzle_dyn sizes 0..=64, |d, a, b, c, _| { let (any, near) = (c.cast_unsigned(), c.cast_unsigned() & d.to_unsigned().splat(Lane::from_usize(4 * d.lanes() - 1)));
            [a.swizzle_dyn(any), a.concat_swizzle_dyn(b, any), a.swizzle_dyn(near), a.concat_swizzle_dyn(b, near)] }
        => |m| [(!0, 1), (!0, 2), (4 * m.n as u64 - 1, 1), (4 * m.n as u64 - 1, 2)].map(|(low, tables)| m.each(|i| {
            let at = m.t.unsigned(m.c[i]) as u64 & low;
            if at < (tables * m.n) as u64 { [&m.a, &m.b][at as usize / m.n][at as usize % m.n] } else { 0 }
        })).concat();
    lookup_bytes sizes 0..=64, |d, a, _, c, _| a.in_blocks().lookup_bytes(c.bitcast()) => |m| bytes(m, 1, |at| (at < 128).then_some(at));
    concat_lookup_bytes sizes 16..=64, |d, a, b, c, _| a.in_blocks().concat_lookup_bytes(b, c.bitcast()) => |m| bytes(m, 2, Some);
    lookup sizes 0..=64, |d, a, _, _, io| {
        let (all, a) = (io.slice::<T>(), a.cast_unsigned());
        [a.lookup::<T, 2>(all.first_chunk().unwrap()), a.lookup::<T, 8>(all.first_chunk().unwrap()), a.lookup::<T, 16>(all.first_chunk().unwrap()),
            a.lookup::<T, { 128 / LANE }>(all.first_chunk().unwrap()), a.lookup::<T, { 32 / LANE }>(all.first_chunk().unwrap())]
    } => |m| [2, 8, 16, 128 / m.t.size(), 32 / m.t.size()].map(|n| m.map1(|x| m.slice()[index(m, x, n)])).concat();
    add_pairs int 2 * LANE..=64, |d, a, b, _, _| [a.add_pairs(b), a.sub_pairs(b), a.in_blocks().add_pairs(b), a.in_blocks().sub_pairs(b)] => |m| {
        let (even, odd) = (pick(m, |i| 2 * i), pick(m, |i| 2 * i + 1));
        let at = |x: &[i128], y: &[i128], i: usize| [x, y].concat()[i];
        [m.each(|i| even[i] + odd[i]), m.each(|i| odd[i] - even[i]), m.blocks(|x, y, i| at(x, y, 2 * i) + at(x, y, 2 * i + 1)),
            m.blocks(|x, y, i| at(x, y, 2 * i + 1) - at(x, y, 2 * i))].concat()
    };
    in_blocks sizes 2 * LANE..=64, |d, a, b, _, _| {
        let v = a.in_blocks();
        ([v.interleave(b), v.deinterleave(b)], [v.reverse(), v.splat_lane::<1>(), v.shift_elements_left::<1>(b), v.shift_elements_right::<1>(b),
            v.rotate_elements_left::<1>(), v.rotate_elements_right::<1>()])
    } => |m| {
        let (k, with) = (m.block, |f: &dyn Fn(usize) -> usize| m.blocks(|x, y, i| [x, y].concat()[f(i)]));
        [with(&|i| i / 2 + i % 2 * k), with(&|i| (k + i) / 2 + i % 2 * k), with(&|i| 2 * i), with(&|i| 2 * i + 1), with(&|i| k - 1 - i), with(&|_| 1),
            with(&|i| i + 1), with(&|i| (2 * k + i - 1) % (2 * k)), with(&|i| (i + 1) % k), with(&|i| (i + k - 1) % k)].concat()
    };
    u128s sizes 32..=64, |d, a, b, _, _| {
        let (v, n) = (a.as_u128s(), (W::BYTES / 16).max(1));
        ([v.interleave(b), v.transpose_pairs(b)], [v.reverse(), v.swap_pairs(), v.splat_lane::<1>(), v.alternate(b),
            v.swizzle(|i| (i + 1) % n), v.concat_swizzle(b, |i| 2 * i + 1), v.shift_elements_left::<1>(T::ZERO), v.shift_elements_right::<1>(T::ZERO)])
    } => |m| {
        let (k, n) = (m.block, m.n / m.block);
        let with = |f: &dyn Fn(usize) -> usize| pick(m, |i| f(i / k) * k + i % k);
        [with(&|i| i / 2 + i % 2 * n), with(&|i| (n + i) / 2 + i % 2 * n), with(&|i| i / 2 * 2 + i % 2 * n), with(&|i| i / 2 * 2 + 1 + i % 2 * n),
            with(&|i| n - 1 - i), with(&|i| i ^ 1), with(&|_| 1), with(&|i| i + i % 2 * n), with(&|i| (i + 1) % n), with(&|i| 2 * i + 1),
            m.each(|i| if i + k < m.n { m.a[i + k] } else { 0 }), m.each(|i| if i >= k { m.a[i - k] } else { 0 })].concat()
    };
    compare_u128s [u64] 16..=64, |d, a, b, _, _| {
        let (v, u) = (a.as_u128s(), a.as_u128s().by_upper());
        ([v.simd_eq(b), v.simd_lt(b), u.simd_eq(b), u.simd_lt(b)], [v.simd_min(b), v.simd_max(b), u.simd_min(b), u.simd_max(b)])
    } => |m| {
        let key = |x: &[i128]| (x[1], x[0]);
        [m.blocks(|x, y, _| -((x == y) as i128)), m.blocks(|x, y, _| -((key(x) < key(y)) as i128)), m.blocks(|x, y, _| -((x[1] == y[1]) as i128)),
            m.blocks(|x, y, _| -((x[1] < y[1]) as i128)), m.blocks(|x, y, i| if key(x) < key(y) { x[i] } else { y[i] }),
            m.blocks(|x, y, i| if key(x) < key(y) { y[i] } else { x[i] }), m.blocks(|x, y, i| if x[1] < y[1] { x[i] } else { y[i] }),
            m.blocks(|x, y, i| if y[1] < x[1] { x[i] } else { y[i] })].concat()
    };
    transposes [u32 f32] 16..=16, |d, a, b, c, _| [Simd::transpose([a, b, c, a]), Simd::transpose_in_blocks([a, b, c, a])]
        => |m| { let all: Lanes = (0..16).map(|i| [&m.a, &m.b, &m.c, &m.a][i % 4][i / 4]).collect(); [all.clone(), all].concat() };
    bit_shuffle_wraps [u64] 16..=64, |d, a, b, _, _| a.bit_shuffle(b.bitcast())
        => |m| m.each(|i| (0..8).map(|j| (m.a[i] >> (m.b[i] >> (8 * j) & 63) & 1) << j).sum());
}
