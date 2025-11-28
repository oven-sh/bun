//! A shell primarily runs commands, so this is the main big mac daddy state node, the
//! bread and butter, the fuel that makes this lil shell scripting language go.
//!
//! There are two kinds of commands we are going to run:
//! - builtins: commands we implement natively in Zig and which run in the
//!             current Bun process (see `Builtin.zig` and the `builtins` folder)
//!
//! - subprocesses: commands which run in a new process
pub const Cmd = @This();

base: State,
node: *const ast.Cmd,
parent: ParentPtr,

/// Arena used for memory needed to spawn command.
/// For subprocesses:
///   - allocates argv, env array, etc.
///   - Freed after calling posix spawn since its not needed anymore
/// For Builtins:
///   - allocates argv, sometimes used by the builtin for small allocations.
///   - Freed when builtin is done (since it contains argv which might be used at any point)
///
/// TODO: Change to `AllocationScope`. This will allow us to track memory misuse in debug
///       builds
spawn_arena: bun.ArenaAllocator,
spawn_arena_freed: bool = false,

args: std.array_list.Managed(?[*:0]const u8),

/// If the cmd redirects to a file we have to expand that string.
/// Allocated in `spawn_arena`
redirection_file: std.array_list.Managed(u8),
redirection_fd: ?*CowFd = null,

/// The underlying state to manage the command (builtin or subprocess)
exec: Exec = .none,
exit_code: ?ExitCode = null,
io: IO,

state: union(enum) {
    idle,
    expanding_assigns: Assigns,
    expanding_redirect: struct {
        idx: u32 = 0,
        expansion: Expansion,
    },
    expanding_args: struct {
        idx: u32 = 0,
        expansion: Expansion,
    },
    exec,
    done,
    waiting_write_err,
},

/// If a subprocess and its stdout/stderr exit immediately, we queue
/// completion of this `Cmd` onto the event loop to avoid having the Cmd
/// unexpectedly deinitalizing deeper in the callstack and becoming
/// undefined memory.
pub const ShellAsyncSubprocessDone = struct {
    cmd: *Cmd,
    concurrent_task: jsc.EventLoopTask,

    pub fn format(this: *const ShellAsyncSubprocessDone, writer: *std.Io.Writer) std.Io.Writer.Error!void {
        try writer.print("ShellAsyncSubprocessDone(0x{x}, cmd=0{x})", .{ @intFromPtr(this), @intFromPtr(this.cmd) });
    }

    pub fn enqueue(this: *ShellAsyncSubprocessDone) void {
        log("{f} enqueue", .{this});
        const ctx = this;
        const evtloop = this.cmd.base.eventLoop();

        if (evtloop == .js) {
            evtloop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(ctx, .manual_deinit));
        } else {
            evtloop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(ctx, "runFromMainThreadMini"));
        }
    }

    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
        this.runFromMainThread();
    }

    pub fn runFromMainThread(this: *ShellAsyncSubprocessDone) void {
        log("{f} runFromMainThread", .{this});
        defer this.deinit();
        this.cmd.parent.childDone(this.cmd, this.cmd.exit_code orelse 0).run();
    }

    pub fn deinit(this: *ShellAsyncSubprocessDone) void {
        log("{f} deinit", .{this});
        bun.destroy(this);
    }
};

pub const Exec = union(enum) {
    none,
    bltn: Builtin,
    subproc: struct {
        child: *Subprocess,
        buffered_closed: BufferedIoClosed = .{},
    },
};

