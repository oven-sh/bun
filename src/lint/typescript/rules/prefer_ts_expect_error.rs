use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::text::{lines, trim_start};

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
            let rest = trim_start(value);
            rest.strip_prefix(b"/").unwrap_or(rest)
        }
        _ => {
            let mut rest = trim_start(lines(value).last().unwrap_or(value));
            while let [b'/' | b'*', after @ ..] = rest {
                rest = after;
            }
            rest
        }
    };
    trim_start(rest).starts_with(TS_IGNORE)
}

impl Rule for PreferTsExpectError {
    const META: Meta = Meta::typescript("prefer-ts-expect-error", Kind::Problem)
        .fixable(Fixable::Code)
        .deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        PreferTsExpectError
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !strings::contains(file.text(), TS_IGNORE) {
            return;
        }
        on.finish(|_, cx| {
            for comment in cx.file().comments() {
                if !is_valid_ts_ignore_present(comment) {
                    continue;
                }
                cx.report(comment, PREFER_EXPECT_ERROR_COMMENT).fix(|fixer| {
                    let value = comment.comment_value();
                    let at = strings::index_of(value, TS_IGNORE)?;
                    let is_line_comment = comment.kind() == TokenKind::Line;
                    let open: &[u8] = if is_line_comment { b"//" } else { b"/*" };
                    let close: &[u8] = if is_line_comment { b"" } else { b"*/" };
                    let after = &value[at + TS_IGNORE.len()..];
                    Some(fixer.replace(comment, [open, &value[..at], b"@ts-expect-error", after, close].concat()))
                });
            }
        });
    }
}
