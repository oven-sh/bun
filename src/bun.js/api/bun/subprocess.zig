//! The Subprocess object is returned by `Bun.spawn`. This file also holds the
//! code for `Bun.spawnSync`

pub const js = JSC.Codegen.JSSubprocess;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
pub const ref = RefCount.ref;
pub const deref = RefCount.deref;

ref_count: RefCount,
process: *Process,
stdin: Writable,
stdout: Readable,
stderr: Readable,
stdio_pipes: if (Environment.isWindows) std.ArrayListUnmanaged(StdioResult) else std.ArrayListUnmanaged(bun.FileDescriptor) = .{},
pid_rusage: ?Rusage = null,

globalThis: *JSC.JSGlobalObject,
observable_getters: std.enums.EnumSet(enum {
    stdin,
    stdout,
    stderr,
    stdio,
}) = .{},
closed: std.enums.EnumSet(StdioKind) = .{},
has_pending_activity: std.atomic.Value(bool) = std.atomic.Value(bool).init(true),
this_jsvalue: JSC.JSValue = .zero,

/// `null` indicates all of the IPC data is uninitialized.
ipc_data: ?IPC.SendQueue,
flags: Flags = .{},

weak_file_sink_stdin_ptr: ?*JSC.WebCore.FileSink = null,
abort_signal: ?*webcore.AbortSignal = null,

event_loop_timer_refd: bool = false,
event_loop_timer: bun.api.Timer.EventLoopTimer = .{
    .tag = .SubprocessTimeout,
    .next = .{
        .sec = 0,
        .nsec = 0,
    },
},
killSignal: SignalCode,

stdout_maxbuf: ?*MaxBuf = null,
stderr_maxbuf: ?*MaxBuf = null,
exited_due_to_maxbuf: ?MaxBuf.Kind = null,

pub const Flags = packed struct(u8) {
    is_sync: bool = false,
    killed: bool = false,
    has_stdin_destructor_called: bool = false,
    finalized: bool = false,
    deref_on_stdin_destroyed: bool = false,
    _: u3 = 0,
};

pub const SignalCode = bun.SignalCode;

pub const Poll = union(enum) {
    poll_ref: ?*Async.FilePoll,
    wait_thread: WaitThreadPoll,
};

pub const WaitThreadPoll = struct {
    ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    poll_ref: Async.KeepAlive = .{},
};

pub inline fn assertStdioResult(result: StdioResult) void {
    if (comptime Environment.allow_assert) {
        if (Environment.isPosix) {
            if (result) |fd| {
                bun.assert(fd != bun.invalid_fd);
            }
        }
    }
}

pub const ResourceUsage = struct {
    pub const js = JSC.Codegen.JSResourceUsage;
    pub const toJS = ResourceUsage.js.toJS;
    pub const fromJS = ResourceUsage.js.fromJS;
    pub const fromJSDirect = ResourceUsage.js.fromJSDirect;

    rusage: Rusage,

    pub fn getCPUTime(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) JSValue {
        var cpu = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        const rusage = this.rusage;

        const usrTime = JSValue.fromTimevalNoTruncate(globalObject, rusage.utime.usec, rusage.utime.sec);
        const sysTime = JSValue.fromTimevalNoTruncate(globalObject, rusage.stime.usec, rusage.stime.sec);

        cpu.put(globalObject, JSC.ZigString.static("user"), usrTime);
        cpu.put(globalObject, JSC.ZigString.static("system"), sysTime);
        cpu.put(globalObject, JSC.ZigString.static("total"), JSValue.bigIntSum(globalObject, usrTime, sysTime));

        return cpu;
    }

    pub fn getMaxRSS(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.maxrss);
    }

    pub fn getSharedMemorySize(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.ixrss);
    }

    pub fn getSwapCount(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.nswap);
    }

    pub fn getOps(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) JSValue {
        var ops = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        ops.put(globalObject, JSC.ZigString.static("in"), JSC.JSValue.jsNumber(this.rusage.inblock));
        ops.put(globalObject, JSC.ZigString.static("out"), JSC.JSValue.jsNumber(this.rusage.oublock));
        return ops;
    }

    pub fn getMessages(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) JSValue {
        var msgs = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        msgs.put(globalObject, JSC.ZigString.static("sent"), JSC.JSValue.jsNumber(this.rusage.msgsnd));
        msgs.put(globalObject, JSC.ZigString.static("received"), JSC.JSValue.jsNumber(this.rusage.msgrcv));
        return msgs;
    }

    pub fn getSignalCount(
        this: *ResourceUsage,
        _: *JSGlobalObject,
    ) JSValue {
        return JSC.JSValue.jsNumber(this.rusage.nsignals);
    }

    pub fn getContextSwitches(
        this: *ResourceUsage,
        globalObject: *JSGlobalObject,
    ) JSValue {
        var ctx = JSC.JSValue.createEmptyObjectWithNullPrototype(globalObject);
        ctx.put(globalObject, JSC.ZigString.static("voluntary"), JSC.JSValue.jsNumber(this.rusage.nvcsw));
        ctx.put(globalObject, JSC.ZigString.static("involuntary"), JSC.JSValue.jsNumber(this.rusage.nivcsw));
        return ctx;
    }

    pub fn finalize(this: *ResourceUsage) callconv(.C) void {
        bun.default_allocator.destroy(this);
    }
};

pub fn appendEnvpFromJS(globalThis: *JSC.JSGlobalObject, object: *JSC.JSObject, envp: *std.ArrayList(?[*:0]const u8), PATH: *[]const u8) bun.JSError!void {
    var object_iter = try JSC.JSPropertyIterator(.{ .skip_empty_name = false, .include_value = true }).init(globalThis, object);
    defer object_iter.deinit();

    try envp.ensureTotalCapacityPrecise(object_iter.len +
        // +1 incase there's IPC
        // +1 for null terminator
        2);
    while (try object_iter.next()) |key| {
        var value = object_iter.value;
        if (value.isUndefined()) continue;

        const line = try std.fmt.allocPrintZ(envp.allocator, "{}={}", .{ key, try value.getZigString(globalThis) });

        if (key.eqlComptime("PATH")) {
            PATH.* = bun.asByteSlice(line["PATH=".len..]);
        }

        try envp.append(line);
    }
}

const log = Output.scoped(.Subprocess, false);
pub const StdioKind = enum {
    stdin,
    stdout,
    stderr,

    pub fn toFd(this: @This()) bun.FileDescriptor {
        return switch (this) {
            .stdin => .stdin(),
            .stdout => .stdout(),
            .stderr => .stderr(),
        };
    }

    pub fn toNum(this: @This()) c_int {
        return switch (this) {
            .stdin => 0,
            .stdout => 1,
            .stderr => 2,
        };
    }
};

pub fn onAbortSignal(subprocess_ctx: ?*anyopaque, _: JSC.JSValue) callconv(.C) void {
    var this: *Subprocess = @ptrCast(@alignCast(subprocess_ctx.?));
    this.clearAbortSignal();
    _ = this.tryKill(this.killSignal);
}

pub fn resourceUsage(
    this: *Subprocess,
    globalObject: *JSGlobalObject,
    _: *JSC.CallFrame,
) bun.JSError!JSValue {
    return this.createResourceUsageObject(globalObject);
}

pub fn createResourceUsageObject(this: *Subprocess, globalObject: *JSGlobalObject) JSValue {
    const pid_rusage = this.pid_rusage orelse brk: {
        if (Environment.isWindows) {
            if (this.process.poller == .uv) {
                this.pid_rusage = PosixSpawn.process.uv_getrusage(&this.process.poller.uv);
                break :brk this.pid_rusage.?;
            }
        }

        return .js_undefined;
    };

    const resource_usage = ResourceUsage{
        .rusage = pid_rusage,
    };

    var result = bun.default_allocator.create(ResourceUsage) catch {
        return globalObject.throwOutOfMemoryValue();
    };
    result.* = resource_usage;
    return result.toJS(globalObject);
}

pub fn hasExited(this: *const Subprocess) bool {
    return this.process.hasExited();
}

pub fn hasPendingActivityNonThreadsafe(this: *const Subprocess) bool {
    if (this.ipc_data != null) {
        return true;
    }

    if (this.hasPendingActivityStdio()) {
        return true;
    }

    if (!this.process.hasExited()) {
        return true;
    }

    return false;
}

pub fn updateHasPendingActivity(this: *Subprocess) void {
    if (comptime Environment.isDebug) {
        log("updateHasPendingActivity() {any} -> {any}", .{
            this.has_pending_activity.raw,
            this.hasPendingActivityNonThreadsafe(),
        });
    }
    this.has_pending_activity.store(
        this.hasPendingActivityNonThreadsafe(),
        .monotonic,
    );
}

pub fn hasPendingActivityStdio(this: *const Subprocess) bool {
    if (this.stdin.hasPendingActivity()) {
        return true;
    }

    inline for (.{ StdioKind.stdout, StdioKind.stderr }) |kind| {
        if (@field(this, @tagName(kind)).hasPendingActivity()) {
            return true;
        }
    }

    return false;
}

pub fn onCloseIO(this: *Subprocess, kind: StdioKind) void {
    switch (kind) {
        .stdin => {
            switch (this.stdin) {
                .pipe => |pipe| {
                    pipe.signal.clear();
                    pipe.deref();
                    this.stdin = .{ .ignore = {} };
                },
                .buffer => {
                    this.stdin.buffer.source.detach();
                    this.stdin.buffer.deref();
                    this.stdin = .{ .ignore = {} };
                },
                else => {},
            }
        },
        inline .stdout, .stderr => |tag| {
            const out: *Readable = &@field(this, @tagName(tag));
            switch (out.*) {
                .pipe => |pipe| {
                    if (pipe.state == .done) {
                        out.* = .{ .buffer = CowString.initOwned(pipe.state.done, bun.default_allocator) };
                        pipe.state = .{ .done = &.{} };
                    } else {
                        out.* = .{ .ignore = {} };
                    }
                    pipe.deref();
                },
                else => {},
            }
        },
    }
}

pub fn hasPendingActivity(this: *Subprocess) callconv(.C) bool {
    return this.has_pending_activity.load(.acquire);
}

pub fn jsRef(this: *Subprocess) void {
    this.process.enableKeepingEventLoopAlive();

    if (!this.hasCalledGetter(.stdin)) {
        this.stdin.ref();
    }

    if (!this.hasCalledGetter(.stdout)) {
        this.stdout.ref();
    }

    if (!this.hasCalledGetter(.stderr)) {
        this.stderr.ref();
    }

    this.updateHasPendingActivity();
}

/// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
pub fn jsUnref(this: *Subprocess) void {
    this.process.disableKeepingEventLoopAlive();

    if (!this.hasCalledGetter(.stdin)) {
        this.stdin.unref();
    }

    if (!this.hasCalledGetter(.stdout)) {
        this.stdout.unref();
    }

    if (!this.hasCalledGetter(.stderr)) {
        this.stderr.unref();
    }

    this.updateHasPendingActivity();
}

