const bun = @import("bun");

const std = @import("std");

const Api = @import("../api/schema.zig").Api;

pub const DefaultBunDefines = struct {
    pub const Keys = struct {
        const window = "window";
    };
    pub const Values = struct {
        const window = "undefined";
    };
};

pub fn configureTransformOptionsForBunVM(allocator: std.mem.Allocator, _args: Api.TransformOptions) !Api.TransformOptions {
    var args = _args;

    args.write = false;
    args.resolve = Api.ResolveMode.lazy;
    return try configureTransformOptionsForBun(allocator, args);
}

pub fn configureTransformOptionsForBun(_: std.mem.Allocator, _args: Api.TransformOptions) !Api.TransformOptions {
    var args = _args;
    args.target = Api.Target.bun;
    return args;
}
