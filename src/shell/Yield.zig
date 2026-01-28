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
        err: ?jsc.SystemError,
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

    pub fn run(this: Yield) void {
        if (comptime Environment.isDebug) log("Yield({s}) _dbg_catch_exec_within_exec = {d} + 1 = {d}", .{ @tagName(this), _dbg_catch_exec_within_exec, _dbg_catch_exec_within_exec + 1 });
        bun.debugAssert(_dbg_catch_exec_within_exec <= MAX_DEPTH);
        if (comptime Environment.isDebug) _dbg_catch_exec_within_exec += 1;
        defer {
            if (comptime Environment.isDebug) log("Yield({s}) _dbg_catch_exec_within_exec = {d} - 1 = {d}", .{ @tagName(this), _dbg_catch_exec_within_exec, _dbg_catch_exec_within_exec - 1 });
            if (comptime Environment.isDebug) _dbg_catch_exec_within_exec -= 1;
        }

        // A pipeline creates multiple "threads" of execution:
        //
        // ```bash
        // cmd1 | cmd2 | cmd3
        // ```
        //
        // We need to start cmd1, go back to the pipeline, start cmd2, and so
        // on.
        //
        // This means we need to store a reference to the pipeline. And
        // there can be nested pipelines, so we need a stack.
        var sfb = std.heap.stackFallback(@sizeOf(*Pipeline) * 4, bun.default_allocator);
        const alloc = sfb.get();
        var pipeline_stack = bun.handleOom(std.array_list.Managed(*Pipeline).initCapacity(alloc, 4));
        defer pipeline_stack.deinit();

        // Note that we're using labelled switch statements but _not_
        // re-assigning `this`, so the `this` variable is stale after the first
        // execution. Don't touch it.
        state: switch (this) {
            .pipeline => |x| {
                if (x.state == .done) {
                    // remove it from the pipeline stack as calling `.next()` will now deinit it
                    if (std.mem.indexOfScalar(*Pipeline, pipeline_stack.items, x)) |idx| {
                        _ = pipeline_stack.orderedRemove(idx);
                    }
                    continue :state x.next();
                }
                bun.assert_eql(std.mem.indexOfScalar(*Pipeline, pipeline_stack.items, x), null);
                bun.handleOom(pipeline_stack.append(x));
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

    pub fn drainPipelines(pipeline_stack: *std.array_list.Managed(*Pipeline)) ?Yield {
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
const jsc = bun.jsc;
const shell = bun.shell;
const log = bun.shell.interpret.log;

const Interpreter = bun.shell.Interpreter;
const Assigns = bun.shell.Interpreter.Assigns;
const Cmd = bun.shell.Interpreter.Cmd;
const CondExpr = bun.shell.Interpreter.CondExpr;
const Expansion = bun.shell.Interpreter.Expansion;
const IO = bun.shell.Interpreter.IO;
const If = bun.shell.Interpreter.If;
const Pipeline = bun.shell.Interpreter.Pipeline;
const Script = bun.shell.Interpreter.Script;
const Stmt = bun.shell.Interpreter.Stmt;
const Subshell = bun.shell.Interpreter.Subshell;

const IOWriter = bun.shell.Interpreter.IOWriter;
const IOWriterChildPtr = IOWriter.IOWriterChildPtr;
