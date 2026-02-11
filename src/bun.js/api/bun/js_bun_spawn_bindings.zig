// This is split into a separate function to conserve stack space.
// On Windows, a single path buffer can take 64 KB.
fn getArgv0(globalThis: *jsc.JSGlobalObject, PATH: []const u8, cwd: []const u8, pretend_argv0: ?[*:0]const u8, first_cmd: JSValue, allocator: std.mem.Allocator) bun.JSError!struct {
    argv0: [:0]const u8,
    arg0: [:0]u8,
} {
    var arg0 = try first_cmd.toSliceOrNullWithAllocator(globalThis, allocator);
    defer arg0.deinit();

    // Check for null bytes in command (security: prevent null byte injection)
    if (strings.indexOfChar(arg0.slice(), 0) != null) {
        return globalThis.ERR(.INVALID_ARG_VALUE, "The argument 'args[0]' must be a string without null bytes. Received {f}", .{bun.fmt.quote(arg0.slice())}).throw();
    }
    // Heap allocate it to ensure we don't run out of stack space.
    const path_buf: *bun.PathBuffer = try bun.default_allocator.create(bun.PathBuffer);
    defer bun.default_allocator.destroy(path_buf);

    var actual_argv0: [:0]const u8 = "";

    const argv0_to_use: []const u8 = arg0.slice();

    // This mimicks libuv's behavior, which mimicks execvpe
    // Only resolve from $PATH when the command is not an absolute path
    const PATH_to_use: []const u8 = if (strings.containsChar(argv0_to_use, '/'))
        ""
        // If no $PATH is provided, we fallback to the one from environ
        // This is already the behavior of the PATH passed in here.
    else if (PATH.len > 0)
        PATH
    else if (comptime Environment.isPosix)
        // If the user explicitly passed an empty $PATH, we fallback to the OS-specific default (which libuv also does)
        bun.sliceTo(BUN_DEFAULT_PATH_FOR_SPAWN, 0)
    else
        "";

    if (PATH_to_use.len == 0) {
        actual_argv0 = try allocator.dupeZ(u8, argv0_to_use);
    } else {
        const resolved = which(path_buf, PATH_to_use, cwd, argv0_to_use) orelse {
            return throwCommandNotFound(globalThis, argv0_to_use);
        };
        actual_argv0 = try allocator.dupeZ(u8, resolved);
    }

    return .{
        .argv0 = actual_argv0,
        .arg0 = if (pretend_argv0) |p| try allocator.dupeZ(u8, bun.sliceTo(p, 0)) else try allocator.dupeZ(u8, arg0.slice()),
    };
}

/// `argv` for `Bun.spawn` & `Bun.spawnSync`
fn getArgv(globalThis: *jsc.JSGlobalObject, args: JSValue, PATH: []const u8, cwd: []const u8, argv0: *?[*:0]const u8, allocator: std.mem.Allocator, argv: *std.array_list.Managed(?[*:0]const u8)) bun.JSError!void {
    var cmds_array = try args.arrayIterator(globalThis);
    // + 1 for argv0
    // + 1 for null terminator
    argv.* = try @TypeOf(argv.*).initCapacity(allocator, cmds_array.len + 2);

    if (args.isEmptyOrUndefinedOrNull()) {
        return globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
    }

    if (cmds_array.len == 0) {
        return globalThis.throwInvalidArguments("cmd must not be empty", .{});
    }

    const argv0_result = try getArgv0(globalThis, PATH, cwd, argv0.*, (try cmds_array.next()).?, allocator);

    argv0.* = argv0_result.argv0.ptr;
    argv.appendAssumeCapacity(argv0_result.arg0.ptr);

    var arg_index: usize = 1;
    while (try cmds_array.next()) |value| {
        const arg = try value.toBunString(globalThis);
        defer arg.deref();

        // Check for null bytes in argument (security: prevent null byte injection)
        if (arg.indexOfAsciiChar(0) != null) {
            return globalThis.ERR(.INVALID_ARG_VALUE, "The argument 'args[{d}]' must be a string without null bytes. Received \"{f}\"", .{ arg_index, arg.toZigString() }).throw();
        }

        argv.appendAssumeCapacity(try arg.toOwnedSliceZ(allocator));
        arg_index += 1;
    }

    if (argv.items.len == 0) {
        return globalThis.throwInvalidArguments("cmd must be an array of strings", .{});
    }
}

/// Bun.spawn() calls this.
pub fn spawn(globalThis: *jsc.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) bun.JSError!JSValue {
    return spawnMaybeSync(globalThis, args, secondaryArgsValue, false);
}

/// Bun.spawnSync() calls this.
pub fn spawnSync(globalThis: *jsc.JSGlobalObject, args: JSValue, secondaryArgsValue: ?JSValue) bun.JSError!JSValue {
    return spawnMaybeSync(globalThis, args, secondaryArgsValue, true);
}

