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

pub const interpret = @import("./interpreter.zig");
pub const subproc = @import("./subproc.zig");

pub const EnvMap = interpret.EnvMap;
pub const EnvStr = interpret.EnvStr;
pub const Interpreter = interpret.Interpreter;
pub const ParsedShellScript = interpret.ParsedShellScript;
pub const Subprocess = subproc.ShellSubprocess;
pub const ExitCode = interpret.ExitCode;
pub const IOWriter = Interpreter.IOWriter;
pub const IOReader = Interpreter.IOReader;
// pub const IOWriter = interpret.IOWriter;
// pub const SubprocessMini = subproc.ShellSubprocessMini;

const GlobWalker = Glob.GlobWalker_(null, true);
// const GlobWalker = Glob.BunGlobWalker;

pub const SUBSHELL_TODO_ERROR = "Subshells are not implemented, please open GitHub issue!";

/// Using these instead of `bun.STD{IN,OUT,ERR}_FD` to makesure we use uv fd
pub const STDIN_FD: bun.FileDescriptor = if (bun.Environment.isWindows) bun.FDImpl.fromUV(0).encode() else bun.STDIN_FD;
pub const STDOUT_FD: bun.FileDescriptor = if (bun.Environment.isWindows) bun.FDImpl.fromUV(1).encode() else bun.STDOUT_FD;
pub const STDERR_FD: bun.FileDescriptor = if (bun.Environment.isWindows) bun.FDImpl.fromUV(2).encode() else bun.STDERR_FD;

pub const POSIX_DEV_NULL: [:0]const u8 = "/dev/null";
pub const WINDOWS_DEV_NULL: [:0]const u8 = "NUL";

/// The strings in this type are allocated with event loop ctx allocator
pub const ShellErr = union(enum) {
    sys: JSC.SystemError,
    custom: []const u8,
    invalid_arguments: struct { val: []const u8 = "" },
    todo: []const u8,

    pub fn newSys(e: anytype) @This() {
        return .{
            .sys = switch (@TypeOf(e)) {
                Syscall.Error => e.toSystemError(),
                JSC.SystemError => e,
                else => @compileError("Invalid `e`: " ++ @typeName(e)),
            },
        };
    }

    pub fn fmt(this: @This()) []const u8 {
        switch (this) {
            .sys => {
                const err = this.sys;
                const str = std.fmt.allocPrint(bun.default_allocator, "bun: {s}: {}\n", .{ err.message, err.path }) catch bun.outOfMemory();
                return str;
            },
            .custom => {
                return std.fmt.allocPrint(bun.default_allocator, "bun: {s}\n", .{this.custom}) catch bun.outOfMemory();
            },
            .invalid_arguments => {
                const str = std.fmt.allocPrint(bun.default_allocator, "bun: invalid arguments: {s}\n", .{this.invalid_arguments.val}) catch bun.outOfMemory();
                return str;
            },
            .todo => {
                const str = std.fmt.allocPrint(bun.default_allocator, "bun: TODO: {s}\n", .{this.invalid_arguments.val}) catch bun.outOfMemory();
                return str;
            },
        }
    }

    pub fn throwJS(this: *const @This(), globalThis: *JSC.JSGlobalObject) void {
        defer this.deinit(bun.default_allocator);
        switch (this.*) {
            .sys => {
                const err = this.sys.toErrorInstance(globalThis);
                globalThis.throwValue(err);
            },
            .custom => {
                var str = JSC.ZigString.init(this.custom);
                str.markUTF8();
                const err_value = str.toErrorInstance(globalThis);
                globalThis.throwValue(err_value);
                // this.bunVM().allocator.free(JSC.ZigString.untagged(str._unsafe_ptr_do_not_use)[0..str.len]);
            },
            .invalid_arguments => {
                globalThis.throwInvalidArguments("{s}", .{this.invalid_arguments.val});
            },
            .todo => {
                globalThis.throwTODO(this.todo);
            },
        }
    }

    pub fn throwMini(this: @This()) void {
        defer this.deinit(bun.default_allocator);
        switch (this) {
            .sys => |err| {
                bun.Output.prettyErrorln("<r><red>error<r>: Failed due to error: <b>bunsh: {s}: {}<r>", .{ err.message, err.path });
                bun.Global.exit(1);
            },
            .custom => |custom| {
                bun.Output.prettyErrorln("<r><red>error<r>: Failed due to error: <b>{s}<r>", .{custom});
                bun.Global.exit(1);
            },
            .invalid_arguments => |invalid_arguments| {
                bun.Output.prettyErrorln("<r><red>error<r>: Failed due to error: <b>bunsh: invalid arguments: {s}<r>", .{invalid_arguments.val});
                bun.Global.exit(1);
            },
            .todo => |todo| {
                bun.Output.prettyErrorln("<r><red>error<r>: Failed due to error: <b>TODO: {s}<r>", .{todo});
                bun.Global.exit(1);
            },
        }
    }

    pub fn deinit(this: @This(), allocator: Allocator) void {
        switch (this) {
            .sys => {
                // this.sys.
            },
            .custom => allocator.free(this.custom),
            .invalid_arguments => {},
            .todo => allocator.free(this.todo),
        }
    }
};

pub fn Result(comptime T: anytype) type {
    return union(enum) {
        result: T,
        err: ShellErr,

        pub const success: @This() = @This(){
            .result = std.mem.zeroes(T),
        };

        pub fn asErr(this: @This()) ?ShellErr {
            if (this == .err) return this.err;
            return null;
        }
    };
}

pub const ShellError = error{ Init, Process, GlobalThisThrown, Spawn };
pub const ParseError = error{
    Unsupported,
    Expected,
    Unexpected,
    Unknown,
    Lex,
};

extern "C" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: i32) i32;

fn setEnv(name: [*:0]const u8, value: [*:0]const u8) void {
    // TODO: windows
    _ = setenv(name, value, 1);
}

/// [0] => read end
/// [1] => write end
pub const Pipe = [2]bun.FileDescriptor;

const log = bun.Output.scoped(.SHELL, true);
const logsys = bun.Output.scoped(.SYS, true);

pub const GlobalJS = struct {
    globalThis: *JSC.JSGlobalObject,

    pub inline fn init(g: *JSC.JSGlobalObject) GlobalJS {
        return .{
            .globalThis = g,
        };
    }

    pub inline fn allocator(this: @This()) Allocator {
        return this.globalThis.bunVM().allocator;
    }

    pub inline fn eventLoopCtx(this: @This()) *JSC.VirtualMachine {
        return this.globalThis.bunVM();
    }

    pub inline fn throwInvalidArguments(this: @This(), comptime fmt: []const u8, args: anytype) ShellErr {
        return .{
            .invalid_arguments = .{ .val = std.fmt.allocPrint(this.globalThis.bunVM().allocator, fmt, args) catch bun.outOfMemory() },
        };
    }

    pub inline fn throwTODO(this: @This(), msg: []const u8) ShellErr {
        return .{
            .todo = std.fmt.allocPrint(this.globalThis.bunVM().allocator, "{s}", .{msg}) catch bun.outOfMemory(),
        };
    }

    pub inline fn throwError(this: @This(), err: bun.sys.Error) void {
        this.globalThis.throwValue(err.toJSC(this.globalThis));
    }

    pub inline fn handleError(this: @This(), err: anytype, comptime fmt: []const u8) ShellErr {
        const str = std.fmt.allocPrint(this.globalThis.bunVM().allocator, "{s} " ++ fmt, .{@errorName(err)}) catch bun.outOfMemory();
        return .{
            .custom = str,
        };
    }

    pub inline fn throw(this: @This(), comptime fmt: []const u8, args: anytype) ShellErr {
        const str = std.fmt.allocPrint(this.globalThis.bunVM().allocator, fmt, args) catch bun.outOfMemory();
        return .{
            .custom = str,
        };
    }

    pub inline fn createNullDelimitedEnvMap(this: @This(), alloc: Allocator) ![:null]?[*:0]u8 {
        return this.globalThis.bunVM().bundler.env.map.createNullDelimitedEnvMap(alloc);
    }

    pub inline fn getAllocator(this: @This()) Allocator {
        return this.globalThis.bunVM().allocator;
    }

    pub inline fn enqueueTaskConcurrentWaitPid(this: @This(), task: anytype) void {
        this.globalThis.bunVMConcurrently().enqueueTaskConcurrent(JSC.ConcurrentTask.create(JSC.Task.init(task)));
    }

    pub inline fn topLevelDir(this: @This()) []const u8 {
        return this.globalThis.bunVM().bundler.fs.top_level_dir;
    }

    pub inline fn env(this: @This()) *bun.DotEnv.Loader {
        return this.globalThis.bunVM().bundler.env;
    }

    pub inline fn platformEventLoop(this: @This()) *JSC.PlatformEventLoop {
        const loop = JSC.AbstractVM(this.eventLoopCtx());
        return loop.platformEventLoop();
    }

    pub inline fn actuallyThrow(this: @This(), shellerr: ShellErr) void {
        shellerr.throwJS(this.globalThis);
    }
};

pub const GlobalMini = struct {
    mini: *JSC.MiniEventLoop,

    pub inline fn init(g: *JSC.MiniEventLoop) @This() {
        return .{
            .mini = g,
        };
    }

    pub inline fn env(this: @This()) *bun.DotEnv.Loader {
        return this.mini.env.?;
    }

    pub inline fn allocator(this: @This()) Allocator {
        return this.mini.allocator;
    }

    pub inline fn eventLoopCtx(this: @This()) *JSC.MiniEventLoop {
        return this.mini;
    }

    // pub inline fn throwShellErr(this: @This(), shell_err: ShellErr

    pub inline fn throwTODO(this: @This(), msg: []const u8) ShellErr {
        return .{
            .todo = std.fmt.allocPrint(this.mini.allocator, "{s}", .{msg}) catch bun.outOfMemory(),
        };
    }

    pub inline fn throwInvalidArguments(this: @This(), comptime fmt: []const u8, args: anytype) ShellErr {
        return .{
            .invalid_arguments = .{ .val = std.fmt.allocPrint(this.allocator(), fmt, args) catch bun.outOfMemory() },
        };
    }

    pub inline fn handleError(this: @This(), err: anytype, comptime fmt: []const u8) ShellErr {
        const str = std.fmt.allocPrint(this.mini.allocator, "{s} " ++ fmt, .{@errorName(err)}) catch bun.outOfMemory();
        return .{
            .custom = str,
        };
    }

    pub inline fn createNullDelimitedEnvMap(this: @This(), alloc: Allocator) ![:null]?[*:0]u8 {
        return this.mini.env.?.map.createNullDelimitedEnvMap(alloc);
    }

    pub inline fn getAllocator(this: @This()) Allocator {
        return this.mini.allocator;
    }

    pub inline fn enqueueTaskConcurrentWaitPid(this: @This(), task: anytype) void {
        var anytask = bun.default_allocator.create(JSC.AnyTaskWithExtraContext) catch bun.outOfMemory();
        _ = anytask.from(task, "runFromMainThreadMini");
        this.mini.enqueueTaskConcurrent(anytask);
    }

    pub inline fn topLevelDir(this: @This()) []const u8 {
        return this.mini.top_level_dir;
    }

    pub inline fn throw(this: @This(), comptime fmt: []const u8, args: anytype) ShellErr {
        const str = std.fmt.allocPrint(this.allocator(), fmt, args) catch bun.outOfMemory();
        return .{
            .custom = str,
        };
    }

    pub inline fn actuallyThrow(this: @This(), shellerr: ShellErr) void {
        _ = this; // autofix
        shellerr.throwMini();
    }

    pub inline fn platformEventLoop(this: @This()) *JSC.PlatformEventLoop {
        const loop = JSC.AbstractVM(this.eventLoopCtx());
        return loop.platformEventLoop();
    }
};

// const GlobalHandle = if (JSC.EventLoopKind == .js) GlobalJS else GlobalMini;

