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
