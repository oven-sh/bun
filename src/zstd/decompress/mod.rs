//! `zstd_decompress.c` and `zstd_ddict.c`: frames, dictionaries and streaming.

mod block;
mod huf;
mod huf_exact;
mod seq_table;

use std::borrow::Cow;

use block::{
    BlockDecoder, BlockOutput, EntropyDTables, ExtDict, OutputBuffer, Streaming, get_c_block_size,
};
use seq_table::{LL_CODES, ML_CODES, OF_CODES, SeqTableSources, TableSource};

use crate::common::entropy::read_ncount;
use crate::common::xxhash::Xxh64;
use crate::common::{
    BlockType, LL_FSE_LOG, MAX_LL, MAX_ML, MAX_OFF, ML_FSE_LOG, OFF_FSE_LOG, REP_START_VALUE,
    WILDCOPY_OVERLENGTH, ZSTD_BLOCKHEADERSIZE, ZSTD_BLOCKSIZE_MAX, ZSTD_CONTENTSIZE_ERROR,
    ZSTD_CONTENTSIZE_UNKNOWN, ZSTD_DID_FIELD_SIZE, ZSTD_FCS_FIELD_SIZE, ZSTD_FRAMEHEADERSIZE_MAX,
    ZSTD_FRAMEIDSIZE, ZSTD_MAGIC_DICTIONARY, ZSTD_MAGIC_SKIPPABLE_MASK, ZSTD_MAGIC_SKIPPABLE_START,
    ZSTD_MAGICNUMBER, ZSTD_REP_NUM, ZSTD_SKIPPABLEHEADERSIZE, ZSTD_WINDOWLOG_ABSOLUTEMIN,
    ZSTD_WINDOWLOG_LIMIT_DEFAULT, ZSTD_WINDOWLOG_MAX, ZSTD_WORKSPACETOOLARGE_FACTOR,
    ZSTD_WORKSPACETOOLARGE_MAXDURATION,
};
use crate::error::{ErrorCode, Result};
use crate::util::{SliceExt, read_le16, read_le32, read_le64, try_copy};
use crate::{InBuffer, OutBuffer};

/// `ZSTD_FRAMEHEADERSIZE_PREFIX`: what it takes to know the size of a frame header.
const FRAMEHEADERSIZE_PREFIX: usize = 5;
const FRAMEHEADERSIZE_MIN: usize = 6;

const ZSTD_MAXWINDOWSIZE_DEFAULT: usize = (1 << ZSTD_WINDOWLOG_LIMIT_DEFAULT) + 1;
const ZSTD_NO_FORWARD_PROGRESS_MAX: u32 = 16;

/// `ZSTD_d_windowLogMax`, the only parameter of a [`DCtx`] that `node:zlib` can name.
pub const ZSTD_D_WINDOW_LOG_MAX: i32 = 100;

// ── frame headers ─────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum FrameType {
    Frame,
    Skippable,
}

/// `ZSTD_FrameHeader`
#[derive(Clone, Copy)]
struct FrameHeader {
    /// [`ZSTD_CONTENTSIZE_UNKNOWN`] if the header does not say. For a skippable frame, the size of its content.
    frame_content_size: u64,
    window_size: u64,
    block_size_max: usize,
    frame_type: FrameType,
    header_size: usize,
    dict_id: u32,
    checksum_flag: bool,
}

impl FrameHeader {
    const EMPTY: Self = Self {
        frame_content_size: 0,
        window_size: 0,
        block_size_max: 0,
        frame_type: FrameType::Frame,
        header_size: 0,
        dict_id: 0,
        checksum_flag: false,
    };
}

enum HeaderStatus {
    Complete,
    /// The header cannot be read from fewer bytes than this.
    Needs(usize),
}

#[inline]
fn is_skippable_magic(magic: u32) -> bool {
    magic & ZSTD_MAGIC_SKIPPABLE_MASK == ZSTD_MAGIC_SKIPPABLE_START
}

/// `ZSTD_frameHeaderSize_internal`
fn frame_header_size(src: &[u8]) -> Result<usize> {
    if src.len() < FRAMEHEADERSIZE_PREFIX {
        return Err(ErrorCode::SrcSizeWrong);
    }
    let fhd = src.at(FRAMEHEADERSIZE_PREFIX - 1)?;
    let dict_id = usize::from(fhd & 3);
    let single_segment = (fhd >> 5) & 1 != 0;
    let fcs_id = usize::from(fhd >> 6);
    Ok(FRAMEHEADERSIZE_PREFIX
        + usize::from(!single_segment)
        + ZSTD_DID_FIELD_SIZE.at(dict_id)?
        + ZSTD_FCS_FIELD_SIZE.at(fcs_id)?
        + usize::from(single_segment && fcs_id == 0))
}

