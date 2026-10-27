//! `zstd_compress_sequences.c`: how the sequences of a block are encoded.

use super::fse::{self, FSE_NCOUNTBOUND, FseCState, FseCTable, FseRepeat};
use super::internal::{SeqDef, Strategy};
use crate::common::bitstream::BitCStream;
use crate::common::{
    LL_BITS, LL_FSE_LOG, MAX_SEQ, ML_BITS, ML_FSE_LOG, OFF_FSE_LOG, SymbolEncodingType,
};
use crate::error::{ErrorCode, Result};
use crate::util::SliceExt;

/// `-log2(x / 256)` in units of 1/256 of a bit, for `x` from 1 to 255. The entry for 0 is not used.
#[rustfmt::skip]
static K_INVERSE_PROBABILITY_LOG256: [u32; 256] = [
    0, 2048, 1792, 1642, 1536, 1453, 1386, 1329, 1280, 1236, 1197, 1162, 1130, 1100, 1073, 1047,
    1024, 1001, 980, 960, 941, 923, 906, 889, 874, 859, 844, 830, 817, 804, 791, 779,
    768, 756, 745, 734, 724, 714, 704, 694, 685, 676, 667, 658, 650, 642, 633, 626,
    618, 610, 603, 595, 588, 581, 574, 567, 561, 554, 548, 542, 535, 529, 523, 517,
    512, 506, 500, 495, 489, 484, 478, 473, 468, 463, 458, 453, 448, 443, 438, 434,
    429, 424, 420, 415, 411, 407, 402, 398, 394, 390, 386, 382, 377, 373, 370, 366,
    362, 358, 354, 350, 347, 343, 339, 336, 332, 329, 325, 322, 318, 315, 311, 308,
    305, 302, 298, 295, 292, 289, 286, 282, 279, 276, 273, 270, 267, 264, 261, 258,
    256, 253, 250, 247, 244, 241, 239, 236, 233, 230, 228, 225, 222, 220, 217, 215,
    212, 209, 207, 204, 202, 199, 197, 194, 192, 190, 187, 185, 182, 180, 178, 175,
    173, 171, 168, 166, 164, 162, 159, 157, 155, 153, 151, 149, 146, 144, 142, 140,
    138, 136, 134, 132, 130, 128, 126, 123, 121, 119, 117, 115, 114, 112, 110, 108,
    106, 104, 102, 100, 98, 96, 94, 93, 91, 89, 87, 85, 83, 82, 80, 78,
    76, 74, 73, 71, 69, 67, 66, 64, 62, 61, 59, 57, 55, 54, 52, 50,
    49, 47, 46, 44, 42, 41, 39, 37, 36, 34, 33, 31, 30, 28, 26, 25,
    23, 22, 20, 19, 17, 16, 14, 13, 11, 10, 8, 7, 5, 4, 2, 1,
];

/// What the C code has for a cost that could not be computed: an error code, which is more than any cost.
fn cost_or_error(cost: Result<usize>) -> usize {
    cost.unwrap_or_else(|code| 0usize.wrapping_sub(code as usize))
}

/// `ZSTD_useLowProbCount`: with few sequences, counts of -1 hurt more than they help.
const fn use_low_prob_count(nb_seq: usize) -> bool {
    nb_seq >= 2048
}

/// `ZSTD_NCountCost`: how many bytes the header of a table for `count` takes.
fn ncount_cost(count: &[u32], max: u32, nb_seq: usize, fse_log: u32) -> Result<usize> {
    let mut wksp = [0u8; FSE_NCOUNTBOUND];
    let mut norm = [0i16; MAX_SEQ as usize + 1];
    let table_log = fse::optimal_table_log(fse_log, nb_seq, max);
    fse::normalize_count(
        &mut norm,
        table_log,
        count,
        nb_seq,
        max,
        use_low_prob_count(nb_seq),
    )?;
    fse::write_ncount(&mut wksp, &norm, max, table_log)
}

/// `ZSTD_entropyCost`: how many bits it takes to encode the distribution `count`, which adds up to `total`, with a
/// table made for it.
fn entropy_cost(count: &[u32], max: u32, total: usize) -> Result<usize> {
    let mut cost: u32 = 0;
    for &c in count.sub(..=max as usize)? {
        let mut norm = 256u32.wrapping_mul(c) as usize / total.max(1);
        if c != 0 && norm == 0 {
            norm = 1;
        }
        cost = cost.wrapping_add(c.wrapping_mul(K_INVERSE_PROBABILITY_LOG256.at(norm)?));
    }
    Ok((cost >> 8) as usize)
}

