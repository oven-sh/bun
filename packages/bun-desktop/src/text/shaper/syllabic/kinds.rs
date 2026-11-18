//! What a character is in a syllable. The letters are those in the patterns.
//!
//! Derived from HarfBuzz and its port harfrust.
//! Copyright (c) HarfBuzz developers, (c) 2020 Yevhenii Reizner. MIT, see `licenses/harfbuzz.txt`.

use crate::unicode::{self, category, joining};

/// In the order in which the parts of a syllable are written.
pub mod place {
    pub const START: u8 = 0;
    pub const REPH: u8 = 1;
    pub const PRE_M: u8 = 2;
    pub const PRE_C: u8 = 3;
    pub const BASE: u8 = 4;
    pub const AFTER_MAIN: u8 = 5;
    pub const BEFORE_SUB: u8 = 7;
    pub const BELOW_C: u8 = 8;
    pub const AFTER_SUB: u8 = 9;
    pub const POST_C: u8 = 11;
    pub const AFTER_POST: u8 = 12;
    pub const SMVD: u8 = 13;
    pub const END: u8 = 14;
}

fn listed(ranges: &[(u32, u32, u8)], character: u32) -> Option<u8> {
    ranges
        .get(ranges.partition_point(|it| it.1 < character))
        .filter(|it| it.0 <= character)
        .map(|it| it.2)
}

/// `side` is one of left, right, above and below.
fn place_of_vowel(character: u32, side: u8) -> u8 {
    use place::{AFTER_MAIN as M, AFTER_POST as P, AFTER_SUB as S, BEFORE_SUB as B};
    let by_script = |places: [u8; 9]| {
        places
            .get((character.wrapping_sub(0x900) >> 7) as usize)
            .map_or(S, |it| *it)
    };
    match side {
        b'e' => place::PRE_M,
        b'o' if matches!(character, 0xC00..=0xC42 | 0xC80..=0xCC2 | 0xCD7..=0xCFF) => B,
        b'o' => by_script([S, P, P, P, P, P, S, S, P]),
        b'a' => by_script([S, S, P, S, M, S, B, B, S]),
        b'b' => by_script([S, S, P, P, S, P, B, B, P]),
        _ => M,
    }
}

