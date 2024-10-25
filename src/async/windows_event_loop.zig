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

    const Self = @This();
    const log = Output.scoped(.KeepAlive, false);
    const Status = enum(u2) { active, inactive, done };

    pub inline fn isActive(this: Self) bool {
        return comptime this.status == .active;
    }

    pub fn disable(this: *Self) void {
        if (this.status == .active) {
            this.unref(JSC.VirtualMachine.get());
        }
        this.status = .done;
    }

    pub inline fn deactivate(this: *Self, loop: *Loop) void {
        if (this.status != .active) return;
        this.status = .inactive;
        loop.dec();
    }

    pub inline fn activate(this: *Self, loop: *Loop) void {
        if (this.status != .active) return;
        this.status = .active;
        loop.inc();
    }

    pub fn init() Self {
        return comptime .{};
    }

    pub inline fn unref(this: *Self, event_loop_ctx_: anytype) void {
        if (this.status != .active) return;
        this.status = .inactive;
        if (comptime @TypeOf(event_loop_ctx_) == JSC.EventLoopHandle) {
            event_loop_ctx_.loop().subActive(1);
            return;
        }
        JSC.AbstractVM(event_loop_ctx_).platformEventLoop().subActive(1);
    }

    pub inline fn unrefConcurrently(this: *Self, vm: *JSC.VirtualMachine) void {
        if (this.status != .active) return;
        this.status = .inactive;
        vm.event_loop.unrefConcurrently();
    }

    pub inline fn unrefOnNextTick(this: *Self, vm: *JSC.VirtualMachine) void {
        if (this.status != .active) return;
        this.status = .inactive;
        vm.event_loop_handle.?.dec();
    }

    pub inline fn unrefOnNextTickConcurrently(this: *Self, vm: *JSC.VirtualMachine) void {
        if (this.status != .active) return;
        this.status = .inactive;
        vm.event_loop_handle.?.dec();
    }

    pub inline fn ref(this: *Self, event_loop_ctx_: anytype) void {
        if (this.status != .inactive) return;
        this.status = .active;
        if (comptime @TypeOf(event_loop_ctx_) == JSC.EventLoopHandle) {
            event_loop_ctx_.ref();
            return;
        }
        JSC.AbstractVM(event_loop_ctx_).platformEventLoop().ref();
    }

    pub inline fn refConcurrently(this: *Self, vm: *JSC.VirtualMachine) void {
        if (this.status != .inactive) return;
        this.status = .active;
        vm.event_loop.refConcurrently();
    }

    pub inline fn refConcurrentlyFromEventLoop(this: *Self, loop: *JSC.EventLoop) void {
        this.refConcurrently(loop.virtual_machine);
    }

    pub inline fn unrefConcurrentlyFromEventLoop(this: *Self, loop: *JSC.EventLoop) void {
        this.unrefConcurrently(loop.virtual_machine);
    }
};

const Posix = @import("./posix_event_loop.zig");

