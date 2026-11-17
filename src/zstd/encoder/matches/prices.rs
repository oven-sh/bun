//! What literals and matches are expected to cost, in 1/256 of a bit.

use bun_zstd_decoder::array::At;
use bun_zstd_decoder::format::{
    BLOCK_LEN_MAX, CodeKind, MAX_LITERAL_LENGTH_CODE, MAX_MATCH_LENGTH_CODE, MAX_OFFSET_CODE,
    MIN_MATCH,
};

use crate::bytes::highest_bit;
use crate::entropy::{Entropy, histogram};
use crate::sequences::{LengthCode, OffsetValue};

const ACCURACY_LOG: u32 = 8;
pub(super) const BIT: i32 = 1 << ACCURACY_LOG;
/// How many prices of match lengths are looked up at once.
pub(super) const LANES: usize = 8;
const SHORT_MATCHES: usize = 128;
const FEW_LITERALS: usize = 64;

/// The exponent of a float, and the first bits of what it multiplies. Counts are too low to get rounded.
#[inline(always)]
fn log2<const IS_ACCURATE: bool>(count: u32) -> i32 {
    const FRACTION_BITS: u32 = f32::MANTISSA_DIGITS - 1;
    let bits = ((count + 1) as i32 as f32).to_bits() as i32;
    if IS_ACCURATE {
        (bits - 0.5f32.to_bits() as i32) >> (FRACTION_BITS - ACCURACY_LOG)
    } else {
        (bits - 1f32.to_bits() as i32) >> FRACTION_BITS << ACCURACY_LOG
    }
}

/// Of the first `USED` of `N` symbols.
struct Frequencies<const USED: usize, const N: usize> {
    counts: [u32; N],
    logs: [i32; N],
    sum: u32,
    sum_log: i32,
}

impl<const USED: usize, const N: usize> Frequencies<USED, N> {
    const EMPTY: Self = Self {
        counts: [0; N],
        logs: [0; N],
        sum: 0,
        sum_log: 0,
    };

    fn set(&mut self, count: impl Fn(usize) -> u32) {
        for (symbol, out) in self.counts.iter_mut().enumerate().take(USED) {
            *out = count(symbol);
        }
        self.sum = self.counts.iter().sum();
    }

    /// From how many bits each symbol takes in a dictionary.
    fn set_from_bits(&mut self, scale_log: u32, bits: impl Fn(usize) -> u32) {
        self.set(|symbol| 1 << scale_log.saturating_sub(bits(symbol)));
    }

    fn scale_down(&mut self, target_log: u32) {
        let (counts, factor) = (self.counts, self.sum >> target_log);
        if factor > 1 {
            self.set(|symbol| 1 + (counts.at(symbol) >> highest_bit(factor)));
        }
    }

    fn update_logs<const IS_ACCURATE: bool>(&mut self) {
        for (log, &count) in self.logs.iter_mut().zip(&self.counts).take(USED) {
            *log = log2::<IS_ACCURATE>(count);
        }
    }

    #[inline(always)]
    fn add<const IS_ACCURATE: bool>(&mut self, symbol: usize, times: u32) {
        let count = self.counts.at_mut(symbol);
        *count += times;
        *self.logs.at_mut(symbol) = log2::<IS_ACCURATE>(*count);
        self.sum += times;
    }

    #[inline(always)]
    fn price(&self, symbol: usize) -> i32 {
        self.sum_log - self.logs.at(symbol)
    }
}

/// For all lengths with the same code as `len`.
#[inline(always)]
fn set_for_code(by_len: &mut [i32], len: u32, code: LengthCode, price: i32) {
    let first = (len >> code.bits() << code.bits()) as usize;
    let same_code = by_len.get_mut(first..first + (1 << code.bits()));
    same_code.unwrap_or_default().fill(price);
}

pub(super) struct Prices {
    literals: Frequencies<256, 256>,
    literal_lengths: Frequencies<{ MAX_LITERAL_LENGTH_CODE + 1 }, 64>,
    match_lengths: Frequencies<{ MAX_MATCH_LENGTH_CODE + 1 }, 64>,
    offsets: Frequencies<{ MAX_OFFSET_CODE + 1 }, 64>,
    /// By length less [`MIN_MATCH`], without what all have in common.
    short_matches: [i32; SHORT_MATCHES],
    /// By their number, likewise.
    few_literals: [i32; FEW_LITERALS],
}

impl Prices {
    pub(super) const EMPTY: Self = Self {
        literals: Frequencies::EMPTY,
        literal_lengths: Frequencies::EMPTY,
        match_lengths: Frequencies::EMPTY,
        offsets: Frequencies::EMPTY,
        short_matches: [0; _],
        few_literals: [0; _],
    };

    pub(super) fn is_empty(&self) -> bool {
        self.literal_lengths.sum == 0
    }

    pub(super) fn forget(&mut self) {
        self.literal_lengths.sum = 0;
    }

