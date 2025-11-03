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
next: PackedNext = .zero,

pub const PackedNext = enum(usize) {
    // Store the full usize pointer with auto_delete flag in the low alignment bit
    // ConcurrentTask contains a u64 Task field, so it's at least 8-byte aligned
    // This preserves all pointer metadata (ARM TBI/PAC/MTE tags, etc.)
    zero = 0,
    _,

    const AUTO_DELETE_MASK: usize = 0x1;
    const POINTER_MASK: usize = ~AUTO_DELETE_MASK;

    pub fn init(ptr: ?*ConcurrentTask) PackedNext {
        if (ptr) |p| {
            const addr = @intFromPtr(p);
            // Pointer should be aligned, verify low bit is zero
            if (bun.Environment.allow_assert) {
                bun.assertf((addr & AUTO_DELETE_MASK) == 0, "ConcurrentTask pointer must be aligned", .{});
            }
            // Store pointer with auto_delete = false (low bit = 0)
            return @enumFromInt(addr);
        }
        return @enumFromInt(0);
    }

    pub fn initPreserveAutoDelete(self: PackedNext, ptr: ?*ConcurrentTask) PackedNext {
        const self_val = @intFromEnum(self);
        if (ptr) |p| {
            const addr = @intFromPtr(p);
            // Pointer should be aligned, verify low bit is zero
            if (bun.Environment.allow_assert) {
                bun.assertf((addr & AUTO_DELETE_MASK) == 0, "ConcurrentTask pointer must be aligned", .{});
            }
            // Combine new pointer with existing auto_delete flag
            return @enumFromInt(addr | (self_val & AUTO_DELETE_MASK));
        }
        // Null pointer but preserve auto_delete flag
        return @enumFromInt(self_val & AUTO_DELETE_MASK);
    }

    pub fn get(self: PackedNext) ?*ConcurrentTask {
        // Mask out the auto_delete bit to get the original pointer
        const addr = @intFromEnum(self) & POINTER_MASK;
        if (addr == 0) return null;
        return @ptrFromInt(addr);
    }

    pub fn autoDelete(self: PackedNext) bool {
        return (@intFromEnum(self) & AUTO_DELETE_MASK) != 0;
    }

    pub fn setAutoDelete(self: *PackedNext, value: bool) void {
        // Non-atomic write is safe because this is only called during initialization
        // before the task is shared with other threads
        const self_val = @intFromEnum(self.*);
        if (value) {
            self.* = @enumFromInt(self_val | AUTO_DELETE_MASK);
        } else {
            self.* = @enumFromInt(self_val & POINTER_MASK);
        }
    }

    comptime {
        if (@sizeOf(PackedNext) != @sizeOf(usize)) {
            @compileError("PackedNext must be the same size as a usize");
        }
    }
};

pub const Queue = bun.threading.UnboundedQueuePacked(ConcurrentTask, .next, .@"packed");
pub const new = bun.TrivialNew(@This());
pub const deinit = bun.TrivialDeinit(@This());

/// Returns whether this task should be automatically deleted after completion.
/// The auto_delete flag being stored in the next field is an implementation detail.
pub inline fn auto_delete(this: *const ConcurrentTask) bool {
    return this.next.autoDelete();
}

pub const AutoDeinit = enum {
    manual_deinit,
    auto_deinit,
};
pub fn create(task: Task) *ConcurrentTask {
    var concurrent_task = ConcurrentTask.new(.{
        .task = task,
        .next = .zero,
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
        .next = .zero,
    };
    this.next.setAutoDelete(auto_deinit == .auto_deinit);
    return this;
}

comptime {
    // Verify that ConcurrentTask is 16 bytes (not 24)
    // Task is 8 bytes (u64), PackedNext is 8 bytes (u64) = 16 bytes total
    if (@sizeOf(ConcurrentTask) != 16) {
        @compileError(bun.fmt.comptimePrint("ConcurrentTask should be 16 bytes, but it's {d} bytes", .{@sizeOf(ConcurrentTask)}));
    }
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const ManagedTask = jsc.ManagedTask;
const Task = jsc.Task;
