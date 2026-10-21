//! Front matter at the start of style sheets, Markdown and HTML: Prettier's `src/main/front-matter/parse.js`.

/// `---`, a language, lines, `---`. The ranges are offsets into the text that starts with it.
#[derive(Copy, Clone, Debug)]
pub(crate) struct FrontMatter {
    /// The offset just after the closing delimiter.
    pub(crate) end: usize,
    /// The text after the opening delimiter, with surrounding whitespace trimmed.
    pub(crate) explicit_language: (usize, usize),
    pub(crate) value: (usize, usize),
}

/// True if a line of the front matter `raw` has `---` after whitespace. Formatting could move that `---` to the start
/// of the line, where it would end the front matter. Prettier formats it anyway. Here it's kept verbatim.
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
    let spaces_and_tabs = text[end..]
        .iter()
        .take_while(|byte| matches!(byte, b' ' | b'\t'))
        .count();
    &text[..end + spaces_and_tabs]
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
