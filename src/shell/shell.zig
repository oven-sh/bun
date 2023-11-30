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
const Subprocess = bun.ShellSubprocess;

const GlobWalker = Glob.GlobWalker_(null, true);
// const GlobWalker = Glob.BunGlobWalker;

pub const ShellError = error{ Init, Process, GlobalThisThrown, Spawn };
pub const ParseError = error{
    Expected,
    Unknown,
};

extern "C" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: i32) i32;

fn setEnv(name: [*:0]const u8, value: [*:0]const u8) void {
    // TODO: windows
    _ = setenv(name, value, 1);
}

/// [0] => read end
/// [1] => write end
const Pipe = [2]bun.FileDescriptor;

const log = bun.Output.scoped(.SHELL, false);
const logsys = bun.Output.scoped(.SYS, false);

// FIXME avoid std.os if possible
// FIXME error when command not found needs to be handled gracefully
pub const Interpreter = struct {
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
                    var buf = try stack_alloc.get().alloc(u8, len);
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

                    var slice = io.arraybuf.buf.slice()[io.arraybuf.i .. io.arraybuf.i + write_len];
                    @memcpy(slice, buf[0..write_len]);
                    io.arraybuf.i +|= @truncate(write_len);
                    log("{s} write to arraybuf {d}\n", .{ this.kind.asString(), write_len });
                },
                .blob => @panic("FIXME TODO"),
                .ignore => {},
            }
        }
    };

    pub fn new(arena: *bun.ArenaAllocator, globalThis: *JSC.JSGlobalObject, jsobjs: []JSValue) !Interpreter {
        const allocator = arena.allocator();
        var export_env = brk: {
            var export_env = std.StringArrayHashMap([:0]const u8).init(allocator);
            var iter = globalThis.bunVM().bundler.env.map.iter();
            while (iter.next()) |entry| {
                var dupedz = try allocator.dupeZ(u8, entry.value_ptr.value);
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

        var interpreter: Interpreter = .{
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

    pub fn interpret(self: *Interpreter, script: ast.Script) anyerror!void {
        var stdio = Interpreter.default_io();
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
        self: *Interpreter,
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

    fn interpret_assign(self: *Interpreter, assign: *const ast.Assign, assign_ctx: AssignCtx) anyerror!void {
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

    fn interpret_cond(self: *Interpreter, left: *const ast.Expr, right: *const ast.Expr, op: ast.Conditional.Op, io: *IO) anyerror!bool {
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

    fn interpret_pipeline(self: *Interpreter, pipeline: *const ast.Pipeline, io: *IO) anyerror!bool {
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
                var file_to_write_to = Interpreter.pipeline_file_to_write(
                    pipes,
                    i,
                    cmd_count,
                    io,
                );
                var file_to_read_from = Interpreter.pipeline_file_to_read(pipes, i, io);

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

                var cmd_proc = try self.init_cmd(cmd, &cmd_io, false);
                kind = @as(Cmd.Kind, cmd_proc);

                cmd_procs[i] = cmd_proc;
                i += 1;
                cmd_procs_set_amount += 1;
            }
        }

        var jsc_vm = self.globalThis.bunVM();

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

    pub fn wait(this: *Interpreter, jsc_vm: *JSC.VirtualMachine, cmd: *Cmd) !bool {
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

    fn init_cmd(self: *Interpreter, cmd: *const ast.Cmd, io: *IO, comptime in_cmd_subst: bool) !Cmd {
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
            var resolved = Which.which(&path_buf, spawn_args.PATH, spawn_args.cwd, first_arg[0..first_arg_len]) orelse {
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
        self: *Interpreter,
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

    fn interpret_cmd(self: *Interpreter, cmd: *const ast.Cmd, io: *IO) !bool {
        var subcmd = try self.init_cmd(cmd, io, false);
        defer subcmd.deinit(false);
        return try self.interpret_cmd_impl(&subcmd);
    }

    fn interpret_cmd_impl(self: *Interpreter, cmd: *Cmd) !bool {
        return switch (cmd.*) {
            .subproc => try self.interpret_subproc(cmd.subproc),
            .builtin => try self.interpret_builtin(&cmd.builtin),
        };
    }

    fn interpret_subproc(self: *Interpreter, subprocess: *Subprocess) !bool {
        log("Interpret cmd", .{});
        var jsc_vm = self.globalThis.bunVM();
        return Cmd.waitSubproc(subprocess, jsc_vm);
    }

    fn interpret_builtin(
        self: *Interpreter,
        bltn: *Builtin,
    ) !bool {

        // FIXME TODO handle error
        const exit_code = self.interpret_builtin_impl(bltn) catch 1;

        bltn.exit_code = exit_code;
        return exit_code == 0;
    }

    fn interpret_builtin_impl(self: *Interpreter, bltn: *Builtin) !u8 {
        return switch (bltn.kind) {
            .@"export" => try self.interpret_builtin_export(bltn),
            .echo => try self.interpret_builtin_echo(bltn),
            .cd => try self.interpret_builtin_cd(bltn),
            .pwd => try self.interpret_builtin_pwd(bltn),
            .which => try self.interpret_builtin_which(bltn),
            .rm => try self.interpret_builtin_rm(bltn),
        };
    }

    fn interpret_builtin_rm(self: *Interpreter, bltn: *Builtin) !u8 {
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
        var paths = brk: {
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

    fn interpret_builtin_which(self: *Interpreter, bltn: *Builtin) !u8 {
        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const args = bltn.argsSlice();
        if (args.len == 0) {
            try bltn.write(&bltn.stdout, "\n");
            return 0;
        }

        for (args) |arg_raw| {
            const arg = arg_raw[0..std.mem.len(arg_raw)];
            const PATH = self.globalThis.bunVM().bundler.env.get("PATH") orelse "";
            var resolved = Which.which(&path_buf, PATH, self.cwd, arg) orelse {
                try bltn.write_fmt(&bltn.stdout, "{s} not found\n", .{arg});
                continue;
            };
            try bltn.write_fmt(&bltn.stdout, "{s}\n", .{resolved});
        }
        return 0;
    }

    fn interpret_builtin_pwd(self: *Interpreter, bltn: *Builtin) !u8 {
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
    fn interpret_builtin_cd(self: *Interpreter, bltn: *Builtin) !u8 {
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

    fn interpret_builtin_echo(self: *Interpreter, bltn: *Builtin) !u8 {
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
        self: *Interpreter,
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

    fn get_homedir(self: *Interpreter) [:0]const u8 {
        if (comptime bun.Environment.isWindows) {
            if (self.export_env.get("USERPROFILE")) |env|
                return env;
        } else {
            if (self.export_env.get("HOME")) |env|
                return env;
        }
        return "unknown";
    }

    fn change_cwd(self: *Interpreter, new_cwd_: [:0]const u8, bltn: *Builtin, comptime kind: Builtin.Kind) !u8 {
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
        self: *Interpreter,
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
        self: *Interpreter,
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
        self: *Interpreter,
        comptime for_spawn: bool,
        atom: *const ast.Atom,
        out: if (!for_spawn) *std.ArrayList([:0]const u8) else *std.ArrayList(?[*:0]const u8),
    ) void {
        _ = out;
        _ = atom;
        _ = self;
    }

    fn expand_glob_pattern(
        self: *Interpreter,
        comptime for_spawn: bool,
        pattern: []const u8,
        out: if (!for_spawn) *std.ArrayList([:0]const u8) else *std.ArrayList(?[*:0]const u8),
    ) void {
        // FIXME TODO handle GLOBIGNORE env variable
        var glob_walker: Glob.BunGlobWalker = .{};
        var arena = std.heap.ArenaAllocator.init(self.allocator);

        var dot = false;
        var absolute = false;
        var follow_symlinks = false;
        var error_on_broken_symlinks = false;
        var only_files = false;

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
        self: *Interpreter,
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
            var expanded_strings = try maybe_stack_alloc.get().alloc(std.ArrayList(u8), expansion_count);
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

    fn eval_atom_no_brace_expansion(self: *Interpreter, atom: *const ast.Atom) anyerror![:0]const u8 {
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
        self: *Interpreter,
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
        self: *Interpreter,
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

    fn eval_atom_cmd_subst(self: *Interpreter, cmd: *const ast.Cmd, array_list: *std.ArrayList(u8)) !void {
        var io = Interpreter.default_io();
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

    fn eval_var(self: *const Interpreter, label: []const u8) []const u8 {
        const value = self.shell_env.get(label) orelse brk: {
            break :brk self.globalThis.bunVM().bundler.env.map.get(label) orelse return "";
        };
        return value;
    }

    /// Returns the size of the atom when expanded.
    /// If the calculation cannot be computed trivially (cmd substitution, brace expansion), this value is not accurate and `has_unknown` is set to true
    fn eval_atom_size_hint(self: *const Interpreter, atom: *const ast.Atom, has_unknown: *bool) usize {
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

    fn eval_atom_size_simple(self: *const Interpreter, simple: *const ast.SimpleAtom, has_cmd_subst: *bool) usize {
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

pub const StateMachine = struct {
    pub const Machine = struct {
        /// This is the arena used to allocate AST nodes
        arena: bun.ArenaAllocator,

        /// This is the allocator used to allocate machine state
        allocator: Allocator,

        /// The return value
        promise: JSPromise.Strong = .{},

        script: *AST.Script,

        global: *JSGlobalObject,

        const MachineErrorKind = error{
            OutOfMemory,
            Syscall,
        };

        const MachineError = union(enum) {
            syscall: Syscall.Error,
            other: MachineErrorKind,

            fn toJSC(this: MachineError, globalThis: *JSGlobalObject) JSValue {
                return switch (this) {
                    .syscall => |err| err.toJSC(globalThis),
                    .other => |err| bun.JSC.ZigString.fromBytes(@errorName(err)).toValueGC(globalThis),
                };
            }
        };

        /// If all initialization allocations succeed, the arena will be copied
        /// into the machine struct, so it is not a stale reference.
        pub fn dummy(allocator: Allocator, arena: *bun.ArenaAllocator, global: *JSGlobalObject) !*Machine {
            var arena_allocator = arena.allocator();
            var machine = try allocator.create(Machine);
            machine.global = global;
            errdefer {
                allocator.destroy(machine);
            }

            // Make a dummy AST for `echo foo && echo hi`
            {
                var script = try arena_allocator.create(AST.Script);
                var stmts = try arena_allocator.alloc(AST.Stmt, 1);
                script.stmts = stmts;

                var echo_foo = try arena_allocator.create(AST.Cmd);
                echo_foo.name_and_args = try arena_allocator.alloc(AST.Atom, 2);
                echo_foo.name_and_args[0] = .{ .simple = .{ .Text = "echo" } };
                echo_foo.name_and_args[1] = .{ .simple = .{ .Text = "foo" } };

                var echo_hi = try arena_allocator.create(AST.Cmd);
                echo_hi.name_and_args = try arena_allocator.alloc(AST.Atom, 2);
                echo_hi.name_and_args[0] = .{ .simple = .{ .Text = "echo" } };
                echo_hi.name_and_args[1] = .{ .simple = .{ .Text = "hi" } };

                var merged = try arena_allocator.create(AST.Conditional);
                merged.* = AST.Conditional{
                    .op = .And,
                    .left = .{ .cmd = echo_foo },
                    .right = .{ .cmd = echo_hi },
                };

                stmts[0].exprs = try arena_allocator.alloc(AST.Expr, 1);
                stmts[0].exprs[0] = .{ .cond = merged };

                machine.script = script;
            }

            machine.arena = arena.*;
            machine.allocator = allocator;
            machine.promise = .{};
            var promise = JSC.JSPromise.create(global);
            machine.promise.strong.set(global, promise.asValue(global));
            return machine;
        }

        pub fn start(this: *Machine, globalThis: *JSGlobalObject) !JSValue {
            _ = globalThis;
            var root = try Script.fromAST(this, this.script);
            try root.start();
            return this.promise.value();
        }

        fn finish(this: *Machine) void {
            defer this.deinit();
            this.promise.resolve(this.global, .true);
        }

        fn errored(this: *Machine, the_error: MachineError) void {
            defer this.deinit();
            this.promise.reject(this.global, the_error.toJSC(this.global));
        }

        fn deinit(this: *Machine) void {
            this.arena.deinit();
            this.allocator.destroy(this);
        }
    };

    pub const State = packed struct {
        kind: StateKind,
        machine: *Machine,
    };

    pub const StatePtr = packed struct {
        const AddressableSize = u48;
        __ptr: AddressableSize,
        kind: StateKind,
        _pad: u8 = 0,

        pub fn ptr(this: StatePtr) *State {
            return @ptrFromInt(@as(usize, @intCast(this.__ptr)));
        }

        // pub fn onExit(this: StatePtr, exit_code: ?u8) void {
        //     return switch (this.kind) {
        //         .script => this.ptr().onExitImpl(.script, exit_code),
        //         .stmt => this.ptr(Stmt).onExitImpl(.stmt, exit_code),
        //         .cmd => this.ptr(Cmd).onExitImpl(.cmd, exit_code),
        //         .cond => this.ptr(Cond).onExitImpl(.cond, exit_code),
        //         .pipeline => this.ptr(Pipeline).onExitImpl(.pipeline, exit_code),
        //     };
        // }
    };

    const StateKind = enum(u8) {
        script,
        stmt,
        cmd,
        cond,
        pipeline,

        pub fn toStruct(comptime this: StateKind) type {
            return switch (this) {
                .script => Script,
                .stmt => Stmt,
                .cmd => Cmd,
                .cond => Cond,
                .pipeline => Pipeline,
            };
        }
    };

    pub const Script = struct {
        base: State,
        node: *const AST.Script,
        idx: usize,

        fn fromAST(machine: *Machine, node: *const AST.Script) !*Script {
            var script = try machine.allocator.create(Script);
            errdefer machine.allocator.destroy(script);
            script.base = .{ .kind = .script, .machine = machine };
            script.node = node;
            script.idx = 0;
            return script;
        }

        fn start(this: *Script) !void {
            if (bun.Environment.allow_assert) {
                std.debug.assert(this.idx == 0);
            }

            if (this.node.stmts.len == 0)
                return this.childDone(0);

            const stmt_node = &this.node.stmts[0];

            var stmt = try Stmt.fromAST(this.base.machine, stmt_node, this);
            try stmt.start();
        }

        fn childDone(this: *Script, exit_code: u8) void {
            _ = exit_code;
            log("SCRIPT DONE YO!", .{});
            this.base.machine.finish();
        }
    };

    pub const Stmt = struct {
        base: State,
        node: *const AST.Stmt,
        parent: *Script,
        idx: usize,
        last_exit_code: ?u8,

        pub fn fromAST(machine: *Machine, node: *const AST.Stmt, parent: *Script) !*Stmt {
            var script = try machine.allocator.create(Stmt);
            script.base = .{ .kind = .stmt, .machine = machine };
            script.node = node;
            script.parent = parent;
            script.idx = 0;
            script.last_exit_code = null;
            return script;
        }

        pub fn start(this: *Stmt) !void {
            if (bun.Environment.allow_assert) {
                std.debug.assert(this.idx == 0);
                std.debug.assert(this.last_exit_code == null);
            }

            if (this.node.exprs.len == 0)
                return this.parent.childDone(0);

            const child = &this.node.exprs[0];
            switch (child.*) {
                .cond => {
                    const cond = Cond.fromAST(this.base.machine, child.cond, Cond.ParentPtr.init(this));
                    cond.start();
                },
                else => @panic("TODO"),
            }
        }

        pub fn childDone(this: *Stmt, exit_code: u8) void {
            this.last_exit_code = exit_code;
            const next_idx = this.idx + 1;
            if (next_idx >= this.node.exprs.len)
                return this.parent.childDone(exit_code);

            const child = &this.node.exprs[next_idx];
            switch (child.*) {
                .cond => {
                    const cond = Cond.fromAST(this.base.machine, child.cond, Cond.ParentPtr.init(this));
                    cond.start();
                },
                else => @panic("TODO"),
            }
        }
    };

    pub const Cond = struct {
        base: State,
        node: *const AST.Conditional,
        /// Based on precedence rules conditional can only be child of a stmt or
        /// another conditional
        parent: ParentPtr,
        left: ?u8 = null,
        right: ?u8 = null,
        currently_executing: ?ChildPtr = null,

        const ChildPtr = TaggedPointerUnion(.{ Cmd, Pipeline, Cond });

        const ParentPtr = TaggedPointerUnion(.{
            Stmt,
            Cond,
        });

        pub fn fromAST(machine: *Machine, node: *const AST.Conditional, parent: ParentPtr) *Cond {
            var cond = machine.allocator.create(Cond) catch |err| {
                std.debug.print("Ruh roh: {any}\n", .{err});
                @panic("Ruh roh");
            };
            cond.node = node;
            cond.base = .{ .kind = .cond, .machine = machine };
            cond.parent = parent;
            cond.left = null;
            cond.right = null;
            cond.currently_executing = null;
            return cond;
        }

        fn start(this: *Cond) void {
            log("conditional start {x} ({s})", .{ @intFromPtr(this), @tagName(this.node.op) });
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.left == null);
                std.debug.assert(this.right == null);
                std.debug.assert(this.currently_executing == null);
            }

            this.currently_executing = this.makeChild(true);
            var child = this.currently_executing.?.as(Cmd);
            child.start(true);
        }

        fn makeChild(this: *Cond, left: bool) ChildPtr {
            const node = if (left) &this.node.left else &this.node.right;
            switch (node.*) {
                .cmd => {
                    const cmd = Cmd.fromAST(this.base.machine, node.cmd, Cmd.ParentPtr.init(this));
                    return ChildPtr.init(cmd);
                },
                .cond => {
                    const cond = Cond.fromAST(this.base.machine, node.cond, Cond.ParentPtr.init(this));
                    return ChildPtr.init(cond);
                },
                .assign, .pipeline => @panic("TODO"),
            }
        }

        pub fn childDone(this: *Cond, exit_code: u8) void {
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.left == null or this.right == null);
                std.debug.assert(this.currently_executing != null);
            }
            log("conditional child done {x} ({s}) {s}", .{ @intFromPtr(this), @tagName(this.node.op), if (this.left == null) "right" else "left" });

            if (this.left == null) {
                this.left = exit_code;
                if (exit_code != 0) {
                    switch (this.parent.tag()) {
                        // FIXME errors
                        .Stmt => this.parent.as(Stmt).childDone(exit_code),
                        .Cond => this.parent.as(Cond).childDone(exit_code),
                        else => @panic("JSALDKJSD"),
                    }
                    return;
                }

                this.currently_executing = this.makeChild(false);
                this.currently_executing.?.as(Cmd).start(false);
                return;
            }

            this.right = exit_code;
            switch (this.parent.tag()) {
                .Stmt => this.parent.as(Stmt).childDone(exit_code),
                .Cond => this.parent.as(Cond).childDone(exit_code),
                else => @panic("JSALDKJSD"),
            }
        }
    };

    pub const Cmd = struct {
        base: State,
        node: *const AST.Cmd,
        cmd: ?*Subprocess,
        parent: ParentPtr,
        exit_code: ?u8,

        const ParentPtr = TaggedPointerUnion(.{
            Stmt,
            Cond,
            Pipeline,
            // TODO
            // .subst = void,
        });

        pub fn start(this: *Cmd, foo: bool) void {
            log("cmd start {x}", .{@intFromPtr(this)});
            this.initSubproc(foo) catch bun.outOfMemory();
        }

        pub fn fromAST(machine: *Machine, node: *const AST.Cmd, parent: ParentPtr) *Cmd {
            var cmd = machine.allocator.create(Cmd) catch |err| {
                std.debug.print("Ruh roh: {any}\n", .{err});
                @panic("Ruh roh");
            };
            cmd.base = .{ .kind = .cmd, .machine = machine };
            cmd.node = node;
            cmd.cmd = null;
            cmd.parent = parent;
            cmd.exit_code = null;
            return cmd;
        }

        fn initSubproc(this: *Cmd, foo: bool) !void {
            log("cmd init subproc {x}", .{@intFromPtr(this)});
            var arena = bun.ArenaAllocator.init(this.base.machine.allocator);
            defer arena.deinit();

            var spawn_args = Subprocess.SpawnArgs.default(&arena, this.base.machine.global.bunVM(), false);
            spawn_args.stdio[bun.STDIN_FD] = .inherit;
            spawn_args.stdio[bun.STDOUT_FD] = .inherit;
            spawn_args.stdio[bun.STDERR_FD] = .inherit;
            spawn_args.argv = std.ArrayListUnmanaged(?[*:0]const u8){};
            spawn_args.cmd_parent = this;

            if (foo) {
                try spawn_args.argv.append(arena.allocator(), @as([*:0]const u8, @ptrCast("/bin/sleep".ptr)));
                try spawn_args.argv.append(arena.allocator(), @as([*:0]const u8, @ptrCast("2".ptr)));
            } else {
                try spawn_args.argv.append(arena.allocator(), @as([*:0]const u8, @ptrCast("/bin/echo".ptr)));
                try spawn_args.argv.append(arena.allocator(), @as([*:0]const u8, @ptrCast("bar".ptr)));
            }

            const subproc = (try Subprocess.spawnAsync(this.base.machine.global, spawn_args)) orelse return ShellError.Spawn;
            this.cmd = subproc;
        }

        pub fn onExit(this: *Cmd, exit_code: u8) void {
            log("cmd exit code={d} ({x})", .{ exit_code, @intFromPtr(this) });
            this.exit_code = exit_code;
            switch (this.parent.tag()) {
                .Stmt => @panic("TODO"),
                .Cond => this.parent.as(Cond).childDone(exit_code),
                .Pipeline => @panic("TODO"),
                else => @panic("JSALDKJSD"),
            }
        }
    };

    pub const Pipeline = struct {
        base: State,
        node: *const AST.Pipeline,
        /// Based on precedence rules pipeline can only be child of a stmt or
        /// conditional
        parent: ParentPtr,
        idx: usize,
        pipes: []Pipe,
        exit_codes: []?u8,

        const ParentPtr = TaggedPointerUnion(.{
            Stmt,
            Cond,
        });
    };
};

pub const AST = struct {
    pub const Script = struct {
        stmts: []Stmt,
    };

    pub const Stmt = struct {
        exprs: []Expr,
    };

    pub const Expr = union(Expr.Tag) {
        assign: []Assign,
        cond: *Conditional,
        pipeline: *Pipeline,
        cmd: *Cmd,

        const Tag = enum { assign, cond, pipeline, cmd };
    };

    pub const Conditional = struct {
        op: Op,
        left: Expr,
        right: Expr,

        const Op = enum { And, Or };
    };

    pub const Pipeline = struct {
        items: []CmdOrAssigns,
    };

    pub const CmdOrAssigns = union(CmdOrAssigns.Tag) {
        cmd: Cmd,
        assigns: []Assign,

        const Tag = enum { cmd, assigns };

        pub fn to_expr(this: CmdOrAssigns, alloc: Allocator) !Expr {
            switch (this) {
                .cmd => |cmd| {
                    var cmd_ptr = try alloc.create(Cmd);
                    cmd_ptr.* = cmd;
                    return .{ .cmd = cmd_ptr };
                },
                .assigns => |assigns| {
                    return .{ .assign = assigns };
                },
            }
        }
    };

    /// A "buffer" from a JS object can be piped from and to, and also have
    /// output from commands redirected into it. Only BunFile, ArrayBufferView
    /// are supported.
    pub const JSBuf = struct {
        idx: u32,

        pub fn new(idx: u32) JSBuf {
            return .{ .idx = idx };
        }
    };

    /// A Subprocess from JS
    pub const JSProc = struct { idx: JSValue };

    pub const Assign = struct {
        label: []const u8,
        value: Atom,

        pub fn new(label: []const u8, value: Atom) Assign {
            return .{
                .label = label,
                .value = value,
            };
        }
    };

    pub const Cmd = struct {
        assigns: []Assign,
        name_and_args: []Atom,
        redirect: RedirectFlags = .{},
        redirect_file: ?Redirect = null,

        /// Bit flags for redirects:
        /// -  `>`  = Redirect.Stdout
        /// -  `1>` = Redirect.Stdout
        /// -  `2>` = Redirect.Stderr
        /// -  `&>` = Redirect.Stdout | Redirect.Stderr
        /// -  `>>` = Redirect.Append | Redirect.Stdout
        /// - `1>>` = Redirect.Append | Redirect.Stdout
        /// - `2>>` = Redirect.Append | Redirect.Stderr
        /// - `&>>` = Redirect.Append | Redirect.Stdout | Redirect.Stderr
        ///
        /// Multiple redirects and redirecting stdin is not supported yet.
        pub const RedirectFlags = packed struct(u8) {
            stdin: bool = false,
            stdout: bool = false,
            stderr: bool = false,
            append: bool = false,
            __unused: u4 = 0,

            pub fn @">"() RedirectFlags {
                return .{ .stdout = true };
            }

            pub fn @">>"() RedirectFlags {
                return .{ .append = true, .stdout = true };
            }

            pub fn @"&>"() RedirectFlags {
                return .{ .stdout = true, .stderr = true };
            }

            pub fn @"&>>"() RedirectFlags {
                return .{ .append = true, .stdout = true, .stderr = true };
            }

            pub fn merge(a: RedirectFlags, b: RedirectFlags) RedirectFlags {
                var anum: u8 = @bitCast(a);
                var bnum: u8 = @bitCast(b);
                return @bitCast(anum | bnum);
            }
        };

        pub const Redirect = union(enum) {
            atom: Atom,
            jsbuf: JSBuf,
        };
    };

    pub const Atom = union(Atom.Tag) {
        simple: SimpleAtom,
        compound: CompoundAtom,

        const Tag = enum(u8) { simple, compound };

        pub fn new_simple(atom: SimpleAtom) Atom {
            return .{ .simple = atom };
        }

        pub fn is_compound(self: *const Atom) bool {
            switch (self.*) {
                .compound => return true,
                else => return false,
            }
        }

        pub fn has_expansions(self: *const Atom) bool {
            return self.has_glob_expansion() or self.has_brace_expansion();
        }

        pub fn has_glob_expansion(self: *const Atom) bool {
            return switch (self.*) {
                .simple => self.simple.glob_hint(),
                .compound => self.compound.glob_hint,
            };
        }

        pub fn has_brace_expansion(self: *const Atom) bool {
            return switch (self.*) {
                .simple => false,
                .compound => self.compound.brace_expansion_hint,
            };
        }
    };

    pub const SimpleAtom = union(enum) {
        Var: []const u8,
        Text: []const u8,
        asterisk,
        double_asterisk,
        brace_begin,
        brace_end,
        comma,
        cmd_subst: *CmdOrAssigns,

        pub fn glob_hint(this: SimpleAtom) bool {
            return switch (this) {
                .asterisk, .double_asterisk => true,
                else => false,
            };
        }
    };

    pub const CompoundAtom = struct {
        atoms: []SimpleAtom,
        brace_expansion_hint: bool = false,
        glob_hint: bool = false,
    };
};

// FIXME command substitution can be any arbitrary expression not just command
pub const Parser = struct {
    strpool: []const u8,
    tokens: []const Token,
    alloc: Allocator,
    jsobjs: []JSValue,
    current: u32 = 0,
    errors: std.ArrayList(Error),

    // FIXME error location
    const Error = struct { msg: []const u8 };

    pub fn new(
        allocator: Allocator,
        lex_result: LexResult,
        jsobjs: []JSValue,
    ) !Parser {
        return .{
            .strpool = lex_result.strpool,
            .tokens = lex_result.tokens,
            .alloc = allocator,
            .jsobjs = jsobjs,
            .errors = std.ArrayList(Error).init(allocator),
        };
    }

    pub fn parse(self: *Parser) !AST.Script {
        var stmts = ArrayList(AST.Stmt).init(self.alloc);
        while (!self.match(.Eof)) {
            try stmts.append(try self.parse_stmt());
        }
        _ = self.expect(.Eof);
        return .{ .stmts = stmts.items[0..stmts.items.len] };
    }

    pub fn parse_stmt(self: *Parser) !AST.Stmt {
        var exprs = std.ArrayList(AST.Expr).init(self.alloc);

        while (!self.match_any(&.{ .Semicolon, .Eof })) {
            const expr = try self.parse_expr();
            try exprs.append(expr);
        }

        return .{
            .exprs = exprs.items[0..],
        };
    }

    fn parse_expr(self: *Parser) !AST.Expr {
        return self.parse_cond();
    }

    fn parse_cond(self: *Parser) !AST.Expr {
        var left = try self.parse_pipeline();
        while (self.match_any(&.{ .DoubleAmpersand, .DoublePipe })) {
            const op: AST.Conditional.Op = op: {
                const previous = @as(TokenTag, self.prev());
                switch (previous) {
                    .DoubleAmpersand => break :op .And,
                    .DoublePipe => break :op .Or,
                    else => unreachable,
                }
            };

            const right = try self.parse_pipeline();
            const conditional = try self.allocate(AST.Conditional, .{ .op = op, .left = left, .right = right });
            left = .{ .cond = conditional };
        }

        return left;
    }

    fn parse_pipeline(self: *Parser) !AST.Expr {
        var cmd = try self.parse_cmd_or_assigns();

        if (self.peek() == .Pipe) {
            var cmds = std.ArrayList(AST.CmdOrAssigns).init(self.alloc);
            try cmds.append(cmd);
            while (self.match(.Pipe)) {
                try cmds.append(try self.parse_cmd_or_assigns());
            }
            const pipeline = try self.allocate(AST.Pipeline, .{ .items = cmds.items[0..] });
            return .{ .pipeline = pipeline };
        }

        return try cmd.to_expr(self.alloc);
    }

    fn parse_cmd_or_assigns(self: *Parser) !AST.CmdOrAssigns {
        var assigns = std.ArrayList(AST.Assign).init(self.alloc);
        while (!self.match_any(&.{ .Semicolon, .Eof })) {
            if (try self.parse_assign()) |assign| {
                try assigns.append(assign);
            } else {
                break;
            }
        }

        if (self.match_any(&.{ .Semicolon, .Eof })) {
            if (assigns.items.len == 0) {
                try self.add_error("expected a command or assignment", .{});
                return ParseError.Expected;
            }
            return .{ .assigns = assigns.items[0..] };
        }

        const name = try self.parse_atom() orelse {
            if (assigns.items.len == 0) {
                try self.add_error("expected a command or assignment", .{});
                return ParseError.Expected;
            }
            return .{ .assigns = assigns.items[0..] };
        };

        var name_and_args = std.ArrayList(AST.Atom).init(self.alloc);
        try name_and_args.append(name);
        while (try self.parse_atom()) |arg| {
            try name_and_args.append(arg);
        }

        // TODO Parse redirects (need to update lexer to have tokens for different parts e.g. &>>)
        const has_redirect = self.match(.Redirect);
        const redirect = if (has_redirect) self.prev().Redirect else AST.Cmd.RedirectFlags{};
        const redirect_file: ?AST.Cmd.Redirect = redirect_file: {
            if (has_redirect) {
                if (self.match(.JSObjRef)) {
                    const obj_ref = self.prev().JSObjRef;
                    break :redirect_file .{ .jsbuf = AST.JSBuf.new(obj_ref) };
                }

                const redirect_file = try self.parse_atom() orelse {
                    try self.add_error("redirection with no file", .{});
                    return ParseError.Expected;
                };
                break :redirect_file .{ .atom = redirect_file };
            }
            break :redirect_file null;
        };
        // TODO check for multiple redirects and error

        return .{ .cmd = .{
            .assigns = assigns.items[0..],
            .name_and_args = name_and_args.items[0..],
            .redirect = redirect,
            .redirect_file = redirect_file,
        } };
    }

    /// Try to parse an assignment. If no assignment could be parsed then return
    /// null and backtrack the parser state
    fn parse_assign(self: *Parser) !?AST.Assign {
        const old = self.current;
        _ = old;
        switch (self.peek()) {
            .Text => |txtrng| {
                const start_idx = self.current;
                _ = self.expect(.Text);
                const txt = self.text(txtrng);
                const var_decl: ?AST.Assign = var_decl: {
                    if (hasEqSign(txt)) |eq_idx| {
                        // If it starts with = then it's not valid assignment (e.g. `=FOO`)
                        if (eq_idx == 0) break :var_decl null;
                        const label = txt[0..eq_idx];
                        if (!isValidVarName(label)) {
                            break :var_decl null;
                        }

                        if (eq_idx == txt.len - 1) {
                            const atom = try self.parse_atom() orelse {
                                try self.add_error("Expected an atom", .{});
                                return ParseError.Expected;
                            };
                            break :var_decl .{
                                .label = label,
                                .value = atom,
                            };
                        }

                        const txt_value = txt[eq_idx + 1 .. txt.len];
                        _ = self.expect_delimit();
                        break :var_decl .{
                            .label = label,
                            .value = .{ .simple = .{ .Text = txt_value } },
                        };
                    }
                    break :var_decl null;
                };

                if (var_decl) |vd| {
                    return vd;
                }

                // Rollback
                self.current = start_idx;
                return null;
            },
            else => return null,
        }
    }

    fn parse_atom(self: *Parser) !?AST.Atom {
        var array_alloc = std.heap.stackFallback(@sizeOf(AST.SimpleAtom), self.alloc);
        var exprs = try std.ArrayList(AST.SimpleAtom).initCapacity(array_alloc.get(), 1);
        var has_brace_open = false;
        var has_brace_close = false;
        var has_comma = false;
        var has_glob_syntax = false;
        {
            while (!self.match_any(&.{ .Delimit, .Eof })) {
                const next = self.peek_n(1);
                const next_delimits = next == .Delimit or next == .Eof;
                const peeked = self.peek();
                const should_break = next_delimits;
                switch (peeked) {
                    .Asterisk => {
                        has_glob_syntax = true;
                        _ = self.expect(.Asterisk);
                        try exprs.append(.asterisk);
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            break;
                        }
                    },
                    .DoubleAsterisk => {
                        has_glob_syntax = true;
                        _ = self.expect(.DoubleAsterisk);
                        try exprs.append(.double_asterisk);
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            break;
                        }
                    },
                    .BraceBegin => {
                        has_brace_open = true;
                        _ = self.expect(.BraceBegin);
                        try exprs.append(.brace_begin);
                        // TODO in this case we know it can't possibly be the beginning of a brace expansion so maybe its faster to just change it to text here
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            if (should_break) break;
                        }
                    },
                    .BraceEnd => {
                        has_brace_close = true;
                        _ = self.expect(.BraceEnd);
                        try exprs.append(.brace_end);
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            break;
                        }
                    },
                    .Comma => {
                        has_comma = true;
                        _ = self.expect(.Comma);
                        try exprs.append(.comma);
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            if (should_break) break;
                        }
                    },
                    .CmdSubstBegin => {
                        _ = self.expect(.CmdSubstBegin);
                        const subst = try self.allocate(AST.CmdOrAssigns, try self.parse_cmd_subst());
                        try exprs.append(.{ .cmd_subst = subst });
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            if (should_break) break;
                        }
                    },
                    .Text => |txtrng| {
                        _ = self.expect(.Text);
                        const txt = self.text(txtrng);
                        try exprs.append(.{ .Text = txt });
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            if (should_break) break;
                        }
                    },
                    .Var => |txtrng| {
                        _ = self.expect(.Var);
                        const txt = self.text(txtrng);
                        try exprs.append(.{ .Var = txt });
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            if (should_break) break;
                        }
                    },
                    else => return null,
                }
            }
        }

        return switch (exprs.items.len) {
            0 => null,
            1 => {
                std.debug.assert(exprs.capacity == 1);
                return AST.Atom.new_simple(exprs.items[0]);
            },
            else => .{ .compound = .{
                .atoms = exprs.items[0..exprs.items.len],
                .brace_expansion_hint = has_brace_open and has_brace_close and has_comma,
                .glob_hint = has_glob_syntax,
            } },
        };
    }

    fn parse_cmd_subst(self: *Parser) anyerror!AST.CmdOrAssigns {
        const cmd_or_assigns = self.parse_cmd_or_assigns();
        _ = self.expect(.CmdSubstEnd);
        return cmd_or_assigns;
    }

    fn allocate(self: *const Parser, comptime T: type, val: T) !*T {
        var heap = try self.alloc.create(T);
        heap.* = val;
        return heap;
    }

    fn text(self: *const Parser, range: Token.TextRange) []const u8 {
        return self.strpool[range.start..range.end];
    }

    fn advance(self: *Parser) Token {
        if (!self.is_at_end()) {
            self.current += 1;
        }
        return self.prev();
    }

    fn is_at_end(self: *Parser) bool {
        return self.peek() == .Eof;
    }

    fn expect(self: *Parser, toktag: TokenTag) Token {
        std.debug.assert(toktag == @as(TokenTag, self.peek()));
        if (self.check(toktag)) {
            return self.advance();
        }
        unreachable;
    }

    fn expect_delimit(self: *Parser) Token {
        std.debug.assert(.Delimit == @as(TokenTag, self.peek()) or .Eof == @as(TokenTag, self.peek()));
        if (self.check(.Delimit) or self.check(.Eof)) {
            return self.advance();
        }
        unreachable;
    }

    /// Consumes token if it matches
    fn match(self: *Parser, toktag: TokenTag) bool {
        if (@as(TokenTag, self.peek()) == toktag) {
            _ = self.advance();
            return true;
        }
        return false;
    }

    fn match_any(self: *Parser, comptime toktags: []const TokenTag) bool {
        const peeked = @as(TokenTag, self.peek());
        inline for (toktags) |tag| {
            if (peeked == tag) {
                _ = self.advance();
                return true;
            }
        }
        return false;
    }

    fn check(self: *Parser, toktag: TokenTag) bool {
        return @as(TokenTag, self.peek()) == @as(TokenTag, toktag);
    }

    fn peek(self: *Parser) Token {
        return self.tokens[self.current];
    }

    fn peek_n(self: *Parser, n: u32) Token {
        if (self.current + n >= self.tokens.len) {
            return self.tokens[self.tokens.len - 1];
        }

        return self.tokens[self.current + n];
    }

    fn prev(self: *Parser) Token {
        return self.tokens[self.current - 1];
    }

    fn add_error(self: *Parser, comptime fmt: []const u8, args: anytype) !void {
        const error_msg = try std.fmt.allocPrint(self.alloc, fmt, args);
        try self.errors.append(.{ .msg = error_msg });
    }
};

pub const TokenTag = enum {
    Pipe,
    DoublePipe,
    Ampersand,
    DoubleAmpersand,
    Redirect,
    Dollar,
    Asterisk,
    DoubleAsterisk,
    Eq,
    Semicolon,
    BraceBegin,
    Comma,
    BraceEnd,
    CmdSubstBegin,
    CmdSubstEnd,
    Var,
    Text,
    JSObjRef,
    Delimit,
    Eof,
};

pub const Token = union(TokenTag) {
    // |
    Pipe,
    // ||
    DoublePipe,
    // &
    Ampersand,
    // &&
    DoubleAmpersand,

    Redirect: AST.Cmd.RedirectFlags,

    // $
    Dollar,
    // *
    Asterisk,
    DoubleAsterisk,

    // =
    Eq,
    // ;
    Semicolon,

    BraceBegin,
    Comma,
    BraceEnd,
    CmdSubstBegin,
    CmdSubstEnd,

    Var: TextRange,
    Text: TextRange,
    JSObjRef: u32,

    Delimit,
    Eof,

    pub const TextRange = struct {
        start: u32,
        end: u32,
    };

    pub fn debug(self: Token, buf: []const u8) void {
        switch (self) {
            .Var => |txt| {
                std.debug.print("(var) {s}\n", .{buf[txt.start..txt.end]});
            },
            .Text => |txt| {
                std.debug.print("(txt) {s}\n", .{buf[txt.start..txt.end]});
            },
            else => {
                std.debug.print("{s}\n", .{@tagName(self)});
            },
        }
    }
};

pub const LexerAscii = NewLexer(.ascii);
pub const LexerUnicode = NewLexer(.wtf8);
pub const LexResult = struct {
    tokens: []const Token,
    strpool: []const u8,
};
pub const LEX_JS_OBJREF_PREFIX = "$__bun_";

pub fn NewLexer(comptime encoding: StringEncoding) type {
    const Chars = ShellCharIter(encoding);
    return struct {
        chars: Chars,

        /// Tell us the beginning of a "word", indexes into the string pool (`buf`)
        /// Anytime a word is added, this needs to be updated
        word_start: u32 = 0,

        /// Keeps track of the end of a "word", indexes into the string pool (`buf`),
        /// anytime characters are added to the string pool this needs to be updated
        j: u32 = 0,

        strpool: ArrayList(u8),
        tokens: ArrayList(Token),
        delimit_quote: bool = false,
        in_cmd_subst: ?CmdSubstKind = null,
        errors: std.ArrayList(Error),

        const CmdSubstKind = enum { backtick, dollar };

        const LexerError = error{
            Unexpected,
            OutOfMemory,
            Utf8CannotEncodeSurrogateHalf,
            Utf8InvalidStartByte,
            CodepointTooLarge,
        };
        const Error = struct {
            msg: []const u8,
        };

        pub const js_objref_prefix = "$__bun_";

        const State = Chars.State;

        const InputChar = Chars.InputChar;

        const BacktrackSnapshot = struct {
            chars: Chars,
            j: u32,
            word_start: u32,
            delimit_quote: bool,
        };

        pub fn new(alloc: Allocator, src: []const u8) @This() {
            return .{
                .chars = Chars.init(src),
                .tokens = ArrayList(Token).init(alloc),
                .strpool = ArrayList(u8).init(alloc),
                .errors = ArrayList(Error).init(alloc),
            };
        }

        pub fn get_result(self: @This()) LexResult {
            return .{
                .tokens = self.tokens.items[0..],
                .strpool = self.strpool.items[0..],
            };
        }

        fn make_sublexer(self: *@This(), kind: CmdSubstKind) @This() {
            var sublexer = .{
                .chars = self.chars,
                .strpool = self.strpool,
                .tokens = self.tokens,
                .errors = self.errors,
                .in_cmd_subst = kind,

                .word_start = self.word_start,
                .j = self.j,
            };
            return sublexer;
        }

        fn continue_from_sublexer(self: *@This(), sublexer: *@This()) void {
            self.strpool = sublexer.strpool;
            self.tokens = sublexer.tokens;
            self.errors = sublexer.errors;

            self.chars = sublexer.chars;
            self.word_start = sublexer.word_start;
            self.j = sublexer.j;
            self.delimit_quote = sublexer.delimit_quote;
        }

        fn make_snapshot(self: *@This()) BacktrackSnapshot {
            return .{
                .chars = self.chars,
                .j = self.j,
                .word_start = self.word_start,
                .delimit_quote = self.delimit_quote,
            };
        }

        fn backtrack(self: *@This(), snap: BacktrackSnapshot) void {
            self.chars = snap.chars;
            self.j = snap.j;
            self.word_start = snap.word_start;
            self.delimit_quote = snap.delimit_quote;
        }

        fn last_tok_tag(self: *@This()) ?TokenTag {
            if (self.tokens.items.len == 0) return null;
            return @as(TokenTag, self.tokens.items[self.tokens.items.len - 1]);
        }

        pub fn lex(self: *@This()) LexerError!void {
            while (true) {
                const input = self.eat() orelse {
                    try self.break_word(true);
                    break;
                };
                const char = input.char;
                const escaped = input.escaped;

                // Handle non-escaped chars:
                // 1. special syntax (operators, etc.)
                // 2. lexing state switchers (quotes)
                // 3. word breakers (spaces, etc.)
                if (!escaped) escaped: {
                    switch (char) {
                        ';' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);
                            try self.tokens.append(.Semicolon);
                            continue;
                        },

                        // glob asterisks
                        '*' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            if (self.peek()) |next| {
                                if (!next.escaped and next.char == '*') {
                                    _ = self.eat();
                                    try self.break_word(false);
                                    try self.tokens.append(.DoubleAsterisk);
                                    continue;
                                }
                            }
                            try self.break_word(false);
                            try self.tokens.append(.Asterisk);
                            continue;
                        },

                        // brace expansion syntax
                        '{' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(false);
                            try self.tokens.append(.BraceBegin);
                            continue;
                        },
                        ',' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(false);
                            try self.tokens.append(.Comma);
                            continue;
                        },
                        '}' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(false);
                            try self.tokens.append(.BraceEnd);
                            continue;
                        },

                        // Command substitution
                        '`' => {
                            if (self.in_cmd_subst == .backtick) {
                                try self.break_word(true);
                                if (self.last_tok_tag()) |toktag| {
                                    if (toktag != .Delimit) try self.tokens.append(.Delimit);
                                }
                                try self.tokens.append(.CmdSubstEnd);
                                return;
                            } else {
                                try self.eat_cmd_subst(.backtick);
                            }
                        },
                        // Command substitution/vars
                        '$' => {
                            if (self.chars.state == .Single) break :escaped;

                            const peeked = self.peek() orelse InputChar{ .char = 0 };
                            if (!peeked.escaped and peeked.char == '(') {
                                try self.eat_cmd_subst(.dollar);
                                continue;
                            }

                            // Handle variable
                            try self.break_word(false);
                            if (self.eat_js_obj_ref()) |ref| {
                                if (self.chars.state == .Double) {
                                    try self.errors.append(.{ .msg = "JS object reference not allowed in double quotes" });
                                    return LexerError.Unexpected;
                                }
                                try self.tokens.append(ref);
                            } else {
                                const var_tok = try self.eat_var();
                                try self.tokens.append(.{ .Var = var_tok });
                            }
                            self.word_start = self.j;
                            continue;
                        },
                        ')' => {
                            if (self.in_cmd_subst != .dollar) {
                                if (self.chars.state != .Normal) break :escaped;
                                @panic("Unexpected ')'");
                            }

                            try self.break_word(true);
                            if (self.last_tok_tag()) |toktag| {
                                if (toktag != .Delimit) try self.tokens.append(.Delimit);
                            }
                            try self.tokens.append(.CmdSubstEnd);
                            return;
                        },

                        '0'...'9' => {
                            if (self.chars.state != .Normal) break :escaped;
                            const snapshot = self.make_snapshot();
                            if (self.eat_redirect(input)) |redirect| {
                                try self.break_word(true);
                                try self.tokens.append(.{ .Redirect = redirect });
                                continue;
                            }
                            self.backtrack(snapshot);
                            break :escaped;
                        },

                        // Operators
                        '|' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);

                            const next = self.peek() orelse @panic("Unexpected EOF");
                            if (next.escaped or next.char != '|') {
                                try self.tokens.append(.Pipe);
                            } else if (next.char == '|') {
                                _ = self.eat() orelse unreachable;
                                try self.tokens.append(.DoublePipe);
                            }
                            continue;
                        },
                        '>' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);
                            const redirect = self.eat_simple_redirect();
                            try self.tokens.append(.{ .Redirect = redirect });
                            continue;
                        },
                        '&' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);

                            const next = self.peek() orelse @panic("Unexpected EOF");
                            if (next.char == '>' and !next.escaped) {
                                _ = self.eat();
                                const inner = if (self.eat_simple_redirect_operator())
                                    AST.Cmd.RedirectFlags.@"&>>"()
                                else
                                    AST.Cmd.RedirectFlags.@"&>"();
                                try self.tokens.append(.{ .Redirect = inner });
                            } else if (next.escaped or next.char != '&') {
                                try self.tokens.append(.Ampersand);
                            } else if (next.char == '&') {
                                _ = self.eat() orelse unreachable;
                                try self.tokens.append(.DoubleAmpersand);
                            } else continue;
                        },

                        // 2. State switchers
                        '\'' => {
                            if (self.chars.state == .Single) {
                                self.chars.state = .Normal;
                                continue;
                            }
                            if (self.chars.state == .Normal) {
                                self.chars.state = .Single;
                                continue;
                            }
                            break :escaped;
                        },
                        '"' => {
                            if (self.chars.state == .Single) break :escaped;
                            if (self.chars.state == .Normal) {
                                try self.break_word(false);
                                self.chars.state = .Double;
                            } else if (self.chars.state == .Double) {
                                try self.break_word(false);
                                // self.delimit_quote = true;
                                self.chars.state = .Normal;
                            }
                            continue;
                        },

                        // 3. Word breakers
                        ' ' => {
                            if (self.chars.state == .Normal) {
                                try self.break_word_impl(true, true);
                                continue;
                            }
                            break :escaped;
                        },

                        else => break :escaped,
                    }
                    continue;
                }

                try self.appendCharToStrPool(char);
            }

            if (self.in_cmd_subst != null) {
                @panic("Unclosed command substitution");
            }

            try self.tokens.append(.Eof);
        }

        fn appendCharToStrPool(self: *@This(), char: Chars.CodepointType) !void {
            if (comptime encoding == .ascii) {
                try self.strpool.append(char);
                self.j += 1;
            } else {
                if (char <= 0x7F) {
                    try self.strpool.append(@intCast(char));
                    self.j += 1;
                    return;
                }
                const char_len = try std.unicode.utf8CodepointSequenceLength(@intCast(char));
                const start = self.strpool.items.len;
                const end = start + char_len;
                try self.strpool.appendNTimes(0, char_len);
                var slice = self.strpool.items[start..end];
                const n = try std.unicode.utf8Encode(@intCast(char), slice);
                if (bun.Environment.allow_assert) {
                    std.debug.assert(n == char_len);
                }
                self.j += char_len;
            }
        }

        fn break_word(self: *@This(), add_delimiter: bool) !void {
            return try self.break_word_impl(add_delimiter, false);
        }

        fn break_word_impl(self: *@This(), add_delimiter: bool, in_normal_space: bool) !void {
            const start: u32 = self.word_start;
            const end: u32 = self.j;
            if (start != end) {
                try self.tokens.append(.{ .Text = .{ .start = start, .end = end } });
                if (add_delimiter) {
                    try self.tokens.append(.Delimit);
                }
            } else if (in_normal_space and self.tokens.items.len > 0 and
                switch (self.tokens.items[self.tokens.items.len - 1]) {
                .Var, .Text, .BraceBegin, .Comma, .BraceEnd, .CmdSubstEnd => true,
                else => false,
            }) {
                try self.tokens.append(.Delimit);
                self.delimit_quote = false;
            }
            self.word_start = self.j;
        }

        fn eat_simple_redirect(self: *@This()) AST.Cmd.RedirectFlags {
            return if (self.eat_simple_redirect_operator())
                AST.Cmd.RedirectFlags.@">>"()
            else
                AST.Cmd.RedirectFlags.@">"();
        }

        fn eat_simple_redirect_operator(self: *@This()) bool {
            if (self.peek()) |peeked| {
                if (peeked.escaped) return false;
                switch (peeked.char) {
                    '>' => {
                        _ = self.eat();
                        return true;
                    },
                    else => return false,
                }
            }
            return false;
        }

        fn eat_redirect(self: *@This(), first: InputChar) ?AST.Cmd.RedirectFlags {
            var flags: AST.Cmd.RedirectFlags = .{};
            switch (first.char) {
                '0'...'9' => {
                    // Codepoint int casts are safe here because the digits are in the ASCII range
                    var count: usize = 1;
                    var buf: [32]u8 = [_]u8{@intCast(first.char)} ** 32;

                    while (self.peek()) |peeked| {
                        const char = peeked.char;
                        switch (char) {
                            '0'...'9' => {
                                _ = self.eat();
                                buf[count] = @intCast(char);
                                count += 1;
                                continue;
                            },
                            else => break,
                        }
                    }

                    var num = std.fmt.parseInt(usize, buf[0..count], 10) catch {
                        // This means the number was really large, meaning it
                        // probably was supposed to be a string
                        return null;
                    };

                    switch (num) {
                        0 => {
                            flags.stdin = true;
                        },
                        1 => {
                            flags.stdout = true;
                        },
                        2 => {
                            flags.stderr = true;
                        },
                        else => {
                            // FIXME support redirection to any arbitrary fd
                            log("redirection to fd {d} is invalid\n", .{num});
                            return null;
                        },
                    }
                },
                '&' => {
                    if (first.escaped) return null;
                    flags.stdout = true;
                    flags.stderr = true;
                    _ = self.eat();
                },
                else => return null,
            }

            if (self.peek()) |input| {
                if (input.escaped or input.char != '>') return null;
                _ = self.eat();
            }

            if (self.eat_simple_redirect_operator()) {
                flags.append = true;
            }
            return flags;
        }

        /// Assumes the first character of the literal has been eaten
        /// Backtracks and returns false if unsuccessful
        fn eat_literal(self: *@This(), comptime CodepointType: type, comptime literal: []const CodepointType) bool {
            const literal_skip_first = literal[1..];
            const snapshot = self.make_snapshot();
            const slice = self.eat_slice(CodepointType, literal_skip_first.len) orelse {
                self.backtrack(snapshot);
                return false;
            };

            if (std.mem.eql(CodepointType, &slice, literal_skip_first))
                return true;

            self.backtrack(snapshot);
            return false;
        }

        fn eat_number_word(self: *@This()) ?usize {
            const snap = self.make_snapshot();
            var count: usize = 0;
            var buf: [32]u8 = [_]u8{0} ** 32;

            while (self.eat()) |result| {
                const char = result.char;
                switch (char) {
                    '0'...'9' => {
                        // Safe to cast here because 0-8 is in ASCII range
                        buf[count] = @intCast(char);
                        count += 1;
                        continue;
                    },
                    else => {
                        break;
                    },
                }
            }

            if (count == 0) {
                self.backtrack(snap);
                return null;
            }

            var num = std.fmt.parseInt(usize, buf[0..count], 10) catch {
                self.backtrack(snap);
                return null;
            };

            return num;
        }

        fn eat_cmd_subst(self: *@This(), kind: CmdSubstKind) !void {
            if (kind == .dollar) {
                _ = self.eat();
            }
            try self.tokens.append(.CmdSubstBegin);
            var sublexer = self.make_sublexer(kind);
            try sublexer.lex();
            self.continue_from_sublexer(&sublexer);
        }

        fn eat_js_obj_ref(self: *@This()) ?Token {
            const snap = self.make_snapshot();
            if (self.eat_literal(u8, LEX_JS_OBJREF_PREFIX)) {
                if (self.eat_number_word()) |num| {
                    if (num <= std.math.maxInt(u32)) {
                        return .{ .JSObjRef = @intCast(num) };
                    }
                }
            }
            self.backtrack(snap);
            return null;
        }

        fn eat_var(self: *@This()) !Token.TextRange {
            const start = self.j;
            // Eat until special character
            while (self.peek()) |result| {
                const char = result.char;
                const escaped = result.escaped;

                switch (char) {
                    '{', '}', ';', '\'', '\"', ' ', '|', '&', '>', ',' => {
                        return .{ .start = start, .end = self.j };
                    },
                    else => {
                        if (!escaped and
                            (self.in_cmd_subst == .dollar and char == ')') or (self.in_cmd_subst == .backtick and char == '`'))
                        {
                            return .{ .start = start, .end = self.j };
                        }
                        _ = self.eat() orelse unreachable;
                        try self.appendCharToStrPool(char);
                    },
                }
            }
            return .{ .start = start, .end = self.j };
        }

        fn eat(self: *@This()) ?InputChar {
            return self.chars.eat();
        }

        fn eat_slice(self: *@This(), comptime CodepointType: type, comptime N: usize) ?[N]CodepointType {
            var slice = [_]CodepointType{0} ** N;
            var i: usize = 0;
            while (self.peek()) |result| {
                // If we passed in codepoint range that is equal to the source
                // string, or is greater than the codepoint range of source string than an int cast
                // will not panic
                if (CodepointType == Chars.CodepointType or std.math.maxInt(CodepointType) >= std.math.maxInt(Chars.CodepointType)) {
                    slice[i] = @intCast(result.char);
                } else {
                    // Otherwise the codepoint range is smaller than the source, so we need to check that the chars are valid
                    if (result.char > std.math.maxInt(CodepointType)) {
                        return null;
                    }
                    slice[i] = @intCast(result.char);
                }

                i += 1;
                _ = self.eat();
                if (i == N) {
                    return slice;
                }
            }

            return null;
        }

        fn peek(self: *@This()) ?InputChar {
            return self.chars.peek();
        }

        fn read_char(self: *@This()) ?InputChar {
            return self.chars.read_char();
        }

        fn debug_tokens(self: *const @This()) void {
            std.debug.print("Tokens: \n", .{});
            for (self.tokens.items, 0..) |tok, i| {
                std.debug.print("{d}: ", .{i});
                tok.debug(self.strpool.items[0..self.strpool.items.len]);
            }
        }
    };
}

