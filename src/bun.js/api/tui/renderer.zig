//! TuiRenderer — pure ANSI frame builder.
//! Diffs a TuiScreen into ANSI escape sequences using Ghostty's Page/Cell
//! for previous-frame buffer and u64 cell comparison.
//! No fd, no event loop, no ref-counting — just appends bytes to a caller-provided buffer.

const TuiRenderer = @This();

const ghostty = @import("ghostty").terminal;
const Page = ghostty.page.Page;
const Cell = ghostty.Cell;
const Style = ghostty.Style;
const size = ghostty.size;
const TuiScreen = @import("./screen.zig");

pub const CursorStyle = enum {
    default,
    block,
    underline,
    line,

    /// Return the DECSCUSR parameter for this cursor style.
    fn decscusr(this: CursorStyle, blinking: bool) u8 {
        return switch (this) {
            .default => 0,
            .block => if (blinking) @as(u8, 1) else 2,
            .underline => if (blinking) @as(u8, 3) else 4,
            .line => if (blinking) @as(u8, 5) else 6,
        };
    }
};

prev_page: ?Page = null,
cursor_x: size.CellCountInt = 0,
cursor_y: size.CellCountInt = 0,
current_style_id: size.StyleCountInt = 0,
current_hyperlink_id: u16 = 0,
has_rendered: bool = false,
prev_rows: size.CellCountInt = 0,
prev_hyperlink_ids: ?[]u16 = null,
current_cursor_style: CursorStyle = .default,
current_cursor_blinking: bool = false,
/// Set during render() to the target buffer. Not valid outside render().
buf: *std.ArrayList(u8) = undefined,
/// Inline mode state: number of content rows that have scrolled into
/// the terminal's scrollback buffer and are unreachable via cursor movement.
scrollback_rows: size.CellCountInt = 0,
/// The highest content row index that has been reached via LF emission.
/// Rows beyond this require LF (which scrolls) rather than CUD (which doesn't).
max_row_reached: size.CellCountInt = 0,
/// Terminal viewport height, used for inline mode scrollback tracking.
viewport_height: u16 = 0,
/// True when rendering in inline mode for this frame.
inline_mode: bool = false,

pub fn render(
    this: *TuiRenderer,
    buf: *std.ArrayList(u8),
    screen: *const TuiScreen,
    cursor_x: ?size.CellCountInt,
    cursor_y: ?size.CellCountInt,
    cursor_visible: ?bool,
    cursor_style: ?CursorStyle,
    cursor_blinking: ?bool,
) void {
    this.renderInner(buf, screen, cursor_x, cursor_y, cursor_visible, cursor_style, cursor_blinking, false, 0);
}

pub fn renderInline(
    this: *TuiRenderer,
    buf: *std.ArrayList(u8),
    screen: *const TuiScreen,
    cursor_x: ?size.CellCountInt,
    cursor_y: ?size.CellCountInt,
    cursor_visible: ?bool,
    cursor_style: ?CursorStyle,
    cursor_blinking: ?bool,
    viewport_height: u16,
) void {
    this.renderInner(buf, screen, cursor_x, cursor_y, cursor_visible, cursor_style, cursor_blinking, true, viewport_height);
}

