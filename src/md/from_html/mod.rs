//! HTML → Markdown (`Bun.markdown.fromHTML`).
//!
//! The rule set is turndown's (plus turndown-plugin-gfm) applied to a tree
//! built from lol-html's token stream — the parser behind `HTMLRewriter` —
//! with the structural half of HTML tree construction (implied end tags,
//! table fix-up, formatting-element recovery) supplied by [`tree`]. The
//! pipeline is the same shape as turndown's:
//!
//! 1. parse into an arena DOM ([`tree`] → [`dom`]),
//! 2. collapse inter-element whitespace the way a browser would render it,
//!    noting which subtrees end up blank ([`whitespace`]),
//! 3. walk the tree bottom-up, turning each element into Markdown with a
//!    fixed rule per tag and joining siblings with the right number of
//!    blank lines ([`emit`]).
//!
//! [`convert`] is a pure function of its inputs: no caches, no statics.

mod dom;
mod emit;
mod entities;
mod scan;
mod text;
mod tree;
mod whitespace;

use bun_core::strings;

pub use emit::MAX_DEPTH;
pub use tree::MAX_TREE_DEPTH;

/// Largest input [`convert_utf8_bytes`] accepts: the DOM keeps a decoded
/// copy of the text, and the output buffer is sized from the input, so a
/// multi-gigabyte document is refused up front rather than run out of
/// memory half way.
pub const MAX_INPUT_LEN: usize = (u32::MAX / 4) as usize;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HeadingStyle {
    /// `# Heading`
    Atx,
    /// `Heading\n=======` for levels 1–2, ATX for the rest.
    Setext,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CodeBlockStyle {
    Fenced,
    Indented,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Fence {
    /// ```` ``` ````
    Backticks,
    /// `~~~`
    Tildes,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BulletListMarker {
    Dash,
    Asterisk,
    Plus,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum EmDelimiter {
    Underscore,
    Asterisk,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StrongDelimiter {
    /// `**`
    Asterisks,
    /// `__`
    Underscores,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LineBreak {
    /// Two trailing spaces.
    Spaces,
    /// A trailing backslash.
    Backslash,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ThematicBreak {
    /// `---`
    Dashes,
    /// `***`
    Asterisks,
    /// `___`
    Underscores,
    /// `* * *` (turndown's default)
    SpacedAsterisks,
    /// `- - -`
    SpacedDashes,
    /// `_ _ _`
    SpacedUnderscores,
}

#[derive(Clone, Debug)]
pub struct Options {
    pub heading_style: HeadingStyle,
    pub thematic_break: ThematicBreak,
    pub bullet_list_marker: BulletListMarker,
    pub code_block_style: CodeBlockStyle,
    pub fence: Fence,
    pub em_delimiter: EmDelimiter,
    pub strong_delimiter: StrongDelimiter,
    pub line_break: LineBreak,
    /// GFM pipe tables. When off, cells are emitted as consecutive blocks.
    pub tables: bool,
    /// GFM `~~strikethrough~~` for `<del>`, `<s>`, `<strike>`.
    pub strikethrough: bool,
    /// GFM `[x]` / `[ ]` for checkboxes leading a list item.
    pub tasklists: bool,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            heading_style: HeadingStyle::Atx,
            thematic_break: ThematicBreak::Dashes,
            bullet_list_marker: BulletListMarker::Dash,
            code_block_style: CodeBlockStyle::Fenced,
            fence: Fence::Backticks,
            em_delimiter: EmDelimiter::Underscore,
            strong_delimiter: StrongDelimiter::Asterisks,
            line_break: LineBreak::Spaces,
            tables: true,
            strikethrough: true,
            tasklists: true,
        }
    }
}

impl Options {
    fn hr(&self) -> &'static str {
        match self.thematic_break {
            ThematicBreak::Dashes => "---",
            ThematicBreak::Asterisks => "***",
            ThematicBreak::Underscores => "___",
            ThematicBreak::SpacedAsterisks => "* * *",
            ThematicBreak::SpacedDashes => "- - -",
            ThematicBreak::SpacedUnderscores => "_ _ _",
        }
    }
    fn bullet(&self) -> &'static str {
        match self.bullet_list_marker {
            BulletListMarker::Dash => "-",
            BulletListMarker::Asterisk => "*",
            BulletListMarker::Plus => "+",
        }
    }
    fn fence_char(&self) -> char {
        match self.fence {
            Fence::Backticks => '`',
            Fence::Tildes => '~',
        }
    }
    fn em(&self) -> &'static str {
        match self.em_delimiter {
            EmDelimiter::Underscore => "_",
            EmDelimiter::Asterisk => "*",
        }
    }
    fn strong(&self) -> &'static str {
        match self.strong_delimiter {
            StrongDelimiter::Asterisks => "**",
            StrongDelimiter::Underscores => "__",
        }
    }
    fn br(&self) -> &'static str {
        match self.line_break {
            LineBreak::Spaces => "  ",
            LineBreak::Backslash => "\\",
        }
    }
}

/// The input, after U+FFFD substitution, exceeds [`MAX_INPUT_LEN`].
#[derive(Debug)]
pub struct InputTooLong;

/// Converts an HTML document (or fragment) to Markdown. Never fails: any
/// input produces some Markdown, since HTML parsing accepts everything.
pub fn convert(html: &str, options: &Options) -> String {
    convert_bytes(html.as_bytes(), options)
}

/// [`convert`] for bytes that are supposed to be UTF-8 and may be backed
/// by memory another thread can write (a `SharedArrayBuffer`). The bytes go
/// to the parser as bytes — lol-html validates UTF-8 itself as it produces
/// each text chunk, name and attribute value, substituting U+FFFD where it
/// must — so no `&str` is ever formed over the shared memory and a racing
/// writer can garble the content but nothing else. Input that is invalid to
/// begin with is decoded lossily up front so the substitution matches what
/// a browser decoding the same bytes would show.
pub fn convert_utf8_bytes(bytes: &[u8], options: &Options) -> Result<String, InputTooLong> {
    if bytes.len() > MAX_INPUT_LEN {
        return Err(InputTooLong);
    }
    if strings::is_valid_utf8(bytes) {
        return Ok(convert_bytes(bytes, options));
    }
    #[allow(clippy::disallowed_methods)] // U+FFFD substitution is the point here
    let lossy = String::from_utf8_lossy(bytes).into_owned();
    // Each replaced byte grew to three.
    if lossy.len() > MAX_INPUT_LEN {
        return Err(InputTooLong);
    }
    Ok(convert_bytes(lossy.as_bytes(), options))
}

fn convert_bytes(html: &[u8], options: &Options) -> String {
    let arena = dom::Arenas::with_capacity(html.len() / 32, html.len() / 2);
    let root = tree::parse(html, &arena);
    whitespace::collapse_whitespace(root, &arena);
    let mut out = String::with_capacity(html.len() / 2);
    emit::Converter::new(options).convert(root, &mut out);
    out
}
