//! This is a slower wrapper around a function pointer.
//! Prefer adding a task type directly to `Task` instead of using this.
const AnyTask = @This();

ctx: ?*anyopaque,
callback: *const (fn (*anyopaque) void),

pub fn task(this: *AnyTask) Task {
    return Task.init(this);
}

pub fn run(this: *AnyTask) void {
    @setRuntimeSafety(false);
    const callback = this.callback;
    const ctx = this.ctx;
    callback(ctx.?);
}

pub fn New(comptime Type: type, comptime Callback: anytype) type {
    return struct {
        pub fn init(ctx: *Type) AnyTask {
            return AnyTask{
                .callback = wrap,
                .ctx = ctx,
            };
        }

        pub fn wrap(this: ?*anyopaque) void {
            @call(bun.callmod_inline, Callback, .{@as(*Type, @ptrCast(@alignCast(this.?)))});
        }
    };
}

const bun = @import("bun");
const JSC = bun.JSC;
const Task = JSC.Task;
