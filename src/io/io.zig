const bun = @import("root").bun;
const std = @import("std");
const sys = bun.sys;
const linux = std.os.linux;
const Environment = bun.Environment;
const heap = @import("./heap.zig");
const JSC = bun.JSC;

const log = bun.Output.scoped(.loop, false);

const TimerHeap = heap.Intrusive(Timer, void, Timer.less);

const os = std.os;
const assert = std.debug.assert;

pub const Loop = struct {
    pending: Request.Queue = .{},
    waker: bun.Async.Waker,
    epoll_fd: if (Environment.isLinux) bun.FileDescriptor else u0 = if (Environment.isLinux) .zero else 0,

    timers: TimerHeap = .{ .context = {} },

    cached_now: os.timespec = .{
        .tv_nsec = 0,
        .tv_sec = 0,
    },
    active: usize = 0,

    var loop: Loop = undefined;
    var has_loaded_loop: bool = false;

    pub fn get() *Loop {
        if (Environment.isWindows) {
            @panic("Do not use this API on windows");
        }

        if (!@atomicRmw(bool, &has_loaded_loop, std.builtin.AtomicRmwOp.Xchg, true, .Monotonic)) {
            loop = Loop{
                .waker = bun.Async.Waker.init(bun.default_allocator) catch @panic("failed to initialize waker"),
            };
            if (comptime Environment.isLinux) {
                loop.epoll_fd = bun.toFD(std.os.epoll_create1(std.os.linux.EPOLL.CLOEXEC | 0) catch @panic("Failed to create epoll file descriptor"));

                {
                    var epoll = std.mem.zeroes(std.os.linux.epoll_event);
                    epoll.events = std.os.linux.EPOLL.IN | std.os.linux.EPOLL.ERR | std.os.linux.EPOLL.HUP;
                    epoll.data.ptr = @intFromPtr(&loop);
                    const rc = std.os.linux.epoll_ctl(loop.epoll_fd.cast(), std.os.linux.EPOLL.CTL_ADD, loop.waker.getFd().cast(), &epoll);

                    switch (std.os.linux.getErrno(rc)) {
                        .SUCCESS => {},
                        else => |err| bun.Output.panic("Failed to wait on epoll {s}", .{@tagName(err)}),
                    }
                }
            }
            var thread = std.Thread.spawn(.{
                .allocator = bun.default_allocator,

                // smaller thread, since it's not doing much.
                .stack_size = 1024 * 1024 * 2,
            }, onSpawnIOThread, .{}) catch @panic("Failed to spawn IO watcher thread");
            thread.detach();
        }
        return &loop;
    }

    pub fn onSpawnIOThread() void {
        loop.tick();
    }

    pub fn schedule(this: *Loop, request: *Request) void {
        std.debug.assert(!request.scheduled);
        request.scheduled = true;
        this.pending.push(request);
        this.waker.wake();
    }

    pub fn tick(this: *Loop) void {
        bun.Output.Source.configureNamedThread("IO Watcher");

        if (comptime Environment.isLinux) {
            this.tickEpoll();
        } else if (comptime Environment.isMac) {
            this.tickKqueue();
        } else {
            @panic("TODO on this platform");
        }
    }

    pub fn tickEpoll(this: *Loop) void {
        if (comptime !Environment.isLinux) {
            @compileError("Epoll is Linux-Only");
        }

        this.updateNow();

        while (true) {

            // Process pending requests
            {
                var pending_batch = this.pending.popBatch();
                var pending = pending_batch.iterator();

                while (pending.next()) |request| {
                    request.scheduled = false;
                    switch (request.callback(request)) {
                        .readable => |readable| {
                            switch (readable.poll.registerForEpoll(readable.tag, this, .poll_readable, true, readable.fd)) {
                                .err => |err| {
                                    readable.onError(request, err);
                                },
                                .result => {
                                    this.active += 1;
                                },
                            }
                        },
                        .writable => |writable| {
                            switch (writable.poll.registerForEpoll(writable.tag, this, .poll_writable, true, writable.fd)) {
                                .err => |err| {
                                    writable.onError(request, err);
                                },
                                .result => {
                                    this.active += 1;
                                },
                            }
                        },
                        .close => |close| {
                            close.poll.unregisterWithFd(this.pollfd(), close.fd);
                            this.active -= 1;
                            close.onDone(close.ctx);
                        },
                        .timer_cancelled => {},
                        .timer => |timer| {
                            while (true) {
                                switch (timer.state) {
                                    .PENDING => {
                                        timer.state = .ACTIVE;
                                        this.timers.insert(timer);
                                        this.active += 1;
                                    },
                                    .ACTIVE => {
                                        @panic("timer is already active");
                                    },
                                    .CANCELLED => {
                                        timer.deinit();
                                        this.active -= 1;
                                        break;
                                    },
                                    .FIRED => {
                                        @panic("timer has already fired");
                                    },
                                }
                                break;
                            }
                        },
                    }
                }
            }

            this.drainExpiredTimers();

            // Determine our next timeout based on the timers
            const timeout: i32 = if (this.active == 0) 0 else timeout: {
                const t = this.timers.peek() orelse break :timeout -1;

                // Determine the time in milliseconds.
                const ms_now = @as(u64, @intCast(this.cached_now.tv_sec)) * std.time.ms_per_s +
                    @as(u64, @intCast(this.cached_now.tv_nsec)) / std.time.ns_per_ms;
                const ms_next = @as(u64, @intCast(t.next.tv_sec)) * std.time.ms_per_s +
                    @as(u64, @intCast(t.next.tv_nsec)) / std.time.ns_per_ms;
                const out = @as(i32, @intCast(ms_next -| ms_now));

                break :timeout @max(out, 0);
            };

            var events: [256]EventType = undefined;

            const rc = linux.epoll_wait(
                this.pollfd().cast(),
                &events,
                @intCast(events.len),
                timeout,
            );

            switch (std.os.linux.getErrno(rc)) {
                .INTR => continue,
                .SUCCESS => {},
                else => |e| bun.Output.panic("epoll_wait: {s}", .{@tagName(e)}),
            }

            this.updateNow();

            const current_events: []std.os.linux.epoll_event = events[0..rc];
            if (rc != 0) {
                log("epoll_wait({d}) = {d}", .{ this.pollfd(), rc });
            }

            for (current_events) |event| {
                const pollable: Pollable = Pollable.from(event.data.u64);
                if (pollable.tag() == .empty) {
                    if (event.data.ptr == @intFromPtr(&loop)) {
                        // this is the event poll, lets read it
                        var bytes: [8]u8 = undefined;
                        _ = bun.sys.read(loop.fd(), &bytes);
                    }
                }
                _ = Poll.onUpdateEpoll(pollable.poll(), pollable.tag(), event);
            }
        }
    }

    pub fn pollfd(this: *const Loop) bun.FileDescriptor {
        if (comptime Environment.isLinux) {
            return this.epoll_fd;
        }

        return this.waker.getFd();
    }

    pub fn fd(this: *const Loop) bun.FileDescriptor {
        return this.waker.getFd();
    }

    pub fn tickKqueue(this: *Loop) void {
        if (comptime !Environment.isMac) {
            @compileError("Kqueue is MacOS-Only");
        }

        this.updateNow();

        while (true) {
            var stack_fallback = std.heap.stackFallback(@sizeOf([256]EventType), bun.default_allocator);
            var events_list: std.ArrayList(EventType) = std.ArrayList(EventType).initCapacity(stack_fallback.get(), 256) catch unreachable;
            defer events_list.deinit();

            // Process pending requests
            {
                var pending_batch = this.pending.popBatch();
                var pending = pending_batch.iterator();
                events_list.ensureUnusedCapacity(pending.batch.count) catch bun.outOfMemory();
                @memset(std.mem.sliceAsBytes(events_list.items.ptr[0..events_list.capacity]), 0);

                while (pending.next()) |request| {
                    switch (request.callback(request)) {
                        .readable => |readable| {
                            const i = events_list.items.len;
                            assert(i + 1 <= events_list.capacity);
                            events_list.items.len += 1;

                            Poll.Flags.applyKQueue(
                                .readable,
                                readable.tag,
                                readable.poll,
                                readable.fd,
                                &events_list.items.ptr[i],
                            );
                        },
                        .writable => |writable| {
                            const i = events_list.items.len;
                            assert(i + 1 <= events_list.capacity);
                            events_list.items.len += 1;

                            Poll.Flags.applyKQueue(
                                .writable,
                                writable.tag,
                                writable.poll,
                                writable.fd,
                                &events_list.items.ptr[i],
                            );
                        },

                        .close => |close| {
                            if (close.poll.flags.contains(.poll_readable) or close.poll.flags.contains(.poll_writable)) {
                                const i = events_list.items.len;
                                assert(i + 1 <= events_list.capacity);
                                events_list.items.len += 1;
                                Poll.Flags.applyKQueue(
                                    .cancel,
                                    close.tag,
                                    close.poll,
                                    close.fd,
                                    &events_list.items.ptr[i],
                                );
                            }
                            close.onDone(close.ctx);
                        },
                        .timer_cancelled => {},
                        .timer => |timer| {
                            while (true) {
                                switch (timer.state) {
                                    .PENDING => {
                                        timer.state = .ACTIVE;
                                        this.timers.insert(timer);
                                        this.active += 1;
                                    },
                                    .ACTIVE => {
                                        @panic("timer is already active");
                                    },
                                    .CANCELLED => {
                                        timer.deinit();
                                        this.active -= 1;
                                        break;
                                    },
                                    .FIRED => {
                                        @panic("timer has already fired");
                                    },
                                }
                                break;
                            }
                        },
                    }
                }
            }

            this.drainExpiredTimers();
            const change_count = events_list.items.len;

            // Determine our next timeout based on the timers
            const timeout: ?std.os.timespec = timeout: {
                const t = this.timers.peek() orelse break :timeout null;
                var out: std.os.timespec = undefined;
                out.tv_sec = t.next.tv_sec -| this.cached_now.tv_sec;
                out.tv_nsec = t.next.tv_nsec -| this.cached_now.tv_nsec;

                if (out.tv_nsec < 0) {
                    out.tv_sec -= 1;
                    out.tv_nsec += std.time.ns_per_s;
                }

                if (out.tv_sec < 0) {
                    break :timeout null;
                }

                break :timeout out;
            };

            const rc = os.system.kevent64(
                this.pollfd().cast(),
                events_list.items.ptr,
                @intCast(change_count),
                // The same array may be used for the changelist and eventlist.
                events_list.items.ptr,
                // we set 0 here so that if we get an error on
                // registration, it becomes errno
                @intCast(events_list.capacity),
                0,
                if (timeout) |*t| t else null,
            );

            switch (std.c.getErrno(rc)) {
                .INTR => continue,
                .SUCCESS => {},
                else => |e| bun.Output.panic("kevent64 failed: {s}", .{@tagName(e)}),
            }

            this.updateNow();

            assert(rc <= events_list.capacity);
            const current_events: []std.os.darwin.kevent64_s = events_list.items.ptr[0..@intCast(rc)];

            for (current_events) |event| {
                Poll.onUpdateKQueue(event);
            }
        }
    }

    fn drainExpiredTimers(this: *Loop) void {
        const now = Timer{ .next = this.cached_now };

        var current_batch = JSC.ConcurrentTask.Queue.Batch{};
        var prev_event_loop: ?*JSC.EventLoop = null;

        // Run our expired timers
        while (this.timers.peek()) |t| {
            if (!Timer.less({}, t, &now)) break;

            // Remove the timer
            assert(this.timers.deleteMin().? == t);

            // Mark completion as done
            t.state = .FIRED;

            switch (t.fire(
                &current_batch,
                &prev_event_loop,
            )) {
                .disarm => {},
                .rearm => |new| {
                    t.next = new;
                    t.reset = null;
                    t.state = .ACTIVE;
                    this.timers.insert(t);
                },
            }
        }

        if (prev_event_loop) |event_loop| {
            event_loop.enqueueTaskConcurrentBatch(current_batch);
        }
    }

    fn updateNow(this: *Loop) void {
        updateTimespec(&this.cached_now);
    }

    extern "C" fn clock_gettime_monotonic(sec: *i64, nsec: *i64) c_int;
    pub fn updateTimespec(timespec: *os.timespec) void {
        if (comptime Environment.isLinux) {
            const rc = linux.clock_gettime(linux.CLOCK.MONOTONIC, timespec);
            assert(rc == 0);
        } else if (comptime Environment.isWindows) {
            var tv_sec: i64 = 0;
            var tv_nsec: i64 = 0;

            const rc = clock_gettime_monotonic(&tv_sec, &tv_nsec);
            assert(rc == 0);

            timespec.tv_sec = @intCast(tv_sec);
            timespec.tv_nsec = @intCast(tv_nsec);
        } else {
            std.os.clock_gettime(std.os.CLOCK.MONOTONIC, timespec) catch {};
        }
    }
};

