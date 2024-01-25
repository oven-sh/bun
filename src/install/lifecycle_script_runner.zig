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
const WaiterThread = bun.spawn.WaiterThread;
const Timer = std.time.Timer;

const Process = bun.spawn.ProcessMiniEventLoop;
pub const LifecycleScriptSubprocess = struct {
    package_name: []const u8,

    scripts: [6]?Lockfile.Scripts.Entry,
    current_script_index: u8 = 0,

    finished_fds: u8 = 0,
    process: ?*Process = null,
    stdout: OutputReader = .{},
    stderr: OutputReader = .{},
    manager: *PackageManager,
    envp: [:null]?[*:0]u8,

    timer: ?Timer = null,

    pub const min_milliseconds_to_log = 500;

    pub var alive_count: std.atomic.Value(usize) = std.atomic.Value(usize).init(0);

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
            return this.poll.fd;
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
                        this.subprocess().scriptName(),
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

    pub fn scriptName(this: *const LifecycleScriptSubprocess) []const u8 {
        std.debug.assert(this.current_script_index < Lockfile.Scripts.names.len);
        return Lockfile.Scripts.names[this.current_script_index];
    }

    pub fn onOutputDone(this: *LifecycleScriptSubprocess) void {
        std.debug.assert(this.finished_fds < 2);
        this.finished_fds += 1;

        this.maybeFinished();
    }

    pub fn onOutputError(this: *LifecycleScriptSubprocess, err: bun.sys.Error) void {
        std.debug.assert(this.finished_fds < 2);
        this.finished_fds += 1;

        Output.prettyErrorln("<r><red>error<r>: Failed to read <b>{s}<r> script output from \"<b>{s}<r>\" due to error <b>{d} {s}<r>", .{
            this.scriptName(),
            this.package_name,
            err.errno,
            @tagName(err.getErrno()),
        });
        Output.flush();
        this.maybeFinished();
    }

    fn maybeFinished(this: *LifecycleScriptSubprocess) void {
        if (this.process) |process| {
            if (process.hasExited()) {
                if (this.finished_fds == 2) {
                    this.onProcessExit(process, process.status, undefined);
                }
            }
        }
    }

    pub fn spawnNextScript(this: *LifecycleScriptSubprocess, next_script_index: u8) !void {
        if (Environment.isWindows) {
            @panic("TODO");
        }

        _ = alive_count.fetchAdd(1, .Monotonic);
        errdefer _ = alive_count.fetchSub(1, .Monotonic);

        const manager = this.manager;
        const original_script = this.scripts[next_script_index].?;
        const cwd = original_script.cwd;
        const env = manager.env;

        if (manager.scripts_node) |scripts_node| {
            manager.setNodeName(
                scripts_node,
                original_script.package_name,
                PackageManager.ProgressStrings.script_emoji,
                true,
            );
            if (manager.finished_installing.load(.Monotonic)) {
                scripts_node.activate();
                manager.progress.refresh();
            }
        }

        this.package_name = original_script.package_name;
        this.current_script_index = next_script_index;
        this.finished_fds = 0;

        const shell_bin = bun.CLI.RunCommand.findShell(env.map.get("PATH") orelse "", cwd) orelse return error.MissingShell;

        var copy_script = try std.ArrayList(u8).initCapacity(manager.allocator, original_script.script.len + 1);
        defer copy_script.deinit();
        try bun.CLI.RunCommand.replacePackageManagerRun(&copy_script, original_script.script);
        try copy_script.append(0);

        const combined_script: [:0]u8 = copy_script.items[0 .. copy_script.items.len - 1 :0];

        var argv = [_]?[*:0]const u8{
            shell_bin,
            if (Environment.isWindows) "/c" else "-c",
            combined_script,
            null,
        };
        // Have both stdout and stderr write to the same buffer
        const fdsOut, const fdsErr = if (!this.manager.options.log_level.isVerbose())
            .{ try std.os.pipe2(0), try std.os.pipe2(0) }
        else
            .{ .{ 0, 0 }, .{ 0, 0 } };

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

            if (!this.manager.options.log_level.isVerbose()) {
                try actions.dup2(bun.toFD(fdsOut[1]), bun.STDOUT_FD);
                try actions.dup2(bun.toFD(fdsErr[1]), bun.STDERR_FD);
            } else {
                if (comptime Environment.isMac) {
                    try actions.inherit(bun.STDOUT_FD);
                    try actions.inherit(bun.STDERR_FD);
                } else {
                    try actions.dup2(bun.STDOUT_FD, bun.STDOUT_FD);
                    try actions.dup2(bun.STDERR_FD, bun.STDERR_FD);
                }
            }

            try actions.chdir(cwd);

            defer {
                if (!this.manager.options.log_level.isVerbose()) {
                    _ = bun.sys.close(bun.toFD(fdsOut[1]));
                    _ = bun.sys.close(bun.toFD(fdsErr[1]));
                }
            }

            if (manager.options.log_level.isVerbose()) {
                Output.prettyErrorln("<d>[LifecycleScriptSubprocess]<r> Spawning <b>\"{s}\"<r> script for package <b>\"{s}\"<r>\ncwd: {s}\n<r><d><magenta>$<r> <d><b>{s}<r>", .{
                    this.scriptName(),
                    this.package_name,
                    cwd,
                    combined_script,
                });
            }

            this.timer = Timer.start() catch null;

            switch (PosixSpawn.spawnZ(
                argv[0].?,
                actions,
                attr,
                argv[0..3 :null],
                this.envp,
            )) {
                .err => |err| {
                    Output.prettyErrorln("<r><red>error<r>: Failed to spawn script <b>{s}<r> due to error <b>{d} {s}<r>", .{
                        this.scriptName(),
                        err.errno,
                        @tagName(err.getErrno()),
                    });
                    Output.flush();
                    return;
                },
                .result => |pid| break :brk pid,
            }
        };

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
                            this.scriptName(),
                            err,
                            @tagName(err),
                        });
                        Output.flush();
                        return;
                    },
                }
            }
        };

        if (!this.manager.options.log_level.isVerbose()) {
            this.stdout = .{
                .parent = this,
                .poll = Async.FilePoll.initWithPackageManager(manager, bun.toFD(fdsOut[0]), .{}, &this.stdout),
            };

            this.stderr = .{
                .parent = this,
                .poll = Async.FilePoll.initWithPackageManager(manager, bun.toFD(fdsErr[0]), .{}, &this.stderr),
            };
            try this.stdout.start().unwrap();
            try this.stderr.start().unwrap();
        }

        const event_loop = this.manager;
        var process = Process.initPosix(pid, @intCast(pid_fd), event_loop, false);
        if (this.process) |proc| {
            proc.detach();
            proc.deref();
        }
        process.setExitHandler(this);
        this.process = process;
        try process.watch(event_loop).unwrap();
    }

    pub fn printOutput(this: *LifecycleScriptSubprocess) void {
        if (!this.manager.options.log_level.isVerbose()) {
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
    }

    /// This function may free the *LifecycleScriptSubprocess
    pub fn onProcessExit(this: *LifecycleScriptSubprocess, _: *Process, status: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        switch (status) {
            .exited => |exit| {
                const maybe_duration = if (this.timer) |*t| t.read() else null;
                if (!this.manager.options.log_level.isVerbose()) {
                    std.debug.assert(this.finished_fds <= 2);
                    if (this.finished_fds < 2) {
                        return;
                    }
                }

                if (exit.code > 0) {
                    this.printOutput();
                    Output.prettyErrorln("<r><red>error<r><d>:<r> <b>{s}<r> script from \"<b>{s}<r>\" exited with {d}<r>", .{
                        this.scriptName(),
                        this.package_name,
                        exit.code,
                    });
                    this.deinit();
                    Output.flush();
                    Global.exit(exit.code);
                }

                if (this.manager.scripts_node) |scripts_node| {
                    if (this.manager.finished_installing.load(.Monotonic)) {
                        scripts_node.completeOne();
                    } else {
                        _ = @atomicRmw(usize, &scripts_node.unprotected_completed_items, .Add, 1, .Monotonic);
                    }
                }

                if (maybe_duration) |nanos| {
                    if (nanos > min_milliseconds_to_log * std.time.ns_per_ms) {
                        this.manager.lifecycle_script_time_log.appendConcurrent(
                            this.manager.lockfile.allocator,
                            .{
                                .package_name = this.package_name,
                                .script_id = this.current_script_index,
                                .duration = nanos,
                            },
                        );
                    }
                }

                for (this.current_script_index + 1..Lockfile.Scripts.names.len) |new_script_index| {
                    if (this.scripts[new_script_index] != null) {
                        this.resetPolls();
                        this.spawnNextScript(@intCast(new_script_index)) catch |err| {
                            Output.errGeneric("Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{
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

                if (!this.manager.options.log_level.isVerbose()) {
                    if (this.finished_fds == 2) {
                        this.deinit();
                    }
                } else {
                    this.deinit();
                }
            },
            .signaled => |signal| {
                if (!this.manager.options.log_level.isVerbose()) {
                    if (this.finished_fds < 2) {
                        return;
                    }
                }
                this.printOutput();
                Output.prettyErrorln("<r><red>error<r><d>:<r> <b>{s}<r> script from \"<b>{s}<r>\" terminated by {}<r>", .{
                    this.scriptName(),
                    this.package_name,

                    bun.SignalCode.from(signal).fmt(Output.enable_ansi_colors_stderr),
                });
                Global.raiseIgnoringPanicHandler(@intFromEnum(signal));

                return;
            },
            .err => |err| {
                Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> script from \"<b>{s}<r>\" due to\n{}", .{
                    this.scriptName(),
                    this.package_name,
                    err,
                });
                this.deinit();
                Output.flush();
                Global.exit(1);
                return;
            },
            else => {
                Output.panic("<r><red>error<r>: Failed to run <b>{s}<r> script from \"<b>{s}<r>\" due to unexpected status\n{any}", .{
                    this.scriptName(),
                    this.package_name,
                    status,
                });
            },
        }
    }

    pub fn resetPolls(this: *LifecycleScriptSubprocess) void {
        if (!this.manager.options.log_level.isVerbose()) {
            std.debug.assert(this.finished_fds == 2);
        }

        if (this.process) |process| {
            this.process = null;
            process.close();
            process.deref();
        }
    }

    pub fn deinit(this: *LifecycleScriptSubprocess) void {
        this.resetPolls();
        if (this.process) |process| {
            this.process = null;
            process.detach();
            process.deref();
        }

        if (!this.manager.options.log_level.isVerbose()) {
            this.stdout.buffer.clearAndFree();
            this.stderr.buffer.clearAndFree();
        }
        this.manager.allocator.destroy(this);
    }

    pub fn spawnPackageScripts(
        manager: *PackageManager,
        list: Lockfile.Package.Scripts.List,
        envp: [:null]?[*:0]u8,
        comptime log_level: PackageManager.Options.LogLevel,
    ) !void {
        var lifecycle_subprocess = try manager.allocator.create(LifecycleScriptSubprocess);
        lifecycle_subprocess.scripts = list.items;
        lifecycle_subprocess.manager = manager;
        lifecycle_subprocess.envp = envp;

        if (comptime log_level.isVerbose()) {
            Output.prettyErrorln("<d>[LifecycleScriptSubprocess]<r> Starting scripts for <b>\"{s}\"<r>", .{
                list.first().package_name,
            });
        }

        _ = manager.pending_lifecycle_script_tasks.fetchAdd(1, .Monotonic);

        lifecycle_subprocess.spawnNextScript(list.first_index) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{
                Lockfile.Scripts.names[list.first_index],
                @errorName(err),
            });
        };
    }
};