/// `ZSTD_fseBitCost`: how many bits it takes to encode the distribution `count` with `ctable`, which is an error if
/// the table lacks one of the symbols.
pub(crate) fn fse_bit_cost(ctable: &FseCTable, count: &[u32], max: u32) -> Result<usize> {
    const K_ACCURACY_LOG: u32 = 8;
    let mut cost: usize = 0;
    if ctable.max_symbol_value < max {
        return Err(ErrorCode::Generic);
    }
    let bad_cost = (ctable.table_log + 1) << K_ACCURACY_LOG;
    for (s, &c) in count.sub(..=max as usize)?.iter().enumerate() {
        if c == 0 {
            continue;
        }
        let bit_cost = ctable.bit_cost(s as u32, K_ACCURACY_LOG);
        if bit_cost >= bad_cost {
            return Err(ErrorCode::Generic);
        }
        cost += c as usize * bit_cost as usize;
    }
    Ok(cost >> K_ACCURACY_LOG)
}

/// `ZSTD_crossEntropyCost`: how many bits it takes to encode the distribution `count` with a table made from `norm`.
pub(crate) fn cross_entropy_cost(
    norm: &[i16],
    accuracy_log: u32,
    count: &[u32],
    max: u32,
) -> Result<usize> {
    let shift = 8 - accuracy_log;
    let mut cost: usize = 0;
    let len = max as usize + 1;
    for (&n, &c) in norm.sub(..len)?.iter().zip(count.sub(..len)?) {
        let norm_acc = if n != -1 { n as u32 } else { 1 };
        let norm256 = norm_acc << shift;
        cost += c.wrapping_mul(K_INVERSE_PROBABILITY_LOG256.at(norm256 as usize)?) as usize;
    }
    Ok(cost >> 8)
}

/// `ZSTD_selectEncodingType`
pub(crate) fn select_encoding_type(
    repeat_mode: &mut FseRepeat,
    count: &[u32],
    max: u32,
    most_frequent: usize,
    nb_seq: usize,
    fse_log: u32,
    prev_ctable: &FseCTable,
    default_norm: &[i16],
    default_norm_log: u32,
    is_default_allowed: bool,
    strategy: Strategy,
) -> Result<SymbolEncodingType> {
    if most_frequent == nb_seq {
        *repeat_mode = FseRepeat::None;
        if is_default_allowed && nb_seq <= 2 {
            // A run of 1 or 2 costs more than the predefined table does.
            return Ok(SymbolEncodingType::Basic);
        }
        return Ok(SymbolEncodingType::Rle);
    }
    if strategy < Strategy::Lazy {
        if is_default_allowed {
            const STATIC_FSE_NB_SEQ_MAX: usize = 1000;
            let mult = 10 - strategy as usize;
            const BASE_LOG: usize = 3;
            let dynamic_fse_nb_seq_min = ((1usize << default_norm_log) * mult) >> BASE_LOG;
            if *repeat_mode == FseRepeat::Valid && nb_seq < STATIC_FSE_NB_SEQ_MAX {
                return Ok(SymbolEncodingType::Repeat);
            }
            if nb_seq < dynamic_fse_nb_seq_min
                || most_frequent < (nb_seq >> (default_norm_log - 1))
            {
                *repeat_mode = FseRepeat::None;
                return Ok(SymbolEncodingType::Basic);
            }
        }
    } else {
        let basic_cost = cost_or_error(if is_default_allowed {
            cross_entropy_cost(default_norm, default_norm_log, count, max)
        } else {
            Err(ErrorCode::Generic)
        });
        let repeat_cost = cost_or_error(if *repeat_mode != FseRepeat::None {
            fse_bit_cost(prev_ctable, count, max)
        } else {
            Err(ErrorCode::Generic)
        });
        let ncount_cost = cost_or_error(ncount_cost(count, max, nb_seq, fse_log));
        let compressed_cost = (ncount_cost << 3).wrapping_add(entropy_cost(count, max, nb_seq)?);

        if basic_cost <= repeat_cost && basic_cost <= compressed_cost {
            *repeat_mode = FseRepeat::None;
            return Ok(SymbolEncodingType::Basic);
        }
        if repeat_cost <= compressed_cost {
            return Ok(SymbolEncodingType::Repeat);
        }
    }
    *repeat_mode = FseRepeat::Check;
    Ok(SymbolEncodingType::Compressed)
}