/// `ZSTD_getFrameHeader`: sets `header` if the one at the start of `src` is complete.
fn get_frame_header(header: &mut FrameHeader, src: &[u8]) -> Result<HeaderStatus> {
    const MIN_INPUT_SIZE: usize = FRAMEHEADERSIZE_PREFIX;

    if src.len() < MIN_INPUT_SIZE {
        if !src.is_empty() {
            // Refuse what cannot become a magic number.
            let known = src.sub(..src.len().min(4))?;
            let mut hbuf = ZSTD_MAGICNUMBER.to_le_bytes();
            hbuf.write_at(0, known)?;
            if u32::from_le_bytes(hbuf) != ZSTD_MAGICNUMBER {
                hbuf = ZSTD_MAGIC_SKIPPABLE_START.to_le_bytes();
                hbuf.write_at(0, known)?;
                if !is_skippable_magic(u32::from_le_bytes(hbuf)) {
                    return Err(ErrorCode::PrefixUnknown);
                }
            }
        }
        return Ok(HeaderStatus::Needs(MIN_INPUT_SIZE));
    }

    let magic = read_le32(src, 0)?;
    if magic != ZSTD_MAGICNUMBER {
        if is_skippable_magic(magic) {
            if src.len() < ZSTD_SKIPPABLEHEADERSIZE {
                return Ok(HeaderStatus::Needs(ZSTD_SKIPPABLEHEADERSIZE));
            }
            *header = FrameHeader {
                frame_type: FrameType::Skippable,
                dict_id: magic - ZSTD_MAGIC_SKIPPABLE_START,
                header_size: ZSTD_SKIPPABLEHEADERSIZE,
                frame_content_size: u64::from(read_le32(src, ZSTD_FRAMEIDSIZE)?),
                ..FrameHeader::EMPTY
            };
            return Ok(HeaderStatus::Complete);
        }
        return Err(ErrorCode::PrefixUnknown);
    }

    let fhsize = frame_header_size(src)?;
    if src.len() < fhsize {
        return Ok(HeaderStatus::Needs(fhsize));
    }

    let fhd_byte = src.at(MIN_INPUT_SIZE - 1)?;
    let mut pos = MIN_INPUT_SIZE;
    let dict_id_size_code = fhd_byte & 3;
    let checksum_flag = (fhd_byte >> 2) & 1 != 0;
    let single_segment = (fhd_byte >> 5) & 1 != 0;
    let fcs_id = fhd_byte >> 6;
    let mut window_size = 0u64;
    let mut dict_id = 0u32;
    let mut frame_content_size = ZSTD_CONTENTSIZE_UNKNOWN;
    if fhd_byte & 0x08 != 0 {
        return Err(ErrorCode::FrameParameterUnsupported);
    }

    if !single_segment {
        let wl_byte = src.at(pos)?;
        pos += 1;
        let window_log = u32::from(wl_byte >> 3) + ZSTD_WINDOWLOG_ABSOLUTEMIN;
        if window_log > ZSTD_WINDOWLOG_MAX {
            return Err(ErrorCode::FrameParameterWindowTooLarge);
        }
        window_size = 1u64 << window_log;
        window_size += (window_size >> 3) * u64::from(wl_byte & 7);
    }
    match dict_id_size_code {
        1 => {
            dict_id = u32::from(src.at(pos)?);
            pos += 1;
        }
        2 => {
            dict_id = u32::from(read_le16(src, pos)?);
            pos += 2;
        }
        3 => {
            dict_id = read_le32(src, pos)?;
            pos += 4;
        }
        _ => {}
    }
    match fcs_id {
        1 => frame_content_size = u64::from(read_le16(src, pos)?) + 256,
        2 => frame_content_size = u64::from(read_le32(src, pos)?),
        3 => frame_content_size = read_le64(src, pos)?,
        _ => {
            if single_segment {
                frame_content_size = u64::from(src.at(pos)?);
            }
        }
    }
    if single_segment {
        window_size = frame_content_size;
    }

    *header = FrameHeader {
        frame_type: FrameType::Frame,
        frame_content_size,
        window_size,
        block_size_max: window_size.min(ZSTD_BLOCKSIZE_MAX as u64) as usize,
        header_size: fhsize,
        dict_id,
        checksum_flag,
    };
    Ok(HeaderStatus::Complete)
}

/// `ZSTD_getFrameContentSize`: [`ZSTD_CONTENTSIZE_UNKNOWN`] if the frame at the start of `src` does not say, and
/// [`ZSTD_CONTENTSIZE_ERROR`] if there is no whole frame header.
pub fn get_frame_content_size(src: &[u8]) -> u64 {
    let mut header = FrameHeader::EMPTY;
    match get_frame_header(&mut header, src) {
        Ok(HeaderStatus::Complete) => match header.frame_type {
            FrameType::Skippable => 0,
            FrameType::Frame => header.frame_content_size,
        },
        _ => ZSTD_CONTENTSIZE_ERROR,
    }
}

/// The size of the skippable frame whose header is at the start of `src`.
fn skippable_frame_size(src: &[u8]) -> Result<usize> {
    if src.len() < ZSTD_SKIPPABLEHEADERSIZE {
        return Err(ErrorCode::SrcSizeWrong);
    }
    let size_u32 = read_le32(src, ZSTD_FRAMEIDSIZE)?;
    if size_u32
        .checked_add(ZSTD_SKIPPABLEHEADERSIZE as u32)
        .is_none()
    {
        return Err(ErrorCode::FrameParameterUnsupported);
    }
    Ok(ZSTD_SKIPPABLEHEADERSIZE + size_u32 as usize)
}

/// `readSkippableFrameSize`
fn read_skippable_frame_size(src: &[u8]) -> Result<usize> {
    let skippable_size = skippable_frame_size(src)?;
    if skippable_size > src.len() {
        return Err(ErrorCode::SrcSizeWrong);
    }
    Ok(skippable_size)
}

/// How far a frame goes.
pub enum FrameExtent {
    /// It is this many bytes.
    Whole(usize),
    /// It goes on past what there is of it, and is at least this many bytes.
    AtLeast(usize),
}

/// How far the frame at the start of `src` goes, for when where it ends is not known in advance.
pub fn frame_extent(src: &[u8]) -> Result<FrameExtent> {
    if src.len() >= ZSTD_SKIPPABLEHEADERSIZE && is_skippable_magic(read_le32(src, 0)?) {
        let size = skippable_frame_size(src)?;
        return Ok(if size <= src.len() {
            FrameExtent::Whole(size)
        } else {
            FrameExtent::AtLeast(size)
        });
    }
    let mut header = FrameHeader::EMPTY;
    if let HeaderStatus::Needs(size) = get_frame_header(&mut header, src)? {
        return Ok(FrameExtent::AtLeast(size));
    }
    let mut ip = header.header_size;
    loop {
        let Some(remaining) = src
            .get(ip..)
            .filter(|rest| rest.len() >= ZSTD_BLOCKHEADERSIZE)
        else {
            return Ok(FrameExtent::AtLeast(ip + ZSTD_BLOCKHEADERSIZE));
        };
        let (c_block_size, properties) = get_c_block_size(remaining)?;
        ip += ZSTD_BLOCKHEADERSIZE + c_block_size;
        if properties.last_block {
            break;
        }
    }
    if header.checksum_flag {
        ip += 4;
    }
    Ok(if ip <= src.len() {
        FrameExtent::Whole(ip)
    } else {
        FrameExtent::AtLeast(ip)
    })
}

/// `ZSTD_findFrameCompressedSize`: how many bytes the frame at the start of `src` takes.
fn find_frame_compressed_size(src: &[u8]) -> Result<usize> {
    match frame_extent(src)? {
        FrameExtent::Whole(size) => Ok(size),
        FrameExtent::AtLeast(_) => Err(ErrorCode::SrcSizeWrong),
    }
}

