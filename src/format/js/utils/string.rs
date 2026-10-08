//! String literals: which quotes they get, and what has to be escaped then.

use crate::ir::element::TextWidth;
use crate::prelude::*;
use std::borrow::Cow;

#[derive(Eq, PartialEq, Debug, Clone, Copy)]
pub(crate) enum StringLiteralParentKind {
    /// An expression, or the value of a JSX attribute.
    Expression,
    /// The name of an import attribute.
    ImportAttribute,
    /// `"use strict"`. Nothing but the quotes is changed, and they are only if there are no
    /// quotes inside.
    Directive,
}

/// A string literal, with its quotes, as it is written in the source.
#[derive(Clone, Copy, Debug)]
pub(crate) struct FormatLiteralStringToken<'a> {
    string: &'a [u8],
    jsx: bool,
    parent_kind: StringLiteralParentKind,
}

#[path = "es5_identifier_tables.rs"]
mod es5_identifier_tables;

/// ES5's `IdentifierName`, as the package `is-es5-identifier-name` has it, whose letters are those of
/// an old version of Unicode. Prettier only removes the quotes of such a name.
pub(crate) fn is_es5_identifier_name(name: &[u8]) -> bool {
    use es5_identifier_tables::{PART, START};
    let is_in = |table: &[(u16, u16)], c: u32| {
        u16::try_from(c).is_ok_and(|c| {
            let index = table.partition_point(|&(_, end)| end < c);
            table.get(index).is_some_and(|&(start, _)| start <= c)
        })
    };
    !name.is_empty()
        && bun_lint::utils::text::code_points(name).all(|(at, c)| match u8::try_from(c) {
            Ok(b) if b.is_ascii() => {
                b.is_ascii_alphabetic() || matches!(b, b'$' | b'_') || (at != 0 && b.is_ascii_digit())
            }
            _ => is_in(if at == 0 { START } else { PART }, c),
        })
}

/// Prettier's `isSimpleNumber`: `123` and `2.5`, but not `1_000`, `1e+100` or `0b10`.
pub(crate) fn is_simple_number(text: &[u8]) -> bool {
    let is_digits = |part: &[u8]| !part.is_empty() && part.iter().all(u8::is_ascii_digit);
    match bun_core::strings::split_once_char(text, b'.') {
        Some((integer, fraction)) => is_digits(integer) && is_digits(fraction),
        None => is_digits(text),
    }
}

/// `String(Number(text)) === text`, for a simple number.
pub(crate) fn is_canonical_simple_number(text: &[u8]) -> bool {
    let Some(number) = std::str::from_utf8(text).ok().and_then(|it| it.parse::<f64>().ok()) else {
        return false;
    };
    // Rust and JavaScript print the same digits. JavaScript changes notation at 1e21 and below 1e-6.
    (number == 0.0 || (1e-6..1e21).contains(&number)) && number.to_string().as_bytes() == text
}

struct StringInformation {
    current_quote: QuoteStyle,
    /// The one that takes fewer escapes.
    preferred_quote: QuoteStyle,
    raw_content_has_quotes: bool,
}

impl<'a> FormatLiteralStringToken<'a> {
    pub(crate) fn new(string: &'a [u8], jsx: bool, parent_kind: StringLiteralParentKind) -> Self {
        Self {
            string,
            jsx,
            parent_kind,
        }
    }

