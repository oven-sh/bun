pub const RustErrorType = extern struct {
    code: ErrorCode,
    value: bun.jsc.JSValue,
};

const bun = @import("bun");
const ErrorCode = @import("./ErrorCode.rust").ErrorCode;
