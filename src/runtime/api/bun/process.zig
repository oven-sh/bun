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
pub const Rusage = if (Environment.isWindows)
    win_rusage
    // std.posix.rusage has no .freebsd arm; field names also differ
    // (ru_* instead of bare). Define a layout-compatible struct so
    // ResourceUsage can use the same field names everywhere.
else if (Environment.isFreeBSD)
    extern struct {
        utime: std.c.timeval,
        stime: std.c.timeval,
        maxrss: isize,
        ixrss: isize,
        idrss: isize,
        isrss: isize,
        minflt: isize,
        majflt: isize,
        nswap: isize,
        inblock: isize,
        oublock: isize,
        msgsnd: isize,
        msgrcv: isize,
        nsignals: isize,
        nvcsw: isize,
        nivcsw: isize,
    }
else
    std.posix.rusage;

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
            MultiRunProcessHandle,
            TestWorkerHandle,
            SecurityScanSubprocess,
            WebViewHostProcess,
            ChromeProcess,
            SyncProcess,
            CronRegisterJob,
            CronRemoveJob,
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
            @field(TaggedPointer.Tag, @typeName(MultiRunProcessHandle)) => {
                const subprocess = this.ptr.as(MultiRunProcessHandle);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, @typeName(TestWorkerHandle)) => {
                const subprocess = this.ptr.as(TestWorkerHandle);
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
            @field(TaggedPointer.Tag, @typeName(WebViewHostProcess)) => {
                const subprocess = this.ptr.as(WebViewHostProcess);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, @typeName(ChromeProcess)) => {
                const subprocess = this.ptr.as(ChromeProcess);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, @typeName(CronRegisterJob)) => {
                const cron_job = this.ptr.as(CronRegisterJob);
                cron_job.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, @typeName(CronRemoveJob)) => {
                const cron_job = this.ptr.as(CronRemoveJob);
                cron_job.onProcessExit(process, status, rusage);
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

    /// Sends `signal` to the process.
    ///
    /// Returns:
    /// - `.result = true` if the signal was delivered.
    /// - `.result = false` if the child could not be reached — either the
    ///   poller is already `.detached` (we observed the exit on our side)
    ///   or the OS reported `ESRCH`. Callers that just want best-effort
    ///   termination can ignore this, but anything JS-visible (e.g.
    ///   `subprocess.kill()`) needs to propagate it so Node's
    ///   `ChildProcess.kill()` can return `false`.
    /// - `.err` for any other error.
    pub fn kill(this: *Process, signal: u8) Maybe(bool) {
        if (comptime Environment.isPosix) {
            switch (this.poller) {
                .waiter_thread, .fd => {
                    const err = std.c.kill(this.pid, signal);
                    if (err != 0) {
                        const errno_ = bun.sys.getErrno(err);

                        // if the process was already killed don't throw
                        if (errno_ != .SRCH)
                            return .{ .err = bun.sys.Error.fromCode(errno_, .kill) };

                        return .{ .result = false };
                    }

                    return .{ .result = true };
                },
                // `.detached` means we never armed the poller or we already
                // called `detach()` from `onExit`. Either way there is no
                // live child to signal — report "not delivered" rather than
                // claiming success we didn't attempt.
                .detached => return .{ .result = false },
            }
        } else if (comptime Environment.isWindows) {
            switch (this.poller) {
                .uv => |*handle| {
                    if (handle.kill(signal).toError(.kill)) |err| {
                        // if the process was already killed don't throw
                        if (err.errno != @intFromEnum(bun.sys.E.SRCH)) {
                            return .{ .err = err };
                        }

                        return .{ .result = false };
                    }

                    return .{ .result = true };
                },
                .detached => return .{ .result = false },
            }
        }

        return .{ .result = false };
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
    eventfd: if (Environment.isLinux) bun.FD else u0 = undefined,

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
    ipc: ?bun.FD = null,
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
    /// setpgid(0, 0) in the child so it leads its own process group. The parent
    /// can then `kill(-pid, sig)` to signal the child and all its descendants.
    /// Not exposed to JS yet.
    new_process_group: bool = false,
    /// PTY slave fd for controlling terminal setup (-1 if not using PTY).
    pty_slave_fd: i32 = -1,
    /// Windows-only ConPTY handle; void placeholder on POSIX.
    pseudoconsole: void = {},
    /// Linux only. When non-null, the child sets PR_SET_PDEATHSIG to this
    /// signal between vfork and exec in posix_spawn_bun, so the kernel kills
    /// it when the spawning thread dies. When null, defaults to SIGKILL if
    /// no-orphans mode is enabled (see `ParentDeathWatchdog`), else 0 (no
    /// PDEATHSIG). Not exposed to JS yet.
    linux_pdeathsig: ?u8 = null,

    pub const Stdio = union(enum) {
        path: []const u8,
        inherit: void,
        ignore: void,
        buffer: void,
        ipc: void,
        pipe: bun.FD,
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
        buffer_fd: bun.FD,
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
    ipc: ?bun.FD = null,
    extra_fds: []const Stdio = &.{},
    cwd: []const u8 = "",
    detached: bool = false,
    windows: WindowsOptions = .{},
    argv0: ?[*:0]const u8 = null,
    stream: bool = true,
    use_execve_on_macos: bool = false,
    can_block_entire_thread_to_reduce_cpu_usage_in_fast_path: bool = false,
    /// Linux-only; placeholder for struct compatibility.
    linux_pdeathsig: ?u8 = null,
    /// POSIX-only; placeholder for struct compatibility.
    new_process_group: bool = false,
    /// POSIX-only PTY slave fd; void placeholder on Windows.
    pty_slave_fd: void = {},
    /// Windows ConPTY handle. When set, the child is attached to the
    /// pseudoconsole and stdin/stdout/stderr are provided by ConPTY.
    pseudoconsole: ?bun.windows.HPCON = null,
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
        pipe: bun.FD,
        dup2: struct { out: bun.jsc.Subprocess.StdioKind, to: bun.jsc.Subprocess.StdioKind },

        pub fn deinit(this: *const Stdio) void {
            switch (this.*) {
                .buffer => |pipe| pipe.closeAndDestroy(),
                .ipc => |pipe| pipe.closeAndDestroy(),
                else => {},
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
    stdin: ?bun.FD = null,
    stdout: ?bun.FD = null,
    stderr: ?bun.FD = null,
    ipc: ?bun.FD = null,
    extra_pipes: std.array_list.Managed(ExtraPipe) = std.array_list.Managed(ExtraPipe).init(bun.default_allocator),

    memfds: [3]bool = .{ false, false, false },

    // ESRCH can happen when requesting the pidfd
    has_exited: bool = false,

    /// Entry in `extra_pipes` for a stdio slot at index >= 3.
    pub const ExtraPipe = union(enum) {
        /// We created this fd (e.g. socketpair for `"pipe"`); expose it via
        /// `Subprocess.stdio[N]` and close it in `finalizeStreams`.
        owned_fd: bun.FD,
        /// The caller supplied this fd in the stdio array; expose it via
        /// `Subprocess.stdio[N]` but never close it — the caller retains ownership.
        unowned_fd: bun.FD,
        /// Nothing to expose for this slot (`"ignore"`, `"inherit"`, a path, or
        /// the IPC channel after ownership has been transferred to uSockets).
        unavailable: void,

        pub fn fd(this: ExtraPipe) bun.FD {
            return switch (this) {
                .owned_fd, .unowned_fd => |f| f,
                .unavailable => bun.invalid_fd,
            };
        }
    };

    pub fn close(this: *PosixSpawnResult) void {
        for (this.extra_pipes.items) |item| {
            switch (item) {
                .owned_fd => |f| f.close(),
                .unowned_fd, .unavailable => {},
            }
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
        if (comptime @hasDecl(bun.c, "POSIX_SPAWN_SETSID")) {
            flags |= bun.c.POSIX_SPAWN_SETSID;
        }
        attr.detached = true;
    }

    // Pass PTY slave fd to attr for controlling terminal setup
    attr.pty_slave_fd = options.pty_slave_fd;
    attr.new_process_group = options.new_process_group;

    if (Environment.isLinux) {
        // Explicit per-spawn value wins; otherwise no-orphans mode defaults
        // every child to SIGKILL-on-parent-death so non-Bun descendants are
        // covered without relying on env-var inheritance, and the prctl happens
        // in the vfork child before exec so there's no startup race.
        attr.linux_pdeathsig = if (options.linux_pdeathsig) |sig|
            @intCast(sig)
        else if (bun.ParentDeathWatchdog.shouldDefaultSpawnPdeathsig())
            std.posix.SIG.KILL
        else
            0;
    }

    if (options.cwd.len > 0) {
        try actions.chdir(options.cwd);
    }
    var spawned = PosixSpawnResult{};
    var extra_fds = std.array_list.Managed(PosixSpawnResult.ExtraPipe).init(bun.default_allocator);
    errdefer extra_fds.deinit();
    var stack_fallback = std.heap.stackFallback(2048, bun.default_allocator);
    const allocator = stack_fallback.get();
    var to_close_at_end = std.array_list.Managed(bun.FD).init(allocator);
    var to_set_cloexec = std.array_list.Managed(bun.FD).init(allocator);
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

    var to_close_on_error = std.array_list.Managed(bun.FD).init(allocator);

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
    const stdios: [3]*?bun.FD = .{ &spawned.stdin, &spawned.stdout, &spawned.stderr };

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
                    if (!options.stream and i > 0 and bun.sys.canUseMemfd()) {
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

                const fds: [2]bun.FD = brk: {
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

                // Note: we intentionally do NOT call shutdown() on the
                // socketpair fds. On SOCK_STREAM socketpairs, shutdown(fd, SHUT_WR)
                // sends a FIN to the peer, which causes programs that poll the
                // write end for readability (e.g. Python's asyncio connect_write_pipe)
                // to interpret it as "connection closed" and tear down their transport.
                // The socketpair is already used unidirectionally by convention.
                if (comptime Environment.isMac) {
                    // macOS seems to default to around 8 KB for the buffer size
                    // this is comically small.
                    // TODO: investigate if this should be adjusted on Linux.
                    const so_recvbuf: c_int = 1024 * 512;
                    const so_sendbuf: c_int = 1024 * 512;
                    if (i == 0) {
                        _ = std.c.setsockopt(fds[1].cast(), std.posix.SOL.SOCKET, std.posix.SO.RCVBUF, &so_recvbuf, @sizeOf(c_int));
                        _ = std.c.setsockopt(fds[0].cast(), std.posix.SOL.SOCKET, std.posix.SO.SNDBUF, &so_sendbuf, @sizeOf(c_int));
                    } else {
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
                try extra_fds.append(.unavailable);
            },
            .ignore => {
                try actions.openZ(fileno, "/dev/null", bun.O.RDWR, 0o664);
                try extra_fds.append(.unavailable);
            },

            .path => |path| {
                try actions.open(fileno, path, bun.O.RDWR | bun.O.CREAT, 0o664);
                try extra_fds.append(.unavailable);
            },
            .ipc, .buffer => {
                const fds: [2]bun.FD = try bun.sys.socketpair(
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
                try extra_fds.append(.{ .owned_fd = fds[0] });
            },
            .pipe => |fd| {
                try actions.dup2(fd, fileno);
                // The fd was supplied by the caller (a number in the stdio array) and is
                // not owned by us. Record it so `stdio[N]` returns the caller's fd, but
                // mark it unowned so finalizeStreams leaves it open.
                try extra_fds.append(.{ .unowned_fd = fd });
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
            extra_fds = std.array_list.Managed(PosixSpawnResult.ExtraPipe).init(bun.default_allocator);

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

    if (options.pseudoconsole) |hpcon| {
        uv_process_options.pseudoconsole = hpcon;
    }

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
            .ipc => {
                // ipc option inside stdin, stderr or stdout is not supported.
                // Don't free the pipe here — the caller owns it and will
                // clean it up via WindowsSpawnOptions.deinit().
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
        ipc: ?bun.FD = null,
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
                            bun.new(bun.windows.libuv.Pipe, std.mem.zeroes(bun.windows.libuv.Pipe)),
                    },
                };
            }
        };

        pub fn toSpawnOptions(this: *const Options, new_process_group: bool) SpawnOptions {
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
                .new_process_group = new_process_group,
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
        chunks_allocator.free(chunks);

        return result;
    }

    fn spawnWindowsWithoutPipes(
        options: *const Options,
        argv: [*:null]?[*:0]const u8,
        envp: [*:null]?[*:0]const u8,
    ) !Maybe(Result) {
        var loop = options.windows.loop.platformEventLoop();
        var spawned = switch (try spawnProcessWindows(&options.toSpawnOptions(false), argv, envp)) {
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
        var spawned = switch (try spawnProcessWindows(&options.toSpawnOptions(false), argv, envp)) {
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

    // macOS p_puniqueid descendant tracker — see NoOrphansTracker.cpp.
    extern "c" fn Bun__noOrphans_begin(kq: c_int, root: std.c.pid_t) void;
    extern "c" fn Bun__noOrphans_releaseKq() void;
    extern "c" fn Bun__noOrphans_onFork() void;
    extern "c" fn Bun__noOrphans_onExit(pid: std.c.pid_t) void;

    /// TTY job-control bridge for `--no-orphans` `bun run`. We put the script
    /// in its own pgroup so `kill(-pgid)` reaches every descendant on cleanup,
    /// which makes `bun run` a one-job mini shell on a controlling terminal:
    /// Ctrl-Z stops only the script's pgroup, so we must observe the stop
    /// (WUNTRACED / EVFILT_SIGNAL+SIGCHLD), take the terminal back, stop
    /// *ourselves*, and on `fg` hand the terminal back and SIGCONT the script.
    /// Inert (`prev <= 0`) when stdin is not a TTY — the supervisor/CI case
    /// this feature targets — and the wait loops don't ask for stop reports
    /// then, matching plain `bun run`.
    const JobControl = struct {
        /// Foreground pgroup we displaced (i.e. the one the user's shell put
        /// `bun run` in). 0 when stdin isn't a TTY, `tcgetpgrp` failed, or we
        /// weren't the foreground pgroup to begin with.
        prev: std.c.pid_t = 0,
        script_pgid: std.c.pid_t = 0,

        extern "c" fn tcgetpgrp(fd: c_int) std.c.pid_t;
        extern "c" fn tcsetpgrp(fd: c_int, pgrp: std.c.pid_t) c_int;
        extern "c" fn getpgrp() std.c.pid_t;

        pub fn isActive(self: *const @This()) bool {
            return self.prev > 0;
        }

        fn give(self: *@This(), pgid: std.c.pid_t) void {
            self.script_pgid = pgid;
            if (std.c.isatty(0) == 0) return;
            const fg = tcgetpgrp(0);
            // Only take the terminal if we *are* the foreground pgroup.
            // `bun run --no-orphans dev &` from an interactive shell leaves
            // stdin as the TTY (shells rely on SIGTTIN, not redirection), so
            // `tcgetpgrp` returns the shell's pgid — blocking SIGTTOU and
            // `tcsetpgrp`'ing anyway would steal the terminal from the user.
            // Same gate as `onChildStopped`'s resume path below; real shells
            // (bash `give_terminal_to`, zsh `attachtty`) do the same.
            if (fg <= 0 or fg != getpgrp()) return;
            self.prev = fg;
            ttouBlocked(pgid);
        }
        fn restore(self: *@This()) void {
            if (self.prev <= 0) return;
            ttouBlocked(self.prev);
            self.prev = 0;
        }
        /// Called from the wait loop when WIFSTOPPED(child). Takes the terminal
        /// back, stops `bun run` so the user's shell's `waitpid(WUNTRACED)`
        /// returns, and on resume gives the terminal back to the script (only
        /// if the shell `fg`'d us — for `bg` the shell keeps foreground and
        /// the script runs as a background pgroup like any other job).
        fn onChildStopped(self: *const @This()) void {
            if (self.prev <= 0) return; // non-TTY: never asked for stop reports
            ttouBlocked(self.prev);
            // SIGTSTP is not in `Bun__registerSignalsForForwarding`'s set, so
            // default disposition (stop) applies and we suspend right here.
            _ = std.c.raise(std.posix.SIG.TSTP);
            // — resumed by the shell's SIGCONT —
            if (tcgetpgrp(0) == getpgrp()) ttouBlocked(self.script_pgid);
            _ = std.c.kill(-self.script_pgid, std.posix.SIG.CONT);
        }
        /// `tcsetpgrp` from a background pgroup raises SIGTTOU (default: stop);
        /// block it for the call per the standard job-control idiom.
        fn ttouBlocked(pgid: std.c.pid_t) void {
            var set = std.posix.sigemptyset();
            var old = std.posix.sigemptyset();
            std.posix.sigaddset(&set, std.posix.SIG.TTOU);
            std.posix.sigprocmask(std.posix.SIG.BLOCK, &set, &old);
            _ = tcsetpgrp(0, pgid);
            std.posix.sigprocmask(std.posix.SIG.SETMASK, &old, null);
        }
    };

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
        // --no-orphans: put the script in its own process group so we can
        // `kill(-pgid, SIGKILL)` on every exit path. Pgroup membership is
        // inherited recursively and survives reparenting to launchd/init, so
        // this reaches grandchildren even after the script itself has exited
        // (which the libproc/procfs walk cannot — those are gone from our tree
        // once their parent dies). A `setsid()`+double-fork escapee is caught
        // by PR_SET_CHILD_SUBREAPER (Linux) / the p_puniqueid spawn-graph
        // tracker (macOS) — see `waitMacKqueue` / `waitLinuxSignalfd`.
        //
        // Disabled when `use_execve_on_macos` actually applies (macOS only —
        // see `spawnProcessPosix`): that path is `POSIX_SPAWN_SETEXEC`, which
        // replaces *our own* image and never returns, so there is no parent to
        // run the wait loop or the cleanup defers. Callers
        // (`runBinaryWithoutBunxPath`, `bunx`) set the flag unconditionally;
        // on Linux it's a spawn-side no-op so no-orphans must stay armed there.
        const no_orphans = bun.ParentDeathWatchdog.isEnabled() and
            !(Environment.isMac and options.use_execve_on_macos);

        // Snapshot pre-existing direct children so the disarm defer can tell
        // subreaper-adopted orphans (ppid==us) apart from `Bun.spawn` siblings
        // (also ppid==us). Typically empty — `bun run`/`bunx` have no JS VM —
        // but spawnSync can run inside a live VM (ffi.zig xcrun probe).
        var siblings_buf: [64]std.c.pid_t = undefined;
        const siblings = if (Environment.isLinux and no_orphans)
            bun.ParentDeathWatchdog.snapshotChildren(&siblings_buf)
        else
            siblings_buf[0..0];
        if (comptime Environment.isLinux) if (no_orphans) {
            // Subreaper: arm *before* spawn so a fast-daemonizing script can't
            // reparent its grandchild to init in the gap. Process-wide and
            // only the spawnSync wait loop has a `wait4(-1)` to reap
            // adoptees, so arming it globally from `enable()` would leak
            // zombies in `bun foo.js` / `--filter` / `bun test`. Disarmed by
            // the defer immediately below — registered here (not in the
            // post-spawn `defer if (no_orphans)` block) so spawn-failure
            // early returns don't leave subreaper armed process-wide.
            _ = std.posix.prctl(.SET_CHILD_SUBREAPER, .{1}) catch {};
        };
        defer if (comptime Environment.isLinux) if (no_orphans) {
            // Kill subreaper-adopted setsid daemons (ppid==us, not in the
            // pre-arm snapshot) *before* disarming, while we can still find
            // them. Without this, a daemon whose intermediate parent exits
            // between disarm and `onProcessExit`→`killDescendants()` escapes
            // to init.
            bun.ParentDeathWatchdog.killSubreaperAdoptees(siblings);
            _ = std.posix.prctl(.SET_CHILD_SUBREAPER, .{0}) catch {};
        };

        // macOS no_orphans: kqueue passed to `waitMacKqueue` for ppid/child
        // NOTE_EXIT and per-descendant NOTE_FORK. NOTE_TRACK (auto-attach to
        // forks) has been ENOTSUP since macOS 10.5 — see sys/event.h:356 — so
        // we cannot get atomic in-kernel descendant tracking. Instead the
        // wait loop reacts to NOTE_FORK by running a `p_puniqueid` scan
        // (`NoOrphansTracker::scan()`) to discover and re-arm new
        // descendants. `p_puniqueid` is the *spawning* parent's per-boot
        // uniqueid — immutable across reparenting — so the scan finds
        // setsid+double-fork escapees as long as each intermediate's uniqueid
        // was recorded before it died. The `begin()` call below seeds the
        // scan root after spawn.
        var no_orphans_kq: bun.FD = bun.invalid_fd;
        if (comptime Environment.isMac) if (no_orphans) {
            if (std.posix.kqueue()) |kq| {
                no_orphans_kq = bun.FD.fromNative(kq);
            } else |_| {}
        };
        // LIFO: this runs LAST — after killSyncScriptTree() (which scans via
        // m_kq) and releaseKq().
        defer if (comptime Environment.isMac) if (no_orphans_kq != bun.invalid_fd)
            no_orphans_kq.close();
        // LIFO: runs after killSyncScriptTree() (which needs m_kq live for
        // its NOTE_FORK-drain rescan), before the close above.
        defer if (comptime Environment.isMac) if (no_orphans_kq != bun.invalid_fd)
            Bun__noOrphans_releaseKq();

        Bun__currentSyncPID = 0;
        Bun__registerSignalsForForwarding();
        defer {
            Bun__unregisterSignalsForForwarding();
            bun.crash_handler.resetOnPosix();
        }
        const process = switch (try spawnProcessPosix(&options.toSpawnOptions(no_orphans), argv, envp)) {
            .err => |err| return .{ .err = err },
            .result => |proces| proces,
        };
        // Negative → kill() in the C++ signal forwarder targets the pgroup, so
        // a SIGTERM/SIGINT delivered to `bun run` reaches every descendant
        // that hasn't `setsid()`-escaped.
        Bun__currentSyncPID = if (no_orphans) -@as(i64, @intCast(process.pid)) else @intCast(process.pid);

        var jc: JobControl = .{};
        const pgid_pushed = no_orphans and bun.ParentDeathWatchdog.pushSyncPgid(process.pid);
        if (no_orphans) {
            // Script is now a background pgroup; if stdin is a TTY hand it the
            // foreground so Ctrl-C / TTY reads behave as before. Ctrl-Z is
            // bridged by `JobControl.onChildStopped` in the wait loop. No-op on
            // non-TTY stdin (the supervisor / CI case this feature targets).
            jc.give(process.pid);
            // `begin()` records the script's `p_uniqueid` as the scan root
            // and stashes kq so `scan()` can EV_ADD NOTE_FORK|NOTE_EXIT on
            // each discovered descendant. waitMacKqueue registers the
            // script's own knote.
            if (comptime Environment.isMac) if (no_orphans_kq != bun.invalid_fd)
                Bun__noOrphans_begin(no_orphans_kq.native(), process.pid);
        }
        defer if (no_orphans) {
            jc.restore();
            // pgroup → tracked uniqueids (macOS). Do NOT call the
            // getpid()-rooted `killDescendants()` here — `spawnSync` can be
            // reached from inside a live VM (ffi.zig xcrun probe, etc.) and
            // that would SIGKILL the user's unrelated `Bun.spawn` children.
            // The full-tree walk runs from `onProcessExit` when the whole
            // process is actually exiting.
            bun.ParentDeathWatchdog.killSyncScriptTree();
            if (pgid_pushed) bun.ParentDeathWatchdog.popSyncPgid();
            if (comptime Environment.isLinux) {
                // One last reap for anything we adopted as subreaper before
                // the disarm defer above drops it (LIFO: this runs first).
                while (true) switch (PosixSpawn.wait4(-1, std.posix.W.NOHANG, null)) {
                    .err => break,
                    .result => |w| if (w.pid <= 0) break,
                };
            }
        };

        Bun__sendPendingSignalIfNecessary();

        var out = [2]std.array_list.Managed(u8){
            std.array_list.Managed(u8).init(bun.default_allocator),
            std.array_list.Managed(u8).init(bun.default_allocator),
        };
        var out_fds = [2]bun.FD{ process.stdout orelse bun.invalid_fd, process.stderr orelse bun.invalid_fd };
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

        var out_fds_to_wait_for = [2]bun.FD{
            process.stdout orelse bun.invalid_fd,
            process.stderr orelse bun.invalid_fd,
        };

        if (process.memfds[1]) {
            out_fds_to_wait_for[0] = bun.invalid_fd;
        }

        if (process.memfds[2]) {
            out_fds_to_wait_for[1] = bun.invalid_fd;
        }

        // no-orphans: replace the blind `poll()`/`wait4()` with a wait loop
        // that also watches our parent (and on macOS, the script's whole
        // spawn tree via the NOTE_FORK kq + p_puniqueid scan above).
        // Linux/macOS only — other POSIX (FreeBSD) falls through to the
        // original `poll()`+`wait4()` below so buffered stdio still drains;
        // the `defer` above still does the pgroup kill there.
        //
        // Do NOT return from here — Linux backs `.buffer` stdio with memfds
        // that are read *after* the wait, so falling through to the memfd block
        // below is required.
        const status: Status = blk: {
            if (no_orphans and (Environment.isLinux or Environment.isMac)) {
                const ppid = bun.ParentDeathWatchdog.ppidToWatch() orelse 0;
                const r: ?Maybe(Status) = if (comptime Environment.isMac)
                    waitMacKqueue(process.pid, ppid, &jc, no_orphans_kq, &out, &out_fds_to_wait_for, &out_fds)
                else
                    waitLinuxSignalfd(process.pid, ppid, &jc, &out, &out_fds_to_wait_for, &out_fds);
                if (r) |maybe| switch (maybe) {
                    .err => |err| return .{ .err = err },
                    .result => |st| break :blk st,
                };
                // null: kqueue()/kevent-receipt failed — fall through to the
                // plain poll() loop so `.buffer` stdio still drains instead
                // of being dropped (or deadlocking) in a blind `wait4()`.
            }
            while (out_fds_to_wait_for[0] != bun.invalid_fd or out_fds_to_wait_for[1] != bun.invalid_fd) {
                for (&out_fds_to_wait_for, &out, &out_fds) |*fd, *bytes, *out_fd| {
                    if (drainFd(fd, out_fd, bytes)) |err| return .{ .err = err };
                }

                var poll_fds_buf: [2]std.c.pollfd = undefined;
                var poll_fds: []std.c.pollfd = poll_fds_buf[0..0];
                for (out_fds_to_wait_for) |fd| {
                    if (fd == bun.invalid_fd) continue;
                    poll_fds.len += 1;
                    poll_fds[poll_fds.len - 1] = .{
                        .fd = @intCast(fd.cast()),
                        .events = std.posix.POLL.IN | std.posix.POLL.ERR | std.posix.POLL.HUP,
                        .revents = 0,
                    };
                }
                if (poll_fds.len == 0) break;

                const rc = std.c.poll(poll_fds.ptr, @intCast(poll_fds.len), -1);
                switch (bun.sys.getErrno(rc)) {
                    .SUCCESS => {},
                    .AGAIN, .INTR => continue,
                    else => |err| return .{ .err = bun.sys.Error.fromCode(err, .poll) },
                }
            }
            break :blk reapChild(process.pid);
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

    /// no-orphans wait loop for `spawnSync`. Replaces the blind `poll()` +
    /// blocking `wait4()` so that:
    ///   - we notice our parent dying and run cleanup before PDEATHSIG / never
    ///     (macOS) — `Global.exit(129)` → `kill(-pgid)` + deep walk
    ///   - macOS: `NOTE_FORK` on the script (and recursively on each
    ///     discovered descendant) triggers a `p_puniqueid` scan
    ///     (`NoOrphansTracker::scan()`) so `setsid()`+double-fork escapees
    ///     are tracked and killed via `Bun__noOrphans_killTracked()`.
    ///     `NOTE_TRACK` would have made this atomic, but it has been
    ///     ENOTSUP since macOS 10.5.
    ///   - Linux: subreaper (armed in `spawnPosix`) makes those reparent to us,
    ///     so the procfs walk finds them; this loop just needs to run
    ///     cleanup *before* our own SIGKILL-PDEATHSIG fires
    ///
    /// `ppid == 0` means "no parent worth watching" — still run the loop for
    /// the descendant tracking + pgroup cleanup on script exit.
    ///
    /// Returns `null` when kqueue setup fails: the caller falls through to
    /// the plain `poll()`+`wait4()` loop so `.buffer` stdio still drains (a
    /// blind `reapChild()` would drop captured output or deadlock if the
    /// child fills the pipe while we block in `wait4`).
    fn waitMacKqueue(
        child: std.c.pid_t,
        ppid: std.c.pid_t,
        jc: *const JobControl,
        kq_fd: bun.FD,
        out: *[2]std.array_list.Managed(u8),
        out_fds_to_wait_for: *[2]bun.FD,
        out_fds: *[2]bun.FD,
    ) ?Maybe(Status) {
        if (comptime !Environment.isMac) unreachable;

        // kqueue() failed in spawnPosix (EMFILE/ENOMEM): let the caller's
        // plain `poll()` loop drain `.buffer` stdio and reap. The spawnPosix
        // defers (pgroup-kill, killTracked() — empty set) still run.
        if (kq_fd == bun.invalid_fd) return null;

        // udata tag for the ppid PROC filter. Descendant PROC knotes
        // (`child` here, plus any `scan()` adds) use udata=0; EVFILT_READ
        // udata 0/1 are a separate filter, so the dispatch checks `filter`
        // before `udata`.
        const TAG_PPID: usize = 2;

        var changes_buf: [5]std.c.Kevent = undefined;
        var changes: []std.c.Kevent = changes_buf[0..0];
        const add = struct {
            fn f(list: *[]std.c.Kevent, ident: usize, filter: i16, fflags: u32, udata: usize) void {
                list.len += 1;
                list.*[list.len - 1] = .{
                    .ident = ident,
                    .filter = filter,
                    .flags = std.c.EV.ADD | std.c.EV.RECEIPT | std.c.EV.CLEAR,
                    .fflags = fflags,
                    .data = 0,
                    .udata = udata,
                };
            }
        }.f;
        if (ppid > 1)
            add(&changes, @intCast(ppid), std.c.EVFILT.PROC, std.c.NOTE.EXIT, TAG_PPID);
        // NOTE_FORK so the wait loop wakes to scan whenever the script (or
        // any registered descendant) forks. NOTE_TRACK would have let xnu
        // auto-attach to the new child atomically, but it returns ENOTSUP on
        // every macOS since 10.5 — which previously made *this* registration
        // fail, the receipt loop below `return null`, and the caller fall
        // through to a plain `wait4()` that watches neither ppid nor
        // descendants (the `runDied=false` failure on darwin in CI).
        add(&changes, @intCast(child), std.c.EVFILT.PROC, std.c.NOTE.FORK | std.c.NOTE.EXIT, 0);
        // TTY job-control: EVFILT_PROC has no "stopped" note, so wake on
        // SIGCHLD and `wait4(WUNTRACED|WNOHANG)` to catch Ctrl-Z. Only when
        // stdin is a TTY — non-TTY callers never see stops, matching plain
        // `bun run`. EVFILT_SIGNAL coexists with the (default-ignore) SIGCHLD
        // disposition; only direct children raise SIGCHLD, so this fires for
        // `child` alone.
        if (jc.isActive())
            add(&changes, std.posix.SIG.CHLD, std.c.EVFILT.SIGNAL, 0, 0);
        for (out_fds_to_wait_for, 0..) |fd, i| {
            if (fd != bun.invalid_fd) add(&changes, @intCast(fd.cast()), std.c.EVFILT.READ, 0, i);
        }

        var receipts: [5]std.c.Kevent = undefined;
        switch (bun.sys.kevent(kq_fd, changes, receipts[0..changes.len], null)) {
            .err => |err| return .{ .err = err },
            .result => {},
        }
        for (receipts[0..changes.len]) |r| {
            if (r.flags & std.c.EV.ERROR == 0 or r.data == 0) continue;
            if (r.udata == TAG_PPID) {
                // ESRCH: parent already gone — treat as fired. Any other
                // errno (ENOMEM, sandbox EACCES via `mac_proc_check_kqfilter`)
                // is a best-effort miss — same policy as
                // `ParentDeathWatchdog.installOnEventLoop`. The
                // `getppid() != ppid` recheck below is the backstop.
                if (r.data == @intFromEnum(std.c.E.SRCH))
                    bun.Global.exit(bun.ParentDeathWatchdog.exit_code);
                continue;
            }
            // Non-ppid registration (child PROC / EVFILT_SIGNAL / EVFILT_READ)
            // failed — fall through to the caller's `poll()` loop so
            // `.buffer` stdio still drains instead of a blind `reapChild()`
            // that would drop output or deadlock on a full pipe. ESRCH on the
            // child PROC entry is impossible (our own unreaped child —
            // `filt_procattach` finds zombies), so any errno here is a real
            // registration failure. `begin()` has already seeded m_tracked
            // with `child`; prune it so the caller's `reapChild()` doesn't
            // leave a freed pid for `killTracked()` to SIGSTOP.
            Bun__noOrphans_onExit(child);
            return null;
        }
        if (ppid > 1 and std.c.getppid() != ppid)
            bun.Global.exit(bun.ParentDeathWatchdog.exit_code);
        // Initial scan: `child` may have forked between `posix_spawn`
        // returning (in spawnPosix) and the NOTE_FORK registration above
        // taking effect; that fork produced no event. `begin()` already
        // seeded `m_seen` with `child`'s uniqueid, so this picks them up.
        Bun__noOrphans_onFork();

        var events: [16]std.c.Kevent = undefined;
        var child_exited = false;
        var child_status: ?Status = null;
        while (true) {
            const got = switch (bun.sys.kevent(kq_fd, &.{}, events[0..], null)) {
                .err => |err| return .{ .err = err },
                .result => |c| c,
            };
            var saw_fork = false;
            for (events[0..got]) |ev| {
                if (ev.filter == std.c.EVFILT.PROC) {
                    // ppid is the only PROC knote with udata != 0; descendant
                    // knotes (`child` above + any `scan()` added) use udata 0.
                    if (ev.udata == TAG_PPID) {
                        if (ev.fflags & std.c.NOTE.EXIT != 0)
                            bun.Global.exit(bun.ParentDeathWatchdog.exit_code);
                        continue;
                    }
                    // NOTE_FORK and NOTE_EXIT can share one event (forked and
                    // died between kevent calls) — handle both, no else.
                    if (ev.fflags & std.c.NOTE.FORK != 0)
                        saw_fork = true;
                    if (ev.fflags & std.c.NOTE.EXIT != 0) {
                        // Drop from the live set (root included — `begin()`
                        // seeded it into `m_tracked`, and `reapChild()` is
                        // about to free its pid before `killTracked()` runs).
                        Bun__noOrphans_onExit(@intCast(ev.ident));
                        if (ev.ident == @as(usize, @intCast(child)))
                            child_exited = true;
                    }
                } else if (ev.filter == std.c.EVFILT.SIGNAL) {
                    // SIGCHLD: probe for a stop. May also observe the exit
                    // (racing NOTE_EXIT in this batch) — stash the status so
                    // `reapChild` below doesn't block on an already-reaped pid.
                    const r = PosixSpawn.wait4(child, std.posix.W.NOHANG | std.posix.W.UNTRACED, null);
                    if (r == .result and r.result.pid == child) {
                        if (std.posix.W.IFSTOPPED(r.result.status))
                            jc.onChildStopped()
                        else {
                            child_status = Status.from(child, &r);
                            child_exited = true;
                            // wait4 just freed `child`'s pid; if NOTE_EXIT for
                            // it isn't in this batch we'd return with the root
                            // still in m_tracked and `killTracked()` would
                            // SIGSTOP a (potentially recycled) freed pid.
                            // Idempotent with the NOTE_EXIT handler above.
                            Bun__noOrphans_onExit(child);
                        }
                    }
                } else if (ev.filter == std.c.EVFILT.READ) {
                    const i: usize = ev.udata;
                    if (drainFd(&out_fds_to_wait_for[i], &out_fds[i], &out[i])) |err| return .{ .err = err };
                }
            }
            // After the batch so a single scan covers every NOTE_FORK in it.
            // `scan()` walks `proc_listallpids` for any pid whose
            // `p_puniqueid` (immutable spawning-parent uniqueid) is in our
            // seen set, adds it to m_tracked, and EV_ADDs NOTE_FORK|NOTE_EXIT
            // on it (udata 0) so its own forks wake this loop. Race: a
            // fast-exit intermediate (fork+setsid+fork+exit) can die before
            // this scan records its uniqueid, leaving its child's
            // `p_puniqueid` unlinkable. NOTE_TRACK closed that atomically;
            // without it the freeze-then-rescan loop in `killTracked()` is
            // the best-effort backstop.
            if (saw_fork) Bun__noOrphans_onFork();
            if (child_exited) {
                // Intentionally don't wait for pipe EOF (unlike the `poll()`
                // path): a grandchild holding the write end is exactly what
                // no-orphans exists to kill, and the killTracked()/pgroup-kill
                // defers can't run until we return. drainFd() loops to EAGAIN,
                // so everything the script itself wrote is captured.
                for (out_fds_to_wait_for, out_fds, out) |*fd, *ofd, *bytes| _ = drainFd(fd, ofd, bytes);
                return .{ .result = child_status orelse reapChild(child) };
            }
        }
    }

    fn waitLinuxSignalfd(
        child: std.c.pid_t,
        ppid: std.c.pid_t,
        jc: *const JobControl,
        out: *[2]std.array_list.Managed(u8),
        out_fds_to_wait_for: *[2]bun.FD,
        out_fds: *[2]bun.FD,
    ) ?Maybe(Status) {
        if (comptime !Environment.isLinux) unreachable;
        const linux = std.os.linux;

        // Child-exit: signalfd(SIGCHLD). Works everywhere pidfd doesn't
        // (gVisor, ancient kernels). Subreaper means orphaned grandchildren
        // also reparent to us and fire SIGCHLD here — drain them with
        // waitpid(-1, WNOHANG) and only stop when *our* child is reaped.
        // signalfd takes the *kernel* sigset_t (1 word), sigprocmask the libc
        // one (16 words) — block via libc, build a separate kernel mask for
        // signalfd.
        var libc_mask = std.posix.sigemptyset();
        var old_mask = std.posix.sigemptyset();
        std.posix.sigaddset(&libc_mask, std.posix.SIG.CHLD);
        std.posix.sigprocmask(std.posix.SIG.BLOCK, &libc_mask, &old_mask);
        defer std.posix.sigprocmask(std.posix.SIG.SETMASK, &old_mask, null);
        const chld_fd: bun.FD = blk: {
            var kmask = linux.sigemptyset();
            linux.sigaddset(&kmask, std.posix.SIG.CHLD);
            const rc = linux.signalfd(-1, &kmask, linux.SFD.CLOEXEC | linux.SFD.NONBLOCK);
            switch (linux.E.init(rc)) {
                .SUCCESS => break :blk bun.FD.fromNative(@intCast(rc)),
                else => break :blk bun.invalid_fd,
            }
        };
        defer if (chld_fd != bun.invalid_fd) chld_fd.close();

        // Parent-death: pidfd when available (instant wake). When not
        // (gVisor, sandboxes, pre-5.3): bound the poll at 100ms and recheck
        // `getppid()`.
        var ppid_fd = bun.invalid_fd;
        if (ppid > 1) switch (bun.sys.pidfd_open(ppid, 0)) {
            .result => |fd| ppid_fd = bun.FD.fromNative(fd),
            .err => |e| if (e.getErrno() == .SRCH)
                bun.Global.exit(bun.ParentDeathWatchdog.exit_code),
        };
        defer if (ppid_fd != bun.invalid_fd) ppid_fd.close();
        // `enable()` armed `PDEATHSIG=SIGKILL` on us. The kernel queues
        // PDEATHSIG to children inside `exit_notify()` *before*
        // `do_notify_pidfd()` wakes pidfd pollers (both under tasklist_lock),
        // and SIGKILL is processed on syscall-return — so `poll()` would never
        // get back to userspace and the cleanup defer never runs. Clear it
        // now that we have a parent watch (pidfd or 100ms-getppid fallback);
        // restore on return so the next caller — or `bun run`'s own
        // post-script lifetime — keeps the backstop.
        if (ppid > 1) {
            _ = std.posix.prctl(.SET_PDEATHSIG, .{0}) catch {};
        }
        defer if (ppid > 1) {
            _ = std.posix.prctl(.SET_PDEATHSIG, .{std.posix.SIG.KILL}) catch {};
        };
        if (ppid > 1 and std.c.getppid() != ppid)
            bun.Global.exit(bun.ParentDeathWatchdog.exit_code);

        const need_ppid_fallback = ppid > 1 and ppid_fd == bun.invalid_fd;
        const timeout_ms: i32 = if (need_ppid_fallback or chld_fd == bun.invalid_fd) 100 else -1;

        var child_status: ?Status = null;
        while (true) {
            // Reap *before* poll(). Covers (a) the SIGCHLD-before-block race —
            // child may have exited between spawnProcessPosix and the
            // sigprocmask above, in which case the kernel discarded SIGCHLD
            // (default disposition is ignore) and signalfd will never wake;
            // (b) the no-signalfd fallback; (c) subreaper-adopted orphans that
            // would otherwise re-fire SIGCHLD forever. `wait4(-1)` is safe
            // here: spawnSync callers (`bun run`, `bunx`, CLI subcommands)
            // have no JS event loop and no other `Process` watchers — every
            // pid we see is either `child` or a subreaper-adopted orphan.
            //
            // WUNTRACED only on a TTY: bridges Ctrl-Z via `JobControl`.
            // Non-TTY callers never see stops, matching plain `bun run`.
            const wopts = std.posix.W.NOHANG |
                if (jc.isActive()) std.posix.W.UNTRACED else @as(u32, 0);
            while (true) {
                const r = PosixSpawn.wait4(-1, wopts, null);
                const w = switch (r) {
                    .err => break,
                    .result => |w| w,
                };
                if (w.pid <= 0) break;
                if (w.pid != child) continue; // subreaper-adopted orphan reaped
                if (std.posix.W.IFSTOPPED(w.status))
                    jc.onChildStopped()
                else
                    child_status = Status.from(child, &r);
            }
            if (child_status != null) break;

            for (out_fds_to_wait_for, out, out_fds) |*fd, *bytes, *out_fd| {
                if (drainFd(fd, out_fd, bytes)) |err| return .{ .err = err };
            }

            var buf: [4]std.c.pollfd = undefined;
            var pfds: []std.c.pollfd = buf[0..0];
            const push = struct {
                fn f(l: *[]std.c.pollfd, fd: bun.FD) void {
                    l.len += 1;
                    l.*[l.len - 1] = .{
                        .fd = @intCast(fd.cast()),
                        .events = std.posix.POLL.IN | std.posix.POLL.ERR | std.posix.POLL.HUP,
                        .revents = 0,
                    };
                }
            }.f;
            for (out_fds_to_wait_for) |fd| if (fd != bun.invalid_fd) push(&pfds, fd);
            const ppid_idx = pfds.len;
            if (ppid_fd != bun.invalid_fd) push(&pfds, ppid_fd);
            const chld_idx = pfds.len;
            if (chld_fd != bun.invalid_fd) push(&pfds, chld_fd);

            const rc = std.c.poll(pfds.ptr, @intCast(pfds.len), timeout_ms);
            switch (bun.sys.getErrno(rc)) {
                .SUCCESS => {},
                .AGAIN, .INTR => {},
                else => |err| return .{ .err = bun.sys.Error.fromCode(err, .poll) },
            }

            if ((ppid_fd != bun.invalid_fd and pfds[ppid_idx].revents != 0) or
                (need_ppid_fallback and std.c.getppid() != ppid))
                bun.Global.exit(bun.ParentDeathWatchdog.exit_code);

            // Drain the signalfd so the next poll blocks; the actual reap
            // happens at the top of the next iteration.
            if (chld_fd != bun.invalid_fd and pfds[chld_idx].revents != 0) {
                var si: linux.signalfd_siginfo = undefined;
                while (bun.sys.read(chld_fd, std.mem.asBytes(&si)).unwrapOr(0) == @sizeOf(linux.signalfd_siginfo)) {}
            }
        }
        for (out_fds_to_wait_for, out, out_fds) |*fd, *bytes, *out_fd| _ = drainFd(fd, out_fd, bytes);
        return .{ .result = child_status.? };
    }

    /// Non-blocking drain of `fd` into `bytes`. Closes and invalidates both
    /// slots on EOF so the caller's deferred cleanup skips them; returns null
    /// on EOF/retry/EPIPE (caller keeps polling) or the recv/OOM error
    /// otherwise. Shared by the `poll()` path and the no-orphans wait loops.
    fn drainFd(fd: *bun.FD, out_fd: *bun.FD, bytes: *std.array_list.Managed(u8)) ?bun.sys.Error {
        if (fd.* == bun.invalid_fd) return null;
        while (true) {
            bytes.ensureUnusedCapacity(16384) catch return bun.sys.Error.fromCode(.NOMEM, .recv);
            switch (bun.sys.recvNonBlock(fd.*, bytes.unusedCapacitySlice())) {
                .err => |err| {
                    if (err.isRetry() or err.getErrno() == .PIPE) return null;
                    return err;
                },
                .result => |bytes_read| {
                    bytes.items.len += bytes_read;
                    if (bytes_read == 0) {
                        fd.*.close();
                        fd.* = bun.invalid_fd;
                        out_fd.* = bun.invalid_fd;
                        return null;
                    }
                },
            }
        }
    }

    /// Blocking `wait4()` until `Status.from` returns a terminal status.
    /// Shared by the `poll()` path and the no-orphans wait loops.
    fn reapChild(child: std.c.pid_t) Status {
        while (true) {
            if (Status.from(child, &PosixSpawn.wait4(child, 0, null))) |stat| return stat;
        }
    }
};

const std = @import("std");
const MultiRunProcessHandle = @import("../../../cli/multi_run.zig").ProcessHandle;
const ProcessHandle = @import("../../../cli/filter_run.zig").ProcessHandle;
const TestWorkerHandle = @import("../../../cli/test/ParallelRunner.zig").Worker;

const CronRegisterJob = @import("../cron.zig").CronRegisterJob;
const CronRemoveJob = @import("../cron.zig").CronRemoveJob;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const PosixSpawn = bun.spawn;
const Maybe = bun.sys.Maybe;
const ShellSubprocess = bun.shell.ShellSubprocess;
const uv = bun.windows.libuv;

const ChromeProcess = bun.api.ChromeProcess;
const WebViewHostProcess = bun.api.WebViewHostProcess;

const LifecycleScriptSubprocess = bun.install.LifecycleScriptSubprocess;
const SecurityScanSubprocess = bun.install.SecurityScanSubprocess;

const jsc = bun.jsc;
const Subprocess = jsc.Subprocess;