const BufferedIoClosed = struct {
    stdin: ?bool = null,
    stdout: ?BufferedIoState = null,
    stderr: ?BufferedIoState = null,

    const BufferedIoState = struct {
        state: union(enum) {
            open,
            closed: bun.ByteList,
        } = .open,
        owned: bool = false,

        pub fn deinit(this: *BufferedIoState) void {
            if (this.state == .closed and this.owned) {
                this.state.closed.clearAndFree(bun.default_allocator);
            }
        }

        pub fn closed(this: *BufferedIoState) bool {
            return this.state == .closed;
        }
    };

    fn deinit(this: *BufferedIoClosed) void {
        if (this.stdout) |*io| {
            io.deinit();
        }

        if (this.stderr) |*io| {
            io.deinit();
        }
    }

    fn allClosed(this: *BufferedIoClosed) bool {
        const ret = (if (this.stdin) |stdin| stdin else true) and
            (if (this.stdout) |*stdout| stdout.closed() else true) and
            (if (this.stderr) |*stderr| stderr.closed() else true);
        log("BufferedIOClosed(0x{x}) all_closed={} stdin={} stdout={} stderr={}", .{ @intFromPtr(this), ret, if (this.stdin) |stdin| stdin else true, if (this.stdout) |*stdout| stdout.closed() else true, if (this.stderr) |*stderr| stderr.closed() else true });
        return ret;
    }

    fn close(this: *BufferedIoClosed, cmd: *Cmd, io: union(enum) { stdout: *Subprocess.Readable, stderr: *Subprocess.Readable, stdin }) void {
        switch (io) {
            .stdout => {
                if (this.stdout) |*stdout| {
                    const readable = io.stdout;

                    // If the shell state is piped (inside a cmd substitution) aggregate the output of this command
                    if (cmd.io.stdout == .pipe and cmd.io.stdout == .pipe and !cmd.node.redirect.redirectsElsewhere(.stdout)) {
                        const the_slice = readable.pipe.slice();
                        bun.handleOom(cmd.base.shell.buffered_stdout().appendSlice(bun.default_allocator, the_slice));
                    }

                    var buffer = readable.pipe.takeBuffer();
                    stdout.state = .{ .closed = bun.ByteList.moveFromList(&buffer) };
                }
            },
            .stderr => {
                if (this.stderr) |*stderr| {
                    const readable = io.stderr;

                    // If the shell state is piped (inside a cmd substitution) aggregate the output of this command
                    if (cmd.io.stderr == .pipe and cmd.io.stderr == .pipe and !cmd.node.redirect.redirectsElsewhere(.stderr)) {
                        const the_slice = readable.pipe.slice();
                        bun.handleOom(cmd.base.shell.buffered_stderr().appendSlice(bun.default_allocator, the_slice));
                    }

                    var buffer = readable.pipe.takeBuffer();
                    stderr.state = .{ .closed = bun.ByteList.moveFromList(&buffer) };
                }
            },
            .stdin => {
                this.stdin = true;
            },
        }
    }

    fn isBuffered(this: *BufferedIoClosed, comptime io: enum { stdout, stderr, stdin }) bool {
        return @field(this, @tagName(io)) != null;
    }

    fn fromStdio(io: *const [3]bun.shell.subproc.Stdio) BufferedIoClosed {
        return .{
            .stdin = if (io[stdin_no].isPiped()) false else null,
            .stdout = if (io[stdout_no].isPiped()) .{ .owned = io[stdout_no] == .pipe } else null,
            .stderr = if (io[stderr_no].isPiped()) .{ .owned = io[stderr_no] == .pipe } else null,
        };
    }
};

pub const ParentPtr = StatePtrUnion(.{
    Stmt,
    Binary,
    Pipeline,
    Async,
    // Expansion,
    // TODO
    // .subst = void,
});

pub const ChildPtr = StatePtrUnion(.{
    Assigns,
    Expansion,
});

pub fn isSubproc(this: *Cmd) bool {
    return this.exec == .subproc;
}

/// If starting a command results in an error (failed to find executable in path for example)
/// then it should write to the stderr of the entire shell script process
pub fn writeFailingError(this: *Cmd, comptime fmt: []const u8, args: anytype) Yield {
    const handler = struct {
        fn enqueueCb(ctx: *Cmd) void {
            ctx.state = .waiting_write_err;
        }
    };
    return this.base.shell.writeFailingErrorFmt(this, handler.enqueueCb, fmt, args);
}

pub fn init(
    interpreter: *Interpreter,
    shell_state: *ShellExecEnv,
    node: *const ast.Cmd,
    parent: ParentPtr,
    io: IO,
) *Cmd {
    var cmd = parent.create(Cmd);
    cmd.* = .{
        .base = State.initWithNewAllocScope(.cmd, interpreter, shell_state),
        .node = node,
        .parent = parent,

        .spawn_arena = undefined,
        .args = undefined,
        .redirection_file = undefined,

        .exit_code = null,
        .io = io,
        .state = .idle,
    };
    cmd.spawn_arena = bun.ArenaAllocator.init(cmd.base.allocator());
    cmd.args = bun.handleOom(std.array_list.Managed(?[*:0]const u8).initCapacity(cmd.base.allocator(), node.name_and_args.len));
    cmd.redirection_file = std.array_list.Managed(u8).init(cmd.spawn_arena.allocator());

    return cmd;
}

