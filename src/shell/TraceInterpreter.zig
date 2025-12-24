//! The trace interpreter simulates shell execution without actually running commands.
//! It walks the AST and collects information about what permissions would be needed
//! and what file paths would be accessed.
//!
//! This is used for a permission system where users can inspect what a shell command
//! would do before actually executing it.

/// Unix-style permission flags using standard octal values
/// These mirror the constants used by open(2), chmod(2), and access(2)
pub const Permission = struct {
    /// Standard Unix permission bits (octal)
    pub const O_RDONLY: u32 = 0o0; // Read only
    pub const O_WRONLY: u32 = 0o1; // Write only
    pub const O_RDWR: u32 = 0o2; // Read and write
    pub const O_CREAT: u32 = 0o100; // Create file if it doesn't exist
    pub const O_EXCL: u32 = 0o200; // Fail if file exists (with O_CREAT)
    pub const O_TRUNC: u32 = 0o1000; // Truncate file to zero length
    pub const O_APPEND: u32 = 0o2000; // Append to file

    /// Extended operation flags (using higher bits to avoid conflicts)
    pub const X_OK: u32 = 0o100000; // Execute permission / run command
    pub const DELETE: u32 = 0o200000; // Delete file or directory
    pub const MKDIR: u32 = 0o400000; // Create directory
    pub const CHDIR: u32 = 0o1000000; // Change directory
    pub const ENV: u32 = 0o2000000; // Modify environment

    /// Convenience combinations
    pub const READ: u32 = O_RDONLY;
    pub const WRITE: u32 = O_WRONLY;
    pub const READ_WRITE: u32 = O_RDWR;
    pub const CREATE: u32 = O_CREAT | O_WRONLY;
    pub const CREATE_TRUNC: u32 = O_CREAT | O_TRUNC | O_WRONLY;
    pub const APPEND: u32 = O_APPEND | O_WRONLY;
    pub const EXECUTE: u32 = X_OK;
};

/// Standard stream identifiers for redirections
pub const Stream = enum(u8) {
    none = 0, // Not a stream redirection (e.g., file read, execute)
    stdin = 1,
    stdout = 2,
    stderr = 3,

    pub fn toJS(this: Stream, globalThis: *JSGlobalObject) JSValue {
        return switch (this) {
            .none => .null,
            .stdin => bun.String.static("stdin").toJS(globalThis),
            .stdout => bun.String.static("stdout").toJS(globalThis),
            .stderr => bun.String.static("stderr").toJS(globalThis),
        };
    }
};

/// Represents a single traced operation
pub const TracedOperation = struct {
    /// The permission flags required (octal, like open/chmod)
    flags: u32,
    /// Absolute path that would be accessed (null for non-path operations)
    path: ?[]const u8,
    /// The command name (for execute operations)
    command: ?[]const u8,
    /// Working directory at time of operation
    cwd: []const u8,
    /// Environment variable name (for modify_env operations)
    env_var: ?[]const u8,
    /// Which standard stream is being redirected (if any)
    stream: Stream,

    pub fn deinit(this: *TracedOperation, allocator: Allocator) void {
        if (this.path) |p| allocator.free(p);
        if (this.command) |c| allocator.free(c);
        allocator.free(this.cwd);
        if (this.env_var) |e| allocator.free(e);
    }

    pub fn toJS(this: *const TracedOperation, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        var obj = jsc.JSValue.createEmptyObject(globalThis, 6);

        // Return flags as integer (octal value)
        obj.put(
            globalThis,
            bun.String.static("flags"),
            jsc.JSValue.jsNumber(@as(i32, @intCast(this.flags))),
        );

        if (this.path) |p| {
            obj.put(
                globalThis,
                bun.String.static("path"),
                bun.String.init(p).toJS(globalThis),
            );
        } else {
            obj.put(globalThis, bun.String.static("path"), .null);
        }

        if (this.command) |c| {
            obj.put(
                globalThis,
                bun.String.static("command"),
                bun.String.init(c).toJS(globalThis),
            );
        } else {
            obj.put(globalThis, bun.String.static("command"), .null);
        }

        obj.put(
            globalThis,
            bun.String.static("cwd"),
            bun.String.init(this.cwd).toJS(globalThis),
        );

        if (this.env_var) |e| {
            obj.put(
                globalThis,
                bun.String.static("envVar"),
                bun.String.init(e).toJS(globalThis),
            );
        } else {
            obj.put(globalThis, bun.String.static("envVar"), .null);
        }

        // Stream redirection (stdin, stdout, stderr, or null)
        obj.put(
            globalThis,
            bun.String.static("stream"),
            this.stream.toJS(globalThis),
        );

        return obj;
    }
};

