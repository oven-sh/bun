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
const string = []const u8;
const bun = @import("bun");
const posix = std.posix;
const Arena = std.heap.ArenaAllocator;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;
const JSC = bun.JSC;
const JSValue = bun.JSC.JSValue;
const JSGlobalObject = bun.JSC.JSGlobalObject;
const which = bun.which;
const Braces = @import("./braces.zig");
const Syscall = bun.sys;
const Glob = @import("../glob.zig");
const ResolvePath = bun.path;
const TaggedPointerUnion = bun.TaggedPointerUnion;
pub const WorkPoolTask = JSC.WorkPoolTask;
pub const WorkPool = JSC.WorkPool;
const windows = bun.windows;
const uv = windows.libuv;
const Maybe = JSC.Maybe;
const WTFStringImplStruct = @import("../string.zig").WTFStringImplStruct;

const Pipe = [2]bun.FileDescriptor;
const shell = bun.shell;
const ShellError = shell.ShellError;
const ast = shell.AST;
const SmolList = shell.SmolList;

const GlobWalker = Glob.BunGlobWalkerZ;

const stdin_no = 0;
const stdout_no = 1;
const stderr_no = 2;

pub fn OOM(e: anyerror) noreturn {
    if (comptime bun.Environment.allow_assert) {
        if (e != error.OutOfMemory) bun.outOfMemory();
    }
    bun.outOfMemory();
}

pub const log = bun.Output.scoped(.SHELL, false);

const assert = bun.assert;

/// This is a zero-sized type returned by `.needsIO()`, designed to ensure
/// functions which rely on IO are not called when they do don't need it.
///
/// For example the .enqueue(), .enqueueFmtBltn(), etc functions.
///
/// It is used like this:
///
/// ```zig
/// if (this.bltn.stdout.needsIO()) |safeguard| {
///     this.bltn.stdout.enqueue(this, chunk, safeguard);
///     return .cont;
/// }
// _ = this.bltn.writeNoIO(.stdout, chunk);
/// ```
///
/// The compiler optimizes away this type so it has zero runtime cost.
///
/// You should never instantiate this type directly, unless you know
/// from previous context that the output needs IO.
///
/// Functions which accept a `_: OutputNeedsIOSafeGuard` parameter can
/// safely assume the stdout/stderr they are working with require IO.
pub const OutputNeedsIOSafeGuard = enum(u0) { output_needs_io };

pub const ExitCode = u16;