pub fn next(this: *Cmd) Yield {
    while (this.state != .done) {
        switch (this.state) {
            .idle => {
                this.state = .{ .expanding_assigns = undefined };
                Assigns.initBorrowed(&this.state.expanding_assigns, this.base.interpreter, this.base.shell, this.node.assigns, .cmd, Assigns.ParentPtr.init(this), this.io.copy());
                return this.state.expanding_assigns.start();
            },
            .expanding_assigns => {
                return .suspended;
            },
            .expanding_redirect => {
                if (this.state.expanding_redirect.idx >= 1) {
                    this.state = .{
                        .expanding_args = .{
                            .expansion = undefined, // initialized in the next iteration
                        },
                    };
                    continue;
                }
                this.state.expanding_redirect.idx += 1;

                // Get the node to expand otherwise go straight to
                // `expanding_args` state
                const node_to_expand = brk: {
                    if (this.node.redirect_file != null and this.node.redirect_file.? == .atom) break :brk &this.node.redirect_file.?.atom;
                    this.state = .{
                        .expanding_args = .{
                            .expansion = undefined, // initialized in the next iteration
                        },
                    };
                    continue;
                };

                this.redirection_file = std.array_list.Managed(u8).init(this.spawn_arena.allocator());

                Expansion.init(
                    this.base.interpreter,
                    this.base.shell,
                    &this.state.expanding_redirect.expansion,
                    node_to_expand,
                    Expansion.ParentPtr.init(this),
                    .{
                        .single = .{
                            .list = &this.redirection_file,
                        },
                    },
                    this.io.copy(),
                );

                return this.state.expanding_redirect.expansion.start();
            },
            .expanding_args => {
                if (this.state.expanding_args.idx >= this.node.name_and_args.len) {
                    return this.transitionToExecStateAndYield();
                }

                bun.handleOom(this.args.ensureUnusedCapacity(1));
                Expansion.init(
                    this.base.interpreter,
                    this.base.shell,
                    &this.state.expanding_args.expansion,
                    &this.node.name_and_args[this.state.expanding_args.idx],
                    Expansion.ParentPtr.init(this),
                    .{
                        .array_of_ptr = &this.args,
                    },
                    this.io.copy(),
                );

                this.state.expanding_args.idx += 1;

                return this.state.expanding_args.expansion.start();
            },
            .waiting_write_err => {
                bun.shell.unreachableState("Cmd.next", "waiting_write_err");
            },
            .exec => {
                bun.shell.unreachableState("Cmd.next", "exec");
            },
            .done => unreachable,
        }
    }

    if (this.state == .done) {
        return this.parent.childDone(this, this.exit_code.?);
    }

    return this.parent.childDone(this, 1);
}

fn transitionToExecStateAndYield(this: *Cmd) Yield {
    this.state = .exec;
    return this.initSubproc();
}

pub fn start(this: *Cmd) Yield {
    log("cmd start {x}", .{@intFromPtr(this)});
    return .{ .cmd = this };
}

pub fn onIOWriterChunk(this: *Cmd, _: usize, e: ?jsc.SystemError) Yield {
    if (e) |err| {
        this.base.throw(&bun.shell.ShellErr.newSys(err));
        return .failed;
    }
    assert(this.state == .waiting_write_err);
    return this.parent.childDone(this, 1);
}

