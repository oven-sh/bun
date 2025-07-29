//! Copy of std.Thread.Condition, but uses Bun's Mutex and Futex.
//! Synchronized with std as of Zig 0.14.1.
//!
//! Condition variables are used with a Mutex to efficiently wait for an arbitrary condition to occur.
//! It does this by atomically unlocking the mutex, blocking the thread until notified, and finally re-locking the mutex.
//! Condition can be statically initialized and is at most `@sizeOf(u64)` large.
//!
//! Example:
//! ```
//! var m = Mutex{};
//! var c = Condition{};
//! var predicate = false;
//!
//! fn consumer() void {
//!     m.lock();
//!     defer m.unlock();
//!
//!     while (!predicate) {
//!         c.wait(&m);
//!     }
//! }
//!
//! fn producer() void {
//!     {
//!         m.lock();
//!         defer m.unlock();
//!         predicate = true;
//!     }
//!     c.signal();
//! }
//!
//! const thread = try std.Thread.spawn(.{}, producer, .{});
//! consumer();
//! thread.join();
//! ```
//!
//! Note that condition variables can only reliably unblock threads that are sequenced before them using the same Mutex.
//! This means that the following is allowed to deadlock:
//! ```
//! thread-1: mutex.lock()
//! thread-1: condition.wait(&mutex)
//!
//! thread-2: // mutex.lock() (without this, the following signal may not see the waiting thread-1)
//! thread-2: // mutex.unlock() (this is optional for correctness once locked above, as signal can be called while holding the mutex)
//! thread-2: condition.signal()
//! ```

const Condition = @This();

impl: Impl = .{},

/// Atomically releases the Mutex, blocks the caller thread, then re-acquires the Mutex on return.
/// "Atomically" here refers to accesses done on the Condition after acquiring the Mutex.
///
/// The Mutex must be locked by the caller's thread when this function is called.
/// A Mutex can have multiple Conditions waiting with it concurrently, but not the opposite.
/// It is undefined behavior for multiple threads to wait ith different mutexes using the same Condition concurrently.
/// Once threads have finished waiting with one Mutex, the Condition can be used to wait with another Mutex.
///
/// A blocking call to wait() is unblocked from one of the following conditions:
/// - a spurious ("at random") wake up occurs
/// - a future call to `signal()` or `broadcast()` which has acquired the Mutex and is sequenced after this `wait()`.
///
/// Given wait() can be interrupted spuriously, the blocking condition should be checked continuously
/// irrespective of any notifications from `signal()` or `broadcast()`.
pub fn wait(self: *Condition, mutex: *Mutex) void {
    self.impl.wait(mutex, null) catch |err| switch (err) {
        error.Timeout => unreachable, // no timeout provided so we shouldn't have timed-out
    };
}

/// Atomically releases the Mutex, blocks the caller thread, then re-acquires the Mutex on return.
/// "Atomically" here refers to accesses done on the Condition after acquiring the Mutex.
///
/// The Mutex must be locked by the caller's thread when this function is called.
/// A Mutex can have multiple Conditions waiting with it concurrently, but not the opposite.
/// It is undefined behavior for multiple threads to wait ith different mutexes using the same Condition concurrently.
/// Once threads have finished waiting with one Mutex, the Condition can be used to wait with another Mutex.
///
/// A blocking call to `timedWait()` is unblocked from one of the following conditions:
/// - a spurious ("at random") wake occurs
/// - the caller was blocked for around `timeout_ns` nanoseconds, in which `error.Timeout` is returned.
/// - a future call to `signal()` or `broadcast()` which has acquired the Mutex and is sequenced after this `timedWait()`.
///
/// Given `timedWait()` can be interrupted spuriously, the blocking condition should be checked continuously
/// irrespective of any notifications from `signal()` or `broadcast()`.
pub fn timedWait(self: *Condition, mutex: *Mutex, timeout_ns: u64) error{Timeout}!void {
    return self.impl.wait(mutex, timeout_ns);
}

