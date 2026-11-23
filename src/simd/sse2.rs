//! Lookups and shuffles for x86 without `pshufb`.

use crate::arithmetic::known;
use crate::endian::ToBytes;
use crate::ops::Ops;
use crate::simd::prelude::*;

#[op]
fn hidden(v: u8x16) -> u8x16 {
    if cfg!(miri) { v } else { crate::Portable::new().hidden_16(v) }
}
#[inline(always)]
fn pairs_of(v: u8x16) -> u16x8 {
    u16x8::from_le_bytes(v)
}
#[inline(always)]
fn halves_of(v: u8x16) -> u64x2 {
    u64x2::from_le_bytes(v)
}
#[op]
fn zero_if_negative<S: crate::simd::Cpu>(v: u8x16, indices: u8x16) -> u8x16
where
    crate::simd::Here: crate::simd::In<S>,
{
    indices.cast::<i8, _>().is_negative().select(Simd::splat(0), v)
}

/// For constant indices, modulo `N`, and zero for the negative ones. LLVM is good at shuffles of 16-bit words: one for the even bytes
/// of the result, and one for the odd ones.
#[op]
fn shuffle<const N: usize, const WORDS: usize, S: crate::simd::Cpu>(table: Simd<u8, N>, indices: u8x16) -> u8x16
where
    u8: crate::simd::Fits<N>,
    u16: crate::simd::Fits<WORDS>,
    Simd<u16, WORDS>: ToBytes<Bytes = Simd<u8, N>>,
    crate::simd::Here: crate::simd::In<S>,
{
    let (pairs, iota) = (pairs_of(indices), u8x16::from_array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]));
    let (even, odd, none) = (pairs & Simd::<_, 8>::splat(255), pairs >> 8, indices.cast::<i8, _>().is_negative());
    let all = always!(|like: u8x16| (none
        | ((indices ^ like) & Simd::<_, 16>::splat((N - 1) as u8)).simd_eq(Simd::<_, 16>::splat(0)))
    .all());
    let extends = odd.simd_ge(Simd::<_, 8>::splat(128)).all() && all(Simd::<_, 16>::splat(indices[0]) + (iota >> 1));
    let zips = (even ^ odd) & Simd::<_, 8>::splat(0x8f) == Simd::<_, 8>::splat(0)
        && (indices ^ Simd::<_, 16>::splat(indices[0])) & Simd::<_, 16>::splat(8) == Simd::<_, 16>::splat(0);
    if N == 16 && pairs[0] & 0x8787 == 0 && all(u16x8::splat(pairs[0]).to_le_bytes() + (iota >> 1)) && !none.any() {
        let (lower, halves) = (table.resize::<16>(), halves_of(table.resize::<16>()));
        let from =
            always!(|at: u8| if at & 8 == 0 { lower } else { hidden(simd_swizzle!(halves, [1, 1]).to_le_bytes()) });
        return from(indices[0]).interleave(from(indices[1])).0;
    }
    if zips
        || extends
        || all(Simd::<_, 16>::splat(indices[0]) + iota)
        || all(Simd::<_, 16>::splat(indices[0]) + iota + iota)
    {
        // It has short ways to unpack, pack and shift.
        let mut v = u8x16::splat(0);
        unrolled!(
            16,
            for i in 0..16 {
                v[i] = if indices[i] < 128 { table[indices[i] as usize % N] } else { 0 };
            }
        );
        return v;
    }
    let whole = (even.simd_ge(Simd::<_, 8>::splat(128)) & odd.simd_ge(Simd::<_, 8>::splat(128))
        | (even + Simd::<_, 8>::splat(1)).simd_eq(odd)
            & (odd & Simd::<_, 8>::splat(0x81)).simd_eq(Simd::<_, 8>::splat(1)))
    .all();
    if N == 16
        && !whole
        && !(none | ((indices ^ iota) & Simd::<_, 16>::splat(8)).simd_eq(Simd::<_, 16>::splat(0))).all()
        && let Some(v) = by_distance(table.resize::<16>(), indices, iota)
    {
        return v;
    }
    let table = Simd::<u16, WORDS>::from_le_bytes(table);
    let words = always!(|at: u16x8, other: u16x8| {
        let mut v = u16x8::splat(0);
        unrolled!(
            8,
            for i in 0..8 {
                let at = if at[i] < 128 {
                    at[i]
                } else if other[i] < 128 {
                    other[i]
                } else {
                    2 * i as u16
                };
                v[i] = table[at as usize / 2 % WORDS];
            }
        );
        v
    });
    let only = always!(|at: u16x8, parity: u16, bits: u16| {
        (at & Simd::<_, 8>::splat(0x81))
            .simd_eq(Simd::<_, 8>::splat(parity))
            .select(Simd::<_, 8>::splat(bits), Simd::<_, 8>::splat(0))
    });
    if whole {
        return (words(even, odd) & only(even, 0, !0)).to_le_bytes();
    }
    // Or LLVM makes one shuffle of bytes of it all.
    let apart = always!(|v: u16x8| u16x8::from_le_bytes(hidden(v.to_le_bytes())));
    let (a, b) = (apart(words(even, odd)), apart(words(odd, even)));
    // All bits where a shift has cleared the others.
    (a & only(even, 0, 0x00ff) | a >> 8 & only(even, 1, !0) | (b << 8 & only(odd, 0, !0) | b & only(odd, 1, 0xff00)))
        .to_le_bytes()
}

