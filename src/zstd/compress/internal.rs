//! `zstd_compress_internal.h`: what the parts of the compressor share.

use super::fse::{FseCTable, FseRepeat};
use super::huf::{HufCTable, HufRepeat};
use crate::common::{
    BlockType, MINMATCH, REP_START_VALUE, SymbolEncodingType, WILDCOPY_OVERLENGTH,
    ZSTD_BLOCKHEADERSIZE, ZSTD_REP_NUM,
};
use crate::error::{ErrorCode, Result};
use crate::util::{BUG, SliceExt, highbit32, read_le32, read_le64, write_le24};

pub(crate) const K_SEARCH_STRENGTH: u32 = 8;
pub(crate) const HASH_READ_SIZE: usize = 8;
/// Marks an unsorted position of a binary tree. Less than any index, since those start at [`ZSTD_WINDOW_START_INDEX`].
pub(crate) const ZSTD_DUBT_UNSORTED_MARK: u32 = 1;

pub(crate) const ZSTD_OPT_NUM: usize = 1 << 12;
pub(crate) const ZSTD_OPT_SIZE: usize = ZSTD_OPT_NUM + 3;

pub(crate) const ZSTD_MAX_HUF_HEADER_SIZE: usize = 128;
pub(crate) const ZSTD_MAX_FSE_HEADERS_SIZE: usize = (53usize * 9 + 36 * 9 + 32 * 8).div_ceil(8);

/// `ZSTD_strategy`
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) enum Strategy {
    Fast = 1,
    DFast = 2,
    Greedy = 3,
    Lazy = 4,
    Lazy2 = 5,
    BtLazy2 = 6,
    BtOpt = 7,
    BtUltra = 8,
    BtUltra2 = 9,
}

impl Strategy {
    pub(crate) const fn from_int(value: i32) -> Option<Self> {
        Some(match value {
            1 => Self::Fast,
            2 => Self::DFast,
            3 => Self::Greedy,
            4 => Self::Lazy,
            5 => Self::Lazy2,
            6 => Self::BtLazy2,
            7 => Self::BtOpt,
            8 => Self::BtUltra,
            9 => Self::BtUltra2,
            _ => return None,
        })
    }
}

/// `ZSTD_ParamSwitch_e`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum ParamSwitch {
    Auto = 0,
    Enable = 1,
    Disable = 2,
}

/// `ZSTD_compressionParameters`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct CompressionParameters {
    pub(crate) window_log: u32,
    pub(crate) chain_log: u32,
    pub(crate) hash_log: u32,
    pub(crate) search_log: u32,
    pub(crate) min_match: u32,
    pub(crate) target_length: u32,
    /// `None` stands for 0, which is "not set" among requested parameters. Applied parameters have one.
    pub(crate) strategy: Option<Strategy>,
}

impl CompressionParameters {
    /// The strategy of parameters that are ready to be applied.
    #[inline(always)]
    pub(crate) fn strat(&self) -> Strategy {
        self.strategy.unwrap_or(Strategy::Fast)
    }
}

/// `ZSTD_dictMode_e`. Nothing can ask for `ZSTD_dedicatedDictSearch`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum DictMode {
    NoDict,
    ExtDict,
    DictMatchState,
}

/// `ZSTD_dictTableLoadMethod_e`
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum DictTableLoadMethod {
    Fast,
    Full,
}

/// `ZSTD_tableFillPurpose_e`
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TableFillPurpose {
    ForCCtx,
    ForCDict,
}

// ── entropy tables ────────────────────────────────────────────────────────

/// `ZSTD_hufCTables_t`
#[derive(Clone)]
pub(crate) struct HufCTables {
    pub(crate) c_table: HufCTable,
    pub(crate) repeat_mode: HufRepeat,
}

/// `ZSTD_fseCTables_t`
#[derive(Clone)]
pub(crate) struct FseCTables {
    pub(crate) offcode_c_table: FseCTable,
    pub(crate) matchlength_c_table: FseCTable,
    pub(crate) litlength_c_table: FseCTable,
    pub(crate) offcode_repeat_mode: FseRepeat,
    pub(crate) matchlength_repeat_mode: FseRepeat,
    pub(crate) litlength_repeat_mode: FseRepeat,
}

/// `ZSTD_entropyCTables_t`
#[derive(Clone)]
pub(crate) struct EntropyCTables {
    pub(crate) huf: HufCTables,
    pub(crate) fse: FseCTables,
}

/// `ZSTD_compressedBlockState_t`
#[derive(Clone)]
pub(crate) struct CompressedBlockState {
    pub(crate) entropy: EntropyCTables,
    pub(crate) rep: [u32; ZSTD_REP_NUM],
}

impl CompressedBlockState {
    /// `ZSTD_reset_compressedBlockState`, on tables that are all zeros.
    pub(crate) fn new() -> Self {
        Self {
            entropy: EntropyCTables {
                huf: HufCTables {
                    c_table: HufCTable::new(),
                    repeat_mode: HufRepeat::None,
                },
                fse: FseCTables {
                    offcode_c_table: FseCTable::new(),
                    matchlength_c_table: FseCTable::new(),
                    litlength_c_table: FseCTable::new(),
                    offcode_repeat_mode: FseRepeat::None,
                    matchlength_repeat_mode: FseRepeat::None,
                    litlength_repeat_mode: FseRepeat::None,
                },
            },
            rep: REP_START_VALUE,
        }
    }

    /// `ZSTD_reset_compressedBlockState`
    pub(crate) fn reset(&mut self) {
        self.rep = REP_START_VALUE;
        self.entropy.huf.repeat_mode = HufRepeat::None;
        self.entropy.fse.offcode_repeat_mode = FseRepeat::None;
        self.entropy.fse.matchlength_repeat_mode = FseRepeat::None;
        self.entropy.fse.litlength_repeat_mode = FseRepeat::None;
    }
}

/// `ZSTD_hufCTablesMetadata_t`
pub(crate) struct HufCTablesMetadata {
    pub(crate) h_type: SymbolEncodingType,
    pub(crate) huf_des_buffer: [u8; ZSTD_MAX_HUF_HEADER_SIZE],
    pub(crate) huf_des_size: usize,
}

/// `ZSTD_fseCTablesMetadata_t`
pub(crate) struct FseCTablesMetadata {
    pub(crate) ll_type: SymbolEncodingType,
    pub(crate) of_type: SymbolEncodingType,
    pub(crate) ml_type: SymbolEncodingType,
    pub(crate) fse_tables_buffer: [u8; ZSTD_MAX_FSE_HEADERS_SIZE],
    pub(crate) fse_tables_size: usize,
    /// Accounts for a bug of the decoders up to 1.3.4: see `ZSTD_entropyCompressSeqStore_internal`.
    pub(crate) last_count_size: usize,
}

/// `ZSTD_entropyCTablesMetadata_t`
pub(crate) struct EntropyCTablesMetadata {
    pub(crate) huf_metadata: HufCTablesMetadata,
    pub(crate) fse_metadata: FseCTablesMetadata,
}

