const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const Blob = JSC.WebCore.Blob;
const PathOrBlob = JSC.Node.PathOrBlob;
const ZigString = JSC.ZigString;
const Method = bun.http.Method;
const S3File = @import("./S3File.zig");
const AWSCredentials = bun.AWSCredentials;

pub fn presign(ptr: *AWSCredentials, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..presign(pathOrS3, options) expects a path to presign", .{});
    };
    defer path.deinit();

    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentials(globalThis, path, options, ptr.*);
    defer blob.detach();
    return S3File.getPresignUrlFrom(&blob, globalThis, options);
}

// Rest of the methods ...

pub fn finalize(ptr: *AWSCredentials) void {
    ptr.deref();
}

pub const exports = struct {};

comptime {
    // ...each of the exports
}