/// A shift of the whole vector for each distance that bytes move by, if there are few.
#[op]
fn by_distance<S: crate::simd::Cpu>(v: u8x16, indices: u8x16, iota: u8x16) -> Option<u8x16>
where
    crate::simd::Here: crate::simd::In<S>,
{
    let (distances, mut all, mut count) = ((indices & Simd::splat(0x8f)) - iota, u8x16::splat(0), 0);
    let mut add = always!(|distance: i8, shifted: u8x16| {
        let these = distances.simd_eq(Simd::splat(distance as u8));
        all |= hidden(shifted) & these.to_simd().cast::<u8, _>();
        count += these.any() as u32;
    });
    macro_rules! by { ($($k:literal)*) => {$(
        add($k, v.shift_elements_left::<$k>());
        add(-$k, v.shift_elements_right::<$k>());
    )*}; }
    add(0, v);
    by!(1 2 3 4 5 6 7 8 9 10 11 12 13 14 15);
    (count <= 5).then_some(all)
}

/// From one entry to the next, less `slope`.
#[op]
fn rises<const N: usize, S: crate::simd::Cpu>(table: Simd<u8, N>, slope: u8) -> Simd<u8, N>
where
    u8: crate::simd::Fits<N>,
    crate::simd::Here: crate::simd::In<S>,
{
    let mut before = table.add(Simd::splat(slope)).shift_elements_right::<1>();
    before[0] = table[0];
    table.sub(before)
}
#[op]
fn steps<const N: usize, S: crate::simd::Cpu>(table: Simd<u8, N>, slope: u8) -> u32
where
    u8: crate::simd::Fits<N>,
    crate::simd::Here: crate::simd::In<S>,
{
    rises(table, slope).simd_ne(Simd::splat(0)).to_bitmask().count_ones()
}

/// A comparison for each entry of a constant that is neither equal to the one before it, nor the next number.
#[op]
fn by_steps<const N: usize, S: crate::simd::Cpu>(table: Simd<u8, N>, indices: u8x16) -> Option<u8x16>
where
    u8: crate::simd::Fits<N>,
    crate::simd::Here: crate::simd::In<S>,
{
    if !(crate::OPTIMIZED && are_known!(table) && known(steps(table, 0).min(steps(table, 1)) <= 12)) {
        return None;
    }
    let (slope, at) = ((steps(table, 1) < steps(table, 0)) as u8, indices & u8x16::splat((N - 1) as u8));
    let (rises, mut v) = (rises(table, slope), u8x16::splat(table[0]) + (at & u8x16::splat(slope.wrapping_neg())));
    unrolled!(64, for i in 1..const N {
        v += at.cast::<i8, _>().simd_gt(i8x16::splat(i as i8 - 1)).select(u8x16::splat(rises[i]), u8x16::zero());
    });
    Some(v)
}

