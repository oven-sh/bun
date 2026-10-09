//! To which token a comment belongs, as the lexer of oxc decides it (`TriviaBuilder`).

use bun_core::strings;
use bun_lint::prelude::*;

/// `Kind::Eq | Kind::LParen`: `before` ends with the token `=` or `(`.
fn ends_with_eq_or_paren(before: &[u8]) -> bool {
    match *before {
        // The last: `=` after a comment.
        [.., b'('] | [b'='] | [.., b'*', b'/', b'='] => true,
        [.., previous, b'='] => !matches!(
            previous,
            b'=' | b'!'
                | b'<'
                | b'>'
                | b'+'
                | b'-'
                | b'*'
                | b'/'
                | b'%'
                | b'&'
                | b'|'
                | b'^'
                | b'?'
        ),
        _ => false,
    }
}

fn contains_license_or_preserve_comment(content: &[u8]) -> bool {
    strings::contains(content, b"@license") || strings::contains(content, b"@preserve")
}

pub(crate) fn is_jsdoc_content(content: &[u8]) -> bool {
    content.starts_with(b"*") && !content.iter().all(|it| *it == b'*')
}

/// `TriviaBuilder::should_stay_leading`: the comment is about a licence, or one of `@__PURE__` and `@__NO_SIDE_EFFECTS__`.
fn should_stay_leading(comment: Token) -> bool {
    let content = comment.comment_value();
    if content.starts_with(b"!") {
        return true;
    }
    if content.starts_with(b"*") && comment.kind() == TokenKind::Block {
        return is_jsdoc_content(content) && contains_license_or_preserve_comment(content);
    }
    let is_bundler =
        |rest: &[u8], name: &[u8]| matches!(rest.strip_prefix(name), Some([b'A'..=b'Z', ..]));
    let rest = content.trim_ascii_start();
    let annotation = match *rest {
        [] | [b'@'] => return false,
        [b'@', ref rest @ ..] if rest.starts_with(b"vite") => return false,
        [b'@', ref rest @ ..] if rest.starts_with(b"license") || rest.starts_with(b"preserve") => {
            return true;
        }
        [b'@' | b'#', ref rest @ ..] => rest,
        [b'w', ..] if is_bundler(rest, b"webpack") => return false,
        [b't', ..] if is_bundler(rest, b"turbopack") => return false,
        [b'v' | b'c' | b'n' | b'i', ..]
            if [
                &b"v8 ignore"[..],
                b"c8 ignore",
                b"node:coverage",
                b"istanbul ignore",
            ]
            .iter()
            .any(|it| rest.starts_with(it)) =>
        {
            return false;
        }
        _ => return contains_license_or_preserve_comment(content),
    };
    annotation.starts_with(b"__PURE__")
        || annotation.starts_with(b"__NO_SIDE_EFFECTS__")
        || contains_license_or_preserve_comment(content)
}

/// The comments that come before a token, each with where that token starts (`Comment::attached_to`), as oxc's lexer decides it.
/// The others come after the previous token.
pub(crate) fn leading_comments<'a>(file: &'a File<'a>) -> Vec<(Token<'a>, u32)> {
    let text = file.text();
    let mut all: Vec<(Token<'a>, u32)> = Vec::new();
    // `all[pending..]` are after the last token.
    let mut pending = 0;
    // Whether there was a line break since the last token, and whether that token is `=` or `(`.
    let (mut saw_newline, mut follows_eq_or_paren) = (true, false);
    // Where the white space after the previous comment ends.
    let mut next = 0;
    for comment in file.comments().filter(|it| it.kind() != TokenKind::Shebang) {
        let Span { start, end } = comment.span();
        if next != start || start == 0 {
            all.iter_mut().skip(pending).for_each(|it| it.1 = next);
            pending = all.len();
            let before = text.get(..start as usize).unwrap_or_default();
            let token = strings::trim_js_whitespace_end(before);
            saw_newline = token.is_empty()
                || strings::contains_js_line_break(before.get(token.len()..).unwrap_or_default());
            follows_eq_or_paren = ends_with_eq_or_paren(token);
        }
        let after = text.get(end as usize..).unwrap_or_default();
        let white_space = after
            .get(..after.len() - strings::trim_js_whitespace_start(after).len())
            .unwrap_or_default();
        next = end + white_space.len() as u32;
        all.push((comment, 0));
        let is_trailing = if comment.kind() == TokenKind::Line {
            !std::mem::replace(&mut saw_newline, true) && !follows_eq_or_paren
        } else {
            strings::contains_js_line_break(white_space)
                && !std::mem::replace(&mut saw_newline, true)
        };
        if is_trailing && !should_stay_leading(comment) {
            all.truncate(pending);
        }
    }
    all.iter_mut().skip(pending).for_each(|it| it.1 = next);
    all
}
