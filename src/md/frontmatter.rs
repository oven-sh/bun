//! Structural front-matter detection: `---` (YAML) and `+++` (TOML) fences.
//!
//! Detection never parses the metadata — the same purely structural rule
//! pulldown-cmark, comrak, goldmark and markdown-it use — so renderers can
//! skip a block without touching a YAML/TOML parser. `Bun.markdown.frontmatter`
//! is the one consumer that parses what `detect` finds.

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Lang {
    /// `---` fences. Fenced JSON parses through YAML (JSON is valid YAML).
    Yaml,
    /// `+++` fences (Hugo, Zola).
    Toml,
}

pub struct Block {
    pub lang: Lang,
    /// Offset of the opening fence: 3 when a UTF-8 BOM precedes it, else 0.
    pub start: usize,
    /// The metadata text between the fences.
    pub meta: core::ops::Range<usize>,
    /// Offset of the first byte after the block (start of the body).
    pub body_start: usize,
}

/// True when a fence (exactly three `marker` bytes) starts at `pos`.
fn is_fence_at(input: &[u8], pos: usize, marker: u8) -> bool {
    input.len() >= pos + 3
        && input[pos] == marker
        && input[pos + 1] == marker
        && input[pos + 2] == marker
}

/// Consume spaces/tabs, an optional `\r`, then `\n` or EOF after a fence's
/// three marker bytes; None when the line carries other content
/// (`----`, `--- text`, and YAML's `...` document-end marker never close).
fn fence_line_end(input: &[u8], mut i: usize) -> Option<usize> {
    while i < input.len() && (input[i] == b' ' || input[i] == b'\t') {
        i += 1;
    }
    if i < input.len() && input[i] == b'\r' {
        i += 1;
    }
    match input.get(i) {
        None => Some(i),
        Some(b'\n') => Some(i + 1),
        Some(_) => None,
    }
}

/// True when the line starting at `i` has no content (spaces/tabs only).
fn line_is_blank(input: &[u8], mut i: usize) -> bool {
    while i < input.len() && (input[i] == b' ' || input[i] == b'\t' || input[i] == b'\r') {
        i += 1;
    }
    i >= input.len() || input[i] == b'\n'
}

/// Find a front-matter block at the very start of `input`, allowing a
/// UTF-8 BOM (`fs.readFileSync(path, "utf8")` keeps BOMs). Purely
/// structural: a fence at offset 0, a non-blank first inner line (a blank
/// one reads as "thematic break, then prose"), and a matching closing
/// fence at column 0.
pub fn detect(input: &[u8]) -> Option<Block> {
    let start = if input.starts_with(b"\xEF\xBB\xBF") {
        3
    } else {
        0
    };
    let marker = *input.get(start)?;

    let lang = match marker {
        b'-' => Lang::Yaml,
        b'+' => Lang::Toml,
        _ => return None,
    };
    if !is_fence_at(input, start, marker) {
        return None;
    }
    let meta_start = fence_line_end(input, start + 3)?;
    if line_is_blank(input, meta_start) {
        return None;
    }

    // The closing fence must start a line; indented content (e.g. inside a
    // YAML block scalar) can never sit at column 0.
    let mut line_start = meta_start;
    while line_start < input.len() {
        if is_fence_at(input, line_start, marker) {
            if let Some(body_start) = fence_line_end(input, line_start + 3) {
                return Some(Block {
                    lang,
                    start,
                    meta: meta_start..line_start,
                    body_start,
                });
            }
        }
        line_start += bun_core::strings::index_of(&input[line_start..], b"\n")? + 1;
    }
    None
}

/// `input` without a leading front-matter block; unchanged when none.
pub fn strip(input: &[u8]) -> &[u8] {
    match detect(input) {
        Some(block) => &input[block.body_start..],
        None => input,
    }
}