pub const StringEncoding = enum { ascii, wtf8, utf16 };

const SrcAscii = struct {
    bytes: []const u8,
    i: usize,

    const IndexValue = packed struct {
        char: u7,
        escaped: bool = false,
    };

    fn init(bytes: []const u8) SrcAscii {
        return .{
            .bytes = bytes,
            .i = 0,
        };
    }

    inline fn index(this: *const SrcAscii) ?IndexValue {
        if (this.i >= this.bytes.len) return null;
        return .{ .char = @intCast(this.bytes[this.i]) };
    }

    inline fn indexNext(this: *const SrcAscii) ?IndexValue {
        if (this.i + 1 >= this.bytes.len) return null;
        return .{ .char = @intCast(this.bytes[this.i + 1]) };
    }

    inline fn eat(this: *SrcAscii, escaped: bool) void {
        this.i += 1 + @as(u32, @intFromBool(escaped));
    }
};

const SrcUnicode = struct {
    iter: CodepointIterator,
    cursor: CodepointIterator.Cursor,
    next_cursor: CodepointIterator.Cursor,

    const IndexValue = packed struct {
        char: u29,
        width: u3 = 0,
    };

    fn nextCursor(iter: *const CodepointIterator, cursor: *CodepointIterator.Cursor) void {
        if (!iter.next(cursor)) {
            // This will make `i > sourceBytes.len` so the condition in `index` will fail
            cursor.i = @intCast(iter.bytes.len + 1);
            cursor.width = 1;
            cursor.c = CodepointIterator.ZeroValue;
        }
    }

    fn init(bytes: []const u8) SrcUnicode {
        var iter = CodepointIterator.init(bytes);
        var cursor = CodepointIterator.Cursor{};
        nextCursor(&iter, &cursor);
        var next_cursor: CodepointIterator.Cursor = cursor;
        nextCursor(&iter, &next_cursor);
        return .{ .iter = iter, .cursor = cursor, .next_cursor = next_cursor };
    }

    inline fn index(this: *const SrcUnicode) ?IndexValue {
        if (this.cursor.width + this.cursor.i > this.iter.bytes.len) return null;
        return .{ .char = this.cursor.c, .width = this.cursor.width };
    }

    inline fn indexNext(this: *const SrcUnicode) ?IndexValue {
        if (this.next_cursor.width + this.next_cursor.i > this.iter.bytes.len) return null;
        return .{ .char = this.next_cursor.c, .width = this.next_cursor.width };
    }

    inline fn eat(this: *SrcUnicode, escaped: bool) void {
        // eat two codepoints
        if (escaped) {
            nextCursor(&this.iter, &this.next_cursor);
            this.cursor = this.next_cursor;
            nextCursor(&this.iter, &this.next_cursor);
        } else {
            // eat one codepoint
            this.cursor = this.next_cursor;
            nextCursor(&this.iter, &this.next_cursor);
        }
    }
};

