//! The interpreter for the shell language
//!
//! Normally, the implementation would be a very simple tree-walk of the AST,
//! but it needs to be non-blocking, and Zig does not have coroutines yet, so
//! this implementation is half tree-walk half one big state machine. The state
//! machine part manually keeps track of execution state (which coroutines would
//! do for us), but makes the code very confusing because control flow is less obvious.
//!
//! Typically, you will see functions `return` this is analogous to yielding/suspending execution
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
const NewBuiltin = @import("./builtins.zig").NewBuiltin;

pub const Builtin = NewBuiltin(.js);
const BuiltinMini = NewBuiltin(.mini);

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

    io: IO = .{},

    /// FIXME think about lifetimes
    buffered_stdout: bun.ByteList = .{},
    buffered_stderr: bun.ByteList = .{},

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

    resolve: JSValue = .undefined,
    reject: JSValue = .undefined,
    /// Align to 64 bytes to prevent false sharing
    has_pending_activity: std.atomic.Value(usize) align(64) = std.atomic.Value(usize).init(0),
    started: std.atomic.Value(bool) align(64) = std.atomic.Value(bool).init(false),

    pub usingnamespace JSC.Codegen.JSShellInterpreter;

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

    pub fn constructor(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) ?*Interpreter {
        const allocator = bun.default_allocator;
        var arena = bun.ArenaAllocator.init(allocator);

        const arguments_ = callframe.arguments(1);
        var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
        const string_args = arguments.nextEat() orelse {
            globalThis.throw("shell: expected 2 arguments, got 0", .{});
            return null;
        };

        const template_args = callframe.argumentsPtr()[1..callframe.argumentsCount()];
        var jsobjs = std.ArrayList(JSValue).init(arena.allocator());
        var script = std.ArrayList(u8).init(arena.allocator());
        if (!(bun.shell.shellCmdFromJS(arena.allocator(), globalThis, string_args, template_args, &jsobjs, &script) catch {
            globalThis.throwOutOfMemory();
            return null;
        })) {
            return null;
        }

        const lex_result = brk: {
            if (bun.strings.isAllASCII(script.items[0..])) {
                var lexer = bun.shell.LexerAscii.new(arena.allocator(), script.items[0..]);
                lexer.lex() catch |err| {
                    globalThis.throwError(err, "failed to lex shell");
                    return null;
                };
                break :brk lexer.get_result();
            }
            var lexer = bun.shell.LexerUnicode.new(arena.allocator(), script.items[0..]);
            lexer.lex() catch |err| {
                globalThis.throwError(err, "failed to lex shell");
                return null;
            };
            break :brk lexer.get_result();
        };

        var parser = bun.shell.Parser.new(arena.allocator(), lex_result, jsobjs.items[0..]) catch |err| {
            globalThis.throwError(err, "failed to create shell parser");
            return null;
        };

        const script_ast = parser.parse() catch |err| {
            globalThis.throwError(err, "failed to parse shell");
            return null;
        };

        const script_heap = arena.allocator().create(bun.shell.AST.Script) catch {
            globalThis.throwOutOfMemory();
            return null;
        };

        script_heap.* = script_ast;

        const interpreter = Interpreter.init(
            globalThis,
            allocator,
            &arena,
            script_heap,
            jsobjs.items[0..],
        ) catch {
            arena.deinit();
            return null;
        };

        return interpreter;
    }

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

        const export_env = brk: {
            var export_env = std.StringArrayHashMap([:0]const u8).init(allocator);
            errdefer {
                export_env.deinit();
            }
            var iter = global.bunVM().bundler.env.map.iter();
            while (iter.next()) |entry| {
                const dupedz = try allocator.dupeZ(u8, entry.value_ptr.value);
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

            .io = .{
                .stdout = .{ .std = .{ .captured = &interpreter.buffered_stdout } },
                // .stderr = .{ .std = .{ .captured = &interpreter.buffered_stderr } },
            },
        };

        var promise = JSC.JSPromise.create(global);
        interpreter.promise.strong.set(global, promise.asValue(global));
        return interpreter;
    }

    pub fn run(this: *Interpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = callframe; // autofix

        _ = globalThis;
        incrPendingActivityFlag(&this.has_pending_activity);
        var root = Script.init(this, this.script, this.io) catch bun.outOfMemory();
        const value = this.promise.value();
        this.started.store(true, .SeqCst);
        try root.start();
        return value;
    }

    fn ioToJSValue(this: *Interpreter, buf: *bun.ByteList) JSValue {
        var bytelist = buf.*;
        buf.* = .{};
        const arraybuf = JSC.ArrayBuffer.fromBytes(bytelist.slice(), .Uint8Array);
        const value = arraybuf.toJSUnchecked(this.global, null);
        return value;
    }

    fn finish(this: *Interpreter, exit_code: u8) void {
        log("finish", .{});
        // defer this.deinit();
        // this.promise.resolve(this.global, JSValue.jsNumberFromInt32(@intCast(exit_code)));
        // this.buffered_stdout.
        _ = this.resolve.call(this.global, &[_]JSValue{JSValue.jsNumberFromChar(exit_code)});
    }

    fn errored(this: *Interpreter, the_error: ShellError) void {
        _ = the_error; // autofix

        // defer this.deinit();
        // this.promise.reject(this.global, the_error.toJSC(this.global));
        _ = this.resolve.call(this.resolve, &[_]JSValue{JSValue.jsNumberFromChar(1)});
    }

    fn deinit(this: *Interpreter) void {
        log("deinit", .{});
        for (this.jsobjs) |jsobj| {
            jsobj.unprotect();
        }
        this.arena.deinit();
        this.allocator.destroy(this);
    }

    pub fn setResolve(this: *Interpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = globalThis;
        const value = callframe.argument(0);
        this.resolve = value;
        return .undefined;
    }

    pub fn setReject(this: *Interpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
        _ = globalThis;
        const value = callframe.argument(0);
        this.reject = value;
        return .undefined;
    }

    pub fn isRunning(
        this: *Interpreter,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        _ = globalThis; // autofix
        _ = callframe; // autofix

        return JSC.JSValue.jsBoolean(this.hasPendingActivity());
    }

    pub fn getStarted(
        this: *Interpreter,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        _ = globalThis; // autofix
        _ = callframe; // autofix

        return JSC.JSValue.jsBoolean(this.started.load(.SeqCst));
    }

    pub fn getBufferedStdout(
        this: *Interpreter,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        _ = globalThis; // autofix
        _ = callframe; // autofix

        const stdout = this.ioToJSValue(&this.buffered_stdout);
        return stdout;
    }

    pub fn getBufferedStderr(
        this: *Interpreter,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        _ = globalThis; // autofix
        _ = callframe; // autofix

        const stdout = this.ioToJSValue(&this.buffered_stderr);
        return stdout;
    }

    pub fn finalize(
        this: *Interpreter,
    ) callconv(.C) void {
        this.deinit();
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
    pub fn assignVar(this: *Interpreter, assign: *const ast.Assign, assign_ctx: AssignCtx) void {
        // All the extra allocations needed to calculate the final resultant value are done in a temp arena,
        // then the final result is copied into the interpreter's arena.
        var arena = Arena.init(this.allocator);
        defer arena.deinit();
        const arena_alloc = arena.allocator();

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

    pub fn changePrevCwd(self: *Interpreter) Maybe(void) {
        return self.changeCwd(self.prev_cwd);
    }

    pub fn changeCwd(self: *Interpreter, new_cwd_: [:0]const u8) Maybe(void) {
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

    pub fn getHomedir(self: *Interpreter) [:0]const u8 {
        if (comptime bun.Environment.isWindows) {
            if (self.export_env.get("USERPROFILE")) |env|
                return env;
        } else {
            if (self.export_env.get("HOME")) |env|
                return env;
        }
        return "unknown";
    }

    pub fn hasPendingActivity(this: *Interpreter) callconv(.C) bool {
        @fence(.SeqCst);
        return this.has_pending_activity.load(.SeqCst) > 0;
    }

    fn incrPendingActivityFlag(has_pending_activity: *std.atomic.Value(usize)) void {
        @fence(.SeqCst);
        _ = has_pending_activity.fetchAdd(1, .SeqCst);
    }

    fn decrPendingActivityFlag(has_pending_activity: *std.atomic.Value(usize)) void {
        @fence(.SeqCst);
        _ = has_pending_activity.fetchSub(1, .SeqCst);
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
                    const arena_allocator = arena.allocator();
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
                        const expanded_strings = maybe_stack_alloc.get().alloc(std.ArrayList(u8), expansion_count) catch bun.outOfMemory();
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

        var task = ShellGlobTask.createOnMainThread(this.base.interpreter.allocator, &this.child_state.glob.walker, this);
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

            const stdout = this.child_state.cmd_subst.cmd.stdoutSlice() orelse @panic("Should not happen");
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
                const expanded_strings = try maybe_stack_alloc.get().alloc(std.ArrayList(u8), expansion_count);
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

const StateKind = enum(u8) {
    script,
    stmt,
    cmd,
    cond,
    pipeline,
    expansion,
};

pub const IO = struct {
    stdin: Kind = .{ .std = .{} },
    stdout: Kind = .{ .std = .{} },
    stderr: Kind = .{ .std = .{} },

    const Kind = union(enum) {
        /// Use stdin/stdout/stderr of this process
        /// if `captured` is true, it will write to std{out,err} and also buffer it
        std: struct { captured: ?*bun.ByteList = null },
        /// Write/Read to/from file descriptor
        fd: bun.FileDescriptor,
        /// Buffers the output
        pipe,
        /// Discards output
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
                .std => .{ .inherit = .{ .captured = this.std.captured } },
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
    // currently_executing: ?ChildPtr,
    io: IO,
    state: union(enum) {
        normal: struct {
            idx: usize = 0,
        },
    } = .{ .normal = .{} },

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
        const script = try interpreter.allocator.create(Script);
        errdefer interpreter.allocator.destroy(script);
        script.* = .{
            .base = .{ .kind = .script, .interpreter = interpreter },
            .node = node,
            .io = io,
        };
        return script;
    }

    fn start(this: *Script) !void {
        if (this.node.stmts.len == 0)
            return this.finish(0);
        this.next();
    }

    fn next(this: *Script) void {
        switch (this.state) {
            .normal => {
                if (this.state.normal.idx >= this.node.stmts.len) return;
                const stmt_node = &this.node.stmts[this.state.normal.idx];
                this.state.normal.idx += 1;
                var stmt = Stmt.init(this.base.interpreter, stmt_node, this, this.io) catch bun.outOfMemory();
                stmt.start() catch bun.outOfMemory();
                return;
            },
        }
    }

    fn finish(this: *Script, exit_code: u8) void {
        log("SCRIPT DONE YO!", .{});
        this.base.interpreter.finish(exit_code);
    }

    fn childDone(this: *Script, child: ChildPtr, exit_code: u8) void {
        child.deinit();
        if (this.state.normal.idx >= this.node.stmts.len) {
            this.finish(exit_code);
            return;
        }
        this.next();
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
        const data = child.ptr.repr.data;
        log("child done Stmt {x} child({s})={x} exit={d}", .{ @intFromPtr(this), child.tagName(), @as(usize, @intCast(child.ptr.repr._ptr)), exit_code });
        this.last_exit_code = exit_code;
        const next_idx = this.idx + 1;
        const data2 = child.ptr.repr.data;
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
                const kind = "subproc";
                _ = kind;
                var cmd_io = io;
                const stdin = if (cmd_count > 1) Pipeline.readPipe(pipes, i, &cmd_io) else cmd_io.stdin;
                const stdout = if (cmd_count > 1) Pipeline.writePipe(pipes, i, cmd_count, &cmd_io) else cmd_io.stdout;
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
        const cmds = this.cmds orelse {
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
        stdin: ?bool = null,
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
                _ = io; // autofix

                // io.deinit(jsc_vm_allocator);
            }

            if (this.stdout) |*io| {
                io.deinit(jsc_vm_allocator);
            }

            if (this.stderr) |*io| {
                io.deinit(jsc_vm_allocator);
            }
        }

        fn allClosed(this: *BufferedIoClosed) bool {
            return (if (this.stdin) |stdin| stdin else true) and
                (if (this.stdout) |*stdout| stdout.closed() else true) and
                (if (this.stderr) |*stderr| stderr.closed() else true);
        }

        fn close(this: *BufferedIoClosed, io: union(enum) { stdout: *Subprocess.Readable, stderr: *Subprocess.Readable, stdin }) void {
            switch (io) {
                .stdout => {
                    if (this.stdout) |*stdout| {
                        const readable = io.stdout;
                        stdout.state = .{ .closed = readable.pipe.buffer.internal_buffer };
                        io.stdout.pipe.buffer.internal_buffer = .{};
                    }
                },
                .stderr => {
                    if (this.stderr) |*stderr| {
                        const readable = io.stderr;
                        stderr.state = .{ .closed = readable.pipe.buffer.internal_buffer };
                        io.stderr.pipe.buffer.internal_buffer = .{};
                    }
                },
                .stdin => {
                    this.stdin = true;
                    // if (this.stdin) |*stdin| {
                    //     stdin.state = .{ .closed = .{} };
                    // }
                },
            }
        }

        fn isBuffered(this: *BufferedIoClosed, comptime io: enum { stdout, stderr, stdin }) bool {
            return @field(this, @tagName(io)) != null;
        }

        fn fromStdio(io: *const [3]Subprocess.Stdio) BufferedIoClosed {
            return .{
                .stdin = if (io[bun.STDIN_FD].isPiped()) false else null,
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
            const resolved = which(&path_buf, spawn_args.PATH, spawn_args.cwd, first_arg[0..first_arg_len]) orelse {
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
            const fd: u32 = if (this.node.redirect.stdout) bun.STDOUT_FD else (if (this.node.redirect.stdin) bun.STDIN_FD else bun.STDERR_FD);
            const in_cmd_subst = false;

            if (comptime in_cmd_subst) {
                spawn_args.stdio[fd] = .ignore;
            } else switch (redirect) {
                .jsbuf => |val| {
                    if (this.base.interpreter.jsobjs[val.idx].asArrayBuffer(this.base.interpreter.global)) |buf| {
                        const stdio: Subprocess.Stdio = .{ .array_buffer = .{
                            .buf = JSC.ArrayBuffer.Strong{
                                .array_buffer = buf,
                                .held = JSC.Strong.create(buf.value, this.base.interpreter.global),
                            },
                            .from_jsc = true,
                        } };

                        spawn_args.stdio[fd] = stdio;
                    } else if (this.base.interpreter.jsobjs[val.idx].as(JSC.WebCore.Blob)) |blob| {
                        if (!Subprocess.extractStdioBlob(this.base.interpreter.global, .{ .Blob = blob.dupe() }, fd, &spawn_args.stdio)) {
                            @panic("FIXME OOPS");
                        }
                    } else if (JSC.WebCore.ReadableStream.fromJS(this.base.interpreter.jsobjs[val.idx], this.base.interpreter.global)) |rstream| {
                        const stdio: Subprocess.Stdio = .{
                            .pipe = rstream,
                        };

                        spawn_args.stdio[fd] = stdio;
                    } else if (this.base.interpreter.jsobjs[val.idx].as(JSC.WebCore.Response)) |req| {
                        req.getBodyValue().toBlobIfPossible();
                        if (!Subprocess.extractStdioBlob(this.base.interpreter.global, req.getBodyValue().useAsAnyBlob(), fd, &spawn_args.stdio)) {
                            @panic("FIXME OOPS");
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

        this.exec = .{ .subproc = .{
            .child = undefined,
            .buffered_closed = buffered_closed,
        } };
        const subproc = (try Subprocess.spawnAsync(this.base.interpreter.global, spawn_args, &this.exec.subproc.child)) orelse return ShellError.Spawn;
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

    pub fn bufferedInputClose(this: *Cmd) void {
        this.exec.subproc.buffered_closed.close(.stdin);
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
        if (this.io.stdout == .std and this.io.stdout.std.captured != null) {
            var buf = this.io.stdout.std.captured.?;
            buf.append(bun.default_allocator, this.exec.subproc.child.stdout.pipe.buffer.internal_buffer.slice()) catch bun.outOfMemory();
        }
        this.exec.subproc.buffered_closed.close(.{ .stdout = &this.exec.subproc.child.stdout });
        this.exec.subproc.child.closeIO(.stdout);
    }

    pub fn bufferedOutputCloseStderr(this: *Cmd) void {
        if (comptime bun.Environment.allow_assert) {
            std.debug.assert(this.exec == .subproc);
        }
        log("cmd ({x}) close buffered stderr", .{@intFromPtr(this)});
        if (this.io.stderr == .std and this.io.stderr.std.captured != null) {
            var buf = this.io.stderr.std.captured.?;
            buf.append(bun.default_allocator, this.exec.subproc.child.stderr.pipe.buffer.internal_buffer.slice()) catch bun.outOfMemory();
        }
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

pub fn closefd(fd: bun.FileDescriptor) void {
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
        const iter = env.iterator();
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
    comptime EventLoopKind: JSC.EventLoopKind,
    /// Function to be called when the thread pool starts the task, this could
    /// be on anyone of the thread pool threads so be mindful of concurrency
    /// nuances
    comptime runFromThreadPool_: fn (*Ctx) void,
    /// Function that is called on the main thread, once the event loop
    /// processes that the task is done
    comptime runFromMainThread_: fn (*Ctx) void,
    comptime print: fn (comptime fmt: []const u8, args: anytype) void,
) type {
    const EventLoopRef = switch (EventLoopKind) {
        .js => *JSC.EventLoop,
        .mini => *JSC.MiniEventLoop,
    };
    const event_loop_ref = struct {
        fn get() EventLoopRef {
            return switch (EventLoopKind) {
                .js => JSC.VirtualMachine.get().event_loop,
                .mini => bun.JSC.MiniEventLoop.global,
            };
        }
    };
    _ = event_loop_ref; // autofix

    const EventLoopTask = switch (EventLoopKind) {
        .js => JSC.ConcurrentTask,
        .mini => JSC.AnyTaskWithExtraContext,
    };
    return struct {
        task: WorkPoolTask = .{ .callback = &runFromThreadPool },
        event_loop: EventLoopRef,
        // This is a poll because we want it to enter the uSockets loop
        ref: bun.Async.KeepAlive = .{},
        concurrent_task: EventLoopTask = .{},

        pub const InnerShellTask = @This();

        pub fn schedule(this: *@This()) void {
            print("schedule", .{});
            this.ref.ref(this.event_loop.getEventLoopCtx());
            WorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *@This()) void {
            print("onFinish", .{});
            const ctx = @fieldParentPtr(Ctx, "task", this);
            if (comptime EventLoopKind == .js) {
                this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(ctx, .manual_deinit));
            } else {
                this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(ctx, "runFromMainThread"));
            }
        }

        pub fn runFromThreadPool(task: *WorkPoolTask) void {
            print("runFromThreadPool", .{});
            var this = @fieldParentPtr(@This(), "task", task);
            const ctx = @fieldParentPtr(Ctx, "task", this);
            runFromThreadPool_(ctx);
            this.onFinish();
        }

        pub fn runFromMainThread(this: *@This()) void {
            print("runFromJS", .{});
            const ctx = @fieldParentPtr(Ctx, "task", this);
            this.ref.unref(this.event_loop.getEventLoopCtx());
            runFromMainThread_(ctx);
        }
    };
}

pub const ShellGlobTask = NewShellGlobTask(.js);
pub const ShellGlobTaskMini = NewShellGlobTask(.mini);

pub fn NewShellGlobTask(comptime EventLoop: JSC.EventLoopKind) type {
    const EventLoopRef = switch (EventLoop) {
        .js => *JSC.EventLoop,
        .mini => *JSC.MiniEventLoop,
    };
    const event_loop_ref = struct {
        fn get() EventLoopRef {
            return switch (EventLoop) {
                .js => JSC.VirtualMachine.get().event_loop,
                .mini => bun.JSC.MiniEventLoop.global,
            };
        }
    };

    const EventLoopTask = switch (EventLoop) {
        .js => JSC.ConcurrentTask,
        .mini => JSC.AnyTaskWithExtraContext,
    };

    return struct {
        const print = bun.Output.scoped(.ShellGlobTask, false);

        task: WorkPoolTask = .{ .callback = &runFromThreadPool },

        /// Not owned by this struct
        expansion: *Expansion,
        /// Not owned by this struct
        walker: *GlobWalker,

        result: std.ArrayList([:0]const u8),
        allocator: Allocator,
        event_loop: EventLoopRef,
        concurrent_task: EventLoopTask = .{},
        // This is a poll because we want it to enter the uSockets loop
        ref: bun.Async.KeepAlive = .{},
        err: ?Err = null,

        const This = @This();

        pub const event_loop_kind = EventLoop;

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

        pub fn createOnMainThread(allocator: Allocator, walker: *GlobWalker, expansion: *Expansion) *This {
            print("createOnMainThread", .{});
            var this = allocator.create(This) catch bun.outOfMemory();
            this.* = .{
                .event_loop = event_loop_ref.get(),
                .walker = walker,
                .allocator = allocator,
                .expansion = expansion,
                .result = std.ArrayList([:0]const u8).init(allocator),
            };
            // this.ref.ref(this.event_loop.virtual_machine);
            this.ref.ref(event_loop_ref.get().getEventLoopCtx());

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

        pub fn runFromMainThread(this: *This) void {
            print("runFromJS", .{});
            this.expansion.onGlobWalkDone(this);
            // this.ref.unref(this.event_loop.virtual_machine);
            this.ref.unref(this.event_loop.getEventLoopCtx());
        }

        pub fn runFromMainThreadMini(this: *This, _: *void) void {
            this.runFromMainThread();
        }

        pub fn schedule(this: *This) void {
            print("schedule", .{});
            WorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *This) void {
            print("onFinish", .{});
            if (comptime EventLoop == .js) {
                this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
            } else {
                this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, "runFromMainThreadMini"));
            }
        }

        pub fn deinit(this: *This) void {
            print("deinit", .{});
            this.result.deinit();
            this.allocator.destroy(this);
        }
    };
}

/// This writes to the output and also
pub const CapturedWriter = struct {
    bufw: BufferedWriter,
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
    /// optional bytelist for capturing the data
    bytelist: ?*bun.ByteList = null,

    const print = bun.Output.scoped(.BufferedWriter, false);

    pub const ParentPtr = struct {
        const Types = .{
            Builtin.Export,
            Builtin.Echo,
            Builtin.Cd,
            Builtin.Which,
            Builtin.Rm,
            Builtin.Pwd,
            Builtin.Mv,
            Builtin.Ls,
        };
        ptr: Repr,
        pub const Repr = TaggedPointerUnion(Types);

        pub fn underlying(this: ParentPtr) type {
            inline for (Types) |Ty| {
                if (this.ptr.is(Ty)) return Ty;
            }
            @panic("Uh oh");
        }

        pub fn init(p: anytype) ParentPtr {
            return .{
                .ptr = Repr.init(p),
            };
        }

        pub fn onDone(this: ParentPtr, e: ?Syscall.Error) void {
            if (this.ptr.is(Builtin.Export)) return this.ptr.as(Builtin.Export).onBufferedWriterDone(e);
            if (this.ptr.is(Builtin.Echo)) return this.ptr.as(Builtin.Echo).onBufferedWriterDone(e);
            if (this.ptr.is(Builtin.Cd)) return this.ptr.as(Builtin.Cd).onBufferedWriterDone(e);
            if (this.ptr.is(Builtin.Which)) return this.ptr.as(Builtin.Which).onBufferedWriterDone(e);
            if (this.ptr.is(Builtin.Rm)) return this.ptr.as(Builtin.Rm).onBufferedWriterDone(e);
            if (this.ptr.is(Builtin.Pwd)) return this.ptr.as(Builtin.Pwd).onBufferedWriterDone(e);
            if (this.ptr.is(Builtin.Mv)) return this.ptr.as(Builtin.Mv).onBufferedWriterDone(e);
            if (this.ptr.is(Builtin.Ls)) return this.ptr.as(Builtin.Ls).onBufferedWriterDone(e);
            @panic("Invalid ptr tag");
        }
    };

    pub fn isDone(this: *BufferedWriter) bool {
        return this.remain.len == 0 or this.err != null;
    }

    pub const event_loop_kind = JSC.EventLoopKind.js;
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
                    if (this.bytelist) |blist| {
                        blist.append(bun.default_allocator, to_write[0..bytes_written]) catch bun.outOfMemory();
                    }

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
        this.parent.onDone(this.err);
    }
};

const SliceBufferSrc = struct {
    remain: []const u8 = "",

    fn bufToWrite(this: SliceBufferSrc, written: usize) []const u8 {
        if (written >= this.remain.len) return "";
        return this.remain[written..];
    }

    fn isDone(this: SliceBufferSrc, written: usize) bool {
        return written >= this.remain.len;
    }
};

const BuiltinParent = struct {
    const Types = .{
        Builtin.Export,
        Builtin.Echo,
        Builtin.Cd,
        Builtin.Which,
        Builtin.Rm,
        Builtin.Pwd,
        Builtin.Mv,
        Builtin.Ls,
    };
    ptr: Repr,
    const Repr = TaggedPointerUnion(Types);

    fn underlying(this: BuiltinParent) type {
        inline for (Types) |Ty| {
            if (this.ptr.is(Ty)) return Ty;
        }
        @panic("Uh oh");
    }

    fn init(p: anytype) BuiltinParent {
        return .{
            .ptr = Repr.init(p),
        };
    }

    fn onDone(this: BuiltinParent, bw: *@This(), e: ?Syscall.Error) void {
        if (this.ptr.is(Builtin.Export)) return this.ptr.as(Builtin.Export).onBufferedWriterDone(bw, e);
        if (this.ptr.is(Builtin.Echo)) return this.ptr.as(Builtin.Echo).onBufferedWriterDone(bw, e);
        if (this.ptr.is(Builtin.Cd)) return this.ptr.as(Builtin.Cd).onBufferedWriterDone(bw, e);
        if (this.ptr.is(Builtin.Which)) return this.ptr.as(Builtin.Which).onBufferedWriterDone(bw, e);
        if (this.ptr.is(Builtin.Rm)) return this.ptr.as(Builtin.Rm).onBufferedWriterDone(bw, e);
        if (this.ptr.is(Builtin.Pwd)) return this.ptr.as(Builtin.Pwd).onBufferedWriterDone(bw, e);
        if (this.ptr.is(Builtin.Mv)) return this.ptr.as(Builtin.Mv).onBufferedWriterDone(bw, e);
        if (this.ptr.is(Builtin.Ls)) return this.ptr.as(Builtin.Ls).onBufferedWriterDone(bw, e);
        @panic("Invalid ptr tag");
    }
};

/// This is modified version of BufferedInput for file descriptors only. This
/// struct cleans itself up when it is done, so no need to call `.deinit()` on
/// it.
pub fn NewBufferedWriter(comptime Src: type, comptime Parent: type) type {
    const SrcHandler = struct {
        src: Src,

        inline fn bufToWrite(src: Src, written: usize) []const u8 {
            if (!@hasDecl(Src, "bufToWrite")) @compileError("Need `bufToWrite`");
            return src.bufToWrite(written);
        }

        inline fn isDone(src: Src, written: usize) bool {
            if (!@hasDecl(Src, "isDone")) @compileError("Need `bufToWrite`");
            return src.isDone(written);
        }
    };

    return struct {
        src: Src,
        fd: bun.FileDescriptor,
        poll_ref: ?*bun.Async.FilePoll = null,
        written: usize = 0,
        parent: Parent,
        err: ?Syscall.Error = null,

        pub const ParentType = Parent;

        const print = bun.Output.scoped(.BufferedWriter, false);

        pub fn isDone(this: *@This()) bool {
            return SrcHandler.isDone(this.src, this.written) or this.err != null;
        }

        pub const event_loop_kind = JSC.EventLoopKind.js;
        pub usingnamespace JSC.WebCore.NewReadyWatcher(@This(), .writable, onReady);

        pub fn onReady(this: *@This(), _: i64) void {
            if (this.fd == bun.invalid_fd) {
                return;
            }

            this.__write();
        }

        pub fn writeIfPossible(this: *@This(), comptime is_sync: bool) void {
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
        pub fn __write(this: *@This()) void {
            this.writeAllowBlocking(false);
        }

        pub fn writeAllowBlocking(this: *@This(), allow_blocking: bool) void {
            _ = allow_blocking; // autofix

            var to_write = SrcHandler.bufToWrite(this.src, this.written);

            if (to_write.len == 0) {
                // we are done!
                // this.closeFDIfOpen();
                if (SrcHandler.isDone(this.src, this.written)) {
                    this.deinit();
                }
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

                        // this.remain = this.remain[@min(bytes_written, this.remain.len)..];
                        // to_write = to_write[bytes_written..];

                        // // we are done or it accepts no more input
                        // if (this.remain.len == 0 or (allow_blocking and bytes_written == 0)) {
                        //     this.deinit();
                        //     return;
                        // }

                        to_write = SrcHandler.bufToWrite(this.src, this.written);
                        if (to_write.len == 0) {
                            if (SrcHandler.isDone(this.src, this.written)) {
                                this.deinit();
                                return;
                            }
                        }
                    },
                }
            }
        }

        fn closeFDIfOpen(this: *@This()) void {
            if (this.poll_ref) |poll| {
                this.poll_ref = null;
                poll.deinit();
            }

            if (this.fd != bun.invalid_fd) {
                _ = bun.sys.close(this.fd);
                this.fd = bun.invalid_fd;
            }
        }

        pub fn deinit(this: *@This()) void {
            this.closeFDIfOpen();
            this.parent.onDone(this.err);
        }
    };
}

// pub const Builtin =

inline fn errnocast(errno: anytype) u16 {
    return @intCast(errno);
}
