//! `zstd_opt.c`: the `btopt`, `btultra` and `btultra2` strategies, which look for the cheapest parse.

use core::mem;

use super::hist;
use super::huf::HufRepeat;
use super::internal::{
    BlockSrc, DictMode, EntropyCTables, Match, MatchState, OptPrice, OptState, Optimal,
    ParamSwitch, Prefix, RawSeq, RawSeqStore, SeqStore, Strategy, ZSTD_OPT_NUM, count,
    count_2segments, hash_ptr, hash3_ptr, index_overlap_check, ll_code, ml_code, new_rep,
    offset_to_offbase,
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

/// `ZSTD_setBasePrices`
#[inline(always)]
fn set_base_prices(opt_ptr: &mut OptState, opt_level: i32) {
    if compressed_literals(opt_ptr) {
        opt_ptr.lit_sum_base_price = weight(opt_ptr.lit_sum, opt_level);
    }
    opt_ptr.lit_length_sum_base_price = weight(opt_ptr.lit_length_sum, opt_level);
    opt_ptr.match_length_sum_base_price = weight(opt_ptr.match_length_sum, opt_level);
    opt_ptr.off_code_sum_base_price = weight(opt_ptr.off_code_sum, opt_level);
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
        // At least 1, to have a cost.
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
fn rescale_freqs(
    opt_ptr: &mut OptState,
    symbol_costs: &EntropyCTables,
    src: &[u8],
    opt_level: i32,
) -> Result<()> {
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
    opt_ptr.price_type = OptPrice::Dynamic;

    if opt_ptr.lit_length_sum == 0 {
        if src.len() <= ZSTD_PREDEF_THRESHOLD {
            opt_ptr.price_type = OptPrice::Predef;
        }

        if symbol_costs.huf.repeat_mode == HufRepeat::Valid {
            // A Huffman table that has all the values is presumed to come from a dictionary.
            opt_ptr.price_type = OptPrice::Dynamic;

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

    set_base_prices(opt_ptr, opt_level);
    Ok(())
}

/// `ZSTD_rawLiteralsCost`: the price of `literals`, without that of their length.
#[inline(always)]
fn raw_literals_cost(literals: &[u8], opt_ptr: &OptState, opt_level: i32) -> Result<u32> {
    let lit_length = literals.len() as u32;
    if lit_length == 0 {
        return Ok(0);
    }

    if !compressed_literals(opt_ptr) {
        // 8 bits per literal.
        return Ok((lit_length << 3).wrapping_mul(BITCOST_MULTIPLIER));
    }

    if opt_ptr.price_type == OptPrice::Predef {
        // 6 bits per literal.
        return Ok(lit_length.wrapping_mul(6).wrapping_mul(BITCOST_MULTIPLIER));
    }

    let mut price = opt_ptr.lit_sum_base_price.wrapping_mul(lit_length);
    let lit_price_max = opt_ptr.lit_sum_base_price.wrapping_sub(BITCOST_MULTIPLIER);
    for &literal in literals {
        let lit_price = weight(opt_ptr.lit_freq.at(usize::from(literal))?, opt_level);
        price = price.wrapping_sub(lit_price.min(lit_price_max));
    }
    Ok(price)
}

/// `ZSTD_litLengthPrice`: the price of the symbol for a length of literals.
#[inline(always)]
fn lit_length_price(lit_length: u32, opt_ptr: &OptState, opt_level: i32) -> Result<u32> {
    if opt_ptr.price_type == OptPrice::Predef {
        return Ok(weight(lit_length, opt_level));
    }

    // The format has no code for the length of a whole block of the largest size, which is then all literals. It is
    // made to cost 1 bit more than the length before it.
    let (lit_length, extra) = if lit_length == ZSTD_BLOCKSIZE_MAX as u32 {
        (ZSTD_BLOCKSIZE_MAX as u32 - 1, BITCOST_MULTIPLIER)
    } else {
        (lit_length, 0)
    };

    let ll_code = ll_code(lit_length) as usize;
    Ok(extra
        .wrapping_add(u32::from(LL_BITS.at(ll_code)?) * BITCOST_MULTIPLIER)
        .wrapping_add(opt_ptr.lit_length_sum_base_price)
        .wrapping_sub(weight(opt_ptr.lit_length_freq.at(ll_code)?, opt_level)))
}

/// `ZSTD_getMatchPrice`, the price of the offset and of the match length of a sequence, in two parts to add up: all the
/// lengths of a match are priced, with the same offset.
///
/// This is the part for the offset. `off_base` is as in [`SeqStore::store_seq`]. Below level 2, it favours small
/// offsets, which are faster to decompress.
#[inline(always)]
fn offset_price(off_base: u32, opt_ptr: &OptState, opt_level: i32) -> Result<u32> {
    let off_code = highbit32(off_base);
    if opt_ptr.price_type == OptPrice::Predef {
        return Ok((16 + off_code) * BITCOST_MULTIPLIER);
    }

    let off_code_weight = weight(opt_ptr.off_code_freq.at(off_code as usize)?, opt_level);
    let mut price = (off_code * BITCOST_MULTIPLIER).wrapping_add(
        opt_ptr
            .off_code_sum_base_price
            .wrapping_sub(off_code_weight),
    );
    if opt_level < 2 && off_code >= 20 {
        price = price.wrapping_add((off_code - 19) * 2 * BITCOST_MULTIPLIER);
    }
    // Matches cost a bit more, to have fewer sequences, which is faster to decompress.
    Ok(price.wrapping_add(BITCOST_MULTIPLIER / 5))
}

/// The part of `ZSTD_getMatchPrice` for the length. It keeps the price of the last code, which many lengths share.
struct MatchLengthPrice<'a> {
    opt_ptr: &'a OptState,
    opt_level: i32,
    last: Option<CodePrice>,
}

#[derive(Clone, Copy)]
struct CodePrice {
    ml_code: u32,
    price: u32,
}

impl<'a> MatchLengthPrice<'a> {
    const fn new(opt_ptr: &'a OptState, opt_level: i32) -> Self {
        Self {
            opt_ptr,
            opt_level,
            last: None,
        }
    }

    #[inline(always)]
    fn of(&mut self, match_length: u32) -> Result<u32> {
        let ml_base = match_length.wrapping_sub(MINMATCH);
        if self.opt_ptr.price_type == OptPrice::Predef {
            return Ok(weight(ml_base, self.opt_level));
        }

        let ml_code = ml_code(ml_base);
        if let Some(last) = self.last
            && last.ml_code == ml_code
        {
            return Ok(last.price);
        }
        let freq = self.opt_ptr.match_length_freq.at(ml_code as usize)?;
        let price = (u32::from(ML_BITS.at(ml_code as usize)?) * BITCOST_MULTIPLIER)
            .wrapping_add(self.opt_ptr.match_length_sum_base_price)
            .wrapping_sub(weight(freq, self.opt_level));
        self.last = Some(CodePrice { ml_code, price });
        Ok(price)
    }
}

/// `ZSTD_updateStats`
#[inline(always)]
fn update_stats(
    opt_ptr: &mut OptState,
    literals: &[u8],
    off_base: u32,
    match_length: u32,
) -> Result<()> {
    #[inline(always)]
    fn increment(freqs: &mut [u32], code: u32, sum: &mut u32) -> Result<()> {
        let freq = freqs.at_mut(code as usize)?;
        *freq = freq.wrapping_add(1);
        *sum = sum.wrapping_add(1);
        Ok(())
    }

    let lit_length = literals.len() as u32;
    if compressed_literals(opt_ptr) {
        for &literal in literals {
            let freq = opt_ptr.lit_freq.at_mut(usize::from(literal))?;
            *freq = freq.wrapping_add(ZSTD_LITFREQ_ADD);
        }
        opt_ptr.lit_sum = opt_ptr
            .lit_sum
            .wrapping_add(lit_length.wrapping_mul(ZSTD_LITFREQ_ADD));
    }

    increment(
        &mut opt_ptr.lit_length_freq,
        ll_code(lit_length),
        &mut opt_ptr.lit_length_sum,
    )?;
    increment(
        &mut opt_ptr.off_code_freq,
        highbit32(off_base),
        &mut opt_ptr.off_code_sum,
    )?;
    increment(
        &mut opt_ptr.match_length_freq,
        ml_code(match_length.wrapping_sub(MINMATCH)),
        &mut opt_ptr.match_length_sum,
    )
}

/// `ZSTD_readMINMATCH`: `length` bytes, 3 or 4, to compare with others. Reads 4.
#[inline(always)]
fn read_minmatch(buf: &[u8], pos: usize, length: u32) -> Result<u32> {
    let value = read_le32(buf, pos)?;
    Ok(if length == 3 { value << 8 } else { value })
}

/// `ZSTD_insertAndFindFirstIndexHash3`: indexes the 3-byte hashes up to `ip`, which is not included, and looks it up.
/// All of it is in the current segment.
fn insert_and_find_first_index_hash3(
    ms: &mut MatchState,
    next_to_update3: &mut u32,
    prefix: Prefix<'_>,
    ip: usize,
) -> Result<u32> {
    let hash_table3 = ms.hash_table3.as_mut_slice();
    let hash_log3 = ms.hash_log3;
    let target = prefix.index_of(ip);
    let hash3 = hash3_ptr(prefix.buf, ip, hash_log3)?;

    for idx in *next_to_update3..target {
        hash_table3.put(hash3_ptr(prefix.buf, prefix.pos_of(idx), hash_log3)?, idx)?;
    }

    *next_to_update3 = target;
    hash_table3.at(hash3)
}

// ── binary tree search ────────────────────────────────────────────────────

/// `*ptr = value`, where `ptr` is an element of `bt`, or `None` for a place that nothing reads.
#[inline(always)]
fn store(bt: &mut [u32], ptr: Option<usize>, value: u32) -> Result<()> {
    match ptr {
        Some(ptr) => bt.put(ptr, value),
        None => Ok(()),
    }
}

/// `ZSTD_insertBt1`: adds the position `ip`, which is at most `iend - 8`, to the tree. `target` is up to where the
/// caller is filling it, and `dict` the older segment, which is looked at if `ext_dict`. Returns how many positions
/// to move forward.
#[inline(always)]
fn insert_bt1(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    dict: Prefix<'_>,
    ip: usize,
    iend: usize,
    target: u32,
    mls: u32,
    ext_dict: bool,
) -> Result<u32> {
    let c_params = ms.c_params;
    let h = hash_ptr(prefix.buf, ip, c_params.hash_log, mls)?;
    let bt_log = c_params.chain_log.wrapping_sub(1);
    let bt_mask = 1u32.wrapping_shl(bt_log).wrapping_sub(1);
    let mut common_length_smaller = 0usize;
    let mut common_length_larger = 0usize;
    let dict_limit = ms.window.dict_limit;
    let dict_end = dict.pos_of(dict_limit);
    let prefix_start = prefix.pos_of(dict_limit);
    let curr = prefix.index_of(ip);
    let bt_low = curr.saturating_sub(bt_mask);
    let mut smaller_ptr = Some(2 * (curr & bt_mask) as usize);
    let mut larger_ptr = Some(2 * (curr & bt_mask) as usize + 1);
    // Only the positions that are still in the window once the tree is filled are of use.
    let window_low = ms.get_lowest_match_index(target, c_params.window_log);
    let mut match_end_idx = curr.wrapping_add(8 + 1);
    let mut best_length = 8usize;
    let mut nb_compares = 1u32.wrapping_shl(c_params.search_log);

    let bt = ms.chain_table.as_mut_slice();
    let hash_entry = ms.hash_table.at_mut(h)?;
    let mut match_index = *hash_entry;
    *hash_entry = curr;

    while nb_compares != 0 && match_index >= window_low {
        let next_ptr = 2 * (match_index & bt_mask) as usize;
        // What is sure to be common.
        let mut match_length = common_length_smaller.min(common_length_larger);

        // A position of the older segment, as one of the current segment, only makes sense with a length that
        // brings it there.
        let mut match_buf = prefix.buf;
        let mut match_pos = prefix.pos_of(match_index);
        if !ext_dict || match_index as usize + match_length >= dict_limit as usize {
            match_length += count(
                prefix.buf,
                ip + match_length,
                match_buf,
                match_pos.wrapping_add(match_length),
                iend,
            )?;
        } else {
            match_length += count_2segments(
                prefix.buf,
                ip + match_length,
                dict.buf,
                dict.pos_of(match_index) + match_length,
                iend,
                dict_end,
                prefix_start,
            )?;
            if (match_index as usize + match_length) < dict_limit as usize {
                match_buf = dict.buf;
                match_pos = dict.pos_of(match_index);
            }
        }

        if match_length > best_length {
            best_length = match_length;
            if match_length > match_end_idx.wrapping_sub(match_index) as usize {
                match_end_idx = match_index.wrapping_add(match_length as u32);
            }
        }

        if ip + match_length == iend {
            // They are equal: there is no telling which is smaller. Dropping it keeps the tree consistent.
            break;
        }

        if match_buf.at(match_pos.wrapping_add(match_length))? < prefix.buf.at(ip + match_length)? {
            // All the smaller ones will have at least this much in common.
            store(bt, smaller_ptr, match_index)?;
            common_length_smaller = match_length;
            if match_index <= bt_low {
                // Beyond the tree.
                smaller_ptr = None;
                break;
            }
            smaller_ptr = Some(next_ptr + 1);
            match_index = bt.at(next_ptr + 1)?;
        } else {
            store(bt, larger_ptr, match_index)?;
            common_length_larger = match_length;
            if match_index <= bt_low {
                larger_ptr = None;
                break;
            }
            larger_ptr = Some(next_ptr);
            match_index = bt.at(next_ptr)?;
        }
        nb_compares -= 1;
    }

    store(bt, smaller_ptr, 0)?;
    store(bt, larger_ptr, 0)?;

    let positions = if best_length > 384 {
        192.min((best_length - 384) as u32)
    } else {
        0
    };
    Ok(positions.max(match_end_idx.wrapping_sub(curr.wrapping_add(8))))
}

/// `ZSTD_updateTree_internal`
#[inline(always)]
fn update_tree_internal(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    dict: Prefix<'_>,
    ip: usize,
    iend: usize,
    mls: u32,
    dict_mode: DictMode,
) -> Result<()> {
    let target = prefix.index_of(ip);
    let mut idx = ms.next_to_update;

    while idx < target {
        let forward = insert_bt1(
            ms,
            prefix,
            dict,
            prefix.pos_of(idx),
            iend,
            target,
            mls,
            dict_mode == DictMode::ExtDict,
        )?;
        idx = idx.wrapping_add(forward);
    }
    ms.next_to_update = target;
    Ok(())
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
    update_tree_internal(ms, prefix, no_dict, ip, iend, mls, DictMode::NoDict)
}

/// `ZSTD_insertBtAndGetAllMatches`: adds the position `ip` to the tree, and stores in `matches` the matches found on
/// the way, each longer than the one before and all at least `length_to_beat` long. `ll0` is whether no literals
/// come before `ip`. Returns how many there are.
#[inline(always)]
fn insert_bt_and_get_all_matches(
    matches: &mut [Match],
    ms: &mut MatchState,
    next_to_update3: &mut u32,
    src: &BlockSrc<'_>,
    ip: usize,
    i_limit: usize,
    dict_mode: DictMode,
    rep: &[u32; ZSTD_REP_NUM],
    ll0: bool,
    length_to_beat: u32,
    mls: u32,
) -> Result<u32> {
    let buf = src.buf;
    let c_params = ms.c_params;
    let sufficient_len = c_params.target_length.min(ZSTD_OPT_NUM as u32 - 1);
    let curr = src.index_of(ip);
    let min_match = if mls == 3 { 3 } else { 4 };
    let h = hash_ptr(buf, ip, c_params.hash_log, mls)?;
    let bt_log = c_params.chain_log.wrapping_sub(1);
    let bt_mask = 1u32.wrapping_shl(bt_log).wrapping_sub(1);
    let mut common_length_smaller = 0usize;
    let mut common_length_larger = 0usize;
    let dict_limit = ms.window.dict_limit;
    let dict_end = src.dict_pos_of(dict_limit);
    let prefix_start = src.pos_of(dict_limit);
    let bt_low = curr.saturating_sub(bt_mask);
    let window_low = ms.get_lowest_match_index(curr, c_params.window_log);
    let match_low = window_low.max(1);
    let mut smaller_ptr = Some(2 * (curr & bt_mask) as usize);
    let mut larger_ptr = Some(2 * (curr & bt_mask) as usize + 1);
    // The farthest position any match refers to, which detects repetitive patterns.
    let mut match_end_idx = curr.wrapping_add(8 + 1);
    let mut mnum = 0u32;
    let mut nb_compares = 1u32.wrapping_shl(c_params.search_log);

    let dms = if dict_mode == DictMode::DictMatchState {
        Some(src.dms.ok_or(BUG)?)
    } else {
        None
    };
    let dms_high_limit = dms.map_or(0, |dms| dms.end.wrapping_sub(dms.base) as u32);
    let dms_low_limit = dms.map_or(0, |dms| dms.ms.window.low_limit);
    let dms_index_delta = dms.map_or(0, |_| window_low.wrapping_sub(dms_high_limit));

    let mut best_length = length_to_beat.wrapping_sub(1) as usize;

    // The repeat offsets.
    let ll0 = u32::from(ll0);
    let [rep0, _, _] = *rep;
    for rep_code in ll0..ZSTD_REP_NUM as u32 + ll0 {
        let rep_offset = match rep.get(rep_code as usize) {
            Some(&offset) => offset,
            None => rep0.wrapping_sub(1),
        };
        let rep_index = curr.wrapping_sub(rep_offset);
        let mut rep_len = 0u32;
        // The subtraction wraps around to discard 0 and -1: `curr > rep_index >= dict_limit`.
        if rep_offset.wrapping_sub(1) < curr.wrapping_sub(dict_limit) {
            // With a dictionary, the range of valid offsets shrinks when the dictionary gets out of reach.
            let rep_match = ip.wrapping_sub(rep_offset as usize);
            if rep_index >= window_low
                && read_minmatch(buf, ip, min_match)? == read_minmatch(buf, rep_match, min_match)?
            {
                rep_len = count(
                    buf,
                    ip + min_match as usize,
                    buf,
                    rep_match + min_match as usize,
                    i_limit,
                )? as u32
                    + min_match;
            }
        } else if dict_mode == DictMode::ExtDict {
            // `curr > rep_index >= window_low`
            if rep_offset.wrapping_sub(1) < curr.wrapping_sub(window_low)
                && index_overlap_check(dict_limit, rep_index)
            {
                let rep_match = src.dict_pos_of(rep_index);
                if read_minmatch(buf, ip, min_match)?
                    == read_minmatch(src.dict_buf, rep_match, min_match)?
                {
                    rep_len = count_2segments(
                        buf,
                        ip + min_match as usize,
                        src.dict_buf,
                        rep_match + min_match as usize,
                        i_limit,
                        dict_end,
                        prefix_start,
                    )? as u32
                        + min_match;
                }
            }
        } else if let Some(dms) = dms {
            // `curr > rep_index >= dms_low_limit`
            if rep_offset.wrapping_sub(1)
                < curr.wrapping_sub(dms_low_limit.wrapping_add(dms_index_delta))
                && index_overlap_check(dict_limit, rep_index)
            {
                let rep_match = dms.pos_of(rep_index.wrapping_sub(dms_index_delta));
                if read_minmatch(buf, ip, min_match)?
                    == read_minmatch(dms.buf, rep_match, min_match)?
                {
                    rep_len = count_2segments(
                        buf,
                        ip + min_match as usize,
                        dms.buf,
                        rep_match + min_match as usize,
                        i_limit,
                        dms.end,
                        prefix_start,
                    )? as u32
                        + min_match;
                }
            }
        }
        if rep_len as usize > best_length {
            best_length = rep_len as usize;
            matches.put(
                mnum as usize,
                Match {
                    off: rep_code - ll0 + 1,
                    len: rep_len,
                },
            )?;
            mnum += 1;
            if rep_len > sufficient_len || ip + rep_len as usize == i_limit {
                // The best there can be.
                return Ok(mnum);
            }
        }
    }

    // The table of 3-byte hashes. That of a dictionary is not filled.
    if mls == 3 && best_length < mls as usize {
        let match_index3 =
            insert_and_find_first_index_hash3(ms, next_to_update3, src.prefix(), ip)?;
        // Farther than that is likely to cost too much.
        if match_index3 >= match_low && curr.wrapping_sub(match_index3) < (1 << 18) {
            let mlen = if dict_mode != DictMode::ExtDict || match_index3 >= dict_limit {
                count(buf, ip, buf, src.pos_of(match_index3), i_limit)?
            } else {
                count_2segments(
                    buf,
                    ip,
                    src.dict_buf,
                    src.dict_pos_of(match_index3),
                    i_limit,
                    dict_end,
                    prefix_start,
                )?
            };

            if mlen >= mls as usize {
                best_length = mlen;
                matches.put(
                    0,
                    Match {
                        off: offset_to_offbase(curr.wrapping_sub(match_index3)),
                        len: mlen as u32,
                    },
                )?;
                mnum = 1;
                if mlen > sufficient_len as usize || ip + mlen == i_limit {
                    // The best there can be: `ip` is not inserted.
                    ms.next_to_update = curr.wrapping_add(1);
                    return Ok(1);
                }
            }
        }
    }

    let bt = ms.chain_table.as_mut_slice();
    let hash_entry = ms.hash_table.at_mut(h)?;
    let mut match_index = *hash_entry;
    *hash_entry = curr;

    while nb_compares != 0 && match_index >= match_low {
        let next_ptr = 2 * (match_index & bt_mask) as usize;
        // What is sure to be common.
        let mut match_length = common_length_smaller.min(common_length_larger);

        // A position of the older segment, as one of the current segment, only makes sense with a length that
        // brings it there.
        let mut match_buf = buf;
        let mut match_pos = src.pos_of(match_index);
        if dict_mode != DictMode::ExtDict
            || match_index as usize + match_length >= dict_limit as usize
        {
            match_length += count(
                buf,
                ip + match_length,
                match_buf,
                match_pos.wrapping_add(match_length),
                i_limit,
            )?;
        } else {
            match_length += count_2segments(
                buf,
                ip + match_length,
                src.dict_buf,
                src.dict_pos_of(match_index) + match_length,
                i_limit,
                dict_end,
                prefix_start,
            )?;
            if (match_index as usize + match_length) < dict_limit as usize {
                match_buf = src.dict_buf;
                match_pos = src.dict_pos_of(match_index);
            }
        }

        if match_length > best_length {
            if match_length > match_end_idx.wrapping_sub(match_index) as usize {
                match_end_idx = match_index.wrapping_add(match_length as u32);
            }
            best_length = match_length;
            matches.put(
                mnum as usize,
                Match {
                    off: offset_to_offbase(curr.wrapping_sub(match_index)),
                    len: match_length as u32,
                },
            )?;
            mnum += 1;
            if match_length > ZSTD_OPT_NUM || ip + match_length == i_limit {
                // If they are equal, there is no telling which is smaller. Dropping it keeps the tree consistent.
                if dict_mode == DictMode::DictMatchState {
                    // The dictionary is not to be searched either.
                    nb_compares = 0;
                }
                break;
            }
        }

        if match_buf.at(match_pos.wrapping_add(match_length))? < buf.at(ip + match_length)? {
            // All the smaller ones will have at least this much in common.
            store(bt, smaller_ptr, match_index)?;
            common_length_smaller = match_length;
            if match_index <= bt_low {
                // Beyond the tree.
                smaller_ptr = None;
                break;
            }
            smaller_ptr = Some(next_ptr + 1);
            match_index = bt.at(next_ptr + 1)?;
        } else {
            store(bt, larger_ptr, match_index)?;
            common_length_larger = match_length;
            if match_index <= bt_low {
                larger_ptr = None;
                break;
            }
            larger_ptr = Some(next_ptr);
            match_index = bt.at(next_ptr)?;
        }
        nb_compares -= 1;
    }

    store(bt, smaller_ptr, 0)?;
    store(bt, larger_ptr, 0)?;

    if let Some(dms) = dms
        && nb_compares != 0
    {
        let dms_c_params = &dms.ms.c_params;
        let dms_bt_log = dms_c_params.chain_log.wrapping_sub(1);
        let dms_bt_mask = 1u32.wrapping_shl(dms_bt_log).wrapping_sub(1);
        let dms_bt_low = if dms_bt_mask < dms_high_limit.wrapping_sub(dms_low_limit) {
            dms_high_limit.wrapping_sub(dms_bt_mask)
        } else {
            dms_low_limit
        };
        let dms_h = hash_ptr(buf, ip, dms_c_params.hash_log, mls)?;
        let mut dict_match_index = dms.ms.hash_table.at(dms_h)?;
        let dms_bt = dms.ms.chain_table.as_slice();
        common_length_smaller = 0;
        common_length_larger = 0;
        while nb_compares != 0 && dict_match_index > dms_low_limit {
            let next_ptr = 2 * (dict_match_index & dms_bt_mask) as usize;
            let mut match_length = common_length_smaller.min(common_length_larger);
            match_length += count_2segments(
                buf,
                ip + match_length,
                dms.buf,
                dms.pos_of(dict_match_index) + match_length,
                i_limit,
                dms.end,
                prefix_start,
            )?;

            if match_length > best_length {
                match_index = dict_match_index.wrapping_add(dms_index_delta);
                if match_length > match_end_idx.wrapping_sub(match_index) as usize {
                    match_end_idx = match_index.wrapping_add(match_length as u32);
                }
                best_length = match_length;
                matches.put(
                    mnum as usize,
                    Match {
                        off: offset_to_offbase(curr.wrapping_sub(match_index)),
                        len: match_length as u32,
                    },
                )?;
                mnum += 1;
                if match_length > ZSTD_OPT_NUM || ip + match_length == i_limit {
                    break;
                }
            }

            if dict_match_index <= dms_bt_low {
                // Beyond the tree.
                break;
            }
            // A match that reaches the end of the dictionary goes on at the start of the current segment.
            let match_byte = if dict_match_index as usize + match_length >= dms_high_limit as usize
            {
                let match_pos = src.pos_of(dict_match_index.wrapping_add(dms_index_delta));
                buf.at(match_pos.wrapping_add(match_length))?
            } else {
                dms.buf.at(dms.pos_of(dict_match_index) + match_length)?
            };
            if match_byte < buf.at(ip + match_length)? {
                common_length_smaller = match_length;
                dict_match_index = dms_bt.at(next_ptr + 1)?;
            } else {
                common_length_larger = match_length;
                dict_match_index = dms_bt.at(next_ptr)?;
            }
            nb_compares -= 1;
        }
    }

    // Repetitive patterns are skipped.
    ms.next_to_update = match_end_idx.wrapping_sub(8);
    Ok(mnum)
}

/// `ZSTD_getAllMatchesFn`: the arguments are `matches`, `ms`, `next_to_update3`, `src`, `ip`, `i_high_limit`, `rep`,
/// `ll0` and `length_to_beat`.
type GetAllMatchesFn = fn(
    &mut [Match],
    &mut MatchState,
    &mut u32,
    &BlockSrc<'_>,
    usize,
    usize,
    &[u32; ZSTD_REP_NUM],
    bool,
    u32,
) -> Result<u32>;

/// `ZSTD_btGetAllMatches_internal`
#[inline(always)]
fn bt_get_all_matches_internal(
    matches: &mut [Match],
    ms: &mut MatchState,
    next_to_update3: &mut u32,
    src: &BlockSrc<'_>,
    ip: usize,
    i_high_limit: usize,
    rep: &[u32; ZSTD_REP_NUM],
    ll0: bool,
    length_to_beat: u32,
    dict_mode: DictMode,
    mls: u32,
) -> Result<u32> {
    if src.index_of(ip) < ms.next_to_update {
        // An area that is skipped.
        return Ok(0);
    }
    let dict = Prefix {
        buf: src.dict_buf,
        base: src.dict_base,
    };
    update_tree_internal(ms, src.prefix(), dict, ip, i_high_limit, mls, dict_mode)?;
    insert_bt_and_get_all_matches(
        matches,
        ms,
        next_to_update3,
        src,
        ip,
        i_high_limit,
        dict_mode,
        rep,
        ll0,
        length_to_beat,
        mls,
    )
}

/// `ZSTD_btGetAllMatches_noDict_3` to `ZSTD_btGetAllMatches_noDict_6`
fn bt_get_all_matches_no_dict<const MLS: u32>(
    matches: &mut [Match],
    ms: &mut MatchState,
    next_to_update3: &mut u32,
    src: &BlockSrc<'_>,
    ip: usize,
    i_high_limit: usize,
    rep: &[u32; ZSTD_REP_NUM],
    ll0: bool,
    length_to_beat: u32,
) -> Result<u32> {
    bt_get_all_matches_internal(
        matches,
        ms,
        next_to_update3,
        src,
        ip,
        i_high_limit,
        rep,
        ll0,
        length_to_beat,
        DictMode::NoDict,
        MLS,
    )
}

/// `ZSTD_btGetAllMatches_extDict_3` to `ZSTD_btGetAllMatches_extDict_6`
fn bt_get_all_matches_ext_dict<const MLS: u32>(
    matches: &mut [Match],
    ms: &mut MatchState,
    next_to_update3: &mut u32,
    src: &BlockSrc<'_>,
    ip: usize,
    i_high_limit: usize,
    rep: &[u32; ZSTD_REP_NUM],
    ll0: bool,
    length_to_beat: u32,
) -> Result<u32> {
    bt_get_all_matches_internal(
        matches,
        ms,
        next_to_update3,
        src,
        ip,
        i_high_limit,
        rep,
        ll0,
        length_to_beat,
        DictMode::ExtDict,
        MLS,
    )
}

/// `ZSTD_btGetAllMatches_dictMatchState_3` to `ZSTD_btGetAllMatches_dictMatchState_6`
fn bt_get_all_matches_dict_match_state<const MLS: u32>(
    matches: &mut [Match],
    ms: &mut MatchState,
    next_to_update3: &mut u32,
    src: &BlockSrc<'_>,
    ip: usize,
    i_high_limit: usize,
    rep: &[u32; ZSTD_REP_NUM],
    ll0: bool,
    length_to_beat: u32,
) -> Result<u32> {
    bt_get_all_matches_internal(
        matches,
        ms,
        next_to_update3,
        src,
        ip,
        i_high_limit,
        rep,
        ll0,
        length_to_beat,
        DictMode::DictMatchState,
        MLS,
    )
}

/// `ZSTD_selectBtGetAllMatches`
fn select_bt_get_all_matches(ms: &MatchState, dict_mode: DictMode) -> GetAllMatchesFn {
    match (dict_mode, ms.c_params.min_match) {
        (DictMode::NoDict, ..=3) => bt_get_all_matches_no_dict::<3>,
        (DictMode::NoDict, 4) => bt_get_all_matches_no_dict::<4>,
        (DictMode::NoDict, 5) => bt_get_all_matches_no_dict::<5>,
        (DictMode::NoDict, 6..) => bt_get_all_matches_no_dict::<6>,
        (DictMode::ExtDict, ..=3) => bt_get_all_matches_ext_dict::<3>,
        (DictMode::ExtDict, 4) => bt_get_all_matches_ext_dict::<4>,
        (DictMode::ExtDict, 5) => bt_get_all_matches_ext_dict::<5>,
        (DictMode::ExtDict, 6..) => bt_get_all_matches_ext_dict::<6>,
        (DictMode::DictMatchState, ..=3) => bt_get_all_matches_dict_match_state::<3>,
        (DictMode::DictMatchState, 4) => bt_get_all_matches_dict_match_state::<4>,
        (DictMode::DictMatchState, 5) => bt_get_all_matches_dict_match_state::<5>,
        (DictMode::DictMatchState, 6..) => bt_get_all_matches_dict_match_state::<6>,
    }
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
        if self.pos >= self.seq.len() {
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

/// `LIT_PRICE`: the price of the literal at `pos`.
#[inline(always)]
fn lit_price(buf: &[u8], pos: usize, opt_ptr: &OptState, opt_level: i32) -> Result<i32> {
    Ok(raw_literals_cost(buf.span(pos, 1)?, opt_ptr, opt_level)? as i32)
}

/// `LL_PRICE`
#[inline(always)]
fn ll_price(lit_length: u32, opt_ptr: &OptState, opt_level: i32) -> Result<i32> {
    Ok(lit_length_price(lit_length, opt_ptr, opt_level)? as i32)
}

/// `LL_INCPRICE`: what one more literal, which makes `lit_length` of them, adds to the price of their length.
#[inline(always)]
fn ll_inc_price(lit_length: u32, opt_ptr: &OptState, opt_level: i32) -> Result<i32> {
    Ok(
        ll_price(lit_length, opt_ptr, opt_level)?.wrapping_sub(ll_price(
            lit_length.wrapping_sub(1),
            opt_ptr,
            opt_level,
        )?),
    )
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
    // The match finders borrow the whole of `ms`.
    let mut price_table = mem::take(&mut ms.opt.price_table);
    let mut match_table = mem::take(&mut ms.opt.match_table);
    let result = parse_block(
        ms,
        seq_store,
        rep,
        src,
        &mut price_table,
        &mut match_table,
        opt_level,
        dict_mode,
    );
    ms.opt.price_table = price_table;
    ms.opt.match_table = match_table;
    result
}

/// The body of `ZSTD_compressBlock_opt_generic`. `opt` is `ms.opt.price_table` and `matches` is `ms.opt.match_table`.
#[inline(always)]
fn parse_block(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    opt: &mut [Optimal],
    matches: &mut [Match],
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

    let get_all_matches = select_bt_get_all_matches(ms, dict_mode);

    let sufficient_len = ms.c_params.target_length.min(ZSTD_OPT_NUM as u32 - 1);
    let min_match = if ms.c_params.min_match == 3 { 3 } else { 4 };
    let mut next_to_update3 = ms.next_to_update;

    let mut last_stretch = Optimal::default();
    let mut opt_ldm = OptLdm::new(src.ldm_seq_store);
    opt_ldm.get_next_match_and_update_seq_store(0, (iend - ip) as u32);

    rescale_freqs(
        &mut ms.opt,
        src.symbol_costs,
        buf.sub(istart..iend)?,
        opt_level,
    )?;
    ip += usize::from(ip == prefix_start);

    'series: while ip < ilimit {
        let mut last_pos: u32;

        // The forward pass. `opt` holds stretches, each a match followed by literals, unlike a sequence, which is
        // literals followed by a match: that way each position of a run of literals can have another match before it.
        // It ends with the last stretch in `last_stretch`, which starts at `cur` and ends at `last_pos`.
        let mut cur = 'forward: {
            // Find a first match.
            {
                let litlen = (ip - anchor) as u32;
                let mut nb_matches = get_all_matches(
                    matches,
                    ms,
                    &mut next_to_update3,
                    src,
                    ip,
                    iend,
                    rep,
                    litlen == 0,
                    min_match,
                )?;
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
                let first_price = ll_price(litlen, &ms.opt, opt_level)?;
                {
                    let first = opt.at_mut(0)?;
                    first.mlen = 0;
                    first.litlen = litlen;
                    first.price = first_price;
                    first.rep = *rep;
                }

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
                let ll0_price = ll_price(0, &ms.opt, opt_level)?;
                let mut pos = 1u32;
                while pos < min_match {
                    let stretch = opt.at_mut(pos as usize)?;
                    stretch.price = ZSTD_MAX_PRICE;
                    stretch.mlen = 0;
                    stretch.litlen = litlen.wrapping_add(pos);
                    pos += 1;
                }
                let mut ml_price = MatchLengthPrice::new(&ms.opt, opt_level);
                for candidate in matches {
                    let off_price = offset_price(candidate.off, &ms.opt, opt_level)?;
                    while pos <= candidate.len {
                        let match_price = off_price.wrapping_add(ml_price.of(pos)?) as i32;
                        let sequence_price = first_price.wrapping_add(match_price);
                        let stretch = opt.at_mut(pos as usize)?;
                        stretch.mlen = pos;
                        stretch.off = candidate.off;
                        stretch.litlen = 0;
                        stretch.price = sequence_price.wrapping_add(ll0_price);
                        pos += 1;
                    }
                }
                last_pos = pos - 1;
                opt.at_mut(pos as usize)?.price = ZSTD_MAX_PRICE;
            }

            // Check the positions that follow.
            let mut cur = 0u32;
            while cur < last_pos {
                cur += 1;
                let inr = ip + cur as usize;

                // Get to this position by a literal, if it is cheaper.
                {
                    let before = opt.at(cur as usize - 1)?;
                    let litlen = before.litlen.wrapping_add(1);
                    let price = before
                        .price
                        .wrapping_add(lit_price(buf, inr - 1, &ms.opt, opt_level)?)
                        .wrapping_add(ll_inc_price(litlen, &ms.opt, opt_level)?);
                    let prev_match = opt.at(cur as usize)?;
                    if price <= prev_match.price {
                        opt.put(
                            cur as usize,
                            Optimal {
                                litlen,
                                price,
                                ..before
                            },
                        )?;
                        // If this replaces a match, and 1 literal is cheaper than none, the match followed by a
                        // literal may be a cheaper way to the next position.
                        if opt_level >= 1
                            && prev_match.litlen == 0
                            && ll_inc_price(1, &ms.opt, opt_level)? < 0
                            && inr < iend
                        {
                            let next_lit_price = lit_price(buf, inr, &ms.opt, opt_level)?;
                            let with_1_literal = prev_match
                                .price
                                .wrapping_add(next_lit_price)
                                .wrapping_add(ll_inc_price(1, &ms.opt, opt_level)?);
                            let with_more_literals = price
                                .wrapping_add(next_lit_price)
                                .wrapping_add(ll_inc_price(
                                    litlen.wrapping_add(1),
                                    &ms.opt,
                                    opt_level,
                                )?);
                            if with_1_literal < with_more_literals
                                && with_1_literal < opt.at(cur as usize + 1)?.price
                            {
                                let prev = opt.at(cur.wrapping_sub(prev_match.mlen) as usize)?;
                                opt.put(
                                    cur as usize + 1,
                                    Optimal {
                                        rep: new_rep(&prev.rep, prev_match.off, prev.litlen == 0),
                                        litlen: 1,
                                        price: with_1_literal,
                                        ..prev_match
                                    },
                                )?;
                                last_pos = last_pos.max(cur + 1);
                            }
                        }
                    }
                }

                // The repeat offsets are not updated while matches are compared, but here, now that one is selected.
                let mut here = opt.at(cur as usize)?;
                if here.litlen == 0 {
                    let prev = opt.at(cur.wrapping_sub(here.mlen) as usize)?;
                    here.rep = new_rep(&prev.rep, here.off, prev.litlen == 0);
                    opt.at_mut(cur as usize)?.rep = here.rep;
                }

                // The last match starts at least 8 bytes before the end.
                if inr > ilimit {
                    continue;
                }

                if cur == last_pos {
                    break;
                }

                if opt_level == 0
                    && opt.at(cur as usize + 1)?.price
                        <= here.price.wrapping_add(BITCOST_MULTIPLIER as i32 / 2)
                {
                    // The next position is cheaper to get to: this one is not promising.
                    continue;
                }

                {
                    let base_price = here.price.wrapping_add(ll_price(0, &ms.opt, opt_level)?);
                    let mut nb_matches = get_all_matches(
                        matches,
                        ms,
                        &mut next_to_update3,
                        src,
                        inr,
                        iend,
                        &here.rep,
                        here.litlen == 0,
                        min_match,
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

                    // Set the prices that the matches found here give.
                    let mut start_ml = min_match;
                    let mut ml_price = MatchLengthPrice::new(&ms.opt, opt_level);
                    for candidate in matches {
                        if candidate.len < start_ml {
                            start_ml = candidate.len + 1;
                            continue;
                        }
                        let off_price = offset_price(candidate.off, &ms.opt, opt_level)?;
                        let furthest = cur + candidate.len;
                        // The first position that nothing leads to yet is taken at any price.
                        let mut new = furthest > last_pos;
                        while last_pos < furthest {
                            last_pos += 1;
                            let stretch = opt.at_mut(last_pos as usize)?;
                            stretch.price = ZSTD_MAX_PRICE;
                            // Not 0, which would be the end of a match.
                            stretch.litlen = 1;
                        }

                        // From the longest length to the shortest.
                        let reached = opt.sub_mut((cur + start_ml) as usize..=furthest as usize)?;
                        let lengths = (start_ml..=candidate.len).rev();
                        for (stretch, mlen) in reached.iter_mut().rev().zip(lengths) {
                            let match_price = off_price.wrapping_add(ml_price.of(mlen)?) as i32;
                            let price = base_price.wrapping_add(match_price);
                            if new || price < stretch.price {
                                stretch.mlen = mlen;
                                stretch.off = candidate.off;
                                stretch.litlen = 0;
                                stretch.price = price;
                            } else if opt_level == 0 {
                                // Shorter lengths are not tried.
                                break;
                            }
                            new = false;
                        }
                        start_ml = candidate.len + 1;
                    }
                }
                opt.at_mut(last_pos as usize + 1)?.price = ZSTD_MAX_PRICE;
            }

            last_stretch = opt.at(last_pos as usize)?;
            last_pos.wrapping_sub(last_stretch.mlen)
        };

        if last_stretch.mlen == 0 {
            // All the matches have been turned into literals.
            ip += last_pos as usize;
            continue;
        }

        if last_stretch.litlen == 0 {
            // It ends with a match.
            let prev = opt.at(cur as usize)?;
            *rep = new_rep(&prev.rep, last_stretch.off, prev.litlen == 0);
        } else {
            *rep = last_stretch.rep;
            cur = cur.wrapping_sub(last_stretch.litlen);
        }

        // Write the cheapest path in `opt`, backwards from `store_end`, over the stretches that are not on it, and as
        // sequences. The literals that end the last stretch are in no sequence: they are parsed again. (The C code
        // starts by making them a last sequence without a match, and overwrites it at once.)
        let store_end = cur.wrapping_add(2) as usize;
        let mut store_start = store_end;
        let mut stretch_pos = cur;
        opt.put(store_end, last_stretch)?;
        loop {
            let next_stretch = opt.at(stretch_pos as usize)?;
            opt.at_mut(store_start)?.litlen = next_stretch.litlen;
            if next_stretch.mlen == 0 {
                // The start of the series.
                break;
            }
            store_start = store_start.wrapping_sub(1);
            opt.put(store_start, next_stretch)?;
            stretch_pos =
                stretch_pos.wrapping_sub(next_stretch.litlen.wrapping_add(next_stretch.mlen));
        }

        for sequence in opt.sub(store_start..=store_end)? {
            let llen = sequence.litlen as usize;
            let mlen = sequence.mlen as usize;
            update_stats(
                &mut ms.opt,
                buf.span(anchor, llen)?,
                sequence.off,
                sequence.mlen,
            )?;
            seq_store.store_seq(llen, buf, anchor, sequence.off, mlen)?;
            anchor += llen + mlen;
            ip = anchor;
        }

        set_base_prices(&mut ms.opt, opt_level);
    }

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
