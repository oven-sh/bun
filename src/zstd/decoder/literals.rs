//! The literals section of a compressed block.

use crate::bits::load_from;
use crate::error::{Error, Result};
use crate::format::{Encoding, MIN_LITERALS_FOR_4_STREAMS};
use crate::huffman::HuffmanTable;

/// How many bytes behind its literals a quick copy may read.
pub(crate) const LITERALS_PADDING: usize = 32;

#[derive(Clone, Copy)]
pub(crate) struct LiteralsHeader {
    encoding: Encoding,
    has_4_streams: bool,
    header_len: usize,
    /// How many literals there are.
    pub(crate) count: usize,
    /// With the header.
    pub(crate) section_len: usize,
}

impl LiteralsHeader {
    /// `block` decodes to at most `block_len_max` bytes, and there is `room` for it.
    pub(crate) fn read(
        block: &[u8],
        has_table: bool,
        block_len_max: usize,
        room: usize,
    ) -> Result<Self> {
        let bits = load_from(block, 0);
        let encoding = Encoding::from_low_bits(bits as u8);
        let size_format = (bits >> 2 & 3) as usize;
        let is_coded = matches!(encoding, Encoding::Compressed | Encoding::Repeat);
        let (header_len, count, content_len) = if is_coded {
            let header_len = size_format.max(1) + 2;
            let size_bits = 4 * header_len - 2;
            let size = |index| (bits >> (4 + index * size_bits)) as usize & ((1 << size_bits) - 1);
            (header_len, size(0), size(1))
        } else {
            let (header_len, count) = match size_format {
                1 => (2, bits as usize >> 4 & 0xFFF),
                3 => (3, bits as usize >> 4 & 0xF_FFFF),
                _ => (1, bits as usize >> 3 & 0x1F),
            };
            (
                header_len,
                count,
                if encoding == Encoding::Rle { 1 } else { count },
            )
        };
        let has_4_streams = is_coded && size_format != 0;
        let section_len = header_len + content_len;

        let len_min = match encoding {
            Encoding::Basic => header_len.max(2),
            Encoding::Rle => section_len,
            _ => 5,
        };
        if encoding == Encoding::Repeat && !has_table && block.len() >= 2 {
            return Err(Error::DictionaryCorrupted);
        }
        if block.len() < len_min || count > block_len_max {
            return Err(Error::CorruptionDetected);
        }
        if has_4_streams && count < MIN_LITERALS_FOR_4_STREAMS {
            return Err(Error::LiteralsHeaderWrong);
        }
        if is_coded && section_len > block.len() {
            return Err(Error::CorruptionDetected);
        }
        if count > room {
            return Err(Error::DstSizeTooSmall);
        }
        if section_len > block.len() {
            return Err(Error::CorruptionDetected);
        }
        Ok(Self {
            encoding,
            has_4_streams,
            header_len,
            count,
            section_len,
        })
    }

    pub(crate) fn has_tree(&self) -> bool {
        self.encoding == Encoding::Compressed
    }

    /// Fills `table` if [`Self::has_tree`]. Returns where the streams start.
    pub(crate) fn read_tree(&self, block: &[u8], table: &mut HuffmanTable) -> Result<usize> {
        if !self.has_tree() {
            return Ok(self.header_len);
        }
        let content = block.get(self.header_len..self.section_len);
        Ok(self.header_len + table.read(content.ok_or(Error::Internal)?, self.count)?)
    }

    /// The literals and the padding, if they are in `block` as they are. Less padding will do if they are more than `few` with it.
    pub(crate) fn in_place<'a>(&self, block: &'a [u8], few: usize) -> Option<&'a [u8]> {
        let padded_end = self.section_len + LITERALS_PADDING;
        let is_usable = padded_end <= block.len() || self.count + LITERALS_PADDING > few;
        let literals = block.get(self.header_len..padded_end.min(block.len()));
        literals.filter(|_| is_usable && self.encoding == Encoding::Basic)
    }

    /// `room` is enough for `count`. `start` is from [`Self::read_tree`]. `next` may get prefetched meanwhile.
    pub(crate) fn decode(
        &self,
        block: &[u8],
        start: usize,
        table: &HuffmanTable,
        room: &mut [u8],
        next: *const u8,
    ) -> Result<()> {
        let section = block.get(..self.section_len).ok_or(Error::Internal)?;
        if self.has_4_streams {
            let lead = next.addr().wrapping_sub(room.as_ptr().addr());
            return table.decode_4_streams(section, start, room, self.count, lead);
        }
        let out = room.get_mut(..self.count).ok_or(Error::Internal)?;
        match self.encoding {
            Encoding::Basic => {
                let literals = section.get(start..).filter(|it| it.len() == out.len());
                out.copy_from_slice(literals.ok_or(Error::Internal)?);
            }
            Encoding::Rle => out.fill(*section.last().ok_or(Error::Internal)?),
            _ => table.decode_stream(section, start, out)?,
        }
        Ok(())
    }

    /// How many literals [`Self::decode`] is quicker for if it has [`AMPLE_ROOM`](crate::huffman::AMPLE_ROOM).
    pub(crate) fn count_for_ample_room(&self, table: &HuffmanTable) -> usize {
        if self.has_4_streams && table.has_pairs() {
            self.count
        } else {
            0
        }
    }
}
