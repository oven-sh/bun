//! Estimates of how many bits it takes to code symbols that occur so and so often.

use crate::array::At;

/// A number of bits, times `ONE_BIT`.
pub(super) type Cost = u64;

const FRACTION_BITS: u32 = 23;
pub(super) const ONE_BIT: Cost = 1 << FRACTION_BITS;

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/lossless_common.h#L77
const APPROXIMATE_FROM: usize = 256;
const CORRECTED_FROM: u32 = 4096;
const EXACT_FROM: u32 = 65536;
const ONE_BY_LN_2: f64 = ONE_BIT as f64 * core::f64::consts::LOG2_E;

/// `factor * log2(x)`, rounded.
const fn scaled_log2(x: u32, factor: u32) -> Cost {
    const DIGITS: u32 = 56;
    const ONE: u128 = 1 << 62;
    let mut log2 = x.ilog2() as u128;
    let mut mantissa = (x as u128 * ONE) >> log2;
    let mut digit = 0;
    while digit < DIGITS {
        // Squaring doubles the logarithm, which moves the next digit in front of the point.
        mantissa = mantissa * mantissa / ONE;
        let is_set = mantissa >= 2 * ONE;
        log2 = log2 << 1 | is_set as u128;
        mantissa >>= is_set as u32;
        digit += 1;
    }
    let shift = DIGITS - FRACTION_BITS;
    ((log2 * factor as u128 + (1 << (shift - 1))) >> shift) as Cost
}

#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static LOG2: [u32; APPROXIMATE_FROM] = {
    let (mut table, mut x) = ([0; _], 1);
    while x < table.len() {
        table[x] = scaled_log2(x as u32, 1) as u32;
        x += 1;
    }
    table
};

#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static X_LOG2: [Cost; 4096] = {
    let (mut table, mut x) = ([0; _], 1);
    while x < table.len() {
        table[x] = if x < APPROXIMATE_FROM {
            scaled_log2(x as u32, x as u32)
        } else {
            approximate_x_log2(x as u32)
        };
        x += 1;
    }
    table
};

/// The logarithm of the 8 highest bits of `x`, which has more, and what to correct `x` times that by.
#[expect(clippy::indexing_slicing, reason = "any `u8` is in range")]
#[inline(always)]
const fn log2_of_high_bits(x: u32) -> (u32, Cost) {
    let shift = (x | APPROXIMATE_FROM as u32).ilog2() - 7;
    let log2 = LOG2[(x >> shift) as u8 as usize] + (shift << FRACTION_BITS);
    let low_bits = x & ((1 << shift) - 1);
    (log2, ONE_BY_LN_2 as Cost * low_bits as Cost)
}

#[inline(always)]
const fn approximate_x_log2(x: u32) -> Cost {
    let (log2, correction) = log2_of_high_bits(x);
    x as Cost * log2 as Cost + correction
}

// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/lossless_enc.c#L284
pub(super) fn log2(x: u32) -> u32 {
    if let Some(&log2) = LOG2.get(x as usize) {
        return log2;
    }
    if x >= EXACT_FROM {
        return (ONE_BY_LN_2 * f64::from(x).ln() + 0.5) as u32;
    }
    let (log2, correction) = log2_of_high_bits(x);
    if x < CORRECTED_FROM {
        return log2;
    }
    log2 + div_round(correction, x.into()) as u32
}

/// `x * log2(x)`
// https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/dsp/lossless_enc.c#L252
#[inline(always)]
pub(super) fn x_log2(x: u32) -> Cost {
    if let Some(&x_log2) = X_LOG2.get(x as usize) {
        return x_log2;
    }
    if x >= EXACT_FROM {
        return exact_x_log2(x);
    }
    approximate_x_log2(x)
}

#[inline(never)]
fn exact_x_log2(x: u32) -> Cost {
    let x = f64::from(x);
    (ONE_BY_LN_2 * x * x.ln() + 0.5) as Cost
}

#[inline(always)]
pub(super) const fn div_round(dividend: u64, divisor: u64) -> u64 {
    (dividend + divisor / 2) / divisor
}

/// Bit `i` is set if `counts[i]` is not zero.
// 16 at a time is what gets compiled to vector instructions, unless inlining gets in the way.
#[inline(never)]
pub(super) fn non_zero<T: Copy + Default + Eq>(counts: &[T; 64]) -> u64 {
    let (sixteens, _) = counts.as_chunks::<16>();
    sixteens.iter().rfold(0, |mask, sixteen| {
        let mut bits = 0u16;
        for (i, &count) in sixteen.iter().enumerate() {
            bits |= u16::from(count != T::default()) << i;
        }
        mask << 16 | u64::from(bits)
    })
}

/// The indices of the bits that are set.
#[inline(always)]
pub(super) fn set_bits(mut mask: u64) -> impl Iterator<Item = usize> {
    core::iter::from_fn(move || {
        let index = mask.lowest_one()?;
        mask &= mask - 1;
        Some(index as usize)
    })
}

