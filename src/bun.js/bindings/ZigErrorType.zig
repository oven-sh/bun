const Shimmer = @import("./shimmer.zig").Shimmer;
const ErrorCode = @import("ErrorCode.zig").ErrorCode;

pub const ZigErrorType = extern struct {
    pub const shim = Shimmer("Zig", "ErrorType", @This());
    pub const name = "ErrorType";
    pub const namespace = shim.namespace;

    code: ErrorCode,
    ptr: ?*anyopaque,
};
