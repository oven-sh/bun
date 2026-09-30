// printer/textwriter.go: the multi-line writer of the emit printer.
use crate::ast::SymbolId;
use crate::core::{UTF16Offset, compute_ecma_line_starts_seq, utf16_len};
use crate::printer::emittextwriter::EmitTextWriter;
use crate::stringutil::is_white_space_like;

// utf8.RuneError
pub(crate) const RUNE_ERROR: u32 = 0xFFFD;

// utf8.DecodeLastRuneInString: the last rune of `s`, RuneError for an empty or an invalid tail.
pub(crate) fn decode_last_rune_in_string(s: &[u8]) -> u32 {
    let Some(&last) = s.last() else {
        return RUNE_ERROR;
    };
    if last < 0x80 {
        return u32::from(last);
    }
    let end = s.len();
    let limit = end.saturating_sub(4);
    let mut start = end - 1;
    while start > limit {
        let is_continuation = s.get(start).is_some_and(|b| b & 0xC0 == 0x80);
        if !is_continuation {
            break;
        }
        start -= 1;
    }
    let tail = s.get(start..end).unwrap_or(&[]);
    match std::str::from_utf8(tail) {
        Ok(text) => text.chars().next().map_or(RUNE_ERROR, u32::from),
        Err(_) => RUNE_ERROR,
    }
}

#[derive(Default)]
pub struct TextWriter {
    new_line: Vec<u8>,
    indent_size: isize,
    builder: Vec<u8>,
    last_written: Vec<u8>,
    indent: isize,
    line_start: bool,
    line_count: isize,
    line_pos: isize,
    has_trailing_comment_state: bool,
}

impl TextWriter {
    pub fn grow(&mut self, n: isize) {
        self.builder.reserve(usize::try_from(n).unwrap_or(0));
    }

    fn set_last_written(&mut self, s: &[u8]) {
        self.last_written.clear();
        self.last_written.extend_from_slice(s);
    }

    fn update_line_count_and_pos_for(&mut self, s: &[u8]) {
        let mut count: isize = 0;
        let mut last_line_start: isize = 0;

        for line_start in compute_ecma_line_starts_seq(s) {
            count += 1;
            last_line_start = line_start.0 as isize;
        }

        if count > 1 {
            self.line_count += count - 1;
            let cur_len = self.builder.len() as isize;
            self.line_pos = cur_len - s.len() as isize + last_line_start;
            self.line_start = (self.line_pos - cur_len) == 0;
            return;
        }
        self.line_start = false;
    }

    fn write_text(&mut self, s: &[u8]) {
        if !s.is_empty() {
            if self.line_start {
                let indent = get_indent_string(self.indent, self.indent_size);
                self.builder.extend_from_slice(&indent);
                self.line_start = false;
            }
            self.builder.extend_from_slice(s);
            self.set_last_written(s);
            self.update_line_count_and_pos_for(s);
        }
    }

    fn write_line_raw(&mut self) {
        self.builder.extend_from_slice(&self.new_line);
        self.last_written.clear();
        self.last_written.extend_from_slice(&self.new_line);
        self.line_count += 1;
        self.line_pos = self.builder.len() as isize;
        self.line_start = true;
        self.has_trailing_comment_state = false;
    }
}

const DEFAULT_INDENT_SIZE: isize = 4;

// GetDefaultIndentSize returns the default indent size (4 spaces) used when no specific indent size is configured.
pub fn get_default_indent_size() -> isize {
    DEFAULT_INDENT_SIZE
}

fn get_indent_string(indent: isize, indent_size: isize) -> Vec<u8> {
    if indent == 0 {
        return Vec::new();
    }
    vec![b' '; usize::try_from(indent.saturating_mul(indent_size)).unwrap_or(0)]
}

impl EmitTextWriter for TextWriter {
    fn clear(&mut self) {
        let new_line = std::mem::take(&mut self.new_line);
        *self = TextWriter {
            new_line,
            indent_size: self.indent_size,
            line_start: true,
            ..TextWriter::default()
        };
    }

    fn decrease_indent(&mut self) {
        self.indent -= 1;
    }

    // GetColumn returns the column position measured in UTF-16 code units for source map compatibility.
    fn get_column(&self) -> UTF16Offset {
        if self.line_start {
            return UTF16Offset(self.indent * self.indent_size);
        }
        // Count UTF-16 code units from the last line start: for ASCII-only output this equals the byte count.
        let line = usize::try_from(self.line_pos)
            .ok()
            .and_then(|pos| self.builder.get(pos..))
            .unwrap_or(&[]);
        utf16_len(line)
    }

    fn get_indent(&self) -> isize {
        self.indent
    }

    fn get_line(&self) -> isize {
        self.line_count
    }

    fn string(&self) -> &[u8] {
        &self.builder
    }

    fn get_text_pos(&self) -> isize {
        self.builder.len() as isize
    }

    fn has_trailing_comment(&self) -> bool {
        self.has_trailing_comment_state
    }

    fn has_trailing_whitespace(&self) -> bool {
        if self.builder.is_empty() {
            return false;
        }
        let ch = decode_last_rune_in_string(&self.last_written);
        if ch == RUNE_ERROR {
            return false;
        }
        is_white_space_like(ch)
    }

    fn increase_indent(&mut self) {
        self.indent += 1;
    }

    fn is_at_start_of_line(&self) -> bool {
        self.line_start
    }

    fn raw_write(&mut self, s: &[u8]) {
        if !s.is_empty() {
            self.builder.extend_from_slice(s);
            self.set_last_written(s);
            self.has_trailing_comment_state = false;
        }
        self.update_line_count_and_pos_for(s);
    }

    fn write(&mut self, s: &[u8]) {
        if !s.is_empty() {
            self.has_trailing_comment_state = false;
        }
        self.write_text(s);
    }

    fn write_comment(&mut self, text: &[u8]) {
        if !text.is_empty() {
            self.has_trailing_comment_state = true;
        }
        self.write_text(text);
    }

    fn write_keyword(&mut self, text: &[u8]) {
        self.write(text);
    }

    fn write_line(&mut self) {
        if !self.line_start {
            self.write_line_raw();
        }
    }

    fn write_line_force(&mut self, force: bool) {
        if !self.line_start || force {
            self.write_line_raw();
        }
    }

    fn write_literal(&mut self, s: &[u8]) {
        self.write(s);
    }

    fn write_operator(&mut self, text: &[u8]) {
        self.write(text);
    }

    fn write_parameter(&mut self, text: &[u8]) {
        self.write(text);
    }

    fn write_property(&mut self, text: &[u8]) {
        self.write(text);
    }

    fn write_punctuation(&mut self, text: &[u8]) {
        self.write(text);
    }

    fn write_space(&mut self, text: &[u8]) {
        self.write(text);
    }

    fn write_string_literal(&mut self, text: &[u8]) {
        self.write(text);
    }

    fn write_symbol(&mut self, text: &[u8], _symbol: SymbolId) {
        self.write(text);
    }

    fn write_trailing_semicolon(&mut self, text: &[u8]) {
        self.write(text);
    }
}

pub fn new_text_writer(new_line: &[u8], indent_size: isize) -> Box<dyn EmitTextWriter> {
    let mut indent_size = indent_size;
    if indent_size <= 0 {
        indent_size = 4;
    }
    let mut w = TextWriter {
        new_line: new_line.to_vec(),
        indent_size,
        ..TextWriter::default()
    };
    w.clear();
    Box::new(w)
}
