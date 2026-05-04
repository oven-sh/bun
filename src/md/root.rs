use crate::parser;
use crate::types::Flags;

// Re-export types needed by external renderers (e.g. JS callback renderer).
pub use types::Renderer;
pub use types::BlockType;
pub use types::SpanType;
pub use types::TextType;
pub use types::SpanDetail;
pub use types::Align;
pub use types::BLOCK_FENCED_CODE;

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
            permissive_email_autolinks: self.permissive_email_autolinks || self.permissive_autolinks,
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
}

// TODO(port): narrow error set — Zig: `parser.Parser.Error`
pub fn render_to_html(text: &[u8]) -> Result<Vec<u8>, parser::ParserError> {
    render_to_html_with_options(text, Options::default())
}

// TODO(port): narrow error set — Zig: `parser.Parser.Error`
pub fn render_to_html_with_options(text: &[u8], options: Options) -> Result<Vec<u8>, parser::ParserError> {
    parser::render_to_html(text, options.to_flags(), options.to_render_options())
}

/// Parse and render using a custom renderer implementation.
// TODO(port): narrow error set — Zig: `parser.Parser.Error`
pub fn render_with_renderer(text: &[u8], options: Options, renderer: Renderer) -> Result<(), parser::ParserError> {
    parser::render_with_renderer(text, options.to_flags(), options.to_render_options(), renderer)
}

pub use crate::types;

pub use crate::entity;
pub use crate::helpers;

pub use crate::ansi_renderer as ansi;
pub use ansi::AnsiRenderer;
pub use ansi::Theme as AnsiTheme;
pub use ansi::ImageUrlCollector;
pub use ansi::render_to_ansi;
pub use ansi::detect_light_background;
pub use ansi::detect_kitty_graphics;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/md/root.zig (124 lines)
//   confidence: medium
//   todos:      3
//   notes:      allocator params dropped; parser::ParserError name + Flags struct-init shape need Phase-B confirmation
// ──────────────────────────────────────────────────────────────────────────
