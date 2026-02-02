//! TuiScreen — a grid of styled cells for TUI rendering.
//! Wraps Ghostty's Page/Row/Cell/StyleSet directly.

const TuiScreen = @This();

const ghostty = @import("ghostty").terminal;
const Page = ghostty.page.Page;
const Cell = ghostty.Cell;
const Style = ghostty.Style;
const size = ghostty.size;
const sgr = ghostty.sgr;

pub const js = jsc.Codegen.JSTuiScreen;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const ClipRect = struct { x1: size.CellCountInt, y1: size.CellCountInt, x2: size.CellCountInt, y2: size.CellCountInt };

/// Manages hyperlink URLs and a per-cell ID mapping.
pub const HyperlinkPool = struct {
    /// Parallel array indexed by (y * cols + x), lazily allocated. 0 = no hyperlink.
    ids: ?[]u16 = null,
    /// Interned URL strings, indexed by (id - 1).
    urls: std.ArrayListUnmanaged([]const u8) = .{},
    /// URL string → ID for deduplication.
    map: std.StringHashMapUnmanaged(u16) = .{},
    /// Next ID to assign (starts at 1; 0 is reserved for "no hyperlink").
    next_id: u16 = 1,

    /// Intern a URL string. Returns an existing ID if the URL was already interned.
    pub fn intern(self: *HyperlinkPool, url: []const u8) error{OutOfMemory}!u16 {
        if (self.map.get(url)) |existing_id| return existing_id;

        const id = self.next_id;
        self.next_id +%= 1;

        const owned_url = try bun.default_allocator.dupe(u8, url);
        errdefer bun.default_allocator.free(owned_url);

        try self.urls.append(bun.default_allocator, owned_url);
        errdefer _ = self.urls.pop();

        try self.map.put(bun.default_allocator, owned_url, id);

        return id;
    }

    /// Look up the URL for a given hyperlink ID (1-based). Returns null for ID 0.
    pub fn getUrl(self: *const HyperlinkPool, id: u16) ?[]const u8 {
        if (id == 0) return null;
        const idx = id - 1;
        if (idx >= self.urls.items.len) return null;
        return self.urls.items[idx];
    }

    /// Get the hyperlink ID for a cell at (x, y) given grid width `cols`.
    pub fn getId(self: *const HyperlinkPool, x: size.CellCountInt, y: size.CellCountInt, cols: size.CellCountInt) u16 {
        const cell_ids = self.ids orelse return 0;
        const idx = @as(usize, y) * @as(usize, cols) + @as(usize, x);
        if (idx >= cell_ids.len) return 0;
        return cell_ids[idx];
    }

    /// Set the hyperlink ID for a cell at (x, y) given grid width `cols`.
    /// Lazily allocates the ID array on first use.
    pub fn setId(self: *HyperlinkPool, x: size.CellCountInt, y: size.CellCountInt, cols: size.CellCountInt, rows: size.CellCountInt, hid: u16) error{OutOfMemory}!void {
        const cell_ids = try self.ensureIds(cols, rows);
        const idx = @as(usize, y) * @as(usize, cols) + @as(usize, x);
        if (idx < cell_ids.len) cell_ids[idx] = hid;
    }

    /// Ensure the per-cell ID array is allocated for the given grid dimensions.
    fn ensureIds(self: *HyperlinkPool, cols: size.CellCountInt, rows: size.CellCountInt) error{OutOfMemory}![]u16 {
        if (self.ids) |existing| return existing;
        const count = @as(usize, cols) * @as(usize, rows);
        const cell_ids = try bun.default_allocator.alloc(u16, count);
        @memset(cell_ids, 0);
        self.ids = cell_ids;
        return cell_ids;
    }

    /// Zero all per-cell IDs (e.g. on screen clear). Does not free the array.
    pub fn clearIds(self: *HyperlinkPool) void {
        if (self.ids) |cell_ids| @memset(cell_ids, 0);
    }

    /// Free the per-cell ID array (e.g. on resize where dimensions change).
    pub fn freeIds(self: *HyperlinkPool) void {
        if (self.ids) |cell_ids| bun.default_allocator.free(cell_ids);
        self.ids = null;
    }

    /// Release all resources.
    pub fn deinit(self: *HyperlinkPool) void {
        self.freeIds();
        for (self.urls.items) |url| bun.default_allocator.free(url);
        self.urls.deinit(bun.default_allocator);
        self.map.deinit(bun.default_allocator);
        self.* = .{};
    }
};