pub fn constructor(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*Subprocess {
    return globalObject.throw("Cannot construct Subprocess", .{});
}

const Readable = union(enum) {
    fd: bun.FileDescriptor,
    memfd: bun.FileDescriptor,
    pipe: *PipeReader,
    inherit: void,
    ignore: void,
    closed: void,
    /// Eventually we will implement Readables created from blobs and array buffers.
    /// When we do that, `buffer` will be borrowed from those objects.
    ///
    /// When a buffered `pipe` finishes reading from its file descriptor,
    /// the owning `Readable` will be convered into this variant and the pipe's
    /// buffer will be taken as an owned `CowString`.
    buffer: CowString,

    pub fn memoryCost(this: *const Readable) usize {
        return switch (this.*) {
            .pipe => @sizeOf(PipeReader) + this.pipe.memoryCost(),
            .buffer => this.buffer.length(),
            else => 0,
        };
    }

    pub fn hasPendingActivity(this: *const Readable) bool {
        return switch (this.*) {
            .pipe => this.pipe.hasPendingActivity(),
            else => false,
        };
    }

    pub fn ref(this: *Readable) void {
        switch (this.*) {
            .pipe => {
                this.pipe.updateRef(true);
            },
            else => {},
        }
    }

    pub fn unref(this: *Readable) void {
        switch (this.*) {
            .pipe => {
                this.pipe.updateRef(false);
            },
            else => {},
        }
    }

    pub fn init(stdio: Stdio, event_loop: *JSC.EventLoop, process: *Subprocess, result: StdioResult, allocator: std.mem.Allocator, max_size: ?*MaxBuf, is_sync: bool) Readable {
        _ = allocator; // autofix
        _ = is_sync; // autofix
        assertStdioResult(result);

        if (comptime Environment.isPosix) {
            if (stdio == .pipe) {
                _ = bun.sys.setNonblocking(result.?);
            }
        }

        return switch (stdio) {
            .inherit => Readable{ .inherit = {} },
            .ignore, .ipc, .path => Readable{ .ignore = {} },
            .fd => |fd| if (Environment.isPosix) Readable{ .fd = result.? } else Readable{ .fd = fd },
            .memfd => if (Environment.isPosix) Readable{ .memfd = stdio.memfd } else Readable{ .ignore = {} },
            .dup2 => |dup2| if (Environment.isPosix) Output.panic("TODO: implement dup2 support in Stdio readable", .{}) else Readable{ .fd = dup2.out.toFd() },
            .pipe => Readable{ .pipe = PipeReader.create(event_loop, process, result, max_size) },
            .array_buffer, .blob => Output.panic("TODO: implement ArrayBuffer & Blob support in Stdio readable", .{}),
            .capture => Output.panic("TODO: implement capture support in Stdio readable", .{}),
        };
    }

    pub fn onClose(this: *Readable, _: ?bun.sys.Error) void {
        this.* = .closed;
    }

    pub fn onReady(_: *Readable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}

    pub fn onStart(_: *Readable) void {}

    pub fn close(this: *Readable) void {
        switch (this.*) {
            .memfd => |fd| {
                this.* = .{ .closed = {} };
                fd.close();
            },
            .fd => |_| {
                this.* = .{ .closed = {} };
            },
            .pipe => {
                this.pipe.close();
            },
            else => {},
        }
    }

    pub fn finalize(this: *Readable) void {
        switch (this.*) {
            .memfd => |fd| {
                this.* = .{ .closed = {} };
                fd.close();
            },
            .fd => {
                this.* = .{ .closed = {} };
            },
            .pipe => |pipe| {
                defer pipe.detach();
                this.* = .{ .closed = {} };
            },
            .buffer => |*buf| {
                buf.deinit(bun.default_allocator);
            },
            else => {},
        }
    }

    pub fn toJS(this: *Readable, globalThis: *JSC.JSGlobalObject, exited: bool) JSValue {
        _ = exited; // autofix
        switch (this.*) {
            // should only be reachable when the entire output is buffered.
            .memfd => return this.toBufferedValue(globalThis) catch .zero,

            .fd => |fd| {
                return fd.toJS(globalThis);
            },
            .pipe => |pipe| {
                defer pipe.detach();
                this.* = .{ .closed = {} };
                return pipe.toJS(globalThis);
            },
            .buffer => |*buffer| {
                defer this.* = .{ .closed = {} };

                if (buffer.length() == 0) {
                    return JSC.WebCore.ReadableStream.empty(globalThis);
                }

                const own = buffer.takeSlice(bun.default_allocator) catch {
                    globalThis.throwOutOfMemory() catch return .zero;
                };
                return JSC.WebCore.ReadableStream.fromOwnedSlice(globalThis, own, 0);
            },
            else => {
                return .js_undefined;
            },
        }
    }

    pub fn toBufferedValue(this: *Readable, globalThis: *JSC.JSGlobalObject) bun.JSError!JSValue {
        switch (this.*) {
            .fd => |fd| {
                return fd.toJS(globalThis);
            },
            .memfd => |fd| {
                if (comptime !Environment.isPosix) {
                    Output.panic("memfd is only supported on Linux", .{});
                }
                this.* = .{ .closed = {} };
                return JSC.ArrayBuffer.toJSBufferFromMemfd(fd, globalThis);
            },
            .pipe => |pipe| {
                defer pipe.detach();
                this.* = .{ .closed = {} };
                return pipe.toBuffer(globalThis);
            },
            .buffer => |*buf| {
                defer this.* = .{ .closed = {} };
                const own = buf.takeSlice(bun.default_allocator) catch {
                    return globalThis.throwOutOfMemory();
                };

                return JSC.MarkedArrayBuffer.fromBytes(own, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
            },
            else => {
                return .js_undefined;
            },
        }
    }
};

pub fn getStderr(
    this: *Subprocess,
    globalThis: *JSGlobalObject,
) JSValue {
    this.observable_getters.insert(.stderr);
    return this.stderr.toJS(globalThis, this.hasExited());
}

pub fn getStdin(
    this: *Subprocess,
    globalThis: *JSGlobalObject,
) JSValue {
    this.observable_getters.insert(.stdin);
    return this.stdin.toJS(globalThis, this);
}

pub fn getStdout(
    this: *Subprocess,
    globalThis: *JSGlobalObject,
) JSValue {
    this.observable_getters.insert(.stdout);
    // NOTE: ownership of internal buffers is transferred to the JSValue, which
    // gets cached on JSSubprocess (created via bindgen). This makes it
    // re-accessable to JS code but not via `this.stdout`, which is now `.closed`.
    return this.stdout.toJS(globalThis, this.hasExited());
}

pub fn asyncDispose(
    this: *Subprocess,
    global: *JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    if (this.process.hasExited()) {
        // rely on GC to clean everything up in this case
        return .js_undefined;
    }

    const this_jsvalue = callframe.this();

    defer this_jsvalue.ensureStillAlive();

    // unref streams so that this disposed process will not prevent
    // the process from exiting causing a hang
    this.stdin.unref();
    this.stdout.unref();
    this.stderr.unref();

    switch (this.tryKill(this.killSignal)) {
        .result => {},
        .err => |err| {
            // Signal 9 should always be fine, but just in case that somehow fails.
            return global.throwValue(err.toJSC(global));
        },
    }

    return this.getExited(this_jsvalue, global);
}

fn setEventLoopTimerRefd(this: *Subprocess, refd: bool) void {
    if (this.event_loop_timer_refd == refd) return;
    this.event_loop_timer_refd = refd;
    if (refd) {
        this.globalThis.bunVM().timer.incrementTimerRef(1);
    } else {
        this.globalThis.bunVM().timer.incrementTimerRef(-1);
    }
}

pub fn timeoutCallback(this: *Subprocess) bun.api.Timer.EventLoopTimer.Arm {
    this.setEventLoopTimerRefd(false);
    if (this.event_loop_timer.state == .CANCELLED) return .disarm;
    if (this.hasExited()) {
        this.event_loop_timer.state = .CANCELLED;
        return .disarm;
    }
    this.event_loop_timer.state = .FIRED;
    _ = this.tryKill(this.killSignal);
    return .disarm;
}

pub fn onMaxBuffer(this: *Subprocess, kind: MaxBuf.Kind) void {
    this.exited_due_to_maxbuf = kind;
    _ = this.tryKill(this.killSignal);
}

fn parseSignal(arg: JSC.JSValue, globalThis: *JSC.JSGlobalObject) !SignalCode {
    if (arg.getNumber()) |sig64| {
        // Node does this:
        if (std.math.isNan(sig64)) {
            return SignalCode.default;
        }

        // This matches node behavior, minus some details with the error messages: https://gist.github.com/Jarred-Sumner/23ba38682bf9d84dff2f67eb35c42ab6
        if (std.math.isInf(sig64) or @trunc(sig64) != sig64) {
            return globalThis.throwInvalidArguments("Unknown signal", .{});
        }

        if (sig64 < 0) {
            return globalThis.throwInvalidArguments("Invalid signal: must be >= 0", .{});
        }

        if (sig64 > 31) {
            return globalThis.throwInvalidArguments("Invalid signal: must be < 32", .{});
        }

        const code: SignalCode = @enumFromInt(@as(u8, @intFromFloat(sig64)));
        return code;
    } else if (arg.isString()) {
        if (arg.asString().length() == 0) {
            return SignalCode.default;
        }
        const signal_code = try arg.toEnum(globalThis, "signal", SignalCode);
        return signal_code;
    } else if (!arg.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("Invalid signal: must be a string or an integer", .{});
    }

    return SignalCode.default;
}

pub fn kill(
    this: *Subprocess,
    globalThis: *JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSValue {
    this.this_jsvalue = callframe.this();

    const arguments = callframe.arguments_old(1);
    // If signal is 0, then no actual signal is sent, but error checking
    // is still performed.
    const sig: SignalCode = try parseSignal(arguments.ptr[0], globalThis);

    if (globalThis.hasException()) return .zero;

    switch (this.tryKill(sig)) {
        .result => {},
        .err => |err| {
            // EINVAL or ENOSYS means the signal is not supported in the current platform (most likely unsupported on windows)
            return globalThis.throwValue(err.toJSC(globalThis));
        },
    }

    return .js_undefined;
}

pub fn hasKilled(this: *const Subprocess) bool {
    return this.process.hasKilled();
}

pub fn tryKill(this: *Subprocess, sig: SignalCode) JSC.Maybe(void) {
    if (this.hasExited()) {
        return .{ .result = {} };
    }
    return this.process.kill(@intFromEnum(sig));
}

fn hasCalledGetter(this: *Subprocess, comptime getter: @Type(.enum_literal)) bool {
    return this.observable_getters.contains(getter);
}

fn closeProcess(this: *Subprocess) void {
    if (comptime !Environment.isLinux) {
        return;
    }
    this.process.close();
}

pub fn doRef(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    this.jsRef();
    return .js_undefined;
}

pub fn doUnref(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSValue {
    this.jsUnref();
    return .js_undefined;
}

pub fn onStdinDestroyed(this: *Subprocess) void {
    const must_deref = this.flags.deref_on_stdin_destroyed;
    this.flags.deref_on_stdin_destroyed = false;
    defer if (must_deref) this.deref();

    this.flags.has_stdin_destructor_called = true;
    this.weak_file_sink_stdin_ptr = null;

    if (!this.flags.finalized) {
        // otherwise update the pending activity flag
        this.updateHasPendingActivity();
    }
}

pub fn doSend(this: *Subprocess, global: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) bun.JSError!JSValue {
    IPClog("Subprocess#doSend", .{});

    return IPC.doSend(if (this.ipc_data) |*data| data else null, global, callFrame, if (this.hasExited()) .subprocess_exited else .subprocess);
}
pub fn disconnectIPC(this: *Subprocess, nextTick: bool) void {
    const ipc_data = this.ipc() orelse return;
    ipc_data.closeSocketNextTick(nextTick);
}
pub fn disconnect(this: *Subprocess, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    _ = globalThis;
    _ = callframe;
    this.disconnectIPC(true);
    return .js_undefined;
}

pub fn getConnected(this: *Subprocess, globalThis: *JSGlobalObject) JSValue {
    _ = globalThis;
    const ipc_data = this.ipc();
    return JSValue.jsBoolean(ipc_data != null and ipc_data.?.isConnected());
}

pub fn pid(this: *const Subprocess) i32 {
    return @intCast(this.process.pid);
}

pub fn getPid(this: *Subprocess, _: *JSGlobalObject) JSValue {
    return JSValue.jsNumber(this.pid());
}

pub fn getKilled(this: *Subprocess, _: *JSGlobalObject) JSValue {
    return JSValue.jsBoolean(this.hasKilled());
}

pub fn getStdio(this: *Subprocess, global: *JSGlobalObject) bun.JSError!JSValue {
    const array = try JSValue.createEmptyArray(global, 0);
    array.push(global, .null);
    array.push(global, .null); // TODO: align this with options
    array.push(global, .null); // TODO: align this with options

    this.observable_getters.insert(.stdio);
    var pipes = this.stdio_pipes.items;
    if (this.ipc_data != null) {
        array.push(global, .null);
        pipes = pipes[@min(1, pipes.len)..];
    }

    for (pipes) |item| {
        if (Environment.isWindows) {
            if (item == .buffer) {
                const fdno: usize = @intFromPtr(item.buffer.fd().cast());
                array.push(global, JSValue.jsNumber(fdno));
            }
        } else {
            array.push(global, JSValue.jsNumber(item.cast()));
        }
    }
    return array;
}

pub const Source = union(enum) {
    blob: JSC.WebCore.Blob.Any,
    array_buffer: JSC.ArrayBuffer.Strong,
    detached: void,

    pub fn memoryCost(this: *const Source) usize {
        // Memory cost of Source and each of the particular fields is covered by @sizeOf(Subprocess).
        return switch (this.*) {
            .blob => this.blob.memoryCost(),
            // ArrayBuffer is owned by GC.
            .array_buffer => 0,
            .detached => 0,
        };
    }

    pub fn slice(this: *const Source) []const u8 {
        return switch (this.*) {
            .blob => this.blob.slice(),
            .array_buffer => this.array_buffer.slice(),
            else => @panic("Invalid source"),
        };
    }

    pub fn detach(this: *@This()) void {
        switch (this.*) {
            .blob => {
                this.blob.detach();
            },
            .array_buffer => {
                this.array_buffer.deinit();
            },
            else => {},
        }
        this.* = .detached;
    }
};

pub const StaticPipeWriter = NewStaticPipeWriter(Subprocess);

pub fn NewStaticPipeWriter(comptime ProcessType: type) type {
    return struct {
        const This = @This();

        ref_count: WriterRefCount,
        writer: IOWriter = .{},
        stdio_result: StdioResult,
        source: Source = .{ .detached = {} },
        process: *ProcessType = undefined,
        event_loop: JSC.EventLoopHandle,
        buffer: []const u8 = "",

        // It seems there is a bug in the Zig compiler. We'll get back to this one later
        const WriterRefCount = bun.ptr.RefCount(@This(), "ref_count", _deinit, .{});
        pub const ref = WriterRefCount.ref;
        pub const deref = WriterRefCount.deref;

        const print = bun.Output.scoped(.StaticPipeWriter, false);

        pub const IOWriter = bun.io.BufferedWriter(@This(), struct {
            pub const onWritable = null;
            pub const getBuffer = This.getBuffer;
            pub const onClose = This.onClose;
            pub const onError = This.onError;
            pub const onWrite = This.onWrite;
        });
        pub const Poll = IOWriter;

        pub fn updateRef(this: *This, add: bool) void {
            this.writer.updateRef(this.event_loop, add);
        }

        pub fn getBuffer(this: *This) []const u8 {
            return this.buffer;
        }

        pub fn close(this: *This) void {
            log("StaticPipeWriter(0x{x}) close()", .{@intFromPtr(this)});
            this.writer.close();
        }

        pub fn flush(this: *This) void {
            if (this.buffer.len > 0)
                this.writer.write();
        }

        pub fn create(event_loop: anytype, subprocess: *ProcessType, result: StdioResult, source: Source) *This {
            const this = bun.new(This, .{
                .ref_count = .init(),
                .event_loop = JSC.EventLoopHandle.init(event_loop),
                .process = subprocess,
                .stdio_result = result,
                .source = source,
            });
            if (Environment.isWindows) {
                this.writer.setPipe(this.stdio_result.buffer);
            }
            this.writer.setParent(this);
            return this;
        }

        pub fn start(this: *This) JSC.Maybe(void) {
            log("StaticPipeWriter(0x{x}) start()", .{@intFromPtr(this)});
            this.ref();
            this.buffer = this.source.slice();
            if (Environment.isWindows) {
                return this.writer.startWithCurrentPipe();
            }
            switch (this.writer.start(this.stdio_result.?, true)) {
                .err => |err| {
                    return .{ .err = err };
                },
                .result => {
                    if (comptime Environment.isPosix) {
                        const poll = this.writer.handle.poll;
                        poll.flags.insert(.socket);
                    }

                    return .{ .result = {} };
                },
            }
        }

        pub fn onWrite(this: *This, amount: usize, status: bun.io.WriteStatus) void {
            log("StaticPipeWriter(0x{x}) onWrite(amount={d} {})", .{ @intFromPtr(this), amount, status });
            this.buffer = this.buffer[@min(amount, this.buffer.len)..];
            if (status == .end_of_file or this.buffer.len == 0) {
                this.writer.close();
            }
        }

        pub fn onError(this: *This, err: bun.sys.Error) void {
            log("StaticPipeWriter(0x{x}) onError(err={any})", .{ @intFromPtr(this), err });
            this.source.detach();
        }

        pub fn onClose(this: *This) void {
            log("StaticPipeWriter(0x{x}) onClose()", .{@intFromPtr(this)});
            this.source.detach();
            this.process.onCloseIO(.stdin);
        }

        fn _deinit(this: *This) void {
            this.writer.end();
            this.source.detach();
            bun.destroy(this);
        }

        pub fn memoryCost(this: *const This) usize {
            return @sizeOf(@This()) + this.source.memoryCost() + this.writer.memoryCost();
        }

        pub fn loop(this: *This) *uws.Loop {
            return this.event_loop.loop();
        }

        pub fn watch(this: *This) void {
            if (this.buffer.len > 0) {
                this.writer.watch();
            }
        }

        pub fn eventLoop(this: *This) JSC.EventLoopHandle {
            return this.event_loop;
        }
    };
}

pub const PipeReader = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", PipeReader.deinit, .{});
    pub const ref = PipeReader.RefCount.ref;
    pub const deref = PipeReader.RefCount.deref;

    reader: IOReader = undefined,
    process: ?*Subprocess = null,
    event_loop: *JSC.EventLoop = undefined,
    ref_count: PipeReader.RefCount,
    state: union(enum) {
        pending: void,
        done: []u8,
        err: bun.sys.Error,
    } = .{ .pending = {} },
    stdio_result: StdioResult,
    pub const IOReader = bun.io.BufferedReader;
    pub const Poll = IOReader;

    pub fn memoryCost(this: *const PipeReader) usize {
        return this.reader.memoryCost();
    }

    pub fn hasPendingActivity(this: *const PipeReader) bool {
        if (this.state == .pending)
            return true;

        return this.reader.hasPendingActivity();
    }

    pub fn detach(this: *PipeReader) void {
        this.process = null;
        this.deref();
    }

    pub fn create(event_loop: *JSC.EventLoop, process: *Subprocess, result: StdioResult, limit: ?*MaxBuf) *PipeReader {
        var this = bun.new(PipeReader, .{
            .ref_count = .init(),
            .process = process,
            .reader = IOReader.init(@This()),
            .event_loop = event_loop,
            .stdio_result = result,
        });
        MaxBuf.addToPipereader(limit, &this.reader.maxbuf);
        if (Environment.isWindows) {
            this.reader.source = .{ .pipe = this.stdio_result.buffer };
        }

        this.reader.setParent(this);
        return this;
    }

    pub fn readAll(this: *PipeReader) void {
        if (this.state == .pending)
            this.reader.read();
    }

    pub fn start(this: *PipeReader, process: *Subprocess, event_loop: *JSC.EventLoop) JSC.Maybe(void) {
        this.ref();
        this.process = process;
        this.event_loop = event_loop;
        if (Environment.isWindows) {
            return this.reader.startWithCurrentPipe();
        }

        switch (this.reader.start(this.stdio_result.?, true)) {
            .err => |err| {
                return .{ .err = err };
            },
            .result => {
                if (comptime Environment.isPosix) {
                    const poll = this.reader.handle.poll;
                    poll.flags.insert(.socket);
                    this.reader.flags.socket = true;
                    this.reader.flags.nonblocking = true;
                    this.reader.flags.pollable = true;
                    poll.flags.insert(.nonblocking);
                }

                return .{ .result = {} };
            },
        }
    }

    pub const toJS = toReadableStream;

    pub fn onReaderDone(this: *PipeReader) void {
        const owned = this.toOwnedSlice();
        this.state = .{ .done = owned };
        if (this.process) |process| {
            this.process = null;
            process.onCloseIO(this.kind(process));
            this.deref();
        }
    }

    pub fn kind(reader: *const PipeReader, process: *const Subprocess) StdioKind {
        if (process.stdout == .pipe and process.stdout.pipe == reader) {
            return .stdout;
        }

        if (process.stderr == .pipe and process.stderr.pipe == reader) {
            return .stderr;
        }

        @panic("We should be either stdout or stderr");
    }

    pub fn toOwnedSlice(this: *PipeReader) []u8 {
        if (this.state == .done) {
            return this.state.done;
        }
        // we do not use .toOwnedSlice() because we don't want to reallocate memory.
        const out = this.reader._buffer;
        this.reader._buffer.items = &.{};
        this.reader._buffer.capacity = 0;

        if (out.capacity > 0 and out.items.len == 0) {
            out.deinit();
            return &.{};
        }

        return out.items;
    }

    pub fn updateRef(this: *PipeReader, add: bool) void {
        this.reader.updateRef(add);
    }

    pub fn watch(this: *PipeReader) void {
        if (!this.reader.isDone())
            this.reader.watch();
    }

    pub fn toReadableStream(this: *PipeReader, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        defer this.detach();

        switch (this.state) {
            .pending => {
                const stream = JSC.WebCore.ReadableStream.fromPipe(globalObject, this, &this.reader);
                this.state = .{ .done = &.{} };
                return stream;
            },
            .done => |bytes| {
                this.state = .{ .done = &.{} };
                return JSC.WebCore.ReadableStream.fromOwnedSlice(globalObject, bytes, 0);
            },
            .err => |err| {
                _ = err; // autofix
                const empty = JSC.WebCore.ReadableStream.empty(globalObject);
                JSC.WebCore.ReadableStream.cancel(&JSC.WebCore.ReadableStream.fromJS(empty, globalObject).?, globalObject);
                return empty;
            },
        }
    }

    pub fn toBuffer(this: *PipeReader, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        switch (this.state) {
            .done => |bytes| {
                defer this.state = .{ .done = &.{} };
                return JSC.MarkedArrayBuffer.fromBytes(bytes, bun.default_allocator, .Uint8Array).toNodeBuffer(globalThis);
            },
            else => {
                return .js_undefined;
            },
        }
    }

    pub fn onReaderError(this: *PipeReader, err: bun.sys.Error) void {
        if (this.state == .done) {
            bun.default_allocator.free(this.state.done);
        }
        this.state = .{ .err = err };
        if (this.process) |process|
            process.onCloseIO(this.kind(process));
    }

    pub fn close(this: *PipeReader) void {
        switch (this.state) {
            .pending => {
                this.reader.close();
            },
            .done => {},
            .err => {},
        }
    }

    pub fn eventLoop(this: *PipeReader) *JSC.EventLoop {
        return this.event_loop;
    }

    pub fn loop(this: *PipeReader) *uws.Loop {
        return this.event_loop.virtual_machine.uwsLoop();
    }

    fn deinit(this: *PipeReader) void {
        if (comptime Environment.isPosix) {
            bun.assert(this.reader.isDone());
        }

        if (comptime Environment.isWindows) {
            bun.assert(this.reader.source == null or this.reader.source.?.isClosed());
        }

        if (this.state == .done) {
            bun.default_allocator.free(this.state.done);
        }

        this.reader.deinit();
        bun.destroy(this);
    }
};

const Writable = union(enum) {
    pipe: *JSC.WebCore.FileSink,
    fd: bun.FileDescriptor,
    buffer: *StaticPipeWriter,
    memfd: bun.FileDescriptor,
    inherit: void,
    ignore: void,

    pub fn memoryCost(this: *const Writable) usize {
        return switch (this.*) {
            .pipe => |pipe| pipe.memoryCost(),
            .buffer => |buffer| buffer.memoryCost(),
            // TODO: memfd
            else => 0,
        };
    }

    pub fn hasPendingActivity(this: *const Writable) bool {
        return switch (this.*) {
            .pipe => false,

            // we mark them as .ignore when they are closed, so this must be true
            .buffer => true,
            else => false,
        };
    }

    pub fn ref(this: *Writable) void {
        switch (this.*) {
            .pipe => {
                this.pipe.updateRef(true);
            },
            .buffer => {
                this.buffer.updateRef(true);
            },
            else => {},
        }
    }

    pub fn unref(this: *Writable) void {
        switch (this.*) {
            .pipe => {
                this.pipe.updateRef(false);
            },
            .buffer => {
                this.buffer.updateRef(false);
            },
            else => {},
        }
    }

    // When the stream has closed we need to be notified to prevent a use-after-free
    // We can test for this use-after-free by enabling hot module reloading on a file and then saving it twice
    pub fn onClose(this: *Writable, _: ?bun.sys.Error) void {
        const process: *Subprocess = @fieldParentPtr("stdin", this);

        if (process.this_jsvalue != .zero) {
            if (js.stdinGetCached(process.this_jsvalue)) |existing_value| {
                JSC.WebCore.FileSink.JSSink.setDestroyCallback(existing_value, 0);
            }
        }

        switch (this.*) {
            .buffer => {
                this.buffer.deref();
            },
            .pipe => {
                this.pipe.deref();
            },
            else => {},
        }

        process.onStdinDestroyed();

        this.* = .{
            .ignore = {},
        };
    }
    pub fn onReady(_: *Writable, _: ?JSC.WebCore.Blob.SizeType, _: ?JSC.WebCore.Blob.SizeType) void {}
    pub fn onStart(_: *Writable) void {}

    pub fn init(
        stdio: Stdio,
        event_loop: *JSC.EventLoop,
        subprocess: *Subprocess,
        result: StdioResult,
    ) !Writable {
        assertStdioResult(result);

        if (Environment.isWindows) {
            switch (stdio) {
                .pipe => {
                    if (result == .buffer) {
                        const pipe = JSC.WebCore.FileSink.createWithPipe(event_loop, result.buffer);

                        switch (pipe.writer.startWithCurrentPipe()) {
                            .result => {},
                            .err => |err| {
                                _ = err; // autofix
                                pipe.deref();
                                return error.UnexpectedCreatingStdin;
                            },
                        }
                        pipe.writer.setParent(pipe);
                        subprocess.weak_file_sink_stdin_ptr = pipe;
                        subprocess.ref();
                        subprocess.flags.deref_on_stdin_destroyed = true;
                        subprocess.flags.has_stdin_destructor_called = false;

                        return Writable{
                            .pipe = pipe,
                        };
                    }
                    return Writable{ .inherit = {} };
                },

                .blob => |blob| {
                    return Writable{
                        .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .blob = blob }),
                    };
                },
                .array_buffer => |array_buffer| {
                    return Writable{
                        .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .array_buffer = array_buffer }),
                    };
                },
                .fd => |fd| {
                    return Writable{ .fd = fd };
                },
                .dup2 => |dup2| {
                    return Writable{ .fd = dup2.to.toFd() };
                },
                .inherit => {
                    return Writable{ .inherit = {} };
                },
                .memfd, .path, .ignore => {
                    return Writable{ .ignore = {} };
                },
                .ipc, .capture => {
                    return Writable{ .ignore = {} };
                },
            }
        }

        if (comptime Environment.isPosix) {
            if (stdio == .pipe) {
                _ = bun.sys.setNonblocking(result.?);
            }
        }

        switch (stdio) {
            .dup2 => @panic("TODO dup2 stdio"),
            .pipe => {
                const pipe = JSC.WebCore.FileSink.create(event_loop, result.?);

                switch (pipe.writer.start(pipe.fd, true)) {
                    .result => {},
                    .err => |err| {
                        _ = err; // autofix
                        pipe.deref();
                        return error.UnexpectedCreatingStdin;
                    },
                }

                subprocess.weak_file_sink_stdin_ptr = pipe;
                subprocess.ref();
                subprocess.flags.has_stdin_destructor_called = false;
                subprocess.flags.deref_on_stdin_destroyed = true;

                pipe.writer.handle.poll.flags.insert(.socket);

                return Writable{
                    .pipe = pipe,
                };
            },

            .blob => |blob| {
                return Writable{
                    .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .blob = blob }),
                };
            },
            .array_buffer => |array_buffer| {
                return Writable{
                    .buffer = StaticPipeWriter.create(event_loop, subprocess, result, .{ .array_buffer = array_buffer }),
                };
            },
            .memfd => |memfd| {
                bun.assert(memfd != bun.invalid_fd);
                return Writable{ .memfd = memfd };
            },
            .fd => {
                return Writable{ .fd = result.? };
            },
            .inherit => {
                return Writable{ .inherit = {} };
            },
            .path, .ignore => {
                return Writable{ .ignore = {} };
            },
            .ipc, .capture => {
                return Writable{ .ignore = {} };
            },
        }
    }

    pub fn toJS(this: *Writable, globalThis: *JSC.JSGlobalObject, subprocess: *Subprocess) JSValue {
        return switch (this.*) {
            .fd => |fd| fd.toJS(globalThis),
            .memfd, .ignore => .js_undefined,
            .buffer, .inherit => .js_undefined,
            .pipe => |pipe| {
                this.* = .{ .ignore = {} };
                if (subprocess.process.hasExited() and !subprocess.flags.has_stdin_destructor_called) {
                    // onAttachedProcessExit() can call deref on the
                    // subprocess. Since we never called ref(), it would be
                    // unbalanced to do so, leading to a use-after-free.
                    // So, let's not do that.
                    // https://github.com/oven-sh/bun/pull/14092
                    bun.debugAssert(!subprocess.flags.deref_on_stdin_destroyed);
                    const debug_ref_count = if (Environment.isDebug) subprocess.ref_count else 0;
                    pipe.onAttachedProcessExit();
                    if (Environment.isDebug) {
                        bun.debugAssert(subprocess.ref_count.active_counts == debug_ref_count.active_counts);
                    }
                    return pipe.toJS(globalThis);
                } else {
                    subprocess.flags.has_stdin_destructor_called = false;
                    subprocess.weak_file_sink_stdin_ptr = pipe;
                    subprocess.ref();
                    subprocess.flags.deref_on_stdin_destroyed = true;
                    if (@intFromPtr(pipe.signal.ptr) == @intFromPtr(subprocess)) {
                        pipe.signal.clear();
                    }
                    return pipe.toJSWithDestructor(
                        globalThis,
                        JSC.WebCore.Sink.DestructorPtr.init(subprocess),
                    );
                }
            },
        };
    }

    pub fn finalize(this: *Writable) void {
        const subprocess: *Subprocess = @fieldParentPtr("stdin", this);
        if (subprocess.this_jsvalue != .zero) {
            if (JSC.Codegen.JSSubprocess.stdinGetCached(subprocess.this_jsvalue)) |existing_value| {
                JSC.WebCore.FileSink.JSSink.setDestroyCallback(existing_value, 0);
            }
        }

        return switch (this.*) {
            .pipe => |pipe| {
                if (pipe.signal.ptr == @as(*anyopaque, @ptrCast(this))) {
                    pipe.signal.clear();
                }

                pipe.deref();

                this.* = .{ .ignore = {} };
            },
            .buffer => {
                this.buffer.updateRef(false);
                this.buffer.deref();
            },
            .memfd => |fd| {
                fd.close();
                this.* = .{ .ignore = {} };
            },
            .ignore => {},
            .fd, .inherit => {},
        };
    }

    pub fn close(this: *Writable) void {
        switch (this.*) {
            .pipe => |pipe| {
                _ = pipe.end(null);
            },
            .memfd => |fd| {
                fd.close();
                this.* = .{ .ignore = {} };
            },
            .fd => {
                this.* = .{ .ignore = {} };
            },
            .buffer => {
                this.buffer.close();
            },
            .ignore => {},
            .inherit => {},
        }
    }
};

