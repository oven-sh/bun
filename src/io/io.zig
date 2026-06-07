//! Confusingly, this is the barely used epoll/kqueue event loop
//! This is only used by Bun.write() and Bun.file(path).text() & friends.
//!
//! Most I/O happens on the main thread.

pub const heap = @import("./heap.zig");

pub const openForWriting = @import("./openForWriting.zig").openForWriting;
pub const openForWritingImpl = @import("./openForWriting.zig").openForWritingImpl;

const log = bun.Output.scoped(.loop, .visible);

pub const Source = @import("./source.zig").Source;

pub const Loop = struct {
    pending: Request.Queue = .{},
    waker: bun.Async.Waker,
    epoll_fd: if (Environment.isLinux) bun.FD else void = if (Environment.isLinux) .invalid,
    /// FreeBSD's `Waker` is `LinuxWaker` (an eventfd), so unlike macOS the
    /// waker fd is NOT itself a kqueue. We create one here and register the
    /// eventfd on it, mirroring how Linux registers the eventfd on epoll_fd.
    kqueue_fd: if (Environment.isFreeBSD) bun.FD else void = if (Environment.isFreeBSD) .invalid,

    cached_now: posix.timespec = .{
        .nsec = 0,
        .sec = 0,
    },
    active: usize = 0,

    var loop: Loop = undefined;

    fn load() void {
        loop = Loop{
            .waker = bun.Async.Waker.init() catch @panic("failed to initialize waker"),
        };
        if (comptime Environment.isLinux) {
            loop.epoll_fd = .fromNative(std.posix.epoll_create1(std.os.linux.EPOLL.CLOEXEC | 0) catch @panic("Failed to create epoll file descriptor"));

            {
                var epoll = std.mem.zeroes(std.os.linux.epoll_event);
                epoll.events = std.os.linux.EPOLL.IN | std.os.linux.EPOLL.ET | std.os.linux.EPOLL.ERR | std.os.linux.EPOLL.HUP;
                epoll.data.ptr = @intFromPtr(&loop);
                const rc = std.os.linux.epoll_ctl(loop.epoll_fd.cast(), std.os.linux.EPOLL.CTL_ADD, loop.waker.getFd().cast(), &epoll);

                switch (bun.sys.getErrno(rc)) {
                    .SUCCESS => {},
                    else => |err| bun.Output.panic("Failed to wait on epoll {s}", .{@tagName(err)}),
                }
            }
        }
        if (comptime Environment.isFreeBSD) {
            loop.kqueue_fd = .fromNative(std.posix.kqueue() catch @panic("Failed to create kqueue"));
            // Register the eventfd waker. udata = 0 → Pollable.tag() == .empty,
            // which onUpdateKQueue treats as a no-op (the wakeup just unblocks
            // the kevent() wait so the pending queue gets drained). EV_CLEAR
            // makes it edge-triggered so we never need to read() the eventfd.
            var change = std.mem.zeroes(KEvent);
            change.ident = @intCast(loop.waker.getFd().cast());
            change.filter = std.c.EVFILT.READ;
            change.flags = std.c.EV.ADD | std.c.EV.CLEAR;
            const rc = std.c.kevent(loop.kqueue_fd.cast(), @as([*]const KEvent, @ptrCast(&change)), 1, undefined, 0, null);
            switch (bun.sys.getErrno(rc)) {
                .SUCCESS => {},
                else => |err| bun.Output.panic("Failed to register waker on kqueue: {s}", .{@tagName(err)}),
            }
        }
        var thread = std.Thread.spawn(.{
            .allocator = bun.default_allocator,

            // smaller thread, since it's not doing much.
            .stack_size = 1024 * 1024 * 2,
        }, onSpawnIOThread, .{}) catch @panic("Failed to spawn IO watcher thread");
        thread.detach();
    }
    var once = std.once(load);

    pub fn get() *Loop {
        if (Environment.isWindows) {
            @panic("Do not use this API on windows");
        }

        once.call();

        return &loop;
    }

    pub fn onSpawnIOThread() void {
        loop.tick();
    }

    pub fn schedule(this: *Loop, request: *Request) void {
        bun.assert(!request.scheduled);
        request.scheduled = true;
        this.pending.push(request);
        this.waker.wake();
    }

    pub fn tick(this: *Loop) void {
        bun.Output.Source.configureNamedThread("IO Watcher");

        if (comptime Environment.isLinux) {
            this.tickEpoll();
        } else if (comptime Environment.isKqueue) {
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
                                    readable.onError(readable.ctx, err);
                                },
                                .result => {
                                    this.active += 1;
                                },
                            }
                        },
                        .writable => |writable| {
                            switch (writable.poll.registerForEpoll(writable.tag, this, .poll_writable, true, writable.fd)) {
                                .err => |err| {
                                    writable.onError(writable.ctx, err);
                                },
                                .result => {
                                    this.active += 1;
                                },
                            }
                        },
                        .close => |close| {
                            log("close({f}, registered={})", .{ close.fd, close.poll.flags.contains(.registered) });
                            // Only remove from the interest list if it was previously registered.
                            // Otherwise, epoll gets confused.
                            // This state can happen if polling for readable/writable previously failed.
                            if (close.poll.flags.contains(.was_ever_registered)) {
                                close.poll.unregisterWithFd(this.pollfd(), close.fd);
                                this.active -= 1;
                            }
                            close.onDone(close.ctx);
                        },
                    }
                }
            }

            var events: [256]EventType = undefined;

            const rc = linux.epoll_wait(
                this.pollfd().cast(),
                &events,
                @intCast(events.len),
                std.math.maxInt(i32),
            );

            switch (bun.sys.getErrno(rc)) {
                .INTR => continue,
                .SUCCESS => {},
                else => |e| bun.Output.panic("epoll_wait: {s}", .{@tagName(e)}),
            }

            this.updateNow();

            const current_events: []std.os.linux.epoll_event = events[0..rc];
            if (rc != 0) {
                log("epoll_wait({f}) = {d}", .{ this.pollfd(), rc });
            }

            for (current_events) |event| {
                const pollable: Pollable = Pollable.from(event.data.u64);
                if (pollable.tag() == .empty) {
                    if (event.data.ptr == @intFromPtr(&loop)) {
                        // Edge-triggered: no need to read the eventfd counter
                        continue;
                    }
                }
                _ = Poll.onUpdateEpoll(pollable.poll(), pollable.tag(), event);
            }
        }
    }

    pub fn pollfd(this: *const Loop) bun.FD {
        if (comptime Environment.isLinux) {
            return this.epoll_fd;
        }
        if (comptime Environment.isFreeBSD) {
            return this.kqueue_fd;
        }

        return this.waker.getFd();
    }

    pub fn fd(this: *const Loop) bun.FD {
        return this.waker.getFd();
    }

    pub fn tickKqueue(this: *Loop) void {
        if (comptime !Environment.isKqueue) {
            @compileError("Kqueue is macOS/FreeBSD-only");
        }

        this.updateNow();

        while (true) {
            var stack_fallback = std.heap.stackFallback(@sizeOf([256]EventType), bun.default_allocator);
            var events_list: std.array_list.Managed(EventType) = std.array_list.Managed(EventType).initCapacity(stack_fallback.get(), 256) catch unreachable;
            defer events_list.deinit();

            // Process pending requests
            {
                var pending_batch = this.pending.popBatch();
                var pending = pending_batch.iterator();
                bun.handleOom(events_list.ensureUnusedCapacity(pending.batch.count));
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
                    }
                }
            }

            const change_count = events_list.items.len;

            const rc = keventCall(
                this.pollfd().cast(),
                events_list.items.ptr,
                @intCast(change_count),
                // The same array may be used for the changelist and eventlist.
                events_list.items.ptr,
                // we set 0 here so that if we get an error on
                // registration, it becomes errno
                @intCast(events_list.capacity),
                null,
            );

            switch (bun.sys.getErrno(rc)) {
                .INTR => continue,
                .SUCCESS => {},
                else => |e| bun.Output.panic("kevent failed: {s}", .{@tagName(e)}),
            }

            this.updateNow();

            assert(rc <= events_list.capacity);
            const current_events: []KEvent = events_list.items.ptr[0..@intCast(rc)];

            for (current_events) |event| {
                Poll.onUpdateKQueue(event);
            }
        }
    }

    fn updateNow(this: *Loop) void {
        updateTimespec(&this.cached_now);
    }

    extern "c" fn clock_gettime_monotonic(sec: *i64, nsec: *i64) c_int;
    pub fn updateTimespec(timespec: *posix.timespec) void {
        if (comptime Environment.isLinux) {
            const rc = linux.clock_gettime(linux.CLOCK.MONOTONIC, timespec);
            assert(rc == 0);
        } else if (comptime Environment.isWindows) {
            var sec: i64 = 0;
            var nsec: i64 = 0;

            const rc = clock_gettime_monotonic(&sec, &nsec);
            assert(rc == 0);

            timespec.sec = @intCast(sec);
            timespec.nsec = @intCast(nsec);
        } else {
            const updated = std.posix.clock_gettime(std.posix.CLOCK.MONOTONIC) catch return;
            timespec.* = updated;
        }
    }
};

