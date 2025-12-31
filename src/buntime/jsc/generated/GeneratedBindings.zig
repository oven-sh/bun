const bun = @import("bun");
const jsc = bun.jsc;
const JSHostFunctionType = jsc.JSHostFn;

/// Generated for "src/bake.zig"
pub const bake = struct {
};

/// Generated for "src/bake/DevServer.zig"
pub const DevServer = struct {
    pub const jsGetDeinitCountForTesting = @extern(*const JSHostFunctionType, .{ .name = "bindgen_DevServer_jsGetDeinitCountForTesting" });
    
    pub fn createGetDeinitCountForTestingCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("getDeinitCountForTesting"), 0, jsGetDeinitCountForTesting, false, null);
    }
};

/// Generated for "src/buntime/api/BunObject.zig"
pub const BunObject = struct {
    pub const jsBraces = @extern(*const JSHostFunctionType, .{ .name = "bindgen_BunObject_jsBraces" });
    pub const jsGc = @extern(*const JSHostFunctionType, .{ .name = "bindgen_BunObject_jsGc" });
    pub const jsStringWidth = @extern(*const JSHostFunctionType, .{ .name = "bindgen_BunObject_jsStringWidth" });
    
    pub fn createBracesCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("braces"), 3, jsBraces, false, null);
    }
    pub fn createGcCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("gc"), 2, jsGc, false, null);
    }
    pub fn createStringWidthCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("stringWidth"), 2, jsStringWidth, false, null);
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

/// Generated for "src/buntime/jsc/interop/bindgen_test.zig"
pub const bindgen_test = struct {
    pub const jsAdd = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Bindgen_test_jsAdd" });
    pub const jsRequiredAndOptionalArg = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Bindgen_test_jsRequiredAndOptionalArg" });
    
    pub fn createAddCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("add"), 3, jsAdd, false, null);
    }
    pub fn createRequiredAndOptionalArgCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("requiredAndOptionalArg"), 4, jsRequiredAndOptionalArg, false, null);
    }
};

/// Generated for "src/buntime/module/NodeModuleModule.zig"
pub const NodeModuleModule = struct {
    pub const js_stat = @extern(*const JSHostFunctionType, .{ .name = "bindgen_NodeModuleModule_js_stat" });
    
    pub fn create_statCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("_stat"), 1, js_stat, false, null);
    }
};

/// Generated for "src/buntime/node/node_os.zig"
pub const node_os = struct {
    pub const jsCpus = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsCpus" });
    pub const jsFreemem = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsFreemem" });
    pub const jsGetPriority = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsGetPriority" });
    pub const jsHomedir = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsHomedir" });
    pub const jsHostname = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsHostname" });
    pub const jsLoadavg = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsLoadavg" });
    pub const jsNetworkInterfaces = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsNetworkInterfaces" });
    pub const jsRelease = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsRelease" });
    pub const jsTotalmem = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsTotalmem" });
    pub const jsUptime = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsUptime" });
    pub const jsUserInfo = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsUserInfo" });
    pub const jsVersion = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsVersion" });
    pub const jsSetPriority = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Node_os_jsSetPriority" });
    
    pub fn createCpusCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("cpus"), 1, jsCpus, false, null);
    }
    pub fn createFreememCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("freemem"), 0, jsFreemem, false, null);
    }
    pub fn createGetPriorityCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("getPriority"), 2, jsGetPriority, false, null);
    }
    pub fn createHomedirCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("homedir"), 1, jsHomedir, false, null);
    }
    pub fn createHostnameCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("hostname"), 1, jsHostname, false, null);
    }
    pub fn createLoadavgCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("loadavg"), 1, jsLoadavg, false, null);
    }
    pub fn createNetworkInterfacesCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("networkInterfaces"), 1, jsNetworkInterfaces, false, null);
    }
    pub fn createReleaseCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("release"), 0, jsRelease, false, null);
    }
    pub fn createTotalmemCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("totalmem"), 0, jsTotalmem, false, null);
    }
    pub fn createUptimeCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("uptime"), 1, jsUptime, false, null);
    }
    pub fn createUserInfoCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("userInfo"), 2, jsUserInfo, false, null);
    }
    pub fn createVersionCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("version"), 0, jsVersion, false, null);
    }
    pub fn createSetPriorityCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("setPriority"), 2, jsSetPriority, false, null);
    }
    
    pub const UserInfoOptions = extern struct {
        encoding: bun.String,
    };
};