pub fn memoryCost(this: *const Subprocess) usize {
    return @sizeOf(@This()) +
        this.process.memoryCost() +
        this.stdin.memoryCost() +
        this.stdout.memoryCost() +
        this.stderr.memoryCost();
}

fn consumeExitedPromise(this_jsvalue: JSValue, globalThis: *JSC.JSGlobalObject) ?JSValue {
    if (JSC.Codegen.JSSubprocess.exitedPromiseGetCached(this_jsvalue)) |promise| {
        JSC.Codegen.JSSubprocess.exitedPromiseSetCached(this_jsvalue, globalThis, .zero);
        return promise;
    }
    return null;
}

fn consumeOnExitCallback(this_jsvalue: JSValue, globalThis: *JSC.JSGlobalObject) ?JSValue {
    if (JSC.Codegen.JSSubprocess.onExitCallbackGetCached(this_jsvalue)) |callback| {
        JSC.Codegen.JSSubprocess.onExitCallbackSetCached(this_jsvalue, globalThis, .zero);
        return callback;
    }
    return null;
}

fn consumeOnDisconnectCallback(this_jsvalue: JSValue, globalThis: *JSC.JSGlobalObject) ?JSValue {
    if (JSC.Codegen.JSSubprocess.onDisconnectCallbackGetCached(this_jsvalue)) |callback| {
        JSC.Codegen.JSSubprocess.onDisconnectCallbackSetCached(this_jsvalue, globalThis, .zero);
        return callback;
    }
    return null;
}

