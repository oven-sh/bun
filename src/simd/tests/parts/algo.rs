use bun_simd::{mem::*, target::*, text::*, *};
use framework::*;

fn part(io: &Io, len: usize) -> (usize, usize, usize, usize) {
    let (n, at) = (io.n as usize, |shift: u32, max: usize| {
        (io.n.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> shift) as usize % (max + 1)
    });
    let start = n % 9;
    let end = start + if n & 16 == 0 { at(8, 70) } else { at(8, len - 9) }.min(len - 9);
    (start, end, at(24, len), at(40, len))
}
fn tops(m: &Model) -> Vec<bool> {
    let all = m.slice().repeat(4);
    let (start, end, from, to) = part(m.io, all.len());
    (start..end).map(|i| all[i] >> (m.t.bits() - 1) & 1 == 1 && i >= from && i < to).collect()
}
fn or_none(at: Option<usize>) -> i128 {
    at.map_or(-1, |it| it as _)
}

#[test]
fn like_slices() {
    let (d, mut array, mut vec) = (baseline().native(), [1u8, 2, 3], vec![0u8; 3]);
    d.over(&array).map_into(&mut vec, |v| v + 1);
    d.over(&vec).map_into(&mut array, |v| v + 1);
    assert_eq!(
        (
            d.over(&mut array).position(|v| v.simd_eq(4)),
            d.over(&mut vec).count(|v| v.simd_gt(2)),
            d.over(&mut vec[..]).rposition(|v| v.simd_eq(2))
        ),
        (Some(1), 2, Some(0))
    );
}

