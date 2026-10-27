//! `zstd_decompress_block.c`: one compressed block, which is literals and the sequences that mix them with matches.

use super::huf::{self, HufDTable};
use super::seq_table::{
    LL_BASE, LL_DEFAULT_DTABLE, ML_BASE, ML_DEFAULT_DTABLE, OF_BASE, OF_BITS, OF_DEFAULT_DTABLE,
    SeqTable,
};
use crate::common::bitstream::BitDStream;
use crate::common::entropy::read_ncount;
use crate::common::{
    BlockType, LL_BITS, LL_FSE_LOG, LONGNBSEQ, MAX_LL, MAX_ML, MAX_OFF, MAX_SEQ, MIN_CBLOCK_SIZE,
    MIN_LITERALS_FOR_4_STREAMS, MIN_SEQUENCES_SIZE, ML_BITS, ML_FSE_LOG, OFF_FSE_LOG,
    REP_START_VALUE, SymbolEncodingType, WILDCOPY_OVERLENGTH, ZSTD_BLOCKHEADERSIZE, ZSTD_REP_NUM,
};
use crate::error::{ErrorCode, Result};
use crate::util::{SliceExt, read_le16, read_le24, read_le32};

/// `blockProperties_t`
pub(crate) struct BlockProperties {
    pub(crate) block_type: BlockType,
    pub(crate) last_block: bool,
    pub(crate) orig_size: u32,
}

/// `ZSTD_getcBlockSize`: reads a block header, and returns how many bytes of input the block takes after it.
pub(crate) fn get_c_block_size(src: &[u8]) -> Result<(usize, BlockProperties)> {
    if src.len() < ZSTD_BLOCKHEADERSIZE {
        return Err(ErrorCode::SrcSizeWrong);
    }
    let c_block_header = read_le24(src, 0)?;
    let c_size = c_block_header >> 3;
    let block_type = match (c_block_header >> 1) & 3 {
        0 => BlockType::Raw,
        1 => BlockType::Rle,
        2 => BlockType::Compressed,
        _ => BlockType::Reserved,
    };
    let properties = BlockProperties {
        block_type,
        last_block: c_block_header & 1 != 0,
        orig_size: c_size,
    };
    match block_type {
        BlockType::Rle => Ok((1, properties)),
        BlockType::Reserved => Err(ErrorCode::CorruptionDetected),
        _ => Ok((c_size as usize, properties)),
    }
}

/// `ZSTD_entropyDTables_t`
#[derive(Clone)]
pub(crate) struct EntropyDTables {
    pub(crate) ll_table: SeqTable<{ 1 << LL_FSE_LOG }>,
    pub(crate) of_table: SeqTable<{ 1 << OFF_FSE_LOG }>,
    pub(crate) ml_table: SeqTable<{ 1 << ML_FSE_LOG }>,
    pub(crate) huf_table: HufDTable,
    pub(crate) rep: [u32; ZSTD_REP_NUM],
}

impl EntropyDTables {
    pub(crate) const fn new() -> Self {
        Self {
            ll_table: SeqTable::new(),
            of_table: SeqTable::new(),
            ml_table: SeqTable::new(),
            huf_table: HufDTable::new(),
            rep: REP_START_VALUE,
        }
    }
}

/// Which table `LLTptr`, `MLTptr`, `OFTptr` or `HUFptr` points to.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TableSource {
    /// The context's own.
    Local,
    /// The dictionary's.
    Dict,
    /// The one the format predefines. There is none for literals.
    Predefined,
}

/// What precedes the contiguous output, for matches to reach into: `dictEnd` and `virtualStart`.
#[derive(Clone, Copy)]
pub(crate) enum ExtDict<'a> {
    /// The content of a dictionary. Empty if there is none.
    Dict(&'a [u8]),
    /// The `len` bytes up to `end` of the buffer that the output goes to, which is the streaming decoder's and has
    /// wrapped around.
    Within { end: usize, len: usize },
}

impl ExtDict<'_> {
    #[inline(always)]
    fn len(&self) -> usize {
        match *self {
            ExtDict::Dict(dict) => dict.len(),
            ExtDict::Within { len, .. } => len,
        }
    }

    /// `memmove(&buf[dst], dictEnd - back, len)`
    #[inline]
    fn copy_to(&self, buf: &mut [u8], dst: usize, back: usize, len: usize) -> Result<()> {
        match *self {
            ExtDict::Dict(dict) => buf.write_at(dst, dict.span(dict.len() - back, len)?),
            ExtDict::Within { end, .. } => buf.move_within(end - back, dst, len),
        }
    }
}

