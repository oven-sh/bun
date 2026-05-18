pub const DefaultBunDefines = struct {
    pub const Keys = struct {
        const window = "window";
    };
    pub const Values = struct {
        const window = "undefined";
    };
};

pub fn configureTransformOptionsForBunVM(allocator: std.mem.Allocator, _args: api.TransformOptions) !api.TransformOptions {
    var args = _args;

    args.write = false;
    args.resolve = api.ResolveMode.lazy;
    return try configureTransformOptionsForBun(allocator, args);
}

pub fn configureTransformOptionsForBun(_: std.mem.Allocator, _args: api.TransformOptions) !api.TransformOptions {
    var args = _args;
    args.target = api.Target.bun;
    return args;
}

const bun = @import("bun");
const std = @import("std");
const api = bun.schema.api;