/// Through memory and general registers.
#[op]
pub(crate) fn by_memory<const N: usize, S: crate::simd::Cpu>(table: &[u8; N], indices: u8x16) -> u8x16
where
    crate::simd::Here: crate::simd::In<S>,
{
    let [lower, upper] = u64x2::from_le_bytes(indices & Simd::splat((N - 1) as u8)).to_array();
    let half = always!(|at: u64| {
        macro_rules! bytes { ($($shift:literal)*) => { $((table[(at >> $shift) as usize % N] as u64) << $shift)|* }; }
        bytes!(0 8 16 24 32 40 48 56)
    });
    u64x2::from_array([half(lower), half(upper)]).to_le_bytes()
}

/// A choice for each bit of the index. Most of it depends on the table only, which stays the same in a loop.
#[op]
fn by_bits<S: crate::simd::Cpu>(table: u8x16, indices: u8x16) -> u8x16
where
    crate::simd::Here: crate::simd::In<S>,
{
    let has = always!(|bit| ((indices & Simd::splat(bit)).simd_eq(Simd::splat(bit)).to_simd()).cast::<u8, _>());
    let (one, two, four, eight) = (has(1), has(2), has(4), has(8));
    let either = always!(|second: u8x16, a: u8x16, b: u8x16| a ^ second & (a ^ b));
    let pair = always!(|i: usize| either(one, Simd::splat(table[i]), Simd::splat(table[i + 1])));
    let quad = always!(|i: usize| either(two, pair(i), pair(i + 2)));
    either(eight, either(four, quad(0), quad(4)), either(four, quad(8), quad(12)))
}

/// `pshufb`, where the indices are the data.
#[inline(always)]
pub(crate) fn table<S: crate::simd::Cpu>(table: u8x16, indices: u8x16) -> u8x16
where
    crate::simd::Here: crate::simd::In<S>,
{
    apart!({
        if crate::OPTIMIZED && are_known!(indices) {
            // LLVM would load each lane.
            return shuffle::<16, 8, _>(hidden(table), indices);
        }
        zero_if_negative(if let Some(v) = by_steps(table, indices) { v } else { by_bits(table, indices) }, indices)
    })
}

/// The same, where the table is the data.
#[inline(always)]
pub(crate) fn permute<S: crate::simd::Cpu>(v: u8x16, indices: u8x16) -> u8x16
where
    crate::simd::Here: crate::simd::In<S>,
{
    apart!({
        if are_known!(indices) || are_known!(v) {
            return table(v, indices);
        }
        zero_if_negative(by_memory(v.as_array(), indices), indices)
    })
}

/// Modulo `N`, which is 64 or less.
#[inline(always)]
pub(crate) fn bytes<const N: usize, const WORDS: usize, S: crate::simd::Cpu>(
    table: Simd<u8, N>,
    indices: u8x16,
) -> u8x16
where
    u8: crate::simd::Fits<N>,
    u16: crate::simd::Fits<WORDS>,
    Simd<u16, WORDS>: ToBytes<Bytes = Simd<u8, N>>,
    crate::simd::Here: crate::simd::In<S>,
{
    apart!({
        if crate::OPTIMIZED && are_known!(indices) {
            return shuffle::<N, WORDS, _>(table, indices & Simd::<_, 16>::splat(127));
        }
        if let Some(v) = by_steps(table, indices) { v } else { by_memory(table.as_array(), indices) }
    })
}

