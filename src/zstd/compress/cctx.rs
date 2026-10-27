//! The part of `zstd_compress.c` that writes frames: `ZSTD_compressBegin`, `ZSTD_compressContinue`, `ZSTD_compressEnd`
//! and what they need.

use std::sync::Arc;

use super::block_entropy::{
    build_entropy_statistics_and_estimate_sub_block_size, count_seq_store_literals_bytes,
    count_seq_store_match_bytes, derive_seq_store_chunk, entropy_compress_seq_store,
};
use super::fse::FseRepeat;
use super::huf::{self, HufRepeat};
use super::internal::{
    BlockSrc, BufId, Buffers, CompressedBlockState, CompressionParameters, DictMatchState,
    DictTableLoadMethod, EntropyCTablesMetadata, HASH_READ_SIZE, LdmState, LongLengthType,
    MatchState, ParamSwitch, Prefix, RawSeq, RawSeqStore, RowTags, SeqChunk, SeqStore, Strategy,
    Table, TableFillPurpose, Window, ZSTD_CHUNKSIZE_MAX, ZSTD_CURRENT_MAX, ZSTD_DUBT_UNSORTED_MARK,
    ZSTD_OPT_SIZE, ZSTD_SHORT_CACHE_TAG_BITS, ZSTD_WINDOW_START_INDEX, min_gain, no_compress_block,
    offbase_is_repcode, offset_to_offbase, rle_compress_block, update_rep,
};
use super::params::{
    CCtxParams, CParamMode, Format, MatchStateSizes, Workspace, WorkspaceNeeds,
    adjust_c_params_internal, allocate_chain_table, cdict_indices_are_tagged, compress_bound,
    cycle_log, get_c_params_from_cctx_params, max_nb_seq, resolve_row_match_finder_mode,
    row_match_finder_used,
};
use super::superblock::compress_super_block;
use super::{compress_block, double_fast, fast, lazy, ldm, opt, presplit};
use crate::common::entropy::read_ncount;
use crate::common::xxhash::Xxh64;
use crate::common::{
    BlockType, LITBITS, LL_FSE_LOG, MAX_LL, MAX_ML, MAX_OFF, MIN_CBLOCK_SIZE, ML_FSE_LOG,
    OFF_FSE_LOG, ZSTD_BLOCKHEADERSIZE, ZSTD_BLOCKSIZE_MAX, ZSTD_CONTENTSIZE_UNKNOWN,
    ZSTD_FRAMEHEADERSIZE_MAX, ZSTD_MAGIC_DICTIONARY, ZSTD_MAGICNUMBER, ZSTD_REP_NUM,
    ZSTD_WINDOWLOG_ABSOLUTEMIN,
};
use crate::error::{ErrorCode, Result};
use crate::util::{
    SliceExt, highbit32, read_le32, try_zeroed, write_le16, write_le24, write_le32, write_le64,
};

/// `ZSTD_compressionStage_e`
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum CompressionStage {
    Created,
    Init,
    Ongoing,
    Ending,
}

/// `ZSTD_compResetPolicy_e`
#[derive(Clone, Copy, PartialEq, Eq)]
enum CompResetPolicy {
    MakeClean,
    /// The caller overwrites the tables.
    LeaveDirty,
}

/// `ZSTD_indexResetPolicy_e`
#[derive(Clone, Copy, PartialEq, Eq)]
enum IndexResetPolicy {
    /// Indices go on from where they are, which makes the ones in the tables invalid without erasing them.
    Continue,
    Reset,
}

/// `ZSTD_resetTarget_e`
#[derive(Clone, Copy, PartialEq, Eq)]
enum ResetTarget {
    CDict,
    CCtx,
}

/// `ZSTD_dictContentType_e`. Nothing asks for `ZSTD_dct_fullDict`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum DictContentType {
    Auto,
    RawContent,
}

/// Some bytes of one of the [`Buffers`].
#[derive(Clone, Copy)]
pub(crate) struct Span {
    pub(crate) buf: BufId,
    pub(crate) start: usize,
    pub(crate) end: usize,
}

impl Span {
    #[inline]
    const fn len(&self) -> usize {
        self.end - self.start
    }

    #[inline]
    const fn start_addr(&self) -> usize {
        self.buf.start() + self.start
    }

    #[inline]
    const fn end_addr(&self) -> usize {
        self.buf.start() + self.end
    }

    #[inline]
    fn bytes<'a>(&self, bufs: &Buffers<'a>) -> Result<&'a [u8]> {
        bufs.get(self.buf).sub(self.start..self.end)
    }
}

/// What the pointers of a `ZSTD_CCtx` lead to, that it does not own.
#[derive(Clone, Copy)]
pub(crate) struct Input<'a> {
    pub(crate) bufs: Buffers<'a>,
    pub(crate) cdict: Option<&'a CDict>,
}

fn window_prefix<'a>(window: &Window, bufs: &Buffers<'a>) -> Prefix<'a> {
    Prefix {
        buf: bufs.get(window.base_buf),
        base: window.base.wrapping_sub(window.base_buf.start()),
    }
}

/// `ZSTD_bitmix`
const fn bitmix(mut val: u64, len: u64) -> u64 {
    val ^= val.rotate_right(49) ^ val.rotate_right(24);
    val = val.wrapping_mul(0x9FB2_1C65_1E98_DF25);
    val ^= (val >> 35).wrapping_add(len);
    val = val.wrapping_mul(0x9FB2_1C65_1E98_DF25);
    val ^ (val >> 28)
}

/// `ZSTD_invalidateMatchState`
fn invalidate_match_state(ms: &mut MatchState) {
    ms.window.clear();
    ms.next_to_update = ms.window.dict_limit;
    ms.loaded_dict_end = 0;
    ms.opt.lit_length_sum = 0;
    ms.has_dict_match_state = false;
}

/// Gives `table` the length `len`. What it holds is 0, or if `clean` is false possibly what it held before.
pub(crate) fn reset_table<T: bun_pod::Zeroable + Copy + Default>(
    table: &mut Vec<T>,
    len: usize,
    clean: bool,
) -> Result<()> {
    if table.len() != len {
        // First, so that both are not allocated at once.
        *table = Vec::new();
        *table = try_zeroed(len)?;
    } else if clean {
        table.fill(T::default());
    }
    Ok(())
}

/// The same for a table of structures.
pub(crate) fn reset_struct_table<T: Clone + Default>(
    table: &mut Vec<T>,
    len: usize,
    clean: bool,
) -> Result<()> {
    if table.len() != len {
        *table = Vec::new();
        table
            .try_reserve_exact(len)
            .map_err(|_| ErrorCode::MemoryAllocation)?;
        table.resize(len, T::default());
    } else if clean {
        table.fill(T::default());
    }
    Ok(())
}

