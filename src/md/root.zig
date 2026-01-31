// Re-export types needed by external renderers (e.g. JS callback renderer).
pub const Renderer = types.Renderer;
pub const BlockType = types.BlockType;
pub const SpanType = types.SpanType;
pub const TextType = types.TextType;
pub const SpanDetail = types.SpanDetail;
pub const Align = types.Align;
pub const BLOCK_FENCED_CODE = types.BLOCK_FENCED_CODE;

pub const RenderOptions = struct {
    tag_filter: bool = false,
    heading_ids: bool = false,
    autolink_headings: bool = false,
};

pub const Options = struct {
    tables: bool = true,
    strikethrough: bool = true,
    tasklists: bool = true,
    permissive_autolinks: bool = false,
    permissive_url_autolinks: bool = false,
    permissive_www_autolinks: bool = false,
    permissive_email_autolinks: bool = false,
    hard_soft_breaks: bool = false,
    wiki_links: bool = false,
    underline: bool = false,
    latex_math: bool = false,
    collapse_whitespace: bool = false,
    permissive_atx_headers: bool = false,
    no_indented_code_blocks: bool = false,
    no_html_blocks: bool = false,
    no_html_spans: bool = false,
    /// GFM tag filter: replaces `<` with `&lt;` for disallowed HTML tags
    /// (title, textarea, style, xmp, iframe, noembed, noframes, script, plaintext).
    tag_filter: bool = false,
    heading_ids: bool = false,
    autolink_headings: bool = false,
    /// Skip YAML frontmatter at the start of the document (text between `---` markers).
    frontmatter: bool = true,

    pub const commonmark: Options = .{
        .tables = false,
        .strikethrough = false,
        .tasklists = false,
        .frontmatter = false,
    };

    pub const github: Options = .{
        .tables = true,
        .strikethrough = true,
        .tasklists = true,
        .permissive_autolinks = true,
        .permissive_www_autolinks = true,
        .permissive_email_autolinks = true,
        .tag_filter = true,
        .frontmatter = true,
    };

    pub fn toFlags(self: Options) Flags {
        return .{
            .tables = self.tables,
            .strikethrough = self.strikethrough,
            .tasklists = self.tasklists,
            .permissive_url_autolinks = self.permissive_url_autolinks or self.permissive_autolinks,
            .permissive_www_autolinks = self.permissive_www_autolinks or self.permissive_autolinks,
            .permissive_email_autolinks = self.permissive_email_autolinks or self.permissive_autolinks,
            .hard_soft_breaks = self.hard_soft_breaks,
            .wiki_links = self.wiki_links,
            .underline = self.underline,
            .latex_math = self.latex_math,
            .collapse_whitespace = self.collapse_whitespace,
            .permissive_atx_headers = self.permissive_atx_headers,
            .no_indented_code_blocks = self.no_indented_code_blocks,
            .no_html_blocks = self.no_html_blocks,
            .no_html_spans = self.no_html_spans,
        };
    }

    pub fn toRenderOptions(self: Options) RenderOptions {
        return .{
            .tag_filter = self.tag_filter,
            .heading_ids = self.heading_ids,
            .autolink_headings = self.autolink_headings,
        };
    }
};

pub fn renderToHtml(text: []const u8, allocator: std.mem.Allocator) parser.Parser.Error![]u8 {
    return renderToHtmlWithOptions(text, allocator, .{});
}

pub fn renderToHtmlWithOptions(text: []const u8, allocator: std.mem.Allocator, options: Options) parser.Parser.Error![]u8 {
    const input = if (options.frontmatter) helpers.skipFrontmatter(text) else text;
    return parser.renderToHtml(input, allocator, options.toFlags(), options.toRenderOptions());
}

/// Parse and render using a custom renderer implementation.
pub fn renderWithRenderer(text: []const u8, allocator: std.mem.Allocator, options: Options, renderer: Renderer) parser.Parser.Error!void {
    const input = if (options.frontmatter) helpers.skipFrontmatter(text) else text;
    return parser.renderWithRenderer(input, allocator, options.toFlags(), options.toRenderOptions(), renderer);
}

pub const types = @import("./types.zig");
const Flags = types.Flags;

pub const entity = @import("./entity.zig");
pub const helpers = @import("./helpers.zig");

const parser = @import("./parser.zig");
const std = @import("std");
