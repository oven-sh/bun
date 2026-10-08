//! Front matter: Prettier's `src/main/front-matter/parse.js`.

/// `---`, a language, lines, `---`, with ranges in the text that it is at the start of.
#[derive(Copy, Clone, Debug)]
pub(crate) struct FrontMatter {
    /// Where it ends: behind the closing delimiter.
    pub(crate) end: usize,
    /// What is behind the opening delimiter, without the white space around it.
    pub(crate) explicit_language: (usize, usize),
    pub(crate) value: (usize, usize),
}

pub(crate) fn parse(text: &[u8]) -> Option<FrontMatter> {
    let delimiter = text.get(..3).filter(|it| matches!(*it, b"---" | b"+++"))?;
    let first_line_break = 3 + bun_core::strings::index_of_char_usize(&text[3..], b'\n')?;
    let first_line = &text[3..first_line_break];
    let language_start = 3 + (first_line.len() - crate::range::trim_start(first_line).len());
    let language = crate::range::trim_end(crate::range::trim_start(first_line));
    let find = |needle: &[u8]| Some(first_line_break + bun_core::strings::index_of(&text[first_line_break..], needle)?);
    let is_yaml = delimiter == b"---" && matches!(language, b"" | b"yaml");
    let end_delimiter = find(&[b"\n", delimiter].concat()).or_else(|| find(b"\n...").filter(|_| is_yaml))?;
    Some(FrontMatter {
        end: end_delimiter + 4,
        explicit_language: (language_start, language_start + language.len()),
        value: ((first_line_break + 1).min(end_delimiter), end_delimiter),
    })
}
