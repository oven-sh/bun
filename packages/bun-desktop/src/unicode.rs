//! Unicode's properties and algorithms, from ICU.

use crate::bun::host;

#[path = "unicode/properties.rs"]
mod properties;
pub use properties::*;

/// An ISO 15924 tag.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Script(pub [u8; 4]);

impl Script {
    pub const COMMON: Script = Script(*b"Zyyy");
    pub const INHERITED: Script = Script(*b"Zinh");
    pub const UNKNOWN: Script = Script(*b"Zzzz");
    pub const LATIN: Script = Script(*b"Latn");
    pub const HAN: Script = Script(*b"Hani");

    pub fn of(character: char) -> Script {
        match character {
            'a'..='z' | 'A'..='Z' => Script::LATIN,
            '\0'..='\u{a9}' | '\u{2010}'..='\u{2070}' | '\u{2190}'..='\u{27ff}' => Script::COMMON,
            '\u{4e00}'..='\u{9fff}' => Script::HAN,
            '\u{410}'..='\u{44f}' => Script(*b"Cyrl"),
            '\u{5d0}'..='\u{5ea}' => Script(*b"Hebr"),
            '\u{620}'..='\u{63f}' | '\u{641}'..='\u{64a}' => Script(*b"Arab"),
            '\u{3041}'..='\u{3096}' => Script(*b"Hira"),
            '\u{30a1}'..='\u{30fa}' => Script(*b"Kana"),
            '\u{ac00}'..='\u{d7a3}' => Script(*b"Hang"),
            _ => Script((host().script_of)(character.into()).to_be_bytes()),
        }
    }

    pub fn is_specific(self) -> bool {
        !matches!(self, Script::COMMON | Script::INHERITED | Script::UNKNOWN)
    }
}

const UCHAR_EMOJI: u32 = 57;
const UCHAR_EMOJI_PRESENTATION: u32 = 58;
const UCHAR_LINE_BREAK: u32 = 0x1008;

pub fn is_emoji(character: char) -> bool {
    !matches!(character, '\u{af}'..'\u{203c}' | '\u{3400}'..='\u{ffff}')
        && (host().character_property)(character.into(), UCHAR_EMOJI) != 0
}

pub fn has_emoji_presentation(character: char) -> bool {
    !matches!(character, '\u{3400}'..='\u{ffff}')
        && (host().character_property)(character.into(), UCHAR_EMOJI_PRESENTATION) != 0
}

/// Some of `ULineBreak`.
pub mod line_break {
    pub const UNKNOWN: i32 = 0;
    pub const AMBIGUOUS: i32 = 1;
    pub const ALPHABETIC: i32 = 2;
    pub const BREAK_AFTER: i32 = 4;
    pub const CLOSE_PUNCTUATION: i32 = 8;
    pub const EXCLAMATION: i32 = 11;
    pub const HYPHEN: i32 = 13;
    pub const INFIX_NUMERIC: i32 = 16;
    pub const NUMERIC: i32 = 19;
    pub const OPEN_PUNCTUATION: i32 = 20;
    pub const POSTFIX_NUMERIC: i32 = 21;
    pub const PREFIX_NUMERIC: i32 = 22;
    pub const COMPLEX_CONTEXT: i32 = 24;
    pub const BREAK_SYMBOLS: i32 = 27;
    pub const CLOSE_PARENTHESIS: i32 = 36;
    pub const HEBREW_LETTER: i32 = 38;
    pub const UNAMBIGUOUS_HYPHEN: i32 = 48;

    pub fn of(character: char) -> i32 {
        (super::host().character_property)(character.into(), super::UCHAR_LINE_BREAK)
    }
}

/// Replaces `offsets` with those after 0. `kind` is a `bun::abi::BREAK_*`.
pub fn find_breaks(kind: u8, text: &str, offsets: &mut Vec<u32>) {
    offsets.clear();
    offsets.reserve(text.len());
    // SAFETY: there is room for one per byte, and so many have been written.
    unsafe {
        let count = (host().find_breaks)(kind, text.as_ptr(), text.len(), offsets.as_mut_ptr());
        offsets.set_len(count);
    }
}

/// Whether it is a grapheme cluster of its own next to others of its kind.
pub fn stands_alone(character: char) -> bool {
    matches!(character as u32, 0..=0xc | 0xe..0x300 | 0x370..0x483 | 0x48a..0x591 | 0x5d0..0x600 | 0x620..0x64b | 0x660..=0x66f | 0x671..0x6d6 | 0x1e00..0x200c | 0x2010..0x20d0 | 0x2100..0x2cef
        | 0x2e00..0x302a | 0x3030..0x3099 | 0x309b..0xa66f | 0xac00..0xd7a4 | 0xff00..0xff9e)
}

/// The level of the paragraph, and that of each byte.
pub fn resolve_bidi(text: &str, direction: u8) -> (u8, Vec<u8>) {
    let mut levels = vec![0; text.len()];
    // SAFETY: there is room for one per byte.
    let level =
        unsafe { (host().resolve_bidi)(text.as_ptr(), text.len(), direction, levels.as_mut_ptr()) };
    (level, levels)
}
