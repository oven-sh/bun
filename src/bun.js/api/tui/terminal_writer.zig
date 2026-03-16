//! TuiTerminalWriter — JS-visible renderer that outputs ANSI to a file descriptor.
//!
//! Accepts `Bun.file()` (a file-backed Blob) as its argument.
//! If the Blob wraps a raw fd, uses it directly (owns_fd = false).
//! If the Blob wraps a path, opens the file (owns_fd = true).
//!
//! Lifetime: ref-counted so that in-flight async writes keep the object alive
//! even if JS drops all references. Refs are held by:
//!   1. JS side (released in finalize)
//!   2. In-flight write (ref in render, deref in onWriterWrite/onWriterError)
//!
//! Double-buffered: while the IOWriter drains `output`, new frames render into
//! `next_output`. On drain, if `next_output` has data, the buffers are swapped
//! and the next async write starts immediately.

const TuiTerminalWriter = @This();

pub const IOWriter = bun.io.BufferedWriter(TuiTerminalWriter, struct {
    pub const onWritable = TuiTerminalWriter.onWritable;
    pub const getBuffer = TuiTerminalWriter.getWriterBuffer;
    pub const onClose = TuiTerminalWriter.onWriterClose;
    pub const onError = TuiTerminalWriter.onWriterError;
    pub const onWrite = TuiTerminalWriter.onWriterWrite;
});

