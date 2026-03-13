//! The Subprocess object is returned by `Bun.spawn`. This file also holds the
//! code for `Bun.spawnSync`

const Subprocess = @This();

pub const js = jsc.Codegen.JSSubprocess;
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

/// Terminal attached to this subprocess (if spawned with terminal option)
terminal: ?*Terminal = null,

globalThis: *jsc.JSGlobalObject,
observable_getters: std.enums.EnumSet(enum {
    stdin,
    stdout,
    stderr,
    stdio,
}) = .{},
closed: std.enums.EnumSet(StdioKind) = .{},
this_value: jsc.JSRef = jsc.JSRef.empty(),

/// `null` indicates all of the IPC data is uninitialized.
ipc_data: ?IPC.SendQueue,
flags: Flags = .{},

weak_file_sink_stdin_ptr: ?*jsc.WebCore.FileSink = null,
abort_signal: ?*webcore.AbortSignal = null,

event_loop_timer_refd: bool = false,
event_loop_timer: bun.api.Timer.EventLoopTimer = .{
    .tag = .SubprocessTimeout,
    .next = .epoch,
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
    is_stdin_a_readable_stream: bool = false,
    _: u2 = 0,
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

pub const ResourceUsage = @import("./subprocess/ResourceUsage.zig");

const log = Output.scoped(.Subprocess, .visible);
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

pub fn onAbortSignal(subprocess_ctx: ?*anyopaque, _: jsc.JSValue) callconv(.c) void {
    var this: *Subprocess = @ptrCast(@alignCast(subprocess_ctx.?));
    this.clearAbortSignal();
    _ = this.tryKill(this.killSignal);
}

pub fn resourceUsage(
    this: *Subprocess,
    globalObject: *JSGlobalObject,
    _: *jsc.CallFrame,
) bun.JSError!JSValue {
    return this.createResourceUsageObject(globalObject);
}

pub fn createResourceUsageObject(this: *Subprocess, globalObject: *JSGlobalObject) bun.JSError!JSValue {
    return ResourceUsage.create(
        brk: {
            if (this.pid_rusage != null) {
                break :brk &this.pid_rusage.?;
            }

            if (Environment.isWindows) {
                if (this.process.poller == .uv) {
                    this.pid_rusage = PosixSpawn.process.uv_getrusage(&this.process.poller.uv);
                    break :brk &this.pid_rusage.?;
                }
            }

            return .js_undefined;
        },
        globalObject,
    );
}

pub fn hasExited(this: *const Subprocess) bool {
    return this.process.hasExited();
}

pub fn computeHasPendingActivity(this: *const Subprocess) bool {
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
    if (this.flags.is_sync) return;

    const has_pending = this.computeHasPendingActivity();
    if (comptime Environment.isDebug) {
        log("updateHasPendingActivity() -> {}", .{has_pending});
    }

    // Upgrade or downgrade the reference based on pending activity
    if (has_pending) {
        this.this_value.upgrade(this.globalThis);
    } else {
        this.this_value.downgrade();
    }
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

pub fn constructor(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!*Subprocess {
    return globalObject.throw("Cannot construct Subprocess", .{});
}

pub const PipeReader = @import("./subprocess/SubprocessPipeReader.zig");
pub const Readable = @import("./subprocess/Readable.zig").Readable;

pub fn getStderr(this: *Subprocess, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    // When terminal is used, stderr goes through the terminal
    if (this.terminal != null) {
        return .null;
    }
    this.observable_getters.insert(.stderr);
    return this.stderr.toJS(globalThis, this.hasExited());
}

pub fn getStdin(this: *Subprocess, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    // When terminal is used, stdin goes through the terminal
    if (this.terminal != null) {
        return .null;
    }
    this.observable_getters.insert(.stdin);
    return this.stdin.toJS(globalThis, this);
}

pub fn getStdout(this: *Subprocess, globalThis: *JSGlobalObject) bun.JSError!JSValue {
    // When terminal is used, stdout goes through the terminal
    if (this.terminal != null) {
        return .null;
    }
    this.observable_getters.insert(.stdout);
    // NOTE: ownership of internal buffers is transferred to the JSValue, which
    // gets cached on JSSubprocess (created via bindgen). This makes it
    // re-accessable to JS code but not via `this.stdout`, which is now `.closed`.
    return this.stdout.toJS(globalThis, this.hasExited());
}

pub fn getTerminal(this: *Subprocess, globalThis: *JSGlobalObject) JSValue {
    if (this.terminal) |terminal| {
        return terminal.toJS(globalThis);
    }
    return .js_undefined;
}

pub fn asyncDispose(this: *Subprocess, global: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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
            return global.throwValue(try err.toJS(global));
        },
    }

    return this.getExited(this_jsvalue, global);
}

pub fn setEventLoopTimerRefd(this: *Subprocess, refd: bool) void {
    if (this.event_loop_timer_refd == refd) return;
    this.event_loop_timer_refd = refd;
    if (refd) {
        this.globalThis.bunVM().timer.incrementTimerRef(1);
    } else {
        this.globalThis.bunVM().timer.incrementTimerRef(-1);
    }
}

pub fn timeoutCallback(this: *Subprocess) void {
    this.setEventLoopTimerRefd(false);
    if (this.event_loop_timer.state == .CANCELLED) return;
    if (this.hasExited()) {
        this.event_loop_timer.state = .CANCELLED;
        return;
    }
    this.event_loop_timer.state = .FIRED;
    _ = this.tryKill(this.killSignal);
}

pub fn onMaxBuffer(this: *Subprocess, kind: MaxBuf.Kind) void {
    this.exited_due_to_maxbuf = kind;
    _ = this.tryKill(this.killSignal);
}

pub fn kill(
    this: *Subprocess,
    globalThis: *JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!JSValue {
    // Safe: this method can only be called while the object is alive (reachable from JS)
    // The finalizer only runs when the object becomes unreachable
    this.this_value.update(globalThis, callframe.this());

    const arguments = callframe.arguments_old(1);
    // If signal is 0, then no actual signal is sent, but error checking
    // is still performed.
    const sig: SignalCode = try bun.SignalCode.fromJS(arguments.ptr[0], globalThis);

    if (globalThis.hasException()) return .zero;

    switch (this.tryKill(sig)) {
        .result => {},
        .err => |err| {
            // EINVAL or ENOSYS means the signal is not supported in the current platform (most likely unsupported on windows)
            return globalThis.throwValue(try err.toJS(globalThis));
        },
    }

    return .js_undefined;
}

pub fn hasKilled(this: *const Subprocess) bool {
    return this.process.hasKilled();
}

pub fn tryKill(this: *Subprocess, sig: SignalCode) bun.sys.Maybe(void) {
    if (this.hasExited()) {
        return .success;
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

pub fn doRef(this: *Subprocess, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
    this.jsRef();
    return .js_undefined;
}

pub fn doUnref(this: *Subprocess, _: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!JSValue {
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

pub fn doSend(this: *Subprocess, global: *jsc.JSGlobalObject, callFrame: *jsc.CallFrame) bun.JSError!JSValue {
    IPClog("Subprocess#doSend", .{});

    return IPC.doSend(if (this.ipc_data) |*data| data else null, global, callFrame, if (this.hasExited()) .subprocess_exited else .subprocess);
}
pub fn disconnectIPC(this: *Subprocess, nextTick: bool) void {
    const ipc_data = this.ipc() orelse return;
    ipc_data.closeSocketNextTick(nextTick);
}
pub fn disconnect(this: *Subprocess, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
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
    try array.push(global, .null);
    try array.push(global, .null); // TODO: align this with options
    try array.push(global, .null); // TODO: align this with options

    this.observable_getters.insert(.stdio);
    var pipes = this.stdio_pipes.items;
    if (this.ipc_data != null) {
        try array.push(global, .null);
        pipes = pipes[@min(1, pipes.len)..];
    }

    for (pipes) |item| {
        if (Environment.isWindows) {
            if (item == .buffer) {
                const fdno: usize = @intFromPtr(item.buffer.fd().cast());
                try array.push(global, JSValue.jsNumber(fdno));
            }
        } else {
            try array.push(global, JSValue.jsNumber(item.cast()));
        }
    }
    return array;
}

pub const Source = union(enum) {
    blob: jsc.WebCore.Blob.Any,
    array_buffer: jsc.ArrayBuffer.Strong,
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

pub const NewStaticPipeWriter = @import("./subprocess/StaticPipeWriter.zig").NewStaticPipeWriter;
pub const StaticPipeWriter = NewStaticPipeWriter(Subprocess);

pub fn memoryCost(this: *const Subprocess) usize {
    return @sizeOf(@This()) +
        this.process.memoryCost() +
        this.stdin.memoryCost() +
        this.stdout.memoryCost() +
        this.stderr.memoryCost();
}

fn consumeExitedPromise(this_jsvalue: JSValue, globalThis: *jsc.JSGlobalObject) ?JSValue {
    if (jsc.Codegen.JSSubprocess.exitedPromiseGetCached(this_jsvalue)) |promise| {
        jsc.Codegen.JSSubprocess.exitedPromiseSetCached(this_jsvalue, globalThis, .zero);
        return promise;
    }
    return null;
}

fn consumeOnExitCallback(this_jsvalue: JSValue, globalThis: *jsc.JSGlobalObject) ?JSValue {
    if (jsc.Codegen.JSSubprocess.onExitCallbackGetCached(this_jsvalue)) |callback| {
        jsc.Codegen.JSSubprocess.onExitCallbackSetCached(this_jsvalue, globalThis, .zero);
        return callback;
    }
    return null;
}

fn consumeOnDisconnectCallback(this_jsvalue: JSValue, globalThis: *jsc.JSGlobalObject) ?JSValue {
    if (jsc.Codegen.JSSubprocess.onDisconnectCallbackGetCached(this_jsvalue)) |callback| {
        jsc.Codegen.JSSubprocess.onDisconnectCallbackSetCached(this_jsvalue, globalThis, .zero);
        return callback;
    }
    return null;
}

pub fn onProcessExit(this: *Subprocess, process: *Process, status: bun.spawn.Status, rusage: *const Rusage) void {
    log("onProcessExit()", .{});
    const this_jsvalue = this.this_value.tryGet() orelse .zero;
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

    var stdin: ?*jsc.WebCore.FileSink = if (this.stdin == .pipe and this.flags.is_stdin_a_readable_stream) this.stdin.pipe else this.weak_file_sink_stdin_ptr;
    var existing_stdin_value = jsc.JSValue.zero;
    if (this_jsvalue != .zero) {
        if (jsc.Codegen.JSSubprocess.stdinGetCached(this_jsvalue)) |existing_value| {
            if (existing_value.isCell()) {
                if (stdin == null) {
                    // TODO: review this cast
                    stdin = @ptrCast(@alignCast(jsc.WebCore.FileSink.JSSink.fromJS(existing_value)));
                }

                if (!this.flags.is_stdin_a_readable_stream) {
                    existing_stdin_value = existing_value;
                }
            }
        }
    }

    // We won't be sending any more data.
    if (this.stdin == .buffer) {
        this.stdin.buffer.close();
    }

    if (existing_stdin_value != .zero) {
        jsc.WebCore.FileSink.JSSink.setDestroyCallback(existing_stdin_value, 0);
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
        pipe.onAttachedProcessExit(&status);
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
                    .exited => |exited| promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(exited.code)) catch {}, // TODO: properly propagate exception upwards
                    .err => |err| promise.asAnyPromise().?.reject(globalThis, err.toJS(globalThis) catch return) catch {}, // TODO: properly propagate exception upwards
                    .signaled => promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(128 +% @intFromEnum(status.signaled))) catch {}, // TODO: properly propagate exception upwards
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
                        (status.err.toJS(globalThis) catch return)
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

fn onPipeClose(this: *uv.Pipe) callconv(.c) void {
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

pub fn finalize(this: *Subprocess) callconv(.c) void {
    log("finalize", .{});
    // Ensure any code which references the "this" value doesn't attempt to
    // access it after it's been freed We cannot call any methods which
    // access GC'd values during the finalizer
    this.this_value.finalize();

    this.clearAbortSignal();

    bun.assert(!this.computeHasPendingActivity() or jsc.VirtualMachine.get().isShuttingDown());
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
    if (jsc.Codegen.JSSubprocess.exitedPromiseGetCached(this_value)) |promise| {
        return promise;
    }

    switch (this.process.status) {
        .exited => |exit| {
            return jsc.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(exit.code));
        },
        .signaled => |signal| {
            return jsc.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(signal.toExitCode() orelse 254));
        },
        .err => |err| {
            const js_err = err.toJS(globalThis) catch return .zero;
            return jsc.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, js_err);
        },
        else => {
            const promise = jsc.JSPromise.create(globalThis).toJS();
            jsc.Codegen.JSSubprocess.exitedPromiseSetCached(this_value, globalThis, promise);
            return promise;
        },
    }
}

pub fn getExitCode(
    this: *Subprocess,
    _: *JSGlobalObject,
) JSValue {
    if (this.process.status == .exited) {
        return jsc.JSValue.jsNumber(this.process.status.exited.code);
    }
    return jsc.JSValue.jsNull();
}

pub fn getSignalCode(
    this: *Subprocess,
    global: *JSGlobalObject,
) JSValue {
    if (this.process.signalCode()) |signal| {
        if (signal.name()) |name|
            return jsc.ZigString.init(name).toJS(global)
        else
            return jsc.JSValue.jsNumber(@intFromEnum(signal));
    }

    return jsc.JSValue.jsNull();
}

pub fn handleIPCMessage(
    this: *Subprocess,
    message: IPC.DecodedIPCMessage,
    handle: jsc.JSValue,
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
            const this_jsvalue = this.this_value.tryGet() orelse .zero;
            defer this_jsvalue.ensureStillAlive();
            if (this_jsvalue != .zero) {
                if (jsc.Codegen.JSSubprocess.ipcCallbackGetCached(this_jsvalue)) |cb| {
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
    const this_jsvalue = this.this_value.tryGet() orelse .zero;
    defer this_jsvalue.ensureStillAlive();
    const globalThis = this.globalThis;
    this.updateHasPendingActivity();

    if (this_jsvalue != .zero) {
        // Avoid keeping the callback alive longer than necessary
        jsc.Codegen.JSSubprocess.ipcCallbackSetCached(this_jsvalue, globalThis, .zero);

        // Call the onDisconnectCallback if it exists and prevent it from being kept alive longer than necessary
        if (consumeOnDisconnectCallback(this_jsvalue, globalThis)) |callback| {
            globalThis.bunVM().eventLoop().runCallback(callback, globalThis, this_jsvalue, &.{.true});
        }
    }
}

pub fn ipc(this: *Subprocess) ?*IPC.SendQueue {
    return &(this.ipc_data orelse return null);
}
pub fn getGlobalThis(this: *Subprocess) ?*jsc.JSGlobalObject {
    return this.globalThis;
}

const IPClog = Output.scoped(.IPC, .visible);

pub const StdioResult = if (Environment.isWindows) bun.spawn.WindowsSpawnResult.StdioResult else ?bun.FileDescriptor;
pub const Writable = @import("./subprocess/Writable.zig").Writable;

pub const MaxBuf = bun.io.MaxBuf;
pub const spawnSync = js_bun_spawn_bindings.spawnSync;
pub const spawn = js_bun_spawn_bindings.spawn;

const IPC = @import("../../ipc.zig");
const Terminal = @import("./Terminal.zig");
const js_bun_spawn_bindings = @import("./js_bun_spawn_bindings.zig");
const node_cluster_binding = @import("../../node/node_cluster_binding.zig");
const std = @import("std");

const bun = @import("bun");
const Async = bun.Async;
const Environment = bun.Environment;
const Output = bun.Output;
const default_allocator = bun.default_allocator;
const webcore = bun.webcore;
const which = bun.which;
const CowString = bun.ptr.CowString;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const PosixSpawn = bun.spawn;
const Process = bun.spawn.Process;
const Rusage = bun.spawn.Rusage;

const windows = bun.windows;
const uv = windows.libuv;