const EventType = if (Environment.isLinux) linux.epoll_event else std.os.system.kevent64_s;

pub const Request = struct {
    next: ?*Request = null,
    callback: *const fn (*Request) Action,
    scheduled: bool = false,

    pub const Queue = bun.UnboundedQueue(Request, .next);
};

pub const Action = union(enum) {
    readable: FileAction,
    writable: FileAction,
    close: CloseAction,
    timer: *Timer,
    timer_cancelled: void,

    pub const FileAction = struct {
        fd: bun.FileDescriptor,
        poll: *Poll,
        ctx: *anyopaque,
        tag: Pollable.Tag,
        onError: *const fn (*anyopaque, sys.Error) void,
    };

    pub const CloseAction = struct {
        fd: bun.FileDescriptor,
        poll: *Poll,
        ctx: *anyopaque,
        tag: Pollable.Tag,
        onDone: *const fn (*anyopaque) void,
    };
};

const ReadFile = bun.JSC.WebCore.Blob.ReadFile;
const WriteFile = bun.JSC.WebCore.Blob.WriteFile;

const Pollable = struct {
    const Tag = enum(bun.TaggedPointer.Tag) {
        empty,
        ReadFile,
        WriteFile,

        pub fn Type(comptime T: Tag) type {
            return switch (T) {
                .ReadFile => ReadFile,
                .WriteFile => WriteFile,
                .empty => @compileError("unreachable"),
            };
        }
    };

    value: bun.TaggedPointer,

    pub fn init(t: Tag, p: *Poll) Pollable {
        return Pollable{
            .value = bun.TaggedPointer.init(p, @intFromEnum(t)),
        };
    }

    pub fn from(int: u64) Pollable {
        return Pollable{ .value = bun.TaggedPointer.from(int) };
    }

    pub fn poll(this: Pollable) *Poll {
        return this.value.get(Poll);
    }

    pub fn tag(this: Pollable) Tag {
        if (this.value.data == 0) return .empty;
        return @enumFromInt(this.value.data);
    }

    pub fn get(this: Pollable, comptime t: Tag) *Tag.Type(t) {
        return this.value.get(Tag.Type(t));
    }

    pub fn ptr(this: Pollable) *anyopaque {
        return this.value.to();
    }
};

