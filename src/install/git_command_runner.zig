const log = Output.scoped(.Git, false);

pub const GitCommandRunner = struct {
    manager: *PackageManager,
    process: ?*Process = null,
    stdout: OutputReader = OutputReader.init(@This()),
    stderr: OutputReader = OutputReader.init(@This()),
    has_called_process_exit: bool = false,
    remaining_fds: i8 = 0,

    task_id: Task.Id,
    operation: Operation,
    // For checkout, we need to run two commands
    checkout_phase: enum { clone, checkout } = .clone,

    heap: bun.io.heap.IntrusiveField(GitCommandRunner) = .{},

    pub const Operation = union(enum) {
        clone: struct {
            name: strings.StringOrTinyString,
            url: strings.StringOrTinyString,
            dep_id: DependencyID,
            res: Resolution,
            attempt: u8,
            is_fetch: bool = false,
        },
        checkout: struct {
            repo_dir: bun.FileDescriptor,
            dependency_id: DependencyID,
            name: strings.StringOrTinyString,
            url: strings.StringOrTinyString,
            resolved: strings.StringOrTinyString,
            resolution: Resolution,
            target_dir: []const u8,
            patch_name_and_version_hash: ?u64,
        },
    };

    pub const List = bun.io.heap.Intrusive(GitCommandRunner, *PackageManager, sortByTaskId);

    fn sortByTaskId(_: *PackageManager, a: *GitCommandRunner, b: *GitCommandRunner) bool {
        return a.task_id.get() < b.task_id.get();
    }

    pub const new = bun.TrivialNew(@This());

    pub const OutputReader = bun.io.BufferedReader;
    const uv = bun.windows.libuv;

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

    pub fn loop(this: *const GitCommandRunner) *bun.uws.Loop {
        return this.manager.event_loop.loop();
    }

    pub fn eventLoop(this: *const GitCommandRunner) *jsc.AnyEventLoop {
        return &this.manager.event_loop;
    }

    pub fn onReaderDone(this: *GitCommandRunner) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;
        this.maybeFinished();
    }

    pub fn onReaderError(this: *GitCommandRunner, err: bun.sys.Error) void {
        bun.assert(this.remaining_fds > 0);
        this.remaining_fds -= 1;

        Output.prettyErrorln("<r><red>error<r>: Failed to read git output due to error <b>{d} {s}<r>", .{
            err.errno,
            @tagName(err.getErrno()),
        });
        Output.flush();
        this.maybeFinished();
    }

    fn maybeFinished(this: *GitCommandRunner) void {
        if (!this.has_called_process_exit or this.remaining_fds != 0)
            return;

        const process = this.process orelse return;
        this.handleExit(process.status);
    }

    fn ensureNotInHeap(this: *GitCommandRunner) void {
        if (this.heap.child != null or this.heap.next != null or this.heap.prev != null or this.manager.active_git_commands.root == this) {
            this.manager.active_git_commands.remove(this);
        }
    }

    pub fn spawn(
        manager: *PackageManager,
        task_id: Task.Id,
        argv_input: []const ?[*:0]const u8,
        operation: Operation,
    ) void {
        // GitCommandRunner.spawn called

        const runner = bun.new(GitCommandRunner, .{
            .manager = manager,
            .task_id = task_id,
            .operation = operation,
        });

        runner.manager.active_git_commands.insert(runner);

        // Find the git executable
        var path_buf: bun.PathBuffer = undefined;
        const git_path = bun.which(&path_buf, bun.getenvZ("PATH") orelse "", manager.cache_directory_path, "git") orelse {
            log("Failed to find git executable in PATH", .{});
            // Create a failed task
            const task = manager.preallocated_resolve_tasks.get();
            task.* = Task{
                .package_manager = manager,
                .log = logger.Log.init(manager.allocator),
                .tag = .git_clone,
                .request = .{
                    .git_clone = .{
                        .name = operation.clone.name,
                        .url = operation.clone.url,
                        .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(manager.allocator) },
                        .dep_id = operation.clone.dep_id,
                        .res = operation.clone.res,
                    },
                },
                .id = task_id,
                .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                .data = .{ .git_clone = bun.invalid_fd },
                .status = .fail,
                .err = error.GitCommandFailed,
            };
            manager.resolve_tasks.push(task);
            manager.wake();
            runner.deinit();
            return;
        };

        // Copy argv to a local array to avoid const issues, using the full git path
        var argv: [16]?[*:0]const u8 = undefined;
        argv[0] = git_path.ptr; // Use the full path to git
        var argc: usize = 1;
        for (argv_input[1..]) |arg| {
            if (arg == null) break;
            argv[argc] = arg;
            argc += 1;
        }
        argv[argc] = null; // Ensure null termination

        // Cache directory is manager.cache_directory_path

        runner.remaining_fds = 0;
        var env_map = Repository.shared_env.get(manager.allocator, manager.env);
        const envp = env_map.createNullDelimitedEnvMap(manager.allocator) catch |err| {
            log("Failed to create env map: {}", .{err});
            // Create a failed task
            const task = manager.preallocated_resolve_tasks.get();
            task.* = Task{
                .package_manager = manager,
                .log = logger.Log.init(manager.allocator),
                .tag = .git_clone,
                .request = .{
                    .git_clone = .{
                        .name = operation.clone.name,
                        .url = operation.clone.url,
                        .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(manager.allocator) },
                        .dep_id = operation.clone.dep_id,
                        .res = operation.clone.res,
                    },
                },
                .id = task_id,
                .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                .data = .{ .git_clone = bun.invalid_fd },
                .status = .fail,
                .err = error.GitCommandFailed,
            };
            manager.resolve_tasks.push(task);
            manager.wake();
            runner.deinit();
            return;
        };

        if (Environment.isWindows) {
            runner.stdout.source = .{ .pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() };
            runner.stderr.source = .{ .pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() };
        }

        // Ensure cache directory exists before using it as cwd
        _ = manager.getCacheDirectory();

        const spawn_options = bun.spawn.SpawnOptions{
            .stdin = .ignore,
            .stdout = if (Environment.isPosix) .buffer else .{ .buffer = runner.stdout.source.?.pipe },
            .stderr = if (Environment.isPosix) .buffer else .{ .buffer = runner.stderr.source.?.pipe },
            .argv0 = git_path.ptr,
            .cwd = manager.cache_directory_path,
            .windows = if (Environment.isWindows) .{
                .loop = jsc.EventLoopHandle.init(&manager.event_loop),
            },
            .stream = false,
        };

        // About to spawn git process with argv[0]="{s}"
        if (comptime Environment.allow_assert) {
            log("Spawning git with argv[0]={s}, cwd={s}", .{ argv[0].?, manager.cache_directory_path });
            for (argv[0..argc]) |arg| {
                if (arg) |a| {
                    log("  argv: {s}", .{a});
                }
            }
        }
        var spawn_result = bun.spawn.spawnProcess(&spawn_options, @ptrCast(&argv), envp) catch |err| {
            log("Failed to spawn git process: {} (argv[0]={s})", .{ err, argv[0].? });
            // Create a failed task with proper error message
            const task = manager.preallocated_resolve_tasks.get();
            task.* = Task{
                .package_manager = manager,
                .log = logger.Log.init(manager.allocator),
                .tag = .git_clone,
                .request = .{
                    .git_clone = .{
                        .name = operation.clone.name,
                        .url = operation.clone.url,
                        .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(manager.allocator) },
                        .dep_id = operation.clone.dep_id,
                        .res = operation.clone.res,
                    },
                },
                .id = task_id,
                .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                .data = .{ .git_clone = bun.invalid_fd },
                .status = .fail,
                .err = error.GitCommandFailed,
            };
            manager.resolve_tasks.push(task);
            manager.wake();
            runner.deinit();
            return;
        };
        var spawned = spawn_result.unwrap() catch |err| {
            log("Failed to unwrap spawn result: {}", .{err});
            // Create a failed task with proper error message
            const task = manager.preallocated_resolve_tasks.get();
            task.* = Task{
                .package_manager = manager,
                .log = logger.Log.init(manager.allocator),
                .tag = .git_clone,
                .request = .{
                    .git_clone = .{
                        .name = operation.clone.name,
                        .url = operation.clone.url,
                        .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(manager.allocator) },
                        .dep_id = operation.clone.dep_id,
                        .res = operation.clone.res,
                    },
                },
                .id = task_id,
                .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                .data = .{ .git_clone = bun.invalid_fd },
                .status = .fail,
                .err = error.GitCommandFailed,
            };
            manager.resolve_tasks.push(task);
            manager.wake();
            runner.deinit();
            return;
        };

        // Git process spawned

        if (comptime Environment.isPosix) {
            if (spawned.stdout) |stdout| {
                if (!spawned.memfds[1]) {
                    runner.stdout.setParent(runner);
                    _ = bun.sys.setNonblocking(stdout);
                    runner.remaining_fds += 1;

                    resetOutputFlags(&runner.stdout, stdout);
                    runner.stdout.start(stdout, true).unwrap() catch |err| {
                        log("Failed to start stdout reader: {}", .{err});
                        // Create a failed task
                        const task = manager.preallocated_resolve_tasks.get();
                        task.* = Task{
                            .package_manager = manager,
                            .log = logger.Log.init(manager.allocator),
                            .tag = .git_clone,
                            .request = .{
                                .git_clone = .{
                                    .name = operation.clone.name,
                                    .url = operation.clone.url,
                                    .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(manager.allocator) },
                                    .dep_id = operation.clone.dep_id,
                                    .res = operation.clone.res,
                                },
                            },
                            .id = task_id,
                            .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                            .data = .{ .git_clone = bun.invalid_fd },
                            .status = .fail,
                            .err = error.GitCommandFailed,
                        };
                        manager.resolve_tasks.push(task);
                        manager.wake();
                        runner.deinit();
                        return;
                    };
                    if (runner.stdout.handle.getPoll()) |poll| {
                        poll.flags.insert(.socket);
                    }
                } else {
                    runner.stdout.setParent(runner);
                    runner.stdout.startMemfd(stdout);
                }
            }
            if (spawned.stderr) |stderr| {
                if (!spawned.memfds[2]) {
                    runner.stderr.setParent(runner);
                    _ = bun.sys.setNonblocking(stderr);
                    runner.remaining_fds += 1;

                    resetOutputFlags(&runner.stderr, stderr);
                    runner.stderr.start(stderr, true).unwrap() catch |err| {
                        log("Failed to start stderr reader: {}", .{err});
                        // Create a failed task
                        const task = manager.preallocated_resolve_tasks.get();
                        task.* = Task{
                            .package_manager = manager,
                            .log = logger.Log.init(manager.allocator),
                            .tag = .git_clone,
                            .request = .{
                                .git_clone = .{
                                    .name = operation.clone.name,
                                    .url = operation.clone.url,
                                    .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(manager.allocator) },
                                    .dep_id = operation.clone.dep_id,
                                    .res = operation.clone.res,
                                },
                            },
                            .id = task_id,
                            .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                            .data = .{ .git_clone = bun.invalid_fd },
                            .status = .fail,
                            .err = error.GitCommandFailed,
                        };
                        manager.resolve_tasks.push(task);
                        manager.wake();
                        runner.deinit();
                        return;
                    };
                    if (runner.stderr.handle.getPoll()) |poll| {
                        poll.flags.insert(.socket);
                    }
                } else {
                    runner.stderr.setParent(runner);
                    runner.stderr.startMemfd(stderr);
                }
            }
        } else if (comptime Environment.isWindows) {
            if (spawned.stdout == .buffer) {
                runner.stdout.parent = runner;
                runner.remaining_fds += 1;
                runner.stdout.startWithCurrentPipe().unwrap() catch |err| {
                    log("Failed to start stdout reader on Windows: {}", .{err});
                    // Create a failed task
                    const task = manager.preallocated_resolve_tasks.get();
                    task.* = Task{
                        .package_manager = manager,
                        .log = logger.Log.init(manager.allocator),
                        .tag = .git_clone,
                        .request = .{
                            .git_clone = .{
                                .name = operation.clone.name,
                                .url = operation.clone.url,
                                .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(manager.allocator) },
                                .dep_id = operation.clone.dep_id,
                                .res = operation.clone.res,
                            },
                        },
                        .id = task_id,
                        .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                        .data = .{ .git_clone = bun.invalid_fd },
                        .status = .fail,
                        .err = error.GitCommandFailed,
                    };
                    manager.resolve_tasks.push(task);
                    manager.wake();
                    runner.deinit();
                    return;
                };
            }
            if (spawned.stderr == .buffer) {
                runner.stderr.parent = runner;
                runner.remaining_fds += 1;
                runner.stderr.startWithCurrentPipe().unwrap() catch |err| {
                    log("Failed to start stderr reader on Windows: {}", .{err});
                    // Create a failed task
                    const task = manager.preallocated_resolve_tasks.get();
                    task.* = Task{
                        .package_manager = manager,
                        .log = logger.Log.init(manager.allocator),
                        .tag = .git_clone,
                        .request = .{
                            .git_clone = .{
                                .name = operation.clone.name,
                                .url = operation.clone.url,
                                .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(manager.allocator) },
                                .dep_id = operation.clone.dep_id,
                                .res = operation.clone.res,
                            },
                        },
                        .id = task_id,
                        .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                        .data = .{ .git_clone = bun.invalid_fd },
                        .status = .fail,
                        .err = error.GitCommandFailed,
                    };
                    manager.resolve_tasks.push(task);
                    manager.wake();
                    runner.deinit();
                    return;
                };
            }
        }

        const event_loop = &manager.event_loop;
        var process = spawned.toProcess(event_loop, false);

        bun.assertf(runner.process == null, "forgot to call `resetPolls`", .{});
        runner.process = process;
        process.setExitHandler(runner);

        switch (process.watchOrReap()) {
            .err => |err| {
                if (!process.hasExited())
                    process.onExit(.{ .err = err }, &std.mem.zeroes(bun.spawn.Rusage));
            },
            .result => {},
        }
    }

    fn handleExit(this: *GitCommandRunner, status: bun.spawn.Status) void {
        log("Git command finished: task_id={d}, status={}", .{ this.task_id.get(), status });

        const stderr_text = this.stderr.finalBuffer().items;

        this.ensureNotInHeap();

        // Create a task with the result
        const task = this.manager.preallocated_resolve_tasks.get();

        switch (this.operation) {
            .clone => |clone| {
                task.* = Task{
                    .package_manager = this.manager,
                    .log = logger.Log.init(this.manager.allocator),
                    .tag = .git_clone,
                    .request = .{
                        .git_clone = .{
                            .name = clone.name,
                            .url = clone.url,
                            .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(this.manager.allocator) },
                            .dep_id = clone.dep_id,
                            .res = clone.res,
                        },
                    },
                    .id = this.task_id,
                    .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                    .data = undefined,
                    .status = undefined,
                    .err = null,
                };

                switch (status) {
                    .exited => |exit| {
                        if (exit.code == 0) {
                            // Success - get the git dir
                            const folder_name = std.fmt.bufPrintZ(&folder_name_buf, "{any}.git", .{
                                bun.fmt.hexIntLower(this.task_id.get()),
                            }) catch unreachable;
                            if (this.manager.getCacheDirectory().openDirZ(folder_name, .{})) |dir| {
                                task.data = .{ .git_clone = bun.FileDescriptor.fromStdDir(dir) };
                                task.status = .success;
                            } else |err| {
                                task.err = err;
                                task.status = .fail;
                                task.data = .{ .git_clone = bun.invalid_fd };
                            }
                        } else {
                            task.err = error.GitCloneFailed;
                            task.status = .fail;
                            task.data = .{ .git_clone = bun.invalid_fd };

                            if (stderr_text.len > 0) {
                                task.log.addErrorFmt(null, logger.Loc.Empty, this.manager.allocator, "git clone failed: {s}", .{stderr_text}) catch {};
                            }
                        }
                    },
                    .signaled => |signal| {
                        task.err = error.GitCloneSignaled;
                        task.status = .fail;
                        task.data = .{ .git_clone = bun.invalid_fd };

                        const signal_code = bun.SignalCode.from(signal);
                        task.log.addErrorFmt(null, logger.Loc.Empty, this.manager.allocator, "git clone terminated by {}", .{
                            signal_code.fmt(Output.enable_ansi_colors_stderr),
                        }) catch {};
                    },
                    .err => |_| {
                        task.err = error.GitCloneFailed;
                        task.status = .fail;
                        task.data = .{ .git_clone = bun.invalid_fd };
                    },
                    else => {
                        task.err = error.UnexpectedGitStatus;
                        task.status = .fail;
                        task.data = .{ .git_clone = bun.invalid_fd };
                    },
                }
            },
            .checkout => |checkout| {
                // Handle two-phase checkout
                if (this.checkout_phase == .clone) {
                    // First phase completed (clone --no-checkout)
                    if (status == .exited and status.exited.code == 0) {

                        // Now run the actual checkout command
                        this.checkout_phase = .checkout;

                        // Find the git executable
                        var path_buf2: bun.PathBuffer = undefined;
                        const git_path = bun.which(&path_buf2, bun.getenvZ("PATH") orelse "", this.manager.cache_directory_path, "git") orelse {
                            log("Failed to find git executable in PATH for checkout", .{});
                            this.handleCheckoutError(error.GitCommandFailed);
                            return;
                        };

                        // Build checkout command: git -C <folder> checkout --quiet <resolved>
                        const target_dir_z = bun.default_allocator.dupeZ(u8, checkout.target_dir) catch unreachable;

                        if (comptime Environment.allow_assert) {
                            log("Checkout target_dir: {s}", .{target_dir_z});
                            log("Checkout resolved: {s}", .{checkout.resolved.slice()});
                        }

                        const argv: [7]?[*:0]const u8 = .{
                            git_path.ptr,
                            "-C",
                            target_dir_z,
                            "checkout",
                            "--quiet",
                            bun.default_allocator.dupeZ(u8, checkout.resolved.slice()) catch unreachable,
                            null,
                        };

                        // Spawn the checkout command
                        this.has_called_process_exit = false;
                        this.remaining_fds = 0;
                        this.resetPolls();

                        var env_map = Repository.shared_env.get(this.manager.allocator, this.manager.env);
                        const envp = env_map.createNullDelimitedEnvMap(this.manager.allocator) catch |err| {
                            log("Failed to create env map for checkout: {}", .{err});
                            this.handleCheckoutError(error.EnvMapFailed);
                            return;
                        };

                        if (Environment.isWindows) {
                            this.stdout.source = .{ .pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() };
                            this.stderr.source = .{ .pipe = bun.default_allocator.create(uv.Pipe) catch bun.outOfMemory() };
                        }

                        // Ensure cache directory exists before using it as cwd
                        _ = this.manager.getCacheDirectory();

                        const spawn_options = bun.spawn.SpawnOptions{
                            .stdin = .ignore,
                            .stdout = if (Environment.isPosix) .buffer else .{ .buffer = this.stdout.source.?.pipe },
                            .stderr = if (Environment.isPosix) .buffer else .{ .buffer = this.stderr.source.?.pipe },
                            .argv0 = git_path.ptr,
                            .cwd = this.manager.cache_directory_path,
                            .windows = if (Environment.isWindows) .{
                                .loop = jsc.EventLoopHandle.init(&this.manager.event_loop),
                            },
                            .stream = false,
                        };

                        if (comptime Environment.allow_assert) {
                            log("Spawning git checkout with cwd={s}", .{this.manager.cache_directory_path});
                            for (argv) |arg| {
                                if (arg) |a| {
                                    log("  argv: {s}", .{a});
                                } else break;
                            }
                        }

                        var spawn_result = bun.spawn.spawnProcess(&spawn_options, @constCast(@ptrCast(&argv)), envp) catch |err| {
                            log("Failed to spawn git checkout: {}", .{err});
                            this.handleCheckoutError(err);
                            return;
                        };

                        var spawned = spawn_result.unwrap() catch |err| {
                            log("Failed to unwrap git checkout spawn: {}", .{err});
                            this.handleCheckoutError(err);
                            return;
                        };

                        // Set up process monitoring
                        if (comptime Environment.isPosix) {
                            if (spawned.stdout) |stdout| {
                                if (!spawned.memfds[1]) {
                                    this.stdout.setParent(this);
                                    _ = bun.sys.setNonblocking(stdout);
                                    this.remaining_fds += 1;

                                    resetOutputFlags(&this.stdout, stdout);
                                    this.stdout.start(stdout, true).unwrap() catch |err| {
                                        log("Failed to start stdout reader: {}", .{err});
                                        this.handleCheckoutError(err);
                                        return;
                                    };
                                    if (this.stdout.handle.getPoll()) |poll| {
                                        poll.flags.insert(.socket);
                                    }
                                }
                            }
                            if (spawned.stderr) |stderr| {
                                if (!spawned.memfds[2]) {
                                    this.stderr.setParent(this);
                                    _ = bun.sys.setNonblocking(stderr);
                                    this.remaining_fds += 1;

                                    resetOutputFlags(&this.stderr, stderr);
                                    this.stderr.start(stderr, true).unwrap() catch |err| {
                                        log("Failed to start stderr reader: {}", .{err});
                                        this.handleCheckoutError(err);
                                        return;
                                    };
                                    if (this.stderr.handle.getPoll()) |poll| {
                                        poll.flags.insert(.socket);
                                    }
                                }
                            }
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

                        // Don't continue to the task creation yet
                        return;
                    } else {
                        // Clone failed
                        this.handleCheckoutError(error.GitCloneFailed);
                        return;
                    }
                }

                // Second phase (actual checkout) completed
                task.* = Task{
                    .package_manager = this.manager,
                    .log = logger.Log.init(this.manager.allocator),
                    .tag = .git_checkout,
                    .request = .{
                        .git_checkout = .{
                            .repo_dir = checkout.repo_dir,
                            .dependency_id = checkout.dependency_id,
                            .name = checkout.name,
                            .url = checkout.url,
                            .resolved = checkout.resolved,
                            .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(this.manager.allocator) },
                            .resolution = checkout.resolution,
                        },
                    },
                    .id = this.task_id,
                    .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
                    .data = undefined,
                    .status = undefined,
                    .err = null,
                    .apply_patch_task = if (checkout.patch_name_and_version_hash) |h| brk: {
                        const patch_hash = this.manager.lockfile.patched_dependencies.get(h).?.patchfileHash().?;
                        const ptask = PatchTask.newApplyPatchHash(this.manager, checkout.dependency_id, patch_hash, h);
                        ptask.callback.apply.task_id = this.task_id;
                        break :brk ptask;
                    } else null,
                };

                switch (status) {
                    .exited => |exit| {
                        if (exit.code == 0) {
                            // Success - create ExtractData
                            const folder_name = PackageManager.cachedGitFolderNamePrint(&folder_name_buf, checkout.resolved.slice(), null);
                            if (this.manager.getCacheDirectory().openDir(folder_name, .{})) |package_dir_const| {
                                var package_dir = package_dir_const;
                                defer package_dir.close();

                                // Delete .git directory
                                package_dir.deleteTree(".git") catch {};

                                // Create .bun-tag file with resolved commit
                                if (checkout.resolved.slice().len > 0) insert_tag: {
                                    const git_tag = package_dir.createFileZ(".bun-tag", .{ .truncate = true }) catch break :insert_tag;
                                    defer git_tag.close();
                                    git_tag.writeAll(checkout.resolved.slice()) catch {
                                        package_dir.deleteFileZ(".bun-tag") catch {};
                                    };
                                }

                                // Read package.json if it exists
                                if (bun.sys.File.readFileFrom(package_dir, "package.json", this.manager.allocator).unwrap()) |result| {
                                    const json_file, const json_buf_original = result;
                                    // Make a copy of the buffer to ensure it's not corrupted
                                    const json_buf = this.manager.allocator.dupe(u8, json_buf_original) catch json_buf_original;
                                    // Don't close the file yet - we're passing the buffer to the task
                                    // The file descriptor is just for reading, closing it shouldn't affect the buffer
                                    json_file.close();

                                    var json_path_buf: bun.PathBuffer = undefined;
                                    if (json_file.getPath(&json_path_buf).unwrap()) |json_path| {
                                        const FileSystem = @import("../fs.zig").FileSystem;
                                        if (FileSystem.instance.dirname_store.append(@TypeOf(json_path), json_path)) |ret_json_path| {
                                            task.data = .{ .git_checkout = .{
                                                .url = checkout.url.slice(),
                                                .resolved = checkout.resolved.slice(),
                                                .json = .{
                                                    .path = ret_json_path,
                                                    .buf = json_buf,
                                                },
                                            } };
                                            task.status = .success;
                                        } else |err| {
                                            task.err = err;
                                            task.status = .fail;
                                            task.data = .{ .git_checkout = .{} };
                                        }
                                    } else |err| {
                                        task.err = err;
                                        task.status = .fail;
                                        task.data = .{ .git_checkout = .{} };
                                    }
                                } else |err| {
                                    if (err == error.ENOENT) {
                                        // Allow git dependencies without package.json
                                        task.data = .{ .git_checkout = .{
                                            .url = checkout.url.slice(),
                                            .resolved = checkout.resolved.slice(),
                                        } };
                                        task.status = .success;
                                    } else {
                                        task.err = err;
                                        task.status = .fail;
                                        task.data = .{ .git_checkout = .{} };
                                    }
                                }
                            } else |err| {
                                task.err = err;
                                task.status = .fail;
                                task.data = .{ .git_checkout = .{} };
                            }
                        } else {
                            task.err = error.GitCheckoutFailed;
                            task.status = .fail;
                            task.data = .{ .git_checkout = .{} };

                            if (stderr_text.len > 0) {
                                task.log.addErrorFmt(null, logger.Loc.Empty, this.manager.allocator, "git checkout failed: {s}", .{stderr_text}) catch {};
                            }
                        }
                    },
                    .signaled => |signal| {
                        task.err = error.GitCheckoutSignaled;
                        task.status = .fail;
                        task.data = .{ .git_checkout = .{} };

                        const signal_code = bun.SignalCode.from(signal);
                        task.log.addErrorFmt(null, logger.Loc.Empty, this.manager.allocator, "git checkout terminated by {}", .{
                            signal_code.fmt(Output.enable_ansi_colors_stderr),
                        }) catch {};
                    },
                    .err => |_| {
                        task.err = error.GitCheckoutFailed;
                        task.status = .fail;
                        task.data = .{ .git_checkout = .{} };
                    },
                    else => {
                        task.err = error.UnexpectedGitStatus;
                        task.status = .fail;
                        task.data = .{ .git_checkout = .{} };
                    },
                }
            },
        }

        // Push the task to the resolve queue
        this.manager.resolve_tasks.push(task);
        // Don't decrement pending tasks here - runTasks will do it when processing the task
        this.manager.wake();

        this.deinit();
    }

    pub fn onProcessExit(this: *GitCommandRunner, proc: *Process, _: bun.spawn.Status, _: *const bun.spawn.Rusage) void {
        // onProcessExit called
        if (this.process != proc) {
            Output.debugWarn("<d>[GitCommandRunner]<r> onProcessExit called with wrong process", .{});
            return;
        }
        this.has_called_process_exit = true;
        this.maybeFinished();
    }

    pub fn resetPolls(this: *GitCommandRunner) void {
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

    pub fn deinit(this: *GitCommandRunner) void {
        this.resetPolls();
        this.ensureNotInHeap();

        this.stdout.deinit();
        this.stderr.deinit();

        this.* = undefined;
        bun.destroy(this);
    }

    // Dummy callback for the task - we never actually call this
    fn dummyCallback(_: *ThreadPool.Task) void {
        unreachable;
    }

    fn handleCheckoutError(this: *GitCommandRunner, err: anyerror) void {
        const task = this.manager.preallocated_resolve_tasks.get();
        task.* = Task{
            .package_manager = this.manager,
            .log = logger.Log.init(this.manager.allocator),
            .tag = .git_checkout,
            .request = .{
                .git_checkout = .{
                    .repo_dir = this.operation.checkout.repo_dir,
                    .dependency_id = this.operation.checkout.dependency_id,
                    .name = this.operation.checkout.name,
                    .url = this.operation.checkout.url,
                    .resolved = this.operation.checkout.resolved,
                    .env = DotEnv.Map{ .map = DotEnv.Map.HashTable.init(this.manager.allocator) },
                    .resolution = this.operation.checkout.resolution,
                },
            },
            .id = this.task_id,
            .threadpool_task = ThreadPool.Task{ .callback = &dummyCallback },
            .data = .{ .git_checkout = .{} },
            .status = .fail,
            .err = err,
            .apply_patch_task = null, // Don't apply patches on error
        };

        this.manager.resolve_tasks.push(task);
        this.manager.wake();
        this.deinit();
    }
};

var folder_name_buf: [1024]u8 = undefined;

const std = @import("std");
const Repository = @import("./repository.zig").Repository;

const DependencyID = @import("./install.zig").DependencyID;
const ExtractData = @import("./install.zig").ExtractData;
const PackageManager = @import("./install.zig").PackageManager;
const PatchTask = @import("./install.zig").PatchTask;
const Resolution = @import("./install.zig").Resolution;
const Task = @import("./install.zig").Task;

const bun = @import("bun");
const DotEnv = bun.DotEnv;
const Environment = bun.Environment;
const Output = bun.Output;
const ThreadPool = bun.ThreadPool;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;
const Process = bun.spawn.Process;
