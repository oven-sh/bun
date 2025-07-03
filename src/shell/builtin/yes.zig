state: enum { idle, waiting_io, err, done } = .idle,
expletive: []const u8 = "y",
task: YesTask = undefined,

pub fn start(this: *@This()) Yield {
    const args = this.bltn().argsSlice();

    if (args.len > 0) {
        this.expletive = std.mem.sliceTo(args[0], 0);
    }

    if (this.bltn().stdout.needsIO()) |safeguard| {
        const evtloop = this.bltn().eventLoop();
        this.task = .{
            .evtloop = evtloop,
            .concurrent_task = JSC.EventLoopTask.fromEventLoop(evtloop),
        };
        this.state = .waiting_io;
        this.task.enqueue();
        return this.bltn().stdout.enqueueFmt(this, "{s}\n", .{this.expletive}, safeguard);
    }

    var res: Maybe(usize) = undefined;
    while (true) {
        res = this.bltn().writeNoIO(.stdout, this.expletive);
        if (res == .err) {
            return this.bltn().done(1);
        }
        res = this.bltn().writeNoIO(.stdout, "\n");
        if (res == .err) {
            return this.bltn().done(1);
        }
    }
    @compileError(unreachable);
}

pub fn onIOWriterChunk(this: *@This(), _: usize, maybe_e: ?JSC.SystemError) Yield {
    if (maybe_e) |e| {
        defer e.deref();
        this.state = .err;
        return this.bltn().done(1);
    }
    return .suspended;
}

pub inline fn bltn(this: *@This()) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("yes", this));
    return @fieldParentPtr("impl", impl);
}

pub fn deinit(_: *@This()) void {}

pub const YesTask = struct {
    evtloop: JSC.EventLoopHandle,
    concurrent_task: JSC.EventLoopTask,

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

        // Manually make safeguard since this task should not be created if output does not need IO
        yes.bltn().stdout.enqueueFmt(yes, "{s}\n", .{yes.expletive}, .output_needs_io).run();

        this.enqueue();
    }

    pub fn runFromMainThreadMini(this: *@This(), _: *void) void {
        this.runFromMainThread();
    }
};

// --
const bun = @import("bun");
const Yield = bun.shell.Yield;
const shell = bun.shell;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const IO = shell.IO;
const Yes = @This();
const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
const std = @import("std");