/// Unblocks at least one thread blocked in a call to `wait()` or `timedWait()` with a given Mutex.
/// The blocked thread must be sequenced before this call with respect to acquiring the same Mutex in order to be observable for unblocking.
/// `signal()` can be called with or without the relevant Mutex being acquired and have no "effect" if there's no observable blocked threads.
pub fn signal(self: *Condition) void {
    self.impl.wake(.one);
}

/// Unblocks all threads currently blocked in a call to `wait()` or `timedWait()` with a given Mutex.
/// The blocked threads must be sequenced before this call with respect to acquiring the same Mutex in order to be observable for unblocking.
/// `broadcast()` can be called with or without the relevant Mutex being acquired and have no "effect" if there's no observable blocked threads.
pub fn broadcast(self: *Condition) void {
    self.impl.wake(.all);
}

const Impl = if (builtin.os.tag == .windows)
    WindowsImpl
else
    FutexImpl;

const Notify = enum {
    one, // wake up only one thread
    all, // wake up all threads
};

const WindowsImpl = struct {
    condition: os.windows.CONDITION_VARIABLE = .{},

    fn wait(self: *Impl, mutex: *Mutex, timeout: ?u64) error{Timeout}!void {
        var timeout_overflowed = false;
        var timeout_ms: os.windows.DWORD = os.windows.INFINITE;

        if (timeout) |timeout_ns| {
            // Round the nanoseconds to the nearest millisecond,
            // then saturating cast it to windows DWORD for use in kernel32 call.
            const ms = (timeout_ns +| (std.time.ns_per_ms / 2)) / std.time.ns_per_ms;
            timeout_ms = std.math.cast(os.windows.DWORD, ms) orelse std.math.maxInt(os.windows.DWORD);

            // Track if the timeout overflowed into INFINITE and make sure not to wait forever.
            if (timeout_ms == os.windows.INFINITE) {
                timeout_overflowed = true;
                timeout_ms -= 1;
            }
        }

        if (builtin.mode == .Debug) {
            // The internal state of the DebugMutex needs to be handled here as well.
            mutex.impl.locking_thread.store(0, .unordered);
        }
        const rc = os.windows.kernel32.SleepConditionVariableSRW(
            &self.condition,
            if (builtin.mode == .Debug) &mutex.impl.impl.srwlock else &mutex.impl.srwlock,
            timeout_ms,
            0, // the srwlock was assumed to acquired in exclusive mode not shared
        );
        if (builtin.mode == .Debug) {
            // The internal state of the DebugMutex needs to be handled here as well.
            mutex.impl.locking_thread.store(std.Thread.getCurrentId(), .unordered);
        }

        // Return error.Timeout if we know the timeout elapsed correctly.
        if (rc == os.windows.FALSE) {
            assert(os.windows.GetLastError() == .TIMEOUT);
            if (!timeout_overflowed) return error.Timeout;
        }
    }

    fn wake(self: *Impl, comptime notify: Notify) void {
        switch (notify) {
            .one => os.windows.kernel32.WakeConditionVariable(&self.condition),
            .all => os.windows.kernel32.WakeAllConditionVariable(&self.condition),
        }
    }
};

