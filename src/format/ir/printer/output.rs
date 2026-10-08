//! The text that the printer has written.

use crate::ir::element::Token;

/// Appends to a vector. The vector is longer than what has been written, so that a short text can
/// be copied as a block of a fixed size, with whatever is behind it.
pub(super) struct Out<'o> {
    buffer: &'o mut Vec<u8>,
    len: usize,
}

/// A text of up to so many bytes is copied as a block.
const BLOCK: usize = 16;

impl<'o> Out<'o> {
    pub(super) fn new(buffer: &'o mut Vec<u8>) -> Self {
        let len = buffer.len();
        buffer.resize(buffer.capacity(), 0);
        Out { buffer, len }
    }

    /// Leaves the vector with what has been written.
    pub(super) fn finish(&mut self) {
        self.buffer.truncate(self.len);
    }

    #[cold]
    #[inline(never)]
    fn grow(&mut self, additional: usize) {
        let len = (self.buffer.len() * 2).max(self.len + additional + 4096);
        self.buffer.resize(len, 0);
    }

    /// The next `len` bytes.
    #[inline]
    fn next(&mut self, len: usize) -> &mut [u8] {
        if self.buffer.len() - self.len < len {
            self.grow(len);
        }
        &mut self.buffer[self.len..self.len + len]
    }

    #[inline]
    pub(super) fn token(&mut self, token: &Token) {
        self.next(Token::MAX).copy_from_slice(token.padded());
        self.len += token.len();
    }

    #[inline]
    pub(super) fn byte(&mut self, byte: u8) {
        self.next(1)[0] = byte;
        self.len += 1;
    }

    /// Writes the part of `text` at `range`.
    #[inline]
    pub(super) fn part(&mut self, text: &[u8], range: std::ops::Range<usize>) {
        if range.len() <= BLOCK
            && let Some(block) = text.get(range.start..range.start + BLOCK)
        {
            self.next(BLOCK).copy_from_slice(block);
            self.len += range.len();
            return;
        }
        self.bytes(text.get(range).unwrap_or_default());
    }

    pub(super) fn bytes(&mut self, bytes: &[u8]) {
        self.next(bytes.len()).copy_from_slice(bytes);
        self.len += bytes.len();
    }

    pub(super) fn repeat(&mut self, byte: u8, count: usize) {
        self.next(count).fill(byte);
        self.len += count;
    }

    pub(super) fn trim_trailing_whitespace(&mut self) {
        while self.len > 0 && matches!(self.buffer[self.len - 1], b' ' | b'\t') {
            self.len -= 1;
        }
    }
}
