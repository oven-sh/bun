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
        var root = try Script.fromAST(this, this.script);
        try root.start();
        return this.promise.value();
    }

    fn finish(this: *Interpreter) void {
        defer this.deinit();
        this.promise.resolve(this.global, .true);
    }

    fn errored(this: *Interpreter, the_error: ShellError) void {
        defer this.deinit();
        this.promise.reject(this.global, the_error.toJSC(this.global));
    }

    fn deinit(this: *Interpreter) void {
        this.arena.deinit();
        this.allocator.destroy(this);
    }
};

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

pub const Script = struct {
    base: State,
    node: *const ast.Script,
    idx: usize,

    pub const ChildPtr = struct {
        pub fn init(child: *Stmt) *Stmt {
            return child;
        }
    };

    fn fromAST(interpreter: *Interpreter, node: *const ast.Script) !*Script {
        var script = try interpreter.allocator.create(Script);
        errdefer interpreter.allocator.destroy(script);
        script.base = .{ .kind = .script, .interpreter = interpreter };
        script.node = node;
        script.idx = 0;
        return script;
    }

    fn start(this: *Script) !void {
        if (bun.Environment.allow_assert) {
            std.debug.assert(this.idx == 0);
        }

        if (this.node.stmts.len == 0)
            return this.finish();

        const stmt_node = &this.node.stmts[0];

        var stmt = try Stmt.fromAST(this.base.interpreter, stmt_node, this);
        try stmt.start();
    }

    fn finish(this: *Script) void {
        this.base.interpreter.finish();
    }

    fn childDone(this: *Script, child: *Stmt, exit_code: u8) void {
        _ = child;
        _ = exit_code;
        log("SCRIPT DONE YO!", .{});
        this.finish();
    }
};