/// Where a block is written.
pub(crate) struct BlockOutput<'a> {
    /// Holds the contiguous output so far, from `prefix_start` to `start`.
    pub(crate) buf: &'a mut [u8],
    pub(crate) prefix_start: usize,
    pub(crate) start: usize,
    /// How many bytes from `start` on may be written.
    pub(crate) capacity: usize,
    pub(crate) ext_dict: ExtDict<'a>,
}

/// `streaming_operation`
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Streaming {
    No,
    Yes,
}

/// `ZSTD_LITBUFFEREXTRASIZE`
const LIT_BUFFER_EXTRA_SIZE: usize = 1 << 16;

/// `ZSTD_litLocation_e`. The C code saves memory by keeping the literals of a block in the part of the output that the
/// block has not reached yet. Here they never are, but where they would have been limits how far the block may write.
#[derive(Clone, Copy, PartialEq, Eq)]
enum LitLocation {
    NotInDst,
    /// Past the largest block, so that is as far as the block may write.
    InDst,
    /// All but the last `LIT_BUFFER_EXTRA_SIZE` at the end of the block, where the output must not catch up with them.
    Split,
}

/// `ZSTD_allocateLiteralsBuffer`
fn lit_location(
    block_size_max: usize,
    dst_capacity: usize,
    lit_size: usize,
    streaming: Streaming,
) -> LitLocation {
    if streaming == Streaming::No
        && dst_capacity > block_size_max + WILDCOPY_OVERLENGTH + lit_size + WILDCOPY_OVERLENGTH
    {
        LitLocation::InDst
    } else if lit_size <= LIT_BUFFER_EXTRA_SIZE {
        LitLocation::NotInDst
    } else {
        LitLocation::Split
    }
}

/// The literals of a block, once decoded.
struct Literals {
    /// How many bytes of the block they take.
    c_size: usize,
    size: usize,
    /// Where they start in the block, if they are stored there as they are with enough after them to copy in chunks.
    /// Otherwise they are in the context's buffer.
    in_src: Option<usize>,
    location: LitLocation,
}

/// The state of a `ZSTD_DCtx` that lasts from block to block.
pub(crate) struct BlockDecoder {
    pub(crate) entropy: Box<EntropyDTables>,
    pub(crate) ll_source: TableSource,
    pub(crate) of_source: TableSource,
    pub(crate) ml_source: TableSource,
    pub(crate) huf_source: TableSource,
    /// There is a Huffman table to repeat.
    pub(crate) lit_entropy: bool,
    /// There are sequence tables to repeat.
    pub(crate) fse_entropy: bool,
    pub(crate) ddict_is_cold: bool,
    /// Grows to the literals of the largest block so far, and `WILDCOPY_OVERLENGTH`.
    lit_buffer: Vec<u8>,
}

impl BlockDecoder {
    pub(crate) fn new() -> Self {
        Self {
            entropy: Box::new(EntropyDTables::new()),
            ll_source: TableSource::Local,
            of_source: TableSource::Local,
            ml_source: TableSource::Local,
            huf_source: TableSource::Local,
            lit_entropy: false,
            fse_entropy: false,
            ddict_is_cold: false,
            lit_buffer: Vec::new(),
        }
    }

    fn lit_buffer(&mut self, lit_size: usize) -> Result<&mut [u8]> {
        let needed = lit_size + WILDCOPY_OVERLENGTH;
        if self.lit_buffer.len() < needed {
            self.lit_buffer
                .try_reserve(needed - self.lit_buffer.len())
                .map_err(|_| ErrorCode::MemoryAllocation)?;
            self.lit_buffer.resize(needed, 0);
        }
        self.lit_buffer.sub_mut(..lit_size)
    }

