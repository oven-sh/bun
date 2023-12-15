//! The interpreter for the shell language
//!
//! Normally, the implementation would be a very simple tree-walk of the AST,
//! but it needs to be non-blocking, and Zig does not have coroutines yet, so
//! this implementation is half tree-walk half one big state machine. The state
//! machine part manually keeps track of execution state (which coroutines would
//! do for us), but makes the code very confusing because control flow is less obvious.
//!
const bun = @import("root").bun;
const std = @import("std");
const os = std.os;
const builtin = @import("builtin");
const Arena = std.heap.ArenaAllocator;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const JSPromise = bun.JSC.JSPromise;
const JSGlobalObject = bun.JSC.JSGlobalObject;
const which = @import("../which.zig").which;
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
pub const WorkPoolTask = @import("../work_pool.zig").Task;
pub const WorkPool = @import("../work_pool.zig").WorkPool;
const Maybe = @import("../bun.js/node/types.zig").Maybe;

const Pipe = [2]bun.FileDescriptor;
const shell = @import("./shell.zig");
const Token = shell.Token;
const ShellError = shell.ShellError;
const ast = shell.AST;

const GlobWalker = @import("../glob.zig").GlobWalker_(null, true);

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

const EnvMap = std.StringArrayHashMap([:0]const u8);

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

    /// The current working directory of the shell
    __prevcwd_pathbuf: ?*[bun.MAX_PATH_BYTES]u8 = null,
    prev_cwd: [:0]const u8,
    __cwd_pathbuf: *[bun.MAX_PATH_BYTES]u8,
    cwd: [:0]const u8,
    // FIXME TODO deinit
    cwd_fd: bun.FileDescriptor,

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

        var pathbuf = try arena.allocator().alloc(u8, bun.MAX_PATH_BYTES);

        const cwd = switch (Syscall.getcwd(@as(*[1024]u8, @ptrCast(pathbuf.ptr)))) {
            .result => |cwd| cwd.ptr[0..cwd.len :0],
            .err => |err| {
                const errJs = err.toJSC(global);
                global.throwValue(errJs);
                return ShellError.Init;
            },
        };

        const cwd_fd = switch (Syscall.open(cwd, std.os.O.DIRECTORY | std.os.O.RDONLY, 0)) {
            .result => |fd| fd,
            .err => |err| {
                const errJs = err.toJSC(global);
                global.throwValue(errJs);
                return ShellError.Init;
            },
        };

        interpreter.* = .{
            .global = global,

            .shell_env = std.StringArrayHashMap([:0]const u8).init(allocator),
            .cmd_local_env = std.StringArrayHashMap([:0]const u8).init(allocator),
            .export_env = export_env,

            .script = script,
            .allocator = allocator,
            .promise = .{},
            .jsobjs = jsobjs,
            .__cwd_pathbuf = @ptrCast(pathbuf.ptr),
            .cwd = pathbuf[0..cwd.len :0],
            .prev_cwd = pathbuf[0..cwd.len :0],
            .cwd_fd = cwd_fd,

            .arena = arena.*,
        };

        var promise = JSC.JSPromise.create(global);
        interpreter.promise.strong.set(global, promise.asValue(global));
        return interpreter;
    }

    pub fn start(this: *Interpreter, globalThis: *JSGlobalObject) !JSValue {
        _ = globalThis;
        var root = try Script.init(this, this.script, .{});
        const value = this.promise.value();
        try root.start();
        return value;
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

    fn changePrevCwd(self: *Interpreter) Maybe(void) {
        return self.changeCwd(self.prev_cwd);
    }

    fn changeCwd(self: *Interpreter, new_cwd_: [:0]const u8) Maybe(void) {
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
                return Maybe(void).initErr(err);
            },
        };
        _ = Syscall.close2(self.cwd_fd);

        var prev_cwd_buf = brk: {
            if (self.__prevcwd_pathbuf) |prev| break :brk prev;
            break :brk self.allocator.alloc(u8, bun.MAX_PATH_BYTES) catch bun.outOfMemory();
        };

        std.mem.copyForwards(u8, prev_cwd_buf[0..self.cwd.len], self.cwd[0..self.cwd.len]);
        prev_cwd_buf[self.cwd.len] = 0;
        self.prev_cwd = prev_cwd_buf[0..self.cwd.len :0];

        std.mem.copyForwards(u8, self.__cwd_pathbuf[0..new_cwd.len], new_cwd[0..new_cwd.len]);
        self.__cwd_pathbuf[new_cwd.len] = 0;
        self.cwd = new_cwd;

        self.cwd_fd = new_cwd_fd;

        return Maybe(void).success;
    }

    fn getHomedir(self: *Interpreter) [:0]const u8 {
        if (comptime bun.Environment.isWindows) {
            if (self.export_env.get("USERPROFILE")) |env|
                return env;
        } else {
            if (self.export_env.get("HOME")) |env|
                return env;
        }
        return "unknown";
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
        glob: struct {
            initialized: bool = false,
            walker: GlobWalker,
        },
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

        pub fn pushResultSlice(this: *Result, buf: [:0]const u8) void {
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(buf.len > 0 and buf[buf.len] == 0);
            }

            if (this.* == .array_of_slice) {
                this.array_of_slice.append(buf) catch bun.outOfMemory();
                return;
            }

            this.array_of_ptr.append(@as([*:0]const u8, @ptrCast(buf.ptr))) catch bun.outOfMemory();
        }

        pub fn pushResult(this: *Result, buf: *std.ArrayList(u8)) void {
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(buf.items.len > 0 and buf.items[buf.items.len - 1] == 0);
            }

            if (this.* == .array_of_slice) {
                this.array_of_slice.append(buf.items[0 .. buf.items.len - 1 :0]) catch bun.outOfMemory();
                return;
            }

            this.array_of_ptr.append(@as([*:0]const u8, @ptrCast(buf.items.ptr))) catch bun.outOfMemory();
        }
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
                        this.state = .glob;
                    } else {
                        this.state = .done;
                    }
                },
                .glob => {
                    this.transitionToGlobState();
                    // yield
                    return;
                },
                .done, .err => unreachable,
            }
        }

        if (this.state == .done) {
            this.parent.childDone(this, 0);
            return;
        }

        // FIXME handle error state? technically expansion can never fail, I think
    }

    fn transitionToGlobState(this: *Expansion) void {
        var arena = Arena.init(this.base.interpreter.allocator);
        this.child_state = .{ .glob = .{ .walker = .{} } };
        const pattern = this.current_out.items[0..];

        switch (GlobWalker.init(&this.child_state.glob.walker, &arena, pattern, false, false, false, false, false) catch bun.outOfMemory()) {
            .result => {},
            .err => |e| {
                std.debug.print("THE ERROR: {any}\n", .{e});
                @panic("FIXME TODO HANDLE ERRORS!");
            },
        }

        var task = ShellGlobTask.createOnJSThread(this.base.interpreter.allocator, &this.child_state.glob.walker, this);
        task.schedule();
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

        // Command substitution
        if (child.ptr.is(Cmd)) {
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.child_state == .cmd_subst);
            }

            var stdout = this.child_state.cmd_subst.cmd.stdoutSlice() orelse @panic("Should not happen");
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

    fn onGlobWalkDone(this: *Expansion, task: *ShellGlobTask) void {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(this.child_state == .glob);
        }

        if (task.err != null) {
            @panic("FIXME Handle errors");
        }

        for (task.result.items) |sentinel_str| {
            // The string is allocated in the glob walker arena and will be freed, so needs to be duped here
            const duped = this.base.interpreter.allocator.dupeZ(u8, sentinel_str[0..sentinel_str.len]) catch bun.outOfMemory();
            this.pushResultSlice(duped);
        }

        this.word_idx += 1;
        this.child_state.glob.walker.deinit(true);
        this.child_state = .idle;
        this.state = .done;
        this.next();
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

    pub fn pushResultSlice(this: *Expansion, buf: [:0]const u8) void {
        this.out.pushResultSlice(buf);
        // if (comptime bun.Environment.allow_assert) {
        //     std.debug.assert(buf.len > 0 and buf[buf.len] == 0);
        // }

        // if (this.out == .array_of_slice) {
        //     this.out.array_of_slice.append(buf) catch bun.outOfMemory();
        //     return;
        // }

        // this.out.array_of_ptr.append(@as([*:0]const u8, @ptrCast(buf.ptr))) catch bun.outOfMemory();
    }

    pub fn pushResult(this: *Expansion, buf: *std.ArrayList(u8)) void {
        this.out.pushResult(buf);
        // if (comptime bun.Environment.allow_assert) {
        //     std.debug.assert(buf.items.len > 0 and buf.items[buf.items.len - 1] == 0);
        // }

        // if (this.out == .array_of_slice) {
        //     this.out.array_of_slice.append(buf.items[0 .. buf.items.len - 1 :0]) catch bun.outOfMemory();
        //     return;
        // }

        // this.out.array_of_ptr.append(@as([*:0]const u8, @ptrCast(buf.items.ptr))) catch bun.outOfMemory();
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
                    @panic("Invalid here");
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

pub const State = struct {
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
    state: union(enum) {},

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
    // state: union(enum) {
    //     idle,
    //     wait_child,
    //     child_done,
    //     done,
    // },

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

    // pub fn next(this: *Stmt) void {
    //     _ = this;
    // }

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
        var data = child.ptr.repr.data;
        log("child done Stmt {x} child({s})={x} exit={d}", .{ @intFromPtr(this), child.tagName(), @as(usize, @intCast(child.ptr.repr._ptr)), exit_code });
        this.last_exit_code = exit_code;
        const next_idx = this.idx + 1;
        var data2 = child.ptr.repr.data;
        log("{d} {d}", .{ data, data2 });
        child.deinit();
        this.currently_executing = null;
        if (next_idx >= this.node.exprs.len)
            return this.parent.childDone(Script.ChildPtr.init(this), exit_code);

        const next_child = &this.node.exprs[next_idx];
        switch (next_child.*) {
            .cond => {
                const cond = Cond.init(this.base.interpreter, next_child.cond, Cond.ParentPtr.init(this), this.io);
                this.currently_executing = ChildPtr.init(cond);
                cond.start();
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
        log("conditional child done {x} ({s}) {s}", .{ @intFromPtr(this), @tagName(this.node.op), if (this.left == null) "left" else "right" });

        child.deinit();
        this.currently_executing = null;

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

    spawn_arena: bun.ArenaAllocator,
    /// This allocated by the above arena
    args: std.ArrayList(?[*:0]const u8),

    exec: Exec = .none,
    exit_code: ?u8 = null,
    io: IO,
    freed: bool = false,

    state: union(enum) {
        expansion: struct {
            idx: u32 = 0,
            expansion: Expansion,
        },
        exec,
        done,
        err: Syscall.Error,
    },

    pub const Exec = union(enum) {
        none,
        bltn: Builtin,
        subproc: struct {
            child: *Subprocess,
            buffered_closed: BufferedIoClosed = .{},
        },
    };

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

            /// BufferedInput/Output uses jsc vm allocator
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
        cmd.* = .{
            .base = .{ .kind = .cmd, .interpreter = interpreter },
            .node = node,
            .parent = parent,

            .spawn_arena = bun.ArenaAllocator.init(interpreter.allocator),
            .args = std.ArrayList(?[*:0]const u8).initCapacity(cmd.spawn_arena.allocator(), node.name_and_args.len) catch bun.outOfMemory(),

            .exit_code = null,
            .io = io,
            .state = .{
                .expansion = .{ .idx = 0, .expansion = undefined },
            },
        };

        return cmd;
    }

    pub fn next(this: *Cmd) void {
        while (!(this.state == .done or this.state == .err)) {
            switch (this.state) {
                .expansion => {
                    if (this.state.expansion.idx >= this.node.name_and_args.len) {
                        this.transitionToExecStateAndYield();
                        // yield execution to subproc
                        return;
                    }

                    Expansion.init(
                        this.base.interpreter,
                        &this.state.expansion.expansion,
                        &this.node.name_and_args[this.state.expansion.idx],
                        Expansion.ParentPtr.init(this),
                        .{
                            .array_of_ptr = &this.args,
                        },
                    );

                    this.state.expansion.idx += 1;

                    this.state.expansion.expansion.start();
                    // yield execution to expansion
                    return;
                },
                .exec => {
                    // yield execution to subproc/builtin
                    return;
                },
                .done, .err => unreachable,
            }
        }

        if (this.state == .done) {
            this.parent.childDone(this, this.exit_code.?);
            return;
        }

        @panic("FIXME TODO handle error Cmd");
    }

    fn transitionToExecStateAndYield(this: *Cmd) void {
        this.state = .exec;
        this.initSubproc() catch |err| {
            // FIXME this might throw errors other than allocations so this is bad need to handle this properly
            std.debug.print("THIS THE ERROR: {any}\n", .{err});
            bun.outOfMemory();
        };
    }

    pub fn start(this: *Cmd) void {
        log("cmd start {x}", .{@intFromPtr(this)});
        return this.next();
    }

    pub fn childDone(this: *Cmd, child: ChildPtr, exit_code: u8) void {
        _ = exit_code;
        if (child.ptr.is(Expansion)) {
            this.next();
            return;
        }
        unreachable;
    }

    fn initSubproc(this: *Cmd) !void {
        log("cmd init subproc ({x})", .{@intFromPtr(this)});
        this.base.interpreter.cmd_local_env.clearRetainingCapacity();

        var arena = &this.spawn_arena;
        var arena_allocator = arena.allocator();

        for (this.node.assigns) |*assign| {
            this.base.interpreter.assignVar(assign, .cmd);
        }

        var spawn_args = Subprocess.SpawnArgs.default(arena, this.base.interpreter.global.bunVM(), false);

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

            if (Builtin.Kind.fromStr(first_arg[0..first_arg_len])) |b| {
                _ = Builtin.init(
                    this,
                    this.base.interpreter,
                    b,
                    arena,
                    this.node,
                    &this.args,
                    this.base.interpreter.export_env.cloneWithAllocator(arena_allocator) catch bun.outOfMemory(),
                    this.base.interpreter.cmd_local_env.cloneWithAllocator(arena_allocator) catch bun.outOfMemory(),
                    &this.io,
                    false,
                );

                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.exec == .bltn);
                }

                log("WTF: {s}", .{@tagName(this.exec)});

                switch (this.exec.bltn.start()) {
                    .result => {},
                    .err => |e| {
                        _ = e;
                        @panic("FIXME TODO HANDLE THIS!");
                    },
                }
                return;
            }

            var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            var resolved = which(&path_buf, spawn_args.PATH, spawn_args.cwd, first_arg[0..first_arg_len]) orelse {
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

        const buffered_closed = BufferedIoClosed.fromStdio(&spawn_args.stdio);
        log("cmd ({x}) set buffered closed => {any}", .{ @intFromPtr(this), buffered_closed });

        const subproc = (try Subprocess.spawnAsync(this.base.interpreter.global, spawn_args)) orelse return ShellError.Spawn;
        this.exec = .{ .subproc = .{
            .child = subproc,
            .buffered_closed = buffered_closed,
        } };
        subproc.ref();

        // if (this.cmd.stdout == .pipe and this.cmd.stdout.pipe == .buffer) {
        //     this.cmd.?.stdout.pipe.buffer.watch();
        // }
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
                    else => return null,
                }
            },
        }
    }

    pub fn hasFinished(this: *Cmd) bool {
        if (this.exit_code == null) return false;
        if (this.exec != .none) {
            if (this.exec == .subproc) return this.exec.subproc.buffered_closed.allClosed();
            return this.exec.bltn.ioAllClosed();
        }
        return true;
    }

    pub fn onExit(this: *Cmd, exit_code: u8) void {
        log("cmd exit code={d} ({x})", .{ exit_code, @intFromPtr(this) });
        this.exit_code = exit_code;

        const has_finished = this.hasFinished();
        if (has_finished) {
            this.state = .done;
            this.next();
            return;
            // this.parent.childDone(this, exit_code);
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

        log("WTF: {s}", .{@tagName(this.exec)});
        if (this.exec != .none) {
            if (this.exec == .subproc) {
                var cmd = this.exec.subproc.child;
                if (cmd.hasExited()) {
                    cmd.unref(true);
                    // cmd.deinit();
                } else {
                    _ = cmd.tryKill(9);
                    cmd.unref(true);
                    cmd.deinit();
                }
                this.exec.subproc.buffered_closed.deinit(this.base.interpreter.global.bunVM().allocator);
            } else {
                this.exec.bltn.deinit();
            }
            this.exec = .none;
        }

        // this.spawn_arena.deinit();
        this.freed = true;
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
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(this.exec == .subproc);
        }
        log("cmd ({x}) close buffered stdout", .{@intFromPtr(this)});
        this.exec.subproc.buffered_closed.close(.{ .stdout = &this.exec.subproc.child.stdout });
        this.exec.subproc.child.closeIO(.stdout);
    }

    pub fn bufferedOutputCloseStderr(this: *Cmd) void {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(this.exec == .subproc);
        }
        log("cmd ({x}) close buffered stderr", .{@intFromPtr(this)});
        this.exec.subproc.buffered_closed.close(.{ .stderr = &this.exec.subproc.child.stderr });
        this.exec.subproc.child.closeIO(.stderr);
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

