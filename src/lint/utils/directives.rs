//! ESLint's `lib/shared/directives.js`.

use super::text::is_js_whitespace;
use bun_core::lexer::char_and_size;

/// Longer ones before their prefixes.
const DIRECTIVES: [&str; 9] = [
    "eslint-disable-next-line",
    "eslint-disable-line",
    "eslint-disable",
    "eslint-enable",
    "eslint-env",
    "eslint",
    "exported",
    "globals",
    "global",
];

/// ESLint's `directivesPattern`. The first group of `directivesPattern.exec(text)`: the directive
/// that `text`, the trimmed value of a comment, starts with. `directivesPattern.test(text)` is
/// `.is_some()`.
pub fn match_directives_pattern(text: &[u8]) -> Option<&'static str> {
    if !matches!(text.first(), Some(b'e' | b'g')) {
        return None;
    }
    DIRECTIVES.into_iter().find(|directive| {
        text.starts_with(directive.as_bytes())
            && match char_and_size(text, directive.len()) {
                (_, 0) => true,
                (c, _) => is_js_whitespace(c as u32),
            }
    })
}
