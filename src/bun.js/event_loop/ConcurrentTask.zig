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
next: PackedNext = .{},

pub const PackedNext = packed struct(u64) {
    ptr_bits: u63 = 0,
    auto_delete: bool = false,

    pub fn init(ptr: ?*ConcurrentTask) PackedNext {
        if (ptr) |p| {
            const addr = @intFromPtr(p);
            return .{
                .ptr_bits = @as(u63, @truncate(addr)),
                .auto_delete = false,
            };
        }
        return .{};
    }

    pub fn initPreserveAutoDelete(self: PackedNext, ptr: ?*ConcurrentTask) PackedNext {
        if (ptr) |p| {
            const addr = @intFromPtr(p);
            return .{
                .ptr_bits = @as(u63, @truncate(addr)),
                .auto_delete = self.auto_delete,
            };
        }
        return .{
            .ptr_bits = 0,
            .auto_delete = self.auto_delete,
        };
    }

    pub fn get(self: PackedNext) ?*ConcurrentTask {
        if (self.ptr_bits == 0) return null;
        const ptr: u64 = @as(u64, self.ptr_bits);
        return @as(?*ConcurrentTask, @ptrFromInt(ptr));
    }

    pub fn autoDelete(self: PackedNext) bool {
        return self.auto_delete;
    }

    pub fn setAutoDelete(self: *PackedNext, value: bool) void {
        // Non-atomic write is safe because this is only called during initialization
        // before the task is shared with other threads
        self.auto_delete = value;
    }

    comptime {
        if (@sizeOf(PackedNext) != @sizeOf(u64)) {
            @compileError("PackedNext must be the same size as a u64");
        }
    }
};

pub const Queue = bun.threading.UnboundedQueuePacked(ConcurrentTask, .next, .@"packed");
pub const new = bun.TrivialNew(@This());
pub const deinit = bun.TrivialDeinit(@This());

pub const AutoDeinit = enum {
    manual_deinit,
    auto_deinit,
};
pub fn create(task: Task) *ConcurrentTask {
    var concurrent_task = ConcurrentTask.new(.{
        .task = task,
        .next = .{},
    });
    concurrent_task.next.setAutoDelete(true);
    return concurrent_task;
}

pub fn createFrom(task: anytype) *ConcurrentTask {
    jsc.markBinding(@src());
    return create(Task.init(task));
}

pub fn fromCallback(ptr: anytype, comptime callback: anytype) *ConcurrentTask {
    jsc.markBinding(@src());

    return create(ManagedTask.New(std.meta.Child(@TypeOf(ptr)), callback).init(ptr));
}

pub fn from(this: *ConcurrentTask, of: anytype, auto_deinit: AutoDeinit) *ConcurrentTask {
    jsc.markBinding(@src());

    this.* = .{
        .task = Task.init(of),
        .next = .{},
    };
    this.next.setAutoDelete(auto_deinit == .auto_deinit);
    return this;
}

const std = @import("std");

const bun = @import("bun");
const UnboundedQueue = bun.threading.UnboundedQueue;

const jsc = bun.jsc;
const ManagedTask = jsc.ManagedTask;
const Task = jsc.Task;

comptime {
    // Verify that ConcurrentTask is 16 bytes (not 24)
    // Task is 8 bytes (u64), PackedNext is 8 bytes (u64) = 16 bytes total
    if (@sizeOf(ConcurrentTask) != 16) {
        @compileError(bun.fmt.comptimePrint("ConcurrentTask should be 16 bytes, but it's {d} bytes", .{@sizeOf(ConcurrentTask)}));
    }
}