page: Page,
clip_stack: [8]ClipRect = undefined,
clip_depth: u8 = 0,
hyperlinks: HyperlinkPool = .{},

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*TuiScreen {
    const arguments = callframe.arguments();
    if (arguments.len < 2) return globalThis.throw("Screen requires (cols, rows) arguments", .{});
    if (!arguments[0].isNumber() or !arguments[1].isNumber())
        return globalThis.throw("Screen requires numeric cols and rows", .{});

    const cols: size.CellCountInt = @intCast(@max(1, @min((try arguments[0].coerce(i32, globalThis)), 4096)));
    const rows: size.CellCountInt = @intCast(@max(1, @min((try arguments[1].coerce(i32, globalThis)), 4096)));

    const page = Page.init(.{ .cols = cols, .rows = rows, .styles = 256 }) catch {
        return globalThis.throw("Failed to allocate Screen", .{});
    };

    return bun.new(TuiScreen, .{ .page = page });
}

pub fn finalize(this: *TuiScreen) callconv(.c) void {
    this.hyperlinks.deinit();
    this.page.deinit();
    bun.destroy(this);
}

pub fn estimatedSize(this: *const TuiScreen) usize {
    return this.page.memory.len;
}

fn getCols(self: *const TuiScreen) size.CellCountInt {
    return self.page.size.cols;
}

fn getRows(self: *const TuiScreen) size.CellCountInt {
    return self.page.size.rows;
}

fn getRowCells(self: *const TuiScreen, y: usize) struct { row: *ghostty.page.Row, cells: []Cell } {
    const row = self.page.getRow(y);
    const cells = row.cells.ptr(self.page.memory)[0..self.page.size.cols];
    return .{ .row = row, .cells = cells };
}

/// setText(x, y, text, styleId)
pub fn setText(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 3) return globalThis.throw("setText requires (x, y, text[, styleId])", .{});

    const raw_x: size.CellCountInt = @intCast(@max(0, @min((try arguments[0].coerce(i32, globalThis)), this.getCols() -| 1)));
    const raw_y: size.CellCountInt = @intCast(@max(0, @min((try arguments[1].coerce(i32, globalThis)), this.getRows() -| 1)));
    if (!arguments[2].isString()) return globalThis.throw("setText: text must be a string", .{});

    const sid: size.StyleCountInt = if (arguments.len > 3 and arguments[3].isNumber())
        @intCast(@max(0, @min((try arguments[3].coerce(i32, globalThis)), std.math.maxInt(size.StyleCountInt))))
    else
        0;

    // Apply clipping: for setText, clip restricts which row+col range is writable
    const start_x = raw_x;
    const y = raw_y;
    var clip_max_col: size.CellCountInt = this.getCols();
    if (this.clip_depth > 0) {
        const cr = this.clip_stack[this.clip_depth - 1];
        if (y < cr.y1 or y >= cr.y2 or start_x >= cr.x2) return jsc.JSValue.jsNumber(@as(i32, 0));
        clip_max_col = cr.x2;
    }

    const str = try arguments[2].toSliceClone(globalThis);
    defer str.deinit();
    const text = str.slice();

    const rc = this.getRowCells(y);
    const row = rc.row;
    const cells = rc.cells;
    var col = start_x;
    var i: usize = 0;
    const cols = clip_max_col;

    // Fast path: blast ASCII directly into cells — no per-codepoint decode
    const first_non_ascii = bun.strings.firstNonASCII(text) orelse @as(u32, @intCast(text.len));
    const ascii_end: usize = @min(first_non_ascii, cols -| col);
    if (ascii_end > 0) {
        for (text[0..ascii_end]) |byte| {
            if (col >= cols) break;
            cells[col] = .{
                .content_tag = .codepoint,
                .content = .{ .codepoint = byte },
                .style_id = sid,
                .wide = .narrow,
            };
            col += 1;
        }
        i = ascii_end;
        row.dirty = true;
        if (sid != 0) row.styled = true;
    }

    // Slow path: non-ASCII — decode codepoints, handle width/graphemes
    var after_zwj = false;
    while (i < text.len and col < cols) {
        const cp_len = bun.strings.utf8ByteSequenceLength(text[i]);
        if (cp_len == 0) {
            i += 1;
            continue;
        }
        if (i + cp_len > text.len) break;

        var bytes = [4]u8{ text[i], 0, 0, 0 };
        if (cp_len > 1) bytes[1] = text[i + 1];
        if (cp_len > 2) bytes[2] = text[i + 2];
        if (cp_len > 3) bytes[3] = text[i + 3];
        const cp = bun.strings.decodeWTF8RuneT(&bytes, cp_len, u21, 0xFFFD);
        if (cp == 0xFFFD and cp_len > 1) {
            i += cp_len;
            continue;
        }

        const width: u2 = @intCast(@min(bun.strings.visibleCodepointWidth(@intCast(cp), false), 2));

        if (width == 0) {
            // Zero-width codepoint: append as grapheme extension to the
            // preceding content cell (walk back past any spacer_tails).
            if (col > start_x) {
                const target = graphemeTarget(cells, col, start_x);
                this.page.appendGrapheme(row, &cells[target], @intCast(cp)) catch {};
                row.dirty = true;
            }
            after_zwj = (cp == 0x200D);
            i += cp_len;
            continue;
        }

        // After a ZWJ, the next codepoint is a grapheme continuation
        // regardless of its own width (e.g. family sequence).
        if (after_zwj) {
            after_zwj = false;
            if (col > start_x) {
                const target = graphemeTarget(cells, col, start_x);
                this.page.appendGrapheme(row, &cells[target], @intCast(cp)) catch {};
                row.dirty = true;
            }
            i += cp_len;
            continue;
        }

        if (width == 2 and col + 1 >= cols) break;

        cells[col] = .{
            .content_tag = .codepoint,
            .content = .{ .codepoint = @intCast(cp) },
            .style_id = sid,
            .wide = if (width == 2) .wide else .narrow,
        };
        row.dirty = true;
        if (sid != 0) row.styled = true;
        col += 1;

        if (width == 2 and col < cols) {
            cells[col] = .{ .content_tag = .codepoint, .content = .{ .codepoint = ' ' }, .style_id = sid, .wide = .spacer_tail };
            col += 1;
        }
        i += cp_len;
    }

    return jsc.JSValue.jsNumber(@as(i32, @intCast(col - start_x)));
}

