const bun = @import("root").bun;
const Output = bun.Output;
const JSC = bun.JSC;
const uws = bun.uws;
const Environment = bun.Environment;
const std = @import("std");

pub const Loop = uws.Loop;

/// Track if an object whose file descriptor is being watched should keep the event loop alive.
/// This is not reference counted. It only tracks active or inactive.
pub const KeepAlive = struct {
    status: Status = .inactive,

    const log = Output.scoped(.KeepAlive, false);

    const Status = enum { active, inactive, done };

    pub inline fn isActive(this: KeepAlive) bool {
        return this.status == .active;
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disable(this: *KeepAlive) void {
        this.unref(JSC.VirtualMachine.get());
        this.status = .done;
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn deactivate(this: *KeepAlive, loop: *Loop) void {
        if (this.status != .active)
            return;

        this.status = .inactive;
        loop.num_polls -= 1;
        loop.active -|= 1;
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(this: *KeepAlive, loop: *Loop) void {
        if (this.status != .inactive)
            return;

        this.status = .active;
        loop.num_polls += 1;
        loop.active += 1;
    }

    pub fn init() KeepAlive {
        return .{};
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        vm.event_loop_handle.?.unref();
    }

    /// From another thread, Prevent a poll from keeping the process alive.
    pub fn unrefConcurrently(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        vm.event_loop_handle.?.unrefConcurrently();
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unrefOnNextTick(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        vm.pending_unref_counter +|= 1;
    }

    /// From another thread, prevent a poll from keeping the process alive on the next tick.
    pub fn unrefOnNextTickConcurrently(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        _ = @atomicRmw(@TypeOf(vm.pending_unref_counter), &vm.pending_unref_counter, .Add, 1, .Monotonic);
    }

    /// Allow a poll to keep the process alive.
    pub fn ref(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        if (this.status != .inactive)
            return;
        this.status = .active;
        vm.event_loop_handle.?.ref();
    }

    /// Allow a poll to keep the process alive.
    pub fn refConcurrently(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        if (this.status != .inactive)
            return;
        this.status = .active;
        vm.event_loop_handle.?.refConcurrently();
    }

    pub fn refConcurrentlyFromEventLoop(this: *KeepAlive, loop: *JSC.EventLoop) void {
        this.refConcurrently(loop.virtual_machine);
    }

    pub fn unrefConcurrentlyFromEventLoop(this: *KeepAlive, loop: *JSC.EventLoop) void {
        this.unrefConcurrently(loop.virtual_machine);
    }
};

const KQueueGenerationNumber = if (Environment.isMac and Environment.allow_assert) usize else u0;
pub const FilePoll = struct {
    var max_generation_number: KQueueGenerationNumber = 0;

    fd: bun.UFileDescriptor = invalid_fd,
    flags: Flags.Set = Flags.Set{},
    owner: Owner = undefined,

    /// We re-use FilePoll objects to avoid allocating new ones.
    ///
    /// That means we might run into situations where the event is stale.
    /// on macOS kevent64 has an extra pointer field so we use it for that
    /// linux doesn't have a field like that
    generation_number: KQueueGenerationNumber = 0,
    next_to_free: ?*FilePoll = null,

    const FileReader = JSC.WebCore.FileReader;
    const FileSink = JSC.WebCore.FileSink;
    const FIFO = JSC.WebCore.FIFO;
    const Subprocess = JSC.Subprocess;
    const BufferedInput = Subprocess.BufferedInput;
    const BufferedOutput = Subprocess.BufferedOutput;
    const DNSResolver = JSC.DNS.DNSResolver;
    const GetAddrInfoRequest = JSC.DNS.GetAddrInfoRequest;
    const Deactivated = opaque {
        pub var owner: Owner = Owner.init(@as(*Deactivated, @ptrFromInt(@as(usize, 0xDEADBEEF))));
    };

    pub const Owner = bun.TaggedPointerUnion(.{
        FileReader,
        FileSink,
        Subprocess,
        BufferedInput,
        FIFO,
        Deactivated,
        DNSResolver,
        GetAddrInfoRequest,
    });

    fn updateFlags(poll: *FilePoll, updated: Flags.Set) void {
        var flags = poll.flags;
        flags.remove(.readable);
        flags.remove(.writable);
        flags.remove(.process);
        flags.remove(.machport);
        flags.remove(.eof);
        flags.remove(.hup);

        flags.setUnion(updated);
        poll.flags = flags;
    }

    pub fn onKQueueEvent(poll: *FilePoll, loop: *Loop, kqueue_event: *const std.os.system.kevent64_s) void {
        if (KQueueGenerationNumber != u0)
            std.debug.assert(poll.generation_number == kqueue_event.ext[0]);

        poll.updateFlags(Flags.fromKQueueEvent(kqueue_event.*));
        poll.onUpdate(loop, kqueue_event.data);
    }

    pub fn onEpollEvent(poll: *FilePoll, loop: *Loop, epoll_event: *std.os.linux.epoll_event) void {
        poll.updateFlags(Flags.fromEpollEvent(epoll_event.*));
        poll.onUpdate(loop, 0);
    }

    pub fn clearEvent(poll: *FilePoll, flag: Flags) void {
        poll.flags.remove(flag);
    }

    pub fn isReadable(this: *FilePoll) bool {
        const readable = this.flags.contains(.readable);
        this.flags.remove(.readable);
        return readable;
    }

    pub fn isHUP(this: *FilePoll) bool {
        const readable = this.flags.contains(.hup);
        this.flags.remove(.hup);
        return readable;
    }

    pub fn isEOF(this: *FilePoll) bool {
        const readable = this.flags.contains(.eof);
        this.flags.remove(.eof);
        return readable;
    }

    pub fn isWritable(this: *FilePoll) bool {
        const readable = this.flags.contains(.writable);
        this.flags.remove(.writable);
        return readable;
    }

    pub fn deinit(this: *FilePoll) void {
        var vm = JSC.VirtualMachine.get();
        var loop = vm.event_loop_handle.?;
        this.deinitPossiblyDefer(vm, loop, vm.rareData().filePolls(vm), false);
    }

    pub fn deinitForceUnregister(this: *FilePoll) void {
        var vm = JSC.VirtualMachine.get();
        var loop = vm.event_loop_handle.?;
        this.deinitPossiblyDefer(vm, loop, vm.rareData().filePolls(vm), true);
    }

    fn deinitPossiblyDefer(this: *FilePoll, vm: *JSC.VirtualMachine, loop: *Loop, polls: *FilePoll.Store, force_unregister: bool) void {
        if (this.isRegistered()) {
            _ = this.unregister(loop, force_unregister);
        }

        this.owner = Deactivated.owner;
        const was_ever_registered = this.flags.contains(.was_ever_registered);
        this.flags = Flags.Set{};
        this.fd = invalid_fd;
        polls.put(this, vm, was_ever_registered);
    }

    pub fn deinitWithVM(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        var loop = vm.event_loop_handle.?;
        this.deinitPossiblyDefer(vm, loop, vm.rareData().filePolls(vm), false);
    }

    pub fn isRegistered(this: *const FilePoll) bool {
        return this.flags.contains(.poll_writable) or this.flags.contains(.poll_readable) or this.flags.contains(.poll_process) or this.flags.contains(.poll_machport);
    }

    const kqueue_or_epoll = if (Environment.isMac) "kevent" else "epoll";

    pub fn onUpdate(poll: *FilePoll, loop: *Loop, size_or_offset: i64) void {
        if (poll.flags.contains(.one_shot) and !poll.flags.contains(.needs_rearm)) {
            if (poll.flags.contains(.has_incremented_poll_count)) poll.deactivate(loop);
            poll.flags.insert(.needs_rearm);
        }
        var ptr = poll.owner;
        switch (ptr.tag()) {
            @field(Owner.Tag, "FIFO") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) FIFO", .{poll.fd});
                ptr.as(FIFO).ready(size_or_offset, poll.flags.contains(.hup));
            },
            @field(Owner.Tag, "Subprocess") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) Subprocess", .{poll.fd});
                var loader = ptr.as(JSC.Subprocess);

                loader.onExitNotificationTask();
            },
            @field(Owner.Tag, "FileSink") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) FileSink", .{poll.fd});
                var loader = ptr.as(JSC.WebCore.FileSink);
                loader.onPoll(size_or_offset, 0);
            },

            @field(Owner.Tag, "DNSResolver") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) DNSResolver", .{poll.fd});
                var loader: *DNSResolver = ptr.as(DNSResolver);
                loader.onDNSPoll(poll);
            },

            @field(Owner.Tag, "GetAddrInfoRequest") => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) GetAddrInfoRequest", .{poll.fd});
                var loader: *GetAddrInfoRequest = ptr.as(GetAddrInfoRequest);
                loader.onMachportChange();
            },

            else => {
                log("onUpdate " ++ kqueue_or_epoll ++ " (fd: {d}) disconnected?", .{poll.fd});
            },
        }
    }

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

        has_incremented_poll_count,

        disable,

        nonblocking,

        was_ever_registered,
        ignore_updates,

        pub fn poll(this: Flags) Flags {
            return switch (this) {
                .readable => .poll_readable,
                .writable => .poll_writable,
                .process => .poll_process,
                .machport => .poll_machport,
                else => this,
            };
        }

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
    };

    const HiveArray = bun.HiveArray(FilePoll, 128).Fallback;

    // We defer freeing FilePoll until the end of the next event loop iteration
    // This ensures that we don't free a FilePoll before the next callback is called
    pub const Store = struct {
        hive: HiveArray,
        pending_free_head: ?*FilePoll = null,
        pending_free_tail: ?*FilePoll = null,

        const log = Output.scoped(.FilePoll, false);

        pub fn init(allocator: std.mem.Allocator) Store {
            return .{
                .hive = HiveArray.init(allocator),
            };
        }

        pub fn get(this: *Store) *FilePoll {
            return this.hive.get();
        }

        pub fn processDeferredFrees(this: *Store) void {
            var next = this.pending_free_head;
            while (next) |current| {
                next = current.next_to_free;
                current.next_to_free = null;
                this.hive.put(current);
            }
            this.pending_free_head = null;
            this.pending_free_tail = null;
        }

        pub fn put(this: *Store, poll: *FilePoll, vm: *JSC.VirtualMachine, ever_registered: bool) void {
            if (!ever_registered) {
                this.hive.put(poll);
                return;
            }

            std.debug.assert(poll.next_to_free == null);

            if (this.pending_free_tail) |tail| {
                std.debug.assert(this.pending_free_head != null);
                std.debug.assert(tail.next_to_free == null);
                tail.next_to_free = poll;
            }

            if (this.pending_free_head == null) {
                this.pending_free_head = poll;
                std.debug.assert(this.pending_free_tail == null);
            }

            poll.flags.insert(.ignore_updates);
            this.pending_free_tail = poll;
            std.debug.assert(vm.after_event_loop_callback == null or vm.after_event_loop_callback == @as(?JSC.OpaqueCallback, @ptrCast(&processDeferredFrees)));
            vm.after_event_loop_callback = @ptrCast(&processDeferredFrees);
            vm.after_event_loop_callback_ctx = this;
        }
    };

    const log = Output.scoped(.FilePoll, false);

    pub inline fn isActive(this: *const FilePoll) bool {
        return this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn isWatching(this: *const FilePoll) bool {
        return !this.flags.contains(.needs_rearm) and (this.flags.contains(.poll_readable) or this.flags.contains(.poll_writable) or this.flags.contains(.poll_process));
    }

    pub inline fn isKeepingProcessAlive(this: *const FilePoll) bool {
        return !this.flags.contains(.disable) and this.isActive();
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disableKeepingProcessAlive(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        if (this.flags.contains(.disable))
            return;
        this.flags.insert(.disable);

        vm.event_loop_handle.?.active -= @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
    }

    pub fn enableKeepingProcessAlive(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        if (!this.flags.contains(.disable))
            return;
        this.flags.remove(.disable);

        vm.event_loop_handle.?.active += @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
    }

    pub fn canActivate(this: *const FilePoll) bool {
        return !this.flags.contains(.has_incremented_poll_count);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn deactivate(this: *FilePoll, loop: *Loop) void {
        std.debug.assert(this.flags.contains(.has_incremented_poll_count));
        loop.num_polls -= @as(i32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
        loop.active -|= @as(u32, @intFromBool(!this.flags.contains(.disable) and this.flags.contains(.has_incremented_poll_count)));

        this.flags.remove(.has_incremented_poll_count);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(this: *FilePoll, loop: *Loop) void {
        loop.num_polls += @as(i32, @intFromBool(!this.flags.contains(.has_incremented_poll_count)));
        loop.active += @as(u32, @intFromBool(!this.flags.contains(.disable) and !this.flags.contains(.has_incremented_poll_count)));
        this.flags.insert(.has_incremented_poll_count);
    }

    pub fn init(vm: *JSC.VirtualMachine, fd: bun.FileDescriptor, flags: Flags.Struct, comptime Type: type, owner: *Type) *FilePoll {
        return initWithOwner(vm, fd, flags, Owner.init(owner));
    }

    pub fn initWithOwner(vm: *JSC.VirtualMachine, fd: bun.FileDescriptor, flags: Flags.Struct, owner: Owner) *FilePoll {
        var poll = vm.rareData().filePolls(vm).get();
        poll.fd = @intCast(fd);
        poll.flags = Flags.Set.init(flags);
        poll.owner = owner;
        poll.next_to_free = null;

        if (KQueueGenerationNumber != u0) {
            max_generation_number +%= 1;
            poll.generation_number = max_generation_number;
        }
        return poll;
    }

    pub inline fn canRef(this: *const FilePoll) bool {
        if (this.flags.contains(.disable))
            return false;

        return !this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn canUnref(this: *const FilePoll) bool {
        return this.flags.contains(.has_incremented_poll_count);
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        if (!this.canUnref())
            return;
        log("unref", .{});
        this.deactivate(vm.event_loop_handle.?);
    }

    /// Allow a poll to keep the process alive.
    pub fn ref(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        if (this.canRef())
            return;
        log("ref", .{});
        this.activate(vm.event_loop_handle.?);
    }

    pub fn onTick(loop: *Loop, tagged_pointer: ?*anyopaque) callconv(.C) void {
        var tag = Pollable.from(tagged_pointer);

        if (tag.tag() != @field(Pollable.Tag, "FilePoll"))
            return;

        var file_poll: *FilePoll = tag.as(FilePoll);
        if (file_poll.flags.contains(.ignore_updates)) {
            return;
        }

        if (comptime Environment.isMac)
            onKQueueEvent(file_poll, loop, &loop.ready_polls[@as(usize, @intCast(loop.current_ready_poll))])
        else if (comptime Environment.isLinux)
            onEpollEvent(file_poll, loop, &loop.ready_polls[@as(usize, @intCast(loop.current_ready_poll))]);
    }

    const Pollable = bun.TaggedPointerUnion(
        .{
            FilePoll,
            Deactivated,
        },
    );

    comptime {
        @export(onTick, .{ .name = "Bun__internal_dispatch_ready_poll" });
    }

    const timeout = std.mem.zeroes(std.os.timespec);
    const kevent = std.c.kevent;
    const linux = std.os.linux;

    pub fn register(this: *FilePoll, loop: *Loop, flag: Flags, one_shot: bool) JSC.Maybe(void) {
        return registerWithFd(this, loop, flag, one_shot, this.fd);
    }
    pub fn registerWithFd(this: *FilePoll, loop: *Loop, flag: Flags, one_shot: bool, fd: u64) JSC.Maybe(void) {
        const watcher_fd = loop.fd;

        log("register: {s} ({d})", .{ @tagName(flag), fd });

        std.debug.assert(fd != invalid_fd);

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
                return errno;
            }
        } else if (comptime Environment.isMac) {
            var changelist = std.mem.zeroes([2]std.os.system.kevent64_s);
            const one_shot_flag: u16 = if (!this.flags.contains(.one_shot)) 0 else std.c.EV_ONESHOT;
            changelist[0] = switch (flag) {
                .readable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ this.generation_number, 0 },
                },
                .writable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ this.generation_number, 0 },
                },
                .process => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_PROC,
                    .data = 0,
                    .fflags = std.c.NOTE_EXIT,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ this.generation_number, 0 },
                },
                .machport => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_MACHPORT,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_ADD | one_shot_flag,
                    .ext = .{ this.generation_number, 0 },
                },
                else => unreachable,
            };

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
                return JSC.Maybe(void){
                    .err = bun.sys.Error.fromCode(errno, .kqueue),
                };
            }
        } else {
            bun.todo(@src(), {});
        }
        if (this.canActivate())
            this.activate(loop);
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

    const invalid_fd = bun.invalid_fd;

    pub fn unregister(this: *FilePoll, loop: *Loop, force_unregister: bool) JSC.Maybe(void) {
        return this.unregisterWithFd(loop, this.fd, force_unregister);
    }

    pub fn unregisterWithFd(this: *FilePoll, loop: *Loop, fd: bun.UFileDescriptor, force_unregister: bool) JSC.Maybe(void) {
        if (!(this.flags.contains(.poll_readable) or this.flags.contains(.poll_writable) or this.flags.contains(.poll_process) or this.flags.contains(.poll_machport))) {
            // no-op
            return JSC.Maybe(void).success;
        }

        std.debug.assert(fd != invalid_fd);
        const watcher_fd = loop.fd;
        const flag: Flags = brk: {
            if (this.flags.contains(.poll_readable))
                break :brk .readable;
            if (this.flags.contains(.poll_writable))
                break :brk .writable;
            if (this.flags.contains(.poll_process))
                break :brk .process;

            if (this.flags.contains(.poll_machport))
                break :brk .machport;
            return JSC.Maybe(void).success;
        };

        if (this.flags.contains(.needs_rearm) and !force_unregister) {
            log("unregister: {s} ({d}) skipped due to needs_rearm", .{ @tagName(flag), fd });
            this.flags.remove(.poll_process);
            this.flags.remove(.poll_readable);
            this.flags.remove(.poll_process);
            this.flags.remove(.poll_machport);
            return JSC.Maybe(void).success;
        }

        log("unregister: {s} ({d})", .{ @tagName(flag), fd });

        if (comptime Environment.isLinux) {
            const ctl = linux.epoll_ctl(
                watcher_fd,
                linux.EPOLL.CTL_DEL,
                @intCast(fd),
                null,
            );

            if (JSC.Maybe(void).errnoSys(ctl, .epoll_ctl)) |errno| {
                return errno;
            }
        } else if (comptime Environment.isMac) {
            var changelist = std.mem.zeroes([2]std.os.system.kevent64_s);

            changelist[0] = switch (flag) {
                .readable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_READ,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ 0, 0 },
                },
                .machport => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_MACHPORT,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ 0, 0 },
                },
                .writable => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_WRITE,
                    .data = 0,
                    .fflags = 0,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ 0, 0 },
                },
                .process => .{
                    .ident = @as(u64, @intCast(fd)),
                    .filter = std.os.system.EVFILT_PROC,
                    .data = 0,
                    .fflags = std.c.NOTE_EXIT,
                    .udata = @intFromPtr(Pollable.init(this).ptr()),
                    .flags = std.c.EV_DELETE,
                    .ext = .{ 0, 0 },
                },
                else => unreachable,
            };

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            const rc = std.os.system.kevent64(
                watcher_fd,
                &changelist,
                1,
                // The same array may be used for the changelist and eventlist.
                &changelist,
                1,
                KEVENT_FLAG_ERROR_EVENTS,
                &timeout,
            );
            // If an error occurs while
            // processing an element of the changelist and there is enough room
            // in the eventlist, then the event will be placed in the eventlist
            // with EV_ERROR set in flags and the system error in data.
            if (changelist[0].flags == std.c.EV_ERROR) {
                return JSC.Maybe(void).errnoSys(changelist[0].data, .kevent).?;
                // Otherwise, -1 will be returned, and errno will be set to
                // indicate the error condition.
            }

            const errno = std.c.getErrno(rc);
            switch (rc) {
                std.math.minInt(@TypeOf(rc))...-1 => return JSC.Maybe(void).errnoSys(@intFromEnum(errno), .kevent).?,
                else => {},
            }
        } else {
            bun.todo(@src(), {});
        }

        this.flags.remove(.needs_rearm);
        this.flags.remove(.one_shot);
        // we don't support both right now
        std.debug.assert(!(this.flags.contains(.poll_readable) and this.flags.contains(.poll_writable)));
        this.flags.remove(.poll_readable);
        this.flags.remove(.poll_writable);
        this.flags.remove(.poll_process);
        this.flags.remove(.poll_machport);
        if (this.isActive())
            this.deactivate(loop);

        return JSC.Maybe(void).success;
    }
};

pub const Waker = @import("io").Waker;