    /// `ZSTD_decodeLiteralsBlock`
    fn decode_literals_block(
        &mut self,
        src: &[u8],
        dict_entropy: Option<&EntropyDTables>,
        block_size_max: usize,
        dst_capacity: usize,
        streaming: Streaming,
    ) -> Result<Literals> {
        if src.len() < MIN_CBLOCK_SIZE {
            return Err(ErrorCode::CorruptionDetected);
        }
        let first = src.at(0)?;
        let lit_enc_type = SymbolEncodingType::from_bits(first);
        let lhl_code = (first >> 2) & 3;
        let expected_write_size = block_size_max.min(dst_capacity);

        match lit_enc_type {
            SymbolEncodingType::Repeat | SymbolEncodingType::Compressed => {
                if lit_enc_type == SymbolEncodingType::Repeat && !self.lit_entropy {
                    return Err(ErrorCode::DictionaryCorrupted);
                }
                if src.len() < 5 {
                    return Err(ErrorCode::CorruptionDetected);
                }
                let lhc = read_le32(src, 0)? as usize;
                let (single_stream, lh_size, lit_size, lit_c_size) = match lhl_code {
                    2 => (false, 4, (lhc >> 4) & 0x3FFF, lhc >> 18),
                    3 => (
                        false,
                        5,
                        (lhc >> 4) & 0x3FFFF,
                        (lhc >> 22) + (usize::from(src.at(4)?) << 10),
                    ),
                    _ => (lhl_code == 0, 3, (lhc >> 4) & 0x3FF, (lhc >> 14) & 0x3FF),
                };
                if lit_size > block_size_max {
                    return Err(ErrorCode::CorruptionDetected);
                }
                if !single_stream && lit_size < MIN_LITERALS_FOR_4_STREAMS {
                    return Err(ErrorCode::LiteralsHeaderWrong);
                }
                if lit_c_size + lh_size > src.len() {
                    return Err(ErrorCode::CorruptionDetected);
                }
                if expected_write_size < lit_size {
                    return Err(ErrorCode::DstSizeTooSmall);
                }
                let location = lit_location(block_size_max, dst_capacity, lit_size, streaming);
                let compressed = src.span(lh_size, lit_c_size)?;

                let huf_source = self.huf_source;
                self.lit_buffer(lit_size)?;
                let Self {
                    entropy,
                    lit_buffer,
                    ..
                } = self;
                let dst = lit_buffer.sub_mut(..lit_size)?;
                let huf_result = if lit_enc_type == SymbolEncodingType::Repeat {
                    let table = match (huf_source, dict_entropy) {
                        (TableSource::Dict, Some(dict)) => &dict.huf_table,
                        _ => &entropy.huf_table,
                    };
                    if single_stream {
                        huf::decompress_1x_using_dtable(dst, compressed, table)
                    } else {
                        huf::decompress_4x_using_dtable(dst, compressed, table)
                    }
                } else if single_stream {
                    huf::decompress_1x1(&mut entropy.huf_table, dst, compressed)
                } else {
                    huf::decompress_4x_huf_only(&mut entropy.huf_table, dst, compressed)
                };
                if huf_result.is_err() {
                    return Err(ErrorCode::CorruptionDetected);
                }

                self.lit_entropy = true;
                if lit_enc_type == SymbolEncodingType::Compressed {
                    self.huf_source = TableSource::Local;
                }
                Ok(Literals {
                    c_size: lit_c_size + lh_size,
                    size: lit_size,
                    in_src: None,
                    location,
                })
            }

            SymbolEncodingType::Basic => {
                let (lh_size, lit_size) = match lhl_code {
                    1 => (2, usize::from(read_le16(src, 0)? >> 4)),
                    3 => {
                        if src.len() < 3 {
                            return Err(ErrorCode::CorruptionDetected);
                        }
                        (3, (read_le24(src, 0)? >> 4) as usize)
                    }
                    _ => (1, usize::from(first >> 3)),
                };
                if lit_size > block_size_max {
                    return Err(ErrorCode::CorruptionDetected);
                }
                if expected_write_size < lit_size {
                    return Err(ErrorCode::DstSizeTooSmall);
                }
                if lh_size + lit_size + WILDCOPY_OVERLENGTH > src.len() {
                    if lit_size + lh_size > src.len() {
                        return Err(ErrorCode::CorruptionDetected);
                    }
                    self.lit_buffer(lit_size)?
                        .copy_from_slice(src.span(lh_size, lit_size)?);
                    return Ok(Literals {
                        c_size: lh_size + lit_size,
                        size: lit_size,
                        in_src: None,
                        location: lit_location(block_size_max, dst_capacity, lit_size, streaming),
                    });
                }
                Ok(Literals {
                    c_size: lh_size + lit_size,
                    size: lit_size,
                    in_src: Some(lh_size),
                    location: LitLocation::NotInDst,
                })
            }

            SymbolEncodingType::Rle => {
                let (lh_size, lit_size) = match lhl_code {
                    1 => {
                        if src.len() < 3 {
                            return Err(ErrorCode::CorruptionDetected);
                        }
                        (2, usize::from(read_le16(src, 0)? >> 4))
                    }
                    3 => {
                        if src.len() < 4 {
                            return Err(ErrorCode::CorruptionDetected);
                        }
                        (3, (read_le24(src, 0)? >> 4) as usize)
                    }
                    _ => (1, usize::from(first >> 3)),
                };
                if lit_size > block_size_max {
                    return Err(ErrorCode::CorruptionDetected);
                }
                if expected_write_size < lit_size {
                    return Err(ErrorCode::DstSizeTooSmall);
                }
                self.lit_buffer(lit_size)?.fill(src.at(lh_size)?);
                Ok(Literals {
                    c_size: lh_size + 1,
                    size: lit_size,
                    in_src: None,
                    location: lit_location(block_size_max, dst_capacity, lit_size, streaming),
                })
            }
        }
    }

