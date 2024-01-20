//! The interpreter for the shell language
//!
//! Normally, the implementation would be a very simple tree-walk of the AST,
//! but it needs to be non-blocking, and Zig does not have coroutines yet, so
//! this implementation is half tree-walk half one big state machine. The state
//! machine part manually keeps track of execution state (which coroutines would
//! do for us), but makes the code very confusing because control flow is less obvious.
//!
//! Things to note:
//! - If you want to do something analogous to yielding execution, you must
//!    `return` from the function. For example in the code we start an async
//!    BufferedWriter and "yield" execution by calling =.start()= on the writer and
//!    then `return`ing form the function
//! - Sometimes a state machine will immediately finish and deinit itself so
//!     that might cause some unintuitive things to happen. For example if you
//!     `defer` some code, then try to yield execution to some state machine struct,
//!     and it immediately finishes, it will deinit itself and the defer code might
//!     use undefined memory.
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
// const Subprocess = bun.ShellSubprocess;
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

pub const SUBSHELL_TODO_ERROR = "Subshells are not implemented, please open GitHub issue.";
const stdin_no = 0;
const stdout_no = 1;
const stderr_no = 2;

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

const ExitCode = if (bun.Environment.isWindows) u16 else u8;

pub const StateKind = enum(u8) {
    script,
    stmt,
    assign,
    cmd,
    cond,
    pipeline,
    expansion,
};

/// Copy-on-write
pub fn Cow(comptime T: type, comptime VTable: type) type {
    const Handler = struct {
        fn copy(this: *T) T {
            if (@hasDecl(VTable, "copy")) @compileError(@typeName(VTable) ++ " needs `copy()` function");
            return VTable.copy(this);
        }

        fn deinit(this: *T) void {
            if (@hasDecl(VTable, "deinit")) @compileError(@typeName(VTable) ++ " needs `deinit()` function");
            return VTable.deinit(this);
        }
    };

    return union(enum) {
        borrowed: *T,
        owned: T,

        pub fn borrow(val: *T) @This() {
            return .{
                .borrowed = val,
            };
        }

        pub fn own(val: T) @This() {
            return .{
                .owned = val,
            };
        }

        /// Get the underlying value.
        pub inline fn inner(this: *@This()) *T {
            return switch (this.*) {
                .borrowed => this.borrowed,
                .owned => &this.owned,
            };
        }

        pub fn copy(this: *@This()) void {
            switch (this.*) {
                .borrowed => {
                    this.* = .{
                        .owned = Handler.copy(this.borrowed),
                    };
                },
                .owned => {},
            }
        }

        pub fn deinit(this: *@This()) void {
            Handler.deinit(this.inner());
        }
    };
}

pub const CoroutineResult = enum {
    /// it's okay for the caller to continue its execution
    cont,
    yield,
};

pub const IO = struct {
    stdin: Kind = .{ .std = .{} },
    stdout: Kind = .{ .std = .{} },
    stderr: Kind = .{ .std = .{} },

    pub const Kind = union(enum) {
        /// Use stdin/stdout/stderr of this process
        /// If `captured` is non-null, it will write to std{out,err} and also buffer it.
        /// The pointer points to the `buffered_stdout`/`buffered_stdin` fields
        /// in the Interpreter struct
        std: struct { captured: ?*bun.ByteList = null },
        /// Write/Read to/from file descriptor
        fd: bun.FileDescriptor,
        /// Buffers the output
        pipe,
        /// Discards output
        ignore,

        // fn dupeForSubshell(this: *ShellState,

        fn close(this: Kind) void {
            switch (this) {
                .fd => {
                    closefd(this.fd);
                },
                else => {},
            }
        }

        fn to_subproc_stdio(this: Kind) bun.shell.subproc.Stdio {
            return switch (this) {
                .std => .{ .inherit = .{ .captured = this.std.captured } },
                .fd => |val| .{ .fd = val },
                .pipe => .{ .pipe = null },
                .ignore => .ignore,
            };
        }
    };

    fn to_subproc_stdio(this: IO, stdio: *[3]bun.shell.subproc.Stdio) void {
        stdio[stdin_no] = this.stdin.to_subproc_stdio();
        stdio[stdout_no] = this.stdout.to_subproc_stdio();
        stdio[stderr_no] = this.stderr.to_subproc_stdio();
    }
};

pub const Interpreter = NewInterpreter(.js);
pub const InterpreterMini = NewInterpreter(.mini);

/// Environment strings need to be copied a lot
/// So we make them reference counted
///
/// But sometimes we use strings that are statically allocated, or are allocated
/// with a predetermined lifetime (e.g. strings in the AST). In that case we
/// don't want to incur the cost of heap allocating them and refcounting them
///
/// So environment strings can be ref counted or borrowed slices
pub const EnvStr = packed struct {
    ptr: u48,
    tag: Tag,
    len: usize = 0,

    const print = bun.Output.scoped(.EnvStr, false);

    const Tag = enum(u16) {
        /// Dealloced by reference counting
        refcounted,
        /// Memory is managed elsewhere so don't dealloc it
        slice,
    };

    inline fn initSlice(str: []const u8) EnvStr {
        return .{
            .ptr = @intCast(@intFromPtr(str.ptr)),
            .tag = .slice,
            .len = str.len,
        };
    }

    fn initRefCounted(str: []const u8) EnvStr {
        return .{
            .ptr = @intCast(@intFromPtr(RefCountedStr.init(str))),
            .tag = .refcounted,
        };
    }

    pub fn slice(this: EnvStr) []const u8 {
        if (this.asRefCounted()) |refc| {
            return refc.byteSlice();
        }
        return this.castSlice();
    }

    fn ref(this: EnvStr) void {
        if (this.asRefCounted()) |refc| {
            refc.ref();
        }
    }

    fn deref(this: EnvStr) void {
        if (this.asRefCounted()) |refc| {
            refc.deref();
        }
    }

    inline fn asRefCounted(this: EnvStr) ?*RefCountedStr {
        if (this.tag == .refcounted) return this.castRefCounted();
        return null;
    }

    inline fn castSlice(this: EnvStr) []const u8 {
        return @as([*]u8, @ptrFromInt(@as(usize, @intCast(this.ptr))))[0..this.len];
    }

    inline fn castRefCounted(this: EnvStr) *RefCountedStr {
        return @ptrFromInt(@as(usize, @intCast(this.ptr)));
    }
};

pub const RefCountedStr = struct {
    refcount: u32 = 1,
    len: u32 = 0,
    ptr: [*]const u8 = undefined,

    const print = bun.Output.scoped(.RefCountedEnvStr, true);

    // /// Use bun.default_allocator
    // const DEFAULT_ALLOC_TAG: usize = 1 << 63;

    fn init(slice: []const u8) *RefCountedStr {
        print("init: {s}", .{slice});
        const this = bun.default_allocator.create(RefCountedStr) catch bun.outOfMemory();
        this.* = .{
            .refcount = 1,
            .len = @intCast(slice.len),
            .ptr = slice.ptr,
        };
        return this;
    }

    fn byteSlice(this: *RefCountedStr) []const u8 {
        if (this.len == 0) return "";
        return this.ptr[0..this.len];
    }

    fn ref(this: *RefCountedStr) void {
        this.refcount += 1;
    }

    fn deref(this: *RefCountedStr) void {
        this.refcount -= 1;
        if (this.refcount == 0) {
            this.deinit();
        }
    }

    fn deinit(this: *RefCountedStr) void {
        print("deinit: {s}", .{this.byteSlice()});
        this.freeStr();
        bun.default_allocator.destroy(this);
    }

    fn freeStr(this: *RefCountedStr) void {
        if (this.len == 0) return;
        // if (this.ptr & DEFAULT_ALLOC_TAG != 0) {
        bun.default_allocator.free(this.ptr[0..this.len]);
        // } else {}
    }
};

/// TODO use this
/// Either
///    A: subshells (`$(...)` or `(...)`) or
///    B: commands in a pipeline
/// will need their own copy of the shell environment because they could modify it,
/// and those changes shouldn't affect the surounding environment.
///
/// This results in a lot of copying, which is wasteful since most of the time
/// A) or B) won't even mutate the environment anyway.
///
/// A way to reduce copying is to only do it when the env is mutated: copy-on-write.
pub const CowEnvMap = Cow(EnvMap, struct {
    pub fn copy(val: *EnvMap) EnvMap {
        return val.clone();
    }

    pub fn deinit(val: *EnvMap) void {
        val.deinit();
    }
});

pub const EnvMap = struct {
    map: MapType,
    pub const Iterator = MapType.Iterator;

    const MapType = std.ArrayHashMap(EnvStr, EnvStr, struct {
        pub fn hash(self: @This(), s: EnvStr) u32 {
            _ = self;
            return std.array_hash_map.hashString(s.slice());
        }
        pub fn eql(self: @This(), a: EnvStr, b: EnvStr, b_index: usize) bool {
            _ = self;
            _ = b_index;
            return std.array_hash_map.eqlString(a.slice(), b.slice());
        }
    }, true);

    fn init(alloc: Allocator) EnvMap {
        return .{ .map = MapType.init(alloc) };
    }

    fn deinit(this: *EnvMap) void {
        this.derefStrings();
        this.map.deinit();
    }

    fn insert(this: *EnvMap, key: EnvStr, val: EnvStr) void {
        const result = this.map.getOrPut(key) catch bun.outOfMemory();
        if (!result.found_existing) {
            key.ref();
        } else {
            result.value_ptr.deref();
        }
        val.ref();
        result.value_ptr.* = val;
    }

    fn iterator(this: *EnvMap) MapType.Iterator {
        return this.map.iterator();
    }

    fn clearRetainingCapacity(this: *EnvMap) void {
        this.derefStrings();
        this.map.clearRetainingCapacity();
    }

    fn ensureTotalCapacity(this: *EnvMap, new_capacity: usize) void {
        this.map.ensureTotalCapacity(new_capacity) catch bun.outOfMemory();
    }

    /// NOTE: Make sure you deref the string when done!
    fn get(this: *EnvMap, key: EnvStr) ?EnvStr {
        const val = this.map.get(key) orelse return null;
        val.ref();
        return val;
    }

    fn clone(this: *EnvMap) EnvMap {
        var new: EnvMap = .{
            .map = this.map.clone() catch bun.outOfMemory(),
        };
        new.refStrings();
        return new;
    }

    fn cloneWithAllocator(this: *EnvMap, allocator: Allocator) EnvMap {
        var new: EnvMap = .{
            .map = this.map.cloneWithAllocator(allocator) catch bun.outOfMemory(),
        };
        new.refStrings();
        return new;
    }

    fn refStrings(this: *EnvMap) void {
        var iter = this.map.iterator();
        while (iter.next()) |entry| {
            entry.key_ptr.ref();
            entry.value_ptr.ref();
        }
    }

    fn derefStrings(this: *EnvMap) void {
        var iter = this.map.iterator();
        while (iter.next()) |entry| {
            entry.key_ptr.deref();
            entry.value_ptr.deref();
        }
    }
};

