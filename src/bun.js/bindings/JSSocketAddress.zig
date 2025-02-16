pub const JSSocketAddress = opaque {
    extern fn JSSocketAddress__create(global: *JSC.JSGlobalObject, ip: JSValue, port: i32, is_ipv6: bool) JSValue;

    pub fn create(global: *JSC.JSGlobalObject, ip: []const u8, port: i32, is_ipv6: bool) JSValue {
        return JSSocketAddress__create(global, bun.String.createUTF8ForJS(global, ip), port, is_ipv6);
    }
};

const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
