//! List item markers, shared by the modules that need to recognize them.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ListMarker {
    /// `- `, `* `, `+ `
    Unordered,
    /// `1. `, `1) `. Only a list that starts at 1 can interrupt a paragraph.
    Ordered { starts_at_one: bool },
    /// `1- `, which becomes `1. `.
    LegacyOrdered,
}

/// Returns the marker that `line` starts with, after spaces and tabs. `line` may extend past the end of the line.
pub(super) fn list_marker(line: &[u8]) -> Option<ListMarker> {
    let bytes = &line[line
        .iter()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count()..];
    match bytes.first()? {
        b'-' | b'*' | b'+' if bytes.get(1) == Some(&b' ') => Some(ListMarker::Unordered),
        b'0'..=b'9' => {
            let digits = bytes
                .iter()
                .take_while(|byte| byte.is_ascii_digit())
                .count();
            if bytes.get(digits + 1) != Some(&b' ') {
                return None;
            }
            match bytes[digits] {
                b'.' | b')' => Some(ListMarker::Ordered {
                    starts_at_one: &bytes[..digits] == b"1",
                }),
                b'-' => Some(ListMarker::LegacyOrdered),
                _ => None,
            }
        }
        _ => None,
    }
}

/// True if `word` at the start of a line would start a list, a heading or a quote, so no line may break before it.
/// That's `/^>|^(?:[*+-]|#{1,6}|\d+[).])$/` from Prettier's Markdown printer, plus `1-`.
pub(super) fn is_block_marker_token(word: &[u8]) -> bool {
    match word {
        [b'-' | b'+' | b'*'] | [b'>', ..] => true,
        [b'#', ..] => word.len() <= 6 && word.iter().all(|&byte| byte == b'#'),
        [digits @ .., b'.' | b')' | b'-'] => {
            !digits.is_empty() && digits.iter().all(u8::is_ascii_digit)
        }
        _ => false,
    }
}
