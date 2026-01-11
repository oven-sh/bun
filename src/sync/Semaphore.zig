//! Async-signal-safe semaphore.
//!
//! This is a thin wrapper around the C++ Bun::Semaphore class, which uses:
//! - macOS: Mach semaphores (semaphore_signal is async-signal-safe)
//! - Linux: POSIX semaphores (sem_post is async-signal-safe)
//! - Windows: libuv semaphores
//!
//! Unlike std.Thread.Semaphore (which uses Mutex + Condition), this
//! implementation's post/signal operation is safe to call from signal handlers.

const Semaphore = @This();

ptr: *anyopaque,

pub fn init() ?Semaphore {
    const ptr = Bun__Semaphore__create(0) orelse return null;
    return .{ .ptr = ptr };
}

pub fn deinit(self: Semaphore) void {
    Bun__Semaphore__destroy(self.ptr);
}

/// Signal the semaphore, waking one waiting thread.
/// This is async-signal-safe and can be called from signal handlers.
pub fn post(self: Semaphore) bool {
    return Bun__Semaphore__signal(self.ptr);
}

/// Wait for the semaphore to be signaled.
/// Blocks until another thread calls post().
pub fn wait(self: Semaphore) bool {
    return Bun__Semaphore__wait(self.ptr);
}

extern fn Bun__Semaphore__create(value: c_uint) ?*anyopaque;
extern fn Bun__Semaphore__destroy(sem: *anyopaque) void;
extern fn Bun__Semaphore__signal(sem: *anyopaque) bool;
extern fn Bun__Semaphore__wait(sem: *anyopaque) bool;
