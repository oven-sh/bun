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

pub const eval = @import("./interpreter.zig");
pub const interpret = @import("./interpreter.zig");
pub const subproc = @import("./subproc.zig");

pub const EnvMap = interpret.EnvMap;
pub const EnvStr = interpret.EnvStr;
pub const Interpreter = eval.Interpreter;
pub const InterpreterMini = eval.InterpreterMini;
pub const Subprocess = subproc.ShellSubprocess;
pub const SubprocessMini = subproc.ShellSubprocessMini;

const GlobWalker = Glob.GlobWalker_(null, true);
// const GlobWalker = Glob.BunGlobWalker;

pub const SUBSHELL_TODO_ERROR = "Subshells are not implemented, please open GitHub issue.";

/// The strings in this type are allocated with event loop ctx allocator
pub const ShellErr = union(enum) {
    sys: JSC.SystemError,
    custom: []const u8,
    invalid_arguments: struct { val: []const u8 = "" },
    todo: []const u8,

    pub fn newSys(e: Syscall.Error) @This() {
        return .{
            .sys = e.toSystemError(),
        };
    }

    pub fn throwJS(this: @This(), globalThis: *JSC.JSGlobalObject) void {
        switch (this) {
            .sys => {
                const err = this.sys.toErrorInstance(globalThis);
                globalThis.throwValue(err);
            },
            .custom => {
                var str = JSC.ZigString.init(this.custom);
                str.markUTF8();
                const err_value = str.toErrorInstance(globalThis);
                globalThis.vm().throwError(globalThis, err_value);
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
        switch (this) {
            .sys => {
                const err = this.sys;
                const str = std.fmt.allocPrint(bun.default_allocator, "bunsh: {s}: {}", .{ err.message, err.path }) catch bun.outOfMemory();
                bun.Output.prettyErrorln("<r><red>error<r>: Failed to due to error <b>{s}<r>", .{str});
                bun.Global.exit(1);
            },
            .custom => {
                bun.Output.prettyErrorln("<r><red>error<r>: Failed to due to error <b>{s}<r>", .{this.custom});
                bun.Global.exit(1);
            },
            .invalid_arguments => {
                const str = std.fmt.allocPrint(bun.default_allocator, "bunsh: invalid arguments: {s}", .{this.invalid_arguments.val}) catch bun.outOfMemory();
                bun.Output.prettyErrorln("<r><red>error<r>: Failed to due to error <b>{s}<r>", .{str});
                bun.Global.exit(1);
            },
            .todo => {
                bun.Output.prettyErrorln("<r><red>error<r>: Failed to due to error <b>TODO: {s}<r>", .{this.todo});
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
    };
}

pub const ShellError = error{ Init, Process, GlobalThisThrown, Spawn };
pub const ParseError = error{
    Expected,
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

const log = bun.Output.scoped(.SHELL, false);
const logsys = bun.Output.scoped(.SYS, false);

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

    pub inline fn throwInvalidArguments(this: @This(), comptime fmt: []const u8, args: anytype) bun.shell.ShellErr {
        return .{
            .invalid_arguments = .{ .val = std.fmt.allocPrint(this.globalThis.bunVM().allocator, fmt, args) catch bun.outOfMemory() },
        };
    }

    pub inline fn throwTODO(this: @This(), msg: []const u8) bun.shell.ShellErr {
        return .{
            .todo = std.fmt.allocPrint(this.globalThis.bunVM().allocator, "{s}", .{msg}) catch bun.outOfMemory(),
        };
    }

    pub inline fn throwError(this: @This(), err: bun.sys.Error) void {
        this.globalThis.throwValue(err.toJSC(this.globalThis));
    }

    pub inline fn handleError(this: @This(), err: anytype, comptime fmt: []const u8) bun.shell.ShellErr {
        const str = std.fmt.allocPrint(this.globalThis.bunVM().allocator, "{s} " ++ fmt, .{@errorName(err)}) catch bun.outOfMemory();
        return .{
            .custom = str,
        };
    }

    pub inline fn throw(this: @This(), comptime fmt: []const u8, args: anytype) bun.shell.ShellErr {
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

    pub inline fn actuallyThrow(this: @This(), shellerr: bun.shell.ShellErr) void {
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

    // pub inline fn throwShellErr(this: @This(), shell_err: bun.shell.ShellErr

    pub inline fn throwTODO(this: @This(), msg: []const u8) bun.shell.ShellErr {
        return .{
            .todo = std.fmt.allocPrint(this.mini.allocator, "{s}", .{msg}) catch bun.outOfMemory(),
        };
    }

    pub inline fn throwInvalidArguments(this: @This(), comptime fmt: []const u8, args: anytype) bun.shell.ShellErr {
        return .{
            .invalid_arguments = .{ .val = std.fmt.allocPrint(this.allocator(), fmt, args) catch bun.outOfMemory() },
        };
    }

    pub inline fn handleError(this: @This(), err: anytype, comptime fmt: []const u8) bun.shell.ShellErr {
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

    pub inline fn throw(this: @This(), comptime fmt: []const u8, args: anytype) bun.shell.ShellErr {
        const str = std.fmt.allocPrint(this.allocator(), fmt, args) catch bun.outOfMemory();
        return .{
            .custom = str,
        };
    }

    pub inline fn actuallyThrow(this: @This(), shellerr: bun.shell.ShellErr) void {
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
        cond: *Conditional,
        pipeline: *Pipeline,
        cmd: *Cmd,
        subshell: Script,

        pub fn asPipelineItem(this: *Expr) ?PipelineItem {
            return switch (this.*) {
                .assign => .{ .assigns = this.assign },
                .cmd => .{ .cmd = this.cmd },
                .subshell => .{ .subshell = this.subshell },
                else => null,
            };
        }

        pub const Tag = enum { assign, cond, pipeline, cmd, subshell };
    };

    pub const Conditional = struct {
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
        subshell: Script,
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
            __unused: u4 = 0,

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
    };

    pub const Atom = union(Atom.Tag) {
        simple: SimpleAtom,
        compound: CompoundAtom,

        pub const Tag = enum(u8) { simple, compound };

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
                else => return false,
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
    };

    pub const SimpleAtom = union(enum) {
        Var: []const u8,
        Text: []const u8,
        asterisk,
        double_asterisk,
        brace_begin,
        brace_end,
        comma,
        cmd_subst: struct {
            script: Script,
            quoted: bool = false,
        },

        pub fn glob_hint(this: SimpleAtom) bool {
            return switch (this) {
                .asterisk, .double_asterisk => true,
                else => false,
            };
        }

        pub fn mightNeedIO(this: SimpleAtom) bool {
            return switch (this) {
                .asterisk, .double_asterisk, .cmd_subst => true,
                else => false,
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

    pub fn parse(self: *Parser) !AST.Script {
        // Check for subshell syntax which is not supported rn
        for (self.tokens) |tok| {
            switch (tok) {
                .OpenParen => {
                    try self.add_error("Unexpected `(`, subshells are currently not supported right now. Escape the `(` or open a GitHub issue.", .{});
                    return ParseError.Expected;
                },
                .CloseParen => {
                    try self.add_error("Unexpected `(`, subshells are currently not supported right now. Escape the `(` or open a GitHub issue.", .{});
                    return ParseError.Expected;
                },
                else => {},
            }
        }

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
            try stmts.append(try self.parse_stmt());
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
            try exprs.append(expr);
        }

        return .{
            .exprs = exprs.items[0..],
        };
    }

    fn parse_expr(self: *Parser) !AST.Expr {
        return self.parse_cond();
    }

    fn parse_cond(self: *Parser) !AST.Expr {
        var left = try self.parse_pipeline();
        while (self.match_any_comptime(&.{ .DoubleAmpersand, .DoublePipe })) {
            const op: AST.Conditional.Op = op: {
                const previous = @as(TokenTag, self.prev());
                switch (previous) {
                    .DoubleAmpersand => break :op .And,
                    .DoublePipe => break :op .Or,
                    else => unreachable,
                }
            };

            const right = try self.parse_pipeline();
            const conditional = try self.allocate(AST.Conditional, .{ .op = op, .left = left, .right = right });
            left = .{ .cond = conditional };
        }

        return left;
    }

    fn parse_pipeline(self: *Parser) !AST.Expr {
        var expr = try self.parse_subshell();

        if (self.peek() == .Pipe) {
            var pipeline_items = std.ArrayList(AST.PipelineItem).init(self.alloc);
            try pipeline_items.append(expr.asPipelineItem() orelse {
                try self.add_error_expected_pipeline_item(@as(AST.Expr.Tag, expr));
                return ParseError.Expected;
            });

            while (self.match(.Pipe)) {
                expr = try self.parse_subshell();
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

    /// Placeholder for when we fully support subshells
    fn parse_subshell(self: *Parser) anyerror!AST.Expr {
        // if (self.peek() == .OpenParen) {
        //     _ = self.expect(.OpenParen);
        //     const script = try self.parse_impl(true);
        //     _ = self.expect(.CloseParen);
        //     return .{ .subshell = script };
        // }
        // return (try self.parse_cmd_or_assigns()).to_expr(self.alloc);
        return (try self.parse_cmd_or_assigns()).to_expr(self.alloc);
    }

    fn parse_cmd_or_assigns(self: *Parser) !AST.CmdOrAssigns {
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
            self.match_any_comptime(&.{ .Semicolon, .Newline, .Eof })
        else
            self.match_any(&.{ .Semicolon, .Newline, .Eof, self.inside_subshell.?.closing_tok() }))
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

        // TODO Parse redirects (need to update lexer to have tokens for different parts e.g. &>>)
        const has_redirect = self.match(.Redirect);
        const redirect = if (has_redirect) self.prev().Redirect else AST.Cmd.RedirectFlags{};
        const redirect_file: ?AST.Cmd.Redirect = redirect_file: {
            if (has_redirect) {
                if (self.match(.JSObjRef)) {
                    const obj_ref = self.prev().JSObjRef;
                    break :redirect_file .{ .jsbuf = AST.JSBuf.new(obj_ref) };
                }

                const redirect_file = try self.parse_atom() orelse {
                    try self.add_error("Redirection with no file", .{});
                    return ParseError.Expected;
                };
                break :redirect_file .{ .atom = redirect_file };
            }
            break :redirect_file null;
        };
        // TODO check for multiple redirects and error

        return .{ .cmd = .{
            .assigns = assigns.items[0..],
            .name_and_args = name_and_args.items[0..],
            .redirect = redirect,
            .redirect_file = redirect_file,
        } };
    }

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
                            if (self.peek() == .Delimit) {
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
                        _ = self.expect_delimit();
                        break :var_decl .{
                            .label = label,
                            .value = .{ .simple = .{ .Text = txt_value } },
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
                        const script = try subparser.parse_impl();
                        try atoms.append(.{ .cmd_subst = .{
                            .script = script,
                            .quoted = is_quoted,
                        } });
                        self.continue_from_subparser(&subparser);
                        if (self.delimits(self.peek())) {
                            _ = self.match(.Delimit);
                            if (should_break) break;
                        }
                    },
                    .Text => |txtrng| {
                        _ = self.expect(.Text);
                        const txt = self.text(txtrng);
                        try atoms.append(.{ .Text = txt });
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
                    .OpenParen, .CloseParen => {
                        try self.add_error("Unexpected token: `{s}`", .{if (peeked == .OpenParen) "(" else ")"});
                        return null;
                    },
                    else => return null,
                }
            }
        }

        return switch (atoms.items.len) {
            0 => null,
            1 => {
                std.debug.assert(atoms.capacity == 1);
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
        std.debug.assert(toktag == @as(TokenTag, self.peek()));
        if (self.check(toktag)) {
            return self.advance();
        }
        unreachable;
    }

    fn expect_any(self: *Parser, toktags: []const TokenTag) Token {
        // std.debug.assert(toktag == @as(TokenTag, self.peek()));

        const peeked = self.peek();
        for (toktags) |toktag| {
            if (toktag == @as(TokenTag, peeked)) return self.advance();
        }

        unreachable;
    }

    fn delimits(self: *Parser, tok: Token) bool {
        return tok == .Delimit or tok == .Semicolon or tok == .Semicolon or tok == .Eof or (self.inside_subshell != null and tok == self.inside_subshell.?.closing_tok());
    }

    fn expect_delimit(self: *Parser) Token {
        std.debug.assert(self.delimits(self.peek()));
        if (self.check(.Delimit) or self.check(.Semicolon) or self.check(.Newline) or self.check(.Eof) or (self.inside_subshell != null and self.check(self.inside_subshell.?.closing_tok()))) {
            return self.advance();
        }
        unreachable;
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
    Text,
    JSObjRef,
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

    Redirect: AST.Cmd.RedirectFlags,

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
    Text: TextRange,
    JSObjRef: u32,

    Delimit,
    Eof,

    pub const TextRange = struct {
        start: u32,
        end: u32,
    };

    pub fn asHumanReadable(self: Token, strpool: []const u8) []const u8 {
        switch (self) {
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
            .Text => strpool[self.Text.start..self.Text.end],
            .JSObjRef => "JSObjRef",
            .Delimit => "Delimit",
            .Eof => "EOF",
        }
    }

    pub fn debug(self: Token, buf: []const u8) void {
        switch (self) {
            .Var => |txt| {
                std.debug.print("(var) {s}\n", .{buf[txt.start..txt.end]});
            },
            .Text => |txt| {
                std.debug.print("(txt) {s}\n", .{buf[txt.start..txt.end]});
            },
            else => {
                std.debug.print("{s}\n", .{@tagName(self)});
            },
        }
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
pub const LEX_JS_OBJREF_PREFIX = "$__bun_";

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

        pub fn new(alloc: Allocator, src: []const u8) @This() {
            return .{
                .chars = Chars.init(src),
                .tokens = ArrayList(Token).init(alloc),
                .strpool = ArrayList(u8).init(alloc),
                .errors = ArrayList(LexError).init(alloc),
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

                // Handle non-escaped chars:
                // 1. special syntax (operators, etc.)
                // 2. lexing state switchers (quotes)
                // 3. word breakers (spaces, etc.)
                if (!escaped) escaped: {
                    switch (char) {
                        '#' => {
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
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);
                            try self.tokens.append(.Semicolon);
                            continue;
                        },
                        '\n' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);
                            try self.tokens.append(.Newline);
                            continue;
                        },

                        // glob asterisks
                        '*' => {
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
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(false);
                            try self.tokens.append(.BraceBegin);
                            continue;
                        },
                        ',' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(false);
                            try self.tokens.append(.Comma);
                            continue;
                        },
                        '}' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(false);
                            try self.tokens.append(.BraceEnd);
                            continue;
                        },

                        // Command substitution
                        '`' => {
                            if (self.chars.state == .Single) break :escaped;
                            if (self.in_subshell == .backtick) {
                                try self.break_word(true);
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
                            if (self.eat_js_obj_ref()) |ref| {
                                if (self.chars.state == .Double) {
                                    try self.errors.append(.{ .msg = bun.default_allocator.dupe(u8, "JS object reference not allowed in double quotes") catch bun.outOfMemory() });
                                    return;
                                }
                                try self.tokens.append(ref);
                            } else {
                                const var_tok = try self.eat_var();
                                // empty var
                                if (var_tok.start == var_tok.end) {
                                    try self.appendCharToStrPool('$');
                                    try self.break_word(false);
                                } else {
                                    try self.tokens.append(.{ .Var = var_tok });
                                }
                            }
                            self.word_start = self.j;
                            continue;
                        },
                        '(' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);
                            try self.eat_subshell(.normal);
                            continue;
                        },
                        ')' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            if (self.in_subshell != .dollar and self.in_subshell != .normal) {
                                self.add_error("Unexpected ')'");
                                continue;
                            }

                            try self.break_word(true);
                            if (self.last_tok_tag()) |toktag| {
                                if (toktag != .Delimit) try self.tokens.append(.Delimit);
                            }
                            if (self.in_subshell == .dollar) {
                                try self.tokens.append(.CmdSubstEnd);
                            } else if (self.in_subshell == .normal) {
                                try self.tokens.append(.CloseParen);
                            }
                            return;
                        },

                        '0'...'9' => {
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
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);

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
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word_impl(true, false, true);
                            const redirect = self.eat_simple_redirect(.out);
                            try self.tokens.append(.{ .Redirect = redirect });
                            continue;
                        },
                        '<' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word_impl(true, false, true);
                            const redirect = self.eat_simple_redirect(.in);
                            try self.tokens.append(.{ .Redirect = redirect });
                            continue;
                        },
                        '&' => {
                            if (self.chars.state == .Single or self.chars.state == .Double) break :escaped;
                            try self.break_word(true);

                            const next = self.peek() orelse {
                                self.add_error("Unexpected EOF");
                                return;
                            };
                            if (next.char == '>' and !next.escaped) {
                                _ = self.eat();
                                const inner = if (self.eat_simple_redirect_operator(.out))
                                    AST.Cmd.RedirectFlags.@"&>>"()
                                else
                                    AST.Cmd.RedirectFlags.@"&>"();
                                try self.tokens.append(.{ .Redirect = inner });
                            } else if (next.escaped or next.char != '&') {
                                try self.tokens.append(.Ampersand);
                            } else if (next.char == '&') {
                                _ = self.eat() orelse unreachable;
                                try self.tokens.append(.DoubleAmpersand);
                            } else continue;
                        },

                        // 2. State switchers
                        '\'' => {
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

        fn break_word_impl(self: *@This(), add_delimiter: bool, in_normal_space: bool, in_redirect_operator: bool) !void {
            const start: u32 = self.word_start;
            const end: u32 = self.j;
            if (start != end) {
                try self.tokens.append(.{ .Text = .{ .start = start, .end = end } });
                if (add_delimiter) {
                    try self.tokens.append(.Delimit);
                }
            } else if ((in_normal_space or in_redirect_operator) and self.tokens.items.len > 0 and
                switch (self.tokens.items[self.tokens.items.len - 1]) {
                .Var, .Text, .BraceBegin, .Comma, .BraceEnd, .CmdSubstEnd => true,
                else => false,
            }) {
                try self.tokens.append(.Delimit);
                self.delimit_quote = false;
            }
            self.word_start = self.j;
        }

        const RedirectDirection = enum { out, in };

        fn eat_simple_redirect(self: *@This(), dir: RedirectDirection) AST.Cmd.RedirectFlags {
            const is_double = self.eat_simple_redirect_operator(dir);

            if (is_double) {
                return switch (dir) {
                    .out => AST.Cmd.RedirectFlags.@">>"(),
                    .in => AST.Cmd.RedirectFlags.@"<<"(),
                };
            }

            return switch (dir) {
                .out => AST.Cmd.RedirectFlags.@">"(),
                .in => AST.Cmd.RedirectFlags.@"<"(),
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

        fn eat_redirect(self: *@This(), first: InputChar) ?AST.Cmd.RedirectFlags {
            var flags: AST.Cmd.RedirectFlags = .{};
            switch (first.char) {
                '0'...'9' => {
                    // Codepoint int casts are safe here because the digits are in the ASCII range
                    var count: usize = 1;
                    var buf: [32]u8 = [_]u8{@intCast(first.char)} ** 32;

                    while (self.peek()) |peeked| {
                        const char = peeked.char;
                        switch (char) {
                            '0'...'9' => {
                                _ = self.eat();
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
            var sublexer = self.make_sublexer(kind);
            try sublexer.lex();
            self.continue_from_sublexer(&sublexer);
        }

        fn eat_js_obj_ref(self: *@This()) ?Token {
            const snap = self.make_snapshot();
            if (self.eat_literal(u8, LEX_JS_OBJREF_PREFIX)) {
                if (self.eat_number_word()) |num| {
                    if (num <= std.math.maxInt(u32)) {
                        return .{ .JSObjRef = @intCast(num) };
                    }
                }
            }
            self.backtrack(snap);
            return null;
        }

        fn eat_var(self: *@This()) !Token.TextRange {
            const start = self.j;
            var i: usize = 0;
            // Eat until special character
            while (self.peek()) |result| {
                defer i += 1;
                const char = result.char;
                const escaped = result.escaped;

                if (i == 0) {
                    switch (char) {
                        '=', '0'...'9' => return .{ .start = start, .end = self.j },
                        'a'...'z', 'A'...'Z', '_' => {},
                        else => return .{ .start = start, .end = self.j },
                    }
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

        fn debug_tokens(self: *const @This()) void {
            std.debug.print("Tokens: \n", .{});
            for (self.tokens.items, 0..) |tok, i| {
                std.debug.print("{d}: ", .{i});
                tok.debug(self.strpool.items[0..self.strpool.items.len]);
            }
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
        return .{ .char = this.next_cursor.c, .width = this.next_cursor.width };
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
                else => unreachable,
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
        'a'...'z', 'A'...'Z', '_' => {},
        else => return false,
    }

    if (var_name.len - 1 < 16)
        return isValidVarNameSlowAscii(var_name);

    const upper_a: @Vector(16, u8) = @splat('A');
    const upper_z: @Vector(16, u8) = @splat('Z');
    const lower_a: @Vector(16, u8) = @splat('a');
    const lower_z: @Vector(16, u8) = @splat('z');
    const zero: @Vector(16, u8) = @splat(0);
    const nine: @Vector(16, u8) = @splat(9);
    const underscore: @Vector(16, u8) = @splat('_');

    const BoolVec = @Vector(16, u1);

    var i: usize = 0;
    while (i + 16 <= var_name.len) : (i += 16) {
        const chars: @Vector(16, u8) = var_name[i..][0..16].*;

        const in_upper = @as(BoolVec, @bitCast(chars > upper_a)) & @as(BoolVec, @bitCast(chars < upper_z));
        const in_lower = @as(BoolVec, @bitCast(chars > lower_a)) & @as(BoolVec, @bitCast(chars < lower_z));
        const in_digit = @as(BoolVec, @bitCast(chars > zero)) & @as(BoolVec, @bitCast(chars < nine));
        const is_underscore = @as(BoolVec, @bitCast(chars == underscore));

        const merged = @as(@Vector(16, bool), @bitCast(in_upper | in_lower | in_digit | is_underscore));
        if (std.simd.countTrues(merged) != 16) return false;
    }

    return isValidVarNameSlowAscii(var_name[i..]);
}

fn isValidVarNameSlowAscii(var_name: []const u8) bool {
    for (var_name) |c| {
        switch (c) {
            '0'...'9', 'a'...'z', 'A'...'Z', '_' => {},
            else => return false,
        }
    }
    return true;
}

var stderr_mutex = std.Thread.Mutex{};
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
        Redirect: AST.Cmd.RedirectFlags,

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
        Text: []const u8,
        JSObjRef: u32,

        Delimit,
        Eof,

        pub fn from_real(the_token: Token, buf: []const u8) TestToken {
            switch (the_token) {
                .Var => |txt| return .{ .Var = buf[txt.start..txt.end] },
                .Text => |txt| return .{ .Text = buf[txt.start..txt.end] },
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
                .Delimit => return .Delimit,
                .Eof => return .Eof,
            }
        }
    };
};

pub fn shellCmdFromJS(
    globalThis: *JSC.JSGlobalObject,
    string_args: JSValue,
    template_args: []const JSValue,
    out_jsobjs: *std.ArrayList(JSValue),
    out_script: *std.ArrayList(u8),
) !bool {
    var jsobjref_buf: [128]u8 = [_]u8{0} ** 128;

    var string_iter = string_args.arrayIterator(globalThis);
    var i: u32 = 0;
    const last = string_iter.len -| 1;
    while (string_iter.next()) |js_value| {
        defer i += 1;
        if (!try appendJSValueStr(globalThis, js_value, out_script, false)) {
            globalThis.throw("Shell script string contains invalid UTF-16", .{});
            return false;
        }
        // const str = js_value.getZigString(globalThis);
        // try script.appendSlice(str.full());
        if (i < last) {
            const template_value = template_args[i];
            if (!(try handleTemplateValue(globalThis, template_value, out_jsobjs, out_script, jsobjref_buf[0..]))) return false;
        }
    }
    return true;
}

pub fn handleTemplateValue(
    globalThis: *JSC.JSGlobalObject,
    template_value: JSValue,
    out_jsobjs: *std.ArrayList(JSValue),
    out_script: *std.ArrayList(u8),
    jsobjref_buf: []u8,
) !bool {
    if (!template_value.isEmpty()) {
        if (template_value.asArrayBuffer(globalThis)) |array_buffer| {
            _ = array_buffer;
            const idx = out_jsobjs.items.len;
            template_value.protect();
            try out_jsobjs.append(template_value);
            const slice = try std.fmt.bufPrint(jsobjref_buf[0..], "{s}{d}", .{ bun.shell.LEX_JS_OBJREF_PREFIX, idx });
            try out_script.appendSlice(slice);
            return true;
        }

        if (template_value.as(JSC.WebCore.Blob)) |blob| {
            if (blob.store) |store| {
                if (store.data == .file) {
                    if (store.data.file.pathlike == .path) {
                        const path = store.data.file.pathlike.path.slice();
                        if (!try appendUTF8Text(path, out_script, true)) {
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
            if (!try appendJSValueStr(globalThis, template_value, out_script, true)) {
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
                if (!(try handleTemplateValue(globalThis, arr, out_jsobjs, out_script, jsobjref_buf))) return false;
                if (i < last) {
                    const str = bun.String.init(" ");
                    if (!try appendBunStr(str, out_script, false)) return false;
                }
            }
            return true;
        }

        if (template_value.isObject()) {
            if (template_value.getTruthy(globalThis, "raw")) |maybe_str| {
                const bunstr = maybe_str.toBunString(globalThis);
                defer bunstr.deref();
                if (!try appendBunStr(bunstr, out_script, false)) {
                    globalThis.throw("Shell script string contains invalid UTF-16", .{});
                    return false;
                }
                return true;
            }
        }

        if (template_value.isPrimitive()) {
            if (!try appendJSValueStr(globalThis, template_value, out_script, true)) {
                globalThis.throw("Shell script string contains invalid UTF-16", .{});
                return false;
            }
            return true;
        }

        if (template_value.implementsToString(globalThis)) {
            if (!try appendJSValueStr(globalThis, template_value, out_script, true)) {
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

/// This will disallow invalid surrogate pairs
pub fn appendJSValueStr(globalThis: *JSC.JSGlobalObject, jsval: JSValue, outbuf: *std.ArrayList(u8), comptime allow_escape: bool) !bool {
    const bunstr = jsval.toBunString(globalThis);
    defer bunstr.deref();

    return try appendBunStr(bunstr, outbuf, allow_escape);
}

pub fn appendUTF8Text(slice: []const u8, outbuf: *std.ArrayList(u8), comptime allow_escape: bool) !bool {
    if (!bun.simdutf.validate.utf8(slice)) {
        return false;
    }

    if (allow_escape and needsEscape(slice)) {
        try escape(slice, outbuf);
    } else {
        try outbuf.appendSlice(slice);
    }

    return true;
}

pub fn appendBunStr(bunstr: bun.String, outbuf: *std.ArrayList(u8), comptime allow_escape: bool) !bool {
    const str = bunstr.toUTF8WithoutRef(bun.default_allocator);
    defer str.deinit();

    // TODO: toUTF8 already validates. We shouldn't have to do this twice!
    const is_ascii = str.isAllocated();
    if (!is_ascii and !bun.simdutf.validate.utf8(str.slice())) {
        return false;
    }

    if (allow_escape and needsEscape(str.slice())) {
        try escape(str.slice(), outbuf);
    } else {
        try outbuf.appendSlice(str.slice());
    }

    return true;
}

/// Characters that need to escaped
const SPECIAL_CHARS = [_]u8{ '$', '>', '&', '|', '=', ';', '\n', '{', '}', ',', '(', ')', '\\', '\"', ' ' };
/// Characters that need to be backslashed inside double quotes
const BACKSLASHABLE_CHARS = [_]u8{ '$', '`', '"', '\\' };

/// assumes WTF-8
pub fn escape(str: []const u8, outbuf: *std.ArrayList(u8)) !void {
    try outbuf.ensureUnusedCapacity(str.len);

    try outbuf.append('\"');

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

    try outbuf.append('\"');
}

pub fn escapeUnicode(str: []const u8, outbuf: *std.ArrayList(u8)) !void {
    try outbuf.ensureUnusedCapacity(str.len);

    var bytes: [8]u8 = undefined;
    var n = bun.strings.encodeWTF8Rune(bytes[0..4], '"');
    try outbuf.appendSlice(bytes[0..n]);

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

    n = bun.strings.encodeWTF8Rune(bytes[0..4], '"');
    try outbuf.appendSlice(bytes[0..n]);
}

pub fn needsEscapeUTF16(str: []const u16) bool {
    for (str) |char| {
        switch (char) {
            '$', '>', '&', '|', '=', ';', '\n', '{', '}', ',', '(', ')', '\\', '\"', ' ' => return true,
            else => {},
        }
    }

    return false;
}

/// Checks for the presence of any char from `SPECIAL_CHARS` in `str`. This
/// indicates the *possibility* that the string must be escaped, so it can have
/// false positives, but it is faster than running the shell lexer through the
/// input string for a more correct implementation.
pub fn needsEscape(str: []const u8) bool {
    if (str.len < 128) return needsEscapeSlow(str);

    const needles = comptime brk: {
        var needles: [SPECIAL_CHARS.len]@Vector(16, u8) = undefined;
        for (SPECIAL_CHARS, 0..) |c, i| {
            needles[i] = @splat(c);
        }
        break :brk needles;
    };

    var i: usize = 0;
    while (i + 16 <= str.len) : (i += 16) {
        const haystack: @Vector(16, u8) = str[i..][0..16].*;

        inline for (needles) |needle| {
            const result = haystack == needle;
            if (std.simd.firstTrue(result) != null) return true;
        }
    }

    if (i < str.len) return needsEscapeSlow(str[i..]);

    return false;
}

pub fn needsEscapeSlow(str: []const u8) bool {
    for (str) |c| {
        inline for (SPECIAL_CHARS) |spc| {
            if (spc == c) return true;
        }
    }
    return false;
}
