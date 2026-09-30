// printer/emittextwriter.go: the writer interface of the emit printer.
use crate::ast::SymbolId;
use crate::core::UTF16Offset;

// Externally opaque interface for printing text
pub trait EmitTextWriter {
    fn write(&mut self, s: &[u8]);
    fn write_trailing_semicolon(&mut self, text: &[u8]);
    fn write_comment(&mut self, text: &[u8]);
    fn write_keyword(&mut self, text: &[u8]);
    fn write_operator(&mut self, text: &[u8]);
    fn write_punctuation(&mut self, text: &[u8]);
    fn write_space(&mut self, text: &[u8]);
    fn write_string_literal(&mut self, text: &[u8]);
    fn write_parameter(&mut self, text: &[u8]);
    fn write_property(&mut self, text: &[u8]);
    fn write_symbol(&mut self, text: &[u8], symbol: SymbolId);
    fn write_line(&mut self);
    fn write_line_force(&mut self, force: bool);
    fn increase_indent(&mut self);
    fn decrease_indent(&mut self);
    fn clear(&mut self);
    fn string(&self) -> &[u8];
    fn raw_write(&mut self, s: &[u8]);
    fn write_literal(&mut self, s: &[u8]);
    fn get_text_pos(&self) -> isize;
    fn get_line(&self) -> isize;
    fn get_column(&self) -> UTF16Offset;
    fn get_indent(&self) -> isize;
    fn is_at_start_of_line(&self) -> bool;
    fn has_trailing_comment(&self) -> bool;
    fn has_trailing_whitespace(&self) -> bool;
}

// A borrowed writer is a writer: the printer keeps the writer of one `write` call behind a box.
impl<W: EmitTextWriter + ?Sized> EmitTextWriter for &mut W {
    fn write(&mut self, s: &[u8]) {
        (**self).write(s);
    }
    fn write_trailing_semicolon(&mut self, text: &[u8]) {
        (**self).write_trailing_semicolon(text);
    }
    fn write_comment(&mut self, text: &[u8]) {
        (**self).write_comment(text);
    }
    fn write_keyword(&mut self, text: &[u8]) {
        (**self).write_keyword(text);
    }
    fn write_operator(&mut self, text: &[u8]) {
        (**self).write_operator(text);
    }
    fn write_punctuation(&mut self, text: &[u8]) {
        (**self).write_punctuation(text);
    }
    fn write_space(&mut self, text: &[u8]) {
        (**self).write_space(text);
    }
    fn write_string_literal(&mut self, text: &[u8]) {
        (**self).write_string_literal(text);
    }
    fn write_parameter(&mut self, text: &[u8]) {
        (**self).write_parameter(text);
    }
    fn write_property(&mut self, text: &[u8]) {
        (**self).write_property(text);
    }
    fn write_symbol(&mut self, text: &[u8], symbol: SymbolId) {
        (**self).write_symbol(text, symbol);
    }
    fn write_line(&mut self) {
        (**self).write_line();
    }
    fn write_line_force(&mut self, force: bool) {
        (**self).write_line_force(force);
    }
    fn increase_indent(&mut self) {
        (**self).increase_indent();
    }
    fn decrease_indent(&mut self) {
        (**self).decrease_indent();
    }
    fn clear(&mut self) {
        (**self).clear();
    }
    fn string(&self) -> &[u8] {
        (**self).string()
    }
    fn raw_write(&mut self, s: &[u8]) {
        (**self).raw_write(s);
    }
    fn write_literal(&mut self, s: &[u8]) {
        (**self).write_literal(s);
    }
    fn get_text_pos(&self) -> isize {
        (**self).get_text_pos()
    }
    fn get_line(&self) -> isize {
        (**self).get_line()
    }
    fn get_column(&self) -> UTF16Offset {
        (**self).get_column()
    }
    fn get_indent(&self) -> isize {
        (**self).get_indent()
    }
    fn is_at_start_of_line(&self) -> bool {
        (**self).is_at_start_of_line()
    }
    fn has_trailing_comment(&self) -> bool {
        (**self).has_trailing_comment()
    }
    fn has_trailing_whitespace(&self) -> bool {
        (**self).has_trailing_whitespace()
    }
}
