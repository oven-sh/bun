//! `zstd_opt.c`: the `btopt`, `btultra` and `btultra2` strategies, which look for the cheapest parse.

use core::hint::cold_path;
use core::mem;

use super::hist;
use super::huf::HufRepeat;
use super::internal::{
    BlockSrc, Common, Descent, DictMatchState, DictMode, DictTree, EntropyCTables, Hasher, Match,
    MatchState, Near, Nodes, OptState, ParamSwitch, Prefix, PriceTable, RawSeq, RawSeqStore,
    SeqStore, Strategy, TreeInput, ZSTD_OPT_NUM, bt_look_ahead, bt_nodes, bt_set_children, bt_walk,
    hash3_of, index_overlap_check, ll_code, ml_code, new_rep, offset_to_offbase, table_get,
    table_put,
};
use crate::common::{
    LL_BITS, MAX_LL, MAX_ML, MAX_OFF, MINMATCH, ML_BITS, ZSTD_BLOCKSIZE_MAX, ZSTD_REP_NUM,
};
use crate::error::Result;
use crate::util::{BUG, SliceExt, highbit32, read_le32};

/// How much a literal adds to its frequency, so that frequencies adapt fast to new statistics.
const ZSTD_LITFREQ_ADD: u32 = 2;
const ZSTD_MAX_PRICE: i32 = 1 << 30;
/// A first block of at most this size is priced by fixed rules, not by statistics.
const ZSTD_PREDEF_THRESHOLD: usize = 8;

const MAX_LIT: u32 = 255;

// ── prices ────────────────────────────────────────────────────────────────

/// Prices are in units of `1 / BITCOST_MULTIPLIER` of a bit.
const BITCOST_ACCURACY: u32 = 8;
const BITCOST_MULTIPLIER: u32 = 1 << BITCOST_ACCURACY;

/// `WEIGHT`: approximate for `btopt`, accurate for `btultra`.
#[inline(always)]
const fn weight(stat: u32, opt_level: i32) -> u32 {
    if opt_level != 0 {
        frac_weight(stat)
    } else {
        bit_weight(stat)
    }
}

/// `ZSTD_bitWeight`: the cost of a statistic, in whole bits.
#[inline(always)]
const fn bit_weight(stat: u32) -> u32 {
    highbit32(stat.wrapping_add(1)) * BITCOST_MULTIPLIER
}

/// `ZSTD_fracWeight`: the cost of a statistic, with a fraction of a bit that is interpolated linearly.
#[inline(always)]
const fn frac_weight(raw_stat: u32) -> u32 {
    let stat = raw_stat.wrapping_add(1);
    let hb = highbit32(stat);
    let b_weight = hb * BITCOST_MULTIPLIER;
    // From 1 to 2, in fixed point.
    let f_weight = (stat << BITCOST_ACCURACY) >> hb;
    b_weight.wrapping_add(f_weight)
}

/// `ZSTD_compressedLiterals`
#[inline(always)]
fn compressed_literals(opt_ptr: &OptState) -> bool {
    opt_ptr.literal_compression_mode != ParamSwitch::Disable
}

/// `sum_u32`
fn sum_u32(table: &[u32]) -> u32 {
    table.iter().fold(0, |total, &elt| total.wrapping_add(elt))
}

/// `base_directive_e`: the least a scaled down statistic can be.
#[derive(Clone, Copy, PartialEq, Eq)]
enum BaseDirective {
    /// 0, if it is 0 already.
    Base0Possible,
    Base1Guaranteed,
}

/// `ZSTD_downscaleStats`: returns the new sum of the elements.
fn downscale_stats(
    table: &mut [u32],
    last_elt_index: u32,
    shift: u32,
    base1: BaseDirective,
) -> Result<u32> {
    let mut sum = 0u32;
    for elt in table.sub_mut(..=last_elt_index as usize)? {
        let base = u32::from(base1 == BaseDirective::Base1Guaranteed || *elt > 0);
        let new_stat = base.wrapping_add(*elt >> (shift & 31));
        sum = sum.wrapping_add(new_stat);
        *elt = new_stat;
    }
    Ok(sum)
}

/// `ZSTD_scaleStats`: scales all the elements down if their sum is too large. Returns the sum that results.
fn scale_stats(table: &mut [u32], last_elt_index: u32, log_target: u32) -> Result<u32> {
    let prevsum = sum_u32(table.sub(..=last_elt_index as usize)?);
    let factor = prevsum >> log_target;
    if factor <= 1 {
        return Ok(prevsum);
    }
    downscale_stats(
        table,
        last_elt_index,
        highbit32(factor),
        BaseDirective::Base1Guaranteed,
    )
}

/// Frequencies, out of about `1 << scale_log`, that make each symbol cost the bits `bit_cost` tells. Returns their sum.
fn freqs_from_bit_costs(
    freqs: &mut [u32],
    last_elt_index: u32,
    scale_log: u32,
    bit_cost: impl Fn(u32) -> u32,
) -> Result<u32> {
    let mut sum = 0u32;
    for (symbol, freq) in (0u32..).zip(freqs.sub_mut(..=last_elt_index as usize)?) {
        let bit_cost = bit_cost(symbol);
        // At least 1, to have a cost. A code of a dictionary can have one bit more than `scale_log`: the C code then
        // shifts by -1, which x86-64 and aarch64 take for 31.
        *freq = if bit_cost != 0 {
            1 << (scale_log.wrapping_sub(bit_cost) & 31)
        } else {
            1
        };
        sum = sum.wrapping_add(*freq);
    }
    Ok(sum)
}

/// `ZSTD_rescaleFreqs`: for the first block, which no statistics tell, starts them from the tables of the dictionary
/// if there is one, else from the literals of `src` and from fixed values for the sequences. For the next ones, scales
/// down what the blocks before have accumulated.
fn rescale_freqs(opt_ptr: &mut OptState, symbol_costs: &EntropyCTables, src: &[u8]) -> Result<()> {
    #[rustfmt::skip]
    const BASE_LL_FREQS: [u32; MAX_LL as usize + 1] = [
        4, 2, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1,
    ];
    #[rustfmt::skip]
    const BASE_OFC_FREQS: [u32; MAX_OFF as usize + 1] = [
        6, 2, 1, 1, 2, 3, 4, 4,
        4, 3, 2, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
        1, 1, 1, 1, 1, 1, 1, 1,
    ];

    let compressed_literals = compressed_literals(opt_ptr);

    // `zop_predef`, the fixed prices for a first block of at most `ZSTD_PREDEF_THRESHOLD` bytes, are of no use: the last
    // 8 bytes of a block are not searched for matches.
    if opt_ptr.lit_length_sum == 0 {
        if symbol_costs.huf.repeat_mode == HufRepeat::Valid {
            // A Huffman table that has all the values is presumed to come from a dictionary.
            if compressed_literals {
                let huf = &symbol_costs.huf.c_table;
                opt_ptr.lit_sum =
                    freqs_from_bit_costs(&mut opt_ptr.lit_freq, MAX_LIT, 11, |lit| {
                        huf.get_nb_bits(lit)
                    })?;
            }
            let fse = &symbol_costs.fse;
            opt_ptr.lit_length_sum =
                freqs_from_bit_costs(&mut opt_ptr.lit_length_freq, MAX_LL, 10, |ll| {
                    fse.litlength_c_table.get_max_nb_bits(ll)
                })?;
            opt_ptr.match_length_sum =
                freqs_from_bit_costs(&mut opt_ptr.match_length_freq, MAX_ML, 10, |ml| {
                    fse.matchlength_c_table.get_max_nb_bits(ml)
                })?;
            opt_ptr.off_code_sum =
                freqs_from_bit_costs(&mut opt_ptr.off_code_freq, MAX_OFF, 10, |of| {
                    fse.offcode_c_table.get_max_nb_bits(of)
                })?;
        } else {
            if compressed_literals {
                let mut lit = MAX_LIT;
                hist::count_simple(&mut opt_ptr.lit_freq, &mut lit, src)?;
                opt_ptr.lit_sum = downscale_stats(
                    &mut opt_ptr.lit_freq,
                    MAX_LIT,
                    8,
                    BaseDirective::Base0Possible,
                )?;
            }

            opt_ptr.lit_length_freq.write_at(0, &BASE_LL_FREQS)?;
            opt_ptr.lit_length_sum = sum_u32(&BASE_LL_FREQS);

            opt_ptr
                .match_length_freq
                .sub_mut(..=MAX_ML as usize)?
                .fill(1);
            opt_ptr.match_length_sum = MAX_ML + 1;

            opt_ptr.off_code_freq.write_at(0, &BASE_OFC_FREQS)?;
            opt_ptr.off_code_sum = sum_u32(&BASE_OFC_FREQS);
        }
    } else {
        if compressed_literals {
            opt_ptr.lit_sum = scale_stats(&mut opt_ptr.lit_freq, MAX_LIT, 12)?;
        }
        opt_ptr.lit_length_sum = scale_stats(&mut opt_ptr.lit_length_freq, MAX_LL, 11)?;
        opt_ptr.match_length_sum = scale_stats(&mut opt_ptr.match_length_freq, MAX_ML, 11)?;
        opt_ptr.off_code_sum = scale_stats(&mut opt_ptr.off_code_freq, MAX_OFF, 11)?;
    }

    Ok(())
}

