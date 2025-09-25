const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const JSError = jsc.JSError;
const JSPromise = jsc.JSPromise;
const ZigString = jsc.ZigString;

pub fn writeText(globalObject: *JSGlobalObject, callframe: *jsc.CallFrame) JSError!JSValue {
    const args = callframe.argumentsAsArray(1);

    if (args.len < 1 or !args[0].isString()) {
        return globalObject.throw("writeText requires a string argument", .{});
    }

    const text = try args[0].toSlice(globalObject, bun.default_allocator);
    defer text.deinit();

    writeTextNative(text.slice()) catch |err| {
        return globalObject.throw("Failed to write to clipboard: {s}", .{@errorName(err)});
    };

    return JSPromise.resolvedPromiseValue(globalObject, .undefined);
}

pub fn readText(globalObject: *JSGlobalObject, _: *jsc.CallFrame) JSError!JSValue {
    const text = readTextNative(bun.default_allocator) catch |err| {
        return globalObject.throw("Failed to read from clipboard: {s}", .{@errorName(err)});
    };
    defer bun.default_allocator.free(text);

    return JSPromise.resolvedPromiseValue(globalObject, ZigString.fromUTF8(text).toJS(globalObject));
}

fn writeTextNative(text: []const u8) !void {
    if (comptime Environment.isWindows) {
        return writeTextWindows(text);
    } else if (comptime Environment.isMac) {
        return writeTextDarwin(text);
    } else {
        return writeTextLinux(text);
    }
}

fn readTextNative(allocator: std.mem.Allocator) ![]u8 {
    if (comptime Environment.isWindows) {
        return readTextWindows(allocator);
    } else if (comptime Environment.isMac) {
        return readTextDarwin(allocator);
    } else {
        return readTextLinux(allocator);
    }
}

// Windows implementation using Win32 APIs
fn writeTextWindows(text: []const u8) !void {
    const w = std.os.windows;

    // Open clipboard
    if (w.user32.OpenClipboard(null) == 0) return error.OpenFailed;
    defer _ = w.user32.CloseClipboard();

    _ = w.user32.EmptyClipboard();

    // Convert UTF-8 to UTF-16
    const len = try std.unicode.utf8CountUtf16CodeUnits(text);
    const size = (len + 1) * 2;

    const handle = w.kernel32.GlobalAlloc(w.GMEM_MOVEABLE, size) orelse return error.AllocFailed;
    const ptr = @as([*]u16, @ptrCast(@alignCast(w.kernel32.GlobalLock(handle) orelse return error.LockFailed)));
    defer _ = w.kernel32.GlobalUnlock(handle);

    _ = try std.unicode.utf8ToUtf16Le(ptr[0..len], text);
    ptr[len] = 0;

    if (w.user32.SetClipboardData(w.CF_UNICODETEXT, handle) == null) return error.SetFailed;
}

fn readTextWindows(allocator: std.mem.Allocator) ![]u8 {
    const w = std.os.windows;

    if (w.user32.OpenClipboard(null) == 0) return error.OpenFailed;
    defer _ = w.user32.CloseClipboard();

    const handle = w.user32.GetClipboardData(w.CF_UNICODETEXT) orelse return allocator.dupe(u8, "");
    const ptr = @as([*:0]const u16, @ptrCast(@alignCast(w.kernel32.GlobalLock(handle) orelse return error.LockFailed)));
    defer _ = w.kernel32.GlobalUnlock(handle);

    const len = std.mem.len(ptr);
    var buf = std.ArrayList(u8).init(allocator);
    try std.unicode.utf16leToUtf8(buf.writer(), ptr[0..len]);
    return buf.toOwnedSlice();
}

// macOS implementation using pbcopy/pbpaste
fn writeTextDarwin(text: []const u8) !void {
    var child = std.process.Child.init(&.{"pbcopy"}, bun.default_allocator);
    child.stdin_behavior = .Pipe;
    try child.spawn();
    try child.stdin.?.writeAll(text);
    child.stdin.?.close();
    const term = try child.wait();
    if (term.Exited != 0) return error.Failed;
}

fn readTextDarwin(allocator: std.mem.Allocator) ![]u8 {
    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{"pbpaste"},
    });
    defer allocator.free(result.stderr);
    if (result.term.Exited != 0) {
        allocator.free(result.stdout);
        return error.Failed;
    }
    return result.stdout;
}

// Linux implementation using xclip/wl-clipboard
fn writeTextLinux(text: []const u8) !void {
    // Try wl-copy first for Wayland
    var child = std.process.Child.init(&.{"wl-copy"}, bun.default_allocator);
    child.stdin_behavior = .Pipe;
    child.stderr_behavior = .Ignore;

    if (child.spawn()) |_| {
        child.stdin.?.writeAll(text) catch {};
        child.stdin.?.close();
        const term = try child.wait();
        if (term.Exited == 0) return;
    } else |_| {}

    // Fallback to xclip for X11
    child = std.process.Child.init(&.{ "xclip", "-selection", "clipboard" }, bun.default_allocator);
    child.stdin_behavior = .Pipe;
    try child.spawn();
    try child.stdin.?.writeAll(text);
    child.stdin.?.close();
    const term = try child.wait();
    if (term.Exited != 0) return error.Failed;
}

fn readTextLinux(allocator: std.mem.Allocator) ![]u8 {
    // Try wl-paste first for Wayland
    if (std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{"wl-paste"},
    })) |result| {
        defer allocator.free(result.stderr);
        if (result.term.Exited == 0) return result.stdout;
        allocator.free(result.stdout);
    } else |_| {}

    // Fallback to xclip for X11
    const result = try std.process.Child.run(.{
        .allocator = allocator,
        .argv = &.{ "xclip", "-selection", "clipboard", "-o" },
    });
    defer allocator.free(result.stderr);
    if (result.term.Exited != 0) {
        allocator.free(result.stdout);
        return error.Failed;
    }
    return result.stdout;
}