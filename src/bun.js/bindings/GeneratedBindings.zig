const bun = @import("root").bun;
const JSC = bun.JSC;
const JSHostFunctionType = JSC.JSHostFunctionType;

const import_BunObject = @import("../../bun.js/api/BunObject.zig");

pub const BunObject = struct {
    pub const jsBraces = @extern(*const JSHostFunctionType, .{ .name = "bindgen_BunObject_jsBraces" });
    pub const jsGc = @extern(*const JSHostFunctionType, .{ .name = "bindgen_BunObject_jsGc" });

    pub const BracesOptions = extern struct {
        parse: bool,
        tokenize: bool,
    };
};

const binding_internals = struct {
    export fn bindgen_BunObject_dispatchBraces1(arg_global: *JSC.JSGlobalObject, arg_input: *const bun.String, arg_options: BunObject.BracesOptions) JSC.JSValue {
        return JSC.toJSHostValue(arg_global, import_BunObject.braces(
            arg_global,
            arg_input.*,
            arg_options,
        ));
    }
    export fn bindgen_BunObject_dispatchGc1(global: *JSC.JSGlobalObject, arg_force: bool, out: *usize) bool {
        out.* = @as(bun.JSError!usize, import_BunObject.gc(
            global.bunVM(),
            arg_force,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
        };
        return true;
    }
};

comptime {
    for (@typeInfo(binding_internals).Struct.decls) |decl| {
        _ = &@field(binding_internals, decl.name);
    }
}
