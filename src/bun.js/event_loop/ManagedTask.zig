//! This is a slow, dynamically-allocated one-off task
//! Use it when you can't add to JSC.Task directly and managing the lifetime of the Task struct is overly complex

const ManagedTask = @This();

ctx: ?*anyopaque,
callback: *const (fn (*anyopaque) void),

pub fn task(this: *ManagedTask) Task {
    return Task.init(this);
}

pub fn run(this: *ManagedTask) void {
    @setRuntimeSafety(false);
    const callback = this.callback;
    const ctx = this.ctx;
    callback(ctx.?);
    bun.default_allocator.destroy(this);
}

pub fn cancel(this: *ManagedTask) void {
    this.callback = &struct {
        fn f(_: *anyopaque) void {}
    }.f;
}

pub fn New(comptime Type: type, comptime Callback: anytype) type {
    return struct {
        pub fn init(ctx: *Type) Task {
            var managed = bun.default_allocator.create(ManagedTask) catch bun.outOfMemory();
            managed.* = ManagedTask{
                .callback = wrap,
                .ctx = ctx,
            };
            return managed.task();
        }

        pub fn wrap(this: ?*anyopaque) void {
            @call(bun.callmod_inline, Callback, .{@as(*Type, @ptrCast(@alignCast(this.?)))});
        }
    };
}

const bun = @import("bun");
const JSC = bun.JSC;
const Task = JSC.Task;
