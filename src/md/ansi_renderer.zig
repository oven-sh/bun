//! Markdown → ANSI renderer. Used by `bun ./file.md` to pretty-print
//! markdown documents to the terminal with colors, hyperlinks, syntax
//! highlighting, and Unicode box drawing.

pub const Theme = struct {
    /// True when the terminal background is light. Controls color choices
    /// so text stays readable.
    light: bool = false,
    /// Terminal column count. Used for word-wrapping paragraphs and sizing
    /// horizontal rules. 0 disables wrapping.
    columns: u16 = 80,
    /// Emit colors and styles. When false the renderer emits plain text.
    colors: bool = true,
    /// Emit OSC 8 hyperlinks. When false links are shown as "text (url)".
    hyperlinks: bool = true,
};

pub const AnsiRenderer = struct {
    out: OutputBuffer,
    allocator: Allocator,
    src_text: []const u8,
    theme: Theme,
    /// Stack of active block contexts (li/quote) for indentation.
    block_stack: std.ArrayListUnmanaged(BlockContext) = .{},
    /// Currently open span styles (bit flags).
    span_flags: u32 = 0,
    /// Non-empty when we're inside a link span; the href to emit in OSC 8.
    link_href: []const u8 = "",
    /// Depth of enclosing link spans (brackets can nest in markdown parsers).
    link_depth: u32 = 0,
    /// Depth of enclosing image spans — text inside images becomes alt text
    /// rather than normal output.
    image_depth: u32 = 0,
    /// Buffered alt text for the innermost image.
    image_alt: std.ArrayListUnmanaged(u8) = .{},
    /// Saved image src URL for when the image span closes.
    image_src: []const u8 = "",
    /// Saved image title (rendered after alt).
    image_title: []const u8 = "",
    /// Active paragraph-level wrapping column usage. Tracks visible chars
    /// written on the current line so word wrapping works inside headings
    /// and paragraphs.
    col: u32 = 0,
    /// True when we're collecting a code block body (fenced or indented).
    in_code_block: bool = false,
    /// Language extracted from the fenced code block info string.
    code_lang: []const u8 = "",
    /// Whether the current code block is fenced (not indented).
    code_fenced: bool = false,
    /// Buffer of the current code block body, flushed on leaveBlock(.code).
    code_buf: std.ArrayListUnmanaged(u8) = .{},
    /// Heading level currently being rendered (0 = none).
    heading_level: u8 = 0,
    /// Buffer of the current heading text, flushed on leaveBlock(.h).
    heading_buf: std.ArrayListUnmanaged(u8) = .{},
    /// Table state: cells of the current row with their alignment + width.
    table_cells: std.ArrayListUnmanaged(TableCell) = .{},
    /// Buffered rows for the current table, flushed on leaveBlock(.table).
    table_rows: std.ArrayListUnmanaged(TableRow) = .{},
    /// Buffer for the current table cell being rendered.
    table_cell_buf: std.ArrayListUnmanaged(u8) = .{},
    /// True when inside a table header row.
    in_thead: bool = false,
    /// True when inside a table cell (th/td) to capture output.
    in_cell: bool = false,
    /// Current cell alignment being captured.
    cell_align: types.Align = .default,
    /// Track whether we just emitted a newline, to collapse extra blanks.
    last_was_newline: bool = true,
    /// Depth of blockquote nesting for left bar rendering.
    quote_depth: u32 = 0,

    const BlockContext = struct {
        kind: Kind,
        /// ordered-list start number or ul marker char
        data: u32 = 0,
        /// 0-based index of the current child (for numbered lists)
        index: u32 = 0,
        /// Indent (in characters) added by this block.
        indent: u32 = 0,

        const Kind = enum { quote, ul, ol, li };
    };

    const TableCell = struct {
        content: []const u8,
        alignment: types.Align,
    };

    const TableRow = struct {
        cells: []TableCell,
        is_header: bool,
    };

    // Span flags
    const SPAN_EM: u32 = 1 << 0;
    const SPAN_STRONG: u32 = 1 << 1;
    const SPAN_DEL: u32 = 1 << 2;
    const SPAN_U: u32 = 1 << 3;
    const SPAN_CODE: u32 = 1 << 4;

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

    pub fn init(allocator: Allocator, src_text: []const u8, theme: Theme) AnsiRenderer {
        return .{
            .out = .{ .list = .{}, .allocator = allocator, .oom = false },
            .allocator = allocator,
            .src_text = src_text,
            .theme = theme,
        };
    }

    pub fn deinit(self: *AnsiRenderer) void {
        self.out.list.deinit(self.allocator);
        self.block_stack.deinit(self.allocator);
        self.image_alt.deinit(self.allocator);
        self.code_buf.deinit(self.allocator);
        self.heading_buf.deinit(self.allocator);
        for (self.table_rows.items) |row| {
            for (row.cells) |cell| self.allocator.free(cell.content);
            self.allocator.free(row.cells);
        }
        self.table_rows.deinit(self.allocator);
        self.table_cells.deinit(self.allocator);
        self.table_cell_buf.deinit(self.allocator);
    }

    pub fn toOwnedSlice(self: *AnsiRenderer) error{OutOfMemory}![]u8 {
        if (self.out.oom) return error.OutOfMemory;
        return self.out.list.toOwnedSlice(self.allocator);
    }

    pub fn renderer(self: *AnsiRenderer) Renderer {
        return .{ .ptr = self, .vtable = &vtable };
    }

    pub const vtable: Renderer.VTable = .{
        .enterBlock = enterBlockImpl,
        .leaveBlock = leaveBlockImpl,
        .enterSpan = enterSpanImpl,
        .leaveSpan = leaveSpanImpl,
        .text = textImpl,
    };

    fn enterBlockImpl(ptr: *anyopaque, block_type: BlockType, data: u32, flags: u32) bun.JSError!void {
        const self: *AnsiRenderer = @ptrCast(@alignCast(ptr));
        self.enterBlock(block_type, data, flags);
    }

    fn leaveBlockImpl(ptr: *anyopaque, block_type: BlockType, data: u32) bun.JSError!void {
        const self: *AnsiRenderer = @ptrCast(@alignCast(ptr));
        self.leaveBlock(block_type, data);
    }

    fn enterSpanImpl(ptr: *anyopaque, span_type: SpanType, detail: SpanDetail) bun.JSError!void {
        const self: *AnsiRenderer = @ptrCast(@alignCast(ptr));
        self.enterSpan(span_type, detail);
    }

    fn leaveSpanImpl(ptr: *anyopaque, span_type: SpanType) bun.JSError!void {
        const self: *AnsiRenderer = @ptrCast(@alignCast(ptr));
        self.leaveSpan(span_type);
    }

    fn textImpl(ptr: *anyopaque, text_type: TextType, content: []const u8) bun.JSError!void {
        const self: *AnsiRenderer = @ptrCast(@alignCast(ptr));
        self.text(text_type, content);
    }

    // ========================================
    // Block rendering
    // ========================================

    pub fn enterBlock(self: *AnsiRenderer, block_type: BlockType, data: u32, flags: u32) void {
        switch (block_type) {
            .doc => {},
            .quote => {
                self.ensureBlankLine();
                self.quote_depth += 1;
                self.block_stack.append(self.allocator, .{ .kind = .quote, .indent = 2 }) catch {
                    self.out.oom = true;
                };
            },
            .ul => {
                self.ensureNewline();
                self.block_stack.append(self.allocator, .{ .kind = .ul, .data = data, .indent = 2 }) catch {
                    self.out.oom = true;
                };
            },
            .ol => {
                self.ensureNewline();
                self.block_stack.append(self.allocator, .{ .kind = .ol, .data = data, .indent = 3 }) catch {
                    self.out.oom = true;
                };
            },
            .li => {
                self.ensureNewline();
                self.writeIndent();
                var entry: BlockContext = .{ .kind = .li };
                const parent_list = self.findParentList();
                const task_mark = types.taskMarkFromData(data);
                if (parent_list) |list| {
                    entry.index = list.index;
                    list.index += 1;
                }
                if (task_mark != 0) {
                    const checked = types.isTaskChecked(task_mark);
                    const glyph = if (checked) "☒ " else "☐ ";
                    const c = if (checked) color(.green) else color(.dim);
                    self.writeStyled(c, glyph);
                    self.writeStyled(reset(), "");
                } else if (parent_list != null and parent_list.?.kind == .ol) {
                    const start = parent_list.?.data;
                    const num = start + entry.index;
                    var buf: [12]u8 = undefined;
                    const s = std.fmt.bufPrint(&buf, "{d}.", .{num}) catch "?";
                    self.writeStyled(color(.cyan), s);
                    self.writeRaw(" ");
                    self.col += @intCast(s.len + 1);
                } else {
                    self.writeStyled(color(.cyan), "• ");
                    self.col += 2;
                }
                self.block_stack.append(self.allocator, entry) catch {
                    self.out.oom = true;
                };
            },
            .hr => {
                self.ensureBlankLine();
                self.writeIndent();
                const width: u32 = @min(self.theme.columns, 60);
                var i: u32 = 0;
                const dash = "─";
                self.writeStyled(color(.dim), "");
                while (i < width) : (i += 1) self.writeRaw(dash);
                self.writeStyled(reset(), "");
                self.writeRaw("\n");
                self.last_was_newline = true;
                self.col = 0;
            },
            .h => {
                self.ensureBlankLine();
                self.heading_level = @intCast(data);
                self.heading_buf.clearRetainingCapacity();
                // heading content is buffered; on leaveBlock we print with
                // full styling + underline.
            },
            .code => {
                self.ensureBlankLine();
                self.in_code_block = true;
                self.code_fenced = (flags & types.BLOCK_FENCED_CODE) != 0;
                self.code_buf.clearRetainingCapacity();
                if (self.code_fenced) {
                    self.code_lang = extractLanguage(self.src_text, data);
                } else {
                    self.code_lang = "";
                }
            },
            .html => {
                self.ensureNewline();
            },
            .p => {
                // When a paragraph sits directly inside a list item, the li
                // marker has already emitted the indent + bullet; don't add
                // a blank line or re-indent.
                const top = if (self.block_stack.items.len > 0)
                    self.block_stack.items[self.block_stack.items.len - 1].kind
                else
                    null;
                if (top != null and top.? == .li and self.col > 0) {
                    // continue on the same line
                } else {
                    self.ensureBlankLine();
                    self.writeIndent();
                }
            },
            .table => {
                self.ensureBlankLine();
                self.in_thead = false;
                // Free any leftover rows from a previous invocation.
                for (self.table_rows.items) |row| {
                    for (row.cells) |cell| self.allocator.free(cell.content);
                    self.allocator.free(row.cells);
                }
                self.table_rows.clearRetainingCapacity();
                self.table_cells.clearRetainingCapacity();
            },
            .thead => {
                self.in_thead = true;
            },
            .tbody => {
                self.in_thead = false;
            },
            .tr => {
                self.table_cells.clearRetainingCapacity();
            },
            .th, .td => {
                self.in_cell = true;
                self.cell_align = types.alignmentFromData(data);
                self.table_cell_buf.clearRetainingCapacity();
            },
        }
    }

    pub fn leaveBlock(self: *AnsiRenderer, block_type: BlockType, data: u32) void {
        switch (block_type) {
            .doc => {},
            .quote => {
                self.quote_depth -= 1;
                _ = self.block_stack.pop();
                self.ensureNewline();
            },
            .ul, .ol => {
                _ = self.block_stack.pop();
                self.ensureNewline();
            },
            .li => {
                _ = self.block_stack.pop();
                self.ensureNewline();
            },
            .hr => {},
            .h => {
                self.flushHeading();
                self.heading_level = 0;
            },
            .code => {
                self.flushCodeBlock();
                self.in_code_block = false;
                self.code_lang = "";
            },
            .html => {
                self.ensureNewline();
            },
            .p => {
                self.writeStyled(reset(), "");
                self.ensureNewline();
                self.col = 0;
            },
            .table => {
                self.flushTable();
                self.ensureNewline();
            },
            .thead, .tbody => {},
            .tr => {
                // Move the collected cells into a table row; widths will be
                // normalized once the table finishes.
                const cells = self.allocator.dupe(TableCell, self.table_cells.items) catch {
                    self.out.oom = true;
                    return;
                };
                self.table_rows.append(self.allocator, .{
                    .cells = cells,
                    .is_header = self.in_thead,
                }) catch {
                    self.out.oom = true;
                    return;
                };
                self.table_cells.clearRetainingCapacity();
            },
            .th, .td => {
                self.in_cell = false;
                const owned = self.allocator.dupe(u8, self.table_cell_buf.items) catch {
                    self.out.oom = true;
                    return;
                };
                self.table_cells.append(self.allocator, .{
                    .content = owned,
                    .alignment = self.cell_align,
                }) catch {
                    self.out.oom = true;
                };
            },
        }
        _ = data;
    }

    // ========================================
    // Span rendering
    // ========================================

    pub fn enterSpan(self: *AnsiRenderer, span_type: SpanType, detail: SpanDetail) void {
        switch (span_type) {
            .em => {
                self.span_flags |= SPAN_EM;
                self.writeStyled(style(.italic), "");
            },
            .strong => {
                self.span_flags |= SPAN_STRONG;
                self.writeStyled(style(.bold), "");
            },
            .u => {
                self.span_flags |= SPAN_U;
                self.writeStyled(style(.underline), "");
            },
            .del => {
                self.span_flags |= SPAN_DEL;
                self.writeStyled(style(.strikethrough), "");
            },
            .code => {
                self.span_flags |= SPAN_CODE;
                // Inline code: faint background + surround padding.
                self.writeStyled(codeSpanOpen(self.theme.light), "");
            },
            .a => {
                self.link_depth += 1;
                if (self.link_depth == 1) {
                    // Resolve final href (prefixes for autolinks)
                    const href = resolveHref(detail, self.allocator) catch "";
                    self.link_href = href;
                    if (self.theme.colors and self.theme.hyperlinks) {
                        // OSC 8 hyperlink start
                        self.writeRawNoColor("\x1b]8;;");
                        self.writeRawNoColor(href);
                        self.writeRawNoColor("\x1b\\");
                    }
                    self.writeStyled(color(.blue), "");
                    self.writeStyled(style(.underline), "");
                }
            },
            .img => {
                self.image_depth += 1;
                if (self.image_depth == 1) {
                    self.image_src = self.allocator.dupe(u8, detail.href) catch "";
                    self.image_title = self.allocator.dupe(u8, detail.title) catch "";
                    self.image_alt.clearRetainingCapacity();
                }
            },
            .wikilink => {
                self.writeStyled(color(.blue), "[[");
                self.col += 2;
            },
            .latexmath, .latexmath_display => {
                self.writeStyled(color(.magenta), "$");
                self.col += 1;
            },
        }
    }

    pub fn leaveSpan(self: *AnsiRenderer, span_type: SpanType) void {
        switch (span_type) {
            .em => {
                self.span_flags &= ~SPAN_EM;
                self.writeStyled("\x1b[23m", "");
            },
            .strong => {
                self.span_flags &= ~SPAN_STRONG;
                self.writeStyled("\x1b[22m", "");
            },
            .u => {
                self.span_flags &= ~SPAN_U;
                self.writeStyled("\x1b[24m", "");
            },
            .del => {
                self.span_flags &= ~SPAN_DEL;
                self.writeStyled("\x1b[29m", "");
            },
            .code => {
                self.span_flags &= ~SPAN_CODE;
                self.writeStyled(codeSpanClose(), "");
            },
            .a => {
                if (self.link_depth == 1) {
                    self.writeStyled("\x1b[24m", ""); // stop underline
                    self.writeStyled(reset(), "");
                    if (self.theme.colors and self.theme.hyperlinks) {
                        self.writeRawNoColor("\x1b]8;;\x1b\\");
                    } else if (self.link_href.len > 0) {
                        // Show URL in parens for non-hyperlink terminals
                        self.writeStyled(color(.dim), " (");
                        self.writeRaw(self.link_href);
                        self.writeStyled(color(.dim), ")");
                        self.writeStyled(reset(), "");
                        self.col += @intCast(self.link_href.len + 3);
                    }
                    self.allocator.free(self.link_href);
                    self.link_href = "";
                }
                if (self.link_depth > 0) self.link_depth -= 1;
            },
            .img => {
                if (self.image_depth == 1) {
                    self.emitImage();
                    self.allocator.free(self.image_src);
                    self.allocator.free(self.image_title);
                    self.image_src = "";
                    self.image_title = "";
                    self.image_alt.clearRetainingCapacity();
                }
                if (self.image_depth > 0) self.image_depth -= 1;
            },
            .wikilink => {
                self.writeRaw("]]");
                self.writeStyled(reset(), "");
                self.col += 2;
            },
            .latexmath, .latexmath_display => {
                self.writeRaw("$");
                self.writeStyled(reset(), "");
                self.col += 1;
            },
        }
    }

    // ========================================
    // Text rendering
    // ========================================

    pub fn text(self: *AnsiRenderer, text_type: TextType, content: []const u8) void {
        switch (text_type) {
            .null_char => self.writeContent("\xEF\xBF\xBD"),
            .br => self.writeContent("\n"),
            .softbr => self.writeContent(" "),
            .html => {
                // Render raw HTML dimmed.
                self.writeStyled(color(.dim), "");
                self.writeContent(content);
                self.writeStyled(reset(), "");
            },
            .entity => {
                var buf: [8]u8 = undefined;
                const decoded = helpers.decodeEntityToUtf8(content, &buf) orelse content;
                self.writeContent(decoded);
            },
            .code => self.writeContent(content),
            .latexmath => self.writeContent(content),
            else => self.writeContent(content),
        }
    }

    // ========================================
    // Writing helpers
    // ========================================

    /// Route a chunk of rendered text to the appropriate sink (code buffer,
    /// heading buffer, table cell, image alt, or directly to output).
    fn writeContent(self: *AnsiRenderer, data: []const u8) void {
        if (self.image_depth > 0) {
            self.image_alt.appendSlice(self.allocator, data) catch {
                self.out.oom = true;
            };
            return;
        }
        if (self.in_code_block) {
            self.code_buf.appendSlice(self.allocator, data) catch {
                self.out.oom = true;
            };
            return;
        }
        if (self.heading_level > 0) {
            self.heading_buf.appendSlice(self.allocator, data) catch {
                self.out.oom = true;
            };
            return;
        }
        if (self.in_cell) {
            self.table_cell_buf.appendSlice(self.allocator, data) catch {
                self.out.oom = true;
            };
            return;
        }
        // Normal paragraph flow: respect wrapping + indent.
        self.writeWrapped(data);
    }

    /// Emit a chunk to output, wrapping at word boundaries when the column
    /// exceeds `theme.columns`.
    fn writeWrapped(self: *AnsiRenderer, data: []const u8) void {
        if (self.theme.columns == 0) {
            self.writeRaw(data);
            self.updateColFromText(data);
            return;
        }
        const indent = self.currentIndent();
        const max = self.theme.columns;
        var i: usize = 0;
        while (i < data.len) {
            const c = data[i];
            if (c == '\n') {
                self.writeRaw("\n");
                self.last_was_newline = true;
                self.col = 0;
                i += 1;
                if (i < data.len) {
                    self.writeIndent();
                }
                continue;
            }
            if (c == ' ' and self.col >= max) {
                self.writeRaw("\n");
                self.last_was_newline = true;
                self.col = 0;
                self.writeIndent();
                i += 1;
                // collapse repeated spaces
                while (i < data.len and data[i] == ' ') i += 1;
                continue;
            }
            // find next break boundary
            var j = i;
            while (j < data.len and data[j] != ' ' and data[j] != '\n') : (j += 1) {}
            const word = data[i..j];
            const word_width = visibleWidth(word);
            if (self.col != 0 and self.col + word_width > max and self.col > indent) {
                self.writeRaw("\n");
                self.last_was_newline = true;
                self.col = 0;
                self.writeIndent();
            }
            self.writeRaw(word);
            self.col += @intCast(word_width);
            self.last_was_newline = (word.len == 0);
            i = j;
            if (i < data.len and data[i] == ' ') {
                self.writeRaw(" ");
                self.col += 1;
                i += 1;
                while (i < data.len and data[i] == ' ') i += 1;
            }
        }
    }

    /// Emit a styled sequence + text, respecting color settings.
    fn writeStyled(self: *AnsiRenderer, prefix: []const u8, text_: []const u8) void {
        if (self.theme.colors) {
            self.out.write(prefix);
        }
        if (text_.len > 0) {
            self.out.write(text_);
            self.col += @intCast(visibleWidth(text_));
            self.last_was_newline = false;
        }
    }

    /// Return the visible length of a styled sequence — the prefix adds
    /// zero visible chars but advances `col` by the text length.
    fn styledLen(self: *AnsiRenderer, s: []const u8) usize {
        _ = self;
        return visibleWidth(s);
    }

    /// Emit raw text (bypassing styling). Does not track the column.
    fn writeRaw(self: *AnsiRenderer, data: []const u8) void {
        self.out.write(data);
        if (data.len > 0) self.last_was_newline = (data[data.len - 1] == '\n');
    }

    /// Emit raw bytes even when colors are off (for OSC sequences).
    fn writeRawNoColor(self: *AnsiRenderer, data: []const u8) void {
        if (!self.theme.colors) return;
        self.out.write(data);
    }

    fn writeIndent(self: *AnsiRenderer) void {
        var quote_bars: u32 = 0;
        var other_indent: u32 = 0;
        for (self.block_stack.items) |entry| {
            switch (entry.kind) {
                .quote => quote_bars += 1,
                else => other_indent += entry.indent,
            }
        }
        if (self.theme.colors and quote_bars > 0) {
            self.out.write("\x1b[38;5;242m");
        }
        var i: u32 = 0;
        while (i < quote_bars) : (i += 1) {
            self.out.write("│ ");
            self.col += 2;
        }
        if (self.theme.colors and quote_bars > 0) {
            self.out.write("\x1b[0m");
        }
        var j: u32 = 0;
        while (j < other_indent) : (j += 1) {
            self.out.write(" ");
            self.col += 1;
        }
    }

    fn currentIndent(self: *AnsiRenderer) u32 {
        var total: u32 = 0;
        for (self.block_stack.items) |entry| {
            total += if (entry.kind == .quote) 2 else entry.indent;
        }
        return total;
    }

    fn updateColFromText(self: *AnsiRenderer, data: []const u8) void {
        var i: usize = 0;
        while (i < data.len) : (i += 1) {
            if (data[i] == '\n') {
                self.col = 0;
                self.last_was_newline = true;
            } else {
                self.col += 1;
                self.last_was_newline = false;
            }
        }
    }

    fn ensureNewline(self: *AnsiRenderer) void {
        if (!self.last_was_newline) {
            self.out.writeByte('\n');
            self.col = 0;
            self.last_was_newline = true;
        }
    }

    fn ensureBlankLine(self: *AnsiRenderer) void {
        self.ensureNewline();
        // Add an extra blank line only if we already produced output.
        if (self.out.list.items.len > 0) {
            // Check if last two chars are newlines
            const items = self.out.list.items;
            if (items.len >= 2 and items[items.len - 1] == '\n' and items[items.len - 2] != '\n') {
                self.out.writeByte('\n');
                self.col = 0;
            } else if (items.len == 1 and items[0] == '\n') {
                // single newline — don't add another
            } else if (items.len >= 1 and items[items.len - 1] != '\n') {
                self.out.writeByte('\n');
                self.col = 0;
            }
        }
    }

    /// Find the nearest enclosing ul/ol in the block stack (walking
    /// from innermost outward, skipping the current li at the top).
    fn findParentList(self: *AnsiRenderer) ?*BlockContext {
        const len = self.block_stack.items.len;
        if (len == 0) return null;
        var i: usize = len;
        while (i > 0) {
            i -= 1;
            const entry = &self.block_stack.items[i];
            if (entry.kind == .ul or entry.kind == .ol) return entry;
        }
        return null;
    }

    // ========================================
    // Heading flush
    // ========================================

    fn flushHeading(self: *AnsiRenderer) void {
        const level = self.heading_level;
        const content = self.heading_buf.items;
        self.writeIndent();
        const prefix = switch (level) {
            1 => "",
            2 => "",
            3 => "",
            4 => "",
            5 => "",
            else => "",
        };
        _ = prefix;
        const heading_color = switch (level) {
            1 => color(.magenta),
            2 => color(.cyan),
            3 => color(.yellow),
            4 => color(.green),
            5 => color(.blue),
            else => color(.white),
        };
        if (self.theme.colors) {
            self.out.write("\x1b[1m"); // bold
            self.out.write(heading_color);
        }
        self.out.write(content);
        if (self.theme.colors) self.out.write("\x1b[0m");
        self.out.writeByte('\n');
        self.last_was_newline = true;
        self.col = 0;
        // Add underline for h1/h2
        if (level == 1 or level == 2) {
            const width = @min(
                @max(visibleWidth(content), 3),
                @as(usize, @intCast(self.theme.columns)),
            );
            if (self.theme.colors) self.out.write(color(.dim));
            const char = if (level == 1) "═" else "─";
            var i: usize = 0;
            while (i < width) : (i += 1) self.out.write(char);
            if (self.theme.colors) self.out.write("\x1b[0m");
            self.out.writeByte('\n');
        }
    }

    // ========================================
    // Code block flush with syntax highlighting
    // ========================================

    fn flushCodeBlock(self: *AnsiRenderer) void {
        const src = self.code_buf.items;
        // Strip exactly one trailing newline (parser adds one).
        const body = if (src.len > 0 and src[src.len - 1] == '\n') src[0 .. src.len - 1] else src;

        // Language badge
        if (self.theme.colors) self.out.write(color(.dim));
        self.writeIndent();
        const badge = if (self.code_lang.len > 0) self.code_lang else "";
        if (badge.len > 0) {
            self.out.write("┌─ ");
            if (self.theme.colors) self.out.write("\x1b[0m");
            if (self.theme.colors) self.out.write("\x1b[2m\x1b[3m");
            self.out.write(badge);
            if (self.theme.colors) self.out.write("\x1b[0m");
        } else {
            if (self.theme.colors) self.out.write(color(.dim));
            self.out.write("┌─");
            if (self.theme.colors) self.out.write("\x1b[0m");
        }
        self.out.writeByte('\n');
        self.last_was_newline = true;

        // Highlight body for JS/TS/JSX/TSX; otherwise print as-is.
        const is_js = isJsLang(self.code_lang);
        var line_start: usize = 0;
        var i: usize = 0;
        while (i <= body.len) : (i += 1) {
            if (i == body.len or body[i] == '\n') {
                const line = body[line_start..i];
                self.writeIndent();
                if (self.theme.colors) self.out.write(color(.dim));
                self.out.write("│ ");
                if (self.theme.colors) self.out.write("\x1b[0m");
                if (is_js and self.theme.colors) {
                    self.writeHighlightedJs(line);
                } else {
                    self.out.write(line);
                }
                self.out.writeByte('\n');
                self.last_was_newline = true;
                line_start = i + 1;
            }
        }
        // Closing border
        self.writeIndent();
        if (self.theme.colors) self.out.write(color(.dim));
        self.out.write("└─");
        if (self.theme.colors) self.out.write("\x1b[0m");
        self.out.writeByte('\n');
        self.col = 0;
        self.last_was_newline = true;
    }

    fn writeHighlightedJs(self: *AnsiRenderer, line: []const u8) void {
        const highlighter = bun.fmt.QuickAndDirtyJavaScriptSyntaxHighlighter{
            .text = line,
            .opts = .{ .enable_colors = true, .check_for_unhighlighted_write = false },
        };
        var aw: std.Io.Writer.Allocating = .init(self.allocator);
        defer aw.deinit();
        highlighter.format(&aw.writer) catch {
            self.out.write(line);
            return;
        };
        self.out.write(aw.written());
    }

    // ========================================
    // Table flush
    // ========================================

    fn flushTable(self: *AnsiRenderer) void {
        if (self.table_rows.items.len == 0) return;

        // Compute max column widths across all rows.
        var col_count: usize = 0;
        for (self.table_rows.items) |row| col_count = @max(col_count, row.cells.len);
        if (col_count == 0) return;

        var widths = self.allocator.alloc(usize, col_count) catch {
            self.out.oom = true;
            return;
        };
        defer self.allocator.free(widths);
        @memset(widths, 3);
        // Track alignment per column (first seen wins, headers precede body).
        var aligns = self.allocator.alloc(types.Align, col_count) catch {
            self.out.oom = true;
            return;
        };
        defer self.allocator.free(aligns);
        @memset(aligns, .default);
        for (self.table_rows.items) |row| {
            for (row.cells, 0..) |cell, i| {
                widths[i] = @max(widths[i], visibleWidth(cell.content));
                if (aligns[i] == .default) aligns[i] = cell.alignment;
            }
        }

        // Top border
        self.writeIndent();
        if (self.theme.colors) self.out.write(color(.dim));
        self.out.write("┌");
        for (widths, 0..) |w, i| {
            var j: usize = 0;
            while (j < w + 2) : (j += 1) self.out.write("─");
            self.out.write(if (i == widths.len - 1) "┐" else "┬");
        }
        if (self.theme.colors) self.out.write("\x1b[0m");
        self.out.writeByte('\n');
        self.last_was_newline = true;

        // Rows
        var has_separated_header = false;
        for (self.table_rows.items) |row| {
            self.writeRowCells(row, widths, aligns);
            if (row.is_header and !has_separated_header) {
                self.writeTableSeparator(widths);
                has_separated_header = true;
            }
        }

        // Bottom border
        self.writeIndent();
        if (self.theme.colors) self.out.write(color(.dim));
        self.out.write("└");
        for (widths, 0..) |w, i| {
            var j: usize = 0;
            while (j < w + 2) : (j += 1) self.out.write("─");
            self.out.write(if (i == widths.len - 1) "┘" else "┴");
        }
        if (self.theme.colors) self.out.write("\x1b[0m");
        self.out.writeByte('\n');
        self.last_was_newline = true;

        // Free rows
        for (self.table_rows.items) |row| {
            for (row.cells) |cell| self.allocator.free(cell.content);
            self.allocator.free(row.cells);
        }
        self.table_rows.clearRetainingCapacity();
    }

    fn writeRowCells(
        self: *AnsiRenderer,
        row: TableRow,
        widths: []const usize,
        aligns: []const types.Align,
    ) void {
        self.writeIndent();
        if (self.theme.colors) self.out.write(color(.dim));
        self.out.write("│");
        if (self.theme.colors) self.out.write("\x1b[0m");
        for (widths, 0..) |w, i| {
            const cell: TableCell = if (i < row.cells.len) row.cells[i] else .{ .content = "", .alignment = .default };
            self.out.writeByte(' ');
            if (row.is_header and self.theme.colors) self.out.write("\x1b[1m");
            const cw = visibleWidth(cell.content);
            const alignment = if (cell.alignment != .default) cell.alignment else aligns[i];
            switch (alignment) {
                .right => {
                    self.writePadding(w - cw);
                    self.out.write(cell.content);
                },
                .center => {
                    const pad = w - cw;
                    self.writePadding(pad / 2);
                    self.out.write(cell.content);
                    self.writePadding(pad - pad / 2);
                },
                else => {
                    self.out.write(cell.content);
                    self.writePadding(w - cw);
                },
            }
            if (row.is_header and self.theme.colors) self.out.write("\x1b[0m");
            self.out.writeByte(' ');
            if (self.theme.colors) self.out.write(color(.dim));
            self.out.write("│");
            if (self.theme.colors) self.out.write("\x1b[0m");
        }
        self.out.writeByte('\n');
        self.last_was_newline = true;
    }

    fn writeTableSeparator(self: *AnsiRenderer, widths: []const usize) void {
        self.writeIndent();
        if (self.theme.colors) self.out.write(color(.dim));
        self.out.write("├");
        for (widths, 0..) |w, i| {
            var j: usize = 0;
            while (j < w + 2) : (j += 1) self.out.write("─");
            self.out.write(if (i == widths.len - 1) "┤" else "┼");
        }
        if (self.theme.colors) self.out.write("\x1b[0m");
        self.out.writeByte('\n');
        self.last_was_newline = true;
    }

    fn writePadding(self: *AnsiRenderer, n: usize) void {
        var i: usize = 0;
        while (i < n) : (i += 1) self.out.writeByte(' ');
    }

    // ========================================
    // Image emission (alt text, with optional Kitty graphics)
    // ========================================

    fn emitImage(self: *AnsiRenderer) void {
        const alt = self.image_alt.items;
        // Display as: [alt text] (src)  with OSC 8 hyperlink
        if (self.theme.colors and self.theme.hyperlinks and self.image_src.len > 0) {
            self.writeRawNoColor("\x1b]8;;");
            self.writeRawNoColor(self.image_src);
            self.writeRawNoColor("\x1b\\");
        }
        self.writeStyled(color(.magenta), "🖼 ");
        if (alt.len > 0) {
            self.writeRaw(alt);
            self.col += @intCast(visibleWidth(alt));
        } else if (self.image_title.len > 0) {
            self.writeRaw(self.image_title);
            self.col += @intCast(visibleWidth(self.image_title));
        } else {
            self.writeRaw("(image)");
            self.col += 7;
        }
        self.writeStyled(reset(), "");
        if (self.theme.colors and self.theme.hyperlinks and self.image_src.len > 0) {
            self.writeRawNoColor("\x1b]8;;\x1b\\");
        }
    }
};

