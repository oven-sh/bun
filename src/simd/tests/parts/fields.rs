use bun_simd::{mem::Output, *};
use framework::*;

fn deposit(x: u64, mask: u64) -> u64 {
    (0..64).filter(|i| mask >> i & 1 == 1).enumerate().map(|(k, i)| (x >> k & 1) << i).sum()
}
fn extract(x: u64, mask: u64) -> u64 {
    (0..64).filter(|i| mask >> i & 1 == 1).enumerate().map(|(k, i)| (x >> i & 1) << k).sum()
}
fn cut(m: &Model, mask: u64) -> u64 {
    mask & !0 >> (64 - 8 * m.t.size())
}
fn both(m: &Model, mask: u64) -> Lanes {
    let mask = cut(m, mask);
    [m.map1(|x| deposit(x as u64, mask) as _), m.map1(|x| extract(x as u64, mask) as _)].concat()
}
macro_rules! constants { ($then:ident $($with:ident)*) => { $then!($($with)*; 0, !0, 1, 0x5555_5555_5555_5555, 0xaaaa_aaaa_aaaa_aaaa, 0x9249_2492_4924_9249, 0x0924_9249, 0x0303_0303_0303_0303,
    0x0606_0606_0606_0606, 0x7f7f_7f7f_7f7f_7f7f, 0x3f3f_3f3f_3f3f_3f3f, 0xf0f0_f0f0_f0f0_f0f0, 0x8000_0000_8000_8080, 0xfedc_ba98_7654_3210, 0x0123_4567_89ab_cdef, 0xffff_0000_ff00_fffd,
    0x0707_0707_0707_0707, 0x80ff_0018_e001_3cc0, 0x0010_ff00_00f8_8000, 0x1111_1111_1111_1111, 0x2492_4924_9249_2492, 0x5500_aa55_0055_aa00, 0x7f55_017f_157f_0541) }; }
macro_rules! vectors { ($a:ident; $($k:expr),*) => { [$([$a.deposit_bits(T::from_u64($k)), $a.extract_bits(T::from_u64($k))]),*] }; }
macro_rules! numbers { ($d:ident $a:ident; $($k:expr),*) => { vec![$($d.isa().deposit_bits($a[0], T::from_u64($k)), $d.isa().extract_bits($a[0], T::from_u64($k))),*] }; }
macro_rules! model { ($m:ident; $($k:expr),*) => { [$(both($m, $k)),*].concat() }; }
macro_rules! first { ($m:ident; $($k:expr),*) => { vec![$(deposit($m.a[0] as u64, cut($m, $k)) as i128, extract($m.a[0] as u64, cut($m, $k)) as i128),*] }; }
fn bit(m: &Model, i: usize) -> bool {
    m.io.n >> i & 1 == 1
}