impl EntropyCTablesMetadata {
    pub(crate) const fn new() -> Self {
        Self {
            huf_metadata: HufCTablesMetadata {
                h_type: SymbolEncodingType::Basic,
                huf_des_buffer: [0; ZSTD_MAX_HUF_HEADER_SIZE],
                huf_des_size: 0,
            },
            fse_metadata: FseCTablesMetadata {
                ll_type: SymbolEncodingType::Basic,
                of_type: SymbolEncodingType::Basic,
                ml_type: SymbolEncodingType::Basic,
                fse_tables_buffer: [0; ZSTD_MAX_FSE_HEADERS_SIZE],
                fse_tables_size: 0,
                last_count_size: 0,
            },
        }
    }
}

// ── sequences ─────────────────────────────────────────────────────────────

/// `SeqDef`
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) struct SeqDef {
    /// A repeat code (1 to 3), or an offset plus 3.
    pub(crate) off_base: u32,
    pub(crate) lit_length: u16,
    /// The match length minus [`MINMATCH`].
    pub(crate) ml_base: u16,
}

/// `ZSTD_longLengthType_e`: at most one length of a block does not fit 16 bits.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum LongLengthType {
    None,
    LiteralLength,
    MatchLength,
}

/// `SeqStore_t`: the sequences and the literals of a block.
pub(crate) struct SeqStore {
    /// Never grows beyond the capacity it is given by [`Self::reserve`].
    pub(crate) sequences: Vec<SeqDef>,
    /// `max_nb_lit` bytes, and [`WILDCOPY_OVERLENGTH`] to copy in chunks.
    pub(crate) lit_buffer: Vec<u8>,
    /// How much of `lit_buffer` is literals.
    pub(crate) lit_len: usize,
    pub(crate) ll_code: Vec<u8>,
    pub(crate) ml_code: Vec<u8>,
    pub(crate) of_code: Vec<u8>,
    pub(crate) max_nb_seq: usize,
    pub(crate) max_nb_lit: usize,
    pub(crate) long_length_type: LongLengthType,
    /// Which sequence has the long length.
    pub(crate) long_length_pos: u32,
}

/// `ZSTD_SequenceLength`
#[derive(Clone, Copy)]
pub(crate) struct SequenceLength {
    pub(crate) lit_length: u32,
    pub(crate) match_length: u32,
}

/// Some consecutive sequences of a [`SeqStore`] and their literals, which the C code has a `SeqStore_t` that points
/// into the other one for.
#[derive(Clone, Copy)]
pub(crate) struct SeqChunk {
    pub(crate) seq_start: usize,
    pub(crate) seq_end: usize,
    pub(crate) lit_start: usize,
    pub(crate) lit_end: usize,
    pub(crate) long_length_type: LongLengthType,
    /// Counted from `seq_start`.
    pub(crate) long_length_pos: u32,
}

impl SeqChunk {
    #[inline]
    pub(crate) const fn nb_seq(&self) -> usize {
        self.seq_end - self.seq_start
    }

    #[inline]
    pub(crate) const fn lit_size(&self) -> usize {
        self.lit_end - self.lit_start
    }
}

impl SeqStore {
    /// All of it.
    pub(crate) const fn whole(&self) -> SeqChunk {
        SeqChunk {
            seq_start: 0,
            seq_end: self.sequences.len(),
            lit_start: 0,
            lit_end: self.lit_len,
            long_length_type: self.long_length_type,
            long_length_pos: self.long_length_pos,
        }
    }

    /// `ZSTD_getSequenceLength`
    #[inline]
    pub(crate) fn get_sequence_length(&self, index: usize) -> Result<SequenceLength> {
        let seq = self.sequences.at(index)?;
        let mut seq_len = SequenceLength {
            lit_length: u32::from(seq.lit_length),
            match_length: u32::from(seq.ml_base) + MINMATCH,
        };
        if self.long_length_pos as usize == index {
            match self.long_length_type {
                LongLengthType::None => {}
                LongLengthType::LiteralLength => seq_len.lit_length += 0x10000,
                LongLengthType::MatchLength => seq_len.match_length += 0x10000,
            }
        }
        Ok(seq_len)
    }

    pub(crate) const fn new() -> Self {
        Self {
            sequences: Vec::new(),
            lit_buffer: Vec::new(),
            lit_len: 0,
            ll_code: Vec::new(),
            ml_code: Vec::new(),
            of_code: Vec::new(),
            max_nb_seq: 0,
            max_nb_lit: 0,
            long_length_type: LongLengthType::None,
            long_length_pos: 0,
        }
    }

    /// Room for `max_nb_seq` sequences and `max_nb_lit` bytes of literals.
    pub(crate) fn reserve(&mut self, max_nb_seq: usize, max_nb_lit: usize) -> Result<()> {
        fn grow<T: Clone + Default>(vec: &mut Vec<T>, len: usize) -> Result<()> {
            vec.clear();
            vec.try_reserve_exact(len)
                .map_err(|_| ErrorCode::MemoryAllocation)?;
            vec.resize(len, T::default());
            Ok(())
        }
        grow(&mut self.sequences, max_nb_seq)?;
        grow(&mut self.lit_buffer, max_nb_lit + WILDCOPY_OVERLENGTH)?;
        grow(&mut self.ll_code, max_nb_seq)?;
        grow(&mut self.ml_code, max_nb_seq)?;
        grow(&mut self.of_code, max_nb_seq)?;
        self.max_nb_seq = max_nb_seq;
        self.max_nb_lit = max_nb_lit;
        self.reset();
        Ok(())
    }

    /// `ZSTD_resetSeqStore`
    #[inline]
    pub(crate) fn reset(&mut self) {
        self.lit_len = 0;
        self.sequences.clear();
        self.long_length_type = LongLengthType::None;
    }

    #[inline]
    pub(crate) fn literals(&self) -> &[u8] {
        self.lit_buffer.get(..self.lit_len).unwrap_or_default()
    }

    /// `ZSTD_storeSeqOnly`: `match_length` is at least [`MINMATCH`].
    #[inline(always)]
    pub(crate) fn store_seq_only(&mut self, lit_length: usize, off_base: u32, match_length: usize) {
        debug_assert!(self.sequences.len() < self.max_nb_seq);
        if lit_length > 0xFFFF {
            self.long_length_type = LongLengthType::LiteralLength;
            self.long_length_pos = self.sequences.len() as u32;
        }
        let ml_base = match_length.wrapping_sub(MINMATCH as usize);
        if ml_base > 0xFFFF {
            self.long_length_type = LongLengthType::MatchLength;
            self.long_length_pos = self.sequences.len() as u32;
        }
        self.sequences.push(SeqDef {
            off_base,
            lit_length: lit_length as u16,
            ml_base: ml_base as u16,
        });
    }

    /// `ZSTD_storeSeq`: the literals are the `lit_length` bytes of `buf` from `literals` on.
    #[inline(always)]
    pub(crate) fn store_seq(
        &mut self,
        lit_length: usize,
        buf: &[u8],
        literals: usize,
        off_base: u32,
        match_length: usize,
    ) -> Result<()> {
        match (
            buf.array_at::<16>(literals),
            self.lit_buffer.array_at_mut::<16>(self.lit_len),
        ) {
            (Ok(from), Ok(to)) if lit_length <= 16 => *to = *from,
            _ => self
                .lit_buffer
                .write_at(self.lit_len, buf.span(literals, lit_length)?)?,
        }
        self.lit_len += lit_length;
        self.store_seq_only(lit_length, off_base, match_length);
        Ok(())
    }