/// `ZSTD_findDecompressedSize`: the size of all the frames of `src` together, once decompressed.
/// [`ZSTD_CONTENTSIZE_UNKNOWN`] if one of them does not say, [`ZSTD_CONTENTSIZE_ERROR`] if `src` is not whole frames.
pub(crate) fn find_decompressed_size(mut src: &[u8]) -> u64 {
    let mut total_dst_size = 0u64;
    while src.len() >= FRAMEHEADERSIZE_PREFIX {
        let frame_src_size = if read_le32(src, 0).is_ok_and(is_skippable_magic) {
            read_skippable_frame_size(src)
        } else {
            let fcs = get_frame_content_size(src);
            if fcs >= ZSTD_CONTENTSIZE_ERROR {
                return fcs;
            }
            match total_dst_size.checked_add(fcs) {
                Some(total) => total_dst_size = total,
                None => return ZSTD_CONTENTSIZE_ERROR,
            }
            find_frame_compressed_size(src)
        };
        match frame_src_size.ok().and_then(|size| src.get(size..)) {
            Some(rest) => src = rest,
            None => return ZSTD_CONTENTSIZE_ERROR,
        }
    }
    if !src.is_empty() {
        return ZSTD_CONTENTSIZE_ERROR;
    }
    total_dst_size
}

// ── dictionaries ──────────────────────────────────────────────────────────

/// `ZSTD_loadDEntropy`: reads the tables at the start of a dictionary, and returns the last offsets that it sets.
fn load_d_entropy(entropy: &mut EntropyDTables, dict: &[u8]) -> Result<[u32; ZSTD_REP_NUM]> {
    const CORRUPTED: ErrorCode = ErrorCode::DictionaryCorrupted;
    if dict.len() <= 8 {
        return Err(CORRUPTED);
    }
    // The magic number and the ID.
    let mut pos = 8usize;

    pos += huf::read_dtable_x2(
        &mut entropy.huf_table,
        dict.sub(pos..)?,
        &mut entropy.workspace,
    )
    .map_err(|_| CORRUPTED)?;

    {
        let header = read_ncount(&mut entropy.workspace.counts, MAX_OFF, dict.sub(pos..)?)
            .map_err(|_| CORRUPTED)?;
        if header.max_symbol_value > MAX_OFF || header.table_log > OFF_FSE_LOG {
            return Err(CORRUPTED);
        }
        entropy.seq.of.build(
            header.max_symbol_value as usize + 1,
            &OF_CODES,
            header.table_log,
            &mut entropy.workspace,
        )?;
        pos += header.size;
    }
    {
        let header = read_ncount(&mut entropy.workspace.counts, MAX_ML, dict.sub(pos..)?)
            .map_err(|_| CORRUPTED)?;
        if header.max_symbol_value > MAX_ML || header.table_log > ML_FSE_LOG {
            return Err(CORRUPTED);
        }
        entropy.seq.ml.build(
            header.max_symbol_value as usize + 1,
            &ML_CODES,
            header.table_log,
            &mut entropy.workspace,
        )?;
        pos += header.size;
    }
    {
        let header = read_ncount(&mut entropy.workspace.counts, MAX_LL, dict.sub(pos..)?)
            .map_err(|_| CORRUPTED)?;
        if header.max_symbol_value > MAX_LL || header.table_log > LL_FSE_LOG {
            return Err(CORRUPTED);
        }
        entropy.seq.ll.build(
            header.max_symbol_value as usize + 1,
            &LL_CODES,
            header.table_log,
            &mut entropy.workspace,
        )?;
        pos += header.size;
    }

    if pos + 12 > dict.len() {
        return Err(CORRUPTED);
    }
    let dict_content_size = dict.len() - (pos + 12);
    let mut reps = [0; ZSTD_REP_NUM];
    for rep in &mut reps {
        *rep = read_le32(dict, pos)?;
        pos += 4;
        if *rep == 0 || *rep as usize > dict_content_size {
            return Err(CORRUPTED);
        }
    }
    Ok(reps)
}

/// `ZSTD_dictContentType_e`
#[derive(Clone, Copy, PartialEq, Eq)]
enum DictContentType {
    /// A dictionary with tables if it starts with the magic number of one, else content to refer to.
    Auto,
    RawContent,
}

/// `ZSTD_DDict`: a dictionary that is ready to decompress with.
pub struct DDict<'a> {
    /// All of it. Matches can reach into the tables too.
    content: Cow<'a, [u8]>,
    /// The tables, if the dictionary has some.
    entropy: Option<Box<EntropyDTables>>,
    /// The last offsets that a frame starts with.
    rep: [u32; ZSTD_REP_NUM],
    dict_id: u32,
}

impl<'a> DDict<'a> {
    /// `ZSTD_initDDict_internal`
    fn new(content: Cow<'a, [u8]>, content_type: DictContentType) -> Result<Self> {
        let mut ddict = Self {
            content,
            entropy: None,
            rep: REP_START_VALUE,
            dict_id: 0,
        };
        let dict = &*ddict.content;
        if content_type == DictContentType::RawContent
            || dict.len() < 8
            || read_le32(dict, 0)? != ZSTD_MAGIC_DICTIONARY
        {
            return Ok(ddict);
        }
        ddict.dict_id = read_le32(dict, ZSTD_FRAMEIDSIZE)?;
        let mut entropy = Box::new(EntropyDTables::new());
        ddict.rep =
            load_d_entropy(&mut entropy, dict).map_err(|_| ErrorCode::DictionaryCorrupted)?;
        ddict.entropy = Some(entropy);
        Ok(ddict)
    }

    /// `ZSTD_createDDict_byReference`
    pub fn by_reference(dict: &'a [u8]) -> Result<Self> {
        Self::new(Cow::Borrowed(dict), DictContentType::Auto)
    }

    /// What `ZSTD_DCtx_refPrefix` makes of `prefix`: content to refer to, whatever it starts with.
    pub(crate) fn prefix(prefix: &'a [u8]) -> Result<Self> {
        Self::new(Cow::Borrowed(prefix), DictContentType::RawContent)
    }

    /// The address one past the content, which stands for the dictionary where the C code compares pointers.
    fn end_address(&self) -> usize {
        self.content.as_ptr_range().end.addr()
    }
}

