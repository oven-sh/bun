const bun = @import("root").bun;
const Output = bun.Output;
const JSC = bun.JSC;
const uws = bun.uws;
const Environment = bun.Environment;
const std = @import("std");
const uv = bun.windows.libuv;
pub const Loop = uv.Loop;

pub const KeepAlive = struct {
    status: Status = .inactive,

    const log = Output.scoped(.KeepAlive, false);

    const Status = enum { active, inactive, done };

    pub inline fn isActive(this: KeepAlive) bool {
        return this.status == .active;
    }

    /// Make calling ref() on this poll into a no-op.
    pub fn disable(this: *KeepAlive) void {
        if (this.status == .active) {
            this.unref(JSC.VirtualMachine.get());
        }

        this.status = .done;
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn deactivate(this: *KeepAlive, loop: *Loop) void {
        if (this.status != .active)
            return;

        this.status = .inactive;
        loop.dec();
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(this: *KeepAlive, loop: *Loop) void {
        if (this.status != .active)
            return;

        this.status = .active;
        loop.inc();
    }

    pub fn init() KeepAlive {
        return .{};
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(this: *KeepAlive, event_loop_ctx_: anytype) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        if (comptime @TypeOf(event_loop_ctx_) == JSC.EventLoopHandle) {
            event_loop_ctx_.loop().subActive(1);
            return;
        }
        const event_loop_ctx = JSC.AbstractVM(event_loop_ctx_);
        event_loop_ctx.platformEventLoop().subActive(1);
    }

    /// From another thread, Prevent a poll from keeping the process alive.
    pub fn unrefConcurrently(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        // _ = vm;
        if (this.status != .active)
            return;
        this.status = .inactive;
        vm.event_loop.unrefConcurrently();
    }

    /// Prevent a poll from keeping the process alive on the next tick.
    pub fn unrefOnNextTick(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        vm.event_loop_handle.?.dec();
    }

    /// From another thread, prevent a poll from keeping the process alive on the next tick.
    pub fn unrefOnNextTickConcurrently(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        if (this.status != .active)
            return;
        this.status = .inactive;
        // TODO: https://github.com/oven-sh/bun/pull/4410#discussion_r1317326194
        vm.event_loop_handle.?.dec();
    }

    /// Allow a poll to keep the process alive.
    pub fn ref(this: *KeepAlive, event_loop_ctx_: anytype) void {
        if (this.status != .inactive)
            return;
        this.status = .active;
        const EventLoopContext = @TypeOf(event_loop_ctx_);
        if (comptime EventLoopContext == JSC.EventLoopHandle) {
            event_loop_ctx_.ref();
            return;
        }
        const event_loop_ctx = JSC.AbstractVM(event_loop_ctx_);
        event_loop_ctx.platformEventLoop().ref();
    }

    /// Allow a poll to keep the process alive.
    pub fn refConcurrently(this: *KeepAlive, vm: *JSC.VirtualMachine) void {
        if (this.status != .inactive)
            return;
        this.status = .active;
        vm.event_loop.refConcurrently();
    }

    pub fn refConcurrentlyFromEventLoop(this: *KeepAlive, loop: *JSC.EventLoop) void {
        this.refConcurrently(loop.virtual_machine);
    }

    pub fn unrefConcurrentlyFromEventLoop(this: *KeepAlive, loop: *JSC.EventLoop) void {
        this.unrefConcurrently(loop.virtual_machine);
    }
};

const Posix = @import("./posix_event_loop.zig");

pub const FilePoll = struct {
    fd: bun.FileDescriptor,
    owner: Owner = undefined,
    flags: Flags.Set = Flags.Set{},
    next_to_free: ?*FilePoll = null,

    pub const Flags = Posix.FilePoll.Flags;
    pub const Owner = Posix.FilePoll.Owner;

    const log = Output.scoped(.FilePoll, false);

    pub inline fn isActive(this: *const FilePoll) bool {
        return this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn isWatching(this: *const FilePoll) bool {
        return !this.flags.contains(.needs_rearm) and (this.flags.contains(.poll_readable) or this.flags.contains(.poll_writable) or this.flags.contains(.poll_process));
    }

    pub inline fn isKeepingProcessAlive(this: *const FilePoll) bool {
        return !this.flags.contains(.closed) and this.isActive();
    }

    pub fn isRegistered(this: *const FilePoll) bool {
        return this.flags.contains(.poll_writable) or this.flags.contains(.poll_readable) or this.flags.contains(.poll_process) or this.flags.contains(.poll_machport);
    }

    /// Make calling ref() on this poll into a no-op.
    // pub fn disableKeepingProcessAlive(this: *FilePoll, vm: *JSC.VirtualMachine) void {
    pub fn disableKeepingProcessAlive(this: *FilePoll, abstract_vm: anytype) void {
        const vm = JSC.AbstractVM(abstract_vm);
        if (this.flags.contains(.closed))
            return;
        this.flags.insert(.closed);

        vm.platformEventLoop().subActive(@as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count))));
        // vm.event_loop_handle.?.active_handles -= @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
    }

    pub fn init(vm: *JSC.VirtualMachine, fd: bun.FileDescriptor, flags: Flags.Struct, comptime Type: type, owner: *Type) *FilePoll {
        return initWithOwner(vm, fd, flags, Owner.init(owner));
    }

    pub fn initWithOwner(vm: *JSC.VirtualMachine, fd: bun.FileDescriptor, flags: Flags.Struct, owner: Owner) *FilePoll {
        var poll = vm.rareData().filePolls(vm).get();
        poll.fd = fd;
        poll.flags = Flags.Set.init(flags);
        poll.owner = owner;
        poll.next_to_free = null;

        return poll;
    }

    pub fn deinit(this: *FilePoll) void {
        const vm = JSC.VirtualMachine.get();
        this.deinitWithVM(vm);
    }

    pub inline fn fileDescriptor(this: *FilePoll) bun.FileDescriptor {
        return this.fd;
    }

    pub const deinitForceUnregister = deinit;

    pub fn unregister(this: *FilePoll, loop: *Loop) bool {
        _ = loop;
        // TODO(@paperdave): This cast is extremely suspicious. At best, `fd` is
        // the wrong type (it should be a uv handle), at worst this code is a
        // crash due to invalid memory access.
        uv.uv_unref(@ptrFromInt(@intFromEnum(this.fd)));
        return true;
    }

    fn deinitPossiblyDefer(this: *FilePoll, vm: *JSC.VirtualMachine, loop: *Loop, polls: *FilePoll.Store) void {
        if (this.isRegistered()) {
            _ = this.unregister(loop);
        }

        const was_ever_registered = this.flags.contains(.was_ever_registered);
        this.flags = Flags.Set{};
        this.fd = bun.invalid_fd;
        polls.put(this, vm, was_ever_registered);
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

    pub fn clearEvent(poll: *FilePoll, flag: Flags) void {
        poll.flags.remove(flag);
    }

    pub fn isWritable(this: *FilePoll) bool {
        const readable = this.flags.contains(.writable);
        this.flags.remove(.writable);
        return readable;
    }

    pub fn deinitWithVM(this: *FilePoll, vm: *JSC.VirtualMachine) void {
        const loop = vm.event_loop_handle.?;
        this.deinitPossiblyDefer(vm, loop, vm.rareData().filePolls(vm));
    }

    pub fn enableKeepingProcessAlive(this: *FilePoll, abstract_vm: anytype) void {
        const vm = JSC.AbstractVM(abstract_vm);
        if (!this.flags.contains(.closed))
            return;
        this.flags.remove(.closed);

        // vm.event_loop_handle.?.active_handles += @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
        vm.platformEventLoop().addActive(@as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count))));
    }

    pub fn canActivate(this: *const FilePoll) bool {
        return !this.flags.contains(.has_incremented_poll_count);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn deactivate(this: *FilePoll, loop: *Loop) void {
        bun.assert(this.flags.contains(.has_incremented_poll_count));
        loop.active_handles -= @as(u32, @intFromBool(this.flags.contains(.has_incremented_poll_count)));
        log("deactivate - {d}", .{loop.active_handles});
        this.flags.remove(.has_incremented_poll_count);
    }

    /// Only intended to be used from EventLoop.Pollable
    pub fn activate(this: *FilePoll, loop: *Loop) void {
        loop.active_handles += @as(u32, @intFromBool(!this.flags.contains(.closed) and !this.flags.contains(.has_incremented_poll_count)));
        log("activate - {d}", .{loop.active_handles});
        this.flags.insert(.has_incremented_poll_count);
    }

    pub inline fn canRef(this: *const FilePoll) bool {
        if (this.flags.contains(.closed))
            return false;

        return !this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn canUnref(this: *const FilePoll) bool {
        return this.flags.contains(.has_incremented_poll_count);
    }

    pub fn onEnded(this: *FilePoll, event_loop_ctx_: anytype) void {
        const event_loop_ctx = JSC.AbstractVM(event_loop_ctx_);
        this.flags.remove(.keeps_event_loop_alive);
        this.flags.insert(.closed);
        // this.deactivate(vm.event_loop_handle.?);
        this.deactivate(event_loop_ctx.platformEventLoop());
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(this: *FilePoll, abstract_vm: anytype) void {
        const vm = JSC.AbstractVM(abstract_vm);
        if (!this.canUnref())
            return;
        log("unref", .{});
        // this.deactivate(vm.event_loop_handle.?);
        this.deactivate(vm.platformEventLoop());
    }

    /// Allow a poll to keep the process alive.
    // pub fn ref(this: *FilePoll, vm: *JSC.VirtualMachine) void {
    pub fn ref(this: *FilePoll, event_loop_ctx_: anytype) void {
        if (this.canRef())
            return;
        log("ref", .{});
        // this.activate(vm.event_loop_handle.?);
        const event_loop_ctx = JSC.AbstractVM(event_loop_ctx_);
        this.activate(event_loop_ctx.platformEventLoop());
    }

    const HiveArray = bun.HiveArray(FilePoll, 128).Fallback;

    pub const Store = struct {
        hive: HiveArray,
        pending_free_head: ?*FilePoll = null,
        pending_free_tail: ?*FilePoll = null,

        const log = Output.scoped(.FilePoll, false);

        pub fn init() Store {
            return .{
                .hive = HiveArray.init(bun.typedAllocator(FilePoll)),
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

            bun.assert(poll.next_to_free == null);

            if (this.pending_free_tail) |tail| {
                bun.assert(this.pending_free_head != null);
                bun.assert(tail.next_to_free == null);
                tail.next_to_free = poll;
            }

            if (this.pending_free_head == null) {
                this.pending_free_head = poll;
                bun.assert(this.pending_free_tail == null);
            }

            poll.flags.insert(.ignore_updates);
            this.pending_free_tail = poll;
            bun.assert(vm.after_event_loop_callback == null or vm.after_event_loop_callback == @as(?JSC.OpaqueCallback, @ptrCast(&processDeferredFrees)));
            vm.after_event_loop_callback = @ptrCast(&processDeferredFrees);
            vm.after_event_loop_callback_ctx = this;
        }
    };
};

pub const Waker = struct {
    loop: *bun.uws.WindowsLoop,

    pub fn init() !Waker {
        return .{ .loop = bun.uws.WindowsLoop.get() };
    }

    pub fn getFd(_: *const Waker) bun.FileDescriptor {
        @compileError("Waker.getFd is unsupported on Windows");
    }

    pub fn initWithFileDescriptor(_: bun.FileDescriptor) Waker {
        @compileError("Waker.initWithFileDescriptor is unsupported on Windows");
    }

    pub fn wait(this: Waker) void {
        this.loop.wait();
    }

    pub fn wake(this: *const Waker) void {
        this.loop.wakeup();
    }
};

pub const Closer = struct {
    io_request: uv.fs_t = std.mem.zeroes(uv.fs_t),
    pub usingnamespace bun.New(@This());

    pub fn close(fd: uv.uv_file, loop: *uv.Loop) void {
        var closer = Closer.new(.{});
        // data is not overridden by libuv when calling uv_fs_close, its ok to set it here
        closer.io_request.data = closer;
        if (uv.uv_fs_close(loop, &closer.io_request, fd, onClose).errEnum()) |err| {
            Output.debugWarn("libuv close() failed = {}", .{err});
            closer.destroy();
            return;
        }
    }

    fn onClose(req: *uv.fs_t) callconv(.C) void {
        var closer: *Closer = @fieldParentPtr("io_request", req);
        bun.assert(closer == @as(*Closer, @alignCast(@ptrCast(req.data.?))));
        bun.sys.syslog("uv_fs_close({}) = {}", .{ bun.toFD(req.file.fd), req.result });

        if (comptime Environment.allow_assert) {
            if (closer.io_request.result.errEnum()) |err| {
                Output.debugWarn("libuv close() failed = {}", .{err});
            }
        }

        req.deinit();
        closer.destroy();
    }
};
