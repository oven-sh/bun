const Yes = @This();

state: enum { idle, waiting_write_err, waiting_io, err, done } = .idle,
expletive: []const u8 = "y",
task: YesTask = undefined,
buffer: []u8 = "",
buffer_used: usize = 0,
alloc_scope: shell.AllocScope,

pub fn start(this: *@This()) Yield {
    const args = this.bltn().argsSlice();

    // count
    var bufalloc: usize = 0;
    if (args.len == 0) {
        bufalloc = 2; // "y\n"
    } else {
        // Sum all args + spaces between + newline
        for (args, 0..) |arg, i| {
            const arg_slice = std.mem.sliceTo(arg, 0);
            bufalloc += arg_slice.len;
            if (i < args.len - 1) bufalloc += 1; // space
        }
        bufalloc += 1; // newline
    }

    // Use at least BUFSIZ (8192) for better performance
    const BUFSIZ = 8192;
    if (bufalloc <= BUFSIZ / 2) {
        bufalloc = BUFSIZ;
    }

    this.buffer = bun.handleOom(this.alloc_scope.allocator().alloc(u8, bufalloc));

    // Fill buffer with one copy of the output
    this.buffer_used = 0;
    if (args.len == 0) {
        @memcpy(this.buffer[0..1], "y");
        this.buffer[1] = '\n';
        this.buffer_used = 2;
    } else {
        for (args, 0..) |arg, i| {
            const arg_slice = std.mem.sliceTo(arg, 0);
            @memcpy(this.buffer[this.buffer_used .. this.buffer_used + arg_slice.len], arg_slice);
            this.buffer_used += arg_slice.len;
            if (i < args.len - 1) {
                this.buffer[this.buffer_used] = ' ';
                this.buffer_used += 1;
            }
        }
        this.buffer[this.buffer_used] = '\n';
        this.buffer_used += 1;
    }

    // Fill larger buffer by repeating the pattern
    const copysize = this.buffer_used;
    var copies = bufalloc / copysize;
    var filled = this.buffer_used;
    while (copies > 1) : (copies -= 1) {
        const remaining = bufalloc - filled;
        const to_copy = @min(copysize, remaining);
        @memcpy(this.buffer[filled .. filled + to_copy], this.buffer[0..to_copy]);
        filled += to_copy;
    }
    this.buffer_used = filled;

    if (this.bltn().stdout.needsIO()) |safeguard| {
        const evtloop = this.bltn().eventLoop();
        this.task = .{
            .evtloop = evtloop,
            .concurrent_task = jsc.EventLoopTask.fromEventLoop(evtloop),
        };
        this.state = .waiting_io;
        return this.bltn().stdout.enqueue(this, this.buffer[0..this.buffer_used], safeguard);
    }

    this.task = .{
        .evtloop = this.bltn().eventLoop(),
        .concurrent_task = jsc.EventLoopTask.fromEventLoop(this.task.evtloop),
    };
    return this.writeNoIO();
}

/// We write 4 8kb chunks and then suspend execution to the task.
/// This is to avoid blocking the main thread forever.
fn writeNoIO(this: *@This()) Yield {
    if (this.writeOnceNoIO(this.buffer[0..this.buffer_used])) |yield| return yield;
    if (this.writeOnceNoIO(this.buffer[0..this.buffer_used])) |yield| return yield;
    if (this.writeOnceNoIO(this.buffer[0..this.buffer_used])) |yield| return yield;
    if (this.writeOnceNoIO(this.buffer[0..this.buffer_used])) |yield| return yield;
    this.task.enqueue();
    return .suspended;
}

fn writeOnceNoIO(this: *@This(), buf: []const u8) ?Yield {
    switch (this.bltn().writeNoIO(.stdout, buf)) {
        .result => {},
        .err => |e| {
            this.state = .waiting_write_err;
            const errbuf = this.bltn().fmtErrorArena(.yes, "{s}\n", .{e.name()});
            return this.writeFailingError(errbuf, 1);
        },
    }
    return null;
}

pub fn writeFailingError(this: *Yes, buf: []const u8, exit_code: shell.ExitCode) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .waiting_write_err;
        return this.bltn().stderr.enqueue(this, buf, safeguard);
    }

    _ = this.bltn().writeNoIO(.stderr, buf);
    return this.bltn().done(exit_code);
}

pub fn onIOWriterChunk(this: *@This(), _: usize, maybe_e: ?jsc.SystemError) Yield {
    if (maybe_e) |e| {
        defer e.deref();
        this.state = .err;
        return this.bltn().done(1);
    }
    if (this.state == .waiting_write_err) {
        return this.bltn().done(1);
    }
    bun.assert(this.bltn().stdout.needsIO() != null);
    return this.bltn().stdout.enqueue(this, this.buffer[0..this.buffer_used], .output_needs_io);
}

pub inline fn bltn(this: *@This()) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("yes", this));
    return @fieldParentPtr("impl", impl);
}

pub fn deinit(this: *@This()) void {
    this.alloc_scope.allocator().free(this.buffer);
    this.alloc_scope.endScope();
}

/// This task is used when we write `yes` output to stdout and stdout does not
/// require IO. After writing a bit, we suspend execution to this task so we
/// don't just block the main thread forever.
pub const YesTask = struct {
    evtloop: jsc.EventLoopHandle,
    concurrent_task: jsc.EventLoopTask,

    pub fn enqueue(this: *@This()) void {
        if (this.evtloop == .js) {
            this.evtloop.js.tick();
            this.evtloop.js.enqueueTaskConcurrent(this.concurrent_task.js.from(this, .manual_deinit));
        } else {
            this.evtloop.mini.loop.tick();
            this.evtloop.mini.enqueueTaskConcurrent(this.concurrent_task.mini.from(this, "runFromMainThreadMini"));
        }
    }

    pub fn runFromMainThread(this: *@This()) void {
        const yes: *Yes = @fieldParentPtr("task", this);
        yes.writeNoIO().run();
    }

    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
        this.runFromMainThread();
    }
};

// --

const interpreter = @import("../interpreter.zig");
const std = @import("std");

const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;

const bun = @import("bun");
const jsc = bun.jsc;

const shell = bun.shell;
const IO = shell.IO;
const Yield = bun.shell.Yield;