// ========================================
// Module-level helpers
// ========================================

const AnsiColor = enum {
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    dim,
};

fn color(c: AnsiColor) []const u8 {
    return switch (c) {
        .black => "\x1b[30m",
        .red => "\x1b[31m",
        .green => "\x1b[32m",
        .yellow => "\x1b[33m",
        .blue => "\x1b[34m",
        .magenta => "\x1b[35m",
        .cyan => "\x1b[36m",
        .white => "\x1b[37m",
        .dim => "\x1b[2m",
    };
}

const AnsiStyle = enum {
    bold,
    italic,
    underline,
    strikethrough,
};

fn style(s: AnsiStyle) []const u8 {
    return switch (s) {
        .bold => "\x1b[1m",
        .italic => "\x1b[3m",
        .underline => "\x1b[4m",
        .strikethrough => "\x1b[9m",
    };
}

fn reset() []const u8 {
    return "\x1b[0m";
}

fn codeSpanOpen(light: bool) []const u8 {
    // Distinct inline-code look: soft background tint + yellow text.
    return if (light) "\x1b[48;5;254m\x1b[38;5;124m" else "\x1b[48;5;236m\x1b[38;5;215m";
}

fn codeSpanClose() []const u8 {
    return "\x1b[0m";
}

/// Visible printable width of a UTF-8 byte slice, excluding ANSI escape
/// sequences. Correctly handles multi-width graphemes (CJK, emoji).
fn visibleWidth(s: []const u8) usize {
    return bun.strings.visible.width.exclude_ansi_colors.utf8(s);
}