    /// `ZSTD_decodeSeqHeaders`: returns how many sequences there are, and the size of the header.
    fn decode_seq_headers(&mut self, src: &[u8]) -> Result<(usize, usize)> {
        if src.len() < MIN_SEQUENCES_SIZE {
            return Err(ErrorCode::SrcSizeWrong);
        }
        let mut ip = 0usize;
        let mut nb_seq = usize::from(src.at(ip)?);
        ip += 1;
        if nb_seq > 0x7F {
            if nb_seq == 0xFF {
                if ip + 2 > src.len() {
                    return Err(ErrorCode::SrcSizeWrong);
                }
                nb_seq = usize::from(read_le16(src, ip)?) + LONGNBSEQ;
                ip += 2;
            } else {
                if ip >= src.len() {
                    return Err(ErrorCode::SrcSizeWrong);
                }
                nb_seq = ((nb_seq - 0x80) << 8) + usize::from(src.at(ip)?);
                ip += 1;
            }
        }

        if nb_seq == 0 {
            if ip != src.len() {
                return Err(ErrorCode::CorruptionDetected);
            }
            return Ok((0, ip));
        }

        if ip + 1 > src.len() {
            return Err(ErrorCode::SrcSizeWrong);
        }
        let modes = src.at(ip)?;
        if modes & 3 != 0 {
            return Err(ErrorCode::CorruptionDetected);
        }
        ip += 1;

        let fse_entropy = self.fse_entropy;
        ip += build_seq_table(
            &mut self.entropy.ll_table,
            &mut self.ll_source,
            SymbolEncodingType::from_bits(modes >> 6),
            MAX_LL,
            LL_FSE_LOG,
            src.sub(ip..)?,
            &LL_BASE,
            &LL_BITS,
            fse_entropy,
        )
        .map_err(|_| ErrorCode::CorruptionDetected)?;
        ip += build_seq_table(
            &mut self.entropy.of_table,
            &mut self.of_source,
            SymbolEncodingType::from_bits(modes >> 4),
            MAX_OFF,
            OFF_FSE_LOG,
            src.sub(ip..)?,
            &OF_BASE,
            &OF_BITS,
            fse_entropy,
        )
        .map_err(|_| ErrorCode::CorruptionDetected)?;
        ip += build_seq_table(
            &mut self.entropy.ml_table,
            &mut self.ml_source,
            SymbolEncodingType::from_bits(modes >> 2),
            MAX_ML,
            ML_FSE_LOG,
            src.sub(ip..)?,
            &ML_BASE,
            &ML_BITS,
            fse_entropy,
        )
        .map_err(|_| ErrorCode::CorruptionDetected)?;

        Ok((nb_seq, ip))
    }

