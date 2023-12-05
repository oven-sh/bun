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

    timers: TimerHeap = .{ .context = {} },

    cached_now: os.timespec = .{
        .tv_nsec = 0,
        .tv_sec = 0,
    },
    active: usize = 0,

    var loop: Loop = undefined;

    pub fn schedule(this: *Loop, request: *Request) void {
        this.pending.push(request);
        this.waker.wake();
    }

    pub fn tickEpoll(this: *Loop) void {
        if (comptime !Environment.isLinux) {
            @compileError("not implemented");
        }

        while (true) {

            // Process pending requests
            {
                var pending_batch = this.pending.popBatch();
                var pending = pending_batch.iterator();

                while (pending.next()) |request| {
                    switch (request.callback(request)) {
                        .readable => |readable| {
                            switch (readable.poll.registerWithFd(this, .poll_readable, true, @intCast(readable.fd))) {
                                .err => |err| {
                                    readable.onError(request, err);
                                },
                                .result => {
                                    this.active += 1;
                                },
                            }
                        },
                        .writable => |writable| {
                            switch (writable.poll.registerWithFd(this, .poll_writable, true, @intCast(writable.fd))) {
                                .err => |err| {
                                    writable.onError(request, err);
                                },
                                .result => {
                                    this.active += 1;
                                },
                            }
                        },
                        .close => |close| {
                            switch (close.poll.unregisterWithFd(this, @intCast(close.fd))) {
                                .result, .err => {
                                    this.active -= 1;
                                    close.onDone(request);
                                },
                            }
                        },
                        .timer => |timer| {
                            while (true) {
                                switch (timer.state) {
                                    .PENDING => {
                                        timer.state = .ACTIVE;
                                        if (Timer.less({}, timer, &.{ .next = this.cached_now })) {
                                            if (timer.fire() == .rearm) {
                                                if (timer.reset) |reset| {
                                                    timer.next = reset;
                                                    timer.reset = null;
                                                    continue;
                                                }
                                            }

                                            break;
                                        }
                                        this.timers.insert(timer);
                                    },
                                    .ACTIVE => {
                                        @panic("timer is already active");
                                    },
                                    .CANCELLED => {
                                        timer.deinit();
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
                break :timeout @as(i32, @intCast(ms_next -| ms_now));
            };

            var events: [EventType]256 = undefined;

            const rc = linux.epoll_wait(
                this.fd(),
                &events,
                @intCast(events.len),
                timeout,
            );

            switch (std.os.linux.getErrno(rc)) {
                .INTR => continue,
                .SUCCESS => {},
                else => |e| bun.Output.panic("epoll_wait: {s}", .{@tagName(e)}),
            }

            this.update_now();

            const current_events: []std.os.linux.epoll_event = events[0..rc];
            for (current_events) |event| {
                const pollable: Pollable = Pollable.from(event.data.u64);
                Poll.onUpdateEpoll(pollable.poll(), pollable.tag(), event.events);
            }
        }
    }

    pub fn tickKqueue(this: *Loop) void {
        if (comptime !Environment.isMac) {
            @compileError("not implemented");
        }

        while (true) {
            var stack_fallback = std.heap.stackFallback(@sizeOf([256]EventType), bun.default_allocator);
            var events_list: std.ArrayList(EventType) = std.ArrayList(EventType).initCapacity(stack_fallback.allocator, 256) catch unreachable;
            defer events_list.deinit();

            // Process pending requests
            {
                var pending_batch = this.pending.popBatch();
                var pending = pending_batch.iterator();
                events_list.ensureUnusedCapacity(pending.batch.count) catch bun.outOfMemory();

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
                            const i = events_list.items.len;
                            assert(i + 1 <= events_list.capacity);
                            events_list.items.len += 1;

                            Poll.Flags.applyKQueue(
                                .close,
                                close.tag,
                                close.poll,
                                close.fd,
                                &events_list.items.ptr[i],
                            );
                        },
                        .timer => |timer| {
                            while (true) {
                                switch (timer.state) {
                                    .PENDING => {
                                        timer.state = .ACTIVE;
                                        if (Timer.less({}, timer, &.{ .next = this.cached_now })) {
                                            if (timer.fire() == .rearm) {
                                                if (timer.reset) |reset| {
                                                    timer.next = reset;
                                                    timer.reset = null;
                                                    continue;
                                                }
                                            }

                                            break;
                                        }
                                        this.timers.insert(timer);
                                    },
                                    .ACTIVE => {
                                        @panic("timer is already active");
                                    },
                                    .CANCELLED => {
                                        timer.deinit();
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

                break :timeout out;
            };

            const rc = os.system.kevent64(
                this.fd(),
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

            this.update_now();

            assert(rc <= events_list.capacity);
            const current_events: []std.os.darwin.kevent64_s = events_list.items.ptr[0..rc];

            for (current_events) |event| {
                const pollable: Pollable = Pollable.from(event.udata);
                Poll.onUpdateKQueue(pollable.poll(), pollable.tag(), event);
            }
        }
    }

    fn drainExpiredTimers(this: *Loop) void {
        const now = Timer{ .next = this.cached_now };

        // Run our expired timers
        while (this.timers.peek()) |t| {
            if (!Timer.less({}, t, &now)) break;

            // Remove the timer
            assert(this.timers.deleteMin().? == t);

            // Mark completion as done
            t.state = .FIRED;

            switch (t.fire()) {
                .disarm => {},
                .rearm => |new| {
                    t.next = new;
                    t.reset = null;
                    t.state = .ACTIVE;
                    this.timers.insert(t);
                },
            }
        }
    }

    fn update_now(this: *Loop) void {
        if (comptime Environment.isLinux) {
            const rc = linux.clock_gettime(linux.CLOCK.MONOTONIC, &this.cached_now);
            assert(rc == 0);
        } else if (comptime Environment.isMac) {
            std.os.clock_gettime(std.os.CLOCK.MONOTONIC, &this.cached_now) catch {};
        } else {
            @compileError("TODO: implement poll for this platform");
        }
    }
};

const EventType = if (Environment.isLinux) linux.epoll_event else std.os.system.kevent64_s;

pub const Request = struct {
    next: ?*Request = null,
    callback: *const fn (*Request) Action,

    pub const Queue = bun.UnboundedQueue(Request, .next);
};

pub const Action = union(enum) {
    readable: FileAction,
    writable: FileAction,
    close: CloseAction,
    timer: *Timer,

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

const Pollable = struct {
    value: bun.TaggedPointer,

    const Tag = enum(bun.TaggedPointer.Tag) {};
    pub fn init(t: Tag, p: *Poll) Pollable {
        return Pollable{
            .value = bun.TaggedPointer.init(p, @intFromEnum(t)),
        };
    }

    pub fn poll(this: Pollable) *Poll {
        return this.value.get(Poll);
    }

    pub fn tag(this: Pollable) Tag {
        return @enumFromInt(this.value.data);
    }

    pub fn ptr(this: Pollable) *anyopaque {
        return this.value.to();
    }
};

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
};

pub const Poll = struct {
    flags: Flags,

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
                    else => unreachable,
                }

                if (comptime Environment.allow_assert and action != .cancel) {
                    generation_number += 1;
                    poll.generation_number = generation_number;
                }
            }

            kqueue_event.* = switch (comptime action) {
                .readable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(tag, this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ generation_number, 0 },
                },
                .writable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(tag, this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ generation_number, 0 },
                },
                .cancel => if (poll.flags.contains(.poll_readable)) .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(tag, this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ poll.generation_number, 0 },
                } else if (poll.flags.contains(.poll_writable)) .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(tag, this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ poll.generation_number, 0 },
                } else unreachable,

                else => unreachable,
            };
        }
    };

    pub fn unregisterWithFd(this: *Poll, fd: u64) JSC.Maybe(void) {}

    pub fn onUpdateKQueue(
        this: *Poll,
        event: std.os.system.kevent64_s,
    ) JSC.Maybe(void) {}

    pub fn onUpdateEpoll(
        this: *Poll,
        event: linux.epoll_event,
    ) JSC.Maybe(void) {}

    pub fn registerForEpoll(this: *Poll, loop: *Loop, flag: Flags, one_shot: bool, fd: u64) JSC.Maybe(void) {
        const watcher_fd = loop.fd;

        log("register: {s} ({d})", .{ @tagName(flag), fd });

        std.debug.assert(fd != bun.invalid_fd);

        if (one_shot) {
            this.flags.insert(.one_shot);
        }

        if (comptime Environment.isLinux) {
            const one_shot_flag: u32 = if (!this.flags.contains(.one_shot)) 0 else linux.EPOLL.ONESHOT;

            const flags: u32 = switch (flag) {
                .process,
                .readable,
                => linux.EPOLL.IN | linux.EPOLL.HUP | one_shot_flag,
                .writable => linux.EPOLL.OUT | linux.EPOLL.HUP | linux.EPOLL.ERR | one_shot_flag,
                else => unreachable,
            };

            var event = linux.epoll_event{ .events = flags, .data = .{ .u64 = @intFromPtr(Pollable.init(this).ptr()) } };

            var op: u32 = if (this.isRegistered() or this.flags.contains(.needs_rearm)) linux.EPOLL.CTL_MOD else linux.EPOLL.CTL_ADD;

            const ctl = linux.epoll_ctl(
                watcher_fd,
                op,
                @intCast(fd),
                &event,
            );
            this.flags.insert(.was_ever_registered);
            if (JSC.Maybe(void).errnoSys(ctl, .epoll_ctl)) |errno| {
                this.deactivate(loop);
                return errno;
            }
        } else if (comptime Environment.isMac) {
            var changelist = std.mem.zeroes([2]std.os.system.kevent64_s);

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            const rc = rc: {
                while (true) {
                    const rc = std.os.system.kevent64(
                        watcher_fd,
                        &changelist,
                        1,
                        // The same array may be used for the changelist and eventlist.
                        &changelist,
                        // we set 0 here so that if we get an error on
                        // registration, it becomes errno
                        0,
                        KEVENT_FLAG_ERROR_EVENTS,
                        &timeout,
                    );

                    if (std.c.getErrno(rc) == .INTR) continue;
                    break :rc rc;
                }
            };

            this.flags.insert(.was_ever_registered);

            // If an error occurs while
            // processing an element of the changelist and there is enough room
            // in the eventlist, then the event will be placed in the eventlist
            // with EV_ERROR set in flags and the system error in data.
            if (changelist[0].flags == std.c.EV_ERROR and changelist[0].data != 0) {
                return JSC.Maybe(void).errnoSys(changelist[0].data, .kevent).?;
                // Otherwise, -1 will be returned, and errno will be set to
                // indicate the error condition.
            }

            const errno = std.c.getErrno(rc);

            if (errno != .SUCCESS) {
                this.deactivate(loop);
                return JSC.Maybe(void){
                    .err = bun.sys.Error.fromCode(errno, .kqueue),
                };
            }
        } else {
            bun.todo(@src(), {});
        }
        this.flags.insert(switch (flag) {
            .readable => .poll_readable,
            .process => if (comptime Environment.isLinux) .poll_readable else .poll_process,
            .writable => .poll_writable,
            .machport => .poll_machport,
            else => unreachable,
        });
        this.flags.remove(.needs_rearm);

        return JSC.Maybe(void).success;
    }
};
