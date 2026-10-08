//! `// prettier-ignore`

use crate::prelude::*;
use crate::write;

/// The source text of `span` as it is. The comments in it count as printed.
pub(crate) struct FormatSuppressedNode(pub(crate) Span);

impl<'a> Format<'a> for FormatSuppressedNode {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let source = f.source_text().text_for(&self.0);
        if bun_core::strings::contains_char(source, b'\r') {
            f.write_built_text(|out| {
                let mut rest = source;
                while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\r') {
                    out.extend_from_slice(&rest[..at]);
                    out.push(b'\n');
                    rest = &rest[at + 1..];
                    rest = rest.strip_prefix(b"\n").unwrap_or(rest);
                }
                out.extend_from_slice(rest);
            });
        } else {
            write!(f, text(source));
        }
        f.comments_mut().skip_comments_before(self.0.end);
    }
}
