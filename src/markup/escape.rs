//! What serializing markup replaces by references.

use bun_core::strings;

use crate::{Chars, Text, Unit, with_units};

#[derive(Clone, Copy)]
#[repr(u8)]
pub enum Escape {
    HtmlText = 1,
    HtmlAttribute = 2,
    XmlText = 4,
    XmlAttribute = 8,
}

static ESCAPED_IN: [u8; 256] = {
    let mut table = [0; 256];
    let (html_attribute, xml_attribute) = (Escape::HtmlAttribute as u8, Escape::XmlAttribute as u8);
    (
        table[b'&' as usize],
        table[b'<' as usize],
        table[b'>' as usize],
    ) = (15, 15, 15);
    table[b'"' as usize] = html_attribute | xml_attribute;
    table[0xa0] = html_attribute | Escape::HtmlText as u8;
    (table[9], table[10], table[13]) = (xml_attribute, xml_attribute, xml_attribute);
    table
};

fn reference(byte: u8) -> &'static str {
    match byte {
        b'&' => "&amp;",
        b'<' => "&lt;",
        b'>' => "&gt;",
        b'"' => "&quot;",
        0xa0 => "&nbsp;",
        9 => "&#9;",
        10 => "&#10;",
        _ => "&#13;",
    }
}

impl Escape {
    fn set(self) -> &'static [u8] {
        match self {
            Escape::HtmlText => b"&<>\xa0",
            Escape::HtmlAttribute => b"&<>\"\xa0",
            Escape::XmlText => b"&<>",
            Escape::XmlAttribute => b"&<>\"\t\n\r",
        }
    }

    /// The high bit of a byte is set if so. It may also be so for a control character.
    #[inline(always)]
    fn is_needed_in(self, word: u64) -> u64 {
        let each = |byte: u8| u64::from_le_bytes([byte; 8]);
        let below = |word: u64, limit: u8| word.wrapping_sub(each(limit)) & !word;
        let quote = if matches!(self, Escape::HtmlAttribute | Escape::XmlAttribute) {
            b'&' ^ b'"'
        } else {
            0
        };
        let other = if matches!(self, Escape::XmlAttribute) {
            below(word, 14)
        } else {
            below(word ^ each(0xa0), 1)
        };
        below((word | each(2)) ^ each(b'>'), 1)
            | below((word | each(quote)) ^ each(b'&'), 1)
            | other
    }

    #[inline(always)]
    fn may_be_needed(self, bytes: &[u8]) -> bool {
        let found = match (
            bytes.last_chunk(),
            bytes.first_chunk(),
            bytes.last_chunk(),
            bytes,
        ) {
            _ if bytes.len() > 48 => return true,
            (Some(last), ..) => bytes
                .as_chunks()
                .0
                .iter()
                .fold(self.is_needed_in(u64::from_le_bytes(*last)), |any, it| {
                    any | self.is_needed_in(u64::from_le_bytes(*it))
                }),
            (_, Some(first), Some(last), _) => self.is_needed_in(
                u64::from(u32::from_le_bytes(*first)) << 32 | u64::from(u32::from_le_bytes(*last)),
            ),
            (.., [first, ..]) => self.is_needed_in(u64::from_le_bytes([
                *first,
                bytes[bytes.len() / 2],
                bytes[bytes.len() - 1],
                b' ',
                b' ',
                b' ',
                b' ',
                b' ',
            ])),
            _ => 0,
        };
        found & u64::from_le_bytes([0x80; 8]) != 0
    }

    #[inline]
    fn find(self, text: Chars<'_>) -> Option<usize> {
        match text {
            Chars::Latin1(bytes) if bytes.len() >= 32 => strings::index_of_any(bytes, self.set()),
            _ => {
                with_units!(text, units => units.iter().position(|it| ESCAPED_IN[it.low() as usize] & self as u8 != 0))
            }
        }
    }
}

#[inline(always)]
pub fn push_escaped(out: &mut Text, text: Chars<'_>, escape: Escape) {
    match text {
        Chars::Latin1(bytes) if !escape.may_be_needed(bytes) => out.push_latin1(bytes),
        _ => push_in_parts(out, text, escape),
    }
}

fn push_in_parts(out: &mut Text, mut text: Chars<'_>, escape: Escape) {
    while let Some(at) = escape.find(text) {
        out.push(text.slice(0..at));
        out.push_str(reference(text.at(at) as u8));
        text = text.skip(at + 1);
    }
    out.push(text);
}
