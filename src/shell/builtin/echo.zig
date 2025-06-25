/// Should be allocated with the arena from Builtin
output: std.ArrayList(u8),

state: union(enum) {
    idle,
    waiting,
    waiting_write_err,
    done,
} = .idle,

pub fn start(this: *Echo) Yield {
    var args = this.bltn().argsSlice();
    const no_newline = args.len >= 1 and std.mem.eql(u8, bun.sliceTo(args[0], 0), "-n");

    args = args[if (no_newline) 1 else 0..];
    const args_len = args.len;
    var has_leading_newline: bool = false;

    // TODO: Should flush buffer after it gets to a certain size
    for (args, 0..) |arg, i| {
        const thearg = std.mem.span(arg);
        if (i < args_len - 1) {
            this.output.appendSlice(thearg) catch bun.outOfMemory();
            this.output.append(' ') catch bun.outOfMemory();
        } else {
            if (thearg.len > 0 and thearg[thearg.len - 1] == '\n') {
                has_leading_newline = true;
            }
            this.output.appendSlice(bun.strings.trimSubsequentLeadingChars(thearg, '\n')) catch bun.outOfMemory();
        }
    }

    if (!has_leading_newline and !no_newline) this.output.append('\n') catch bun.outOfMemory();

    if (this.bltn().stdout.needsIO()) |safeguard| {
        this.state = .waiting;
        return this.bltn().stdout.enqueue(this, this.output.items[0..], safeguard);
    }
    _ = this.bltn().writeNoIO(.stdout, this.output.items[0..]);
    this.state = .done;
    return this.bltn().done(0);
}

pub fn onIOWriterChunk(this: *Echo, _: usize, e: ?JSC.SystemError) Yield {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting or this.state == .waiting_write_err);
    }

    if (e != null) {
        defer e.?.deref();
        return this.bltn().done(e.?.getErrno());
    }

    this.state = .done;
    const exit_code: ExitCode = if (this.state == .waiting_write_err) 1 else 0;
    return this.bltn().done(exit_code);
}

pub fn deinit(this: *Echo) void {
    log("({s}) deinit", .{@tagName(.echo)});
    this.output.deinit();
}

pub inline fn bltn(this: *Echo) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("echo", this));
    return @fieldParentPtr("impl", impl);
}

const log = bun.Output.scoped(.echo, true);
const bun = @import("bun");
const ExitCode = bun.shell.ExitCode;
const Yield = bun.shell.Yield;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const Echo = @This();
const JSC = bun.JSC;
const std = @import("std");

const assert = bun.assert;
