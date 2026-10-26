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

fn skip_blanks(text: &[u8], at: usize) -> usize {
    let blanks = text[at..]
        .iter()
        .take_while(|byte| byte.is_ascii_whitespace());
    at + blanks.count()
}

// `(function(exports, require, module, __filename, __dirname) {`, with blanks wherever a formatter puts them. Returns where the body starts.
fn find_body_start(text: &[u8], start: usize) -> Option<usize> {
    let take = |at: usize, token: &[u8]| {
        let at = skip_blanks(text, at);
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
    let mut end = text.len();
    loop {
        let before = &text[body_start..end];
        let line_start =
            body_start + strings::last_index_of_char(before, b'\n').map_or(0, |at| at + 1);
        let line = text[line_start..end].trim_ascii();
        if !line.is_empty() && !line.starts_with(b"//") {
            let line_end = line_start + text[line_start..end].trim_ascii_end().len();
            let take = |end: usize, token: u8| {
                let end = body_start + text[body_start..end].trim_ascii_end().len();
                text[body_start..end].ends_with(&[token]).then(|| end - 1)
            };
            let parenthesis = take(take(line_end, b';').unwrap_or(line_end), b')')?;
            return Some(take(parenthesis, b'}')?..line_end);
        }
        end = line_start.checked_sub(1).filter(|&end| end >= body_start)?;
    }
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
            "// @bun @bun-cjs".to_string(),
            String::new(),
        ] {
            assert_eq!(unwrap(&text), text);
        }
    }
}
