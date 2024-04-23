const bun = @import("root").bun;
const std = @import("std");
const PosixSpawn = bun.spawn;
const Environment = bun.Environment;
const JSC = bun.JSC;
const Output = bun.Output;
const uv = bun.windows.libuv;
const pid_t = if (Environment.isPosix) std.os.pid_t else uv.uv_pid_t;
const fd_t = if (Environment.isPosix) std.os.fd_t else i32;
const Maybe = JSC.Maybe;

const win_rusage = struct {
    utime: struct {
        tv_sec: i64 = 0,
        tv_usec: i64 = 0,
    },
    stime: struct {
        tv_sec: i64 = 0,
        tv_usec: i64 = 0,
    },
    maxrss: u64 = 0,
    ixrss: u0 = 0,
    idrss: u0 = 0,
    isrss: u0 = 0,
    minflt: u0 = 0,
    majflt: u0 = 0,
    nswap: u0 = 0,
    inblock: u64 = 0,
    oublock: u64 = 0,
    msgsnd: u0 = 0,
    msgrcv: u0 = 0,
    nsignals: u0 = 0,
    nvcsw: u0 = 0,
    nivcsw: u0 = 0,
};

const IO_COUNTERS = extern struct {
    ReadOperationCount: u64 = 0,
    WriteOperationCount: u64 = 0,
    OtherOperationCount: u64 = 0,
    ReadTransferCount: u64 = 0,
    WriteTransferCount: u64 = 0,
    OtherTransferCount: u64 = 0,
};

extern "kernel32" fn GetProcessIoCounters(handle: std.os.windows.HANDLE, counters: *IO_COUNTERS) callconv(std.os.windows.WINAPI) c_int;

pub fn uv_getrusage(process: *uv.uv_process_t) win_rusage {
    var usage_info: Rusage = .{ .utime = .{}, .stime = .{} };
    const process_pid: *anyopaque = process.process_handle;
    const WinTime = std.os.windows.FILETIME;
    var starttime: WinTime = undefined;
    var exittime: WinTime = undefined;
    var kerneltime: WinTime = undefined;
    var usertime: WinTime = undefined;
    // We at least get process times
    if (std.os.windows.kernel32.GetProcessTimes(process_pid, &starttime, &exittime, &kerneltime, &usertime) == 1) {
        var temp: u64 = (@as(u64, kerneltime.dwHighDateTime) << 32) | kerneltime.dwLowDateTime;
        if (temp > 0) {
            usage_info.stime.tv_sec = @intCast(temp / 10000000);
            usage_info.stime.tv_usec = @intCast(temp % 1000000);
        }
        temp = (@as(u64, usertime.dwHighDateTime) << 32) | usertime.dwLowDateTime;
        if (temp > 0) {
            usage_info.utime.tv_sec = @intCast(temp / 10000000);
            usage_info.utime.tv_usec = @intCast(temp % 1000000);
        }
    }
    var counters: IO_COUNTERS = .{};
    _ = GetProcessIoCounters(process_pid, &counters);
    usage_info.inblock = counters.ReadOperationCount;
    usage_info.oublock = counters.WriteOperationCount;

    const memory = std.os.windows.GetProcessMemoryInfo(process_pid) catch return usage_info;
    usage_info.maxrss = memory.PeakWorkingSetSize / 1024;

    return usage_info;
}
pub const Rusage = if (Environment.isWindows) win_rusage else std.os.rusage;