    /// `ZSTD_decompressBlock_internal`: returns the size of the block once decompressed.
    pub(crate) fn decompress_block(
        &mut self,
        out: BlockOutput<'_>,
        src: &[u8],
        dict_entropy: Option<&EntropyDTables>,
        block_size_max: usize,
        streaming: Streaming,
    ) -> Result<usize> {
        let BlockOutput {
            buf,
            prefix_start,
            start,
            capacity,
            ext_dict,
        } = out;
        if src.len() > block_size_max {
            return Err(ErrorCode::SrcSizeWrong);
        }

        let literals =
            self.decode_literals_block(src, dict_entropy, block_size_max, capacity, streaming)?;
        let sequences = src.sub(literals.c_size..)?;

        let total_history_size =
            start - prefix_start + ext_dict.len() + capacity.min(block_size_max);
        let mut use_prefetch_decoder = self.ddict_is_cold;
        let (nb_seq, seq_h_size) = self.decode_seq_headers(sequences)?;
        let sequences = sequences.sub(seq_h_size..)?;

        if capacity == 0 && nb_seq > 0 {
            return Err(ErrorCode::DstSizeTooSmall);
        }

        let Self {
            entropy,
            lit_buffer,
            ..
        } = self;
        let EntropyDTables {
            ll_table,
            of_table,
            ml_table,
            rep,
            ..
        } = &mut **entropy;
        let ll_table = match (self.ll_source, dict_entropy) {
            (TableSource::Predefined, _) => &LL_DEFAULT_DTABLE,
            (TableSource::Dict, Some(dict)) => &dict.ll_table,
            _ => &*ll_table,
        };
        let of_table = match (self.of_source, dict_entropy) {
            (TableSource::Predefined, _) => &OF_DEFAULT_DTABLE,
            (TableSource::Dict, Some(dict)) => &dict.of_table,
            _ => &*of_table,
        };
        let ml_table = match (self.ml_source, dict_entropy) {
            (TableSource::Predefined, _) => &ML_DEFAULT_DTABLE,
            (TableSource::Dict, Some(dict)) => &dict.ml_table,
            _ => &*ml_table,
        };

        // With matches far back in a long history, it pays to know the sequences ahead of time. Nothing is prefetched
        // here, but which of two problems in a damaged block is reported depends on the order.
        if !use_prefetch_decoder && total_history_size > (1 << 24) && nb_seq > 8 {
            const MIN_SHARE: u32 = 7;
            use_prefetch_decoder = long_offset_share(of_table) >= MIN_SHARE;
        }
        self.ddict_is_cold = false;
        if nb_seq > 0 {
            self.fse_entropy = true;
        }

        let block_end = start + capacity;
        let oend = if literals.location == LitLocation::InDst {
            start + block_size_max + WILDCOPY_OVERLENGTH
        } else {
            block_end
        };
        let split = literals.location == LitLocation::Split;
        let in_dst_size = literals.size.saturating_sub(LIT_BUFFER_EXTRA_SIZE);
        let mut exec = Executor {
            buf: buf.sub_mut(..block_end)?,
            op: start,
            oend,
            prefix_start,
            ext_dict,
            lits: match literals.in_src {
                Some(start) => src.sub(start..)?,
                None => lit_buffer.as_slice(),
            },
            lit_pos: 0,
            lit_limit: if split { in_dst_size } else { literals.size },
            lit_size: literals.size,
            split,
            // `litBufferEnd` is `WILDCOPY_OVERLENGTH` short of how far the block is expected to write.
            lit_in_dst: (start + capacity.min(block_size_max))
                .wrapping_sub(WILDCOPY_OVERLENGTH + in_dst_size),
        };

        if nb_seq > 0 {
            let mut seq_state = SeqState::new(sequences, ll_table, of_table, ml_table, rep)?;
            if use_prefetch_decoder {
                exec.run_long(&mut seq_state, nb_seq)?;
            } else {
                exec.run(&mut seq_state, nb_seq)?;
            }
            *rep = seq_state.prev_offset.map(|offset| offset as u32);
        }
        exec.last_literals()?;
        Ok(exec.op - start)
    }
}

/// `ZSTD_buildSeqTable`: returns the size of the table's description in `src`.
fn build_seq_table<const N: usize>(
    table: &mut SeqTable<N>,
    source: &mut TableSource,
    encoding_type: SymbolEncodingType,
    max: u32,
    max_log: u32,
    src: &[u8],
    base_value: &[u32],
    nb_additional_bits: &[u8],
    flag_repeat_table: bool,
) -> Result<usize> {
    match encoding_type {
        SymbolEncodingType::Rle => {
            let Some(&symbol) = src.first() else {
                return Err(ErrorCode::SrcSizeWrong);
            };
            if u32::from(symbol) > max {
                return Err(ErrorCode::CorruptionDetected);
            }
            let symbol = usize::from(symbol);
            table.build_rle(base_value.at(symbol)?, nb_additional_bits.at(symbol)?);
            *source = TableSource::Local;
            Ok(1)
        }
        SymbolEncodingType::Basic => {
            *source = TableSource::Predefined;
            Ok(0)
        }
        SymbolEncodingType::Repeat => {
            if !flag_repeat_table {
                return Err(ErrorCode::CorruptionDetected);
            }
            Ok(0)
        }
        SymbolEncodingType::Compressed => {
            let mut norm = [0i16; MAX_SEQ as usize + 1];
            let header =
                read_ncount(&mut norm, max, src).map_err(|_| ErrorCode::CorruptionDetected)?;
            if header.table_log > max_log {
                return Err(ErrorCode::CorruptionDetected);
            }
            table.build(
                norm.sub(..header.max_symbol_value as usize + 1)?,
                base_value,
                nb_additional_bits,
                header.table_log,
            )?;
            *source = TableSource::Local;
            Ok(header.size)
        }
    }
}

/// `ZSTD_getOffsetInfo`: how many of 256 offset codes have more than 22 bits.
fn long_offset_share(of_table: &SeqTable<{ 1 << OFF_FSE_LOG }>) -> u32 {
    let count = of_table
        .symbols()
        .iter()
        .filter(|symbol| symbol.nb_additional_bits > 22)
        .count() as u32;
    count << (OFF_FSE_LOG - of_table.table_log)
}

/// `seq_t`
#[derive(Clone, Copy, Default)]
struct Sequence {
    lit_length: usize,
    match_length: usize,
    offset: usize,
}

