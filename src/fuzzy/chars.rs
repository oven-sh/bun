//! Byte classification and position-dependent bonuses.
//!
//! Mirrors fzf `src/algo/algo.go`: `charClass` and `bonusFor`. This crate is
//! byte-oriented (file names), so classification is ASCII-only; bytes >= 0x80
//! are treated as plain word bytes ("Letter") instead of being decoded as
//! Unicode the way fzf does. That keeps non-ASCII names neutral (no boundary
//! inflation) without pulling in Unicode tables.

use crate::score::{BONUS_BOUNDARY, BONUS_CAMEL123, BONUS_NON_WORD};

/// fzf `charClass`. The discriminant ORDER is load-bearing: `bonus_for` tests
/// `class > NonWord` to mean "delimiter or word-like", exactly as fzf does.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u8)]
pub(crate) enum CharClass {
    White = 0,
    NonWord = 1,
    Delimiter = 2,
    Lower = 3,
    Upper = 4,
    Letter = 5,
    Number = 6,
}

pub(crate) const NUM_CLASSES: usize = 7;

const ALL_CLASSES: [CharClass; NUM_CLASSES] = [
    CharClass::White,
    CharClass::NonWord,
    CharClass::Delimiter,
    CharClass::Lower,
    CharClass::Upper,
    CharClass::Letter,
    CharClass::Number,
];

/// fzf `whiteChars`, restricted to its ASCII members (`" \t\n\v\f\r"`).
const WHITESPACE: &[u8] = b" \t\n\x0b\x0c\r";

/// fzf `delimiterChars` in the default scheme.
const DEFAULT_DELIMITERS: &[u8] = b"/,:;|";

/// fzf `Init("path")` narrows the delimiter set to the path separator. The
/// index stores `/`-separated paths on every platform (design contract), so
/// `\\` is never a separator here.
const PATH_DELIMITERS: &[u8] = b"/";

/// Per-byte class lookup table for one scheme.
pub(crate) fn class_table(path_mode: bool) -> [CharClass; 256] {
    let delimiters = if path_mode {
        PATH_DELIMITERS
    } else {
        DEFAULT_DELIMITERS
    };
    let mut table = [CharClass::NonWord; 256];
    for (b, slot) in table.iter_mut().enumerate() {
        let byte = b as u8;
        *slot = if byte.is_ascii_lowercase() {
            CharClass::Lower
        } else if byte.is_ascii_uppercase() {
            CharClass::Upper
        } else if byte.is_ascii_digit() {
            CharClass::Number
        } else if WHITESPACE.contains(&byte) {
            CharClass::White
        } else if delimiters.contains(&byte) {
            CharClass::Delimiter
        } else if byte >= 0x80 {
            CharClass::Letter
        } else {
            CharClass::NonWord
        };
    }
    table
}

/// fzf `bonusFor(prevClass, class)`, with the scheme-dependent boundary
/// bonuses (`bonusBoundaryWhite`, `bonusBoundaryDelimiter`) passed in because
/// fzf resolves them at `Init(scheme)` time.
fn bonus_for(prev: CharClass, cur: CharClass, boundary_white: i64, boundary_delimiter: i64) -> i64 {
    if cur > CharClass::NonWord {
        match prev {
            CharClass::White => return boundary_white,
            CharClass::Delimiter => return boundary_delimiter,
            CharClass::NonWord => return BONUS_BOUNDARY,
            _ => {}
        }
    }
    if (prev == CharClass::Lower && cur == CharClass::Upper)
        || (prev != CharClass::Number && cur == CharClass::Number)
    {
        return BONUS_CAMEL123;
    }
    match cur {
        CharClass::NonWord | CharClass::Delimiter => BONUS_NON_WORD,
        CharClass::White => boundary_white,
        _ => 0,
    }
}