const RefCount = bun.ptr.RefCount(TuiTerminalWriter, "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const js = jsc.Codegen.JSTuiTerminalWriter;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

ref_count: RefCount,
renderer: TuiRenderer = .{},

fd: bun.FileDescriptor,
owns_fd: bool,
globalThis: *jsc.JSGlobalObject = undefined,
io_writer: IOWriter = .{},
event_loop: jsc.EventLoopHandle = undefined,
/// Buffer currently being drained by the IOWriter.
output: std.ArrayList(u8) = .{},
/// Receives the next rendered frame while `output` is in-flight.
next_output: std.ArrayList(u8) = .{},
write_offset: usize = 0,
/// True while the IOWriter is asynchronously draining `output`.
write_pending: bool = false,
/// True after close() / end() has been called.
closed: bool = false,
/// True if close() was called while a write is still pending.
closing: bool = false,
/// True while alternate screen mode is active.
alt_screen: bool = false,
/// JS callback for resize events.
onresize_callback: jsc.Strong.Optional = .empty,
/// Cached terminal dimensions for change detection.
cached_cols: u16 = 0,
cached_rows: u16 = 0,
/// True while mouse tracking is active.
mouse_tracking: bool = false,
/// True while focus tracking is active.
focus_tracking: bool = false,

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*TuiTerminalWriter {
    const arguments = callframe.arguments();
    if (arguments.len < 1)
        return globalThis.throw("TUITerminalWriter requires a Bun.file() argument", .{});

    const arg = arguments[0];

    const blob = arg.as(jsc.WebCore.Blob) orelse
        return globalThis.throw("TUITerminalWriter requires a Bun.file() argument", .{});
    if (!blob.needsToReadFile())
        return globalThis.throw("TUITerminalWriter requires a file-backed Blob (use Bun.file())", .{});

    const store = blob.store orelse
        return globalThis.throw("TUITerminalWriter: Blob has no backing store", .{});
    const pathlike = store.data.file.pathlike;

    var fd: bun.FileDescriptor = undefined;
    var owns_fd: bool = undefined;

    switch (pathlike) {
        .fd => |raw_fd| {
            fd = raw_fd;
            owns_fd = false;
        },
        .path => |path| {
            var path_buf: bun.PathBuffer = undefined;
            const result = bun.sys.open(path.sliceZ(&path_buf), bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o644);
            switch (result) {
                .result => |opened_fd| {
                    fd = opened_fd;
                    owns_fd = true;
                },
                .err => |err| {
                    return globalThis.throw("TUITerminalWriter: failed to open file: {f}", .{err});
                },
            }
        },
    }

    const this = bun.new(TuiTerminalWriter, .{
        .ref_count = .init(),
        .fd = fd,
        .owns_fd = owns_fd,
        .globalThis = globalThis,
        .event_loop = jsc.EventLoopHandle.init(globalThis.bunVM().eventLoop()),
    });
    this.io_writer.setParent(this);
    _ = this.io_writer.start(fd, true);
    this.io_writer.close_fd = false;
    this.io_writer.updateRef(this.event_loop, false);
    return this;
}

fn deinit(this: *TuiTerminalWriter) void {
    this.onresize_callback.deinit();
    this.renderer.deinit();
    this.io_writer.end();
    if (this.owns_fd) {
        _ = this.fd.close();
    }
    this.output.deinit(bun.default_allocator);
    this.next_output.deinit(bun.default_allocator);
    bun.destroy(this);
}

pub fn finalize(this: *TuiTerminalWriter) callconv(.c) void {
    this.deref();
}

pub fn eventLoop(this: *TuiTerminalWriter) jsc.EventLoopHandle {
    return this.event_loop;
}

pub fn loop(this: *TuiTerminalWriter) *bun.Async.Loop {
    if (comptime bun.Environment.isWindows) {
        return this.event_loop.loop().uv_loop;
    } else {
        return this.event_loop.loop();
    }
}

// --- BufferedWriter callbacks ---

pub fn getWriterBuffer(this: *TuiTerminalWriter) []const u8 {
    if (this.write_offset >= this.output.items.len) return &.{};
    return this.output.items[this.write_offset..];
}

pub fn onWriterWrite(this: *TuiTerminalWriter, amount: usize, status: bun.io.WriteStatus) void {
    this.write_offset += amount;

    const drained = status == .end_of_file or status == .drained or
        this.write_offset >= this.output.items.len;

    if (drained) {
        if (this.flushNextOutput()) return;
        this.io_writer.updateRef(this.event_loop, false);
        this.write_pending = false;
        if (this.closing) {
            this.closed = true;
            this.closing = false;
        }
        this.deref();
    }
}

pub fn onWriterError(this: *TuiTerminalWriter, _: bun.sys.Error) void {
    this.io_writer.updateRef(this.event_loop, false);
    this.write_offset = 0;
    this.output.clearRetainingCapacity();
    this.next_output.clearRetainingCapacity();
    this.write_pending = false;
    if (this.closing) {
        this.closed = true;
        this.closing = false;
    }
    this.deref();
}

pub fn onWriterClose(_: *TuiTerminalWriter) void {}

pub fn onWritable(this: *TuiTerminalWriter) void {
    _ = this.flushNextOutput();
}

/// If `next_output` has queued data, swap it into `output` and start the next
/// async write. Returns true if a new write was kicked off.
fn flushNextOutput(this: *TuiTerminalWriter) bool {
    if (this.next_output.items.len == 0) return false;

    this.output.clearRetainingCapacity();
    const tmp = this.output;
    this.output = this.next_output;
    this.next_output = tmp;

    this.write_offset = 0;
    this.io_writer.write();
    return true;
}

// --- render ---

/// render(screen, options?)
pub fn render(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});

    // Check for resize before rendering.
    this.checkResize();

    const arguments = callframe.arguments();
    if (arguments.len < 1) return globalThis.throw("render requires a Screen argument", .{});
    const screen = TuiScreen.fromJS(arguments[0]) orelse
        return globalThis.throw("render: argument must be a TUIScreen", .{});

    // Parse optional cursor options
    var cursor_x: ?size.CellCountInt = null;
    var cursor_y: ?size.CellCountInt = null;
    var cursor_visible: ?bool = null;
    var cursor_style: ?CursorStyle = null;
    var cursor_blinking: ?bool = null;
    var use_inline = false;
    if (arguments.len > 1 and arguments[1].isObject()) {
        const opts = arguments[1];
        if (try opts.getTruthy(globalThis, "cursorX")) |v| {
            const val = try v.coerce(i32, globalThis);
            cursor_x = @intCast(@max(0, @min(val, screen.page.size.cols -| 1)));
        }
        if (try opts.getTruthy(globalThis, "cursorY")) |v| {
            const val = try v.coerce(i32, globalThis);
            cursor_y = @intCast(@max(0, @min(val, screen.page.size.rows -| 1)));
        }
        if (try opts.getTruthy(globalThis, "cursorVisible")) |v| {
            if (v.isBoolean()) cursor_visible = v.asBoolean();
        }
        if (try opts.getTruthy(globalThis, "cursorStyle")) |v| {
            cursor_style = parseCursorStyle(v, globalThis);
        }
        if (try opts.getTruthy(globalThis, "cursorBlinking")) |v| {
            if (v.isBoolean()) cursor_blinking = v.asBoolean();
        }
        if (try opts.getTruthy(globalThis, "inline")) |v| {
            if (v.isBoolean()) use_inline = v.asBoolean();
        }
    }

    // Get viewport height for inline mode.
    const viewport_h: u16 = if (use_inline) blk: {
        break :blk switch (bun.sys.getWinsize(this.fd)) {
            .result => |ws| ws.row,
            .err => 24,
        };
    } else 0;

    // Async double-buffered write.
    if (this.write_pending) {
        this.next_output.clearRetainingCapacity();
        if (use_inline) {
            this.renderer.renderInline(&this.next_output, screen, cursor_x, cursor_y, cursor_visible, cursor_style, cursor_blinking, viewport_h);
        } else {
            this.renderer.render(&this.next_output, screen, cursor_x, cursor_y, cursor_visible, cursor_style, cursor_blinking);
        }
    } else {
        this.output.clearRetainingCapacity();
        if (use_inline) {
            this.renderer.renderInline(&this.output, screen, cursor_x, cursor_y, cursor_visible, cursor_style, cursor_blinking, viewport_h);
        } else {
            this.renderer.render(&this.output, screen, cursor_x, cursor_y, cursor_visible, cursor_style, cursor_blinking);
        }
        if (this.output.items.len > 0) {
            this.write_offset = 0;
            this.write_pending = true;
            this.ref();
            this.io_writer.updateRef(this.event_loop, true);
            this.io_writer.write();
        }
    }

    return .js_undefined;
}