pub const StateKind = enum(u8) {
    script,
    stmt,
    assign,
    cmd,
    binary,
    pipeline,
    expansion,
    if_clause,
    condexpr,
    @"async",
    subshell,
};

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

    const debug = bun.Output.scoped(.CowFd, true);

    pub fn init(fd: bun.FileDescriptor) *CowFd {
        const this = bun.default_allocator.create(CowFd) catch bun.outOfMemory();
        this.* = .{
            .__fd = fd,
        };
        debug("init(0x{x}, fd={})", .{ @intFromPtr(this), fd });
        return this;
    }

    pub fn dup(this: *CowFd) Maybe(*CowFd) {
        const new = bun.new(CowFd, .{
            .fd = bun.sys.dup(this.fd),
            .writercount = 1,
        });
        debug("dup(0x{x}, fd={}) = (0x{x}, fd={})", .{ @intFromPtr(this), this.fd, new, new.fd });
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
        assert(this.refcount == 0);
        this.__fd.close();
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
            _: OutputNeedsIOSafeGuard,
        ) void {
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

pub const RefCountedStr = @import("./RefCountedStr.zig");
pub const EnvStr = @import("./EnvStr.zig").EnvStr;
pub const EnvMap = @import("./EnvMap.zig");
pub const ParsedShellScript = @import("./ParsedShellScript.zig");
pub const ShellArgs = struct {
    /// This is the arena used to allocate the input shell script's AST nodes,
    /// tokens, and a string pool used to store all strings.
    __arena: *bun.ArenaAllocator,
    /// Root ast node
    script_ast: ast.Script = .{ .stmts = &[_]ast.Stmt{} },

    pub const new = bun.TrivialNew(@This());

    pub fn arena_allocator(this: *ShellArgs) std.mem.Allocator {
        return this.__arena.allocator();
    }

    pub fn deinit(this: *ShellArgs) void {
        this.__arena.deinit();
        bun.destroy(this.__arena);
        bun.destroy(this);
    }

    pub fn init() *ShellArgs {
        const arena = bun.new(bun.ArenaAllocator, bun.ArenaAllocator.init(bun.default_allocator));
        return ShellArgs.new(.{
            .__arena = arena,
            .script_ast = undefined,
        });
    }
};

/// This interpreter works by basically turning the AST into a state machine so
/// that execution can be suspended and resumed to support async.
pub const Interpreter = struct {
    pub const js = JSC.Codegen.JSShellInterpreter;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    command_ctx: bun.CLI.Command.Context,
    event_loop: JSC.EventLoopHandle,
    /// This is the allocator used to allocate interpreter state
    allocator: Allocator,

    args: *ShellArgs,

    /// JS objects used as input for the shell script
    /// This should be allocated using the arena
    jsobjs: []JSValue,

    root_shell: ShellState,
    root_io: IO,

    has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    started: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    // Necessary for builtin commands.
    keep_alive: bun.Async.KeepAlive = .{},

    vm_args_utf8: std.ArrayList(JSC.ZigString.Slice),
    async_commands_executing: u32 = 0,

    globalThis: *JSC.JSGlobalObject,

    flags: packed struct(u8) {
        done: bool = false,
        quiet: bool = false,
        __unused: u6 = 0,
    } = .{},
    exit_code: ?ExitCode = 0,
    this_jsvalue: JSValue = .zero,

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

        async_pids: SmolList(pid_t, 4) = SmolList(pid_t, 4).zeroes,

        const pid_t = if (bun.Environment.isPosix) std.posix.pid_t else uv.uv_pid_t;

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

            const stdout: Bufio = switch (io.stdout) {
                .fd => brk: {
                    if (io.stdout.fd.captured != null) break :brk .{ .borrowed = io.stdout.fd.captured.? };
                    break :brk .{ .owned = .{} };
                },
                .ignore => .{ .owned = .{} },
                .pipe => switch (kind) {
                    .normal, .cmd_subst => .{ .owned = .{} },
                    .subshell, .pipeline => .{ .borrowed = this.buffered_stdout() },
                },
            };

            const stderr: Bufio = switch (io.stderr) {
                .fd => brk: {
                    if (io.stderr.fd.captured != null) break :brk .{ .borrowed = io.stderr.fd.captured.? };
                    break :brk .{ .owned = .{} };
                },
                .ignore => .{ .owned = .{} },
                .pipe => switch (kind) {
                    .normal, .cmd_subst => .{ .owned = .{} },
                    .subshell, .pipeline => .{ .borrowed = this.buffered_stderr() },
                },
            };

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
            return this.changeCwdImpl(interp, new_cwd_, false);
        }

        pub fn changeCwdImpl(this: *ShellState, _: *ThisInterpreter, new_cwd_: anytype, comptime in_init: bool) Maybe(void) {
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
                bun.O.DIRECTORY | bun.O.RDONLY,
                0,
            )) {
                .result => |fd| fd,
                .err => |err| {
                    return Maybe(void).initErr(err);
                },
            };
            _ = this.cwd_fd.closeAllowingBadFileDescriptor(null);

            this.__prev_cwd.clearRetainingCapacity();
            this.__prev_cwd.appendSlice(this.__cwd.items[0..]) catch bun.outOfMemory();

            this.__cwd.clearRetainingCapacity();
            this.__cwd.appendSlice(new_cwd[0 .. new_cwd.len + 1]) catch bun.outOfMemory();

            if (comptime bun.Environment.allow_assert) {
                assert(this.__cwd.items[this.__cwd.items.len -| 1] == 0);
                assert(this.__prev_cwd.items[this.__prev_cwd.items.len -| 1] == 0);
            }

            this.cwd_fd = new_cwd_fd;

            if (comptime !in_init) {
                this.export_env.insert(EnvStr.initSlice("OLDPWD"), EnvStr.initSlice(this.prevCwd()));
            }
            this.export_env.insert(EnvStr.initSlice("PWD"), EnvStr.initSlice(this.cwd()));

            return Maybe(void).success;
        }

        pub fn getHomedir(self: *ShellState) EnvStr {
            const env_var: ?EnvStr = brk: {
                const static_str = if (comptime bun.Environment.isWindows) EnvStr.initSlice("USERPROFILE") else EnvStr.initSlice("HOME");
                break :brk self.shell_env.get(static_str) orelse self.export_env.get(static_str);
            };
            return env_var orelse EnvStr.initSlice("");
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
                .other => |err| bun.JSC.ZigString.fromBytes(@errorName(err)).toJS(globalThis),
            };
        }
    };

    pub fn createShellInterpreter(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const allocator = bun.default_allocator;
        const arguments_ = callframe.arguments_old(3);
        var arguments = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());

        const resolve = arguments.nextEat() orelse return globalThis.throw("shell: expected 3 arguments, got 0", .{});

        const reject = arguments.nextEat() orelse return globalThis.throw("shell: expected 3 arguments, got 0", .{});

        const parsed_shell_script_js = arguments.nextEat() orelse return globalThis.throw("shell: expected 3 arguments, got 0", .{});

        const parsed_shell_script = parsed_shell_script_js.as(ParsedShellScript) orelse return globalThis.throw("shell: expected a ParsedShellScript", .{});

        var shargs: *ShellArgs = undefined;
        var jsobjs: std.ArrayList(JSValue) = std.ArrayList(JSValue).init(allocator);
        var quiet: bool = false;
        var cwd: ?bun.String = null;
        var export_env: ?EnvMap = null;

        if (parsed_shell_script.args == null) return globalThis.throw("shell: shell args is null, this is a bug in Bun. Please file a GitHub issue.", .{});

        parsed_shell_script.take(
            globalThis,
            &shargs,
            &jsobjs,
            &quiet,
            &cwd,
            &export_env,
        );

        const cwd_string: ?bun.JSC.ZigString.Slice = if (cwd) |c| brk: {
            break :brk c.toUTF8(bun.default_allocator);
        } else null;
        defer if (cwd_string) |c| c.deinit();

        const interpreter: *Interpreter = switch (ThisInterpreter.init(
            undefined, // command_ctx, unused when event_loop is .js
            .{ .js = globalThis.bunVM().event_loop },
            allocator,
            shargs,
            jsobjs.items[0..],
            export_env,
            if (cwd_string) |c| c.slice() else null,
        )) {
            .result => |i| i,
            .err => |*e| {
                jsobjs.deinit();
                if (export_env) |*ee| ee.deinit();
                if (cwd) |*cc| cc.deref();
                shargs.deinit();
                return try throwShellErr(e, .{ .js = globalThis.bunVM().event_loop });
            },
        };

        if (globalThis.hasException()) {
            jsobjs.deinit();
            if (export_env) |*ee| ee.deinit();
            if (cwd) |*cc| cc.deref();
            shargs.deinit();
            interpreter.finalize();
            return error.JSError;
        }

        interpreter.flags.quiet = quiet;
        interpreter.globalThis = globalThis;
        const js_value = JSC.Codegen.JSShellInterpreter.toJS(interpreter, globalThis);

        interpreter.this_jsvalue = js_value;
        JSC.Codegen.JSShellInterpreter.resolveSetCached(js_value, globalThis, resolve);
        JSC.Codegen.JSShellInterpreter.rejectSetCached(js_value, globalThis, reject);
        interpreter.keep_alive.ref(globalThis.bunVM());
        bun.Analytics.Features.shell += 1;
        return js_value;
    }

    pub fn parse(
        arena_allocator: std.mem.Allocator,
        script: []const u8,
        jsobjs: []JSValue,
        jsstrings_to_escape: []bun.String,
        out_parser: *?bun.shell.Parser,
        out_lex_result: *?shell.LexResult,
    ) !ast.Script {
        const lex_result = brk: {
            if (bun.strings.isAllASCII(script)) {
                var lexer = bun.shell.LexerAscii.new(arena_allocator, script, jsstrings_to_escape);
                try lexer.lex();
                break :brk lexer.get_result();
            }
            var lexer = bun.shell.LexerUnicode.new(arena_allocator, script, jsstrings_to_escape);
            try lexer.lex();
            break :brk lexer.get_result();
        };

        if (lex_result.errors.len > 0) {
            out_lex_result.* = lex_result;
            return shell.ParseError.Lex;
        }

        if (comptime bun.Environment.allow_assert) {
            const debug = bun.Output.scoped(.ShellTokens, true);
            var test_tokens = std.ArrayList(shell.Test.TestToken).initCapacity(arena_allocator, lex_result.tokens.len) catch @panic("OOPS");
            defer test_tokens.deinit();
            for (lex_result.tokens) |tok| {
                const test_tok = shell.Test.TestToken.from_real(tok, lex_result.strpool);
                test_tokens.append(test_tok) catch @panic("OOPS");
            }

            const str = std.json.stringifyAlloc(bun.default_allocator, test_tokens.items[0..], .{}) catch @panic("OOPS");
            defer bun.default_allocator.free(str);
            debug("Tokens: {s}", .{str});
        }

        out_parser.* = try bun.shell.Parser.new(arena_allocator, lex_result, jsobjs);

        const script_ast = try out_parser.*.?.parse();
        return script_ast;
    }

    /// If all initialization allocations succeed, the arena will be copied
    /// into the interpreter struct, so it is not a stale reference and safe to call `arena.deinit()` on error.
    pub fn init(
        ctx: bun.CLI.Command.Context,
        event_loop: JSC.EventLoopHandle,
        allocator: Allocator,
        shargs: *ShellArgs,
        jsobjs: []JSValue,
        export_env_: ?EnvMap,
        cwd_: ?[]const u8,
    ) shell.Result(*ThisInterpreter) {
        const export_env = brk: {
            if (event_loop == .js) break :brk if (export_env_) |e| e else EnvMap.init(allocator);

            var env_loader: *bun.DotEnv.Loader = env_loader: {
                if (event_loop == .js) {
                    break :env_loader event_loop.js.virtual_machine.transpiler.env;
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

        // Avoid the large stack allocation on Windows.
        const pathbuf = bun.default_allocator.create(bun.PathBuffer) catch bun.outOfMemory();
        defer bun.default_allocator.destroy(pathbuf);
        const cwd: [:0]const u8 = switch (Syscall.getcwdZ(pathbuf)) {
            .result => |cwd| cwd,
            .err => |err| {
                return .{ .err = .{ .sys = err.toShellSystemError() } };
            },
        };

        const cwd_fd = switch (Syscall.open(cwd, bun.O.DIRECTORY | bun.O.RDONLY, 0)) {
            .result => |fd| fd,
            .err => |err| {
                return .{ .err = .{ .sys = err.toShellSystemError() } };
            },
        };

        var cwd_arr = std.ArrayList(u8).initCapacity(bun.default_allocator, cwd.len + 1) catch bun.outOfMemory();
        cwd_arr.appendSlice(cwd[0 .. cwd.len + 1]) catch bun.outOfMemory();

        if (comptime bun.Environment.allow_assert) {
            assert(cwd_arr.items[cwd_arr.items.len -| 1] == 0);
        }

        log("Duping stdin", .{});
        const stdin_fd = switch (if (bun.Output.Source.Stdio.isStdinNull()) bun.sys.openNullDevice() else ShellSyscall.dup(shell.STDIN_FD)) {
            .result => |fd| fd,
            .err => |err| return .{ .err = .{ .sys = err.toShellSystemError() } },
        };

        const stdin_reader = IOReader.init(stdin_fd, event_loop);

        const interpreter = allocator.create(ThisInterpreter) catch bun.outOfMemory();
        interpreter.* = .{
            .command_ctx = ctx,
            .event_loop = event_loop,

            .args = shargs,
            .allocator = allocator,
            .jsobjs = jsobjs,

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
                // By default stdout/stderr should be an IOWriter writing to a dup'ed stdout/stderr
                // But if the user later calls `.setQuiet(true)` then all those syscalls/initialization was pointless work
                // So we cheaply initialize them now as `.pipe`
                // When `Interpreter.run()` is called, we check if `this.flags.quiet == false`, if so then we then properly initialize the IOWriter
                .stdout = .pipe,
                .stderr = .pipe,
            },

            .vm_args_utf8 = std.ArrayList(JSC.ZigString.Slice).init(bun.default_allocator),
            .globalThis = undefined,
        };

        if (cwd_) |c| {
            if (interpreter.root_shell.changeCwdImpl(interpreter, c, true).asErr()) |e| return .{ .err = .{ .sys = e.toShellSystemError() } };
        }

        return .{ .result = interpreter };
    }

    pub fn initAndRunFromFile(ctx: bun.CLI.Command.Context, mini: *JSC.MiniEventLoop, path: []const u8) !bun.shell.ExitCode {
        var shargs = ShellArgs.init();
        const src = src: {
            var file = try std.fs.cwd().openFile(path, .{});
            defer file.close();
            break :src try file.reader().readAllAlloc(shargs.arena_allocator(), std.math.maxInt(u32));
        };
        defer shargs.deinit();

        const jsobjs: []JSValue = &[_]JSValue{};
        var out_parser: ?bun.shell.Parser = null;
        var out_lex_result: ?bun.shell.LexResult = null;
        const script = ThisInterpreter.parse(
            shargs.arena_allocator(),
            src,
            jsobjs,
            &[_]bun.String{},
            &out_parser,
            &out_lex_result,
        ) catch |err| {
            if (err == bun.shell.ParseError.Lex) {
                assert(out_lex_result != null);
                const str = out_lex_result.?.combineErrors(shargs.arena_allocator());
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
        shargs.script_ast = script;
        var interp = switch (ThisInterpreter.init(
            ctx,
            .{ .mini = mini },
            bun.default_allocator,
            shargs,
            jsobjs,
            null,
            null,
        )) {
            .err => |*e| {
                e.throwMini();
            },
            .result => |i| i,
        };

        const exit_code: ExitCode = 1;

        const IsDone = struct {
            interp: *const Interpreter,

            fn isDone(this: *anyopaque) bool {
                const asdlfk = bun.cast(*const @This(), this);
                return asdlfk.interp.flags.done;
            }
        };
        var is_done: IsDone = .{
            .interp = interp,
        };
        interp.exit_code = exit_code;
        switch (try interp.run()) {
            .err => |e| {
                interp.deinitEverything();
                bun.Output.err(e, "Failed to run script <b>{s}<r>", .{std.fs.path.basename(path)});
                bun.Global.exit(1);
                return 1;
            },
            else => {},
        }
        mini.tick(&is_done, @as(fn (*anyopaque) bool, IsDone.isDone));
        const code = interp.exit_code.?;
        interp.deinitEverything();
        return code;
    }

    pub fn initAndRunFromSource(ctx: bun.CLI.Command.Context, mini: *JSC.MiniEventLoop, path_for_errors: []const u8, src: []const u8, cwd: ?[]const u8) !ExitCode {
        bun.Analytics.Features.standalone_shell += 1;
        var shargs = ShellArgs.init();
        defer shargs.deinit();

        const jsobjs: []JSValue = &[_]JSValue{};
        var out_parser: ?bun.shell.Parser = null;
        var out_lex_result: ?bun.shell.LexResult = null;
        const script = ThisInterpreter.parse(shargs.arena_allocator(), src, jsobjs, &[_]bun.String{}, &out_parser, &out_lex_result) catch |err| {
            if (err == bun.shell.ParseError.Lex) {
                assert(out_lex_result != null);
                const str = out_lex_result.?.combineErrors(shargs.arena_allocator());
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
        shargs.script_ast = script;
        var interp: *ThisInterpreter = switch (ThisInterpreter.init(
            ctx,
            .{ .mini = mini },
            bun.default_allocator,
            shargs,
            jsobjs,
            null,
            cwd,
        )) {
            .err => |*e| {
                e.throwMini();
            },
            .result => |i| i,
        };
        const IsDone = struct {
            interp: *const Interpreter,

            fn isDone(this: *anyopaque) bool {
                const asdlfk = bun.cast(*const @This(), this);
                return asdlfk.interp.flags.done;
            }
        };
        var is_done: IsDone = .{
            .interp = interp,
        };
        const exit_code: ExitCode = 1;
        interp.exit_code = exit_code;
        switch (try interp.run()) {
            .err => |e| {
                interp.deinitEverything();
                bun.Output.err(e, "Failed to run script <b>{s}<r>", .{path_for_errors});
                bun.Global.exit(1);
                return 1;
            },
            else => {},
        }
        mini.tick(&is_done, @as(fn (*anyopaque) bool, IsDone.isDone));
        const code = interp.exit_code.?;
        interp.deinitEverything();
        return code;
    }

    fn setupIOBeforeRun(this: *ThisInterpreter) Maybe(void) {
        if (!this.flags.quiet) {
            const event_loop = this.event_loop;

            log("Duping stdout", .{});
            const stdout_fd = switch (if (bun.Output.Source.Stdio.isStdoutNull()) bun.sys.openNullDevice() else ShellSyscall.dup(.stdout())) {
                .result => |fd| fd,
                .err => |err| return .{ .err = err },
            };

            log("Duping stderr", .{});
            const stderr_fd = switch (if (bun.Output.Source.Stdio.isStderrNull()) bun.sys.openNullDevice() else ShellSyscall.dup(.stderr())) {
                .result => |fd| fd,
                .err => |err| return .{ .err = err },
            };

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

            this.root_io = .{
                .stdin = this.root_io.stdin,
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
            };

            if (event_loop == .js) {
                this.root_io.stdout.fd.captured = &this.root_shell._buffered_stdout.owned;
                this.root_io.stderr.fd.captured = &this.root_shell._buffered_stderr.owned;
            }
        }

        return Maybe(void).success;
    }

    pub fn run(this: *ThisInterpreter) !Maybe(void) {
        if (this.setupIOBeforeRun().asErr()) |e| {
            return .{ .err = e };
        }

        var root = Script.init(this, &this.root_shell, &this.args.script_ast, Script.ParentPtr.init(this), this.root_io.copy());
        this.started.store(true, .seq_cst);
        root.start();

        return Maybe(void).success;
    }

    pub fn runFromJS(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        _ = callframe; // autofix

        if (this.setupIOBeforeRun().asErr()) |e| {
            defer this.deinitEverything();
            const shellerr = bun.shell.ShellErr.newSys(e);
            return try throwShellErr(&shellerr, .{ .js = globalThis.bunVM().event_loop });
        }
        incrPendingActivityFlag(&this.has_pending_activity);

        var root = Script.init(this, &this.root_shell, &this.args.script_ast, Script.ParentPtr.init(this), this.root_io.copy());
        this.started.store(true, .seq_cst);
        root.start();
        if (globalThis.hasException()) return error.JSError;

        return .undefined;
    }

    fn ioToJSValue(globalThis: *JSGlobalObject, buf: *bun.ByteList) JSValue {
        const bytelist = buf.*;
        buf.* = .{};
        const buffer: JSC.Node.Buffer = .{
            .allocator = bun.default_allocator,
            .buffer = JSC.ArrayBuffer.fromBytes(@constCast(bytelist.slice()), .Uint8Array),
        };
        return buffer.toNodeBuffer(globalThis);
    }

    fn asyncCmdDone(this: *ThisInterpreter, @"async": *Async) void {
        log("asyncCommandDone {}", .{@"async"});
        @"async".actuallyDeinit();
        this.async_commands_executing -= 1;
        if (this.async_commands_executing == 0 and this.exit_code != null) {
            this.finish(this.exit_code.?);
        }
    }

    fn childDone(this: *ThisInterpreter, child: InterpreterChildPtr, exit_code: ExitCode) void {
        if (child.ptr.is(Script)) {
            const script = child.as(Script);
            script.deinitFromInterpreter();
            this.exit_code = exit_code;
            if (this.async_commands_executing == 0) this.finish(exit_code);
            return;
        }
        @panic("Bad child");
    }

    fn finish(this: *ThisInterpreter, exit_code: ExitCode) void {
        log("finish {d}", .{exit_code});
        defer decrPendingActivityFlag(&this.has_pending_activity);

        if (this.event_loop == .js) {
            defer this.deinitAfterJSRun();
            this.exit_code = exit_code;
            if (this.this_jsvalue != .zero) {
                const this_jsvalue = this.this_jsvalue;
                if (JSC.Codegen.JSShellInterpreter.resolveGetCached(this_jsvalue)) |resolve| {
                    this.this_jsvalue = .zero;
                    const globalThis = this.globalThis;
                    const loop = this.event_loop.js;
                    this.keep_alive.disable();
                    loop.enter();
                    _ = resolve.call(globalThis, .undefined, &.{
                        JSValue.jsNumberFromU16(exit_code),
                        this.getBufferedStdout(globalThis),
                        this.getBufferedStderr(globalThis),
                    }) catch |err| globalThis.reportActiveExceptionAsUnhandled(err);
                    JSC.Codegen.JSShellInterpreter.resolveSetCached(this_jsvalue, globalThis, .undefined);
                    JSC.Codegen.JSShellInterpreter.rejectSetCached(this_jsvalue, globalThis, .undefined);
                    loop.exit();
                }
            }
        } else {
            this.flags.done = true;
            this.exit_code = exit_code;
        }
    }

    fn errored(this: *ThisInterpreter, the_error: ShellError) void {
        _ = the_error; // autofix
        defer decrPendingActivityFlag(&this.has_pending_activity);

        if (this.event_loop == .js) {
            const this_jsvalue = this.this_jsvalue;
            if (this_jsvalue != .zero) {
                if (JSC.Codegen.JSShellInterpreter.rejectGetCached(this_jsvalue)) |reject| {
                    const loop = this.event_loop.js;
                    const globalThis = this.globalThis;
                    this.this_jsvalue = .zero;
                    this.keep_alive.disable();

                    loop.enter();
                    _ = reject.call(globalThis, &[_]JSValue{
                        JSValue.jsNumberFromChar(1),
                        this.getBufferedStdout(globalThis),
                        this.getBufferedStderr(globalThis),
                    }) catch |err| globalThis.reportActiveExceptionAsUnhandled(err);
                    JSC.Codegen.JSShellInterpreter.resolveSetCached(this_jsvalue, globalThis, .undefined);
                    JSC.Codegen.JSShellInterpreter.rejectSetCached(this_jsvalue, globalThis, .undefined);

                    loop.exit();
                }
            }
        }
    }

    fn deinitAfterJSRun(this: *ThisInterpreter) void {
        log("deinit interpreter", .{});
        for (this.jsobjs) |jsobj| {
            jsobj.unprotect();
        }
        this.root_io.deref();
        this.keep_alive.disable();
        this.root_shell.deinitImpl(false, false);
        this.this_jsvalue = .zero;
    }

    fn deinitFromFinalizer(this: *ThisInterpreter) void {
        if (this.root_shell._buffered_stderr == .owned) {
            this.root_shell._buffered_stderr.owned.deinitWithAllocator(bun.default_allocator);
        }
        if (this.root_shell._buffered_stdout == .owned) {
            this.root_shell._buffered_stdout.owned.deinitWithAllocator(bun.default_allocator);
        }
        this.this_jsvalue = .zero;
        this.allocator.destroy(this);
    }

    fn deinitEverything(this: *ThisInterpreter) void {
        log("deinit interpreter", .{});
        for (this.jsobjs) |jsobj| {
            jsobj.unprotect();
        }
        this.root_io.deref();
        this.root_shell.deinitImpl(false, true);
        for (this.vm_args_utf8.items[0..]) |str| {
            str.deinit();
        }
        this.vm_args_utf8.deinit();
        this.this_jsvalue = .zero;
        this.allocator.destroy(this);
    }

    pub fn setQuiet(this: *ThisInterpreter, _: *JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        log("Interpreter(0x{x}) setQuiet()", .{@intFromPtr(this)});
        this.flags.quiet = true;
        return .undefined;
    }

    pub fn setCwd(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const value = callframe.argument(0);
        const str = try bun.String.fromJS(value, globalThis);

        const slice = str.toUTF8(bun.default_allocator);
        defer slice.deinit();
        switch (this.root_shell.changeCwd(this, slice.slice())) {
            .err => |e| {
                return globalThis.throwValue(e.toJSC(globalThis));
            },
            .result => {},
        }
        return .undefined;
    }

    pub fn setEnv(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
        const value1 = callframe.argument(0);
        if (!value1.isObject()) {
            return globalThis.throwInvalidArguments("env must be an object", .{});
        }

        var object_iter = JSC.JSPropertyIterator(.{
            .skip_empty_name = false,
            .include_value = true,
        }).init(globalThis, value1);
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
        _: *JSGlobalObject,
        _: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.hasPendingActivity());
    }

    pub fn getStarted(
        this: *ThisInterpreter,
        globalThis: *JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) bun.JSError!JSC.JSValue {
        _ = globalThis; // autofix
        _ = callframe; // autofix

        return JSC.JSValue.jsBoolean(this.started.load(.seq_cst));
    }

    pub fn getBufferedStdout(
        this: *ThisInterpreter,
        globalThis: *JSGlobalObject,
    ) JSC.JSValue {
        return ioToJSValue(globalThis, this.root_shell.buffered_stdout());
    }

    pub fn getBufferedStderr(
        this: *ThisInterpreter,
        globalThis: *JSGlobalObject,
    ) JSC.JSValue {
        return ioToJSValue(globalThis, this.root_shell.buffered_stderr());
    }

    pub fn finalize(
        this: *ThisInterpreter,
    ) void {
        log("Interpreter(0x{x}) finalize", .{@intFromPtr(this)});
        this.deinitFromFinalizer();
    }

    pub fn hasPendingActivity(this: *ThisInterpreter) bool {
        return this.has_pending_activity.load(.seq_cst) > 0;
    }

    fn incrPendingActivityFlag(has_pending_activity: *std.atomic.Value(u32)) void {
        _ = has_pending_activity.fetchAdd(1, .seq_cst);
        log("Interpreter incr pending activity {d}", .{has_pending_activity.load(.seq_cst)});
    }

    fn decrPendingActivityFlag(has_pending_activity: *std.atomic.Value(u32)) void {
        _ = has_pending_activity.fetchSub(1, .seq_cst);
        log("Interpreter decr pending activity {d}", .{has_pending_activity.load(.seq_cst)});
    }

    pub fn rootIO(this: *const Interpreter) *const IO {
        return &this.root_io;
    }

    fn getVmArgsUtf8(this: *Interpreter, argv: []const *WTFStringImplStruct, idx: u8) []const u8 {
        if (this.vm_args_utf8.items.len != argv.len) {
            this.vm_args_utf8.ensureTotalCapacity(argv.len) catch bun.outOfMemory();
            for (argv) |arg| {
                this.vm_args_utf8.append(arg.toUTF8(bun.default_allocator)) catch bun.outOfMemory();
            }
        }
        return this.vm_args_utf8.items[idx].slice();
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
        out_exit_code: ExitCode = 0,
        out: Result,
        out_idx: u32,

        const ParentPtr = StatePtrUnion(.{
            Cmd,
            Assigns,
            CondExpr,
            Subshell,
        });

        const ChildPtr = StatePtrUnion(.{
            // Cmd,
            Script,
        });

        pub const Result = union(enum) {
            array_of_slice: *std.ArrayList([:0]const u8),
            array_of_ptr: *std.ArrayList(?[*:0]const u8),
            single: struct {
                list: *std.ArrayList(u8),
                done: bool = false,
            },

            pub fn pushResultSlice(this: *Result, buf: [:0]const u8) void {
                if (comptime bun.Environment.allow_assert) {
                    assert(buf[buf.len] == 0);
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
                    assert(buf.items[buf.items.len - 1] == 0);
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

        pub fn format(this: *const Expansion, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.print("Expansion(0x{x})", .{@intFromPtr(this)});
        }

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
                assert(this.child_state == .idle);
                assert(this.word_idx == 0);
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
                            if (this.node.hasTildeExpansion() and this.node.atomsLen() > 1) {
                                const homedir = this.base.shell.getHomedir();
                                defer homedir.deref();
                                if (this.current_out.items.len > 0) {
                                    switch (this.current_out.items[0]) {
                                        '/', '\\' => {
                                            this.current_out.insertSlice(0, homedir.slice()) catch bun.outOfMemory();
                                        },
                                        else => {
                                            // TODO: Handle username
                                            this.current_out.insert(0, '~') catch bun.outOfMemory();
                                        },
                                    }
                                }
                            }

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
                        assert(this.word_idx >= this.node.atomsLen());
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
                                assert(@sizeOf([]std.ArrayList(u8)) * stack_max <= 256);
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
                    const is_cmd_subst = this.expandSimpleNoIO(simp, &this.current_out, true);
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
                    const starting_offset: usize = if (this.node.hasTildeExpansion()) brk: {
                        this.word_idx += 1;
                        break :brk 1;
                    } else 0;
                    for (cmp.atoms[start_word_idx + starting_offset ..]) |*simple_atom| {
                        const is_cmd_subst = this.expandSimpleNoIO(simple_atom, &this.current_out, true);
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
            if (comptime bun.Environment.allow_assert) {
                assert(this.state != .done and this.state != .err);
                assert(this.child_state != .idle);
            }

            // Command substitution
            if (child.ptr.is(Script)) {
                if (comptime bun.Environment.allow_assert) {
                    assert(this.child_state == .cmd_subst);
                }

                // This branch is true means that we expanded
                // a single command substitution and it failed.
                //
                // This information is propagated to `Cmd` because in the case
                // that the command substitution would be expanded to the
                // command name (e.g. `$(lkdfjsldf)`), and it fails, the entire
                // command should fail with the exit code of the command
                // substitution.
                if (exit_code != 0 and
                    this.node.* == .simple and
                    this.node.simple == .cmd_subst)
                {
                    this.out_exit_code = exit_code;
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

            @panic("Invalid child to Expansion, this indicates a bug in Bun. Please file a report on Github.");
        }

        fn onGlobWalkDone(this: *Expansion, task: *ShellGlobTask) void {
            log("{} onGlobWalkDone", .{this});
            if (comptime bun.Environment.allow_assert) {
                assert(this.child_state == .glob);
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
                // In variable assignments, a glob that fails to match should not produce an error, but instead expand to just the pattern
                if (this.parent.ptr.is(Assigns) or (this.parent.ptr.is(Cmd) and this.parent.ptr.as(Cmd).state == .expanding_assigns)) {
                    this.pushCurrentOut();
                    this.child_state.glob.walker.deinit(true);
                    this.child_state = .idle;
                    this.state = .done;
                    this.next();
                    return;
                }

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
        pub fn expandSimpleNoIO(this: *Expansion, atom: *const ast.SimpleAtom, str_list: *std.ArrayList(u8), comptime expand_tilde: bool) bool {
            switch (atom.*) {
                .Text => |txt| {
                    str_list.appendSlice(txt) catch bun.outOfMemory();
                },
                .Var => |label| {
                    str_list.appendSlice(this.expandVar(label)) catch bun.outOfMemory();
                },
                .VarArgv => |int| {
                    str_list.appendSlice(this.expandVarArgv(int)) catch bun.outOfMemory();
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
                .tilde => {
                    if (expand_tilde) {
                        const homedir = this.base.shell.getHomedir();
                        defer homedir.deref();
                        str_list.appendSlice(homedir.slice()) catch bun.outOfMemory();
                    } else str_list.append('~') catch bun.outOfMemory();
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

        fn expandVar(this: *const Expansion, label: []const u8) []const u8 {
            const value = this.base.shell.shell_env.get(EnvStr.initSlice(label)) orelse brk: {
                break :brk this.base.shell.export_env.get(EnvStr.initSlice(label)) orelse return "";
            };
            defer value.deref();
            return value.slice();
        }

        fn expandVarArgv(this: *const Expansion, original_int: u8) []const u8 {
            var int = original_int;
            switch (this.base.interpreter.event_loop) {
                .js => |event_loop| {
                    if (int == 0) return bun.selfExePath() catch "";
                    int -= 1;

                    const vm = event_loop.virtual_machine;
                    if (vm.main.len > 0) {
                        if (int == 0) return vm.main;
                        int -= 1;
                    }

                    if (vm.worker) |worker| {
                        if (int >= worker.argv.len) return "";
                        return this.base.interpreter.getVmArgsUtf8(worker.argv, int);
                    }
                    const argv = vm.argv;
                    if (int >= argv.len) return "";
                    return argv[int];
                },
                .mini => {
                    const ctx = this.base.interpreter.command_ctx;
                    if (int >= 1 + ctx.passthrough.len) return "";
                    if (int == 0) return ctx.positionals[ctx.positionals.len - 1 - int];
                    return ctx.passthrough[int - 1];
                },
            }
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

        fn expansionSizeHintSimple(this: *const Expansion, simple: *const ast.SimpleAtom, has_unknown: *bool) usize {
            return switch (simple.*) {
                .Text => |txt| txt.len,
                .Var => |label| this.expandVar(label).len,
                .VarArgv => |int| this.expandVarArgv(int).len,
                .brace_begin, .brace_end, .comma, .asterisk => 1,
                .double_asterisk => 2,
                .cmd_subst => |subst| {
                    _ = subst; // autofix

                    // TODO check if the command substitution is comprised entirely of assignments or zero-sized things
                    // if (@as(ast.CmdOrAssigns.Tag, subst.*) == .assigns) {
                    //     return 0;
                    // }
                    has_unknown.* = true;
                    return 0;
                },
                .tilde => {
                    has_unknown.* = true;
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
            const debug = bun.Output.scoped(.ShellGlobTask, true);

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
                        .unknown => |err| JSC.ZigString.fromBytes(@errorName(err)).toJS(globalThis),
                    };
                }
            };

            pub fn createOnMainThread(allocator: Allocator, walker: *GlobWalker, expansion: *Expansion) *This {
                debug("createOnMainThread", .{});
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
                debug("runFromThreadPool", .{});
                var this: *This = @fieldParentPtr("task", task);
                switch (this.walkImpl()) {
                    .result => {},
                    .err => |e| {
                        this.err = .{ .syscall = e };
                    },
                }
                this.onFinish();
            }

            fn walkImpl(this: *This) Maybe(void) {
                debug("walkImpl", .{});

                var iter = GlobWalker.Iterator{ .walker = this.walker };
                defer iter.deinit();
                switch (iter.init() catch bun.outOfMemory()) {
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
                debug("runFromJS", .{});
                this.expansion.onGlobWalkDone(this);
                this.ref.unref(this.event_loop);
            }

            pub fn runFromMainThreadMini(this: *This, _: *void) void {
                this.runFromMainThread();
            }

            pub fn schedule(this: *This) void {
                debug("schedule", .{});
                WorkPool.schedule(&this.task);
            }

            pub fn onFinish(this: *This) void {
                debug("onFinish", .{});
                if (this.event_loop == .js) {
                    this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
                } else {
                    this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
                }
            }

            pub fn deinit(this: *This) void {
                debug("deinit", .{});
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
            throwShellErr(err, this.eventLoop()) catch {}; //TODO:
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
            Subshell,
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

        pub fn format(this: *const Script, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.print("Script(0x{x}, stmts={d})", .{ @intFromPtr(this), this.node.stmts.len });
        }

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
            log("{} init", .{script});
            return script;
        }

        fn getIO(this: *Script) IO {
            return this.io;
        }

        pub fn start(this: *Script) void {
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
                    var stmt = Stmt.init(this.base.interpreter, this.base.shell, stmt_node, this, io.ref().*);
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

            this.parent.childDone(this, exit_code);
        }

        pub fn childDone(this: *Script, child: ChildPtr, exit_code: ExitCode) void {
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
            if (!this.parent.ptr.is(ThisInterpreter) and !this.parent.ptr.is(Subshell)) {
                // The shell state is owned by the parent when the parent is Interpreter or Subshell
                // Otherwise this Script represents a command substitution which is duped from the parent
                // and must be deinitalized.
                this.base.shell.deinit();
            }

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

    /// In pipeline expressions, assigns (e.g. `FOO=bar BAR=baz | echo hi`) have
    /// no effect on the environment of the shell, so we can skip them.
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
            Binary,
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
                        const last = expanding.current_expansion_result.items.len -| 1;
                        for (expanding.current_expansion_result.items, 0..) |slice, i| {
                            total += slice.len;
                            if (i != last) {
                                // for space
                                total += 1;
                            }
                        }
                        break :brk total;
                    };

                    const value = brk: {
                        var merged = bun.default_allocator.allocSentinel(u8, size, 0) catch bun.outOfMemory();
                        var i: usize = 0;
                        const last = expanding.current_expansion_result.items.len -| 1;
                        for (expanding.current_expansion_result.items, 0..) |slice, j| {
                            @memcpy(merged[i .. i + slice.len], slice[0..slice.len]);
                            i += slice.len;
                            if (j != last) {
                                merged[i] = ' ';
                                i += 1;
                            }
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

            @panic("Invalid child to Assigns expression, this indicates a bug in Bun. Please file a report on Github.");
        }
    };

    pub const Stmt = struct {
        base: State,
        node: *const ast.Stmt,
        parent: ParentPtr,
        idx: usize,
        last_exit_code: ?ExitCode,
        currently_executing: ?ChildPtr,
        io: IO,

        const ParentPtr = StatePtrUnion(.{
            Script,
            If,
        });

        const ChildPtr = StatePtrUnion(.{
            Async,
            Binary,
            Pipeline,
            Cmd,
            Assigns,
            If,
            CondExpr,
            Subshell,
        });

        pub fn init(
            interpreter: *ThisInterpreter,
            shell_state: *ShellState,
            node: *const ast.Stmt,
            parent: anytype,
            io: IO,
        ) *Stmt {
            var script = interpreter.allocator.create(Stmt) catch bun.outOfMemory();
            script.base = .{ .kind = .stmt, .interpreter = interpreter, .shell = shell_state };
            script.node = node;
            script.parent = switch (@TypeOf(parent)) {
                ParentPtr => parent,
                else => ParentPtr.init(parent),
            };
            script.idx = 0;
            script.last_exit_code = null;
            script.currently_executing = null;
            script.io = io;
            log("Stmt(0x{x}) init", .{@intFromPtr(script)});
            return script;
        }

        pub fn start(this: *Stmt) void {
            if (bun.Environment.allow_assert) {
                assert(this.idx == 0);
                assert(this.last_exit_code == null);
                assert(this.currently_executing == null);
            }
            this.next();
        }

        pub fn next(this: *Stmt) void {
            if (this.idx >= this.node.exprs.len)
                return this.parent.childDone(this, this.last_exit_code orelse 0);

            const child = &this.node.exprs[this.idx];
            switch (child.*) {
                .binary => {
                    const binary = Binary.init(this.base.interpreter, this.base.shell, child.binary, Binary.ParentPtr.init(this), this.io.copy());
                    this.currently_executing = ChildPtr.init(binary);
                    binary.start();
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
                    switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, this.io, .subshell)) {
                        .result => |shell_state| {
                            var script = Subshell.init(this.base.interpreter, shell_state, child.subshell, Subshell.ParentPtr.init(this), this.io.copy());
                            script.start();
                        },
                        .err => |e| {
                            this.base.throw(&bun.shell.ShellErr.newSys(e));
                        },
                    }
                },
                .@"if" => {
                    const if_clause = If.init(this.base.interpreter, this.base.shell, child.@"if", If.ParentPtr.init(this), this.io.copy());
                    if_clause.start();
                },
                .condexpr => {
                    const condexpr = CondExpr.init(this.base.interpreter, this.base.shell, child.condexpr, CondExpr.ParentPtr.init(this), this.io.copy());
                    condexpr.start();
                },
                .@"async" => {
                    const @"async" = Async.init(this.base.interpreter, this.base.shell, child.@"async", Async.ParentPtr.init(this), this.io.copy());
                    @"async".start();
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

    pub const Binary = struct {
        base: State,
        node: *const ast.Binary,
        /// Based on precedence rules binary expr can only be child of a stmt or
        /// another binary expr
        parent: ParentPtr,
        left: ?ExitCode = null,
        right: ?ExitCode = null,
        io: IO,
        currently_executing: ?ChildPtr = null,

        const ChildPtr = StatePtrUnion(.{
            Async,
            Cmd,
            Pipeline,
            Binary,
            Assigns,
            If,
            CondExpr,
            Subshell,
        });

        const ParentPtr = StatePtrUnion(.{
            Stmt,
            Binary,
        });

        pub fn init(
            interpreter: *ThisInterpreter,
            shell_state: *ShellState,
            node: *const ast.Binary,
            parent: ParentPtr,
            io: IO,
        ) *Binary {
            var binary = interpreter.allocator.create(Binary) catch bun.outOfMemory();
            binary.node = node;
            binary.base = .{ .kind = .binary, .interpreter = interpreter, .shell = shell_state };
            binary.parent = parent;
            binary.io = io;
            binary.left = null;
            binary.right = null;
            binary.currently_executing = null;
            return binary;
        }

        fn start(this: *Binary) void {
            log("binary start {x} ({s})", .{ @intFromPtr(this), @tagName(this.node.op) });
            if (comptime bun.Environment.allow_assert) {
                assert(this.left == null);
                assert(this.right == null);
                assert(this.currently_executing == null);
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

        fn makeChild(this: *Binary, left: bool) ?ChildPtr {
            const node = if (left) &this.node.left else &this.node.right;
            switch (node.*) {
                .cmd => {
                    const cmd = Cmd.init(this.base.interpreter, this.base.shell, node.cmd, Cmd.ParentPtr.init(this), this.io.copy());
                    return ChildPtr.init(cmd);
                },
                .binary => {
                    const binary = Binary.init(this.base.interpreter, this.base.shell, node.binary, Binary.ParentPtr.init(this), this.io.copy());
                    return ChildPtr.init(binary);
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
                .subshell => {
                    switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, this.io, .subshell)) {
                        .result => |shell_state| {
                            const script = Subshell.init(this.base.interpreter, shell_state, node.subshell, Subshell.ParentPtr.init(this), this.io.copy());
                            return ChildPtr.init(script);
                        },
                        .err => |e| {
                            this.base.throw(&bun.shell.ShellErr.newSys(e));
                            return null;
                        },
                    }
                },
                .@"if" => {
                    const if_clause = If.init(this.base.interpreter, this.base.shell, node.@"if", If.ParentPtr.init(this), this.io.copy());
                    return ChildPtr.init(if_clause);
                },
                .condexpr => {
                    const condexpr = CondExpr.init(this.base.interpreter, this.base.shell, node.condexpr, CondExpr.ParentPtr.init(this), this.io.copy());
                    return ChildPtr.init(condexpr);
                },
                .@"async" => {
                    const @"async" = Async.init(this.base.interpreter, this.base.shell, node.@"async", Async.ParentPtr.init(this), this.io.copy());
                    return ChildPtr.init(@"async");
                },
            }
        }

        pub fn childDone(this: *Binary, child: ChildPtr, exit_code: ExitCode) void {
            if (comptime bun.Environment.allow_assert) {
                assert(this.left == null or this.right == null);
                assert(this.currently_executing != null);
            }
            log("binary child done {x} ({s}) {s}", .{ @intFromPtr(this), @tagName(this.node.op), if (this.left == null) "left" else "right" });

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

        pub fn deinit(this: *Binary) void {
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
        /// binary
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
            Binary,
            Async,
        });

        const ChildPtr = StatePtrUnion(.{
            Cmd,
            Assigns,
            If,
            CondExpr,
            Subshell,
        });

        const PipelineItem = TaggedPointerUnion(.{
            Cmd,
            If,
            CondExpr,
            Subshell,
        });

        const CmdOrResult = union(enum) {
            cmd: PipelineItem,
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
                    if (switch (item.*) {
                        .assigns => false,
                        else => true,
                    }) i += 1;
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
                    const system_err = err.toShellSystemError();
                    this.writeFailingError("bun: {s}\n", .{system_err.message});
                    return .yield;
                }
            }

            var i: u32 = 0;
            const evtloop = this.base.eventLoop();
            for (this.node.items) |*item| {
                switch (item.*) {
                    .@"if", .cmd, .condexpr, .subshell => {
                        var cmd_io = this.getIO();
                        const stdin = if (cmd_count > 1) Pipeline.readPipe(pipes, i, &cmd_io, evtloop) else cmd_io.stdin.ref();
                        const stdout = if (cmd_count > 1) Pipeline.writePipe(pipes, i, cmd_count, &cmd_io, evtloop) else cmd_io.stdout.ref();
                        cmd_io.stdin = stdin;
                        cmd_io.stdout = stdout;
                        _ = cmd_io.stderr.ref();
                        const subshell_state = switch (this.base.shell.dupeForSubshell(this.base.interpreter.allocator, cmd_io, .pipeline)) {
                            .result => |s| s,
                            .err => |err| {
                                const system_err = err.toShellSystemError();
                                this.writeFailingError("bun: {s}\n", .{system_err.message});
                                return .yield;
                            },
                        };
                        this.cmds.?[i] = .{
                            .cmd = switch (item.*) {
                                .@"if" => PipelineItem.init(If.init(this.base.interpreter, subshell_state, item.@"if", If.ParentPtr.init(this), cmd_io)),
                                .cmd => PipelineItem.init(Cmd.init(this.base.interpreter, subshell_state, item.cmd, Cmd.ParentPtr.init(this), cmd_io)),
                                .condexpr => PipelineItem.init(CondExpr.init(this.base.interpreter, subshell_state, item.condexpr, CondExpr.ParentPtr.init(this), cmd_io)),
                                .subshell => PipelineItem.init(Subshell.init(this.base.interpreter, subshell_state, item.subshell, Subshell.ParentPtr.init(this), cmd_io)),
                                else => @panic("Pipeline runnable should be a command or an if conditional, this appears to be a bug in Bun."),
                            },
                        };
                        i += 1;
                    },
                    // in a pipeline assignments have no effect
                    .assigns => {},
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
                assert(this.exited_count == 0);
            }
            log("pipeline start {x} (count={d})", .{ @intFromPtr(this), this.node.items.len });
            if (this.node.items.len == 0) {
                this.state = .done;
                this.parent.childDone(this, 0);
                return;
            }

            for (cmds) |*cmd_or_result| {
                assert(cmd_or_result.* == .cmd);
                log("Pipeline start cmd", .{});
                var cmd = cmd_or_result.cmd;
                cmd.call("start", .{}, void);
            }
        }

        pub fn onIOWriterChunk(this: *Pipeline, _: usize, err: ?JSC.SystemError) void {
            if (comptime bun.Environment.allow_assert) {
                assert(this.state == .waiting_write_err);
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
                assert(this.cmds.?.len > 0);
            }

            const idx = brk: {
                const ptr_value: u64 = @bitCast(child.ptr.repr);
                _ = ptr_value;
                for (this.cmds.?, 0..) |cmd_or_result, i| {
                    if (cmd_or_result == .cmd) {
                        const ptr = @as(usize, cmd_or_result.cmd.repr._ptr);
                        if (ptr == @as(usize, @intCast(child.ptr.repr._ptr))) break :brk i;
                    }
                }
                @panic("Invalid pipeline state");
            };

            log("pipeline child done {x} ({d}) i={d}", .{ @intFromPtr(this), exit_code, idx });
            // We duped the subshell for commands in the pipeline so we need to
            // deinitialize it.
            if (child.ptr.is(Cmd)) {
                const cmd = child.as(Cmd);
                cmd.base.shell.deinit();
            } else if (child.ptr.is(If)) {
                const if_clause = child.as(If);
                if_clause.base.shell.deinit();
            } else if (child.ptr.is(CondExpr)) {
                const condexpr = child.as(CondExpr);
                condexpr.base.shell.deinit();
            } else if (child.ptr.is(Assigns)) {
                // We don't do anything here since assigns have no effect in a pipeline
            } else if (child.ptr.is(Subshell)) {
                // Subshell already deinitializes its shell state so don't need to do anything here
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
                    cmd_or_result.cmd.call("deinit", .{}, void);
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
                    pipe[0] = .fromUV(fds[0]);
                    pipe[1] = .fromUV(fds[1]);
                } else {
                    switch (bun.sys.socketpair(
                        std.posix.AF.UNIX,
                        std.posix.SOCK.STREAM,
                        0,
                        .blocking,
                    )) {
                        .result => |fds| pipe.* = fds,
                        .err => |err| return .{ .err = err },
                    }
                }
                set_count.* += 1;
            }
            return Maybe(void).success;
        }

        fn writePipe(pipes: []Pipe, proc_idx: usize, cmd_count: usize, io: *IO, evtloop: JSC.EventLoopHandle) IO.OutKind {
            // Last command in the pipeline should write to stdout
            if (proc_idx == cmd_count - 1) return io.stdout.ref();
            return .{
                .fd = .{
                    .writer = IOWriter.init(pipes[proc_idx][1], .{
                        .pollable = true,
                        .is_socket = bun.Environment.isPosix,
                    }, evtloop),
                },
            };
        }

        fn readPipe(pipes: []Pipe, proc_idx: usize, io: *IO, evtloop: JSC.EventLoopHandle) IO.InKind {
            // First command in the pipeline should read from stdin
            if (proc_idx == 0) return io.stdin.ref();
            return .{ .fd = IOReader.init(pipes[proc_idx - 1][0], evtloop) };
        }
    };

    pub const Subshell = struct {
        base: State,
        node: *const ast.Subshell,
        parent: ParentPtr,
        io: IO,
        state: union(enum) {
            idle,
            expanding_redirect: struct {
                idx: u32 = 0,
                expansion: Expansion,
            },
            exec,
            wait_write_err,
            done,
        } = .idle,
        redirection_file: std.ArrayList(u8),
        exit_code: ExitCode = 0,

        const ParentPtr = StatePtrUnion(.{
            Pipeline,
            Binary,
            Stmt,
        });

        const ChildPtr = StatePtrUnion(.{
            Script,
            Subshell,
            Expansion,
        });

        pub fn format(this: *const Subshell, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.print("Subshell(0x{x})", .{@intFromPtr(this)});
        }

        pub fn init(
            interpreter: *ThisInterpreter,
            shell_state: *ShellState,
            node: *const ast.Subshell,
            parent: ParentPtr,
            io: IO,
        ) *Subshell {
            return bun.new(Subshell, .{
                .base = .{ .kind = .condexpr, .interpreter = interpreter, .shell = shell_state },
                .node = node,
                .parent = parent,
                .io = io,
                .redirection_file = std.ArrayList(u8).init(bun.default_allocator),
            });
        }

        pub fn start(this: *Subshell) void {
            log("{} start", .{this});
            const script = Script.init(this.base.interpreter, this.base.shell, &this.node.script, Script.ParentPtr.init(this), this.io.copy());
            script.start();
        }

        pub fn next(this: *Subshell) void {
            while (this.state != .done) {
                switch (this.state) {
                    .idle => {
                        this.state = .{
                            .expanding_redirect = .{ .expansion = undefined },
                        };
                        this.next();
                    },
                    .expanding_redirect => {
                        if (this.state.expanding_redirect.idx >= 1) {
                            this.transitionToExec();
                            return;
                        }
                        this.state.expanding_redirect.idx += 1;

                        // Get the node to expand otherwise go straight to
                        // `expanding_args` state
                        const node_to_expand = brk: {
                            if (this.node.redirect != null and this.node.redirect.? == .atom) break :brk &this.node.redirect.?.atom;
                            this.transitionToExec();
                            return;
                        };

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
                    .wait_write_err, .exec => return,
                    .done => @panic("This should not be possible."),
                }
            }

            this.parent.childDone(this, 0);
        }

        pub fn transitionToExec(this: *Subshell) void {
            log("{} transitionToExec", .{this});
            const script = Script.init(this.base.interpreter, this.base.shell, &this.node.script, Script.ParentPtr.init(this), this.io.copy());
            this.state = .exec;
            script.start();
        }

        pub fn childDone(this: *Subshell, child_ptr: ChildPtr, exit_code: ExitCode) void {
            defer child_ptr.deinit();
            this.exit_code = exit_code;
            if (child_ptr.ptr.is(Expansion) and exit_code != 0) {
                if (exit_code != 0) {
                    const err = this.state.expanding_redirect.expansion.state.err;
                    defer err.deinit(bun.default_allocator);
                    this.state.expanding_redirect.expansion.deinit();
                    this.writeFailingError("{}\n", .{err});
                    return;
                }
                this.next();
            }

            if (child_ptr.ptr.is(Script)) {
                this.parent.childDone(this, exit_code);
                return;
            }
        }

        pub fn onIOWriterChunk(this: *Subshell, _: usize, err: ?JSC.SystemError) void {
            if (comptime bun.Environment.allow_assert) {
                assert(this.state == .wait_write_err);
            }

            if (err) |e| {
                e.deref();
            }

            this.state = .done;
            this.parent.childDone(this, this.exit_code);
        }

        pub fn deinit(this: *Subshell) void {
            this.base.shell.deinit();
            this.io.deref();
            this.redirection_file.deinit();
            bun.destroy(this);
        }

        pub fn writeFailingError(this: *Subshell, comptime fmt: []const u8, args: anytype) void {
            const handler = struct {
                fn enqueueCb(ctx: *Subshell) void {
                    ctx.state = .wait_write_err;
                }
            };
            this.base.shell.writeFailingErrorFmt(this, handler.enqueueCb, fmt, args);
        }
    };

    pub const Async = struct {
        base: State,
        node: *const ast.Expr,
        parent: ParentPtr,
        io: IO,
        state: union(enum) {
            idle,
            exec: struct {
                child: ?ChildPtr = null,
            },
            done: ExitCode,
        } = .idle,
        event_loop: JSC.EventLoopHandle,
        concurrent_task: JSC.EventLoopTask,

        const ParentPtr = StatePtrUnion(.{
            Binary,
            Stmt,
        });

        const ChildPtr = StatePtrUnion(.{
            Pipeline,
            Cmd,
            If,
            CondExpr,
        });

        pub fn format(this: *const Async, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.print("Async(0x{x}, child={s})", .{ @intFromPtr(this), @tagName(this.node.*) });
        }

        pub fn init(
            interpreter: *ThisInterpreter,
            shell_state: *ShellState,
            node: *const ast.Expr,
            parent: ParentPtr,
            io: IO,
        ) *Async {
            interpreter.async_commands_executing += 1;
            return bun.new(Async, .{
                .base = .{ .kind = .@"async", .interpreter = interpreter, .shell = shell_state },
                .node = node,
                .parent = parent,
                .io = io,
                .event_loop = interpreter.event_loop,
                .concurrent_task = JSC.EventLoopTask.fromEventLoop(interpreter.event_loop),
            });
        }

        pub fn start(this: *Async) void {
            log("{} start", .{this});
            this.enqueueSelf();
            this.parent.childDone(this, 0);
        }

        pub fn next(this: *Async) void {
            log("{} next {s}", .{ this, @tagName(this.state) });
            switch (this.state) {
                .idle => {
                    this.state = .{ .exec = .{} };
                    this.enqueueSelf();
                },
                .exec => {
                    if (this.state.exec.child) |child| {
                        child.start();
                        return;
                    }

                    const child = brk: {
                        switch (this.node.*) {
                            .pipeline => break :brk ChildPtr.init(Pipeline.init(
                                this.base.interpreter,
                                this.base.shell,
                                this.node.pipeline,
                                Pipeline.ParentPtr.init(this),
                                this.io.copy(),
                            )),
                            .cmd => break :brk ChildPtr.init(Cmd.init(
                                this.base.interpreter,
                                this.base.shell,
                                this.node.cmd,
                                Cmd.ParentPtr.init(this),
                                this.io.copy(),
                            )),
                            .@"if" => break :brk ChildPtr.init(If.init(
                                this.base.interpreter,
                                this.base.shell,
                                this.node.@"if",
                                If.ParentPtr.init(this),
                                this.io.copy(),
                            )),
                            .condexpr => break :brk ChildPtr.init(CondExpr.init(
                                this.base.interpreter,
                                this.base.shell,
                                this.node.condexpr,
                                CondExpr.ParentPtr.init(this),
                                this.io.copy(),
                            )),
                            else => {
                                @panic("Encountered an unexpected child of an async command, this indicates a bug in Bun. Please open a GitHub issue.");
                            },
                        }
                    };
                    this.state.exec.child = child;
                    this.enqueueSelf();
                },
                .done => {
                    this.base.interpreter.asyncCmdDone(this);
                },
            }
        }

        pub fn enqueueSelf(this: *Async) void {
            if (this.event_loop == .js) {
                this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
            } else {
                this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
            }
        }

        pub fn childDone(this: *Async, child_ptr: ChildPtr, exit_code: ExitCode) void {
            log("{} childDone", .{this});
            child_ptr.deinit();
            this.state = .{ .done = exit_code };
            this.enqueueSelf();
        }

        /// This function is purposefully empty as a hack to ensure Async runs in the background while appearing to
        /// the parent that it is done immediately.
        ///
        /// For example, in a script like `sleep 1 & echo hello`, the `sleep 1` part needs to appear as done immediately so the parent doesn't wait for
        /// it and instead immediately moves to executing the next command.
        ///
        /// Actual deinitialization is executed once this Async calls `this.base.interpreter.asyncCmdDone(this)`, where the interpreter will call `.actuallyDeinit()`
        pub fn deinit(this: *Async) void {
            _ = this;
        }

        pub fn actuallyDeinit(this: *Async) void {
            this.io.deref();
            bun.destroy(this);
        }

        pub fn runFromMainThread(this: *Async) void {
            this.next();
        }

        pub fn runFromMainThreadMini(this: *Async, _: *void) void {
            this.runFromMainThread();
        }
    };

    pub const CondExpr = struct {
        base: State,
        node: *const ast.CondExpr,
        parent: ParentPtr,
        io: IO,
        state: union(enum) {
            idle,
            expanding_args: struct {
                idx: u32 = 0,
                expansion: Expansion,
                last_exit_code: ExitCode = 0,
            },
            waiting_stat,
            stat_complete: struct {
                stat: Maybe(bun.Stat),
            },
            waiting_write_err,
            done,
        } = .idle,
        args: std.ArrayList([:0]const u8),

        pub const ShellCondExprStatTask = struct {
            task: ShellTask(@This(), runFromThreadPool, runFromMainThread, log),
            condexpr: *CondExpr,
            result: ?Maybe(bun.Stat) = null,
            path: [:0]const u8,
            cwdfd: bun.FileDescriptor,

            pub fn runFromThreadPool(this: *ShellCondExprStatTask) void {
                this.result = ShellSyscall.statat(this.cwdfd, this.path);
            }

            pub fn runFromMainThread(this: *ShellCondExprStatTask) void {
                defer this.deinit();
                const ret = this.result.?;
                this.result = null;
                this.condexpr.onStatTaskComplete(ret);
            }

            pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
                this.runFromMainThread();
            }

            pub fn deinit(this: *ShellCondExprStatTask) void {
                bun.destroy(this);
            }
        };

        const ParentPtr = StatePtrUnion(.{
            Stmt,
            Binary,
            Pipeline,
            Async,
        });

        const ChildPtr = StatePtrUnion(.{
            Expansion,
        });

        pub fn init(
            interpreter: *ThisInterpreter,
            shell_state: *ShellState,
            node: *const ast.CondExpr,
            parent: ParentPtr,
            io: IO,
        ) *CondExpr {
            return bun.new(CondExpr, .{
                .base = .{ .kind = .condexpr, .interpreter = interpreter, .shell = shell_state },
                .node = node,
                .parent = parent,
                .io = io,
                .args = std.ArrayList([:0]const u8).init(bun.default_allocator),
            });
        }

        pub fn format(this: *const CondExpr, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.print("CondExpr(0x{x}, op={s})", .{ @intFromPtr(this), @tagName(this.node.op) });
        }

        pub fn start(this: *CondExpr) void {
            log("{} start", .{this});
            this.next();
        }

        fn next(this: *CondExpr) void {
            while (this.state != .done) {
                switch (this.state) {
                    .idle => {
                        this.state = .{ .expanding_args = .{ .expansion = undefined } };
                        continue;
                    },
                    .expanding_args => {
                        if (this.state.expanding_args.idx >= this.node.args.len()) {
                            this.commandImplStart();
                            return;
                        }

                        this.args.ensureUnusedCapacity(1) catch bun.outOfMemory();
                        Expansion.init(
                            this.base.interpreter,
                            this.base.shell,
                            &this.state.expanding_args.expansion,
                            this.node.args.getConst(this.state.expanding_args.idx),
                            Expansion.ParentPtr.init(this),
                            .{
                                .array_of_slice = &this.args,
                            },
                            this.io.copy(),
                        );
                        this.state.expanding_args.idx += 1;
                        this.state.expanding_args.expansion.start();
                        return;
                    },
                    .waiting_stat => return,
                    .stat_complete => {
                        switch (this.node.op) {
                            .@"-f" => {
                                this.parent.childDone(this, if (this.state.stat_complete.stat == .result) 0 else 1);
                                return;
                            },
                            .@"-d" => {
                                const st: bun.Stat = switch (this.state.stat_complete.stat) {
                                    .result => |st| st,
                                    .err => {
                                        // It seems that bash always gives exit code 1
                                        this.parent.childDone(this, 1);
                                        return;
                                    },
                                };
                                this.parent.childDone(this, if (bun.S.ISDIR(@intCast(st.mode))) 0 else 1);
                                return;
                            },
                            .@"-c" => {
                                const st: bun.Stat = switch (this.state.stat_complete.stat) {
                                    .result => |st| st,
                                    .err => {
                                        // It seems that bash always gives exit code 1
                                        this.parent.childDone(this, 1);
                                        return;
                                    },
                                };
                                this.parent.childDone(this, if (bun.S.ISCHR(@intCast(st.mode))) 0 else 1);
                                return;
                            },
                            .@"-z", .@"-n", .@"==", .@"!=" => @panic("This conditional expression op does not need `stat()`. This indicates a bug in Bun. Please file a GitHub issue."),
                            else => {
                                if (bun.Environment.allow_assert) {
                                    inline for (ast.CondExpr.Op.SUPPORTED) |supported| {
                                        if (supported == this.node.op) {
                                            @panic("DEV: You did not support the \"" ++ @tagName(supported) ++ "\" conditional expression operation here.");
                                        }
                                    }
                                }
                                @panic("Invalid conditional expression op, this indicates a bug in Bun. Please file a GithHub issue.");
                            },
                        }
                    },
                    .waiting_write_err => return,
                    .done => assert(false),
                }
            }

            this.parent.childDone(this, 0);
        }

        fn commandImplStart(this: *CondExpr) void {
            switch (this.node.op) {
                .@"-c",
                .@"-d",
                .@"-f",
                => {
                    this.state = .waiting_stat;
                    this.doStat();
                },
                .@"-z" => this.parent.childDone(this, if (this.args.items.len == 0 or this.args.items[0].len == 0) 0 else 1),
                .@"-n" => this.parent.childDone(this, if (this.args.items.len > 0 and this.args.items[0].len != 0) 0 else 1),
                .@"==" => {
                    const is_eq = this.args.items.len == 0 or (this.args.items.len >= 2 and bun.strings.eql(this.args.items[0], this.args.items[1]));
                    this.parent.childDone(this, if (is_eq) 0 else 1);
                },
                .@"!=" => {
                    const is_neq = this.args.items.len >= 2 and !bun.strings.eql(this.args.items[0], this.args.items[1]);
                    this.parent.childDone(this, if (is_neq) 0 else 1);
                },
                // else => @panic("Invalid node op: " ++ @tagName(this.node.op) ++ ", this indicates a bug in Bun. Please file a GithHub issue."),
                else => {
                    if (bun.Environment.allow_assert) {
                        inline for (ast.CondExpr.Op.SUPPORTED) |supported| {
                            if (supported == this.node.op) {
                                @panic("DEV: You did not support the \"" ++ @tagName(supported) ++ "\" conditional expression operation here.");
                            }
                        }
                    }

                    @panic("Invalid cond expression op, this indicates a bug in Bun. Please file a GithHub issue.");
                },
            }
        }

        fn doStat(this: *CondExpr) void {
            const stat_task = bun.new(ShellCondExprStatTask, .{
                .task = .{
                    .event_loop = this.base.eventLoop(),
                    .concurrent_task = JSC.EventLoopTask.fromEventLoop(this.base.eventLoop()),
                },
                .condexpr = this,
                .path = this.args.items[0],
                .cwdfd = this.base.shell.cwd_fd,
            });
            stat_task.task.schedule();
        }

        pub fn deinit(this: *CondExpr) void {
            this.io.deinit();
            bun.destroy(this);
        }

        pub fn childDone(this: *CondExpr, child: ChildPtr, exit_code: ExitCode) void {
            if (child.ptr.is(Expansion)) {
                if (exit_code != 0) {
                    const err = this.state.expanding_args.expansion.state.err;
                    defer err.deinit(bun.default_allocator);
                    this.state.expanding_args.expansion.deinit();
                    this.writeFailingError("{}\n", .{err});
                    return;
                }
                child.deinit();
                this.next();
                return;
            }

            @panic("Invalid child to cond expression, this indicates a bug in Bun. Please file a report on Github.");
        }

        pub fn onStatTaskComplete(this: *CondExpr, result: Maybe(bun.Stat)) void {
            if (bun.Environment.allow_assert) assert(this.state == .waiting_stat);

            this.state = .{
                .stat_complete = .{ .stat = result },
            };
            this.next();
        }

        pub fn writeFailingError(this: *CondExpr, comptime fmt: []const u8, args: anytype) void {
            const handler = struct {
                fn enqueueCb(ctx: *CondExpr) void {
                    ctx.state = .waiting_write_err;
                }
            };
            this.base.shell.writeFailingErrorFmt(this, handler.enqueueCb, fmt, args);
        }

        pub fn onIOWriterChunk(this: *CondExpr, _: usize, err: ?JSC.SystemError) void {
            if (err != null) {
                defer err.?.deref();
                const exit_code: ExitCode = @intFromEnum(err.?.getErrno());
                this.parent.childDone(this, exit_code);
                return;
            }

            if (this.state == .waiting_write_err) {
                this.parent.childDone(this, 1);
                return;
            }
        }
    };

    pub const If = struct {
        base: State,
        node: *const ast.If,
        parent: ParentPtr,
        io: IO,
        state: union(enum) {
            idle,
            exec: struct {
                state: union(enum) {
                    cond,
                    then,
                    elif: struct {
                        idx: u32 = 0,
                    },
                    @"else",
                },
                stmts: *const SmolList(ast.Stmt, 1),
                stmt_idx: u32 = 0,
                last_exit_code: ExitCode = 0,
            },
            waiting_write_err,
            done,
        } = .idle,

        const ParentPtr = StatePtrUnion(.{
            Stmt,
            Binary,
            Pipeline,
            Async,
        });

        const ChildPtr = StatePtrUnion(.{
            Stmt,
        });

        pub fn format(this: *const If, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            try writer.print("If(0x{x}, state={s})", .{ @intFromPtr(this), @tagName(this.state) });
        }

        pub fn init(
            interpreter: *ThisInterpreter,
            shell_state: *ShellState,
            node: *const ast.If,
            parent: ParentPtr,
            io: IO,
        ) *If {
            return bun.new(If, .{
                .base = .{ .kind = .cmd, .interpreter = interpreter, .shell = shell_state },
                .node = node,
                .parent = parent,
                .io = io,
            });
        }

        pub fn start(this: *If) void {
            this.next();
        }

        fn next(this: *If) void {
            while (this.state != .done) {
                switch (this.state) {
                    .idle => {
                        this.state = .{ .exec = .{ .state = .cond, .stmts = &this.node.cond } };
                    },
                    .exec => {
                        const stmts = this.state.exec.stmts;
                        // Executed all the stmts in the condition/branch
                        if (this.state.exec.stmt_idx >= stmts.len()) {
                            switch (this.state.exec.state) {
                                // Move to the then, elif, or else branch based on the exit code
                                // and the amount of else parts
                                .cond => {
                                    if (this.state.exec.last_exit_code == 0) {
                                        this.state.exec.state = .then;
                                        this.state.exec.stmt_idx = 0;
                                        this.state.exec.stmts = &this.node.then;
                                        continue;
                                    }
                                    switch (this.node.else_parts.len()) {
                                        0 => {
                                            this.parent.childDone(this, 0);
                                            return;
                                        },
                                        1 => {
                                            this.state.exec.state = .@"else";
                                            this.state.exec.stmt_idx = 0;
                                            this.state.exec.stmts = this.node.else_parts.getConst(0);
                                            continue;
                                        },
                                        else => {
                                            this.state.exec.state = .{ .elif = .{} };
                                            this.state.exec.stmt_idx = 0;
                                            this.state.exec.stmts = this.node.else_parts.getConst(0);
                                            continue;
                                        },
                                    }
                                },
                                // done
                                .then => {
                                    this.parent.childDone(this, this.state.exec.last_exit_code);
                                    return;
                                },
                                // if succesful, execute the elif's then branch
                                // otherwise, move to the next elif, or to the final else if it exists
                                .elif => {
                                    if (this.state.exec.last_exit_code == 0) {
                                        this.state.exec.stmts = this.node.else_parts.getConst(this.state.exec.state.elif.idx + 1);
                                        this.state.exec.stmt_idx = 0;
                                        this.state.exec.state = .then;
                                        continue;
                                    }

                                    this.state.exec.state.elif.idx += 2;

                                    if (this.state.exec.state.elif.idx >= this.node.else_parts.len()) {
                                        this.parent.childDone(this, 0);
                                        return;
                                    }

                                    if (this.state.exec.state.elif.idx == this.node.else_parts.len() -| 1) {
                                        this.state.exec.state = .@"else";
                                        this.state.exec.stmt_idx = 0;
                                        this.state.exec.stmts = this.node.else_parts.lastUncheckedConst();
                                        continue;
                                    }

                                    this.state.exec.stmt_idx = 0;
                                    this.state.exec.stmts = this.node.else_parts.getConst(this.state.exec.state.elif.idx);
                                    continue;
                                },
                                .@"else" => {
                                    this.parent.childDone(this, this.state.exec.last_exit_code);
                                    return;
                                },
                            }
                        }

                        const idx = this.state.exec.stmt_idx;
                        this.state.exec.stmt_idx += 1;
                        const stmt = this.state.exec.stmts.getConst(idx);
                        var newstmt = Stmt.init(this.base.interpreter, this.base.shell, stmt, this, this.io.copy());
                        newstmt.start();
                        return;
                    },
                    .waiting_write_err => return, // yield execution
                    .done => @panic("This code should not be reachable"),
                }
            }

            this.parent.childDone(this, 0);
        }

        pub fn deinit(this: *If) void {
            log("{} deinit", .{this});
            this.io.deref();
            bun.destroy(this);
        }

        pub fn childDone(this: *If, child: ChildPtr, exit_code: ExitCode) void {
            defer child.deinit();

            if (this.state != .exec) {
                @panic("Expected `exec` state in If, this indicates a bug in Bun. Please file a GitHub issue.");
            }

            var exec = &this.state.exec;
            exec.last_exit_code = exit_code;

            switch (exec.state) {
                .cond => this.next(),
                .then => this.next(),
                .elif => {
                    // if (exit_code == 0) {
                    //     exec.stmts = this.node.else_parts.getConst(exec.state.elif.idx + 1);
                    //     exec.state = .then;
                    //     exec.stmt_idx = 0;
                    //     this.next();
                    //     return;
                    // }
                    this.next();
                    return;
                },
                .@"else" => this.next(),
            }
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

        /// If a subprocess and its stdout/stderr exit immediately, we queue
        /// completion of this `Cmd` onto the event loop to avoid having the Cmd
        /// unexpectedly deinitalizing deeper in the callstack and becoming
        /// undefined memory.
        pub const ShellAsyncSubprocessDone = struct {
            cmd: *Cmd,
            concurrent_task: JSC.EventLoopTask,

            pub fn format(this: *const ShellAsyncSubprocessDone, comptime fmt: []const u8, opts: std.fmt.FormatOptions, writer: anytype) !void {
                _ = fmt; // autofix
                _ = opts; // autofix
                try writer.print("ShellAsyncSubprocessDone(0x{x}, cmd=0{x})", .{ @intFromPtr(this), @intFromPtr(this.cmd) });
            }

            pub fn enqueue(this: *ShellAsyncSubprocessDone) void {
                log("{} enqueue", .{this});
                const ctx = this;
                const evtloop = this.cmd.base.eventLoop();

                if (evtloop == .js) {
                    evtloop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(ctx, .manual_deinit));
                } else {
                    evtloop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(ctx, "runFromMainThreadMini"));
                }
            }

            pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
                this.runFromMainThread();
            }

            pub fn runFromMainThread(this: *ShellAsyncSubprocessDone) void {
                log("{} runFromMainThread", .{this});
                defer this.deinit();
                this.cmd.parent.childDone(this.cmd, this.cmd.exit_code orelse 0);
            }

            pub fn deinit(this: *ShellAsyncSubprocessDone) void {
                log("{} deinit", .{this});
                bun.destroy(this);
            }
        };

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
            Binary,
            Pipeline,
            Async,
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
            var cmd = interpreter.allocator.create(Cmd) catch bun.outOfMemory();
            cmd.* = .{
                .base = .{ .kind = .cmd, .interpreter = interpreter, .shell = shell_state },
                .node = node,
                .parent = parent,

                .spawn_arena = bun.ArenaAllocator.init(interpreter.allocator),
                .args = undefined,
                .redirection_file = undefined,

                .exit_code = null,
                .io = io,
                .state = .idle,
            };
            cmd.args = std.ArrayList(?[*:0]const u8).initCapacity(cmd.spawn_arena.allocator(), node.name_and_args.len) catch bun.outOfMemory();

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
            assert(this.state == .waiting_write_err);
            this.parent.childDone(this, 1);
            return;
        }

        pub fn childDone(this: *Cmd, child: ChildPtr, exit_code: ExitCode) void {
            if (child.ptr.is(Assigns)) {
                if (exit_code != 0) {
                    const err = this.state.expanding_assigns.state.err;
                    this.state.expanding_assigns.state.err = .{ .custom = "" };
                    defer err.deinit(bun.default_allocator);

                    this.state.expanding_assigns.deinit();
                    this.writeFailingError("{}\n", .{err});
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
                    this.writeFailingError("{}\n", .{err});
                    return;
                }
                // Handling this case from the shell spec:
                // "If there is no command name, but the command contained a
                // command substitution, the command shall complete with the
                // exit status of the last command substitution performed."
                //
                // See the comment where `this.out_exit_code` is assigned for
                // more info.
                const e: *Expansion = child.ptr.as(Expansion);
                if (this.state == .expanding_args and
                    e.node.* == .simple and
                    e.node.simple == .cmd_subst and
                    this.state.expanding_args.idx == 1 and this.node.name_and_args.len == 1)
                {
                    this.exit_code = e.out_exit_code;
                }
                this.next();
                return;
            }

            @panic("Expected Cmd child to be Assigns or Expansion. This indicates a bug in Bun. Please file a GitHub issue. ");
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
                    // Sometimes the expansion can result in an empty string
                    //
                    //  For example:
                    //
                    //     await $`echo "" > script.sh`
                    //     await $`(bash ./script.sh)`
                    //     await $`$(lkdlksdfjsf)`
                    //
                    // In this case, we should just exit.
                    //
                    // BUT, if the expansion contained a single command
                    // substitution (third example above), then we need to
                    // return the exit code of that command substitution.
                    this.parent.childDone(this, this.exit_code orelse 0);
                    return;
                };

                const first_arg_len = std.mem.len(first_arg);
                var first_arg_real = first_arg[0..first_arg_len];

                if (bun.Environment.isDebug) {
                    if (bun.strings.eqlComptime(first_arg_real, "bun")) {
                        first_arg_real = "bun-debug";
                    }
                }

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
                    );
                    if (coro_result == .yield) return;

                    if (comptime bun.Environment.allow_assert) {
                        assert(this.exec == .bltn);
                    }

                    log("Builtin name: {s}", .{@tagName(this.exec)});

                    switch (this.exec.bltn.start()) {
                        .result => {},
                        .err => |e| {
                            this.writeFailingError("bun: {s}: {s}", .{ @tagName(this.exec.bltn.kind), e.toShellSystemError().message });
                            return;
                        },
                    }
                    return;
                }

                const path_buf = bun.PathBufferPool.get();
                defer bun.PathBufferPool.put(path_buf);
                const resolved = which(path_buf, spawn_args.PATH, spawn_args.cwd, first_arg_real) orelse blk: {
                    if (bun.strings.eqlComptime(first_arg_real, "bun") or bun.strings.eqlComptime(first_arg_real, "bun-debug")) blk2: {
                        break :blk bun.selfExePath() catch break :blk2;
                    }
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
                                .held = .create(buf.value, global),
                            } };

                            setStdioFromRedirect(&spawn_args.stdio, this.node.redirect, stdio);
                        } else if (this.base.interpreter.jsobjs[val.idx].as(JSC.WebCore.Blob)) |blob__| {
                            const blob = blob__.dupe();
                            if (this.node.redirect.stdin) {
                                spawn_args.stdio[stdin_no].extractBlob(global, .{ .Blob = blob }, stdin_no) catch return;
                            } else if (this.node.redirect.stdout) {
                                spawn_args.stdio[stdin_no].extractBlob(global, .{ .Blob = blob }, stdout_no) catch return;
                            } else if (this.node.redirect.stderr) {
                                spawn_args.stdio[stdin_no].extractBlob(global, .{ .Blob = blob }, stderr_no) catch return;
                            }
                        } else if (JSC.WebCore.ReadableStream.fromJS(this.base.interpreter.jsobjs[val.idx], global)) |rstream| {
                            _ = rstream;
                            @panic("TODO SHELL READABLE STREAM");
                        } else if (this.base.interpreter.jsobjs[val.idx].as(JSC.WebCore.Response)) |req| {
                            req.getBodyValue().toBlobIfPossible();
                            if (this.node.redirect.stdin) {
                                spawn_args.stdio[stdin_no].extractBlob(global, req.getBodyValue().useAsAnyBlob(), stdin_no) catch return;
                            }
                            if (this.node.redirect.stdout) {
                                spawn_args.stdio[stdout_no].extractBlob(global, req.getBodyValue().useAsAnyBlob(), stdout_no) catch return;
                            }
                            if (this.node.redirect.stderr) {
                                spawn_args.stdio[stderr_no].extractBlob(global, req.getBodyValue().useAsAnyBlob(), stderr_no) catch return;
                            }
                        } else {
                            const jsval = this.base.interpreter.jsobjs[val.idx];
                            global.throw("Unknown JS value used in shell: {}", .{jsval.fmtString(global)}) catch {}; // TODO: propagate
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
                                return this.writeFailingError("bun: {s}: {s}", .{ e.toShellSystemError().message, path });
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
            var did_exit_immediately = false;
            const subproc = switch (Subprocess.spawnAsync(this.base.eventLoop(), &shellio, spawn_args, &this.exec.subproc.child, &did_exit_immediately)) {
                .result => this.exec.subproc.child,
                .err => |*e| {
                    this.exec = .none;
                    this.writeFailingError("{}\n", .{e});
                    return;
                },
            };
            subproc.ref();
            this.spawn_arena_freed = true;
            arena.deinit();

            if (did_exit_immediately) {
                if (subproc.process.hasExited()) {
                    // process has already exited, we called wait4(), but we did not call onProcessExit()
                    subproc.process.onExit(subproc.process.status, &std.mem.zeroes(bun.spawn.Rusage));
                } else {
                    // process has already exited, but we haven't called wait4() yet
                    // https://cs.github.com/libuv/libuv/blob/b00d1bd225b602570baee82a6152eaa823a84fa6/src/unix/process.c#L1007
                    subproc.process.wait(false);
                }
            }
        }

        fn setStdioFromRedirect(stdio: *[3]shell.subproc.Stdio, flags: ast.RedirectFlags, val: shell.subproc.Stdio) void {
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
                if (!this.spawn_arena_freed) {
                    var async_subprocess_done = bun.new(ShellAsyncSubprocessDone, .{
                        .cmd = this,
                        .concurrent_task = JSC.EventLoopTask.fromEventLoop(this.base.eventLoop()),
                    });
                    async_subprocess_done.enqueue();
                } else {
                    this.parent.childDone(this, this.exit_code orelse 0);
                }
            }
        }

        pub fn bufferedOutputCloseStdout(this: *Cmd, err: ?JSC.SystemError) void {
            if (comptime bun.Environment.allow_assert) {
                assert(this.exec == .subproc);
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
                assert(this.exec == .subproc);
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

    pub const Builtin = @import("./Builtin.zig");

    /// This type is reference counted, but deinitialization is queued onto the event loop
    pub const IOReader = struct {
        const RefCount = bun.ptr.RefCount(@This(), "ref_count", asyncDeinit, .{});
        pub const ref = RefCount.ref;
        pub const deref = RefCount.deref;

        fd: bun.FileDescriptor,
        reader: ReaderImpl,
        buf: std.ArrayListUnmanaged(u8) = .{},
        readers: Readers = .{ .inlined = .{} },
        read: usize = 0,
        ref_count: RefCount,
        err: ?JSC.SystemError = null,
        evtloop: JSC.EventLoopHandle,
        concurrent_task: JSC.EventLoopTask,
        async_deinit: AsyncDeinitReader,
        is_reading: if (bun.Environment.isWindows) bool else u0 = if (bun.Environment.isWindows) false else 0,

        pub const ChildPtr = IOReaderChildPtr;
        pub const ReaderImpl = bun.io.BufferedReader;

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
            const this = bun.new(IOReader, .{
                .ref_count = .init(),
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
            this.err = err.toShellSystemError();
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

        fn asyncDeinit(this: *@This()) void {
            log("IOReader(0x{x}) asyncDeinit", .{@intFromPtr(this)});
            this.async_deinit.enqueue(); // calls `asyncDeinitCallback`
        }

        fn asyncDeinitCallback(this: *@This()) void {
            if (this.fd != bun.invalid_fd) {
                // windows reader closes the file descriptor
                if (bun.Environment.isWindows) {
                    if (this.reader.source != null and !this.reader.source.?.isClosed()) {
                        this.reader.closeImpl(false);
                    }
                } else {
                    log("IOReader(0x{x}) __deinit fd={}", .{ @intFromPtr(this), this.fd });
                    this.fd.close();
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

    pub const AsyncDeinitReader = struct {
        ran: bool = false,

        pub fn enqueue(this: *@This()) void {
            if (this.ran) return;
            this.ran = true;

            var ioreader = this.reader();
            if (ioreader.evtloop == .js) {
                ioreader.evtloop.js.enqueueTaskConcurrent(ioreader.concurrent_task.js.from(this, .manual_deinit));
            } else {
                ioreader.evtloop.mini.enqueueTaskConcurrent(ioreader.concurrent_task.mini.from(this, "runFromMainThreadMini"));
            }
        }

        pub fn reader(this: *AsyncDeinitReader) *IOReader {
            return @alignCast(@fieldParentPtr("async_deinit", this));
        }

        pub fn runFromMainThread(this: *AsyncDeinitReader) void {
            const ioreader: *IOReader = @alignCast(@fieldParentPtr("async_deinit", this));
            ioreader.asyncDeinitCallback();
        }

        pub fn runFromMainThreadMini(this: *AsyncDeinitReader, _: *void) void {
            this.runFromMainThread();
        }
    };

    pub const IOWriter = @import("./IOWriter.zig");

    pub const AsyncDeinitWriter = struct {
        ran: bool = false,

        pub fn enqueue(this: *@This()) void {
            if (this.ran) return;
            this.ran = true;

            var iowriter = this.writer();

            if (iowriter.evtloop == .js) {
                iowriter.evtloop.js.enqueueTaskConcurrent(iowriter.concurrent_task.js.from(this, .manual_deinit));
            } else {
                iowriter.evtloop.mini.enqueueTaskConcurrent(iowriter.concurrent_task.mini.from(this, "runFromMainThreadMini"));
            }
        }

        pub fn writer(this: *@This()) *IOWriter {
            return @alignCast(@fieldParentPtr("async_deinit", this));
        }

        pub fn runFromMainThread(this: *@This()) void {
            this.writer().deinitOnMainThread();
        }

        pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
            this.runFromMainThread();
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
                    Ptr.assert_type(Ty);
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
                    Ptr.assert_type(Ty);
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
                    Ptr.assert_type(Ty);
                    const child_ptr = brk: {
                        const ChildPtr = getChildPtrType(Ty);
                        break :brk ChildPtr.init(child);
                    };
                    var casted = this.as(Ty);
                    casted.childDone(child_ptr, exit_code);
                    return;
                }
            }
            unknownTag(this.tagInt());
        }

        fn unknownTag(tag: Ptr.TagInt) void {
            if (bun.Environment.allow_assert) std.debug.panic("Bad tag: {d}\n", .{tag});
        }

        fn tagInt(this: @This()) Ptr.TagInt {
            return @intFromEnum(this.ptr.tag());
        }

        fn tagName(this: @This()) []const u8 {
            return Ptr.typeNameFromTag(this.tagInt()).?;
        }

        pub fn init(_ptr: anytype) @This() {
            const tyinfo = @typeInfo(@TypeOf(_ptr));
            if (tyinfo != .pointer) @compileError("Only pass pointers to StatePtrUnion.init(), you gave us a: " ++ @typeName(@TypeOf(_ptr)));
            const Type = std.meta.Child(@TypeOf(_ptr));
            Ptr.assert_type(Type);

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
        .pointer => |info| info.child,
        .Optional => |info| info.child,
        else => T,
    };
}

fn closefd(fd: bun.FileDescriptor) void {
    if (fd.closeAllowingBadFileDescriptor(null)) |err| {
        log("ERR closefd: {}\n", .{err});
    }
}

const CmdEnvIter = struct {
    env: *const bun.StringArrayHashMap([:0]const u8),
    iter: bun.StringArrayHashMap([:0]const u8).Iterator,

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

    pub fn fromEnv(env: *const bun.StringArrayHashMap([:0]const u8)) CmdEnvIter {
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
    comptime debug: bun.Output.LogFunction,
) type {
    return struct {
        task: WorkPoolTask = .{ .callback = &runFromThreadPool },
        event_loop: JSC.EventLoopHandle,
        // This is a poll because we want it to enter the uSockets loop
        ref: bun.Async.KeepAlive = .{},
        concurrent_task: JSC.EventLoopTask,

        pub const InnerShellTask = @This();

        pub fn schedule(this: *@This()) void {
            debug("schedule", .{});

            this.ref.ref(this.event_loop);
            WorkPool.schedule(&this.task);
        }

        pub fn onFinish(this: *@This()) void {
            debug("onFinish", .{});
            if (this.event_loop == .js) {
                const ctx: *Ctx = @fieldParentPtr("task", this);
                this.event_loop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(ctx, .manual_deinit));
            } else {
                const ctx = this;
                this.event_loop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(ctx, "runFromMainThreadMini"));
            }
        }

        pub fn runFromThreadPool(task: *WorkPoolTask) void {
            debug("runFromThreadPool", .{});
            var this: *@This() = @fieldParentPtr("task", task);
            const ctx: *Ctx = @fieldParentPtr("task", this);
            runFromThreadPool_(ctx);
            this.onFinish();
        }

        pub fn runFromMainThread(this: *@This()) void {
            debug("runFromJS", .{});
            const ctx: *Ctx = @fieldParentPtr("task", this);
            this.ref.unref(this.event_loop);
            runFromMainThread_(ctx);
        }

        pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
            this.runFromMainThread();
        }
    };
}

inline fn errnocast(errno: anytype) u16 {
    return @intCast(errno);
}

/// 'js' event loop will always return JSError
/// 'mini' event loop will always return noreturn and exit 1
fn throwShellErr(e: *const bun.shell.ShellErr, event_loop: JSC.EventLoopHandle) bun.JSError!noreturn {
    return switch (event_loop) {
        .mini => e.throwMini(),
        .js => e.throwJS(event_loop.js.global),
    };
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
        Interpreter.CondExpr,
        Interpreter.Subshell,
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
        Interpreter.Builtin.Exit,
        Interpreter.Builtin.True,
        Interpreter.Builtin.False,
        Interpreter.Builtin.Yes,
        Interpreter.Builtin.Seq,
        Interpreter.Builtin.Dirname,
        Interpreter.Builtin.Basename,
        Interpreter.Builtin.Cp,
        Interpreter.Builtin.Cp.ShellCpOutputTask,
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
pub const ShellSyscall = struct {
    pub const unlinkatWithFlags = Syscall.unlinkatWithFlags;
    pub const rmdirat = Syscall.rmdirat;
    pub fn getPath(dirfd: anytype, to: [:0]const u8, buf: *bun.PathBuffer) Maybe([:0]const u8) {
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

    pub fn statat(dir: bun.FileDescriptor, path_: [:0]const u8) Maybe(bun.Stat) {
        if (bun.Environment.isWindows) {
            var buf: bun.PathBuffer = undefined;
            const path = switch (getPath(dir, path_, &buf)) {
                .err => |e| return .{ .err = e },
                .result => |p| p,
            };

            return switch (Syscall.stat(path)) {
                .err => |e| .{ .err = e.clone(bun.default_allocator) catch bun.outOfMemory() },
                .result => |s| .{ .result = s },
            };
        }

        return Syscall.fstatat(dir, path_);
    }

    pub fn openat(dir: bun.FileDescriptor, path: [:0]const u8, flags: i32, perm: bun.Mode) Maybe(bun.FileDescriptor) {
        if (bun.Environment.isWindows) {
            if (flags & bun.O.DIRECTORY != 0) {
                if (ResolvePath.Platform.posix.isAbsolute(path[0..path.len])) {
                    var buf: bun.PathBuffer = undefined;
                    const p = switch (getPath(dir, path, &buf)) {
                        .result => |p| p,
                        .err => |e| return .{ .err = e },
                    };
                    return switch (Syscall.openDirAtWindowsA(dir, p, .{ .iterable = true, .no_follow = flags & bun.O.NOFOLLOW != 0 })) {
                        .result => |fd| fd.makeLibUVOwnedForSyscall(.open, .close_on_fail),
                        .err => |e| .{ .err = e.withPath(path) },
                    };
                }
                return switch (Syscall.openDirAtWindowsA(dir, path, .{ .iterable = true, .no_follow = flags & bun.O.NOFOLLOW != 0 })) {
                    .result => |fd| fd.makeLibUVOwnedForSyscall(.open, .close_on_fail),
                    .err => |e| .{ .err = e.withPath(path) },
                };
            }

            var buf: bun.PathBuffer = undefined;
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
            return fd.makeLibUVOwnedForSyscall(.open, .close_on_fail);
        }
        return .{ .result = fd };
    }

    pub fn open(file_path: [:0]const u8, flags: bun.Mode, perm: bun.Mode) Maybe(bun.FileDescriptor) {
        const fd = switch (Syscall.open(file_path, flags, perm)) {
            .result => |fd| fd,
            .err => |e| return .{ .err = e },
        };
        if (bun.Environment.isWindows) {
            return fd.makeLibUVOwnedForSyscall(.open, .close_on_fail);
        }
        return .{ .result = fd };
    }

    pub fn dup(fd: bun.FileDescriptor) Maybe(bun.FileDescriptor) {
        if (bun.Environment.isWindows) {
            return switch (Syscall.dup(fd)) {
                .result => |duped_fd| duped_fd.makeLibUVOwnedForSyscall(.dup, .close_on_fail),
                .err => |e| .{ .err = e },
            };
        }
        return Syscall.dup(fd);
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
            if (comptime bun.Environment.allow_assert) assert(this.state == .done);
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

        pub fn parseFlag(opts: Opts, flag: []const u8) ParseFlagResult {
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

pub fn isPollable(fd: bun.FileDescriptor, mode: bun.Mode) bool {
    return switch (bun.Environment.os) {
        .windows, .wasm => false,
        .linux => posix.S.ISFIFO(mode) or posix.S.ISSOCK(mode) or posix.isatty(fd.native()),
        // macos allows regular files to be pollable: ISREG(mode) == true
        .mac => posix.S.ISFIFO(mode) or posix.S.ISSOCK(mode) or posix.S.ISREG(mode) or posix.isatty(fd.native()),
    };
}
