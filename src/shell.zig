const bun = @import("root").bun;
const std = @import("std");
const builtin = @import("builtin");
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;
const Subprocess =
    @import("./bun.js/api/bun/subprocess.zig").Subprocess;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const Which = @import("./which.zig");

pub const ShellError = error{Process};
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

fn closefd(fd: bun.FileDescriptor) void {
    if (fd == bun.STDOUT_FD or fd == bun.STDERR_FD or fd == bun.STDIN_FD) {
        logsys("close({d}) SKIPPED", .{fd});
        return;
    }
    logsys("close({d})", .{fd});
    std.os.close(fd);
}

// FIXME avoid std.os if possible
// FIXME error when command not found needs to be handled gracefully
pub const Interpreter = struct {
    pub const ast = AST;
    arena: *bun.ArenaAllocator,
    allocator: Allocator,
    env: std.StringArrayHashMap([:0]const u8),
    cmd_local_env: std.StringArrayHashMap([:0]const u8),
    globalThis: *JSC.JSGlobalObject,
    jsobjs: []JSValue,

    const IO = struct {
        stdin: bun.FileDescriptor,
        stdout: bun.FileDescriptor,
        stderr: bun.FileDescriptor,
    };

    const Exec = union(enum) {
        subproc: std.ChildProcess,
        echo,
        cd,
    };

    pub fn new(arena: *bun.ArenaAllocator, globalThis: *JSC.JSGlobalObject, jsobjs: []JSValue) Interpreter {
        const allocator = arena.allocator();
        return .{
            .arena = arena,
            .allocator = allocator,
            .env = std.StringArrayHashMap([:0]const u8).init(allocator),
            .cmd_local_env = std.StringArrayHashMap([:0]const u8).init(allocator),
            .globalThis = globalThis,
            .jsobjs = jsobjs,
        };
    }

    pub fn interpret(self: *Interpreter, script: ast.Script) anyerror!void {
        var stdio = .{
            .stdin = bun.STDIN_FD,
            .stdout = bun.STDOUT_FD,
            .stderr = bun.STDERR_FD,
        };
        for (script.stmts) |*stmt| {
            for (stmt.exprs) |*expr| {
                _ = try self.interpret_expr(expr, &stdio);
            }
        }
    }

    fn interpret_expr(
        self: *Interpreter,
        expr: *const ast.Expr,
        io: *IO,
    ) anyerror!bool {
        switch (expr.*) {
            .assign => |assigns| {
                for (assigns) |*assign| {
                    try self.interpret_assign(assign);
                }
                return true;
            },
            .cond => |cond| return try self.interpret_cond(&cond.left, &cond.right, cond.op, io),
            .pipeline => |pipeline| return try self.interpret_pipeline(pipeline, io),
            .cmd => |cmd| return try self.interpret_cmd(cmd, io),
        }
    }

    fn interpret_assign(self: *Interpreter, assign: *const ast.Assign) anyerror!void {
        const value = try self.eval_atom(&assign.value);
        if (assign.exported) {
            try self.env.put(assign.label, value);
        } else {
            try self.cmd_local_env.put(assign.label, value);
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

    // fn interpret_pipeline(self: *Interpreter, pipeline: *const ast.Pipeline, io: *IO) !void {
    //     _ = io;
    //     _ = pipeline;
    //     _ = self;
    // }

    // FIXME handle closing child processes properly
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
        var cmd_procs = try self.allocator.alloc(*Subprocess, cmd_count);
        errdefer {
            for (0..cmd_procs_set_amount) |i| {
                cmd_procs[i].unref(true);
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

                var cmd_io = IO{
                    .stdin = file_to_read_from,
                    .stdout = file_to_write_to,
                    .stderr = io.stderr,
                };
                log("Spawn: proc_idx={d} stdin={d} stdout={d} stderr={d}\n", .{ i, file_to_read_from, file_to_write_to, io.stderr });

                var cmd_proc = try self.init_cmd(cmd, &cmd_io);
                closefd(cmd_io.stdin);
                closefd(cmd_io.stdout);

                cmd_procs[i] = cmd_proc;
                i += 1;
                cmd_procs_set_amount += 1;
            }
        }

        var jsc_vm = self.globalThis.bunVM();

        var fail_idx: ?u32 = null;
        for (cmd_procs, 0..) |subprocess, i| {
            log("Wait {d}", .{i});
            defer subprocess.unref(true);

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
            const result = subprocess.exit_code orelse 1;
            if (result != 0 and i < cmd_count - 1) {
                fail_idx = @intCast(i);
                break;
            }
        }

        if (fail_idx) |idx| {
            for (cmd_procs[idx..]) |proc| {
                proc.unref(true);
                switch (proc.tryKill(9)) {
                    .err => |err| {
                        _ = err;
                        @panic("HANDLE THIS ERRROR");
                    },
                    else => {},
                }
            }
            return false;
        }
        return true;
    }

    // cmd1 -> cmd2 -> cmd3
    fn pipeline_file_to_write(pipes: []Pipe, proc_idx: usize, cmd_count: usize, io: *IO) bun.FileDescriptor {
        if (proc_idx == cmd_count - 1) return io.stdout;
        return pipes[proc_idx][1];
    }

    fn pipeline_file_to_read(pipes: []Pipe, proc_idx: usize, io: *IO) bun.FileDescriptor {
        if (proc_idx == 0) return io.stdin;
        return pipes[proc_idx - 1][0];
    }

    fn init_cmd(self: *Interpreter, cmd: *const ast.Cmd, io: *IO) !*Subprocess {
        self.cmd_local_env.clearRetainingCapacity();
        for (cmd.assigns) |*assign| {
            try self.interpret_assign(assign);
        }

        // TODO redirects, env vars
        var spawn_args = Subprocess.SpawnArgs.default(self.arena, self.globalThis.bunVM(), false);

        const args = args: {
            var args = try self.allocator.alloc(?[*:0]const u8, cmd.name_and_args.len);
            for (cmd.name_and_args, 0..) |*arg_atom, i| {
                const atom_str = try self.eval_atom(arg_atom);
                if (i == 0) {
                    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    var resolved = Which.which(&path_buf, spawn_args.PATH, spawn_args.cwd, atom_str[0..]) orelse {
                        self.globalThis.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{atom_str});
                        return ShellError.Process;
                    };
                    const duped = self.allocator.dupeZ(u8, bun.span(resolved)) catch {
                        self.globalThis.throw("out of memory", .{});
                        return ShellError.Process;
                    };
                    args[i] = duped.ptr;
                    continue;
                }
                args[i] = atom_str.ptr;
            }
            break :args args;
        };

        spawn_args.argv = std.ArrayListUnmanaged(?[*:0]const u8){ .items = args, .capacity = args.len };
        spawn_args.stdio[bun.STDIN_FD] = if (io.stdin == bun.STDIN_FD) .inherit else .{ .fd = io.stdin };
        spawn_args.stdio[bun.STDOUT_FD] = if (io.stdout == bun.STDOUT_FD) .inherit else .{ .fd = io.stdout };
        spawn_args.stdio[bun.STDERR_FD] = if (io.stderr == bun.STDERR_FD) .inherit else .{ .fd = io.stderr };

        if (cmd.redirect_file) |redirect| {
            switch (redirect) {
                .jsbuf => |val| {
                    if (self.jsobjs[val.idx].asArrayBuffer(self.globalThis)) |buf| {
                        const stdio: Subprocess.Stdio = .{ .array_buffer = JSC.ArrayBuffer.Strong{
                            .array_buffer = buf,
                            .held = JSC.Strong.create(buf.value, self.globalThis),
                        } };

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
                                @panic("OOPS");
                            }
                        }

                        if (cmd.redirect.stdin) {
                            if (!Subprocess.extractStdioBlob(self.globalThis, .{ .Blob = blob.dupe() }, bun.STDIN_FD, &spawn_args.stdio)) {
                                @panic("OOPS");
                            }
                        }

                        if (cmd.redirect.stderr) {
                            if (!Subprocess.extractStdioBlob(self.globalThis, .{ .Blob = blob.dupe() }, bun.STDERR_FD, &spawn_args.stdio)) {
                                @panic("OOPS");
                            }
                        }
                    } else {
                        @panic("Unhandled");
                    }
                },
                else => @panic("TODO"),
            }
        }

        var out_watchfd: ?Subprocess.WatchFd = null;
        var out_err: ?JSValue = null;
        var subprocess = Subprocess.spawnMaybeSyncImpl(
            self.globalThis,
            false,
            self.arena.allocator(),
            &out_watchfd,
            &out_err,
            &spawn_args,
        ) orelse {
            if (out_err) |err| {
                const zigstr = err.getZigString(self.globalThis);
                std.debug.print("VALUe: {s}\n", .{zigstr.full()});
                self.globalThis.throwValue(err);
            }
            return ShellError.Process;
        };
        subprocess.ref();

        return subprocess;
    }

    fn interpret_cmd(self: *Interpreter, cmd: *const ast.Cmd, io: *IO) !bool {
        log("Interpret cmd", .{});
        var jsc_vm = self.globalThis.bunVM();
        var subprocess = try self.init_cmd(cmd, io);
        defer subprocess.unref(false);
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

    fn eval_atom(self: *Interpreter, atom: *const ast.Atom) ![:0]const u8 {
        const string_size = self.eval_atom_size(atom);
        var str = try self.allocator.allocSentinel(u8, string_size, 0);
        switch (atom.*) {
            .simple => |*simp| {
                @memcpy(str, self.eval_atom_simpl(simp));
            },
            .compound => |cmp| {
                var i: usize = 0;
                for (cmp.atoms) |*simple_atom| {
                    const txt = self.eval_atom_simpl(simple_atom);
                    var slice = str[i .. i + txt.len];
                    @memcpy(slice, txt[0..txt.len]);
                    i += txt.len;
                }
            },
        }
        return str;
    }

    fn eval_atom_size(self: *const Interpreter, atom: *const ast.Atom) usize {
        return switch (@as(ast.Atom.Tag, atom.*)) {
            .simple => self.eval_atom_size_simple(&atom.simple),
            .compound => self.eval_atom_size_simple(&atom.simple),
        };
    }

    fn eval_atom_simpl(self: *const Interpreter, atom: *const ast.SimpleAtom) []const u8 {
        return switch (atom.*) {
            .Text => |txt| txt,
            .Var => |label| return self.eval_var(label),
        };
    }

    fn eval_atom_size_simple(self: *const Interpreter, simple: *const ast.SimpleAtom) usize {
        return switch (simple.*) {
            .Text => |txt| txt.len,
            .Var => |label| self.eval_var(label).len,
        };
    }

    fn eval_atom_size_compound(self: *const Interpreter, compound: *const ast.CompoundAtom) usize {
        var size: usize = 0;
        for (compound.atoms) |*atom| {
            size += self.eval_atom_size_simple(atom);
        }
        return size;
    }

    fn eval_var(self: *const Interpreter, label: []const u8) []const u8 {
        const value = self.env.get(label) orelse return "";
        return value;
    }
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
        exported: bool,

        pub fn new(label: []const u8, value: Atom, exported: bool) Assign {
            return .{
                .label = label,
                .value = value,
                .exported = exported,
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

        pub fn new_compound(atom: CompoundAtom) Atom {
            return .{ .compound = atom };
        }

        pub fn is_compound(self: *const Atom) bool {
            switch (self.*) {
                .compound => return true,
                else => return false,
            }
        }
    };

    pub const SimpleAtom = union(enum) {
        Var: []const u8,
        Text: []const u8,
    };

    pub const CompoundAtom = struct {
        atoms: []SimpleAtom,
    };
};

pub const Parser = struct {
    strpool: []const u8,
    tokens: []const Token,
    alloc: Allocator,
    jsobjs: []JSValue,
    current: u32 = 0,
    errors: std.ArrayList(Error),

    // FIXME error location
    const Error = struct { msg: []const u8 };

    pub fn new(allocator: Allocator, lexer: *const Lexer, jsobjs: []JSValue) !Parser {
        return .{
            .strpool = lexer.strpool.items[0..lexer.strpool.items.len],
            .tokens = lexer.tokens.items[0..lexer.tokens.items.len],
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

        // {
        //     var assigns = std.ArrayList(AST.Assign).init(self.alloc);
        //     // Parse leading var decls
        //     while (!self.match_any(&.{ .Semicolon, .Eof })) {
        //         if (try self.parse_assign()) |assign| {
        //             try assigns.append(assign);
        //         } else {
        //             break;
        //         }
        //     }

        //     if (assigns.items.len > 0) {
        //         try exprs.append(.{ .assign = assigns.items[0..] });
        //     }
        // }

        // if (self.match_any(&.{ .Semicolon, .Eof })) return .{ .exprs = exprs.items[0..] };

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
    /// TODO `export FOO=bar`
    fn parse_assign(self: *Parser) !?AST.Assign {
        const old = self.current;
        const exported = self.match(.Export);
        switch (self.peek()) {
            .Text => |txtrng| {
                const start_idx = self.current;
                _ = self.expect(.Text);
                const txt = self.text(txtrng);
                const var_decl: ?AST.Assign = var_decl: {
                    if (self.has_eq_sign(txt)) |eq_idx| {
                        // If it starts with = then it's not valid assignment (e.g. `=FOO`)
                        if (eq_idx == 0) break :var_decl null;
                        const label = txt[0..eq_idx];

                        if (eq_idx == txt.len - 1) {
                            const atom = try self.parse_atom() orelse {
                                try self.add_error("Expected an atom", .{});
                                return ParseError.Expected;
                            };
                            break :var_decl .{
                                .label = label,
                                .value = atom,
                                .exported = exported,
                            };
                        }

                        const txt_value = txt[eq_idx + 1 .. txt.len];
                        _ = self.expect_delimit();
                        break :var_decl .{
                            .label = label,
                            .value = .{ .simple = .{ .Text = txt_value } },
                            .exported = exported,
                        };
                    }
                    break :var_decl null;
                };

                if (var_decl) |vd| {
                    return vd;
                }

                if (exported) {
                    self.current = old;
                } else {
                    self.current = start_idx;
                }
                return null;
            },
            else => return null,
        }
    }

    fn parse_atom(self: *Parser) !?AST.Atom {
        var array_alloc = std.heap.stackFallback(@sizeOf(AST.SimpleAtom), self.alloc);
        var exprs = try std.ArrayList(AST.SimpleAtom).initCapacity(array_alloc.get(), 1);
        {
            while (!self.match(.Delimit)) {
                const next = self.peek_n(1);
                const next_delimits = next == .Delimit or next == .Eof;
                const peeked = self.peek();
                switch (peeked) {
                    .Text => |txtrng| {
                        _ = self.expect(.Text);
                        const txt = self.text(txtrng);
                        try exprs.append(.{ .Text = txt });
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            break;
                        }
                    },
                    .Var => |txtrng| {
                        _ = self.expect(.Var);
                        const txt = self.text(txtrng);
                        try exprs.append(.{ .Var = txt });
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            break;
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
            else => .{ .compound = .{ .atoms = exprs.items[0..exprs.items.len] } },
        };
    }

    fn allocate(self: *const Parser, comptime T: type, val: T) !*T {
        var heap = try self.alloc.create(T);
        heap.* = val;
        return heap;
    }

    fn text(self: *const Parser, range: Token.TextRange) []const u8 {
        return self.strpool[range.start..range.end];
    }

    fn has_eq_sign(self: *Parser, str: []const u8) ?u32 {
        _ = self;
        // TODO: simd
        for (str, 0..) |c, i| if (c == '=') return @intCast(i);
        return null;
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
    Eq,
    Semicolon,
    BraceBegin,
    BraceEnd,
    Export,
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
    // =
    Eq,
    // ;
    Semicolon,

    BraceBegin,
    BraceEnd,

    Export,

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

pub const Lexer = struct {
    src: []const u8,
    /// `i` is the index into the tokens list, tells us at the next token to
    /// look at
    i: u32 = 0,
    /// Tell us the beginning of a "word", indexes into the string pool (`buf`)
    /// Anytime a word is added, this needs to be updated
    word_start: u32 = 0,
    /// Keeps track of the end of a "word", indexes into the string pool (`buf`),
    /// anytime characters are added to the string pool this needs to be updated
    j: u32 = 0,

    strpool: ArrayList(u8),
    tokens: ArrayList(Token),
    state: State = .Normal,
    delimit_quote: bool = false,

    pub const js_objref_prefix = "$__bun_";

    const State = enum {
        Normal,
        Single,
        Double,
    };

    const InputChar = struct {
        char: u8,
        escaped: bool = false,
    };

    const BacktrackSnapshot = struct {
        i: u32,
        j: u32,
        word_start: u32,
        state: State,
        delimit_quote: bool,
    };

    pub fn new(alloc: Allocator, src: []const u8) Lexer {
        return .{
            .src = src,
            .tokens = ArrayList(Token).init(alloc),
            .strpool = ArrayList(u8).init(alloc),
        };
    }

    fn make_snapshot(self: *Lexer) BacktrackSnapshot {
        return .{
            .i = self.i,
            .j = self.j,
            .word_start = self.word_start,
            .delimit_quote = self.delimit_quote,
            .state = self.state,
        };
    }

    fn backtrack(self: *Lexer, snap: BacktrackSnapshot) void {
        self.i = snap.i;
        self.j = snap.j;
        self.word_start = snap.word_start;
        self.state = snap.state;
        self.delimit_quote = snap.delimit_quote;
    }

    pub fn lex(self: *Lexer) !void {
        while (true) {
            const input = self.eat() orelse {
                try self.break_word(true);
                break;
            };
            const char = input.char;
            const escaped = input.escaped;

            // Handle non-escaped chars that may:
            // 1. produce operators
            // 2. switch lexing state
            // 3. break words
            if (!escaped) escaped: {
                switch (char) {
                    'e' => {
                        if (self.state == .Single or self.state == .Double) break :escaped;
                        if (self.eat_export()) {
                            try self.break_word(true);
                            try self.tokens.append(.Export);
                            continue;
                        }
                        break :escaped;
                    },
                    ';' => {
                        if (self.state == .Single or self.state == .Double) break :escaped;
                        try self.break_word(true);
                        try self.tokens.append(.Semicolon);
                        continue;
                    },
                    '$' => {
                        if (self.state == .Single) break :escaped;

                        // Handle variable
                        try self.break_word(false);
                        if (self.eat_js_obj_ref()) |ref| {
                            try self.tokens.append(ref);
                        } else {
                            const var_tok = try self.eat_var();
                            try self.tokens.append(.{ .Var = var_tok });
                        }
                        self.word_start = self.j;
                        continue;
                    },
                    // Operators
                    '|' => {
                        if (self.state == .Single or self.state == .Double) break :escaped;
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
                        if (self.state == .Single or self.state == .Double) break :escaped;
                        try self.break_word(true);
                        const redirect = self.eat_simple_redirect();
                        try self.tokens.append(.{ .Redirect = redirect });
                        continue;
                    },
                    '&' => {
                        if (self.state == .Single or self.state == .Double) break :escaped;
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
                        if (self.state == .Single) {
                            self.state = .Normal;
                            continue;
                        }
                        if (self.state == .Normal) {
                            self.state = .Single;
                            continue;
                        }
                        continue;
                    },
                    '"' => {
                        if (self.state == .Single) break :escaped;
                        if (self.state == .Normal) {
                            try self.break_word(false);
                            self.state = .Double;
                        } else if (self.state == .Double) {
                            try self.break_word(false);
                            self.delimit_quote = true;
                            self.state = .Normal;
                        }
                        continue;
                    },

                    // 3. Word breakers
                    ' ' => {
                        if (self.state == .Normal) {
                            try self.break_word(true);
                            continue;
                        }
                        break :escaped;
                    },

                    else => break :escaped,
                }
                continue;
            }

            switch (char) {
                '0'...'9' => {
                    const snapshot = self.make_snapshot();
                    if (self.eat_redirect(input)) |redirect| {
                        try self.break_word(true);
                        try self.tokens.append(.{ .Redirect = redirect });
                        continue;
                    }
                    self.backtrack(snapshot);
                },
                else => {},
            }

            try self.strpool.append(char);
            self.j += 1;
        }

        try self.tokens.append(.Eof);
    }

    fn break_word(self: *Lexer, add_delimiter: bool) !void {
        const start: u32 = self.word_start;
        const end: u32 = self.j;
        if (start != end) {
            try self.tokens.append(.{ .Text = .{ .start = start, .end = end } });
            if (add_delimiter) {
                try self.tokens.append(.Delimit);
            }
        } else if (self.delimit_quote) {
            try self.tokens.append(.Delimit);
            self.delimit_quote = false;
        }
        self.word_start = self.j;
    }

    fn eat_export(self: *Lexer) bool {
        return self.eat_literal("export");
    }

    fn eat_simple_redirect(self: *Lexer) AST.Cmd.RedirectFlags {
        return if (self.eat_simple_redirect_operator())
            AST.Cmd.RedirectFlags.@">>"()
        else
            AST.Cmd.RedirectFlags.@">"();
    }

    fn eat_simple_redirect_operator(self: *Lexer) bool {
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
        @panic("Unexpected EOF");
    }

    fn eat_redirect(self: *Lexer, first: InputChar) ?AST.Cmd.RedirectFlags {
        var flags: AST.Cmd.RedirectFlags = .{};
        switch (first.char) {
            '0'...'9' => {
                var count: usize = 1;
                var buf: [32]u8 = [_]u8{first.char} ** 32;

                while (self.peek()) |peeked| {
                    const char = peeked.char;
                    switch (char) {
                        '0'...'9' => {
                            _ = self.eat();
                            buf[count] = char;
                            count += 1;
                            continue;
                        },
                        else => break,
                    }
                }

                var num = std.fmt.parseInt(u8, buf[0..count], 10) catch {
                    @panic("Invalid redirection");
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
                        @panic("Invalid redirection");
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
    fn eat_literal(self: *Lexer, comptime literal: []const u8) bool {
        const literal_skip_first = literal[1..];
        const snapshot = self.make_snapshot();
        const slice = self.eat_slice(literal_skip_first.len) orelse {
            self.backtrack(snapshot);
            return false;
        };

        if (std.mem.eql(u8, &slice, literal_skip_first))
            return true;

        self.backtrack(snapshot);
        return false;
    }

    fn eat_number_word(self: *Lexer) ?usize {
        const snap = self.make_snapshot();
        var count: usize = 0;
        var buf: [32]u8 = [_]u8{0} ** 32;

        while (self.eat()) |result| {
            const char = result.char;
            switch (char) {
                '0'...'9' => {
                    buf[count] = char;
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

    fn eat_js_obj_ref(self: *Lexer) ?Token {
        const snap = self.make_snapshot();
        if (self.eat_literal(Lexer.js_objref_prefix)) {
            if (self.eat_number_word()) |num| {
                if (num <= std.math.maxInt(u32)) {
                    return .{ .JSObjRef = @truncate(num) };
                }
            }
        }
        self.backtrack(snap);
        return null;
    }

    fn eat_var(self: *Lexer) !Token.TextRange {
        const start = self.j;
        // Eat until special character
        while (self.peek()) |result| {
            const char = result.char;
            const escaped = result.escaped;
            _ = escaped;

            switch (char) {
                '{', '}', ';', '\'', '\"', ' ', '|', '&', '>', ',' => {
                    return .{ .start = start, .end = self.j };
                },
                else => {
                    _ = self.eat() orelse unreachable;
                    try self.strpool.append(char);
                    self.j += 1;
                },
            }
        }
        return .{ .start = start, .end = self.j };
    }

    fn eat(self: *Lexer) ?InputChar {
        if (self.read_char()) |result| {
            self.i += 1 + @as(u32, @intFromBool(result.escaped));
            return result;
        }
        return null;
    }

    fn eat_slice(self: *Lexer, comptime N: usize) ?[N]u8 {
        var slice = [_]u8{0} ** N;
        var i: usize = 0;
        while (self.peek()) |result| {
            slice[i] = result.char;
            i += 1;
            _ = self.eat();
            if (i == N) {
                return slice;
            }
        }

        return null;
    }

    fn peek(self: *Lexer) ?InputChar {
        if (self.read_char()) |result| {
            return result;
        }

        return null;
    }

    fn read_char(self: *Lexer) ?InputChar {
        if (self.i >= self.src.len) return null;
        var char = self.src[self.i];
        if (char != '\\' or self.state == .Single) return .{ .char = char };

        // Handle backslash
        switch (self.state) {
            .Normal => {
                if (self.i + 1 >= self.src.len) return null;
                char = self.src[self.i + 1];
            },
            .Double => {
                if (self.i + 1 >= self.src.len) return null;
                const next_char = self.src[self.i + 1];
                switch (next_char) {
                    // Backslash only applies to these characters
                    '$', '`', '"', '\\', '\n' => {
                        char = next_char;
                    },
                    else => return .{ .char = char, .escaped = false },
                }
            },
            else => unreachable,
        }

        return .{ .char = char, .escaped = true };
    }

    fn debug_tokens(self: *const Lexer) void {
        std.debug.print("Tokens: \n", .{});
        for (self.tokens.items, 0..) |tok, i| {
            std.debug.print("{d}: ", .{i});
            tok.debug(self.strpool.items[0..self.strpool.items.len]);
        }
    }
};

fn test_lex(src: []const u8, expected: []const Test.TestToken) !Lexer {
    std.debug.print("Lexing: {s}\n", .{src});
    var lexer = Lexer.new(std.heap.c_allocator, src);
    try lexer.lex();
    lexer.debug_tokens();
    try std.testing.expectEqual(expected.len, lexer.tokens.items.len);
    for (lexer.tokens.items, expected) |tok, expected_tok| {
        const test_tok = Test.TestToken.from_real(tok, lexer.strpool.items[0..lexer.strpool.items.len]);
        switch (expected_tok) {
            .Var => |txt| {
                try std.testing.expectEqualStrings(txt, test_tok.Var);
                continue;
            },
            .Text => |txt| {
                try std.testing.expectEqualStrings(txt, test_tok.Text);
                continue;
            },
            else => {},
        }
        try std.testing.expectEqual(expected_tok, test_tok);
    }
    return lexer;
}

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
        // =
        Eq,
        Semicolon,

        BraceBegin,
        BraceEnd,

        Export,

        Var: []const u8,
        Text: []const u8,
        JSObjRef: u32,

        Delimit,
        Eof,

        pub fn from_real(the_token: Token, buf: []const u8) TestToken {
            switch (the_token) {
                .Export => return .Export,
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
                .Eq => return .Eq,
                .Semicolon => return .Semicolon,
                .BraceBegin => return .BraceBegin,
                .BraceEnd => return .BraceEnd,
                .Delimit => return .Delimit,
                .Eof => return .Eof,
            }
        }
    };
};
