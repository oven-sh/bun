//! JSC bridges for `s3_signing/error.zig`. The pure error-code/message tables
//! stay in `s3_signing/`; the `*JSGlobalObject`-taking variants live here.

pub const S3Error = s3_error.S3Error;

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

pub fn s3ErrorToJS(err: *const S3Error, globalObject: *jsc.JSGlobalObject, path: ?[]const u8) jsc.JSValue {
    const value = JSS3Error.init(err.code, err.message, path).toErrorInstance(globalObject);
    bun.assert(!globalObject.hasException());
    return value;
}

/// Like `toJS` but populates the error's stack trace with async frames from
/// the given promise's await chain. Use when rejecting from an HTTP
/// callback at the top of the event loop.
pub fn s3ErrorToJSWithAsyncStack(err: *const S3Error, globalObject: *jsc.JSGlobalObject, path: ?[]const u8, promise: *jsc.JSPromise) jsc.JSValue {
    const value = s3ErrorToJS(err, globalObject, path);
    value.attachAsyncStackFromPromise(globalObject, promise);
    return value;
}

const s3_error = @import("../../../s3_signing/error.zig");
const getSignErrorMessage = s3_error.getSignErrorMessage;

const bun = @import("bun");
const jsc = bun.jsc;