/// The least length, minus [`MINMATCH`], that each code of match length stands for, and what follows the last one.
#[rustfmt::skip]
const ML_CODE_START: [u32; MAX_ML as usize + 2] = [
     0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
    16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
    32, 34, 36, 38, 40, 44, 48, 56, 64, 80, 96,
    1 << 7, 1 << 8, 1 << 9, 1 << 10, 1 << 11, 1 << 12, 1 << 13, 1 << 14, 1 << 15, 1 << 16, 1 << 17,
];

/// The same for the codes of literal length.
#[rustfmt::skip]
const LL_CODE_START: [u32; MAX_LL as usize + 2] = [
     0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
    16, 18, 20, 22, 24, 28, 32, 40, 48,
    1 << 6, 1 << 7, 1 << 8, 1 << 9, 1 << 10, 1 << 11, 1 << 12, 1 << 13, 1 << 14, 1 << 15, 1 << 16, 1 << 17,
];

/// The lengths of literals below this have their `LL_INCPRICE` in a table.
const LL_INC_LENGTHS: usize = 64;

/// The statistics, and the prices that they give to the symbols. A price is only worked out when the frequency of its
/// symbol changes. What depends on the sum of the frequencies, which changes more often, is kept apart.
struct Prices<'a> {
    opt_level: i32,
    compressed_literals: bool,
    lit_freq: &'a mut [u32; MAX_LIT as usize + 1],
    lit_length_freq: &'a mut [u32; MAX_LL as usize + 1],
    match_length_freq: &'a mut [u32; MAX_ML as usize + 1],
    off_code_freq: &'a mut [u32; MAX_OFF as usize + 1],
    sums: Sums,
    /// `litSumBasePrice`
    lit_base: u32,
    /// `litLengthSumBasePrice`
    lit_length_base: u32,
    /// `matchLengthSumBasePrice` plus `offCodeSumBasePrice`
    match_base: u32,
    /// `WEIGHT(litFreq[literal])`
    lit_weight: [u32; MAX_LIT as usize + 1],
    /// By code.
    lit_length: [u32; MAX_LL as usize + 1],
    /// `LL_INCPRICE` of the short lengths.
    lit_length_inc: [u32; LL_INC_LENGTHS],
    /// By code.
    offset: [u32; MAX_OFF as usize + 1],
    /// By length, up to the longest that is priced.
    ml: &'a mut [u32],
}

/// `litSum`, `litLengthSum`, `matchLengthSum` and `offCodeSum`
#[derive(Clone, Copy)]
struct Sums {
    lit: u32,
    lit_length: u32,
    match_length: u32,
    off_code: u32,
}

impl<'a> Prices<'a> {
    fn new(stats: &'a mut OptState, ml: &'a mut [u32], opt_level: i32) -> Result<Self> {
        let mut prices = Self {
            opt_level,
            compressed_literals: compressed_literals(stats),
            sums: Sums {
                lit: stats.lit_sum,
                lit_length: stats.lit_length_sum,
                match_length: stats.match_length_sum,
                off_code: stats.off_code_sum,
            },
            lit_freq: stats.lit_freq.first_chunk_mut().ok_or(BUG)?,
            lit_length_freq: stats.lit_length_freq.first_chunk_mut().ok_or(BUG)?,
            match_length_freq: stats.match_length_freq.first_chunk_mut().ok_or(BUG)?,
            off_code_freq: stats.off_code_freq.first_chunk_mut().ok_or(BUG)?,
            // 8 bits per literal, if they are not compressed.
            lit_base: 8 * BITCOST_MULTIPLIER,
            lit_length_base: 0,
            match_base: 0,
            lit_weight: [0; MAX_LIT as usize + 1],
            lit_length: [0; MAX_LL as usize + 1],
            lit_length_inc: [0; LL_INC_LENGTHS],
            offset: [0; MAX_OFF as usize + 1],
            ml,
        };
        if prices.compressed_literals {
            prices.weigh_literals();
        }
        for code in 0..=MAX_LL {
            prices.price_lit_length(code)?;
        }
        for code in 0..=MAX_OFF {
            prices.price_offset(code)?;
        }
        for code in 0..=MAX_ML {
            prices.price_match_length(code)?;
        }
        prices.set_base_prices();
        Ok(prices)
    }

    #[inline(always)]
    fn price_lit_length(&mut self, code: u32) -> Result<()> {
        let code = code as usize;
        let bits = u32::from(LL_BITS.at(code)?) * BITCOST_MULTIPLIER;
        let price = bits.wrapping_sub(weight(self.lit_length_freq.at(code)?, self.opt_level));
        self.lit_length.put(code, price)?;
        // The price changes where the lengths of this code start, and where those of the next one do.
        if let Some(inc) = self
            .lit_length_inc
            .get_mut(LL_CODE_START.at(code)? as usize)
            && let Some(&before) = self.lit_length.get(code.wrapping_sub(1))
        {
            *inc = price.wrapping_sub(before);
        }
        if let Some(inc) = self
            .lit_length_inc
            .get_mut(LL_CODE_START.at(code + 1)? as usize)
            && let Some(&after) = self.lit_length.get(code + 1)
        {
            *inc = after.wrapping_sub(price);
        }
        Ok(())
    }

    /// Below level 2, small offsets are favoured, which are faster to decompress.
    #[inline(always)]
    fn price_offset(&mut self, code: u32) -> Result<()> {
        let freq = self.off_code_freq.at(code as usize)?;
        let mut price = (code * BITCOST_MULTIPLIER).wrapping_sub(weight(freq, self.opt_level));
        if self.opt_level < 2 && code >= 20 {
            price = price.wrapping_add((code - 19) * 2 * BITCOST_MULTIPLIER);
        }
        // Matches cost a bit more, to have fewer sequences, which is faster to decompress.
        self.offset
            .put(code as usize, price.wrapping_add(BITCOST_MULTIPLIER / 5))
    }

    #[inline(always)]
    fn price_match_length(&mut self, code: u32) -> Result<()> {
        let code = code as usize;
        let bits = u32::from(ML_BITS.at(code)?) * BITCOST_MULTIPLIER;
        let freq = self.match_length_freq.at(code)?;
        let price = bits.wrapping_sub(weight(freq, self.opt_level));
        let most = self.ml.len();
        let start = (ML_CODE_START.at(code)? + MINMATCH) as usize;
        let end = (ML_CODE_START.at(code + 1)? + MINMATCH) as usize;
        self.ml.sub_mut(start.min(most)..end.min(most))?.fill(price);
        Ok(())
    }

    /// `ZSTD_setBasePrices`
    #[inline(always)]
    fn set_base_prices(&mut self) {
        if self.compressed_literals {
            self.lit_base = weight(self.sums.lit, self.opt_level);
        }
        self.lit_length_base = weight(self.sums.lit_length, self.opt_level);
        self.match_base = weight(self.sums.match_length, self.opt_level)
            .wrapping_add(weight(self.sums.off_code, self.opt_level));
    }

    /// `LIT_PRICE`, which is `ZSTD_rawLiteralsCost` of one literal.
    #[inline(always)]
    fn literal(&self, literal: u8) -> i32 {
        let lit_price_max = self.lit_base.wrapping_sub(BITCOST_MULTIPLIER);
        let lit_price = self.lit_weight.get(usize::from(literal)).copied();
        self.lit_base
            .wrapping_sub(lit_price.unwrap_or(0).min(lit_price_max)) as i32
    }