/// About what 64 counts of one histogram and those of another add up to.
pub(super) struct Sums {
    /// Which are the same as the one before.
    pub(super) repeats: u64,
    pub(super) x_log2_sum: Cost,
    max: u32,
}

/// `a` and `b` have one more count on either side. Returns which of the sums are the same as the one before.
// Like `non_zero()`.
#[inline(never)]
fn add_up(a: &[u32; 66], b: &[u32; 66], sums: &mut [u32; 64]) -> u64 {
    let ([a_before @ .., _, _], [b_before @ .., _, _]) = (a, b);
    let ([_, a @ .., _], [_, b @ .., _]) = (a, b);
    *sums = core::array::from_fn(|i| a.at(i) + b.at(i));
    let before = a_before.as_chunks::<16>().0.iter();
    let before = before.zip(b_before.as_chunks::<16>().0);
    let sixteens = sums.as_chunks::<16>().0.iter().zip(before);
    sixteens.rfold(0, |repeats, (sums, (a, b))| {
        let mut bits = 0u16;
        for (i, (&sum, (a, b))) in sums.iter().zip(a.iter().zip(b)).enumerate() {
            bits |= u16::from(sum == a + b) << i;
        }
        repeats << 16 | u64::from(bits)
    })
}

impl Sums {
    #[inline(always)]
    pub(super) fn new(a: &[u32; 66], b: &[u32; 66]) -> Self {
        let mut sums = [0; 64];
        let repeats = add_up(a, b, &mut sums);
        let max = sums.iter().fold(0, |max, &sum| max.max(sum));
        let x_log2_sum = if max < X_LOG2.len() as u32 {
            let pairs = sums.as_chunks::<2>().0.iter();
            let look_up = |sum: u32| *X_LOG2.at(sum as usize);
            let (a, b) = pairs.fold((0, 0), |(a, b), &[x, y]| (a + look_up(x), b + look_up(y)));
            a + b
        } else {
            sums.iter().map(|&sum| x_log2(sum)).sum()
        };
        Self {
            repeats,
            x_log2_sum,
            max,
        }
    }
}

/// Of the counts that are not zero.
#[derive(Clone, Copy, Default)]
pub(super) struct Population {
    pub(super) symbols: u32,
    pub(super) sum: u32,
    max: u32,
    x_log2_sum: Cost,
}

impl Population {
    #[inline(always)]
    fn add(&mut self, count: u32) {
        self.sum += count;
        self.max = self.max.max(count);
        self.x_log2_sum += x_log2(count);
    }

    /// As if they had no symbol in common.
    pub(super) fn with(&self, other: &Self) -> Self {
        Self {
            symbols: self.symbols + other.symbols,
            sum: self.sum + other.sum,
            max: self.max.max(other.max),
            x_log2_sum: self.x_log2_sum + other.x_log2_sum,
        }
    }

    /// Makes one symbol of two.
    #[inline(always)]
    pub(super) fn join(&mut self, a: u32, b: u32) {
        self.max = self.max.max(a + b);
        let [sum, a, b] = if a + b < X_LOG2.len() as u32 {
            [a + b, a, b].map(|x| *X_LOG2.at(x as usize))
        } else {
            [a + b, a, b].map(x_log2)
        };
        self.x_log2_sum = self.x_log2_sum + sum - a - b;
    }

    /// Puts `sums` in the place of the counts that were added up, given their `x_log2()`.
    #[inline(always)]
    pub(super) fn join_all(&mut self, sums: &Sums, apart: Cost) {
        self.max = self.max.max(sums.max);
        self.x_log2_sum = self.x_log2_sum + sums.x_log2_sum - apart;
    }

    fn entropy(&self) -> Cost {
        x_log2(self.sum).saturating_sub(self.x_log2_sum)
    }

    /// What the `cost()` of the sum of two histograms is at least, is the sum of these, as mixing adds to the entropy.
    pub(super) fn least_cost(&self) -> Cost {
        // `x_log2()` is up to one and a half bits too low where it is approximate, and rounded everywhere.
        let approximate = Cost::from(self.symbols.min(self.sum / APPROXIMATE_FROM as u32));
        let error = 3 * approximate * ONE_BIT / 2 + 8 * ONE_BIT;
        self.entropy().saturating_sub(error)
    }

    /// The entropy, or more where a prefix code cannot get near it.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L246
    #[inline(always)]
    pub(super) fn cost(&self) -> Cost {
        if self.symbols <= 1 {
            return 0;
        }
        let entropy = self.entropy();
        let sum = Cost::from(self.sum);
        let mix = match self.symbols {
            2 => return div_round(99 * sum * ONE_BIT + entropy, 100),
            3 => 950,
            4 => 700,
            _ => 627,
        };
        let limit = (2 * sum - Cost::from(self.max)) * ONE_BIT;
        entropy.max(div_round(mix * limit + (1000 - mix) * entropy, 1000))
    }
}

