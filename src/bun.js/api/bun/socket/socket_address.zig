const bun = @import("root").bun;
const JSC = bun.JSC;

extern "c" fn JSSocketAddress__getConstructor(*JSC.JSGlobalObject) JSC.JSValue;
extern "c" fn JSSocketAddress__create(*JSC.JSGlobalObject, *JSC.JSString, c_int, bool) *JSC.JSObject;

pub const JSSocketAddress = opaque {
    pub const create = JSSocketAddress__create;
    pub const getConstructor = JSSocketAddress__getConstructor;
};