/// For the Indic scripts, Khmer and Myanmar.
pub fn indic(character: u32) -> (u8, u8) {
    const BY_CATEGORY: &[u8] = b"xYSPACCcCCMcPpxccsSHjxnNPPMrSxNHSVMV";
    const SIDES: &[u8] = b"-bboeo/oaboaooeb";
    const OTHERWISE: &[(u32, u32, u8)] = &[
        (0x930, 0x930, b'R'),
        (0x953, 0x954, b'S'),
        (0x9B0, 0x9B0, b'R'),
        (0x9F0, 0x9F0, b'R'),
        (0x9FC, 0x9FC, b'P'),
        (0xA30, 0xA30, b'R'),
        (0xA40, 0xA40, b'm'),
        (0xA51, 0xA51, b'M'),
        (0xA72, 0xA73, b'C'),
        (0xAB0, 0xAB0, b'R'),
        (0xAFB, 0xAFB, b'N'),
        (0xB30, 0xB30, b'R'),
        (0xB55, 0xB55, b'N'),
        (0xBB0, 0xBB0, b'R'),
        (0xC30, 0xC30, b'R'),
        (0xC80, 0xC80, b'P'),
        (0xCB0, 0xCB0, b'R'),
        (0xD04, 0xD04, b'P'),
        (0xD30, 0xD30, b'R'),
        (0x1004, 0x1004, b'R'),
        (0x101B, 0x101B, b'R'),
        (0x1032, 0x1032, b'A'),
        (0x1036, 0x1036, b'A'),
        (0x103A, 0x103A, b'Z'),
        (0x103B, 0x103B, b'i'),
        (0x103C, 0x103C, b'u'),
        (0x103D, 0x103D, b'w'),
        (0x103E, 0x103E, b'h'),
        (0x104A, 0x104A, b'P'),
        (0x104E, 0x104E, b'C'),
        (0x105A, 0x105A, b'R'),
        (0x105E, 0x105F, b'i'),
        (0x1060, 0x1060, b'l'),
        (0x1063, 0x1064, b'T'),
        (0x1069, 0x106D, b'T'),
        (0x1082, 0x1082, b'w'),
        (0x1087, 0x108D, b'S'),
        (0x108F, 0x108F, b'S'),
        (0x109A, 0x109C, b'S'),
        (0x179A, 0x179A, b'R'),
        (0x17C6, 0x17C6, b'X'),
        (0x17C7, 0x17C8, b'y'),
        (0x17C9, 0x17CA, b'O'),
        (0x17CB, 0x17CB, b'X'),
        (0x17CC, 0x17CC, b'O'),
        (0x17CD, 0x17D1, b'X'),
        (0x17D3, 0x17D3, b'y'),
        (0x17D9, 0x17D9, b'P'),
        (0x17DD, 0x17DD, b'y'),
        (0x1CE2, 0x1CE8, b'A'),
        (0x1CE9, 0x1CEC, b'Y'),
        (0x1CED, 0x1CED, b'A'),
        (0x1CEE, 0x1CF1, b'Y'),
        (0x2015, 0x2015, b'P'),
        (0x2022, 0x2022, b'P'),
        (0x25CC, 0x25CC, b'D'),
        (0x25FB, 0x25FE, b'P'),
        (0xA8F2, 0xA8F7, b'Y'),
        (0xAA7B, 0xAA7B, b'T'),
        (0xFE00, 0xFE0F, b'v'),
    ];
    let side = SIDES
        .get(unicode::indic_position(character))
        .map_or(b'-', |it| *it);
    let kind = listed(OTHERWISE, character).unwrap_or_else(|| match BY_CATEGORY.get(unicode::indic_category(character)) {
        _ if !matches!(character, ..0x100 | 0x900..0xD80 | 0x1000..0x10A0 | 0x1780..0x1800 | 0x1CD0..0x1D00 | 0x2000..0x20A0
            | 0xA8E0..0xA900 | 0xA9E0..0xAA00 | 0xAA60..0xAA80 | 0x11301..0x11304 | 0x1133B..0x1133D) => b'x',
        Some(b'M') if matches!(character, 0x1000..=0x109F | 0x1780..=0x17FF | 0xA9E0..=0xA9FF | 0xAA60..=0xAA7F) => side,
        Some(b'S') if side == b'-' => b't',
        kind => kind.map_or(b'x', |it| *it),
    });
    let place = match kind {
        b'C' | b's' | b'R' | b'c' | b'V' | b'P' | b'D' => place::BASE,
        _ if character == 0xA51 => place::BELOW_C,
        b'M' | b'm' => place_of_vowel(character, side),
        b'S' if character == 0xB01 => place::BEFORE_SUB,
        b'S' | b't' | b'A' | b'Y' => place::SMVD,
        _ => place::END,
    };
    (kind, place)
}