pub fn ShellCharIter(comptime encoding: StringEncoding) type {
    return struct {
        src: Src,
        state: State = .Normal,

        pub const Src = switch (encoding) {
            .ascii => SrcAscii,
            .wtf8, .utf16 => SrcUnicode,
        };

        pub const CodepointType = if (encoding == .ascii) u7 else u32;

        pub const InputChar = if (encoding == .ascii) SrcAscii.IndexValue else struct {
            char: u32,
            escaped: bool = false,
        };

        pub const State = enum {
            Normal,
            Single,
            Double,
        };

        pub fn codepointByteLength(cp: CodepointType) !u3 {
            if (comptime encoding == .ascii) return 1;
            return try std.unicode.utfCodepointByteLength(@intCast(cp));
        }

        pub fn encodeCodepoint(cp: CodepointType, buf: []u8) !void {
            if (comptime encoding == .ascii) {
                buf[0] = cp;
                return;
            }
            return try std.unicode.utf8Encode(@intCast(cp), buf);
        }

        pub fn encodeCodepointStack(cp: CodepointType, buf: *[4]u8) ![]u8 {
            const this = comptime @This();
            const len = this.codepointByteLength(cp);
            try this.encodeCodepoint(cp, buf[0..len]);
            return buf[0..len];
        }

        pub fn init(bytes: []const u8) @This() {
            const src = if (comptime encoding == .ascii)
                SrcAscii.init(bytes)
            else
                SrcUnicode.init(bytes);

            return .{
                .src = src,
            };
        }

        pub fn eat(self: *@This()) ?InputChar {
            if (self.read_char()) |result| {
                self.src.eat(result.escaped);
                return result;
            }
            return null;
        }

        pub fn peek(self: *@This()) ?InputChar {
            if (self.read_char()) |result| {
                return result;
            }

            return null;
        }

        pub fn read_char(self: *@This()) ?InputChar {
            const indexed_value = self.src.index() orelse return null;
            var char = indexed_value.char;
            if (char != '\\' or self.state == .Single) return .{ .char = char };

            // Handle backslash
            switch (self.state) {
                .Normal => {
                    const peeked = self.src.indexNext() orelse return null;
                    char = peeked.char;
                },
                .Double => {
                    const peeked = self.src.indexNext() orelse return null;
                    switch (peeked.char) {
                        // Backslash only applies to these characters
                        '$', '`', '"', '\\', '\n' => {
                            char = peeked.char;
                        },
                        else => return .{ .char = char, .escaped = false },
                    }
                },
                else => unreachable,
            }

            return .{ .char = char, .escaped = true };
        }
    };
}

