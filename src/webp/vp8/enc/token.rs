//! `token_enc.c`: the bits of the coefficients, kept until the probabilities to code them with are known.

use super::bit_writer::BitWriter;
use super::dsp::{Coeffs, num_levels_block};
use super::tables::{CAT3, CAT4, CAT5, CAT6, ENC_BANDS, NUM_BANDS, NUM_CTX, NUM_PROBAS};
use crate::util::{Checked, SliceExt};
use bun_alloc::AllocError;

/// Bit 15: the bit to code. Bits 0 to 13: its probability if bit 14 (`FIXED_PROBA_BIT`) is set, else the index of it.
type Token = u16;

const FIXED_PROBA_BIT: u16 = 1 << 14;

/// One for "any coefficient?", then for each 6 for its range, 11 for its place in it, the sign, and "is it the last?".
const MAX_TOKENS_PER_BLOCK: usize = 1 + 16 * (6 + 11 + 1 + 1);

#[derive(Default)]
pub(super) struct TokenBuffer {
    tokens: Vec<Token>,
}

fn token_id(coeff_type: usize, band: usize, ctx: usize) -> usize {
    NUM_PROBAS * (ctx + NUM_CTX * (band + NUM_BANDS * coeff_type))
}

/// Counts one more use of a probability, for `bit`.
#[inline(always)]
fn record_stats(bit: bool, stats: &mut u32) {
    let mut p = *stats;
    // Halve both counts when the one in the high bits is about to overflow.
    if p >= 0xfffe_0000 {
        p = ((p + 1) >> 1) & 0x7fff_7fff;
    }
    *stats = p + 0x0001_0000 + u32::from(bit);
}

/// The tokens of one block.
struct BlockTokens<'a> {
    tokens: &'a mut Vec<Token>,
    /// All the statistics, in the order of the probabilities.
    stats: &'a mut [u32],
    /// The index of the first probability of the current band and context.
    base_id: usize,
}

impl BlockTokens<'_> {
    #[inline(always)]
    fn add_token_with_stats(&mut self, bit: bool, proba: usize, stats: usize) -> Checked<bool> {
        self.tokens
            .push((u16::from(bit) << 15) | (self.base_id + proba) as u16);
        record_stats(bit, self.stats.at_mut(self.base_id + stats)?);
        Ok(bit)
    }

    #[inline(always)]
    fn add_token(&mut self, bit: bool, proba: usize) -> Checked<bool> {
        self.add_token_with_stats(bit, proba, proba)
    }

    #[inline(always)]
    fn add_constant_token(&mut self, bit: bool, proba: u8) {
        self.tokens
            .push((u16::from(bit) << 15) | FIXED_PROBA_BIT | u16::from(proba));
    }
}

impl TokenBuffer {
    pub(super) fn clear(&mut self) {
        self.tokens.clear();
    }

    pub(super) fn len(&self) -> usize {
        self.tokens.len()
    }

    /// Makes room for the tokens of `blocks` more blocks.
    pub(super) fn reserve(&mut self, blocks: usize) -> Result<(), AllocError> {
        self.tokens
            .try_reserve(blocks * MAX_TOKENS_PER_BLOCK)
            .map_err(|_| AllocError)
    }

    /// Records the coefficients of a block from `first` on, for which `reserve` made room. Returns whether there are any.
    pub(super) fn record_coeff_tokens(
        &mut self,
        ctx: u8,
        coeff_type: usize,
        first: usize,
        coeffs: &Coeffs,
        stats: &mut [u32],
    ) -> Checked<bool> {
        // `first` is 0 or 1, which are their own bands.
        let mut t = BlockTokens {
            tokens: &mut self.tokens,
            stats,
            base_id: token_id(coeff_type, first, usize::from(ctx)),
        };
        let num_levels = usize::from(num_levels_block(*coeffs));
        if !t.add_token(num_levels != 0, 0)? {
            return Ok(false);
        }

        let next_bands = ENC_BANDS.sub(first + 1..)?;
        let coeffs = coeffs.as_flattened().iter().enumerate().skip(first);
        for ((n, &c), &next_band) in coeffs.zip(next_bands) {
            let next_band = usize::from(next_band);
            let v = u32::from(c.unsigned_abs());
            if !t.add_token(v != 0, 1)? {
                t.base_id = token_id(coeff_type, next_band, 0);
                continue;
            }
            if !t.add_token(v > 1, 2)? {
                t.base_id = token_id(coeff_type, next_band, 1);
            } else {
                if !t.add_token(v > 4, 3)? {
                    if t.add_token(v != 2, 4)? {
                        t.add_token(v == 4, 5)?;
                    }
                } else if !t.add_token(v > 10, 6)? {
                    if !t.add_token(v > 6, 7)? {
                        t.add_constant_token(v == 6, 159);
                    } else {
                        t.add_constant_token(v >= 9, 165);
                        t.add_constant_token(v & 1 == 0, 145);
                    }
                } else {
                    let residue = v - 3;
                    // libwebp counts the use of probability 10 as one of probability 9.
                    let (residue, tab): (u32, &[u8]) = if residue < 8 << 1 {
                        t.add_token(false, 8)?;
                        t.add_token(false, 9)?;
                        (residue - 8, &CAT3)
                    } else if residue < 8 << 2 {
                        t.add_token(false, 8)?;
                        t.add_token(true, 9)?;
                        (residue - (8 << 1), &CAT4)
                    } else if residue < 8 << 3 {
                        t.add_token(true, 8)?;
                        t.add_token_with_stats(false, 10, 9)?;
                        (residue - (8 << 2), &CAT5)
                    } else {
                        t.add_token(true, 8)?;
                        t.add_token_with_stats(true, 10, 9)?;
                        (residue - (8 << 3), &CAT6)
                    };
                    for (shift, &proba) in (0..tab.len()).rev().zip(tab) {
                        t.add_constant_token((residue >> shift) & 1 != 0, proba);
                    }
                }
                t.base_id = token_id(coeff_type, next_band, 2);
            }
            t.add_constant_token(c < 0, 128);
            if n == 15 || !t.add_token(n + 1 < num_levels, 0)? {
                return Ok(true);
            }
        }
        Ok(true)
    }

    /// Codes the tokens, with `probas` for those that have an index.
    pub(super) fn emit_tokens(&self, bw: &mut BitWriter, probas: &[u8]) -> Checked {
        for &token in &self.tokens {
            let bit = token >> 15 != 0;
            let proba = if token & FIXED_PROBA_BIT != 0 {
                token as u8
            } else {
                probas.at(usize::from(token & 0x3fff))?
            };
            bw.put_bit(bit, proba);
        }
        Ok(())
    }
}