/// https://learn.microsoft.com/typography/script-development/use
pub fn universal(character: u32, general: u8) -> u8 {
    /// `F`, `D`, `C`, `V` and `S` stand for groups in which the position decides.
    const BY_CATEGORY: &[u8] = b"OOSNSBOFBDCDGRRUFsCIgOnCBhVS8BSHSVVBk";
    const OTHERWISE: &[(u32, u32, u8)] = &[
        (0x5B, 0x5B, b'<'),
        (0x5D, 0x5D, b'>'),
        (0x7B, 0x7B, b'<'),
        (0x7D, 0x7D, b'>'),
        (0x7EB, 0x7F3, b't'),
        (0x7FD, 0x7FD, b't'),
        (0x859, 0x85B, b'5'),
        (0xD41, 0xD42, b'q'),
        (0xDCA, 0xDCA, b'Q'),
        (0xF00, 0xF01, b'B'),
        (0xF04, 0xF06, b'B'),
        (0xF18, 0xF19, b'q'),
        (0xF3E, 0xF3E, b'r'),
        (0xF3F, 0xF3F, b'e'),
        (0xF71, 0xF71, b'5'),
        (0xF72, 0xF72, b'q'),
        (0xF74, 0xF74, b'p'),
        (0xF7A, 0xF7D, b'q'),
        (0xF7F, 0xF7F, b'O'),
        (0xF80, 0xF80, b'q'),
        (0xF86, 0xF87, b't'),
        (0x17CF, 0x17CF, b't'),
        (0x1800, 0x1800, b'B'),
        (0x1880, 0x1884, b'G'),
        (0x1885, 0x1886, b'4'),
        (0x18A9, 0x18A9, b'5'),
        (0x1900, 0x1900, b'B'),
        (0x193A, 0x193A, b't'),
        (0x1A18, 0x1A18, b'p'),
        (0x1A60, 0x1A60, b'K'),
        (0x1A7B, 0x1A7C, b't'),
        (0x1A7F, 0x1A7F, b'u'),
        (0x1B6B, 0x1B73, b'6'),
        (0x1BF2, 0x1BF3, b'k'),
        (0x1CE2, 0x1CE8, b'u'),
        (0x1CED, 0x1CED, b'u'),
        (0x1CF8, 0x1CF9, b't'),
        (0x25CC, 0x25CC, b'B'),
        (0x27E6, 0x27E6, b'<'),
        (0x27E7, 0x27E7, b'>'),
        (0x27E8, 0x27E8, b'<'),
        (0x27E9, 0x27E9, b'>'),
        (0x2D30, 0x2D6F, b'B'),
        (0x2D7F, 0x2D7F, b'H'),
        (0x2E22, 0x2E22, b'<'),
        (0x2E23, 0x2E23, b'>'),
        (0x2E24, 0x2E24, b'<'),
        (0x2E25, 0x2E25, b'>'),
        (0xA9BE, 0xA9BE, b'c'),
        (0xAA29, 0xAA29, b't'),
        (0xAA35, 0xAA35, b'a'),
        (0xAAB0, 0xAAB0, b'q'),
        (0xAAB2, 0xAAB3, b'q'),
        (0xAAB4, 0xAAB4, b'p'),
        (0xAAB7, 0xAAB8, b'q'),
        (0xAABE, 0xAABE, b'q'),
        (0x10570, 0x105BC, b'B'),
        (0x10A0C, 0x10A0C, b'r'),
        (0x10A0D, 0x10A0D, b'u'),
        (0x10A38, 0x10A38, b'5'),
        (0x10AC6, 0x10AC6, b'B'),
        (0x10ACB, 0x10AE3, b'B'),
        (0x10AE5, 0x10AE6, b'5'),
        (0x10D24, 0x10D26, b't'),
        (0x10D27, 0x10D27, b'4'),
        (0x10D30, 0x10D65, b'B'),
        (0x10D69, 0x10D6D, b'p'),
        (0x10D6F, 0x10D85, b'B'),
        (0x10E80, 0x10EA9, b'B'),
        (0x10EAB, 0x10EAC, b'p'),
        (0x10EB0, 0x10EB1, b'B'),
        (0x10F45, 0x10F45, b'B'),
        (0x10F46, 0x10F50, b'u'),
        (0x10F82, 0x10F85, b'5'),
        (0x11127, 0x11129, b'q'),
        (0x1112A, 0x1112B, b'p'),
        (0x1112D, 0x1112D, b'q'),
        (0x11130, 0x11130, b'q'),
        (0x11131, 0x11132, b'p'),
        (0x11134, 0x11134, b'4'),
        (0x111DA, 0x111DA, b'B'),
        (0x11302, 0x11303, b't'),
        (0x114C1, 0x114C1, b't'),
        (0x11942, 0x11942, b'c'),
        (0x11A3A, 0x11A3A, b's'),
        (0x11A3B, 0x11A3E, b'U'),
        (0x13000, 0x1342F, b'E'),
        (0x13430, 0x13436, b'J'),
        (0x13437, 0x13437, b'<'),
        (0x13438, 0x13438, b'>'),
        (0x13439, 0x1343B, b'J'),
        (0x1343C, 0x1343F, b'E'),
        (0x13440, 0x13440, b'T'),
        (0x13441, 0x13446, b'E'),
        (0x13447, 0x13455, b'M'),
        (0x13460, 0x143FA, b'E'),
        (0x16AC0, 0x16AC9, b'B'),
        (0x16B00, 0x16B2F, b'B'),
        (0x16B30, 0x16B36, b't'),
        (0x16D40, 0x16D42, b'v'),
        (0x16D43, 0x16D6A, b'B'),
        (0x16D6B, 0x16D6C, b'r'),
        (0x16D70, 0x16D79, b'B'),
        (0x16F00, 0x16F4A, b'B'),
        (0x16F4F, 0x16F4F, b'5'),
        (0x16F51, 0x16F87, b'q'),
        (0x16F8F, 0x16F92, b'u'),
        (0x16FE4, 0x16FE4, b'B'),
        (0x18B00, 0x18CFF, b'B'),
        (0x1BC00, 0x1BC99, b'B'),
        (0x1BC9D, 0x1BC9E, b'5'),
        (0x1E100, 0x1E12C, b'B'),
        (0x1E130, 0x1E136, b't'),
        (0x1E137, 0x1E2AD, b'B'),
        (0x1E2AE, 0x1E2AE, b't'),
        (0x1E2C0, 0x1E2EB, b'B'),
        (0x1E2EC, 0x1E2EF, b't'),
        (0x1E2F0, 0x1E2F9, b'B'),
        (0x1E4D0, 0x1E4EB, b'B'),
        (0x1E4EC, 0x1E4EF, b'p'),
        (0x1E4F0, 0x1E5ED, b'B'),
        (0x1E5EE, 0x1E5EF, b'q'),
        (0x1E5F0, 0x1E5FA, b'B'),
        (0x1E944, 0x1E94A, b'4'),
        (0x1E94B, 0x1E959, b'B'),
    ];
    if let Some(kind) = listed(OTHERWISE, character) {
        return kind;
    }
    let (syllabic, position) = (
        unicode::indic_category(character),
        unicode::indic_position(character),
    );
    let by_position = |kinds: &[u8; 16]| kinds[position.min(15)];
    let is_mark = matches!(
        general,
        category::NON_SPACING_MARK | category::ENCLOSING_MARK | category::SPACING_MARK
    );
    match BY_CATEGORY.get(syllabic).map_or(b'O', |it| *it) {
        _ if general == category::OTHER_LETTER
            && matches!(syllabic, 1 | 2 | 7 | 11 | 15 | 33 | 34) =>
        {
            b'B'
        }
        b'F' => by_position(b"1222333311111111"),
        b'D' => by_position(b"abbbdcbcaaaaaadd"),
        b'C' => by_position(b"4555445441444444"),
        b'V' => by_position(b"rqqqeeqrpppeepee"),
        b'S' => by_position(b"vuuuwvuvttttttww"),
        b'8' => by_position(b"0999000088888888"),
        b'O' if !matches!(
            unicode::joining_type(character),
            joining::NONE | joining::TRANSPARENT
        ) =>
        {
            b'B'
        }
        b'O' if unicode::is_invisible(character) => {
            if is_mark {
                b'g'
            } else {
                b'W'
            }
        }
        b'O' if general == category::UNASSIGNED => b'W',
        kind => kind,
    }
}
