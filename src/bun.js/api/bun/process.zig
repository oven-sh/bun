const pid_t = if (Environment.isPosix) std.posix.pid_t else uv.uv_pid_t;
const fd_t = if (Environment.isPosix) std.posix.fd_t else i32;
const log = bun.Output.scoped(.PROCESS, .visible);

const win_rusage = struct {
    utime: struct {
        sec: i64 = 0,
        usec: i64 = 0,
    },
    stime: struct {
        sec: i64 = 0,
        usec: i64 = 0,
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

extern "kernel32" fn GetProcessIoCounters(handle: std.os.windows.HANDLE, counters: *IO_COUNTERS) callconv(.winapi) c_int;

pub fn uv_getrusage(process: *uv.uv_process_t) win_rusage {
    var usage_info: Rusage = .{ .utime = .{}, .stime = .{} };
    const process_pid: *anyopaque = process.process_handle;
    const WinTime = std.os.windows.FILETIME;
    var starttime: WinTime = undefined;
    var exittime: WinTime = undefined;
    var kerneltime: WinTime = undefined;
    var usertime: WinTime = undefined;
    // We at least get process times
    if (bun.windows.GetProcessTimes(process_pid, &starttime, &exittime, &kerneltime, &usertime) == 1) {
        var temp: u64 = (@as(u64, kerneltime.dwHighDateTime) << 32) | kerneltime.dwLowDateTime;
        if (temp > 0) {
            usage_info.stime.sec = @intCast(temp / 10000000);
            usage_info.stime.usec = @intCast(temp % 1000000);
        }
        temp = (@as(u64, usertime.dwHighDateTime) << 32) | usertime.dwLowDateTime;
        if (temp > 0) {
            usage_info.utime.sec = @intCast(temp / 10000000);
            usage_info.utime.usec = @intCast(temp % 1000000);
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
pub const Rusage = if (Environment.isWindows) win_rusage else std.posix.rusage;

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
            SecurityScanSubprocess,
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
            @field(TaggedPointer.Tag, @typeName(Subprocess)) => {
                const subprocess = this.ptr.as(Subprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, @typeName(LifecycleScriptSubprocess)) => {
                const subprocess = this.ptr.as(LifecycleScriptSubprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, @typeName(ProcessHandle)) => {
                const subprocess = this.ptr.as(ProcessHandle);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, @typeName(ShellSubprocess)) => {
                const subprocess = this.ptr.as(ShellSubprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, @typeName(SecurityScanSubprocess)) => {
                const subprocess = this.ptr.as(SecurityScanSubprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, @typeName(SyncProcess)) => {
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
    const Self = @This();
    const RefCount = bun.ptr.ThreadSafeRefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    pid: pid_t = 0,
    pidfd: PidFDType = 0,
    status: Status = Status{ .running = {} },
    poller: Poller = Poller{
        .detached = {},
    },
    ref_count: RefCount,
    exit_handler: ProcessExitHandler = ProcessExitHandler{},
    sync: bool = false,
    event_loop: jsc.EventLoopHandle,

    pub fn memoryCost(_: *const Process) usize {
        return @sizeOf(@This());
    }

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
        return bun.new(Process, .{
            .ref_count = .init(),
            .pid = posix.pid,
            .pidfd = posix.pidfd orelse 0,
            .event_loop = jsc.EventLoopHandle.init(event_loop),
            .sync = sync_,
            .poller = .{ .detached = {} },
            .status = brk: {
                if (posix.has_exited) {
                    var rusage = std.mem.zeroes(Rusage);
                    const waitpid_result = PosixSpawn.wait4(posix.pid, 0, &rusage);
                    break :brk Status.from(posix.pid, &waitpid_result) orelse Status{ .running = {} };
                }

                break :brk Status{ .running = {} };
            },
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
        const waitpid_result = PosixSpawn.wait4(this.pid, if (sync_) 0 else std.posix.W.NOHANG, &rusage);
        this.onWaitPid(&waitpid_result, &rusage);
    }

    pub fn wait(this: *Process, sync_: bool) void {
        if (comptime Environment.isPosix) {
            this.waitPosix(sync_);
        } else if (comptime Environment.isWindows) {}
    }

    pub fn onWaitPidFromWaiterThread(this: *Process, waitpid_result: *const bun.sys.Maybe(PosixSpawn.WaitPidResult), rusage: *const Rusage) void {
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

    fn onWaitPid(this: *Process, waitpid_result: *const bun.sys.Maybe(PosixSpawn.WaitPidResult), rusage: *const Rusage) void {
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

    pub fn watchOrReap(this: *Process) bun.sys.Maybe(bool) {
        if (this.hasExited()) {
            this.onExit(this.status, &std.mem.zeroes(Rusage));
            return .{ .result = true };
        }

        switch (this.watch()) {
            .err => |err| {
                if (comptime Environment.isPosix) {
                    if (err.getErrno() == .SRCH) {
                        this.wait(true);
                        return .{ .result = this.hasExited() };
                    }
                }

                return .{ .err = err };
            },
            .result => return .{ .result = this.hasExited() },
        }
    }

    pub fn watch(this: *Process) bun.sys.Maybe(void) {
        if (comptime Environment.isWindows) {
            this.poller.uv.ref();
            return .success;
        }

        if (WaiterThread.shouldUseWaiterThread()) {
            this.poller = .{ .waiter_thread = .{} };
            this.poller.waiter_thread.ref(this.event_loop);
            this.ref();
            WaiterThread.append(this);
            return .success;
        }

        const watchfd = if (comptime Environment.isLinux) this.pidfd else this.pid;
        const poll = if (this.poller == .fd)
            this.poller.fd
        else
            bun.Async.FilePoll.init(this.event_loop, .fromNative(watchfd), .{}, Process, this);

        this.poller = .{ .fd = poll };
        this.poller.fd.enableKeepingProcessAlive(this.event_loop);

        switch (this.poller.fd.register(
            this.event_loop.loop(),
            .process,
            true,
        )) {
            .result => {
                this.ref();
                return .success;
            },
            .err => |err| {
                this.poller.fd.disableKeepingProcessAlive(this.event_loop);

                return .{ .err = err };
            },
        }

        unreachable;
    }

    pub fn rewatchPosix(this: *Process) bun.sys.Maybe(void) {
        if (WaiterThread.shouldUseWaiterThread()) {
            if (this.poller != .waiter_thread)
                this.poller = .{ .waiter_thread = .{} };
            this.poller.waiter_thread.ref(this.event_loop);
            this.ref();
            WaiterThread.append(this);
            return .success;
        }

        if (this.poller == .fd) {
            const maybe = this.poller.fd.register(
                this.event_loop.loop(),
                .process,
                true,
            );
            switch (maybe) {
                .err => {},
                .result => this.ref(),
            }
            return maybe;
        } else {
            @panic("Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.");
        }
    }

    fn onExitUV(process: *uv.uv_process_t, exit_status: i64, term_signal: c_int) callconv(.c) void {
        const poller: *PollerWindows = @fieldParentPtr("uv", process);
        var this: *Process = @fieldParentPtr("poller", poller);
        const exit_code: u8 = if (exit_status >= 0) @as(u8, @truncate(@as(u64, @intCast(exit_status)))) else 0;
        const signal_code: ?bun.SignalCode = if (term_signal > 0 and term_signal < @intFromEnum(bun.SignalCode.SIGSYS)) @enumFromInt(term_signal) else null;
        const rusage = uv_getrusage(process);

        bun.windows.libuv.log("Process.onExit({d}) code: {d}, signal: {?}", .{ process.pid, exit_code, signal_code });

        if (signal_code) |sig| {
            this.close();

            this.onExit(
                .{ .signaled = sig },
                &rusage,
            );
        } else if (exit_code >= 0) {
            this.close();
            this.onExit(
                .{
                    .exited = .{ .code = exit_code, .signal = @enumFromInt(0) },
                },
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

    fn onCloseUV(uv_handle: *uv.uv_process_t) callconv(.c) void {
        const poller: *Poller = @fieldParentPtr("uv", uv_handle);
        var this: *Process = @fieldParentPtr("poller", poller);
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
            if (this.pidfd != bun.invalid_fd.value.as_system and this.pidfd > 0) {
                bun.FD.fromNative(this.pidfd).close();
                this.pidfd = bun.invalid_fd.value.as_system;
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
        bun.destroy(this);
    }

    pub fn kill(this: *Process, signal: u8) Maybe(void) {
        if (comptime Environment.isPosix) {
            switch (this.poller) {
                .waiter_thread, .fd => {
                    const err = std.c.kill(this.pid, signal);
                    if (err != 0) {
                        const errno_ = bun.sys.getErrno(err);

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
                        if (err.errno != @intFromEnum(bun.sys.E.SRCH)) {
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

                if (std.posix.W.IFEXITED(result.status)) {
                    exit_code = std.posix.W.EXITSTATUS(result.status);
                    // True if the process terminated due to receipt of a signal.
                }

                if (std.posix.W.IFSIGNALED(result.status)) {
                    signal = @as(u8, @truncate(std.posix.W.TERMSIG(result.status)));
                }

                // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/waitpid.2.html
                // True if the process has not terminated, but has stopped and can
                // be restarted.  This macro can be true only if the wait call spec-ified specified
                // ified the WUNTRACED option or if the child process is being
                // traced (see ptrace(2)).
                else if (std.posix.W.IFSTOPPED(result.status)) {
                    signal = @as(u8, @truncate(std.posix.W.STOPSIG(result.status)));
                }
            },
        }

        if (exit_code != null) {
            return .{
                .exited = .{
                    .code = exit_code.?,
                    .signal = @enumFromInt(signal orelse 0),
                },
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

    pub fn format(self: @This(), writer: *std.Io.Writer) !void {
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
                try writer.print("{f}", .{err});
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

    pub fn enableKeepingEventLoopAlive(this: *Poller, event_loop: jsc.EventLoopHandle) void {
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

    pub fn disableKeepingEventLoopAlive(this: *PollerPosix, event_loop: jsc.EventLoopHandle) void {
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

    pub fn enableKeepingEventLoopAlive(this: *PollerWindows, event_loop: jsc.EventLoopHandle) void {
        _ = event_loop; // autofix
        switch (this.*) {
            .uv => |*process| {
                process.ref();
            },
            else => {},
        }
    }

    pub fn disableKeepingEventLoopAlive(this: *PollerWindows, event_loop: jsc.EventLoopHandle) void {
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
            active: std.array_list.Managed(*T) = std.array_list.Managed(*T).init(bun.default_allocator),

            const TaskQueueEntry = struct {
                process: *T,
                next: ?*TaskQueueEntry = null,

                pub const new = bun.TrivialNew(@This());
                pub const deinit = bun.TrivialDeinit(@This());
            };
            pub const ConcurrentQueue = bun.UnboundedQueue(TaskQueueEntry, .next);

            pub const ResultTask = struct {
                result: bun.sys.Maybe(PosixSpawn.WaitPidResult),
                subprocess: *T,
                rusage: Rusage,

                pub const new = bun.TrivialNew(@This());

                pub const runFromJSThread = runFromMainThread;

                pub fn runFromMainThread(self: *@This()) void {
                    const result = self.result;
                    const subprocess = self.subprocess;
                    const rusage = self.rusage;
                    bun.destroy(self);
                    subprocess.onWaitPidFromWaiterThread(&result, &rusage);
                }

                pub fn runFromMainThreadMini(self: *@This(), _: *void) void {
                    self.runFromMainThread();
                }
            };

            pub const ResultTaskMini = struct {
                result: bun.sys.Maybe(PosixSpawn.WaitPidResult),
                subprocess: *T,
                task: jsc.AnyTaskWithExtraContext = .{},

                pub const new = bun.TrivialNew(@This());

                pub const runFromJSThread = runFromMainThread;

                pub fn runFromMainThread(self: *@This()) void {
                    const result = self.result;
                    const subprocess = self.subprocess;
                    bun.destroy(self);
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
                        task.deinit();
                    }
                }

                var i: usize = 0;
                while (i < this.active.items.len) {
                    var remove = false;
                    defer {
                        if (remove) {
                            _ = this.active.orderedRemove(i);
                        } else {
                            i += 1;
                        }
                    }

                    const process = this.active.items[i];
                    const pid = process.pid;
                    // this case shouldn't really happen
                    if (pid == 0) {
                        remove = true;
                        continue;
                    }

                    var rusage = std.mem.zeroes(Rusage);
                    const result = PosixSpawn.wait4(pid, std.posix.W.NOHANG, &rusage);
                    if (result == .err or (result == .result and result.result.pid == pid)) {
                        remove = true;

                        switch (process.event_loop) {
                            .js => |event_loop| {
                                event_loop.enqueueTaskConcurrent(
                                    jsc.ConcurrentTask.create(jsc.Task.init(
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
                                const AnyTask = jsc.AnyTaskWithExtraContext.New(ResultTaskMini, void, ResultTaskMini.runFromMainThreadMini);
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
                }
            }
        };
    }

    pub fn setShouldUseWaiterThread() void {
        @atomicStore(bool, &should_use_waiter_thread, true, .monotonic);
    }

    pub fn shouldUseWaiterThread() bool {
        return @atomicLoad(bool, &should_use_waiter_thread, .monotonic);
    }

    pub fn append(process: anytype) void {
        switch (comptime @TypeOf(process)) {
            *Process => instance.js_process.append(process),
            else => @compileError("Unknown Process type"),
        }

        init() catch @panic("Failed to start WaiterThread");

        if (comptime Environment.isLinux) {
            const one = @as([8]u8, @bitCast(@as(usize, 1)));
            _ = std.posix.write(instance.eventfd.cast(), &one) catch @panic("Failed to write to eventfd");
        }
    }

    var should_use_waiter_thread = false;

    const stack_size = 512 * 1024;
    pub var instance: WaiterThread = .{};
    pub fn init() !void {
        bun.assert(should_use_waiter_thread);

        if (instance.started.fetchMax(1, .monotonic) > 0) {
            return;
        }

        if (comptime Environment.isLinux) {
            const linux = std.os.linux;
            instance.eventfd = .fromNative(try std.posix.eventfd(0, linux.EFD.NONBLOCK | linux.EFD.CLOEXEC | 0));
        }

        var thread = try std.Thread.spawn(.{ .stack_size = stack_size }, loop, .{});
        thread.detach();
    }

    fn wakeup(_: c_int) callconv(.c) void {
        const one = @as([8]u8, @bitCast(@as(usize, 1)));
        _ = bun.sys.write(instance.eventfd, &one).unwrap() catch 0;
    }

    pub fn reloadHandlers() void {
        if (!should_use_waiter_thread) {
            return;
        }

        if (comptime Environment.isLinux) {
            var current_mask = std.posix.sigemptyset();
            std.os.linux.sigaddset(current_mask[0..1], std.posix.SIG.CHLD);
            const act = std.posix.Sigaction{
                .handler = .{ .handler = &wakeup },
                .mask = current_mask,
                .flags = std.posix.SA.NOCLDSTOP,
            };
            std.posix.sigaction(std.posix.SIG.CHLD, &act, null);
        }
    }

    pub fn loop() void {
        Output.Source.configureNamedThread("Waitpid");
        reloadHandlers();
        var this = &instance;

        outer: while (true) {
            this.js_process.loop();

            if (comptime Environment.isLinux) {
                var polls = [_]std.posix.pollfd{
                    .{
                        .fd = this.eventfd.cast(),
                        .events = std.posix.POLL.IN | std.posix.POLL.ERR,
                        .revents = 0,
                    },
                };

                // Consume the pending eventfd
                var buf: [8]u8 = undefined;
                if (bun.sys.read(this.eventfd, &buf).unwrap() catch 0 > 0) {
                    continue :outer;
                }

                _ = std.posix.poll(&polls, std.math.maxInt(i32)) catch 0;
            } else {
                var mask = std.posix.sigemptyset();
                var signal: c_int = std.posix.SIG.CHLD;
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
    ipc: ?bun.FileDescriptor = null,
    extra_fds: []const Stdio = &.{},
    cwd: []const u8 = "",
    detached: bool = false,
    windows: void = {},
    argv0: ?[*:0]const u8 = null,
    stream: bool = true,
    sync: bool = false,
    can_block_entire_thread_to_reduce_cpu_usage_in_fast_path: bool = false,
    /// Apple Extension: If this bit is set, rather
    /// than returning to the caller, posix_spawn(2)
    /// and posix_spawnp(2) will behave as a more
    /// featureful execve(2).
    use_execve_on_macos: bool = false,
    /// If we need to call `socketpair()`, this
    /// sets SO_NOSIGPIPE when true.
    ///
    /// If false, this avoids setting SO_NOSIGPIPE
    /// for stdout. This is used to preserve
    /// consistent shell semantics.
    no_sigpipe: bool = true,
    /// PTY slave fd for controlling terminal setup (-1 if not using PTY).
    pty_slave_fd: i32 = -1,

    pub const Stdio = union(enum) {
        path: []const u8,
        inherit: void,
        ignore: void,
        buffer: void,
        ipc: void,
        pipe: bun.FileDescriptor,
        // TODO: remove this entry, it doesn't seem to be used
        dup2: struct { out: bun.jsc.Subprocess.StdioKind, to: bun.jsc.Subprocess.StdioKind },
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
    extra_pipes: std.array_list.Managed(StdioResult) = std.array_list.Managed(StdioResult).init(bun.default_allocator),
    stream: bool = true,
    sync: bool = false,

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
    ipc: ?bun.FileDescriptor = null,
    extra_fds: []const Stdio = &.{},
    cwd: []const u8 = "",
    detached: bool = false,
    windows: WindowsOptions = .{},
    argv0: ?[*:0]const u8 = null,
    stream: bool = true,
    use_execve_on_macos: bool = false,
    can_block_entire_thread_to_reduce_cpu_usage_in_fast_path: bool = false,
    /// PTY not supported on Windows - this is a void placeholder for struct compatibility
    pty_slave_fd: void = {},
    pub const WindowsOptions = struct {
        verbatim_arguments: bool = false,
        hide_window: bool = true,
        loop: jsc.EventLoopHandle = undefined,
    };

    pub const Stdio = union(enum) {
        path: []const u8,
        inherit: void,
        ignore: void,
        buffer: *bun.windows.libuv.Pipe,
        ipc: *bun.windows.libuv.Pipe,
        pipe: bun.FileDescriptor,
        dup2: struct { out: bun.jsc.Subprocess.StdioKind, to: bun.jsc.Subprocess.StdioKind },

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
    ipc: ?bun.FileDescriptor = null,
    extra_pipes: std.array_list.Managed(bun.FileDescriptor) = std.array_list.Managed(bun.FileDescriptor).init(bun.default_allocator),

    memfds: [3]bool = .{ false, false, false },

    // ESRCH can happen when requesting the pidfd
    has_exited: bool = false,

    pub fn close(this: *WindowsSpawnResult) void {
        for (this.extra_pipes.items) |fd| {
            fd.close();
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
            bun.O.NONBLOCK
        else
            0;
    }

    pub fn pifdFromPid(this: *PosixSpawnResult) bun.sys.Maybe(PidFDType) {
        if (!Environment.isLinux or WaiterThread.shouldUseWaiterThread()) {
            return .{ .err = bun.sys.Error.fromCode(.NOSYS, .pidfd_open) };
        }

        const pidfd_flags = pidfdFlagsForLinux();

        while (true) {
            switch (brk: {
                const rc = bun.sys.pidfd_open(
                    @intCast(this.pid),
                    pidfd_flags,
                );
                if (rc == .err and rc.getErrno() == .INVAL) {
                    // Retry once, incase they don't support PIDFD_NONBLOCK.
                    break :brk bun.sys.pidfd_open(
                        @intCast(this.pid),
                        0,
                    );
                }
                break :brk rc;
            }) {
                .err => |err| {
                    switch (err.getErrno()) {
                        // seccomp filters can be used to block this system call or pidfd's altogether
                        // https://github.com/moby/moby/issues/42680
                        // so let's treat a bunch of these as actually meaning we should use the waiter thread fallback instead.
                        .NOSYS, .OPNOTSUPP, .PERM, .ACCES, .INVAL => {
                            WaiterThread.setShouldUseWaiterThread();
                            return .{ .err = err };
                        },

                        // No such process can happen if it exited between the time we got the pid and called pidfd_open
                        // Until we switch to CLONE_PIDFD, this needs to be handled separately.
                        .SRCH => {},

                        // For all other cases, ensure we don't leak the child process on error
                        // That would cause Zombie processes to accumulate.
                        else => {
                            while (true) {
                                var status: u32 = 0;
                                const rc = std.os.linux.wait4(this.pid, &status, 0, null);

                                switch (bun.sys.getErrno(rc)) {
                                    .SUCCESS => {},
                                    .INTR => {
                                        continue;
                                    },
                                    else => {},
                                }

                                break;
                            }
                        },
                    }

                    return .{ .err = err };
                },
                .result => |rc| {
                    return .{ .result = rc };
                },
            }

            unreachable;
        }
    }
};

pub const SpawnOptions = if (Environment.isPosix) PosixSpawnOptions else WindowsSpawnOptions;
pub const SpawnProcessResult = if (Environment.isPosix) PosixSpawnResult else WindowsSpawnResult;
pub fn spawnProcess(
    options: *const SpawnOptions,
    argv: [*:null]?[*:0]const u8,
    envp: [*:null]?[*:0]const u8,
) !bun.sys.Maybe(SpawnProcessResult) {
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
) !bun.sys.Maybe(PosixSpawnResult) {
    bun.analytics.Features.spawn += 1;
    var actions = try PosixSpawn.Actions.init();
    defer actions.deinit();

    var attr = try PosixSpawn.Attr.init();
    defer attr.deinit();

    var flags: i32 = bun.c.POSIX_SPAWN_SETSIGDEF | bun.c.POSIX_SPAWN_SETSIGMASK;

    if (comptime Environment.isMac) {
        flags |= bun.c.POSIX_SPAWN_CLOEXEC_DEFAULT;

        if (options.use_execve_on_macos) {
            flags |= bun.c.POSIX_SPAWN_SETEXEC;

            if (options.stdin == .buffer or options.stdout == .buffer or options.stderr == .buffer) {
                Output.panic("Internal error: stdin, stdout, and stderr cannot be buffered when use_execve_on_macos is true", .{});
            }
        }
    }

    if (options.detached) {
        flags |= bun.c.POSIX_SPAWN_SETSID;
    }

    // Pass PTY slave fd to attr for controlling terminal setup
    attr.pty_slave_fd = options.pty_slave_fd;

    if (options.cwd.len > 0) {
        try actions.chdir(options.cwd);
    }
    var spawned = PosixSpawnResult{};
    var extra_fds = std.array_list.Managed(bun.FileDescriptor).init(bun.default_allocator);
    errdefer extra_fds.deinit();
    var stack_fallback = std.heap.stackFallback(2048, bun.default_allocator);
    const allocator = stack_fallback.get();
    var to_close_at_end = std.array_list.Managed(bun.FileDescriptor).init(allocator);
    var to_set_cloexec = std.array_list.Managed(bun.FileDescriptor).init(allocator);
    defer {
        for (to_set_cloexec.items) |fd| {
            _ = bun.sys.setCloseOnExec(fd);
        }
        to_set_cloexec.clearAndFree();

        for (to_close_at_end.items) |fd| {
            fd.close();
        }
        to_close_at_end.clearAndFree();
    }

    var to_close_on_error = std.array_list.Managed(bun.FileDescriptor).init(allocator);

    errdefer {
        for (to_close_on_error.items) |fd| {
            fd.close();
        }
    }
    defer to_close_on_error.clearAndFree();

    attr.set(@intCast(flags)) catch {};
    attr.resetSignals() catch {};

    if (options.ipc) |ipc| {
        try actions.inherit(ipc);
        spawned.ipc = ipc;
    }

    const stdio_options: [3]PosixSpawnOptions.Stdio = .{ options.stdin, options.stdout, options.stderr };
    const stdios: [3]*?bun.FileDescriptor = .{ &spawned.stdin, &spawned.stdout, &spawned.stderr };

    var dup_stdout_to_stderr: bool = false;

    for (0..3) |i| {
        const stdio = stdios[i];
        const fileno = bun.FD.fromNative(@intCast(i));
        const flag = if (i == 0) @as(u32, bun.O.RDONLY) else @as(u32, bun.O.WRONLY);

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
            .ipc, .ignore => {
                try actions.openZ(fileno, "/dev/null", flag | bun.O.CREAT, 0o664);
            },
            .path => |path| {
                try actions.open(fileno, path, flag | bun.O.CREAT, 0o664);
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

                        const fd = bun.sys.memfd_create(label, .cross_process).unwrap() catch break :use_memfd;

                        to_close_on_error.append(fd) catch {};
                        to_set_cloexec.append(fd) catch {};
                        try actions.dup2(fd, fileno);
                        stdio.* = fd;
                        spawned.memfds[i] = true;
                        continue;
                    }
                }

                const fds: [2]bun.FileDescriptor = brk: {
                    const pair = if (!options.no_sigpipe) try bun.sys.socketpairForShell(
                        std.posix.AF.UNIX,
                        std.posix.SOCK.STREAM,
                        0,
                        .blocking,
                    ).unwrap() else try bun.sys.socketpair(
                        std.posix.AF.UNIX,
                        std.posix.SOCK.STREAM,
                        0,
                        .blocking,
                    ).unwrap();
                    break :brk .{ pair[if (i == 0) 1 else 0], pair[if (i == 0) 0 else 1] };
                };

                if (i == 0) {
                    // their copy of stdin should be readable
                    _ = std.c.shutdown(@intCast(fds[1].cast()), std.posix.SHUT.WR);

                    // our copy of stdin should be writable
                    _ = std.c.shutdown(@intCast(fds[0].cast()), std.posix.SHUT.RD);

                    if (comptime Environment.isMac) {
                        // macOS seems to default to around 8 KB for the buffer size
                        // this is comically small.
                        // TODO: investigate if this should be adjusted on Linux.
                        const so_recvbuf: c_int = 1024 * 512;
                        const so_sendbuf: c_int = 1024 * 512;
                        _ = std.c.setsockopt(fds[1].cast(), std.posix.SOL.SOCKET, std.posix.SO.RCVBUF, &so_recvbuf, @sizeOf(c_int));
                        _ = std.c.setsockopt(fds[0].cast(), std.posix.SOL.SOCKET, std.posix.SO.SNDBUF, &so_sendbuf, @sizeOf(c_int));
                    }
                } else {

                    // their copy of stdout or stderr should be writable
                    _ = std.c.shutdown(@intCast(fds[1].cast()), std.posix.SHUT.RD);

                    // our copy of stdout or stderr should be readable
                    _ = std.c.shutdown(@intCast(fds[0].cast()), std.posix.SHUT.WR);

                    if (comptime Environment.isMac) {
                        // macOS seems to default to around 8 KB for the buffer size
                        // this is comically small.
                        // TODO: investigate if this should be adjusted on Linux.
                        const so_recvbuf: c_int = 1024 * 512;
                        const so_sendbuf: c_int = 1024 * 512;
                        _ = std.c.setsockopt(fds[0].cast(), std.posix.SOL.SOCKET, std.posix.SO.RCVBUF, &so_recvbuf, @sizeOf(c_int));
                        _ = std.c.setsockopt(fds[1].cast(), std.posix.SOL.SOCKET, std.posix.SO.SNDBUF, &so_sendbuf, @sizeOf(c_int));
                    }
                }

                try to_close_at_end.append(fds[1]);
                try to_close_on_error.append(fds[0]);

                if (!options.sync) {
                    try bun.sys.setNonblocking(fds[0]).unwrap();
                }

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
        const fileno = bun.FD.fromNative(@intCast(3 + i));

        switch (ipc) {
            .dup2 => @panic("TODO dup2 extra fd"),
            .inherit => {
                try actions.inherit(fileno);
            },
            .ignore => {
                try actions.openZ(fileno, "/dev/null", bun.O.RDWR, 0o664);
            },

            .path => |path| {
                try actions.open(fileno, path, bun.O.RDWR | bun.O.CREAT, 0o664);
            },
            .ipc, .buffer => {
                const fds: [2]bun.FileDescriptor = try bun.sys.socketpair(
                    std.posix.AF.UNIX,
                    std.posix.SOCK.STREAM,
                    0,
                    if (ipc == .ipc) .nonblocking else .blocking,
                ).unwrap();

                if (!options.sync and ipc == .buffer)
                    try bun.sys.setNonblocking(fds[0]).unwrap();

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
    var failed_after_spawn = false;
    defer {
        if (failed_after_spawn) {
            for (to_close_on_error.items) |fd| {
                fd.close();
            }
            to_close_on_error.clearAndFree();
        }
    }

    switch (spawn_result) {
        .err => {
            failed_after_spawn = true;
            return .{ .err = spawn_result.err };
        },
        .result => |pid| {
            spawned.pid = pid;
            spawned.extra_pipes = extra_fds;
            extra_fds = std.array_list.Managed(bun.FileDescriptor).init(bun.default_allocator);

            if (comptime Environment.isLinux) {
                // If it's spawnSync and we want to block the entire thread
                // don't even bother with pidfd. It's not necessary.
                if (!options.can_block_entire_thread_to_reduce_cpu_usage_in_fast_path) {

                    // Get a pidfd, which is a file descriptor that represents a process.
                    // This lets us avoid a separate thread to wait on the process.
                    switch (spawned.pifdFromPid()) {
                        .result => |pidfd| {
                            spawned.pidfd = pidfd;
                        },
                        .err => |err| {
                            // we intentionally do not clean up any of the file descriptors in this case
                            // you could have data sitting in stdout, just waiting.
                            if (err.getErrno() == .SRCH) {
                                spawned.has_exited = true;

                                // a real error occurred. one we should not assume means pidfd_open is blocked.
                            } else if (!WaiterThread.shouldUseWaiterThread()) {
                                failed_after_spawn = true;
                                return .{ .err = err };
                            }
                        },
                    }
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
) !bun.sys.Maybe(WindowsSpawnResult) {
    bun.markWindowsOnly();
    bun.analytics.Features.spawn += 1;

    var uv_process_options = std.mem.zeroes(uv.uv_process_options_t);

    uv_process_options.args = argv;
    uv_process_options.env = envp;
    uv_process_options.file = options.argv0 orelse argv[0].?;
    uv_process_options.exit_cb = &Process.onExitUV;
    var stack_allocator = std.heap.stackFallback(8192, bun.default_allocator);
    const allocator = stack_allocator.get();
    const loop = options.windows.loop.platformEventLoop().uv_loop;

    var cwd_buf: bun.PathBuffer = undefined;
    @memcpy(cwd_buf[0..options.cwd.len], options.cwd);
    cwd_buf[options.cwd.len] = 0;
    const cwd = cwd_buf[0..options.cwd.len :0];

    uv_process_options.cwd = cwd.ptr;

    var uv_files_to_close = std.array_list.Managed(uv.uv_file).init(allocator);

    var failed = false;

    defer {
        for (uv_files_to_close.items) |fd| {
            bun.Async.Closer.close(.fromUV(fd), loop);
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

    var stdio_containers = try std.array_list.Managed(uv.uv_stdio_container_t).initCapacity(allocator, 3 + options.extra_fds.len);
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
            .ipc => |my_pipe| {
                // ipc option inside stdin, stderr or stdout are not supported
                bun.default_allocator.destroy(my_pipe);
                stdio.flags = uv.UV_IGNORE;
            },
            .ignore => {
                stdio.flags = uv.UV_IGNORE;
            },
            .path => |path| {
                var req = uv.fs_t.uninitialized;
                defer req.deinit();
                const rc = uv.uv_fs_open(loop, &req, &(try std.posix.toPosixPath(path)), flag | uv.O.CREAT, 0o644, null);
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
                stdio.data.fd = fd.uv();
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
                const rc = uv.uv_fs_open(loop, &req, &(try std.posix.toPosixPath(path)), flag | uv.O.CREAT, 0o644, null);
                if (rc.toError(.open)) |err| {
                    failed = true;
                    return .{ .err = err };
                }

                stdio.flags = uv.StdioFlags.inherit_fd;
                const fd = rc.int();
                try uv_files_to_close.append(fd);
                stdio.data.fd = fd;
            },
            .ipc => |my_pipe| {
                try my_pipe.init(loop, true).unwrap();
                stdio.flags = uv.UV_CREATE_PIPE | uv.UV_WRITABLE_PIPE | uv.UV_READABLE_PIPE | uv.UV_OVERLAPPED_PIPE;
                stdio.data.stream = @ptrCast(my_pipe);
            },
            .buffer => |my_pipe| {
                try my_pipe.init(loop, false).unwrap();
                stdio.flags = uv.UV_CREATE_PIPE | uv.UV_WRITABLE_PIPE | uv.UV_READABLE_PIPE | uv.UV_OVERLAPPED_PIPE;
                stdio.data.stream = @ptrCast(my_pipe);
            },
            .pipe => |fd| {
                stdio.flags = uv.StdioFlags.inherit_fd;
                stdio.data.fd = fd.uv();
            },
        }
    }

    uv_process_options.stdio = stdio_containers.items.ptr;
    uv_process_options.stdio_count = @intCast(stdio_containers.items.len);

    uv_process_options.exit_cb = &Process.onExitUV;
    const process = bun.new(Process, .{
        .ref_count = .init(),
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
                bun.FD.fromUV(dup_fds[0]).close();
            }
        }

        if (dup_fds[1] != -1) {
            bun.FD.fromUV(dup_fds[1]).close();
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
        .extra_pipes = try std.array_list.Managed(WindowsSpawnResult.StdioResult).initCapacity(bun.default_allocator, options.extra_fds.len),
    };

    const result_stdios = .{ &result.stdin, &result.stdout, &result.stderr };
    inline for (0..3) |i| {
        const stdio = stdio_containers.items[i];
        const result_stdio: *WindowsSpawnResult.StdioResult = result_stdios[i];

        if (dup_src != null and i == dup_src.?) {
            result_stdio.* = .unavailable;
        } else if (dup_tgt != null and i == dup_tgt.?) {
            result_stdio.* = .{ .buffer_fd = .fromUV(dup_fds[0]) };
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
            .ipc, .buffer => {
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
        ipc: ?bun.FileDescriptor = null,
        cwd: []const u8 = "",
        detached: bool = false,

        argv: []const []const u8,
        /// null = inherit parent env
        envp: ?[*:null]?[*:0]const u8,

        use_execve_on_macos: bool = false,
        argv0: ?[*:0]const u8 = null,

        windows: if (Environment.isWindows) WindowsSpawnOptions.WindowsOptions else void = if (Environment.isWindows) .{},

        pub const Stdio = enum {
            inherit,
            ignore,
            buffer,

            pub fn toStdio(this: *const Stdio) SpawnOptions.Stdio {
                return switch (this.*) {
                    .inherit => .inherit,
                    .ignore => .ignore,
                    .buffer => .{
                        .buffer = if (Environment.isWindows)
                            bun.handleOom(bun.default_allocator.create(bun.windows.libuv.Pipe)),
                    },
                };
            }
        };

        pub fn toSpawnOptions(this: *const Options) SpawnOptions {
            return SpawnOptions{
                .stdin = this.stdin.toStdio(),
                .stdout = this.stdout.toStdio(),
                .stderr = this.stderr.toStdio(),
                .ipc = this.ipc,

                .cwd = this.cwd,
                .detached = this.detached,
                .use_execve_on_macos = this.use_execve_on_macos,
                .stream = false,
                .argv0 = this.argv0,
                .windows = if (Environment.isWindows) this.windows,
            };
        }
    };

    pub const Result = struct {
        status: Status,
        stdout: std.array_list.Managed(u8) = .{ .items = &.{}, .allocator = bun.default_allocator, .capacity = 0 },
        stderr: std.array_list.Managed(u8) = .{ .items = &.{}, .allocator = bun.default_allocator, .capacity = 0 },

        pub fn isOK(this: *const Result) bool {
            return this.status.isOK();
        }

        pub fn deinit(this: *const Result) void {
            this.stderr.deinit();
            this.stdout.deinit();
        }
    };

    const SyncWindowsPipeReader = struct {
        chunks: std.array_list.Managed([]u8) = .{ .items = &.{}, .allocator = bun.default_allocator, .capacity = 0 },
        pipe: *uv.Pipe,

        err: bun.sys.E = .SUCCESS,
        context: *SyncWindowsProcess,
        onDoneCallback: *const fn (*SyncWindowsProcess, tag: SyncWindowsProcess.OutFd, chunks: []const []u8, err: bun.sys.E) void = &SyncWindowsProcess.onReaderDone,
        tag: SyncWindowsProcess.OutFd,

        pub const new = bun.TrivialNew(@This());

        fn onAlloc(_: *SyncWindowsPipeReader, suggested_size: usize) []u8 {
            return bun.handleOom(bun.default_allocator.alloc(u8, suggested_size));
        }

        fn onRead(this: *SyncWindowsPipeReader, data: []const u8) void {
            bun.handleOom(this.chunks.append(@constCast(data)));
        }

        fn onError(this: *SyncWindowsPipeReader, err: bun.sys.E) void {
            this.err = err;
            this.pipe.close(onClose);
        }

        fn onClose(pipe: *uv.Pipe) callconv(.c) void {
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
        pub const new = bun.TrivialNew(@This());
        pub const deinit = bun.TrivialDeinit(@This());

        const OutFd = enum { stdout, stderr };

        stderr: []const []u8 = &.{},
        stdout: []const []u8 = &.{},
        err: bun.sys.E = .SUCCESS,
        waiting_count: u8 = 1,
        process: *Process,
        status: ?Status = null,

        pub fn onProcessExit(this: *SyncWindowsProcess, status: Status, _: *const Rusage) void {
            this.status = status;
            this.waiting_count -= 1;
            this.process.detach();
            this.process.deref();
        }

        pub fn onReaderDone(this: *SyncWindowsProcess, tag: OutFd, chunks: []const []u8, err: bun.sys.E) void {
            switch (tag) {
                .stderr => {
                    this.stderr = chunks;
                },
                .stdout => {
                    this.stdout = chunks;
                },
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
        var loop: jsc.EventLoopHandle = options.windows.loop;
        var spawned = switch (try spawnProcessWindows(&options.toSpawnOptions(), argv, envp)) {
            .err => |err| return .{ .err = err },
            .result => |process| process,
        };
        const this = SyncWindowsProcess.new(.{
            .process = spawned.toProcess(undefined, true),
        });
        this.process.ref();
        this.process.setExitHandler(this);
        defer this.deinit();
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
                        Output.panic("Unexpected error starting {s} pipe reader\n{f}", .{ @tagName(tag), err });
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
            .stdout = std.array_list.Managed(u8).fromOwnedSlice(
                bun.default_allocator,
                bun.handleOom(flattenOwnedChunks(bun.default_allocator, bun.default_allocator, this.stdout)),
            ),
            .stderr = std.array_list.Managed(u8).fromOwnedSlice(
                bun.default_allocator,
                bun.handleOom(flattenOwnedChunks(bun.default_allocator, bun.default_allocator, this.stderr)),
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
        // [*:null]?[*:0]const u8
        // [*:null]?[*:0]u8
        const envp = options.envp orelse @as([*:null]?[*:0]const u8, @ptrCast(std.c.environ));
        const argv = options.argv;
        var string_builder = bun.StringBuilder{};
        defer string_builder.deinit(bun.default_allocator);
        for (argv) |arg| {
            string_builder.countZ(arg);
        }

        try string_builder.allocate(bun.default_allocator);

        var args = bun.handleOom(std.array_list.Managed(?[*:0]u8).initCapacity(bun.default_allocator, argv.len + 1));
        defer args.deinit();

        for (argv) |arg| {
            args.appendAssumeCapacity(@constCast(string_builder.appendZ(arg).ptr));
        }
        args.appendAssumeCapacity(null);

        return spawnWithArgv(options, @ptrCast(args.items.ptr), @ptrCast(envp));
    }

    // Forward signals from parent to the child process.
    extern "c" fn Bun__registerSignalsForForwarding() void;
    extern "c" fn Bun__unregisterSignalsForForwarding() void;

    // The PID to forward signals to.
    // Set to 0 when unregistering.
    extern "c" var Bun__currentSyncPID: i64;

    // Race condition: a signal could be sent before spawnProcessPosix returns.
    // We need to make sure to send it after the process is spawned.
    extern "c" fn Bun__sendPendingSignalIfNecessary() void;

    fn spawnPosix(
        options: *const Options,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) !Maybe(Result) {
        Bun__currentSyncPID = 0;
        Bun__registerSignalsForForwarding();
        defer {
            Bun__unregisterSignalsForForwarding();
            bun.crash_handler.resetOnPosix();
        }
        const process = switch (try spawnProcessPosix(&options.toSpawnOptions(), argv, envp)) {
            .err => |err| return .{ .err = err },
            .result => |proces| proces,
        };
        Bun__currentSyncPID = @intCast(process.pid);

        Bun__sendPendingSignalIfNecessary();

        var out = [2]std.array_list.Managed(u8){
            std.array_list.Managed(u8).init(bun.default_allocator),
            std.array_list.Managed(u8).init(bun.default_allocator),
        };
        var out_fds = [2]bun.FileDescriptor{ process.stdout orelse bun.invalid_fd, process.stderr orelse bun.invalid_fd };
        var success = false;
        defer {
            // If we're going to return an error,
            // let's make sure to clean up the output buffers
            // and kill the process
            if (!success) {
                for (&out) |*array_list| {
                    array_list.clearAndFree();
                }
                _ = std.c.kill(process.pid, 1);
            }

            for (out_fds) |fd| {
                if (fd != bun.invalid_fd) {
                    fd.close();
                }
            }

            if (comptime Environment.isLinux) {
                if (process.pidfd) |pidfd| {
                    bun.FD.fromNative(pidfd).close();
                }
            }
        }

        var out_fds_to_wait_for = [2]bun.FileDescriptor{
            process.stdout orelse bun.invalid_fd,
            process.stderr orelse bun.invalid_fd,
        };

        if (process.memfds[1]) {
            out_fds_to_wait_for[0] = bun.invalid_fd;
        }

        if (process.memfds[2]) {
            out_fds_to_wait_for[1] = bun.invalid_fd;
        }

        while (out_fds_to_wait_for[0] != bun.invalid_fd or out_fds_to_wait_for[1] != bun.invalid_fd) {
            for (&out_fds_to_wait_for, &out, &out_fds) |*fd, *bytes, *out_fd| {
                if (fd.* == bun.invalid_fd) continue;
                while (true) {
                    bytes.ensureUnusedCapacity(16384) catch {
                        return .{ .err = bun.sys.Error.fromCode(.NOMEM, .recv) };
                    };
                    switch (bun.sys.recvNonBlock(fd.*, bytes.unusedCapacitySlice())) {
                        .err => |err| {
                            if (err.isRetry() or err.getErrno() == .PIPE) {
                                break;
                            }
                            return .{ .err = err };
                        },
                        .result => |bytes_read| {
                            bytes.items.len += bytes_read;
                            if (bytes_read == 0) {
                                fd.*.close();
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
                    .events = std.posix.POLL.IN | std.posix.POLL.ERR | std.posix.POLL.HUP,
                    .revents = 0,
                },
                .{
                    .fd = 0,
                    .events = std.posix.POLL.IN | std.posix.POLL.ERR | std.posix.POLL.HUP,
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
                poll_fds[poll_fds.len - 1].fd = @intCast(out_fds_to_wait_for[1].cast());
            }

            if (poll_fds.len == 0) {
                break;
            }

            const rc = std.c.poll(poll_fds.ptr, @intCast(poll_fds.len), -1);
            switch (bun.sys.getErrno(rc)) {
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

        success = true;
        return .{
            .result = Result{
                .status = status,
                .stdout = out[0],
                .stderr = out[1],
            },
        };
    }
};

const std = @import("std");
const ProcessHandle = @import("../../../cli/filter_run.zig").ProcessHandle;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const PosixSpawn = bun.spawn;
const Maybe = bun.sys.Maybe;
const ShellSubprocess = bun.shell.ShellSubprocess;
const uv = bun.windows.libuv;

const LifecycleScriptSubprocess = bun.install.LifecycleScriptSubprocess;
const SecurityScanSubprocess = bun.install.SecurityScanSubprocess;

const jsc = bun.jsc;
const Subprocess = jsc.Subprocess;