/// This interpreter works by basically turning the AST into a state machine so
/// that execution can be suspended and resumed to support async.
pub fn NewInterpreter(comptime EventLoopKind: JSC.EventLoopKind) type {
    const GlobalRef = switch (EventLoopKind) {
        .js => *JSGlobalObject,
        .mini => *JSC.MiniEventLoop,
    };

    const GlobalHandle = switch (EventLoopKind) {
        .js => bun.shell.GlobalJS,
        .mini => bun.shell.GlobalMini,
    };

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
    const global_handle = struct {
        fn get() GlobalHandle {
            return switch (EventLoopKind) {
                .js => bun.shell.GlobalJS.init(JSC.VirtualMachine.get().global),
                .mini => bun.shell.GlobalMini.init(bun.JSC.MiniEventLoop.global),
            };
        }
    };

    const EventLoopTask = switch (EventLoopKind) {
        .js => JSC.ConcurrentTask,
        .mini => JSC.AnyTaskWithExtraContext,
    };

    // const Builtin = switch (EventLoopKind) {
    //     .js => NewBuiltin(.js),
    //     .mini => NewBuiltin(.mini),
    // };

    // const Subprocess = switch (EventLoopKind) {
    //     .js => bun.shell.Subprocess,
    //     .mini => bun.shell.SubprocessMini,
    // };
    // const Subprocess = bun.shell.subproc.NewShellSubprocess(EventLoopKind);

    return struct {
        global: GlobalRef,
        /// This is the arena used to allocate the input shell script's AST nodes,
        /// tokens, and a string pool used to store all strings.
        arena: bun.ArenaAllocator,
        /// This is the allocator used to allocate interpreter state
        allocator: Allocator,

        /// Root ast node
        script: *ast.Script,

        /// JS objects used as input for the shell script
        /// This should be allocated using the arena
        jsobjs: []JSValue,

        root_shell: ShellState,

        resolve: JSC.Strong = .{},
        reject: JSC.Strong = .{},
        has_pending_activity: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),
        started: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

        done: ?*bool = null,

        const InterpreterChildPtr = StatePtrUnion(.{
            Script,
        });

        pub const ShellState = struct {
            io: IO = .{},
            kind: Kind = .normal,

            /// These MUST use the `bun.default_allocator` Allocator
            _buffered_stdout: Bufio = .{ .owned = .{} },
            _buffered_stderr: Bufio = .{ .owned = .{} },

            /// TODO Performance optimization: make these env maps copy-on-write
            /// Shell env for expansion by the shell
            shell_env: EnvMap,
            /// Local environment variables to be given to a subprocess
            cmd_local_env: EnvMap,
            /// Exported environment variables available to all subprocesses. This includes system ones.
            export_env: EnvMap,

            /// The current working directory of the shell.
            /// Use an array list so we don't have to keep reallocating
            /// Always has zero-sentinel
            __prev_cwd: std.ArrayList(u8),
            __cwd: std.ArrayList(u8),
            cwd_fd: bun.FileDescriptor,

            const Bufio = union(enum) { owned: bun.ByteList, borrowed: *bun.ByteList };

            const Kind = enum {
                normal,
                cmd_subst,
                subshell,
                pipeline,
            };

            pub fn buffered_stdout(this: *ShellState) *bun.ByteList {
                return switch (this._buffered_stdout) {
                    .owned => &this._buffered_stdout.owned,
                    .borrowed => this._buffered_stdout.borrowed,
                };
            }

            pub fn buffered_stderr(this: *ShellState) *bun.ByteList {
                return switch (this._buffered_stderr) {
                    .owned => &this._buffered_stderr.owned,
                    .borrowed => this._buffered_stderr.borrowed,
                };
            }

            pub inline fn cwdZ(this: *ShellState) [:0]const u8 {
                if (this.__cwd.items.len == 0) return "";
                return this.__cwd.items[0..this.__cwd.items.len -| 1 :0];
            }

            pub inline fn prevCwdZ(this: *ShellState) [:0]const u8 {
                if (this.__prev_cwd.items.len == 0) return "";
                return this.__prev_cwd.items[0..this.__prev_cwd.items.len -| 1 :0];
            }

            pub inline fn prevCwd(this: *ShellState) []const u8 {
                const prevcwdz = this.prevCwdZ();
                return prevcwdz[0..prevcwdz.len];
            }

            pub inline fn cwd(this: *ShellState) []const u8 {
                const cwdz = this.cwdZ();
                return cwdz[0..cwdz.len];
            }

            pub fn deinit(this: *ShellState) void {
                this.deinitImpl(true, true);
            }

            /// If called by interpreter we have to:
            /// 1. not free this *ShellState, because its on a field on the interpreter
            /// 2. don't free buffered_stdout and buffered_stderr, because that is used for output
            fn deinitImpl(this: *ShellState, comptime destroy_this: bool, comptime free_buffered_io: bool) void {
                log("[ShellState] deinit {x}", .{@intFromPtr(this)});

                if (comptime free_buffered_io) {
                    if (this._buffered_stdout == .owned) {
                        this._buffered_stdout.owned.deinitWithAllocator(bun.default_allocator);
                    }
                    if (this._buffered_stderr == .owned) {
                        this._buffered_stderr.owned.deinitWithAllocator(bun.default_allocator);
                    }
                }

                this.shell_env.deinit();
                this.cmd_local_env.deinit();
                this.export_env.deinit();
                this.__cwd.deinit();
                this.__prev_cwd.deinit();
                closefd(this.cwd_fd);

                if (comptime destroy_this) bun.default_allocator.destroy(this);
            }

            pub fn dupeForSubshell(this: *ShellState, allocator: Allocator, io: IO, kind: Kind) Maybe(*ShellState) {
                const duped = allocator.create(ShellState) catch bun.outOfMemory();

                const dupedfd = switch (Syscall.dup(this.cwd_fd)) {
                    .err => |err| return .{ .err = err },
                    .result => |fd| fd,
                };

                const stdout: Bufio = if (io.stdout == .std) brk: {
                    if (io.stdout.std.captured != null) break :brk .{ .borrowed = io.stdout.std.captured.? };
                    break :brk .{ .owned = .{} };
                } else if (kind == .pipeline)
                    .{ .borrowed = this.buffered_stdout() }
                else
                    .{ .owned = .{} };

                const stderr: Bufio = if (io.stderr == .std) brk: {
                    if (io.stderr.std.captured != null) break :brk .{ .borrowed = io.stderr.std.captured.? };
                    break :brk .{ .owned = .{} };
                } else if (kind == .pipeline)
                    .{ .borrowed = this.buffered_stderr() }
                else
                    .{ .owned = .{} };

                duped.* = .{
                    .io = io,
                    .kind = kind,
                    ._buffered_stdout = stdout,
                    ._buffered_stderr = stderr,
                    .shell_env = this.shell_env.clone(),
                    .cmd_local_env = EnvMap.init(allocator),
                    .export_env = this.export_env.clone(),

                    .__prev_cwd = this.__prev_cwd.clone() catch bun.outOfMemory(),
                    .__cwd = this.__cwd.clone() catch bun.outOfMemory(),
                    // TODO probably need to use os.dup here
                    .cwd_fd = dupedfd,
                };

                return .{ .result = duped };
            }

            pub fn assignVar(this: *ShellState, interp: *ThisInterpreter, label: EnvStr, value: EnvStr, assign_ctx: AssignCtx) void {
                _ = interp; // autofix
                switch (assign_ctx) {
                    .cmd => this.cmd_local_env.insert(label, value),
                    .shell => this.shell_env.insert(label, value),
                    .exported => this.export_env.insert(label, value),
                }
            }

            pub fn changePrevCwd(self: *ShellState, interp: *ThisInterpreter) Maybe(void) {
                return self.changeCwd(interp, self.prevCwdZ());
            }

            // pub fn changeCwd(this: *ShellState, interp: *ThisInterpreter, new_cwd_: [:0]const u8) Maybe(void) {
            pub fn changeCwd(this: *ShellState, interp: *ThisInterpreter, new_cwd_: anytype) Maybe(void) {
                _ = interp; // autofix
                if (comptime @TypeOf(new_cwd_) != [:0]const u8 and @TypeOf(new_cwd_) != []const u8) {
                    @compileError("Bad type for new_cwd " ++ @typeName(@TypeOf(new_cwd_)));
                }
                const is_sentinel = @TypeOf(new_cwd_) == [:0]const u8;

                const new_cwd: [:0]const u8 = brk: {
                    if (ResolvePath.Platform.auto.isAbsolute(new_cwd_)) {
                        if (is_sentinel) {
                            @memcpy(ResolvePath.join_buf[0..new_cwd_.len], new_cwd_[0..new_cwd_.len]);
                            ResolvePath.join_buf[new_cwd_.len] = 0;
                            break :brk ResolvePath.join_buf[0..new_cwd_.len :0];
                        }
                        std.mem.copyForwards(u8, &ResolvePath.join_buf, new_cwd_);
                        ResolvePath.join_buf[new_cwd_.len] = 0;
                        break :brk ResolvePath.join_buf[0..new_cwd_.len :0];
                    }

                    const existing_cwd = this.cwd();
                    const cwd_str = ResolvePath.joinZ(&[_][]const u8{
                        existing_cwd,
                        new_cwd_,
                    }, .auto);

                    // remove trailing separator
                    if (cwd_str.len > 1 and cwd_str[cwd_str.len - 1] == '/') {
                        ResolvePath.join_buf[cwd_str.len - 1] = 0;
                        break :brk ResolvePath.join_buf[0 .. cwd_str.len - 1 :0];
                    }

                    break :brk cwd_str;
                };

                const new_cwd_fd = switch (Syscall.openat(
                    this.cwd_fd,
                    new_cwd,
                    std.os.O.DIRECTORY | std.os.O.RDONLY,
                    0,
                )) {
                    .result => |fd| fd,
                    .err => |err| {
                        return Maybe(void).initErr(err);
                    },
                };
                _ = Syscall.close2(this.cwd_fd);

                this.__prev_cwd.clearRetainingCapacity();
                this.__prev_cwd.appendSlice(this.__cwd.items[0..]) catch bun.outOfMemory();

                this.__cwd.clearRetainingCapacity();
                this.__cwd.appendSlice(new_cwd[0 .. new_cwd.len + 1]) catch bun.outOfMemory();

                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.__cwd.items[this.__cwd.items.len -| 1] == 0);
                    std.debug.assert(this.__prev_cwd.items[this.__prev_cwd.items.len -| 1] == 0);
                }

                this.cwd_fd = new_cwd_fd;

                this.export_env.insert(EnvStr.initSlice("OLDPWD"), EnvStr.initSlice(this.prevCwd()));
                this.export_env.insert(EnvStr.initSlice("PWD"), EnvStr.initSlice(this.cwd()));

                return Maybe(void).success;
            }

            pub fn getHomedir(self: *ShellState) EnvStr {
                if (comptime bun.Environment.isWindows) {
                    if (self.export_env.get(EnvStr.initSlice("USERPROFILE"))) |env| {
                        env.ref();
                        return env;
                    }
                } else {
                    if (self.export_env.get(EnvStr.initSlice("HOME"))) |env| {
                        env.ref();
                        return env;
                    }
                }
                return EnvStr.initSlice("unknown");
            }

            pub fn writeFailingError(
                this: *ShellState,
                buf: []const u8,
                ctx: anytype,
                comptime handleIOWrite: fn (
                    c: @TypeOf(ctx),
                    bufw: BufferedWriter,
                ) void,
            ) CoroutineResult {
                const IOWriteFn = struct {
                    pub fn run(c: @TypeOf(ctx), bufw: BufferedWriter) void {
                        handleIOWrite(c, bufw);
                    }
                };

                switch (this.writeIO(.stderr, buf, ctx, IOWriteFn.run)) {
                    .cont => {
                        ctx.parent.childDone(ctx, 1);
                        return .yield;
                    },
                    .yield => return .yield,
                }
            }

            pub fn writeIO(
                this: *ShellState,
                comptime iotype: @Type(.EnumLiteral),
                buf: []const u8,
                ctx: anytype,
                comptime handleIOWrite: fn (
                    c: @TypeOf(ctx),
                    bufw: BufferedWriter,
                ) void,
            ) CoroutineResult {
                const io: *IO.Kind = &@field(this.io, @tagName(iotype));

                switch (io.*) {
                    .std => |val| {
                        const bw = BufferedWriter{
                            .fd = if (iotype == .stdout) bun.STDOUT_FD else bun.STDERR_FD,
                            .remain = buf,
                            .parent = BufferedWriter.ParentPtr.init(ctx),
                            .bytelist = val.captured,
                        };
                        handleIOWrite(ctx, bw);
                        return .yield;
                    },
                    .fd => {
                        const bw = BufferedWriter{
                            .fd = if (iotype == .stdout) bun.STDOUT_FD else bun.STDERR_FD,
                            .remain = buf,
                            .parent = BufferedWriter.ParentPtr.init(ctx),
                        };
                        handleIOWrite(ctx, bw);
                        return .yield;
                    },
                    .pipe => {
                        const func = @field(ShellState, "buffered_" ++ @tagName(iotype));
                        const bufio: *bun.ByteList = @call(.auto, func, .{this});
                        bufio.append(bun.default_allocator, buf) catch bun.outOfMemory();
                        // this.parent.childDone(this, 1);
                        return .cont;
                    },
                    .ignore => {
                        // this.parent.childDone(this, 1);
                        return .cont;
                    },
                }
            }
        };

        pub usingnamespace JSC.Codegen.JSShellInterpreter;

        const ThisInterpreter = @This();

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
        ) callconv(.C) ?*ThisInterpreter {
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
            if (!(bun.shell.shellCmdFromJS(globalThis, string_args, template_args, &jsobjs, &script) catch {
                globalThis.throwOutOfMemory();
                return null;
            })) {
                return null;
            }

            var parser: ?bun.shell.Parser = null;
            var lex_result: ?shell.LexResult = null;
            const script_ast = ThisInterpreter.parse(
                &arena,
                script.items[0..],
                jsobjs.items[0..],
                &parser,
                &lex_result,
            ) catch |err| {
                if (err == shell.ParseError.Lex) {
                    std.debug.assert(lex_result != null);
                    const str = lex_result.?.combineErrors(arena.allocator());
                    globalThis.throwPretty("{s}", .{str});
                    return null;
                }

                if (parser) |*p| {
                    const errstr = p.combineErrors();
                    globalThis.throwPretty("{s}", .{errstr});
                    return null;
                }

                globalThis.throwError(err, "failed to lex/parse shell");
                return null;
            };

            const script_heap = arena.allocator().create(bun.shell.AST.Script) catch {
                globalThis.throwOutOfMemory();
                return null;
            };

            script_heap.* = script_ast;

            const interpreter = switch (ThisInterpreter.init(
                globalThis,
                allocator,
                &arena,
                script_heap,
                jsobjs.items[0..],
            )) {
                .result => |i| i,
                .err => |e| {
                    arena.deinit();
                    GlobalHandle.init(globalThis).actuallyThrow(e);
                    return null;
                },
            };

            return interpreter;
        }

        pub fn parse(arena: *bun.ArenaAllocator, script: []const u8, jsobjs: []JSValue, out_parser: *?bun.shell.Parser, out_lex_result: *?shell.LexResult) !ast.Script {
            const lex_result = brk: {
                if (bun.strings.isAllASCII(script)) {
                    var lexer = bun.shell.LexerAscii.new(arena.allocator(), script);
                    try lexer.lex();
                    break :brk lexer.get_result();
                }
                var lexer = bun.shell.LexerUnicode.new(arena.allocator(), script);
                try lexer.lex();
                break :brk lexer.get_result();
            };

            if (lex_result.errors.len > 0) {
                out_lex_result.* = lex_result;
                return shell.ParseError.Lex;
            }

            out_parser.* = try bun.shell.Parser.new(arena.allocator(), lex_result, jsobjs);

            const script_ast = try out_parser.*.?.parse();
            return script_ast;
        }

        // fn bunStringDealloc(this: *anyopaque, str: *anyopaque, size: u32) callconv(.C) void {}

        /// If all initialization allocations succeed, the arena will be copied
        /// into the interpreter struct, so it is not a stale reference and safe to call `arena.deinit()` on error.
        pub fn init(
            global: GlobalRef,
            allocator: Allocator,
            arena: *bun.ArenaAllocator,
            script: *ast.Script,
            jsobjs: []JSValue,
        ) shell.Result(*ThisInterpreter) {
            var interpreter = allocator.create(ThisInterpreter) catch bun.outOfMemory();
            interpreter.global = global;
            interpreter.allocator = allocator;

            const export_env = brk: {
                var export_env = EnvMap.init(allocator);
                // This will be set by in the shell builtin to `process.env`
                if (EventLoopKind == .js) break :brk export_env;

                var env_loader: *bun.DotEnv.Loader = env_loader: {
                    if (comptime EventLoopKind == .js) {
                        break :env_loader global.bunVM().bundler.env;
                    }

                    break :env_loader global.env.?;
                };

                var iter = env_loader.map.iter();
                while (iter.next()) |entry| {
                    const value = EnvStr.initSlice(entry.value_ptr.value);
                    const key = EnvStr.initSlice(entry.key_ptr.*);
                    export_env.insert(key, value);
                }

                break :brk export_env;
            };

            var pathbuf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const cwd = switch (Syscall.getcwd(&pathbuf)) {
                .result => |cwd| cwd.ptr[0..cwd.len :0],
                .err => |err| {
                    return .{ .err = .{ .sys = err.toSystemError() } };
                },
            };

            // export_env.put("PWD", cwd) catch bun.outOfMemory();
            // export_env.put("OLDPWD", "/") catch bun.outOfMemory();

            const cwd_fd = switch (Syscall.open(cwd, std.os.O.DIRECTORY | std.os.O.RDONLY, 0)) {
                .result => |fd| fd,
                .err => |err| {
                    return .{ .err = .{ .sys = err.toSystemError() } };
                },
            };
            var cwd_arr = std.ArrayList(u8).initCapacity(bun.default_allocator, cwd.len + 1) catch bun.outOfMemory();
            cwd_arr.appendSlice(cwd[0 .. cwd.len + 1]) catch bun.outOfMemory();

            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(cwd_arr.items[cwd_arr.items.len -| 1] == 0);
            }

            interpreter.* = .{
                .global = global,

                .script = script,
                .allocator = allocator,
                .jsobjs = jsobjs,

                .arena = arena.*,

                .root_shell = ShellState{
                    .io = .{},

                    .shell_env = EnvMap.init(allocator),
                    .cmd_local_env = EnvMap.init(allocator),
                    .export_env = export_env,

                    .__cwd = cwd_arr,
                    .__prev_cwd = cwd_arr.clone() catch bun.outOfMemory(),
                    .cwd_fd = cwd_fd,
                },
            };

            if (comptime EventLoopKind == .js) {
                interpreter.root_shell.io.stdout = .{ .std = .{ .captured = &interpreter.root_shell._buffered_stdout.owned } };
                interpreter.root_shell.io.stderr = .{ .std = .{ .captured = &interpreter.root_shell._buffered_stderr.owned } };
            }

            return .{ .result = interpreter };
        }

        pub fn initAndRunFromFile(mini: *JSC.MiniEventLoop, path: []const u8) !void {
            var arena = bun.ArenaAllocator.init(bun.default_allocator);
            const src = src: {
                var file = try std.fs.cwd().openFile(path, .{});
                defer file.close();
                break :src try file.reader().readAllAlloc(arena.allocator(), std.math.maxInt(u32));
            };

            const jsobjs: []JSValue = &[_]JSValue{};
            var out_parser: ?bun.shell.Parser = null;
            var out_lex_result: ?bun.shell.LexResult = null;
            const script = ThisInterpreter.parse(&arena, src, jsobjs, &out_parser, &out_lex_result) catch |err| {
                if (err == bun.shell.ParseError.Lex) {
                    std.debug.assert(out_lex_result != null);
                    const str = out_lex_result.?.combineErrors(arena.allocator());
                    bun.Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{ std.fs.path.basename(path), str });
                    bun.Global.exit(1);
                }

                if (out_parser) |*p| {
                    const errstr = p.combineErrors();
                    bun.Output.prettyErrorln("<r><red>error<r>: Failed to run <b>{s}<r> due to error <b>{s}<r>", .{ std.fs.path.basename(path), errstr });
                    bun.Global.exit(1);
                }

                return err;
            };
            const script_heap = try arena.allocator().create(ast.Script);
            script_heap.* = script;
            var interp = switch (ThisInterpreter.init(mini, bun.default_allocator, &arena, script_heap, jsobjs)) {
                .err => |e| {
                    GlobalHandle.init(mini).actuallyThrow(e);
                    return;
                },
                .result => |i| i,
            };
            const IsDone = struct {
                done: bool = false,

                fn isDone(this: *anyopaque) bool {
                    const asdlfk = bun.cast(*const @This(), this);
                    return asdlfk.done;
                }
            };
            var is_done: IsDone = .{};
            interp.done = &is_done.done;
            try interp.run();
            mini.tick(&is_done, @as(fn (*anyopaque) bool, IsDone.isDone));
        }

        pub fn run(this: *ThisInterpreter) !void {
            var root = Script.init(this, &this.root_shell, this.script, Script.ParentPtr.init(this), this.root_shell.io);
            this.started.store(true, .SeqCst);
            root.start();
        }

        pub fn runFromJS(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
            _ = callframe; // autofix

            _ = globalThis;
            incrPendingActivityFlag(&this.has_pending_activity);
            var root = Script.init(this, &this.root_shell, this.script, Script.ParentPtr.init(this), this.root_shell.io);
            this.started.store(true, .SeqCst);
            root.start();
            return .undefined;
        }

        fn ioToJSValue(this: *ThisInterpreter, buf: *bun.ByteList) JSValue {
            const bytelist = buf.*;
            buf.* = .{};
            const value = JSC.MarkedArrayBuffer.toNodeBuffer(
                .{
                    .allocator = bun.default_allocator,
                    .buffer = JSC.ArrayBuffer.fromBytes(@constCast(bytelist.slice()), .Uint8Array),
                },
                this.global,
            );

            return value;
        }

        fn childDone(this: *ThisInterpreter, child: InterpreterChildPtr, exit_code: ExitCode) void {
            if (child.ptr.is(Script)) {
                const script = child.as(Script);
                script.deinitFromInterpreter();
                this.finish(exit_code);
                return;
            }
            @panic("Bad child");
        }

        fn finish(this: *ThisInterpreter, exit_code: ExitCode) void {
            log("finish", .{});
            if (comptime EventLoopKind == .js) {
                // defer this.deinit();
                // this.promise.resolve(this.global, JSValue.jsNumberFromInt32(@intCast(exit_code)));
                // this.buffered_stdout.
                this.reject.deinit();
                _ = this.resolve.call(&[_]JSValue{if (comptime bun.Environment.isWindows) JSValue.jsNumberFromU16(exit_code) else JSValue.jsNumberFromChar(exit_code)});
            } else {
                this.done.?.* = true;
            }
        }

        fn errored(this: *ThisInterpreter, the_error: ShellError) void {
            _ = the_error; // autofix

            if (comptime EventLoopKind == .js) {
                // defer this.deinit();
                // this.promise.reject(this.global, the_error.toJSC(this.global));
                this.resolve.deinit();
                _ = this.reject.call(&[_]JSValue{JSValue.jsNumberFromChar(1)});
            }
        }

        fn deinit(this: *ThisInterpreter) void {
            log("deinit", .{});
            for (this.jsobjs) |jsobj| {
                jsobj.unprotect();
            }
            this.resolve.deinit();
            this.reject.deinit();
            this.root_shell.deinitImpl(false, true);
            this.allocator.destroy(this);
        }

        pub fn setResolve(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const value = callframe.argument(0);
            if (!value.isCallable(globalThis.vm())) {
                globalThis.throwInvalidArguments("resolve must be a function", .{});
                return .undefined;
            }
            this.resolve.set(globalThis, value.withAsyncContextIfNeeded(globalThis));
            return .undefined;
        }

        pub fn setReject(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const value = callframe.argument(0);
            if (!value.isCallable(globalThis.vm())) {
                globalThis.throwInvalidArguments("reject must be a function", .{});
                return .undefined;
            }
            this.reject.set(globalThis, value.withAsyncContextIfNeeded(globalThis));
            return .undefined;
        }

        pub fn setQuiet(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            _ = globalThis;
            _ = callframe;
            this.root_shell.io.stdout = .pipe;
            this.root_shell.io.stderr = .pipe;
            return .undefined;
        }

        pub fn setCwd(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const value = callframe.argument(0);
            const str = bun.String.fromJS(value, globalThis);

            const slice = str.toUTF8(bun.default_allocator);
            defer slice.deinit();
            switch (this.root_shell.changeCwd(this, slice.slice())) {
                .err => |e| {
                    globalThis.throwValue(e.toJSC(globalThis));
                    return .undefined;
                },
                .result => {},
            }
            return .undefined;
        }

        pub fn setEnv(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const value1 = callframe.argument(0);
            if (!value1.isObject()) {
                globalThis.throwInvalidArguments("env must be an object", .{});
                return .undefined;
            }

            var object_iter = JSC.JSPropertyIterator(.{
                .skip_empty_name = false,
                .include_value = true,
            }).init(globalThis, value1.asObjectRef());
            defer object_iter.deinit();

            this.root_shell.export_env.clearRetainingCapacity();
            this.root_shell.export_env.ensureTotalCapacity(object_iter.len);

            // If the env object does not include a $PATH, it must disable path lookup for argv[0]
            // PATH = "";

            while (object_iter.next()) |key| {
                const keyslice = key.toOwnedSlice(bun.default_allocator) catch bun.outOfMemory();
                var value = object_iter.value;
                if (value == .undefined) continue;

                const value_str = value.getZigString(globalThis);
                const slice = value_str.toOwnedSlice(bun.default_allocator) catch bun.outOfMemory();
                const keyref = EnvStr.initRefCounted(keyslice);
                defer keyref.deref();
                const valueref = EnvStr.initRefCounted(slice);
                defer valueref.deref();

                this.root_shell.export_env.insert(keyref, valueref);
            }

            return .undefined;
        }

        pub fn isRunning(
            this: *ThisInterpreter,
            globalThis: *JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            _ = globalThis; // autofix
            _ = callframe; // autofix

            return JSC.JSValue.jsBoolean(this.hasPendingActivity());
        }

        pub fn getStarted(
            this: *ThisInterpreter,
            globalThis: *JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            _ = globalThis; // autofix
            _ = callframe; // autofix

            return JSC.JSValue.jsBoolean(this.started.load(.SeqCst));
        }

        pub fn getBufferedStdout(
            this: *ThisInterpreter,
            globalThis: *JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            _ = globalThis; // autofix
            _ = callframe; // autofix

            const stdout = this.ioToJSValue(this.root_shell.buffered_stdout());
            return stdout;
        }

        pub fn getBufferedStderr(
            this: *ThisInterpreter,
            globalThis: *JSGlobalObject,
            callframe: *JSC.CallFrame,
        ) callconv(.C) JSC.JSValue {
            _ = globalThis; // autofix
            _ = callframe; // autofix

            const stdout = this.ioToJSValue(this.root_shell.buffered_stderr());
            return stdout;
        }

        pub fn finalize(
            this: *ThisInterpreter,
        ) callconv(.C) void {
            this.deinit();
        }

        pub fn hasPendingActivity(this: *ThisInterpreter) callconv(.C) bool {
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

        const AssignCtx = enum {
            cmd,
            shell,
            exported,
        };

        const ExpansionOpts = struct {
            for_spawn: bool = true,
            single: bool = false,
        };

        /// TODO PERF: in the case of expanding cmd args, we probably want to use the spawn args arena
        /// otherwise the interpreter allocator
        ///
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
                    cmd: *Script,
                    quoted: bool = false,
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
                Assigns,
            });

            const ChildPtr = StatePtrUnion(.{
                // Cmd,
                Script,
            });

            const Result = union(enum) {
                array_of_slice: *std.ArrayList([:0]const u8),
                array_of_ptr: *std.ArrayList(?[*:0]const u8),
                single: struct {
                    list: *std.ArrayList(u8),
                    done: bool = false,
                },

                pub fn pushResultSlice(this: *Result, buf: [:0]const u8) void {
                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(buf[buf.len] == 0);
                    }

                    switch (this.*) {
                        .array_of_slice => {
                            this.array_of_slice.append(buf) catch bun.outOfMemory();
                        },
                        .array_of_ptr => {
                            this.array_of_ptr.append(@as([*:0]const u8, @ptrCast(buf.ptr))) catch bun.outOfMemory();
                        },
                        .single => {
                            if (this.single.done) return;
                            this.single.list.appendSlice(buf[0 .. buf.len + 1]) catch bun.outOfMemory();
                            this.single.done = true;
                        },
                    }
                }

                pub fn pushResult(this: *Result, buf: *std.ArrayList(u8)) void {
                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(buf.items[buf.items.len - 1] == 0);
                    }

                    switch (this.*) {
                        .array_of_slice => {
                            this.array_of_slice.append(buf.items[0 .. buf.items.len - 1 :0]) catch bun.outOfMemory();
                        },
                        .array_of_ptr => {
                            this.array_of_ptr.append(@as([*:0]const u8, @ptrCast(buf.items.ptr))) catch bun.outOfMemory();
                        },
                        .single => {
                            if (this.single.done) return;
                            this.single.list.appendSlice(buf.items[0..]) catch bun.outOfMemory();
                        },
                    }
                }
            };

            pub fn init(
                interpreter: *ThisInterpreter,
                shell_state: *ShellState,
                expansion: *Expansion,
                node: *const ast.Atom,
                parent: ParentPtr,
                out_result: Result,
            ) void {
                expansion.* = .{
                    .node = node,
                    .base = .{
                        .kind = .expansion,
                        .interpreter = interpreter,
                        .shell = shell_state,
                    },
                    .parent = parent,

                    .word_idx = 0,
                    .state = .normal,
                    .child_state = .idle,
                    .out = out_result,
                    .out_idx = 0,
                    .current_out = std.ArrayList(u8).init(interpreter.allocator),
                };
                // var expansion = interpreter.allocator.create(Expansion) catch bun.outOfMemory();
            }

            pub fn deinit(expansion: *Expansion) void {
                expansion.current_out.deinit();
            }

            pub fn start(this: *Expansion) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.child_state == .idle);
                    std.debug.assert(this.word_idx == 0);
                }

                this.state = .normal;
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

                                this.pushCurrentOut();
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
            }

            fn transitionToGlobState(this: *Expansion) void {
                var arena = Arena.init(this.base.interpreter.allocator);
                this.child_state = .{ .glob = .{ .walker = .{} } };
                const pattern = this.current_out.items[0..];

                switch (GlobWalker.init(&this.child_state.glob.walker, &arena, pattern, false, false, false, false, false) catch bun.outOfMemory()) {
                    .result => {},
                    .err => |e| {
                        global_handle.get().actuallyThrow(bun.shell.ShellErr.newSys(e));
                        return;
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
                            io.stderr = this.base.shell.io.stderr;
                            const shell_state = switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, io, .cmd_subst)) {
                                .result => |s| s,
                                .err => |e| {
                                    global_handle.get().actuallyThrow(bun.shell.ShellErr.newSys(e));
                                    return false;
                                },
                            };
                            var script = Script.init(this.base.interpreter, shell_state, &this.node.simple.cmd_subst.script, Script.ParentPtr.init(this), io);
                            this.child_state = .{
                                .cmd_subst = .{
                                    .cmd = script,
                                    .quoted = simp.cmd_subst.quoted,
                                },
                            };
                            script.start();
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
                                io.stderr = this.base.shell.io.stderr;
                                const shell_state = switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, io, .cmd_subst)) {
                                    .result => |s| s,
                                    .err => |e| {
                                        global_handle.get().actuallyThrow(bun.shell.ShellErr.newSys(e));
                                        return false;
                                    },
                                };
                                var script = Script.init(this.base.interpreter, shell_state, &simple_atom.cmd_subst.script, Script.ParentPtr.init(this), io);
                                this.child_state = .{
                                    .cmd_subst = .{
                                        .cmd = script,
                                        .quoted = simple_atom.cmd_subst.quoted,
                                    },
                                };
                                script.start();
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

            /// Remove a set of values from the beginning and end of a slice.
            pub fn trim(slice: []u8, values_to_strip: []const u8) []u8 {
                var begin: usize = 0;
                var end: usize = slice.len;
                while (begin < end and std.mem.indexOfScalar(u8, values_to_strip, slice[begin]) != null) : (begin += 1) {}
                while (end > begin and std.mem.indexOfScalar(u8, values_to_strip, slice[end - 1]) != null) : (end -= 1) {}
                return slice[begin..end];
            }

            /// 1. Turn all newlines into spaces
            /// 2. Strip last newline if it exists
            /// 3. Trim leading, trailing, and consecutive whitespace
            fn postSubshellExpansion(this: *Expansion, stdout_: []u8) void {
                // 1. and 2.
                var stdout = convertNewlinesToSpaces(stdout_);

                // Trim leading & trailing whitespace
                stdout = trim(stdout, " \n  \r\t");
                if (stdout.len == 0) return;

                // Trim consecutive
                var prev_whitespace: bool = false;
                var a: usize = 0;
                var b: usize = 1;
                for (stdout[0..], 0..) |c, i| {
                    if (prev_whitespace) {
                        if (c != ' ') {
                            // this.
                            a = i;
                            b = i + 1;
                            prev_whitespace = false;
                        }
                        continue;
                    }

                    b = i + 1;
                    if (c == ' ') {
                        b = i;
                        prev_whitespace = true;
                        this.current_out.appendSlice(stdout[a..b]) catch bun.outOfMemory();
                        this.pushCurrentOut();
                        // const slice_z = this.base.interpreter.allocator.dupeZ(u8, stdout[a..b]) catch bun.outOfMemory();
                        // this.pushResultSlice(slice_z);
                    }
                }
                // "aa bbb"

                this.current_out.appendSlice(stdout[a..b]) catch bun.outOfMemory();
                this.pushCurrentOut();
                // const slice_z = this.base.interpreter.allocator.dupeZ(u8, stdout[a..b]) catch bun.outOfMemory();
                // this.pushResultSlice(slice_z);
            }

            fn convertNewlinesToSpaces(stdout_: []u8) []u8 {
                var stdout = brk: {
                    if (stdout_.len == 0) return stdout_;
                    if (stdout_[stdout_.len -| 1] == '\n') break :brk stdout_[0..stdout_.len -| 1];
                    break :brk stdout_[0..];
                };

                if (stdout.len == 0) {
                    // out.append('\n') catch bun.outOfMemory();
                    return stdout;
                }

                // From benchmarks the SIMD stuff only is faster when chars >= 64
                if (stdout.len < 64) {
                    convertNewlinesToSpacesSlow(0, stdout);
                    // out.appendSlice(stdout[0..]) catch bun.outOfMemory();
                    return stdout[0..];
                }

                const needles: @Vector(16, u8) = @splat('\n');
                const spaces: @Vector(16, u8) = @splat(' ');
                var i: usize = 0;
                while (i + 16 <= stdout.len) : (i += 16) {
                    const haystack: @Vector(16, u8) = stdout[i..][0..16].*;
                    stdout[i..][0..16].* = @select(u8, haystack == needles, spaces, haystack);
                }

                if (i < stdout.len) convertNewlinesToSpacesSlow(i, stdout);
                // out.appendSlice(stdout[0..]) catch bun.outOfMemory();
                return stdout[0..];
            }

            fn convertNewlinesToSpacesSlow(i: usize, stdout: []u8) void {
                for (stdout[i..], i..) |c, j| {
                    if (c == '\n') {
                        stdout[j] = ' ';
                    }
                }
            }

            fn childDone(this: *Expansion, child: ChildPtr, exit_code: ExitCode) void {
                _ = exit_code;
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state != .done and this.state != .err);
                    std.debug.assert(this.child_state != .idle);
                }

                // Command substitution
                if (child.ptr.is(Script)) {
                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(this.child_state == .cmd_subst);
                    }

                    const stdout = this.child_state.cmd_subst.cmd.base.shell.buffered_stdout().slice();
                    if (!this.child_state.cmd_subst.quoted) {
                        this.postSubshellExpansion(stdout);
                    } else {
                        const trimmed = std.mem.trimRight(u8, stdout, " \n\t\r");
                        this.current_out.appendSlice(trimmed) catch bun.outOfMemory();
                    }

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
                    switch (task.err.?) {
                        .syscall => global_handle.get().actuallyThrow(bun.shell.ShellErr.newSys(task.err.?.syscall)),
                        .unknown => |errtag| {
                            global_handle.get().actuallyThrow(.{
                                .custom = bun.default_allocator.dupe(u8, @errorName(errtag)) catch bun.outOfMemory(),
                            });
                        },
                    }
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

            /// If the atom is actually a command substitution then does nothing and returns true
            pub fn expandSimpleNoIO(this: *Expansion, atom: *const ast.SimpleAtom, str_list: *std.ArrayList(u8)) bool {
                switch (atom.*) {
                    .Text => |txt| {
                        str_list.appendSlice(txt) catch bun.outOfMemory();
                    },
                    .Var => |label| {
                        str_list.appendSlice(this.expandVar(label).slice()) catch bun.outOfMemory();
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
                        // TODO:
                        // if the command substution is comprised of solely shell variable assignments then it should do nothing
                        // if (atom.cmd_subst.* == .assigns) return false;
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

            pub fn pushCurrentOut(this: *Expansion) void {
                if (this.current_out.items.len == 0) return;
                if (this.current_out.items[this.current_out.items.len - 1] != 0) this.current_out.append(0) catch bun.outOfMemory();
                this.pushResult(&this.current_out);
                this.current_out = std.ArrayList(u8).init(this.base.interpreter.allocator);
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

            fn expandVar(this: *const Expansion, label: []const u8) EnvStr {
                const value = this.base.shell.shell_env.get(EnvStr.initSlice(label)) orelse brk: {
                    break :brk this.base.shell.export_env.get(EnvStr.initSlice(label)) orelse return EnvStr.initSlice("");
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
                        _ = subst; // autofix

                        // TODO check if the command substitution is comprised entirely of assignments or zero-sized things
                        // if (@as(ast.CmdOrAssigns.Tag, subst.*) == .assigns) {
                        //     return 0;
                        // }
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
                    .single => {},
                }
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
                event_loop: EventLoopRef,
                concurrent_task: EventLoopTask = .{},
                // This is a poll because we want it to enter the uSockets loop
                ref: bun.Async.KeepAlive = .{},
                err: ?Err = null,

                const This = @This();

                pub const event_loop_kind = EventLoopKind;

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
                    this.ref.ref(event_loop_ref.get().getVmImpl());

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
                    this.ref.unref(this.event_loop.getVmImpl());
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
                    if (comptime EventLoopKind == .js) {
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
        };

        pub const State = struct {
            kind: StateKind,
            interpreter: *ThisInterpreter,
            shell: *ShellState,
        };

        pub const Script = struct {
            base: State,
            node: *const ast.Script,
            // currently_executing: ?ChildPtr,
            io: ?IO = null,
            parent: ParentPtr,
            state: union(enum) {
                normal: struct {
                    idx: usize = 0,
                },
            } = .{ .normal = .{} },

            pub const ParentPtr = StatePtrUnion(.{
                ThisInterpreter,
                Expansion,
            });

            pub const ChildPtr = struct {
                val: *Stmt,
                pub inline fn init(child: *Stmt) ChildPtr {
                    return .{ .val = child };
                }
                pub inline fn deinit(this: ChildPtr) void {
                    this.val.deinit();
                }
            };

            fn init(
                interpreter: *ThisInterpreter,
                shell_state: *ShellState,
                node: *const ast.Script,
                parent_ptr: ParentPtr,
                io: ?IO,
            ) *Script {
                const script = interpreter.allocator.create(Script) catch bun.outOfMemory();
                script.* = .{
                    .base = .{ .kind = .script, .interpreter = interpreter, .shell = shell_state },
                    .node = node,
                    .parent = parent_ptr,
                    .io = io,
                };
                return script;
            }

            fn getIO(this: *Script) IO {
                if (this.io) |io| return io;
                return this.base.shell.io;
            }

            fn start(this: *Script) void {
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
                        var stmt = Stmt.init(this.base.interpreter, this.base.shell, stmt_node, this, this.getIO()) catch bun.outOfMemory();
                        stmt.start();
                        return;
                    },
                }
            }

            fn finish(this: *Script, exit_code: ExitCode) void {
                if (this.parent.ptr.is(ThisInterpreter)) {
                    log("SCRIPT DONE YO!", .{});
                    // this.base.interpreter.finish(exit_code);
                    this.base.interpreter.childDone(InterpreterChildPtr.init(this), exit_code);
                    return;
                }

                if (this.parent.ptr.is(Expansion)) {
                    this.parent.childDone(this, exit_code);
                    return;
                }
            }

            fn childDone(this: *Script, child: ChildPtr, exit_code: ExitCode) void {
                child.deinit();
                if (this.state.normal.idx >= this.node.stmts.len) {
                    this.finish(exit_code);
                    return;
                }
                this.next();
            }

            pub fn deinit(this: *Script) void {
                if (this.parent.ptr.is(ThisInterpreter)) {
                    return;
                }

                this.base.shell.deinit();
            }

            pub fn deinitFromInterpreter(this: *Script) void {
                this.base.shell.deinitImpl(false, false);
            }
        };

        /// In pipelines and conditional expressions, assigns (e.g. `FOO=bar BAR=baz &&
        /// echo hi` or `FOO=bar BAR=baz | echo hi`) have no effect on the environment
        /// of the shell, so we can skip them.
        const Assigns = struct {
            base: State,
            node: []const ast.Assign,
            parent: ParentPtr,
            state: union(enum) {
                idle,
                expanding: struct {
                    idx: u32 = 0,
                    current_expansion_result: std.ArrayList([:0]const u8),
                    expansion: Expansion,
                },
                done,
            },
            ctx: AssignCtx,

            const ParentPtr = StatePtrUnion(.{
                Stmt,
                Cond,
                Cmd,
                Pipeline,
            });

            const ChildPtr = StatePtrUnion(.{
                Expansion,
            });

            pub inline fn deinit(this: *Assigns) void {
                if (this.state == .expanding) {
                    this.state.expanding.current_expansion_result.deinit();
                }
            }

            pub inline fn start(this: *Assigns) void {
                return this.next();
            }

            pub fn init(
                this: *Assigns,
                interpreter: *ThisInterpreter,
                shell_state: *ShellState,
                node: []const ast.Assign,
                ctx: AssignCtx,
                parent: ParentPtr,
            ) void {
                this.* = .{
                    .base = .{ .kind = .assign, .interpreter = interpreter, .shell = shell_state },
                    .node = node,
                    .parent = parent,
                    .state = .idle,
                    .ctx = ctx,
                };
            }

            pub fn next(this: *Assigns) void {
                while (!(this.state == .done)) {
                    switch (this.state) {
                        .idle => {
                            this.state = .{ .expanding = .{
                                .current_expansion_result = std.ArrayList([:0]const u8).init(bun.default_allocator),
                                .expansion = undefined,
                            } };
                            continue;
                        },
                        .expanding => {
                            if (this.state.expanding.idx >= this.node.len) {
                                this.state = .done;
                                continue;
                            }

                            Expansion.init(
                                this.base.interpreter,
                                this.base.shell,
                                &this.state.expanding.expansion,
                                &this.node[this.state.expanding.idx].value,
                                Expansion.ParentPtr.init(this),
                                .{
                                    .array_of_slice = &this.state.expanding.current_expansion_result,
                                },
                            );
                            this.state.expanding.expansion.start();
                            return;
                        },
                        .done => unreachable,
                    }
                }

                this.parent.childDone(this, 0);
            }

            pub fn childDone(this: *Assigns, child: ChildPtr, exit_code: ExitCode) void {
                _ = exit_code;

                if (child.ptr.is(Expansion)) {
                    var expanding = &this.state.expanding;

                    const label = this.node[expanding.idx].label;

                    if (expanding.current_expansion_result.items.len == 1) {
                        const value = expanding.current_expansion_result.items[0];
                        const ref = EnvStr.initRefCounted(value);
                        defer ref.deref();
                        this.base.shell.assignVar(this.base.interpreter, EnvStr.initSlice(label), ref, this.ctx);
                        expanding.current_expansion_result = std.ArrayList([:0]const u8).init(bun.default_allocator);
                    } else {
                        const size = brk: {
                            var total: usize = 0;
                            for (expanding.current_expansion_result.items) |slice| {
                                total += slice.len;
                            }
                            break :brk total;
                        };

                        const value = brk: {
                            var merged = bun.default_allocator.allocSentinel(u8, size, 0) catch bun.outOfMemory();
                            var i: usize = 0;
                            for (expanding.current_expansion_result.items) |slice| {
                                @memcpy(merged[i .. i + slice.len], slice[0..slice.len]);
                                i += slice.len;
                            }
                            break :brk merged;
                        };
                        const value_ref = EnvStr.initRefCounted(value);
                        defer value_ref.deref();

                        this.base.shell.assignVar(this.base.interpreter, EnvStr.initSlice(label), value_ref, this.ctx);
                        for (expanding.current_expansion_result.items) |slice| {
                            bun.default_allocator.free(slice);
                        }
                        expanding.current_expansion_result.clearRetainingCapacity();
                    }

                    expanding.idx += 1;
                    this.next();
                    return;
                }

                unreachable;
            }
        };

        pub const Stmt = struct {
            base: State,
            node: *const ast.Stmt,
            parent: *Script,
            idx: usize,
            last_exit_code: ?ExitCode,
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
                Assigns,
            });

            pub fn init(
                interpreter: *ThisInterpreter,
                shell_state: *ShellState,
                node: *const ast.Stmt,
                parent: *Script,
                io: IO,
            ) !*Stmt {
                var script = try interpreter.allocator.create(Stmt);
                script.base = .{ .kind = .stmt, .interpreter = interpreter, .shell = shell_state };
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

            pub fn start(this: *Stmt) void {
                if (bun.Environment.allow_assert) {
                    std.debug.assert(this.idx == 0);
                    std.debug.assert(this.last_exit_code == null);
                    std.debug.assert(this.currently_executing == null);
                }
                this.next();
            }

            pub fn next(this: *Stmt) void {
                if (this.idx >= this.node.exprs.len)
                    return this.parent.childDone(Script.ChildPtr.init(this), this.last_exit_code orelse 0);

                const child = &this.node.exprs[this.idx];
                switch (child.*) {
                    .cond => {
                        const cond = Cond.init(this.base.interpreter, this.base.shell, child.cond, Cond.ParentPtr.init(this), this.io);
                        this.currently_executing = ChildPtr.init(cond);
                        cond.start();
                    },
                    .cmd => {
                        const cmd = Cmd.init(this.base.interpreter, this.base.shell, child.cmd, Cmd.ParentPtr.init(this), this.io);
                        this.currently_executing = ChildPtr.init(cmd);
                        cmd.start();
                    },
                    .pipeline => {
                        const pipeline = Pipeline.init(this.base.interpreter, this.base.shell, child.pipeline, Pipeline.ParentPtr.init(this), this.io);
                        this.currently_executing = ChildPtr.init(pipeline);
                        pipeline.start();
                    },
                    .assign => |assigns| {
                        var assign_machine = this.base.interpreter.allocator.create(Assigns) catch bun.outOfMemory();
                        assign_machine.init(this.base.interpreter, this.base.shell, assigns, .shell, Assigns.ParentPtr.init(this));
                        assign_machine.start();
                    },
                    .subshell => {
                        @panic(SUBSHELL_TODO_ERROR);
                    },
                }
            }

            pub fn childDone(this: *Stmt, child: ChildPtr, exit_code: ExitCode) void {
                const data = child.ptr.repr.data;
                log("child done Stmt {x} child({s})={x} exit={d}", .{ @intFromPtr(this), child.tagName(), @as(usize, @intCast(child.ptr.repr._ptr)), exit_code });
                this.last_exit_code = exit_code;
                this.idx += 1;
                const data2 = child.ptr.repr.data;
                log("{d} {d}", .{ data, data2 });
                child.deinit();
                this.currently_executing = null;
                this.next();
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
            left: ?ExitCode = null,
            right: ?ExitCode = null,
            io: IO,
            currently_executing: ?ChildPtr = null,

            const ChildPtr = StatePtrUnion(.{
                Cmd,
                Pipeline,
                Cond,
                Assigns,
            });

            const ParentPtr = StatePtrUnion(.{
                Stmt,
                Cond,
            });

            pub fn init(
                interpreter: *ThisInterpreter,
                shell_state: *ShellState,
                node: *const ast.Conditional,
                parent: ParentPtr,
                io: IO,
            ) *Cond {
                var cond = interpreter.allocator.create(Cond) catch |err| {
                    std.debug.print("Ruh roh: {any}\n", .{err});
                    @panic("Ruh roh");
                };
                cond.node = node;
                cond.base = .{ .kind = .cond, .interpreter = interpreter, .shell = shell_state };
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
                if (this.currently_executing) |exec| {
                    exec.start();
                }
                // var child = this.currently_executing.?.as(Cmd);
                // child.start();
            }

            /// Returns null if child is assignments
            fn makeChild(this: *Cond, left: bool) ?ChildPtr {
                const node = if (left) &this.node.left else &this.node.right;
                switch (node.*) {
                    .cmd => {
                        const cmd = Cmd.init(this.base.interpreter, this.base.shell, node.cmd, Cmd.ParentPtr.init(this), this.io);
                        return ChildPtr.init(cmd);
                    },
                    .cond => {
                        const cond = Cond.init(this.base.interpreter, this.base.shell, node.cond, Cond.ParentPtr.init(this), this.io);
                        return ChildPtr.init(cond);
                    },
                    .pipeline => {
                        const pipeline = Pipeline.init(this.base.interpreter, this.base.shell, node.pipeline, Pipeline.ParentPtr.init(this), this.io);
                        return ChildPtr.init(pipeline);
                    },
                    .assign => |assigns| {
                        var assign_machine = this.base.interpreter.allocator.create(Assigns) catch bun.outOfMemory();
                        assign_machine.init(this.base.interpreter, this.base.shell, assigns, .shell, Assigns.ParentPtr.init(this));
                        return ChildPtr.init(assign_machine);
                    },
                    .subshell => @panic(SUBSHELL_TODO_ERROR),
                }
            }

            pub fn childDone(this: *Cond, child: ChildPtr, exit_code: ExitCode) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.left == null or this.right == null);
                    std.debug.assert(this.currently_executing != null);
                }
                log("conditional child done {x} ({s}) {s}", .{ @intFromPtr(this), @tagName(this.node.op), if (this.left == null) "left" else "right" });

                child.deinit();
                this.currently_executing = null;

                if (this.left == null) {
                    this.left = exit_code;
                    if ((this.node.op == .And and exit_code != 0) or (this.node.op == .Or and exit_code == 0)) {
                        this.parent.childDone(this, exit_code);
                        return;
                    }

                    this.currently_executing = this.makeChild(false);
                    if (this.currently_executing == null) {
                        this.right = 0;
                        this.parent.childDone(this, 0);
                        return;
                    } else {
                        this.currently_executing.?.start();
                        // this.currently_executing.?.as(Cmd).start();
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
            io: ?IO,
            state: union(enum) {
                idle,
                executing,
                waiting_write_err: BufferedWriter,
                done,
            } = .idle,

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
                Assigns,
            });

            const CmdOrResult = union(enum) {
                cmd: *Cmd,
                result: ExitCode,
            };

            pub fn init(
                interpreter: *ThisInterpreter,
                shell_state: *ShellState,
                node: *const ast.Pipeline,
                parent: ParentPtr,
                io: ?IO,
            ) *Pipeline {
                const pipeline = interpreter.allocator.create(Pipeline) catch bun.outOfMemory();
                pipeline.* = .{
                    .base = .{ .kind = .pipeline, .interpreter = interpreter, .shell = shell_state },
                    .node = node,
                    .parent = parent,
                    .exited_count = 0,
                    .cmds = null,
                    .pipes = null,
                    .io = io,
                };

                return pipeline;
            }

            fn getIO(this: *Pipeline) IO {
                return this.io orelse this.base.shell.io;
            }

            fn setupCommands(this: *Pipeline) CoroutineResult {
                const cmd_count = brk: {
                    var i: u32 = 0;
                    for (this.node.items) |*item| {
                        if (item.* == .cmd) i += 1;
                    }
                    break :brk i;
                };

                this.cmds = if (cmd_count >= 1) this.base.interpreter.allocator.alloc(CmdOrResult, this.node.items.len) catch bun.outOfMemory() else null;
                if (this.cmds == null) return .cont;
                var pipes = this.base.interpreter.allocator.alloc(Pipe, if (cmd_count > 1) cmd_count - 1 else 1) catch bun.outOfMemory();

                if (cmd_count > 1) {
                    var pipes_set: u32 = 0;
                    if (Pipeline.initializePipes(pipes, &pipes_set).asErr()) |err| {
                        for (pipes[0..pipes_set]) |*pipe| {
                            closefd(pipe[0]);
                            closefd(pipe[1]);
                        }
                        const system_err = err.toSystemError();
                        this.writeFailingError("bun: {s}\n", .{system_err.message}, 1);
                        return .yield;
                    }
                }

                var i: u32 = 0;
                for (this.node.items) |*item| {
                    switch (item.*) {
                        .cmd => {
                            const kind = "subproc";
                            _ = kind;
                            var cmd_io = this.getIO();
                            const stdin = if (cmd_count > 1) Pipeline.readPipe(pipes, i, &cmd_io) else cmd_io.stdin;
                            const stdout = if (cmd_count > 1) Pipeline.writePipe(pipes, i, cmd_count, &cmd_io) else cmd_io.stdout;
                            cmd_io.stdin = stdin;
                            cmd_io.stdout = stdout;
                            const subshell_state = switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, cmd_io, .pipeline)) {
                                .result => |s| s,
                                .err => |err| {
                                    const system_err = err.toSystemError();
                                    this.writeFailingError("bun: {s}\n", .{system_err.message}, 1);
                                    return .yield;
                                },
                            };
                            this.cmds.?[i] = .{ .cmd = Cmd.init(this.base.interpreter, subshell_state, item.cmd, Cmd.ParentPtr.init(this), cmd_io) };
                            i += 1;
                        },
                        // in a pipeline assignments have no effect
                        .assigns => {},
                        .subshell => @panic(SUBSHELL_TODO_ERROR),
                    }
                }

                this.pipes = pipes;

                return .cont;
            }

            pub fn writeFailingError(this: *Pipeline, comptime fmt: []const u8, args: anytype, exit_code: ExitCode) void {
                _ = exit_code; // autofix

                const HandleIOWrite = struct {
                    fn run(pipeline: *Pipeline, bufw: BufferedWriter) void {
                        pipeline.state = .{ .waiting_write_err = bufw };
                        pipeline.state.waiting_write_err.writeIfPossible(false);
                    }
                };

                const buf = std.fmt.allocPrint(this.base.interpreter.arena.allocator(), fmt, args) catch bun.outOfMemory();
                _ = this.base.shell.writeFailingError(buf, this, HandleIOWrite.run);
            }

            pub fn start(this: *Pipeline) void {
                if (this.setupCommands() == .yield) return;

                if (this.state == .waiting_write_err or this.state == .done) return;
                const cmds = this.cmds orelse {
                    this.state = .done;
                    this.parent.childDone(this, 0);
                    return;
                };

                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.exited_count == 0);
                }
                log("pipeline start {x} (count={d})", .{ @intFromPtr(this), this.node.items.len });
                if (this.node.items.len == 0) {
                    this.state = .done;
                    this.parent.childDone(this, 0);
                    return;
                }

                for (cmds, 0..) |*cmd_or_result, i| {
                    var stdin: IO.Kind = if (i == 0) this.getIO().stdin else .{ .fd = this.pipes.?[i - 1][0] };
                    var stdout: IO.Kind = if (i == cmds.len - 1) this.getIO().stdout else .{ .fd = this.pipes.?[i][1] };

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

            pub fn onBufferedWriterDone(this: *Pipeline, err: ?Syscall.Error) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .waiting_write_err);
                }

                if (err) |e| {
                    global_handle.get().actuallyThrow(shell.ShellErr.newSys(e));
                    return;
                }

                this.state = .done;
                this.parent.childDone(this, 0);
            }

            pub fn childDone(this: *Pipeline, child: ChildPtr, exit_code: ExitCode) void {
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
                if (child.ptr.is(Cmd)) {
                    const cmd = child.as(Cmd);
                    cmd.base.shell.deinit();
                }

                child.deinit();
                this.cmds.?[idx] = .{ .result = exit_code };
                this.exited_count += 1;

                if (this.exited_count >= this.cmds.?.len) {
                    var last_exit_code: ExitCode = 0;
                    for (this.cmds.?) |cmd_or_result| {
                        if (cmd_or_result == .result) {
                            last_exit_code = cmd_or_result.result;
                            break;
                        }
                    }
                    this.state = .done;
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

            fn initializePipes(pipes: []Pipe, set_count: *u32) Maybe(void) {
                for (pipes) |*pipe| {
                    pipe.* = switch (Syscall.pipe()) {
                        .err => |e| return .{ .err = e },
                        .result => |p| p,
                    };
                    set_count.* += 1;
                }
                return Maybe(void).success;
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

            /// Arena used for memory needed to spawn command.
            /// For subprocesses:
            ///   - allocates argv, env array, etc.
            ///   - Freed after calling posix spawn since its not needed anymore
            /// For Builtins:
            ///   - allocates argv, sometimes used by the builtin for small allocations.
            ///   - Freed when builtin is done (since it contains argv which might be used at any point)
            spawn_arena: bun.ArenaAllocator,
            spawn_arena_freed: bool = false,

            /// This allocated by the above arena
            args: std.ArrayList(?[*:0]const u8),

            /// If the cmd redirects to a file we have to expand that string.
            /// Allocated in `spawn_arena`
            redirection_file: std.ArrayList(u8),
            redirection_fd: bun.FileDescriptor = bun.invalid_fd,

            exec: Exec = .none,
            exit_code: ?ExitCode = null,
            io: IO,
            freed: bool = false,

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
                waiting_write_err: BufferedWriter,
                err: ?Syscall.Error,
            },

            const Subprocess = bun.shell.subproc.NewShellSubprocess(EventLoopKind, @This());

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

                fn close(this: *BufferedIoClosed, cmd: *Cmd, io: union(enum) { stdout: *Subprocess.Readable, stderr: *Subprocess.Readable, stdin }) void {
                    switch (io) {
                        .stdout => {
                            if (this.stdout) |*stdout| {
                                const readable = io.stdout;

                                // If the shell state is piped (inside a cmd substitution) aggregate the output of this command
                                if (cmd.base.shell.io.stdout == .pipe and cmd.io.stdout == .pipe and !cmd.node.redirect.stdout) {
                                    cmd.base.shell.buffered_stdout().append(bun.default_allocator, readable.pipe.buffer.internal_buffer.slice()) catch bun.outOfMemory();
                                }

                                stdout.state = .{ .closed = readable.pipe.buffer.internal_buffer };
                                io.stdout.pipe.buffer.internal_buffer = .{};
                            }
                        },
                        .stderr => {
                            if (this.stderr) |*stderr| {
                                const readable = io.stderr;

                                // If the shell state is piped (inside a cmd substitution) aggregate the output of this command
                                if (cmd.base.shell.io.stderr == .pipe and cmd.io.stderr == .pipe and !cmd.node.redirect.stdout) {
                                    cmd.base.shell.buffered_stderr().append(bun.default_allocator, readable.pipe.buffer.internal_buffer.slice()) catch bun.outOfMemory();
                                }

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

                fn fromStdio(io: *const [3]bun.shell.subproc.Stdio) BufferedIoClosed {
                    return .{
                        .stdin = if (io[stdin_no].isPiped()) false else null,
                        .stdout = if (io[stdout_no].isPiped()) .{ .owned = io[stdout_no] == .pipe } else null,
                        .stderr = if (io[stderr_no].isPiped()) .{ .owned = io[stderr_no] == .pipe } else null,
                    };
                }
            };

            const ParentPtr = StatePtrUnion(.{
                Stmt,
                Cond,
                Pipeline,
                // Expansion,
                // TODO
                // .subst = void,
            });

            const ChildPtr = StatePtrUnion(.{
                Assigns,
                Expansion,
            });

            pub fn isSubproc(this: *Cmd) bool {
                return this.exec == .subproc;
            }

            /// If starting a command results in an error (failed to find executable in path for example)
            /// then it should write to the stderr of the entire shell script process
            pub fn writeFailingError(this: *Cmd, buf: []const u8, exit_code: ExitCode) void {
                _ = exit_code; // autofix

                const HandleIOWrite = struct {
                    fn run(cmd: *Cmd, bufw: BufferedWriter) void {
                        cmd.state = .{ .waiting_write_err = bufw };
                        cmd.state.waiting_write_err.writeIfPossible(false);
                    }
                };
                _ = this.base.shell.writeFailingError(buf, this, HandleIOWrite.run);

                // switch (this.base.shell.io.stderr) {
                //     .std => |val| {
                //         this.state = .{ .waiting_write_err = BufferedWriter{
                //             .fd = stderr_no,
                //             .remain = buf,
                //             .parent = BufferedWriter.ParentPtr.init(this),
                //             .bytelist = val.captured,
                //         } };
                //         this.state.waiting_write_err.writeIfPossible(false);
                //     },
                //     .fd => {
                //         this.state = .{ .waiting_write_err = BufferedWriter{
                //             .fd = stderr_no,
                //             .remain = buf,
                //             .parent = BufferedWriter.ParentPtr.init(this),
                //         } };
                //         this.state.waiting_write_err.writeIfPossible(false);
                //     },
                //     .pipe, .ignore => {
                //         this.parent.childDone(this, 1);
                //     },
                // }
                return;
            }

            pub fn init(
                interpreter: *ThisInterpreter,
                shell_state: *ShellState,
                node: *const ast.Cmd,
                parent: ParentPtr,
                io: IO,
            ) *Cmd {
                var cmd = interpreter.allocator.create(Cmd) catch |err| {
                    std.debug.print("Ruh roh: {any}\n", .{err});
                    @panic("Ruh roh");
                };
                cmd.* = .{
                    .base = .{ .kind = .cmd, .interpreter = interpreter, .shell = shell_state },
                    .node = node,
                    .parent = parent,

                    .spawn_arena = bun.ArenaAllocator.init(interpreter.allocator),
                    .args = std.ArrayList(?[*:0]const u8).initCapacity(cmd.spawn_arena.allocator(), node.name_and_args.len) catch bun.outOfMemory(),
                    .redirection_file = undefined,

                    .exit_code = null,
                    .io = io,
                    .state = .idle,
                };

                cmd.redirection_file = std.ArrayList(u8).init(cmd.spawn_arena.allocator());

                return cmd;
            }

            pub fn next(this: *Cmd) void {
                while (!(this.state == .done or this.state == .err)) {
                    switch (this.state) {
                        .idle => {
                            this.state = .{ .expanding_assigns = undefined };
                            Assigns.init(&this.state.expanding_assigns, this.base.interpreter, this.base.shell, this.node.assigns, .cmd, Assigns.ParentPtr.init(this));
                            this.state.expanding_assigns.start();
                            return; // yield execution
                        },
                        .expanding_assigns => {
                            return; // yield execution
                        },
                        .expanding_redirect => {
                            if (this.state.expanding_redirect.idx >= 1) {
                                this.state = .{
                                    .expanding_args = undefined,
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
                                        .expansion = undefined,
                                    },
                                };
                                continue;
                            };

                            this.redirection_file = std.ArrayList(u8).init(this.spawn_arena.allocator());

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
                            );

                            this.state.expanding_redirect.expansion.start();
                            return;
                        },
                        .expanding_args => {
                            if (this.state.expanding_args.idx >= this.node.name_and_args.len) {
                                this.transitionToExecStateAndYield();
                                // yield execution to subproc
                                return;
                            }

                            this.args.ensureUnusedCapacity(1) catch bun.outOfMemory();
                            Expansion.init(
                                this.base.interpreter,
                                this.base.shell,
                                &this.state.expanding_args.expansion,
                                &this.node.name_and_args[this.state.expanding_args.idx],
                                Expansion.ParentPtr.init(this),
                                .{
                                    .array_of_ptr = &this.args,
                                },
                            );

                            this.state.expanding_args.idx += 1;

                            this.state.expanding_args.expansion.start();
                            // yield execution to expansion
                            return;
                        },
                        .waiting_write_err => {
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

                this.parent.childDone(this, 1);
                return;
            }

            fn transitionToExecStateAndYield(this: *Cmd) void {
                this.state = .exec;
                this.initSubproc();
            }

            pub fn start(this: *Cmd) void {
                log("cmd start {x}", .{@intFromPtr(this)});
                return this.next();
            }

            pub fn onBufferedWriterDone(this: *Cmd, e: ?Syscall.Error) void {
                if (e) |err| {
                    global_handle.get().actuallyThrow(bun.shell.ShellErr.newSys(err));
                    return;
                }
                std.debug.assert(this.state == .waiting_write_err);
                this.state = .{ .err = e };
                this.next();
                return;
            }

            pub fn childDone(this: *Cmd, child: ChildPtr, exit_code: ExitCode) void {
                _ = exit_code; // autofix

                if (child.ptr.is(Assigns)) {
                    this.state.expanding_assigns.deinit();
                    this.state = .{
                        .expanding_redirect = .{
                            .expansion = undefined,
                        },
                    };
                    this.next();
                    return;
                }

                if (child.ptr.is(Expansion)) {
                    this.next();
                    return;
                }
                unreachable;
            }

            fn initSubproc(this: *Cmd) void {
                log("cmd init subproc ({x}, cwd={s})", .{ @intFromPtr(this), this.base.shell.cwd() });

                var arena = &this.spawn_arena;
                var arena_allocator = arena.allocator();

                // for (this.node.assigns) |*assign| {
                //     this.base.interpreter.assignVar(assign, .cmd);
                // }

                var spawn_args = Subprocess.SpawnArgs.default(arena, this.base.interpreter.global, false);

                spawn_args.argv = std.ArrayListUnmanaged(?[*:0]const u8){};
                spawn_args.cmd_parent = this;
                spawn_args.cwd = this.base.shell.cwdZ();

                const args = args: {
                    this.args.append(null) catch bun.outOfMemory();

                    if (bun.Environment.allow_assert) {
                        for (this.args.items) |maybe_arg| {
                            if (maybe_arg) |arg| {
                                log("ARG: {s}\n", .{arg});
                            }
                        }
                    }

                    const first_arg = this.args.items[0] orelse {
                        // If no args then this is a bug
                        @panic("No arguments provided");
                    };

                    const first_arg_len = std.mem.len(first_arg);

                    if (Builtin.Kind.fromStr(first_arg[0..first_arg_len])) |b| {
                        // const cwd = switch (Syscall.dup(this.base.shell.cwd_fd)) {
                        //     .err => |e| {
                        //         var buf = std.ArrayList(u8).init(arena_allocator);
                        //         const writer = buf.writer();
                        //         e.format("bun: ", .{}, writer) catch bun.outOfMemory();
                        //         this.writeFailingError(buf.items[0..], e.errno);
                        //         return;
                        //     },
                        //     .result => |fd| fd,
                        // };
                        const cwd = this.base.shell.cwd_fd;
                        const coro_result = Builtin.init(
                            this,
                            this.base.interpreter,
                            b,
                            arena,
                            this.node,
                            &this.args,
                            &this.base.shell.export_env,
                            &this.base.shell.cmd_local_env,
                            // this.base.shell.export_env.cloneWithAllocator(arena_allocator),
                            // this.base.shell.cmd_local_env.cloneWithAllocator(arena_allocator),
                            cwd,
                            &this.io,
                            false,
                        );
                        if (coro_result == .yield) return;

                        if (comptime bun.Environment.allow_assert) {
                            std.debug.assert(this.exec == .bltn);
                        }

                        log("WTF: {s}", .{@tagName(this.exec)});

                        switch (this.exec.bltn.start()) {
                            .result => {},
                            .err => |e| {
                                const buf = std.fmt.allocPrint(this.spawn_arena.allocator(), "bun: {s}: {s}", .{ @tagName(this.exec.bltn.kind), e.toSystemError().message }) catch bun.outOfMemory();
                                this.writeFailingError(buf, 1);
                                return;
                            },
                        }
                        return;
                    }

                    var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    const resolved = which(&path_buf, spawn_args.PATH, spawn_args.cwd, first_arg[0..first_arg_len]) orelse {
                        const buf = std.fmt.allocPrint(arena_allocator, "bun: command not found: {s}\n", .{first_arg}) catch bun.outOfMemory();
                        this.writeFailingError(buf, 1);
                        return;
                    };

                    const duped = arena_allocator.dupeZ(u8, bun.span(resolved)) catch bun.outOfMemory();
                    this.args.items[0] = duped;

                    break :args this.args;
                };
                spawn_args.argv = std.ArrayListUnmanaged(?[*:0]const u8){ .items = args.items, .capacity = args.capacity };

                // Fill the env from the export end and cmd local env
                {
                    var env_iter = this.base.shell.export_env.iterator();
                    spawn_args.fillEnv(&env_iter, false);
                    env_iter = this.base.shell.cmd_local_env.iterator();
                    spawn_args.fillEnv(&env_iter, false);
                }

                this.io.to_subproc_stdio(&spawn_args.stdio);

                if (this.node.redirect_file) |redirect| {
                    const in_cmd_subst = false;

                    if (comptime in_cmd_subst) {
                        setStdioFromRedirect(&spawn_args.stdio, this.node.redirect, .ignore);
                    } else switch (redirect) {
                        .jsbuf => |val| {
                            // JS values in here is probably a bug
                            if (comptime EventLoopKind != .js) @panic("JS values not allowed in this context");

                            if (this.base.interpreter.jsobjs[val.idx].asArrayBuffer(this.base.interpreter.global)) |buf| {
                                const stdio: bun.shell.subproc.Stdio = .{ .array_buffer = .{
                                    .buf = JSC.ArrayBuffer.Strong{
                                        .array_buffer = buf,
                                        .held = JSC.Strong.create(buf.value, this.base.interpreter.global),
                                    },
                                    .from_jsc = true,
                                } };

                                setStdioFromRedirect(&spawn_args.stdio, this.node.redirect, stdio);
                            } else if (this.base.interpreter.jsobjs[val.idx].as(JSC.WebCore.Blob)) |blob| {
                                if (this.node.redirect.stdin) {
                                    if (!Subprocess.extractStdioBlob(this.base.interpreter.global, .{
                                        .Blob = blob.*,
                                    }, stdin_no, &spawn_args.stdio)) {
                                        return;
                                    }
                                }
                                if (this.node.redirect.stdout) {
                                    if (!Subprocess.extractStdioBlob(this.base.interpreter.global, .{
                                        .Blob = blob.*,
                                    }, stdout_no, &spawn_args.stdio)) {
                                        return;
                                    }
                                }
                                if (this.node.redirect.stderr) {
                                    if (!Subprocess.extractStdioBlob(this.base.interpreter.global, .{
                                        .Blob = blob.*,
                                    }, stderr_no, &spawn_args.stdio)) {
                                        return;
                                    }
                                }
                            } else if (JSC.WebCore.ReadableStream.fromJS(this.base.interpreter.jsobjs[val.idx], this.base.interpreter.global)) |rstream| {
                                const stdio: bun.shell.subproc.Stdio = .{
                                    .pipe = rstream,
                                };

                                setStdioFromRedirect(&spawn_args.stdio, this.node.redirect, stdio);
                            } else if (this.base.interpreter.jsobjs[val.idx].as(JSC.WebCore.Response)) |req| {
                                req.getBodyValue().toBlobIfPossible();
                                if (this.node.redirect.stdin) {
                                    if (!Subprocess.extractStdioBlob(this.base.interpreter.global, req.getBodyValue().useAsAnyBlob(), stdin_no, &spawn_args.stdio)) {
                                        return;
                                    }
                                }
                                if (this.node.redirect.stdout) {
                                    if (!Subprocess.extractStdioBlob(this.base.interpreter.global, req.getBodyValue().useAsAnyBlob(), stdout_no, &spawn_args.stdio)) {
                                        return;
                                    }
                                }
                                if (this.node.redirect.stderr) {
                                    if (!Subprocess.extractStdioBlob(this.base.interpreter.global, req.getBodyValue().useAsAnyBlob(), stderr_no, &spawn_args.stdio)) {
                                        return;
                                    }
                                }
                            } else {
                                const jsval = this.base.interpreter.jsobjs[val.idx];
                                global_handle.get().globalThis.throw(
                                    "Unknown JS value used in shell: {}",
                                    .{jsval.fmtString(global_handle.get().globalThis)},
                                );
                                return;
                            }
                        },
                        .atom => {
                            if (this.redirection_file.items.len == 0) {
                                const buf = std.fmt.allocPrint(spawn_args.arena.allocator(), "bun: ambiguous redirect: at `{s}`\n", .{spawn_args.argv.items[0] orelse "<unknown>"}) catch bun.outOfMemory();
                                this.writeFailingError(buf, 1);
                                return;
                            }
                            const path = this.redirection_file.items[0..this.redirection_file.items.len -| 1 :0];
                            log("EXPANDED REDIRECT: {s}\n", .{this.redirection_file.items[0..]});
                            const perm = 0o666;
                            const extra: bun.Mode = if (this.node.redirect.append) std.os.O.APPEND else std.os.O.TRUNC;
                            const redirfd = switch (Syscall.openat(this.base.shell.cwd_fd, path, std.os.O.WRONLY | std.os.O.CREAT | extra, perm)) {
                                .err => |e| {
                                    const buf = std.fmt.allocPrint(this.spawn_arena.allocator(), "bun: {s}: {s}", .{ e.toSystemError().message, path }) catch bun.outOfMemory();
                                    return this.writeFailingError(buf, 1);
                                },
                                .result => |f| f,
                            };
                            this.redirection_fd = redirfd;
                            setStdioFromRedirect(&spawn_args.stdio, this.node.redirect, .{ .fd = redirfd });
                        },
                    }
                }

                const buffered_closed = BufferedIoClosed.fromStdio(&spawn_args.stdio);
                log("cmd ({x}) set buffered closed => {any}", .{ @intFromPtr(this), buffered_closed });

                this.exec = .{ .subproc = .{
                    .child = undefined,
                    .buffered_closed = buffered_closed,
                } };
                const subproc = switch (Subprocess.spawnAsync(this.base.interpreter.global, spawn_args, &this.exec.subproc.child)) {
                    .result => this.exec.subproc.child,
                    .err => |e| {
                        global_handle.get().actuallyThrow(e);
                        return;
                    },
                };
                subproc.ref();
                this.spawn_arena_freed = true;
                arena.deinit();

                // if (this.cmd.stdout == .pipe and this.cmd.stdout.pipe == .buffer) {
                //     this.cmd.?.stdout.pipe.buffer.watch();
                // }
            }

            fn setStdioFromRedirect(stdio: *[3]shell.subproc.Stdio, flags: ast.Cmd.RedirectFlags, val: shell.subproc.Stdio) void {
                if (flags.stdin) {
                    stdio.*[stdin_no] = val;
                }

                if (flags.stdout) {
                    stdio.*[stdout_no] = val;
                }

                if (flags.stderr) {
                    stdio.*[stderr_no] = val;
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
                if (this.exit_code == null) return false;
                if (this.exec != .none) {
                    if (this.exec == .subproc) return this.exec.subproc.buffered_closed.allClosed();
                    return this.exec.bltn.ioAllClosed();
                }
                return true;
            }

            /// Called by Subprocess
            pub fn onExit(this: *Cmd, exit_code: ExitCode) void {
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
                // this.base.shell.cmd_local_env.clearRetainingCapacity();
                if (this.redirection_fd != bun.invalid_fd) {
                    _ = Syscall.close(this.redirection_fd);
                    this.redirection_fd = bun.invalid_fd;
                }
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
                        this.exec.subproc.buffered_closed.deinit(GlobalHandle.init(this.base.interpreter.global).allocator());
                    } else {
                        this.exec.bltn.deinit();
                    }
                    this.exec = .none;
                }

                if (!this.spawn_arena_freed) this.spawn_arena.deinit();
                this.freed = true;
                this.base.interpreter.allocator.destroy(this);
            }

            pub fn bufferedInputClose(this: *Cmd) void {
                this.exec.subproc.buffered_closed.close(this, .stdin);
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
                if (this.io.stdout == .std and this.io.stdout.std.captured != null and !this.node.redirect.stdout) {
                    var buf = this.io.stdout.std.captured.?;
                    buf.append(bun.default_allocator, this.exec.subproc.child.stdout.pipe.buffer.internal_buffer.slice()) catch bun.outOfMemory();
                }
                this.exec.subproc.buffered_closed.close(this, .{ .stdout = &this.exec.subproc.child.stdout });
                this.exec.subproc.child.closeIO(.stdout);
            }

            pub fn bufferedOutputCloseStderr(this: *Cmd) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.exec == .subproc);
                }
                log("cmd ({x}) close buffered stderr", .{@intFromPtr(this)});
                if (this.io.stderr == .std and this.io.stderr.std.captured != null and !this.node.redirect.stderr) {
                    var buf = this.io.stderr.std.captured.?;
                    buf.append(bun.default_allocator, this.exec.subproc.child.stderr.pipe.buffer.internal_buffer.slice()) catch bun.outOfMemory();
                }
                this.exec.subproc.buffered_closed.close(this, .{ .stderr = &this.exec.subproc.child.stderr });
                this.exec.subproc.child.closeIO(.stderr);
            }
        };

        pub const Builtin = struct {
            kind: Kind,
            stdin: BuiltinIO,
            stdout: BuiltinIO,
            stderr: BuiltinIO,
            exit_code: ?ExitCode = null,

            export_env: *EnvMap,
            cmd_local_env: *EnvMap,

            arena: *bun.ArenaAllocator,
            /// The following are allocated with the above arena
            args: *const std.ArrayList(?[*:0]const u8),
            args_slice: ?[]const [:0]const u8 = null,
            cwd: bun.FileDescriptor,

            impl: union(Kind) {
                @"export": Export,
                cd: Cd,
                echo: Echo,
                pwd: Pwd,
                which: Which,
                rm: Rm,
                mv: Mv,
                ls: Ls,
            },

            const Result = @import("../result.zig").Result;

            pub const Kind = enum {
                @"export",
                cd,
                echo,
                pwd,
                which,
                rm,
                mv,
                ls,

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
                        .rm => "usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n",
                        .mv => "usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n",
                        .ls => "usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]\n",
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
                        .mv => "mv",
                        .ls => "ls",
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
            pub const BuiltinIO = union(enum) {
                fd: bun.FileDescriptor,
                buf: std.ArrayList(u8),
                captured: struct {
                    out_kind: enum { stdout, stderr },
                    bytelist: *bun.ByteList,
                },
                arraybuf: ArrayBuf,
                blob: *bun.JSC.WebCore.Blob,
                ignore,

                const ArrayBuf = struct {
                    buf: JSC.ArrayBuffer.Strong,
                    i: u32 = 0,
                };

                pub fn asFd(this: *BuiltinIO) ?bun.FileDescriptor {
                    return switch (this.*) {
                        .fd => this.fd,
                        .captured => if (this.captured.out_kind == .stdout) bun.STDOUT_FD else bun.STDERR_FD,
                        else => null,
                    };
                }

                pub fn expectFd(this: *BuiltinIO) bun.FileDescriptor {
                    return switch (this.*) {
                        .fd => this.fd,
                        .captured => if (this.captured.out_kind == .stdout) bun.STDOUT_FD else bun.STDERR_FD,
                        else => @panic("No fd"),
                    };
                }

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
                        .fd => {
                            if (this.fd != bun.invalid_fd and this.fd != bun.STDIN_FD) {
                                _ = Syscall.close(this.fd);
                                this.fd = bun.invalid_fd;
                            }
                        },
                        .blob => |blob| {
                            blob.deinit();
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
                        .fd, .captured => true,
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
                    .pwd => this.callImplWithType(Pwd, Ret, "pwd", field, args_),
                    .mv => this.callImplWithType(Mv, Ret, "mv", field, args_),
                    .ls => this.callImplWithType(Ls, Ret, "ls", field, args_),
                };
            }

            fn callImplWithType(this: *Builtin, comptime Impl: type, comptime Ret: type, comptime union_field: []const u8, comptime field: []const u8, args_: anytype) Ret {
                const self = &@field(this.impl, union_field);
                const args = brk: {
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
                interpreter: *ThisInterpreter,
                kind: Kind,
                arena: *bun.ArenaAllocator,
                node: *const ast.Cmd,
                args: *const std.ArrayList(?[*:0]const u8),
                export_env: *EnvMap,
                cmd_local_env: *EnvMap,
                cwd: bun.FileDescriptor,
                io_: *IO,
                comptime in_cmd_subst: bool,
            ) CoroutineResult {
                const io = io_.*;

                const stdin: Builtin.BuiltinIO = switch (io.stdin) {
                    .std => .{ .fd = bun.STDIN_FD },
                    .fd => |fd| .{ .fd = fd },
                    .pipe => .{ .buf = std.ArrayList(u8).init(interpreter.allocator) },
                    .ignore => .ignore,
                };
                const stdout: Builtin.BuiltinIO = switch (io.stdout) {
                    .std => if (io.stdout.std.captured) |bytelist| .{ .captured = .{ .out_kind = .stdout, .bytelist = bytelist } } else .{ .fd = bun.STDOUT_FD },
                    .fd => |fd| .{ .fd = fd },
                    .pipe => .{ .buf = std.ArrayList(u8).init(interpreter.allocator) },
                    .ignore => .ignore,
                };
                const stderr: Builtin.BuiltinIO = switch (io.stderr) {
                    .std => if (io.stderr.std.captured) |bytelist| .{ .captured = .{ .out_kind = .stderr, .bytelist = bytelist } } else .{ .fd = bun.STDERR_FD },
                    .fd => |fd| .{ .fd = fd },
                    .pipe => .{ .buf = std.ArrayList(u8).init(interpreter.allocator) },
                    .ignore => .ignore,
                };

                cmd.exec = .{
                    .bltn = Builtin{
                        .kind = kind,
                        .stdin = stdin,
                        .stdout = stdout,
                        .stderr = stderr,
                        .exit_code = null,
                        .arena = arena,
                        .args = args,
                        .export_env = export_env,
                        .cmd_local_env = cmd_local_env,
                        .cwd = cwd,
                        .impl = undefined,
                    },
                };

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
                    .pwd => {
                        cmd.exec.bltn.impl = .{
                            .pwd = Pwd{ .bltn = &cmd.exec.bltn },
                        };
                    },
                    .mv => {
                        cmd.exec.bltn.impl = .{
                            .mv = Mv{ .bltn = &cmd.exec.bltn },
                        };
                    },
                    .ls => {
                        cmd.exec.bltn.impl = .{
                            .ls = Ls{
                                .bltn = &cmd.exec.bltn,
                            },
                        };
                    },
                }

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
                            if (cmd.redirection_file.items.len == 0) {
                                const buf = std.fmt.allocPrint(arena.allocator(), "bun: ambiguous redirect: at `{s}`\n", .{@tagName(kind)}) catch bun.outOfMemory();
                                cmd.writeFailingError(buf, 1);
                                return .yield;
                            }
                            const path = cmd.redirection_file.items[0..cmd.redirection_file.items.len -| 1 :0];
                            log("EXPANDED REDIRECT: {s}\n", .{cmd.redirection_file.items[0..]});
                            const perm = 0o666;
                            const extra: bun.Mode = if (node.redirect.append) std.os.O.APPEND else std.os.O.TRUNC;
                            const redirfd = switch (Syscall.openat(cmd.base.shell.cwd_fd, path, std.os.O.WRONLY | std.os.O.CREAT | extra, perm)) {
                                .err => |e| {
                                    const buf = std.fmt.allocPrint(arena.allocator(), "bun: {s}: {s}", .{ e.toSystemError().message, path }) catch bun.outOfMemory();
                                    cmd.writeFailingError(buf, 1);
                                    return .yield;
                                },
                                .result => |f| f,
                            };
                            // cmd.redirection_fd = redirfd;
                            if (node.redirect.stdin) {
                                cmd.exec.bltn.stdin = .{ .fd = redirfd };
                            }
                            if (node.redirect.stdout) {
                                cmd.exec.bltn.stdout = .{ .fd = redirfd };
                            }
                            if (node.redirect.stderr) {
                                cmd.exec.bltn.stderr = .{ .fd = redirfd };
                            }
                        },
                        .jsbuf => |val| {
                            if (comptime EventLoopKind == .mini) @panic("This should nevver happened");
                            if (interpreter.jsobjs[file.jsbuf.idx].asArrayBuffer(interpreter.global)) |buf| {
                                const builtinio: Builtin.BuiltinIO = .{ .arraybuf = .{ .buf = JSC.ArrayBuffer.Strong{
                                    .array_buffer = buf,
                                    .held = JSC.Strong.create(buf.value, interpreter.global),
                                }, .i = 0 } };

                                if (node.redirect.stdin) {
                                    cmd.exec.bltn.stdin = builtinio;
                                }

                                if (node.redirect.stdout) {
                                    cmd.exec.bltn.stdout = builtinio;
                                }

                                if (node.redirect.stderr) {
                                    cmd.exec.bltn.stderr = builtinio;
                                }
                            } else if (interpreter.jsobjs[file.jsbuf.idx].as(JSC.WebCore.Blob)) |blob| {
                                const builtinio: Builtin.BuiltinIO = .{ .blob = bun.newWithAlloc(arena.allocator(), JSC.WebCore.Blob, blob.dupe()) };

                                if (node.redirect.stdin) {
                                    cmd.exec.bltn.stdin = builtinio;
                                }

                                if (node.redirect.stdout) {
                                    cmd.exec.bltn.stdout = builtinio;
                                }

                                if (node.redirect.stderr) {
                                    cmd.exec.bltn.stderr = builtinio;
                                }
                            } else {
                                const jsval = cmd.base.interpreter.jsobjs[val.idx];
                                global_handle.get().globalThis.throw("Unknown JS value used in shell: {}", .{jsval.fmtString(global_handle.get().globalThis)});
                                return .yield;
                            }
                        },
                    }
                }

                return .cont;
            }

            pub inline fn parentCmd(this: *Builtin) *Cmd {
                const union_ptr = @fieldParentPtr(Cmd.Exec, "bltn", this);
                return @fieldParentPtr(Cmd, "exec", union_ptr);
            }

            pub fn done(this: *Builtin, exit_code: ExitCode) void {
                // if (comptime bun.Environment.allow_assert) {
                //     std.debug.assert(this.exit_code != null);
                // }
                this.exit_code = exit_code;

                var cmd = this.parentCmd();
                log("builtin done ({s}: exit={d}) cmd to free: ({x})", .{ @tagName(this.kind), exit_code, @intFromPtr(cmd) });
                cmd.exit_code = this.exit_code.?;

                // Aggregate output data if shell state is piped and this cmd is piped
                if (cmd.io.stdout == .pipe and cmd.base.shell.io.stdout == .pipe and this.stdout == .buf) {
                    cmd.base.shell.buffered_stdout().append(bun.default_allocator, this.stdout.buf.items[0..]) catch bun.outOfMemory();
                }
                // Aggregate output data if shell state is piped and this cmd is piped
                if (cmd.io.stderr == .pipe and cmd.base.shell.io.stderr == .pipe and this.stderr == .buf) {
                    cmd.base.shell.buffered_stderr().append(bun.default_allocator, this.stderr.buf.items[0..]) catch bun.outOfMemory();
                }

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

                // No need to free it because it belongs to the parent cmd
                // _ = Syscall.close(this.cwd);

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

            /// If the stdout/stderr is supposed to be captured then get the bytelist associated with that
            pub fn stdBufferedBytelist(this: *Builtin, comptime io_kind: @Type(.EnumLiteral)) ?*bun.ByteList {
                if (comptime io_kind != .stdout and io_kind != .stderr) {
                    @compileError("Bad IO" ++ @tagName(io_kind));
                }

                const io: *BuiltinIO = &@field(this, @tagName(io_kind));
                return switch (io.*) {
                    .captured => if (comptime io_kind == .stdout) this.parentCmd().base.shell.buffered_stdout() else this.parentCmd().base.shell.buffered_stderr(),
                    else => null,
                };
            }

            pub fn writeNoIO(this: *Builtin, comptime io_kind: @Type(.EnumLiteral), buf: []const u8) Maybe(usize) {
                if (comptime io_kind != .stdout and io_kind != .stderr) {
                    @compileError("Bad IO" ++ @tagName(io_kind));
                }

                if (buf.len == 0) return .{ .result = 0 };

                var io: *BuiltinIO = &@field(this, @tagName(io_kind));

                switch (io.*) {
                    .captured, .fd => @panic("writeNoIO can't write to a file descriptor"),
                    .buf => {
                        log("{s} write to buf len={d} str={s}{s}\n", .{ this.kind.asString(), buf.len, buf[0..@min(buf.len, 16)], if (buf.len > 16) "..." else "" });
                        io.buf.appendSlice(buf) catch bun.outOfMemory();
                        return Maybe(usize).initResult(buf.len);
                    },
                    .arraybuf => {
                        if (io.arraybuf.i >= io.arraybuf.buf.array_buffer.byte_len) {
                            // TODO is it correct to return an error here? is this error the correct one to return?
                            return Maybe(usize).initErr(Syscall.Error.fromCode(bun.C.E.NOSPC, .write));
                        }

                        const len = buf.len;
                        if (io.arraybuf.i + len > io.arraybuf.buf.array_buffer.byte_len) {
                            // std.ArrayList(comptime T: type)
                        }
                        const write_len = if (io.arraybuf.i + len > io.arraybuf.buf.array_buffer.byte_len)
                            io.arraybuf.buf.array_buffer.byte_len - io.arraybuf.i
                        else
                            len;

                        const slice = io.arraybuf.buf.slice()[io.arraybuf.i .. io.arraybuf.i + write_len];
                        @memcpy(slice, buf[0..write_len]);
                        io.arraybuf.i +|= @truncate(write_len);
                        log("{s} write to arraybuf {d}\n", .{ this.kind.asString(), write_len });
                        return Maybe(usize).initResult(write_len);
                    },
                    .blob, .ignore => return Maybe(usize).initResult(buf.len),
                }
            }

            /// Error messages formatted to match bash
            fn taskErrorToString(this: *Builtin, comptime kind: Kind, err: Syscall.Error) []const u8 {
                return switch (err.getErrno()) {
                    bun.C.E.NOENT => this.fmtErrorArena(kind, "{s}: No such file or directory\n", .{err.path}),
                    bun.C.E.NAMETOOLONG => this.fmtErrorArena(kind, "{s}: File name too long\n", .{err.path}),
                    bun.C.E.ISDIR => this.fmtErrorArena(kind, "{s}: is a directory\n", .{err.path}),
                    bun.C.E.NOTEMPTY => this.fmtErrorArena(kind, "{s}: Directory not empty\n", .{err.path}),
                    else => err.toSystemError().message.byteSlice(),
                };
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
                    key: EnvStr,
                    value: EnvStr,

                    pub fn compare(context: void, this: @This(), other: @This()) bool {
                        return bun.strings.cmpStringsAsc(context, this.key.slice(), other.key.slice());
                    }
                };

                pub fn writeOutput(this: *Export, comptime io_kind: @Type(.EnumLiteral), buf: []const u8) Maybe(void) {
                    if (!this.bltn.stdout.needsIO()) {
                        switch (this.bltn.writeNoIO(io_kind, buf)) {
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

                    this.print_state = .{
                        .bufwriter = BufferedWriter{
                            .remain = buf,
                            .fd = if (comptime io_kind == .stdout) this.bltn.stdout.expectFd() else this.bltn.stderr.expectFd(),
                            .parent = BufferedWriter.ParentPtr{ .ptr = BufferedWriter.ParentPtr.Repr.init(this) },
                            .bytelist = this.bltn.stdBufferedBytelist(io_kind),
                        },
                    };
                    this.print_state.?.bufwriter.writeIfPossible(false);
                    return Maybe(void).success;
                }

                pub fn onBufferedWriterDone(this: *Export, e: ?Syscall.Error) void {
                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(this.print_state != null);
                    }

                    this.print_state.?.err = e;
                    const exit_code: ExitCode = if (e != null) e.?.errno else 0;
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
                                len += std.fmt.count("{s}={s}\n", .{ entry.key.slice(), entry.value.slice() });
                            }
                            break :brk len;
                        };
                        var buf = arena.allocator().alloc(u8, len) catch bun.outOfMemory();
                        {
                            var i: usize = 0;
                            for (keys.items) |entry| {
                                const written_slice = std.fmt.bufPrint(buf[i..], "{s}={s}\n", .{ entry.key.slice(), entry.value.slice() }) catch @panic("This should not happen");
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
                                .fd = this.bltn.stdout.expectFd(),
                                .parent = BufferedWriter.ParentPtr{ .ptr = BufferedWriter.ParentPtr.Repr.init(this) },
                                .bytelist = this.bltn.stdBufferedBytelist(.stdout),
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

                    for (args) |arg_raw| {
                        const arg_sentinel = arg_raw[0..std.mem.len(arg_raw) :0];
                        const arg = arg_sentinel[0..arg_sentinel.len];
                        if (arg.len == 0) continue;

                        const eqsign_idx = std.mem.indexOfScalar(u8, arg, '=') orelse {
                            if (!shell.isValidVarName(arg)) {
                                const buf = this.bltn.fmtErrorArena(.@"export", "`{s}`: not a valid identifier", .{arg});
                                return this.writeOutput(.stderr, buf);
                            }
                            this.bltn.parentCmd().base.shell.assignVar(this.bltn.parentCmd().base.interpreter, EnvStr.initSlice(arg), EnvStr.initSlice(""), .exported);
                            continue;
                        };

                        const label = arg[0..eqsign_idx];
                        const value = arg_sentinel[eqsign_idx + 1 .. :0];
                        this.bltn.parentCmd().base.shell.assignVar(this.bltn.parentCmd().base.interpreter, EnvStr.initSlice(label), EnvStr.initSlice(value), .exported);
                    }

                    this.bltn.done(0);
                    return Maybe(void).success;
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
                        .fd = this.bltn.stdout.expectFd(),
                        .remain = this.output.items[0..],
                        .parent = BufferedWriter.ParentPtr.init(this),
                        .bytelist = this.bltn.stdBufferedBytelist(.stdout),
                    };
                    this.state = .waiting;
                    this.io_write_state.?.writeIfPossible(false);
                    return Maybe(void).success;
                }

                pub fn onBufferedWriterDone(this: *Echo, e: ?Syscall.Error) void {
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
                                    .fd = this.bltn.stdout.expectFd(),
                                    .remain = "\n",
                                    .parent = BufferedWriter.ParentPtr.init(this),
                                    .bytelist = this.bltn.stdBufferedBytelist(.stdout),
                                },
                            },
                        };
                        this.state.one_arg.writer.writeIfPossible(false);
                        return Maybe(void).success;
                    }

                    if (!this.bltn.stdout.needsIO()) {
                        var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                        const PATH = this.bltn.parentCmd().base.shell.export_env.get(EnvStr.initSlice("PATH")) orelse EnvStr.initSlice("");
                        var had_not_found = false;
                        for (args) |arg_raw| {
                            const arg = arg_raw[0..std.mem.len(arg_raw)];
                            const resolved = which(&path_buf, PATH.slice(), this.bltn.parentCmd().base.shell.cwdZ(), arg) orelse {
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
                    const PATH = this.bltn.parentCmd().base.shell.export_env.get(EnvStr.initSlice("PATH")) orelse EnvStr.initSlice("");

                    const resolved = which(&path_buf, PATH.slice(), this.bltn.parentCmd().base.shell.cwdZ(), arg) orelse {
                        const buf = this.bltn.fmtErrorArena(null, "{s} not found\n", .{arg});
                        multiargs.had_not_found = true;
                        multiargs.state = .{
                            .waiting_write = BufferedWriter{
                                .fd = this.bltn.stdout.expectFd(),
                                .remain = buf,
                                .parent = BufferedWriter.ParentPtr.init(this),
                                .bytelist = this.bltn.stdBufferedBytelist(.stdout),
                            },
                        };
                        multiargs.state.waiting_write.writeIfPossible(false);
                        // yield execution
                        return;
                    };

                    const buf = this.bltn.fmtErrorArena(null, "{s}\n", .{resolved});
                    multiargs.state = .{
                        .waiting_write = BufferedWriter{
                            .fd = this.bltn.stdout.expectFd(),
                            .remain = buf,
                            .parent = BufferedWriter.ParentPtr.init(this),
                            .bytelist = this.bltn.stdBufferedBytelist(.stdout),
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

                pub fn onBufferedWriterDone(this: *Which, e: ?Syscall.Error) void {
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
                                .fd = this.bltn.stderr.expectFd(),
                                .remain = buf,
                                .parent = BufferedWriter.ParentPtr.init(this),
                                .bytelist = this.bltn.stdBufferedBytelist(.stderr),
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
                            switch (this.bltn.parentCmd().base.shell.changePrevCwd(this.bltn.parentCmd().base.interpreter)) {
                                .result => {},
                                .err => |err| {
                                    return this.handleChangeCwdErr(err, this.bltn.parentCmd().base.shell.prevCwdZ());
                                },
                            }
                        },
                        '~' => {
                            const homedir = this.bltn.parentCmd().base.shell.getHomedir();
                            homedir.deref();
                            switch (this.bltn.parentCmd().base.shell.changeCwd(this.bltn.parentCmd().base.interpreter, homedir.slice())) {
                                .result => {},
                                .err => |err| return this.handleChangeCwdErr(err, homedir.slice()),
                            }
                        },
                        else => {
                            switch (this.bltn.parentCmd().base.shell.changeCwd(this.bltn.parentCmd().base.interpreter, first_arg)) {
                                .result => {},
                                .err => |err| return this.handleChangeCwdErr(err, first_arg),
                            }
                        },
                    }
                    this.bltn.done(0);
                    return Maybe(void).success;
                }

                fn handleChangeCwdErr(this: *Cd, err: Syscall.Error, new_cwd_: []const u8) Maybe(void) {
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

                pub fn onBufferedWriterDone(this: *Cd, e: ?Syscall.Error) void {
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

            pub const Pwd = struct {
                bltn: *Builtin,
                state: union(enum) {
                    idle,
                    waiting_io: struct {
                        kind: enum { stdout, stderr },
                        writer: BufferedWriter,
                    },
                    err: Syscall.Error,
                    done,
                } = .idle,

                pub fn start(this: *Pwd) Maybe(void) {
                    const args = this.bltn.argsSlice();
                    if (args.len > 0) {
                        const msg = "pwd: too many arguments";
                        if (this.bltn.stderr.needsIO()) {
                            this.state = .{
                                .waiting_io = .{
                                    .kind = .stderr,
                                    .writer = BufferedWriter{
                                        .fd = this.bltn.stderr.expectFd(),
                                        .remain = msg,
                                        .parent = BufferedWriter.ParentPtr.init(this),
                                        .bytelist = this.bltn.stdBufferedBytelist(.stderr),
                                    },
                                },
                            };
                            this.state.waiting_io.writer.writeIfPossible(false);
                            return Maybe(void).success;
                        }

                        if (this.bltn.writeNoIO(.stderr, msg).asErr()) |e| {
                            return .{ .err = e };
                        }

                        this.bltn.done(1);
                        return Maybe(void).success;
                    }

                    const cwd_str = this.bltn.parentCmd().base.shell.cwd();
                    const buf = this.bltn.fmtErrorArena(null, "{s}\n", .{cwd_str});
                    if (this.bltn.stdout.needsIO()) {
                        this.state = .{
                            .waiting_io = .{
                                .kind = .stdout,
                                .writer = BufferedWriter{
                                    .fd = this.bltn.stdout.expectFd(),
                                    .remain = buf,
                                    .parent = BufferedWriter.ParentPtr.init(this),
                                    .bytelist = this.bltn.stdBufferedBytelist(.stdout),
                                },
                            },
                        };
                        this.state.waiting_io.writer.writeIfPossible(false);
                        return Maybe(void).success;
                    }

                    if (this.bltn.writeNoIO(.stdout, buf).asErr()) |err| {
                        return .{ .err = err };
                    }

                    this.state = .done;
                    this.bltn.done(0);
                    return Maybe(void).success;
                }

                pub fn next(this: *Pwd) void {
                    while (!(this.state == .err or this.state == .done)) {
                        switch (this.state) {
                            .waiting_io => return,
                            .idle, .done, .err => unreachable,
                        }
                    }

                    if (this.state == .done) {
                        this.bltn.done(0);
                        return;
                    }

                    if (this.state == .err) {
                        this.bltn.done(this.state.err.errno);
                        return;
                    }
                }

                pub fn onBufferedWriterDone(this: *Pwd, e: ?Syscall.Error) void {
                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(this.state == .waiting_io);
                    }

                    if (e != null) {
                        this.state = .{ .err = e.? };
                        this.next();
                        return;
                    }

                    this.state = .done;

                    this.next();
                }

                pub fn deinit(this: *Pwd) void {
                    _ = this;
                }
            };

            pub const Ls = struct {
                bltn: *Builtin,
                opts: Opts = .{},

                state: union(enum) {
                    idle,
                    exec: struct {
                        err: ?Syscall.Error = null,
                        task_count: std.atomic.Value(usize),
                        tasks_done: usize = 0,
                        output_queue: std.DoublyLinkedList(BlockingOutput) = .{},
                        started_output_queue: bool = false,
                    },
                    waiting_write_err: BufferedWriter,
                    done,
                } = .idle,

                const BlockingOutput = struct {
                    writer: BufferedWriter,
                    arr: std.ArrayList(u8),

                    pub fn deinit(this: *BlockingOutput) void {
                        this.arr.deinit();
                    }
                };

                pub fn start(this: *Ls) Maybe(void) {
                    this.next();
                    return Maybe(void).success;
                }

                pub fn writeFailingError(this: *Ls, buf: []const u8, exit_code: ExitCode) Maybe(void) {
                    if (this.bltn.stderr.needsIO()) {
                        this.state = .{
                            .waiting_write_err = BufferedWriter{
                                .fd = this.bltn.stderr.expectFd(),
                                .remain = buf,
                                .parent = BufferedWriter.ParentPtr.init(this),
                                .bytelist = this.bltn.stdBufferedBytelist(.stderr),
                            },
                        };
                        this.state.waiting_write_err.writeIfPossible(false);
                        return Maybe(void).success;
                    }

                    if (this.bltn.writeNoIO(.stderr, buf).asErr()) |e| {
                        return .{ .err = e };
                    }

                    this.bltn.done(exit_code);
                    return Maybe(void).success;
                }

                fn next(this: *Ls) void {
                    while (!(this.state == .done)) {
                        switch (this.state) {
                            .idle => {
                                // Will be null if called with no args, in which case we just run once with "." directory
                                const paths: ?[]const [*:0]const u8 = switch (this.parseOpts()) {
                                    .ok => |paths| paths,
                                    .err => |e| {
                                        const buf = switch (e) {
                                            .illegal_option => |opt_str| this.bltn.fmtErrorArena(.ls, "illegal option -- {s}\n", .{opt_str}),
                                            .show_usage => Builtin.Kind.ls.usageString(),
                                        };

                                        _ = this.writeFailingError(buf, 1);
                                        return;
                                    },
                                };

                                const task_count = if (paths) |p| p.len else 1;

                                this.state = .{
                                    .exec = .{
                                        .task_count = std.atomic.Value(usize).init(task_count),
                                    },
                                };

                                const cwd = this.bltn.cwd;
                                if (paths) |p| {
                                    for (p) |path_raw| {
                                        const path = path_raw[0..std.mem.len(path_raw) :0];
                                        var task = ShellLsTask.create(this, this.opts, &this.state.exec.task_count, cwd, path, null);
                                        task.schedule();
                                    }
                                } else {
                                    var task = ShellLsTask.create(this, this.opts, &this.state.exec.task_count, cwd, ".", null);
                                    task.schedule();
                                }
                            },
                            .exec => {
                                // It's done
                                if (this.state.exec.tasks_done >= this.state.exec.task_count.load(.Monotonic) and this.state.exec.output_queue.len == 0) {
                                    const exit_code: ExitCode = if (this.state.exec.err != null) 1 else 0;
                                    this.state = .done;
                                    this.bltn.done(exit_code);
                                    return;
                                }
                                return;
                            },
                            .waiting_write_err => {
                                return;
                            },
                            .done => unreachable,
                        }
                    }

                    this.bltn.done(0);
                    return;
                }

                pub fn deinit(this: *Ls) void {
                    _ = this; // autofix
                }

                pub fn queueBlockingOutput(this: *Ls, bo: BlockingOutput) void {
                    _ = this.queueBlockingOutputImpl(bo, true);
                }

                pub fn queueBlockingOutputImpl(this: *Ls, bo: BlockingOutput, do_run: bool) CoroutineResult {
                    const node = bun.default_allocator.create(std.DoublyLinkedList(BlockingOutput).Node) catch bun.outOfMemory();
                    node.* = .{
                        .data = bo,
                    };
                    this.state.exec.output_queue.append(node);

                    // Start it
                    if (this.state.exec.output_queue.len == 1 and do_run) {
                        // if (do_run and !this.state.exec.started_output_queue) {
                        this.state.exec.started_output_queue = true;
                        this.state.exec.output_queue.first.?.data.writer.writeIfPossible(false);
                        return .yield;
                    }
                    return .cont;
                }

                fn scheduleBlockingOutput(this: *Ls) CoroutineResult {
                    if (this.state.exec.output_queue.len > 0) {
                        this.state.exec.output_queue.first.?.data.writer.writeIfPossible(false);
                        return .yield;
                    }
                    return .cont;
                }

                pub fn onBufferedWriterDone(this: *Ls, e: ?Syscall.Error) void {
                    _ = e; // autofix

                    if (this.state == .waiting_write_err) {
                        // if (e) |err| return this.bltn.done(1);
                        return this.bltn.done(1);
                    }

                    var queue = &this.state.exec.output_queue;
                    var first = queue.popFirst().?;
                    defer {
                        first.data.deinit();
                        bun.default_allocator.destroy(first);
                    }
                    if (first.next) |next_writer| {
                        next_writer.data.writer.writeIfPossible(false);
                        return;
                    }

                    this.next();
                }

                pub fn onAsyncTaskDone(this: *Ls, task_: *ShellLsTask) void {
                    this.state.exec.tasks_done += 1;
                    const output = task_.takeOutput();
                    const err = task_.err;
                    task_.deinit();

                    // const need_to_write_to_stdout_with_io = output.items.len > 0 and this.bltn.stdout.needsIO();
                    var queued: bool = false;

                    // Check for error, print it, but still want to print task output
                    if (err) |e| {
                        const error_string = this.bltn.taskErrorToString(.ls, e);
                        this.state.exec.err = e;

                        if (this.bltn.stderr.needsIO()) {
                            queued = true;
                            const blocking_output: BlockingOutput = .{
                                .writer = BufferedWriter{
                                    .fd = this.bltn.stderr.expectFd(),
                                    .remain = error_string,
                                    .parent = BufferedWriter.ParentPtr.init(this),
                                    .bytelist = this.bltn.stdBufferedBytelist(.stderr),
                                },
                                .arr = std.ArrayList(u8).init(bun.default_allocator),
                            };
                            _ = this.queueBlockingOutputImpl(blocking_output, false);
                            // if (!need_to_write_to_stdout_with_io) return; // yield execution
                        } else {
                            if (this.bltn.writeNoIO(.stderr, error_string).asErr()) |theerr| {
                                global_handle.get().actuallyThrow(bun.shell.ShellErr.newSys(theerr));
                            }
                        }
                    }

                    if (this.bltn.stdout.needsIO()) {
                        queued = true;
                        const blocking_output: BlockingOutput = .{
                            .writer = BufferedWriter{
                                .fd = this.bltn.stdout.expectFd(),
                                .remain = output.items[0..],
                                .parent = BufferedWriter.ParentPtr.init(this),
                                .bytelist = this.bltn.stdBufferedBytelist(.stdout),
                            },
                            .arr = output,
                        };
                        _ = this.queueBlockingOutputImpl(blocking_output, false);
                        // if (this.state == .done) return;
                        // return this.next();
                    }

                    if (queued) {
                        if (this.scheduleBlockingOutput() == .yield) return;
                        if (this.state == .done) return;
                        return this.next();
                    }

                    defer output.deinit();

                    if (this.bltn.writeNoIO(.stdout, output.items[0..]).asErr()) |e| {
                        global_handle.get().actuallyThrow(bun.shell.ShellErr.newSys(e));
                        return;
                    }

                    return this.next();
                }

                pub const ShellLsTask = struct {
                    const print = bun.Output.scoped(.ShellLsTask, false);
                    ls: *Ls,
                    opts: Opts,

                    is_root: bool = true,
                    task_count: *std.atomic.Value(usize),

                    cwd: bun.FileDescriptor,
                    /// Should be allocated with bun.default_allocator
                    path: [:0]const u8 = &[0:0]u8{},
                    /// Should use bun.default_allocator
                    output: std.ArrayList(u8),
                    is_absolute: bool = false,
                    err: ?Syscall.Error = null,
                    result_kind: enum { file, dir, idk } = .idk,

                    event_loop: EventLoopRef,
                    concurrent_task: EventLoopTask = .{},
                    task: JSC.WorkPoolTask = .{
                        .callback = workPoolCallback,
                    },

                    pub fn schedule(this: *@This()) void {
                        JSC.WorkPool.schedule(&this.task);
                    }

                    pub fn create(ls: *Ls, opts: Opts, task_count: *std.atomic.Value(usize), cwd: bun.FileDescriptor, path: [:0]const u8, event_loop: ?EventLoopRef) *@This() {
                        const task = bun.default_allocator.create(@This()) catch bun.outOfMemory();
                        task.* = @This(){
                            .ls = ls,
                            .opts = opts,
                            .cwd = cwd,
                            .path = bun.default_allocator.dupeZ(u8, path[0..path.len]) catch bun.outOfMemory(),
                            .output = std.ArrayList(u8).init(bun.default_allocator),
                            // .event_loop = event_loop orelse JSC.VirtualMachine.get().eventLoop(),
                            .event_loop = event_loop orelse event_loop_ref.get(),
                            .task_count = task_count,
                        };
                        return task;
                    }

                    pub fn enqueue(this: *@This(), path: [:0]const u8) void {
                        print("enqueue: {s}", .{path});
                        const new_path = this.join(
                            bun.default_allocator,
                            &[_][]const u8{
                                this.path[0..this.path.len],
                                path[0..path.len],
                            },
                            this.is_absolute,
                        );

                        var subtask = @This().create(this.ls, this.opts, this.task_count, this.cwd, new_path, this.event_loop);
                        _ = this.task_count.fetchAdd(1, .Monotonic);
                        subtask.is_root = false;
                        subtask.schedule();
                    }

                    inline fn join(this: *@This(), alloc: Allocator, subdir_parts: []const []const u8, is_absolute: bool) [:0]const u8 {
                        _ = this; // autofix
                        if (!is_absolute) {
                            // If relative paths enabled, stdlib join is preferred over
                            // ResolvePath.joinBuf because it doesn't try to normalize the path
                            return std.fs.path.joinZ(alloc, subdir_parts) catch bun.outOfMemory();
                        }

                        const out = alloc.dupeZ(u8, bun.path.join(subdir_parts, .auto)) catch bun.outOfMemory();

                        return out;
                    }

                    pub fn run(this: *@This()) void {
                        const fd = switch (Syscall.openat(this.cwd, this.path, os.O.RDONLY | os.O.DIRECTORY, 0)) {
                            .err => |e| {
                                switch (e.getErrno()) {
                                    bun.C.E.NOENT => {
                                        this.err = this.errorWithPath(e, this.path);
                                    },
                                    bun.C.E.NOTDIR => {
                                        this.result_kind = .file;
                                        this.addEntry(this.path);
                                    },
                                    else => {
                                        this.err = this.errorWithPath(e, this.path);
                                    },
                                }
                                return;
                            },
                            .result => |fd| fd,
                        };

                        defer {
                            _ = Syscall.close(fd);
                            print("run done", .{});
                        }

                        if (!this.opts.list_directories) {
                            if (!this.is_root) {
                                const writer = this.output.writer();
                                std.fmt.format(writer, "{s}:\n", .{this.path}) catch bun.outOfMemory();
                            }

                            var iterator = DirIterator.iterate(fd.asDir(), .u8);
                            var entry = iterator.next();

                            while (switch (entry) {
                                .err => |e| {
                                    this.err = this.errorWithPath(e, this.path);
                                    return;
                                },
                                .result => |ent| ent,
                            }) |current| : (entry = iterator.next()) {
                                this.addEntry(current.name.sliceAssumeZ());
                                if (current.kind == .directory and this.opts.recursive) {
                                    this.enqueue(current.name.sliceAssumeZ());
                                }
                            }

                            return;
                        }

                        const writer = this.output.writer();
                        std.fmt.format(writer, "{s}\n", .{this.path}) catch bun.outOfMemory();
                        return;
                    }

                    fn shouldSkipEntry(this: *@This(), name: [:0]const u8) bool {
                        if (this.opts.show_all) return false;
                        if (this.opts.show_almost_all) {
                            if (bun.strings.eqlComptime(name[0..1], ".") or bun.strings.eqlComptime(name[0..2], "..")) return true;
                        }
                        return false;
                    }

                    // TODO more complex output like multi-column
                    fn addEntry(this: *@This(), name: [:0]const u8) void {
                        const skip = this.shouldSkipEntry(name);
                        print("Entry: (skip={}) {s} :: {s}", .{ skip, this.path, name });
                        if (skip) return;
                        this.output.ensureUnusedCapacity(name.len + 1) catch bun.outOfMemory();
                        this.output.appendSlice(name) catch bun.outOfMemory();
                        // FIXME TODO non ascii/utf-8
                        this.output.append('\n') catch bun.outOfMemory();
                    }

                    fn errorWithPath(this: *@This(), err: Syscall.Error, path: [:0]const u8) Syscall.Error {
                        _ = this;
                        return err.withPath(bun.default_allocator.dupeZ(u8, path[0..path.len]) catch bun.outOfMemory());
                    }

                    pub fn workPoolCallback(task: *JSC.WorkPoolTask) void {
                        var this: *@This() = @fieldParentPtr(@This(), "task", task);
                        this.run();
                        this.doneLogic();
                    }

                    fn doneLogic(this: *@This()) void {
                        print("Done", .{});
                        if (comptime EventLoopKind == .js) {
                            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
                        } else {
                            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, "runFromMainThreadMini"));
                        }

                        // if (this.parent) |parent| {
                        //     _ = parent.children_done.fetchAdd(1, .Monotonic);
                        //     if (parent.childrenAreDone()) parent.doneLogic();
                        // }
                    }

                    pub fn takeOutput(this: *@This()) std.ArrayList(u8) {
                        const ret = this.output;
                        this.output = std.ArrayList(u8).init(bun.default_allocator);
                        return ret;
                    }

                    pub fn runFromMainThread(this: *@This()) void {
                        print("runFromMainThread", .{});
                        this.ls.onAsyncTaskDone(this);
                    }

                    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
                        this.runFromMainThread();
                    }

                    pub fn deinit(this: *@This()) void {
                        print("deinit", .{});
                        bun.default_allocator.free(this.path);
                        this.output.deinit();
                        bun.default_allocator.destroy(this);
                    }
                };

                const Opts = struct {
                    /// `-a`, `--all`
                    /// Do not ignore entries starting with .
                    show_all: bool = false,

                    /// `-A`, `--almost-all`
                    /// Do not list implied . and ..
                    show_almost_all: bool = true,

                    /// `--author`
                    /// With -l, print the author of each file
                    show_author: bool = false,

                    /// `-b`, `--escape`
                    /// Print C-style escapes for nongraphic characters
                    escape: bool = false,

                    /// `--block-size=SIZE`
                    /// With -l, scale sizes by SIZE when printing them; e.g., '--block-size=M'
                    block_size: ?usize = null,

                    /// `-B`, `--ignore-backups`
                    /// Do not list implied entries ending with ~
                    ignore_backups: bool = false,

                    /// `-c`
                    /// Sort by, and show, ctime (time of last change of file status information); affects sorting and display based on options
                    use_ctime: bool = false,

                    /// `-C`
                    /// List entries by columns
                    list_by_columns: bool = false,

                    /// `--color[=WHEN]`
                    /// Color the output; WHEN can be 'always', 'auto', or 'never'
                    color: ?[]const u8 = null,

                    /// `-d`, `--directory`
                    /// List directories themselves, not their contents
                    list_directories: bool = false,

                    /// `-D`, `--dired`
                    /// Generate output designed for Emacs' dired mode
                    dired_mode: bool = false,

                    /// `-f`
                    /// List all entries in directory order
                    unsorted: bool = false,

                    /// `-F`, `--classify[=WHEN]`
                    /// Append indicator (one of */=>@|) to entries; WHEN can be 'always', 'auto', or 'never'
                    classify: ?[]const u8 = null,

                    /// `--file-type`
                    /// Likewise, except do not append '*'
                    file_type: bool = false,

                    /// `--format=WORD`
                    /// Specify format: 'across', 'commas', 'horizontal', 'long', 'single-column', 'verbose', 'vertical'
                    format: ?[]const u8 = null,

                    /// `--full-time`
                    /// Like -l --time-style=full-iso
                    full_time: bool = false,

                    /// `-g`
                    /// Like -l, but do not list owner
                    no_owner: bool = false,

                    /// `--group-directories-first`
                    /// Group directories before files
                    group_directories_first: bool = false,

                    /// `-G`, `--no-group`
                    /// In a long listing, don't print group names
                    no_group: bool = false,

                    /// `-h`, `--human-readable`
                    /// With -l and -s, print sizes like 1K 234M 2G etc.
                    human_readable: bool = false,

                    /// `--si`
                    /// Use powers of 1000 not 1024 for sizes
                    si_units: bool = false,

                    /// `-H`, `--dereference-command-line`
                    /// Follow symbolic links listed on the command line
                    dereference_cmd_symlinks: bool = false,

                    /// `--dereference-command-line-symlink-to-dir`
                    /// Follow each command line symbolic link that points to a directory
                    dereference_cmd_dir_symlinks: bool = false,

                    /// `--hide=PATTERN`
                    /// Do not list entries matching shell PATTERN
                    hide_pattern: ?[]const u8 = null,

                    /// `--hyperlink[=WHEN]`
                    /// Hyperlink file names; WHEN can be 'always', 'auto', or 'never'
                    hyperlink: ?[]const u8 = null,

                    /// `--indicator-style=WORD`
                    /// Append indicator with style to entry names: 'none', 'slash', 'file-type', 'classify'
                    indicator_style: ?[]const u8 = null,

                    /// `-i`, `--inode`
                    /// Print the index number of each file
                    show_inode: bool = false,

                    /// `-I`, `--ignore=PATTERN`
                    /// Do not list entries matching shell PATTERN
                    ignore_pattern: ?[]const u8 = null,

                    /// `-k`, `--kibibytes`
                    /// Default to 1024-byte blocks for file system usage
                    kibibytes: bool = false,

                    /// `-l`
                    /// Use a long listing format
                    long_listing: bool = false,

                    /// `-L`, `--dereference`
                    /// Show information for the file the symbolic link references
                    dereference: bool = false,

                    /// `-m`
                    /// Fill width with a comma separated list of entries
                    comma_separated: bool = false,

                    /// `-n`, `--numeric-uid-gid`
                    /// Like -l, but list numeric user and group IDs
                    numeric_uid_gid: bool = false,

                    /// `-N`, `--literal`
                    /// Print entry names without quoting
                    literal: bool = false,

                    /// `-o`
                    /// Like -l, but do not list group information
                    no_group_info: bool = false,

                    /// `-p`, `--indicator-style=slash`
                    /// Append / indicator to directories
                    slash_indicator: bool = false,

                    /// `-q`, `--hide-control-chars`
                    /// Print ? instead of nongraphic characters
                    hide_control_chars: bool = false,

                    /// `--show-control-chars`
                    /// Show nongraphic characters as-is
                    show_control_chars: bool = false,

                    /// `-Q`, `--quote-name`
                    /// Enclose entry names in double quotes
                    quote_name: bool = false,

                    /// `--quoting-style=WORD`
                    /// Use quoting style for entry names
                    quoting_style: ?[]const u8 = null,

                    /// `-r`, `--reverse`
                    /// Reverse order while sorting
                    reverse_order: bool = false,

                    /// `-R`, `--recursive`
                    /// List subdirectories recursively
                    recursive: bool = false,

                    /// `-s`, `--size`
                    /// Print the allocated size of each file, in blocks
                    show_size: bool = false,

                    /// `-S`
                    /// Sort by file size, largest first
                    sort_by_size: bool = false,

                    /// `--sort=WORD`
                    /// Sort by a specified attribute
                    sort_method: ?[]const u8 = null,

                    /// `--time=WORD`
                    /// Select which timestamp to use for display or sorting
                    time_method: ?[]const u8 = null,

                    /// `--time-style=TIME_STYLE`
                    /// Time/date format with -l
                    time_style: ?[]const u8 = null,

                    /// `-t`
                    /// Sort by time, newest first
                    sort_by_time: bool = false,

                    /// `-T`, `--tabsize=COLS`
                    /// Assume tab stops at each specified number of columns
                    tabsize: ?usize = null,

                    /// `-u`
                    /// Sort by, and show, access time
                    use_atime: bool = false,

                    /// `-U`
                    /// Do not sort; list entries in directory order
                    no_sort: bool = false,

                    /// `-v`
                    /// Natural sort of (version) numbers within text
                    natural_sort: bool = false,

                    /// `-w`, `--width=COLS`
                    /// Set output width to specified number of columns
                    output_width: ?usize = null,

                    /// `-x`
                    /// List entries by lines instead of by columns
                    list_by_lines: bool = false,

                    /// `-X`
                    /// Sort alphabetically by entry extension
                    sort_by_extension: bool = false,

                    /// `-Z`, `--context`
                    /// Print any security context of each file
                    show_context: bool = false,

                    /// `--zero`
                    /// End each output line with NUL, not newline
                    end_with_nul: bool = false,

                    /// `-1`
                    /// List one file per line
                    one_file_per_line: bool = false,

                    /// `--help`
                    /// Display help and exit
                    show_help: bool = false,

                    /// `--version`
                    /// Output version information and exit
                    show_version: bool = false,

                    /// Custom parse error for invalid options
                    const ParseError = union(enum) {
                        illegal_option: []const u8,
                        show_usage,
                    };
                };

                pub fn parseOpts(this: *Ls) Result(?[]const [*:0]const u8, Opts.ParseError) {
                    return this.parseFlags();
                }

                pub fn parseFlags(this: *Ls) Result(?[]const [*:0]const u8, Opts.ParseError) {
                    const args = this.bltn.argsSlice();
                    var idx: usize = 0;
                    if (args.len == 0) {
                        return .{ .ok = null };
                    }

                    while (idx < args.len) : (idx += 1) {
                        const flag = args[idx];
                        switch (this.parseFlag(flag[0..std.mem.len(flag)])) {
                            .done => {
                                const filepath_args = args[idx..];
                                return .{ .ok = filepath_args };
                            },
                            .continue_parsing => {},
                            .illegal_option => |opt_str| return .{ .err = .{ .illegal_option = opt_str } },
                        }
                    }

                    return .{ .err = .show_usage };
                }

                pub fn parseFlag(this: *Ls, flag: []const u8) union(enum) { continue_parsing, done, illegal_option: []const u8 } {
                    if (flag.len == 0) return .done;
                    if (flag[0] != '-') return .done;

                    // FIXME windows
                    if (flag.len == 1) return .{ .illegal_option = "-" };

                    const small_flags = flag[1..];
                    for (small_flags) |char| {
                        switch (char) {
                            'a' => {
                                this.opts.show_all = true;
                            },
                            'A' => {
                                this.opts.show_almost_all = true;
                            },
                            'b' => {
                                this.opts.escape = true;
                            },
                            'B' => {
                                this.opts.ignore_backups = true;
                            },
                            'c' => {
                                this.opts.use_ctime = true;
                            },
                            'C' => {
                                this.opts.list_by_columns = true;
                            },
                            'd' => {
                                this.opts.list_directories = true;
                            },
                            'D' => {
                                this.opts.dired_mode = true;
                            },
                            'f' => {
                                this.opts.unsorted = true;
                            },
                            'F' => {
                                this.opts.classify = "always";
                            },
                            'g' => {
                                this.opts.no_owner = true;
                            },
                            'G' => {
                                this.opts.no_group = true;
                            },
                            'h' => {
                                this.opts.human_readable = true;
                            },
                            'H' => {
                                this.opts.dereference_cmd_symlinks = true;
                            },
                            'i' => {
                                this.opts.show_inode = true;
                            },
                            'I' => {
                                this.opts.ignore_pattern = ""; // This will require additional logic to handle patterns
                            },
                            'k' => {
                                this.opts.kibibytes = true;
                            },
                            'l' => {
                                this.opts.long_listing = true;
                            },
                            'L' => {
                                this.opts.dereference = true;
                            },
                            'm' => {
                                this.opts.comma_separated = true;
                            },
                            'n' => {
                                this.opts.numeric_uid_gid = true;
                            },
                            'N' => {
                                this.opts.literal = true;
                            },
                            'o' => {
                                this.opts.no_group_info = true;
                            },
                            'p' => {
                                this.opts.slash_indicator = true;
                            },
                            'q' => {
                                this.opts.hide_control_chars = true;
                            },
                            'Q' => {
                                this.opts.quote_name = true;
                            },
                            'r' => {
                                this.opts.reverse_order = true;
                            },
                            'R' => {
                                this.opts.recursive = true;
                            },
                            's' => {
                                this.opts.show_size = true;
                            },
                            'S' => {
                                this.opts.sort_by_size = true;
                            },
                            't' => {
                                this.opts.sort_by_time = true;
                            },
                            'T' => {
                                this.opts.tabsize = 8; // Default tab size, needs additional handling for custom sizes
                            },
                            'u' => {
                                this.opts.use_atime = true;
                            },
                            'U' => {
                                this.opts.no_sort = true;
                            },
                            'v' => {
                                this.opts.natural_sort = true;
                            },
                            'w' => {
                                this.opts.output_width = 0; // Default to no limit, needs additional handling for custom widths
                            },
                            'x' => {
                                this.opts.list_by_lines = true;
                            },
                            'X' => {
                                this.opts.sort_by_extension = true;
                            },
                            'Z' => {
                                this.opts.show_context = true;
                            },
                            '1' => {
                                this.opts.one_file_per_line = true;
                            },
                            else => {
                                return .{ .illegal_option = flag[1..2] };
                            },
                        }
                    }

                    return .continue_parsing;
                }
            };

            pub const Mv = struct {
                bltn: *Builtin,
                opts: Opts = .{},
                args: struct {
                    sources: []const [*:0]const u8 = &[_][*:0]const u8{},
                    target: [:0]const u8 = &[0:0]u8{},
                    target_fd: ?bun.FileDescriptor = null,
                } = .{},
                state: union(enum) {
                    idle,
                    check_target: struct {
                        task: ShellMvCheckTargetTask,
                        state: union(enum) {
                            running,
                            done,
                        },
                    },
                    executing: struct {
                        task_count: usize,
                        tasks_done: usize = 0,
                        error_signal: std.atomic.Value(bool),
                        tasks: []ShellMvBatchedTask,
                        err: ?Syscall.Error = null,
                    },
                    done,
                    waiting_write_err: struct {
                        writer: BufferedWriter,
                        exit_code: ExitCode,
                    },
                    err: Syscall.Error,
                } = .idle,

                pub const ShellMvCheckTargetTask = struct {
                    const print = bun.Output.scoped(.MvCheckTargetTask, false);
                    mv: *Mv,

                    cwd: bun.FileDescriptor,
                    target: [:0]const u8,
                    result: ?Maybe(?bun.FileDescriptor) = null,

                    task: shell.eval.ShellTask(@This(), EventLoopKind, runFromThreadPool, runFromMainThread, print),

                    pub fn runFromThreadPool(this: *@This()) void {
                        const fd = switch (Syscall.openat(this.cwd, this.target, os.O.RDONLY | os.O.DIRECTORY, 0)) {
                            .err => |e| {
                                switch (e.getErrno()) {
                                    bun.C.E.NOTDIR => {
                                        this.result = .{ .result = null };
                                    },
                                    else => {
                                        this.result = .{ .err = e };
                                    },
                                }
                                return;
                            },
                            .result => |fd| fd,
                        };
                        this.result = .{ .result = fd };
                    }

                    pub fn runFromMainThread(this: *@This()) void {
                        this.mv.checkTargetTaskDone(this);
                    }

                    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
                        this.runFromMainThread();
                    }
                };

                pub const ShellMvBatchedTask = struct {
                    const BATCH_SIZE = 5;
                    const print = bun.Output.scoped(.MvBatchedTask, false);

                    mv: *Mv,
                    sources: []const [*:0]const u8,
                    target: [:0]const u8,
                    target_fd: ?bun.FileDescriptor,
                    cwd: bun.FileDescriptor,
                    error_signal: *std.atomic.Value(bool),

                    err: ?Syscall.Error = null,

                    task: shell.eval.ShellTask(@This(), EventLoopKind, runFromThreadPool, runFromMainThread, print),

                    pub fn runFromThreadPool(this: *@This()) void {
                        // Moving multiple entries into a directory
                        if (this.sources.len > 1) return this.moveMultipleIntoDir();

                        const src = this.sources[0][0..std.mem.len(this.sources[0]) :0];
                        // Moving entry into directory
                        if (this.target_fd) |fd| {
                            _ = fd;

                            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                            _ = this.moveInDir(src, &buf);
                            return;
                        }

                        switch (Syscall.renameat(this.cwd, src, this.cwd, this.target)) {
                            .err => |e| {
                                this.err = e;
                            },
                            else => {},
                        }
                    }

                    pub fn moveInDir(this: *@This(), src: [:0]const u8, buf: *[bun.MAX_PATH_BYTES]u8) bool {
                        var fixed_alloc = std.heap.FixedBufferAllocator.init(buf[0..bun.MAX_PATH_BYTES]);

                        const path_in_dir = std.fs.path.joinZ(fixed_alloc.allocator(), &[_][]const u8{
                            "./",
                            ResolvePath.basename(src),
                        }) catch {
                            this.err = Syscall.Error.fromCode(bun.C.E.NAMETOOLONG, .rename);
                            return false;
                        };

                        switch (Syscall.renameat(this.cwd, src, this.target_fd.?, path_in_dir)) {
                            .err => |e| {
                                const target_path = ResolvePath.joinZ(&[_][]const u8{
                                    this.target,
                                    ResolvePath.basename(src),
                                }, .auto);

                                this.err = e.withPath(bun.default_allocator.dupeZ(u8, target_path[0..]) catch bun.outOfMemory());
                                return false;
                            },
                            else => {},
                        }

                        return true;
                    }

                    fn moveMultipleIntoDir(this: *@This()) void {
                        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                        var fixed_alloc = std.heap.FixedBufferAllocator.init(buf[0..bun.MAX_PATH_BYTES]);

                        for (this.sources) |src_raw| {
                            if (this.error_signal.load(.SeqCst)) return;
                            defer fixed_alloc.reset();

                            const src = src_raw[0..std.mem.len(src_raw) :0];
                            if (!this.moveInDir(src, &buf)) {
                                return;
                            }
                        }
                    }

                    /// From the man pages of `mv`:
                    /// ```txt
                    /// As the rename(2) call does not work across file systems, mv uses cp(1) and rm(1) to accomplish the move.  The effect is equivalent to:
                    ///     rm -f destination_path && \
                    ///     cp -pRP source_file destination && \
                    ///     rm -rf source_file
                    /// ```
                    fn moveAcrossFilesystems(this: *@This(), src: [:0]const u8, dest: [:0]const u8) void {
                        _ = this;
                        _ = src;
                        _ = dest;

                        // TODO
                    }

                    pub fn runFromMainThread(this: *@This()) void {
                        this.mv.batchedMoveTaskDone(this);
                    }

                    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
                        this.runFromMainThread();
                    }
                };

                pub fn start(this: *Mv) Maybe(void) {
                    return this.next();
                }

                pub fn writeFailingError(this: *Mv, buf: []const u8, exit_code: ExitCode) Maybe(void) {
                    if (this.bltn.stderr.needsIO()) {
                        this.state = .{
                            .waiting_write_err = .{
                                .writer = BufferedWriter{
                                    .fd = this.bltn.stderr.expectFd(),
                                    .remain = buf,
                                    .parent = BufferedWriter.ParentPtr.init(this),
                                    .bytelist = this.bltn.stdBufferedBytelist(.stderr),
                                },
                                .exit_code = exit_code,
                            },
                        };
                        this.state.waiting_write_err.writer.writeIfPossible(false);
                        return Maybe(void).success;
                    }

                    if (this.bltn.writeNoIO(.stderr, buf).asErr()) |e| {
                        return .{ .err = e };
                    }

                    this.bltn.done(exit_code);
                    return Maybe(void).success;
                }

                pub fn next(this: *Mv) Maybe(void) {
                    while (!(this.state == .done or this.state == .err)) {
                        switch (this.state) {
                            .idle => {
                                if (this.parseOpts().asErr()) |e| {
                                    const buf = switch (e) {
                                        .illegal_option => |opt_str| this.bltn.fmtErrorArena(.mv, "illegal option -- {s}\n", .{opt_str}),
                                        .show_usage => Builtin.Kind.mv.usageString(),
                                    };

                                    return this.writeFailingError(buf, 1);
                                }
                                this.state = .{
                                    .check_target = .{
                                        .task = ShellMvCheckTargetTask{
                                            .mv = this,
                                            .cwd = this.bltn.parentCmd().base.shell.cwd_fd,
                                            .target = this.args.target,
                                            .task = .{
                                                // .event_loop = JSC.VirtualMachine.get().eventLoop(),
                                                .event_loop = event_loop_ref.get(),
                                            },
                                        },
                                        .state = .running,
                                    },
                                };
                                this.state.check_target.task.task.schedule();
                                return Maybe(void).success;
                            },
                            .check_target => {
                                if (this.state.check_target.state == .running) return Maybe(void).success;
                                const check_target = &this.state.check_target;

                                if (comptime bun.Environment.allow_assert) {
                                    std.debug.assert(check_target.task.result != null);
                                }

                                const maybe_fd: ?bun.FileDescriptor = switch (check_target.task.result.?) {
                                    .err => |e| brk: {
                                        defer bun.default_allocator.free(e.path);
                                        switch (e.getErrno()) {
                                            bun.C.E.NOENT => {
                                                // Means we are renaming entry, not moving to a directory
                                                if (this.args.sources.len == 1) break :brk null;

                                                const buf = this.bltn.fmtErrorArena(.mv, "{s}: No such file or directory\n", .{this.args.target});
                                                return this.writeFailingError(buf, 1);
                                            },
                                            else => {
                                                const sys_err = e.toSystemError();
                                                const buf = this.bltn.fmtErrorArena(.mv, "{s}: {s}\n", .{ sys_err.path.byteSlice(), sys_err.message.byteSlice() });
                                                return this.writeFailingError(buf, 1);
                                            },
                                        }
                                    },
                                    .result => |maybe_fd| maybe_fd,
                                };

                                // Trying to move multiple files into a file
                                if (maybe_fd == null and this.args.sources.len > 1) {
                                    const buf = this.bltn.fmtErrorArena(.mv, "{s} is not a directory\n", .{this.args.target});
                                    return this.writeFailingError(buf, 1);
                                }

                                const task_count = brk: {
                                    const sources_len: f64 = @floatFromInt(this.args.sources.len);
                                    const batch_size: f64 = @floatFromInt(ShellMvBatchedTask.BATCH_SIZE);
                                    const task_count: usize = @intFromFloat(@ceil(sources_len / batch_size));
                                    break :brk task_count;
                                };

                                this.args.target_fd = maybe_fd;
                                const cwd_fd = this.bltn.parentCmd().base.shell.cwd_fd;
                                const tasks = this.bltn.arena.allocator().alloc(ShellMvBatchedTask, task_count) catch bun.outOfMemory();
                                // Initialize tasks
                                {
                                    var count = task_count;
                                    const count_per_task = this.args.sources.len / ShellMvBatchedTask.BATCH_SIZE;
                                    var i: usize = 0;
                                    var j: usize = 0;
                                    while (i < tasks.len -| 1) : (i += 1) {
                                        j += count_per_task;
                                        const sources = this.args.sources[j .. j + count_per_task];
                                        count -|= count_per_task;
                                        tasks[i] = ShellMvBatchedTask{
                                            .mv = this,
                                            .cwd = cwd_fd,
                                            .target = this.args.target,
                                            .target_fd = this.args.target_fd,
                                            .sources = sources,
                                            // We set this later
                                            .error_signal = undefined,
                                            .task = .{
                                                .event_loop = event_loop_ref.get(),
                                            },
                                        };
                                    }

                                    // Give remainder to last task
                                    if (count > 0) {
                                        const sources = this.args.sources[j .. j + count];
                                        tasks[i] = ShellMvBatchedTask{
                                            .mv = this,
                                            .cwd = cwd_fd,
                                            .target = this.args.target,
                                            .target_fd = this.args.target_fd,
                                            .sources = sources,
                                            // We set this later
                                            .error_signal = undefined,
                                            .task = .{
                                                .event_loop = event_loop_ref.get(),
                                            },
                                        };
                                    }
                                }

                                this.state = .{
                                    .executing = .{
                                        .task_count = task_count,
                                        .error_signal = std.atomic.Value(bool).init(false),
                                        .tasks = tasks,
                                    },
                                };

                                for (this.state.executing.tasks) |*t| {
                                    t.error_signal = &this.state.executing.error_signal;
                                    t.task.schedule();
                                }

                                return Maybe(void).success;
                            },
                            .executing => {
                                const exec = &this.state.executing;
                                _ = exec;
                                // if (exec.state == .idle) {
                                //     // 1. Check if target is directory or file
                                // }
                            },
                            .waiting_write_err => {
                                return Maybe(void).success;
                            },
                            .done, .err => unreachable,
                        }
                    }

                    if (this.state == .done) {
                        this.bltn.done(0);
                        return Maybe(void).success;
                    }

                    this.bltn.done(this.state.err.errno);
                    return Maybe(void).success;
                }

                pub fn onBufferedWriterDone(this: *Mv, e: ?Syscall.Error) void {
                    switch (this.state) {
                        .waiting_write_err => {
                            if (e != null) {
                                this.state.err = e.?;
                                _ = this.next();
                                return;
                            }
                            this.bltn.done(this.state.waiting_write_err.exit_code);
                            return;
                        },
                        else => @panic("Invalid state"),
                    }
                }

                pub fn checkTargetTaskDone(this: *Mv, task: *ShellMvCheckTargetTask) void {
                    _ = task;

                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(this.state == .check_target);
                        std.debug.assert(this.state.check_target.task.result != null);
                    }

                    this.state.check_target.state = .done;
                    _ = this.next();
                    return;
                }

                pub fn batchedMoveTaskDone(this: *Mv, task: *ShellMvBatchedTask) void {
                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(this.state == .executing);
                        std.debug.assert(this.state.executing.tasks_done < this.state.executing.task_count);
                    }

                    var exec = &this.state.executing;

                    if (task.err) |err| {
                        exec.error_signal.store(true, .SeqCst);
                        if (exec.err == null) {
                            exec.err = err;
                        } else {
                            bun.default_allocator.free(err.path);
                        }
                    }

                    exec.tasks_done += 1;
                    if (exec.tasks_done >= exec.task_count) {
                        if (exec.err) |err| {
                            const buf = this.bltn.fmtErrorArena(.ls, "{s}\n", .{err.toSystemError().message.byteSlice()});
                            _ = this.writeFailingError(buf, err.errno);
                            return;
                        }
                        this.state = .done;

                        _ = this.next();
                        return;
                    }
                }

                pub fn deinit(this: *Mv) void {
                    if (this.args.target_fd != null and this.args.target_fd.? != bun.invalid_fd) {
                        _ = Syscall.close(this.args.target_fd.?);
                    }
                }

                const Opts = struct {
                    /// `-f`
                    ///
                    /// Do not prompt for confirmation before overwriting the destination path.  (The -f option overrides any previous -i or -n options.)
                    force_overwrite: bool = true,
                    /// `-h`
                    ///
                    /// If the target operand is a symbolic link to a directory, do not follow it.  This causes the mv utility to rename the file source to the destination path target rather than moving source into the
                    /// directory referenced by target.
                    no_dereference: bool = false,
                    /// `-i`
                    ///
                    /// Cause mv to write a prompt to standard error before moving a file that would overwrite an existing file.  If the response from the standard input begins with the character ‘y’ or ‘Y’, the move is
                    /// attempted.  (The -i option overrides any previous -f or -n options.)
                    interactive_mode: bool = false,
                    /// `-n`
                    ///
                    /// Do not overwrite an existing file.  (The -n option overrides any previous -f or -i options.)
                    no_overwrite: bool = false,
                    /// `-v`
                    ///
                    /// Cause mv to be verbose, showing files after they are moved.
                    verbose_output: bool = false,

                    const ParseError = union(enum) {
                        illegal_option: []const u8,
                        show_usage,
                    };
                };

                pub fn parseOpts(this: *Mv) Result(void, Opts.ParseError) {
                    const filepath_args = switch (this.parseFlags()) {
                        .ok => |args| args,
                        .err => |e| return .{ .err = e },
                    };

                    if (filepath_args.len < 2) {
                        return .{ .err = .show_usage };
                    }

                    this.args.sources = filepath_args[0 .. filepath_args.len - 1];
                    this.args.target = filepath_args[filepath_args.len - 1][0..std.mem.len(filepath_args[filepath_args.len - 1]) :0];

                    return .ok;
                }

                pub fn parseFlags(this: *Mv) Result([]const [*:0]const u8, Opts.ParseError) {
                    const args = this.bltn.argsSlice();
                    var idx: usize = 0;
                    if (args.len == 0) {
                        return .{ .err = .show_usage };
                    }

                    while (idx < args.len) : (idx += 1) {
                        const flag = args[idx];
                        switch (this.parseFlag(flag[0..std.mem.len(flag)])) {
                            .done => {
                                const filepath_args = args[idx..];
                                return .{ .ok = filepath_args };
                            },
                            .continue_parsing => {},
                            .illegal_option => |opt_str| return .{ .err = .{ .illegal_option = opt_str } },
                        }
                    }

                    return .{ .err = .show_usage };
                }

                pub fn parseFlag(this: *Mv, flag: []const u8) union(enum) { continue_parsing, done, illegal_option: []const u8 } {
                    if (flag.len == 0) return .done;
                    if (flag[0] != '-') return .done;

                    const small_flags = flag[1..];
                    for (small_flags) |char| {
                        switch (char) {
                            'f' => {
                                this.opts.force_overwrite = true;
                                this.opts.interactive_mode = false;
                                this.opts.no_overwrite = false;
                            },
                            'h' => {
                                this.opts.no_dereference = true;
                            },
                            'i' => {
                                this.opts.interactive_mode = true;
                                this.opts.force_overwrite = false;
                                this.opts.no_overwrite = false;
                            },
                            'n' => {
                                this.opts.no_overwrite = true;
                                this.opts.force_overwrite = false;
                                this.opts.interactive_mode = false;
                            },
                            'v' => {
                                this.opts.verbose_output = true;
                            },
                            else => {
                                return .{ .illegal_option = "-" };
                            },
                        }
                    }

                    return .continue_parsing;
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
                        // task: RmTask,
                        filepath_args: []const [*:0]const u8,
                        total_tasks: usize,
                        err: ?Syscall.Error = null,
                        lock: std.Thread.Mutex = std.Thread.Mutex{},
                        error_signal: std.atomic.Value(bool) = .{ .raw = false },
                        output_queue: std.DoublyLinkedList(BlockingOutput) = .{},
                        output_done: std.atomic.Value(usize) = .{ .raw = 0 },
                        output_count: std.atomic.Value(usize) = .{ .raw = 0 },
                        state: union(enum) {
                            idle,
                            waiting: struct {
                                tasks_done: usize = 0,
                            },

                            pub fn tasksDone(this: *@This()) usize {
                                return switch (this.*) {
                                    .idle => 0,
                                    .waiting => this.waiting.tasks_done,
                                };
                            }
                        },

                        fn incrementOutputCount(this: *@This(), comptime thevar: @Type(.EnumLiteral)) void {
                            @fence(.SeqCst);
                            var atomicvar = &@field(this, @tagName(thevar));
                            const result = atomicvar.fetchAdd(1, .SeqCst);
                            log("[rm] {s}: {d} + 1", .{ @tagName(thevar), result });
                            return;
                        }

                        fn getOutputCount(this: *@This(), comptime thevar: @Type(.EnumLiteral)) usize {
                            @fence(.SeqCst);
                            var atomicvar = &@field(this, @tagName(thevar));
                            return atomicvar.load(.SeqCst);
                        }
                    },
                    done: struct { exit_code: ExitCode },
                    err: Syscall.Error,
                } = .idle,

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
                };

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
                                                        .fd = this.bltn.stderr.expectFd(),
                                                        .remain = error_string,
                                                        .parent = BufferedWriter.ParentPtr.init(this),
                                                        .bytelist = this.bltn.stdBufferedBytelist(.stderr),
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

                                        switch (parseFlag(&this.opts, this.bltn, arg)) {
                                            .continue_parsing => {
                                                parse_opts.idx += 1;
                                                continue;
                                            },
                                            .done => {
                                                if (this.opts.recursive) {
                                                    this.opts.remove_empty_dirs = true;
                                                }

                                                if (this.opts.prompt_behaviour != .never) {
                                                    const buf = "rm: \"-i\" is not supported yet";
                                                    if (this.bltn.stderr.needsIO()) {
                                                        parse_opts.state = .{
                                                            .wait_write_err = BufferedWriter{
                                                                .fd = this.bltn.stderr.expectFd(),
                                                                .remain = buf,
                                                                .parent = BufferedWriter.ParentPtr.init(this),
                                                                .bytelist = this.bltn.stdBufferedBytelist(.stderr),
                                                            },
                                                        };
                                                        parse_opts.state.wait_write_err.writeIfPossible(false);
                                                        continue;
                                                    }

                                                    if (this.bltn.writeNoIO(.stderr, buf).asErr()) |e|
                                                        return Maybe(void).initErr(e);

                                                    this.bltn.done(1);
                                                    return Maybe(void).success;
                                                }

                                                const filepath_args_start = idx;
                                                const filepath_args = parse_opts.args_slice[filepath_args_start..];

                                                // Check that non of the paths will delete the root
                                                {
                                                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                                                    const cwd = switch (Syscall.getcwd(&buf)) {
                                                        .err => |err| {
                                                            return .{ .err = err };
                                                        },
                                                        .result => |cwd| cwd,
                                                    };

                                                    for (filepath_args) |filepath| {
                                                        const path = filepath[0..bun.len(filepath)];
                                                        const resolved_path = if (ResolvePath.Platform.auto.isAbsolute(path)) path else bun.path.join(&[_][]const u8{ cwd, path }, .auto);
                                                        const is_root = brk: {
                                                            const normalized = bun.path.normalizeString(resolved_path, false, .auto);
                                                            const dirname = ResolvePath.dirname(normalized, .auto);
                                                            const is_root = std.mem.eql(u8, dirname, "");
                                                            break :brk is_root;
                                                        };

                                                        if (is_root) {
                                                            const error_string = this.bltn.fmtErrorArena(.rm, "\"{s}\" may not be removed\n", .{resolved_path});
                                                            if (this.bltn.stderr.needsIO()) {
                                                                parse_opts.state = .{
                                                                    .wait_write_err = BufferedWriter{
                                                                        .fd = this.bltn.stderr.expectFd(),
                                                                        .remain = error_string,
                                                                        .parent = BufferedWriter.ParentPtr.init(this),
                                                                        .bytelist = this.bltn.stdBufferedBytelist(.stderr),
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
                                                    }
                                                }

                                                const total_tasks = filepath_args.len;
                                                this.state = .{
                                                    .exec = .{
                                                        .filepath_args = filepath_args,
                                                        .total_tasks = total_tasks,
                                                        .state = .idle,
                                                        .output_done = std.atomic.Value(usize).init(0),
                                                        .output_count = std.atomic.Value(usize).init(0),
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
                                                            .fd = this.bltn.stderr.expectFd(),
                                                            .remain = error_string,
                                                            .parent = BufferedWriter.ParentPtr.init(this),
                                                            .bytelist = this.bltn.stdBufferedBytelist(.stderr),
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
                                                            .fd = this.bltn.stderr.expectFd(),
                                                            .remain = error_string,
                                                            .parent = BufferedWriter.ParentPtr.init(this),
                                                            .bytelist = this.bltn.stdBufferedBytelist(.stderr),
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
                                            this.state = .{ .done = .{ .exit_code = 0 } };
                                            continue;
                                        }

                                        // yield execution to continue writing
                                        return Maybe(void).success;
                                    },
                                }
                            },
                            .exec => {
                                const cwd = this.bltn.parentCmd().base.shell.cwd_fd;
                                // Schedule task
                                if (this.state.exec.state == .idle) {
                                    this.state.exec.state = .{ .waiting = .{} };
                                    for (this.state.exec.filepath_args) |root_raw| {
                                        const root = root_raw[0..std.mem.len(root_raw)];
                                        const root_path_string = bun.PathString.init(root[0..root.len]);
                                        const is_absolute = ResolvePath.Platform.auto.isAbsolute(root);
                                        var task = ShellRmTask.create(root_path_string, this, cwd, &this.state.exec.error_signal, is_absolute);
                                        task.schedule();
                                        // task.
                                    }
                                }

                                // do nothing
                                return Maybe(void).success;
                            },
                            .done, .err => unreachable,
                        }
                    }

                    if (this.state == .done) {
                        this.bltn.done(0);
                        return Maybe(void).success;
                    }

                    if (this.state == .err) {
                        this.bltn.done(this.state.err.errno);
                        return Maybe(void).success;
                    }

                    return Maybe(void).success;
                }

                pub fn onBufferedWriterDone(this: *Rm, e: ?Syscall.Error) void {
                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert((this.state == .parse_opts and this.state.parse_opts.state == .wait_write_err) or
                            (this.state == .exec and this.state.exec.state == .waiting and this.state.exec.output_queue.len > 0));
                    }

                    if (this.state == .exec and this.state.exec.state == .waiting) {
                        log("[rm] output done={d} output count={d}", .{ this.state.exec.getOutputCount(.output_done), this.state.exec.getOutputCount(.output_count) });
                        this.state.exec.incrementOutputCount(.output_done);
                        // _ = this.state.exec.output_done.fetchAdd(1, .Monotonic);
                        var queue = &this.state.exec.output_queue;
                        var first = queue.popFirst().?;
                        defer {
                            first.data.deinit();
                            bun.default_allocator.destroy(first);
                        }
                        if (first.next) |next_writer| {
                            next_writer.data.writer.writeIfPossible(false);
                        } else {
                            if (this.state.exec.state.tasksDone() >= this.state.exec.total_tasks and this.state.exec.getOutputCount(.output_done) >= this.state.exec.getOutputCount(.output_count)) {
                                this.bltn.done(if (this.state.exec.err != null) 1 else 0);
                                return;
                            }
                        }
                        return;
                    }

                    if (e != null) {
                        this.state = .{ .err = e.? };
                        this.bltn.done(e.?.errno);
                        return;
                    }

                    this.bltn.done(1);
                    return;
                }

                pub fn writeToStdoutFromAsyncTask(this: *Rm, comptime fmt: []const u8, args: anytype) Maybe(void) {
                    const buf = this.rm.bltn.fmtErrorArena(null, fmt, args);
                    if (!this.rm.bltn.stdout.needsIO()) {
                        this.state.exec.lock.lock();
                        defer this.state.exec.lock.unlock();
                        return switch (this.rm.bltn.writeNoIO(.stdout, buf)) {
                            .result => Maybe(void).success,
                            .err => |e| Maybe(void).initErr(e),
                        };
                    }

                    var written: usize = 0;
                    while (written < buf.len) : (written += switch (Syscall.write(this.rm.bltn.stdout.fd, buf)) {
                        .err => |e| return Maybe(void).initErr(e),
                        .result => |n| n,
                    }) {}

                    return Maybe(void).success;
                }

                pub fn deinit(this: *Rm) void {
                    _ = this;
                }

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

                pub fn onAsyncTaskDone(this: *Rm, task: *ShellRmTask) void {
                    var exec = &this.state.exec;
                    const tasks_done = switch (exec.state) {
                        .idle => @panic("Invalid state"),
                        .waiting => brk: {
                            exec.state.waiting.tasks_done += 1;
                            const amt = exec.state.waiting.tasks_done;
                            if (task.err) |err| {
                                exec.err = err;
                                const error_string = this.bltn.taskErrorToString(.rm, err);
                                if (!this.bltn.stderr.needsIO()) {
                                    if (this.bltn.writeNoIO(.stderr, error_string).asErr()) |e| {
                                        global_handle.get().actuallyThrow(bun.shell.ShellErr.newSys(e));
                                        return;
                                    }
                                } else {
                                    const bo = BlockingOutput{
                                        .writer = BufferedWriter{
                                            .fd = this.bltn.stderr.expectFd(),
                                            .remain = error_string,
                                            .parent = BufferedWriter.ParentPtr.init(this),
                                            .bytelist = this.bltn.stdBufferedBytelist(.stderr),
                                        },
                                        .arr = std.ArrayList(u8).init(bun.default_allocator),
                                    };
                                    exec.incrementOutputCount(.output_count);
                                    // _ = exec.output_count.fetchAdd(1, .Monotonic);
                                    return this.queueBlockingOutput(bo);
                                }
                            }
                            break :brk amt;
                        },
                    };

                    // Wait until all tasks done and all output is written
                    if (tasks_done >= this.state.exec.total_tasks and
                        exec.getOutputCount(.output_done) >= exec.getOutputCount(.output_count))
                    {
                        this.state = .{ .done = .{ .exit_code = if (exec.err) |theerr| theerr.errno else 0 } };
                        _ = this.next();
                        return;
                    }
                }

                fn writeVerbose(this: *Rm, verbose: *ShellRmTask.DirTask) void {
                    if (!this.bltn.stdout.needsIO()) {
                        if (this.bltn.writeNoIO(.stdout, verbose.deleted_entries.items[0..]).asErr()) |err| {
                            global_handle.get().actuallyThrow(bun.shell.ShellErr.newSys(err));
                            return;
                        }
                        // _ = this.state.exec.output_done.fetchAdd(1, .SeqCst);
                        _ = this.state.exec.incrementOutputCount(.output_done);
                        if (this.state.exec.state.tasksDone() >= this.state.exec.total_tasks and this.state.exec.getOutputCount(.output_done) >= this.state.exec.getOutputCount(.output_count)) {
                            this.bltn.done(if (this.state.exec.err != null) 1 else 0);
                            return;
                        }
                        return;
                    }
                    this.queueBlockingOutput(verbose.toBlockingOutput());
                }

                fn queueBlockingOutput(this: *Rm, bo: BlockingOutput) void {
                    const node = bun.default_allocator.create(std.DoublyLinkedList(BlockingOutput).Node) catch bun.outOfMemory();
                    node.* = .{
                        .data = bo,
                    };

                    this.state.exec.output_queue.append(node);

                    // Need to start it
                    if (this.state.exec.output_queue.len == 1) {
                        this.state.exec.output_queue.first.?.data.writer.writeIfPossible(false);
                    }
                }

                const BlockingOutput = struct {
                    writer: BufferedWriter,
                    arr: std.ArrayList(u8),

                    pub fn deinit(this: *BlockingOutput) void {
                        this.arr.deinit();
                    }
                };

                pub const ShellRmTask = struct {
                    const print = bun.Output.scoped(.AsyncRmTask, false);

                    // const MAX_FDS_OPEN: u8 = 16;

                    rm: *Rm,
                    opts: Opts,

                    cwd: bun.FileDescriptor,

                    root_task: DirTask,
                    root_path: bun.PathString = bun.PathString.empty,
                    root_is_absolute: bool,

                    // fds_opened: u8 = 0,

                    error_signal: *std.atomic.Value(bool),
                    err_mutex: bun.Lock = bun.Lock.init(),
                    err: ?Syscall.Error = null,

                    event_loop: EventLoopRef,
                    concurrent_task: EventLoopTask = .{},
                    task: JSC.WorkPoolTask = .{
                        .callback = workPoolCallback,
                    },

                    const ParentRmTask = @This();

                    pub const DirTask = struct {
                        task_manager: *ParentRmTask,
                        parent_task: ?*DirTask,
                        path: [:0]const u8,
                        subtask_count: std.atomic.Value(usize),
                        need_to_wait: bool = false,
                        kind_hint: EntryKindHint,
                        task: JSC.WorkPoolTask = .{ .callback = runFromThreadPool },
                        deleted_entries: std.ArrayList(u8),
                        concurrent_task: EventLoopTask = .{},

                        const EntryKindHint = enum { idk, dir, file };

                        pub fn toBlockingOutput(this: *DirTask) BlockingOutput {
                            const arr = this.takeDeletedEntries();
                            const bo = BlockingOutput{
                                .arr = arr,
                                .writer = BufferedWriter{
                                    .fd = bun.STDOUT_FD,
                                    .remain = arr.items[0..],
                                    .parent = BufferedWriter.ParentPtr.init(this.task_manager.rm),
                                    .bytelist = this.task_manager.rm.bltn.stdBufferedBytelist(.stdout),
                                },
                            };
                            return bo;
                        }

                        pub fn takeDeletedEntries(this: *DirTask) std.ArrayList(u8) {
                            const ret = this.deleted_entries;
                            this.deleted_entries = std.ArrayList(u8).init(ret.allocator);
                            return ret;
                        }

                        pub fn runFromMainThread(this: *DirTask) void {
                            print("runFromMainThread", .{});
                            this.task_manager.rm.writeVerbose(this);
                        }

                        pub fn runFromMainThreadMini(this: *DirTask, _: *void) void {
                            this.runFromMainThread();
                        }

                        pub fn runFromThreadPool(task: *JSC.WorkPoolTask) void {
                            var this: *DirTask = @fieldParentPtr(DirTask, "task", task);
                            this.runFromThreadPoolImpl();
                        }

                        fn runFromThreadPoolImpl(this: *DirTask) void {
                            defer this.postRun();

                            print("DirTask: {s}", .{this.path});
                            switch (this.task_manager.removeEntry(this, ResolvePath.Platform.auto.isAbsolute(this.path[0..this.path.len]))) {
                                .err => |err| {
                                    print("DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
                                    this.task_manager.err_mutex.lock();
                                    defer this.task_manager.err_mutex.unlock();
                                    if (this.task_manager.err == null) {
                                        this.task_manager.err = err;
                                        this.task_manager.error_signal.store(true, .SeqCst);
                                    } else {
                                        bun.default_allocator.free(err.path);
                                    }
                                },
                                .result => {},
                            }
                        }

                        fn handleErr(this: *DirTask, err: Syscall.Error) void {
                            print("DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
                            this.task_manager.err_mutex.lock();
                            defer this.task_manager.err_mutex.unlock();
                            if (this.task_manager.err == null) {
                                this.task_manager.err = err;
                                this.task_manager.error_signal.store(true, .SeqCst);
                            } else {
                                bun.default_allocator.free(err.path);
                            }
                        }

                        pub fn postRun(this: *DirTask) void {
                            // All entries including recursive directories were deleted
                            if (this.need_to_wait) return;

                            // We have executed all the children of this task
                            if (this.subtask_count.fetchSub(1, .SeqCst) == 1) {
                                defer {
                                    if (this.task_manager.opts.verbose)
                                        this.queueForWrite()
                                    else
                                        this.deinit();
                                }

                                // If we have a parent and we are the last child, now we can delete the parent
                                if (this.parent_task != null and this.parent_task.?.subtask_count.fetchSub(1, .SeqCst) == 2) {
                                    this.parent_task.?.deleteAfterWaitingForChildren();
                                    return;
                                }

                                // Otherwise we are root task
                                this.task_manager.finishConcurrently();
                            }

                            // Otherwise need to wait
                        }

                        pub fn deleteAfterWaitingForChildren(this: *DirTask) void {
                            this.need_to_wait = false;
                            defer this.postRun();
                            if (this.task_manager.error_signal.load(.SeqCst)) {
                                return;
                            }

                            switch (this.task_manager.removeEntryDirAfterChildren(this)) {
                                .err => |e| {
                                    print("DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(e.getErrno()), e.path });
                                    this.task_manager.err_mutex.lock();
                                    defer this.task_manager.err_mutex.unlock();
                                    if (this.task_manager.err == null) {
                                        this.task_manager.err = e;
                                    } else {
                                        bun.default_allocator.free(e.path);
                                    }
                                },
                                .result => {},
                            }
                        }

                        pub fn queueForWrite(this: *DirTask) void {
                            if (this.deleted_entries.items.len == 0) return;
                            if (comptime EventLoopKind == .js) {
                                this.task_manager.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
                            } else {
                                this.task_manager.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, "runFromMainThreadMini"));
                            }
                        }

                        pub fn deinit(this: *DirTask) void {
                            this.deleted_entries.deinit();
                            // The root's path string is from Rm's argv so don't deallocate it
                            // And the root task is actually a field on the struct of the AsyncRmTask so don't deallocate it either
                            if (this.parent_task != null) {
                                bun.default_allocator.free(this.path);
                                bun.default_allocator.destroy(this);
                            }
                        }
                    };

                    pub fn create(root_path: bun.PathString, rm: *Rm, cwd: bun.FileDescriptor, error_signal: *std.atomic.Value(bool), is_absolute: bool) *ShellRmTask {
                        const task = bun.default_allocator.create(ShellRmTask) catch bun.outOfMemory();
                        task.* = ShellRmTask{
                            .rm = rm,
                            .opts = rm.opts,
                            .cwd = cwd,
                            .root_path = root_path,
                            .root_task = DirTask{
                                .task_manager = task,
                                .parent_task = null,
                                .path = root_path.sliceAssumeZ(),
                                .subtask_count = std.atomic.Value(usize).init(1),
                                .kind_hint = .idk,
                                .deleted_entries = std.ArrayList(u8).init(bun.default_allocator),
                            },
                            // .event_loop = JSC.VirtualMachine.get().event_loop,
                            .event_loop = event_loop_ref.get(),
                            .error_signal = error_signal,
                            .root_is_absolute = is_absolute,
                        };
                        return task;
                    }

                    pub fn schedule(this: *@This()) void {
                        JSC.WorkPool.schedule(&this.task);
                    }

                    pub fn enqueue(this: *ShellRmTask, parent_dir: *DirTask, path: [:0]const u8, is_absolute: bool, kind_hint: DirTask.EntryKindHint) void {
                        if (this.error_signal.load(.SeqCst)) {
                            return;
                        }
                        const new_path = this.join(
                            bun.default_allocator,
                            &[_][]const u8{
                                parent_dir.path[0..parent_dir.path.len],
                                path[0..path.len],
                            },
                            is_absolute,
                        );
                        this.enqueueNoJoin(parent_dir, new_path, kind_hint);
                    }

                    pub fn enqueueNoJoin(this: *ShellRmTask, parent_task: *DirTask, path: [:0]const u8, kind_hint: DirTask.EntryKindHint) void {
                        print("enqueue: {s}", .{path});
                        if (this.error_signal.load(.SeqCst)) {
                            return;
                        }

                        // if (this.opts.verbose) {
                        //     // _ = this.rm.state.exec.output_count.fetchAdd(1, .SeqCst);
                        //     _ = this.rm.state.exec.incrementOutputCount(.output_count);
                        // }

                        var subtask = bun.default_allocator.create(DirTask) catch bun.outOfMemory();
                        subtask.* = DirTask{
                            .task_manager = this,
                            .path = path,
                            .parent_task = parent_task,
                            .subtask_count = std.atomic.Value(usize).init(1),
                            .kind_hint = kind_hint,
                            .deleted_entries = std.ArrayList(u8).init(bun.default_allocator),
                        };
                        std.debug.assert(parent_task.subtask_count.fetchAdd(1, .Monotonic) > 0);
                        print("enqueue: {s}", .{path});
                        JSC.WorkPool.schedule(&subtask.task);
                    }

                    pub fn verboseDeleted(this: *@This(), dir_task: *DirTask, path: [:0]const u8) Maybe(void) {
                        print("deleted: {s}", .{path[0..path.len]});
                        if (!this.opts.verbose) return Maybe(void).success;
                        if (dir_task.deleted_entries.items.len == 0) {
                            _ = this.rm.state.exec.incrementOutputCount(.output_count);
                        }
                        dir_task.deleted_entries.appendSlice(path[0..path.len]) catch bun.outOfMemory();
                        dir_task.deleted_entries.append('\n') catch bun.outOfMemory();
                        return Maybe(void).success;
                    }

                    pub fn finishConcurrently(this: *ShellRmTask) void {
                        if (comptime EventLoopKind == .js) {
                            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
                        } else {
                            this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(this, "runFromMainThreadMini"));
                        }
                    }

                    pub fn bufJoin(buf: *[bun.MAX_PATH_BYTES]u8, parts: []const []const u8, syscall_tag: Syscall.Tag) Maybe([:0]u8) {
                        var fixed_buf_allocator = std.heap.FixedBufferAllocator.init(buf[0..]);
                        return .{ .result = std.fs.path.joinZ(fixed_buf_allocator.allocator(), parts) catch return Maybe([:0]u8).initErr(Syscall.Error.fromCode(bun.C.E.NAMETOOLONG, syscall_tag)) };
                    }

                    pub fn removeEntry(this: *ShellRmTask, dir_task: *DirTask, is_absolute: bool) Maybe(void) {
                        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                        switch (dir_task.kind_hint) {
                            .idk, .file => return this.removeEntryFile(dir_task, dir_task.path, is_absolute, &buf, false),
                            .dir => return this.removeEntryDir(dir_task, is_absolute, &buf),
                        }
                    }

                    fn removeEntryDir(this: *ShellRmTask, dir_task: *DirTask, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                        const path = dir_task.path;
                        const dirfd = this.cwd;

                        // If `-d` is specified without `-r` then we can just use `rmdirat`
                        if (this.opts.remove_empty_dirs and !this.opts.recursive) {
                            switch (Syscall.rmdirat(dirfd, path)) {
                                .result => return Maybe(void).success,
                                .err => |e| {
                                    switch (e.getErrno()) {
                                        bun.C.E.NOENT => {
                                            if (this.opts.force) return this.verboseDeleted(dir_task, path);
                                            return .{ .err = this.errorWithPath(e, path) };
                                        },
                                        bun.C.E.NOTDIR => {
                                            return this.removeEntryFile(dir_task, dir_task.path, is_absolute, buf, false);
                                        },
                                        else => return .{ .err = this.errorWithPath(e, path) },
                                    }
                                },
                            }
                        }

                        if (!this.opts.recursive) {
                            return Maybe(void).initErr(Syscall.Error.fromCode(bun.C.E.ISDIR, .TODO).withPath(bun.default_allocator.dupeZ(u8, dir_task.path) catch bun.outOfMemory()));
                        }

                        const flags = os.O.DIRECTORY | os.O.RDONLY;
                        const fd = switch (Syscall.openat(dirfd, path, flags, 0)) {
                            .result => |fd| fd,
                            .err => |e| {
                                switch (e.getErrno()) {
                                    bun.C.E.NOENT => {
                                        if (this.opts.force) return this.verboseDeleted(dir_task, path);
                                        return .{ .err = this.errorWithPath(e, path) };
                                    },
                                    bun.C.E.NOTDIR => {
                                        return this.removeEntryFile(dir_task, dir_task.path, is_absolute, buf, false);
                                    },
                                    else => return .{ .err = this.errorWithPath(e, path) },
                                }
                            },
                        };
                        defer {
                            _ = Syscall.close(fd);
                        }

                        if (this.error_signal.load(.SeqCst)) {
                            return Maybe(void).success;
                        }

                        var iterator = DirIterator.iterate(fd.asDir(), .u8);
                        var entry = iterator.next();

                        var i: usize = 0;
                        while (switch (entry) {
                            .err => |err| {
                                return .{ .err = this.errorWithPath(err, path) };
                            },
                            .result => |ent| ent,
                        }) |current| : (entry = iterator.next()) {
                            // TODO this seems bad maybe better to listen to kqueue/epoll event
                            if (fastMod(i, 4) == 0 and this.error_signal.load(.SeqCst)) return Maybe(void).success;

                            defer i += 1;
                            switch (current.kind) {
                                .directory => {
                                    this.enqueue(dir_task, current.name.sliceAssumeZ(), is_absolute, .dir);
                                },
                                else => {
                                    const name = current.name.sliceAssumeZ();
                                    const file_path = switch (ShellRmTask.bufJoin(
                                        buf,
                                        &[_][]const u8{
                                            path[0..path.len],
                                            name[0..name.len],
                                        },
                                        .unlink,
                                    )) {
                                        .err => |e| return .{ .err = e },
                                        .result => |p| p,
                                    };

                                    switch (this.removeEntryFile(dir_task, file_path, is_absolute, buf, true)) {
                                        .err => |e| return .{ .err = this.errorWithPath(e, current.name.sliceAssumeZ()) },
                                        .result => {},
                                    }
                                },
                            }
                        }

                        // Need to wait for children to finish
                        if (dir_task.subtask_count.load(.SeqCst) > 1) {
                            dir_task.need_to_wait = true;
                            return Maybe(void).success;
                        }

                        if (this.error_signal.load(.SeqCst)) return Maybe(void).success;

                        switch (Syscall.unlinkatWithFlags(dirfd, path, std.os.AT.REMOVEDIR)) {
                            .result => {
                                switch (this.verboseDeleted(dir_task, path)) {
                                    .err => |e| return .{ .err = e },
                                    else => {},
                                }
                                return Maybe(void).success;
                            },
                            .err => |e| {
                                switch (e.getErrno()) {
                                    bun.C.E.NOENT => {
                                        if (this.opts.force) {
                                            switch (this.verboseDeleted(dir_task, path)) {
                                                .err => |e2| return .{ .err = e2 },
                                                else => {},
                                            }
                                            return Maybe(void).success;
                                        }

                                        return .{ .err = this.errorWithPath(e, path) };
                                    },
                                    else => return .{ .err = e },
                                }
                            },
                        }
                    }

                    fn removeEntryDirAfterChildren(this: *ShellRmTask, dir_task: *DirTask) Maybe(void) {
                        const dirfd = bun.toFD(this.cwd);
                        var treat_as_dir = true;
                        const fd: bun.FileDescriptor = handle_entry: while (true) {
                            if (treat_as_dir) {
                                switch (Syscall.openat(dirfd, dir_task.path, os.O.DIRECTORY | os.O.RDONLY, 0)) {
                                    .err => |e| switch (e.getErrno()) {
                                        bun.C.E.NOENT => {
                                            if (this.opts.force) {
                                                if (this.verboseDeleted(dir_task, dir_task.path).asErr()) |e2| return .{ .err = e2 };
                                                return Maybe(void).success;
                                            }
                                            return .{ .err = e };
                                        },
                                        bun.C.E.NOTDIR => {
                                            treat_as_dir = false;
                                            continue;
                                        },
                                        else => return .{ .err = e },
                                    },
                                    .result => |fd| break :handle_entry fd,
                                }
                            } else {
                                if (Syscall.unlinkat(dirfd, dir_task.path).asErr()) |e| {
                                    switch (e.getErrno()) {
                                        bun.C.E.NOENT => {
                                            if (this.opts.force) {
                                                if (this.verboseDeleted(dir_task, dir_task.path).asErr()) |e2| return .{ .err = e2 };
                                                return Maybe(void).success;
                                            }
                                            return .{ .err = e };
                                        },
                                        bun.C.E.ISDIR => {
                                            treat_as_dir = true;
                                            continue;
                                        },
                                        bun.C.E.PERM => {
                                            // TODO should check if dir
                                            return .{ .err = e };
                                        },
                                        else => return .{ .err = e },
                                    }
                                }
                                return Maybe(void).success;
                            }
                        };

                        defer {
                            _ = Syscall.close(fd);
                        }

                        switch (Syscall.unlinkatWithFlags(dirfd, dir_task.path, std.os.AT.REMOVEDIR)) {
                            .result => {
                                switch (this.verboseDeleted(dir_task, dir_task.path)) {
                                    .err => |e| return .{ .err = e },
                                    else => {},
                                }
                                return Maybe(void).success;
                            },
                            .err => |e| {
                                switch (e.getErrno()) {
                                    bun.C.E.NOENT => {
                                        if (this.opts.force) {
                                            if (this.verboseDeleted(dir_task, dir_task.path).asErr()) |e2| return .{ .err = e2 };
                                            return Maybe(void).success;
                                        }
                                        return .{ .err = e };
                                    },
                                    else => return .{ .err = e },
                                }
                            },
                        }
                    }

                    fn removeEntryFile(
                        this: *ShellRmTask,
                        parent_dir_task: *DirTask,
                        path: [:0]const u8,
                        is_absolute: bool,
                        buf: *[bun.MAX_PATH_BYTES]u8,
                        comptime is_file_in_dir: bool,
                    ) Maybe(void) {
                        const dirfd = bun.toFD(this.cwd);
                        switch (Syscall.unlinkatWithFlags(dirfd, path, 0)) {
                            .result => return this.verboseDeleted(parent_dir_task, path),
                            .err => |e| {
                                switch (e.getErrno()) {
                                    bun.C.E.NOENT => {
                                        if (this.opts.force)
                                            return this.verboseDeleted(parent_dir_task, path);

                                        return .{ .err = this.errorWithPath(e, path) };
                                    },
                                    bun.C.E.ISDIR => {
                                        if (comptime is_file_in_dir) {
                                            this.enqueueNoJoin(parent_dir_task, path, .dir);
                                            return Maybe(void).success;
                                        }
                                        return this.removeEntryDir(parent_dir_task, is_absolute, buf);
                                    },
                                    // This might happen if the file is actually a directory
                                    bun.C.E.PERM => {
                                        switch (builtin.os.tag) {
                                            // non-Linux POSIX systems return EPERM when trying to delete a directory, so
                                            // we need to handle that case specifically and translate the error
                                            .macos, .ios, .freebsd, .netbsd, .dragonfly, .openbsd, .solaris, .illumos => {
                                                // If we are allowed to delete directories then we can call `unlink`.
                                                // If `path` points to a directory, then it is deleted (if empty) or we handle it as a directory
                                                // If it's actually a file, we get an error so we don't need to call `stat` to check that.
                                                if (this.opts.recursive or this.opts.remove_empty_dirs) {
                                                    return switch (Syscall.unlinkatWithFlags(dirfd, path, std.os.AT.REMOVEDIR)) {
                                                        // it was empty, we saved a syscall
                                                        .result => return this.verboseDeleted(parent_dir_task, path),
                                                        .err => |e2| {
                                                            return switch (e2.getErrno()) {
                                                                // not empty, process directory as we would normally
                                                                bun.C.E.NOTEMPTY => {
                                                                    this.enqueueNoJoin(parent_dir_task, path, .dir);
                                                                    return Maybe(void).success;
                                                                },
                                                                // actually a file, the error is a permissions error
                                                                bun.C.E.NOTDIR => .{ .err = this.errorWithPath(e, path) },
                                                                else => .{ .err = this.errorWithPath(e2, path) },
                                                            };
                                                        },
                                                    };
                                                }

                                                // We don't know if it was an actual permissions error or it was a directory so we need to try to delete it as a directory
                                                if (comptime is_file_in_dir) {
                                                    this.enqueueNoJoin(parent_dir_task, path, .dir);
                                                    return Maybe(void).success;
                                                }
                                                return this.removeEntryDir(parent_dir_task, is_absolute, buf);
                                            },
                                            else => {},
                                        }

                                        return .{ .err = this.errorWithPath(e, path) };
                                    },
                                    else => return .{ .err = this.errorWithPath(e, path) },
                                }
                            },
                        }
                    }

                    fn errorWithPath(this: *ShellRmTask, err: Syscall.Error, path: [:0]const u8) Syscall.Error {
                        _ = this;
                        return err.withPath(bun.default_allocator.dupeZ(u8, path[0..path.len]) catch bun.outOfMemory());
                    }

                    inline fn join(this: *ShellRmTask, alloc: Allocator, subdir_parts: []const []const u8, is_absolute: bool) [:0]const u8 {
                        _ = this;
                        if (!is_absolute) {
                            // If relative paths enabled, stdlib join is preferred over
                            // ResolvePath.joinBuf because it doesn't try to normalize the path
                            return std.fs.path.joinZ(alloc, subdir_parts) catch bun.outOfMemory();
                        }

                        const out = alloc.dupeZ(u8, bun.path.join(subdir_parts, .auto)) catch bun.outOfMemory();

                        return out;
                    }

                    pub fn workPoolCallback(task: *JSC.WorkPoolTask) void {
                        var this: *ShellRmTask = @fieldParentPtr(ShellRmTask, "task", task);
                        this.root_task.runFromThreadPoolImpl();
                    }

                    pub fn runFromMainThread(this: *ShellRmTask) void {
                        this.rm.onAsyncTaskDone(this);
                    }

                    pub fn runFromMainThreadMini(this: *ShellRmTask, _: *void) void {
                        this.rm.onAsyncTaskDone(this);
                    }

                    pub fn deinit(this: *ShellRmTask) void {
                        bun.default_allocator.destroy(this);
                    }
                };
            };
        };

        /// This is modified version of BufferedInput for file descriptors only.
        ///
        /// This struct cleans itself up when it is done, so no need to call `.deinit()` on
        /// it. IT DOES NOT CLOSE FILE DESCRIPTORS
        pub const BufferedWriter =
            struct {
            remain: []const u8 = "",
            fd: bun.FileDescriptor,
            poll_ref: ?*bun.Async.FilePoll = null,
            written: usize = 0,
            parent: ParentPtr,
            err: ?Syscall.Error = null,
            /// optional bytelist for capturing the data
            bytelist: ?*bun.ByteList = null,

            const print = bun.Output.scoped(.BufferedWriter, false);
            const CmdJs = bun.shell.Interpreter.Cmd;
            const CmdMini = bun.shell.InterpreterMini.Cmd;
            const PipelineJs = bun.shell.Interpreter.Pipeline;
            const PipelineMini = bun.shell.InterpreterMini.Pipeline;
            const BuiltinJs = bun.shell.Interpreter.Builtin;
            const BuiltinMini = bun.shell.InterpreterMini.Builtin;

            pub const ParentPtr = struct {
                const Types = .{
                    BuiltinJs.Export,
                    BuiltinJs.Echo,
                    BuiltinJs.Cd,
                    BuiltinJs.Which,
                    BuiltinJs.Rm,
                    BuiltinJs.Pwd,
                    BuiltinJs.Mv,
                    BuiltinJs.Ls,
                    BuiltinMini.Export,
                    BuiltinMini.Echo,
                    BuiltinMini.Cd,
                    BuiltinMini.Which,
                    BuiltinMini.Rm,
                    BuiltinMini.Pwd,
                    BuiltinMini.Mv,
                    BuiltinMini.Ls,
                    CmdJs,
                    CmdMini,
                    PipelineJs,
                    PipelineMini,
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
                    if (this.ptr.is(BuiltinJs.Export)) return this.ptr.as(BuiltinJs.Export).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinJs.Echo)) return this.ptr.as(BuiltinJs.Echo).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinJs.Cd)) return this.ptr.as(BuiltinJs.Cd).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinJs.Which)) return this.ptr.as(BuiltinJs.Which).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinJs.Rm)) return this.ptr.as(BuiltinJs.Rm).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinJs.Pwd)) return this.ptr.as(BuiltinJs.Pwd).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinJs.Mv)) return this.ptr.as(BuiltinJs.Mv).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinJs.Ls)) return this.ptr.as(BuiltinJs.Ls).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinMini.Export)) return this.ptr.as(BuiltinMini.Export).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinMini.Echo)) return this.ptr.as(BuiltinMini.Echo).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinMini.Cd)) return this.ptr.as(BuiltinMini.Cd).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinMini.Which)) return this.ptr.as(BuiltinMini.Which).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinMini.Rm)) return this.ptr.as(BuiltinMini.Rm).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinMini.Pwd)) return this.ptr.as(BuiltinMini.Pwd).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinMini.Mv)) return this.ptr.as(BuiltinMini.Mv).onBufferedWriterDone(e);
                    if (this.ptr.is(BuiltinMini.Ls)) return this.ptr.as(BuiltinMini.Ls).onBufferedWriterDone(e);
                    if (this.ptr.is(CmdJs)) return this.ptr.as(CmdJs).onBufferedWriterDone(e);
                    if (this.ptr.is(CmdMini)) return this.ptr.as(CmdMini).onBufferedWriterDone(e);
                    @panic("Invalid ptr tag");
                }
            };

            pub fn isDone(this: *BufferedWriter) bool {
                return this.remain.len == 0 or this.err != null;
            }

            pub const event_loop_kind = EventLoopKind;
            pub usingnamespace JSC.WebCore.NewReadyWatcher(BufferedWriter, .writable, onReady);

            pub fn onReady(this: *BufferedWriter, _: i64) void {
                if (this.fd == bun.invalid_fd) {
                    return;
                }

                this.__write();
            }

            pub fn writeIfPossible(this: *BufferedWriter, comptime is_sync: bool) void {
                if (this.remain.len == 0) return this.deinit();
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
                    this.deinit();
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

            fn close(this: *BufferedWriter) void {
                if (this.poll_ref) |poll| {
                    this.poll_ref = null;
                    poll.deinit();
                }

                if (this.fd != bun.invalid_fd) {
                    // _ = bun.sys.close(this.fd);
                    // this.fd = bun.invalid_fd;
                }
            }

            pub fn deinit(this: *BufferedWriter) void {
                this.close();
                this.parent.onDone(this.err);
            }
        };
    };
}

