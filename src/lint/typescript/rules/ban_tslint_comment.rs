use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow `// tslint:<rule-flag>` comments.
pub struct BanTslintComment;

const COMMENT_DETECTED: Message =
    Message::new("commentDetected", "tslint comment detected: \"{{ text }}\"");

/// `/^\s*tslint:(enable|disable)(?:-(line|next-line))?(:|\s|$)/`
fn is_enable_disable(value: &[u8]) -> bool {
    let Some(rest) = strings::trim_js_whitespace_start(value).strip_prefix(b"tslint:") else {
        return false;
    };
    let Some(rest) = rest.strip_prefix(b"enable").or_else(|| rest.strip_prefix(b"disable")) else {
        return false;
    };
    let rest = rest
        .strip_prefix(b"-line")
        .or_else(|| rest.strip_prefix(b"-next-line"))
        .unwrap_or(rest);
    match strings::wtf8_first_codepoint(rest) {
        None => true,
        Some(c) => c == u32::from(b':') || strings::is_js_whitespace(c),
    }
}

fn to_text(comment: Token) -> Vec<u8> {
    let value = strings::trim_js_whitespace(comment.comment_value());
    let mut text = Vec::with_capacity(value.len() + 6);
    if comment.kind() == TokenKind::Line {
        text.extend_from_slice(b"// ");
        text.extend_from_slice(value);
    } else {
        text.extend_from_slice(b"/* ");
        text.extend_from_slice(value);
        text.extend_from_slice(b" */");
    }
    text
}

impl Rule for BanTslintComment {
    const META: Meta = Meta::typescript("ban-tslint-comment", Kind::Suggestion)
        .fixable(Fixable::Code)
        .presets(Presets::STYLISTIC);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BanTslintComment
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !file.comments().any(|it| strings::contains(it.text(), b"tslint:")) {
            return None;
        }
        Some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for comment in cx.file().comments() {
            if !is_enable_disable(comment.comment_value()) {
                continue;
            }
            // oxlint has what is in the comment, and points at the comment with the line break right after it, which is
            // also what it removes.
            if cx.language().is_oxlint {
                let has_line_break = cx.text().get(comment.end() as usize) == Some(&b'\n');
                let full_comment = Span::new(comment.start(), comment.end() + u32::from(has_line_break));
                cx.report(full_comment, COMMENT_DETECTED)
                    .data("text", strings::trim_js_whitespace(comment.comment_value()))
                    .fix(|fixer| fixer.remove(full_comment));
                continue;
            }
            cx.report(comment, COMMENT_DETECTED).data("text", to_text(comment)).fix(|fixer| {
                let file = fixer.file();
                let (start, end) = (file.position(comment.start()), file.position(comment.end()));
                let range_start = file.offset(Position {
                    line: start.line,
                    column: start.column.saturating_sub(1),
                });
                // With the character after it. One more than the end, also at the end of the text.
                let range_end = file.offset(end);
                let after = strings::wtf8_codepoint_at(file.text(), range_end as usize).1.max(1);
                fixer.remove(Span::new(range_start, range_end + after as u32))
            });
        }
    }
}
