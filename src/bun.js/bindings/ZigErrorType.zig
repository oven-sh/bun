pub const ZigErrorType = extern struct {
    code: ErrorCode,
    ptr: ?*anyopaque,
};

const ErrorCode = @import("ErrorCode.zig").ErrorCode;
