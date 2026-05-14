/// Opaque representation of a JavaScript exception
pub const Exception = opaque {
    extern fn JSC__Exception__getStackTrace(this: *Exception, global: *JSGlobalObject, stack: *RustStackTrace) void;
    extern fn JSC__Exception__asJSValue(this: *Exception) JSValue;

    pub fn getStackTrace(this: *Exception, global: *JSGlobalObject, stack: *RustStackTrace) void {
        JSC__Exception__getStackTrace(this, global, stack);
    }

    pub fn value(this: *Exception) JSValue {
        return JSC__Exception__asJSValue(this);
    }
};

const bun = @import("bun");
const RustStackTrace = @import("./RustStackTrace.rust").RustStackTrace;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
