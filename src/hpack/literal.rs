//! String literals (RFC 7541 §5.2).

use crate::{Result, huffman, integer};

#[derive(Clone, Copy)]
pub struct Literal<'a> {
    pub bytes: &'a [u8],
    /// The input as far as the end of `bytes`.
    pub context: &'a [u8],
    pub is_huffman: bool,
}

impl<'a> Literal<'a> {
    /// The most that [`Self::decode`] needs.
    #[inline(always)]
    pub fn room(self) -> usize {
        if self.is_huffman {
            huffman::max_decoded_len(self.bytes.len()) + huffman::SLACK
        } else {
            0
        }
    }

    /// Takes what it fills off `room`.
    #[inline(always)]
    pub fn decode(self, room: &mut &'a mut [u8]) -> Result<&'a [u8]> {
        if !self.is_huffman {
            return Ok(self.bytes);
        }
        let len = huffman::decode(self.bytes, self.context, room)?;
        Ok(room.split_off_mut(..len).unwrap_or_default())
    }
}

pub fn write(text: &[u8], out: &mut Vec<u8>) {
    write_with_prefix(0x00, 7, text, out);
}

/// `pattern` is what goes above the prefix of the length and the bit that marks the Huffman code.
#[inline(always)]
pub fn write_with_prefix(pattern: u8, prefix_bits: u32, text: &[u8], out: &mut Vec<u8>) {
    const SHORT_ROOM: [u8; 64] = [0; _];
    let start = out.len();
    let text_start = start + integer::written_len(prefix_bits, text.len());
    let end = text_start + text.len() + huffman::SLACK;
    if end - start <= SHORT_ROOM.len() {
        out.extend_from_slice(&SHORT_ROOM);
    } else {
        out.resize(end, 0);
    }
    let room = out.get_mut(text_start..end).unwrap_or_default();
    if let Some(len @ 1..) = huffman::encode(text, room) {
        out.truncate(text_start + len);
        let mut at = start;
        #[expect(clippy::indexing_slicing, reason = "a smaller number is no longer")]
        integer::write(pattern | 1 << prefix_bits, prefix_bits, len, |byte| {
            out[at] = byte;
            at += 1;
        });
        if at < text_start {
            out.drain(at..text_start);
        }
    } else {
        out.truncate(start);
        integer::write(pattern, prefix_bits, text.len(), |byte| out.push(byte));
        out.extend_from_slice(text);
    }
}
