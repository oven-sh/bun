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

// ── long distance matching and the pre-splitter ───────────────────────────

use crate::compress::{ldm, presplit};

pub fn split_block(block: &[u8], level: i32) -> Result<usize, ErrorCode> {
    presplit::split_block(block, level)
}

/// enableLdm, hashLog, bucketSizeLog, minMatchLength, hashRateLog, windowLog
fn ldm_params(p: [u32; 6]) -> LdmParams {
    LdmParams {
        enable_ldm: match p[0] {
            0 => ParamSwitch::Auto,
            1 => ParamSwitch::Enable,
            _ => ParamSwitch::Disable,
        },
        hash_log: p[1],
        bucket_size_log: p[2],
        min_match_length: p[3],
        hash_rate_log: p[4],
        window_log: p[5],
    }
}

pub fn ldm_adjust_parameters(p: [u32; 6], cp: [u32; 7]) -> [u32; 6] {
    let mut params = ldm_params(p);
    let c_params = CompressionParameters {
        window_log: cp[0],
        chain_log: cp[1],
        hash_log: cp[2],
        search_log: cp[3],
        min_match: cp[4],
        target_length: cp[5],
        strategy: Strategy::from_int(cp[6] as i32),
    };
    ldm::adjust_parameters(&mut params, &c_params);
    [
        params.enable_ldm as u32,
        params.hash_log,
        params.bucket_size_log,
        params.min_match_length,
        params.hash_rate_log,
        params.window_log,
    ]
}
pub fn ldm_get_table_size(p: [u32; 6]) -> usize {
    ldm::get_table_size(ldm_params(p))
}
pub fn ldm_get_max_nb_seq(p: [u32; 6], max_chunk_size: usize) -> usize {
    ldm::get_max_nb_seq(ldm_params(p), max_chunk_size)
}

/// (offset, litLength, matchLength)
pub type Raw = (u32, u32, u32);
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct RawStore {
    pub seq: Vec<Raw>,
    pub pos: usize,
    pub pos_in_sequence: usize,
    pub size: usize,
}
impl RawStore {
    fn to(&self) -> RawSeqStore {
        RawSeqStore {
            seq: self
                .seq
                .iter()
                .map(|s| RawSeq {
                    offset: s.0,
                    lit_length: s.1,
                    match_length: s.2,
                })
                .collect(),
            pos: self.pos,
            pos_in_sequence: self.pos_in_sequence,
            size: self.size,
            capacity: self.seq.len(),
        }
    }
    fn from(s: &RawSeqStore) -> Self {
        Self {
            seq: s
                .seq
                .iter()
                .map(|s| (s.offset, s.lit_length, s.match_length))
                .collect(),
            pos: s.pos,
            pos_in_sequence: s.pos_in_sequence,
            size: s.size,
        }
    }
}
pub fn ldm_skip_sequences(
    store: &mut RawStore,
    src_size: usize,
    min_match: u32,
) -> Result<(), ErrorCode> {
    let mut s = store.to();
    let r = ldm::skip_sequences(&mut s, src_size, min_match);
    *store = RawStore::from(&s);
    r
}
pub fn ldm_skip_raw_seq_store_bytes(
    store: &mut RawStore,
    nb_bytes: usize,
) -> Result<(), ErrorCode> {
    let mut s = store.to();
    let r = ldm::skip_raw_seq_store_bytes(&mut s, nb_bytes);
    *store = RawStore::from(&s);
    r
}

const BUF_IDS: [BufId; 3] = [BufId::InBuff, BufId::User, BufId::Dict];

