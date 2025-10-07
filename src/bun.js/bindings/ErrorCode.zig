const ErrorCodeInt = u16;

pub const ErrorCode = enum(ErrorCodeInt) {
    _,

    pub inline fn from(code: anyerror) ErrorCode {
        return @as(ErrorCode, @enumFromInt(@intFromError(code)));
    }

    pub inline fn toError(self: ErrorCode) anyerror {
        return @errorFromInt(@intFromEnum(self));
    }

    pub const ParserError = @intFromEnum(ErrorCode.from(error.ParserError));
    pub const JSErrorObject = @intFromEnum(ErrorCode.from(error.JSErrorObject));

    pub const Type = ErrorCodeInt;
};

comptime {
    @export(&ErrorCode.ParserError, .{ .name = "Zig_ErrorCodeParserError" });
    @export(&ErrorCode.JSErrorObject, .{ .name = "Zig_ErrorCodeJSErrorObject" });
}
