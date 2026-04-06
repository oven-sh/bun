//! This type helps detect race conditions in debug/`ci_assert` builds.
//!
//! Store an instance of this type in or alongside shared data. Then, add the following to any
//! block of code that accesses the shared data:
//!
//!     shared_data.critical_section.begin();
//!     defer shared_data.critical_section.end();
//!     // (do stuff with shared_data...)
//!
//! If a mutex is being used to ensure threads don't access the data simultaneously, call `begin`
//! *after* locking the mutex, and call `end` before releasing it, since it's the code that runs
//! when the mutex is held that needs to be prevented from concurrent execution.
//!
//! In code that only *reads* the shared data, and does not write to it, `beginReadOnly` can be
//! used instead. This allows multiple threads to read the data simultaneously, but will still
//! error if a thread tries to modify it (via calling `begin`).
//!
//!     shared_data.critical_section.beginReadOnly();
//!     defer shared_data.critical_section.end();
//!     // (do *read-only* stuff with shared_data...)
//!
//! One use of this type could be to ensure that single-threaded containers aren't being used
//! concurrently without appropriate synchronization. For example, each method in an `ArrayList`
//! could start with a call to `begin` or `beginReadOnly` and end with a call to `end`. Then, an
//! `ArrayList` used by only one thread, or one used by multiple threads but synchronized via a
//! mutex, won't cause an error, but an `ArrayList` used by multiple threads concurrently without
//! synchronization, assuming at least one thread is modifying the data, will cause an error.

const Self = @This();

internal_state: if (enabled) State else void = if (enabled) .{},

const OptionalThreadId = struct {
    inner: Thread.Id,

    pub fn init(id: Thread.Id) OptionalThreadId {
        return .{ .inner = id };
    }

    pub fn format(self: OptionalThreadId, writer: *std.Io.Writer) !void {
        if (self.inner == invalid_thread_id) {
            try writer.writeAll("another thread");
        } else {
            try writer.print("thread {}", .{self.inner});
        }
    }
};