/// `ZSTD_buildCTable`: makes the table for the codes `code_table`, of which `count` is the distribution, and writes
/// what the decoder needs to make the same one. Returns how many bytes that takes.
pub(crate) fn build_ctable(
    dst: &mut [u8],
    next_ctable: &mut FseCTable,
    fse_log: u32,
    ty: SymbolEncodingType,
    count: &mut [u32],
    max: u32,
    code_table: &[u8],
    default_norm: &[i16],
    default_norm_log: u32,
    default_max: u32,
    prev_ctable: &FseCTable,
) -> Result<usize> {
    match ty {
        SymbolEncodingType::Rle => {
            next_ctable.build_rle(max as u8)?;
            let Some(first) = dst.first_mut() else {
                return Err(ErrorCode::DstSizeTooSmall);
            };
            *first = code_table.at(0)?;
            Ok(1)
        }
        SymbolEncodingType::Repeat => {
            next_ctable.clone_from(prev_ctable);
            Ok(0)
        }
        SymbolEncodingType::Basic => {
            next_ctable.build(default_norm, default_max, default_norm_log)?;
            Ok(0)
        }
        SymbolEncodingType::Compressed => {
            let mut norm = [0i16; MAX_SEQ as usize + 1];
            let nb_seq = code_table.len();
            let mut nb_seq_1 = nb_seq;
            let table_log = fse::optimal_table_log(fse_log, nb_seq, max);
            // The last code is the first state, which takes no transition.
            let last_count = count.at_mut(usize::from(code_table.at(nb_seq.wrapping_sub(1))?))?;
            if *last_count > 1 {
                *last_count -= 1;
                nb_seq_1 -= 1;
            }
            fse::normalize_count(
                &mut norm,
                table_log,
                count,
                nb_seq_1,
                max,
                use_low_prob_count(nb_seq_1),
            )?;
            let ncount_size = fse::write_ncount(dst, &norm, max, table_log)?;
            next_ctable.build(&norm, max, table_log)?;
            Ok(ncount_size)
        }
    }
}

#[inline(always)]
fn bits_of<const N: usize>(table: &[u8; N], code: u8) -> u32 {
    u32::from(table.get(usize::from(code)).copied().unwrap_or(0))
}

/// `ZSTD_encodeSequences`: the four slices are of the same length, which is not 0.
pub(crate) fn encode_sequences(
    dst: &mut [u8],
    ctable_match_length: &FseCTable,
    ml_code_table: &[u8],
    ctable_offset_bits: &FseCTable,
    of_code_table: &[u8],
    ctable_lit_length: &FseCTable,
    ll_code_table: &[u8],
    sequences: &[SeqDef],
) -> Result<usize> {
    let mut block_stream = BitCStream::new(dst).map_err(|_| ErrorCode::DstSizeTooSmall)?;
    let (
        Some((&ml_last, ml_codes)),
        Some((&of_last, of_codes)),
        Some((&ll_last, ll_codes)),
        Some((seq_last, sequences)),
    ) = (
        ml_code_table.split_last(),
        of_code_table.split_last(),
        ll_code_table.split_last(),
        sequences.split_last(),
    )
    else {
        return Err(ErrorCode::Generic);
    };

    let mut state_match_length = FseCState::new2(ctable_match_length, u32::from(ml_last));
    let mut state_offset_bits = FseCState::new2(ctable_offset_bits, u32::from(of_last));
    let mut state_lit_length = FseCState::new2(ctable_lit_length, u32::from(ll_last));
    block_stream.add_bits(u64::from(seq_last.lit_length), bits_of(&LL_BITS, ll_last));
    block_stream.add_bits(u64::from(seq_last.ml_base), bits_of(&ML_BITS, ml_last));
    block_stream.add_bits(u64::from(seq_last.off_base), u32::from(of_last));
    block_stream.flush_bits();

    for (((seq, &ll_code), &of_code), &ml_code) in sequences
        .iter()
        .zip(ll_codes)
        .zip(of_codes)
        .zip(ml_codes)
        .rev()
    {
        let ll_bits = bits_of(&LL_BITS, ll_code);
        let of_bits = u32::from(of_code);
        let ml_bits = bits_of(&ML_BITS, ml_code);
        state_offset_bits.encode_symbol(&mut block_stream, u32::from(of_code));
        state_match_length.encode_symbol(&mut block_stream, u32::from(ml_code));
        state_lit_length.encode_symbol(&mut block_stream, u32::from(ll_code));
        if of_bits + ml_bits + ll_bits >= 64 - 7 - (LL_FSE_LOG + ML_FSE_LOG + OFF_FSE_LOG) {
            block_stream.flush_bits();
        }
        block_stream.add_bits(u64::from(seq.lit_length), ll_bits);
        block_stream.add_bits(u64::from(seq.ml_base), ml_bits);
        if of_bits + ml_bits + ll_bits > 56 {
            block_stream.flush_bits();
        }
        block_stream.add_bits(u64::from(seq.off_base), of_bits);
        block_stream.flush_bits();
    }

    state_match_length.flush(&mut block_stream);
    state_offset_bits.flush(&mut block_stream);
    state_lit_length.flush(&mut block_stream);

    match block_stream.close() {
        0 => Err(ErrorCode::DstSizeTooSmall),
        stream_size => Ok(stream_size),
    }
}