    /// Appends the literals that follow the last sequence of a block.
    #[inline]
    pub(crate) fn store_last_literals(&mut self, literals: &[u8]) -> Result<()> {
        self.lit_buffer.write_at(self.lit_len, literals)?;
        self.lit_len += literals.len();
        Ok(())
    }
}

/// A [`SeqStore`] while a hot loop adds to it: what changes with every sequence is here, in a local variable, which can
/// stay in registers. It goes back to the store on drop.
pub(crate) struct SeqSink<'a> {
    store: &'a mut SeqStore,
    sequences: Vec<SeqDef>,
    lit_buffer: Vec<u8>,
    lit_len: u32,
}

impl<'a> SeqSink<'a> {
    #[inline(always)]
    pub(crate) fn new(store: &'a mut SeqStore) -> Self {
        Self {
            sequences: core::mem::take(&mut store.sequences),
            lit_buffer: core::mem::take(&mut store.lit_buffer),
            lit_len: store.lit_len as u32,
            store,
        }
    }

    /// `ZSTD_storeSeq`: the literals are the `lit_length` bytes of `src` from `literals` on. Up to `SHORT` of them, which
    /// is at most [`WILDCOPY_OVERLENGTH`], that many bytes are copied whatever their number.
    #[inline(always)]
    pub(crate) fn store_seq<const SHORT: usize>(
        &mut self,
        lit_length: u32,
        src: Near<'_>,
        literals: u32,
        off_base: u32,
        match_length: u32,
    ) -> Result<()> {
        let lit_len = self.lit_len as usize;
        let room = self.lit_buffer.get_mut(lit_len..lit_len + SHORT);
        match (
            src.window::<SHORT>(literals),
            room.and_then(<[u8]>::first_chunk_mut::<SHORT>),
        ) {
            (Some(from), Some(to)) if lit_length as usize <= SHORT => *to = *from,
            _ => self.lit_buffer.write_at(
                lit_len,
                src.bytes().span(literals as usize, lit_length as usize)?,
            )?,
        }
        self.lit_len += lit_length;

        let ml_base = match_length.wrapping_sub(MINMATCH);
        if lit_length > 0xFFFF || ml_base > 0xFFFF {
            self.store.long_length_type = if ml_base > 0xFFFF {
                LongLengthType::MatchLength
            } else {
                LongLengthType::LiteralLength
            };
            self.store.long_length_pos = self.sequences.len() as u32;
        }
        self.sequences
            .push_within_capacity(SeqDef {
                off_base,
                lit_length: lit_length as u16,
                ml_base: ml_base as u16,
            })
            .map(drop)
            .map_err(|_| BUG)
    }
}

impl Drop for SeqSink<'_> {
    #[inline(always)]
    fn drop(&mut self) {
        self.store.sequences = core::mem::take(&mut self.sequences);
        self.store.lit_buffer = core::mem::take(&mut self.lit_buffer);
        self.store.lit_len = self.lit_len as usize;
    }
}

pub(crate) const REPCODE1_TO_OFFBASE: u32 = 1;

/// `OFFSET_TO_OFFBASE`: `offset` is not 0.
#[inline(always)]
pub(crate) const fn offset_to_offbase(offset: u32) -> u32 {
    offset.wrapping_add(ZSTD_REP_NUM as u32)
}

/// `OFFBASE_IS_OFFSET`
#[inline(always)]
pub(crate) const fn offbase_is_offset(off_base: u32) -> bool {
    off_base > ZSTD_REP_NUM as u32
}

/// `OFFBASE_IS_REPCODE`
#[inline(always)]
pub(crate) const fn offbase_is_repcode(off_base: u32) -> bool {
    1 <= off_base && off_base <= ZSTD_REP_NUM as u32
}

/// `OFFBASE_TO_OFFSET`
#[inline(always)]
pub(crate) const fn offbase_to_offset(off_base: u32) -> u32 {
    off_base.wrapping_sub(ZSTD_REP_NUM as u32)
}

/// `ZSTD_updateRep`: `ll0` is whether the sequence has no literals.
#[inline(always)]
pub(crate) fn update_rep(rep: &mut [u32; ZSTD_REP_NUM], off_base: u32, ll0: bool) {
    let [rep0, rep1, rep2] = *rep;
    if offbase_is_offset(off_base) {
        *rep = [offbase_to_offset(off_base), rep0, rep1];
    } else {
        match off_base - 1 + u32::from(ll0) {
            0 => {}
            1 => *rep = [rep1, rep0, rep2],
            2 => *rep = [rep2, rep0, rep1],
            _ => *rep = [rep0.wrapping_sub(1), rep0, rep1],
        }
    }
}

/// `ZSTD_newRep`
#[inline(always)]
pub(crate) fn new_rep(rep: &[u32; ZSTD_REP_NUM], off_base: u32, ll0: bool) -> [u32; ZSTD_REP_NUM] {
    let mut new_reps = *rep;
    update_rep(&mut new_reps, off_base, ll0);
    new_reps
}

/// `ZSTD_LLcode`
#[inline(always)]
pub(crate) fn ll_code(lit_length: u32) -> u32 {
    #[rustfmt::skip]
    const LL_CODE: [u8; 64] = [
         0,  1,  2,  3,  4,  5,  6,  7,
         8,  9, 10, 11, 12, 13, 14, 15,
        16, 16, 17, 17, 18, 18, 19, 19,
        20, 20, 20, 20, 21, 21, 21, 21,
        22, 22, 22, 22, 22, 22, 22, 22,
        23, 23, 23, 23, 23, 23, 23, 23,
        24, 24, 24, 24, 24, 24, 24, 24,
        24, 24, 24, 24, 24, 24, 24, 24,
    ];
    const LL_DELTA_CODE: u32 = 19;
    match LL_CODE.get(lit_length as usize) {
        Some(&code) => u32::from(code),
        None => highbit32(lit_length) + LL_DELTA_CODE,
    }
}

/// `ZSTD_MLcode`: `ml_base` is the match length minus [`MINMATCH`].
#[inline(always)]
pub(crate) fn ml_code(ml_base: u32) -> u32 {
    #[rustfmt::skip]
    const ML_CODE: [u8; 128] = [
         0,  1,  2,  3,  4,  5,  6,  7,  8,  9, 10, 11, 12, 13, 14, 15,
        16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31,
        32, 32, 33, 33, 34, 34, 35, 35, 36, 36, 36, 36, 37, 37, 37, 37,
        38, 38, 38, 38, 38, 38, 38, 38, 39, 39, 39, 39, 39, 39, 39, 39,
        40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40,
        41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41, 41,
        42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42,
        42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42, 42,
    ];
    const ML_DELTA_CODE: u32 = 36;
    match ML_CODE.get(ml_base as usize) {
        Some(&code) => u32::from(code),
        None => highbit32(ml_base) + ML_DELTA_CODE,
    }
}

/// `ZSTD_noCompressBlock`
pub(crate) fn no_compress_block(dst: &mut [u8], src: &[u8], last_block: bool) -> Result<usize> {
    let c_block_header24 =
        u32::from(last_block) + ((BlockType::Raw as u32) << 1) + ((src.len() as u32) << 3);
    if src.len() + ZSTD_BLOCKHEADERSIZE > dst.len() {
        return Err(ErrorCode::DstSizeTooSmall);
    }
    write_le24(dst, 0, c_block_header24)?;
    dst.write_at(ZSTD_BLOCKHEADERSIZE, src)?;
    Ok(ZSTD_BLOCKHEADERSIZE + src.len())
}