/// Result of tracing a shell script
pub const TraceResult = struct {
    /// All traced operations
    operations: std.array_list.Managed(TracedOperation),
    /// The working directory
    cwd: []const u8,
    /// Whether tracing was successful
    success: bool,
    /// Error message if tracing failed
    error_message: ?[]const u8,
    /// Allocator used for this result
    allocator: Allocator,

    pub fn init(allocator: Allocator, cwd: []const u8) TraceResult {
        return .{
            .operations = std.array_list.Managed(TracedOperation).init(allocator),
            .cwd = bun.handleOom(allocator.dupe(u8, cwd)),
            .success = true,
            .error_message = null,
            .allocator = allocator,
        };
    }

    pub fn deinit(this: *TraceResult) void {
        for (this.operations.items) |*op| {
            op.deinit(this.allocator);
        }
        this.operations.deinit();
        this.allocator.free(this.cwd);
        if (this.error_message) |msg| {
            this.allocator.free(msg);
        }
    }

    pub fn addOperation(this: *TraceResult, op: TracedOperation) void {
        bun.handleOom(this.operations.append(op));
    }

    pub fn setError(this: *TraceResult, msg: []const u8) void {
        this.success = false;
        this.error_message = bun.handleOom(this.allocator.dupe(u8, msg));
    }

    pub fn toJS(this: *const TraceResult, globalThis: *JSGlobalObject) bun.JSError!JSValue {
        var result_obj = jsc.JSValue.createEmptyObject(globalThis, 4);

        // Create operations array
        const ops_array = try jsc.JSValue.createEmptyArray(globalThis, this.operations.items.len);
        for (this.operations.items, 0..) |*op, i| {
            const op_js = try op.toJS(globalThis);
            try ops_array.putIndex(globalThis, @intCast(i), op_js);
        }
        result_obj.put(globalThis, bun.String.static("operations"), ops_array);

        // Add cwd
        result_obj.put(
            globalThis,
            bun.String.static("cwd"),
            bun.String.init(this.cwd).toJS(globalThis),
        );

        // Add success
        result_obj.put(
            globalThis,
            bun.String.static("success"),
            jsc.JSValue.jsBoolean(this.success),
        );

        // Add error if present
        if (this.error_message) |msg| {
            result_obj.put(
                globalThis,
                bun.String.static("error"),
                bun.String.init(msg).toJS(globalThis),
            );
        } else {
            result_obj.put(globalThis, bun.String.static("error"), .null);
        }

        return result_obj;
    }
};