    /// There are no prices until they are [`derive`](Self::derive)d.
    pub(super) fn start_block(&mut self, block: &[u8], entropy: &Entropy) {
        if !self.is_empty() {
            self.literals.scale_down(12);
            self.literal_lengths.scale_down(11);
            self.match_lengths.scale_down(11);
            self.offsets.scale_down(11);
        } else if let Some(literals) = entropy.literals.complete() {
            let codes = &entropy.codes;
            self.literals.set_from_bits(11, |it| literals.code_len(it));
            self.literal_lengths
                .set_from_bits(10, |it| codes.max_bits(CodeKind::LiteralLength, it));
            self.match_lengths
                .set_from_bits(10, |it| codes.max_bits(CodeKind::MatchLength, it));
            self.offsets
                .set_from_bits(10, |it| codes.max_bits(CodeKind::Offset, it));
        } else {
            let mut counts = [0; 256];
            histogram::add(&mut counts, block);
            let counts = counts.map(|count| u32::from(count > 0) + (count >> 8));
            self.literals.set(|literal| *counts.at(literal));
            let starting_with = |first: &[u32], code: usize| first.get(code).copied().unwrap_or(1);
            self.literal_lengths
                .set(|code| starting_with(&[4, 2], code));
            self.match_lengths.set(|_| 1);
            self.offsets
                .set(|code| starting_with(&[6, 2, 1, 1, 2, 3, 4, 4, 4, 3, 2], code));
        }
    }

    #[inline(never)]
    pub(super) fn derive<const IS_ACCURATE: bool>(&mut self) {
        self.literals.update_logs::<IS_ACCURATE>();
        self.literal_lengths.update_logs::<IS_ACCURATE>();
        self.match_lengths.update_logs::<IS_ACCURATE>();
        self.offsets.update_logs::<IS_ACCURATE>();
        self.short_matches = core::array::from_fn(|base| self.match_base(base as u32));
        self.few_literals = core::array::from_fn(|len| self.literal_count(len as u32));
        self.update::<IS_ACCURATE>();
    }

    /// Takes the sequences into account that were added.
    #[inline(always)]
    pub(super) fn update<const IS_ACCURATE: bool>(&mut self) {
        self.literals.sum_log = log2::<IS_ACCURATE>(self.literals.sum);
        self.literal_lengths.sum_log = log2::<IS_ACCURATE>(self.literal_lengths.sum);
        self.match_lengths.sum_log = log2::<IS_ACCURATE>(self.match_lengths.sum);
        self.offsets.sum_log = log2::<IS_ACCURATE>(self.offsets.sum);
    }

    #[inline(always)]
    pub(super) fn add<const IS_ACCURATE: bool>(
        &mut self,
        literals: &[u8],
        offset: OffsetValue,
        match_len: u32,
    ) {
        for &literal in literals {
            // Twice, to adapt faster.
            self.literals.add::<IS_ACCURATE>(usize::from(literal), 2);
        }
        self.offsets.add::<IS_ACCURATE>(offset.code() as usize, 1);

        let len = literals.len() as u32;
        let code = LengthCode::of_literals(len);
        self.literal_lengths.add::<IS_ACCURATE>(code.code(), 1);
        let price = self.literal_count(len);
        set_for_code(&mut self.few_literals, len, code, price);

        let base = match_len - MIN_MATCH;
        let code = LengthCode::of_match(base);
        self.match_lengths.add::<IS_ACCURATE>(code.code(), 1);
        let price = self.match_base(base);
        set_for_code(&mut self.short_matches, base, code, price);
    }

    #[inline(always)]
    pub(super) fn literal(&self, literal: u8) -> i32 {
        self.literals.price(usize::from(literal)).max(BIT)
    }

    #[inline(always)]
    fn literal_count(&self, len: u32) -> i32 {
        // There is no code for a block of nothing but literals.
        let coded = len.min(BLOCK_LEN_MAX as u32 - 1);
        let code = LengthCode::of_literals(coded);
        (code.bits() + len - coded) as i32 * BIT - self.literal_lengths.logs.at(code.code())
    }

    #[inline(always)]
    pub(super) fn literal_len(&self, len: u32) -> i32 {
        self.literal_lengths.sum_log + self.literal_count(len)
    }

    /// By how much that goes up.
    #[inline(always)]
    pub(super) fn one_more_literal(&self, len: u32) -> i32 {
        match self.few_literals.get(len as usize..len as usize + 2) {
            Some(&[before, after]) => after - before,
            _ => self.literal_count(len + 1) - self.literal_count(len),
        }
    }

    /// What a match costs whatever its length.
    #[inline(always)]
    pub(super) fn offset<const IS_ACCURATE: bool>(&self, offset: OffsetValue) -> i32 {
        let code = offset.code() as i32;
        // Both make for faster decoding.
        let for_distance = if IS_ACCURATE {
            0
        } else {
            (code - 19).max(0) * 2 * BIT
        };
        let for_sequence = BIT / 5;
        let for_offset = code * BIT + self.offsets.price(code as usize);
        for_offset + for_distance + for_sequence + self.match_lengths.sum_log
    }

    #[inline(always)]
    fn match_base(&self, base: u32) -> i32 {
        let code = LengthCode::of_match(base);
        code.bits() as i32 * BIT - self.match_lengths.logs.at(code.code())
    }

    /// What it costs on top of that.
    #[inline(always)]
    pub(super) fn match_len(&self, len: u32) -> i32 {
        let base = len - MIN_MATCH;
        match self.short_matches.get(base as usize) {
            Some(&price) => price,
            None => self.match_base(base),
        }
    }

    /// [`match_len`](Self::match_len) from `len` on, if they are short.
    #[inline(always)]
    pub(super) fn short_match_lens(&self, len: u32) -> Option<&[i32; LANES]> {
        let base = (len - MIN_MATCH) as usize;
        self.short_matches.get(base..base + LANES)?.as_array()
    }
}