/// `ZSTD_rleCompressBlock`
pub(crate) fn rle_compress_block(
    dst: &mut [u8],
    byte: u8,
    src_size: usize,
    last_block: bool,
) -> Result<usize> {
    let c_block_header =
        u32::from(last_block) + ((BlockType::Rle as u32) << 1) + ((src_size as u32) << 3);
    if dst.len() < 4 {
        return Err(ErrorCode::DstSizeTooSmall);
    }
    write_le24(dst, 0, c_block_header)?;
    dst.put(3, byte)?;
    Ok(4)
}

/// `ZSTD_minGain`: how much smaller than `src_size` a compressed block has to be, to be worth it.
#[inline]
pub(crate) fn min_gain(src_size: usize, strat: Strategy) -> usize {
    let minlog = if strat >= Strategy::BtUltra {
        strat as u32 - 1
    } else {
        6
    };
    (src_size >> minlog) + 2
}

// ── matching ──────────────────────────────────────────────────────────────

/// How many bytes `a` and `b` have in common at their start.
#[inline(always)]
pub(crate) fn common_prefix(a: &[u8], b: &[u8]) -> usize {
    let (a_words, _) = a.as_chunks::<8>();
    let (b_words, _) = b.as_chunks::<8>();
    let mut len = 0usize;
    for (a_word, b_word) in a_words.iter().zip(b_words) {
        let diff = u64::from_le_bytes(*a_word) ^ u64::from_le_bytes(*b_word);
        if diff != 0 {
            return len + (diff.trailing_zeros() >> 3) as usize;
        }
        len += 8;
    }
    let a_tail = a.get(len..).unwrap_or_default();
    let b_tail = b.get(len..).unwrap_or_default();
    len + a_tail
        .iter()
        .zip(b_tail)
        .take_while(|(a_byte, b_byte)| a_byte == b_byte)
        .count()
}

/// Input whose positions fit in 32 bits, which makes a bounds check a single comparison. The hot loops of the match
/// finders read through this.
#[derive(Clone, Copy)]
pub(crate) struct Near<'a>(&'a [u8]);

impl<'a> Near<'a> {
    #[inline]
    pub(crate) fn new(bytes: &'a [u8]) -> Result<Self> {
        if u32::try_from(bytes.len()).is_err() {
            return Err(BUG);
        }
        Ok(Self(bytes))
    }

    #[inline(always)]
    pub(crate) const fn bytes(self) -> &'a [u8] {
        self.0
    }

    #[inline(always)]
    pub(crate) const fn len(self) -> u32 {
        self.0.len() as u32
    }

    #[inline(always)]
    pub(crate) fn read32(self, pos: u32) -> Option<u32> {
        let pos = pos as usize;
        let bytes = self.0.get(pos..pos + 4)?.first_chunk()?;
        Some(u32::from_le_bytes(*bytes))
    }

    #[inline(always)]
    pub(crate) fn read64(self, pos: u32) -> Option<u64> {
        let pos = pos as usize;
        let bytes = self.0.get(pos..pos + 8)?.first_chunk()?;
        Some(u64::from_le_bytes(*bytes))
    }

    /// What differs between `bytes` and the 8 bytes at `pos`: 0 if nothing does. Not 0 in the lower half if `pos` is too
    /// far to read them, which takes no branch to find out.
    #[inline(always)]
    pub(crate) fn diff64(self, pos: u32, bytes: u64) -> u64 {
        let Some(last) = self.0.len().checked_sub(8) else {
            return 1;
        };
        let pos = pos as usize;
        let at = pos.min(last);
        match self.0.get(at..at + 8).and_then(<[u8]>::first_chunk) {
            Some(there) => (u64::from_le_bytes(*there) ^ bytes) | u64::from(pos > last),
            None => 1,
        }
    }

    #[inline(always)]
    fn chunk16(self, pos: u32) -> Option<&'a [u8; 16]> {
        self.window(pos)
    }

    /// The `N` bytes at `pos`, which can then be read with no further check.
    #[inline(always)]
    pub(crate) fn window<const N: usize>(self, pos: u32) -> Option<&'a [u8; N]> {
        let pos = pos as usize;
        self.0.get(pos..pos + N)?.first_chunk()
    }

    #[inline(always)]
    pub(crate) fn read8(self, pos: u32) -> Option<u8> {
        self.0.get(pos as usize).copied()
    }

    /// `ZSTD_count`, up to the end. `match_pos` is less than `pos`.
    #[inline(always)]
    pub(crate) fn count(self, pos: u32, match_pos: u32) -> u32 {
        let mut len = 0;
        // Where 16 bytes differ takes no branch, and few matches are longer.
        while let (Some(bytes), Some(match_bytes)) =
            (self.chunk16(pos + len), self.chunk16(match_pos + len))
        {
            let diff = u128::from_le_bytes(*bytes) ^ u128::from_le_bytes(*match_bytes);
            if diff != 0 {
                return len + (diff.trailing_zeros() >> 3);
            }
            len += 16;
        }
        while let Some(byte) = self.read8(pos + len)
            && self.read8(match_pos + len) == Some(byte)
        {
            len += 1;
        }
        len
    }

    /// How long what is at `pos` is the same as what is at `other_pos` in `other`, up to the end of either.
    #[inline(always)]
    pub(crate) fn count_in(self, pos: u32, other: Near<'_>, other_pos: u32) -> u32 {
        let mut len = 0;
        while let (Some(bytes), Some(other_bytes)) =
            (self.chunk16(pos + len), other.chunk16(other_pos + len))
        {
            let diff = u128::from_le_bytes(*bytes) ^ u128::from_le_bytes(*other_bytes);
            if diff != 0 {
                return len + (diff.trailing_zeros() >> 3);
            }
            len += 16;
        }
        while let Some(byte) = self.read8(pos + len)
            && other.read8(other_pos + len) == Some(byte)
        {
            len += 1;
        }
        len
    }

    /// How many bytes before `pos`, down to `anchor`, are the same as those before `match_pos`, down to `match_low`.
    #[inline(always)]
    pub(crate) fn count_backwards(
        self,
        pos: u32,
        anchor: u32,
        match_pos: u32,
        match_low: u32,
    ) -> u32 {
        let most = (pos - anchor).min(match_pos - match_low);
        self.count_backwards_in(pos, self, match_pos, most)
    }

    /// How many bytes before `pos` are the same as those before `other_pos` in `other`, up to `most`.
    #[inline(always)]
    pub(crate) fn count_backwards_in(
        self,
        pos: u32,
        other: Near<'_>,
        other_pos: u32,
        most: u32,
    ) -> u32 {
        // Whether there is anything to compare is as good as random: it takes no branch to find out.
        if let (Some(bytes), Some(other_bytes)) = (
            self.read64(pos.wrapping_sub(8)),
            other.read64(other_pos.wrapping_sub(8)),
        ) {
            let same = (bytes ^ other_bytes).leading_zeros() >> 3;
            if same < 8 || most <= 8 {
                return same.min(most);
            }
        }
        self.count_backwards_bytewise(pos, other, other_pos, most)
    }

    #[cold]
    fn count_backwards_bytewise(self, pos: u32, other: Near<'_>, other_pos: u32, most: u32) -> u32 {
        let mut len = 0;
        while len < most
            && let Some(byte) = self.read8(pos - len - 1)
            && other.read8(other_pos - len - 1) == Some(byte)
        {
            len += 1;
        }
        len
    }
}

