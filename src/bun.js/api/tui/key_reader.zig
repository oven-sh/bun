//! TuiKeyReader — reads stdin in raw mode, parses escape sequences via
//! Ghostty's VT parser, and delivers structured key events to JS callbacks.

const TuiKeyReader = @This();

const RefCount = bun.ptr.RefCount(TuiKeyReader, "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

pub const js = jsc.Codegen.JSTuiKeyReader;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub const IOReader = bun.io.BufferedReader;

ref_count: RefCount,
reader: IOReader = IOReader.init(TuiKeyReader),
parser: Parser = Parser.init(),
event_loop_handle: jsc.EventLoopHandle = undefined,
globalThis: *jsc.JSGlobalObject = undefined,
stdin_fd: bun.FileDescriptor = undefined,

/// JS callbacks stored as Strong.Optional refs.
onkeypress_callback: jsc.Strong.Optional = .empty,
onpaste_callback: jsc.Strong.Optional = .empty,
onmouse_callback: jsc.Strong.Optional = .empty,
onfocus_callback: jsc.Strong.Optional = .empty,
onblur_callback: jsc.Strong.Optional = .empty,

/// Bracketed paste accumulation buffer.
paste_buf: std.ArrayList(u8) = .{},

/// SGR mouse sequence accumulation buffer.
mouse_buf: [32]u8 = undefined,
mouse_len: u8 = 0,

flags: Flags = .{},

const Flags = packed struct {
    closed: bool = false,
    reader_done: bool = false,
    in_paste: bool = false,
    is_tty: bool = false,
    /// Set when ESC O (SS3) was received; the next char is the SS3 payload.
    ss3_pending: bool = false,
    /// Set when bare ESC was received; the next char is alt+char.
    esc_pending: bool = false,
    /// Set when we're accumulating an SGR mouse event sequence.
    in_mouse: bool = false,
    /// Mode sequences enabled via constructor options.
    bracketed_paste: bool = false,
    focus_events: bool = false,
    kitty_keyboard: bool = false,
    _padding: u6 = 0,
};

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*TuiKeyReader {
    if (comptime bun.Environment.isWindows) {
        return globalThis.throw("TUIKeyReader is not supported on Windows", .{});
    }

    const arguments = callframe.arguments();

    const stdin_fd = bun.FD.fromNative(0);

    // Set raw mode if stdin is a TTY.
    const is_tty = std.posix.isatty(0);
    if (is_tty) {
        if (Bun__ttySetMode(0, 1) != 0)
            return globalThis.throw("Failed to set raw mode on stdin", .{});
    }

    // Parse optional constructor options.
    var want_bracketed_paste = false;
    var want_focus_events = false;
    var want_kitty_keyboard = false;
    if (arguments.len > 0 and arguments[0].isObject()) {
        const opts = arguments[0];
        if (try opts.getTruthy(globalThis, "bracketedPaste")) |v| {
            if (v.isBoolean()) want_bracketed_paste = v.asBoolean();
        }
        if (try opts.getTruthy(globalThis, "focusEvents")) |v| {
            if (v.isBoolean()) want_focus_events = v.asBoolean();
        }
        if (try opts.getTruthy(globalThis, "kittyKeyboard")) |v| {
            if (v.isBoolean()) want_kitty_keyboard = v.asBoolean();
        }
    }

    const this = bun.new(TuiKeyReader, .{
        .ref_count = .init(),
        .event_loop_handle = jsc.EventLoopHandle.init(globalThis.bunVM().eventLoop()),
        .globalThis = globalThis,
        .stdin_fd = stdin_fd,
        .flags = .{
            .is_tty = is_tty,
            .bracketed_paste = want_bracketed_paste,
            .focus_events = want_focus_events,
            .kitty_keyboard = want_kitty_keyboard,
        },
    });
    this.reader.setParent(this);

    switch (this.reader.start(stdin_fd, true)) {
        .result => {},
        .err => {
            _ = Bun__ttySetMode(0, 0);
            bun.destroy(this);
            return globalThis.throw("Failed to start reading stdin", .{});
        },
    }
    this.reader.flags.close_handle = false; // Do NOT close stdin.
    // Don't call reader.read() here — defer until onkeypress callback is set,
    // otherwise the initial read may consume data before JS has a chance to
    // set up its callback handler.

    // Write mode-enabling sequences to stdout.
    this.enableModes();

    return this;
}

fn deinit(this: *TuiKeyReader) void {
    this.onkeypress_callback.deinit();
    this.onpaste_callback.deinit();
    this.onmouse_callback.deinit();
    this.onfocus_callback.deinit();
    this.onblur_callback.deinit();
    if (!this.flags.closed) {
        this.disableModes();
        if (this.flags.is_tty) _ = Bun__ttySetMode(0, 0);
        this.flags.closed = true;
        this.reader.deinit();
    }
    this.parser.deinit();
    this.paste_buf.deinit(bun.default_allocator);
    bun.destroy(this);
}

pub fn finalize(this: *TuiKeyReader) callconv(.c) void {
    if (!this.flags.closed) {
        this.disableModes();
        if (this.flags.is_tty) _ = Bun__ttySetMode(0, 0);
        this.flags.closed = true;
        this.reader.close();
    }
    this.deref();
}

pub fn eventLoop(this: *TuiKeyReader) jsc.EventLoopHandle {
    return this.event_loop_handle;
}

pub fn loop(this: *TuiKeyReader) *bun.Async.Loop {
    if (comptime bun.Environment.isWindows) {
        return this.event_loop_handle.loop().uv_loop;
    } else {
        return this.event_loop_handle.loop();
    }
}

// --- BufferedReader callbacks ---

pub fn onReadChunk(this: *TuiKeyReader, chunk: []const u8, _: bun.io.ReadState) bool {
    this.processInput(chunk);
    return true;
}

pub fn onReaderDone(this: *TuiKeyReader) void {
    if (!this.flags.reader_done) {
        this.flags.reader_done = true;
    }
}

pub fn onReaderError(this: *TuiKeyReader, _: bun.sys.Error) void {
    if (!this.flags.reader_done) {
        this.flags.reader_done = true;
    }
}

// --- JS methods ---

pub fn close(this: *TuiKeyReader, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    if (!this.flags.closed) {
        this.disableModes();
        if (this.flags.is_tty) _ = Bun__ttySetMode(0, 0);
        this.flags.closed = true;
        this.reader.close();
    }
    return .js_undefined;
}

pub fn setOnKeypress(this: *TuiKeyReader, globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    const was_empty = this.onkeypress_callback.get() == null;
    if (value.isCallable()) {
        this.onkeypress_callback = jsc.Strong.Optional.create(value, globalThis);
        // Start reading on first callback set.
        if (was_empty and !this.flags.closed) {
            this.reader.read();
        }
    } else if (value.isUndefinedOrNull()) {
        this.onkeypress_callback.deinit();
    }
}

pub fn getOnKeypress(this: *TuiKeyReader, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return this.onkeypress_callback.get() orelse .js_undefined;
}

pub fn setOnPaste(this: *TuiKeyReader, globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    if (value.isCallable()) {
        this.onpaste_callback = jsc.Strong.Optional.create(value, globalThis);
    } else if (value.isUndefinedOrNull()) {
        this.onpaste_callback.deinit();
    }
}

pub fn getOnPaste(this: *TuiKeyReader, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return this.onpaste_callback.get() orelse .js_undefined;
}

pub fn setOnMouse(this: *TuiKeyReader, globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    if (value.isCallable()) {
        this.onmouse_callback = jsc.Strong.Optional.create(value, globalThis);
        // Start reading on first callback set.
        if (!this.flags.closed) {
            this.reader.read();
        }
    } else if (value.isUndefinedOrNull()) {
        this.onmouse_callback.deinit();
    }
}

pub fn getOnMouse(this: *TuiKeyReader, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return this.onmouse_callback.get() orelse .js_undefined;
}

pub fn setOnFocus(this: *TuiKeyReader, globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    if (value.isCallable()) {
        this.onfocus_callback = jsc.Strong.Optional.create(value, globalThis);
    } else if (value.isUndefinedOrNull()) {
        this.onfocus_callback.deinit();
    }
}

pub fn getOnFocus(this: *TuiKeyReader, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return this.onfocus_callback.get() orelse .js_undefined;
}

pub fn setOnBlur(this: *TuiKeyReader, globalThis: *jsc.JSGlobalObject, value: jsc.JSValue) void {
    if (value.isCallable()) {
        this.onblur_callback = jsc.Strong.Optional.create(value, globalThis);
    } else if (value.isUndefinedOrNull()) {
        this.onblur_callback.deinit();
    }
}

pub fn getOnBlur(this: *TuiKeyReader, _: *jsc.JSGlobalObject) callconv(.c) jsc.JSValue {
    return this.onblur_callback.get() orelse .js_undefined;
}

// --- Terminal mode sequences ---

/// Write mode-enabling escape sequences to stdout for modes requested
/// in the constructor options. Written to stdout (fd 1) regardless of
/// whether stdin is a TTY, since the user explicitly requested them.
fn enableModes(this: *const TuiKeyReader) void {
    var buf: [64]u8 = undefined;
    var pos: usize = 0;
    if (this.flags.bracketed_paste) {
        const seq = "\x1b[?2004h";
        @memcpy(buf[pos..][0..seq.len], seq);
        pos += seq.len;
    }
    if (this.flags.focus_events) {
        const seq = "\x1b[?1004h";
        @memcpy(buf[pos..][0..seq.len], seq);
        pos += seq.len;
    }
    if (this.flags.kitty_keyboard) {
        const seq = "\x1b[>1u";
        @memcpy(buf[pos..][0..seq.len], seq);
        pos += seq.len;
    }
    if (pos > 0) {
        _ = bun.sys.write(bun.FD.fromNative(1), buf[0..pos]);
    }
}

/// Write mode-disabling escape sequences to stdout. Called from close/deinit.
fn disableModes(this: *TuiKeyReader) void {
    var buf: [64]u8 = undefined;
    var pos: usize = 0;
    // Disable in reverse order of enabling.
    if (this.flags.kitty_keyboard) {
        const seq = "\x1b[<u";
        @memcpy(buf[pos..][0..seq.len], seq);
        pos += seq.len;
        this.flags.kitty_keyboard = false;
    }
    if (this.flags.focus_events) {
        const seq = "\x1b[?1004l";
        @memcpy(buf[pos..][0..seq.len], seq);
        pos += seq.len;
        this.flags.focus_events = false;
    }
    if (this.flags.bracketed_paste) {
        const seq = "\x1b[?2004l";
        @memcpy(buf[pos..][0..seq.len], seq);
        pos += seq.len;
        this.flags.bracketed_paste = false;
    }
    if (pos > 0) {
        _ = bun.sys.write(bun.FD.fromNative(1), buf[0..pos]);
    }
}

// --- Input processing via Ghostty parser ---

fn processInput(this: *TuiKeyReader, data: []const u8) void {
    var i: usize = 0;
    while (i < data.len) {
        const byte = data[i];

        // 0x7F (DEL) is ignored by the VT parser — handle it directly as backspace.
        if (byte == 0x7f) {
            if (this.flags.in_paste) {
                this.paste_buf.append(bun.default_allocator, byte) catch {};
            } else {
                this.emitKeypress("backspace", &.{0x7f}, false, false, false);
            }
            i += 1;
            continue;
        }

        // UTF-8 multi-byte sequences: the raw VT parser doesn't handle these.
        // Decode them and emit as print events directly.
        if (byte >= 0xC0) {
            const seq_len = bun.strings.utf8ByteSequenceLength(byte);
            if (i + seq_len <= data.len) {
                const seq = data[i .. i + seq_len];
                var seq_bytes = [4]u8{ seq[0], 0, 0, 0 };
                if (seq_len > 1) seq_bytes[1] = seq[1];
                if (seq_len > 2) seq_bytes[2] = seq[2];
                if (seq_len > 3) seq_bytes[3] = seq[3];
                const decoded = bun.strings.decodeWTF8RuneT(&seq_bytes, seq_len, u21, 0xFFFD);
                if (decoded == 0xFFFD) {
                    i += 1;
                    continue;
                }
                if (this.flags.in_paste) {
                    this.paste_buf.appendSlice(bun.default_allocator, seq) catch {};
                } else if (this.flags.esc_pending) {
                    this.flags.esc_pending = false;
                    this.emitPrintChar(decoded, true);
                } else {
                    this.emitPrintChar(decoded, false);
                }
                i += seq_len;
                continue;
            }
            i += 1; // Incomplete UTF-8 at end.
            continue;
        }

        // Continuation bytes (0x80-0xBF) — skip stray ones.
        if (byte >= 0x80) {
            i += 1;
            continue;
        }

        // ASCII: feed through the Ghostty VT parser.
        const actions = this.parser.next(byte);
        for (&actions) |maybe_action| {
            const action = maybe_action orelse continue;
            this.handleAction(action, byte);
        }
        i += 1;
    }
}

fn emitPrintChar(this: *TuiKeyReader, cp: u21, alt: bool) void {
    var buf: [4]u8 = undefined;
    const len = bun.strings.encodeWTF8RuneT(&buf, u21, cp);
    if (len == 0) return;
    this.emitKeypress(buf[0..len], buf[0..len], false, false, alt);
}

fn handleAction(this: *TuiKeyReader, action: Action, raw_byte: u8) void {
    _ = raw_byte;

    switch (action) {
        .print => |cp| {
            // Check if we're in SS3 mode (previous was ESC O).
            if (this.flags.ss3_pending) {
                this.flags.ss3_pending = false;
                const name: []const u8 = switch (cp) {
                    'P' => "f1",
                    'Q' => "f2",
                    'R' => "f3",
                    'S' => "f4",
                    'A' => "up",
                    'B' => "down",
                    'C' => "right",
                    'D' => "left",
                    'H' => "home",
                    'F' => "end",
                    else => return,
                };
                this.emitKeypress(name, name, false, false, false);
                return;
            }

            // Check if previous was a bare ESC (alt prefix).
            if (this.flags.esc_pending) {
                this.flags.esc_pending = false;
                var buf: [4]u8 = undefined;
                const len = bun.strings.encodeWTF8RuneT(&buf, u21, cp);
                if (len == 0) return;
                this.emitKeypress(buf[0..len], buf[0..len], false, false, true);
                return;
            }

            // Printable character.
            if (this.flags.in_paste) {
                var buf: [4]u8 = undefined;
                const len = bun.strings.encodeWTF8RuneT(&buf, u21, cp);
                if (len == 0) return;
                this.paste_buf.appendSlice(bun.default_allocator, buf[0..len]) catch {};
                return;
            }
            var buf: [4]u8 = undefined;
            const len = bun.strings.encodeWTF8RuneT(&buf, u21, cp);
            if (len == 0) return;
            this.emitKeypress(buf[0..len], buf[0..len], false, false, false);
        },

        .execute => |c| {
            // If bare ESC was pending, consume it — this is just a control char after ESC.
            if (this.flags.esc_pending) {
                this.flags.esc_pending = false;
                const result = executeToKey(c);
                this.emitKeypress(result.name, &.{c}, result.ctrl, false, true);
                return;
            }

            // C0 control character.
            if (this.flags.in_paste) {
                this.paste_buf.append(bun.default_allocator, c) catch {};
                return;
            }
            const result = executeToKey(c);
            this.emitKeypress(result.name, &.{c}, result.ctrl, false, false);
        },

        .csi_dispatch => |csi| {
            // Clear any pending ESC state (CSI follows ESC [).
            this.flags.esc_pending = false;
            this.flags.ss3_pending = false;
            this.handleCSI(csi);
        },

        .esc_dispatch => |esc| {
            this.handleESC(esc);
        },

        else => {},
    }
}

fn handleCSI(this: *TuiKeyReader, csi: Action.CSI) void {
    // Check for bracketed paste start/end.
    if (csi.final == '~' and csi.params.len >= 1) {
        if (csi.params[0] == 200) {
            this.flags.in_paste = true;
            this.paste_buf.clearRetainingCapacity();
            return;
        }
        if (csi.params[0] == 201) {
            this.flags.in_paste = false;
            this.emitPaste();
            return;
        }
    }

    if (this.flags.in_paste) return;

    // Focus events: CSI I (focus in), CSI O (focus out).
    if (csi.final == 'I' and csi.params.len == 0 and csi.intermediates.len == 0) {
        this.emitFocus(true);
        return;
    }
    if (csi.final == 'O' and csi.params.len == 0 and csi.intermediates.len == 0) {
        this.emitFocus(false);
        return;
    }

    // SGR mouse events: CSI < Pb ; Px ; Py M/m
    const has_lt = for (csi.intermediates) |c| {
        if (c == '<') break true;
    } else false;
    if (has_lt and (csi.final == 'M' or csi.final == 'm') and csi.params.len >= 3) {
        this.emitMouse(csi.params[0], csi.params[1], csi.params[2], csi.final == 'm');
        return;
    }

    // Extract modifier from parameter 2 (if present).
    const modifier: u16 = if (csi.params.len >= 2) csi.params[1] else 0;
    const ctrl = if (modifier > 0) (modifier -| 1) & 4 != 0 else false;
    const alt = if (modifier > 0) (modifier -| 1) & 2 != 0 else false;
    const shift = if (modifier > 0) (modifier -| 1) & 1 != 0 else false;

    // Check for intermediates — '>' means xterm-style, '?' means DECRPM, etc.
    const has_gt = for (csi.intermediates) |c| {
        if (c == '>') break true;
    } else false;

    // Kitty protocol: CSI codepoint u / CSI codepoint;modifier u
    if (csi.final == 'u' and !has_gt) {
        if (csi.params.len >= 1 and csi.params[0] > 0 and csi.params[0] < 128) {
            const name = ctrlName(@intCast(csi.params[0]));
            this.emitKeypress(name, name, ctrl, shift, alt);
        }
        return;
    }

    const name: []const u8 = switch (csi.final) {
        'A' => "up",
        'B' => "down",
        'C' => "right",
        'D' => "left",
        'H' => "home",
        'F' => "end",
        'P' => "f1",
        'Q' => "f2",
        'R' => "f3",
        'S' => "f4",
        'Z' => "tab", // shift+tab
        '~' => tildeKey(csi.params),
        else => return,
    };

    const is_shift_tab = csi.final == 'Z';
    this.emitKeypress(name, name, ctrl, if (is_shift_tab) true else shift, alt);
}

fn handleESC(this: *TuiKeyReader, esc: Action.ESC) void {
    if (this.flags.in_paste) return;

    // SS3: ESC O — the final byte 'O' means the NEXT char is the SS3 payload.
    if (esc.intermediates.len == 0 and esc.final == 'O') {
        this.flags.ss3_pending = true;
        return;
    }

    // Bare ESC dispatch with no intermediates — this is alt+char.
    if (esc.intermediates.len == 0) {
        const name = ctrlName(esc.final);
        this.emitKeypress(name, name, false, false, true);
    }
}

fn tildeKey(params: []const u16) []const u8 {
    if (params.len == 0) return "~";
    return switch (params[0]) {
        1 => "home",
        2 => "insert",
        3 => "delete",
        4 => "end",
        5 => "pageup",
        6 => "pagedown",
        15 => "f5",
        17 => "f6",
        18 => "f7",
        19 => "f8",
        20 => "f9",
        21 => "f10",
        23 => "f11",
        24 => "f12",
        else => "~",
    };
}

const KeyResult = struct {
    name: []const u8,
    ctrl: bool,
};

fn executeToKey(c: u8) KeyResult {
    return switch (c) {
        '\r', '\n' => .{ .name = "enter", .ctrl = false },
        '\t' => .{ .name = "tab", .ctrl = false },
        0x08 => .{ .name = "backspace", .ctrl = true },
        0x7f => .{ .name = "backspace", .ctrl = false },
        0x1b => .{ .name = "escape", .ctrl = false },
        0x00 => .{ .name = "space", .ctrl = true },
        // ctrl+a through ctrl+z, excluding \t (0x09), \n (0x0a), \r (0x0d)
        0x01...0x07, 0x0b, 0x0c, 0x0e...0x1a => .{
            .name = @as(*const [1]u8, @ptrCast(&ascii_table['a' + c - 1]))[0..1],
            .ctrl = true,
        },
        // C1 control codes (0x80-0x9F) and other high bytes — ignore.
        0x80...0xff => .{ .name = "", .ctrl = false },
        else => .{ .name = @as(*const [1]u8, @ptrCast(&ascii_table[c]))[0..1], .ctrl = false },
    };
}

fn ctrlName(c: u8) []const u8 {
    if (c < 0x20 or c == 0x7f) return executeToKey(c).name;
    if (c < 128) return @as(*const [1]u8, @ptrCast(&ascii_table[c]))[0..1];
    return "";
}

// --- Event emission ---

/// Emit a mouse event to the JS callback.
fn emitMouse(this: *TuiKeyReader, button_code: u16, px: u16, py: u16, is_release: bool) void {
    const callback = this.onmouse_callback.get() orelse return;
    const globalThis = this.globalThis;

    const event = jsc.JSValue.createEmptyObject(globalThis, 8);

    // Decode SGR button code:
    // bits 0-1: button (0=left, 1=middle, 2=right)
    // bit 5: motion flag (32)
    // bit 6: scroll flag (64)
    // bits 2-4: modifiers (4=shift, 8=alt/meta, 16=ctrl)
    const base_button = button_code & 0x03;
    const is_motion = button_code & 32 != 0;
    const is_scroll = button_code & 64 != 0;
    const mod_shift = button_code & 4 != 0;
    const mod_alt = button_code & 8 != 0;
    const mod_ctrl = button_code & 16 != 0;

    const event_type: []const u8 = if (is_scroll)
        (if (base_button == 0) "scrollUp" else "scrollDown")
    else if (is_release)
        "up"
    else if (is_motion)
        (if (base_button == 3) "move" else "drag")
    else
        "down";

    const button: i32 = if (is_scroll)
        (if (base_button == 0) @as(i32, 4) else 5) // wheel up/down
    else
        @as(i32, @intCast(base_button));

    event.put(globalThis, bun.String.static("type"), bun.String.createUTF8ForJS(globalThis, event_type) catch return);
    event.put(globalThis, bun.String.static("button"), jsc.JSValue.jsNumber(button));
    event.put(globalThis, bun.String.static("x"), jsc.JSValue.jsNumber(@as(i32, @intCast(px)) - 1)); // 1-based → 0-based
    event.put(globalThis, bun.String.static("y"), jsc.JSValue.jsNumber(@as(i32, @intCast(py)) - 1)); // 1-based → 0-based
    event.put(globalThis, bun.String.static("shift"), jsc.JSValue.jsBoolean(mod_shift));
    event.put(globalThis, bun.String.static("alt"), jsc.JSValue.jsBoolean(mod_alt));
    event.put(globalThis, bun.String.static("ctrl"), jsc.JSValue.jsBoolean(mod_ctrl));
    event.put(globalThis, bun.String.static("option"), jsc.JSValue.jsBoolean(mod_alt));

    globalThis.bunVM().eventLoop().runCallback(callback, globalThis, .js_undefined, &.{event});
}

/// Emit a focus/blur event.
fn emitFocus(this: *TuiKeyReader, focused: bool) void {
    const callback = if (focused)
        this.onfocus_callback.get()
    else
        this.onblur_callback.get();
    if (callback == null) return;
    const globalThis = this.globalThis;
    globalThis.bunVM().eventLoop().runCallback(callback.?, globalThis, .js_undefined, &.{});
}

fn emitKeypress(this: *TuiKeyReader, name: []const u8, sequence: []const u8, ctrl: bool, shift: bool, alt: bool) void {
    if (name.len == 0) return;
    const callback = this.onkeypress_callback.get() orelse return;
    const globalThis = this.globalThis;

    const event = jsc.JSValue.createEmptyObject(globalThis, 6);
    const name_js = bun.String.createUTF8ForJS(globalThis, name) catch return;
    const seq_js = bun.String.createUTF8ForJS(globalThis, sequence) catch return;
    event.put(globalThis, bun.String.static("name"), name_js);
    event.put(globalThis, bun.String.static("sequence"), seq_js);
    event.put(globalThis, bun.String.static("ctrl"), jsc.JSValue.jsBoolean(ctrl));
    event.put(globalThis, bun.String.static("shift"), jsc.JSValue.jsBoolean(shift));
    event.put(globalThis, bun.String.static("alt"), jsc.JSValue.jsBoolean(alt));
    event.put(globalThis, bun.String.static("option"), jsc.JSValue.jsBoolean(alt));

    globalThis.bunVM().eventLoop().runCallback(callback, globalThis, .js_undefined, &.{event});
}

fn emitPaste(this: *TuiKeyReader) void {
    const callback = this.onpaste_callback.get() orelse {
        this.paste_buf.clearRetainingCapacity();
        return;
    };
    const globalThis = this.globalThis;
    const text = bun.String.createUTF8ForJS(globalThis, this.paste_buf.items) catch {
        this.paste_buf.clearRetainingCapacity();
        return;
    };
    this.paste_buf.clearRetainingCapacity();

    globalThis.bunVM().eventLoop().runCallback(callback, globalThis, .js_undefined, &.{text});
}

/// Static table for printable ASCII character names.
const ascii_table: [128]u8 = blk: {
    var table: [128]u8 = undefined;
    for (0..128) |i| {
        table[i] = @intCast(i);
    }
    break :blk table;
};

extern fn Bun__ttySetMode(fd: i32, mode: i32) i32;

const std = @import("std");
const ghostty = @import("ghostty").terminal;

const bun = @import("bun");
const jsc = bun.jsc;

const Parser = ghostty.Parser;
const Action = Parser.Action;
