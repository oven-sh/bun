use super::{Lexer, fix_whitespace_and_decode_jsx_entities, is_utf8};
use crate::Rejection;
use crate::names::Text;
use crate::token::T;
use bun_core::lexer::{is_white_space_single_line, is_whitespace};
use bun_core::strings::{self, CodepointIterator, Cursor, push_codepoint_wtf8_joined};
use bun_sema::atom::Atom;

#[cfg(test)]
mod tests;

fn decode_as_bun_run(text: &[u8]) -> (u32, usize) {
    let mut cursor = Cursor::default();
    CodepointIterator::init(text).next(&mut cursor);
    (cursor.c as u32, usize::from(cursor.width))
}

fn push_as_bun_run(text: &[u8], decoded: &mut Vec<u8>) {
    let code_points = CodepointIterator::init(text);
    let mut cursor = Cursor::default();
    while code_points.next(&mut cursor) {
        push_codepoint_wtf8_joined(decoded, cursor.c as u32);
    }
}

pub(super) fn read_as_bun_run(text: &[u8]) -> Vec<u8> {
    let mut decoded = Vec::with_capacity(text.len());
    push_as_bun_run(text, &mut decoded);
    decoded
}

impl Lexer<'_> {
    #[inline(always)]
    pub(super) fn reads_html_comments(&self) -> bool {
        self.is_script || self.compiles
    }

    #[cold]
    #[inline(never)]
    pub(super) fn html_open_error(&mut self, pos: usize) -> bool {
        self.error(Rejection::UnexpectedCharacter, 1127, (pos, pos + 4), &[])
    }

    pub(super) fn decode_escaped_byte(&self, at: usize) -> (u32, usize) {
        match self.decodes_ill_formed_text {
            true => decode_as_bun_run(self.src.get(at..).unwrap_or_default()),
            false => (0xFFFD, 1),
        }
    }

    #[inline]
    pub(super) fn push_written(&self, written: &[u8], text: &mut Vec<u8>) {
        match self.decodes_ill_formed_text && !written.is_ascii() && !is_utf8(written) {
            true => push_as_bun_run(written, text),
            false => text.extend_from_slice(written),
        }
    }

    pub(crate) fn atom_of_written(
        &mut self,
        start: usize,
        end: usize,
        is_well_formed: bool,
    ) -> Atom {
        let src = self.src;
        if self.decodes_ill_formed_text && !is_well_formed {
            let read = read_as_bun_run(src.get(start..end).unwrap_or_default());
            return (self.names).atom(Text::not_in_source(src, &read), self.atoms);
        }
        (self.names).atom(Text::from_source(src, start, end), self.atoms)
    }

    pub(crate) fn template_raw(&mut self) -> Atom {
        let text = self.text();
        let closer_len = match self.token {
            T::TemplateHead | T::TemplateMiddle => 2,
            T::NoSubstitutionTemplate | T::TemplateTail => usize::from(text.last() == Some(&b'`')),
            _ => {
                debug_assert!(false);
                return Atom::NONE;
            }
        };
        let piece = text
            .get(1..text.len().saturating_sub(closer_len))
            .unwrap_or_default();
        if strings::index_of_any(piece, b"\\\r").is_none() {
            return self.atom;
        }
        let mut raw = std::mem::take(&mut self.buffer);
        raw.clear();
        let mut rest = piece;
        while let Some(at) = strings::index_of_char_usize(rest, b'\r') {
            self.push_written(&rest[..at], &mut raw);
            raw.push(b'\n');
            rest = &rest[at + 1..];
            rest = rest.strip_prefix(b"\n").unwrap_or(rest);
        }
        self.push_written(rest, &mut raw);
        let atom = (self.names).atom(Text::not_in_source(self.src, &raw), self.atoms);
        self.buffer = raw;
        atom
    }

    pub(super) fn jsx_text_value(&self, text: &[u8]) -> Vec<u8> {
        match self.decodes_ill_formed_text {
            true => fix_whitespace_and_decode_jsx_entities(text, is_whitespace),
            false => fix_whitespace_and_decode_jsx_entities(text, is_white_space_single_line),
        }
    }

    pub(crate) fn jsx_attribute_text(&mut self) -> Atom {
        let token = self.text();
        let after_quote = token.get(1..).unwrap_or_default();
        let written = after_quote
            .strip_suffix(token.get(..1).unwrap_or_default())
            .unwrap_or(after_quote);
        let has_backslash = bun_core::strings::contains_char(written, b'\\');
        let needs_decoding = written.iter().any(|&c| c == b'&' || c >= 0x80)
            || has_backslash
                && (written.iter().zip(written.iter().skip(1)))
                    .any(|it| matches!(it, (b'\\', b'u' | 0 | 0x08 | 0x09 | 0x0B | 0x0C)));
        if needs_decoding {
            let decoded = match core::str::from_utf8(written) {
                Ok(_) => fix_whitespace_and_decode_jsx_entities(written, is_whitespace),
                Err(_) => {
                    fix_whitespace_and_decode_jsx_entities(&read_as_bun_run(written), is_whitespace)
                }
            };
            return (self.names).atom(Text::not_in_source(self.src, &decoded), self.atoms);
        }
        if !has_backslash {
            return self.atom;
        }
        let from = self.start as usize + 1;
        let text = Text::from_source(self.src, from, from + written.len());
        self.names.atom(text, self.atoms)
    }
}