/// `ZSTD_reset_matchState`
fn reset_match_state(
    ms: &mut MatchState,
    c_params: &CompressionParameters,
    use_row_match_finder: ParamSwitch,
    crp: CompResetPolicy,
    force_reset_index: IndexResetPolicy,
    for_who: ResetTarget,
    src_size: Option<u64>,
) -> Result<()> {
    let sizes = MatchStateSizes::new(c_params, use_row_match_finder, for_who == ResetTarget::CCtx);

    if force_reset_index == IndexResetPolicy::Reset {
        ms.window = Window::new();
    }
    ms.hash_log3 = sizes.hash_log3;
    invalidate_match_state(ms);

    // As long as indices go on, the ones in the tables are too low to be valid.
    let clean = force_reset_index == IndexResetPolicy::Reset && crp != CompResetPolicy::LeaveDirty;
    let use_rows = row_match_finder_used(c_params.strat(), use_row_match_finder);
    // An entry of a row is written before it is read.
    ms.hash_table.reset(sizes.h_size, clean, !use_rows)?;
    reset_table(&mut ms.chain_table, sizes.chain_size, clean)?;
    reset_table(&mut ms.hash_table3, sizes.h3_size, clean)?;

    if use_rows {
        ms.row_tags = match for_who {
            ResetTarget::CCtx => lazy::row_tags_at_start(c_params, src_size),
            ResetTarget::CDict => RowTags::Flat,
        };
        let tag_table_size = lazy::row_tag_table_size(ms.row_tags, sizes.h_size);
        if for_who == ResetTarget::CCtx {
            // A new salt instead of erasing the tags.
            ms.tag_table.reset(tag_table_size, false, true)?;
            ms.hash_salt = bitmix(ms.hash_salt, 8) ^ bitmix(u64::from(ms.hash_salt_entropy), 4);
        } else {
            ms.tag_table.reset(tag_table_size, true, true)?;
            ms.hash_salt = 0;
        }
        let row_log = c_params.search_log.clamp(4, 6);
        ms.row_hash_log = c_params.hash_log - row_log;
    } else {
        ms.tag_table = Table::new();
    }

    if for_who == ResetTarget::CCtx && c_params.strat() >= Strategy::BtOpt {
        reset_table(&mut ms.opt.lit_freq, 1 << LITBITS, false)?;
        reset_table(&mut ms.opt.lit_length_freq, MAX_LL as usize + 1, false)?;
        reset_table(&mut ms.opt.match_length_freq, MAX_ML as usize + 1, false)?;
        reset_table(&mut ms.opt.off_code_freq, MAX_OFF as usize + 1, false)?;
        reset_struct_table(&mut ms.opt.match_table, ZSTD_OPT_SIZE, false)?;
        ms.opt.price_table.resize(ZSTD_OPT_SIZE)?;
    } else {
        ms.opt.match_table = Vec::new();
        ms.opt.price_table.resize(0)?;
    }

    ms.c_params = *c_params;
    Ok(())
}

/// `ZSTD_indexTooCloseToMax`: starting a frame this close to the limit would mean bringing indices down during it.
fn index_too_close_to_max(w: &Window) -> bool {
    const ZSTD_INDEXOVERFLOW_MARGIN: usize = 16 << 20;
    w.next_src.wrapping_sub(w.base) > ZSTD_CURRENT_MAX as usize - ZSTD_INDEXOVERFLOW_MARGIN
}

/// `ZSTD_reduceTable_internal`
fn reduce_table(table: &mut [u32], reducer_value: u32, preserve_mark: bool) {
    let reducer_threshold = reducer_value.wrapping_add(ZSTD_WINDOW_START_INDEX);
    for cell in table {
        *cell = if preserve_mark && *cell == ZSTD_DUBT_UNSORTED_MARK {
            ZSTD_DUBT_UNSORTED_MARK
        } else if *cell < reducer_threshold {
            0
        } else {
            *cell - reducer_value
        };
    }
}

/// `ZSTD_reduceIndex`
fn reduce_index(ms: &mut MatchState, params: &CCtxParams, reducer_value: u32) {
    reduce_table(&mut ms.hash_table, reducer_value, false);
    if allocate_chain_table(params.c_params.strat(), params.use_row_match_finder) {
        let preserve_mark = params.c_params.strat() == Strategy::BtLazy2;
        reduce_table(&mut ms.chain_table, reducer_value, preserve_mark);
    }
    if ms.hash_log3 != 0 {
        reduce_table(&mut ms.hash_table3, reducer_value, false);
    }
}

/// `ZSTD_overflowCorrectIfNeeded`
fn overflow_correct_if_needed(ms: &mut MatchState, params: &CCtxParams, ip: usize, iend: usize) {
    let cycle_log = cycle_log(params.c_params.chain_log, params.c_params.strat());
    let max_dist = 1u32 << params.c_params.window_log;
    if ms.window.need_overflow_correction(iend) {
        let correction = ms.window.correct_overflow(cycle_log, max_dist, ip);
        reduce_index(ms, params, correction);
        ms.next_to_update = ms.next_to_update.saturating_sub(correction);
        // The dictionary is out of reach by now.
        ms.loaded_dict_end = 0;
        ms.has_dict_match_state = false;
    }
}

/// `ZSTD_loadDictionaryContent`: makes `src` the start of the window, and indexes it.
///
/// The C code also indexes it for long distance matching if it is a prefix from the user, which there is none of here.
fn load_dictionary_content(
    ms: &mut MatchState,
    params: &CCtxParams,
    bufs: &Buffers<'_>,
    mut src: Span,
    dtlm: DictTableLoadMethod,
    tfp: TableFillPurpose,
) -> Result<()> {
    {
        // Indices have to fit, along with a tag in the tables that have one.
        let mut max_dict_size = ZSTD_CURRENT_MAX - ZSTD_WINDOW_START_INDEX;
        if cdict_indices_are_tagged(&params.c_params) && tfp == TableFillPurpose::ForCDict {
            let short_cache_max_dict_size =
                (1u32 << (32 - ZSTD_SHORT_CACHE_TAG_BITS)) - ZSTD_WINDOW_START_INDEX;
            max_dict_size = max_dict_size.min(short_cache_max_dict_size);
        }
        if src.len() > max_dict_size as usize {
            src.start = src.end - max_dict_size as usize;
        }
    }

    ms.window
        .update(src.start_addr(), src.buf, src.len(), false);

    {
        // More than the tables can hold is not worth indexing.
        let log = (params.c_params.hash_log + 3)
            .max(params.c_params.chain_log + 1)
            .min(31);
        let max_dict_size = 1usize << log;
        if src.len() > max_dict_size {
            src.start = src.end - max_dict_size;
        }
    }

    ms.next_to_update = ms.window.index_of(src.start_addr());
    ms.loaded_dict_end = if params.force_window {
        0
    } else {
        ms.window.index_of(src.end_addr())
    };
    ms.force_non_contiguous = false;

    if src.len() <= HASH_READ_SIZE {
        return Ok(());
    }

    overflow_correct_if_needed(ms, params, src.start_addr(), src.end_addr());

    let prefix = window_prefix(&ms.window, bufs);
    match params.c_params.strat() {
        Strategy::Fast => fast::fill_hash_table(ms, prefix, src.end, dtlm, tfp)?,
        Strategy::DFast => double_fast::fill_double_hash_table(ms, prefix, src.end, dtlm, tfp)?,
        Strategy::Greedy | Strategy::Lazy | Strategy::Lazy2 => {
            if params.use_row_match_finder == ParamSwitch::Enable {
                ms.tag_table.fill(0);
                lazy::row_update(ms, prefix, src.end - HASH_READ_SIZE)?;
            } else {
                lazy::insert_and_find_first_index(ms, prefix, src.end - HASH_READ_SIZE)?;
            }
        }
        Strategy::BtLazy2 | Strategy::BtOpt | Strategy::BtUltra | Strategy::BtUltra2 => {
            opt::update_tree(ms, prefix, src.end - HASH_READ_SIZE, src.end)?;
        }
    }

    ms.next_to_update = ms.window.index_of(src.end_addr());
    Ok(())
}

/// `ZSTD_dictNCountRepeat`: a table that has a code for every symbol can be used without checking.
fn dict_ncount_repeat(
    normalized_counter: &[i16],
    dict_max_symbol_value: u32,
    max_symbol_value: u32,
) -> FseRepeat {
    if dict_max_symbol_value < max_symbol_value {
        return FseRepeat::Check;
    }
    let counts = normalized_counter
        .iter()
        .take(max_symbol_value as usize + 1);
    if counts.into_iter().any(|&count| count == 0) {
        return FseRepeat::Check;
    }
    FseRepeat::Valid
}