/// `table[hash]`. `hash` is less than the size of `table`: to check that delays nothing, which a mask would.
#[inline(always)]
pub(crate) fn table_get(table: &[u32], hash: usize) -> u32 {
    table.get(hash).copied().unwrap_or(0)
}

/// `table[hash] = index`, likewise.
#[inline(always)]
pub(crate) fn table_put(table: &mut [u32], hash: usize, index: u32) {
    if let Some(cell) = table.get_mut(hash) {
        *cell = index;
    }
}

/// `table[hash] = index`, likewise. Returns what was there.
#[inline(always)]
pub(crate) fn table_swap(table: &mut [u32], hash: usize, index: u32) -> u32 {
    match table.get_mut(hash) {
        Some(cell) => core::mem::replace(cell, index),
        None => 0,
    }
}

/// The 4 bytes of `window` from `AT` on.
#[inline(always)]
pub(crate) fn le32_at<const AT: usize, const N: usize>(window: &[u8; N]) -> u32 {
    let bytes = window.get(AT..).and_then(<[u8]>::first_chunk);
    bytes.map_or(0, |bytes| u32::from_le_bytes(*bytes))
}

/// The 8 bytes of `window` from `AT` on.
#[inline(always)]
pub(crate) fn le64_at<const AT: usize, const N: usize>(window: &[u8; N]) -> u64 {
    let bytes = window.get(AT..).and_then(<[u8]>::first_chunk);
    bytes.map_or(0, |bytes| u64::from_le_bytes(*bytes))
}

/// `ZSTD_count`: how long `buf` from `p_in` on, up to `p_in_limit`, is the same as `match_buf` from `p_match` on.
#[inline(always)]
pub(crate) fn count(
    buf: &[u8],
    p_in: usize,
    match_buf: &[u8],
    p_match: usize,
    p_in_limit: usize,
) -> Result<usize> {
    Ok(common_prefix(
        buf.sub(p_in..p_in_limit)?,
        match_buf.sub(p_match..)?,
    ))
}

/// `ZSTD_count_2segments`: the match starts in `match_buf`, which it may reach the end `m_end` of. It then goes on at
/// `i_start` in `buf`.
#[inline(always)]
pub(crate) fn count_2segments(
    buf: &[u8],
    ip: usize,
    match_buf: &[u8],
    match_pos: usize,
    i_end: usize,
    m_end: usize,
    i_start: usize,
) -> Result<usize> {
    let match_length = common_prefix(buf.sub(ip..i_end)?, match_buf.sub(match_pos..m_end)?);
    if match_pos + match_length != m_end {
        return Ok(match_length);
    }
    Ok(match_length + count(buf, ip + match_length, buf, i_start, i_end)?)
}

const PRIME_3_BYTES: u32 = 506_832_829;
const PRIME_4_BYTES: u32 = 2_654_435_761;
const PRIME_5_BYTES: u64 = 889_523_592_379;
const PRIME_6_BYTES: u64 = 227_718_039_650_203;
const PRIME_7_BYTES: u64 = 58_295_818_150_454_627;
pub(crate) const PRIME_8_BYTES: u64 = 0xCF1B_BCDC_B7A5_6463;

/// `ZSTD_hash3`
#[inline(always)]
const fn hash3(u: u32, h: u32, s: u32) -> u32 {
    (((u << (32 - 24)).wrapping_mul(PRIME_3_BYTES)) ^ s) >> ((32 - h) & 31)
}
#[inline(always)]
const fn hash4(u: u32, h: u32, s: u32) -> u32 {
    ((u.wrapping_mul(PRIME_4_BYTES)) ^ s) >> ((32 - h) & 31)
}
#[inline(always)]
const fn hash5(u: u64, h: u32, s: u64) -> usize {
    ((((u << (64 - 40)).wrapping_mul(PRIME_5_BYTES)) ^ s) >> ((64 - h) & 63)) as usize
}
#[inline(always)]
const fn hash6(u: u64, h: u32, s: u64) -> usize {
    ((((u << (64 - 48)).wrapping_mul(PRIME_6_BYTES)) ^ s) >> ((64 - h) & 63)) as usize
}
#[inline(always)]
const fn hash7(u: u64, h: u32, s: u64) -> usize {
    ((((u << (64 - 56)).wrapping_mul(PRIME_7_BYTES)) ^ s) >> ((64 - h) & 63)) as usize
}
/// `ZSTD_hash8`
#[inline(always)]
pub(crate) const fn hash8(u: u64, h: u32, s: u64) -> usize {
    (((u.wrapping_mul(PRIME_8_BYTES)) ^ s) >> ((64 - h) & 63)) as usize
}

/// `ZSTD_hash3Ptr`: `h` is from 1 to 32, as for all these.
#[inline(always)]
pub(crate) fn hash3_ptr(buf: &[u8], pos: usize, h: u32) -> Result<usize> {
    Ok(hash3(read_le32(buf, pos)?, h, 0) as usize)
}

/// [`hash_ptr`] of the position that the 8 bytes `bytes` were read at.
#[inline(always)]
pub(crate) const fn hash_of<const MLS: u32>(bytes: u64, h_bits: u32) -> usize {
    match MLS {
        5 => hash5(bytes, h_bits, 0),
        6 => hash6(bytes, h_bits, 0),
        7 => hash7(bytes, h_bits, 0),
        8 => hash8(bytes, h_bits, 0),
        _ => hash4(bytes as u32, h_bits, 0) as usize,
    }
}

/// `ZSTD_hashPtr`: a hash of `h_bits` bits of the `mls` bytes of `buf` at `pos`. Reads 4 bytes if `mls` is at most 4,
/// else 8.
#[inline(always)]
pub(crate) fn hash_ptr(buf: &[u8], pos: usize, h_bits: u32, mls: u32) -> Result<usize> {
    hash_ptr_salted(buf, pos, h_bits, mls, 0)
}

/// `ZSTD_hashPtrSalted`
#[inline(always)]
pub(crate) fn hash_ptr_salted(
    buf: &[u8],
    pos: usize,
    h_bits: u32,
    mls: u32,
    hash_salt: u64,
) -> Result<usize> {
    Ok(match mls {
        5 => hash5(read_le64(buf, pos)?, h_bits, hash_salt),
        6 => hash6(read_le64(buf, pos)?, h_bits, hash_salt),
        7 => hash7(read_le64(buf, pos)?, h_bits, hash_salt),
        8 => hash8(read_le64(buf, pos)?, h_bits, hash_salt),
        _ => hash4(read_le32(buf, pos)?, h_bits, hash_salt as u32) as usize,
    })
}

// ── the window ────────────────────────────────────────────────────────────

/// The C code tells where a segment of the window lies by its address, and does arithmetic on addresses that are
/// outside of any buffer. Here each buffer the compressor reads from has a range of made-up addresses, far from the
/// others, and an address is turned into a position in the buffer only to read.
pub(crate) type Addr = usize;

