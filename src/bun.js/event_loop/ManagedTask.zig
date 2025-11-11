//! This is a slow, dynamically-allocated one-off task
//! Use it when you can't add to jsc.Task directly and managing the lifetime of the Task struct is overly complex

const ManagedTask = @This();

ctx: ?*anyopaque,
callback: *const (fn (*anyopaque) bun.JSTerminated!void),

pub fn task(this: *ManagedTask) Task {
    return Task.init(this);
}

pub fn run(this: *ManagedTask) bun.JSTerminated!void {
    defer bun.destroy(this);
    const callback = this.callback;
    const ctx = this.ctx;
    try callback(ctx.?);
}

pub fn cancel(this: *ManagedTask) void {
    this.callback = &struct {
        fn f(_: *anyopaque) void {}
    }.f;
}

pub fn New(comptime Type: type, comptime Callback: anytype) type {
    return struct {
        pub fn init(ctx: *Type) Task {
            var managed = bun.new(ManagedTask, .{
                .callback = wrap,
                .ctx = ctx,
            });
            return managed.task();
        }

        pub fn wrap(this: ?*anyopaque) bun.JSTerminated!void {
            return @call(bun.callmod_inline, Callback, .{@as(*Type, @ptrCast(@alignCast(this.?)))});
        }
    };
}

const bun = @import("bun");

const jsc = bun.jsc;
const Task = jsc.Task;