pub fn childDone(this: *Cmd, child: ChildPtr, exit_code: ExitCode) Yield {
    if (child.ptr.is(Assigns)) {
        if (exit_code != 0) {
            const err = this.state.expanding_assigns.state.err;
            this.state.expanding_assigns.state.err = .{ .custom = "" };
            defer err.deinit(bun.default_allocator);

            this.state.expanding_assigns.deinit();
            return this.writeFailingError("{f}\n", .{err});
        }

        this.state.expanding_assigns.deinit();
        this.state = .{
            .expanding_redirect = .{
                .expansion = undefined,
            },
        };
        return .{ .cmd = this };
    }

    if (child.ptr.is(Expansion)) {
        child.deinit();
        if (exit_code != 0) {
            const err = switch (this.state) {
                .expanding_redirect => this.state.expanding_redirect.expansion.state.err,
                .expanding_args => this.state.expanding_args.expansion.state.err,
                else => @panic("Invalid state"),
            };
            defer err.deinit(this.base.allocator());
            return this.writeFailingError("{f}\n", .{err});
        }
        // Handling this case from the shell spec:
        // "If there is no command name, but the command contained a
        // command substitution, the command shall complete with the
        // exit status of the last command substitution performed."
        //
        // See the comment where `this.out_exit_code` is assigned for
        // more info.
        const e: *Expansion = child.ptr.as(Expansion);
        if (this.state == .expanding_args and
            e.node.* == .simple and
            e.node.simple == .cmd_subst and
            this.state.expanding_args.idx == 1 and this.node.name_and_args.len == 1)
        {
            this.exit_code = e.out_exit_code;
        }
        return .{ .cmd = this };
    }

    @panic("Expected Cmd child to be Assigns or Expansion. This indicates a bug in Bun. Please file a GitHub issue. ");
}

fn initSubproc(this: *Cmd) Yield {
    log("cmd init subproc ({x}, cwd={s})", .{ @intFromPtr(this), this.base.shell.cwd() });

    var arena = &this.spawn_arena;
    // var arena_allocator = arena.allocator();
    var spawn_args = Subprocess.SpawnArgs.default(arena, this, this.base.interpreter.event_loop, false);

    spawn_args.cmd_parent = this;
    spawn_args.cwd = this.base.shell.cwdZ();

    {
        bun.handleOom(this.args.append(null));

        log("Cmd(0x{x}, {s}) IO: {f}", .{ @intFromPtr(this), if (this.args.items.len > 0) this.args.items[0] orelse "<no args>" else "<no args>", this.io });
        if (bun.Environment.isDebug) {
            for (this.args.items) |maybe_arg| {
                if (maybe_arg) |arg| {
                    if (bun.sliceTo(arg, 0).len > 80) {
                        log("ARG: {s}...\n", .{arg[0..80]});
                    } else {
                        log("ARG: {s}\n", .{arg});
                    }
                }
            }
        }

        const first_arg = this.args.items[0] orelse {
            // Sometimes the expansion can result in an empty string
            //
            //  For example:
            //
            //     await $`echo "" > script.sh`
            //     await $`(bash ./script.sh)`
            //     await $`$(lkdlksdfjsf)`
            //
            // In this case, we should just exit.
            //
            // BUT, if the expansion contained a single command
            // substitution (third example above), then we need to
            // return the exit code of that command substitution.
            return this.parent.childDone(this, this.exit_code orelse 0);
        };

        const first_arg_len = std.mem.len(first_arg);
        const first_arg_real = first_arg[0..first_arg_len];

        if (Builtin.Kind.fromStr(first_arg[0..first_arg_len])) |b| {
            const cwd = this.base.shell.cwd_fd;
            const maybe_yield = Builtin.init(
                this,
                this.base.interpreter,
                b,
                arena,
                this.node,
                &this.args,
                &this.base.shell.export_env,
                &this.base.shell.cmd_local_env,
                cwd,
                &this.io,
            );
            if (maybe_yield) |yield| return yield;

            if (comptime bun.Environment.allow_assert) {
                assert(this.exec == .bltn);
            }

            log("Builtin name: {s}", .{@tagName(this.exec)});

            return this.exec.bltn.start();
        }

        const path_buf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(path_buf);
        const resolved = which(path_buf, spawn_args.PATH, spawn_args.cwd, first_arg_real) orelse blk: {
            if (bun.strings.eqlComptime(first_arg_real, "bun") or bun.strings.eqlComptime(first_arg_real, "bun-debug")) blk2: {
                break :blk bun.selfExePath() catch break :blk2;
            }
            return this.writeFailingError("bun: command not found: {s}\n", .{first_arg});
        };

        this.base.allocator().free(first_arg_real);
        const duped = bun.handleOom(this.base.allocator().dupeZ(u8, bun.span(resolved)));
        this.args.items[0] = duped;
    }

    // Fill the env from the export end and cmd local env
    {
        var env_iter = this.base.shell.export_env.iterator();
        spawn_args.fillEnv(&env_iter, false);
        env_iter = this.base.shell.cmd_local_env.iterator();
        spawn_args.fillEnv(&env_iter, false);
    }

    var shellio: shell.subproc.ShellIO = .{};
    defer shellio.deref();
    this.io.to_subproc_stdio(&spawn_args.stdio, &shellio);

    if (this.initRedirections(&spawn_args) catch .failed) |yield| return yield;

    const buffered_closed = BufferedIoClosed.fromStdio(&spawn_args.stdio);
    log("cmd ({x}) set buffered closed", .{@intFromPtr(this)});

    this.exec = .{ .subproc = .{
        .child = undefined,
        .buffered_closed = buffered_closed,
    } };
    var did_exit_immediately = false;
    const subproc = switch (Subprocess.spawnAsync(this.base.eventLoop(), &shellio, spawn_args, &this.exec.subproc.child, &did_exit_immediately)) {
        .result => this.exec.subproc.child,
        .err => |*e| {
            this.exec = .none;
            return this.writeFailingError("{f}\n", .{e});
        },
    };
    subproc.ref();
    this.spawn_arena_freed = true;
    arena.deinit();

    if (did_exit_immediately) {
        if (subproc.process.hasExited()) {
            // process has already exited, we called wait4(), but we did not call onProcessExit()
            subproc.process.onExit(subproc.process.status, &std.mem.zeroes(bun.spawn.Rusage));
        } else {
            // process has already exited, but we haven't called wait4() yet
            // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
            subproc.process.wait(false);
        }
    }

    return .suspended;
}

