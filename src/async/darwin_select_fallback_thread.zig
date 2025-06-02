const DarwinSelectFallbackThread = @This();

select_thread: ?std.Thread = null,
should_stop: std.atomic.Value(bool) = .init(false),
lock: bun.Mutex = .{},
waker: bun.Async.Waker,
registered_event_loops: std.AutoArrayHashMapUnmanaged(i32, std.ArrayListUnmanaged(JSC.EventLoopHandle)) = .{},
registered_event_loops_lock: bun.Mutex = .{},

extern "c" fn darwin_select_thread_is_needed_for_fd(fd: i32) bool;

/// Simple map for fd -> FilePoll that works with any EventLoopHandle
pub const Map = struct {
    fd_to_file_poll: std.AutoHashMapUnmanaged(i32, *FilePoll) = .{},

    pub fn put(self: *Map, fd: i32, file_poll: *FilePoll) void {
        self.fd_to_file_poll.put(bun.default_allocator, fd, file_poll) catch {};
    }

    pub fn remove(self: *Map, fd: i32) void {
        _ = self.fd_to_file_poll.remove(fd);
    }

    pub fn get(self: *Map, fd: i32) ?*FilePoll {
        return self.fd_to_file_poll.get(fd);
    }

    pub fn deinit(self: *Map) void {
        self.fd_to_file_poll.deinit(bun.default_allocator);
    }
};

pub fn get() *DarwinSelectFallbackThread {
    const Holder = struct {
        pub var thread: *DarwinSelectFallbackThread = undefined;
        pub var select_fallback_thread_once = std.once(initFallbackThread);

        pub fn initFallbackThread() void {
            thread = bun.default_allocator.create(DarwinSelectFallbackThread) catch bun.outOfMemory();
            thread.* = .{
                .waker = bun.Async.Waker.init() catch @panic("Unexpected error: Failed to initialize waker for select fallback thread"),
            };
        }
    };
    Holder.select_fallback_thread_once.call();

    return Holder.thread;
}

pub fn isNeededForStdin() bool {
    return darwin_select_thread_is_needed_for_fd(0);
}

pub fn isNeededForFd(fd: i32) bool {
    return darwin_select_thread_is_needed_for_fd(fd);
}

pub fn register(event_loop_handle: JSC.EventLoopHandle, fd: bun.FileDescriptor) void {
    const this = get();

    {
        this.lock.lock();
        defer this.lock.unlock();

        // Add to the list
        const entry = this.registered_event_loops.getOrPut(bun.default_allocator, fd.cast()) catch bun.outOfMemory();
        if (!entry.found_existing) {
            entry.value_ptr.* = .{};
        }

        entry.value_ptr.*.append(bun.default_allocator, event_loop_handle) catch bun.outOfMemory();

        // Start select thread if not running
        if (this.select_thread == null) {
            this.select_thread = std.Thread.spawn(.{}, selectThreadMain, .{this}) catch bun.outOfMemory();
            this.select_thread.?.setName("Bun stdin select() thread") catch {};
        }
    }

    this.waker.wake();
}

pub fn unregister(event_loop_handle: JSC.EventLoopHandle, fd: bun.FileDescriptor) void {
    const this = get();
    {
        this.lock.lock();
        defer this.lock.unlock();

        const entry = this.registered_event_loops.getEntry(@intCast(fd.cast())) orelse return;
        const index = for (entry.value_ptr.*.items, 0..) |handle, i| {
            if (handle.eq(event_loop_handle)) break i;
        } else return;
        _ = entry.value_ptr.*.swapRemove(index);

        if (entry.value_ptr.items.len == 0) {
            _ = this.registered_event_loops.swapRemove(entry.key_ptr.*);
        }
    }
    this.waker.wake();
}

export fn darwin_select_thread_fd_is_readable(fd: i32) void {
    const this = get();

    this.registered_event_loops_lock.lock();
    var event_loop_handles: std.ArrayListUnmanaged(JSC.EventLoopHandle) = brk: {
        if (this.registered_event_loops.get(fd)) |*loops| {
            break :brk loops.clone(bun.default_allocator) catch bun.outOfMemory();
        }

        break :brk .{};
    };
    this.registered_event_loops_lock.unlock();
    defer event_loop_handles.deinit(bun.default_allocator);

    for (event_loop_handles.items) |event_loop_handle| {
        switch (event_loop_handle) {
            .js => |event_loop| event_loop.onDarwinSelectThreadFdIsReadable(fd),
            .mini => |mini_event_loop| mini_event_loop.onDarwinSelectThreadFdIsReadable(fd),
        }
    }
}

extern "c" fn darwin_select_thread_wait_for_events(kqueue_fd: i32, machport: *anyopaque, buffer_ptr: [*]u8, buffer_len: usize, fds_ptr: [*]i32, fds_len: usize) void;

fn selectThreadMain(this: *DarwinSelectFallbackThread) void {
    while (!this.should_stop.load(.acquire)) {
        var stack_fallback = std.heap.stackFallback(1024, bun.default_allocator);
        const fallback_allocator = stack_fallback.get();

        this.lock.lock();
        const fds = fallback_allocator.dupe(i32, this.registered_event_loops.keys()) catch bun.outOfMemory();
        defer fallback_allocator.free(fds);
        this.lock.unlock();

        const kqueue_fd: i32 = @intCast(this.waker.getFd().cast());
        const machport = this.waker.machport;
        darwin_select_thread_wait_for_events(
            kqueue_fd,
            machport,
            this.waker.machport_buf.ptr,
            this.waker.machport_buf.len,
            fds.ptr,
            fds.len,
        );
    }
}

comptime {
    _ = darwin_select_thread_fd_is_readable;
}

const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const FilePoll = bun.Async.FilePoll;