/// Zig std's `.freebsd` `EV` struct lacks `.EOF`; the value (0x8000) is the
/// same on Darwin and FreeBSD (sys/event.h: `#define EV_EOF 0x8000`).
const EV_EOF: u16 = if (@hasDecl(std.c.EV, "EOF")) std.c.EV.EOF else 0x8000;

/// Kqueue event struct. Darwin's kevent64_s carries a 2-slot ext[] used for
/// the optional generation-number assertion; FreeBSD's plain `struct kevent`
/// has `_ext[4]` but no public accessor, and we don't use it. See
/// `keventCall` for the syscall difference.
const KEvent = if (Environment.isFreeBSD) std.c.Kevent else std.posix.system.kevent64_s;

/// Thin shim over kevent64() vs kevent(). Darwin's kevent64 takes an extra
/// `flags` arg between nevents and timeout; FreeBSD's kevent does not.
inline fn keventCall(
    kq: i32,
    changes: [*]const KEvent,
    nchanges: c_int,
    events: [*]KEvent,
    nevents: c_int,
    timeout: ?*const std.posix.timespec,
) isize {
    if (comptime Environment.isFreeBSD) {
        return std.c.kevent(kq, changes, nchanges, events, nevents, timeout);
    }
    return posix.system.kevent64(kq, changes, nchanges, events, nevents, 0, timeout);
}

