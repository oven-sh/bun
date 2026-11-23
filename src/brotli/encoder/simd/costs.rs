use super::{Aligned, MAX_SYMBOLS};
use bun_simd::prelude::*;
use core::mem::MaybeUninit;

targets!(Upto<B32>);

const WORD: usize = 64;
/// The size of an entry, which has the logarithm of a number and the number. Offsets are in bytes.
const ENTRY: usize = 2 * size_of::<f64>();
const SHIFT: u32 = ENTRY.ilog2();
/// For the numbers that have no entry.
const SPARE: usize = 4 * WORD;

/// So long that an offset of 16 bits needs no check.
pub(crate) const LOGARITHM_BYTES: usize = (1 << u16::BITS) + ENTRY;
pub(crate) const MAX_LOGARITHMS: usize = (1 << u16::BITS) / ENTRY - SPARE;

pub(crate) type Logarithms = [u8; LOGARITHM_BYTES];

#[inline]
#[shared]
pub(crate) fn set_logarithm(table: &mut Logarithms, index: usize, number: u32, log: f64) {
    let entry = [log.to_le_bytes(), f64::from(number).to_le_bytes()];
    table[index * ENTRY..][..ENTRY].copy_from_slice(entry.as_flattened());
}

/// Hands out the unused entries of `table`, from index `next` on.
struct Spare<'a> {
    table: &'a mut Logarithms,
    next: u32,
}

impl Spare<'_> {
    #[inline]
    #[shared]
    fn offset_for(&mut self, number: u32) -> u32 {
        let log = f64::from(number).log2();
        set_logarithm(self.table, self.next as usize, number, log);
        self.next += 1;
        (self.next - 1) << SHIFT
    }
}

#[inline(never)]
fn add_entries(table: &mut Logarithms, known: u32, offsets: &mut [u32]) {
    let mut spare = Spare { table, next: known };
    for offset in offsets {
        if *offset >> SHIFT >= known {
            *offset = spare.offset_for(*offset >> SHIFT);
        }
    }
}

/// For counts, which can be too large for their offsets.
#[cold]
#[inline(never)]
fn add_entries_for(
    table: &mut Logarithms,
    known: u32,
    [common, others @ ..]: Rows<'_>,
    offsets: &mut [u16],
) {
    let mut spare = Spare { table, next: known };
    for (other, offsets) in others.iter().zip(offsets.as_chunks_mut::<WORD>().0) {
        let mut large = 0;
        for at in (0..WORD).step_by(16) {
            let sums = u32x16::<Baseline>::load_at(common, at) + Simd::load_at(*other, at);
            large |= sums.simd_ge(known).to_bitmask() << at;
        }
        while large != 0 {
            let at = large.trailing_zeros() as usize;
            offsets[at] = spare.offset_for(common[at].wrapping_add(other[at])) as u16;
            large &= large - 1;
        }
    }
}

type Rows<'a> = [&'a [u32; WORD]; 5];

#[cold]
#[inline(never)]
fn padded_from(start: usize, counts: &[&[u32]; 5]) -> [[u32; WORD]; 5] {
    counts.map(|counts| core::array::from_fn(|i| counts.get(start + i).copied().unwrap_or(0)))
}

/// Four histograms at a time, one in each lane: the sum for each has to be in the order of the symbols.
#[simd]
struct Logged {
    log: f64x4<S>,
    number: f64x4<S>,
}

#[simd]
fn look_up(table: &Logarithms, offsets: [u16; 4]) -> Logged<S> {
    let entry = |lane: usize| f64x2::load_bytes(&table[usize::from(offsets[lane])..]);
    let (a, b, c, d) = (entry(0), entry(1), entry(2), entry(3));
    let [log, number] = f64x4::from_halves([a, c])
        .in_blocks()
        .interleave(f64x4::from_halves([b, d]));
    Logged { log, number }
}