/// `seqState_t`
struct SeqState<'a> {
    bit_d: BitDStream<'a>,
    state_ll: usize,
    state_off: usize,
    state_ml: usize,
    ll_table: &'a SeqTable<{ 1 << LL_FSE_LOG }>,
    of_table: &'a SeqTable<{ 1 << OFF_FSE_LOG }>,
    ml_table: &'a SeqTable<{ 1 << ML_FSE_LOG }>,
    prev_offset: [usize; ZSTD_REP_NUM],
}

impl<'a> SeqState<'a> {
    fn new(
        src: &'a [u8],
        ll_table: &'a SeqTable<{ 1 << LL_FSE_LOG }>,
        of_table: &'a SeqTable<{ 1 << OFF_FSE_LOG }>,
        ml_table: &'a SeqTable<{ 1 << ML_FSE_LOG }>,
        rep: &[u32; ZSTD_REP_NUM],
    ) -> Result<Self> {
        let mut bit_d = BitDStream::new(src).map_err(|_| ErrorCode::CorruptionDetected)?;
        // `ZSTD_initFseState`
        let mut init = |table_log: u32| {
            let state = bit_d.read_bits(table_log) as usize;
            bit_d.reload();
            state
        };
        let state_ll = init(ll_table.table_log);
        let state_off = init(of_table.table_log);
        let state_ml = init(ml_table.table_log);
        Ok(Self {
            bit_d,
            state_ll,
            state_off,
            state_ml,
            ll_table,
            of_table,
            ml_table,
            prev_offset: rep.map(|offset| offset as usize),
        })
    }

    /// `ZSTD_decodeSequence`
    #[inline(always)]
    fn decode_sequence(&mut self, is_last_seq: bool) -> Sequence {
        let ll_d_info = self.ll_table.get(self.state_ll);
        let ml_d_info = self.ml_table.get(self.state_ml);
        let of_d_info = self.of_table.get(self.state_off);
        let mut match_length = ml_d_info.base_value as usize;
        let mut lit_length = ll_d_info.base_value as usize;
        let of_base = of_d_info.base_value as usize;
        let ll_bits = u32::from(ll_d_info.nb_additional_bits);
        let ml_bits = u32::from(ml_d_info.nb_additional_bits);
        let of_bits = u32::from(of_d_info.nb_additional_bits);
        let total_bits = ll_bits + ml_bits + of_bits;

        let [prev0, prev1, prev2] = self.prev_offset;
        let offset;
        if of_bits > 1 {
            offset = of_base + self.bit_d.read_bits_fast(of_bits) as usize;
            self.prev_offset = [offset, prev0, prev1];
        } else {
            let ll0 = ll_d_info.base_value == 0;
            if of_bits == 0 {
                if ll0 {
                    offset = prev1;
                    self.prev_offset = [prev1, prev0, prev2];
                } else {
                    offset = prev0;
                }
            } else {
                let code = of_base + usize::from(ll0) + self.bit_d.read_bits_fast(1) as usize;
                let temp = match code {
                    1 => prev1,
                    2 => prev2,
                    _ => prev0.wrapping_sub(1),
                };
                // 0 is not valid: it becomes an offset that no history is long enough for.
                offset = temp.wrapping_sub(usize::from(temp == 0));
                self.prev_offset = [offset, prev0, if code != 1 { prev1 } else { prev2 }];
            }
        }

        if ml_bits > 0 {
            match_length += self.bit_d.read_bits_fast(ml_bits) as usize;
        }
        const ACCUMULATOR_MIN: u32 = 57;
        if total_bits >= ACCUMULATOR_MIN - (LL_FSE_LOG + ML_FSE_LOG + OFF_FSE_LOG) {
            self.bit_d.reload();
        }
        if ll_bits > 0 {
            lit_length += self.bit_d.read_bits_fast(ll_bits) as usize;
        }

        if !is_last_seq {
            // `ZSTD_updateFseStateWithDInfo`
            self.state_ll = usize::from(ll_d_info.next_state)
                + self.bit_d.read_bits(u32::from(ll_d_info.nb_bits)) as usize;
            self.state_ml = usize::from(ml_d_info.next_state)
                + self.bit_d.read_bits(u32::from(ml_d_info.nb_bits)) as usize;
            self.state_off = usize::from(of_d_info.next_state)
                + self.bit_d.read_bits(u32::from(of_d_info.nb_bits)) as usize;
            self.bit_d.reload();
        }

        Sequence {
            lit_length,
            match_length,
            offset,
        }
    }
}

#[inline(always)]
fn copy_within<const N: usize>(buf: &mut [u8], src: usize, dst: usize) -> Result<()> {
    let chunk: [u8; N] = *buf.array_at(src)?;
    *buf.array_at_mut(dst)? = chunk;
    Ok(())
}