pub fn onProcessExit(this: *Subprocess, process: *Process, status: bun.spawn.Status, rusage: *const Rusage) void {
    log("onProcessExit()", .{});
    const this_jsvalue = this.this_jsvalue;
    const globalThis = this.globalThis;
    const jsc_vm = globalThis.bunVM();
    this_jsvalue.ensureStillAlive();
    this.pid_rusage = rusage.*;
    const is_sync = this.flags.is_sync;
    this.clearAbortSignal();
    defer this.deref();
    defer this.disconnectIPC(true);

    if (this.event_loop_timer.state == .ACTIVE) {
        jsc_vm.timer.remove(&this.event_loop_timer);
    }
    this.setEventLoopTimerRefd(false);

    jsc_vm.onSubprocessExit(process);

    var stdin: ?*JSC.WebCore.FileSink = this.weak_file_sink_stdin_ptr;
    var existing_stdin_value = JSC.JSValue.zero;
    if (this_jsvalue != .zero) {
        if (JSC.Codegen.JSSubprocess.stdinGetCached(this_jsvalue)) |existing_value| {
            if (existing_stdin_value.isCell()) {
                if (stdin == null) {
                    // TODO: review this cast
                    stdin = @alignCast(@ptrCast(JSC.WebCore.FileSink.JSSink.fromJS(existing_value)));
                }

                existing_stdin_value = existing_value;
            }
        }
    }

    // We won't be sending any more data.
    if (this.stdin == .buffer) {
        this.stdin.buffer.close();
    }

    if (existing_stdin_value != .zero) {
        JSC.WebCore.FileSink.JSSink.setDestroyCallback(existing_stdin_value, 0);
    }

    if (this.flags.is_sync) {
        // This doesn't match Node.js' behavior, but for synchronous
        // subprocesses the streams should not keep the timers going.
        if (this.stdout == .pipe) {
            this.stdout.close();
        }

        if (this.stderr == .pipe) {
            this.stderr.close();
        }
    } else {
        // This matches Node.js behavior. Node calls resume() on the streams.
        if (this.stdout == .pipe and !this.stdout.pipe.reader.isDone()) {
            this.stdout.pipe.reader.read();
        }

        if (this.stderr == .pipe and !this.stderr.pipe.reader.isDone()) {
            this.stderr.pipe.reader.read();
        }
    }

    if (stdin) |pipe| {
        this.weak_file_sink_stdin_ptr = null;
        this.flags.has_stdin_destructor_called = true;
        // It is okay if it does call deref() here, as in that case it was truly ref'd.
        pipe.onAttachedProcessExit();
    }

    var did_update_has_pending_activity = false;
    defer if (!did_update_has_pending_activity) this.updateHasPendingActivity();

    const loop = jsc_vm.eventLoop();

    if (!is_sync) {
        if (this_jsvalue != .zero) {
            if (consumeExitedPromise(this_jsvalue, globalThis)) |promise| {
                loop.enter();
                defer loop.exit();

                if (!did_update_has_pending_activity) {
                    this.updateHasPendingActivity();
                    did_update_has_pending_activity = true;
                }

                switch (status) {
                    .exited => |exited| promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(exited.code)),
                    .err => |err| promise.asAnyPromise().?.reject(globalThis, err.toJSC(globalThis)),
                    .signaled => promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(128 +% @intFromEnum(status.signaled))),
                    else => {
                        // crash in debug mode
                        if (comptime Environment.allow_assert)
                            unreachable;
                    },
                }
            }

            if (consumeOnExitCallback(this_jsvalue, globalThis)) |callback| {
                const waitpid_value: JSValue =
                    if (status == .err)
                        status.err.toJSC(globalThis)
                    else
                        .js_undefined;

                const this_value: JSValue = if (this_jsvalue.isEmptyOrUndefinedOrNull()) .js_undefined else this_jsvalue;
                this_value.ensureStillAlive();

                const args = [_]JSValue{
                    this_value,
                    this.getExitCode(globalThis),
                    this.getSignalCode(globalThis),
                    waitpid_value,
                };

                if (!did_update_has_pending_activity) {
                    this.updateHasPendingActivity();
                    did_update_has_pending_activity = true;
                }

                loop.runCallback(
                    callback,
                    globalThis,
                    this_value,
                    &args,
                );
            }
        }
    }
}

