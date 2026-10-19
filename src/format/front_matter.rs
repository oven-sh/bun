//! Front matter, which style sheets, Markdown and HTML can start with: Prettier's
//! `src/main/front-matter/parse.js`.

use crate::highlight::{Language, Spans, Token};

/// `---`, a language, lines, `---`, with ranges in the text that it is at the start of.
#[derive(Copy, Clone, Debug)]
pub(crate) struct FrontMatter {
    /// Where it ends: behind the closing delimiter.
    pub(crate) end: usize,
    /// What is behind the opening delimiter, without the white space around it.
    pub(crate) explicit_language: (usize, usize),
    pub(crate) value: (usize, usize),
}

/// Whether a line of `raw`, which is front matter, has `---` behind white space. Formatted, that can be at the start of the
/// line, where it ends the front matter. Prettier formats it. Here it stays as it is.
pub(crate) fn has_indented_delimiter(raw: &[u8]) -> bool {
    use bun_core::strings;
    strings::contains(raw, b" ---")
        && strings::split(raw, b"\n").skip(1).any(|line| {
            line.starts_with(b" ") && strings::trim_js_whitespace_start(line).starts_with(b"---")
        })
}

/// `text.trimEnd()`, except that it keeps spaces and tabs at the end of the last line. In YAML they can be the end of a
/// block scalar, and so part of a value. Prettier trims them.
pub(crate) fn trim_end_to_last_line(text: &[u8]) -> &[u8] {
    let end = bun_core::strings::trim_js_whitespace_end(text).len();
    let blanks = text[end..]
        .iter()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count();
    &text[..end + blanks]
}

/// A delimiter is exactly three characters: `----` is a thematic break in Markdown. Prettier and oxfmt treat its first
/// three characters as the delimiter, so the fourth dash of a closing line becomes the start of the content after the
/// front matter.
pub(crate) fn parse(text: &[u8]) -> Option<FrontMatter> {
    let delimiter = text.get(..3).filter(|it| matches!(*it, b"---" | b"+++"))?;
    if text.get(3) == Some(&delimiter[0]) {
        return None;
    }
    let first_line_break = 3 + bun_core::strings::index_of_char_usize(&text[3..], b'\n')?;
    let first_line = &text[3..first_line_break];
    let language_start =
        3 + (first_line.len() - bun_core::strings::trim_js_whitespace_start(first_line).len());
    let language = bun_core::strings::trim_js_whitespace_end(
        bun_core::strings::trim_js_whitespace_start(first_line),
    );
    let find = |needle: &[u8; 4]| {
        let mut from = first_line_break;
        loop {
            let at = from + bun_core::strings::index_of(&text[from..], needle)?;
            if text.get(at + 4) != Some(&needle[3]) {
                return Some(at);
            }
            from = at + 4;
        }
    };
    let is_yaml = delimiter == b"---" && matches!(language, b"" | b"yaml");
    let end_delimiter = find(&[b'\n', delimiter[0], delimiter[1], delimiter[2]])
        .or_else(|| find(b"\n...").filter(|_| is_yaml))?;
    Some(FrontMatter {
        end: end_delimiter + 4,
        explicit_language: (language_start, language_start + language.len()),
        value: ((first_line_break + 1).min(end_delimiter), end_delimiter),
    })
}

/// Highlights the front matter of `code`, which starts at `at`. Returns where it ends.
pub(crate) fn highlight(code: &[u8], spans: &mut Spans, at: u32) -> usize {
    let Some(delimiter) = code.get(..3).filter(|it| matches!(*it, b"---" | b"+++")) else {
        return 0;
    };
    let (name, value, end) = match parse(code) {
        Some(it) => (it.explicit_language, it.value, Some(it.end)),
        // It's still being written, unless an empty line follows: then `---` is a thematic break.
        None => {
            let Some(line_end) = bun_core::strings::index_of_char_usize(code, b'\n') else {
                return 0;
            };
            let (first_line, rest) = code.split_at(line_end);
            if first_line.trim_ascii_end() != delimiter || crate::text::has_blank_line(rest) {
                return 0;
            }
            ((3, 3), (line_end + 1, code.len()), None)
        }
    };
    let language = match code.get(name.0..name.1).unwrap_or_default() {
        b"" if delimiter == b"+++" => Language::Toml,
        b"" => Language::Yaml,
        name => match Language::from_name(name) {
            Some(language) => language,
            None => return 0,
        },
    };
    spans.add(at, at + 3, Token::PunctuationSpecial);
    spans.add(at + name.0 as u32, at + name.1 as u32, Token::Label);
    if let Some(value_text) = code.get(value.0..value.1) {
        spans.embed(language, value_text, at + value.0 as u32);
    }
    let Some(end) = end else {
        return code.len();
    };
    let end_in_spans = at + end as u32;
    spans.add(end_in_spans - 3, end_in_spans, Token::PunctuationSpecial);
    end
}