fn renderInner(
    this: *TuiRenderer,
    buf: *std.ArrayList(u8),
    screen: *const TuiScreen,
    cursor_x: ?size.CellCountInt,
    cursor_y: ?size.CellCountInt,
    cursor_visible: ?bool,
    cursor_style: ?CursorStyle,
    cursor_blinking: ?bool,
    inline_mode: bool,
    viewport_height: u16,
) void {
    this.buf = buf;
    this.inline_mode = inline_mode;
    if (inline_mode and viewport_height > 0) {
        this.viewport_height = viewport_height;
    }

    this.emit(BSU);

    var need_full = !this.has_rendered or this.prev_page == null or
        (if (this.prev_page) |p| p.size.cols != screen.page.size.cols or p.size.rows != screen.page.size.rows else true);

    // In inline mode, check if any dirty rows are in scrollback (unreachable).
    // If so, force a full redraw of the visible portion.
    if (!need_full and inline_mode and this.scrollback_rows > 0) {
        need_full = this.hasScrollbackChanges(screen);
    }

    if (need_full) this.renderFull(screen) else this.renderDiff(screen);

    if (cursor_x != null or cursor_y != null) {
        this.moveTo(cursor_x orelse 0, cursor_y orelse 0);
    }
    if (cursor_visible) |visible| {
        if (visible) {
            this.emit("\x1b[?25h");
        } else {
            this.emit("\x1b[?25l");
        }
    }

    // Emit DECSCUSR if cursor style or blinking changed.
    const new_style = cursor_style orelse this.current_cursor_style;
    const new_blink = cursor_blinking orelse this.current_cursor_blinking;
    if (new_style != this.current_cursor_style or new_blink != this.current_cursor_blinking) {
        const param = new_style.decscusr(new_blink);
        var local_buf: [8]u8 = undefined;
        const seq = std.fmt.bufPrint(&local_buf, "\x1b[{d} q", .{@as(u32, param)}) catch unreachable;
        this.emit(seq);
        this.current_cursor_style = new_style;
        this.current_cursor_blinking = new_blink;
    }

    this.emit(ESU);

    this.swapScreens(screen);
    this.prev_rows = screen.page.size.rows;
    this.has_rendered = true;
}

pub fn clear(this: *TuiRenderer) void {
    if (this.prev_page) |*p| {
        p.deinit();
        this.prev_page = null;
    }
    this.cursor_x = 0;
    this.cursor_y = 0;
    this.current_style_id = 0;
    this.current_hyperlink_id = 0;
    this.has_rendered = false;
    this.prev_rows = 0;
    this.scrollback_rows = 0;
    this.max_row_reached = 0;
    if (this.prev_hyperlink_ids) |ids| {
        bun.default_allocator.free(ids);
        this.prev_hyperlink_ids = null;
    }
}

pub fn deinit(this: *TuiRenderer) void {
    if (this.prev_page) |*p| p.deinit();
    if (this.prev_hyperlink_ids) |ids| bun.default_allocator.free(ids);
}

/// Check if any cells in the scrollback region (unreachable rows) have changed.
fn hasScrollbackChanges(this: *const TuiRenderer, screen: *const TuiScreen) bool {
    const prev = &(this.prev_page orelse return true);
    var y: size.CellCountInt = 0;
    while (y < this.scrollback_rows and y < screen.page.size.rows) : (y += 1) {
        const row = screen.page.getRow(y);
        if (!row.dirty) continue;
        const cells = row.cells.ptr(screen.page.memory)[0..screen.page.size.cols];
        const prev_cells = prev.getRow(y).cells.ptr(prev.memory)[0..prev.size.cols];
        var x: size.CellCountInt = 0;
        while (x < screen.page.size.cols) : (x += 1) {
            if (@as(u64, @bitCast(cells[x])) != @as(u64, @bitCast(prev_cells[x]))) {
                return true;
            }
        }
    }
    return false;
}

// --- Rendering internals ---