pub const FilePoll = struct {
    fd: bun.FileDescriptor align(8),
    owner: Owner align(8) = undefined,
    flags: Flags.Set align(4) = Flags.Set{},
    next_to_free: ?*FilePoll align(8) = null,

    const Self = @This();
    pub const Flags = Posix.FilePoll.Flags;
    pub const Owner = Posix.FilePoll.Owner;
    const log = Output.scoped(.FilePoll, false);

    pub inline fn isActive(this: *const Self) bool {
        return comptime this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn isWatching(this: *const Self) bool {
        return comptime !this.flags.contains(.needs_rearm) and 
            this.flags.intersectsWith(Flags.Set.init(.{
                .poll_readable = true,
                .poll_writable = true,
                .poll_process = true,
            }));
    }

    pub inline fn isKeepingProcessAlive(this: *const Self) bool {
        return comptime !this.flags.contains(.closed) and this.isActive();
    }

    pub inline fn isRegistered(this: *const Self) bool {
        return comptime this.flags.intersectsWith(Flags.Set.init(.{
            .poll_writable = true,
            .poll_readable = true,
            .poll_process = true,
            .poll_machport = true,
        }));
    }

    pub inline fn disableKeepingProcessAlive(this: *Self, abstract_vm: anytype) void {
        const vm = JSC.AbstractVM(abstract_vm);
        if (this.flags.contains(.closed)) return;
        this.flags.insert(.closed);
        vm.platformEventLoop().subActive(@intFromBool(this.flags.contains(.has_incremented_poll_count)));
    }

    pub fn init(vm: *JSC.VirtualMachine, fd: bun.FileDescriptor, flags: Flags.Struct, comptime Type: type, owner: *Type) *Self {
        return initWithOwner(vm, fd, flags, Owner.init(owner));
    }

    pub fn initWithOwner(vm: *JSC.VirtualMachine, fd: bun.FileDescriptor, flags: Flags.Struct, owner: Owner) *Self {
        var poll = vm.rareData().filePolls(vm).get();
        poll.* = .{
            .fd = fd,
            .flags = Flags.Set.init(flags),
            .owner = owner,
        };
        return poll;
    }

    pub inline fn deinit(this: *Self) void {
        this.deinitWithVM(JSC.VirtualMachine.get());
    }

    pub inline fn fileDescriptor(this: *Self) bun.FileDescriptor {
        return this.fd;
    }

    pub const deinitForceUnregister = deinit;

    pub fn unregister(this: *Self, loop: *Loop) bool {
        uv.uv_unref(@ptrFromInt(@intFromEnum(this.fd)));
        return true;
    }

    fn deinitPossiblyDefer(this: *Self, vm: *JSC.VirtualMachine, loop: *Loop, polls: *FilePoll.Store) void {
        if (this.isRegistered()) {
            _ = this.unregister(loop);
        }

        const was_ever_registered = this.flags.contains(.was_ever_registered);
        this.flags = Flags.Set{};
        this.fd = bun.invalid_fd;
        polls.put(this, vm, was_ever_registered);
    }

    pub inline fn isReadable(this: *Self) bool {
        const readable = this.flags.contains(.readable);
        this.flags.remove(.readable);
        return readable;
    }

    pub inline fn isHUP(this: *Self) bool {
        const hup = this.flags.contains(.hup);
        this.flags.remove(.hup);
        return hup;
    }

    pub inline fn isEOF(this: *Self) bool {
        const eof = this.flags.contains(.eof);
        this.flags.remove(.eof);
        return eof;
    }

    pub inline fn clearEvent(poll: *Self, flag: Flags) void {
        poll.flags.remove(flag);
    }

    pub inline fn isWritable(this: *Self) bool {
        const writable = this.flags.contains(.writable);
        this.flags.remove(.writable);
        return writable;
    }

    pub inline fn deinitWithVM(this: *Self, vm: *JSC.VirtualMachine) void {
        this.deinitPossiblyDefer(vm, vm.event_loop_handle.?, vm.rareData().filePolls(vm));
    }

    pub inline fn enableKeepingProcessAlive(this: *Self, abstract_vm: anytype) void {
        const vm = JSC.AbstractVM(abstract_vm);
        if (!this.flags.contains(.closed)) return;
        this.flags.remove(.closed);
        vm.platformEventLoop().addActive(@intFromBool(this.flags.contains(.has_incremented_poll_count)));
    }

    pub inline fn canActivate(this: *const Self) bool {
        return !this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn deactivate(this: *Self, loop: *Loop) void {
        bun.assert(this.flags.contains(.has_incremented_poll_count));
        loop.active_handles -= @intFromBool(this.flags.contains(.has_incremented_poll_count));
        log("deactivate - {d}", .{loop.active_handles});
        this.flags.remove(.has_incremented_poll_count);
    }

    pub inline fn activate(this: *Self, loop: *Loop) void {
        loop.active_handles += @intFromBool(!this.flags.contains(.closed) and !this.flags.contains(.has_incremented_poll_count));
        log("activate - {d}", .{loop.active_handles});
        this.flags.insert(.has_incremented_poll_count);
    }

    pub inline fn canRef(this: *const Self) bool {
        return !this.flags.contains(.closed) and !this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn canUnref(this: *const Self) bool {
        return this.flags.contains(.has_incremented_poll_count);
    }

    pub inline fn onEnded(this: *Self, event_loop_ctx_: anytype) void {
        const event_loop_ctx = JSC.AbstractVM(event_loop_ctx_);
        this.flags.remove(.keeps_event_loop_alive);
        this.flags.insert(.closed);
        this.deactivate(event_loop_ctx.platformEventLoop());
    }

    pub inline fn unref(this: *Self, abstract_vm: anytype) void {
        const vm = JSC.AbstractVM(abstract_vm);
        if (!this.canUnref()) return;
        log("unref", .{});
        this.deactivate(vm.platformEventLoop());
    }

    pub inline fn ref(this: *Self, event_loop_ctx_: anytype) void {
        if (!this.canRef()) return;
        log("ref", .{});
        const event_loop_ctx = JSC.AbstractVM(event_loop_ctx_);
        this.activate(event_loop_ctx.platformEventLoop());
    }

    const HiveArray = bun.HiveArray(FilePoll, 128).Fallback;

    pub const Store = struct {
        hive: HiveArray align(8),
        pending_free_head: ?*FilePoll align(8) = null,
        pending_free_tail: ?*FilePoll align(8) = null,

        const log = Output.scoped(.FilePoll, false);

        pub fn init() Store {
            return .{ .hive = HiveArray.init(bun.typedAllocator(FilePoll)) };
        }

        pub inline fn get(this: *Store) *FilePoll {
            return this.hive.get();
        }

        pub fn processDeferredFrees(this: *Store) void {
            var current = this.pending_free_head;
            while (current) |poll| {
                const next = poll.next_to_free;
                poll.next_to_free = null;
                this.hive.put(poll);
                current = next;
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
            } else {
                this.pending_free_head = poll;
            }

            poll.flags.insert(.ignore_updates);
            this.pending_free_tail = poll;
            
            vm.after_event_loop_callback = @ptrCast(&processDeferredFrees);
            vm.after_event_loop_callback_ctx = this;
        }
    };
};

pub const Waker = struct {
    loop: *bun.uws.WindowsLoop align(8),

    pub fn init() !Waker {
        return .{ .loop = bun.uws.WindowsLoop.get() };
    }

    pub inline fn wait(this: Waker) void {
        this.loop.wait();
    }

    pub inline fn wake(this: *const Waker) void {
        this.loop.wakeup();
    }
};

pub const Closer = struct {
    io_request: uv.fs_t align(8) = std.mem.zeroes(uv.fs_t),
    
    pub usingnamespace bun.New(@This());

    pub fn close(fd: uv.uv_file, loop: *uv.Loop) void {
        var closer = Closer.new(.{});
        closer.io_request.data = closer;
        
        if (uv.uv_fs_close(loop, &closer.io_request, fd, onClose).errEnum()) |err| {
            Output.debugWarn("libuv close() failed = {}", .{err});
            closer.destroy();
        }
    }

    fn onClose(req: *uv.fs_t) callconv(.C) void {
        var closer: *Closer = @fieldParentPtr("io_request", req);
        if (closer != @as(*Closer, @alignCast(@ptrCast(req.data.?)))) return;
        
        if (comptime Environment.allow_assert) {
            if (req.result.errEnum()) |err| {
                Output.debugWarn("libuv close() failed = {}", .{err});
            }
        }

        req.deinit();
        closer.destroy();
    }
};