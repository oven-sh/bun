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
    acl: ?bun.S3.ACL = null,
    pub usingnamespace bun.New(@This());

    pub fn deinit(this: *@This()) void {
        this.credentials.deref();
        this.destroy();
    }
};

pub fn writeFormatCredentials(credentials: *AWSCredentials, options: bun.S3.MultiPartUpload.MultiPartUploadOptions, acl: ?bun.S3.ACL, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
    try writer.writeAll("\n");

    {
        const Writer = @TypeOf(writer);

        formatter.indent += 1;
        defer formatter.indent -|= 1;

        const endpoint = if (credentials.endpoint.len > 0) credentials.endpoint else "https://s3.<region>.amazonaws.com";

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>endpoint<d>:<r> \"", enable_ansi_colors));
        try writer.print(comptime bun.Output.prettyFmt("<r><b>{s}<r>\"", enable_ansi_colors), .{endpoint});
        formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
        try writer.writeAll("\n");

        const region = if (credentials.region.len > 0) credentials.region else AWSCredentials.guessRegion(credentials.endpoint);
        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>region<d>:<r> \"", enable_ansi_colors));
        try writer.print(comptime bun.Output.prettyFmt("<r><b>{s}<r>\"", enable_ansi_colors), .{region});
        formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
        try writer.writeAll("\n");

        // PS: We don't want to print the credentials if they are empty just signal that they are there without revealing them
        if (credentials.accessKeyId.len > 0) {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime bun.Output.prettyFmt("<r>accessKeyId<d>:<r> \"<r><b>[REDACTED]<r>\"", enable_ansi_colors));
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();

            try writer.writeAll("\n");
        }

        if (credentials.secretAccessKey.len > 0) {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime bun.Output.prettyFmt("<r>secretAccessKey<d>:<r> \"<r><b>[REDACTED]<r>\"", enable_ansi_colors));
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();

            try writer.writeAll("\n");
        }

        if (credentials.sessionToken.len > 0) {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime bun.Output.prettyFmt("<r>sessionToken<d>:<r> \"<r><b>[REDACTED]<r>\"", enable_ansi_colors));
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();

            try writer.writeAll("\n");
        }

        if (acl) |acl_value| {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime bun.Output.prettyFmt("<r>acl<d>:<r> ", enable_ansi_colors));
            try writer.print(comptime bun.Output.prettyFmt("<r><b>{s}<r>\"", enable_ansi_colors), .{acl_value.toString()});
            formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();

            try writer.writeAll("\n");
        }

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>partSize<d>:<r> ", enable_ansi_colors));
        try formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(options.partSize), .NumberObject, enable_ansi_colors);
        formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();

        try writer.writeAll("\n");

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>queueSize<d>:<r> ", enable_ansi_colors));
        try formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(options.queueSize), .NumberObject, enable_ansi_colors);
        formatter.printComma(Writer, writer, enable_ansi_colors) catch bun.outOfMemory();
        try writer.writeAll("\n");

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>retry<d>:<r> ", enable_ansi_colors));
        try formatter.printAs(.Double, Writer, writer, JSC.JSValue.jsNumber(options.retry), .NumberObject, enable_ansi_colors);
        try writer.writeAll("\n");
    }
}
pub fn writeFormat(this: *S3BucketOptions, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
    try writer.writeAll(comptime bun.Output.prettyFmt("<r>S3Bucket<r>", enable_ansi_colors));
    if (this.credentials.bucket.len > 0) {
        try writer.print(
            comptime bun.Output.prettyFmt(" (<green>\"{s}\"<r>)<r> {{", enable_ansi_colors),
            .{
                this.credentials.bucket,
            },
        );
    } else {
        try writer.writeAll(comptime bun.Output.prettyFmt(" {{", enable_ansi_colors));
    }

    try writeFormatCredentials(this.credentials, this.options, this.acl, Formatter, formatter, writer, enable_ansi_colors);
    try formatter.writeIndent(@TypeOf(writer), writer);
    try writer.writeAll("}");
    formatter.resetLine();
}
extern fn BUN__getJSS3Bucket(value: JSValue) callconv(JSC.conv) ?*S3BucketOptions;

pub fn fromJS(value: JSValue) ?*S3BucketOptions {
    return BUN__getJSS3Bucket(value);
}

pub fn call(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        if (args.len() == 0) {
            return globalThis.ERR_MISSING_ARGS("Expected a path ", .{}).throw();
        }
        return globalThis.throwInvalidArguments("Expected a path", .{});
    };
    errdefer path.deinit();
    const options = args.nextEat();
    var blob = Blob.new(try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl));
    blob.allocator = bun.default_allocator;
    return blob.toJS(globalThis);
}

pub fn presign(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        if (args.len() == 0) {
            return globalThis.ERR_MISSING_ARGS("Expected a path to presign", .{}).throw();
        }
        return globalThis.throwInvalidArguments("Expected a path to presign", .{});
    };
    errdefer path.deinit();

    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl);
    defer blob.detach();
    return S3File.getPresignUrlFrom(&blob, globalThis, options);
}

pub fn exists(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        if (args.len() == 0) {
            return globalThis.throwMissingArgumentsValue("Expected a path to check if it exists", .{}).throw();
        }
        return globalThis.throwInvalidArguments("Expected a path to check if it exists", .{});
    };
    errdefer path.deinit();
    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl);
    defer blob.detach();
    return S3File.S3BlobStatTask.exists(globalThis, &blob);
}

pub fn size(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        if (args.len() == 0) {
            return globalThis.ERR_MISSING_ARGS("Expected a path to check the size of", .{}).throw();
        }
        return globalThis.throwInvalidArguments("Expected a path to check the size of", .{});
    };
    errdefer path.deinit();
    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl);
    defer blob.detach();
    return S3File.S3BlobStatTask.size(globalThis, &blob);
}

pub fn write(ptr: *S3BucketOptions, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
        return globalThis.ERR_MISSING_ARGS("Expected a path to write to", .{}).throw();
    };
    errdefer path.deinit();
    const data = args.nextEat() orelse {
        return globalThis.ERR_MISSING_ARGS("Expected a Blob-y thing to write", .{}).throw();
    };

    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl);
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
        return globalThis.ERR_MISSING_ARGS("Expected a path to unlink", .{}).throw();
    };
    errdefer path.deinit();
    const options = args.nextEat();
    var blob = try S3File.constructS3FileWithAWSCredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl);
    defer blob.detach();
    return blob.store.?.data.s3.unlink(blob.store.?, globalThis, options);
}
pub fn construct(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) ?*S3BucketOptions {
    const arguments = callframe.arguments_old(1).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();
    const options = args.nextEat() orelse {
        globalThis.ERR_MISSING_ARGS("Expected S3 options to be passed", .{}).throw() catch return null;
    };
    if (options.isEmptyOrUndefinedOrNull() or !options.isObject()) {
        globalThis.throwInvalidArguments("Expected S3 options to be passed", .{}) catch return null;
    }
    var aws_options = AWSCredentials.getCredentialsWithOptions(globalThis.bunVM().transpiler.env.getAWSCredentials(), .{}, options, null, globalThis) catch return null;
    defer aws_options.deinit();
    return S3BucketOptions.new(.{
        .credentials = aws_options.credentials.dupe(),
        .options = aws_options.options,
        .acl = aws_options.acl,
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
