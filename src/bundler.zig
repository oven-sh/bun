const std = @import("std");
const options = @import("options.zig");
const logger = @import("logger.zig");
const js_ast = @import("js_ast.zig");

pub const Bundler = struct {
    options: options.TransformOptions,
    logger: logger.Log,

    pub fn init(options: options.TransformOptions, allocator: *std.mem.Allocator) Bundler {
        var log = logger.Log{ .msgs = ArrayList(Msg).init(allocator) };
    }

    pub fn scan() void {}
};
