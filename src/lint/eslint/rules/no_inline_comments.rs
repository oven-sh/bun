use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow inline comments after code.
pub struct NoInlineComments {
    ignore_pattern: Option<Regex>,
}

const UNEXPECTED_INLINE_COMMENT: Message =
    Message::new("unexpectedInlineComment", "Unexpected comment inline with code.");

/// oxlint's `is_directive_comment`: also `oxlint-disable`, and not `/* global a */` and `/* exported a */`.
fn is_directive_for_oxlint(comment: Token) -> bool {
    let value = strings::trim_js_whitespace(comment.comment_value());
    let after_name = value.strip_prefix(b"eslint").or_else(|| value.strip_prefix(b"oxlint"));
    match after_name.and_then(|it| it.first()) {
        Some(b'-') => true,
        Some(b' ' | b'\t') => comment.kind() == TokenKind::Block,
        _ => false,
    }
}

impl NoInlineComments {
    fn test_code_around_comment<'a>(&self, comment: Token<'a>, cx: &mut Cx<'a, Self>) {
        let start_line = cx.line_span(cx.line_of(comment.start()));
        let end_line = cx.line_span(cx.line_of(comment.end()));
        let preamble = strings::trim_js_whitespace(cx.slice(Span::new(start_line.start, comment.start())));
        let postamble = strings::trim_js_whitespace(cx.slice(Span::new(comment.end(), end_line.end)));
        if preamble.is_empty() && postamble.is_empty() {
            return;
        }
        if self.ignore_pattern.as_ref().is_some_and(|pattern| pattern.test(comment.comment_value())) {
            return;
        }
        if (preamble.is_empty() || preamble == b"{")
            && (postamble.is_empty() || postamble == b"}")
            && utils::estree_type_at(cx.file(), comment.start()) == "JSXEmptyExpression"
        {
            return;
        }
        let is_directive = match cx.language().is_oxlint {
            true => is_directive_for_oxlint(comment),
            false => ast_utils::is_directive_comment(&comment),
        };
        if is_directive {
            return;
        }
        cx.report(comment, UNEXPECTED_INLINE_COMMENT);
    }
}

impl Rule for NoInlineComments {
    const META: Meta = Meta::eslint("no-inline-comments", Kind::Suggestion);
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoInlineComments {
            ignore_pattern: match object.str("ignorePattern") {
                Some("") => None,
                _ => object.regex("ignorePattern", "u"),
            },
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for comment in cx.file().comments() {
            if comment.kind() != TokenKind::Shebang {
                self.test_code_around_comment(comment, cx);
            }
        }
    }
}
