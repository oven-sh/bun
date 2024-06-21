/// https://github.com/wolfpld/tracy
/// To use this module, you must have Tracy installed on your system.
/// On macOS, you can install it with `brew install tracy`.
///
/// This file is based on the code from Zig's transpiler source.
/// Thank you to the Zig team
///
const std = @import("std");
const builtin = @import("builtin");
const build_options = @import("build_options");
const bun = @import("root").bun;

pub const enable_allocation = false;
pub const enable_callstack = false;
pub var enable = false;

const callstack_depth = build_options.tracy_callstack_depth;

const ___tracy_c_zone_context = extern struct {
    id: u32 = 0,
    active: c_int = 0,

    pub inline fn end(self: @This()) void {
        if (!enable) return;
        ___tracy_emit_zone_end(self);
    }

    pub inline fn addText(self: @This(), text: []const u8) void {
        if (!enable) return;
        ___tracy_emit_zone_text(self, text.ptr, text.len);
    }

    pub inline fn setName(self: @This(), name: []const u8) void {
        if (!enable) return;
        ___tracy_emit_zone_name(self, name.ptr, name.len);
    }

    pub inline fn setColor(self: @This(), color: u32) void {
        if (!enable) return;
        ___tracy_emit_zone_color(self, color);
    }

    pub inline fn setValue(self: @This(), value: u64) void {
        if (!enable) return;
        ___tracy_emit_zone_value(self, value);
    }
};

pub const Ctx = ___tracy_c_zone_context;

pub inline fn trace(comptime src: std.builtin.SourceLocation) Ctx {
    if (!enable) return .{};

    if (enable_callstack) {
        return ___tracy_emit_zone_begin_callstack(&.{
            .name = null,
            .function = src.fn_name.ptr,
            .file = src.file.ptr,
            .line = src.line,
            .color = 0,
        }, callstack_depth, 1);
    } else {
        const holder = struct {
            pub const srcloc = ___tracy_source_location_data{
                .name = null,
                .function = src.fn_name.ptr,
                .file = src.file.ptr,
                .line = src.line,
                .color = 0,
            };
        };

        return ___tracy_emit_zone_begin(&holder.srcloc, 1);
    }
}

pub inline fn traceNamed(comptime src: std.builtin.SourceLocation, comptime name: [*:0]const u8) Ctx {
    if (!enable) return .{};

    if (enable_callstack) {
        return ___tracy_emit_zone_begin_callstack(&.{
            .name = name,
            .function = src.fn_name.ptr,
            .file = src.file.ptr,
            .line = src.line,
            .color = 0,
        }, callstack_depth, 1);
    } else {
        const holder = struct {
            pub var data: ___tracy_source_location_data = undefined;
        };
        holder.data = ___tracy_source_location_data{
            .name = name,
            .function = src.fn_name.ptr,
            .file = src.file.ptr,
            .line = src.line,
            .color = 0,
        };
        return ___tracy_emit_zone_begin(&holder.data, 1);
    }
}

pub fn tracyAllocator(allocator: std.mem.Allocator) TracyAllocator(null) {
    return TracyAllocator(null).init(allocator);
}

pub fn TracyAllocator(comptime name: ?[:0]const u8) type {
    return struct {
        parent_allocator: std.mem.Allocator,

        const Self = @This();

        pub fn init(parent_allocator: std.mem.Allocator) Self {
            return .{
                .parent_allocator = parent_allocator,
            };
        }

        pub fn allocator(self: *Self) std.mem.Allocator {
            return .{
                .ptr = self,
                .vtable = &.{
                    .alloc = allocFn,
                    .resize = resizeFn,
                    .free = freeFn,
                },
            };
        }

        fn allocFn(ptr: *anyopaque, len: usize, ptr_align: u8, ret_addr: usize) ?[*]u8 {
            const self = @as(*Self, @ptrCast(@alignCast(ptr)));
            const result = self.parent_allocator.rawAlloc(len, ptr_align, ret_addr);
            if (result) |data| {
                if (len != 0) {
                    if (name) |n| {
                        allocNamed(data, len, n);
                    } else {
                        alloc(data, len);
                    }
                }
            } else {
                messageColor("allocation failed", 0xFF0000);
            }
            return result;
        }

        fn resizeFn(ptr: *anyopaque, buf: []u8, buf_align: u8, new_len: usize, ret_addr: usize) bool {
            const self = @as(*Self, @ptrCast(@alignCast(ptr)));
            if (self.parent_allocator.rawResize(buf, buf_align, new_len, ret_addr)) {
                if (name) |n| {
                    freeNamed(buf.ptr, n);
                    allocNamed(buf.ptr, new_len, n);
                } else {
                    free(buf.ptr);
                    alloc(buf.ptr, new_len);
                }

                return true;
            }

            // during normal operation the compiler hits this case thousands of times due to this
            // emitting messages for it is both slow and causes clutter
            return false;
        }

        fn freeFn(ptr: *anyopaque, buf: []u8, buf_align: u8, ret_addr: usize) void {
            const self = @as(*Self, @ptrCast(@alignCast(ptr)));
            self.parent_allocator.rawFree(buf, buf_align, ret_addr);
            // this condition is to handle free being called on an empty slice that was never even allocated
            // example case: `std.process.getSelfExeSharedLibPaths` can return `&[_][:0]u8{}`
            if (buf.len != 0) {
                if (name) |n| {
                    freeNamed(buf.ptr, n);
                } else {
                    free(buf.ptr);
                }
            }
        }
    };
}

