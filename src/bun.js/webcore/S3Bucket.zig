const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const Blob = JSC.WebCore.Blob;
const PathOrBlob = JSC.Node.PathOrBlob;
const ZigString = JSC.ZigString;
const Method = bun.http.Method;
const S3File = @import("./S3File.zig");
const AWSCredentials = bun.AWSCredentials;

const S3BucketOptions = struct {
    credentials: *AWSCredentials,
    options: bun.S3.MultiPartUpload.MultiPartUploadOptions = .{},

    pub usingnamespace bun.New(@This());

    pub fn deinit(this: *@This()) void {
        this.credentials.deref();
        this.destroy();
    }
};

pub fn call(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..presign(path, options) expects a path to presign", .{});
    };
    defer path.deinit();
    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options);
    blob.allocator = bun.default_allocator;
    return blob.toJS(globalThis);
}

pub fn presign(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..presign(path, options) expects a path to presign", .{});
    };
    defer path.deinit();

    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options);
    defer blob.detach();
    return S3File.getPresignUrlFrom(&blob, globalThis, options);
}

pub fn exists(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..exists(path) expects a path to check if it exists", .{});
    };
    defer path.deinit();
    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options);
    defer blob.detach();
    return S3File.S3BlobStatTask.exists(globalThis, &blob);
}

pub fn size(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..size(path) expects a path to check the size of", .{});
    };
    defer path.deinit();
    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options);
    defer blob.detach();
    return S3File.S3BlobStatTask.size(globalThis, &blob);
}

pub fn write(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
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
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options);
    defer blob.detach();
    var blob_internal: PathOrBlob = .{ .blob = blob };
    return Blob.writeFileInternal(globalThis, &blob_internal, data, .{
        .mkdirp_if_not_exists = false,
        .extra_options = options,
    });
}

pub fn unlink(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.throwInvalidArguments("S3Bucket.prototype..unlink(path) expects a path to unlink", .{});
    };
    defer path.deinit();
    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options);
    defer blob.detach();
    return blob.store.?.data.s3.unlink(blob.store.?, globalThis, options);
}
pub fn construct(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) ?*S3BucketOptions {
    const arguments = callframe.arguments_old(1).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const options = args.nextEat() orelse {
        globalThis.throwInvalidArguments("S3Bucket.prototype..constructor(options) expects AWS options", .{}) catch return null;
    };
    var aws_options = AWSCredentials.getCredentialsWithOptions(globalThis.bunVM().transpiler.env.getAWSCredentials(), .{}, options, globalThis) catch return null;
    defer aws_options.deinit();
    return S3BucketOptions.new(.{
        .credentials = aws_options.credentials.dupe(),
        .options = aws_options.options,
    });
}
pub fn finalize(ptr: *S3BucketOptions) callconv(JSC.conv) void {
    ptr.deinit();
}
pub const exports = struct {
    pub const JSS3Bucket__exists = JSC.toJSHostFunctionWithContext(S3BucketOptions, exists);
    pub const JSS3Bucket__size = JSC.toJSHostFunctionWithContext(S3BucketOptions, size);
    pub const JSS3Bucket__write = JSC.toJSHostFunctionWithContext(S3BucketOptions, write);
    pub const JSS3Bucket__unlink = JSC.toJSHostFunctionWithContext(S3BucketOptions, unlink);
    pub const JSS3Bucket__presign = JSC.toJSHostFunctionWithContext(S3BucketOptions, presign);
    pub const JSS3Bucket__call = JSC.toJSHostFunctionWithContext(S3BucketOptions, call);
};

extern fn BUN__createJSS3Bucket(*JSC.JSGlobalObject, *JSC.CallFrame) callconv(JSC.conv) JSValue;

pub fn createJSS3Bucket(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
    return BUN__createJSS3Bucket(globalObject, callframe);
}

comptime {
    @export(exports.JSS3Bucket__exists, .{ .name = "JSS3Bucket__exists" });
    @export(exports.JSS3Bucket__size, .{ .name = "JSS3Bucket__size" });
    @export(exports.JSS3Bucket__write, .{ .name = "JSS3Bucket__write" });
    @export(exports.JSS3Bucket__unlink, .{ .name = "JSS3Bucket__unlink" });
    @export(exports.JSS3Bucket__presign, .{ .name = "JSS3Bucket__presign" });
    @export(exports.JSS3Bucket__call, .{ .name = "JSS3Bucket__call" });
    @export(finalize, .{ .name = "JSS3Bucket__deinit" });
    @export(construct, .{ .name = "JSS3Bucket__construct" });
}
