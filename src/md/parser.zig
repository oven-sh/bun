/// Result buffer for HTML output.
const OutputBuffer = struct {
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

/// Parser context holding all state during parsing.
const Parser = struct {
    allocator: Allocator,
    text: []const u8,
    size: OFF,
    flags: Flags,

    // Output
    out: *OutputBuffer,
    image_nesting_level: u32 = 0,
    link_nesting_level: u32 = 0,

    // Code indent offset: 4 normally, maxInt if no_indented_code_blocks
    code_indent_offset: u32,
    doc_ends_with_newline: bool,

    // Mark character map
    mark_char_map: [256]bool = [_]bool{false} ** 256,

    // Dynamic arrays
    marks: std.ArrayListUnmanaged(Mark) = .{},
    containers: std.ArrayListUnmanaged(Container) = .{},
    block_bytes: std.ArrayListAlignedUnmanaged(u8, .@"4") = .{},
    buffer: std.ArrayListUnmanaged(u8) = .{},
    emph_delims: std.ArrayListUnmanaged(EmphDelim) = .{},

    // Number of active containers
    n_containers: u32 = 0,

    // Current block being built
    current_block: ?usize = null,
    current_block_lines: std.ArrayListUnmanaged(VerbatimLine) = .{},

    // Opener stacks
    opener_stacks: [types.NUM_OPENER_STACKS]types.OpenerStack =
        [_]types.OpenerStack{.{}} ** types.NUM_OPENER_STACKS,

    // Linked lists through marks
    unresolved_link_head: i32 = -1,
    unresolved_link_tail: i32 = -1,
    table_cell_boundaries_head: i32 = -1,
    table_cell_boundaries_tail: i32 = -1,

    // HTML block tracking
    html_block_type: u8 = 0,
    // Fenced code block indent
    fence_indent: u32 = 0,

    // Table column alignments
    table_col_count: u32 = 0,
    table_alignments: [64]Align = [_]Align{.default} ** 64,

    // Ref defs
    ref_defs: std.ArrayListUnmanaged(RefDef) = .{},

    // State
    last_line_has_list_loosening_effect: bool = false,
    last_list_item_starts_with_two_blank_lines: bool = false,
    max_ref_def_output: u64 = 0,

    fn init(allocator: Allocator, text: []const u8, flags: Flags, out: *OutputBuffer) Parser {
        const size: OFF = @intCast(text.len);
        var p = Parser{
            .allocator = allocator,
            .text = text,
            .size = size,
            .flags = flags,
            .out = out,
            .code_indent_offset = if (flags.no_indented_code_blocks) std.math.maxInt(u32) else 4,
            .doc_ends_with_newline = size > 0 and helpers.isNewline(text[size - 1]),
            .max_ref_def_output = @min(@min(16 * @as(u64, size), 1024 * 1024), std.math.maxInt(u32)),
        };
        p.buildMarkCharMap();
        return p;
    }

    fn deinit(self: *Parser) void {
        self.marks.deinit(self.allocator);
        self.containers.deinit(self.allocator);
        self.block_bytes.deinit(self.allocator);
        self.buffer.deinit(self.allocator);
        self.current_block_lines.deinit(self.allocator);
        self.ref_defs.deinit(self.allocator);
        self.emph_delims.deinit(self.allocator);
    }

    inline fn ch(self: *const Parser, off: OFF) u8 {
        if (off >= self.size) return 0;
        return self.text[off];
    }

    fn buildMarkCharMap(self: *Parser) void {
        self.mark_char_map['\\'] = true;
        self.mark_char_map['*'] = true;
        self.mark_char_map['_'] = true;
        self.mark_char_map['`'] = true;
        self.mark_char_map['&'] = true;
        self.mark_char_map[';'] = true;
        self.mark_char_map['['] = true;
        self.mark_char_map['!'] = true;
        self.mark_char_map[']'] = true;
        self.mark_char_map[0] = true;
        if (!self.flags.no_html_spans) {
            self.mark_char_map['<'] = true;
            self.mark_char_map['>'] = true;
        }
        if (self.flags.strikethrough) self.mark_char_map['~'] = true;
        if (self.flags.latex_math) self.mark_char_map['$'] = true;
        if (self.flags.permissive_email_autolinks or self.flags.permissive_url_autolinks)
            self.mark_char_map[':'] = true;
        if (self.flags.permissive_email_autolinks) self.mark_char_map['@'] = true;
        if (self.flags.permissive_www_autolinks) self.mark_char_map['.'] = true;
        if (self.flags.collapse_whitespace) {
            self.mark_char_map[' '] = true;
            self.mark_char_map['\t'] = true;
            self.mark_char_map['\n'] = true;
            self.mark_char_map['\r'] = true;
        }
    }

    // ========================================
    // HTML Output Helpers
    // ========================================

    fn writeHtml(self: *Parser, data: []const u8) void {
        self.out.write(data);
    }

    /// Ensure the output ends with a newline. Used before block-level elements
    /// that should start on a new line (e.g., nested lists inside tight list items).
    fn ensureNewline(self: *Parser) void {
        const items = self.out.list.items;
        if (items.len > 0 and items[items.len - 1] != '\n') {
            self.out.writeByte('\n');
        }
    }

    fn writeHtmlEscaped(self: *Parser, text: []const u8) void {
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
                if (i > start) self.writeHtml(text[start..i]);
                self.writeHtml(r);
                start = i + 1;
            }
        }
        if (start < text.len) self.writeHtml(text[start..]);
    }

    /// Write text with entity and backslash escape decoding, then HTML-escape the result.
    /// Used for code fence info strings where entities are recognized.
    fn writeWithEntityDecoding(self: *Parser, text: []const u8) void {
        var i: usize = 0;
        while (i < text.len) {
            if (text[i] == '&') {
                // Try to find entity
                const result = self.findEntity(text, i);
                if (result.found) {
                    self.writeEntity(text[i..result.end_pos]);
                    i = result.end_pos;
                    continue;
                }
            } else if (text[i] == '\\' and i + 1 < text.len and helpers.isAsciiPunctuation(text[i + 1])) {
                self.writeHtmlEscaped(text[i + 1 .. i + 2]);
                i += 2;
                continue;
            }
            self.writeHtmlEscaped(text[i .. i + 1]);
            i += 1;
        }
    }

    fn writeUrlEscaped(self: *Parser, text: []const u8) void {
        for (text) |byte| {
            self.writeUrlByte(byte);
        }
    }

    fn writeUrlByte(self: *Parser, byte: u8) void {
        switch (byte) {
            '&' => self.writeHtml("&amp;"),
            '\'' => self.writeHtml("&#x27;"),
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
            => self.out.writeByte(byte),
            else => {
                var buf: [3]u8 = undefined;
                buf[0] = '%';
                buf[1] = hexDigit(byte >> 4);
                buf[2] = hexDigit(byte & 0x0F);
                self.writeHtml(&buf);
            },
        }
    }

    /// Write URL with backslash escape and entity processing.
    fn writeUrlWithEscapes(self: *Parser, text: []const u8) void {
        var i: usize = 0;
        while (i < text.len) {
            if (text[i] == '\\' and i + 1 < text.len and helpers.isAsciiPunctuation(text[i + 1])) {
                self.writeUrlByte(text[i + 1]);
                i += 2;
            } else if (text[i] == '&') {
                const ent_result = self.findEntity(text, i);
                if (ent_result.found) {
                    self.writeEntityToUrl(text[i..ent_result.end_pos]);
                    i = ent_result.end_pos;
                } else {
                    self.writeHtml("&amp;");
                    i += 1;
                }
            } else {
                self.writeUrlByte(text[i]);
                i += 1;
            }
        }
    }

    /// Write title attribute with backslash escape and entity processing (HTML-escaped).
    fn writeTitleWithEscapes(self: *Parser, text: []const u8) void {
        var i: usize = 0;
        while (i < text.len) {
            if (text[i] == '\\' and i + 1 < text.len and helpers.isAsciiPunctuation(text[i + 1])) {
                self.writeHtmlEscaped(text[i + 1 .. i + 2]);
                i += 2;
            } else if (text[i] == '&') {
                const ent_result = self.findEntity(text, i);
                if (ent_result.found) {
                    self.writeEntity(text[i..ent_result.end_pos]);
                    i = ent_result.end_pos;
                } else {
                    self.writeHtml("&amp;");
                    i += 1;
                }
            } else {
                self.writeHtmlEscaped(text[i .. i + 1]);
                i += 1;
            }
        }
    }

    /// Decode an entity and write its UTF-8 bytes as percent-encoded URL bytes.
    fn writeEntityToUrl(self: *Parser, entity_text: []const u8) void {
        // Decode to codepoint(s), then UTF-8 encode, then percent-encode each byte
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

    fn hexDigit(v: u8) u8 {
        return if (v < 10) '0' + v else 'A' + v - 10;
    }

    fn writeDecimal(self: *Parser, value: u32) void {
        var buf: [10]u8 = undefined;
        var v = value;
        var i: usize = buf.len;
        if (v == 0) {
            self.out.writeByte('0');
            return;
        }
        while (v > 0) {
            i -= 1;
            buf[i] = @intCast('0' + v % 10);
            v /= 10;
        }
        self.writeHtml(buf[i..]);
    }

    fn writeUtf8Codepoint(self: *Parser, cp: u21) void {
        var buf: [4]u8 = undefined;
        const len = helpers.encodeUtf8(cp, &buf);
        self.writeHtml(buf[0..len]);
    }

    fn writeEntity(self: *Parser, entity_text: []const u8) void {
        // Numeric character reference: &#DDD; or &#xHHH;
        if (entity_text.len >= 4 and entity_text[0] == '&' and entity_text[1] == '#') {
            var cp: u32 = 0;
            if (entity_text[2] == 'x' or entity_text[2] == 'X') {
                // Hex
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
                // Decimal
                for (entity_text[2..]) |ec| {
                    if (ec == ';') break;
                    cp = cp *% 10 +% (ec - '0');
                }
            }
            // Invalid or null codepoint → U+FFFD
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
            self.writeHtml(entity_text);
        }
    }

    // ========================================
    // Block-level HTML rendering
    // ========================================

    fn enterBlock(self: *Parser, block_type: BlockType, data: u32, flags: u32) void {
        if (self.image_nesting_level > 0) return;
        switch (block_type) {
            .doc => {},
            .quote => {
                self.ensureNewline();
                self.writeHtml("<blockquote>\n");
            },
            .ul => {
                self.ensureNewline();
                self.writeHtml("<ul>\n");
            },
            .ol => {
                self.ensureNewline();
                const start = data;
                if (start == 1) {
                    self.writeHtml("<ol>\n");
                } else {
                    self.writeHtml("<ol start=\"");
                    self.writeDecimal(start);
                    self.writeHtml("\">\n");
                }
            },
            .li => {
                const task_mark: u8 = @truncate(data);
                if (task_mark != 0) {
                    self.writeHtml("<li class=\"task-list-item\">");
                    if (task_mark == ' ') {
                        self.writeHtml("<input type=\"checkbox\" class=\"task-list-item-checkbox\" disabled>");
                    } else {
                        self.writeHtml("<input type=\"checkbox\" class=\"task-list-item-checkbox\" disabled checked>");
                    }
                } else {
                    self.writeHtml("<li>");
                }
            },
            .hr => {
                self.ensureNewline();
                self.writeHtml("<hr />\n");
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
                self.writeHtml(tag);
            },
            .code => {
                self.ensureNewline();
                self.writeHtml("<pre><code");
                if (flags & types.BLOCK_FENCED_CODE != 0) {
                    const info_beg = data;
                    // Find end of language token (first word of info string)
                    var lang_end = info_beg;
                    while (lang_end < self.size and !helpers.isBlank(self.text[lang_end]) and
                        !helpers.isNewline(self.text[lang_end]))
                    {
                        lang_end += 1;
                    }
                    if (lang_end > info_beg) {
                        self.writeHtml(" class=\"language-");
                        self.writeWithEntityDecoding(self.text[info_beg..lang_end]);
                        self.writeHtml("\"");
                    }
                }
                self.writeHtml(">");
            },
            .html => self.ensureNewline(),
            .p => {
                self.ensureNewline();
                self.writeHtml("<p>");
            },
            .table => {
                self.ensureNewline();
                self.writeHtml("<table>\n");
            },
            .thead => self.writeHtml("<thead>\n"),
            .tbody => self.writeHtml("<tbody>\n"),
            .tr => self.writeHtml("<tr>"),
            .th, .td => {
                const tag = if (block_type == .th) "<th" else "<td";
                self.writeHtml(tag);
                // alignment from data
                const alignment: Align = @enumFromInt(@as(u2, @truncate(data)));
                switch (alignment) {
                    .left => self.writeHtml(" align=\"left\""),
                    .center => self.writeHtml(" align=\"center\""),
                    .right => self.writeHtml(" align=\"right\""),
                    .default => {},
                }
                self.writeHtml(">");
            },
        }
    }

    fn leaveBlock(self: *Parser, block_type: BlockType, data: u32) void {
        if (self.image_nesting_level > 0) return;
        switch (block_type) {
            .doc => {},
            .quote => self.writeHtml("</blockquote>\n"),
            .ul => self.writeHtml("</ul>\n"),
            .ol => self.writeHtml("</ol>\n"),
            .li => self.writeHtml("</li>\n"),
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
                self.writeHtml(tag);
            },
            .code => self.writeHtml("</code></pre>\n"),
            .html => {},
            .p => {
                self.writeHtml("</p>\n");
            },
            .table => self.writeHtml("</table>\n"),
            .thead => self.writeHtml("</thead>\n"),
            .tbody => self.writeHtml("</tbody>\n"),
            .tr => self.writeHtml("</tr>\n"),
            .th => self.writeHtml("</th>"),
            .td => self.writeHtml("</td>"),
        }
    }

    fn enterSpan(self: *Parser, span_type: SpanType) void {
        if (self.image_nesting_level > 0) {
            if (span_type == .img) self.image_nesting_level += 1;
            return;
        }
        switch (span_type) {
            .em => self.writeHtml("<em>"),
            .strong => self.writeHtml("<strong>"),
            .u => self.writeHtml("<u>"),
            .code => self.writeHtml("<code>"),
            .del => self.writeHtml("<del>"),
            .latexmath => self.writeHtml("<x-equation>"),
            .latexmath_display => self.writeHtml("<x-equation type=\"display\">"),
            else => {},
        }
    }

    fn leaveSpan(self: *Parser, span_type: SpanType) void {
        if (self.image_nesting_level > 0) {
            if (span_type == .img) {
                self.image_nesting_level -= 1;
                if (self.image_nesting_level == 0) {
                    self.writeHtml("\" />");
                }
            }
            return;
        }
        switch (span_type) {
            .em => self.writeHtml("</em>"),
            .strong => self.writeHtml("</strong>"),
            .u => self.writeHtml("</u>"),
            .a => self.writeHtml("</a>"),
            .code => self.writeHtml("</code>"),
            .del => self.writeHtml("</del>"),
            .latexmath => self.writeHtml("</x-equation>"),
            .latexmath_display => self.writeHtml("</x-equation>"),
            .wikilink => self.writeHtml("</x-wikilink>"),
            .img => {},
        }
    }

    fn emitText(self: *Parser, text_type: TextType, content: []const u8) void {
        switch (text_type) {
            .null_char => self.writeHtml("\xEF\xBF\xBD"),
            .br => {
                if (self.image_nesting_level == 0)
                    self.writeHtml("<br />\n")
                else
                    self.writeHtml(" ");
            },
            .softbr => {
                if (self.image_nesting_level == 0)
                    self.writeHtml("\n")
                else
                    self.writeHtml(" ");
            },
            .html => self.writeHtml(content),
            .entity => self.writeEntity(content),
            .code => {
                // In code spans, newlines become spaces
                var start: usize = 0;
                for (content, 0..) |byte, j| {
                    if (byte == '\n') {
                        if (j > start) self.writeHtmlEscaped(content[start..j]);
                        self.writeHtml(" ");
                        start = j + 1;
                    }
                }
                if (start < content.len) self.writeHtmlEscaped(content[start..]);
            },
            else => self.writeHtmlEscaped(content),
        }
    }

    // ========================================
    // Document Processing
    // ========================================

    fn processDoc(self: *Parser) error{OutOfMemory}!void {
        const dummy_blank = Line{ .type = .blank };
        var pivot_line = dummy_blank;
        var line_buf: [2]Line = .{ .{}, .{} };
        var line_idx: u1 = 0;
        var off: OFF = 0;

        self.enterBlock(.doc, 0, 0);

        while (off < self.size) {
            const line = &line_buf[line_idx];

            try self.analyzeLine(off, &off, &pivot_line, line);
            try self.processLine(&pivot_line, line, &line_buf, &line_idx);
        }

        try self.endCurrentBlock();

        // Build ref def hashtable
        try self.buildRefDefHashtable();

        // Process all blocks
        try self.leaveChildContainers(0);
        try self.processAllBlocks();

        self.leaveBlock(.doc, 0);
    }

    // ========================================
    // Line Analysis
    // ========================================

    fn analyzeLine(self: *Parser, off_start: OFF, p_end: *OFF, pivot_line: *const Line, line: *Line) error{OutOfMemory}!void {
        var off = off_start;
        var total_indent: u32 = 0;
        var n_parents: u32 = 0;
        var n_brothers: u32 = 0;
        var n_children: u32 = 0;
        var container = Container{};
        const prev_line_has_list_loosening_effect = self.last_line_has_list_loosening_effect;

        line.* = .{};
        line.enforce_new_block = false;

        // Eat indentation and match containers
        const indent_result = helpers.lineIndentation(self.text, total_indent, off);
        line.indent = indent_result.indent;
        total_indent += line.indent;
        off = indent_result.off;
        line.beg = off;

        // Match existing containers
        // remaining_indent tracks the indent left after subtracting each matched
        // container's contents_indent. This ensures nested containers compare
        // against the correct relative indentation rather than the absolute column.
        var remaining_indent = total_indent;
        while (n_parents < self.n_containers) {
            const c = &self.containers.items[n_parents];
            if (c.ch == '>') {
                // Blockquote continuation
                if (off < self.size and self.text[off] == '>' and line.indent < self.code_indent_offset) {
                    off += 1;
                    total_indent += 1;
                    const r = helpers.lineIndentation(self.text, total_indent, off);
                    line.indent = r.indent;
                    total_indent += line.indent;
                    off = r.off;
                    // The optional 1st space after '>' is part of the blockquote mark
                    if (line.indent > 0) line.indent -= 1;
                    // Use local indent (after optional-space adjustment) for subsequent
                    // list container matching, matching md4c's use of line->indent.
                    remaining_indent = line.indent;
                    line.beg = off;
                    n_parents += 1;
                    continue;
                } else {
                    break;
                }
            } else {
                // List continuation - check indentation against remaining indent
                if (remaining_indent >= c.contents_indent) {
                    remaining_indent -= c.contents_indent;
                    line.indent = remaining_indent;
                    n_parents += 1;
                    continue;
                } else {
                    break;
                }
            }
        }

        self.last_line_has_list_loosening_effect = false;

        // Blank line lazy-matches list containers BEFORE the main detection loop
        // (md4c does this outside while(TRUE) to ensure n_parents is correct for
        // fenced code and HTML block container-boundary checks)
        if (off >= self.size or helpers.isNewline(self.text[off])) {
            if (n_brothers + n_children == 0) {
                while (n_parents < self.n_containers and
                    self.containers.items[n_parents].ch != '>')
                {
                    n_parents += 1;
                }
            }
        }

        // Track effective pivot type — brother/child containers reset this to .blank
        var effective_pivot_type = pivot_line.type;

        // Determine line type
        while (true) {
            // Check for fenced code continuation/closing (BEFORE blank line check, like md4c)
            if (effective_pivot_type == .fencedcode) {
                line.beg = off;

                // Check for closing fence
                if (line.indent < self.code_indent_offset) {
                    if (self.isClosingCodeFence(off, pivot_line.data)) {
                        line.type = .blank; // ending fence treated as blank
                        self.last_line_has_list_loosening_effect = false;
                        break;
                    }
                }

                // Fenced code continuation only if all containers matched (md4c: n_parents == n_containers)
                if (n_parents == self.n_containers) {
                    if (line.indent > self.fence_indent)
                        line.indent -= self.fence_indent
                    else
                        line.indent = 0;
                    line.type = .fencedcode;
                    break;
                }
                // If containers don't match, fenced code is implicitly ended.
                // Fall through to other checks.
            }

            // Check for HTML block continuation (BEFORE blank line check, like md4c)
            if (effective_pivot_type == .html and self.html_block_type > 0) {
                if (n_parents < self.n_containers) {
                    // HTML block is implicitly ended when enclosing container closes
                    self.html_block_type = 0;
                } else {
                    if (self.isHtmlBlockEndCondition(off, self.html_block_type)) {
                        // Save type before clearing (md4c uses a local variable)
                        const ended_type = self.html_block_type;
                        self.html_block_type = 0;

                        // Types 6 and 7 end conditions also serve as blank lines
                        if (ended_type == 6 or ended_type == 7) {
                            line.type = .blank;
                            line.indent = 0;
                            break;
                        }
                    }
                    line.type = .html;
                    n_parents = self.n_containers;
                    break;
                }
            }

            // Check for blank line
            if (off >= self.size or helpers.isNewline(self.text[off])) {
                // Indented code continuation through blank lines
                if (effective_pivot_type == .indentedcode and n_parents == self.n_containers) {
                    line.type = .indentedcode;
                    if (line.indent > self.code_indent_offset)
                        line.indent -= self.code_indent_offset
                    else
                        line.indent = 0;
                    self.last_line_has_list_loosening_effect = false;
                } else {
                    line.type = .blank;
                    self.last_line_has_list_loosening_effect = (n_parents > 0 and
                        n_brothers + n_children == 0 and
                        self.containers.items[n_parents - 1].ch != '>');

                    // HTML block types 6 and 7 end on a blank line
                    if (self.html_block_type >= 6) {
                        self.html_block_type = 0;
                    }

                    // md4c issue #6: Track empty list items that start with 2+ blank lines.
                    // A list item can begin with at most one blank line.
                    if (n_parents > 0 and self.containers.items[n_parents - 1].ch != '>' and
                        n_brothers + n_children == 0 and self.current_block == null and
                        self.block_bytes.items.len > @sizeOf(BlockHeader))
                    {
                        const align_mask_: usize = @alignOf(BlockHeader) - 1;
                        const top_off = (self.block_bytes.items.len - @sizeOf(BlockHeader) + align_mask_) & ~align_mask_;
                        if (top_off + @sizeOf(BlockHeader) <= self.block_bytes.items.len) {
                            const top_hdr: *const BlockHeader = @ptrCast(@alignCast(self.block_bytes.items.ptr + (self.block_bytes.items.len - @sizeOf(BlockHeader))));
                            if (top_hdr.block_type == .li) {
                                self.last_list_item_starts_with_two_blank_lines = true;
                            }
                        }
                    }
                }
                break;
            } else {
                // Non-blank line: check if we need to force-close an empty list item
                // (second half of md4c issue #6 hack)
                if (self.last_list_item_starts_with_two_blank_lines) {
                    if (n_parents > 0 and n_parents == self.n_containers and
                        self.containers.items[n_parents - 1].ch != '>' and
                        n_brothers + n_children == 0 and self.current_block == null and
                        self.block_bytes.items.len > @sizeOf(BlockHeader))
                    {
                        const top_hdr: *const BlockHeader = @ptrCast(@alignCast(self.block_bytes.items.ptr + (self.block_bytes.items.len - @sizeOf(BlockHeader))));
                        if (top_hdr.block_type == .li) {
                            n_parents -= 1;
                            line.indent = total_indent;
                            if (n_parents > 0)
                                line.indent -= @min(line.indent, self.containers.items[n_parents - 1].contents_indent);
                        }
                    }
                    self.last_list_item_starts_with_two_blank_lines = false;
                }
                self.last_line_has_list_loosening_effect = false;
            }

            // Indented code continuation
            if (effective_pivot_type == .indentedcode) {
                if (line.indent >= self.code_indent_offset) {
                    line.type = .indentedcode;
                    line.indent -= self.code_indent_offset;
                    line.data = 0;
                    break;
                }
            }

            // Check for Setext underline
            if (line.indent < self.code_indent_offset and effective_pivot_type == .text and
                off < self.size and (self.text[off] == '=' or self.text[off] == '-') and
                n_parents == self.n_containers)
            {
                const setext_result = self.isSetextUnderline(off);
                if (setext_result.is_setext) {
                    line.type = .setextunderline;
                    line.data = setext_result.level;
                    break;
                }
            }

            // Check for thematic break
            if (line.indent < self.code_indent_offset and off < self.size and
                (self.text[off] == '-' or self.text[off] == '_' or self.text[off] == '*'))
            {
                if (self.isHrLine(off)) {
                    line.type = .hr;
                    break;
                }
            }

            // Check for brother container (another list item in same list)
            if (n_parents < self.n_containers and n_brothers + n_children == 0) {
                const cont_result = self.isContainerMark(line.indent, off);
                if (cont_result.is_container) {
                    if (self.isContainerCompatible(&self.containers.items[n_parents], &cont_result.container)) {
                        effective_pivot_type = .blank;

                        container = cont_result.container;
                        off = cont_result.off;

                        total_indent += container.contents_indent - container.mark_indent;
                        const r = helpers.lineIndentation(self.text, total_indent, off);
                        line.indent = r.indent;
                        total_indent += line.indent;
                        off = r.off;
                        line.beg = off;

                        // Adjust whitespace belonging to mark
                        if (off >= self.size or helpers.isNewline(self.text[off])) {
                            container.contents_indent += 1;
                        } else if (line.indent <= self.code_indent_offset) {
                            container.contents_indent += line.indent;
                            line.indent = 0;
                        } else {
                            container.contents_indent += 1;
                            line.indent -= 1;
                        }

                        self.containers.items[n_parents].mark_indent = container.mark_indent;
                        self.containers.items[n_parents].contents_indent = container.contents_indent;

                        // HTML block ends when a new sibling container starts
                        self.html_block_type = 0;

                        n_brothers += 1;
                        continue;
                    }
                }
            }

            // Check for indented code
            if (line.indent >= self.code_indent_offset and effective_pivot_type != .text) {
                line.type = .indentedcode;
                line.indent -= self.code_indent_offset;
                line.data = 0;
                break;
            }

            // Check for new container block
            if (line.indent < self.code_indent_offset) {
                const cont_result = self.isContainerMark(line.indent, off);
                if (cont_result.is_container) {
                    container = cont_result.container;

                    // List mark can't interrupt paragraph unless it's > or ordered starting at 1
                    if (effective_pivot_type == .text and n_parents == self.n_containers) {
                        if ((off >= self.size or helpers.isNewline(self.ch(cont_result.off))) and container.ch != '>') {
                            // Blank after list mark can't interrupt paragraph
                        } else if ((container.ch == '.' or container.ch == ')') and container.start != 1) {
                            // Ordered list with start != 1 can't interrupt paragraph
                        } else {
                            off = cont_result.off;
                            total_indent += container.contents_indent - container.mark_indent;
                            const r = helpers.lineIndentation(self.text, total_indent, off);
                            line.indent = r.indent;
                            total_indent += line.indent;
                            off = r.off;
                            line.beg = off;
                            line.data = container.ch;

                            if (off >= self.size or helpers.isNewline(self.text[off])) {
                                container.contents_indent += 1;
                            } else if (line.indent <= self.code_indent_offset) {
                                container.contents_indent += line.indent;
                                line.indent = 0;
                            } else {
                                container.contents_indent += 1;
                                line.indent -= 1;
                            }

                            if (n_brothers + n_children == 0) {
                                effective_pivot_type = .blank;
                            }

                            if (n_children == 0) {
                                try self.endCurrentBlock();
                                try self.leaveChildContainers(n_parents + n_brothers);
                            }

                            n_children += 1;
                            try self.pushContainer(&container);
                            continue;
                        }
                    } else {
                        off = cont_result.off;
                        total_indent += container.contents_indent - container.mark_indent;
                        const r = helpers.lineIndentation(self.text, total_indent, off);
                        line.indent = r.indent;
                        total_indent += line.indent;
                        off = r.off;
                        line.beg = off;
                        line.data = container.ch;

                        if (off >= self.size or helpers.isNewline(self.text[off])) {
                            container.contents_indent += 1;
                        } else if (line.indent <= self.code_indent_offset) {
                            container.contents_indent += line.indent;
                            line.indent = 0;
                        } else {
                            container.contents_indent += 1;
                            line.indent -= 1;
                        }

                        if (n_brothers + n_children == 0) {
                            effective_pivot_type = .blank;
                        }

                        if (n_children == 0) {
                            try self.endCurrentBlock();
                            try self.leaveChildContainers(n_parents + n_brothers);
                        }

                        n_children += 1;
                        try self.pushContainer(&container);
                        continue;
                    }
                }
            }

            // Check for table continuation
            if (effective_pivot_type == .table and n_parents == self.n_containers) {
                line.type = .table;
                break;
            }

            // Check for ATX header
            if (line.indent < self.code_indent_offset and off < self.size and self.text[off] == '#') {
                const atx_result = self.isAtxHeaderLine(off);
                if (atx_result.is_atx) {
                    line.type = .atxheader;
                    line.data = atx_result.level;
                    line.beg = atx_result.content_beg;

                    // Trim trailing whitespace
                    while (line.end > line.beg and (helpers.isBlank(self.text[line.end - 1]) or self.text[line.end - 1] == '\t'))
                        line.end -= 1;
                    // Trim optional closing # sequence
                    if (line.end > line.beg and self.text[line.end - 1] == '#') {
                        var tmp = line.end;
                        while (tmp > line.beg and self.text[tmp - 1] == '#') tmp -= 1;
                        // The closing # must be preceded by space (or be the entire content)
                        if (tmp == line.beg or helpers.isBlank(self.text[tmp - 1])) {
                            line.end = tmp;
                            // Trim trailing whitespace again
                            while (line.end > line.beg and helpers.isBlank(self.text[line.end - 1]))
                                line.end -= 1;
                        }
                    }

                    break;
                }
            }

            // Check for opening code fence
            if (line.indent < self.code_indent_offset and off < self.size and
                (self.text[off] == '`' or self.text[off] == '~'))
            {
                const fence_result = self.isOpeningCodeFence(off);
                if (fence_result.is_fence) {
                    line.type = .fencedcode;
                    line.data = fence_result.fence_data;
                    line.enforce_new_block = true;
                    break;
                }
            }

            // Check for HTML block start
            if (off < self.size and self.text[off] == '<' and !self.flags.no_html_blocks) {
                self.html_block_type = self.isHtmlBlockStartCondition(off);

                // Type 7 can't interrupt paragraph
                if (self.html_block_type == 7 and effective_pivot_type == .text)
                    self.html_block_type = 0;

                if (self.html_block_type > 0) {
                    if (self.isHtmlBlockEndCondition(off, self.html_block_type)) {
                        self.html_block_type = 0;
                    }
                    line.enforce_new_block = true;
                    line.type = .html;
                    break;
                }
            }

            // Check for table underline
            if (self.flags.tables and effective_pivot_type == .text and
                off < self.size and (self.text[off] == '|' or self.text[off] == '-' or self.text[off] == ':') and
                n_parents == self.n_containers)
            {
                const tbl_result = self.isTableUnderline(off);
                if (tbl_result.is_underline and self.current_block != null and
                    self.current_block_lines.items.len <= 1)
                {
                    line.data = tbl_result.col_count;
                    line.type = .tableunderline;
                    break;
                }
            }

            // Default: normal text line
            line.type = .text;
            if (effective_pivot_type == .text and n_brothers + n_children == 0) {
                // Lazy continuation
                n_parents = self.n_containers;
            }

            // Check for task mark
            if (self.flags.tasklists and n_brothers + n_children > 0 and
                self.n_containers > 0 and
                isListItemMark(self.containers.items[self.n_containers - 1].ch))
            {
                var tmp = off;
                while (tmp < self.size and tmp < off + 3 and helpers.isBlank(self.text[tmp]))
                    tmp += 1;
                if (tmp + 2 < self.size and self.text[tmp] == '[' and
                    (self.text[tmp + 1] == 'x' or self.text[tmp + 1] == 'X' or self.text[tmp + 1] == ' ') and
                    self.text[tmp + 2] == ']' and
                    (tmp + 3 == self.size or helpers.isBlank(self.text[tmp + 3]) or helpers.isNewline(self.text[tmp + 3])))
                {
                    const task_container = if (n_children > 0) &self.containers.items[self.n_containers - 1] else &container;
                    task_container.is_task = true;
                    task_container.task_mark_off = @intCast(tmp + 1);
                    off = @intCast(tmp + 3);
                    while (off < self.size and helpers.isWhitespace(self.text[off]))
                        off += 1;
                    line.beg = off;
                }
            }

            break;
        }

        // Scan for end of line
        while (off < self.size and !helpers.isNewline(self.text[off]))
            off += 1;

        line.end = off;

        // Trim trailing closing marks for ATX header
        if (line.type == .atxheader) {
            var tmp = line.end;
            while (tmp > line.beg and helpers.isBlank(self.text[tmp - 1]))
                tmp -= 1;
            while (tmp > line.beg and self.text[tmp - 1] == '#')
                tmp -= 1;
            if (tmp == line.beg or helpers.isBlank(self.text[tmp - 1]) or self.flags.permissive_atx_headers)
                line.end = tmp;
        }

        // Trim trailing spaces (except for code/HTML/text)
        // Text lines keep trailing spaces for hard line break detection
        if (line.type != .indentedcode and line.type != .fencedcode and line.type != .html and line.type != .text) {
            while (line.end > line.beg and helpers.isBlank(self.text[line.end - 1]))
                line.end -= 1;
        }

        // Eat newline
        if (off < self.size and self.text[off] == '\r') off += 1;
        if (off < self.size and self.text[off] == '\n') off += 1;

        p_end.* = off;

        // Loose list detection
        if (prev_line_has_list_loosening_effect and line.type != .blank and n_parents + n_brothers > 0) {
            const ci = n_parents + n_brothers - 1;
            if (ci < self.containers.items.len and self.containers.items[ci].ch != '>') {
                self.containers.items[ci].is_loose = true;
            }
        }

        // Flush current leaf block before any container transitions
        // so that VerbatimLine data stays contiguous after its BlockHeader.
        if ((n_children == 0 and n_parents + n_brothers < self.n_containers) or n_brothers > 0 or n_children > 0) {
            try self.endCurrentBlock();
        }

        // Leave containers we're no longer part of
        if (n_children == 0 and n_parents + n_brothers < self.n_containers) {
            try self.leaveChildContainers(n_parents + n_brothers);
        }

        // Enter brother containers
        if (n_brothers > 0) {
            // Close old LI, open new LI
            try self.pushContainerBytes(.li, if (self.containers.items[n_parents].is_task) @as(u32, self.text[self.containers.items[n_parents].task_mark_off]) else 0, types.BLOCK_CONTAINER_CLOSER);
            try self.pushContainerBytes(.li, if (container.is_task) @as(u32, self.text[container.task_mark_off]) else 0, types.BLOCK_CONTAINER_OPENER);
            self.containers.items[n_parents].is_task = container.is_task;
            self.containers.items[n_parents].task_mark_off = container.task_mark_off;
        }

        if (n_children > 0) {
            try self.enterChildContainers(n_children);
        }
    }

    fn processLine(self: *Parser, pivot_line: *Line, line: *Line, line_buf: *[2]Line, line_idx: *u1) error{OutOfMemory}!void {
        // Blank line ends current leaf block.
        // Note: blank lines inside fenced code blocks are typed .fencedcode by analyzeLine,
        // and blank lines inside HTML blocks type 1-5 are typed .html by analyzeLine.
        // Only closing fences and actual block-ending blank lines reach here as .blank.
        if (line.type == .blank) {
            try self.endCurrentBlock();
            pivot_line.* = .{ .type = .blank };
            return;
        }

        // Opening code fence: start block but don't include fence line as content
        if (line.type == .fencedcode and line.enforce_new_block) {
            try self.endCurrentBlock();
            try self.startNewBlock(line);
            self.fence_indent = line.indent;

            // Extract info string position and store in block data
            if (self.current_block) |cb_off| {
                const hdr = self.getBlockHeaderAt(cb_off);
                const fence_count = line.data >> 8;
                var info_beg: OFF = line.beg + fence_count;
                // Skip whitespace before info string
                while (info_beg < line.end and helpers.isBlank(self.text[info_beg])) info_beg += 1;
                hdr.data = info_beg;
                hdr.flags |= types.BLOCK_FENCED_CODE;
            }
            pivot_line.* = line.*;
            return;
        }

        if (line.enforce_new_block)
            try self.endCurrentBlock();

        // Single-line blocks
        if (line.type == .hr or line.type == .atxheader) {
            try self.endCurrentBlock();
            try self.startNewBlock(line);
            try self.addLineToCurrentBlock(line);
            try self.endCurrentBlock();
            pivot_line.* = .{ .type = .blank };
            return;
        }

        // Setext underline changes current block to header
        if (line.type == .setextunderline) {
            if (self.current_block) |cb_off| {
                var blk = self.getBlockAt(cb_off);
                blk.block_type = .h;
                blk.data = line.data;
                blk.flags |= types.BLOCK_SETEXT_HEADER;
            }
            // Add the underline line (md4c stores it for ref def interaction)
            try self.addLineToCurrentBlock(line);
            try self.endCurrentBlock();
            if (self.current_block == null) {
                // Block was closed normally
                pivot_line.* = .{ .type = .blank };
            } else {
                // Block stayed open: all body was consumed as link ref defs,
                // underline downgraded to start of a new paragraph (md4c behavior)
                line.type = .text;
                pivot_line.* = line.*;
            }
            return;
        }

        // Table underline
        if (line.type == .tableunderline) {
            if (self.current_block) |cb_off| {
                var blk = self.getBlockAt(cb_off);
                blk.block_type = .table;
                blk.data = line.data;
            }
            // Change pivot to table
            pivot_line.type = .table;
            try self.addLineToCurrentBlock(line);
            return;
        }

        // Different line type ends current block
        if (line.type != pivot_line.type) {
            try self.endCurrentBlock();
        }

        // Start new block if needed
        if (self.current_block == null) {
            try self.startNewBlock(line);
            pivot_line.* = line.*;
        }

        // Add line to current block
        try self.addLineToCurrentBlock(line);

        // Ensure we alternate line buffers to avoid aliasing
        _ = line_buf;
        line_idx.* ^= 1;
    }

    // ========================================
    // Block helpers
    // ========================================

    fn startNewBlock(self: *Parser, line: *const Line) error{OutOfMemory}!void {
        const block_type: BlockType = switch (line.type) {
            .hr => .hr,
            .atxheader => .h,
            .fencedcode, .indentedcode => .code,
            .html => .html,
            .table, .tableunderline => .table,
            else => .p,
        };

        // Align block_bytes for Block alignment
        const align_mask: usize = @alignOf(BlockHeader) - 1;
        const cur_len = self.block_bytes.items.len;
        const aligned = (cur_len + align_mask) & ~align_mask;
        const needed = aligned + @sizeOf(BlockHeader);
        try self.block_bytes.ensureTotalCapacity(self.allocator, needed);
        // Zero-pad
        while (self.block_bytes.items.len < aligned) {
            try self.block_bytes.append(self.allocator, 0);
        }
        self.block_bytes.items.len = needed;

        const hdr = self.getBlockHeaderAt(aligned);
        hdr.* = .{
            .block_type = block_type,
            .flags = 0,
            .data = line.data,
            .n_lines = 0,
        };

        self.current_block = aligned;
        self.current_block_lines.clearRetainingCapacity();
    }

    fn addLineToCurrentBlock(self: *Parser, line: *const Line) error{OutOfMemory}!void {
        if (self.current_block) |cb_off| {
            const hdr = self.getBlockHeaderAt(cb_off);
            hdr.n_lines += 1;
            try self.current_block_lines.append(self.allocator, .{
                .beg = line.beg,
                .end = line.end,
                .indent = line.indent,
            });
        }
    }

    fn endCurrentBlock(self: *Parser) error{OutOfMemory}!void {
        if (self.current_block) |cb_off| {
            var hdr = self.getBlockHeaderAt(cb_off);

            // Consume link ref defs from setext headings (md4c: md_end_current_block).
            // For regular paragraphs, ref defs are consumed in buildRefDefHashtable.
            const is_setext = hdr.block_type == .h and (hdr.flags & types.BLOCK_SETEXT_HEADER) != 0;
            if (is_setext and hdr.n_lines > 0 and
                self.current_block_lines.items.len > 0 and
                self.current_block_lines.items[0].beg < self.size and
                self.text[self.current_block_lines.items[0].beg] == '[')
            {
                self.consumeRefDefsFromCurrentBlock();
                hdr = self.getBlockHeaderAt(cb_off);
            }

            // Handle setext heading after ref def consumption
            if (hdr.block_type == .h and (hdr.flags & types.BLOCK_SETEXT_HEADER) != 0) {
                if (hdr.n_lines > 1) {
                    // Remove the underline (last line)
                    hdr.n_lines -= 1;
                    _ = self.current_block_lines.pop();
                } else if (hdr.n_lines == 1) {
                    // Only underline left after eating ref defs → convert to paragraph,
                    // keep block open so subsequent lines join this paragraph (md4c behavior)
                    hdr.block_type = .p;
                    hdr.flags &= ~@as(u32, types.BLOCK_SETEXT_HEADER);
                    return; // Don't close the block!
                } else {
                    // All lines consumed (shouldn't normally happen)
                    hdr.flags |= types.BLOCK_REF_DEF_ONLY;
                }
            }

            // Write accumulated lines to block_bytes
            const line_bytes = std.mem.sliceAsBytes(self.current_block_lines.items);
            self.block_bytes.appendSlice(self.allocator, line_bytes) catch {};
            self.current_block = null;
        }
    }

    fn consumeRefDefsFromCurrentBlock(self: *Parser) void {
        const items = self.current_block_lines.items;
        if (items.len == 0) return;

        // Merge lines into buffer for ref def parsing
        self.buffer.clearRetainingCapacity();
        for (items) |vline| {
            if (vline.beg > vline.end or vline.end > self.size) continue;
            if (self.buffer.items.len > 0) {
                self.buffer.append(self.allocator, '\n') catch {};
            }
            self.buffer.appendSlice(self.allocator, self.text[vline.beg..vline.end]) catch {};
        }

        const merged = self.buffer.items;
        var pos: usize = 0;
        var lines_consumed: u32 = 0;

        while (pos < merged.len) {
            const result = self.parseRefDef(merged, pos) orelse break;

            const norm_label = self.normalizeLabel(result.label);
            if (norm_label.len == 0) break;

            // First definition wins
            var already_exists = false;
            for (self.ref_defs.items) |existing| {
                if (std.mem.eql(u8, existing.label, norm_label)) {
                    already_exists = true;
                    break;
                }
            }
            if (!already_exists) {
                const dest_dupe = self.allocator.dupe(u8, result.dest) catch return;
                const title_dupe = self.allocator.dupe(u8, result.title) catch return;
                self.ref_defs.append(self.allocator, .{
                    .label = norm_label,
                    .dest = dest_dupe,
                    .title = title_dupe,
                }) catch return;
            }

            var newlines: u32 = 0;
            for (merged[pos..result.end_pos]) |mc| {
                if (mc == '\n') newlines += 1;
            }
            if (result.end_pos >= merged.len and (result.end_pos == pos or merged[result.end_pos - 1] != '\n')) {
                newlines += 1;
            }
            lines_consumed += newlines;
            pos = result.end_pos;
        }

        if (lines_consumed > 0) {
            if (self.current_block) |cb_off| {
                var hdr = self.getBlockHeaderAt(cb_off);
                if (lines_consumed >= hdr.n_lines) {
                    // All lines consumed
                    self.current_block_lines.clearRetainingCapacity();
                    hdr.n_lines = 0;
                } else {
                    // Remove first lines_consumed lines
                    const remaining = items.len - lines_consumed;
                    std.mem.copyForwards(VerbatimLine, items[0..remaining], items[lines_consumed..]);
                    self.current_block_lines.shrinkRetainingCapacity(remaining);
                    hdr.n_lines -= lines_consumed;
                }
            }
        }
    }

    const BlockHeader = extern struct {
        block_type: BlockType,
        _pad: [3]u8 = .{ 0, 0, 0 },
        flags: u32,
        data: u32,
        n_lines: u32,
    };

    fn getBlockHeaderAt(self: *Parser, off: usize) *BlockHeader {
        return @ptrCast(@alignCast(self.block_bytes.items.ptr + off));
    }

    fn getBlockAt(self: *Parser, off: usize) *BlockHeader {
        return self.getBlockHeaderAt(off);
    }

    // ========================================
    // Container management
    // ========================================

    fn pushContainer(self: *Parser, c: *const Container) error{OutOfMemory}!void {
        if (self.n_containers >= self.containers.items.len) {
            try self.containers.append(self.allocator, c.*);
        } else {
            self.containers.items[self.n_containers] = c.*;
        }

        // Record block_byte offset in the container
        const block_off: u32 = @intCast(self.block_bytes.items.len);
        self.containers.items[self.n_containers].block_byte_off = block_off;

        self.n_containers += 1;
    }

    fn pushContainerBytes(self: *Parser, block_type: BlockType, data: u32, flags: u32) error{OutOfMemory}!void {
        const align_mask: usize = @alignOf(BlockHeader) - 1;
        const cur_len = self.block_bytes.items.len;
        const aligned = (cur_len + align_mask) & ~align_mask;
        const needed = aligned + @sizeOf(BlockHeader);
        try self.block_bytes.ensureTotalCapacity(self.allocator, needed);
        while (self.block_bytes.items.len < aligned) {
            try self.block_bytes.append(self.allocator, 0);
        }
        self.block_bytes.items.len = needed;

        const hdr = self.getBlockHeaderAt(aligned);
        hdr.* = .{
            .block_type = block_type,
            .flags = flags,
            .data = data,
            .n_lines = 0,
        };
    }

    fn enterChildContainers(self: *Parser, count: u32) error{OutOfMemory}!void {
        var i: u32 = self.n_containers - count;
        while (i < self.n_containers) : (i += 1) {
            const c = &self.containers.items[i];
            // Emit container opener blocks
            if (c.ch == '>') {
                try self.pushContainerBytes(.quote, 0, types.BLOCK_CONTAINER_OPENER);
            } else if (c.ch == '-' or c.ch == '+' or c.ch == '*') {
                // Save opener position for later loose-list patching
                const align_mask_: usize = @alignOf(BlockHeader) - 1;
                c.block_byte_off = @intCast((self.block_bytes.items.len + align_mask_) & ~align_mask_);
                // Unordered list + list item
                try self.pushContainerBytes(.ul, 0, types.BLOCK_CONTAINER_OPENER);
                try self.pushContainerBytes(.li, if (c.is_task) @as(u32, self.text[c.task_mark_off]) else 0, types.BLOCK_CONTAINER_OPENER);
            } else if (c.ch == '.' or c.ch == ')') {
                // Save opener position for later loose-list patching
                const align_mask_: usize = @alignOf(BlockHeader) - 1;
                c.block_byte_off = @intCast((self.block_bytes.items.len + align_mask_) & ~align_mask_);
                // Ordered list + list item
                try self.pushContainerBytes(.ol, c.start, types.BLOCK_CONTAINER_OPENER);
                try self.pushContainerBytes(.li, if (c.is_task) @as(u32, self.text[c.task_mark_off]) else 0, types.BLOCK_CONTAINER_OPENER);
            }
        }
    }

    fn leaveChildContainers(self: *Parser, keep: u32) error{OutOfMemory}!void {
        while (self.n_containers > keep) {
            self.n_containers -= 1;
            const c = &self.containers.items[self.n_containers];
            const loose_flag: u32 = if (c.is_loose) types.BLOCK_LOOSE_LIST else 0;

            // Emit container closer blocks
            if (c.ch == '>') {
                try self.pushContainerBytes(.quote, 0, types.BLOCK_CONTAINER_CLOSER);
            } else if (c.ch == '-' or c.ch == '+' or c.ch == '*') {
                // Retroactively patch the opener with loose flag
                if (c.is_loose and c.block_byte_off < self.block_bytes.items.len) {
                    const opener_hdr = self.getBlockHeaderAt(c.block_byte_off);
                    opener_hdr.flags |= types.BLOCK_LOOSE_LIST;
                }
                try self.pushContainerBytes(.li, if (c.is_task) @as(u32, self.text[c.task_mark_off]) else 0, types.BLOCK_CONTAINER_CLOSER);
                try self.pushContainerBytes(.ul, 0, types.BLOCK_CONTAINER_CLOSER | loose_flag);
            } else if (c.ch == '.' or c.ch == ')') {
                // Retroactively patch the opener with loose flag
                if (c.is_loose and c.block_byte_off < self.block_bytes.items.len) {
                    const opener_hdr = self.getBlockHeaderAt(c.block_byte_off);
                    opener_hdr.flags |= types.BLOCK_LOOSE_LIST;
                }
                try self.pushContainerBytes(.li, if (c.is_task) @as(u32, self.text[c.task_mark_off]) else 0, types.BLOCK_CONTAINER_CLOSER);
                try self.pushContainerBytes(.ol, c.start, types.BLOCK_CONTAINER_CLOSER | loose_flag);
            }
        }
    }

    fn isContainerCompatible(self: *const Parser, existing: *const Container, new: *const Container) bool {
        _ = self;
        // Same container type
        if (existing.ch == '>' and new.ch == '>') return true;
        // Same list marker type
        if (existing.ch == new.ch) return true;
        // Bullet lists: different bullet chars are compatible
        if (isListBullet(existing.ch) and isListBullet(new.ch)) return false;
        return false;
    }

    // ========================================
    // Process all blocks (second pass)
    // ========================================

    fn processAllBlocks(self: *Parser) error{OutOfMemory}!void {
        var off: usize = 0;
        const bytes = self.block_bytes.items;

        // Reuse containers array for tight/loose tracking (same approach as md4c).
        // The containers are no longer needed for line analysis at this point.
        self.n_containers = 0;

        while (off < bytes.len) {
            // Align to BlockHeader
            const align_mask: usize = @alignOf(BlockHeader) - 1;
            off = (off + align_mask) & ~align_mask;
            if (off + @sizeOf(BlockHeader) > bytes.len) break;

            const hdr: *const BlockHeader = @ptrCast(@alignCast(bytes.ptr + off));
            off += @sizeOf(BlockHeader);

            const block_type = hdr.block_type;
            const n_lines = hdr.n_lines;
            const data = hdr.data;
            const flags = hdr.flags;

            // Read lines after header
            const lines_size = n_lines * @sizeOf(VerbatimLine);
            if (off + lines_size > bytes.len) break;
            const line_data: [*]const VerbatimLine = @ptrCast(@alignCast(bytes.ptr + off));
            const block_lines = line_data[0..n_lines];
            off += lines_size;

            // Handle container openers/closers
            if (flags & types.BLOCK_CONTAINER_OPENER != 0) {
                self.enterBlock(block_type, data, flags);
                // Track tight/loose state per container level (md4c approach)
                if (block_type == .ul or block_type == .ol) {
                    if (self.n_containers < self.containers.items.len) {
                        self.containers.items[self.n_containers].is_loose = (flags & types.BLOCK_LOOSE_LIST != 0);
                        self.n_containers += 1;
                    }
                } else if (block_type == .quote) {
                    // Blockquotes always act as "loose" — content inside blockquotes
                    // always gets <p> tags even when nested inside tight lists
                    if (self.n_containers < self.containers.items.len) {
                        self.containers.items[self.n_containers].is_loose = true;
                        self.n_containers += 1;
                    }
                }
                continue;
            }
            if (flags & types.BLOCK_CONTAINER_CLOSER != 0) {
                if (block_type == .ul or block_type == .ol or block_type == .quote) {
                    if (self.n_containers > 0) self.n_containers -= 1;
                }
                self.leaveBlock(block_type, data);
                continue;
            }

            // Skip paragraph blocks consumed entirely by ref defs
            if (flags & types.BLOCK_REF_DEF_ONLY != 0) continue;

            // Determine if we're in a tight list (md4c approach: check innermost container)
            const is_in_tight_list = self.n_containers > 0 and
                !self.containers.items[self.n_containers - 1].is_loose;

            // Process leaf blocks — skip <p> enter/leave in tight lists
            if (!is_in_tight_list or block_type != .p)
                self.enterBlock(block_type, data, flags);
            switch (block_type) {
                .hr => {},
                .code => self.processCodeBlock(block_lines, data, flags),
                .html => self.processHtmlBlock(block_lines),
                .table => self.processTableBlock(block_lines, data),
                .p => self.processLeafBlock(block_lines, true),
                .h => self.processLeafBlock(block_lines, true),
                else => self.processLeafBlock(block_lines, false),
            }
            if (!is_in_tight_list or block_type != .p)
                self.leaveBlock(block_type, data);
        }
    }

    /// Merge all lines into buffer with \n between them (unmodified),
    /// then process inlines on the merged text. Hard/soft breaks are detected
    /// during inline processing when \n is encountered.
    fn processLeafBlock(self: *Parser, block_lines: []const VerbatimLine, trim_trailing: bool) void {
        if (block_lines.len == 0) return;

        self.buffer.clearRetainingCapacity();

        for (block_lines) |vline| {
            if (vline.beg > vline.end or vline.end > self.size) continue;

            if (self.buffer.items.len > 0) {
                self.buffer.append(self.allocator, '\n') catch {};
            }
            self.buffer.appendSlice(self.allocator, self.text[vline.beg..vline.end]) catch {};
        }

        var merged = self.buffer.items;
        // For headings, trim trailing whitespace
        if (trim_trailing) {
            while (merged.len > 0 and (merged[merged.len - 1] == ' ' or
                merged[merged.len - 1] == '\t'))
                merged = merged[0 .. merged.len - 1];
        }
        self.processInlineContent(merged, block_lines[0].beg);
    }

    fn processInlineContent(self: *Parser, content: []const u8, base_off: OFF) void {
        // Phase 1: Collect and resolve emphasis delimiters
        self.collectEmphasisDelimiters(content);
        self.resolveEmphasisDelimiters();

        // Copy resolved delimiters locally (recursive calls may modify emph_delims)
        const resolved = self.allocator.dupe(EmphDelim, self.emph_delims.items) catch {
            // Fallback: emit content as plain text
            self.emitText(.normal, content);
            return;
        };
        defer self.allocator.free(resolved);

        // Phase 2: Emit content using resolved emphasis info
        var i: usize = 0;
        var text_start: usize = 0;
        var delim_cursor: usize = 0;

        while (i < content.len) {
            const c = content[i];

            // Newline from merged lines — check for hard break
            if (c == '\n') {
                var emit_end = i;
                var is_hard = false;
                if (emit_end > text_start and content[emit_end - 1] == '\\') {
                    emit_end -= 1;
                    is_hard = true;
                } else {
                    var sp = emit_end;
                    while (sp > text_start and content[sp - 1] == ' ') sp -= 1;
                    if (emit_end - sp >= 2) {
                        // Also strip any trailing tabs/spaces before the space run
                        while (sp > text_start and (content[sp - 1] == ' ' or content[sp - 1] == '\t')) sp -= 1;
                        emit_end = sp;
                        is_hard = true;
                    }
                }
                if (emit_end > text_start) self.emitText(.normal, content[text_start..emit_end]);
                if (is_hard) self.emitText(.br, "") else self.emitText(.softbr, "");
                i += 1;
                text_start = i;
                continue;
            }

            // Check for backslash escape
            if (c == '\\' and i + 1 < content.len and helpers.isAsciiPunctuation(content[i + 1])) {
                if (i > text_start) self.emitText(.normal, content[text_start..i]);
                i += 1;
                self.emitText(.normal, content[i .. i + 1]);
                i += 1;
                text_start = i;
                continue;
            }

            // Code span
            if (c == '`') {
                if (i > text_start) self.emitText(.normal, content[text_start..i]);
                const result = self.findCodeSpanEnd(content, i);
                if (result.found) {
                    self.enterSpan(.code);
                    const code_content = self.normalizeCodeSpanContent(content[i + result.backtick_count .. result.end_pos]);
                    self.emitText(.code, code_content);
                    self.leaveSpan(.code);
                    i = result.end_pos + result.backtick_count;
                } else {
                    // No matching closer found — emit the entire backtick run as literal text
                    self.emitText(.normal, content[i .. i + result.backtick_count]);
                    i += result.backtick_count;
                }
                text_start = i;
                continue;
            }

            // Emphasis/strikethrough with * or _ or ~ — use resolved delimiters
            if (c == '*' or c == '_' or (c == '~' and self.flags.strikethrough)) {
                // Find the corresponding resolved delimiter
                while (delim_cursor < resolved.len and resolved[delim_cursor].pos < i) delim_cursor += 1;

                if (delim_cursor < resolved.len and resolved[delim_cursor].pos == i) {
                    if (i > text_start) self.emitText(.normal, content[text_start..i]);

                    const d = &resolved[delim_cursor];
                    const run_end = d.pos + d.count;

                    // Emit closing tags first (innermost to outermost)
                    if (d.emph_char == '~') {
                        if (d.close_count > 0) self.leaveSpan(.del);
                    } else {
                        self.emitEmphCloseTags(d.close_sizes[0..d.close_num]);
                    }

                    // Emit remaining delimiter chars as text
                    const text_chars = d.count -| (d.open_count + d.close_count);
                    if (text_chars > 0) {
                        self.emitText(.normal, content[i .. i + text_chars]);
                    }

                    // Emit opening tags (outermost to innermost)
                    if (d.emph_char == '~') {
                        if (d.open_count > 0) self.enterSpan(.del);
                    } else {
                        self.emitEmphOpenTags(d.open_sizes[0..d.open_num]);
                    }

                    delim_cursor += 1;
                    i = run_end;
                    text_start = i;
                    continue;
                }
                // No resolved delimiter found, just advance
                i += 1;
                continue;
            }

            // HTML entity
            if (c == '&') {
                const entity_result = self.findEntity(content, i);
                if (entity_result.found) {
                    if (i > text_start) self.emitText(.normal, content[text_start..i]);
                    self.emitText(.entity, content[i..entity_result.end_pos]);
                    i = entity_result.end_pos;
                    text_start = i;
                    continue;
                }
            }

            // HTML tag
            if (c == '<' and !self.flags.no_html_spans) {
                const tag_result = self.findHtmlTag(content, i);
                if (tag_result.found) {
                    if (i > text_start) self.emitText(.normal, content[text_start..i]);
                    self.emitText(.html, content[i..tag_result.end_pos]);
                    i = tag_result.end_pos;
                    text_start = i;
                    continue;
                }
                const autolink_result = self.findAutolink(content, i);
                if (autolink_result.found) {
                    if (i > text_start) self.emitText(.normal, content[text_start..i]);
                    self.renderAutolink(content[i + 1 .. autolink_result.end_pos - 1], autolink_result.is_email);
                    i = autolink_result.end_pos;
                    text_start = i;
                    continue;
                }
            }

            // Wiki links: [[destination]] or [[destination|label]]
            if (c == '[' and self.flags.wiki_links and i + 1 < content.len and content[i + 1] == '[') {
                const wl = self.processWikiLink(content, i);
                if (wl.found) {
                    if (i > text_start) self.emitText(.normal, content[text_start..i]);
                    i = wl.end_pos;
                    text_start = i;
                    continue;
                }
            }

            // Links: [text](url) or [text][ref]
            if (c == '[') {
                if (i > text_start) self.emitText(.normal, content[text_start..i]);
                const link_result = self.processLink(content, i, base_off, false);
                if (link_result.found) {
                    i = link_result.end_pos;
                } else {
                    self.emitText(.normal, "[");
                    i += 1;
                }
                text_start = i;
                continue;
            }

            // Images: ![text](url)
            if (c == '!' and i + 1 < content.len and content[i + 1] == '[') {
                if (i > text_start) self.emitText(.normal, content[text_start..i]);
                const link_result = self.processLink(content, i + 1, base_off, true);
                if (link_result.found) {
                    i = link_result.end_pos;
                } else {
                    self.emitText(.normal, "!");
                    i += 1;
                }
                text_start = i;
                continue;
            }

            // Note: Strikethrough (~) is handled above via the resolved delimiter system

            // Permissive autolinks: detect URL, email, and WWW autolinks
            // Suppress inside explicit links to avoid double-wrapping (md4c issue #152)
            if (self.link_nesting_level == 0 and
                ((c == ':' and self.flags.permissive_url_autolinks) or
                    (c == '@' and self.flags.permissive_email_autolinks) or
                    (c == '.' and self.flags.permissive_www_autolinks)))
            {
                // First try with strict boundaries, then with relaxed (emphasis-aware)
                var al = findPermissiveAutolink(content, i, false);
                if (!al.found) {
                    al = findPermissiveAutolink(content, i, true);
                    if (al.found and !isEmphBoundaryResolved(content, al, resolved))
                        al.found = false;
                }
                if (al.found) {
                    if (al.beg > text_start) self.emitText(.normal, content[text_start..al.beg]);

                    // Determine URL prefix
                    const link_text = content[al.beg..al.end];
                    if (c == '@') {
                        self.writeHtml("<a href=\"mailto:");
                        self.writeHtmlEscaped(link_text);
                        self.writeHtml("\">");
                        self.writeHtmlEscaped(link_text);
                        self.writeHtml("</a>");
                    } else if (c == '.') {
                        self.writeHtml("<a href=\"http://");
                        self.writeHtmlEscaped(link_text);
                        self.writeHtml("\">");
                        self.writeHtmlEscaped(link_text);
                        self.writeHtml("</a>");
                    } else {
                        self.writeHtml("<a href=\"");
                        self.writeHtmlEscaped(link_text);
                        self.writeHtml("\">");
                        self.writeHtmlEscaped(link_text);
                        self.writeHtml("</a>");
                    }
                    i = al.end;
                    text_start = i;
                    continue;
                }
            }

            // Null character
            if (c == 0) {
                if (i > text_start) self.emitText(.normal, content[text_start..i]);
                self.emitText(.null_char, "");
                i += 1;
                text_start = i;
                continue;
            }

            i += 1;
        }

        if (text_start < content.len) {
            self.emitText(.normal, content[text_start..]);
        }
    }

    /// Emit emphasis opening tags (outermost to innermost).
    fn emitEmphOpenTags(self: *Parser, sizes: []const u2) void {
        // First match = innermost, so emit in reverse (outermost first in HTML)
        var j = sizes.len;
        while (j > 0) {
            j -= 1;
            if (sizes[j] == 2) self.enterSpan(.strong) else self.enterSpan(.em);
        }
    }

    /// Emit emphasis closing tags (innermost to outermost).
    /// First entry in sizes was matched first (innermost), emit in forward order.
    fn emitEmphCloseTags(self: *Parser, sizes: []const u2) void {
        for (sizes) |size| {
            if (size == 2) self.leaveSpan(.strong) else self.leaveSpan(.em);
        }
    }

    // ========================================
    // Code block processing
    // ========================================

    fn processCodeBlock(self: *Parser, block_lines: []const VerbatimLine, data: u32, flags: u32) void {
        _ = data;

        var count = block_lines.len;

        // Trim trailing blank lines from indented code blocks (not fenced)
        if (flags & types.BLOCK_FENCED_CODE == 0) {
            while (count > 0 and block_lines[count - 1].beg >= block_lines[count - 1].end) {
                count -= 1;
            }
        }

        for (block_lines[0..count]) |vline| {
            // Output indented content
            var i: u32 = 0;
            while (i < vline.indent) : (i += 1) {
                self.writeHtml(" ");
            }
            const content = self.text[vline.beg..vline.end];
            self.writeHtmlEscaped(content);
            self.writeHtml("\n");
        }
    }

    fn processHtmlBlock(self: *Parser, block_lines: []const VerbatimLine) void {
        for (block_lines, 0..) |vline, i| {
            if (i > 0) self.writeHtml("\n");
            // Preserve original indentation
            var indent = vline.indent;
            while (indent > 0) : (indent -= 1) {
                self.writeHtml(" ");
            }
            self.writeHtml(self.text[vline.beg..vline.end]);
        }
        self.writeHtml("\n");
    }

    fn processTableBlock(self: *Parser, block_lines: []const VerbatimLine, col_count: u32) void {
        if (block_lines.len < 2) return;

        // First line is header, second is underline, rest are body
        self.enterBlock(.thead, 0, 0);
        self.enterBlock(.tr, 0, 0);
        self.processTableRow(block_lines[0], true, col_count);
        self.leaveBlock(.tr, 0);
        self.leaveBlock(.thead, 0);

        if (block_lines.len > 2) {
            self.enterBlock(.tbody, 0, 0);
            for (block_lines[2..]) |vline| {
                self.enterBlock(.tr, 0, 0);
                self.processTableRow(vline, false, col_count);
                self.leaveBlock(.tr, 0);
            }
            self.leaveBlock(.tbody, 0);
        }
    }

    fn processTableRow(self: *Parser, vline: VerbatimLine, is_header: bool, col_count: u32) void {
        const row_text = self.text[vline.beg..vline.end];
        var start: usize = 0;
        var cell_index: u32 = 0;

        // Skip leading pipe
        if (start < row_text.len and row_text[start] == '|') start += 1;

        while (start < row_text.len and cell_index < col_count) {
            // Find cell end, skipping escaped chars and code spans
            var end = start;
            while (end < row_text.len and row_text[end] != '|') {
                if (row_text[end] == '\\' and end + 1 < row_text.len) {
                    end += 2;
                } else if (row_text[end] == '`') {
                    // Count opening backticks
                    var bt_count: usize = 0;
                    while (end + bt_count < row_text.len and row_text[end + bt_count] == '`') bt_count += 1;
                    end += bt_count;
                    // Find matching closing backticks
                    var found_close = false;
                    while (end < row_text.len) {
                        if (row_text[end] == '`') {
                            var close_count: usize = 0;
                            while (end + close_count < row_text.len and row_text[end + close_count] == '`') close_count += 1;
                            end += close_count;
                            if (close_count == bt_count) {
                                found_close = true;
                                break;
                            }
                        } else {
                            end += 1;
                        }
                    }
                    if (!found_close) {
                        // No matching close, treat backticks as literal
                    }
                } else {
                    end += 1;
                }
            }

            // Skip trailing pipe cell
            if (end == row_text.len and start == end) break;

            // Trim cell content
            var cell_beg = start;
            var cell_end = end;
            while (cell_beg < cell_end and helpers.isBlank(row_text[cell_beg])) cell_beg += 1;
            while (cell_end > cell_beg and helpers.isBlank(row_text[cell_end - 1])) cell_end -= 1;

            const cell_type: BlockType = if (is_header) .th else .td;
            const align_data: u32 = if (cell_index < 64) @intFromEnum(self.table_alignments[cell_index]) else 0;
            self.enterBlock(cell_type, align_data, 0);
            if (cell_beg < cell_end) {
                self.processInlineContent(row_text[cell_beg..cell_end], vline.beg + @as(OFF, @intCast(cell_beg)));
            }
            self.leaveBlock(cell_type, 0);
            cell_index += 1;

            if (end < row_text.len) {
                start = end + 1; // skip |
            } else {
                break;
            }
        }

        // Pad short rows with empty cells
        const cell_type: BlockType = if (is_header) .th else .td;
        while (cell_index < col_count) {
            const align_data: u32 = if (cell_index < 64) @intFromEnum(self.table_alignments[cell_index]) else 0;
            self.enterBlock(cell_type, align_data, 0);
            self.leaveBlock(cell_type, 0);
            cell_index += 1;
        }
    }

    // ========================================
    // Inline helpers
    // ========================================

    fn findCodeSpanEnd(self: *const Parser, content: []const u8, start: usize) struct { found: bool, backtick_count: usize, end_pos: usize } {
        _ = self;
        // Count opening backticks
        var count: usize = 0;
        var pos = start;
        while (pos < content.len and content[pos] == '`') {
            count += 1;
            pos += 1;
        }

        // Find matching closing backticks
        while (pos < content.len) {
            if (content[pos] == '`') {
                var close_count: usize = 0;
                const close_start = pos;
                while (pos < content.len and content[pos] == '`') {
                    close_count += 1;
                    pos += 1;
                }
                if (close_count == count) {
                    return .{ .found = true, .backtick_count = count, .end_pos = close_start };
                }
            } else {
                pos += 1;
            }
        }

        return .{ .found = false, .backtick_count = count, .end_pos = 0 };
    }

    fn normalizeCodeSpanContent(self: *const Parser, content: []const u8) []const u8 {
        _ = self;
        // Strip one leading and trailing space if both exist and content isn't all spaces.
        // Newlines (from merged lines) are treated as spaces here.
        if (content.len >= 2) {
            const first_is_space = content[0] == ' ' or content[0] == '\n';
            const last_is_space = content[content.len - 1] == ' ' or content[content.len - 1] == '\n';
            if (first_is_space and last_is_space) {
                var all_spaces = true;
                for (content) |byte| {
                    if (byte != ' ' and byte != '\n') {
                        all_spaces = false;
                        break;
                    }
                }
                if (!all_spaces) return content[1 .. content.len - 1];
            }
        }
        return content;
    }

    /// Check if a delimiter run is left-flanking per CommonMark spec.
    fn isLeftFlanking(content: []const u8, run_start: usize, run_end: usize) bool {
        // Not followed by Unicode whitespace
        if (run_end >= content.len) return false;
        const after_cp = helpers.decodeUtf8(content, run_end).codepoint;
        if (helpers.isUnicodeWhitespace(after_cp)) return false;
        // Not followed by punctuation, OR preceded by whitespace/punctuation
        if (helpers.isUnicodePunctuation(after_cp)) {
            if (run_start == 0) return true; // preceded by start of text
            const before_cp = helpers.decodeUtf8Backward(content, run_start).codepoint;
            return helpers.isUnicodeWhitespace(before_cp) or helpers.isUnicodePunctuation(before_cp);
        }
        return true;
    }

    /// Check if a delimiter run is right-flanking per CommonMark spec.
    fn isRightFlanking(content: []const u8, run_start: usize, run_end: usize) bool {
        // Not preceded by Unicode whitespace
        if (run_start == 0) return false;
        const before_cp = helpers.decodeUtf8Backward(content, run_start).codepoint;
        if (helpers.isUnicodeWhitespace(before_cp)) return false;
        // Not preceded by punctuation, OR followed by whitespace/punctuation
        if (helpers.isUnicodePunctuation(before_cp)) {
            if (run_end >= content.len) return true; // followed by end of text
            const after_cp = helpers.decodeUtf8(content, run_end).codepoint;
            return helpers.isUnicodeWhitespace(after_cp) or helpers.isUnicodePunctuation(after_cp);
        }
        return true;
    }

    fn canOpenEmphasis(emph_char: u8, content: []const u8, run_start: usize, run_end: usize) bool {
        const lf = isLeftFlanking(content, run_start, run_end);
        if (!lf) return false;
        if (emph_char == '*') return true;
        // _ requires: left-flanking AND (not right-flanking OR preceded by punctuation)
        const rf = isRightFlanking(content, run_start, run_end);
        return !rf or (run_start > 0 and helpers.isUnicodePunctuation(helpers.decodeUtf8Backward(content, run_start).codepoint));
    }

    fn canCloseEmphasis(emph_char: u8, content: []const u8, run_start: usize, run_end: usize) bool {
        const rf = isRightFlanking(content, run_start, run_end);
        if (!rf) return false;
        if (emph_char == '*') return true;
        // _ requires: right-flanking AND (not left-flanking OR followed by punctuation)
        const lf = isLeftFlanking(content, run_start, run_end);
        return !lf or (run_end < content.len and helpers.isUnicodePunctuation(helpers.decodeUtf8(content, run_end).codepoint));
    }

    /// Emphasis delimiter entry for CommonMark emphasis algorithm.
    const MAX_EMPH_MATCHES = 6;
    pub const EmphDelim = struct {
        pos: usize, // start position in content
        count: usize, // original run length
        emph_char: u8, // * or _
        can_open: bool,
        can_close: bool,
        remaining: usize, // chars not yet consumed
        open_count: usize = 0, // total chars consumed as opener
        close_count: usize = 0, // total chars consumed as closer
        // Individual match sizes in order (each is 1 for em, 2 for strong)
        open_sizes: [MAX_EMPH_MATCHES]u2 = [_]u2{0} ** MAX_EMPH_MATCHES,
        open_num: u4 = 0, // number of open matches
        close_sizes: [MAX_EMPH_MATCHES]u2 = [_]u2{0} ** MAX_EMPH_MATCHES,
        close_num: u4 = 0, // number of close matches
        active: bool = true, // false if deactivated between matched pairs
    };

    /// Collect emphasis delimiter runs from content, skipping code spans and HTML tags.
    fn collectEmphasisDelimiters(self: *Parser, content: []const u8) void {
        self.emph_delims.clearRetainingCapacity();
        var i: usize = 0;
        while (i < content.len) {
            const c = content[i];
            // Skip backslash escapes
            if (c == '\\' and i + 1 < content.len and helpers.isAsciiPunctuation(content[i + 1])) {
                i += 2;
                continue;
            }
            // Skip code spans
            if (c == '`') {
                const result = self.findCodeSpanEnd(content, i);
                if (result.found) {
                    i = result.end_pos + result.backtick_count;
                } else {
                    i += 1;
                }
                continue;
            }
            // Skip HTML tags and autolinks
            if (c == '<') {
                if (!self.flags.no_html_spans) {
                    const tag = self.findHtmlTag(content, i);
                    if (tag.found) {
                        i = tag.end_pos;
                        continue;
                    }
                    const auto = self.findAutolink(content, i);
                    if (auto.found) {
                        i = auto.end_pos;
                        continue;
                    }
                }
            }
            // Skip link/image constructs — links take precedence over emphasis (CommonMark §6.3)
            if (c == '[' or (c == '!' and i + 1 < content.len and content[i + 1] == '[')) {
                const is_img = c == '!';
                const bracket_start = if (is_img) i + 1 else i;
                const link_result = self.tryMatchBracketLink(content, bracket_start);
                if (link_result.is_link) {
                    // Link nesting prohibition: links cannot contain other links (CommonMark §6.7)
                    // Images CAN contain links in alt text, so only check for non-images
                    if (!is_img) {
                        const label = content[bracket_start + 1 .. link_result.label_end];
                        if (self.labelContainsLink(label)) {
                            // Label contains inner links — this can't form a link
                            i += 1;
                            continue;
                        }
                    }
                    i = link_result.link_end;
                    continue;
                }
            }
            // Emphasis delimiter
            if (c == '*' or c == '_') {
                const run_start = i;
                while (i < content.len and content[i] == c) i += 1;
                const count = i - run_start;
                self.emph_delims.append(self.allocator, .{
                    .pos = run_start,
                    .count = count,
                    .emph_char = c,
                    .can_open = canOpenEmphasis(c, content, run_start, i),
                    .can_close = canCloseEmphasis(c, content, run_start, i),
                    .remaining = count,
                }) catch {};
                continue;
            }
            // Strikethrough delimiter (1 or 2 tildes only)
            if (c == '~' and self.flags.strikethrough) {
                const run_start = i;
                while (i < content.len and content[i] == '~') i += 1;
                const count = i - run_start;
                if (count == 1 or count == 2) {
                    self.emph_delims.append(self.allocator, .{
                        .pos = run_start,
                        .count = count,
                        .emph_char = '~',
                        .can_open = canOpenEmphasis('~', content, run_start, i),
                        .can_close = canCloseEmphasis('~', content, run_start, i),
                        .remaining = count,
                    }) catch {};
                }
                continue;
            }
            i += 1;
        }
    }

    /// Resolve emphasis delimiters using the CommonMark algorithm.
    fn resolveEmphasisDelimiters(self: *Parser) void {
        const delims = self.emph_delims.items;
        if (delims.len == 0) return;

        // Process potential closers from left to right
        var closer_idx: usize = 0;
        while (closer_idx < delims.len) : (closer_idx += 1) {
            if (!delims[closer_idx].can_close or delims[closer_idx].remaining == 0) continue;

            // Look backward for a matching opener
            var found_match = false;
            if (closer_idx > 0) {
                var oi: usize = closer_idx;
                while (oi > 0) {
                    oi -= 1;
                    const opener = &delims[oi];
                    if (opener.emph_char != delims[closer_idx].emph_char) continue;
                    if (!opener.can_open or opener.remaining == 0 or !opener.active) continue;

                    // Strikethrough: exact count match required
                    if (opener.emph_char == '~') {
                        if (opener.count != delims[closer_idx].count) continue;
                    }

                    // Rule of three: if closer can also open OR opener can also close,
                    // and the sum is a multiple of 3, and neither is individually a multiple of 3, skip
                    if (opener.emph_char != '~' and
                        (opener.can_close or delims[closer_idx].can_open) and
                        (opener.count + delims[closer_idx].count) % 3 == 0 and
                        opener.count % 3 != 0 and delims[closer_idx].count % 3 != 0)
                    {
                        continue;
                    }

                    // Match found! Determine how many chars to use
                    // For strikethrough (~): consume entire run at once
                    const use: usize = if (opener.emph_char == '~')
                        opener.remaining
                    else if (opener.remaining >= 2 and delims[closer_idx].remaining >= 2) 2 else 1;

                    opener.remaining -= use;
                    opener.open_count += use;
                    if (opener.open_num < MAX_EMPH_MATCHES) {
                        opener.open_sizes[opener.open_num] = @intCast(use);
                        opener.open_num += 1;
                    }
                    delims[closer_idx].remaining -= use;
                    delims[closer_idx].close_count += use;
                    if (delims[closer_idx].close_num < MAX_EMPH_MATCHES) {
                        delims[closer_idx].close_sizes[delims[closer_idx].close_num] = @intCast(use);
                        delims[closer_idx].close_num += 1;
                    }

                    // Remove all delimiters between opener and closer (CommonMark §6.4)
                    var k = oi + 1;
                    while (k < closer_idx) : (k += 1) {
                        delims[k].active = false;
                    }

                    found_match = true;

                    // If closer still has remaining, re-process it (don't increment closer_idx)
                    if (delims[closer_idx].remaining > 0 and delims[closer_idx].can_close) {
                        // Reset the while condition — we'll re-check this closer
                        closer_idx -%= 1; // will be incremented by while loop
                    }
                    break;
                }
            }

            // If no match and can't open, deactivate
            if (!found_match and !delims[closer_idx].can_open) {
                delims[closer_idx].active = false;
            }
        }
    }

    fn processStrikethrough(self: *Parser, content: []const u8, start: usize) struct { found: bool, end_pos: usize } {
        // Count opening tildes
        var count: usize = 0;
        var pos = start;
        while (pos < content.len and content[pos] == '~') {
            count += 1;
            pos += 1;
        }
        if (count != 1 and count != 2) {
            return .{ .found = false, .end_pos = start + count };
        }
        // Check opening flanking (not preceded by letter/digit, and not followed by whitespace)
        if (!isLeftFlanking(content, start, pos)) {
            return .{ .found = false, .end_pos = pos };
        }

        // Find closing tildes
        var search = pos;
        while (search < content.len) {
            if (content[search] == '~') {
                var close_count: usize = 0;
                const close_start = search;
                while (search < content.len and content[search] == '~') {
                    close_count += 1;
                    search += 1;
                }
                if (close_count == count and isRightFlanking(content, close_start, search)) {
                    self.enterSpan(.del);
                    self.processInlineContent(content[pos..close_start], 0);
                    self.leaveSpan(.del);
                    return .{ .found = true, .end_pos = search };
                }
            } else {
                search += 1;
            }
        }

        return .{ .found = false, .end_pos = start + count };
    }

    fn findEntity(self: *const Parser, content: []const u8, start: usize) struct { found: bool, end_pos: usize } {
        _ = self;
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
                // Verify it's a known entity
                if (entity_mod.lookup(content[start .. pos + 1]) != null) {
                    return .{ .found = true, .end_pos = pos + 1 };
                }
            }
        }

        return .{ .found = false, .end_pos = 0 };
    }

    fn findAutolink(self: *const Parser, content: []const u8, start: usize) struct { found: bool, end_pos: usize, is_email: bool } {
        _ = self;
        if (start + 1 >= content.len) return .{ .found = false, .end_pos = 0, .is_email = false };

        const pos = start + 1;

        // Check for URI autolink: scheme://...
        if (helpers.isAlpha(content[pos])) {
            var scheme_end = pos;
            while (scheme_end < content.len and (helpers.isAlphaNum(content[scheme_end]) or
                content[scheme_end] == '+' or content[scheme_end] == '-' or content[scheme_end] == '.'))
            {
                scheme_end += 1;
            }
            const scheme_len = scheme_end - pos;
            if (scheme_len >= 2 and scheme_len <= 32 and scheme_end < content.len and content[scheme_end] == ':') {
                // URI autolink
                var uri_end = scheme_end + 1;
                while (uri_end < content.len and content[uri_end] != '>' and !helpers.isWhitespace(content[uri_end])) {
                    uri_end += 1;
                }
                if (uri_end < content.len and content[uri_end] == '>') {
                    return .{ .found = true, .end_pos = uri_end + 1, .is_email = false };
                }
            }

            // Check for email autolink
            var email_pos = pos;
            // username part
            while (email_pos < content.len and (helpers.isAlphaNum(content[email_pos]) or
                content[email_pos] == '.' or content[email_pos] == '-' or
                content[email_pos] == '_' or content[email_pos] == '+'))
            {
                email_pos += 1;
            }
            if (email_pos < content.len and content[email_pos] == '@' and email_pos > pos) {
                email_pos += 1;
                // domain part: labels separated by '.', each 1-63 chars, alphanumeric or hyphen
                const domain_start = email_pos;
                var label_len: u32 = 0;
                var dot_count: u32 = 0;
                var valid_domain = true;
                while (email_pos < content.len and (helpers.isAlphaNum(content[email_pos]) or
                    content[email_pos] == '.' or content[email_pos] == '-'))
                {
                    if (content[email_pos] == '.') {
                        if (label_len == 0) {
                            valid_domain = false;
                            break;
                        }
                        label_len = 0;
                        dot_count += 1;
                    } else {
                        label_len += 1;
                        if (label_len > 63) {
                            valid_domain = false;
                            break;
                        }
                    }
                    email_pos += 1;
                }
                if (valid_domain and email_pos < content.len and content[email_pos] == '>' and
                    email_pos > domain_start and label_len > 0 and dot_count > 0 and
                    helpers.isAlphaNum(content[email_pos - 1]))
                {
                    return .{ .found = true, .end_pos = email_pos + 1, .is_email = true };
                }
            }
        }

        return .{ .found = false, .end_pos = 0, .is_email = false };
    }

    fn renderAutolink(self: *Parser, url: []const u8, is_email: bool) void {
        self.writeHtml("<a href=\"");
        if (is_email) self.writeHtml("mailto:");
        self.writeUrlEscaped(url);
        self.writeHtml("\">");
        self.writeHtmlEscaped(url);
        self.writeHtml("</a>");
    }

    fn findHtmlTag(self: *const Parser, content: []const u8, start: usize) struct { found: bool, end_pos: usize } {
        _ = self;
        if (start + 1 >= content.len) return .{ .found = false, .end_pos = 0 };

        var pos = start + 1;
        const c = content[pos];

        // Closing tag: </tagname whitespace? >
        if (c == '/') {
            pos += 1;
            if (pos >= content.len or !helpers.isAlpha(content[pos]))
                return .{ .found = false, .end_pos = 0 };
            while (pos < content.len and (helpers.isAlphaNum(content[pos]) or content[pos] == '-'))
                pos += 1;
            // Skip whitespace (including newlines)
            while (pos < content.len and helpers.isWhitespace(content[pos]))
                pos += 1;
            if (pos < content.len and content[pos] == '>')
                return .{ .found = true, .end_pos = pos + 1 };
            return .{ .found = false, .end_pos = 0 };
        }

        // Comment: <!-- ... -->
        // Per CommonMark: text after <!-- must not start with > or ->
        if (c == '!' and pos + 1 < content.len and content[pos + 1] == '-' and
            pos + 2 < content.len and content[pos + 2] == '-')
        {
            pos += 3;
            // Minimal comments: <!--> and <!--->
            if (pos < content.len and content[pos] == '>') return .{ .found = true, .end_pos = pos + 1 };
            if (pos + 1 < content.len and content[pos] == '-' and content[pos + 1] == '>') return .{ .found = true, .end_pos = pos + 2 };
            while (pos + 2 < content.len) {
                if (content[pos] == '-' and content[pos + 1] == '-' and content[pos + 2] == '>') {
                    return .{ .found = true, .end_pos = pos + 3 };
                }
                pos += 1;
            }
            return .{ .found = false, .end_pos = 0 };
        }

        // HTML declaration: <! followed by uppercase letter, ended by >
        if (c == '!' and pos + 1 < content.len and content[pos + 1] >= 'A' and content[pos + 1] <= 'Z') {
            pos += 2;
            while (pos < content.len and content[pos] != '>') pos += 1;
            if (pos < content.len) return .{ .found = true, .end_pos = pos + 1 };
            return .{ .found = false, .end_pos = 0 };
        }

        // CDATA section: <![CDATA[ ... ]]>
        if (c == '!' and pos + 7 < content.len and
            content[pos + 1] == '[' and content[pos + 2] == 'C' and content[pos + 3] == 'D' and
            content[pos + 4] == 'A' and content[pos + 5] == 'T' and content[pos + 6] == 'A' and content[pos + 7] == '[')
        {
            pos += 8;
            while (pos + 2 < content.len) {
                if (content[pos] == ']' and content[pos + 1] == ']' and content[pos + 2] == '>') {
                    return .{ .found = true, .end_pos = pos + 3 };
                }
                pos += 1;
            }
            return .{ .found = false, .end_pos = 0 };
        }

        // Processing instruction: <? ... ?>
        if (c == '?') {
            pos += 1;
            while (pos + 1 < content.len) {
                if (content[pos] == '?' and content[pos + 1] == '>') {
                    return .{ .found = true, .end_pos = pos + 2 };
                }
                pos += 1;
            }
            return .{ .found = false, .end_pos = 0 };
        }

        // Opening tag: <tagname ...>
        if (helpers.isAlpha(c)) {
            while (pos < content.len and (helpers.isAlphaNum(content[pos]) or content[pos] == '-'))
                pos += 1;

            // Attributes (whitespace includes newlines for multi-line tags)
            while (pos < content.len) {
                // Skip whitespace (spaces, tabs, newlines)
                var had_ws = false;
                while (pos < content.len and helpers.isWhitespace(content[pos])) {
                    had_ws = true;
                    pos += 1;
                }

                if (pos >= content.len) break;
                if (content[pos] == '>') return .{ .found = true, .end_pos = pos + 1 };
                if (content[pos] == '/' and pos + 1 < content.len and content[pos + 1] == '>')
                    return .{ .found = true, .end_pos = pos + 2 };

                if (!had_ws) return .{ .found = false, .end_pos = 0 };

                // Attribute name
                if (!helpers.isAlpha(content[pos]) and content[pos] != '_' and content[pos] != ':')
                    return .{ .found = false, .end_pos = 0 };
                while (pos < content.len and (helpers.isAlphaNum(content[pos]) or
                    content[pos] == '_' or content[pos] == ':' or content[pos] == '.' or content[pos] == '-'))
                    pos += 1;

                // Attribute value (optional)
                // Skip whitespace (save position in case = not found)
                const before_eq_ws = pos;
                while (pos < content.len and helpers.isWhitespace(content[pos]))
                    pos += 1;
                if (pos < content.len and content[pos] == '=') {
                    pos += 1;
                    while (pos < content.len and helpers.isWhitespace(content[pos]))
                        pos += 1;
                    if (pos >= content.len) return .{ .found = false, .end_pos = 0 };

                    if (content[pos] == '"') {
                        pos += 1;
                        while (pos < content.len and content[pos] != '"') pos += 1;
                        if (pos >= content.len) return .{ .found = false, .end_pos = 0 };
                        pos += 1;
                    } else if (content[pos] == '\'') {
                        pos += 1;
                        while (pos < content.len and content[pos] != '\'') pos += 1;
                        if (pos >= content.len) return .{ .found = false, .end_pos = 0 };
                        pos += 1;
                    } else {
                        // Unquoted value: no whitespace, quotes, =, <, >, or backtick
                        while (pos < content.len and !helpers.isWhitespace(content[pos]) and
                            content[pos] != '"' and content[pos] != '\'' and
                            content[pos] != '=' and content[pos] != '<' and
                            content[pos] != '>' and content[pos] != '`')
                            pos += 1;
                    }
                } else {
                    // No '=' found, restore position so whitespace is
                    // available for the next attribute's had_ws check
                    pos = before_eq_ws;
                }
            }
        }

        return .{ .found = false, .end_pos = 0 };
    }

    /// Check if a link label contains an inner link construct.
    /// Used to enforce the "links cannot contain other links" rule (CommonMark §6.7).
    fn labelContainsLink(self: *Parser, label: []const u8) bool {
        var pos: usize = 0;
        while (pos < label.len) {
            if (label[pos] == '\\' and pos + 1 < label.len) {
                pos += 2;
                continue;
            }
            // Skip code spans
            if (label[pos] == '`') {
                const cs = self.findCodeSpanEnd(label, pos);
                if (cs.found) {
                    pos = cs.end_pos + cs.backtick_count;
                    continue;
                }
            }
            // Skip HTML tags and autolinks
            if (label[pos] == '<' and !self.flags.no_html_spans) {
                const tag = self.findHtmlTag(label, pos);
                if (tag.found) {
                    pos = tag.end_pos;
                    continue;
                }
                const al = self.findAutolink(label, pos);
                if (al.found) {
                    pos = al.end_pos;
                    continue;
                }
            }
            if (label[pos] == '[') {
                // Skip images (![...]) — images are allowed inside links
                const is_inner_image = pos > 0 and label[pos - 1] == '!';
                // Try to find matching ] and check for link syntax
                const inner = self.tryMatchBracketLink(label, pos);
                if (inner.is_link and !is_inner_image) return true;
                if (inner.link_end > pos) {
                    // Skip past entire construct (including (url) or [ref] for images)
                    pos = inner.link_end;
                    continue;
                }
            }
            pos += 1;
        }
        return false;
    }

    /// Try to match a bracket pair starting at `start` and check if it forms a link.
    /// Returns whether it's a link, where the label ends, and the full link end position.
    fn tryMatchBracketLink(self: *Parser, content: []const u8, start: usize) struct { is_link: bool, label_end: usize, link_end: usize } {
        var pos = start + 1;
        var depth: u32 = 1;
        while (pos < content.len and depth > 0) {
            if (content[pos] == '\\' and pos + 1 < content.len) {
                pos += 2;
                continue;
            }
            if (content[pos] == '`') {
                const cs = self.findCodeSpanEnd(content, pos);
                if (cs.found) {
                    pos = cs.end_pos + cs.backtick_count;
                    continue;
                }
            }
            if (content[pos] == '<' and !self.flags.no_html_spans) {
                const tag = self.findHtmlTag(content, pos);
                if (tag.found) {
                    pos = tag.end_pos;
                    continue;
                }
                const al = self.findAutolink(content, pos);
                if (al.found) {
                    pos = al.end_pos;
                    continue;
                }
            }
            if (content[pos] == '[') depth += 1;
            if (content[pos] == ']') depth -= 1;
            if (depth > 0) pos += 1;
        }
        if (depth != 0) return .{ .is_link = false, .label_end = 0, .link_end = 0 };

        const label_end = pos;
        pos += 1; // skip ]

        if (pos >= content.len) {
            // Shortcut reference check
            const inner_label = content[start + 1 .. label_end];
            const is_ref = self.lookupRefDef(inner_label) != null;
            return .{ .is_link = is_ref, .label_end = label_end, .link_end = label_end + 1 };
        }

        // Inline link: ](...)
        if (content[pos] == '(') {
            var p = pos + 1;
            // Skip whitespace
            while (p < content.len and (helpers.isBlank(content[p]) or content[p] == '\n' or content[p] == '\r')) p += 1;
            // Parse dest
            if (p < content.len and content[p] == '<') {
                p += 1;
                while (p < content.len and content[p] != '>' and content[p] != '\n') {
                    if (content[p] == '\\' and p + 1 < content.len) {
                        p += 2;
                    } else {
                        p += 1;
                    }
                }
                if (p < content.len and content[p] == '>') p += 1 else return .{ .is_link = false, .label_end = label_end, .link_end = label_end + 1 };
            } else {
                var paren_depth: u32 = 0;
                while (p < content.len and !helpers.isWhitespace(content[p])) {
                    if (content[p] == '(') {
                        paren_depth += 1;
                    } else if (content[p] == ')') {
                        if (paren_depth == 0) break;
                        paren_depth -= 1;
                    }
                    if (content[p] == '\\' and p + 1 < content.len) {
                        p += 2;
                    } else {
                        p += 1;
                    }
                }
            }
            // Skip whitespace
            while (p < content.len and (helpers.isBlank(content[p]) or content[p] == '\n' or content[p] == '\r')) p += 1;
            // Optional title
            if (p < content.len and (content[p] == '"' or content[p] == '\'' or content[p] == '(')) {
                const close_ch: u8 = if (content[p] == '(') ')' else content[p];
                p += 1;
                while (p < content.len and content[p] != close_ch) {
                    if (content[p] == '\\' and p + 1 < content.len) {
                        p += 2;
                    } else {
                        p += 1;
                    }
                }
                if (p < content.len) p += 1;
            }
            // Skip whitespace
            while (p < content.len and (helpers.isBlank(content[p]) or content[p] == '\n' or content[p] == '\r')) p += 1;
            if (p < content.len and content[p] == ')') {
                return .{ .is_link = true, .label_end = label_end, .link_end = p + 1 };
            }
        }

        // Reference link: ][...]
        if (content[pos] == '[') {
            var p = pos + 1;
            while (p < content.len and content[p] != ']') {
                if (content[p] == '[') break;
                if (content[p] == '\\' and p + 1 < content.len) {
                    p += 2;
                } else {
                    p += 1;
                }
            }
            if (p < content.len and content[p] == ']') {
                const ref_label = if (p > pos + 1) content[pos + 1 .. p] else content[start + 1 .. label_end];
                if (self.lookupRefDef(ref_label) != null) return .{ .is_link = true, .label_end = label_end, .link_end = p + 1 };
            }
        }

        // Shortcut reference
        const inner_label = content[start + 1 .. label_end];
        if (self.lookupRefDef(inner_label) != null) return .{ .is_link = true, .label_end = label_end, .link_end = label_end + 1 };

        return .{ .is_link = false, .label_end = label_end, .link_end = label_end + 1 };
    }

    fn processLink(self: *Parser, content: []const u8, start: usize, base_off: OFF, is_image: bool) struct { found: bool, end_pos: usize } {
        _ = base_off;
        // start points at '['
        // Find matching ']', skipping code spans and HTML tags (which take precedence)
        var pos = start + 1;
        var bracket_depth: u32 = 1;
        var has_inner_bracket = false;
        while (pos < content.len and bracket_depth > 0) {
            if (content[pos] == '\\' and pos + 1 < content.len) {
                pos += 2;
                continue;
            }
            // Skip code spans — they take precedence over brackets (CommonMark §6.3)
            if (content[pos] == '`') {
                const cs = self.findCodeSpanEnd(content, pos);
                if (cs.found) {
                    pos = cs.end_pos + cs.backtick_count;
                    continue;
                }
            }
            // Skip HTML tags and autolinks — they take precedence over brackets
            if (content[pos] == '<' and !self.flags.no_html_spans) {
                const tag = self.findHtmlTag(content, pos);
                if (tag.found) {
                    pos = tag.end_pos;
                    continue;
                }
                const autolink = self.findAutolink(content, pos);
                if (autolink.found) {
                    pos = autolink.end_pos;
                    continue;
                }
            }
            if (content[pos] == '[') {
                bracket_depth += 1;
                has_inner_bracket = true;
            }
            if (content[pos] == ']') bracket_depth -= 1;
            if (bracket_depth > 0) pos += 1;
        }

        if (bracket_depth != 0) return .{ .found = false, .end_pos = 0 };

        const label_end = pos;
        const label = content[start + 1 .. label_end];
        pos += 1; // skip ']'

        // Inline link: [text](url "title")
        if (pos < content.len and content[pos] == '(') {
            pos += 1;
            // Skip whitespace (including newlines from merged paragraph lines)
            while (pos < content.len and (helpers.isBlank(content[pos]) or content[pos] == '\n' or content[pos] == '\r')) pos += 1;

            // Parse destination
            var dest_start = pos;
            var dest_end = pos;

            if (pos < content.len and content[pos] == '<') {
                // Angle-bracket destination (no newlines allowed)
                dest_start = pos + 1;
                pos += 1;
                var angle_valid = true;
                while (pos < content.len and content[pos] != '>') {
                    if (content[pos] == '\n' or content[pos] == '\r') {
                        angle_valid = false;
                        break;
                    }
                    if (content[pos] == '\\' and pos + 1 < content.len) {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                }
                if (!angle_valid) return .{ .found = false, .end_pos = 0 };
                dest_end = pos;
                if (pos < content.len) pos += 1; // skip >
            } else {
                // Bare destination — balance parentheses
                var paren_depth: u32 = 0;
                while (pos < content.len and !helpers.isWhitespace(content[pos])) {
                    if (content[pos] == '(') {
                        paren_depth += 1;
                    } else if (content[pos] == ')') {
                        if (paren_depth == 0) break;
                        paren_depth -= 1;
                    }
                    if (content[pos] == '\\' and pos + 1 < content.len) {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                }
                dest_end = pos;
            }

            // Skip whitespace (including newlines)
            while (pos < content.len and (helpers.isBlank(content[pos]) or content[pos] == '\n' or content[pos] == '\r')) pos += 1;

            // Optional title
            var title: []const u8 = "";
            if (pos < content.len and (content[pos] == '"' or content[pos] == '\'' or content[pos] == '(')) {
                const close_char: u8 = if (content[pos] == '(') ')' else content[pos];
                pos += 1;
                const title_start = pos;
                while (pos < content.len and content[pos] != close_char) {
                    if (content[pos] == '\\' and pos + 1 < content.len) {
                        pos += 2;
                    } else {
                        pos += 1;
                    }
                }
                title = content[title_start..pos];
                if (pos < content.len) pos += 1; // skip closing quote
            }

            // Skip whitespace (including newlines)
            while (pos < content.len and (helpers.isBlank(content[pos]) or content[pos] == '\n' or content[pos] == '\r')) pos += 1;

            // Must end with ')'
            if (pos < content.len and content[pos] == ')') {
                pos += 1;
                const dest = content[dest_start..dest_end];

                // Link nesting prohibition: links cannot contain other links (CommonMark §6.7)
                if (!is_image and has_inner_bracket and self.labelContainsLink(label)) {
                    return .{ .found = false, .end_pos = 0 };
                }

                if (self.image_nesting_level > 0) {
                    // Inside image alt text — emit only text, no HTML tags
                    self.processInlineContent(label, 0);
                } else if (is_image) {
                    self.writeHtml("<img src=\"");
                    self.writeUrlWithEscapes(dest);
                    self.writeHtml("\" alt=\"");
                    self.image_nesting_level += 1;
                    self.processInlineContent(label, 0);
                    self.image_nesting_level -= 1;
                    self.writeHtml("\"");
                    if (title.len > 0) {
                        self.writeHtml(" title=\"");
                        self.writeTitleWithEscapes(title);
                        self.writeHtml("\"");
                    }
                    self.writeHtml(" />");
                } else {
                    self.writeHtml("<a href=\"");
                    self.writeUrlWithEscapes(dest);
                    self.writeHtml("\"");
                    if (title.len > 0) {
                        self.writeHtml(" title=\"");
                        self.writeTitleWithEscapes(title);
                        self.writeHtml("\"");
                    }
                    self.writeHtml(">");
                    self.link_nesting_level += 1;
                    self.processInlineContent(label, 0);
                    self.link_nesting_level -= 1;
                    self.writeHtml("</a>");
                }

                return .{ .found = true, .end_pos = pos };
            }
        }

        // Reference link: [text][ref] or [text][] or shortcut [text]
        if (pos < content.len and content[pos] == '[') {
            const bracket_pos = pos;
            pos += 1;
            const ref_start = pos;
            while (pos < content.len and content[pos] != ']') {
                if (content[pos] == '[') break; // nested [ not allowed in ref
                if (content[pos] == '\\' and pos + 1 < content.len) {
                    pos += 2;
                } else {
                    pos += 1;
                }
            }
            if (pos < content.len and content[pos] == ']') {
                const ref_label = if (pos > ref_start) content[ref_start..pos] else label;
                pos += 1;
                if (self.lookupRefDef(ref_label)) |ref_def| {
                    // Link nesting prohibition
                    if (!is_image and has_inner_bracket and self.labelContainsLink(label)) {
                        return .{ .found = false, .end_pos = 0 };
                    }
                    self.renderRefLink(label, ref_def, is_image);
                    return .{ .found = true, .end_pos = pos };
                }
            } else {
                // Reset pos if we didn't find a valid ]
                pos = bracket_pos;
            }
        }

        // Shortcut reference link: [text] (no following [)
        // Per CommonMark spec, shortcut refs must NOT be followed by [
        // Note: if followed by ( and inline link parsing failed above, still try shortcut
        const char_after_label: u8 = if (label_end + 1 < content.len) content[label_end + 1] else 0;
        if (char_after_label != '[') {
            if (self.lookupRefDef(label)) |ref_def| {
                // Link nesting prohibition
                if (!is_image and has_inner_bracket and self.labelContainsLink(label)) {
                    return .{ .found = false, .end_pos = 0 };
                }
                self.renderRefLink(label, ref_def, is_image);
                return .{ .found = true, .end_pos = label_end + 1 };
            }
        }

        return .{ .found = false, .end_pos = 0 };
    }

    /// Process wiki link: [[destination]] or [[destination|label]]
    fn processWikiLink(self: *Parser, content: []const u8, start: usize) struct { found: bool, end_pos: usize } {
        // start points at first '[', next char is also '['
        var pos = start + 2;

        // Find closing ']]', checking for constraints
        const inner_start = pos;
        var pipe_pos: ?usize = null;
        var bracket_depth: u32 = 0;

        while (pos < content.len) {
            if (content[pos] == '\n' or content[pos] == '\r') {
                return .{ .found = false, .end_pos = 0 };
            }
            if (content[pos] == '[') {
                bracket_depth += 1;
            } else if (content[pos] == ']') {
                if (bracket_depth > 0) {
                    bracket_depth -= 1;
                } else if (pos + 1 < content.len and content[pos + 1] == ']') {
                    break;
                } else {
                    // Single ] without matching [, not a valid close
                    return .{ .found = false, .end_pos = 0 };
                }
            } else if (content[pos] == '|' and pipe_pos == null and bracket_depth == 0) {
                pipe_pos = pos;
            }
            pos += 1;
        }

        // Must end with ]]
        if (pos >= content.len or content[pos] != ']') {
            return .{ .found = false, .end_pos = 0 };
        }

        const inner_end = pos;

        // Determine target and label
        const target = if (pipe_pos) |pp| content[inner_start..pp] else content[inner_start..inner_end];
        const label = if (pipe_pos) |pp| content[pp + 1 .. inner_end] else content[inner_start..inner_end];

        // Target must not exceed 100 characters
        if (target.len > 100) {
            return .{ .found = false, .end_pos = 0 };
        }

        // Render the wikilink
        self.writeHtml("<x-wikilink data-target=\"");
        self.writeHtmlEscaped(target);
        self.writeHtml("\">");
        self.processInlineContent(label, 0);
        self.writeHtml("</x-wikilink>");

        return .{ .found = true, .end_pos = pos + 2 }; // skip both ']'
    }

    // ========================================
    // Line type detection helpers
    // ========================================

    fn isSetextUnderline(self: *const Parser, off: OFF) struct { is_setext: bool, level: u32 } {
        const c = self.text[off];
        if (c != '=' and c != '-') return .{ .is_setext = false, .level = 0 };

        var pos = off;
        while (pos < self.size and self.text[pos] == c) pos += 1;

        // Skip trailing spaces
        while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;

        if (pos >= self.size or helpers.isNewline(self.text[pos])) {
            const level: u32 = if (c == '=') 1 else 2;
            return .{ .is_setext = true, .level = level };
        }

        return .{ .is_setext = false, .level = 0 };
    }

    fn isHrLine(self: *const Parser, off: OFF) bool {
        const c = self.text[off];
        if (c != '-' and c != '_' and c != '*') return false;

        var pos = off;
        var count: u32 = 0;
        while (pos < self.size and !helpers.isNewline(self.text[pos])) {
            if (self.text[pos] == c) {
                count += 1;
            } else if (!helpers.isBlank(self.text[pos])) {
                return false;
            }
            pos += 1;
        }

        return count >= 3;
    }

    fn isAtxHeaderLine(self: *const Parser, off: OFF) struct { is_atx: bool, level: u32, content_beg: OFF } {
        var pos = off;
        var level: u32 = 0;

        while (pos < self.size and self.text[pos] == '#') {
            level += 1;
            pos += 1;
        }

        if (level == 0 or level > 6) return .{ .is_atx = false, .level = 0, .content_beg = 0 };

        // Must be followed by space or end of line
        if (pos < self.size and !helpers.isBlank(self.text[pos]) and !helpers.isNewline(self.text[pos])) {
            if (!self.flags.permissive_atx_headers) return .{ .is_atx = false, .level = 0, .content_beg = 0 };
        }

        // Skip spaces after #
        while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;

        return .{ .is_atx = true, .level = level, .content_beg = pos };
    }

    fn isOpeningCodeFence(self: *const Parser, off: OFF) struct { is_fence: bool, fence_data: u32 } {
        const fence_char = self.text[off];
        var pos = off;
        var count: u32 = 0;

        while (pos < self.size and self.text[pos] == fence_char) {
            count += 1;
            pos += 1;
        }

        if (count < 3) return .{ .is_fence = false, .fence_data = 0 };

        // Backtick fences can't have backticks in info string
        if (fence_char == '`') {
            var check = pos;
            while (check < self.size and !helpers.isNewline(self.text[check])) {
                if (self.text[check] == '`') return .{ .is_fence = false, .fence_data = 0 };
                check += 1;
            }
        }

        // Encode: fence_char in low byte, count in next bytes
        const data: u32 = @as(u32, fence_char) | (count << 8);
        return .{ .is_fence = true, .fence_data = data };
    }

    fn isClosingCodeFence(self: *const Parser, off: OFF, fence_data: u32) bool {
        const fence_char: u8 = @truncate(fence_data);
        const fence_count = fence_data >> 8;

        var pos = off;
        var count: u32 = 0;
        while (pos < self.size and self.text[pos] == fence_char) {
            count += 1;
            pos += 1;
        }

        if (count < fence_count) return false;

        // Rest of line must be blank
        while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;

        return pos >= self.size or helpers.isNewline(self.text[pos]);
    }

    fn isHtmlBlockStartCondition(self: *const Parser, off: OFF) u8 {
        if (off + 1 >= self.size) return 0;

        // Type 1: <script, <pre, <style, <textarea (case insensitive)
        // Only opening tags start type 1 blocks. Closing tags like </pre> are
        // only END conditions for type 1, not start conditions.
        if (self.text[off + 1] != '/' and
            (self.matchHtmlTag(off, "script") or self.matchHtmlTag(off, "pre") or
                self.matchHtmlTag(off, "style") or self.matchHtmlTag(off, "textarea")))
            return 1;

        // Type 2: <!-- (comment)
        if (off + 3 < self.size and self.text[off + 1] == '!' and self.text[off + 2] == '-' and self.text[off + 3] == '-')
            return 2;

        // Type 3: <? (processing instruction)
        if (self.text[off + 1] == '?')
            return 3;

        // Type 4: <! followed by uppercase letter (declaration)
        if (self.text[off + 1] == '!' and off + 2 < self.size and
            self.text[off + 2] >= 'A' and self.text[off + 2] <= 'Z')
            return 4;

        // Type 5: <![CDATA[
        if (off + 9 <= self.size and std.mem.eql(u8, self.text[off + 1 .. off + 9], "![CDATA["))
            return 5;

        // Type 6: block-level tags
        if (self.isBlockLevelHtmlTag(off))
            return 6;

        // Type 7: any complete open or closing tag (not interrupting paragraph)
        if (self.isCompleteHtmlTag(off))
            return 7;

        return 0;
    }

    fn matchHtmlTag(self: *const Parser, off: OFF, tag: []const u8) bool {
        if (off + 1 + tag.len >= self.size) return false;
        const start = off + 1;
        // Allow optional / for closing tags
        var pos = start;
        if (pos < self.size and self.text[pos] == '/') pos += 1;
        if (pos + tag.len > self.size) return false;
        if (!helpers.asciiCaseEql(self.text[pos .. pos + tag.len], tag)) return false;
        pos += @intCast(tag.len);
        if (pos >= self.size) return true;
        const after = self.text[pos];
        return after == '>' or after == '/' or helpers.isBlank(after) or helpers.isNewline(after);
    }

    fn isBlockLevelHtmlTag(self: *const Parser, off: OFF) bool {
        const block_tags = [_][]const u8{
            "address", "article",  "aside",   "base",     "basefont", "blockquote", "body",
            "caption", "center",   "col",     "colgroup", "dd",       "details",    "dialog",
            "dir",     "div",      "dl",      "dt",       "fieldset", "figcaption", "figure",
            "footer",  "form",     "frame",   "frameset", "h1",       "h2",         "h3",
            "h4",      "h5",       "h6",      "head",     "header",   "hr",         "html",
            "iframe",  "legend",   "li",      "link",     "main",     "menu",       "menuitem",
            "nav",     "noframes", "ol",      "optgroup", "option",   "p",          "param",
            "search",  "section",  "summary", "table",    "tbody",    "td",         "tfoot",
            "th",      "thead",    "title",   "tr",       "track",    "ul",
        };

        for (block_tags) |tag| {
            if (self.matchHtmlTag(off, tag)) return true;
        }
        return false;
    }

    fn isCompleteHtmlTag(self: *const Parser, off: OFF) bool {
        if (off + 1 >= self.size) return false;
        var pos = off + 1;

        // Closing tag
        if (pos < self.size and self.text[pos] == '/') {
            pos += 1;
            if (pos >= self.size or !helpers.isAlpha(self.text[pos])) return false;
            while (pos < self.size and (helpers.isAlphaNum(self.text[pos]) or self.text[pos] == '-'))
                pos += 1;
            while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
            if (pos >= self.size or self.text[pos] != '>') return false;
            pos += 1;
            // Rest of line must be whitespace only
            while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
            return pos >= self.size or helpers.isNewline(self.text[pos]);
        }

        // Opening tag: <tagname (attributes)* optional-/ >
        if (!helpers.isAlpha(self.text[pos])) return false;
        while (pos < self.size and (helpers.isAlphaNum(self.text[pos]) or self.text[pos] == '-'))
            pos += 1;

        // Parse attributes
        while (true) {
            const ws_start = pos;
            while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
            if (pos >= self.size or helpers.isNewline(self.text[pos])) return false;

            // Check for end of tag
            if (self.text[pos] == '>') {
                pos += 1;
                break;
            }
            if (self.text[pos] == '/' and pos + 1 < self.size and self.text[pos + 1] == '>') {
                pos += 2;
                break;
            }

            // Attributes must be preceded by whitespace
            if (pos == ws_start) return false;

            // Attribute name: [a-zA-Z_:][a-zA-Z0-9_.:-]*
            if (!helpers.isAlpha(self.text[pos]) and self.text[pos] != '_' and self.text[pos] != ':')
                return false;
            pos += 1;
            while (pos < self.size and (helpers.isAlphaNum(self.text[pos]) or
                self.text[pos] == '_' or self.text[pos] == '.' or
                self.text[pos] == ':' or self.text[pos] == '-'))
                pos += 1;

            // Optional attribute value
            var ws_pos = pos;
            while (ws_pos < self.size and helpers.isBlank(self.text[ws_pos])) ws_pos += 1;
            if (ws_pos < self.size and self.text[ws_pos] == '=') {
                pos = ws_pos + 1;
                while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
                if (pos >= self.size or helpers.isNewline(self.text[pos])) return false;

                if (self.text[pos] == '"') {
                    pos += 1;
                    while (pos < self.size and self.text[pos] != '"' and !helpers.isNewline(self.text[pos]))
                        pos += 1;
                    if (pos >= self.size or self.text[pos] != '"') return false;
                    pos += 1;
                } else if (self.text[pos] == '\'') {
                    pos += 1;
                    while (pos < self.size and self.text[pos] != '\'' and !helpers.isNewline(self.text[pos]))
                        pos += 1;
                    if (pos >= self.size or self.text[pos] != '\'') return false;
                    pos += 1;
                } else {
                    // Unquoted value
                    while (pos < self.size and !helpers.isBlank(self.text[pos]) and
                        !helpers.isNewline(self.text[pos]) and
                        self.text[pos] != '"' and self.text[pos] != '\'' and
                        self.text[pos] != '=' and self.text[pos] != '<' and
                        self.text[pos] != '>' and self.text[pos] != '`')
                        pos += 1;
                }
            }
        }

        // Rest of line must be whitespace only
        while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
        return pos >= self.size or helpers.isNewline(self.text[pos]);
    }

    fn isHtmlBlockEndCondition(self: *const Parser, off: OFF, block_type: u8) bool {
        // Types 6 and 7: end condition is a blank line
        if (block_type >= 6) {
            return off >= self.size or helpers.isNewline(self.text[off]);
        }

        // Types 1-5: search from off to end of line for specific end patterns
        var pos = off;
        while (pos < self.size and !helpers.isNewline(self.text[pos])) {
            switch (block_type) {
                1 => {
                    // Type 1: </script>, </pre>, </style>, </textarea> (case insensitive)
                    if (self.text[pos] == '<' and pos + 1 < self.size and self.text[pos + 1] == '/') {
                        if (self.matchHtmlTag(pos, "script") or self.matchHtmlTag(pos, "pre") or
                            self.matchHtmlTag(pos, "style") or self.matchHtmlTag(pos, "textarea"))
                            return true;
                    }
                },
                2 => {
                    // Type 2: -->
                    if (self.text[pos] == '-' and pos + 2 < self.size and
                        self.text[pos + 1] == '-' and self.text[pos + 2] == '>')
                        return true;
                },
                3 => {
                    // Type 3: ?>
                    if (self.text[pos] == '?' and pos + 1 < self.size and self.text[pos + 1] == '>')
                        return true;
                },
                4 => {
                    // Type 4: >
                    if (self.text[pos] == '>')
                        return true;
                },
                5 => {
                    // Type 5: ]]>
                    if (self.text[pos] == ']' and pos + 2 < self.size and
                        self.text[pos + 1] == ']' and self.text[pos + 2] == '>')
                        return true;
                },
                else => return false,
            }
            pos += 1;
        }
        return false;
    }

    fn isTableUnderline(self: *Parser, off: OFF) struct { is_underline: bool, col_count: u32 } {
        var pos = off;
        var col_count: u32 = 0;
        var had_pipe = false;

        // Skip leading pipe
        if (pos < self.size and self.text[pos] == '|') {
            had_pipe = true;
            pos += 1;
            while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
        }

        while (pos < self.size and !helpers.isNewline(self.text[pos])) {
            // Expect optional ':' then dashes then optional ':'
            const has_left_colon = pos < self.size and self.text[pos] == ':';
            if (has_left_colon) pos += 1;

            var dash_count: u32 = 0;
            while (pos < self.size and self.text[pos] == '-') {
                dash_count += 1;
                pos += 1;
            }

            if (dash_count == 0) return .{ .is_underline = false, .col_count = 0 };

            const has_right_colon = pos < self.size and self.text[pos] == ':';
            if (has_right_colon) pos += 1;

            // Determine alignment
            if (col_count < 64) {
                self.table_alignments[col_count] = if (has_left_colon and has_right_colon)
                    .center
                else if (has_left_colon)
                    .left
                else if (has_right_colon)
                    .right
                else
                    .default;
            }

            col_count += 1;

            // Skip whitespace
            while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;

            // Pipe separator or end
            if (pos < self.size and self.text[pos] == '|') {
                had_pipe = true;
                pos += 1;
                while (pos < self.size and helpers.isBlank(self.text[pos])) pos += 1;
                if (pos >= self.size or helpers.isNewline(self.text[pos])) break;
            } else if (pos >= self.size or helpers.isNewline(self.text[pos])) {
                break;
            } else {
                return .{ .is_underline = false, .col_count = 0 };
            }
        }

        if (col_count == 0 or (!had_pipe and col_count < 2))
            return .{ .is_underline = false, .col_count = 0 };

        self.table_col_count = col_count;
        return .{ .is_underline = true, .col_count = col_count };
    }

    fn isContainerMark(self: *const Parser, indent: u32, off: OFF) struct {
        is_container: bool,
        container: Container,
        off: OFF,
    } {
        if (off >= self.size) return .{ .is_container = false, .container = .{}, .off = off };

        // md4c: indent >= code_indent_offset means this is indented code, not a container
        if (indent >= self.code_indent_offset) return .{ .is_container = false, .container = .{}, .off = off };

        const c = self.text[off];

        // Blockquote
        // Note: off points just past '>' — the optional space and remaining
        // indent are handled by the caller via lineIndentation + the
        // whitespace adjustment logic, matching md4c's behavior.
        if (c == '>') {
            return .{
                .is_container = true,
                .container = .{
                    .ch = '>',
                    .mark_indent = indent,
                    .contents_indent = indent + 1,
                },
                .off = off + 1,
            };
        }

        // Unordered list: -, +, *
        // off points just past the marker (before the mandatory space).
        // The space is included in the lineIndentation computation by the caller.
        if ((c == '-' or c == '+' or c == '*') and
            off + 1 < self.size and helpers.isBlank(self.text[off + 1]))
        {
            return .{
                .is_container = true,
                .container = .{
                    .ch = c,
                    .mark_indent = indent,
                    .contents_indent = indent + 1,
                },
                .off = off + 1,
            };
        }
        // Empty unordered list item: marker followed by newline or EOF
        if ((c == '-' or c == '+' or c == '*') and
            (off + 1 >= self.size or helpers.isNewline(self.text[off + 1])))
        {
            return .{
                .is_container = true,
                .container = .{
                    .ch = c,
                    .mark_indent = indent,
                    .contents_indent = indent + 1,
                },
                .off = off + 1,
            };
        }

        // Ordered list: digits followed by . or )
        if (helpers.isDigit(c)) {
            var pos = off;
            var num: u32 = 0;
            while (pos < self.size and helpers.isDigit(self.text[pos]) and pos - off < 9) {
                num = num * 10 + @as(u32, self.text[pos] - '0');
                pos += 1;
            }
            if (pos < self.size and (self.text[pos] == '.' or self.text[pos] == ')')) {
                const delim = self.text[pos];
                pos += 1; // Past delimiter
                if (pos < self.size and helpers.isBlank(self.text[pos])) {
                    // contents_indent = indent + marker_width (digits + delimiter)
                    const mark_width = pos - off;
                    return .{
                        .is_container = true,
                        .container = .{
                            .ch = delim,
                            .start = num,
                            .mark_indent = indent,
                            .contents_indent = indent + @as(u32, @intCast(mark_width)),
                        },
                        .off = pos,
                    };
                }
                // Empty list item
                if (pos >= self.size or helpers.isNewline(self.text[pos])) {
                    const mark_width = pos - off;
                    return .{
                        .is_container = true,
                        .container = .{
                            .ch = delim,
                            .start = num,
                            .mark_indent = indent,
                            .contents_indent = indent + @as(u32, @intCast(mark_width)),
                        },
                        .off = pos,
                    };
                }
            }
        }

        return .{ .is_container = false, .container = .{}, .off = off };
    }

    // ========================================
    // Ref def management
    // ========================================

    const RefDef = struct {
        label: []const u8, // normalized label
        dest: []const u8, // raw destination (slice of source)
        title: []const u8, // raw title (slice of source)
    };

    /// Normalize a link label for comparison: collapse whitespace runs to single space,
    /// strip leading/trailing whitespace, case-fold.
    fn normalizeLabel(self: *Parser, raw: []const u8) []const u8 {
        // Collapse whitespace and apply Unicode case folding (per CommonMark §6.7)
        var result = std.ArrayListUnmanaged(u8){};
        var in_ws = true; // skip leading whitespace
        var i: usize = 0;
        while (i < raw.len) {
            const c = raw[i];
            if (c == ' ' or c == '\t' or c == '\n' or c == '\r') {
                if (!in_ws and result.items.len > 0) {
                    result.append(self.allocator, ' ') catch return raw;
                    in_ws = true;
                }
                i += 1;
            } else if (c < 0x80) {
                // ASCII: simple toLower
                result.append(self.allocator, std.ascii.toLower(c)) catch return raw;
                in_ws = false;
                i += 1;
            } else {
                // Multi-byte UTF-8: decode, case fold, re-encode
                const decoded = helpers.decodeUtf8(raw, i);
                const fold = unicode.caseFold(decoded.codepoint);
                var j: u2 = 0;
                while (j < fold.n_codepoints) : (j += 1) {
                    var buf: [4]u8 = undefined;
                    const len = helpers.encodeUtf8(fold.codepoints[j], &buf);
                    if (len > 0) {
                        result.appendSlice(self.allocator, buf[0..len]) catch return raw;
                    }
                }
                in_ws = false;
                i += @as(usize, decoded.len);
            }
        }
        // Strip trailing space
        if (result.items.len > 0 and result.items[result.items.len - 1] == ' ') {
            result.items.len -= 1;
        }
        return result.items;
    }

    /// Look up a reference definition by label (case-insensitive, whitespace-normalized).
    fn lookupRefDef(self: *Parser, raw_label: []const u8) ?RefDef {
        if (raw_label.len == 0) return null;
        const normalized = self.normalizeLabel(raw_label);
        if (normalized.len == 0) return null; // whitespace-only labels are invalid
        for (self.ref_defs.items) |rd| {
            if (std.mem.eql(u8, rd.label, normalized)) return rd;
        }
        return null;
    }

    /// Try to parse a link reference definition from merged paragraph text at position `pos`.
    /// Returns the end position and the parsed ref def, or null if not a valid ref def.
    fn parseRefDef(self: *Parser, text: []const u8, pos: usize) ?struct { end_pos: usize, label: []const u8, dest: []const u8, title: []const u8 } {
        var p = pos;

        // Must start with [
        if (p >= text.len or text[p] != '[') return null;
        p += 1;

        // Parse label: content up to ], no unescaped [ or ]
        const label_start = p;
        var label_len: usize = 0;
        while (p < text.len and text[p] != ']') {
            if (text[p] == '[') return null; // no nested [
            if (text[p] == '\\' and p + 1 < text.len) {
                p += 2;
                label_len += 2;
            } else {
                p += 1;
                label_len += 1;
            }
            if (label_len > 999) return null; // label too long
        }
        if (p >= text.len) return null; // no closing ]
        const label = text[label_start..p];
        if (label.len == 0) return null; // empty label
        p += 1; // skip ]

        // Must be followed by :
        if (p >= text.len or text[p] != ':') return null;
        p += 1;

        // Skip optional whitespace including up to one newline
        p = self.skipRefDefWhitespace(text, p);

        // Parse destination
        const dest_result = self.parseRefDefDest(text, p) orelse return null;
        p = dest_result.end_pos;
        const dest = dest_result.dest;

        // Save position before trying title (may need to backtrack)
        const pos_after_dest = p;

        // Skip optional whitespace including up to one newline
        const p_before_title_ws = p;
        p = self.skipRefDefWhitespace(text, p);
        const had_newline_before_title = blk: {
            var i = p_before_title_ws;
            while (i < p) : (i += 1) {
                if (text[i] == '\n') break :blk true;
            }
            break :blk false;
        };

        // Parse optional title
        var title: []const u8 = "";
        var had_whitespace_before_title = false;
        if (p < text.len and (text[p] == '"' or text[p] == '\'' or text[p] == '(')) {
            // Check that there was actual whitespace between dest and title
            had_whitespace_before_title = (p > pos_after_dest);
            if (had_whitespace_before_title) {
                if (self.parseRefDefTitle(text, p)) |title_result| {
                    // Title must be followed by optional whitespace then end of line or end of text
                    var after_title = title_result.end_pos;
                    while (after_title < text.len and (text[after_title] == ' ' or text[after_title] == '\t')) after_title += 1;
                    if (after_title >= text.len or text[after_title] == '\n') {
                        title = title_result.title;
                        p = after_title;
                        if (p < text.len and text[p] == '\n') p += 1;
                        return .{ .end_pos = p, .label = label, .dest = dest, .title = title };
                    }
                    // Title present but not followed by end of line — if title was on same line as dest, invalid
                    // If title was on new line, treat as no title (title line is separate paragraph content)
                    if (!had_newline_before_title) {
                        return null; // title on same line as dest but not at end of line
                    }
                } else {
                    // Invalid title syntax
                    if (!had_newline_before_title) {
                        return null;
                    }
                }
            }
        }

        // No title: backtrack to right after destination and check for end-of-line
        p = pos_after_dest;
        while (p < text.len and (text[p] == ' ' or text[p] == '\t')) p += 1;
        if (p < text.len and text[p] != '\n') return null;
        if (p < text.len and text[p] == '\n') p += 1;

        return .{ .end_pos = p, .label = label, .dest = dest, .title = title };
    }

    fn skipRefDefWhitespace(self: *const Parser, text: []const u8, start: usize) usize {
        _ = self;
        var p = start;
        while (p < text.len and (text[p] == ' ' or text[p] == '\t')) p += 1;
        if (p < text.len and text[p] == '\n') {
            p += 1;
            while (p < text.len and (text[p] == ' ' or text[p] == '\t')) p += 1;
        }
        return p;
    }

    fn parseRefDefDest(self: *const Parser, text: []const u8, start: usize) ?struct { dest: []const u8, end_pos: usize } {
        _ = self;
        var p = start;
        if (p >= text.len) return null;

        if (text[p] == '<') {
            // Angle-bracket destination
            p += 1;
            const dest_start = p;
            while (p < text.len and text[p] != '>' and text[p] != '\n') {
                if (text[p] == '\\' and p + 1 < text.len) {
                    p += 2;
                } else {
                    p += 1;
                }
            }
            if (p >= text.len or text[p] != '>') return null;
            const dest = text[dest_start..p];
            p += 1; // skip >
            return .{ .dest = dest, .end_pos = p };
        } else {
            // Bare destination — balance parentheses
            const dest_start = p;
            var paren_depth: u32 = 0;
            while (p < text.len and !helpers.isWhitespace(text[p])) {
                if (text[p] == '(') {
                    paren_depth += 1;
                } else if (text[p] == ')') {
                    if (paren_depth == 0) break;
                    paren_depth -= 1;
                }
                if (text[p] == '\\' and p + 1 < text.len) {
                    p += 2;
                } else {
                    p += 1;
                }
            }
            if (p == dest_start) return null; // empty dest not allowed for bare
            return .{ .dest = text[dest_start..p], .end_pos = p };
        }
    }

    fn parseRefDefTitle(self: *const Parser, text: []const u8, start: usize) ?struct { title: []const u8, end_pos: usize } {
        _ = self;
        var p = start;
        if (p >= text.len) return null;

        const open_char = text[p];
        const close_char: u8 = if (open_char == '(') ')' else open_char;
        if (open_char != '"' and open_char != '\'' and open_char != '(') return null;
        p += 1;
        const title_start = p;

        while (p < text.len and text[p] != close_char) {
            if (text[p] == '\\' and p + 1 < text.len) {
                p += 2;
            } else {
                // For () titles, nested ( is not allowed
                if (open_char == '(' and text[p] == '(') return null;
                p += 1;
            }
        }
        if (p >= text.len) return null; // no closing quote/paren
        const title = text[title_start..p];
        p += 1; // skip close
        return .{ .title = title, .end_pos = p };
    }

    fn buildRefDefHashtable(self: *Parser) error{OutOfMemory}!void {
        var off: usize = 0;
        const bytes = self.block_bytes.items;

        while (off < bytes.len) {
            // Align to BlockHeader
            const align_mask: usize = @alignOf(BlockHeader) - 1;
            off = (off + align_mask) & ~align_mask;
            if (off + @sizeOf(BlockHeader) > bytes.len) break;

            const hdr: *BlockHeader = @ptrCast(@alignCast(bytes.ptr + off));
            const hdr_off = off;
            off += @sizeOf(BlockHeader);

            const n_lines = hdr.n_lines;
            const lines_size = n_lines * @sizeOf(VerbatimLine);
            if (off + lines_size > bytes.len) break;

            const line_ptr: [*]VerbatimLine = @ptrCast(@alignCast(bytes.ptr + off));
            const block_lines = line_ptr[0..n_lines];
            off += lines_size;

            // Only process paragraph blocks (not container openers/closers)
            if (hdr.block_type != .p or hdr.flags & types.BLOCK_CONTAINER_OPENER != 0 or hdr.flags & types.BLOCK_CONTAINER_CLOSER != 0) {
                continue;
            }

            if (n_lines == 0) continue;

            // Merge lines into buffer to parse ref defs
            self.buffer.clearRetainingCapacity();
            for (block_lines) |vline| {
                if (vline.beg > vline.end or vline.end > self.size) continue;
                if (self.buffer.items.len > 0) {
                    self.buffer.append(self.allocator, '\n') catch {};
                }
                self.buffer.appendSlice(self.allocator, self.text[vline.beg..vline.end]) catch {};
            }

            const merged = self.buffer.items;
            var pos: usize = 0;
            var lines_consumed: u32 = 0;

            // Try to parse consecutive ref defs from the start
            while (pos < merged.len) {
                const result = self.parseRefDef(merged, pos) orelse break;

                // Normalize and store the ref def (first definition wins)
                const norm_label = self.normalizeLabel(result.label);
                if (norm_label.len == 0) break; // whitespace-only labels are invalid
                var already_exists = false;
                for (self.ref_defs.items) |existing| {
                    if (std.mem.eql(u8, existing.label, norm_label)) {
                        already_exists = true;
                        break;
                    }
                }
                if (!already_exists) {
                    // Dupe dest and title since they point into self.buffer which gets reused
                    const dest_dupe = self.allocator.dupe(u8, result.dest) catch return error.OutOfMemory;
                    const title_dupe = self.allocator.dupe(u8, result.title) catch return error.OutOfMemory;
                    try self.ref_defs.append(self.allocator, .{
                        .label = norm_label,
                        .dest = dest_dupe,
                        .title = title_dupe,
                    });
                }

                // Count how many newlines were consumed to track lines
                var newlines: u32 = 0;
                for (merged[pos..result.end_pos]) |mc| {
                    if (mc == '\n') newlines += 1;
                }
                // If end_pos is at the end and last char wasn't \n, that's still a consumed line
                if (result.end_pos >= merged.len and (result.end_pos == pos or merged[result.end_pos - 1] != '\n')) {
                    newlines += 1;
                }
                lines_consumed += newlines;
                pos = result.end_pos;
            }

            // Update the block: mark consumed lines
            if (lines_consumed > 0) {
                if (lines_consumed >= n_lines) {
                    // Entire paragraph is ref defs — flag to skip during rendering
                    hdr.flags |= types.BLOCK_REF_DEF_ONLY;
                } else {
                    // Mark consumed lines as invalid (beg > end triggers skip in processLeafBlock)
                    const line_base: [*]VerbatimLine = @ptrCast(@alignCast(bytes.ptr + hdr_off + @sizeOf(BlockHeader)));
                    var i: u32 = 0;
                    while (i < lines_consumed) : (i += 1) {
                        line_base[i].beg = 1;
                        line_base[i].end = 0;
                    }
                }
            }
        }
    }

    /// Render a reference link/image given the resolved ref def.
    fn renderRefLink(self: *Parser, label_content: []const u8, ref: RefDef, is_image: bool) void {
        if (self.image_nesting_level > 0) {
            // Inside image alt text — emit only text, no HTML tags
            self.processInlineContent(label_content, 0);
        } else if (is_image) {
            self.writeHtml("<img src=\"");
            self.writeUrlWithEscapes(ref.dest);
            self.writeHtml("\" alt=\"");
            self.image_nesting_level += 1;
            self.processInlineContent(label_content, 0);
            self.image_nesting_level -= 1;
            self.writeHtml("\"");
            if (ref.title.len > 0) {
                self.writeHtml(" title=\"");
                self.writeTitleWithEscapes(ref.title);
                self.writeHtml("\"");
            }
            self.writeHtml(" />");
        } else {
            self.writeHtml("<a href=\"");
            self.writeUrlWithEscapes(ref.dest);
            self.writeHtml("\"");
            if (ref.title.len > 0) {
                self.writeHtml(" title=\"");
                self.writeTitleWithEscapes(ref.title);
                self.writeHtml("\"");
            }
            self.writeHtml(">");
            self.link_nesting_level += 1;
            self.processInlineContent(label_content, 0);
            self.link_nesting_level -= 1;
            self.writeHtml("</a>");
        }
    }
};

fn isListBullet(c: u8) bool {
    return c == '-' or c == '+' or c == '*';
}

fn isListItemMark(c: u8) bool {
    return c == '-' or c == '+' or c == '*' or c == '.' or c == ')';
}

// ========================================
// Permissive Autolink Detection
// ========================================

const AutolinkResult = struct {
    found: bool,
    beg: usize,
    end: usize,
};

/// Check that emphasis chars at autolink boundaries are actually resolved delimiters.
/// Called when the relaxed (allow_emph) pass found an autolink but the strict pass didn't.
fn isEmphBoundaryResolved(content: []const u8, al: AutolinkResult, resolved: []const Parser.EmphDelim) bool {
    // Check left boundary: if it's an emphasis char, it must be a resolved delimiter
    if (al.beg > 0) {
        const prev = content[al.beg - 1];
        if (prev == '*' or prev == '_' or prev == '~') {
            if (!checkLeftBoundary(content, al.beg, false)) {
                // Left boundary failed strict check, emphasis char caused the relaxed match.
                // Verify it's actually resolved.
                var found_resolved = false;
                for (resolved) |d| {
                    if (d.pos <= al.beg - 1 and al.beg - 1 < d.pos + d.count and
                        (d.open_count + d.close_count > 0))
                    {
                        found_resolved = true;
                        break;
                    }
                }
                if (!found_resolved) return false;
            }
        }
    }
    // Check right boundary: if it's an emphasis char, it must be a resolved delimiter
    if (al.end < content.len) {
        const next = content[al.end];
        if (next == '*' or next == '_' or next == '~') {
            if (!checkRightBoundary(content, al.end, false)) {
                var found_resolved = false;
                for (resolved) |d| {
                    if (d.pos <= al.end and al.end < d.pos + d.count and
                        (d.open_count + d.close_count > 0))
                    {
                        found_resolved = true;
                        break;
                    }
                }
                if (!found_resolved) return false;
            }
        }
    }
    return true;
}

/// Scan a URL component (host, path, query, or fragment) following md4c's URL_MAP.
fn scanUrlComponent(
    content: []const u8,
    start: usize,
    start_char: u8,
    delim_char: u8,
    allowed_nonalnum: []const u8,
    min_components: u32,
    optional_end_char: u8,
) struct { end: usize, ok: bool } {
    var pos = start;
    var n_components: u32 = 0;
    var n_open_brackets: i32 = 0;

    // Check start character
    if (start_char != 0) {
        if (pos >= content.len or content[pos] != start_char)
            return .{ .end = pos, .ok = min_components == 0 };
        if (min_components > 0 and (pos + 1 >= content.len or !helpers.isAlphaNum(content[pos + 1])))
            return .{ .end = pos, .ok = min_components == 0 };
        pos += 1;
    }

    while (pos < content.len) {
        if (helpers.isAlphaNum(content[pos])) {
            if (n_components == 0)
                n_components = 1;
            pos += 1;
        } else if (isInSet(content[pos], allowed_nonalnum) and
            ((pos > 0 and (helpers.isAlphaNum(content[pos - 1]) or content[pos - 1] == ')')) or content[pos] == '(') and
            ((pos + 1 < content.len and (helpers.isAlphaNum(content[pos + 1]) or content[pos + 1] == '(')) or content[pos] == ')'))
        {
            if (content[pos] == delim_char)
                n_components += 1;
            if (content[pos] == '(') {
                n_open_brackets += 1;
            } else if (content[pos] == ')') {
                if (n_open_brackets <= 0)
                    break;
                n_open_brackets -= 1;
            }
            pos += 1;
        } else {
            break;
        }
    }

    if (pos < content.len and optional_end_char != 0 and content[pos] == optional_end_char)
        pos += 1;

    if (n_components < min_components or n_open_brackets != 0)
        return .{ .end = pos, .ok = false };

    return .{ .end = pos, .ok = true };
}

fn isInSet(c: u8, set: []const u8) bool {
    for (set) |s| {
        if (c == s) return true;
    }
    return false;
}

/// Check left boundary for permissive autolinks.
/// When `allow_emph` is true, emphasis delimiters (*_~) are also valid boundaries.
fn checkLeftBoundary(content: []const u8, pos: usize, allow_emph: bool) bool {
    if (pos == 0) return true;
    const prev = content[pos - 1];
    if (helpers.isWhitespace(prev) or prev == '\n' or prev == '\r') return true;
    if (prev == '(' or prev == '{' or prev == '[') return true;
    if (allow_emph and (prev == '*' or prev == '_' or prev == '~')) return true;
    return false;
}

/// Check right boundary for permissive autolinks.
/// When `allow_emph` is true, emphasis delimiters (*_~) are also valid boundaries.
fn checkRightBoundary(content: []const u8, pos: usize, allow_emph: bool) bool {
    if (pos >= content.len) return true;
    const next = content[pos];
    if (helpers.isWhitespace(next) or next == '\n' or next == '\r') return true;
    if (next == ')' or next == '}' or next == ']') return true;
    if (next == '.' or next == '!' or next == '?' or next == ',' or next == ';') return true;
    if (allow_emph and (next == '*' or next == '_' or next == '~')) return true;
    return false;
}

/// Detect permissive autolinks at the given position in content.
/// `pos` is the position of the trigger character ('@', ':', or '.').
fn findPermissiveAutolink(content: []const u8, pos: usize, allow_emph: bool) AutolinkResult {
    const c = content[pos];

    if (c == ':') {
        // URL autolink: check for http://, https://, ftp://
        const Scheme = struct { name: []const u8, suffix: []const u8 };
        const schemes = [_]Scheme{
            .{ .name = "http", .suffix = "//" },
            .{ .name = "https", .suffix = "//" },
            .{ .name = "ftp", .suffix = "//" },
        };

        for (schemes) |scheme| {
            const slen = scheme.name.len;
            const suflen = scheme.suffix.len;
            if (pos >= slen and pos + 1 + suflen < content.len) {
                if (helpers.asciiCaseEql(content[pos - slen .. pos], scheme.name) and
                    std.mem.eql(u8, content[pos + 1 .. pos + 1 + suflen], scheme.suffix))
                {
                    const beg = pos - slen;
                    if (!checkLeftBoundary(content, beg, allow_emph)) continue;

                    var end = pos + 1 + suflen;
                    // Scan URL components: host (mandatory), path, query, fragment
                    const host = scanUrlComponent(content, end, 0, '.', ".-_", 2, 0);
                    if (!host.ok) continue;
                    end = host.end;

                    const path = scanUrlComponent(content, end, '/', '/', "/.-_", 0, '/');
                    end = path.end;

                    const query = scanUrlComponent(content, end, '?', '&', "&.-+_=()", 1, 0);
                    end = query.end;

                    const frag = scanUrlComponent(content, end, '#', 0, ".-+_", 1, 0);
                    end = frag.end;

                    if (!checkRightBoundary(content, end, allow_emph)) continue;

                    return .{ .found = true, .beg = beg, .end = end };
                }
            }
        }
    } else if (c == '@') {
        // Email autolink: scan backward for username, forward for domain
        if (pos == 0 or pos + 3 >= content.len) return .{ .found = false, .beg = 0, .end = 0 };
        if (!helpers.isAlphaNum(content[pos - 1]) or !helpers.isAlphaNum(content[pos + 1]))
            return .{ .found = false, .beg = 0, .end = 0 };

        // Scan backward for username
        var beg = pos;
        while (beg > 0) {
            if (helpers.isAlphaNum(content[beg - 1])) {
                beg -= 1;
            } else if (beg >= 2 and helpers.isAlphaNum(content[beg - 2]) and
                isInSet(content[beg - 1], ".-_+") and helpers.isAlphaNum(content[beg]))
            {
                beg -= 1;
            } else {
                break;
            }
        }
        if (beg == pos) return .{ .found = false, .beg = 0, .end = 0 }; // empty username

        if (!checkLeftBoundary(content, beg, allow_emph)) return .{ .found = false, .beg = 0, .end = 0 };

        // Scan forward for domain (host component only for email)
        const host = scanUrlComponent(content, pos + 1, 0, '.', ".-_", 2, 0);
        if (!host.ok) return .{ .found = false, .beg = 0, .end = 0 };
        const end = host.end;

        if (!checkRightBoundary(content, end, allow_emph)) return .{ .found = false, .beg = 0, .end = 0 };

        return .{ .found = true, .beg = beg, .end = end };
    } else if (c == '.') {
        // WWW autolink: check for "www." prefix
        if (pos < 3) return .{ .found = false, .beg = 0, .end = 0 };
        if (!helpers.asciiCaseEql(content[pos - 3 .. pos], "www"))
            return .{ .found = false, .beg = 0, .end = 0 };

        const beg = pos - 3;
        if (!checkLeftBoundary(content, beg, allow_emph)) return .{ .found = false, .beg = 0, .end = 0 };

        // Scan URL components starting from after the '.'
        var end = pos + 1;
        const host = scanUrlComponent(content, end, 0, '.', ".-_", 1, 0);
        if (!host.ok) return .{ .found = false, .beg = 0, .end = 0 };
        end = host.end;

        const path = scanUrlComponent(content, end, '/', '/', "/.-_", 0, '/');
        end = path.end;

        const query = scanUrlComponent(content, end, '?', '&', "&.-+_=()", 1, 0);
        end = query.end;

        const frag = scanUrlComponent(content, end, '#', 0, ".-+_", 1, 0);
        end = frag.end;

        if (!checkRightBoundary(content, end, allow_emph)) return .{ .found = false, .beg = 0, .end = 0 };

        return .{ .found = true, .beg = beg, .end = end };
    }

    return .{ .found = false, .beg = 0, .end = 0 };
}

// ========================================
// Public API
// ========================================

pub fn renderToHtml(text: []const u8, allocator: Allocator, flags: Flags) error{OutOfMemory}![]u8 {
    // Skip UTF-8 BOM
    const input = helpers.skipUtf8Bom(text);

    var output = OutputBuffer{
        .list = .{},
        .allocator = allocator,
        .oom = false,
    };

    var parser = Parser.init(allocator, input, flags, &output);
    defer parser.deinit();

    try parser.processDoc();

    if (output.oom) return error.OutOfMemory;

    return output.list.toOwnedSlice(allocator);
}

const entity_mod = @import("./entity.zig");
const helpers = @import("./helpers.zig");
const std = @import("std");
const unicode = @import("./unicode.zig");
const Allocator = std.mem.Allocator;

const types = @import("./types.zig");
const Align = types.Align;
const Attribute = types.Attribute;
const BlockType = types.BlockType;
const Container = types.Container;
const Flags = types.Flags;
const Line = types.Line;
const Mark = types.Mark;
const OFF = types.OFF;
const SpanType = types.SpanType;
const TextType = types.TextType;
const VerbatimLine = types.VerbatimLine;