/// `buf[dst + i] = buf[src + i]`, one after the other, so that a match repeats itself where it overlaps its copy.
/// `src` is less than `dst`.
fn copy_match_exact(buf: &mut [u8], src: usize, dst: usize, len: usize) -> Result<()> {
    let offset = dst - src;
    if offset >= len {
        return buf.move_within(src, dst, len);
    }
    // What is copied so far is whole periods, so it can be copied again from the start, twice as much each time.
    let mut done = 0usize;
    while done < len {
        let chunk = (offset + done).min(len - done);
        buf.move_within(src, dst + done, chunk)?;
        done += chunk;
    }
    Ok(())
}

/// Turns sequences into output.
struct Executor<'a> {
    /// Ends where the block has to.
    buf: &'a mut [u8],
    op: usize,
    /// How far the C code would let the block write.
    oend: usize,
    prefix_start: usize,
    ext_dict: ExtDict<'a>,
    /// At least `WILDCOPY_OVERLENGTH` longer than `lit_size`.
    lits: &'a [u8],
    lit_pos: usize,
    /// `litBufferEnd`
    lit_limit: usize,
    lit_size: usize,
    /// `litBufferLocation == ZSTD_split`: the literals up to `lit_limit` would be in the output buffer.
    split: bool,
    /// Where in `buf` they would start.
    lit_in_dst: usize,
}