fn renderFull(this: *TuiRenderer, screen: *const TuiScreen) void {
    this.emit("\x1b[?25l");

    // In inline mode, we can only move up to the first visible row.
    // scrollback_rows tracks how many content rows are unreachable.
    const start_y: size.CellCountInt = if (this.inline_mode) this.scrollback_rows else 0;

    if (this.has_rendered) {
        // Move cursor back to the start of our content region.
        const reachable_top = if (this.inline_mode) start_y else 0;
        if (this.cursor_y > reachable_top) {
            this.emitCSI(this.cursor_y - reachable_top, 'A');
        }
        this.emit("\r");
        this.cursor_x = 0;
        this.cursor_y = reachable_top;
    }
    this.current_style_id = 0;

    var first_visible = true;
    var y: size.CellCountInt = start_y;
    while (y < screen.page.size.rows) : (y += 1) {
        if (!first_visible) {
            // In inline mode, use LF to create new lines (scrolls viewport).
            // In fullscreen mode, \r\n also works since we don't use alt screen here.
            this.emit("\r\n");
        }
        first_visible = false;

        const cells = screen.page.getRow(y).cells.ptr(screen.page.memory)[0..screen.page.size.cols];

        var blank_cells: usize = 0;
        var x: size.CellCountInt = 0;
        while (x < screen.page.size.cols) : (x += 1) {
            const cell = cells[x];
            if (cell.wide == .spacer_tail) continue;

            if (cell.isEmpty() and !cell.hasStyling()) {
                blank_cells += 1;
                continue;
            }

            if (cell.codepoint() == ' ' and !cell.hasStyling()) {
                blank_cells += 1;
                continue;
            }

            if (blank_cells > 0) {
                var i: usize = 0;
                while (i < blank_cells) : (i += 1) this.emit(" ");
                blank_cells = 0;
            }

            this.transitionHyperlink(screen.hyperlinks.getId(x, y, screen.page.size.cols), screen);
            this.transitionStyle(cell.style_id, &screen.page);
            this.writeCell(cell, &screen.page);
        }
        if (this.current_hyperlink_id != 0) {
            this.emit("\x1b]8;;\x1b\\");
            this.current_hyperlink_id = 0;
        }
        this.emit("\x1b[K");
    }

    // Clear extra rows from previous render if content shrank.
    if (this.prev_rows > screen.page.size.rows) {
        var extra = this.prev_rows - screen.page.size.rows;
        while (extra > 0) : (extra -= 1) {
            this.emit("\r\n\x1b[2K");
        }
        this.emitCSI(this.prev_rows - screen.page.size.rows, 'A');
    }

    this.emit("\x1b[0m\x1b[?25h");
    this.current_style_id = 0;
    this.cursor_x = screen.page.size.cols;
    this.cursor_y = screen.page.size.rows -| 1;

    // Update inline mode scrollback tracking.
    if (this.inline_mode and this.viewport_height > 0) {
        if (this.cursor_y >= this.max_row_reached) {
            this.max_row_reached = this.cursor_y;
        }
        // Total content rows that have been pushed through the viewport.
        // Rows beyond viewport_height are in scrollback.
        if (this.max_row_reached +| 1 > this.viewport_height) {
            this.scrollback_rows = (this.max_row_reached +| 1) - this.viewport_height;
        }
    }
}

fn renderDiff(this: *TuiRenderer, screen: *const TuiScreen) void {
    const prev = &(this.prev_page orelse return);

    var y: size.CellCountInt = 0;
    while (y < screen.page.size.rows) : (y += 1) {
        const row = screen.page.getRow(y);
        if (!row.dirty) continue;

        const cells = row.cells.ptr(screen.page.memory)[0..screen.page.size.cols];
        const prev_cells = prev.getRow(y).cells.ptr(prev.memory)[0..prev.size.cols];

        var x: size.CellCountInt = 0;
        while (x < screen.page.size.cols) : (x += 1) {
            const cell = cells[x];
            if (cell.wide == .spacer_tail) continue;

            const cur_hid = screen.hyperlinks.getId(x, y, screen.page.size.cols);
            const prev_hid = if (this.prev_hyperlink_ids) |pids| blk: {
                const idx = @as(usize, y) * @as(usize, screen.page.size.cols) + @as(usize, x);
                break :blk if (idx < pids.len) pids[idx] else @as(u16, 0);
            } else @as(u16, 0);

            if (@as(u64, @bitCast(cell)) == @as(u64, @bitCast(prev_cells[x])) and cur_hid == prev_hid) continue;

            if (x != this.cursor_x or y != this.cursor_y) this.moveTo(x, y);
            this.transitionHyperlink(cur_hid, screen);
            this.transitionStyle(cell.style_id, &screen.page);
            this.writeCell(cell, &screen.page);
            this.cursor_x = x + if (cell.wide == .wide) @as(size.CellCountInt, 2) else @as(size.CellCountInt, 1);
            this.cursor_y = y;
        }
    }
}