/// The buffers that a window can have a segment in.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum BufId {
    /// Where an empty window points.
    None = 0,
    /// The context's own buffer of input.
    InBuff = 1,
    /// What the caller gave to the call in progress.
    User = 2,
    /// The content of the dictionary, or the prefix.
    Dict = 3,
}

impl BufId {
    /// The address of the first byte of the buffer.
    #[inline(always)]
    pub(crate) const fn start(self) -> Addr {
        (self as usize + 1) << 44
    }
}

/// The buffers themselves, for as long as a call lasts.
#[derive(Clone, Copy)]
pub(crate) struct Buffers<'a> {
    pub(crate) in_buff: &'a [u8],
    pub(crate) user: &'a [u8],
    pub(crate) dict: &'a [u8],
}

impl<'a> Buffers<'a> {
    #[inline]
    pub(crate) fn get(&self, id: BufId) -> &'a [u8] {
        match id {
            BufId::None => &[],
            BufId::InBuff => self.in_buff,
            BufId::User => self.user,
            BufId::Dict => self.dict,
        }
    }
}

/// Indices start here, so that 0 and [`ZSTD_DUBT_UNSORTED_MARK`] are never the index of a position.
pub(crate) const ZSTD_WINDOW_START_INDEX: u32 = 2;

/// The index past which indices are brought down.
pub(crate) const ZSTD_CURRENT_MAX: u32 = 3500 << 20;
/// The most input that can be indexed at once.
pub(crate) const ZSTD_CHUNKSIZE_MAX: u32 = u32::MAX - ZSTD_CURRENT_MAX;

/// `ZSTD_window_t`. A position is known by its index, which is its address minus `base`, or minus `dict_base` if the
/// index is less than `dict_limit`.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Window {
    /// Where input has to continue to be contiguous.
    pub(crate) next_src: Addr,
    pub(crate) base: Addr,
    pub(crate) dict_base: Addr,
    /// The buffer of the segment that starts at `dict_limit`.
    pub(crate) base_buf: BufId,
    /// The buffer of the segment from `low_limit` to `dict_limit`.
    pub(crate) dict_buf: BufId,
    pub(crate) dict_limit: u32,
    /// Below this, there is nothing valid.
    pub(crate) low_limit: u32,
    pub(crate) nb_overflow_corrections: u32,
}

impl Window {
    /// `ZSTD_window_init`
    pub(crate) const fn new() -> Self {
        let base = BufId::None.start();
        Self {
            next_src: base + ZSTD_WINDOW_START_INDEX as usize,
            base,
            dict_base: base,
            base_buf: BufId::None,
            dict_buf: BufId::None,
            dict_limit: ZSTD_WINDOW_START_INDEX,
            low_limit: ZSTD_WINDOW_START_INDEX,
            nb_overflow_corrections: 0,
        }
    }

    /// The index of `addr`, which is in the current segment or at its end.
    #[inline(always)]
    pub(crate) const fn index_of(&self, addr: Addr) -> u32 {
        addr.wrapping_sub(self.base) as u32
    }

    /// `ZSTD_window_clear`: forgets all there is, but goes on counting from where it is.
    pub(crate) fn clear(&mut self) {
        let end = self.index_of(self.next_src);
        self.low_limit = end;
        self.dict_limit = end;
    }

    /// `ZSTD_window_hasExtDict`
    #[inline]
    pub(crate) fn has_ext_dict(&self) -> bool {
        self.low_limit < self.dict_limit
    }

    /// `ZSTD_window_needOverflowCorrection`
    #[inline]
    pub(crate) fn need_overflow_correction(&self, src_end: Addr) -> bool {
        self.index_of(src_end) > ZSTD_CURRENT_MAX
    }

    /// `ZSTD_window_correctOverflow`: brings the indices down, keeping them the same modulo `1 << cycle_log`. Returns
    /// what to subtract from every index that is stored.
    pub(crate) fn correct_overflow(&mut self, cycle_log: u32, max_dist: u32, src: Addr) -> u32 {
        let cycle_size = 1u32 << cycle_log;
        let cycle_mask = cycle_size - 1;
        let curr = self.index_of(src);
        let current_cycle = curr & cycle_mask;
        // Indices must not fall below the start index.
        let current_cycle_correction = if current_cycle < ZSTD_WINDOW_START_INDEX {
            cycle_size.max(ZSTD_WINDOW_START_INDEX)
        } else {
            0
        };
        let new_current = current_cycle + current_cycle_correction + max_dist.max(cycle_size);
        let correction = curr.wrapping_sub(new_current);

        self.base = self.base.wrapping_add(correction as usize);
        self.dict_base = self.dict_base.wrapping_add(correction as usize);
        self.low_limit = if self.low_limit < correction.wrapping_add(ZSTD_WINDOW_START_INDEX) {
            ZSTD_WINDOW_START_INDEX
        } else {
            self.low_limit - correction
        };
        self.dict_limit = if self.dict_limit < correction.wrapping_add(ZSTD_WINDOW_START_INDEX) {
            ZSTD_WINDOW_START_INDEX
        } else {
            self.dict_limit - correction
        };
        self.nb_overflow_corrections += 1;
        correction
    }

    /// `ZSTD_window_enforceMaxDist`: nothing farther than `max_dist` from `block_end` stays valid, once the
    /// dictionary is that far. Returns whether that is so, and the dictionary is to be forgotten.
    pub(crate) fn enforce_max_dist(
        &mut self,
        block_end: Addr,
        max_dist: u32,
        loaded_dict_end: u32,
    ) -> bool {
        let block_end_idx = self.index_of(block_end);
        if block_end_idx > max_dist.wrapping_add(loaded_dict_end) {
            let new_low_limit = block_end_idx - max_dist;
            if self.low_limit < new_low_limit {
                self.low_limit = new_low_limit;
            }
            if self.dict_limit < self.low_limit {
                self.dict_limit = self.low_limit;
            }
            return true;
        }
        false
    }

    /// `ZSTD_checkDictValidity`: whether the dictionary is too far from `block_end` to be referred to, or is not
    /// right before the current segment, and is to be forgotten.
    pub(crate) fn dict_is_invalid(
        &self,
        block_end: Addr,
        max_dist: u32,
        loaded_dict_end: u32,
    ) -> bool {
        let block_end_idx = self.index_of(block_end);
        block_end_idx > loaded_dict_end.wrapping_add(max_dist) || loaded_dict_end != self.dict_limit
    }

    /// `ZSTD_window_update`: the input goes on with `src_size` bytes at `src`, which is in `src_buf`. If that is not
    /// where it left off, what there was becomes the older segment. Returns whether the input is contiguous.
    pub(crate) fn update(
        &mut self,
        src: Addr,
        src_buf: BufId,
        src_size: usize,
        force_non_contiguous: bool,
    ) -> bool {
        let mut contiguous = true;
        if src_size == 0 {
            return contiguous;
        }
        if src != self.next_src || force_non_contiguous {
            let distance_from_base = self.next_src.wrapping_sub(self.base);
            self.low_limit = self.dict_limit;
            self.dict_limit = distance_from_base as u32;
            self.dict_base = self.base;
            self.dict_buf = self.base_buf;
            self.base = src.wrapping_sub(distance_from_base);
            self.base_buf = src_buf;
            if self.dict_limit.wrapping_sub(self.low_limit) < HASH_READ_SIZE as u32 {
                // Too small to be of use.
                self.low_limit = self.dict_limit;
            }
            contiguous = false;
        }
        self.next_src = src + src_size;
        // Where the input overlaps the older segment, it has overwritten it.
        if (src + src_size > self.dict_base.wrapping_add(self.low_limit as usize))
            & (src < self.dict_base.wrapping_add(self.dict_limit as usize))
        {
            let high_input_idx = (src + src_size).wrapping_sub(self.dict_base);
            self.low_limit = if high_input_idx > self.dict_limit as usize {
                self.dict_limit
            } else {
                high_input_idx as u32
            };
        }
        contiguous
    }
}

