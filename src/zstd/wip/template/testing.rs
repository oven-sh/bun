//! Hooks for the differential tests. Only in scratch copies of the crate.
#![allow(clippy::all, dead_code, unreachable_pub)]

use crate::ErrorCode;
use crate::compress::internal::*;
use crate::compress::{self, double_fast, fast, lazy, opt, row_match_finder_supported};

fn bitmix(mut val: u64, len: u64) -> u64 {
    val ^= val.rotate_right(49) ^ val.rotate_right(24);
    val = val.wrapping_mul(0x9FB21C651E98DF25);
    val ^= (val >> 35).wrapping_add(len);
    val = val.wrapping_mul(0x9FB21C651E98DF25);
    val ^ (val >> 28)
}

/// The sequences of the first block of a frame, as (literal length, match length, offset), and then the literals
/// that are left as (length, 0, 0).
///
/// `cp` is windowLog, chainLog, hashLog, searchLog, minMatch, targetLength, strategy, already adjusted to the sizes.
/// `dict` is a prefix (raw content, as `ZSTD_CCtx_refPrefix`), or empty. `src` is from 7 to 131071 bytes.
pub fn first_block(cp: [u32; 7], use_row: bool, dict: &[u8], src: &[u8]) -> Result<Vec<(u32, u32, u32)>, ErrorCode> {
    let strategy = Strategy::from_int(cp[6] as i32).ok_or(ErrorCode::Generic)?;
    let c_params = CompressionParameters {
        window_log: cp[0], chain_log: cp[1], hash_log: cp[2], search_log: cp[3], min_match: cp[4], target_length: cp[5],
        strategy: Some(strategy),
    };
    let row_used = row_match_finder_supported(strategy) && use_row;

    // ZSTD_reset_matchState
    let mut ms = MatchState::new();
    ms.hash_log3 = if c_params.min_match == 3 { c_params.window_log.min(17) } else { 0 };
    ms.window.clear();
    ms.next_to_update = ms.window.dict_limit;
    ms.hash_table = vec![0; 1 << c_params.hash_log];
    ms.chain_table = vec![0; if strategy != Strategy::Fast && !row_used { 1 << c_params.chain_log } else { 0 }];
    ms.hash_table3 = vec![0; if ms.hash_log3 != 0 { 1 << ms.hash_log3 } else { 0 }];
    if row_used {
        ms.tag_table = vec![0; 1 << c_params.hash_log];
        ms.hash_salt = bitmix(ms.hash_salt, 8) ^ bitmix(ms.hash_salt_entropy as u64, 4);
        ms.row_hash_log = c_params.hash_log - c_params.search_log.clamp(4, 6);
    }
    if strategy >= Strategy::BtOpt {
        ms.opt.lit_freq = vec![0; 256];
        ms.opt.lit_length_freq = vec![0; 36];
        ms.opt.match_length_freq = vec![0; 53];
        ms.opt.off_code_freq = vec![0; 32];
        ms.opt.match_table = vec![Match::default(); ZSTD_OPT_SIZE];
        ms.opt.price_table = vec![Optimal::default(); ZSTD_OPT_SIZE];
    }
    ms.c_params = c_params;

    let block_size = (1usize << c_params.window_log).min(128 << 10);
    let mut seq_store = SeqStore::new();
    seq_store.reserve(block_size / if c_params.min_match == 3 { 3 } else { 4 }, block_size)?;

    let bufs = Buffers { in_buff: &[], user: src, dict };

    // ZSTD_loadDictionaryContent(dtlm_fast, tfp_forCCtx)
    if !dict.is_empty() {
        let iend = dict.len();
        ms.window.update(BufId::Dict.start(), BufId::Dict, dict.len(), false);
        let max_dict_size = 1usize << (c_params.hash_log + 3).max(c_params.chain_log + 1).min(31);
        let ip = iend - dict.len().min(max_dict_size);
        let prefix = Prefix { buf: dict, base: ms.window.base.wrapping_sub(BufId::Dict.start()) };
        ms.next_to_update = prefix.index_of(ip);
        ms.loaded_dict_end = prefix.index_of(iend);
        if iend - ip > HASH_READ_SIZE {
            match strategy {
                Strategy::Fast => fast::fill_hash_table(&mut ms, prefix, iend, DictTableLoadMethod::Fast, TableFillPurpose::ForCCtx)?,
                Strategy::DFast => double_fast::fill_double_hash_table(&mut ms, prefix, iend, DictTableLoadMethod::Fast, TableFillPurpose::ForCCtx)?,
                Strategy::Greedy | Strategy::Lazy | Strategy::Lazy2 => {
                    if use_row {
                        ms.tag_table.fill(0);
                        lazy::row_update(&mut ms, prefix, iend - HASH_READ_SIZE)?;
                    } else {
                        lazy::insert_and_find_first_index(&mut ms, prefix, iend - HASH_READ_SIZE)?;
                    }
                }
                _ => opt::update_tree(&mut ms, prefix, iend - HASH_READ_SIZE, iend)?,
            }
            ms.next_to_update = prefix.index_of(iend);
        }
    }

    // ZSTD_compressContinue_internal
    let src_addr = BufId::User.start();
    if !ms.window.update(src_addr, BufId::User, src.len(), ms.force_non_contiguous) {
        ms.force_non_contiguous = false;
        ms.next_to_update = ms.window.dict_limit;
    }
    // ZSTD_compress_frameChunk
    let max_dist = 1u32 << c_params.window_log;
    if ms.window.dict_is_invalid(src_addr + src.len(), max_dist, ms.loaded_dict_end) {
        ms.loaded_dict_end = 0;
    }
    if ms.window.enforce_max_dist(src_addr, max_dist, ms.loaded_dict_end) {
        ms.loaded_dict_end = 0;
    }
    if ms.next_to_update < ms.window.low_limit {
        ms.next_to_update = ms.window.low_limit;
    }
    // ZSTD_buildSeqStore
    let prev = CompressedBlockState::new();
    let block = BlockSrc {
        buf: bufs.get(ms.window.base_buf),
        base: ms.window.base.wrapping_sub(ms.window.base_buf.start()),
        dict_buf: bufs.get(ms.window.dict_buf),
        dict_base: ms.window.dict_base.wrapping_sub(ms.window.dict_buf.start()),
        start: 0,
        end: src.len(),
        dms: None,
        symbol_costs: &prev.entropy,
        ldm_seq_store: None,
    };
    let curr = block.index_of(0);
    if curr > ms.next_to_update + 384 {
        ms.next_to_update = curr - 192.min(curr - ms.next_to_update - 384);
    }
    let dict_mode = ms.dict_mode(None);
    let mut rep = prev.rep;
    let last_ll = compress::compress_block(&mut ms, &mut seq_store, &mut rep, &block, strategy, use_row, dict_mode)?;

    let mut out = Vec::new();
    let mut reps = prev.rep;
    for (i, seq) in seq_store.sequences.iter().enumerate() {
        let (mut ll, mut ml) = (seq.lit_length as u32, seq.ml_base as u32 + 3);
        if seq_store.long_length_pos as usize == i {
            match seq_store.long_length_type {
                LongLengthType::LiteralLength => ll += 0x10000,
                LongLengthType::MatchLength => ml += 0x10000,
                LongLengthType::None => {}
            }
        }
        update_rep(&mut reps, seq.off_base, seq.lit_length == 0);
        out.push((ll, ml, reps[0]));
    }
    out.push((last_ll as u32, 0, 0));
    assert_eq!(reps, rep, "the repeat offsets the block compressor leaves are those of its sequences");
    Ok(out)
}