fn swapScreens(this: *TuiRenderer, screen: *const TuiScreen) void {
    if (this.prev_page) |*p| {
        if (p.size.cols != screen.page.size.cols or p.size.rows != screen.page.size.rows) {
            p.deinit();
            this.prev_page = null;
        }
    }
    if (this.prev_page == null) {
        this.prev_page = Page.init(.{ .cols = screen.page.size.cols, .rows = screen.page.size.rows, .styles = 4096 }) catch return;
    }
    var prev = &(this.prev_page orelse return);

    var y: size.CellCountInt = 0;
    while (y < screen.page.size.rows) : (y += 1) {
        const src_row = screen.page.getRow(y);
        const src_cells = src_row.cells.ptr(screen.page.memory)[0..screen.page.size.cols];
        const dst_row = prev.getRow(y);
        const dst_cells = dst_row.cells.ptr(prev.memory)[0..prev.size.cols];
        @memcpy(dst_cells[0..screen.page.size.cols], src_cells);
        src_row.dirty = false;
        dst_row.dirty = false;
    }

    if (screen.hyperlinks.ids) |src_ids| {
        const count = @as(usize, screen.page.size.cols) * @as(usize, screen.page.size.rows);
        if (this.prev_hyperlink_ids) |prev_ids| {
            if (prev_ids.len != count) {
                bun.default_allocator.free(prev_ids);
                this.prev_hyperlink_ids = bun.default_allocator.alloc(u16, count) catch null;
            }
        } else {
            this.prev_hyperlink_ids = bun.default_allocator.alloc(u16, count) catch null;
        }
        if (this.prev_hyperlink_ids) |prev_ids| {
            @memcpy(prev_ids[0..count], src_ids[0..count]);
        }
    } else {
        if (this.prev_hyperlink_ids) |prev_ids| {
            @memset(prev_ids, 0);
        }
    }
}

// --- ANSI emission helpers ---

fn moveTo(this: *TuiRenderer, x: size.CellCountInt, y: size.CellCountInt) void {
    if (y > this.cursor_y) {
        if (this.inline_mode) {
            // In inline mode, use LF for downward movement.
            // LF scrolls the viewport when at the bottom, CUD does not.
            var n = y - this.cursor_y;
            while (n > 0) : (n -= 1) {
                this.emit("\n");
            }
            // After LF, cursor is at column 0. We need to account for this
            // when positioning X below.
            this.cursor_x = 0;
            // Update max_row_reached for scrollback tracking.
            if (y > this.max_row_reached) {
                this.max_row_reached = y;
                if (this.viewport_height > 0 and this.max_row_reached +| 1 > this.viewport_height) {
                    this.scrollback_rows = (this.max_row_reached +| 1) - this.viewport_height;
                }
            }
        } else {
            this.emitCSI(y - this.cursor_y, 'B');
        }
    } else if (y < this.cursor_y) {
        this.emitCSI(this.cursor_y - y, 'A');
    }

    if (x != this.cursor_x or y != this.cursor_y) {
        this.emit("\r");
        if (x > 0) this.emitCSI(x, 'C');
    }

    this.cursor_x = x;
    this.cursor_y = y;
}

fn emitCSI(this: *TuiRenderer, n: anytype, code: u8) void {
    var local_buf: [16]u8 = undefined;
    const seq = std.fmt.bufPrint(&local_buf, "\x1b[{d}{c}", .{ @as(u32, @intCast(n)), code }) catch return;
    this.emit(seq);
}

fn transitionHyperlink(this: *TuiRenderer, new_id: u16, screen: *const TuiScreen) void {
    if (new_id == this.current_hyperlink_id) return;
    if (new_id == 0) {
        this.emit("\x1b]8;;\x1b\\");
    } else {
        if (screen.hyperlinks.getUrl(new_id)) |url| {
            this.emit("\x1b]8;;");
            this.emit(url);
            this.emit("\x1b\\");
        }
    }
    this.current_hyperlink_id = new_id;
}

fn transitionStyle(this: *TuiRenderer, new_id: size.StyleCountInt, page: *const Page) void {
    if (new_id == this.current_style_id) return;
    if (new_id == 0) {
        this.emit("\x1b[0m");
        this.current_style_id = 0;
        return;
    }
    const s = page.styles.get(page.memory, new_id);
    this.emit("\x1b[0m");
    this.emitStyleSGR(s);
    this.current_style_id = new_id;
}