/// style({ fg, bg, bold, italic, underline, ... }) → styleId
pub fn style(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 1 or !arguments[0].isObject()) return globalThis.throw("style requires an options object", .{});

    const opts = arguments[0];
    var s = Style{};

    if (try opts.getTruthy(globalThis, "fg")) |v| s.fg_color = try parseColor(globalThis, v);
    if (try opts.getTruthy(globalThis, "bg")) |v| s.bg_color = try parseColor(globalThis, v);
    if (try opts.getTruthy(globalThis, "underlineColor")) |v| s.underline_color = try parseColor(globalThis, v);

    // Build flags by setting individual fields
    if (try opts.getTruthy(globalThis, "bold")) |v| if (v.isBoolean() and v.asBoolean()) {
        s.flags.bold = true;
    };
    if (try opts.getTruthy(globalThis, "italic")) |v| if (v.isBoolean() and v.asBoolean()) {
        s.flags.italic = true;
    };
    if (try opts.getTruthy(globalThis, "faint")) |v| if (v.isBoolean() and v.asBoolean()) {
        s.flags.faint = true;
    };
    if (try opts.getTruthy(globalThis, "blink")) |v| if (v.isBoolean() and v.asBoolean()) {
        s.flags.blink = true;
    };
    if (try opts.getTruthy(globalThis, "inverse")) |v| if (v.isBoolean() and v.asBoolean()) {
        s.flags.inverse = true;
    };
    if (try opts.getTruthy(globalThis, "invisible")) |v| if (v.isBoolean() and v.asBoolean()) {
        s.flags.invisible = true;
    };
    if (try opts.getTruthy(globalThis, "strikethrough")) |v| if (v.isBoolean() and v.asBoolean()) {
        s.flags.strikethrough = true;
    };
    if (try opts.getTruthy(globalThis, "overline")) |v| if (v.isBoolean() and v.asBoolean()) {
        s.flags.overline = true;
    };
    if (try opts.getTruthy(globalThis, "underline")) |v| {
        if (v.isString()) {
            const ul_str = try v.toSliceClone(globalThis);
            defer ul_str.deinit();
            const UnderlineStyle = @TypeOf(s.flags.underline);
            s.flags.underline = bun.ComptimeEnumMap(UnderlineStyle).get(ul_str.slice()) orelse .none;
        } else if (v.isBoolean() and v.asBoolean()) {
            s.flags.underline = .single;
        }
    }

    // Default style (no flags, no colors) is always ID 0.
    if (s.default()) return jsc.JSValue.jsNumber(@as(i32, 0));

    const id = this.page.styles.add(this.page.memory, s) catch {
        return globalThis.throw("Failed to intern style: style set full", .{});
    };

    return jsc.JSValue.jsNumber(@as(i32, @intCast(id)));
}

