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
const TaggedPointer = @import("../tagged_pointer.zig").TaggedPointer;

const Pipe = [2]bun.FileDescriptor;
const shell = @import("./shell.zig");
const Token = shell.Token;
const ShellError = shell.ShellError;
const ast = shell.AST;

const log = bun.Output.scoped(.SHELL, false);

/// This interpreter works by basically turning the AST into a state machine so
/// that execution can be suspended and resumed to support async.
pub const Interpreter = struct {
    global: *JSGlobalObject,
    /// This is the arena used to allocate the input shell script's AST nodes,
    /// tokens, and a string pool used to store all strings.
    arena: bun.ArenaAllocator,
    /// This is the allocator used to allocate interpreter state
    allocator: Allocator,

    /// The return value
    promise: JSPromise.Strong = .{},

    /// Root ast node
    script: *ast.Script,

    /// Shell env for expansion by the shell
    shell_env: std.StringArrayHashMap([:0]const u8),
    /// Local environment variables to be given to a subprocess
    cmd_local_env: std.StringArrayHashMap([:0]const u8),
    /// Exported environment variables available to all subprocesses. This excludes system ones,
    /// just contains ones set by this shell script.
    export_env: std.StringArrayHashMap([:0]const u8),

    const ShellErrorKind = error{
        OutOfMemory,
        Syscall,
    };

    const ShellErrorCtx = union(enum) {
        syscall: Syscall.Error,
        other: ShellErrorKind,

        fn toJSC(this: ShellErrorCtx, globalThis: *JSGlobalObject) JSValue {
            return switch (this) {
                .syscall => |err| err.toJSC(globalThis),
                .other => |err| bun.JSC.ZigString.fromBytes(@errorName(err)).toValueGC(globalThis),
            };
        }
    };

    /// If all initialization allocations succeed, the arena will be copied
    /// into the interpreter struct, so it is not a stale reference and safe to call `arena.deinit()` on error.
    pub fn init(
        global: *JSGlobalObject,
        allocator: Allocator,
        arena: *bun.ArenaAllocator,
        script: *ast.Script,
    ) !*Interpreter {
        var interpreter = try allocator.create(Interpreter);
        interpreter.global = global;
        errdefer {
            allocator.destroy(interpreter);
        }

        var export_env = brk: {
            var export_env = std.StringArrayHashMap([:0]const u8).init(allocator);
            errdefer {
                export_env.deinit();
            }
            var iter = global.bunVM().bundler.env.map.iter();
            while (iter.next()) |entry| {
                var dupedz = try allocator.dupeZ(u8, entry.value_ptr.value);
                try export_env.put(entry.key_ptr.*, dupedz);
            }
            break :brk export_env;
        };

        interpreter.shell_env = std.StringArrayHashMap([:0]const u8).init(allocator);
        interpreter.cmd_local_env = std.StringArrayHashMap([:0]const u8).init(allocator);
        interpreter.export_env = export_env;

        interpreter.script = script;
        interpreter.arena = arena.*;
        interpreter.allocator = allocator;
        interpreter.promise = .{};

        var promise = JSC.JSPromise.create(global);
        interpreter.promise.strong.set(global, promise.asValue(global));
        return interpreter;
    }

    pub fn start(this: *Interpreter, globalThis: *JSGlobalObject) !JSValue {
        _ = globalThis;
        var root = try Script.init(this, this.script, .{});
        try root.start();
        return this.promise.value();
    }

    fn finish(this: *Interpreter, exit_code: u8) void {
        defer this.deinit();
        this.promise.resolve(this.global, JSValue.jsNumberFromInt32(@intCast(exit_code)));
    }

    fn errored(this: *Interpreter, the_error: ShellError) void {
        defer this.deinit();
        this.promise.reject(this.global, the_error.toJSC(this.global));
    }

    fn deinit(this: *Interpreter) void {
        this.arena.deinit();
        this.allocator.destroy(this);
    }

    fn assignVar(this: *Interpreter, assign: *const ast.Assign, assign_ctx: AssignCtx) anyerror!void {
        const brace_expansion = assign.value.has_brace_expansion();
        const value = brk: {
            var arena_alloc = this.arena.allocator();
            var args = std.ArrayList(?[*:0]const u8).initCapacity(arena_alloc, 1);
            var expander = ExpansionCtx(.{ .for_spawn = false }).init(
                this,
                arena_alloc,
                &args,
            );
            try expander.evalNoBraceExpansion(&assign.value);
            const value = args.items[0];
            if (brace_expansion) {
                @panic("TODO");
                // // For some reason bash only sets the last value
                // break :brk value.many.items[value.many.items.len - 1];
            }
            break :brk value;
        };

        switch (assign_ctx) {
            .cmd => try this.cmd_local_env.put(assign.label, value),
            .shell => try this.shell_env.put(assign.label, value),
            .exported => try this.export_env.put(assign.label, value),
        }
    }
};