fn initRedirections(this: *Cmd, spawn_args: *Subprocess.SpawnArgs) bun.JSError!?Yield {
    if (this.node.redirect_file) |redirect| {
        const in_cmd_subst = false;

        if (comptime in_cmd_subst) {
            setStdioFromRedirect(&spawn_args.stdio, this.node.redirect, .ignore);
        } else switch (redirect) {
            .jsbuf => |val| {
                // JS values in here is probably a bug
                if (this.base.eventLoop() != .js) @panic("JS values not allowed in this context");
                const global = this.base.eventLoop().js.global;

                if (this.base.interpreter.jsobjs[val.idx].asArrayBuffer(global)) |buf| {
                    const stdio: bun.shell.subproc.Stdio = .{ .array_buffer = jsc.ArrayBuffer.Strong{
                        .array_buffer = buf,
                        .held = .create(buf.value, global),
                    } };

                    setStdioFromRedirect(&spawn_args.stdio, this.node.redirect, stdio);
                } else if (this.base.interpreter.jsobjs[val.idx].as(jsc.WebCore.Blob)) |blob__| {
                    const blob = blob__.dupe();
                    if (this.node.redirect.stdin) {
                        try spawn_args.stdio[stdin_no].extractBlob(global, .{ .Blob = blob }, stdin_no);
                    } else if (this.node.redirect.stdout) {
                        try spawn_args.stdio[stdin_no].extractBlob(global, .{ .Blob = blob }, stdout_no);
                    } else if (this.node.redirect.stderr) {
                        try spawn_args.stdio[stdin_no].extractBlob(global, .{ .Blob = blob }, stderr_no);
                    }
                } else if (try jsc.WebCore.ReadableStream.fromJS(this.base.interpreter.jsobjs[val.idx], global)) |rstream| {
                    _ = rstream;
                    @panic("TODO SHELL READABLE STREAM");
                } else if (this.base.interpreter.jsobjs[val.idx].as(jsc.WebCore.Response)) |req| {
                    req.getBodyValue().toBlobIfPossible();
                    if (this.node.redirect.stdin) {
                        try spawn_args.stdio[stdin_no].extractBlob(global, req.getBodyValue().useAsAnyBlob(), stdin_no);
                    }
                    if (this.node.redirect.stdout) {
                        try spawn_args.stdio[stdout_no].extractBlob(global, req.getBodyValue().useAsAnyBlob(), stdout_no);
                    }
                    if (this.node.redirect.stderr) {
                        try spawn_args.stdio[stderr_no].extractBlob(global, req.getBodyValue().useAsAnyBlob(), stderr_no);
                    }
                } else {
                    const jsval = this.base.interpreter.jsobjs[val.idx];
                    return global.throw("Unknown JS value used in shell: {f}", .{jsval.fmtString(global)});
                }
            },
            .atom => {
                if (this.redirection_file.items.len == 0) {
                    return this.writeFailingError("bun: ambiguous redirect: at `{s}`\n", .{spawn_args.cmd_parent.args.items[0] orelse "<unknown>"});
                }
                const path = this.redirection_file.items[0..this.redirection_file.items.len -| 1 :0];
                log("Expanded Redirect: {s}\n", .{this.redirection_file.items[0..]});
                const perm = 0o666;
                const flags = this.node.redirect.toFlags();
                const redirfd = switch (ShellSyscall.openat(this.base.shell.cwd_fd, path, flags, perm)) {
                    .err => |e| {
                        return this.writeFailingError("bun: {f}: {s}", .{ e.toShellSystemError().message, path });
                    },
                    .result => |f| f,
                };
                this.redirection_fd = CowFd.init(redirfd);
                setStdioFromRedirect(&spawn_args.stdio, this.node.redirect, .{ .fd = redirfd });
            },
        }
    } else if (this.node.redirect.duplicate_out) {
        if (this.node.redirect.stdout) {
            spawn_args.stdio[stderr_no] = .{ .dup2 = .{ .out = .stderr, .to = .stdout } };
        }

        if (this.node.redirect.stderr) {
            spawn_args.stdio[stdout_no] = .{ .dup2 = .{ .out = .stdout, .to = .stderr } };
        }
    }

    return null;
}