    /// `ZSTD_litLengthPrice`, but for what does not depend on the length.
    #[inline(always)]
    fn lit_length_part(&self, lit_length: u32) -> u32 {
        // The format has no code for the length of a whole block of the largest size, which is then all literals. It
        // is made to cost 1 bit more than the length before it.
        let (lit_length, extra) = if lit_length == ZSTD_BLOCKSIZE_MAX as u32 {
            (ZSTD_BLOCKSIZE_MAX as u32 - 1, BITCOST_MULTIPLIER)
        } else {
            (lit_length, 0)
        };
        let price = self.lit_length.get(ll_code(lit_length) as usize).copied();
        extra.wrapping_add(price.unwrap_or(0))
    }

    /// `LL_PRICE`
    #[inline(always)]
    fn lit_length(&self, lit_length: u32) -> i32 {
        self.lit_length_base
            .wrapping_add(self.lit_length_part(lit_length)) as i32
    }

    /// `LL_INCPRICE`: what one more literal, which makes `lit_length` of them, adds to the price of their length.
    #[inline(always)]
    fn lit_length_inc(&self, lit_length: u32) -> i32 {
        if let Some(&inc) = self.lit_length_inc.get(lit_length as usize) {
            return inc as i32;
        }
        cold_path();
        self.lit_length_part(lit_length)
            .wrapping_sub(self.lit_length_part(lit_length.wrapping_sub(1))) as i32
    }

    /// `ZSTD_getMatchPrice`, the price of the offset and of the match length of a sequence, but for what depends on the
    /// length, which is in `ml`. `off_base` is as in [`SeqStore::store_seq`].
    #[inline(always)]
    fn offset(&self, off_base: u32) -> i32 {
        let price = self.offset.get(highbit32(off_base) as usize).copied();
        self.match_base.wrapping_add(price.unwrap_or(0)) as i32
    }

    /// Sets `lit_weight` for all of `lit_freq`.
    #[inline(never)]
    fn weigh_literals(&mut self) {
        for (weight_of, &freq) in self.lit_weight.iter_mut().zip(&*self.lit_freq) {
            *weight_of = weight(freq, self.opt_level);
        }
    }

    /// `ZSTD_updateStats`
    #[inline(always)]
    fn update_stats(&mut self, literals: &[u8], off_base: u32, match_length: u32) -> Result<()> {
        #[inline(always)]
        fn increment(freqs: &mut [u32], code: u32, sum: &mut u32) -> Result<()> {
            let freq = freqs.at_mut(code as usize)?;
            *freq = freq.wrapping_add(1);
            *sum = sum.wrapping_add(1);
            Ok(())
        }

        let lit_length = literals.len() as u32;
        if self.compressed_literals {
            if literals.len() > self.lit_weight.len() {
                // There are fewer weights to compute than literals.
                for &literal in literals {
                    let freq = self.lit_freq.at_mut(usize::from(literal))?;
                    *freq = freq.wrapping_add(ZSTD_LITFREQ_ADD);
                }
                self.weigh_literals();
            } else {
                for &literal in literals {
                    let literal = usize::from(literal);
                    let freq = self.lit_freq.at(literal)?.wrapping_add(ZSTD_LITFREQ_ADD);
                    self.lit_freq.put(literal, freq)?;
                    self.lit_weight.put(literal, weight(freq, self.opt_level))?;
                }
            }
            self.sums.lit = self
                .sums
                .lit
                .wrapping_add(lit_length.wrapping_mul(ZSTD_LITFREQ_ADD));
        }

        let ll_code = ll_code(lit_length);
        increment(self.lit_length_freq, ll_code, &mut self.sums.lit_length)?;
        let off_code = highbit32(off_base);
        increment(self.off_code_freq, off_code, &mut self.sums.off_code)?;
        let ml_code = ml_code(match_length.wrapping_sub(MINMATCH));
        increment(self.match_length_freq, ml_code, &mut self.sums.match_length)?;
        self.price_lit_length(ll_code)?;
        self.price_offset(off_code)?;
        self.price_match_length(ml_code)
    }
}

// ── binary tree search ────────────────────────────────────────────────────

/// What the match finders work on for the time of a block: the tables of a [`MatchState`], and what does not change
/// of it.
struct Trees<'a> {
    hash_table: &'a mut [u32],
    hash_table3: &'a mut [u32],
    bt: &'a mut Nodes,
    input: TreeInput<'a>,
    dms: Option<DictMatchState<'a>>,
    low_limit: u32,
    /// How far a match can be, if that is not down to `low_limit`.
    max_distance: u32,
    hasher: Hasher,
    hash_log3: u32,
    /// 3 or 4.
    min_match: u32,
    nb_compares: u32,
    sufficient_len: u32,
    next_to_update: u32,
    next_to_update3: u32,
}

impl<'a> Trees<'a> {
    fn new(
        ms: &'a mut MatchState,
        prefix: Prefix<'a>,
        dict: Prefix<'a>,
        dms: Option<DictMatchState<'a>>,
        iend: usize,
        mls: u32,
    ) -> Result<Self> {
        let c_params = ms.c_params;
        let dict_limit = ms.window.dict_limit;
        if ms.hash_table.len() != 1usize.wrapping_shl(c_params.hash_log)
            || ms.chain_table.len() != 1usize.wrapping_shl(c_params.chain_log)
        {
            return Err(BUG);
        }
        Ok(Self {
            hash_table: ms.hash_table.as_mut_slice(),
            hash_table3: ms.hash_table3.as_mut_slice(),
            bt: bt_nodes(&mut ms.chain_table),
            input: TreeInput::new(prefix, dict, dict_limit, iend)?,
            dms,
            low_limit: ms.window.low_limit,
            // A dictionary is valid as a whole until it is invalidated as a whole.
            max_distance: if ms.loaded_dict_end != 0 {
                u32::MAX
            } else {
                1u32.wrapping_shl(c_params.window_log)
            },
            hasher: Hasher::new(c_params.hash_log, mls),
            hash_log3: ms.hash_log3,
            min_match: if c_params.min_match == 3 { 3 } else { 4 },
            nb_compares: 1u32.wrapping_shl(c_params.search_log),
            sufficient_len: c_params.target_length.min(ZSTD_OPT_NUM as u32 - 1),
            next_to_update: ms.next_to_update,
            next_to_update3: ms.next_to_update,
        })
    }

    /// `ZSTD_getLowestMatchIndex`
    #[inline(always)]
    const fn lowest_match_index(&self, curr: u32) -> u32 {
        if curr.wrapping_sub(self.low_limit) > self.max_distance {
            curr.wrapping_sub(self.max_distance)
        } else {
            self.low_limit
        }
    }

    /// `ZSTD_insertAndFindFirstIndexHash3`: indexes the 3-byte hashes up to `curr`, which is not included and starts
    /// with `bytes`, and looks it up. All of it is in the current segment.
    #[inline(always)]
    fn insert_and_find_first_index_hash3(&mut self, curr: u32, bytes: u32) -> Result<u32> {
        let input = self.input;
        for idx in self.next_to_update3..curr {
            let bytes = input.near.read32(idx.wrapping_sub(input.dict_limit));
            let hash3 = hash3_of(bytes.ok_or(BUG)?, self.hash_log3);
            table_put(self.hash_table3, hash3, idx);
        }
        self.next_to_update3 = curr;
        Ok(table_get(self.hash_table3, hash3_of(bytes, self.hash_log3)))
    }

    /// Adds the position `ip` of `near`, which starts with `bytes`, to its tree. `visit` is called with each position
    /// that is met on the way, which are all at least `low`, and what it has in common with `ip`, and returns whether
    /// to go on. Returns how many more positions could have been compared.
    #[inline(always)]
    fn walk(
        &mut self,
        ip: u32,
        bytes: u64,
        low: u32,
        visit: impl FnMut(u32, Common) -> Result<bool>,
    ) -> Result<u32> {
        let curr = ip.wrapping_add(self.input.dict_limit);
        if self.hash_table.is_empty() {
            return Err(BUG);
        }

        let h = self.hasher.hash(bytes);
        let match_index = table_get(self.hash_table, h);
        table_put(self.hash_table, h, curr);
        bt_look_ahead::<4, 2>(self.hash_table, self.bt, &self.input, self.hasher, ip);
        if match_index < low {
            bt_set_children(self.bt, curr, [0, 0]);
            return Ok(self.nb_compares);
        }

        let descent = Descent::new(self.bt, curr);
        bt_walk::<false>(
            self.bt,
            &self.input,
            ip,
            match_index,
            low,
            self.nb_compares,
            descent,
            visit,
        )
    }