/// `ZSTD_loadCEntropy`: reads the tables of the dictionary `dict` into `bs`. Returns where its content starts.
fn load_c_entropy(bs: &mut CompressedBlockState, dict: &[u8]) -> Result<usize> {
    const CORRUPTED: ErrorCode = ErrorCode::DictionaryCorrupted;
    let mut offcode_ncount = [0i16; MAX_OFF as usize + 1];
    let mut dict_ptr = 8usize;
    bs.entropy.huf.repeat_mode = HufRepeat::Check;

    {
        let stats = huf::read_ctable(&mut bs.entropy.huf.c_table, 255, dict.sub(dict_ptr..)?)
            .map_err(|_| CORRUPTED)?;
        // A table that has a code for every byte can be used without checking.
        if !stats.has_zero_weights && stats.max_symbol_value == 255 {
            bs.entropy.huf.repeat_mode = HufRepeat::Valid;
        }
        dict_ptr += stats.size;
    }

    let offcode_max_value = {
        let header = read_ncount(&mut offcode_ncount, MAX_OFF, dict.sub(dict_ptr..)?)
            .map_err(|_| CORRUPTED)?;
        if header.table_log > OFF_FSE_LOG {
            return Err(CORRUPTED);
        }
        (bs.entropy.fse.offcode_c_table)
            .build(&offcode_ncount, MAX_OFF, header.table_log)
            .map_err(|_| CORRUPTED)?;
        dict_ptr += header.size;
        header.max_symbol_value
    };

    {
        let mut matchlength_ncount = [0i16; MAX_ML as usize + 1];
        let header = read_ncount(&mut matchlength_ncount, MAX_ML, dict.sub(dict_ptr..)?)
            .map_err(|_| CORRUPTED)?;
        if header.table_log > ML_FSE_LOG {
            return Err(CORRUPTED);
        }
        (bs.entropy.fse.matchlength_c_table)
            .build(
                &matchlength_ncount,
                header.max_symbol_value,
                header.table_log,
            )
            .map_err(|_| CORRUPTED)?;
        bs.entropy.fse.matchlength_repeat_mode =
            dict_ncount_repeat(&matchlength_ncount, header.max_symbol_value, MAX_ML);
        dict_ptr += header.size;
    }

    {
        let mut litlength_ncount = [0i16; MAX_LL as usize + 1];
        let header = read_ncount(&mut litlength_ncount, MAX_LL, dict.sub(dict_ptr..)?)
            .map_err(|_| CORRUPTED)?;
        if header.table_log > LL_FSE_LOG {
            return Err(CORRUPTED);
        }
        (bs.entropy.fse.litlength_c_table)
            .build(&litlength_ncount, header.max_symbol_value, header.table_log)
            .map_err(|_| CORRUPTED)?;
        bs.entropy.fse.litlength_repeat_mode =
            dict_ncount_repeat(&litlength_ncount, header.max_symbol_value, MAX_LL);
        dict_ptr += header.size;
    }

    if dict_ptr + 12 > dict.len() {
        return Err(CORRUPTED);
    }
    bs.rep = [
        read_le32(dict, dict_ptr)?,
        read_le32(dict, dict_ptr + 4)?,
        read_le32(dict, dict_ptr + 8)?,
    ];
    dict_ptr += 12;

    {
        let dict_content_size = dict.len() - dict_ptr;
        let mut offcode_max = MAX_OFF;
        if dict_content_size <= u32::MAX as usize - (128 << 10) {
            // The largest offset that a first block can have.
            let max_offset = dict_content_size as u32 + (128 << 10);
            offcode_max = highbit32(max_offset);
        }
        bs.entropy.fse.offcode_repeat_mode =
            dict_ncount_repeat(&offcode_ncount, offcode_max_value, offcode_max.min(MAX_OFF));

        for rep in bs.rep {
            if rep == 0 || rep as usize > dict_content_size {
                return Err(CORRUPTED);
            }
        }
    }

    Ok(dict_ptr)
}

/// `ZSTD_compress_insertDictionary`: returns the ID of the dictionary, which is 0 if it has none.
fn compress_insert_dictionary(
    bs: &mut CompressedBlockState,
    ms: &mut MatchState,
    params: &CCtxParams,
    bufs: &Buffers<'_>,
    dict: Option<Span>,
    dict_content_type: DictContentType,
    dtlm: DictTableLoadMethod,
    tfp: TableFillPurpose,
) -> Result<u32> {
    let Some(dict) = dict.filter(|dict| dict.len() >= 8) else {
        return Ok(0);
    };

    bs.reset();

    let bytes = dict.bytes(bufs)?;
    if dict_content_type == DictContentType::RawContent
        || read_le32(bytes, 0)? != ZSTD_MAGIC_DICTIONARY
    {
        load_dictionary_content(ms, params, bufs, dict, dtlm, tfp)?;
        return Ok(0);
    }

    // `ZSTD_loadZstdDictionary`
    let dict_id = if params.f_params.no_dict_id_flag {
        0
    } else {
        read_le32(bytes, 4)?
    };
    let e_size = load_c_entropy(bs, bytes)?;
    let content = Span {
        start: dict.start + e_size,
        ..dict
    };
    load_dictionary_content(ms, params, bufs, content, dtlm, tfp)?;
    Ok(dict_id)
}

/// `ZSTD_CDict`: a dictionary that is indexed, ready to start frames with.
pub(crate) struct CDict {
    dict_content: Arc<Vec<u8>>,
    match_state: MatchState,
    c_block_state: Box<CompressedBlockState>,
    dict_id: u32,
    use_row_match_finder: ParamSwitch,
}

impl CDict {
    /// `ZSTD_createCDict_advanced2`
    pub(crate) fn new(dict: Arc<Vec<u8>>, original_cctx_params: &CCtxParams) -> Result<Self> {
        let mut params = *original_cctx_params;
        params.c_params = get_c_params_from_cctx_params(
            &params,
            ZSTD_CONTENTSIZE_UNKNOWN,
            dict.len(),
            CParamMode::CreateCDict,
        );
        params.use_row_match_finder =
            resolve_row_match_finder_mode(params.use_row_match_finder, &params.c_params);

        let mut cdict = Self {
            dict_content: dict,
            match_state: MatchState::new(),
            c_block_state: Box::new(CompressedBlockState::new()),
            dict_id: 0,
            use_row_match_finder: params.use_row_match_finder,
        };
        reset_match_state(
            &mut cdict.match_state,
            &params.c_params,
            params.use_row_match_finder,
            CompResetPolicy::MakeClean,
            IndexResetPolicy::Reset,
            ResetTarget::CDict,
            None,
        )?;
        let bufs = Buffers {
            in_buff: &[],
            user: &[],
            dict: &cdict.dict_content,
        };
        cdict.dict_id = compress_insert_dictionary(
            &mut cdict.c_block_state,
            &mut cdict.match_state,
            &params,
            &bufs,
            Some(Span {
                buf: BufId::Dict,
                start: 0,
                end: cdict.dict_content.len(),
            }),
            DictContentType::Auto,
            DictTableLoadMethod::Full,
            TableFillPurpose::ForCDict,
        )?;
        Ok(cdict)
    }

    pub(crate) fn dict_content(&self) -> &[u8] {
        &self.dict_content
    }

    pub(crate) const fn dict_id(&self) -> u32 {
        self.dict_id
    }

    fn dict_match_state(&self) -> DictMatchState<'_> {
        let window = &self.match_state.window;
        let start = BufId::Dict.start();
        DictMatchState {
            ms: &self.match_state,
            buf: &self.dict_content,
            base: window.base.wrapping_sub(start),
            end: window.next_src.wrapping_sub(start),
        }
    }

    /// `ZSTD_shouldAttachDict`: whether to search the tables of the dictionary, rather than start from a copy of them.
    pub(crate) fn should_attach(&self, params: &CCtxParams, pledged_src_size: u64) -> bool {
        let cutoff: u64 = match self.match_state.c_params.strat() {
            Strategy::Fast | Strategy::BtUltra | Strategy::BtUltra2 => 8 << 10,
            Strategy::DFast => 16 << 10,
            _ => 32 << 10,
        };
        (pledged_src_size <= cutoff || pledged_src_size == ZSTD_CONTENTSIZE_UNKNOWN)
            && !params.force_window
    }
}

/// `ZSTD_isRLE`: `src` is not empty.
fn is_rle(src: &[u8]) -> bool {
    let Some((&value, rest)) = src.split_first() else {
        return false;
    };
    let (chunks, tail) = rest.as_chunks::<32>();
    chunks.iter().all(|chunk| *chunk == [value; 32]) && tail.iter().all(|&b| b == value)
}

/// `ZSTD_maybeRLE`
fn maybe_rle(seq_store: &SeqStore) -> bool {
    seq_store.sequences.len() < 4 && seq_store.lit_len < 10
}

