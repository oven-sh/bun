use core::array::from_fn;

use crate::double::{
    FRACTION_BITS, FRACTION_MASK, IMPLICIT_BIT, MAX_BIASED_EXPONENT, SIGN_BIT, biased_exponent,
    with_sign,
};

const CHUNK_BITS: u32 = 32;
/// 64 for the exponents, one for the upper part of a term and three for carries.
const CHUNKS: usize = 68;
/// A term adds at most 2^52 to a chunk.
const TERMS_BETWEEN_CARRIES: u32 = (1 << 11) - 2;

/// The exact sum of up to 2^53 numbers, rounded once (Math.sumPrecise). After the small superaccumulator of Neal, "Fast
/// exact summation using small and large superaccumulators".
pub struct PreciseSum {
    /// Chunk `i` counts in units of `2^(32 * i - 1075)`.
    chunks: [i64; CHUNKS],
    /// Bit `i` is set if chunk `i` or `i + 1` has been added to.
    used: u64,
    terms_until_carry: u32,
    /// The bits that all terms have.
    common_bits: u64,
    /// The sum of the terms that are not finite.
    special: f64,
}

impl Default for PreciseSum {
    fn default() -> PreciseSum {
        PreciseSum {
            chunks: [0; CHUNKS],
            used: 0,
            terms_until_carry: TERMS_BETWEEN_CARRIES,
            common_bits: u64::MAX,
            special: 0.0,
        }
    }
}

impl PreciseSum {
    #[inline]
    pub fn add(&mut self, term: f64) {
        let bits = term.to_bits();
        self.common_bits &= bits;
        let (significand, exponent) = match biased_exponent(bits) {
            0 => (bits & FRACTION_MASK, 1),
            MAX_BIASED_EXPONENT => {
                core::hint::cold_path();
                self.special += term;
                return;
            }
            biased => (bits & FRACTION_MASK | IMPLICIT_BIT, biased),
        };
        let sign = bits as i64 >> 63;
        let signed = (significand as i64 ^ sign) - sign;
        let (index, shift) = (exponent / CHUNK_BITS, exponent % CHUNK_BITS);
        self.used |= 1 << index;
        self.chunks[index as usize] += i64::from((signed << shift) as u32);
        self.chunks[index as usize + 1] += signed >> (CHUNK_BITS - shift);
        self.terms_until_carry -= 1;
        if self.terms_until_carry == 0 {
            self.carry();
        }
    }

    pub fn add_all(&mut self, mut terms: &[f64]) {
        while !terms.is_empty() {
            let (block, rest) = terms.split_at(terms.len().min(BLOCK_LENGTH));
            if let Some((upper, lower)) = sum_of_block(block) {
                self.add(upper);
                self.add(lower);
                terms = rest;
            } else {
                // Terms that are far apart tend to come with more of the same.
                let (run, rest) = terms.split_at(terms.len().min(16 * BLOCK_LENGTH));
                self.add_each(run);
                terms = rest;
            }
        }
    }

    fn add_each(&mut self, terms: &[f64]) {
        terms.iter().for_each(|&term| self.add(term));
    }

    /// The same as adding all and taking the result.
    pub fn of(terms: &[f64]) -> f64 {
        let is_short = terms.len() <= BLOCK_LENGTH;
        if is_short && let Some((upper, lower)) = sum_of_block(terms) {
            return upper + lower;
        }
        let mut sum = PreciseSum::default();
        if is_short {
            sum.add_each(terms);
        } else {
            sum.add_all(terms);
        }
        sum.result()
    }

    #[cold]
    fn carry(&mut self) {
        let lowest = self.used.trailing_zeros() as usize;
        let mut carry = 0;
        for chunk in &mut self.chunks[lowest..CHUNKS - 1] {
            let sum = *chunk + carry;
            *chunk = i64::from(sum as i32);
            carry = (sum - *chunk) >> CHUNK_BITS;
        }
        self.chunks[CHUNKS - 1] += carry;
        self.used = u64::MAX << lowest;
        self.terms_until_carry = TERMS_BETWEEN_CARRIES;
    }

