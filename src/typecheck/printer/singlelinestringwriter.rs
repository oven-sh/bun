// printer/singlelinestringwriter.go: the writer that puts everything on one line.
use crate::ast::SymbolId;
use crate::core::UTF16Offset;
use crate::printer::emittextwriter::EmitTextWriter;
use crate::printer::textwriter::{RUNE_ERROR, decode_last_rune_in_string};
use crate::stringutil::is_white_space_like;

// Upstream takes the writer from a sync.Pool and returns a release function: there is no pool here.
pub fn get_single_line_string_writer() -> Box<dyn EmitTextWriter> {
    let mut w = SingleLineStringWriter::default();
    w.clear();
    Box::new(w)
}

#[derive(Default)]
pub struct SingleLineStringWriter {
    builder: Vec<u8>,
    last_written: Vec<u8>,
}

impl SingleLineStringWriter {
    fn append(&mut self, s: &[u8]) {
        self.last_written.clear();
        self.last_written.extend_from_slice(s);
        self.builder.extend_from_slice(s);
    }
}

impl EmitTextWriter for SingleLineStringWriter {
    fn clear(&mut self) {
        self.last_written.clear();
        self.builder.clear();
    }

    fn decrease_indent(&mut self) {}

    fn get_column(&self) -> UTF16Offset {
        UTF16Offset(0)
    }

    fn get_indent(&self) -> isize {
        0
    }

    fn get_line(&self) -> isize {
        0
    }

    fn string(&self) -> &[u8] {
        &self.builder
    }

    fn get_text_pos(&self) -> isize {
        self.builder.len() as isize
    }

    fn has_trailing_comment(&self) -> bool {
        false
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

    fn increase_indent(&mut self) {}

    fn is_at_start_of_line(&self) -> bool {
        false
    }

    fn raw_write(&mut self, s: &[u8]) {
        self.append(s);
    }

    fn write(&mut self, s: &[u8]) {
        self.append(s);
    }

    fn write_comment(&mut self, text: &[u8]) {
        self.append(text);
    }

    fn write_keyword(&mut self, text: &[u8]) {
        self.append(text);
    }

    fn write_line(&mut self) {
        self.append(b" ");
    }

    fn write_line_force(&mut self, _force: bool) {
        self.append(b" ");
    }

    fn write_literal(&mut self, s: &[u8]) {
        self.append(s);
    }

    fn write_operator(&mut self, text: &[u8]) {
        self.append(text);
    }

    fn write_parameter(&mut self, text: &[u8]) {
        self.append(text);
    }

    fn write_property(&mut self, text: &[u8]) {
        self.append(text);
    }

    fn write_punctuation(&mut self, text: &[u8]) {
        self.append(text);
    }

    fn write_space(&mut self, text: &[u8]) {
        self.append(text);
    }

    fn write_string_literal(&mut self, text: &[u8]) {
        self.append(text);
    }

    fn write_symbol(&mut self, text: &[u8], _symbol: SymbolId) {
        self.append(text);
    }

    fn write_trailing_semicolon(&mut self, text: &[u8]) {
        self.append(text);
    }
}
