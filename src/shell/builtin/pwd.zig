state: union(enum) {
    idle,
    waiting_io: struct {
        kind: enum { stdout, stderr },
    },
    err,
    done,
} = .idle,

pub fn start(this: *Pwd) Maybe(void) {
    const args = this.bltn().argsSlice();
    if (args.len > 0) {
        const msg = "pwd: too many arguments\n";
        if (this.bltn().stderr.needsIO()) |safeguard| {
            this.state = .{ .waiting_io = .{ .kind = .stderr } };
            this.bltn().stderr.enqueue(this, msg, safeguard);
            return Maybe(void).success;
        }

        _ = this.bltn().writeNoIO(.stderr, msg);
        this.bltn().done(1);
        return Maybe(void).success;
    }

    const cwd_str = this.bltn().parentCmd().base.shell.cwd();
    if (this.bltn().stdout.needsIO()) |safeguard| {
        this.state = .{ .waiting_io = .{ .kind = .stdout } };
        this.bltn().stdout.enqueueFmtBltn(this, null, "{s}\n", .{cwd_str}, safeguard);
        return Maybe(void).success;
    }
    const buf = this.bltn().fmtErrorArena(null, "{s}\n", .{cwd_str});

    _ = this.bltn().writeNoIO(.stdout, buf);

    this.state = .done;
    this.bltn().done(0);
    return Maybe(void).success;
}

pub fn next(this: *Pwd) void {
    while (!(this.state == .err or this.state == .done)) {
        switch (this.state) {
            .waiting_io => return,
            .idle => @panic("Unexpected \"idle\" state in Pwd. This indicates a bug in Bun. Please file a GitHub issue."),
            .done, .err => unreachable,
        }
    }

    switch (this.state) {
        .done => this.bltn().done(0),
        .err => this.bltn().done(1),
        else => {},
    }
}

pub fn onIOWriterChunk(this: *Pwd, _: usize, e: ?JSC.SystemError) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting_io);
    }

    if (e != null) {
        defer e.?.deref();
        this.state = .err;
        this.next();
        return;
    }

    this.state = switch (this.state.waiting_io.kind) {
        .stdout => .done,
        .stderr => .err,
    };

    this.next();
}

pub fn deinit(this: *Pwd) void {
    _ = this;
}

pub inline fn bltn(this: *Pwd) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("pwd", this));
    return @fieldParentPtr("impl", impl);
}

// --
const debug = bun.Output.scoped(.ShellCat, true);
const bun = @import("root").bun;
const shell = bun.shell;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const Result = Interpreter.Builtin.Result;
const ParseError = interpreter.ParseError;
const ParseFlagResult = interpreter.ParseFlagResult;
const ExitCode = shell.ExitCode;
const IOReader = shell.IOReader;
const IOWriter = shell.IOWriter;
const IO = shell.IO;
const IOVector = shell.IOVector;
const IOVectorSlice = shell.IOVectorSlice;
const IOVectorSliceMut = shell.IOVectorSliceMut;
const Pwd = @This();
const ReadChunkAction = interpreter.ReadChunkAction;
const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
const std = @import("std");
const FlagParser = interpreter.FlagParser;

const ShellSyscall = interpreter.ShellSyscall;
const unsupportedFlag = interpreter.unsupportedFlag;
const assert = bun.assert;
