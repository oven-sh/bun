const bun = @import("bun");
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const ZigString = @import("./ZigString.zig").ZigString;

// Error's cannot be created off of the main thread. So we use this to store the
// information until its ready to be materialized later.
pub const DeferredError = struct {
    kind: Kind,
    code: JSC.Node.ErrorCode,
    msg: bun.String,

    pub const Kind = enum { plainerror, typeerror, rangeerror };

    pub fn from(kind: Kind, code: JSC.Node.ErrorCode, comptime fmt: [:0]const u8, args: anytype) DeferredError {
        return .{
            .kind = kind,
            .code = code,
            .msg = bun.String.createFormat(fmt, args) catch bun.outOfMemory(),
        };
    }

    pub fn toError(this: *const DeferredError, globalThis: *JSGlobalObject) JSValue {
        const err = switch (this.kind) {
            .plainerror => this.msg.toErrorInstance(globalThis),
            .typeerror => this.msg.toTypeErrorInstance(globalThis),
            .rangeerror => this.msg.toRangeErrorInstance(globalThis),
        };
        err.put(globalThis, ZigString.static("code"), ZigString.init(@tagName(this.code)).toJS(globalThis));
        return err;
    }
};