pub fn escape(string: []const u8, out: *std.ArrayList(u8)) !void {
    try out.append("\"");

    try escapeAsciiSlow(string, out);

    try out.append("\"");
}

fn escapeUnicodeSlow(string: []const u8, out: *std.ArrayList(u8)) !void {
    var iter = CodepointIterator.init(string);
    var cursor = CodepointIterator.Cursor{};
    while (iter.next(&cursor)) {
        const char = cursor.c;
        switch (char) {
            // if slash, slash the slash to escape it
            '\\' => try out.appendSlice("\\\\"),
            // escape the double quote
            '"' => try out.appendSlice("\\\""),
            '$' => try out.appendSlice("\\$"),
            '`' => try out.appendSlice("\\`"),
            else => try out.append(char),
        }
    }
}

fn escapeAsciiSlow(string: []const u8, out: *std.ArrayList(u8)) !void {
    for (string) |char| {
        switch (char) {
            // if slash, slash the slash to escape it
            '\\' => try out.appendSlice("\\\\"),
            // escape the double quote
            '"' => try out.appendSlice("\\\""),
            '$' => try out.appendSlice("\\$"),
            '`' => try out.appendSlice("\\`"),
            else => try out.append(char),
        }
    }
}

// fn isValidGlobPattern(potential_pattern: []const u8) bool {

