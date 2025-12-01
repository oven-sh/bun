const Echo = @This();

/// Should be allocated with the arena from Builtin
output: std.array_list.Managed(u8),

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
            bun.handleOom(this.output.appendSlice(thearg));
            bun.handleOom(this.output.append(' '));
        } else {
            if (thearg.len > 0 and thearg[thearg.len - 1] == '\n') {
                has_leading_newline = true;
            }
            bun.handleOom(this.output.appendSlice(bun.strings.trimSubsequentLeadingChars(thearg, '\n')));
        }
    }

    if (!has_leading_newline and !no_newline) bun.handleOom(this.output.append('\n'));

    if (this.bltn().stdout.needsIO()) |safeguard| {
        this.state = .waiting;
        return this.bltn().stdout.enqueue(this, this.output.items[0..], safeguard);
    }
    _ = this.bltn().writeNoIO(.stdout, this.output.items[0..]);
    this.state = .done;
    return this.bltn().done(0);
}

pub fn onIOWriterChunk(this: *Echo, _: usize, e: ?jsc.SystemError) Yield {
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

const log = bun.Output.scoped(.echo, .hidden);

const interpreter = @import("../interpreter.zig");
const std = @import("std");

const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;

const bun = @import("bun");
const assert = bun.assert;
const jsc = bun.jsc;

const ExitCode = bun.shell.ExitCode;
const Yield = bun.shell.Yield;