/// `ZSTD_index_overlap_check`: whether a repeat offset that leads to `rep_index` stays clear of the last 3 bytes
/// before `prefix_lowest_index`, from which 4 bytes cannot be read in one segment.
#[inline(always)]
pub(crate) const fn index_overlap_check(prefix_lowest_index: u32, rep_index: u32) -> bool {
    prefix_lowest_index.wrapping_sub(1).wrapping_sub(rep_index) >= 3
}

pub(crate) const ZSTD_SHORT_CACHE_TAG_BITS: u32 = 8;
pub(crate) const ZSTD_SHORT_CACHE_TAG_MASK: u32 = (1 << ZSTD_SHORT_CACHE_TAG_BITS) - 1;

/// `ZSTD_writeTaggedIndex`: the tables of a dictionary keep 8 more bits of the hash beside each index.
#[inline(always)]
pub(crate) fn write_tagged_index(
    hash_table: &mut [u32],
    hash_and_tag: usize,
    index: u32,
) -> Result<()> {
    let hash = hash_and_tag >> ZSTD_SHORT_CACHE_TAG_BITS;
    let tag = hash_and_tag as u32 & ZSTD_SHORT_CACHE_TAG_MASK;
    hash_table.put(hash, (index << ZSTD_SHORT_CACHE_TAG_BITS) | tag)
}

/// `ZSTD_comparePackedTags`
#[inline(always)]
pub(crate) const fn compare_packed_tags(packed_tag1: usize, packed_tag2: usize) -> bool {
    (packed_tag1 as u32 & ZSTD_SHORT_CACHE_TAG_MASK)
        == (packed_tag2 as u32 & ZSTD_SHORT_CACHE_TAG_MASK)
}

// ── the state of the match finders ────────────────────────────────────────

/// `ZSTD_match_t`
#[derive(Clone, Copy, Default)]
pub(crate) struct Match {
    /// As [`SeqDef::off_base`].
    pub(crate) off: u32,
    pub(crate) len: u32,
}

/// `rawSeq`: a sequence found by long distance matching.
#[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
pub(crate) struct RawSeq {
    pub(crate) offset: u32,
    pub(crate) lit_length: u32,
    pub(crate) match_length: u32,
}

/// `RawSeqStore_t`
#[derive(Clone, Default)]
pub(crate) struct RawSeqStore {
    /// `capacity` of them, of which `size` are in use.
    pub(crate) seq: Vec<RawSeq>,
    /// The sequence that is being read.
    pub(crate) pos: usize,
    /// How many of its bytes, literals first, are read.
    pub(crate) pos_in_sequence: usize,
    pub(crate) size: usize,
    pub(crate) capacity: usize,
}

/// `ZSTD_optimal_t`
#[derive(Clone, Copy, Default)]
pub(crate) struct Optimal {
    /// The cost of getting to this position.
    pub(crate) price: i32,
    pub(crate) off: u32,
    pub(crate) mlen: u32,
    pub(crate) litlen: u32,
    pub(crate) rep: [u32; ZSTD_REP_NUM],
}

/// `ZSTD_OptPrice_e`
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum OptPrice {
    Dynamic,
    Predef,
}

/// `optState_t`. `symbolCosts` is in [`BlockSrc`].
pub(crate) struct OptState {
    pub(crate) lit_freq: Vec<u32>,
    pub(crate) lit_length_freq: Vec<u32>,
    pub(crate) match_length_freq: Vec<u32>,
    pub(crate) off_code_freq: Vec<u32>,
    pub(crate) match_table: Vec<Match>,
    pub(crate) price_table: Vec<Optimal>,
    pub(crate) lit_sum: u32,
    pub(crate) lit_length_sum: u32,
    pub(crate) match_length_sum: u32,
    pub(crate) off_code_sum: u32,
    pub(crate) lit_sum_base_price: u32,
    pub(crate) lit_length_sum_base_price: u32,
    pub(crate) match_length_sum_base_price: u32,
    pub(crate) off_code_sum_base_price: u32,
    pub(crate) price_type: OptPrice,
    pub(crate) literal_compression_mode: ParamSwitch,
}

impl OptState {
    pub(crate) const fn new() -> Self {
        Self {
            lit_freq: Vec::new(),
            lit_length_freq: Vec::new(),
            match_length_freq: Vec::new(),
            off_code_freq: Vec::new(),
            match_table: Vec::new(),
            price_table: Vec::new(),
            lit_sum: 0,
            lit_length_sum: 0,
            match_length_sum: 0,
            off_code_sum: 0,
            lit_sum_base_price: 0,
            lit_length_sum_base_price: 0,
            match_length_sum_base_price: 0,
            off_code_sum_base_price: 0,
            price_type: OptPrice::Dynamic,
            literal_compression_mode: ParamSwitch::Auto,
        }
    }
}

pub(crate) const ZSTD_ROW_HASH_CACHE_SIZE: usize = 8;

/// `ZSTD_MatchState_t`. `dictMatchState`, `ldmSeqStore` and `opt.symbolCosts`, which point to what other structures
/// own, are in [`BlockSrc`].
pub(crate) struct MatchState {
    pub(crate) window: Window,
    /// The index of the end of the dictionary, as long as it is right before the input and within reach. Else 0.
    pub(crate) loaded_dict_end: u32,
    /// The index from which the tables are still to be filled.
    pub(crate) next_to_update: u32,
    /// 0 if there is no table of 3-byte hashes.
    pub(crate) hash_log3: u32,
    pub(crate) row_hash_log: u32,
    /// For the row-based match finder: a byte of hash for each entry of `hash_table`.
    pub(crate) tag_table: Vec<u8>,
    pub(crate) hash_cache: [u32; ZSTD_ROW_HASH_CACHE_SIZE],
    /// Makes what a previous frame left in `tag_table` meaningless.
    pub(crate) hash_salt: u64,
    pub(crate) hash_salt_entropy: u32,
    pub(crate) hash_table: Vec<u32>,
    pub(crate) hash_table3: Vec<u32>,
    pub(crate) chain_table: Vec<u32>,
    pub(crate) force_non_contiguous: bool,
    pub(crate) opt: OptState,
    /// `dictMatchState != NULL`: the match state of the dictionary is searched beside this one.
    pub(crate) has_dict_match_state: bool,
    pub(crate) c_params: CompressionParameters,
    pub(crate) lazy_skipping: bool,
}

