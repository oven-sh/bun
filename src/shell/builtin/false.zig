pub fn start(this: *@This()) Yield {
    return this.bltn().done(1);
}

pub fn deinit(this: *@This()) void {
    _ = this;
}

pub fn onIOWriterChunk(_: *@This(), _: usize, _: ?JSC.SystemError) Yield {
    return .done;
}

pub inline fn bltn(this: *@This()) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("false", this));
    return @fieldParentPtr("impl", impl);
}

// --
const bun = @import("bun");
const Yield = bun.shell.Yield;
const interpreter = @import("../interpreter.zig");
const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;

const JSC = bun.JSC;
