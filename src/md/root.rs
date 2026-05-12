use crate::parser;
use crate::types::Flags;

// Re-export types needed by external renderers (e.g. JS callback renderer).
pub use crate::types::Align;
pub use crate::types::BLOCK_FENCED_CODE;
pub use crate::types::BlockType;
pub use crate::types::Renderer;
pub use crate::types::SpanDetail;
pub use crate::types::SpanType;
pub use crate::types::TextType;

#[derive(Clone, Copy, Default)]
pub struct RenderOptions {
    pub tag_filter: bool,
    pub heading_ids: bool,
    pub autolink_headings: bool,
}

#[derive(Clone, Copy)]
pub struct Options {
    pub tables: bool,
    pub strikethrough: bool,
    pub tasklists: bool,
    pub permissive_autolinks: bool,
    pub permissive_url_autolinks: bool,
    pub permissive_www_autolinks: bool,
    pub permissive_email_autolinks: bool,
    pub hard_soft_breaks: bool,
    pub wiki_links: bool,
    pub underline: bool,
    pub latex_math: bool,
    pub collapse_whitespace: bool,
    pub permissive_atx_headers: bool,
    pub no_indented_code_blocks: bool,
    pub no_html_blocks: bool,
    pub no_html_spans: bool,
    /// GFM tag filter: replaces `<` with `&lt;` for disallowed HTML tags
    /// (title, textarea, style, xmp, iframe, noembed, noframes, script, plaintext).
    pub tag_filter: bool,
    pub heading_ids: bool,
    pub autolink_headings: bool,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            tables: true,
            strikethrough: true,
            tasklists: true,
            permissive_autolinks: false,
            permissive_url_autolinks: false,
            permissive_www_autolinks: false,
            permissive_email_autolinks: false,
            hard_soft_breaks: false,
            wiki_links: false,
            underline: false,
            latex_math: false,
            collapse_whitespace: false,
            permissive_atx_headers: false,
            no_indented_code_blocks: false,
            no_html_blocks: false,
            no_html_spans: false,
            tag_filter: false,
            heading_ids: false,
            autolink_headings: false,
        }
    }
}

impl Options {
    // Private base (all-false) used for struct-update in the presets below,
    // mirroring Zig's field-default semantics for `.{ .field = ... }`.
    const NONE: Self = Self {
        tables: false,
        strikethrough: false,
        tasklists: false,
        permissive_autolinks: false,
        permissive_url_autolinks: false,
        permissive_www_autolinks: false,
        permissive_email_autolinks: false,
        hard_soft_breaks: false,
        wiki_links: false,
        underline: false,
        latex_math: false,
        collapse_whitespace: false,
        permissive_atx_headers: false,
        no_indented_code_blocks: false,
        no_html_blocks: false,
        no_html_spans: false,
        tag_filter: false,
        heading_ids: false,
        autolink_headings: false,
    };

    pub const COMMONMARK: Self = Self {
        tables: false,
        strikethrough: false,
        tasklists: false,
        ..Self::NONE
    };

    pub const GITHUB: Self = Self {
        tables: true,
        strikethrough: true,
        tasklists: true,
        permissive_autolinks: true,
        permissive_www_autolinks: true,
        permissive_email_autolinks: true,
        tag_filter: true,
        ..Self::NONE
    };

    pub const TERMINAL: Self = Self {
        tables: true,
        strikethrough: true,
        tasklists: true,
        permissive_url_autolinks: true,
        permissive_www_autolinks: true,
        permissive_email_autolinks: true,
        wiki_links: true,
        underline: true,
        latex_math: true,
        ..Self::NONE
    };

    pub fn to_flags(self) -> Flags {
        Flags {
            tables: self.tables,
            strikethrough: self.strikethrough,
            tasklists: self.tasklists,
            permissive_url_autolinks: self.permissive_url_autolinks || self.permissive_autolinks,
            permissive_www_autolinks: self.permissive_www_autolinks || self.permissive_autolinks,
            permissive_email_autolinks: self.permissive_email_autolinks
                || self.permissive_autolinks,
            hard_soft_breaks: self.hard_soft_breaks,
            wiki_links: self.wiki_links,
            underline: self.underline,
            latex_math: self.latex_math,
            collapse_whitespace: self.collapse_whitespace,
            permissive_atx_headers: self.permissive_atx_headers,
            no_indented_code_blocks: self.no_indented_code_blocks,
            no_html_blocks: self.no_html_blocks,
            no_html_spans: self.no_html_spans,
        }
    }