    /// `ZSTD_insertBt1`: adds `curr`, which is at least 8 bytes before the end, to its tree. `target` is up to where
    /// the caller is filling them. Returns how many positions to move forward.
    #[inline(always)]
    fn insert_bt1(&mut self, curr: u32, target: u32) -> Result<u32> {
        let ip = curr.wrapping_sub(self.input.dict_limit);
        let bytes = self.input.near.read64(ip).ok_or(BUG)?;
        // Only the positions that are still in the window once the trees are filled are of use.
        let window_low = self.lowest_match_index(target);
        let mut match_end_idx = curr.wrapping_add(8 + 1);
        let mut best_length = 8u32;

        self.walk(ip, bytes, window_low, |match_index, common| {
            if common.len > best_length {
                cold_path();
                best_length = common.len;
                if common.len > match_end_idx.wrapping_sub(match_index) {
                    match_end_idx = match_index.wrapping_add(common.len);
                }
            }
            // If they are equal, there is no telling which is smaller. Dropping it keeps the tree consistent.
            Ok(common.match_is_smaller.is_some())
        })?;

        let positions = if best_length > 384 {
            192.min(best_length - 384)
        } else {
            0
        };
        Ok(positions.max(match_end_idx.wrapping_sub(curr.wrapping_add(8))))
    }

    /// `ZSTD_updateTree_internal`: adds the positions from `next_to_update` up to `target` to the trees.
    #[inline(always)]
    fn update_tree(&mut self, target: u32) -> Result<()> {
        self.update_tree_in_part(target, target)?;
        self.next_to_update = target;
        Ok(())
    }

    /// The part of [`Self::update_tree`] that gets to `up_to`, or somewhat beyond.
    #[inline(never)]
    fn update_tree_in_part(&mut self, up_to: u32, target: u32) -> Result<()> {
        let mut idx = self.next_to_update;
        while idx < up_to {
            idx = idx.wrapping_add(self.insert_bt1(idx, target)?);
        }
        self.next_to_update = idx;
        Ok(())
    }

    /// The length of the match for `ip` at the repeat offset `rep_offset`, which is at least `min_match` if it leads to
    /// the current segment. Else it is 0 if it is less.
    #[inline(never)]
    fn rep_len(&self, ip: u32, rep_offset: u32, window_low: u32) -> Result<u32> {
        let input = self.input;
        let min_match = self.min_match;
        if rep_offset.wrapping_sub(1) < ip {
            let more = input
                .near
                .count(ip + min_match, ip - rep_offset + min_match);
            return Ok(more + min_match);
        }
        let curr = ip.wrapping_add(input.dict_limit);
        let rep_index = curr.wrapping_sub(rep_offset);
        let same_start =
            |bytes: u32| Some(minmatch_differs(bytes, input.near.read32(ip)?, min_match) == 0);
        if !index_overlap_check(input.dict_limit, rep_index) {
            return Ok(0);
        }
        if let Some(dms) = self.dms {
            let dms_high_limit = dms.end.wrapping_sub(dms.base) as u32;
            let dms_index_delta = window_low.wrapping_sub(dms_high_limit);
            let dms_low = dms.ms.window.low_limit.wrapping_add(dms_index_delta);
            // `curr > rep_index >= dms_low`
            if rep_offset.wrapping_sub(1) < curr.wrapping_sub(dms_low) {
                let rep_match = dms.pos_of(rep_index.wrapping_sub(dms_index_delta));
                if same_start(read_le32(dms.buf, rep_match)?).ok_or(BUG)? {
                    let after = rep_match + min_match as usize;
                    let more = input.count_2segments(ip + min_match, dms.buf, after, dms.end)?;
                    return Ok(more + min_match);
                }
            }
        } else if self.low_limit < input.dict_limit {
            // `curr > rep_index >= window_low`
            if rep_offset.wrapping_sub(1) < curr.wrapping_sub(window_low)
                && same_start(read_le32(input.dict.buf, input.dict.pos_of(rep_index))?)
                    .ok_or(BUG)?
            {
                let after = rep_index.wrapping_add(min_match);
                return Ok(input.count_ext_dict(ip + min_match, after)? + min_match);
            }
        }
        Ok(0)
    }

    /// `ZSTD_btGetAllMatches_internal`: adds the positions up to `ip`, a position of `near`, to the trees, and stores in
    /// `matches` the matches for it that are found on the way, each longer than the one before and all at least
    /// `min_match` long. `ll0` is whether no literals come before `ip`. Returns how many there are.
    #[inline(never)]
    fn get_all_matches(
        &mut self,
        matches: &mut [Match],
        ip: u32,
        rep: &[u32; ZSTD_REP_NUM],
        ll0: bool,
    ) -> Result<u32> {
        let near = self.input.near;
        let dict_limit = self.input.dict_limit;
        let curr = ip.wrapping_add(dict_limit);
        if curr < self.next_to_update {
            // An area that is skipped.
            return Ok(0);
        }
        if self.next_to_update < curr {
            self.update_tree(curr)?;
        }

        let min_match = self.min_match;
        let bytes = near.read64(ip).ok_or(BUG)?;
        let dict_root = match self.dms {
            Some(dms) => {
                let hasher = self.hasher.with_log(dms.ms.c_params.hash_log);
                DictTree::root(dms, hasher.hash(bytes))?
            }
            None => 0,
        };
        let window_low = self.lowest_match_index(curr);
        let mut mnum = 0u32;
        let mut best_length = min_match - 1;

        // The repeat offsets.
        let [rep0, rep1, rep2] = *rep;
        let rep_offsets = if ll0 {
            [rep1, rep2, rep0.wrapping_sub(1)]
        } else {
            [rep0, rep1, rep2]
        };
        // With a dictionary, the range of valid offsets shrinks when the dictionary gets out of reach.
        let most_in_prefix = ip.min(curr.wrapping_sub(window_low));
        let candidates = rep_offsets.map(|rep_offset| {
            // The subtraction wraps around to discard 0 and -1: `curr > rep_index >= dict_limit`.
            if rep_offset.wrapping_sub(1) < most_in_prefix {
                let rep_bytes = near.read32(ip.wrapping_sub(rep_offset))?;
                Some(minmatch_differs(rep_bytes, bytes as u32, min_match) == 0)
            } else {
                Some(rep_offset.wrapping_sub(1) >= ip)
            }
        });
        if candidates != [Some(false); 3] {
            for ((off, rep_offset), is_candidate) in (1..).zip(rep_offsets).zip(candidates) {
                if !is_candidate.ok_or(BUG)? {
                    continue;
                }
                let rep_len = self.rep_len(ip, rep_offset, window_low)?;
                if rep_len > best_length {
                    best_length = rep_len;
                    matches.put(mnum as usize, Match { off, len: rep_len })?;
                    mnum += 1;
                    if rep_len > self.sufficient_len || rep_len == near.len().wrapping_sub(ip) {
                        // The best there can be.
                        return Ok(mnum);
                    }
                }
            }
        }

        // The table of 3-byte hashes. That of a dictionary is not filled.
        let match_low = window_low.max(1);
        if best_length < 3 {
            let match_index3 = self.insert_and_find_first_index_hash3(curr, bytes as u32)?;
            // Farther than that is likely to cost too much.
            if match_index3 >= match_low && curr.wrapping_sub(match_index3) < (1 << 18) {
                let mlen = if match_index3 >= dict_limit {
                    let match_pos = match_index3.wrapping_sub(dict_limit);
                    let match_bytes = near.read32(match_pos).ok_or(BUG)?;
                    if minmatch_differs(match_bytes, bytes as u32, 3) != 0 {
                        0
                    } else {
                        count(near, ip, match_pos)
                    }
                } else {
                    self.input.count_ext_dict(ip, match_index3)?
                };

                if mlen >= 3 {
                    best_length = mlen;
                    matches.put(
                        0,
                        Match {
                            off: offset_to_offbase(curr.wrapping_sub(match_index3)),
                            len: mlen,
                        },
                    )?;
                    mnum = 1;
                    if mlen > self.sufficient_len || mlen == near.len().wrapping_sub(ip) {
                        // The best there can be: `ip` is not inserted.
                        self.next_to_update = curr.wrapping_add(1);
                        return Ok(1);
                    }
                }
            }
        }

        let mut found = Found::new(mnum, best_length, curr);
        let nb_compares = self.tree_matches(matches, ip, bytes, match_low, &mut found)?;
        if dict_root != 0 && nb_compares != 0 {
            // A copy, for the one that the loop above works on to need no place in memory.
            let mut with_dict = found;
            self.search_dms(
                matches,
                ip,
                dict_root,
                window_low,
                nb_compares,
                &mut with_dict,
            )?;
            found = with_dict;
        }

        // Repetitive patterns are skipped.
        self.next_to_update = found.match_end_idx.wrapping_sub(8);
        Ok(found.mnum)
    }

