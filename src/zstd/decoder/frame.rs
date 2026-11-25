//! Frame and block headers.

use crate::bits::load_from;
use crate::bounded::Bounded;
use crate::dictionary::Dictionary;
use crate::error::{Error, Result};
use crate::format::{
    BLOCK_HEADER_LEN, BLOCK_LEN_MAX, BlockType, CHECKSUM_LEN, FRAME_MAGIC, SKIPPABLE_MAGIC,
    WINDOW_LOG_MAX, WINDOW_LOG_MIN,
};

const MAGIC_LEN: usize = 4;
/// The magic number and the descriptor, which tells the length of the rest.
const HEADER_PREFIX_LEN: usize = MAGIC_LEN + 1;
const SKIPPABLE_HEADER_LEN: usize = MAGIC_LEN + 4;
/// `ZSTD_CONTENTSIZE_UNKNOWN` and `ZSTD_CONTENTSIZE_ERROR`
const UNKNOWN_SIZE: u64 = u64::MAX;
const INVALID_SIZE: u64 = u64::MAX - 1;

#[derive(Clone, Copy)]
pub(crate) struct FrameHeader {
    pub(crate) len: usize,
    pub(crate) content_size: Option<u64>,
    pub(crate) window_size: u64,
    /// 0 if there is none.
    dictionary_id: u32,
    pub(crate) has_checksum: bool,
}

pub(crate) enum Header {
    Frame(FrameHeader),
    Skippable {
        content_len: u32,
    },
    /// It takes at least this many bytes.
    Incomplete(usize),
}

fn is_skippable(magic: u32) -> bool {
    magic & !15 == SKIPPABLE_MAGIC
}

/// The lengths of the window descriptor, the dictionary ID and the content size.
fn field_lens(descriptor: u8) -> [usize; 3] {
    let is_single_segment = descriptor & 0x20 != 0;
    let content_size = match descriptor >> 6 {
        0 => is_single_segment.into(),
        flag => 1 << flag,
    };
    [
        (!is_single_segment).into(),
        1 << (descriptor & 3) >> 1,
        content_size,
    ]
}

#[inline(always)]
fn low_bytes(word: u64, count: u32) -> u64 {
    word & !u64::MAX.unbounded_shl(count.times(8))
}

fn header_len(descriptor: u8) -> usize {
    HEADER_PREFIX_LEN + field_lens(descriptor).into_iter().sum::<usize>()
}

/// Whether `src` is long enough for the header that it would start with if it were a frame, and that of a block.
pub(crate) fn can_hold_headers(src: &[u8]) -> bool {
    (src.get(MAGIC_LEN)).is_some_and(|&it| header_len(it) + BLOCK_HEADER_LEN <= src.len())
}

/// Whether `bytes` start with a magic number, or with as much of one as they hold. There has to be at least one.
pub fn may_start_frame(bytes: &[u8]) -> bool {
    let missing = u32::MAX.unbounded_shl(8 * bytes.len().min(MAGIC_LEN) as u32);
    let or = |magic: u32| load_from(bytes, 0) as u32 | magic & missing;
    !bytes.is_empty() && (or(FRAME_MAGIC) == FRAME_MAGIC || is_skippable(or(SKIPPABLE_MAGIC)))
}

impl Header {
    pub(crate) fn len(&self) -> usize {
        match *self {
            Self::Frame(FrameHeader { len, .. }) | Self::Incomplete(len) => len,
            Self::Skippable { .. } => SKIPPABLE_HEADER_LEN,
        }
    }

    pub(crate) fn read(src: &[u8]) -> Result<Self> {
        let Some((&[m0, m1, m2, m3, descriptor], fields)) = src.split_first_chunk() else {
            if !src.is_empty() && !may_start_frame(src) {
                return Err(Error::PrefixUnknown);
            }
            return Ok(Self::Incomplete(HEADER_PREFIX_LEN));
        };
        let magic = u32::from_le_bytes([m0, m1, m2, m3]);
        if is_skippable(magic) {
            return Ok(match fields {
                &[s1, s2, s3, ..] => Self::Skippable {
                    content_len: u32::from_le_bytes([descriptor, s1, s2, s3]),
                },
                _ => Self::Incomplete(SKIPPABLE_HEADER_LEN),
            });
        }
        if magic != FRAME_MAGIC {
            return Err(Error::PrefixUnknown);
        }
        let len = header_len(descriptor);
        if src.len() < len {
            return Ok(Self::Incomplete(len));
        }
        if descriptor & 0x08 != 0 {
            return Err(Error::FrameParameterUnsupported);
        }

        let [window_len, id_len, size_len] = field_lens(descriptor);
        let field = |start, len: usize| low_bytes(load_from(fields, start), len as u32);
        let content_size = match size_len {
            0 => None,
            2 => Some(field(window_len + id_len, size_len) + 256),
            _ => Some(field(window_len + id_len, size_len)),
        };
        let window_size = match content_size {
            Some(size) if window_len == 0 => size,
            _ => {
                let descriptor = field(0, window_len);
                let log = (descriptor >> 3) as u32 + WINDOW_LOG_MIN;
                if log > WINDOW_LOG_MAX {
                    return Err(Error::WindowTooLarge);
                }
                (8 + (descriptor & 7)) << (log - 3)
            }
        };
        Ok(Self::Frame(FrameHeader {
            len,
            content_size: content_size.filter(|&size| size != UNKNOWN_SIZE),
            window_size,
            dictionary_id: field(window_len, id_len) as u32,
            has_checksum: descriptor & 0x04 != 0,
        }))
    }
}

