const default_allocator = @import("root").bun.default_allocator;
const bun = @import("root").bun;
const Environment = bun.Environment;
const NetworkThread = @import("root").bun.http.NetworkThread;
const Global = bun.Global;
const strings = bun.strings;
const string = bun.string;
const Output = @import("root").bun.Output;
const MutableString = @import("root").bun.MutableString;
const std = @import("std");
const Allocator = std.mem.Allocator;
const JSC = @import("root").bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const Which = @import("../../../which.zig");
const Async = bun.Async;
const IPC = @import("../../ipc.zig");
const uws = bun.uws;

const PosixSpawn = @import("./spawn.zig").PosixSpawn;

const util = @import("../../../subproc/util.zig");

pub const Subprocess = struct {
    const log = Output.scoped(.Subprocess, false);
    pub usingnamespace JSC.Codegen.JSSubprocess;
    pub const default_max_buffer_size = 1024 * 1024 * 4;

    pid: std.os.pid_t,
    // on macOS, this is nothing
    // on linux, it's a pidfd
    pidfd: if (Environment.isLinux) bun.FileDescriptor else u0 = std.math.maxInt(if (Environment.isLinux) bun.FileDescriptor else u0),

    stdin: Writable,
    stdout: Readable,
    stderr: Readable,
    poll: Poll = Poll{ .poll_ref = null },

    exit_promise: JSC.Strong = .{},
    on_exit_callback: JSC.Strong = .{},

    exit_code: ?u8 = null,
    signal_code: ?SignalCode = null,
    waitpid_err: ?bun.sys.Error = null,

    globalThis: *JSC.JSGlobalObject,
    observable_getters: std.enums.EnumSet(enum {
        stdin,
        stdout,
        stderr,
    }) = .{},
    closed: std.enums.EnumSet(enum {
        stdin,
        stdout,
        stderr,
    }) = .{},
    has_pending_activity: std.atomic.Atomic(bool) = std.atomic.Atomic(bool).init(true),
    this_jsvalue: JSC.JSValue = .zero,

    ipc_mode: IPCMode,
    ipc_callback: JSC.Strong = .{},
    ipc: IPC.IPCData,
    flags: Flags = .{},

    pub const Writable = util.Writable;
    pub const Readable = util.Readable;
    pub const Stdio = util.Stdio;

    pub const BufferedInput = util.BufferedInput;
    pub const BufferedOutput = util.BufferedOutput;

    pub const Flags = util.Flags;
    pub const SignalCode = bun.SignalCode;
    pub const Poll = util.Poll;
    pub const WaitThreadPoll = util.WaitThreadPoll;

    pub const IPCMode = enum {
        none,
        bun,
        // json,
    };

    pub fn hasExited(this: *const Subprocess) bool {
        return this.exit_code != null or this.waitpid_err != null or this.signal_code != null;
    }

    pub fn hasPendingActivityNonThreadsafe(this: *const Subprocess) bool {
        if (this.flags.waiting_for_onexit) {
            return true;
        }

        if (this.ipc_mode != .none) {
            return true;
        }

        if (this.poll == .poll_ref) {
            if (this.poll.poll_ref) |poll| {
                if (poll.isActive() or poll.isRegistered()) {
                    return true;
                }
            }
        }
        if (this.poll == .wait_thread and this.poll.wait_thread.ref_count.load(.Monotonic) > 0) {
            return true;
        }

        return false;
    }

    pub fn updateHasPendingActivity(this: *Subprocess) void {
        @fence(.SeqCst);
        if (comptime Environment.isDebug) {
            log("updateHasPendingActivity() {any} -> {any}", .{
                this.has_pending_activity.value,
                this.hasPendingActivityNonThreadsafe(),
            });
        }
        this.has_pending_activity.store(
            this.hasPendingActivityNonThreadsafe(),
            .Monotonic,
        );
    }

    pub fn hasPendingActivity(this: *Subprocess) callconv(.C) bool {
        @fence(.Acquire);
        return this.has_pending_activity.load(.Acquire);
    }

    pub fn ref(this: *Subprocess) void {
        var vm = this.globalThis.bunVM();

        switch (this.poll) {
            .poll_ref => if (this.poll.poll_ref) |poll| {
                poll.ref(vm);
            },
            .wait_thread => |*wait_thread| {
                wait_thread.poll_ref.ref(vm);
            },
        }

        if (!this.hasCalledGetter(.stdin)) {
            this.stdin.ref();
        }

        if (!this.hasCalledGetter(.stdout)) {
            this.stdout.ref();
        }

        if (!this.hasCalledGetter(.stderr)) {
            this.stdout.ref();
        }
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn unref(this: *Subprocess, comptime deactivate_poll_ref: bool) void {
        var vm = this.globalThis.bunVM();

        switch (this.poll) {
            .poll_ref => if (this.poll.poll_ref) |poll| {
                if (deactivate_poll_ref) {
                    poll.onEnded(vm);
                } else {
                    poll.unref(vm);
                }
            },
            .wait_thread => |*wait_thread| {
                wait_thread.poll_ref.unref(vm);
            },
        }
        if (!this.hasCalledGetter(.stdin)) {
            this.stdin.unref();
        }

        if (!this.hasCalledGetter(.stdout)) {
            this.stdout.unref();
        }

        if (!this.hasCalledGetter(.stderr)) {
            this.stdout.unref();
        }
    }

    pub fn constructor(
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) ?*Subprocess {
        return null;
    }

    pub fn getStderr(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        this.observable_getters.insert(.stderr);
        return this.stderr.toJS(globalThis, this.exit_code != null);
    }

    pub fn getStdin(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        this.observable_getters.insert(.stdin);
        return this.stdin.toJS(globalThis);
    }

    pub fn getStdout(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        this.observable_getters.insert(.stdout);
        return this.stdout.toJS(globalThis, this.exit_code != null);
    }

    pub fn kill(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSValue {
        this.this_jsvalue = callframe.this();

        var arguments = callframe.arguments(1);
        // If signal is 0, then no actual signal is sent, but error checking
        // is still performed.
        var sig: i32 = 1;

        if (arguments.len > 0) {
            sig = arguments.ptr[0].coerce(i32, globalThis);
        }

        if (!(sig > -1 and sig < std.math.maxInt(u8))) {
            globalThis.throwInvalidArguments("Invalid signal: must be > -1 and < 255", .{});
            return .zero;
        }

        switch (this.tryKill(sig)) {
            .result => {},
            .err => |err| {
                globalThis.throwValue(err.toJSC(globalThis));
                return .zero;
            },
        }

        return JSValue.jsUndefined();
    }

    pub fn hasKilled(this: *const Subprocess) bool {
        return this.exit_code != null or this.signal_code != null;
    }

    pub fn tryKill(this: *Subprocess, sig: i32) JSC.Node.Maybe(void) {
        if (this.hasExited()) {
            return .{ .result = {} };
        }

        send_signal: {
            if (comptime Environment.isLinux) {
                // if these are the same, it means the pidfd is invalid.
                if (!WaiterThread.shouldUseWaiterThread()) {
                    // should this be handled differently?
                    // this effectively shouldn't happen
                    if (this.pidfd == bun.invalid_fd) {
                        return .{ .result = {} };
                    }

                    // first appeared in Linux 5.1
                    const rc = std.os.linux.pidfd_send_signal(this.pidfd, @as(u8, @intCast(sig)), null, 0);

                    if (rc != 0) {
                        const errno = std.os.linux.getErrno(rc);

                        // if the process was already killed don't throw
                        if (errno != .SRCH and errno != .NOSYS)
                            return .{ .err = bun.sys.Error.fromCode(errno, .kill) };
                    } else {
                        break :send_signal;
                    }
                }
            }

            const err = std.c.kill(this.pid, sig);
            if (err != 0) {
                const errno = bun.C.getErrno(err);

                // if the process was already killed don't throw
                if (errno != .SRCH)
                    return .{ .err = bun.sys.Error.fromCode(errno, .kill) };
            }
        }

        return .{ .result = {} };
    }

    fn hasCalledGetter(this: *Subprocess, comptime getter: @Type(.EnumLiteral)) bool {
        return this.observable_getters.contains(getter);
    }

    fn closeProcess(this: *Subprocess) void {
        if (comptime !Environment.isLinux) {
            return;
        }

        const pidfd = this.pidfd;

        this.pidfd = bun.invalid_fd;

        if (pidfd != bun.invalid_fd) {
            _ = std.os.close(pidfd);
        }
    }

    pub fn doRef(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.ref();
        return JSC.JSValue.jsUndefined();
    }

    pub fn doUnref(this: *Subprocess, _: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) JSValue {
        this.unref(false);
        return JSC.JSValue.jsUndefined();
    }

    pub fn doSend(this: *Subprocess, global: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) JSValue {
        if (this.ipc_mode == .none) {
            global.throw("Subprocess.send() can only be used if an IPC channel is open.", .{});
            return .zero;
        }

        if (callFrame.argumentsCount() == 0) {
            global.throwInvalidArguments("Subprocess.send() requires one argument", .{});
            return .zero;
        }

        const value = callFrame.argument(0);

        const success = this.ipc.serializeAndSend(global, value);
        if (!success) return .zero;

        return JSC.JSValue.jsUndefined();
    }

    pub fn disconnect(this: *Subprocess) void {
        if (this.ipc_mode == .none) return;
        this.ipc.socket.close(0, null);
        this.ipc_mode = .none;
    }

    pub fn getPid(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsNumber(this.pid);
    }

    pub fn getKilled(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        return JSValue.jsBoolean(this.hasKilled());
    }

    fn closeIO(this: *Subprocess, comptime io: @Type(.EnumLiteral)) void {
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

    // This must only be run once per Subprocess
    pub fn finalizeSync(this: *Subprocess) void {
        this.closeProcess();

        this.closeIO(.stdin);
        this.closeIO(.stdout);
        this.closeIO(.stderr);

        this.exit_promise.deinit();
        this.on_exit_callback.deinit();
    }

    pub fn finalize(this: *Subprocess) callconv(.C) void {
        std.debug.assert(!this.hasPendingActivity());
        this.finalizeSync();
        log("Finalize", .{});
        bun.default_allocator.destroy(this);
    }

    pub fn getExited(
        this: *Subprocess,
        globalThis: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.hasExited()) {
            const waitpid_error = this.waitpid_err;
            if (this.exit_code) |code| {
                return JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(code));
            } else if (waitpid_error) |err| {
                return JSC.JSPromise.rejectedPromiseValue(globalThis, err.toJSC(globalThis));
            } else if (this.signal_code != null) {
                return JSC.JSPromise.resolvedPromiseValue(globalThis, JSValue.jsNumber(128 +% @intFromEnum(this.signal_code.?)));
            } else {
                @panic("Subprocess.getExited() has exited but has no exit code or signal code. This is a bug.");
            }
        }

        if (!this.exit_promise.has()) {
            this.exit_promise.set(globalThis, JSC.JSPromise.create(globalThis).asValue(globalThis));
        }

        return this.exit_promise.get().?;
    }

    pub fn getExitCode(
        this: *Subprocess,
        _: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.exit_code) |code| {
            return JSC.JSValue.jsNumber(code);
        }
        return JSC.JSValue.jsNull();
    }

    pub fn getSignalCode(
        this: *Subprocess,
        global: *JSGlobalObject,
    ) callconv(.C) JSValue {
        if (this.signal_code) |signal| {
            if (signal.name()) |name|
                return JSC.ZigString.init(name).toValueGC(global)
            else
                return JSC.JSValue.jsNumber(@intFromEnum(signal));
        }

        return JSC.JSValue.jsNull();
    }

    pub fn spawn(globalThis: *JSC.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) JSValue {
        return spawnMaybeSyncFromJS(globalThis, args, secondaryArgsValue, false);
    }

    pub fn spawnSync(globalThis: *JSC.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) JSValue {
        return spawnMaybeSyncFromJS(globalThis, args, secondaryArgsValue, true);
    }

    pub const SpawnArgs = struct {
        arena: *bun.ArenaAllocator,

        override_env: bool = false,
        env_array: std.ArrayListUnmanaged(?[*:0]const u8) = .{
            .items = &.{},
            .capacity = 0,
        },
        cwd: []const u8,
        stdio: [3]Stdio = .{
            .{ .ignore = {} },
            .{ .pipe = null },
            .{ .inherit = {} },
        },
        lazy: bool = false,
        on_exit_callback: JSValue,
        PATH: []const u8,
        argv: std.ArrayListUnmanaged(?[*:0]const u8),
        cmd_value: JSValue,
        detached: bool,
        ipc_mode: IPCMode,
        ipc_callback: JSValue,

        pub fn default(arena: *bun.ArenaAllocator, jsc_vm: *JSC.VirtualMachine, comptime is_sync: bool) SpawnArgs {
            var out: SpawnArgs = .{
                .arena = arena,

                .override_env = false,
                .env_array = .{
                    .items = &.{},
                    .capacity = 0,
                },
                .cwd = jsc_vm.bundler.fs.top_level_dir,
                .stdio = .{
                    .{ .ignore = {} },
                    .{ .pipe = null },
                    .{ .inherit = {} },
                },
                .lazy = false,
                .on_exit_callback = .zero,
                .PATH = jsc_vm.bundler.env.get("PATH") orelse "",
                .argv = undefined,
                .cmd_value = .zero,
                .detached = false,
                .ipc_mode = IPCMode.none,
                .ipc_callback = .zero,
            };

            if (comptime is_sync) {
                out.stdio[1] = .{ .pipe = null };
                out.stdio[2] = .{ .pipe = null };
            }
            return out;
        }

        pub fn fromJS(
            out: *SpawnArgs,
            globalThis: *JSGlobalObject,
            arena: *bun.ArenaAllocator,
            jsc_vm: *JSC.VirtualMachine,
            args_: JSValue,
            secondaryArgsValue: ?JSValue,
            comptime is_sync: bool,
        ) ?JSValue {
            _ = jsc_vm;
            var allocator = arena.allocator();

            var args = args_;
            if (args.isEmptyOrUndefinedOrNull()) {
                globalThis.throwInvalidArguments("cmd must be an array", .{});
                return .zero;
            }

            const args_type = args.jsType();
            if (args_type.isArray()) {
                out.cmd_value = args;
                args = secondaryArgsValue orelse JSValue.zero;
            } else if (!args.isObject()) {
                globalThis.throwInvalidArguments("cmd must be an array", .{});
                return .zero;
            } else if (args.get(globalThis, "cmd")) |cmd_value_| {
                out.cmd_value = cmd_value_;
            } else {
                globalThis.throwInvalidArguments("cmd must be an array", .{});
                return .zero;
            }

            {
                var cmds_array = out.cmd_value.arrayIterator(globalThis);
                out.argv = @TypeOf(out.argv).initCapacity(allocator, cmds_array.len) catch {
                    globalThis.throw("out of memory", .{});
                    return .zero;
                };

                if (out.cmd_value.isEmptyOrUndefinedOrNull()) {
                    globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                    return .zero;
                }

                if (cmds_array.len == 0) {
                    globalThis.throwInvalidArguments("cmd must not be empty", .{});
                    return .zero;
                }

                {
                    var first_cmd = cmds_array.next().?;
                    var arg0 = first_cmd.toSlice(globalThis, allocator);
                    defer arg0.deinit();
                    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    var resolved = Which.which(&path_buf, out.PATH, out.cwd, arg0.slice()) orelse {
                        globalThis.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{arg0.slice()});
                        return .zero;
                    };
                    out.argv.appendAssumeCapacity(allocator.dupeZ(u8, bun.span(resolved)) catch {
                        globalThis.throw("out of memory", .{});
                        return .zero;
                    });
                }

                while (cmds_array.next()) |value| {
                    const arg = value.getZigString(globalThis);

                    // if the string is empty, ignore it, don't add it to the argv
                    if (arg.len == 0) {
                        continue;
                    }

                    out.argv.appendAssumeCapacity(arg.toOwnedSliceZ(allocator) catch {
                        globalThis.throw("out of memory", .{});
                        return .zero;
                    });
                }

                if (out.argv.items.len == 0) {
                    globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
                    return .zero;
                }
            }

            if (args != .zero and args.isObject()) {
                if (args.get(globalThis, "cwd")) |cwd_| {
                    // ignore definitely invalid cwd
                    if (!cwd_.isEmptyOrUndefinedOrNull()) {
                        const cwd_str = cwd_.getZigString(globalThis);
                        if (cwd_str.len > 0) {
                            out.cwd = cwd_str.toOwnedSliceZ(allocator) catch {
                                globalThis.throw("out of memory", .{});
                                return .zero;
                            };
                        }
                    }
                }

                if (args.get(globalThis, "onExit")) |onExit_| {
                    if (!onExit_.isEmptyOrUndefinedOrNull()) {
                        if (!onExit_.isCell() or !onExit_.isCallable(globalThis.vm())) {
                            globalThis.throwInvalidArguments("onExit must be a function or undefined", .{});
                            return .zero;
                        }

                        out.on_exit_callback = if (comptime is_sync)
                            onExit_
                        else
                            onExit_.withAsyncContextIfNeeded(globalThis);
                    }
                }

                if (args.get(globalThis, "env")) |object| {
                    if (!object.isEmptyOrUndefinedOrNull()) {
                        if (!object.isObject()) {
                            globalThis.throwInvalidArguments("env must be an object", .{});
                            return .zero;
                        }

                        out.override_env = true;
                        var object_iter = JSC.JSPropertyIterator(.{
                            .skip_empty_name = false,
                            .include_value = true,
                        }).init(globalThis, object.asObjectRef());
                        defer object_iter.deinit();
                        out.env_array.ensureTotalCapacityPrecise(allocator, object_iter.len) catch {
                            globalThis.throw("out of memory", .{});
                            return .zero;
                        };

                        // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                        out.PATH = "";

                        while (object_iter.next()) |key| {
                            var value = object_iter.value;
                            if (value == .undefined) continue;

                            var line = std.fmt.allocPrintZ(allocator, "{}={}", .{ key, value.getZigString(globalThis) }) catch {
                                globalThis.throw("out of memory", .{});
                                return .zero;
                            };

                            if (key.eqlComptime("PATH")) {
                                out.PATH = bun.asByteSlice(line["PATH=".len..]);
                            }

                            out.env_array.append(allocator, line) catch {
                                globalThis.throw("out of memory", .{});
                                return .zero;
                            };
                        }
                    }
                }

                if (args.get(globalThis, "stdio")) |stdio_val| {
                    if (!stdio_val.isEmptyOrUndefinedOrNull()) {
                        if (stdio_val.jsType().isArray()) {
                            var stdio_iter = stdio_val.arrayIterator(globalThis);
                            stdio_iter.len = @min(stdio_iter.len, 4);
                            var i: u32 = 0;
                            while (stdio_iter.next()) |value| : (i += 1) {
                                if (!util.extractStdio(globalThis, i, value, &out.stdio))
                                    return JSC.JSValue.jsUndefined();
                            }
                        } else {
                            globalThis.throwInvalidArguments("stdio must be an array", .{});
                            return .zero;
                        }
                    }
                } else {
                    if (args.get(globalThis, "stdin")) |value| {
                        if (!util.extractStdio(globalThis, bun.STDIN_FD, value, &out.stdio))
                            return .zero;
                    }

                    if (args.get(globalThis, "stderr")) |value| {
                        if (!util.extractStdio(globalThis, bun.STDERR_FD, value, &out.stdio))
                            return .zero;
                    }

                    if (args.get(globalThis, "stdout")) |value| {
                        if (!util.extractStdio(globalThis, bun.STDOUT_FD, value, &out.stdio))
                            return .zero;
                    }
                }

                if (comptime !is_sync) {
                    if (args.get(globalThis, "lazy")) |lazy_val| {
                        if (lazy_val.isBoolean()) {
                            out.lazy = lazy_val.toBoolean();
                        }
                    }
                }

                if (args.get(globalThis, "detached")) |detached_val| {
                    if (detached_val.isBoolean()) {
                        out.detached = detached_val.toBoolean();
                    }
                }

                if (args.get(globalThis, "ipc")) |val| {
                    if (val.isCell() and val.isCallable(globalThis.vm())) {
                        // In the future, we should add a way to use a different IPC serialization format, specifically `json`.
                        // but the only use case this has is doing interop with node.js IPC and other programs.
                        out.ipc_mode = .bun;
                        out.ipc_callback = val.withAsyncContextIfNeeded(globalThis);
                    }
                }
            }

            return null;
        }
    };

    pub const WatchFd = if (Environment.isLinux) std.os.fd_t else i32;

    pub fn spawnMaybeSyncFromJS(
        globalThis: *JSC.JSGlobalObject,
        args_: JSValue,
        secondaryArgsValue: ?JSValue,
        comptime is_sync: bool,
    ) JSValue {
        if (comptime Environment.isWindows) {
            globalThis.throwTODO("spawn() is not yet implemented on Windows");
            return .zero;
        }
        var arena = @import("root").bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var jsc_vm = globalThis.bunVM();
        var spawn_args = SpawnArgs.default(&arena, jsc_vm, is_sync);
        if (spawn_args.fromJS(globalThis, &arena, jsc_vm, args_, secondaryArgsValue, is_sync)) |err| {
            return err;
        }

        var out_err: ?JSValue = null;
        var out_watchfd: if (Environment.isLinux) ?std.os.fd_t else ?i32 = null;
        var subprocess = util.spawnMaybeSyncImpl(
            .{
                .SpawnArgs = SpawnArgs,
                .Subprocess = Subprocess,
                .WaiterThread = WaiterThread,
                .is_sync = is_sync,
                .is_js = true,
            },
            globalThis,
            arena.allocator(),
            &out_watchfd,
            &out_err,
            &spawn_args,
        ) orelse
            {
            if (out_err) |err| {
                globalThis.throwValue(err);
            }
            return .zero;
        };

        const out = subprocess.this_jsvalue;

        if (comptime !is_sync) {
            return out;
        }

        if (subprocess.stdin == .buffered_input) {
            while (subprocess.stdin.buffered_input.remain.len > 0) {
                subprocess.stdin.buffered_input.writeIfPossible(true);
            }
        }
        subprocess.closeIO(.stdin);

        const watchfd = out_watchfd orelse {
            globalThis.throw("watchfd is null", .{});
            return .zero;
        };

        if (!WaiterThread.shouldUseWaiterThread()) {
            var poll = Async.FilePoll.init(jsc_vm, watchfd, .{}, Subprocess, subprocess);
            subprocess.poll = .{ .poll_ref = poll };
            switch (subprocess.poll.poll_ref.?.register(
                jsc_vm.event_loop_handle.?,
                .process,
                true,
            )) {
                .result => {
                    subprocess.poll.poll_ref.?.enableKeepingProcessAlive(jsc_vm);
                },
                .err => |err| {
                    if (err.getErrno() != .SRCH) {
                        @panic("This shouldn't happen");
                    }

                    // process has already exited
                    // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                    subprocess.onExitNotification();
                },
            }
        } else {
            WaiterThread.append(subprocess);
        }

        while (!subprocess.hasExited()) {
            if (subprocess.stderr == .pipe and subprocess.stderr.pipe == .buffer) {
                subprocess.stderr.pipe.buffer.readAll();
            }

            if (subprocess.stdout == .pipe and subprocess.stdout.pipe == .buffer) {
                subprocess.stdout.pipe.buffer.readAll();
            }

            jsc_vm.tick();
            jsc_vm.eventLoop().autoTick();
        }

        const exitCode = subprocess.exit_code orelse 1;
        const stdout = subprocess.stdout.toBufferedValue(globalThis);
        const stderr = subprocess.stderr.toBufferedValue(globalThis);
        subprocess.finalizeSync();

        const sync_value = JSC.JSValue.createEmptyObject(globalThis, 4);
        sync_value.put(globalThis, JSC.ZigString.static("exitCode"), JSValue.jsNumber(@as(i32, @intCast(exitCode))));
        sync_value.put(globalThis, JSC.ZigString.static("stdout"), stdout);
        sync_value.put(globalThis, JSC.ZigString.static("stderr"), stderr);
        sync_value.put(globalThis, JSC.ZigString.static("success"), JSValue.jsBoolean(exitCode == 0));
        return sync_value;
    }

    pub fn onExitNotificationTask(this: *Subprocess) void {
        var vm = this.globalThis.bunVM();
        const is_sync = this.flags.is_sync;

        defer {
            if (!is_sync)
                vm.drainMicrotasks();
        }
        this.wait(false);
    }

    pub fn onExitNotification(
        this: *Subprocess,
    ) void {
        std.debug.assert(this.flags.is_sync);

        this.wait(this.flags.is_sync);
    }

    pub fn wait(this: *Subprocess, sync: bool) void {
        return this.waitWithJSValue(sync, this.this_jsvalue);
    }

    pub fn watch(this: *Subprocess) JSC.Maybe(void) {
        if (WaiterThread.shouldUseWaiterThread()) {
            WaiterThread.append(this);
            return JSC.Maybe(void){ .result = {} };
        }

        if (this.poll.poll_ref) |poll| {
            const registration = poll.register(
                this.globalThis.bunVM().event_loop_handle.?,
                .process,
                true,
            );

            return registration;
        } else {
            @panic("Internal Bun error: poll_ref in Subprocess is null unexpectedly. Please file a bug report.");
        }
    }

    pub fn waitWithJSValue(
        this: *Subprocess,
        sync: bool,
        this_jsvalue: JSC.JSValue,
    ) void {
        this.onWaitPid(sync, this_jsvalue, PosixSpawn.waitpid(this.pid, if (sync) 0 else std.os.W.NOHANG));
    }

    pub fn onWaitPid(this: *Subprocess, sync: bool, this_jsvalue: JSC.JSValue, waitpid_result_: JSC.Maybe(PosixSpawn.WaitPidResult)) void {
        if (Environment.isWindows) {
            @panic("windows doesnt support subprocess yet. haha");
        }
        defer if (sync) this.updateHasPendingActivity();

        const pid = this.pid;

        var waitpid_result = waitpid_result_;

        while (true) {
            switch (waitpid_result) {
                .err => |err| {
                    this.waitpid_err = err;
                },
                .result => |result| {
                    if (result.pid == pid) {
                        if (std.os.W.IFEXITED(result.status)) {
                            this.exit_code = @as(u8, @truncate(std.os.W.EXITSTATUS(result.status)));
                        }

                        // True if the process terminated due to receipt of a signal.
                        if (std.os.W.IFSIGNALED(result.status)) {
                            this.signal_code = @as(SignalCode, @enumFromInt(@as(u8, @truncate(std.os.W.TERMSIG(result.status)))));
                        } else if (
                        // https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/waitpid.2.html
                        // True if the process has not terminated, but has stopped and can
                        // be restarted.  This macro can be true only if the wait call spec-ified specified
                        // ified the WUNTRACED option or if the child process is being
                        // traced (see ptrace(2)).
                        std.os.W.IFSTOPPED(result.status)) {
                            this.signal_code = @as(SignalCode, @enumFromInt(@as(u8, @truncate(std.os.W.STOPSIG(result.status)))));
                        }
                    }

                    if (!this.hasExited()) {
                        switch (this.watch()) {
                            .result => {},
                            .err => |err| {
                                if (comptime Environment.isMac) {
                                    if (err.getErrno() == .SRCH) {
                                        waitpid_result = PosixSpawn.waitpid(pid, if (sync) 0 else std.os.W.NOHANG);
                                        continue;
                                    }
                                }
                            },
                        }
                    }
                },
            }
            break;
        }

        if (!sync and this.hasExited()) {
            var vm = this.globalThis.bunVM();

            // prevent duplicate notifications
            switch (this.poll) {
                .poll_ref => |poll_| {
                    if (poll_) |poll| {
                        this.poll.poll_ref = null;
                        poll.deinitWithVM(vm);
                    }
                },
                .wait_thread => {
                    this.poll.wait_thread.poll_ref.deactivate(vm.event_loop_handle.?);
                },
            }

            this.onExit(this.globalThis, this_jsvalue);
        }
    }

    fn runOnExit(this: *Subprocess, globalThis: *JSC.JSGlobalObject, this_jsvalue: JSC.JSValue) void {
        const waitpid_error = this.waitpid_err;
        this.waitpid_err = null;

        if (this.exit_promise.trySwap()) |promise| {
            if (this.exit_code) |code| {
                promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(code));
            } else if (waitpid_error) |err| {
                promise.asAnyPromise().?.reject(globalThis, err.toJSC(globalThis));
            } else if (this.signal_code != null) {
                promise.asAnyPromise().?.resolve(globalThis, JSValue.jsNumber(128 +% @intFromEnum(this.signal_code.?)));
            } else {
                // crash in debug mode
                if (comptime Environment.allow_assert)
                    unreachable;
            }
        }

        if (this.on_exit_callback.trySwap()) |callback| {
            const waitpid_value: JSValue =
                if (waitpid_error) |err|
                err.toJSC(globalThis)
            else
                JSC.JSValue.jsUndefined();

            const this_value = if (this_jsvalue.isEmptyOrUndefinedOrNull()) JSC.JSValue.jsUndefined() else this_jsvalue;
            this_value.ensureStillAlive();

            const args = [_]JSValue{
                this_value,
                this.getExitCode(globalThis),
                this.getSignalCode(globalThis),
                waitpid_value,
            };

            const result = callback.callWithThis(
                globalThis,
                this_value,
                &args,
            );

            if (result.isAnyError()) {
                globalThis.bunVM().onUnhandledError(globalThis, result);
            }
        }
    }

    fn onExit(
        this: *Subprocess,
        globalThis: *JSC.JSGlobalObject,
        this_jsvalue: JSC.JSValue,
    ) void {
        log("onExit({d}) = {d}, \"{s}\"", .{ this.pid, if (this.exit_code) |e| @as(i32, @intCast(e)) else -1, if (this.signal_code) |code| @tagName(code) else "" });
        defer this.updateHasPendingActivity();
        this_jsvalue.ensureStillAlive();

        if (this.hasExited()) {
            {
                this.flags.waiting_for_onexit = true;

                const Holder = struct {
                    process: *Subprocess,
                    task: JSC.AnyTask,

                    pub fn unref(self: *@This()) void {
                        // this calls disableKeepingProcessAlive on pool_ref and stdin, stdout, stderr
                        self.process.flags.waiting_for_onexit = false;
                        self.process.unref(true);
                        self.process.updateHasPendingActivity();
                        bun.default_allocator.destroy(self);
                    }
                };

                var holder = bun.default_allocator.create(Holder) catch @panic("OOM");

                holder.* = .{
                    .process = this,
                    .task = JSC.AnyTask.New(Holder, Holder.unref).init(holder),
                };

                this.globalThis.bunVM().enqueueTask(JSC.Task.init(&holder.task));
            }

            this.runOnExit(globalThis, this_jsvalue);
        }
    }

    const os = std.os;
    fn destroyPipe(pipe: [2]os.fd_t) void {
        os.close(pipe[0]);
        if (pipe[0] != pipe[1]) os.close(pipe[1]);
    }

    pub fn handleIPCMessage(
        this: *Subprocess,
        message: IPC.DecodedIPCMessage,
    ) void {
        switch (message) {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            .version => |v| {
                IPC.log("Child IPC version is {d}", .{v});
            },
            .data => |data| {
                IPC.log("Received IPC message from child", .{});
                if (this.ipc_callback.get()) |cb| {
                    const result = cb.callWithThis(
                        this.globalThis,
                        this.this_jsvalue,
                        &[_]JSValue{ data, this.this_jsvalue },
                    );
                    data.ensureStillAlive();
                    if (result.isAnyError()) {
                        this.globalThis.bunVM().onUnhandledError(this.globalThis, result);
                    }
                }
            },
        }
    }

    pub fn handleIPCClose(this: *Subprocess, _: IPC.Socket) void {
        // uSocket is already freed so calling .close() on the socket can segfault
        this.ipc_mode = .none;
        this.updateHasPendingActivity();
    }

    pub const IPCHandler = IPC.NewIPCHandler(Subprocess);

    // Machines which do not support pidfd_open (GVisor, Linux Kernel < 5.6)
    // use a thread to wait for the child process to exit.
    // We use a single thread to call waitpid() in a loop.
    pub const WaiterThread = util.NewWaiterThread(Subprocess, true);
};