pub fn StatePtrUnion(comptime TypesValue: anytype) type {
    return struct {
        // pub usingnamespace TaggedPointerUnion(TypesValue);
        ptr: Ptr,

        const Ptr = TaggedPointerUnion(TypesValue);

        pub fn getChildPtrType(comptime Type: type) type {
            if (Type == Interpreter)
                return Interpreter.InterpreterChildPtr;
            if (Type == InterpreterMini) return InterpreterMini.InterpreterChildPtr;
            if (!@hasDecl(Type, "ChildPtr")) {
                @compileError(@typeName(Type) ++ " does not have ChildPtr");
            }
            return Type.ChildPtr;
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

                    // if (@hasField(MaybeChild(@TypeOf(casted)), "deinit")) {
                    casted.deinit();
                    // }
                    return;
                }
            }
            unknownTag(this.tagInt());
        }

        pub fn childDone(this: @This(), child: anytype, exit_code: ExitCode) void {
            const tags = comptime std.meta.fields(Ptr.Tag);
            inline for (tags) |tag| {
                if (this.tagInt() == tag.value) {
                    const Ty = comptime Ptr.typeFromTag(tag.value);
                    // const ChildPtr = Ty.ChildPtr;
                    const ChildPtr = getChildPtrType(Ty);
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
            this.ref.ref(this.event_loop.getVmImpl());
            WorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *@This()) void {
            print("onFinish", .{});
            const ctx = @fieldParentPtr(Ctx, "task", this);
            if (comptime EventLoopKind == .js) {
                this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(ctx, .manual_deinit));
            } else {
                this.event_loop.enqueueTaskConcurrent(this.concurrent_task.from(ctx, "runFromMainThreadMini"));
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
            this.ref.unref(this.event_loop.getVmImpl());
            runFromMainThread_(ctx);
        }
    };
}

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

