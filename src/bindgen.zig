pub const bindgen = true;

pub const main = @import("./bun.js/bindings/bindings-generator.zig").main;
pub export fn PLCrashReportHandler(_: ?*anyopaque) void {}
pub export fn mkdirp(_: ?*anyopaque) void {}
pub const build_options = @import("build_options");
pub const bun = @import("./BunObject.zig");
pub const JavaScriptCore = @import("./jsc.zig");
pub const C = @import("./c.zig");
