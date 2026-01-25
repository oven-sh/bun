pub const HtmlRenderer = struct {
    output: *std.ArrayListUnmanaged(u8),
    allocator: Allocator,
    oom: bool = false,
    image_nesting_level: u32 = 0,
    src_text: []const u8,

    pub fn init(output: *std.ArrayListUnmanaged(u8), allocator: Allocator, src_text: []const u8) HtmlRenderer {
        return .{
            .output = output,
            .allocator = allocator,
            .src_text = src_text,
        };
    }

    fn write(self: *HtmlRenderer, data: []const u8) void {
        if (self.oom) return;
        self.output.appendSlice(self.allocator, data) catch {
            self.oom = true;
        };
    }

    fn writeByte(self: *HtmlRenderer, b: u8) void {
        if (self.oom) return;
        self.output.append(self.allocator, b) catch {
            self.oom = true;
        };
    }

    fn writeHtmlEscaped(self: *HtmlRenderer, text: []const u8) void {
        var start: usize = 0;
        for (text, 0..) |c, i| {
            const replacement: ?[]const u8 = switch (c) {
                '&' => "&amp;",
                '<' => "&lt;",
                '>' => "&gt;",
                '"' => "&quot;",
                else => null,
            };
            if (replacement) |r| {
                if (i > start) self.write(text[start..i]);
                self.write(r);
                start = i + 1;
            }
        }
        if (start < text.len) self.write(text[start..]);
    }

    fn writeUrlEscaped(self: *HtmlRenderer, text: []const u8) void {
        for (text) |c| {
            switch (c) {
                '&' => self.write("&amp;"),
                '\'' => self.write("&#x27;"),
                // Characters that should NOT be percent-encoded in URLs
                'A'...'Z',
                'a'...'z',
                '0'...'9',
                '-',
                '.',
                '_',
                '~', // unreserved
                ':',
                '/',
                '?',
                '#',
                '[',
                ']',
                '@', // reserved
                '!',
                '$',
                '(',
                ')',
                '*',
                '+',
                ',',
                ';',
                '=', // sub-delims (except & and ')
                '%', // already encoded
                => self.writeByte(c),
                else => {
                    var buf: [3]u8 = undefined;
                    buf[0] = '%';
                    buf[1] = hexDigit(c >> 4);
                    buf[2] = hexDigit(c & 0x0F);
                    self.write(&buf);
                },
            }
        }
    }

    fn hexDigit(v: u8) u8 {
        return if (v < 10) '0' + v else 'A' + v - 10;
    }

    fn writeAttribute(self: *HtmlRenderer, attr: *const Attribute) void {
        for (attr.substr_offsets, attr.substr_types) |sub_off, sub_type| {
            const text = self.src_text[sub_off.beg..sub_off.end];
            switch (sub_type) {
                .normal => self.writeHtmlEscaped(text),
                .entity => self.writeEntity(text),
            }
        }
    }

    fn writeAttributeUrl(self: *HtmlRenderer, attr: *const Attribute) void {
        for (attr.substr_offsets, attr.substr_types) |sub_off, sub_type| {
            const text = self.src_text[sub_off.beg..sub_off.end];
            switch (sub_type) {
                .normal => self.writeUrlEscaped(text),
                .entity => self.writeEntity(text),
            }
        }
    }

    fn writeEntity(self: *HtmlRenderer, entity_text: []const u8) void {
        // Try to resolve the entity to a codepoint
        if (entity_mod.lookup(entity_text)) |codepoints| {
            self.writeUtf8Codepoint(codepoints[0]);
            if (codepoints[1] != 0) {
                self.writeUtf8Codepoint(codepoints[1]);
            }
        } else {
            // If not a known entity, output it verbatim
            self.write(entity_text);
        }
    }

    fn writeUtf8Codepoint(self: *HtmlRenderer, cp: u21) void {
        var buf: [4]u8 = undefined;
        const len = helpers.encodeUtf8(cp, &buf);
        self.write(buf[0..len]);
    }

    // --- Block callbacks ---

    pub fn enterBlock(self: *HtmlRenderer, block_type: BlockType, detail: anytype) void {
        if (self.image_nesting_level > 0) return;

        switch (block_type) {
            .doc => {},
            .quote => self.write("<blockquote>\n"),
            .ul => {
                self.write("<ul>\n");
                _ = detail;
            },
            .ol => {
                if (@TypeOf(detail) == *const types.OlDetail) {
                    if (detail.start == 1) {
                        self.write("<ol>\n");
                    } else {
                        self.write("<ol start=\"");
                        self.writeDecimal(detail.start);
                        self.write("\">\n");
                    }
                } else {
                    self.write("<ol>\n");
                }
            },
            .li => {
                if (@TypeOf(detail) == *const types.LiDetail) {
                    if (detail.is_task) {
                        self.write("<li class=\"task-list-item\">");
                        if (detail.task_mark == ' ') {
                            self.write("<input type=\"checkbox\" disabled> ");
                        } else {
                            self.write("<input type=\"checkbox\" checked disabled> ");
                        }
                    } else {
                        self.write("<li>");
                    }
                } else {
                    self.write("<li>");
                }
            },
            .hr => self.write("<hr>\n"),
            .h => {
                if (@TypeOf(detail) == *const types.HDetail) {
                    self.write(switch (detail.level) {
                        1 => "<h1>",
                        2 => "<h2>",
                        3 => "<h3>",
                        4 => "<h4>",
                        5 => "<h5>",
                        else => "<h6>",
                    });
                } else {
                    self.write("<h1>");
                }
            },
            .code => {
                self.write("<pre><code");
                if (@TypeOf(detail) == *const types.CodeDetail) {
                    if (detail.lang.substr_offsets.len > 0) {
                        self.write(" class=\"language-");
                        self.writeAttribute(&detail.lang);
                        self.write("\"");
                    }
                }
                self.write(">");
            },
            .html => {}, // raw HTML blocks are output directly
            .p => self.write("<p>"),
            .table => self.write("<table>\n"),
            .thead => self.write("<thead>\n"),
            .tbody => self.write("<tbody>\n"),
            .tr => self.write("<tr>\n"),
            .th => {
                self.write("<th");
                if (@TypeOf(detail) == *const types.TdDetail) {
                    self.writeAlignAttr(detail.alignment);
                }
                self.write(">");
            },
            .td => {
                self.write("<td");
                if (@TypeOf(detail) == *const types.TdDetail) {
                    self.writeAlignAttr(detail.alignment);
                }
                self.write(">");
            },
        }
    }

    pub fn leaveBlock(self: *HtmlRenderer, block_type: BlockType, detail: anytype) void {
        if (self.image_nesting_level > 0) return;
        _ = detail;

        switch (block_type) {
            .doc => {},
            .quote => self.write("</blockquote>\n"),
            .ul => self.write("</ul>\n"),
            .ol => self.write("</ol>\n"),
            .li => self.write("</li>\n"),
            .hr => {},
            .h => {
                // need level for closing tag
                self.write("</h?>\n"); // placeholder, will be fixed
            },
            .code => self.write("</code></pre>\n"),
            .html => {},
            .p => self.write("</p>\n"),
            .table => self.write("</table>\n"),
            .thead => self.write("</thead>\n"),
            .tbody => self.write("</tbody>\n"),
            .tr => self.write("</tr>\n"),
            .th => self.write("</th>\n"),
            .td => self.write("</td>\n"),
        }
    }

    // --- Span callbacks ---

    pub fn enterSpan(self: *HtmlRenderer, span_type: SpanType, detail: anytype) void {
        if (self.image_nesting_level > 0) {
            if (span_type == .img) self.image_nesting_level += 1;
            return;
        }

        switch (span_type) {
            .em => self.write("<em>"),
            .strong => self.write("<strong>"),
            .u => self.write("<u>"),
            .a => {
                if (@TypeOf(detail) == *const types.ADetail) {
                    self.write("<a href=\"");
                    self.writeAttributeUrl(&detail.href);
                    self.write("\"");
                    if (detail.title.substr_offsets.len > 0) {
                        self.write(" title=\"");
                        self.writeAttribute(&detail.title);
                        self.write("\"");
                    }
                    self.write(">");
                } else {
                    self.write("<a>");
                }
            },
            .img => {
                if (@TypeOf(detail) == *const types.ImgDetail) {
                    self.write("<img src=\"");
                    self.writeAttributeUrl(&detail.src);
                    self.write("\" alt=\"");
                    self.image_nesting_level += 1;
                } else {
                    self.write("<img alt=\"");
                    self.image_nesting_level += 1;
                }
            },
            .code => self.write("<code>"),
            .del => self.write("<del>"),
            .latexmath => self.write("<x-equation>"),
            .latexmath_display => self.write("<x-equation type=\"display\">"),
            .wikilink => {
                if (@TypeOf(detail) == *const types.WikilinkDetail) {
                    self.write("<x-wikilink data-target=\"");
                    self.writeAttribute(&detail.target);
                    self.write("\">");
                } else {
                    self.write("<x-wikilink>");
                }
            },
        }
    }

    pub fn leaveSpan(self: *HtmlRenderer, span_type: SpanType, detail: anytype) void {
        if (self.image_nesting_level > 0) {
            if (span_type == .img) {
                self.image_nesting_level -= 1;
                if (self.image_nesting_level == 0) {
                    if (@TypeOf(detail) == *const types.ImgDetail) {
                        self.write("\"");
                        if (detail.title.substr_offsets.len > 0) {
                            self.write(" title=\"");
                            self.writeAttribute(&detail.title);
                            self.write("\"");
                        }
                        self.write(" />");
                    } else {
                        self.write("\" />");
                    }
                }
            }
            return;
        }

        switch (span_type) {
            .em => self.write("</em>"),
            .strong => self.write("</strong>"),
            .u => self.write("</u>"),
            .a => self.write("</a>"),
            .img => {}, // handled above
            .code => self.write("</code>"),
            .del => self.write("</del>"),
            .latexmath => self.write("</x-equation>"),
            .latexmath_display => self.write("</x-equation>"),
            .wikilink => self.write("</x-wikilink>"),
        }
    }

    // --- Text callback ---

    pub fn text(self: *HtmlRenderer, text_type: TextType, content: []const u8) void {
        switch (text_type) {
            .null_char => {
                if (self.image_nesting_level > 0) return;
                self.write("\xEF\xBF\xBD"); // U+FFFD replacement character
            },
            .br => {
                if (self.image_nesting_level > 0) return;
                self.write("<br>\n");
            },
            .softbr => {
                if (self.image_nesting_level > 0) {
                    self.write(" ");
                } else {
                    self.write("\n");
                }
            },
            .html => {
                self.write(content);
            },
            .entity => {
                if (self.image_nesting_level > 0) {
                    self.writeEntity(content);
                } else {
                    self.writeEntity(content);
                }
            },
            else => {
                // normal, code, latexmath
                self.writeHtmlEscaped(content);
            },
        }
    }

    fn writeAlignAttr(self: *HtmlRenderer, alignment: types.Align) void {
        switch (alignment) {
            .left => self.write(" align=\"left\""),
            .center => self.write(" align=\"center\""),
            .right => self.write(" align=\"right\""),
            .default => {},
        }
    }

    fn writeDecimal(self: *HtmlRenderer, value: u32) void {
        var buf: [10]u8 = undefined;
        var v = value;
        var i: usize = buf.len;
        if (v == 0) {
            self.writeByte('0');
            return;
        }
        while (v > 0) {
            i -= 1;
            buf[i] = @intCast('0' + v % 10);
            v /= 10;
        }
        self.write(buf[i..]);
    }
};

const entity_mod = @import("./entity.zig");
const helpers = @import("./helpers.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const types = @import("./types.zig");
const Attribute = types.Attribute;
const BlockType = types.BlockType;
const SpanType = types.SpanType;
const TextType = types.TextType;
