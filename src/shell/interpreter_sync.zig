const bun = @import("root").bun;
const std = @import("std");
const builtin = @import("builtin");
const Arena = std.heap.ArenaAllocator;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const JSPromise = bun.JSC.JSPromise;
const JSGlobalObject = bun.JSC.JSGlobalObject;
const Which = @import("../which.zig");
const Braces = @import("./braces.zig");
const Syscall = @import("../sys.zig");
const Glob = @import("../glob.zig");
const ResolvePath = @import("../resolver/resolve_path.zig");
const DirIterator = @import("../bun.js/node/dir_iterator.zig");
const CodepointIterator = @import("../string_immutable.zig").PackedCodepointIterator;
const isAllAscii = @import("../string_immutable.zig").isAllASCII;
const TaggedPointerUnion = @import("../tagged_pointer.zig").TaggedPointerUnion;

const AST = bun.shell.AST;
const closefd = bun.shell.closefd;
const Subprocess = bun.shell.Subprocess;
const ShellError = bun.shell.ShellError;
const Pipe = bun.shell.Pipe;
const CmdEnvIter = bun.shell.CmdEnvIter;

const GlobWalker = Glob.GlobWalker_(null, true);

const isValidVarName = bun.shell.isValidVarName;

const log = bun.Output.scoped(.SHELL, false);