    /// The part of `ZSTD_insertBtAndGetAllMatches` that adds the position `ip` of `near`, which starts with `bytes`, to
    /// its tree, and stores the matches that are met on the way. Returns how many more positions can be compared in the
    /// tree of a dictionary.
    #[inline(always)]
    fn tree_matches(
        &mut self,
        matches: &mut [Match],
        ip: u32,
        bytes: u64,
        match_low: u32,
        found: &mut Found,
    ) -> Result<u32> {
        let curr = ip.wrapping_add(self.input.dict_limit);
        let mut is_over = false;
        let nb_compares = self.walk(ip, bytes, match_low, |match_index, common| {
            if common.len > found.best_length {
                if common.len > found.match_end_idx.wrapping_sub(match_index) {
                    found.match_end_idx = match_index.wrapping_add(common.len);
                }
                found.best_length = common.len;
                matches.put(
                    found.mnum as usize,
                    Match {
                        off: offset_to_offbase(curr.wrapping_sub(match_index)),
                        len: common.len,
                    },
                )?;
                found.mnum += 1;
                if common.len > ZSTD_OPT_NUM as u32 || common.match_is_smaller.is_none() {
                    // If they are equal, there is no telling which is smaller. Dropping it keeps the tree consistent.
                    is_over = true;
                    return Ok(false);
                }
            }
            Ok(true)
        })?;
        Ok(if is_over { 0 } else { nb_compares })
    }

    /// [`Self::get_all_matches`] for `ip`, which comes after literals, and then for the positions after it, before
    /// `limit`, for as long as there is no match. It stops before a position that starts like what is at a repeat
    /// offset, or where the table of 3-byte hashes leads: that one is left to [`Self::get_all_matches`]. Returns where
    /// it stops, and how many matches it has found there.
    #[inline(never)]
    fn skip_matchless(
        &mut self,
        matches: &mut [Match],
        mut ip: u32,
        limit: u32,
        rep: &[u32; ZSTD_REP_NUM],
    ) -> Result<(u32, u32)> {
        let near = self.input.near;
        let dict_limit = self.input.dict_limit;
        let min_match = self.min_match;
        // No repeat offset leads before the current segment, from `ip` on.
        if ip.wrapping_add(dict_limit) != self.next_to_update
            || self.dms.is_some()
            || rep.iter().any(|rep_offset| *rep_offset > ip)
        {
            return Ok((ip, 0));
        }

        while ip < limit
            && let Some(bytes) = near.read64(ip)
        {
            let curr = ip.wrapping_add(dict_limit);
            let match_low = self.lowest_match_index(curr).max(1);
            let starts_alike = |pos: u32, min_match: u32| {
                let there = near.read32(pos);
                there.is_none_or(|there| minmatch_differs(there, bytes as u32, min_match) == 0)
            };
            if (rep.iter()).any(|rep_offset| starts_alike(ip - rep_offset, min_match)) {
                break;
            }
            if min_match == 3 {
                let match_index3 = self.insert_and_find_first_index_hash3(curr, bytes as u32)?;
                if match_index3 >= match_low
                    && curr.wrapping_sub(match_index3) < (1 << 18)
                    && (match_index3 < dict_limit || starts_alike(match_index3 - dict_limit, 3))
                {
                    break;
                }
            }

            let mut found = Found::new(0, min_match - 1, curr);
            self.tree_matches(matches, ip, bytes, match_low, &mut found)?;
            if found.mnum != 0 {
                self.next_to_update = found.match_end_idx.wrapping_sub(8);
                return Ok((ip, found.mnum));
            }
            ip += 1;
        }
        self.next_to_update = ip.wrapping_add(dict_limit);
        Ok((ip, 0))
    }

    /// The end of `ZSTD_insertBtAndGetAllMatches`: goes on in the tree of the dictionary whose root is `root`, for
    /// `nb_compares` positions at most.
    #[inline(never)]
    fn search_dms(
        &self,
        matches: &mut [Match],
        ip: u32,
        root: u32,
        window_low: u32,
        nb_compares: u32,
        found: &mut Found,
    ) -> Result<()> {
        let dms = self.dms.ok_or(BUG)?;
        let input = self.input;
        let curr = ip.wrapping_add(input.dict_limit);
        let tree = DictTree::new(dms, window_low)?;
        tree.walk(&input, ip, root, nb_compares, |dict_match_index, common| {
            if common.len > found.best_length {
                let match_index = dict_match_index.wrapping_add(tree.index_delta);
                if common.len > found.match_end_idx.wrapping_sub(match_index) {
                    found.match_end_idx = match_index.wrapping_add(common.len);
                }
                found.best_length = common.len;
                matches.put(
                    found.mnum as usize,
                    Match {
                        off: offset_to_offbase(curr.wrapping_sub(match_index)),
                        len: common.len,
                    },
                )?;
                found.mnum += 1;
                if common.len > ZSTD_OPT_NUM as u32 || common.match_is_smaller.is_none() {
                    return Ok(false);
                }
            }
            Ok(true)
        })
    }
}

/// [`Near::count`], where few candidates get that far.
#[inline(never)]
fn count(near: Near<'_>, pos: u32, match_pos: u32) -> u32 {
    near.count(pos, match_pos)
}

/// What a search has found so far.
#[derive(Clone, Copy)]
struct Found {
    mnum: u32,
    best_length: u32,
    /// The farthest position any match refers to, which detects repetitive patterns.
    match_end_idx: u32,
}

impl Found {
    /// What the search for `curr` has before it gets to the trees.
    #[inline(always)]
    const fn new(mnum: u32, best_length: u32, curr: u32) -> Self {
        Self {
            mnum,
            best_length,
            match_end_idx: curr.wrapping_add(8 + 1),
        }
    }
}

/// `ZSTD_readMINMATCH`: 0 if the first `length` bytes, 3 or 4, of the 4 in `a` and in `b` are the same.
#[inline(always)]
const fn minmatch_differs(a: u32, b: u32, length: u32) -> u32 {
    (a ^ b) << ((4 - length) * 8)
}

/// `ZSTD_updateTree`: indexes the segment from `ms.next_to_update` up to the position `ip`, in the binary trees.
/// Matches are not compared past the position `iend`.
pub(crate) fn update_tree(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    ip: usize,
    iend: usize,
) -> Result<()> {
    let no_dict = Prefix { buf: &[], base: 0 };
    let mls = ms.c_params.min_match;
    let target = prefix.index_of(ip);
    // The prefix of a job can take seconds.
    while ms.next_to_update < target {
        ms.check_cancelled()?;
        let up_to = ms.next_to_update.saturating_add(1 << 12).min(target);
        let mut trees = Trees::new(ms, prefix, no_dict, None, iend, mls)?;
        trees.update_tree_in_part(up_to, target)?;
        ms.next_to_update = trees.next_to_update;
    }
    ms.next_to_update = target;
    Ok(())
}

// ── candidates from long distance matching ────────────────────────────────

/// `ZSTD_optLdm_t`: what it takes to decide whether to use a long distance match.
struct OptLdm<'a> {
    /// `seqStore.seq`: the `seqStore.size` candidates for this block and the next ones.
    seq: &'a [RawSeq],
    /// `seqStore.pos`
    pos: usize,
    /// `seqStore.posInSequence`
    pos_in_sequence: usize,
    /// Where the current candidate starts.
    start_pos_in_block: u32,
    /// Where it ends.
    end_pos_in_block: u32,
    offset: u32,
}

impl<'a> OptLdm<'a> {
    fn new(seq_store: Option<&'a RawSeqStore>) -> Self {
        Self {
            seq: seq_store
                .and_then(|store| store.seq.get(..store.size))
                .unwrap_or_default(),
            pos: seq_store.map_or(0, |store| store.pos),
            pos_in_sequence: seq_store.map_or(0, |store| store.pos_in_sequence),
            start_pos_in_block: 0,
            end_pos_in_block: 0,
            offset: 0,
        }
    }

