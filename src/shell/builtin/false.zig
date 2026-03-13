pub fn start(this: *@This()) Yield {
    return this.bltn().done(1);
}

pub fn deinit(this: *@This()) void {
    _ = this;
}

pub fn onIOWriterChunk(_: *@This(), _: usize, _: ?jsc.SystemError) Yield {
    return .done;
}

pub inline fn bltn(this: *@This()) *Builtin {
    const impl: *Builtin.Impl = @alignCast(@fieldParentPtr("false", this));
    return @fieldParentPtr("impl", impl);
}

// --

const interpreter = @import("../interpreter.zig");

const Interpreter = interpreter.Interpreter;
const Builtin = Interpreter.Builtin;

const bun = @import("bun");
const jsc = bun.jsc;
const Yield = bun.shell.Yield;
