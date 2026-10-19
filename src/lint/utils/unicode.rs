//! ESLint's `lib/rules/utils/unicode/`.

use crate::regex::Regex;
use std::sync::LazyLock;

static COMBINING: LazyLock<Regex> = LazyLock::new(|| Regex::literal(r"/^\p{M}$/u"));

/// ESLint's `isCombiningCharacter`.
#[inline]
pub fn is_combining_character(c: u32) -> bool {
    c >= 0x300 && matches_code_point(&COMBINING, c)
}

/// ESLint's `isEmojiModifier`.
#[inline]
pub const fn is_emoji_modifier(c: u32) -> bool {
    matches!(c, 0x1F3FB..=0x1F3FF)
}

/// ESLint's `isRegionalIndicatorSymbol`.
#[inline]
pub const fn is_regional_indicator_symbol(c: u32) -> bool {
    matches!(c, 0x1F1E6..=0x1F1FF)
}

/// ESLint's `isSurrogatePair`. `lead` and `tail` are UTF-16 code units.
#[inline]
pub const fn is_surrogate_pair(lead: u32, tail: u32) -> bool {
    matches!(lead, 0xD800..=0xDBFF) && matches!(tail, 0xDC00..=0xDFFF)
}

/// `regex.test(String.fromCodePoint(c))`, where half of a surrogate pair matches nothing.
pub(crate) fn matches_code_point(regex: &Regex, c: u32) -> bool {
    char::from_u32(c).is_some_and(|c| regex.test(c.encode_utf8(&mut [0; 4]).as_bytes()))
}
