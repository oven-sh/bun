use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::string_utils::is_letter;
use bun_lint::utils::{ast_utils, text};
use std::borrow::Cow;

/// Enforce or disallow capitalization of the first letter of a comment.
pub struct CapitalizedComments {
    is_always: bool,
    line: CommentOptions,
    block: CommentOptions,
}

struct CommentOptions {
    ignore_pattern: Option<Regex>,
    ignore_inline_comments: bool,
    ignore_consecutive_comments: bool,
}

impl CommentOptions {
    /// `which`: `"line"` or `"block"`, whose options replace those for both.
    fn new(raw: Object, which: &str) -> CommentOptions {
        let options = match raw.has(which) {
            true => raw.object(which),
            false => raw,
        };
        CommentOptions {
            ignore_pattern: (options.str("ignorePattern").filter(|pattern| !pattern.is_empty()))
                .and_then(|pattern| Regex::new(&format!("^\\s*(?:{pattern})"), "u").ok()),
            ignore_inline_comments: options.bool_or("ignoreInlineComments", false),
            ignore_consecutive_comments: options.bool_or("ignoreConsecutiveComments", false),
        }
    }
}

const UNEXPECTED_LOWERCASE_COMMENT: Message = Message::new(
    "unexpectedLowercaseComment",
    "Comments should not begin with a lowercase character.",
);
const UNEXPECTED_UPPERCASE_COMMENT: Message = Message::new(
    "unexpectedUppercaseComment",
    "Comments should not begin with an uppercase character.",
);

fn without_asterisks(value: &[u8]) -> Cow<'_, [u8]> {
    match strings::contains_char(value, b'*') {
        true => Cow::Owned(value.iter().copied().filter(|&b| b != b'*').collect()),
        false => Cow::Borrowed(value),
    }
}

/// `/^\s*[^:/?#\s]+:\/\/[^?#]/u`, for the value of a comment without its asterisks.
fn is_maybe_url(value: &[u8]) -> bool {
    let mut rest = text::code_points(value)
        .map(|(_, c)| c)
        .filter(|&c| c != u32::from(b'*'))
        .skip_while(|&c| text::is_js_whitespace(c));
    let mut scheme_len = 0;
    let after_scheme = loop {
        match rest.next() {
            Some(c)
                if matches!(u8::try_from(c), Ok(b':' | b'/' | b'?' | b'#'))
                    || text::is_js_whitespace(c) =>
            {
                break c;
            }
            Some(_) => scheme_len += 1,
            None => return false,
        }
    };
    scheme_len > 0
        && after_scheme == u32::from(b':')
        && rest.next() == Some(u32::from(b'/'))
        && rest.next() == Some(u32::from(b'/'))
        && rest.next().is_some_and(|c| !matches!(u8::try_from(c), Ok(b'?' | b'#')))
}

/// It has a token or a comment before it and one after it, on the lines where it starts and ends.
fn is_inline_comment<'a>(file: &'a File<'a>, comment: Token<'a>) -> bool {
    let previous = file.tokens_before(comment).with_comments().next();
    let next = file.tokens_after(comment).with_comments().next();
    previous.is_some_and(|previous| ast_utils::is_token_on_same_line(file, previous, comment))
        && next.is_some_and(|next| ast_utils::is_token_on_same_line(file, comment, next))
}

fn is_consecutive_comment<'a>(file: &'a File<'a>, comment: Token<'a>) -> bool {
    let previous = file.tokens_before(comment).with_comments().next();
    previous.is_some_and(|it| matches!(it.kind(), TokenKind::Block | TokenKind::Line))
}

impl CapitalizedComments {
    fn process_comment<'a>(&self, comment: Token<'a>, cx: &Cx<'a, Self>) {
        let options = match comment.kind() {
            TokenKind::Line => &self.line,
            TokenKind::Block => &self.block,
            _ => return,
        };
        let value = comment.comment_value();
        let mut word_chars =
            text::code_points(value).filter(|&(_, c)| c != u32::from(b'*') && !text::is_js_whitespace(c));
        let Some((at, first)) = word_chars.next() else {
            return;
        };
        if !is_letter(first) {
            return;
        }
        let Some(letter) = value.get(at..at + char::from_u32(first).map_or(1, char::len_utf8)) else {
            return;
        };
        let expected = match self.is_always {
            true => text::to_upper_case(letter),
            false => text::to_lower_case(letter),
        };
        if *expected == *letter
            || ast_utils::matches_comments_ignore_pattern(value)
            || (options.ignore_pattern.as_ref()).is_some_and(|it| it.test(&without_asterisks(value)))
            || options.ignore_inline_comments && is_inline_comment(cx.file(), comment)
            || options.ignore_consecutive_comments && is_consecutive_comment(cx.file(), comment)
            || is_maybe_url(value)
        {
            return;
        }
        let message = match self.is_always {
            true => UNEXPECTED_LOWERCASE_COMMENT,
            false => UNEXPECTED_UPPERCASE_COMMENT,
        };
        // The 2 is the `//` or the `/*`.
        let start = comment.start() + 2 + at as u32;
        cx.report(comment, message)
            .fix(|fixer| fixer.replace(Span::new(start, start + letter.len() as u32), expected));
    }
}

impl Rule for CapitalizedComments {
    const META: Meta = Meta::eslint("capitalized-comments", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let raw = options.object(1);
        CapitalizedComments {
            is_always: options.str(0) != Some("never"),
            line: CommentOptions::new(raw, "line"),
            block: CommentOptions::new(raw, "block"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|rule, cx| {
            for comment in cx.file().comments() {
                rule.process_comment(comment, cx);
            }
        });
    }
}
