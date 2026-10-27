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

#[derive(Clone, Copy)]
pub enum Dict<'a> {
    None,
    /// `ZSTD_CCtx_refPrefix`, raw content.
    Prefix(&'a [u8]),
    /// `ZSTD_CCtx_refCDict`, raw content, attached. With the parameters of the CDict.
    CDict(&'a [u8], [u32; 7]),
}

/// What is left in the match state after the frame.
#[derive(PartialEq, Eq, Debug, Default)]
pub struct State {
    pub has_dms: bool,
    pub next_to_update: u32,
    pub loaded_dict_end: u32,
    pub low_limit: u32,
    pub dict_limit: u32,
    pub hash_salt_entropy: u32,
    pub lazy_skipping: bool,
    pub hash_cache: [u32; 8],
    pub rep: [u32; 3],
    pub hash_table: Vec<u32>,
    pub chain_table: Vec<u32>,
    pub tag_table: Vec<u8>,
}

fn params(cp: [u32; 7]) -> Result<CompressionParameters, ErrorCode> {
    Ok(CompressionParameters {
        window_log: cp[0],
        chain_log: cp[1],
        hash_log: cp[2],
        search_log: cp[3],
        min_match: cp[4],
        target_length: cp[5],
        strategy: Some(Strategy::from_int(cp[6] as i32).ok_or(ErrorCode::Generic)?),
    })
}

/// `ZSTD_reset_matchState`, on a new one.
fn reset_match_state(
    c_params: CompressionParameters,
    use_row: bool,
    for_cdict: bool,
) -> MatchState {
    let strategy = c_params.strat();
    let row_used = row_match_finder_supported(strategy) && use_row;
    let mut ms = MatchState::new();
    ms.hash_log3 = if !for_cdict && c_params.min_match == 3 {
        c_params.window_log.min(17)
    } else {
        0
    };
    ms.window.clear();
    ms.next_to_update = ms.window.dict_limit;
    ms.hash_table = vec![0; 1 << c_params.hash_log];
    ms.chain_table = vec![
        0;
        if strategy != Strategy::Fast && !row_used {
            1 << c_params.chain_log
        } else {
            0
        }
    ];
    ms.hash_table3 = vec![
        0;
        if ms.hash_log3 != 0 {
            1 << ms.hash_log3
        } else {
            0
        }
    ];
    if row_used {
        ms.tag_table = vec![0; 1 << c_params.hash_log];
        ms.hash_salt = if for_cdict {
            0
        } else {
            bitmix(ms.hash_salt, 8) ^ bitmix(ms.hash_salt_entropy as u64, 4)
        };
        ms.row_hash_log = c_params.hash_log - c_params.search_log.clamp(4, 6);
    }
    if !for_cdict && strategy >= Strategy::BtOpt {
        ms.opt.lit_freq = vec![0; 256];
        ms.opt.lit_length_freq = vec![0; 36];
        ms.opt.match_length_freq = vec![0; 53];
        ms.opt.off_code_freq = vec![0; 32];
        ms.opt.match_table = vec![Match::default(); ZSTD_OPT_SIZE];
        ms.opt.price_table = vec![Optimal::default(); ZSTD_OPT_SIZE];
    }
    ms.c_params = c_params;
    ms
}

/// `ZSTD_loadDictionaryContent`
fn load_dictionary_content(
    ms: &mut MatchState,
    use_row: bool,
    dict: &[u8],
    dtlm: DictTableLoadMethod,
    tfp: TableFillPurpose,
) -> Result<(), ErrorCode> {
    let c_params = ms.c_params;
    let iend = dict.len();
    ms.window
        .update(BufId::Dict.start(), BufId::Dict, dict.len(), false);
    let max_dict_size = 1usize << (c_params.hash_log + 3).max(c_params.chain_log + 1).min(31);
    let ip = iend - dict.len().min(max_dict_size);
    let prefix = Prefix {
        buf: dict,
        base: ms.window.base.wrapping_sub(BufId::Dict.start()),
    };
    ms.next_to_update = prefix.index_of(ip);
    ms.loaded_dict_end = prefix.index_of(iend);
    if iend - ip > HASH_READ_SIZE {
        match c_params.strat() {
            Strategy::Fast => fast::fill_hash_table(ms, prefix, iend, dtlm, tfp)?,
            Strategy::DFast => double_fast::fill_double_hash_table(ms, prefix, iend, dtlm, tfp)?,
            Strategy::Greedy | Strategy::Lazy | Strategy::Lazy2 => {
                if use_row {
                    ms.tag_table.fill(0);
                    lazy::row_update(ms, prefix, iend - HASH_READ_SIZE)?;
                } else {
                    lazy::insert_and_find_first_index(ms, prefix, iend - HASH_READ_SIZE)?;
                }
            }
            _ => opt::update_tree(ms, prefix, iend - HASH_READ_SIZE, iend)?,
        }
        ms.next_to_update = prefix.index_of(iend);
    }
    Ok(())
}

/// The sequences of all the blocks of a frame, as (literal length, match length, repeat code or 0, offset or 0). Each
/// block ends with the literals that are left as (length, 0, 0, 0).
///
/// `cp` is windowLog, chainLog, hashLog, searchLog, minMatch, targetLength, strategy, as applied.
pub fn frame(
    cp: [u32; 7],
    use_row: bool,
    dict: Dict<'_>,
    src: &[u8],
    streaming: bool,
) -> Result<(Vec<(u32, u32, u32, u32)>, State), ErrorCode> {
    let c_params = params(cp)?;
    let strategy = c_params.strat();
    let mut ms = reset_match_state(c_params, use_row, false);

    let block_size_max = (1usize << c_params.window_log).min(128 << 10);
    let mut seq_store = SeqStore::new();
    seq_store.reserve(
        block_size_max / if c_params.min_match == 3 { 3 } else { 4 },
        block_size_max,
    )?;

    let dict_content = match dict {
        Dict::None => &[][..],
        Dict::Prefix(d) | Dict::CDict(d, _) => d,
    };
    // As `ZSTD_compressStream2` does: blocks are copied to a buffer of the size of the window and a block.
    let mut in_buff = vec![
        0u8;
        if streaming {
            (1usize << c_params.window_log) + block_size_max
        } else {
            0
        }
    ];
    let mut in_buff_pos = 0usize;

    let mut cdict_ms = None;
    match dict {
        Dict::Prefix(d) if d.len() >= 8 => load_dictionary_content(
            &mut ms,
            use_row,
            d,
            DictTableLoadMethod::Fast,
            TableFillPurpose::ForCCtx,
        )?,
        Dict::CDict(d, cdict_cp) if d.len() >= 8 => {
            let mut c = reset_match_state(params(cdict_cp)?, use_row, true);
            load_dictionary_content(
                &mut c,
                use_row,
                d,
                DictTableLoadMethod::Full,
                TableFillPurpose::ForCDict,
            )?;
            // ZSTD_resetCCtx_byAttachingCDict
            let cdict_end = c.window.index_of(c.window.next_src);
            if ms.window.dict_limit < cdict_end {
                ms.window.next_src = ms.window.base + cdict_end as usize;
                ms.window.clear();
            }
            ms.loaded_dict_end = ms.window.dict_limit;
            cdict_ms = Some(c);
        }
        _ => {}
    }
    let mut dms = cdict_ms.as_ref().map(|c| DictMatchState {
        ms: c,
        buf: dict_content,
        base: c.window.base.wrapping_sub(BufId::Dict.start()),
        end: c.window.next_src - BufId::Dict.start(),
    });

    // ZSTD_compressContinue_internal
    if !streaming
        && !ms.window.update(
            BufId::User.start(),
            BufId::User,
            src.len(),
            ms.force_non_contiguous,
        )
    {
        ms.force_non_contiguous = false;
        ms.next_to_update = ms.window.dict_limit;
    }
    // ZSTD_compress_frameChunk
    let max_dist = 1u32 << c_params.window_log;
    let prev = CompressedBlockState::new();
    let mut rep = prev.rep;
    let mut out = Vec::new();
    let mut pos = 0;
    while pos < src.len() {
        let block_size = (src.len() - pos).min(block_size_max);
        let (block_addr, block_start) = if streaming {
            in_buff[in_buff_pos..in_buff_pos + block_size]
                .copy_from_slice(&src[pos..pos + block_size]);
            let addr = BufId::InBuff.start() + in_buff_pos;
            if !ms
                .window
                .update(addr, BufId::InBuff, block_size, ms.force_non_contiguous)
            {
                ms.force_non_contiguous = false;
                ms.next_to_update = ms.window.dict_limit;
            }
            (addr, in_buff_pos)
        } else {
            (BufId::User.start() + pos, pos)
        };
        let bufs = Buffers {
            in_buff: &in_buff,
            user: src,
            dict: dict_content,
        };
        if ms
            .window
            .dict_is_invalid(block_addr + block_size, max_dist, ms.loaded_dict_end)
        {
            ms.loaded_dict_end = 0;
            dms = None;
        }
        if ms
            .window
            .enforce_max_dist(block_addr, max_dist, ms.loaded_dict_end)
        {
            ms.loaded_dict_end = 0;
            dms = None;
        }
        if ms.next_to_update < ms.window.low_limit {
            ms.next_to_update = ms.window.low_limit;
        }
        // ZSTD_buildSeqStore
        assert!(block_size >= 7);
        seq_store.reset();
        let block = BlockSrc {
            buf: bufs.get(ms.window.base_buf),
            base: ms.window.base.wrapping_sub(ms.window.base_buf.start()),
            dict_buf: bufs.get(ms.window.dict_buf),
            dict_base: ms.window.dict_base.wrapping_sub(ms.window.dict_buf.start()),
            start: block_start,
            end: block_start + block_size,
            dms,
            symbol_costs: &prev.entropy,
            ldm_seq_store: None,
        };
        let curr = block.index_of(block_start);
        if curr > ms.next_to_update + 384 {
            ms.next_to_update = curr - 192.min(curr - ms.next_to_update - 384);
        }
        let dict_mode = ms.dict_mode(dms.as_ref());
        let mut reps = rep;
        let last_ll = compress::compress_block(
            &mut ms,
            &mut seq_store,
            &mut rep,
            &block,
            strategy,
            use_row,
            dict_mode,
        )?;

        let mut total = last_ll;
        for (i, seq) in seq_store.sequences.iter().enumerate() {
            let (mut ll, mut ml) = (seq.lit_length as u32, seq.ml_base as u32 + 3);
            if seq_store.long_length_pos as usize == i {
                match seq_store.long_length_type {
                    LongLengthType::LiteralLength => ll += 0x10000,
                    LongLengthType::MatchLength => ml += 0x10000,
                    LongLengthType::None => {}
                }
            }
            update_rep(&mut reps, seq.off_base, ll == 0);
            total += (ll + ml) as usize;
            out.push(if seq.off_base <= 3 {
                (ll, ml, seq.off_base, 0)
            } else {
                (ll, ml, 0, seq.off_base - 3)
            });
        }
        out.push((last_ll as u32, 0, 0, 0));
        assert_eq!(total, block_size, "the sequences cover the block");
        assert_eq!(
            seq_store.lit_len
                + last_ll
                + seq_store
                    .sequences
                    .iter()
                    .enumerate()
                    .map(|(i, s)| s.ml_base as usize
                        + 3
                        + if seq_store.long_length_pos as usize == i
                            && seq_store.long_length_type == LongLengthType::MatchLength
                        {
                            0x10000
                        } else {
                            0
                        })
                    .sum::<usize>(),
            block_size
        );
        assert_eq!(
            reps[..2],
            rep[..2],
            "the repeat offsets the block compressor leaves are those of its sequences"
        );
        pos += block_size;
        in_buff_pos += block_size;
        if in_buff_pos + block_size_max > in_buff.len() {
            in_buff_pos = 0;
        }
    }
    let state = State {
        has_dms: dms.is_some(),
        next_to_update: ms.next_to_update,
        loaded_dict_end: ms.loaded_dict_end,
        low_limit: ms.window.low_limit,
        dict_limit: ms.window.dict_limit,
        hash_salt_entropy: ms.hash_salt_entropy,
        lazy_skipping: ms.lazy_skipping,
        hash_cache: ms.hash_cache,
        rep,
        hash_table: ms.hash_table,
        chain_table: ms.chain_table,
        tag_table: ms.tag_table,
    };
    Ok((out, state))
}
