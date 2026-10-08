//! Lines in one buffer, with `\n` between them.

use super::text::{trim_start, trim_start_matches};
use bun_core::strings;

#[derive(Default)]
pub(super) struct LineBuffer {
    buf: Vec<u8>,
    /// At least one line has been pushed.
    has_content: bool,
}

impl LineBuffer {
    pub(super) fn new() -> Self {
        Self::default()
    }

    /// Pushes a line, or several if there are line breaks in it.
    pub(super) fn push(&mut self, line: impl AsRef<[u8]>) {
        self.begin_line().extend_from_slice(line.as_ref());
    }

    pub(super) fn push_empty(&mut self) {
        self.push(b"");
    }

    /// Starts a line. Returns the buffer to write it to.
    pub(super) fn begin_line(&mut self) -> &mut Vec<u8> {
        if self.has_content {
            self.buf.push(b'\n');
        }
        self.has_content = true;
        &mut self.buf
    }

    pub(super) fn last_is_empty(&self) -> bool {
        self.has_content && (self.buf.is_empty() || self.buf.ends_with(b"\n"))
    }

    pub(super) fn is_empty(&self) -> bool {
        !self.has_content
    }

    pub(super) fn byte_len(&self) -> usize {
        self.buf.len()
    }

    /// The number of line breaks behind the first `from_byte` bytes.
    pub(super) fn line_count_since(&self, from_byte: usize) -> usize {
        strings::count_char(self.buf.get(from_byte..).unwrap_or_default(), b'\n')
    }

    /// Whether the last line that is not empty ends an item of a list or a block of code.
    pub(super) fn last_line_is_block_end(&self) -> bool {
        let mut rest = &self.buf[..];
        let last = loop {
            let (before, line) = match strings::last_index_of_char(rest, b'\n') {
                Some(at) => (Some(&rest[..at]), &rest[at + 1..]),
                None => (None, rest),
            };
            match before {
                Some(before) if line.is_empty() => rest = before,
                _ => break line,
            }
        };
        let trimmed = trim_start(last);
        if [&b"- "[..], b"+ ", b"* ", b"```"].iter().any(|marker| trimmed.starts_with(marker)) {
            return true;
        }
        if trimmed.first().is_some_and(u8::is_ascii_digit) && trim_start_matches(trimmed, |c| c.is_ascii_digit()).starts_with(b". ") {
            return true;
        }
        last.starts_with(b"    ")
    }

    pub(super) fn into_bytes(self) -> Vec<u8> {
        self.buf
    }
}