impl Executor<'_> {
    /// The match of a sequence whose literals end at `o_lit_end`. `FAST`: 32 bytes after the match may be written.
    #[inline(always)]
    fn copy_match<const FAST: bool>(&mut self, o_lit_end: usize, sequence: Sequence) -> Result<()> {
        let Sequence {
            mut match_length,
            offset,
            ..
        } = sequence;
        let mut op = o_lit_end;
        let in_prefix = o_lit_end - self.prefix_start;
        let mut match_pos = o_lit_end.wrapping_sub(offset);

        if offset > in_prefix {
            if offset > in_prefix + self.ext_dict.len() {
                return Err(ErrorCode::CorruptionDetected);
            }
            let back = offset - in_prefix;
            if back >= match_length {
                return self.ext_dict.copy_to(self.buf, op, back, match_length);
            }
            // The match spans the two segments.
            self.ext_dict.copy_to(self.buf, op, back, back)?;
            op += back;
            match_length -= back;
            match_pos = self.prefix_start;
        }

        if !FAST {
            return copy_match_exact(self.buf, match_pos, op, match_length);
        }

        if offset >= 16 {
            // `ZSTD_wildcopy(ZSTD_no_overlap)`
            let mut done = 0usize;
            loop {
                copy_within::<16>(self.buf, match_pos + done, op + done)?;
                done += 16;
                if done >= match_length {
                    return Ok(());
                }
            }
        }

        // `ZSTD_overlapCopy8`: after 8 bytes, the source is at least 8 bytes behind.
        if offset < 8 {
            const DEC32_TABLE: [usize; 8] = [0, 1, 2, 1, 4, 4, 4, 4];
            const DEC64_TABLE: [usize; 8] = [8, 8, 8, 7, 8, 9, 10, 11];
            for i in 0..4 {
                let byte = self.buf.at(match_pos + i)?;
                self.buf.put(op + i, byte)?;
            }
            match_pos += DEC32_TABLE.at(offset)?;
            copy_within::<4>(self.buf, match_pos, op + 4)?;
            match_pos += 8;
            match_pos -= DEC64_TABLE.at(offset)?;
        } else {
            copy_within::<8>(self.buf, match_pos, op)?;
            match_pos += 8;
        }
        op += 8;
        // `ZSTD_wildcopy(ZSTD_overlap_src_before_dst)`
        let mut done = 8usize;
        while done < match_length {
            copy_within::<8>(self.buf, match_pos, op)?;
            match_pos += 8;
            op += 8;
            done += 8;
        }
        Ok(())
    }

    /// `ZSTD_execSequenceEnd` and `ZSTD_execSequenceEndSplitLitBuffer`: near the end of a buffer.
    #[cold]
    #[inline(never)]
    fn exec_sequence_end(&mut self, sequence: Sequence) -> Result<()> {
        let op = self.op;
        let o_lit_end = op + sequence.lit_length;
        let sequence_length = sequence.lit_length + sequence.match_length;

        if sequence_length > self.oend - op {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        if sequence.lit_length > self.lit_limit - self.lit_pos {
            return Err(ErrorCode::CorruptionDetected);
        }
        if self.split {
            let lit_ptr = self.lit_in_dst.wrapping_add(self.lit_pos);
            if op > lit_ptr && op < lit_ptr + sequence.lit_length {
                return Err(ErrorCode::DstSizeTooSmall);
            }
        }

        self.buf
            .write_at(op, self.lits.span(self.lit_pos, sequence.lit_length)?)?;
        self.lit_pos += sequence.lit_length;
        self.copy_match::<false>(o_lit_end, sequence)?;
        self.op = op + sequence_length;
        Ok(())
    }

    /// `ZSTD_execSequence` and `ZSTD_execSequenceSplitLitBuffer`
    #[inline(always)]
    fn exec_sequence(&mut self, sequence: Sequence) -> Result<()> {
        let op = self.op;
        let o_lit_end = op + sequence.lit_length;
        let o_match_end = o_lit_end + sequence.match_length;
        let i_lit_end = self.lit_pos + sequence.lit_length;
        // How far a copy in chunks may write, plus `WILDCOPY_OVERLENGTH`.
        let limit = if self.split {
            self.lit_in_dst.wrapping_add(i_lit_end)
        } else {
            self.oend
        };

        if i_lit_end > self.lit_limit || o_match_end + WILDCOPY_OVERLENGTH > limit {
            return self.exec_sequence_end(sequence);
        }

        *self.buf.array_at_mut::<16>(op)? = *self.lits.array_at(self.lit_pos)?;
        if sequence.lit_length > 16 {
            self.buf
                .write_at(op + 16, self.lits.sub(self.lit_pos + 16..i_lit_end)?)?;
        }
        self.lit_pos = i_lit_end;
        self.copy_match::<true>(o_lit_end, sequence)?;
        self.op = o_match_end;
        Ok(())
    }

    /// A sequence, whose literals may start among those that would be in the output buffer and end among the others.
    #[inline(always)]
    fn exec_sequence_maybe_split(&mut self, mut sequence: Sequence) -> Result<()> {
        if self.split && self.lit_pos + sequence.lit_length > self.lit_limit {
            let leftover_lit = self.lit_limit - self.lit_pos;
            if leftover_lit > 0 {
                if leftover_lit > self.oend - self.op {
                    return Err(ErrorCode::DstSizeTooSmall);
                }
                self.buf
                    .write_at(self.op, self.lits.span(self.lit_pos, leftover_lit)?)?;
                sequence.lit_length -= leftover_lit;
                self.op += leftover_lit;
                self.lit_pos += leftover_lit;
            }
            self.split = false;
            self.lit_limit = self.lit_size;
        }
        self.exec_sequence(sequence)
    }

    /// `ZSTD_decompressSequences_body` and `ZSTD_decompressSequences_bodySplitLitBuffer`
    fn run(&mut self, seq_state: &mut SeqState<'_>, nb_seq: usize) -> Result<()> {
        for remaining in (1..=nb_seq).rev() {
            let sequence = seq_state.decode_sequence(remaining == 1);
            self.exec_sequence_maybe_split(sequence)?;
        }
        if !seq_state.bit_d.is_at_end() {
            return Err(ErrorCode::CorruptionDetected);
        }
        Ok(())
    }

    /// `ZSTD_decompressSequencesLong_body`: sequences are decoded 8 ahead of the one that is executed.
    fn run_long(&mut self, seq_state: &mut SeqState<'_>, nb_seq: usize) -> Result<()> {
        const STORED_SEQS: usize = 8;
        const STORED_SEQS_MASK: usize = STORED_SEQS - 1;
        let mut sequences = [Sequence::default(); STORED_SEQS];
        let seq_advance = nb_seq.min(STORED_SEQS);

        for (seq_nb, stored) in sequences.iter_mut().enumerate().take(seq_advance) {
            *stored = seq_state.decode_sequence(seq_nb == nb_seq - 1);
        }
        for seq_nb in seq_advance..nb_seq {
            let sequence = seq_state.decode_sequence(seq_nb == nb_seq - 1);
            let stored = sequences.at_mut(seq_nb & STORED_SEQS_MASK)?;
            self.exec_sequence_maybe_split(core::mem::replace(stored, sequence))?;
        }
        if !seq_state.bit_d.is_at_end() {
            return Err(ErrorCode::CorruptionDetected);
        }
        for seq_nb in nb_seq - seq_advance..nb_seq {
            self.exec_sequence_maybe_split(sequences.at(seq_nb & STORED_SEQS_MASK)?)?;
        }
        Ok(())
    }

    /// The literals after the last sequence.
    fn last_literals(&mut self) -> Result<()> {
        let last_ll_size = self.lit_size - self.lit_pos;
        if last_ll_size > self.oend - self.op {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        self.buf
            .write_at(self.op, self.lits.span(self.lit_pos, last_ll_size)?)?;
        self.op += last_ll_size;
        Ok(())
    }
}
