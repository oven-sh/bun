state: enum { idle, waiting_io, err, done } = .idle,
buf: std.ArrayListUnmanaged(u8) = .{},

pub fn start(this: *@This()) Maybe(void) {
    const args = this.bltn().argsSlice();
    var iter = bun.SliceIterator([*:0]const u8).init(args);

    if (args.len == 0) return this.fail(Builtin.Kind.usageString(.dirname));

    while (iter.next()) |item| {
        const arg = bun.sliceTo(item, 0);
        _ = this.print(bun.path.dirname(arg, .posix));
        _ = this.print("\n");
    }

    this.state = .done;
    if (this.bltn().stdout.needsIO()) |safeguard| {
        this.bltn().stdout.enqueue(this, this.buf.items, safeguard);
    } else {
        this.bltn().done(0);
    }
    return Maybe(void).success;
}

pub fn deinit(this: *@This()) void {
    this.buf.deinit(bun.default_allocator);
    //dirname
}

fn fail(this: *@This(), msg: []const u8) Maybe(void) {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .err;
        this.bltn().stderr.enqueue(this, msg, safeguard);
        return Maybe(void).success;
    }
    _ = this.bltn().writeNoIO(.stderr, msg);
    this.bltn().done(1);
    return Maybe(void).success;
}

fn print(this: *@This(), msg: []const u8) Maybe(void) {
    if (this.bltn().stdout.needsIO() != null) {
        this.buf.appendSlice(bun.default_allocator, msg) catch bun.outOfMemory();
        return Maybe(void).success;
    }
    const res = this.bltn().writeNoIO(.stdout, msg);
    if (res == .err) return Maybe(void).initErr(res.err);
    return Maybe(void).success;
}

pub fn onIOWriterChunk(this: *@This(), _: usize, maybe_e: ?JSC.SystemError) void {
    if (maybe_e) |e| {
        defer e.deref();
        this.state = .err;
        this.bltn().done(1);
        return;
    }
    switch (this.state) {
        .done => this.bltn().done(0),
        .err => this.bltn().done(1),
        else => {},
    }
}

pub inline fn bltn(this: *@This()) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("dirname", this));
    return @fieldParentPtr("impl", impl);
}

// --
const bun = @import("bun");
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
const std = @import("std");

