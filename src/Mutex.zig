//! This is a copy-pasta of std.Thread.Mutex with some changes.
//! - No assert with unreachable
//! - uses bun.Futex instead of std.Thread.Futex
//! Mutex is a synchronization primitive which enforces atomic access to a shared region of code known as the "critical section".
//! It does this by blocking ensuring only one thread is in the critical section at any given point in time by blocking the others.
//! Mutex can be statically initialized and is at most `@sizeOf(u64)` large.
//! Use `lock()` or `tryLock()` to enter the critical section and `unlock()` to leave it.
//!
//! Example:
//! ```
//! var m = Mutex{};
//!
//! {
//!     m.lock();
//!     defer m.unlock();
//!     // ... critical section code
//! }
//!
//! if (m.tryLock()) {
//!     defer m.unlock();
//!     // ... critical section code
//! }
//! ```

const std = @import("std");
const builtin = @import("builtin");
const bun = @import("bun");
const assert = bun.assert;
const Thread = std.Thread;
const Futex = bun.Futex;

impl: Impl = .{},

/// Tries to acquire the mutex without blocking the caller's thread.
/// Returns `false` if the calling thread would have to block to acquire it.
/// Otherwise, returns `true` and the caller should `unlock()` the Mutex to release it.
pub fn tryLock(self: *Mutex) bool {
    return self.impl.tryLock();
}

/// Acquires the mutex, blocking the caller's thread until it can.
/// It is undefined behavior if the mutex is already held by the caller's thread.
/// Once acquired, call `unlock()` on the Mutex to release it.
pub fn lock(self: *Mutex) void {
    self.impl.lock();
}

/// Releases the mutex which was previously acquired with `lock()` or `tryLock()`.
/// It is undefined behavior if the mutex is unlocked from a different thread that it was locked from.
pub fn unlock(self: *Mutex) void {
    self.impl.unlock();
}

const Impl = if (builtin.mode == .Debug and !builtin.single_threaded)
    DebugImpl
else
    ReleaseImpl;

pub const ReleaseImpl =
    if (builtin.os.tag == .windows)
        WindowsImpl
    else if (builtin.os.tag.isDarwin())
        DarwinImpl
    else
        FutexImpl;

pub const ExternImpl = ReleaseImpl.Type;

const DebugImpl = struct {
    locking_thread: std.atomic.Value(Thread.Id) = std.atomic.Value(Thread.Id).init(0), // 0 means it's not locked.
    impl: ReleaseImpl = .{},

    inline fn tryLock(self: *@This()) bool {
        const locking = self.impl.tryLock();
        if (locking) {
            self.locking_thread.store(Thread.getCurrentId(), .unordered);
        }
        return locking;
    }

    inline fn lock(self: *@This()) void {
        const current_id = Thread.getCurrentId();
        if (self.locking_thread.load(.unordered) == current_id and current_id != 0) {
            @panic("Deadlock detected");
        }
        self.impl.lock();
        self.locking_thread.store(current_id, .unordered);
    }

    inline fn unlock(self: *@This()) void {
        assert(self.locking_thread.load(.unordered) == Thread.getCurrentId());
        self.locking_thread.store(0, .unordered);
        self.impl.unlock();
    }
};

// SRWLOCK on windows is almost always faster than Futex solution.
// It also implements an efficient Condition with requeue support for us.
const WindowsImpl = struct {
    srwlock: Type = .{},

    fn tryLock(self: *@This()) bool {
        return windows.kernel32.TryAcquireSRWLockExclusive(&self.srwlock) != windows.FALSE;
    }

    fn lock(self: *@This()) void {
        windows.kernel32.AcquireSRWLockExclusive(&self.srwlock);
    }

    fn unlock(self: *@This()) void {
        windows.kernel32.ReleaseSRWLockExclusive(&self.srwlock);
    }

    const windows = std.os.windows;

    pub const Type = windows.SRWLOCK;
};

// os_unfair_lock on darwin supports priority inheritance and is generally faster than Futex solutions.
const DarwinImpl = struct {
    oul: Type = .{},

    fn tryLock(self: *@This()) bool {
        return c.os_unfair_lock_trylock(&self.oul);
    }

    fn lock(self: *@This()) void {
        c.os_unfair_lock_lock(&self.oul);
    }

    fn unlock(self: *@This()) void {
        c.os_unfair_lock_unlock(&self.oul);
    }

    const c = std.c;
    pub const Type = c.os_unfair_lock;
};

const FutexImpl = struct {
    state: std.atomic.Value(u32) = std.atomic.Value(u32).init(unlocked),

    const unlocked: u32 = 0b00;
    const locked: u32 = 0b01;
    const contended: u32 = 0b11; // must contain the `locked` bit for x86 optimization below

    fn lock(self: *@This()) void {
        if (!self.tryLock())
            self.lockSlow();
    }

    fn tryLock(self: *@This()) bool {
        // On x86, use `lock bts` instead of `lock cmpxchg` as:
        // - they both seem to mark the cache-line as modified regardless: https://stackoverflow.com/a/63350048
        // - `lock bts` is smaller instruction-wise which makes it better for inlining
        if (comptime builtin.target.cpu.arch.isX86()) {
            const locked_bit = @ctz(locked);
            return self.state.bitSet(locked_bit, .acquire) == 0;
        }

        // Acquire barrier ensures grabbing the lock happens before the critical section
        // and that the previous lock holder's critical section happens before we grab the lock.
        return self.state.cmpxchgWeak(unlocked, locked, .acquire, .monotonic) == null;
    }

    fn lockSlow(self: *@This()) void {
        @branchHint(.cold);

        // Avoid doing an atomic swap below if we already know the state is contended.
        // An atomic swap unconditionally stores which marks the cache-line as modified unnecessarily.
        if (self.state.load(.monotonic) == contended) {
            Futex.waitForever(&self.state, contended);
        }

        // Try to acquire the lock while also telling the existing lock holder that there are threads waiting.
        //
        // Once we sleep on the Futex, we must acquire the mutex using `contended` rather than `locked`.
        // If not, threads sleeping on the Futex wouldn't see the state change in unlock and potentially deadlock.
        // The downside is that the last mutex unlocker will see `contended` and do an unnecessary Futex wake
        // but this is better than having to wake all waiting threads on mutex unlock.
        //
        // Acquire barrier ensures grabbing the lock happens before the critical section
        // and that the previous lock holder's critical section happens before we grab the lock.
        while (self.state.swap(contended, .acquire) != unlocked) {
            Futex.waitForever(&self.state, contended);
        }
    }

    fn unlock(self: *@This()) void {
        // Unlock the mutex and wake up a waiting thread if any.
        //
        // A waiting thread will acquire with `contended` instead of `locked`
        // which ensures that it wakes up another thread on the next unlock().
        //
        // Release barrier ensures the critical section happens before we let go of the lock
        // and that our critical section happens before the next lock holder grabs the lock.
        const state = self.state.swap(unlocked, .release);
        assert(state != unlocked);

        if (state == contended) {
            Futex.wake(&self.state, 1);
        }
    }

    pub const Type = u32;
};

const Mutex = @This();

pub fn spinCycle() void {}

// These have to be a size known to C.
export fn Bun__lock(ptr: *ReleaseImpl) void {
    ptr.lock();
}

// These have to be a size known to C.
export fn Bun__unlock(ptr: *ReleaseImpl) void {
    ptr.unlock();
}

export const Bun__lock__size: usize = @sizeOf(ReleaseImpl);