/// TraceContext holds state during trace interpretation
pub const TraceContext = struct {
    allocator: Allocator,
    result: *TraceResult,
    /// Current working directory during trace
    cwd: std.array_list.Managed(u8),
    /// Shell environment for variable expansion
    shell_env: EnvMap,
    /// Exported environment (for subprocess)
    export_env: EnvMap,
    /// JS objects from template
    jsobjs: []JSValue,
    globalThis: *JSGlobalObject,

    pub fn init(
        allocator: Allocator,
        result: *TraceResult,
        cwd: []const u8,
        export_env: ?EnvMap,
        jsobjs: []JSValue,
        globalThis: *JSGlobalObject,
    ) TraceContext {
        var ctx = TraceContext{
            .allocator = allocator,
            .result = result,
            .cwd = std.array_list.Managed(u8).init(allocator),
            .shell_env = EnvMap.init(allocator),
            .export_env = if (export_env) |e| e else EnvMap.init(allocator),
            .jsobjs = jsobjs,
            .globalThis = globalThis,
        };
        bun.handleOom(ctx.cwd.appendSlice(cwd));
        return ctx;
    }

    pub fn deinit(this: *TraceContext) void {
        this.cwd.deinit();
        this.shell_env.deinit();
        this.export_env.deinit();
    }

    pub fn cwdSlice(this: *const TraceContext) []const u8 {
        return this.cwd.items;
    }

    pub fn resolvePath(this: *TraceContext, path: []const u8) []const u8 {
        if (ResolvePath.Platform.auto.isAbsolute(path)) {
            return bun.handleOom(this.allocator.dupe(u8, path));
        }
        // Join with cwd
        const parts: []const []const u8 = &.{ this.cwdSlice(), path };
        const joined = ResolvePath.joinZ(parts, .auto);
        return bun.handleOom(this.allocator.dupe(u8, joined[0..joined.len]));
    }

    pub fn addOperation(this: *TraceContext, flags: u32, path: ?[]const u8, command: ?[]const u8, env_var: ?[]const u8) void {
        this.addOperationWithStream(flags, path, command, env_var, .none);
    }

    pub fn addOperationWithStream(this: *TraceContext, flags: u32, path: ?[]const u8, command: ?[]const u8, env_var: ?[]const u8, stream: Stream) void {
        const resolved_path = if (path) |p| this.resolvePath(p) else null;
        this.result.addOperation(.{
            .flags = flags,
            .path = resolved_path,
            .command = if (command) |c| bun.handleOom(this.allocator.dupe(u8, c)) else null,
            .cwd = bun.handleOom(this.allocator.dupe(u8, this.cwdSlice())),
            .env_var = if (env_var) |e| bun.handleOom(this.allocator.dupe(u8, e)) else null,
            .stream = stream,
        });
    }

    pub fn getVar(this: *TraceContext, name: []const u8) ?[]const u8 {
        const key = EnvStr.initSlice(name);
        if (this.shell_env.get(key)) |v| {
            return v.slice();
        }
        if (this.export_env.get(key)) |v| {
            return v.slice();
        }
        return null;
    }

    pub fn changeCwd(this: *TraceContext, new_cwd: []const u8) void {
        // Just update the context's cwd - don't add an operation
        // (the caller is responsible for adding the CHDIR operation if needed)
        if (ResolvePath.Platform.auto.isAbsolute(new_cwd)) {
            this.cwd.clearRetainingCapacity();
            bun.handleOom(this.cwd.appendSlice(new_cwd));
        } else {
            bun.handleOom(this.cwd.append('/'));
            bun.handleOom(this.cwd.appendSlice(new_cwd));
        }
    }
};

// =============================================================================
// AST Walking Functions
// =============================================================================

pub fn traceScript(ctx: *TraceContext, script: *const ast.Script) void {
    for (script.stmts) |*stmt| {
        traceStmt(ctx, stmt);
    }
}

fn traceStmt(ctx: *TraceContext, stmt: *const ast.Stmt) void {
    // Stmt is a struct with exprs field, not a union
    for (stmt.exprs) |*expr| {
        traceExpr(ctx, expr);
    }
}

fn traceExpr(ctx: *TraceContext, expr: *const ast.Expr) void {
    switch (expr.*) {
        .cmd => |cmd| traceCmd(ctx, cmd),
        .assign => |assigns| {
            for (assigns) |*assign| {
                traceAssign(ctx, assign);
            }
        },
        .binary => |binary| traceBinary(ctx, binary),
        .pipeline => |pipeline| tracePipeline(ctx, pipeline),
        .subshell => |subshell| traceSubshell(ctx, &subshell.script),
        .@"if" => |if_clause| traceIfClause(ctx, if_clause),
        .condexpr => |condexpr| traceCondExpr(ctx, condexpr),
        .async => |async_expr| traceExpr(ctx, async_expr),
    }
}

fn traceSubshell(ctx: *TraceContext, script: *const ast.Script) void {
    // Save current cwd - subshell changes shouldn't affect parent
    const saved_cwd = bun.handleOom(ctx.allocator.dupe(u8, ctx.cwdSlice()));
    defer ctx.allocator.free(saved_cwd);

    traceScript(ctx, script);

    // Restore cwd after subshell
    ctx.cwd.clearRetainingCapacity();
    bun.handleOom(ctx.cwd.appendSlice(saved_cwd));
}

fn traceAssign(ctx: *TraceContext, assign: *const ast.Assign) void {
    _ = assign;
    // Track that we're modifying environment
    ctx.addOperation(Permission.ENV, null, null, null);
}

fn traceBinary(ctx: *TraceContext, binary: *const ast.Binary) void {
    traceExpr(ctx, &binary.left);
    traceExpr(ctx, &binary.right);
}