// This function only accepts comptime-known strings, see `messageCopy` for runtime strings
pub inline fn message(comptime msg: [:0]const u8) void {
    if (!enable) return;
    ___tracy_emit_messageL(msg.ptr, if (enable_callstack) callstack_depth else 0);
}

// This function only accepts comptime-known strings, see `messageColorCopy` for runtime strings
pub inline fn messageColor(comptime msg: [:0]const u8, color: u32) void {
    if (!enable) return;
    ___tracy_emit_messageLC(msg.ptr, color, if (enable_callstack) callstack_depth else 0);
}

pub inline fn messageCopy(msg: []const u8) void {
    if (!enable) return;
    ___tracy_emit_message(msg.ptr, msg.len, if (enable_callstack) callstack_depth else 0);
}

pub inline fn messageColorCopy(msg: [:0]const u8, color: u32) void {
    if (!enable) return;
    ___tracy_emit_messageC(msg.ptr, msg.len, color, if (enable_callstack) callstack_depth else 0);
}

pub inline fn frameMark() void {
    if (!enable) return;
    ___tracy_emit_frame_mark(null);
}

pub inline fn frameMarkNamed(comptime name: [:0]const u8) void {
    if (!enable) return;
    ___tracy_emit_frame_mark(name.ptr);
}

pub inline fn namedFrame(comptime name: [:0]const u8) Frame(name) {
    frameMarkStart(name);
    return .{};
}

pub fn Frame(comptime name: [:0]const u8) type {
    return struct {
        pub fn end(_: @This()) void {
            frameMarkEnd(name);
        }
    };
}

inline fn frameMarkStart(comptime name: [:0]const u8) void {
    if (!enable) return;
    ___tracy_emit_frame_mark_start(name.ptr);
}

inline fn frameMarkEnd(comptime name: [:0]const u8) void {
    if (!enable) return;
    ___tracy_emit_frame_mark_end(name.ptr);
}

inline fn alloc(ptr: [*]u8, len: usize) void {
    if (!enable) return;

    if (enable_callstack) {
        ___tracy_emit_memory_alloc_callstack(ptr, len, callstack_depth, 0);
    } else {
        ___tracy_emit_memory_alloc(ptr, len, 0);
    }
}

inline fn allocNamed(ptr: [*]u8, len: usize, comptime name: [:0]const u8) void {
    if (!enable) return;

    if (enable_callstack) {
        ___tracy_emit_memory_alloc_callstack_named(ptr, len, callstack_depth, 0, name.ptr);
    } else {
        ___tracy_emit_memory_alloc_named(ptr, len, 0, name.ptr);
    }
}

inline fn free(ptr: [*]u8) void {
    if (!enable) return;

    if (enable_callstack) {
        ___tracy_emit_memory_free_callstack(ptr, callstack_depth, 0);
    } else {
        ___tracy_emit_memory_free(ptr, 0);
    }
}

inline fn freeNamed(ptr: [*]u8, comptime name: [:0]const u8) void {
    if (!enable) return;

    if (enable_callstack) {
        ___tracy_emit_memory_free_callstack_named(ptr, callstack_depth, 0, name.ptr);
    } else {
        ___tracy_emit_memory_free_named(ptr, 0, name.ptr);
    }
}