/// A concurrent task, the idea is that this task is not heap allocated because
/// it will be in a field of one of the Shell state structs which will be heap
/// allocated.
pub fn ShellTask(
    comptime Ctx: type,
    /// Function to be called when the thread pool starts the task, this could
    /// be on anyone of the thread pool threads so be mindful of concurrency
    /// nuances
    comptime runFromThreadPool_: fn (*Ctx) void,
    /// Function that is called on the main thread, once the event loop
    /// processes that the task is done
    comptime runFromJS_: fn (*Ctx) void,
    comptime print: fn (comptime fmt: []const u8, args: anytype) void,
) type {
    return struct {
        task: WorkPoolTask = .{ .callback = &runFromThreadPool },
        event_loop: *JSC.EventLoop,
        // This is a poll because we want it to enter the uSockets loop
        ref: bun.Async.KeepAlive = .{},
        concurrent_task: JSC.ConcurrentTask = .{},

        pub const InnerShellTask = @This();

        pub fn schedule(this: *@This()) void {
            print("schedule", .{});
            this.ref.ref(this.event_loop.virtual_machine);
            WorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *@This()) void {
            print("onFinish", .{});
            var ctx = @fieldParentPtr(Ctx, "task", this);
            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(ctx, .manual_deinit));
        }

        pub fn runFromThreadPool(task: *WorkPoolTask) void {
            print("runFromThreadPool", .{});
            var this = @fieldParentPtr(@This(), "task", task);
            var ctx = @fieldParentPtr(Ctx, "task", this);
            runFromThreadPool_(ctx);
            this.onFinish();
        }

        pub fn runFromJS(this: *@This()) void {
            print("runFromJS", .{});
            var ctx = @fieldParentPtr(Ctx, "task", this);
            this.ref.unref(this.event_loop.virtual_machine);
            runFromJS_(ctx);
        }
    };
}

pub const ShellGlobTask = struct {
    const print = bun.Output.scoped(.ShellGlobTask, false);

    task: WorkPoolTask = .{ .callback = &runFromThreadPool },

    /// Not owned by this struct
    expansion: *Expansion,
    /// Not owned by this struct
    walker: *GlobWalker,

    result: std.ArrayList([:0]const u8),
    allocator: Allocator,
    event_loop: *JSC.EventLoop,
    concurrent_task: JSC.ConcurrentTask = .{},
    // This is a poll because we want it to enter the uSockets loop
    ref: bun.Async.KeepAlive = .{},
    err: ?Err = null,

    const This = @This();

    pub const Err = union(enum) {
        syscall: Syscall.Error,
        unknown: anyerror,

        pub fn toJSC(this: Err, globalThis: *JSGlobalObject) JSValue {
            return switch (this) {
                .syscall => |err| err.toJSC(globalThis),
                .unknown => |err| JSC.ZigString.fromBytes(@errorName(err)).toValueGC(globalThis),
            };
        }
    };

    pub fn createOnJSThread(allocator: Allocator, walker: *GlobWalker, expansion: *Expansion) *This {
        print("createOnJSThread", .{});
        var this = allocator.create(This) catch bun.outOfMemory();
        this.* = .{
            .event_loop = JSC.VirtualMachine.get().event_loop,
            .walker = walker,
            .allocator = allocator,
            .expansion = expansion,
            .result = std.ArrayList([:0]const u8).init(allocator),
        };
        this.ref.ref(this.event_loop.virtual_machine);

        return this;
    }

    pub fn runFromThreadPool(task: *WorkPoolTask) void {
        print("runFromThreadPool", .{});
        var this = @fieldParentPtr(This, "task", task);
        switch (this.walkImpl()) {
            .result => {},
            .err => |e| {
                this.err = .{ .syscall = e };
            },
        }
        this.onFinish();
    }

    fn walkImpl(this: *This) Maybe(void) {
        print("walkImpl", .{});

        var iter = GlobWalker.Iterator{ .walker = this.walker };
        defer iter.deinit();
        switch (try iter.init()) {
            .err => |err| return .{ .err = err },
            else => {},
        }

        while (switch (iter.next() catch |e| OOM(e)) {
            .err => |err| return .{ .err = err },
            .result => |matched_path| matched_path,
        }) |path| {
            this.result.append(path) catch bun.outOfMemory();
        }

        return Maybe(void).success;
    }

    pub fn runFromJS(this: *This) void {
        print("runFromJS", .{});
        this.expansion.onGlobWalkDone(this);
        this.ref.unref(this.event_loop.virtual_machine);
    }

    pub fn schedule(this: *This) void {
        print("schedule", .{});
        WorkPool.schedule(&this.task);
    }

    pub fn onFinish(this: *This) void {
        print("onFinish", .{});
        this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
    }

    pub fn deinit(this: *This) void {
        print("deinit", .{});
        this.result.deinit();
        this.allocator.destroy(this);
    }
};

