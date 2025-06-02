//! A task that runs concurrently in the work pool.
//!
//! This is used to run tasks that are CPU-intensive or blocking on the work pool.
//! It's also used to run tasks that need to be run on a different thread than the main JavaScript thread.
//!
//! The task is run on a thread pool and then the result is returned to the main JavaScript thread.
//!
//! If `auto_delete` is true, the task is automatically deallocated when it's finished.
//! Otherwise, it's expected that the containing struct will deallocate the task.
const ConcurrentTask = @This();

task: Task = undefined,
next: ?*ConcurrentTask = null,
auto_delete: bool = false,

pub const Queue = UnboundedQueue(ConcurrentTask, .next);
pub const new = bun.TrivialNew(@This());
pub const deinit = bun.TrivialDeinit(@This());

pub const AutoDeinit = enum {
    manual_deinit,
    auto_deinit,
};
pub fn create(task: Task) *ConcurrentTask {
    return ConcurrentTask.new(.{
        .task = task,
        .next = null,
        .auto_delete = true,
    });
}

pub fn createFrom(task: anytype) *ConcurrentTask {
    JSC.markBinding(@src());
    return create(Task.init(task));
}

pub fn fromCallback(ptr: anytype, comptime callback: anytype) *ConcurrentTask {
    JSC.markBinding(@src());

    return create(ManagedTask.New(std.meta.Child(@TypeOf(ptr)), callback).init(ptr));
}

pub fn from(this: *ConcurrentTask, of: anytype, auto_deinit: AutoDeinit) *ConcurrentTask {
    JSC.markBinding(@src());

    this.* = .{
        .task = Task.init(of),
        .next = null,
        .auto_delete = auto_deinit == .auto_deinit,
    };
    return this;
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const Task = JSC.Task;
const UnboundedQueue = @import("../unbounded_queue.zig").UnboundedQueue;
const ManagedTask = JSC.ManagedTask;
