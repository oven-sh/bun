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

pub fn OOM(e: anyerror) noreturn {
    if (comptime bun.Environment.allow_assert) {
        if (e != error.OutOfMemory) @panic("Ruh roh");
    }
    @panic("Out of memory");
}

const log = bun.Output.scoped(.SHELL, false);

pub fn assert(cond: bool, comptime msg: []const u8) void {
    if (bun.Environment.allow_assert) {
        std.debug.assert(cond);
    } else {
        @panic("Assertion failed: " ++ msg);
    }
}

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

    /// JS objects used as input for the shell script
    /// This should be allocated using the arena
    jsobjs: []JSValue,

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
        jsobjs: []JSValue,
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
        interpreter.jsobjs = jsobjs;

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
        for (this.jsobjs) |jsobj| {
            jsobj.unprotect();
        }
        this.arena.deinit();
        this.allocator.destroy(this);
    }

    /// For some reason, bash does not allow braces to be expanded in
    /// assignments. It does allow glob expansion, but only AFTER the
    /// variable has expanded:
    ///
    /// ```bash
    /// FOO=*.json
    /// echo $FOO # prints something like `foo.json bar.json`
    /// touch WHY.json
    /// echo $FOO # prints `foo.json bar.json WHY.json`
    /// ```
    /// FIXME: support cmd substitution (reequires IO)
    fn assignVar(this: *Interpreter, assign: *const ast.Assign, assign_ctx: AssignCtx) void {
        // All the extra allocations needed to calculate the final resultant value are done in a temp arena,
        // then the final result is copied into the interpreter's arena.
        var arena = Arena.init(this.allocator);
        defer arena.deinit();
        var arena_alloc = arena.allocator();

        var expander = ExpansionCtx(.{ .for_spawn = false, .single = true }).init(
            this,
            arena_alloc,
            {},
        );

        // This will do variable expansion, but not brace expansion or glob expansion
        expander.evalNoBraceExpansion(&assign.value) catch |e| OOM(e);

        const value = this.arena.allocator().dupeZ(u8, expander.out.value.?) catch |e| OOM(e);

        (switch (assign_ctx) {
            .cmd => this.cmd_local_env.put(assign.label, value),
            .shell => this.shell_env.put(assign.label, value),
            .exported => this.export_env.put(assign.label, value),
        }) catch |e| OOM(e);
    }
};

const AssignCtx = enum {
    cmd,
    shell,
    exported,
};

const ExpansionOpts = struct {
    for_spawn: bool = true,
    single: bool = false,
};