/// This is modified version of BufferedInput for file descriptors only. This
/// struct cleans itself up when it is done, so no need to call `.deinit()` on
/// it.
pub const BufferedWriter = struct {
    remain: []const u8 = "",
    fd: bun.FileDescriptor,
    poll_ref: ?*bun.Async.FilePoll = null,
    written: usize = 0,
    parent: ParentPtr,
    err: ?Syscall.Error = null,

    const print = bun.Output.scoped(.BufferedWriter, false);

    const ParentPtr = struct {
        const Types = .{
            Builtin.Export,
            Builtin.Echo,
            Builtin.Cd,
            Builtin.Which,
            Builtin.Rm,
        };
        ptr: Repr,
        const Repr = TaggedPointerUnion(Types);

        fn underlying(this: ParentPtr) type {
            inline for (Types) |Ty| {
                if (this.ptr.is(Ty)) return Ty;
            }
            @panic("Uh oh");
        }

        fn init(p: anytype) ParentPtr {
            return .{
                .ptr = Repr.init(p),
            };
        }

        fn onDone(this: ParentPtr, bw: *BufferedWriter, e: ?Syscall.Error) void {
            if (this.ptr.is(Builtin.Export)) return this.ptr.as(Builtin.Export).onBufferedWriterDone(bw, e);
            if (this.ptr.is(Builtin.Echo)) return this.ptr.as(Builtin.Echo).onBufferedWriterDone(bw, e);
            if (this.ptr.is(Builtin.Cd)) return this.ptr.as(Builtin.Cd).onBufferedWriterDone(bw, e);
            if (this.ptr.is(Builtin.Which)) return this.ptr.as(Builtin.Which).onBufferedWriterDone(bw, e);
            if (this.ptr.is(Builtin.Rm)) return this.ptr.as(Builtin.Rm).onBufferedWriterDone(bw, e);
            @panic("Invalid ptr tag");
        }
    };

    pub usingnamespace JSC.WebCore.NewReadyWatcher(BufferedWriter, .writable, onReady);

    pub fn onReady(this: *BufferedWriter, _: i64) void {
        if (this.fd == bun.invalid_fd) {
            return;
        }

        this.__write();
    }

    pub fn writeIfPossible(this: *BufferedWriter, comptime is_sync: bool) void {
        if (comptime !is_sync) {
            // we ask, "Is it possible to write right now?"
            // we do this rather than epoll or kqueue()
            // because we don't want to block the thread waiting for the write
            switch (bun.isWritable(this.fd)) {
                .ready => {
                    if (this.poll_ref) |poll| {
                        poll.flags.insert(.writable);
                        poll.flags.insert(.fifo);
                        std.debug.assert(poll.flags.contains(.poll_writable));
                    }
                },
                .hup => {
                    this.deinit();
                    return;
                },
                .not_ready => {
                    if (!this.isWatching()) this.watch(this.fd);
                    return;
                },
            }
        }

        this.writeAllowBlocking(is_sync);
    }

    /// Calling this directly will block if the fd is not opened with non
    /// blocking option. If the fd is blocking, you should call
    /// `writeIfPossible()` first, which will check if the fd is writable. If so
    /// it will then call this function, if not, then it will poll for the fd to
    /// be writable
    pub fn __write(this: *BufferedWriter) void {
        this.writeAllowBlocking(false);
    }

    pub fn writeAllowBlocking(this: *BufferedWriter, allow_blocking: bool) void {
        var to_write = this.remain;

        if (to_write.len == 0) {
            // we are done!
            this.closeFDIfOpen();
            return;
        }

        if (comptime bun.Environment.allow_assert) {
            // bun.assertNonBlocking(this.fd);
        }

        while (to_write.len > 0) {
            switch (bun.sys.write(this.fd, to_write)) {
                .err => |e| {
                    if (e.isRetry()) {
                        log("write({d}) retry", .{
                            to_write.len,
                        });

                        this.watch(this.fd);
                        this.poll_ref.?.flags.insert(.fifo);
                        return;
                    }

                    if (e.getErrno() == .PIPE) {
                        this.deinit();
                        return;
                    }

                    // fail
                    log("write({d}) fail: {d}", .{ to_write.len, e.errno });
                    this.err = e;
                    this.deinit();
                    return;
                },

                .result => |bytes_written| {
                    this.written += bytes_written;

                    log(
                        "write({d}) {d}",
                        .{
                            to_write.len,
                            bytes_written,
                        },
                    );

                    this.remain = this.remain[@min(bytes_written, this.remain.len)..];
                    to_write = to_write[bytes_written..];

                    // we are done or it accepts no more input
                    if (this.remain.len == 0 or (allow_blocking and bytes_written == 0)) {
                        this.deinit();
                        return;
                    }
                },
            }
        }
    }

    fn closeFDIfOpen(this: *BufferedWriter) void {
        if (this.poll_ref) |poll| {
            this.poll_ref = null;
            poll.deinit();
        }

        if (this.fd != bun.invalid_fd) {
            _ = bun.sys.close(this.fd);
            this.fd = bun.invalid_fd;
        }
    }

    pub fn deinit(this: *BufferedWriter) void {
        this.closeFDIfOpen();
        this.parent.onDone(this, this.err);
    }
};

