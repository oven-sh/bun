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
pub fn getJSSignError(err: anyerror, globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    return switch (err) {
        error.MissingCredentials => return globalThis.ERR(.S3_MISSING_CREDENTIALS, getSignErrorMessage(error.MissingCredentials), .{}).toJS(),
        error.InvalidMethod => return globalThis.ERR(.S3_INVALID_METHOD, getSignErrorMessage(error.InvalidMethod), .{}).toJS(),
        error.InvalidPath => return globalThis.ERR(.S3_INVALID_PATH, getSignErrorMessage(error.InvalidPath), .{}).toJS(),
        error.InvalidEndpoint => return globalThis.ERR(.S3_INVALID_ENDPOINT, getSignErrorMessage(error.InvalidEndpoint), .{}).toJS(),
        error.InvalidSessionToken => return globalThis.ERR(.S3_INVALID_SESSION_TOKEN, getSignErrorMessage(error.InvalidSessionToken), .{}).toJS(),
        else => return globalThis.ERR(.S3_INVALID_SIGNATURE, getSignErrorMessage(error.SignError), .{}).toJS(),
    };
}
pub fn throwSignError(err: anyerror, globalThis: *jsc.JSGlobalObject) bun.JSError {
    return switch (err) {
        error.MissingCredentials => globalThis.ERR(.S3_MISSING_CREDENTIALS, getSignErrorMessage(error.MissingCredentials), .{}).throw(),
        error.InvalidMethod => globalThis.ERR(.S3_INVALID_METHOD, getSignErrorMessage(error.InvalidMethod), .{}).throw(),
        error.InvalidPath => globalThis.ERR(.S3_INVALID_PATH, getSignErrorMessage(error.InvalidPath), .{}).throw(),
        error.InvalidEndpoint => globalThis.ERR(.S3_INVALID_ENDPOINT, getSignErrorMessage(error.InvalidEndpoint), .{}).throw(),
        error.InvalidSessionToken => globalThis.ERR(.S3_INVALID_SESSION_TOKEN, getSignErrorMessage(error.InvalidSessionToken), .{}).throw(),
        else => globalThis.ERR(.S3_INVALID_SIGNATURE, getSignErrorMessage(error.SignError), .{}).throw(),
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

const JSS3Error = extern struct {
    code: bun.String = bun.String.empty,
    message: bun.String = bun.String.empty,
    path: bun.String = bun.String.empty,

    pub fn init(code: []const u8, message: []const u8, path: ?[]const u8) @This() {
        return .{
            // lets make sure we can reuse code and message and keep it service independent
            .code = bun.String.createAtomIfPossible(code),
            .message = bun.String.createAtomIfPossible(message),
            .path = if (path) |p| bun.String.init(p) else bun.String.empty,
        };
    }

    pub fn deinit(this: *const @This()) void {
        this.path.deref();
        this.code.deref();
        this.message.deref();
    }

    pub fn toErrorInstance(this: *const @This(), global: *jsc.JSGlobalObject) jsc.JSValue {
        defer this.deinit();

        return S3Error__toErrorInstance(this, global);
    }
    extern fn S3Error__toErrorInstance(this: *const @This(), global: *jsc.JSGlobalObject) callconv(jsc.conv) jsc.JSValue;
};

pub const S3Error = struct {
    code: []const u8,
    message: []const u8,

    pub fn toJS(err: *const @This(), globalObject: *jsc.JSGlobalObject, path: ?[]const u8) jsc.JSValue {
        const value = JSS3Error.init(err.code, err.message, path).toErrorInstance(globalObject);
        bun.assert(!globalObject.hasException());
        return value;
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
