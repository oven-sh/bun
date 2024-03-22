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

const Process = bun.spawn.Process;
const log = Output.scoped(.Script, false);
pub const LifecycleScriptSubprocess = struct {
    package_name: []const u8,

    scripts: Lockfile.Package.Scripts.List,
    current_script_index: u8 = 0,

    remaining_fds: i8 = 0,
    process: ?*Process = null,
    stdout: OutputReader = OutputReader.init(@This()),
    stderr: OutputReader = OutputReader.init(@This()),
    has_called_process_exit: bool = false,
    manager: *PackageManager,
    envp: [:null]?[*:0]u8,

    timer: ?Timer = null,

    has_incremented_alive_count: bool = false,

    pub usingnamespace bun.New(@This());

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
        std.debug.assert(this.current_script_index < Lockfile.Scripts.names.len);
        return Lockfile.Scripts.names[this.current_script_index];
    }

    pub fn onReaderDone(this: *LifecycleScriptSubprocess) void {
        std.debug.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;

        this.maybeFinished();
    }

    pub fn onReaderError(this: *LifecycleScriptSubprocess, err: bun.sys.Error) void {
        std.debug.assert(this.remaining_fds > 0);
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

    pub fn spawnNextScript(this: *LifecycleScriptSubprocess, next_script_index: u8) !void {
        if (!this.has_incremented_alive_count) {
            this.has_incremented_alive_count = true;
            _ = alive_count.fetchAdd(1, .Monotonic);
        }

        errdefer {
            if (this.has_incremented_alive_count) {
                this.has_incremented_alive_count = false;
                _ = alive_count.fetchSub(1, .Monotonic);
            }
        }

        const manager = this.manager;
        const original_script = this.scripts.items[next_script_index].?;
        const cwd = bun.path.z(this.scripts.cwd, &cwd_z_buf);
        const env = manager.env;
        this.stdout.setParent(this);
        this.stderr.setParent(this);

        if (manager.scripts_node) |scripts_node| {
            manager.setNodeName(
                scripts_node,
                this.package_name,
                PackageManager.ProgressStrings.script_emoji,
                true,
            );
            if (manager.finished_installing.load(.Monotonic)) {
                scripts_node.activate();
                manager.progress.refresh();
            }
        }

        this.current_script_index = next_script_index;
        this.has_called_process_exit = false;

        const shell_bin = bun.CLI.RunCommand.findShell(env.get("PATH") orelse "", cwd) orelse return error.MissingShell;

        var copy_script = try std.ArrayList(u8).initCapacity(manager.allocator, original_script.script.len + 1);
        defer copy_script.deinit();
        try bun.CLI.RunCommand.replacePackageManagerRun(&copy_script, original_script.script);
        try copy_script.append(0);

        const combined_script: [:0]u8 = copy_script.items[0 .. copy_script.items.len - 1 :0];

        log("{s} - {s} $ {s}", .{ this.package_name, this.scriptName(), combined_script });

        var argv = [_]?[*:0]const u8{
            shell_bin,
            if (Environment.isWindows) "/c" else "-c",
            combined_script,
            null,
        };
        if (Environment.isWindows) {
            this.stdout.source = .{ .pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() };
            this.stderr.source = .{ .pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() };
        }
        const spawn_options = bun.spawn.SpawnOptions{
            .stdin = .ignore,
            .stdout = if (this.manager.options.log_level.isVerbose())
                .inherit
            else if (Environment.isPosix)
                .buffer
            else
                .{
                    .buffer = this.stdout.source.?.pipe,
                },
            .stderr = if (this.manager.options.log_level.isVerbose())
                .inherit
            else if (Environment.isPosix)
                .buffer
            else
                .{
                    .buffer = this.stderr.source.?.pipe,
                },
            .cwd = cwd,

            .windows = if (Environment.isWindows)
                .{
                    .loop = JSC.EventLoopHandle.init(&manager.event_loop),
                }
            else {},

            .stream = false,
        };

        this.remaining_fds = 0;
        var spawned = try (try bun.spawn.spawnProcess(&spawn_options, @ptrCast(&argv), this.envp)).unwrap();

        if (comptime Environment.isPosix) {
            if (spawned.stdout) |stdout| {
                if (!spawned.memfds[1]) {
                    this.stdout.setParent(this);
                    this.remaining_fds += 1;
                    try this.stdout.start(stdout, true).unwrap();
                } else {
                    this.stdout.setParent(this);
                    this.stdout.startMemfd(stdout);
                }
            }
            if (spawned.stderr) |stderr| {
                if (!spawned.memfds[2]) {
                    this.stderr.setParent(this);
                    this.remaining_fds += 1;
                    try this.stderr.start(stderr, true).unwrap();
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

        try process.watch(event_loop).unwrap();
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
            _ = alive_count.fetchSub(1, .Monotonic);
        }

        switch (status) {
            .exited => |exit| {
                const maybe_duration = if (this.timer) |*t| t.read() else null;

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

                // the last script finished
                _ = this.manager.pending_lifecycle_script_tasks.fetchSub(1, .Monotonic);
                this.deinit();
            },
            .signaled => |signal| {
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
            std.debug.assert(this.remaining_fds == 0);
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

        if (!this.manager.options.log_level.isVerbose()) {
            this.stdout.deinit();
            this.stderr.deinit();
        }

        this.destroy();
    }

    pub fn spawnPackageScripts(
        manager: *PackageManager,
        list: Lockfile.Package.Scripts.List,
        envp: [:null]?[*:0]u8,
        comptime log_level: PackageManager.Options.LogLevel,
    ) !void {
        var lifecycle_subprocess = LifecycleScriptSubprocess.new(.{
            .manager = manager,
            .envp = envp,
            .scripts = list,
            .package_name = list.package_name,
        });

        if (comptime log_level.isVerbose()) {
            Output.prettyErrorln("<d>[LifecycleScriptSubprocess]<r> Starting scripts for <b>\"{s}\"<r>", .{
                list.package_name,
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