// }

/// Only these charaters allowed:
/// - a-ZA-Z
/// - _
/// - 0-9 (but can't be first char)
fn isValidVarName(var_name: []const u8) bool {
    if (isAllAscii(var_name)) return isValidVarNameAscii(var_name);

    if (var_name.len == 0) return false;
    var iter = CodepointIterator.init(var_name);
    var cursor = CodepointIterator.Cursor{};

    if (!iter.next(&cursor)) return false;

    switch (cursor.c) {
        '=', '0'...'9' => {
            return false;
        },
        'a'...'z', 'A'...'Z', '_' => {},
        else => return false,
    }

    while (iter.next(&cursor)) {
        switch (cursor.c) {
            '0'...'9', 'a'...'z', 'A'...'Z', '_' => {},
            else => return false,
        }
    }

    return true;
}
fn isValidVarNameAscii(var_name: []const u8) bool {
    if (var_name.len == 0) return false;
    switch (var_name[0]) {
        '=', '0'...'9' => {
            return false;
        },
        'a'...'z', 'A'...'Z', '_' => {},
        else => return false,
    }

    if (var_name.len - 1 < 16)
        return isValidVarNameSlowAscii(var_name);

    const upper_a: @Vector(16, u8) = @splat('A');
    const upper_z: @Vector(16, u8) = @splat('Z');
    const lower_a: @Vector(16, u8) = @splat('a');
    const lower_z: @Vector(16, u8) = @splat('z');
    const zero: @Vector(16, u8) = @splat(0);
    const nine: @Vector(16, u8) = @splat(9);
    const underscore: @Vector(16, u8) = @splat('_');

    const BoolVec = @Vector(16, u1);

    var i: usize = 0;
    while (i + 16 <= var_name.len) : (i += 16) {
        const chars: @Vector(16, u8) = var_name[i..][0..16].*;

        const in_upper = @as(BoolVec, @bitCast(chars > upper_a)) & @as(BoolVec, @bitCast(chars < upper_z));
        const in_lower = @as(BoolVec, @bitCast(chars > lower_a)) & @as(BoolVec, @bitCast(chars < lower_z));
        const in_digit = @as(BoolVec, @bitCast(chars > zero)) & @as(BoolVec, @bitCast(chars < nine));
        const is_underscore = @as(BoolVec, @bitCast(chars == underscore));

        const merged = @as(@Vector(16, bool), @bitCast(in_upper | in_lower | in_digit | is_underscore));
        if (std.simd.countTrues(merged) != 16) return false;
    }

    return isValidVarNameSlowAscii(var_name[i..]);
}