const TimerReference = bun.JSC.BunTimer.Timeout.TimerReference;

pub const Timer = struct {
    /// The absolute time to fire this timer next.
    next: os.timespec,

    /// Only used internally. If this is non-null and timer is
    /// CANCELLED, then the timer is rearmed automatically with this
    /// as the next time. The callback will not be called on the
    /// cancellation.
    reset: ?os.timespec = null,

    /// Internal heap fields.
    heap: heap.IntrusiveField(Timer) = .{},

    state: State = .PENDING,

    tag: Tag = .TimerCallback,

    pub const Tag = enum {
        TimerCallback,
        TimerReference,

        pub fn Type(comptime T: Tag) type {
            return switch (T) {
                .TimerCallback => TimerCallback,
                .TimerReference => TimerReference,
            };
        }
    };

    const TimerCallback = struct {
        callback: *const fn (*TimerCallback) Arm,
        ctx: *anyopaque,
        timer: Timer,
    };

    pub const State = enum {
        /// The timer is waiting to be enabled.
        PENDING,

        /// The timer is active and will fire at the next time.
        ACTIVE,

        /// The timer has been cancelled and will not fire.
        CANCELLED,

        /// The timer has fired and the callback has been called.
        FIRED,
    };

    fn less(_: void, a: *const Timer, b: *const Timer) bool {
        return a.ns() < b.ns();
    }

    /// Returns the nanoseconds of this timer. Note that maxInt(u64) ns is
    /// 584 years so if we get any overflows we just use maxInt(u64). If
    /// any software is running in 584 years waiting on this timer...
    /// shame on me I guess... but I'll be dead.
    fn ns(self: *const Timer) u64 {
        assert(self.next.tv_sec >= 0);
        assert(self.next.tv_nsec >= 0);

        const max = std.math.maxInt(u64);
        const s_ns = std.math.mul(
            u64,
            @as(u64, @intCast(self.next.tv_sec)),
            std.time.ns_per_s,
        ) catch return max;
        return std.math.add(u64, s_ns, @as(u64, @intCast(self.next.tv_nsec))) catch
            return max;
    }

    pub const Arm = union(enum) {
        rearm: std.os.timespec,
        disarm,
    };

    pub fn fire(this: *Timer, batch: *JSC.ConcurrentTask.Queue.Batch, event_loop: *?*JSC.EventLoop) Arm {
        if (comptime Environment.allow_assert) {
            if (comptime Environment.isPosix) {
                const timer = std.time.Instant{ .timestamp = this.next };
                var now = std.time.Instant{ .timestamp = undefined };
                Loop.updateTimespec(&now.timestamp);

                if (timer.order(now) != .lt) {
                    bun.Output.panic("Timer fired {} too early", .{bun.fmt.fmtDuration(timer.since(now))});
                }
            }
        }

        switch (this.tag) {
            inline else => |t| {
                var container: *t.Type() = @fieldParentPtr(t.Type(), "timer", this);
                if (comptime @hasDecl(t.Type(), "callback")) {
                    const concurrent_task = container.concurrent_task.from(container, .manual_deinit);
                    if (event_loop.*) |loop| {
                        // If they are different event loops, we have to drain the batch right here.
                        if (loop != container.event_loop) {
                            loop.enqueueTaskConcurrentBatch(batch.*);
                            batch.* = .{};
                            event_loop.* = container.event_loop;
                        }

                        if (batch.front == null) {
                            batch.front = concurrent_task;
                        }
                    } else {
                        batch.front = concurrent_task;
                        event_loop.* = container.event_loop;
                    }

                    if (batch.last) |last| {
                        std.debug.assert(last.next == null);
                        last.next = concurrent_task;
                    }

                    batch.last = concurrent_task;

                    batch.count += 1;
                    return container.callback();
                }

                return container.callback(container);
            },
        }
    }

    pub fn deinit(_: *Timer) void {}
};

