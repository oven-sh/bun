pub const Yield = union(enum) {
    script: *Script,
    stmt: *Stmt,
    pipeline: *Pipeline,
    cmd: *Cmd,
    assigns: *Assigns,
    expansion: *Expansion,
    @"if": *If,
    subshell: *Subshell,
    cond_expr: *CondExpr,

    /// This can occur if data is written using IOWriter and it immediately
    /// completes (e.g. the buf to write was empty or the fd was immediately
    /// writeable).
    ///
    /// When that happens, we return this variant to ensure that the
    /// `.onIOWriterChunk` is called at the top of the callstack.
    ///
    /// TODO: this struct is massive
    on_io_writer_chunk: struct {
        err: ?JSC.SystemError,
        written: usize,
        /// This type is actually `IOWriterChildPtr`, but because
        /// of an annoying cyclic Zig compile error we're doing this
        /// quick fix of making it `*anyopaque`.
        child: *anyopaque,
    },

    suspended,
    /// Failed and throwed a JS error
    failed,
    done,

    /// Used in debug to ensure that we aren't blowing up the call stack by
    /// using recursion to continue execution state in the shell
    threadlocal var _dbg_catch_exec_within_exec: if (Environment.isDebug) usize else u0 = 0;

    /// Ideally this should be 1, but since we actually call the `resolve` of the Promise in
    ///  Interpreter.finish it could actually result in another shell script running.
    const MAX_DEPTH = 2;

    pub fn isDone(this: *const Yield) bool {
        return this.* == .done;
    }

    pub fn run(this: Yield) void {
        log("Yield({s}) _dbg_catch_exec_within_exec = {d} + 1 = {d}", .{ @tagName(this), _dbg_catch_exec_within_exec, _dbg_catch_exec_within_exec + 1 });
        bun.debugAssert(_dbg_catch_exec_within_exec <= MAX_DEPTH);
        if (comptime Environment.isDebug) _dbg_catch_exec_within_exec += 1;
        defer {
            log("Yield({s}) _dbg_catch_exec_within_exec = {d} - 1 = {d}", .{ @tagName(this), _dbg_catch_exec_within_exec, _dbg_catch_exec_within_exec + 1 });
            if (comptime Environment.isDebug) _dbg_catch_exec_within_exec -= 1;
        }

        // A pipeline essentially creates multiple threads of execution, so
        // we need a stack!
        var sfb = std.heap.stackFallback(@sizeOf(*Pipeline) * 4, bun.default_allocator);
        const alloc = sfb.get();
        var pipeline_stack = std.ArrayList(*Pipeline).initCapacity(alloc, 4) catch bun.outOfMemory();
        defer pipeline_stack.deinit();

        state: switch (this) {
            .pipeline => |x| {
                pipeline_stack.append(x) catch bun.outOfMemory();
                continue :state x.next();
            },
            .cmd => |x| continue :state x.next(),
            .script => |x| continue :state x.next(),
            .stmt => |x| continue :state x.next(),
            .assigns => |x| continue :state x.next(),
            .expansion => |x| continue :state x.next(),
            .@"if" => |x| continue :state x.next(),
            .subshell => |x| continue :state x.next(),
            .cond_expr => |x| continue :state x.next(),
            .on_io_writer_chunk => |x| {
                const child = IOWriterChildPtr.fromAnyOpaque(x.child);
                continue :state child.onIOWriterChunk(x.written, x.err);
            },
            .failed, .suspended, .done => {
                if (drainPipelines(&pipeline_stack)) |yield| {
                    continue :state yield;
                }
                return;
            },
        }
    }

    pub fn drainPipelines(pipeline_stack: *std.ArrayList(*Pipeline)) ?Yield {
        if (pipeline_stack.items.len == 0) return null;
        var i: i64 = @as(i64, @intCast(pipeline_stack.items.len)) - 1;
        while (i >= 0 and i < pipeline_stack.items.len) : (i -= 1) {
            const pipeline = pipeline_stack.items[@intCast(i)];
            if (pipeline.state == .starting_cmds) return pipeline.next();
            _ = pipeline_stack.pop();
            if (pipeline.state == .done) {
                return pipeline.next();
            }
        }
        return null;
    }
};

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const shell = bun.shell;

const Allocator = std.mem.Allocator;

const Interpreter = bun.shell.Interpreter;
const InterpreterChildPtr = Interpreter.InterpreterChildPtr;
const StatePtrUnion = bun.shell.interpret.StatePtrUnion;
const ast = bun.shell.AST;
const ExitCode = bun.shell.ExitCode;
const GlobWalker = bun.shell.interpret.GlobWalker;
const ShellState = Interpreter.ShellState;
const StateKind = bun.shell.interpret.StateKind;
const State = bun.shell.Interpreter.State;
const throwShellErr = bun.shell.interpret.throwShellErr;
const IO = bun.shell.Interpreter.IO;
const log = bun.shell.interpret.log;
const EnvStr = bun.shell.interpret.EnvStr;
const Pipe = bun.shell.interpret.Pipe;
const closefd = bun.shell.interpret.closefd;
const IOReader = bun.shell.Interpreter.IOReader;
const IOWriter = bun.shell.Interpreter.IOWriter;
const IOWriterChildPtr = IOWriter.IOWriterChildPtr;

const Assigns = bun.shell.Interpreter.Assigns;
const Script = bun.shell.Interpreter.Script;
const Subshell = bun.shell.Interpreter.Subshell;
const Cmd = bun.shell.Interpreter.Cmd;
const If = bun.shell.Interpreter.If;
const CondExpr = bun.shell.Interpreter.CondExpr;
const Binary = bun.shell.Interpreter.Binary;
const Expansion = bun.shell.Interpreter.Expansion;
const Stmt = bun.shell.Interpreter.Stmt;
const Pipeline = bun.shell.Interpreter.Pipeline;

const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const Maybe = JSC.Maybe;
const assert = bun.assert;
const Arena = bun.shell.interpret.Arena;
const Braces = bun.shell.interpret.Braces;
const OOM = bun.shell.interpret.OOM;
const WorkPoolTask = bun.shell.interpret.WorkPoolTask;
const WorkPool = bun.shell.interpret.WorkPool;
const Syscall = bun.shell.interpret.Syscall;

const windows = bun.windows;
const uv = windows.libuv;
