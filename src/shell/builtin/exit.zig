state: enum {
    idle,
    waiting_io,
    err,
    done,
} = .idle,

pub fn start(this: *Exit) Maybe(void) {
    const args = this.bltn().argsSlice();
    switch (args.len) {
        0 => {
            this.bltn().done(0);
            return Maybe(void).success;
        },
        1 => {
            const first_arg = args[0][0..std.mem.len(args[0]) :0];
            const exit_code: ExitCode = std.fmt.parseInt(u8, first_arg, 10) catch |err| switch (err) {
                error.Overflow => @intCast((std.fmt.parseInt(usize, first_arg, 10) catch return this.fail("exit: numeric argument required\n")) % 256),
                error.InvalidCharacter => return this.fail("exit: numeric argument required\n"),
            };
            this.bltn().done(exit_code);
            return Maybe(void).success;
        },
        else => {
            return this.fail("exit: too many arguments\n");
        },
    }
}

fn fail(this: *Exit, msg: []const u8) Maybe(void) {
    if (this.bltn().stderr.needsIO()) |safeguard| {
        this.state = .waiting_io;
        this.bltn().stderr.enqueue(this, msg, safeguard);
        return Maybe(void).success;
    }
    _ = this.bltn().writeNoIO(.stderr, msg);
    this.bltn().done(1);
    return Maybe(void).success;
}

pub fn next(this: *Exit) void {
    switch (this.state) {
        .idle => @panic("Unexpected \"idle\" state in Exit. This indicates a bug in Bun. Please file a GitHub issue."),
        .waiting_io => {
            return;
        },
        .err => {
            this.bltn().done(1);
            return;
        },
        .done => {
            this.bltn().done(1);
            return;
        },
    }
}

pub fn onIOWriterChunk(this: *Exit, _: usize, maybe_e: ?JSC.SystemError) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting_io);
    }
    if (maybe_e) |e| {
        defer e.deref();
        this.state = .err;
        this.next();
        return;
    }
    this.state = .done;
    this.next();
}

pub fn deinit(this: *Exit) void {
    _ = this;
}

pub inline fn bltn(this: *Exit) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("exit", this));
    return @fieldParentPtr("impl", impl);
}

// --
const bun = @import("bun");
const shell = bun.shell;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const ExitCode = shell.ExitCode;
const Exit = @This();
const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
const std = @import("std");

const assert = bun.assert;
