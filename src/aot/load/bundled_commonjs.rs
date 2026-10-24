use bun_core::strings;
use std::borrow::Cow;

const PRAGMA: &[u8] = b"// @bun";
const COMMONJS_WORD: &[u8] = b"@bun-cjs";
const WRAPPER_START: &[u8] = b"(function(exports, require, module, __filename, __dirname) {";
const WRAPPER_END: &[u8] = b"})";

fn end_of_line(text: &[u8], start: usize) -> Option<usize> {
    let length = strings::index_of_char_usize(&text[start..], b'\n')?;
    Some(start + length + 1)
}

// Behind the function stand blank lines and comments, such as the one that names a source map.
fn find_wrapper_end(text: &[u8], body_start: usize) -> Option<usize> {
    let mut end = text.len();
    loop {
        let before = &text[body_start..end];
        let line_start =
            body_start + strings::last_index_of_char(before, b'\n').map_or(0, |at| at + 1);
        let line = text[line_start..end].trim_ascii();
        if !line.is_empty() && !line.starts_with(b"//") {
            let line_end = line_start + text[line_start..end].trim_ascii_end().len();
            return line
                .ends_with(WRAPPER_END)
                .then(|| line_end - WRAPPER_END.len());
        }
        end = line_start.checked_sub(1).filter(|&end| end >= body_start)?;
    }
}

fn find_wrapper(text: &[u8]) -> Option<(usize, usize)> {
    let pragma_start = match text.starts_with(b"#!") {
        true => end_of_line(text, 0)?,
        false => 0,
    };
    let start = end_of_line(text, pragma_start)?;
    let pragma = &text[pragma_start..start];
    if !pragma.starts_with(PRAGMA)
        || !strings::contains(pragma, COMMONJS_WORD)
        || !text[start..].starts_with(WRAPPER_START)
    {
        return None;
    }
    Some((start, find_wrapper_end(text, start + WRAPPER_START.len())?))
}

/// `bun build --format=cjs --target=bun` writes the function that the loader calls with the five values of a CommonJS file. What runs is its body: the function around it gives way to blanks, so that every position stays.
pub(super) fn without_commonjs_wrapper(text: Cow<'static, [u8]>) -> Cow<'static, [u8]> {
    let Some((start, end)) = find_wrapper(&text) else {
        return text;
    };
    let mut text = text.into_owned();
    text[start..start + WRAPPER_START.len()].fill(b' ');
    text[end..end + WRAPPER_END.len()].fill(b' ');
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
    fn any_other_text_stays() {
        for text in [
            format!("{START}exports.a = 1;\n}})\n"),
            format!("// @bun\n{START}exports.a = 1;\n}})\n"),
            format!("// @bun @bun-cjs\n{START}exports.a = 1;\n}})()\n"),
            "// @bun @bun-cjs\nexports.a = 1;\n".to_string(),
            format!("// @bun @bun-cjs\n{START}"),
            "// @bun @bun-cjs".to_string(),
            String::new(),
        ] {
            assert_eq!(unwrap(&text), text);
        }
    }
}