fn tracePipeline(ctx: *TraceContext, pipeline: *const ast.Pipeline) void {
    for (pipeline.items) |*item| {
        tracePipelineItem(ctx, item);
    }
}

fn tracePipelineItem(ctx: *TraceContext, item: *const ast.PipelineItem) void {
    switch (item.*) {
        .cmd => |cmd| traceCmd(ctx, cmd),
        .assigns => |assigns| {
            for (assigns) |*assign| {
                traceAssign(ctx, assign);
            }
        },
        .subshell => |subshell| traceSubshell(ctx, &subshell.script),
        .@"if" => |if_clause| traceIfClause(ctx, if_clause),
        .condexpr => |condexpr| traceCondExpr(ctx, condexpr),
    }
}

fn traceIfClause(ctx: *TraceContext, if_clause: *const ast.If) void {
    // Trace the condition statements
    for (if_clause.cond.slice()) |*stmt| {
        traceStmt(ctx, stmt);
    }
    // Trace the then branch statements
    for (if_clause.then.slice()) |*stmt| {
        traceStmt(ctx, stmt);
    }
    // Trace the else parts
    // else_parts is a SmolList of SmolList(Stmt, 1)
    // Length 0 = no else, length 1 = just else, length 2n = elif/then pairs, length 2n+1 = elif/then pairs + else
    for (if_clause.else_parts.slice()) |*part| {
        for (part.slice()) |*stmt| {
            traceStmt(ctx, stmt);
        }
    }
}

fn traceCondExpr(ctx: *TraceContext, cond: *const ast.CondExpr) void {
    const op = cond.op;
    // File test operators (single argument)
    const is_file_test = op == .@"-e" or op == .@"-f" or op == .@"-d" or
        op == .@"-r" or op == .@"-w" or op == .@"-x" or
        op == .@"-s" or op == .@"-L" or op == .@"-h" or
        op == .@"-b" or op == .@"-c" or op == .@"-g" or
        op == .@"-k" or op == .@"-p" or op == .@"-u" or
        op == .@"-O" or op == .@"-G" or op == .@"-S" or
        op == .@"-a" or op == .@"-N";

    // File comparison operators (two arguments)
    const is_file_comparison = op == .@"-ef" or op == .@"-nt" or op == .@"-ot";

    if (is_file_test or is_file_comparison) {
        // Expand all arguments and add read operations for file paths
        for (cond.args.slice()) |*arg| {
            const path = expandAtom(ctx, arg);
            if (path.len > 0) {
                ctx.addOperation(Permission.READ, path, null, null);
            }
            ctx.allocator.free(path);
        }
    }
}

/// Information about a command's redirections
const RedirectInfo = struct {
    /// Path for stdin redirection (if any)
    stdin_path: ?[]const u8 = null,
    /// Path for stdout redirection (if any)
    stdout_path: ?[]const u8 = null,
    /// Flags for stdout redirection
    stdout_flags: u32 = 0,
    /// Path for stderr redirection (if any)
    stderr_path: ?[]const u8 = null,
    /// Flags for stderr redirection
    stderr_flags: u32 = 0,
};

fn traceCmd(ctx: *TraceContext, cmd: *const ast.Cmd) void {
    // First, trace any assignments
    for (cmd.assigns) |*assign| {
        traceAssign(ctx, assign);
    }

    // Expand the command name and arguments
    if (cmd.name_and_args.len == 0) {
        return;
    }

    const cmd_name = expandAtom(ctx, &cmd.name_and_args[0]);
    defer ctx.allocator.free(cmd_name);

    if (cmd_name.len == 0) {
        return;
    }

    // Get redirection info first
    const redir = getRedirectInfo(ctx, cmd);
    defer {
        if (redir.stdin_path) |p| ctx.allocator.free(p);
        if (redir.stdout_path) |p| ctx.allocator.free(p);
        if (redir.stderr_path) |p| ctx.allocator.free(p);
    }

    // Check for known commands (builtins) and map them to permissions
    // Use stringToEnum directly to recognize all known commands, even if they're
    // disabled as builtins on this platform (e.g., cat/cp on POSIX)
    if (std.meta.stringToEnum(Interpreter.Builtin.Kind, cmd_name)) |builtin_kind| {
        traceBuiltin(ctx, builtin_kind, cmd, &redir);
    } else {
        // External command - needs execute permission
        traceExternalCommand(ctx, cmd_name, cmd, &redir);
    }
}