    /// `ZSTD_optLdm_skipRawSeqStoreBytes`: moves forward by `nb_bytes`.
    fn skip_raw_seq_store_bytes(&mut self, nb_bytes: usize) {
        let mut curr_pos = self.pos_in_sequence.wrapping_add(nb_bytes) as u32;
        while curr_pos != 0 {
            let Some(curr_seq) = self.seq.get(self.pos) else {
                break;
            };
            let seq_length = curr_seq.lit_length.wrapping_add(curr_seq.match_length);
            if curr_pos >= seq_length {
                curr_pos -= seq_length;
                self.pos += 1;
            } else {
                self.pos_in_sequence = curr_pos as usize;
                break;
            }
        }
        if curr_pos == 0 || self.pos == self.seq.len() {
            self.pos_in_sequence = 0;
        }
    }

    /// `ZSTD_opt_getNextMatchAndUpdateSeqStore`: finds where the next candidate starts and ends in the block, and
    /// moves past it.
    fn get_next_match_and_update_seq_store(
        &mut self,
        curr_pos_in_block: u32,
        block_bytes_remaining: u32,
    ) {
        let Some(&curr_seq) = self.seq.get(self.pos) else {
            // No position gets there, so that there is no candidate in this block.
            self.start_pos_in_block = u32::MAX;
            self.end_pos_in_block = u32::MAX;
            return;
        };
        // What is left of the literals and of the match.
        let pos_in_sequence = self.pos_in_sequence as u32;
        let curr_block_end_pos = curr_pos_in_block.wrapping_add(block_bytes_remaining);
        let literals_bytes_remaining = curr_seq.lit_length.saturating_sub(pos_in_sequence);
        let match_bytes_remaining = if literals_bytes_remaining == 0 {
            curr_seq
                .match_length
                .wrapping_sub(pos_in_sequence.wrapping_sub(curr_seq.lit_length))
        } else {
            curr_seq.match_length
        };

        if literals_bytes_remaining >= block_bytes_remaining {
            // The match starts after the block.
            self.start_pos_in_block = u32::MAX;
            self.end_pos_in_block = u32::MAX;
            self.skip_raw_seq_store_bytes(block_bytes_remaining as usize);
            return;
        }

        // What is left of a match can be too short to use, which is checked later.
        self.start_pos_in_block = curr_pos_in_block.wrapping_add(literals_bytes_remaining);
        self.end_pos_in_block = self.start_pos_in_block.wrapping_add(match_bytes_remaining);
        self.offset = curr_seq.offset;

        if self.end_pos_in_block > curr_block_end_pos {
            // The match ends after the block, which can only use its start.
            self.end_pos_in_block = curr_block_end_pos;
            self.skip_raw_seq_store_bytes(
                curr_block_end_pos.wrapping_sub(curr_pos_in_block) as usize
            );
        } else {
            self.skip_raw_seq_store_bytes(
                literals_bytes_remaining.wrapping_add(match_bytes_remaining) as usize,
            );
        }
    }

    /// `ZSTD_optLdm_maybeAddMatch`: adds what is left of the candidate at `curr_pos_in_block` to `matches`, if it is
    /// long enough and longer than all of them, since they are in order of length.
    fn maybe_add_match(
        &self,
        matches: &mut [Match],
        nb_matches: &mut u32,
        curr_pos_in_block: u32,
        min_match: u32,
    ) -> Result<()> {
        let pos_diff = curr_pos_in_block.wrapping_sub(self.start_pos_in_block);
        let candidate_match_length = self
            .end_pos_in_block
            .wrapping_sub(self.start_pos_in_block)
            .wrapping_sub(pos_diff);

        if curr_pos_in_block < self.start_pos_in_block
            || curr_pos_in_block >= self.end_pos_in_block
            || candidate_match_length < min_match
        {
            return Ok(());
        }

        if *nb_matches == 0
            || (candidate_match_length > matches.at(*nb_matches as usize - 1)?.len
                && (*nb_matches as usize) < ZSTD_OPT_NUM)
        {
            matches.put(
                *nb_matches as usize,
                Match {
                    off: offset_to_offbase(self.offset),
                    len: candidate_match_length,
                },
            )?;
            *nb_matches += 1;
        }
        Ok(())
    }

    /// Whether there is no candidate left.
    #[inline(always)]
    const fn is_over(&self) -> bool {
        self.pos >= self.seq.len()
    }

    /// `ZSTD_optLdm_processMatchCandidate`
    #[inline(always)]
    fn process_match_candidate(
        &mut self,
        matches: &mut [Match],
        nb_matches: &mut u32,
        curr_pos_in_block: u32,
        remaining_bytes: u32,
        min_match: u32,
    ) -> Result<()> {
        if self.is_over() {
            return Ok(());
        }

        if curr_pos_in_block >= self.end_pos_in_block {
            if curr_pos_in_block > self.end_pos_in_block {
                // The parser does not stop at the end of each candidate: it is often some bytes past it.
                let pos_overshoot = curr_pos_in_block - self.end_pos_in_block;
                self.skip_raw_seq_store_bytes(pos_overshoot as usize);
            }
            self.get_next_match_and_update_seq_store(curr_pos_in_block, remaining_bytes);
        }
        self.maybe_add_match(matches, nb_matches, curr_pos_in_block, min_match)
    }
}

// ── the optimal parser ────────────────────────────────────────────────────

/// `ZSTD_optimal_t`, as [`PriceTable`] has it: a match followed by literals.
#[derive(Clone, Copy, Default)]
struct Stretch {
    off: u32,
    mlen: u32,
    litlen: u32,
    rep: [u32; ZSTD_REP_NUM],
}

/// [`PriceTable::lens`] has the length of the match in its low bits, which are enough since the table has
/// [`ZSTD_OPT_NUM`] positions, and the number of literals above.
const LITLEN_SHIFT: u32 = 12;
const ONE_LITERAL: u32 = 1 << LITLEN_SHIFT;

#[inline(always)]
const fn litlen_of(lens: u32) -> u32 {
    lens >> LITLEN_SHIFT
}

#[inline(always)]
const fn mlen_of(lens: u32) -> u32 {
    lens & (ONE_LITERAL - 1)
}

/// With fewer lengths than this, [`try_lengths`] is not worth calling.
const FEW_LENGTHS: u32 = 4;

/// The positions that the lengths from `first_len` on of a match at the offset `off` lead to take it if that is cheaper
/// than what leads to them so far. `ml_prices` has the price of each of these lengths, and `base_price` is the rest.
#[inline(never)]
fn try_lengths(
    prices: &mut [i32],
    offs: &mut [u32],
    lens: &mut [u32],
    ml_prices: &[u32],
    first_len: u32,
    base_price: i32,
    off: u32,
) {
    let reached = prices.iter_mut().zip(offs).zip(lens);
    for (mlen, (((price, best_off), best_lens), &ml_price)) in
        (first_len..).zip(reached.zip(ml_prices))
    {
        // Written so that it is done on vectors.
        let new_price = base_price.wrapping_add(ml_price as i32);
        let cheaper = u32::from(new_price < *price).wrapping_neg();
        *price = new_price.min(*price);
        *best_off = (*best_off & !cheaper) | (off & cheaper);
        *best_lens = (*best_lens & !cheaper) | (mlen & cheaper);
    }
}

/// `ZSTD_compressBlock_opt_generic`
#[inline(always)]
fn compress_block_opt_generic(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    opt_level: i32,
    dict_mode: DictMode,
) -> Result<usize> {
    // The match finders borrow the rest of `ms`.
    let mut opt_state = mem::replace(&mut ms.opt, OptState::new());
    let mut match_table = mem::take(&mut opt_state.match_table);
    let mut price_table = mem::take(&mut opt_state.price_table);
    let result = parse_block(
        ms,
        &mut opt_state,
        &mut match_table,
        &mut price_table,
        seq_store,
        rep,
        src,
        opt_level,
        dict_mode,
    );
    opt_state.match_table = match_table;
    opt_state.price_table = price_table;
    ms.opt = opt_state;
    result
}

