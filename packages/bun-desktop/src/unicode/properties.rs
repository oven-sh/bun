//! What shaping needs to know about characters.

use crate::bun::host;

fn property(character: u32, property: u32) -> i32 {
    (host().character_property)(character, property)
}

/// `UCharCategory`
pub mod category {
    pub const UNASSIGNED: u8 = 0;
    const UPPERCASE_LETTER: u8 = 1;
    const LOWERCASE_LETTER: u8 = 2;
    pub const OTHER_LETTER: u8 = 5;
    pub const NON_SPACING_MARK: u8 = 6;
    pub const ENCLOSING_MARK: u8 = 7;
    pub const SPACING_MARK: u8 = 8;
    pub const DIGIT: u8 = 9;
    pub const FORMAT: u8 = 16;
    const PRIVATE_USE: u8 = 17;
    const SURROGATE: u8 = 18;
    const OTHER_PUNCTUATION: u8 = 23;

    /// Not exact for punctuation, symbols and controls in ASCII.
    pub fn of(character: u32) -> u8 {
        match character {
            0x30..=0x39 => DIGIT,
            0x41..=0x5a => UPPERCASE_LETTER,
            0x61..=0x7a => LOWERCASE_LETTER,
            ..0x80 => OTHER_PUNCTUATION,
            0x4e00..=0x9fff | 0xac00..=0xd7a3 => OTHER_LETTER,
            // Apple's ICU knows what Apple uses them for.
            0xe000..=0xf8ff => PRIVATE_USE,
            _ => super::property(character, 0x1005) as u8,
        }
    }

    pub fn is_letter(category: u8) -> bool {
        (UPPERCASE_LETTER..=OTHER_LETTER).contains(&category)
    }

    pub fn is_in_word(category: u8) -> bool {
        matches!(category, UNASSIGNED..=SPACING_MARK | FORMAT..=SURROGATE)
    }
}

/// `UJoiningType`
pub mod joining {
    pub const NONE: i32 = 0;
    pub const CAUSING: i32 = 1;
    pub const DUAL: i32 = 2;
    pub const LEFT: i32 = 3;
    pub const TRANSPARENT: i32 = 5;
}

pub fn joining_type(character: u32) -> i32 {
    property(character, 0x1007)
}

pub fn combining_class(character: u32) -> u8 {
    property(character, 0x1002) as u8
}

/// `UIndicPositionalCategory`
pub fn indic_position(character: u32) -> usize {
    property(character, 0x1016) as usize
}

/// `UIndicSyllabicCategory`
pub fn indic_category(character: u32) -> usize {
    property(character, 0x1017) as usize
}

pub fn is_pictographic(character: u32) -> bool {
    property(character, 64) != 0
}

/// Default ignorable, except for fillers that fonts give a width.
pub fn is_invisible(character: u32) -> bool {
    matches!(character, 0xAD | 0x34F | 0x61C | 0x17B4..=0x17B5 | 0x180B..=0x180F | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x206F
        | 0xFE00..=0xFE0F | 0xFEFF | 0xFFF0..=0xFFF8 | 0x1D173..=0x1D17A | 0xE0000..=0xE0FFF)
}

pub fn mirror(character: u32) -> u32 {
    (host().mirror)(character)
}

/// The second one may be 0.
pub fn decompose(character: u32) -> Option<(u32, u32)> {
    Some((host().decompose)(character))
        .filter(|it| *it != 0)
        .map(|it| (it as u32, (it >> 32) as u32))
}

pub fn compose(first: u32, second: u32) -> Option<u32> {
    Some((host().compose)(first, second)).filter(|it| *it != 0)
}
