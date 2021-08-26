const std = @import("std");
const Atomic = std.atomic.Atomic;
const Futex = std.Thread.Futex;

// Credit: this is copypasta from @kprotty. Thank you @kprotty!
pub const Mutex = struct {
    state: Atomic(u32) = Atomic(u32).init(UNLOCKED),

    const UNLOCKED: u32 = 0;
    const LOCKED: u32 = 1;
    const CONTENDED: u32 = 2;

    pub fn tryAcquire(self: *Mutex) bool {
        return self.state.compareAndSwap(
            UNLOCKED,
            LOCKED,
            .Acquire,
            .Monotonic,
        ) == null;
    }

    pub fn acquire(self: *Mutex) void {
        if (self.state.tryCompareAndSwap(
            UNLOCKED,
            LOCKED,
            .Acquire,
            .Monotonic,
        )) |updated| {
            self.acquireSlow();
        }
    }

    fn acquireSlow(self: *Mutex) void {
        @setCold(true);

        // true if the cpu's atomic swap instruction should be preferred
        const has_fast_swap = comptime blk: {
            const arch = std.Target.current.cpu.arch;
            break :blk arch.isX86() or arch.isRISCV();
        };

        var acquire_state = LOCKED;
        var state = self.state.load(.Monotonic);
        var spin: u8 = if (comptime has_fast_swap) 100 else 10;

        while (true) {
            // Try to lock the Mutex if its unlocked.
            // acquire_state is changed to CONTENDED if this thread goes to sleep.
            //
            // We acquire with CONTENDED instead of LOCKED in that scenario
            // to make sure that we wake another thread sleeping in release()
            // which didn't see the transition to UNLOCKED since it was asleep.
            //
            // A CONTENDED acquire unfortunately results in one extra wake()
            // if there were no other sleeping threads at the time of the acquire.
            if (state == UNLOCKED) {
                state = self.state.tryCompareAndSwap(
                    state,
                    acquire_state,
                    .Acquire,
                    .Monotonic,
                ) orelse return;
                continue;
            }

            if (state != CONTENDED) uncontended: {
                // If there's no pending threads, try to spin on the Mutex a few times.
                // This makes the throughput close to a spinlock when under micro-contention.
                if (spin > 0) {
                    spin -= 1;
                    std.atomic.spinLoopHint();
                    state = self.state.load(.Monotonic);
                    continue;
                }

                // Indicate that there will be a waiting thread by updating to CONTENDED.
                // Acquire barrier as this swap could also possibly lock the Mutex.
                if (comptime has_fast_swap) {
                    state = self.state.swap(CONTENDED, .Acquire);
                    if (state == UNLOCKED) return;
                    break :uncontended;
                }

                // For other platforms, mark the Mutex as CONTENDED if it's not already.
                // This just indicates that there's waiting threads so no Acquire barrier needed.
                if (self.state.tryCompareAndSwap(
                    state,
                    CONTENDED,
                    .Monotonic,
                    .Monotonic,
                )) |updated| {
                    state = updated;
                    continue;
                }
            }

            Futex.wait(&self.state, CONTENDED, null) catch unreachable;
            state = self.state.load(.Monotonic);
            acquire_state = CONTENDED;
        }
    }

    pub fn release(self: *Mutex) void {
        const state = self.state.swap(UNLOCKED, .Release);

        // Wake up a sleeping thread if it was previously CONTENDED.
        // The woken up thread would acquire by updating the state to CONTENDED again.
        // This is to make sure a future release() wouldn't miss waking up threads that
        // don't see the reset to UNLOCKED above due to them being asleep.
        if (state == CONTENDED) {
            self.releaseSlow();
        }
    }

    fn releaseSlow(self: *Mutex) void {
        @setCold(true);

        const num_waiters = 1;
        Futex.wake(&self.state, num_waiters);
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
};


pub fn spinCycle() void {

}