// ── the context ───────────────────────────────────────────────────────────

/// `ZSTD_dStage`
#[derive(Clone, Copy, PartialEq, Eq)]
enum DStage {
    GetFrameHeaderSize,
    DecodeBlockHeader,
    DecompressBlock,
    DecompressLastBlock,
    CheckChecksum,
    SkipFrame,
}

/// `ZSTD_dStreamStage`
#[derive(Clone, Copy, PartialEq, Eq)]
enum DStreamStage {
    Init,
    /// `lh_size` bytes of the frame header are in `header_buffer`.
    LoadHeader {
        lh_size: usize,
    },
    Read,
    Load,
    Flush,
}

/// What precedes `prefix_start`.
#[derive(Clone, Copy)]
enum ExtKind {
    /// The dictionary, or nothing.
    Dict,
    /// See [`ExtDict::Within`].
    Within { end: usize, len: usize },
}

/// A buffer whose size a frame header dictates. It takes up no more memory than has been used of it.
struct Buffer {
    /// What has been used so far. There is capacity for `size`.
    bytes: Vec<u8>,
    size: usize,
}

impl Buffer {
    const fn new() -> Self {
        Self {
            bytes: Vec::new(),
            size: 0,
        }
    }

    fn with_size(size: usize) -> Result<Self> {
        let mut bytes = Vec::new();
        bytes
            .try_reserve_exact(size)
            .map_err(|_| ErrorCode::MemoryAllocation)?;
        Ok(Self { bytes, size })
    }

    /// The `len` bytes from `start` on, which are within `size`.
    fn span_mut(&mut self, start: usize, len: usize) -> Result<&mut [u8]> {
        let end = start + len;
        if self.bytes.len() < end && end <= self.size {
            self.bytes.resize(end, 0);
        }
        self.bytes.span_mut(start, len)
    }
}

impl Default for Buffer {
    fn default() -> Self {
        Self::new()
    }
}

/// All of a `ZSTD_DCtx` but the dictionary it owns.
struct DState {
    block: BlockDecoder,

    // `prefixStart`, `previousDstEnd`, `virtualStart` and `dictEnd`, as positions in the buffer that is written to.
    prefix_start: usize,
    /// `None`: nothing of this frame is written yet.
    previous_dst_end: Option<usize>,
    ext: ExtKind,
    /// The address `dictEnd` would hold if it points to the end of a dictionary. 0 for `NULL`, 1 for anything else.
    dict_end_address: usize,

    expected: usize,
    f_params: FrameHeader,
    decoded_size: u64,
    b_type: BlockType,
    stage: DStage,
    xxh_state: Xxh64,
    validate_checksum: bool,
    rle_size: usize,
    dict_id: u32,

    stream_stage: DStreamStage,
    in_buff: Buffer,
    in_pos: usize,
    max_window_size: usize,
    out_buff: Buffer,
    out_start: usize,
    out_end: usize,
    /// The last byte of a frame's input is held back until its output is flushed.
    hostage_byte: bool,
    no_forward_progress: u32,
    header_buffer: [u8; ZSTD_FRAMEHEADERSIZE_MAX],
    oversized_duration: usize,
}

/// `ZSTD_DCtx`, which is also `ZSTD_DStream`.
pub struct DCtx {
    state: DState,
    /// `ddictLocal`
    ddict: Option<Box<DDict<'static>>>,
}

impl Default for DCtx {
    fn default() -> Self {
        Self::new()
    }
}

impl DCtx {
    /// How much memory a new one takes.
    pub const SIZE: usize = size_of::<Self>() + size_of::<EntropyDTables>();

    /// `ZSTD_createDCtx`
    pub fn new() -> Self {
        Self {
            state: DState {
                block: BlockDecoder::new(),
                prefix_start: 0,
                previous_dst_end: None,
                ext: ExtKind::Dict,
                dict_end_address: 0,
                expected: 0,
                f_params: FrameHeader::EMPTY,
                decoded_size: 0,
                b_type: BlockType::Reserved,
                stage: DStage::GetFrameHeaderSize,
                xxh_state: Xxh64::new(),
                validate_checksum: false,
                rle_size: 0,
                dict_id: 0,
                stream_stage: DStreamStage::Init,
                in_buff: Buffer::new(),
                in_pos: 0,
                max_window_size: ZSTD_MAXWINDOWSIZE_DEFAULT,
                out_buff: Buffer::new(),
                out_start: 0,
                out_end: 0,
                hostage_byte: false,
                no_forward_progress: 0,
                header_buffer: [0; ZSTD_FRAMEHEADERSIZE_MAX],
                oversized_duration: 0,
            },
            ddict: None,
        }
    }

    /// `ZSTD_decompressDCtx`: decompresses all the frames of `src`, which has to end with one, to the start of `dst`.
    /// Returns how many bytes that is.
    pub fn decompress(&mut self, dst: &mut [u8], src: &[u8]) -> Result<usize> {
        self.state
            .decompress_multi_frame(dst, 0, src, self.ddict.as_deref())
    }

    /// `ZSTD_decompress_usingDDict`
    pub fn decompress_using_ddict(
        &mut self,
        dst: &mut [u8],
        src: &[u8],
        ddict: &DDict<'_>,
    ) -> Result<usize> {
        self.state.decompress_multi_frame(dst, 0, src, Some(ddict))
    }

    /// `ZSTD_DCtx_loadDictionary`: `dict` is copied, and used for every frame from now on. None if it is empty.
    pub fn load_dictionary(&mut self, dict: &[u8]) -> Result<()> {
        if self.state.stream_stage != DStreamStage::Init {
            return Err(ErrorCode::StageWrong);
        }
        self.ddict = None;
        if !dict.is_empty() {
            // The C function has nothing else to report a dictionary that it cannot make sense of as.
            let ddict = DDict::new(Cow::Owned(try_copy(dict)?), DictContentType::Auto)
                .map_err(|_| ErrorCode::MemoryAllocation)?;
            self.ddict = Some(Box::new(ddict));
        }
        Ok(())
    }

