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
const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
const os = std.os;
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
const TaggedPointer = @import("../tagged_pointer.zig").TaggedPointer;
pub const WorkPoolTask = @import("../work_pool.zig").Task;
pub const WorkPool = @import("../work_pool.zig").WorkPool;
const windows = bun.windows;
const uv = windows.libuv;
const Maybe = JSC.Maybe;

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

pub const ExitCode = u16;

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

/// Copy-on-write file descriptor. This is to avoid having multiple non-blocking
/// writers to the same file descriptor, which breaks epoll/kqueue
///
/// Two main fields:
/// 1. refcount - tracks number of references to the fd, closes file descriptor when reaches 0
/// 2. being_written - if the fd is currently being used by a BufferedWriter for non-blocking writes
///
/// If you want to write to the file descriptor, you call `.write()`, if `being_written` is true it will duplicate the file descriptor.
const CowFd = struct {
    __fd: bun.FileDescriptor,
    refcount: u32 = 1,
    being_used: bool = false,

    const print = bun.Output.scoped(.CowFd, false);

    pub fn init(fd: bun.FileDescriptor) *CowFd {
        const this = bun.default_allocator.create(CowFd) catch bun.outOfMemory();
        this.* = .{
            .__fd = fd,
        };
        print("init(0x{x}, fd={})", .{ @intFromPtr(this), fd });
        return this;
    }

    pub fn dup(this: *CowFd) Maybe(*CowFd) {
        const new = bun.new(CowFd, .{
            .fd = bun.sys.dup(this.fd),
            .writercount = 1,
        });
        print("dup(0x{x}, fd={}) = (0x{x}, fd={})", .{ @intFromPtr(this), this.fd, new, new.fd });
        return new;
    }

    pub fn use(this: *CowFd) Maybe(*CowFd) {
        if (!this.being_used) {
            this.being_used = true;
            this.ref();
            return .{ .result = this };
        }
        return this.dup();
    }

    pub fn doneUsing(this: *CowFd) void {
        this.being_used = false;
    }

    pub fn ref(this: *CowFd) void {
        this.refcount += 1;
    }

    pub fn refSelf(this: *CowFd) *CowFd {
        this.ref();
        return this;
    }

    pub fn deref(this: *CowFd) void {
        this.refcount -= 1;
        if (this.refcount == 0) {
            this.deinit();
        }
    }

    pub fn deinit(this: *CowFd) void {
        std.debug.assert(this.refcount == 0);
        _ = bun.sys.close(this.__fd);
        bun.default_allocator.destroy(this);
    }
};

pub const CoroutineResult = enum {
    /// it's okay for the caller to continue its execution
    cont,
    yield,
};

