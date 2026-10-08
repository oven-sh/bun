//! `// prettier-ignore`

use crate::ir::element::TextWidth;
use crate::prelude::*;
use std::borrow::Cow;

/// The source text of `span` as it is. The comments in it count as printed.
pub(crate) struct FormatSuppressedNode(pub(crate) Span);

impl<'a> Format<'a> for FormatSuppressedNode {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let source = f.source_text().text_for(&self.0);
        let text = match bun_core::strings::contains_char(source, b'\r') {
            false => Cow::Borrowed(source),
            true => {
                let mut text = Vec::with_capacity(source.len());
                let mut rest = source;
                while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\r') {
                    text.extend_from_slice(&rest[..at]);
                    text.push(b'\n');
                    rest = &rest[at + 1..];
                    rest = rest.strip_prefix(b"\n").unwrap_or(rest);
                }
                text.extend_from_slice(rest);
                Cow::Owned(text)
            }
        };
        // For Prettier it is one string, and a line break in a string has no width: whether it fits is
        // asked of all its lines together.
        let width = match TextWidth::from_text(&text, 0) {
            width if !width.is_multiline() => width,
            _ => TextWidth::multiline(
                bun_core::strings::split(&text, b"\n").map(|line| TextWidth::from_text(line, 0).value()).sum(),
            ),
        };
        f.write_text(&text, Some(width));
        f.comments_mut().skip_comments_before(self.0.end);
    }
}