    /// `ZSTD_DCtx_setParameter`
    pub fn set_parameter(&mut self, param: i32, mut value: i32) -> Result<()> {
        if self.state.stream_stage != DStreamStage::Init {
            return Err(ErrorCode::StageWrong);
        }
        if param != ZSTD_D_WINDOW_LOG_MAX {
            return Err(ErrorCode::ParameterUnsupported);
        }
        if value == 0 {
            value = ZSTD_WINDOWLOG_LIMIT_DEFAULT as i32;
        }
        if value < ZSTD_WINDOWLOG_ABSOLUTEMIN as i32 || value > ZSTD_WINDOWLOG_MAX as i32 {
            return Err(ErrorCode::ParameterOutOfBound);
        }
        self.state.max_window_size = 1usize << value;
        Ok(())
    }

    /// `ZSTD_initDStream`: forgets the frame in progress and the dictionary.
    pub fn init_stream(&mut self) {
        self.state.stream_stage = DStreamStage::Init;
        self.state.no_forward_progress = 0;
        self.ddict = None;
    }

    /// `ZSTD_decompressStream`: reads from `input` and writes to `output` as much as it can, and moves their positions.
    /// Returns 0 when a frame is complete and all of it is written, else a hint of how much input to give next.
    pub fn decompress_stream(
        &mut self,
        output: &mut OutBuffer<'_>,
        input: &mut InBuffer<'_>,
    ) -> Result<usize> {
        self.state
            .decompress_stream(output, input, self.ddict.as_deref())
    }
}

/// `ZSTD_decompress`
pub(crate) fn decompress(dst: &mut [u8], src: &[u8]) -> Result<usize> {
    DCtx::new().decompress(dst, src)
}

/// `ZSTD_copyRawBlock`
fn copy_raw_block(dst: &mut [u8], src: &[u8]) -> Result<usize> {
    let Some(dst) = dst.get_mut(..src.len()) else {
        return Err(ErrorCode::DstSizeTooSmall);
    };
    dst.copy_from_slice(src);
    Ok(src.len())
}

/// `ZSTD_setRleBlock`
fn set_rle_block(dst: &mut [u8], byte: u8, regen_size: usize) -> Result<usize> {
    let Some(dst) = dst.get_mut(..regen_size) else {
        return Err(ErrorCode::DstSizeTooSmall);
    };
    dst.fill(byte);
    Ok(regen_size)
}

/// `ZSTD_decodingBufferSize_internal`
fn decoding_buffer_size(window_size: u64, frame_content_size: u64, block_size_max: usize) -> usize {
    let block_size = (window_size.min(ZSTD_BLOCKSIZE_MAX as u64) as usize).min(block_size_max);
    let needed_rb_size = window_size + (block_size * 2) as u64 + (WILDCOPY_OVERLENGTH * 2) as u64;
    frame_content_size.min(needed_rb_size) as usize
}

impl DState {
    /// `ZSTD_decompressBegin_usingDDict`
    fn begin_using_ddict(&mut self, ddict: Option<&DDict<'_>>) {
        if let Some(ddict) = ddict {
            self.block.ddict_is_cold = self.dict_end_address != ddict.end_address();
        }

        self.expected = FRAMEHEADERSIZE_PREFIX;
        self.stage = DStage::GetFrameHeaderSize;
        self.decoded_size = 0;
        self.previous_dst_end = None;
        self.prefix_start = 0;
        self.ext = ExtKind::Dict;
        self.dict_end_address = 0;
        self.block.lit_entropy = false;
        self.block.fse_entropy = false;
        self.dict_id = 0;
        self.b_type = BlockType::Reserved;
        self.block.rep = REP_START_VALUE;
        self.block.seq_sources = SeqTableSources::all(TableSource::Local);
        self.block.huf_source = TableSource::Local;

        // `ZSTD_copyDDictParameters`
        if let Some(ddict) = ddict {
            self.dict_id = ddict.dict_id;
            self.dict_end_address = ddict.end_address();
            self.block.rep = ddict.rep;
            if ddict.entropy.is_some() {
                self.block.lit_entropy = true;
                self.block.fse_entropy = true;
                self.block.seq_sources = SeqTableSources::all(TableSource::Dict);
                self.block.huf_source = TableSource::Dict;
            }
        }
    }

    /// `ZSTD_checkContinuity`: `dst` is where the output continues, with room for `dst_size` bytes.
    fn check_continuity(&mut self, dst: usize, dst_size: usize) {
        if self.previous_dst_end != Some(dst) && dst_size > 0 {
            if let Some(end) = self.previous_dst_end {
                self.ext = ExtKind::Within {
                    end,
                    len: end - self.prefix_start,
                };
                self.dict_end_address = 1;
            }
            self.prefix_start = dst;
            self.previous_dst_end = Some(dst);
        }
    }

    /// `ZSTD_decodeFrameHeader`: `src` is all of a frame header.
    fn decode_frame_header(&mut self, src: &[u8]) -> Result<()> {
        if let HeaderStatus::Needs(_) = get_frame_header(&mut self.f_params, src)? {
            return Err(ErrorCode::SrcSizeWrong);
        }
        if self.f_params.dict_id != 0 && self.dict_id != self.f_params.dict_id {
            return Err(ErrorCode::DictionaryWrong);
        }
        self.validate_checksum = self.f_params.checksum_flag;
        if self.validate_checksum {
            self.xxh_state = Xxh64::new();
        }
        Ok(())
    }

    /// One compressed block, to `buf` from `start` on.
    fn decompress_block(
        &mut self,
        buf: OutputBuffer<'_>,
        start: usize,
        capacity: usize,
        src: &[u8],
        ddict: Option<&DDict<'_>>,
        streaming: Streaming,
    ) -> Result<usize> {
        let ext_dict = match self.ext {
            ExtKind::Dict => ExtDict::Dict(ddict.map_or(&[], |ddict| &*ddict.content)),
            ExtKind::Within { end, len } => ExtDict::Within { end, len },
        };
        self.block.decompress_block(
            BlockOutput {
                buf,
                prefix_start: self.prefix_start,
                start,
                capacity,
                ext_dict,
            },
            src,
            ddict.and_then(|ddict| ddict.entropy.as_deref()),
            self.f_params.block_size_max,
            streaming,
        )
    }

