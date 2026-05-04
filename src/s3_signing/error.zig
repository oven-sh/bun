pub const ErrorCodeAndMessage = struct {
    code: []const u8,
    message: []const u8,
};
pub fn getSignErrorMessage(comptime err: anyerror) [:0]const u8 {
    return switch (err) {
        error.MissingCredentials => return "Missing S3 credentials. 'accessKeyId', 'secretAccessKey', 'bucket', and 'endpoint' are required",
        error.InvalidMethod => return "Method must be GET, PUT, DELETE or HEAD when using s3:// protocol",
        error.InvalidPath => return "Invalid S3 bucket, key combination",
        error.InvalidEndpoint => return "Invalid S3 endpoint",
        error.InvalidSessionToken => return "Invalid session token",
        else => return "Failed to retrieve S3 content. Are the credentials correct?",
    };
}
pub fn getSignErrorCodeAndMessage(err: anyerror) ErrorCodeAndMessage {
    // keep error codes consistent for internal errors
    return switch (err) {
        error.MissingCredentials => .{ .code = "ERR_S3_MISSING_CREDENTIALS", .message = getSignErrorMessage(error.MissingCredentials) },
        error.InvalidMethod => .{ .code = "ERR_S3_INVALID_METHOD", .message = getSignErrorMessage(error.InvalidMethod) },
        error.InvalidPath => .{ .code = "ERR_S3_INVALID_PATH", .message = getSignErrorMessage(error.InvalidPath) },
        error.InvalidEndpoint => .{ .code = "ERR_S3_INVALID_ENDPOINT", .message = getSignErrorMessage(error.InvalidEndpoint) },
        error.InvalidSessionToken => .{ .code = "ERR_S3_INVALID_SESSION_TOKEN", .message = getSignErrorMessage(error.InvalidSessionToken) },
        else => .{ .code = "ERR_S3_INVALID_SIGNATURE", .message = getSignErrorMessage(error.SignError) },
    };
}

pub const getJSSignError = @import("../runtime/webcore/s3/error_jsc.zig").getJSSignError;
pub const throwSignError = @import("../runtime/webcore/s3/error_jsc.zig").throwSignError;

pub const S3Error = struct {
    code: []const u8,
    message: []const u8,

    pub const toJS = @import("../runtime/webcore/s3/error_jsc.zig").s3ErrorToJS;
    pub const toJSWithAsyncStack = @import("../runtime/webcore/s3/error_jsc.zig").s3ErrorToJSWithAsyncStack;
};