fn setStdioFromRedirect(stdio: *[3]shell.subproc.Stdio, flags: ast.RedirectFlags, val: shell.subproc.Stdio) void {
    if (flags.stdin) {
        stdio.*[stdin_no] = val;
    }

    if (flags.duplicate_out) {
        stdio.*[stdout_no] = val;
        stdio.*[stderr_no] = val;
    } else {
        if (flags.stdout) {
            stdio.*[stdout_no] = val;
        }

        if (flags.stderr) {
            stdio.*[stderr_no] = val;
        }
    }
}

/// Returns null if stdout is buffered
pub fn stdoutSlice(this: *Cmd) ?[]const u8 {
    switch (this.exec) {
        .none => return null,
        .subproc => {
            if (this.exec.subproc.buffered_closed.stdout != null and this.exec.subproc.buffered_closed.stdout.?.state == .closed) {
                return this.exec.subproc.buffered_closed.stdout.?.state.closed.slice();
            }
            return null;
        },
        .bltn => {
            switch (this.exec.bltn.stdout) {
                .buf => return this.exec.bltn.stdout.buf.items[0..],
                .arraybuf => return this.exec.bltn.stdout.arraybuf.buf.slice(),
                .blob => return this.exec.bltn.stdout.blob.sharedView(),
                else => return null,
            }
        },
    }
}

pub fn hasFinished(this: *Cmd) bool {
    log("Cmd(0x{x}) exit_code={?d}", .{ @intFromPtr(this), this.exit_code });
    if (this.exit_code == null) return false;
    if (this.exec != .none) {
        if (this.exec == .subproc) {
            return this.exec.subproc.buffered_closed.allClosed();
        }
        return false;
    }
    return true;
}

/// Called by Subprocess
pub fn onExit(this: *Cmd, exit_code: ExitCode) void {
    this.exit_code = exit_code;

    const has_finished = this.hasFinished();
    log("cmd exit code={d} has_finished={} ({x})", .{ exit_code, has_finished, @intFromPtr(this) });
    if (has_finished) {
        this.state = .done;
        this.next().run();
    }
}

// TODO check that this also makes sure that the poll ref is killed because if it isn't then this Cmd pointer will be stale and so when the event for pid exit happens it will cause crash
pub fn deinit(this: *Cmd) void {
    log("Cmd(0x{x}, {s}) cmd deinit", .{ @intFromPtr(this), @tagName(this.exec) });
    if (this.redirection_fd) |redirfd| {
        this.redirection_fd = null;
        redirfd.deref();
    }

    if (this.exec != .none) {
        if (this.exec == .subproc) {
            var cmd = this.exec.subproc.child;
            if (cmd.hasExited()) {
                cmd.unref(true);
            } else {
                _ = cmd.tryKill(9);
                cmd.unref(true);
                cmd.deinit();
            }

            this.exec.subproc.buffered_closed.deinit();
        } else {
            this.exec.bltn.deinit();
        }
        this.exec = .none;
    }

    {
        for (this.args.items) |maybe_arg| {
            if (maybe_arg) |arg| {
                this.base.allocator().free(bun.sliceTo(arg, 0));
            }
        }
        this.args.deinit();
    }

    if (!this.spawn_arena_freed) {
        log("Spawn arena free", .{});
        this.spawn_arena.deinit();
    }

    this.io.deref();
    this.base.endScope();
    this.parent.destroy(this);
}

