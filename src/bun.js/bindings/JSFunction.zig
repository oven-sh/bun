const std = @import("std");
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const JSC = bun.JSC;
const Shimmer = JSC.Shimmer;
const JSHostFunctionType = JSC.JSHostFunctionType;
const ZigString = JSC.ZigString;
const String = bun.String;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;

pub const JSFunction = extern struct {
    pub const shim = Shimmer("JSC", "JSFunction", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSFunction.h";
    pub const name = "JSC::JSFunction";
    pub const namespace = "JSC";

    const ImplementationVisibility = enum(u8) {
        public,
        private,
        private_recursive,
    };

    /// In WebKit: Intrinsic.h
    const Intrinsic = enum(u8) {
        none,
        _,
    };

    const CreateJSFunctionOptions = struct {
        implementation_visibility: ImplementationVisibility = .public,
        intrinsic: Intrinsic = .none,
        constructor: ?*const JSHostFunctionType = null,
    };

    extern fn JSFunction__createFromZig(
        global: *JSGlobalObject,
        fn_name: bun.String,
        implementation: *const JSHostFunctionType,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: ?*const JSHostFunctionType,
    ) JSValue;

    pub fn create(
        global: *JSGlobalObject,
        fn_name: anytype,
        comptime implementation: JSC.JSHostZigFunction,
        function_length: u32,
        options: CreateJSFunctionOptions,
    ) JSValue {
        return JSFunction__createFromZig(
            global,
            switch (@TypeOf(fn_name)) {
                bun.String => fn_name,
                else => bun.String.init(fn_name),
            },
            JSC.toJSHostFunction(implementation),
            function_length,
            options.implementation_visibility,
            options.intrinsic,
            options.constructor,
        );
    }

    pub fn optimizeSoon(value: JSValue) void {
        cppFn("optimizeSoon", .{value});
    }

    extern fn JSC__JSFunction__getSourceCode(value: JSValue, out: *ZigString) bool;

    pub fn getSourceCode(value: JSValue) ?bun.String {
        var str: ZigString = undefined;
        return if (JSC__JSFunction__getSourceCode(value, &str)) bun.String.init(str) else null;
    }

    pub const Extern = [_][]const u8{
        "fromString",
        "getName",
        "displayName",
        "calculatedDisplayName",
        "optimizeSoon",
    };
};