pub struct Ldm {
    state: LdmState,
    params: LdmParams,
    bufs: [Vec<u8>; 3],
    store: RawSeqStore,
}
impl Ldm {
    /// `start_index`: if not 0, the window is as if that many bytes had gone through it and it had been cleared.
    pub fn new(p: [u32; 6], buf_sizes: [usize; 3], capacity: usize, start_index: u32) -> Self {
        let params = ldm_params(p);
        let mut state = LdmState::new();
        state.hash_table = vec![LdmEntry::default(); 1 << params.hash_log];
        state.bucket_offsets = vec![0; 1 << (params.hash_log - params.bucket_size_log)];
        if start_index != 0 {
            state.window.next_src = state.window.base + start_index as usize;
            state.window.clear();
        }
        let store = RawSeqStore {
            seq: vec![RawSeq::default(); capacity],
            pos: 0,
            pos_in_sequence: 0,
            size: 0,
            capacity,
        };
        Self {
            state,
            params,
            bufs: buf_sizes.map(|n| vec![0; n]),
            store,
        }
    }
    pub fn update(&mut self, buf: usize, pos: usize, data: &[u8]) {
        self.bufs[buf][pos..pos + data.len()].copy_from_slice(data);
        self.state
            .window
            .update(BUF_IDS[buf].start() + pos, BUF_IDS[buf], data.len(), false);
    }
    /// Changes a byte without telling the window.
    pub fn poke(&mut self, buf: usize, pos: usize, byte: u8) {
        self.bufs[buf][pos] = byte;
    }
    pub fn load_dict(&mut self, buf: usize, pos: usize, data: &[u8]) -> Result<(), ErrorCode> {
        self.update(buf, pos, data);
        let prefix = Prefix {
            buf: &self.bufs[buf],
            base: self.state.window.base.wrapping_sub(BUF_IDS[buf].start()),
        };
        self.state.loaded_dict_end = prefix.index_of(pos + data.len());
        ldm::fill_hash_table(&mut self.state, prefix, pos, pos + data.len(), &self.params)
    }
    pub fn generate(&mut self, pos: usize, len: usize, reset: bool) -> Result<(), ErrorCode> {
        if reset {
            self.store.size = 0;
            self.store.pos = 0;
        }
        let bufs = Buffers {
            in_buff: &self.bufs[0],
            user: &self.bufs[1],
            dict: &self.bufs[2],
        };
        ldm::generate_sequences(
            &mut self.state,
            &mut self.store,
            &self.params,
            &bufs,
            pos,
            pos + len,
        )
    }
    pub fn seqs(&self) -> Vec<Raw> {
        self.store.seq[..self.store.size]
            .iter()
            .map(|s| (s.offset, s.lit_length, s.match_length))
            .collect()
    }
    /// dictLimit, lowLimit, loadedDictEnd, nextSrc - base, nbOverflowCorrections
    pub fn window(&self) -> [u32; 5] {
        let w = &self.state.window;
        [
            w.dict_limit,
            w.low_limit,
            self.state.loaded_dict_end,
            w.index_of(w.next_src),
            w.nb_overflow_corrections,
        ]
    }
    pub fn table(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        self.state.hash_table.iter().map(|e| (e.offset, e.checksum))
    }
    pub fn bucket_offsets(&self) -> &[u8] {
        &self.state.bucket_offsets
    }
}