/// Generated for "src/fmt.zig"
pub const fmt = struct {
    pub const jsFmtString = @extern(*const JSHostFunctionType, .{ .name = "bindgen_Fmt_jsFmtString" });
    
    pub fn createFmtStringCallback(global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue {
        return jsc.host_fn.NewRuntimeFunction(global, jsc.ZigString.static("fmtString"), 3, jsFmtString, false, null);
    }
    
    pub const Formatter = enum(u8) {
        escape_powershell,
        highlight_javascript,
    };
};

const binding_internals = struct {
    const import_bake = @import("../../../bake.zig");
    const import_DevServer = @import("../../../bake/DevServer.zig");
    export fn bindgen_DevServer_dispatchGetDeinitCountForTesting1(global: *jsc.JSGlobalObject, out: *usize) bool {
        if (!@hasDecl(import_DevServer, "getDeinitCountForTesting"))
            @compileError("Missing binding declaration \"getDeinitCountForTesting\" in \"DevServer.zig\"");
        out.* = @as(bun.JSError!usize, import_DevServer.getDeinitCountForTesting(
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    const import_BunObject = @import("../../api/BunObject.zig");
    export fn bindgen_BunObject_dispatchBraces1(arg_global: *jsc.JSGlobalObject, arg_input: *const bun.String, arg_options: *const BunObject.BracesOptions) jsc.JSValue {
        if (!@hasDecl(import_BunObject, "braces"))
            @compileError("Missing binding declaration \"braces\" in \"BunObject.zig\"");
        return jsc.toJSHostCall(arg_global, @src(), import_BunObject.braces, .{
            arg_global,
            arg_input.*,
            arg_options.*,
        });
    }
    export fn bindgen_BunObject_dispatchGc1(global: *jsc.JSGlobalObject, arg_force: *const bool, out: *usize) bool {
        if (!@hasDecl(import_BunObject, "gc"))
            @compileError("Missing binding declaration \"gc\" in \"BunObject.zig\"");
        out.* = @as(bun.JSError!usize, import_BunObject.gc(
            global.bunVM(),
            arg_force.*,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    export fn bindgen_BunObject_dispatchStringWidth1(global: *jsc.JSGlobalObject, arg_str: *const bun.String, arg_opts: *const BunObject.StringWidthOptions, out: *usize) bool {
        if (!@hasDecl(import_BunObject, "stringWidth"))
            @compileError("Missing binding declaration \"stringWidth\" in \"BunObject.zig\"");
        out.* = @as(bun.JSError!usize, import_BunObject.stringWidth(
            arg_str.*,
            arg_opts.*,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    const import_bindgen_test = @import("../interop/bindgen_test.zig");
    export fn bindgen_Bindgen_test_dispatchAdd1(arg_global: *jsc.JSGlobalObject, arg_a: *const i32, arg_b: *const i32, out: *i32) bool {
        if (!@hasDecl(import_bindgen_test, "add"))
            @compileError("Missing binding declaration \"add\" in \"bindgen_test.zig\"");
        out.* = @as(bun.JSError!i32, import_bindgen_test.add(
            arg_global,
            arg_a.*,
            arg_b.*,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => arg_global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    const BindgenTestRequiredAndOptionalArgArguments = extern struct {
        b_set: bool,
        d_set: bool,
        d_value: u8,
        b_value: usize,
    };
    export fn bindgen_Bindgen_test_dispatchRequiredAndOptionalArg1(global: *jsc.JSGlobalObject, arg_a: *const bool, arg_c: *const i32, buf: *BindgenTestRequiredAndOptionalArgArguments, out: *i32) bool {
        if (!@hasDecl(import_bindgen_test, "requiredAndOptionalArg"))
            @compileError("Missing binding declaration \"requiredAndOptionalArg\" in \"bindgen_test.zig\"");
        out.* = @as(bun.JSError!i32, import_bindgen_test.requiredAndOptionalArg(
            arg_a.*,
            if (buf.b_set) buf.b_value else null,
            arg_c.*,
            if (buf.d_set) buf.d_value else null,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    const import_NodeModuleModule = @import("../../module/NodeModuleModule.zig");
    export fn bindgen_NodeModuleModule_dispatch_stat1(global: *jsc.JSGlobalObject, arg_str: *const bun.String, out: *i32) bool {
        if (!@hasDecl(import_NodeModuleModule, "_stat"))
            @compileError("Missing binding declaration \"_stat\" in \"NodeModuleModule.zig\"");
        const arg_str_utf8 = arg_str.toUTF8(bun.default_allocator);
        defer arg_str_utf8.deinit();
        out.* = @as(bun.JSError!i32, import_NodeModuleModule._stat(
            arg_str_utf8.slice(),
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    const import_node_os = @import("../../node/node_os.zig");
    export fn bindgen_Node_os_dispatchCpus1(arg_global: *jsc.JSGlobalObject) jsc.JSValue {
        if (!@hasDecl(import_node_os, "cpus"))
            @compileError("Missing binding declaration \"cpus\" in \"node_os.zig\"");
        return jsc.toJSHostCall(arg_global, @src(), import_node_os.cpus, .{
            arg_global,
        });
    }
    export fn bindgen_Node_os_dispatchFreemem1(global: *jsc.JSGlobalObject, out: *u64) bool {
        if (!@hasDecl(import_node_os, "freemem"))
            @compileError("Missing binding declaration \"freemem\" in \"node_os.zig\"");
        out.* = @as(bun.JSError!u64, import_node_os.freemem(
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    export fn bindgen_Node_os_dispatchGetPriority1(arg_global: *jsc.JSGlobalObject, arg_pid: *const i32, out: *i32) bool {
        if (!@hasDecl(import_node_os, "getPriority"))
            @compileError("Missing binding declaration \"getPriority\" in \"node_os.zig\"");
        out.* = @as(bun.JSError!i32, import_node_os.getPriority(
            arg_global,
            arg_pid.*,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => arg_global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    export fn bindgen_Node_os_dispatchHomedir1(arg_global: *jsc.JSGlobalObject, out: *bun.String) bool {
        if (!@hasDecl(import_node_os, "homedir"))
            @compileError("Missing binding declaration \"homedir\" in \"node_os.zig\"");
        out.* = @as(bun.JSError!bun.String, import_node_os.homedir(
            arg_global,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => arg_global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    export fn bindgen_Node_os_dispatchHostname1(arg_global: *jsc.JSGlobalObject) jsc.JSValue {
        if (!@hasDecl(import_node_os, "hostname"))
            @compileError("Missing binding declaration \"hostname\" in \"node_os.zig\"");
        return jsc.toJSHostCall(arg_global, @src(), import_node_os.hostname, .{
            arg_global,
        });
    }
    export fn bindgen_Node_os_dispatchLoadavg1(arg_global: *jsc.JSGlobalObject) jsc.JSValue {
        if (!@hasDecl(import_node_os, "loadavg"))
            @compileError("Missing binding declaration \"loadavg\" in \"node_os.zig\"");
        return jsc.toJSHostCall(arg_global, @src(), import_node_os.loadavg, .{
            arg_global,
        });
    }
    export fn bindgen_Node_os_dispatchNetworkInterfaces1(arg_global: *jsc.JSGlobalObject) jsc.JSValue {
        if (!@hasDecl(import_node_os, "networkInterfaces"))
            @compileError("Missing binding declaration \"networkInterfaces\" in \"node_os.zig\"");
        return jsc.toJSHostCall(arg_global, @src(), import_node_os.networkInterfaces, .{
            arg_global,
        });
    }
    export fn bindgen_Node_os_dispatchRelease1(global: *jsc.JSGlobalObject, out: *bun.String) bool {
        if (!@hasDecl(import_node_os, "release"))
            @compileError("Missing binding declaration \"release\" in \"node_os.zig\"");
        out.* = @as(bun.JSError!bun.String, import_node_os.release(
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    export fn bindgen_Node_os_dispatchTotalmem1(global: *jsc.JSGlobalObject, out: *u64) bool {
        if (!@hasDecl(import_node_os, "totalmem"))
            @compileError("Missing binding declaration \"totalmem\" in \"node_os.zig\"");
        out.* = @as(bun.JSError!u64, import_node_os.totalmem(
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    export fn bindgen_Node_os_dispatchUptime1(arg_global: *jsc.JSGlobalObject, out: *f64) bool {
        if (!@hasDecl(import_node_os, "uptime"))
            @compileError("Missing binding declaration \"uptime\" in \"node_os.zig\"");
        out.* = @as(bun.JSError!f64, import_node_os.uptime(
            arg_global,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => arg_global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    export fn bindgen_Node_os_dispatchUserInfo1(arg_global: *jsc.JSGlobalObject, arg_options: *const node_os.UserInfoOptions) jsc.JSValue {
        if (!@hasDecl(import_node_os, "userInfo"))
            @compileError("Missing binding declaration \"userInfo\" in \"node_os.zig\"");
        return jsc.toJSHostCall(arg_global, @src(), import_node_os.userInfo, .{
            arg_global,
            arg_options.*,
        });
    }
    export fn bindgen_Node_os_dispatchVersion1(global: *jsc.JSGlobalObject, out: *bun.String) bool {
        if (!@hasDecl(import_node_os, "version"))
            @compileError("Missing binding declaration \"version\" in \"node_os.zig\"");
        out.* = @as(bun.JSError!bun.String, import_node_os.version(
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    export fn bindgen_Node_os_dispatchSetPriority1(arg_global: *jsc.JSGlobalObject, arg_pid: *const i32, arg_priority: *const i32) bool {
        if (!@hasDecl(import_node_os, "setPriority1"))
            @compileError("Missing binding declaration \"setPriority1\" in \"node_os.zig\"");
        @as(bun.JSError!void, import_node_os.setPriority1(
            arg_global,
            arg_pid.*,
            arg_priority.*,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => arg_global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    export fn bindgen_Node_os_dispatchSetPriority2(arg_global: *jsc.JSGlobalObject, arg_priority: *const i32) bool {
        if (!@hasDecl(import_node_os, "setPriority2"))
            @compileError("Missing binding declaration \"setPriority2\" in \"node_os.zig\"");
        @as(bun.JSError!void, import_node_os.setPriority2(
            arg_global,
            arg_priority.*,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => arg_global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
    const import_fmt = @import("../../../fmt.zig");
    export fn bindgen_Fmt_dispatchFmtString1(arg_global: *jsc.JSGlobalObject, arg_code: *const bun.String, arg_formatter: *const fmt.Formatter, out: *bun.String) bool {
        if (!@hasDecl(import_fmt.js_bindings, "fmtString"))
            @compileError("Missing binding declaration \"js_bindings.fmtString\" in \"fmt.zig\"");
        const arg_code_utf8 = arg_code.toUTF8(bun.default_allocator);
        defer arg_code_utf8.deinit();
        out.* = @as(bun.JSError!bun.String, import_fmt.js_bindings.fmtString(
            arg_global,
            arg_code_utf8.slice(),
            arg_formatter.*,
        )) catch |err| switch (err) {
            error.JSError => return false,
            error.OutOfMemory => arg_global.throwOutOfMemory() catch return false,
            error.JSTerminated => return false,
        };
        return true;
    }
};

comptime {
    if (bun.Environment.export_cpp_apis) {
        for (@typeInfo(binding_internals).@"struct".decls) |decl| {
            _ = &@field(binding_internals, decl.name);
        }
    }
}
