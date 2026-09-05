//! HTML → Markdown (`Bun.markdown.fromHTML`).
//!
//! The rule set is turndown's (plus turndown-plugin-gfm) applied to a tree
//! built by html5ever, a spec-compliant HTML5 parser. The pipeline is the
//! same shape as turndown's:
//!
//! 1. parse into an arena DOM ([`dom`]),
//! 2. collapse inter-element whitespace the way a browser would render it
//!    ([`whitespace`]),
//! 3. walk the tree bottom-up, turning each element into Markdown with a
//!    fixed rule per tag and joining siblings with the right number of
//!    blank lines ([`emit`]).
//!
//! [`convert`] is a pure function of its inputs: no caches, no statics.
//! (html5ever interns unfamiliar tag/attribute names in string_cache's
//! process-wide, mutex-guarded atom table; entries are refcounted and
//! removed on drop, so nothing outlives the call.)

mod depth;
mod dom;
mod emit;
mod text;
mod whitespace;

use html5ever::TokenizerResult;
use html5ever::tendril::StrTendril;
use html5ever::tokenizer::{BufferQueue, Tokenizer, TokenizerOpts};
use html5ever::tree_builder::{TreeBuilder, TreeBuilderOpts, TreeSink};

pub use depth::MAX_TREE_DEPTH;
pub use emit::MAX_DEPTH;

/// Largest input [`convert`] accepts. html5ever's buffers index with `u32`;
/// this leaves headroom for the entity expansion and element synthesis the
/// parser can do on top of the raw bytes.
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

/// Converts an HTML document (or fragment) to Markdown. Never fails: any
/// input the HTML parser accepts produces some Markdown, and the parser
/// accepts everything. Callers bound `html.len()` by [`MAX_INPUT_LEN`].
pub fn convert(html: &str, options: &Options) -> String {
    debug_assert!(html.len() <= MAX_INPUT_LEN);
    let arena = typed_arena::Arena::with_capacity(html.len() / 32);

    // This is `html5ever::parse_document(..).one(html)` with the depth
    // limiter spliced between the tokenizer and the tree builder.
    let tree_builder = TreeBuilder::new(
        dom::Sink::new(&arena),
        TreeBuilderOpts {
            // With scripting on, `<noscript>` bodies stay a single raw text
            // node, which is cheaper to skip than a parsed subtree.
            scripting_enabled: true,
            drop_doctype: true,
            ..Default::default()
        },
    );
    let tokenizer = Tokenizer::new(
        depth::DepthLimiter::new(tree_builder),
        TokenizerOpts::default(),
    );
    let input = BufferQueue::default();
    input.push_back(StrTendril::from(html));
    // `feed` yields at each `</script>` so a browser could run it; nothing to
    // do here but resume.
    while !matches!(tokenizer.feed(&input), TokenizerResult::Done) {}
    tokenizer.end();
    let document = tokenizer.sink.inner.sink.get_document();

    // Convert `<body>` when the parser produced one (it always does for
    // document input); fall back to `<html>` for frameset documents.
    let html_el = document.children().find(|c| c.tag() == dom::Tag::Html);
    let root = html_el
        .and_then(|h| h.children().find(|c| c.tag() == dom::Tag::Body))
        .or(html_el)
        .unwrap_or(document);

    whitespace::collapse_whitespace(root);
    dom::compute_subtree_flags(root);

    let mut out = String::with_capacity(html.len() / 2);
    emit::Converter::new(options).convert(root, &mut out);
    out
}