/// clear()
pub fn clear(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    this.renderer.clear();
    return .js_undefined;
}

/// close()
pub fn close(this: *TuiTerminalWriter, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return .js_undefined;
    // Auto-disable tracking modes on close.
    if (this.mouse_tracking) {
        this.writeRaw("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
        this.mouse_tracking = false;
    }
    if (this.focus_tracking) {
        this.writeRaw("\x1b[?1004l");
        this.focus_tracking = false;
    }
    // Auto-exit alternate screen on close.
    if (this.alt_screen) {
        this.writeRaw("\x1b[?1049l");
        this.alt_screen = false;
    }
    if (this.write_pending) {
        this.closing = true;
    } else {
        this.closed = true;
    }
    this.renderer.clear();
    return .js_undefined;
}

/// end() — alias for close()
pub fn end(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.close(globalThis, callframe);
}

// --- Alternate Screen ---

/// enterAltScreen()
pub fn enterAltScreen(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    if (this.alt_screen) return .js_undefined;
    this.alt_screen = true;
    this.writeRaw("\x1b[?1049h");
    this.renderer.clear(); // Reset diff state for alt screen.
    return .js_undefined;
}

/// exitAltScreen()
pub fn exitAltScreen(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    if (this.alt_screen) {
        this.writeRaw("\x1b[?1049l");
        this.alt_screen = false;
        this.renderer.clear();
    }
    return .js_undefined;
}

// --- Mouse Tracking ---

/// enableMouseTracking() — enable SGR mouse mode
pub fn enableMouseTracking(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    if (this.mouse_tracking) return .js_undefined;
    this.mouse_tracking = true;
    // Enable: button events + SGR encoding + any-event tracking
    this.writeRaw("\x1b[?1000h\x1b[?1002h\x1b[?1003h\x1b[?1006h");
    return .js_undefined;
}

/// disableMouseTracking()
pub fn disableMouseTracking(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    if (!this.mouse_tracking) return .js_undefined;
    this.mouse_tracking = false;
    this.writeRaw("\x1b[?1006l\x1b[?1003l\x1b[?1002l\x1b[?1000l");
    return .js_undefined;
}

// --- Focus Tracking ---

/// enableFocusTracking()
pub fn enableFocusTracking(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    if (this.focus_tracking) return .js_undefined;
    this.focus_tracking = true;
    this.writeRaw("\x1b[?1004h");
    return .js_undefined;
}

/// disableFocusTracking()
pub fn disableFocusTracking(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    if (!this.focus_tracking) return .js_undefined;
    this.focus_tracking = false;
    this.writeRaw("\x1b[?1004l");
    return .js_undefined;
}

// --- Bracketed Paste ---

/// enableBracketedPaste()
pub fn enableBracketedPaste(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    this.writeRaw("\x1b[?2004h");
    return .js_undefined;
}

/// disableBracketedPaste()
pub fn disableBracketedPaste(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    this.writeRaw("\x1b[?2004l");
    return .js_undefined;
}

/// write(string) — write raw string bytes to the terminal
pub fn write(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUITerminalWriter is closed", .{});
    const arguments = callframe.arguments();
    if (arguments.len < 1 or !arguments[0].isString())
        return globalThis.throw("write requires a string argument", .{});

    const str = try arguments[0].toSliceClone(globalThis);
    defer str.deinit();
    this.writeRaw(str.slice());
    return .js_undefined;
}

// --- Resize ---

pub fn setOnResize(this: *TuiTerminalWriter, globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    if (value.isCallable()) {
        this.onresize_callback = jsc.Strong.Optional.create(value, globalThis);
        // Initialize cached dimensions on first set.
        if (this.cached_cols == 0) {
            switch (bun.sys.getWinsize(this.fd)) {
                .result => |ws| {
                    this.cached_cols = ws.col;
                    this.cached_rows = ws.row;
                },
                .err => {
                    this.cached_cols = 80;
                    this.cached_rows = 24;
                },
            }
        }
        // Install the global SIGWINCH handler if not already installed.
        SigwinchHandler.install();
    } else if (value.isUndefinedOrNull()) {
        this.onresize_callback.deinit();
    }
}

pub fn getOnResize(this: *TuiTerminalWriter, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return this.onresize_callback.get() orelse .js_undefined;
}

/// Check if terminal size changed (called from render path).
fn checkResize(this: *TuiTerminalWriter) void {
    if (this.onresize_callback.get() == null) return;
    if (!SigwinchHandler.consume()) return;

    switch (bun.sys.getWinsize(this.fd)) {
        .result => |ws| {
            if (ws.col != this.cached_cols or ws.row != this.cached_rows) {
                this.cached_cols = ws.col;
                this.cached_rows = ws.row;
                this.dispatchResize(ws.col, ws.row);
            }
        },
        .err => {},
    }
}

fn dispatchResize(this: *TuiTerminalWriter, cols: u16, rows: u16) void {
    const callback = this.onresize_callback.get() orelse return;
    const globalThis = this.globalThis;
    globalThis.bunVM().eventLoop().runCallback(
        callback,
        globalThis,
        .js_undefined,
        &.{
            jsc.JSValue.jsNumber(@as(i32, @intCast(cols))),
            jsc.JSValue.jsNumber(@as(i32, @intCast(rows))),
        },
    );
}

/// Global SIGWINCH handler — uses a static atomic flag.
const SigwinchHandler = struct {
    var flag: std.atomic.Value(bool) = .init(false);
    var installed: bool = false;

    fn install() void {
        if (installed) return;
        installed = true;

        if (comptime !bun.Environment.isWindows) {
            const act = std.posix.Sigaction{
                .handler = .{ .handler = handler },
                .mask = std.posix.sigemptyset(),
                .flags = std.posix.SA.RESTART,
            };
            std.posix.sigaction(std.posix.SIG.WINCH, &act, null);
        }
    }

    fn handler(_: c_int) callconv(.c) void {
        flag.store(true, .release);
    }

    fn consume() bool {
        return flag.swap(false, .acq_rel);
    }
};

// --- Getters ---

pub fn getCursorX(this: *const TuiTerminalWriter, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(i32, @intCast(this.renderer.cursor_x)));
}