/// Expand command arguments and extract file paths (skipping flags).
/// Returns a list of expanded file paths. Caller owns the returned memory.
/// Handles brace expansion, so {a,b}.txt becomes a.txt and b.txt.
fn extractFileArgs(ctx: *TraceContext, cmd: *const ast.Cmd) std.array_list.Managed([]const u8) {
    var file_args = std.array_list.Managed([]const u8).init(ctx.allocator);

    for (cmd.name_and_args[1..]) |*arg| {
        var expanded_list = expandAtomMultiple(ctx, arg);
        defer expanded_list.deinit();

        for (expanded_list.items) |expanded| {
            if (expanded.len > 0 and expanded[0] != '-') {
                // Keep this path - transfer ownership
                bun.handleOom(file_args.append(expanded));
            } else {
                ctx.allocator.free(expanded);
            }
        }
    }

    return file_args;
}

/// Free a list of file args
fn freeFileArgs(ctx: *TraceContext, file_args: *std.array_list.Managed([]const u8)) void {
    for (file_args.items) |path| {
        ctx.allocator.free(path);
    }
    file_args.deinit();
}

/// Add redirections as operations with stream info
fn traceRedirections(ctx: *TraceContext, redir: *const RedirectInfo) void {
    if (redir.stdin_path) |stdin| {
        ctx.addOperationWithStream(Permission.READ, stdin, null, null, .stdin);
    }
    if (redir.stdout_path) |out| {
        ctx.addOperationWithStream(redir.stdout_flags, out, null, null, .stdout);
    }
    if (redir.stderr_path) |err_path| {
        ctx.addOperationWithStream(redir.stderr_flags, err_path, null, null, .stderr);
    }
}

fn traceBuiltin(ctx: *TraceContext, kind: Interpreter.Builtin.Kind, cmd: *const ast.Cmd, redir: *const RedirectInfo) void {
    // Builtins run in-process, so they don't need EXECUTE permission on a binary.
    // We only trace the file operations they perform.

    switch (kind) {
        .cat => {
            // cat reads files and writes to stdout (or redirect)
            var file_args = extractFileArgs(ctx, cmd);
            defer freeFileArgs(ctx, &file_args);

            for (file_args.items) |path| {
                ctx.addOperation(Permission.READ, path, null, null);
            }
            traceRedirections(ctx, redir);
        },
        .touch => {
            // touch creates/modifies files
            var file_args = extractFileArgs(ctx, cmd);
            defer freeFileArgs(ctx, &file_args);

            for (file_args.items) |path| {
                ctx.addOperation(Permission.CREATE, path, null, null);
            }
        },
        .mkdir => {
            // mkdir creates directories
            var file_args = extractFileArgs(ctx, cmd);
            defer freeFileArgs(ctx, &file_args);

            for (file_args.items) |path| {
                ctx.addOperation(Permission.MKDIR, path, null, null);
            }
        },
        .rm => {
            // rm deletes files/directories
            var file_args = extractFileArgs(ctx, cmd);
            defer freeFileArgs(ctx, &file_args);

            for (file_args.items) |path| {
                ctx.addOperation(Permission.DELETE, path, null, null);
            }
        },
        .mv => {
            // mv moves files (read+delete source, create dest)
            var file_args = extractFileArgs(ctx, cmd);
            defer freeFileArgs(ctx, &file_args);

            if (file_args.items.len >= 1) {
                ctx.addOperation(Permission.READ | Permission.DELETE, file_args.items[0], null, null);
            }
            if (file_args.items.len >= 2) {
                ctx.addOperation(Permission.CREATE, file_args.items[1], null, null);
            }
        },
        .cp => {
            // cp copies files (read source, create dest)
            var file_args = extractFileArgs(ctx, cmd);
            defer freeFileArgs(ctx, &file_args);

            if (file_args.items.len >= 1) {
                ctx.addOperation(Permission.READ, file_args.items[0], null, null);
            }
            if (file_args.items.len >= 2) {
                ctx.addOperation(Permission.CREATE, file_args.items[1], null, null);
            }
        },
        .ls => {
            // ls reads directory contents and writes to stdout (or redirect)
            var file_args = extractFileArgs(ctx, cmd);
            defer freeFileArgs(ctx, &file_args);

            if (file_args.items.len == 0) {
                // ls with no args reads current directory
                ctx.addOperation(Permission.READ, ".", null, null);
            } else {
                for (file_args.items) |path| {
                    ctx.addOperation(Permission.READ, path, null, null);
                }
            }
            traceRedirections(ctx, redir);
        },
        .cd => {
            // cd changes directory - takes first non-flag arg
            var file_args = extractFileArgs(ctx, cmd);
            defer freeFileArgs(ctx, &file_args);

            if (file_args.items.len >= 1) {
                ctx.addOperation(Permission.CHDIR, file_args.items[0], null, null);
                // Actually update the context's cwd for subsequent commands
                ctx.changeCwd(file_args.items[0]);
            }
        },
        .@"export" => {
            // export modifies environment
            ctx.addOperation(Permission.ENV, null, null, null);
        },
        .echo, .pwd, .which, .yes, .seq, .dirname, .basename => {
            // These only write to stdout (or redirect) - no file reads
            traceRedirections(ctx, redir);
        },
        .exit, .true, .false => {
            // These don't access any files
        },
    }
}

