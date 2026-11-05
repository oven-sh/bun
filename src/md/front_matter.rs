//! Front matter: the metadata at the start of a document, between two lines
//! of `---` (YAML) or `+++` (TOML). This finds where the block ends. Nothing
//! here reads what is in it.

use bun_core::strings::{self, PathByte};

/// Which blocks count.
#[derive(Copy, Clone)]
pub struct Rule<'a> {
    /// What a fence can be three of.
    pub markers: &'a [u8],
    /// Whether the line behind the opening fence can be blank, as it can for
    /// micromark-extension-frontmatter. If not, `---`, a blank line, text and
    /// `---` stay a thematic break and a heading.
    pub blank_first_line: bool,
}

impl Rule<'_> {
    /// `Bun.markdown`, `bun file.md` and the import of a `.md` file.
    pub const MARKDOWN: Rule<'static> = Rule {
        markers: b"-+",
        blank_first_line: false,
    };
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Block {
    /// `-` or `+`.
    pub marker: u8,
    /// The lines between the fences, with their line breaks.
    pub content: (usize, usize),
    /// Where the line of the closing fence ends, before its line break.
    pub fence_end: usize,
    /// Behind that line break: where the Markdown starts.
    pub end: usize,
}

/// The block that `text` starts with: a line of three equal markers, and the
/// next line that is the same. Spaces and tabs can follow a fence, nothing
/// else can. A line ends with `\n`, `\r\n` or `\r`. `T` is a byte of UTF-8 or
/// Latin-1, or a unit of UTF-16.
pub fn detect<T: PathByte>(text: &[T], rule: Rule<'_>) -> Option<Block> {
    let first = *text.first()?;
    let marker = *rule
        .markers
        .iter()
        .find(|&&marker| T::from_u8(marker) == first)?;
    let blanks = [T::from_u8(b' '), T::from_u8(b'\t')];
    let crlf = [T::from_u8(b'\r'), T::from_u8(b'\n')];
    // Where the line that starts at `from` ends, and where the next one starts.
    let line_at = |from: usize| {
        let rest = &text[from..];
        let Some(len) = strings::index_of_any_t(rest, &crlf) else {
            return (text.len(), text.len());
        };
        let line_break = 1 + usize::from(rest[len..].starts_with(&crlf));
        (from + len, from + len + line_break)
    };
    let is_fence = |line: &[T]| {
        line.starts_with(&[first; 3]) && strings::trim_left_t(&line[3..], &blanks).is_empty()
    };

    let (opening_end, content) = line_at(0);
    if !is_fence(&text[..opening_end]) || opening_end == text.len() {
        return None;
    }
    if !rule.blank_first_line
        && strings::trim_left_t(&text[content..], &blanks)
            .first()
            .is_none_or(|unit| crlf.contains(unit))
    {
        return None;
    }
    let mut start = content;
    loop {
        let (end, next) = line_at(start);
        if is_fence(&text[start..end]) {
            return Some(Block {
                marker,
                content: (content, start),
                fence_end: end,
                end: next,
            });
        }
        if end == text.len() {
            return None;
        }
        start = next;
    }
}
