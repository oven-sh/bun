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

    /// It may also be so for a control character.
    #[inline(always)]
    fn is_needed_in<const N: usize>(self, chunk: &[u8; N]) -> bool {
        let quote = if matches!(self, Escape::HtmlAttribute | Escape::XmlAttribute) {
            b'&' ^ b'"'
        } else {
            0
        };
        let controls = if matches!(self, Escape::XmlAttribute) {
            14
        } else {
            0
        };
        chunk.iter().fold(false, |any, it| {
            any | (it | 2 == b'>') | (it | quote == b'&') | (*it == 0xa0) | (*it < controls)
        })
    }

    #[inline(always)]
    fn is_needed_at_ends<const N: usize>(self, bytes: &[u8]) -> bool {
        [bytes.first_chunk::<N>(), bytes.last_chunk()]
            .into_iter()
            .flatten()
            .fold(false, |any, it| any | self.is_needed_in(it))
    }

    #[inline(always)]
    fn may_be_needed(self, bytes: &[u8]) -> bool {
        match bytes.len() {
            65.. => true,
            32.. => self.is_needed_at_ends::<32>(bytes),
            16.. => self.is_needed_at_ends::<16>(bytes),
            8.. => self.is_needed_at_ends::<8>(bytes),
            4.. => self.is_needed_at_ends::<4>(bytes),
            2.. => self.is_needed_at_ends::<2>(bytes),
            _ => self.is_needed_at_ends::<1>(bytes),
        }
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