impl FrameHeader {
    pub(crate) fn check_dictionary(&self, dictionary: Option<&Dictionary<'_>>) -> Result<()> {
        if self.dictionary_id != 0 && self.dictionary_id != dictionary.map_or(0, Dictionary::id) {
            return Err(Error::DictionaryWrong);
        }
        Ok(())
    }

    /// The length of the frame that `prefix` starts with, and how many blocks there are as far as it goes.
    pub(crate) fn measure(&self, prefix: &[u8]) -> Result<(FrameLen, usize)> {
        let (mut len, mut blocks) = (self.len, 0);
        loop {
            let Some(block) = prefix.get(len..).and_then(<[u8]>::first_chunk) else {
                return Ok((FrameLen::AtLeast(len + BLOCK_HEADER_LEN), blocks));
            };
            let block = BlockHeader::new(*block)?;
            len += BLOCK_HEADER_LEN + block.content_len();
            blocks += 1;
            if block.is_last() {
                len += if self.has_checksum { CHECKSUM_LEN } else { 0 };
                return Ok((FrameLen::new(len, prefix), blocks));
            }
        }
    }

    /// `size` is that of the blocks so far.
    pub(crate) fn check_content_size(&self, size: u64, is_complete: bool) -> Result<()> {
        match self.content_size {
            Some(expected) if size > expected || (is_complete && size != expected) => {
                Err(Error::CorruptionDetected)
            }
            _ => Ok(()),
        }
    }

    /// For what a block holds, and for what it decodes to.
    pub(crate) fn block_len_max(&self) -> usize {
        self.window_size.min(BLOCK_LEN_MAX as u64) as usize
    }
}

#[derive(Clone, Copy)]
pub(crate) struct BlockHeader(u32);

impl BlockHeader {
    pub(crate) fn new([b0, b1, b2]: [u8; BLOCK_HEADER_LEN]) -> Result<Self> {
        let is_reserved = b0 >> 1 & 3 == 3;
        if is_reserved {
            return Err(Error::CorruptionDetected);
        }
        Ok(Self(u32::from_le_bytes([b0, b1, b2, 0])))
    }

    pub(crate) fn is_last(self) -> bool {
        self.0 & 1 != 0
    }

    pub(crate) fn block_type(self) -> BlockType {
        match self.0 >> 1 & 3 {
            0 => BlockType::Raw,
            1 => BlockType::Rle,
            _ => BlockType::Compressed,
        }
    }

    /// How many bytes follow the header.
    pub(crate) fn content_len(self) -> usize {
        match self.block_type() {
            BlockType::Rle => 1,
            _ => self.size(),
        }
    }

    /// For an RLE block, how often its byte is repeated.
    pub(crate) fn size(self) -> usize {
        self.0 as usize >> 3
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameLen {
    Complete(usize),
    /// More than there is. The frame may turn out to be longer still.
    AtLeast(usize),
}

impl FrameLen {
    fn new(len: usize, prefix: &[u8]) -> Self {
        if len <= prefix.len() {
            Self::Complete(len)
        } else {
            Self::AtLeast(len)
        }
    }
}

/// With the header.
pub(crate) fn skippable_len(content_len: u32) -> Result<usize> {
    let len = content_len.checked_add(SKIPPABLE_HEADER_LEN as u32);
    len.map(|len| len as usize)
        .ok_or(Error::FrameParameterUnsupported)
}

/// The length of the frame that `prefix` starts with.
pub fn frame_len(prefix: &[u8]) -> Result<FrameLen> {
    Ok(match Header::read(prefix)? {
        Header::Frame(header) => header.measure(prefix)?.0,
        Header::Skippable { content_len } => FrameLen::new(skippable_len(content_len)?, prefix),
        Header::Incomplete(len) => FrameLen::AtLeast(len),
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentSize {
    /// As headers have it.
    Known(u64),
    Unknown,
    Invalid,
}

impl ContentSize {
    fn new(size: u64) -> Self {
        match size {
            UNKNOWN_SIZE => Self::Unknown,
            INVALID_SIZE => Self::Invalid,
            _ => Self::Known(size),
        }
    }
}

/// Of the frame that `src` starts with. Only its header has to be there.
pub fn frame_content_size(src: &[u8]) -> ContentSize {
    match Header::read(src) {
        Ok(Header::Frame(header)) => ContentSize::new(header.content_size.unwrap_or(UNKNOWN_SIZE)),
        Ok(Header::Skippable { .. }) => ContentSize::Known(0),
        Ok(Header::Incomplete(_)) | Err(_) => ContentSize::Invalid,
    }
}

/// Of all the frames that `src` consists of.
pub fn decompressed_size(mut src: &[u8]) -> ContentSize {
    let mut total = 0u64;
    while !src.is_empty() {
        let size = match frame_content_size(src) {
            ContentSize::Known(size) => size,
            other => return other,
        };
        let (Some(sum), Ok(FrameLen::Complete(len))) = (total.checked_add(size), frame_len(src))
        else {
            return ContentSize::Invalid;
        };
        total = sum;
        src = src.get(len..).unwrap_or_default();
    }
    ContentSize::new(total)
}
