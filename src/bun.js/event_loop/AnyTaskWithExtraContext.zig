//! This is AnyTask except it gives you two pointers instead of one.
//! Generally, prefer JSC.Task instead of this.
const AnyTaskWithExtraContext = @This();
ctx: ?*anyopaque = undefined,
callback: *const (fn (*anyopaque, *anyopaque) void) = undefined,
next: ?*AnyTaskWithExtraContext = null,

pub fn fromCallbackAutoDeinit(ptr: anytype, comptime fieldName: [:0]const u8) *AnyTaskWithExtraContext {
    const Ptr = std.meta.Child(@TypeOf(ptr));
    const Wrapper = struct {
        any_task: AnyTaskWithExtraContext,
        wrapped: *Ptr,
        pub fn function(this: *anyopaque, extra: *anyopaque) void {
            const that: *@This() = @ptrCast(@alignCast(this));
            defer bun.default_allocator.destroy(that);
            const ctx = that.wrapped;
            @field(Ptr, fieldName)(ctx, extra);
        }
    };
    const task = bun.default_allocator.create(Wrapper) catch bun.outOfMemory();
    task.* = Wrapper{
        .any_task = AnyTaskWithExtraContext{
            .callback = &Wrapper.function,
            .ctx = task,
        },
        .wrapped = ptr,
    };
    return &task.any_task;
}

pub fn from(this: *@This(), of: anytype, comptime field: []const u8) *@This() {
    const TheTask = New(std.meta.Child(@TypeOf(of)), void, @field(std.meta.Child(@TypeOf(of)), field));
    this.* = TheTask.init(of);
    return this;
}

pub fn run(this: *AnyTaskWithExtraContext, extra: *anyopaque) void {
    @setRuntimeSafety(false);
    const callback = this.callback;
    const ctx = this.ctx;
    callback(ctx.?, extra);
}

pub fn New(comptime Type: type, comptime ContextType: type, comptime Callback: anytype) type {
    return struct {
        pub fn init(ctx: *Type) AnyTaskWithExtraContext {
            return AnyTaskWithExtraContext{
                .callback = wrap,
                .ctx = ctx,
            };
        }

        pub fn wrap(this: ?*anyopaque, extra: ?*anyopaque) void {
            @call(
                .always_inline,
                Callback,
                .{
                    @as(*Type, @ptrCast(@alignCast(this.?))),
                    @as(*ContextType, @ptrCast(@alignCast(extra.?))),
                },
            );
        }
    };
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const Task = JSC.Task;