/// `writeBlockHeader`
fn write_block_header(
    op: &mut [u8],
    c_size: usize,
    block_size: usize,
    last_block: bool,
) -> Result<()> {
    let c_block_header = if c_size == 1 {
        u32::from(last_block) + ((BlockType::Rle as u32) << 1) + ((block_size as u32) << 3)
    } else {
        u32::from(last_block) + ((BlockType::Compressed as u32) << 1) + ((c_size as u32) << 3)
    };
    write_le24(op, 0, c_block_header)
}

/// `ZSTD_resolveRepcodeToRawOffset`
fn resolve_repcode_to_raw_offset(rep: &[u32; ZSTD_REP_NUM], off_base: u32, ll0: bool) -> u32 {
    let [rep0, ..] = *rep;
    let adjusted_rep_code = off_base - 1 + u32::from(ll0);
    match rep.get(adjusted_rep_code as usize) {
        Some(&offset) => offset,
        None => rep0.wrapping_sub(1),
    }
}

/// `ZSTD_seqStore_resolveOffCodes`: a block that ends up uncompressed leaves the repeat offsets of the decoder,
/// `d_repcodes`, behind those that the sequences were found with, `c_repcodes`. Where they disagree, the repeat codes
/// of `chunk` are replaced by the offsets they stand for.
fn seq_store_resolve_off_codes(
    d_repcodes: &mut [u32; ZSTD_REP_NUM],
    c_repcodes: &mut [u32; ZSTD_REP_NUM],
    store: &mut SeqStore,
    chunk: &SeqChunk,
) -> Result<()> {
    let sequences = store.sequences.sub_mut(chunk.seq_start..chunk.seq_end)?;
    let long_lit_len_idx = if chunk.long_length_type == LongLengthType::LiteralLength {
        chunk.long_length_pos as usize
    } else {
        sequences.len()
    };
    for (idx, seq) in sequences.iter_mut().enumerate() {
        let ll0 = seq.lit_length == 0 && idx != long_lit_len_idx;
        let off_base = seq.off_base;
        if offbase_is_repcode(off_base) {
            let d_raw_offset = resolve_repcode_to_raw_offset(d_repcodes, off_base, ll0);
            let c_raw_offset = resolve_repcode_to_raw_offset(c_repcodes, off_base, ll0);
            if d_raw_offset != c_raw_offset {
                seq.off_base = offset_to_offbase(c_raw_offset);
            }
        }
        update_rep(d_repcodes, seq.off_base, ll0);
        update_rep(c_repcodes, off_base, ll0);
    }
    Ok(())
}

/// `ZSTD_writeFrameHeader`
fn write_frame_header(
    dst: &mut [u8],
    params: &CCtxParams,
    pledged_src_size: u64,
    dict_id: u32,
) -> Result<usize> {
    let dict_id_size_code_length =
        u32::from(dict_id > 0) + u32::from(dict_id >= 256) + u32::from(dict_id >= 65536);
    let dict_id_size_code = if params.f_params.no_dict_id_flag {
        0
    } else {
        dict_id_size_code_length
    };
    let checksum_flag = u32::from(params.f_params.checksum_flag);
    let window_size = 1u32 << params.c_params.window_log;
    let single_segment =
        params.f_params.content_size_flag && u64::from(window_size) >= pledged_src_size;
    let window_log_byte = ((params.c_params.window_log - ZSTD_WINDOWLOG_ABSOLUTEMIN) << 3) as u8;
    let fcs_code = if params.f_params.content_size_flag {
        u32::from(pledged_src_size >= 256)
            + u32::from(pledged_src_size >= 65536 + 256)
            + u32::from(pledged_src_size >= 0xFFFF_FFFF)
    } else {
        0
    };
    let frame_header_description_byte = (dict_id_size_code
        + (checksum_flag << 2)
        + (u32::from(single_segment) << 5)
        + (fcs_code << 6)) as u8;
    let mut pos = 0usize;

    if dst.len() < ZSTD_FRAMEHEADERSIZE_MAX {
        return Err(ErrorCode::DstSizeTooSmall);
    }
    if params.format == Format::Zstd1 {
        write_le32(dst, 0, ZSTD_MAGICNUMBER)?;
        pos = 4;
    }
    dst.put(pos, frame_header_description_byte)?;
    pos += 1;
    if !single_segment {
        dst.put(pos, window_log_byte)?;
        pos += 1;
    }
    match dict_id_size_code {
        0 => {}
        1 => {
            dst.put(pos, dict_id as u8)?;
            pos += 1;
        }
        2 => {
            write_le16(dst, pos, dict_id as u16)?;
            pos += 2;
        }
        _ => {
            write_le32(dst, pos, dict_id)?;
            pos += 4;
        }
    }
    match fcs_code {
        0 => {
            if single_segment {
                dst.put(pos, pledged_src_size as u8)?;
                pos += 1;
            }
        }
        1 => {
            write_le16(dst, pos, (pledged_src_size - 256) as u16)?;
            pos += 2;
        }
        2 => {
            write_le32(dst, pos, pledged_src_size as u32)?;
            pos += 4;
        }
        _ => {
            write_le64(dst, pos, pledged_src_size)?;
            pos += 8;
        }
    }
    Ok(pos)
}

/// `ZSTD_writeLastEmptyBlock`
pub(crate) fn write_last_empty_block(dst: &mut [u8]) -> Result<usize> {
    if dst.len() < ZSTD_BLOCKHEADERSIZE {
        return Err(ErrorCode::DstSizeTooSmall);
    }
    write_le24(dst, 0, 1 + ((BlockType::Raw as u32) << 1))?;
    Ok(ZSTD_BLOCKHEADERSIZE)
}

/// `ZSTD_BuildSeqStore_e`
#[derive(Clone, Copy, PartialEq, Eq)]
enum BuildSeqStore {
    Compress,
    NoCompress,
}

/// The C code stops splitting at 196 parts, but the calls under way at that time each still add one, past the end of
/// its array, in memory that happens to be free.
const ZSTD_MAX_NB_BLOCK_SPLITS: usize = 196;
const PARTITIONS_LEN: usize = ZSTD_MAX_NB_BLOCK_SPLITS + 20;

/// `seqStoreSplits`
struct SeqStoreSplits {
    split_locations: [u32; PARTITIONS_LEN],
    idx: usize,
}

/// The sizes of the buffers that streaming takes.
pub(crate) struct BufferSizes {
    pub(crate) buff_in_size: usize,
    pub(crate) buff_out_size: usize,
}

/// The part of a `ZSTD_CCtx` that writes frames from blocks of input.
pub(crate) struct FrameCompressor {
    pub(crate) stage: CompressionStage,
    pub(crate) applied_params: CCtxParams,
    pub(crate) dict_id: u32,
    pub(crate) dict_content_size: usize,
    workspace: Workspace,
    /// See [`Self::for_worker`].
    room_for_any_block: bool,
    pub(crate) block_size_max: usize,
    pub(crate) pledged_src_size_plus_one: u64,
    pub(crate) consumed_src_size: u64,
    pub(crate) produced_c_size: u64,
    xxh_state: Xxh64,
    is_first_block: bool,
    initialized: bool,
    seq_store: SeqStore,
    ldm_state: LdmState,
    ldm_sequences: RawSeqStore,
    extern_seq_store: RawSeqStore,
    prev_c_block: Box<CompressedBlockState>,
    next_c_block: Box<CompressedBlockState>,
    match_state: MatchState,
}

const fn empty_raw_seq_store() -> RawSeqStore {
    RawSeqStore {
        seq: Vec::new(),
        pos: 0,
        pos_in_sequence: 0,
        size: 0,
        capacity: 0,
    }
}

impl FrameCompressor {
    pub(crate) fn new() -> Self {
        Self {
            stage: CompressionStage::Created,
            applied_params: CCtxParams::new(0),
            dict_id: 0,
            dict_content_size: 0,
            workspace: Workspace::new(),
            room_for_any_block: false,
            block_size_max: 0,
            pledged_src_size_plus_one: 0,
            consumed_src_size: 0,
            produced_c_size: 0,
            xxh_state: Xxh64::new(),
            is_first_block: true,
            initialized: false,
            seq_store: SeqStore::new(),
            ldm_state: LdmState::new(),
            ldm_sequences: empty_raw_seq_store(),
            extern_seq_store: empty_raw_seq_store(),
            prev_c_block: Box::new(CompressedBlockState::new()),
            next_c_block: Box::new(CompressedBlockState::new()),
            match_state: MatchState::new(),
        }
    }