/// clearRect(x, y, w, h)
pub fn clearRect(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 4) return globalThis.throw("clearRect requires (x, y, w, h)", .{});

    const raw_x: size.CellCountInt = @intCast(@max(0, @min((try arguments[0].coerce(i32, globalThis)), this.getCols())));
    const raw_y: size.CellCountInt = @intCast(@max(0, @min((try arguments[1].coerce(i32, globalThis)), this.getRows())));
    const raw_w: size.CellCountInt = @intCast(@max(0, @min((try arguments[2].coerce(i32, globalThis)), this.getCols() -| raw_x)));
    const raw_h: size.CellCountInt = @intCast(@max(0, @min((try arguments[3].coerce(i32, globalThis)), this.getRows() -| raw_y)));

    const clipped = this.applyClip(raw_x, raw_y, raw_w, raw_h) orelse return .js_undefined;

    var row_idx = clipped.y;
    while (row_idx < clipped.y +| clipped.h) : (row_idx += 1) {
        const row = this.page.getRow(row_idx);
        this.page.clearCells(row, clipped.x, clipped.x +| clipped.w);
        row.dirty = true;
    }
    return .js_undefined;
}

/// fill(x, y, w, h, char, styleId)
pub fn fill(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 5) return globalThis.throw("fill requires (x, y, w, h, char[, styleId])", .{});

    const raw_x: size.CellCountInt = @intCast(@max(0, @min((try arguments[0].coerce(i32, globalThis)), this.getCols())));
    const raw_y: size.CellCountInt = @intCast(@max(0, @min((try arguments[1].coerce(i32, globalThis)), this.getRows())));
    const raw_w: size.CellCountInt = @intCast(@max(0, @min((try arguments[2].coerce(i32, globalThis)), this.getCols() -| raw_x)));
    const raw_h: size.CellCountInt = @intCast(@max(0, @min((try arguments[3].coerce(i32, globalThis)), this.getRows() -| raw_y)));

    var fill_cp: u21 = ' ';
    if (arguments[4].isString()) {
        const cs = try arguments[4].toSliceClone(globalThis);
        defer cs.deinit();
        const s = cs.slice();
        if (s.len > 0) {
            const cl = bun.strings.utf8ByteSequenceLength(s[0]);
            if (cl == 0) {
                fill_cp = ' ';
            } else {
                var bytes = [4]u8{ s[0], 0, 0, 0 };
                if (cl > 1 and s.len > 1) bytes[1] = s[1];
                if (cl > 2 and s.len > 2) bytes[2] = s[2];
                if (cl > 3 and s.len > 3) bytes[3] = s[3];
                fill_cp = bun.strings.decodeWTF8RuneT(&bytes, cl, u21, ' ');
            }
        }
    } else if (arguments[4].isNumber()) {
        fill_cp = @intCast(@max(0, @min((try arguments[4].coerce(i32, globalThis)), 0x10FFFF)));
    }

    const sid: size.StyleCountInt = if (arguments.len > 5 and arguments[5].isNumber())
        @intCast(@max(0, @min((try arguments[5].coerce(i32, globalThis)), std.math.maxInt(size.StyleCountInt))))
    else
        0;

    const clipped = this.applyClip(raw_x, raw_y, raw_w, raw_h) orelse return .js_undefined;

    const fill_width: u2 = @intCast(@min(bun.strings.visibleCodepointWidth(@intCast(fill_cp), false), 2));
    const end_x = clipped.x +| clipped.w;

    var row_idx = clipped.y;
    while (row_idx < clipped.y +| clipped.h) : (row_idx += 1) {
        const rc = this.getRowCells(row_idx);
        var col = clipped.x;
        while (col < end_x) {
            if (fill_width == 2) {
                if (col + 1 >= end_x) break; // wide char doesn't fit in remaining space
                rc.cells[col] = .{ .content_tag = .codepoint, .content = .{ .codepoint = fill_cp }, .style_id = sid, .wide = .wide };
                rc.cells[col + 1] = .{ .content_tag = .codepoint, .content = .{ .codepoint = ' ' }, .style_id = sid, .wide = .spacer_tail };
                col += 2;
            } else {
                rc.cells[col] = .{ .content_tag = .codepoint, .content = .{ .codepoint = fill_cp }, .style_id = sid, .wide = .narrow };
                col += 1;
            }
        }
        rc.row.dirty = true;
        if (sid != 0) rc.row.styled = true;
    }
    return .js_undefined;
}

