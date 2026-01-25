const std = @import("std");
const types = @import("types.zig");
const entity_mod = @import("entity.zig");
const helpers = @import("helpers.zig");

const BlockType = types.BlockType;
const SpanType = types.SpanType;
const TextType = types.TextType;
const Align = types.Align;
const Renderer = types.Renderer;
const SpanDetail = types.SpanDetail;
const OFF = types.OFF;

const Allocator = std.mem.Allocator;

pub const HtmlRenderer = struct {
    out: OutputBuffer,
    allocator: Allocator,
    src_text: []const u8,
    image_nesting_level: u32 = 0,
    saved_img_title: []const u8 = "",

    pub const OutputBuffer = struct {
        list: std.ArrayListUnmanaged(u8),
        allocator: Allocator,
        oom: bool,

        fn write(self: *OutputBuffer, data: []const u8) void {
            if (self.oom) return;
            self.list.appendSlice(self.allocator, data) catch {
                self.oom = true;
            };
        }

        fn writeByte(self: *OutputBuffer, b: u8) void {
            if (self.oom) return;
            self.list.append(self.allocator, b) catch {
                self.oom = true;
            };
        }
    };

    pub fn init(allocator: Allocator, src_text: []const u8) HtmlRenderer {
        return .{
            .out = .{ .list = .{}, .allocator = allocator, .oom = false },
            .allocator = allocator,
            .src_text = src_text,
        };
    }

    pub fn deinit(self: *HtmlRenderer) void {
        self.out.list.deinit(self.allocator);
    }

    pub fn toOwnedSlice(self: *HtmlRenderer) error{OutOfMemory}![]u8 {
        if (self.out.oom) return error.OutOfMemory;
        return self.out.list.toOwnedSlice(self.allocator);
    }

    pub fn renderer(self: *HtmlRenderer) Renderer {
        return .{ .ptr = self, .vtable = &vtable };
    }

    pub const vtable: Renderer.VTable = .{
        .enterBlock = enterBlockImpl,
        .leaveBlock = leaveBlockImpl,
        .enterSpan = enterSpanImpl,
        .leaveSpan = leaveSpanImpl,
        .text = textImpl,
    };

    // ========================================
    // VTable implementation functions
    // ========================================

    fn enterBlockImpl(ptr: *anyopaque, block_type: BlockType, data: u32, flags: u32) void {
        const self: *HtmlRenderer = @ptrCast(@alignCast(ptr));
        self.enterBlock(block_type, data, flags);
    }

    fn leaveBlockImpl(ptr: *anyopaque, block_type: BlockType, data: u32) void {
        const self: *HtmlRenderer = @ptrCast(@alignCast(ptr));
        self.leaveBlock(block_type, data);
    }

    fn enterSpanImpl(ptr: *anyopaque, span_type: SpanType, detail: SpanDetail) void {
        const self: *HtmlRenderer = @ptrCast(@alignCast(ptr));
        self.enterSpan(span_type, detail);
    }

    fn leaveSpanImpl(ptr: *anyopaque, span_type: SpanType) void {
        const self: *HtmlRenderer = @ptrCast(@alignCast(ptr));
        self.leaveSpan(span_type);
    }

    fn textImpl(ptr: *anyopaque, text_type: TextType, content: []const u8) void {
        const self: *HtmlRenderer = @ptrCast(@alignCast(ptr));
        self.text(text_type, content);
    }

    // ========================================
    // Block rendering
    // ========================================

    pub fn enterBlock(self: *HtmlRenderer, block_type: BlockType, data: u32, flags: u32) void {
        switch (block_type) {
            .doc => {},
            .quote => {
                self.ensureNewline();
                self.write("<blockquote>\n");
            },
            .ul => {
                self.ensureNewline();
                self.write("<ul>\n");
            },
            .ol => {
                self.ensureNewline();
                const start = data;
                if (start == 1) {
                    self.write("<ol>\n");
                } else {
                    self.write("<ol start=\"");
                    self.writeDecimal(start);
                    self.write("\">\n");
                }
            },
            .li => {
                const task_mark: u8 = @truncate(data);
                if (task_mark != 0) {
                    self.write("<li class=\"task-list-item\">");
                    if (task_mark == ' ') {
                        self.write("<input type=\"checkbox\" class=\"task-list-item-checkbox\" disabled>");
                    } else {
                        self.write("<input type=\"checkbox\" class=\"task-list-item-checkbox\" disabled checked>");
                    }
                } else {
                    self.write("<li>");
                }
            },
            .hr => {
                self.ensureNewline();
                self.write("<hr />\n");
            },
            .h => {
                self.ensureNewline();
                const level = data;
                const tag = switch (level) {
                    1 => "<h1>",
                    2 => "<h2>",
                    3 => "<h3>",
                    4 => "<h4>",
                    5 => "<h5>",
                    else => "<h6>",
                };
                self.write(tag);
            },
            .code => {
                self.ensureNewline();
                self.write("<pre><code");
                if (flags & types.BLOCK_FENCED_CODE != 0) {
                    const info_beg = data;
                    // Find end of language token (first word of info string)
                    var lang_end = info_beg;
                    while (lang_end < self.src_text.len and !helpers.isBlank(self.src_text[lang_end]) and
                        !helpers.isNewline(self.src_text[lang_end]))
                    {
                        lang_end += 1;
                    }
                    if (lang_end > info_beg) {
                        self.write(" class=\"language-");
                        self.writeWithEntityDecoding(self.src_text[info_beg..lang_end]);
                        self.write("\"");
                    }
                }
                self.write(">");
            },
            .html => self.ensureNewline(),
            .p => {
                self.ensureNewline();
                self.write("<p>");
            },
            .table => {
                self.ensureNewline();
                self.write("<table>\n");
            },
            .thead => self.write("<thead>\n"),
            .tbody => self.write("<tbody>\n"),
            .tr => self.write("<tr>"),
            .th, .td => {
                const tag = if (block_type == .th) "<th" else "<td";
                self.write(tag);
                // alignment from data
                const alignment: Align = @enumFromInt(@as(u2, @truncate(data)));
                switch (alignment) {
                    .left => self.write(" align=\"left\""),
                    .center => self.write(" align=\"center\""),
                    .right => self.write(" align=\"right\""),
                    .default => {},
                }
                self.write(">");
            },
        }
    }

    pub fn leaveBlock(self: *HtmlRenderer, block_type: BlockType, data: u32) void {
        switch (block_type) {
            .doc => {},
            .quote => self.write("</blockquote>\n"),
            .ul => self.write("</ul>\n"),
            .ol => self.write("</ol>\n"),
            .li => self.write("</li>\n"),
            .hr => {},
            .h => {
                const tag = switch (data) {
                    1 => "</h1>\n",
                    2 => "</h2>\n",
                    3 => "</h3>\n",
                    4 => "</h4>\n",
                    5 => "</h5>\n",
                    else => "</h6>\n",
                };
                self.write(tag);
            },
            .code => self.write("</code></pre>\n"),
            .html => {},
            .p => {
                self.write("</p>\n");
            },
            .table => self.write("</table>\n"),
            .thead => self.write("</thead>\n"),
            .tbody => self.write("</tbody>\n"),
            .tr => self.write("</tr>\n"),
            .th => self.write("</th>"),
            .td => self.write("</td>"),
        }
    }

    // ========================================
    // Span rendering
    // ========================================

    pub fn enterSpan(self: *HtmlRenderer, span_type: SpanType, detail: SpanDetail) void {
        if (self.image_nesting_level > 0) {
            if (span_type == .img) self.image_nesting_level += 1;
            return;
        }

        switch (span_type) {
            .em => self.write("<em>"),
            .strong => self.write("<strong>"),
            .u => self.write("<u>"),
            .code => self.write("<code>"),
            .del => self.write("<del>"),
            .latexmath => self.write("<x-equation>"),
            .latexmath_display => self.write("<x-equation type=\"display\">"),
            .a => {
                self.write("<a href=\"");
                if (detail.permissive_autolink) {
                    // Permissive autolinks use HTML-escaping for href
                    if (detail.autolink_email) self.write("mailto:");
                    if (detail.autolink_www) self.write("http://");
                    self.writeHtmlEscaped(detail.href);
                } else if (detail.autolink) {
                    // Standard autolinks: percent-encode only, no entity/escape processing
                    if (detail.autolink_email) self.write("mailto:");
                    self.writeUrlEscaped(detail.href);
                } else {
                    // Regular links: full entity/escape processing
                    if (detail.autolink_email) self.write("mailto:");
                    self.writeUrlWithEscapes(detail.href);
                }
                self.write("\"");
                if (detail.title.len > 0) {
                    self.write(" title=\"");
                    self.writeTitleWithEscapes(detail.title);
                    self.write("\"");
                }
                self.write(">");
            },
            .img => {
                self.saved_img_title = detail.title;
                self.write("<img src=\"");
                self.writeUrlWithEscapes(detail.href);
                self.write("\" alt=\"");
                self.image_nesting_level += 1;
            },
            .wikilink => {
                self.write("<x-wikilink data-target=\"");
                self.writeHtmlEscaped(detail.href);
                self.write("\">");
            },
        }
    }

    pub fn leaveSpan(self: *HtmlRenderer, span_type: SpanType) void {
        if (self.image_nesting_level > 0) {
            if (span_type == .img) {
                self.image_nesting_level -= 1;
                if (self.image_nesting_level == 0) {
                    self.write("\"");
                    if (self.saved_img_title.len > 0) {
                        self.write(" title=\"");
                        self.writeTitleWithEscapes(self.saved_img_title);
                        self.write("\"");
                    }
                    self.write(" />");
                    self.saved_img_title = "";
                }
            }
            return;
        }

        switch (span_type) {
            .em => self.write("</em>"),
            .strong => self.write("</strong>"),
            .u => self.write("</u>"),
            .a => self.write("</a>"),
            .code => self.write("</code>"),
            .del => self.write("</del>"),
            .latexmath => self.write("</x-equation>"),
            .latexmath_display => self.write("</x-equation>"),
            .wikilink => self.write("</x-wikilink>"),
            .img => {}, // handled above
        }
    }

    // ========================================
    // Text rendering
    // ========================================

    pub fn text(self: *HtmlRenderer, text_type: TextType, content: []const u8) void {
        const in_image = self.image_nesting_level > 0;
        switch (text_type) {
            .null_char => self.write("\xEF\xBF\xBD"),
            .br => {
                if (in_image) self.write(" ") else self.write("<br />\n");
            },
            .softbr => {
                if (in_image) self.write(" ") else self.write("\n");
            },
            .html => self.write(content),
            .entity => self.writeEntity(content),
            .code => {
                // In code spans, newlines become spaces
                var start: usize = 0;
                for (content, 0..) |byte, j| {
                    if (byte == '\n') {
                        if (j > start) self.writeHtmlEscaped(content[start..j]);
                        self.write(" ");
                        start = j + 1;
                    }
                }
                if (start < content.len) self.writeHtmlEscaped(content[start..]);
            },
            else => self.writeHtmlEscaped(content),
        }
    }

    // ========================================
    // HTML writing utilities
    // ========================================

    pub fn write(self: *HtmlRenderer, data: []const u8) void {
        self.out.write(data);
    }

    fn writeByte(self: *HtmlRenderer, b: u8) void {
        self.out.writeByte(b);
    }

    fn ensureNewline(self: *HtmlRenderer) void {
        const items = self.out.list.items;
        if (items.len > 0 and items[items.len - 1] != '\n') {
            self.out.writeByte('\n');
        }
    }

    pub fn writeHtmlEscaped(self: *HtmlRenderer, txt: []const u8) void {
        var start: usize = 0;
        for (txt, 0..) |c, i| {
            const replacement: ?[]const u8 = switch (c) {
                '&' => "&amp;",
                '<' => "&lt;",
                '>' => "&gt;",
                '"' => "&quot;",
                else => null,
            };
            if (replacement) |r| {
                if (i > start) self.write(txt[start..i]);
                self.write(r);
                start = i + 1;
            }
        }
        if (start < txt.len) self.write(txt[start..]);
    }

    fn writeUrlEscaped(self: *HtmlRenderer, txt: []const u8) void {
        for (txt) |byte| {
            self.writeUrlByte(byte);
        }
    }

    fn writeUrlByte(self: *HtmlRenderer, byte: u8) void {
        switch (byte) {
            '&' => self.write("&amp;"),
            '\'' => self.write("&#x27;"),
            'A'...'Z',
            'a'...'z',
            '0'...'9',
            '-',
            '.',
            '_',
            '~',
            ':',
            '/',
            '?',
            '#',
            '@',
            '!',
            '$',
            '(',
            ')',
            '*',
            '+',
            ',',
            ';',
            '=',
            '%',
            => self.writeByte(byte),
            else => {
                var buf: [3]u8 = undefined;
                buf[0] = '%';
                buf[1] = hexDigit(byte >> 4);
                buf[2] = hexDigit(byte & 0x0F);
                self.write(&buf);
            },
        }
    }

    /// Write URL with backslash escape and entity processing.
    fn writeUrlWithEscapes(self: *HtmlRenderer, txt: []const u8) void {
        var i: usize = 0;
        while (i < txt.len) {
            if (txt[i] == '\\' and i + 1 < txt.len and helpers.isAsciiPunctuation(txt[i + 1])) {
                self.writeUrlByte(txt[i + 1]);
                i += 2;
            } else if (txt[i] == '&') {
                const ent_result = findEntityInText(txt, i);
                if (ent_result.found) {
                    self.writeEntityToUrl(txt[i..ent_result.end_pos]);
                    i = ent_result.end_pos;
                } else {
                    self.write("&amp;");
                    i += 1;
                }
            } else {
                self.writeUrlByte(txt[i]);
                i += 1;
            }
        }
    }

    /// Write title attribute with backslash escape and entity processing (HTML-escaped).
    fn writeTitleWithEscapes(self: *HtmlRenderer, txt: []const u8) void {
        var i: usize = 0;
        while (i < txt.len) {
            if (txt[i] == '\\' and i + 1 < txt.len and helpers.isAsciiPunctuation(txt[i + 1])) {
                self.writeHtmlEscaped(txt[i + 1 .. i + 2]);
                i += 2;
            } else if (txt[i] == '&') {
                const ent_result = findEntityInText(txt, i);
                if (ent_result.found) {
                    self.writeEntity(txt[i..ent_result.end_pos]);
                    i = ent_result.end_pos;
                } else {
                    self.write("&amp;");
                    i += 1;
                }
            } else {
                self.writeHtmlEscaped(txt[i .. i + 1]);
                i += 1;
            }
        }
    }

    /// Write text with entity and backslash escape decoding, then HTML-escape the result.
    /// Used for code fence info strings where entities are recognized.
    fn writeWithEntityDecoding(self: *HtmlRenderer, txt: []const u8) void {
        var i: usize = 0;
        while (i < txt.len) {
            if (txt[i] == '&') {
                const result = findEntityInText(txt, i);
                if (result.found) {
                    self.writeEntity(txt[i..result.end_pos]);
                    i = result.end_pos;
                    continue;
                }
            } else if (txt[i] == '\\' and i + 1 < txt.len and helpers.isAsciiPunctuation(txt[i + 1])) {
                self.writeHtmlEscaped(txt[i + 1 .. i + 2]);
                i += 2;
                continue;
            }
            self.writeHtmlEscaped(txt[i .. i + 1]);
            i += 1;
        }
    }

    fn writeEntity(self: *HtmlRenderer, entity_text: []const u8) void {
        // Numeric character reference: &#DDD; or &#xHHH;
        if (entity_text.len >= 4 and entity_text[0] == '&' and entity_text[1] == '#') {
            var cp: u32 = 0;
            if (entity_text[2] == 'x' or entity_text[2] == 'X') {
                for (entity_text[3..]) |ec| {
                    if (ec == ';') break;
                    cp = cp *% 16 +% switch (ec) {
                        '0'...'9' => ec - '0',
                        'a'...'f' => ec - 'a' + 10,
                        'A'...'F' => ec - 'A' + 10,
                        else => 0,
                    };
                }
            } else {
                for (entity_text[2..]) |ec| {
                    if (ec == ';') break;
                    cp = cp *% 10 +% (ec - '0');
                }
            }
            // Invalid or null codepoint -> U+FFFD
            if (cp == 0 or cp > 0x10FFFF or (cp >= 0xD800 and cp <= 0xDFFF)) {
                cp = 0xFFFD;
            }
            var buf: [4]u8 = undefined;
            const len = helpers.encodeUtf8(@intCast(cp), &buf);
            self.writeHtmlEscaped(buf[0..len]);
            return;
        }
        // Named entity
        if (entity_mod.lookup(entity_text)) |codepoints| {
            var buf: [4]u8 = undefined;
            var len = helpers.encodeUtf8(codepoints[0], &buf);
            self.writeHtmlEscaped(buf[0..len]);
            if (codepoints[1] != 0) {
                len = helpers.encodeUtf8(codepoints[1], &buf);
                self.writeHtmlEscaped(buf[0..len]);
            }
        } else {
            self.write(entity_text);
        }
    }

    /// Decode an entity and write its UTF-8 bytes as percent-encoded URL bytes.
    fn writeEntityToUrl(self: *HtmlRenderer, entity_text: []const u8) void {
        if (entity_text.len >= 4 and entity_text[0] == '&' and entity_text[1] == '#') {
            var cp: u32 = 0;
            if (entity_text[2] == 'x' or entity_text[2] == 'X') {
                for (entity_text[3..]) |ec| {
                    if (ec == ';') break;
                    cp = cp *% 16 +% switch (ec) {
                        '0'...'9' => ec - '0',
                        'a'...'f' => ec - 'a' + 10,
                        'A'...'F' => ec - 'A' + 10,
                        else => 0,
                    };
                }
            } else {
                for (entity_text[2..]) |ec| {
                    if (ec == ';') break;
                    cp = cp *% 10 +% (ec - '0');
                }
            }
            if (cp == 0 or cp > 0x10FFFF or (cp >= 0xD800 and cp <= 0xDFFF)) {
                cp = 0xFFFD;
            }
            var buf: [4]u8 = undefined;
            const len = helpers.encodeUtf8(@intCast(cp), &buf);
            for (buf[0..len]) |b| self.writeUrlByte(b);
        } else if (entity_mod.lookup(entity_text)) |codepoints| {
            var buf: [4]u8 = undefined;
            var len = helpers.encodeUtf8(codepoints[0], &buf);
            for (buf[0..len]) |b| self.writeUrlByte(b);
            if (codepoints[1] != 0) {
                len = helpers.encodeUtf8(codepoints[1], &buf);
                for (buf[0..len]) |b| self.writeUrlByte(b);
            }
        } else {
            self.writeUrlEscaped(entity_text);
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

    // ========================================
    // Static helpers
    // ========================================

    fn hexDigit(v: u8) u8 {
        return if (v < 10) '0' + v else 'A' + v - 10;
    }

    /// Find an entity in text starting at `start`. This is a pure function
    /// that does not require parser state.
    fn findEntityInText(content: []const u8, start: usize) struct { found: bool, end_pos: usize } {
        if (start + 2 >= content.len) return .{ .found = false, .end_pos = 0 };

        // Numeric entity
        if (content[start + 1] == '#') {
            var pos = start + 2;
            if (pos < content.len and (content[pos] == 'x' or content[pos] == 'X')) {
                // Hex
                pos += 1;
                const digit_start = pos;
                while (pos < content.len and helpers.isHexDigit(content[pos]) and pos - digit_start < 6)
                    pos += 1;
                if (pos > digit_start and pos < content.len and content[pos] == ';') {
                    return .{ .found = true, .end_pos = pos + 1 };
                }
            } else {
                // Decimal
                const digit_start = pos;
                while (pos < content.len and helpers.isDigit(content[pos]) and pos - digit_start < 7)
                    pos += 1;
                if (pos > digit_start and pos < content.len and content[pos] == ';') {
                    return .{ .found = true, .end_pos = pos + 1 };
                }
            }
            return .{ .found = false, .end_pos = 0 };
        }

        // Named entity
        var pos = start + 1;
        if (pos < content.len and helpers.isAlpha(content[pos])) {
            pos += 1;
            while (pos < content.len and helpers.isAlphaNum(content[pos]) and pos - start < 48)
                pos += 1;
            if (pos < content.len and content[pos] == ';') {
                if (entity_mod.lookup(content[start .. pos + 1]) != null) {
                    return .{ .found = true, .end_pos = pos + 1 };
                }
            }
        }

        return .{ .found = false, .end_pos = 0 };
    }
};
