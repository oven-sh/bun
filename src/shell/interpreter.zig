//! The interpreter for the shell language
//!
//! There are several constraints on the Bun shell language that make this
//! interpreter implementation unique:
//!
//! 1. We try to keep everything in the Bun process as much as possible for
//!    performance reasons and also to leverage Bun's existing IO/FS code
//! 2. We try to use non-blocking IO operations as much as possible so the
//!    shell does not block the main JS thread
//! 3. Zig does not have coroutines (yet)
//!
//! The idea is that this is a tree-walking interpreter. Except it's not.
//!
//! Why not? Because 99% of operations in the shell are IO, and we need to do
//! non-blocking IO because Bun is a JS runtime.
//!
//! So what do we do? Instead of iteratively walking the AST like in a traditional
//! tree-walking interpreter, we're also going to build up a tree of state-machines
//! (an AST node becomes a state-machine node), so we can suspend and resume
//! execution without blocking the main thread.
//!
//! We'll also need to do things in continuation-passing style, see `Yield.zig` for
//! more on that.
//!
//! Once all these pieces come together, this ends up being a:
//! "state-machine based [tree-walking], [trampoline]-driven [continuation-passing style] interpreter"
//!
//! [tree-walking]: https://en.wikipedia.org/wiki/Interpreter_(computing)#Abstract_syntax_tree_interpreters
//! [trampoline]:   https://en.wikipedia.org/wiki/Trampoline_(computing)
//! [continuation-passing style]: https://en.wikipedia.org/wiki/Continuation-passing_style
//!
//! # Memory management
//!
//! Almost all allocations go through the `AllocationScope` allocator. This
//! trackd memory allocations and frees in debug builds (or builds with asan
//! enabled) and helps us catch memory leaks.
//!
//! The underlying parent allocator that every `AllocationScope` uses in the
//! shell is `bun.default_allocator`. This means in builds of Bun which do not
//! have `AllocationScope` enabled, every allocation just goes straight through
//! to `bun.default_allocator`.
//!
//! Usually every state machine node ends up creating a new allocation scope,
//! so an `AllocationScope` is stored in the base header struct (see `Base.zig`)
//! that all state-machine nodes include in their layout.
//!
//! You will often see `Base.initWithNewAllocScope` to create a new state machine node
//! and allocation scope.
//!
//! Sometimes it is necessary to "leak" an allocation from its scope. For
//! example, argument expansion happens in an allocation scope inside
//! `Expansion.zig`.
//!
//! But the string that is expanded may end up becoming the key/value of an
//! environment variable, which we internally use the reference counted `EnvStr`
//! for. When we turn it into an `EnvStr`, the reference counting scheme is
//! responsible for managing the memory so we can call
//! `allocScope.leakSlice(str)` to tell it not to track the allocation anymore
//! and let `EnvStr` handle it.
const string = []const u8;
pub const Arena = std.heap.ArenaAllocator;
pub const Braces = @import("./braces.zig");
pub const Syscall = bun.sys;
pub const WorkPoolTask = jsc.WorkPoolTask;
pub const WorkPool = jsc.WorkPool;

pub const Pipe = [2]bun.FileDescriptor;
pub const SmolList = shell.SmolList;

pub const GlobWalker = bun.glob.BunGlobWalkerZ;

pub const stdin_no = 0;
pub const stdout_no = 1;
pub const stderr_no = 2;

pub fn OOM(e: anyerror) noreturn {
    if (comptime bun.Environment.allow_assert) {
        if (e != error.OutOfMemory) bun.outOfMemory();
    }
    bun.outOfMemory();
}

pub const log = bun.Output.scoped(.SHELL, .visible);

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