    pub fn to_render_options(self) -> RenderOptions {
        RenderOptions {
            tag_filter: self.tag_filter,
            heading_ids: self.heading_ids,
            autolink_headings: self.autolink_headings,
        }
    }

    /// `(snake_case, camelCase, setter)` for every bool field — replaces the
    /// Zig comptime `@typeInfo(Options).@"struct".fields` reflection loop in
    /// `Bun.markdown`'s option parser.
    pub const BOOL_FIELD_SETTERS: &'static [(
        &'static str,
        &'static str,
        fn(&mut Options, bool),
    )] = &[
        ("tables", "tables", |o, v| o.tables = v),
        ("strikethrough", "strikethrough", |o, v| o.strikethrough = v),
        ("tasklists", "tasklists", |o, v| o.tasklists = v),
        ("permissive_autolinks", "permissiveAutolinks", |o, v| {
            o.permissive_autolinks = v
        }),
        (
            "permissive_url_autolinks",
            "permissiveUrlAutolinks",
            |o, v| o.permissive_url_autolinks = v,
        ),
        (
            "permissive_www_autolinks",
            "permissiveWwwAutolinks",
            |o, v| o.permissive_www_autolinks = v,
        ),
        (
            "permissive_email_autolinks",
            "permissiveEmailAutolinks",
            |o, v| o.permissive_email_autolinks = v,
        ),
        ("hard_soft_breaks", "hardSoftBreaks", |o, v| {
            o.hard_soft_breaks = v
        }),
        ("wiki_links", "wikiLinks", |o, v| o.wiki_links = v),
        ("underline", "underline", |o, v| o.underline = v),
        ("latex_math", "latexMath", |o, v| o.latex_math = v),
        ("collapse_whitespace", "collapseWhitespace", |o, v| {
            o.collapse_whitespace = v
        }),
        ("permissive_atx_headers", "permissiveAtxHeaders", |o, v| {
            o.permissive_atx_headers = v
        }),
        ("no_indented_code_blocks", "noIndentedCodeBlocks", |o, v| {
            o.no_indented_code_blocks = v
        }),
        ("no_html_blocks", "noHtmlBlocks", |o, v| {
            o.no_html_blocks = v
        }),
        ("no_html_spans", "noHtmlSpans", |o, v| o.no_html_spans = v),
        ("tag_filter", "tagFilter", |o, v| o.tag_filter = v),
        ("heading_ids", "headingIds", |o, v| o.heading_ids = v),
        ("autolink_headings", "autolinkHeadings", |o, v| {
            o.autolink_headings = v
        }),
    ];
}

// TODO(port): narrow error set — Zig: `parser.Parser.Error`
pub fn render_to_html(text: &[u8]) -> Result<Box<[u8]>, parser::ParserError> {
    render_to_html_with_options(text, Options::default())
}

// TODO(port): narrow error set — Zig: `parser.Parser.Error`
pub fn render_to_html_with_options(
    text: &[u8],
    options: Options,
) -> Result<Box<[u8]>, parser::ParserError> {
    parser::render_to_html(text, options.to_flags(), options.to_render_options())
}

/// Parse and render using a custom renderer implementation.
// TODO(port): narrow error set — Zig: `parser.Parser.Error`
pub fn render_with_renderer<'a>(
    text: &'a [u8],
    options: Options,
    renderer: Renderer<'a>,
) -> Result<(), parser::ParserError> {
    parser::render_with_renderer(
        text,
        options.to_flags(),
        options.to_render_options(),
        renderer,
    )
}

pub use crate::types;

pub use crate::entity;
pub use crate::helpers;

pub use crate::ansi_renderer as ansi;
pub use ansi::AnsiRenderer;
pub use ansi::ImageUrlCollector;
pub use ansi::Theme as AnsiTheme;
pub use ansi::detect_kitty_graphics;
pub use ansi::detect_light_background;
pub use ansi::render_to_ansi;

// ported from: src/md/root.zig