/// copy(srcScreen, sx, sy, dx, dy, w, h)
pub fn copy(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 7) return globalThis.throw("copy requires (srcScreen, sx, sy, dx, dy, w, h)", .{});

    const src = TuiScreen.fromJS(arguments[0]) orelse return globalThis.throw("copy: first argument must be a Screen", .{});
    const sx: size.CellCountInt = @intCast(@max(0, @min((try arguments[1].coerce(i32, globalThis)), src.getCols())));
    const sy: size.CellCountInt = @intCast(@max(0, @min((try arguments[2].coerce(i32, globalThis)), src.getRows())));
    const raw_dx: size.CellCountInt = @intCast(@max(0, @min((try arguments[3].coerce(i32, globalThis)), this.getCols())));
    const raw_dy: size.CellCountInt = @intCast(@max(0, @min((try arguments[4].coerce(i32, globalThis)), this.getRows())));
    const raw_w: size.CellCountInt = @intCast(@max(0, @min((try arguments[5].coerce(i32, globalThis)), @min(src.getCols() -| sx, this.getCols() -| raw_dx))));
    const raw_h: size.CellCountInt = @intCast(@max(0, @min((try arguments[6].coerce(i32, globalThis)), @min(src.getRows() -| sy, this.getRows() -| raw_dy))));

    const clipped = this.applyClip(raw_dx, raw_dy, raw_w, raw_h) orelse return .js_undefined;
    // Adjust source offset based on how much the destination was shifted by clipping
    const src_x_off = clipped.x -| raw_dx;
    const src_y_off = clipped.y -| raw_dy;

    var off: size.CellCountInt = 0;
    while (off < clipped.h) : (off += 1) {
        const src_cells = src.getRowCells(sy +| src_y_off +| off).cells;
        const dst = this.getRowCells(clipped.y +| off);
        @memcpy(dst.cells[clipped.x..][0..clipped.w], src_cells[sx +| src_x_off..][0..clipped.w]);
        dst.row.dirty = true;
    }
    return .js_undefined;
}

/// resize(cols, rows)
pub fn resize(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 2) return globalThis.throw("resize requires (cols, rows)", .{});

    const nc: size.CellCountInt = @intCast(@max(1, @min((try arguments[0].coerce(i32, globalThis)), 4096)));
    const nr: size.CellCountInt = @intCast(@max(1, @min((try arguments[1].coerce(i32, globalThis)), 4096)));
    if (nc == this.getCols() and nr == this.getRows()) return .js_undefined;

    var new_page = Page.init(.{ .cols = nc, .rows = nr, .styles = 256 }) catch {
        return globalThis.throw("Failed to resize Screen", .{});
    };

    const cc = @min(this.getCols(), nc);
    const cr = @min(this.getRows(), nr);
    var ri: size.CellCountInt = 0;
    while (ri < cr) : (ri += 1) {
        const src_cells = this.getRowCells(ri).cells;
        const dst_row = new_page.getRow(ri);
        const dst_cells = dst_row.cells.ptr(new_page.memory)[0..new_page.size.cols];
        @memcpy(dst_cells[0..cc], src_cells[0..cc]);
        dst_row.dirty = true;
    }

    this.page.deinit();
    this.page = new_page;
    // Free hyperlink ID array (it's sized to old dimensions)
    this.hyperlinks.freeIds();
    return .js_undefined;
}

/// clear()
pub fn clear(this: *TuiScreen, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var ri: size.CellCountInt = 0;
    while (ri < this.getRows()) : (ri += 1) {
        const row = this.page.getRow(ri);
        this.page.clearCells(row, 0, this.getCols());
        row.dirty = true;
    }
    this.hyperlinks.clearIds();
    return .js_undefined;
}

/// hyperlink(url) → hyperlinkId — interns a URL and returns its ID
pub fn hyperlink(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 1 or !arguments[0].isString()) return globalThis.throw("hyperlink requires a URL string", .{});

    const url_str = try arguments[0].toSliceClone(globalThis);
    defer url_str.deinit();

    const id = try this.hyperlinks.intern(url_str.slice());
    return jsc.JSValue.jsNumber(@as(i32, @intCast(id)));
}

/// setHyperlink(x, y, hyperlinkId) — set the hyperlink ID for a cell
pub fn setHyperlink(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 3) return globalThis.throw("setHyperlink requires (x, y, hyperlinkId)", .{});

    const x = (try arguments[0].coerce(i32, globalThis));
    const y = (try arguments[1].coerce(i32, globalThis));
    if (x < 0 or x >= this.getCols() or y < 0 or y >= this.getRows()) return .js_undefined;

    const hid: u16 = @intCast(@max(0, @min((try arguments[2].coerce(i32, globalThis)), std.math.maxInt(u16))));

    try this.hyperlinks.setId(@intCast(x), @intCast(y), this.getCols(), this.getRows(), hid);
    this.page.getRow(@intCast(y)).dirty = true;
    return .js_undefined;
}

