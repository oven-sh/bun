/// Should be allocated with the arena from Builtin
output: std.ArrayList(u8),

state: union(enum) {
    idle,
    waiting,
    done,
} = .idle,

pub fn start(this: *Echo) Maybe(void) {
    const args = this.bltn().argsSlice();

    var has_leading_newline: bool = false;
    const args_len = args.len;
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

    if (!has_leading_newline) this.output.append('\n') catch bun.outOfMemory();

    if (this.bltn().stdout.needsIO()) |safeguard| {
        this.state = .waiting;
        this.bltn().stdout.enqueue(this, this.output.items[0..], safeguard);
        return Maybe(void).success;
    }
    _ = this.bltn().writeNoIO(.stdout, this.output.items[0..]);
    this.state = .done;
    this.bltn().done(0);
    return Maybe(void).success;
}

pub fn onIOWriterChunk(this: *Echo, _: usize, e: ?JSC.SystemError) void {
    if (comptime bun.Environment.allow_assert) {
        assert(this.state == .waiting);
    }

    if (e != null) {
        defer e.?.deref();
        this.bltn().done(e.?.getErrno());
        return;
    }

    this.state = .done;
    this.bltn().done(0);
}

pub fn deinit(this: *Echo) void {
    log("({s}) deinit", .{@tagName(.echo)});
    this.output.deinit();
}

pub inline fn bltn(this: *Echo) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("echo", this));
    return @fieldParentPtr("impl", impl);
}

// --
const log = bun.Output.scoped(.echo, true);
const bun = @import("bun");
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;
const Echo = @This();
const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
const std = @import("std");

const assert = bun.assert;