/// This is modified version of BufferedInput for file descriptors only. This
/// struct cleans itself up when it is done, so no need to call `.deinit()` on
/// it.
pub fn NewBufferedWriter(comptime Src: type, comptime Parent: type, comptime EventLoopKind: JSC.EventLoopKind) type {
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

        pub const event_loop_kind = EventLoopKind;
        pub usingnamespace JSC.WebCore.NewReadyWatcher(@This(), .writable, onReady);

        pub fn onReady(this: *@This(), _: i64) void {
            if (this.fd == bun.invalid_fd) {
                return;
            }

            this.__write();
        }

        pub fn writeIfPossible(this: *@This(), comptime is_sync: bool) void {
            if (SrcHandler.bufToWrite(this.src, 0).len == 0) return this.deinit();
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

        fn close(this: *@This()) void {
            if (this.poll_ref) |poll| {
                this.poll_ref = null;
                poll.deinit();
            }

            if (this.fd != bun.invalid_fd) {
                // _ = bun.sys.close(this.fd);
                // this.fd = bun.invalid_fd;
            }
        }

        pub fn deinit(this: *@This()) void {
            this.close();
            this.parent.onDone(this.err);
        }
    };
}

// pub const Builtin =

inline fn errnocast(errno: anytype) u16 {
    return @intCast(errno);
}

inline fn fastMod(val: anytype, comptime rhs: comptime_int) @TypeOf(val) {
    const Value = @typeInfo(@TypeOf(val));
    if (Value != .Int) @compileError("LHS of fastMod should be an int");
    if (Value.Int.signedness != .unsigned) @compileError("LHS of fastMod should be unsigned");
    if (!comptime std.math.isPowerOfTwo(rhs)) @compileError("RHS of fastMod should be power of 2");

    return val & (rhs - 1);
}