fn isValidVarNameSlowAscii(var_name: []const u8) bool {
    for (var_name) |c| {
        switch (c) {
            '0'...'9', 'a'...'z', 'A'...'Z', '_' => {},
            else => return false,
        }
    }
    return true;
}

var stderr_mutex = std.Thread.Mutex{};
fn closefd(fd: bun.FileDescriptor) void {
    if (Syscall.close2(fd)) |err| {
        _ = err;
        log("ERR closefd: {d}\n", .{fd});
        // stderr_mutex.lock();
        // defer stderr_mutex.unlock();
        // const stderr = std.io.getStdErr().writer();
        // err.toSystemError().format("error", .{}, stderr) catch @panic("damn");
    }
}

pub fn hasEqSign(str: []const u8) ?u32 {
    if (isAllAscii(str)) {
        if (str.len < 16)
            return hasEqSignAsciiSlow(str);

        const needles: @Vector(16, u8) = @splat('=');

        var i: u32 = 0;
        while (i + 16 <= str.len) : (i += 16) {
            const haystack = str[i..][0..16].*;
            const result = haystack == needles;

            if (std.simd.firstTrue(result)) |idx| {
                return @intCast(i + idx);
            }
        }

        return i + (hasEqSignAsciiSlow(str[i..]) orelse return null);
    }

    // TODO actually i think that this can also use the simd stuff

    var iter = CodepointIterator.init(str);
    var cursor = CodepointIterator.Cursor{};
    while (iter.next(&cursor)) {
        if (cursor.c == '=') {
            return @intCast(cursor.i);
        }
    }

    return null;
}