pub const AST = struct {
    pub const Script = struct {
        stmts: []Stmt,
    };

    pub const Stmt = struct {
        exprs: []Expr,
    };

    pub const Expr = union(Expr.Tag) {
        assign: []Assign,
        binary: *Binary,
        pipeline: *Pipeline,
        cmd: *Cmd,
        subshell: *Subshell,
        @"if": *If,
        condexpr: *CondExpr,
        /// Valid async (`&`) expressions:
        /// - pipeline
        /// - cmd
        /// - subshell
        /// - if
        /// - condexpr
        /// Note that commands in a pipeline cannot be async
        /// TODO: Extra indirection for essentially a boolean feels bad for performance
        /// could probably find a more efficient way to encode this information.
        @"async": *Expr,

        pub fn asPipelineItem(this: *Expr) ?PipelineItem {
            return switch (this.*) {
                .assign => .{ .assigns = this.assign },
                .cmd => .{ .cmd = this.cmd },
                .subshell => .{ .subshell = this.subshell },
                .@"if" => .{ .@"if" = this.@"if" },
                .condexpr => .{ .condexpr = this.condexpr },
                else => null,
            };
        }

        pub const Tag = enum {
            assign,
            binary,
            pipeline,
            cmd,
            subshell,
            @"if",
            condexpr,
            @"async",
        };
    };

    /// https://www.gnu.org/software/bash/manual/bash.html#Bash-Conditional-Expressions
    pub const CondExpr = struct {
        op: Op,
        args: ArgList = ArgList.zeroes,

        const ArgList = SmolList(Atom, 2);

        // args: SmolList(1, comptime INLINED_MAX: comptime_int)
        pub const Op = enum {
            /// -a file
            ///   True if file exists.
            @"-a",

            /// -b file
            ///   True if file exists and is a block special file.
            @"-b",

            /// -c file
            ///   True if file exists and is a character special file.
            @"-c",

            /// -d file
            ///   True if file exists and is a directory.
            @"-d",

            /// -e file
            ///   True if file exists.
            @"-e",

            /// -f file
            ///   True if file exists and is a regular file.
            @"-f",

            /// -g file
            ///   True if file exists and its set-group-id bit is set.
            @"-g",

            /// -h file
            ///   True if file exists and is a symbolic link.
            @"-h",

            /// -k file
            ///   True if file exists and its "sticky" bit is set.
            @"-k",

            /// -p file
            ///   True if file exists and is a named pipe (FIFO).
            @"-p",

            /// -r file
            ///   True if file exists and is readable.
            @"-r",

            /// -s file
            ///   True if file exists and has a size greater than zero.
            @"-s",

            /// -t fd
            ///   True if file descriptor fd is open and refers to a terminal.
            @"-t",

            /// -u file
            ///   True if file exists and its set-user-id bit is set.
            @"-u",

            /// -w file
            ///   True if file exists and is writable.
            @"-w",

            /// -x file
            ///   True if file exists and is executable.
            @"-x",

            /// -G file
            ///   True if file exists and is owned by the effective group id.
            @"-G",

            /// -L file
            ///   True if file exists and is a symbolic link.
            @"-L",

            /// -N file
            ///   True if file exists and has been modified since it was last read.
            @"-N",

            /// -O file
            ///   True if file exists and is owned by the effective user id.
            @"-O",

            /// -S file
            ///   True if file exists and is a socket.
            @"-S",

            /// file1 -ef file2
            ///   True if file1 and file2 refer to the same device and inode numbers.
            @"-ef",

            /// file1 -nt file2
            ///   True if file1 is newer than file2, or if file1 exists and file2 does not.
            @"-nt",

            /// file1 -ot file2
            ///   True if file1 is older than file2, or if file2 exists and file1 does not.
            @"-ot",

            /// -o optname
            ///   True if the shell option optname is enabled.
            @"-o",

            /// -v varname
            ///   True if the shell variable varname is set.
            @"-v",

            /// -R varname
            ///   True if the shell variable varname is set and is a name reference.
            @"-R",

            /// -z string
            ///   True if the length of string is zero.
            @"-z",

            /// -n string
            ///   True if the length of string is non-zero.
            @"-n",

            /// string1 == string2
            ///   True if the strings are equal.
            @"==",

            /// string1 != string2
            ///   True if the strings are not equal.
            @"!=",

            /// string1 < string2
            ///   True if string1 sorts before string2 lexicographically.
            @"<",

            /// string1 > string2
            ///   True if string1 sorts after string2 lexicographically.
            @">",

            /// arg1 OP arg2
            ///   OP is one of ‘-eq’, ‘-ne’, ‘-lt’, ‘-le’, ‘-gt’, or ‘-ge’.
            ///   These arithmetic binary operators return true if arg1 is equal to, not equal to, less than,
            ///   less than or equal to, greater than, or greater than or equal to arg2, respectively.
            @"-eq",
            @"-ne",
            @"-lt",
            @"-le",
            @"-gt",
            @"-ge",

            pub const SUPPORTED: []const Op = &.{
                .@"-f",
                .@"-z",
                .@"-n",
                .@"-d",
                .@"-c",
                .@"==",
                .@"!=",
            };

            pub fn isSupported(op: Op) bool {
                inline for (SUPPORTED) |supported_op| {
                    if (supported_op == op) return true;
                }
                return false;
            }

            const SINGLE_ARG_OPS: []const std.builtin.Type.EnumField = brk: {
                const fields: []const std.builtin.Type.EnumField = std.meta.fields(AST.CondExpr.Op);
                const count = count: {
                    var count: usize = 0;
                    for (fields) |f| {
                        if (f.name[0] == '-' and f.name.len == 2) {
                            count += 1;
                        }
                    }
                    break :count count;
                };
                var ret: [count]std.builtin.Type.EnumField = undefined;
                var len: usize = 0;
                for (fields) |f| {
                    if (f.name[0] == '-' and f.name.len == 2) {
                        ret[len] = f;
                        len += 1;
                    }
                }
                const final = ret[0..].*;
                break :brk &final;
            };

            const BINARY_OPS: []const std.builtin.Type.EnumField = brk: {
                const fields: []const std.builtin.Type.EnumField = std.meta.fields(AST.CondExpr.Op);
                const count = count: {
                    var count: usize = 0;
                    for (fields) |f| {
                        if (!(f.name[0] == '-' and f.name.len == 2)) {
                            count += 1;
                        }
                    }
                    break :count count;
                };
                var ret: [count]std.builtin.Type.EnumField = undefined;
                var len: usize = 0;
                for (fields) |f| {
                    if (!(f.name[0] == '-' and f.name.len == 2)) {
                        ret[len] = f;
                        len += 1;
                    }
                }
                const final = ret[0..].*;
                break :brk &final;
            };
        };

        pub fn to_expr(this: CondExpr, alloc: Allocator) !Expr {
            const condexpr = try alloc.create(CondExpr);
            condexpr.* = this;
            return .{
                .condexpr = condexpr,
            };
        }
    };

    pub const Subshell = struct {
        script: Script,
        redirect: ?Redirect = null,
        redirect_flags: RedirectFlags = .{},
    };

    /// TODO: If we know cond/then/elif/else is just a single command we don't need to store the stmt
    pub const If = struct {
        cond: SmolList(Stmt, 1) = SmolList(Stmt, 1).zeroes,
        then: SmolList(Stmt, 1) = SmolList(Stmt, 1).zeroes,
        /// From the spec:
        ///
        /// else_part        : Elif compound_list Then else_part
        ///                  | Else compound_list
        ///
        /// If len is:
        /// - 0                                   => no else
        /// - 1                                   => just else
        /// - 2n (n is # of elif/then branches)   => n elif/then branches
        /// - 2n + 1                              => n elif/then branches and an else branch
        else_parts: SmolList(SmolList(Stmt, 1), 1) = SmolList(SmolList(Stmt, 1), 1).zeroes,

        pub fn to_expr(this: If, alloc: Allocator) !Expr {
            const @"if" = try alloc.create(If);
            @"if".* = this;
            return .{
                .@"if" = @"if",
            };
        }
    };

    pub const Binary = struct {
        op: Op,
        left: Expr,
        right: Expr,

        const Op = enum { And, Or };
    };

    pub const Pipeline = struct {
        items: []PipelineItem,
    };

    pub const PipelineItem = union(enum) {
        cmd: *Cmd,
        assigns: []Assign,
        subshell: *Subshell,
        @"if": *If,
        condexpr: *CondExpr,
    };

    pub const CmdOrAssigns = union(CmdOrAssigns.Tag) {
        cmd: Cmd,
        assigns: []Assign,

        pub const Tag = enum { cmd, assigns };

        pub fn to_pipeline_item(this: CmdOrAssigns, alloc: Allocator) PipelineItem {
            switch (this) {
                .cmd => |cmd| {
                    const cmd_ptr = try alloc.create(Cmd);
                    cmd_ptr.* = cmd;
                    return .{ .cmd = cmd_ptr };
                },
                .assigns => |assigns| {
                    return .{ .assign = assigns };
                },
            }
        }

        pub fn to_expr(this: CmdOrAssigns, alloc: Allocator) !Expr {
            switch (this) {
                .cmd => |cmd| {
                    const cmd_ptr = try alloc.create(Cmd);
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

        pub fn new(label: []const u8, value: Atom) Assign {
            return .{
                .label = label,
                .value = value,
            };
        }
    };

    pub const Cmd = struct {
        assigns: []Assign,
        name_and_args: []Atom,
        redirect: RedirectFlags = .{},
        redirect_file: ?Redirect = null,
    };

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
        /// 1>&2 === stdout=true and duplicate_out=true
        /// 2>&1 === stderr=true and duplicate_out=true
        duplicate_out: bool = false,
        __unused: u3 = 0,

        pub inline fn isEmpty(this: RedirectFlags) bool {
            return @as(u8, @bitCast(this)) == 0;
        }

        pub fn redirectsElsewhere(this: RedirectFlags, io_kind: enum { stdin, stdout, stderr }) bool {
            return switch (io_kind) {
                .stdin => this.stdin,
                .stdout => if (this.duplicate_out) !this.stdout else this.stdout,
                .stderr => if (this.duplicate_out) !this.stderr else this.stderr,
            };
        }

        pub fn @"2>&1"() RedirectFlags {
            return .{ .stderr = true, .duplicate = true };
        }

        pub fn @"1>&2"() RedirectFlags {
            return .{ .stdout = true, .duplicate = true };
        }

        pub fn toFlags(this: RedirectFlags) bun.Mode {
            const read_write_flags: bun.Mode = if (this.stdin) bun.O.RDONLY else bun.O.WRONLY | bun.O.CREAT;
            const extra: bun.Mode = if (this.append) bun.O.APPEND else bun.O.TRUNC;
            const final_flags: bun.Mode = if (this.stdin) read_write_flags else extra | read_write_flags;
            return final_flags;
        }

        pub fn @"<"() RedirectFlags {
            return .{ .stdin = true };
        }

        pub fn @"<<"() RedirectFlags {
            return .{ .stdin = true, .append = true };
        }

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
            const anum: u8 = @bitCast(a);
            const bnum: u8 = @bitCast(b);
            return @bitCast(anum | bnum);
        }
    };

    pub const Redirect = union(enum) {
        atom: Atom,
        jsbuf: JSBuf,
    };

    pub const Atom = union(Atom.Tag) {
        simple: SimpleAtom,
        compound: CompoundAtom,

        pub const Tag = enum(u8) { simple, compound };

        pub fn merge(this: Atom, right: Atom, allocator: Allocator) !Atom {
            if (this == .simple and right == .simple) {
                var atoms = try allocator.alloc(SimpleAtom, 2);
                atoms[0] = this.simple;
                atoms[1] = right.simple;
                return .{ .compound = .{
                    .atoms = atoms,
                    .brace_expansion_hint = this.simple == .brace_begin or this.simple == .brace_end or right.simple == .brace_begin or right.simple == .brace_end,
                    .glob_hint = this.simple == .asterisk or this.simple == .double_asterisk or right.simple == .asterisk or right.simple == .double_asterisk,
                } };
            }

            if (this == .compound and right == .compound) {
                var atoms = try allocator.alloc(SimpleAtom, this.compound.atoms.len + right.compound.atoms.len);
                @memcpy(atoms[0..this.compound.atoms.len], this.compound.atoms);
                @memcpy(atoms[this.compound.atoms.len .. this.compound.atoms.len + right.compound.atoms.len], right.compound.atoms);
                return .{ .compound = .{
                    .atoms = atoms,
                    .brace_expansion_hint = this.compound.brace_expansion_hint or right.compound.brace_expansion_hint,
                    .glob_hint = this.compound.glob_hint or right.compound.glob_hint,
                } };
            }

            if (this == .simple) {
                var atoms = try allocator.alloc(SimpleAtom, 1 + right.compound.atoms.len);
                atoms[0] = this.simple;
                @memcpy(atoms[1 .. right.compound.atoms.len + 1], right.compound.atoms);
                return .{ .compound = .{
                    .atoms = atoms,
                    .brace_expansion_hint = this.simple == .brace_begin or this.simple == .brace_end or right.compound.brace_expansion_hint,
                    .glob_hint = this.simple == .asterisk or this.simple == .double_asterisk or right.compound.glob_hint,
                } };
            }

            var atoms = try allocator.alloc(SimpleAtom, 1 + this.compound.atoms.len);
            @memcpy(atoms[0..this.compound.atoms.len], this.compound.atoms);
            atoms[this.compound.atoms.len] = right.simple;
            return .{ .compound = .{
                .atoms = atoms,
                .brace_expansion_hint = right.simple == .brace_begin or right.simple == .brace_end or this.compound.brace_expansion_hint,
                .glob_hint = right.simple == .asterisk or right.simple == .double_asterisk or this.compound.glob_hint,
            } };
        }

        pub fn atomsLen(this: *const Atom) u32 {
            return switch (this.*) {
                .simple => 1,
                .compound => @intCast(this.compound.atoms.len),
            };
        }

        pub fn new_simple(atom: SimpleAtom) Atom {
            return .{ .simple = atom };
        }

        pub fn is_compound(self: *const Atom) bool {
            switch (self.*) {
                .compound => return true,
                .simple => return false,
            }
        }

        pub fn has_expansions(self: *const Atom) bool {
            return self.has_glob_expansion() or self.has_brace_expansion();
        }

        pub fn has_glob_expansion(self: *const Atom) bool {
            return switch (self.*) {
                .simple => self.simple.glob_hint(),
                .compound => self.compound.glob_hint,
            };
        }

        pub fn has_brace_expansion(self: *const Atom) bool {
            return switch (self.*) {
                .simple => false,
                .compound => self.compound.brace_expansion_hint,
            };
        }

        pub fn hasTildeExpansion(self: *const Atom) bool {
            return switch (self.*) {
                .simple => self.simple == .tilde,
                .compound => self.compound.atoms.len > 0 and self.compound.atoms[0] == .tilde,
            };
        }
    };

    pub const SimpleAtom = union(enum) {
        Var: []const u8,
        VarArgv: u8,
        Text: []const u8,
        asterisk,
        double_asterisk,
        brace_begin,
        brace_end,
        comma,
        tilde,
        cmd_subst: struct {
            script: Script,
            quoted: bool = false,
        },

        pub fn glob_hint(this: SimpleAtom) bool {
            return switch (this) {
                .Var => false,
                .VarArgv => false,
                .Text => false,
                .asterisk => true,
                .double_asterisk => true,
                .brace_begin => false,
                .brace_end => false,
                .comma => false,
                .cmd_subst => false,
                .tilde => false,
            };
        }
    };

    pub const CompoundAtom = struct {
        atoms: []SimpleAtom,
        brace_expansion_hint: bool = false,
        glob_hint: bool = false,
    };
};

pub const Parser = struct {
    strpool: []const u8,
    tokens: []const Token,
    alloc: Allocator,
    jsobjs: []JSValue,
    current: u32 = 0,
    errors: std.ArrayList(Error),
    inside_subshell: ?SubshellKind = null,

    const SubshellKind = enum {
        cmd_subst,
        normal,
        pub fn closing_tok(this: SubshellKind) TokenTag {
            return switch (this) {
                .cmd_subst => TokenTag.CmdSubstEnd,
                .normal => TokenTag.CloseParen,
            };
        }
    };

    // FIXME error location
    const Error = struct { msg: []const u8 };

    pub fn new(
        allocator: Allocator,
        lex_result: LexResult,
        jsobjs: []JSValue,
    ) !Parser {
        return .{
            .strpool = lex_result.strpool,
            .tokens = lex_result.tokens,
            .alloc = allocator,
            .jsobjs = jsobjs,
            .errors = std.ArrayList(Error).init(allocator),
        };
    }

    /// __WARNING__:
    /// If you make a subparser and call some fallible functions on it, you need to catch the errors and call `.continue_from_subparser()`, otherwise errors
    /// will not propagate upwards to the parent.
    pub fn make_subparser(this: *Parser, kind: SubshellKind) Parser {
        const subparser = .{
            .strpool = this.strpool,
            .tokens = this.tokens,
            .alloc = this.alloc,
            .jsobjs = this.jsobjs,
            .current = this.current,
            // We replace the old Parser's struct with the updated error list
            // when this subparser is done
            .errors = this.errors,
            .inside_subshell = kind,
        };
        return subparser;
    }

    pub fn continue_from_subparser(this: *Parser, subparser: *Parser) void {
        // this.current = if (this.tokens[subparser.current] == .Eof) subparser.current else subparser;
        this.current =
            if (subparser.current >= this.tokens.len) subparser.current else subparser.current + 1;
        this.errors = subparser.errors;
    }

    /// Main parse function
    ///
    /// Loosely based on the shell gramar documented in the spec: https://pubs.opengroup.org/onlinepubs/009604499/utilities/xcu_chap02.html#tag_02_10
    pub fn parse(self: *Parser) !AST.Script {
        return try self.parse_impl();
    }

    pub fn parse_impl(self: *Parser) !AST.Script {
        var stmts = ArrayList(AST.Stmt).init(self.alloc);
        if (self.tokens.len == 0 or self.tokens.len == 1 and self.tokens[0] == .Eof)
            return .{ .stmts = stmts.items[0..stmts.items.len] };

        while (if (self.inside_subshell == null)
            !self.match(.Eof)
        else
            !self.match_any(&.{ .Eof, self.inside_subshell.?.closing_tok() }))
        {
            self.skip_newlines();
            try stmts.append(try self.parse_stmt());
            self.skip_newlines();
        }
        if (self.inside_subshell) |kind| {
            _ = self.expect_any(&.{ .Eof, kind.closing_tok() });
        } else {
            _ = self.expect(.Eof);
        }
        return .{ .stmts = stmts.items[0..stmts.items.len] };
    }

    pub fn parse_stmt(self: *Parser) !AST.Stmt {
        var exprs = std.ArrayList(AST.Expr).init(self.alloc);

        while (if (self.inside_subshell == null)
            !self.match_any_comptime(&.{ .Semicolon, .Newline, .Eof })
        else
            !self.match_any(&.{ .Semicolon, .Newline, .Eof, self.inside_subshell.?.closing_tok() }))
        {
            const expr = try self.parse_expr();
            if (self.match(.Ampersand)) {
                try self.add_error("Background commands \"&\" are not supported yet.", .{});
                return ParseError.Unsupported;
                // Uncomment when we enable ampersand
                // switch (expr) {
                //     .binary => {
                //         var newexpr = expr;
                //         const right_alloc = try self.allocate(AST.Expr, newexpr.binary.right);
                //         const right: AST.Expr = .{ .@"async" = right_alloc };
                //         newexpr.binary.right = right;
                //         try exprs.append(newexpr);
                //     },
                //     else => {
                //         const @"async" = .{ .@"async" = try self.allocate(AST.Expr, expr) };
                //         try exprs.append(@"async");
                //     },
                // }

                // _ = self.match_any_comptime(&.{ .Semicolon, .Newline });

                // // Scripts like: `echo foo & && echo hi` aren't allowed because
                // // `&&` and `||` require the left-hand side's exit code to be
                // // immediately observable, but the `&` makes it run in the
                // // background.
                // //
                // // So we do a quick check for this kind of syntax here, and
                // // provide a helpful error message to the user.
                // if (self.peek() == .DoubleAmpersand) {
                //     try self.add_error("\"&\" is not allowed on the left-hand side of \"&&\"", .{});
                //     return ParseError.Unsupported;
                // }

                // break;
            }
            try exprs.append(expr);

            // This might be necessary, so leaving it here in case it is
            // switch (self.peek()) {
            //     .Eof, .Newline, .Semicolon => {},
            //     else => |t| {
            //         if (self.inside_subshell == null or self.inside_subshell.?.closing_tok() != t) {
            //             @panic("Oh no!");
            //         }
            //     },
            // }
        }

        return .{
            .exprs = exprs.items[0..],
        };
    }

    fn parse_expr(self: *Parser) !AST.Expr {
        return try self.parse_binary();
    }

    fn parse_binary(self: *Parser) !AST.Expr {
        var left = try self.parse_pipeline();
        while (self.match_any_comptime(&.{ .DoubleAmpersand, .DoublePipe })) {
            const op: AST.Binary.Op = op: {
                const previous = @as(TokenTag, self.prev());
                switch (previous) {
                    .DoubleAmpersand => break :op .And,
                    .DoublePipe => break :op .Or,
                    else => unreachable,
                }
            };

            const right = try self.parse_pipeline();

            const binary = try self.allocate(AST.Binary, .{ .op = op, .left = left, .right = right });
            left = .{ .binary = binary };
        }

        return left;
    }

    fn parse_pipeline(self: *Parser) !AST.Expr {
        var expr = try self.parse_compound_cmd();

        if (self.peek() == .Pipe) {
            var pipeline_items = std.ArrayList(AST.PipelineItem).init(self.alloc);
            try pipeline_items.append(expr.asPipelineItem() orelse {
                try self.add_error_expected_pipeline_item(@as(AST.Expr.Tag, expr));
                return ParseError.Expected;
            });

            while (self.match(.Pipe)) {
                expr = try self.parse_compound_cmd();
                try pipeline_items.append(expr.asPipelineItem() orelse {
                    try self.add_error_expected_pipeline_item(@as(AST.Expr.Tag, expr));
                    return ParseError.Expected;
                });
            }
            const pipeline = try self.allocate(AST.Pipeline, .{ .items = pipeline_items.items[0..] });
            return .{ .pipeline = pipeline };
        }

        return expr;
    }

    fn extractIfClauseTextToken(comptime if_clause_token: @TypeOf(.EnumLiteral)) []const u8 {
        const tagname = comptime switch (if_clause_token) {
            .@"if" => "if",
            .@"else" => "else",
            .elif => "elif",
            .then => "then",
            .fi => "fi",
            else => @compileError("Invalid " ++ @tagName(if_clause_token)),
        };
        return tagname;
    }

    fn expectIfClauseTextToken(self: *Parser, comptime if_clause_token: @TypeOf(.EnumLiteral)) Token {
        const tagname = comptime extractIfClauseTextToken(if_clause_token);
        if (bun.Environment.allow_assert) assert(@as(TokenTag, self.peek()) == .Text);
        if (self.peek() == .Text and
            self.delimits(self.peek_n(1)) and
            std.mem.eql(u8, self.text(self.peek().Text), tagname))
        {
            const tok = self.advance();
            _ = self.expect_delimit();
            return tok;
        }
        @panic("Expected: " ++ @tagName(if_clause_token));
    }

    fn isIfClauseTextToken(self: *Parser, comptime if_clause_token: @TypeOf(.EnumLiteral)) bool {
        return switch (self.peek()) {
            .Text => |range| self.isIfClauseTextTokenImpl(range, if_clause_token),
            else => false,
        };
    }

    fn isIfClauseTextTokenImpl(self: *Parser, range: Token.TextRange, comptime if_clause_token: @TypeOf(.EnumLiteral)) bool {
        const tagname = comptime extractIfClauseTextToken(if_clause_token);
        return bun.strings.eqlComptime(self.text(range), tagname);
    }

    fn skip_newlines(self: *Parser) void {
        while (self.match(.Newline)) {}
    }

    fn parse_compound_cmd(self: *Parser) anyerror!AST.Expr {
        // Placeholder for when we fully support subshells
        if (self.peek() == .OpenParen) {
            const subshell = try self.parse_subshell();
            if (!subshell.redirect_flags.isEmpty()) {
                try self.add_error("Subshells with redirections are currently not supported. Please open a GitHub issue.", .{});
                return ParseError.Unsupported;
            }

            return .{
                .subshell = try self.allocate(AST.Subshell, subshell),
            };
        }

        if (self.isIfClauseTextToken(.@"if")) return (try self.parse_if_clause()).to_expr(self.alloc);

        switch (self.peek()) {
            .DoubleBracketOpen => return (try self.parse_cond_expr()).to_expr(self.alloc),
            else => {},
        }

        return (try self.parse_simple_cmd()).to_expr(self.alloc);
    }

    fn parse_subshell(self: *Parser) !AST.Subshell {
        _ = self.expect(.OpenParen);
        var subparser = self.make_subparser(.normal);
        const script = subparser.parse_impl() catch |e| {
            self.continue_from_subparser(&subparser);
            return e;
        };
        self.continue_from_subparser(&subparser);
        const parsed_redirect = try self.parse_redirect();

        return .{
            .script = script,
            .redirect = parsed_redirect.redirect,
            .redirect_flags = parsed_redirect.flags,
        };
    }

    fn parse_cond_expr(self: *Parser) !AST.CondExpr {
        _ = self.expect(.DoubleBracketOpen);

        // Quick check to see if it's a single operand operator
        // Operators are not allowed to be expanded (i.e. `FOO=-f; [[ $FOO package.json ]]` won't work)
        // So it must be a .Text token
        // Also, all single operand operators start with "-", so check it starts with "-".
        switch (self.peek()) {
            .Text => |range| {
                const txt = self.text(range);

                if (txt[0] == '-') {
                    // Is a potential single arg op
                    inline for (AST.CondExpr.Op.SINGLE_ARG_OPS) |single_arg_op| {
                        if (bun.strings.eqlComptime(txt, single_arg_op.name)) {
                            const is_supported = comptime AST.CondExpr.Op.isSupported(@enumFromInt(single_arg_op.value));
                            if (!is_supported) {
                                try self.add_error("Conditional expression operation: {s}, is not supported right now. Please open a GitHub issue if you would like it to be supported.", .{single_arg_op.name});
                                return ParseError.Unsupported;
                            }

                            _ = self.expect(.Text);
                            if (!self.match(.Delimit)) {
                                try self.add_error("Expected a single, simple word", .{});
                                return ParseError.Expected;
                            }

                            const arg = try self.parse_atom() orelse {
                                try self.add_error("Expected a word, but got: {s}", .{self.peek().asHumanReadable(self.strpool)});
                                return ParseError.Expected;
                            };

                            if (!self.match(.DoubleBracketClose)) {
                                try self.add_error("Expected \"]]\" but got: {s}", .{self.peek().asHumanReadable(self.strpool)});
                                return ParseError.Expected;
                            }

                            return .{
                                .op = @enumFromInt(single_arg_op.value),
                                .args = AST.CondExpr.ArgList.initWith(arg),
                            };
                        }
                    }

                    try self.add_error("Unknown conditional expression operation: {s}", .{txt});
                    return ParseError.Unknown;
                }
            },
            else => {},
        }

        // Otherwise check binary operators like:
        //     arg1 -eq arg2
        // Again the token associated with the operator (in this case `-eq`) *must* be a .Text token.

        const arg1 = try self.parse_atom() orelse {
            try self.add_error("Expected a conditional expression operand, but got: {s}", .{self.peek().asHumanReadable(self.strpool)});
            return ParseError.Expected;
        };

        // Operator must be a regular text token
        if (self.peek() != .Text) {
            try self.add_error("Expected a conditional expression operator, but got: {s}", .{self.peek().asHumanReadable(self.strpool)});
            return ParseError.Expected;
        }

        const op = self.expect(.Text);
        if (!self.match(.Delimit)) {
            try self.add_error("Expected a single, simple word", .{});
            return ParseError.Expected;
        }
        const txt = self.text(op.Text);

        inline for (AST.CondExpr.Op.BINARY_OPS) |binary_op| {
            if (bun.strings.eqlComptime(txt, binary_op.name)) {
                const is_supported = comptime AST.CondExpr.Op.isSupported(@enumFromInt(binary_op.value));
                if (!is_supported) {
                    try self.add_error("Conditional expression operation: {s}, is not supported right now. Please open a GitHub issue if you would like it to be supported.", .{binary_op.name});
                    return ParseError.Unsupported;
                }

                const arg2 = try self.parse_atom() orelse {
                    try self.add_error("Expected a word, but got: {s}", .{self.peek().asHumanReadable(self.strpool)});
                    return ParseError.Expected;
                };

                if (!self.match(.DoubleBracketClose)) {
                    try self.add_error("Expected \"]]\" but got: {s}", .{self.peek().asHumanReadable(self.strpool)});
                    return ParseError.Expected;
                }

                return .{
                    .op = @enumFromInt(binary_op.value),
                    .args = AST.CondExpr.ArgList.initWithSlice(&.{ arg1, arg2 }),
                };
            }
        }

        try self.add_error("Unknown conditional expression operation: {s}", .{txt});
        return ParseError.Unknown;
    }

    /// We make it so that `if`/`else`/`elif`/`then`/`fi` need to be single,
    /// simple .Text tokens (so the whitespace logic remains the same).
    /// This is used to convert them
    const IfClauseTok = enum {
        @"if",
        @"else",
        elif,
        then,
        fi,

        pub fn fromTok(p: *Parser, tok: Token) ?IfClauseTok {
            return switch (tok) {
                .Text => fromText(p.text(tok.Text)),
                else => null,
            };
        }

        pub fn fromText(txt: []const u8) ?IfClauseTok {
            if (bun.strings.eqlComptime(txt, "if")) return .@"if";
            if (bun.strings.eqlComptime(txt, "else")) return .@"else";
            if (bun.strings.eqlComptime(txt, "elif")) return .elif;
            if (bun.strings.eqlComptime(txt, "then")) return .then;
            if (bun.strings.eqlComptime(txt, "fi")) return .fi;

            return null;
        }
    };

    fn parse_if_body(self: *Parser, comptime until: []const IfClauseTok) !SmolList(AST.Stmt, 1) {
        var ret: SmolList(AST.Stmt, 1) = SmolList(AST.Stmt, 1).zeroes;
        while (if (self.inside_subshell == null)
            !self.peek_any_comptime_ifclausetok(until) and !self.peek_any_comptime(&.{.Eof})
        else
            !self.peek_any_ifclausetok(until) and !self.peek_any(&.{ self.inside_subshell.?.closing_tok(), .Eof }))
        {
            self.skip_newlines();
            const stmt = try self.parse_stmt();
            ret.append(stmt);
            self.skip_newlines();
        }

        return ret;
    }

    fn parse_if_clause(self: *Parser) !AST.If {
        _ = self.expectIfClauseTextToken(.@"if");
        // _ = self.expect(.If);

        const cond = try self.parse_if_body(&.{.then});

        if (!self.match_if_clausetok(.then)) {
            try self.add_error("Expected \"then\" but got: {s}", .{@tagName(self.peek())});
            return ParseError.Expected;
        }

        const then = try self.parse_if_body(&.{ .@"else", .elif, .fi });

        var else_parts: SmolList(SmolList(AST.Stmt, 1), 1) = SmolList(SmolList(AST.Stmt, 1), 1).zeroes;

        const if_clause_tok = IfClauseTok.fromTok(self, self.peek()) orelse {
            try self.add_error("Expected \"else\", \"elif\", or \"fi\" but got: {s}", .{@tagName(self.peek())});
            return ParseError.Expected;
        };

        switch (if_clause_tok) {
            .@"if", .then => {
                try self.add_error("Expected \"else\", \"elif\", or \"fi\" but got: {s}", .{@tagName(self.peek())});
                return ParseError.Expected;
            },
            .@"else" => {
                _ = self.expectIfClauseTextToken(.@"else");
                const @"else" = try self.parse_if_body(&.{.fi});
                if (!self.match_if_clausetok(.fi)) {
                    try self.add_error("Expected \"fi\" but got: {s}", .{@tagName(self.peek())});
                    return ParseError.Expected;
                }
                else_parts.append(@"else");
                return .{
                    .cond = cond,
                    .then = then,
                    .else_parts = else_parts,
                };
            },
            .elif => {
                while (true) {
                    _ = self.expectIfClauseTextToken(.elif);
                    const elif_cond = try self.parse_if_body(&.{.then});
                    if (!self.match_if_clausetok(.then)) {
                        try self.add_error("Expected \"then\" but got: {s}", .{@tagName(self.peek())});
                        return ParseError.Expected;
                    }
                    const then_part = try self.parse_if_body(&.{ .elif, .@"else", .fi });
                    else_parts.append(elif_cond);
                    else_parts.append(then_part);

                    switch (IfClauseTok.fromTok(self, self.peek()) orelse {
                        break;
                    }) {
                        .elif => continue,
                        .@"else" => {
                            _ = self.expectIfClauseTextToken(.@"else");
                            const else_part = try self.parse_if_body(&.{.fi});
                            else_parts.append(else_part);
                            break;
                        },
                        else => break,
                    }
                }
                if (!self.match_if_clausetok(.fi)) {
                    try self.add_error("Expected \"fi\" but got: {s}", .{@tagName(self.peek())});
                    return ParseError.Expected;
                }
                return .{
                    .cond = cond,
                    .then = then,
                    .else_parts = else_parts,
                };
            },
            .fi => {
                _ = self.expectIfClauseTextToken(.fi);
                return .{
                    .cond = cond,
                    .then = then,
                };
            },
        }
    }

    fn parse_simple_cmd(self: *Parser) !AST.CmdOrAssigns {
        var assigns = std.ArrayList(AST.Assign).init(self.alloc);
        while (if (self.inside_subshell == null)
            !self.check_any_comptime(&.{ .Semicolon, .Newline, .Eof })
        else
            !self.check_any(&.{ .Semicolon, .Newline, .Eof, self.inside_subshell.?.closing_tok() }))
        {
            if (try self.parse_assign()) |assign| {
                try assigns.append(assign);
            } else {
                break;
            }
        }

        if (if (self.inside_subshell == null)
            self.check_any_comptime(&.{ .Semicolon, .Newline, .Eof })
        else
            self.check_any(&.{ .Semicolon, .Newline, .Eof, self.inside_subshell.?.closing_tok() }))
        {
            if (assigns.items.len == 0) {
                try self.add_error("expected a command or assignment", .{});
                return ParseError.Expected;
            }
            return .{ .assigns = assigns.items[0..] };
        }

        const name = try self.parse_atom() orelse {
            if (assigns.items.len == 0) {
                try self.add_error("expected a command or assignment but got: \"{s}\"", .{@tagName(self.peek())});
                return ParseError.Expected;
            }
            return .{ .assigns = assigns.items[0..] };
        };

        var name_and_args = std.ArrayList(AST.Atom).init(self.alloc);
        try name_and_args.append(name);
        while (try self.parse_atom()) |arg| {
            try name_and_args.append(arg);
        }
        const parsed_redirect = try self.parse_redirect();

        return .{ .cmd = .{
            .assigns = assigns.items[0..],
            .name_and_args = name_and_args.items[0..],
            .redirect_file = parsed_redirect.redirect,
            .redirect = parsed_redirect.flags,
        } };
    }

    fn parse_redirect(self: *Parser) !ParsedRedirect {
        const has_redirect = self.match(.Redirect);
        const redirect = if (has_redirect) self.prev().Redirect else AST.RedirectFlags{};
        const redirect_file: ?AST.Redirect = redirect_file: {
            if (has_redirect) {
                if (self.match(.JSObjRef)) {
                    const obj_ref = self.prev().JSObjRef;
                    break :redirect_file .{ .jsbuf = AST.JSBuf.new(obj_ref) };
                }

                const redirect_file = try self.parse_atom() orelse {
                    if (redirect.duplicate_out) break :redirect_file null;
                    try self.add_error("Redirection with no file", .{});
                    return ParseError.Expected;
                };
                break :redirect_file .{ .atom = redirect_file };
            }
            break :redirect_file null;
        };
        // TODO check for multiple redirects and error
        return .{ .flags = redirect, .redirect = redirect_file };
    }

    const ParsedRedirect = struct {
        flags: AST.RedirectFlags = .{},
        redirect: ?AST.Redirect = null,
    };

    /// Try to parse an assignment. If no assignment could be parsed then return
    /// null and backtrack the parser state
    fn parse_assign(self: *Parser) !?AST.Assign {
        const old = self.current;
        _ = old;
        switch (self.peek()) {
            .Text => |txtrng| {
                const start_idx = self.current;
                _ = self.expect(.Text);
                const txt = self.text(txtrng);
                const var_decl: ?AST.Assign = var_decl: {
                    if (hasEqSign(txt)) |eq_idx| {
                        // If it starts with = then it's not valid assignment (e.g. `=FOO`)
                        if (eq_idx == 0) break :var_decl null;
                        const label = txt[0..eq_idx];
                        if (!isValidVarName(label)) {
                            break :var_decl null;
                        }

                        if (eq_idx == txt.len - 1) {
                            if (self.delimits(self.peek())) {
                                _ = self.expect_delimit();
                                break :var_decl .{
                                    .label = label,
                                    .value = .{ .simple = .{ .Text = "" } },
                                };
                            }
                            const atom = try self.parse_atom() orelse {
                                try self.add_error("Expected an atom", .{});
                                return ParseError.Expected;
                            };
                            break :var_decl .{
                                .label = label,
                                .value = atom,
                            };
                        }

                        const txt_value = txt[eq_idx + 1 .. txt.len];
                        if (self.delimits(self.peek())) {
                            _ = self.expect_delimit();
                            break :var_decl .{
                                .label = label,
                                .value = .{ .simple = .{ .Text = txt_value } },
                            };
                        }

                        const right = try self.parse_atom() orelse {
                            try self.add_error("Expected an atom", .{});
                            return ParseError.Expected;
                        };
                        const left: AST.Atom = .{
                            .simple = .{ .Text = txt_value },
                        };
                        const merged = try AST.Atom.merge(left, right, self.alloc);
                        break :var_decl .{
                            .label = label,
                            .value = merged,
                        };
                    }
                    break :var_decl null;
                };

                if (var_decl) |vd| {
                    return vd;
                }

                // Rollback
                self.current = start_idx;
                return null;
            },
            else => return null,
        }
    }

    fn parse_atom(self: *Parser) !?AST.Atom {
        var array_alloc = std.heap.stackFallback(@sizeOf(AST.SimpleAtom), self.alloc);
        var atoms = try std.ArrayList(AST.SimpleAtom).initCapacity(array_alloc.get(), 1);
        var has_brace_open = false;
        var has_brace_close = false;
        var has_comma = false;
        var has_glob_syntax = false;
        {
            while (switch (self.peek()) {
                .Delimit => brk: {
                    _ = self.expect(.Delimit);
                    break :brk false;
                },
                .Eof, .Semicolon, .Newline => false,
                else => |t| brk: {
                    if (self.inside_subshell != null and self.inside_subshell.?.closing_tok() == t) break :brk false;
                    break :brk true;
                },
            }) {
                const next = self.peek_n(1);
                const next_delimits = self.delimits(next);
                const peeked = self.peek();
                const should_break = next_delimits;
                switch (peeked) {
                    .Asterisk => {
                        has_glob_syntax = true;
                        _ = self.expect(.Asterisk);
                        try atoms.append(.asterisk);
                        if (next_delimits) {
                            _ = self.match(.Delimit);
                            break;
                        }
                    },
                    .DoubleAsterisk => {
                        has_glob_syntax = true;
                        _ = self.expect(.DoubleAsterisk);
                        try atoms.append(.double_asterisk);
                        if (next_delimits) {
                            _ = self.match(.Delimit);
                            break;
                        }
                    },
                    .BraceBegin => {
                        has_brace_open = true;
                        _ = self.expect(.BraceBegin);
                        try atoms.append(.brace_begin);
                        // TODO in this case we know it can't possibly be the beginning of a brace expansion so maybe its faster to just change it to text here
                        if (next_delimits) {
                            _ = self.match(.Delimit);
                            if (should_break) break;
                        }
                    },
                    .BraceEnd => {
                        has_brace_close = true;
                        _ = self.expect(.BraceEnd);
                        try atoms.append(.brace_end);
                        if (next_delimits) {
                            _ = self.match(.Delimit);
                            break;
                        }
                    },
                    .Comma => {
                        has_comma = true;
                        _ = self.expect(.Comma);
                        try atoms.append(.comma);
                        if (next_delimits) {
                            _ = self.match(.Delimit);
                            if (should_break) break;
                        }
                    },
                    .CmdSubstBegin => {
                        _ = self.expect(.CmdSubstBegin);
                        const is_quoted = self.match(.CmdSubstQuoted);
                        var subparser = self.make_subparser(.cmd_subst);
                        const script = subparser.parse_impl() catch |e| {
                            self.continue_from_subparser(&subparser);
                            return e;
                        };
                        try atoms.append(.{ .cmd_subst = .{
                            .script = script,
                            .quoted = is_quoted,
                        } });
                        self.continue_from_subparser(&subparser);
                        if (self.delimits(self.peek())) {
                            _ = self.match(.Delimit);
                            break;
                        }
                    },
                    .SingleQuotedText, .DoubleQuotedText, .Text => |txtrng| {
                        _ = self.advance();
                        var txt = self.text(txtrng);
                        if (peeked == .Text and txt.len > 0 and txt[0] == '~') {
                            txt = txt[1..];
                            try atoms.append(.tilde);
                            if (txt.len > 0) {
                                try atoms.append(.{ .Text = txt });
                            }
                        } else {
                            try atoms.append(.{ .Text = txt });
                        }
                        if (next_delimits) {
                            _ = self.match(.Delimit);
                            if (should_break) break;
                        }
                    },
                    .Var => |txtrng| {
                        _ = self.expect(.Var);
                        const txt = self.text(txtrng);
                        try atoms.append(.{ .Var = txt });
                        if (next_delimits) {
                            _ = self.match(.Delimit);
                            if (should_break) break;
                        }
                    },
                    .VarArgv => |int| {
                        _ = self.expect(.VarArgv);
                        try atoms.append(.{ .VarArgv = int });
                        if (next_delimits) {
                            _ = self.match(.Delimit);
                            if (should_break) break;
                        }
                    },
                    .OpenParen, .CloseParen => {
                        try self.add_error("Unexpected token: `{s}`", .{if (peeked == .OpenParen) "(" else ")"});
                        return ParseError.Unexpected;
                    },
                    .Pipe => return null,
                    .DoublePipe => return null,
                    .Ampersand => return null,
                    .DoubleAmpersand => return null,
                    .Redirect => return null,
                    .Dollar => return null,
                    .Eq => return null,
                    .Semicolon => return null,
                    .Newline => return null,
                    .CmdSubstQuoted => return null,
                    .CmdSubstEnd => return null,
                    .JSObjRef => return null,
                    .Delimit => return null,
                    .Eof => return null,
                    .DoubleBracketOpen => return null,
                    .DoubleBracketClose => return null,
                }
            }
        }

        return switch (atoms.items.len) {
            0 => null,
            1 => {
                if (bun.Environment.allow_assert) assert(atoms.capacity == 1);
                return AST.Atom.new_simple(atoms.items[0]);
            },
            else => .{ .compound = .{
                .atoms = atoms.items[0..atoms.items.len],
                .brace_expansion_hint = has_brace_open and has_brace_close and has_comma,
                .glob_hint = has_glob_syntax,
            } },
        };
    }

    fn allocate(self: *const Parser, comptime T: type, val: T) !*T {
        const heap = try self.alloc.create(T);
        heap.* = val;
        return heap;
    }

    fn text(self: *const Parser, range: Token.TextRange) []const u8 {
        return self.strpool[range.start..range.end];
    }

    fn advance(self: *Parser) Token {
        if (!self.is_at_end()) {
            self.current += 1;
        }
        return self.prev();
    }

    fn is_at_end(self: *Parser) bool {
        return self.peek() == .Eof or self.inside_subshell != null and self.inside_subshell.?.closing_tok() == self.peek();
    }

    fn expect(self: *Parser, toktag: TokenTag) Token {
        if (bun.Environment.allow_assert) assert(toktag == @as(TokenTag, self.peek()));
        if (self.check(toktag)) {
            return self.advance();
        }
        @panic("Unexpected token");
    }

    fn expect_any(self: *Parser, toktags: []const TokenTag) Token {
        const peeked = self.peek();
        for (toktags) |toktag| {
            if (toktag == @as(TokenTag, peeked)) return self.advance();
        }

        @panic("Unexpected token");
    }

    fn delimits(self: *Parser, tok: Token) bool {
        return tok == .Delimit or tok == .Semicolon or tok == .Semicolon or tok == .Eof or tok == .Newline or (self.inside_subshell != null and tok == self.inside_subshell.?.closing_tok());
    }

    fn expect_delimit(self: *Parser) Token {
        if (bun.Environment.allow_assert) assert(self.delimits(self.peek()));
        if (self.check(.Delimit) or self.check(.Semicolon) or self.check(.Newline) or self.check(.Eof) or (self.inside_subshell != null and self.check(self.inside_subshell.?.closing_tok()))) {
            return self.advance();
        }
        @panic("Expected a delimiter token");
    }

    fn match_if_clausetok(self: *Parser, toktag: IfClauseTok) bool {
        if (self.peek() == .Text and
            self.delimits(self.peek_n(1)) and
            bun.strings.eql(self.text(self.peek().Text), @tagName(toktag)))
        {
            _ = self.advance();
            _ = self.expect_delimit();
            return true;
        }
        return false;
    }

    /// Consumes token if it matches
    fn match(self: *Parser, toktag: TokenTag) bool {
        if (@as(TokenTag, self.peek()) == toktag) {
            _ = self.advance();
            return true;
        }
        return false;
    }

    fn match_any_comptime(self: *Parser, comptime toktags: []const TokenTag) bool {
        const peeked = @as(TokenTag, self.peek());
        inline for (toktags) |tag| {
            if (peeked == tag) {
                _ = self.advance();
                return true;
            }
        }
        return false;
    }

    fn match_any(self: *Parser, toktags: []const TokenTag) bool {
        const peeked = @as(TokenTag, self.peek());
        for (toktags) |tag| {
            if (peeked == tag) {
                _ = self.advance();
                return true;
            }
        }
        return false;
    }

    fn peek_any_ifclausetok(self: *Parser, toktags: []const IfClauseTok) bool {
        const peektok = self.peek();
        const peeked = @as(TokenTag, peektok);
        if (peeked != .Text) return false;

        const txt = self.text(peektok.Text);
        for (toktags) |tag| {
            if (bun.strings.eql(txt, @tagName(tag))) {
                return true;
            }
        }
        return false;
    }

    fn peek_any_comptime_ifclausetok(self: *Parser, comptime toktags: []const IfClauseTok) bool {
        const peektok = self.peek();
        const peeked = @as(TokenTag, peektok);
        if (peeked != .Text) return false;

        const txt = self.text(peektok.Text);
        inline for (toktags) |tag| {
            if (bun.strings.eqlComptime(txt, @tagName(tag))) {
                return true;
            }
        }
        return false;
    }

    fn peek_any_comptime(self: *Parser, comptime toktags: []const TokenTag) bool {
        const peeked = @as(TokenTag, self.peek());
        inline for (toktags) |tag| {
            if (peeked == tag) {
                return true;
            }
        }
        return false;
    }

    fn peek_any(self: *Parser, toktags: []const TokenTag) bool {
        const peeked = @as(TokenTag, self.peek());
        for (toktags) |tag| {
            if (peeked == tag) {
                return true;
            }
        }
        return false;
    }

    fn check_any_comptime(self: *Parser, comptime toktags: []const TokenTag) bool {
        const peeked = @as(TokenTag, self.peek());
        inline for (toktags) |tag| {
            if (peeked == tag) {
                return true;
            }
        }
        return false;
    }

    fn check_any(self: *Parser, toktags: []const TokenTag) bool {
        const peeked = @as(TokenTag, self.peek());
        for (toktags) |tag| {
            if (peeked == tag) {
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

    pub fn combineErrors(self: *Parser) []const u8 {
        const errors = self.errors.items[0..];
        const str = str: {
            const size = size: {
                var i: usize = 0;
                for (errors) |e| {
                    i += e.msg.len;
                }
                break :size i;
            };
            var buf = self.alloc.alloc(u8, size) catch bun.outOfMemory();
            var i: usize = 0;
            for (errors) |e| {
                @memcpy(buf[i .. i + e.msg.len], e.msg);
                i += e.msg.len;
            }
            break :str buf;
        };
        return str;
    }

    fn add_error(self: *Parser, comptime fmt: []const u8, args: anytype) !void {
        const error_msg = try std.fmt.allocPrint(self.alloc, fmt, args);
        try self.errors.append(.{ .msg = error_msg });
    }

    fn add_error_expected_pipeline_item(self: *Parser, kind: AST.Expr.Tag) !void {
        const error_msg = try std.fmt.allocPrint(self.alloc, "Expected a command, assignment, or subshell but got: {s}", .{@tagName(kind)});
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
    DoubleAsterisk,
    Eq,
    Semicolon,
    Newline,
    // Comment,
    BraceBegin,
    Comma,
    BraceEnd,
    CmdSubstBegin,
    CmdSubstQuoted,
    CmdSubstEnd,
    OpenParen,
    CloseParen,
    Var,
    VarArgv,
    Text,
    SingleQuotedText,
    DoubleQuotedText,
    JSObjRef,
    DoubleBracketOpen,
    DoubleBracketClose,
    Delimit,
    Eof,
};

pub const Token = union(TokenTag) {
    /// |
    Pipe,
    /// ||
    DoublePipe,
    /// &
    Ampersand,
    /// &&
    DoubleAmpersand,

    Redirect: AST.RedirectFlags,

    /// $
    Dollar,
    // `*`
    Asterisk,
    DoubleAsterisk,

    /// =
    Eq,
    /// ;
    Semicolon,
    /// \n (unescaped newline)
    Newline,

    BraceBegin,
    Comma,
    BraceEnd,
    CmdSubstBegin,
    /// When cmd subst is wrapped in quotes, then it should be interpreted as literal string, not word split-ed arguments to a cmd.
    /// We lose quotation context in the AST, so we don't know how to disambiguate that.
    /// So this is a quick hack to give the AST that context.
    ///
    /// This matches this shell behaviour:
    /// echo test$(echo "1    2") -> test1 2\n
    /// echo "test$(echo "1    2")" -> test1    2\n
    CmdSubstQuoted,
    CmdSubstEnd,
    OpenParen,
    CloseParen,

    Var: TextRange,
    VarArgv: u8,
    Text: TextRange,
    /// Quotation information is lost from the lexer -> parser stage and it is
    /// helpful to disambiguate from regular text and quoted text
    SingleQuotedText: TextRange,
    DoubleQuotedText: TextRange,
    JSObjRef: u32,

    DoubleBracketOpen,
    DoubleBracketClose,

    Delimit,
    Eof,

    pub const TextRange = struct {
        start: u32,
        end: u32,

        pub fn len(range: TextRange) u32 {
            if (bun.Environment.allow_assert) assert(range.start <= range.end);
            return range.end - range.start;
        }
    };

    pub fn asHumanReadable(self: Token, strpool: []const u8) []const u8 {
        const varargv_strings = blk: {
            var res: [10][2]u8 = undefined;
            for (&res, 0..) |*item, i| {
                item[0] = '$';
                item[1] = @as(u8, @intCast(i)) + '0';
            }
            break :blk res;
        };
        return switch (self) {
            .Pipe => "`|`",
            .DoublePipe => "`||`",
            .Ampersand => "`&`",
            .DoubleAmpersand => "`&&`",
            .Redirect => "`>`",
            .Dollar => "`$`",
            .Asterisk => "`*`",
            .DoubleAsterisk => "`**`",
            .Eq => "`+`",
            .Semicolon => "`;`",
            .Newline => "`\\n`",
            // Comment,
            .BraceBegin => "`{`",
            .Comma => "`,`",
            .BraceEnd => "`}`",
            .CmdSubstBegin => "`$(`",
            .CmdSubstQuoted => "CmdSubstQuoted",
            .CmdSubstEnd => "`)`",
            .OpenParen => "`(`",
            .CloseParen => "`)",
            .Var => strpool[self.Var.start..self.Var.end],
            .VarArgv => &varargv_strings[self.VarArgv],
            .Text => strpool[self.Text.start..self.Text.end],
            .SingleQuotedText => strpool[self.SingleQuotedText.start..self.SingleQuotedText.end],
            .DoubleQuotedText => strpool[self.DoubleQuotedText.start..self.DoubleQuotedText.end],
            .JSObjRef => "JSObjRef",
            .DoubleBracketOpen => "[[",
            .DoubleBracketClose => "]]",
            .Delimit => "Delimit",
            .Eof => "EOF",
        };
    }
};

pub const LexerAscii = NewLexer(.ascii);
pub const LexerUnicode = NewLexer(.wtf8);
pub const LexResult = struct {
    errors: []LexError,
    tokens: []const Token,
    strpool: []const u8,

    pub fn combineErrors(this: *const LexResult, arena: Allocator) []const u8 {
        const errors = this.errors;
        const str = str: {
            const size = size: {
                var i: usize = 0;
                for (errors) |e| {
                    i += e.msg.len;
                }
                break :size i;
            };
            var buf = arena.alloc(u8, size) catch bun.outOfMemory();
            var i: usize = 0;
            for (errors) |e| {
                @memcpy(buf[i .. i + e.msg.len], e.msg);
                i += e.msg.len;
            }
            break :str buf;
        };
        return str;
    }
};
pub const LexError = struct {
    /// Allocated with lexer arena
    msg: []const u8,
};

/// A special char used to denote the beginning of a special token
/// used for substituting JS variables into the script string.
///
/// \b (decimal value of 8) is deliberately chosen so that it is not
/// easy for the user to accidentally use this char in their script.
///
const SPECIAL_JS_CHAR = 8;
pub const LEX_JS_OBJREF_PREFIX = &[_]u8{SPECIAL_JS_CHAR} ++ "__bun_";
pub const LEX_JS_STRING_PREFIX = &[_]u8{SPECIAL_JS_CHAR} ++ "__bunstr_";

pub fn NewLexer(comptime encoding: StringEncoding) type {
    const Chars = ShellCharIter(encoding);
    return struct {
        chars: Chars,

        /// Tell us the beginning of a "word", indexes into the string pool (`buf`)
        /// Anytime a word is added, this needs to be updated
        word_start: u32 = 0,

        /// Keeps track of the end of a "word", indexes into the string pool (`buf`),
        /// anytime characters are added to the string pool this needs to be updated
        j: u32 = 0,

        strpool: ArrayList(u8),
        tokens: ArrayList(Token),
        delimit_quote: bool = false,
        in_subshell: ?SubShellKind = null,
        errors: std.ArrayList(LexError),

        /// Contains a list of strings we need to escape
        /// Not owned by this struct
        string_refs: []bun.String,

        const SubShellKind = enum {
            /// (echo hi; echo hello)
            normal,
            /// `echo hi; echo hello`
            backtick,
            /// $(echo hi; echo hello)
            dollar,
        };

        const LexerError = error{
            OutOfMemory,
            Utf8CannotEncodeSurrogateHalf,
            Utf8InvalidStartByte,
            CodepointTooLarge,
        };

        pub const js_objref_prefix = "$__bun_";

        const State = Chars.State;

        const InputChar = Chars.InputChar;

        const BacktrackSnapshot = struct {
            chars: Chars,
            j: u32,
            word_start: u32,
            delimit_quote: bool,
        };

        pub fn new(alloc: Allocator, src: []const u8, strings_to_escape: []bun.String) @This() {
            return .{
                .chars = Chars.init(src),
                .tokens = ArrayList(Token).init(alloc),
                .strpool = ArrayList(u8).init(alloc),
                .errors = ArrayList(LexError).init(alloc),
                .string_refs = strings_to_escape,
            };
        }

        pub fn get_result(self: @This()) LexResult {
            return .{
                .tokens = self.tokens.items[0..],
                .strpool = self.strpool.items[0..],
                .errors = self.errors.items[0..],
            };
        }

        pub fn add_error(self: *@This(), msg: []const u8) void {
            const start = self.strpool.items.len;
            self.strpool.appendSlice(msg) catch bun.outOfMemory();
            const end = self.strpool.items.len;
            self.errors.append(.{ .msg = self.strpool.items[start..end] }) catch bun.outOfMemory();
        }

        fn make_sublexer(self: *@This(), kind: SubShellKind) @This() {
            log("[lex] make sublexer", .{});
            var sublexer = .{
                .chars = self.chars,
                .strpool = self.strpool,
                .tokens = self.tokens,
                .errors = self.errors,
                .in_subshell = kind,

                .word_start = self.word_start,
                .j = self.j,
                .string_refs = self.string_refs,
            };
            sublexer.chars.state = .Normal;
            return sublexer;
        }

        fn continue_from_sublexer(self: *@This(), sublexer: *@This()) void {
            log("[lex] drop sublexer", .{});
            self.strpool = sublexer.strpool;
            self.tokens = sublexer.tokens;
            self.errors = sublexer.errors;

            self.chars = sublexer.chars;
            self.word_start = sublexer.word_start;
            self.j = sublexer.j;
            self.delimit_quote = sublexer.delimit_quote;
        }

        fn make_snapshot(self: *@This()) BacktrackSnapshot {
            return .{
                .chars = self.chars,
                .j = self.j,
                .word_start = self.word_start,
                .delimit_quote = self.delimit_quote,
            };
        }

        fn backtrack(self: *@This(), snap: BacktrackSnapshot) void {
            self.chars = snap.chars;
            self.j = snap.j;
            self.word_start = snap.word_start;
            self.delimit_quote = snap.delimit_quote;
        }

        fn last_tok_tag(self: *@This()) ?TokenTag {
            if (self.tokens.items.len == 0) return null;
            return @as(TokenTag, self.tokens.items[self.tokens.items.len - 1]);
        }

        pub fn lex(self: *@This()) LexerError!void {
            while (true) {
                const input = self.eat() orelse {
                    try self.break_word(true);
                    break;
                };
                const char = input.char;
                const escaped = input.escaped;

                // Special token to denote substituted JS variables
                // we use 8 or \b which is a non printable char
                if (char == SPECIAL_JS_CHAR) {
                    if (self.looksLikeJSStringRef()) {
                        if (self.eatJSStringRef()) |bunstr| {
                            try self.break_word(false);
                            try self.handleJSStringRef(bunstr);
                            continue;
                        }
                    } else if (self.looksLikeJSObjRef()) {
                        if (self.eatJSObjRef()) |tok| {
                            if (self.chars.state == .Double) {
                                self.add_error("JS object reference not allowed in double quotes");
                                return;
                            }
                            try self.break_word(false);
                            try self.tokens.append(tok);
                            continue;
                        }
                    }
                }
                // Handle non-escaped chars:
                // 1. special syntax (operators, etc.)
                // 2. lexing state switchers (quotes)
                // 3. word breakers (spaces, etc.)
                else if (!escaped) escaped: {
                    switch (char) {
                        // possibly double bracket open
                        '[' => {
                            comptime assertSpecialChar('[');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            if (self.peek()) |p| {
                                if (p.escaped or p.char != '[') break :escaped;
                                const state = self.make_snapshot();
                                _ = self.eat();
                                do_backtrack: {
                                    const p2 = self.peek() orelse {
                                        try self.break_word(true);
                                        try self.tokens.append(.DoubleBracketClose);
                                        continue;
                                    };
                                    if (p2.escaped) break :do_backtrack;
                                    switch (p2.char) {
                                        ' ', '\r', '\n', '\t' => {
                                            try self.break_word(true);
                                            try self.tokens.append(.DoubleBracketOpen);
                                        },
                                        else => break :do_backtrack,
                                    }
                                    continue;
                                }
                                self.backtrack(state);
                            }
                            break :escaped;
                        },
                        ']' => {
                            comptime assertSpecialChar(']');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            if (self.peek()) |p| {
                                if (p.escaped or p.char != ']') break :escaped;
                                const state = self.make_snapshot();
                                _ = self.eat();
                                do_backtrack: {
                                    const p2 = self.peek() orelse {
                                        try self.break_word(true);
                                        try self.tokens.append(.DoubleBracketClose);
                                        continue;
                                    };
                                    if (p2.escaped) break :do_backtrack;
                                    switch (p2.char) {
                                        ' ', '\r', '\n', '\t', ';', '&', '|', '>' => {
                                            try self.break_word(true);
                                            try self.tokens.append(.DoubleBracketClose);
                                        },
                                        else => break :do_backtrack,
                                    }
                                    continue;
                                }
                                self.backtrack(state);
                            }
                            break :escaped;
                        },

                        '#' => {
                            comptime assertSpecialChar('#');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            const whitespace_preceding =
                                if (self.chars.prev) |prev|
                                Chars.isWhitespace(prev)
                            else
                                true;
                            if (!whitespace_preceding) break :escaped;
                            try self.break_word(true);
                            self.eatComment();
                            continue;
                        },
                        ';' => {
                            comptime assertSpecialChar(';');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);
                            try self.tokens.append(.Semicolon);
                            continue;
                        },
                        '\n' => {
                            comptime assertSpecialChar('\n');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word_impl(true, true, false);
                            try self.tokens.append(.Newline);
                            continue;
                        },

                        // glob asterisks
                        '*' => {
                            comptime assertSpecialChar('*');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            if (self.peek()) |next| {
                                if (!next.escaped and next.char == '*') {
                                    _ = self.eat();
                                    try self.break_word(false);
                                    try self.tokens.append(.DoubleAsterisk);
                                    continue;
                                }
                            }
                            try self.break_word(false);
                            try self.tokens.append(.Asterisk);
                            continue;
                        },

                        // brace expansion syntax
                        '{' => {
                            comptime assertSpecialChar('{');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(false);
                            try self.tokens.append(.BraceBegin);
                            continue;
                        },
                        ',' => {
                            comptime assertSpecialChar(',');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(false);
                            try self.tokens.append(.Comma);
                            continue;
                        },
                        '}' => {
                            comptime assertSpecialChar('}');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(false);
                            try self.tokens.append(.BraceEnd);
                            continue;
                        },

                        // Command substitution
                        '`' => {
                            comptime assertSpecialChar('`');

                            if (self.chars.state == .Single) break :escaped;
                            if (self.in_subshell == .backtick) {
                                try self.break_word_operator();
                                if (self.last_tok_tag()) |toktag| {
                                    if (toktag != .Delimit) try self.tokens.append(.Delimit);
                                }
                                try self.tokens.append(.CmdSubstEnd);
                                return;
                            } else {
                                try self.eat_subshell(.backtick);
                            }
                        },
                        // Command substitution/vars
                        '$' => {
                            comptime assertSpecialChar('$');

                            if (self.chars.state == .Single) break :escaped;

                            const peeked = self.peek() orelse InputChar{ .char = 0 };
                            if (!peeked.escaped and peeked.char == '(') {
                                try self.break_word(false);
                                try self.eat_subshell(.dollar);
                                continue;
                            }

                            // const snapshot = self.make_snapshot();
                            // Handle variable
                            try self.break_word(false);
                            const var_tok = try self.eat_var();

                            switch (var_tok.len()) {
                                0 => {
                                    try self.appendCharToStrPool('$');
                                    try self.break_word(false);
                                },
                                1 => blk: {
                                    const c = self.strpool.items[var_tok.start];
                                    if (c >= '0' and c <= '9') {
                                        try self.tokens.append(.{ .VarArgv = c - '0' });
                                        break :blk;
                                    }
                                    try self.tokens.append(.{ .Var = var_tok });
                                },
                                else => {
                                    try self.tokens.append(.{ .Var = var_tok });
                                },
                            }
                            self.word_start = self.j;
                            continue;
                        },
                        '(' => {
                            comptime assertSpecialChar('(');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);
                            try self.eat_subshell(.normal);
                            continue;
                        },
                        ')' => {
                            comptime assertSpecialChar(')');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            if (self.in_subshell != .dollar and self.in_subshell != .normal) {
                                self.add_error("Unexpected ')'");
                                continue;
                            }

                            try self.break_word(true);
                            // Command substitution can be put in a word so need
                            // to add delimiter
                            if (self.in_subshell == .dollar) {
                                if (self.last_tok_tag()) |toktag| {
                                    switch (toktag) {
                                        .Delimit, .Semicolon, .Eof, .Newline => {},
                                        else => {
                                            try self.tokens.append(.Delimit);
                                        },
                                    }
                                }
                            }

                            if (self.in_subshell == .dollar) {
                                try self.tokens.append(.CmdSubstEnd);
                            } else if (self.in_subshell == .normal) {
                                try self.tokens.append(.CloseParen);
                            }
                            return;
                        },

                        '0'...'9' => {
                            comptime for ('0'..'9') |c| assertSpecialChar(c);

                            if (self.chars.state != .Normal) break :escaped;
                            const snapshot = self.make_snapshot();
                            if (self.eat_redirect(input)) |redirect| {
                                try self.break_word(true);
                                try self.tokens.append(.{ .Redirect = redirect });
                                continue;
                            }
                            self.backtrack(snapshot);
                            break :escaped;
                        },

                        // Operators
                        '|' => {
                            comptime assertSpecialChar('|');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word_operator();

                            const next = self.peek() orelse {
                                self.add_error("Unexpected EOF");
                                return;
                            };
                            if (!next.escaped and next.char == '&') {
                                self.add_error("Piping stdout and stderr (`|&`) is not supported yet. Please file an issue on GitHub.");
                                return;
                            }
                            if (next.escaped or next.char != '|') {
                                try self.tokens.append(.Pipe);
                            } else if (next.char == '|') {
                                _ = self.eat() orelse unreachable;
                                try self.tokens.append(.DoublePipe);
                            }
                            continue;
                        },
                        '>' => {
                            comptime assertSpecialChar('>');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word_operator();
                            const redirect = self.eat_simple_redirect(.out);
                            try self.tokens.append(.{ .Redirect = redirect });
                            continue;
                        },
                        '<' => {
                            comptime assertSpecialChar('<');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word_operator();
                            const redirect = self.eat_simple_redirect(.in);
                            try self.tokens.append(.{ .Redirect = redirect });
                            continue;
                        },
                        '&' => {
                            comptime assertSpecialChar('&');

                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word_operator();

                            const next = self.peek() orelse {
                                try self.tokens.append(.Ampersand);
                                continue;
                            };

                            if (next.char == '>' and !next.escaped) {
                                _ = self.eat();
                                const inner = if (self.eat_simple_redirect_operator(.out))
                                    AST.RedirectFlags.@"&>>"()
                                else
                                    AST.RedirectFlags.@"&>"();
                                try self.tokens.append(.{ .Redirect = inner });
                            } else if (next.escaped or next.char != '&') {
                                try self.tokens.append(.Ampersand);
                            } else if (next.char == '&') {
                                _ = self.eat() orelse unreachable;
                                try self.tokens.append(.DoubleAmpersand);
                            } else {
                                try self.tokens.append(.Ampersand);
                                continue;
                            }
                        },

                        // 2. State switchers
                        '\'' => {
                            comptime assertSpecialChar('\'');

                            if (self.chars.state == .Single) {
                                self.chars.state = .Normal;
                                continue;
                            }
                            if (self.chars.state == .Normal) {
                                self.chars.state = .Single;
                                continue;
                            }
                            break :escaped;
                        },
                        '"' => {
                            comptime assertSpecialChar('"');

                            if (self.chars.state == .Single) break :escaped;
                            if (self.chars.state == .Normal) {
                                try self.break_word(false);
                                self.chars.state = .Double;
                            } else if (self.chars.state == .Double) {
                                try self.break_word(false);
                                // self.delimit_quote = true;
                                self.chars.state = .Normal;
                            }
                            continue;
                        },

                        // 3. Word breakers
                        ' ' => {
                            comptime assertSpecialChar(' ');

                            if (self.chars.state == .Normal) {
                                try self.break_word_impl(true, true, false);
                                continue;
                            }
                            break :escaped;
                        },

                        else => break :escaped,
                    }
                    continue;
                }
                // Treat newline preceded by backslash as whitespace
                else if (char == '\n') {
                    if (comptime bun.Environment.allow_assert) {
                        assert(input.escaped);
                    }
                    if (self.chars.state != .Double) {
                        try self.break_word_impl(true, true, false);
                    }
                    continue;
                }

                try self.appendCharToStrPool(char);
            }

            if (self.in_subshell) |subshell_kind| {
                switch (subshell_kind) {
                    .dollar, .backtick => self.add_error("Unclosed command substitution"),
                    .normal => self.add_error("Unclosed subshell"),
                }
                return;
            }

            try self.tokens.append(.Eof);
        }

        fn appendCharToStrPool(self: *@This(), char: Chars.CodepointType) !void {
            if (comptime encoding == .ascii) {
                try self.strpool.append(char);
                self.j += 1;
            } else {
                if (char <= 0x7F) {
                    try self.strpool.append(@intCast(char));
                    self.j += 1;
                    return;
                } else {
                    try self.appendUnicodeCharToStrPool(char);
                }
            }
        }

        fn appendUnicodeCharToStrPool(self: *@This(), char: Chars.CodepointType) !void {
            @setCold(true);

            const ichar: i32 = @intCast(char);
            var bytes: [4]u8 = undefined;
            const n = bun.strings.encodeWTF8Rune(&bytes, ichar);
            self.j += n;
            try self.strpool.appendSlice(bytes[0..n]);
        }

        fn break_word(self: *@This(), add_delimiter: bool) !void {
            return try self.break_word_impl(add_delimiter, false, false);
        }

        /// NOTE: this adds a delimiter
        fn break_word_operator(self: *@This()) !void {
            return try self.break_word_impl(true, false, true);
        }

        inline fn isImmediatelyEscapedQuote(self: *@This()) bool {
            return (self.chars.state == .Double and
                (self.chars.current != null and !self.chars.current.?.escaped and self.chars.current.?.char == '"') and
                (self.chars.prev != null and !self.chars.prev.?.escaped and self.chars.prev.?.char == '"'));
        }

        fn break_word_impl(self: *@This(), add_delimiter: bool, in_normal_space: bool, in_operator: bool) !void {
            const start: u32 = self.word_start;
            const end: u32 = self.j;
            if (start != end or
                self.isImmediatelyEscapedQuote() // we want to preserve immediately escaped quotes like: ""
            ) {
                const tok: Token =
                    switch (self.chars.state) {
                    .Normal => @unionInit(Token, "Text", .{ .start = start, .end = end }),
                    .Single => @unionInit(Token, "SingleQuotedText", .{ .start = start, .end = end }),
                    .Double => @unionInit(Token, "DoubleQuotedText", .{ .start = start, .end = end }),
                };
                try self.tokens.append(tok);
                if (add_delimiter) {
                    try self.tokens.append(.Delimit);
                }
            } else if ((in_normal_space or in_operator) and self.tokens.items.len > 0 and
                // whether or not to add a delimiter token
                switch (self.tokens.items[self.tokens.items.len - 1]) {
                .Var,
                .VarArgv,
                .Text,
                .SingleQuotedText,
                .DoubleQuotedText,
                .BraceBegin,
                .Comma,
                .BraceEnd,
                .CmdSubstEnd,
                .Asterisk,
                => true,

                .Pipe,
                .DoublePipe,
                .Ampersand,
                .DoubleAmpersand,
                .Redirect,
                .Dollar,
                .DoubleAsterisk,
                .Eq,
                .Semicolon,
                .Newline,
                .CmdSubstBegin,
                .CmdSubstQuoted,
                .OpenParen,
                .CloseParen,
                .JSObjRef,
                .DoubleBracketOpen,
                .DoubleBracketClose,
                .Delimit,
                .Eof,
                => false,
            }) {
                try self.tokens.append(.Delimit);
                self.delimit_quote = false;
            }
            self.word_start = self.j;
        }

        const RedirectDirection = enum { out, in };

        fn eat_simple_redirect(self: *@This(), dir: RedirectDirection) AST.RedirectFlags {
            const is_double = self.eat_simple_redirect_operator(dir);

            if (is_double) {
                return switch (dir) {
                    .out => AST.RedirectFlags.@">>"(),
                    .in => AST.RedirectFlags.@"<<"(),
                };
            }

            return switch (dir) {
                .out => AST.RedirectFlags.@">"(),
                .in => AST.RedirectFlags.@"<"(),
            };
        }

        /// Returns true if the operator is "double one": >> or <<
        /// Returns null if it is invalid: <> ><
        fn eat_simple_redirect_operator(self: *@This(), dir: RedirectDirection) bool {
            if (self.peek()) |peeked| {
                if (peeked.escaped) return false;
                switch (peeked.char) {
                    '>' => {
                        if (dir == .out) {
                            _ = self.eat();
                            return true;
                        }
                        return false;
                    },
                    '<' => {
                        if (dir == .in) {
                            _ = self.eat();
                            return true;
                        }
                        return false;
                    },
                    else => return false,
                }
            }
            return false;
        }

        // TODO Arbitrary file descriptor redirect
        fn eat_redirect(self: *@This(), first: InputChar) ?AST.RedirectFlags {
            var flags: AST.RedirectFlags = .{};
            switch (first.char) {
                '0' => flags.stdin = true,
                '1' => flags.stdout = true,
                '2' => flags.stderr = true,
                // Just allow the std file descriptors for now
                else => return null,
            }
            var dir: RedirectDirection = .out;
            if (self.peek()) |input| {
                if (input.escaped) return null;
                switch (input.char) {
                    '>' => {
                        _ = self.eat();
                        dir = .out;
                        const is_double = self.eat_simple_redirect_operator(dir);
                        if (is_double) flags.append = true;
                        if (self.peek()) |peeked| {
                            if (!peeked.escaped and peeked.char == '&') {
                                _ = self.eat();
                                if (self.peek()) |peeked2| {
                                    switch (peeked2.char) {
                                        '1' => {
                                            _ = self.eat();
                                            if (!flags.stdout and flags.stderr) {
                                                flags.duplicate_out = true;
                                                flags.stdout = true;
                                                flags.stderr = false;
                                            } else return null;
                                        },
                                        '2' => {
                                            _ = self.eat();
                                            if (!flags.stderr and flags.stdout) {
                                                flags.duplicate_out = true;
                                                flags.stderr = true;
                                                flags.stdout = false;
                                            } else return null;
                                        },
                                        else => return null,
                                    }
                                }
                            }
                        }
                        return flags;
                    },
                    '<' => {
                        dir = .in;
                        const is_double = self.eat_simple_redirect_operator(dir);
                        if (is_double) flags.append = true;
                        return flags;
                    },
                    else => return null,
                }
            } else return null;
        }

        fn eat_redirect_old(self: *@This(), first: InputChar) ?AST.RedirectFlags {
            var flags: AST.RedirectFlags = .{};
            if (self.matchesAsciiLiteral("2>&1")) {} else if (self.matchesAsciiLiteral("1>&2")) {} else switch (first.char) {
                '0'...'9' => {
                    // Codepoint int casts are safe here because the digits are in the ASCII range
                    var count: usize = 1;
                    var buf: [32]u8 = [_]u8{@intCast(first.char)} ** 32;

                    while (self.peek()) |peeked| {
                        const char = peeked.char;
                        switch (char) {
                            '0'...'9' => {
                                _ = self.eat();
                                if (count >= 32) {
                                    return null;
                                }
                                buf[count] = @intCast(char);
                                count += 1;
                                continue;
                            },
                            else => break,
                        }
                    }

                    const num = std.fmt.parseInt(usize, buf[0..count], 10) catch {
                        // This means the number was really large, meaning it
                        // probably was supposed to be a string
                        return null;
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
                            // FIXME support redirection to any arbitrary fd
                            log("redirection to fd {d} is invalid\n", .{num});
                            return null;
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

            var dir: RedirectDirection = .out;
            if (self.peek()) |input| {
                if (input.escaped) return null;
                switch (input.char) {
                    '>' => dir = .out,
                    '<' => dir = .in,
                    else => return null,
                }
                _ = self.eat();
            } else return null;

            const is_double = self.eat_simple_redirect_operator(dir);
            if (is_double) {
                flags.append = true;
            }

            return flags;
        }

        /// Assumes the first character of the literal has been eaten
        /// Backtracks and returns false if unsuccessful
        fn eat_literal(self: *@This(), comptime CodepointType: type, comptime literal: []const CodepointType) bool {
            const literal_skip_first = literal[1..];
            const snapshot = self.make_snapshot();
            const slice = self.eat_slice(CodepointType, literal_skip_first.len) orelse {
                self.backtrack(snapshot);
                return false;
            };

            if (std.mem.eql(CodepointType, &slice, literal_skip_first))
                return true;

            self.backtrack(snapshot);
            return false;
        }

        fn eat_number_word(self: *@This()) ?usize {
            const snap = self.make_snapshot();
            var count: usize = 0;
            var buf: [32]u8 = [_]u8{0} ** 32;

            while (self.eat()) |result| {
                const char = result.char;
                switch (char) {
                    '0'...'9' => {
                        if (count >= 32) return null;
                        // Safe to cast here because 0-8 is in ASCII range
                        buf[count] = @intCast(char);
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

            const num = std.fmt.parseInt(usize, buf[0..count], 10) catch {
                self.backtrack(snap);
                return null;
            };

            return num;
        }

        fn eat_subshell(self: *@This(), kind: SubShellKind) !void {
            if (kind == .dollar) {
                // Eat the open paren
                _ = self.eat();
            }

            switch (kind) {
                .dollar, .backtick => {
                    try self.tokens.append(.CmdSubstBegin);
                    if (self.chars.state == .Double) {
                        try self.tokens.append(.CmdSubstQuoted);
                    }
                },
                .normal => try self.tokens.append(.OpenParen),
            }
            const prev_quote_state = self.chars.state;
            var sublexer = self.make_sublexer(kind);
            try sublexer.lex();
            self.continue_from_sublexer(&sublexer);
            self.chars.state = prev_quote_state;
        }

        fn appendStringToStrPool(self: *@This(), bunstr: bun.String) !void {
            const start = self.strpool.items.len;
            if (bunstr.isUTF16()) {
                const utf16 = bunstr.utf16();
                const additional = bun.simdutf.simdutf__utf8_length_from_utf16le(utf16.ptr, utf16.len);
                try self.strpool.ensureUnusedCapacity(additional);
                try bun.strings.convertUTF16ToUTF8Append(&self.strpool, bunstr.utf16());
            } else if (bunstr.isUTF8()) {
                try self.strpool.appendSlice(bunstr.byteSlice());
            } else if (bunstr.is8Bit()) {
                if (isAllAscii(bunstr.byteSlice())) {
                    try self.strpool.appendSlice(bunstr.byteSlice());
                } else {
                    const bytes = bunstr.byteSlice();
                    const non_ascii_idx = bun.strings.firstNonASCII(bytes) orelse 0;

                    if (non_ascii_idx > 0) {
                        try self.strpool.appendSlice(bytes[0..non_ascii_idx]);
                    }
                    self.strpool = try bun.strings.allocateLatin1IntoUTF8WithList(self.strpool, self.strpool.items.len, []const u8, bytes[non_ascii_idx..]);
                }
            }
            const end = self.strpool.items.len;
            self.j += @intCast(end - start);
        }

        fn handleJSStringRef(self: *@This(), bunstr: bun.String) !void {
            try self.appendStringToStrPool(bunstr);
        }

        fn looksLikeJSObjRef(self: *@This()) bool {
            const bytes = self.chars.srcBytesAtCursor();
            if (LEX_JS_OBJREF_PREFIX.len - 1 >= bytes.len) return false;
            return std.mem.eql(u8, bytes[0 .. LEX_JS_OBJREF_PREFIX.len - 1], LEX_JS_OBJREF_PREFIX[1..]);
        }

        fn looksLikeJSStringRef(self: *@This()) bool {
            const bytes = self.chars.srcBytesAtCursor();
            if (LEX_JS_STRING_PREFIX.len - 1 >= bytes.len) return false;
            return std.mem.eql(u8, bytes[0 .. LEX_JS_STRING_PREFIX.len - 1], LEX_JS_STRING_PREFIX[1..]);
        }

        fn bumpCursorAscii(self: *@This(), new_idx: usize, prev_ascii_char: ?u7, cur_ascii_char: u7) void {
            if (comptime encoding == .ascii) {
                self.chars.src.i = new_idx;
                if (prev_ascii_char) |pc| self.chars.prev = .{ .char = pc };
                self.chars.current = .{ .char = cur_ascii_char };
                return;
            }
            self.chars.src.cursor = CodepointIterator.Cursor{
                .i = @intCast(new_idx),
                .c = cur_ascii_char,
                .width = 1,
            };
            self.chars.src.next_cursor = self.chars.src.cursor;
            SrcUnicode.nextCursor(&self.chars.src.iter, &self.chars.src.next_cursor);
            if (prev_ascii_char) |pc| self.chars.prev = .{ .char = pc };
            self.chars.current = .{ .char = cur_ascii_char };
        }

        fn matchesAsciiLiteral(self: *@This(), literal: []const u8) bool {
            const bytes = self.chars.srcBytesAtCursor();
            if (literal.len >= bytes.len) return false;
            return std.mem.eql(u8, bytes[0..literal.len], literal[0..]);
        }

        fn eatJSSubstitutionIdx(self: *@This(), comptime literal: []const u8, comptime name: []const u8, comptime validate: *const fn (*@This(), usize) bool) ?usize {
            if (self.matchesAsciiLiteral(literal[1..literal.len])) {
                const bytes = self.chars.srcBytesAtCursor();
                var i: usize = 0;
                var digit_buf: [32]u8 = undefined;
                var digit_buf_count: u8 = 0;

                i += literal.len - 1;

                while (i < bytes.len) : (i += 1) {
                    switch (bytes[i]) {
                        '0'...'9' => {
                            if (digit_buf_count >= digit_buf.len) {
                                const ERROR_STR = "Invalid " ++ name ++ " (number too high): ";
                                var error_buf: [ERROR_STR.len + digit_buf.len + 1]u8 = undefined;
                                const error_msg = std.fmt.bufPrint(error_buf[0..], "{s} {s}{c}", .{ ERROR_STR, digit_buf[0..digit_buf_count], bytes[i] }) catch @panic("Should not happen");
                                self.add_error(error_msg);
                                return null;
                            }
                            digit_buf[digit_buf_count] = bytes[i];
                            digit_buf_count += 1;
                        },
                        else => break,
                    }
                }

                if (digit_buf_count == 0) {
                    self.add_error("Invalid " ++ name ++ " (no idx)");
                    return null;
                }

                const idx = std.fmt.parseInt(usize, digit_buf[0..digit_buf_count], 10) catch {
                    self.add_error("Invalid " ++ name ++ " ref ");
                    return null;
                };

                if (!validate(self, idx)) return null;
                // if (idx >= self.string_refs.len) {
                //     self.add_error("Invalid " ++ name ++ " (out of bounds");
                //     return null;
                // }

                // Bump the cursor
                const new_idx = self.chars.cursorPos() + i;
                const prev_ascii_char: ?u7 = if (digit_buf_count == 1) null else @truncate(digit_buf[digit_buf_count - 2]);
                const cur_ascii_char: u7 = @truncate(digit_buf[digit_buf_count - 1]);
                self.bumpCursorAscii(new_idx, prev_ascii_char, cur_ascii_char);

                // return self.string_refs[idx];
                return idx;
            }
            return null;
        }

        /// __NOTE__: Do not store references to the returned bun.String, it does not have its ref count incremented
        fn eatJSStringRef(self: *@This()) ?bun.String {
            if (self.eatJSSubstitutionIdx(
                LEX_JS_STRING_PREFIX,
                "JS string ref",
                validateJSStringRefIdx,
            )) |idx| {
                return self.string_refs[idx];
            }
            return null;
        }

        fn validateJSStringRefIdx(self: *@This(), idx: usize) bool {
            if (idx >= self.string_refs.len) {
                self.add_error("Invalid JS string ref (out of bounds");
                return false;
            }
            return true;
        }

        fn eatJSObjRef(self: *@This()) ?Token {
            if (self.eatJSSubstitutionIdx(
                LEX_JS_OBJREF_PREFIX,
                "JS object ref",
                validateJSObjRefIdx,
            )) |idx| {
                return .{ .JSObjRef = @intCast(idx) };
            }
            return null;
        }

        fn validateJSObjRefIdx(self: *@This(), idx: usize) bool {
            if (idx >= std.math.maxInt(u32)) {
                self.add_error("Invalid JS object ref (out of bounds)");
                return false;
            }
            return true;
        }

        fn eat_var(self: *@This()) !Token.TextRange {
            const start = self.j;
            var i: usize = 0;
            var is_int = false;
            // Eat until special character
            while (self.peek()) |result| {
                defer i += 1;
                const char = result.char;
                const escaped = result.escaped;

                if (i == 0) {
                    switch (char) {
                        '=' => return .{ .start = start, .end = self.j },
                        '0'...'9' => {
                            is_int = true;
                            _ = self.eat().?;
                            try self.appendCharToStrPool(char);
                            continue;
                        },
                        'a'...'z', 'A'...'Z', '_' => {},
                        else => return .{ .start = start, .end = self.j },
                    }
                }
                if (is_int) {
                    return .{ .start = start, .end = self.j };
                }

                // if (char
                switch (char) {
                    '{', '}', ';', '\'', '\"', ' ', '|', '&', '>', ',', '$' => {
                        return .{ .start = start, .end = self.j };
                    },
                    else => {
                        if (!escaped and
                            (self.in_subshell == .dollar and char == ')') or (self.in_subshell == .backtick and char == '`') or (self.in_subshell == .normal and char == ')'))
                        {
                            return .{ .start = start, .end = self.j };
                        }
                        switch (char) {
                            '0'...'9', 'a'...'z', 'A'...'Z', '_' => {
                                _ = self.eat() orelse unreachable;
                                try self.appendCharToStrPool(char);
                            },
                            else => return .{ .start = start, .end = self.j },
                        }
                    },
                }
            }
            return .{ .start = start, .end = self.j };
        }

        fn eat(self: *@This()) ?InputChar {
            return self.chars.eat();
        }

        fn eatComment(self: *@This()) void {
            while (self.eat()) |peeked| {
                if (peeked.escaped) {
                    continue;
                }
                if (peeked.char == '\n') break;
            }
        }

        fn eat_slice(self: *@This(), comptime CodepointType: type, comptime N: usize) ?[N]CodepointType {
            var slice = [_]CodepointType{0} ** N;
            var i: usize = 0;
            while (self.peek()) |result| {
                // If we passed in codepoint range that is equal to the source
                // string, or is greater than the codepoint range of source string than an int cast
                // will not panic
                if (CodepointType == Chars.CodepointType or std.math.maxInt(CodepointType) >= std.math.maxInt(Chars.CodepointType)) {
                    slice[i] = @intCast(result.char);
                } else {
                    // Otherwise the codepoint range is smaller than the source, so we need to check that the chars are valid
                    if (result.char > std.math.maxInt(CodepointType)) {
                        return null;
                    }
                    slice[i] = @intCast(result.char);
                }

                i += 1;
                _ = self.eat();
                if (i == N) {
                    return slice;
                }
            }

            return null;
        }

        fn peek(self: *@This()) ?InputChar {
            return self.chars.peek();
        }

        fn read_char(self: *@This()) ?InputChar {
            return self.chars.read_char();
        }
    };
}

pub const StringEncoding = enum { ascii, wtf8, utf16 };

const SrcAscii = struct {
    bytes: []const u8,
    i: usize,

    const IndexValue = packed struct {
        char: u7,
        escaped: bool = false,
    };

    fn init(bytes: []const u8) SrcAscii {
        return .{
            .bytes = bytes,
            .i = 0,
        };
    }

    inline fn index(this: *const SrcAscii) ?IndexValue {
        if (this.i >= this.bytes.len) return null;
        return .{ .char = @intCast(this.bytes[this.i]) };
    }

    inline fn indexNext(this: *const SrcAscii) ?IndexValue {
        if (this.i + 1 >= this.bytes.len) return null;
        return .{ .char = @intCast(this.bytes[this.i + 1]) };
    }

    inline fn eat(this: *SrcAscii, escaped: bool) void {
        this.i += 1 + @as(u32, @intFromBool(escaped));
    }
};

const SrcUnicode = struct {
    iter: CodepointIterator,
    cursor: CodepointIterator.Cursor,
    next_cursor: CodepointIterator.Cursor,

    const IndexValue = packed struct {
        char: u29,
        width: u3 = 0,
    };

    fn nextCursor(iter: *const CodepointIterator, cursor: *CodepointIterator.Cursor) void {
        if (!iter.next(cursor)) {
            // This will make `i > sourceBytes.len` so the condition in `index` will fail
            cursor.i = @intCast(iter.bytes.len + 1);
            cursor.width = 1;
            cursor.c = CodepointIterator.ZeroValue;
        }
    }

    fn init(bytes: []const u8) SrcUnicode {
        var iter = CodepointIterator.init(bytes);
        var cursor = CodepointIterator.Cursor{};
        nextCursor(&iter, &cursor);
        var next_cursor: CodepointIterator.Cursor = cursor;
        nextCursor(&iter, &next_cursor);
        return .{ .iter = iter, .cursor = cursor, .next_cursor = next_cursor };
    }

    inline fn index(this: *const SrcUnicode) ?IndexValue {
        if (this.cursor.width + this.cursor.i > this.iter.bytes.len) return null;
        return .{ .char = this.cursor.c, .width = this.cursor.width };
    }

    inline fn indexNext(this: *const SrcUnicode) ?IndexValue {
        if (this.next_cursor.width + this.next_cursor.i > this.iter.bytes.len) return null;
        return .{ .char = @intCast(this.next_cursor.c), .width = this.next_cursor.width };
    }

    inline fn eat(this: *SrcUnicode, escaped: bool) void {
        // eat two codepoints
        if (escaped) {
            nextCursor(&this.iter, &this.next_cursor);
            this.cursor = this.next_cursor;
            nextCursor(&this.iter, &this.next_cursor);
        } else {
            // eat one codepoint
            this.cursor = this.next_cursor;
            nextCursor(&this.iter, &this.next_cursor);
        }
    }
};

pub fn ShellCharIter(comptime encoding: StringEncoding) type {
    return struct {
        src: Src,
        state: State = .Normal,
        prev: ?InputChar = null,
        current: ?InputChar = null,

        pub const Src = switch (encoding) {
            .ascii => SrcAscii,
            .wtf8, .utf16 => SrcUnicode,
        };

        pub const CodepointType = if (encoding == .ascii) u7 else u32;

        pub const InputChar = if (encoding == .ascii) SrcAscii.IndexValue else struct {
            char: u32,
            escaped: bool = false,
        };

        pub fn isWhitespace(char: InputChar) bool {
            return switch (char.char) {
                '\t', '\r', '\n', ' ' => true,
                else => false,
            };
        }

        pub const State = enum {
            Normal,
            Single,
            Double,
        };

        pub fn init(bytes: []const u8) @This() {
            const src = if (comptime encoding == .ascii)
                SrcAscii.init(bytes)
            else
                SrcUnicode.init(bytes);

            return .{
                .src = src,
            };
        }

        pub fn srcBytes(self: *@This()) []const u8 {
            if (comptime encoding == .ascii) return self.src.bytes;
            return self.src.iter.bytes;
        }

        pub fn srcBytesAtCursor(self: *@This()) []const u8 {
            const bytes = self.srcBytes();
            if (comptime encoding == .ascii) {
                if (self.src.i >= bytes.len) return "";
                return bytes[self.src.i..];
            }

            if (self.src.iter.i >= bytes.len) return "";
            return bytes[self.src.iter.i..];
        }

        pub fn cursorPos(self: *@This()) usize {
            if (comptime encoding == .ascii) return self.src.i;
            return self.src.iter.i;
        }

        pub fn eat(self: *@This()) ?InputChar {
            if (self.read_char()) |result| {
                self.prev = self.current;
                self.current = result;
                self.src.eat(result.escaped);
                return result;
            }
            return null;
        }

        pub fn peek(self: *@This()) ?InputChar {
            if (self.read_char()) |result| {
                return result;
            }

            return null;
        }

        pub fn read_char(self: *@This()) ?InputChar {
            const indexed_value = self.src.index() orelse return null;
            var char = indexed_value.char;
            if (char != '\\' or self.state == .Single) return .{ .char = char };

            // Handle backslash
            switch (self.state) {
                .Normal => {
                    const peeked = self.src.indexNext() orelse return null;
                    char = peeked.char;
                },
                .Double => {
                    const peeked = self.src.indexNext() orelse return null;
                    switch (peeked.char) {
                        // Backslash only applies to these characters
                        '$', '`', '"', '\\', '\n', '#' => {
                            char = peeked.char;
                        },
                        else => return .{ .char = char, .escaped = false },
                    }
                },
                // We checked `self.state == .Single` above so this is impossible
                .Single => unreachable,
            }

            return .{ .char = char, .escaped = true };
        }
    };
}

/// Only these charaters allowed:
/// - a-ZA-Z
/// - _
/// - 0-9 (but can't be first char)
pub fn isValidVarName(var_name: []const u8) bool {
    if (isAllAscii(var_name)) return isValidVarNameAscii(var_name);

    if (var_name.len == 0) return false;
    var iter = CodepointIterator.init(var_name);
    var cursor = CodepointIterator.Cursor{};

    if (!iter.next(&cursor)) return false;

    switch (cursor.c) {
        '=', '0'...'9' => {
            return false;
        },
        'a'...'z', 'A'...'Z', '_' => {},
        else => return false,
    }

    while (iter.next(&cursor)) {
        switch (cursor.c) {
            '0'...'9', 'a'...'z', 'A'...'Z', '_' => {},
            else => return false,
        }
    }

    return true;
}
fn isValidVarNameAscii(var_name: []const u8) bool {
    if (var_name.len == 0) return false;
    switch (var_name[0]) {
        '=', '0'...'9' => {
            return false;
        },
        'a'...'z', 'A'...'Z', '_' => {
            if (var_name.len == 1) return true;
        },
        else => return false,
    }
    for (var_name) |c| {
        switch (c) {
            '0'...'9', 'a'...'z', 'A'...'Z', '_' => {},
            else => return false,
        }
    }
    return true;
}

var stderr_mutex = std.Thread.Mutex{};

pub fn hasEqSign(str: []const u8) ?u32 {
    if (isAllAscii(str)) {
        if (str.len < 16)
            return hasEqSignAsciiSlow(str);

        const needles: @Vector(16, u8) = @splat('=');

        var i: u32 = 0;
        while (i + 16 <= str.len) : (i += 16) {
            const haystack = str[i..][0..16].*;
            const result = haystack == needles;

            if (std.simd.firstTrue(result)) |idx| {
                return @intCast(i + idx);
            }
        }

        return i + (hasEqSignAsciiSlow(str[i..]) orelse return null);
    }

    // TODO actually i think that this can also use the simd stuff

    var iter = CodepointIterator.init(str);
    var cursor = CodepointIterator.Cursor{};
    while (iter.next(&cursor)) {
        if (cursor.c == '=') {
            return @intCast(cursor.i);
        }
    }

    return null;
}

pub fn hasEqSignAsciiSlow(str: []const u8) ?u32 {
    for (str, 0..) |c, i| if (c == '=') return @intCast(i);
    return null;
}

pub const CmdEnvIter = struct {
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

const ExpansionStr = union(enum) {};

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
        Redirect: AST.RedirectFlags,

        // $
        Dollar,
        // *
        Asterisk,
        DoubleAsterisk,
        // =
        Eq,
        Semicolon,
        Newline,

        BraceBegin,
        Comma,
        BraceEnd,
        CmdSubstBegin,
        CmdSubstQuoted,
        CmdSubstEnd,
        OpenParen,
        CloseParen,

        Var: []const u8,
        VarArgv: u8,
        Text: []const u8,
        SingleQuotedText: []const u8,
        DoubleQuotedText: []const u8,
        JSObjRef: u32,

        DoubleBracketOpen,
        DoubleBracketClose,

        Delimit,
        Eof,

        pub fn from_real(the_token: Token, buf: []const u8) TestToken {
            switch (the_token) {
                .Var => |txt| return .{ .Var = buf[txt.start..txt.end] },
                .VarArgv => |int| return .{ .VarArgv = int },
                .Text => |txt| return .{ .Text = buf[txt.start..txt.end] },
                .SingleQuotedText => |txt| return .{ .SingleQuotedText = buf[txt.start..txt.end] },
                .DoubleQuotedText => |txt| return .{ .DoubleQuotedText = buf[txt.start..txt.end] },
                .JSObjRef => |val| return .{ .JSObjRef = val },
                .Pipe => return .Pipe,
                .DoublePipe => return .DoublePipe,
                .Ampersand => return .Ampersand,
                .DoubleAmpersand => return .DoubleAmpersand,
                .Redirect => |r| return .{ .Redirect = r },
                .Dollar => return .Dollar,
                .Asterisk => return .Asterisk,
                .DoubleAsterisk => return .DoubleAsterisk,
                .Eq => return .Eq,
                .Semicolon => return .Semicolon,
                .Newline => return .Newline,
                .BraceBegin => return .BraceBegin,
                .Comma => return .Comma,
                .BraceEnd => return .BraceEnd,
                .CmdSubstBegin => return .CmdSubstBegin,
                .CmdSubstQuoted => return .CmdSubstQuoted,
                .CmdSubstEnd => return .CmdSubstEnd,
                .OpenParen => return .OpenParen,
                .CloseParen => return .CloseParen,
                .DoubleBracketOpen => return .DoubleBracketOpen,
                .DoubleBracketClose => return .DoubleBracketClose,
                .Delimit => return .Delimit,
                .Eof => return .Eof,
            }
        }
    };
};

pub fn shellCmdFromJS(
    globalThis: *JSC.JSGlobalObject,
    string_args: JSValue,
    template_args: *JSC.JSArrayIterator,
    out_jsobjs: *std.ArrayList(JSValue),
    jsstrings: *std.ArrayList(bun.String),
    out_script: *std.ArrayList(u8),
) !bool {
    var builder = ShellSrcBuilder.init(globalThis, out_script, jsstrings);
    var jsobjref_buf: [128]u8 = [_]u8{0} ** 128;

    var string_iter = string_args.arrayIterator(globalThis);
    var i: u32 = 0;
    const last = string_iter.len -| 1;
    while (string_iter.next()) |js_value| {
        defer i += 1;
        if (!try builder.appendJSValueStr(js_value, false)) {
            globalThis.throw("Shell script string contains invalid UTF-16", .{});
            return false;
        }
        // const str = js_value.getZigString(globalThis);
        // try script.appendSlice(str.full());
        if (i < last) {
            const template_value = template_args.next() orelse {
                globalThis.throw("Shell script is missing JSValue arg", .{});
                return false;
            };
            if (!(try handleTemplateValue(globalThis, template_value, out_jsobjs, out_script, jsstrings, jsobjref_buf[0..]))) return false;
        }
    }
    return true;
}

pub fn handleTemplateValue(
    globalThis: *JSC.JSGlobalObject,
    template_value: JSValue,
    out_jsobjs: *std.ArrayList(JSValue),
    out_script: *std.ArrayList(u8),
    jsstrings: *std.ArrayList(bun.String),
    jsobjref_buf: []u8,
) !bool {
    var builder = ShellSrcBuilder.init(globalThis, out_script, jsstrings);
    if (!template_value.isEmpty()) {
        if (template_value.asArrayBuffer(globalThis)) |array_buffer| {
            _ = array_buffer;
            const idx = out_jsobjs.items.len;
            template_value.protect();
            try out_jsobjs.append(template_value);
            const slice = try std.fmt.bufPrint(jsobjref_buf[0..], "{s}{d}", .{ LEX_JS_OBJREF_PREFIX, idx });
            try out_script.appendSlice(slice);
            return true;
        }

        if (template_value.as(JSC.WebCore.Blob)) |blob| {
            if (blob.store) |store| {
                if (store.data == .file) {
                    if (store.data.file.pathlike == .path) {
                        const path = store.data.file.pathlike.path.slice();
                        if (!try builder.appendUTF8(path, true)) {
                            globalThis.throw("Shell script string contains invalid UTF-16", .{});
                            return false;
                        }
                        return true;
                    }
                }
            }

            const idx = out_jsobjs.items.len;
            template_value.protect();
            try out_jsobjs.append(template_value);
            const slice = try std.fmt.bufPrint(jsobjref_buf[0..], "{s}{d}", .{ LEX_JS_OBJREF_PREFIX, idx });
            try out_script.appendSlice(slice);
            return true;
        }

        if (JSC.WebCore.ReadableStream.fromJS(template_value, globalThis)) |rstream| {
            _ = rstream;

            const idx = out_jsobjs.items.len;
            template_value.protect();
            try out_jsobjs.append(template_value);
            const slice = try std.fmt.bufPrint(jsobjref_buf[0..], "{s}{d}", .{ LEX_JS_OBJREF_PREFIX, idx });
            try out_script.appendSlice(slice);
            return true;
        }

        if (template_value.as(JSC.WebCore.Response)) |req| {
            _ = req;

            const idx = out_jsobjs.items.len;
            template_value.protect();
            try out_jsobjs.append(template_value);
            const slice = try std.fmt.bufPrint(jsobjref_buf[0..], "{s}{d}", .{ LEX_JS_OBJREF_PREFIX, idx });
            try out_script.appendSlice(slice);
            return true;
        }

        if (template_value.isString()) {
            if (!try builder.appendJSValueStr(template_value, true)) {
                globalThis.throw("Shell script string contains invalid UTF-16", .{});
                return false;
            }
            return true;
        }

        if (template_value.jsType().isArray()) {
            var array = template_value.arrayIterator(globalThis);
            const last = array.len -| 1;
            var i: u32 = 0;
            while (array.next()) |arr| : (i += 1) {
                if (!(try handleTemplateValue(globalThis, arr, out_jsobjs, out_script, jsstrings, jsobjref_buf))) return false;
                if (i < last) {
                    const str = bun.String.static(" ");
                    if (!try builder.appendBunStr(str, false)) return false;
                }
            }
            return true;
        }

        if (template_value.isObject()) {
            if (template_value.getTruthy(globalThis, "raw")) |maybe_str| {
                const bunstr = maybe_str.toBunString(globalThis);
                defer bunstr.deref();
                if (!try builder.appendBunStr(bunstr, false)) {
                    globalThis.throw("Shell script string contains invalid UTF-16", .{});
                    return false;
                }
                return true;
            }
        }

        if (template_value.isPrimitive()) {
            if (!try builder.appendJSValueStr(template_value, true)) {
                globalThis.throw("Shell script string contains invalid UTF-16", .{});
                return false;
            }
            return true;
        }

        if (template_value.implementsToString(globalThis)) {
            if (!try builder.appendJSValueStr(template_value, true)) {
                globalThis.throw("Shell script string contains invalid UTF-16", .{});
                return false;
            }
            return true;
        }

        globalThis.throw("Invalid JS object used in shell: {}, you might need to call `.toString()` on it", .{template_value.fmtString(globalThis)});
        return false;
    }

    return true;
}

pub const ShellSrcBuilder = struct {
    globalThis: *JSC.JSGlobalObject,
    outbuf: *std.ArrayList(u8),
    jsstrs_to_escape: *std.ArrayList(bun.String),
    jsstr_ref_buf: [128]u8 = [_]u8{0} ** 128,

    pub fn init(
        globalThis: *JSC.JSGlobalObject,
        outbuf: *std.ArrayList(u8),
        jsstrs_to_escape: *std.ArrayList(bun.String),
    ) ShellSrcBuilder {
        return .{
            .globalThis = globalThis,
            .outbuf = outbuf,
            .jsstrs_to_escape = jsstrs_to_escape,
        };
    }

    pub fn appendJSValueStr(this: *ShellSrcBuilder, jsval: JSValue, comptime allow_escape: bool) !bool {
        const bunstr = jsval.toBunString(this.globalThis);
        defer bunstr.deref();

        return try this.appendBunStr(bunstr, allow_escape);
    }

    pub fn appendBunStr(
        this: *ShellSrcBuilder,
        bunstr: bun.String,
        comptime allow_escape: bool,
    ) !bool {
        const invalid = (bunstr.isUTF16() and !bun.simdutf.validate.utf16le(bunstr.utf16())) or (bunstr.isUTF8() and !bun.simdutf.validate.utf8(bunstr.byteSlice()));
        if (invalid) return false;
        if (allow_escape) {
            if (needsEscapeBunstr(bunstr)) {
                try this.appendJSStrRef(bunstr);
                return true;
            }
        }
        if (bunstr.isUTF16()) {
            try this.appendUTF16Impl(bunstr.utf16());
            return true;
        }
        if (bunstr.isUTF8() or bun.strings.isAllASCII(bunstr.byteSlice())) {
            try this.appendUTF8Impl(bunstr.byteSlice());
            return true;
        }
        try this.appendLatin1Impl(bunstr.byteSlice());
        return true;
    }

    pub fn appendUTF8(this: *ShellSrcBuilder, utf8: []const u8, comptime allow_escape: bool) !bool {
        const invalid = bun.simdutf.validate.utf8(utf8);
        if (!invalid) return false;
        if (allow_escape) {
            if (needsEscapeUtf8AsciiLatin1(utf8)) {
                const bunstr = bun.String.createUTF8(utf8);
                defer bunstr.deref();
                try this.appendJSStrRef(bunstr);
                return true;
            }
        }

        try this.appendUTF8Impl(utf8);
        return true;
    }

    pub fn appendUTF16Impl(this: *ShellSrcBuilder, utf16: []const u16) !void {
        const size = bun.simdutf.simdutf__utf8_length_from_utf16le(utf16.ptr, utf16.len);
        try this.outbuf.ensureUnusedCapacity(size);
        try bun.strings.convertUTF16ToUTF8Append(this.outbuf, utf16);
    }

    pub fn appendUTF8Impl(this: *ShellSrcBuilder, utf8: []const u8) !void {
        try this.outbuf.appendSlice(utf8);
    }

    pub fn appendLatin1Impl(this: *ShellSrcBuilder, latin1: []const u8) !void {
        const non_ascii_idx = bun.strings.firstNonASCII(latin1) orelse 0;

        if (non_ascii_idx > 0) {
            try this.appendUTF8Impl(latin1[0..non_ascii_idx]);
        }

        this.outbuf.* = try bun.strings.allocateLatin1IntoUTF8WithList(this.outbuf.*, this.outbuf.items.len, []const u8, latin1);
    }

    pub fn appendJSStrRef(this: *ShellSrcBuilder, bunstr: bun.String) !void {
        const idx = this.jsstrs_to_escape.items.len;
        const str = std.fmt.bufPrint(this.jsstr_ref_buf[0..], "{s}{d}", .{ LEX_JS_STRING_PREFIX, idx }) catch {
            @panic("Impossible");
        };
        try this.outbuf.appendSlice(str);
        bunstr.ref();
        try this.jsstrs_to_escape.append(bunstr);
    }
};

/// Characters that need to escaped
const SPECIAL_CHARS = [_]u8{ '~', '[', ']', '#', ';', '\n', '*', '{', ',', '}', '`', '$', '=', '(', ')', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '|', '>', '<', '&', '\'', '"', ' ', '\\' };
const SPECIAL_CHARS_TABLE: std.bit_set.IntegerBitSet(256) = brk: {
    var table = std.bit_set.IntegerBitSet(256).initEmpty();
    for (SPECIAL_CHARS) |c| {
        table.set(c);
    }
    break :brk table;
};
pub fn assertSpecialChar(c: u8) void {
    bun.assertComptime();
    bun.assert(SPECIAL_CHARS_TABLE.isSet(c));
}
/// Characters that need to be backslashed inside double quotes
const BACKSLASHABLE_CHARS = [_]u8{ '$', '`', '"', '\\' };

pub fn escapeBunStr(bunstr: bun.String, outbuf: *std.ArrayList(u8), comptime add_quotes: bool) !bool {
    if (bunstr.isUTF16()) {
        return try escapeUtf16(bunstr.utf16(), outbuf, add_quotes);
    }
    if (bunstr.isUTF8()) {
        try escapeWTF8(bunstr.byteSlice(), outbuf, add_quotes);
        return true;
    }
    // otherwise should be latin-1 or ascii
    try escape8Bit(bunstr.byteSlice(), outbuf, add_quotes);
    return true;
}

/// works for latin-1 and ascii
pub fn escape8Bit(str: []const u8, outbuf: *std.ArrayList(u8), comptime add_quotes: bool) !void {
    try outbuf.ensureUnusedCapacity(str.len);

    if (add_quotes) try outbuf.append('\"');

    loop: for (str) |c| {
        inline for (BACKSLASHABLE_CHARS) |spc| {
            if (spc == c) {
                try outbuf.appendSlice(&.{
                    '\\',
                    c,
                });
                continue :loop;
            }
        }
        try outbuf.append(c);
    }

    if (add_quotes) try outbuf.append('\"');
}

pub fn escapeWTF8(str: []const u8, outbuf: *std.ArrayList(u8), comptime add_quotes: bool) !void {
    try outbuf.ensureUnusedCapacity(str.len);

    var bytes: [8]u8 = undefined;
    var n: u3 = if (add_quotes) bun.strings.encodeWTF8Rune(bytes[0..4], '"') else 0;
    if (add_quotes) try outbuf.appendSlice(bytes[0..n]);

    loop: for (str) |c| {
        inline for (BACKSLASHABLE_CHARS) |spc| {
            if (spc == c) {
                n = bun.strings.encodeWTF8Rune(bytes[0..4], '\\');
                var next: [4]u8 = bytes[n..][0..4].*;
                n += bun.strings.encodeWTF8Rune(&next, @intCast(c));
                try outbuf.appendSlice(bytes[0..n]);
                // try outbuf.appendSlice(&.{
                //     '\\',
                //     c,
                // });
                continue :loop;
            }
        }
        n = bun.strings.encodeWTF8Rune(bytes[0..4], @intCast(c));
        try outbuf.appendSlice(bytes[0..n]);
    }

    if (add_quotes) {
        n = bun.strings.encodeWTF8Rune(bytes[0..4], '"');
        try outbuf.appendSlice(bytes[0..n]);
    }
}

pub fn escapeUtf16(str: []const u16, outbuf: *std.ArrayList(u8), comptime add_quotes: bool) !struct { is_invalid: bool = false } {
    if (add_quotes) try outbuf.append('"');

    const non_ascii = bun.strings.firstNonASCII16([]const u16, str) orelse 0;
    var cp_buf: [4]u8 = undefined;

    var i: usize = 0;
    loop: while (i < str.len) {
        const char: u32 = brk: {
            if (i < non_ascii) {
                defer i += 1;
                break :brk str[i];
            }
            const ret = bun.strings.utf16Codepoint([]const u16, str[i..]);
            if (ret.fail) return .{ .is_invalid = true };
            i += ret.len;
            break :brk ret.code_point;
        };

        inline for (BACKSLASHABLE_CHARS) |bchar| {
            if (@as(u32, @intCast(bchar)) == char) {
                try outbuf.appendSlice(&[_]u8{ '\\', @intCast(char) });
                continue :loop;
            }
        }

        const len = bun.strings.encodeWTF8RuneT(&cp_buf, u32, char);
        try outbuf.appendSlice(cp_buf[0..len]);
    }
    if (add_quotes) try outbuf.append('"');
    return .{ .is_invalid = false };
}

pub fn needsEscapeBunstr(bunstr: bun.String) bool {
    if (bunstr.isUTF16()) return needsEscapeUTF16(bunstr.utf16());
    // Otherwise is utf-8, ascii, or latin-1
    return needsEscapeUtf8AsciiLatin1(bunstr.byteSlice());
}

pub fn needsEscapeUTF16(str: []const u16) bool {
    for (str) |codeunit| {
        if (codeunit < 0xff and SPECIAL_CHARS_TABLE.isSet(codeunit)) return true;
    }

    return false;
}

/// Checks for the presence of any char from `SPECIAL_CHARS` in `str`. This
/// indicates the *possibility* that the string must be escaped, so it can have
/// false positives, but it is faster than running the shell lexer through the
/// input string for a more correct implementation.
pub fn needsEscapeUtf8AsciiLatin1(str: []const u8) bool {
    for (str) |c| {
        if (SPECIAL_CHARS_TABLE.isSet(c)) return true;
    }
    return false;
}

/// A list that can store its items inlined, and promote itself to a heap allocated bun.ByteList
pub fn SmolList(comptime T: type, comptime INLINED_MAX: comptime_int) type {
    return union(enum) {
        inlined: Inlined,
        heap: ByteList,

        const ByteList = bun.BabyList(T);

        pub fn initWith(val: T) @This() {
            var this: @This() = @This().zeroes;
            this.inlined.items[0] = val;
            this.inlined.len += 1;
            return this;
        }

        pub fn initWithSlice(vals: []const T) @This() {
            if (bun.Environment.allow_assert) assert(vals.len <= std.math.maxInt(u32));
            if (vals.len <= INLINED_MAX) {
                var this: @This() = @This().zeroes;
                @memcpy(this.inlined.items[0..vals.len], vals);
                this.inlined.len += @intCast(vals.len);
                return this;
            }
            var this: @This() = .{
                .heap = ByteList.initCapacity(bun.default_allocator, vals.len) catch bun.outOfMemory(),
            };
            this.heap.appendSliceAssumeCapacity(vals);
            return this;
        }

        pub fn format(this: *const @This(), comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const slc = this.slice();
            try writer.print("{}", .{slc});
        }

        pub fn jsonStringify(this: *const @This(), writer: anytype) !void {
            const slc = this.slice();
            try writer.write(slc);
        }

        pub const zeroes: @This() = .{
            .inlined = .{},
        };

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

        pub inline fn len(this: *const @This()) usize {
            return switch (this.*) {
                .inlined => this.inlined.len,
                .heap => this.heap.len,
            };
        }

        pub fn orderedRemove(this: *@This(), idx: usize) void {
            switch (this.*) {
                .heap => {
                    _ = this.heap.orderedRemove(idx);
                },
                .inlined => {
                    _ = this.inlined.orderedRemove(idx);
                },
            }
        }

        pub fn swapRemove(this: *@This(), idx: usize) void {
            switch (this.*) {
                .heap => {
                    _ = this.heap.swapRemove(idx);
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
                    bun.copy(T, this.inlined.items[0..starting_idx], slice_to_move);
                    this.inlined.len = @intCast(slice_to_move.len);
                },
                .heap => {
                    const slc = this.heap.ptr[starting_idx..this.heap.len];
                    bun.copy(T, this.heap.ptr[0..slc.len], slc);
                    this.heap.len = @intCast(slc.len);
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

        pub inline fn slice(this: *const @This()) []const T {
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

        pub inline fn getConst(this: *const @This(), idx: usize) *const T {
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

        pub fn last(this: *@This()) ?*T {
            if (this.len() == 0) return null;
            return this.get(this.len() - 1);
        }

        pub fn lastUnchecked(this: *@This()) *T {
            return this.get(this.len() - 1);
        }

        pub fn lastUncheckedConst(this: *const @This()) *const T {
            return this.getConst(this.len() - 1);
        }
    };
}

/// Used in JS tests, see `internal-for-testing.ts` and shell tests.
pub const TestingAPIs = struct {
    pub fn disabledOnThisPlatform(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        if (comptime bun.Environment.isWindows) return JSValue.false;

        const arguments_ = callframe.arguments(1);
        var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
        const string = arguments.nextEat() orelse {
            globalThis.throw("shellInternals.disabledOnPosix: expected 1 arguments, got 0", .{});
            return .undefined;
        };

        const bunstr = string.toBunString(globalThis);
        defer bunstr.deref();
        const utf8str = bunstr.toUTF8(bun.default_allocator);
        defer utf8str.deinit();

        inline for (Interpreter.Builtin.Kind.DISABLED_ON_POSIX) |disabled| {
            if (bun.strings.eqlComptime(utf8str.byteSlice(), @tagName(disabled))) {
                return JSValue.true;
            }
        }
        return JSValue.false;
    }

    pub fn shellLex(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments_ = callframe.arguments(2);
        var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
        const string_args = arguments.nextEat() orelse {
            globalThis.throw("shell_parse: expected 2 arguments, got 0", .{});
            return .undefined;
        };

        var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();

        const template_args_js = arguments.nextEat() orelse {
            globalThis.throw("shell: expected 2 arguments, got 0", .{});
            return .undefined;
        };
        var template_args = template_args_js.arrayIterator(globalThis);
        var stack_alloc = std.heap.stackFallback(@sizeOf(bun.String) * 4, arena.allocator());
        var jsstrings = std.ArrayList(bun.String).initCapacity(stack_alloc.get(), 4) catch {
            globalThis.throwOutOfMemory();
            return .undefined;
        };
        defer {
            for (jsstrings.items[0..]) |bunstr| {
                bunstr.deref();
            }
            jsstrings.deinit();
        }
        var jsobjs = std.ArrayList(JSValue).init(arena.allocator());
        defer {
            for (jsobjs.items) |jsval| {
                jsval.unprotect();
            }
        }

        var script = std.ArrayList(u8).init(arena.allocator());
        if (!(shellCmdFromJS(globalThis, string_args, &template_args, &jsobjs, &jsstrings, &script) catch {
            globalThis.throwOutOfMemory();
            return JSValue.undefined;
        })) {
            return .undefined;
        }

        const lex_result = brk: {
            if (bun.strings.isAllASCII(script.items[0..])) {
                var lexer = LexerAscii.new(arena.allocator(), script.items[0..], jsstrings.items[0..]);
                lexer.lex() catch |err| {
                    globalThis.throwError(err, "failed to lex shell");
                    return JSValue.undefined;
                };
                break :brk lexer.get_result();
            }
            var lexer = LexerUnicode.new(arena.allocator(), script.items[0..], jsstrings.items[0..]);
            lexer.lex() catch |err| {
                globalThis.throwError(err, "failed to lex shell");
                return JSValue.undefined;
            };
            break :brk lexer.get_result();
        };

        if (lex_result.errors.len > 0) {
            const str = lex_result.combineErrors(arena.allocator());
            globalThis.throwPretty("{s}", .{str});
            return .undefined;
        }

        var test_tokens = std.ArrayList(Test.TestToken).initCapacity(arena.allocator(), lex_result.tokens.len) catch {
            globalThis.throwOutOfMemory();
            return JSValue.undefined;
        };
        for (lex_result.tokens) |tok| {
            const test_tok = Test.TestToken.from_real(tok, lex_result.strpool);
            test_tokens.append(test_tok) catch {
                globalThis.throwOutOfMemory();
                return JSValue.undefined;
            };
        }

        const str = std.json.stringifyAlloc(globalThis.bunVM().allocator, test_tokens.items[0..], .{}) catch {
            globalThis.throwOutOfMemory();
            return JSValue.undefined;
        };

        defer globalThis.bunVM().allocator.free(str);
        var bun_str = bun.String.fromBytes(str);
        return bun_str.toJS(globalThis);
    }

    pub fn shellParse(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments_ = callframe.arguments(2);
        var arguments = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());
        const string_args = arguments.nextEat() orelse {
            globalThis.throw("shell_parse: expected 2 arguments, got 0", .{});
            return .undefined;
        };

        var arena = bun.ArenaAllocator.init(bun.default_allocator);
        defer arena.deinit();

        const template_args_js = arguments.nextEat() orelse {
            globalThis.throw("shell: expected 2 arguments, got 0", .{});
            return .undefined;
        };
        var template_args = template_args_js.arrayIterator(globalThis);
        var stack_alloc = std.heap.stackFallback(@sizeOf(bun.String) * 4, arena.allocator());
        var jsstrings = std.ArrayList(bun.String).initCapacity(stack_alloc.get(), 4) catch {
            globalThis.throwOutOfMemory();
            return .undefined;
        };
        defer {
            for (jsstrings.items[0..]) |bunstr| {
                bunstr.deref();
            }
            jsstrings.deinit();
        }
        var jsobjs = std.ArrayList(JSValue).init(arena.allocator());
        defer {
            for (jsobjs.items) |jsval| {
                jsval.unprotect();
            }
        }
        var script = std.ArrayList(u8).init(arena.allocator());
        if (!(shellCmdFromJS(globalThis, string_args, &template_args, &jsobjs, &jsstrings, &script) catch {
            globalThis.throwOutOfMemory();
            return JSValue.undefined;
        })) {
            return .undefined;
        }

        var out_parser: ?Parser = null;
        var out_lex_result: ?LexResult = null;

        const script_ast = Interpreter.parse(arena.allocator(), script.items[0..], jsobjs.items[0..], jsstrings.items[0..], &out_parser, &out_lex_result) catch |err| {
            if (err == ParseError.Lex) {
                if (bun.Environment.allow_assert) assert(out_lex_result != null);
                const str = out_lex_result.?.combineErrors(arena.allocator());
                globalThis.throwPretty("{s}", .{str});
                return .undefined;
            }

            if (out_parser) |*p| {
                const errstr = p.combineErrors();
                globalThis.throwPretty("{s}", .{errstr});
                return .undefined;
            }

            globalThis.throwError(err, "failed to lex/parse shell");
            return .undefined;
        };

        const str = std.json.stringifyAlloc(globalThis.bunVM().allocator, script_ast, .{}) catch {
            globalThis.throwOutOfMemory();
            return JSValue.undefined;
        };

        defer globalThis.bunVM().allocator.free(str);
        var bun_str = bun.String.fromBytes(str);
        return bun_str.toJS(globalThis);
    }
};

const assert = bun.assert;
