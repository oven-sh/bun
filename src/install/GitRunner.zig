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

    /// For multi-step operations like checkout (clone then checkout)
    is_second_step: bool = false,

    pub const CompletionContext = union(enum) {
        download: struct {
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
        find_commit: struct {
            name: []const u8,
            committish: []const u8,
            task_id: u64,
            repo_dir: std.fs.Dir,
        },
        checkout: struct {
            name: []const u8,
            url: []const u8,
            resolved: []const u8,
            task_id: u64,
            cache_dir: std.fs.Dir,
            repo_dir: std.fs.Dir,
        },

        pub fn needsStdout(this: *const CompletionContext) bool {
            return switch (this.*) {
                .find_commit => true,
                else => false,
            };
        }
    };

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
        _ = this.manager.incrementPendingTasks(1);
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
        var must_deinit = true;
        defer {
            _ = this.manager.decrementPendingTasks();
            if (must_deinit) this.deinit();
        }

        switch (status) {
            .exited => |exit| {
                if (exit.code == 0) {
                    // Success case
                    const stdout_data = this.stdout.finalBuffer();

                    switch (this.completion_context) {
                        .download => |*ctx| {
                            switch (ctx.dir) {
                                .cache => |cache_dir| {
                                    const buf = bun.PathBufferPool.get();
                                    defer bun.PathBufferPool.put(buf);
                                    const path = Path.joinAbsStringBufZ(PackageManager.get().cache_directory_path, buf, &.{PackageManager.cachedGitFolderNamePrint(&folder_name_buf, ctx.name, null)}, .auto);

                                    if (bun.openDir(cache_dir, path)) |repo_dir| {
                                        this.manager.onGitDownloadComplete(ctx.task_id, repo_dir) catch {};
                                    } else |err| {
                                        this.manager.onGitDownloadComplete(ctx.task_id, err) catch {};
                                    }
                                },
                                .repo => |repo_dir| {
                                    this.manager.onGitDownloadComplete(ctx.task_id, repo_dir) catch {};
                                },
                            }
                        },
                        .find_commit => |*ctx| {
                            // For find_commit, we need to parse the commit hash from stdout
                            const commit_hash = std.mem.trim(u8, stdout_data.items, " \t\r\n");
                            if (commit_hash.len > 0) {
                                const duped = this.allocator.dupe(u8, commit_hash) catch bun.outOfMemory();
                                this.manager.onGitFindCommitComplete(ctx.task_id, duped) catch {};
                            } else {
                                this.manager.onGitFindCommitComplete(ctx.task_id, error.InstallFailed) catch {};
                            }
                        },
                        .checkout => |*ctx| {
                            if (!this.is_second_step) {
                                const buf = bun.PathBufferPool.get();
                                defer bun.PathBufferPool.put(buf);
                                // First step completed (clone), now do checkout
                                const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, ctx.resolved, null);
                                const folder = Path.joinAbsStringBuf(PackageManager.get().cache_directory_path, buf, &.{folder_name}, .auto);
                                const git_path = bun.PathBufferPool.get();
                                defer bun.PathBufferPool.put(git_path);
                                const git = bun.which(git_path, bun.getenvZ("PATH") orelse "", bun.fs.FileSystem.instance.top_level_dir, "git") orelse "git";
                                const checkout_argv = &[_][]const u8{
                                    git,
                                    "-C",
                                    folder,
                                    "checkout",
                                    "--quiet",
                                    ctx.resolved,
                                };

                                this.is_second_step = true;
                                this.stdout.deinit();
                                this.stderr.deinit();
                                this.remaining_fds = 0;

                                this.stdout = bun.io.BufferedReader.init(@This());
                                this.stderr = bun.io.BufferedReader.init(@This());
                                this.stdout.setParent(this);
                                this.stderr.setParent(this);

                                this.spawn(checkout_argv, null) catch |err| {
                                    this.manager.onGitCheckoutComplete(ctx.task_id, err) catch {};
                                    return;
                                };
                                must_deinit = false;
                            } else {
                                // Second step completed (checkout), clean up and read package.json
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
                                        this.manager.onGitCheckoutComplete(ctx.task_id, err) catch {};
                                        return;
                                    };
                                    this.manager.onGitCheckoutComplete(ctx.task_id, extract_data) catch {};
                                } else |err| {
                                    this.manager.onGitCheckoutComplete(ctx.task_id, err) catch {};
                                }
                            }
                        },
                    }
                } else {
                    // Error case - check stderr for specific errors
                    const stderr_data = this.stderr.finalBuffer();
                    const err = if ((strings.containsComptime(stderr_data.items, "remote:") and
                        strings.containsComptime(stderr_data.items, "not") and
                        strings.containsComptime(stderr_data.items, "found")) or
                        strings.containsComptime(stderr_data.items, "does not exist"))
                        error.RepositoryNotFound
                    else
                        error.InstallFailed;

                    switch (this.completion_context) {
                        .download => |ctx| {
                            this.manager.onGitDownloadComplete(ctx.task_id, err) catch {};
                        },
                        .find_commit => |ctx| {
                            this.manager.onGitFindCommitComplete(ctx.task_id, err) catch {};
                        },
                        .checkout => |ctx| {
                            this.manager.onGitCheckoutComplete(ctx.task_id, err) catch {};
                        },
                    }
                }
            },
            .err => |_| {
                switch (this.completion_context) {
                    .download => |ctx| {
                        this.manager.onGitDownloadComplete(ctx.task_id, error.InstallFailed) catch {};
                    },
                    .find_commit => |ctx| {
                        this.manager.onGitFindCommitComplete(ctx.task_id, error.InstallFailed) catch {};
                    },
                    .checkout => |ctx| {
                        this.manager.onGitCheckoutComplete(ctx.task_id, error.InstallFailed) catch {};
                    },
                }
            },
            else => {
                switch (this.completion_context) {
                    .download => |ctx| {
                        this.manager.onGitDownloadComplete(ctx.task_id, error.InstallFailed) catch {};
                    },
                    .find_commit => |ctx| {
                        this.manager.onGitFindCommitComplete(ctx.task_id, error.InstallFailed) catch {};
                    },
                    .checkout => |ctx| {
                        this.manager.onGitCheckoutComplete(ctx.task_id, error.InstallFailed) catch {};
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
};