fn closeIO(this: *Subprocess, comptime io: @Type(.enum_literal)) void {
    if (this.closed.contains(io)) return;
    this.closed.insert(io);

    // If you never referenced stdout/stderr, they won't be garbage collected.
    //
    // That means:
    //   1. We need to stop watching them
    //   2. We need to free the memory
    //   3. We need to halt any pending reads (1)

    if (!this.hasCalledGetter(io)) {
        @field(this, @tagName(io)).finalize();
    } else {
        @field(this, @tagName(io)).close();
    }
}

fn onPipeClose(this: *uv.Pipe) callconv(.C) void {
    // safely free the pipes
    bun.default_allocator.destroy(this);
}

// This must only be run once per Subprocess
pub fn finalizeStreams(this: *Subprocess) void {
    log("finalizeStreams", .{});
    this.closeProcess();

    this.closeIO(.stdin);
    this.closeIO(.stdout);
    this.closeIO(.stderr);

    close_stdio_pipes: {
        if (!this.observable_getters.contains(.stdio)) {
            break :close_stdio_pipes;
        }

        for (this.stdio_pipes.items) |item| {
            if (Environment.isWindows) {
                if (item == .buffer) {
                    item.buffer.close(onPipeClose);
                }
            } else {
                item.close();
            }
        }
        this.stdio_pipes.clearAndFree(bun.default_allocator);
    }
}

fn deinit(this: *Subprocess) void {
    log("deinit", .{});
    bun.destroy(this);
}

fn clearAbortSignal(this: *Subprocess) void {
    if (this.abort_signal) |signal| {
        this.abort_signal = null;
        signal.pendingActivityUnref();
        signal.cleanNativeBindings(this);
        signal.unref();
    }
}

pub fn finalize(this: *Subprocess) callconv(.C) void {
    log("finalize", .{});
    // Ensure any code which references the "this" value doesn't attempt to
    // access it after it's been freed We cannot call any methods which
    // access GC'd values during the finalizer
    this.this_jsvalue = .zero;

    this.clearAbortSignal();

    bun.assert(!this.hasPendingActivity() or JSC.VirtualMachine.get().isShuttingDown());
    this.finalizeStreams();

    this.process.detach();
    this.process.deref();

    if (this.event_loop_timer.state == .ACTIVE) {
        this.globalThis.bunVM().timer.remove(&this.event_loop_timer);
    }
    this.setEventLoopTimerRefd(false);

    MaxBuf.removeFromSubprocess(&this.stdout_maxbuf);
    MaxBuf.removeFromSubprocess(&this.stderr_maxbuf);

    if (this.ipc_data != null) {
        this.disconnectIPC(false);
    }

    this.flags.finalized = true;
    this.deref();
}

pub fn getExited(
    this: *Subprocess,
    this_value: JSValue,
    globalThis: *JSGlobalObject,
) JSValue {
    if (JSC.Codegen.JSSubprocess.exitedPromiseGetCached(this_value)) |promise| {
        return promise;
    }

    switch (this.process.status) {
        .exited => |exit| {
            return JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(exit.code));
        },
        .signaled => |signal| {
            return JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(signal.toExitCode() orelse 254));
        },
        .err => |err| {
            return JSC.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, err.toJSC(globalThis));
        },
        else => {
            const promise = JSC.JSPromise.create(globalThis).toJS();
            JSC.Codegen.JSSubprocess.exitedPromiseSetCached(this_value, globalThis, promise);
            return promise;
        },
    }
}

pub fn getExitCode(
    this: *Subprocess,
    _: *JSGlobalObject,
) JSValue {
    if (this.process.status == .exited) {
        return JSC.JSValue.jsNumber(this.process.status.exited.code);
    }
    return JSC.JSValue.jsNull();
}

pub fn getSignalCode(
    this: *Subprocess,
    global: *JSGlobalObject,
) JSValue {
    if (this.process.signalCode()) |signal| {
        if (signal.name()) |name|
            return JSC.ZigString.init(name).toJS(global)
        else
            return JSC.JSValue.jsNumber(@intFromEnum(signal));
    }

    return JSC.JSValue.jsNull();
}

pub fn spawn(globalThis: *JSC.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) bun.JSError!JSValue {
    return spawnMaybeSync(globalThis, args, secondaryArgsValue, false);
}

pub fn spawnSync(globalThis: *JSC.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) bun.JSError!JSValue {
    return spawnMaybeSync(globalThis, args, secondaryArgsValue, true);
}

extern "C" const BUN_DEFAULT_PATH_FOR_SPAWN: [*:0]const u8;

// This is split into a separate function to conserve stack space.
// On Windows, a single path buffer can take 64 KB.
fn getArgv0(globalThis: *JSC.JSGlobalObject, PATH: []const u8, cwd: []const u8, pretend_argv0: ?[*:0]const u8, first_cmd: JSValue, allocator: std.mem.Allocator) bun.JSError!struct {
    argv0: [:0]const u8,
    arg0: [:0]u8,
} {
    var arg0 = try first_cmd.toSliceOrNullWithAllocator(globalThis, allocator);
    defer arg0.deinit();
    // Heap allocate it to ensure we don't run out of stack space.
    const path_buf: *bun.PathBuffer = try bun.default_allocator.create(bun.PathBuffer);
    defer bun.default_allocator.destroy(path_buf);

    var actual_argv0: [:0]const u8 = "";

    const argv0_to_use: []const u8 = arg0.slice();

    // This mimicks libuv's behavior, which mimicks execvpe
    // Only resolve from $PATH when the command is not an absolute path
    const PATH_to_use: []const u8 = if (strings.containsChar(argv0_to_use, '/'))
        ""
        // If no $PATH is provided, we fallback to the one from environ
        // This is already the behavior of the PATH passed in here.
    else if (PATH.len > 0)
        PATH
    else if (comptime Environment.isPosix)
        // If the user explicitly passed an empty $PATH, we fallback to the OS-specific default (which libuv also does)
        bun.sliceTo(BUN_DEFAULT_PATH_FOR_SPAWN, 0)
    else
        "";

    if (PATH_to_use.len == 0) {
        actual_argv0 = try allocator.dupeZ(u8, argv0_to_use);
    } else {
        const resolved = which(path_buf, PATH_to_use, cwd, argv0_to_use) orelse {
            return throwCommandNotFound(globalThis, argv0_to_use);
        };
        actual_argv0 = try allocator.dupeZ(u8, resolved);
    }

    return .{
        .argv0 = actual_argv0,
        .arg0 = if (pretend_argv0) |p| try allocator.dupeZ(u8, bun.sliceTo(p, 0)) else try allocator.dupeZ(u8, arg0.slice()),
    };
}