/// Precomputed `bonus_for` over every (prev, cur) class pair.
pub(crate) fn bonus_table(
    boundary_white: i64,
    boundary_delimiter: i64,
) -> [[i64; NUM_CLASSES]; NUM_CLASSES] {
    let mut table = [[0i64; NUM_CLASSES]; NUM_CLASSES];
    for prev in ALL_CLASSES {
        for cur in ALL_CLASSES {
            table[prev as usize][cur as usize] =
                bonus_for(prev, cur, boundary_white, boundary_delimiter);
        }
    }
    table
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::score::{
        BONUS_BOUNDARY_DELIMITER, BONUS_BOUNDARY_WHITE_DEFAULT, BONUS_BOUNDARY_WHITE_PATH,
    };

    #[test]
    fn classification_path_mode() {
        let t = class_table(true);
        let cases: &[(u8, CharClass)] = &[
            (b'a', CharClass::Lower),
            (b'z', CharClass::Lower),
            (b'A', CharClass::Upper),
            (b'Z', CharClass::Upper),
            (b'0', CharClass::Number),
            (b'9', CharClass::Number),
            (b' ', CharClass::White),
            (b'\t', CharClass::White),
            (b'\r', CharClass::White),
            (b'\n', CharClass::White),
            (b'/', CharClass::Delimiter),
            // Not delimiters in the path scheme.
            (b',', CharClass::NonWord),
            (b':', CharClass::NonWord),
            (b';', CharClass::NonWord),
            (b'|', CharClass::NonWord),
            (b'_', CharClass::NonWord),
            (b'-', CharClass::NonWord),
            (b'.', CharClass::NonWord),
            (0x00, CharClass::NonWord),
            (0x7f, CharClass::NonWord),
            (0x80, CharClass::Letter),
            (0xff, CharClass::Letter),
        ];
        for &(byte, class) in cases {
            assert_eq!(t[byte as usize], class, "byte {byte:#04x}");
        }
    }

    #[test]
    fn classification_default_mode() {
        let t = class_table(false);
        for byte in *b"/,:;|" {
            assert_eq!(t[byte as usize], CharClass::Delimiter, "byte {byte:#04x}");
        }
        assert_eq!(t[b'-' as usize], CharClass::NonWord);
    }

    #[test]
    fn bonus_for_matches_fzf_semantics() {
        let bw = BONUS_BOUNDARY_WHITE_DEFAULT;
        let bd = BONUS_BOUNDARY_DELIMITER;
        let cases: &[(CharClass, CharClass, i64)] = &[
            // Word char after a boundary.
            (CharClass::White, CharClass::Lower, bw),
            (CharClass::Delimiter, CharClass::Lower, bd),
            (CharClass::NonWord, CharClass::Lower, BONUS_BOUNDARY),
            (CharClass::White, CharClass::Upper, bw),
            (CharClass::White, CharClass::Number, bw),
            // A delimiter is itself "class > NonWord" in fzf, so it also gets
            // the boundary bonus when preceded by whitespace.
            (CharClass::White, CharClass::Delimiter, bw),
            // camelCase and digit transitions.
            (CharClass::Lower, CharClass::Upper, BONUS_CAMEL123),
            (CharClass::Lower, CharClass::Number, BONUS_CAMEL123),
            (CharClass::Upper, CharClass::Number, BONUS_CAMEL123),
            (CharClass::Number, CharClass::Number, 0),
            // Non-word target bytes.
            (CharClass::Lower, CharClass::NonWord, BONUS_NON_WORD),
            (CharClass::Lower, CharClass::Delimiter, BONUS_NON_WORD),
            (CharClass::Lower, CharClass::White, bw),
            // No bonus inside a word.
            (CharClass::Lower, CharClass::Lower, 0),
            (CharClass::Upper, CharClass::Upper, 0),
            (CharClass::Upper, CharClass::Lower, 0),
            (CharClass::Letter, CharClass::Letter, 0),
        ];
        for &(prev, cur, want) in cases {
            assert_eq!(bonus_for(prev, cur, bw, bd), want, "{prev:?} -> {cur:?}");
        }
    }

    #[test]
    fn bonus_table_matches_function() {
        for (bw, bd) in [
            (BONUS_BOUNDARY_WHITE_DEFAULT, BONUS_BOUNDARY_DELIMITER),
            (BONUS_BOUNDARY_WHITE_PATH, BONUS_BOUNDARY_DELIMITER),
        ] {
            let t = bonus_table(bw, bd);
            for prev in ALL_CLASSES {
                for cur in ALL_CLASSES {
                    assert_eq!(t[prev as usize][cur as usize], bonus_for(prev, cur, bw, bd));
                }
            }
        }
    }
}
