use bun_core::strings;
use bun_sema::hir::{find_transpiled_mark, is_marked_as_commonjs};
use std::borrow::Cow;
use std::ops::Range;

// The names of the five values, in the order in which the loader passes them.
const PARAMETERS: [&[u8]; 5] = [
    b"exports",
    b"require",
    b"module",
    b"__filename",
    b"__dirname",
];

// Blanks and comments.
fn skip_trivia(text: &[u8], mut at: usize) -> usize {
    loop {
        let blanks = text[at..]
            .iter()
            .take_while(|byte| byte.is_ascii_whitespace());
        at += blanks.count();
        let rest = &text[at..];
        at += if rest.starts_with(b"//") {
            strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len())
        } else if let Some(comment) = rest.strip_prefix(b"/*") {
            match strings::index_of(comment, b"*/") {
                Some(length) => length + 4,
                None => return at,
            }
        } else {
            return at;
        };
    }
}

// The same from the end of `text[start..end]`: blanks, `/* .. */`, and lines that hold a `//` comment alone.
fn skip_trivia_backwards(text: &[u8], start: usize, mut end: usize) -> usize {
    loop {
        end = start + text[start..end].trim_ascii_end().len();
        let before = &text[start..end];
        if before.ends_with(b"*/") {
            let Some(comment) = strings::last_index_of(before, b"/*") else {
                return end;
            };
            end = start + comment;
            continue;
        }
        let line_start = strings::last_index_of_char(before, b'\n').map_or(0, |at| at + 1);
        if !before[line_start..].trim_ascii_start().starts_with(b"//") {
            return end;
        }
        end = start + line_start;
    }
}

// `(function(exports, require, module, __filename, __dirname) {`, with blanks and comments between its tokens. Returns where the body starts.
fn find_body_start(text: &[u8], start: usize) -> Option<usize> {
    let take = |at: usize, token: &[u8]| {
        let at = skip_trivia(text, at);
        text[at..].starts_with(token).then_some(at + token.len())
    };
    let mut at = take(start, b"(")?;
    at = take(at, b"function")?;
    at = take(at, b"(")?;
    for (index, name) in PARAMETERS.into_iter().enumerate() {
        if index > 0 {
            at = take(at, b",")?;
        }
        at = take(at, name)?;
    }
    at = take(at, b",").unwrap_or(at);
    at = take(at, b")")?;
    take(at, b"{")
}

// `})` or `});`. Behind the function stand blank lines and comments, such as the one that names a source map.
fn find_wrapper_end(text: &[u8], body_start: usize) -> Option<Range<usize>> {
    let take = |end: usize, token: u8| {
        let end = skip_trivia_backwards(text, body_start, end);
        text[body_start..end].ends_with(&[token]).then(|| end - 1)
    };
    let end = skip_trivia_backwards(text, body_start, text.len());
    let parenthesis = take(take(end, b';').unwrap_or(end), b')')?;
    Some(take(parenthesis, b'}')?..end)
}

fn find_wrapper(text: &[u8]) -> Option<(Range<usize>, Range<usize>)> {
    let mark = find_transpiled_mark(text)?;
    let start = mark.end;
    if !is_marked_as_commonjs(&text[mark]) {
        return None;
    }
    let body_start = find_body_start(text, start)?;
    Some((start..body_start, find_wrapper_end(text, body_start)?))
}

