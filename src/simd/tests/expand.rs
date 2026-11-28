//! Values that go where bits are set, and bits in memory.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::*;
use framework::*;

fn spread(m: &Model, from: &[i128], keep: impl Fn(usize) -> bool, or: impl Fn(usize) -> i128) -> Lanes {
    let mut next = from.iter();
    m.each(|i| if keep(i) { next.next().copied().unwrap_or(0) } else { or(i) })
}
fn bit(bits: u64, i: usize) -> bool {
    bits >> i & 1 == 1
}
/// Of all densities.
fn word(io: &Io) -> u64 {
    let all = io.slice::<u64>();
    match io.n % 4 {
        0 => all[0],
        1 => all[0] & all[1],
        2 => all[0] | all[1],
        _ => all[0] ^ io.n,
    }
}

cases! {
    by_mask sizes 0..=64, |d, a, b, c, io| { let (keep, from) = (b.cast_signed().is_negative(), io.slice::<T>()); let short = &from[..io.up_to(d.lanes() + 1)];
        [a.expand_or(keep, c), a.expand_or(keep, c[0]), d.load_expand_or(&from, keep, c), d.load_expand_or(short, keep, c), d.load_expand(&from[..d.lanes()], keep), d.load_expand(short, keep)] }
        => |m| { let (from, keep) = (m.slice(), |i: usize| m.mb[i]); let short = &from[..m.io.up_to(m.n + 1)];
            [spread(m, &m.a, keep, |i| m.c[i]), spread(m, &m.a, keep, |_| m.c[0]), spread(m, &from, keep, |i| m.c[i]), spread(m, short, keep, |i| m.c[i]), spread(m, &from, keep, |_| 0), spread(m, short, keep, |_| 0)].concat() };
    by_bits sizes 0..=64, |d, a, _, c, io| if d.lanes() > 64 { [a; 5] } else { let (keep, from) = (word(io), io.slice::<T>()); let short = &from[..io.up_to(d.lanes() + 1)];
        [a.expand_or(keep, c), a.expand(keep), d.load_expand_or(&from, keep, c), d.load_expand_or(short, keep, c), d.load_expand(&from[..d.lanes()], keep)] }
        => |m| if m.n > 64 { m.a.repeat(5) } else { let (from, bits) = (m.slice(), word(m.io)); let (keep, short) = (|i| bit(bits, i), &from[..m.io.up_to(m.n + 1)]);
            [spread(m, &m.a, keep, |i| m.c[i]), spread(m, &m.a, keep, |_| 0), spread(m, &from, keep, |i| m.c[i]), spread(m, short, keep, |i| m.c[i]), spread(m, &from, keep, |_| 0)].concat() };
    bits_in_memory sizes 0..=64, |d, a, b, c, io| { let (from, mut to) = (io.slice::<u8>(), [0xa5; 66]);
        let loaded = d.isa().mask_load_bitmask::<<T as bun_simd::Lane>::Signed, W>(&from[1..]);
        a.cast_signed().is_negative().store_bitmask(&mut to[1..]);
        (loaded.select(b, c), (loaded.count(), to.to_vec())) }
        => |m| { let from = m.io.slice::<u8>(); let keep = |i: usize| from[1 + i / 8] >> (i % 8) & 1 == 1;
            let byte = |k: usize| if k > 0 && 8 * (k - 1) < m.n { (0..m.n.min(8)).map(|i| (m.ma[8 * (k - 1) + i] as i128) << i).sum() } else { 0xa5 };
            [m.each(|i| if keep(i) { m.b[i] } else { m.c[i] }), vec![(0..m.n).filter(|&i| keep(i)).count() as i128], (0..66).map(byte).collect()].concat() };
    positions uint 16..=16, |d, a, _, _, io| { let mut to = [T::ZERO; 64]; let n = d.isa().set_bit_positions(word(io), a[0], &mut to); to[..n].to_vec() }
        => |m| (0..64).filter(|&i| bit(word(m.io), i)).map(|i| m.a[0] + i as i128).collect();
}