pub fn hasEqSignAsciiSlow(str: []const u8) ?u32 {
    for (str, 0..) |c, i| if (c == '=') return @intCast(i);
    return null;
}

const MaybeManyStrings = union {
    one: [:0]const u8,
    many: std.ArrayList([:0]const u8),
};

const CmdEnvIter = struct {
    env: *const std.StringArrayHashMap([:0]const u8),
    iter: std.StringArrayHashMap([:0]const u8).Iterator,

    const Entry = struct {
        key: Key,
        value: Value,
    };

    const Value = struct {
        val: [:0]const u8,

        pub fn format(self: Value, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.writeAll(self.val);
        }
    };

    const Key = struct {
        val: []const u8,

        pub fn format(self: Key, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.writeAll(self.val);
        }

        pub fn eqlComptime(this: Key, comptime str: []const u8) bool {
            return bun.strings.eqlComptime(this.val, str);
        }
    };

    pub fn fromEnv(env: *const std.StringArrayHashMap([:0]const u8)) CmdEnvIter {
        var iter = env.iterator();
        return .{
            .env = env,
            .iter = iter,
        };
    }

    pub fn len(self: *const CmdEnvIter) usize {
        return self.env.unmanaged.entries.len;
    }

    pub fn next(self: *CmdEnvIter) !?Entry {
        const entry = self.iter.next() orelse return null;
        return .{
            .key = .{ .val = entry.key_ptr.* },
            .value = .{ .val = entry.value_ptr.* },
        };
    }
};

