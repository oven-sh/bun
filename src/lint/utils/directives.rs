//! ESLint's `lib/shared/directives.js`.

use bun_core::lexer::char_and_size;

/// Longer names come before their prefixes.
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

/// ESLint's `directivesPattern`. Returns the first group of `directivesPattern.exec(text)`: the
/// directive that `text`, a comment's trimmed value, starts with. `directivesPattern.test(text)` is
/// `.is_some()`.
pub fn match_directives_pattern(text: &[u8]) -> Option<&'static str> {
    if !matches!(text.first(), Some(b'e' | b'g')) {
        return None;
    }
    DIRECTIVES.into_iter().find(|directive| {
        text.starts_with(directive.as_bytes())
            && match char_and_size(text, directive.len()) {
                (_, 0) => true,
                (c, _) => bun_core::strings::is_js_whitespace(c as u32),
            }
    })
}
