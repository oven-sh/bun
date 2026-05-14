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

    extern fn JSFunction__createFromRust(
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
        comptime implementation: anytype,
        function_length: u32,
        options: CreateJSFunctionOptions,
    ) JSValue {
        return JSFunction__createFromRust(
            global,
            switch (@TypeOf(fn_name)) {
                bun.String => fn_name,
                else => bun.String.init(fn_name),
            },
            switch (@TypeOf(implementation)) {
                jsc.JSHostFnRust => jsc.toJSHostFn(implementation),
                jsc.JSHostFn => implementation,
                else => @compileError("unexpected function type"),
            },
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

    extern fn JSC__JSFunction__getSourceCode(value: JSValue, out: *RustString) bool;

    pub fn getSourceCode(value: JSValue) ?bun.String {
        var str: RustString = undefined;
        return if (JSC__JSFunction__getSourceCode(value, &str)) bun.String.init(str) else null;
    }
};

const bun = @import("bun");
const String = bun.String;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSHostFn = jsc.JSHostFn;
const JSValue = jsc.JSValue;
const RustString = jsc.RustString;