const Tracy = struct {
    pub const emit_frame_mark_start = *const fn (name: [*:0]const u8) callconv(.C) void;
    pub const emit_frame_mark_end = *const fn (name: [*:0]const u8) callconv(.C) void;
    pub const emit_zone_begin = *const fn (
        srcloc: *const ___tracy_source_location_data,
        active: c_int,
    ) callconv(.C) ___tracy_c_zone_context;
    pub const emit_zone_begin_callstack = *const fn (
        srcloc: *const ___tracy_source_location_data,
        depth: c_int,
        active: c_int,
    ) callconv(.C) ___tracy_c_zone_context;
    pub const emit_zone_text = *const fn (ctx: ___tracy_c_zone_context, txt: [*]const u8, size: usize) callconv(.C) void;
    pub const emit_zone_name = *const fn (ctx: ___tracy_c_zone_context, txt: [*]const u8, size: usize) callconv(.C) void;
    pub const emit_zone_color = *const fn (ctx: ___tracy_c_zone_context, color: u32) callconv(.C) void;
    pub const emit_zone_value = *const fn (ctx: ___tracy_c_zone_context, value: u64) callconv(.C) void;
    pub const emit_zone_end = *const fn (ctx: ___tracy_c_zone_context) callconv(.C) void;
    pub const emit_memory_alloc = *const fn (ptr: *const anyopaque, size: usize, secure: c_int) callconv(.C) void;
    pub const emit_memory_alloc_callstack = *const fn (ptr: *const anyopaque, size: usize, depth: c_int, secure: c_int) callconv(.C) void;
    pub const emit_memory_free = *const fn (ptr: *const anyopaque, secure: c_int) callconv(.C) void;
    pub const emit_memory_free_callstack = *const fn (ptr: *const anyopaque, depth: c_int, secure: c_int) callconv(.C) void;
    pub const emit_memory_alloc_named = *const fn (ptr: *const anyopaque, size: usize, secure: c_int, name: [*:0]const u8) callconv(.C) void;
    pub const emit_memory_alloc_callstack_named = *const fn (ptr: *const anyopaque, size: usize, depth: c_int, secure: c_int, name: [*:0]const u8) callconv(.C) void;
    pub const emit_memory_free_named = *const fn (ptr: *const anyopaque, secure: c_int, name: [*:0]const u8) callconv(.C) void;
    pub const emit_memory_free_callstack_named = *const fn (ptr: *const anyopaque, depth: c_int, secure: c_int, name: [*:0]const u8) callconv(.C) void;
    pub const emit_message = *const fn (txt: [*]const u8, size: usize, callstack: c_int) callconv(.C) void;
    pub const emit_messageL = *const fn (txt: [*:0]const u8, callstack: c_int) callconv(.C) void;
    pub const emit_messageC = *const fn (txt: [*]const u8, size: usize, color: u32, callstack: c_int) callconv(.C) void;
    pub const emit_messageLC = *const fn (txt: [*:0]const u8, color: u32, callstack: c_int) callconv(.C) void;
    pub const emit_frame_mark = *const fn (name: ?[*:0]const u8) callconv(.C) void;
    pub const connected = *const fn () callconv(.C) c_int;
    pub const set_thread_name = *const fn (name: [*:0]const u8) callconv(.C) void;
    pub const startup_profiler = *const fn () callconv(.C) void;
    pub const shutdown_profiler = *const fn () callconv(.C) void;
};

fn ___tracy_startup_profiler() void {
    // these might not exist
    const Fn = dlsym(Tracy.startup_profiler, "___tracy_startup_profiler") orelse return;
    Fn();
}

fn ___tracy_shutdown_profiler() void {
    // these might not exist
    const Fn = dlsym(Tracy.shutdown_profiler, "___tracy_shutdown_profiler") orelse return;
    Fn();
}

pub var has_started = false;
pub fn start() void {
    if (!enable or has_started) return;
    ___tracy_startup_profiler();
}

pub fn stop() void {
    if (!enable or !has_started) return;
    ___tracy_shutdown_profiler();
}

fn ___tracy_connected() c_int {
    const Fn = dlsym(Tracy.connected, "___tracy_connected").?;
    return Fn();
}

fn ___tracy_set_thread_name(name: [*:0]const u8) void {
    const Fn = dlsym(Tracy.set_thread_name, "___tracy_set_thread_name").?;
    Fn(name);
}