/// If a word contains command substitution or glob expansion syntax then it
/// needs to do IO, so we have to keep track of the state for that.
pub const Expansion = struct {
    base: State,
    node: *const ast.Atom,
    parent: ParentPtr,

    word_idx: u32,
    current_out: std.ArrayList(u8),
    state: enum {
        normal,
        braces,
        glob,
        done,
        err,
    },
    child_state: union(enum) {
        idle,
        cmd_subst: struct {
            cmd: *Cmd,
        },
        // TODO
        glob: struct {},
    },
    out: Result,
    out_idx: u32,

    const ParentPtr = StatePtrUnion(.{
        Cmd,
        // FIXME support assigns here too
    });

    const ChildPtr = StatePtrUnion(.{
        Cmd,
    });

    const Result = union(enum) {
        array_of_slice: *std.ArrayList([:0]const u8),
        array_of_ptr: *std.ArrayList(?[*:0]const u8),
    };

    pub fn init(
        interpreter: *Interpreter,
        expansion: *Expansion,
        node: *const ast.Atom,
        parent: ParentPtr,
        out_result: Result,
    ) void {
        // var expansion = interpreter.allocator.create(Expansion) catch bun.outOfMemory();
        expansion.node = node;
        expansion.base = .{ .kind = .expansion, .interpreter = interpreter };
        expansion.parent = parent;

        expansion.word_idx = 0;
        expansion.state = .normal;
        expansion.child_state = .idle;
        expansion.out = out_result;
        expansion.out_idx = 0;
    }

    pub fn start(this: *Expansion) void {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(this.child_state == .idle);
            std.debug.assert(this.word_idx == 0);
        }

        this.state = .normal;
        this.current_out = std.ArrayList(u8).init(this.base.interpreter.allocator);
        this.next();
    }

    pub fn next(this: *Expansion) void {
        while (!(this.state == .done or this.state == .err)) {
            switch (this.state) {
                .normal => {
                    // initialize
                    if (this.word_idx == 0) {
                        var has_unknown = false;
                        // + 1 for sentinel
                        const string_size = this.expansionSizeHint(this.node, &has_unknown);
                        this.current_out.ensureUnusedCapacity(string_size + 1) catch bun.outOfMemory();
                    }

                    while (this.word_idx < this.node.atomsLen()) {
                        const is_cmd_subst = this.expandVarAndCmdSubst(this.word_idx);
                        // yield execution
                        if (is_cmd_subst) return;
                    }

                    if (this.word_idx >= this.node.atomsLen()) {
                        // NOTE brace expansion + cmd subst has weird behaviour we don't support yet, ex:
                        // echo $(echo a b c){1,2,3}
                        // >> a b c1 a b c2 a b c3
                        if (this.node.has_brace_expansion()) {
                            this.state = .braces;
                            continue;
                        }

                        if (this.node.has_glob_expansion()) {
                            this.state = .glob;
                            continue;
                        }
                        this.current_out.append(0) catch bun.outOfMemory();
                        this.pushResult(&this.current_out);
                        this.state = .done;
                        continue;
                    }

                    // Shouldn't fall through to here
                    std.debug.assert(this.word_idx >= this.node.atomsLen());
                    return;
                },
                .braces => {
                    var arena = Arena.init(this.base.interpreter.allocator);
                    defer arena.deinit();
                    var arena_allocator = arena.allocator();
                    const brace_str = this.current_out.items[0..];
                    // FIXME some of these errors aren't alloc errors for example lexer parser errors
                    var lexer_output = Braces.Lexer.tokenize(arena_allocator, brace_str) catch |e| OOM(e);
                    const expansion_count = Braces.calculateExpandedAmount(lexer_output.tokens.items[0..]) catch |e| OOM(e);

                    var expanded_strings = brk: {
                        const stack_max = comptime 16;
                        comptime {
                            std.debug.assert(@sizeOf([]std.ArrayList(u8)) * stack_max <= 256);
                        }
                        var maybe_stack_alloc = std.heap.stackFallback(@sizeOf([]std.ArrayList(u8)) * stack_max, this.base.interpreter.allocator);
                        var expanded_strings = maybe_stack_alloc.get().alloc(std.ArrayList(u8), expansion_count) catch bun.outOfMemory();
                        break :brk expanded_strings;
                    };

                    for (0..expansion_count) |i| {
                        expanded_strings[i] = std.ArrayList(u8).init(this.base.interpreter.allocator);
                    }

                    Braces.expand(
                        arena_allocator,
                        lexer_output.tokens.items[0..],
                        expanded_strings,
                        lexer_output.contains_nested,
                    ) catch bun.outOfMemory();

                    this.outEnsureUnusedCapacity(expansion_count);

                    // Add sentinel values
                    for (0..expansion_count) |i| {
                        expanded_strings[i].append(0) catch bun.outOfMemory();
                        this.pushResult(&expanded_strings[i]);
                    }

                    if (this.node.has_glob_expansion()) {
                        @panic("Support glob expansion after brace expansion");
                    }

                    this.state = .done;
                },
                .glob => {
                    @panic("TODO");
                },
                .done, .err => unreachable,
            }
        }

        if (this.state == .done) {
            this.parent.childDone(this, 0);
        }

        // FIXME handle error state? technically expansion can never fail, I think
    }

    pub fn expandVarAndCmdSubst(this: *Expansion, start_word_idx: u32) bool {
        switch (this.node.*) {
            .simple => |*simp| {
                const is_cmd_subst = this.expandSimpleNoIO(simp, &this.current_out);
                if (is_cmd_subst) {
                    var io: IO = .{};
                    io.stdout = .pipe;
                    var cmd = Cmd.init(this.base.interpreter, &simp.cmd_subst.cmd, Cmd.ParentPtr.init(this), io);
                    this.child_state = .{
                        .cmd_subst = .{
                            .cmd = cmd,
                        },
                    };
                    cmd.start();
                    return true;
                } else {
                    this.word_idx += 1;
                }
            },
            .compound => |cmp| {
                for (cmp.atoms[start_word_idx..]) |*simple_atom| {
                    const is_cmd_subst = this.expandSimpleNoIO(simple_atom, &this.current_out);
                    if (is_cmd_subst) {
                        var io: IO = .{};
                        io.stdout = .pipe;
                        var cmd = Cmd.init(this.base.interpreter, &simple_atom.cmd_subst.cmd, Cmd.ParentPtr.init(this), io);
                        this.child_state = .{
                            .cmd_subst = .{
                                .cmd = cmd,
                            },
                        };
                        cmd.start();
                        return true;
                    } else {
                        this.word_idx += 1;
                        this.child_state = .idle;
                    }
                }
            },
        }

        return false;
    }

    fn childDone(this: *Expansion, child: ChildPtr, exit_code: u8) void {
        _ = exit_code;
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(this.state != .done and this.state != .err);
            std.debug.assert(this.child_state != .idle);
        }

        if (child.ptr.is(Cmd)) {
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.child_state == .cmd_subst);
            }

            var stdout = this.child_state.cmd_subst.cmd.buffered_closed.stdout.?.state.closed.slice();
            this.current_out.appendSlice(stdout) catch bun.outOfMemory();
            // FIXME check if output is empty, trim output, also I think it needs to be split into muliple words?

            this.word_idx += 1;
            this.child_state = .idle;
            child.deinit();
            this.next();
            return;
        }

        unreachable;
    }

    pub fn expandSimpleNoIO(this: *Expansion, atom: *const ast.SimpleAtom, str_list: *std.ArrayList(u8)) bool {
        switch (atom.*) {
            .Text => |txt| {
                str_list.appendSlice(txt) catch bun.outOfMemory();
            },
            .Var => |label| {
                str_list.appendSlice(this.expandVar(label)) catch bun.outOfMemory();
            },
            .asterisk => {
                str_list.append('*') catch bun.outOfMemory();
            },
            .double_asterisk => {
                str_list.appendSlice("**") catch bun.outOfMemory();
            },
            .brace_begin => {
                str_list.append('{') catch bun.outOfMemory();
            },
            .brace_end => {
                str_list.append('}') catch bun.outOfMemory();
            },
            .comma => {
                str_list.append(',') catch bun.outOfMemory();
            },
            .cmd_subst => {
                // if the command substution is comprised of solely shell variable assignments then it should do nothing
                if (atom.cmd_subst.* == .assigns) return false;
                return true;
            },
        }
        return false;
    }

    pub fn appendSlice(this: *Expansion, buf: *std.ArrayList(u8), slice: []const u8) void {
        _ = this;
        buf.appendSlice(slice) catch bun.outOfMemory();
    }

    pub fn pushResult(this: *Expansion, buf: *std.ArrayList(u8)) void {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(buf.items.len > 0 and buf.items[buf.items.len - 1] == 0);
        }

        if (this.out == .array_of_slice) {
            this.out.array_of_slice.append(buf.items[0 .. buf.items.len - 1 :0]) catch bun.outOfMemory();
            return;
        }

        this.out.array_of_ptr.append(@as([*:0]const u8, @ptrCast(buf.items.ptr))) catch bun.outOfMemory();
    }

    fn expandVar(this: *const Expansion, label: []const u8) [:0]const u8 {
        const value = this.base.interpreter.shell_env.get(label) orelse brk: {
            break :brk this.base.interpreter.export_env.get(label) orelse return "";
        };
        return value;
    }

    fn currentWord(this: *Expansion) *const ast.SimpleAtom {
        return switch (this.node) {
            .simple => &this.node.simple,
            .compound => &this.node.compound.atoms[this.word_idx],
        };
    }

    /// Returns the size of the atom when expanded.
    /// If the calculation cannot be computed trivially (cmd substitution, brace expansion), this value is not accurate and `has_unknown` is set to true
    fn expansionSizeHint(this: *const Expansion, atom: *const ast.Atom, has_unknown: *bool) usize {
        return switch (@as(ast.Atom.Tag, atom.*)) {
            .simple => this.expansionSizeHintSimple(&atom.simple, has_unknown),
            .compound => {
                if (atom.compound.brace_expansion_hint) {
                    has_unknown.* = true;
                }

                var out: usize = 0;
                for (atom.compound.atoms) |*simple| {
                    out += this.expansionSizeHintSimple(simple, has_unknown);
                }
                return out;
            },
        };
    }

    fn expansionSizeHintSimple(this: *const Expansion, simple: *const ast.SimpleAtom, has_cmd_subst: *bool) usize {
        return switch (simple.*) {
            .Text => |txt| txt.len,
            .Var => |label| this.expandVar(label).len,
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

    fn outEnsureUnusedCapacity(this: *Expansion, additional: usize) void {
        switch (this.out) {
            .array_of_ptr => {
                this.out.array_of_ptr.ensureUnusedCapacity(additional) catch bun.outOfMemory();
            },
            .array_of_slice => {
                this.out.array_of_slice.ensureUnusedCapacity(additional) catch bun.outOfMemory();
            },
        }
    }
};

/// This meant to be given an arena allocator, so it does not need to worry about deinitialization.
/// This needs to be refactored if we want to mimic behaviour closer to bash.
/// In the shell lexer we strip escaping tokens (single/double quotes, backslashes) because it makes operating on tokens easier.
/// However, this is not what bash does.
pub fn ExpansionCtx(comptime opts: ExpansionOpts) type {
    const Out = if (!opts.for_spawn) [:0]const u8 else [*:0]const u8;

    const ExpansionResult = switch (opts.single) {
        true => struct {
            value: ?Out = null,
            pub fn append(this: *@This(), slice: [:0]const u8) !void {
                if (bun.Environment.allow_assert) {
                    std.debug.assert(this.value == null);
                }
                this.value = slice;
            }

            pub fn appendAssumeCapacity(this: *@This(), slice: [:0]const u8) !void {
                if (bun.Environment.allow_assert) {
                    std.debug.assert(this.value == null);
                }
                this.value = slice;
            }
        },
        false => struct {
            const Arr = if (!opts.for_spawn) std.ArrayList(Out) else std.ArrayList(?Out);
            arr: *Arr,

            pub fn append(this: *@This(), slice: [:0]const u8) !void {
                if (comptime opts.for_spawn) {
                    try this.arr.append(slice.ptr);
                } else {
                    try this.arr.append(slice);
                }
            }

            pub fn appendAssumeCapacity(this: *@This(), slice: [:0]const u8) !void {
                if (comptime opts.for_spawn) {
                    try this.arr.appendAssumeCapacity(slice.ptr);
                } else {
                    try this.arr.appendAssumeCapacity(slice);
                }
            }
        },
    };

    return struct {
        interp: *Interpreter,
        arena: Allocator,
        out: ExpansionResult,

        const This = @This();

        fn init(interp: *Interpreter, arena: Allocator, expand_out: if (!opts.single) *ExpansionResult.Arr else void) @This() {
            if (comptime opts.single) return .{
                .interp = interp,
                .arena = arena,
                .out = .{},
            };

            return .{
                .interp = interp,
                .arena = arena,
                .out = .{ .arr = expand_out },
            };
        }

        fn evalWithBraceExpansion(this: *@This(), word: *const ast.Atom) !void {
            if (bun.Environment.allow_assert) {
                std.debug.assert(word.* == .compound and word.compound.brace_expansion_hint);
            }

            const brace_str = try this.evalNoBraceExpansion(word);
            var lexer_output = try Braces.Lexer.tokenize(this.arena, brace_str);
            const expansion_count = try Braces.calculateExpandedAmount(lexer_output.tokens.items[0..]);

            var expanded_strings = brk: {
                const stack_max = comptime 16;
                comptime {
                    std.debug.assert(@sizeOf([]std.ArrayList(u8)) * stack_max <= 256);
                }
                var maybe_stack_alloc = std.heap.stackFallback(@sizeOf([]std.ArrayList(u8)) * stack_max, this.arena);
                var expanded_strings = try maybe_stack_alloc.get().alloc(std.ArrayList(u8), expansion_count);
                break :brk expanded_strings;
            };

            for (0..expansion_count) |i| {
                expanded_strings[i] = std.ArrayList(u8).init(this.arena);
            }

            try Braces.expand(
                this.arena,
                lexer_output.tokens.items[0..],
                expanded_strings,
                lexer_output.contains_nested,
            );

            try this.out.arr.ensureUnusedCapacity(expansion_count);
            // Add sentinel values
            for (0..expansion_count) |i| {
                try expanded_strings[i].append(0);
                this.out.appendAssumeCapacity(expanded_strings[i].items[0 .. expanded_strings[i].items.len - 1 :0]);
            }
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
    expansion,

    // pub fn toStruct(comptime this: StateKind) type {
    //     return switch (this) {
    //         .script => Script,
    //         .stmt => Stmt,
    //         .cmd => Cmd,
    //         .cond => Cond,
    //         .pipeline => Pipeline,
    //         .expansion
    //     };
    // }
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

/// In pipelines and conditional expressions, assigns (e.g. `FOO=bar BAR=baz &&
/// echo hi` or `FOO=bar BAR=baz | echo hi`) have no effect on the environment
/// of the shell, so we can skip them.
const AssignChild = struct {
    const ParentPtr = StatePtrUnion(.{
        Stmt,
        Cond,
        Pipeline,
    });

    pub inline fn deinit(this: AssignChild) void {
        _ = this;
    }

    pub inline fn start(this: AssignChild) void {
        _ = this;
    }

    pub fn exec(
        interpreter: *Interpreter,
        parent: ParentPtr,
        assigns: []const ast.Assign,
        assign_ctx: AssignCtx,
    ) void {
        for (assigns) |*assign| {
            interpreter.assignVar(assign, assign_ctx);
        }
        var assign_child: AssignChild = .{};
        parent.childDone(&assign_child, 0);
    }

    pub fn execNoCallParent(interpreter: *Interpreter, assigns: []const ast.Assign, assign_ctx: AssignCtx) void {
        for (assigns) |*assign| {
            interpreter.assignVar(assign, assign_ctx);
        }
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
        AssignChild,
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
            .assign => |assigns| {
                AssignChild.exec(this.base.interpreter, AssignChild.ParentPtr.init(this), assigns, .shell);
            },
        }
    }

    pub fn childDone(this: *Stmt, child: ChildPtr, exit_code: u8) void {
        log("child done Stmt {x} child({s})={x} exit={d}", .{ @intFromPtr(this), child.tagName(), @as(usize, @intCast(child.ptr.repr._ptr)), exit_code });
        this.last_exit_code = exit_code;
        const next_idx = this.idx + 1;
        child.deinit();
        this.currently_executing = null;
        if (next_idx >= this.node.exprs.len)
            return this.parent.childDone(Script.ChildPtr.init(this), exit_code);

        const next_child = &this.node.exprs[next_idx];
        switch (next_child.*) {
            .cond => {
                const cond = Cond.init(this.base.interpreter, next_child.cond, Cond.ParentPtr.init(this), this.io);
                cond.start();
                this.currently_executing = ChildPtr.init(cond);
            },
            .assign => |assigns| {
                AssignChild.exec(this.base.interpreter, AssignChild.ParentPtr.init(this), assigns, .shell);
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

    const ChildPtr = StatePtrUnion(.{
        Cmd,
        Pipeline,
        Cond,
        AssignChild,
    });

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
        if (this.currently_executing == null) {
            this.currently_executing = this.makeChild(false);
            this.left = 0;
        }
        var child = this.currently_executing.?.as(Cmd);
        child.start();
    }

    /// Returns null if child is assignments
    fn makeChild(this: *Cond, left: bool) ?ChildPtr {
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
            .pipeline => {
                const pipeline = Pipeline.init(this.base.interpreter, node.pipeline, Pipeline.ParentPtr.init(this), this.io);
                return ChildPtr.init(pipeline);
            },
            .assign => return null,
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
            if (this.currently_executing == null) {
                this.right = 0;
                this.parent.childDone(this, 0);
                return;
            } else {
                this.currently_executing.?.as(Cmd).start();
            }
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
        AssignChild,
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
        if (this.pipes) |pipes| {
            this.base.interpreter.allocator.free(pipes);
        }
        if (this.cmds) |cmds| {
            this.base.interpreter.allocator.free(cmds);
        }
        this.base.interpreter.allocator.destroy(this);
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
    parent: ParentPtr,

    spawn_arena: Arena,
    args: std.ArrayList(?[*:0]const u8),

    /// Expansion state
    expansion: Expansion,
    name_and_args_idx: u32,

    cmd: ?*Subprocess,
    exit_code: ?u8,
    io: IO,
    buffered_closed: BufferedIoClosed = .{},

    const BufferedIoClosed = struct {
        stdin: ?BufferedIoState = null,
        stdout: ?BufferedIoState = null,
        stderr: ?BufferedIoState = null,

        const BufferedIoState = struct {
            state: union(enum) {
                open,
                closed: bun.ByteList,
            } = .open,
            owned: bool = false,

            pub fn deinit(this: *BufferedIoState, jsc_vm_allocator: Allocator) void {
                if (this.state == .closed and this.owned) {
                    var list = bun.ByteList.listManaged(this.state.closed, jsc_vm_allocator);
                    list.deinit();
                    this.state.closed = .{};
                }
            }

            pub fn closed(this: *BufferedIoState) bool {
                return this.state == .closed;
            }
        };

        fn deinit(this: *BufferedIoClosed, jsc_vm_allocator: Allocator) void {
            if (this.stdin) |*io| {
                io.deinit(jsc_vm_allocator);
            }

            if (this.stdout) |*io| {
                io.deinit(jsc_vm_allocator);
            }

            if (this.stderr) |*io| {
                io.deinit(jsc_vm_allocator);
            }
        }

        fn allClosed(this: *BufferedIoClosed) bool {
            return (if (this.stdin) |*stdin| stdin.closed() else true) and
                (if (this.stdout) |*stdout| stdout.closed() else true) and
                (if (this.stderr) |*stderr| stderr.closed() else true);
        }

        fn close(this: *BufferedIoClosed, io: union(enum) { stdout: *Subprocess.Readable, stderr: *Subprocess.Readable, stdin }) void {
            switch (io) {
                .stdout => {
                    if (this.stdout) |*stdout| {
                        var readable = io.stdout;
                        stdout.state = .{ .closed = readable.pipe.buffer.internal_buffer };
                        io.stdout.pipe.buffer.internal_buffer = .{};
                    }
                },
                .stderr => {
                    if (this.stderr) |*stderr| {
                        var readable = io.stderr;
                        stderr.state = .{ .closed = readable.pipe.buffer.internal_buffer };
                        io.stderr.pipe.buffer.internal_buffer = .{};
                    }
                },
                .stdin => {
                    if (this.stdin) |*stdin| {
                        stdin.state = .{ .closed = .{} };
                    }
                },
            }
        }

        fn isBuffered(this: *BufferedIoClosed, comptime io: enum { stdout, stderr, stdin }) bool {
            return @field(this, @tagName(io)) != null;
        }

        fn fromStdio(io: *const [3]Subprocess.Stdio) BufferedIoClosed {
            return .{
                .stdin = if (io[bun.STDIN_FD].isPiped()) .{ .owned = io[bun.STDIN_FD] == .pipe } else null,
                .stdout = if (io[bun.STDOUT_FD].isPiped()) .{ .owned = io[bun.STDOUT_FD] == .pipe } else null,
                .stderr = if (io[bun.STDERR_FD].isPiped()) .{ .owned = io[bun.STDERR_FD] == .pipe } else null,
            };
        }
    };

    const ParentPtr = StatePtrUnion(.{
        Stmt,
        Cond,
        Pipeline,
        Expansion,
        // TODO
        // .subst = void,
    });

    const ChildPtr = StatePtrUnion(.{
        Expansion,
    });

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

        cmd.spawn_arena = Arena.init(interpreter.allocator);
        cmd.args = std.ArrayList(?[*:0]const u8).initCapacity(cmd.spawn_arena.allocator(), node.name_and_args.len) catch bun.outOfMemory();

        cmd.exit_code = null;
        cmd.io = io;
        cmd.buffered_closed = .{};

        Expansion.init(
            interpreter,
            &cmd.expansion,
            &node.name_and_args[0],
            Expansion.ParentPtr.init(cmd),
            .{
                .array_of_ptr = &cmd.args,
            },
        );
        cmd.name_and_args_idx = 0;

        return cmd;
    }

    pub fn start(this: *Cmd) void {
        log("cmd start {x}", .{@intFromPtr(this)});
        this.expansion.start();
    }

    pub fn run(this: *Cmd) void {
        this.initSubproc() catch |err| {
            // FIXME this is bad
            std.debug.print("THIS THE ERROR: {any}\n", .{err});
            bun.outOfMemory();
        };
    }

    pub fn childDone(this: *Cmd, child: ChildPtr, exit_code: u8) void {
        _ = exit_code;
        if (child.ptr.is(Expansion)) {
            this.name_and_args_idx += 1;
            if (this.name_and_args_idx >= this.node.name_and_args.len) {
                this.run();
                return;
            }

            // FIXME deinit expansion
            Expansion.init(
                this.base.interpreter,
                &this.expansion,
                &this.node.name_and_args[this.name_and_args_idx],
                Expansion.ParentPtr.init(this),
                .{
                    .array_of_ptr = &this.args,
                },
            );
            this.expansion.start();
            return;
        }
        unreachable;
    }

    fn initSubproc(this: *Cmd) !void {
        log("cmd init subproc ({x})", .{@intFromPtr(this)});
        this.base.interpreter.cmd_local_env.clearRetainingCapacity();

        var arena = bun.ArenaAllocator.init(this.base.interpreter.allocator);
        var arena_allocator = arena.allocator();
        defer arena.deinit();

        for (this.node.assigns) |*assign| {
            this.base.interpreter.assignVar(assign, .cmd);
        }

        var spawn_args = Subprocess.SpawnArgs.default(&arena, this.base.interpreter.global.bunVM(), false);

        // Fill the env from the export end and cmd local env
        {
            var env_iter = this.base.interpreter.export_env.iterator();
            if (!spawn_args.fillEnv(&env_iter, false)) {
                return ShellError.GlobalThisThrown;
            }
            env_iter = this.base.interpreter.cmd_local_env.iterator();
            if (!spawn_args.fillEnv(&env_iter, false)) {
                return ShellError.GlobalThisThrown;
            }
        }

        spawn_args.argv = std.ArrayListUnmanaged(?[*:0]const u8){};
        spawn_args.cmd_parent = this;

        const args = args: {
            try this.args.append(null);

            for (this.args.items) |maybe_arg| {
                if (maybe_arg) |arg| {
                    log("ARG: {s}\n", .{arg});
                }
            }

            const first_arg = this.args.items[0] orelse {
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
            this.args.items[0] = duped;

            break :args this.args;
        };
        spawn_args.argv = std.ArrayListUnmanaged(?[*:0]const u8){ .items = args.items, .capacity = args.capacity };

        this.io.to_subproc_stdio(&spawn_args.stdio);

        if (this.node.redirect_file) |redirect| {
            const in_cmd_subst = false;

            if (comptime in_cmd_subst) {
                if (this.node.redirect.stdin) {
                    spawn_args.stdio[bun.STDIN_FD] = .ignore;
                }

                if (this.node.redirect.stdout) {
                    spawn_args.stdio[bun.STDOUT_FD] = .ignore;
                }

                if (this.node.redirect.stderr) {
                    spawn_args.stdio[bun.STDERR_FD] = .ignore;
                }
            } else switch (redirect) {
                .jsbuf => |val| {
                    if (this.base.interpreter.jsobjs[val.idx].asArrayBuffer(this.base.interpreter.global)) |buf| {
                        var stdio: Subprocess.Stdio = .{ .array_buffer = .{
                            .buf = JSC.ArrayBuffer.Strong{
                                .array_buffer = buf,
                                .held = JSC.Strong.create(buf.value, this.base.interpreter.global),
                            },
                            .from_jsc = true,
                        } };

                        if (this.node.redirect.stdin) {
                            spawn_args.stdio[bun.STDIN_FD] = stdio;
                        }

                        if (this.node.redirect.stdout) {
                            spawn_args.stdio[bun.STDOUT_FD] = stdio;
                        }

                        if (this.node.redirect.stderr) {
                            spawn_args.stdio[bun.STDERR_FD] = stdio;
                        }
                    } else if (this.base.interpreter.jsobjs[val.idx].as(JSC.WebCore.Blob)) |blob| {
                        if (this.node.redirect.stdout) {
                            if (!Subprocess.extractStdioBlob(this.base.interpreter.global, .{ .Blob = blob.dupe() }, bun.STDOUT_FD, &spawn_args.stdio)) {
                                @panic("FIXME OOPS");
                            }
                        }

                        if (this.node.redirect.stdin) {
                            if (!Subprocess.extractStdioBlob(this.base.interpreter.global, .{ .Blob = blob.dupe() }, bun.STDIN_FD, &spawn_args.stdio)) {
                                @panic("FIXME OOPS");
                            }
                        }

                        if (this.node.redirect.stderr) {
                            if (!Subprocess.extractStdioBlob(this.base.interpreter.global, .{ .Blob = blob.dupe() }, bun.STDERR_FD, &spawn_args.stdio)) {
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

        this.buffered_closed = BufferedIoClosed.fromStdio(&spawn_args.stdio);
        log("cmd ({x}) set buffered closed => {any}", .{ @intFromPtr(this), this.buffered_closed });

        const subproc = (try Subprocess.spawnAsync(this.base.interpreter.global, spawn_args)) orelse return ShellError.Spawn;
        subproc.ref();
        this.cmd = subproc;

        // if (this.cmd.stdout == .pipe and this.cmd.stdout.pipe == .buffer) {
        //     this.cmd.?.stdout.pipe.buffer.watch();
        // }
    }

    pub fn expectStdoutSlice(this: *Cmd) []const u8 {
        if (this.cmd.?.stdout.pipe != .buffer) @panic("FIXME support stream stdout");
        return this.cmd.?.stdout.pipe.buffer.internal_buffer.slice();
    }

    pub fn hasFinished(this: *Cmd) bool {
        return this.exit_code != null and this.buffered_closed.allClosed();
    }

    pub fn onExit(this: *Cmd, exit_code: u8) void {
        log("cmd exit code={d} ({x})", .{ exit_code, @intFromPtr(this) });
        this.exit_code = exit_code;

        const has_finished = this.hasFinished();
        if (has_finished) {
            this.parent.childDone(this, exit_code);
        }
        // } else {
        //     this.cmd.?.stdout.pipe.buffer.readAll();
        // }
    }

    // TODO check that this also makes sure that the poll ref is killed because if it isn't then this Cmd pointer will be stale and so when the event for pid exit happens it will cause crash
    pub fn deinit(this: *Cmd) void {
        log("cmd deinit {x}", .{@intFromPtr(this)});
        // if (this.exit_code != null) {
        //     if (this.cmd) |cmd| {
        //         _ = cmd.tryKill(9);
        //         cmd.unref(true);
        //         cmd.deinit();
        //     }
        // }

        // if (this.cmd) |cmd| {
        //     if (cmd.hasExited()) {
        //         cmd.unref(true);
        //         // cmd.deinit();
        //     } else {
        //         _ = cmd.tryKill(9);
        //         cmd.unref(true);
        //         cmd.deinit();
        //     }
        //     this.cmd = null;
        // }

        if (this.cmd) |cmd| {
            if (cmd.hasExited()) {
                cmd.unref(true);
                // cmd.deinit();
            } else {
                _ = cmd.tryKill(9);
                cmd.unref(true);
                cmd.deinit();
            }
            this.cmd = null;
        }

        this.buffered_closed.deinit(this.base.interpreter.global.bunVM().allocator);
        this.base.interpreter.allocator.destroy(this);
    }

    pub fn bufferedOutputClose(this: *Cmd, kind: Subprocess.OutKind) void {
        switch (kind) {
            .stdout => this.bufferedOutputCloseStdout(),
            .stderr => this.bufferedOutputCloseStderr(),
        }
        if (this.hasFinished()) {
            this.parent.childDone(this, this.exit_code orelse 0);
        }
    }

    pub fn bufferedOutputCloseStdout(this: *Cmd) void {
        log("cmd ({x}) close buffered stdout", .{@intFromPtr(this)});
        assert(this.cmd != null, "bufferedOutputCloseStdout called while cmd is null");
        var subproc = this.cmd.?;
        this.buffered_closed.close(.{ .stdout = &subproc.stdout });
        subproc.closeIO(.stdout);
    }

    pub fn bufferedOutputCloseStderr(this: *Cmd) void {
        log("cmd ({x}) close buffered stderr", .{@intFromPtr(this)});
        assert(this.cmd != null, "bufferedOutputCloseStderr called while cmd is null");
        var subproc = this.cmd.?;
        this.buffered_closed.close(.{ .stderr = &subproc.stderr });
        subproc.closeIO(.stderr);
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

                    // if (@hasField(MaybeChild(@TypeOf(casted)), "deinit")) {
                    casted.deinit();
                    // }
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

        fn tagName(this: @This()) []const u8 {
            return Ptr.typeNameFromTag(this.tagInt()).?;
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

const lol = struct {
    const pipeline_t = struct {};
};