pub const Poll = struct {
    flags: Flags.Set = Flags.Set.initEmpty(),
    generation_number: GenerationNumberInt = 0,

    const GenerationNumberInt = if (Environment.isMac and Environment.allow_assert) u64 else u0;

    var generation_number: GenerationNumberInt = 0;

    pub const Tag = Pollable.Tag;

    pub const Flags = enum {
        // What are we asking the event loop about?

        /// Poll for readable events
        poll_readable,

        /// Poll for writable events
        poll_writable,

        /// Poll for process-related events
        poll_process,

        /// Poll for machport events
        poll_machport,

        // What did the event loop tell us?
        readable,
        writable,
        process,
        eof,
        hup,
        machport,

        // What is the type of file descriptor?
        fifo,
        tty,

        one_shot,
        needs_rearm,

        closed,

        nonblocking,

        was_ever_registered,
        ignore_updates,

        cancelled,
        registered,

        pub const Set = std.EnumSet(Flags);
        pub const Struct = std.enums.EnumFieldStruct(Flags, bool, false);

        pub fn fromKQueueEvent(kqueue_event: std.os.system.kevent64_s) Flags.Set {
            var flags = Flags.Set{};
            if (kqueue_event.filter == std.os.system.EVFILT_READ) {
                flags.insert(Flags.readable);
                log("readable", .{});
                if (kqueue_event.flags & std.os.system.EV_EOF != 0) {
                    flags.insert(Flags.hup);
                    log("hup", .{});
                }
            } else if (kqueue_event.filter == std.os.system.EVFILT_WRITE) {
                flags.insert(Flags.writable);
                log("writable", .{});
                if (kqueue_event.flags & std.os.system.EV_EOF != 0) {
                    flags.insert(Flags.hup);
                    log("hup", .{});
                }
            } else if (kqueue_event.filter == std.os.system.EVFILT_PROC) {
                log("proc", .{});
                flags.insert(Flags.process);
            } else if (kqueue_event.filter == std.os.system.EVFILT_MACHPORT) {
                log("machport", .{});
                flags.insert(Flags.machport);
            }
            return flags;
        }

        pub fn fromEpollEvent(epoll: std.os.linux.epoll_event) Flags.Set {
            var flags = Flags.Set{};
            if (epoll.events & std.os.linux.EPOLL.IN != 0) {
                flags.insert(Flags.readable);
                log("readable", .{});
            }
            if (epoll.events & std.os.linux.EPOLL.OUT != 0) {
                flags.insert(Flags.writable);
                log("writable", .{});
            }
            if (epoll.events & std.os.linux.EPOLL.ERR != 0) {
                flags.insert(Flags.eof);
                log("eof", .{});
            }
            if (epoll.events & std.os.linux.EPOLL.HUP != 0) {
                flags.insert(Flags.hup);
                log("hup", .{});
            }
            return flags;
        }

        pub fn applyKQueue(
            comptime action: @Type(.EnumLiteral),
            tag: Pollable.Tag,
            poll: *Poll,
            fd: bun.FileDescriptor,
            kqueue_event: *std.os.system.kevent64_s,
        ) void {
            log("register({s}, {d})", .{ @tagName(action), fd });
            defer {
                switch (comptime action) {
                    .readable => poll.flags.insert(Flags.poll_readable),
                    .writable => poll.flags.insert(Flags.poll_writable),
                    .cancel => {
                        if (poll.flags.contains(Flags.poll_readable)) {
                            poll.flags.remove(Flags.poll_readable);
                        } else if (poll.flags.contains(Flags.poll_writable)) {
                            poll.flags.remove(Flags.poll_writable);
                        } else {
                            unreachable;
                        }
                    },
                    else => @compileError("unreachable"),
                }

                if (comptime Environment.allow_assert and action != .cancel) {
                    generation_number += 1;
                    poll.generation_number = generation_number;
                }
            }

            const one_shot_flag = std.os.system.EV_ONESHOT;

            kqueue_event.* = switch (comptime action) {
                .readable => .{
                    .ident = @as(u64, @intCast(fd.int())),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(tag, poll).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ generation_number, 0 },
                },
                .writable => .{
                    .ident = @as(u64, @intCast(fd.int())),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(tag, poll).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ generation_number, 0 },
                },
                .cancel => if (poll.flags.contains(.poll_readable)) .{
                    .ident = @as(u64, @intCast(fd.int())),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(tag, poll).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ poll.generation_number, 0 },
                } else if (poll.flags.contains(.poll_writable)) .{
                    .ident = @as(u64, @intCast(fd.int())),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(tag, poll).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ poll.generation_number, 0 },
                } else unreachable,

                else => @compileError("invalid action: " ++ @tagName(action)),
            };
        }
    };

    pub fn unregisterWithFd(this: *Poll, watcher_fd: bun.FileDescriptor, fd: bun.FileDescriptor) void {
        _ = linux.epoll_ctl(
            watcher_fd.cast(),
            linux.EPOLL.CTL_DEL,
            fd.cast(),
            null,
        );
        this.flags.remove(.was_ever_registered);
        this.flags.remove(.registered);
    }

    pub fn onUpdateKQueue(
        event: std.os.system.kevent64_s,
    ) void {
        if (event.filter == std.c.EVFILT_MACHPORT)
            return;

        const pollable = Pollable.from(event.udata);
        const tag = pollable.tag();
        const poll = pollable.poll();
        switch (tag) {
            // ignore empty tags. This case should be unreachable in practice
            .empty => {},

            inline else => |t| {
                var this: *Pollable.Tag.Type(t) = @fieldParentPtr(Pollable.Tag.Type(t), "io_poll", poll);
                if (event.flags == std.c.EV_ERROR) {
                    log("error({d}) = {d}", .{ event.ident, event.data });
                    this.onIOError(bun.sys.Error.fromCode(@enumFromInt(event.data), .kevent));
                } else {
                    log("ready({d}) = {d}", .{ event.ident, event.data });
                    this.onReady();
                }
            },
        }
    }

    pub fn onUpdateEpoll(
        poll: *Poll,
        tag: Pollable.Tag,
        event: linux.epoll_event,
    ) void {
        switch (tag) {
            // ignore empty tags. This case should be unreachable in practice
            .empty => {},

            inline else => |t| {
                var this: *Pollable.Tag.Type(t) = @fieldParentPtr(Pollable.Tag.Type(t), "io_poll", poll);
                if (event.events & linux.EPOLL.ERR != 0) {
                    const errno = std.os.linux.getErrno(event.events);
                    log("error() = {s}", .{@tagName(errno)});
                    this.onIOError(bun.sys.Error.fromCode(errno, .epoll_ctl));
                } else {
                    log("ready()", .{});
                    this.onReady();
                }
            },
        }
    }

    pub fn registerForEpoll(this: *Poll, tag: Pollable.Tag, loop: *Loop, comptime flag: Flags, one_shot: bool, fd: bun.FileDescriptor) JSC.Maybe(void) {
        const watcher_fd = loop.pollfd();

        log("register: {s} ({d})", .{ @tagName(flag), fd });

        std.debug.assert(fd != bun.invalid_fd);

        if (one_shot) {
            this.flags.insert(.one_shot);
        }

        if (comptime Environment.isLinux) {
            const one_shot_flag: u32 = if (!this.flags.contains(.one_shot)) 0 else linux.EPOLL.ONESHOT;

            // "flag" is comptime to make sure we always check
            const flags: u32 = switch (comptime flag) {
                .process,
                .poll_readable,
                => linux.EPOLL.IN | linux.EPOLL.HUP | linux.EPOLL.ERR | one_shot_flag,
                .poll_writable => linux.EPOLL.OUT | linux.EPOLL.HUP | linux.EPOLL.ERR | one_shot_flag,
                else => @compileError("unreachable"),
            };

            var event = linux.epoll_event{ .events = flags, .data = .{ .u64 = @intFromPtr(Pollable.init(tag, this).ptr()) } };

            const op: u32 = if (this.flags.contains(.registered) or this.flags.contains(.needs_rearm)) linux.EPOLL.CTL_MOD else linux.EPOLL.CTL_ADD;

            const ctl = linux.epoll_ctl(
                watcher_fd.cast(),
                op,
                fd.cast(),
                &event,
            );
            this.flags.insert(.registered);
            this.flags.insert(.was_ever_registered);
            if (JSC.Maybe(void).errnoSys(ctl, .epoll_ctl)) |errno| {
                return errno;
            }
        } else {
            @compileError("epoll not supported on this platform");
        }

        this.flags.insert(switch (flag) {
            .poll_readable => .poll_readable,
            .poll_process => if (comptime Environment.isLinux) .poll_readable else .poll_process,
            .poll_writable => .poll_writable,
            else => @compileError("unreachable"),
        });
        this.flags.remove(.needs_rearm);

        return JSC.Maybe(void).success;
    }
};

pub const retry = bun.C.E.AGAIN;

pub const PipeReader = @import("./PipeReader.zig").PipeReader;