/// clip(x1, y1, x2, y2) — push a clipping rectangle onto the stack
pub fn clip(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 4) return globalThis.throw("clip requires (x1, y1, x2, y2)", .{});

    if (this.clip_depth >= 8) return globalThis.throw("clip stack overflow (max 8)", .{});

    const cols = this.getCols();
    const rows = this.getRows();
    const x1: size.CellCountInt = @intCast(@max(0, @min((try arguments[0].coerce(i32, globalThis)), cols)));
    const y1: size.CellCountInt = @intCast(@max(0, @min((try arguments[1].coerce(i32, globalThis)), rows)));
    const x2: size.CellCountInt = @intCast(@max(0, @min((try arguments[2].coerce(i32, globalThis)), cols)));
    const y2: size.CellCountInt = @intCast(@max(0, @min((try arguments[3].coerce(i32, globalThis)), rows)));

    this.clip_stack[this.clip_depth] = .{ .x1 = x1, .y1 = y1, .x2 = x2, .y2 = y2 };
    this.clip_depth += 1;
    return .js_undefined;
}

/// unclip() — pop the clipping stack
pub fn unclip(this: *TuiScreen, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.clip_depth > 0) this.clip_depth -= 1;
    return .js_undefined;
}

/// Apply the active clip rect to a region, returning the clamped bounds.
/// Returns null if the region is entirely outside the clip rect.
fn applyClip(this: *const TuiScreen, x: size.CellCountInt, y: size.CellCountInt, w: size.CellCountInt, h: size.CellCountInt) ?struct { x: size.CellCountInt, y: size.CellCountInt, w: size.CellCountInt, h: size.CellCountInt } {
    if (this.clip_depth == 0) return .{ .x = x, .y = y, .w = w, .h = h };
    const cr = this.clip_stack[this.clip_depth - 1];
    const cx1 = @max(x, cr.x1);
    const cy1 = @max(y, cr.y1);
    const cx2 = @min(x +| w, cr.x2);
    const cy2 = @min(y +| h, cr.y2);
    if (cx1 >= cx2 or cy1 >= cy2) return null;
    return .{ .x = cx1, .y = cy1, .w = cx2 -| cx1, .h = cy2 -| cy1 };
}

pub fn getWidth(this: *const TuiScreen, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(i32, @intCast(this.getCols())));
}

pub fn getHeight(this: *const TuiScreen, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(i32, @intCast(this.getRows())));
}

/// getCell(x, y) → { char, styleId, wide }
pub fn getCell(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 2) return globalThis.throw("getCell requires (x, y)", .{});
    const x = (try arguments[0].coerce(i32, globalThis));
    const y = (try arguments[1].coerce(i32, globalThis));
    if (x < 0 or x >= this.getCols() or y < 0 or y >= this.getRows()) return .null;

    const cell = this.getRowCells(@intCast(y)).cells[@intCast(x)];
    const result = jsc.JSValue.createEmptyObject(globalThis, 3);

    if (cell.content_tag == .codepoint or cell.content_tag == .codepoint_grapheme) {
        const cp: u21 = @intCast(cell.content.codepoint);
        if (cp == 0) {
            result.put(globalThis, bun.String.static("char"), try bun.String.createUTF8ForJS(globalThis, " "));
        } else {
            var buf: [4]u8 = undefined;
            const len = bun.strings.encodeWTF8RuneT(&buf, u21, cp);
            if (len > 0) {
                result.put(globalThis, bun.String.static("char"), try bun.String.createUTF8ForJS(globalThis, buf[0..len]));
            } else {
                result.put(globalThis, bun.String.static("char"), try bun.String.createUTF8ForJS(globalThis, " "));
            }
        }
    } else {
        result.put(globalThis, bun.String.static("char"), try bun.String.createUTF8ForJS(globalThis, " "));
    }

    result.put(globalThis, bun.String.static("styleId"), jsc.JSValue.jsNumber(@as(i32, @intCast(cell.style_id))));
    result.put(globalThis, bun.String.static("wide"), jsc.JSValue.jsNumber(@as(i32, @intFromEnum(cell.wide))));
    return result;
}

