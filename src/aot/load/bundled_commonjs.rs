//! `bun build --format=cjs --target=bun` writes the function that the loader calls with the five values of a CommonJS file. What runs is its body.

use std::ops::Range;

use bun_core::strings;
use bun_sema::hir::{find_transpiled_mark, is_marked_as_commonjs};

// Up to the last of the five names. Blanks and comments may stand between any two.
const HEAD: [&[u8]; 12] = [
    b"(",
    b"function",
    b"(",
    b"exports",
    b",",
    b"require",
    b",",
    b"module",
    b",",
    b"__filename",
    b",",
    b"__dirname",
];

pub(crate) fn is_bundled_commonjs(text: &[u8]) -> bool {
    find_transpiled_mark(text).is_some_and(|mark| is_marked_as_commonjs(&text[mark]))
}

fn skip_blanks_and_comments(text: &[u8], mut at: usize) -> usize {
    loop {
        let blanks = text[at..]
            .iter()
            .take_while(|byte| byte.is_ascii_whitespace());
        at += blanks.count();
        let rest = &text[at..];
        let comment = if rest.starts_with(b"//") {
            strings::index_of_char_usize(rest, b'\n')
        } else if let Some(inside) = rest.strip_prefix(b"/*") {
            strings::index_of(inside, b"*/").map(|length| length + 4)
        } else {
            return at;
        };
        at += comment.unwrap_or(rest.len());
    }
}

fn take(text: &[u8], at: usize, token: &[u8]) -> Option<usize> {
    let at = skip_blanks_and_comments(text, at);
    text[at..].starts_with(token).then_some(at + token.len())
}

fn find_body_start(text: &[u8], start: usize) -> Option<usize> {
    let names_end = HEAD
        .iter()
        .try_fold(start, |at, token| take(text, at, token))?;
    let list_end = take(text, names_end, b",").unwrap_or(names_end);
    take(text, take(text, list_end, b")")?, b"{")
}

// Behind the function stand blank lines and comments, such as the one that names a source map.
fn trim_blanks_and_comments_at_end(mut text: &[u8]) -> &[u8] {
    loop {
        text = text.trim_ascii_end();
        let line_start = strings::last_index_of_char(text, b'\n').map_or(0, |at| at + 1);
        text = if text.ends_with(b"*/") {
            match strings::last_index_of(text, b"/*") {
                Some(comment_start) => &text[..comment_start],
                None => return text,
            }
        } else if text[line_start..].trim_ascii_start().starts_with(b"//") {
            &text[..line_start]
        } else {
            return text;
        };
    }
}

/// `})` or `});` at the end of `text`, which starts with the body.
fn find_tail(text: &[u8]) -> Option<Range<usize>> {
    let function = trim_blanks_and_comments_at_end(text);
    let statement = function.strip_suffix(b";").unwrap_or(function);
    let parenthesized = trim_blanks_and_comments_at_end(statement).strip_suffix(b")")?;
    let body = trim_blanks_and_comments_at_end(parenthesized).strip_suffix(b"}")?;
    Some(body.len()..function.len())
}

/// The text with blanks in place of the function around the body, so that every position stays. `None`: something else stands behind the mark.
pub(crate) fn blank_commonjs_wrapper(text: &[u8]) -> Option<Vec<u8>> {
    let head_start = find_transpiled_mark(text)?.end;
    let body_start = find_body_start(text, head_start)?;
    let tail = find_tail(&text[body_start..])?;
    let mut blanked = text.to_vec();
    for part in [
        head_start..body_start,
        body_start + tail.start..body_start + tail.end,
    ] {
        for byte in &mut blanked[part] {
            if !byte.is_ascii_whitespace() {
                *byte = b' ';
            }
        }
    }
    Some(blanked)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEAD_TEXT: &str = "(function(exports, require, module, __filename, __dirname) {";

    fn blank(text: &str) -> Option<String> {
        blank_commonjs_wrapper(text.as_bytes()).map(|blanked| String::from_utf8(blanked).unwrap())
    }

    #[test]
    fn body_stays_where_it_is() {
        let blanks = " ".repeat(HEAD_TEXT.len());
        for mark in [
            "// @bun @bun-cjs",
            "// @bun @bytecode @bun-cjs",
            "#!/usr/bin/env bun\n// @bun @bun-cjs",
        ] {
            assert!(is_bundled_commonjs(mark.as_bytes()), "{mark}");
            assert_eq!(
                blank(&format!("{mark}\n{HEAD_TEXT}exports.a = 1;\n}})\n")),
                Some(format!("{mark}\n{blanks}exports.a = 1;\n  \n"))
            );
        }
    }

    #[test]
    fn blanks_and_comments_stand_between_tokens_and_behind_the_function() {
        let blank_all = |text: &str| -> String {
            let blank_one = |character: char| match character.is_ascii_whitespace() {
                true => character,
                false => ' ',
            };
            text.chars().map(blank_one).collect()
        };
        let mark = "// @bun @bun-cjs\n";
        let head = "// a\n( function /* b */ (\n  exports,\n  require,\n  module,\n  __filename,\n  __dirname,\n) {";
        let body = "\n  f(); // c\n";
        let tail = "} /* d */\n) ;";
        let rest = "\n//# sourceMappingURL=a.map\n/* e */\n";
        let (blank_head, blank_tail) = (blank_all(head), blank_all(tail));
        assert_eq!(
            blank(&[mark, head, body, tail, rest].concat()),
            Some([mark, &blank_head[..], body, &blank_tail[..], rest].concat())
        );
    }

    #[test]
    fn anything_else_behind_the_mark_is_left() {
        for text in [
            "// @bun @bun-cjs".to_string(),
            "// @bun @bun-cjs\nexports.a = 1;\n".to_string(),
            "// @bun @bun-cjs\n(function (exports, require) {\n});\n".to_string(),
            "// @bun @bun-cjs\n(function (exports, require, module, __filename, __dirnames) {\n});\n"
                .to_string(),
            format!("// @bun @bun-cjs\n{HEAD_TEXT}"),
            format!("// @bun @bun-cjs\n{HEAD_TEXT}}})()\n"),
            format!("// @bun @bun-cjs\n{HEAD_TEXT}}}) // a\n"),
            "// @bun @bun-cjs\n(/* a".to_string(),
        ] {
            assert_eq!(blank(&text), None, "{text}");
        }
        assert!(!is_bundled_commonjs(b"// @bun\nexport {};"));
    }
}