/// Similar to `OutputNeedsIOSafeGuard` but to ensure a function is
/// called at the "top" of the call-stack relative to the interpreter's
/// execution.
pub const CallstackGuard = enum(u0) { __i_know_what_i_am_doing };

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
    async,
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
pub const CowFd = struct {
    __fd: bun.FileDescriptor,
    refcount: u32 = 1,
    being_used: bool = false,

    const debug = bun.Output.scoped(.CowFd, .hidden);

    pub fn init(fd: bun.FileDescriptor) *CowFd {
        const this = bun.handleOom(bun.default_allocator.create(CowFd));
        this.* = .{
            .__fd = fd,
        };
        debug("init(0x{x}, fd={f})", .{ @intFromPtr(this), fd });
        return this;
    }

    pub fn dup(this: *CowFd) Maybe(*CowFd) {
        const new = bun.new(CowFd, .{
            .fd = bun.sys.dup(this.fd),
            .writercount = 1,
        });
        debug("dup(0x{x}, fd={f}) = (0x{x}, fd={f})", .{ @intFromPtr(this), this.fd, new, new.fd });
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

    pub fn dupeRef(this: *CowFd) *CowFd {
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

    pub fn memoryCost(this: *const ShellArgs) usize {
        return @sizeOf(ShellArgs) + this.script_ast.memoryCost();
    }
};

pub const AssignCtx = Interpreter.Assigns.AssignCtx;

/// This interpreter works by basically turning the AST into a state machine so
/// that execution can be suspended and resumed to support async.
pub const Interpreter = struct {
    pub const js = jsc.Codegen.JSShellInterpreter;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    command_ctx: bun.cli.Command.Context,
    event_loop: jsc.EventLoopHandle,
    /// This is the allocator used to allocate interpreter state
    allocator: Allocator,

    args: *ShellArgs,

    /// JS objects used as input for the shell script
    /// This should be allocated using the arena
    jsobjs: []JSValue,

    root_shell: ShellExecEnv,
    root_io: IO,

    has_pending_activity: std.atomic.Value(u32) = std.atomic.Value(u32).init(0),
    started: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    // Necessary for builtin commands.
    keep_alive: bun.Async.KeepAlive = .{},

    vm_args_utf8: std.array_list.Managed(jsc.ZigString.Slice),
    async_commands_executing: u32 = 0,

    globalThis: *jsc.JSGlobalObject,

    flags: packed struct(u8) {
        done: bool = false,
        quiet: bool = false,
        __unused: u6 = 0,
    } = .{},
    exit_code: ?ExitCode = 0,
    this_jsvalue: JSValue = .zero,

    __alloc_scope: if (bun.Environment.enableAllocScopes) bun.AllocationScope else void,
    estimated_size_for_gc: usize = 0,

    // Here are all the state nodes:
    pub const State = @import("./states/Base.zig");
    pub const Script = @import("./states/Script.zig");
    pub const Stmt = @import("./states/Stmt.zig");
    pub const Pipeline = @import("./states/Pipeline.zig");
    pub const Binary = @import("./states/Binary.zig");
    pub const Subshell = @import("./states/Subshell.zig");
    pub const Expansion = @import("./states/Expansion.zig");
    pub const Assigns = @import("./states/Assigns.zig");
    pub const Async = @import("./states/Async.zig");
    pub const CondExpr = @import("./states/CondExpr.zig");
    pub const If = @import("./states/If.zig");
    pub const Cmd = @import("./states/Cmd.zig");

    pub const InterpreterChildPtr = StatePtrUnion(.{
        Script,
    });

    /// During execution, the shell has an "environment" or "context". This
    /// contains important details like environment variables, cwd, etc. Every
    /// state node is given a `*ShellExecEnv` which is stored in its header (see
    /// `states/Base.zig`).
    ///
    /// Certain state nodes like subshells, pipelines, and cmd substitutions
    /// will duplicate their `*ShellExecEnv` so that they can make modifications
    /// without affecting their parent `ShellExecEnv`. This is done in the
    /// `.dupeForSubshell` function.
    ///
    /// For example:
    ///
    /// ```bash
    /// echo $(FOO=bar; echo $FOO); echo $FOO
    /// ```
    ///
    /// The $FOO variable is set inside the command substitution but not outside.
    ///
    /// Note that stdin/stdout/stderr is also considered to be part of the
    /// environment/context, but we keep that in a separate struct called `IO`. We do
    /// this because stdin/stdout/stderr changes a lot and we don't want to copy
    /// this `ShellExecEnv` struct too much.
    ///
    /// More info here: https://pubs.opengroup.org/onlinepubs/9699919799/utilities/V3_chap02.html#tag_18_12
    pub const ShellExecEnv = struct {
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
        __prev_cwd: std.array_list.Managed(u8),
        __cwd: std.array_list.Managed(u8),
        cwd_fd: bun.FileDescriptor,

        async_pids: SmolList(pid_t, 4) = SmolList(pid_t, 4).zeroes,

        __alloc_scope: if (bun.Environment.enableAllocScopes) *bun.AllocationScope else void,

        const pid_t = if (bun.Environment.isPosix) std.posix.pid_t else uv.uv_pid_t;

        const Bufio = union(enum) {
            owned: bun.ByteList,
            borrowed: *bun.ByteList,
            pub fn memoryCost(this: *const @This()) usize {
                return switch (this.*) {
                    .owned => |*owned| owned.memoryCost(),
                    .borrowed => |borrowed| borrowed.memoryCost(),
                };
            }
        };

        const Kind = enum {
            normal,
            cmd_subst,
            subshell,
            pipeline,
        };

        pub fn allocator(this: *ShellExecEnv) std.mem.Allocator {
            if (comptime bun.Environment.enableAllocScopes) return this.__alloc_scope.allocator();
            return bun.default_allocator;
        }

        pub fn memoryCost(this: *const ShellExecEnv) usize {
            var size: usize = @sizeOf(ShellExecEnv);
            size += this.shell_env.memoryCost();
            size += this.cmd_local_env.memoryCost();
            size += this.export_env.memoryCost();
            size += this.__cwd.allocatedSlice().len;
            size += this.__prev_cwd.allocatedSlice().len;
            size += this._buffered_stderr.memoryCost();
            size += this._buffered_stdout.memoryCost();
            size += this.async_pids.memoryCost();
            return size;
        }

        pub fn buffered_stdout(this: *ShellExecEnv) *bun.ByteList {
            return switch (this._buffered_stdout) {
                .owned => &this._buffered_stdout.owned,
                .borrowed => this._buffered_stdout.borrowed,
            };
        }

        pub fn buffered_stderr(this: *ShellExecEnv) *bun.ByteList {
            return switch (this._buffered_stderr) {
                .owned => &this._buffered_stderr.owned,
                .borrowed => this._buffered_stderr.borrowed,
            };
        }

        pub inline fn cwdZ(this: *ShellExecEnv) [:0]const u8 {
            if (this.__cwd.items.len == 0) return "";
            return this.__cwd.items[0..this.__cwd.items.len -| 1 :0];
        }

        pub inline fn prevCwdZ(this: *ShellExecEnv) [:0]const u8 {
            if (this.__prev_cwd.items.len == 0) return "";
            return this.__prev_cwd.items[0..this.__prev_cwd.items.len -| 1 :0];
        }

        pub inline fn prevCwd(this: *ShellExecEnv) []const u8 {
            const prevcwdz = this.prevCwdZ();
            return prevcwdz[0..prevcwdz.len];
        }

        pub inline fn cwd(this: *ShellExecEnv) []const u8 {
            const cwdz = this.cwdZ();
            return cwdz[0..cwdz.len];
        }

        pub fn deinit(this: *ShellExecEnv) void {
            this.deinitImpl(true, true);
        }

        /// Doesn't deref `this.io`
        ///
        /// If called by interpreter we have to:
        /// 1. not free this *ShellExecEnv, because its on a field on the interpreter
        /// 2. don't free buffered_stdout and buffered_stderr, because that is used for output
        fn deinitImpl(this: *ShellExecEnv, comptime destroy_this: bool, comptime free_buffered_io: bool) void {
            log("[ShellExecEnv] deinit {x}", .{@intFromPtr(this)});

            if (comptime free_buffered_io) {
                if (this._buffered_stdout == .owned) {
                    this._buffered_stdout.owned.clearAndFree(bun.default_allocator);
                }
                if (this._buffered_stderr == .owned) {
                    this._buffered_stderr.owned.clearAndFree(bun.default_allocator);
                }
            }

            this.shell_env.deinit();
            this.cmd_local_env.deinit();
            this.export_env.deinit();
            this.__cwd.deinit();
            this.__prev_cwd.deinit();
            closefd(this.cwd_fd);

            if (comptime destroy_this) this.allocator().destroy(this);
        }

        pub fn dupeForSubshell(
            this: *ShellExecEnv,
            alloc_scope: if (bun.Environment.enableAllocScopes) *bun.AllocationScope else void,
            alloc: Allocator,
            io: IO,
            kind: Kind,
        ) Maybe(*ShellExecEnv) {
            const duped = bun.handleOom(alloc.create(ShellExecEnv));

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
                .cmd_local_env = EnvMap.init(alloc),
                .export_env = this.export_env.clone(),

                .__prev_cwd = bun.handleOom(this.__prev_cwd.clone()),
                .__cwd = bun.handleOom(this.__cwd.clone()),
                // TODO probably need to use os.dup here
                .cwd_fd = dupedfd,
                .__alloc_scope = alloc_scope,
            };

            return .{ .result = duped };
        }

        /// NOTE: This will `.ref()` value, so you should `defer value.deref()` it before handing it to this function.
        pub fn assignVar(this: *ShellExecEnv, interp: *ThisInterpreter, label: EnvStr, value: EnvStr, assign_ctx: AssignCtx) void {
            _ = interp; // autofix
            switch (assign_ctx) {
                .cmd => this.cmd_local_env.insert(label, value),
                .shell => this.shell_env.insert(label, value),
                .exported => this.export_env.insert(label, value),
            }
        }

        pub fn changePrevCwd(self: *ShellExecEnv, interp: *ThisInterpreter) Maybe(void) {
            return self.changeCwd(interp, self.prevCwdZ());
        }

        pub fn changeCwd(this: *ShellExecEnv, interp: *ThisInterpreter, new_cwd_: anytype) Maybe(void) {
            return this.changeCwdImpl(interp, new_cwd_, false);
        }

        pub fn changeCwdImpl(this: *ShellExecEnv, _: *ThisInterpreter, new_cwd_: anytype, comptime in_init: bool) Maybe(void) {
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
            bun.handleOom(this.__prev_cwd.appendSlice(this.__cwd.items[0..]));

            this.__cwd.clearRetainingCapacity();
            bun.handleOom(this.__cwd.appendSlice(new_cwd[0 .. new_cwd.len + 1]));

            if (comptime bun.Environment.isDebug) {
                assert(this.__cwd.items[this.__cwd.items.len -| 1] == 0);
                assert(this.__prev_cwd.items[this.__prev_cwd.items.len -| 1] == 0);
            }

            this.cwd_fd = new_cwd_fd;

            if (comptime !in_init) {
                this.export_env.insert(EnvStr.initSlice("OLDPWD"), EnvStr.initSlice(this.prevCwd()));
            }
            this.export_env.insert(EnvStr.initSlice("PWD"), EnvStr.initSlice(this.cwd()));

            return .success;
        }

        pub fn getHomedir(self: *ShellExecEnv) EnvStr {
            const env_var: ?EnvStr = brk: {
                const static_str = if (comptime bun.Environment.isWindows) EnvStr.initSlice("USERPROFILE") else EnvStr.initSlice("HOME");
                break :brk self.shell_env.get(static_str) orelse self.export_env.get(static_str);
            };
            return env_var orelse EnvStr.initSlice("");
        }

        pub fn writeFailingErrorFmt(
            this: *ShellExecEnv,
            ctx: anytype,
            enqueueCb: fn (c: @TypeOf(ctx)) void,
            comptime fmt: []const u8,
            args: anytype,
        ) Yield {
            const io: *IO.OutKind = &@field(ctx.io, "stderr");
            switch (io.*) {
                .fd => |x| {
                    enqueueCb(ctx);
                    return x.writer.enqueueFmt(ctx, x.captured, fmt, args);
                },
                .pipe => {
                    const bufio: *bun.ByteList = this.buffered_stderr();
                    bun.handleOom(bufio.appendFmt(bun.default_allocator, fmt, args));
                    return ctx.parent.childDone(ctx, 1);
                },
                // FIXME: This is not correct? This would just make the entire shell hang I think?
                .ignore => {
                    const childptr = IOWriterChildPtr.init(ctx);
                    // TODO: is this necessary
                    const count = std.fmt.count(fmt, args);
                    return .{ .on_io_writer_chunk = .{
                        .child = childptr.asAnyOpaque(),
                        .err = null,
                        .written = count,
                    } };
                },
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

        fn toJS(this: ShellErrorCtx, globalThis: *JSGlobalObject) JSValue {
            return switch (this) {
                .syscall => |err| err.toJS(globalThis),
                .other => |err| bun.jsc.ZigString.fromBytes(@errorName(err)).toJS(globalThis),
            };
        }
    };

    fn #computeEstimatedSizeForGC(this: *const ThisInterpreter) usize {
        var size: usize = @sizeOf(ThisInterpreter);
        size += this.args.memoryCost();
        size += this.root_shell.memoryCost();
        size += this.root_io.memoryCost();
        size += this.jsobjs.len * @sizeOf(JSValue);
        for (this.vm_args_utf8.items) |arg| {
            size += arg.byteSlice().len;
        }
        size += this.vm_args_utf8.allocatedSlice().len * @sizeOf(jsc.ZigString.Slice);
        return size;
    }

    pub fn memoryCost(this: *const ThisInterpreter) usize {
        return this.#computeEstimatedSizeForGC();
    }

    pub fn estimatedSize(this: *const ThisInterpreter) usize {
        return this.estimated_size_for_gc;
    }

    pub fn createShellInterpreter(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const allocator = bun.default_allocator;
        const arguments_ = callframe.arguments_old(3);
        var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());

        const resolve = arguments.nextEat() orelse return globalThis.throw("shell: expected 3 arguments, got 0", .{});

        const reject = arguments.nextEat() orelse return globalThis.throw("shell: expected 3 arguments, got 0", .{});

        const parsed_shell_script_js = arguments.nextEat() orelse return globalThis.throw("shell: expected 3 arguments, got 0", .{});

        const parsed_shell_script = parsed_shell_script_js.as(ParsedShellScript) orelse return globalThis.throw("shell: expected a ParsedShellScript", .{});

        var shargs: *ShellArgs = undefined;
        var jsobjs: std.array_list.Managed(JSValue) = std.array_list.Managed(JSValue).init(allocator);
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

        const cwd_string: ?bun.jsc.ZigString.Slice = if (cwd) |c| brk: {
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
            // Note: Don't call shargs.deinit() here - interpreter.finalize() will do it
            // since interpreter.args points to shargs after init() succeeds.
            interpreter.finalize();
            return error.JSError;
        }

        interpreter.flags.quiet = quiet;
        interpreter.globalThis = globalThis;
        interpreter.estimated_size_for_gc = interpreter.#computeEstimatedSizeForGC();

        const js_value = Bun__createShellInterpreter(
            globalThis,
            interpreter,
            parsed_shell_script_js,
            resolve,
            reject,
        );
        interpreter.this_jsvalue = js_value;
        interpreter.keep_alive.ref(globalThis.bunVM());
        bun.analytics.Features.shell += 1;
        return js_value;
    }

    extern fn Bun__createShellInterpreter(globalThis: *jsc.JSGlobalObject, ptr: *Interpreter, parsed_shell_script: JSValue, resolve: JSValue, reject: JSValue) callconv(jsc.conv) JSValue;

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

        if (comptime bun.Environment.isDebug) {
            const debug = bun.Output.scoped(.ShellTokens, .hidden);
            var test_tokens = std.array_list.Managed(shell.Test.TestToken).initCapacity(arena_allocator, lex_result.tokens.len) catch @panic("OOPS");
            defer test_tokens.deinit();
            for (lex_result.tokens) |tok| {
                const test_tok = shell.Test.TestToken.from_real(tok, lex_result.strpool);
                test_tokens.append(test_tok) catch @panic("OOPS");
            }

            const str = bun.handleOom(std.fmt.allocPrint(bun.default_allocator, "{f}", .{std.json.fmt(test_tokens.items[0..], .{})}));
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
        ctx: bun.cli.Command.Context,
        event_loop: jsc.EventLoopHandle,
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
        const pathbuf = bun.path_buffer_pool.get();
        defer bun.path_buffer_pool.put(pathbuf);
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

        var cwd_arr = bun.handleOom(std.array_list.Managed(u8).initCapacity(bun.default_allocator, cwd.len + 1));
        bun.handleOom(cwd_arr.appendSlice(cwd[0 .. cwd.len + 1]));

        if (comptime bun.Environment.isDebug) {
            assert(cwd_arr.items[cwd_arr.items.len -| 1] == 0);
        }

        log("Duping stdin", .{});
        const stdin_fd = switch (if (bun.Output.Source.Stdio.isStdinNull()) bun.sys.openNullDevice() else ShellSyscall.dup(shell.STDIN_FD)) {
            .result => |fd| fd,
            .err => |err| return .{ .err = .{ .sys = err.toShellSystemError() } },
        };

        const stdin_reader = IOReader.init(stdin_fd, event_loop);

        const interpreter = bun.handleOom(allocator.create(ThisInterpreter));
        interpreter.* = .{
            .command_ctx = ctx,
            .event_loop = event_loop,

            .args = shargs,
            .allocator = allocator,
            .jsobjs = jsobjs,

            .root_shell = ShellExecEnv{
                .shell_env = EnvMap.init(allocator),
                .cmd_local_env = EnvMap.init(allocator),
                .export_env = export_env,

                .__cwd = cwd_arr,
                .__prev_cwd = bun.handleOom(cwd_arr.clone()),
                .cwd_fd = cwd_fd,

                .__alloc_scope = undefined,
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

            .vm_args_utf8 = std.array_list.Managed(jsc.ZigString.Slice).init(bun.default_allocator),
            .__alloc_scope = if (bun.Environment.enableAllocScopes) bun.AllocationScope.init(allocator) else {},
            .globalThis = undefined,
        };

        if (cwd_) |c| {
            if (interpreter.root_shell.changeCwdImpl(interpreter, c, true).asErr()) |e| return .{ .err = .{ .sys = e.toShellSystemError() } };
        }

        interpreter.root_shell.__alloc_scope = if (bun.Environment.enableAllocScopes) &interpreter.__alloc_scope else {};

        return .{ .result = interpreter };
    }

    pub fn initAndRunFromFile(ctx: bun.cli.Command.Context, mini: *jsc.MiniEventLoop, path: []const u8) !bun.shell.ExitCode {
        var shargs = ShellArgs.init();
        const src = try std.fs.cwd().readFileAlloc(shargs.arena_allocator(), path, std.math.maxInt(u32));
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
                interp.#deinitFromExec();
                bun.Output.err(e, "Failed to run script <b>{s}<r>", .{std.fs.path.basename(path)});
                bun.Global.exit(1);
                return 1;
            },
            else => {},
        }
        mini.tick(&is_done, @as(fn (*anyopaque) bool, IsDone.isDone));
        const code = interp.exit_code.?;
        interp.#deinitFromExec();
        return code;
    }

    pub fn initAndRunFromSource(ctx: bun.cli.Command.Context, mini: *jsc.MiniEventLoop, path_for_errors: []const u8, src: []const u8, cwd: ?[]const u8) !ExitCode {
        bun.analytics.Features.standalone_shell += 1;
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
                interp.#deinitFromExec();
                bun.Output.err(e, "Failed to run script <b>{s}<r>", .{path_for_errors});
                bun.Global.exit(1);
                return 1;
            },
            else => {},
        }
        mini.tick(&is_done, @as(fn (*anyopaque) bool, IsDone.isDone));
        const code = interp.exit_code.?;
        interp.#deinitFromExec();
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

        return .success;
    }

    pub fn run(this: *ThisInterpreter) !Maybe(void) {
        log("Interpreter(0x{x}) run", .{@intFromPtr(this)});
        if (this.setupIOBeforeRun().asErr()) |e| {
            return .{ .err = e };
        }

        var root = Script.init(this, &this.root_shell, &this.args.script_ast, Script.ParentPtr.init(this), this.root_io.copy());
        this.started.store(true, .seq_cst);
        root.start().run();

        return .success;
    }

    pub fn runFromJS(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        log("Interpreter(0x{x}) runFromJS", .{@intFromPtr(this)});
        _ = callframe; // autofix

        if (this.setupIOBeforeRun().asErr()) |e| {
            defer this.#deinitFromExec();
            const shellerr = bun.shell.ShellErr.newSys(e);
            return try throwShellErr(&shellerr, .{ .js = globalThis.bunVM().event_loop });
        }
        incrPendingActivityFlag(&this.has_pending_activity);

        var root = Script.init(this, &this.root_shell, &this.args.script_ast, Script.ParentPtr.init(this), this.root_io.copy());
        this.started.store(true, .seq_cst);
        root.start().run();
        if (globalThis.hasException()) return error.JSError;

        return .js_undefined;
    }

    fn ioToJSValue(globalThis: *JSGlobalObject, buf: *bun.ByteList) JSValue {
        const bytelist = buf.*;
        buf.* = .{};
        const buffer: jsc.Node.Buffer = .{
            .allocator = bun.default_allocator,
            .buffer = jsc.ArrayBuffer.fromBytes(@constCast(bytelist.slice()), .Uint8Array),
        };
        return buffer.toNodeBuffer(globalThis);
    }

    pub fn asyncCmdDone(this: *ThisInterpreter, async: *Async) void {
        log("asyncCommandDone {f}", .{async});
        async.actuallyDeinit();
        this.async_commands_executing -= 1;
        if (this.async_commands_executing == 0 and this.exit_code != null) {
            this.finish(this.exit_code.?).run();
        }
    }

    pub fn childDone(this: *ThisInterpreter, child: InterpreterChildPtr, exit_code: ExitCode) Yield {
        if (child.ptr.is(Script)) {
            const script = child.as(Script);
            script.deinitFromInterpreter();
            this.exit_code = exit_code;
            if (this.async_commands_executing == 0) return this.finish(exit_code);
            return .suspended;
        }
        @panic("Bad child");
    }

    pub fn finish(this: *ThisInterpreter, exit_code: ExitCode) Yield {
        log("Interpreter(0x{x}) finish {d}", .{ @intFromPtr(this), exit_code });
        defer decrPendingActivityFlag(&this.has_pending_activity);

        if (this.event_loop == .js) {
            this.exit_code = exit_code;
            const this_jsvalue = this.this_jsvalue;
            if (this_jsvalue != .zero) {
                if (jsc.Codegen.JSShellInterpreter.resolveGetCached(this_jsvalue)) |resolve| {
                    const loop = this.event_loop.js;
                    const globalThis = this.globalThis;
                    const buffered_stdout = this.getBufferedStdout(globalThis);
                    const buffered_stderr = this.getBufferedStderr(globalThis);
                    this.keep_alive.disable();
                    this.#derefRootShellAndIOIfNeeded(true);
                    loop.enter();
                    _ = resolve.call(globalThis, .js_undefined, &.{
                        JSValue.jsNumberFromU16(exit_code),
                        buffered_stdout,
                        buffered_stderr,
                    }) catch |err| globalThis.reportActiveExceptionAsUnhandled(err);
                    jsc.Codegen.JSShellInterpreter.resolveSetCached(this_jsvalue, globalThis, .js_undefined);
                    jsc.Codegen.JSShellInterpreter.rejectSetCached(this_jsvalue, globalThis, .js_undefined);
                    loop.exit();
                }
            }
        } else {
            this.flags.done = true;
            this.exit_code = exit_code;
        }

        return .done;
    }

    fn #derefRootShellAndIOIfNeeded(this: *ThisInterpreter, free_buffered_io: bool) void {
        if (free_buffered_io) {
            // Can safely be called multiple times.
            if (this.root_shell._buffered_stderr == .owned) {
                this.root_shell._buffered_stderr.owned.clearAndFree(bun.default_allocator);
            }
            if (this.root_shell._buffered_stdout == .owned) {
                this.root_shell._buffered_stdout.owned.clearAndFree(bun.default_allocator);
            }
        }

        // Has this already been finalized?
        if (this.this_jsvalue != .zero) {
            // Cannot be safely called multiple times.
            this.root_io.deref();
            this.root_shell.deinitImpl(false, false);
        }

        this.this_jsvalue = .zero;
    }

    fn deinitFromFinalizer(this: *ThisInterpreter) void {
        this.#derefRootShellAndIOIfNeeded(true);
        this.keep_alive.disable();
        this.args.deinit();
        this.allocator.destroy(this);
    }

    fn #deinitFromExec(this: *ThisInterpreter) void {
        log("deinit interpreter", .{});

        this.this_jsvalue = .zero;
        this.root_io.deref();
        this.root_shell.deinitImpl(false, true);

        for (this.vm_args_utf8.items[0..]) |str| {
            str.deinit();
        }
        this.vm_args_utf8.deinit();
        this.allocator.destroy(this);
    }

    pub fn setQuiet(this: *ThisInterpreter, _: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        log("Interpreter(0x{x}) setQuiet()", .{@intFromPtr(this)});
        this.flags.quiet = true;
        return .js_undefined;
    }

    pub fn setCwd(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const value = callframe.argument(0);
        const str = try bun.String.fromJS(value, globalThis);

        const slice = str.toUTF8(bun.default_allocator);
        defer slice.deinit();
        switch (this.root_shell.changeCwd(this, slice.slice())) {
            .err => |e| {
                return globalThis.throwValue(e.toJS(globalThis));
            },
            .result => {},
        }
        return .js_undefined;
    }

    pub fn setEnv(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        const value1 = callframe.argument(0);
        if (!value1.isObject()) {
            return globalThis.throwInvalidArguments("env must be an object", .{});
        }

        var object_iter = jsc.JSPropertyIterator(.{
            .skip_empty_name = false,
            .include_value = true,
        }).init(globalThis, value1);
        defer object_iter.deinit();

        this.root_shell.export_env.clearRetainingCapacity();
        this.root_shell.export_env.ensureTotalCapacity(object_iter.len);

        // If the env object does not include a $PATH, it must disable path lookup for argv[0]
        // PATH = "";

        while (object_iter.next()) |key| {
            const keyslice = bun.handleOom(key.toOwnedSlice(bun.default_allocator));
            var value = object_iter.value;
            if (value.isUndefined()) continue;

            const value_str = value.getZigString(globalThis);
            const slice = bun.handleOom(value_str.toOwnedSlice(bun.default_allocator));
            const keyref = EnvStr.initRefCounted(keyslice);
            defer keyref.deref();
            const valueref = EnvStr.initRefCounted(slice);
            defer valueref.deref();

            this.root_shell.export_env.insert(keyref, valueref);
        }

        return .js_undefined;
    }

    pub fn isRunning(this: *ThisInterpreter, _: *JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        return jsc.JSValue.jsBoolean(this.hasPendingActivity());
    }

    pub fn getStarted(this: *ThisInterpreter, globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
        _ = globalThis; // autofix
        _ = callframe; // autofix

        return jsc.JSValue.jsBoolean(this.started.load(.seq_cst));
    }

    pub fn getBufferedStdout(this: *ThisInterpreter, globalThis: *JSGlobalObject) jsc.JSValue {
        return ioToJSValue(globalThis, this.root_shell.buffered_stdout());
    }

    pub fn getBufferedStderr(this: *ThisInterpreter, globalThis: *JSGlobalObject) jsc.JSValue {
        return ioToJSValue(globalThis, this.root_shell.buffered_stderr());
    }

    pub fn finalize(this: *ThisInterpreter) void {
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

    pub fn getVmArgsUtf8(this: *Interpreter, argv: []const *WTFStringImplStruct, idx: u8) []const u8 {
        if (this.vm_args_utf8.items.len != argv.len) {
            bun.handleOom(this.vm_args_utf8.ensureTotalCapacity(argv.len));
            for (argv) |arg| {
                bun.handleOom(this.vm_args_utf8.append(arg.toUTF8(bun.default_allocator)));
            }
        }
        return this.vm_args_utf8.items[idx].slice();
    }

    const ExpansionOpts = struct {
        for_spawn: bool = true,
        single: bool = false,
    };

    pub const Builtin = @import("./Builtin.zig");

    /// TODO: Investigate whether or not this can be removed now that we have
    /// removed recursion
    pub const AsyncDeinitReader = IOReader.AsyncDeinitReader;

    pub const IO = @import("./IO.zig");
    pub const IOReader = @import("./IOReader.zig");
    pub const IOReaderChildPtr = IOReader.ChildPtr;
    pub const IOWriter = @import("./IOWriter.zig");

    pub const AsyncDeinitWriter = IOWriter.AsyncDeinitWriter;
};