/// `ZSTD_ldm_blockCompress` over the blocks of one input, as the first input of a frame.
pub struct LdmBlocks {
    ms: MatchState,
    seq_store: SeqStore,
    store: RawSeqStore,
    rep: [u32; 3],
    prev: CompressedBlockState,
    dict: Vec<u8>,
    src: Vec<u8>,
    use_row: bool,
}
#[derive(PartialEq, Eq, Debug)]
pub struct BlockOut {
    /// offBase, litLength, mlBase
    pub seqs: Vec<(u32, u16, u16)>,
    pub long_length: Option<(u32, u32)>,
    pub literals: Vec<u8>,
    pub last_ll: usize,
    pub rep: [u32; 3],
    pub next_to_update: u32,
    pub store: RawStore,
}
impl LdmBlocks {
    pub fn new(
        cp: [u32; 7],
        use_row: bool,
        dict: &[u8],
        src: &[u8],
        seqs: &[Raw],
    ) -> Result<Self, ErrorCode> {
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
        let mut seq_store = SeqStore::new();
        seq_store.reserve((128 << 10) / 3, 128 << 10)?;
        if !dict.is_empty() {
            let iend = dict.len();
            ms.window
                .update(BufId::Dict.start(), BufId::Dict, dict.len(), false);
            let max_dict_size =
                1usize << (c_params.hash_log + 3).max(c_params.chain_log + 1).min(31);
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
                            lazy::insert_and_find_first_index(
                                &mut ms,
                                prefix,
                                iend - HASH_READ_SIZE,
                            )?;
                        }
                    }
                    _ => opt::update_tree(&mut ms, prefix, iend - HASH_READ_SIZE, iend)?,
                }
                ms.next_to_update = prefix.index_of(iend);
            }
        }
        if !ms.window.update(
            BufId::User.start(),
            BufId::User,
            src.len(),
            ms.force_non_contiguous,
        ) {
            ms.force_non_contiguous = false;
            ms.next_to_update = ms.window.dict_limit;
        }
        let prev = CompressedBlockState::new();
        let store = RawStore {
            seq: seqs.to_vec(),
            pos: 0,
            pos_in_sequence: 0,
            size: seqs.len(),
        }
        .to();
        Ok(Self {
            ms,
            seq_store,
            store,
            rep: prev.rep,
            prev,
            dict: dict.to_vec(),
            src: src.to_vec(),
            use_row,
        })
    }

    pub fn run(&mut self, pos: usize, block_size: usize) -> Result<BlockOut, ErrorCode> {
        let ms = &mut self.ms;
        let src_addr = BufId::User.start() + pos;
        let max_dist = 1u32 << ms.c_params.window_log;
        if ms
            .window
            .dict_is_invalid(src_addr + block_size, max_dist, ms.loaded_dict_end)
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
        self.seq_store.reset();
        let mut last_ll = 0;
        if block_size < 7 {
            if ms.c_params.strat() >= Strategy::BtOpt {
                ldm::skip_raw_seq_store_bytes(&mut self.store, block_size)?;
            } else {
                ldm::skip_sequences(&mut self.store, block_size, ms.c_params.min_match)?;
            }
        } else {
            let bufs = Buffers {
                in_buff: &[],
                user: &self.src,
                dict: &self.dict,
            };
            let block = BlockSrc {
                buf: bufs.get(ms.window.base_buf),
                base: ms.window.base.wrapping_sub(ms.window.base_buf.start()),
                dict_buf: bufs.get(ms.window.dict_buf),
                dict_base: ms.window.dict_base.wrapping_sub(ms.window.dict_buf.start()),
                start: pos,
                end: pos + block_size,
                dms: None,
                symbol_costs: &self.prev.entropy,
                ldm_seq_store: None,
            };
            let curr = block.index_of(pos);
            if curr > ms.next_to_update + 384 {
                ms.next_to_update = curr - 192.min(curr - ms.next_to_update - 384);
            }
            last_ll = ldm::block_compress(
                &mut self.store,
                ms,
                &mut self.seq_store,
                &mut self.rep,
                self.use_row,
                &block,
            )?;
            self.seq_store
                .store_last_literals(&self.src[pos + block_size - last_ll..pos + block_size])?;
        }
        Ok(BlockOut {
            seqs: self
                .seq_store
                .sequences
                .iter()
                .map(|s| (s.off_base, s.lit_length, s.ml_base))
                .collect(),
            long_length: match self.seq_store.long_length_type {
                LongLengthType::None => None,
                LongLengthType::LiteralLength => Some((1, self.seq_store.long_length_pos)),
                LongLengthType::MatchLength => Some((2, self.seq_store.long_length_pos)),
            },
            literals: self.seq_store.literals().to_vec(),
            last_ll,
            rep: self.rep,
            next_to_update: self.ms.next_to_update,
            store: RawStore::from(&self.store),
        })
    }
}
