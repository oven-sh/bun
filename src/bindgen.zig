pub const bindgen = true;

pub const main = @import("./javascript/jsc/bindings/bindings-generator.zig").main;
pub export fn PLCrashReportHandler(_: ?*anyopaque) void {}
