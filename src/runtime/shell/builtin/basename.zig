state: enum { idle, err, done } = .idle,
buf: std.ArrayListUnmanaged(u8) = .{},

pub fn start(this: *@This()) Yield {
    const args = this.bltn().argsSlice();
    var iter = bun.SliceIterator([*:0]const u8).init(args);

    if (args.len == 0) return this.fail(Builtin.Kind.usageString(.basename));

    while (iter.next()) |item| {
        const arg = bun.sliceTo(item, 0);
        this.print(bun.path.basename(arg));
        this.print("\n");
    }

    this.state = .done;
    if (this.bltn().stdout.needsIO()) |safeguard| {
        return this.bltn().stdout.enqueue(this, this.buf.items, safeguard);
    }
    return this.bltn().done(0);
}

pub fn deinit(this: *@This()) void {
    this.buf.deinit(bun.default_allocator);
    //basename
}

fn fail(this: *@This(), msg: []const u8) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .err;
        return this.bltn().stderr.enqueue(this, msg, safeguard);
    }
    _ = this.bltn().writeNoIO(.stderr, msg);
    return this.bltn().done(1);
}

fn print(this: *@This(), msg: []const u8) void {
    if (this.bltn().stdout.needsIO() != null) {
        bun.handleOom(this.buf.appendSlice(bun.default_allocator, msg));
        return;
    }
    _ = this.bltn().writeNoIO(.stdout, msg);
}

pub fn onIOWriterChunk(this: *@This(), _: usize, maybe_e: ?jsc.SystemError) Yield {
    if (maybe_e) |e| {
        defer e.deref();
        this.state = .err;
        return this.bltn().done(1);
    }
    switch (this.state) {
        .done => return this.bltn().done(0),
        .err => return this.bltn().done(1),
        .idle => bun.shell.unreachableState("Basename.onIOWriterChunk", "idle"),
    }
}

pub inline fn bltn(this: *@This()) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("basename", this));
    return @fieldParentPtr("impl", impl);
}

const interpreter = @import("../interpreter.zig");
const std = @import("std");

const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;

const bun = @import("bun");
const jsc = bun.jsc;
const Yield = bun.shell.Yield;
