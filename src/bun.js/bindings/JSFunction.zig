const bun = @import("bun");
const JSC = bun.JSC;
const JSHostFn = JSC.JSHostFn;
const ZigString = JSC.ZigString;
const String = bun.String;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;

pub const JSFunction = opaque {
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
        constructor: ?*const JSHostFn = null,
    };

    extern fn JSFunction__createFromZig(
        global: *JSGlobalObject,
        fn_name: bun.String,
        implementation: *const JSHostFn,
        arg_count: u32,
        implementation_visibility: ImplementationVisibility,
        intrinsic: Intrinsic,
        constructor: ?*const JSHostFn,
    ) JSValue;

    pub fn create(
        global: *JSGlobalObject,
        fn_name: anytype,
        comptime implementation: JSC.JSHostFnZig,
        function_length: u32,
        options: CreateJSFunctionOptions,
    ) JSValue {
        return JSFunction__createFromZig(
            global,
            switch (@TypeOf(fn_name)) {
                bun.String => fn_name,
                else => bun.String.init(fn_name),
            },
            JSC.toJSHostFn(implementation),
            function_length,
            options.implementation_visibility,
            options.intrinsic,
            options.constructor,
        );
    }

    pub extern fn JSC__JSFunction__optimizeSoon(value: JSValue) void;
    pub fn optimizeSoon(value: JSValue) void {
        JSC__JSFunction__optimizeSoon(value);
    }

    extern fn JSC__JSFunction__getSourceCode(value: JSValue, out: *ZigString) bool;

    pub fn getSourceCode(value: JSValue) ?bun.String {
        var str: ZigString = undefined;
        return if (JSC__JSFunction__getSourceCode(value, &str)) bun.String.init(str) else null;
    }
};
