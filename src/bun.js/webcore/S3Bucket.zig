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
        return globalThis.throwInvalidArguments("S3Bucket.prototype..presign(path, options) expects a path to presign", .{});
    };
    defer path.deinit();

    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsNoCloneIfPossible(globalThis, path, options, ptr.*);
    defer blob.detach();
    return S3File.getPresignUrlFrom(&blob, globalThis, options);
}

pub fn exists(ptr: *AWSCredentials, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..exists(path) expects a path to check if it exists", .{});
    };
    defer path.deinit();
    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsNoCloneIfPossible(globalThis, path, options, ptr.*);
    defer blob.detach();
    return Blob.getExists(blob, globalThis, callframe);
}

pub fn size(ptr: *AWSCredentials, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..size(path) expects a path to check the size of", .{});
    };
    defer path.deinit();
    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsNoCloneIfPossible(globalThis, path, options, ptr.*);
    defer blob.detach();
    return Blob.getSize(blob, globalThis, callframe);
}

pub fn write(ptr: *AWSCredentials, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..write(path, data) expects a path to write to", .{});
    };
    defer path.deinit();
    const data = args.nextEat() orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..write(path, data) expects a Blob-y thing to write", .{});
    };

    const options = args.nextEat();
    //TODO: replace this because we dont wanna to clone the AWS credentials we wanna to ref/unref
    var blob = try S3File.constructS3FileWithAWSCredentialsNoCloneIfPossible(globalThis, path, options, ptr.*);
    defer blob.detach();

    return Blob.writeFileInternal(globalThis, &blob, data, .{
        .mkdirp_if_not_exists = false,
        .extra_options = options,
    });
}

pub fn unlink(ptr: *AWSCredentials, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..unlink(path) expects a path to unlink", .{});
    };
    defer path.deinit();
    const options = args.nextEat();
    //TODO: replace this because we dont wanna to clone the AWS credentials we wanna to ref/unref
    var blob = try S3File.constructS3FileWithAWSCredentialsNoCloneIfPossible(globalThis, path, options, ptr.*);
    defer blob.detach();
    return blob.store.?.data.s3.unlink(globalThis, options);
}

// Rest of the methods ...

pub fn finalize(ptr: *AWSCredentials) void {
    ptr.deref();
}

pub const exports = struct {
    pub const JSS3Bucket__exists = JSC.toJSHostFunction(exists);
    pub const JSS3Bucket__size = JSC.toJSHostFunction(size);
    pub const JSS3Bucket__write = JSC.toJSHostFunction(write);
    pub const JSS3Bucket__unlink = JSC.toJSHostFunction(unlink);
    pub const JSS3Bucket__presign = JSC.toJSHostFunction(presign);
    pub const JSS3Bucket__deinit = JSC.toJSHostFunction(finalize);
};

extern fn BUN__createJSS3Bucket(*JSC.JSGlobalObject, *JSC.CallFrame) callconv(JSC.conv) JSValue;
pub fn createJSS3Bucket(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(JSC.conv) JSValue {
    return BUN__createJSS3Bucket(globalObject, callframe);
}
comptime {
    @export(exports.JSS3Bucket__exists, .{ .name = "JSS3Bucket__exists" });
    @export(exports.JSS3Bucket__size, .{ .name = "JSS3Bucket__size" });
    @export(exports.JSS3Bucket__write, .{ .name = "JSS3Bucket__write" });
    @export(exports.JSS3Bucket__unlink, .{ .name = "JSS3Bucket__unlink" });
    @export(exports.JSS3Bucket__presign, .{ .name = "JSS3Bucket__presign" });
}
