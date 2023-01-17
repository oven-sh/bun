const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");

const Fs = @import("../fs.zig");
const resolver = @import("../resolver/resolver.zig");
const ast = @import("../import_record.zig");
const NodeModuleBundle = @import("../node_module_bundle.zig").NodeModuleBundle;
const logger = @import("bun").logger;
const Api = @import("../api/schema.zig").Api;
const options = @import("../options.zig");
const Bundler = bun.bundler.ServeBundler;
const js_printer = bun.js_printer;
const http = @import("../http.zig");

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

    // args.serve = false;
    args.write = false;
    args.resolve = Api.ResolveMode.lazy;
    args.generate_node_module_bundle = false;
    return try configureTransformOptionsForBun(allocator, args);
}

pub fn configureTransformOptionsForBun(_: std.mem.Allocator, _args: Api.TransformOptions) !Api.TransformOptions {
    var args = _args;
    args.platform = Api.Platform.bun;
    return args;
}
