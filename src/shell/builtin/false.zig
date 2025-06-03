pub fn start(this: *@This()) Maybe(void) {
    this.bltn().done(1);
    return Maybe(void).success;
}

pub fn onIOWriterChunk(_: *@This(), _: usize, _: ?JSC.SystemError) void {
    // no IO is done
}

pub fn deinit(this: *@This()) void {
    _ = this;
}

pub inline fn bltn(this: *@This()) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("false", this));
    return @fieldParentPtr("impl", impl);
}

// --
const bun = @import("bun");
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;

const JSC = bun.JSC;
const Maybe = bun.sys.Maybe;