fn emitStyleSGR(this: *TuiRenderer, s: *const Style) void {
    if (s.flags.bold) this.emit("\x1b[1m");
    if (s.flags.faint) this.emit("\x1b[2m");
    if (s.flags.italic) this.emit("\x1b[3m");
    switch (s.flags.underline) {
        .none => {},
        .single => this.emit("\x1b[4m"),
        .double => this.emit("\x1b[4:2m"),
        .curly => this.emit("\x1b[4:3m"),
        .dotted => this.emit("\x1b[4:4m"),
        .dashed => this.emit("\x1b[4:5m"),
    }
    if (s.flags.blink) this.emit("\x1b[5m");
    if (s.flags.inverse) this.emit("\x1b[7m");
    if (s.flags.invisible) this.emit("\x1b[8m");
    if (s.flags.strikethrough) this.emit("\x1b[9m");
    if (s.flags.overline) this.emit("\x1b[53m");
    this.emitColor(s.fg_color, false);
    this.emitColor(s.bg_color, true);
    this.emitUnderlineColor(s.underline_color);
}

fn emitColor(this: *TuiRenderer, color: Style.Color, is_bg: bool) void {
    const base: u8 = if (is_bg) 48 else 38;
    switch (color) {
        .none => {},
        .palette => |idx| {
            var local_buf: [16]u8 = undefined;
            this.emit(std.fmt.bufPrint(&local_buf, "\x1b[{d};5;{d}m", .{ base, idx }) catch return);
        },
        .rgb => |rgb| {
            var local_buf: [24]u8 = undefined;
            this.emit(std.fmt.bufPrint(&local_buf, "\x1b[{d};2;{d};{d};{d}m", .{ base, rgb.r, rgb.g, rgb.b }) catch return);
        },
    }
}

fn emitUnderlineColor(this: *TuiRenderer, color: Style.Color) void {
    switch (color) {
        .none => {},
        .palette => |idx| {
            var local_buf: [16]u8 = undefined;
            this.emit(std.fmt.bufPrint(&local_buf, "\x1b[58;5;{d}m", .{idx}) catch return);
        },
        .rgb => |rgb| {
            var local_buf: [24]u8 = undefined;
            this.emit(std.fmt.bufPrint(&local_buf, "\x1b[58;2;{d};{d};{d}m", .{ rgb.r, rgb.g, rgb.b }) catch return);
        },
    }
}

fn writeCell(this: *TuiRenderer, cell: Cell, page: *const Page) void {
    switch (cell.content_tag) {
        .codepoint => {
            if (!cell.hasText()) {
                this.emit(" ");
                return;
            }
            var local_buf: [4]u8 = undefined;
            const len = bun.strings.encodeWTF8RuneT(&local_buf, u21, cell.content.codepoint);
            if (len == 0) {
                this.emit(" ");
                return;
            }
            this.emit(local_buf[0..len]);
        },
        .codepoint_grapheme => {
            if (!cell.hasText()) {
                this.emit(" ");
                return;
            }
            var local_buf: [4]u8 = undefined;
            const len = bun.strings.encodeWTF8RuneT(&local_buf, u21, cell.content.codepoint);
            if (len == 0) {
                this.emit(" ");
                return;
            }
            this.emit(local_buf[0..len]);
            if (page.lookupGrapheme(&cell)) |graphemes| {
                for (graphemes) |gcp| {
                    const glen = bun.strings.encodeWTF8RuneT(&local_buf, u21, gcp);
                    if (glen > 0) this.emit(local_buf[0..glen]);
                }
            }
        },
        .bg_color_palette, .bg_color_rgb => this.emit(" "),
    }
}

fn emit(this: *TuiRenderer, data: []const u8) void {
    this.buf.appendSlice(bun.default_allocator, data) catch {};
}

const BSU = "\x1b[?2026h";
const ESU = "\x1b[?2026l";

const bun = @import("bun");
const std = @import("std");
