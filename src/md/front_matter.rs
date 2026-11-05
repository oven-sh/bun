//! Where front matter ends: the metadata a document starts with, between two `---` (YAML) or `+++` (TOML) lines.

use bun_core::strings::{self, PathByte};

/// Which blocks count.
#[derive(Copy, Clone)]
pub struct Rule<'a> {
    /// What a fence can be three of.
    pub markers: &'a [u8],
    /// micromark-extension-frontmatter takes a blank line behind the opening fence. `Bun.markdown` reads a thematic break.
    pub blank_first_line: bool,
    /// Whether the text can have a CR, which ends a line as LF does. The lines of a text without one are found faster.
    pub carriage_returns: bool,
}

impl Rule<'_> {
    /// `Bun.markdown`, `bun file.md` and the import of a `.md` file.
    pub const MARKDOWN: Rule<'static> = Rule {
        markers: b"-+",
        blank_first_line: false,
        carriage_returns: true,
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

/// The block `text` starts with: a line of three markers (blanks can follow) up to the next such line.
#[inline]
pub fn detect<T: PathByte>(text: &[T], rule: Rule<'_>) -> Option<Block> {
    let first = *text.first()?;
    let marker = *rule
        .markers
        .iter()
        .find(|&&marker| T::from_u8(marker) == first)?;
    let fence = [first; 3];
    let blanks = [T::from_u8(b' '), T::from_u8(b'\t')];
    let crlf = [T::from_u8(b'\r'), T::from_u8(b'\n')];
    // Where the metadata starts, once the opening fence has been read.
    let mut content = None;
    let mut start = 0;
    loop {
        let rest = &text[start..];
        let line_end = match rule.carriage_returns {
            true => strings::index_of_any_t(rest, &crlf),
            false => strings::index_of_scalar(rest, crlf[1]),
        };
        let line = &rest[..line_end.unwrap_or(rest.len())];
        let next = start + line.len() + usize::from(line_end.is_some());
        let next = next + usize::from(rest[line.len()..].starts_with(&crlf));
        let is_fence =
            line.starts_with(&fence) && strings::trim_left_t(&line[3..], &blanks).is_empty();
        match content {
            None if is_fence => content = Some(next),
            None => return None,
            Some(content) if is_fence => {
                return Some(Block {
                    marker,
                    content: (content, start),
                    fence_end: start + line.len(),
                    end: next,
                });
            }
            Some(content) => {
                let is_first = start == content && !rule.blank_first_line;
                if is_first && strings::trim_left_t(line, &blanks).is_empty() {
                    return None;
                }
            }
        }
        // The text ends in a line that is no closing fence.
        line_end?;
        start = next;
    }
}