fn isJsLang(lang: []const u8) bool {
    const names = [_][]const u8{
        "js", "javascript", "jsx", "mjs", "cjs",
        "ts", "typescript", "tsx", "mts", "cts",
    };
    for (names) |n| {
        if (bun.strings.eqlCaseInsensitiveASCII(lang, n, true)) return true;
    }
    return false;
}

fn extractLanguage(src_text: []const u8, info_beg: u32) []const u8 {
    var lang_end: u32 = info_beg;
    while (lang_end < src_text.len) {
        const c = src_text[lang_end];
        if (c == ' ' or c == '\t' or c == '\n' or c == '\r') break;
        lang_end += 1;
    }
    if (lang_end > info_beg) return src_text[info_beg..lang_end];
    return "";
}

/// Build the final href string with autolink prefixes (mailto:, http://).
/// Caller owns the returned memory.
fn resolveHref(detail: SpanDetail, allocator: Allocator) ![]u8 {
    var buf: std.ArrayListUnmanaged(u8) = .{};
    errdefer buf.deinit(allocator);
    if (detail.autolink_email) try buf.appendSlice(allocator, "mailto:");
    if (detail.autolink_www) try buf.appendSlice(allocator, "http://");
    try buf.appendSlice(allocator, detail.href);
    return try buf.toOwnedSlice(allocator);
}