/// drawBox(x, y, w, h, options?) — draw a bordered box.
/// Options: { style: "single"|"double"|"rounded"|"heavy", styleId, fill, fillChar }
pub fn drawBox(this: *TuiScreen, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len < 4) return globalThis.throw("drawBox requires (x, y, w, h[, options])", .{});

    const raw_x: size.CellCountInt = @intCast(@max(0, @min((try arguments[0].coerce(i32, globalThis)), this.getCols())));
    const raw_y: size.CellCountInt = @intCast(@max(0, @min((try arguments[1].coerce(i32, globalThis)), this.getRows())));
    const raw_w: size.CellCountInt = @intCast(@max(0, @min((try arguments[2].coerce(i32, globalThis)), this.getCols() -| raw_x)));
    const raw_h: size.CellCountInt = @intCast(@max(0, @min((try arguments[3].coerce(i32, globalThis)), this.getRows() -| raw_y)));

    if (raw_w < 2 or raw_h < 2) return .js_undefined;

    var border_chars = BoxChars.single;
    var sid: size.StyleCountInt = 0;
    var do_fill = false;
    var fill_char: u21 = ' ';

    if (arguments.len > 4 and arguments[4].isObject()) {
        const opts = arguments[4];
        if (try opts.getTruthy(globalThis, "style")) |v| {
            if (v.isString()) {
                const s = try v.toSliceClone(globalThis);
                defer s.deinit();
                border_chars = BoxChars.fromName(s.slice());
            }
        }
        if (try opts.getTruthy(globalThis, "styleId")) |v| {
            if (v.isNumber()) sid = @intCast(@max(0, @min((try v.coerce(i32, globalThis)), std.math.maxInt(size.StyleCountInt))));
        }
        if (try opts.getTruthy(globalThis, "fill")) |v| {
            if (v.isBoolean()) do_fill = v.asBoolean();
        }
        if (try opts.getTruthy(globalThis, "fillChar")) |v| {
            if (v.isString()) {
                const cs = try v.toSliceClone(globalThis);
                defer cs.deinit();
                const fc = cs.slice();
                if (fc.len > 0) {
                    const cl = bun.strings.utf8ByteSequenceLength(fc[0]);
                    if (cl > 0) {
                        var bytes = [4]u8{ fc[0], 0, 0, 0 };
                        if (cl > 1 and fc.len > 1) bytes[1] = fc[1];
                        if (cl > 2 and fc.len > 2) bytes[2] = fc[2];
                        if (cl > 3 and fc.len > 3) bytes[3] = fc[3];
                        fill_char = bun.strings.decodeWTF8RuneT(&bytes, cl, u21, ' ');
                    }
                }
            }
        }
    }

    const clipped = this.applyClip(raw_x, raw_y, raw_w, raw_h) orelse return .js_undefined;
    const x = clipped.x;
    const y = clipped.y;
    const w = clipped.w;
    const h = clipped.h;
    const x2 = x +| w;
    const y2 = y +| h;
    const orig_x2 = raw_x +| raw_w;
    const orig_y2 = raw_y +| raw_h;

    // Top border
    if (y == raw_y) {
        const rc = this.getRowCells(y);
        if (x == raw_x) {
            rc.cells[x] = .{ .content_tag = .codepoint, .content = .{ .codepoint = border_chars.tl }, .style_id = sid, .wide = .narrow };
        }
        var col = @max(x, raw_x + 1);
        while (col < @min(x2, orig_x2 -| 1)) : (col += 1) {
            rc.cells[col] = .{ .content_tag = .codepoint, .content = .{ .codepoint = border_chars.h }, .style_id = sid, .wide = .narrow };
        }
        if (x2 == orig_x2 and x2 > x) {
            rc.cells[x2 - 1] = .{ .content_tag = .codepoint, .content = .{ .codepoint = border_chars.tr }, .style_id = sid, .wide = .narrow };
        }
        rc.row.dirty = true;
        if (sid != 0) rc.row.styled = true;
    }

    // Bottom border
    if (y2 == orig_y2 and y2 > y) {
        const rc = this.getRowCells(y2 - 1);
        if (x == raw_x) {
            rc.cells[x] = .{ .content_tag = .codepoint, .content = .{ .codepoint = border_chars.bl }, .style_id = sid, .wide = .narrow };
        }
        var col = @max(x, raw_x + 1);
        while (col < @min(x2, orig_x2 -| 1)) : (col += 1) {
            rc.cells[col] = .{ .content_tag = .codepoint, .content = .{ .codepoint = border_chars.h }, .style_id = sid, .wide = .narrow };
        }
        if (x2 == orig_x2 and x2 > x) {
            rc.cells[x2 - 1] = .{ .content_tag = .codepoint, .content = .{ .codepoint = border_chars.br }, .style_id = sid, .wide = .narrow };
        }
        rc.row.dirty = true;
        if (sid != 0) rc.row.styled = true;
    }

    // Side borders and optional fill
    const row_start = if (y == raw_y) y + 1 else y;
    const row_end = if (y2 == orig_y2 and y2 > y) y2 - 1 else y2;
    var row_idx = row_start;
    while (row_idx < row_end) : (row_idx += 1) {
        const rc = this.getRowCells(row_idx);
        if (x == raw_x) {
            rc.cells[x] = .{ .content_tag = .codepoint, .content = .{ .codepoint = border_chars.v }, .style_id = sid, .wide = .narrow };
        }
        if (x2 == orig_x2 and x2 > x) {
            rc.cells[x2 - 1] = .{ .content_tag = .codepoint, .content = .{ .codepoint = border_chars.v }, .style_id = sid, .wide = .narrow };
        }
        if (do_fill) {
            const fill_start = @max(x, raw_x + 1);
            const fill_end = @min(x2, orig_x2 -| 1);
            var col = fill_start;
            while (col < fill_end) : (col += 1) {
                rc.cells[col] = .{ .content_tag = .codepoint, .content = .{ .codepoint = fill_char }, .style_id = sid, .wide = .narrow };
            }
        }
        rc.row.dirty = true;
        if (sid != 0) rc.row.styled = true;
    }

    return .js_undefined;
}