    /// For the jobs of one worker. The size of a job is all it is told about the size of the input, and a workspace that
    /// is too small for a job a little larger than those before would be replaced, which clears the tables. The C code
    /// hardly gets there, as small jobs all go to the context that had the first job of the frame, which did not know
    /// the size. Which context a job goes to is a matter of timing there, so it cannot show in the output.
    pub(crate) fn for_worker() -> Self {
        Self {
            room_for_any_block: true,
            ..Self::new()
        }
    }

    /// `ZSTD_resetCCtx_internal`
    fn reset_internal(
        &mut self,
        params: &CCtxParams,
        pledged_src_size: u64,
        loaded_dict_size: usize,
        crp: CompResetPolicy,
        buffered: bool,
    ) -> Result<BufferSizes> {
        self.is_first_block = true;
        self.applied_params = *params;
        if self.applied_params.ldm_params.enable_ldm == ParamSwitch::Enable {
            ldm::adjust_parameters(&mut self.applied_params.ldm_params, &params.c_params);
        }
        let params = self.applied_params;

        let window_size = (1u64 << params.c_params.window_log)
            .min(pledged_src_size)
            .max(1) as usize;
        let block_size = ZSTD_BLOCKSIZE_MAX.min(window_size);
        let max_nb_seq = max_nb_seq(block_size, params.c_params.min_match);
        let sizes = BufferSizes {
            buff_out_size: if buffered {
                compress_bound(block_size) + 1
            } else {
                0
            },
            buff_in_size: if buffered {
                window_size + block_size
            } else {
                0
            },
        };
        let max_nb_ldm_seq = ldm::get_max_nb_seq(params.ldm_params, block_size);

        let index_too_close = index_too_close_to_max(&self.match_state.window);
        let dict_too_big = loaded_dict_size > ZSTD_CHUNKSIZE_MAX as usize;
        let mut needs_index_reset = if index_too_close || dict_too_big || !self.initialized {
            IndexResetPolicy::Reset
        } else {
            IndexResetPolicy::Continue
        };
        if self.workspace.reset(&WorkspaceNeeds {
            c_params: &params.c_params,
            ldm_params: &params.ldm_params,
            use_row_match_finder: params.use_row_match_finder,
            buff_in_size: sizes.buff_in_size,
            buff_out_size: sizes.buff_out_size,
            block_size: if self.room_for_any_block {
                ZSTD_BLOCKSIZE_MAX.min(1 << params.c_params.window_log)
            } else {
                block_size
            },
        }) {
            needs_index_reset = IndexResetPolicy::Reset;
        }

        self.match_state.c_params = params.c_params;
        self.pledged_src_size_plus_one = pledged_src_size.wrapping_add(1);
        self.consumed_src_size = 0;
        self.produced_c_size = 0;
        if pledged_src_size == ZSTD_CONTENTSIZE_UNKNOWN {
            self.applied_params.f_params.content_size_flag = false;
        }
        self.block_size_max = block_size;

        self.xxh_state = Xxh64::new();
        self.stage = CompressionStage::Init;
        self.dict_id = 0;
        self.dict_content_size = 0;

        self.prev_c_block.reset();

        reset_match_state(
            &mut self.match_state,
            &params.c_params,
            params.use_row_match_finder,
            crp,
            needs_index_reset,
            ResetTarget::CCtx,
            (pledged_src_size != ZSTD_CONTENTSIZE_UNKNOWN).then_some(pledged_src_size),
        )?;

        if params.ldm_params.enable_ldm == ParamSwitch::Enable {
            let ldm_h_size = 1usize << params.ldm_params.hash_log;
            reset_struct_table(&mut self.ldm_state.hash_table, ldm_h_size, true)?;
            reset_struct_table(&mut self.ldm_sequences.seq, max_nb_ldm_seq, false)?;
            self.ldm_sequences.capacity = max_nb_ldm_seq;
            self.ldm_state.window = Window::new();
            self.ldm_state.loaded_dict_end = 0;
            let num_buckets =
                1usize << (params.ldm_params.hash_log - params.ldm_params.bucket_size_log);
            reset_table(&mut self.ldm_state.bucket_offsets, num_buckets, true)?;
        } else {
            self.ldm_state.hash_table = Vec::new();
            self.ldm_state.bucket_offsets = Vec::new();
            self.ldm_sequences = empty_raw_seq_store();
        }

        if self.seq_store.max_nb_seq != max_nb_seq || self.seq_store.max_nb_lit != block_size {
            self.seq_store.reserve(max_nb_seq, block_size)?;
        }
        self.reference_external_sequences(Vec::new());

        self.initialized = true;
        Ok(sizes)
    }

    /// `ZSTD_invalidateRepCodes`
    pub(crate) fn invalidate_rep_codes(&mut self) {
        self.prev_c_block.rep = [0; ZSTD_REP_NUM];
    }

    /// `ZSTD_resetCCtx_byAttachingCDict`
    fn reset_by_attaching_cdict(
        &mut self,
        cdict: &CDict,
        mut params: CCtxParams,
        pledged_src_size: u64,
        buffered: bool,
    ) -> Result<BufferSizes> {
        let window_log = params.c_params.window_log;
        // The tables only have to hold the input.
        params.c_params = adjust_c_params_internal(
            cdict.match_state.c_params,
            pledged_src_size,
            cdict.dict_content.len(),
            CParamMode::AttachDict,
            params.use_row_match_finder,
        );
        params.c_params.window_log = window_log;
        params.use_row_match_finder = cdict.use_row_match_finder;
        let sizes = self.reset_internal(
            &params,
            pledged_src_size,
            0,
            CompResetPolicy::MakeClean,
            buffered,
        )?;

        let cdict_window = &cdict.match_state.window;
        let cdict_end = cdict_window.index_of(cdict_window.next_src);
        let cdict_len = cdict_end.wrapping_sub(cdict_window.dict_limit);
        if cdict_len != 0 {
            let ms = &mut self.match_state;
            ms.has_dict_match_state = true;
            // The indices of the input have to be above those of the dictionary.
            if ms.window.dict_limit < cdict_end {
                ms.window.next_src = ms.window.base.wrapping_add(cdict_end as usize);
                ms.window.clear();
            }
            ms.loaded_dict_end = ms.window.dict_limit;
        }

        self.dict_id = cdict.dict_id;
        self.dict_content_size = cdict.dict_content.len();
        self.prev_c_block.clone_from(&cdict.c_block_state);
        Ok(sizes)
    }

    /// `ZSTD_resetCCtx_byCopyingCDict`
    fn reset_by_copying_cdict(
        &mut self,
        cdict: &CDict,
        mut params: CCtxParams,
        pledged_src_size: u64,
        buffered: bool,
    ) -> Result<BufferSizes> {
        /// `ZSTD_copyCDictTableIntoCCtx`
        fn copy_table(dst: &mut [u32], src: &[u32], tagged: bool) -> Result<()> {
            if tagged {
                for (dst, &tagged_index) in dst.iter_mut().zip(src) {
                    *dst = tagged_index >> ZSTD_SHORT_CACHE_TAG_BITS;
                }
                Ok(())
            } else {
                dst.write_at(0, src)
            }
        }

        let cdict_c_params = cdict.match_state.c_params;
        let window_log = params.c_params.window_log;
        params.c_params = cdict_c_params;
        params.c_params.window_log = window_log;
        params.use_row_match_finder = cdict.use_row_match_finder;
        let sizes = self.reset_internal(
            &params,
            pledged_src_size,
            0,
            CompResetPolicy::LeaveDirty,
            buffered,
        )?;

        let src = &cdict.match_state;
        let dst = &mut self.match_state;
        let tagged = cdict_indices_are_tagged(&cdict_c_params);
        copy_table(&mut dst.hash_table, &src.hash_table, tagged)?;
        copy_table(&mut dst.chain_table, &src.chain_table, tagged)?;
        if row_match_finder_used(cdict_c_params.strat(), cdict.use_row_match_finder) {
            dst.tag_table.write_at(0, &src.tag_table)?;
            dst.row_tags = RowTags::Flat;
            dst.hash_salt = src.hash_salt;
        }
        dst.hash_table3.fill(0);

        dst.window = src.window;
        dst.next_to_update = src.next_to_update;
        dst.loaded_dict_end = src.loaded_dict_end;

        self.dict_id = cdict.dict_id;
        self.dict_content_size = cdict.dict_content.len();
        self.prev_c_block.clone_from(&cdict.c_block_state);
        Ok(sizes)
    }