/// Returns the bits, and the offsets for the numbers of codes that extend a run of zeros. The `lengths` of the codes are negative for
/// symbols that a histogram does not have.
#[simd]
#[inline(never)] // The loop needs all registers.
fn sum_symbols<const HAS_RUNS: bool>(
    counts: &[&[u32]; 5],
    used: &[u64],
    table: &mut Logarithms,
    known: u32,
    log_total: f64x4<S>,
    lengths: &mut Output<'_, i32>,
) -> (f64x4<S>, u32x4<S>) {
    static NUMBERS: [f64; MAX_SYMBOLS + 1] = {
        let (mut numbers, mut i) = ([0.0; _], 0);
        while i < numbers.len() {
            numbers[i] = i as f64;
            i += 1;
        }
        numbers
    };
    let (mut bits, mut extensions) = (f64x4::zero(), f64x4::zero());
    let mut previous = f64x4::splat(-1.0);
    for (nth, mut word) in used.iter().copied().enumerate() {
        if word == 0 {
            continue;
        }
        let padded;
        let rows = if nth < counts[0].len() / WORD {
            let row = |i: usize| &counts[i].as_chunks().0[nth];
            [row(0), row(1), row(2), row(3), row(4)]
        } else {
            word &= (1 << (counts[0].len() % WORD)) - 1;
            padded = padded_from(nth * WORD, counts);
            padded.each_ref()
        };
        let [common, others @ ..] = rows;
        let mut offsets = Aligned([MaybeUninit::uninit(); 4 * WORD + 1]);
        let (mut offsets, mut any) = (Output::new(&mut offsets.0), u16x16::zero());
        offsets.streams::<4, _>(
            WORD,
            #[inline(always)]
            |lanes| {
                for at in (0..WORD).step_by(16) {
                    for (lane, other) in lanes.iter_mut().zip(others) {
                        let sum = |at| {
                            (u32x8::load_at(common, at) + u32x8::load_at(other, at)).cast_signed()
                        };
                        let sums = sum(at).saturating_narrow::<u16>(sum(at + 8));
                        lane.push(sums << SHIFT);
                        any |= sums;
                    }
                }
            },
        );
        // One more, for `trailing_zeros` of zero.
        offsets.push_one(0);
        let numbers = &NUMBERS[nth * WORD..][..WORD + 1];
        let offsets = offsets.into_filled();
        if any.simd_ge(known as u16).any() {
            add_entries_for(table, known, rows, offsets);
        }
        // With a room and a number of steps that have constant limits, no check is left in the loop.
        let count = word.count_ones();
        let lengths = &mut lengths.limit(4 * WORD);
        for _ in 0..count {
            let symbol = word.trailing_zeros() as usize;
            let at = |lane: usize| offsets[lane * WORD + symbol];
            let counts = look_up(table, [at(0), at(1), at(2), at(3)]);
            let cost = log_total - counts.log;
            if HAS_RUNS {
                let here = (cost + numbers[symbol]).simd_min_relaxed(numbers[symbol]);
                let gap = here - previous;
                previous = previous.simd_max_relaxed(here);
                let three_from = |zeros: f64| gap.simd_gt(zeros).select(3.0, 0.0);
                // Brotli adds 3 for each code. Adding 6 at once rounds the same way if `bits` is exact or above 4,
                // which it is with five symbols or more.
                bits += three_from(3.0) + three_from(10.0);
                extensions += three_from(10.0);
                if gap.simd_gt(66.0).any() {
                    core::hint::cold_path();
                    bits = bits + three_from(66.0) + three_from(514.0);
                    extensions += three_from(66.0) + three_from(514.0);
                }
            }
            bits += counts.number * cost;
            lengths.push((cost + 0.5).cast_relaxed::<i32>());
            word &= word.wrapping_sub(1);
        }
    }
    (
        bits,
        (extensions / (3.0 / ENTRY as f64))
            .cast_relaxed::<i32>()
            .cast_unsigned(),
    )
}