// ========================================
// Theme detection helpers (callable from the runner)
// ========================================

/// Detect whether the terminal background is light. Preference order:
/// 1. `COLORFGBG` env var (set by rxvt, xterm, Konsole, iTerm2 in some modes)
/// 2. Dark mode (default)
pub fn detectLightBackground() bool {
    if (std.posix.getenv("COLORFGBG")) |value| {
        // Format: "fg;bg" or "fg;default;bg" — bg index < 8 is dark, >=8 light
        var iter = std.mem.splitScalar(u8, value, ';');
        var last: []const u8 = "";
        while (iter.next()) |part| last = part;
        if (last.len > 0) {
            const bg = std.fmt.parseInt(u8, last, 10) catch return false;
            // Terminals using this convention treat 0-6 and 8 as dark, 7/15 as light.
            // A higher threshold is safer.
            return bg >= 7 and bg != 8;
        }
    }
    return false;
}

// ========================================
// Public entry point
// ========================================

/// Render markdown text to ANSI. Caller owns the returned bytes.
pub fn renderToAnsi(
    text: []const u8,
    allocator: Allocator,
    options: root.Options,
    theme: Theme,
) !?[]u8 {
    var renderer = AnsiRenderer.init(allocator, text, theme);
    defer renderer.deinit();
    root.renderWithRenderer(text, allocator, options, renderer.renderer()) catch |err| switch (err) {
        error.JSError, error.JSTerminated => return null,
        error.OutOfMemory => return error.OutOfMemory,
        error.StackOverflow => return error.StackOverflow,
    };
    if (renderer.out.oom) return error.OutOfMemory;
    return try renderer.out.list.toOwnedSlice(allocator);
}

const bun = @import("bun");
const helpers = @import("./helpers.zig");
const root = @import("./root.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const types = @import("./types.zig");
const BlockType = types.BlockType;
const Renderer = types.Renderer;
const SpanDetail = types.SpanDetail;
const SpanType = types.SpanType;
const TextType = types.TextType;
