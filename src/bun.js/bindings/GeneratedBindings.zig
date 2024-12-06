const bun = @import("root").bun;
const JSC = bun.JSC;
const JSHostFunctionType = JSC.JSHostFunctionType;

const import_BunObject = @import("../../bun.js/api/BunObject.zig");

pub const BunObject = struct {
    pub const jsBraces = @extern(*const JSHostFunctionType, .{ .name = "bindgen_BunObject_jsBraces" });
    pub const jsGc = @extern(*const JSHostFunctionType, .{ .name = "bindgen_BunObject_jsGc" });
    pub const jsStringWidth = @extern(*const JSHostFunctionType, .{ .name = "bindgen_BunObject_jsStringWidth" });
    pub const jsAdd = @extern(*const JSHostFunctionType, .{ .name = "bindgen_BunObject_jsAdd" });
    
    pub fn createBracesCallback(global: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.NewRuntimeFunction(global, JSC.ZigString.static("braces"), 3, &jsBraces, false, false);
    }
    pub fn createGcCallback(global: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.NewRuntimeFunction(global, JSC.ZigString.static("gc"), 2, &jsGc, false, false);
    }
    pub fn createStringWidthCallback(global: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.NewRuntimeFunction(global, JSC.ZigString.static("stringWidth"), 2, &jsStringWidth, false, false);
    }
    pub fn createAddCallback(global: *JSC.JSGlobalObject) JSC.JSValue {
        return JSC.NewRuntimeFunction(global, JSC.ZigString.static("add"), 3, &jsAdd, false, false);
    }
    
    pub const BracesOptions = extern struct {
        parse: bool,
        tokenize: bool,
    };
    pub const StringWidthOptions = extern struct {
        ambiguous_is_narrow: bool,
        count_ansi_escape_codes: bool,
    };
};

const binding_internals = struct {
    export fn bindgen_BunObject_dispatchBraces1(global: *JSC.JSGlobalObject, arg_global: *JSC.JSGlobalObject, arg_input: *const bun.String, arg_options: BunObject.BracesOptions) JSC.JSValue {
        if (!@hasDecl(import_BunObject, "braces"))
            @compileError("Missing binding declaration \"braces\" in \"BunObject.zig\"");
        return JSC.toJSHostValue(global, import_BunObject.braces(
            arg_global,
            arg_input.*,
            arg_options,
        ));
    }
    export fn bindgen_BunObject_dispatchGc1(global: *JSC.JSGlobalObject, arg_vm: *JSC.JSGlobalObject, arg_force: bool, out: *usize) bool {
        if (!@hasDecl(import_BunObject, "gc"))
            @compileError("Missing binding declaration \"gc\" in \"BunObject.zig\"");
        out.* = @as(bun.JSError!usize, import_BunObject.gc(
            arg_vm.bunVM(),
            arg_force,
        )) catch |err| switch(err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
        };
        return true;
    }
    export fn bindgen_BunObject_dispatchStringWidth1(global: *JSC.JSGlobalObject, arg_str: *const bun.String, arg_opts: BunObject.StringWidthOptions, out: *usize) bool {
        if (!@hasDecl(import_BunObject, "stringWidth"))
            @compileError("Missing binding declaration \"stringWidth\" in \"BunObject.zig\"");
        out.* = @as(bun.JSError!usize, import_BunObject.stringWidth(
            arg_str.*,
            arg_opts,
        )) catch |err| switch(err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
        };
        return true;
    }
    export fn bindgen_BunObject_dispatchAdd1(global: *JSC.JSGlobalObject, arg_global: *JSC.JSGlobalObject, arg_a: usize, arg_b: usize, out: *usize) bool {
        if (!@hasDecl(import_BunObject, "add"))
            @compileError("Missing binding declaration \"add\" in \"BunObject.zig\"");
        out.* = @as(bun.JSError!usize, import_BunObject.add(
            arg_global,
            arg_a,
            arg_b,
        )) catch |err| switch(err) {
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
