state: union(enum) {
    idle,
    waiting_io: struct {
        kind: enum { stdout, stderr },
    },
    err,
    done,
} = .idle,

pub fn start(this: *Pwd) Yield {
    const args = this.bltn().argsSlice();
    if (args.len > 0) {
        const msg = "pwd: too many arguments\n";
        if (this.bltn().stderr.needsIO()) |safeguard| {
            this.state = .{ .waiting_io = .{ .kind = .stderr } };
            return this.bltn().stderr.enqueue(this, msg, safeguard);
        }

        _ = this.bltn().writeNoIO(.stderr, msg);
        return this.bltn().done(1);
    }

    const cwd_str = this.bltn().parentCmd().base.shell.cwd();
    if (this.bltn().stdout.needsIO()) |safeguard| {
        this.state = .{ .waiting_io = .{ .kind = .stdout } };
        return this.bltn().stdout.enqueueFmtBltn(this, null, "{s}\n", .{cwd_str}, safeguard);
    }
    const buf = this.bltn().fmtErrorArena(null, "{s}\n", .{cwd_str});

    _ = this.bltn().writeNoIO(.stdout, buf);

    this.state = .done;
    return this.bltn().done(0);
}

pub fn next(this: *Pwd) Yield {
    while (!(this.state == .err or this.state == .done)) {
        switch (this.state) {
            .waiting_io => return .suspended,
            .idle => @panic("Unexpected \"idle\" state in Pwd. This indicates a bug in Bun. Please file a GitHub issue."),
            .done, .err => unreachable,
        }
    }

    switch (this.state) {
        .done => return this.bltn().done(0),
        .err => return this.bltn().done(1),
        else => unreachable,
    }
}

pub fn onIOWriterChunk(this: *Pwd, _: usize, e: ?JSC.SystemError) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting_io);
    }

    if (e != null) {
        defer e.?.deref();
        this.state = .err;
        return this.next();
    }

    this.state = switch (this.state.waiting_io.kind) {
        .stdout => .done,
        .stderr => .err,
    };

    return this.next();
}

pub fn deinit(this: *Pwd) void {
    _ = this;
}

pub inline fn bltn(this: *Pwd) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("pwd", this));
    return @fieldParentPtr("impl", impl);
}

// --
const bun = @import("bun");
const shell = bun.shell;
const Yield = shell.Yield;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const Pwd = @This();
const JSC = bun.JSC;

const assert = bun.assert;