/// A reentrant lock that prevents multiple threads from accessing data at the same time,
/// except if all threads' use of the data is read-only.
const State = struct {
    /// The ID of the thread that first acquired the lock (the "owner thread").
    thread_id: std.atomic.Value(Thread.Id) = .init(invalid_thread_id),

    /// Stack trace of the first time the owner thread acquired the lock (that is, when it became
    /// the owner).
    owner_trace: if (traces_enabled) StoredTrace else void = if (traces_enabled) StoredTrace.empty,

    /// Number of nested calls to `lockShared`/`lockExclusive` performed on the owner thread.
    /// Only accessed on the owner thread.
    owned_count: u32 = 0,

    /// Number of (possibly nested) calls to `lockShared` performed on any thread except the
    /// owner thread.
    count: std.atomic.Value(u32) = .init(0),

    /// If `count` is set to this value, it indicates that a thread has requested exclusive
    /// (read/write) access.
    const exclusive = std.math.maxInt(u32);

    fn getOrBecomeOwner(self: *State) Thread.Id {
        const current_id = Thread.getCurrentId();
        // .monotonic is okay because we don't need to synchronize-with other threads; we just need
        // to make sure that only one thread succeeds in setting the value.
        return self.thread_id.cmpxchgStrong(
            invalid_thread_id,
            current_id,
            .monotonic,
            .monotonic,
        ) orelse {
            if (comptime traces_enabled) {
                self.owner_trace = StoredTrace.capture(@returnAddress());
            }
            return current_id;
        };
    }

    fn showTrace(self: *State) void {
        if (comptime !traces_enabled) return;
        bun.Output.err("race condition", "`CriticalSection` first entered here:", .{});
        bun.crash_handler.dumpStackTrace(
            self.owner_trace.trace(),
            .{ .frame_count = 10, .stop_at_jsc_llint = true },
        );
    }

    /// Acquire the lock for shared (read-only) access.
    fn lockShared(self: *State) void {
        const current_id = Thread.getCurrentId();
        const owner_id = self.getOrBecomeOwner();
        if (owner_id == current_id) {
            self.owned_count += 1;
        } else if (self.count.fetchAdd(1, .monotonic) == exclusive) {
            self.showTrace();
            std.debug.panic(
                "race condition: thread {} tried to read data being modified by {}",
                .{ current_id, OptionalThreadId.init(owner_id) },
            );
        }
    }

    /// Acquire the lock for exclusive (read/write) access.
    fn lockExclusive(self: *State) void {
        const current_id = Thread.getCurrentId();
        const owner_id = self.getOrBecomeOwner();
        if (owner_id == current_id) {
            // .monotonic is okay because concurrent access is an error.
            switch (self.count.swap(exclusive, .monotonic)) {
                0, exclusive => {},
                else => {
                    self.showTrace();
                    std.debug.panic(
                        "race condition: thread {} tried to modify data being read by {f}",
                        .{ current_id, OptionalThreadId.init(owner_id) },
                    );
                },
            }
            self.owned_count += 1;
        } else {
            self.showTrace();
            std.debug.panic(
                "race condition: thread {} tried to modify data being accessed by {f}",
                .{ current_id, OptionalThreadId.init(owner_id) },
            );
        }
    }

    /// Release the lock.
    fn unlock(self: *State) void {
        const current_id = Thread.getCurrentId();
        // .monotonic is okay because this value shouldn't change until all locks are released, and
        // we currently hold a lock.
        const owner_id = self.thread_id.load(.monotonic);

        // It's possible for this thread to be the owner (`owner_id == current_id`) and for
        // `owned_count` to be 0, if this thread originally wasn't the owner, but became the owner
        // when the original owner released all of its locks. In this case, some of the lock count
        // for this thread is still in `self.count` rather than `self.owned_count`.
        if (owner_id == current_id and self.owned_count > 0) {
            self.owned_count -= 1;
            if (self.owned_count == 0) {
                // .monotonic is okay because:
                // * If this succeeds, it means the current thread holds an exclusive lock, so
                //   concurrent access would be an error.
                // * If this fails, we don't care about the value.
                _ = self.count.cmpxchgStrong(exclusive, 0, .monotonic, .monotonic);
                // .monotonic is okay because another thread that loads `thread_id` should not rely
                // on that load to synchronize-with the update to `self.count` above; other
                // synchronization should have already been performed. (This type is not meant to
                // provide its own synchronization, but rather assert that such synchronization has
                // already been provided.)
                self.thread_id.store(invalid_thread_id, .monotonic);
            }
        } else switch (self.count.fetchSub(1, .monotonic)) {
            // The .monotonic `fetchSub` above is okay because we don't need to synchronize-with
            // other threads (this type is not meant to provide its own synchronization).
            0 => std.debug.panic("called `CriticalSection.end` too many times", .{}),
            exclusive => std.debug.panic(
                "count should not be `exclusive` if multiple threads hold the lock",
                .{},
            ),
            else => {},
        }
    }
};

/// Marks the beginning of a critical section which accesses (and potentially modifies) shared data.
/// Calls to this function can be nested; each must be paired with a call to `end`.
pub fn begin(self: *Self) void {
    if (comptime enabled) self.internal_state.lockExclusive();
}

/// Marks the beginning of a critical section which performs read-only accesses on shared data.
/// Calls to this function can be nested; each must be paired with a call to `end`.
pub fn beginReadOnly(self: *Self) void {
    if (comptime enabled) self.internal_state.lockShared();
}

/// Marks the end of a critical section started by `begin` or `beginReadOnly`.
pub fn end(self: *Self) void {
    if (comptime enabled) self.internal_state.unlock();
}

pub const enabled = bun.Environment.ci_assert;

const bun = @import("bun");
const invalid_thread_id = @import("./thread_id.zig").invalid;
const StoredTrace = bun.crash_handler.StoredTrace;
const traces_enabled = bun.Environment.isDebug;

const std = @import("std");
const Thread = std.Thread;
