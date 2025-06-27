/// There are constraints on Bun's shell interpreter which are unique to shells in
/// general:
/// 1. We try to keep everything in the Bun process as much as possible for
///    performance reasons and also to leverage Bun's existing IO/FS code
/// 2. We try to use non-blocking IO as much as possible so the shell
///    does not block the main JS thread
/// 3. Zig does not have coroutines (yet)
///
/// These cause two problems:
/// 1. Unbounded recursion, if we keep calling .next() on state machine structs
///    then the call stack could get really deep, we need some mechanism to allow
///    execution to continue without blowing up the call stack
///
/// 2. Correctly handling suspension points. These occur when IO would block so
///    we must, for example, wait for epoll/kqueue. The easiest solution is to have
///    functions return some value indicating that they suspended execution of the
///    interpreter.
///
/// This `Yield` struct solves these problems. It represents a "continuation" of
/// the shell interpreter. Shell interpreter functions must return this value.
/// At the top-level of execution, `Yield.run(...)` serves as a "trampoline" to
/// drive execution without blowing up the callstack.
///
/// Note that the "top-level of execution" could be in `Interpreter.run` or when
/// shell execution resumes after suspension in a task callback (for example in
/// IOWriter.onWritePoll).
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
    /// TODO: this struct is massive, also I think we can remove this since
    ///       it is only used in 2 places. we might need to implement signals
    ///       first tho.
    on_io_writer_chunk: struct {
        err: ?JSC.SystemError,
        written: usize,
        /// This type is actually `IOWriterChildPtr`, but because
        /// of an annoying cyclic Zig compile error we're doing this
        /// quick fix of making it `*anyopaque`.
        child: *anyopaque,
    },

    suspended,
    /// Failed and threw a JS error
    failed,
    done,

    /// Used in debug builds to ensure the shell is not creating a callstack
    /// that is too deep.
    threadlocal var _dbg_catch_exec_within_exec: if (Environment.isDebug) usize else u0 = 0;

    /// Ideally this should be 1, but since we actually call the `resolve` of the Promise in
    /// Interpreter.finish it could actually result in another shell script running.
    const MAX_DEPTH = 2;

    pub fn isDone(this: *const Yield) bool {
        return this.* == .done;
    }

    fn getInterpreter(this: Yield) ?*Interpreter {
        return switch (this) {
            .script => |x| x.base.interpreter,
            .stmt => |x| x.base.interpreter,
            .pipeline => |x| x.base.interpreter,
            .cmd => |x| x.base.interpreter,
            .assigns => |x| x.base.interpreter,
            .expansion => |x| x.base.interpreter,
            .@"if" => |x| x.base.interpreter,
            .subshell => |x| x.base.interpreter,
            .cond_expr => |x| x.base.interpreter,
            .on_io_writer_chunk => null,
            .suspended, .failed, .done => null,
        };
    }

    pub fn run(this: Yield) void {
        if (comptime Environment.isDebug) log("Yield({s}) _dbg_catch_exec_within_exec = {d} + 1 = {d}", .{ @tagName(this), _dbg_catch_exec_within_exec, _dbg_catch_exec_within_exec + 1 });
        bun.debugAssert(_dbg_catch_exec_within_exec <= MAX_DEPTH);
        if (comptime Environment.isDebug) _dbg_catch_exec_within_exec += 1;
        defer {
            if (comptime Environment.isDebug) log("Yield({s}) _dbg_catch_exec_within_exec = {d} - 1 = {d}", .{ @tagName(this), _dbg_catch_exec_within_exec, _dbg_catch_exec_within_exec + 1 });
            if (comptime Environment.isDebug) _dbg_catch_exec_within_exec -= 1;
        }

        var sfb = std.heap.stackFallback(@sizeOf(*Pipeline) * 4, bun.default_allocator);
        const alloc = sfb.get();
        var pipeline_stack = std.ArrayList(*Pipeline).initCapacity(alloc, 4) catch bun.outOfMemory();
        defer pipeline_stack.deinit();

        var current_yield = this;

        // Note that we're using labelled switch statements but _not_
        // re-assigning `current_yield`, so we need to be careful about state updates.
        while (true) {
            // Check for cancellation at the beginning of each iteration
            if (current_yield.getInterpreter()) |interp| {
                if (interp.is_cancelled.load(.monotonic)) {
                    // Begin graceful unwind
                    current_yield = switch (current_yield) {
                        .pipeline => |x| x.cancel(),
                        .cmd => |x| x.cancel(),
                        .script => |x| x.cancel(),
                        .stmt => |x| x.cancel(),
                        .assigns => |x| x.cancel(),
                        .expansion => |x| x.cancel(),
                        .@"if" => |x| x.cancel(),
                        .subshell => |x| x.cancel(),
                        .cond_expr => |x| x.cancel(),
                        else => current_yield,
                    };
                    if (current_yield == .suspended or current_yield == .done or current_yield == .failed) {
                        return;
                    }
                    continue;
                }
            }

            state: switch (current_yield) {
                .pipeline => |x| {
                    pipeline_stack.append(x) catch bun.outOfMemory();
                    current_yield = x.next();
                },
                .cmd => |x| current_yield = x.next(),
                .script => |x| current_yield = x.next(),
                .stmt => |x| current_yield = x.next(),
                .assigns => |x| current_yield = x.next(),
                .expansion => |x| current_yield = x.next(),
                .@"if" => |x| current_yield = x.next(),
                .subshell => |x| current_yield = x.next(),
                .cond_expr => |x| current_yield = x.next(),
                .on_io_writer_chunk => |x| {
                    const child = IOWriterChildPtr.fromAnyOpaque(x.child);
                    current_yield = child.onIOWriterChunk(x.written, x.err);
                },
                .failed, .suspended, .done => {
                    if (drainPipelines(&pipeline_stack)) |yield| {
                        current_yield = yield;
                        continue;
                    }
                    return;
                },
            }
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

const Interpreter = bun.shell.Interpreter;
const IO = bun.shell.Interpreter.IO;
const log = bun.shell.interpret.log;
const IOWriter = bun.shell.Interpreter.IOWriter;
const IOWriterChildPtr = IOWriter.IOWriterChildPtr;

const Assigns = bun.shell.Interpreter.Assigns;
const Script = bun.shell.Interpreter.Script;
const Subshell = bun.shell.Interpreter.Subshell;
const Cmd = bun.shell.Interpreter.Cmd;
const If = bun.shell.Interpreter.If;
const CondExpr = bun.shell.Interpreter.CondExpr;
const Expansion = bun.shell.Interpreter.Expansion;
const Stmt = bun.shell.Interpreter.Stmt;
const Pipeline = bun.shell.Interpreter.Pipeline;

const JSC = bun.JSC;