const AssignCtx = enum { cmd, shell, exported };

const ExpansionOpts = struct {
    for_spawn: bool = true,
};

/// This meant to be given an arena allocator, so it does not need to worry about deinitialization.
/// This needs to be refactored if we want to mimic behaviour closer to bash.
/// In the shell lexer we strip escaping tokens (single/double quotes, backslashes) because it makes operating on tokens easier.
/// However, this is not what bash does.
pub fn ExpansionCtx(comptime opts: ExpansionOpts) type {
    const Arr = if (!opts.for_spawn) std.ArrayList([:0]const u8) else std.ArrayList(?[*:0]const u8);
    const Expansion = struct {
        arr: *Arr,

        pub fn append(this: @This(), slice: [:0]const u8) !void {
            if (comptime opts.for_spawn) {
                try this.arr.append(slice.ptr);
            } else {
                try this.arr.append(slice);
            }
        }
    };

    return struct {
        interp: *Interpreter,
        arena: Allocator,
        out: Expansion,

        fn init(interp: *Interpreter, arena: Allocator, expand_out: *Arr) @This() {
            return .{
                .interp = interp,
                .arena = arena,
                .out = .{ .arr = expand_out },
            };
        }

        fn evalNoBraceExpansion(this: *@This(), word: *const ast.Atom) !void {
            var has_unknown = false;
            const string_size = this.computeSizeHint(word, &has_unknown);
            if (!has_unknown) {
                var str = try this.arena.allocSentinel(u8, string_size, 0);
                str.len = 0;
                var str_list = std.ArrayList(u8){
                    .items = str,
                    .capacity = string_size,
                    .allocator = this.arena,
                };
                switch (word.*) {
                    .simple => |*simp| {
                        try this.evalSimple(simp, &str_list, true);
                    },
                    .compound => |*cmp| {
                        try this.evalCompoundNoBraceExpansion(cmp, &str_list, true);
                    },
                }
                try str_list.append(0);

                return try this.out.append(str_list.items[0 .. str_list.items.len - 1 :0]);
            }

            // + 1 for sentinel
            var str_list = try std.ArrayList(u8).initCapacity(this.arena, string_size + 1);
            switch (word.*) {
                .simple => |*simp| {
                    try this.evalSimple(simp, &str_list, false);
                },
                .compound => |cmp| {
                    for (cmp.atoms) |*simple_atom| {
                        try this.evalSimple(simple_atom, &str_list, false);
                    }
                },
            }
            try str_list.append(0);
            return try this.out.append(str_list.items[0 .. str_list.items.len - 1 :0]);
        }

        fn evalCompoundNoBraceExpansion(
            this: *@This(),
            word: *const ast.CompoundAtom,
            str_list: *std.ArrayList(u8),
            comptime known_size: bool,
        ) !void {
            if (bun.Environment.allow_assert) {
                std.debug.assert(!word.brace_expansion_hint);
            }
            for (word.atoms) |*simple_atom| {
                try this.evalSimple(simple_atom, str_list, known_size);
            }
        }

        fn evalSimple(
            this: *@This(),
            word: *const ast.SimpleAtom,
            str_list: *std.ArrayList(u8),
            comptime known_size: bool,
        ) !void {
            return switch (word.*) {
                .Text => |txt| {
                    if (comptime known_size) {
                        str_list.appendSliceAssumeCapacity(txt);
                    } else {
                        try str_list.appendSlice(txt);
                    }
                },
                .Var => |label| {
                    if (comptime known_size) {
                        str_list.appendSliceAssumeCapacity(this.evalVarExpansion(label));
                    } else {
                        try str_list.appendSlice(this.evalVarExpansion(label));
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
                    _ = cmd;
                    @panic("TODO");
                    // switch (cmd.*) {
                    //     .assigns => {},
                    //     .cmd => |*the_cmd| {
                    //         if (comptime known_size) {
                    //             if (bun.Environment.allow_assert) {
                    //                 @panic("Cmd substitution should not be present when `known_size` set to true");
                    //             }
                    //         }
                    //         try self.eval_atom_cmd_subst(the_cmd, str_list);
                    //     },
                    // }
                },
            };
        }

        /// Returns the size of the atom when expanded.
        /// If the calculation cannot be computed trivially (cmd substitution,
        /// brace expansion), this value is not accurate and `has_unknown` is
        /// set to true
        fn computeSizeHint(this: *const @This(), word: *const ast.Atom, has_unknown: *bool) usize {
            return switch (@as(ast.Atom.Tag, word.*)) {
                .simple => this.computeSizeSimple(&word.simple, has_unknown),
                .compound => {
                    if (word.compound.brace_expansion_hint) {
                        has_unknown.* = true;
                    }

                    var out: usize = 0;
                    for (word.compound.atoms) |*simple| {
                        out += this.computeSizeSimple(simple, has_unknown);
                    }
                    return out;
                },
            };
        }

        fn computeSizeSimple(this: *const @This(), simple: *const ast.SimpleAtom, has_cmd_subst: *bool) usize {
            return switch (simple.*) {
                .Text => |txt| txt.len,
                .Var => |label| this.evalVarExpansion(label).len,
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

        fn evalVarExpansion(this: *const @This(), label: []const u8) []const u8 {
            const value = this.interp.shell_env.get(label) orelse brk: {
                break :brk this.interp.export_env.get(label) orelse return "";
            };
            return value;
        }
    };
}

pub const State = packed struct {
    kind: StateKind,
    interpreter: *Interpreter,
};

// pub const StatePtr = packed struct {
//     const AddressableSize = u48;
//     __ptr: AddressableSize,
//     kind: StateKind,
//     _pad: u8 = 0,

//     pub fn ptr(this: StatePtr) *State {
//         return @ptrFromInt(@as(usize, @intCast(this.__ptr)));
//     }

//     // pub fn onExit(this: StatePtr, exit_code: ?u8) void {
//     //     return switch (this.kind) {
//     //         .script => this.ptr().onExitImpl(.script, exit_code),
//     //         .stmt => this.ptr(Stmt).onExitImpl(.stmt, exit_code),
//     //         .cmd => this.ptr(Cmd).onExitImpl(.cmd, exit_code),
//     //         .cond => this.ptr(Cond).onExitImpl(.cond, exit_code),
//     //         .pipeline => this.ptr(Pipeline).onExitImpl(.pipeline, exit_code),
//     //     };
//     // }
// };

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

const IO = struct {
    stdin: Kind = .std,
    stdout: Kind = .std,
    stderr: Kind = .std,

    const Kind = union(enum) {
        /// Use stdin/stdout/stderr of this process
        std,
        fd: bun.FileDescriptor,
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

pub const Script = struct {
    base: State,
    node: *const ast.Script,
    idx: usize,
    currently_executing: ?ChildPtr,
    io: IO,

    pub const ChildPtr = struct {
        val: *Stmt,
        pub inline fn init(child: *Stmt) ChildPtr {
            return .{ .val = child };
        }
        pub inline fn deinit(this: ChildPtr) void {
            this.val.deinit();
        }
    };

    fn init(interpreter: *Interpreter, node: *const ast.Script, io: IO) !*Script {
        var script = try interpreter.allocator.create(Script);
        errdefer interpreter.allocator.destroy(script);
        script.base = .{ .kind = .script, .interpreter = interpreter };
        script.node = node;
        script.idx = 0;
        script.io = io;
        return script;
    }

    fn start(this: *Script) !void {
        if (bun.Environment.allow_assert) {
            std.debug.assert(this.idx == 0);
        }

        if (this.node.stmts.len == 0)
            return this.finish(0);

        const stmt_node = &this.node.stmts[0];

        var stmt = try Stmt.init(this.base.interpreter, stmt_node, this, this.io);
        try stmt.start();
    }

    fn finish(this: *Script, exit_code: u8) void {
        this.base.interpreter.finish(exit_code);
    }

    fn childDone(this: *Script, child: ChildPtr, exit_code: u8) void {
        log("SCRIPT DONE YO!", .{});
        child.deinit();
        this.finish(exit_code);
    }
};

pub const Stmt = struct {
    base: State,
    node: *const ast.Stmt,
    parent: *Script,
    idx: usize,
    last_exit_code: ?u8,
    currently_executing: ?ChildPtr,
    io: IO,

    const ChildPtr = StatePtrUnion(.{
        Cond,
        Pipeline,
        Cmd,
    });

    pub fn init(
        interpreter: *Interpreter,
        node: *const ast.Stmt,
        parent: *Script,
        io: IO,
    ) !*Stmt {
        var script = try interpreter.allocator.create(Stmt);
        script.base = .{ .kind = .stmt, .interpreter = interpreter };
        script.node = node;
        script.parent = parent;
        script.idx = 0;
        script.last_exit_code = null;
        script.currently_executing = null;
        script.io = io;
        return script;
    }

    pub fn start(this: *Stmt) !void {
        if (bun.Environment.allow_assert) {
            std.debug.assert(this.idx == 0);
            std.debug.assert(this.last_exit_code == null);
            std.debug.assert(this.currently_executing == null);
        }

        if (this.node.exprs.len == 0)
            return this.parent.childDone(Script.ChildPtr.init(this), 0);

        const child = &this.node.exprs[0];
        switch (child.*) {
            .cond => {
                const cond = Cond.init(this.base.interpreter, child.cond, Cond.ParentPtr.init(this), this.io);
                this.currently_executing = ChildPtr.init(cond);
                cond.start();
            },
            .cmd => {
                const cmd = Cmd.init(this.base.interpreter, child.cmd, Cmd.ParentPtr.init(this), this.io);
                this.currently_executing = ChildPtr.init(cmd);
                cmd.start();
            },
            .pipeline => {
                const pipeline = Pipeline.init(this.base.interpreter, child.pipeline, Pipeline.ParentPtr.init(this), this.io);
                this.currently_executing = ChildPtr.init(pipeline);
                pipeline.start();
            },
            else => @panic("Not possible"),
        }
    }

    pub fn childDone(this: *Stmt, child: ChildPtr, exit_code: u8) void {
        this.last_exit_code = exit_code;
        const next_idx = this.idx + 1;
        if (next_idx >= this.node.exprs.len)
            return this.parent.childDone(Script.ChildPtr.init(this), exit_code);
        child.deinit();

        const next_child = &this.node.exprs[next_idx];
        switch (next_child.*) {
            .cond => {
                const cond = Cond.init(this.base.interpreter, next_child.cond, Cond.ParentPtr.init(this), this.io);
                cond.start();
            },
            else => @panic("TODO"),
        }
    }

    pub fn deinit(this: *Stmt) void {
        if (this.currently_executing) |child| {
            child.deinit();
        }
        this.base.interpreter.allocator.destroy(this);
    }
};

pub const Cond = struct {
    base: State,
    node: *const ast.Conditional,
    /// Based on precedence rules conditional can only be child of a stmt or
    /// another conditional
    parent: ParentPtr,
    left: ?u8 = null,
    right: ?u8 = null,
    io: IO,
    currently_executing: ?ChildPtr = null,

    const ChildPtr = StatePtrUnion(.{ Cmd, Pipeline, Cond });

    const ParentPtr = StatePtrUnion(.{
        Stmt,
        Cond,
    });

    pub fn init(
        interpreter: *Interpreter,
        node: *const ast.Conditional,
        parent: ParentPtr,
        io: IO,
    ) *Cond {
        var cond = interpreter.allocator.create(Cond) catch |err| {
            std.debug.print("Ruh roh: {any}\n", .{err});
            @panic("Ruh roh");
        };
        cond.node = node;
        cond.base = .{ .kind = .cond, .interpreter = interpreter };
        cond.parent = parent;
        cond.io = io;
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
        child.start();
    }

    fn makeChild(this: *Cond, left: bool) ChildPtr {
        const node = if (left) &this.node.left else &this.node.right;
        switch (node.*) {
            .cmd => {
                const cmd = Cmd.init(this.base.interpreter, node.cmd, Cmd.ParentPtr.init(this), this.io);
                return ChildPtr.init(cmd);
            },
            .cond => {
                const cond = Cond.init(this.base.interpreter, node.cond, Cond.ParentPtr.init(this), this.io);
                return ChildPtr.init(cond);
            },
            .assign, .pipeline => @panic("TODO"),
        }
    }

    pub fn childDone(this: *Cond, child: ChildPtr, exit_code: u8) void {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(this.left == null or this.right == null);
            std.debug.assert(this.currently_executing != null);
        }
        log("conditional child done {x} ({s}) {s}", .{ @intFromPtr(this), @tagName(this.node.op), if (this.left == null) "right" else "left" });

        child.deinit();

        if (this.left == null) {
            this.left = exit_code;
            if (exit_code != 0) {
                this.parent.childDone(this, exit_code);
                return;
            }

            this.currently_executing = this.makeChild(false);
            this.currently_executing.?.as(Cmd).start();
            return;
        }

        this.right = exit_code;
        this.parent.childDone(this, exit_code);
    }

    pub fn deinit(this: *Cond) void {
        if (this.currently_executing) |child| {
            child.deinit();
        }
        this.base.interpreter.allocator.destroy(this);
    }
};

pub const Pipeline = struct {
    base: State,
    node: *const ast.Pipeline,
    /// Based on precedence rules pipeline can only be child of a stmt or
    /// conditional
    parent: ParentPtr,
    exited_count: u32,
    cmds: ?[]CmdOrResult,
    pipes: ?[]Pipe,
    io: IO,

    const TrackedFd = struct {
        fd: bun.FileDescriptor,
        open: bool = false,
    };

    const ParentPtr = StatePtrUnion(.{
        Stmt,
        Cond,
    });

    const ChildPtr = StatePtrUnion(.{
        Cmd,
    });

    const CmdOrResult = union(enum) {
        cmd: *Cmd,
        result: u8,
    };

    pub fn init(
        interpreter: *Interpreter,
        node: *const ast.Pipeline,
        parent: ParentPtr,
        io: IO,
    ) *Pipeline {
        var pipeline = interpreter.allocator.create(Pipeline) catch |err| {
            std.debug.print("Ruh roh: {any}\n", .{err});
            @panic("Ruh roh");
        };
        pipeline.base = .{ .kind = .pipeline, .interpreter = interpreter };
        pipeline.node = node;
        pipeline.parent = parent;
        pipeline.exited_count = 0;
        pipeline.io = io;

        const cmd_count = brk: {
            var i: u32 = 0;
            for (node.items) |*item| {
                if (item.* == .cmd) i += 1;
            }
            break :brk i;
        };

        pipeline.cmds = if (cmd_count >= 1) interpreter.allocator.alloc(CmdOrResult, node.items.len) catch bun.outOfMemory() else null;
        if (pipeline.cmds == null) return pipeline;
        var pipes = interpreter.allocator.alloc(Pipe, if (cmd_count > 1) cmd_count - 1 else 1) catch bun.outOfMemory();

        if (cmd_count > 1) {
            var pipes_set: u32 = 0;
            Pipeline.initializePipes(pipes, &pipes_set) catch {
                for (pipes[0..pipes_set]) |*pipe| {
                    closefd(pipe[0]);
                    closefd(pipe[1]);
                }
                // FIXME this should really return an error
                @panic("Ruh roh");
            };
        }

        var i: u32 = 0;
        for (node.items) |*item| {
            if (item.* == .cmd) {
                var kind = "subproc";
                _ = kind;
                var cmd_io = io;
                var stdin = if (cmd_count > 1) Pipeline.readPipe(pipes, i, &cmd_io) else cmd_io.stdin;
                var stdout = if (cmd_count > 1) Pipeline.writePipe(pipes, i, cmd_count, &cmd_io) else cmd_io.stdout;
                cmd_io.stdin = stdin;
                cmd_io.stdout = stdout;
                pipeline.cmds.?[i] = .{ .cmd = Cmd.init(interpreter, &item.cmd, Cmd.ParentPtr.init(pipeline), cmd_io) };
                i += 1;
            }
        }

        pipeline.pipes = pipes;

        return pipeline;
    }

    pub fn start(this: *Pipeline) void {
        var cmds = this.cmds orelse {
            this.parent.childDone(this, 0);
            return;
        };

        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(this.exited_count == 0);
        }
        log("pipeline start {x} (count={d})", .{ @intFromPtr(this), this.node.items.len });
        if (this.node.items.len == 0) {
            this.parent.childDone(this, 0);
            return;
        }

        for (cmds, 0..) |*cmd_or_result, i| {
            var stdin: IO.Kind = if (i == 0) this.io.stdin else .{ .fd = this.pipes.?[i - 1][0] };
            var stdout: IO.Kind = if (i == cmds.len - 1) this.io.stdout else .{ .fd = this.pipes.?[i][1] };

            std.debug.assert(cmd_or_result.* == .cmd);
            var cmd = cmd_or_result.cmd;
            log("Spawn: proc_idx={d} stdin={any} stdout={any} stderr={any}\n", .{ i, stdin, stdout, cmd.io.stderr });
            cmd.start();

            // If command is a subproc (and not a builtin) we need to close the fd
            if (cmd.isSubproc()) {
                stdin.close();
                stdout.close();
            }
        }
    }

    pub fn childDone(this: *Pipeline, child: ChildPtr, exit_code: u8) void {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(this.cmds.?.len > 0);
        }

        const idx = brk: {
            const ptr_value: u64 = @bitCast(child.ptr.repr);
            _ = ptr_value;
            for (this.cmds.?, 0..) |cmd_or_result, i| {
                if (cmd_or_result == .cmd) {
                    if (@intFromPtr(cmd_or_result.cmd) == @as(usize, @intCast(child.ptr.repr._ptr))) break :brk i;
                }
            }
            unreachable;
        };

        log("pipeline child done {x} ({d}) i={d}", .{ @intFromPtr(this), exit_code, idx });
        child.deinit();
        this.cmds.?[idx] = .{ .result = exit_code };
        this.exited_count += 1;

        if (this.exited_count >= this.cmds.?.len) {
            var last_exit_code: u8 = 0;
            for (this.cmds.?) |cmd_or_result| {
                if (cmd_or_result == .result) {
                    last_exit_code = cmd_or_result.result;
                    break;
                }
            }
            this.parent.childDone(this, last_exit_code);
            return;
        }
    }

    pub fn deinit(this: *Pipeline) void {
        // If commands was zero then we didn't allocate anything
        if (this.cmds == null) return;
        for (this.cmds.?) |*cmd_or_result| {
            if (cmd_or_result.* == .cmd) {
                cmd_or_result.cmd.deinit();
            }
        }
        this.base.interpreter.allocator.free(this.pipes);
        this.base.interpreter.allocator.free(this.cmds);
    }

    fn initializePipes(pipes: []Pipe, set_count: *u32) !void {
        for (pipes) |*pipe| {
            pipe.* = try std.os.pipe();
            set_count.* += 1;
        }
    }

    fn writePipe(pipes: []Pipe, proc_idx: usize, cmd_count: usize, io: *IO) IO.Kind {
        // Last command in the pipeline should write to stdout
        if (proc_idx == cmd_count - 1) return io.stdout;
        return .{ .fd = pipes[proc_idx][1] };
    }

    fn readPipe(pipes: []Pipe, proc_idx: usize, io: *IO) IO.Kind {
        // First command in the pipeline should read from stdin
        if (proc_idx == 0) return io.stdin;
        return .{ .fd = pipes[proc_idx - 1][0] };
    }
};

pub const Cmd = struct {
    base: State,
    node: *const ast.Cmd,
    cmd: ?*Subprocess,
    parent: ParentPtr,
    exit_code: ?u8,
    io: IO,

    const ParentPtr = StatePtrUnion(.{
        Stmt,
        Cond,
        Pipeline,
        // TODO
        // .subst = void,
    });

    pub fn start(this: *Cmd) void {
        log("cmd start {x}", .{@intFromPtr(this)});
        this.initSubproc() catch |err| {
            std.debug.print("THIS THE ERROR: {any}\n", .{err});
            bun.outOfMemory();
        };
    }

    pub fn isSubproc(this: *Cmd) bool {
        _ = this;
        return true;
    }

    pub fn init(interpreter: *Interpreter, node: *const ast.Cmd, parent: ParentPtr, io: IO) *Cmd {
        var cmd = interpreter.allocator.create(Cmd) catch |err| {
            std.debug.print("Ruh roh: {any}\n", .{err});
            @panic("Ruh roh");
        };
        cmd.base = .{ .kind = .cmd, .interpreter = interpreter };
        cmd.node = node;
        cmd.cmd = null;
        cmd.parent = parent;
        cmd.exit_code = null;
        cmd.io = io;
        return cmd;
    }

    fn initSubproc(this: *Cmd) !void {
        log("cmd init subproc {x}", .{@intFromPtr(this)});
        var arena = bun.ArenaAllocator.init(this.base.interpreter.allocator);
        var arena_allocator = arena.allocator();
        defer arena.deinit();

        var spawn_args = Subprocess.SpawnArgs.default(&arena, this.base.interpreter.global.bunVM(), false);

        spawn_args.argv = std.ArrayListUnmanaged(?[*:0]const u8){};
        spawn_args.cmd_parent = this;

        const args = args: {
            // TODO optimization: allocate into one buffer of chars and create argv from slicing into that
            // TODO optimization: have args list on the stack and fallback to array
            var args = try std.ArrayList(?[*:0]const u8).initCapacity(arena_allocator, this.node.name_and_args.len);
            var expander = ExpansionCtx(.{ .for_spawn = true }).init(
                this.base.interpreter,
                arena_allocator,
                &args,
            );

            for (this.node.name_and_args, 0..) |*arg_atom, i| {
                _ = i;
                try expander.evalNoBraceExpansion(arg_atom);
            }
            try args.append(null);

            for (args.items) |maybe_arg| {
                if (maybe_arg) |arg| {
                    log("ARG: {s}\n", .{arg});
                }
            }

            const first_arg = args.items[0] orelse {
                this.base.interpreter.global.throwInvalidArguments("No command specified", .{});
                return ShellError.Process;
            };
            const first_arg_len = std.mem.len(first_arg);
            // if (Builtin.Kind.fromStr(first_arg[0..first_arg_len])) |b| {
            //     return .{ .builtin = self.init_builtin(b, args, io, cmd, in_cmd_subst) };
            // }

            var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var resolved = Which.which(&path_buf, spawn_args.PATH, spawn_args.cwd, first_arg[0..first_arg_len]) orelse {
                this.base.interpreter.global.throwInvalidArguments("Executable not found in $PATH: \"{s}\"", .{first_arg});
                return ShellError.Process;
            };
            const duped = arena_allocator.dupeZ(u8, bun.span(resolved)) catch {
                this.base.interpreter.global.throw("out of memory", .{});
                return ShellError.Process;
            };
            args.items[0] = duped;

            break :args args;
        };
        spawn_args.argv = std.ArrayListUnmanaged(?[*:0]const u8){ .items = args.items, .capacity = args.capacity };

        // FIXME support redirects
        // spawn_args.stdio[bun.STDIN_FD] = .inherit;
        // spawn_args.stdio[bun.STDOUT_FD] = .inherit;
        // spawn_args.stdio[bun.STDERR_FD] = .inherit;
        this.io.to_subproc_stdio(&spawn_args.stdio);

        const subproc = (try Subprocess.spawnAsync(this.base.interpreter.global, spawn_args)) orelse return ShellError.Spawn;
        this.cmd = subproc;
    }

    pub fn onExit(this: *Cmd, exit_code: u8) void {
        log("cmd exit code={d} ({x})", .{ exit_code, @intFromPtr(this) });
        this.exit_code = exit_code;
        this.parent.childDone(this, exit_code);
    }

    // TODO check that this also makes sure that the poll ref is killed because if it isn't then this Cmd pointer will be stale and so when the event for pid exit happens it will cause crash
    pub fn deinit(this: *Cmd) void {
        if (this.cmd) |cmd| {
            if (cmd.hasExited()) {
                cmd.unref(true);
                cmd.deinit();
            } else {
                _ = cmd.tryKill(9);
                cmd.unref(true);
            }
        }
        this.base.interpreter.allocator.destroy(this);
    }
};

pub fn StatePtrUnion(comptime TypesValue: anytype) type {
    return struct {
        // pub usingnamespace TaggedPointerUnion(TypesValue);
        ptr: Ptr,

        const Ptr = TaggedPointerUnion(TypesValue);

        pub fn start(this: @This()) void {
            const tags = comptime std.meta.fields(Ptr.Tag);
            inline for (tags) |tag| {
                if (this.tagInt() == tag.value) {
                    const Ty = comptime Ptr.typeFromTag(tag.value);
                    var casted = this.as(Ty);
                    casted.start();
                    return;
                }
            }
            unknownTag(this.tagInt());
        }

        pub fn deinit(this: @This()) void {
            const tags = comptime std.meta.fields(Ptr.Tag);
            inline for (tags) |tag| {
                if (this.tagInt() == tag.value) {
                    const Ty = comptime Ptr.typeFromTag(tag.value);
                    var casted = this.as(Ty);

                    if (@hasField(MaybeChild(@TypeOf(casted)), "deinit")) {
                        casted.deinit();
                    }
                    return;
                }
            }
            unknownTag(this.tagInt());
        }

        pub fn childDone(this: @This(), child: anytype, exit_code: u8) void {
            const tags = comptime std.meta.fields(Ptr.Tag);
            inline for (tags) |tag| {
                if (this.tagInt() == tag.value) {
                    const Ty = comptime Ptr.typeFromTag(tag.value);
                    const ChildPtr = Ty.ChildPtr;
                    const child_ptr = ChildPtr.init(child);
                    var casted = this.as(Ty);
                    casted.childDone(child_ptr, exit_code);
                    return;
                }
            }
            unknownTag(this.tagInt());
        }

        fn unknownTag(tag: Ptr.TagInt) void {
            if (comptime bun.Environment.allow_assert) {
                std.debug.print("Bad tag: {d}\n", .{tag});
                @panic("Bad tag");
            }
        }

        fn tagInt(this: @This()) Ptr.TagInt {
            return @intFromEnum(this.ptr.tag());
        }

        pub fn init(_ptr: anytype) @This() {
            return .{ .ptr = Ptr.init(_ptr) };
        }

        pub inline fn as(this: @This(), comptime Type: type) *Type {
            return this.ptr.as(Type);
        }
    };
}

pub fn MaybeChild(comptime T: type) type {
    return switch (@typeInfo(T)) {
        .Array => |info| info.child,
        .Vector => |info| info.child,
        .Pointer => |info| info.child,
        .Optional => |info| info.child,
        else => T,
    };
}

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