    /// `ZSTD_compressBegin_internal`: `dict` is content to start the window with, when there is no `input.cdict`.
    pub(crate) fn begin(
        &mut self,
        input: &Input<'_>,
        dict: Option<Span>,
        dict_content_type: DictContentType,
        dtlm: DictTableLoadMethod,
        params: &CCtxParams,
        pledged_src_size: u64,
        buffered: bool,
    ) -> Result<BufferSizes> {
        if let Some(cdict) = input.cdict
            && !cdict.dict_content.is_empty()
        {
            // `ZSTD_resetCCtx_usingCDict`
            return if cdict.should_attach(params, pledged_src_size) {
                self.reset_by_attaching_cdict(cdict, *params, pledged_src_size, buffered)
            } else {
                self.reset_by_copying_cdict(cdict, *params, pledged_src_size, buffered)
            };
        }

        let dict_content_size = dict.map_or(0, |dict| dict.len());
        let sizes = self.reset_internal(
            params,
            pledged_src_size,
            dict_content_size,
            CompResetPolicy::MakeClean,
            buffered,
        )?;
        self.dict_id = compress_insert_dictionary(
            &mut self.prev_c_block,
            &mut self.match_state,
            &self.applied_params,
            &input.bufs,
            dict,
            dict_content_type,
            dtlm,
            TableFillPurpose::ForCCtx,
        )?;
        self.dict_content_size = dict_content_size;
        Ok(sizes)
    }

    /// `ZSTD_referenceExternalSequences`: long distance matches for the input to come.
    pub(crate) fn reference_external_sequences(&mut self, seq: Vec<RawSeq>) {
        self.extern_seq_store = RawSeqStore {
            pos: 0,
            pos_in_sequence: 0,
            size: seq.len(),
            capacity: seq.len(),
            seq,
        };
    }

    /// Takes back what [`Self::reference_external_sequences`] was given.
    pub(crate) fn take_external_sequences(&mut self) -> Vec<RawSeq> {
        core::mem::replace(&mut self.extern_seq_store, empty_raw_seq_store()).seq
    }

    /// `ZSTD_blockState_confirmRepcodesAndEntropyTables`
    fn confirm_repcodes_and_entropy_tables(&mut self) {
        core::mem::swap(&mut self.prev_c_block, &mut self.next_c_block);
    }

    /// A table for offsets that comes from a dictionary is only known to be valid for the first block.
    fn downgrade_offcode_repeat_mode(&mut self) {
        let mode = &mut self.prev_c_block.entropy.fse.offcode_repeat_mode;
        if *mode == FseRepeat::Valid {
            *mode = FseRepeat::Check;
        }
    }

    /// `ZSTD_buildSeqStore`
    fn build_seq_store(&mut self, input: &Input<'_>, src: Span) -> Result<BuildSeqStore> {
        let params = &self.applied_params;
        let ms = &mut self.match_state;
        let src_size = src.len();
        if src_size < MIN_CBLOCK_SIZE + ZSTD_BLOCKHEADERSIZE + 1 + 1 {
            if params.c_params.strat() >= Strategy::BtOpt {
                ldm::skip_raw_seq_store_bytes(&mut self.extern_seq_store, src_size)?;
            } else {
                ldm::skip_sequences(
                    &mut self.extern_seq_store,
                    src_size,
                    params.c_params.min_match,
                )?;
            }
            return Ok(BuildSeqStore::NoCompress);
        }
        self.seq_store.reset();
        ms.opt.literal_compression_mode = ParamSwitch::Auto;

        {
            // Not to spend too long catching up after incompressible data.
            let curr = ms.window.index_of(src.start_addr());
            if curr > ms.next_to_update.wrapping_add(384) {
                let behind = curr.wrapping_sub(ms.next_to_update).wrapping_sub(384);
                ms.next_to_update = curr - behind.min(192);
            }
        }

        let window = ms.window;
        let block = BlockSrc {
            buf: input.bufs.get(window.base_buf),
            base: window.base.wrapping_sub(window.base_buf.start()),
            dict_buf: input.bufs.get(window.dict_buf),
            dict_base: window.dict_base.wrapping_sub(window.dict_buf.start()),
            start: src.start,
            end: src.end,
            dms: match input.cdict {
                Some(cdict) if ms.has_dict_match_state => Some(cdict.dict_match_state()),
                _ => None,
            },
            symbol_costs: &self.prev_c_block.entropy,
            ldm_seq_store: None,
        };
        let dict_mode = ms.dict_mode(block.dms.as_ref());
        let use_row_match_finder = params.use_row_match_finder == ParamSwitch::Enable;
        self.next_c_block.rep = self.prev_c_block.rep;
        let rep = &mut self.next_c_block.rep;

        let last_ll_size = if self.extern_seq_store.pos < self.extern_seq_store.size {
            ldm::block_compress(
                &mut self.extern_seq_store,
                ms,
                &mut self.seq_store,
                rep,
                use_row_match_finder,
                &block,
            )?
        } else if params.ldm_params.enable_ldm == ParamSwitch::Enable {
            let ldm_seq_store = &mut self.ldm_sequences;
            ldm_seq_store.pos = 0;
            ldm_seq_store.pos_in_sequence = 0;
            ldm_seq_store.size = 0;
            ldm::generate_sequences(
                &mut self.ldm_state,
                ldm_seq_store,
                &params.ldm_params,
                &input.bufs,
                src.start,
                src.end,
            )?;
            ldm::block_compress(
                ldm_seq_store,
                ms,
                &mut self.seq_store,
                rep,
                use_row_match_finder,
                &block,
            )?
        } else {
            compress_block(
                ms,
                &mut self.seq_store,
                rep,
                &block,
                params.c_params.strat(),
                use_row_match_finder,
                dict_mode,
            )?
        };
        let last_literals = block.buf.sub(src.end - last_ll_size..src.end)?;
        self.seq_store.store_last_literals(last_literals)?;
        Ok(BuildSeqStore::Compress)
    }