fn traceExternalCommand(ctx: *TraceContext, cmd_name: []const u8, cmd: *const ast.Cmd, redir: *const RedirectInfo) void {
    _ = cmd;
    // Resolve the command path using which
    // Get PATH from environment
    const path_env = ctx.getVar("PATH") orelse "/usr/bin:/bin";
    var path_buf: bun.PathBuffer = undefined;
    const resolved = which(&path_buf, path_env, ctx.cwdSlice(), cmd_name);

    // Record the command execution
    if (resolved) |exe_path| {
        ctx.addOperation(Permission.EXECUTE, exe_path, cmd_name, null);
    } else {
        // Command not found, but still record the execute attempt
        ctx.addOperation(Permission.EXECUTE, null, cmd_name, null);
    }

    // Handle stdin redirection
    if (redir.stdin_path) |stdin| {
        ctx.addOperationWithStream(Permission.READ, stdin, null, null, .stdin);
    }

    // Handle stdout redirection
    if (redir.stdout_path) |out| {
        ctx.addOperationWithStream(redir.stdout_flags, out, null, null, .stdout);
    }

    // Handle stderr redirection
    if (redir.stderr_path) |err_path| {
        ctx.addOperationWithStream(redir.stderr_flags, err_path, null, null, .stderr);
    }
}

fn getRedirectInfo(ctx: *TraceContext, cmd: *const ast.Cmd) RedirectInfo {
    var info = RedirectInfo{};

    if (cmd.redirect_file) |redirect| {
        switch (redirect) {
            .atom => |*atom| {
                const path = expandAtom(ctx, atom);
                if (path.len > 0) {
                    if (cmd.redirect.stdin) {
                        info.stdin_path = path;
                    } else {
                        const flags = if (cmd.redirect.append) Permission.APPEND else Permission.CREATE_TRUNC;
                        // Handle stdout and stderr separately
                        if (cmd.redirect.stdout and cmd.redirect.stderr) {
                            // &> or similar - both go to same file
                            info.stdout_path = path;
                            info.stdout_flags = flags;
                            // Also set stderr to same path (duplicate the path)
                            info.stderr_path = bun.handleOom(ctx.allocator.dupe(u8, path));
                            info.stderr_flags = flags;
                        } else if (cmd.redirect.stdout) {
                            info.stdout_path = path;
                            info.stdout_flags = flags;
                        } else if (cmd.redirect.stderr) {
                            info.stderr_path = path;
                            info.stderr_flags = flags;
                        } else {
                            ctx.allocator.free(path);
                        }
                    }
                } else {
                    ctx.allocator.free(path);
                }
            },
            .jsbuf => {
                // JS buffer redirections don't involve file paths
            },
        }
    }

    return info;
}

// =============================================================================
// Expansion (simplified for tracing)
// =============================================================================

