const Self = @This();

owning_thread: if (enabled) Thread.Id else void,
locked_at: if (traces_enabled) StoredTrace else void = if (traces_enabled) StoredTrace.empty,

pub fn initUnlocked() Self {
    return .{ .owning_thread = if (comptime enabled) invalid_thread_id };
}

pub fn initLocked() Self {
    var self = Self.initUnlocked();
    self.lock();
    return self;
}

pub fn initLockedIfNonComptime() Self {
    return if (@inComptime()) .initUnlocked() else .initLocked();
}

pub fn lock(self: *Self) void {
    if (comptime !enabled) return;
    const current = Thread.getCurrentId();
    if (self.owning_thread != invalid_thread_id) {
        if (comptime traces_enabled) {
            bun.Output.err("assertion failure", "`ThreadLock` was already locked here:", .{});
            bun.crash_handler.dumpStackTrace(
                self.locked_at.trace(),
                .{ .frame_count = 10, .stop_at_jsc_llint = true },
            );
        }
        std.debug.panic(
            "tried to lock `ThreadLock` on thread {}, but was already locked by thread {}",
            .{ current, self.owning_thread },
        );
    }
    self.owning_thread = current;
    if (comptime traces_enabled) {
        self.locked_at = StoredTrace.capture(@returnAddress());
    }
}

pub fn unlock(self: *Self) void {
    if (comptime !enabled) return;
    self.assertLocked();
    self.* = .initUnlocked();
}

pub fn assertLocked(self: *const Self) void {
    if (comptime !enabled) return;
    bun.assertf(self.owning_thread != invalid_thread_id, "`ThreadLock` is not locked", .{});
    const current = Thread.getCurrentId();
    bun.assertf(
        self.owning_thread == current,
        "`ThreadLock` is locked by thread {}, not thread {}",
        .{ self.owning_thread, current },
    );
}

/// Acquires the lock if not already locked; otherwise, asserts that the current thread holds the
/// lock.
pub fn lockOrAssert(self: *Self) void {
    if (comptime !enabled) return;
    if (self.owning_thread == invalid_thread_id) {
        self.lock();
    } else {
        self.assertLocked();
    }
}

pub const enabled = bun.Environment.ci_assert;

const bun = @import("bun");
const invalid_thread_id = @import("./thread_id.zig").invalid;
const StoredTrace = bun.crash_handler.StoredTrace;
const traces_enabled = bun.Environment.isDebug;

const std = @import("std");
const Thread = std.Thread;
