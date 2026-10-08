use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::text::{first_code_point, is_js_whitespace, trim, trim_start};

/// Disallow `// tslint:<rule-flag>` comments.
pub struct BanTslintComment;

const COMMENT_DETECTED: Message =
    Message::new("commentDetected", "tslint comment detected: \"{{ text }}\"");

/// `/^\s*tslint:(enable|disable)(?:-(line|next-line))?(:|\s|$)/`
fn is_enable_disable(value: &[u8]) -> bool {
    let Some(rest) = trim_start(value).strip_prefix(b"tslint:") else {
        return false;
    };
    let Some(rest) = rest.strip_prefix(b"enable").or_else(|| rest.strip_prefix(b"disable")) else {
        return false;
    };
    let rest = rest
        .strip_prefix(b"-line")
        .or_else(|| rest.strip_prefix(b"-next-line"))
        .unwrap_or(rest);
    match first_code_point(rest) {
        None => true,
        Some(c) => c == u32::from(b':') || is_js_whitespace(c),
    }
}

fn to_text(comment: Token) -> Vec<u8> {
    let value = trim(comment.comment_value());
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
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        BanTslintComment
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.comments().any(|it| strings::contains(it.text(), b"tslint:")) {
            return;
        }
        on.finish(|_, cx| {
            for comment in cx.file().comments() {
                if !is_enable_disable(comment.comment_value()) {
                    continue;
                }
                cx.report(comment, COMMENT_DETECTED).data("text", to_text(comment)).fix(|fixer| {
                    let file = fixer.file();
                    let (start, end) = (file.position(comment.start()), file.position(comment.end()));
                    let range_start = file.offset(Position {
                        line: start.line,
                        column: start.column.saturating_sub(1),
                    });
                    // One more than the end, also at the end of the text.
                    fixer.remove(Span::new(range_start, file.offset(end) + 1))
                });
            }
        });
    }
}