// FIXME avoid std.os if possible
// FIXME error when command not found needs to be handled gracefully
pub const InterpreterSync = struct {
    pub const ast = AST;
    arena: *bun.ArenaAllocator,
    allocator: Allocator,
    globalThis: *JSC.JSGlobalObject,
    jsobjs: []JSValue,

    /// Shell env for expansion by the shell
    shell_env: std.StringArrayHashMap([:0]const u8),
    /// Local environment variables to be given to a subprocess
    cmd_local_env: std.StringArrayHashMap([:0]const u8),
    /// Exported environment variables available to all subprocesses. This excludes system ones,
    /// just contains ones set by this shell script.
    export_env: std.StringArrayHashMap([:0]const u8),

    /// The current working directory of the shell
    __prevcwd_pathbuf: ?*[bun.MAX_PATH_BYTES]u8 = null,
    prev_cwd: [:0]const u8,
    __cwd_pathbuf: *[bun.MAX_PATH_BYTES]u8,
    cwd: [:0]const u8,
    // FIXME TODO deinit
    cwd_fd: bun.FileDescriptor,

    /// There are three types of contexts that anvironment variables can be in:
    /// - cmd local (only available to a single subprocess)
    /// - shell (only available to shell for expansion)
    /// - exported (available to subprocesses and shell)
    const AssignCtx = enum {
        cmd,
        shell,
        exported,
    };

    const IO = struct {
        stdin: Kind = .std,
        stdout: Kind = .std,
        stderr: Kind = .std,

        const Kind = union(enum) {
            /// Use stdin/stdout/stderr of this process
            std,
            fd: bun.FileDescriptor,
            /// NOTE This is only valid to give to a Cmd.subproc, not a builtin
            pipe,
            ignore,

            fn close(this: Kind) void {
                switch (this) {
                    .fd => {
                        closefd(this.fd);
                    },
                    else => {},
                }
            }

            fn to_subproc_stdio(this: Kind) Subprocess.Stdio {
                return switch (this) {
                    .std => .inherit,
                    .fd => |val| .{ .fd = val },
                    .pipe => .{ .pipe = null },
                    .ignore => .ignore,
                };
            }
        };

        fn to_subproc_stdio(this: IO, stdio: *[3]Subprocess.Stdio) void {
            stdio[bun.STDIN_FD] = this.stdin.to_subproc_stdio();
            stdio[bun.STDOUT_FD] = this.stdout.to_subproc_stdio();
            stdio[bun.STDERR_FD] = this.stderr.to_subproc_stdio();
        }
    };

    const Cmd = union(Kind) {
        subproc: *Subprocess,
        builtin: Builtin,

        const Kind = enum {
            subproc,
            builtin,
        };

        pub fn kill(this: *Cmd, sig: u8) !void {
            switch (this.*) {
                .subproc => {
                    this.subproc.unref(true);
                    switch (this.subproc.tryKill(@intCast(9))) {
                        .err => |err| {
                            _ = err;
                            @panic("HANDLE THIS ERRROR");
                        },
                        else => {},
                    }
                },
                .builtin => {
                    // This means process has already exited, so we don't need to close the fds
                    if (this.builtin.exit_code == null) {
                        return;
                    }
                    this.builtin.closeio(sig);
                },
            }
        }

        pub fn deinit(this: *Cmd, comptime deactivate_poll_ref: bool) void {
            switch (this.*) {
                .subproc => this.subproc.unref(deactivate_poll_ref),
                .builtin => {
                    if (!this.builtin.fds_closed) {
                        this.builtin.closeio(126);
                    }
                },
            }
        }

        pub fn expectStdoutSlice(this: *Cmd) []const u8 {
            return switch (this.*) {
                .subproc => this.subproc.stdout.toSlice() orelse @panic("Expected slice"),
                .builtin => this.builtin.stdout.buf.items[0..this.builtin.stdout.buf.items.len],
            };
        }

        pub fn waitSubproc(subprocess: *Subprocess, jsc_vm: *JSC.VirtualMachine) !bool {
            log("Done waiting {any}", .{subprocess.hasExited()});

            // this seems hacky and bad
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

            subprocess.wait(true);
            return (subprocess.exit_code orelse 1) == 0;
        }
    };

    const Builtin = struct {
        kind: Builtin.Kind,
        stdin: BuiltinIO,
        stdout: BuiltinIO,
        stderr: BuiltinIO,
        args: std.ArrayList(?[*:0]const u8),
        exit_code: ?u8 = null,
        fds_closed: bool = false,

        /// in the case of array buffer we simply need to write to the pointer
        /// in the case of blob, we write to the file descriptor
        const BuiltinIO = union(enum) {
            fd: bun.FileDescriptor,
            buf: std.ArrayListUnmanaged(u8),
            arraybuf: ArrayBuf,
            blob: JSC,
            ignore,

            const ArrayBuf = struct {
                buf: JSC.ArrayBuffer.Strong,
                i: u32 = 0,
            };

            pub fn close(this: *BuiltinIO) void {
                switch (this.*) {
                    .fd => {
                        closefd(this.fd);
                    },
                    .buf => {
                        // try this.buf.deinit(allocator);
                    },
                    else => {},
                }
            }
        };

        const Kind = enum {
            @"export",
            cd,
            echo,
            pwd,
            which,
            rm,

            pub fn usageString(this: Kind) []const u8 {
                return switch (this) {
                    .@"export" => "",
                    .cd => "",
                    .echo => "",
                    .pwd => "",
                    .which => "",
                    .rm => "usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file",
                };
            }

            pub fn asString(this: Kind) []const u8 {
                return switch (this) {
                    .@"export" => "export",
                    .cd => "cd",
                    .echo => "echo",
                    .pwd => "pwd",
                    .which => "which",
                    .rm => "rm",
                };
            }

            pub fn fromStr(str: []const u8) ?Builtin.Kind {
                const tyinfo = @typeInfo(Builtin.Kind);
                inline for (tyinfo.Enum.fields) |field| {
                    if (bun.strings.eqlComptime(str, field.name)) {
                        return comptime std.meta.stringToEnum(Builtin.Kind, field.name).?;
                    }
                }
                return null;
            }
        };

        pub fn closeio(this: *Builtin, exit_code: u8) void {
            this.fds_closed = true;
            this.stdin.close();
            this.stdout.close();
            this.stderr.close();
            this.exit_code = exit_code;
        }

        pub fn argsSlice(this: *Builtin) []const [*:0]const u8 {
            const args_raw = this.args.items[1..];
            const args_len = std.mem.indexOfScalar(?[*:0]const u8, args_raw, null) orelse @panic("bad");
            if (args_len == 0)
                return &[_][*:0]const u8{};

            const args_ptr = args_raw.ptr;
            return @as([*][*:0]const u8, @ptrCast(args_ptr))[0..args_len];
        }

        pub fn write_err(
            this: *Builtin,
            io: *BuiltinIO,
            comptime kind: Builtin.Kind,
            comptime fmt: []const u8,
            args: anytype,
        ) !void {
            const kind_str = comptime kind.asString();
            const new_fmt = comptime kind_str ++ ": " ++ fmt;
            return try this.write_fmt(io, new_fmt, args);
        }

        pub fn write_fmt(
            this: *Builtin,
            io: *BuiltinIO,
            comptime fmt: []const u8,
            args: anytype,
        ) !void {
            switch (io.*) {
                .fd => |fd| {
                    var stack_alloc = std.heap.stackFallback(256, this.args.allocator);
                    const len = std.fmt.count(fmt, args);
                    const buf = try stack_alloc.get().alloc(u8, len);
                    _ = try std.fmt.bufPrint(buf, fmt, args);
                    _ = try std.os.write(fd, buf);
                },
                .buf => {
                    const len = std.fmt.count(fmt, args);
                    try io.buf.ensureUnusedCapacity(this.args.allocator, len);
                    _ = try std.fmt.bufPrint(io.buf.items[io.buf.items.len..], fmt, args);
                    io.buf.items.len +|= @truncate(len);
                },
                .arraybuf => {
                    if (io.arraybuf.i >= io.arraybuf.buf.array_buffer.byte_len) {
                        return;
                    }
                    const len = std.fmt.count(fmt, args);
                    const slice = io.arraybuf.buf.slice()[io.arraybuf.i..@min(io.arraybuf.i + len, io.arraybuf.buf.array_buffer.byte_len)];
                    _ = std.fmt.bufPrint(slice, fmt, args) catch |err| {
                        if (err == std.fmt.BufPrintError.NoSpaceLeft) {
                            io.arraybuf.i = io.arraybuf.buf.array_buffer.byte_len;
                            return;
                        }
                        return err;
                    };
                    io.arraybuf.i +|= @truncate(len);
                },
                .blob => @panic("FIXME TODO"),
                .ignore => {},
            }
        }

        pub fn write(this: *Builtin, io: *BuiltinIO, buf: []const u8) !void {
            switch (io.*) {
                .fd => |fd| {
                    log("{s} write to fd {d}\n", .{ this.kind.asString(), fd });
                    _ = try std.os.write(fd, buf);
                },
                .buf => {
                    log("{s} write to buf {d}\n", .{ this.kind.asString(), buf.len });
                    try io.buf.appendSlice(this.args.allocator, buf);
                },
                .arraybuf => {
                    if (io.arraybuf.i >= io.arraybuf.buf.array_buffer.byte_len) {
                        return;
                    }
                    const len = buf.len;
                    const write_len = if (io.arraybuf.i + len > io.arraybuf.buf.array_buffer.byte_len)
                        io.arraybuf.buf.array_buffer.byte_len - io.arraybuf.i
                    else
                        len;

                    const slice = io.arraybuf.buf.slice()[io.arraybuf.i .. io.arraybuf.i + write_len];
                    @memcpy(slice, buf[0..write_len]);
                    io.arraybuf.i +|= @truncate(write_len);
                    log("{s} write to arraybuf {d}\n", .{ this.kind.asString(), write_len });
                },
                .blob => @panic("FIXME TODO"),
                .ignore => {},
            }
        }
    };

    pub fn new(arena: *bun.ArenaAllocator, globalThis: *JSC.JSGlobalObject, jsobjs: []JSValue) !InterpreterSync {
        const allocator = arena.allocator();
        const export_env = brk: {
            var export_env = std.StringArrayHashMap([:0]const u8).init(allocator);
            var iter = globalThis.bunVM().bundler.env.map.iter();
            while (iter.next()) |entry| {
                const dupedz = try allocator.dupeZ(u8, entry.value_ptr.value);
                try export_env.put(entry.key_ptr.*, dupedz);
            }
            break :brk export_env;
        };

        var pathbuf = try allocator.alloc(u8, bun.MAX_PATH_BYTES);

        const cwd = switch (Syscall.getcwd(@as(*[1024]u8, @ptrCast(pathbuf.ptr)))) {
            .result => |cwd| cwd.ptr[0..cwd.len :0],
            .err => |err| {
                const errJs = err.toJSC(globalThis);
                globalThis.throwValue(errJs);
                return ShellError.Init;
            },
        };
        const cwd_fd = switch (Syscall.open(cwd, std.os.O.DIRECTORY | std.os.O.RDONLY, 0)) {
            .result => |fd| fd,
            .err => |err| {
                const errJs = err.toJSC(globalThis);
                globalThis.throwValue(errJs);
                return ShellError.Init;
            },
        };

        const interpreter: InterpreterSync = .{
            .arena = arena,
            .allocator = allocator,
            .shell_env = std.StringArrayHashMap([:0]const u8).init(allocator),
            .cmd_local_env = std.StringArrayHashMap([:0]const u8).init(allocator),
            .export_env = export_env,
            .globalThis = globalThis,
            .jsobjs = jsobjs,
            .__cwd_pathbuf = @ptrCast(pathbuf.ptr),
            .cwd = pathbuf[0..cwd.len :0],
            .prev_cwd = pathbuf[0..cwd.len :0],
            .cwd_fd = cwd_fd,
        };

        return interpreter;
    }

    pub fn interpret(self: *InterpreterSync, script: ast.Script) anyerror!void {
        var stdio = InterpreterSync.default_io();
        for (script.stmts) |*stmt| {
            for (stmt.exprs) |*expr| {
                _ = try self.interpret_expr(expr, &stdio);
            }
        }
    }

    fn default_io() IO {
        return .{};
    }

    fn interpret_expr(
        self: *InterpreterSync,
        expr: *const ast.Expr,
        io: *IO,
    ) anyerror!bool {
        switch (expr.*) {
            .assign => |assigns| {
                for (assigns) |*assign| {
                    try self.interpret_assign(assign, .shell);
                }
                return true;
            },
            .cond => |cond| return try self.interpret_cond(&cond.left, &cond.right, cond.op, io),
            .pipeline => |pipeline| return try self.interpret_pipeline(pipeline, io),
            .cmd => |cmd| return try self.interpret_cmd(cmd, io),
        }
    }

    fn interpret_assign(self: *InterpreterSync, assign: *const ast.Assign, assign_ctx: AssignCtx) anyerror!void {
        const brace_expansion = assign.value.has_brace_expansion();
        const value = brk: {
            const value = try self.eval_atom(&assign.value);
            if (brace_expansion) {
                // For some reason bash only sets the last value
                break :brk value.many.items[value.many.items.len - 1];
            }
            break :brk value.one;
        };
        switch (assign_ctx) {
            .cmd => try self.cmd_local_env.put(assign.label, value),
            .shell => try self.shell_env.put(assign.label, value),
            .exported => try self.export_env.put(assign.label, value),
        }
    }

    fn interpret_cond(self: *InterpreterSync, left: *const ast.Expr, right: *const ast.Expr, op: ast.Conditional.Op, io: *IO) anyerror!bool {
        const success = try self.interpret_expr(left, io);
        switch (op) {
            .And => {
                if (!success) return false;
                return try self.interpret_expr(right, io);
            },
            .Or => {
                return try self.interpret_expr(right, io);
            },
        }
    }

    fn interpret_pipeline(self: *InterpreterSync, pipeline: *const ast.Pipeline, io: *IO) anyerror!bool {
        const cmd_count = brk: {
            var count: usize = 0;
            for (pipeline.items) |*item| {
                switch (@as(ast.CmdOrAssigns.Tag, item.*)) {
                    .cmd => count += 1,
                    else => {},
                }
            }
            break :brk count;
        };

        switch (cmd_count) {
            0 => return true,
            1 => {
                for (pipeline.items) |*item| {
                    switch (@as(ast.CmdOrAssigns.Tag, item.*)) {
                        .cmd => return try self.interpret_cmd(&item.cmd, io),
                        else => {},
                    }
                }
                return true;
            },
            else => {},
        }

        var cmd_procs_set_amount: usize = 0;
        var cmd_procs = try self.allocator.alloc(Cmd, cmd_count);
        errdefer {
            for (0..cmd_procs_set_amount) |i| {
                cmd_procs[i].deinit(false);
            }
        }

        const pipe_count: usize = cmd_count - 1;
        var pipes_set_amount: usize = 0;
        var pipes = try self.allocator.alloc(Pipe, pipe_count);
        errdefer {
            for (0..pipes_set_amount) |i| {
                const pipe = pipes[i];
                closefd(pipe[0]);
                closefd(pipe[1]);
            }
        }
        for (0..pipe_count) |i| {
            pipes[i] = try std.os.pipe();
            pipes_set_amount += 1;
        }

        {
            var i: usize = 0;
            for (pipeline.items) |*cmd_or_assign| {
                const cmd: *const ast.Cmd = switch (cmd_or_assign.*) {
                    .assigns => continue,
                    .cmd => |*cmd| cmd,
                };

                // [a,b] [c,d]
                // cmd1 | cmd2 | cmd3
                // cmd1 -> cmd2 -> cmd3
                // cmd1 -> cmd2 -> cmd3 -> cmd4
                var file_to_write_to = InterpreterSync.pipeline_file_to_write(
                    pipes,
                    i,
                    cmd_count,
                    io,
                );
                var file_to_read_from = InterpreterSync.pipeline_file_to_read(pipes, i, io);

                var kind: ?Cmd.Kind = null;
                defer {
                    // if its a subproc it needs to close fds immediately
                    if (kind == null or kind == .subproc) {
                        file_to_read_from.close();
                        file_to_write_to.close();
                    }
                }

                var cmd_io = IO{
                    .stdin = file_to_read_from,
                    .stdout = file_to_write_to,
                    .stderr = io.stderr,
                };
                log("Spawn: proc_idx={d} stdin={any} stdout={any} stderr={any}\n", .{ i, file_to_read_from, file_to_write_to, io.stderr });

                const cmd_proc = try self.init_cmd(cmd, &cmd_io, false);
                kind = @as(Cmd.Kind, cmd_proc);

                cmd_procs[i] = cmd_proc;
                i += 1;
                cmd_procs_set_amount += 1;
            }
        }

        const jsc_vm = self.globalThis.bunVM();

        var fail_idx: ?u32 = null;
        for (cmd_procs, 0..) |*subcmd, i| {
            log("Wait {d}", .{i});

            if (!(try self.wait(jsc_vm, subcmd))) {
                fail_idx = @intCast(i);
                break;
            }
            subcmd.deinit(true);
        }

        if (fail_idx) |idx| {
            for (cmd_procs[idx..]) |*proc| {
                try proc.kill(9);
            }
            return false;
        }
        return true;
    }

    // cmd1 -> cmd2 -> cmd3
    fn pipeline_file_to_write(pipes: []Pipe, proc_idx: usize, cmd_count: usize, io: *IO) IO.Kind {
        // Last command in the pipeline should write to stdout
        if (proc_idx == cmd_count - 1) return io.stdout;
        return .{ .fd = pipes[proc_idx][1] };
    }

    fn pipeline_file_to_read(pipes: []Pipe, proc_idx: usize, io: *IO) IO.Kind {
        // Last command in the pipeline should write to stdin
        if (proc_idx == 0) return io.stdin;
        return .{ .fd = pipes[proc_idx - 1][0] };
    }

    pub fn wait(this: *InterpreterSync, jsc_vm: *JSC.VirtualMachine, cmd: *Cmd) !bool {
        return switch (cmd.*) {
            .subproc => {
                return try Cmd.waitSubproc(cmd.subproc, jsc_vm);
            },
            .builtin => {
                if (cmd.builtin.exit_code) |code| return code == 0;
                return try this.interpret_builtin(&cmd.builtin);
            },
        };
    }

    fn init_cmd(self: *InterpreterSync, cmd: *const ast.Cmd, io: *IO, comptime in_cmd_subst: bool) !Cmd {
        self.cmd_local_env.clearRetainingCapacity();
        for (cmd.assigns) |*assign| {
            try self.interpret_assign(assign, .cmd);
        }

        var spawn_args = Subprocess.SpawnArgs.default(self.arena, self.globalThis.bunVM(), false);
        // Fill the env from the export end and cmd local env
        {
            var env_iter = CmdEnvIter.fromEnv(&self.export_env);
            if (!spawn_args.fillEnv(self.globalThis, &env_iter, false)) {
                return ShellError.GlobalThisThrown;
            }
            env_iter = CmdEnvIter.fromEnv(&self.cmd_local_env);
            if (!spawn_args.fillEnv(self.globalThis, &env_iter, false)) {
                return ShellError.GlobalThisThrown;
            }
        }
        spawn_args.cwd = self.cwd[0..self.cwd.len];

        const args = args: {
            // TODO optimization: allocate into one buffer of chars and create argv from slicing into that
            // TODO optimization: have args list on the stack and fallback to array
            var args = try std.ArrayList(?[*:0]const u8).initCapacity(self.allocator, cmd.name_and_args.len);
            for (cmd.name_and_args, 0..) |*arg_atom, i| {
                _ = i;
                try self.eval_atom_with_out(true, arg_atom, &args);
            }
            try args.append(null);

            for (args.items) |maybe_arg| {
                if (maybe_arg) |arg| {
                    log("ARG: {s}\n", .{arg});
                }
            }

            const first_arg = args.items[0] orelse {
                self.globalThis.throwInvalidArguments("No command specified", .{});
                return ShellError.Process;
            };
            const first_arg_len = std.mem.len(first_arg);
            if (Builtin.Kind.fromStr(first_arg[0..first_arg_len])) |b| {
                return .{ .builtin = self.init_builtin(b, args, io, cmd, in_cmd_subst) };
            }

            var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const resolved = Which.which(&path_buf, spawn_args.PATH, spawn_args.cwd, first_arg[0..first_arg_len]) orelse {
                self.globalThis.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{first_arg});
                return ShellError.Process;
            };
            const duped = self.allocator.dupeZ(u8, bun.span(resolved)) catch {
                self.globalThis.throw("out of memory", .{});
                return ShellError.Process;
            };
            args.items[0] = duped;

            break :args args;
        };
        spawn_args.argv = std.ArrayListUnmanaged(?[*:0]const u8){ .items = args.items, .capacity = args.capacity };
        io.to_subproc_stdio(&spawn_args.stdio);

        if (cmd.redirect_file) |redirect| {
            if (comptime in_cmd_subst) {
                if (cmd.redirect.stdin) {
                    spawn_args.stdio[bun.STDIN_FD] = .ignore;
                }

                if (cmd.redirect.stdout) {
                    spawn_args.stdio[bun.STDOUT_FD] = .ignore;
                }

                if (cmd.redirect.stderr) {
                    spawn_args.stdio[bun.STDERR_FD] = .ignore;
                }
            } else switch (redirect) {
                .jsbuf => |val| {
                    if (self.jsobjs[val.idx].asArrayBuffer(self.globalThis)) |buf| {
                        const stdio: Subprocess.Stdio = .{ .array_buffer = .{ .buf = JSC.ArrayBuffer.Strong{
                            .array_buffer = buf,
                            .held = JSC.Strong.create(buf.value, self.globalThis),
                        }, .from_jsc = true } };

                        if (cmd.redirect.stdin) {
                            spawn_args.stdio[bun.STDIN_FD] = stdio;
                        }

                        if (cmd.redirect.stdout) {
                            spawn_args.stdio[bun.STDOUT_FD] = stdio;
                        }

                        if (cmd.redirect.stderr) {
                            spawn_args.stdio[bun.STDERR_FD] = stdio;
                        }
                    } else if (self.jsobjs[val.idx].as(JSC.WebCore.Blob)) |blob| {
                        if (cmd.redirect.stdout) {
                            if (!Subprocess.extractStdioBlob(self.globalThis, .{ .Blob = blob.dupe() }, bun.STDOUT_FD, &spawn_args.stdio)) {
                                @panic("FIXME OOPS");
                            }
                        }

                        if (cmd.redirect.stdin) {
                            if (!Subprocess.extractStdioBlob(self.globalThis, .{ .Blob = blob.dupe() }, bun.STDIN_FD, &spawn_args.stdio)) {
                                @panic("FIXME OOPS");
                            }
                        }

                        if (cmd.redirect.stderr) {
                            if (!Subprocess.extractStdioBlob(self.globalThis, .{ .Blob = blob.dupe() }, bun.STDERR_FD, &spawn_args.stdio)) {
                                @panic("FIXME OOPS");
                            }
                        }
                    } else {
                        @panic("FIXME Unhandled");
                    }
                },
                else => @panic("FIXME TODO"),
            }
        }

        var subprocess = try Subprocess.spawnAsync(self.globalThis, spawn_args) orelse {
            return ShellError.Spawn;
        };
        subprocess.ref();

        return .{ .subproc = subprocess };
    }

    fn init_builtin(
        self: *InterpreterSync,
        kind: Builtin.Kind,
        args: std.ArrayList(?[*:0]const u8),
        io_: *IO,
        cmd: *const AST.Cmd,
        comptime in_cmd_subst: bool,
    ) Builtin {
        var io = io_.*;

        var stdin: Builtin.BuiltinIO = switch (io.stdin) {
            .std => .{ .fd = bun.STDIN_FD },
            .fd => |fd| .{ .fd = fd },
            .pipe => .{ .buf = std.ArrayListUnmanaged(u8){} },
            .ignore => .ignore,
        };
        var stdout: Builtin.BuiltinIO = switch (io.stdout) {
            .std => .{ .fd = bun.STDOUT_FD },
            .fd => |fd| .{ .fd = fd },
            .pipe => .{ .buf = std.ArrayListUnmanaged(u8){} },
            .ignore => .ignore,
        };
        var stderr: Builtin.BuiltinIO = switch (io.stderr) {
            .std => .{ .fd = bun.STDERR_FD },
            .fd => |fd| .{ .fd = fd },
            .pipe => .{ .buf = std.ArrayListUnmanaged(u8){} },
            .ignore => .ignore,
        };

        if (cmd.redirect_file) |file| brk: {
            if (comptime in_cmd_subst) {
                if (cmd.redirect.stdin) {
                    io.stdin = .ignore;
                }

                if (cmd.redirect.stdout) {
                    io.stdout = .ignore;
                }

                if (cmd.redirect.stderr) {
                    io.stdout = .ignore;
                }

                break :brk;
            }

            switch (file) {
                .atom => {
                    // FIXME TODO expand atom
                    // if expands to multiple atoms, throw "ambiguous redirect" error
                    @panic("FIXME TODO redirect builtin");
                },
                .jsbuf => {
                    if (self.jsobjs[file.jsbuf.idx].asArrayBuffer(self.globalThis)) |buf| {
                        const builtinio: Builtin.BuiltinIO = .{ .arraybuf = .{ .buf = JSC.ArrayBuffer.Strong{
                            .array_buffer = buf,
                            .held = JSC.Strong.create(buf.value, self.globalThis),
                        }, .i = 0 } };

                        if (cmd.redirect.stdin) {
                            stdin = builtinio;
                        }

                        if (cmd.redirect.stdout) {
                            stdout = builtinio;
                        }

                        if (cmd.redirect.stderr) {
                            stderr = builtinio;
                        }
                    } else if (self.jsobjs[file.jsbuf.idx].as(JSC.WebCore.Blob)) |blob| {
                        _ = blob;
                        @panic("FIXME TODO HANDLE BLOB");
                    } else {
                        @panic("FIXME TODO Unhandled");
                    }
                },
            }
        }

        return .{
            .kind = kind,
            .args = args,
            .stdin = stdin,
            .stdout = stdout,
            .stderr = stderr,
        };
    }

    fn interpret_cmd(self: *InterpreterSync, cmd: *const ast.Cmd, io: *IO) !bool {
        var subcmd = try self.init_cmd(cmd, io, false);
        defer subcmd.deinit(false);
        return try self.interpret_cmd_impl(&subcmd);
    }

    fn interpret_cmd_impl(self: *InterpreterSync, cmd: *Cmd) !bool {
        return switch (cmd.*) {
            .subproc => try self.interpret_subproc(cmd.subproc),
            .builtin => try self.interpret_builtin(&cmd.builtin),
        };
    }

    fn interpret_subproc(self: *InterpreterSync, subprocess: *Subprocess) !bool {
        log("Interpret cmd", .{});
        const jsc_vm = self.globalThis.bunVM();
        return Cmd.waitSubproc(subprocess, jsc_vm);
    }

    fn interpret_builtin(
        self: *InterpreterSync,
        bltn: *Builtin,
    ) !bool {

        // FIXME TODO handle error
        const exit_code = self.interpret_builtin_impl(bltn) catch 1;

        bltn.exit_code = exit_code;
        return exit_code == 0;
    }

    fn interpret_builtin_impl(self: *InterpreterSync, bltn: *Builtin) !u8 {
        return switch (bltn.kind) {
            .@"export" => try self.interpret_builtin_export(bltn),
            .echo => try self.interpret_builtin_echo(bltn),
            .cd => try self.interpret_builtin_cd(bltn),
            .pwd => try self.interpret_builtin_pwd(bltn),
            .which => try self.interpret_builtin_which(bltn),
            .rm => try self.interpret_builtin_rm(bltn),
        };
    }

    fn interpret_builtin_rm(self: *InterpreterSync, bltn: *Builtin) !u8 {
        const args = bltn.argsSlice();
        if (args.len == 0) {
            try bltn.write_err(&bltn.stderr, .rm, "missing operand", .{});
            return 1;
        }

        var opts: Rm.Opts = .{};
        const filepaths_start = (try opts.parse(bltn, args)) orelse args.len;
        if (filepaths_start >= args.len) {
            try bltn.write_fmt(&bltn.stderr, "{s}\n", .{Builtin.Kind.rm.usageString()});
            return 64;
        }

        const filepath_args = args[filepaths_start..];
        const paths = brk: {
            var paths = try std.ArrayList(Rm.Item).initCapacity(self.allocator, filepath_args.len);
            for (filepath_args) |arg| {
                try paths.append(.{
                    .path = arg[0..std.mem.len(arg)],
                    .should_dealloc = false,
                });
            }
            break :brk paths;
        };

        var rm = Rm{
            .allocator = self.allocator,
            .stack = paths,
            .opts = opts,
            .bltn = bltn,
            .cwd = self.cwd,
            .cwd_fd = self.cwd_fd,
        };

        return rm.exec();
    }

    fn interpret_builtin_which(self: *InterpreterSync, bltn: *Builtin) !u8 {
        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const args = bltn.argsSlice();
        if (args.len == 0) {
            try bltn.write(&bltn.stdout, "\n");
            return 0;
        }

        for (args) |arg_raw| {
            const arg = arg_raw[0..std.mem.len(arg_raw)];
            const PATH = self.globalThis.bunVM().bundler.env.get("PATH") orelse "";
            const resolved = Which.which(&path_buf, PATH, self.cwd, arg) orelse {
                try bltn.write_fmt(&bltn.stdout, "{s} not found\n", .{arg});
                continue;
            };
            try bltn.write_fmt(&bltn.stdout, "{s}\n", .{resolved});
        }
        return 0;
    }

    fn interpret_builtin_pwd(self: *InterpreterSync, bltn: *Builtin) !u8 {
        const args = bltn.argsSlice();
        if (args.len > 0) {
            try bltn.write_err(&bltn.stderr, .pwd, "too many arguments", .{});
            return 1;
        }

        try bltn.write_fmt(&bltn.stdout, "{s}\n", .{self.cwd[0..self.cwd.len]});
        return 0;
    }

    /// Some additional behaviour beyond basic `cd <dir>`:
    /// - `cd` by itself or `cd ~` will always put the user in their home directory.
    /// - `cd ~username` will put the user in the home directory of the specified user
    /// - `cd -` will put the user in the previous directory
    fn interpret_builtin_cd(self: *InterpreterSync, bltn: *Builtin) !u8 {
        const args = bltn.argsSlice();
        if (args.len > 1) {
            try bltn.write_err(&bltn.stderr, .cd, "too many arguments", .{});
            return 1;
        }

        const first_arg = args[0][0..std.mem.len(args[0]) :0];
        switch (first_arg[0]) {
            '-' => {
                return self.change_cwd(self.prev_cwd, bltn, .cd);
            },
            '~' => {
                const homedir = self.get_homedir();
                return self.change_cwd(homedir, bltn, .cd);
            },
            else => {
                return self.change_cwd(first_arg, bltn, .cd);
            },
        }
    }

    fn interpret_builtin_echo(self: *InterpreterSync, bltn: *Builtin) !u8 {
        const args = bltn.argsSlice();
        var output = std.ArrayList(u8).init(self.allocator);
        const args_len = args.len;
        for (args, 0..) |arg, i| {
            const len = std.mem.len(arg);
            try output.appendSlice(arg[0..len]);
            if (i < args_len - 1) {
                try output.append(' ');
            }
        }
        try output.append('\n');
        try bltn.write(&bltn.stdout, output.items[0..]);
        return 0;
    }

    fn interpret_builtin_export(
        self: *InterpreterSync,
        bltn: *Builtin,
    ) !u8 {
        const args = bltn.argsSlice();
        // Calling `export` with no arguments prints all exported variables lexigraphically ordered
        if (args.len == 0) {
            const Entry = struct {
                key: []const u8,
                value: [:0]const u8,

                pub fn compare(context: void, this: @This(), other: @This()) bool {
                    return bun.strings.cmpStringsAsc(context, this.key, other.key);
                }
            };

            var keys = std.ArrayList(Entry).init(self.allocator);
            var iter = self.export_env.iterator();
            while (iter.next()) |entry| {
                try keys.append(.{
                    .key = entry.key_ptr.*,
                    .value = entry.value_ptr.*,
                });
            }

            std.mem.sort(Entry, keys.items[0..], {}, Entry.compare);

            const len = brk: {
                var len: usize = 0;
                for (keys.items) |entry| {
                    len += std.fmt.count("{s}={s}\n", .{ entry.key, entry.value });
                }
                break :brk len;
            };
            var buf = try self.allocator.alloc(u8, len);
            {
                var i: usize = 0;
                for (keys.items) |entry| {
                    i += (try std.fmt.bufPrint(buf[i..], "{s}={s}\n", .{ entry.key, entry.value })).len;
                }
            }

            bltn.write(&bltn.stdout, buf) catch |err| {
                log("export: {any}", .{err});
                return 1;
            };

            return 0;
        }

        for (args[0..]) |arg_cstr_| {
            var arg_cstr: [*:0]const u8 = arg_cstr_;
            const arg_len = std.mem.len(arg_cstr);
            // `export` allows arguments to be empty, which just skips it.
            // For example `export $FOO` will do nothing
            if (arg_len == 0) {
                continue;
            }
            const arg: [:0]const u8 = arg_cstr[0..arg_len :0];
            const idx = std.mem.indexOfScalar(u8, arg[0..arg.len], '=') orelse {
                if (!isValidVarName(arg)) {
                    try bltn.write_err(&bltn.stderr, .@"export", "`{s}`: not a valid identifier", .{arg});
                    self.globalThis.throwInvalidArguments("Invalid variable name: \"{s}\"", .{arg});
                    return 1;
                }
                try self.export_env.put(arg[0..arg.len], "");
                continue;
            };

            const label = arg[0..idx];
            if (!isValidVarName(label)) {
                try bltn.write_err(&bltn.stderr, .@"export", "`{s}`: not a valid identifier", .{arg});
                return 1;
            }

            const value = arg[idx + 1 ..];
            try self.export_env.put(label, value);
        }
        return 0;
    }

    fn get_homedir(self: *InterpreterSync) [:0]const u8 {
        if (comptime bun.Environment.isWindows) {
            if (self.export_env.get("USERPROFILE")) |env|
                return env;
        } else {
            if (self.export_env.get("HOME")) |env|
                return env;
        }
        return "unknown";
    }

    fn change_cwd(self: *InterpreterSync, new_cwd_: [:0]const u8, bltn: *Builtin, comptime kind: Builtin.Kind) !u8 {
        const new_cwd: [:0]const u8 = brk: {
            if (ResolvePath.Platform.auto.isAbsolute(new_cwd_)) break :brk new_cwd_;

            const existing_cwd = self.cwd;
            const cwd_str = ResolvePath.joinZ(&[_][]const u8{
                existing_cwd,
                new_cwd_,
            }, .auto);

            break :brk cwd_str;
        };

        const new_cwd_fd = switch (Syscall.openat(
            self.cwd_fd,
            new_cwd,
            std.os.O.DIRECTORY | std.os.O.RDONLY,
            0,
        )) {
            .result => |fd| fd,
            .err => |err| {
                const errno: usize = @intCast(err.errno);
                switch (errno) {
                    @as(usize, @intFromEnum(bun.C.E.NOTDIR)) => {
                        try bltn.write_err(&bltn.stderr, kind, "not a directory: {s}", .{new_cwd_});
                        return 1;
                    },
                    @as(usize, @intFromEnum(bun.C.E.NOENT)) => {
                        try bltn.write_err(&bltn.stderr, kind, "no such file or directory: {s}", .{new_cwd_});
                        return 1;
                    },
                    else => {},
                }
                // FIXME: probably need to throw this sys error on globalThis
                return @intCast(err.errno);
            },
        };
        _ = Syscall.close2(self.cwd_fd);

        var prev_cwd_buf = brk: {
            if (self.__prevcwd_pathbuf) |prev| break :brk prev;
            break :brk try self.allocator.alloc(u8, bun.MAX_PATH_BYTES);
        };

        std.mem.copyForwards(u8, prev_cwd_buf[0..self.cwd.len], self.cwd[0..self.cwd.len]);
        prev_cwd_buf[self.cwd.len] = 0;
        self.prev_cwd = prev_cwd_buf[0..self.cwd.len :0];

        std.mem.copyForwards(u8, self.__cwd_pathbuf[0..new_cwd.len], new_cwd[0..new_cwd.len]);
        self.__cwd_pathbuf[new_cwd.len] = 0;
        self.cwd = new_cwd;

        self.cwd_fd = new_cwd_fd;

        return 0;
    }

    /// The order of expansions:
    /// 1. Expand shell/environment variables (e.g. $FOO)
    /// 2. Expand braces (e.g. {a,b})
    /// 3. Expand globs (e.g. *)
    ///
    /// For example: `FOO="*" echo {$FOO,hi}`
    /// 1. echo {*,hi}
    /// 2. echo * hi
    /// 3. echo <expanded glob output> hi
    fn eval_atom(
        self: *InterpreterSync,
        atom: *const ast.Atom,
    ) !MaybeManyStrings {
        if (atom.has_brace_expansion()) {
            var out = std.ArrayList([:0]const u8).init(self.allocator);
            try self.eval_atom_with_brace_expansion(false, atom, &out);
            return .{ .many = out };
        }

        const brace_str = try self.eval_atom_no_brace_expansion(atom);
        return .{ .one = brace_str };
    }

    fn eval_atom_with_out(
        self: *InterpreterSync,
        comptime for_spawn: bool,
        atom: *const ast.Atom,
        out: if (!for_spawn) *std.ArrayList([:0]const u8) else *std.ArrayList(?[*:0]const u8),
    ) !void {
        if (atom.has_brace_expansion()) {
            try self.eval_atom_with_brace_expansion(for_spawn, atom, out);
            if (atom.has_glob_expansion()) {
                @panic("FIXME TODO handle glob expansion or throw error that it is not supported yet");
            }
            return;
        }

        // if (atom.has_glob_expansion()) {
        //     try self.eval_atom_with_glob_expansions(for_spawn, atom, out);
        //     return;
        // }

        const brace_str = try self.eval_atom_no_brace_expansion(atom);
        try out.append(brace_str);
    }

    fn eval_atom_with_glob_expansions(
        self: *InterpreterSync,
        comptime for_spawn: bool,
        atom: *const ast.Atom,
        out: if (!for_spawn) *std.ArrayList([:0]const u8) else *std.ArrayList(?[*:0]const u8),
    ) void {
        _ = out;
        _ = atom;
        _ = self;
    }

    fn expand_glob_pattern(
        self: *InterpreterSync,
        comptime for_spawn: bool,
        pattern: []const u8,
        out: if (!for_spawn) *std.ArrayList([:0]const u8) else *std.ArrayList(?[*:0]const u8),
    ) void {
        // FIXME TODO handle GLOBIGNORE env variable
        var glob_walker: Glob.BunGlobWalker = .{};
        var arena = std.heap.ArenaAllocator.init(self.allocator);

        const dot = false;
        const absolute = false;
        const follow_symlinks = false;
        const error_on_broken_symlinks = false;
        const only_files = false;

        switch (GlobWalker.initWithCwd(
            &glob_walker,
            &arena,
            pattern,
            self.cwd[0..self.cwd.len],
            dot,
            absolute,
            follow_symlinks,
            error_on_broken_symlinks,
            only_files,
        )) {
            .result => {},
            .err => {
                @panic("FIXME TODO handle error properly");
            },
        }
        defer glob_walker.deinit(true);

        var iter = GlobWalker.Iterator{ .walker = &glob_walker };
        defer iter.deinit();
        switch (try iter.init()) {
            .err => |err| return .{ .err = err },
            else => {},
        }

        while (switch (try iter.next()) {
            .err => |err| return .{ .err = err },
            .result => |matched_path| matched_path,
        }) |path| {
            if (comptime for_spawn) {
                try out.append(path.ptr);
            } else {
                try out.append(path);
            }
        }
    }

    fn eval_atom_with_brace_expansion(
        self: *InterpreterSync,
        comptime for_spawn: bool,
        atom: *const ast.Atom,
        out: if (!for_spawn) *std.ArrayList([:0]const u8) else *std.ArrayList(?[*:0]const u8),
    ) anyerror!void {
        if (bun.Environment.allow_assert) {
            std.debug.assert(atom.* == .compound and atom.compound.brace_expansion_hint);
        }
        const brace_str = try self.eval_atom_no_brace_expansion(atom);
        var lexer_output = try Braces.Lexer.tokenize(self.allocator, brace_str);
        const expansion_count = try Braces.calculateExpandedAmount(lexer_output.tokens.items[0..]);

        var expanded_strings = brk: {
            const stack_max = comptime 16;
            comptime {
                std.debug.assert(@sizeOf([]std.ArrayList(u8)) * stack_max <= 256);
            }
            var maybe_stack_alloc = std.heap.stackFallback(@sizeOf([]std.ArrayList(u8)) * stack_max, self.allocator);
            const expanded_strings = try maybe_stack_alloc.get().alloc(std.ArrayList(u8), expansion_count);
            break :brk expanded_strings;
        };

        for (0..expansion_count) |i| {
            expanded_strings[i] = std.ArrayList(u8).init(self.allocator);
        }

        try Braces.expand(
            self.allocator,
            lexer_output.tokens.items[0..],
            expanded_strings,
            lexer_output.contains_nested,
        );

        try out.ensureUnusedCapacity(expansion_count);
        // Add sentinel values
        for (0..expansion_count) |i| {
            try expanded_strings[i].append(0);
            if (comptime for_spawn) {
                out.appendAssumeCapacity(expanded_strings[i].items[0 .. expanded_strings[i].items.len - 1 :0].ptr);
            } else {
                out.appendAssumeCapacity(expanded_strings[i].items[0 .. expanded_strings[i].items.len - 1 :0]);
            }
        }
    }

    fn eval_atom_no_brace_expansion(self: *InterpreterSync, atom: *const ast.Atom) anyerror![:0]const u8 {
        var has_unknown = false;
        const string_size = self.eval_atom_size_hint(atom, &has_unknown);
        if (!has_unknown) {
            var str = try self.allocator.allocSentinel(u8, string_size, 0);
            str.len = 0;
            var str_list = std.ArrayList(u8){
                .items = str,
                .capacity = string_size,
                .allocator = self.allocator,
            };
            switch (atom.*) {
                .simple => |*simp| {
                    try self.eval_atom_simpl(simp, &str_list, true);
                },
                .compound => |*cmp| {
                    try self.eval_atom_compound_no_brace_expansion(cmp, &str_list, true);
                },
            }
            try str_list.append(0);
            return str_list.items[0 .. str_list.items.len - 1 :0];
        }

        // + 1 for sentinel
        var str_list = try std.ArrayList(u8).initCapacity(self.allocator, string_size + 1);
        switch (atom.*) {
            .simple => |*simp| {
                try self.eval_atom_simpl(simp, &str_list, false);
            },
            .compound => |cmp| {
                for (cmp.atoms) |*simple_atom| {
                    try self.eval_atom_simpl(simple_atom, &str_list, false);
                }
            },
        }
        try str_list.append(0);
        return str_list.items[0 .. str_list.items.len - 1 :0];
    }

    fn eval_atom_compound_no_brace_expansion(
        self: *InterpreterSync,
        atom: *const ast.CompoundAtom,
        str_list: *std.ArrayList(u8),
        comptime known_size: bool,
    ) !void {
        if (bun.Environment.allow_assert) {
            std.debug.assert(!atom.brace_expansion_hint);
        }
        for (atom.atoms) |*simple_atom| {
            try self.eval_atom_simpl(simple_atom, str_list, known_size);
        }
    }

    fn eval_atom_simpl(
        self: *InterpreterSync,
        atom: *const ast.SimpleAtom,
        str_list: *std.ArrayList(u8),
        comptime known_size: bool,
    ) !void {
        return switch (atom.*) {
            .Text => |txt| {
                if (comptime known_size) {
                    str_list.appendSliceAssumeCapacity(txt);
                } else {
                    try str_list.appendSlice(txt);
                }
            },
            .Var => |label| {
                if (comptime known_size) {
                    str_list.appendSliceAssumeCapacity(self.eval_var(label));
                } else {
                    try str_list.appendSlice(self.eval_var(label));
                }
            },
            .asterisk => {
                if (comptime known_size) {
                    str_list.appendAssumeCapacity('*');
                } else {
                    try str_list.append('*');
                }
            },
            .double_asterisk => {
                if (comptime known_size) {
                    str_list.appendSliceAssumeCapacity("**");
                } else {
                    try str_list.appendSlice("**");
                }
            },
            .brace_begin => {
                if (comptime known_size) {
                    str_list.appendAssumeCapacity('{');
                } else {
                    try str_list.append('{');
                }
            },
            .brace_end => {
                if (comptime known_size) {
                    str_list.appendAssumeCapacity('}');
                } else {
                    try str_list.append('}');
                }
            },
            .comma => {
                if (comptime known_size) {
                    str_list.appendAssumeCapacity(',');
                } else {
                    try str_list.append(',');
                }
            },
            .cmd_subst => |cmd| {
                switch (cmd.*) {
                    .assigns => {},
                    .cmd => |*the_cmd| {
                        if (comptime known_size) {
                            if (bun.Environment.allow_assert) {
                                @panic("Cmd substitution should not be present when `known_size` set to true");
                            }
                        }
                        try self.eval_atom_cmd_subst(the_cmd, str_list);
                    },
                }
            },
        };
    }

    fn eval_atom_cmd_subst(self: *InterpreterSync, cmd: *const ast.Cmd, array_list: *std.ArrayList(u8)) !void {
        var io = InterpreterSync.default_io();
        io.stdout = .pipe;
        var subcmd = try self.init_cmd(cmd, &io, true);
        defer subcmd.deinit(false);
        _ = try self.interpret_cmd_impl(&subcmd);

        // We set stdout to .pipe so it /should/ create a Pipe with buffered output
        const output = subcmd.expectStdoutSlice();
        if (output.len == 0) return;
        var trimmed = output;

        // Posix standard trims newlines from the end of the output of command substitution
        var i: usize = output.len - 1;
        while (i >= 0) : (i -= 1) {
            if (trimmed[i] == '\n') {
                trimmed = trimmed[0..i];
            } else break;
            if (i == 0) break;
        }

        try array_list.appendSlice(trimmed);
    }

    fn eval_var(self: *const InterpreterSync, label: []const u8) []const u8 {
        const value = self.shell_env.get(label) orelse brk: {
            break :brk self.globalThis.bunVM().bundler.env.map.get(label) orelse return "";
        };
        return value;
    }

    /// Returns the size of the atom when expanded.
    /// If the calculation cannot be computed trivially (cmd substitution, brace expansion), this value is not accurate and `has_unknown` is set to true
    fn eval_atom_size_hint(self: *const InterpreterSync, atom: *const ast.Atom, has_unknown: *bool) usize {
        return switch (@as(ast.Atom.Tag, atom.*)) {
            .simple => self.eval_atom_size_simple(&atom.simple, has_unknown),
            .compound => {
                if (atom.compound.brace_expansion_hint) {
                    has_unknown.* = true;
                }

                var out: usize = 0;
                for (atom.compound.atoms) |*simple| {
                    out += self.eval_atom_size_simple(simple, has_unknown);
                }
                return out;
            },
        };
    }

    fn eval_atom_size_simple(self: *const InterpreterSync, simple: *const ast.SimpleAtom, has_cmd_subst: *bool) usize {
        return switch (simple.*) {
            .Text => |txt| txt.len,
            .Var => |label| self.eval_var(label).len,
            .brace_begin, .brace_end, .comma, .asterisk => 1,
            .double_asterisk => 2,
            .cmd_subst => |subst| {
                if (@as(ast.CmdOrAssigns.Tag, subst.*) == .assigns) {
                    return 0;
                }
                has_cmd_subst.* = true;
                return 0;
            },
        };
    }

    // pub fn write_error_to_fd(self: *Interpreter, io: *IO, comptime fmt: []const u8, args: anytype) !void {
    //     var stack_alloc = std.heap.stackFallback(256, self.allocator);
    //     const len = std.fmt.count("bunsh: " ++ fmt, args);
    //     var buf = try stack_alloc.get().alloc(u8, len);
    //     try std.fmt.bufPrint(buf, "bunsh: " ++ fmt, args);
    // }
};