cases! {
    scan_max int 0..=64, |d, a, _, _, _| [a.scan(T::MIN, |x, y| x.simd_max(y)), a.scan(T::MAX, |x, y| x.simd_min(y)), a.scan(T::ZERO, |x, y| x ^ y)]
        => |m| [m.each(|i| *m.a[..=i].iter().max().unwrap()), m.each(|i| *m.a[..=i].iter().min().unwrap()), m.each(|i| m.a[..=i].iter().fold(0, |x, y| x ^ y))].concat();
    scan_in_order int 0..=64, |d, a, b, _, _| { let v = a & b.any_bits(T::of::<3>()).select(T::ZERO, !d.zero()); [v.scan(T::ZERO, |x, y| y.simd_eq(T::ZERO).select(x, y)), v.scan(T::ZERO, |x, y| x.simd_eq(T::ZERO).select(y, x))] }
        => |m| { let v: Lanes = m.each(|i| if m.b[i] & 3 != 0 { 0 } else { m.a[i] });
            [m.each(|i| v[..=i].iter().rfind(|&&x| x != 0).copied().unwrap_or(0)), m.each(|i| v[..=i].iter().find(|&&x| x != 0).copied().unwrap_or(0))].concat() };
    any_mask uint 0..=64, |d, a, b, c, _| [a.deposit_bits(b[0]), a.extract_bits(b[0]), a.deposit_bits(b[0] & c[0]), a.extract_bits(b[0] & c[0])]
        => |m| [both(m, m.b[0] as u64), both(m, (m.b[0] & m.c[0]) as u64)].concat();
    constant_masks uint 0..=64, |d, a, _, _, _| constants!(vectors a) => |m| constants!(model m);
    of_numbers uint 16..=16, |d, a, b, _, _| (vec![d.isa().deposit_bits(a[0], b[0]), d.isa().extract_bits(a[0], b[0])], constants!(numbers d a))
        => |m| [vec![deposit(m.a[0] as u64, m.b[0] as u64) as i128, extract(m.a[0] as u64, m.b[0] as u64) as i128], constants!(first m)].concat();
    shifts_by_1 sint 0..=64, |d, a, b, _, _| { let (x, y) = (a.is_negative(), b.is_negative());
        [x.shift_elements_left::<0>(y), x.shift_elements_right::<0>(y), x.shift_elements_left::<1>(y), x.shift_elements_right::<1>(y)] }
        => |m| [m.mask(|i| m.ma[i]), m.mask(|i| m.ma[i]), m.mask(|i| if i + 1 < m.n { m.ma[i + 1] } else { m.mb[0] }), m.mask(|i| if i > 0 { m.ma[i - 1] } else { m.mb[m.n - 1] })].concat();
    shifts_by_more sint 8 * LANE..=64, |d, a, b, _, _| { let (x, y) = (a.is_negative(), b.is_negative());
        [x.shift_elements_left::<3>(y), x.shift_elements_right::<3>(y), x.shift_elements_left::<8>(y), x.shift_elements_right::<8>(y)] }
        => |m| { let (l, r) = ([&m.ma[..], &m.mb].concat(), [&m.mb[..], &m.ma].concat()); [m.mask(|i| l[i + 3]), m.mask(|i| r[m.n + i - 3]), m.mask(|i| l[i + 8]), m.mask(|i| r[m.n + i - 8])].concat() };
    constant_ranges int 0..=64, |d, a, _, _, _| [a.within(T::of::<5>()..=T::of::<100>()), a.within(T::of::<100>()..=T::of::<5>()), a.within(T::MIN..=T::MAX), a.within(T::MAX..=T::MIN), a.within(T::of::<7>()..=T::of::<7>())]
        => |m| [m.mask(|i| (5..=100).contains(&m.a[i])), m.mask(|_| false), m.mask(|_| true), m.mask(|_| false), m.mask(|i| m.a[i] == 7)].concat();
    all_or_none all 0..=64, |d, a, b, _, io| { let (yes, from) = (io.n & 1 == 1, b.to_array()); [a.expand(yes), d.load_select(from.as_ref(), yes, a), d.load_select_or_default(from.as_ref(), yes), d.load_expand(from.as_ref(), yes)] }
        => |m| { let yes = m.io.n & 1 == 1; [m.each(|i| if yes { m.a[i] } else { 0 }), m.each(|i| if yes { m.b[i] } else { m.a[i] }), m.each(|i| if yes { m.b[i] } else { 0 }), m.each(|i| if yes { m.b[i] } else { 0 })].concat() };
}
mod up_to_64_lanes {
    use super::*;
    cases! {
        by_bits all 0..=64, |d, a, b, _, io| if d.lanes() > 64 { [a; 7] } else {
            let (from, mut to, mut scattered) = (b.to_array(), b.to_array(), b.to_array());
            let at = (a.cast_unsigned() ^ a.cast_unsigned()) + d.isa().iota(Lane::ZERO);
            a.store_select(to.as_mut(), io.n);
            a.scatter_select(scattered.as_mut(), io.n, at);
            [a.expand(io.n), d.load_expand(from.as_ref(), io.n), d.load_select(from.as_ref(), io.n, a), d.gather_select(from.as_ref(), io.n, at, a), d.from_array(to), d.from_array(scattered), a.partition(io.n)]
        } => |m| if m.n > 64 { m.a.repeat(7) } else {
            let expand = |v: &[i128]| m.each(|i| if bit(m, i) { v[(0..i).filter(|&j| bit(m, j)).count()] } else { 0 });
            let select = |yes: &[i128], no: &[i128]| m.each(|i| if bit(m, i) { yes[i] } else { no[i] });
            let order = (0..m.n).filter(|&i| bit(m, i)).chain((0..m.n).filter(|&i| !bit(m, i))).map(|i| m.a[i]).collect();
            [expand(&m.a), expand(&m.b), select(&m.b, &m.a), select(&m.b, &m.a), select(&m.a, &m.b), select(&m.a, &m.b), order].concat()
        };
        shift_in_bits sint 0..=64, |d, a, _, _, io| if d.lanes() > 64 { [a.is_negative(); 2] } else { [a.is_negative().shift_elements_right::<1>(io.n), a.is_negative().shift_elements_left::<1>(io.n)] }
            => |m| if m.n > 64 { [m.mask(|i| m.ma[i]), m.mask(|i| m.ma[i])].concat() } else {
                [m.mask(|i| if i > 0 { m.ma[i - 1] } else { bit(m, m.n - 1) }), m.mask(|i| if i + 1 < m.n { m.ma[i + 1] } else { bit(m, 0) })].concat() };
        push_low_bytes [u16 u32 u64] 0..=64, |d, a, b, _, io| { let mut room = [0; 1025]; let mut out = Output::overwrite(&mut room[..2 * size_of_val(&a.to_array()) + 1]); out.push_one(7);
            if d.lanes() * size_of::<T>().ilog2() as usize <= 64 { out.push(a.low_bytes(b)); out.push(b.low_bytes(io.n)); } out.filled().to_vec() }
            => |m| { let (size, mut all) = (m.t.size(), vec![7]); let bits = size.ilog2() as usize;
                if m.n * bits <= 64 {
                    for i in 0..m.n { all.extend((0..=m.b[i] as usize % size).map(|k| m.a[i] >> (8 * k) & 255)) }
                    for i in 0..m.n { all.extend((0..=(m.io.n >> (i * bits)) as usize % size).map(|k| m.b[i] >> (8 * k) & 255)) }
                }
                all };
    }
}
