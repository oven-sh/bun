//! `// prettier-ignore`

use crate::ir::element::TextWidth;
use crate::prelude::*;
use std::borrow::Cow;

/// The source text of `span`, unchanged. The comments in it count as printed.
pub(crate) struct FormatSuppressedNode(pub(crate) Span);

/// In oxfmt any multi-line text breaks the groups around it. In Prettier unformatted code is one string, which breaks
/// nothing.
fn multiline_text_breaks_groups(f: &Formatter<'_>) -> bool {
    f.options().flavor.is_oxfmt()
}

impl<'a> Format<'a> for FormatSuppressedNode {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write_source(self.0, !multiline_text_breaks_groups(f), f);
        f.comments_mut().mark_printed_in(self.0);
    }
}

/// The source text of `span`, which is a template without substitutions. In Prettier its lines are strings with a
/// `literalline` between them, which breaks the groups around it.
pub(crate) struct FormatTemplateText(pub(crate) Span);

impl<'a> Format<'a> for FormatTemplateText {
    fn fmt(&self, f: &mut Formatter<'a>) {
        write_source(self.0, false, f);
    }
}

fn write_source(span: Span, is_single_string: bool, f: &mut Formatter<'_>) {
    let source = f.source_text().text_for(&span);
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
    // In Prettier it's one string, and a line break in a string has no width, so the fit check measures all its lines
    // together.
    let width = match TextWidth::from_text(&text, 0) {
        width if !width.is_multiline() || !is_single_string => width,
        _ => TextWidth::multiline_string(
            bun_core::strings::split(&text, b"\n")
                .map(|line| TextWidth::from_text(line, 0).value())
                .sum(),
        ),
    };
    f.write_text(&text, Some(width));
}
