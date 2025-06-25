const bun = @import("bun");
const Lockfile = @import("./lockfile.zig");
const std = @import("std");
const PackageManager = @import("./install.zig").PackageManager;
const Environment = bun.Environment;
const Output = bun.Output;
const Global = bun.Global;
const JSC = bun.JSC;
const Timer = std.time.Timer;
const string = bun.string;

const Process = bun.spawn.Process;
const log = Output.scoped(.Script, false);
pub const LifecycleScriptSubprocess = struct {
    package_name: string,

    scripts: Lockfile.Package.Scripts.List,
    current_script_index: u8 = 0,

    remaining_fds: i8 = 0,
    process: ?*Process = null,
    stdout: OutputReader = OutputReader.init(@This()),
    stderr: OutputReader = OutputReader.init(@This()),
    has_called_process_exit: bool = false,
    manager: *PackageManager,
    envp: [:null]?[*:0]const u8,

    timer: ?Timer = null,

    has_incremented_alive_count: bool = false,

    foreground: bool = false,
    optional: bool = false,
    started_at: u64 = 0,

    heap: bun.io.heap.IntrusiveField(LifecycleScriptSubprocess) = .{},

    pub const List = bun.io.heap.Intrusive(LifecycleScriptSubprocess, *PackageManager, sortByStartedAt);

    fn sortByStartedAt(_: *PackageManager, a: *LifecycleScriptSubprocess, b: *LifecycleScriptSubprocess) bool {
        return a.started_at < b.started_at;
    }

    pub const new = bun.TrivialNew(@This());

    pub const min_milliseconds_to_log = 500;

    pub var alive_count: std.atomic.Value(usize) = std.atomic.Value(usize).init(0);

    const uv = bun.windows.libuv;

    pub const OutputReader = bun.io.BufferedReader;

    pub fn loop(this: *const LifecycleScriptSubprocess) *bun.uws.Loop {
        return this.manager.event_loop.loop();
    }

    pub fn eventLoop(this: *const LifecycleScriptSubprocess) *JSC.AnyEventLoop {
        return &this.manager.event_loop;
    }

    pub fn scriptName(this: *const LifecycleScriptSubprocess) []const u8 {
        bun.assert(this.current_script_index < Lockfile.Scripts.names.len);
        return Lockfile.Scripts.names[this.current_script_index];
    }

    pub fn onReaderDone(this: *LifecycleScriptSubprocess) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;

        this.maybeFinished();
    }

    pub fn onReaderError(this: *LifecycleScriptSubprocess, err: bun.sys.Error) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;

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
        if (!this.has_called_process_exit or this.remaining_fds != 0)
            return;

        const process = this.process orelse return;

        this.handleExit(process.status);
    }

    // This is only used on the main thread.
    var cwd_z_buf: bun.PathBuffer = undefined;

    fn resetOutputFlags(output: *OutputReader, fd: bun.FileDescriptor) void {
        output.flags.nonblocking = true;
        output.flags.socket = true;
        output.flags.memfd = false;
        output.flags.received_eof = false;
        output.flags.closed_without_reporting = false;

        if (comptime Environment.allow_assert) {
            const flags = bun.sys.getFcntlFlags(fd).unwrap() catch @panic("Failed to get fcntl flags");
            bun.assertWithLocation(flags & bun.O.NONBLOCK != 0, @src());

            const stat = bun.sys.fstat(fd).unwrap() catch @panic("Failed to fstat");
            bun.assertWithLocation(std.posix.S.ISSOCK(stat.mode), @src());
        }
    }

    fn ensureNotInHeap(this: *LifecycleScriptSubprocess) void {
        if (this.heap.child != null or this.heap.next != null or this.heap.prev != null or this.manager.active_lifecycle_scripts.root == this) {
            this.manager.active_lifecycle_scripts.remove(this);
        }
    }

    pub fn spawnNextScript(this: *LifecycleScriptSubprocess, next_script_index: u8) !void {
        bun.Analytics.Features.lifecycle_scripts += 1;

        if (!this.has_incremented_alive_count) {
            this.has_incremented_alive_count = true;
            _ = alive_count.fetchAdd(1, .monotonic);
        }

        errdefer {
            if (this.has_incremented_alive_count) {
                this.has_incremented_alive_count = false;
                _ = alive_count.fetchSub(1, .monotonic);
            }

            this.ensureNotInHeap();
        }

        const manager = this.manager;
        const original_script = this.scripts.items[next_script_index].?;
        const cwd = this.scripts.cwd;
        const env = manager.env;
        this.stdout.setParent(this);
        this.stderr.setParent(this);

        this.ensureNotInHeap();

        this.current_script_index = next_script_index;
        this.has_called_process_exit = false;

        const shell_bin = if (Environment.isWindows) null else bun.CLI.RunCommand.findShell(env.get("PATH") orelse "", cwd) orelse null;

        var copy_script = try std.ArrayList(u8).initCapacity(manager.allocator, original_script.script.len + 1);
        defer copy_script.deinit();
        try bun.CLI.RunCommand.replacePackageManagerRun(&copy_script, original_script.script);
        try copy_script.append(0);

        const combined_script: [:0]u8 = copy_script.items[0 .. copy_script.items.len - 1 :0];

        if (this.foreground and this.manager.options.log_level != .silent) {
            Output.command(combined_script);
        } else if (manager.scripts_node) |scripts_node| {
            manager.setNodeName(
                scripts_node,
                this.package_name,
                PackageManager.ProgressStrings.script_emoji,
                true,
            );
            if (manager.finished_installing.load(.monotonic)) {
                scripts_node.activate();
                manager.progress.refresh();
            }
        }

        log("{s} - {s} $ {s}", .{ this.package_name, this.scriptName(), combined_script });

        var argv = if (shell_bin != null and !Environment.isWindows) [_]?[*:0]const u8{
            shell_bin.?,
            "-c",
            combined_script,
            null,
        } else [_]?[*:0]const u8{
            try bun.selfExePath(),
            "exec",
            combined_script,
            null,
        };
        if (Environment.isWindows) {
            this.stdout.source = .{ .pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() };
            this.stderr.source = .{ .pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() };
        }
        const spawn_options = bun.spawn.SpawnOptions{
            .stdin = if (this.foreground)
                .inherit
            else
                .ignore,

            .stdout = if (this.manager.options.log_level == .silent)
                .ignore
            else if (this.manager.options.log_level.isVerbose() or this.foreground)
                .inherit
            else if (Environment.isPosix)
                .buffer
            else
                .{
                    .buffer = this.stdout.source.?.pipe,
                },
            .stderr = if (this.manager.options.log_level == .silent)
                .ignore
            else if (this.manager.options.log_level.isVerbose() or this.foreground)
                .inherit
            else if (Environment.isPosix)
                .buffer
            else
                .{
                    .buffer = this.stderr.source.?.pipe,
                },
            .cwd = cwd,

            .windows = if (Environment.isWindows) .{
                .loop = JSC.EventLoopHandle.init(&manager.event_loop),
            },

            .stream = false,
        };

        this.remaining_fds = 0;
        this.started_at = bun.timespec.now().ns();
        this.manager.active_lifecycle_scripts.insert(this);
        var spawned = try (try bun.spawn.spawnProcess(&spawn_options, @ptrCast(&argv), this.envp)).unwrap();

        if (comptime Environment.isPosix) {
            if (spawned.stdout) |stdout| {
                if (!spawned.memfds[1]) {
                    this.stdout.setParent(this);
                    _ = bun.sys.setNonblocking(stdout);
                    this.remaining_fds += 1;

                    resetOutputFlags(&this.stdout, stdout);
                    try this.stdout.start(stdout, true).unwrap();
                    if (this.stdout.handle.getPoll()) |poll| {
                        poll.flags.insert(.socket);
                    }
                } else {
                    this.stdout.setParent(this);
                    this.stdout.startMemfd(stdout);
                }
            }
            if (spawned.stderr) |stderr| {
                if (!spawned.memfds[2]) {
                    this.stderr.setParent(this);
                    _ = bun.sys.setNonblocking(stderr);
                    this.remaining_fds += 1;

                    resetOutputFlags(&this.stderr, stderr);
                    try this.stderr.start(stderr, true).unwrap();
                    if (this.stderr.handle.getPoll()) |poll| {
                        poll.flags.insert(.socket);
                    }
                } else {
                    this.stderr.setParent(this);
                    this.stderr.startMemfd(stderr);
                }
            }
        } else if (comptime Environment.isWindows) {
            if (spawned.stdout == .buffer) {
                this.stdout.parent = this;
                this.remaining_fds += 1;
                try this.stdout.startWithCurrentPipe().unwrap();
            }
            if (spawned.stderr == .buffer) {
                this.stderr.parent = this;
                this.remaining_fds += 1;
                try this.stderr.startWithCurrentPipe().unwrap();
            }
        }

        const event_loop = &this.manager.event_loop;
        var process = spawned.toProcess(
            event_loop,
            false,
        );

        if (this.process) |proc| {
            proc.detach();
            proc.deref();
        }

        this.process = process;
        process.setExitHandler(this);

        switch (process.watchOrReap()) {
            .err => |err| {
                if (!process.hasExited())
                    process.onExit(.{ .err = err }, &std.mem.zeroes(bun.spawn.Rusage));
            },
            .result => {},
        }
    }

    pub fn printOutput(this: *LifecycleScriptSubprocess) void {
        if (!this.manager.options.log_level.isVerbose()) {
            var stdout = this.stdout.finalBuffer();

            // Reuse the memory
            if (stdout.items.len == 0 and stdout.capacity > 0 and this.stderr.buffer().capacity == 0) {
                this.stderr.buffer().* = stdout.*;
                stdout.* = std.ArrayList(u8).init(bun.default_allocator);
            }

            var stderr = this.stderr.finalBuffer();

            if (stdout.items.len +| stderr.items.len == 0) {
                return;
            }

            Output.disableBuffering();
            Output.flush();

            if (stdout.items.len > 0) {
                Output.errorWriter().print("{s}\n", .{stdout.items}) catch {};
                stdout.clearAndFree();
            }

            if (stderr.items.len > 0) {
                Output.errorWriter().print("{s}\n", .{stderr.items}) catch {};
                stderr.clearAndFree();
            }

            Output.enableBuffering();
        }
    }

    fn handleExit(this: *LifecycleScriptSubprocess, status: bun.spawn.Status) void {
        log("{s} - {s} finished {}", .{ this.package_name, this.scriptName(), status });

        if (this.has_incremented_alive_count) {
            this.has_incremented_alive_count = false;
            _ = alive_count.fetchSub(1, .monotonic);
        }

        this.ensureNotInHeap();

        switch (status) {
            .exited => |exit| {
                const maybe_duration = if (this.timer) |*t| t.read() else null;

                if (exit.code > 0) {
                    if (this.optional) {
                        _ = this.manager.pending_lifecycle_script_tasks.fetchSub(1, .monotonic);
                        this.deinitAndDeletePackage();
                        return;
                    }
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

                if (!this.foreground and this.manager.scripts_node != null) {
                    if (this.manager.finished_installing.load(.monotonic)) {
                        this.manager.scripts_node.?.completeOne();
                    } else {
                        _ = @atomicRmw(usize, &this.manager.scripts_node.?.unprotected_completed_items, .Add, 1, .monotonic);
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
                    if (this.scripts.items[new_script_index] != null) {
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

                if (PackageManager.verbose_install) {
                    Output.prettyErrorln("<r><d>[Scripts]<r> Finished scripts for <b>{}<r>", .{
                        bun.fmt.quote(this.package_name),
                    });
                }

                // the last script finished
                _ = this.manager.pending_lifecycle_script_tasks.fetchSub(1, .monotonic);

                this.deinit();
            },
            .signaled => |signal| {
                this.printOutput();
                const signal_code = bun.SignalCode.from(signal);

                Output.prettyErrorln("<r><red>error<r><d>:<r> <b>{s}<r> script from \"<b>{s}<r>\" terminated by {}<r>", .{
                    this.scriptName(),
                    this.package_name,
                    signal_code.fmt(Output.enable_ansi_colors_stderr),
                });

                Global.raiseIgnoringPanicHandler(signal);
            },
            .err => |err| {
                if (this.optional) {
                    _ = this.manager.pending_lifecycle_script_tasks.fetchSub(1, .monotonic);
                    this.deinitAndDeletePackage();
                    return;
                }

                Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> script from \"<b>{s}<r>\" due to\n{}", .{
                    this.scriptName(),
                    this.package_name,
                    err,
                });
                this.deinit();
                Output.flush();
                Global.exit(1);
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

    /// This function may free the *LifecycleScriptSubprocess
    pub fn onProcessExit(this: *LifecycleScriptSubprocess, proc: *Process, _: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        if (this.process != proc) {
            Output.debugWarn("<d>[LifecycleScriptSubprocess]<r> onProcessExit called with wrong process", .{});
            return;
        }
        this.has_called_process_exit = true;
        this.maybeFinished();
    }

    pub fn resetPolls(this: *LifecycleScriptSubprocess) void {
        if (comptime Environment.allow_assert) {
            bun.assert(this.remaining_fds == 0);
        }

        if (this.process) |process| {
            this.process = null;
            process.close();
            process.deref();
        }

        this.stdout.deinit();
        this.stderr.deinit();
        this.stdout = OutputReader.init(@This());
        this.stderr = OutputReader.init(@This());
    }

    pub fn deinit(this: *LifecycleScriptSubprocess) void {
        this.resetPolls();
        this.ensureNotInHeap();

        if (!this.manager.options.log_level.isVerbose()) {
            this.stdout.deinit();
            this.stderr.deinit();
        }

        bun.destroy(this);
    }

    pub fn deinitAndDeletePackage(this: *LifecycleScriptSubprocess) void {
        if (this.manager.options.log_level.isVerbose()) {
            Output.warn("deleting optional dependency '{s}' due to failed '{s}' script", .{
                this.package_name,
                this.scriptName(),
            });
        }
        try_delete_dir: {
            const dirname = std.fs.path.dirname(this.scripts.cwd) orelse break :try_delete_dir;
            const basename = std.fs.path.basename(this.scripts.cwd);
            const dir = bun.openDirAbsolute(dirname) catch break :try_delete_dir;
            dir.deleteTree(basename) catch break :try_delete_dir;
        }

        this.deinit();
    }

    pub fn spawnPackageScripts(
        manager: *PackageManager,
        list: Lockfile.Package.Scripts.List,
        envp: [:null]?[*:0]const u8,
        optional: bool,
        log_level: PackageManager.Options.LogLevel,
        foreground: bool,
    ) !void {
        var lifecycle_subprocess = LifecycleScriptSubprocess.new(.{
            .manager = manager,
            .envp = envp,
            .scripts = list,
            .package_name = list.package_name,
            .foreground = foreground,
            .optional = optional,
        });

        if (log_level.isVerbose()) {
            Output.prettyErrorln("<d>[Scripts]<r> Starting scripts for <b>\"{s}\"<r>", .{
                list.package_name,
            });
        }

        _ = manager.pending_lifecycle_script_tasks.fetchAdd(1, .monotonic);

        lifecycle_subprocess.spawnNextScript(list.first_index) catch |err| {
            Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{
                Lockfile.Scripts.names[list.first_index],
                @errorName(err),
            });
        };
    }
};