const EventType = if (Environment.isLinux) linux.epoll_event else KEvent;

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

    pub const FileAction = struct {
        fd: bun.FD,
        poll: *Poll,
        ctx: *anyopaque,
        tag: Pollable.Tag,
        onError: *const fn (*anyopaque, sys.Error) void,
    };

    pub const CloseAction = struct {
        fd: bun.FD,
        poll: *Poll,
        ctx: *anyopaque,
        tag: Pollable.Tag,
        onDone: *const fn (*anyopaque) void,
    };
};

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

pub const Poll = struct {
    flags: Flags.Set = Flags.Set.initEmpty(),
    generation_number: GenerationNumberInt = 0,

    const GenerationNumberInt = if (Environment.isMac and Environment.allow_assert) u64 else u0;

    var generation_number_monotonic: GenerationNumberInt = 0;

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

        pub fn fromKQueueEvent(kqueue_event: KEvent) Flags.Set {
            var flags = Flags.Set{};
            if (kqueue_event.filter == std.posix.system.EVFILT.READ) {
                flags.insert(Flags.readable);
                log("readable", .{});
                if (kqueue_event.flags & EV_EOF != 0) {
                    flags.insert(Flags.hup);
                    log("hup", .{});
                }
            } else if (kqueue_event.filter == std.posix.system.EVFILT.WRITE) {
                flags.insert(Flags.writable);
                log("writable", .{});
                if (kqueue_event.flags & EV_EOF != 0) {
                    flags.insert(Flags.hup);
                    log("hup", .{});
                }
            } else if (kqueue_event.filter == std.posix.system.EVFILT.PROC) {
                log("proc", .{});
                flags.insert(Flags.process);
            } else if (comptime Environment.isMac) {
                if (kqueue_event.filter == std.posix.system.EVFILT.MACHPORT) {
                    log("machport", .{});
                    flags.insert(Flags.machport);
                }
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
            comptime action: @Type(.enum_literal),
            tag: Pollable.Tag,
            poll: *Poll,
            fd: bun.FD,
            kqueue_event: *KEvent,
        ) void {
            log("register({s}, {f})", .{ @tagName(action), fd });
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

                // The generation-number sanity check rides in kevent64_s.ext[0],
                // which only exists on Darwin (GenerationNumberInt is u0 elsewhere).
                if (comptime Environment.isMac and Environment.allow_assert and action != .cancel) {
                    generation_number_monotonic += 1;
                    poll.generation_number = generation_number_monotonic;
                }
            }

            const one_shot_flag = std.posix.system.EV.ONESHOT;
            const udata: usize = @intFromPtr(Pollable.init(tag, poll).ptr());
            const filter: i16, const flags_: u16 = switch (comptime action) {
                .readable => .{ std.posix.system.EVFILT.READ, std.c.EV.ADD | one_shot_flag },
                .writable => .{ std.posix.system.EVFILT.WRITE, std.c.EV.ADD | one_shot_flag },
                .cancel => if (poll.flags.contains(.poll_readable))
                    .{ std.posix.system.EVFILT.READ, std.c.EV.DELETE }
                else if (poll.flags.contains(.poll_writable))
                    .{ std.posix.system.EVFILT.WRITE, std.c.EV.DELETE }
                else
                    unreachable,
                else => @compileError("invalid action: " ++ @tagName(action)),
            };
            kqueue_event.* = std.mem.zeroes(KEvent);
            kqueue_event.ident = @intCast(fd.native());
            kqueue_event.filter = filter;
            kqueue_event.flags = flags_;
            kqueue_event.udata = udata;
            // Darwin's kevent64_s.ext[0] carries the generation number for the
            // optional sanity assertion (GenerationNumberInt is u0 elsewhere).
            if (comptime @hasField(KEvent, "ext")) {
                const gen: u64 = if (comptime action == .cancel) poll.generation_number else generation_number_monotonic;
                kqueue_event.ext = .{ gen, 0 };
            }
        }
    };

    pub fn unregisterWithFd(this: *Poll, watcher_fd: bun.FD, fd: bun.FD) void {
        _ = linux.epoll_ctl(
            watcher_fd.cast(),
            linux.EPOLL.CTL_DEL,
            fd.cast(),
            null,
        );
        this.flags.remove(.registered);
    }

    pub fn onUpdateKQueue(
        event: KEvent,
    ) void {
        if (comptime Environment.isMac) {
            if (event.filter == std.c.EVFILT.MACHPORT)
                return;
        }

        const pollable = Pollable.from(event.udata);
        const tag = pollable.tag();
        switch (tag) {
            // The waker is registered with udata=0 → tag=.empty. The wakeup
            // exists only to unblock kevent() so the pending queue drains.
            .empty => {},

            inline else => |t| {
                const poll = pollable.poll();
                var this: *Pollable.Tag.Type(t) = @alignCast(@fieldParentPtr("io_poll", poll));
                if (event.flags == std.c.EV.ERROR) {
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
                var this: *Pollable.Tag.Type(t) = @alignCast(@fieldParentPtr("io_poll", poll));
                if (event.events & linux.EPOLL.ERR != 0) {
                    const errno = bun.sys.getErrno(event.events);
                    log("error() = {s}", .{@tagName(errno)});
                    this.onIOError(bun.sys.Error.fromCode(errno, .epoll_ctl));
                } else {
                    log("ready()", .{});
                    this.onReady();
                }
            },
        }
    }

    pub fn registerForEpoll(this: *Poll, tag: Pollable.Tag, loop: *Loop, comptime flag: Flags, one_shot: bool, fd: bun.FD) bun.sys.Maybe(void) {
        const watcher_fd = loop.pollfd();

        log("register: {s} ({f})", .{ @tagName(flag), fd });

        bun.assert(fd != bun.invalid_fd);

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

            const op: u32 = if (this.flags.contains(.was_ever_registered) or this.flags.contains(.needs_rearm)) linux.EPOLL.CTL_MOD else linux.EPOLL.CTL_ADD;

            const ctl = linux.epoll_ctl(
                watcher_fd.cast(),
                op,
                fd.cast(),
                &event,
            );

            if (bun.sys.Maybe(void).errnoSys(ctl, .epoll_ctl)) |errno| {
                return errno;
            }
            // Only mark if it successfully registered.
            // If it failed to register, we don't want to unregister it later if
            // it never had done so in the first place.
            this.flags.insert(.registered);
            this.flags.insert(.was_ever_registered);
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

        return .success;
    }
};

pub const retry = bun.sys.E.AGAIN;

pub const ReadState = @import("./pipes.zig").ReadState;
pub const PipeReader = @import("./PipeReader.zig").PipeReader;
pub const BufferedReader = @import("./PipeReader.zig").BufferedReader;
pub const BufferedWriter = @import("./PipeWriter.zig").BufferedWriter;
pub const WriteResult = @import("./PipeWriter.zig").WriteResult;
pub const WriteStatus = @import("./PipeWriter.zig").WriteStatus;
pub const StreamingWriter = @import("./PipeWriter.zig").StreamingWriter;
pub const StreamBuffer = @import("./PipeWriter.zig").StreamBuffer;
pub const FileType = @import("./pipes.zig").FileType;
pub const MaxBuf = @import("./MaxBuf.zig");

const bun = @import("bun");
const Environment = bun.Environment;
const assert = bun.assert;
const sys = bun.sys;
const ReadFile = bun.webcore.Blob.read_file.ReadFile;
const WriteFile = bun.webcore.Blob.write_file.WriteFile;

const std = @import("std");
const posix = std.posix;
const linux = std.os.linux;
