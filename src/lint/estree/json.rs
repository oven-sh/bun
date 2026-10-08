//! ESTree as JSON.

use super::{NodeType, Sink};
use crate::ast::File;
use crate::span::Span;
use std::io::Write as _;

/// Writes the ESTree of `file` to `out`. Each node has `type` and `range`, in UTF-16 code units
/// like `String.prototype.slice` counts. Returns `false`, and leaves `out` as it was, if the syntax
/// is nested too deeply.
pub fn write_json<'a>(file: &'a File<'a>, out: &mut Vec<u8>) -> bool {
    let start = out.len();
    let mut sink = JsonSink::new(file.text(), out);
    let is_complete = super::convert(file, &mut sink);
    if !is_complete {
        out.truncate(start);
    }
    is_complete
}

/// Converts offsets in UTF-8 text to offsets in the same text as UTF-16.
struct Utf16Offsets {
    /// For each character that takes a different number of units in the two encodings: the offset
    /// after it in bytes, and by how much the offsets differ from there on. Empty for ASCII.
    shifts: Vec<(u32, u32)>,
}

impl Utf16Offsets {
    fn new(text: &[u8]) -> Utf16Offsets {
        let mut shifts = Vec::new();
        let Some(first) = bun_core::strings::first_non_ascii(text) else {
            return Utf16Offsets { shifts };
        };
        let (mut at, mut shift) = (first as usize, 0u32);
        while let Some(&byte) = text.get(at) {
            let (bytes, units) = match byte {
                0..0x80 => {
                    let rest = &text[at..];
                    at += bun_core::strings::first_non_ascii(rest).map_or(rest.len(), |it| it as usize);
                    continue;
                }
                0xF0.. => (4, 2),
                0xE0.. => (3, 1),
                0xC0.. => (2, 1),
                // A stray continuation byte.
                _ => (1, 1),
            };
            at += bytes;
            if bytes != units {
                shift += (bytes - units) as u32;
                shifts.push((at as u32, shift));
            }
        }
        Utf16Offsets { shifts }
    }

    #[inline]
    fn of(&self, offset: u32) -> u32 {
        if self.shifts.is_empty() {
            return offset;
        }
        match self.shifts.partition_point(|it| it.0 <= offset) {
            0 => offset,
            after => offset - self.shifts[after - 1].1,
        }
    }
}

pub struct JsonSink<'o> {
    out: &'o mut Vec<u8>,
    /// The length of `out` before anything was written.
    start: usize,
    offsets: Utf16Offsets,
}

impl<'o> JsonSink<'o> {
    /// `text`: the source text that the spans are ranges of.
    pub fn new(text: &[u8], out: &'o mut Vec<u8>) -> Self {
        JsonSink {
            start: out.len(),
            out,
            offsets: Utf16Offsets::new(text),
        }
    }

    /// Before a value: separates it from the previous element of a list.
    #[inline]
    fn separate(&mut self) {
        if self.out.len() > self.start && !matches!(self.out.last(), Some(b'[' | b':')) {
            self.out.push(b',');
        }
    }
}

impl Sink for JsonSink<'_> {
    fn start_node(&mut self, node_type: NodeType, span: Span) {
        self.separate();
        let (start, end) = (self.offsets.of(span.start), self.offsets.of(span.end));
        let _ = write!(self.out, "{{\"type\":\"{}\",\"range\":[{start},{end}]", node_type.name());
    }

    #[inline]
    fn end_node(&mut self) {
        self.out.push(b'}');
    }

    #[inline]
    fn start_object(&mut self) {
        self.separate();
        self.out.push(b'{');
    }

    #[inline]
    fn end_object(&mut self) {
        self.out.push(b'}');
    }

    #[inline]
    fn start_list(&mut self) {
        self.separate();
        self.out.push(b'[');
    }

    #[inline]
    fn end_list(&mut self) {
        self.out.push(b']');
    }

    fn field(&mut self, name: &'static str) {
        if self.out.last() != Some(&b'{') {
            self.out.push(b',');
        }
        self.out.push(b'"');
        self.out.extend_from_slice(name.as_bytes());
        self.out.extend_from_slice(b"\":");
    }

    fn null(&mut self) {
        self.separate();
        self.out.extend_from_slice(b"null");
    }

    fn boolean(&mut self, value: bool) {
        self.separate();
        self.out.extend_from_slice(if value { b"true" } else { b"false" });
    }

    /// What JSON has no number for is `null`, as for `JSON.stringify`.
    fn number(&mut self, value: f64) {
        self.separate();
        match value.is_finite() {
            true => {
                let _ = write!(self.out, "{value:?}");
            }
            false => self.out.extend_from_slice(b"null"),
        }
    }

    fn string(&mut self, value: &[u8]) {
        self.separate();
        self.out.push(b'"');
        let mut rest = value;
        while let Some((&byte, after)) = rest.split_first() {
            match byte {
                b'"' => self.out.extend_from_slice(b"\\\""),
                b'\\' => self.out.extend_from_slice(b"\\\\"),
                b'\n' => self.out.extend_from_slice(b"\\n"),
                b'\r' => self.out.extend_from_slice(b"\\r"),
                b'\t' => self.out.extend_from_slice(b"\\t"),
                0..0x20 => {
                    let _ = write!(self.out, "\\u{byte:04x}");
                }
                // A surrogate, which is not valid in UTF-8.
                0xED if matches!(after, [0xA0..=0xBF, 0x80..=0xBF, ..]) => {
                    let unit = 0xD000 | u32::from(after[0] & 0x3F) << 6 | u32::from(after[1] & 0x3F);
                    let _ = write!(self.out, "\\u{unit:04x}");
                    rest = &after[2..];
                    continue;
                }
                _ => self.out.push(byte),
            }
            rest = after;
        }
        self.out.push(b'"');
    }
}
