pub const ZigErrorType = extern struct {
    code: ErrorCode,
    value: bun.jsc.JSValue,
};

const bun = @import("bun");
const ErrorCode = @import("./ErrorCode.zig").ErrorCode;
