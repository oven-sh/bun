const bun = @import("bun");
const default_allocator = bun.default_allocator;
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const ZigString = JSC.ZigString;
const CallFrame = JSC.CallFrame;

pub const Fail = struct {
    pub fn call(globalThis: *JSGlobalObject, callframe: *CallFrame) bun.JSError!JSValue {
        const arguments_ = callframe.arguments_old(1);
        const arguments = arguments_.slice();

        var _msg: ZigString = ZigString.Empty;

        if (arguments.len > 0) {
            const value = arguments[0];
            value.ensureStillAlive();

            if (!value.isString()) {
                return globalThis.throwInvalidArgumentType("fail", "message", "string");
            }

            try value.toZigString(&_msg, globalThis);
        } else {
            _msg = ZigString.fromBytes("fails by fail() assertion");
        }

        var msg = _msg.toSlice(default_allocator);
        defer msg.deinit();

        return globalThis.throwPretty("\n\n{s}\n", .{msg.slice()});
    }
};
