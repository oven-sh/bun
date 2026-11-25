//! The literals section of a compressed block.

use bun_highway::unzstd::{HuffmanTable, Tape};

use crate::bits::{bits_below_mark, load_from};
use crate::error::{Error, Result};
use crate::format::{Encoding, MIN_LITERALS_FOR_4_STREAMS};

/// How many bytes behind its literals a quick copy may read.
pub(crate) const LITERALS_PADDING: usize = 32;

#[derive(Clone, Copy)]
pub(crate) struct LiteralsHeader {
    pub(crate) encoding: Encoding,
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

    pub(crate) fn content<'a>(&self, block: &'a [u8]) -> Result<&'a [u8]> {
        (block.get(self.header_len..self.section_len)).ok_or(Error::Internal)
    }

    /// The literals and the padding, if they are in `block` as they are. Less padding will do if they are more than `few` with it.
    pub(crate) fn in_place<'a>(&self, block: &'a [u8], few: usize) -> Option<&'a [u8]> {
        let padded_end = self.section_len + LITERALS_PADDING;
        let is_usable = padded_end <= block.len() || self.count + LITERALS_PADDING > few;
        let literals = block.get(self.header_len..padded_end.min(block.len()));
        literals.filter(|_| is_usable && self.encoding == Encoding::Basic)
    }

    /// From the streams in `src[start..]`, to where there is room. What is `lead` bytes ahead gets prefetched.
    pub(crate) fn decode(
        &self,
        (src, start): (&[u8], usize),
        table: &HuffmanTable,
        out: (Tape<'_>, usize),
        lead: usize,
    ) -> Result<()> {
        let is_valid = if self.has_4_streams {
            let jumps = src.get(start..).and_then(<[u8]>::first_chunk::<6>);
            let &[a0, a1, b0, b1, c0, c1] = jumps.ok_or(Error::CorruptionDetected)?;
            let a = start + 6;
            let b = a + usize::from(u16::from_le_bytes([a0, a1]));
            let c = b + usize::from(u16::from_le_bytes([b0, b1]));
            let d = c + usize::from(u16::from_le_bytes([c0, c1]));
            let end = |start, end| {
                bits_below_mark(src.get(..end).ok_or(Error::CorruptionDetected)?, start)
            };
            let ends = [end(a, b)?, end(b, c)?, end(c, d)?, end(d, src.len())?];
            let bits = [[8 * a, 8 * b, 8 * c, 8 * d], ends];
            table.decode_streams(src, bits, out, self.count, lead)
        } else {
            let bits = [[8 * start], [bits_below_mark(src, start)?]];
            table.decode_streams(src, bits, out, self.count, lead)
        };
        is_valid.then_some(()).ok_or(Error::CorruptionDetected)
    }
}