pub const Rm = struct {
    const Builtin = Interpreter.Builtin;
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

        var dir = std.fs.Dir{ .fd = bun.fdcast(dir_fd) };
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

const ExpansionStr = union(enum) {};

/// In bash vars can further be expanded if they contain glob syntax
///
/// glob syntax:
/// -     `?` matches any single character
/// -     `*` matches any sequence of characters
/// -    `**` matches any sequence of characters, including slashes
/// -  `[ab]` matches a or b
/// - `[a-z]` matches any character between a and z
/// -     `!` negates the pattern
///
/// So the special tokens:
/// `?, *, **, [, ], !`
const VarExpansionStr = struct {};

pub const Test = struct {
    pub const TestToken = union(TokenTag) {
        // |
        Pipe,
        // ||
        DoublePipe,
        // &
        Ampersand,
        // &&
        DoubleAmpersand,

        // >
        Redirect: AST.Cmd.RedirectFlags,

        // $
        Dollar,
        // *
        Asterisk,
        DoubleAsterisk,
        // =
        Eq,
        Semicolon,

        BraceBegin,
        Comma,
        BraceEnd,
        CmdSubstBegin,
        CmdSubstEnd,

        Var: []const u8,
        Text: []const u8,
        JSObjRef: u32,

        Delimit,
        Eof,

        pub fn from_real(the_token: Token, buf: []const u8) TestToken {
            switch (the_token) {
                .Var => |txt| return .{ .Var = buf[txt.start..txt.end] },
                .Text => |txt| return .{ .Text = buf[txt.start..txt.end] },
                .JSObjRef => |val| return .{ .JSObjRef = val },
                .Pipe => return .Pipe,
                .DoublePipe => return .DoublePipe,
                .Ampersand => return .Ampersand,
                .DoubleAmpersand => return .DoubleAmpersand,
                .Redirect => |r| return .{ .Redirect = r },
                .Dollar => return .Dollar,
                .Asterisk => return .Asterisk,
                .DoubleAsterisk => return .DoubleAsterisk,
                .Eq => return .Eq,
                .Semicolon => return .Semicolon,
                .BraceBegin => return .BraceBegin,
                .Comma => return .Comma,
                .BraceEnd => return .BraceEnd,
                .CmdSubstBegin => return .CmdSubstBegin,
                .CmdSubstEnd => return .CmdSubstEnd,
                .Delimit => return .Delimit,
                .Eof => return .Eof,
            }
        }
    };
};