const FutexImpl = struct {
    state: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    epoch: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),

    const one_waiter = 1;
    const waiter_mask = 0xffff;

    const one_signal = 1 << 16;
    const signal_mask = 0xffff << 16;

    fn wait(self: *Impl, mutex: *Mutex, timeout: ?u64) error{Timeout}!void {
        // Observe the epoch, then check the state again to see if we should wake up.
        // The epoch must be observed before we check the state or we could potentially miss a wake() and deadlock:
        //
        // - T1: s = LOAD(&state)
        // - T2: UPDATE(&s, signal)
        // - T2: UPDATE(&epoch, 1) + FUTEX_WAKE(&epoch)
        // - T1: e = LOAD(&epoch) (was reordered after the state load)
        // - T1: s & signals == 0 -> FUTEX_WAIT(&epoch, e) (missed the state update + the epoch change)
        //
        // Acquire barrier to ensure the epoch load happens before the state load.
        var epoch = self.epoch.load(.acquire);
        var state = self.state.fetchAdd(one_waiter, .monotonic);
        assert(state & waiter_mask != waiter_mask);
        state += one_waiter;

        mutex.unlock();
        defer mutex.lock();

        var futex_deadline = Futex.Deadline.init(timeout);

        while (true) {
            futex_deadline.wait(&self.epoch, epoch) catch |err| switch (err) {
                // On timeout, we must decrement the waiter we added above.
                error.Timeout => {
                    while (true) {
                        // If there's a signal when we're timing out, consume it and report being woken up instead.
                        // Acquire barrier ensures code before the wake() which added the signal happens before we decrement it and return.
                        while (state & signal_mask != 0) {
                            const new_state = state - one_waiter - one_signal;
                            state = self.state.cmpxchgWeak(state, new_state, .acquire, .monotonic) orelse return;
                        }

                        // Remove the waiter we added and officially return timed out.
                        const new_state = state - one_waiter;
                        state = self.state.cmpxchgWeak(state, new_state, .monotonic, .monotonic) orelse return err;
                    }
                },
            };

            epoch = self.epoch.load(.acquire);
            state = self.state.load(.monotonic);

            // Try to wake up by consuming a signal and decremented the waiter we added previously.
            // Acquire barrier ensures code before the wake() which added the signal happens before we decrement it and return.
            while (state & signal_mask != 0) {
                const new_state = state - one_waiter - one_signal;
                state = self.state.cmpxchgWeak(state, new_state, .acquire, .monotonic) orelse return;
            }
        }
    }

    fn wake(self: *Impl, comptime notify: Notify) void {
        var state = self.state.load(.monotonic);
        while (true) {
            const waiters = (state & waiter_mask) / one_waiter;
            const signals = (state & signal_mask) / one_signal;

            // Reserves which waiters to wake up by incrementing the signals count.
            // Therefore, the signals count is always less than or equal to the waiters count.
            // We don't need to Futex.wake if there's nothing to wake up or if other wake() threads have reserved to wake up the current waiters.
            const wakeable = waiters - signals;
            if (wakeable == 0) {
                return;
            }

            const to_wake = switch (notify) {
                .one => 1,
                .all => wakeable,
            };

            // Reserve the amount of waiters to wake by incrementing the signals count.
            // Release barrier ensures code before the wake() happens before the signal it posted and consumed by the wait() threads.
            const new_state = state + (one_signal * to_wake);
            state = self.state.cmpxchgWeak(state, new_state, .release, .monotonic) orelse {
                // Wake up the waiting threads we reserved above by changing the epoch value.
                // NOTE: a waiting thread could miss a wake up if *exactly* ((1<<32)-1) wake()s happen between it observing the epoch and sleeping on it.
                // This is very unlikely due to how many precise amount of Futex.wake() calls that would be between the waiting thread's potential preemption.
                //
                // Release barrier ensures the signal being added to the state happens before the epoch is changed.
                // If not, the waiting thread could potentially deadlock from missing both the state and epoch change:
                //
                // - T2: UPDATE(&epoch, 1) (reordered before the state change)
                // - T1: e = LOAD(&epoch)
                // - T1: s = LOAD(&state)
                // - T2: UPDATE(&state, signal) + FUTEX_WAKE(&epoch)
                // - T1: s & signals == 0 -> FUTEX_WAIT(&epoch, e) (missed both epoch change and state change)
                _ = self.epoch.fetchAdd(1, .release);
                Futex.wake(&self.epoch, to_wake);
                return;
            };
        }
    }
};

const builtin = @import("builtin");

const bun = @import("bun");
const Futex = bun.Futex;
const Mutex = bun.Mutex;
const assert = bun.assert;

const std = @import("std");
const os = std.os;