    fn raw_content(&self) -> &'a [u8] {
        self.string.get(1..self.string.len().saturating_sub(1)).unwrap_or_default()
    }

    /// Prettier's `getPreferredQuote`.
    fn compute_string_information(&self, chosen_quote: QuoteStyle) -> StringInformation {
        let content = self.raw_content();
        let chosen_quote_count = bun_core::strings::count_char(content, chosen_quote.as_byte());
        let alternate_quote_count = bun_core::strings::count_char(content, chosen_quote.other().as_byte());
        StringInformation {
            current_quote: self.string.first().copied().and_then(QuoteStyle::from_byte).unwrap_or_default(),
            preferred_quote: match chosen_quote_count > alternate_quote_count {
                true => chosen_quote.other(),
                false => chosen_quote,
            },
            raw_content_has_quotes: chosen_quote_count > 0 || alternate_quote_count > 0,
        }
    }

    /// The text that is written for the literal.
    pub(crate) fn clean_text(&self, f: &Formatter<'a>) -> CleanedStringLiteralText<'a> {
        let options = f.options();
        let chosen_quote_style = if self.jsx { options.jsx_quote_style } else { options.quote_style };
        let is_quote_needed = match options.quote_properties {
            QuoteProperties::AsNeeded => false,
            QuoteProperties::Preserve => true,
            QuoteProperties::Consistent => f.context().is_quote_needed(),
        };

        if self.jsx && self.parent_kind == StringLiteralParentKind::Expression {
            return CleanedStringLiteralText {
                text: self.normalize_jsx_attribute(chosen_quote_style),
            };
        }

        let information = self.compute_string_information(chosen_quote_style);
        let content = self.raw_content();
        let text = match self.parent_kind {
            StringLiteralParentKind::Expression => self.normalize_string_literal(&information),
            StringLiteralParentKind::Directive => self.normalize_directive(&information),
            StringLiteralParentKind::ImportAttribute if !is_quote_needed && is_es5_identifier_name(content) => {
                Cow::Borrowed(content)
            }
            StringLiteralParentKind::ImportAttribute => self.normalize_string_literal(&information),
        };
        CleanedStringLiteralText { text }
    }

    fn normalize_directive(&self, information: &StringInformation) -> Cow<'a, [u8]> {
        let quote = match information.raw_content_has_quotes {
            true => information.current_quote,
            false => information.preferred_quote,
        };
        let content = self.raw_content();
        if quote == information.current_quote && !bun_core::strings::contains_char(content, b'\r') {
            return Cow::Borrowed(self.string);
        }
        let mut text = Vec::with_capacity(self.string.len());
        text.push(quote.as_byte());
        push_with_normalized_newlines(&mut text, content);
        text.push(quote.as_byte());
        Cow::Owned(text)
    }

    /// Prettier's `makeString`.
    fn normalize_string_literal(&self, information: &StringInformation) -> Cow<'a, [u8]> {
        let content = self.raw_content();
        let quotes_will_change = information.current_quote != information.preferred_quote;
        if !quotes_will_change && !bun_core::strings::contains_char(content, b'\r') {
            return Cow::Borrowed(self.string);
        }
        let preferred_quote = information.preferred_quote.as_byte();
        let alternate_quote = information.preferred_quote.other().as_byte();
        let mut text = Vec::with_capacity(self.string.len() + 2);
        text.push(preferred_quote);
        let mut bytes = content.iter().copied().peekable();
        while let Some(byte) = bytes.next() {
            match byte {
                b'\\' => match bytes.peek().copied() {
                    // It does not have to be escaped any more.
                    Some(escaped) if quotes_will_change && escaped == alternate_quote => {}
                    Some(b'\r') => text.push(b'\\'),
                    Some(escaped) => {
                        text.extend_from_slice(&[b'\\', escaped]);
                        bytes.next();
                    }
                    None => text.push(b'\\'),
                },
                b'\r' => {
                    bytes.next_if_eq(&b'\n');
                    text.push(b'\n');
                }
                _ if byte == preferred_quote => text.extend_from_slice(&[b'\\', byte]),
                _ => text.push(byte),
            }
        }
        text.push(preferred_quote);
        Cow::Owned(text)
    }

    /// In the value of a JSX attribute, a quote is escaped as `&quot;` or `&apos;`.
    fn normalize_jsx_attribute(&self, preferred_quote: QuoteStyle) -> Cow<'a, [u8]> {
        let content = self.raw_content();
        let current_quote = self.string.first().copied().and_then(QuoteStyle::from_byte).unwrap_or_default();

        let count = |quote: u8, entity: &[u8]| {
            let mut count = bun_core::strings::count_char(content, quote);
            let mut rest = content;
            while let Some(at) = bun_core::strings::index_of(rest, entity) {
                count += 1;
                rest = &rest[at + entity.len()..];
            }
            count
        };
        let single_count = count(b'\'', b"&apos;");
        let double_count = count(b'"', b"&quot;");
        let chosen_quote = match preferred_quote {
            QuoteStyle::Double if double_count > single_count => QuoteStyle::Single,
            QuoteStyle::Single if single_count > double_count => QuoteStyle::Double,
            preferred => preferred,
        };

        if single_count == 0
            && double_count == 0
            && current_quote == chosen_quote
            && !bun_core::strings::contains_char(content, b'\r')
        {
            return Cow::Borrowed(self.string);
        }

        let mut unescaped = Vec::with_capacity(self.string.len());
        let mut rest = content;
        while let Some((&byte, tail)) = rest.split_first() {
            let (quote, len) = match byte {
                b'&' if rest.starts_with(b"&apos;") => (Some(QuoteStyle::Single), 6),
                b'&' if rest.starts_with(b"&quot;") => (Some(QuoteStyle::Double), 6),
                b'\'' => (Some(QuoteStyle::Single), 1),
                b'"' => (Some(QuoteStyle::Double), 1),
                _ => (None, 1),
            };
            match quote {
                Some(QuoteStyle::Single) if chosen_quote == QuoteStyle::Single => {
                    unescaped.extend_from_slice(b"&apos;");
                }
                Some(QuoteStyle::Double) if chosen_quote == QuoteStyle::Double => {
                    unescaped.extend_from_slice(b"&quot;");
                }
                Some(quote) => unescaped.push(quote.as_byte()),
                None => unescaped.push(byte),
            }
            rest = if len == 1 { tail } else { &rest[len..] };
        }
        let mut text = Vec::with_capacity(unescaped.len() + 2);
        text.push(chosen_quote.as_byte());
        push_with_normalized_newlines(&mut text, &unescaped);
        text.push(chosen_quote.as_byte());
        Cow::Owned(text)
    }
}