/// `bun build --format=cjs --target=bun` writes the function that the loader calls with the five values of a CommonJS file. What runs is its body: the function around it gives way to blanks, so that every position stays.
pub(super) fn without_commonjs_wrapper(text: Cow<'static, [u8]>) -> Cow<'static, [u8]> {
    let Some((start, end)) = find_wrapper(&text) else {
        return text;
    };
    let mut text = text.into_owned();
    for part in [start, end] {
        for byte in &mut text[part] {
            if !byte.is_ascii_whitespace() {
                *byte = b' ';
            }
        }
    }
    Cow::Owned(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn unwrap(text: &str) -> String {
        String::from_utf8(
            without_commonjs_wrapper(Cow::Owned(text.as_bytes().to_vec())).into_owned(),
        )
        .unwrap()
    }

    const START: &str = "(function(exports, require, module, __filename, __dirname) {";

    #[test]
    fn the_function_gives_way_to_blanks() {
        let blanks = " ".repeat(START.len());
        for pragma in [
            "// @bun @bun-cjs",
            "// @bun @bytecode @bun-cjs",
            "#!/usr/bin/env bun\n// @bun @bun-cjs",
        ] {
            for behind in ["", "\n", "\n\n//# sourceMappingURL=a.js.map\n", "\r\n"] {
                assert_eq!(
                    unwrap(&format!(
                        "{pragma}\n{START}exports.a = 1;\nf(function () {{}})\n}}){behind}"
                    )),
                    format!("{pragma}\n{blanks}exports.a = 1;\nf(function () {{}})\n  {behind}")
                );
            }
        }
    }

    #[test]
    fn the_function_gives_way_however_it_is_formatted() {
        assert_eq!(
            unwrap(
                "// @bun @bun-cjs\n(function (exports, require, module, __filename, __dirname) {\n  exports.a = 1;\n});\n"
            ),
            format!(
                "// @bun @bun-cjs\n{}\n  exports.a = 1;\n   \n",
                " ".repeat(61)
            )
        );
        assert_eq!(
            unwrap(
                "// @bun @bun-cjs\n(function (\n  exports,\n  require,\n  module,\n  __filename,\n  __dirname,\n) {\n  exports.a = 1;\n}\n)\n"
            ),
            format!(
                "// @bun @bun-cjs\n{}\n  exports.a = 1;\n \n \n",
                [11, 10, 10, 9, 13, 12, 3]
                    .map(|width| " ".repeat(width))
                    .join("\n")
            )
        );
    }

    #[test]
    fn comments_between_the_tokens_of_the_function_give_way_with_it() {
        assert_eq!(
            unwrap(
                "// @bun @bun-cjs\n// a\n/* b */ (function /* c */ (exports, require, module, __filename, /* d */ __dirname) /* e */ {\n  exports.a = 1; // f\n} /* g */\n// h\n) /* i */ ; /* j */\n// k\n"
            ),
            format!(
                "// @bun @bun-cjs\n{}\n{}\n  exports.a = 1; // f\n{}\n{}\n{} /* j */\n// k\n",
                " ".repeat(4),
                " ".repeat(93),
                " ".repeat(9),
                " ".repeat(4),
                " ".repeat(11)
            )
        );
        assert_eq!(
            unwrap(
                "// @bun @bun-cjs\n(/**/function/*/ */(exports, require, module, __filename, __dirname) {\n} /*/ )"
            ),
            format!(
                "// @bun @bun-cjs\n{}\n{}",
                " ".repeat(START.len() + 10),
                " ".repeat(7)
            )
        );
    }

    #[test]
    fn any_other_text_stays() {
        for text in [
            format!("{START}exports.a = 1;\n}})\n"),
            format!("// @bun\n{START}exports.a = 1;\n}})\n"),
            format!("// @bun @bun-cjs\n{START}exports.a = 1;\n}})()\n"),
            "// @bun @bun-cjs\nexports.a = 1;\n".to_string(),
            "// @bun @bun-cjs\n(function (exports, require) {\n  exports.a = 1;\n});\n".to_string(),
            "// @bun @bun-cjs\n(function (exports, require, module, __filename, __dirnames) {\n});\n"
                .to_string(),
            format!("// @bun @bun-cjs\n{START}"),
            "// @bun @bun-cjs\n(function /* (exports, require, module, __filename, __dirname) {\n})"
                .to_string(),
            "// @bun @bun-cjs\n(/* a */".to_string(),
            "// @bun @bun-cjs\n(/*".to_string(),
            format!("// @bun @bun-cjs\n{START}\n}} */ )"),
            format!("// @bun @bun-cjs\n{START}/* a */)"),
            "// @bun @bun-cjs".to_string(),
            String::new(),
        ] {
            assert_eq!(unwrap(&text), text);
        }
    }
}
