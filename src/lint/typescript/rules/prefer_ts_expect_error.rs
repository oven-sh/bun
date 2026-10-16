use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::oxlint::after_comment_decoration;

/// Enforce using `@ts-expect-error` over `@ts-ignore`.
pub struct PreferTsExpectError;

const PREFER_EXPECT_ERROR_COMMENT: Message = Message::new(
    "preferExpectErrorComment",
    "Use \"@ts-expect-error\" to ensure an error is actually being suppressed.",
);

const TS_IGNORE: &[u8] = b"@ts-ignore";

/// `/^\s*\/?\s*@ts-ignore/` for a line comment, `/^\s*(?:\/|\*)*\s*@ts-ignore/` for the last line of
/// any other.
fn is_valid_ts_ignore_present(comment: Token) -> bool {
    let value = comment.comment_value();
    let rest = match comment.kind() {
        TokenKind::Line => {
            let rest = strings::trim_js_whitespace_start(value);
            rest.strip_prefix(b"/").unwrap_or(rest)
        }
        _ => {
            let mut rest = strings::trim_js_whitespace_start(strings::js_lines(value).last().unwrap_or(value));
            while let [b'/' | b'*', after @ ..] = rest {
                rest = after;
            }
            rest
        }
    };
    strings::trim_js_whitespace_start(rest).starts_with(TS_IGNORE)
}

/// The same for oxlint. Only a `\n` ends a line.
fn is_valid_ts_ignore_present_for_oxlint(comment: Token) -> bool {
    let (value, is_block) = (comment.comment_value(), comment.kind() == TokenKind::Block);
    let mut rest = value;
    if is_block {
        let lines = value.strip_suffix(b"\n").unwrap_or(value);
        rest = strings::last_index_of_char(lines, b'\n').and_then(|at| lines.get(at + 1..)).unwrap_or(lines);
    }
    after_comment_decoration(rest, is_block).starts_with(TS_IGNORE) && comment.kind() != TokenKind::Shebang
}

impl Rule for PreferTsExpectError {
    const META: Meta = Meta::typescript("prefer-ts-expect-error", Kind::Problem)
        .fixable(Fixable::Code)
        .deprecated();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferTsExpectError
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.comments()
            .any(|it| strings::contains(it.text(), TS_IGNORE))
            .then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for comment in cx.file().comments() {
            let is_oxlint = cx.language().is_oxlint;
            if !match is_oxlint {
                true => is_valid_ts_ignore_present_for_oxlint(comment),
                false => is_valid_ts_ignore_present(comment),
            } {
                continue;
            }
            cx.report(comment, PREFER_EXPECT_ERROR_COMMENT).fix(|fixer| {
                let value = comment.comment_value();
                let at = strings::index_of(value, TS_IGNORE)?;
                let is_line_comment = comment.kind() == TokenKind::Line;
                let open: &[u8] = if is_line_comment { b"//" } else { b"/*" };
                let close: &[u8] = if is_line_comment { b"" } else { b"*/" };
                // oxlint changes every one in the comment.
                if is_oxlint {
                    let parts: Vec<&[u8]> = strings::split(value, TS_IGNORE).collect();
                    return Some(fixer.replace(comment, [open, &parts.join(&b"@ts-expect-error"[..]), close].concat()));
                }
                let after = &value[at + TS_IGNORE.len()..];
                Some(fixer.replace(comment, [open, &value[..at], b"@ts-expect-error", after, close].concat()))
            });
        }
    }
}
