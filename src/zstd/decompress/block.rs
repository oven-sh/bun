//! `zstd_decompress_block.c`: one compressed block, which is literals and the sequences that mix them with matches.

use super::huf::{self, HufDTable};
use super::seq_table::{
    Cell, LL_BASE, ML_BASE, OF_BASE, OF_BITS, OffsetTable, SeqTable, SeqTableSources, SeqTables,
    TableSource,
};
use crate::common::bitstream::BitDStream;
use crate::common::entropy::read_ncount;
use crate::common::{
    BlockType, LL_BITS, LL_FSE_LOG, LONGNBSEQ, MAX_LL, MAX_ML, MAX_OFF, MAX_SEQ, MIN_CBLOCK_SIZE,
    MIN_LITERALS_FOR_4_STREAMS, MIN_SEQUENCES_SIZE, MINMATCH, ML_BITS, ML_FSE_LOG, OFF_FSE_LOG,
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
    pub(crate) seq: SeqTables,
    pub(crate) huf_table: HufDTable,
    pub(crate) rep: [u32; ZSTD_REP_NUM],
}

impl EntropyDTables {
    pub(crate) const fn new() -> Self {
        Self {
            seq: SeqTables::new(),
            huf_table: HufDTable::new(),
            rep: REP_START_VALUE,
        }
    }
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
    pub(crate) seq_sources: SeqTableSources,
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
            seq_sources: SeqTableSources::all(TableSource::Local),
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
            &mut self.entropy.seq.ll,
            &mut self.seq_sources.ll,
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
            &mut self.entropy.seq.of,
            &mut self.seq_sources.of,
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
            &mut self.entropy.seq.ml,
            &mut self.seq_sources.ml,
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
        let EntropyDTables { seq, rep, .. } = &mut **entropy;
        let tables = seq.gather(&mut self.seq_sources, dict_entropy.map(|dict| &dict.seq));

        // With matches far back in a long history, it pays to know the sequences ahead of time. Nothing is prefetched
        // here, but which of two problems in a damaged block is reported depends on the order.
        if !use_prefetch_decoder && total_history_size > (1 << 24) && nb_seq > 8 {
            const MIN_SHARE: u32 = 7;
            use_prefetch_decoder = long_offset_share(&tables.of) >= MIN_SHARE;
        }
        self.ddict_is_cold = false;
        if nb_seq > 0 {
            self.fse_entropy = true;
        }

        let oend = if literals.location == LitLocation::InDst {
            start + block_size_max + WILDCOPY_OVERLENGTH
        } else {
            start + capacity
        };
        let split = literals.location == LitLocation::Split;
        let lits = match literals.in_src {
            Some(start) => src.sub(start..)?,
            None => lit_buffer.as_slice(),
        };
        // How many would be in the output buffer, if some.
        let in_dst_size = if split {
            literals.size - LIT_BUFFER_EXTRA_SIZE
        } else {
            literals.size
        };
        let mut exec = Executor {
            buf: buf.sub_mut(..oend)?,
            op: start,
            prefix_start,
            ext_dict,
            lits: lits.sub(..in_dst_size + WILDCOPY_OVERLENGTH)?,
            split,
            lits_extra: lits.sub(in_dst_size..literals.size + WILDCOPY_OVERLENGTH)?,
            // `WILDCOPY_OVERLENGTH` short of how far the block is expected to write.
            lit_end_in_dst: (start + capacity.min(block_size_max))
                .wrapping_sub(WILDCOPY_OVERLENGTH),
        };