pub fn getCursorY(this: *const TuiTerminalWriter, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(i32, @intCast(this.renderer.cursor_y)));
}

pub fn getColumns(this: *const TuiTerminalWriter, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return switch (bun.sys.getWinsize(this.fd)) {
        .result => |ws| jsc.JSValue.jsNumber(@as(i32, @intCast(ws.col))),
        .err => jsc.JSValue.jsNumber(@as(i32, 80)),
    };
}

pub fn getRows(this: *const TuiTerminalWriter, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return switch (bun.sys.getWinsize(this.fd)) {
        .result => |ws| jsc.JSValue.jsNumber(@as(i32, @intCast(ws.row))),
        .err => jsc.JSValue.jsNumber(@as(i32, 24)),
    };
}

// --- Helpers ---

fn parseCursorStyle(value: jsc.JSValue, globalThis: *jsc.JSGlobalObject) ?CursorStyle {
    const str = value.toSliceClone(globalThis) catch return null;
    defer str.deinit();
    return cursor_style_map.get(str.slice());
}

const cursor_style_map = bun.ComptimeEnumMap(CursorStyle);

/// Write raw bytes directly to the IOWriter (for alt screen, etc.).
fn writeRaw(this: *TuiTerminalWriter, data: []const u8) void {
    if (this.write_pending) {
        this.next_output.appendSlice(bun.default_allocator, data) catch {};
    } else {
        this.output.clearRetainingCapacity();
        this.output.appendSlice(bun.default_allocator, data) catch {};
        this.write_offset = 0;
        this.write_pending = true;
        this.ref();
        this.io_writer.updateRef(this.event_loop, true);
        this.io_writer.write();
    }
}

const TuiScreen = @import("./screen.zig");
const std = @import("std");

const TuiRenderer = @import("./renderer.zig");
const CursorStyle = TuiRenderer.CursorStyle;

const bun = @import("bun");
const jsc = bun.jsc;

const ghostty = @import("ghostty").terminal;
const size = ghostty.size;