/// Without the cost of storing the code.
pub(super) fn symbols_cost(counts: &[u32; 256]) -> Cost {
    let mut population = Population::default();
    for block in counts.as_chunks::<64>().0 {
        let non_zero = non_zero(block);
        population.symbols += non_zero.count_ones();
        set_bits(non_zero).for_each(|i| population.add(*block.at(i)));
    }
    population.cost()
}

/// A bit for each of 64 symbols.
#[derive(Clone, Copy, Default)]
pub(super) struct Block {
    pub(super) non_zero: u64,
    /// Whether it has the same count as the one before.
    pub(super) repeats: u64,
}

impl Block {
    /// What it adds to the cost of storing the code, in 1024ths of a bit, less what as many isolated zeros would. `before`
    /// is what repeats in the block before.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L299
    #[inline(always)]
    pub(super) fn code_cost(self, before: u64) -> i32 {
        let Self { non_zero, repeats } = self;
        // Runs of more than 3 are cheap.
        let late = repeats & (repeats << 1 | before >> 63) & (repeats << 2 | before >> 62);
        let fourth = late & !(late << 1 | u64::from(before >> 61 == 0b111));
        let runs = |of: u64, run: i32, saved: i32| {
            let [runs, late] = [fourth & of, late & of].map(|it| it.count_ones() as i32);
            runs * run - (3 * runs + late) * saved
        };
        (3360 - ISOLATED_ZERO) * non_zero.count_ones() as i32
            + runs(!non_zero, 1600, ISOLATED_ZERO - 240)
            + runs(non_zero, 2640, 3360 - 720)
    }
}

const ISOLATED_ZERO: i32 = 1840;
const CODE_LENGTH_CODE: Cost = 57 * ONE_BIT - div_round(91 * ONE_BIT, 10);

/// If each of the `stretches` without a zero, of which there is at least one, and each gap between them was a long run.
pub(super) const fn least_code_cost(alphabet_len: usize, symbols: u32, stretches: u32) -> Cost {
    let lengths = 240 * alphabet_len as Cost + (720 - 240) * symbols as Cost;
    let runs = (2640 + 1600) * stretches as Cost - 1600;
    CODE_LENGTH_CODE + (lengths + runs) * (ONE_BIT / 1024)
}

/// The symbols of a block that can repeat the one before, if it starts at `start` in an alphabet.
#[inline(always)]
pub(super) fn can_repeat(start: usize, alphabet_len: usize) -> u64 {
    !u64::MAX.unbounded_shl((alphabet_len - start) as u32) & !u64::from(start == 0)
}

/// What it takes to tell what the symbols of an alphabet and their code cost.
#[derive(Default)]
pub(super) struct Estimate {
    pub(super) population: Population,
    /// Of all blocks.
    pub(super) code_cost: i32,
}

impl Estimate {
    /// `blocks` has, for 64 symbols at a time, which of them occur and how often each does.
    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/enc/histogram_enc.c#L319
    #[inline(always)]
    pub(super) fn new(
        alphabet_len: usize,
        blocks: impl Iterator<Item = (u64, impl Fn(usize) -> u32)>,
    ) -> Self {
        let mut estimate = Self::default();
        let (mut last_count, mut before) = (0, Block::default());
        for (start, (non_zero, count)) in (0..).step_by(64).zip(blocks) {
            let mut repeats = 0u64;
            for i in set_bits(non_zero) {
                let count = count(i);
                repeats |= u64::from(count == last_count) << i;
                last_count = count;
                estimate.population.add(count);
            }
            let follows_non_zero = non_zero << 1 | before.non_zero >> 63;
            let repeats = repeats & follows_non_zero | !(non_zero | follows_non_zero);
            let block = Block {
                non_zero,
                repeats: repeats & can_repeat(start, alphabet_len),
            };
            estimate.code_cost += block.code_cost(before.repeats);
            estimate.population.symbols += non_zero.count_ones();
            before = block;
        }
        estimate
    }

    #[inline(always)]
    pub(super) fn cost(&self, alphabet_len: usize) -> Cost {
        let code_cost = ISOLATED_ZERO * alphabet_len as i32 + self.code_cost;
        self.population.cost() + CODE_LENGTH_CODE + code_cost as Cost * (ONE_BIT / 1024)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn logarithms_are_those_of_floating_point() {
        for x in (1..APPROXIMATE_FROM as u32).chain(EXACT_FROM..EXACT_FROM + 8) {
            let expected =
                |factor| (f64::from(factor) * f64::from(x).log2() * ONE_BIT as f64).round();
            assert_eq!(scaled_log2(x, 1) as f64, expected(1));
            assert_eq!(f64::from(log2(x)), expected(1));
            assert_eq!(x_log2(x) as f64, expected(x));
        }
    }
}