fn getArgv(globalThis: *JSC.JSGlobalObject, args: JSValue, PATH: []const u8, cwd: []const u8, argv0: *?[*:0]const u8, allocator: std.mem.Allocator, argv: *std.ArrayList(?[*:0]const u8)) bun.JSError!void {
    var cmds_array = try args.arrayIterator(globalThis);
    // + 1 for argv0
    // + 1 for null terminator
    argv.* = try @TypeOf(argv.*).initCapacity(allocator, cmds_array.len + 2);

    if (args.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
    }

    if (cmds_array.len == 0) {
        return globalThis.throwInvalidArguments("cmd must not be empty", .{});
    }

    const argv0_result = try getArgv0(globalThis, PATH, cwd, argv0.*, (try cmds_array.next()).?, allocator);

    argv0.* = argv0_result.argv0.ptr;
    argv.appendAssumeCapacity(argv0_result.arg0.ptr);

    while (try cmds_array.next()) |value| {
        const arg = try value.toBunString(globalThis);
        defer arg.deref();

        argv.appendAssumeCapacity(try arg.toOwnedSliceZ(allocator));
    }

    if (argv.items.len == 0) {
        return globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
    }
}

pub fn spawnMaybeSync(
    globalThis: *JSC.JSGlobalObject,
    args_: JSValue,
    secondaryArgsValue: ?JSValue,
    comptime is_sync: bool,
) bun.JSError!JSValue {
    if (comptime is_sync) {
        // We skip this on Windows due to test failures.
        if (comptime !Environment.isWindows) {
            // Since the event loop is recursively called, we need to check if it's safe to recurse.
            if (!bun.StackCheck.init().isSafeToRecurse()) {
                globalThis.throwStackOverflow();
                return error.JSError;
            }
        }
    }

    var arena = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var override_env = false;
    var env_array = std.ArrayListUnmanaged(?[*:0]const u8){};
    var jsc_vm = globalThis.bunVM();

    var cwd = jsc_vm.transpiler.fs.top_level_dir;

    var stdio = [3]Stdio{
        .{ .ignore = {} },
        .{ .pipe = {} },
        .{ .inherit = {} },
    };

    if (comptime is_sync) {
        stdio[1] = .{ .pipe = {} };
        stdio[2] = .{ .pipe = {} };
    }
    var lazy = false;
    var on_exit_callback = JSValue.zero;
    var on_disconnect_callback = JSValue.zero;
    var PATH = jsc_vm.transpiler.env.get("PATH") orelse "";
    var argv = std.ArrayList(?[*:0]const u8).init(allocator);
    var cmd_value = JSValue.zero;
    var detached = false;
    var args = args_;
    var maybe_ipc_mode: if (is_sync) void else ?IPC.Mode = if (is_sync) {} else null;
    var ipc_callback: JSValue = .zero;
    var extra_fds = std.ArrayList(bun.spawn.SpawnOptions.Stdio).init(bun.default_allocator);
    var argv0: ?[*:0]const u8 = null;
    var ipc_channel: i32 = -1;
    var timeout: ?i32 = null;
    var killSignal: SignalCode = SignalCode.default;
    var maxBuffer: ?i64 = null;

    var windows_hide: bool = false;
    var windows_verbatim_arguments: bool = false;
    var abort_signal: ?*JSC.WebCore.AbortSignal = null;
    defer {
        // Ensure we clean it up on error.
        if (abort_signal) |signal| {
            signal.unref();
        }
    }

    {
        if (args.isEmptyOrUndefinedOrNull()) {
            return globalThis.throwInvalidArguments("cmd must be an array", .{});
        }

        const args_type = args.jsType();
        if (args_type.isArray()) {
            cmd_value = args;
            args = secondaryArgsValue orelse JSValue.zero;
        } else if (!args.isObject()) {
            return globalThis.throwInvalidArguments("cmd must be an array", .{});
        } else if (try args.getTruthy(globalThis, "cmd")) |cmd_value_| {
            cmd_value = cmd_value_;
        } else {
            return globalThis.throwInvalidArguments("cmd must be an array", .{});
        }

        if (args.isObject()) {
            if (try args.getTruthy(globalThis, "argv0")) |argv0_| {
                const argv0_str = try argv0_.getZigString(globalThis);
                if (argv0_str.len > 0) {
                    argv0 = try argv0_str.toOwnedSliceZ(allocator);
                }
            }

            // need to update `cwd` before searching for executable with `Which.which`
            if (try args.getTruthy(globalThis, "cwd")) |cwd_| {
                const cwd_str = try cwd_.getZigString(globalThis);
                if (cwd_str.len > 0) {
                    cwd = try cwd_str.toOwnedSliceZ(allocator);
                }
            }
        }

        if (args != .zero and args.isObject()) {
            // This must run before the stdio parsing happens
            if (!is_sync) {
                if (try args.getTruthy(globalThis, "ipc")) |val| {
                    if (val.isCell() and val.isCallable()) {
                        maybe_ipc_mode = ipc_mode: {
                            if (try args.getTruthy(globalThis, "serialization")) |mode_val| {
                                if (mode_val.isString()) {
                                    break :ipc_mode try IPC.Mode.fromJS(globalThis, mode_val) orelse {
                                        return globalThis.throwInvalidArguments("serialization must be \"json\" or \"advanced\"", .{});
                                    };
                                } else {
                                    if (!globalThis.hasException()) {
                                        return globalThis.throwInvalidArgumentType("spawn", "serialization", "string");
                                    }
                                    return .zero;
                                }
                            }
                            break :ipc_mode .advanced;
                        };

                        ipc_callback = val.withAsyncContextIfNeeded(globalThis);
                    }
                }
            }

            if (try args.getTruthy(globalThis, "signal")) |signal_val| {
                if (signal_val.as(JSC.WebCore.AbortSignal)) |signal| {
                    abort_signal = signal.ref();
                } else {
                    return globalThis.throwInvalidArgumentTypeValue("signal", "AbortSignal", signal_val);
                }
            }

            if (try args.getTruthy(globalThis, "onDisconnect")) |onDisconnect_| {
                if (!onDisconnect_.isCell() or !onDisconnect_.isCallable()) {
                    return globalThis.throwInvalidArguments("onDisconnect must be a function or undefined", .{});
                }

                on_disconnect_callback = if (comptime is_sync)
                    onDisconnect_
                else
                    onDisconnect_.withAsyncContextIfNeeded(globalThis);
            }

            if (try args.getTruthy(globalThis, "onExit")) |onExit_| {
                if (!onExit_.isCell() or !onExit_.isCallable()) {
                    return globalThis.throwInvalidArguments("onExit must be a function or undefined", .{});
                }

                on_exit_callback = if (comptime is_sync)
                    onExit_
                else
                    onExit_.withAsyncContextIfNeeded(globalThis);
            }

            if (try args.getTruthy(globalThis, "env")) |env_arg| {
                env_arg.ensureStillAlive();
                const object = env_arg.getObject() orelse {
                    return globalThis.throwInvalidArguments("env must be an object", .{});
                };

                override_env = true;
                // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                var NEW_PATH: []const u8 = "";
                var envp_managed = env_array.toManaged(allocator);
                try appendEnvpFromJS(globalThis, object, &envp_managed, &NEW_PATH);
                env_array = envp_managed.moveToUnmanaged();
                PATH = NEW_PATH;
            }

            try getArgv(globalThis, cmd_value, PATH, cwd, &argv0, allocator, &argv);

            if (try args.get(globalThis, "stdio")) |stdio_val| {
                if (!stdio_val.isEmptyOrUndefinedOrNull()) {
                    if (stdio_val.jsType().isArray()) {
                        var stdio_iter = try stdio_val.arrayIterator(globalThis);
                        var i: u31 = 0;
                        while (try stdio_iter.next()) |value| : (i += 1) {
                            try stdio[i].extract(globalThis, i, value);
                            if (i == 2)
                                break;
                        }
                        i += 1;

                        while (try stdio_iter.next()) |value| : (i += 1) {
                            var new_item: Stdio = undefined;
                            try new_item.extract(globalThis, i, value);

                            const opt = switch (new_item.asSpawnOption(i)) {
                                .result => |opt| opt,
                                .err => |e| {
                                    return e.throwJS(globalThis);
                                },
                            };
                            if (opt == .ipc) {
                                ipc_channel = @intCast(extra_fds.items.len);
                            }
                            try extra_fds.append(opt);
                        }
                    } else {
                        return globalThis.throwInvalidArguments("stdio must be an array", .{});
                    }
                }
            } else {
                if (try args.get(globalThis, "stdin")) |value| {
                    try stdio[0].extract(globalThis, 0, value);
                }

                if (try args.get(globalThis, "stderr")) |value| {
                    try stdio[2].extract(globalThis, 2, value);
                }

                if (try args.get(globalThis, "stdout")) |value| {
                    try stdio[1].extract(globalThis, 1, value);
                }
            }

            if (comptime !is_sync) {
                if (try args.get(globalThis, "lazy")) |lazy_val| {
                    if (lazy_val.isBoolean()) {
                        lazy = lazy_val.toBoolean();
                    }
                }
            }

            if (try args.get(globalThis, "detached")) |detached_val| {
                if (detached_val.isBoolean()) {
                    detached = detached_val.toBoolean();
                }
            }

            if (Environment.isWindows) {
                if (try args.get(globalThis, "windowsHide")) |val| {
                    if (val.isBoolean()) {
                        windows_hide = val.asBoolean();
                    }
                }

                if (try args.get(globalThis, "windowsVerbatimArguments")) |val| {
                    if (val.isBoolean()) {
                        windows_verbatim_arguments = val.asBoolean();
                    }
                }
            }

            if (try args.get(globalThis, "timeout")) |timeout_value| brk: {
                if (timeout_value != .null) {
                    if (timeout_value.isNumber() and std.math.isPositiveInf(timeout_value.asNumber())) {
                        break :brk;
                    }

                    const timeout_int = try globalThis.validateIntegerRange(timeout_value, u64, 0, .{ .min = 0, .field_name = "timeout" });
                    if (timeout_int > 0)
                        timeout = @intCast(@as(u31, @truncate(timeout_int)));
                }
            }

            if (try args.get(globalThis, "killSignal")) |val| {
                killSignal = try parseSignal(val, globalThis);
            }

            if (try args.get(globalThis, "maxBuffer")) |val| {
                if (val.isNumber() and val.isFinite()) { // 'Infinity' does not set maxBuffer
                    const value = val.coerce(i64, globalThis);
                    if (value > 0) {
                        maxBuffer = value;
                    }
                }
            }
        } else {
            try getArgv(globalThis, cmd_value, PATH, cwd, &argv0, allocator, &argv);
        }
    }

    log("spawn maxBuffer: {?d}", .{maxBuffer});

    if (!override_env and env_array.items.len == 0) {
        env_array.items = jsc_vm.transpiler.env.map.createNullDelimitedEnvMap(allocator) catch |err| return globalThis.throwError(err, "in Bun.spawn") catch return .zero;
        env_array.capacity = env_array.items.len;
    }

    inline for (0..stdio.len) |fd_index| {
        if (stdio[fd_index].canUseMemfd(is_sync, fd_index > 0 and maxBuffer != null)) {
            if (stdio[fd_index].useMemfd(fd_index)) {
                jsc_vm.counters.mark(.spawn_memfd);
            }
        }
    }
    var should_close_memfd = Environment.isLinux;

    defer {
        if (should_close_memfd) {
            inline for (0..stdio.len) |fd_index| {
                if (stdio[fd_index] == .memfd) {
                    stdio[fd_index].memfd.close();
                    stdio[fd_index] = .ignore;
                }
            }
        }
    }
    //"NODE_CHANNEL_FD=" is 16 bytes long, 15 bytes for the number, and 1 byte for the null terminator should be enough/safe
    var ipc_env_buf: [32]u8 = undefined;
    if (!is_sync) if (maybe_ipc_mode) |ipc_mode| {
        // IPC is currently implemented in a very limited way.
        //
        // Node lets you pass as many fds as you want, they all become be sockets; then, IPC is just a special
        // runtime-owned version of "pipe" (in which pipe is a misleading name since they're bidirectional sockets).
        //
        // Bun currently only supports three fds: stdin, stdout, and stderr, which are all unidirectional
        //
        // And then one fd is assigned specifically and only for IPC. If the user dont specify it, we add one (default: 3).
        //
        // When Bun.spawn() is given an `.ipc` callback, it enables IPC as follows:
        env_array.ensureUnusedCapacity(allocator, 3) catch |err| return globalThis.throwError(err, "in Bun.spawn") catch return .zero;
        const ipc_fd: i32 = brk: {
            if (ipc_channel == -1) {
                // If the user didn't specify an IPC channel, we need to add one
                ipc_channel = @intCast(extra_fds.items.len);
                var ipc_extra_fd_default = Stdio{ .ipc = {} };
                const fd: i32 = ipc_channel + 3;
                switch (ipc_extra_fd_default.asSpawnOption(fd)) {
                    .result => |opt| {
                        try extra_fds.append(opt);
                    },
                    .err => |e| {
                        return e.throwJS(globalThis);
                    },
                }
                break :brk fd;
            } else {
                break :brk @intCast(ipc_channel + 3);
            }
        };

        const pipe_env = std.fmt.bufPrintZ(
            &ipc_env_buf,
            "NODE_CHANNEL_FD={d}",
            .{ipc_fd},
        ) catch {
            return globalThis.throwOutOfMemory();
        };
        env_array.appendAssumeCapacity(pipe_env);

        env_array.appendAssumeCapacity(switch (ipc_mode) {
            inline else => |t| "NODE_CHANNEL_SERIALIZATION_MODE=" ++ @tagName(t),
        });
    };

    try env_array.append(allocator, null);
    try argv.append(null);

    if (comptime is_sync) {
        for (&stdio, 0..) |*io, i| {
            io.toSync(@truncate(i));
        }
    }

    // If the whole thread is supposed to do absolutely nothing while waiting,
    // we can block the thread which reduces CPU usage.
    //
    // That means:
    // - No maximum buffer
    // - No timeout
    // - No abort signal
    // - No stdin, stdout, stderr pipes
    // - No extra fds
    // - No auto killer (for tests)
    // - No execution time limit (for tests)
    // - No IPC
    // - No inspector (since they might want to press pause or step)
    const can_block_entire_thread_to_reduce_cpu_usage_in_fast_path = (comptime Environment.isPosix and is_sync) and
        abort_signal == null and
        timeout == null and
        maxBuffer == null and
        !stdio[0].isPiped() and
        !stdio[1].isPiped() and
        !stdio[2].isPiped() and
        extra_fds.items.len == 0 and
        !jsc_vm.auto_killer.enabled and
        !jsc_vm.jsc.hasExecutionTimeLimit() and
        !jsc_vm.isInspectorEnabled() and
        !bun.getRuntimeFeatureFlag(.BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH);

    const spawn_options = bun.spawn.SpawnOptions{
        .cwd = cwd,
        .detached = detached,
        .stdin = switch (stdio[0].asSpawnOption(0)) {
            .result => |opt| opt,
            .err => |e| return e.throwJS(globalThis),
        },
        .stdout = switch (stdio[1].asSpawnOption(1)) {
            .result => |opt| opt,
            .err => |e| return e.throwJS(globalThis),
        },
        .stderr = switch (stdio[2].asSpawnOption(2)) {
            .result => |opt| opt,
            .err => |e| return e.throwJS(globalThis),
        },
        .extra_fds = extra_fds.items,
        .argv0 = argv0,
        .can_block_entire_thread_to_reduce_cpu_usage_in_fast_path = can_block_entire_thread_to_reduce_cpu_usage_in_fast_path,

        .windows = if (Environment.isWindows) .{
            .hide_window = windows_hide,
            .verbatim_arguments = windows_verbatim_arguments,
            .loop = JSC.EventLoopHandle.init(jsc_vm),
        },
    };

    var spawned = switch (bun.spawn.spawnProcess(
        &spawn_options,
        @ptrCast(argv.items.ptr),
        @ptrCast(env_array.items.ptr),
    ) catch |err| switch (err) {
        error.EMFILE, error.ENFILE => {
            spawn_options.deinit();
            const display_path: [:0]const u8 = if (argv.items.len > 0 and argv.items[0] != null)
                std.mem.sliceTo(argv.items[0].?, 0)
            else
                "";
            var systemerror = bun.sys.Error.fromCode(if (err == error.EMFILE) .MFILE else .NFILE, .posix_spawn).withPath(display_path).toSystemError();
            systemerror.errno = if (err == error.EMFILE) -bun.sys.UV_E.MFILE else -bun.sys.UV_E.NFILE;
            return globalThis.throwValue(systemerror.toErrorInstance(globalThis));
        },
        else => {
            spawn_options.deinit();
            return globalThis.throwError(err, ": failed to spawn process") catch return .zero;
        },
    }) {
        .err => |err| {
            spawn_options.deinit();
            switch (err.getErrno()) {
                .ACCES, .NOENT, .PERM, .ISDIR, .NOTDIR => |errno| {
                    const display_path: [:0]const u8 = if (argv.items.len > 0 and argv.items[0] != null)
                        std.mem.sliceTo(argv.items[0].?, 0)
                    else
                        "";
                    if (display_path.len > 0) {
                        var systemerror = err.withPath(display_path).toSystemError();
                        if (errno == .NOENT) systemerror.errno = -bun.sys.UV_E.NOENT;
                        return globalThis.throwValue(systemerror.toErrorInstance(globalThis));
                    }
                },
                else => {},
            }

            return globalThis.throwValue(err.toJSC(globalThis));
        },
        .result => |result| result,
    };

    const loop = jsc_vm.eventLoop();

    const process = spawned.toProcess(loop, is_sync);

    var subprocess = bun.new(Subprocess, .{
        .ref_count = .init(),
        .globalThis = globalThis,
        .process = process,
        .pid_rusage = null,
        .stdin = .{ .ignore = {} },
        .stdout = .{ .ignore = {} },
        .stderr = .{ .ignore = {} },
        .stdio_pipes = .{},
        .ipc_data = null,
        .flags = .{
            .is_sync = is_sync,
        },
        .killSignal = undefined,
    });

    const posix_ipc_fd = if (Environment.isPosix and !is_sync and maybe_ipc_mode != null)
        spawned.extra_pipes.items[@intCast(ipc_channel)]
    else
        bun.invalid_fd;

    MaxBuf.createForSubprocess(subprocess, &subprocess.stderr_maxbuf, maxBuffer);
    MaxBuf.createForSubprocess(subprocess, &subprocess.stdout_maxbuf, maxBuffer);

    // When run synchronously, subprocess isn't garbage collected
    subprocess.* = Subprocess{
        .globalThis = globalThis,
        .process = process,
        .pid_rusage = null,
        .stdin = Writable.init(
            stdio[0],
            loop,
            subprocess,
            spawned.stdin,
        ) catch {
            subprocess.deref();
            return globalThis.throwOutOfMemory();
        },
        .stdout = Readable.init(
            stdio[1],
            loop,
            subprocess,
            spawned.stdout,
            jsc_vm.allocator,
            subprocess.stdout_maxbuf,
            is_sync,
        ),
        .stderr = Readable.init(
            stdio[2],
            loop,
            subprocess,
            spawned.stderr,
            jsc_vm.allocator,
            subprocess.stderr_maxbuf,
            is_sync,
        ),
        // 1. JavaScript.
        // 2. Process.
        .ref_count = .initExactRefs(2),
        .stdio_pipes = spawned.extra_pipes.moveToUnmanaged(),
        .ipc_data = if (!is_sync and comptime Environment.isWindows)
            if (maybe_ipc_mode) |ipc_mode| ( //
                .init(ipc_mode, .{ .subprocess = subprocess }, .uninitialized) //
            ) else null
        else
            null,

        .flags = .{
            .is_sync = is_sync,
        },
        .killSignal = killSignal,
        .stderr_maxbuf = subprocess.stderr_maxbuf,
        .stdout_maxbuf = subprocess.stdout_maxbuf,
    };

    subprocess.process.setExitHandler(subprocess);

    var posix_ipc_info: if (Environment.isPosix) IPC.Socket else void = undefined;
    if (Environment.isPosix and !is_sync) {
        if (maybe_ipc_mode) |mode| {
            if (uws.us_socket_t.fromFd(
                jsc_vm.rareData().spawnIPCContext(jsc_vm),
                @sizeOf(*IPC.SendQueue),
                posix_ipc_fd.cast(),
                1,
            )) |socket| {
                subprocess.ipc_data = .init(mode, .{ .subprocess = subprocess }, .uninitialized);
                posix_ipc_info = IPC.Socket.from(socket);
            }
        }
    }

    if (subprocess.ipc_data) |*ipc_data| {
        if (Environment.isPosix) {
            if (posix_ipc_info.ext(*IPC.SendQueue)) |ctx| {
                ctx.* = &subprocess.ipc_data.?;
                subprocess.ipc_data.?.socket = .{ .open = posix_ipc_info };
            }
        } else {
            if (ipc_data.windowsConfigureServer(
                subprocess.stdio_pipes.items[@intCast(ipc_channel)].buffer,
            ).asErr()) |err| {
                subprocess.deref();
                return globalThis.throwValue(err.toJSC(globalThis));
            }
            subprocess.stdio_pipes.items[@intCast(ipc_channel)] = .unavailable;
        }
        ipc_data.writeVersionPacket(globalThis);
    }

    if (subprocess.stdin == .pipe) {
        subprocess.stdin.pipe.signal = JSC.WebCore.streams.Signal.init(&subprocess.stdin);
    }

    const out = if (comptime !is_sync)
        subprocess.toJS(globalThis)
    else
        JSValue.zero;
    subprocess.this_jsvalue = out;

    var send_exit_notification = false;

    // This must go before other things happen so that the exit handler is registered before onProcessExit can potentially be called.
    if (timeout) |timeout_val| {
        subprocess.event_loop_timer.next = bun.timespec.msFromNow(timeout_val);
        globalThis.bunVM().timer.insert(&subprocess.event_loop_timer);
        subprocess.setEventLoopTimerRefd(true);
    }

    if (comptime !is_sync) {
        bun.debugAssert(out != .zero);

        if (on_exit_callback.isCell()) {
            JSC.Codegen.JSSubprocess.onExitCallbackSetCached(out, globalThis, on_exit_callback);
        }
        if (on_disconnect_callback.isCell()) {
            JSC.Codegen.JSSubprocess.onDisconnectCallbackSetCached(out, globalThis, on_disconnect_callback);
        }
        if (ipc_callback.isCell()) {
            JSC.Codegen.JSSubprocess.ipcCallbackSetCached(out, globalThis, ipc_callback);
        }

        switch (subprocess.process.watch()) {
            .result => {},
            .err => {
                send_exit_notification = true;
                lazy = false;
            },
        }
    }

    defer {
        if (send_exit_notification) {
            if (subprocess.process.hasExited()) {
                // process has already exited, we called wait4(), but we did not call onProcessExit()
                subprocess.process.onExit(subprocess.process.status, &std.mem.zeroes(Rusage));
            } else {
                // process has already exited, but we haven't called wait4() yet
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                subprocess.process.wait(is_sync);
            }
        }
    }

    if (subprocess.stdin == .buffer) {
        subprocess.stdin.buffer.start().assert();
    }

    if (subprocess.stdout == .pipe) {
        subprocess.stdout.pipe.start(subprocess, loop).assert();
        if ((is_sync or !lazy) and subprocess.stdout == .pipe) {
            subprocess.stdout.pipe.readAll();
        }
    }

    if (subprocess.stderr == .pipe) {
        subprocess.stderr.pipe.start(subprocess, loop).assert();

        if ((is_sync or !lazy) and subprocess.stderr == .pipe) {
            subprocess.stderr.pipe.readAll();
        }
    }

    should_close_memfd = false;

    if (comptime !is_sync) {
        // Once everything is set up, we can add the abort listener
        // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
        // Therefore, we must do this at the very end.
        if (abort_signal) |signal| {
            signal.pendingActivityRef();
            subprocess.abort_signal = signal.addListener(subprocess, onAbortSignal);
            abort_signal = null;
        }
        if (!subprocess.process.hasExited()) {
            jsc_vm.onSubprocessSpawn(subprocess.process);
        }
        return out;
    }

    comptime bun.assert(is_sync);

    if (can_block_entire_thread_to_reduce_cpu_usage_in_fast_path) {
        jsc_vm.counters.mark(.spawnSync_blocking);
        const debug_timer = Output.DebugTimer.start();
        subprocess.process.wait(true);
        log("spawnSync fast path took {}", .{debug_timer});

        // watchOrReap will handle the already exited case for us.
    }

    switch (subprocess.process.watchOrReap()) {
        .result => {
            // Once everything is set up, we can add the abort listener
            // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
            // Therefore, we must do this at the very end.
            if (abort_signal) |signal| {
                signal.pendingActivityRef();
                subprocess.abort_signal = signal.addListener(subprocess, onAbortSignal);
                abort_signal = null;
            }
        },
        .err => {
            subprocess.process.wait(true);
        },
    }

    if (!subprocess.process.hasExited()) {
        jsc_vm.onSubprocessSpawn(subprocess.process);
    }

    // We cannot release heap access while JS is running
    {
        const old_vm = jsc_vm.uwsLoop().internal_loop_data.jsc_vm;
        jsc_vm.uwsLoop().internal_loop_data.jsc_vm = null;
        defer {
            jsc_vm.uwsLoop().internal_loop_data.jsc_vm = old_vm;
        }
        while (subprocess.hasPendingActivityNonThreadsafe()) {
            if (subprocess.stdin == .buffer) {
                subprocess.stdin.buffer.watch();
            }

            if (subprocess.stderr == .pipe) {
                subprocess.stderr.pipe.watch();
            }

            if (subprocess.stdout == .pipe) {
                subprocess.stdout.pipe.watch();
            }

            jsc_vm.tick();
            jsc_vm.eventLoop().autoTick();
        }
    }

    subprocess.updateHasPendingActivity();

    const signalCode = subprocess.getSignalCode(globalThis);
    const exitCode = subprocess.getExitCode(globalThis);
    const stdout = try subprocess.stdout.toBufferedValue(globalThis);
    const stderr = try subprocess.stderr.toBufferedValue(globalThis);
    const resource_usage: JSValue = if (!globalThis.hasException()) subprocess.createResourceUsageObject(globalThis) else .zero;
    const exitedDueToTimeout = subprocess.event_loop_timer.state == .FIRED;
    const exitedDueToMaxBuffer = subprocess.exited_due_to_maxbuf;
    const resultPid = JSC.JSValue.jsNumberFromInt32(subprocess.pid());
    subprocess.finalize();

    if (globalThis.hasException()) {
        // e.g. a termination exception.
        return .zero;
    }

    const sync_value = JSC.JSValue.createEmptyObject(globalThis, 5 + @as(usize, @intFromBool(!signalCode.isEmptyOrUndefinedOrNull())));
    sync_value.put(globalThis, JSC.ZigString.static("exitCode"), exitCode);
    if (!signalCode.isEmptyOrUndefinedOrNull()) {
        sync_value.put(globalThis, JSC.ZigString.static("signalCode"), signalCode);
    }
    sync_value.put(globalThis, JSC.ZigString.static("stdout"), stdout);
    sync_value.put(globalThis, JSC.ZigString.static("stderr"), stderr);
    sync_value.put(globalThis, JSC.ZigString.static("success"), JSValue.jsBoolean(exitCode.isInt32() and exitCode.asInt32() == 0));
    sync_value.put(globalThis, JSC.ZigString.static("resourceUsage"), resource_usage);
    if (timeout != null) sync_value.put(globalThis, JSC.ZigString.static("exitedDueToTimeout"), if (exitedDueToTimeout) JSC.JSValue.true else JSC.JSValue.false);
    if (maxBuffer != null) sync_value.put(globalThis, JSC.ZigString.static("exitedDueToMaxBuffer"), if (exitedDueToMaxBuffer != null) JSC.JSValue.true else JSC.JSValue.false);
    sync_value.put(globalThis, JSC.ZigString.static("pid"), resultPid);

    return sync_value;
}