    /// `ZSTD_decompressFrame`: one frame, from the start of `src` to `dst` from `ostart` on.
    /// Returns how much was written, and how much was read.
    fn decompress_frame(
        &mut self,
        dst: &mut [u8],
        ostart: usize,
        src: &[u8],
        ddict: Option<&DDict<'_>>,
    ) -> Result<(usize, usize)> {
        let mut ip = 0usize;
        let mut op = ostart;

        if src.len() < FRAMEHEADERSIZE_MIN + ZSTD_BLOCKHEADERSIZE {
            return Err(ErrorCode::SrcSizeWrong);
        }
        {
            let frame_header_size = frame_header_size(src.sub(..FRAMEHEADERSIZE_PREFIX)?)?;
            if src.len() < frame_header_size + ZSTD_BLOCKHEADERSIZE {
                return Err(ErrorCode::SrcSizeWrong);
            }
            self.decode_frame_header(src.sub(..frame_header_size)?)?;
            ip += frame_header_size;
        }

        loop {
            let (c_block_size, properties) = get_c_block_size(src.sub(ip..)?)?;
            ip += ZSTD_BLOCKHEADERSIZE;
            if c_block_size > src.len() - ip {
                return Err(ErrorCode::SrcSizeWrong);
            }
            let block = src.span(ip, c_block_size)?;

            let decoded_size = match properties.block_type {
                BlockType::Compressed => {
                    let capacity = dst.len() - op;
                    self.decompress_block(
                        OutputBuffer::Whole(dst),
                        op,
                        capacity,
                        block,
                        ddict,
                        Streaming::No,
                    )?
                }
                BlockType::Raw => copy_raw_block(dst.sub_mut(op..)?, block)?,
                BlockType::Rle => set_rle_block(
                    dst.sub_mut(op..)?,
                    block.at(0)?,
                    properties.orig_size as usize,
                )?,
                BlockType::Reserved => return Err(ErrorCode::CorruptionDetected),
            };
            if self.validate_checksum {
                self.xxh_state.update(dst.span(op, decoded_size)?);
            }
            op += decoded_size;
            ip += c_block_size;
            if properties.last_block {
                break;
            }
        }

        if self.f_params.frame_content_size != ZSTD_CONTENTSIZE_UNKNOWN
            && (op - ostart) as u64 != self.f_params.frame_content_size
        {
            return Err(ErrorCode::CorruptionDetected);
        }
        if self.f_params.checksum_flag {
            if src.len() - ip < 4 {
                return Err(ErrorCode::ChecksumWrong);
            }
            if read_le32(src, ip)? != self.xxh_state.digest() as u32 {
                return Err(ErrorCode::ChecksumWrong);
            }
            ip += 4;
        }
        Ok((op - ostart, ip))
    }

    /// `ZSTD_decompressMultiFrame`: all the frames of `src`, to `dst` from `dst_start` on.
    fn decompress_multi_frame(
        &mut self,
        dst: &mut [u8],
        dst_start: usize,
        mut src: &[u8],
        ddict: Option<&DDict<'_>>,
    ) -> Result<usize> {
        let mut op = dst_start;
        let mut more_than_1_frame = false;

        while src.len() >= FRAMEHEADERSIZE_PREFIX {
            if is_skippable_magic(read_le32(src, 0)?) {
                src = src.sub(read_skippable_frame_size(src)?..)?;
                continue;
            }

            self.begin_using_ddict(ddict);
            self.check_continuity(op, dst.len() - op);

            match self.decompress_frame(dst, op, src, ddict) {
                // More likely `src` is longer than its frames than damaged where a magic number is expected.
                Err(ErrorCode::PrefixUnknown) if more_than_1_frame => {
                    return Err(ErrorCode::SrcSizeWrong);
                }
                Err(err) => return Err(err),
                Ok((written, read)) => {
                    op += written;
                    src = src.sub(read..)?;
                }
            }
            more_than_1_frame = true;
        }

        if !src.is_empty() {
            return Err(ErrorCode::SrcSizeWrong);
        }
        Ok(op - dst_start)
    }

    /// `ZSTD_nextSrcSizeToDecompressWithInputSize`
    fn next_src_size_to_decompress_with_input_size(&self, input_size: usize) -> usize {
        if !matches!(
            self.stage,
            DStage::DecompressBlock | DStage::DecompressLastBlock
        ) {
            return self.expected;
        }
        if self.b_type != BlockType::Raw {
            return self.expected;
        }
        input_size.min(self.expected).max(1)
    }

