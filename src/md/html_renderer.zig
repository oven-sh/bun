pub const HtmlRenderer = struct {
    out: OutputBuffer,
    allocator: Allocator,
    src_text: []const u8,
    image_nesting_level: u32 = 0,
    saved_img_title: []const u8 = "",
    tag_filter: bool = false,
    tag_filter_raw_depth: u32 = 0,
    autolink_headings: bool = false,
    heading_buf: std.ArrayListUnmanaged(u8) = .{},
    heading_tracker: helpers.HeadingIdTracker = helpers.HeadingIdTracker.init(false),

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

    pub fn init(allocator: Allocator, src_text: []const u8, render_opts: RenderOptions) HtmlRenderer {
        return .{
            .out = .{ .list = .{}, .allocator = allocator, .oom = false },
            .allocator = allocator,
            .src_text = src_text,
            .tag_filter = render_opts.tag_filter,
            .autolink_headings = render_opts.autolink_headings,
            .heading_tracker = helpers.HeadingIdTracker.init(render_opts.heading_ids),
        };
    }

    pub fn deinit(self: *HtmlRenderer) void {
        self.out.list.deinit(self.allocator);
        self.heading_buf.deinit(self.allocator);
        self.heading_tracker.deinit(self.allocator);
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

    fn enterBlockImpl(ptr: *anyopaque, block_type: BlockType, data: u32, flags: u32) bun.JSError!void {
        const self: *HtmlRenderer = @ptrCast(@alignCast(ptr));
        self.enterBlock(block_type, data, flags);
    }

    fn leaveBlockImpl(ptr: *anyopaque, block_type: BlockType, data: u32) bun.JSError!void {
        const self: *HtmlRenderer = @ptrCast(@alignCast(ptr));
        self.leaveBlock(block_type, data);
    }

    fn enterSpanImpl(ptr: *anyopaque, span_type: SpanType, detail: SpanDetail) bun.JSError!void {
        const self: *HtmlRenderer = @ptrCast(@alignCast(ptr));
        self.enterSpan(span_type, detail);
    }

    fn leaveSpanImpl(ptr: *anyopaque, span_type: SpanType) bun.JSError!void {
        const self: *HtmlRenderer = @ptrCast(@alignCast(ptr));
        self.leaveSpan(span_type);
    }

    fn textImpl(ptr: *anyopaque, text_type: TextType, content: []const u8) bun.JSError!void {
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
                const task_mark = types.taskMarkFromData(data);
                if (task_mark != 0) {
                    self.write("<li class=\"task-list-item\">");
                    if (types.isTaskChecked(task_mark)) {
                        self.write("<input type=\"checkbox\" class=\"task-list-item-checkbox\" disabled checked>");
                    } else {
                        self.write("<input type=\"checkbox\" class=\"task-list-item-checkbox\" disabled>");
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
                if (self.heading_tracker.enabled) {
                    self.heading_tracker.enterHeading();
                } else {
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
                }
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
                const alignment = types.alignmentFromData(data);
                if (types.alignmentName(alignment)) |name| {
                    self.write(" align=\"");
                    self.write(name);
                    self.write("\"");
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
                if (self.heading_tracker.leaveHeading(self.allocator)) |slug| {
                    // Write opening tag with id
                    self.out.write(switch (data) {
                        1 => "<h1",
                        2 => "<h2",
                        3 => "<h3",
                        4 => "<h4",
                        5 => "<h5",
                        else => "<h6",
                    });
                    self.out.write(" id=\"");
                    self.out.write(slug);
                    self.out.write("\">");
                    if (self.autolink_headings) {
                        self.out.write("<a href=\"#");
                        self.out.write(slug);
                        self.out.write("\">");
                    }
                    // Flush buffered heading content
                    self.out.write(self.heading_buf.items);
                    if (self.autolink_headings) {
                        self.out.write("</a>");
                    }
                    self.out.write(switch (data) {
                        1 => "</h1>\n",
                        2 => "</h2>\n",
                        3 => "</h3>\n",
                        4 => "</h4>\n",
                        5 => "</h5>\n",
                        else => "</h6>\n",
                    });
                    self.heading_buf.clearRetainingCapacity();
                    self.heading_tracker.clearAfterHeading();
                } else {
                    const tag = switch (data) {
                        1 => "</h1>\n",
                        2 => "</h2>\n",
                        3 => "</h3>\n",
                        4 => "</h4>\n",
                        5 => "</h5>\n",
                        else => "</h6>\n",
                    };
                    self.write(tag);
                }
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

        // Track plain text for slug generation when inside a heading
        self.heading_tracker.trackText(text_type, content, self.allocator);

        switch (text_type) {
            .null_char => self.write("\xEF\xBF\xBD"),
            .br => {
                if (in_image) self.write(" ") else self.write("<br />\n");
            },
            .softbr => {
                if (in_image) self.write(" ") else self.write("\n");
            },
            .html => {
                if (self.tag_filter) {
                    // Track entry/exit of disallowed tag raw zones
                    self.updateTagFilterRawDepth(content);
                    self.writeHtmlWithTagFilter(content);
                } else {
                    self.write(content);
                }
            },
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
            else => {
                // When inside a tag-filtered disallowed tag, emit text as raw
                if (self.tag_filter and self.tag_filter_raw_depth > 0) {
                    self.write(content);
                } else {
                    self.writeHtmlEscaped(content);
                }
            },
        }
    }

    // ========================================
    // HTML writing utilities
    // ========================================

    pub fn write(self: *HtmlRenderer, data: []const u8) void {
        if (self.heading_tracker.in_heading) {
            self.heading_buf.appendSlice(self.allocator, data) catch {
                self.out.oom = true;
            };
        } else {
            self.out.write(data);
        }
    }

    fn writeByte(self: *HtmlRenderer, b: u8) void {
        if (self.heading_tracker.in_heading) {
            self.heading_buf.append(self.allocator, b) catch {
                self.out.oom = true;
            };
        } else {
            self.out.writeByte(b);
        }
    }

    /// Track whether we're inside a disallowed tag's raw zone.
    /// When an opening disallowed tag is seen, increment depth.
    /// When a closing disallowed tag is seen, decrement depth.
    fn updateTagFilterRawDepth(self: *HtmlRenderer, content: []const u8) void {
        if (content.len < 2 or content[0] != '<') return;
        if (content[1] == '/') {
            // Closing tag
            if (isDisallowedTag(content) and self.tag_filter_raw_depth > 0) {
                self.tag_filter_raw_depth -= 1;
            }
        } else {
            // Opening tag (not self-closing)
            if (isDisallowedTag(content)) {
                // Check if NOT self-closing (doesn't end with "/>")
                if (content[content.len - 2] != '/' or content[content.len - 1] != '>') {
                    self.tag_filter_raw_depth += 1;
                }
            }
        }
    }

    /// Write HTML content with GFM tag filter applied. Scans for disallowed
    /// tags and replaces their leading `<` with `&lt;`.
    fn writeHtmlWithTagFilter(self: *HtmlRenderer, content: []const u8) void {
        var start: usize = 0;
        var i: usize = 0;
        while (i < content.len) {
            if (content[i] == '<' and isDisallowedTag(content[i..])) {
                // Write everything before this '<'
                if (i > start) self.write(content[start..i]);
                self.write("&lt;");
                start = i + 1;
            }
            i += 1;
        }
        if (start < content.len) self.write(content[start..]);
    }

    fn ensureNewline(self: *HtmlRenderer) void {
        if (self.heading_tracker.in_heading) {
            const items = self.heading_buf.items;
            if (items.len > 0 and items[items.len - 1] != '\n') {
                self.heading_buf.append(self.allocator, '\n') catch {
                    self.out.oom = true;
                };
            }
        } else {
            const items = self.out.list.items;
            if (items.len > 0 and items[items.len - 1] != '\n') {
                self.out.writeByte('\n');
            }
        }
    }

    pub fn writeHtmlEscaped(self: *HtmlRenderer, txt: []const u8) void {
        var i: usize = 0;
        const needle = "&<>\"";

        while (true) {
            const next = bun.strings.indexOfAny(txt[i..], needle) orelse {
                self.write(txt[i..]);
                return;
            };
            const pos = i + next;
            if (pos > i)
                self.write(txt[i..pos]);
            const c = txt[pos];
            switch (c) {
                '&' => self.write("&amp;"),
                '<' => self.write("&lt;"),
                '>' => self.write("&gt;"),
                '"' => self.write("&quot;"),
                else => unreachable,
            }
            i = pos + 1;
        }
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
                if (findEntityInText(txt, i)) |end_pos| {
                    self.writeEntityToUrl(txt[i..end_pos]);
                    i = end_pos;
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
                if (findEntityInText(txt, i)) |end_pos| {
                    self.writeEntity(txt[i..end_pos]);
                    i = end_pos;
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
                if (findEntityInText(txt, i)) |end_pos| {
                    self.writeEntity(txt[i..end_pos]);
                    i = end_pos;
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
        var buf: [8]u8 = undefined;
        if (helpers.decodeEntityToUtf8(entity_text, &buf)) |decoded| {
            self.writeHtmlEscaped(decoded);
        } else {
            self.write(entity_text);
        }
    }

    /// Decode an entity and write its UTF-8 bytes as percent-encoded URL bytes.
    fn writeEntityToUrl(self: *HtmlRenderer, entity_text: []const u8) void {
        var buf: [8]u8 = undefined;
        if (helpers.decodeEntityToUtf8(entity_text, &buf)) |decoded| {
            for (decoded) |b| self.writeUrlByte(b);
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

    /// GFM 6.11: Check if HTML content starts with a disallowed tag.
    /// Disallowed tags have their leading `<` replaced with `&lt;`.
    fn isDisallowedTag(content: []const u8) bool {
        // Must start with '<', optionally followed by '/'
        if (content.len < 2 or content[0] != '<') return false;
        const after_lt: usize = if (content[1] == '/') 2 else 1;
        if (after_lt >= content.len) return false;

        const disallowed = [_][]const u8{
            "title",   "textarea", "style",  "xmp",       "iframe",
            "noembed", "noframes", "script", "plaintext",
        };
        inline for (disallowed) |tag| {
            if (matchTagNameCI(content, after_lt, tag)) return true;
        }
        return false;
    }

    /// Case-insensitive match of tag name at `pos` in `content`.
    /// After the name, the next char must be '>', '/', whitespace, or end of string.
    fn matchTagNameCI(content: []const u8, pos: usize, tag: []const u8) bool {
        if (pos + tag.len > content.len) return false;
        if (!bun.strings.eqlCaseInsensitiveASCIIIgnoreLength(content[pos..][0..tag.len], tag)) return false;
        // Check delimiter after tag name
        const end = pos + tag.len;
        if (end >= content.len) return true;
        return switch (content[end]) {
            '>', ' ', '\t', '\n', '/' => true,
            else => false,
        };
    }

    /// Find an entity in text starting at `start`. Delegates to helpers.findEntity.
    fn findEntityInText(content: []const u8, start: usize) ?usize {
        return helpers.findEntity(content, start);
    }
};

const bun = @import("bun");
const helpers = @import("./helpers.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const root = @import("./root.zig");
const RenderOptions = root.RenderOptions;

const types = @import("./types.zig");
const BlockType = types.BlockType;
const Renderer = types.Renderer;
const SpanDetail = types.SpanDetail;
const SpanType = types.SpanType;
const TextType = types.TextType;
