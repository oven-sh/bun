//! Hooks for the differential tests. Only in scratch copies of the crate.
#![allow(clippy::all, clippy::indexing_slicing, dead_code, unreachable_pub)]

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
    if ms
        .window
        .dict_is_invalid(src_addr + src.len(), max_dist, ms.loaded_dict_end)
    {
        ms.loaded_dict_end = 0;
    }
    if ms
        .window
        .enforce_max_dist(src_addr, max_dist, ms.loaded_dict_end)
    {
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
    let last_ll = compress::compress_block(
        &mut ms,
        &mut seq_store,
        &mut rep,
        &block,
        strategy,
        use_row,
        dict_mode,
    )?;

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
    assert_eq!(
        reps, rep,
        "the repeat offsets the block compressor leaves are those of its sequences"
    );
    Ok(out)
}

/// The entropy encoders. A `HufCTable` is passed as its array, which is what the C code has, and an `FseCTable` is
/// converted to the layout of the C code.
pub mod entropy {
    use crate::ErrorCode;
    use crate::common::bitstream::BitCStream;
    use crate::compress::fse::{self, FseCState, FseCTable};
    use crate::compress::hist;
    use crate::compress::huf::{self, HufCTable, HufFlags, HufRepeat};

    type R<T = usize> = Result<T, ErrorCode>;
    pub type Huf = [u64; 257];

    pub fn hist_add(count: &mut [u32], src: &[u8]) -> R<()> {
        hist::add(count, src)
    }
    pub fn hist_count_simple(count: &mut [u32], max: &mut u32, src: &[u8]) -> R<u32> {
        hist::count_simple(count, max, src)
    }
    pub fn hist_count_fast_wksp(count: &mut [u32], max: &mut u32, src: &[u8]) -> R {
        hist::count_fast_wksp(count, max, src)
    }
    pub fn hist_count_wksp(count: &mut [u32], max: &mut u32, src: &[u8]) -> R {
        hist::count_wksp(count, max, src)
    }

    pub struct Fse(FseCTable);
    impl Fse {
        pub fn new() -> Self {
            Self(FseCTable::new())
        }
        pub fn build(&mut self, norm: &[i16], max: u32, table_log: u32) -> R<()> {
            self.0.build(norm, max, table_log)
        }
        pub fn build_rle(&mut self, symbol: u8) -> R<()> {
            self.0.build_rle(symbol)
        }
        pub fn get_max_nb_bits(&self, symbol: u32) -> u32 {
            self.0.get_max_nb_bits(symbol)
        }
        pub fn bit_cost(&self, symbol: u32, accuracy_log: u32) -> u32 {
            self.0.bit_cost(symbol, accuracy_log)
        }
        /// The `U32`s of the C table, up to the last symbol's transform.
        pub fn to_c(&self) -> Vec<u32> {
            let t = &self.0;
            let mut v = vec![t.table_log | t.max_symbol_value << 16];
            let states = if t.table_log != 0 {
                1usize << t.table_log
            } else {
                2
            };
            for pair in t.state_table[..states].chunks(2) {
                v.push(pair[0] as u32 | (pair[1] as u32) << 16);
            }
            for tt in &t.symbol_tt[..=t.max_symbol_value as usize] {
                v.push(tt.delta_find_state as u32);
                v.push(tt.delta_nb_bits);
            }
            v
        }
        pub fn compress(&self, dst: &mut [u8], src: &[u8]) -> usize {
            fse::compress_using_ctable(dst, src, &self.0)
        }
    }
    /// Three states on one stream, as the sequence encoder has.
    pub fn fse_encode3(dst: &mut [u8], tables: [&Fse; 3], symbols: [&[u8]; 3]) -> R {
        let n = symbols[0].len();
        let mut bit_c = BitCStream::new(dst)?;
        let mut a = FseCState::new2(&tables[0].0, symbols[0][n - 1] as u32);
        let mut b = FseCState::new2(&tables[1].0, symbols[1][n - 1] as u32);
        let mut c = FseCState::new2(&tables[2].0, symbols[2][n - 1] as u32);
        for i in (0..n - 1).rev() {
            b.encode_symbol(&mut bit_c, symbols[1][i] as u32);
            a.encode_symbol(&mut bit_c, symbols[0][i] as u32);
            c.encode_symbol(&mut bit_c, symbols[2][i] as u32);
            bit_c.flush_bits();
        }
        a.flush(&mut bit_c);
        b.flush(&mut bit_c);
        c.flush(&mut bit_c);
        let d = FseCState::new(&tables[0].0);
        d.flush(&mut bit_c);
        Ok(bit_c.close())
    }
    pub const FSE_NCOUNTBOUND: usize = fse::FSE_NCOUNTBOUND;
    pub fn fse_ncount_write_bound(max: u32, table_log: u32) -> usize {
        fse::ncount_write_bound(max, table_log)
    }
    pub fn fse_write_ncount(dst: &mut [u8], norm: &[i16], max: u32, table_log: u32) -> R {
        fse::write_ncount(dst, norm, max, table_log)
    }
    pub fn fse_optimal_table_log(max_log: u32, size: usize, max: u32) -> u32 {
        fse::optimal_table_log(max_log, size, max)
    }
    pub fn fse_optimal_table_log_internal(max_log: u32, size: usize, max: u32, minus: u32) -> u32 {
        fse::optimal_table_log_internal(max_log, size, max, minus)
    }
    pub fn fse_normalize_count(
        norm: &mut [i16],
        table_log: u32,
        count: &[u32],
        total: usize,
        max: u32,
        low_prob: bool,
    ) -> R {
        fse::normalize_count(norm, table_log, count, total, max, low_prob)
    }