    /// `ZSTD_compressSeqStore_singleBlock`
    fn compress_seq_store_single_block(
        &mut self,
        chunk: &SeqChunk,
        d_rep: &mut [u32; ZSTD_REP_NUM],
        c_rep: &mut [u32; ZSTD_REP_NUM],
        dst: &mut [u8],
        src: &[u8],
        last_block: bool,
        is_partition: bool,
    ) -> Result<usize> {
        const RLE_MAX_LENGTH: usize = 25;
        let d_rep_original = *d_rep;
        if is_partition {
            seq_store_resolve_off_codes(d_rep, c_rep, &mut self.seq_store, chunk)?;
        }

        if dst.len() < ZSTD_BLOCKHEADERSIZE {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        let mut c_seqs_size = entropy_compress_seq_store(
            &mut self.seq_store,
            chunk,
            &self.prev_c_block.entropy,
            &mut self.next_c_block.entropy,
            &self.applied_params,
            dst.sub_mut(ZSTD_BLOCKHEADERSIZE..)?,
            src.len(),
        )?;

        if !self.is_first_block && c_seqs_size < RLE_MAX_LENGTH && is_rle(src) {
            // Decoders up to 1.4.3 do not take a first block that is a run.
            c_seqs_size = 1;
        }

        let c_size = match c_seqs_size {
            0 => {
                *d_rep = d_rep_original;
                no_compress_block(dst, src, last_block)?
            }
            1 => {
                *d_rep = d_rep_original;
                rle_compress_block(dst, src.at(0)?, src.len(), last_block)?
            }
            _ => {
                self.confirm_repcodes_and_entropy_tables();
                write_block_header(dst, c_seqs_size, src.len(), last_block)?;
                ZSTD_BLOCKHEADERSIZE + c_seqs_size
            }
        };

        self.downgrade_offcode_repeat_mode();
        Ok(c_size)
    }

    /// `ZSTD_deriveBlockSplitsHelper`: splits the sequences from `start_idx` to `end_idx` in two if that looks
    /// smaller, then each half likewise.
    fn derive_block_splits_helper(
        &mut self,
        splits: &mut SeqStoreSplits,
        start_idx: usize,
        end_idx: usize,
        entropy_metadata: &mut EntropyCTablesMetadata,
    ) -> Result<()> {
        const MIN_SEQUENCES_BLOCK_SPLITTING: usize = 300;
        let mid_idx = (start_idx + end_idx) / 2;

        if end_idx - start_idx < MIN_SEQUENCES_BLOCK_SPLITTING
            || splits.idx >= ZSTD_MAX_NB_BLOCK_SPLITS
        {
            return Ok(());
        }
        let mut estimate = |from: usize, to: usize| -> Result<Result<usize>> {
            let chunk = derive_seq_store_chunk(&self.seq_store, from, to)?;
            Ok(build_entropy_statistics_and_estimate_sub_block_size(
                &mut self.seq_store,
                &chunk,
                &self.prev_c_block.entropy,
                &mut self.next_c_block.entropy,
                &self.applied_params,
                entropy_metadata,
            ))
        };
        let estimated_original_size = estimate(start_idx, end_idx)?;
        let estimated_first_half_size = estimate(start_idx, mid_idx)?;
        let estimated_second_half_size = estimate(mid_idx, end_idx)?;
        let (Ok(original), Ok(first_half), Ok(second_half)) = (
            estimated_original_size,
            estimated_first_half_size,
            estimated_second_half_size,
        ) else {
            return Ok(());
        };
        if first_half + second_half < original {
            self.derive_block_splits_helper(splits, start_idx, mid_idx, entropy_metadata)?;
            splits.split_locations.put(splits.idx, mid_idx as u32)?;
            splits.idx += 1;
            self.derive_block_splits_helper(splits, mid_idx, end_idx, entropy_metadata)?;
        }
        Ok(())
    }

    /// `ZSTD_compressBlock_splitBlock_internal`
    fn compress_block_split_block_internal(
        &mut self,
        dst: &mut [u8],
        src: &[u8],
        last_block: bool,
    ) -> Result<usize> {
        let nb_seq = self.seq_store.sequences.len();
        let block_size = src.len();
        let mut c_size = 0usize;
        let mut ip = 0usize;
        let mut src_bytes_total = 0usize;

        // `ZSTD_deriveBlockSplits`
        let mut splits = SeqStoreSplits {
            split_locations: [0; PARTITIONS_LEN],
            idx: 0,
        };
        if nb_seq > 4 {
            let mut entropy_metadata = EntropyCTablesMetadata::new();
            self.derive_block_splits_helper(&mut splits, 0, nb_seq, &mut entropy_metadata)?;
            splits.split_locations.put(splits.idx, nb_seq as u32)?;
        }
        let num_splits = splits.idx;
        let partitions = &splits.split_locations;

        let mut d_rep = self.prev_c_block.rep;
        let mut c_rep = self.prev_c_block.rep;

        if num_splits == 0 {
            let whole = self.seq_store.whole();
            return self.compress_seq_store_single_block(
                &whole, &mut d_rep, &mut c_rep, dst, src, last_block, false,
            );
        }

        let mut curr_seq_store =
            derive_seq_store_chunk(&self.seq_store, 0, partitions.at(0)? as usize)?;
        for i in 0..=num_splits {
            let last_partition = i == num_splits;
            let mut last_block_entire_src = false;

            let mut src_bytes = count_seq_store_literals_bytes(&self.seq_store, &curr_seq_store)?
                + count_seq_store_match_bytes(&self.seq_store, &curr_seq_store)?;
            src_bytes_total += src_bytes;
            let mut next_seq_store = curr_seq_store;
            if last_partition {
                // The last literals are in no sequence.
                src_bytes += block_size - src_bytes_total;
                last_block_entire_src = last_block;
            } else {
                next_seq_store = derive_seq_store_chunk(
                    &self.seq_store,
                    partitions.at(i)? as usize,
                    partitions.at(i + 1)? as usize,
                )?;
            }

            let c_size_chunk = self.compress_seq_store_single_block(
                &curr_seq_store,
                &mut d_rep,
                &mut c_rep,
                dst.sub_mut(c_size..)?,
                src.span(ip, src_bytes)?,
                last_block_entire_src,
                true,
            )?;

            ip += src_bytes;
            c_size += c_size_chunk;
            curr_seq_store = next_seq_store;
        }
        // What the decoder ends up with, which is not what the sequences were found with if a part is uncompressed.
        self.prev_c_block.rep = d_rep;
        Ok(c_size)
    }

    /// `ZSTD_compressBlock_splitBlock`
    fn compress_block_split_block(
        &mut self,
        dst: &mut [u8],
        input: &Input<'_>,
        src: Span,
        last_block: bool,
    ) -> Result<usize> {
        let bytes = src.bytes(&input.bufs)?;
        if self.build_seq_store(input, src)? == BuildSeqStore::NoCompress {
            self.downgrade_offcode_repeat_mode();
            return no_compress_block(dst, bytes, last_block);
        }
        self.compress_block_split_block_internal(dst, bytes, last_block)
    }

    /// `ZSTD_compressBlock_internal`: the content of a block, which is 1 byte for a run. Returns 0 if the block is
    /// better left uncompressed.
    fn compress_block_internal(
        &mut self,
        dst: &mut [u8],
        input: &Input<'_>,
        src: Span,
    ) -> Result<usize> {
        const RLE_MAX_LENGTH: usize = 25;
        let bytes = src.bytes(&input.bufs)?;

        let c_size = match self.build_seq_store(input, src)? {
            BuildSeqStore::NoCompress => Ok(0),
            BuildSeqStore::Compress => {
                let whole = self.seq_store.whole();
                let mut c_size = entropy_compress_seq_store(
                    &mut self.seq_store,
                    &whole,
                    &self.prev_c_block.entropy,
                    &mut self.next_c_block.entropy,
                    &self.applied_params,
                    dst,
                    bytes.len(),
                );
                if !self.is_first_block
                    && c_size.is_ok_and(|c_size| c_size < RLE_MAX_LENGTH)
                    && is_rle(bytes)
                {
                    dst.put(0, bytes.at(0)?)?;
                    c_size = Ok(1);
                }
                c_size
            }
        };

        if c_size.is_ok_and(|c_size| c_size > 1) {
            self.confirm_repcodes_and_entropy_tables();
        }
        self.downgrade_offcode_repeat_mode();
        c_size
    }

    /// `ZSTD_compressBlock_targetCBlockSize`
    fn compress_block_target_c_block_size(
        &mut self,
        dst: &mut [u8],
        input: &Input<'_>,
        src: Span,
        last_block: bool,
    ) -> Result<usize> {
        let bytes = src.bytes(&input.bufs)?;
        let bss = self.build_seq_store(input, src)?;
        let c_size = self.compress_block_target_c_block_size_body(dst, bytes, bss, last_block)?;
        self.downgrade_offcode_repeat_mode();
        Ok(c_size)
    }

    /// `ZSTD_compressBlock_targetCBlockSize_body`
    fn compress_block_target_c_block_size_body(
        &mut self,
        dst: &mut [u8],
        src: &[u8],
        bss: BuildSeqStore,
        last_block: bool,
    ) -> Result<usize> {
        if bss == BuildSeqStore::Compress {
            if !self.is_first_block && maybe_rle(&self.seq_store) && is_rle(src) {
                return rle_compress_block(dst, src.at(0)?, src.len(), last_block);
            }
            match compress_super_block(
                &mut self.seq_store,
                &self.prev_c_block,
                &mut self.next_c_block,
                &self.applied_params,
                dst,
                src,
                last_block,
            ) {
                Err(ErrorCode::DstSizeTooSmall) => {}
                c_size => {
                    let c_size = c_size?;
                    let max_c_size = src
                        .len()
                        .wrapping_sub(min_gain(src.len(), self.applied_params.c_params.strat()));
                    if c_size != 0 && c_size < max_c_size.wrapping_add(ZSTD_BLOCKHEADERSIZE) {
                        self.confirm_repcodes_and_entropy_tables();
                        return Ok(c_size);
                    }
                }
            }
        }
        no_compress_block(dst, src, last_block)
    }

    /// `ZSTD_optimalBlockSize`: `src` is what remains of the input.
    fn optimal_block_size(&self, src: &[u8], savings: i64) -> Result<usize> {
        const SPLIT_LEVELS: [i32; 10] = [0, 0, 1, 2, 2, 3, 3, 4, 4, 4];
        let block_size_max = self.block_size_max;
        // Only full blocks are worth looking into.
        if src.len() < 128 << 10 || block_size_max < 128 << 10 {
            return Ok(src.len().min(block_size_max));
        }
        // Data that does not compress has to be in full blocks, for the output to stay within `compress_bound`.
        if savings < 3 {
            return Ok(128 << 10);
        }
        let split_level = SPLIT_LEVELS.at(self.applied_params.c_params.strat() as usize)?;
        presplit::split_block(src.sub(..block_size_max)?, split_level)
    }

    /// `ZSTD_compress_frameChunk`
    fn compress_frame_chunk(
        &mut self,
        dst: &mut [u8],
        input: &Input<'_>,
        src: Span,
        last_frame_chunk: bool,
    ) -> Result<usize> {
        let bytes = src.bytes(&input.bufs)?;
        let mut ip = src.start;
        let mut op = 0usize;
        let max_dist = 1u32 << self.applied_params.c_params.window_log;
        let mut savings = self.consumed_src_size as i64 - self.produced_c_size as i64;

        if self.applied_params.f_params.checksum_flag && !bytes.is_empty() {
            self.xxh_state.update(bytes);
        }

        while ip < src.end {
            let remaining = src.end - ip;
            let block_size = self.optimal_block_size(bytes.sub(ip - src.start..)?, savings)?;
            let last_block = last_frame_chunk && block_size == remaining;
            let block = Span {
                buf: src.buf,
                start: ip,
                end: ip + block_size,
            };
            let out = dst.sub_mut(op..)?;

            if out.len() < ZSTD_BLOCKHEADERSIZE + MIN_CBLOCK_SIZE + 1 {
                return Err(ErrorCode::DstSizeTooSmall);
            }

            let ms = &mut self.match_state;
            overflow_correct_if_needed(
                ms,
                &self.applied_params,
                block.start_addr(),
                block.end_addr(),
            );
            if (ms.window).dict_is_invalid(block.end_addr(), max_dist, ms.loaded_dict_end) {
                ms.loaded_dict_end = 0;
                ms.has_dict_match_state = false;
            }
            if (ms.window).enforce_max_dist(block.start_addr(), max_dist, ms.loaded_dict_end) {
                ms.loaded_dict_end = 0;
                ms.has_dict_match_state = false;
            }
            ms.next_to_update = ms.next_to_update.max(ms.window.low_limit);

            let c_size = if self.applied_params.target_c_block_size != 0 {
                self.compress_block_target_c_block_size(out, input, block, last_block)?
            } else if self.applied_params.post_block_splitter == ParamSwitch::Enable {
                self.compress_block_split_block(out, input, block, last_block)?
            } else {
                let c_size = self.compress_block_internal(
                    out.sub_mut(ZSTD_BLOCKHEADERSIZE..)?,
                    input,
                    block,
                )?;
                if c_size == 0 {
                    no_compress_block(out, block.bytes(&input.bufs)?, last_block)?
                } else {
                    write_block_header(out, c_size, block_size, last_block)?;
                    c_size + ZSTD_BLOCKHEADERSIZE
                }
            };

            savings += block_size as i64 - c_size as i64;
            ip += block_size;
            op += c_size;
            self.is_first_block = false;
        }

        if last_frame_chunk && op > 0 {
            self.stage = CompressionStage::Ending;
        }
        Ok(op)
    }

    /// `ZSTD_compressContinue_internal`
    fn compress_continue_internal(
        &mut self,
        dst: &mut [u8],
        input: &Input<'_>,
        src: Span,
        last_frame_chunk: bool,
    ) -> Result<usize> {
        let mut fh_size = 0usize;
        if self.stage == CompressionStage::Created {
            return Err(ErrorCode::StageWrong);
        }

        if self.stage == CompressionStage::Init {
            fh_size = write_frame_header(
                dst,
                &self.applied_params,
                self.pledged_src_size_plus_one.wrapping_sub(1),
                self.dict_id,
            )?;
            self.stage = CompressionStage::Ongoing;
        }

        if src.len() == 0 {
            return Ok(fh_size);
        }

        let ms = &mut self.match_state;
        if !(ms.window).update(
            src.start_addr(),
            src.buf,
            src.len(),
            ms.force_non_contiguous,
        ) {
            ms.force_non_contiguous = false;
            ms.next_to_update = ms.window.dict_limit;
        }
        if self.applied_params.ldm_params.enable_ldm == ParamSwitch::Enable {
            (self.ldm_state.window).update(src.start_addr(), src.buf, src.len(), false);
        }

        let c_size =
            self.compress_frame_chunk(dst.sub_mut(fh_size..)?, input, src, last_frame_chunk)?;
        self.consumed_src_size += src.len() as u64;
        self.produced_c_size += (c_size + fh_size) as u64;
        if self.pledged_src_size_plus_one != 0
            && self.consumed_src_size + 1 > self.pledged_src_size_plus_one
        {
            return Err(ErrorCode::SrcSizeWrong);
        }
        Ok(c_size + fh_size)
    }

    /// `ZSTD_compressContinue`
    pub(crate) fn compress_continue(
        &mut self,
        dst: &mut [u8],
        input: &Input<'_>,
        src: Span,
    ) -> Result<usize> {
        self.compress_continue_internal(dst, input, src, false)
    }

    /// `ZSTD_writeEpilogue`
    fn write_epilogue(&mut self, dst: &mut [u8]) -> Result<usize> {
        let mut op = 0usize;
        if self.stage == CompressionStage::Created {
            return Err(ErrorCode::StageWrong);
        }

        // An empty frame.
        if self.stage == CompressionStage::Init {
            op += write_frame_header(dst, &self.applied_params, 0, 0)?;
            self.stage = CompressionStage::Ongoing;
        }

        if self.stage != CompressionStage::Ending {
            // One last empty block, to mark the end of the frame.
            if dst.len() - op < 3 {
                return Err(ErrorCode::DstSizeTooSmall);
            }
            write_le24(dst, op, 1 + ((BlockType::Raw as u32) << 1))?;
            op += ZSTD_BLOCKHEADERSIZE;
        }

        if self.applied_params.f_params.checksum_flag {
            let checksum = self.xxh_state.digest() as u32;
            if dst.len() - op < 4 {
                return Err(ErrorCode::DstSizeTooSmall);
            }
            write_le32(dst, op, checksum)?;
            op += 4;
        }

        self.stage = CompressionStage::Created;
        Ok(op)
    }

    /// `ZSTD_compressEnd`
    pub(crate) fn compress_end(
        &mut self,
        dst: &mut [u8],
        input: &Input<'_>,
        src: Span,
    ) -> Result<usize> {
        let c_size = self.compress_continue_internal(dst, input, src, true)?;
        let end_result = self.write_epilogue(dst.sub_mut(c_size..)?)?;
        if self.pledged_src_size_plus_one != 0
            && self.pledged_src_size_plus_one != self.consumed_src_size + 1
        {
            return Err(ErrorCode::SrcSizeWrong);
        }
        Ok(c_size + end_result)
    }
}
