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
// const ShellSubprocessMini = bun.shell.ShellSubprocessMini;
pub const ProcessExitHandler = struct {
    ptr: TaggedPointer = TaggedPointer.Null,

    pub const TaggedPointer = bun.TaggedPointerUnion(.{
        Subprocess,
        LifecycleScriptSubprocess,
        ShellSubprocess,
        // ShellSubprocessMini,
    });

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
            @field(TaggedPointer.Tag, bun.meta.typeBaseName(@typeName(ShellSubprocess))) => {
                const subprocess = this.ptr.as(ShellSubprocess);
                subprocess.onProcessExit(process, status, rusage);
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
        sync: bool,
    ) *Process {
        return Process.new(.{
            .pid = posix.pid,
            .pidfd = posix.pidfd orelse 0,
            .event_loop = JSC.EventLoopHandle.init(event_loop),
            .sync = sync,
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

    pub fn waitPosix(this: *Process, sync: bool) void {
        var rusage = std.mem.zeroes(Rusage);
        const waitpid_result = PosixSpawn.wait4(this.pid, if (sync) 0 else std.os.W.NOHANG, &rusage);
        this.onWaitPid(&waitpid_result, &rusage);
    }

    pub fn wait(this: *Process, sync: bool) void {
        if (comptime Environment.isPosix) {
            this.waitPosix(sync);
        } else if (comptime Environment.isWindows) {}
    }

    pub fn onWaitPidFromWaiterThread(this: *Process, waitpid_result: *const JSC.Maybe(PosixSpawn.WaitPidResult)) void {
        if (comptime Environment.isWindows) {
            @compileError("not implemented on this platform");
        }
        if (this.poller == .waiter_thread) {
            this.poller.waiter_thread.unref(this.event_loop);
            this.poller = .{ .detached = {} };
        }
        this.onWaitPid(waitpid_result, &std.mem.zeroes(Rusage));
        this.deref();
    }

    pub fn onWaitPidFromEventLoopTask(this: *Process) void {
        if (comptime Environment.isWindows) {
            @compileError("not implemented on this platform");
        }
        this.wait(false);
        this.deref();
    }

    fn onWaitPid(this: *Process, waitpid_result_: *const JSC.Maybe(PosixSpawn.WaitPidResult), rusage: *const Rusage) void {
        if (comptime !Environment.isPosix) {
            @compileError("not implemented on this platform");
        }

        const pid = this.pid;

        var waitpid_result = waitpid_result_.*;
        var rusage_result = rusage.*;
        var exit_code: ?u8 = null;
        var signal: ?u8 = null;
        var err: ?bun.sys.Error = null;

        while (true) {
            switch (waitpid_result) {
                .err => |err_| {
                    err = err_;
                },
                .result => |*result| {
                    if (result.pid == this.pid) {
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
                    }
                },
            }

            if (exit_code == null and signal == null and err == null) {
                switch (this.rewatchPosix()) {
                    .result => {},
                    .err => |err_| {
                        if (comptime Environment.isMac) {
                            if (err_.getErrno() == .SRCH) {
                                waitpid_result = PosixSpawn.wait4(
                                    pid,
                                    if (this.sync) 0 else std.os.W.NOHANG,
                                    &rusage_result,
                                );
                                continue;
                            }
                        }
                        err = err_;
                    },
                }
            }

            break;
        }

        if (exit_code != null) {
            this.onExit(
                .{
                    .exited = .{ .code = exit_code.?, .signal = @enumFromInt(signal orelse 0) },
                },
                &rusage_result,
            );
        } else if (signal != null) {
            this.onExit(
                .{
                    .signaled = @enumFromInt(signal.?),
                },
                &rusage_result,
            );
        } else if (err != null) {
            this.onExit(.{ .err = err.? }, &rusage_result);
        }
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

    pub const Exited = struct {
        code: u8 = 0,
        signal: bun.SignalCode = @enumFromInt(0),
    };

    pub fn signalCode(this: *const Status) ?bun.SignalCode {
        return switch (this.*) {
            .signaled => |sig| sig,
            .exited => |exit| if (@intFromEnum(exit.signal) > 0) exit.signal else null,
            else => null,
        };
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
            std.debug.assert(this.uv.isClosed());
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
};

// Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
// use a thread to wait for the child process to exit.
// We use a single thread to call waitpid() in a loop.
const WaiterThreadPosix = struct {
    started: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    signalfd: if (Environment.isLinux) bun.FileDescriptor else u0 = undefined,
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

                pub usingnamespace bun.New(@This());

                pub const runFromJSThread = runFromMainThread;

                pub fn runFromMainThread(self: *@This()) void {
                    const result = self.result;
                    const subprocess = self.subprocess;
                    self.destroy();
                    subprocess.onWaitPidFromWaiterThread(&result);
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
                    subprocess.onWaitPidFromWaiterThread(&result);
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

                    const result = PosixSpawn.wait4(pid, std.os.W.NOHANG, null);
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
        std.debug.assert(should_use_waiter_thread);

        if (instance.started.fetchMax(1, .Monotonic) > 0) {
            return;
        }

        var thread = try std.Thread.spawn(.{ .stack_size = stack_size }, loop, .{});
        thread.detach();

        if (comptime Environment.isLinux) {
            const linux = std.os.linux;
            var mask = std.os.empty_sigset;
            linux.sigaddset(&mask, std.os.SIG.CHLD);
            instance.signalfd = bun.toFD(try std.os.signalfd(-1, &mask, linux.SFD.CLOEXEC | linux.SFD.NONBLOCK));
            instance.eventfd = bun.toFD(try std.os.eventfd(0, linux.EFD.NONBLOCK | linux.EFD.CLOEXEC | 0));
        }
    }

    pub fn loop() void {
        Output.Source.configureNamedThread("Waitpid");

        var this = &instance;

        while (true) {
            this.js_process.loop();

            if (comptime Environment.isLinux) {
                var polls = [_]std.os.pollfd{
                    .{
                        .fd = this.signalfd.cast(),
                        .events = std.os.POLL.IN | std.os.POLL.ERR,
                        .revents = 0,
                    },
                    .{
                        .fd = this.eventfd.cast(),
                        .events = std.os.POLL.IN | std.os.POLL.ERR,
                        .revents = 0,
                    },
                };

                _ = std.os.poll(&polls, std.math.maxInt(i32)) catch 0;

                // Make sure we consume any pending signals
                var buf: [1024]u8 = undefined;
                _ = std.os.read(this.signalfd.cast(), &buf) catch 0;
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

    pub const StdioResult = union(enum) {
        /// inherit, ignore, path, pipe
        unavailable: void,

        buffer: *bun.windows.libuv.Pipe,
        buffer_fd: bun.FileDescriptor,
    };

    pub fn toProcess(
        this: *WindowsSpawnResult,
        _: anytype,
        sync: bool,
    ) *Process {
        var process = this.process_.?;
        this.process_ = null;
        process.sync = sync;
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

    pub fn close(this: *WindowsSpawnResult) void {
        for (this.extra_pipes.items) |fd| {
            _ = bun.sys.close(fd);
        }

        this.extra_pipes.clearAndFree();
    }

    pub fn toProcess(
        this: *const PosixSpawnResult,
        event_loop: anytype,
        sync: bool,
    ) *Process {
        return Process.initPosix(
            this.*,
            event_loop,
            sync,
        );
    }

    fn pidfdFlagsForLinux() u32 {
        const kernel = @import("../../../analytics.zig").GenerateHeader.GeneratePlatform.kernelVersion();

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
    var actions = try PosixSpawn.Actions.init();
    defer actions.deinit();

    var attr = try PosixSpawn.Attr.init();
    defer attr.deinit();

    var flags: i32 = bun.C.POSIX_SPAWN_SETSIGDEF | bun.C.POSIX_SPAWN_SETSIGMASK;

    if (comptime Environment.isMac) {
        flags |= bun.C.POSIX_SPAWN_CLOEXEC_DEFAULT;
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
                const fds: [2]bun.FileDescriptor = brk: {
                    var fds_: [2]std.c.fd_t = undefined;
                    const rc = std.c.socketpair(std.os.AF.UNIX, std.os.SOCK.STREAM, 0, &fds_);
                    if (rc != 0) {
                        return error.SystemResources;
                    }

                    var before = std.c.fcntl(fds_[if (i == 0) 1 else 0], std.os.F.GETFL);

                    _ = std.c.fcntl(fds_[if (i == 0) 1 else 0], std.os.F.SETFL, before | bun.C.FD_CLOEXEC);

                    if (comptime Environment.isMac) {
                        // SO_NOSIGPIPE
                        before = 1;
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
                    var before = std.c.fcntl(fds_[0], std.os.F.GETFL);

                    _ = std.c.fcntl(fds_[0], std.os.F.SETFL, before | std.os.O.NONBLOCK | bun.C.FD_CLOEXEC);

                    if (comptime Environment.isMac) {
                        // SO_NOSIGPIPE
                        _ = std.c.setsockopt(fds_[if (i == 0) 1 else 0], std.os.SOL.SOCKET, std.os.SO.NOSIGPIPE, &before, @sizeOf(c_int));
                    }

                    break :brk .{ bun.toFD(fds_[0]), bun.toFD(fds_[1]) };
                };

                try to_close_at_end.append(fds[1]);
                try to_close_on_error.append(fds[0]);

                try actions.dup2(fds[1], fileno);
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
            if (Environment.allow_assert) std.debug.assert(dup_src != null and dup_tgt != null);
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
    std.debug.assert(process.poller.uv.exit_cb == &Process.onExitUV);

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

// pub const TaskProcess = struct {
//     process: *Process,
//     pending_error: ?bun.sys.Error = null,
//     std: union(enum) {
//         buffer: struct {
//             out: BufferedOutput = BufferedOutput{},
//             err: BufferedOutput = BufferedOutput{},
//         },
//         unavailable: void,

//         pub fn out(this: *@This()) [2]TaskOptions.Output.Result {
//             return switch (this.*) {
//                 .unavailable => .{ .{ .unavailable = {} }, .{ .unavailable = {} } },
//                 .buffer => |*buffer| {
//                     return .{
//                         .{
//                             .buffer = buffer.out.buffer.moveToUnmanaged().items,
//                         },
//                         .{
//                             .buffer = buffer.err.buffer.moveToUnmanaged().items,
//                         },
//                     };
//                 },
//             };
//         }
//     } = .{ .buffer = .{} },
//     callback: Callback = Callback{},

//     pub const Callback = struct {
//         ctx: *anyopaque = undefined,
//         callback: *const fn (*anyopaque, status: Status, stdout: TaskOptions.Output.Result, stderr: TaskOptions.Output.Result) void = undefined,
//     };

//     pub inline fn loop(this: *const TaskProcess) JSC.EventLoopHandle {
//         return this.process.event_loop;
//     }

//     fn onReaderDone(this: *TaskProcess) void {
//         this.maybeFinish();
//     }

//     fn onReaderError(this: *TaskProcess, err: bun.sys.Error) void {
//         this.pending_error = err;

//         this.maybeFinish();
//     }

//     pub fn isDone(this: *const TaskProcess) bool {
//         if (!this.process.hasExited()) {
//             return false;
//         }

//         switch (this.std) {
//             .buffer => |*buffer| {
//                 if (!buffer.err.is_done)
//                     return false;

//                 if (!buffer.out.is_done)
//                     return false;
//             },
//             else => {},
//         }

//         return true;
//     }

//     fn maybeFinish(this: *TaskProcess) void {
//         if (!this.isDone()) {
//             return;
//         }

//         const status = brk: {
//             if (this.pending_error) |pending_er| {
//                 if (this.process.status == .exited) {
//                     break :brk .{ .err = pending_er };
//                 }
//             }

//             break :brk this.process.status;
//         };

//         const callback = this.callback;
//         const out, const err = this.std.out();

//         this.process.detach();
//         this.process.deref();
//         this.deinit();
//         callback.callback(callback.ctx, status, out, err);
//     }

//     pub const BufferedOutput = struct {
//         poll: *bun.Async.FilePoll = undefined,
//         buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
//         is_done: bool = false,

//         // This is a workaround for "Dependency loop detected"
//         parent: *TaskProcess = undefined,

//         pub usingnamespace bun.io.PipeReader(
//             @This(),
//             getFd,
//             getBuffer,
//             null,
//             registerPoll,
//             done,
//             onError,
//         );

//         pub fn getFd(this: *BufferedOutput) bun.FileDescriptor {
//             return this.poll.fd;
//         }

//         pub fn getBuffer(this: *BufferedOutput) *std.ArrayList(u8) {
//             return &this.buffer;
//         }

//         fn finish(this: *BufferedOutput) void {
//             this.poll.flags.insert(.ignore_updates);
//             this.parent.loop().putFilePoll(this.parent, this.poll);
//             std.debug.assert(!this.is_done);
//             this.is_done = true;
//         }

//         pub fn done(this: *BufferedOutput, _: []u8) void {
//             this.finish();
//             onReaderDone(this.parent);
//         }

//         pub fn onError(this: *BufferedOutput, err: bun.sys.Error) void {
//             this.finish();
//             onReaderError(this.parent, err);
//         }

//         pub fn registerPoll(this: *BufferedOutput) void {
//             switch (this.poll.register(this.parent().loop(), .readable, true)) {
//                 .err => |err| {
//                     this.onError(err);
//                 },
//                 .result => {},
//             }
//         }

//         pub fn start(this: *BufferedOutput) JSC.Maybe(void) {
//             const maybe = this.poll.register(this.parent.loop(), .readable, true);
//             if (maybe != .result) {
//                 this.is_done = true;
//                 return maybe;
//             }

//             this.read();

//             return .{
//                 .result = {},
//             };
//         }
//     };

//     pub const Result = union(enum) {
//         fd: bun.FileDescriptor,
//         buffer: []u8,
//         unavailable: void,

//         pub fn deinit(this: *const Result) void {
//             return switch (this.*) {
//                 .fd => {
//                     _ = bun.sys.close(this.fd);
//                 },
//                 .buffer => {
//                     bun.default_allocator.free(this.buffer);
//                 },
//                 .unavailable => {},
//             };
//         }
//     };
// };