    fn flags(f: u32) -> HufFlags {
        HufFlags {
            optimal_depth: f & 2 != 0,
            prefer_repeat: f & 4 != 0,
            suspect_uncompressible: f & 8 != 0,
        }
    }
    fn with<T>(t: &mut Huf, f: impl FnOnce(&mut HufCTable) -> T) -> T {
        let mut ct = HufCTable(*t);
        let r = f(&mut ct);
        *t = ct.0;
        r
    }
    pub const HUF_CONSTANTS: (usize, usize, u32, u32) = (
        huf::HUF_WORKSPACE_SIZE,
        huf::HUF_BLOCKSIZE_MAX,
        huf::HUF_TABLELOG_DEFAULT,
        huf::HUF_OPTIMAL_DEPTH_THRESHOLD as u32,
    );
    pub fn huf_compress_bound(size: usize) -> usize {
        huf::compress_bound(size)
    }
    pub fn huf_build_ctable(t: &mut Huf, count: &[u32], max: u32, max_nb_bits: u32) -> R {
        with(t, |t| huf::build_ctable(t, count, max, max_nb_bits))
    }
    pub fn huf_write_ctable(dst: &mut [u8], t: &Huf, max: u32, huff_log: u32) -> R {
        huf::write_ctable(dst, &HufCTable(*t), max, huff_log)
    }
    /// (size, max symbol value, has zero weights)
    pub fn huf_read_ctable(t: &mut Huf, max: u32, src: &[u8]) -> R<(usize, u32, bool)> {
        with(t, |t| huf::read_ctable(t, max, src))
            .map(|s| (s.size, s.max_symbol_value, s.has_zero_weights))
    }
    pub fn huf_estimate_compressed_size(t: &Huf, count: &[u32], max: u32) -> usize {
        huf::estimate_compressed_size(&HufCTable(*t), count, max)
    }
    pub fn huf_validate_ctable(t: &Huf, count: &[u32], max: u32) -> bool {
        huf::validate_ctable(&HufCTable(*t), count, max)
    }
    pub fn huf_optimal_table_log(
        max_log: u32,
        size: usize,
        max: u32,
        t: &mut Huf,
        count: &[u32],
        f: u32,
    ) -> u32 {
        with(t, |t| {
            huf::optimal_table_log(max_log, size, max, t, count, flags(f))
        })
    }
    pub fn huf_min_table_log(cardinality: u32) -> u32 {
        huf::min_table_log(cardinality)
    }
    pub fn huf_cardinality(count: &[u32], max: u32) -> u32 {
        huf::cardinality(count, max)
    }
    pub fn huf_get_nb_bits(t: &Huf, symbol: u32) -> u32 {
        HufCTable(*t).get_nb_bits(symbol)
    }
    pub fn huf_read_ctable_header(t: &Huf) -> (u8, u8) {
        let h = huf::read_ctable_header(&HufCTable(*t));
        (h.table_log, h.max_symbol_value)
    }
    pub fn huf_compress_1x_using_ctable(dst: &mut [u8], src: &[u8], t: &Huf) -> R {
        huf::compress_1x_using_ctable(dst, src, &HufCTable(*t))
    }
    pub fn huf_compress_4x_using_ctable(dst: &mut [u8], src: &[u8], t: &Huf) -> R {
        huf::compress_4x_using_ctable(dst, src, &HufCTable(*t))
    }
    /// `repeat` is 0, 1 or 2, as `HUF_repeat`. `f` has the bits of `HUF_flags_e`.
    pub fn huf_compress_repeat(
        four: bool,
        dst: &mut [u8],
        src: &[u8],
        max: u32,
        huff_log: u32,
        t: &mut Huf,
        repeat: &mut u32,
        f: u32,
    ) -> R {
        let mut rep = match *repeat {
            0 => HufRepeat::None,
            1 => HufRepeat::Check,
            _ => HufRepeat::Valid,
        };
        let r = with(t, |t| {
            if four {
                huf::compress_4x_repeat(dst, src, max, huff_log, t, &mut rep, flags(f))
            } else {
                huf::compress_1x_repeat(dst, src, max, huff_log, t, &mut rep, flags(f))
            }
        });
        *repeat = match rep {
            HufRepeat::None => 0,
            HufRepeat::Check => 1,
            HufRepeat::Valid => 2,
        };
        r
    }
}

/// For timing: no copy of the table.
pub mod entropy_bench {
    use crate::compress::huf::{self, HufCTable, HufFlags, HufRepeat};
    pub struct Table(HufCTable);
    impl Table {
        pub fn new(t: &[u64; 257]) -> Self {
            Self(HufCTable(*t))
        }
        pub fn build(&mut self, count: &[u32], max: u32, bits: u32) -> usize {
            huf::build_ctable(&mut self.0, count, max, bits).unwrap_or(0)
        }
        pub fn write(&self, dst: &mut [u8], max: u32, log: u32) -> usize {
            huf::write_ctable(dst, &self.0, max, log).unwrap_or(0)
        }
        pub fn compress4(&self, dst: &mut [u8], src: &[u8]) -> usize {
            huf::compress_4x_using_ctable(dst, src, &self.0).unwrap_or(0)
        }
        pub fn repeat4(&mut self, dst: &mut [u8], src: &[u8], optimal_depth: bool) -> usize {
            let mut rep = HufRepeat::None;
            huf::compress_4x_repeat(
                dst,
                src,
                255,
                11,
                &mut self.0,
                &mut rep,
                HufFlags {
                    optimal_depth,
                    ..Default::default()
                },
            )
            .unwrap_or(0)
        }
    }
}
