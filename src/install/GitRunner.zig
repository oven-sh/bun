const bun = @import("bun");
const std = @import("std");
const strings = @import("../string_immutable.zig");
const PackageManager = @import("./install.zig").PackageManager;
const DotEnv = @import("../env_loader.zig");
const Environment = @import("../env.zig");
const Process = bun.spawn.Process;
const Output = bun.Output;
const JSC = bun.JSC;
const ExtractData = @import("./install.zig").ExtractData;
const Path = bun.path;

threadlocal var folder_name_buf: bun.PathBuffer = undefined;

pub const GitRunner = struct {
    process: ?*Process = null,
    stdout: bun.io.BufferedReader = bun.io.BufferedReader.init(@This()),
    stderr: bun.io.BufferedReader = bun.io.BufferedReader.init(@This()),
    manager: *PackageManager,
    remaining_fds: i8 = 0,
    has_called_process_exit: bool = false,
    completion_context: CompletionContext,
    envp: ?DotEnv.NullDelimitedEnvMap = null,
    arena: bun.ArenaAllocator,

    /// Allocator for this runner
    allocator: std.mem.Allocator,

    pub const CompletionContext = union(enum) {
        git_clone: struct {
            name: []const u8,
            url: []const u8,
            task_id: u64,
            attempt: u8,

            dir: union(enum) {
                /// Not yet created. Check it worked by opening the directory.
                cache: std.fs.Dir,

                /// Already downloaded. Exit code of 0 says it worked.
                repo: std.fs.Dir,
            },
        },
        git_find_commit: struct {
            name: []const u8,
            committish: []const u8,
            task_id: u64,
            repo_dir: std.fs.Dir,
        },
        git_checkout: struct {
            name: []const u8,
            url: []const u8,
            resolved: []const u8,
            task_id: u64,
            cache_dir: std.fs.Dir,
            repo_dir: std.fs.Dir,
        },

        pub fn needsStdout(this: *const CompletionContext) bool {
            return switch (this.*) {
                .git_find_commit => true,
                else => false,
            };
        }
    };

    pub const Result = struct {
        task_id: u64,
        pending: bool = false,
        err: ?anyerror = null,

        // The original context is passed back with the result.
        context: CompletionContext,

        // The success payload. Only valid if err is null.
        result: union(enum) {
            git_clone: std.fs.Dir,
            git_find_commit: []const u8,
            git_checkout: ExtractData,
        },
    };

    // Note: The `.Queue` definition needs to be updated to use this new struct.
    pub const Queue = std.fifo.LinearFifo(Result, .Dynamic);

    pub fn gitExecutable() [:0]const u8 {
        const GitExecutableOnce = struct {
            pub var once = std.once(get);
            pub var executable: [:0]const u8 = "";
            fn get() void {
                // First clone without checkout
                const gitpath = bun.PathBufferPool.get();
                defer bun.PathBufferPool.put(gitpath);
                const git = bun.which(gitpath, bun.getenvZ("PATH") orelse "", bun.fs.FileSystem.instance.top_level_dir, "git") orelse "git";
                executable = bun.default_allocator.dupeZ(u8, git) catch bun.outOfMemory();
            }
        };

        GitExecutableOnce.once.call();
        return GitExecutableOnce.executable;
    }

    pub fn init(
        allocator: std.mem.Allocator,
        manager: *PackageManager,
        context: CompletionContext,
    ) !*GitRunner {
        const runner = try allocator.create(GitRunner);
        runner.* = .{
            .manager = manager,
            .completion_context = context,
            .arena = bun.ArenaAllocator.init(allocator),
            .allocator = allocator,
        };

        runner.stdout.setParent(runner);
        runner.stderr.setParent(runner);

        return runner;
    }

    pub fn spawn(this: *GitRunner, argv_slice: []const []const u8, env: ?*const DotEnv.Map) !void {
        if (this.manager.options.log_level.isVerbose()) {
            Output.prettyError("<r><d>$ git", .{});
            for (argv_slice[1..]) |arg| {
                Output.prettyError(" {s}", .{arg});
            }
            Output.prettyErrorln("<r>\n", .{});
            Output.flush();
        }

        const spawn_options = bun.spawn.SpawnOptions{
            .stdin = .ignore,

            .stdout = if (this.manager.options.log_level == .silent and !this.completion_context.needsStdout())
                .ignore
            else if (this.manager.options.log_level.isVerbose() and !this.completion_context.needsStdout())
                .inherit
            else if (Environment.isPosix)
                .buffer
            else
                .{
                    .buffer = this.stdout.source.?.pipe,
                },
            .stderr = if (this.manager.options.log_level == .silent)
                .ignore
            else if (this.manager.options.log_level.isVerbose())
                .inherit
            else if (Environment.isPosix)
                .buffer
            else
                .{
                    .buffer = this.stderr.source.?.pipe,
                },

            .windows = if (Environment.isWindows) .{
                .loop = JSC.EventLoopHandle.init(&this.manager.event_loop),
            },

            .stream = false,
            .cwd = this.manager.cache_directory_path,
        };

        const argv, _ = bun.spawn.allocateArguments(this.arena.allocator(), argv_slice) catch bun.outOfMemory();
        const envp = if (env) |env_map| try env_map.createNullDelimitedEnvMap(this.arena.allocator()) else this.envp.?;
        var spawned = try (try bun.spawn.spawnProcess(&spawn_options, argv, envp)).unwrap();
        this.envp = envp;
        this.remaining_fds = 0;

        if (spawned.stdout) |stdout| {
            this.stdout.setParent(this);
            _ = bun.sys.setNonblocking(stdout);
            this.remaining_fds += 1;

            this.stdout.flags.nonblocking = true;
            this.stdout.flags.socket = true;
            try this.stdout.start(stdout, true).unwrap();
        }

        if (spawned.stderr) |stderr| {
            this.stderr.setParent(this);
            _ = bun.sys.setNonblocking(stderr);
            this.remaining_fds += 1;

            this.stderr.flags.nonblocking = true;
            this.stderr.flags.socket = true;
            try this.stderr.start(stderr, true).unwrap();
        }

        const event_loop = &this.manager.event_loop;
        var process = spawned.toProcess(event_loop, false);
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

    pub fn eventLoop(this: *const GitRunner) *JSC.AnyEventLoop {
        return &this.manager.event_loop;
    }

    pub fn loop(this: *const GitRunner) *bun.uws.Loop {
        return this.manager.event_loop.loop();
    }

    pub fn onReaderDone(this: *GitRunner) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;
        this.maybeFinished();
    }

    pub fn onReaderError(this: *GitRunner, err: bun.sys.Error) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;

        Output.prettyErrorln("<r><red>error<r>: Failed to read git output due to error <b>{d} {s}<r>", .{
            err.errno,
            @tagName(err.getErrno()),
        });
        Output.flush();
        this.maybeFinished();
    }

    pub fn maybeFinished(this: *GitRunner) void {
        if (!this.has_called_process_exit or this.remaining_fds != 0)
            return;

        const process = this.process orelse return;
        this.handleExit(process.status);
    }

    pub fn onProcessExit(this: *GitRunner, proc: *Process, _: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        if (this.process != proc) {
            Output.debugWarn("<d>[GitRunner]<r> onProcessExit called with wrong process", .{});
            return;
        }
        this.has_called_process_exit = true;
        this.maybeFinished();
    }

    pub fn handleExit(this: *GitRunner, status: bun.spawn.Status) void {
        defer this.deinit();

        switch (status) {
            .exited => |exit| {
                if (exit.code == 0) {
                    // Success case
                    const stdout_data = this.stdout.finalBuffer();

                    switch (this.completion_context) {
                        .git_clone => |*ctx| {
                            switch (ctx.dir) {
                                .cache => |cache_dir| {
                                    const buf = bun.PathBufferPool.get();
                                    defer bun.PathBufferPool.put(buf);
                                    const path = Path.joinAbsStringBufZ(PackageManager.get().cache_directory_path, buf, &.{PackageManager.cachedGitFolderNamePrint(&folder_name_buf, ctx.name, null)}, .auto);

                                    if (bun.openDir(cache_dir, path)) |repo_dir| {
                                        this.manager.git_tasks.writeItem(.{
                                            .task_id = ctx.task_id,
                                            .context = .{ .git_clone = ctx.* },
                                            .result = .{ .git_clone = repo_dir },
                                            .pending = true,
                                        }) catch {};
                                    } else |err| {
                                        this.manager.git_tasks.writeItem(.{
                                            .task_id = ctx.task_id,
                                            .context = .{ .git_clone = ctx.* },
                                            .err = err,
                                            .result = undefined,
                                            .pending = true,
                                        }) catch {};
                                    }
                                },
                                .repo => |repo_dir| {
                                    this.manager.git_tasks.writeItem(.{
                                        .task_id = ctx.task_id,
                                        .context = .{ .git_clone = ctx.* },
                                        .result = .{ .git_clone = repo_dir },
                                        .pending = true,
                                    }) catch {};
                                },
                            }
                        },
                        .git_find_commit => |*ctx| {
                            // For find_commit, we need to parse the commit hash from stdout
                            const commit_hash = std.mem.trim(u8, stdout_data.items, " \t\r\n");
                            if (commit_hash.len > 0) {
                                const duped = this.allocator.dupe(u8, commit_hash) catch bun.outOfMemory();
                                this.manager.git_tasks.writeItem(.{
                                    .task_id = ctx.task_id,
                                    .context = .{ .git_find_commit = ctx.* },
                                    .result = .{ .git_find_commit = duped },
                                    .pending = true,
                                }) catch {};
                            } else {
                                this.manager.git_tasks.writeItem(.{
                                    .task_id = ctx.task_id,
                                    .context = .{ .git_find_commit = ctx.* },
                                    .err = error.InstallFailed,
                                    .result = undefined,
                                    .pending = true,
                                }) catch {};
                            }
                        },
                        .git_checkout => |*ctx| {
                            // Checkout completed, clean up and read package.json
                            const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, ctx.resolved, null);
                            if (bun.openDir(ctx.cache_dir, folder_name)) |dir_const| {
                                var dir = dir_const;
                                defer dir.close();
                                dir.deleteTree(".git") catch {};

                                if (ctx.resolved.len > 0) {
                                    switch (bun.sys.File.writeFile(bun.FD.fromStdDir(dir), ".bun-tag", ctx.resolved)) {
                                        .err => {
                                            _ = bun.sys.unlinkat(.fromStdDir(dir), ".bun-tag");
                                        },
                                        .result => {},
                                    }
                                }

                                const extract_data = this.readPackageJson(dir, ctx.url, ctx.resolved) catch |err| {
                                    this.manager.git_tasks.writeItem(.{
                                        .task_id = ctx.task_id,
                                        .context = .{ .git_checkout = ctx.* },
                                        .err = err,
                                        .result = undefined,
                                        .pending = true,
                                    }) catch {};
                                    return;
                                };
                                this.manager.git_tasks.writeItem(.{
                                    .task_id = ctx.task_id,
                                    .context = .{ .git_checkout = ctx.* },
                                    .result = .{ .git_checkout = extract_data },
                                    .pending = true,
                                }) catch {};
                            } else |err| {
                                this.manager.git_tasks.writeItem(.{
                                    .task_id = ctx.task_id,
                                    .context = .{ .git_checkout = ctx.* },
                                    .err = err,
                                    .result = undefined,
                                    .pending = true,
                                }) catch {};
                            }
                        },
                    }
                } else {
                    // Error case - check stderr for specific errors
                    const stderr_data = this.stderr.finalBuffer();
                    if (this.manager.options.log_level.isVerbose() and stderr_data.items.len > 0) {
                        Output.printErrorln("<r>{s}<r>\n", .{stderr_data.items});
                    }

                    const err = if ((strings.containsComptime(stderr_data.items, "remote:") and
                        strings.containsComptime(stderr_data.items, "not") and
                        strings.containsComptime(stderr_data.items, "found")) or
                        strings.containsComptime(stderr_data.items, "does not exist"))
                        error.RepositoryNotFound
                    else
                        error.InstallFailed;

                    switch (this.completion_context) {
                        .git_clone => |ctx| {
                            this.manager.git_tasks.writeItem(.{
                                .task_id = ctx.task_id,
                                .context = .{ .git_clone = ctx },
                                .err = err,
                                .result = undefined,
                                .pending = true,
                            }) catch {};
                        },
                        .git_find_commit => |ctx| {
                            this.manager.git_tasks.writeItem(.{
                                .task_id = ctx.task_id,
                                .context = .{ .git_find_commit = ctx },
                                .err = err,
                                .result = undefined,
                                .pending = true,
                            }) catch {};
                        },
                        .git_checkout => |ctx| {
                            this.manager.git_tasks.writeItem(.{
                                .task_id = ctx.task_id,
                                .context = .{ .git_checkout = ctx },
                                .err = err,
                                .result = undefined,
                                .pending = true,
                            }) catch {};
                        },
                    }
                }
            },
            .err => |_| {
                switch (this.completion_context) {
                    .git_clone => |ctx| {
                        this.manager.git_tasks.writeItem(.{
                            .task_id = ctx.task_id,
                            .context = .{ .git_clone = ctx },
                            .err = error.InstallFailed,
                            .result = undefined,
                            .pending = true,
                        }) catch {};
                    },
                    .git_checkout => |ctx| {
                        this.manager.git_tasks.writeItem(.{
                            .task_id = ctx.task_id,
                            .context = .{ .git_checkout = ctx },
                            .err = error.InstallFailed,
                            .result = undefined,
                            .pending = true,
                        }) catch {};
                    },
                    .git_find_commit => |ctx| {
                        this.manager.git_tasks.writeItem(.{
                            .task_id = ctx.task_id,
                            .context = .{ .git_find_commit = ctx },
                            .err = error.InstallFailed,
                            .result = undefined,
                            .pending = true,
                        }) catch {};
                    },
                }
            },
            else => {
                switch (this.completion_context) {
                    .git_clone => |ctx| {
                        this.manager.git_tasks.writeItem(.{
                            .task_id = ctx.task_id,
                            .context = .{ .git_clone = ctx },
                            .err = error.InstallFailed,
                            .result = undefined,
                            .pending = true,
                        }) catch {};
                    },
                    .git_find_commit => |ctx| {
                        this.manager.git_tasks.writeItem(.{
                            .task_id = ctx.task_id,
                            .context = .{ .git_find_commit = ctx },
                            .err = error.InstallFailed,
                            .result = undefined,
                            .pending = true,
                        }) catch {};
                    },
                    .git_checkout => |ctx| {
                        this.manager.git_tasks.writeItem(.{
                            .task_id = ctx.task_id,
                            .context = .{ .git_checkout = ctx },
                            .err = error.InstallFailed,
                            .result = undefined,
                            .pending = true,
                        }) catch {};
                    },
                }
            },
        }
    }

    fn readPackageJson(this: *GitRunner, package_dir: std.fs.Dir, url: []const u8, resolved: []const u8) !ExtractData {
        var json_path_buf: bun.PathBuffer = undefined;
        const json_file, const json_buf = bun.sys.File.readFileFrom(package_dir, "package.json", this.allocator).unwrap() catch |err| {
            if (err == error.ENOENT) {
                // allow git dependencies without package.json
                return .{
                    .url = url,
                    .resolved = resolved,
                };
            }
            return error.InstallFailed;
        };
        defer json_file.close();

        const json_path = json_file.getPath(&json_path_buf).unwrap() catch {
            return error.InstallFailed;
        };

        const ret_json_path = try @import("../fs.zig").FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path);
        return .{
            .url = url,
            .resolved = resolved,
            .json = .{
                .path = ret_json_path,
                .buf = json_buf,
            },
        };
    }

    pub fn deinit(this: *GitRunner) void {
        if (this.process) |proc| {
            this.process = null;
            proc.close();
            proc.deref();
        }

        this.stdout.deinit();
        this.stderr.deinit();
        this.arena.deinit();
        this.allocator.destroy(this);
    }

    pub const ScheduleResult = enum {
        scheduled,
        completed,
    };
};