impl MatchState {
    pub(crate) const fn new() -> Self {
        Self {
            window: Window::new(),
            loaded_dict_end: 0,
            next_to_update: 0,
            hash_log3: 0,
            row_hash_log: 0,
            tag_table: Vec::new(),
            hash_cache: [0; ZSTD_ROW_HASH_CACHE_SIZE],
            hash_salt: 0,
            hash_salt_entropy: 0,
            hash_table: Vec::new(),
            hash_table3: Vec::new(),
            chain_table: Vec::new(),
            force_non_contiguous: false,
            opt: OptState::new(),
            has_dict_match_state: false,
            c_params: CompressionParameters {
                window_log: 0,
                chain_log: 0,
                hash_log: 0,
                search_log: 0,
                min_match: 0,
                target_length: 0,
                strategy: None,
            },
            lazy_skipping: false,
        }
    }

    /// How many bits to hash to for `hash_table` when it is a dictionary's, where entries have tags.
    pub(crate) const fn tagged_hash_log(&self) -> u32 {
        self.c_params.hash_log + ZSTD_SHORT_CACHE_TAG_BITS
    }

    /// The same for `chain_table`, as `dfast` uses it.
    pub(crate) const fn tagged_chain_log(&self) -> u32 {
        self.c_params.chain_log + ZSTD_SHORT_CACHE_TAG_BITS
    }

    /// `ZSTD_matchState_dictMode`: `dms` is the match state of the dictionary, if there is one to search.
    pub(crate) fn dict_mode(&self, dms: Option<&DictMatchState<'_>>) -> DictMode {
        if self.window.has_ext_dict() {
            return DictMode::ExtDict;
        }
        if dms.is_some() {
            DictMode::DictMatchState
        } else {
            DictMode::NoDict
        }
    }

    /// `ZSTD_getLowestMatchIndex`: the lowest index a match for the position `curr` can be at.
    #[inline(always)]
    pub(crate) fn get_lowest_match_index(&self, curr: u32, window_log: u32) -> u32 {
        let max_distance = 1u32 << window_log;
        let lowest_valid = self.window.low_limit;
        let within_window = if curr.wrapping_sub(lowest_valid) > max_distance {
            curr - max_distance
        } else {
            lowest_valid
        };
        // A dictionary is valid as a whole until it is invalidated as a whole.
        if self.loaded_dict_end != 0 {
            lowest_valid
        } else {
            within_window
        }
    }

    /// `ZSTD_getLowestPrefixIndex`: the same, in the current segment.
    #[inline(always)]
    pub(crate) fn get_lowest_prefix_index(&self, curr: u32, window_log: u32) -> u32 {
        let max_distance = 1u32 << window_log;
        let lowest_valid = self.window.dict_limit;
        let within_window = if curr.wrapping_sub(lowest_valid) > max_distance {
            curr - max_distance
        } else {
            lowest_valid
        };
        if self.loaded_dict_end != 0 {
            lowest_valid
        } else {
            within_window
        }
    }
}

/// The match state of a dictionary, and where its indices lead.
#[derive(Clone, Copy)]
pub(crate) struct DictMatchState<'a> {
    pub(crate) ms: &'a MatchState,
    /// The buffer its window is in, which is one segment.
    pub(crate) buf: &'a [u8],
    /// `window.base`, as a position in `buf`. It wraps around: only its sum with an index is a position.
    pub(crate) base: usize,
    /// `window.nextSrc`, as a position in `buf`.
    pub(crate) end: usize,
}

/// The current segment of a window, for the functions that index a dictionary.
#[derive(Clone, Copy)]
pub(crate) struct Prefix<'a> {
    /// The buffer that the segment is in.
    pub(crate) buf: &'a [u8],
    /// `window.base`, as a position in `buf`. It wraps around: only its sum with an index is a position.
    pub(crate) base: usize,
}

impl Prefix<'_> {
    /// The index of the position `pos` of `buf`.
    #[inline(always)]
    pub(crate) const fn index_of(&self, pos: usize) -> u32 {
        pos.wrapping_sub(self.base) as u32
    }

    /// The position in `buf` of `index`.
    #[inline(always)]
    pub(crate) const fn pos_of(&self, index: u32) -> usize {
        self.base.wrapping_add(index as usize)
    }
}

/// What a block compressor reads: `src` and `srcSize`, and what the pointers of `ZSTD_MatchState_t` lead to.
#[derive(Clone, Copy)]
pub(crate) struct BlockSrc<'a> {
    /// The buffer that the current segment of the window is in, and so the block.
    pub(crate) buf: &'a [u8],
    /// `window.base`, as a position in `buf`. It wraps around: only its sum with an index is a position.
    pub(crate) base: usize,
    /// The buffer that the older segment of the window is in.
    pub(crate) dict_buf: &'a [u8],
    /// `window.dictBase`, as a position in `dict_buf`. It wraps around too.
    pub(crate) dict_base: usize,
    /// Where the block starts in `buf`.
    pub(crate) start: usize,
    /// Where it ends.
    pub(crate) end: usize,
    pub(crate) dms: Option<DictMatchState<'a>>,
    /// `opt.symbolCosts`: the tables of the previous block.
    pub(crate) symbol_costs: &'a EntropyCTables,
    /// `ldmSeqStore`: matches that the optimal parser is to consider.
    pub(crate) ldm_seq_store: Option<&'a RawSeqStore>,
}

impl<'a> BlockSrc<'a> {
    #[inline(always)]
    pub(crate) const fn prefix(&self) -> Prefix<'a> {
        Prefix {
            buf: self.buf,
            base: self.base,
        }
    }

    /// The index of the position `pos` of `buf`.
    #[inline(always)]
    pub(crate) const fn index_of(&self, pos: usize) -> u32 {
        pos.wrapping_sub(self.base) as u32
    }

    /// The position in `buf` of `index`, which is in the current segment.
    #[inline(always)]
    pub(crate) const fn pos_of(&self, index: u32) -> usize {
        self.base.wrapping_add(index as usize)
    }

    /// The position in `dict_buf` of `index`, which is in the older segment.
    #[inline(always)]
    pub(crate) const fn dict_pos_of(&self, index: u32) -> usize {
        self.dict_base.wrapping_add(index as usize)
    }
}

impl DictMatchState<'_> {
    /// The position in `buf` of `index`.
    #[inline(always)]
    pub(crate) const fn pos_of(&self, index: u32) -> usize {
        self.base.wrapping_add(index as usize)
    }
}

// ── long distance matching ────────────────────────────────────────────────

/// `ldmEntry_t`
#[derive(Clone, Copy, Default)]
pub(crate) struct LdmEntry {
    pub(crate) offset: u32,
    pub(crate) checksum: u32,
}

/// `ldmParams_t`
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct LdmParams {
    pub(crate) enable_ldm: ParamSwitch,
    pub(crate) hash_log: u32,
    pub(crate) bucket_size_log: u32,
    pub(crate) min_match_length: u32,
    pub(crate) hash_rate_log: u32,
    pub(crate) window_log: u32,
}

/// `ldmState_t`. Its scratch arrays are locals of the functions that use them.
pub(crate) struct LdmState {
    pub(crate) window: Window,
    pub(crate) hash_table: Vec<LdmEntry>,
    pub(crate) loaded_dict_end: u32,
    /// The next entry to replace in each bucket.
    pub(crate) bucket_offsets: Vec<u8>,
}

impl LdmState {
    pub(crate) const fn new() -> Self {
        Self {
            window: Window::new(),
            hash_table: Vec::new(),
            loaded_dict_end: 0,
            bucket_offsets: Vec::new(),
        }
    }
}