    /// `ZSTD_decompressContinue`, for the stages that `ZSTD_decompressStream` leaves to it. The output goes to
    /// `out_buff` from `out_start` on, where there is room for `dst_capacity` bytes.
    fn decompress_continue(
        &mut self,
        dst_capacity: usize,
        src: &[u8],
        ddict: Option<&DDict<'_>>,
    ) -> Result<usize> {
        if src.len() != self.next_src_size_to_decompress_with_input_size(src.len()) {
            return Err(ErrorCode::SrcSizeWrong);
        }
        let dst = self.out_start;
        self.check_continuity(dst, dst_capacity);

        match self.stage {
            DStage::DecodeBlockHeader => {
                let (c_block_size, bp) = get_c_block_size(src)?;
                if c_block_size > self.f_params.block_size_max {
                    return Err(ErrorCode::CorruptionDetected);
                }
                self.expected = c_block_size;
                self.b_type = bp.block_type;
                self.rle_size = bp.orig_size as usize;
                if c_block_size != 0 {
                    self.stage = if bp.last_block {
                        DStage::DecompressLastBlock
                    } else {
                        DStage::DecompressBlock
                    };
                    return Ok(0);
                }
                // An empty block.
                if bp.last_block {
                    self.end_of_blocks();
                } else {
                    self.expected = ZSTD_BLOCKHEADERSIZE;
                    self.stage = DStage::DecodeBlockHeader;
                }
                Ok(0)
            }

            DStage::DecompressLastBlock | DStage::DecompressBlock => {
                let mut out_buff = core::mem::take(&mut self.out_buff);
                let r_size = match self.b_type {
                    BlockType::Compressed => {
                        self.expected = 0;
                        self.decompress_block(
                            OutputBuffer::Used(&mut out_buff.bytes),
                            dst,
                            dst_capacity,
                            src,
                            ddict,
                            Streaming::Yes,
                        )
                    }
                    BlockType::Raw => out_buff
                        .span_mut(dst, dst_capacity.min(src.len()))
                        .and_then(|dst| copy_raw_block(dst, src))
                        .inspect(|&r_size| self.expected -= r_size),
                    BlockType::Rle => {
                        self.expected = 0;
                        out_buff
                            .span_mut(dst, dst_capacity.min(self.rle_size))
                            .and_then(|dst| set_rle_block(dst, src.at(0)?, self.rle_size))
                    }
                    BlockType::Reserved => Err(ErrorCode::CorruptionDetected),
                };
                self.out_buff = out_buff;
                let r_size = r_size?;
                if r_size > self.f_params.block_size_max {
                    return Err(ErrorCode::CorruptionDetected);
                }
                self.decoded_size += r_size as u64;
                if self.validate_checksum {
                    self.xxh_state
                        .update(self.out_buff.bytes.span(dst, r_size)?);
                }
                self.previous_dst_end = Some(dst + r_size);

                // Stay on the same stage until all of a raw block is in.
                if self.expected > 0 {
                    return Ok(r_size);
                }

                if self.stage == DStage::DecompressLastBlock {
                    if self.f_params.frame_content_size != ZSTD_CONTENTSIZE_UNKNOWN
                        && self.decoded_size != self.f_params.frame_content_size
                    {
                        return Err(ErrorCode::CorruptionDetected);
                    }
                    self.end_of_blocks();
                } else {
                    self.stage = DStage::DecodeBlockHeader;
                    self.expected = ZSTD_BLOCKHEADERSIZE;
                }
                Ok(r_size)
            }

            DStage::CheckChecksum => {
                if self.validate_checksum && read_le32(src, 0)? != self.xxh_state.digest() as u32 {
                    return Err(ErrorCode::ChecksumWrong);
                }
                self.expected = 0;
                self.stage = DStage::GetFrameHeaderSize;
                Ok(0)
            }

            DStage::SkipFrame => {
                self.expected = 0;
                self.stage = DStage::GetFrameHeaderSize;
                Ok(0)
            }

            // `ZSTD_decompressStream` reads frame headers itself, and is done when it gets back here.
            DStage::GetFrameHeaderSize => Err(ErrorCode::Generic),
        }
    }

    /// After the last block comes the checksum, if there is one.
    fn end_of_blocks(&mut self) {
        if self.f_params.checksum_flag {
            self.expected = 4;
            self.stage = DStage::CheckChecksum;
        } else {
            self.expected = 0;
            self.stage = DStage::GetFrameHeaderSize;
        }
    }

    /// `ZSTD_decompressContinueStream`
    fn decompress_continue_stream(&mut self, src: &[u8], ddict: Option<&DDict<'_>>) -> Result<()> {
        let is_skip_frame = self.stage == DStage::SkipFrame;
        let dst_size = if is_skip_frame {
            0
        } else {
            self.out_buff.size - self.out_start
        };
        let decoded_size = self.decompress_continue(dst_size, src, ddict)?;
        if decoded_size == 0 && !is_skip_frame {
            self.stream_stage = DStreamStage::Read;
        } else {
            self.out_end = self.out_start + decoded_size;
            self.stream_stage = DStreamStage::Flush;
        }
        Ok(())
    }

    /// Buffers for the frame whose header is `f_params`. Those that are there stay, unless they are too small, or have
    /// been much too large for many frames.
    fn resize_buffers(&mut self) -> Result<()> {
        let needed_in_buff_size = self.f_params.block_size_max.max(4);
        let needed_out_buff_size = decoding_buffer_size(
            self.f_params.window_size,
            self.f_params.frame_content_size,
            self.f_params.block_size_max,
        );

        // `ZSTD_DCtx_updateOversizedDuration`
        if self.in_buff.size + self.out_buff.size
            >= (needed_in_buff_size + needed_out_buff_size) * ZSTD_WORKSPACETOOLARGE_FACTOR
        {
            self.oversized_duration += 1;
        } else {
            self.oversized_duration = 0;
        }

        let too_small =
            self.in_buff.size < needed_in_buff_size || self.out_buff.size < needed_out_buff_size;
        let too_large = self.oversized_duration >= ZSTD_WORKSPACETOOLARGE_MAXDURATION;
        if too_small || too_large {
            self.in_buff = Buffer::new();
            self.out_buff = Buffer::new();
            self.in_buff = Buffer::with_size(needed_in_buff_size)?;
            self.out_buff = Buffer::with_size(needed_out_buff_size)?;
        }
        Ok(())
    }

