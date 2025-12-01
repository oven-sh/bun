pub const PosixLoop = extern struct {
    internal_loop_data: InternalLoopData align(16),

    /// Number of non-fallthrough polls in the loop
    num_polls: i32,

    /// Number of ready polls this iteration
    num_ready_polls: i32,

    /// Current index in list of ready polls
    current_ready_poll: i32,

    /// Loop's own file descriptor
    fd: i32,

    /// Number of polls owned by Bun
    active: u32 = 0,

    /// The list of ready polls
    ready_polls: [1024]EventType align(16),

    const EventType = switch (Environment.os) {
        .linux => std.os.linux.epoll_event,
        .mac => std.posix.system.kevent64_s,
        // TODO:
        .windows => *anyopaque,
        .wasm => @compileError("Unsupported OS"),
    };

    pub fn uncork(this: *PosixLoop) void {
        c.uws_res_clear_corked_socket(this);
    }

    pub fn updateDate(this: *PosixLoop) void {
        c.uws_loop_date_header_timer_update(this);
    }

    pub fn iterationNumber(this: *const PosixLoop) u64 {
        return this.internal_loop_data.iteration_nr;
    }

    pub fn inc(this: *PosixLoop) void {
        log("inc {d} + 1 = {d}", .{ this.num_polls, this.num_polls + 1 });
        this.num_polls += 1;
    }

    pub fn dec(this: *PosixLoop) void {
        log("dec {d} - 1 = {d}", .{ this.num_polls, this.num_polls - 1 });
        this.num_polls -= 1;
    }

    pub fn ref(this: *PosixLoop) void {
        log("ref {d} + 1 = {d} | {d} + 1 = {d}", .{ this.num_polls, this.num_polls + 1, this.active, this.active + 1 });
        this.num_polls += 1;
        this.active += 1;
    }

    pub fn unref(this: *PosixLoop) void {
        log("unref {d} - 1 = {d} | {d} - 1 = {d}", .{ this.num_polls, this.num_polls - 1, this.active, this.active -| 1 });
        this.num_polls -= 1;
        this.active -|= 1;
    }

    pub fn isActive(this: *const Loop) bool {
        return this.active > 0;
    }

    // This exists as a method so that we can stick a debugger in here
    pub fn addActive(this: *PosixLoop, value: u32) void {
        log("add {d} + {d} = {d}", .{ this.active, value, this.active +| value });
        this.active +|= value;
    }

    // This exists as a method so that we can stick a debugger in here
    pub fn subActive(this: *PosixLoop, value: u32) void {
        log("sub {d} - {d} = {d}", .{ this.active, value, this.active -| value });
        this.active -|= value;
    }

    pub fn unrefCount(this: *PosixLoop, count: i32) void {
        log("unref x {d}", .{count});
        this.num_polls -= count;
        this.active -|= @as(u32, @intCast(count));
    }

    pub fn get() *Loop {
        return c.uws_get_loop();
    }

    pub fn create(comptime Handler: anytype) *Loop {
        return c.us_create_loop(
            null,
            Handler.wakeup,
            if (@hasDecl(Handler, "pre")) Handler.pre else null,
            if (@hasDecl(Handler, "post")) Handler.post else null,
            0,
        ).?;
    }

    pub fn wakeup(this: *PosixLoop) void {
        return c.us_wakeup_loop(this);
    }

    pub const wake = wakeup;

    pub fn tick(this: *PosixLoop) void {
        c.us_loop_run_bun_tick(this, null);
    }

    pub fn tickWithoutIdle(this: *PosixLoop) void {
        const timespec = bun.timespec{ .sec = 0, .nsec = 0 };
        c.us_loop_run_bun_tick(this, &timespec);
    }

    pub fn tickWithTimeout(this: *PosixLoop, timespec: ?*const bun.timespec) void {
        c.us_loop_run_bun_tick(this, timespec);
    }

    pub fn nextTick(this: *PosixLoop, comptime UserType: type, user_data: UserType, comptime deferCallback: fn (ctx: UserType) void) void {
        const Handler = struct {
            pub fn callback(data: *anyopaque) callconv(.c) void {
                deferCallback(@as(UserType, @ptrCast(@alignCast(data))));
            }
        };
        c.uws_loop_defer(this, user_data, Handler.callback);
    }

    fn NewHandler(comptime UserType: type, comptime callback_fn: fn (UserType) void) type {
        return struct {
            loop: *Loop,
            pub fn removePost(handler: @This()) void {
                return c.uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn removePre(handler: @This()) void {
                return c.uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn callback(data: *anyopaque, _: *Loop) callconv(.c) void {
                callback_fn(@as(UserType, @ptrCast(@alignCast(data))));
            }
        };
    }

    pub fn addPostHandler(this: *PosixLoop, comptime UserType: type, ctx: UserType, comptime callback: fn (UserType) void) NewHandler(UserType, callback) {
        const Handler = NewHandler(UserType, callback);

        c.uws_loop_addPostHandler(this, ctx, Handler.callback);
        return Handler{
            .loop = this,
        };
    }

    pub fn addPreHandler(this: *PosixLoop, comptime UserType: type, ctx: UserType, comptime callback: fn (UserType) void) NewHandler(UserType, callback) {
        const Handler = NewHandler(UserType, callback);

        c.uws_loop_addPreHandler(this, ctx, Handler.callback);
        return Handler{
            .loop = this,
        };
    }

    pub fn run(this: *PosixLoop) void {
        c.us_loop_run(this);
    }

    pub fn shouldEnableDateHeaderTimer(this: *const PosixLoop) bool {
        return this.internal_loop_data.shouldEnableDateHeaderTimer();
    }

    pub fn deinit(this: *PosixLoop) void {
        c.us_loop_free(this);
    }
};

pub const WindowsLoop = extern struct {
    const uv = bun.windows.libuv;

    internal_loop_data: InternalLoopData align(16),

    uv_loop: *uv.Loop,
    is_default: c_int,
    pre: *uv.uv_prepare_t,
    check: *uv.uv_check_t,

    pub fn shouldEnableDateHeaderTimer(this: *const WindowsLoop) bool {
        return this.internal_loop_data.shouldEnableDateHeaderTimer();
    }

    pub fn uncork(this: *PosixLoop) void {
        c.uws_res_clear_corked_socket(this);
    }

    pub fn get() *WindowsLoop {
        return c.uws_get_loop_with_native(bun.windows.libuv.Loop.get());
    }

    pub fn iterationNumber(this: *const WindowsLoop) u64 {
        return this.internal_loop_data.iteration_nr;
    }

    pub fn addActive(this: *const WindowsLoop, val: u32) void {
        this.uv_loop.addActive(val);
    }

    pub fn subActive(this: *const WindowsLoop, val: u32) void {
        this.uv_loop.subActive(val);
    }

    pub fn isActive(this: *const WindowsLoop) bool {
        return this.uv_loop.isActive();
    }

    pub fn wakeup(this: *WindowsLoop) void {
        c.us_wakeup_loop(this);
    }

    pub const wake = wakeup;

    pub fn tickWithTimeout(this: *WindowsLoop, _: ?*const bun.timespec) void {
        c.us_loop_run(this);
    }

    pub fn tickWithoutIdle(this: *WindowsLoop) void {
        c.us_loop_pump(this);
    }

    pub fn create(comptime Handler: anytype) *WindowsLoop {
        return c.us_create_loop(
            null,
            Handler.wakeup,
            if (@hasDecl(Handler, "pre")) Handler.pre else null,
            if (@hasDecl(Handler, "post")) Handler.post else null,
            0,
        ).?;
    }

    pub fn run(this: *WindowsLoop) void {
        c.us_loop_run(this);
    }

    // TODO: remove these two aliases
    pub const tick = run;
    pub const wait = run;

    pub fn inc(this: *WindowsLoop) void {
        this.uv_loop.inc();
    }

    pub fn dec(this: *WindowsLoop) void {
        this.uv_loop.dec();
    }

    pub const ref = inc;
    pub const unref = dec;

    pub fn nextTick(this: *Loop, comptime UserType: type, user_data: UserType, comptime deferCallback: fn (ctx: UserType) void) void {
        const Handler = struct {
            pub fn callback(data: *anyopaque) callconv(.c) void {
                deferCallback(@as(UserType, @ptrCast(@alignCast(data))));
            }
        };
        c.uws_loop_defer(this, user_data, Handler.callback);
    }

    pub fn updateDate(this: *Loop) void {
        c.uws_loop_date_header_timer_update(this);
    }

    pub fn deinit(this: *WindowsLoop) void {
        c.us_loop_free(this);
    }

    fn NewHandler(comptime UserType: type, comptime callback_fn: fn (UserType) void) type {
        return struct {
            loop: *Loop,
            pub fn removePost(handler: @This()) void {
                return c.uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn removePre(handler: @This()) void {
                return c.uws_loop_removePostHandler(handler.loop, callback);
            }
            pub fn callback(data: *anyopaque, _: *Loop) callconv(.c) void {
                callback_fn(@as(UserType, @ptrCast(@alignCast(data))));
            }
        };
    }
};

pub const Loop = if (bun.Environment.isWindows) WindowsLoop else PosixLoop;

const c = struct {
    pub extern fn us_create_loop(
        hint: ?*anyopaque,
        wakeup_cb: ?*const fn (*Loop) callconv(.c) void,
        pre_cb: ?*const fn (*Loop) callconv(.c) void,
        post_cb: ?*const fn (*Loop) callconv(.c) void,
        ext_size: c_uint,
    ) ?*Loop;
    pub extern fn us_loop_free(loop: ?*Loop) void;
    pub extern fn us_loop_ext(loop: ?*Loop) ?*anyopaque;
    pub extern fn us_loop_run(loop: ?*Loop) void;
    pub extern fn us_loop_pump(loop: ?*Loop) void;
    pub extern fn us_wakeup_loop(loop: ?*Loop) void;
    pub extern fn us_loop_integrate(loop: ?*Loop) void;
    pub extern fn us_loop_iteration_number(loop: ?*Loop) c_longlong;
    pub extern fn uws_loop_addPostHandler(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque, loop: *Loop) callconv(.c) void)) void;
    pub extern fn uws_loop_removePostHandler(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque, loop: *Loop) callconv(.c) void)) void;
    pub extern fn uws_loop_addPreHandler(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque, loop: *Loop) callconv(.c) void)) void;
    pub extern fn uws_loop_removePreHandler(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque, loop: *Loop) callconv(.c) void)) void;
    pub extern fn us_loop_run_bun_tick(loop: ?*Loop, timouetMs: ?*const bun.timespec) void;
    pub extern fn uws_get_loop() *Loop;
    pub extern fn uws_get_loop_with_native(*anyopaque) *WindowsLoop;
    pub extern fn uws_loop_defer(loop: *Loop, ctx: *anyopaque, cb: *const (fn (ctx: *anyopaque) callconv(.c) void)) void;
    pub extern fn uws_res_clear_corked_socket(loop: *Loop) void;
    pub extern fn uws_loop_date_header_timer_update(loop: *Loop) void;
};

const log = bun.Output.scoped(.Loop, .visible);

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;

const uws = bun.uws;
const InternalLoopData = uws.InternalLoopData;