pub const Rm = struct {
    const Builtin = InterpreterSync.Builtin;
    const IO = Builtin.BuiltinIO;

    allocator: Allocator,
    stack: std.ArrayList(Item),
    opts: Opts,
    bltn: *Builtin,
    cwd: [:0]const u8,
    cwd_fd: bun.FileDescriptor,
    pathbuf: [bun.MAX_PATH_BYTES]u8 = [_]u8{0} ** bun.MAX_PATH_BYTES,

    const Item = struct {
        action: Action = .queue,
        path: []const u8,
        should_dealloc: bool,

        const Action = enum {
            queue,
            remove_dir,
        };
    };

    pub const Opts = struct {
        /// `--no-preserve-root` / `--preserve-root`
        ///
        /// If set to false, then allow the recursive removal of the root directory.
        /// Safety feature to prevent accidental deletion of the root directory.
        preserve_root: bool = true,

        /// `-f`, `--force`
        ///
        /// Ignore nonexistent files and arguments, never prompt.
        force: bool = false,

        /// Configures how the user should be prompted on removal of files.
        prompt_behaviour: PromptBehaviour = .never,

        /// `-r`, `-R`, `--recursive`
        ///
        /// Remove directories and their contents recursively.
        recursive: bool = false,

        /// `-v`, `--verbose`
        ///
        /// Explain what is being done (prints which files/dirs are being deleted).
        verbose: bool = false,

        /// `-d`, `--dir`
        ///
        /// Remove empty directories. This option permits you to remove a directory
        /// without specifying `-r`/`-R`/`--recursive`, provided that the directory is
        /// empty.
        remove_empty_dirs: bool = false,

        const PromptBehaviour = union(enum) {
            /// `--interactive=never`
            ///
            /// Default
            never,

            /// `-I`, `--interactive=once`
            ///
            /// Once before removing more than three files, or when removing recursively.
            once: struct {
                removed_count: u32 = 0,
            },

            /// `-i`, `--interactive=always`
            ///
            /// Prompt before every removal.
            always,
        };

        pub fn parse(opts: *Opts, bltn: *Builtin, args: []const [*:0]const u8) !?usize {
            for (args, 0..) |arg_raw, i| {
                const arg = arg_raw[0..std.mem.len(arg_raw)];

                const ret = try opts.parseFlag(bltn, arg);
                switch (ret) {
                    0 => {},
                    1 => {
                        return i;
                    },
                    else => return null,
                }
            }
            return null;
        }

        fn parseFlag(this: *Opts, bltn: *Builtin, flag: []const u8) !u8 {
            if (flag.len == 0) return 1;
            if (flag[0] != '-') return 1;
            if (flag.len > 2 and flag[1] == '-') {
                if (bun.strings.eqlComptime(flag, "--preserve-root")) {
                    this.preserve_root = true;
                    return 0;
                } else if (bun.strings.eqlComptime(flag, "--no-preserve-root")) {
                    this.preserve_root = false;
                    return 0;
                } else if (bun.strings.eqlComptime(flag, "--recursive")) {
                    this.recursive = true;
                    return 0;
                } else if (bun.strings.eqlComptime(flag, "--verbose")) {
                    this.verbose = true;
                    return 0;
                } else if (bun.strings.eqlComptime(flag, "--dir")) {
                    this.remove_empty_dirs = true;
                    return 0;
                } else if (bun.strings.eqlComptime(flag, "--interactive=never")) {
                    this.prompt_behaviour = .never;
                    return 0;
                } else if (bun.strings.eqlComptime(flag, "--interactive=once")) {
                    this.prompt_behaviour = .{ .once = .{} };
                    return 0;
                } else if (bun.strings.eqlComptime(flag, "--interactive=always")) {
                    this.prompt_behaviour = .always;
                    return 0;
                }

                try bltn.write_err(&bltn.stderr, .rm, "illegal option -- -\n", .{});
                return 1;
            }

            const small_flags = flag[1..];
            for (small_flags) |char| {
                switch (char) {
                    'f' => {
                        this.force = true;
                        this.prompt_behaviour = .never;
                    },
                    'r', 'R' => {
                        this.recursive = true;
                    },
                    'v' => {
                        this.verbose = true;
                    },
                    'd' => {
                        this.remove_empty_dirs = true;
                    },
                    'i' => {
                        this.prompt_behaviour = .{ .once = .{} };
                    },
                    'I' => {
                        this.prompt_behaviour = .always;
                    },
                    else => {
                        try bltn.write_err(&bltn.stderr, .rm, "illegal option -- {s}\n", .{flag[1..]});
                        return 1;
                    },
                }
            }

            return 0;
        }
    };

    pub fn exec(this: *Rm) !u8 {
        defer {
            while (this.stack.popOrNull()) |item| {
                if (item.should_dealloc) {
                    this.allocator.free(item.path);
                }
            }
            this.stack.deinit();
        }

        while (this.stack.popOrNull()) |item_| {
            var item = item_;
            defer {
                if (item.should_dealloc) {
                    this.allocator.free(item.path);
                }
            }
            log("[rm] Process: {s} {s}\n", .{ item.path, @tagName(item.action) });

            if (item.action == .remove_dir) {
                const absolute_path = this.preparePath(item.path);
                const code = try this.rmDir(absolute_path, item.path);
                if (code != 0) return code;
            }

            const code = try this.rmPath(&item);
            if (code != 0) return code;
        }

        return 0;
    }

    fn rmPath(this: *Rm, item: *Item) !u8 {
        const path = item.path;
        if (path.len == 0) {
            if (this.opts.force) return 0;
            try this.bltn.write_err(&this.bltn.stderr, .rm, "{s}: No such file or directory", .{path});
            return 1;
        }

        if (path.len > bun.MAX_PATH_BYTES) {
            try this.bltn.write_err(&this.bltn.stderr, .rm, "{s}: File name too long", .{path});
            return 1;
        }

        const absolute_path = this.preparePath(path);

        if (this.isRoot(absolute_path) and this.opts.preserve_root) return 0;

        const dir_fd = switch (Syscall.openat(this.cwd_fd, absolute_path, std.os.O.DIRECTORY, 0)) {
            .result => |fd| fd,
            .err => |err| {
                const errno: usize = @intCast(err.errno);
                switch (errno) {
                    @as(usize, @intFromEnum(bun.C.E.NOTDIR)) => {
                        return this.rmFile(absolute_path, path);
                    },
                    @as(usize, @intFromEnum(bun.C.E.NOENT)) => {
                        if (this.opts.force) return 0;
                        try this.bltn.write_err(&this.bltn.stderr, .rm, "No such file or directory: {s}\n", .{path});
                        return 1;
                    },
                    else => return @intCast(err.errno),
                }
            },
        };
        defer {
            _ = Syscall.close2(dir_fd);
        }

        if (!this.opts.recursive and !this.opts.remove_empty_dirs) {
            try this.bltn.write_err(&this.bltn.stderr, .rm, "{s}: is a directory\n", .{path});
            return 0;
        }

        const dir = std.fs.Dir{ .fd = bun.fdcast(dir_fd) };
        var iterator = DirIterator.iterate(dir);
        var entry = iterator.next();

        if (this.opts.remove_empty_dirs) {
            switch (entry) {
                .result => |res| {
                    if (res != null) {
                        try this.bltn.write_err(&this.bltn.stderr, .rm, "{s}: Directory not empty\n", .{path});
                        return 1;
                    }
                    return try this.rmDir(absolute_path, path);
                },
                .err => |err| {
                    _ = err;
                    @panic("FIXME TODO");
                },
            }
            return 0;
        }

        const start = this.stack.items.len;
        while (switch (entry) {
            .result => |e| e,
            .err => |err| {
                _ = err;
                @panic("FIXME TODO");
            },
        }) |current| : (entry = iterator.next()) {
            const new_path = ResolvePath.joinZ(&[_][]const u8{ path, current.name.slice() }, .auto);
            const new_path_duped = try this.allocator.dupeZ(u8, new_path[0..new_path.len]);
            try this.stack.append(.{ .path = new_path_duped, .should_dealloc = true });
        }

        item.should_dealloc = false;
        try this.stack.append(.{ .path = item.path, .should_dealloc = true, .action = .remove_dir });
        const end = this.stack.items.len;

        // Reverse
        {
            var i: usize = start;
            var j: usize = end - 1;

            while (i < j) {
                const tmp = this.stack.items[i];
                this.stack.items[i] = this.stack.items[j];
                this.stack.items[j] = tmp;
                i += 1;
                j -= 1;
            }
        }
        for (this.stack.items[start..end]) |item2| {
            log("[rm] added to stack: {s} {s}\n", .{ item2.path, @tagName(item2.action) });
        }

        return 0;
    }

    /// FIXME TODO error code is not u8 this will cause @intCast truncate bits panic
    fn rmDir(this: *Rm, absolute_path: [:0]const u8, path: []const u8) !u8 {
        log("[rm] delete: {s}", .{absolute_path});
        // FIXME TODO handle this better
        try this.verboseDelete(path);
        const result = std.os.system.rmdir(absolute_path);
        return @intCast(result);
    }

    fn rmFile(this: *Rm, absolute_path: [:0]const u8, path: []const u8) !u8 {
        log("[rm] delete: {s}", .{absolute_path});
        return switch (Syscall.unlink(absolute_path)) {
            .result => {
                try this.verboseDelete(path);
                return 0;
            },
            .err => |err| {
                return @intCast(err.errno);
            },
        };
    }

    fn verboseDelete(this: *Rm, path: []const u8) !void {
        if (this.opts.verbose) {
            try this.bltn.write_fmt(&this.bltn.stdout, "{s}\n", .{path});
        }
    }

    fn isRoot(this: *Rm, path: []const u8) bool {
        // FIXME TODO Windows
        _ = this;
        if (path.len == 0) return false;
        if (path.len == 1 and path[0] == '/') return true;
        return false;
    }

    fn preparePath(this: *Rm, path: []const u8) [:0]const u8 {
        if (ResolvePath.Platform.auto.isAbsolute(path)) {
            @memcpy(this.pathbuf[0..path.len], path);
            this.pathbuf[path.len] = 0;
            return this.pathbuf[0..path.len :0];
        }

        const existing_cwd = this.cwd;
        const path_str = ResolvePath.joinZBuf(this.pathbuf[0..], &[_][]const u8{
            existing_cwd,
            path,
        }, .auto);

        return path_str;
    }

    fn promptDelete(this: *Rm, path: []const u8) !bool {
        _ = path;
        _ = this;
        @panic("FIXME TODO");
    }
};

const MaybeManyStrings = union {
    one: [:0]const u8,
    many: std.ArrayList([:0]const u8),
};
