//! The printer's output buffer.

use crate::ir::element::Token;

/// Appends to a vector. The vector is kept longer than what's been written, so a short text can be copied as a
/// fixed-size block along with whatever bytes follow it.
pub(super) struct Out<'o> {
    buffer: &'o mut Vec<u8>,
    len: usize,
    /// The initial `len`.
    start: usize,
    /// See [`crate::is_too_long`]. Once set, further output overwrites earlier output.
    is_too_long: bool,
}

/// A text of up to this many bytes is copied as a block.
const BLOCK: usize = 16;

impl<'o> Out<'o> {
    /// `expected` is a rough estimate of how many bytes will be written.
    pub(super) fn new(buffer: &'o mut Vec<u8>, expected: usize) -> Self {
        let len = buffer.len();
        buffer.resize(len + expected, 0);
        Out {
            buffer,
            len,
            start: len,
            is_too_long: false,
        }
    }

    pub(super) fn is_too_long(&self) -> bool {
        self.is_too_long || crate::is_too_long(self.len)
    }

    #[inline]
    pub(super) fn len(&self) -> usize {
        self.len
    }

    /// Discards everything written from `len` on.
    pub(super) fn truncate(&mut self, len: usize) {
        self.len = self.len.min(len);
    }

    /// Returns what's been written from `from` on.
    pub(super) fn since(&self, from: usize) -> &[u8] {
        self.buffer.get(from..self.len).unwrap_or_default()
    }

    /// Truncates the vector to what's been written.
    pub(super) fn finish(&mut self) {
        self.buffer.truncate(self.len);
    }

    #[cold]
    #[inline(never)]
    fn grow(&mut self, additional: usize) {
        if crate::is_too_long(self.len + additional) {
            (self.is_too_long, self.len) = (true, self.start);
            if self.buffer.len() - self.len >= additional {
                return;
            }
        }
        let len = (self.buffer.len() * 2).max(self.len + additional + 4096);
        self.buffer.resize(len, 0);
    }

    /// Returns the next `len` bytes, growing the vector if needed.
    #[inline]
    fn next(&mut self, len: usize) -> &mut [u8] {
        if self.buffer.len() - self.len < len {
            self.grow(len);
        }
        &mut self.buffer[self.len..self.len + len]
    }

    /// Writes the first `len` bytes of `block`. The rest of `block` clobbers the unused bytes after them.
    #[inline(always)]
    fn block<const N: usize>(&mut self, block: &[u8; N], len: usize) {
        loop {
            if let Some(next) = self
                .buffer
                .get_mut(self.len..)
                .and_then(|rest| rest.first_chunk_mut())
            {
                *next = *block;
                self.len += len;
                return;
            }
            self.grow(N);
        }
    }

    #[inline(always)]
    pub(super) fn token(&mut self, token: &Token) {
        self.block(token.padded(), token.len());
    }

    #[inline(always)]
    pub(super) fn byte(&mut self, byte: u8) {
        self.block(&[byte], 1);
    }

    /// Writes `text[range]`.
    #[inline(always)]
    pub(super) fn part(&mut self, text: &[u8], range: std::ops::Range<usize>) {
        if range.len() <= BLOCK
            && let Some(block) = text
                .get(range.start..)
                .and_then(|rest| rest.first_chunk::<BLOCK>())
        {
            return self.block(block, range.len());
        }
        self.long_part(text, range);
    }

    #[inline(never)]
    fn long_part(&mut self, text: &[u8], range: std::ops::Range<usize>) {
        const LONG: usize = 4 * BLOCK;
        if range.len() <= LONG
            && let Some(block) = text
                .get(range.start..)
                .and_then(|rest| rest.first_chunk::<LONG>())
        {
            return self.block(block, range.len());
        }
        self.bytes(text.get(range).unwrap_or_default());
    }

    pub(super) fn bytes(&mut self, bytes: &[u8]) {
        self.next(bytes.len()).copy_from_slice(bytes);
        self.len += bytes.len();
    }

    pub(super) fn repeat(&mut self, byte: u8, count: usize) {
        if count <= 2 * BLOCK {
            return self.block(&[byte; 2 * BLOCK], count);
        }
        // Indentation is what makes the output too long. Skipping it lets the rest of the document finish printing
        // quickly.
        if self.is_too_long || crate::is_too_long(self.len + count) {
            self.is_too_long = true;
            return;
        }
        self.next(count).fill(byte);
        self.len += count;
    }

    pub(super) fn trim_trailing_whitespace(&mut self) {
        while self.len > 0 && matches!(self.buffer[self.len - 1], b' ' | b'\t') {
            self.len -= 1;
        }
    }
}
