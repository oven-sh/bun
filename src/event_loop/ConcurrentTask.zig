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
/// Packed representation of the next pointer and auto_delete flag.
/// Uses the low bit to store auto_delete (since pointers are at least 2-byte aligned).
next: PackedNextPtr = .none,

/// Packed next pointer that encodes both the next ConcurrentTask pointer and the auto_delete flag.
/// Uses the low bit for auto_delete since ConcurrentTask pointers are at least 2-byte aligned.
pub const PackedNextPtr = enum(usize) {
    none = 0,
    auto_delete = 1,
    _,

    pub inline fn init(ptr: ?*ConcurrentTask, auto_del: bool) PackedNextPtr {
        const ptr_bits = if (ptr) |p| @intFromPtr(p) else 0;
        return @enumFromInt(ptr_bits | @intFromBool(auto_del));
    }

    pub inline fn getPtr(self: PackedNextPtr) ?*ConcurrentTask {
        const addr = @intFromEnum(self) & ~@as(usize, 1);
        return if (addr == 0) null else @ptrFromInt(addr);
    }

    pub inline fn setPtr(self: *PackedNextPtr, ptr: ?*ConcurrentTask) void {
        const auto_del = @intFromEnum(self.*) & 1;
        const ptr_bits = if (ptr) |p| @intFromPtr(p) else 0;
        self.* = @enumFromInt(ptr_bits | auto_del);
    }

    pub inline fn isAutoDelete(self: PackedNextPtr) bool {
        return (@intFromEnum(self) & 1) != 0;
    }

    pub inline fn atomicLoadPtr(self: *const PackedNextPtr, ordering: std.builtin.AtomicOrder) ?*ConcurrentTask {
        const value = @atomicLoad(usize, @as(*const usize, @ptrCast(self)), ordering);
        const addr = value & ~@as(usize, 1);
        return if (addr == 0) null else @ptrFromInt(addr);
    }

    pub inline fn atomicStorePtr(self: *PackedNextPtr, ptr: ?*ConcurrentTask, ordering: std.builtin.AtomicOrder) void {
        const ptr_bits = if (ptr) |p| @intFromPtr(p) else 0;
        // auto_delete is immutable after construction, so we can safely read it
        // with a relaxed load and preserve it in the new value.
        const self_ptr: *usize = @ptrCast(self);
        const auto_del_bit = @atomicLoad(usize, self_ptr, .monotonic) & 1;
        @atomicStore(usize, self_ptr, ptr_bits | auto_del_bit, ordering);
    }
};

comptime {
    if (@sizeOf(ConcurrentTask) != 16) {
        @compileError("ConcurrentTask should be 16 bytes, but is " ++ std.fmt.comptimePrint("{}", .{@sizeOf(ConcurrentTask)}) ++ " bytes");
    }
    // PackedNextPtr stores a pointer in the upper bits and auto_delete in bit 0.
    // This requires ConcurrentTask to be at least 2-byte aligned.
    if (@alignOf(ConcurrentTask) < 2) {
        @compileError("ConcurrentTask must be at least 2-byte aligned for pointer packing, but alignment is " ++ std.fmt.comptimePrint("{}", .{@alignOf(ConcurrentTask)}));
    }
}

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
        .next = .auto_delete,
    });
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
        .next = if (auto_deinit == .auto_deinit) .auto_delete else .none,
    };
    return this;
}

/// Returns whether this task should be automatically deallocated after execution.
pub fn autoDelete(this: *const ConcurrentTask) bool {
    return this.next.isAutoDelete();
}

const std = @import("std");

const bun = @import("bun");
const UnboundedQueue = bun.UnboundedQueue;

const jsc = bun.jsc;
const ManagedTask = jsc.ManagedTask;
const Task = jsc.Task;