/// Expand an atom, potentially returning multiple strings due to brace expansion.
/// Returns a list of expanded strings. Caller owns the memory.
fn expandAtomMultiple(ctx: *TraceContext, atom: *const ast.Atom) std.array_list.Managed([]const u8) {
    var result = std.array_list.Managed(u8).init(ctx.allocator);
    var has_braces = false;

    switch (atom.*) {
        .simple => |*simple| {
            if (simple.* == .brace_begin) has_braces = true;
            expandSimple(ctx, simple, &result);
        },
        .compound => |compound| {
            for (compound.atoms) |*simple| {
                if (simple.* == .brace_begin) has_braces = true;
                expandSimple(ctx, simple, &result);
            }
        },
    }

    const expanded_str = result.toOwnedSlice() catch "";

    // If there are braces, expand them
    if (has_braces and expanded_str.len > 0) {
        const expanded = expandBraces(ctx, expanded_str);
        ctx.allocator.free(expanded_str);
        return expanded;
    }

    // No braces - return single result
    var out = std.array_list.Managed([]const u8).init(ctx.allocator);
    if (expanded_str.len > 0) {
        bun.handleOom(out.append(expanded_str));
    } else {
        ctx.allocator.free(expanded_str);
    }
    return out;
}

/// Expand brace patterns like {a,b,c} into multiple strings
fn expandBraces(ctx: *TraceContext, input: []const u8) std.array_list.Managed([]const u8) {
    var out = std.array_list.Managed([]const u8).init(ctx.allocator);

    // Use arena for temporary allocations
    var arena = std.heap.ArenaAllocator.init(ctx.allocator);
    defer arena.deinit();
    const arena_alloc = arena.allocator();

    // Tokenize the brace pattern
    const lexer_output = Braces.Lexer.tokenize(arena_alloc, input) catch {
        // On error, return input as-is
        bun.handleOom(out.append(bun.handleOom(ctx.allocator.dupe(u8, input))));
        return out;
    };

    const expansion_count = Braces.calculateExpandedAmount(lexer_output.tokens.items[0..]);
    if (expansion_count == 0) {
        // No expansion needed
        bun.handleOom(out.append(bun.handleOom(ctx.allocator.dupe(u8, input))));
        return out;
    }

    // Allocate expanded strings
    const expanded_strings = arena_alloc.alloc(std.array_list.Managed(u8), expansion_count) catch {
        bun.handleOom(out.append(bun.handleOom(ctx.allocator.dupe(u8, input))));
        return out;
    };

    for (0..expansion_count) |i| {
        expanded_strings[i] = std.array_list.Managed(u8).init(ctx.allocator);
    }

    // Perform brace expansion
    Braces.expand(
        arena_alloc,
        lexer_output.tokens.items[0..],
        expanded_strings,
        lexer_output.contains_nested,
    ) catch {
        // On error, return input as-is
        for (expanded_strings) |*s| s.deinit();
        bun.handleOom(out.append(bun.handleOom(ctx.allocator.dupe(u8, input))));
        return out;
    };

    // Collect results
    for (expanded_strings) |*s| {
        const slice = s.toOwnedSlice() catch "";
        if (slice.len > 0) {
            bun.handleOom(out.append(slice));
        }
    }

    return out;
}

/// Expand an atom to a single string (for backward compatibility).
/// For brace expansions, only returns the first result.
fn expandAtom(ctx: *TraceContext, atom: *const ast.Atom) []const u8 {
    var results = expandAtomMultiple(ctx, atom);
    defer {
        // Free all but the first
        if (results.items.len > 1) {
            for (results.items[1..]) |s| {
                ctx.allocator.free(s);
            }
        }
        results.deinit();
    }

    if (results.items.len > 0) {
        return results.items[0];
    }
    return bun.handleOom(ctx.allocator.dupe(u8, ""));
}

fn expandSimple(ctx: *TraceContext, simple: *const ast.SimpleAtom, out: *std.array_list.Managed(u8)) void {
    switch (simple.*) {
        .Text => |text| {
            bun.handleOom(out.appendSlice(text));
        },
        .Var => |varname| {
            if (ctx.getVar(varname)) |val| {
                bun.handleOom(out.appendSlice(val));
            }
        },
        .VarArgv => {
            // Skip special variables like $1, $@, etc.
        },
        .cmd_subst => {
            // Can't actually run command substitutions in trace mode
            // Just skip them
        },
        .asterisk => {
            // Glob pattern - output as literal for tracing
            bun.handleOom(out.appendSlice("*"));
        },
        .double_asterisk => {
            // Glob pattern - output as literal for tracing
            bun.handleOom(out.appendSlice("**"));
        },
        .brace_begin => {
            bun.handleOom(out.appendSlice("{"));
        },
        .brace_end => {
            bun.handleOom(out.appendSlice("}"));
        },
        .comma => {
            bun.handleOom(out.appendSlice(","));
        },
        .tilde => {
            // Expand tilde to home directory
            if (ctx.getVar("HOME")) |home| {
                bun.handleOom(out.appendSlice(home));
            } else {
                bun.handleOom(out.appendSlice("~"));
            }
        },
    }
}