pub const Builtin = struct {
    kind: Kind,
    stdin: BuiltinIO,
    stdout: BuiltinIO,
    stderr: BuiltinIO,
    exit_code: ?u8 = null,

    arena: *bun.ArenaAllocator,
    /// The following are allocated with the above arena
    args: *std.ArrayList(?[*:0]const u8),
    export_env: std.StringArrayHashMap([:0]const u8),
    cmd_local_env: std.StringArrayHashMap([:0]const u8),

    impl: union(Kind) {
        @"export": Export,
        cd: Cd,
        echo: Echo,
        pwd,
        which: Which,
        rm: Rm,
    },

    const Kind = enum {
        @"export",
        cd,
        echo,
        pwd,
        which,
        rm,

        pub fn parentType(this: Kind) type {
            _ = this;
        }

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

    /// in the case of array buffer we simply need to write to the pointer
    /// in the case of blob, we write to the file descriptor
    const BuiltinIO = union(enum) {
        fd: bun.FileDescriptor,
        buf: std.ArrayList(u8),
        arraybuf: ArrayBuf,
        ignore,

        const ArrayBuf = struct {
            buf: JSC.ArrayBuffer.Strong,
            i: u32 = 0,
        };

        pub fn isClosed(this: *BuiltinIO) bool {
            switch (this.*) {
                .fd => {
                    return this.fd != bun.invalid_fd;
                },
                .buf => {
                    return true;
                    // try this.buf.deinit(allocator);
                },
                else => return true,
            }
        }

        pub fn deinit(this: *BuiltinIO) void {
            switch (this.*) {
                .buf => {
                    this.buf.deinit();
                },
                else => {},
            }
        }

        pub fn close(this: *BuiltinIO) void {
            switch (this.*) {
                .fd => {
                    if (this.fd != bun.invalid_fd) {
                        closefd(this.fd);
                        this.fd = bun.invalid_fd;
                    }
                },
                .buf => {},
                else => {},
            }
        }

        pub fn needsIO(this: *BuiltinIO) bool {
            return switch (this.*) {
                .fd => true,
                else => false,
            };
        }
    };

    pub fn argsSlice(this: *Builtin) []const [*:0]const u8 {
        const args_raw = this.args.items[1..];
        const args_len = std.mem.indexOfScalar(?[*:0]const u8, args_raw, null) orelse @panic("bad");
        if (args_len == 0)
            return &[_][*:0]const u8{};

        const args_ptr = args_raw.ptr;
        return @as([*][*:0]const u8, @ptrCast(args_ptr))[0..args_len];
    }

    pub inline fn callImpl(this: *Builtin, comptime Ret: type, comptime field: []const u8, args_: anytype) Ret {
        return switch (this.kind) {
            .@"export" => this.callImplWithType(Export, Ret, "export", field, args_),
            .echo => this.callImplWithType(Echo, Ret, "echo", field, args_),
            .cd => this.callImplWithType(Cd, Ret, "cd", field, args_),
            .which => this.callImplWithType(Which, Ret, "which", field, args_),
            .rm => this.callImplWithType(Rm, Ret, "rm", field, args_),
            .pwd => @panic("FIXME TODO"),
        };
    }

    fn callImplWithType(this: *Builtin, comptime Impl: type, comptime Ret: type, comptime union_field: []const u8, comptime field: []const u8, args_: anytype) Ret {
        var self = &@field(this.impl, union_field);
        var args = brk: {
            var args: std.meta.ArgsTuple(@TypeOf(@field(Impl, field))) = undefined;
            args[0] = self;

            var i: usize = 1;
            inline for (args_) |a| {
                args[i] = a;
                i += 1;
            }

            break :brk args;
        };
        return @call(.auto, @field(Impl, field), args);
    }

    pub inline fn allocator(this: *Builtin) Allocator {
        return this.parentCmd().base.interpreter.allocator;
    }

    pub fn init(
        cmd: *Cmd,
        interpreter: *Interpreter,
        kind: Kind,
        arena: *bun.ArenaAllocator,
        node: *const ast.Cmd,
        args: *std.ArrayList(?[*:0]const u8),
        export_env: std.StringArrayHashMap([:0]const u8),
        cmd_local_env: std.StringArrayHashMap([:0]const u8),
        io_: *IO,
        comptime in_cmd_subst: bool,
    ) void {
        var io = io_.*;

        var stdin: Builtin.BuiltinIO = switch (io.stdin) {
            .std => .{ .fd = bun.STDIN_FD },
            .fd => |fd| .{ .fd = fd },
            .pipe => .{ .buf = std.ArrayList(u8).init(interpreter.allocator) },
            .ignore => .ignore,
        };
        var stdout: Builtin.BuiltinIO = switch (io.stdout) {
            .std => .{ .fd = bun.STDOUT_FD },
            .fd => |fd| .{ .fd = fd },
            .pipe => .{ .buf = std.ArrayList(u8).init(interpreter.allocator) },
            .ignore => .ignore,
        };
        var stderr: Builtin.BuiltinIO = switch (io.stderr) {
            .std => .{ .fd = bun.STDERR_FD },
            .fd => |fd| .{ .fd = fd },
            .pipe => .{ .buf = std.ArrayList(u8).init(interpreter.allocator) },
            .ignore => .ignore,
        };

        if (node.redirect_file) |file| brk: {
            if (comptime in_cmd_subst) {
                if (node.redirect.stdin) {
                    stdin = .ignore;
                }

                if (node.redirect.stdout) {
                    stdout = .ignore;
                }

                if (node.redirect.stderr) {
                    stdout = .ignore;
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
                    if (interpreter.jsobjs[file.jsbuf.idx].asArrayBuffer(interpreter.global)) |buf| {
                        const builtinio: Builtin.BuiltinIO = .{ .arraybuf = .{ .buf = JSC.ArrayBuffer.Strong{
                            .array_buffer = buf,
                            .held = JSC.Strong.create(buf.value, interpreter.global),
                        }, .i = 0 } };

                        if (node.redirect.stdin) {
                            stdin = builtinio;
                        }

                        if (node.redirect.stdout) {
                            stdout = builtinio;
                        }

                        if (node.redirect.stderr) {
                            stderr = builtinio;
                        }
                    } else if (interpreter.jsobjs[file.jsbuf.idx].as(JSC.WebCore.Blob)) |blob| {
                        _ = blob;
                        @panic("FIXME TODO HANDLE BLOB");
                    } else {
                        @panic("FIXME TODO Unhandled");
                    }
                },
            }
        }

        cmd.exec = .{ .bltn = Builtin{
            .kind = kind,
            .stdin = stdin,
            .stdout = stdout,
            .stderr = stderr,
            .exit_code = null,
            .arena = arena,
            .args = args,
            .export_env = export_env,
            .cmd_local_env = cmd_local_env,
            .impl = undefined,
        } };

        switch (kind) {
            .@"export" => {
                cmd.exec.bltn.impl = .{
                    .@"export" = Export{ .bltn = &cmd.exec.bltn },
                };
            },
            .rm => {
                cmd.exec.bltn.impl = .{
                    .rm = Rm{
                        .bltn = &cmd.exec.bltn,
                        .opts = .{},
                    },
                };
            },
            .echo => {
                cmd.exec.bltn.impl = .{
                    .echo = Echo{
                        .bltn = &cmd.exec.bltn,
                        .output = std.ArrayList(u8).init(arena.allocator()),
                    },
                };
            },
            .cd => {
                cmd.exec.bltn.impl = .{
                    .cd = Cd{
                        .bltn = &cmd.exec.bltn,
                    },
                };
            },
            .which => {
                cmd.exec.bltn.impl = .{
                    .which = Which{
                        .bltn = &cmd.exec.bltn,
                    },
                };
            },
            else => @panic("FIXME TODO"),
        }
    }

    pub inline fn parentCmd(this: *Builtin) *Cmd {
        var union_ptr = @fieldParentPtr(Cmd.Exec, "bltn", this);
        return @fieldParentPtr(Cmd, "exec", union_ptr);
    }

    pub fn done(this: *Builtin, exit_code: u8) void {
        // if (comptime bun.Environment.allow_assert) {
        //     std.debug.assert(this.exit_code != null);
        // }
        this.exit_code = exit_code;

        var cmd = this.parentCmd();
        log("cmd to free: ({x})", .{@intFromPtr(cmd)});
        cmd.exit_code = this.exit_code.?;
        cmd.parent.childDone(cmd, this.exit_code.?);
    }

    pub fn start(this: *Builtin) Maybe(void) {
        switch (this.callImpl(Maybe(void), "start", .{})) {
            .err => |e| return Maybe(void).initErr(e),
            .result => {},
        }

        return Maybe(void).success;
    }

    pub fn deinit(this: *Builtin) void {
        this.callImpl(void, "deinit", .{});

        this.stdout.deinit();
        this.stderr.deinit();
        this.stdin.deinit();

        // this.arena.deinit();
    }

    // pub fn writeNonBlocking(this: *Builtin, comptime io_kind: @Type(.EnumLiteral), buf: []u8) Maybe(usize) {
    //     if (comptime io_kind != .stdout and io_kind != .stderr) {
    //         @compileError("Bad IO" ++ @tagName(io_kind));
    //     }

    //     var io: *BuiltinIO = &@field(this, @tagName(io_kind));
    //     switch (io.*) {
    //         .buf, .arraybuf => {
    //             return this.writeNoIO(io_kind, buf);
    //         },
    //         .fd => {
    //             return Syscall.write(io.fd, buf);
    //         },
    //     }
    // }

    pub fn writeNoIO(this: *Builtin, comptime io_kind: @Type(.EnumLiteral), buf: []const u8) Maybe(usize) {
        if (comptime io_kind != .stdout and io_kind != .stderr) {
            @compileError("Bad IO" ++ @tagName(io_kind));
        }

        var io: *BuiltinIO = &@field(this, @tagName(io_kind));

        switch (io.*) {
            .fd => @panic("writeNoIO can't write to a file descriptor"),
            .buf => {
                log("{s} write to buf {d}\n", .{ this.kind.asString(), buf.len });
                io.buf.appendSlice(buf) catch bun.outOfMemory();
                return Maybe(usize).initResult(buf.len);
            },
            .arraybuf => {
                if (io.arraybuf.i >= io.arraybuf.buf.array_buffer.byte_len) {
                    // TODO is it correct to return an error here? is this error the correct one to return?
                    return Maybe(usize).initErr(Syscall.Error.fromCode(bun.C.E.NOSPC, .write));
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
                return Maybe(usize).initResult(write_len);
            },
            .ignore => return Maybe(usize).initResult(buf.len),
        }
    }

    pub fn ioAllClosed(this: *Builtin) bool {
        return this.stdin.isClosed() and this.stdout.isClosed() and this.stderr.isClosed();
    }

    pub fn fmtErrorArena(this: *Builtin, comptime kind: ?Kind, comptime fmt_: []const u8, args: anytype) []u8 {
        const cmd_str = comptime if (kind) |k| k.asString() ++ ": " else "";
        const fmt = cmd_str ++ fmt_;
        return std.fmt.allocPrint(this.arena.allocator(), fmt, args) catch bun.outOfMemory();
    }

    pub const Export = struct {
        bltn: *Builtin,
        print_state: ?struct {
            bufwriter: BufferedWriter,
            err: ?Syscall.Error = null,

            pub fn isDone(this: *@This()) bool {
                return this.err != null or this.bufwriter.written >= this.bufwriter.remain.len;
            }
        } = null,

        const Entry = struct {
            key: []const u8,
            value: [:0]const u8,

            pub fn compare(context: void, this: @This(), other: @This()) bool {
                return bun.strings.cmpStringsAsc(context, this.key, other.key);
            }
        };

        pub fn onBufferedWriterDone(this: *Export, bufwriter: *BufferedWriter, e: ?Syscall.Error) void {
            _ = bufwriter;
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.print_state != null);
            }

            this.print_state.?.err = e;
            const exit_code: u8 = if (e != null) e.?.errno else 0;
            this.bltn.done(exit_code);
        }

        pub fn start(this: *Export) Maybe(void) {
            const args = this.bltn.argsSlice();

            // Calling `export` with no arguments prints all exported variables lexigraphically ordered
            if (args.len == 0) {
                var arena = this.bltn.arena;

                var keys = std.ArrayList(Entry).init(arena.allocator());
                var iter = this.bltn.export_env.iterator();
                while (iter.next()) |entry| {
                    keys.append(.{
                        .key = entry.key_ptr.*,
                        .value = entry.value_ptr.*,
                    }) catch bun.outOfMemory();
                }

                std.mem.sort(Entry, keys.items[0..], {}, Entry.compare);

                const len = brk: {
                    var len: usize = 0;
                    for (keys.items) |entry| {
                        len += std.fmt.count("{s}={s}\n", .{ entry.key, entry.value });
                    }
                    break :brk len;
                };
                var buf = arena.allocator().alloc(u8, len) catch bun.outOfMemory();
                {
                    var i: usize = 0;
                    for (keys.items) |entry| {
                        const written_slice = std.fmt.bufPrint(buf[i..], "{s}={s}\n", .{ entry.key, entry.value }) catch @panic("This should not happen");
                        i += written_slice.len;
                    }
                }

                if (!this.bltn.stdout.needsIO()) {
                    switch (this.bltn.writeNoIO(.stdout, buf)) {
                        .err => |e| {
                            this.bltn.exit_code = e.errno;
                            return Maybe(void).initErr(e);
                        },
                        .result => |written| {
                            if (comptime bun.Environment.allow_assert) std.debug.assert(written == buf.len);
                        },
                    }
                    this.bltn.done(0);
                    return Maybe(void).success;
                }

                if (comptime bun.Environment.allow_assert) {}

                this.print_state = .{
                    .bufwriter = BufferedWriter{
                        .remain = buf,
                        .fd = this.bltn.stdout.fd,
                        .parent = BufferedWriter.ParentPtr{ .ptr = BufferedWriter.ParentPtr.Repr.init(this) },
                    },
                };

                this.print_state.?.bufwriter.writeIfPossible(false);

                // if (this.print_state.?.isDone()) {
                //     if (this.print_state.?.bufwriter.err) |e| {
                //         this.bltn.exit_code = e.errno;
                //         return Maybe(void).initErr(e);
                //     }
                //     this.bltn.exit_code = 0;
                //     return Maybe(void).success;
                // }

                return Maybe(void).success;
            }

            @panic("FIXME TODO set env");
        }

        pub fn deinit(this: *Export) void {
            log("({s}) deinit", .{@tagName(.@"export")});
            _ = this;
        }
    };

    pub const Echo = struct {
        bltn: *Builtin,

        /// Should be allocated with the arena from Builtin
        output: std.ArrayList(u8),

        io_write_state: ?BufferedWriter = null,

        state: union(enum) {
            idle,
            waiting,
            done,
            err: Syscall.Error,
        } = .idle,

        pub fn start(this: *Echo) Maybe(void) {
            const args = this.bltn.argsSlice();

            const args_len = args.len;
            for (args, 0..) |arg, i| {
                const len = std.mem.len(arg);
                this.output.appendSlice(arg[0..len]) catch bun.outOfMemory();
                if (i < args_len - 1) {
                    this.output.append(' ') catch bun.outOfMemory();
                }
            }

            this.output.append('\n') catch bun.outOfMemory();

            if (!this.bltn.stdout.needsIO()) {
                switch (this.bltn.writeNoIO(.stdout, this.output.items[0..])) {
                    .err => |e| {
                        this.state.err = e;
                        return Maybe(void).initErr(e);
                    },
                    .result => {},
                }

                this.state = .done;
                this.bltn.done(0);
                return Maybe(void).success;
            }

            this.io_write_state = BufferedWriter{
                .fd = this.bltn.stdout.fd,
                .remain = this.output.items[0..],
                .parent = BufferedWriter.ParentPtr.init(this),
            };
            this.state = .waiting;
            this.io_write_state.?.writeIfPossible(false);
            return Maybe(void).success;
        }

        pub fn onBufferedWriterDone(this: *Echo, bufwriter: *BufferedWriter, e: ?Syscall.Error) void {
            _ = bufwriter;
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.io_write_state != null and this.state == .waiting);
            }

            if (e != null) {
                this.state = .{ .err = e.? };
                this.bltn.done(e.?.errno);
                return;
            }

            this.state = .done;
            this.bltn.done(0);
        }

        pub fn deinit(this: *Echo) void {
            log("({s}) deinit", .{@tagName(.echo)});
            _ = this;
        }
    };

    /// 1 arg  => returns absolute path of the arg (not found becomes exit code 1)
    /// N args => returns absolute path of each separated by newline, if any path is not found, exit code becomes 1, but continues execution until all args are processed
    pub const Which = struct {
        bltn: *Builtin,

        state: union(enum) {
            idle,
            one_arg: struct {
                writer: BufferedWriter,
            },
            multi_args: struct {
                args_slice: []const [*:0]const u8,
                arg_idx: usize,
                had_not_found: bool = false,
                state: union(enum) {
                    none,
                    waiting_write: BufferedWriter,
                },
            },
            done,
            err: Syscall.Error,
        } = .idle,

        pub fn start(this: *Which) Maybe(void) {
            const args = this.bltn.argsSlice();
            if (args.len == 0) {
                if (!this.bltn.stdout.needsIO()) {
                    switch (this.bltn.writeNoIO(.stdout, "\n")) {
                        .err => |e| {
                            return Maybe(void).initErr(e);
                        },
                        .result => {},
                    }
                    this.bltn.done(1);
                    return Maybe(void).success;
                }
                this.state = .{
                    .one_arg = .{
                        .writer = BufferedWriter{
                            .fd = this.bltn.stdout.fd,
                            .remain = "\n",
                            .parent = BufferedWriter.ParentPtr.init(this),
                        },
                    },
                };
                this.state.one_arg.writer.writeAllowBlocking(false);
                return Maybe(void).success;
            }

            if (!this.bltn.stdout.needsIO()) {
                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const PATH = this.bltn.parentCmd().base.interpreter.export_env.get("PATH") orelse "";
                var had_not_found = false;
                for (args) |arg_raw| {
                    const arg = arg_raw[0..std.mem.len(arg_raw)];
                    var resolved = which(&path_buf, PATH, this.bltn.parentCmd().base.interpreter.cwd, arg) orelse {
                        had_not_found = true;
                        const buf = this.bltn.fmtErrorArena(.which, "{s} not found\n", .{arg});
                        switch (this.bltn.writeNoIO(.stdout, buf)) {
                            .err => |e| return Maybe(void).initErr(e),
                            .result => {},
                        }
                        continue;
                    };

                    switch (this.bltn.writeNoIO(.stdout, resolved)) {
                        .err => |e| return Maybe(void).initErr(e),
                        .result => {},
                    }
                }
                this.bltn.done(@intFromBool(had_not_found));
                return Maybe(void).success;
            }

            this.state = .{
                .multi_args = .{
                    .args_slice = args,
                    .arg_idx = 0,
                    .state = .none,
                },
            };
            this.next();
            return Maybe(void).success;
        }

        pub fn next(this: *Which) void {
            var multiargs = &this.state.multi_args;
            if (multiargs.arg_idx >= multiargs.args_slice.len) {
                // Done
                this.bltn.done(@intFromBool(multiargs.had_not_found));
                return;
            }

            const arg_raw = multiargs.args_slice[multiargs.arg_idx];
            const arg = arg_raw[0..std.mem.len(arg_raw)];

            var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const PATH = this.bltn.parentCmd().base.interpreter.export_env.get("PATH") orelse "";

            var resolved = which(&path_buf, PATH, this.bltn.parentCmd().base.interpreter.cwd, arg) orelse {
                const buf = this.bltn.fmtErrorArena(null, "{s} not found\n", .{arg});
                multiargs.had_not_found = true;
                multiargs.state = .{
                    .waiting_write = BufferedWriter{
                        .fd = this.bltn.stdout.fd,
                        .remain = buf,
                        .parent = BufferedWriter.ParentPtr.init(this),
                    },
                };
                multiargs.state.waiting_write.writeIfPossible(false);
                // yield execution
                return;
            };

            const buf = this.bltn.fmtErrorArena(null, "{s}\n", .{resolved});
            multiargs.state = .{
                .waiting_write = BufferedWriter{
                    .fd = this.bltn.stdout.fd,
                    .remain = buf,
                    .parent = BufferedWriter.ParentPtr.init(this),
                },
            };
            multiargs.state.waiting_write.writeIfPossible(false);
            return;
        }

        fn argComplete(this: *Which) void {
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.state == .multi_args and this.state.multi_args.state == .waiting_write);
            }

            this.state.multi_args.arg_idx += 1;
            this.state.multi_args.state = .none;
            this.next();
        }

        pub fn onBufferedWriterDone(this: *Which, bufwriter: *BufferedWriter, e: ?Syscall.Error) void {
            _ = bufwriter;
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.state == .one_arg or
                    (this.state == .multi_args and this.state.multi_args.state == .waiting_write));
            }

            if (e != null) {
                this.state = .{ .err = e.? };
                this.bltn.done(e.?.errno);
                return;
            }

            if (this.state == .one_arg) {
                // Calling which with on arguments returns exit code 1
                this.bltn.done(1);
                return;
            }

            this.argComplete();
        }

        pub fn deinit(this: *Which) void {
            log("({s}) deinit", .{@tagName(.which)});
            _ = this;
        }
    };

    /// Some additional behaviour beyond basic `cd <dir>`:
    /// - `cd` by itself or `cd ~` will always put the user in their home directory.
    /// - `cd ~username` will put the user in the home directory of the specified user
    /// - `cd -` will put the user in the previous directory
    pub const Cd = struct {
        bltn: *Builtin,
        state: union(enum) {
            idle,
            waiting_write_stderr: struct {
                buffered_writer: BufferedWriter,
            },
            done,
            err: Syscall.Error,
        } = .idle,

        fn writeStderrNonBlocking(this: *Cd, buf: []u8) void {
            this.state = .{
                .waiting_write_stderr = .{
                    .buffered_writer = BufferedWriter{
                        .fd = this.bltn.stderr.fd,
                        .remain = buf,
                        .parent = BufferedWriter.ParentPtr.init(this),
                    },
                },
            };
            this.state.waiting_write_stderr.buffered_writer.writeIfPossible(false);
        }

        pub fn start(this: *Cd) Maybe(void) {
            const args = this.bltn.argsSlice();
            if (args.len > 1) {
                const buf = this.bltn.fmtErrorArena(.cd, "too many arguments", .{});
                this.writeStderrNonBlocking(buf);
                // yield execution
                return Maybe(void).success;
            }

            const first_arg = args[0][0..std.mem.len(args[0]) :0];
            switch (first_arg[0]) {
                '-' => {
                    switch (this.bltn.parentCmd().base.interpreter.changePrevCwd()) {
                        .result => {},
                        .err => |err| {
                            return this.handleChangeCwdErr(err, this.bltn.parentCmd().base.interpreter.prev_cwd);
                        },
                    }
                },
                '~' => {
                    const homedir = this.bltn.parentCmd().base.interpreter.getHomedir();
                    switch (this.bltn.parentCmd().base.interpreter.changeCwd(homedir)) {
                        .result => {},
                        .err => |err| return this.handleChangeCwdErr(err, homedir),
                    }
                },
                else => {
                    switch (this.bltn.parentCmd().base.interpreter.changeCwd(first_arg)) {
                        .result => {},
                        .err => |err| return this.handleChangeCwdErr(err, first_arg),
                    }
                },
            }
            this.bltn.done(0);
            return Maybe(void).success;
        }

        fn handleChangeCwdErr(this: *Cd, err: Syscall.Error, new_cwd_: [:0]const u8) Maybe(void) {
            const errno: usize = @intCast(err.errno);

            switch (errno) {
                @as(usize, @intFromEnum(bun.C.E.NOTDIR)) => {
                    const buf = this.bltn.fmtErrorArena(.cd, "not a directory: {s}", .{new_cwd_});
                    if (!this.bltn.stderr.needsIO()) {
                        switch (this.bltn.writeNoIO(.stderr, buf)) {
                            .err => |e| return Maybe(void).initErr(e),
                            .result => {},
                        }
                        this.state = .done;
                        this.bltn.done(1);
                        // yield execution
                        return Maybe(void).success;
                    }

                    this.writeStderrNonBlocking(buf);
                    return Maybe(void).success;
                },
                @as(usize, @intFromEnum(bun.C.E.NOENT)) => {
                    const buf = this.bltn.fmtErrorArena(.cd, "not a directory: {s}", .{new_cwd_});
                    if (!this.bltn.stderr.needsIO()) {
                        switch (this.bltn.writeNoIO(.stderr, buf)) {
                            .err => |e| return Maybe(void).initErr(e),
                            .result => {},
                        }
                        this.state = .done;
                        this.bltn.done(1);
                        // yield execution
                        return Maybe(void).success;
                    }

                    this.writeStderrNonBlocking(buf);
                    return Maybe(void).success;
                },
                else => return Maybe(void).success,
            }
        }

        pub fn onBufferedWriterDone(this: *Cd, bufwriter: *BufferedWriter, e: ?Syscall.Error) void {
            _ = bufwriter;
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.state == .waiting_write_stderr);
            }

            if (e != null) {
                this.state = .{ .err = e.? };
                this.bltn.done(e.?.errno);
                return;
            }

            this.state = .done;
            this.bltn.done(0);
        }

        pub fn deinit(this: *Cd) void {
            log("({s}) deinit", .{@tagName(.cd)});
            _ = this;
        }
    };

    pub const Rm = struct {
        bltn: *Builtin,
        opts: Opts,
        state: union(enum) {
            idle,
            parse_opts: struct {
                args_slice: []const [*:0]const u8,
                idx: u32 = 0,
                state: union(enum) {
                    normal,
                    wait_write_err: BufferedWriter,
                } = .normal,
            },
            exec: struct {
                task: RmTask,
                state: union(enum) {
                    idle,
                    waiting,
                },
            },
            done,
            err: Syscall.Error,
        } = .idle,

        pub fn start(this: *Rm) Maybe(void) {
            return this.next();
        }

        pub noinline fn next(this: *Rm) Maybe(void) {
            while (this.state != .done and this.state != .err) {
                switch (this.state) {
                    .idle => {
                        this.state = .{
                            .parse_opts = .{
                                .args_slice = this.bltn.argsSlice(),
                            },
                        };
                        continue;
                    },
                    .parse_opts => {
                        var parse_opts = &this.state.parse_opts;
                        switch (parse_opts.state) {
                            .normal => {
                                // This means there were no arguments or only
                                // flag arguments meaning no positionals, in
                                // either case we must print the usage error
                                // string
                                if (parse_opts.idx >= parse_opts.args_slice.len) {
                                    const error_string = Builtin.Kind.usageString(.rm);
                                    if (this.bltn.stderr.needsIO()) {
                                        parse_opts.state = .{
                                            .wait_write_err = BufferedWriter{
                                                .fd = this.bltn.stderr.fd,
                                                .remain = error_string,
                                                .parent = BufferedWriter.ParentPtr.init(this),
                                            },
                                        };
                                        parse_opts.state.wait_write_err.writeIfPossible(false);
                                        return Maybe(void).success;
                                    }

                                    switch (this.bltn.writeNoIO(.stderr, error_string)) {
                                        .result => {},
                                        .err => |e| return Maybe(void).initErr(e),
                                    }
                                    this.bltn.done(1);
                                    return Maybe(void).success;
                                }

                                const idx = parse_opts.idx;

                                const arg_raw = parse_opts.args_slice[idx];
                                const arg = arg_raw[0..std.mem.len(arg_raw)];

                                switch (this.opts.parseFlag(this.bltn, arg)) {
                                    .continue_parsing => {
                                        parse_opts.idx += 1;
                                        continue;
                                    },
                                    .done => {
                                        if (this.opts.recursive) {
                                            this.opts.remove_empty_dirs = true;
                                        }
                                        const filepath_args_start = idx;
                                        const filepath_args = parse_opts.args_slice[filepath_args_start..];
                                        const cwd_fd = switch (Syscall.open(".", os.O.DIRECTORY | os.O.RDONLY, 0)) {
                                            .result => |fd| fd,
                                            .err => |e| return Maybe(void).initErr(e),
                                        };
                                        this.state = .{
                                            .exec = .{
                                                .task = RmTask{
                                                    .entries_to_delete = filepath_args,
                                                    .rm = this,
                                                    .cwd = cwd_fd,
                                                    .task = .{
                                                        .event_loop = JSC.VirtualMachine.get().event_loop,
                                                    },
                                                },
                                                .state = .idle,
                                            },
                                        };
                                        // this.state.exec.task.schedule();
                                        // return Maybe(void).success;
                                        continue;
                                    },
                                    .illegal_option => {
                                        const error_string = "rm: illegal option -- -\n";
                                        if (this.bltn.stderr.needsIO()) {
                                            parse_opts.state = .{
                                                .wait_write_err = BufferedWriter{
                                                    .fd = this.bltn.stderr.fd,
                                                    .remain = error_string,
                                                    .parent = BufferedWriter.ParentPtr.init(this),
                                                },
                                            };
                                            parse_opts.state.wait_write_err.writeIfPossible(false);
                                            return Maybe(void).success;
                                        }

                                        switch (this.bltn.writeNoIO(.stderr, error_string)) {
                                            .result => {},
                                            .err => |e| return Maybe(void).initErr(e),
                                        }
                                        this.bltn.done(1);
                                        return Maybe(void).success;
                                    },
                                    .illegal_option_with_flag => {
                                        const flag = arg;
                                        const error_string = this.bltn.fmtErrorArena(.rm, "illegal option -- {s}\n", .{flag[1..]});
                                        if (this.bltn.stderr.needsIO()) {
                                            parse_opts.state = .{
                                                .wait_write_err = BufferedWriter{
                                                    .fd = this.bltn.stderr.fd,
                                                    .remain = error_string,
                                                    .parent = BufferedWriter.ParentPtr.init(this),
                                                },
                                            };
                                            parse_opts.state.wait_write_err.writeIfPossible(false);
                                            return Maybe(void).success;
                                        }

                                        switch (this.bltn.writeNoIO(.stderr, error_string)) {
                                            .result => {},
                                            .err => |e| return Maybe(void).initErr(e),
                                        }
                                        this.bltn.done(1);
                                        return Maybe(void).success;
                                    },
                                }
                            },
                            .wait_write_err => {
                                // Errored
                                if (parse_opts.state.wait_write_err.err) |e| {
                                    this.state = .{ .err = e };
                                    continue;
                                }

                                // Done writing
                                if (this.state.parse_opts.state.wait_write_err.remain.len == 0) {
                                    this.state = .done;
                                    continue;
                                }

                                // yield execution to continue writing
                                return Maybe(void).success;
                            },
                        }
                    },
                    .exec => {
                        // Schedule task
                        if (this.state.exec.state == .idle) {
                            this.state.exec.state = .waiting;
                            this.state.exec.task.task.schedule();
                        }

                        // do nothing
                        return Maybe(void).success;
                    },
                    .done => {
                        this.bltn.done(0);
                        return Maybe(void).success;
                    },
                    .err => {
                        this.bltn.done(this.state.err.errno);
                        return Maybe(void).success;
                    },
                }
            }
            return Maybe(void).success;
        }

        pub fn onBufferedWriterDone(this: *Rm, bufwriter: *BufferedWriter, e: ?Syscall.Error) void {
            _ = bufwriter;
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.state == .parse_opts and this.state.parse_opts.state == .wait_write_err);
            }

            if (e != null) {
                this.state = .{ .err = e.? };
                this.bltn.done(e.?.errno);
                return;
            }

            this.bltn.done(1);
            return;
        }

        pub fn deinit(this: *Rm) void {
            _ = this;
        }

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

            const ParseFlagsResult = enum {
                continue_parsing,
                done,
                illegal_option,
                illegal_option_with_flag,
            };

            fn parseFlag(this: *Opts, bltn: *Builtin, flag: []const u8) ParseFlagsResult {
                _ = bltn;
                if (flag.len == 0) return .done;
                if (flag[0] != '-') return .done;
                if (flag.len > 2 and flag[1] == '-') {
                    if (bun.strings.eqlComptime(flag, "--preserve-root")) {
                        this.preserve_root = true;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--no-preserve-root")) {
                        this.preserve_root = false;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--recursive")) {
                        this.recursive = true;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--verbose")) {
                        this.verbose = true;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--dir")) {
                        this.remove_empty_dirs = true;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--interactive=never")) {
                        this.prompt_behaviour = .never;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--interactive=once")) {
                        this.prompt_behaviour = .{ .once = .{} };
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--interactive=always")) {
                        this.prompt_behaviour = .always;
                        return .continue_parsing;
                    }

                    // try bltn.write_err(&bltn.stderr, .rm, "illegal option -- -\n", .{});
                    return .illegal_option;
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
                            // try bltn.write_err(&bltn.stderr, .rm, "illegal option -- {s}\n", .{flag[1..]});
                            return .illegal_option_with_flag;
                        },
                    }
                }

                return .continue_parsing;
            }
        };

        pub const RmTask = struct {
            const print = bun.Output.scoped(.RmTask, false);

            rm: *Rm,
            cwd: bun.FileDescriptor,
            absolute: bool = false,
            entries_to_delete: []const [*:0]const u8,
            task: ShellTask(
                RmTask,
                runFromThreadPool,
                runFromJs,
                print,
            ),
            dir_path_buffer: ?*[bun.MAX_PATH_BYTES]u8 = null,
            dir_path_len: usize = 0,
            err: ?Syscall.Error = null,

            // pub const RmWorkTask = @TypeOf(@field(RmTask, "rm"));

            pub fn arena(this: *RmTask) Allocator {
                return this.rm.bltn.arena.allocator();
            }

            pub fn runFromThreadPool(this: *RmTask) void {
                return this.run();
            }

            pub fn runFromJs(this: *RmTask) void {
                if (this.err) |e| {
                    const stdout = std.io.getStdOut().writer();
                    e.format("HO NO", .{}, stdout) catch @panic("FUCK");
                    this.rm.bltn.done(e.errno);
                    return;
                }
                this.rm.bltn.done(0);
            }

            const Dir = std.fs.Dir;

            pub fn run(this: *RmTask) void {
                var pathbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const cwd_path_no_sentinel = switch (bun.sys.getcwd(&pathbuf)) {
                    .result => |p| p,
                    .err => |e| {
                        this.rm.state = .{ .err = e };
                        return;
                    },
                };
                pathbuf[cwd_path_no_sentinel.len] = 0;
                const cwd_path = pathbuf[0..cwd_path_no_sentinel.len :0];
                for (this.entries_to_delete) |entry_raw| {
                    const entry = entry_raw[0..std.mem.len(entry_raw) :0];
                    if (this.rm.opts.recursive) {
                        switch (this.deleteTree(this.cwd, cwd_path, entry)) {
                            .result => {},
                            .err => |e| {

                                // this.rm.state = .{ .err = e };
                                this.err = e;
                                // _ = this.rm.next();
                                return;
                            },
                        }
                    }
                }
            }

            /// Modified version of `std.fs.deleteTree`:
            /// - nonsense instances of `unreachable` removed
            /// - uses Bun's syscall functions
            /// - can pass a Context which allows you to inspect which files/directories have been deleted (needed for shell's implementation of rm with verbose flag)
            /// - throws errors if ENOENT is encountered, unless rm -v option is used
            ///
            /// Whether `full_path` describes a symlink, file, or directory, this function
            /// removes it. If it cannot be removed because it is a non-empty directory,
            /// this function recursively removes its entries and then tries again.
            /// This operation is not atomic on most file systems.
            pub fn deleteTree(this: *RmTask, self: bun.FileDescriptor, self_path: [:0]const u8, sub_path: [:0]const u8) Maybe(void) {
                const is_absolute = ResolvePath.Platform.auto.isAbsolute(sub_path);
                this.absolute = is_absolute;
                if (!is_absolute) {
                    const slice = this.arena().alloc(u8, bun.MAX_PATH_BYTES) catch bun.outOfMemory();
                    this.dir_path_buffer = @ptrCast(slice.ptr);
                }

                const resolved_sub_path = if (is_absolute)
                    sub_path
                else
                    ResolvePath.joinZ(&[_][:0]const u8{ self_path, sub_path }, .auto);

                // Avoiding processing root directort if preserve root option is set
                // FIXME supoprt windows (std.fs.diskdesignator() something something)
                if (this.rm.opts.preserve_root and std.mem.eql(u8, resolved_sub_path[0..resolved_sub_path.len], "/"))
                    return Maybe(void).success;

                var initial_iterable = switch (this.deleteTreeOpenInitialSubpath(self, sub_path, .file)) {
                    .result => |r| r orelse return Maybe(void).success,
                    .err => |e| return .{ .err = e },
                };

                const StackItem = struct {
                    name: [:0]const u8,
                    parent_dir: bun.FileDescriptor,
                    dir_path_len: usize,
                    iter: DirIterator.WrappedIterator,
                };

                // DirIterator.WrappedIterator is quite large so just two of these equals ~16.496 kB
                var stack = std.BoundedArray(StackItem, 2){};
                defer {
                    for (stack.slice()) |*item| {
                        item.iter.iter.dir.close();
                    }
                }

                stack.appendAssumeCapacity(StackItem{
                    .name = sub_path,
                    .dir_path_len = 0,
                    .parent_dir = self,
                    .iter = initial_iterable,
                });

                process_stack: while (stack.len != 0) {
                    var top: *StackItem = &(stack.slice()[stack.len - 1]);
                    const parent_dir_path_len = top.dir_path_len;
                    var dir_path_len: usize = 0;
                    if (!this.absolute) {
                        dir_path_len = top.dir_path_len + top.name.len;
                        @memcpy(this.dir_path_buffer.?[top.dir_path_len..dir_path_len], top.name[0..top.name.len]);
                    }
                    defer {
                        if (!this.absolute) {
                            this.dir_path_buffer.?[parent_dir_path_len] = 0;
                        }
                    }

                    var entry_ = top.iter.next();
                    while (switch (entry_) {
                        .err => @panic("FIXME TODO errors"),
                        .result => |ent| ent,
                        // gotta be careful not to pop otherwise this won't work
                    }) |entry| : (entry_ = top.iter.next()) {
                        var treat_as_dir = entry.kind == .directory;
                        handle_entry: while (true) {
                            if (treat_as_dir) {
                                if (stack.ensureUnusedCapacity(1)) {
                                    var iterable_dir = switch (this.openIterableDir(top.iter.iter.dir.fd, entry.name.sliceAssumeZ())) {
                                        .result => |iter| iter,
                                        .err => |e| {
                                            const errno = errnocast(e.errno);
                                            switch (errno) {
                                                @as(u16, @intFromEnum(bun.C.E.NOTDIR)) => {
                                                    treat_as_dir = false;
                                                    continue :handle_entry;
                                                },
                                                @as(u16, @intFromEnum(bun.C.E.NOENT)) => {
                                                    if (this.rm.opts.force) {
                                                        switch (this.verboseDeleted(entry.name.sliceAssumeZ(), dir_path_len)) {
                                                            .result => {},
                                                            .err => |e2| return Maybe(void).initErr(e2),
                                                        }
                                                        break :handle_entry;
                                                    }
                                                    return .{ .err = e };
                                                },
                                                else => return .{ .err = e },
                                            }
                                        },
                                    };

                                    stack.appendAssumeCapacity(StackItem{
                                        .name = entry.name.sliceAssumeZ(),
                                        .parent_dir = top.iter.iter.dir.fd,
                                        .iter = iterable_dir,
                                    });

                                    continue :process_stack;
                                } else |_| {
                                    switch (this.deleteTreeMinStackSizeWithKindHint(top.iter.iter.dir.fd, entry.name.sliceAssumeZ(), entry.kind)) {
                                        .result => {},
                                        .err => |e| return .{ .err = e },
                                    }
                                    // try top.iter.dir.deleteTreeMinStackSizeWithKindHint(entry.name, entry.kind);
                                    break :handle_entry;
                                }
                            } else {
                                switch (this.deleteFile(bun.toFD(top.iter.iter.dir.fd), entry.name.sliceAssumeZ(), dir_path_len)) {
                                    .result => |try_as_dir| {
                                        if (try_as_dir) {
                                            treat_as_dir = true;
                                            continue :handle_entry;
                                        }
                                        break :handle_entry;
                                    },
                                    .err => |e| {
                                        switch (e.getErrno()) {
                                            bun.C.E.NOENT => {
                                                if (this.rm.opts.force) {
                                                    switch (this.verboseDeleted(entry.name.sliceAssumeZ(), dir_path_len)) {
                                                        .result => {},
                                                        .err => |e2| return Maybe(void).initErr(e2),
                                                    }
                                                    break :handle_entry;
                                                }
                                                return .{ .err = e };
                                            },
                                            bun.C.E.ISDIR, bun.C.E.NOTEMPTY => {
                                                treat_as_dir = true;
                                                continue :handle_entry;
                                            },
                                            else => return .{ .err = e },
                                        }
                                    },
                                }
                            }
                        }
                    }

                    // On Windows, we can't delete until the dir's handle has been closed, so
                    // close it before we try to delete.
                    _ = Syscall.close(top.iter.iter.dir.fd);
                    // top.iter.dir.close();

                    // In order to avoid double-closing the directory when cleaning up
                    // the stack in the case of an error, we save the relevant portions and
                    // pop the value from the stack.
                    const parent_dir = top.parent_dir;
                    const name = top.name;
                    _ = stack.pop();

                    var need_to_retry: bool = false;

                    switch (this.deleteDir(parent_dir, name)) {
                        .result => {},
                        .err => |e| {
                            switch (errnocast(e.errno)) {
                                @intFromEnum(bun.C.E.NOTEMPTY) => need_to_retry = true,
                                else => return .{ .err = e },
                            }
                        },
                    }

                    if (need_to_retry) {
                        // Since we closed the handle that the previous iterator used, we
                        // need to re-open the dir and re-create the iterator.
                        var iterable_dir = iterable_dir: {
                            var treat_as_dir = true;
                            handle_entry: while (true) {
                                if (treat_as_dir) {
                                    break :iterable_dir switch (this.openIterableDir(parent_dir, name)) {
                                        .result => |iter| iter,
                                        .err => |e| {
                                            switch (errnocast(e.errno)) {
                                                @intFromEnum(bun.C.E.NOTDIR) => {
                                                    treat_as_dir = false;
                                                    continue :handle_entry;
                                                },
                                                @intFromEnum(bun.C.E.NOENT) => {
                                                    if (this.rm.opts.force) {
                                                        switch (this.verboseDeleted(name, parent_dir_path_len)) {
                                                            .err => |e2| return .{ .err = e2 },
                                                            else => {},
                                                        }
                                                        continue :process_stack;
                                                    }

                                                    return .{ .err = e };
                                                },
                                                else => return .{ .err = e },
                                            }
                                        },
                                    };
                                } else {
                                    switch (this.deleteFile(bun.toFD(top.iter.iter.dir.fd), name, parent_dir_path_len)) {
                                        .result => |try_as_dir| {
                                            if (try_as_dir) {
                                                treat_as_dir = true;
                                                continue :handle_entry;
                                            }
                                            continue :process_stack;
                                        },
                                        .err => |e| {
                                            const errno = errnocast(e.errno);

                                            switch (errno) {
                                                @intFromEnum(bun.C.E.NOENT) => {
                                                    if (this.rm.opts.force) {
                                                        switch (this.verboseDeleted(name, parent_dir_path_len)) {
                                                            .result => {},
                                                            .err => |e2| return Maybe(void).initErr(e2),
                                                        }
                                                        continue :process_stack;
                                                    }
                                                    return .{ .err = e };
                                                },
                                                @intFromEnum(bun.C.E.ISDIR) => {
                                                    treat_as_dir = true;
                                                    continue :handle_entry;
                                                },
                                                else => return .{ .err = e },
                                            }
                                        },
                                    }
                                }
                            }
                        };

                        // We know there is room on the stack since we are just re-adding
                        // the StackItem that we previously popped.
                        stack.appendAssumeCapacity(StackItem{
                            .name = name,
                            .parent_dir = parent_dir,
                            .iter = iterable_dir,
                        });

                        continue :process_stack;
                    }
                }

                return Maybe(void).success;
            }

            /// Like `deleteTree`, but only keeps one `Iterator` active at a time to minimize the function's stack size.
            /// This is slower than `deleteTree` but uses less stack space.
            fn deleteTreeMinStackSizeWithKindHint(
                this: *RmTask,
                self: bun.FileDescriptor,
                sub_path: [:0]const u8,
                kind_hint: std.fs.File.Kind,
                parent_dir_path_len: usize,
            ) Maybe(void) {
                _ = parent_dir_path_len;
                start_over: while (true) {
                    var iterable_dir = switch (this.deleteTreeOpenInitialSubpath(self, sub_path, kind_hint)) {
                        .result => |r| r orelse return Maybe(void).success,
                        .err => |e| return .{ .err = e },
                    };

                    var cleanup_dir_parent: ?DirIterator.WrappedIterator = null;
                    defer {
                        if (cleanup_dir_parent) |*d| {
                            _ = Syscall.close(d.iter.dir.fd);
                        }
                    }

                    var cleanup_dir = true;
                    defer {
                        if (cleanup_dir) {
                            _ = Syscall.close(iterable_dir.iter.dir.fd);
                        }
                    }

                    // Valid use of MAX_PATH_BYTES because dir_name_buf will only
                    // ever store a single path component that was returned from the
                    // filesystem.
                    var dir_name_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    var dir_name: [:0]const u8 = sub_path;

                    // Here we must avoid recursion, in order to provide O(1) memory guarantee of this function.
                    // Go through each entry and if it is not a directory, delete it. If it is a directory,
                    // open it, and close the original directory. Repeat. Then start the entire operation over.

                    scan_dir: while (true) {
                        var dir_it = iterable_dir;
                        var entry_ = dir_it.next();
                        dir_it: while (switch (entry_) {
                            .err => @panic("FIXME TODO ERRORS"),
                            .result => |ent| ent,
                        }) |entry__| : (entry_ = dir_it.next()) {
                            var entry: DirIterator.IteratorResult = entry__;
                            var treat_as_dir = entry.kind == .directory;
                            handle_entry: while (true) {
                                if (treat_as_dir) {
                                    const new_dir = switch (this.openIterableDir(iterable_dir.iter.dir.fd, entry.name.sliceAssumeZ())) {
                                        .result => |iter| iter,
                                        .err => |e| {
                                            const errno = errnocast(e.errno);
                                            switch (errno) {
                                                @intFromEnum(bun.C.E.NOTDIR) => {
                                                    treat_as_dir = false;
                                                    continue :handle_entry;
                                                },
                                                @intFromEnum(bun.C.E.NOENT) => {
                                                    if (this.rm.opts.force) {
                                                        switch (this.verboseDeleted(entry.name.sliceAssumeZ())) {
                                                            .result => {},
                                                            .err => |e2| return Maybe(void).initErr(e2),
                                                        }
                                                        continue :dir_it;
                                                    }
                                                },
                                                else => {},
                                            }
                                            return .{ .err = e };
                                        },
                                    };

                                    if (cleanup_dir_parent) |*d| {
                                        _ = Syscall.close(d.iter.dir.fd);
                                    }

                                    cleanup_dir_parent = iterable_dir;
                                    iterable_dir = new_dir;
                                    dir_name_buf[entry.name.len] = 0;
                                    const result = dir_name_buf[0..entry.name.len];
                                    @memcpy(result, entry.name.slice());
                                    dir_name = dir_name_buf[0..entry.name.len :0];
                                    continue :scan_dir;
                                } else {
                                    switch (this.deleteFile(iterable_dir.iter.dir.fd, entry.name.sliceAssumeZ())) {
                                        .result => |should_treat_as_dir| {
                                            if (should_treat_as_dir) {
                                                treat_as_dir = true;
                                                continue :handle_entry;
                                            }
                                            continue :dir_it;
                                        },
                                        .err => |e| {
                                            switch (e.getErrno()) {
                                                bun.C.E.NOENT => {
                                                    if (this.rm.opts.force) {
                                                        switch (this.verboseDeleted(entry.name.sliceAssumeZ())) {
                                                            .result => {},
                                                            .err => |e2| return Maybe(void).initErr(e2),
                                                        }
                                                        continue :dir_it;
                                                    }
                                                    return .{ .err = e };
                                                },
                                                bun.C.E.NOTDIR, bun.C.E.NOTEMPTY => {
                                                    treat_as_dir = true;
                                                    continue :handle_entry;
                                                },

                                                else => return .{ .err = e },
                                            }
                                        },
                                    }
                                }
                            }
                        }

                        // Reached the end of the directory entries, which means we successfully deleted all of them.
                        // Now to remove the directory itself.
                        // iterable_dir.close();
                        _ = Syscall.close(iterable_dir.iter.dir.fd);
                        cleanup_dir = false;

                        if (cleanup_dir_parent) |d| {
                            switch (this.deleteDir(bun.toFD(d.iter.dir.fd), dir_name)) {
                                .result => {},
                                .err => |e| {
                                    switch (errnocast(e.errno)) {
                                        // These two things can happen due to file system race conditions.
                                        @intFromEnum(bun.C.E.NOENT), @intFromEnum(bun.C.E.NOTEMPTY) => continue :start_over,
                                        else => return .{ .err = e },
                                    }
                                },
                            }
                            continue :start_over;
                        } else {
                            switch (this.deleteDir(self, sub_path)) {
                                .result => {},
                                .err => |e| {
                                    switch (errnocast(e.errno)) {
                                        @intFromEnum(bun.C.E.NOENT) => {
                                            if (this.rm.opts.force) {
                                                switch (this.verboseDeleted(sub_path)) {
                                                    .err => |e2| return .{ .err = e2 },
                                                    .result => {},
                                                }
                                                return Maybe(void).success;
                                            }
                                        },
                                        @intFromEnum(bun.C.E.NOTEMPTY) => continue :start_over,
                                        else => return .{ .err = e },
                                    }
                                },
                            }
                            return Maybe(void).success;
                        }
                    }
                }
            }

            /// If the --preserve-root option is set, will return true if the
            /// file descriptor points to root directory. Otherwise will always
            /// return false
            fn preserveRootCheck(this: *RmTask, fd: anytype) Maybe(bool) {
                if (this.rm.opts.preserve_root) {
                    var pathbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    const path = bun.getFdPath(fd, &pathbuf) catch |err| {
                        const errno = switch (err) {
                            .FileNotFound => bun.C.E.NOENT,
                            .AccessDenied => bun.C.E.ACCES,
                            .NameTooLong => bun.C.E.NAMETOOLONG,
                            .NotSupported => bun.C.E.NOTSUP,
                            .NotDir => bun.C.E.NOTDIR,
                            .SymLinkLoop => bun.C.E.LOOP,
                            .InputOutput => bun.C.E.IO,
                            .FileTooBig => bun.C.E.FBIG,
                            .IsDir => bun.C.E.ISDIR,
                            .ProcessFdQuotaExceeded => bun.C.E.MFILE,
                            .SystemFdQuotaExceeded => bun.C.E.NFILE,
                            .NoDevice => bun.C.E.NODEV,
                            .SystemResources => bun.C.E.NOSYS, // or EAGAIN if it's a temporary lack of resources
                            .NoSpaceLeft => bun.C.E.NOSPC,
                            .FileSystem => bun.C.E.IO, // or another appropriate error if there's a more specific cause
                            .BadPathName => bun.C.E.NOENT, // ENOENT or EINVAL, depending on the situation
                            .DeviceBusy => bun.C.E.BUSY,
                            .SharingViolation => bun.C.E.ACCES, // For POSIX, EACCES might be the closest match
                            .PipeBusy => bun.C.E.BUSY,
                            .InvalidHandle => bun.C.E.BADF,
                            .InvalidUtf8 => bun.C.E.INVAL,
                            .NetworkNotFound => bun.C.E.NOENT, // or ENETUNREACH depending on context
                            .PathAlreadyExists => bun.C.E.EXIST,
                            .Unexpected => bun.C.E.INVAL, // or another error that makes sense in the context
                        };

                        return Maybe(bool).errno(errno);
                    };
                    // FIXME windows
                    return .{ .result = std.mem.eql(u8, path, "/") };
                }

                return .{ .result = false };
            }

            fn openIterableDir(this: *RmTask, self: bun.FileDescriptor, sub_path: [:0]const u8) Maybe(DirIterator.WrappedIterator) {
                _ = this;
                const fd = switch (Syscall.openat(self, sub_path, os.O.DIRECTORY | os.O.RDONLY | os.O.CLOEXEC, 0)) {
                    .err => |e| {
                        return .{ .err = e };
                    },
                    .result => |fd| fd,
                };

                var dir = std.fs.Dir{ .fd = bun.fdcast(fd) };
                var iterator = DirIterator.iterate(dir);
                return .{ .result = iterator };
            }

            /// On successful delete, returns null.
            fn deleteTreeOpenInitialSubpath(this: *RmTask, self: bun.FileDescriptor, sub_path: [:0]const u8, kind_hint: std.fs.File.Kind) Maybe(?DirIterator.WrappedIterator) {
                return iterable_dir: {
                    // Treat as a file by default
                    var treat_as_dir = kind_hint == .directory;

                    handle_entry: while (true) {
                        if (treat_as_dir) {
                            const fd = switch (Syscall.openat(self, sub_path, os.O.DIRECTORY | os.O.RDONLY | os.O.CLOEXEC, 0)) {
                                .err => |e| {
                                    switch (errnocast(e.errno)) {
                                        @as(u16, @intFromEnum(bun.C.E.NOTDIR)) => {
                                            treat_as_dir = false;
                                            continue :handle_entry;
                                        },
                                        @as(u16, @intFromEnum(bun.C.E.NOENT)) => {
                                            if (this.rm.opts.force) {
                                                // That's fine, we were trying to remove this directory anyway.
                                                break :handle_entry;
                                            }
                                            return .{ .err = e };
                                        },
                                        else => return Maybe(?DirIterator.WrappedIterator).initErr(e),
                                    }
                                },
                                .result => |fd| fd,
                            };
                            var dir = std.fs.Dir{ .fd = bun.fdcast(fd) };
                            var iterator = DirIterator.iterate(dir);
                            break :iterable_dir .{ .result = iterator };
                        } else {
                            switch (this.deleteFile(self, sub_path)) {
                                .result => |try_as_dir| {
                                    if (try_as_dir) {
                                        treat_as_dir = true;
                                        continue :handle_entry;
                                    }
                                    return .{ .result = null };
                                },
                                .err => |e| {
                                    switch (e.getErrno()) {
                                        bun.C.E.NOENT => return if (this.rm.opts.force) .{ .result = null } else .{ .err = e },
                                        // Is a dir
                                        bun.C.E.ISDIR, bun.C.E.NOTEMPTY => {
                                            treat_as_dir = true;
                                            continue :handle_entry;
                                        },
                                        else => return Maybe(?DirIterator.WrappedIterator).initErr(e),
                                    }
                                },
                            }
                        }
                    }
                };
            }

            pub fn deleteDir(
                this: *RmTask,
                parentfd: bun.FileDescriptor,
                subpath: [:0]const u8,
                dir_path_len: usize,
            ) Maybe(void) {
                switch (Syscall.unlinkatWithFlags(parentfd, subpath, std.os.AT.REMOVEDIR)) {
                    .result => return this.verboseDeleted(subpath, dir_path_len),
                    .err => |e| {
                        const errno = errnocast(e.errno);
                        if (@intFromEnum(bun.C.E.NOENT) == errno and this.rm.opts.force) {
                            return this.verboseDeleted(subpath, dir_path_len);
                        }
                        return .{ .err = e };
                    },
                }
            }

            /// Returns true if path actually pointed to a directory, and the caller should process that.
            pub fn deleteFile(
                this: *RmTask,
                dirfd: bun.FileDescriptor,
                subpath: [:0]const u8,
                dir_path_len: usize,
            ) Maybe(bool) {
                switch (Syscall.unlinkat(dirfd, subpath)) {
                    .result => return switch (this.verboseDeleted(subpath, dir_path_len)) {
                        .result => .{ .result = false },
                        .err => |e| .{ .err = e },
                    },
                    .err => |e| {
                        switch (e.getErrno()) {
                            bun.C.E.ISDIR => {
                                return .{ .result = true };
                            },
                            // non-Linux POSIX systems return EPERM when trying to delete a directory, so
                            // we need to handle that case specifically
                            bun.C.E.PERM => {
                                switch (builtin.os.tag) {
                                    // The entry could be a directory, or this is a regular permissions error, so we
                                    // call unlinktat with AT_REMOVEDIR flag. This will tell us if it is a directory, or it is a permissions error.
                                    .macos, .ios, .freebsd, .netbsd, .dragonfly, .openbsd, .solaris, .illumos => {
                                        if (this.rm.opts.remove_empty_dirs) {
                                            return switch (Syscall.unlinkatWithFlags(dirfd, subpath, std.os.AT.REMOVEDIR)) {
                                                .result => switch (this.verboseDeleted(subpath, dir_path_len)) {
                                                    .result => .{ .result = false },
                                                    .err => |e2| Maybe(bool).initErr(e2),
                                                },
                                                .err => |e2| {
                                                    const errno = e2.getErrno();
                                                    return switch (errno) {
                                                        bun.C.E.NOTEMPTY => .{ .result = true },
                                                        // It was a regular permissions error, return the original error
                                                        bun.C.E.NOTDIR => .{ .err = e },
                                                        else => .{ .err = e2 },
                                                    };
                                                },
                                            };
                                        }
                                        return .{ .result = true };
                                    },
                                    else => return .{ .err = e },
                                }
                            },
                            else => return .{ .err = e },
                        }
                    },
                }
            }

            pub fn verboseDeleted(this: *RmTask, path: [:0]const u8, dir_path_len: usize) Maybe(void) {
                if (this.rm.opts.verbose) {
                    defer {
                        if (!this.absolute) {
                            this.dir_path_buffer[dir_path_len] = 0;
                        }
                    }
                    print("deleted: {s}", .{path});
                    if (!this.rm.bltn.stdout.needsIO()) {
                        const buf = if (this.absolute) this.rm.bltn.fmtErrorArena(null, "{s}\n", .{path}) else brk: {
                            const end = dir_path_len + path.len;
                            @memcpy(this.dir_path_buffer.?[dir_path_len .. dir_path_len + path.len], path);
                            this.dir_path_buffer.?[end] = 0;
                            break :brk this.dir_path_buffer[0..end];
                        };

                        return switch (this.rm.bltn.writeNoIO(.stdout, buf)) {
                            .result => Maybe(void).success,
                            .err => |e| Maybe(void).initErr(e),
                        };
                    }

                    const buf = if (this.absolute) this.rm.bltn.fmtErrorArena(null, "{s}\n", .{path}) else brk: {
                        const end = dir_path_len + path.len;
                        @memcpy(this.dir_path_buffer.?[dir_path_len .. dir_path_len + path.len], path);
                        this.dir_path_buffer.?[end] = 0;
                        break :brk this.arena().dupe(u8, this.dir_path_buffer[0..end]) catch bun.outOfMemory();
                    };

                    var written: usize = 0;
                    while (written < buf.len) : (written += switch (Syscall.write(this.rm.bltn.stdout.fd, buf)) {
                        .err => |e| return Maybe(void).initErr(e),
                        .result => |n| n,
                    }) {}
                }

                return Maybe(void).success;
            }
        };
    };
};

inline fn errnocast(errno: anytype) u16 {
    return @intCast(errno);
}