cases! {
    find_if sizes 0..=64, |d, _, _, _, io| {
        let mut all = io.slice::<T>().repeat(4);
        let (start, end, from, to) = part(io, all.len());
        all[..from].fill(T::default());
        all[to..].fill(T::default());
        [d.over(&all[start..end]).position(|v| v.cast_signed().is_negative()), d.over(&all[start..end]).rposition(|v| v.cast_signed().is_negative())]
    } => |m| vec![or_none(tops(m).iter().position(|&it| it)), or_none(tops(m).iter().rposition(|&it| it))];
    any_if_and_transform_until uint 0..=64, |d, _, _, _, io| {
        let mut all = io.slice::<T>().repeat(4);
        let (start, end, from, to) = part(io, all.len());
        all[..from].fill(T::default());
        all[to..].fill(T::default());
        let mut out = all.clone();
        let n = d.over(&all[start..end]).map_until(&mut out[1..], |v| v.cast_signed().is_negative(), |v| v + 1);
        assert!(out[0] == all[0] && out[1 + end - start..] == all[1 + end - start..]);
        ([d.over(&all[start..end]).any(|v| v.cast_signed().is_negative()) as usize, n], out[1..][..n].to_vec())
    } => |m| {
        let all = m.slice().repeat(4);
        let (start, _, from, to) = part(m.io, all.len());
        let n = tops(m).iter().position(|&it| it).unwrap_or(tops(m).len());
        let values = (start..start + n).map(|i| if i >= from && i < to { all[i] + 1 } else { 1 });
        [tops(m).contains(&true) as i128, n as _].into_iter().chain(values).collect()
    };
    in_cells sizes 0..=64, |d, _, _, _, io| {
        let mut all = io.slice::<T>().repeat(4);
        let (start, end, from, to) = part(io, all.len());
        all[..from].fill(T::default());
        all[to..].fill(T::default());
        let cells = std::cell::Cell::from_mut(&mut all[start..end]).as_slice_of_cells();
        ([d.over(cells).position(|v| v.cast_signed().is_negative()), d.over(cells).rposition(|v| v.cast_signed().is_negative())], d.over(cells).count(|v| v.cast_signed().is_negative()))
    } => |m| vec![or_none(tops(m).iter().position(|&it| it)), or_none(tops(m).iter().rposition(|&it| it)), tops(m).iter().filter(|&&it| it).count() as _];
    mismatch int 0..=64, |d, _, _, _, io| { let all = io.slice::<T>(); d.over(&all[..io.up_to(128 / LANE)]).zip(&all[64 / LANE..]).position(#[inline(always)] |(a, b)| a.simd_ne(b)) }
        => |m| { let all = m.slice(); vec![or_none((0..m.io.up_to(128 / m.t.size())).find(|&i| all[i] != all[i + 64 / m.t.size()]))] };
    find_any_of [u8] 0..=64, |d, _, _, _, io| {
        let (all, n) = (io.slice::<u8>(), io.up_to(200));
        let set = &all[200..][..io.up_to(20)];
        [d.over(&all[..n]).position_of_any(set), d.over(&all[..n]).rposition({ let set = ByteSet::of(set); move |v| set.contains(v) })]
    } => |m| {
        let (all, n) = (m.slice(), m.io.up_to(200));
        let set = &all[200..][..m.io.up_to(20)];
        vec![or_none(all[..n].iter().position(|it| set.contains(it))), or_none(all[..n].iter().rposition(|it| set.contains(it)))]
    };
    any_if sizes 0..=64, |d, _, _, _, io| {
        let mut all = io.slice::<T>().repeat(4);
        let (start, end, from, to) = part(io, all.len());
        all[..from].fill(T::default());
        all[to.min(from + 2)..].fill(T::default());
        [d.over(&all[start..end]).any(|v| v.cast_signed().is_negative()) as u8, d.over(&all[start..end]).all(|v| !v.cast_signed().is_negative()) as u8]
    } => |m| {
        let (start, _, from, _) = part(m.io, 4 * m.slice().len());
        let any = tops(m).iter().enumerate().any(|(i, &it)| it && start + i < from + 2);
        vec![any as _, !any as _]
    };
    true_lanes sizes 0..=64, |d, a, _, _, _| a.cast_signed().is_negative().iter().map(|it| it as u64).collect::<Vec<_>>()
        => |m| (0..m.n).filter(|&i| m.ma[i]).map(|i| i as _).collect();
    transform uint 0..=64, |d, _, _, _, io| {
        let (from, mut to, mut same, n) = (io.slice::<T>(), io.slice::<T>(), io.slice::<T>(), io.up_to((7 * d.lanes()).min(250 / size_of::<T>())));
        d.over(&from[1..][..n]).map_into(&mut to[1..], |v| v + 1);
        d.over_mut(&mut same[1..][..n]).map(|v| v + 1);
        (to, same)
    } => |m| { let mut all = m.slice(); for it in &mut all[1..][..m.io.up_to((7 * m.n).min(250 / m.t.size()))] { *it += 1 } all.repeat(2) };
    transform_cells [u16] 4..=64, |d, _, _, _, io| {
        let (mut from, mut to, n) = (io.slice::<u16>(), vec![0u8; 128], io.up_to(127));
        let cells = std::cell::Cell::from_mut(&mut from[..n]).as_slice_of_cells();
        d.over(cells).map_into(&mut to[..], |v| v.cast::<u8>().resize::<W::Half>());
        to
    } => |m| (0..128).map(|i| if i < m.io.up_to(127) { m.slice()[i] } else { 0 }).collect();
    transform_to_more [u8] 2..=32, |d, _, _, _, io| {
        let (mut from, mut to, n) = (io.slice::<u8>(), vec![0u8; 512], io.up_to(127));
        let twice = |v: Simd<u8, _, _>| v.cast::<u16>().resize::<W::Twice>().bitcast::<u8>() + 1;
        d.over(&from[..n]).map_into(&mut to[..256], twice);
        d.over(std::cell::Cell::from_mut(&mut from[..n]).as_slice_of_cells()).map_into(&mut to[256..], twice);
        to
    } => |m| (0..256).map(|i| if i / 2 >= m.io.up_to(127) { 0 } else if i % 2 == 1 { 1 } else { m.slice()[i / 2] + 1 }).collect::<Vec<_>>().repeat(2);
    transform_to_string [u8] 0..=64, |d, _, _, _, io| {
        let (from, n, least) = (io.slice::<u8>().iter().map(|it| it | 1).collect::<Vec<_>>(), io.up_to(250), std::cell::Cell::new(d.splat(255)));
        let mut text = String::with_capacity(n + 2 * STEP);
        {
            let out = &mut Output::append(&mut text, n + 2 * STEP);
            d.over(&from[..n]).map_into(out, |v| { least.set(least.get().simd_min(v)); v });
            d.over(&from[..n]).map_into(&mut vec![0; n][..], |v| { least.set(least.get().simd_min(v)); v });
            out.push(d.splat(0xc1).ascii().first_n(1));
            out.push(d.splat(0xc2).ascii());
        }
        (text.into_bytes(), least.get().simd_eq(0).any() as u8)
    } => |m| m.slice()[..m.io.up_to(250)].iter().map(|it| (it | 1) & 127).chain([0x41]).chain(vec![0x42; m.n]).chain([0]).collect();
    transform_to_fewer [u8] 4..=64, |d, _, _, _, io| {
        let (mut from, mut to, n) = (io.slice::<u8>(), vec![0u8; 256], 2 * io.up_to(127));
        let half = |v: Simd<u8, _, _>| (v.bitcast::<u16>() >> 8).cast::<u8>().resize::<W::Half>();
        d.over(&from[..n]).map_into(&mut to[..128], half);
        d.over(std::cell::Cell::from_mut(&mut from[..n]).as_slice_of_cells()).map_into(&mut to[128..], half);
        to
    } => |m| (0..128).map(|i| if i < m.io.up_to(127) { m.slice()[2 * i + 1] } else { 0 }).collect::<Vec<_>>().repeat(2);
    blocks uint 0..=64, |d, _, _, _, io| {
        let from = io.slice::<T>();
        let (mut lanes, mut valid) = (vec![], vec![]);
        for (v, bits) in d.over(&from[..io.up_to(3 * d.lanes())]).padded() { lanes.extend_from_slice(v.to_array().as_ref()); valid.push(bits) }
        (lanes, valid)
    } => |m| {
        let n = m.io.up_to(3 * m.n);
        let mut all = m.slice()[..n].to_vec();
        all.resize(n.next_multiple_of(m.n), 0);
        all.extend((0..n).step_by(m.n).map(|at| (1 << (n - at).min(m.n)) - 1));
        all
    };
    byte_set [u8] 0..=64, |d, a, _, _, _| const { ByteSet::new(&[0..=8, b'a'..=b'z', b'0'..=b'9', 0x7f..=0x90, 0xff..=0xff]) }.contains(a)
        => |m| m.mask(|i| matches!(m.a[i], 0..=8 | 0x61..=0x7a | 0x30..=0x39 | 0x7f..=0x90 | 0xff));
    byte_set_ascii [u8] 0..=64, |d, a, _, _, _| const { ByteSet::new(&[0..=8, b'a'..=b'z', 0x7f..=0x7f]) }.contains(a)
        => |m| m.mask(|i| matches!(m.a[i], 0..=8 | 0x61..=0x7a | 0x7f));
    prefix_xor [u8] 16..=16, |d, _, _, _, io| d.isa().prefix_xor(io.n)
        => |m| vec![(0..64).map(|i| ((m.io.n << (63 - i)).count_ones() as i128 & 1) << i).sum()];
    test_any_bit int 0..=64, |d, a, b, _, _| a.any_bits(b) => |m| m.mask(|i| m.a[i] & m.b[i] != 0);
    operands all 0..=64, |d, a, b, _, _| (a - b[0], a.simd_lt(b[0]).select(b[0], a))
        => |m| [m.each(|i| if let F(_) = m.t { m.t.of(m.t.float(m.a[i]) - m.t.float(m.b[0])) } else { m.a[i] - m.b[0] }),
            m.each(|i| if m.t.lt(m.a[i], m.b[0]) { m.b[0] } else { m.a[i] })].concat();
    literals uint 0..=64, |d, a, _, _, _| a & !T::of::<0x80>() | 3 => |m| m.map1(|x| x & !0x80 | 3);
    short sizes 0..=64, |d, _, _, _, io| {
        let (from, mut to, n) = (io.slice::<T>(), io.slice::<T>(), io.up_to(d.lanes() - 1));
        (!d.load_short(&from[1..][..n])).store_short(&mut to[1..][..n]);
        to
    } => |m| { let mut all = m.slice(); for it in &mut all[1..][..m.io.up_to(m.n - 1)] { *it = !*it } all };
}