fn throwCommandNotFound(globalThis: *JSC.JSGlobalObject, command: []const u8) bun.JSError {
    const err = JSC.SystemError{
        .message = bun.String.createFormat("Executable not found in $PATH: \"{s}\"", .{command}) catch bun.outOfMemory(),
        .code = bun.String.static("ENOENT"),
        .errno = -bun.sys.UV_E.NOENT,
        .path = bun.String.createUTF8(command),
    };
    return globalThis.throwValue(err.toErrorInstance(globalThis));
}

const node_cluster_binding = @import("./../../node/node_cluster_binding.zig");

pub fn handleIPCMessage(
    this: *Subprocess,
    message: IPC.DecodedIPCMessage,
    handle: JSC.JSValue,
) void {
    IPClog("Subprocess#handleIPCMessage", .{});
    switch (message) {
        // In future versions we can read this in order to detect version mismatches,
        // or disable future optimizations if the subprocess is old.
        .version => |v| {
            IPC.log("Child IPC version is {d}", .{v});
        },
        .data => |data| {
            IPC.log("Received IPC message from child", .{});
            const this_jsvalue = this.this_jsvalue;
            defer this_jsvalue.ensureStillAlive();
            if (this_jsvalue != .zero) {
                if (JSC.Codegen.JSSubprocess.ipcCallbackGetCached(this_jsvalue)) |cb| {
                    const globalThis = this.globalThis;
                    globalThis.bunVM().eventLoop().runCallback(
                        cb,
                        globalThis,
                        this_jsvalue,
                        &[_]JSValue{ data, this_jsvalue, handle },
                    );
                }
            }
        },
        .internal => |data| {
            IPC.log("Received IPC internal message from child", .{});
            node_cluster_binding.handleInternalMessagePrimary(this.globalThis, this, data) catch {};
        },
    }
}