fn expandDoubleQuoted(ctx: *TraceContext, text: []const u8, out: *std.array_list.Managed(u8)) void {
    var i: usize = 0;
    while (i < text.len) {
        if (text[i] == '$' and i + 1 < text.len) {
            // Variable expansion
            const start = i + 1;
            var end = start;
            if (text[start] == '{') {
                // ${var} form
                end = start + 1;
                while (end < text.len and text[end] != '}') : (end += 1) {}
                if (end < text.len) {
                    const varname = text[start + 1 .. end];
                    if (ctx.getVar(varname)) |val| {
                        bun.handleOom(out.appendSlice(val));
                    }
                    i = end + 1;
                    continue;
                }
            } else {
                // $var form
                while (end < text.len and (std.ascii.isAlphanumeric(text[end]) or text[end] == '_')) : (end += 1) {}
                if (end > start) {
                    const varname = text[start..end];
                    if (ctx.getVar(varname)) |val| {
                        bun.handleOom(out.appendSlice(val));
                    }
                    i = end;
                    continue;
                }
            }
        }
        bun.handleOom(out.append(text[i]));
        i += 1;
    }
}

// =============================================================================
// Public API
// =============================================================================

/// Trace a shell script and return the trace result
pub fn trace(
    allocator: Allocator,
    shargs: *ShellArgs,
    jsobjs: []JSValue,
    export_env: ?EnvMap,
    cwd: ?[]const u8,
    globalThis: *JSGlobalObject,
) TraceResult {
    // Get current working directory
    var cwd_buf: bun.PathBuffer = undefined;
    const current_cwd = cwd orelse brk: {
        const result = bun.sys.getcwdZ(&cwd_buf);
        switch (result) {
            .result => |c| break :brk c[0..c.len],
            .err => break :brk "/",
        }
    };

    var result = TraceResult.init(allocator, current_cwd);
    var ctx = TraceContext.init(allocator, &result, current_cwd, export_env, jsobjs, globalThis);
    defer ctx.deinit();

    traceScript(&ctx, &shargs.script_ast);

    return result;
}

/// JavaScript-callable function to trace a shell script
pub fn traceShellScript(globalThis: *JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const allocator = bun.default_allocator;
    const arguments_ = callframe.arguments_old(3);
    var arguments = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments_.slice());

    const parsed_shell_script_js = arguments.nextEat() orelse {
        return globalThis.throw("trace: expected a ParsedShellScript", .{});
    };

    const parsed_shell_script = jsc.Codegen.JSParsedShellScript.fromJS(parsed_shell_script_js) orelse {
        return globalThis.throw("trace: expected a ParsedShellScript", .{});
    };

    if (parsed_shell_script.args == null) {
        return globalThis.throw("trace: shell args is null", .{});
    }

    const shargs = parsed_shell_script.args.?;
    const jsobjs = parsed_shell_script.jsobjs.items;

    // Get cwd from parsed script if set
    const cwd_slice: ?[]const u8 = if (parsed_shell_script.cwd) |c| brk: {
        const slice = c.toUTF8(bun.default_allocator);
        defer slice.deinit();
        break :brk slice.slice();
    } else null;

    var result = trace(
        allocator,
        shargs,
        jsobjs,
        parsed_shell_script.export_env,
        cwd_slice,
        globalThis,
    );
    defer result.deinit();

    return result.toJS(globalThis);
}

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const ResolvePath = bun.path;
const which = bun.which;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;

const shell = bun.shell;
const EnvMap = shell.EnvMap;
const EnvStr = shell.EnvStr;
const Interpreter = shell.Interpreter;
const ast = shell.AST;

const Braces = shell.interpret.Braces;
const ShellArgs = shell.interpret.ShellArgs;