/// The body of `ZSTD_compressBlock_opt_generic`. `opt_state` is `ms.opt`, without `matches` and `price_table`.
#[inline(always)]
fn parse_block(
    ms: &mut MatchState,
    opt_state: &mut OptState,
    matches: &mut [Match],
    price_table: &mut PriceTable,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    opt_level: i32,
    dict_mode: DictMode,
) -> Result<usize> {
    let buf = src.buf;
    let istart = src.start;
    let mut ip = istart;
    let mut anchor = istart;
    let iend = src.end;
    let ilimit = iend.saturating_sub(8);
    let prefix_start = src.pos_of(ms.window.dict_limit);

    let sufficient_len = ms.c_params.target_length.min(ZSTD_OPT_NUM as u32 - 1);
    let min_match = if ms.c_params.min_match == 3 { 3 } else { 4 };
    let dict = Prefix {
        buf: src.dict_buf,
        base: src.dict_base,
    };
    let dms = if dict_mode == DictMode::DictMatchState {
        Some(src.dms.ok_or(BUG)?)
    } else {
        None
    };
    let mls = ms.c_params.min_match.clamp(3, 6);
    let mut trees = Trees::new(ms, src.prefix(), dict, dms, iend, mls)?;

    let mut last_stretch = Stretch::default();
    let mut opt_ldm = OptLdm::new(src.ldm_seq_store);
    opt_ldm.get_next_match_and_update_seq_store(0, (iend - ip) as u32);

    rescale_freqs(opt_state, src.symbol_costs, buf.sub(istart..iend)?)?;
    // Of the same size, so that one check is enough for all.
    let nb_positions = price_table.price.len();
    let opt_price = price_table.price.sub_mut(..nb_positions)?;
    let opt_off = price_table.off.sub_mut(..nb_positions)?;
    let opt_lens = price_table.lens.sub_mut(..nb_positions)?;
    let opt_rep = price_table.rep.sub_mut(..nb_positions)?;
    // No match is longer than a block.
    let ml_prices =
        (price_table.ml_price).sub_mut(..(sufficient_len as usize + 1).min(nb_positions))?;
    let mut prices = Prices::new(opt_state, ml_prices, opt_level)?;
    ip += usize::from(ip == prefix_start);

    'series: while ip < ilimit {
        let mut last_pos: u32;
        let ll0_price = prices.lit_length(0);
        let ll1_inc_price = prices.lit_length_inc(1);

        // The forward pass. The table holds stretches, each a match followed by literals, unlike a sequence, which is
        // literals followed by a match: that way each position of a run of literals can have another match before it.
        // It ends with the last stretch in `last_stretch`, which starts at `cur` and ends at `last_pos`.
        let mut cur = 'forward: {
            // Find a first match.
            {
                let mut nb_matches = 0;
                if ip != anchor && opt_ldm.is_over() {
                    let first = (ip - prefix_start) as u32;
                    let limit = (ilimit - prefix_start) as u32;
                    let (stop, found) = trees.skip_matchless(matches, first, limit, rep)?;
                    ip += (stop - first) as usize;
                    if ip >= ilimit {
                        break 'series;
                    }
                    nb_matches = found;
                }
                let litlen = (ip - anchor) as u32;
                if nb_matches == 0 {
                    let pos = (ip - prefix_start) as u32;
                    nb_matches = trees.get_all_matches(matches, pos, rep, litlen == 0)?;
                }
                opt_ldm.process_match_candidate(
                    matches,
                    &mut nb_matches,
                    (ip - istart) as u32,
                    (iend - ip) as u32,
                    min_match,
                )?;
                if nb_matches == 0 {
                    ip += 1;
                    continue 'series;
                }
                let matches = matches.sub(..nb_matches as usize)?;

                // The price of the literals before the first match is the same whatever comes next, so it is left
                // out. But how the price of their length changes depends on their length.
                let first_price = prices.lit_length(litlen);
                opt_price.put(0, first_price)?;
                opt_lens.put(0, litlen << LITLEN_SHIFT)?;
                opt_rep.put(0, *rep)?;

                // A large match is encoded at once.
                let longest = matches.at(matches.len() - 1)?;
                if longest.len > sufficient_len {
                    last_stretch.litlen = 0;
                    last_stretch.mlen = longest.len;
                    last_stretch.off = longest.off;
                    last_pos = longest.len;
                    break 'forward 0;
                }

                // Set the prices of the first matches.
                let mut pos = 1u32;
                while pos < min_match {
                    opt_price.put(pos as usize, ZSTD_MAX_PRICE)?;
                    opt_lens.put(pos as usize, litlen.wrapping_add(pos) << LITLEN_SHIFT)?;
                    pos += 1;
                }
                for candidate in matches {
                    let base_price = first_price
                        .wrapping_add(ll0_price)
                        .wrapping_add(prices.offset(candidate.off));
                    while pos <= candidate.len {
                        let price = base_price.wrapping_add(prices.ml.at(pos as usize)? as i32);
                        opt_price.put(pos as usize, price)?;
                        opt_off.put(pos as usize, candidate.off)?;
                        opt_lens.put(pos as usize, pos)?;
                        pos += 1;
                    }
                }
                last_pos = pos - 1;
                opt_price.put(pos as usize, ZSTD_MAX_PRICE)?;
            }

            // Check the positions that follow.
            let mut cur = 0u32;
            while cur < last_pos {
                cur += 1;
                let at = cur as usize;
                let inr = ip + at;
                if at + 1 >= nb_positions {
                    return Err(BUG);
                }

                // Get to this position by a literal, if it is cheaper.
                {
                    let lens = opt_lens.at(at - 1)?.wrapping_add(ONE_LITERAL);
                    let litlen = litlen_of(lens);
                    let price = opt_price
                        .at(at - 1)?
                        .wrapping_add(prices.literal(buf.at(inr - 1)?))
                        .wrapping_add(prices.lit_length_inc(litlen));
                    let match_price = opt_price.at(at)?;
                    if price <= match_price {
                        let match_lens = opt_lens.at(at)?;
                        let match_off = opt_off.at(at)?;
                        opt_price.put(at, price)?;
                        opt_lens.put(at, lens)?;
                        let off = opt_off.at(at - 1)?;
                        opt_off.put(at, off)?;
                        let rep = opt_rep.at(at - 1)?;
                        opt_rep.put(at, rep)?;
                        // If this replaces a match, and 1 literal is cheaper than none, the match followed by a
                        // literal may be a cheaper way to the next position.
                        if opt_level >= 1
                            && litlen_of(match_lens) == 0
                            && ll1_inc_price < 0
                            && inr < iend
                        {
                            let next_lit_price = prices.literal(buf.at(inr)?);
                            let with_1_literal = match_price
                                .wrapping_add(next_lit_price)
                                .wrapping_add(ll1_inc_price);
                            let with_more_literals = price
                                .wrapping_add(next_lit_price)
                                .wrapping_add(prices.lit_length_inc(litlen.wrapping_add(1)));
                            if with_1_literal < with_more_literals
                                && with_1_literal < opt_price.at(at + 1)?
                            {
                                let prev = cur.wrapping_sub(match_lens) as usize;
                                let ll0 = litlen_of(opt_lens.at(prev)?) == 0;
                                opt_price.put(at + 1, with_1_literal)?;
                                opt_lens.put(at + 1, match_lens + ONE_LITERAL)?;
                                opt_off.put(at + 1, match_off)?;
                                let rep = new_rep(&opt_rep.at(prev)?, match_off, ll0);
                                opt_rep.put(at + 1, rep)?;
                                last_pos = last_pos.max(cur + 1);
                            }
                        }
                    }
                }

                // The repeat offsets are not updated while matches are compared, but here, now that one is selected.
                let lens = opt_lens.at(at)?;
                let ll0 = litlen_of(lens) == 0;
                if ll0 {
                    let prev = cur.wrapping_sub(lens) as usize;
                    let prev_ll0 = litlen_of(opt_lens.at(prev)?) == 0;
                    let rep = new_rep(&opt_rep.at(prev)?, opt_off.at(at)?, prev_ll0);
                    opt_rep.put(at, rep)?;
                }

                // The last match starts at least 8 bytes before the end.
                if inr > ilimit {
                    continue;
                }

                if cur == last_pos {
                    break;
                }

                let price = opt_price.at(at)?;
                if opt_level == 0
                    && opt_price.at(at + 1)? <= price.wrapping_add(BITCOST_MULTIPLIER as i32 / 2)
                {
                    // The next position is cheaper to get to: this one is not promising.
                    continue;
                }

                {
                    let mut nb_matches = trees.get_all_matches(
                        matches,
                        (inr - prefix_start) as u32,
                        opt_rep.get(at).ok_or(BUG)?,
                        ll0,
                    )?;
                    opt_ldm.process_match_candidate(
                        matches,
                        &mut nb_matches,
                        (inr - istart) as u32,
                        (iend - inr) as u32,
                        min_match,
                    )?;
                    if nb_matches == 0 {
                        continue;
                    }
                    let matches = matches.sub(..nb_matches as usize)?;

                    let longest = matches.at(matches.len() - 1)?;
                    if longest.len > sufficient_len
                        || cur.wrapping_add(longest.len) as usize >= ZSTD_OPT_NUM
                        || inr + longest.len as usize >= iend
                    {
                        last_stretch.mlen = longest.len;
                        last_stretch.off = longest.off;
                        last_stretch.litlen = 0;
                        last_pos = cur.wrapping_add(longest.len);
                        break 'forward cur;
                    }

                    // The positions that nothing leads to yet.
                    let furthest = cur + longest.len;
                    if furthest > last_pos {
                        let new = last_pos as usize + 1..=furthest as usize;
                        opt_price.sub_mut(new.clone())?.fill(ZSTD_MAX_PRICE);
                        // Not the end of a match.
                        opt_lens.sub_mut(new)?.fill(ONE_LITERAL);
                        last_pos = furthest;
                    }

                    // Set the prices that the matches found here give.
                    let base_price = price.wrapping_add(ll0_price);
                    let mut start_ml = min_match;
                    for candidate in matches {
                        if candidate.len < start_ml {
                            start_ml = candidate.len + 1;
                            continue;
                        }
                        let base_price = base_price.wrapping_add(prices.offset(candidate.off));
                        if opt_level == 0 || candidate.len - start_ml < FEW_LENGTHS {
                            // From the longest length to the shortest.
                            for mlen in (start_ml..=candidate.len).rev() {
                                let ml_price = prices.ml.at(mlen as usize)?;
                                let price = base_price.wrapping_add(ml_price as i32);
                                let pos = (cur + mlen) as usize;
                                if price < opt_price.at(pos)? {
                                    opt_price.put(pos, price)?;
                                    opt_off.put(pos, candidate.off)?;
                                    opt_lens.put(pos, mlen)?;
                                } else if opt_level == 0 {
                                    // Shorter lengths are not tried.
                                    break;
                                }
                            }
                        } else {
                            let reached =
                                (cur + start_ml) as usize..=(cur + candidate.len) as usize;
                            try_lengths(
                                opt_price.sub_mut(reached.clone())?,
                                opt_off.sub_mut(reached.clone())?,
                                opt_lens.sub_mut(reached)?,
                                prices.ml.sub(start_ml as usize..=candidate.len as usize)?,
                                start_ml,
                                base_price,
                                candidate.off,
                            );
                        }
                        start_ml = candidate.len + 1;
                    }
                }
                opt_price.put(last_pos as usize + 1, ZSTD_MAX_PRICE)?;
            }

            let lens = opt_lens.at(last_pos as usize)?;
            last_stretch = Stretch {
                off: opt_off.at(last_pos as usize)?,
                mlen: mlen_of(lens),
                litlen: litlen_of(lens),
                rep: opt_rep.at(last_pos as usize)?,
            };
            last_pos.wrapping_sub(last_stretch.mlen)
        };

        if last_stretch.mlen == 0 {
            // All the matches have been turned into literals.
            ip += last_pos as usize;
            continue;
        }

        if last_stretch.litlen == 0 {
            // It ends with a match.
            let ll0 = litlen_of(opt_lens.at(cur as usize)?) == 0;
            *rep = new_rep(&opt_rep.at(cur as usize)?, last_stretch.off, ll0);
        } else {
            *rep = last_stretch.rep;
            cur = cur.wrapping_sub(last_stretch.litlen);
        }

        // Follow the cheapest path backwards, and turn its stretches into sequences, which go where the repeat offsets
        // were, from the end. The literals that end the last stretch are in no sequence: they are parsed again.
        let mut first_seq = opt_rep.len();
        let mut stretch_pos = cur;
        let mut mlen = last_stretch.mlen;
        let mut off = last_stretch.off;
        loop {
            let lens = opt_lens.at(stretch_pos as usize)?;
            first_seq = first_seq.wrapping_sub(1);
            opt_rep.put(first_seq, [litlen_of(lens), mlen, off])?;
            mlen = mlen_of(lens);
            if mlen == 0 {
                // The start of the series.
                break;
            }
            off = opt_off.at(stretch_pos as usize)?;
            stretch_pos = stretch_pos.wrapping_sub(litlen_of(lens).wrapping_add(mlen));
        }

        for &[llen, mlen, off] in opt_rep.sub(first_seq..)? {
            let llen = llen as usize;
            prices.update_stats(buf.span(anchor, llen)?, off, mlen)?;
            seq_store.store_seq(llen, buf, anchor, off, mlen as usize)?;
            anchor += llen + mlen as usize;
            ip = anchor;
        }

        prices.set_base_prices();
    }

    let sums = prices.sums;
    opt_state.lit_sum = sums.lit;
    opt_state.lit_length_sum = sums.lit_length;
    opt_state.match_length_sum = sums.match_length;
    opt_state.off_code_sum = sums.off_code;
    ms.next_to_update = trees.next_to_update;
    Ok(iend - anchor)
}