/// The bits for a prefix code and its symbols, for the sums of `common` and each of `others`. They have five symbols or more.
#[kernel]
#[inline(never)]
pub(crate) fn estimate_costs(
    common: &[u32],
    others: &[&[u32]; 4],
    // A bit for each symbol that any of them has.
    used: &[u64; MAX_SYMBOLS / WORD],
    totals: &[u32; 4],
    // Up to the last symbol: the zeros in runs of one or two, and the number of longer runs.
    gaps: &[[u32; 4]; 2],
    // For the numbers below `known`, with a million for zero.
    table: &mut Logarithms,
    known: u32,
) -> [f64; 4] {
    let size = common.len();
    assert!(known as usize <= MAX_LOGARITHMS);
    assert!(others.iter().all(|other| other.len() == size));

    let mut totals = (u32x4::from(totals) << SHIFT).to_array();
    add_entries(table, known, &mut totals);
    let log_total = look_up(table, totals.map(|offset| offset as u16)).log;

    let mut lengths = Aligned([MaybeUninit::uninit(); 4 * MAX_SYMBOLS + i8xN::<S>::LANES]);
    let mut lengths = Output::new(&mut lengths.0);
    let counts = [common, others[0], others[1], others[2], others[3]];
    let used = &used[..size.div_ceil(WORD)];
    let (bits, extensions) = match gaps[1] == [0; 4] {
        true => sum_symbols::<false, S>(&counts, used, table, known, log_total, &mut lengths),
        false => sum_symbols::<true, S>(&counts, used, table, known, log_total, &mut lengths),
    };
    let (lone_zeros, runs) = (u32x4::from(gaps[0]) << SHIFT, u32x4::from(gaps[1]) << SHIFT);
    // Up to a whole vector of bytes.
    lengths.push(&[-1; i8xN::<S>::LANES - 4]);

    let mut bytes = Aligned([MaybeUninit::uninit(); 4 * MAX_SYMBOLS]);
    let mut bytes = Output::new(&mut bytes.0);
    let mut longest = i8xN::splat(1);
    for from in lengths.into_filled().as_chunks::<{ i8xN::<S>::LANES }>().0 {
        let half = |nth: usize| {
            let quarter = |nth: usize| i32xN::load_at(from, nth * i32xN::LANES);
            (quarter(nth).in_blocks()).saturating_narrow::<i16>(quarter(nth + 1))
        };
        let packed = half(0).in_blocks().saturating_narrow::<i8>(half(2));
        longest = longest.simd_max(packed.simd_min(15));
        bytes.push(packed.simd_min(15));
    }
    let bytes = bytes.into_filled();
    let kinds = if longest.simd_gt(7).none() { 8 } else { 16 };

    // How often each length occurs, then the code for runs of zeros, and then the sum.
    let mut offsets = Aligned([MaybeUninit::uninit(); 4 * (16 + 2)]);
    let mut offsets = Output::new(&mut offsets.0);
    let (mut sum, mut more) = (runs + extensions, lone_zeros);
    for first in (0..kinds).step_by(8) {
        let mut seen = [i8xN::zero(); 8];
        for length in over(bytes).exact().0 {
            let length = length - first;
            for (i, seen) in seen.iter_mut().enumerate() {
                *seen -= length.simd_eq(i as i8).to_simd::<i8>();
            }
        }
        for seen in seen {
            let order = u8xN::repeat(&[0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15]);
            let by_lane = seen.in_blocks().lookup_bytes(order).cast_unsigned();
            let fours = by_lane.saturating_dot(ENTRY as i8).sum_groups::<i32>();
            let [lower, upper] = fours.cast_unsigned().resize::<B32>().split();
            let all = lower + upper + core::mem::replace(&mut more, u32x4::zero());
            sum += all;
            offsets.push(all);
        }
    }
    offsets.push(runs + extensions);
    offsets.push(sum);
    let offsets = offsets.into_filled();
    if (sum | lone_zeros | runs).simd_ge(known << SHIFT).any() {
        add_entries(table, known, offsets);
    }

    let offsets = offsets.as_chunks().0;
    let look_up = |offsets: [u32; 4]| look_up(table, offsets.map(|offset| offset as u16));
    let (mut entropy, mut codes) = (f64x4::zero(), look_up(offsets[0]));
    for &next in &offsets[1..] {
        entropy -= codes.number * codes.log;
        codes = look_up(next);
    }

    longest = longest.simd_max(longest.bitcast::<i32>().reverse().bitcast());
    longest = longest.simd_max(
        longest
            .bitcast::<i32>()
            .swizzle_groups([2, 3, 0, 1])
            .bitcast(),
    );
    longest = longest.simd_max(longest.bitcast::<i32>().swap_pairs().bitcast());
    let header = ((longest.resize::<B4>().cast::<i32>() << 1) + 18).cast::<f64>();
    let code_bits = (entropy + codes.number * codes.log).simd_max_relaxed(codes.number);
    (bits + header + code_bits).to_array()
}