pub fn spawnMaybeSync(
    globalThis: *jsc.JSGlobalObject,
    args_: JSValue,
    secondaryArgsValue: ?JSValue,
    comptime is_sync: bool,
) bun.JSError!JSValue {
    if (comptime is_sync) {
        // We skip this on Windows due to test failures.
        if (comptime !Environment.isWindows) {
            // Since the event loop is recursively called, we need to check if it's safe to recurse.
            if (!bun.StackCheck.init().isSafeToRecurse()) {
                return globalThis.throwStackOverflow();
            }
        }
    }

    var arena = bun.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var override_env = false;
    var env_array = std.ArrayListUnmanaged(?[*:0]const u8){};
    var jsc_vm = globalThis.bunVM();

    var cwd = jsc_vm.transpiler.fs.top_level_dir;

    var stdio = [3]Stdio{
        .{ .ignore = {} },
        .{ .pipe = {} },
        .{ .inherit = {} },
    };

    if (comptime is_sync) {
        stdio[1] = .{ .pipe = {} };
        stdio[2] = .{ .pipe = {} };
    }
    var lazy = false;
    var on_exit_callback = JSValue.zero;
    var on_disconnect_callback = JSValue.zero;
    var PATH = jsc_vm.transpiler.env.get("PATH") orelse "";
    var argv = std.array_list.Managed(?[*:0]const u8).init(allocator);
    var cmd_value = JSValue.zero;
    var detached = false;
    var args = args_;
    var maybe_ipc_mode: if (is_sync) void else ?IPC.Mode = if (is_sync) {} else null;
    var ipc_callback: JSValue = .zero;
    var extra_fds = std.array_list.Managed(bun.spawn.SpawnOptions.Stdio).init(bun.default_allocator);
    defer extra_fds.deinit();
    var argv0: ?[*:0]const u8 = null;
    var ipc_channel: i32 = -1;
    var timeout: ?i32 = null;
    var killSignal: SignalCode = SignalCode.default;
    var maxBuffer: ?i64 = null;

    var windows_hide: bool = false;
    var windows_verbatim_arguments: bool = false;
    var abort_signal: ?*jsc.WebCore.AbortSignal = null;
    var terminal_info: ?Terminal.CreateResult = null;
    var existing_terminal: ?*Terminal = null; // Existing terminal passed by user
    var terminal_js_value: jsc.JSValue = .zero;
    defer {
        if (abort_signal) |signal| {
            signal.unref();
        }
        // If we created a new terminal but spawn failed, clean it up
        if (terminal_info) |info| {
            info.terminal.closeInternal();
            info.terminal.deref();
        }
    }

    {
        if (args.isEmptyOrUndefinedOrNull()) {
            return globalThis.throwInvalidArguments("cmd must be an array", .{});
        }

        const args_type = args.jsType();
        if (args_type.isArray()) {
            cmd_value = args;
            args = secondaryArgsValue orelse JSValue.zero;
        } else if (!args.isObject()) {
            return globalThis.throwInvalidArguments("cmd must be an array", .{});
        } else if (try args.getTruthy(globalThis, "cmd")) |cmd_value_| {
            cmd_value = cmd_value_;
        } else {
            return globalThis.throwInvalidArguments("cmd must be an array", .{});
        }

        if (args.isObject()) {
            if (try args.getTruthy(globalThis, "argv0")) |argv0_| {
                const argv0_str = try argv0_.getZigString(globalThis);
                if (argv0_str.len > 0) {
                    argv0 = try argv0_str.toOwnedSliceZ(allocator);
                }
            }

            // need to update `cwd` before searching for executable with `Which.which`
            if (try args.getTruthy(globalThis, "cwd")) |cwd_| {
                const cwd_str = try cwd_.getZigString(globalThis);
                if (cwd_str.len > 0) {
                    cwd = try cwd_str.toOwnedSliceZ(allocator);
                }
            }
        }

        if (args != .zero and args.isObject()) {
            // Reject terminal option on spawnSync
            if (comptime is_sync) {
                if (try args.getTruthy(globalThis, "terminal")) |_| {
                    return globalThis.throwInvalidArguments("terminal option is only supported for Bun.spawn, not Bun.spawnSync", .{});
                }
            }

            // This must run before the stdio parsing happens
            if (!is_sync) {
                if (try args.getTruthy(globalThis, "ipc")) |val| {
                    if (val.isCell() and val.isCallable()) {
                        maybe_ipc_mode = ipc_mode: {
                            if (try args.getTruthy(globalThis, "serialization")) |mode_val| {
                                if (mode_val.isString()) {
                                    break :ipc_mode try IPC.Mode.fromJS(globalThis, mode_val) orelse {
                                        return globalThis.throwInvalidArguments("serialization must be \"json\" or \"advanced\"", .{});
                                    };
                                } else {
                                    if (!globalThis.hasException()) {
                                        return globalThis.throwInvalidArgumentType("spawn", "serialization", "string");
                                    }
                                    return .zero;
                                }
                            }
                            break :ipc_mode .advanced;
                        };

                        ipc_callback = val.withAsyncContextIfNeeded(globalThis);
                    }
                }
            }

            if (try args.getTruthy(globalThis, "signal")) |signal_val| {
                if (signal_val.as(jsc.WebCore.AbortSignal)) |signal| {
                    abort_signal = signal.ref();
                } else {
                    return globalThis.throwInvalidArgumentTypeValue("signal", "AbortSignal", signal_val);
                }
            }

            if (try args.getTruthy(globalThis, "onDisconnect")) |onDisconnect_| {
                if (!onDisconnect_.isCell() or !onDisconnect_.isCallable()) {
                    return globalThis.throwInvalidArguments("onDisconnect must be a function or undefined", .{});
                }

                on_disconnect_callback = if (comptime is_sync)
                    onDisconnect_
                else
                    onDisconnect_.withAsyncContextIfNeeded(globalThis);
            }

            if (try args.getTruthy(globalThis, "onExit")) |onExit_| {
                if (!onExit_.isCell() or !onExit_.isCallable()) {
                    return globalThis.throwInvalidArguments("onExit must be a function or undefined", .{});
                }

                on_exit_callback = if (comptime is_sync)
                    onExit_
                else
                    onExit_.withAsyncContextIfNeeded(globalThis);
            }

            if (try args.getTruthy(globalThis, "env")) |env_arg| {
                env_arg.ensureStillAlive();
                const object = env_arg.getObject() orelse {
                    return globalThis.throwInvalidArguments("env must be an object", .{});
                };

                override_env = true;
                // If the env object does not include a $PATH, it must disable path lookup for argv[0]
                var NEW_PATH: []const u8 = "";
                var envp_managed = env_array.toManaged(allocator);
                try appendEnvpFromJS(globalThis, object, &envp_managed, &NEW_PATH);
                env_array = envp_managed.moveToUnmanaged();
                PATH = NEW_PATH;
            }

            try getArgv(globalThis, cmd_value, PATH, cwd, &argv0, allocator, &argv);

            if (try args.get(globalThis, "stdio")) |stdio_val| {
                if (!stdio_val.isEmptyOrUndefinedOrNull()) {
                    if (stdio_val.jsType().isArray()) {
                        var stdio_iter = try stdio_val.arrayIterator(globalThis);
                        var i: u31 = 0;
                        while (try stdio_iter.next()) |value| : (i += 1) {
                            try stdio[i].extract(globalThis, i, value, is_sync);
                            if (i == 2)
                                break;
                        }
                        i += 1;

                        while (try stdio_iter.next()) |value| : (i += 1) {
                            var new_item: Stdio = undefined;
                            try new_item.extract(globalThis, i, value, is_sync);

                            const opt = switch (new_item.asSpawnOption(i)) {
                                .result => |opt| opt,
                                .err => |e| {
                                    return e.throwJS(globalThis);
                                },
                            };
                            if (opt == .ipc) {
                                ipc_channel = @intCast(extra_fds.items.len);
                            }
                            try extra_fds.append(opt);
                        }
                    } else {
                        return globalThis.throwInvalidArguments("stdio must be an array", .{});
                    }
                }
            } else {
                if (try args.get(globalThis, "stdin")) |value| {
                    try stdio[0].extract(globalThis, 0, value, is_sync);
                }

                if (try args.get(globalThis, "stderr")) |value| {
                    try stdio[2].extract(globalThis, 2, value, is_sync);
                }

                if (try args.get(globalThis, "stdout")) |value| {
                    try stdio[1].extract(globalThis, 1, value, is_sync);
                }
            }

            if (comptime !is_sync) {
                if (try args.get(globalThis, "lazy")) |lazy_val| {
                    if (lazy_val.isBoolean()) {
                        lazy = lazy_val.toBoolean();
                    }
                }
            }

            if (try args.get(globalThis, "detached")) |detached_val| {
                if (detached_val.isBoolean()) {
                    detached = detached_val.toBoolean();
                }
            }

            if (Environment.isWindows) {
                if (try args.get(globalThis, "windowsHide")) |val| {
                    if (val.isBoolean()) {
                        windows_hide = val.asBoolean();
                    }
                }

                if (try args.get(globalThis, "windowsVerbatimArguments")) |val| {
                    if (val.isBoolean()) {
                        windows_verbatim_arguments = val.asBoolean();
                    }
                }
            }

            if (try args.get(globalThis, "timeout")) |timeout_value| brk: {
                if (timeout_value != .null) {
                    if (timeout_value.isNumber() and std.math.isPositiveInf(timeout_value.asNumber())) {
                        break :brk;
                    }

                    const timeout_int = try globalThis.validateIntegerRange(timeout_value, u64, 0, .{ .min = 0, .field_name = "timeout" });
                    if (timeout_int > 0)
                        timeout = @intCast(@as(u31, @truncate(timeout_int)));
                }
            }

            if (try args.get(globalThis, "killSignal")) |val| {
                killSignal = try bun.SignalCode.fromJS(val, globalThis);
            }

            if (try args.get(globalThis, "maxBuffer")) |val| {
                if (val.isNumber() and val.isFinite()) { // 'Infinity' does not set maxBuffer
                    const value = try val.coerce(i64, globalThis);
                    if (value > 0 and (stdio[0].isPiped() or stdio[1].isPiped() or stdio[2].isPiped())) {
                        maxBuffer = value;
                    }
                }
            }

            if (comptime !is_sync) {
                if (try args.getTruthy(globalThis, "terminal")) |terminal_val| {
                    if (comptime !Environment.isPosix) {
                        return globalThis.throwInvalidArguments("terminal option is not supported on this platform", .{});
                    }

                    // Check if it's an existing Terminal object
                    if (Terminal.fromJS(terminal_val)) |terminal| {
                        if (terminal.flags.closed) {
                            return globalThis.throwInvalidArguments("terminal is closed", .{});
                        }
                        if (terminal.slave_fd == bun.invalid_fd) {
                            return globalThis.throwInvalidArguments("terminal slave fd is no longer valid", .{});
                        }
                        existing_terminal = terminal;
                        terminal_js_value = terminal_val;
                    } else if (terminal_val.isObject()) {
                        // Create a new terminal from options
                        var term_options = try Terminal.Options.parseFromJS(globalThis, terminal_val);
                        terminal_info = Terminal.createFromSpawn(globalThis, term_options) catch |err| {
                            term_options.deinit();
                            return switch (err) {
                                error.OpenPtyFailed => globalThis.throw("Failed to open PTY", .{}),
                                error.DupFailed => globalThis.throw("Failed to duplicate PTY file descriptor", .{}),
                                error.NotSupported => globalThis.throw("PTY not supported on this platform", .{}),
                                error.WriterStartFailed => globalThis.throw("Failed to start terminal writer", .{}),
                                error.ReaderStartFailed => globalThis.throw("Failed to start terminal reader", .{}),
                            };
                        };
                    } else {
                        return globalThis.throwInvalidArguments("terminal must be a Terminal object or options object", .{});
                    }

                    const terminal = existing_terminal orelse terminal_info.?.terminal;
                    const slave_fd = terminal.getSlaveFd();
                    stdio[0] = .{ .fd = slave_fd };
                    stdio[1] = .{ .fd = slave_fd };
                    stdio[2] = .{ .fd = slave_fd };
                }
            }
        } else {
            try getArgv(globalThis, cmd_value, PATH, cwd, &argv0, allocator, &argv);
        }
    }

    log("spawn maxBuffer: {?d}", .{maxBuffer});

    if (!override_env and env_array.items.len == 0) {
        env_array.items = jsc_vm.transpiler.env.map.createNullDelimitedEnvMap(allocator) catch |err| return globalThis.throwError(err, "in Bun.spawn") catch return .zero;
        env_array.capacity = env_array.items.len;
    }

    inline for (0..stdio.len) |fd_index| {
        if (stdio[fd_index].canUseMemfd(is_sync, fd_index > 0 and maxBuffer != null)) {
            if (stdio[fd_index].useMemfd(fd_index)) {
                jsc_vm.counters.mark(.spawn_memfd);
            }
        }
    }
    var should_close_memfd = Environment.isLinux;

    defer {
        if (should_close_memfd) {
            inline for (0..stdio.len) |fd_index| {
                if (stdio[fd_index] == .memfd) {
                    stdio[fd_index].memfd.close();
                    stdio[fd_index] = .ignore;
                }
            }
        }
    }
    //"NODE_CHANNEL_FD=" is 16 bytes long, 15 bytes for the number, and 1 byte for the null terminator should be enough/safe
    var ipc_env_buf: [32]u8 = undefined;
    if (!is_sync) if (maybe_ipc_mode) |ipc_mode| {
        // IPC is currently implemented in a very limited way.
        //
        // Node lets you pass as many fds as you want, they all become be sockets; then, IPC is just a special
        // runtime-owned version of "pipe" (in which pipe is a misleading name since they're bidirectional sockets).
        //
        // Bun currently only supports three fds: stdin, stdout, and stderr, which are all unidirectional
        //
        // And then one fd is assigned specifically and only for IPC. If the user dont specify it, we add one (default: 3).
        //
        // When Bun.spawn() is given an `.ipc` callback, it enables IPC as follows:
        env_array.ensureUnusedCapacity(allocator, 3) catch |err| return globalThis.throwError(err, "in Bun.spawn") catch return .zero;
        const ipc_fd: i32 = brk: {
            if (ipc_channel == -1) {
                // If the user didn't specify an IPC channel, we need to add one
                ipc_channel = @intCast(extra_fds.items.len);
                var ipc_extra_fd_default = Stdio{ .ipc = {} };
                const fd: i32 = ipc_channel + 3;
                switch (ipc_extra_fd_default.asSpawnOption(fd)) {
                    .result => |opt| {
                        try extra_fds.append(opt);
                    },
                    .err => |e| {
                        return e.throwJS(globalThis);
                    },
                }
                break :brk fd;
            } else {
                break :brk @intCast(ipc_channel + 3);
            }
        };

        const pipe_env = std.fmt.bufPrintZ(
            &ipc_env_buf,
            "NODE_CHANNEL_FD={d}",
            .{ipc_fd},
        ) catch {
            return globalThis.throwOutOfMemory();
        };
        env_array.appendAssumeCapacity(pipe_env);

        env_array.appendAssumeCapacity(switch (ipc_mode) {
            inline else => |t| "NODE_CHANNEL_SERIALIZATION_MODE=" ++ @tagName(t),
        });
    };

    try env_array.append(allocator, null);
    try argv.append(null);

    if (comptime is_sync) {
        for (&stdio, 0..) |*io, i| {
            io.toSync(@truncate(i));
        }
    }

    // If the whole thread is supposed to do absolutely nothing while waiting,
    // we can block the thread which reduces CPU usage.
    //
    // That means:
    // - No maximum buffer
    // - No timeout
    // - No abort signal
    // - No stdin, stdout, stderr pipes
    // - No extra fds
    // - No auto killer (for tests)
    // - No execution time limit (for tests)
    // - No IPC
    // - No inspector (since they might want to press pause or step)
    const can_block_entire_thread_to_reduce_cpu_usage_in_fast_path = (comptime Environment.isPosix and is_sync) and
        abort_signal == null and
        timeout == null and
        maxBuffer == null and
        !stdio[0].isPiped() and
        !stdio[1].isPiped() and
        !stdio[2].isPiped() and
        extra_fds.items.len == 0 and
        !jsc_vm.auto_killer.enabled and
        !jsc_vm.jsc_vm.hasExecutionTimeLimit() and
        !jsc_vm.isInspectorEnabled() and
        !bun.feature_flag.BUN_FEATURE_FLAG_DISABLE_SPAWNSYNC_FAST_PATH.get();

    // For spawnSync, use an isolated event loop to prevent JavaScript timers from firing
    // and to avoid interfering with the main event loop
    const event_loop: *jsc.EventLoop = if (comptime is_sync)
        &jsc_vm.rareData().spawnSyncEventLoop(jsc_vm).event_loop
    else
        jsc_vm.eventLoop();

    if (comptime is_sync) {
        jsc_vm.rareData().spawnSyncEventLoop(jsc_vm).prepare(jsc_vm);
    }

    defer {
        if (comptime is_sync) {
            jsc_vm.rareData().spawnSyncEventLoop(jsc_vm).cleanup(jsc_vm, jsc_vm.eventLoop());
        }
    }

    const loop_handle = jsc.EventLoopHandle.init(event_loop);

    const spawn_options = bun.spawn.SpawnOptions{
        .cwd = cwd,
        .detached = detached,
        .stdin = switch (stdio[0].asSpawnOption(0)) {
            .result => |opt| opt,
            .err => |e| return e.throwJS(globalThis),
        },
        .stdout = switch (stdio[1].asSpawnOption(1)) {
            .result => |opt| opt,
            .err => |e| return e.throwJS(globalThis),
        },
        .stderr = switch (stdio[2].asSpawnOption(2)) {
            .result => |opt| opt,
            .err => |e| return e.throwJS(globalThis),
        },
        .extra_fds = extra_fds.items,
        .argv0 = argv0,
        .can_block_entire_thread_to_reduce_cpu_usage_in_fast_path = can_block_entire_thread_to_reduce_cpu_usage_in_fast_path,
        // Only pass pty_slave_fd for newly created terminals (for setsid+TIOCSCTTY setup).
        // For existing terminals, the session is already set up - child just uses the fd as stdio.
        .pty_slave_fd = if (Environment.isPosix) blk: {
            if (terminal_info) |ti| break :blk ti.terminal.getSlaveFd().native();
            break :blk -1;
        } else {},

        .windows = if (Environment.isWindows) .{
            .hide_window = windows_hide,
            .verbatim_arguments = windows_verbatim_arguments,
            .loop = loop_handle,
        },
    };

    var spawned = switch (bun.spawn.spawnProcess(
        &spawn_options,
        @ptrCast(argv.items.ptr),
        @ptrCast(env_array.items.ptr),
    ) catch |err| switch (err) {
        error.EMFILE, error.ENFILE => {
            spawn_options.deinit();
            const display_path: [:0]const u8 = if (argv.items.len > 0 and argv.items[0] != null)
                std.mem.sliceTo(argv.items[0].?, 0)
            else
                "";
            var systemerror = bun.sys.Error.fromCode(if (err == error.EMFILE) .MFILE else .NFILE, .posix_spawn).withPath(display_path).toSystemError();
            systemerror.errno = if (err == error.EMFILE) -bun.sys.UV_E.MFILE else -bun.sys.UV_E.NFILE;
            return globalThis.throwValue(systemerror.toErrorInstance(globalThis));
        },
        else => {
            spawn_options.deinit();
            return globalThis.throwError(err, ": failed to spawn process") catch return .zero;
        },
    }) {
        .err => |err| {
            spawn_options.deinit();
            switch (err.getErrno()) {
                .ACCES, .NOENT, .PERM, .ISDIR, .NOTDIR => |errno| {
                    const display_path: [:0]const u8 = if (argv.items.len > 0 and argv.items[0] != null)
                        std.mem.sliceTo(argv.items[0].?, 0)
                    else
                        "";
                    if (display_path.len > 0) {
                        var systemerror = err.withPath(display_path).toSystemError();
                        if (errno == .NOENT) systemerror.errno = -bun.sys.UV_E.NOENT;
                        return globalThis.throwValue(systemerror.toErrorInstance(globalThis));
                    }
                },
                else => {},
            }

            return globalThis.throwValue(try err.toJS(globalThis));
        },
        .result => |result| result,
    };

    // Use the isolated loop for spawnSync operations
    const process = spawned.toProcess(loop_handle, is_sync);

    var subprocess = bun.new(Subprocess, .{
        .ref_count = .init(),
        .globalThis = globalThis,
        .process = process,
        .pid_rusage = null,
        .stdin = .{ .ignore = {} },
        .stdout = .{ .ignore = {} },
        .stderr = .{ .ignore = {} },
        .stdio_pipes = .{},
        .ipc_data = null,
        .flags = .{
            .is_sync = is_sync,
        },
        .killSignal = undefined,
    });

    const posix_ipc_fd = if (Environment.isPosix and !is_sync and maybe_ipc_mode != null)
        spawned.extra_pipes.items[@intCast(ipc_channel)]
    else
        bun.invalid_fd;

    MaxBuf.createForSubprocess(subprocess, &subprocess.stderr_maxbuf, maxBuffer);
    MaxBuf.createForSubprocess(subprocess, &subprocess.stdout_maxbuf, maxBuffer);

    var promise_for_stream: jsc.JSValue = .zero;

    // When run synchronously, subprocess isn't garbage collected
    subprocess.* = Subprocess{
        .globalThis = globalThis,
        .process = process,
        .pid_rusage = null,
        .stdin = Writable.init(
            &stdio[0],
            event_loop,
            subprocess,
            spawned.stdin,
            &promise_for_stream,
        ) catch {
            subprocess.deref();
            return globalThis.throwOutOfMemory();
        },
        .stdout = Readable.init(
            stdio[1],
            event_loop,
            subprocess,
            spawned.stdout,
            jsc_vm.allocator,
            subprocess.stdout_maxbuf,
            is_sync,
        ),
        .stderr = Readable.init(
            stdio[2],
            event_loop,
            subprocess,
            spawned.stderr,
            jsc_vm.allocator,
            subprocess.stderr_maxbuf,
            is_sync,
        ),
        // 1. JavaScript.
        // 2. Process.
        .ref_count = .initExactRefs(2),
        .stdio_pipes = spawned.extra_pipes.moveToUnmanaged(),
        .ipc_data = if (!is_sync and comptime Environment.isWindows)
            if (maybe_ipc_mode) |ipc_mode| ( //
                .init(ipc_mode, .{ .subprocess = subprocess }, .uninitialized) //
            ) else null
        else
            null,

        .flags = .{
            .is_sync = is_sync,
        },
        .killSignal = killSignal,
        .stderr_maxbuf = subprocess.stderr_maxbuf,
        .stdout_maxbuf = subprocess.stdout_maxbuf,
        .terminal = existing_terminal orelse if (terminal_info) |info| info.terminal else null,
    };

    // For inline terminal options: close parent's slave_fd so EOF is received when child exits
    // For existing terminal: keep slave_fd open so terminal can be reused for more spawns
    if (terminal_info) |info| {
        terminal_js_value = info.js_value;
        info.terminal.closeSlaveFd();
        terminal_info = null;
    }
    // existing_terminal: don't close slave_fd - user manages lifecycle and can reuse

    subprocess.process.setExitHandler(subprocess);

    promise_for_stream.ensureStillAlive();
    subprocess.flags.is_stdin_a_readable_stream = promise_for_stream != .zero;

    if (promise_for_stream != .zero and !globalThis.hasException()) {
        if (promise_for_stream.toError()) |err| {
            _ = globalThis.throwValue(err) catch {};
        }
    }

    if (globalThis.hasException()) {
        const err = globalThis.takeException(error.JSError);
        // Ensure we kill the process so we don't leave things in an unexpected state.
        _ = subprocess.tryKill(subprocess.killSignal);

        if (globalThis.hasException()) {
            return error.JSError;
        }

        return globalThis.throwValue(err);
    }

    var posix_ipc_info: if (Environment.isPosix) IPC.Socket else void = undefined;
    if (Environment.isPosix and !is_sync) {
        if (maybe_ipc_mode) |mode| {
            if (uws.us_socket_t.fromFd(
                jsc_vm.rareData().spawnIPCContext(jsc_vm),
                @sizeOf(*IPC.SendQueue),
                posix_ipc_fd.cast(),
                1,
            )) |socket| {
                subprocess.ipc_data = .init(mode, .{ .subprocess = subprocess }, .uninitialized);
                posix_ipc_info = IPC.Socket.from(socket);
            }
        }
    }

    if (subprocess.ipc_data) |*ipc_data| {
        if (Environment.isPosix) {
            if (posix_ipc_info.ext(*IPC.SendQueue)) |ctx| {
                ctx.* = &subprocess.ipc_data.?;
                subprocess.ipc_data.?.socket = .{ .open = posix_ipc_info };
            }
        } else {
            if (ipc_data.windowsConfigureServer(
                subprocess.stdio_pipes.items[@intCast(ipc_channel)].buffer,
            ).asErr()) |err| {
                subprocess.deref();
                return globalThis.throwValue(try err.toJS(globalThis));
            }
            subprocess.stdio_pipes.items[@intCast(ipc_channel)] = .unavailable;
        }
        ipc_data.writeVersionPacket(globalThis);
    }

    if (subprocess.stdin == .pipe and promise_for_stream == .zero) {
        subprocess.stdin.pipe.signal = jsc.WebCore.streams.Signal.init(&subprocess.stdin);
    }

    const out = if (comptime !is_sync)
        subprocess.toJS(globalThis)
    else
        JSValue.zero;
    if (out != .zero) {
        subprocess.this_value.setWeak(out);
        // Immediately upgrade to strong if there's pending activity to prevent premature GC
        subprocess.updateHasPendingActivity();
    }

    var send_exit_notification = false;

    if (comptime !is_sync) {
        // This must go before other things happen so that the exit handler is
        // registered before onProcessExit can potentially be called.
        if (timeout) |timeout_val| {
            subprocess.event_loop_timer.next = bun.timespec.msFromNow(.allow_mocked_time, timeout_val);
            globalThis.bunVM().timer.insert(&subprocess.event_loop_timer);
            subprocess.setEventLoopTimerRefd(true);
        }

        bun.debugAssert(out != .zero);

        if (on_exit_callback.isCell()) {
            jsc.Codegen.JSSubprocess.onExitCallbackSetCached(out, globalThis, on_exit_callback);
        }
        if (on_disconnect_callback.isCell()) {
            jsc.Codegen.JSSubprocess.onDisconnectCallbackSetCached(out, globalThis, on_disconnect_callback);
        }
        if (ipc_callback.isCell()) {
            jsc.Codegen.JSSubprocess.ipcCallbackSetCached(out, globalThis, ipc_callback);
        }

        if (stdio[0] == .readable_stream) {
            jsc.Codegen.JSSubprocess.stdinSetCached(out, globalThis, stdio[0].readable_stream.value);
        }

        // Cache the terminal JS value if a terminal was created
        if (terminal_js_value != .zero) {
            jsc.Codegen.JSSubprocess.terminalSetCached(out, globalThis, terminal_js_value);
        }

        switch (subprocess.process.watch()) {
            .result => {},
            .err => {
                send_exit_notification = true;
                lazy = false;
            },
        }
    }

    defer {
        if (send_exit_notification) {
            if (subprocess.process.hasExited()) {
                // process has already exited, we called wait4(), but we did not call onProcessExit()
                subprocess.process.onExit(subprocess.process.status, &std.mem.zeroes(Rusage));
            } else {
                // process has already exited, but we haven't called wait4() yet
                // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                subprocess.process.wait(is_sync);
            }
        }
    }

    if (subprocess.stdin == .buffer) {
        if (subprocess.stdin.buffer.start().asErr()) |err| {
            _ = subprocess.tryKill(subprocess.killSignal);
            _ = globalThis.throwValue(err.toJS(globalThis) catch return error.JSError) catch {};
            return error.JSError;
        }
    }

    if (subprocess.stdout == .pipe) {
        if (subprocess.stdout.pipe.start(subprocess, event_loop).asErr()) |err| {
            _ = subprocess.tryKill(subprocess.killSignal);
            _ = globalThis.throwValue(err.toJS(globalThis) catch return error.JSError) catch {};
            return error.JSError;
        }
        if ((is_sync or !lazy) and subprocess.stdout == .pipe) {
            subprocess.stdout.pipe.readAll();
        }
    }

    if (subprocess.stderr == .pipe) {
        if (subprocess.stderr.pipe.start(subprocess, event_loop).asErr()) |err| {
            _ = subprocess.tryKill(subprocess.killSignal);
            _ = globalThis.throwValue(err.toJS(globalThis) catch return error.JSError) catch {};
            return error.JSError;
        }

        if ((is_sync or !lazy) and subprocess.stderr == .pipe) {
            subprocess.stderr.pipe.readAll();
        }
    }

    should_close_memfd = false;

    // Once everything is set up, we can add the abort listener
    // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
    // Therefore, we must do this at the very end.
    if (abort_signal) |signal| {
        signal.pendingActivityRef();
        subprocess.abort_signal = signal.addListener(subprocess, Subprocess.onAbortSignal);
        abort_signal = null;
    }

    if (comptime !is_sync) {
        if (!subprocess.process.hasExited()) {
            jsc_vm.onSubprocessSpawn(subprocess.process);
        }
        return out;
    }

    comptime bun.assert(is_sync);

    if (can_block_entire_thread_to_reduce_cpu_usage_in_fast_path) {
        jsc_vm.counters.mark(.spawnSync_blocking);
        const debug_timer = Output.DebugTimer.start();
        subprocess.process.wait(true);
        log("spawnSync fast path took {f}", .{debug_timer});

        // watchOrReap will handle the already exited case for us.
    }

    switch (subprocess.process.watchOrReap()) {
        .result => {
            // Once everything is set up, we can add the abort listener
            // Adding the abort listener may call the onAbortSignal callback immediately if it was already aborted
            // Therefore, we must do this at the very end.
            if (abort_signal) |signal| {
                signal.pendingActivityRef();
                subprocess.abort_signal = signal.addListener(subprocess, Subprocess.onAbortSignal);
                abort_signal = null;
            }
        },
        .err => {
            subprocess.process.wait(true);
        },
    }

    if (!subprocess.process.hasExited()) {
        jsc_vm.onSubprocessSpawn(subprocess.process);
    }

    var did_timeout = false;

    // Use the isolated event loop to tick instead of the main event loop
    // This ensures JavaScript timers don't fire and stdin/stdout from the main process aren't affected
    {
        var absolute_timespec = bun.timespec.epoch;
        var now = bun.timespec.now(.allow_mocked_time);
        var user_timespec: bun.timespec = if (timeout) |timeout_ms| now.addMs(timeout_ms) else absolute_timespec;

        // Support `AbortSignal.timeout`, but it's best-effort.
        // Specifying both `timeout: number` and `AbortSignal.timeout` chooses the soonest one.
        // This does mean if an AbortSignal times out it will throw
        if (subprocess.abort_signal) |signal| {
            if (signal.getTimeout()) |abort_signal_timeout| {
                if (abort_signal_timeout.event_loop_timer.state == .ACTIVE) {
                    if (user_timespec.eql(&.epoch) or abort_signal_timeout.event_loop_timer.next.order(&user_timespec) == .lt) {
                        user_timespec = abort_signal_timeout.event_loop_timer.next;
                    }
                }
            }
        }

        const has_user_timespec = !user_timespec.eql(&.epoch);

        const sync_loop = jsc_vm.rareData().spawnSyncEventLoop(jsc_vm);

        while (subprocess.computeHasPendingActivity()) {
            // Re-evaluate this at each iteration of the loop since it may change between iterations.
            const bun_test_timeout: bun.timespec = if (bun.jsc.Jest.Jest.runner) |runner| runner.getActiveTimeout() else .epoch;
            const has_bun_test_timeout = !bun_test_timeout.eql(&.epoch);

            if (has_bun_test_timeout) {
                switch (bun_test_timeout.orderIgnoreEpoch(user_timespec)) {
                    .lt => absolute_timespec = bun_test_timeout,
                    .eq => {},
                    .gt => absolute_timespec = user_timespec,
                }
            } else if (has_user_timespec) {
                absolute_timespec = user_timespec;
            } else {
                absolute_timespec = .epoch;
            }
            const has_timespec = !absolute_timespec.eql(&.epoch);

            if (subprocess.stdin == .buffer) {
                subprocess.stdin.buffer.watch();
            }

            if (subprocess.stderr == .pipe) {
                subprocess.stderr.pipe.watch();
            }

            if (subprocess.stdout == .pipe) {
                subprocess.stdout.pipe.watch();
            }

            // Tick the isolated event loop without passing timeout to avoid blocking
            // The timeout check is done at the top of the loop
            switch (sync_loop.tickWithTimeout(if (has_timespec and !did_timeout) &absolute_timespec else null)) {
                .completed => {
                    now = bun.timespec.now(.allow_mocked_time);
                },
                .timeout => {
                    now = bun.timespec.now(.allow_mocked_time);
                    const did_user_timeout = has_user_timespec and (absolute_timespec.eql(&user_timespec) or user_timespec.order(&now) == .lt);

                    if (did_user_timeout) {
                        did_timeout = true;
                        _ = subprocess.tryKill(subprocess.killSignal);
                    }

                    // Support bun:test timeouts AND spawnSync() timeout.
                    // There is a scenario where inside of spawnSync() a totally
                    // different test fails, and that SHOULD be okay.
                    if (has_bun_test_timeout) {
                        if (bun_test_timeout.order(&now) == .lt) {
                            var active_file_strong = bun.jsc.Jest.Jest.runner.?.bun_test_root.active_file
                                // TODO: add a .cloneNonOptional()?
                                .clone();

                            defer active_file_strong.deinit();
                            var taken_active_file = active_file_strong.take().?;
                            defer taken_active_file.deinit();

                            bun.jsc.Jest.Jest.runner.?.removeActiveTimeout(jsc_vm);

                            // This might internally call `std.c.kill` on this
                            // spawnSync process. Even if we do that, we still
                            // need to reap the process. So we may go through
                            // the event loop again, but it should wake up
                            // ~instantly so we can drain the events.
                            jsc.Jest.bun_test.BunTest.bunTestTimeoutCallback(taken_active_file, &absolute_timespec, jsc_vm);
                        }
                    }
                },
            }
        }
    }
    if (globalThis.hasException()) {
        // e.g. a termination exception.
        return .zero;
    }

    subprocess.updateHasPendingActivity();

    const signalCode = subprocess.getSignalCode(globalThis);
    const exitCode = subprocess.getExitCode(globalThis);
    const stdout = try subprocess.stdout.toBufferedValue(globalThis);
    const stderr = try subprocess.stderr.toBufferedValue(globalThis);
    const resource_usage: JSValue = if (!globalThis.hasException()) try subprocess.createResourceUsageObject(globalThis) else .zero;
    const exitedDueToTimeout = did_timeout;
    const exitedDueToMaxBuffer = subprocess.exited_due_to_maxbuf;
    const resultPid = jsc.JSValue.jsNumberFromInt32(subprocess.pid());
    subprocess.finalize();

    const sync_value = jsc.JSValue.createEmptyObject(globalThis, 0);
    sync_value.put(globalThis, jsc.ZigString.static("exitCode"), exitCode);
    if (!signalCode.isEmptyOrUndefinedOrNull()) {
        sync_value.put(globalThis, jsc.ZigString.static("signalCode"), signalCode);
    }
    sync_value.put(globalThis, jsc.ZigString.static("stdout"), stdout);
    sync_value.put(globalThis, jsc.ZigString.static("stderr"), stderr);
    sync_value.put(globalThis, jsc.ZigString.static("success"), JSValue.jsBoolean(exitCode.isInt32() and exitCode.asInt32() == 0));
    sync_value.put(globalThis, jsc.ZigString.static("resourceUsage"), resource_usage);
    if (timeout != null) sync_value.put(globalThis, jsc.ZigString.static("exitedDueToTimeout"), if (exitedDueToTimeout) .true else .false);
    if (maxBuffer != null) sync_value.put(globalThis, jsc.ZigString.static("exitedDueToMaxBuffer"), if (exitedDueToMaxBuffer != null) .true else .false);
    sync_value.put(globalThis, jsc.ZigString.static("pid"), resultPid);

    return sync_value;
}