pub const IO = struct {
    stdin: InKind,
    stdout: OutKind,
    stderr: OutKind,

    pub fn deinit(this: *IO) void {
        this.stdin.close();
        this.stdout.close();
        this.stderr.close();
    }

    pub fn copy(this: *IO) IO {
        _ = this.ref();
        return this.*;
    }

    pub fn ref(this: *IO) *IO {
        _ = this.stdin.ref();
        _ = this.stdout.ref();
        _ = this.stderr.ref();
        return this;
    }

    pub fn deref(this: *IO) void {
        this.stdin.deref();
        this.stdout.deref();
        this.stderr.deref();
    }

    pub const InKind = union(enum) {
        fd: *Interpreter.IOReader,
        ignore,

        pub fn ref(this: InKind) InKind {
            switch (this) {
                .fd => this.fd.ref(),
                .ignore => {},
            }
            return this;
        }

        pub fn deref(this: InKind) void {
            switch (this) {
                .fd => this.fd.deref(),
                .ignore => {},
            }
        }

        pub fn close(this: InKind) void {
            switch (this) {
                .fd => this.fd.deref(),
                .ignore => {},
            }
        }

        pub fn to_subproc_stdio(this: InKind, stdio: *bun.shell.subproc.Stdio) void {
            switch (this) {
                .fd => {
                    stdio.* = .{ .fd = this.fd.fd };
                },
                .ignore => {
                    stdio.* = .ignore;
                },
            }
        }
    };

    pub const OutKind = union(enum) {
        /// Write/Read to/from file descriptor
        /// If `captured` is non-null, it will write to std{out,err} and also buffer it.
        /// The pointer points to the `buffered_stdout`/`buffered_stdin` fields
        /// in the Interpreter struct
        fd: struct { writer: *Interpreter.IOWriter, captured: ?*bun.ByteList = null },
        /// Buffers the output (handled in Cmd.BufferedIoClosed.close())
        pipe,
        /// Discards output
        ignore,

        // fn dupeForSubshell(this: *ShellState,

        pub fn ref(this: @This()) @This() {
            switch (this) {
                .fd => {
                    this.fd.writer.ref();
                },
                else => {},
            }
            return this;
        }

        pub fn deref(this: @This()) void {
            this.close();
        }

        pub fn enqueueFmtBltn(
            this: *@This(),
            ptr: anytype,
            comptime kind: ?Interpreter.Builtin.Kind,
            comptime fmt_: []const u8,
            args: anytype,
        ) void {
            if (bun.Environment.allow_assert) std.debug.assert(this.* == .fd);
            this.fd.writer.enqueueFmtBltn(ptr, this.fd.captured, kind, fmt_, args);
        }

        fn close(this: OutKind) void {
            switch (this) {
                .fd => {
                    this.fd.writer.deref();
                },
                else => {},
            }
        }

        fn to_subproc_stdio(this: OutKind, shellio: *?*shell.IOWriter) bun.shell.subproc.Stdio {
            return switch (this) {
                .fd => |val| brk: {
                    shellio.* = val.writer.refSelf();
                    break :brk if (val.captured) |cap| .{ .capture = .{ .buf = cap, .fd = val.writer.fd } } else .{ .fd = val.writer.fd };
                },
                .pipe => .pipe,
                .ignore => .ignore,
            };
        }
    };

    fn to_subproc_stdio(this: IO, stdio: *[3]bun.shell.subproc.Stdio, shellio: *shell.subproc.ShellIO) void {
        this.stdin.to_subproc_stdio(&stdio[0]);
        stdio[stdout_no] = this.stdout.to_subproc_stdio(&shellio.stdout);
        stdio[stderr_no] = this.stderr.to_subproc_stdio(&shellio.stderr);
    }
};

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

    const print = bun.Output.scoped(.EnvStr, true);

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
        bun.default_allocator.free(this.ptr[0..this.len]);
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

    fn initWithCapacity(alloc: Allocator, cap: usize) EnvMap {
        var map = MapType.init(alloc);
        map.ensureTotalCapacity(cap) catch bun.outOfMemory();
        return .{ .map = map };
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
pub const Interpreter = struct {
    event_loop: JSC.EventLoopHandle,
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
    root_io: IO,

    resolve: JSC.Strong = .{},
    reject: JSC.Strong = .{},
    has_pending_activity: std.atomic.Value(usize) = std.atomic.Value(usize).init(0),
    started: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),

    done: ?*bool = null,
    exit_code: ?*ExitCode = null,

    const InterpreterChildPtr = StatePtrUnion(.{
        Script,
    });

    pub const ShellState = struct {
        kind: Kind = .normal,

        /// This is the buffered stdout/stderr that captures the entire
        /// output of the script and is given to JS.
        ///
        /// Accross the entire script execution, this is usually the same.
        ///
        /// It changes when a cmd substitution is run.
        ///
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

        /// Doesn't deref `this.io`
        ///
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

            const stdout: Bufio = if (io.stdout == .fd) brk: {
                if (io.stdout.fd.captured != null) break :brk .{ .borrowed = io.stdout.fd.captured.? };
                break :brk .{ .owned = .{} };
            } else if (kind == .pipeline) .{ .borrowed = this.buffered_stdout() } else .{ .owned = .{} };

            const stderr: Bufio = if (io.stderr == .fd) brk: {
                if (io.stderr.fd.captured != null) break :brk .{ .borrowed = io.stderr.fd.captured.? };
                break :brk .{ .owned = .{} };
            } else if (kind == .pipeline) .{ .borrowed = this.buffered_stderr() } else .{ .owned = .{} };

            duped.* = .{
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
                if (bun.Environment.isWindows) {
                    const sep = '\\';
                    if (cwd_str.len > 1 and cwd_str[cwd_str.len - 1] == sep) {
                        ResolvePath.join_buf[cwd_str.len - 1] = 0;
                        break :brk ResolvePath.join_buf[0 .. cwd_str.len - 1 :0];
                    }
                }
                if (cwd_str.len > 1 and cwd_str[cwd_str.len - 1] == '/') {
                    ResolvePath.join_buf[cwd_str.len - 1] = 0;
                    break :brk ResolvePath.join_buf[0 .. cwd_str.len - 1 :0];
                }

                break :brk cwd_str;
            };

            const new_cwd_fd = switch (ShellSyscall.openat(
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

        pub fn writeFailingErrorFmt(
            this: *ShellState,
            ctx: anytype,
            enqueueCb: fn (c: @TypeOf(ctx)) void,
            comptime fmt: []const u8,
            args: anytype,
        ) void {
            const io: *IO.OutKind = &@field(ctx.io, "stderr");
            switch (io.*) {
                .fd => |x| {
                    enqueueCb(ctx);
                    x.writer.enqueueFmt(ctx, x.captured, fmt, args);
                },
                .pipe => {
                    const bufio: *bun.ByteList = this.buffered_stderr();
                    bufio.appendFmt(bun.default_allocator, fmt, args) catch bun.outOfMemory();
                    ctx.parent.childDone(ctx, 1);
                },
                .ignore => {},
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
        var stack_alloc = std.heap.stackFallback(@sizeOf(bun.String) * 4, arena.allocator());
        var jsstrings = std.ArrayList(bun.String).initCapacity(stack_alloc.get(), 4) catch {
            globalThis.throwOutOfMemory();
            return null;
        };
        defer {
            for (jsstrings.items[0..]) |bunstr| {
                bunstr.deref();
            }
            jsstrings.deinit();
        }
        var jsobjs = std.ArrayList(JSValue).init(arena.allocator());
        var script = std.ArrayList(u8).init(arena.allocator());
        if (!(bun.shell.shellCmdFromJS(globalThis, string_args, template_args, &jsobjs, &jsstrings, &script) catch {
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
            jsstrings.items[0..],
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
            .{ .js = globalThis.bunVM().event_loop },
            allocator,
            &arena,
            script_heap,
            jsobjs.items[0..],
        )) {
            .result => |i| i,
            .err => |*e| {
                arena.deinit();
                throwShellErr(e, .{ .js = globalThis.bunVM().event_loop });
                return null;
            },
        };

        return interpreter;
    }

    pub fn parse(
        arena: *bun.ArenaAllocator,
        script: []const u8,
        jsobjs: []JSValue,
        jsstrings_to_escape: []bun.String,
        out_parser: *?bun.shell.Parser,
        out_lex_result: *?shell.LexResult,
    ) !ast.Script {
        const lex_result = brk: {
            if (bun.strings.isAllASCII(script)) {
                var lexer = bun.shell.LexerAscii.new(arena.allocator(), script, jsstrings_to_escape);
                try lexer.lex();
                break :brk lexer.get_result();
            }
            var lexer = bun.shell.LexerUnicode.new(arena.allocator(), script, jsstrings_to_escape);
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

    /// If all initialization allocations succeed, the arena will be copied
    /// into the interpreter struct, so it is not a stale reference and safe to call `arena.deinit()` on error.
    pub fn init(
        event_loop: JSC.EventLoopHandle,
        allocator: Allocator,
        arena: *bun.ArenaAllocator,
        script: *ast.Script,
        jsobjs: []JSValue,
    ) shell.Result(*ThisInterpreter) {
        var interpreter = allocator.create(ThisInterpreter) catch bun.outOfMemory();
        interpreter.event_loop = event_loop;
        interpreter.allocator = allocator;

        const export_env = brk: {
            // This will be set in the shell builtin to `process.env`
            if (event_loop == .js) break :brk EnvMap.init(allocator);

            var env_loader: *bun.DotEnv.Loader = env_loader: {
                if (event_loop == .js) {
                    break :env_loader event_loop.js.virtual_machine.bundler.env;
                }

                break :env_loader event_loop.env();
            };

            // This will save ~2x memory
            var export_env = EnvMap.initWithCapacity(allocator, env_loader.map.map.unmanaged.entries.len);

            var iter = env_loader.iterator();

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

        log("Duping stdin", .{});
        const stdin_fd = switch (ShellSyscall.dup(shell.STDIN_FD)) {
            .result => |fd| fd,
            .err => |err| return .{ .err = .{ .sys = err.toSystemError() } },
        };

        log("Duping stdout", .{});
        const stdout_fd = switch (ShellSyscall.dup(shell.STDOUT_FD)) {
            .result => |fd| fd,
            .err => |err| return .{ .err = .{ .sys = err.toSystemError() } },
        };

        log("Duping stderr", .{});
        const stderr_fd = switch (ShellSyscall.dup(shell.STDERR_FD)) {
            .result => |fd| fd,
            .err => |err| return .{ .err = .{ .sys = err.toSystemError() } },
        };

        const stdin_reader = IOReader.init(stdin_fd, event_loop);
        const stdout_writer = IOWriter.init(
            stdout_fd,
            .{
                .pollable = isPollable(stdout_fd, event_loop.stdout().data.file.mode),
            },
            event_loop,
        );
        const stderr_writer = IOWriter.init(stderr_fd, .{
            .pollable = isPollable(stderr_fd, event_loop.stderr().data.file.mode),
        }, event_loop);

        interpreter.* = .{
            .event_loop = event_loop,

            .script = script,
            .allocator = allocator,
            .jsobjs = jsobjs,

            .arena = arena.*,

            .root_shell = ShellState{
                .shell_env = EnvMap.init(allocator),
                .cmd_local_env = EnvMap.init(allocator),
                .export_env = export_env,

                .__cwd = cwd_arr,
                .__prev_cwd = cwd_arr.clone() catch bun.outOfMemory(),
                .cwd_fd = cwd_fd,
            },

            .root_io = .{
                .stdin = .{
                    .fd = stdin_reader,
                },
                .stdout = .{
                    .fd = .{
                        .writer = stdout_writer,
                    },
                },
                .stderr = .{
                    .fd = .{
                        .writer = stderr_writer,
                    },
                },
            },
        };

        if (event_loop == .js) {
            interpreter.root_io.stdout.fd.captured = &interpreter.root_shell._buffered_stdout.owned;
            interpreter.root_io.stderr.fd.captured = &interpreter.root_shell._buffered_stderr.owned;
        }

        return .{ .result = interpreter };
    }

    pub fn initAndRunFromFile(mini: *JSC.MiniEventLoop, path: []const u8) !bun.shell.ExitCode {
        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        const src = src: {
            var file = try std.fs.cwd().openFile(path, .{});
            defer file.close();
            break :src try file.reader().readAllAlloc(arena.allocator(), std.math.maxInt(u32));
        };
        defer arena.deinit();

        const jsobjs: []JSValue = &[_]JSValue{};
        var out_parser: ?bun.shell.Parser = null;
        var out_lex_result: ?bun.shell.LexResult = null;
        const script = ThisInterpreter.parse(
            &arena,
            src,
            jsobjs,
            &[_]bun.String{},
            &out_parser,
            &out_lex_result,
        ) catch |err| {
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
        var interp = switch (ThisInterpreter.init(.{ .mini = mini }, bun.default_allocator, &arena, script_heap, jsobjs)) {
            .err => |*e| {
                throwShellErr(e, .{ .mini = mini });
                return 1;
            },
            .result => |i| i,
        };
        var exit_code: ExitCode = 1;

        const IsDone = struct {
            done: bool = false,

            fn isDone(this: *anyopaque) bool {
                const asdlfk = bun.cast(*const @This(), this);
                return asdlfk.done;
            }
        };
        var is_done: IsDone = .{};
        interp.done = &is_done.done;
        interp.exit_code = &exit_code;
        try interp.run();
        mini.tick(&is_done, @as(fn (*anyopaque) bool, IsDone.isDone));
        return exit_code;
    }

    pub fn initAndRunFromSource(mini: *JSC.MiniEventLoop, path_for_errors: []const u8, src: []const u8) !ExitCode {
        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();

        const jsobjs: []JSValue = &[_]JSValue{};
        var out_parser: ?bun.shell.Parser = null;
        var out_lex_result: ?bun.shell.LexResult = null;
        const script = ThisInterpreter.parse(&arena, src, jsobjs, &[_]bun.String{}, &out_parser, &out_lex_result) catch |err| {
            if (err == bun.shell.ParseError.Lex) {
                std.debug.assert(out_lex_result != null);
                const str = out_lex_result.?.combineErrors(arena.allocator());
                bun.Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ path_for_errors, str });
                bun.Global.exit(1);
            }

            if (out_parser) |*p| {
                const errstr = p.combineErrors();
                bun.Output.prettyErrorln("<r><red>error<r>: Failed to run script <b>{s}<r> due to error <b>{s}<r>", .{ path_for_errors, errstr });
                bun.Global.exit(1);
            }

            return err;
        };
        const script_heap = try arena.allocator().create(ast.Script);
        script_heap.* = script;
        var interp = switch (ThisInterpreter.init(.{ .mini = mini }, bun.default_allocator, &arena, script_heap, jsobjs)) {
            .err => |*e| {
                throwShellErr(e, .{ .mini = mini });
                return 1;
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
        var exit_code: ExitCode = 1;
        interp.done = &is_done.done;
        interp.exit_code = &exit_code;
        try interp.run();
        mini.tick(&is_done, @as(fn (*anyopaque) bool, IsDone.isDone));
        interp.deinitEverything();
        return exit_code;
    }

    pub fn run(this: *ThisInterpreter) !void {
        var root = Script.init(this, &this.root_shell, this.script, Script.ParentPtr.init(this), this.root_io.copy());
        this.started.store(true, .SeqCst);
        root.start();
    }

    pub fn runFromJS(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSValue {
        _ = callframe; // autofix

        _ = globalThis;
        incrPendingActivityFlag(&this.has_pending_activity);
        var root = Script.init(this, &this.root_shell, this.script, Script.ParentPtr.init(this), this.root_io.copy());
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
            this.event_loop.js.global,
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
        defer decrPendingActivityFlag(&this.has_pending_activity);

        if (this.event_loop == .js) {
            defer this.deinitAfterJSRun();
            _ = this.resolve.call(&.{JSValue.jsNumberFromU16(exit_code)});
        } else {
            this.done.?.* = true;
            this.exit_code.?.* = exit_code;
        }
    }

    fn errored(this: *ThisInterpreter, the_error: ShellError) void {
        _ = the_error; // autofix
        defer decrPendingActivityFlag(&this.has_pending_activity);

        if (this.event_loop == .js) {
            this.resolve.deinit();
            _ = this.reject.call(&[_]JSValue{JSValue.jsNumberFromChar(1)});
        }
    }

    fn deinitAfterJSRun(this: *ThisInterpreter) void {
        log("deinit interpreter", .{});
        for (this.jsobjs) |jsobj| {
            jsobj.unprotect();
        }
        this.root_io.deref();
        this.root_shell.deinitImpl(false, false);
    }

    fn deinitFromFinalizer(this: *ThisInterpreter) void {
        if (this.root_shell._buffered_stderr == .owned) {
            this.root_shell._buffered_stderr.owned.deinitWithAllocator(bun.default_allocator);
        }
        if (this.root_shell._buffered_stdout == .owned) {
            this.root_shell._buffered_stdout.owned.deinitWithAllocator(bun.default_allocator);
        }
        this.resolve.deinit();
        this.reject.deinit();
        this.allocator.destroy(this);
    }

    fn deinitEverything(this: *ThisInterpreter) void {
        log("deinit interpreter", .{});
        for (this.jsobjs) |jsobj| {
            jsobj.unprotect();
        }
        this.root_io.deref();
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
        log("Interpreter(0x{x}) setQuiet()", .{@intFromPtr(this)});
        _ = globalThis;
        _ = callframe;
        this.root_io.stdout.deref();
        this.root_io.stderr.deref();
        this.root_io.stdout = .pipe;
        this.root_io.stderr = .pipe;
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
        log("Interpreter finalize", .{});
        this.deinitFromFinalizer();
    }

    pub fn hasPendingActivity(this: *ThisInterpreter) callconv(.C) bool {
        @fence(.SeqCst);
        return this.has_pending_activity.load(.SeqCst) > 0;
    }

    fn incrPendingActivityFlag(has_pending_activity: *std.atomic.Value(usize)) void {
        @fence(.SeqCst);
        _ = has_pending_activity.fetchAdd(1, .SeqCst);
        log("Interpreter incr pending activity {d}", .{has_pending_activity.load(.SeqCst)});
    }

    fn decrPendingActivityFlag(has_pending_activity: *std.atomic.Value(usize)) void {
        @fence(.SeqCst);
        _ = has_pending_activity.fetchSub(1, .SeqCst);
        log("Interpreter decr pending activity {d}", .{has_pending_activity.load(.SeqCst)});
    }

    pub fn rootIO(this: *const Interpreter) *const IO {
        return &this.root_io;
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
        io: IO,

        word_idx: u32,
        current_out: std.ArrayList(u8),
        state: union(enum) {
            normal,
            braces,
            glob,
            done,
            err: bun.shell.ShellErr,
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
            io: IO,
        ) void {
            log("Expansion(0x{x}) init", .{@intFromPtr(expansion)});
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
                .io = io,
            };
            // var expansion = interpreter.allocator.create(Expansion) catch bun.outOfMemory();
        }

        pub fn deinit(expansion: *Expansion) void {
            log("Expansion(0x{x}) deinit", .{@intFromPtr(expansion)});
            expansion.current_out.deinit();
            expansion.io.deinit();
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

            // Parent will inspect the `this.state.err`
            if (this.state == .err) {
                this.parent.childDone(this, 1);
                return;
            }
        }

        fn transitionToGlobState(this: *Expansion) void {
            var arena = Arena.init(this.base.interpreter.allocator);
            this.child_state = .{ .glob = .{ .walker = .{} } };
            const pattern = this.current_out.items[0..];

            const cwd = this.base.shell.cwd();

            switch (GlobWalker.initWithCwd(
                &this.child_state.glob.walker,
                &arena,
                pattern,
                cwd,
                false,
                false,
                false,
                false,
                false,
            ) catch bun.outOfMemory()) {
                .result => {},
                .err => |e| {
                    this.state = .{ .err = bun.shell.ShellErr.newSys(e) };
                    this.next();
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
                        const io: IO = .{
                            .stdin = this.base.rootIO().stdin.ref(),
                            .stdout = .pipe,
                            .stderr = this.base.rootIO().stderr.ref(),
                        };
                        const shell_state = switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, io, .cmd_subst)) {
                            .result => |s| s,
                            .err => |e| {
                                this.base.throw(&bun.shell.ShellErr.newSys(e));
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
                            const io: IO = .{
                                .stdin = this.base.rootIO().stdin.ref(),
                                .stdout = .pipe,
                                .stderr = this.base.rootIO().stderr.ref(),
                            };
                            const shell_state = switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, io, .cmd_subst)) {
                                .result => |s| s,
                                .err => |e| {
                                    this.base.throw(&bun.shell.ShellErr.newSys(e));
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
                }
            }
            // "aa bbb"

            this.current_out.appendSlice(stdout[a..b]) catch bun.outOfMemory();
        }

        fn convertNewlinesToSpaces(stdout_: []u8) []u8 {
            var stdout = brk: {
                if (stdout_.len == 0) return stdout_;
                if (stdout_[stdout_.len -| 1] == '\n') break :brk stdout_[0..stdout_.len -| 1];
                break :brk stdout_[0..];
            };

            if (stdout.len == 0) {
                return stdout;
            }

            // From benchmarks the SIMD stuff only is faster when chars >= 64
            if (stdout.len < 64) {
                convertNewlinesToSpacesSlow(0, stdout);
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

            if (task.err) |*err| {
                switch (err.*) {
                    .syscall => {
                        this.base.throw(&bun.shell.ShellErr.newSys(task.err.?.syscall));
                    },
                    .unknown => |errtag| {
                        this.base.throw(&.{
                            .custom = bun.default_allocator.dupe(u8, @errorName(errtag)) catch bun.outOfMemory(),
                        });
                    },
                }
            }

            if (task.result.items.len == 0) {
                const msg = std.fmt.allocPrint(bun.default_allocator, "no matches found: {s}", .{this.child_state.glob.walker.pattern}) catch bun.outOfMemory();
                this.state = .{
                    .err = bun.shell.ShellErr{
                        .custom = msg,
                    },
                };
                this.child_state.glob.walker.deinit(true);
                this.child_state = .idle;
                this.next();
                return;
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
        }

        pub fn pushCurrentOut(this: *Expansion) void {
            if (this.current_out.items.len == 0) return;
            if (this.current_out.items[this.current_out.items.len - 1] != 0) this.current_out.append(0) catch bun.outOfMemory();
            this.pushResult(&this.current_out);
            this.current_out = std.ArrayList(u8).init(this.base.interpreter.allocator);
        }

        pub fn pushResult(this: *Expansion, buf: *std.ArrayList(u8)) void {
            this.out.pushResult(buf);
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
            event_loop: JSC.EventLoopHandle,
            concurrent_task: JSC.EventLoopTask,
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

            pub fn createOnMainThread(allocator: Allocator, walker: *GlobWalker, expansion: *Expansion) *This {
                print("createOnMainThread", .{});
                var this = allocator.create(This) catch bun.outOfMemory();
                this.* = .{
                    .event_loop = expansion.base.eventLoop(),
                    .concurrent_task = JSC.EventLoopTask.fromEventLoop(expansion.base.eventLoop()),
                    .walker = walker,
                    .allocator = allocator,
                    .expansion = expansion,
                    .result = std.ArrayList([:0]const u8).init(allocator),
                };

                this.ref.ref(this.event_loop);

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
                this.ref.unref(this.event_loop);
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
                if (this.event_loop == .js) {
                    this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
                } else {
                    this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
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

        pub inline fn eventLoop(this: *const State) JSC.EventLoopHandle {
            return this.interpreter.event_loop;
        }

        pub fn throw(this: *const State, err: *const bun.shell.ShellErr) void {
            throwShellErr(err, this.eventLoop());
        }

        pub fn rootIO(this: *const State) *const IO {
            return this.interpreter.rootIO();
        }
    };

    pub const Script = struct {
        base: State,
        node: *const ast.Script,
        io: IO,
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
            io: IO,
        ) *Script {
            const script = interpreter.allocator.create(Script) catch bun.outOfMemory();
            script.* = .{
                .base = .{ .kind = .script, .interpreter = interpreter, .shell = shell_state },
                .node = node,
                .parent = parent_ptr,
                .io = io,
            };
            log("Script(0x{x}) init", .{@intFromPtr(script)});
            return script;
        }

        fn getIO(this: *Script) IO {
            return this.io;
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
                    var io = this.getIO();
                    var stmt = Stmt.init(this.base.interpreter, this.base.shell, stmt_node, this, io.ref().*) catch bun.outOfMemory();
                    stmt.start();
                    return;
                },
            }
        }

        fn finish(this: *Script, exit_code: ExitCode) void {
            if (this.parent.ptr.is(ThisInterpreter)) {
                log("Interpreter script finish", .{});
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
            log("Script(0x{x}) deinit", .{@intFromPtr(this)});
            this.io.deref();
            if (this.parent.ptr.is(ThisInterpreter)) {
                return;
            }

            this.base.shell.deinit();
            bun.default_allocator.destroy(this);
        }

        pub fn deinitFromInterpreter(this: *Script) void {
            log("Script(0x{x}) deinitFromInterpreter", .{@intFromPtr(this)});
            this.io.deinit();
            // Let the interpreter deinitialize the shell state
            // this.base.shell.deinitImpl(false, false);
            bun.default_allocator.destroy(this);
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
            err: bun.shell.ShellErr,
            done,
        },
        ctx: AssignCtx,
        io: IO,

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
            this.io.deinit();
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
            io: IO,
        ) void {
            this.* = .{
                .base = .{ .kind = .assign, .interpreter = interpreter, .shell = shell_state },
                .node = node,
                .parent = parent,
                .state = .idle,
                .ctx = ctx,
                .io = io,
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
                            this.io.copy(),
                        );
                        this.state.expanding.expansion.start();
                        return;
                    },
                    .done => unreachable,
                    .err => return this.parent.childDone(this, 1),
                }
            }

            this.parent.childDone(this, 0);
        }

        pub fn childDone(this: *Assigns, child: ChildPtr, exit_code: ExitCode) void {
            if (child.ptr.is(Expansion)) {
                const expansion = child.ptr.as(Expansion);
                if (exit_code != 0) {
                    this.state = .{
                        .err = expansion.state.err,
                    };
                    expansion.deinit();
                    return;
                }
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
                expansion.deinit();
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
            log("Stmt(0x{x}) init", .{@intFromPtr(script)});
            return script;
        }

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
                    const cond = Cond.init(this.base.interpreter, this.base.shell, child.cond, Cond.ParentPtr.init(this), this.io.copy());
                    this.currently_executing = ChildPtr.init(cond);
                    cond.start();
                },
                .cmd => {
                    const cmd = Cmd.init(this.base.interpreter, this.base.shell, child.cmd, Cmd.ParentPtr.init(this), this.io.copy());
                    this.currently_executing = ChildPtr.init(cmd);
                    cmd.start();
                },
                .pipeline => {
                    const pipeline = Pipeline.init(this.base.interpreter, this.base.shell, child.pipeline, Pipeline.ParentPtr.init(this), this.io.copy());
                    this.currently_executing = ChildPtr.init(pipeline);
                    pipeline.start();
                },
                .assign => |assigns| {
                    var assign_machine = this.base.interpreter.allocator.create(Assigns) catch bun.outOfMemory();
                    assign_machine.init(this.base.interpreter, this.base.shell, assigns, .shell, Assigns.ParentPtr.init(this), this.io.copy());
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
            log("Stmt(0x{x}) deinit", .{@intFromPtr(this)});
            this.io.deinit();
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
        }

        /// Returns null if child is assignments
        fn makeChild(this: *Cond, left: bool) ?ChildPtr {
            const node = if (left) &this.node.left else &this.node.right;
            switch (node.*) {
                .cmd => {
                    const cmd = Cmd.init(this.base.interpreter, this.base.shell, node.cmd, Cmd.ParentPtr.init(this), this.io.copy());
                    return ChildPtr.init(cmd);
                },
                .cond => {
                    const cond = Cond.init(this.base.interpreter, this.base.shell, node.cond, Cond.ParentPtr.init(this), this.io.copy());
                    return ChildPtr.init(cond);
                },
                .pipeline => {
                    const pipeline = Pipeline.init(this.base.interpreter, this.base.shell, node.pipeline, Pipeline.ParentPtr.init(this), this.io.copy());
                    return ChildPtr.init(pipeline);
                },
                .assign => |assigns| {
                    var assign_machine = this.base.interpreter.allocator.create(Assigns) catch bun.outOfMemory();
                    assign_machine.init(this.base.interpreter, this.base.shell, assigns, .shell, Assigns.ParentPtr.init(this), this.io.copy());
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
            this.io.deinit();
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
        state: union(enum) {
            idle,
            executing,
            waiting_write_err,
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
            io: IO,
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
            return this.io;
        }

        fn writeFailingError(this: *Pipeline, comptime fmt: []const u8, args: anytype) void {
            const handler = struct {
                fn enqueueCb(ctx: *Pipeline) void {
                    ctx.state = .waiting_write_err;
                }
            };
            this.base.shell.writeFailingErrorFmt(this, handler.enqueueCb, fmt, args);
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
                    this.writeFailingError("bun: {s}\n", .{system_err.message});
                    return .yield;
                }
            }

            var i: u32 = 0;
            const evtloop = this.base.eventLoop();
            for (this.node.items) |*item| {
                switch (item.*) {
                    .cmd => {
                        const kind = "subproc";
                        _ = kind;
                        var cmd_io = this.getIO();
                        const stdin = if (cmd_count > 1) Pipeline.readPipe(pipes, i, &cmd_io, evtloop) else cmd_io.stdin.ref();
                        const stdout = if (cmd_count > 1) Pipeline.writePipe(pipes, i, cmd_count, &cmd_io, evtloop) else cmd_io.stdout.ref();
                        cmd_io.stdin = stdin;
                        cmd_io.stdout = stdout;
                        _ = cmd_io.stderr.ref();
                        const subshell_state = switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, cmd_io, .pipeline)) {
                            .result => |s| s,
                            .err => |err| {
                                const system_err = err.toSystemError();
                                this.writeFailingError("bun: {s}\n", .{system_err.message});
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

            for (cmds) |*cmd_or_result| {
                std.debug.assert(cmd_or_result.* == .cmd);
                var cmd = cmd_or_result.cmd;
                cmd.start();
            }
        }

        pub fn onIOWriterChunk(this: *Pipeline, _: usize, err: ?JSC.SystemError) void {
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.state == .waiting_write_err);
            }

            if (err) |e| {
                this.base.throw(&shell.ShellErr.newSys(e));
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
            this.io.deref();
            this.base.interpreter.allocator.destroy(this);
        }

        fn initializePipes(pipes: []Pipe, set_count: *u32) Maybe(void) {
            for (pipes) |*pipe| {
                if (bun.Environment.isWindows) {
                    var fds: [2]uv.uv_file = undefined;
                    if (uv.uv_pipe(&fds, 0, 0).errEnum()) |e| {
                        return .{ .err = Syscall.Error.fromCode(e, .pipe) };
                    }
                    pipe[0] = bun.FDImpl.fromUV(fds[0]).encode();
                    pipe[1] = bun.FDImpl.fromUV(fds[1]).encode();
                } else {
                    const fds: [2]bun.FileDescriptor = brk: {
                        var fds_: [2]std.c.fd_t = undefined;
                        const rc = std.c.socketpair(std.os.AF.UNIX, std.os.SOCK.STREAM, 0, &fds_);
                        if (rc != 0) {
                            return bun.sys.Maybe(void).errno(bun.sys.getErrno(rc), .socketpair);
                        }

                        var before = std.c.fcntl(fds_[0], std.os.F.GETFL);

                        const result = std.c.fcntl(fds_[0], std.os.F.SETFL, before | os.O.CLOEXEC);
                        if (result == -1) {
                            _ = bun.sys.close(bun.toFD(fds_[0]));
                            _ = bun.sys.close(bun.toFD(fds_[1]));
                            return Maybe(void).errno(bun.sys.getErrno(result), .fcntl);
                        }

                        if (comptime bun.Environment.isMac) {
                            // SO_NOSIGPIPE
                            before = 1;
                            _ = std.c.setsockopt(fds_[0], std.os.SOL.SOCKET, std.os.SO.NOSIGPIPE, &before, @sizeOf(c_int));
                        }

                        break :brk .{ bun.toFD(fds_[0]), bun.toFD(fds_[1]) };
                    };
                    pipe.* = fds;
                }
                set_count.* += 1;
            }
            return Maybe(void).success;
        }

        fn writePipe(pipes: []Pipe, proc_idx: usize, cmd_count: usize, io: *IO, evtloop: JSC.EventLoopHandle) IO.OutKind {
            // Last command in the pipeline should write to stdout
            if (proc_idx == cmd_count - 1) return io.stdout.ref();
            return .{ .fd = .{ .writer = IOWriter.init(pipes[proc_idx][1], .{
                .pollable = true,
                .is_socket = bun.Environment.isPosix,
            }, evtloop) } };
        }

        fn readPipe(pipes: []Pipe, proc_idx: usize, io: *IO, evtloop: JSC.EventLoopHandle) IO.InKind {
            // First command in the pipeline should read from stdin
            if (proc_idx == 0) return io.stdin.ref();
            return .{ .fd = IOReader.init(pipes[proc_idx - 1][0], evtloop) };
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
        redirection_fd: ?*CowFd = null,

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
            waiting_write_err,
        },

        const Subprocess = bun.shell.subproc.ShellSubprocess;

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
                if (this.stdout) |*io| {
                    io.deinit(jsc_vm_allocator);
                }

                if (this.stderr) |*io| {
                    io.deinit(jsc_vm_allocator);
                }
            }

            fn allClosed(this: *BufferedIoClosed) bool {
                const ret = (if (this.stdin) |stdin| stdin else true) and
                    (if (this.stdout) |*stdout| stdout.closed() else true) and
                    (if (this.stderr) |*stderr| stderr.closed() else true);
                log("BufferedIOClosed(0x{x}) all_closed={any} stdin={any} stdout={any} stderr={any}", .{ @intFromPtr(this), ret, if (this.stdin) |stdin| stdin else true, if (this.stdout) |*stdout| stdout.closed() else true, if (this.stderr) |*stderr| stderr.closed() else true });
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
                                cmd.base.shell.buffered_stdout().append(bun.default_allocator, the_slice) catch bun.outOfMemory();
                            }

                            stdout.state = .{ .closed = bun.ByteList.fromList(readable.pipe.takeBuffer()) };
                        }
                    },
                    .stderr => {
                        if (this.stderr) |*stderr| {
                            const readable = io.stderr;

                            // If the shell state is piped (inside a cmd substitution) aggregate the output of this command
                            if (cmd.io.stderr == .pipe and cmd.io.stderr == .pipe and !cmd.node.redirect.redirectsElsewhere(.stderr)) {
                                const the_slice = readable.pipe.slice();
                                cmd.base.shell.buffered_stderr().append(bun.default_allocator, the_slice) catch bun.outOfMemory();
                            }

                            stderr.state = .{ .closed = bun.ByteList.fromList(readable.pipe.takeBuffer()) };
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
        pub fn writeFailingError(this: *Cmd, comptime fmt: []const u8, args: anytype) void {
            const handler = struct {
                fn enqueueCb(ctx: *Cmd) void {
                    ctx.state = .waiting_write_err;
                }
            };
            this.base.shell.writeFailingErrorFmt(this, handler.enqueueCb, fmt, args);
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
            while (this.state != .done) {
                switch (this.state) {
                    .idle => {
                        this.state = .{ .expanding_assigns = undefined };
                        Assigns.init(&this.state.expanding_assigns, this.base.interpreter, this.base.shell, this.node.assigns, .cmd, Assigns.ParentPtr.init(this), this.io.copy());
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
                            this.io.copy(),
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
                            this.io.copy(),
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
                    .done => unreachable,
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

        pub fn onIOWriterChunk(this: *Cmd, _: usize, e: ?JSC.SystemError) void {
            if (e) |err| {
                this.base.throw(&bun.shell.ShellErr.newSys(err));
                return;
            }
            std.debug.assert(this.state == .waiting_write_err);
            this.parent.childDone(this, 1);
            return;
        }

        pub fn childDone(this: *Cmd, child: ChildPtr, exit_code: ExitCode) void {
            if (child.ptr.is(Assigns)) {
                if (exit_code != 0) {
                    const err = this.state.expanding_assigns.state.err;
                    defer err.deinit(bun.default_allocator);
                    this.state.expanding_assigns.deinit();
                    const buf = err.fmt();
                    this.writeFailingError("{s}", .{buf});
                    return;
                }

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
                child.deinit();
                if (exit_code != 0) {
                    const err = switch (this.state) {
                        .expanding_redirect => this.state.expanding_redirect.expansion.state.err,
                        .expanding_args => this.state.expanding_args.expansion.state.err,
                        else => @panic("Invalid state"),
                    };
                    defer err.deinit(bun.default_allocator);
                    const buf = err.fmt();
                    this.writeFailingError("{s}", .{buf});
                    return;
                }
                this.next();
                return;
            }
            unreachable;
        }

        fn initSubproc(this: *Cmd) void {
            log("cmd init subproc ({x}, cwd={s})", .{ @intFromPtr(this), this.base.shell.cwd() });

            var arena = &this.spawn_arena;
            var arena_allocator = arena.allocator();
            var spawn_args = Subprocess.SpawnArgs.default(arena, this.base.interpreter.event_loop, false);

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
                        cwd,
                        &this.io,
                        false,
                    );
                    if (coro_result == .yield) return;

                    if (comptime bun.Environment.allow_assert) {
                        std.debug.assert(this.exec == .bltn);
                    }

                    log("Builtin name: {s}", .{@tagName(this.exec)});

                    switch (this.exec.bltn.start()) {
                        .result => {},
                        .err => |e| {
                            this.writeFailingError("bun: {s}: {s}", .{ @tagName(this.exec.bltn.kind), e.toSystemError().message });
                            return;
                        },
                    }
                    return;
                }

                var path_buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                const resolved = which(&path_buf, spawn_args.PATH, spawn_args.cwd, first_arg[0..first_arg_len]) orelse {
                    this.writeFailingError("bun: command not found: {s}\n", .{first_arg});
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

            var shellio: shell.subproc.ShellIO = .{};
            defer shellio.deref();
            this.io.to_subproc_stdio(&spawn_args.stdio, &shellio);

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
                            const stdio: bun.shell.subproc.Stdio = .{ .array_buffer = JSC.ArrayBuffer.Strong{
                                .array_buffer = buf,
                                .held = JSC.Strong.create(buf.value, global),
                            } };

                            setStdioFromRedirect(&spawn_args.stdio, this.node.redirect, stdio);
                        } else if (this.base.interpreter.jsobjs[val.idx].as(JSC.WebCore.Blob)) |blob__| {
                            const blob = blob__.dupe();
                            if (this.node.redirect.stdin) {
                                if (!spawn_args.stdio[stdin_no].extractBlob(global, .{
                                    .Blob = blob,
                                }, stdin_no)) {
                                    return;
                                }
                            } else if (this.node.redirect.stdout) {
                                if (!spawn_args.stdio[stdin_no].extractBlob(global, .{
                                    .Blob = blob,
                                }, stdout_no)) {
                                    return;
                                }
                            } else if (this.node.redirect.stderr) {
                                if (!spawn_args.stdio[stdin_no].extractBlob(global, .{
                                    .Blob = blob,
                                }, stderr_no)) {
                                    return;
                                }
                            }
                        } else if (JSC.WebCore.ReadableStream.fromJS(this.base.interpreter.jsobjs[val.idx], global)) |rstream| {
                            _ = rstream;
                            @panic("TODO SHELL READABLE STREAM");
                        } else if (this.base.interpreter.jsobjs[val.idx].as(JSC.WebCore.Response)) |req| {
                            req.getBodyValue().toBlobIfPossible();
                            if (this.node.redirect.stdin) {
                                if (!spawn_args.stdio[stdin_no].extractBlob(global, req.getBodyValue().useAsAnyBlob(), stdin_no)) {
                                    return;
                                }
                            }
                            if (this.node.redirect.stdout) {
                                if (!spawn_args.stdio[stdout_no].extractBlob(global, req.getBodyValue().useAsAnyBlob(), stdout_no)) {
                                    return;
                                }
                            }
                            if (this.node.redirect.stderr) {
                                if (!spawn_args.stdio[stderr_no].extractBlob(global, req.getBodyValue().useAsAnyBlob(), stderr_no)) {
                                    return;
                                }
                            }
                        } else {
                            const jsval = this.base.interpreter.jsobjs[val.idx];
                            global.throw(
                                "Unknown JS value used in shell: {}",
                                .{jsval.fmtString(global)},
                            );
                            return;
                        }
                    },
                    .atom => {
                        if (this.redirection_file.items.len == 0) {
                            this.writeFailingError("bun: ambiguous redirect: at `{s}`\n", .{spawn_args.argv.items[0] orelse "<unknown>"});
                            return;
                        }
                        const path = this.redirection_file.items[0..this.redirection_file.items.len -| 1 :0];
                        log("Expanded Redirect: {s}\n", .{this.redirection_file.items[0..]});
                        const perm = 0o666;
                        const flags = this.node.redirect.toFlags();
                        const redirfd = switch (ShellSyscall.openat(this.base.shell.cwd_fd, path, flags, perm)) {
                            .err => |e| {
                                return this.writeFailingError("bun: {s}: {s}", .{ e.toSystemError().message, path });
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

            const buffered_closed = BufferedIoClosed.fromStdio(&spawn_args.stdio);
            log("cmd ({x}) set buffered closed => {any}", .{ @intFromPtr(this), buffered_closed });

            this.exec = .{ .subproc = .{
                .child = undefined,
                .buffered_closed = buffered_closed,
            } };
            const subproc = switch (Subprocess.spawnAsync(this.base.eventLoop(), &shellio, spawn_args, &this.exec.subproc.child)) {
                .result => this.exec.subproc.child,
                .err => |*e| {
                    this.base.throw(e);
                    return;
                },
            };
            subproc.ref();
            this.spawn_arena_freed = true;
            arena.deinit();
        }

        fn setStdioFromRedirect(stdio: *[3]shell.subproc.Stdio, flags: ast.Cmd.RedirectFlags, val: shell.subproc.Stdio) void {
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
            log("Cmd(0x{x}) exit_code={any}", .{ @intFromPtr(this), this.exit_code });
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
            log("cmd exit code={d} has_finished={any} ({x})", .{ exit_code, has_finished, @intFromPtr(this) });
            if (has_finished) {
                this.state = .done;
                this.next();
                return;
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

                    this.exec.subproc.buffered_closed.deinit(this.base.eventLoop().allocator());
                } else {
                    this.exec.bltn.deinit();
                }
                this.exec = .none;
            }

            if (!this.spawn_arena_freed) {
                log("Spawn arena free", .{});
                this.spawn_arena.deinit();
            }
            this.freed = true;
            this.io.deref();
            this.base.interpreter.allocator.destroy(this);
        }

        pub fn bufferedInputClose(this: *Cmd) void {
            this.exec.subproc.buffered_closed.close(this, .stdin);
        }

        pub fn bufferedOutputClose(this: *Cmd, kind: Subprocess.OutKind, err: ?JSC.SystemError) void {
            switch (kind) {
                .stdout => this.bufferedOutputCloseStdout(err),
                .stderr => this.bufferedOutputCloseStderr(err),
            }
            if (this.hasFinished()) {
                this.parent.childDone(this, this.exit_code orelse 0);
            }
        }

        pub fn bufferedOutputCloseStdout(this: *Cmd, err: ?JSC.SystemError) void {
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.exec == .subproc);
            }
            log("cmd ({x}) close buffered stdout", .{@intFromPtr(this)});
            if (err) |e| {
                this.exit_code = @as(ExitCode, @intCast(@intFromEnum(e.getErrno())));
            }
            if (this.io.stdout == .fd and this.io.stdout.fd.captured != null and !this.node.redirect.redirectsElsewhere(.stdout)) {
                var buf = this.io.stdout.fd.captured.?;
                const the_slice = this.exec.subproc.child.stdout.pipe.slice();
                buf.append(bun.default_allocator, the_slice) catch bun.outOfMemory();
            }
            this.exec.subproc.buffered_closed.close(this, .{ .stdout = &this.exec.subproc.child.stdout });
            this.exec.subproc.child.closeIO(.stdout);
        }

        pub fn bufferedOutputCloseStderr(this: *Cmd, err: ?JSC.SystemError) void {
            if (comptime bun.Environment.allow_assert) {
                std.debug.assert(this.exec == .subproc);
            }
            log("cmd ({x}) close buffered stderr", .{@intFromPtr(this)});
            if (err) |e| {
                this.exit_code = @as(ExitCode, @intCast(@intFromEnum(e.getErrno())));
            }
            if (this.io.stderr == .fd and this.io.stderr.fd.captured != null and !this.node.redirect.redirectsElsewhere(.stderr)) {
                var buf = this.io.stderr.fd.captured.?;
                buf.append(bun.default_allocator, this.exec.subproc.child.stderr.pipe.slice()) catch bun.outOfMemory();
            }
            this.exec.subproc.buffered_closed.close(this, .{ .stderr = &this.exec.subproc.child.stderr });
            this.exec.subproc.child.closeIO(.stderr);
        }
    };

    pub const Builtin = struct {
        kind: Kind,
        stdin: BuiltinIO.Input,
        stdout: BuiltinIO.Output,
        stderr: BuiltinIO.Output,
        exit_code: ?ExitCode = null,

        export_env: *EnvMap,
        cmd_local_env: *EnvMap,

        arena: *bun.ArenaAllocator,
        /// The following are allocated with the above arena
        args: *const std.ArrayList(?[*:0]const u8),
        args_slice: ?[]const [:0]const u8 = null,
        cwd: bun.FileDescriptor,

        impl: union(Kind) {
            cat: Cat,
            touch: Touch,
            mkdir: Mkdir,
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
            cat,
            touch,
            mkdir,
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
                    .cat => "usage: cat [-belnstuv] [file ...]\n",
                    .touch => "usage: touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]]\n       [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...\n",
                    .mkdir => "usage: mkdir [-pv] [-m mode] directory_name ...\n",
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
                    .cat => "cat",
                    .touch => "touch",
                    .mkdir => "mkdir",
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
                if (!bun.Environment.isWindows) {
                    if (bun.strings.eqlComptime(str, "cat")) {
                        log("Cat builtin disabled on posix for now", .{});
                        return null;
                    }
                }
                @setEvalBranchQuota(5000);
                const tyinfo = @typeInfo(Builtin.Kind);
                inline for (tyinfo.Enum.fields) |field| {
                    if (bun.strings.eqlComptime(str, field.name)) {
                        return comptime std.meta.stringToEnum(Builtin.Kind, field.name).?;
                    }
                }
                return null;
            }
        };

        pub const BuiltinIO = struct {
            /// in the case of array buffer we simply need to write to the pointer
            /// in the case of blob, we write to the file descriptor
            pub const Output = union(enum) {
                fd: struct { writer: *IOWriter, captured: ?*bun.ByteList = null },
                /// array list not owned by this type
                buf: std.ArrayList(u8),
                arraybuf: ArrayBuf,
                blob: *Blob,
                ignore,

                const FdOutput = struct {
                    writer: *IOWriter,
                    captured: ?*bun.ByteList = null,

                    // pub fn
                };

                pub fn ref(this: *Output) *Output {
                    switch (this.*) {
                        .fd => {
                            this.fd.writer.ref();
                        },
                        .blob => this.blob.ref(),
                        else => {},
                    }
                    return this;
                }

                pub fn deref(this: *Output) void {
                    switch (this.*) {
                        .fd => {
                            this.fd.writer.deref();
                        },
                        .blob => this.blob.deref(),
                        else => {},
                    }
                }

                pub fn needsIO(this: *Output) bool {
                    return switch (this.*) {
                        .fd => true,
                        else => false,
                    };
                }

                pub fn enqueueFmtBltn(
                    this: *@This(),
                    ptr: anytype,
                    comptime kind: ?Interpreter.Builtin.Kind,
                    comptime fmt_: []const u8,
                    args: anytype,
                ) void {
                    if (bun.Environment.allow_assert) std.debug.assert(this.* == .fd);
                    this.fd.writer.enqueueFmtBltn(ptr, this.fd.captured, kind, fmt_, args);
                }

                pub fn enqueue(this: *@This(), ptr: anytype, buf: []const u8) void {
                    if (bun.Environment.allow_assert) std.debug.assert(this.* == .fd);
                    this.fd.writer.enqueue(ptr, this.fd.captured, buf);
                }
            };

            pub const Input = union(enum) {
                fd: *IOReader,
                /// array list not ownedby this type
                buf: std.ArrayList(u8),
                arraybuf: ArrayBuf,
                blob: *Blob,
                ignore,

                pub fn ref(this: *Input) *Input {
                    switch (this.*) {
                        .fd => {
                            this.fd.ref();
                        },
                        .blob => this.blob.ref(),
                        else => {},
                    }
                    return this;
                }

                pub fn deref(this: *Input) void {
                    switch (this.*) {
                        .fd => {
                            this.fd.deref();
                        },
                        .blob => this.blob.deref(),
                        else => {},
                    }
                }

                pub fn needsIO(this: *Input) bool {
                    return switch (this.*) {
                        .fd => true,
                        else => false,
                    };
                }
            };

            const ArrayBuf = struct {
                buf: JSC.ArrayBuffer.Strong,
                i: u32 = 0,
            };

            const Blob = struct {
                ref_count: usize = 1,
                blob: bun.JSC.WebCore.Blob,
                pub usingnamespace bun.NewRefCounted(Blob, Blob.deinit);

                pub fn deinit(this: *Blob) void {
                    this.blob.deinit();
                    bun.destroy(this);
                }
            };
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
                .cat => this.callImplWithType(Cat, Ret, "cat", field, args_),
                .touch => this.callImplWithType(Touch, Ret, "touch", field, args_),
                .mkdir => this.callImplWithType(Mkdir, Ret, "mkdir", field, args_),
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
            io: *IO,
            comptime in_cmd_subst: bool,
        ) CoroutineResult {
            const stdin: BuiltinIO.Input = switch (io.stdin) {
                .fd => |fd| .{ .fd = fd.refSelf() },
                .ignore => .ignore,
            };
            const stdout: BuiltinIO.Output = switch (io.stdout) {
                .fd => |val| .{ .fd = .{ .writer = val.writer.refSelf(), .captured = val.captured } },
                .pipe => .{ .buf = std.ArrayList(u8).init(bun.default_allocator) },
                .ignore => .ignore,
            };
            const stderr: BuiltinIO.Output = switch (io.stderr) {
                .fd => |val| .{ .fd = .{ .writer = val.writer.refSelf(), .captured = val.captured } },
                .pipe => .{ .buf = std.ArrayList(u8).init(bun.default_allocator) },
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
                .cat => {
                    cmd.exec.bltn.impl = .{
                        .cat = Cat{ .bltn = &cmd.exec.bltn },
                    };
                },
                .touch => {
                    cmd.exec.bltn.impl = .{
                        .touch = Touch{ .bltn = &cmd.exec.bltn },
                    };
                },
                .mkdir => {
                    cmd.exec.bltn.impl = .{
                        .mkdir = Mkdir{ .bltn = &cmd.exec.bltn },
                    };
                },
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
                            cmd.writeFailingError("bun: ambiguous redirect: at `{s}`\n", .{@tagName(kind)});
                            return .yield;
                        }

                        // Regular files are not pollable on linux
                        const is_pollable: bool = if (bun.Environment.isLinux) false else true;

                        const path = cmd.redirection_file.items[0..cmd.redirection_file.items.len -| 1 :0];
                        log("EXPANDED REDIRECT: {s}\n", .{cmd.redirection_file.items[0..]});
                        const perm = 0o666;
                        const is_nonblocking = false;
                        const flags = node.redirect.toFlags();
                        const redirfd = switch (ShellSyscall.openat(cmd.base.shell.cwd_fd, path, flags, perm)) {
                            .err => |e| {
                                cmd.writeFailingError("bun: {s}: {s}", .{ e.toSystemError().message, path });
                                return .yield;
                            },
                            .result => |f| f,
                        };
                        if (node.redirect.stdin) {
                            cmd.exec.bltn.stdin.deref();
                            cmd.exec.bltn.stdin = .{ .fd = IOReader.init(redirfd, cmd.base.eventLoop()) };
                        }
                        if (node.redirect.stdout) {
                            cmd.exec.bltn.stdout.deref();
                            cmd.exec.bltn.stdout = .{ .fd = .{ .writer = IOWriter.init(redirfd, .{ .pollable = is_pollable, .nonblocking = is_nonblocking }, cmd.base.eventLoop()) } };
                        }
                        if (node.redirect.stderr) {
                            cmd.exec.bltn.stderr.deref();
                            cmd.exec.bltn.stderr = .{ .fd = .{ .writer = IOWriter.init(redirfd, .{ .pollable = is_pollable, .nonblocking = is_nonblocking }, cmd.base.eventLoop()) } };
                        }
                    },
                    .jsbuf => |val| {
                        const globalObject = interpreter.event_loop.js.global;
                        if (interpreter.jsobjs[file.jsbuf.idx].asArrayBuffer(globalObject)) |buf| {
                            const arraybuf: BuiltinIO.ArrayBuf = .{ .buf = JSC.ArrayBuffer.Strong{
                                .array_buffer = buf,
                                .held = JSC.Strong.create(buf.value, globalObject),
                            }, .i = 0 };

                            if (node.redirect.stdin) {
                                cmd.exec.bltn.stdin.deref();
                                cmd.exec.bltn.stdin = .{ .arraybuf = arraybuf };
                            }

                            if (node.redirect.stdout) {
                                cmd.exec.bltn.stdout.deref();
                                cmd.exec.bltn.stdout = .{ .arraybuf = arraybuf };
                            }

                            if (node.redirect.stderr) {
                                cmd.exec.bltn.stderr.deref();
                                cmd.exec.bltn.stderr = .{ .arraybuf = arraybuf };
                            }
                        } else if (interpreter.jsobjs[file.jsbuf.idx].as(JSC.WebCore.Body.Value)) |body| {
                            if ((node.redirect.stdout or node.redirect.stderr) and !(body.* == .Blob and !body.Blob.needsToReadFile())) {
                                // TODO: Locked->stream -> file -> blob conversion via .toBlobIfPossible() except we want to avoid modifying the Response/Request if unnecessary.
                                cmd.base.interpreter.event_loop.js.global.throw("Cannot redirect stdout/stderr to an immutable blob. Expected a file", .{});
                                return .yield;
                            }

                            var original_blob = body.use();
                            defer original_blob.deinit();

                            const blob: *BuiltinIO.Blob = bun.new(BuiltinIO.Blob, .{
                                .blob = original_blob.dupe(),
                            });

                            if (node.redirect.stdin) {
                                cmd.exec.bltn.stdin.deref();
                                cmd.exec.bltn.stdin = .{ .blob = blob };
                            }

                            if (node.redirect.stdout) {
                                cmd.exec.bltn.stdout.deref();
                                cmd.exec.bltn.stdout = .{ .blob = blob };
                            }

                            if (node.redirect.stderr) {
                                cmd.exec.bltn.stderr.deref();
                                cmd.exec.bltn.stderr = .{ .blob = blob };
                            }
                        } else if (interpreter.jsobjs[file.jsbuf.idx].as(JSC.WebCore.Blob)) |blob| {
                            if ((node.redirect.stdout or node.redirect.stderr) and !blob.needsToReadFile()) {
                                // TODO: Locked->stream -> file -> blob conversion via .toBlobIfPossible() except we want to avoid modifying the Response/Request if unnecessary.
                                cmd.base.interpreter.event_loop.js.global.throw("Cannot redirect stdout/stderr to an immutable blob. Expected a file", .{});
                                return .yield;
                            }

                            const theblob: *BuiltinIO.Blob = bun.new(BuiltinIO.Blob, .{ .blob = blob.dupe() });

                            if (node.redirect.stdin) {
                                cmd.exec.bltn.stdin.deref();
                                cmd.exec.bltn.stdin = .{ .blob = theblob };
                            } else if (node.redirect.stdout) {
                                cmd.exec.bltn.stdout.deref();
                                cmd.exec.bltn.stdout = .{ .blob = theblob };
                            } else if (node.redirect.stderr) {
                                cmd.exec.bltn.stderr.deref();
                                cmd.exec.bltn.stderr = .{ .blob = theblob };
                            }
                        } else {
                            const jsval = cmd.base.interpreter.jsobjs[val.idx];
                            cmd.base.interpreter.event_loop.js.global.throw("Unknown JS value used in shell: {}", .{jsval.fmtString(globalObject)});
                            return .yield;
                        }
                    },
                }
            } else if (node.redirect.duplicate_out) {
                if (node.redirect.stdout) {
                    cmd.exec.bltn.stderr.deref();
                    cmd.exec.bltn.stderr = cmd.exec.bltn.stdout.ref().*;
                }

                if (node.redirect.stderr) {
                    cmd.exec.bltn.stdout.deref();
                    cmd.exec.bltn.stdout = cmd.exec.bltn.stderr.ref().*;
                }
            }

            return .cont;
        }

        pub inline fn eventLoop(this: *const Builtin) JSC.EventLoopHandle {
            return this.parentCmd().base.eventLoop();
        }

        pub inline fn throw(this: *const Builtin, err: *const bun.shell.ShellErr) void {
            this.parentCmd().base.throw(err);
        }

        pub inline fn parentCmd(this: *const Builtin) *const Cmd {
            const union_ptr = @fieldParentPtr(Cmd.Exec, "bltn", this);
            return @fieldParentPtr(Cmd, "exec", union_ptr);
        }

        pub inline fn parentCmdMut(this: *Builtin) *Cmd {
            const union_ptr = @fieldParentPtr(Cmd.Exec, "bltn", this);
            return @fieldParentPtr(Cmd, "exec", union_ptr);
        }

        pub fn done(this: *Builtin, exit_code: anytype) void {
            const code: ExitCode = switch (@TypeOf(exit_code)) {
                bun.C.E => @intFromEnum(exit_code),
                u1, u8, u16 => exit_code,
                comptime_int => exit_code,
                else => @compileError("Invalid type: " ++ @typeName(@TypeOf(exit_code))),
            };
            this.exit_code = code;

            var cmd = this.parentCmdMut();
            log("builtin done ({s}: exit={d}) cmd to free: ({x})", .{ @tagName(this.kind), code, @intFromPtr(cmd) });
            cmd.exit_code = this.exit_code.?;

            // Aggregate output data if shell state is piped and this cmd is piped
            if (cmd.io.stdout == .pipe and cmd.io.stdout == .pipe and this.stdout == .buf) {
                cmd.base.shell.buffered_stdout().append(bun.default_allocator, this.stdout.buf.items[0..]) catch bun.outOfMemory();
            }
            // Aggregate output data if shell state is piped and this cmd is piped
            if (cmd.io.stderr == .pipe and cmd.io.stderr == .pipe and this.stderr == .buf) {
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

            this.stdout.deref();
            this.stderr.deref();
            this.stdin.deref();

            // Parent cmd frees this
            // this.arena.deinit();
        }

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

        pub fn readStdinNoIO(this: *Builtin) []const u8 {
            return switch (this.stdin) {
                .arraybuf => |buf| buf.buf.slice(),
                .buf => |buf| buf.items[0..],
                .blob => |blob| blob.blob.sharedView(),
                else => "",
            };
        }

        pub fn writeNoIO(this: *Builtin, comptime io_kind: @Type(.EnumLiteral), buf: []const u8) usize {
            if (comptime io_kind != .stdout and io_kind != .stderr) {
                @compileError("Bad IO" ++ @tagName(io_kind));
            }

            if (buf.len == 0) return 0;

            var io: *BuiltinIO.Output = &@field(this, @tagName(io_kind));

            switch (io.*) {
                .fd => @panic("writeNoIO can't write to a file descriptor"),
                .buf => {
                    log("{s} write to buf len={d} str={s}{s}\n", .{ this.kind.asString(), buf.len, buf[0..@min(buf.len, 16)], if (buf.len > 16) "..." else "" });
                    io.buf.appendSlice(buf) catch bun.outOfMemory();
                    return buf.len;
                },
                .arraybuf => {
                    if (io.arraybuf.i >= io.arraybuf.buf.array_buffer.byte_len) {
                        // TODO is it correct to return an error here? is this error the correct one to return?
                        // return Maybe(usize).initErr(Syscall.Error.fromCode(bun.C.E.NOSPC, .write));
                        @panic("TODO shell: forgot this");
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
                    return write_len;
                },
                .blob, .ignore => return buf.len,
            }
        }

        /// Error messages formatted to match bash
        fn taskErrorToString(this: *Builtin, comptime kind: Kind, err: anytype) []const u8 {
            switch (@TypeOf(err)) {
                Syscall.Error => return switch (err.getErrno()) {
                    bun.C.E.NOENT => this.fmtErrorArena(kind, "{s}: No such file or directory\n", .{err.path}),
                    bun.C.E.NAMETOOLONG => this.fmtErrorArena(kind, "{s}: File name too long\n", .{err.path}),
                    bun.C.E.ISDIR => this.fmtErrorArena(kind, "{s}: is a directory\n", .{err.path}),
                    bun.C.E.NOTEMPTY => this.fmtErrorArena(kind, "{s}: Directory not empty\n", .{err.path}),
                    else => this.fmtErrorArena(kind, "{s}\n", .{err.toSystemError().message.byteSlice()}),
                },
                JSC.SystemError => {
                    if (err.path.length() == 0) return this.fmtErrorArena(kind, "{s}\n", .{err.message.byteSlice()});
                    return this.fmtErrorArena(kind, "{s}: {s}\n", .{ err.message.byteSlice(), err.path });
                },
                bun.shell.ShellErr => return switch (err) {
                    .sys => this.taskErrorToString(kind, err.sys),
                    .custom => this.fmtErrorArena(kind, "{s}\n", .{err.custom}),
                    .invalid_arguments => this.fmtErrorArena(kind, "{s}\n", .{err.invalid_arguments.val}),
                    .todo => this.fmtErrorArena(kind, "{s}\n", .{err.todo}),
                },
                else => @compileError("Bad type: " ++ @typeName(err)),
            }
        }

        pub fn fmtErrorArena(this: *Builtin, comptime kind: ?Kind, comptime fmt_: []const u8, args: anytype) []u8 {
            const cmd_str = comptime if (kind) |k| k.asString() ++ ": " else "";
            const fmt = cmd_str ++ fmt_;
            return std.fmt.allocPrint(this.arena.allocator(), fmt, args) catch bun.outOfMemory();
        }

        pub const Cat = struct {
            const print = bun.Output.scoped(.ShellCat, false);

            bltn: *Builtin,
            opts: Opts = .{},
            state: union(enum) {
                idle,
                exec_stdin: struct {
                    in_done: bool = false,
                    chunks_queued: usize = 0,
                    chunks_done: usize = 0,
                    errno: ExitCode = 0,
                },
                exec_filepath_args: struct {
                    args: []const [*:0]const u8,
                    idx: usize = 0,
                    reader: ?*IOReader = null,
                    chunks_queued: usize = 0,
                    chunks_done: usize = 0,
                    out_done: bool = false,
                    in_done: bool = false,

                    pub fn deinit(this: *@This()) void {
                        if (this.reader) |r| r.deref();
                    }
                },
                waiting_write_err,
                done,
            } = .idle,

            pub fn writeFailingError(this: *Cat, buf: []const u8, exit_code: ExitCode) Maybe(void) {
                if (this.bltn.stderr.needsIO()) {
                    this.state = .waiting_write_err;
                    this.bltn.stderr.enqueue(this, buf);
                    return Maybe(void).success;
                }

                _ = this.bltn.writeNoIO(.stderr, buf);

                this.bltn.done(exit_code);
                return Maybe(void).success;
            }

            pub fn start(this: *Cat) Maybe(void) {
                const filepath_args = switch (this.opts.parse(this.bltn.argsSlice())) {
                    .ok => |filepath_args| filepath_args,
                    .err => |e| {
                        const buf = switch (e) {
                            .illegal_option => |opt_str| this.bltn.fmtErrorArena(.cat, "illegal option -- {s}\n", .{opt_str}),
                            .show_usage => Builtin.Kind.cat.usageString(),
                            .unsupported => |unsupported| this.bltn.fmtErrorArena(.cat, "unsupported option, please open a GitHub issue -- {s}\n", .{unsupported}),
                        };

                        _ = this.writeFailingError(buf, 1);
                        return Maybe(void).success;
                    },
                };

                const should_read_from_stdin = filepath_args == null or filepath_args.?.len == 0;

                if (should_read_from_stdin) {
                    this.state = .{
                        .exec_stdin = .{},
                    };
                } else {
                    this.state = .{
                        .exec_filepath_args = .{
                            .args = filepath_args.?,
                        },
                    };
                }

                _ = this.next();

                return Maybe(void).success;
            }

            pub fn next(this: *Cat) void {
                switch (this.state) {
                    .idle => @panic("Invalid state"),
                    .exec_stdin => {
                        if (!this.bltn.stdin.needsIO()) {
                            this.state.exec_stdin.in_done = true;
                            const buf = this.bltn.readStdinNoIO();
                            if (!this.bltn.stdout.needsIO()) {
                                _ = this.bltn.writeNoIO(.stdout, buf);
                                this.bltn.done(0);
                                return;
                            }
                            this.bltn.stdout.enqueue(this, buf);
                            return;
                        }
                        this.bltn.stdin.fd.addReader(this);
                        this.bltn.stdin.fd.start();
                        return;
                    },
                    .exec_filepath_args => {
                        var exec = &this.state.exec_filepath_args;
                        if (exec.idx >= exec.args.len) {
                            exec.deinit();
                            return this.bltn.done(0);
                        }

                        if (exec.reader) |r| r.deref();

                        const arg = std.mem.span(exec.args[exec.idx]);
                        exec.idx += 1;
                        const dir = this.bltn.parentCmd().base.shell.cwd_fd;
                        const fd = switch (ShellSyscall.openat(dir, arg, os.O.RDONLY, 0)) {
                            .result => |fd| fd,
                            .err => |e| {
                                const buf = this.bltn.taskErrorToString(.cat, e);
                                _ = this.writeFailingError(buf, 1);
                                exec.deinit();
                                return;
                            },
                        };

                        const reader = IOReader.init(fd, this.bltn.eventLoop());
                        exec.chunks_done = 0;
                        exec.chunks_queued = 0;
                        exec.reader = reader;
                        exec.reader.?.addReader(this);
                        exec.reader.?.start();
                    },
                    .waiting_write_err => return,
                    .done => this.bltn.done(0),
                }
            }

            pub fn onIOWriterChunk(this: *Cat, _: usize, err: ?JSC.SystemError) void {
                print("onIOWriterChunk(0x{x}, {s}, had_err={any})", .{ @intFromPtr(this), @tagName(this.state), err != null });
                const errno: ExitCode = if (err) |e| brk: {
                    defer e.deref();
                    break :brk @as(ExitCode, @intCast(@intFromEnum(e.getErrno())));
                } else 0;
                // Writing to stdout errored, cancel everything and write error
                if (err) |e| {
                    defer e.deref();
                    switch (this.state) {
                        .exec_stdin => {
                            this.state.exec_stdin.errno = errno;
                            // Cancel reader if needed
                            if (!this.state.exec_stdin.in_done) {
                                if (this.bltn.stdin.needsIO()) {
                                    this.bltn.stdin.fd.removeReader(this);
                                }
                                this.state.exec_stdin.in_done = true;
                            }
                            this.bltn.done(e.getErrno());
                        },
                        .exec_filepath_args => {
                            var exec = &this.state.exec_filepath_args;
                            if (exec.reader) |r| {
                                r.removeReader(this);
                            }
                            exec.deinit();
                            this.bltn.done(e.getErrno());
                        },
                        .waiting_write_err => this.bltn.done(e.getErrno()),
                        else => @panic("Invalid state"),
                    }
                    return;
                }

                switch (this.state) {
                    .exec_stdin => {
                        this.state.exec_stdin.chunks_done += 1;
                        if (this.state.exec_stdin.in_done and (this.state.exec_stdin.chunks_done >= this.state.exec_stdin.chunks_queued)) {
                            this.bltn.done(0);
                            return;
                        }
                        // Need to wait for more chunks to be written
                    },
                    .exec_filepath_args => {
                        this.state.exec_filepath_args.chunks_done += 1;
                        if (this.state.exec_filepath_args.chunks_done >= this.state.exec_filepath_args.chunks_queued) {
                            this.state.exec_filepath_args.out_done = true;
                        }
                        if (this.state.exec_filepath_args.in_done and this.state.exec_filepath_args.out_done) {
                            this.next();
                            return;
                        }
                        // Wait for reader to be done
                        return;
                    },
                    .waiting_write_err => this.bltn.done(1),
                    else => @panic("Invalid state"),
                }
            }

            pub fn onIOReaderChunk(this: *Cat, chunk: []const u8) ReadChunkAction {
                print("onIOReaderChunk(0x{x}, {s}, chunk_len={d})", .{ @intFromPtr(this), @tagName(this.state), chunk.len });
                switch (this.state) {
                    .exec_stdin => {
                        if (this.bltn.stdout.needsIO()) {
                            this.state.exec_stdin.chunks_queued += 1;
                            this.bltn.stdout.enqueue(this, chunk);
                            return .cont;
                        }
                        _ = this.bltn.writeNoIO(.stdout, chunk);
                    },
                    .exec_filepath_args => {
                        if (this.bltn.stdout.needsIO()) {
                            this.state.exec_filepath_args.chunks_queued += 1;
                            this.bltn.stdout.enqueue(this, chunk);
                            return .cont;
                        }
                        _ = this.bltn.writeNoIO(.stdout, chunk);
                    },
                    else => @panic("Invalid state"),
                }
                return .cont;
            }

            pub fn onIOReaderDone(this: *Cat, err: ?JSC.SystemError) void {
                const errno: ExitCode = if (err) |e| brk: {
                    defer e.deref();
                    break :brk @as(ExitCode, @intCast(@intFromEnum(e.getErrno())));
                } else 0;
                print("onIOReaderDone(0x{x}, {s}, errno={d})", .{ @intFromPtr(this), @tagName(this.state), errno });

                switch (this.state) {
                    .exec_stdin => {
                        this.state.exec_stdin.errno = errno;
                        this.state.exec_stdin.in_done = true;
                        if (errno != 0) {
                            if ((this.state.exec_stdin.chunks_done >= this.state.exec_stdin.chunks_queued) or !this.bltn.stdout.needsIO()) {
                                this.bltn.done(errno);
                                return;
                            }
                            this.bltn.stdout.fd.writer.cancelChunks(this);
                            return;
                        }
                        if ((this.state.exec_stdin.chunks_done >= this.state.exec_stdin.chunks_queued) or !this.bltn.stdout.needsIO()) {
                            this.bltn.done(0);
                        }
                    },
                    .exec_filepath_args => {
                        this.state.exec_filepath_args.in_done = true;
                        if (errno != 0) {
                            if (this.state.exec_filepath_args.out_done or !this.bltn.stdout.needsIO()) {
                                this.state.exec_filepath_args.deinit();
                                this.bltn.done(errno);
                                return;
                            }
                            this.bltn.stdout.fd.writer.cancelChunks(this);
                            return;
                        }
                        if (this.state.exec_filepath_args.out_done or (this.state.exec_filepath_args.chunks_done >= this.state.exec_filepath_args.chunks_queued) or !this.bltn.stdout.needsIO()) {
                            this.next();
                        }
                    },
                    .done, .waiting_write_err, .idle => {},
                }
            }

            pub fn deinit(this: *Cat) void {
                _ = this; // autofix
            }

            const Opts = struct {
                /// -b
                ///
                /// Number the non-blank output lines, starting at 1.
                number_nonblank: bool = false,

                /// -e
                ///
                /// Display non-printing characters and display a dollar sign ($) at the end of each line.
                show_ends: bool = false,

                /// -n
                ///
                /// Number the output lines, starting at 1.
                number_all: bool = false,

                /// -s
                ///
                /// Squeeze multiple adjacent empty lines, causing the output to be single spaced.
                squeeze_blank: bool = false,

                /// -t
                ///
                /// Display non-printing characters and display tab characters as ^I at the end of each line.
                show_tabs: bool = false,

                /// -u
                ///
                /// Disable output buffering.
                disable_output_buffering: bool = false,

                /// -v
                ///
                /// Displays non-printing characters so they are visible.
                show_nonprinting: bool = false,

                const Parse = FlagParser(*@This());

                pub fn parse(opts: *Opts, args: []const [*:0]const u8) Result(?[]const [*:0]const u8, ParseError) {
                    return Parse.parseFlags(opts, args);
                }

                pub fn parseLong(this: *Opts, flag: []const u8) ?ParseFlagResult {
                    _ = this; // autofix
                    _ = flag;
                    return null;
                }

                fn parseShort(this: *Opts, char: u8, smallflags: []const u8, i: usize) ?ParseFlagResult {
                    _ = this; // autofix
                    switch (char) {
                        'b' => {
                            return .{ .unsupported = unsupportedFlag("-b") };
                        },
                        'e' => {
                            return .{ .unsupported = unsupportedFlag("-e") };
                        },
                        'n' => {
                            return .{ .unsupported = unsupportedFlag("-n") };
                        },
                        's' => {
                            return .{ .unsupported = unsupportedFlag("-s") };
                        },
                        't' => {
                            return .{ .unsupported = unsupportedFlag("-t") };
                        },
                        'u' => {
                            return .{ .unsupported = unsupportedFlag("-u") };
                        },
                        'v' => {
                            return .{ .unsupported = unsupportedFlag("-v") };
                        },
                        else => {
                            return .{ .illegal_option = smallflags[1 + i ..] };
                        },
                    }

                    return null;
                }
            };
        };

        pub const Touch = struct {
            bltn: *Builtin,
            opts: Opts = .{},
            state: union(enum) {
                idle,
                exec: struct {
                    started: bool = false,
                    tasks_count: usize = 0,
                    tasks_done: usize = 0,
                    output_done: usize = 0,
                    output_waiting: usize = 0,
                    started_output_queue: bool = false,
                    args: []const [*:0]const u8,
                    err: ?JSC.SystemError = null,
                },
                waiting_write_err,
                done,
            } = .idle,

            pub fn deinit(this: *Touch) void {
                _ = this;
            }

            pub fn start(this: *Touch) Maybe(void) {
                const filepath_args = switch (this.opts.parse(this.bltn.argsSlice())) {
                    .ok => |filepath_args| filepath_args,
                    .err => |e| {
                        const buf = switch (e) {
                            .illegal_option => |opt_str| this.bltn.fmtErrorArena(.touch, "illegal option -- {s}\n", .{opt_str}),
                            .show_usage => Builtin.Kind.touch.usageString(),
                            .unsupported => |unsupported| this.bltn.fmtErrorArena(.touch, "unsupported option, please open a GitHub issue -- {s}\n", .{unsupported}),
                        };

                        _ = this.writeFailingError(buf, 1);
                        return Maybe(void).success;
                    },
                } orelse {
                    _ = this.writeFailingError(Builtin.Kind.touch.usageString(), 1);
                    return Maybe(void).success;
                };

                this.state = .{
                    .exec = .{
                        .args = filepath_args,
                    },
                };

                _ = this.next();

                return Maybe(void).success;
            }

            pub fn next(this: *Touch) void {
                switch (this.state) {
                    .idle => @panic("Invalid state"),
                    .exec => {
                        var exec = &this.state.exec;
                        if (exec.started) {
                            if (this.state.exec.tasks_done >= this.state.exec.tasks_count and this.state.exec.output_done >= this.state.exec.output_waiting) {
                                const exit_code: ExitCode = if (this.state.exec.err != null) 1 else 0;
                                this.state = .done;
                                this.bltn.done(exit_code);
                                return;
                            }
                            return;
                        }

                        exec.started = true;
                        exec.tasks_count = exec.args.len;

                        for (exec.args) |dir_to_mk_| {
                            const dir_to_mk = dir_to_mk_[0..std.mem.len(dir_to_mk_) :0];
                            var task = ShellTouchTask.create(this, this.opts, dir_to_mk, this.bltn.parentCmd().base.shell.cwdZ());
                            task.schedule();
                        }
                    },
                    .waiting_write_err => return,
                    .done => this.bltn.done(0),
                }
            }

            pub fn onIOWriterChunk(this: *Touch, _: usize, e: ?JSC.SystemError) void {
                if (this.state == .waiting_write_err) {
                    return this.bltn.done(1);
                }

                if (e) |err| err.deref();

                this.next();
            }

            pub fn writeFailingError(this: *Touch, buf: []const u8, exit_code: ExitCode) Maybe(void) {
                if (this.bltn.stderr.needsIO()) {
                    this.state = .waiting_write_err;
                    this.bltn.stderr.enqueue(this, buf);
                    return Maybe(void).success;
                }

                _ = this.bltn.writeNoIO(.stderr, buf);

                this.bltn.done(exit_code);
                return Maybe(void).success;
            }

            pub fn onShellTouchTaskDone(this: *Touch, task: *ShellTouchTask) void {
                defer bun.default_allocator.destroy(task);
                this.state.exec.tasks_done += 1;
                const err = task.err;

                if (err) |e| {
                    const output_task: *ShellTouchOutputTask = bun.new(ShellTouchOutputTask, .{
                        .parent = this,
                        .output = .{ .arrlist = .{} },
                        .state = .waiting_write_err,
                    });
                    const error_string = this.bltn.taskErrorToString(.touch, e);
                    this.state.exec.err = e;
                    output_task.start(error_string);
                    return;
                }

                this.next();
            }

            pub const ShellTouchOutputTask = OutputTask(Touch, .{
                .writeErr = ShellTouchOutputTaskVTable.writeErr,
                .onWriteErr = ShellTouchOutputTaskVTable.onWriteErr,
                .writeOut = ShellTouchOutputTaskVTable.writeOut,
                .onWriteOut = ShellTouchOutputTaskVTable.onWriteOut,
                .onDone = ShellTouchOutputTaskVTable.onDone,
            });

            const ShellTouchOutputTaskVTable = struct {
                pub fn writeErr(this: *Touch, childptr: anytype, errbuf: []const u8) CoroutineResult {
                    if (this.bltn.stderr.needsIO()) {
                        this.state.exec.output_waiting += 1;
                        this.bltn.stderr.enqueue(childptr, errbuf);
                        return .yield;
                    }
                    _ = this.bltn.writeNoIO(.stderr, errbuf);
                    return .cont;
                }

                pub fn onWriteErr(this: *Touch) void {
                    this.state.exec.output_done += 1;
                }

                pub fn writeOut(this: *Touch, childptr: anytype, output: *OutputSrc) CoroutineResult {
                    if (this.bltn.stdout.needsIO()) {
                        this.state.exec.output_waiting += 1;
                        const slice = output.slice();
                        log("THE SLICE: {d} {s}", .{ slice.len, slice });
                        this.bltn.stdout.enqueue(childptr, slice);
                        return .yield;
                    }
                    _ = this.bltn.writeNoIO(.stdout, output.slice());
                    return .cont;
                }

                pub fn onWriteOut(this: *Touch) void {
                    this.state.exec.output_done += 1;
                }

                pub fn onDone(this: *Touch) void {
                    this.next();
                }
            };

            pub const ShellTouchTask = struct {
                touch: *Touch,

                opts: Opts,
                filepath: [:0]const u8,
                cwd_path: [:0]const u8,

                err: ?JSC.SystemError = null,
                task: JSC.WorkPoolTask = .{ .callback = &runFromThreadPool },
                event_loop: JSC.EventLoopHandle,
                concurrent_task: JSC.EventLoopTask,

                const print = bun.Output.scoped(.ShellTouchTask, false);

                pub fn deinit(this: *ShellTouchTask) void {
                    if (this.err) |e| {
                        e.deref();
                    }
                    bun.default_allocator.destroy(this);
                }

                pub fn create(touch: *Touch, opts: Opts, filepath: [:0]const u8, cwd_path: [:0]const u8) *ShellTouchTask {
                    const task = bun.default_allocator.create(ShellTouchTask) catch bun.outOfMemory();
                    task.* = ShellTouchTask{
                        .touch = touch,
                        .opts = opts,
                        .cwd_path = cwd_path,
                        .filepath = filepath,
                        .event_loop = touch.bltn.eventLoop(),
                        .concurrent_task = JSC.EventLoopTask.fromEventLoop(touch.bltn.eventLoop()),
                    };
                    return task;
                }

                pub fn schedule(this: *@This()) void {
                    print("schedule", .{});
                    WorkPool.schedule(&this.task);
                }

                pub fn runFromMainThread(this: *@This()) void {
                    print("runFromJS", .{});
                    this.touch.onShellTouchTaskDone(this);
                }

                pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
                    this.runFromMainThread();
                }

                fn runFromThreadPool(task: *JSC.WorkPoolTask) void {
                    var this: *ShellTouchTask = @fieldParentPtr(ShellTouchTask, "task", task);

                    // We have to give an absolute path
                    const filepath: [:0]const u8 = brk: {
                        if (ResolvePath.Platform.auto.isAbsolute(this.filepath)) break :brk this.filepath;
                        const parts: []const []const u8 = &.{
                            this.cwd_path[0..],
                            this.filepath[0..],
                        };
                        break :brk ResolvePath.joinZ(parts, .auto);
                    };

                    var node_fs = JSC.Node.NodeFS{};
                    const milliseconds: f64 = @floatFromInt(std.time.milliTimestamp());
                    const atime: JSC.Node.TimeLike = if (bun.Environment.isWindows) milliseconds / 1000.0 else JSC.Node.TimeLike{
                        .tv_sec = @intFromFloat(@divFloor(milliseconds, std.time.ms_per_s)),
                        .tv_nsec = @intFromFloat(@mod(milliseconds, std.time.ms_per_s) * std.time.ns_per_ms),
                    };
                    const mtime = atime;
                    const args = JSC.Node.Arguments.Utimes{
                        .atime = atime,
                        .mtime = mtime,
                        .path = .{ .string = bun.PathString.init(filepath) },
                    };
                    if (node_fs.utimes(args, .callback).asErr()) |err| out: {
                        if (err.getErrno() == bun.C.E.NOENT) {
                            const perm = 0o664;
                            switch (Syscall.open(filepath, std.os.O.CREAT | std.os.O.WRONLY, perm)) {
                                .result => break :out,
                                .err => |e| {
                                    this.err = e.withPath(bun.default_allocator.dupe(u8, filepath) catch bun.outOfMemory()).toSystemError();
                                    break :out;
                                },
                            }
                        }
                        this.err = err.withPath(bun.default_allocator.dupe(u8, filepath) catch bun.outOfMemory()).toSystemError();
                    }

                    if (this.event_loop == .js) {
                        this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
                    } else {
                        this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
                    }
                }
            };

            const Opts = struct {
                /// -a
                ///
                /// change only the access time
                access_time_only: bool = false,

                /// -c, --no-create
                ///
                /// do not create any files
                no_create: bool = false,

                /// -d, --date=STRING
                ///
                /// parse STRING and use it instead of current time
                date: ?[]const u8 = null,

                /// -h, --no-dereference
                ///
                /// affect each symbolic link instead of any referenced file
                /// (useful only on systems that can change the timestamps of a symlink)
                no_dereference: bool = false,

                /// -m
                ///
                /// change only the modification time
                modification_time_only: bool = false,

                /// -r, --reference=FILE
                ///
                /// use this file's times instead of current time
                reference: ?[]const u8 = null,

                /// -t STAMP
                ///
                /// use [[CC]YY]MMDDhhmm[.ss] instead of current time
                timestamp: ?[]const u8 = null,

                /// --time=WORD
                ///
                /// change the specified time:
                /// WORD is access, atime, or use: equivalent to -a
                /// WORD is modify or mtime: equivalent to -m
                time: ?[]const u8 = null,

                const Parse = FlagParser(*@This());

                pub fn parse(opts: *Opts, args: []const [*:0]const u8) Result(?[]const [*:0]const u8, ParseError) {
                    return Parse.parseFlags(opts, args);
                }

                pub fn parseLong(this: *Opts, flag: []const u8) ?ParseFlagResult {
                    _ = this;
                    if (bun.strings.eqlComptime(flag, "--no-create")) {
                        return .{
                            .unsupported = unsupportedFlag("--no-create"),
                        };
                    }

                    if (bun.strings.eqlComptime(flag, "--date")) {
                        return .{
                            .unsupported = unsupportedFlag("--date"),
                        };
                    }

                    if (bun.strings.eqlComptime(flag, "--reference")) {
                        return .{
                            .unsupported = unsupportedFlag("--reference=FILE"),
                        };
                    }

                    if (bun.strings.eqlComptime(flag, "--time")) {
                        return .{
                            .unsupported = unsupportedFlag("--reference=FILE"),
                        };
                    }

                    return null;
                }

                fn parseShort(this: *Opts, char: u8, smallflags: []const u8, i: usize) ?ParseFlagResult {
                    _ = this;
                    switch (char) {
                        'a' => {
                            return .{ .unsupported = unsupportedFlag("-a") };
                        },
                        'c' => {
                            return .{ .unsupported = unsupportedFlag("-c") };
                        },
                        'd' => {
                            return .{ .unsupported = unsupportedFlag("-d") };
                        },
                        'h' => {
                            return .{ .unsupported = unsupportedFlag("-h") };
                        },
                        'm' => {
                            return .{ .unsupported = unsupportedFlag("-m") };
                        },
                        'r' => {
                            return .{ .unsupported = unsupportedFlag("-r") };
                        },
                        't' => {
                            return .{ .unsupported = unsupportedFlag("-t") };
                        },
                        else => {
                            return .{ .illegal_option = smallflags[1 + i ..] };
                        },
                    }

                    return null;
                }
            };
        };

        pub const Mkdir = struct {
            bltn: *Builtin,
            opts: Opts = .{},
            state: union(enum) {
                idle,
                exec: struct {
                    started: bool = false,
                    tasks_count: usize = 0,
                    tasks_done: usize = 0,
                    output_waiting: u16 = 0,
                    output_done: u16 = 0,
                    args: []const [*:0]const u8,
                    err: ?JSC.SystemError = null,
                },
                waiting_write_err,
                done,
            } = .idle,

            pub fn onIOWriterChunk(this: *Mkdir, _: usize, e: ?JSC.SystemError) void {
                if (e) |err| err.deref();

                switch (this.state) {
                    .waiting_write_err => return this.bltn.done(1),
                    .exec => {
                        this.state.exec.output_done += 1;
                    },
                    .idle, .done => @panic("Invalid state"),
                }

                this.next();
            }
            pub fn writeFailingError(this: *Mkdir, buf: []const u8, exit_code: ExitCode) Maybe(void) {
                if (this.bltn.stderr.needsIO()) {
                    this.state = .waiting_write_err;
                    this.bltn.stderr.enqueue(this, buf);
                    return Maybe(void).success;
                }

                _ = this.bltn.writeNoIO(.stderr, buf);
                // if (this.bltn.writeNoIO(.stderr, buf).asErr()) |e| {
                //     return .{ .err = e };
                // }

                this.bltn.done(exit_code);
                return Maybe(void).success;
            }

            pub fn start(this: *Mkdir) Maybe(void) {
                const filepath_args = switch (this.opts.parse(this.bltn.argsSlice())) {
                    .ok => |filepath_args| filepath_args,
                    .err => |e| {
                        const buf = switch (e) {
                            .illegal_option => |opt_str| this.bltn.fmtErrorArena(.mkdir, "illegal option -- {s}\n", .{opt_str}),
                            .show_usage => Builtin.Kind.mkdir.usageString(),
                            .unsupported => |unsupported| this.bltn.fmtErrorArena(.mkdir, "unsupported option, please open a GitHub issue -- {s}\n", .{unsupported}),
                        };

                        _ = this.writeFailingError(buf, 1);
                        return Maybe(void).success;
                    },
                } orelse {
                    _ = this.writeFailingError(Builtin.Kind.mkdir.usageString(), 1);
                    return Maybe(void).success;
                };

                this.state = .{
                    .exec = .{
                        .args = filepath_args,
                    },
                };

                _ = this.next();

                return Maybe(void).success;
            }

            pub fn next(this: *Mkdir) void {
                switch (this.state) {
                    .idle => @panic("Invalid state"),
                    .exec => {
                        var exec = &this.state.exec;
                        if (exec.started) {
                            if (this.state.exec.tasks_done >= this.state.exec.tasks_count and this.state.exec.output_done >= this.state.exec.output_waiting) {
                                const exit_code: ExitCode = if (this.state.exec.err != null) 1 else 0;
                                if (this.state.exec.err) |e| e.deref();
                                this.state = .done;
                                this.bltn.done(exit_code);
                                return;
                            }
                            return;
                        }

                        exec.started = true;
                        exec.tasks_count = exec.args.len;

                        for (exec.args) |dir_to_mk_| {
                            const dir_to_mk = dir_to_mk_[0..std.mem.len(dir_to_mk_) :0];
                            var task = ShellMkdirTask.create(this, this.opts, dir_to_mk, this.bltn.parentCmd().base.shell.cwdZ());
                            task.schedule();
                        }
                    },
                    .waiting_write_err => return,
                    .done => this.bltn.done(0),
                }
            }

            pub fn onShellMkdirTaskDone(this: *Mkdir, task: *ShellMkdirTask) void {
                defer bun.default_allocator.destroy(task);
                this.state.exec.tasks_done += 1;
                var output = task.takeOutput();
                const err = task.err;
                const output_task: *ShellMkdirOutputTask = bun.new(ShellMkdirOutputTask, .{
                    .parent = this,
                    .output = .{ .arrlist = output.moveToUnmanaged() },
                    .state = .waiting_write_err,
                });

                if (err) |e| {
                    const error_string = this.bltn.taskErrorToString(.mkdir, e);
                    this.state.exec.err = e;
                    output_task.start(error_string);
                    return;
                }
                output_task.start(null);
            }

            pub const ShellMkdirOutputTask = OutputTask(Mkdir, .{
                .writeErr = ShellMkdirOutputTaskVTable.writeErr,
                .onWriteErr = ShellMkdirOutputTaskVTable.onWriteErr,
                .writeOut = ShellMkdirOutputTaskVTable.writeOut,
                .onWriteOut = ShellMkdirOutputTaskVTable.onWriteOut,
                .onDone = ShellMkdirOutputTaskVTable.onDone,
            });

            const ShellMkdirOutputTaskVTable = struct {
                pub fn writeErr(this: *Mkdir, childptr: anytype, errbuf: []const u8) CoroutineResult {
                    if (this.bltn.stderr.needsIO()) {
                        this.state.exec.output_waiting += 1;
                        this.bltn.stderr.enqueue(childptr, errbuf);
                        return .yield;
                    }
                    _ = this.bltn.writeNoIO(.stderr, errbuf);
                    return .cont;
                }

                pub fn onWriteErr(this: *Mkdir) void {
                    this.state.exec.output_done += 1;
                }

                pub fn writeOut(this: *Mkdir, childptr: anytype, output: *OutputSrc) CoroutineResult {
                    if (this.bltn.stdout.needsIO()) {
                        this.state.exec.output_waiting += 1;
                        const slice = output.slice();
                        log("THE SLICE: {d} {s}", .{ slice.len, slice });
                        this.bltn.stdout.enqueue(childptr, slice);
                        return .yield;
                    }
                    _ = this.bltn.writeNoIO(.stdout, output.slice());
                    return .cont;
                }

                pub fn onWriteOut(this: *Mkdir) void {
                    this.state.exec.output_done += 1;
                }

                pub fn onDone(this: *Mkdir) void {
                    this.next();
                }
            };

            pub fn deinit(this: *Mkdir) void {
                _ = this;
            }

            pub const ShellMkdirTask = struct {
                mkdir: *Mkdir,

                opts: Opts,
                filepath: [:0]const u8,
                cwd_path: [:0]const u8,
                created_directories: ArrayList(u8),

                err: ?JSC.SystemError = null,
                task: JSC.WorkPoolTask = .{ .callback = &runFromThreadPool },
                event_loop: JSC.EventLoopHandle,
                concurrent_task: JSC.EventLoopTask,

                const print = bun.Output.scoped(.ShellMkdirTask, false);

                fn takeOutput(this: *ShellMkdirTask) ArrayList(u8) {
                    const out = this.created_directories;
                    this.created_directories = ArrayList(u8).init(bun.default_allocator);
                    return out;
                }

                pub fn create(
                    mkdir: *Mkdir,
                    opts: Opts,
                    filepath: [:0]const u8,
                    cwd_path: [:0]const u8,
                ) *ShellMkdirTask {
                    const task = bun.default_allocator.create(ShellMkdirTask) catch bun.outOfMemory();
                    const evtloop = mkdir.bltn.parentCmd().base.eventLoop();
                    task.* = ShellMkdirTask{
                        .mkdir = mkdir,
                        .opts = opts,
                        .cwd_path = cwd_path,
                        .filepath = filepath,
                        .created_directories = ArrayList(u8).init(bun.default_allocator),
                        .event_loop = evtloop,
                        .concurrent_task = JSC.EventLoopTask.fromEventLoop(evtloop),
                    };
                    return task;
                }

                pub fn schedule(this: *@This()) void {
                    print("schedule", .{});
                    WorkPool.schedule(&this.task);
                }

                pub fn runFromMainThread(this: *@This()) void {
                    print("runFromJS", .{});
                    this.mkdir.onShellMkdirTaskDone(this);
                }

                pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
                    this.runFromMainThread();
                }

                fn runFromThreadPool(task: *JSC.WorkPoolTask) void {
                    var this: *ShellMkdirTask = @fieldParentPtr(ShellMkdirTask, "task", task);

                    // We have to give an absolute path to our mkdir
                    // implementation for it to work with cwd
                    const filepath: [:0]const u8 = brk: {
                        if (ResolvePath.Platform.auto.isAbsolute(this.filepath)) break :brk this.filepath;
                        const parts: []const []const u8 = &.{
                            this.cwd_path[0..],
                            this.filepath[0..],
                        };
                        break :brk ResolvePath.joinZ(parts, .auto);
                    };

                    var node_fs = JSC.Node.NodeFS{};
                    // Recursive
                    if (this.opts.parents) {
                        const args = JSC.Node.Arguments.Mkdir{
                            .path = JSC.Node.PathLike{ .string = bun.PathString.init(filepath) },
                            .recursive = true,
                            .always_return_none = true,
                        };

                        var vtable = MkdirVerboseVTable{ .inner = this, .active = this.opts.verbose };

                        switch (node_fs.mkdirRecursiveImpl(args, .callback, *MkdirVerboseVTable, &vtable)) {
                            .result => {},
                            .err => |e| {
                                this.err = e.withPath(bun.default_allocator.dupe(u8, filepath) catch bun.outOfMemory()).toSystemError();
                                std.mem.doNotOptimizeAway(&node_fs);
                            },
                        }
                    } else {
                        const args = JSC.Node.Arguments.Mkdir{
                            .path = JSC.Node.PathLike{ .string = bun.PathString.init(filepath) },
                            .recursive = false,
                            .always_return_none = true,
                        };
                        switch (node_fs.mkdirNonRecursive(args, .callback)) {
                            .result => {
                                if (this.opts.verbose) {
                                    this.created_directories.appendSlice(filepath[0..filepath.len]) catch bun.outOfMemory();
                                    this.created_directories.append('\n') catch bun.outOfMemory();
                                }
                            },
                            .err => |e| {
                                this.err = e.withPath(bun.default_allocator.dupe(u8, filepath) catch bun.outOfMemory()).toSystemError();
                                std.mem.doNotOptimizeAway(&node_fs);
                            },
                        }
                    }

                    if (this.event_loop == .js) {
                        this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
                    } else {
                        this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
                    }
                }

                const MkdirVerboseVTable = struct {
                    inner: *ShellMkdirTask,
                    active: bool,

                    pub fn onCreateDir(vtable: *@This(), dirpath: bun.OSPathSliceZ) void {
                        if (!vtable.active) return;
                        if (bun.Environment.isWindows) {
                            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                            const str = bun.strings.fromWPath(&buf, dirpath[0..dirpath.len]);
                            vtable.inner.created_directories.appendSlice(str) catch bun.outOfMemory();
                            vtable.inner.created_directories.append('\n') catch bun.outOfMemory();
                        } else {
                            vtable.inner.created_directories.appendSlice(dirpath) catch bun.outOfMemory();
                            vtable.inner.created_directories.append('\n') catch bun.outOfMemory();
                        }
                        return;
                    }
                };
            };

            const Opts = struct {
                /// -m, --mode
                ///
                /// set file mode (as in chmod), not a=rwx - umask
                mode: ?u32 = null,

                /// -p, --parents
                ///
                /// no error if existing, make parent directories as needed,
                /// with their file modes unaffected by any -m option.
                parents: bool = false,

                /// -v, --verbose
                ///
                /// print a message for each created directory
                verbose: bool = false,

                const Parse = FlagParser(*@This());

                pub fn parse(opts: *Opts, args: []const [*:0]const u8) Result(?[]const [*:0]const u8, ParseError) {
                    return Parse.parseFlags(opts, args);
                }

                pub fn parseLong(this: *Opts, flag: []const u8) ?ParseFlagResult {
                    if (bun.strings.eqlComptime(flag, "--mode")) {
                        return .{ .unsupported = "--mode" };
                    } else if (bun.strings.eqlComptime(flag, "--parents")) {
                        this.parents = true;
                        return .continue_parsing;
                    } else if (bun.strings.eqlComptime(flag, "--vebose")) {
                        this.verbose = true;
                        return .continue_parsing;
                    }

                    return null;
                }

                fn parseShort(this: *Opts, char: u8, smallflags: []const u8, i: usize) ?ParseFlagResult {
                    switch (char) {
                        'm' => {
                            return .{ .unsupported = "-m " };
                        },
                        'p' => {
                            this.parents = true;
                        },
                        'v' => {
                            this.verbose = true;
                        },
                        else => {
                            return .{ .illegal_option = smallflags[1 + i ..] };
                        },
                    }

                    return null;
                }
            };
        };

        pub const Export = struct {
            bltn: *Builtin,
            printing: bool = false,

            const Entry = struct {
                key: EnvStr,
                value: EnvStr,

                pub fn compare(context: void, this: @This(), other: @This()) bool {
                    return bun.strings.cmpStringsAsc(context, this.key.slice(), other.key.slice());
                }
            };

            pub fn writeOutput(this: *Export, comptime io_kind: @Type(.EnumLiteral), comptime fmt: []const u8, args: anytype) Maybe(void) {
                if (!this.bltn.stdout.needsIO()) {
                    const buf = this.bltn.fmtErrorArena(.@"export", fmt, args);
                    _ = this.bltn.writeNoIO(io_kind, buf);
                    this.bltn.done(0);
                    return Maybe(void).success;
                }

                var output: *BuiltinIO.Output = &@field(this.bltn, @tagName(io_kind));
                this.printing = true;
                output.enqueueFmtBltn(this, .@"export", fmt, args);
                return Maybe(void).success;
            }

            pub fn onIOWriterChunk(this: *Export, _: usize, e: ?JSC.SystemError) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.printing);
                }

                const exit_code: ExitCode = if (e != null) brk: {
                    defer e.?.deref();
                    break :brk @intFromEnum(e.?.getErrno());
                } else 0;

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
                        _ = this.bltn.writeNoIO(.stdout, buf);
                        this.bltn.done(0);
                        return Maybe(void).success;
                    }

                    this.printing = true;
                    this.bltn.stdout.enqueue(this, buf);

                    return Maybe(void).success;
                }

                for (args) |arg_raw| {
                    const arg_sentinel = arg_raw[0..std.mem.len(arg_raw) :0];
                    const arg = arg_sentinel[0..arg_sentinel.len];
                    if (arg.len == 0) continue;

                    const eqsign_idx = std.mem.indexOfScalar(u8, arg, '=') orelse {
                        if (!shell.isValidVarName(arg)) {
                            const buf = this.bltn.fmtErrorArena(.@"export", "`{s}`: not a valid identifier", .{arg});
                            return this.writeOutput(.stderr, "{s}\n", .{buf});
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

            state: union(enum) {
                idle,
                waiting,
                done,
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
                    _ = this.bltn.writeNoIO(.stdout, this.output.items[0..]);
                    this.state = .done;
                    this.bltn.done(0);
                    return Maybe(void).success;
                }

                this.state = .waiting;
                this.bltn.stdout.enqueue(this, this.output.items[0..]);
                return Maybe(void).success;
            }

            pub fn onIOWriterChunk(this: *Echo, _: usize, e: ?JSC.SystemError) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .waiting);
                }

                if (e != null) {
                    defer e.?.deref();
                    this.bltn.done(e.?.getErrno());
                    return;
                }

                this.state = .done;
                this.bltn.done(0);
            }

            pub fn deinit(this: *Echo) void {
                log("({s}) deinit", .{@tagName(.echo)});
                this.output.deinit();
            }
        };

        /// 1 arg  => returns absolute path of the arg (not found becomes exit code 1)
        /// N args => returns absolute path of each separated by newline, if any path is not found, exit code becomes 1, but continues execution until all args are processed
        pub const Which = struct {
            bltn: *Builtin,

            state: union(enum) {
                idle,
                one_arg,
                multi_args: struct {
                    args_slice: []const [*:0]const u8,
                    arg_idx: usize,
                    had_not_found: bool = false,
                    state: union(enum) {
                        none,
                        waiting_write,
                    },
                },
                done,
                err: JSC.SystemError,
            } = .idle,

            pub fn start(this: *Which) Maybe(void) {
                const args = this.bltn.argsSlice();
                if (args.len == 0) {
                    if (!this.bltn.stdout.needsIO()) {
                        _ = this.bltn.writeNoIO(.stdout, "\n");
                        this.bltn.done(1);
                        return Maybe(void).success;
                    }
                    this.state = .one_arg;
                    this.bltn.stdout.enqueue(this, "\n");
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
                            _ = this.bltn.writeNoIO(.stdout, buf);
                            continue;
                        };

                        _ = this.bltn.writeNoIO(.stdout, resolved);
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
                    multiargs.had_not_found = true;
                    if (!this.bltn.stdout.needsIO()) {
                        const buf = this.bltn.fmtErrorArena(null, "{s} not found\n", .{arg});
                        _ = this.bltn.writeNoIO(.stdout, buf);
                        this.argComplete();
                        return;
                    }
                    multiargs.state = .waiting_write;
                    this.bltn.stdout.enqueueFmtBltn(this, null, "{s} not found\n", .{arg});
                    // yield execution
                    return;
                };

                if (!this.bltn.stdout.needsIO()) {
                    const buf = this.bltn.fmtErrorArena(null, "{s}\n", .{resolved});
                    _ = this.bltn.writeNoIO(.stdout, buf);
                    this.argComplete();
                    return;
                }

                multiargs.state = .waiting_write;
                this.bltn.stdout.enqueueFmtBltn(this, null, "{s}\n", .{resolved});
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

            pub fn onIOWriterChunk(this: *Which, _: usize, e: ?JSC.SystemError) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .one_arg or
                        (this.state == .multi_args and this.state.multi_args.state == .waiting_write));
                }

                if (e != null) {
                    this.state = .{ .err = e.? };
                    this.bltn.done(e.?.getErrno());
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
                waiting_write_stderr,
                done,
                err: Syscall.Error,
            } = .idle,

            fn writeStderrNonBlocking(this: *Cd, comptime fmt: []const u8, args: anytype) void {
                this.state = .waiting_write_stderr;
                this.bltn.stderr.enqueueFmtBltn(this, .cd, fmt, args);
            }

            pub fn start(this: *Cd) Maybe(void) {
                const args = this.bltn.argsSlice();
                if (args.len > 1) {
                    this.writeStderrNonBlocking("too many arguments", .{});
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
                        if (!this.bltn.stderr.needsIO()) {
                            const buf = this.bltn.fmtErrorArena(.cd, "not a directory: {s}", .{new_cwd_});
                            _ = this.bltn.writeNoIO(.stderr, buf);
                            this.state = .done;
                            this.bltn.done(1);
                            // yield execution
                            return Maybe(void).success;
                        }

                        this.writeStderrNonBlocking("not a directory: {s}", .{new_cwd_});
                        return Maybe(void).success;
                    },
                    @as(usize, @intFromEnum(bun.C.E.NOENT)) => {
                        if (!this.bltn.stderr.needsIO()) {
                            const buf = this.bltn.fmtErrorArena(.cd, "not a directory: {s}", .{new_cwd_});
                            _ = this.bltn.writeNoIO(.stderr, buf);
                            this.state = .done;
                            this.bltn.done(1);
                            // yield execution
                            return Maybe(void).success;
                        }

                        this.writeStderrNonBlocking("not a directory: {s}", .{new_cwd_});
                        return Maybe(void).success;
                    },
                    else => return Maybe(void).success,
                }
            }

            pub fn onIOWriterChunk(this: *Cd, _: usize, e: ?JSC.SystemError) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .waiting_write_stderr);
                }

                if (e != null) {
                    defer e.?.deref();
                    this.bltn.done(e.?.getErrno());
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
                },
                err,
                done,
            } = .idle,

            pub fn start(this: *Pwd) Maybe(void) {
                const args = this.bltn.argsSlice();
                if (args.len > 0) {
                    const msg = "pwd: too many arguments";
                    if (this.bltn.stderr.needsIO()) {
                        this.state = .{ .waiting_io = .{ .kind = .stderr } };
                        this.bltn.stderr.enqueue(this, msg);
                        return Maybe(void).success;
                    }

                    _ = this.bltn.writeNoIO(.stderr, msg);

                    this.bltn.done(1);
                    return Maybe(void).success;
                }

                const cwd_str = this.bltn.parentCmd().base.shell.cwd();
                if (this.bltn.stdout.needsIO()) {
                    this.state = .{ .waiting_io = .{ .kind = .stdout } };
                    this.bltn.stdout.enqueueFmtBltn(this, null, "{s}\n", .{cwd_str});
                    return Maybe(void).success;
                }
                const buf = this.bltn.fmtErrorArena(null, "{s}\n", .{cwd_str});

                _ = this.bltn.writeNoIO(.stdout, buf);

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
                    this.bltn.done(1);
                    return;
                }
            }

            pub fn onIOWriterChunk(this: *Pwd, _: usize, e: ?JSC.SystemError) void {
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert(this.state == .waiting_io);
                }

                if (e != null) {
                    defer e.?.deref();
                    this.state = .err;
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
                    output_waiting: usize = 0,
                    output_done: usize = 0,
                },
                waiting_write_err,
                done,
            } = .idle,

            pub fn start(this: *Ls) Maybe(void) {
                this.next();
                return Maybe(void).success;
            }

            pub fn writeFailingError(this: *Ls, buf: []const u8, exit_code: ExitCode) Maybe(void) {
                if (this.bltn.stderr.needsIO()) {
                    this.bltn.stderr.enqueue(this, buf);
                    return Maybe(void).success;
                }

                _ = this.bltn.writeNoIO(.stderr, buf);

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
                                    var task = ShellLsTask.create(this, this.opts, &this.state.exec.task_count, cwd, path, this.bltn.eventLoop());
                                    task.schedule();
                                }
                            } else {
                                var task = ShellLsTask.create(this, this.opts, &this.state.exec.task_count, cwd, ".", this.bltn.eventLoop());
                                task.schedule();
                            }
                        },
                        .exec => {
                            // It's done
                            log("Ls(0x{x}, state=exec) Check: tasks_done={d} task_count={d} output_done={d} output_waiting={d}", .{
                                @intFromPtr(this),
                                this.state.exec.tasks_done,
                                this.state.exec.task_count.load(.Monotonic),
                                this.state.exec.output_done,
                                this.state.exec.output_waiting,
                            });
                            if (this.state.exec.tasks_done >= this.state.exec.task_count.load(.Monotonic) and this.state.exec.output_done >= this.state.exec.output_waiting) {
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

            pub fn onIOWriterChunk(this: *Ls, _: usize, e: ?JSC.SystemError) void {
                if (e) |err| err.deref();
                if (this.state == .waiting_write_err) {
                    return this.bltn.done(1);
                }
                this.state.exec.output_done += 1;
                this.next();
            }

            pub fn onShellLsTaskDone(this: *Ls, task: *ShellLsTask) void {
                defer task.deinit(true);
                this.state.exec.tasks_done += 1;
                var output = task.takeOutput();
                const err_ = task.err;

                // TODO: Reuse the *ShellLsTask allocation
                const output_task: *ShellLsOutputTask = bun.new(ShellLsOutputTask, .{
                    .parent = this,
                    .output = .{ .arrlist = output.moveToUnmanaged() },
                    .state = .waiting_write_err,
                });

                if (err_) |err| {
                    this.state.exec.err = err;
                    const error_string = this.bltn.taskErrorToString(.ls, err);
                    output_task.start(error_string);
                    return;
                }
                output_task.start(null);
            }

            pub const ShellLsOutputTask = OutputTask(Ls, .{
                .writeErr = ShellLsOutputTaskVTable.writeErr,
                .onWriteErr = ShellLsOutputTaskVTable.onWriteErr,
                .writeOut = ShellLsOutputTaskVTable.writeOut,
                .onWriteOut = ShellLsOutputTaskVTable.onWriteOut,
                .onDone = ShellLsOutputTaskVTable.onDone,
            });

            const ShellLsOutputTaskVTable = struct {
                pub fn writeErr(this: *Ls, childptr: anytype, errbuf: []const u8) CoroutineResult {
                    if (this.bltn.stderr.needsIO()) {
                        this.state.exec.output_waiting += 1;
                        this.bltn.stderr.enqueue(childptr, errbuf);
                        return .yield;
                    }
                    _ = this.bltn.writeNoIO(.stderr, errbuf);
                    return .cont;
                }

                pub fn onWriteErr(this: *Ls) void {
                    this.state.exec.output_done += 1;
                }

                pub fn writeOut(this: *Ls, childptr: anytype, output: *OutputSrc) CoroutineResult {
                    if (this.bltn.stdout.needsIO()) {
                        this.state.exec.output_waiting += 1;
                        this.bltn.stdout.enqueue(childptr, output.slice());
                        return .yield;
                    }
                    _ = this.bltn.writeNoIO(.stdout, output.slice());
                    return .cont;
                }

                pub fn onWriteOut(this: *Ls) void {
                    this.state.exec.output_done += 1;
                }

                pub fn onDone(this: *Ls) void {
                    this.next();
                }
            };

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

                event_loop: JSC.EventLoopHandle,
                concurrent_task: JSC.EventLoopTask,
                task: JSC.WorkPoolTask = .{
                    .callback = workPoolCallback,
                },

                pub fn schedule(this: *@This()) void {
                    JSC.WorkPool.schedule(&this.task);
                }

                pub fn create(ls: *Ls, opts: Opts, task_count: *std.atomic.Value(usize), cwd: bun.FileDescriptor, path: [:0]const u8, event_loop: JSC.EventLoopHandle) *@This() {
                    const task = bun.default_allocator.create(@This()) catch bun.outOfMemory();
                    task.* = @This(){
                        .ls = ls,
                        .opts = opts,
                        .cwd = cwd,
                        .path = bun.default_allocator.dupeZ(u8, path[0..path.len]) catch bun.outOfMemory(),
                        .output = std.ArrayList(u8).init(bun.default_allocator),
                        .concurrent_task = JSC.EventLoopTask.fromEventLoop(event_loop),
                        .event_loop = event_loop,
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
                    const fd = switch (ShellSyscall.openat(this.cwd, this.path, os.O.RDONLY | os.O.DIRECTORY, 0)) {
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
                    if (this.event_loop == .js) {
                        this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
                    } else {
                        this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
                    }
                }

                pub fn takeOutput(this: *@This()) std.ArrayList(u8) {
                    const ret = this.output;
                    this.output = std.ArrayList(u8).init(bun.default_allocator);
                    return ret;
                }

                pub fn runFromMainThread(this: *@This()) void {
                    print("runFromMainThread", .{});
                    this.ls.onShellLsTaskDone(this);
                }

                pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
                    this.runFromMainThread();
                }

                pub fn deinit(this: *@This(), comptime free_this: bool) void {
                    print("deinit {s}", .{if (free_this) "free_this=true" else "free_this=false"});
                    bun.default_allocator.free(this.path);
                    this.output.deinit();
                    if (comptime free_this) bun.default_allocator.destroy(this);
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
                    exit_code: ExitCode,
                },
                err,
            } = .idle,

            pub const ShellMvCheckTargetTask = struct {
                const print = bun.Output.scoped(.MvCheckTargetTask, false);
                mv: *Mv,

                cwd: bun.FileDescriptor,
                target: [:0]const u8,
                result: ?Maybe(?bun.FileDescriptor) = null,

                task: shell.eval.ShellTask(@This(), runFromThreadPool, runFromMainThread, print),

                pub fn runFromThreadPool(this: *@This()) void {
                    const fd = switch (ShellSyscall.openat(this.cwd, this.target, os.O.RDONLY | os.O.DIRECTORY, 0)) {
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

                task: shell.eval.ShellTask(@This(), runFromThreadPool, runFromMainThread, print),
                event_loop: JSC.EventLoopHandle,

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
                            if (e.getErrno() == .NOTDIR) {
                                this.err = e.withPath(this.target);
                            } else this.err = e;
                        },
                        else => {},
                    }
                }

                pub fn moveInDir(this: *@This(), src: [:0]const u8, buf: *[bun.MAX_PATH_BYTES]u8) bool {
                    const path_in_dir_ = bun.path.normalizeBuf(ResolvePath.basename(src), buf, .auto);
                    if (path_in_dir_.len + 1 >= buf.len) {
                        this.err = Syscall.Error.fromCode(bun.C.E.NAMETOOLONG, .rename);
                        return false;
                    }
                    buf[path_in_dir_.len] = 0;
                    const path_in_dir = buf[0..path_in_dir_.len :0];

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
                    this.state = .{ .waiting_write_err = .{ .exit_code = exit_code } };
                    this.bltn.stderr.enqueue(this, buf);
                    return Maybe(void).success;
                }

                _ = this.bltn.writeNoIO(.stderr, buf);

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
                                            .event_loop = this.bltn.parentCmd().base.eventLoop(),
                                            .concurrent_task = JSC.EventLoopTask.fromEventLoop(this.bltn.parentCmd().base.eventLoop()),
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

                            const count_per_task = ShellMvBatchedTask.BATCH_SIZE;

                            const task_count = brk: {
                                const sources_len: f64 = @floatFromInt(this.args.sources.len);
                                const batch_size: f64 = @floatFromInt(count_per_task);
                                const task_count: usize = @intFromFloat(@ceil(sources_len / batch_size));
                                break :brk task_count;
                            };

                            this.args.target_fd = maybe_fd;
                            const cwd_fd = this.bltn.parentCmd().base.shell.cwd_fd;
                            const tasks = this.bltn.arena.allocator().alloc(ShellMvBatchedTask, task_count) catch bun.outOfMemory();
                            // Initialize tasks
                            {
                                var i: usize = 0;
                                while (i < tasks.len) : (i += 1) {
                                    const start_idx = i * count_per_task;
                                    const end_idx = @min(start_idx + count_per_task, this.args.sources.len);
                                    const sources = this.args.sources[start_idx..end_idx];

                                    tasks[i] = ShellMvBatchedTask{
                                        .mv = this,
                                        .cwd = cwd_fd,
                                        .target = this.args.target,
                                        .target_fd = this.args.target_fd,
                                        .sources = sources,
                                        // We set this later
                                        .error_signal = undefined,
                                        .task = .{
                                            .event_loop = this.bltn.parentCmd().base.eventLoop(),
                                            .concurrent_task = JSC.EventLoopTask.fromEventLoop(this.bltn.parentCmd().base.eventLoop()),
                                        },
                                        .event_loop = this.bltn.parentCmd().base.eventLoop(),
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
                        // Shouldn't happen
                        .executing => {},
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

                this.bltn.done(1);
                return Maybe(void).success;
            }

            pub fn onIOWriterChunk(this: *Mv, _: usize, e: ?JSC.SystemError) void {
                defer if (e) |err| err.deref();
                switch (this.state) {
                    .waiting_write_err => {
                        if (e != null) {
                            this.state = .err;
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
                        const e = err.toSystemError();
                        const buf = this.bltn.fmtErrorArena(.mv, "{}: {}\n", .{ e.path, e.message });
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
                this.args.target = std.mem.span(filepath_args[filepath_args.len - 1]);

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
                        wait_write_err,
                    } = .normal,
                },
                exec: struct {
                    // task: RmTask,
                    filepath_args: []const [*:0]const u8,
                    total_tasks: usize,
                    err: ?Syscall.Error = null,
                    lock: std.Thread.Mutex = std.Thread.Mutex{},
                    error_signal: std.atomic.Value(bool) = .{ .raw = false },
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
                err: ExitCode,
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
                                            parse_opts.state = .wait_write_err;
                                            this.bltn.stderr.enqueue(this, error_string);
                                            return Maybe(void).success;
                                        }

                                        _ = this.bltn.writeNoIO(.stderr, error_string);

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
                                                    parse_opts.state = .wait_write_err;
                                                    this.bltn.stderr.enqueue(this, buf);
                                                    continue;
                                                }

                                                _ = this.bltn.writeNoIO(.stderr, buf);

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
                                                        if (this.bltn.stderr.needsIO()) {
                                                            parse_opts.state = .wait_write_err;
                                                            this.bltn.stderr.enqueueFmtBltn(this, .rm, "\"{s}\" may not be removed\n", .{resolved_path});
                                                            return Maybe(void).success;
                                                        }

                                                        const error_string = this.bltn.fmtErrorArena(.rm, "\"{s}\" may not be removed\n", .{resolved_path});

                                                        _ = this.bltn.writeNoIO(.stderr, error_string);

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
                                                parse_opts.state = .wait_write_err;
                                                this.bltn.stderr.enqueue(this, error_string);
                                                return Maybe(void).success;
                                            }

                                            _ = this.bltn.writeNoIO(.stderr, error_string);

                                            this.bltn.done(1);
                                            return Maybe(void).success;
                                        },
                                        .illegal_option_with_flag => {
                                            const flag = arg;
                                            if (this.bltn.stderr.needsIO()) {
                                                parse_opts.state = .wait_write_err;
                                                this.bltn.stderr.enqueueFmtBltn(this, .rm, "illegal option -- {s}\n", .{flag[1..]});
                                                return Maybe(void).success;
                                            }
                                            const error_string = this.bltn.fmtErrorArena(.rm, "illegal option -- {s}\n", .{flag[1..]});

                                            _ = this.bltn.writeNoIO(.stderr, error_string);

                                            this.bltn.done(1);
                                            return Maybe(void).success;
                                        },
                                    }
                                },
                                .wait_write_err => {
                                    @panic("Invalid");
                                    // // Errored
                                    // if (parse_opts.state.wait_write_err.err) |e| {
                                    //     this.state = .{ .err = e };
                                    //     continue;
                                    // }

                                    // // Done writing
                                    // if (this.state.parse_opts.state.wait_write_err.remain() == 0) {
                                    //     this.state = .{ .done = .{ .exit_code = 0 } };
                                    //     continue;
                                    // }

                                    // // yield execution to continue writing
                                    // return Maybe(void).success;
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
                    this.bltn.done(this.state.err);
                    return Maybe(void).success;
                }

                return Maybe(void).success;
            }

            pub fn onIOWriterChunk(this: *Rm, _: usize, e: ?JSC.SystemError) void {
                log("Rm(0x{x}).onIOWriterChunk()", .{@intFromPtr(this)});
                if (comptime bun.Environment.allow_assert) {
                    std.debug.assert((this.state == .parse_opts and this.state.parse_opts.state == .wait_write_err) or
                        (this.state == .exec and this.state.exec.state == .waiting and this.state.exec.output_count.load(.SeqCst) > 0));
                }

                if (this.state == .exec and this.state.exec.state == .waiting) {
                    log("Rm(0x{x}) output done={d} output count={d}", .{ @intFromPtr(this), this.state.exec.getOutputCount(.output_done), this.state.exec.getOutputCount(.output_count) });
                    this.state.exec.incrementOutputCount(.output_done);
                    if (this.state.exec.state.tasksDone() >= this.state.exec.total_tasks and this.state.exec.getOutputCount(.output_done) >= this.state.exec.getOutputCount(.output_count)) {
                        const code: ExitCode = if (this.state.exec.err != null) 1 else 0;
                        this.bltn.done(code);
                        return;
                    }
                    return;
                }

                if (e != null) {
                    defer e.?.deref();
                    this.state = .{ .err = @intFromEnum(e.?.getErrno()) };
                    this.bltn.done(e.?.getErrno());
                    return;
                }

                this.bltn.done(1);
                return;
            }

            // pub fn writeToStdoutFromAsyncTask(this: *Rm, comptime fmt: []const u8, args: anytype) Maybe(void) {
            //     const buf = this.rm.bltn.fmtErrorArena(null, fmt, args);
            //     if (!this.rm.bltn.stdout.needsIO()) {
            //         this.state.exec.lock.lock();
            //         defer this.state.exec.lock.unlock();
            //         _ = this.rm.bltn.writeNoIO(.stdout, buf);
            //         return Maybe(void).success;
            //     }

            //     var written: usize = 0;
            //     while (written < buf.len) : (written += switch (Syscall.write(this.rm.bltn.stdout.fd, buf)) {
            //         .err => |e| return Maybe(void).initErr(e),
            //         .result => |n| n,
            //     }) {}

            //     return Maybe(void).success;
            // }

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
                            return .illegal_option_with_flag;
                        },
                    }
                }

                return .continue_parsing;
            }

            pub fn onShellRmTaskDone(this: *Rm, task: *ShellRmTask) void {
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
                                _ = this.bltn.writeNoIO(.stderr, error_string);
                            } else {
                                log("Rm(0x{x}) task=0x{x} ERROR={s}", .{ @intFromPtr(this), @intFromPtr(task), error_string });
                                exec.incrementOutputCount(.output_count);
                                this.bltn.stderr.enqueue(this, error_string);
                                return;
                            }
                        }
                        break :brk amt;
                    },
                };

                log("ShellRmTask(0x{x}, task={s})", .{ @intFromPtr(task), task.root_path });
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
                    _ = this.bltn.writeNoIO(.stdout, verbose.deleted_entries.items[0..]);
                    _ = this.state.exec.incrementOutputCount(.output_done);
                    if (this.state.exec.state.tasksDone() >= this.state.exec.total_tasks and this.state.exec.getOutputCount(.output_done) >= this.state.exec.getOutputCount(.output_count)) {
                        this.bltn.done(if (this.state.exec.err != null) @as(ExitCode, 1) else @as(ExitCode, 0));
                        return;
                    }
                    return;
                }
                const buf = verbose.takeDeletedEntries();
                defer buf.deinit();
                this.bltn.stdout.enqueue(this, buf.items[0..]);
            }

            pub const ShellRmTask = struct {
                const print = bun.Output.scoped(.AsyncRmTask, false);

                rm: *Rm,
                opts: Opts,

                cwd: bun.FileDescriptor,
                cwd_path: ?CwdPath = if (bun.Environment.isPosix) 0 else null,

                root_task: DirTask,
                root_path: bun.PathString = bun.PathString.empty,
                root_is_absolute: bool,

                error_signal: *std.atomic.Value(bool),
                err_mutex: bun.Lock = bun.Lock.init(),
                err: ?Syscall.Error = null,

                event_loop: JSC.EventLoopHandle,
                concurrent_task: JSC.EventLoopTask,
                task: JSC.WorkPoolTask = .{
                    .callback = workPoolCallback,
                },
                join_style: JoinStyle,

                /// On Windows we allow posix path separators
                /// But this results in weird looking paths if we use our path.join function which uses the platform separator:
                /// `foo/bar + baz -> foo/bar\baz`
                ///
                /// So detect which path separator the user is using and prefer that.
                /// If both are used, pick the first one.
                const JoinStyle = union(enum) {
                    posix,
                    windows,

                    pub fn fromPath(p: bun.PathString) JoinStyle {
                        if (comptime bun.Environment.isPosix) return .posix;
                        const backslash = std.mem.indexOfScalar(u8, p.slice(), '\\') orelse std.math.maxInt(usize);
                        const forwardslash = std.mem.indexOfScalar(u8, p.slice(), '/') orelse std.math.maxInt(usize);
                        if (forwardslash <= backslash)
                            return .posix;
                        return .windows;
                    }
                };

                const CwdPath = if (bun.Environment.isWindows) [:0]const u8 else u0;

                const ParentRmTask = @This();

                pub const DirTask = struct {
                    task_manager: *ParentRmTask,
                    parent_task: ?*DirTask,
                    path: [:0]const u8,
                    is_absolute: bool = false,
                    subtask_count: std.atomic.Value(usize),
                    need_to_wait: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
                    deleting_after_waiting_for_children: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
                    kind_hint: EntryKindHint,
                    task: JSC.WorkPoolTask = .{ .callback = runFromThreadPool },
                    deleted_entries: std.ArrayList(u8),
                    concurrent_task: JSC.EventLoopTask,

                    const EntryKindHint = enum { idk, dir, file };

                    pub fn takeDeletedEntries(this: *DirTask) std.ArrayList(u8) {
                        print("DirTask(0x{x} path={s}) takeDeletedEntries", .{ @intFromPtr(this), this.path });
                        const ret = this.deleted_entries;
                        this.deleted_entries = std.ArrayList(u8).init(ret.allocator);
                        return ret;
                    }

                    pub fn runFromMainThread(this: *DirTask) void {
                        print("DirTask(0x{x}, path={s}) runFromMainThread", .{ @intFromPtr(this), this.path });
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
                        defer {
                            if (!this.deleting_after_waiting_for_children.load(.SeqCst)) {
                                this.postRun();
                            }
                        }

                        // Root, get cwd path on windows
                        if (bun.Environment.isWindows) {
                            if (this.parent_task == null) {
                                var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                                const cwd_path = switch (Syscall.getFdPath(this.task_manager.cwd, &buf)) {
                                    .result => |p| bun.default_allocator.dupeZ(u8, p) catch bun.outOfMemory(),
                                    .err => |err| {
                                        print("[runFromThreadPoolImpl:getcwd] DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
                                        this.task_manager.err_mutex.lock();
                                        defer this.task_manager.err_mutex.unlock();
                                        if (this.task_manager.err == null) {
                                            this.task_manager.err = err;
                                            this.task_manager.error_signal.store(true, .SeqCst);
                                        }
                                        return;
                                    },
                                };
                                this.task_manager.cwd_path = cwd_path;
                            }
                        }

                        print("DirTask: {s}", .{this.path});
                        this.is_absolute = ResolvePath.Platform.auto.isAbsolute(this.path[0..this.path.len]);
                        switch (this.task_manager.removeEntry(this, this.is_absolute)) {
                            .err => |err| {
                                print("[runFromThreadPoolImpl] DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
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
                        print("[handleErr] DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(err.getErrno()), err.path });
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
                        print("DirTask(0x{x}, path={s}) postRun", .{ @intFromPtr(this), this.path });
                        // // This is true if the directory has subdirectories
                        // // that need to be deleted
                        if (this.need_to_wait.load(.SeqCst)) return;

                        // We have executed all the children of this task
                        if (this.subtask_count.fetchSub(1, .SeqCst) == 1) {
                            defer {
                                if (this.task_manager.opts.verbose)
                                    this.queueForWrite()
                                else
                                    this.deinit();
                            }

                            // If we have a parent and we are the last child, now we can delete the parent
                            if (this.parent_task != null) {
                                // It's possible that we queued this subdir task and it finished, while the parent
                                // was still in the `removeEntryDir` function
                                const tasks_left_before_decrement = this.parent_task.?.subtask_count.fetchSub(1, .SeqCst);
                                const parent_still_in_remove_entry_dir = !this.parent_task.?.need_to_wait.load(.Monotonic);
                                if (!parent_still_in_remove_entry_dir and tasks_left_before_decrement == 2) {
                                    this.parent_task.?.deleteAfterWaitingForChildren();
                                }
                                return;
                            }

                            // Otherwise we are root task
                            this.task_manager.finishConcurrently();
                        }

                        // Otherwise need to wait
                    }

                    pub fn deleteAfterWaitingForChildren(this: *DirTask) void {
                        print("DirTask(0x{x}, path={s}) deleteAfterWaitingForChildren", .{ @intFromPtr(this), this.path });
                        // `runFromMainThreadImpl` has a `defer this.postRun()` so need to set this to true to skip that
                        this.deleting_after_waiting_for_children.store(true, .SeqCst);
                        this.need_to_wait.store(false, .SeqCst);
                        var do_post_run = true;
                        defer {
                            if (do_post_run) this.postRun();
                        }
                        if (this.task_manager.error_signal.load(.SeqCst)) {
                            return;
                        }

                        switch (this.task_manager.removeEntryDirAfterChildren(this)) {
                            .err => |e| {
                                print("[deleteAfterWaitingForChildren] DirTask({x}) failed: {s}: {s}", .{ @intFromPtr(this), @tagName(e.getErrno()), e.path });
                                this.task_manager.err_mutex.lock();
                                defer this.task_manager.err_mutex.unlock();
                                if (this.task_manager.err == null) {
                                    this.task_manager.err = e;
                                } else {
                                    bun.default_allocator.free(e.path);
                                }
                            },
                            .result => |deleted| {
                                if (!deleted) {
                                    do_post_run = false;
                                }
                            },
                        }
                    }

                    pub fn queueForWrite(this: *DirTask) void {
                        log("DirTask(0x{x}, path={s}) queueForWrite to_write={d}", .{ @intFromPtr(this), this.path, this.deleted_entries.items.len });
                        if (this.deleted_entries.items.len == 0) return;
                        if (this.task_manager.event_loop == .js) {
                            this.task_manager.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
                        } else {
                            this.task_manager.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
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
                            .concurrent_task = JSC.EventLoopTask.fromEventLoop(rm.bltn.eventLoop()),
                        },
                        .event_loop = rm.bltn.parentCmd().base.eventLoop(),
                        .concurrent_task = JSC.EventLoopTask.fromEventLoop(rm.bltn.eventLoop()),
                        .error_signal = error_signal,
                        .root_is_absolute = is_absolute,
                        .join_style = JoinStyle.fromPath(root_path),
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
                    defer print("enqueue: {s} {s}", .{ path, @tagName(kind_hint) });

                    if (this.error_signal.load(.SeqCst)) {
                        return;
                    }

                    var subtask = bun.default_allocator.create(DirTask) catch bun.outOfMemory();
                    subtask.* = DirTask{
                        .task_manager = this,
                        .path = path,
                        .parent_task = parent_task,
                        .subtask_count = std.atomic.Value(usize).init(1),
                        .kind_hint = kind_hint,
                        .deleted_entries = std.ArrayList(u8).init(bun.default_allocator),
                        .concurrent_task = JSC.EventLoopTask.fromEventLoop(this.event_loop),
                    };
                    std.debug.assert(parent_task.subtask_count.fetchAdd(1, .Monotonic) > 0);

                    JSC.WorkPool.schedule(&subtask.task);
                }

                pub fn getcwd(this: *ShellRmTask) if (bun.Environment.isWindows) CwdPath else bun.FileDescriptor {
                    return if (bun.Environment.isWindows) this.cwd_path.? else bun.toFD(this.cwd);
                }

                pub fn verboseDeleted(this: *@This(), dir_task: *DirTask, path: [:0]const u8) Maybe(void) {
                    print("deleted: {s}", .{path[0..path.len]});
                    if (!this.opts.verbose) return Maybe(void).success;
                    if (dir_task.deleted_entries.items.len == 0) {
                        print("DirTask(0x{x}, {s}) Incrementing output count (deleted={s})", .{ @intFromPtr(dir_task), dir_task.path, path });
                        _ = this.rm.state.exec.incrementOutputCount(.output_count);
                    }
                    dir_task.deleted_entries.appendSlice(path[0..path.len]) catch bun.outOfMemory();
                    dir_task.deleted_entries.append('\n') catch bun.outOfMemory();
                    return Maybe(void).success;
                }

                pub fn finishConcurrently(this: *ShellRmTask) void {
                    print("finishConcurrently", .{});
                    if (this.event_loop == .js) {
                        this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
                    } else {
                        this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
                    }
                }

                pub fn bufJoin(this: *ShellRmTask, buf: *[bun.MAX_PATH_BYTES]u8, parts: []const []const u8, syscall_tag: Syscall.Tag) Maybe([:0]const u8) {
                    _ = syscall_tag; // autofix

                    if (this.join_style == .posix) {
                        return .{ .result = ResolvePath.joinZBuf(buf, parts, .posix) };
                    } else return .{ .result = ResolvePath.joinZBuf(buf, parts, .windows) };
                }

                pub fn removeEntry(this: *ShellRmTask, dir_task: *DirTask, is_absolute: bool) Maybe(void) {
                    var remove_child_vtable = RemoveFileVTable{
                        .task = this,
                        .child_of_dir = false,
                    };
                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    switch (dir_task.kind_hint) {
                        .idk, .file => return this.removeEntryFile(dir_task, dir_task.path, is_absolute, &buf, &remove_child_vtable),
                        .dir => return this.removeEntryDir(dir_task, is_absolute, &buf),
                    }
                }

                fn removeEntryDir(this: *ShellRmTask, dir_task: *DirTask, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                    const path = dir_task.path;
                    const dirfd = this.cwd;
                    print("removeEntryDir({s})", .{path});

                    // If `-d` is specified without `-r` then we can just use `rmdirat`
                    if (this.opts.remove_empty_dirs and !this.opts.recursive) out_to_iter: {
                        var delete_state = RemoveFileParent{
                            .task = this,
                            .treat_as_dir = true,
                            .allow_enqueue = false,
                        };
                        while (delete_state.treat_as_dir) {
                            switch (ShellSyscall.rmdirat(dirfd, path)) {
                                .result => return Maybe(void).success,
                                .err => |e| {
                                    switch (e.getErrno()) {
                                        bun.C.E.NOENT => {
                                            if (this.opts.force) return this.verboseDeleted(dir_task, path);
                                            return .{ .err = this.errorWithPath(e, path) };
                                        },
                                        bun.C.E.NOTDIR => {
                                            delete_state.treat_as_dir = false;
                                            if (this.removeEntryFile(dir_task, dir_task.path, is_absolute, buf, &delete_state).asErr()) |err| {
                                                return .{ .err = this.errorWithPath(err, path) };
                                            }
                                            if (!delete_state.treat_as_dir) return Maybe(void).success;
                                            if (delete_state.treat_as_dir) break :out_to_iter;
                                        },
                                        else => return .{ .err = this.errorWithPath(e, path) },
                                    }
                                },
                            }
                        }
                    }

                    if (!this.opts.recursive) {
                        return Maybe(void).initErr(Syscall.Error.fromCode(bun.C.E.ISDIR, .TODO).withPath(bun.default_allocator.dupeZ(u8, dir_task.path) catch bun.outOfMemory()));
                    }

                    const flags = os.O.DIRECTORY | os.O.RDONLY;
                    const fd = switch (ShellSyscall.openat(dirfd, path, flags, 0)) {
                        .result => |fd| fd,
                        .err => |e| {
                            switch (e.getErrno()) {
                                bun.C.E.NOENT => {
                                    if (this.opts.force) return this.verboseDeleted(dir_task, path);
                                    return .{ .err = this.errorWithPath(e, path) };
                                },
                                bun.C.E.NOTDIR => {
                                    return this.removeEntryFile(dir_task, dir_task.path, is_absolute, buf, &DummyRemoveFile.dummy);
                                },
                                else => return .{ .err = this.errorWithPath(e, path) },
                            }
                        },
                    };

                    var close_fd = true;
                    defer {
                        // On posix we can close the file descriptor whenever, but on Windows
                        // we need to close it BEFORE we delete
                        if (close_fd) {
                            _ = Syscall.close(fd);
                        }
                    }

                    if (this.error_signal.load(.SeqCst)) {
                        return Maybe(void).success;
                    }

                    var iterator = DirIterator.iterate(fd.asDir(), .u8);
                    var entry = iterator.next();

                    var remove_child_vtable = RemoveFileVTable{
                        .task = this,
                        .child_of_dir = true,
                    };

                    var i: usize = 0;
                    while (switch (entry) {
                        .err => |err| {
                            return .{ .err = this.errorWithPath(err, path) };
                        },
                        .result => |ent| ent,
                    }) |current| : (entry = iterator.next()) {
                        print("dir({s}) entry({s}, {s})", .{ path, current.name.slice(), @tagName(current.kind) });
                        // TODO this seems bad maybe better to listen to kqueue/epoll event
                        if (fastMod(i, 4) == 0 and this.error_signal.load(.SeqCst)) return Maybe(void).success;

                        defer i += 1;
                        switch (current.kind) {
                            .directory => {
                                this.enqueue(dir_task, current.name.sliceAssumeZ(), is_absolute, .dir);
                            },
                            else => {
                                const name = current.name.sliceAssumeZ();
                                const file_path = switch (this.bufJoin(
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

                                switch (this.removeEntryFile(dir_task, file_path, is_absolute, buf, &remove_child_vtable)) {
                                    .err => |e| return .{ .err = this.errorWithPath(e, current.name.sliceAssumeZ()) },
                                    .result => {},
                                }
                            },
                        }
                    }

                    // Need to wait for children to finish
                    if (dir_task.subtask_count.load(.SeqCst) > 1) {
                        close_fd = true;
                        dir_task.need_to_wait.store(true, .SeqCst);
                        return Maybe(void).success;
                    }

                    if (this.error_signal.load(.SeqCst)) return Maybe(void).success;

                    if (bun.Environment.isWindows) {
                        close_fd = false;
                        _ = Syscall.close(fd);
                    }

                    print("[removeEntryDir] remove after children {s}", .{path});
                    switch (ShellSyscall.unlinkatWithFlags(this.getcwd(), path, std.os.AT.REMOVEDIR)) {
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

                const DummyRemoveFile = struct {
                    var dummy: @This() = std.mem.zeroes(@This());

                    pub fn onIsDir(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                        _ = this; // autofix
                        _ = parent_dir_task; // autofix
                        _ = path; // autofix
                        _ = is_absolute; // autofix
                        _ = buf; // autofix

                        return Maybe(void).success;
                    }

                    pub fn onDirNotEmpty(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                        _ = this; // autofix
                        _ = parent_dir_task; // autofix
                        _ = path; // autofix
                        _ = is_absolute; // autofix
                        _ = buf; // autofix

                        return Maybe(void).success;
                    }
                };

                const RemoveFileVTable = struct {
                    task: *ShellRmTask,
                    child_of_dir: bool,

                    pub fn onIsDir(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                        if (this.child_of_dir) {
                            this.task.enqueueNoJoin(parent_dir_task, bun.default_allocator.dupeZ(u8, path) catch bun.outOfMemory(), .dir);
                            return Maybe(void).success;
                        }
                        return this.task.removeEntryDir(parent_dir_task, is_absolute, buf);
                    }

                    pub fn onDirNotEmpty(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                        if (this.child_of_dir) return .{ .result = this.task.enqueueNoJoin(parent_dir_task, bun.default_allocator.dupeZ(u8, path) catch bun.outOfMemory(), .dir) };
                        return this.task.removeEntryDir(parent_dir_task, is_absolute, buf);
                    }
                };

                const RemoveFileParent = struct {
                    task: *ShellRmTask,
                    treat_as_dir: bool,
                    allow_enqueue: bool = true,
                    enqueued: bool = false,

                    pub fn onIsDir(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                        _ = parent_dir_task; // autofix
                        _ = path; // autofix
                        _ = is_absolute; // autofix
                        _ = buf; // autofix

                        this.treat_as_dir = true;
                        return Maybe(void).success;
                    }

                    pub fn onDirNotEmpty(this: *@This(), parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                        _ = is_absolute; // autofix
                        _ = buf; // autofix

                        this.treat_as_dir = true;
                        if (this.allow_enqueue) {
                            this.task.enqueueNoJoin(parent_dir_task, path, .dir);
                            this.enqueued = true;
                        }
                        return Maybe(void).success;
                    }
                };

                fn removeEntryDirAfterChildren(this: *ShellRmTask, dir_task: *DirTask) Maybe(bool) {
                    print("remove entry after children: {s}", .{dir_task.path});
                    const dirfd = bun.toFD(this.cwd);
                    var state = RemoveFileParent{
                        .task = this,
                        .treat_as_dir = true,
                    };
                    while (true) {
                        if (state.treat_as_dir) {
                            log("rmdirat({}, {s})", .{ dirfd, dir_task.path });
                            switch (ShellSyscall.rmdirat(dirfd, dir_task.path)) {
                                .result => {
                                    _ = this.verboseDeleted(dir_task, dir_task.path);
                                    return .{ .result = true };
                                },
                                .err => |e| {
                                    switch (e.getErrno()) {
                                        bun.C.E.NOENT => {
                                            if (this.opts.force) {
                                                _ = this.verboseDeleted(dir_task, dir_task.path);
                                                return .{ .result = true };
                                            }
                                            return .{ .err = this.errorWithPath(e, dir_task.path) };
                                        },
                                        bun.C.E.NOTDIR => {
                                            state.treat_as_dir = false;
                                            continue;
                                        },
                                        else => return .{ .err = this.errorWithPath(e, dir_task.path) },
                                    }
                                },
                            }
                        } else {
                            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                            if (this.removeEntryFile(dir_task, dir_task.path, dir_task.is_absolute, &buf, &state).asErr()) |e| {
                                return .{ .err = e };
                            }
                            if (state.enqueued) return .{ .result = false };
                            if (state.treat_as_dir) continue;
                            return .{ .result = true };
                        }
                    }
                }

                fn removeEntryFile(this: *ShellRmTask, parent_dir_task: *DirTask, path: [:0]const u8, is_absolute: bool, buf: *[bun.MAX_PATH_BYTES]u8, vtable: anytype) Maybe(void) {
                    const VTable = std.meta.Child(@TypeOf(vtable));
                    const Handler = struct {
                        pub fn onIsDir(vtable_: anytype, parent_dir_task_: *DirTask, path_: [:0]const u8, is_absolute_: bool, buf_: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                            if (@hasDecl(VTable, "onIsDir")) {
                                return VTable.onIsDir(vtable_, parent_dir_task_, path_, is_absolute_, buf_);
                            }
                            return Maybe(void).success;
                        }

                        pub fn onDirNotEmpty(vtable_: anytype, parent_dir_task_: *DirTask, path_: [:0]const u8, is_absolute_: bool, buf_: *[bun.MAX_PATH_BYTES]u8) Maybe(void) {
                            if (@hasDecl(VTable, "onDirNotEmpty")) {
                                return VTable.onDirNotEmpty(vtable_, parent_dir_task_, path_, is_absolute_, buf_);
                            }
                            return Maybe(void).success;
                        }
                    };
                    const dirfd = bun.toFD(this.cwd);
                    _ = dirfd; // autofix
                    switch (ShellSyscall.unlinkatWithFlags(this.getcwd(), path, 0)) {
                        .result => return this.verboseDeleted(parent_dir_task, path),
                        .err => |e| {
                            print("unlinkatWithFlags({s}) = {s}", .{ path, @tagName(e.getErrno()) });
                            switch (e.getErrno()) {
                                bun.C.E.NOENT => {
                                    if (this.opts.force)
                                        return this.verboseDeleted(parent_dir_task, path);

                                    return .{ .err = this.errorWithPath(e, path) };
                                },
                                bun.C.E.ISDIR => {
                                    return Handler.onIsDir(vtable, parent_dir_task, path, is_absolute, buf);
                                },
                                // This might happen if the file is actually a directory
                                bun.C.E.PERM => {
                                    switch (builtin.os.tag) {
                                        // non-Linux POSIX systems and Windows return EPERM when trying to delete a directory, so
                                        // we need to handle that case specifically and translate the error
                                        .macos, .ios, .freebsd, .netbsd, .dragonfly, .openbsd, .solaris, .illumos, .windows => {
                                            // If we are allowed to delete directories then we can call `unlink`.
                                            // If `path` points to a directory, then it is deleted (if empty) or we handle it as a directory
                                            // If it's actually a file, we get an error so we don't need to call `stat` to check that.
                                            if (this.opts.recursive or this.opts.remove_empty_dirs) {
                                                return switch (ShellSyscall.unlinkatWithFlags(this.getcwd(), path, std.os.AT.REMOVEDIR)) {
                                                    // it was empty, we saved a syscall
                                                    .result => return this.verboseDeleted(parent_dir_task, path),
                                                    .err => |e2| {
                                                        return switch (e2.getErrno()) {
                                                            // not empty, process directory as we would normally
                                                            bun.C.E.NOTEMPTY => {
                                                                // this.enqueueNoJoin(parent_dir_task, path, .dir);
                                                                // return Maybe(void).success;
                                                                return Handler.onDirNotEmpty(vtable, parent_dir_task, path, is_absolute, buf);
                                                            },
                                                            // actually a file, the error is a permissions error
                                                            bun.C.E.NOTDIR => .{ .err = this.errorWithPath(e, path) },
                                                            else => .{ .err = this.errorWithPath(e2, path) },
                                                        };
                                                    },
                                                };
                                            }

                                            // We don't know if it was an actual permissions error or it was a directory so we need to try to delete it as a directory
                                            return Handler.onIsDir(vtable, parent_dir_task, path, is_absolute, buf);
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
                    this.rm.onShellRmTaskDone(this);
                }

                pub fn runFromMainThreadMini(this: *ShellRmTask, _: *void) void {
                    this.rm.onShellRmTaskDone(this);
                }

                pub fn deinit(this: *ShellRmTask) void {
                    bun.default_allocator.destroy(this);
                }
            };
        };
    };

    /// This type is reference counted, but deinitialization is queued onto the event loop
    pub const IOReader = struct {
        fd: bun.FileDescriptor,
        reader: ReaderImpl,
        buf: std.ArrayListUnmanaged(u8) = .{},
        readers: Readers = .{ .inlined = .{} },
        read: usize = 0,
        ref_count: u32 = 1,
        err: ?JSC.SystemError = null,
        evtloop: JSC.EventLoopHandle,
        concurrent_task: JSC.EventLoopTask,
        async_deinit: AsyncDeinit,
        is_reading: if (bun.Environment.isWindows) bool else u0 = if (bun.Environment.isWindows) false else 0,

        pub const ChildPtr = IOReaderChildPtr;
        pub const ReaderImpl = bun.io.BufferedReader;

        pub const DEBUG_REFCOUNT_NAME: []const u8 = "IOReaderRefCount";
        pub usingnamespace bun.NewRefCounted(@This(), IOReader.asyncDeinit);

        const InitFlags = packed struct(u8) {
            pollable: bool = false,
            nonblocking: bool = false,
            socket: bool = false,
            __unused: u5 = 0,
        };

        pub fn refSelf(this: *IOReader) *IOReader {
            this.ref();
            return this;
        }

        pub fn eventLoop(this: *IOReader) JSC.EventLoopHandle {
            return this.evtloop;
        }

        pub fn loop(this: *IOReader) *bun.uws.Loop {
            return this.evtloop.loop();
        }

        pub fn init(fd: bun.FileDescriptor, evtloop: JSC.EventLoopHandle) *IOReader {
            const this = IOReader.new(.{
                .fd = fd,
                .reader = ReaderImpl.init(@This()),
                .evtloop = evtloop,
                .concurrent_task = JSC.EventLoopTask.fromEventLoop(evtloop),
                .async_deinit = .{},
            });
            log("IOReader(0x{x}, fd={}) create", .{ @intFromPtr(this), fd });

            if (bun.Environment.isPosix) {
                this.reader.flags.close_handle = false;
            }

            if (bun.Environment.isWindows) {
                this.reader.source = .{ .file = bun.io.Source.openFile(fd) };
            }
            this.reader.setParent(this);

            return this;
        }

        /// Idempotent function to start the reading
        pub fn start(this: *IOReader) void {
            if (bun.Environment.isPosix) {
                if (this.reader.handle == .closed or !this.reader.handle.poll.isRegistered()) {
                    if (this.reader.start(this.fd, true).asErr()) |e| {
                        this.onReaderError(e);
                    }
                }
                return;
            }

            if (this.is_reading) return;
            this.is_reading = true;
            if (this.reader.startWithCurrentPipe().asErr()) |e| {
                this.onReaderError(e);
            }
        }

        /// Only does things on windows
        pub inline fn setReading(this: *IOReader, reading: bool) void {
            if (bun.Environment.isWindows) {
                log("IOReader(0x{x}) setReading({any})", .{ @intFromPtr(this), reading });
                this.is_reading = reading;
            }
        }

        pub fn addReader(this: *IOReader, reader_: anytype) void {
            const reader: ChildPtr = switch (@TypeOf(reader_)) {
                ChildPtr => reader_,
                else => ChildPtr.init(reader_),
            };

            const slice = this.readers.slice();
            const usize_slice: []const usize = @as([*]const usize, @ptrCast(slice.ptr))[0..slice.len];
            const ptr_usize: usize = @intFromPtr(reader.ptr.ptr());
            // Only add if it hasn't been added yet
            if (std.mem.indexOfScalar(usize, usize_slice, ptr_usize) == null) {
                this.readers.append(reader);
            }
        }

        pub fn removeReader(this: *IOReader, reader_: anytype) void {
            const reader = switch (@TypeOf(reader_)) {
                ChildPtr => reader_,
                else => ChildPtr.init(reader_),
            };
            const slice = this.readers.slice();
            const usize_slice: []const usize = @as([*]const usize, @ptrCast(slice.ptr))[0..slice.len];
            const ptr_usize: usize = @intFromPtr(reader.ptr.ptr());
            if (std.mem.indexOfScalar(usize, usize_slice, ptr_usize)) |idx| {
                this.readers.swapRemove(idx);
            }
        }

        pub fn onReadChunk(ptr: *anyopaque, chunk: []const u8, has_more: bun.io.ReadState) bool {
            var this: *IOReader = @ptrCast(@alignCast(ptr));
            log("IOReader(0x{x}, fd={}) onReadChunk(chunk_len={d}, has_more={s})", .{ @intFromPtr(this), this.fd, chunk.len, @tagName(has_more) });
            this.setReading(false);

            var i: usize = 0;
            while (i < this.readers.len()) {
                var r = this.readers.get(i);
                switch (r.onReadChunk(chunk)) {
                    .cont => {
                        i += 1;
                    },
                    .stop_listening => {
                        this.readers.swapRemove(i);
                    },
                }
            }

            const should_continue = has_more != .eof;
            if (should_continue) {
                if (this.readers.len() > 0) {
                    this.setReading(true);
                    if (bun.Environment.isPosix)
                        this.reader.registerPoll()
                    else switch (this.reader.startWithCurrentPipe()) {
                        .err => |e| {
                            this.onReaderError(e);
                            return false;
                        },
                        else => {},
                    }
                }
            }

            return should_continue;
        }

        pub fn onReaderError(this: *IOReader, err: bun.sys.Error) void {
            this.setReading(false);
            this.err = err.toSystemError();
            for (this.readers.slice()) |r| {
                r.onReaderDone(if (this.err) |*e| brk: {
                    e.ref();
                    break :brk e.*;
                } else null);
            }
        }

        pub fn onReaderDone(this: *IOReader) void {
            log("IOReader(0x{x}) done", .{@intFromPtr(this)});
            this.setReading(false);
            for (this.readers.slice()) |r| {
                r.onReaderDone(if (this.err) |*err| brk: {
                    err.ref();
                    break :brk err.*;
                } else null);
            }
        }

        pub fn asyncDeinit(this: *@This()) void {
            log("IOReader(0x{x}) asyncDeinit", .{@intFromPtr(this)});
            this.async_deinit.schedule();
        }

        pub fn __deinit(this: *@This()) void {
            if (this.fd != bun.invalid_fd) {
                // windows reader closes the file descriptor
                if (bun.Environment.isWindows) {
                    if (this.reader.source != null and !this.reader.source.?.isClosed()) {
                        this.reader.closeImpl(false);
                    }
                } else {
                    log("IOReader(0x{x}) __deinit fd={}", .{ @intFromPtr(this), this.fd });
                    _ = bun.sys.close(this.fd);
                }
            }
            this.buf.deinit(bun.default_allocator);
            this.reader.disableKeepingProcessAlive({});
            this.reader.deinit();
            bun.destroy(this);
        }

        pub const Reader = struct {
            ptr: ChildPtr,
        };

        pub const Readers = SmolList(ChildPtr, 4);
    };

    pub const AsyncDeinitWriter = struct {
        task: WorkPoolTask = .{ .callback = &runFromThreadPool },

        pub fn runFromThreadPool(task: *WorkPoolTask) void {
            var this = @fieldParentPtr(@This(), "task", task);
            var iowriter = this.writer();
            if (iowriter.evtloop == .js) {
                iowriter.evtloop.js.enqueueTaskConcurrent(iowriter.concurrent_task.js.from(this, .manual_deinit));
            } else {
                iowriter.evtloop.mini.enqueueTaskConcurrent(iowriter.concurrent_task.mini.from(this, "runFromMainThreadMini"));
            }
        }

        pub fn writer(this: *@This()) *IOWriter {
            return @fieldParentPtr(IOWriter, "async_deinit", this);
        }

        pub fn runFromMainThread(this: *@This()) void {
            const ioreader = @fieldParentPtr(IOWriter, "async_deinit", this);
            ioreader.__deinit();
        }

        pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
            this.runFromMainThread();
        }

        pub fn schedule(this: *@This()) void {
            WorkPool.schedule(&this.task);
        }
    };

    pub const AsyncDeinit = struct {
        task: WorkPoolTask = .{ .callback = &runFromThreadPool },

        pub fn runFromThreadPool(task: *WorkPoolTask) void {
            var this = @fieldParentPtr(AsyncDeinit, "task", task);
            var ioreader = this.reader();
            if (ioreader.evtloop == .js) {
                ioreader.evtloop.js.enqueueTaskConcurrent(ioreader.concurrent_task.js.from(this, .manual_deinit));
            } else {
                ioreader.evtloop.mini.enqueueTaskConcurrent(ioreader.concurrent_task.mini.from(this, "runFromMainThreadMini"));
            }
        }

        pub fn reader(this: *AsyncDeinit) *IOReader {
            return @fieldParentPtr(IOReader, "async_deinit", this);
        }

        pub fn runFromMainThread(this: *AsyncDeinit) void {
            const ioreader = @fieldParentPtr(IOReader, "async_deinit", this);
            ioreader.__deinit();
        }

        pub fn runFromMainThreadMini(this: *AsyncDeinit, _: *void) void {
            this.runFromMainThread();
        }

        pub fn schedule(this: *AsyncDeinit) void {
            WorkPool.schedule(&this.task);
        }
    };

    pub const IOWriter = struct {
        writer: WriterImpl = if (bun.Environment.isWindows) .{} else .{
            .close_fd = false,
        },
        fd: bun.FileDescriptor,
        writers: Writers = .{ .inlined = .{} },
        buf: std.ArrayListUnmanaged(u8) = .{},
        __idx: usize = 0,
        total_bytes_written: usize = 0,
        ref_count: u32 = 1,
        err: ?JSC.SystemError = null,
        evtloop: JSC.EventLoopHandle,
        concurrent_task: JSC.EventLoopTask,
        is_writing: if (bun.Environment.isWindows) bool else u0 = if (bun.Environment.isWindows) false else 0,
        async_deinit: AsyncDeinitWriter = .{},
        started: bool = false,
        flags: InitFlags = .{},

        pub const DEBUG_REFCOUNT_NAME: []const u8 = "IOWriterRefCount";

        const print = bun.Output.scoped(.IOWriter, false);

        const ChildPtr = IOWriterChildPtr;

        /// ~128kb
        /// We shrunk the `buf` when we reach the last writer,
        /// but if this never happens, we shrink `buf` when it exceeds this threshold
        const SHRINK_THRESHOLD = 1024 * 128;

        pub const auto_poll = false;

        pub usingnamespace bun.NewRefCounted(@This(), asyncDeinit);
        const This = @This();
        pub const WriterImpl = bun.io.BufferedWriter(
            This,
            onWrite,
            onError,
            onClose,
            getBuffer,
            null,
        );
        pub const Poll = WriterImpl;

        pub fn __onClose(_: *This) void {}
        pub fn __flush(_: *This) void {}

        pub fn refSelf(this: *This) *This {
            this.ref();
            return this;
        }

        pub const InitFlags = packed struct(u8) {
            pollable: bool = false,
            nonblocking: bool = false,
            is_socket: bool = false,
            __unused: u5 = 0,
        };

        pub fn init(fd: bun.FileDescriptor, flags: InitFlags, evtloop: JSC.EventLoopHandle) *This {
            const this = IOWriter.new(.{
                .fd = fd,
                .evtloop = evtloop,
                .concurrent_task = JSC.EventLoopTask.fromEventLoop(evtloop),
            });

            this.writer.parent = this;
            this.flags = flags;

            print("IOWriter(0x{x}, fd={}) init flags={any}", .{ @intFromPtr(this), fd, flags });

            return this;
        }

        pub fn __start(this: *This) Maybe(void) {
            print("IOWriter(0x{x}, fd={}) __start()", .{ @intFromPtr(this), this.fd });
            if (this.writer.start(this.fd, this.flags.pollable).asErr()) |e_| {
                const e: bun.sys.Error = e_;
                if (bun.Environment.isPosix) {
                    // We get this if we pass in a file descriptor that is not
                    // pollable, for example a special character device like
                    // /dev/null. If so, restart with polling disabled.
                    //
                    // It's also possible on Linux for EINVAL to be returned
                    // when registering multiple writable/readable polls for the
                    // same file descriptor. The shell code here makes sure to
                    // _not_ run into that case, but it is possible.
                    if (e.getErrno() == .INVAL) {
                        print("IOWriter(0x{x}, fd={}) got EINVAL", .{ @intFromPtr(this), this.fd });
                        this.flags.pollable = false;
                        this.flags.nonblocking = false;
                        this.flags.is_socket = false;
                        this.writer.handle = .{ .closed = {} };
                        return __start(this);
                    }

                    if (bun.Environment.isLinux) {
                        // On linux regular files are not pollable and return EPERM,
                        // so restart if that's the case with polling disabled.
                        if (e.getErrno() == .PERM) {
                            this.flags.pollable = false;
                            this.flags.nonblocking = false;
                            this.flags.is_socket = false;
                            this.writer.handle = .{ .closed = {} };
                            return __start(this);
                        }
                    }
                }
                return .{ .err = e };
            }
            if (comptime bun.Environment.isPosix) {
                if (this.flags.nonblocking) {
                    this.writer.getPoll().?.flags.insert(.nonblocking);
                }

                if (this.flags.is_socket) {
                    this.writer.getPoll().?.flags.insert(.socket);
                } else if (this.flags.pollable) {
                    this.writer.getPoll().?.flags.insert(.fifo);
                }
            }

            return Maybe(void).success;
        }

        pub fn eventLoop(this: *This) JSC.EventLoopHandle {
            return this.evtloop;
        }

        /// Idempotent write call
        pub fn write(this: *This) void {
            if (!this.started) {
                log("IOWriter(0x{x}, fd={}) starting", .{ @intFromPtr(this), this.fd });
                if (this.__start().asErr()) |e| {
                    this.onError(e);
                    return;
                }
                this.started = true;
                if (comptime bun.Environment.isPosix) {
                    if (this.writer.handle == .fd) {} else return;
                } else return;
            }
            if (bun.Environment.isWindows) {
                log("IOWriter(0x{x}, fd={}) write() is_writing={any}", .{ @intFromPtr(this), this.fd, this.is_writing });
                if (this.is_writing) return;
                this.is_writing = true;
                if (this.writer.startWithCurrentPipe().asErr()) |e| {
                    this.onError(e);
                    return;
                }
                return;
            }

            if (this.writer.handle == .poll) {
                if (!this.writer.handle.poll.isWatching()) {
                    log("IOWriter(0x{x}, fd={}) calling this.writer.write()", .{ @intFromPtr(this), this.fd });
                    this.writer.write();
                } else log("IOWriter(0x{x}, fd={}) poll already watching", .{ @intFromPtr(this), this.fd });
            } else {
                log("IOWriter(0x{x}, fd={}) no poll, calling write", .{ @intFromPtr(this), this.fd });
                this.writer.write();
            }
        }

        /// Cancel the chunks enqueued by the given writer by
        /// marking them as dead
        pub fn cancelChunks(this: *This, ptr_: anytype) void {
            const ptr = switch (@TypeOf(ptr_)) {
                ChildPtr => ptr_,
                else => ChildPtr.init(ptr_),
            };
            if (this.writers.len() == 0) return;
            const idx = this.__idx;
            const slice: []Writer = this.writers.sliceMutable();
            if (idx >= slice.len) return;
            for (slice[idx..]) |*w| {
                if (w.ptr.ptr.repr._ptr == ptr.ptr.repr._ptr) {
                    w.setDead();
                }
            }
        }

        const Writer = struct {
            ptr: ChildPtr,
            len: usize,
            written: usize = 0,
            bytelist: ?*bun.ByteList = null,

            pub fn rawPtr(this: Writer) ?*anyopaque {
                return this.ptr.ptr.ptr();
            }

            pub fn isDead(this: Writer) bool {
                return this.ptr.ptr.isNull();
            }

            pub fn setDead(this: *Writer) void {
                this.ptr.ptr = ChildPtr.ChildPtrRaw.Null;
            }
        };

        pub const Writers = SmolList(Writer, 2);

        /// Skips over dead children and increments `total_bytes_written` by the
        /// amount they would have written so the buf is skipped as well
        pub fn skipDead(this: *This) void {
            const slice = this.writers.slice();
            for (slice[this.__idx..]) |*w| {
                if (w.isDead()) {
                    this.__idx += 1;
                    this.total_bytes_written += w.len - w.written;
                    continue;
                }
                return;
            }
            return;
        }

        pub fn onWrite(this: *This, amount: usize, status: bun.io.WriteStatus) void {
            this.setWriting(false);
            print("IOWriter(0x{x}, fd={}) onWrite({d}, {})", .{ @intFromPtr(this), this.fd, amount, status });
            if (this.__idx >= this.writers.len()) return;
            const child = this.writers.get(this.__idx);
            if (child.isDead()) {
                this.bump(child);
            } else {
                if (child.bytelist) |bl| {
                    const written_slice = this.buf.items[this.total_bytes_written .. this.total_bytes_written + amount];
                    bl.append(bun.default_allocator, written_slice) catch bun.outOfMemory();
                }
                this.total_bytes_written += amount;
                child.written += amount;
                if (status == .end_of_file) {
                    const not_fully_written = !this.isLastIdx(this.__idx) or child.written < child.len;
                    if (bun.Environment.allow_assert and not_fully_written) {
                        bun.Output.debugWarn("IOWriter(0x{x}, fd={}) received done without fully writing data, check that onError is thrown", .{ @intFromPtr(this), this.fd });
                    }
                    return;
                }

                if (child.written >= child.len) {
                    this.bump(child);
                }
            }

            const wrote_everything: bool = this.total_bytes_written >= this.buf.items.len;

            log("IOWriter(0x{x}, fd={}) wrote_everything={}, idx={d} writers={d}", .{ @intFromPtr(this), this.fd, wrote_everything, this.__idx, this.writers.len() });
            if (!wrote_everything and this.__idx < this.writers.len()) {
                print("IOWriter(0x{x}, fd={}) poll again", .{ @intFromPtr(this), this.fd });
                if (comptime bun.Environment.isWindows) {
                    this.setWriting(true);
                    this.writer.write();
                } else {
                    if (this.writer.handle == .poll)
                        this.writer.registerPoll()
                    else
                        this.writer.write();
                }
            }
        }

        pub fn onClose(this: *This) void {
            this.setWriting(false);
        }

        pub fn onError(this: *This, err__: bun.sys.Error) void {
            this.setWriting(false);
            const ee = err__.toSystemError();
            this.err = ee;
            log("IOWriter(0x{x}, fd={}) onError errno={s} errmsg={} errsyscall={}", .{ @intFromPtr(this), this.fd, @tagName(ee.getErrno()), ee.message, ee.syscall });
            var seen_alloc = std.heap.stackFallback(@sizeOf(usize) * 64, bun.default_allocator);
            var seen = std.ArrayList(usize).initCapacity(seen_alloc.get(), 64) catch bun.outOfMemory();
            defer seen.deinit();
            writer_loop: for (this.writers.slice()) |w| {
                if (w.isDead()) continue;
                const ptr = w.ptr.ptr.ptr();
                if (seen.items.len < 8) {
                    for (seen.items[0..]) |item| {
                        if (item == @intFromPtr(ptr)) {
                            continue :writer_loop;
                        }
                    }
                } else if (std.mem.indexOfScalar(usize, seen.items[0..], @intFromPtr(ptr)) != null) {
                    continue :writer_loop;
                }

                w.ptr.onWriteChunk(0, this.err);
                seen.append(@intFromPtr(ptr)) catch bun.outOfMemory();
            }
        }

        pub fn getBuffer(this: *This) []const u8 {
            const result = this.getBufferImpl();
            log("IOWriter(0x{x}, fd={}) getBuffer = {d} bytes", .{ @intFromPtr(this), this.fd, result.len });
            return result;
        }

        fn getBufferImpl(this: *This) []const u8 {
            const writer = brk: {
                if (this.__idx >= this.writers.len()) {
                    log("IOWriter(0x{x}, fd={}) getBufferImpl all writes done", .{ @intFromPtr(this), this.fd });
                    return "";
                }
                var writer = this.writers.get(this.__idx);
                if (!writer.isDead()) break :brk writer;
                log("IOWriter(0x{x}, fd={}) skipping dead", .{ @intFromPtr(this), this.fd });
                this.skipDead();
                if (this.__idx >= this.writers.len()) {
                    log("IOWriter(0x{x}, fd={}) getBufferImpl all writes done", .{ @intFromPtr(this), this.fd });
                    return "";
                }
                writer = this.writers.get(this.__idx);
                break :brk writer;
            };
            log("IOWriter(0x{x}, fd={}) getBufferImpl writer_len={} writer_written={}", .{ @intFromPtr(this), this.fd, writer.len, writer.written });
            const remaining = writer.len - writer.written;
            if (bun.Environment.allow_assert) {
                std.debug.assert(!(writer.len == writer.written));
            }
            return this.buf.items[this.total_bytes_written .. this.total_bytes_written + remaining];
        }

        pub fn bump(this: *This, current_writer: *Writer) void {
            log("IOWriter(0x{x}, fd={}) bump(0x{x} {s})", .{ @intFromPtr(this), this.fd, @intFromPtr(current_writer), @tagName(current_writer.ptr.ptr.tag()) });
            const is_dead = current_writer.isDead();
            const written = current_writer.written;
            const child_ptr = current_writer.ptr;

            defer {
                if (!is_dead) child_ptr.onWriteChunk(written, null);
            }

            if (is_dead) {
                this.skipDead();
            } else {
                this.__idx += 1;
            }

            if (this.__idx >= this.writers.len()) {
                log("IOWriter(0x{x}, fd={}) all writers complete: truncating", .{ @intFromPtr(this), this.fd });
                this.buf.clearRetainingCapacity();
                this.__idx = 0;
                this.writers.clearRetainingCapacity();
                this.total_bytes_written = 0;
                return;
            }

            if (this.total_bytes_written >= SHRINK_THRESHOLD) {
                log("IOWriter(0x{x}, fd={}) exceeded shrink threshold: truncating", .{ @intFromPtr(this), this.fd });
                const remaining_len = this.total_bytes_written - SHRINK_THRESHOLD;
                if (remaining_len == 0) {
                    this.buf.clearRetainingCapacity();
                    this.total_bytes_written = 0;
                } else {
                    const slice = this.buf.items[SHRINK_THRESHOLD..this.total_bytes_written];
                    std.mem.copyForwards(u8, this.buf.items[0..remaining_len], slice);
                    this.buf.items.len = remaining_len;
                    this.total_bytes_written = remaining_len;
                }
                this.writers.truncate(this.__idx);
                this.__idx = 0;
            }
        }

        pub fn enqueue(this: *This, ptr: anytype, bytelist: ?*bun.ByteList, buf: []const u8) void {
            const childptr = if (@TypeOf(ptr) == ChildPtr) ptr else ChildPtr.init(ptr);
            if (buf.len == 0) {
                log("IOWriter(0x{x}, fd={}) enqueue EMPTY", .{ @intFromPtr(this), this.fd });
                childptr.onWriteChunk(0, null);
                return;
            }
            const writer: Writer = .{
                .ptr = childptr,
                .len = buf.len,
                .bytelist = bytelist,
            };
            log("IOWriter(0x{x}, fd={}) enqueue(0x{x} {s}, buf={s}, writer_len={d})", .{ @intFromPtr(this), this.fd, @intFromPtr(writer.rawPtr()), @tagName(writer.ptr.ptr.tag()), buf, this.writers.len() + 1 });
            this.buf.appendSlice(bun.default_allocator, buf) catch bun.outOfMemory();
            this.writers.append(writer);
            this.write();
        }

        pub fn enqueueFmtBltn(
            this: *This,
            ptr: anytype,
            bytelist: ?*bun.ByteList,
            comptime kind: ?Interpreter.Builtin.Kind,
            comptime fmt_: []const u8,
            args: anytype,
        ) void {
            const cmd_str = comptime if (kind) |k| k.asString() ++ ": " else "";
            const fmt__ = cmd_str ++ fmt_;
            this.enqueueFmt(ptr, bytelist, fmt__, args);
        }

        pub fn enqueueFmt(
            this: *This,
            ptr: anytype,
            bytelist: ?*bun.ByteList,
            comptime fmt: []const u8,
            args: anytype,
        ) void {
            var buf_writer = this.buf.writer(bun.default_allocator);
            const start = this.buf.items.len;
            buf_writer.print(fmt, args) catch bun.outOfMemory();
            const end = this.buf.items.len;
            const writer: Writer = .{
                .ptr = if (@TypeOf(ptr) == ChildPtr) ptr else ChildPtr.init(ptr),
                .len = end - start,
                .bytelist = bytelist,
            };
            log("IOWriter(0x{x}, fd={}) enqueue(0x{x} {s}, {s})", .{ @intFromPtr(this), this.fd, @intFromPtr(writer.rawPtr()), @tagName(writer.ptr.ptr.tag()), this.buf.items[start..end] });
            this.writers.append(writer);
            this.write();
        }

        pub fn asyncDeinit(this: *@This()) void {
            print("IOWriter(0x{x}, fd={}) asyncDeinit", .{ @intFromPtr(this), this.fd });
            this.async_deinit.schedule();
        }

        pub fn __deinit(this: *This) void {
            print("IOWriter(0x{x}, fd={}) deinit", .{ @intFromPtr(this), this.fd });
            if (bun.Environment.allow_assert) std.debug.assert(this.ref_count == 0);
            this.buf.deinit(bun.default_allocator);
            if (comptime bun.Environment.isPosix) {
                if (this.writer.handle == .poll and this.writer.handle.poll.isRegistered()) {
                    this.writer.handle.closeImpl(null, {}, false);
                }
            }
            if (this.fd != bun.invalid_fd) _ = bun.sys.close(this.fd);
            this.writer.disableKeepingProcessAlive(this.evtloop);
            this.destroy();
        }

        pub fn isLastIdx(this: *This, idx: usize) bool {
            return idx == this.writers.len() -| 1;
        }

        /// Only does things on windows
        pub inline fn setWriting(this: *This, writing: bool) void {
            if (bun.Environment.isWindows) {
                log("IOWriter(0x{x}, fd={}) setWriting({any})", .{ @intFromPtr(this), this.fd, writing });
                this.is_writing = writing;
            }
        }
    };
};

pub fn StatePtrUnion(comptime TypesValue: anytype) type {
    return struct {
        ptr: Ptr,

        const Ptr = TaggedPointerUnion(TypesValue);

        pub fn getChildPtrType(comptime Type: type) type {
            if (Type == Interpreter)
                return Interpreter.InterpreterChildPtr;
            if (!@hasDecl(Type, "ChildPtr")) {
                @compileError(@typeName(Type) ++ " does not have ChildPtr aksjdflkasjdflkasdjf");
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

                    casted.deinit();
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

fn closefd(fd: bun.FileDescriptor) void {
    if (Syscall.close2(fd)) |err| {
        log("ERR closefd: {}\n", .{err});
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
    /// Function to be called when the thread pool starts the task, this could
    /// be on anyone of the thread pool threads so be mindful of concurrency
    /// nuances
    comptime runFromThreadPool_: fn (*Ctx) void,
    /// Function that is called on the main thread, once the event loop
    /// processes that the task is done
    comptime runFromMainThread_: fn (*Ctx) void,
    comptime print: fn (comptime fmt: []const u8, args: anytype) void,
) type {
    return struct {
        task: WorkPoolTask = .{ .callback = &runFromThreadPool },
        event_loop: JSC.EventLoopHandle,
        // This is a poll because we want it to enter the uSockets loop
        ref: bun.Async.KeepAlive = .{},
        concurrent_task: JSC.EventLoopTask,

        pub const InnerShellTask = @This();

        pub fn schedule(this: *@This()) void {
            print("schedule", .{});

            this.ref.ref(this.event_loop);
            WorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *@This()) void {
            print("onFinish", .{});
            const ctx = @fieldParentPtr(Ctx, "task", this);
            if (this.event_loop == .js) {
                this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(ctx, .manual_deinit));
            } else {
                this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(ctx, "runFromMainThreadMini"));
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
            this.ref.unref(this.event_loop);
            runFromMainThread_(ctx);
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

fn throwShellErr(e: *const bun.shell.ShellErr, event_loop: JSC.EventLoopHandle) void {
    switch (event_loop) {
        .mini => e.throwMini(),
        .js => e.throwJS(event_loop.js.global),
    }
}

pub const ReadChunkAction = enum {
    stop_listening,
    cont,
};

pub const IOReaderChildPtr = struct {
    ptr: ChildPtrRaw,

    pub const ChildPtrRaw = TaggedPointerUnion(.{
        Interpreter.Builtin.Cat,
    });

    pub fn init(p: anytype) IOReaderChildPtr {
        return .{
            .ptr = ChildPtrRaw.init(p),
            // .ptr = @ptrCast(p),
        };
    }

    /// Return true if the child should be deleted
    pub fn onReadChunk(this: IOReaderChildPtr, chunk: []const u8) ReadChunkAction {
        return this.ptr.call("onIOReaderChunk", .{chunk}, ReadChunkAction);
    }

    pub fn onReaderDone(this: IOReaderChildPtr, err: ?JSC.SystemError) void {
        return this.ptr.call("onIOReaderDone", .{err}, void);
    }
};

pub const IOWriterChildPtr = struct {
    ptr: ChildPtrRaw,

    pub const ChildPtrRaw = TaggedPointerUnion(.{
        Interpreter.Cmd,
        Interpreter.Pipeline,
        Interpreter.Builtin.Cd,
        Interpreter.Builtin.Echo,
        Interpreter.Builtin.Export,
        Interpreter.Builtin.Ls,
        Interpreter.Builtin.Ls.ShellLsOutputTask,
        Interpreter.Builtin.Mv,
        Interpreter.Builtin.Pwd,
        Interpreter.Builtin.Rm,
        Interpreter.Builtin.Which,
        Interpreter.Builtin.Mkdir,
        Interpreter.Builtin.Mkdir.ShellMkdirOutputTask,
        Interpreter.Builtin.Touch,
        Interpreter.Builtin.Touch.ShellTouchOutputTask,
        Interpreter.Builtin.Cat,
        shell.subproc.PipeReader.CapturedWriter,
    });

    pub fn init(p: anytype) IOWriterChildPtr {
        return .{
            .ptr = ChildPtrRaw.init(p),
        };
    }

    /// Called when the IOWriter writes a complete chunk of data the child enqueued
    pub fn onWriteChunk(this: IOWriterChildPtr, amount: usize, err: ?JSC.SystemError) void {
        return this.ptr.call("onIOWriterChunk", .{ amount, err }, void);
    }
};

/// Shell modifications for syscalls, mostly to make windows work:
/// - Any function that returns a file descriptor will return a uv file descriptor
/// - Sometimes windows doesn't have `*at()` functions like `rmdirat` so we have to join the directory path with the target path
/// - Converts Posix absolute paths to Windows absolute paths on Windows
const ShellSyscall = struct {
    fn getPath(dirfd: anytype, to: [:0]const u8, buf: *[bun.MAX_PATH_BYTES]u8) Maybe([:0]const u8) {
        if (bun.Environment.isPosix) @compileError("Don't use this");
        if (bun.strings.eqlComptime(to[0..to.len], "/dev/null")) {
            return .{ .result = shell.WINDOWS_DEV_NULL };
        }
        if (ResolvePath.Platform.posix.isAbsolute(to[0..to.len])) {
            const dirpath = brk: {
                if (@TypeOf(dirfd) == bun.FileDescriptor) break :brk switch (Syscall.getFdPath(dirfd, buf)) {
                    .result => |path| path,
                    .err => |e| return .{ .err = e.withFd(dirfd) },
                };
                break :brk dirfd;
            };
            const source_root = ResolvePath.windowsFilesystemRoot(dirpath);
            std.mem.copyForwards(u8, buf[0..source_root.len], source_root);
            @memcpy(buf[source_root.len..][0 .. to.len - 1], to[1..]);
            buf[source_root.len + to.len - 1] = 0;
            return .{ .result = buf[0 .. source_root.len + to.len - 1 :0] };
        }
        if (ResolvePath.Platform.isAbsolute(.windows, to[0..to.len])) return .{ .result = to };

        const dirpath = brk: {
            if (@TypeOf(dirfd) == bun.FileDescriptor) break :brk switch (Syscall.getFdPath(dirfd, buf)) {
                .result => |path| path,
                .err => |e| return .{ .err = e.withFd(dirfd) },
            };
            @memcpy(buf[0..dirfd.len], dirfd[0..dirfd.len]);
            break :brk buf[0..dirfd.len];
        };

        const parts: []const []const u8 = &.{
            dirpath[0..dirpath.len],
            to[0..to.len],
        };
        const joined = ResolvePath.joinZBuf(buf, parts, .auto);
        return .{ .result = joined };
    }

    fn statat(dir: bun.FileDescriptor, path_: [:0]const u8) Maybe(bun.Stat) {
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const path = switch (getPath(dir, path_, &buf)) {
            .err => |e| return .{ .err = e },
            .result => |p| p,
        };

        return switch (Syscall.stat(path)) {
            .err => |e| .{ .err = e.clone(bun.default_allocator) catch bun.outOfMemory() },
            .result => |s| .{ .result = s },
        };
    }

    fn openat(dir: bun.FileDescriptor, path: [:0]const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
        if (bun.Environment.isWindows) {
            if (flags & os.O.DIRECTORY != 0) {
                if (ResolvePath.Platform.posix.isAbsolute(path[0..path.len])) {
                    var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
                    const p = switch (getPath(dir, path, &buf)) {
                        .result => |p| p,
                        .err => |e| return .{ .err = e },
                    };
                    return switch (Syscall.openDirAtWindowsA(dir, p, true, flags & os.O.NOFOLLOW != 0)) {
                        .result => |fd| bun.sys.toLibUVOwnedFD(fd, .open, .close_on_fail),
                        .err => |e| .{ .err = e.withPath(path) },
                    };
                }
                return switch (Syscall.openDirAtWindowsA(dir, path, true, flags & os.O.NOFOLLOW != 0)) {
                    .result => |fd| bun.sys.toLibUVOwnedFD(fd, .open, .close_on_fail),
                    .err => |e| .{ .err = e.withPath(path) },
                };
            }

            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const p = switch (getPath(dir, path, &buf)) {
                .result => |p| p,
                .err => |e| return .{ .err = e },
            };
            return bun.sys.open(p, flags, perm);
        }

        const fd = switch (Syscall.openat(dir, path, flags, perm)) {
            .result => |fd| fd,
            .err => |e| return .{ .err = e.withPath(path) },
        };
        if (bun.Environment.isWindows) {
            return bun.sys.toLibUVOwnedFD(fd, .open, .close_on_fail);
        }
        return .{ .result = fd };
    }

    pub fn open(file_path: [:0]const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
        const fd = switch (Syscall.open(file_path, flags, perm)) {
            .result => |fd| fd,
            .err => |e| return .{ .err = e },
        };
        if (bun.Environment.isWindows) {
            return bun.sys.toLibUVOwnedFD(fd, .open, .close_on_fail);
        }
        return .{ .result = fd };
    }

    pub fn dup(fd: bun.FileDescriptor) Maybe(bun.FileDescriptor) {
        if (bun.Environment.isWindows) {
            return switch (Syscall.dup(fd)) {
                .result => |duped_fd| bun.sys.toLibUVOwnedFD(duped_fd, .dup, .close_on_fail),
                .err => |e| .{ .err = e },
            };
        }
        return Syscall.dup(fd);
    }

    pub fn unlinkatWithFlags(dirfd: anytype, to: [:0]const u8, flags: c_uint) Maybe(void) {
        if (bun.Environment.isWindows) {
            if (flags & std.os.AT.REMOVEDIR != 0) return ShellSyscall.rmdirat(dirfd, to);

            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const path = brk: {
                switch (ShellSyscall.getPath(dirfd, to, &buf)) {
                    .err => |e| return .{ .err = e },
                    .result => |p| break :brk p,
                }
            };

            return switch (Syscall.unlink(path)) {
                .result => return Maybe(void).success,
                .err => |e| {
                    log("unlinkatWithFlags({s}) = {s}", .{ path, @tagName(e.getErrno()) });
                    return .{ .err = e.withPath(bun.default_allocator.dupe(u8, path) catch bun.outOfMemory()) };
                },
            };
        }
        if (@TypeOf(dirfd) != bun.FileDescriptor) {
            @compileError("Bad type: " ++ @typeName(@TypeOf(dirfd)));
        }
        return Syscall.unlinkatWithFlags(dirfd, to, flags);
    }

    pub fn rmdirat(dirfd: anytype, to: [:0]const u8) Maybe(void) {
        if (bun.Environment.isWindows) {
            var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
            const path: []const u8 = brk: {
                switch (getPath(dirfd, to, &buf)) {
                    .result => |p| break :brk p,
                    .err => |e| return .{ .err = e },
                }
            };
            var wide_buf: [windows.PATH_MAX_WIDE]u16 = undefined;
            const wpath = bun.strings.toWPath(&wide_buf, path);
            while (true) {
                if (windows.RemoveDirectoryW(wpath) == 0) {
                    const errno = Syscall.getErrno(420);
                    if (errno == .INTR) continue;
                    log("rmdirat({s}) = {d}: {s}", .{ path, @intFromEnum(errno), @tagName(errno) });
                    return .{ .err = Syscall.Error.fromCode(errno, .rmdir) };
                }
                log("rmdirat({s}) = {d}", .{ path, 0 });
                return Maybe(void).success;
            }
        }

        return Syscall.rmdirat(dirfd, to);
    }
};

/// A task that can write to stdout and/or stderr
pub fn OutputTask(
    comptime Parent: type,
    comptime vtable: struct {
        writeErr: *const fn (*Parent, childptr: anytype, []const u8) CoroutineResult,
        onWriteErr: *const fn (*Parent) void,
        writeOut: *const fn (*Parent, childptr: anytype, *OutputSrc) CoroutineResult,
        onWriteOut: *const fn (*Parent) void,
        onDone: *const fn (*Parent) void,
    },
) type {
    return struct {
        parent: *Parent,
        output: OutputSrc,
        state: enum {
            waiting_write_err,
            waiting_write_out,
            done,
        },

        pub fn deinit(this: *@This()) void {
            if (comptime bun.Environment.allow_assert) std.debug.assert(this.state == .done);
            vtable.onDone(this.parent);
            this.output.deinit();
            bun.destroy(this);
        }

        pub fn start(this: *@This(), errbuf: ?[]const u8) void {
            this.state = .waiting_write_err;
            if (errbuf) |err| {
                switch (vtable.writeErr(this.parent, this, err)) {
                    .cont => {
                        this.next();
                    },
                    .yield => return,
                }
                return;
            }
            this.state = .waiting_write_out;
            switch (vtable.writeOut(this.parent, this, &this.output)) {
                .cont => {
                    vtable.onWriteOut(this.parent);
                    this.state = .done;
                    this.deinit();
                },
                .yield => return,
            }
        }

        pub fn next(this: *@This()) void {
            switch (this.state) {
                .waiting_write_err => {
                    vtable.onWriteErr(this.parent);
                    this.state = .waiting_write_out;
                    switch (vtable.writeOut(this.parent, this, &this.output)) {
                        .cont => {
                            vtable.onWriteOut(this.parent);
                            this.state = .done;
                            this.deinit();
                        },
                        .yield => return,
                    }
                },
                .waiting_write_out => {
                    vtable.onWriteOut(this.parent);
                    this.state = .done;
                    this.deinit();
                },
                .done => @panic("Invalid state"),
            }
        }

        pub fn onIOWriterChunk(this: *@This(), _: usize, err: ?JSC.SystemError) void {
            if (err) |e| {
                e.deref();
            }

            switch (this.state) {
                .waiting_write_err => {
                    vtable.onWriteErr(this.parent);
                    this.state = .waiting_write_out;
                    switch (vtable.writeOut(this.parent, this, &this.output)) {
                        .cont => {
                            vtable.onWriteOut(this.parent);
                            this.state = .done;
                            this.deinit();
                        },
                        .yield => return,
                    }
                },
                .waiting_write_out => {
                    vtable.onWriteOut(this.parent);
                    this.state = .done;
                    this.deinit();
                },
                .done => @panic("Invalid state"),
            }
        }
    };
}

/// All owned memory is assumed to be allocated with `bun.default_allocator`
pub const OutputSrc = union(enum) {
    arrlist: std.ArrayListUnmanaged(u8),
    owned_buf: []const u8,
    borrowed_buf: []const u8,

    pub fn slice(this: *OutputSrc) []const u8 {
        return switch (this.*) {
            .arrlist => this.arrlist.items[0..],
            .owned_buf => this.owned_buf,
            .borrowed_buf => this.borrowed_buf,
        };
    }

    pub fn deinit(this: *OutputSrc) void {
        switch (this.*) {
            .arrlist => {
                this.arrlist.deinit(bun.default_allocator);
            },
            .owned_buf => {
                bun.default_allocator.free(this.owned_buf);
            },
            .borrowed_buf => {},
        }
    }
};

/// Custom parse error for invalid options
pub const ParseError = union(enum) {
    illegal_option: []const u8,
    unsupported: []const u8,
    show_usage,
};
pub fn unsupportedFlag(comptime name: []const u8) []const u8 {
    return "unsupported option, please open a GitHub issue -- " ++ name ++ "\n";
}
pub const ParseFlagResult = union(enum) { continue_parsing, done, illegal_option: []const u8, unsupported: []const u8, show_usage };
pub fn FlagParser(comptime Opts: type) type {
    return struct {
        pub const Result = @import("../result.zig").Result;

        pub fn parseFlags(opts: Opts, args: []const [*:0]const u8) Result(?[]const [*:0]const u8, ParseError) {
            var idx: usize = 0;
            if (args.len == 0) {
                return .{ .ok = null };
            }

            while (idx < args.len) : (idx += 1) {
                const flag = args[idx];
                switch (parseFlag(opts, flag[0..std.mem.len(flag)])) {
                    .done => {
                        const filepath_args = args[idx..];
                        return .{ .ok = filepath_args };
                    },
                    .continue_parsing => {},
                    .illegal_option => |opt_str| return .{ .err = .{ .illegal_option = opt_str } },
                    .unsupported => |unsp| return .{ .err = .{ .unsupported = unsp } },
                    .show_usage => return .{ .err = .show_usage },
                }
            }

            return .{ .err = .show_usage };
        }

        fn parseFlag(opts: Opts, flag: []const u8) ParseFlagResult {
            if (flag.len == 0) return .done;
            if (flag[0] != '-') return .done;

            if (flag.len == 1) return .{ .illegal_option = "-" };

            if (flag.len > 2 and flag[1] == '-') {
                if (opts.parseLong(flag)) |result| return result;
            }

            const small_flags = flag[1..];
            for (small_flags, 0..) |char, i| {
                if (opts.parseShort(char, small_flags, i)) |err| {
                    return err;
                }
            }

            return .continue_parsing;
        }
    };
}

/// A list that can store its items inlined, and promote itself to a heap allocated bun.ByteList
pub fn SmolList(comptime T: type, comptime INLINED_MAX: comptime_int) type {
    return union(enum) {
        inlined: Inlined,
        heap: ByteList,

        const ByteList = bun.BabyList(T);

        pub const Inlined = struct {
            items: [INLINED_MAX]T = undefined,
            len: u32 = 0,

            pub fn promote(this: *Inlined, n: usize, new: T) bun.BabyList(T) {
                var list = bun.BabyList(T).initCapacity(bun.default_allocator, n) catch bun.outOfMemory();
                list.append(bun.default_allocator, this.items[0..INLINED_MAX]) catch bun.outOfMemory();
                list.push(bun.default_allocator, new) catch bun.outOfMemory();
                return list;
            }

            pub fn orderedRemove(this: *Inlined, idx: usize) T {
                if (this.len - 1 == idx) return this.pop();
                const slice_to_shift = this.items[idx + 1 .. this.len];
                std.mem.copyForwards(T, this.items[idx .. this.len - 1], slice_to_shift);
                this.len -= 1;
            }

            pub fn swapRemove(this: *Inlined, idx: usize) T {
                if (this.len - 1 == idx) return this.pop();

                const old_item = this.items[idx];
                this.items[idx] = this.pop();
                return old_item;
            }

            pub fn pop(this: *Inlined) T {
                const ret = this.items[this.items.len - 1];
                this.len -= 1;
                return ret;
            }
        };

        pub inline fn len(this: *@This()) usize {
            return switch (this.*) {
                .inlined => this.inlined.len,
                .heap => this.heap.len,
            };
        }

        pub fn orderedRemove(this: *@This(), idx: usize) void {
            switch (this.*) {
                .heap => {
                    var list = this.heap.listManaged(bun.default_allocator);
                    _ = list.orderedRemove(idx);
                },
                .inlined => {
                    _ = this.inlined.orderedRemove(idx);
                },
            }
        }

        pub fn swapRemove(this: *@This(), idx: usize) void {
            switch (this.*) {
                .heap => {
                    var list = this.heap.listManaged(bun.default_allocator);
                    _ = list.swapRemove(idx);
                },
                .inlined => {
                    _ = this.inlined.swapRemove(idx);
                },
            }
        }

        pub fn truncate(this: *@This(), starting_idx: usize) void {
            switch (this.*) {
                .inlined => {
                    if (starting_idx >= this.inlined.len) return;
                    const slice_to_move = this.inlined.items[starting_idx..this.inlined.len];
                    std.mem.copyForwards(T, this.inlined.items[0..starting_idx], slice_to_move);
                },
                .heap => {
                    const new_len = this.heap.len - starting_idx;
                    this.heap.replaceRange(0, starting_idx, this.heap.ptr[starting_idx..this.heap.len]) catch bun.outOfMemory();
                    this.heap.len = @intCast(new_len);
                },
            }
        }

        pub inline fn sliceMutable(this: *@This()) []T {
            return switch (this.*) {
                .inlined => {
                    if (this.inlined.len == 0) return &[_]T{};
                    return this.inlined.items[0..this.inlined.len];
                },
                .heap => {
                    if (this.heap.len == 0) return &[_]T{};
                    return this.heap.slice();
                },
            };
        }

        pub inline fn slice(this: *@This()) []const T {
            return switch (this.*) {
                .inlined => {
                    if (this.inlined.len == 0) return &[_]T{};
                    return this.inlined.items[0..this.inlined.len];
                },
                .heap => {
                    if (this.heap.len == 0) return &[_]T{};
                    return this.heap.slice();
                },
            };
        }

        pub inline fn get(this: *@This(), idx: usize) *T {
            return switch (this.*) {
                .inlined => {
                    if (bun.Environment.allow_assert) {
                        if (idx >= this.inlined.len) @panic("Index out of bounds");
                    }
                    return &this.inlined.items[idx];
                },
                .heap => &this.heap.ptr[idx],
            };
        }

        pub fn append(this: *@This(), new: T) void {
            switch (this.*) {
                .inlined => {
                    if (this.inlined.len == INLINED_MAX) {
                        this.* = .{ .heap = this.inlined.promote(INLINED_MAX, new) };
                        return;
                    }
                    this.inlined.items[this.inlined.len] = new;
                    this.inlined.len += 1;
                },
                .heap => {
                    this.heap.push(bun.default_allocator, new) catch bun.outOfMemory();
                },
            }
        }

        pub fn clearRetainingCapacity(this: *@This()) void {
            switch (this.*) {
                .inlined => {
                    this.inlined.len = 0;
                },
                .heap => {
                    this.heap.clearRetainingCapacity();
                },
            }
        }
    };
}

pub fn isPollable(fd: bun.FileDescriptor, mode: bun.Mode) bool {
    if (bun.Environment.isWindows) return false;
    if (bun.Environment.isLinux) return os.S.ISFIFO(mode) or os.S.ISSOCK(mode) or os.isatty(fd.int());
    // macos allows regular files to be pollable: ISREG(mode) == true
    return os.S.ISFIFO(mode) or os.S.ISSOCK(mode) or os.isatty(fd.int()) or os.S.ISREG(mode);
}
