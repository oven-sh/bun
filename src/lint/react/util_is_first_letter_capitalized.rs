//! `lib/util/isFirstLetterCapitalized.js` of eslint-plugin-react.

use bun_core::strings;
use bun_lint::utils::text;

/// `isFirstLetterCapitalized`. A first character without case counts as capitalized: `_`, `$x`, `1`.
pub(crate) fn is_first_letter_capitalized(word: Option<&[u8]>) -> bool {
    let Some(word) = word.filter(|it| !it.is_empty()) else {
        return false;
    };
    let underscores = word.iter().take_while(|it| **it == b'_').count();
    let (first_letter, size) = strings::wtf8_codepoint_at(word, underscores);
    // For a character outside the BMP, `charAt(0)` is half of a surrogate pair, which has no case.
    first_letter > 0xFFFF
        || word
            .get(underscores..underscores + size)
            .is_some_and(text::is_upper_case)
}
