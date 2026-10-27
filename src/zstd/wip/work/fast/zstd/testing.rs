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
pub fn first_block(
    cp: [u32; 7],
    use_row: bool,
    dict: &[u8],
    src: &[u8],
) -> Result<Vec<(u32, u32, u32)>, ErrorCode> {
    let strategy = Strategy::from_int(cp[6] as i32).ok_or(ErrorCode::Generic)?;
    let c_params = CompressionParameters {
        window_log: cp[0],
        chain_log: cp[1],
        hash_log: cp[2],
        search_log: cp[3],
        min_match: cp[4],
        target_length: cp[5],
        strategy: Some(strategy),
    };
    let row_used = row_match_finder_supported(strategy) && use_row;

    // ZSTD_reset_matchState
    let mut ms = MatchState::new();
    ms.hash_log3 = if c_params.min_match == 3 {
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
    seq_store.reserve(
        block_size / if c_params.min_match == 3 { 3 } else { 4 },
        block_size,
    )?;

    let bufs = Buffers {
        in_buff: &[],
        user: src,
        dict,
    };

    // ZSTD_loadDictionaryContent(dtlm_fast, tfp_forCCtx)
    if !dict.is_empty() {
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
            match strategy {
                Strategy::Fast => fast::fill_hash_table(
                    &mut ms,
                    prefix,
                    iend,
                    DictTableLoadMethod::Fast,
                    TableFillPurpose::ForCCtx,
                )?,
                Strategy::DFast => double_fast::fill_double_hash_table(
                    &mut ms,
                    prefix,
                    iend,
                    DictTableLoadMethod::Fast,
                    TableFillPurpose::ForCCtx,
                )?,
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
    if !ms
        .window
        .update(src_addr, BufId::User, src.len(), ms.force_non_contiguous)
    {
        ms.force_non_contiguous = false;
        ms.next_to_update = ms.window.dict_limit;
    }
    // ZSTD_compress_frameChunk
    let max_dist = 1u32 << c_params.window_log;
    let mut prev = CompressedBlockState::new();
    let mut out = Vec::new();
    let mut start = 0usize;
    while start < src.len() {
        let end = src.len().min(start + block_size);
        if ms
            .window
            .dict_is_invalid(src_addr + end, max_dist, ms.loaded_dict_end)
        {
            ms.loaded_dict_end = 0;
        }
        if ms
            .window
            .enforce_max_dist(src_addr + start, max_dist, ms.loaded_dict_end)
        {
            ms.loaded_dict_end = 0;
        }
        if ms.next_to_update < ms.window.low_limit {
            ms.next_to_update = ms.window.low_limit;
        }
        // ZSTD_buildSeqStore
        seq_store.reset();
        let block = BlockSrc {
            buf: bufs.get(ms.window.base_buf),
            base: ms.window.base.wrapping_sub(ms.window.base_buf.start()),
            dict_buf: bufs.get(ms.window.dict_buf),
            dict_base: ms.window.dict_base.wrapping_sub(ms.window.dict_buf.start()),
            start,
            end,
            dms: None,
            symbol_costs: &prev.entropy,
            ldm_seq_store: None,
        };
        let curr = block.index_of(start);
        if curr > ms.next_to_update + 384 {
            ms.next_to_update = curr - 192.min(curr - ms.next_to_update - 384);
        }
        let dict_mode = ms.dict_mode(None);
        if std::env::var("DBG").is_ok() {
            eprintln!(
                "block {start}..{end} mode {dict_mode:?} window {:?} lde {} ntu {}",
                ms.window, ms.loaded_dict_end, ms.next_to_update
            );
        }
        let mut rep = prev.rep;
        let last_ll = compress::compress_block(
            &mut ms,
            &mut seq_store,
            &mut rep,
            &block,
            strategy,
            use_row,
            dict_mode,
        )?;

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
            update_rep(&mut reps, seq.off_base, ll == 0);
            out.push((ll, ml, reps[0]));
        }
        out.push((last_ll as u32, 0, 0));
        assert_eq!(
            reps[..2],
            rep[..2],
            "the repeat offsets the block compressor leaves are those of its sequences"
        );
        prev.rep = rep;
        start = end;
    }
    Ok(out)
}

/// A match state whose window is set by hand, to run the block compressors of `fast` and `dfast` one call at a time.
pub struct TestMs {
    ms: MatchState,
    seq_store: SeqStore,
    prev: CompressedBlockState,
}

/// The dictionary's match state, its buffer, `window.base` and `window.nextSrc` as positions in it.
pub type TestDms<'a> = (&'a TestMs, &'a [u8], usize, usize);

impl TestMs {
    /// `cp` is windowLog, chainLog, hashLog, searchLog, minMatch, targetLength, strategy.
    pub fn new(cp: [u32; 7], max_block: usize) -> Self {
        let mut ms = MatchState::new();
        ms.c_params = CompressionParameters {
            window_log: cp[0],
            chain_log: cp[1],
            hash_log: cp[2],
            search_log: cp[3],
            min_match: cp[4],
            target_length: cp[5],
            strategy: Strategy::from_int(cp[6] as i32),
        };
        ms.hash_table = vec![0; 1 << cp[2]];
        ms.chain_table = vec![0; 1 << cp[1]];
        let mut seq_store = SeqStore::new();
        seq_store.reserve(max_block / 3 + 1, max_block).unwrap();
        Self {
            ms,
            seq_store,
            prev: CompressedBlockState::new(),
        }
    }

    pub fn set_state(
        &mut self,
        dict_limit: u32,
        low_limit: u32,
        loaded_dict_end: u32,
        next_to_update: u32,
    ) {
        self.ms.window.dict_limit = dict_limit;
        self.ms.window.low_limit = low_limit;
        self.ms.loaded_dict_end = loaded_dict_end;
        self.ms.next_to_update = next_to_update;
    }

    pub fn fill(
        &mut self,
        buf: &[u8],
        base: usize,
        end: usize,
        full: bool,
        for_cdict: bool,
    ) -> Result<(), ErrorCode> {
        let prefix = Prefix { buf, base };
        let dtlm = if full {
            DictTableLoadMethod::Full
        } else {
            DictTableLoadMethod::Fast
        };
        let tfp = if for_cdict {
            TableFillPurpose::ForCDict
        } else {
            TableFillPurpose::ForCCtx
        };
        match self.ms.c_params.strat() {
            Strategy::Fast => fast::fill_hash_table(&mut self.ms, prefix, end, dtlm, tfp),
            _ => double_fast::fill_double_hash_table(&mut self.ms, prefix, end, dtlm, tfp),
        }
    }

    /// `mode` is a `ZSTD_dictMode_e`.
    pub fn block(
        &mut self,
        rep: &mut [u32; 3],
        mode: u32,
        buf: &[u8],
        base: usize,
        dict_buf: &[u8],
        dict_base: usize,
        start: usize,
        end: usize,
        dms: Option<TestDms<'_>>,
    ) -> Result<usize, ErrorCode> {
        self.seq_store.reset();
        let dms = dms.map(|(dict, buf, base, end)| DictMatchState {
            ms: &dict.ms,
            buf,
            base,
            end,
        });
        let block = BlockSrc {
            buf,
            base,
            dict_buf,
            dict_base,
            start,
            end,
            dms,
            symbol_costs: &self.prev.entropy,
            ldm_seq_store: None,
        };
        let dict_mode = self.ms.dict_mode(dms.as_ref());
        assert_eq!(dict_mode as u32, mode);
        let strategy = self.ms.c_params.strat();
        compress::compress_block(
            &mut self.ms,
            &mut self.seq_store,
            rep,
            &block,
            strategy,
            false,
            dict_mode,
        )
    }

    /// offBase, litLength, mlBase
    pub fn sequences(&self) -> Vec<(u32, u16, u16)> {
        self.seq_store
            .sequences
            .iter()
            .map(|s| (s.off_base, s.lit_length, s.ml_base))
            .collect()
    }
    pub fn literals(&self) -> &[u8] {
        self.seq_store.literals()
    }
    pub fn long_length(&self) -> (u32, u32) {
        (
            self.seq_store.long_length_type as u32,
            self.seq_store.long_length_pos,
        )
    }
    pub fn tables(&self) -> (&[u32], &[u32]) {
        (&self.ms.hash_table, &self.ms.chain_table)
    }
}
