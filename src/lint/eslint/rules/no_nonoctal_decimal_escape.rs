use bun_core::strings;
use bun_lint::prelude::*;

/// Disallow `\8` and `\9` escape sequences in string literals.
pub struct NoNonoctalDecimalEscape;

const DECIMAL_ESCAPE: Message =
    Message::new("decimalEscape", "Don't use '{{decimalEscape}}' escape sequence.");
const REFACTOR: Message = Message::new(
    "refactor",
    "Replace '{{original}}' with '{{replacement}}'. This maintains the current functionality.",
);
const ESCAPE_BACKSLASH: Message = Message::new(
    "escapeBackslash",
    "Replace '{{original}}' with '{{replacement}}' to include the actual backslash character.",
);

fn has_decimal_escape(text: &[u8]) -> bool {
    let mut at = 0;
    while let Some(found) = text.get(at..).and_then(|rest| strings::index_of_char_usize(rest, b'\\')) {
        at += found + 1;
        if matches!(text.get(at), Some(b'8' | b'9')) {
            return true;
        }
    }
    false
}

/// `escape`: the `\8` or the `\9`. `follows_null_escape`: a `\0` is directly before it.
fn report(escape: Span, follows_null_escape: bool, cx: &Cx<'_, NoNonoctalDecimalEscape>) {
    let original = cx.slice(escape);
    let digit = cx.slice(escape.shrink(1, 0));
    let report = cx.report(escape, DECIMAL_ESCAPE).data("decimalEscape", original);
    let report = if follows_null_escape {
        // `\08` would be a legacy octal escape.
        let both = Span::new(escape.start - 2, escape.end);
        let null_and_digit = [&b"\\u0000"[..], digit].concat();
        let escaped_digit = [&b"\\u003"[..], digit].concat();
        report
            .suggest_with(
                REFACTOR,
                &[("original", cx.slice(both)), ("replacement", &null_and_digit[..])],
                |fixer| fixer.replace(both, &null_and_digit[..]),
            )
            .suggest_with(
                REFACTOR,
                &[("original", original), ("replacement", &escaped_digit[..])],
                |fixer| fixer.replace(escape, &escaped_digit[..]),
            )
    } else {
        report.suggest_with(
            REFACTOR,
            &[("original", original), ("replacement", digit)],
            |fixer| fixer.replace(escape, digit),
        )
    };
    let escaped_backslash = [&b"\\"[..], original].concat();
    report.suggest_with(
        ESCAPE_BACKSLASH,
        &[("original", original), ("replacement", &escaped_backslash[..])],
        |fixer| fixer.replace(escape, &escaped_backslash[..]),
    );
}

/// `literal`: a string with its quotes.
fn check(literal: Span, cx: &Cx<'_, NoNonoctalDecimalEscape>) {
    let raw = cx.slice(literal);
    let (mut at, mut follows_null_escape) = (0, false);
    while let Some(&byte) = raw.get(at) {
        if byte != b'\\' {
            (at, follows_null_escape) = (at + 1, false);
            continue;
        }
        match raw.get(at + 1) {
            Some(b'8' | b'9') => {
                let start = literal.start + at as u32;
                report(Span::new(start, start + 2), follows_null_escape, cx);
                follows_null_escape = false;
            }
            // oxlint reads no further than a line that is continued.
            Some(b'\n') if cx.language().is_oxlint => return,
            escaped => follows_null_escape = escaped == Some(&b'0'),
        }
        at += 2;
    }
}

impl Rule for NoNonoctalDecimalEscape {
    const META: Meta = Meta::eslint("no-nonoctal-decimal-escape", Kind::Suggestion)
        .has_suggestions()
        .recommended();
    /// Where the strings with such an escape start that are expressions.
    type State<'a> = Vec<u32>;

    fn new(_: &Options) -> Self {
        NoNonoctalDecimalEscape
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Vec<u32> {
        if !has_decimal_escape(file.text()) {
            return Vec::new();
        }
        on.exprs([ExprTag::String], |_, e, cx| {
            if !has_decimal_escape(e.text()) {
                return;
            }
            cx.state.push(e.span().start);
            if !e.is_jsx_text() && !e.is_jsx_tag_name() {
                check(e.span(), cx);
            }
        });
        // The strings that are not expressions: keys, module specifiers, literal types.
        on.finish(|_, cx| {
            cx.state.sort_unstable();
            for token in cx.file().tokens() {
                if token.kind() == TokenKind::String
                    && has_decimal_escape(token.text())
                    && cx.state.binary_search(&token.start()).is_err()
                {
                    check(token.span(), cx);
                }
            }
        });
        Vec::new()
    }
}
