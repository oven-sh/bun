use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow inline comments after code.
pub struct NoInlineComments {
    ignore_pattern: Option<Regex>,
}

const UNEXPECTED_INLINE_COMMENT: Message = Message::new(
    "unexpectedInlineComment",
    "Unexpected comment inline with code.",
);

/// oxlint's `is_directive_comment`: also `oxlint-disable`, and not `/* global a */` and `/* exported a */`.
fn is_directive_for_oxlint(comment: Token) -> bool {
    let value = strings::trim_js_whitespace(comment.comment_value());
    let after_name = value
        .strip_prefix(b"eslint")
        .or_else(|| value.strip_prefix(b"oxlint"));
    match after_name.and_then(|it| it.first()) {
        Some(b'-') => true,
        Some(b' ' | b'\t') => comment.kind() == TokenKind::Block,
        _ => false,
    }
}

/// `text` up to the last thing on its last line. `None`: that line is blank.
fn up_to_last_on_line(mut text: &[u8]) -> Option<&[u8]> {
    while !text.is_empty() && strings::js_line_break_len_back(text) == 0 {
        match strings::js_whitespace_len_back(text) {
            0 => return Some(text),
            len => text = text.get(..text.len() - len)?,
        }
    }
    None
}

/// `text` from the first thing on its first line. `None`: that line is blank.
fn from_first_on_line(mut text: &[u8]) -> Option<&[u8]> {
    while !text.is_empty() && strings::js_line_break_len(text) == 0 {
        match strings::js_whitespace_len(text) {
            0 => return Some(text),
            len => text = text.get(len..)?,
        }
    }
    None
}

impl NoInlineComments {
    fn test_code_around_comment<'a>(&self, comment: Token<'a>, cx: &mut Cx<'a, Self>) {
        let text = cx.text();
        let head = text.get(..comment.start() as usize).unwrap_or_default();
        let before = up_to_last_on_line(head);
        let after = from_first_on_line(text.get(comment.end() as usize..).unwrap_or_default());
        // For oxlint a byte order mark is something on the first line.
        let is_after_mark = cx.language().is_oxlint
            && cx.file().has_bom()
            && !strings::contains_js_line_break(head);
        if before.is_none() && after.is_none() && !is_after_mark {
            return;
        }
        if self
            .ignore_pattern
            .as_ref()
            .is_some_and(|pattern| pattern.test(comment.comment_value()))
        {
            return;
        }
        let is_only_brace_before = |it: &[u8]| {
            it.strip_suffix(b"{")
                .is_some_and(|it| up_to_last_on_line(it).is_none())
        };
        let is_only_brace_after = |it: &[u8]| {
            it.strip_prefix(b"}")
                .is_some_and(|it| from_first_on_line(it).is_none())
        };
        if before.is_none_or(is_only_brace_before)
            && after.is_none_or(is_only_brace_after)
            && utils::estree_type_at(cx.file(), comment.start()) == "JSXEmptyExpression"
        {
            return;
        }
        let is_directive = match cx.language().is_oxlint {
            true => is_directive_for_oxlint(comment),
            // Both tools' comments count there.
            false if cx.language().stands_alone && is_directive_for_oxlint(comment) => true,
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
