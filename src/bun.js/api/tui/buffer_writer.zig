//! TuiBufferWriter — JS-visible renderer that writes ANSI into a caller-owned ArrayBuffer.
//!
//! `render()` writes from byte 0, truncates if frame > capacity, returns total
//! rendered byte count.
//!
//! Read-only getters:
//!   - `byteOffset` = min(rendered_len, capacity) — position after last write
//!   - `byteLength` = total rendered bytes (may exceed capacity, signals truncation)
//!
//! `close()` / `end()` — clear renderer, release buffer ref, throw on future `render()`.

const TuiBufferWriter = @This();

const TuiRenderer = @import("./renderer.zig");
const TuiScreen = @import("./screen.zig");
const CursorStyle = TuiRenderer.CursorStyle;

const ghostty = @import("ghostty").terminal;
const size = ghostty.size;

pub const js = jsc.Codegen.JSTuiBufferWriter;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

renderer: TuiRenderer = .{},
/// Internal buffer used by TuiRenderer, then copied into the ArrayBuffer.
output: std.ArrayList(u8) = .{},
/// True after close() / end() has been called.
closed: bool = false,
/// Number of bytes actually copied into the ArrayBuffer (min of rendered, capacity).
byte_offset: usize = 0,
/// Total number of rendered bytes (may exceed capacity).
byte_length: usize = 0,

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame, this_value: jsc.JSValue) bun.JSError!*TuiBufferWriter {
    const arguments = callframe.arguments();
    if (arguments.len < 1)
        return globalThis.throw("TUIBufferWriter requires an ArrayBuffer or TypedArray argument", .{});

    const arg = arguments[0];

    // Buffer mode: ArrayBuffer or TypedArray
    if (arg.asArrayBuffer(globalThis) == null)
        return globalThis.throw("TUIBufferWriter requires an ArrayBuffer or TypedArray argument", .{});

    const this = bun.new(TuiBufferWriter, .{});
    // Store the ArrayBuffer on the JS object via GC-traced write barrier.
    js.gc.set(.buffer, this_value, globalThis, arg);
    return this;
}

fn deinit(this: *TuiBufferWriter) void {
    this.renderer.deinit();
    this.output.deinit(bun.default_allocator);
    bun.destroy(this);
}

pub fn finalize(this: *TuiBufferWriter) callconv(.c) void {
    deinit(this);
}

// --- render ---

/// render(screen, options?)
/// Copies ANSI frame into the ArrayBuffer, returns total rendered byte count.
pub fn render(this: *TuiBufferWriter, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUIBufferWriter is closed", .{});

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
    }

    const ab_val = js.gc.get(.buffer, callframe.this()) orelse
        return globalThis.throw("render: ArrayBuffer has been detached", .{});
    const ab = ab_val.asArrayBuffer(globalThis) orelse
        return globalThis.throw("render: ArrayBuffer has been detached", .{});
    const dest = ab.byteSlice();
    if (dest.len == 0)
        return globalThis.throw("render: ArrayBuffer is empty", .{});

    this.output.clearRetainingCapacity();
    this.renderer.render(&this.output, screen, cursor_x, cursor_y, cursor_visible, cursor_style, cursor_blinking);

    const total_len = this.output.items.len;
    const copy_len = @min(total_len, dest.len);
    @memcpy(dest[0..copy_len], this.output.items[0..copy_len]);

    this.byte_offset = copy_len;
    this.byte_length = total_len;

    return jsc.JSValue.jsNumber(copy_len);
}

/// clear()
pub fn clear(this: *TuiBufferWriter, globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return globalThis.throw("TUIBufferWriter is closed", .{});
    this.renderer.clear();
    this.byte_offset = 0;
    this.byte_length = 0;
    return .js_undefined;
}

/// close()
pub fn close(this: *TuiBufferWriter, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (this.closed) return .js_undefined;
    this.closed = true;
    this.renderer.clear();
    this.byte_offset = 0;
    this.byte_length = 0;
    return .js_undefined;
}

/// end() — alias for close()
pub fn end(this: *TuiBufferWriter, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    return this.close(globalThis, callframe);
}

// --- Getters ---

pub fn getCursorX(this: *const TuiBufferWriter, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(i32, @intCast(this.renderer.cursor_x)));
}

pub fn getCursorY(this: *const TuiBufferWriter, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(i32, @intCast(this.renderer.cursor_y)));
}

pub fn getByteOffset(this: *const TuiBufferWriter, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(i32, @intCast(this.byte_offset)));
}

pub fn getByteLength(this: *const TuiBufferWriter, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return jsc.JSValue.jsNumber(@as(i32, @intCast(this.byte_length)));
}

// --- Helpers ---

fn parseCursorStyle(value: jsc.JSValue, globalThis: *jsc.JSGlobalObject) ?CursorStyle {
    const str = value.toSliceClone(globalThis) catch return null;
    defer str.deinit();
    return cursor_style_map.get(str.slice());
}

const cursor_style_map = bun.ComptimeEnumMap(CursorStyle);

const bun = @import("bun");
const std = @import("std");
const jsc = bun.jsc;