pub fn handleIPCClose(this: *Subprocess) void {
    IPClog("Subprocess#handleIPCClose", .{});
    const this_jsvalue = this.this_jsvalue;
    defer this_jsvalue.ensureStillAlive();
    const globalThis = this.globalThis;
    this.updateHasPendingActivity();

    if (this_jsvalue != .zero) {
        // Avoid keeping the callback alive longer than necessary
        JSC.Codegen.JSSubprocess.ipcCallbackSetCached(this_jsvalue, globalThis, .zero);

        // Call the onDisconnectCallback if it exists and prevent it from being kept alive longer than necessary
        if (consumeOnDisconnectCallback(this_jsvalue, globalThis)) |callback| {
            globalThis.bunVM().eventLoop().runCallback(callback, globalThis, this_jsvalue, &.{JSValue.jsBoolean(true)});
        }
    }
}

pub fn ipc(this: *Subprocess) ?*IPC.SendQueue {
    return &(this.ipc_data orelse return null);
}
pub fn getGlobalThis(this: *Subprocess) ?*JSC.JSGlobalObject {
    return this.globalThis;
}

const default_allocator = bun.default_allocator;
const bun = @import("bun");
const Environment = bun.Environment;

const strings = bun.strings;
const string = bun.string;
const Output = bun.Output;
const CowString = bun.ptr.CowString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = bun.JSC;
const webcore = bun.webcore;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const which = bun.which;
const Async = bun.Async;
const IPC = @import("../../ipc.zig");
const uws = bun.uws;
const windows = bun.windows;
const uv = windows.libuv;
const IPClog = Output.scoped(.IPC, false);

const PosixSpawn = bun.spawn;
const Rusage = bun.spawn.Rusage;
const Process = bun.spawn.Process;
const Stdio = bun.spawn.Stdio;
const StdioResult = if (Environment.isWindows) bun.spawn.WindowsSpawnResult.StdioResult else ?bun.FileDescriptor;

const Subprocess = @This();
pub const MaxBuf = bun.io.MaxBuf;