/// For lanes of 4 or 8 bytes.
#[op]
pub(crate) fn lanes<S: crate::simd::Cpu>(size: usize, table: u8x16, indices: u8x16) -> u8x16
where
    crate::simd::Here: crate::simd::In<S>,
{
    let (table, indices) = (u32x4::from_le_bytes(table), u32x4::from_le_bytes(indices));
    if size == 8 {
        let first = simd_swizzle!(indices, [0, 0, 2, 2]).simd_eq(Simd::splat(0));
        return first.select(simd_swizzle!(table, [0, 1, 0, 1]), simd_swizzle!(table, [2, 3, 2, 3])).to_le_bytes();
    }
    macro_rules! lane {
        ($i:literal) => {
            indices.simd_eq(Simd::splat($i)).select(simd_swizzle!(table, [$i; 4]), Simd::splat(0))
        };
    }
    (lane!(0) | lane!(1) | (lane!(2) | lane!(3))).to_le_bytes()
}

/// For each mask of `N` lanes and each distance: the lanes that come from so far above.
const fn arrivals<const N: usize, const MASKS: usize>() -> [[u8x16; N]; MASKS] {
    let (mut all, mut i) = ([[Simd::from_array([0; 16]); N]; MASKS], 0);
    while i < 16 * MASKS {
        let (mask, byte) = (i / 16, i % 16);
        let lane = byte * N / 16;
        if mask >> lane & 1 != 0 {
            let gaps = (!mask & ((1 << lane) - 1)).count_ones() as usize;
            all[mask][gaps].as_mut_array()[byte - gaps * 16 / N] = 255;
        }
        i += 1;
    }
    all
}
#[op]
pub(crate) fn compress32(v: u8x16, bits: u64) -> u8x16 {
    let [a, b, c, d] = const { &arrivals::<4, 16>() }[bits as usize & 15];
    v & a | v.rotate_elements_left::<4>() & b | (v.rotate_elements_left::<8>() & c | v.rotate_elements_left::<12>() & d)
}
#[op]
pub(crate) fn compress64(v: u8x16, bits: u64) -> u8x16 {
    let [a, b] = const { &arrivals::<2, 4>() }[bits as usize & 3];
    v & a | v.rotate_elements_left::<8>() & b
}

/// For each mask of eight lanes: those that stay, and then those that move down by one, by two and by four, from where they are by then.
const MOVES: &[[u64; 4]; 256] = &crate::Aligned(once!(
    [[u64; 4]; 256] = {
        let (mut all, mut mask) = ([[0; 4]; 256], 1usize);
        while mask < 256 {
            let (lane, mut step) = (mask.ilog2(), 0usize);
            let gaps = lane + 1 - mask.count_ones();
            all[mask] = all[mask ^ 1 << lane];
            while step < 4 {
                if step == 0 || gaps >> (step - 1) & 1 != 0 {
                    all[mask][step] |= 255 << (8 * (lane - gaps % (1 << step.saturating_sub(1))));
                }
                step += 1;
            }
            mask += 1;
        }
        all
    }
))
.0;
/// In the lower half, or in each.
#[op]
pub(crate) fn compress8<const BOTH: bool>(v: u8x16, bits: u64) -> u8x16 {
    let (lower, upper) = (MOVES[bits as u8 as usize], if BOTH { MOVES[(bits >> 8) as u8 as usize] } else { [0; 4] });
    let mask = always!(|i: usize| u64x2::from_array([lower[i], upper[i]]));
    let step = always!(|v: u64x2, these: u64x2, by: u64| v ^ v & these | (v & these) >> by);
    step(step(step(u64x2::from_le_bytes(v) & mask(0), mask(1), 8), mask(2), 16), mask(3), 32).to_le_bytes()
}
#[op]
pub(crate) fn compress16(v: u8x16, bits: u64) -> u8x16 {
    let [a, b, c, d] = MOVES[bits as u8 as usize];
    let (first, second) = (u64x2::from_array([a, b]).to_le_bytes(), u64x2::from_array([c, d]).to_le_bytes());
    let ((kept, one), (two, four)) = (first.interleave(first), second.interleave(second));
    macro_rules! step {
        ($v:expr, $these:ident, $by:literal) => {{
            let v = $v;
            v ^ v & $these | (v & $these).shift_elements_left::<$by>()
        }};
    }
    step!(step!(step!(v & kept, one, 2), two, 4), four, 8)
}
