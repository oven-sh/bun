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
const ShellSubprocessMini = bun.shell.ShellSubprocessMini;
pub const ProcessExitHandler = struct {
    ptr: TaggedPointer = TaggedPointer.Null,

    pub const TaggedPointer = bun.TaggedPointerUnion(.{
        Subprocess,
        LifecycleScriptSubprocess,
        ShellSubprocess,
        ShellSubprocessMini,
    });

    pub fn init(this: *ProcessExitHandler, ptr: anytype) void {
        this.ptr = TaggedPointer.init(ptr);
    }

    pub fn call(this: *const ProcessExitHandler, comptime ProcessType: type, process: *ProcessType, status: Status, rusage: *const Rusage) void {
        if (this.ptr.isNull()) {
            return;
        }

        switch (this.ptr.tag()) {
            .Subprocess => {
                if (comptime ProcessType != Process)
                    unreachable;
                const subprocess = this.ptr.as(Subprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            .LifecycleScriptSubprocess => {
                if (comptime ProcessType != Process)
                    unreachable;
                const subprocess = this.ptr.as(LifecycleScriptSubprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, bun.meta.typeBaseName(@typeName(ShellSubprocess))) => {
                if (comptime ProcessType != Process)
                    unreachable;

                const subprocess = this.ptr.as(ShellSubprocess);
                subprocess.onProcessExit(process, status, rusage);
            },
            @field(TaggedPointer.Tag, bun.meta.typeBaseName(@typeName(ShellSubprocessMini))) => {
                if (comptime ProcessType != ProcessMiniEventLoop)
                    unreachable;

                const subprocess = this.ptr.as(ShellSubprocessMini);
                subprocess.onProcessExit(process, status, rusage);
            },
            else => {
                @panic("Internal Bun error: ProcessExitHandler has an invalid tag. Please file a bug report.");
            },
        }
    }
};

pub const Process = NewProcess(JSC.EventLoopKind.js);
pub const ProcessMiniEventLoop = NewProcess(JSC.EventLoopKind.mini);

pub const ProcessEventLoop = struct {
    
};

fn NewProcess(comptime EventLoopKind: JSC.EventLoopKind) type {
    return struct {
        pid: pid_t = 0,
        pidfd: PidFDType = 0,
        status: Status = Status{ .running = {} },
        poller: Poller = Poller{
            .detached = {},
        },
        ref_count: u32 = 1,
        exit_handler: ProcessExitHandler = ProcessExitHandler{},
        sync: bool = false,
        event_loop: *EventLoop,

        pub const EventLoop = EventLoopKind.Type();

        const ThisProcess = @This();

        pub usingnamespace bun.NewRefCounted(ThisProcess, deinit);
        pub const PidFDType = if (Environment.isLinux) fd_t else u0;

        pub fn setExitHandler(this: *ThisProcess, handler: anytype) void {
            this.exit_handler.init(handler);
        }

        pub fn initPosix(
            pid: pid_t,
            pidfd: PidFDType,
            event_loop: *EventLoop,
            sync: bool,
        ) *ThisProcess {
            return ThisProcess.new(.{
                .pid = pid,
                .pidfd = pidfd,
                .event_loop = event_loop,
                .sync = sync,
                .poller = .{ .detached = {} },
            });
        }

        pub fn hasExited(this: *const ThisProcess) bool {
            return switch (this.status) {
                .exited => true,
                .signaled => true,
                .err => true,
                else => false,
            };
        }

        pub fn hasKilled(this: *const ThisProcess) bool {
            return switch (this.status) {
                .exited, .signaled => true,
                else => false,
            };
        }

        pub fn onExit(this: *ThisProcess, status: Status, rusage: *const Rusage) void {
            const exit_handler = this.exit_handler;
            if ((status == .exited and status.exited.code != 0) or status == .err) {
                this.detach();
            }

            this.status = status;

            exit_handler.call(ThisProcess, this, status, rusage);
        }

        pub fn signalCode(this: *const ThisProcess) ?bun.SignalCode {
            return this.status.signalCode();
        }

        pub fn wait(this: *ThisProcess, sync: bool) void {
            var rusage = std.mem.zeroes(Rusage);
            const waitpid_result = PosixSpawn.wait4(this.pid, if (sync) 0 else std.os.W.NOHANG, &rusage);
            this.onWaitPid(&waitpid_result, &rusage);
        }

        pub fn onWaitPidFromWaiterThread(this: *ThisProcess, waitpid_result: *const JSC.Maybe(PosixSpawn.WaitPidResult)) void {
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

        pub fn onWaitPidFromEventLoopTask(this: *ThisProcess) void {
            if (comptime Environment.isWindows) {
                @compileError("not implemented on this platform");
            }
            this.wait(false);
            this.deref();
        }

        fn onWaitPid(this: *ThisProcess, waitpid_result_: *const JSC.Maybe(PosixSpawn.WaitPidResult), rusage: *const Rusage) void {
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

        pub fn watch(this: *ThisProcess, vm: anytype) JSC.Maybe(void) {
            if (comptime Environment.isWindows) {
                return;
            }

            if (WaiterThread.shouldUseWaiterThread() or comptime EventLoopKind == .mini) {
                this.poller = .{ .waiter_thread = .{} };
                if (EventLoopKind == .js)
                    this.poller.waiter_thread.ref(this.event_loop);
                this.ref();
                WaiterThread.append(this);
                return JSC.Maybe(void){ .result = {} };
            }

            const watchfd = if (comptime Environment.isLinux) this.pidfd else this.pid;
            const poll = bun.Async.FilePoll.init(vm, bun.toFD(watchfd), .{}, ThisProcess, this);
            this.poller = .{ .fd = poll };

            switch (this.poller.fd.register(
                this.event_loop.getVmImpl().event_loop_handle.?,
                .process,
                true,
            )) {
                .result => {
                    this.poller.fd.enableKeepingProcessAlive(vm);
                    this.ref();
                    return JSC.Maybe(void){ .result = {} };
                },
                .err => |err| {
                    if (err.getErrno() != .SRCH) {
                        @panic("This shouldn't happen");
                    }

                    return .{ .err = err };
                },
            }

            unreachable;
        }

        pub fn rewatchPosix(this: *ThisProcess) JSC.Maybe(void) {
            if (WaiterThread.shouldUseWaiterThread() or comptime EventLoopKind == .mini) {
                if (this.poller != .waiter_thread)
                    this.poller = .{ .waiter_thread = .{} };
                if (EventLoopKind == .js)
                    this.poller.waiter_thread.ref(this.event_loop.getVmImpl());
                this.ref();
                WaiterThread.append(this);
                return JSC.Maybe(void){ .result = {} };
            }

            if (this.poller == .fd) {
                return this.poller.fd.register(
                    this.event_loop.getVmImpl().event_loop_handle.?,
                    .process,
                    true,
                );
            } else {
                @panic("Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.");
            }
        }

        fn onExitUV(process: *uv.uv_process_t, exit_status: i64, term_signal: c_int) callconv(.C) void {
            const poller = @fieldParentPtr(ThisProcess, "uv", process);
            var this = @fieldParentPtr(ThisProcess, "poller", poller);
            const exit_code: u8 = if (exit_status >= 0) @as(u8, @truncate(@as(u64, @intCast(exit_status)))) else 0;
            const signal_code: ?bun.SignalCode = if (term_signal > 0 and term_signal < @intFromEnum(bun.SignalCode.SIGSYS)) @enumFromInt(term_signal) else null;
            const rusage = uv_getrusage(process);

            if (exit_status != 0) {
                this.close();
                this.onExit(
                    .{
                        .exited = .{ .code = exit_code, .signal = signal_code orelse @enumFromInt(0) },
                    },
                    &rusage,
                );
            } else if (signal_code != null) {
                this.onExit(
                    .{
                        .signaled = .{ .signal = signal_code },
                    },
                    &rusage,
                );
            } else {
                this.onExit(
                    .{
                        .err = .{ .err = bun.sys.Error.fromCode(.INVAL, .waitpid) },
                    },
                    &rusage,
                );
            }
        }

        fn onCloseUV(uv_handle: *uv.uv_process_t) callconv(.C) void {
            const poller = @fieldParentPtr(Poller, "uv", uv_handle);
            var this = @fieldParentPtr(ThisProcess, "poller", poller);
            if (this.poller == .uv) {
                this.poller = .{ .detached = {} };
            }
            this.deref();
        }

        pub fn close(this: *ThisProcess) void {
            switch (this.poller) {
                .fd => |fd| {
                    if (comptime !Environment.isPosix) {
                        unreachable;
                    }

                    fd.deinit();
                    this.poller = .{ .detached = {} };
                },

                .uv => |*process| {
                    if (comptime !Environment.isWindows) {
                        unreachable;
                    }
                    process.unref();

                    if (process.isClosed()) {
                        this.poller = .{ .detached = {} };
                    } else if (!process.isClosing()) {
                        this.ref();
                        process.close(&onCloseUV);
                    }
                },
                .waiter_thread => |*waiter| {
                    waiter.disable();
                    this.poller = .{ .detached = {} };
                },
                else => {},
            }

            if (comptime Environment.isLinux) {
                if (this.pidfd != bun.invalid_fd.int()) {
                    _ = bun.sys.close(this.pidfd);
                    this.pidfd = @intCast(bun.invalid_fd.int());
                }
            }
        }

        pub fn disableKeepingEventLoopAlive(this: *ThisProcess, event_loop_ctx: anytype) void {
            if (this.poller == .fd) {
                if (comptime Environment.isWindows)
                    unreachable;
                this.poller.fd.disableKeepingProcessAlive(event_loop_ctx);
            } else if (this.poller == .uv) {
                if (comptime Environment.isWindows) {
                    if (!this.poller.uv.isClosing()) {
                        this.poller.uv.unref();
                    }
                } else {
                    unreachable;
                }
            } else if (this.poller == .waiter_thread) {
                this.poller.waiter_thread.unref(event_loop_ctx);
            }
        }

        pub fn hasRef(this: *ThisProcess) bool {
            return switch (this.poller) {
                .fd => this.poller.fd.isActive(),
                .uv => if (Environment.isWindows) this.poller.uv.hasRef() else unreachable,
                .waiter_thread => this.poller.waiter_thread.isActive(),
                else => false,
            };
        }

        pub fn enableKeepingEventLoopAlive(this: *ThisProcess, event_loop_ctx: anytype) void {
            if (this.poller == .fd) {
                this.poller.fd.enableKeepingProcessAlive(event_loop_ctx);
            } else if (this.poller == .uv) {
                if (comptime Environment.isWindows) {
                    if (!this.poller.uv.hasRef()) {
                        this.poller.uv.ref();
                    }
                } else {
                    unreachable;
                }
            } else if (this.poller == .waiter_thread) {
                this.poller.waiter_thread.ref(event_loop_ctx);
            }
        }

        pub fn detach(this: *ThisProcess) void {
            this.close();
            this.exit_handler = .{};
        }

        fn deinit(this: *ThisProcess) void {
            if (this.poller == .fd) {
                this.poller.fd.deinit();
            } else if (this.poller == .uv) {
                if (comptime Environment.isWindows) {
                    std.debug.assert(!this.poller.uv.isActive());
                } else {
                    unreachable;
                }
            } else if (this.poller == .waiter_thread) {
                this.poller.waiter_thread.disable();
            }

            this.destroy();
        }

        pub fn kill(this: *ThisProcess, signal: u8) Maybe(void) {
            switch (this.poller) {
                .uv => |*handle| {
                    if (comptime !Environment.isWindows) {
                        unreachable;
                    }

                    if (handle.kill(signal).toError(.kill)) |err| {
                        return .{ .err = err };
                    }

                    return .{
                        .result = {},
                    };
                },
                .fd => {
                    if (comptime !Environment.isPosix) {
                        unreachable;
                    }

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

            return .{
                .result = {},
            };
        }
    };
}

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

pub const Poller = union(enum) {
    fd: *bun.Async.FilePoll,
    uv: if (Environment.isWindows) uv.uv_process_t else void,
    waiter_thread: bun.Async.KeepAlive,
    detached: void,
};

// Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
// use a thread to wait for the child process to exit.
// We use a single thread to call waitpid() in a loop.
pub const WaiterThread = struct {
    started: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    signalfd: if (Environment.isLinux) bun.FileDescriptor else u0 = undefined,
    eventfd: if (Environment.isLinux) bun.FileDescriptor else u0 = undefined,

    js_process: ProcessQueue = .{},
    mini_process: ProcessMiniEventLoopQueue = .{},

    pub const ProcessQueue = NewQueue(Process);
    pub const ProcessMiniEventLoopQueue = NewQueue(ProcessMiniEventLoop);

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
                    var process = queue[i];
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

                        process.event_loop.enqueueTaskConcurrent(
                            JSC.ConcurrentTask.create(
                                JSC.Task.init(
                                    ResultTask.new(
                                        .{
                                            .result = result,
                                            .subprocess = process,
                                        },
                                    ),
                                ),
                            ),
                        );
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
            *ProcessMiniEventLoop => instance.mini_process.append(process),
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
            this.mini_process.loop();

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
