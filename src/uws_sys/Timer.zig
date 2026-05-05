/// **DEPRECATED**
/// **DO NOT USE IN NEW CODE!**
///
/// Use `JSC.EventLoopTimer` instead.
///
/// This code will be deleted eventually! It is very inefficient on POSIX. On
/// Linux, it holds an entire file descriptor for every single timer. On macOS,
/// it's several system calls.
pub const Timer = opaque {
    pub fn create(loop: *Loop, ptr: anytype) *Timer {
        const Type = @TypeOf(ptr);

        // never fallthrough poll
        // the problem is uSockets hardcodes it on the other end
        // so we can never free non-fallthrough polls
        return c.us_create_timer(loop, 0, @sizeOf(Type)) orelse bun.Output.panic("us_create_timer: returned null: {d}", .{std.c._errno().*});
    }

    pub fn createFallthrough(loop: *Loop, ptr: anytype) *Timer {
        const Type = @TypeOf(ptr);

        // never fallthrough poll
        // the problem is uSockets hardcodes it on the other end
        // so we can never free non-fallthrough polls
        return c.us_create_timer(loop, 1, @sizeOf(Type)) orelse bun.Output.panic("us_create_timer: returned null: {d}", .{std.c._errno().*});
    }

    pub fn set(this: *Timer, ptr: anytype, cb: ?*const fn (*Timer) callconv(.c) void, ms: i32, repeat_ms: i32) void {
        c.us_timer_set(this, cb, ms, repeat_ms);
        const value_ptr = c.us_timer_ext(this);
        @setRuntimeSafety(false);
        @as(*@TypeOf(ptr), @ptrCast(@alignCast(value_ptr))).* = ptr;
    }

    pub fn deinit(this: *Timer, comptime fallthrough: bool) void {
        debug("Timer.deinit()", .{});
        c.us_timer_close(this, @intFromBool(fallthrough));
    }

    pub fn ext(this: *Timer, comptime Type: type) ?*Type {
        return @as(*Type, @ptrCast(@alignCast(c.us_timer_ext(this).*.?)));
    }

    pub fn as(this: *Timer, comptime Type: type) Type {
        @setRuntimeSafety(false);
        return @as(*?Type, @ptrCast(@alignCast(c.us_timer_ext(this)))).*.?;
    }
};

const c = struct {
    pub extern fn us_create_timer(loop: ?*Loop, fallthrough: i32, ext_size: c_uint) ?*Timer;
    pub extern fn us_timer_ext(timer: ?*Timer) *?*anyopaque;
    pub extern fn us_timer_close(timer: ?*Timer, fallthrough: i32) void;
    pub extern fn us_timer_set(timer: ?*Timer, cb: ?*const fn (*Timer) callconv(.c) void, ms: i32, repeat_ms: i32) void;
    pub extern fn us_timer_loop(t: ?*Timer) ?*Loop;
};

const debug = bun.Output.scoped(.uws, .visible);

const bun = @import("bun");
const std = @import("std");

const uws = bun.uws;
const Loop = uws.Loop;
