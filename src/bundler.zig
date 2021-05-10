const std = @import("std");
const options = @import("options.zig");
const logger = @import("logger.zig");
const js_ast = @import("js_ast.zig");

pub const Bundler = struct {
    options: options.TransformOptions,
    log: logger.Log,
    allocator: *std.mem.Allocator,
    result: ?options.TransformResult = null,

    pub fn init(options: options.TransformOptions, allocator: *std.mem.Allocator) Bundler {
        var log = logger.Log.init(allocator);
        return Bundler{
            .options = options,
            .allocator = allocator,
            .log = log,
        };
    }

    pub fn scan(self: *Bundler) void {}

    pub fn bundle(self: *Bundler) options.TransformResult {
        var result = self.result;

        var source = logger.Source.initFile(self.options.entry_point, self.allocator);
    }
};