fn ___tracy_emit_frame_mark_start(name: [*:0]const u8) void {
    const Fn = dlsym(Tracy.emit_frame_mark_start, "___tracy_emit_frame_mark_start").?;
    Fn(name);
}
fn ___tracy_emit_frame_mark_end(name: [*:0]const u8) void {
    const Fn = dlsym(Tracy.emit_frame_mark_end, "___tracy_emit_frame_mark_end").?;
    Fn(name);
}
fn ___tracy_emit_zone_begin(
    srcloc: *const ___tracy_source_location_data,
    active: c_int,
) ___tracy_c_zone_context {
    const Fn = dlsym(Tracy.emit_zone_begin, "___tracy_emit_zone_begin").?;
    return Fn(srcloc, active);
}
fn ___tracy_emit_zone_begin_callstack(
    srcloc: *const ___tracy_source_location_data,
    depth: c_int,
    active: c_int,
) ___tracy_c_zone_context {
    const Fn = dlsym(Tracy.emit_zone_begin_callstack, "___tracy_emit_zone_begin_callstack").?;
    return Fn(srcloc, depth, active);
}
fn ___tracy_emit_zone_text(ctx: ___tracy_c_zone_context, txt: [*]const u8, size: usize) void {
    const Fn = dlsym(Tracy.emit_zone_text, "___tracy_emit_zone_text").?;
    Fn(ctx, txt, size);
}
fn ___tracy_emit_zone_name(ctx: ___tracy_c_zone_context, txt: [*]const u8, size: usize) void {
    const Fn = dlsym(Tracy.emit_zone_name, "___tracy_emit_zone_name").?;
    Fn(ctx, txt, size);
}
fn ___tracy_emit_zone_color(ctx: ___tracy_c_zone_context, color: u32) void {
    const Fn = dlsym(Tracy.emit_zone_color, "___tracy_emit_zone_color").?;
    Fn(ctx, color);
}
fn ___tracy_emit_zone_value(ctx: ___tracy_c_zone_context, value: u64) void {
    const Fn = dlsym(Tracy.emit_zone_value, "___tracy_emit_zone_value").?;
    Fn(ctx, value);
}
fn ___tracy_emit_zone_end(ctx: ___tracy_c_zone_context) void {
    const Fn = dlsym(Tracy.emit_zone_end, "___tracy_emit_zone_end").?;
    Fn(ctx);
}
fn ___tracy_emit_memory_alloc(ptr: *const anyopaque, size: usize, secure: c_int) void {
    const Fn = dlsym(Tracy.emit_memory_alloc, "___tracy_emit_memory_alloc").?;
    Fn(ptr, size, secure);
}
fn ___tracy_emit_memory_alloc_callstack(ptr: *const anyopaque, size: usize, depth: c_int, secure: c_int) void {
    const Fn = dlsym(Tracy.emit_memory_alloc_callstack, "___tracy_emit_memory_alloc_callstack").?;
    Fn(ptr, size, depth, secure);
}
fn ___tracy_emit_memory_free(ptr: *const anyopaque, secure: c_int) void {
    const Fn = dlsym(Tracy.emit_memory_free, "___tracy_emit_memory_free").?;
    Fn(ptr, secure);
}
fn ___tracy_emit_memory_free_callstack(ptr: *const anyopaque, depth: c_int, secure: c_int) void {
    const Fn = dlsym(Tracy.emit_memory_free_callstack, "___tracy_emit_memory_free_callstack").?;
    Fn(ptr, depth, secure);
}
fn ___tracy_emit_memory_alloc_named(ptr: *const anyopaque, size: usize, secure: c_int, name: [*:0]const u8) void {
    const Fn = dlsym(Tracy.emit_memory_alloc_named, "___tracy_emit_memory_alloc_named").?;
    Fn(ptr, size, secure, name);
}
fn ___tracy_emit_memory_alloc_callstack_named(ptr: *const anyopaque, size: usize, depth: c_int, secure: c_int, name: [*:0]const u8) void {
    const Fn = dlsym(Tracy.emit_memory_alloc_callstack_named, "___tracy_emit_memory_alloc_callstack_named").?;
    Fn(ptr, size, depth, secure, name);
}
fn ___tracy_emit_memory_free_named(ptr: *const anyopaque, secure: c_int, name: [*:0]const u8) void {
    const Fn = dlsym(Tracy.emit_memory_free_named, "___tracy_emit_memory_free_named").?;
    Fn(ptr, secure, name);
}
fn ___tracy_emit_memory_free_callstack_named(ptr: *const anyopaque, depth: c_int, secure: c_int, name: [*:0]const u8) void {
    const Fn = dlsym(Tracy.emit_memory_free_callstack_named, "___tracy_emit_memory_free_callstack_named").?;
    Fn(ptr, depth, secure, name);
}
fn ___tracy_emit_message(txt: [*]const u8, size: usize, callstack: c_int) void {
    const Fn = dlsym(Tracy.emit_message, "___tracy_emit_message").?;
    Fn(txt, size, callstack);
}
fn ___tracy_emit_messageL(txt: [*:0]const u8, callstack: c_int) void {
    const Fn = dlsym(Tracy.emit_messageL, "___tracy_emit_messageL").?;
    Fn(txt, callstack);
}
fn ___tracy_emit_messageC(txt: [*]const u8, size: usize, color: u32, callstack: c_int) void {
    const Fn = dlsym(Tracy.emit_messageC, "___tracy_emit_messageC").?;
    Fn(txt, size, color, callstack);
}
fn ___tracy_emit_messageLC(txt: [*:0]const u8, color: u32, callstack: c_int) void {
    const Fn = dlsym(Tracy.emit_messageLC, "___tracy_emit_messageLC").?;
    Fn(txt, color, callstack);
}
fn ___tracy_emit_frame_mark(name: ?[*:0]const u8) void {
    const Fn = dlsym(Tracy.emit_frame_mark, "___tracy_emit_frame_mark").?;
    Fn(name);
}