    pub fn result(&self) -> f64 {
        if self.special != 0.0 {
            return self.special;
        }
        let lowest = self.used.trailing_zeros() as usize;
        let end = CHUNKS - self.used.leading_zeros() as usize;
        let chunks = self.chunks.get(lowest..end).unwrap_or_default();
        let carry_over = |carry: i64, chunk: &i64| (chunk + carry) >> CHUNK_BITS;
        let sign = chunks.iter().fold(0, carry_over);

        // The last three digits of the magnitude so far, and whether any came before them.
        let (mut window, mut is_inexact) = (0u128, false);
        let (mut leading, mut top) = (0, 0);
        let mut carry = 0;
        for (index, &chunk) in chunks.iter().enumerate() {
            let sum = (chunk ^ sign) - sign + carry;
            carry = sum >> CHUNK_BITS;
            is_inexact |= window as u32 != 0;
            window = window >> CHUNK_BITS | u128::from(sum as u32) << (2 * CHUNK_BITS);
            if sum as u32 != 0 {
                (leading, top) = (window | u128::from(is_inexact), lowest + index);
            }
        }
        if leading == 0 {
            return with_sign(0.0, self.common_bits & SIGN_BIT != 0);
        }
        with_sign(round(leading, top as u32), sign < 0)
    }
}

const BLOCK_BITS: u32 = 8;
const BLOCK_LENGTH: usize = 1 << BLOCK_BITS;
const LANES: usize = 4;

/// Two numbers with the same sum as the terms, if these are finite, not all zero and within some 2^36 of each other.
/// Adding and subtracting a large power of two splits off the upper bits of a term without error, and parts that are
/// multiples of one unit add up without error: Rump, Ogita and Oishi, "Accurate floating-point summation".
fn sum_of_block(terms: &[f64]) -> Option<(f64, f64)> {
    const BITS_PER_PART: u32 = FRACTION_BITS - BLOCK_BITS;
    let (groups, rest) = terms.as_chunks::<LANES>();
    let last: [f64; LANES] = from_fn(|lane| rest.get(lane).copied().unwrap_or(0.0));
    let larger = |a: f64, b: f64| if a > b { a } else { b };

    let largest = groups.iter().fold(last.map(f64::abs), |largest, group| {
        from_fn(|lane| larger(group[lane].abs(), largest[lane]))
    });
    let largest = largest.into_iter().fold(0.0, larger);
    let upper_exponent = biased_exponent(largest.to_bits()) + 1 + BLOCK_BITS;
    if !(4 * BITS_PER_PART..MAX_BIASED_EXPONENT - 1).contains(&upper_exponent) {
        return None;
    }
    let power = |biased: u32| f64::from_bits(u64::from(biased) << FRACTION_BITS);
    let (upper_scale, lower_scale) = (power(upper_exponent), power(upper_exponent - BITS_PER_PART));

    let (mut upper, mut lower, mut left_over) = ([0.0; LANES], [0.0; LANES], [0; LANES]);
    let mut add = |group: &[f64; LANES]| {
        for lane in 0..LANES {
            let upper_part = (upper_scale + group[lane]) - upper_scale;
            let rest = group[lane] - upper_part;
            let lower_part = (lower_scale + rest) - lower_scale;
            upper[lane] += upper_part;
            lower[lane] += lower_part;
            left_over[lane] |= (rest - lower_part).to_bits();
        }
    };
    groups.iter().for_each(&mut add);
    add(&last);
    // A NaN leaves itself over.
    let left_over = left_over.into_iter().fold(0, |all, bits| all | bits);
    (left_over & !SIGN_BIT == 0).then(|| (upper.into_iter().sum(), lower.into_iter().sum()))
}

/// Of three digits, the highest of which is that of chunk `top` and not zero.
fn round(digits: u128, top: u32) -> f64 {
    let top_bit = digits.ilog2() + top * CHUNK_BITS - 2 * CHUNK_BITS;
    // Where the last place of the result is, and by the choice of units its biased exponent.
    let biased = top_bit.saturating_sub(FRACTION_BITS).max(1);
    if biased >= MAX_BIASED_EXPONENT {
        return f64::INFINITY;
    }
    let shift = biased + 2 * CHUNK_BITS - top * CHUNK_BITS;
    let just_below_half = (1 << (shift - 1)) - 1;
    let significand = (digits + just_below_half + (digits >> shift & 1)) >> shift;
    f64::from_bits((u64::from(biased - 1) << FRACTION_BITS) + significand as u64)
}