    /// `ZSTD_decompressStream`
    fn decompress_stream(
        &mut self,
        output: &mut OutBuffer<'_>,
        input: &mut InBuffer<'_>,
        ddict: Option<&DDict<'_>>,
    ) -> Result<usize> {
        if input.pos > input.src.len() {
            return Err(ErrorCode::SrcSizeWrong);
        }
        if output.pos > output.dst.len() {
            return Err(ErrorCode::DstSizeTooSmall);
        }
        let src = input.src;
        let istart = input.pos;
        let iend = src.len();
        let mut ip = istart;
        let ostart = output.pos;
        let oend = output.dst.len();
        let mut op = ostart;

        'work: loop {
            if self.stream_stage == DStreamStage::Init {
                self.stream_stage = DStreamStage::LoadHeader { lh_size: 0 };
                self.in_pos = 0;
                self.out_start = 0;
                self.out_end = 0;
                self.hostage_byte = false;
            }

            if let DStreamStage::LoadHeader { lh_size } = self.stream_stage {
                match get_frame_header(&mut self.f_params, self.header_buffer.sub(..lh_size)?)? {
                    HeaderStatus::Complete => {}
                    HeaderStatus::Needs(h_size) => {
                        let to_load = h_size - lh_size;
                        let remaining_input = iend - ip;
                        if to_load > remaining_input {
                            self.header_buffer.write_at(lh_size, src.sub(ip..)?)?;
                            let lh_size = lh_size + remaining_input;
                            self.stream_stage = DStreamStage::LoadHeader { lh_size };
                            input.pos = iend;
                            // Refuse what cannot become a frame header.
                            get_frame_header(
                                &mut self.f_params,
                                self.header_buffer.sub(..lh_size)?,
                            )?;
                            return Ok(
                                FRAMEHEADERSIZE_MIN.max(h_size) - lh_size + ZSTD_BLOCKHEADERSIZE
                            );
                        }
                        self.header_buffer
                            .write_at(lh_size, src.span(ip, to_load)?)?;
                        self.stream_stage = DStreamStage::LoadHeader { lh_size: h_size };
                        ip += to_load;
                        continue 'work;
                    }
                }

                // A frame that is all there, with room for all of its output, needs no buffer.
                if self.f_params.frame_content_size != ZSTD_CONTENTSIZE_UNKNOWN
                    && self.f_params.frame_type != FrameType::Skippable
                    && (oend - op) as u64 >= self.f_params.frame_content_size
                {
                    if let Ok(c_size) = find_frame_compressed_size(src.sub(istart..)?) {
                        let decompressed_size = self.decompress_multi_frame(
                            output.dst,
                            op,
                            src.span(istart, c_size)?,
                            ddict,
                        )?;
                        ip = istart + c_size;
                        op += decompressed_size;
                        self.expected = 0;
                        self.stream_stage = DStreamStage::Init;
                        break 'work;
                    }
                }

                self.begin_using_ddict(ddict);

                if is_skippable_magic(read_le32(&self.header_buffer, 0)?) {
                    self.expected = read_le32(&self.header_buffer, ZSTD_FRAMEIDSIZE)? as usize;
                    self.stage = DStage::SkipFrame;
                } else {
                    let header_buffer = self.header_buffer;
                    self.decode_frame_header(header_buffer.sub(..lh_size)?)?;
                    self.expected = ZSTD_BLOCKHEADERSIZE;
                    self.stage = DStage::DecodeBlockHeader;
                }

                self.f_params.window_size = self
                    .f_params
                    .window_size
                    .max(1 << ZSTD_WINDOWLOG_ABSOLUTEMIN);
                if self.f_params.window_size > self.max_window_size as u64 {
                    return Err(ErrorCode::FrameParameterWindowTooLarge);
                }

                self.resize_buffers()?;
                self.stream_stage = DStreamStage::Read;
            }

            if self.stream_stage == DStreamStage::Read {
                let needed_in_size = self.next_src_size_to_decompress_with_input_size(iend - ip);
                if needed_in_size == 0 {
                    // The end of the frame.
                    self.stream_stage = DStreamStage::Init;
                    break 'work;
                }
                if iend - ip >= needed_in_size {
                    // Decode straight from the input.
                    self.decompress_continue_stream(src.span(ip, needed_in_size)?, ddict)?;
                    ip += needed_in_size;
                    continue 'work;
                }
                if ip == iend {
                    break 'work;
                }
                self.stream_stage = DStreamStage::Load;
            }

            if self.stream_stage == DStreamStage::Load {
                let needed_in_size = self.expected;
                let to_load = needed_in_size - self.in_pos;
                let loaded_size = to_load.min(iend - ip);
                if self.stage != DStage::SkipFrame {
                    if to_load > self.in_buff.size - self.in_pos {
                        return Err(ErrorCode::CorruptionDetected);
                    }
                    self.in_buff.bytes.truncate(self.in_pos);
                    self.in_buff
                        .bytes
                        .extend_from_slice(src.span(ip, loaded_size)?);
                }
                ip += loaded_size;
                self.in_pos += loaded_size;
                if loaded_size < to_load {
                    break 'work;
                }

                self.in_pos = 0;
                let in_buff = core::mem::take(&mut self.in_buff.bytes);
                // Nothing of a skippable frame is read, or kept.
                let loaded = in_buff.get(..needed_in_size).unwrap_or_default();
                let result = if self.stage == DStage::SkipFrame {
                    self.skip_frame_loaded()
                } else {
                    self.decompress_continue_stream(loaded, ddict)
                };
                self.in_buff.bytes = in_buff;
                result?;
                continue 'work;
            }

            // `zdss_flush`
            let to_flush_size = self.out_end - self.out_start;
            let flushed_size = to_flush_size.min(oend - op);
            output
                .dst
                .write_at(op, self.out_buff.bytes.span(self.out_start, flushed_size)?)?;
            op += flushed_size;
            self.out_start += flushed_size;
            if flushed_size == to_flush_size {
                self.stream_stage = DStreamStage::Read;
                if (self.out_buff.size as u64) < self.f_params.frame_content_size
                    && self.out_start + self.f_params.block_size_max > self.out_buff.size
                {
                    self.out_start = 0;
                    self.out_end = 0;
                }
                continue 'work;
            }
            // The output is full.
            break 'work;
        }

        input.pos = ip;
        output.pos = op;

        if ip == istart && op == ostart {
            self.no_forward_progress += 1;
            if self.no_forward_progress >= ZSTD_NO_FORWARD_PROGRESS_MAX {
                if op == oend {
                    return Err(ErrorCode::NoForwardProgressDestFull);
                }
                if ip == iend {
                    return Err(ErrorCode::NoForwardProgressInputEmpty);
                }
            }
        } else {
            self.no_forward_progress = 0;
        }

        let mut next_src_size_hint = self.expected;
        if next_src_size_hint == 0 {
            // The frame is decoded.
            if self.out_end == self.out_start {
                // And flushed.
                if self.hostage_byte {
                    if input.pos >= input.src.len() {
                        // The caller has to present the byte again for it to be released.
                        self.stream_stage = DStreamStage::Read;
                        return Ok(1);
                    }
                    input.pos += 1;
                }
                return Ok(0);
            }
            if !self.hostage_byte {
                // So that the caller comes back to flush, even one that stops when its input is consumed.
                input.pos = input.pos.wrapping_sub(1);
                self.hostage_byte = true;
            }
            return Ok(1);
        }
        if self.stage == DStage::DecompressBlock {
            // The header of the next block too.
            next_src_size_hint += ZSTD_BLOCKHEADERSIZE;
        }
        next_src_size_hint -= self.in_pos;
        Ok(next_src_size_hint)
    }

    /// `ZSTD_decompressContinueStream` for the content of a skippable frame that came in several pieces.
    fn skip_frame_loaded(&mut self) -> Result<()> {
        self.expected = 0;
        self.stage = DStage::GetFrameHeaderSize;
        self.out_end = self.out_start;
        self.stream_stage = DStreamStage::Flush;
        Ok(())
    }
}
