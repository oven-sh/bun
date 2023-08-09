const std = @import("std");
const Atomic = std.atomic.Atomic;
const Futex = @import("./futex.zig");

// Credit: this is copypasta from @kprotty. Thank you @kprotty!
pub const Mutex = struct {
    state: Atomic(u32) = Atomic(u32).init(UNLOCKED),

    const UNLOCKED = 0;
    const LOCKED = 0b01;
    const CONTENDED = 0b11;
    const is_x86 = @import("builtin").target.cpu.arch.isX86();

    pub fn tryAcquire(self: *Mutex) bool {
        return self.acquireFast(true);
    }

    pub fn acquire(self: *Mutex) void {
        if (!self.acquireFast(false)) {
            self.acquireSlow();
        }
    }

    inline fn acquireFast(self: *Mutex, comptime strong: bool) bool {
        // On x86, "lock bts" uses less i-cache & can be faster than "lock cmpxchg" below.
        if (comptime is_x86) {
            return self.state.bitSet(@ctz(@as(u32, LOCKED)), .Acquire) == UNLOCKED;
        }

        const cas_fn = comptime switch (strong) {
            true => Atomic(u32).compareAndSwap,
            else => Atomic(u32).tryCompareAndSwap,
        };

        return cas_fn(
            &self.state,
            UNLOCKED,
            LOCKED,
            .Acquire,
            .Monotonic,
        ) == null;
    }

    noinline fn acquireSlow(self: *Mutex) void {
        // Spin a little bit on the Mutex state in the hopes that
        // we can acquire it without having to call Futex.wait().
        // Give up spinning if the Mutex is contended.
        // This helps acquire() latency under micro-contention.
        //
        var spin: u8 = 100;
        while (spin > 0) : (spin -= 1) {
            std.atomic.spinLoopHint();

            switch (self.state.load(.Monotonic)) {
                UNLOCKED => _ = self.state.tryCompareAndSwap(
                    UNLOCKED,
                    LOCKED,
                    .Acquire,
                    .Monotonic,
                ) orelse return,
                LOCKED => continue,
                CONTENDED => break,
                else => unreachable, // invalid Mutex state
            }
        }

        // Make sure the state is CONTENDED before sleeping with Futex so release() can wake us up.
        // Transitioning to CONTENDED may also acquire the mutex in the process.
        //
        // If we sleep, we must acquire the Mutex with CONTENDED to ensure that other threads
        // sleeping on the Futex having seen CONTENDED before are eventually woken up by release().
        // This unfortunately ends up in an extra Futex.wake() for the last thread but that's ok.
        while (true) : (Futex.wait(&self.state, CONTENDED, null) catch unreachable) {
            // On x86, "xchg" can be faster than "lock cmpxchg" below.
            if (comptime is_x86) {
                switch (self.state.swap(CONTENDED, .Acquire)) {
                    UNLOCKED => return,
                    LOCKED, CONTENDED => continue,
                    else => unreachable, // invalid Mutex state
                }
            }

            var state = self.state.load(.Monotonic);
            while (state != CONTENDED) {
                state = switch (state) {
                    UNLOCKED => self.state.tryCompareAndSwap(state, CONTENDED, .Acquire, .Monotonic) orelse return,
                    LOCKED => self.state.tryCompareAndSwap(state, CONTENDED, .Monotonic, .Monotonic) orelse break,
                    CONTENDED => unreachable, // checked above
                    else => unreachable, // invalid Mutex state
                };
            }
        }
    }

    pub fn release(self: *Mutex) void {
        switch (self.state.swap(UNLOCKED, .Release)) {
            UNLOCKED => unreachable, // released without being acquired
            LOCKED => {},
            CONTENDED => Futex.wake(&self.state, 1),
            else => unreachable, // invalid Mutex state
        }
    }
};

pub const Lock = struct {
    mutex: Mutex,

    pub fn init() Lock {
        return Lock{ .mutex = Mutex{} };
    }

    pub inline fn lock(this: *Lock) void {
        this.mutex.acquire();
    }

    pub inline fn unlock(this: *Lock) void {
        this.mutex.release();
    }

    pub inline fn assertUnlocked(this: *Lock, comptime message: []const u8) void {
        if (this.mutex.state.load(.Monotonic) != 0) {
            @panic(message);
        }
    }
};

pub fn spinCycle() void {}