/// `ZSTD_compressBlock_opt0`
fn compress_block_opt0(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    dict_mode: DictMode,
) -> Result<usize> {
    compress_block_opt_generic(ms, seq_store, rep, src, 0, dict_mode)
}

/// `ZSTD_compressBlock_opt2`
fn compress_block_opt2(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    dict_mode: DictMode,
) -> Result<usize> {
    compress_block_opt_generic(ms, seq_store, rep, src, 2, dict_mode)
}

/// `ZSTD_initStats_ultra`: a first pass over the block, only to have better statistics to start from. It has to be the
/// first block, with no dictionary and no long distance matching. Returns the block as the window then sees it, since
/// its indices change.
fn init_stats_ultra<'a>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &[u32; ZSTD_REP_NUM],
    src: &BlockSrc<'a>,
) -> Result<BlockSrc<'a>> {
    // The repeat offsets it leaves are of no use.
    let mut tmp_rep = *rep;
    compress_block_opt2(ms, seq_store, &mut tmp_rep, src, DictMode::NoDict)?;

    // Of the first pass, only the statistics are kept: what the tables have is made out of reach.
    let src_size = src.end - src.start;
    seq_store.reset();
    ms.window.base = ms.window.base.wrapping_sub(src_size);
    ms.window.dict_limit = ms.window.dict_limit.wrapping_add(src_size as u32);
    ms.window.low_limit = ms.window.dict_limit;
    ms.next_to_update = ms.window.dict_limit;
    Ok(BlockSrc {
        base: src.base.wrapping_sub(src_size),
        ..*src
    })
}

/// `ZSTD_compressBlock_btultra2`
fn compress_block_btultra2(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let curr = src.index_of(src.start);

    // The first block is parsed twice, the first time to collect statistics for the second. Since the first pass is
    // then forgotten, nothing must be in the tables before it: no dictionary, no prefix, no long distance matching.
    if ms.opt.lit_length_sum == 0
        && seq_store.sequences.is_empty()
        && ms.window.dict_limit == ms.window.low_limit
        && curr == ms.window.dict_limit
        && src.end - src.start > ZSTD_PREDEF_THRESHOLD
    {
        let src = init_stats_ultra(ms, seq_store, rep, src)?;
        return compress_block_opt2(ms, seq_store, rep, &src, DictMode::NoDict);
    }

    compress_block_opt2(ms, seq_store, rep, src, DictMode::NoDict)
}

/// `ZSTD_compressBlock_btopt`, `ZSTD_compressBlock_btultra`, `ZSTD_compressBlock_btultra2` and their `_dictMatchState`
/// and `_extDict` variants. With a dictionary of either kind, `btultra2` is `btultra`.
///
/// `btultra2` can move `ms.window.base`, which `src.base` comes from.
pub(crate) fn compress_block_opt(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    strategy: Strategy,
    dict_mode: DictMode,
) -> Result<usize> {
    match (strategy, dict_mode) {
        (Strategy::BtUltra2, DictMode::NoDict) => compress_block_btultra2(ms, seq_store, rep, src),
        (Strategy::BtUltra | Strategy::BtUltra2, _) => {
            compress_block_opt2(ms, seq_store, rep, src, dict_mode)
        }
        _ => compress_block_opt0(ms, seq_store, rep, src, dict_mode),
    }
}
