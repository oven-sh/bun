const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const Blob = JSC.WebCore.Blob;
const PathOrBlob = JSC.Node.PathOrBlob;
const ZigString = JSC.ZigString;
const Method = bun.http.Method;
const S3File = @import("./S3File.zig");
const S3Credentials = bun.S3.S3Credentials;

pub fn writeFormatCredentials(credentials: *S3Credentials, options: bun.S3.MultiPartUploadOptions, acl: ?bun.S3.ACL, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
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

        const region = if (credentials.region.len > 0) credentials.region else S3Credentials.guessRegion(credentials.endpoint);
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

pub const S3Client = struct {
    const log = bun.Output.scoped(.S3Client, false);
    pub usingnamespace JSC.Codegen.JSS3Client;

    pub usingnamespace bun.New(@This());
    credentials: *S3Credentials,
    options: bun.S3.MultiPartUploadOptions = .{},
    acl: ?bun.S3.ACL = null,
    storage_class: ?bun.S3.StorageClass = null,

    pub fn constructor(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!*@This() {
        const arguments = callframe.arguments_old(1).slice();
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        var aws_options = try S3Credentials.getCredentialsWithOptions(globalThis.bunVM().transpiler.env.getS3Credentials(), .{}, args.nextEat(), null, null, globalThis);
        defer aws_options.deinit();
        return S3Client.new(.{
            .credentials = aws_options.credentials.dupe(),
            .options = aws_options.options,
            .acl = aws_options.acl,
            .storage_class = aws_options.storage_class,
        });
    }

    pub fn writeFormat(this: *@This(), comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>S3Client<r>", enable_ansi_colors));
        if (this.credentials.bucket.len > 0) {
            try writer.print(
                comptime bun.Output.prettyFmt(" (<green>\"{s}\"<r>)<r> {{", enable_ansi_colors),
                .{
                    this.credentials.bucket,
                },
            );
        } else {
            try writer.writeAll(" {");
        }

        try writeFormatCredentials(this.credentials, this.options, this.acl, Formatter, formatter, writer, enable_ansi_colors);
        try formatter.writeIndent(@TypeOf(writer), writer);
        try writer.writeAll("}");
        formatter.resetLine();
    }
    pub fn file(ptr: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
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
        var blob = Blob.new(try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class));
        blob.allocator = bun.default_allocator;
        return blob.toJS(globalThis);
    }

    pub fn presign(ptr: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
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
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class);
        defer blob.detach();
        return S3File.getPresignUrlFrom(&blob, globalThis, options);
    }

    pub fn exists(ptr: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
            if (args.len() == 0) {
                return globalThis.ERR_MISSING_ARGS("Expected a path to check if it exists", .{}).throw();
            }
            return globalThis.throwInvalidArguments("Expected a path to check if it exists", .{});
        };
        errdefer path.deinit();
        const options = args.nextEat();
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class);
        defer blob.detach();
        return S3File.S3BlobStatTask.exists(globalThis, &blob);
    }

    pub fn size(ptr: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
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
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class);
        defer blob.detach();
        return S3File.S3BlobStatTask.size(globalThis, &blob);
    }

    pub fn stat(ptr: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
            if (args.len() == 0) {
                return globalThis.ERR_MISSING_ARGS("Expected a path to check the stat of", .{}).throw();
            }
            return globalThis.throwInvalidArguments("Expected a path to check the stat of", .{});
        };
        errdefer path.deinit();
        const options = args.nextEat();
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class);
        defer blob.detach();
        return S3File.S3BlobStatTask.stat(globalThis, &blob);
    }

    pub fn write(ptr: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
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
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class);
        defer blob.detach();
        var blob_internal: PathOrBlob = .{ .blob = blob };
        return Blob.writeFileInternal(globalThis, &blob_internal, data, .{
            .mkdirp_if_not_exists = false,
            .extra_options = options,
        });
    }

    pub fn unlink(ptr: *@This(), globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: JSC.Node.PathLike = try JSC.Node.PathLike.fromJS(globalThis, &args) orelse {
            return globalThis.ERR_MISSING_ARGS("Expected a path to unlink", .{}).throw();
        };
        errdefer path.deinit();
        const options = args.nextEat();
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class);
        defer blob.detach();
        return blob.store.?.data.s3.unlink(blob.store.?, globalThis, options);
    }

    pub fn deinit(this: *@This()) void {
        this.credentials.deref();
        this.destroy();
    }

    pub fn finalize(
        this: *@This(),
    ) void {
        this.deinit();
    }

    // Static methods

    pub fn staticWrite(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        return S3File.write(globalThis, callframe);
    }

    pub fn staticPresign(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        return S3File.presign(globalThis, callframe);
    }

    pub fn staticExists(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        return S3File.exists(globalThis, callframe);
    }

    pub fn staticSize(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        return S3File.size(globalThis, callframe);
    }

    pub fn staticUnlink(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        return S3File.unlink(globalThis, callframe);
    }

    pub fn staticFile(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();

        const path = (try JSC.Node.PathLike.fromJS(globalThis, &args)) orelse {
            return globalThis.throwInvalidArguments("Expected file path string", .{});
        };

        return try S3File.constructInternalJS(globalThis, path, args.nextEat());
    }
    pub fn staticStat(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
        return S3File.stat(globalThis, callframe);
    }
};
