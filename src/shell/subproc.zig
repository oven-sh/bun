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
const Which = @import("../which.zig");
const Async = bun.Async;
// const IPC = @import("../bun.js/ipc.zig");
const uws = bun.uws;

const PosixSpawn = @import("../bun.js/api/bun/spawn.zig").PosixSpawn;

const ShellCmd = @import("./interpreter.zig").Cmd;

const util = @import("../subproc/util.zig");

pub const ShellSubprocess = struct {
    const log = Output.scoped(.Subprocess, false);
    pub const default_max_buffer_size = 1024 * 1024 * 4;

    cmd_parent: ?*ShellCmd = null,
    pid: std.os.pid_t,
    // on macOS, this is nothing
    // on linux, it's a pidfd
    pidfd: if (Environment.isLinux) bun.FileDescriptor else u0 = std.math.maxInt(if (Environment.isLinux) bun.FileDescriptor else u0),

    stdin: Writable,
    stdout: Readable,
    stderr: Readable,
    poll: Poll = Poll{ .poll_ref = null },

    // on_exit_callback: JSC.Strong = .{},

    exit_code: ?u8 = null,
    signal_code: ?SignalCode = null,
    waitpid_err: ?bun.sys.Error = null,

    globalThis: *JSC.JSGlobalObject,
    // observable_getters: std.enums.EnumSet(enum {
    //     stdin,
    //     stdout,
    //     stderr,
    // }) = .{},
    closed: std.enums.EnumSet(enum {
        stdin,
        stdout,
        stderr,
    }) = .{},
    this_jsvalue: JSC.JSValue = .zero,

    // ipc_mode: IPCMode,
    // ipc_callback: JSC.Strong = .{},
    // ipc: IPC.IPCData,
    flags: Flags = .{},

    // pub const IPCMode = enum {
    //     none,
    //     bun,
    //     // json,
    // };

    pub const Writable = util.Writable;
    pub const Readable = util.Readable;
    pub const Stdio = util.Stdio;

    pub const BufferedInput = util.BufferedInput;
    pub const BufferedOutput = util.BufferedOutput;

    pub const Flags = util.Flags;
    pub const SignalCode = bun.SignalCode;
    pub const Poll = util.Poll;
    pub const WaitThreadPoll = util.WaitThreadPoll;

    pub fn hasExited(this: *const ShellSubprocess) bool {
        return this.exit_code != null or this.waitpid_err != null or this.signal_code != null;
    }

    pub fn ref(this: *ShellSubprocess) void {
        var vm = this.globalThis.bunVM();

        switch (this.poll) {
            .poll_ref => if (this.poll.poll_ref) |poll| {
                poll.ref(vm);
            },
            .wait_thread => |*wait_thread| {
                wait_thread.poll_ref.ref(vm);
            },
        }

        // if (!this.hasCalledGetter(.stdin)) {
        // this.stdin.ref();
        // }

        // if (!this.hasCalledGetter(.stdout)) {
        // this.stdout.ref();
        // }

        // if (!this.hasCalledGetter(.stderr)) {
        // this.stderr.ref();
        // }
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn unref(this: *ShellSubprocess, comptime deactivate_poll_ref: bool) void {
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
        // if (!this.hasCalledGetter(.stdin)) {
        // this.stdin.unref();
        // }

        // if (!this.hasCalledGetter(.stdout)) {
        // this.stdout.unref();
        // }

        // if (!this.hasCalledGetter(.stderr)) {
        // this.stdout.unref();
        // }
    }

    pub fn hasKilled(this: *const ShellSubprocess) bool {
        return this.exit_code != null or this.signal_code != null;
    }

    pub fn tryKill(this: *ShellSubprocess, sig: i32) JSC.Node.Maybe(void) {
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

    // fn hasCalledGetter(this: *Subprocess, comptime getter: @Type(.EnumLiteral)) bool {
    //     return this.observable_getters.contains(getter);
    // }

    fn closeProcess(this: *ShellSubprocess) void {
        if (comptime !Environment.isLinux) {
            return;
        }

        const pidfd = this.pidfd;

        this.pidfd = bun.invalid_fd;

        if (pidfd != bun.invalid_fd) {
            _ = std.os.close(pidfd);
        }
    }

    pub fn disconnect(this: *ShellSubprocess) void {
        _ = this;
        // if (this.ipc_mode == .none) return;
        // this.ipc.socket.close(0, null);
        // this.ipc_mode = .none;
    }

    fn closeIO(this: *ShellSubprocess, comptime io: @Type(.EnumLiteral)) void {
        if (this.closed.contains(io)) return;
        this.closed.insert(io);

        // If you never referenced stdout/stderr, they won't be garbage collected.
        //
        // That means:
        //   1. We need to stop watching them
        //   2. We need to free the memory
        //   3. We need to halt any pending reads (1)
        // if (!this.hasCalledGetter(io)) {
        @field(this, @tagName(io)).finalize();
        // } else {
        // @field(this, @tagName(io)).close();
        // }
    }

    // This must only be run once per Subprocess
    pub fn finalizeSync(this: *ShellSubprocess) void {
        this.closeProcess();

        this.closeIO(.stdin);
        this.closeIO(.stdout);
        this.closeIO(.stderr);

        // this.exit_promise.deinit();
        // Deinitialization of the shell state is handled by the shell state machine
        // this.on_exit_callback.deinit();
    }

    pub fn deinit(this: *ShellSubprocess) void {
        //     std.debug.assert(!this.hasPendingActivity());
        this.finalizeSync();
        log("Deinit", .{});
        bun.default_allocator.destroy(this);
    }

    // pub fn finalize(this: *Subprocess) callconv(.C) void {
    //     std.debug.assert(!this.hasPendingActivity());
    //     this.finalizeSync();
    //     log("Finalize", .{});
    //     bun.default_allocator.destroy(this);
    // }

    pub const SpawnArgs = struct {
        arena: *bun.ArenaAllocator,
        cmd_parent: ?*ShellCmd = null,

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
        PATH: []const u8,
        argv: std.ArrayListUnmanaged(?[*:0]const u8),
        detached: bool,
        // ipc_mode: IPCMode,
        // ipc_callback: JSValue,

        const EnvMapIter = struct {
            map: *bun.DotEnv.Map,
            iter: bun.DotEnv.Map.HashTable.Iterator,
            alloc: Allocator,

            const Entry = struct {
                key: Key,
                value: Value,
            };

            pub const Key = struct {
                val: []const u8,

                pub fn format(self: Key, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                    try writer.writeAll(self.val);
                }

                pub fn eqlComptime(this: Key, comptime str: []const u8) bool {
                    return bun.strings.eqlComptime(this.val, str);
                }
            };

            pub const Value = struct {
                val: [:0]const u8,

                pub fn format(self: Value, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
                    try writer.writeAll(self.val);
                }
            };

            pub fn init(map: *bun.DotEnv.Map, alloc: Allocator) EnvMapIter {
                return EnvMapIter{
                    .map = map,
                    .iter = map.iter(),
                    .alloc = alloc,
                };
            }

            pub fn len(this: *const @This()) usize {
                return this.map.map.unmanaged.entries.len;
            }

            pub fn next(this: *@This()) !?@This().Entry {
                const entry = this.iter.next() orelse return null;
                var value = try this.alloc.allocSentinel(u8, entry.value_ptr.value.len, 0);
                @memcpy(value[0..entry.value_ptr.value.len], entry.value_ptr.value);
                value[entry.value_ptr.value.len] = 0;
                return .{
                    .key = .{ .val = entry.key_ptr.* },
                    .value = .{ .val = value },
                };
            }
        };

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
                .PATH = jsc_vm.bundler.env.get("PATH") orelse "",
                .argv = undefined,
                .detached = false,
                // .ipc_mode = IPCMode.none,
                // .ipc_callback = .zero,
            };

            if (comptime is_sync) {
                out.stdio[1] = .{ .pipe = null };
                out.stdio[2] = .{ .pipe = null };
            }
            return out;
        }

        pub fn fillEnvFromProcess(this: *SpawnArgs, globalThis: *JSGlobalObject) bool {
            var env_iter = EnvMapIter.init(globalThis.bunVM().bundler.env.map, this.arena.allocator());
            return this.fillEnv(globalThis, &env_iter, false);
        }

        /// `object_iter` should be a some type with the following fields:
        /// - `next() bool`
        pub fn fillEnv(
            this: *SpawnArgs,
            globalThis: *JSGlobalObject,
            object_iter: anytype,
            comptime disable_path_lookup_for_arv0: bool,
        ) bool {
            var allocator = this.arena.allocator();
            this.override_env = true;
            this.env_array.ensureTotalCapacityPrecise(allocator, object_iter.len()) catch {
                globalThis.throw("out of memory", .{});
                return false;
            };

            if (disable_path_lookup_for_arv0) {
                // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                this.PATH = "";
            }

            while (object_iter.next() catch {
                globalThis.throwOutOfMemory();
                return false;
            }) |entry| {
                var value = entry.value;

                var line = std.fmt.allocPrintZ(allocator, "{}={}", .{ entry.key, value }) catch {
                    globalThis.throw("out of memory", .{});
                    return false;
                };

                if (entry.key.eqlComptime("PATH")) {
                    this.PATH = bun.asByteSlice(line["PATH=".len..]);
                }

                this.env_array.append(allocator, line) catch {
                    globalThis.throw("out of memory", .{});
                    return false;
                };
            }

            return true;
        }
    };

    pub const WatchFd = if (Environment.isLinux) std.os.fd_t else i32;

    pub fn spawnAsync(
        globalThis: *JSC.JSGlobalObject,
        spawn_args_: SpawnArgs,
    ) !?*ShellSubprocess {
        if (comptime Environment.isWindows) {
            globalThis.throwTODO("spawn() is not yet implemented on Windows");
            return null;
        }
        var arena = @import("root").bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();

        var spawn_args = spawn_args_;

        var out_err: ?JSValue = null;
        var out_watchfd: if (Environment.isLinux) ?std.os.fd_t else ?i32 = null;
        var subprocess = util.spawnMaybeSyncImpl(
            .{
                .SpawnArgs = SpawnArgs,
                .Subprocess = ShellSubprocess,
                .WaiterThread = WaiterThread,
                .is_sync = false,
                .is_js = false,
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
            return null;
        };

        return subprocess;
    }

    pub fn spawnSync(
        globalThis: *JSC.JSGlobalObject,
        spawn_args_: SpawnArgs,
    ) !?*ShellSubprocess {
        if (comptime Environment.isWindows) {
            globalThis.throwTODO("spawn() is not yet implemented on Windows");
            return null;
        }
        var is_sync = true;
        var arena = @import("root").bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();
        var jsc_vm = globalThis.bunVM();

        var spawn_args = spawn_args_;

        var out_err: ?JSValue = null;
        var out_watchfd: if (Environment.isLinux) ?std.os.fd_t else ?i32 = null;
        var subprocess = util.spawnMaybeSyncImpl(
            .{
                .SpawnArgs = SpawnArgs,
                .Subprocess = ShellSubprocess,
                .WaiterThread = WaiterThread,
                .is_sync = true,
                .is_js = false,
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
            return null;
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
            return null;
        };

        if (!WaiterThread.shouldUseWaiterThread()) {
            var poll = Async.FilePoll.init(jsc_vm, watchfd, .{}, ShellSubprocess, subprocess);
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

        return subprocess;
    }

    pub fn onExitNotificationTask(this: *ShellSubprocess) void {
        var vm = this.globalThis.bunVM();
        const is_sync = this.flags.is_sync;

        defer {
            if (!is_sync)
                vm.drainMicrotasks();
        }
        this.wait(false);
    }

    pub fn onExitNotification(
        this: *ShellSubprocess,
    ) void {
        std.debug.assert(this.flags.is_sync);

        this.wait(this.flags.is_sync);
    }

    pub fn wait(this: *ShellSubprocess, sync: bool) void {
        return this.onWaitPid(sync, PosixSpawn.waitpid(this.pid, if (sync) 0 else std.os.W.NOHANG));
    }

    pub fn watch(this: *ShellSubprocess) JSC.Maybe(void) {
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

    pub fn onWaitPid(this: *ShellSubprocess, sync: bool, waitpid_result_: JSC.Maybe(PosixSpawn.WaitPidResult)) void {
        if (Environment.isWindows) {
            @panic("windows doesnt support subprocess yet. haha");
        }
        // defer if (sync) this.updateHasPendingActivity();

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

            this.onExit(this.globalThis);
        }
    }

    fn runOnExit(this: *ShellSubprocess, globalThis: *JSC.JSGlobalObject) void {
        log("run on exit {d}", .{this.pid});
        _ = globalThis;
        const waitpid_error = this.waitpid_err;
        _ = waitpid_error;
        this.waitpid_err = null;

        // FIXME remove when we get rid of old shell interpreter
        if (this.cmd_parent) |cmd| {
            if (cmd.exit_code == null) {
                // defer this.shell_state = null;
                cmd.onExit(this.exit_code.?);
                // FIXME handle waitpid_error here like below
            }
        }

        // if (this.on_exit_callback.trySwap()) |callback| {
        //     const waitpid_value: JSValue =
        //         if (waitpid_error) |err|
        //         err.toJSC(globalThis)
        //     else
        //         JSC.JSValue.jsUndefined();

        //     const this_value = if (this_jsvalue.isEmptyOrUndefinedOrNull()) JSC.JSValue.jsUndefined() else this_jsvalue;
        //     this_value.ensureStillAlive();

        //     const args = [_]JSValue{
        //         this_value,
        //         this.getExitCode(globalThis),
        //         this.getSignalCode(globalThis),
        //         waitpid_value,
        //     };

        //     const result = callback.callWithThis(
        //         globalThis,
        //         this_value,
        //         &args,
        //     );

        //     if (result.isAnyError()) {
        //         globalThis.bunVM().onUnhandledError(globalThis, result);
        //     }
        // }
    }

    fn onExit(
        this: *ShellSubprocess,
        globalThis: *JSC.JSGlobalObject,
    ) void {
        log("onExit({d}) = {d}, \"{s}\"", .{ this.pid, if (this.exit_code) |e| @as(i32, @intCast(e)) else -1, if (this.signal_code) |code| @tagName(code) else "" });
        // defer this.updateHasPendingActivity();

        if (this.hasExited()) {
            {
                this.flags.waiting_for_onexit = true;

                const Holder = struct {
                    process: *ShellSubprocess,
                    task: JSC.AnyTask,

                    pub fn unref(self: *@This()) void {
                        // this calls disableKeepingProcessAlive on pool_ref and stdin, stdout, stderr
                        self.process.flags.waiting_for_onexit = false;
                        self.process.unref(true);
                        // self.process.updateHasPendingActivity();
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

            this.runOnExit(globalThis);
        }
    }

    const os = std.os;
    fn destroyPipe(pipe: [2]os.fd_t) void {
        os.close(pipe[0]);
        if (pipe[0] != pipe[1]) os.close(pipe[1]);
    }

    pub fn extractStdioBlob(
        globalThis: *JSC.JSGlobalObject,
        blob: JSC.WebCore.AnyBlob,
        i: u32,
        stdio_array: []Stdio,
    ) bool {
        return util.extractStdioBlob(globalThis, blob, i, stdio_array);
    }

    pub const WaiterThread = util.NewWaiterThread(ShellSubprocess, false);
};