fn throwCommandNotFound(globalThis: *jsc.JSGlobalObject, command: []const u8) bun.JSError {
    const err = jsc.SystemError{
        .message = bun.handleOom(bun.String.createFormat("Executable not found in $PATH: \"{s}\"", .{command})),
        .code = bun.String.static("ENOENT"),
        .errno = -bun.sys.UV_E.NOENT,
        .path = bun.String.cloneUTF8(command),
    };
    return globalThis.throwValue(err.toErrorInstance(globalThis));
}

pub fn appendEnvpFromJS(globalThis: *jsc.JSGlobalObject, object: *jsc.JSObject, envp: *std.array_list.Managed(?[*:0]const u8), PATH: *[]const u8) bun.JSError!void {
    var object_iter = try jsc.JSPropertyIterator(.{ .skip_empty_name = false, .include_value = true }).init(globalThis, object);
    defer object_iter.deinit();

    try envp.ensureTotalCapacityPrecise(object_iter.len +
        // +1 incase there's IPC
        // +1 for null terminator
        2);
    while (try object_iter.next()) |key| {
        var value = object_iter.value;
        if (value.isUndefined()) continue;

        const value_bunstr = try value.toBunString(globalThis);
        defer value_bunstr.deref();

        // Check for null bytes in env key and value (security: prevent null byte injection)
        if (key.indexOfAsciiChar(0) != null) {
            return globalThis.ERR(.INVALID_ARG_VALUE, "The property 'options.env['{f}']' must be a string without null bytes. Received \"{f}\"", .{ key.toZigString(), key.toZigString() }).throw();
        }
        if (value_bunstr.indexOfAsciiChar(0) != null) {
            return globalThis.ERR(.INVALID_ARG_VALUE, "The property 'options.env['{f}']' must be a string without null bytes. Received \"{f}\"", .{ key.toZigString(), value_bunstr.toZigString() }).throw();
        }

        const line = try std.fmt.allocPrintSentinel(envp.allocator, "{f}={f}", .{ key, value_bunstr.toZigString() }, 0);

        if (key.eqlComptime("PATH")) {
            PATH.* = bun.asByteSlice(line["PATH=".len..]);
        }

        try envp.append(line);
    }
}

const log = Output.scoped(.Subprocess, .hidden);
extern "C" const BUN_DEFAULT_PATH_FOR_SPAWN: [*:0]const u8;

const IPC = @import("../../ipc.zig");
const Terminal = @import("./Terminal.zig");
const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const SignalCode = bun.SignalCode;
const default_allocator = bun.default_allocator;
const strings = bun.strings;
const uws = bun.uws;
const which = bun.which;
const windows = bun.windows;
const MaxBuf = bun.io.MaxBuf;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const Subprocess = jsc.Subprocess;
const Readable = Subprocess.Readable;
const Writable = Subprocess.Writable;

const Process = bun.spawn.Process;
const Rusage = bun.spawn.Rusage;
const Stdio = bun.spawn.Stdio;