/// Box drawing character sets.
const BoxChars = struct {
    tl: u21,
    tr: u21,
    bl: u21,
    br: u21,
    h: u21,
    v: u21,

    const single = BoxChars{ .tl = '┌', .tr = '┐', .bl = '└', .br = '┘', .h = '─', .v = '│' };
    const double = BoxChars{ .tl = '╔', .tr = '╗', .bl = '╚', .br = '╝', .h = '═', .v = '║' };
    const rounded = BoxChars{ .tl = '╭', .tr = '╮', .bl = '╰', .br = '╯', .h = '─', .v = '│' };
    const heavy = BoxChars{ .tl = '┏', .tr = '┓', .bl = '┗', .br = '┛', .h = '━', .v = '┃' };
    const ascii = BoxChars{ .tl = '+', .tr = '+', .bl = '+', .br = '+', .h = '-', .v = '|' };

    fn fromName(name: []const u8) BoxChars {
        if (bun.strings.eqlComptime(name, "double")) return double;
        if (bun.strings.eqlComptime(name, "rounded")) return rounded;
        if (bun.strings.eqlComptime(name, "heavy")) return heavy;
        if (bun.strings.eqlComptime(name, "ascii")) return ascii;
        return single;
    }
};

/// Walk back from `col` past spacer_tail cells to find the content cell
/// that should receive grapheme extensions.
fn graphemeTarget(cells: []Cell, col: size.CellCountInt, start_x: size.CellCountInt) size.CellCountInt {
    var target = col - 1;
    while (target > start_x and cells[target].wide == .spacer_tail) {
        target -= 1;
    }
    return target;
}

fn parseColor(globalThis: *jsc.JSGlobalObject, val: jsc.JSValue) bun.JSError!Style.Color {
    if (val.isNumber()) {
        const v: u32 = @bitCast(val.toInt32());
        return .{ .rgb = .{
            .r = @intCast((v >> 16) & 0xFF),
            .g = @intCast((v >> 8) & 0xFF),
            .b = @intCast(v & 0xFF),
        } };
    }
    if (val.isString()) {
        const str = try val.toSliceClone(globalThis);
        defer str.deinit();
        const s = str.slice();
        const hex = if (s.len > 0 and s[0] == '#') s[1..] else s;
        if (hex.len == 6) {
            const r = std.fmt.parseInt(u8, hex[0..2], 16) catch 0;
            const g = std.fmt.parseInt(u8, hex[2..4], 16) catch 0;
            const b = std.fmt.parseInt(u8, hex[4..6], 16) catch 0;
            return .{ .rgb = .{ .r = r, .g = g, .b = b } };
        }
    }
    // Object form: { palette: 196 } for 256-color palette, or { r, g, b } for RGB
    if (val.isObject()) {
        if (try val.getTruthy(globalThis, "palette")) |p| {
            if (p.isNumber()) {
                const idx: u8 = @intCast(@max(0, @min((try p.coerce(i32, globalThis)), 255)));
                return .{ .palette = idx };
            }
        }
        // Object RGB: { r: 255, g: 0, b: 0 }
        const r_val = try val.getTruthy(globalThis, "r");
        const g_val = try val.getTruthy(globalThis, "g");
        const b_val = try val.getTruthy(globalThis, "b");
        if (r_val != null and g_val != null and b_val != null) {
            const r: u8 = @intCast(@max(0, @min((try r_val.?.coerce(i32, globalThis)), 255)));
            const g: u8 = @intCast(@max(0, @min((try g_val.?.coerce(i32, globalThis)), 255)));
            const b: u8 = @intCast(@max(0, @min((try b_val.?.coerce(i32, globalThis)), 255)));
            return .{ .rgb = .{ .r = r, .g = g, .b = b } };
        }
    }
    return .none;
}

const bun = @import("bun");
const std = @import("std");
const jsc = bun.jsc;