/// Appends `text` with `\r\n` and `\r` replaced by `\n`.
pub(crate) fn push_with_normalized_newlines(out: &mut Vec<u8>, text: &[u8]) {
    let mut rest = text;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\r') {
        out.extend_from_slice(&rest[..at]);
        out.push(b'\n');
        rest = &rest[at + 1..];
        rest = rest.strip_prefix(b"\n").unwrap_or(rest);
    }
    out.extend_from_slice(rest);
}

/// Whether `text` is printable ASCII without `quote`.
#[inline]
fn is_printable_ascii_without(text: &[u8], quote: u8) -> bool {
    #[inline]
    fn all<const N: usize>(block: &[u8; N], quote: u8) -> bool {
        block.iter().fold(true, |all, &byte| all & matches!(byte, 0x20..=0x7E) & (byte != quote))
    }
    if let Some(last) = text.last_chunk::<16>() {
        return text.as_chunks::<16>().0.iter().all(|block| all(block, quote)) && all(last, quote);
    }
    match (text.first_chunk::<8>(), text.last_chunk::<8>()) {
        (Some(first), Some(last)) => all(first, quote) & all(last, quote),
        _ => text.iter().all(|&byte| matches!(byte, 0x20..=0x7E) && byte != quote),
    }
}

impl FormatLiteralStringToken<'_> {
    /// Enough for [`FormatLiteralStringToken::clean_text`] to be the literal as it is written, and
    /// for that to be as wide as it is long. Most literals are like that.
    #[inline]
    fn is_clean_ascii(&self, f: &Formatter<'_>) -> bool {
        let quote = f.options().quote_style.as_byte();
        !self.jsx
            && self.parent_kind != StringLiteralParentKind::ImportAttribute
            && matches!(self.string, [first, content @ .., last]
                if *first == quote && *last == quote && is_printable_ascii_without(content, quote))
    }
}

impl<'a> Format<'a> for FormatLiteralStringToken<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self.is_clean_ascii(f) {
            true => f.write_text(self.string, Some(TextWidth::single(self.string.len() as u32))),
            false => self.clean_text(f).fmt(f),
        }
    }
}

pub(crate) struct CleanedStringLiteralText<'a> {
    text: Cow<'a, [u8]>,
}

impl std::ops::Deref for CleanedStringLiteralText<'_> {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        &self.text
    }
}

impl<'a> CleanedStringLiteralText<'a> {
    /// The number of columns that it takes.
    pub(crate) fn width(&self) -> usize {
        crate::ir::width::string_width(&self.text) as usize
    }

    pub(crate) fn into_text(self) -> Cow<'a, [u8]> {
        self.text
    }
}

impl<'a> Format<'a> for CleanedStringLiteralText<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        text(&self.text).fmt(f);
    }
}
