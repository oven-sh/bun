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
    /// Default false to match the documented Bun.markdown.ansi() API.
    hyperlinks: bool = false,
    /// Inline images using the Kitty Graphics Protocol when the `src`
    /// refers to a local file (absolute or ./relative path, or file://).
    /// Falls through to the text alt for remote URLs.
    kitty_graphics: bool = false,
    /// Optional lookup table mapping http(s) image URLs to already-
    /// downloaded local file paths. Populated by a pre-scan pass (see
    /// `collectImageUrls` + the CLI entry point) so `emitImage` can
    /// send remote images through Kitty's `t=f` path. When null, http
    /// and https URLs fall through to the alt-text fallback.
    remote_image_paths: ?*const bun.StringHashMapUnmanaged([]const u8) = null,
    /// Base directory used to resolve relative image `src` paths. When
    /// null, falls back to the process cwd. The CLI entry point sets
    /// this to the markdown file's directory so `![](./img.png)` works
    /// regardless of where `bun ./some/dir/file.md` is invoked from.
    image_base_dir: ?[]const u8 = null,
};

/// Renderer that only collects image URLs — no output. Used by the CLI
/// pre-scan pass to decide which remote images to download.
pub const ImageUrlCollector = struct {
    urls: std.ArrayListUnmanaged([]const u8) = .{},
    allocator: Allocator,

    pub fn init(allocator: Allocator) ImageUrlCollector {
        return .{ .allocator = allocator };
    }

    pub fn deinit(self: *ImageUrlCollector) void {
        for (self.urls.items) |u| self.allocator.free(u);
        self.urls.deinit(self.allocator);
    }

    pub fn renderer(self: *ImageUrlCollector) Renderer {
        return .{ .ptr = self, .vtable = &vtable };
    }

    const vtable: Renderer.VTable = .{
        .enterBlock = noopEnterBlock,
        .leaveBlock = noopLeaveBlock,
        .enterSpan = enterSpanImpl,
        .leaveSpan = noopLeaveSpan,
        .text = noopText,
    };

    fn noopEnterBlock(_: *anyopaque, _: BlockType, _: u32, _: u32) bun.JSError!void {}
    fn noopLeaveBlock(_: *anyopaque, _: BlockType, _: u32) bun.JSError!void {}
    fn noopLeaveSpan(_: *anyopaque, _: SpanType) bun.JSError!void {}
    fn noopText(_: *anyopaque, _: TextType, _: []const u8) bun.JSError!void {}

    fn enterSpanImpl(ptr: *anyopaque, span_type: SpanType, detail: SpanDetail) bun.JSError!void {
        if (span_type != .img) return;
        const self: *ImageUrlCollector = @ptrCast(@alignCast(ptr));
        if (detail.href.len == 0) return;
        // detail.href is a slice into the parser's reusable buffer, which
        // is freed when renderWithRenderer returns (p.deinit). Dupe it so
        // callers can safely read collector.urls after rendering finishes.
        const owned = self.allocator.dupe(u8, detail.href) catch return error.OutOfMemory;
        errdefer self.allocator.free(owned);
        self.urls.append(self.allocator, owned) catch return error.OutOfMemory;
    }
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
    /// Non-null when we're inside a link span; the href to emit in OSC 8.
    /// Always allocator-owned when non-null (freed in leaveSpan).
    link_href: ?[]const u8 = null,
    /// Depth of enclosing link spans (brackets can nest in markdown parsers).
    link_depth: u32 = 0,
    /// Depth of enclosing image spans — text inside images becomes alt text
    /// rather than normal output.
    image_depth: u32 = 0,
    /// Buffered alt text for the innermost image.
    image_alt: std.ArrayListUnmanaged(u8) = .{},
    /// Saved image src URL for when the image span closes (owned).
    image_src: ?[]const u8 = null,
    /// Saved image title (rendered after alt, owned).
    image_title: ?[]const u8 = null,
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
    /// True after ensureBlankLine emitted its blank-line separator and
    /// no content has been written since. Used to dedup back-to-back
    /// ensureBlankLine() calls (e.g. enter-quote followed by enter-para).
    blank_emitted: bool = false,

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

    const SPAN_EM: u32 = 1 << 0;
    const SPAN_STRONG: u32 = 1 << 1;
    const SPAN_DEL: u32 = 1 << 2;
    const SPAN_U: u32 = 1 << 3;
    const SPAN_CODE: u32 = 1 << 4;

    const InlineStyle = struct {
        flag: u32,
        on: []const u8,
        off: []const u8,
        fn of(span_type: SpanType) ?InlineStyle {
            return switch (span_type) {
                .em => .{ .flag = SPAN_EM, .on = style(.italic), .off = "\x1b[23m" },
                .strong => .{ .flag = SPAN_STRONG, .on = style(.bold), .off = "\x1b[22m" },
                .u => .{ .flag = SPAN_U, .on = style(.underline), .off = "\x1b[24m" },
                .del => .{ .flag = SPAN_DEL, .on = style(.strikethrough), .off = "\x1b[29m" },
                else => null,
            };
        }
    };

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
        var r: AnsiRenderer = .{
            .out = .{ .list = .{}, .allocator = allocator, .oom = false },
            .allocator = allocator,
            .src_text = src_text,
            .theme = theme,
        };
        r.out.list.ensureTotalCapacity(allocator, src_text.len + src_text.len / 2) catch {};
        return r;
    }

    pub fn deinit(self: *AnsiRenderer) void {
        self.out.list.deinit(self.allocator);
        self.block_stack.deinit(self.allocator);
        self.image_alt.deinit(self.allocator);
        self.code_buf.deinit(self.allocator);
        self.heading_buf.deinit(self.allocator);
        // Normally freed by leaveSpan, but rendering can be interrupted
        // mid-span by an OOM — free defensively here.
        if (self.link_href) |s| self.allocator.free(s);
        if (self.image_src) |s| self.allocator.free(s);
        if (self.image_title) |s| self.allocator.free(s);
        for (self.table_rows.items) |row| {
            for (row.cells) |cell| self.allocator.free(cell.content);
            self.allocator.free(row.cells);
        }
        self.table_rows.deinit(self.allocator);
        // Same for orphaned cells left in table_cells when interrupted
        // mid-row.
        for (self.table_cells.items) |cell| self.allocator.free(cell.content);
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
                var num_buf: [12]u8 = undefined;
                const glyph: []const u8, const glyph_color: []const u8 = blk: {
                    if (task_mark != 0) {
                        const checked = types.isTaskChecked(task_mark);
                        const g = if (self.theme.colors)
                            (if (checked) "☒ " else "☐ ")
                        else
                            (if (checked) "[x] " else "[ ] ");
                        break :blk .{ g, if (checked) color(.green) else color(.dim) };
                    }
                    if (parent_list != null and parent_list.?.kind == .ol) {
                        const num = parent_list.?.data + entry.index;
                        break :blk .{ std.fmt.bufPrint(&num_buf, "{d}. ", .{num}) catch "? ", color(.cyan) };
                    }
                    break :blk .{ if (self.theme.colors) "• " else "* ", color(.cyan) };
                };
                self.writeStyled(glyph_color, glyph);
                self.writeStyled(reset(), "");
                // Wrapped continuation lines need to land under the item's
                // content (past the marker), so record the marker width.
                entry.indent = @intCast(visibleWidth(glyph));
                self.block_stack.append(self.allocator, entry) catch {
                    self.out.oom = true;
                };
            },
            .hr => {
                self.ensureBlankLine();
                self.writeIndent();
                // columns == 0 is the "disable wrapping" sentinel, not a
                // zero-width rule — fall back to 60 in that case.
                // Subtract the indent that writeIndent() just emitted so
                // a rule inside a blockquote / list item doesn't overflow.
                const indent_cols = self.currentIndent();
                const width: u32 = if (self.theme.columns == 0)
                    60 -| indent_cols
                else
                    @min(self.theme.columns, 60) -| indent_cols;
                var i: u32 = 0;
                const dash = if (self.theme.colors) "─" else "-";
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

    pub fn leaveBlock(self: *AnsiRenderer, block_type: BlockType, _: u32) void {
        switch (block_type) {
            .doc => {},
            .quote, .ul, .ol, .li => {
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
                    // Cell content slices in table_cells become orphaned
                    // if we can't move them into a row; free them here.
                    for (self.table_cells.items) |c| self.allocator.free(c.content);
                    self.table_cells.clearRetainingCapacity();
                    self.out.oom = true;
                    return;
                };
                self.table_rows.append(self.allocator, .{
                    .cells = cells,
                    .is_header = self.in_thead,
                }) catch {
                    for (cells) |c| self.allocator.free(c.content);
                    self.allocator.free(cells);
                    self.table_cells.clearRetainingCapacity();
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
                    self.allocator.free(owned);
                    self.out.oom = true;
                };
            },
        }
    }

    // ========================================
    // Span rendering
    // ========================================

    pub fn enterSpan(self: *AnsiRenderer, span_type: SpanType, detail: SpanDetail) void {
        switch (span_type) {
            .em, .strong, .u, .del => {
                const s = InlineStyle.of(span_type).?;
                self.span_flags |= s.flag;
                self.writeStyled(s.on, "");
            },
            .code => {
                self.span_flags |= SPAN_CODE;
                // Inline code: faint background + surround padding.
                self.writeStyled(codeSpanOpen(self.theme.light), "");
            },
            .a => {
                self.link_depth += 1;
                if (self.link_depth == 1) {
                    // Resolve final href (prefixes for autolinks). On OOM
                    // we leave link_href null so leaveSpan doesn't try to
                    // free a literal.
                    self.link_href = resolveHref(detail, self.allocator) catch null;
                    if (self.theme.colors and self.theme.hyperlinks) {
                        if (self.link_href) |href| {
                            // OSC 8 hyperlink start
                            self.writeRawNoColor("\x1b]8;;");
                            self.writeRawNoColor(href);
                            self.writeRawNoColor("\x1b\\");
                        }
                    }
                    self.writeStyled(color(.blue), "");
                    self.writeStyled(style(.underline), "");
                }
            },
            .img => {
                self.image_depth += 1;
                if (self.image_depth == 1) {
                    self.image_src = self.allocator.dupe(u8, detail.href) catch null;
                    self.image_title = self.allocator.dupe(u8, detail.title) catch null;
                    self.image_alt.clearRetainingCapacity();
                }
            },
            .wikilink => {
                self.writeStyled(color(.blue), "[[");
            },
            .latexmath => self.writeStyled(color(.magenta), "$"),
            .latexmath_display => self.writeStyled(color(.magenta), "$$"),
        }
    }

    pub fn leaveSpan(self: *AnsiRenderer, span_type: SpanType) void {
        switch (span_type) {
            .em, .strong, .u, .del => {
                const s = InlineStyle.of(span_type).?;
                self.span_flags &= ~s.flag;
                self.writeStyled(s.off, "");
                // An off-code can turn off a heading's own bold/italic —
                // reapply if we're inside a heading buffer.
                if (self.heading_level > 0) self.reapplyStyles();
            },
            .code => {
                self.span_flags &= ~SPAN_CODE;
                // Restore default fg+bg without touching bold/italic/etc.
                self.writeStyled("\x1b[39m\x1b[49m", "");
                self.reapplyStyles();
            },
            .a => {
                if (self.link_depth == 1) {
                    // Decrement BEFORE reapplyStyles so it doesn't re-emit
                    // blue+underline for text after the link.
                    self.link_depth = 0;
                    const had_href = self.link_href != null;
                    // Underline off, default fg; reapply outer styles so a
                    // link inside **bold** doesn't drop the bold.
                    self.writeStyled("\x1b[24m\x1b[39m", "");
                    self.reapplyStyles();
                    if (self.theme.colors and self.theme.hyperlinks) {
                        // Only emit the OSC 8 terminator if we emitted the
                        // opening sequence (which required link_href).
                        if (had_href) self.writeRawNoColor("\x1b]8;;\x1b\\");
                    } else if (self.link_href) |href| if (href.len > 0 and self.image_depth == 0) {
                        // Show URL in parens for non-hyperlink terminals.
                        // image_depth==0 keeps " (url)" out of image alt
                        // text when a link sits inside an image span.
                        self.writeStyled(color(.dim), " (");
                        self.writeStyled("", href);
                        self.writeStyled(color(.dim), ")");
                        self.writeStyled("\x1b[39m\x1b[22m", "");
                        self.reapplyStyles();
                    };
                    if (self.link_href) |href| self.allocator.free(href);
                    self.link_href = null;
                } else if (self.link_depth > 0) {
                    self.link_depth -= 1;
                }
            },
            .img => {
                if (self.image_depth == 1) {
                    self.emitImage();
                    if (self.image_src) |src| self.allocator.free(src);
                    if (self.image_title) |title| self.allocator.free(title);
                    self.image_src = null;
                    self.image_title = null;
                    self.image_alt.clearRetainingCapacity();
                }
                if (self.image_depth > 0) self.image_depth -= 1;
            },
            .wikilink, .latexmath, .latexmath_display => {
                self.writeNoWrap(switch (span_type) {
                    .wikilink => "]]",
                    .latexmath => "$",
                    .latexmath_display => "$$",
                    else => unreachable,
                });
                self.writeStyled("\x1b[39m", "");
                self.reapplyStyles();
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
                // Render raw HTML dimmed. Close with the targeted dim-off
                // (\x1b[22m) rather than a full reset, then reapply any
                // outer span/link styles.
                self.writeStyled(color(.dim), "");
                self.writeContent(content);
                self.writeStyled("\x1b[22m", "");
                self.reapplyStyles();
            },
            .entity => {
                var buf: [8]u8 = undefined;
                const decoded = helpers.decodeEntityToUtf8(content, &buf) orelse content;
                self.writeContent(decoded);
            },
            // Inline code spans are atomic — don't let writeWrapped split
            // them at internal spaces. writeStyled with empty prefix routes
            // the content through the active buffer + updates col in one
            // pass, without the paragraph word-wrap logic.
            .code => self.writeStyled("", content),
            // LaTeX math spans are atomic like .code — don't let
            // writeWrapped split `$E = mc^2$` at internal spaces.
            .latexmath => self.writeStyled("", content),
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
            // No-wrap path: still emit the indent after each embedded
            // newline so continuation lines inside blockquotes / list
            // items keep their `│ ` / hanging prefix.
            var start: usize = 0;
            var i: usize = 0;
            while (i < data.len) : (i += 1) {
                if (data[i] == '\n') {
                    self.writeRaw(data[start .. i + 1]);
                    self.col = 0;
                    self.last_was_newline = true;
                    self.writeIndent();
                    start = i + 1;
                }
            }
            if (start < data.len) {
                self.writeRaw(data[start..]);
                self.updateColFromText(data[start..]);
            }
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
                // Always re-emit the indent after a newline, even when
                // this is the final byte of `data` — a hard break
                // (`text(.br)`) arrives as a lone "\n" and the next
                // text() call starts at col=0 with no indent pushed.
                self.writeIndent();
                continue;
            }
            if (c == ' ' and self.col >= max) {
                self.writeRaw("\n");
                self.last_was_newline = true;
                self.col = 0;
                self.writeIndent();
                i += 1;
                while (i < data.len and data[i] == ' ') i += 1;
                continue;
            }
            var j = i;
            while (j < data.len and data[j] != ' ' and data[j] != '\n') : (j += 1) {}
            const word = data[i..j];
            const word_width = visibleWidth(word);
            const avail = max -| indent;
            if (avail > 0 and word_width > avail) {
                // Word can never fit on a fresh line — hard-break from
                // wherever the cursor is so we don't waste the tail of
                // the current line.
                var rest = word;
                while (rest.len > 0) {
                    const r = max -| self.col;
                    if (r == 0) {
                        self.wrapBreak();
                        continue;
                    }
                    var cut = visibleIndexAt(rest, r);
                    if (cut == 0) cut = @min(rest.len, @as(usize, bun.strings.wtf8ByteSequenceLengthWithInvalid(rest[0])));
                    self.writeRaw(rest[0..cut]);
                    self.col += @intCast(visibleWidth(rest[0..cut]));
                    self.last_was_newline = false;
                    rest = rest[cut..];
                    if (rest.len > 0) self.wrapBreak();
                }
            } else {
                if (self.col != 0 and self.col + word_width > max and self.col > indent) {
                    self.wrapBreak();
                }
                self.writeRaw(word);
                self.col += @intCast(word_width);
                self.last_was_newline = (word.len == 0);
            }
            i = j;
            if (i < data.len and data[i] == ' ') {
                // Look ahead to the next word: if the space + next word
                // would overflow, wrap here and drop the space instead of
                // leaving a trailing space at the end of the wrapped line.
                var k = i;
                while (k < data.len and data[k] == ' ') k += 1;
                var m = k;
                while (m < data.len and data[m] != ' ' and data[m] != '\n') : (m += 1) {}
                const next_word_width = visibleWidth(data[k..m]);
                const next_avail = max -| indent;
                // Only soft-wrap when the next word would fit on a fresh
                // line; if it's wider than that it will hard-break, so
                // emit the space and let the break start mid-line.
                if (self.col != 0 and self.col + 1 + next_word_width > max and self.col > indent and next_word_width <= next_avail) {
                    self.writeRaw("\n");
                    self.last_was_newline = true;
                    self.col = 0;
                    self.writeIndent();
                } else {
                    self.writeRaw(" ");
                    self.col += 1;
                }
                i = k;
            }
        }
    }

    /// Route bytes to the active inline sink. Spans inside a table cell,
    /// heading, or image must write to that buffer so structural code
    /// (flushTable/flushHeading/emitImage) emits them at the right spot.
    /// ANSI escape bytes are dropped inside image alt text since alt text
    /// is plain.
    fn emitInline(self: *AnsiRenderer, bytes: []const u8) void {
        if (bytes.len == 0) return;
        if (self.image_depth > 0) {
            // Image alt is plain text — strip escape sequences.
            var i: usize = 0;
            while (i < bytes.len) {
                if (bytes[i] == 0x1b) {
                    i += 1;
                    if (i < bytes.len and bytes[i] == '[') {
                        i += 1;
                        while (i < bytes.len and (bytes[i] < 0x40 or bytes[i] > 0x7e)) : (i += 1) {}
                        if (i < bytes.len) i += 1;
                    } else if (i < bytes.len and bytes[i] == ']') {
                        i += 1;
                        while (i < bytes.len) : (i += 1) {
                            if (bytes[i] == 0x07) {
                                i += 1;
                                break;
                            }
                            if (bytes[i] == 0x1b and i + 1 < bytes.len and bytes[i + 1] == '\\') {
                                i += 2;
                                break;
                            }
                        }
                    }
                    continue;
                }
                const start = i;
                while (i < bytes.len and bytes[i] != 0x1b) : (i += 1) {}
                self.image_alt.appendSlice(self.allocator, bytes[start..i]) catch {
                    self.out.oom = true;
                    return;
                };
            }
            return;
        }
        if (self.in_cell) {
            self.table_cell_buf.appendSlice(self.allocator, bytes) catch {
                self.out.oom = true;
            };
            return;
        }
        if (self.heading_level > 0) {
            self.heading_buf.appendSlice(self.allocator, bytes) catch {
                self.out.oom = true;
            };
            return;
        }
        self.out.write(bytes);
    }

    /// Emit a styled sequence + text, respecting color settings. Routes
    /// both the escape prefix and the text through the active buffer so
    /// spans inside cells/headings flush correctly.
    fn writeStyled(self: *AnsiRenderer, prefix: []const u8, text_: []const u8) void {
        const in_main_flow = !self.in_cell and self.heading_level == 0 and
            !self.in_code_block and self.image_depth == 0;

        // Pre-wrap before opening the style: an atomic span (`.code`,
        // `.latexmath`, link href fallback) is emitted in one piece via
        // emitInline, so if it would overflow we must break to a fresh
        // line first — otherwise the terminal hard-wraps mid-span.
        if (in_main_flow and self.theme.columns > 0 and text_.len > 0) {
            const tw = visibleWidth(text_);
            if (tw > 0) {
                const max = self.theme.columns;
                const indent = self.currentIndent();
                if (self.col > indent and self.col + tw > max) {
                    self.wrapBreak();
                }
            }
        }

        if (self.theme.colors and prefix.len > 0) {
            self.emitInline(prefix);
        }
        if (text_.len == 0) return;

        if (!in_main_flow) {
            self.emitInline(text_);
            return;
        }

        const max = self.theme.columns;
        if (max == 0) {
            self.emitInline(text_);
            self.col += @intCast(visibleWidth(text_));
            self.last_was_newline = false;
            return;
        }

        var rest = text_;
        while (rest.len > 0) {
            const room = max -| self.col;
            if (room == 0) {
                if (self.col <= self.currentIndent()) {
                    // Pathological: indent >= columns. Emit as-is to
                    // avoid an infinite loop.
                    self.emitInline(rest);
                    self.col += @intCast(visibleWidth(rest));
                    self.last_was_newline = false;
                    return;
                }
                self.wrapBreak();
                continue;
            }
            const cut = visibleIndexAt(rest, room);
            if (cut == rest.len) {
                self.emitInline(rest);
                self.col += @intCast(visibleWidth(rest));
                self.last_was_newline = false;
                return;
            }
            // cut == 0 happens when the first codepoint is wider than
            // `room` (e.g. one column left, next char is width-2 CJK).
            // Wrap to a fresh line; the next iteration has full room.
            if (cut == 0) {
                if (self.col <= self.currentIndent()) {
                    // Even a fresh line can't hold one codepoint —
                    // emit one codepoint to make progress.
                    const adv = visibleIndexAt(rest, 2);
                    const one = if (adv == 0) @min(rest.len, @as(usize, bun.strings.wtf8ByteSequenceLengthWithInvalid(rest[0]))) else adv;
                    self.emitInline(rest[0..one]);
                    self.col += @intCast(visibleWidth(rest[0..one]));
                    self.last_was_newline = false;
                    rest = rest[one..];
                    if (rest.len > 0) self.wrapBreak();
                    continue;
                }
                self.wrapBreak();
                continue;
            }
            self.emitInline(rest[0..cut]);
            self.col += @intCast(visibleWidth(rest[0..cut]));
            self.last_was_newline = false;
            rest = rest[cut..];
            self.wrapBreak();
        }
    }

    /// Soft-wrap inside a styled span: clear bg/fg so the line tail and
    /// indent stay clean, newline, re-emit indent, then reapply the
    /// active span styles so the continuation keeps its color.
    fn wrapBreak(self: *AnsiRenderer) void {
        const has_style = self.span_flags != 0 or self.link_depth > 0;
        if (self.theme.colors and has_style) self.out.write("\x1b[39m\x1b[49m");
        self.out.writeByte('\n');
        self.last_was_newline = true;
        self.col = 0;
        self.writeIndent();
        if (has_style) self.reapplyStyles();
    }

    /// Emit raw text (typically a single char or newline). Routes through
    /// the active inline buffer and keeps last_was_newline current. Does
    /// not track column width — callers that need it use writeStyled.
    fn writeRaw(self: *AnsiRenderer, data: []const u8) void {
        if (data.len == 0) return;
        self.emitInline(data);
        self.last_was_newline = (data[data.len - 1] == '\n');
    }

    /// Emit a short text chunk through the active buffer and update col
    /// WITHOUT the pre-wrap guard that writeStyled uses. This is the
    /// right path for closing delimiters (`]]`, `$`, `$$`) that must
    /// stay attached to whatever they close — otherwise a wrap can push
    /// the closer onto a new line and orphan it.
    fn writeNoWrap(self: *AnsiRenderer, text_: []const u8) void {
        if (text_.len == 0) return;
        self.emitInline(text_);
        if (!self.in_cell and self.heading_level == 0 and !self.in_code_block and self.image_depth == 0) {
            self.col += @intCast(visibleWidth(text_));
            self.last_was_newline = false;
        }
    }

    /// Emit raw bytes that must not appear in `image_alt`. Goes through
    /// the active buffer for cells/headings, but never into image alt.
    fn writeRawNoColor(self: *AnsiRenderer, data: []const u8) void {
        if (!self.theme.colors) return;
        if (data.len == 0) return;
        if (self.image_depth > 0) return;
        if (self.in_cell) {
            self.table_cell_buf.appendSlice(self.allocator, data) catch {
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
        self.out.write(data);
    }

    /// Re-emit the currently active inline styles from span_flags, the
    /// link-styling state, and — when buffering a heading — the heading's
    /// bold + color wrapper. Used after a nested span closes so the outer
    /// style doesn't get wiped, and after writeIndent emits its own reset.
    fn reapplyStyles(self: *AnsiRenderer) void {
        if (!self.theme.colors) return;
        // If we're inside a heading's buffered content, the outer bold +
        // color wrapper must also be reapplied.
        if (self.heading_level > 0) {
            self.emitInline(style(.bold));
            self.emitInline(headingColor(self.heading_level));
        }
        if (self.span_flags & SPAN_STRONG != 0) self.emitInline(style(.bold));
        if (self.span_flags & SPAN_EM != 0) self.emitInline(style(.italic));
        if (self.span_flags & SPAN_U != 0) self.emitInline(style(.underline));
        if (self.span_flags & SPAN_DEL != 0) self.emitInline(style(.strikethrough));
        if (self.span_flags & SPAN_CODE != 0) self.emitInline(codeSpanOpen(self.theme.light));
        if (self.link_depth > 0) {
            self.emitInline(color(.blue));
            self.emitInline(style(.underline));
        }
    }

    fn writeIndent(self: *AnsiRenderer) void {
        // writeIndent is called at the start of every content line, so
        // this is the right place to clear the "blank line just emitted"
        // flag ensureBlankLine uses for dedup.
        self.blank_emitted = false;
        var quote_bars: u32 = 0;
        var other_indent: u32 = 0;
        for (self.block_stack.items) |entry| {
            switch (entry.kind) {
                .quote => quote_bars += 1,
                else => other_indent += entry.indent,
            }
        }
        const bar = if (self.theme.colors) "│ " else "| ";
        if (self.theme.colors and quote_bars > 0) {
            self.out.write("\x1b[38;5;242m");
        }
        var i: u32 = 0;
        while (i < quote_bars) : (i += 1) {
            self.out.write(bar);
            self.col += 2;
        }
        if (self.theme.colors and quote_bars > 0) {
            // Clear only the indent's fg color; keep any active inline
            // styles intact by re-applying them after the targeted off.
            self.out.write("\x1b[39m");
            self.reapplyStyles();
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
        // Advance col by visible width per-segment (between newlines) so
        // multi-byte UTF-8 content stays consistent with every other
        // col-update site (they all use visibleWidth()).
        var start: usize = 0;
        var i: usize = 0;
        while (i < data.len) : (i += 1) {
            if (data[i] == '\n') {
                self.col = 0;
                self.last_was_newline = true;
                start = i + 1;
            }
        }
        if (start < data.len) {
            self.col += @intCast(visibleWidth(data[start..]));
            self.last_was_newline = false;
        }
    }

    /// Emit just the blockquote `│` bars (no list indent) for the
    /// current block_stack. Used by ensureBlankLine so the inter-block
    /// gap inside a blockquote keeps its visual border.
    fn writeQuoteBars(self: *AnsiRenderer) void {
        var quote_bars: u32 = 0;
        for (self.block_stack.items) |entry| {
            if (entry.kind == .quote) quote_bars += 1;
        }
        if (quote_bars == 0) return;
        const bar = if (self.theme.colors) "│" else "|";
        if (self.theme.colors) self.out.write("\x1b[38;5;242m");
        var i: u32 = 0;
        while (i < quote_bars) : (i += 1) {
            self.out.write(bar);
            self.col += 1;
        }
        if (self.theme.colors) self.out.write("\x1b[39m");
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
        // Already on a fresh blank line? Don't stack another.
        if (self.blank_emitted) return;
        // Add an extra blank line only if we already produced output.
        if (self.out.list.items.len > 0) {
            // Check if last two chars are newlines
            const items = self.out.list.items;
            if (items.len >= 2 and items[items.len - 1] == '\n' and items[items.len - 2] != '\n') {
                self.writeQuoteBars();
                self.out.writeByte('\n');
                self.col = 0;
                self.blank_emitted = true;
            } else if (items.len == 1 and items[0] == '\n') {
                // single newline — don't add another
            } else if (items.len >= 1 and items[items.len - 1] != '\n') {
                self.writeQuoteBars();
                self.out.writeByte('\n');
                self.col = 0;
                self.blank_emitted = true;
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
        // Temporarily zero heading_level so writeIndent()'s reapplyStyles()
        // routes emitInline() to self.out instead of heading_buf. Otherwise
        // inside a blockquote the bold+color writes reach heading_buf and
        // may realloc its backing array, dangling the `content` slice below.
        self.heading_level = 0;
        defer self.heading_level = level;
        const content = self.heading_buf.items;
        self.writeIndent();
        if (self.theme.colors) {
            self.out.write("\x1b[1m"); // bold
            self.out.write(headingColor(level));
        }
        self.out.write(content);
        if (self.theme.colors) self.out.write("\x1b[0m");
        self.out.writeByte('\n');
        self.last_was_newline = true;
        self.col = 0;
        // Add underline for h1/h2. Indent matches the heading text so
        // headings inside blockquotes / list items stay aligned.
        if (level == 1 or level == 2) {
            self.writeIndent();
            const text_w = @max(visibleWidth(content), 3);
            // Subtract the indent that writeIndent() just emitted so
            // an underlined heading inside a blockquote / list item
            // doesn't overflow the terminal width.
            const indent_cols = self.currentIndent();
            const width = if (self.theme.columns == 0)
                text_w
            else
                @min(text_w, (@as(usize, @intCast(self.theme.columns))) -| @as(usize, indent_cols));
            if (self.theme.colors) self.out.write(color(.dim));
            const char = if (self.theme.colors) (if (level == 1) "═" else "─") else (if (level == 1) "=" else "-");
            var i: usize = 0;
            while (i < width) : (i += 1) self.out.write(char);
            if (self.theme.colors) self.out.write("\x1b[0m");
            self.out.writeByte('\n');
            self.last_was_newline = true;
            self.col = 0;
        }
    }

    /// ANSI color for a given heading level.
    fn headingColor(level: u8) []const u8 {
        return switch (level) {
            1 => color(.magenta),
            2 => color(.cyan),
            3 => color(.yellow),
            4 => color(.green),
            5 => color(.blue),
            else => color(.white),
        };
    }

    // ========================================
    // Code block flush with syntax highlighting
    // ========================================

    fn flushCodeBlock(self: *AnsiRenderer) void {
        const src = self.code_buf.items;
        // Strip exactly one trailing newline (parser adds one).
        const body = if (src.len > 0 and src[src.len - 1] == '\n') src[0 .. src.len - 1] else src;

        const top_border = if (self.theme.colors) "┌─ " else "+- ";
        const top_bare = if (self.theme.colors) "┌─" else "+-";
        const side = if (self.theme.colors) "│ " else "| ";
        const bottom = if (self.theme.colors) "└─" else "+-";

        // Language badge
        if (self.theme.colors) self.out.write(color(.dim));
        self.writeIndent();
        const badge = if (self.code_lang.len > 0) self.code_lang else "";
        if (badge.len > 0) {
            self.out.write(top_border);
            if (self.theme.colors) self.out.write("\x1b[0m");
            if (self.theme.colors) self.out.write("\x1b[2m\x1b[3m");
            self.out.write(badge);
            if (self.theme.colors) self.out.write("\x1b[0m");
        } else {
            if (self.theme.colors) self.out.write(color(.dim));
            self.out.write(top_bare);
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
                self.out.write(side);
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
        self.out.write(bottom);
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

        // Clamp column widths so the rendered table fits the terminal.
        // Each column contributes ` content │` = width+3; plus one
        // leading `│` and the current indent.
        if (self.theme.columns > 0) {
            const indent = self.currentIndent();
            var total: usize = indent + 1;
            for (widths) |w| total += w + 3;
            const budget = self.theme.columns;
            while (total > budget) {
                var widest: usize = 0;
                for (widths, 0..) |w, i| {
                    if (w > widths[widest]) widest = i;
                }
                if (widths[widest] <= 3) break;
                widths[widest] -= 1;
                total -= 1;
            }
        }

        const chars = self.boxChars();

        self.writeIndent();
        if (self.theme.colors) self.out.write(color(.dim));
        self.out.write(chars.tl);
        for (widths, 0..) |w, i| {
            var j: usize = 0;
            while (j < w + 2) : (j += 1) self.out.write(chars.h);
            self.out.write(if (i == widths.len - 1) chars.tr else chars.t);
        }
        if (self.theme.colors) self.out.write("\x1b[0m");
        self.out.writeByte('\n');
        self.last_was_newline = true;

        var has_separated_header = false;
        for (self.table_rows.items) |row| {
            self.writeRowCells(row, widths, aligns);
            if (row.is_header and !has_separated_header) {
                self.writeTableSeparator(widths);
                has_separated_header = true;
            }
        }

        self.writeIndent();
        if (self.theme.colors) self.out.write(color(.dim));
        self.out.write(chars.bl);
        for (widths, 0..) |w, i| {
            var j: usize = 0;
            while (j < w + 2) : (j += 1) self.out.write(chars.h);
            self.out.write(if (i == widths.len - 1) chars.br else chars.b);
        }
        if (self.theme.colors) self.out.write("\x1b[0m");
        self.out.writeByte('\n');
        self.last_was_newline = true;
        self.col = 0;

        for (self.table_rows.items) |row| {
            for (row.cells) |cell| self.allocator.free(cell.content);
            self.allocator.free(row.cells);
        }
        self.table_rows.clearRetainingCapacity();
    }

    /// ANSI state active at a given byte offset inside a cell's buffer.
    /// Tracked so a cell that wraps mid-span can re-emit the same opens
    /// on the continuation segment AND close any open OSC 8 link before
    /// the border character — `\x1b[0m` doesn't terminate OSC 8.
    const CellAnsiState = struct {
        flags: u8 = 0,
        fg: ?[]const u8 = null,
        bg: ?[]const u8 = null,
        link: ?[]const u8 = null,

        const BOLD: u8 = 1 << 0;
        const ITALIC: u8 = 1 << 1;
        const UNDERLINE: u8 = 1 << 2;
        const STRIKE: u8 = 1 << 3;
        const DIM: u8 = 1 << 4;

        fn hasAny(self: CellAnsiState) bool {
            return self.flags != 0 or self.fg != null or self.bg != null or self.link != null;
        }

        fn emitOpens(self: CellAnsiState, out: *OutputBuffer) void {
            if (self.flags & BOLD != 0) out.write("\x1b[1m");
            if (self.flags & DIM != 0) out.write("\x1b[2m");
            if (self.flags & ITALIC != 0) out.write("\x1b[3m");
            if (self.flags & UNDERLINE != 0) out.write("\x1b[4m");
            if (self.flags & STRIKE != 0) out.write("\x1b[9m");
            if (self.fg) |f| out.write(f);
            if (self.bg) |b| out.write(b);
            if (self.link) |l| out.write(l);
        }

        fn emitCloses(self: CellAnsiState, out: *OutputBuffer) void {
            if (self.hasAny()) out.write("\x1b[0m");
            if (self.link != null) out.write("\x1b]8;;\x1b\\");
        }

        /// Walk `bytes` forward, updating `self` to reflect any SGR and
        /// OSC 8 toggles encountered. Unrecognized escapes are skipped.
        fn scan(self: *CellAnsiState, bytes: []const u8) void {
            var i: usize = 0;
            while (i < bytes.len) {
                if (bytes[i] != 0x1b) {
                    i += 1;
                    continue;
                }
                if (i + 1 >= bytes.len) return;
                if (bytes[i + 1] == '[') {
                    // CSI ... m (SGR). Scan until final byte.
                    // ECMA-48 final bytes are 0x40–0x7E; the parameter
                    // separator ';' is 0x3B and is already excluded by
                    // the range check.
                    const seq_start = i;
                    var j = i + 2;
                    while (j < bytes.len) : (j += 1) {
                        const c = bytes[j];
                        if (c >= 0x40 and c <= 0x7e) break;
                    }
                    if (j >= bytes.len) return;
                    if (bytes[j] == 'm') {
                        const seq = bytes[seq_start .. j + 1];
                        const params = bytes[seq_start + 2 .. j];
                        self.applySgr(seq, params);
                    }
                    i = j + 1;
                    continue;
                }
                if (bytes[i + 1] == ']') {
                    // OSC. Scan until ST (\x1b\\) or BEL (\x07).
                    const seq_start = i;
                    var j = i + 2;
                    while (j < bytes.len) : (j += 1) {
                        if (bytes[j] == 0x07) {
                            j += 1;
                            break;
                        }
                        if (bytes[j] == 0x1b and j + 1 < bytes.len and bytes[j + 1] == '\\') {
                            j += 2;
                            break;
                        }
                    }
                    const seq = bytes[seq_start..j];
                    if (seq.len >= 5 and bun.strings.hasPrefixComptime(seq, "\x1b]8;")) {
                        // "\x1b]8;<params>;<URL>\x1b\\" — a close has an
                        // empty URL component.
                        const body = seq[4..]; // after "\x1b]8;"
                        // Strip terminator off the end for URL extraction.
                        const body_end: usize = blk: {
                            if (body.len >= 2 and body[body.len - 2] == 0x1b and body[body.len - 1] == '\\') {
                                break :blk body.len - 2;
                            }
                            if (body.len >= 1 and body[body.len - 1] == 0x07) break :blk body.len - 1;
                            break :blk body.len;
                        };
                        const body_stripped = body[0..body_end];
                        if (bun.strings.indexOfChar(body_stripped, ';')) |semi| {
                            const url = body_stripped[semi + 1 ..];
                            if (url.len == 0) {
                                self.link = null;
                            } else {
                                self.link = seq;
                            }
                        }
                    }
                    i = j;
                    continue;
                }
                i += 1;
            }
        }

        fn applySgr(self: *CellAnsiState, seq: []const u8, params: []const u8) void {
            // Empty param ("\x1b[m") is equivalent to "\x1b[0m".
            if (params.len == 0) {
                self.flags = 0;
                self.fg = null;
                self.bg = null;
                return;
            }
            // Stateful parse: 38/48 consume 2 extra params for `5;N` or
            // 4 extra for `2;R;G;B`. Snapshot the whole seq for fg/bg
            // since we don't need to recompute it — just replay it.
            var iter = std.mem.splitScalar(u8, params, ';');
            while (iter.next()) |p| {
                const n = std.fmt.parseInt(u32, p, 10) catch continue;
                switch (n) {
                    0 => {
                        self.flags = 0;
                        self.fg = null;
                        self.bg = null;
                    },
                    1 => self.flags |= BOLD,
                    2 => self.flags |= DIM,
                    3 => self.flags |= ITALIC,
                    4 => self.flags |= UNDERLINE,
                    9 => self.flags |= STRIKE,
                    // ECMA-48 §8.3.117: SGR 22 = "normal intensity" —
                    // clears BOTH bold (SGR 1) and faint/dim (SGR 2).
                    22 => self.flags &= ~(BOLD | DIM),
                    23 => self.flags &= ~ITALIC,
                    24 => self.flags &= ~UNDERLINE,
                    29 => self.flags &= ~STRIKE,
                    30...37, 90...97 => self.fg = seq,
                    38 => {
                        self.fg = seq;
                        // Consume remaining params since they're part of
                        // the 38 encoding — don't misinterpret them as
                        // standalone SGRs.
                        while (iter.next()) |_| {}
                        return;
                    },
                    39 => self.fg = null,
                    40...47, 100...107 => self.bg = seq,
                    48 => {
                        self.bg = seq;
                        while (iter.next()) |_| {}
                        return;
                    },
                    49 => self.bg = null,
                    else => {},
                }
            }
        }
    };

    /// Find the last space byte in `bytes` that lies OUTSIDE any ANSI
    /// escape sequence (CSI or OSC). The table wrapper uses this to pick
    /// a word-break point without splitting an OSC 8 opener mid-URL —
    /// `[text](<url with space>)` is valid CommonMark and produces an
    /// OSC 8 href that literally contains a space byte, so a naive
    /// byte scan would break the sequence in half and leave the
    /// terminal stuck in persistent hyperlink mode.
    fn lastWordBreakOutsideEscapes(bytes: []const u8) ?usize {
        var last: ?usize = null;
        var i: usize = 0;
        while (i < bytes.len) {
            const c = bytes[i];
            if (c == 0x1b and i + 1 < bytes.len) {
                const next = bytes[i + 1];
                if (next == '[') {
                    // CSI — skip to a final byte in 0x40–0x7E.
                    i += 2;
                    while (i < bytes.len) : (i += 1) {
                        if (bytes[i] >= 0x40 and bytes[i] <= 0x7e) {
                            i += 1;
                            break;
                        }
                    }
                    continue;
                }
                if (next == ']') {
                    // OSC — skip to ST (ESC \) or BEL.
                    i += 2;
                    while (i < bytes.len) : (i += 1) {
                        if (bytes[i] == 0x07) {
                            i += 1;
                            break;
                        }
                        if (bytes[i] == 0x1b and i + 1 < bytes.len and bytes[i + 1] == '\\') {
                            i += 2;
                            break;
                        }
                    }
                    continue;
                }
                // Other ESC-<byte> two-byte sequences: skip the pair.
                i += 2;
                continue;
            }
            if (c == ' ') last = i;
            i += 1;
        }
        return last;
    }

    fn writeRowCells(
        self: *AnsiRenderer,
        row: TableRow,
        widths: []const usize,
        aligns: []const types.Align,
    ) void {
        const chars = self.boxChars();

        // Split each cell into visible-width-bounded segments so a wide
        // cell wraps WITHIN its column instead of letting the terminal
        // hard-wrap the whole row and shred the borders.
        var segments = self.allocator.alloc(std.ArrayListUnmanaged([]const u8), widths.len) catch {
            self.out.oom = true;
            return;
        };
        defer {
            for (segments) |*s| s.deinit(self.allocator);
            self.allocator.free(segments);
        }
        @memset(segments, .{});

        // Per-cell ANSI state snapshotted at the START of each segment.
        // `state_at[col][line]` is the SGR/OSC 8 state that was active
        // when rendering reached the beginning of that segment. Needed
        // so a cell that wraps mid-span can re-open the style on the
        // continuation line.
        var state_at = self.allocator.alloc(std.ArrayListUnmanaged(CellAnsiState), widths.len) catch {
            self.out.oom = true;
            return;
        };
        defer {
            for (state_at) |*s| s.deinit(self.allocator);
            self.allocator.free(state_at);
        }
        @memset(state_at, .{});

        var lines: usize = 1;
        for (widths, 0..) |w, i| {
            const content = if (i < row.cells.len) row.cells[i].content else "";
            var rest = content;
            var state = CellAnsiState{};
            while (rest.len > 0) {
                var cut = visibleIndexAt(rest, w);
                if (cut < rest.len) {
                    // Prefer breaking at the last word boundary inside the
                    // cut so words stay intact when there's room. Must use
                    // an escape-aware scanner — a raw lastIndexOfChar(' ')
                    // would find spaces inside an OSC 8 URL (valid via the
                    // `[text](<url with space>)` angle-bracket syntax) and
                    // truncate mid-sequence, leaving a never-terminated
                    // hyperlink opener that corrupts the rest of the row.
                    if (lastWordBreakOutsideEscapes(rest[0..cut])) |sp| {
                        if (sp > 0) cut = sp;
                    }
                }
                if (cut == 0) cut = @min(rest.len, @as(usize, bun.strings.wtf8ByteSequenceLengthWithInvalid(rest[0])));
                state_at[i].append(self.allocator, state) catch {
                    self.out.oom = true;
                    return;
                };
                segments[i].append(self.allocator, rest[0..cut]) catch {
                    self.out.oom = true;
                    return;
                };
                state.scan(rest[0..cut]);
                rest = rest[cut..];
                // Skip spaces that led to the wrap so they don't start
                // the continuation line; scan them too in case a padded
                // ANSI sequence hides inside.
                var skipped_start: usize = 0;
                while (skipped_start < rest.len and rest[skipped_start] == ' ') skipped_start += 1;
                if (skipped_start > 0) {
                    state.scan(rest[0..skipped_start]);
                    rest = rest[skipped_start..];
                }
            }
            lines = @max(lines, segments[i].items.len);
        }

        var line: usize = 0;
        while (line < lines) : (line += 1) {
            self.writeIndent();
            if (self.theme.colors) self.out.write(color(.dim));
            self.out.write(chars.v);
            if (self.theme.colors) self.out.write("\x1b[0m");
            for (widths, 0..) |w, i| {
                const seg: []const u8 = if (line < segments[i].items.len) segments[i].items[line] else "";
                const opens: CellAnsiState = if (line < state_at[i].items.len) state_at[i].items[line] else .{};
                self.out.writeByte(' ');
                if (row.is_header and self.theme.colors) self.out.write("\x1b[1m");
                // Re-emit any SGR + OSC 8 that was active at the start
                // of this segment (no-op on the first line because the
                // opens are already embedded in `seg`).
                if (self.theme.colors and line > 0) opens.emitOpens(&self.out);
                const cw = visibleWidth(seg);
                const cell_align = if (i < row.cells.len) row.cells[i].alignment else .default;
                const alignment = if (cell_align != .default) cell_align else aligns[i];
                const pad = w -| cw;
                const left: usize, const right: usize = switch (alignment) {
                    .right => .{ pad, 0 },
                    .center => .{ pad / 2, pad - pad / 2 },
                    else => .{ 0, pad },
                };
                self.writePadding(left);
                self.out.write(seg);
                // Close everything still open at the end of this segment
                // — `\x1b[0m` for SGR and `\x1b]8;;\x1b\\` for OSC 8 so
                // the padding, trailing space, and border are not part
                // of an active hyperlink.
                if (self.theme.colors) {
                    var end_state = opens;
                    end_state.scan(seg);
                    end_state.emitCloses(&self.out);
                    if (row.is_header) self.out.write("\x1b[0m");
                }
                self.writePadding(right);
                self.out.writeByte(' ');
                if (self.theme.colors) self.out.write(color(.dim));
                self.out.write(chars.v);
                if (self.theme.colors) self.out.write("\x1b[0m");
            }
            self.out.writeByte('\n');
        }
        self.last_was_newline = true;
    }

    fn writeTableSeparator(self: *AnsiRenderer, widths: []const usize) void {
        const chars = self.boxChars();
        self.writeIndent();
        if (self.theme.colors) self.out.write(color(.dim));
        self.out.write(chars.ml);
        for (widths, 0..) |w, i| {
            var j: usize = 0;
            while (j < w + 2) : (j += 1) self.out.write(chars.h);
            self.out.write(if (i == widths.len - 1) chars.mr else chars.x);
        }
        if (self.theme.colors) self.out.write("\x1b[0m");
        self.out.writeByte('\n');
        self.last_was_newline = true;
    }

    const BoxChars = struct {
        h: []const u8,
        v: []const u8,
        tl: []const u8,
        tr: []const u8,
        bl: []const u8,
        br: []const u8,
        t: []const u8,
        b: []const u8,
        ml: []const u8,
        mr: []const u8,
        x: []const u8,
    };

    fn boxChars(self: *AnsiRenderer) BoxChars {
        return if (self.theme.colors) .{
            .h = "─",
            .v = "│",
            .tl = "┌",
            .tr = "┐",
            .bl = "└",
            .br = "┘",
            .t = "┬",
            .b = "┴",
            .ml = "├",
            .mr = "┤",
            .x = "┼",
        } else .{
            .h = "-",
            .v = "|",
            .tl = "+",
            .tr = "+",
            .bl = "+",
            .br = "+",
            .t = "+",
            .b = "+",
            .ml = "+",
            .mr = "+",
            .x = "+",
        };
    }

    fn writePadding(self: *AnsiRenderer, n: usize) void {
        var i: usize = 0;
        while (i < n) : (i += 1) self.out.writeByte(' ');
    }

    // ========================================
    // Image emission (alt text, with optional Kitty graphics)
    // ========================================

    fn emitImage(self: *AnsiRenderer) void {
        // Snapshot alt + link fields now — emitImage drops out of the
        // image context before writing, so image_alt / image_depth checks
        // in emitInline would otherwise still divert output.
        const alt = self.image_alt.items;
        const src = self.image_src;
        // Drop image context so writeStyled/writeRaw flow through the
        // normal inline path (paragraph, cell, etc.).
        const saved_depth = self.image_depth;
        self.image_depth = 0;
        defer self.image_depth = saved_depth;

        const has_src = src != null and src.?.len > 0;

        // Kitty Graphics Protocol path: for local files, emit an APC
        // sequence that tells the terminal to read the file directly
        // and display it inline. Only attempts this when:
        //   1. colors + kitty_graphics are enabled (needs ESC support)
        //   2. src is a file: URI or a non-URL path
        //   3. the file exists on disk
        // If the image is actually displayed, we're done — the image
        // itself is the content, no caption/alt text needed.
        // Skip Kitty inside table cells / headings: the APC payload
        // would be counted as visible width by flushTable/flushHeading,
        // blowing up the column / underline size. Images in cells
        // always fall back to alt-text rendering.
        const kitty_allowed = !self.in_cell and self.heading_level == 0;
        if (kitty_allowed and self.theme.colors and self.theme.kitty_graphics and has_src) {
            // data:image/png;base64,... → transmit payload directly via
            // t=d so no temp file needs to live on disk. Other data:
            // formats (jpeg/gif/webp) don't map to a Kitty format code
            // for direct transmission, so fall through to alt text.
            if (extractPngDataUrlBase64(src.?)) |payload| {
                self.emitKittyImageDirect(payload);
                return;
            }
            // http(s) URL that the CLI pre-scan pass already downloaded
            // to a temp file → send via Kitty's t=f against that path.
            if (self.theme.remote_image_paths) |map| {
                if ((bun.strings.startsWith(src.?, "http://") or
                    bun.strings.startsWith(src.?, "https://")))
                {
                    if (map.get(src.?)) |local_path| {
                        self.emitKittyImageFile(local_path);
                        return;
                    }
                }
            }
            if (resolveLocalImagePath(src.?, self.allocator, self.theme.image_base_dir)) |abs_path| {
                defer self.allocator.free(abs_path);
                self.emitKittyImageFile(abs_path);
                return;
            }
        }

        // Fallback: image can't be rendered inline. Show the alt text
        // (or title, or "(image)") wrapped in the OSC 8 hyperlink so
        // the src URL stays clickable. A magenta camera marker makes it
        // obvious this is a missing/unrendered image. (U+1F4F7 instead
        // of U+1F5BC "FRAME WITH PICTURE" because 1F5BC is classified
        // Narrow in EastAsianWidth.txt — visibleWidth would undercount
        // it as 1 column and wrapping would fire one column too late.)
        // Skip the OSC 8 wrapper when src is a `data:` URI — those
        // payloads are megabytes of base64 and would exceed typical
        // terminal OSC parameter limits (64KB–1MB), causing rendering
        // artifacts, hangs, or garbage output.
        // Also skip when we're inside an enclosing link span
        // (`[![alt](img)](url)`) — emitting our own OSC 8 would overwrite
        // the outer link destination for subsequent text on that line.
        const link_ok = self.theme.colors and self.theme.hyperlinks and has_src and
            self.link_depth == 0 and
            !bun.strings.startsWith(src.?, "data:");
        if (link_ok) {
            self.writeRawNoColor("\x1b]8;;");
            self.writeRawNoColor(src.?);
            self.writeRawNoColor("\x1b\\");
        }
        const img_marker = if (self.theme.colors) "📷 " else "[img] ";
        self.writeStyled(color(.magenta), img_marker);
        // Route alt/title through writeContent so word-wrap applies and
        // any hard breaks (`\n` captured from .br events) get a proper
        // writeIndent() afterwards — otherwise long alts overflow and
        // continuation lines inside blockquotes lose the `│ ` prefix.
        if (alt.len > 0) {
            self.writeContent(alt);
        } else if (self.image_title) |title| if (title.len > 0) {
            self.writeContent(title);
        } else {
            self.writeContent("(image)");
        } else {
            self.writeContent("(image)");
        }
        self.writeStyled(reset(), "");
        self.reapplyStyles();
        if (link_ok) {
            self.writeRawNoColor("\x1b]8;;\x1b\\");
        }
    }

    /// Emit a Kitty Graphics Protocol transmit-and-display sequence for
    /// the absolute file `path`. Uses `t=f` (transmission medium = regular
    /// file by path) so the terminal reads the file directly. Terminals
    /// that don't understand the APC sequence silently drop it.
    fn emitKittyImageFile(self: *AnsiRenderer, path: []const u8) void {
        // Base64-encode the file path (Kitty expects the payload to be b64).
        const encoded_len = bun.base64.encodeLen(path);
        const encoded = self.allocator.alloc(u8, encoded_len) catch {
            self.out.oom = true;
            return;
        };
        defer self.allocator.free(encoded);
        _ = bun.base64.encode(encoded, path);
        self.writeRawNoColor("\x1b_Ga=T,t=f,f=100,q=2;");
        self.writeRawNoColor(encoded);
        self.writeRawNoColor("\x1b\\");
        self.writeRaw("\n");
        self.col = 0;
        self.last_was_newline = true;
        // Re-emit the active block indent so text that follows the image
        // inside a blockquote / list item keeps its `│ ` / hanging prefix.
        self.writeIndent();
    }

    /// Emit a Kitty Graphics Protocol transmit-and-display sequence with
    /// the PNG bytes encoded directly in the APC payload via `t=d`. The
    /// `base64_payload` is already the base64 body of a `data:image/png`
    /// URL, so we forward it as-is — no temp file, no re-encoding.
    fn emitKittyImageDirect(self: *AnsiRenderer, base64_payload: []const u8) void {
        self.writeRawNoColor("\x1b_Ga=T,t=d,f=100,q=2;");
        self.writeRawNoColor(base64_payload);
        self.writeRawNoColor("\x1b\\");
        self.writeRaw("\n");
        self.col = 0;
        self.last_was_newline = true;
        self.writeIndent();
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

/// Visible printable width of a UTF-8 byte slice, excluding ANSI escape
/// sequences. Correctly handles multi-width graphemes (CJK, emoji).
fn visibleWidth(s: []const u8) usize {
    return bun.strings.visible.width.exclude_ansi_colors.utf8(s);
}

/// Byte index of the longest prefix of `s` whose visible width is <=
/// `max_cols`. ANSI escapes are zero-width and always included.
fn visibleIndexAt(s: []const u8, max_cols: usize) usize {
    return bun.strings.visible.width.exclude_ansi_colors.utf8IndexAtWidth(s, max_cols);
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
    if (bun.getenvZ("COLORFGBG")) |value| {
        // Format: "fg;bg" or "fg;default;bg" — only 7 (white) and 15
        // (bright white) are light terminal backgrounds. Bright colors
        // 9-14 are high-intensity foreground codes, not light backgrounds.
        var iter = std.mem.splitScalar(u8, value, ';');
        var last: []const u8 = "";
        while (iter.next()) |part| last = part;
        if (last.len > 0) {
            const bg = std.fmt.parseInt(u8, last, 10) catch return false;
            return bg == 7 or bg == 15;
        }
    }
    return false;
}

/// Detect whether the current terminal likely supports the Kitty
/// Graphics Protocol. Checked heuristics:
///   - `KITTY_WINDOW_ID` set (native Kitty)
///   - `TERM` contains "kitty"
///   - `TERM_PROGRAM=WezTerm` or `ghostty` (compatible terminals)
///   - `TERM_PROGRAM=ghostty`
pub fn detectKittyGraphics() bool {
    // TERM=dumb is the standard opt-out for any ESC handling — bail
    // before any env match or probe runs.
    if (bun.getenvZ("TERM")) |term| {
        if (bun.strings.eqlCaseInsensitiveASCII(term, "dumb", true)) return false;
    }
    // Fast path: env vars set by known-compatible terminals.
    if (bun.getenvZ("KITTY_WINDOW_ID")) |_| return true;
    if (bun.getenvZ("GHOSTTY_RESOURCES_DIR")) |_| return true;
    if (bun.getenvZ("TERM")) |term| {
        if (bun.strings.contains(term, "kitty")) return true;
        if (bun.strings.contains(term, "ghostty")) return true;
    }
    if (bun.getenvZ("TERM_PROGRAM")) |tp| {
        if (bun.strings.eqlCaseInsensitiveASCII(tp, "wezterm", true)) return true;
        if (bun.strings.eqlCaseInsensitiveASCII(tp, "ghostty", true)) return true;
    }
    // Runtime probe: send a Kitty query to the terminal and wait for a
    // response. Compatible terminals reply within a few ms; others stay
    // silent because they ignore the APC sequence entirely.
    return probeKittyGraphics();
}

/// Write a Kitty Graphics Protocol query to stdout and wait briefly
/// for a response on stdin. Returns true only when the terminal
/// answers with an OK. stdin and stdout must both be TTYs for the
/// probe to run.
///
/// The query transmits a 1×1 placeholder image with id=31 and reads
/// the reply with a short timeout. Raw mode is applied + restored
/// around the read so the bytes don't echo to the user's terminal.
fn probeKittyGraphics() bool {
    if (comptime !bun.Environment.isPosix) return false;
    if (bun.Output.bun_stdio_tty[0] == 0 or bun.Output.bun_stdio_tty[1] == 0) return false;
    // Honor an explicit opt-out.
    if (bun.getenvZ("BUN_DISABLE_KITTY_PROBE")) |_| return false;

    // Save the parent's termios before flipping stdin to raw. If the
    // parent (a TUI, tmux/Zellij pane, etc.) already had raw mode on,
    // restoring to a fixed .normal would corrupt it — instead reapply
    // exactly what we read. tcgetattr failing means stdin isn't a real
    // TTY in a way we can snapshot; skip probing entirely.
    const saved_termios = std.posix.tcgetattr(0) catch return false;
    _ = bun.tty.setMode(0, .raw);
    defer std.posix.tcsetattr(0, .NOW, saved_termios) catch {
        _ = bun.tty.setMode(0, .normal);
    };

    // Query: transmit a 1×1 RGB image (3 zero bytes = "AAAA" b64),
    // id=31. The terminal replies with `\x1b_Gi=31;OK\x1b\\`
    // (or `ENOTSUPPORTED:...`) within a frame.
    const query = "\x1b_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\";
    switch (bun.sys.write(bun.FD.stdout(), query)) {
        .result => {},
        .err => return false,
    }

    // Wait up to ~80ms for a response. Kitty/Ghostty/WezTerm reply
    // in < 10ms; anything longer is noise from an unrelated terminal.
    var pfd = [_]std.posix.pollfd{.{
        .fd = 0,
        .events = std.posix.POLL.IN,
        .revents = 0,
    }};
    // bun.sys.poll has a Maybe variant Zig flags as incomplete — keep std.posix.poll.
    const ready = std.posix.poll(&pfd, 80) catch return false;
    if (ready <= 0) return false;

    var buf: [128]u8 = undefined;
    const n = switch (bun.sys.read(bun.FD.stdin(), &buf)) {
        .result => |r| r,
        .err => return false,
    };
    if (n == 0) return false;
    const reply = buf[0..n];
    // A successful reply looks like: \x1b_G<...>;OK\x1b\
    // Failure (but-understood): \x1b_G<...>;ENOTSUPPORTED:...\x1b\
    return bun.strings.contains(reply, ";OK\x1b\\");
}

/// Resolve an image `src` from markdown to an absolute file path on
/// disk if it refers to a local file, otherwise return null. Handles
/// `file://` URIs and relative paths. Relative paths resolve against
/// `base_dir` when non-null (typically the markdown file's directory),
/// falling back to the process cwd. The returned slice is owned by the
/// caller.
fn resolveLocalImagePath(src: []const u8, allocator: Allocator, base_dir: ?[]const u8) ?[]u8 {
    // Reject remote schemes. A renderer-level prefetch pass can feed
    // http(s) URLs into the renderer via a lookup table as local paths.
    // data: URIs are handled separately in emitImage via direct Kitty
    // transmission (t=d) to avoid creating temp files.
    if (bun.strings.startsWith(src, "http://") or
        bun.strings.startsWith(src, "https://") or
        bun.strings.startsWith(src, "data:"))
    {
        return null;
    }

    // Strip file:// prefix + optional `localhost` authority, then
    // percent-decode. RFC 8089 allows `file://localhost/path`
    // (equivalent to `file:///path`) and real-world file URLs
    // contain %XX escapes for spaces and other reserved chars.
    var path: []const u8 = src;
    if (bun.strings.startsWith(src, "file://")) {
        path = src["file://".len..];
        // Drop `localhost` authority — RFC 8089 treats it as identity.
        if (bun.strings.startsWith(path, "localhost/")) {
            path = path["localhost".len..];
        } else if (bun.strings.eqlComptime(path, "localhost")) {
            return null;
        }
    }

    // Percent-decode the path so file:///foo/bar%20baz works.
    const decoded = PercentEncoding.decodeAlloc(allocator, path) catch return null;
    defer allocator.free(decoded);

    // Resolve to an absolute path. bun.path.joinAbsString returns a
    // slice in a threadlocal buffer — dupe it before leaving this fn.
    // Prefer the markdown file's directory when provided; otherwise fall
    // back to cwd so `Bun.markdown.ansi()` callers without a source path
    // still work.
    var cwd_buf: bun.PathBuffer = undefined;
    const base: []const u8 = if (base_dir) |d| d else switch (bun.sys.getcwd(&cwd_buf)) {
        .result => |c| c,
        .err => return null,
    };
    const joined = bun.path.joinAbsString(base, &.{decoded}, .auto);
    const abs = allocator.dupe(u8, joined) catch return null;
    // Stat instead of plain exists() so a directory like `./assets/` gets
    // rejected. bun.sys.exists wraps access(path, F_OK) which returns true
    // for any entry, including directories — and emitKittyImageFile sets
    // q=2 so the terminal silently drops directory paths without falling
    // through to alt text.
    const abs_z = allocator.dupeZ(u8, abs) catch {
        allocator.free(abs);
        return null;
    };
    defer allocator.free(abs_z);
    switch (bun.sys.stat(abs_z)) {
        .result => |s| if ((s.mode & bun.S.IFMT) != bun.S.IFREG) {
            allocator.free(abs);
            return null;
        },
        .err => {
            allocator.free(abs);
            return null;
        },
    }
    return abs;
}

// ========================================
// Public entry point
// ========================================

/// Extract the base64 body of a `data:image/png;base64,...` URI. Returns
/// a slice into `src` (no allocation) that's the direct payload Kitty
/// can consume via `t=d,f=100`. Non-PNG data URIs return null because
/// Kitty's format codes (`f=100` PNG, `f=24` RGB, `f=32` RGBA) don't
/// cover JPEG/GIF/WebP binary input.
fn extractPngDataUrlBase64(src: []const u8) ?[]const u8 {
    if (!bun.strings.startsWith(src, "data:")) return null;
    const comma = bun.strings.indexOfChar(src, ',') orelse return null;
    const header = src[0..comma];
    const payload = src[comma + 1 ..];
    if (!bun.strings.endsWith(header, ";base64")) return null;
    // Only PNG is losslessly transmittable via t=d,f=100.
    if (!bun.strings.contains(header, "image/png")) return null;
    return payload;
}

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
const PercentEncoding = @import("../url/url.zig").PercentEncoding;
const Allocator = std.mem.Allocator;

const types = @import("./types.zig");
const BlockType = types.BlockType;
const Renderer = types.Renderer;
const SpanDetail = types.SpanDetail;
const SpanType = types.SpanType;
const TextType = types.TextType;
