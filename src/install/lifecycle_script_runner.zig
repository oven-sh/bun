const bun = @import("root").bun;
const Lockfile = @import("./lockfile.zig");
const std = @import("std");
const Async = bun.Async;
const PosixSpawn = bun.posix.spawn;
const PackageManager = @import("./install.zig").PackageManager;
const Environment = bun.Environment;
const Output = bun.Output;
const Global = bun.Global;
const JSC = bun.JSC;
const WaiterThread = JSC.Subprocess.WaiterThread;

pub const LifecycleScriptSubprocess = struct {
    script_name: []const u8,
    package_name: []const u8,

    scripts: [6]?Lockfile.Scripts.Entry,
    current_script_index: usize = 0,

    finished_fds: u8 = 0,

    pid: std.os.pid_t = bun.invalid_fd,

    pid_poll: *Async.FilePoll,
    waitpid_result: ?PosixSpawn.WaitPidResult,
    stdout: OutputReader = .{},
    stderr: OutputReader = .{},
    manager: *PackageManager,
    envp: [:null]?[*:0]u8,

    pub var alive_count: std.atomic.Atomic(usize) = std.atomic.Atomic(usize).init(0);

    /// A "nothing" struct that lets us reuse the same pointer
    /// but with a different tag for the file poll
    pub const PidPollData = struct { process: LifecycleScriptSubprocess };

    pub const OutputReader = struct {
        poll: *Async.FilePoll = undefined,
        buffer: std.ArrayList(u8) = std.ArrayList(u8).init(bun.default_allocator),
        is_done: bool = false,

        // This is a workaround for "Dependency loop detected"
        parent: *LifecycleScriptSubprocess = undefined,

        pub usingnamespace bun.io.PipeReader(
            @This(),
            getFd,
            getBuffer,
            null,
            registerPoll,
            done,
            onError,
        );

        pub fn getFd(this: *OutputReader) bun.FileDescriptor {
            return bun.toFD(this.poll.fd);
        }

        pub fn getBuffer(this: *OutputReader) *std.ArrayList(u8) {
            return &this.buffer;
        }

        fn finish(this: *OutputReader) void {
            this.poll.flags.insert(.ignore_updates);
            this.subprocess().manager.file_poll_store.hive.put(this.poll);
            std.debug.assert(!this.is_done);
            this.is_done = true;
        }

        pub fn done(this: *OutputReader, _: []u8) void {
            this.finish();
            this.subprocess().onOutputDone();
        }

        pub fn onError(this: *OutputReader, err: bun.sys.Error) void {
            this.finish();
            this.subprocess().onOutputError(err);
        }

        pub fn registerPoll(this: *OutputReader) void {
            switch (this.poll.register(this.subprocess().manager.uws_event_loop, .readable, true)) {
                .err => |err| {
                    Output.prettyErrorln("<r><red>error<r>: Failed to register poll for <b>{s}<r> script output from \"<b>{s}<r>\" due to error <b>{d} {s}<r>", .{
                        this.subprocess().script_name,
                        this.subprocess().package_name,
                        err.errno,
                        @tagName(err.getErrno()),
                    });
                },
                .result => {},
            }
        }

        pub inline fn subprocess(this: *OutputReader) *LifecycleScriptSubprocess {
            return this.parent;
        }

        pub fn start(this: *OutputReader) JSC.Maybe(void) {
            const maybe = this.poll.register(this.subprocess().manager.uws_event_loop, .readable, true);
            if (maybe != .result) {
                return maybe;
            }

            this.read();

            return .{
                .result = {},
            };
        }
    };

    pub fn onOutputDone(this: *LifecycleScriptSubprocess) void {
        std.debug.assert(this.finished_fds < 2);
        this.finished_fds += 1;

        if (this.waitpid_result) |result| {
            if (this.finished_fds == 2) {
                // potential free()
                this.onResult(result);
            }
        }
    }

    pub fn onOutputError(this: *LifecycleScriptSubprocess, err: bun.sys.Error) void {
        std.debug.assert(this.finished_fds < 2);
        this.finished_fds += 1;

        Output.prettyErrorln("<r><red>error<r>: Failed to read <b>{s}<r> script output from \"<b>{s}<r>\" due to error <b>{d} {s}<r>", .{
            this.script_name,
            this.package_name,
            err.errno,
            @tagName(err.getErrno()),
        });
        Output.flush();
        if (this.waitpid_result) |result| {
            if (this.finished_fds == 2) {
                // potential free()
                this.onResult(result);
            }
        }
    }

    pub fn spawnNextScript(this: *LifecycleScriptSubprocess, next_script_index: usize) !void {
        _ = alive_count.fetchAdd(1, .Monotonic);
        errdefer _ = alive_count.fetchSub(1, .Monotonic);

        const manager = this.manager;
        const original_script = this.scripts[next_script_index].?;
        const cwd = original_script.cwd;
        const env = manager.env;
        const name = Lockfile.Scripts.names[next_script_index];

        if (manager.scripts_node) |scripts_node| {
            if (manager.finished_installing.load(.Monotonic)) {
                manager.setNodeName(
                    scripts_node,
                    original_script.package_name,
                    PackageManager.ProgressStrings.script_emoji,
                    true,
                );
                scripts_node.activate();
                manager.progress.refresh();
            }
        }

        this.script_name = name;
        this.package_name = original_script.package_name;
        this.current_script_index = next_script_index;
        this.waitpid_result = null;
        this.finished_fds = 0;

        const shell_bin = bun.CLI.RunCommand.findShell(env.map.get("PATH") orelse "", cwd) orelse return error.MissingShell;

        var copy_script = try std.ArrayList(u8).initCapacity(manager.allocator, original_script.script.len + 1);
        defer copy_script.deinit();
        try bun.CLI.RunCommand.replacePackageManagerRun(&copy_script, original_script.script);
        try copy_script.append(0);

        var combined_script: [:0]u8 = copy_script.items[0 .. copy_script.items.len - 1 :0];

        var argv = [_]?[*:0]const u8{
            shell_bin,
            "-c",
            combined_script,
            null,
        };
        // Have both stdout and stderr write to the same buffer
        const fdsOut = try std.os.pipe2(0);
        const fdsErr = try std.os.pipe2(0);

        var flags: i32 = bun.C.POSIX_SPAWN_SETSIGDEF | bun.C.POSIX_SPAWN_SETSIGMASK;
        if (comptime Environment.isMac) {
            flags |= bun.C.POSIX_SPAWN_CLOEXEC_DEFAULT;
        }

        const pid = brk: {
            var attr = try PosixSpawn.Attr.init();
            defer attr.deinit();
            try attr.set(@intCast(flags));
            try attr.resetSignals();

            var actions = try PosixSpawn.Actions.init();
            defer actions.deinit();
            try actions.openZ(bun.STDIN_FD, "/dev/null", std.os.O.RDONLY, 0o664);
            try actions.dup2(fdsOut[1], bun.STDOUT_FD);
            try actions.dup2(fdsErr[1], bun.STDERR_FD);

            try actions.chdir(cwd);

            defer {
                _ = bun.sys.close(fdsOut[1]);
                _ = bun.sys.close(fdsErr[1]);
            }
            switch (PosixSpawn.spawnZ(
                argv[0].?,
                actions,
                attr,
                argv[0..3 :null],
                this.envp,
            )) {
                .err => |err| {
                    Output.prettyErrorln("<r><red>error<r>: Failed to spawn script <b>{s}<r> due to error <b>{d} {s}<r>", .{
                        name,
                        err.errno,
                        @tagName(err.getErrno()),
                    });
                    Output.flush();
                    return;
                },
                .result => |pid| break :brk pid,
            }
        };

        this.pid = pid;

        const pid_fd: std.os.fd_t = brk: {
            if (!Environment.isLinux or WaiterThread.shouldUseWaiterThread()) {
                break :brk pid;
            }

            var pidfd_flags = JSC.Subprocess.pidfdFlagsForLinux();

            var fd = std.os.linux.pidfd_open(
                @intCast(pid),
                pidfd_flags,
            );

            while (true) {
                switch (std.os.linux.getErrno(fd)) {
                    .SUCCESS => break :brk @intCast(fd),
                    .INTR => {
                        fd = std.os.linux.pidfd_open(
                            @intCast(pid),
                            pidfd_flags,
                        );
                        continue;
                    },
                    else => |err| {
                        if (err == .INVAL) {
                            if (pidfd_flags != 0) {
                                fd = std.os.linux.pidfd_open(
                                    @intCast(pid),
                                    0,
                                );
                                pidfd_flags = 0;
                                continue;
                            }
                        }

                        if (err == .NOSYS) {
                            WaiterThread.setShouldUseWaiterThread();
                            break :brk pid;
                        }

                        var status: u32 = 0;
                        // ensure we don't leak the child process on error
                        _ = std.os.linux.waitpid(pid, &status, 0);

                        Output.prettyErrorln("<r><red>error<r>: Failed to spawn script <b>{s}<r> due to error <b>{d} {s}<r>", .{
                            name,
                            err,
                            @tagName(err),
                        });
                        Output.flush();
                        return;
                    },
                }
            }
        };

        this.stdout = .{
            .parent = this,
            .poll = Async.FilePoll.initWithPackageManager(manager, fdsOut[0], .{}, &this.stdout),
        };

        this.stderr = .{
            .parent = this,
            .poll = Async.FilePoll.initWithPackageManager(manager, fdsErr[0], .{}, &this.stderr),
        };

        try this.stdout.start().unwrap();
        try this.stderr.start().unwrap();

        if (WaiterThread.shouldUseWaiterThread()) {
            WaiterThread.appendLifecycleScriptSubprocess(this);
        } else {
            this.pid_poll = Async.FilePoll.initWithPackageManager(
                manager,
                pid_fd,
                .{},
                @as(*PidPollData, @ptrCast(this)),
            );
            switch (this.pid_poll.register(
                this.manager.uws_event_loop,
                .process,
                true,
            )) {
                .result => {},
                .err => |err| {
                    // Sometimes the pid poll can fail to register if the process exits
                    // between posix_spawn() and pid_poll.register(), but it is unlikely.
                    // Any other error is unexpected here.
                    if (err.getErrno() != .SRCH) {
                        @panic("This shouldn't happen. Could not register pid poll");
                    }

                    this.onProcessUpdate(0);
                },
            }
        }
    }

    pub fn printOutput(this: *LifecycleScriptSubprocess) void {
        if (this.stdout.buffer.items.len +| this.stderr.buffer.items.len == 0) {
            return;
        }

        Output.disableBuffering();
        Output.flush();

        if (this.stdout.buffer.items.len > 0) {
            Output.errorWriter().print("{s}\n", .{this.stdout.buffer.items}) catch {};
            this.stdout.buffer.clearAndFree();
        }

        if (this.stderr.buffer.items.len > 0) {
            Output.errorWriter().print("{s}\n", .{this.stderr.buffer.items}) catch {};
            this.stderr.buffer.clearAndFree();
        }

        Output.enableBuffering();
    }

    pub fn onProcessUpdate(this: *LifecycleScriptSubprocess, _: i64) void {
        while (true) {
            switch (PosixSpawn.waitpid(this.pid, std.os.W.NOHANG)) {
                .err => |err| {
                    Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> script from \"<b>{s}<r>\" due to error <b>{d} {s}<r>", .{
                        this.script_name,
                        this.package_name,
                        err.errno,
                        @tagName(err.getErrno()),
                    });
                    Output.flush();
                    _ = this.manager.pending_lifecycle_script_tasks.fetchSub(1, .Monotonic);
                    _ = alive_count.fetchSub(1, .Monotonic);
                    return;
                },
                .result => |result| {
                    if (result.pid != this.pid) {
                        continue;
                    }
                    this.onResult(result);
                    return;
                },
            }
        }
    }

    /// This function may free the *LifecycleScriptSubprocess
    pub fn onResult(this: *LifecycleScriptSubprocess, result: PosixSpawn.WaitPidResult) void {
        _ = alive_count.fetchSub(1, .Monotonic);
        if (result.pid == 0) {
            Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> script from \"<b>{s}<r>\" due to error <b>{d} {s}<r>", .{
                this.script_name,
                this.package_name,
                0,
                "Unknown",
            });
            this.deinit();
            Output.flush();
            Global.exit(1);
            return;
        }
        if (std.os.W.IFEXITED(result.status)) {
            std.debug.assert(this.finished_fds <= 2);
            if (this.finished_fds < 2) {
                this.waitpid_result = result;
                return;
            }

            const code = std.os.W.EXITSTATUS(result.status);
            if (code > 0) {
                this.printOutput();
                Output.prettyErrorln("<r><red>error<r><d>:<r> <b>{s}<r> script from \"<b>{s}<r>\" exited with {any}<r>", .{
                    this.script_name,
                    this.package_name,
                    bun.SignalCode.from(code),
                });
                this.deinit();
                Output.flush();
                Global.exit(code);
            }

            if (this.manager.scripts_node) |scripts_node| {
                if (this.manager.finished_installing.load(.Monotonic)) {
                    scripts_node.completeOne();
                } else {
                    _ = @atomicRmw(usize, &scripts_node.unprotected_completed_items, .Add, 1, .Monotonic);
                }
            }

            for (this.current_script_index + 1..Lockfile.Scripts.names.len) |new_script_index| {
                if (this.scripts[new_script_index] != null) {
                    this.resetPolls();
                    this.spawnNextScript(new_script_index) catch |err| {
                        Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{
                            Lockfile.Scripts.names[new_script_index],
                            @errorName(err),
                        });
                        Global.exit(1);
                    };
                    return;
                }
            }

            // the last script finished
            _ = this.manager.pending_lifecycle_script_tasks.fetchSub(1, .Monotonic);

            if (this.finished_fds == 2) {
                this.deinit();
            }
            return;
        }
        if (std.os.W.IFSIGNALED(result.status)) {
            const signal = std.os.W.TERMSIG(result.status);

            if (this.finished_fds < 2) {
                this.waitpid_result = result;
                return;
            }
            this.printOutput();
            Output.prettyErrorln("<r><red>error<r><d>:<r> <b>{s}<r> script from \"<b>{s}<r>\" exited with {any}<r>", .{
                this.script_name,
                this.package_name,
                bun.SignalCode.from(signal),
            });
            Output.flush();
            Global.exit(1);
        }
        if (std.os.W.IFSTOPPED(result.status)) {
            const signal = std.os.W.STOPSIG(result.status);

            if (this.finished_fds < 2) {
                this.waitpid_result = result;
                return;
            }
            this.printOutput();
            Output.prettyErrorln("<r><red>error<r><d>:<r> <b>{s}<r> script from \"<b>{s}<r>\" was stopped by signal {any}<r>", .{
                this.script_name,
                this.package_name,
                bun.SignalCode.from(signal),
            });
            Output.flush();
            Global.exit(1);
        }

        std.debug.panic("{s} script from \"<b>{s}<r>\" hit unexpected state {{ .pid = {d}, .status = {d} }}", .{ this.script_name, this.package_name, result.pid, result.status });
    }

    pub fn resetPolls(this: *LifecycleScriptSubprocess) void {
        std.debug.assert(this.finished_fds == 2);

        const loop = this.manager.uws_event_loop;

        if (!WaiterThread.shouldUseWaiterThread()) {
            _ = this.pid_poll.unregister(loop, false);
            // FD is already closed
        }
    }

    pub fn deinit(this: *LifecycleScriptSubprocess) void {
        this.resetPolls();
        this.stdout.buffer.clearAndFree();
        this.stderr.buffer.clearAndFree();
        this.manager.allocator.destroy(this);
    }

    pub fn spawnPackageScripts(
        manager: *PackageManager,
        list: Lockfile.Package.Scripts.List,
        envp: [:null]?[*:0]u8,
    ) !void {
        var lifecycle_subprocess = try manager.allocator.create(LifecycleScriptSubprocess);
        lifecycle_subprocess.scripts = list.items;
        lifecycle_subprocess.manager = manager;
        lifecycle_subprocess.envp = envp;

        lifecycle_subprocess.spawnNextScript(list.first_index) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{
                Lockfile.Scripts.names[list.first_index],
                @errorName(err),
            });
        };

        _ = manager.pending_lifecycle_script_tasks.fetchAdd(1, .Monotonic);
    }
};