pub fn init() bool {
    if (comptime !bun.Environment.isNative) {
        return false;
    }

    if (enable)
        return true;

    if (dlsym(Tracy.emit_message, "___tracy_emit_message") == null) {
        return false;
    }
    enable = true;
    return true;
}

pub fn isConnected() bool {
    if (comptime !bun.Environment.isNative) {
        return false;
    }

    if (!enable)
        return false;

    const Fn = dlsym(Tracy.connected, "___tracy_connected").?;
    return Fn() != 0;
}

pub fn initThread(comptime name: [:0]const u8) void {
    if (comptime !bun.Environment.isNative) {
        return;
    }

    if (!enable)
        return;

    dlsym(Tracy.set_thread_name, "___tracy_set_thread_name").?(name.ptr);
}

const ___tracy_source_location_data = extern struct {
    name: ?[*:0]const u8 = null,
    function: [*:0]const u8 = "",
    file: [*:0]const u8 = "",
    line: u32 = 0,
    color: u32 = 0,
};

fn dlsym(comptime Type: type, comptime symbol: [:0]const u8) ?Type {
    if (comptime !bun.Environment.isNative) {
        return null;
    }

    if (comptime bun.Environment.isLinux) {
        // use LD_PRELOAD on linux
        if (bun.C.dlsym(Type, symbol)) |val| {
            return val;
        }
    }

    const Handle = struct {
        pub var handle: ?*anyopaque = null;
        pub fn getter() ?*anyopaque {
            return handle;
        }
    };

    get: {
        if (Handle.handle == null) {
            const paths_to_try = if (bun.Environment.isMac) .{
                "/usr/local/opt/tracy/lib/libtracy.dylib",
                "/usr/local/lib/libtracy.dylib",
                "/opt/homebrew/lib/libtracy.so",
                "/opt/homebrew/lib/libtracy.dylib",
                "/usr/lib/libtracy.dylib",
                "libtracy.dylib",
                "libtracy.so",
                "libTracyClient.dylib",
                "libTracyClient.so",
            } else if (bun.Environment.isLinux) .{
                "/usr/local/lib/libtracy.so",
                "/usr/local/opt/tracy/lib/libtracy.so",
                "/opt/tracy/lib/libtracy.so",
                "/usr/lib/libtracy.so",
                "/usr/local/lib/libTracyClient.so",
                "/usr/local/opt/tracy/lib/libTracyClient.so",
                "/opt/tracy/lib/libTracyClient.so",
                "/usr/lib/libTracyClient.so",
                "libtracy.so",
                "libTracyClient.so",
            } else if (bun.Environment.isWindows) .{
                "tracy.dll",
            } else .{};

            const RLTD = if (bun.Environment.isMac)
                -2
            else
                0;

            if (bun.getenvZ("BUN_TRACY_PATH")) |path| {
                const handle = bun.C.dlopen(&(std.posix.toPosixPath(path) catch unreachable), RLTD);
                if (handle != null) {
                    Handle.handle = handle;
                    break :get;
                }
            }
            inline for (comptime paths_to_try) |path| {
                const handle = bun.C.dlopen(path, RLTD);
                if (handle != null) {
                    Handle.handle = handle;
                    break;
                }
            }

            if (Handle.handle == null)
                return null;
        }
    }

    return bun.C.dlsymWithHandle(Type, symbol, Handle.getter);
}