        if nb_seq > 0 {
            let mut seq_state = SeqState::new(sequences, tables, rep)?;
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
fn build_seq_table<C: Cell, const N: usize>(
    table: &mut SeqTable<C, N>,
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
fn long_offset_share(of_table: &OffsetTable) -> u32 {
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
    lit_length: u32,
    match_length: u32,
    offset: usize,
}

/// A sequence whose offset is as it is coded: 1 to 3 for one of the last offsets, or 3 more than the offset.
#[derive(Clone, Copy, Default)]
struct RawSequence {
    offset_value: u32,
    lit_length: u32,
    /// Above `MINMATCH`.
    match_length: u32,
}

/// `seqState_t`
#[derive(Clone, Copy)]
struct SeqState<'a> {
    bit_d: BitDStream<'a>,
    state_ll: usize,
    state_off: usize,
    state_ml: usize,
    tables: &'a SeqTables,
    prev_offset: [usize; ZSTD_REP_NUM],
}

impl<'a> SeqState<'a> {
    fn new(src: &'a [u8], tables: &'a SeqTables, rep: &[u32; ZSTD_REP_NUM]) -> Result<Self> {
        let mut bit_d = BitDStream::new(src).map_err(|_| ErrorCode::CorruptionDetected)?;
        // `ZSTD_initFseState`
        let mut init = |table_log: u32| {
            let state = bit_d.read_bits(table_log) as usize;
            bit_d.reload();
            state
        };
        let state_ll = init(tables.ll.table_log);
        let state_off = init(tables.of.table_log);
        let state_ml = init(tables.ml.table_log);
        Ok(Self {
            bit_d,
            state_ll,
            state_off,
            state_ml,
            tables,
            prev_offset: rep.map(|offset| offset as usize),
        })
    }

    /// Decodes sequences for as long as the start of the stream is far. Returns how many that is.
    #[inline(never)]
    fn decode_batch(&mut self, out: &mut [RawSequence]) -> Result<usize> {
        /// The 64 bits that end at `position`, turned so that the next one to read is the highest. Those that are read
        /// then go to the other end.
        #[inline(always)]
        fn load(containers: &[u8], position: u32) -> Option<u64> {
            // Wraps around less than `FAR` bytes from the start.
            let index = (position >> 3).wrapping_sub(FAR as u32) as usize;
            let container = containers.get(index..index + 8)?;
            let container = u64::from_le_bytes(container.try_into().ok()?);
            Some(container.rotate_left(!position & 7))
        }
        /// A sequence takes at most 12 bytes.
        const FAR: usize = 24;

        let src = self.bit_d.bytes();
        // A block is not that large.
        if src.len() < FAR || src.len() >= 1 << 28 || self.bit_d.bits_consumed > 64 {
            return Ok(0);
        }
        // How many bits are left to read, and 7.
        let mut position = src.len() as u32 * 8 + 7 - self.bit_d.bits_consumed;
        let containers = src.get(FAR - 8..).unwrap_or_default();
        let tables = self.tables;
        let mut state_ll = self.state_ll as u32 & 511;
        let mut state_ml = self.state_ml as u32 & 511;
        let mut state_off = self.state_off as u32 & 255;

        let room = out.len();
        let mut slots = out.iter_mut();
        let mut unused = 0;
        for slot in slots.by_ref() {
            let Some(mut bits) = load(containers, position) else {
                unused = 1;
                break;
            };
            let ll_cell = tables.ll.cell(state_ll as usize);
            let ml_cell = tables.ml.cell(state_ml as usize);
            let of_cell = tables.of.cell(state_off as usize);
            let of_bits = u32::from(of_cell.nb_additional_bits);
            let ml_bits = u32::from(ml_cell.nb_additional_bits);
            let ll_bits = u32::from(ll_cell.nb_additional_bits);

            let mut match_length = u32::from(ml_cell.base_value);
            let mut lit_length = u32::from(ll_cell.base_value);
            let first_value = of_cell.first_value;
            bits = bits.rotate_left(of_bits);
            position -= of_bits;
            let offset_value = first_value + (bits as u32 & (first_value - 1));
            if ml_bits + ll_bits != 0 {
                bits = bits.rotate_left(ml_bits);
                position -= ml_bits;
                match_length = ml_cell.base_value() + (bits as u32 & ((1 << ml_bits) - 1));
                // What follows has to fit in 57 bits with the 26 of the next states.
                bits = load(src, position + (FAR as u32 - 8) * 8).unwrap_or(0);
                bits = bits.rotate_left(ll_bits);
                position -= ll_bits;
                lit_length = ll_cell.base_value() + (bits as u32 & ((1 << ll_bits) - 1));
            }
            *slot = RawSequence {
                offset_value,
                lit_length,
                match_length,
            };

            let ll_nb_bits = u32::from(ll_cell.nb_bits);
            let ml_nb_bits = u32::from(ml_cell.nb_bits);
            let of_nb_bits = u32::from(of_cell.nb_bits);
            position -= ll_nb_bits + ml_nb_bits + of_nb_bits;
            bits = bits.rotate_left(ll_nb_bits);
            state_ll = (u32::from(ll_cell.next_state)
                + (bits as u32 & u32::from(ll_cell.state_mask)))
                & 511;
            bits = bits.rotate_left(ml_nb_bits);
            state_ml = (u32::from(ml_cell.next_state)
                + (bits as u32 & u32::from(ml_cell.state_mask)))
                & 511;
            bits = bits.rotate_left(of_nb_bits);
            state_off = (u32::from(of_cell.next_state)
                + (bits as u32 & u32::from(of_cell.state_mask)))
                & 255;
        }

        let count = room - slots.len() - unused;
        if count > 0 {
            self.bit_d = BitDStream::resume(src, (position >> 3) as usize - 8, !position & 7)?;
            self.state_ll = state_ll as usize;
            self.state_ml = state_ml as usize;
            self.state_off = state_off as usize;
        }
        Ok(count)
    }

    /// `ZSTD_decodeSequence`
    #[inline(always)]
    fn decode_sequence(&mut self, is_last_seq: bool) -> Sequence {
        let ll_d_info = self.tables.ll.get(self.state_ll);
        let ml_d_info = self.tables.ml.get(self.state_ml);
        let of_d_info = self.tables.of.get(self.state_off);
        let mut match_length = ml_d_info.base_value + MINMATCH;
        let mut lit_length = ll_d_info.base_value;
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
            match_length += self.bit_d.read_bits_fast(ml_bits) as u32;
        }
        const ACCUMULATOR_MIN: u32 = 57;
        if total_bits >= ACCUMULATOR_MIN - (LL_FSE_LOG + ML_FSE_LOG + OFF_FSE_LOG) {
            self.bit_d.reload();
        }
        if ll_bits > 0 {
            lit_length += self.bit_d.read_bits_fast(ll_bits) as u32;
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

/// The same for positions that do not overflow. Whether they are in `buf`.
#[inline(always)]
fn copy_16(buf: &mut [u8], src: usize, dst: usize) -> bool {
    let Some(Ok(chunk)) = buf.get(src..src + 16).map(<[u8; 16]>::try_from) else {
        return false;
    };
    let Some(to) = buf.get_mut(dst..dst + 16) else {
        return false;
    };
    to.copy_from_slice(&chunk);
    true
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
struct Executor<'buf, 'a> {
    /// Ends where the block has to stop writing: `oend`.
    buf: &'buf mut [u8],
    op: usize,
    prefix_start: usize,
    ext_dict: ExtDict<'a>,
    /// The literals that are left, up to `litBufferEnd`, and `WILDCOPY_OVERLENGTH` bytes after them.
    lits: &'a [u8],
    /// `litBufferLocation == ZSTD_split`: `lits` would be in the output buffer.
    split: bool,
    /// The literals that come after `lits` then, likewise.
    lits_extra: &'a [u8],
    /// Where in `buf` `lits` would end then.
    lit_end_in_dst: usize,
}

impl<'a> Executor<'_, 'a> {
    /// `litBufferEnd - litPtr`
    #[inline(always)]
    fn lits_left(&self) -> usize {
        self.lits.len().saturating_sub(WILDCOPY_OVERLENGTH)
    }

    /// The same, for a while. A loop works on a copy that is a local variable and whose address nothing takes, which
    /// can stay in registers. What is behind a reference is written and read again for every sequence.
    #[inline(always)]
    fn fork(&mut self) -> Executor<'_, 'a> {
        Executor {
            buf: &mut *self.buf,
            ..*self
        }
    }

    #[inline(always)]
    fn join(&mut self, (op, lits, split): (usize, &'a [u8], bool)) {
        (self.op, self.lits, self.split) = (op, lits, split);
    }

    #[inline(always)]
    fn exec_sequence_end(&mut self, sequence: Sequence) -> Result<()> {
        let mut fork = self.fork();
        fork.exec_sequence_end_cold(sequence)?;
        let state = (fork.op, fork.lits, fork.split);
        self.join(state);
        Ok(())
    }

    /// `ZSTD_execSequenceEnd` and `ZSTD_execSequenceEndSplitLitBuffer`: nothing is written past the sequence. Also what
    /// `ZSTD_execSequence` does of a match that starts before the prefix.
    #[cold]
    #[inline(never)]
    fn exec_sequence_end_cold(&mut self, sequence: Sequence) -> Result<()> {
        let lit_length = sequence.lit_length as usize;
        let mut match_length = sequence.match_length as usize;
        let offset = sequence.offset;
        let mut op = self.op;

        if lit_length + match_length > self.buf.len() - op {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        if lit_length > self.lits_left() {
            return Err(ErrorCode::CorruptionDetected);
        }
        if self.split {
            let lit_ptr = self.lit_end_in_dst.wrapping_sub(self.lits_left());
            if op > lit_ptr && op < lit_ptr.wrapping_add(lit_length) {
                return Err(ErrorCode::DstSizeTooSmall);
            }
        }

        self.buf.write_at(op, self.lits.sub(..lit_length)?)?;
        self.lits = self.lits.sub(lit_length..)?;
        op += lit_length;
        self.op = op + match_length;

        let in_prefix = op - self.prefix_start;
        let mut match_pos = op.wrapping_sub(offset);
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
        copy_match_exact(self.buf, match_pos, op, match_length)
    }

    /// `ZSTD_execSequence` and `ZSTD_execSequenceSplitLitBuffer`, if there is room to copy in chunks and the match is
    /// in the prefix. Otherwise `None`, and what is changed is only output that the sequence is to overwrite.
    ///
    /// The conditions are such that the compiler sees that most of the `?` cannot fail.
    #[inline(always)]
    fn exec_sequence_fast<const SPLIT: bool>(&mut self, sequence: Sequence) -> Option<()> {
        let lit_length = sequence.lit_length as usize;
        let match_length = sequence.match_length as usize;
        let offset = sequence.offset;
        let op = self.op;

        let room = self.buf.get_mut(op..)?;
        if lit_length + match_length + WILDCOPY_OVERLENGTH > room.len()
            || lit_length + WILDCOPY_OVERLENGTH > self.lits.len()
        {
            return None;
        }
        if SPLIT {
            // The output must not catch up with the literals.
            let i_lit_end = (self.lit_end_in_dst)
                .wrapping_sub(self.lits.len() - WILDCOPY_OVERLENGTH)
                .wrapping_add(lit_length);
            if op + lit_length + match_length + WILDCOPY_OVERLENGTH > i_lit_end {
                return None;
            }
        }

        *room.first_chunk_mut::<16>()? = *self.lits.first_chunk()?;
        if lit_length > 16 {
            room.get_mut(16..lit_length)?
                .copy_from_slice(self.lits.get(16..lit_length)?);
        }

        let o_lit_end = op + lit_length;
        if offset > o_lit_end - self.prefix_start {
            return None;
        }
        let (before, room) = self.buf.split_at_mut_checked(o_lit_end)?;
        let from = before.get(before.len().checked_sub(offset)?..)?;
        if offset >= 16 {
            // `ZSTD_wildcopy(ZSTD_no_overlap)`
            *room.first_chunk_mut::<16>()? = *from.first_chunk()?;
            if match_length > 16 {
                let rounded = (match_length + 15) & !15;
                if offset >= rounded {
                    room.get_mut(16..rounded)?
                        .copy_from_slice(from.get(16..rounded)?);
                } else {
                    let mut done = 16;
                    while done < match_length {
                        let to = o_lit_end + done;
                        copy_within::<16>(self.buf, to - offset, to).ok()?;
                        done += 16;
                    }
                }
            }
        } else {
            self.copy_close_match(o_lit_end, offset, match_length)
                .ok()?;
        }

        self.lits = self.lits.get(lit_length..)?;
        self.op = o_lit_end + match_length;
        Some(())
    }

    /// `ZSTD_overlapCopy8` and `ZSTD_wildcopy(ZSTD_overlap_src_before_dst)`: a match less than 16 bytes back.
    #[inline(always)]
    fn copy_close_match(
        &mut self,
        mut op: usize,
        offset: usize,
        match_length: usize,
    ) -> Result<()> {
        let mut match_pos = op - offset;
        // After 8 bytes, the source is at least 8 bytes behind.
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
        let mut done = 8usize;
        while done < match_length {
            copy_within::<8>(self.buf, match_pos, op)?;
            match_pos += 8;
            op += 8;
            done += 8;
        }
        Ok(())
    }

    #[inline(always)]
    fn exec_sequence<const SPLIT: bool>(&mut self, sequence: Sequence) -> Result<()> {
        match self.exec_sequence_fast::<SPLIT>(sequence) {
            Some(()) => Ok(()),
            None => self.exec_sequence_end(sequence),
        }
    }

    /// The first sequence whose literals do not end among those that would be in the output buffer.
    #[inline(always)]
    fn exec_sequence_leaving_split(&mut self, sequence: Sequence) -> Result<()> {
        let mut fork = self.fork();
        fork.exec_sequence_leaving_split_cold(sequence)?;
        let state = (fork.op, fork.lits, fork.split);
        self.join(state);
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn exec_sequence_leaving_split_cold(&mut self, mut sequence: Sequence) -> Result<()> {
        let leftover_lit = self.lits_left();
        if leftover_lit > 0 {
            if leftover_lit > self.buf.len() - self.op {
                return Err(ErrorCode::DstSizeTooSmall);
            }
            self.buf.write_at(self.op, self.lits.sub(..leftover_lit)?)?;
            sequence.lit_length -= leftover_lit as u32;
            self.op += leftover_lit;
        }
        self.split = false;
        self.lits = self.lits_extra;
        self.exec_sequence::<false>(sequence)
    }

    #[inline(always)]
    fn exec_sequence_maybe_split(&mut self, sequence: Sequence) -> Result<()> {
        if !self.split {
            self.exec_sequence::<false>(sequence)
        } else if sequence.lit_length as usize > self.lits_left() {
            self.exec_sequence_leaving_split(sequence)
        } else {
            self.exec_sequence::<true>(sequence)
        }
    }

    /// Executes `sequences` from `index` on, for as long as nothing is close to its end and they are of the common kind.
    /// Returns the index of the first that is not, whose offset value then is no reference to one of the last offsets:
    /// it is 0 if that is not valid.
    ///
    /// The last offsets are those of the 3 sequences before, which are rewritten for that where it takes it.
    #[inline(never)]
    fn exec_batch(&mut self, sequences: &mut [RawSequence], mut index: usize) -> usize {
        // Positions fit in 32 bits, so that the compiler sees that nothing added to them overflows.
        const MAX_BACK: usize = 3 << 30;
        let start = self.prefix_start.max(self.op.saturating_sub(MAX_BACK));
        let end = self.buf.len().min(start + u32::MAX as usize);
        let buf = self.buf.get_mut(start..end).unwrap_or_default();
        let mut op = self.op.wrapping_sub(start) as u32;
        let lits = self.lits.get(..u32::MAX as usize).unwrap_or(self.lits);
        let mut lit_pos = 0u32;

        while let Some(raw) = sequences.get(index) {
            let lit_length = raw.lit_length as usize;
            let match_length = raw.match_length as usize + MINMATCH as usize;
            let mut offset_value = raw.offset_value;
            if offset_value < 16 + 3 {
                if offset_value <= 3 {
                    let Some([last2, last1, last0, this]) = index
                        .checked_sub(3)
                        .and_then(|first| sequences.get_mut(first..))
                        .and_then(<[RawSequence]>::first_chunk_mut)
                    else {
                        break;
                    };
                    let rep0 = last0.offset_value;
                    let rep1 = last1.offset_value;
                    let rep2 = last2.offset_value;
                    let reps = match offset_value - 1 + u32::from(lit_length == 0) {
                        0 => [rep0, rep1, rep2],
                        1 => [rep1, rep0, rep2],
                        2 => [rep2, rep0, rep1],
                        // An offset of 0 is not valid.
                        _ if rep0 == 1 + 3 => [0, rep0, rep1],
                        _ => [rep0 - 1, rep0, rep1],
                    };
                    [this.offset_value, last0.offset_value, last1.offset_value] = reps;
                    [offset_value, ..] = reps;
                }
                if offset_value < 16 + 3 {
                    break;
                }
            }

            let o_lit_end = op as usize + lit_length;
            let o_match_end = o_lit_end + match_length;
            let lit_end = lit_pos as usize + lit_length;
            if o_match_end + WILDCOPY_OVERLENGTH > buf.len()
                || lit_end + WILDCOPY_OVERLENGTH > lits.len()
                || lit_length > 32
                || match_length > 64
                || offset_value as usize > o_lit_end + 3
            {
                break;
            }
            let match_pos = o_lit_end + 3 - offset_value as usize;
            let (Some(to), Some(from)) = (
                buf.get_mut(op as usize..op as usize + 32),
                lits.get(lit_pos as usize..lit_pos as usize + 32),
            ) else {
                break;
            };
            to.copy_from_slice(from);
            if !copy_16(buf, match_pos, o_lit_end) || !copy_16(buf, match_pos + 16, o_lit_end + 16)
            {
                break;
            }
            if match_length > 32
                && (!copy_16(buf, match_pos + 32, o_lit_end + 32)
                    || !copy_16(buf, match_pos + 48, o_lit_end + 48))
            {
                break;
            }

            op = o_match_end as u32;
            lit_pos = lit_end as u32;
            index += 1;
        }

        self.op = op as usize + start;
        self.lits = self.lits.get(lit_pos as usize..).unwrap_or_default();
        index
    }

    /// `ZSTD_decompressSequences_body` and `ZSTD_decompressSequences_bodySplitLitBuffer`
    fn run(&mut self, seq_state: &mut SeqState<'_>, nb_seq: usize) -> Result<()> {
        const BATCH: usize = 32;
        // After 3 that only stand for the last offsets.
        let mut batch = [RawSequence::default(); 3 + BATCH];
        let mut remaining = nb_seq;
        while remaining > 0 {
            if !self.split {
                let room = batch.span_mut(3, BATCH.min(remaining - 1))?;
                let count = seq_state.decode_batch(room)?;
                if count > 0 {
                    remaining -= count;
                    let sequences = batch.sub_mut(..3 + count)?;
                    for (last, offset) in
                        sequences.iter_mut().zip(seq_state.prev_offset.iter().rev())
                    {
                        last.offset_value = *offset as u32 + 3;
                    }
                    let mut index = 3;
                    loop {
                        index = self.exec_batch(sequences, index);
                        let Some(raw) = sequences.get(index) else {
                            break;
                        };
                        self.exec_sequence::<false>(Sequence {
                            lit_length: raw.lit_length,
                            match_length: raw.match_length + MINMATCH,
                            offset: (raw.offset_value as usize).wrapping_sub(3),
                        })?;
                        index += 1;
                    }
                    for (last, offset) in sequences.iter().rev().zip(&mut seq_state.prev_offset) {
                        *offset = last.offset_value as usize - 3;
                    }
                    continue;
                }
            }
            let sequence = seq_state.decode_sequence(remaining == 1);
            remaining -= 1;
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
        let extra = if self.split { self.lits_extra } else { &[] };
        let parts = [self.lits, extra]
            .map(|part| part.get(..part.len().saturating_sub(WILDCOPY_OVERLENGTH)));
        let parts = parts.map(Option::unwrap_or_default);
        if parts.iter().map(|part| part.len()).sum::<usize>() > self.buf.len() - self.op {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        for part in parts {
            self.buf.write_at(self.op, part)?;
            self.op += part.len();
        }
        Ok(())
    }
}
