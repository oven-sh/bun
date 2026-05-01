pub const ThreadSafety = enum {
    single_threaded,
    thread_safe,
};

pub const DecrementResult = enum {
    keep_alive,
    should_destroy,
};

/// A simple wrapper around an integer reference count. This type doesn't do any memory management
/// itself.
///
/// This type may be useful for implementing the interface required by `bun.ptr.ExternalShared`.
pub fn RawRefCount(comptime Int: type, comptime thread_safety: ThreadSafety) type {
    return struct {
        const Self = @This();

        raw_value: if (thread_safety == .thread_safe) std.atomic.Value(Int) else Int,
        #thread_lock: if (thread_safety == .single_threaded) bun.safety.ThreadLock else void,

        /// Usually the initial count should be 1.
        pub fn init(initial_count: Int) Self {
            return .{
                .raw_value = switch (comptime thread_safety) {
                    .single_threaded => initial_count,
                    .thread_safe => .init(initial_count),
                },
                .#thread_lock = switch (comptime thread_safety) {
                    .single_threaded => .initLockedIfNonComptime(),
                    .thread_safe => {},
                },
            };
        }

        pub fn increment(self: *Self) void {
            switch (comptime thread_safety) {
                .single_threaded => {
                    self.#thread_lock.lockOrAssert();
                    self.raw_value += 1;
                },
                .thread_safe => {
                    const old = self.raw_value.fetchAdd(1, .monotonic);
                    bun.assertf(
                        old != std.math.maxInt(Int),
                        "overflow of thread-safe ref count",
                        .{},
                    );
                },
            }
        }

        pub fn decrement(self: *Self) DecrementResult {
            const new_count = blk: switch (comptime thread_safety) {
                .single_threaded => {
                    self.#thread_lock.lockOrAssert();
                    self.raw_value -= 1;
                    break :blk self.raw_value;
                },
                .thread_safe => {
                    const old = self.raw_value.fetchSub(1, .acq_rel);
                    bun.assertf(old != 0, "underflow of thread-safe ref count", .{});
                    break :blk old - 1;
                },
            };
            return if (new_count == 0) .should_destroy else .keep_alive;
        }

        pub const deinit = void;
    };
}

const bun = @import("bun");
const std = @import("std");
