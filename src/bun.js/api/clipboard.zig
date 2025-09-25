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

    return .js_undefined;
}

pub fn readText(globalObject: *JSGlobalObject, _: *jsc.CallFrame) JSError!JSValue {
    const text = readTextNative(bun.default_allocator) catch |err| {
        return globalObject.throw("Failed to read from clipboard: {s}", .{@errorName(err)});
    };
    defer bun.default_allocator.free(text);

    return ZigString.fromUTF8(text).toJS(globalObject);
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
const windows = if (builtin.os.tag == .windows) @import("std").os.windows else undefined;
const GMEM_MOVEABLE = 0x0002;
const CF_UNICODETEXT = 13;

extern "user32" fn OpenClipboard(?*anyopaque) callconv(windows.WINAPI) windows.BOOL;
extern "user32" fn CloseClipboard() callconv(windows.WINAPI) windows.BOOL;
extern "user32" fn EmptyClipboard() callconv(windows.WINAPI) windows.BOOL;
extern "user32" fn SetClipboardData(format: u32, mem: ?windows.HANDLE) callconv(windows.WINAPI) ?windows.HANDLE;
extern "user32" fn GetClipboardData(format: u32) callconv(windows.WINAPI) ?windows.HANDLE;
extern "kernel32" fn GlobalAlloc(flags: u32, bytes: usize) callconv(windows.WINAPI) ?windows.HANDLE;
extern "kernel32" fn GlobalLock(mem: ?windows.HANDLE) callconv(windows.WINAPI) ?*anyopaque;
extern "kernel32" fn GlobalUnlock(mem: ?windows.HANDLE) callconv(windows.WINAPI) windows.BOOL;

fn writeTextWindows(text: []const u8) !void {
    // Open clipboard
    if (OpenClipboard(null) == 0) return error.OpenFailed;
    defer _ = CloseClipboard();

    _ = EmptyClipboard();

    // Convert UTF-8 to UTF-16
    const len = std.unicode.calcUtf16LeLen(text) catch return error.InvalidUtf8;
    const size = (len + 1) * 2;

    const handle = GlobalAlloc(GMEM_MOVEABLE, size) orelse return error.AllocFailed;
    const ptr = @as([*]u16, @ptrCast(@alignCast(GlobalLock(handle) orelse return error.LockFailed)));
    defer _ = GlobalUnlock(handle);

    _ = try std.unicode.utf8ToUtf16Le(ptr[0..len], text);
    ptr[len] = 0;

    if (SetClipboardData(CF_UNICODETEXT, handle) == null) return error.SetFailed;
}

fn readTextWindows(allocator: std.mem.Allocator) ![]u8 {
    if (OpenClipboard(null) == 0) return error.OpenFailed;
    defer _ = CloseClipboard();

    const handle = GetClipboardData(CF_UNICODETEXT) orelse return allocator.dupe(u8, "");
    const ptr = @as([*:0]const u16, @ptrCast(@alignCast(GlobalLock(handle) orelse return error.LockFailed)));
    defer _ = GlobalUnlock(handle);

    const len = std.mem.len(ptr);
    const result = std.unicode.utf16LeToUtf8Alloc(allocator, ptr[0..len]) catch return error.InvalidUtf16;
    return result;
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

// Imports at the bottom (Zig style in Bun codebase)

const std = @import("std");
const builtin = @import("builtin");

const bun = @import("bun");
const Environment = bun.Environment;
const JSError = bun.JSError;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