/// Construct a tagged union of the state nodes provided in `TypesValue`.
/// The returned type has functions to call state node functions on the underlying type.
///
/// A state node must implement the following functions:
/// - `.start()`
/// - `.deinit()`
/// - `.childDone()`
///
/// In addition, a state node struct must declare a `pub const ChildPtr = StatePtrUnion(...)` variable.
/// This `ChildPtr` variable declares all the possible state nodes that can be a *child* of the state node.
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

        pub fn scopedAllocator(this: @This()) if (bun.Environment.enableAllocScopes) *bun.AllocationScope else void {
            if (comptime !bun.Environment.enableAllocScopes) return;

            const tags = comptime std.meta.fields(Ptr.Tag);
            inline for (tags) |tag| {
                if (this.tagInt() == tag.value) {
                    const Ty = comptime Ptr.typeFromTag(tag.value);
                    Ptr.assert_type(Ty);
                    var casted = this.as(Ty);
                    if (comptime Ty == Interpreter) {
                        return &casted.__alloc_scope;
                    }
                    return casted.base.__alloc_scope.scopedAllocator();
                }
            }
            unknownTag(this.tagInt());
        }

        pub fn allocator(this: @This()) std.mem.Allocator {
            const tags = comptime std.meta.fields(Ptr.Tag);
            inline for (tags) |tag| {
                if (this.tagInt() == tag.value) {
                    const Ty = comptime Ptr.typeFromTag(tag.value);
                    Ptr.assert_type(Ty);
                    var casted = this.as(Ty);
                    if (comptime Ty == Interpreter) {
                        if (bun.Environment.enableAllocScopes) return casted.__alloc_scope.allocator();
                        return bun.default_allocator;
                    }
                    return casted.base.allocator();
                }
            }
            unknownTag(this.tagInt());
        }

        pub fn create(this: @This(), comptime Ty: type) *Ty {
            if (comptime bun.Environment.enableAllocScopes) {
                return bun.handleOom(this.allocator().create(Ty));
            }
            return bun.handleOom(bun.default_allocator.create(Ty));
        }

        pub fn destroy(this: @This(), ptr: anytype) void {
            if (comptime bun.Environment.enableAllocScopes) {
                this.allocator().destroy(ptr);
            } else {
                bun.default_allocator.destroy(ptr);
            }
        }

        /// Starts the state node.
        pub fn start(this: @This()) Yield {
            const tags = comptime std.meta.fields(Ptr.Tag);
            inline for (tags) |tag| {
                if (this.tagInt() == tag.value) {
                    const Ty = comptime Ptr.typeFromTag(tag.value);
                    Ptr.assert_type(Ty);
                    var casted = this.as(Ty);
                    return casted.start();
                }
            }
            unknownTag(this.tagInt());
        }

        /// Deinitializes the state node
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

        /// Signals to the state node that one of its children completed with the
        /// given exit code
        pub fn childDone(this: @This(), child: anytype, exit_code: ExitCode) Yield {
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
                    return casted.childDone(child_ptr, exit_code);
                }
            }
            unknownTag(this.tagInt());
        }

        pub fn unknownTag(tag: Ptr.TagInt) noreturn {
            return bun.Output.panic("Unknown tag for shell state node: {d}\n", .{tag});
        }

        pub fn tagInt(this: @This()) Ptr.TagInt {
            return @intFromEnum(this.ptr.tag());
        }

        pub fn tagName(this: @This()) []const u8 {
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

pub fn closefd(fd: bun.FileDescriptor) void {
    if (fd.closeAllowingBadFileDescriptor(null)) |err| {
        log("ERR closefd: {f}\n", .{err});
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

        pub fn format(self: Value, writer: *std.Io.Writer) !void {
            try writer.writeAll(self.val);
        }
    };

    const Key = struct {
        val: []const u8,

        pub fn format(self: Key, writer: *std.Io.Writer) !void {
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
        event_loop: jsc.EventLoopHandle,
        // This is a poll because we want it to enter the uSockets loop
        ref: bun.Async.KeepAlive = .{},
        concurrent_task: jsc.EventLoopTask,

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
pub fn throwShellErr(e: *const bun.shell.ShellErr, event_loop: jsc.EventLoopHandle) bun.JSError!noreturn {
    return switch (event_loop) {
        .mini => e.throwMini(),
        .js => e.throwJS(event_loop.js.global),
    };
}

pub const ReadChunkAction = enum {
    stop_listening,
    cont,
};

pub const IOWriterChildPtr = Interpreter.IOWriter.ChildPtr;

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
            const buf: *bun.PathBuffer = bun.path_buffer_pool.get();
            defer bun.path_buffer_pool.put(buf);
            const path = switch (getPath(dir, path_, buf)) {
                .err => |e| return .{ .err = e },
                .result => |p| p,
            };

            return switch (Syscall.stat(path)) {
                .err => |e| .{ .err = e.clone(bun.default_allocator) },
                .result => |s| .{ .result = s },
            };
        }

        return Syscall.fstatat(dir, path_);
    }

    /// Same thing as bun.sys.openat on posix
    /// On windows it will convert paths for us
    pub fn openat(dir: bun.FileDescriptor, path: [:0]const u8, flags: i32, perm: bun.Mode) Maybe(bun.FileDescriptor) {
        if (bun.Environment.isWindows) {
            if (flags & bun.O.DIRECTORY != 0) {
                if (ResolvePath.Platform.posix.isAbsolute(path[0..path.len])) {
                    const buf: *bun.PathBuffer = bun.path_buffer_pool.get();
                    defer bun.path_buffer_pool.put(buf);
                    const p = switch (getPath(dir, path, buf)) {
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

            const buf: *bun.PathBuffer = bun.path_buffer_pool.get();
            defer bun.path_buffer_pool.put(buf);
            const p = switch (getPath(dir, path, buf)) {
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
        writeErr: *const fn (*Parent, childptr: anytype, []const u8) ?Yield,
        onWriteErr: *const fn (*Parent) void,
        writeOut: *const fn (*Parent, childptr: anytype, *OutputSrc) ?Yield,
        onWriteOut: *const fn (*Parent) void,
        onDone: *const fn (*Parent) Yield,
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

        pub fn deinit(this: *@This()) Yield {
            if (comptime bun.Environment.allow_assert) assert(this.state == .done);
            log("OutputTask({s}, 0x{x}) deinit", .{ @typeName(Parent), @intFromPtr(this) });
            defer bun.destroy(this);
            defer this.output.deinit();
            return vtable.onDone(this.parent);
        }

        pub fn start(this: *@This(), errbuf: ?[]const u8) Yield {
            log("OutputTask({s}, 0x{x}) start errbuf={s}", .{ @typeName(Parent), @intFromPtr(this), if (errbuf) |err| err[0..@min(128, err.len)] else "null" });
            this.state = .waiting_write_err;
            if (errbuf) |err| {
                if (vtable.writeErr(this.parent, this, err)) |yield| return yield;
                return this.next();
            }
            this.state = .waiting_write_out;
            if (vtable.writeOut(this.parent, this, &this.output)) |yield| return yield;
            vtable.onWriteOut(this.parent);
            this.state = .done;
            return this.deinit();
        }

        pub fn next(this: *@This()) Yield {
            switch (this.state) {
                .waiting_write_err => {
                    vtable.onWriteErr(this.parent);
                    this.state = .waiting_write_out;
                    if (vtable.writeOut(this.parent, this, &this.output)) |yield| return yield;
                    vtable.onWriteOut(this.parent);
                    this.state = .done;
                    return this.deinit();
                },
                .waiting_write_out => {
                    vtable.onWriteOut(this.parent);
                    this.state = .done;
                    return this.deinit();
                },
                .done => @panic("Invalid state"),
            }
        }

        pub fn onIOWriterChunk(this: *@This(), _: usize, err: ?jsc.SystemError) Yield {
            log("OutputTask({s}, 0x{x}) onIOWriterChunk", .{ @typeName(Parent), @intFromPtr(this) });
            if (err) |e| {
                e.deref();
            }

            switch (this.state) {
                .waiting_write_err => {
                    vtable.onWriteErr(this.parent);
                    this.state = .waiting_write_out;
                    if (vtable.writeOut(this.parent, this, &this.output)) |yield| return yield;
                    vtable.onWriteOut(this.parent);
                    this.state = .done;
                    return this.deinit();
                },
                .waiting_write_out => {
                    vtable.onWriteOut(this.parent);
                    this.state = .done;
                    return this.deinit();
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
        // macos DOES allow regular files to be pollable, but we don't want that because
        // our IOWriter code has a separate and better codepath for writing to files.
        .mac => if (posix.S.ISREG(mode)) false else posix.S.ISFIFO(mode) or posix.S.ISSOCK(mode) or posix.isatty(fd.native()),
    };
}

pub fn isPollableFromMode(mode: bun.Mode) bool {
    return switch (bun.Environment.os) {
        .windows, .wasm => false,
        .linux => posix.S.ISFIFO(mode) or posix.S.ISSOCK(mode),
        // macos DOES allow regular files to be pollable, but we don't want that because
        // our IOWriter code has a separate and better codepath for writing to files.
        .mac => if (posix.S.ISREG(mode)) false else posix.S.ISFIFO(mode) or posix.S.ISSOCK(mode),
    };
}

pub fn unreachableState(context: []const u8, state: []const u8) noreturn {
    @branchHint(.cold);
    return bun.Output.panic("Bun shell has reached an unreachable state \"{s}\" in the {s} context. This indicates a bug, please open a GitHub issue.", .{ state, context });
}

const builtin = @import("builtin");
const WTFStringImplStruct = @import("../string.zig").WTFStringImplStruct;

const bun = @import("bun");
const ResolvePath = bun.path;
const TaggedPointerUnion = bun.TaggedPointerUnion;
const assert = bun.assert;
const which = bun.which;
const Maybe = bun.sys.Maybe;

const jsc = bun.jsc;
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSValue = bun.jsc.JSValue;

const shell = bun.shell;
const Yield = shell.Yield;
const ast = shell.AST;

const windows = bun.windows;
const uv = windows.libuv;

const std = @import("std");
const posix = std.posix;
const Allocator = std.mem.Allocator;