pub fn bufferedInputClose(this: *Cmd) void {
    this.exec.subproc.buffered_closed.close(this, .stdin);
}

pub fn bufferedOutputClose(this: *Cmd, kind: Subprocess.OutKind, err: ?jsc.SystemError) Yield {
    switch (kind) {
        .stdout => this.bufferedOutputCloseStdout(err),
        .stderr => this.bufferedOutputCloseStderr(err),
    }
    if (this.hasFinished()) {
        if (!this.spawn_arena_freed) {
            var async_subprocess_done = bun.new(ShellAsyncSubprocessDone, .{
                .cmd = this,
                .concurrent_task = jsc.EventLoopTask.fromEventLoop(this.base.eventLoop()),
            });
            async_subprocess_done.enqueue();
            return .suspended;
        } else {
            return this.parent.childDone(this, this.exit_code orelse 0);
        }
    }
    return .suspended;
}

pub fn bufferedOutputCloseStdout(this: *Cmd, err: ?jsc.SystemError) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.exec == .subproc);
    }
    log("cmd ({x}) close buffered stdout", .{@intFromPtr(this)});
    if (err) |e| {
        this.exit_code = @as(ExitCode, @intCast(@intFromEnum(e.getErrno())));
    }
    if (this.io.stdout == .fd and this.io.stdout.fd.captured != null and !this.node.redirect.redirectsElsewhere(.stdout)) {
        var buf = this.io.stdout.fd.captured.?;
        const the_slice = this.exec.subproc.child.stdout.pipe.slice();
        bun.handleOom(buf.appendSlice(bun.default_allocator, the_slice));
    }
    this.exec.subproc.buffered_closed.close(this, .{ .stdout = &this.exec.subproc.child.stdout });
    this.exec.subproc.child.closeIO(.stdout);
}

pub fn bufferedOutputCloseStderr(this: *Cmd, err: ?jsc.SystemError) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.exec == .subproc);
    }
    log("cmd ({x}) close buffered stderr", .{@intFromPtr(this)});
    if (err) |e| {
        this.exit_code = @as(ExitCode, @intCast(@intFromEnum(e.getErrno())));
    }
    if (this.io.stderr == .fd and this.io.stderr.fd.captured != null and !this.node.redirect.redirectsElsewhere(.stderr)) {
        var buf = this.io.stderr.fd.captured.?;
        bun.handleOom(buf.appendSlice(bun.default_allocator, this.exec.subproc.child.stderr.pipe.slice()));
    }
    this.exec.subproc.buffered_closed.close(this, .{ .stderr = &this.exec.subproc.child.stderr });
    this.exec.subproc.child.closeIO(.stderr);
}

const std = @import("std");

const bun = @import("bun");
const assert = bun.assert;
const jsc = bun.jsc;
const which = bun.which;

const shell = bun.shell;
const ExitCode = bun.shell.ExitCode;
const Yield = bun.shell.Yield;
const ast = bun.shell.AST;
const Subprocess = bun.shell.subproc.ShellSubprocess;

const Interpreter = bun.shell.Interpreter;
const Assigns = bun.shell.Interpreter.Assigns;
const Async = bun.shell.Interpreter.Async;
const Binary = bun.shell.Interpreter.Binary;
const Builtin = bun.shell.Interpreter.Builtin;
const Expansion = bun.shell.Interpreter.Expansion;
const IO = bun.shell.Interpreter.IO;
const If = bun.shell.Interpreter.If;
const Pipeline = bun.shell.Interpreter.Pipeline;
const ShellExecEnv = Interpreter.ShellExecEnv;
const State = bun.shell.Interpreter.State;
const Stmt = bun.shell.Interpreter.Stmt;

const Arena = bun.shell.interpret.Arena;
const CowFd = bun.shell.interpret.CowFd;
const ShellSyscall = bun.shell.interpret.ShellSyscall;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const log = bun.shell.interpret.log;
const stderr_no = bun.shell.interpret.stderr_no;
const stdin_no = bun.shell.interpret.stdin_no;
const stdout_no = bun.shell.interpret.stdout_no;