const Subprocess = JSC.Subprocess;
const LifecycleScriptSubprocess = bun.install.LifecycleScriptSubprocess;
const ShellSubprocess = bun.shell.ShellSubprocess;
const ProcessHandle = @import("../../../cli/filter_run.zig").ProcessHandle;
// const ShellSubprocessMini = bun.shell.ShellSubprocessMini;
pub const ProcessExitHandler = struct {
    ptr: TaggedPointer = TaggedPointer.Null,

    const SyncProcess = if (Environment.isWindows) sync.SyncWindowsProcess else SyncProcessPosix;
    const SyncProcessPosix = opaque {};

    pub const TaggedPointer = bun.TaggedPointerUnion(
        .{
            Subprocess,
            LifecycleScriptSubprocess,
            ShellSubprocess,
            ProcessHandle,

            SyncProcess,
        },
    );

    pub fn init(this: *ProcessExitHandler, ptr: anytype) void {
        this.ptr = TaggedPointer.init(ptr);
    }

    pub fn call(this: *const ProcessExitHandler, process: *Process, status: Status, rusage: *const Rusage) void {
        if (this.ptr.isNull()) {
            return;
        }

        switch (this.ptr.tag()) {
            .Subprocess => {
                const subprocess = this.ptr.as(Subprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            .LifecycleScriptSubprocess => {
                const subprocess = this.ptr.as(LifecycleScriptSubprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            .ProcessHandle => {
                const subprocess = this.ptr.as(ProcessHandle);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, bun.meta.typeBaseName(@typeName(ShellSubprocess))) => {
                const subprocess = this.ptr.as(ShellSubprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, bun.meta.typeBaseName(@typeName(SyncProcess))) => {
                const subprocess = this.ptr.as(SyncProcess);
                if (comptime Environment.isPosix) {
                    @panic("This code should not reached");
                }
                subprocess.onProcessExit(status, rusage);
            },
            else => {
                @panic("Internal Bun error: ProcessExitHandler has an invalid tag. Please file a bug report.");
            },
        }
    }
};
pub const PidFDType = if (Environment.isLinux) fd_t else u0;

pub const Process = struct {
    pid: pid_t = 0,
    pidfd: PidFDType = 0,
    status: Status = Status{ .running = {} },
    poller: Poller = Poller{
        .detached = {},
    },
    ref_count: u32 = 1,
    exit_handler: ProcessExitHandler = ProcessExitHandler{},
    sync: bool = false,
    event_loop: JSC.EventLoopHandle,

    pub usingnamespace bun.NewRefCounted(Process, deinit);

    pub fn setExitHandler(this: *Process, handler: anytype) void {
        this.exit_handler.init(handler);
    }

    pub fn updateStatusOnWindows(this: *Process) void {
        if (this.poller == .uv) {
            if (!this.poller.uv.isActive() and this.status == .running) {
                onExitUV(&this.poller.uv, 0, 0);
            }
        }
    }

    pub fn initPosix(
        posix: PosixSpawnResult,
        event_loop: anytype,
        sync_: bool,
    ) *Process {
        return Process.new(.{
            .pid = posix.pid,
            .pidfd = posix.pidfd orelse 0,
            .event_loop = JSC.EventLoopHandle.init(event_loop),
            .sync = sync_,
            .poller = .{ .detached = {} },
        });
    }

    pub fn hasExited(this: *const Process) bool {
        return switch (this.status) {
            .exited => true,
            .signaled => true,
            .err => true,
            else => false,
        };
    }

    pub fn hasKilled(this: *const Process) bool {
        return switch (this.status) {
            .exited, .signaled => true,
            else => false,
        };
    }

    pub fn onExit(this: *Process, status: Status, rusage: *const Rusage) void {
        const exit_handler = this.exit_handler;
        this.status = status;

        if (this.hasExited()) {
            this.detach();
        }

        exit_handler.call(this, status, rusage);
    }

    pub fn signalCode(this: *const Process) ?bun.SignalCode {
        return this.status.signalCode();
    }

    pub fn waitPosix(this: *Process, sync_: bool) void {
        var rusage = std.mem.zeroes(Rusage);
        const waitpid_result = PosixSpawn.wait4(this.pid, if (sync_) 0 else std.os.W.NOHANG, &rusage);
        this.onWaitPid(&waitpid_result, &rusage);
    }

    pub fn wait(this: *Process, sync_: bool) void {
        if (comptime Environment.isPosix) {
            this.waitPosix(sync_);
        } else if (comptime Environment.isWindows) {}
    }

    pub fn onWaitPidFromWaiterThread(this: *Process, waitpid_result: *const JSC.Maybe(PosixSpawn.WaitPidResult), rusage: *const Rusage) void {
        if (comptime Environment.isWindows) {
            @compileError("not implemented on this platform");
        }
        if (this.poller == .waiter_thread) {
            this.poller.waiter_thread.unref(this.event_loop);
            this.poller = .{ .detached = {} };
        }
        this.onWaitPid(waitpid_result, rusage);
        this.deref();
    }

    pub fn onWaitPidFromEventLoopTask(this: *Process) void {
        if (comptime Environment.isWindows) {
            @compileError("not implemented on this platform");
        }
        this.wait(false);
        this.deref();
    }

    fn onWaitPid(this: *Process, waitpid_result: *const JSC.Maybe(PosixSpawn.WaitPidResult), rusage: *const Rusage) void {
        if (comptime !Environment.isPosix) {
            @compileError("not implemented on this platform");
        }

        const pid = this.pid;

        var rusage_result = rusage.*;

        const status: Status = Status.from(pid, waitpid_result) orelse brk: {
            switch (this.rewatchPosix()) {
                .result => {},
                .err => |err_| {
                    if (comptime Environment.isMac) {
                        if (err_.getErrno() == .SRCH) {
                            break :brk Status.from(pid, &PosixSpawn.wait4(
                                pid,
                                // Normally we would use WNOHANG to avoid blocking the event loop.
                                // However, there seems to be a race condition where the operating system
                                // tells us that the process has already exited (ESRCH) but the waitpid
                                // call with WNOHANG doesn't return the status yet.
                                // As a workaround, we use 0 to block the event loop until the status is available.
                                // This should be fine because the process has already exited, so the data
                                // should become available basically immediately. Also, testing has shown that this
                                // occurs extremely rarely and only under high load.
                                0,
                                &rusage_result,
                            ));
                        }
                    }
                    break :brk Status{ .err = err_ };
                },
            }
            break :brk null;
        } orelse return;

        this.onExit(status, &rusage_result);
    }

    pub fn watch(this: *Process, vm: anytype) JSC.Maybe(void) {
        _ = vm; // autofix

        if (comptime Environment.isWindows) {
            this.poller.uv.ref();
            return JSC.Maybe(void){ .result = {} };
        }

        if (WaiterThread.shouldUseWaiterThread()) {
            this.poller = .{ .waiter_thread = .{} };
            this.poller.waiter_thread.ref(this.event_loop);
            this.ref();
            WaiterThread.append(this);
            return JSC.Maybe(void){ .result = {} };
        }

        const watchfd = if (comptime Environment.isLinux) this.pidfd else this.pid;
        const poll = if (this.poller == .fd)
            this.poller.fd
        else
            bun.Async.FilePoll.init(this.event_loop, bun.toFD(watchfd), .{}, Process, this);

        this.poller = .{ .fd = poll };
        this.poller.fd.enableKeepingProcessAlive(this.event_loop);

        switch (this.poller.fd.register(
            this.event_loop.loop(),
            .process,
            true,
        )) {
            .result => {
                this.ref();
                return JSC.Maybe(void){ .result = {} };
            },
            .err => |err| {
                this.poller.fd.disableKeepingProcessAlive(this.event_loop);

                if (err.getErrno() != .SRCH) {
                    @panic("This shouldn't happen");
                }

                return .{ .err = err };
            },
        }

        unreachable;
    }

    pub fn rewatchPosix(this: *Process) JSC.Maybe(void) {
        if (WaiterThread.shouldUseWaiterThread()) {
            if (this.poller != .waiter_thread)
                this.poller = .{ .waiter_thread = .{} };
            this.poller.waiter_thread.ref(this.event_loop);
            this.ref();
            WaiterThread.append(this);
            return JSC.Maybe(void){ .result = {} };
        }

        if (this.poller == .fd) {
            return this.poller.fd.register(
                this.event_loop.loop(),
                .process,
                true,
            );
        } else {
            @panic("Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.");
        }
    }

    fn onExitUV(process: *uv.uv_process_t, exit_status: i64, term_signal: c_int) callconv(.C) void {
        const poller = @fieldParentPtr(PollerWindows, "uv", process);
        var this = @fieldParentPtr(Process, "poller", poller);
        const exit_code: u8 = if (exit_status >= 0) @as(u8, @truncate(@as(u64, @intCast(exit_status)))) else 0;
        const signal_code: ?bun.SignalCode = if (term_signal > 0 and term_signal < @intFromEnum(bun.SignalCode.SIGSYS)) @enumFromInt(term_signal) else null;
        const rusage = uv_getrusage(process);

        bun.windows.libuv.log("Process.onExit({d}) code: {d}, signal: {?}", .{ process.pid, exit_code, signal_code });

        if (exit_code >= 0) {
            this.close();
            this.onExit(
                .{
                    .exited = .{ .code = exit_code, .signal = signal_code orelse @enumFromInt(0) },
                },
                &rusage,
            );
        } else if (signal_code) |sig| {
            this.close();

            this.onExit(
                .{ .signaled = sig },
                &rusage,
            );
        } else {
            this.onExit(
                .{
                    .err = bun.sys.Error.fromCode(@intCast(exit_status), .waitpid),
                },
                &rusage,
            );
        }
    }

    fn onCloseUV(uv_handle: *uv.uv_process_t) callconv(.C) void {
        const poller = @fieldParentPtr(Poller, "uv", uv_handle);
        var this = @fieldParentPtr(Process, "poller", poller);
        bun.windows.libuv.log("Process.onClose({d})", .{uv_handle.pid});

        if (this.poller == .uv) {
            this.poller = .{ .detached = {} };
        }
        this.deref();
    }

    pub fn close(this: *Process) void {
        if (Environment.isPosix) {
            switch (this.poller) {
                .fd => |fd| {
                    fd.deinit();
                    this.poller = .{ .detached = {} };
                },

                .waiter_thread => |*waiter| {
                    waiter.disable();
                    this.poller = .{ .detached = {} };
                },
                else => {},
            }
        } else if (Environment.isWindows) {
            switch (this.poller) {
                .uv => |*process| {
                    if (comptime !Environment.isWindows) {
                        unreachable;
                    }

                    if (process.isClosed()) {
                        this.poller = .{ .detached = {} };
                    } else if (!process.isClosing()) {
                        this.ref();
                        process.close(&onCloseUV);
                    }
                },
                else => {},
            }
        }

        if (comptime Environment.isLinux) {
            if (this.pidfd != bun.invalid_fd.int() and this.pidfd > 0) {
                _ = bun.sys.close(bun.toFD(this.pidfd));
                this.pidfd = @intCast(bun.invalid_fd.int());
            }
        }
    }

    pub fn disableKeepingEventLoopAlive(this: *Process) void {
        this.poller.disableKeepingEventLoopAlive(this.event_loop);
    }

    pub fn hasRef(this: *Process) bool {
        return this.poller.hasRef();
    }

    pub fn enableKeepingEventLoopAlive(this: *Process) void {
        if (this.hasExited())
            return;

        this.poller.enableKeepingEventLoopAlive(this.event_loop);
    }

    pub fn detach(this: *Process) void {
        this.close();
        this.exit_handler = .{};
    }

    fn deinit(this: *Process) void {
        this.poller.deinit();
        this.destroy();
    }

    pub fn kill(this: *Process, signal: u8) Maybe(void) {
        if (comptime Environment.isPosix) {
            switch (this.poller) {
                .waiter_thread, .fd => {
                    const err = std.c.kill(this.pid, signal);
                    if (err != 0) {
                        const errno_ = bun.C.getErrno(err);

                        // if the process was already killed don't throw
                        if (errno_ != .SRCH)
                            return .{ .err = bun.sys.Error.fromCode(errno_, .kill) };
                    }
                },
                else => {},
            }
        } else if (comptime Environment.isWindows) {
            switch (this.poller) {
                .uv => |*handle| {
                    if (handle.kill(signal).toError(.kill)) |err| {
                        // if the process was already killed don't throw
                        if (err.errno != @intFromEnum(bun.C.E.SRCH)) {
                            return .{ .err = err };
                        }
                    }

                    return .{
                        .result = {},
                    };
                },
                else => {},
            }
        }

        return .{
            .result = {},
        };
    }
};

pub const Status = union(enum) {
    running: void,
    exited: Exited,
    signaled: bun.SignalCode,
    err: bun.sys.Error,

    pub fn isOK(this: *const Status) bool {
        return this.* == .exited and this.exited.code == 0;
    }

    pub const Exited = struct {
        code: u8 = 0,
        signal: bun.SignalCode = @enumFromInt(0),
    };

    pub fn from(pid: pid_t, waitpid_result: *const Maybe(PosixSpawn.WaitPidResult)) ?Status {
        var exit_code: ?u8 = null;
        var signal: ?u8 = null;

        switch (waitpid_result.*) {
            .err => |err_| {
                return .{ .err = err_ };
            },
            .result => |*result| {
                if (result.pid != pid) {
                    return null;
                }

                if (std.os.W.IFEXITED(result.status)) {
                    exit_code = std.os.W.EXITSTATUS(result.status);
                    // True if the process terminated due to receipt of a signal.
                }

                if (std.os.W.IFSIGNALED(result.status)) {
                    signal = @as(u8, @truncate(std.os.W.TERMSIG(result.status)));
                }

                // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/waitpid.2.html
                // True if the process has not terminated, but has stopped and can
                // be restarted.  This macro can be true only if the wait call spec-ified specified
                // ified the WUNTRACED option or if the child process is being
                // traced (see ptrace(2)).
                else if (std.os.W.IFSTOPPED(result.status)) {
                    signal = @as(u8, @truncate(std.os.W.STOPSIG(result.status)));
                }
            },
        }

        if (exit_code != null) {
            return .{
                .exited = .{ .code = exit_code.?, .signal = @enumFromInt(signal orelse 0) },
            };
        } else if (signal != null) {
            return .{
                .signaled = @enumFromInt(signal.?),
            };
        }

        return null;
    }

    pub fn signalCode(this: *const Status) ?bun.SignalCode {
        return switch (this.*) {
            .signaled => |sig| sig,
            .exited => |exit| if (@intFromEnum(exit.signal) > 0) exit.signal else null,
            else => null,
        };
    }

    pub fn format(self: @This(), comptime _: []const u8, _: anytype, writer: anytype) !void {
        if (self.signalCode()) |signal_code| {
            if (signal_code.toExitCode()) |code| {
                try writer.print("code: {d}", .{code});
                return;
            }
        }

        switch (self) {
            .exited => |exit| {
                try writer.print("code: {d}", .{exit.code});
            },
            .signaled => |signal| {
                try writer.print("signal: {d}", .{@intFromEnum(signal)});
            },
            .err => |err| {
                try writer.print("{}", .{err});
            },
            else => {},
        }
    }
};

pub const PollerPosix = union(enum) {
    fd: *bun.Async.FilePoll,
    waiter_thread: bun.Async.KeepAlive,
    detached: void,

    pub fn deinit(this: *PollerPosix) void {
        if (this.* == .fd) {
            this.fd.deinit();
        } else if (this.* == .waiter_thread) {
            this.waiter_thread.disable();
        }
    }

    pub fn enableKeepingEventLoopAlive(this: *Poller, event_loop: JSC.EventLoopHandle) void {
        switch (this.*) {
            .fd => |poll| {
                poll.enableKeepingProcessAlive(event_loop);
            },
            .waiter_thread => |*waiter| {
                waiter.ref(event_loop);
            },
            else => {},
        }
    }

    pub fn disableKeepingEventLoopAlive(this: *PollerPosix, event_loop: JSC.EventLoopHandle) void {
        switch (this.*) {
            .fd => |poll| {
                poll.disableKeepingProcessAlive(event_loop);
            },
            .waiter_thread => |*waiter| {
                waiter.unref(event_loop);
            },
            else => {},
        }
    }

    pub fn hasRef(this: *const PollerPosix) bool {
        return switch (this.*) {
            .fd => this.fd.canEnableKeepingProcessAlive(),
            .waiter_thread => this.waiter_thread.isActive(),
            else => false,
        };
    }
};

pub const Poller = if (Environment.isPosix) PollerPosix else PollerWindows;

pub const PollerWindows = union(enum) {
    uv: uv.uv_process_t,
    detached: void,

    pub fn deinit(this: *PollerWindows) void {
        if (this.* == .uv) {
            bun.assert(this.uv.isClosed());
        }
    }

    pub fn enableKeepingEventLoopAlive(this: *PollerWindows, event_loop: JSC.EventLoopHandle) void {
        _ = event_loop; // autofix
        switch (this.*) {
            .uv => |*process| {
                process.ref();
            },
            else => {},
        }
    }

    pub fn disableKeepingEventLoopAlive(this: *PollerWindows, event_loop: JSC.EventLoopHandle) void {
        _ = event_loop; // autofix

        // This is disabled on Windows
        // uv_unref() causes the onExitUV callback to *never* be called
        // This breaks a lot of stuff...
        // Once fixed, re-enable "should not hang after unref" test in spawn.test
        switch (this.*) {
            .uv => {
                this.uv.unref();
            },
            else => {},
        }
    }

    pub fn hasRef(this: *const PollerWindows) bool {
        return switch (this.*) {
            .uv => if (Environment.isWindows) this.uv.hasRef() else unreachable,
            else => false,
        };
    }
};

pub const WaiterThread = if (Environment.isPosix) WaiterThreadPosix else struct {
    pub inline fn shouldUseWaiterThread() bool {
        return false;
    }

    pub fn setShouldUseWaiterThread() void {}

    pub fn reloadHandlers() void {}
};

// Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
// use a thread to wait for the child process to exit.
// We use a single thread to call waitpid() in a loop.
const WaiterThreadPosix = struct {
    started: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    eventfd: if (Environment.isLinux) bun.FileDescriptor else u0 = undefined,

    js_process: ProcessQueue = .{},

    pub const ProcessQueue = NewQueue(Process);

    fn NewQueue(comptime T: type) type {
        return struct {
            queue: ConcurrentQueue = .{},
            active: std.ArrayList(*T) = std.ArrayList(*T).init(bun.default_allocator),

            const TaskQueueEntry = struct {
                process: *T,
                next: ?*TaskQueueEntry = null,

                pub usingnamespace bun.New(@This());
            };
            pub const ConcurrentQueue = bun.UnboundedQueue(TaskQueueEntry, .next);

            pub const ResultTask = struct {
                result: JSC.Maybe(PosixSpawn.WaitPidResult),
                subprocess: *T,
                rusage: Rusage,

                pub usingnamespace bun.New(@This());

                pub const runFromJSThread = runFromMainThread;

                pub fn runFromMainThread(self: *@This()) void {
                    const result = self.result;
                    const subprocess = self.subprocess;
                    const rusage = self.rusage;
                    self.destroy();
                    subprocess.onWaitPidFromWaiterThread(&result, &rusage);
                }

                pub fn runFromMainThreadMini(self: *@This(), _: *void) void {
                    self.runFromMainThread();
                }
            };

            pub const ResultTaskMini = struct {
                result: JSC.Maybe(PosixSpawn.WaitPidResult),
                subprocess: *T,
                task: JSC.AnyTaskWithExtraContext = .{},

                pub usingnamespace bun.New(@This());

                pub const runFromJSThread = runFromMainThread;

                pub fn runFromMainThread(self: *@This()) void {
                    const result = self.result;
                    const subprocess = self.subprocess;
                    self.destroy();
                    subprocess.onWaitPidFromWaiterThread(&result, &std.mem.zeroes(Rusage));
                }

                pub fn runFromMainThreadMini(self: *@This(), _: *void) void {
                    self.runFromMainThread();
                }
            };

            pub fn append(self: *@This(), process: *T) void {
                self.queue.push(
                    TaskQueueEntry.new(.{
                        .process = process,
                    }),
                );
            }

            pub fn loop(this: *@This()) void {
                {
                    var batch = this.queue.popBatch();
                    var iter = batch.iterator();
                    this.active.ensureUnusedCapacity(batch.count) catch unreachable;
                    while (iter.next()) |task| {
                        this.active.appendAssumeCapacity(task.process);
                        task.destroy();
                    }
                }

                var queue: []*T = this.active.items;
                var i: usize = 0;
                while (queue.len > 0 and i < queue.len) {
                    const process = queue[i];
                    const pid = process.pid;
                    // this case shouldn't really happen
                    if (pid == 0) {
                        _ = this.active.orderedRemove(i);
                        queue = this.active.items;
                        continue;
                    }

                    var rusage = std.mem.zeroes(Rusage);
                    const result = PosixSpawn.wait4(pid, std.os.W.NOHANG, &rusage);
                    if (result == .err or (result == .result and result.result.pid == pid)) {
                        _ = this.active.orderedRemove(i);
                        queue = this.active.items;

                        switch (process.event_loop) {
                            .js => |event_loop| {
                                event_loop.enqueueTaskConcurrent(
                                    JSC.ConcurrentTask.create(JSC.Task.init(
                                        ResultTask.new(
                                            .{
                                                .result = result,
                                                .subprocess = process,
                                                .rusage = rusage,
                                            },
                                        ),
                                    )),
                                );
                            },
                            .mini => |mini| {
                                const AnyTask = JSC.AnyTaskWithExtraContext.New(ResultTaskMini, void, ResultTaskMini.runFromMainThreadMini);
                                const out = ResultTaskMini.new(
                                    .{
                                        .result = result,
                                        .subprocess = process,
                                    },
                                );
                                out.task = AnyTask.init(out);

                                mini.enqueueTaskConcurrent(&out.task);
                            },
                        }
                    }

                    i += 1;
                }
            }
        };
    }

    pub fn setShouldUseWaiterThread() void {
        @atomicStore(bool, &should_use_waiter_thread, true, .Monotonic);
    }

    pub fn shouldUseWaiterThread() bool {
        return @atomicLoad(bool, &should_use_waiter_thread, .Monotonic);
    }

    pub fn append(process: anytype) void {
        switch (comptime @TypeOf(process)) {
            *Process => instance.js_process.append(process),
            else => @compileError("Unknown Process type"),
        }

        init() catch @panic("Failed to start WaiterThread");

        if (comptime Environment.isLinux) {
            const one = @as([8]u8, @bitCast(@as(usize, 1)));
            _ = std.os.write(instance.eventfd.cast(), &one) catch @panic("Failed to write to eventfd");
        }
    }

    var should_use_waiter_thread = false;

    const stack_size = 512 * 1024;
    pub var instance: WaiterThread = .{};
    pub fn init() !void {
        bun.assert(should_use_waiter_thread);

        if (instance.started.fetchMax(1, .Monotonic) > 0) {
            return;
        }

        if (comptime Environment.isLinux) {
            const linux = std.os.linux;
            instance.eventfd = bun.toFD(try std.os.eventfd(0, linux.EFD.NONBLOCK | linux.EFD.CLOEXEC | 0));
        }

        var thread = try std.Thread.spawn(.{ .stack_size = stack_size }, loop, .{});
        thread.detach();
    }

    fn wakeup(_: c_int) callconv(.C) void {
        const one = @as([8]u8, @bitCast(@as(usize, 1)));
        _ = bun.sys.write(instance.eventfd, &one).unwrap() catch 0;
    }

    pub fn reloadHandlers() void {
        if (!should_use_waiter_thread) {
            return;
        }

        if (comptime Environment.isLinux) {
            var current_mask = std.os.empty_sigset;
            std.os.linux.sigaddset(&current_mask, std.os.SIG.CHLD);
            const act = std.os.Sigaction{
                .handler = .{ .handler = &wakeup },
                .mask = current_mask,
                .flags = std.os.SA.NOCLDSTOP,
            };
            std.os.sigaction(std.os.SIG.CHLD, &act, null) catch {};
        }
    }

    pub fn loop() void {
        Output.Source.configureNamedThread("Waitpid");
        reloadHandlers();
        var this = &instance;

        outer: while (true) {
            this.js_process.loop();

            if (comptime Environment.isLinux) {
                var polls = [_]std.os.pollfd{
                    .{
                        .fd = this.eventfd.cast(),
                        .events = std.os.POLL.IN | std.os.POLL.ERR,
                        .revents = 0,
                    },
                };

                // Consume the pending eventfd
                var buf: [8]u8 = undefined;
                if (bun.sys.read(this.eventfd, &buf).unwrap() catch 0 > 0) {
                    continue :outer;
                }

                _ = std.os.poll(&polls, std.math.maxInt(i32)) catch 0;
            } else {
                var mask = std.os.empty_sigset;
                var signal: c_int = std.os.SIG.CHLD;
                const rc = std.c.sigwait(&mask, &signal);
                _ = rc;
            }
        }
    }
};

pub const PosixSpawnOptions = struct {
    stdin: Stdio = .ignore,
    stdout: Stdio = .ignore,
    stderr: Stdio = .ignore,
    extra_fds: []const Stdio = &.{},
    cwd: []const u8 = "",
    detached: bool = false,
    windows: void = {},
    argv0: ?[*:0]const u8 = null,
    stream: bool = true,

    /// Apple Extension: If this bit is set, rather
    /// than returning to the caller, posix_spawn(2)
    /// and posix_spawnp(2) will behave as a more
    /// featureful execve(2).
    use_execve_on_macos: bool = false,

    pub const Stdio = union(enum) {
        path: []const u8,
        inherit: void,
        ignore: void,
        buffer: void,
        pipe: bun.FileDescriptor,
        dup2: struct { out: bun.JSC.Subprocess.StdioKind, to: bun.JSC.Subprocess.StdioKind },
    };

    pub fn deinit(_: *const PosixSpawnOptions) void {
        // no-op
    }
};

pub const WindowsSpawnResult = struct {
    process_: ?*Process = null,
    stdin: StdioResult = .unavailable,
    stdout: StdioResult = .unavailable,
    stderr: StdioResult = .unavailable,
    extra_pipes: std.ArrayList(StdioResult) = std.ArrayList(StdioResult).init(bun.default_allocator),
    stream: bool = true,

    pub const StdioResult = union(enum) {
        /// inherit, ignore, path, pipe
        unavailable: void,

        buffer: *bun.windows.libuv.Pipe,
        buffer_fd: bun.FileDescriptor,
    };

    pub fn toProcess(
        this: *WindowsSpawnResult,
        _: anytype,
        sync_: bool,
    ) *Process {
        var process = this.process_.?;
        this.process_ = null;
        process.sync = sync_;
        return process;
    }

    pub fn close(this: *WindowsSpawnResult) void {
        if (this.process_) |proc| {
            this.process_ = null;
            proc.close();
            proc.detach();
            proc.deref();
        }
    }
};

pub const WindowsSpawnOptions = struct {
    stdin: Stdio = .ignore,
    stdout: Stdio = .ignore,
    stderr: Stdio = .ignore,
    extra_fds: []const Stdio = &.{},
    cwd: []const u8 = "",
    detached: bool = false,
    windows: WindowsOptions = .{},
    argv0: ?[*:0]const u8 = null,
    stream: bool = true,
    use_execve_on_macos: bool = false,

    pub const WindowsOptions = struct {
        verbatim_arguments: bool = false,
        hide_window: bool = true,
        loop: JSC.EventLoopHandle = undefined,
    };

    pub const Stdio = union(enum) {
        path: []const u8,
        inherit: void,
        ignore: void,
        buffer: *bun.windows.libuv.Pipe,
        pipe: bun.FileDescriptor,
        dup2: struct { out: bun.JSC.Subprocess.StdioKind, to: bun.JSC.Subprocess.StdioKind },

        pub fn deinit(this: *const Stdio) void {
            if (this.* == .buffer) {
                bun.default_allocator.destroy(this.buffer);
            }
        }
    };

    pub fn deinit(this: *const WindowsSpawnOptions) void {
        this.stdin.deinit();
        this.stdout.deinit();
        this.stderr.deinit();
        for (this.extra_fds) |stdio| {
            stdio.deinit();
        }
    }
};

pub const PosixSpawnResult = struct {
    pid: pid_t = 0,
    pidfd: ?PidFDType = null,
    stdin: ?bun.FileDescriptor = null,
    stdout: ?bun.FileDescriptor = null,
    stderr: ?bun.FileDescriptor = null,
    extra_pipes: std.ArrayList(bun.FileDescriptor) = std.ArrayList(bun.FileDescriptor).init(bun.default_allocator),

    memfds: [3]bool = .{ false, false, false },

    pub fn close(this: *WindowsSpawnResult) void {
        for (this.extra_pipes.items) |fd| {
            _ = bun.sys.close(fd);
        }

        this.extra_pipes.clearAndFree();
    }

    pub fn toProcess(
        this: *const PosixSpawnResult,
        event_loop: anytype,
        sync_: bool,
    ) *Process {
        return Process.initPosix(
            this.*,
            event_loop,
            sync_,
        );
    }

    fn pidfdFlagsForLinux() u32 {
        const kernel = bun.analytics.GenerateHeader.GeneratePlatform.kernelVersion();

        // pidfd_nonblock only supported in 5.10+
        return if (kernel.orderWithoutTag(.{ .major = 5, .minor = 10, .patch = 0 }).compare(.gte))
            std.os.O.NONBLOCK
        else
            0;
    }

    pub fn pifdFromPid(this: *PosixSpawnResult) JSC.Maybe(PidFDType) {
        if (!Environment.isLinux or WaiterThread.shouldUseWaiterThread()) {
            return .{ .err = bun.sys.Error.fromCode(.NOSYS, .pidfd_open) };
        }

        var pidfd_flags = pidfdFlagsForLinux();

        var rc = std.os.linux.pidfd_open(
            @intCast(this.pid),
            pidfd_flags,
        );
        while (true) {
            switch (std.os.linux.getErrno(rc)) {
                .SUCCESS => return JSC.Maybe(PidFDType){ .result = @intCast(rc) },
                .INTR => {
                    rc = std.os.linux.pidfd_open(
                        @intCast(this.pid),
                        pidfd_flags,
                    );
                    continue;
                },
                else => |err| {
                    if (err == .INVAL) {
                        if (pidfd_flags != 0) {
                            rc = std.os.linux.pidfd_open(
                                @intCast(this.pid),
                                0,
                            );
                            pidfd_flags = 0;
                            continue;
                        }
                    }

                    if (err == .NOSYS) {
                        WaiterThread.setShouldUseWaiterThread();
                        return .{ .err = bun.sys.Error.fromCode(.NOSYS, .pidfd_open) };
                    }

                    var status: u32 = 0;
                    // ensure we don't leak the child process on error
                    _ = std.os.linux.wait4(this.pid, &status, 0, null);

                    return .{ .err = bun.sys.Error.fromCode(err, .pidfd_open) };
                },
            }
        }

        unreachable;
    }
};

pub const SpawnOptions = if (Environment.isPosix) PosixSpawnOptions else WindowsSpawnOptions;
pub const SpawnProcessResult = if (Environment.isPosix) PosixSpawnResult else WindowsSpawnResult;
pub fn spawnProcess(
    options: *const SpawnOptions,
    argv: [*:null]?[*:0]const u8,
    envp: [*:null]?[*:0]const u8,
) !JSC.Maybe(SpawnProcessResult) {
    if (comptime Environment.isPosix) {
        return spawnProcessPosix(
            options,
            argv,
            envp,
        );
    } else {
        return spawnProcessWindows(
            options,
            argv,
            envp,
        );
    }
}
pub fn spawnProcessPosix(
    options: *const PosixSpawnOptions,
    argv: [*:null]?[*:0]const u8,
    envp: [*:null]?[*:0]const u8,
) !JSC.Maybe(PosixSpawnResult) {
    bun.Analytics.Features.spawn += 1;
    var actions = try PosixSpawn.Actions.init();
    defer actions.deinit();

    var attr = try PosixSpawn.Attr.init();
    defer attr.deinit();

    var flags: i32 = bun.C.POSIX_SPAWN_SETSIGDEF | bun.C.POSIX_SPAWN_SETSIGMASK;

    if (comptime Environment.isMac) {
        flags |= bun.C.POSIX_SPAWN_CLOEXEC_DEFAULT;

        if (options.use_execve_on_macos) {
            flags |= bun.C.POSIX_SPAWN_SETEXEC;

            if (options.stdin == .buffer or options.stdout == .buffer or options.stderr == .buffer) {
                Output.panic("Internal error: stdin, stdout, and stderr cannot be buffered when use_execve_on_macos is true", .{});
            }
        }
    }

    if (options.detached) {
        flags |= bun.C.POSIX_SPAWN_SETSID;
    }

    if (options.cwd.len > 0) {
        actions.chdir(options.cwd) catch return error.ChangingDirectoryFailed;
    }
    var spawned = PosixSpawnResult{};
    var extra_fds = std.ArrayList(bun.FileDescriptor).init(bun.default_allocator);
    errdefer extra_fds.deinit();
    var stack_fallback = std.heap.stackFallback(2048, bun.default_allocator);
    const allocator = stack_fallback.get();
    var to_close_at_end = std.ArrayList(bun.FileDescriptor).init(allocator);
    var to_set_cloexec = std.ArrayList(bun.FileDescriptor).init(allocator);
    defer {
        for (to_set_cloexec.items) |fd| {
            const fcntl_flags = bun.sys.fcntl(fd, std.os.F.GETFD, 0).unwrap() catch continue;
            _ = bun.sys.fcntl(fd, std.os.F.SETFD, bun.C.FD_CLOEXEC | fcntl_flags);
        }
        to_set_cloexec.clearAndFree();

        for (to_close_at_end.items) |fd| {
            _ = bun.sys.close(fd);
        }
        to_close_at_end.clearAndFree();
    }

    var to_close_on_error = std.ArrayList(bun.FileDescriptor).init(allocator);

    errdefer {
        for (to_close_on_error.items) |fd| {
            _ = bun.sys.close(fd);
        }
    }
    defer to_close_on_error.clearAndFree();

    attr.set(@intCast(flags)) catch {};
    attr.resetSignals() catch {};

    const stdio_options: [3]PosixSpawnOptions.Stdio = .{ options.stdin, options.stdout, options.stderr };
    const stdios: [3]*?bun.FileDescriptor = .{ &spawned.stdin, &spawned.stdout, &spawned.stderr };

    var dup_stdout_to_stderr: bool = false;

    for (0..3) |i| {
        const stdio = stdios[i];
        const fileno = bun.toFD(i);
        const flag = if (i == 0) @as(u32, std.os.O.RDONLY) else @as(u32, std.os.O.WRONLY);

        switch (stdio_options[i]) {
            .dup2 => |dup2| {
                // This is a hack to get around the ordering of the spawn actions.
                // If stdout is set so that it redirects to stderr, the order of actions will be like this:
                // 0. dup2(stderr, stdout) - this makes stdout point to stderr
                // 1. setup stderr (will make stderr point to write end of `stderr_pipe_fds`)
                // This is actually wrong, 0 will execute before 1 so stdout ends up writing to stderr instead of the pipe
                // So we have to instead do `dup2(stderr_pipe_fd[1], stdout)`
                // Right now we only allow one output redirection so it's okay.
                if (i == 1 and dup2.to == .stderr) {
                    dup_stdout_to_stderr = true;
                } else try actions.dup2(dup2.to.toFd(), dup2.out.toFd());
            },
            .inherit => {
                try actions.inherit(fileno);
            },
            .ignore => {
                try actions.openZ(fileno, "/dev/null", flag | std.os.O.CREAT, 0o664);
            },
            .path => |path| {
                try actions.open(fileno, path, flag | std.os.O.CREAT, 0o664);
            },
            .buffer => {
                if (Environment.isLinux) use_memfd: {
                    if (!options.stream and i > 0) {
                        // use memfd if we can
                        const label = switch (i) {
                            0 => "spawn_stdio_stdin",
                            1 => "spawn_stdio_stdout",
                            2 => "spawn_stdio_stderr",
                            else => "spawn_stdio_generic",
                        };

                        // We use the linux syscall api because the glibc requirement is 2.27, which is a little close for comfort.
                        const rc = std.os.linux.memfd_create(label, 0);
                        if (std.os.linux.getErrno(rc) != .SUCCESS) {
                            break :use_memfd;
                        }

                        const fd = bun.toFD(rc);
                        to_close_on_error.append(fd) catch {};
                        to_set_cloexec.append(fd) catch {};
                        try actions.dup2(fd, fileno);
                        stdio.* = fd;
                        spawned.memfds[i] = true;
                        continue;
                    }
                }

                const fds: [2]bun.FileDescriptor = brk: {
                    var fds_: [2]std.c.fd_t = undefined;
                    const rc = std.c.socketpair(std.os.AF.UNIX, std.os.SOCK.STREAM, 0, &fds_);
                    if (rc != 0) {
                        return error.SystemResources;
                    }

                    {
                        const before = std.c.fcntl(fds_[if (i == 0) 1 else 0], std.os.F.GETFD);
                        _ = std.c.fcntl(fds_[if (i == 0) 1 else 0], std.os.F.SETFD, before | std.os.FD_CLOEXEC);
                    }

                    if (comptime Environment.isMac) {
                        // SO_NOSIGPIPE
                        const before: i32 = 1;
                        _ = std.c.setsockopt(fds_[if (i == 0) 1 else 0], std.os.SOL.SOCKET, std.os.SO.NOSIGPIPE, &before, @sizeOf(c_int));
                    }

                    break :brk .{ bun.toFD(fds_[if (i == 0) 1 else 0]), bun.toFD(fds_[if (i == 0) 0 else 1]) };
                };

                if (i == 0) {
                    // their copy of stdin should be readable
                    _ = std.c.shutdown(@intCast(fds[1].cast()), std.os.SHUT.WR);

                    // our copy of stdin should be writable
                    _ = std.c.shutdown(@intCast(fds[0].cast()), std.os.SHUT.RD);

                    if (comptime Environment.isMac) {
                        // macOS seems to default to around 8 KB for the buffer size
                        // this is comically small.
                        // TODO: investigate if this should be adjusted on Linux.
                        const so_recvbuf: c_int = 1024 * 512;
                        const so_sendbuf: c_int = 1024 * 512;
                        _ = std.c.setsockopt(fds[1].cast(), std.os.SOL.SOCKET, std.os.SO.RCVBUF, &so_recvbuf, @sizeOf(c_int));
                        _ = std.c.setsockopt(fds[0].cast(), std.os.SOL.SOCKET, std.os.SO.SNDBUF, &so_sendbuf, @sizeOf(c_int));
                    }
                } else {

                    // their copy of stdout or stderr should be writable
                    _ = std.c.shutdown(@intCast(fds[1].cast()), std.os.SHUT.RD);

                    // our copy of stdout or stderr should be readable
                    _ = std.c.shutdown(@intCast(fds[0].cast()), std.os.SHUT.WR);

                    if (comptime Environment.isMac) {
                        // macOS seems to default to around 8 KB for the buffer size
                        // this is comically small.
                        // TODO: investigate if this should be adjusted on Linux.
                        const so_recvbuf: c_int = 1024 * 512;
                        const so_sendbuf: c_int = 1024 * 512;
                        _ = std.c.setsockopt(fds[0].cast(), std.os.SOL.SOCKET, std.os.SO.RCVBUF, &so_recvbuf, @sizeOf(c_int));
                        _ = std.c.setsockopt(fds[1].cast(), std.os.SOL.SOCKET, std.os.SO.SNDBUF, &so_sendbuf, @sizeOf(c_int));
                    }
                }

                try to_close_at_end.append(fds[1]);
                try to_close_on_error.append(fds[0]);

                try actions.dup2(fds[1], fileno);
                if (fds[1] != fileno)
                    try actions.close(fds[1]);

                stdio.* = fds[0];
            },
            .pipe => |fd| {
                try actions.dup2(fd, fileno);
                stdio.* = fd;
            },
        }
    }

    if (dup_stdout_to_stderr) {
        try actions.dup2(stdio_options[1].dup2.to.toFd(), stdio_options[1].dup2.out.toFd());
    }

    for (options.extra_fds, 0..) |ipc, i| {
        const fileno = bun.toFD(3 + i);

        switch (ipc) {
            .dup2 => @panic("TODO dup2 extra fd"),
            .inherit => {
                try actions.inherit(fileno);
            },
            .ignore => {
                try actions.openZ(fileno, "/dev/null", std.os.O.RDWR, 0o664);
            },

            .path => |path| {
                try actions.open(fileno, path, std.os.O.RDWR | std.os.O.CREAT, 0o664);
            },
            .buffer => {
                const fds: [2]bun.FileDescriptor = brk: {
                    var fds_: [2]std.c.fd_t = undefined;
                    const rc = std.c.socketpair(std.os.AF.UNIX, std.os.SOCK.STREAM, 0, &fds_);
                    if (rc != 0) {
                        return error.SystemResources;
                    }

                    // enable non-block
                    var before = std.c.fcntl(fds_[0], std.os.F.GETFD);

                    _ = std.c.fcntl(fds_[0], std.os.F.SETFD, before | bun.C.FD_CLOEXEC);

                    if (comptime Environment.isMac) {
                        // SO_NOSIGPIPE
                        _ = std.c.setsockopt(fds_[if (i == 0) 1 else 0], std.os.SOL.SOCKET, std.os.SO.NOSIGPIPE, &before, @sizeOf(c_int));
                    }

                    break :brk .{ bun.toFD(fds_[0]), bun.toFD(fds_[1]) };
                };

                try to_close_at_end.append(fds[1]);
                try to_close_on_error.append(fds[0]);

                try actions.dup2(fds[1], fileno);
                if (fds[1] != fileno)
                    try actions.close(fds[1]);
                try extra_fds.append(fds[0]);
            },
            .pipe => |fd| {
                try actions.dup2(fd, fileno);

                try extra_fds.append(fd);
            },
        }
    }

    const argv0 = options.argv0 orelse argv[0].?;
    const spawn_result = PosixSpawn.spawnZ(
        argv0,
        actions,
        attr,
        argv,
        envp,
    );

    switch (spawn_result) {
        .err => {
            return .{ .err = spawn_result.err };
        },
        .result => |pid| {
            spawned.pid = pid;
            spawned.extra_pipes = extra_fds;
            extra_fds = std.ArrayList(bun.FileDescriptor).init(bun.default_allocator);

            if (comptime Environment.isLinux) {
                switch (spawned.pifdFromPid()) {
                    .result => |pidfd| {
                        spawned.pidfd = pidfd;
                    },
                    .err => {},
                }
            }

            return .{ .result = spawned };
        },
    }

    unreachable;
}

pub fn spawnProcessWindows(
    options: *const WindowsSpawnOptions,
    argv: [*:null]?[*:0]const u8,
    envp: [*:null]?[*:0]const u8,
) !JSC.Maybe(WindowsSpawnResult) {
    bun.markWindowsOnly();
    bun.Analytics.Features.spawn += 1;

    var uv_process_options = std.mem.zeroes(uv.uv_process_options_t);

    uv_process_options.args = argv;
    uv_process_options.env = envp;
    uv_process_options.file = options.argv0 orelse argv[0].?;
    uv_process_options.exit_cb = &Process.onExitUV;
    var stack_allocator = std.heap.stackFallback(8192, bun.default_allocator);
    const allocator = stack_allocator.get();
    const loop = options.windows.loop.platformEventLoop().uv_loop;

    const cwd = try allocator.dupeZ(u8, options.cwd);
    defer allocator.free(cwd);

    uv_process_options.cwd = cwd.ptr;

    var uv_files_to_close = std.ArrayList(uv.uv_file).init(allocator);

    var failed = false;

    defer {
        for (uv_files_to_close.items) |fd| {
            bun.Async.Closer.close(fd, loop);
        }
        uv_files_to_close.clearAndFree();
    }

    errdefer failed = true;

    if (options.windows.hide_window) {
        uv_process_options.flags |= uv.UV_PROCESS_WINDOWS_HIDE;
    }

    if (options.windows.verbatim_arguments) {
        uv_process_options.flags |= uv.UV_PROCESS_WINDOWS_VERBATIM_ARGUMENTS;
    }

    if (options.detached) {
        uv_process_options.flags |= uv.UV_PROCESS_DETACHED;
    }

    var stdio_containers = try std.ArrayList(uv.uv_stdio_container_t).initCapacity(allocator, 3 + options.extra_fds.len);
    defer stdio_containers.deinit();
    @memset(stdio_containers.allocatedSlice(), std.mem.zeroes(uv.uv_stdio_container_t));
    stdio_containers.items.len = 3 + options.extra_fds.len;

    const stdios = .{ &stdio_containers.items[0], &stdio_containers.items[1], &stdio_containers.items[2] };
    const stdio_options: [3]WindowsSpawnOptions.Stdio = .{ options.stdin, options.stdout, options.stderr };

    // On Windows it seems don't have a dup2 equivalent with pipes
    // So we need to use file descriptors.
    // We can create a pipe with `uv_pipe(fds, 0, 0)` and get a read fd and write fd.
    // We give the write fd to stdout/stderr
    // And use the read fd to read from the output.
    var dup_fds: [2]uv.uv_file = .{ -1, -1 };
    var dup_src: ?u32 = null;
    var dup_tgt: ?u32 = null;
    inline for (0..3) |fd_i| {
        const pipe_flags = uv.UV_CREATE_PIPE | uv.UV_READABLE_PIPE | uv.UV_WRITABLE_PIPE;
        const stdio: *uv.uv_stdio_container_t = stdios[fd_i];

        const flag = comptime if (fd_i == 0) @as(u32, uv.O.RDONLY) else @as(u32, uv.O.WRONLY);

        var treat_as_dup: bool = false;

        if (fd_i == 1 and stdio_options[2] == .dup2) {
            treat_as_dup = true;
            dup_tgt = fd_i;
        } else if (fd_i == 2 and stdio_options[1] == .dup2) {
            treat_as_dup = true;
            dup_tgt = fd_i;
        } else switch (stdio_options[fd_i]) {
            .dup2 => {
                treat_as_dup = true;
                dup_src = fd_i;
            },
            .inherit => {
                stdio.flags = uv.UV_INHERIT_FD;
                stdio.data.fd = fd_i;
            },
            .ignore => {
                stdio.flags = uv.UV_IGNORE;
            },
            .path => |path| {
                var req = uv.fs_t.uninitialized;
                defer req.deinit();
                const rc = uv.uv_fs_open(loop, &req, &(try std.os.toPosixPath(path)), flag | uv.O.CREAT, 0o644, null);
                if (rc.toError(.open)) |err| {
                    failed = true;
                    return .{ .err = err };
                }

                stdio.flags = uv.UV_INHERIT_FD;
                const fd = rc.int();
                try uv_files_to_close.append(fd);
                stdio.data.fd = fd;
            },
            .buffer => |my_pipe| {
                try my_pipe.init(loop, false).unwrap();
                stdio.flags = pipe_flags;
                stdio.data.stream = @ptrCast(my_pipe);
            },
            .pipe => |fd| {
                stdio.flags = uv.UV_INHERIT_FD;
                stdio.data.fd = bun.uvfdcast(fd);
            },
        }

        if (treat_as_dup) {
            if (fd_i == 1) {
                if (uv.uv_pipe(&dup_fds, 0, 0).errEnum()) |e| {
                    return .{ .err = bun.sys.Error.fromCode(e, .pipe) };
                }
            }

            stdio.flags = uv.UV_INHERIT_FD;
            stdio.data = .{ .fd = dup_fds[1] };
        }
    }

    for (options.extra_fds, 0..) |ipc, i| {
        const stdio: *uv.uv_stdio_container_t = &stdio_containers.items[3 + i];

        const flag = @as(u32, uv.O.RDWR);

        switch (ipc) {
            .dup2 => @panic("TODO dup2 extra fd"),
            .inherit => {
                stdio.flags = uv.StdioFlags.inherit_fd;
                stdio.data.fd = @intCast(3 + i);
            },
            .ignore => {
                stdio.flags = uv.UV_IGNORE;
            },
            .path => |path| {
                var req = uv.fs_t.uninitialized;
                defer req.deinit();
                const rc = uv.uv_fs_open(loop, &req, &(try std.os.toPosixPath(path)), flag | uv.O.CREAT, 0o644, null);
                if (rc.toError(.open)) |err| {
                    failed = true;
                    return .{ .err = err };
                }

                stdio.flags = uv.StdioFlags.inherit_fd;
                const fd = rc.int();
                try uv_files_to_close.append(fd);
                stdio.data.fd = fd;
            },
            .buffer => |my_pipe| {
                try my_pipe.init(loop, false).unwrap();
                stdio.flags = uv.UV_CREATE_PIPE | uv.UV_WRITABLE_PIPE | uv.UV_READABLE_PIPE | uv.UV_OVERLAPPED_PIPE;
                stdio.data.stream = @ptrCast(my_pipe);
            },
            .pipe => |fd| {
                stdio.flags = uv.StdioFlags.inherit_fd;
                stdio.data.fd = bun.uvfdcast(fd);
            },
        }
    }

    uv_process_options.stdio = stdio_containers.items.ptr;
    uv_process_options.stdio_count = @intCast(stdio_containers.items.len);

    uv_process_options.exit_cb = &Process.onExitUV;
    var process = Process.new(.{
        .event_loop = options.windows.loop,
        .pid = 0,
    });

    defer {
        if (failed) {
            process.close();
            process.deref();
        }
    }

    errdefer failed = true;
    process.poller = .{ .uv = std.mem.zeroes(uv.Process) };

    defer {
        if (dup_src != null) {
            if (Environment.allow_assert) bun.assert(dup_src != null and dup_tgt != null);
        }

        if (failed) {
            if (dup_fds[0] != -1) {
                const r = bun.FDImpl.fromUV(dup_fds[0]).encode();
                _ = bun.sys.close(r);
            }
        }

        if (dup_fds[1] != -1) {
            const w = bun.FDImpl.fromUV(dup_fds[1]).encode();
            _ = bun.sys.close(w);
        }
    }
    if (process.poller.uv.spawn(loop, &uv_process_options).toError(.uv_spawn)) |err| {
        failed = true;
        return .{ .err = err };
    }

    process.pid = process.poller.uv.pid;
    bun.assert(process.poller.uv.exit_cb == &Process.onExitUV);

    var result = WindowsSpawnResult{
        .process_ = process,
        .extra_pipes = try std.ArrayList(WindowsSpawnResult.StdioResult).initCapacity(bun.default_allocator, options.extra_fds.len),
    };

    const result_stdios = .{ &result.stdin, &result.stdout, &result.stderr };
    inline for (0..3) |i| {
        const stdio = stdio_containers.items[i];
        const result_stdio: *WindowsSpawnResult.StdioResult = result_stdios[i];

        if (dup_src != null and i == dup_src.?) {
            result_stdio.* = .unavailable;
        } else if (dup_tgt != null and i == dup_tgt.?) {
            result_stdio.* = .{
                .buffer_fd = bun.FDImpl.fromUV(dup_fds[0]).encode(),
            };
        } else switch (stdio_options[i]) {
            .buffer => {
                result_stdio.* = .{ .buffer = @ptrCast(stdio.data.stream) };
            },
            else => {
                result_stdio.* = .unavailable;
            },
        }
    }

    for (options.extra_fds, 0..) |*input, i| {
        switch (input.*) {
            .buffer => {
                result.extra_pipes.appendAssumeCapacity(.{ .buffer = @ptrCast(stdio_containers.items[3 + i].data.stream) });
            },
            else => {
                result.extra_pipes.appendAssumeCapacity(.{ .unavailable = {} });
            },
        }
    }

    return .{ .result = result };
}

pub const sync = struct {
    pub const Options = struct {
        stdin: Stdio = .ignore,
        stdout: Stdio = .inherit,
        stderr: Stdio = .inherit,
        cwd: []const u8 = "",
        detached: bool = false,

        argv: []const []const u8 = &.{},
        envp: ?[*:null]?[*:0]const u8,

        use_execve_on_macos: bool = false,
        argv0: ?[*:0]const u8 = null,

        windows: if (Environment.isWindows) WindowsSpawnOptions.WindowsOptions else void = if (Environment.isWindows) .{} else undefined,

        pub const Stdio = union(enum) {
            inherit: void,
            ignore: void,
            buffer: if (Environment.isWindows) *uv.Pipe else void,

            pub fn toStdio(this: *const Stdio) SpawnOptions.Stdio {
                return switch (this.*) {
                    .inherit => .{ .inherit = this.inherit },
                    .ignore => .{ .ignore = this.ignore },
                    .buffer => .{ .buffer = this.buffer },
                };
            }
        };

        pub fn toSpawnOptions(this: *const Options) SpawnOptions {
            return SpawnOptions{
                .stdin = this.stdin.toStdio(),
                .stdout = this.stdout.toStdio(),
                .stderr = this.stderr.toStdio(),
                .cwd = this.cwd,
                .detached = this.detached,
                .use_execve_on_macos = this.use_execve_on_macos,
                .stream = false,
                .argv0 = this.argv0,
                .windows = if (Environment.isWindows)
                    this.windows
                else {},
            };
        }
    };

    pub const Result = struct {
        status: Status,
        stdout: std.ArrayList(u8) = .{ .items = &.{}, .allocator = bun.default_allocator, .capacity = 0 },
        stderr: std.ArrayList(u8) = .{ .items = &.{}, .allocator = bun.default_allocator, .capacity = 0 },

        pub fn isOK(this: *const Result) bool {
            return this.status.isOK();
        }
    };

    const SyncWindowsPipeReader = struct {
        chunks: std.ArrayList([]u8) = .{ .items = &.{}, .allocator = bun.default_allocator, .capacity = 0 },
        pipe: *uv.Pipe,

        err: bun.C.E = .SUCCESS,
        context: *SyncWindowsProcess,
        onDoneCallback: *const fn (*SyncWindowsProcess, tag: bun.FDTag, chunks: []const []u8, err: bun.C.E) void = &SyncWindowsProcess.onReaderDone,
        tag: bun.FDTag = .none,

        pub usingnamespace bun.New(@This());

        fn onAlloc(_: *SyncWindowsPipeReader, suggested_size: usize) []u8 {
            return bun.default_allocator.alloc(u8, suggested_size) catch bun.outOfMemory();
        }

        fn onRead(this: *SyncWindowsPipeReader, data: []const u8) void {
            this.chunks.append(@constCast(data)) catch bun.outOfMemory();
        }

        fn onError(this: *SyncWindowsPipeReader, err: bun.C.E) void {
            this.err = err;
            this.pipe.close(onClose);
        }

        fn onClose(pipe: *uv.Pipe) callconv(.C) void {
            const this: *SyncWindowsPipeReader = pipe.getData(SyncWindowsPipeReader) orelse @panic("Expected SyncWindowsPipeReader to have data");
            const context = this.context;
            const chunks = this.chunks.items;
            const err = if (this.err == .CANCELED) .SUCCESS else this.err;
            const tag = this.tag;
            const onDoneCallback = this.onDoneCallback;
            bun.default_allocator.destroy(this.pipe);
            bun.default_allocator.destroy(this);
            onDoneCallback(context, tag, chunks, err);
        }

        pub fn start(this: *SyncWindowsPipeReader) Maybe(void) {
            this.pipe.setData(this);
            this.pipe.ref();
            return this.pipe.readStart(this, onAlloc, onError, onRead);
        }
    };

    const SyncWindowsProcess = struct {
        stderr: []const []u8 = &.{},
        stdout: []const []u8 = &.{},
        err: bun.C.E = .SUCCESS,
        waiting_count: u8 = 1,
        process: *Process,
        status: ?Status = null,

        pub usingnamespace bun.New(@This());

        pub fn onProcessExit(this: *SyncWindowsProcess, status: Status, _: *const Rusage) void {
            this.status = status;
            this.waiting_count -= 1;
            this.process.detach();
            this.process.deref();
        }

        pub fn onReaderDone(this: *SyncWindowsProcess, tag: bun.FDTag, chunks: []const []u8, err: bun.C.E) void {
            switch (tag) {
                .stderr => {
                    this.stderr = chunks;
                },
                .stdout => {
                    this.stdout = chunks;
                },
                else => unreachable,
            }
            if (err != .SUCCESS) {
                this.err = err;
            }

            this.waiting_count -= 1;
        }
    };

    fn flattenOwnedChunks(total_allocator: std.mem.Allocator, chunks_allocator: std.mem.Allocator, chunks: []const []u8) ![]u8 {
        var total_size: usize = 0;
        for (chunks) |chunk| {
            total_size += chunk.len;
        }
        const result = try total_allocator.alloc(u8, total_size);
        var remain = result;
        for (chunks) |chunk| {
            @memcpy(remain[0..chunk.len], chunk);
            remain = remain[chunk.len..];
            chunks_allocator.free(chunk);
        }

        return result;
    }

    fn spawnWindowsWithoutPipes(
        options: *const Options,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) !Maybe(Result) {
        var loop = options.windows.loop.platformEventLoop();
        var spawned = switch (try spawnProcessWindows(&options.toSpawnOptions(), argv, envp)) {
            .err => |err| return .{ .err = err },
            .result => |proces| proces,
        };

        var process = spawned.toProcess(undefined, true);
        defer {
            process.detach();
            process.deref();
        }
        process.enableKeepingEventLoopAlive();

        while (!process.hasExited()) {
            loop.run();
        }

        return .{
            .result = .{
                .status = process.status,
            },
        };
    }

    fn spawnWindowsWithPipes(
        options: *const Options,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) !Maybe(Result) {
        var loop: JSC.EventLoopHandle = options.windows.loop;
        var spawned = switch (try spawnProcessWindows(&options.toSpawnOptions(), argv, envp)) {
            .err => |err| return .{ .err = err },
            .result => |proces| proces,
        };
        var this = SyncWindowsProcess.new(.{
            .process = spawned.toProcess(undefined, true),
        });
        this.process.setExitHandler(this);
        defer this.destroy();
        this.process.enableKeepingEventLoopAlive();
        inline for (.{ .stdout, .stderr }) |tag| {
            if (@field(spawned, @tagName(tag)) == .buffer) {
                var reader = SyncWindowsPipeReader.new(.{
                    .context = this,
                    .tag = tag,
                    .pipe = @field(spawned, @tagName(tag)).buffer,
                });
                this.waiting_count += 1;
                switch (reader.start()) {
                    .err => |err| {
                        _ = this.process.kill(1);
                        Output.panic("Unexpected error starting {s} pipe reader\n{}", .{ @tagName(tag), err });
                    },
                    .result => {},
                }
            }
        }

        while (this.waiting_count > 0) {
            loop.platformEventLoop().tick();
        }

        const result = Result{
            .status = this.status orelse @panic("Expected Process to have exited when waiting_count == 0"),
            .stdout = std.ArrayList(u8).fromOwnedSlice(
                bun.default_allocator,
                flattenOwnedChunks(bun.default_allocator, bun.default_allocator, this.stdout) catch bun.outOfMemory(),
            ),
            .stderr = std.ArrayList(u8).fromOwnedSlice(
                bun.default_allocator,
                flattenOwnedChunks(bun.default_allocator, bun.default_allocator, this.stderr) catch bun.outOfMemory(),
            ),
        };
        this.stdout = &.{};
        this.stderr = &.{};
        this.process.deref();
        return .{ .result = result };
    }

    pub fn spawnWithArgv(
        options: *const Options,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) !Maybe(Result) {
        if (comptime Environment.isWindows) {
            if (options.stdin != .buffer and options.stderr != .buffer and options.stdout != .buffer) {
                return try spawnWindowsWithoutPipes(options, argv, envp);
            }

            return try spawnWindowsWithPipes(options, argv, envp);
        }

        return spawnPosix(options, argv, envp);
    }

    pub fn spawn(
        options: *const Options,
    ) !Maybe(Result) {
        const envp = options.envp orelse std.c.environ;
        const argv = options.argv;
        var string_builder = bun.StringBuilder{};
        defer string_builder.deinit(bun.default_allocator);
        for (argv) |arg| {
            string_builder.countZ(arg);
        }

        try string_builder.allocate(bun.default_allocator);

        var args = std.ArrayList(?[*:0]u8).initCapacity(bun.default_allocator, argv.len + 1) catch bun.outOfMemory();
        defer args.deinit();

        for (argv) |arg| {
            args.appendAssumeCapacity(@constCast(string_builder.appendZ(arg).ptr));
        }
        args.appendAssumeCapacity(null);

        return spawnWithArgv(options, @ptrCast(args.items.ptr), @ptrCast(envp));
    }

    fn spawnPosix(
        options: *const Options,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) !Maybe(Result) {
        const process = switch (try spawnProcessPosix(&options.toSpawnOptions(), argv, envp)) {
            .err => |err| return .{ .err = err },
            .result => |proces| proces,
        };
        var out = [2]std.ArrayList(u8){
            std.ArrayList(u8).init(bun.default_allocator),
            std.ArrayList(u8).init(bun.default_allocator),
        };
        var out_fds = [2]bun.FileDescriptor{ process.stdout orelse bun.invalid_fd, process.stderr orelse bun.invalid_fd };
        defer {
            for (out_fds) |fd| {
                if (fd != bun.invalid_fd) {
                    _ = bun.sys.close(fd);
                }
            }

            if (comptime Environment.isLinux) {
                if (process.pidfd) |pidfd| {
                    _ = bun.sys.close(bun.toFD(pidfd));
                }
            }
        }

        var out_fds_to_wait_for = [2]bun.FileDescriptor{
            process.stdout orelse bun.invalid_fd,
            process.stderr orelse bun.invalid_fd,
        };

        if (process.memfds[0]) {
            out_fds_to_wait_for[0] = bun.invalid_fd;
        }

        if (process.memfds[1]) {
            out_fds_to_wait_for[1] = bun.invalid_fd;
        }

        while (out_fds_to_wait_for[0] != bun.invalid_fd or out_fds_to_wait_for[1] != bun.invalid_fd) {
            for (&out_fds_to_wait_for, &out, &out_fds) |*fd, *bytes, *out_fd| {
                if (fd.* == bun.invalid_fd) continue;
                while (true) {
                    bytes.ensureUnusedCapacity(16384) catch bun.outOfMemory();
                    switch (bun.sys.recvNonBlock(fd.*, bytes.unusedCapacitySlice())) {
                        .err => |err| {
                            if (err.isRetry() or err.getErrno() == .PIPE) {
                                break;
                            }
                            _ = std.c.kill(process.pid, 1);
                            return .{ .err = err };
                        },
                        .result => |bytes_read| {
                            bytes.items.len += bytes_read;
                            if (bytes_read == 0) {
                                _ = bun.sys.close(fd.*);
                                fd.* = bun.invalid_fd;
                                out_fd.* = bun.invalid_fd;
                                break;
                            }
                        },
                    }
                }
            }

            var poll_fds_buf = [_]std.c.pollfd{
                .{
                    .fd = 0,
                    .events = std.os.POLL.IN | std.os.POLL.ERR | std.os.POLL.HUP,
                    .revents = 0,
                },
                .{
                    .fd = 0,
                    .events = std.os.POLL.IN | std.os.POLL.ERR | std.os.POLL.HUP,
                    .revents = 0,
                },
            };
            var poll_fds: []std.c.pollfd = poll_fds_buf[0..];
            poll_fds.len = 0;

            if (out_fds_to_wait_for[0] != bun.invalid_fd) {
                poll_fds.len += 1;
                poll_fds[poll_fds.len - 1].fd = @intCast(out_fds_to_wait_for[0].cast());
            }

            if (out_fds_to_wait_for[1] != bun.invalid_fd) {
                poll_fds.len += 1;
                poll_fds[poll_fds.len - 1].fd = @intCast(out_fds_to_wait_for[0].cast());
            }

            if (poll_fds.len == 0) {
                break;
            }

            const rc = std.c.poll(poll_fds.ptr, @intCast(poll_fds.len), -1);
            switch (std.c.getErrno(rc)) {
                .SUCCESS => {},
                .AGAIN, .INTR => continue,
                else => |err| return .{ .err = bun.sys.Error.fromCode(err, .poll) },
            }
        }

        const status: Status = brk: {
            while (true) {
                if (Status.from(process.pid, &PosixSpawn.wait4(process.pid, 0, null))) |stat| break :brk stat;
            }

            unreachable;
        };

        if (comptime Environment.isLinux) {
            for (process.memfds[1..], &out, out_fds) |memfd, *bytes, out_fd| {
                if (memfd) {
                    bytes.* = bun.sys.File.from(out_fd).readToEnd(bun.default_allocator).bytes;
                }
            }
        }

        return .{
            .result = Result{
                .status = status,
                .stdout = out[0],
                .stderr = out[1],
            },
        };
    }
};
