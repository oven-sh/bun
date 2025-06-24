const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;

pub const CommonAbortReason = enum(u8) {
    Timeout = 1,
    UserAbort = 2,
    ConnectionClosed = 3,

    pub fn toJS(this: CommonAbortReason, global: *JSGlobalObject) JSValue {
        return WebCore__CommonAbortReason__toJS(global, this);
    }

    extern fn WebCore__CommonAbortReason__toJS(*JSGlobalObject, CommonAbortReason) JSValue;
};
