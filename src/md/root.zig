const std = @import("std");
const parser = @import("parser.zig");
const Flags = @import("types.zig").Flags;

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

    pub const commonmark: Options = .{
        .tables = false,
        .strikethrough = false,
        .tasklists = false,
    };

    pub const github: Options = .{
        .tables = true,
        .strikethrough = true,
        .tasklists = true,
        .permissive_autolinks = true,
        .permissive_www_autolinks = true,
        .permissive_email_autolinks = true,
    };

    fn toFlags(self: Options) Flags {
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
};

pub fn renderToHtml(text: []const u8, allocator: std.mem.Allocator) error{OutOfMemory}![]u8 {
    return renderToHtmlWithOptions(text, allocator, .{});
}

pub fn renderToHtmlWithOptions(text: []const u8, allocator: std.mem.Allocator, options: Options) error{OutOfMemory}![]u8 {
    return parser.renderToHtml(text, allocator, options.toFlags());
}
