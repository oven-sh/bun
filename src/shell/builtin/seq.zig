state: enum { idle, err, done } = .idle,
buf: std.ArrayListUnmanaged(u8) = .{},
_start: f32 = 1,
_end: f32 = 1,
increment: f32 = 1,
separator: []const u8 = "\n",
terminator: []const u8 = "",
fixed_width: bool = false,

pub fn start(this: *@This()) Yield {
    const args = this.bltn().argsSlice();
    var iter = bun.SliceIterator([*:0]const u8).init(args);

    if (args.len == 0) {
        return this.fail(Builtin.Kind.usageString(.seq));
    }
    while (iter.next()) |item| {
        const arg = bun.sliceTo(item, 0);

        if (std.mem.eql(u8, arg, "-s") or std.mem.eql(u8, arg, "--separator")) {
            this.separator = bun.sliceTo(iter.next() orelse return this.fail("seq: option requires an argument -- s\n"), 0);
            continue;
        }
        if (std.mem.startsWith(u8, arg, "-s")) {
            this.separator = arg[2..];
            continue;
        }

        if (std.mem.eql(u8, arg, "-t") or std.mem.eql(u8, arg, "--terminator")) {
            this.terminator = bun.sliceTo(iter.next() orelse return this.fail("seq: option requires an argument -- t\n"), 0);
            continue;
        }
        if (std.mem.startsWith(u8, arg, "-t")) {
            this.terminator = arg[2..];
            continue;
        }

        if (std.mem.eql(u8, arg, "-w") or std.mem.eql(u8, arg, "--fixed-width")) {
            this.fixed_width = true;
            continue;
        }

        iter.index -= 1;
        break;
    }

    const maybe1 = iter.next().?;
    const int1 = std.fmt.parseFloat(f32, bun.sliceTo(maybe1, 0)) catch return this.fail("seq: invalid argument\n");
    this._end = int1;
    if (this._start > this._end) this.increment = -1;

    const maybe2 = iter.next();
    if (maybe2 == null) return this.do();
    const int2 = std.fmt.parseFloat(f32, bun.sliceTo(maybe2.?, 0)) catch return this.fail("seq: invalid argument\n");
    this._start = int1;
    this._end = int2;
    if (this._start < this._end) this.increment = 1;
    if (this._start > this._end) this.increment = -1;

    const maybe3 = iter.next();
    if (maybe3 == null) return this.do();
    const int3 = std.fmt.parseFloat(f32, bun.sliceTo(maybe3.?, 0)) catch return this.fail("seq: invalid argument\n");
    this._start = int1;
    this.increment = int2;
    this._end = int3;

    if (this.increment == 0) return this.fail("seq: zero increment\n");
    if (this._start > this._end and this.increment > 0) return this.fail("seq: needs negative decrement\n");
    if (this._start < this._end and this.increment < 0) return this.fail("seq: needs positive increment\n");

    return this.do();
}

fn fail(this: *@This(), msg: []const u8) Yield {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .err;
        return this.bltn().stderr.enqueue(this, msg, safeguard);
    }
    _ = this.bltn().writeNoIO(.stderr, msg);
    return this.bltn().done(1);
}

fn do(this: *@This()) Yield {
    var current = this._start;
    var arena = std.heap.ArenaAllocator.init(bun.default_allocator);
    defer arena.deinit();

    while (if (this.increment > 0) current <= this._end else current >= this._end) : (current += this.increment) {
        const str = std.fmt.allocPrint(arena.allocator(), "{d}", .{current}) catch bun.outOfMemory();
        defer _ = arena.reset(.retain_capacity);
        _ = this.print(str);
        _ = this.print(this.separator);
    }
    _ = this.print(this.terminator);

    this.state = .done;
    if (this.bltn().stdout.needsIO()) |safeguard| {
        return this.bltn().stdout.enqueue(this, this.buf.items, safeguard);
    }
    return this.bltn().done(0);
}

fn print(this: *@This(), msg: []const u8) void {
    if (this.bltn().stdout.needsIO() != null) {
        this.buf.appendSlice(bun.default_allocator, msg) catch bun.outOfMemory();
        return;
    }
    _ = this.bltn().writeNoIO(.stdout, msg);
    return;
}

pub fn onIOWriterChunk(this: *@This(), _: usize, maybe_e: ?JSC.SystemError) Yield {
    if (maybe_e) |e| {
        defer e.deref();
        this.state = .err;
        return this.bltn().done(1);
    }
    switch (this.state) {
        .done => return this.bltn().done(0),
        .err => return this.bltn().done(1),
        .idle => bun.shell.unreachableState("Seq.onIOWriterChunk", "idle"),
    }
}

pub fn deinit(this: *@This()) void {
    this.buf.deinit(bun.default_allocator);
    //seq
}

pub inline fn bltn(this: *@This()) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("seq", this));
    return @fieldParentPtr("impl", impl);
}

// --
const bun = @import("bun");
const Yield = bun.shell.Yield;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const JSC = bun.JSC;
const std = @import("std");