pub const Stmt = struct {
    base: State,
    node: *const ast.Stmt,
    parent: *Script,
    idx: usize,
    last_exit_code: ?u8,

    const ChildPtr = struct {
        pub fn init(_: anytype) void {}
    };

    pub fn fromAST(interpreter: *Interpreter, node: *const ast.Stmt, parent: *Script) !*Stmt {
        var script = try interpreter.allocator.create(Stmt);
        script.base = .{ .kind = .stmt, .interpreter = interpreter };
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
            return this.parent.childDone(this, 0);

        const child = &this.node.exprs[0];
        switch (child.*) {
            .cond => {
                const cond = Cond.fromAST(this.base.interpreter, child.cond, Cond.ParentPtr.init(this));
                cond.start();
            },
            .cmd => {
                const parent_ptr = Cmd.ParentPtr.init(this);
                const cmd = Cmd.fromAST(this.base.interpreter, child.cmd, parent_ptr);
                cmd.start();
            },
            else => @panic("TODO"),
        }
    }

    pub fn childDone(this: *Stmt, _: void, exit_code: u8) void {
        this.last_exit_code = exit_code;
        const next_idx = this.idx + 1;
        if (next_idx >= this.node.exprs.len)
            return this.parent.childDone(this, exit_code);

        const child = &this.node.exprs[next_idx];
        switch (child.*) {
            .cond => {
                const cond = Cond.fromAST(this.base.interpreter, child.cond, Cond.ParentPtr.init(this));
                cond.start();
            },
            else => @panic("TODO"),
        }
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
    currently_executing: ?ChildPtr = null,

    const ChildPtr = StatePtrUnion(.{ Cmd, Pipeline, Cond });

    const ParentPtr = StatePtrUnion(.{
        Stmt,
        Cond,
    });

    pub fn fromAST(interpreter: *Interpreter, node: *const ast.Conditional, parent: ParentPtr) *Cond {
        var cond = interpreter.allocator.create(Cond) catch |err| {
            std.debug.print("Ruh roh: {any}\n", .{err});
            @panic("Ruh roh");
        };
        cond.node = node;
        cond.base = .{ .kind = .cond, .interpreter = interpreter };
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
        child.start();
    }

    fn makeChild(this: *Cond, left: bool) ChildPtr {
        const node = if (left) &this.node.left else &this.node.right;
        switch (node.*) {
            .cmd => {
                const cmd = Cmd.fromAST(this.base.interpreter, node.cmd, Cmd.ParentPtr.init(this));
                return ChildPtr.init(cmd);
            },
            .cond => {
                const cond = Cond.fromAST(this.base.interpreter, node.cond, Cond.ParentPtr.init(this));
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
};

pub const Pipeline = struct {
    base: State,
    node: *const ast.Pipeline,
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

    const ChildPtr = StatePtrUnion(.{
        Cmd,
    });

    pub fn childDone(this: *Pipeline, child: ChildPtr, exit_code: u8) void {
        _ = exit_code;
        _ = child;
        _ = this;
        @panic("TODO!");
        // if (comptime bun.Environment.allow_assert) {
        //     std.debug.assert(this.idx < this.node.cmds.len);
        // }
        // log("pipeline child done {x} ({d})", .{ @intFromPtr(this), exit_code });
        // this.exit_codes[this.idx] = exit_code;
        // this.idx += 1;
        // if (this.idx >= this.node.cmds.len) {
        //     this.parent.childDone(this, exit_code);
        //     return;
        // }

        // const cmd = this.node.cmds[this.idx];
        // const child = Cmd.fromAST(this.base.interpreter, cmd, Cmd.ParentPtr.init(this));
        // child.start(true);
    }
};

pub const Cmd = struct {
    base: State,
    node: *const ast.Cmd,
    cmd: ?*Subprocess,
    parent: ParentPtr,
    exit_code: ?u8,

    const ParentPtr = StatePtrUnion(.{
        Stmt,
        Cond,
        Pipeline,
        // TODO
        // .subst = void,
    });

    pub fn start(this: *Cmd) void {
        log("cmd start {x}", .{@intFromPtr(this)});
        this.initSubproc() catch bun.outOfMemory();
    }

    pub fn fromAST(interpreter: *Interpreter, node: *const ast.Cmd, parent: ParentPtr) *Cmd {
        var cmd = interpreter.allocator.create(Cmd) catch |err| {
            std.debug.print("Ruh roh: {any}\n", .{err});
            @panic("Ruh roh");
        };
        cmd.base = .{ .kind = .cmd, .interpreter = interpreter };
        cmd.node = node;
        cmd.cmd = null;
        cmd.parent = parent;
        cmd.exit_code = null;
        return cmd;
    }

    fn initSubproc(this: *Cmd) !void {
        log("cmd init subproc {x}", .{@intFromPtr(this)});
        var arena = bun.ArenaAllocator.init(this.base.interpreter.allocator);
        var arena_allocator = arena.allocator();
        defer arena.deinit();

        var spawn_args = Subprocess.SpawnArgs.default(&arena, this.base.interpreter.global.bunVM(), false);
        spawn_args.stdio[bun.STDIN_FD] = .inherit;
        spawn_args.stdio[bun.STDOUT_FD] = .inherit;
        spawn_args.stdio[bun.STDERR_FD] = .inherit;
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

        const subproc = (try Subprocess.spawnAsync(this.base.interpreter.global, spawn_args)) orelse return ShellError.Spawn;
        this.cmd = subproc;
    }

    pub fn evalWord(this: *Cmd, word: *const ast.Atom) []const u8 {
        _ = word;
        _ = this;
    }

    pub fn onExit(this: *Cmd, exit_code: u8) void {
        log("cmd exit code={d} ({x})", .{ exit_code, @intFromPtr(this) });
        this.exit_code = exit_code;
        this.parent.childDone(this, exit_code);
    }

    pub fn deinit(this: *Cmd) void {
        if (this.cmd) |cmd| {
            cmd.unref(true);
            cmd.deinit();
        }
        this.base.interpreter.allocator.destroy(this);
    }
};

pub fn StatePtrUnion(comptime TypesValue: anytype) type {
    return struct {
        // pub usingnamespace TaggedPointerUnion(TypesValue);
        ptr: Ptr,

        const Ptr = TaggedPointerUnion(TypesValue);

        fn tagInt(this: @This()) Ptr.TagInt {
            return @intFromEnum(this.ptr.tag());
        }

        pub fn init(_ptr: anytype) @This() {
            return .{ .ptr = Ptr.init(_ptr) };
        }

        pub inline fn as(this: @This(), comptime Type: type) *Type {
            return this.ptr.as(Type);
        }

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
