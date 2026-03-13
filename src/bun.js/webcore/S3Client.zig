pub fn writeFormatCredentials(credentials: *S3Credentials, options: bun.S3.MultiPartUploadOptions, acl: ?bun.S3.ACL, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
    try writer.writeAll("\n");

    {
        const Writer = @TypeOf(writer);

        formatter.indent += 1;
        defer formatter.indent -|= 1;

        const endpoint = if (credentials.endpoint.len > 0) credentials.endpoint else (if (credentials.virtual_hosted_style) "https://<bucket>.s3.<region>.amazonaws.com" else "https://s3.<region>.amazonaws.com");

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>endpoint<d>:<r> \"", enable_ansi_colors));
        try writer.print(comptime bun.Output.prettyFmt("<r><b>{s}<r>\"", enable_ansi_colors), .{endpoint});
        try formatter.printComma(Writer, writer, enable_ansi_colors);
        try writer.writeAll("\n");

        const region = if (credentials.region.len > 0) credentials.region else S3Credentials.guessRegion(credentials.endpoint);
        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>region<d>:<r> \"", enable_ansi_colors));
        try writer.print(comptime bun.Output.prettyFmt("<r><b>{s}<r>\"", enable_ansi_colors), .{region});
        try formatter.printComma(Writer, writer, enable_ansi_colors);
        try writer.writeAll("\n");

        // PS: We don't want to print the credentials if they are empty just signal that they are there without revealing them
        if (credentials.accessKeyId.len > 0) {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime bun.Output.prettyFmt("<r>accessKeyId<d>:<r> \"<r><b>[REDACTED]<r>\"", enable_ansi_colors));
            try formatter.printComma(Writer, writer, enable_ansi_colors);

            try writer.writeAll("\n");
        }

        if (credentials.secretAccessKey.len > 0) {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime bun.Output.prettyFmt("<r>secretAccessKey<d>:<r> \"<r><b>[REDACTED]<r>\"", enable_ansi_colors));
            try formatter.printComma(Writer, writer, enable_ansi_colors);

            try writer.writeAll("\n");
        }

        if (credentials.sessionToken.len > 0) {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime bun.Output.prettyFmt("<r>sessionToken<d>:<r> \"<r><b>[REDACTED]<r>\"", enable_ansi_colors));
            try formatter.printComma(Writer, writer, enable_ansi_colors);

            try writer.writeAll("\n");
        }

        if (acl) |acl_value| {
            try formatter.writeIndent(Writer, writer);
            try writer.writeAll(comptime bun.Output.prettyFmt("<r>acl<d>:<r> ", enable_ansi_colors));
            try writer.print(comptime bun.Output.prettyFmt("<r><b>{s}<r>\"", enable_ansi_colors), .{acl_value.toString()});
            try formatter.printComma(Writer, writer, enable_ansi_colors);

            try writer.writeAll("\n");
        }

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>partSize<d>:<r> ", enable_ansi_colors));
        try formatter.printAs(.Double, Writer, writer, jsc.JSValue.jsNumber(options.partSize), .NumberObject, enable_ansi_colors);
        try formatter.printComma(Writer, writer, enable_ansi_colors);

        try writer.writeAll("\n");

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>queueSize<d>:<r> ", enable_ansi_colors));
        try formatter.printAs(.Double, Writer, writer, jsc.JSValue.jsNumber(options.queueSize), .NumberObject, enable_ansi_colors);
        try formatter.printComma(Writer, writer, enable_ansi_colors);
        try writer.writeAll("\n");

        try formatter.writeIndent(Writer, writer);
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>retry<d>:<r> ", enable_ansi_colors));
        try formatter.printAs(.Double, Writer, writer, jsc.JSValue.jsNumber(options.retry), .NumberObject, enable_ansi_colors);
        try writer.writeAll("\n");
    }
}

pub const S3Client = struct {
    const log = bun.Output.scoped(.S3Client, .visible);
    pub const js = jsc.Codegen.JSS3Client;
    pub const toJS = js.toJS;
    pub const fromJS = js.fromJS;
    pub const fromJSDirect = js.fromJSDirect;

    pub const new = bun.TrivialNew(@This());
    credentials: *S3Credentials,
    options: bun.S3.MultiPartUploadOptions = .{},
    acl: ?bun.S3.ACL = null,
    storage_class: ?bun.S3.StorageClass = null,
    request_payer: bool = false,

    pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*@This() {
        const arguments = callframe.arguments_old(1).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        var aws_options = try S3Credentials.getCredentialsWithOptions(globalThis.bunVM().transpiler.env.getS3Credentials(), .{}, args.nextEat(), null, null, false, globalThis);
        defer aws_options.deinit();
        return S3Client.new(.{
            .credentials = aws_options.credentials.dupe(),
            .options = aws_options.options,
            .acl = aws_options.acl,
            .storage_class = aws_options.storage_class,
            .request_payer = aws_options.request_payer,
        });
    }

    pub fn writeFormat(this: *@This(), comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool) !void {
        try writer.writeAll(comptime bun.Output.prettyFmt("<r>S3Client<r>", enable_ansi_colors));
        // detect virtual host style bucket name
        const bucket_name = if (this.credentials.virtual_hosted_style and this.credentials.endpoint.len > 0) S3Credentials.guessBucket(this.credentials.endpoint) orelse this.credentials.bucket else this.credentials.bucket;
        if (bucket_name.len > 0) {
            try writer.print(
                comptime bun.Output.prettyFmt(" (<green>\"{s}\"<r>)<r> {{", enable_ansi_colors),
                .{
                    bucket_name,
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
    pub fn file(ptr: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: jsc.Node.PathLike = try jsc.Node.PathLike.fromJS(globalThis, &args) orelse {
            if (args.len() == 0) {
                return globalThis.ERR(.MISSING_ARGS, "Expected a path ", .{}).throw();
            }
            return globalThis.throwInvalidArguments("Expected a path", .{});
        };
        errdefer path.deinit();
        const options = args.nextEat();
        var blob = Blob.new(try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class, ptr.request_payer));
        return blob.toJS(globalThis);
    }

    pub fn presign(ptr: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: jsc.Node.PathLike = try jsc.Node.PathLike.fromJS(globalThis, &args) orelse {
            if (args.len() == 0) {
                return globalThis.ERR(.MISSING_ARGS, "Expected a path to presign", .{}).throw();
            }
            return globalThis.throwInvalidArguments("Expected a path to presign", .{});
        };
        errdefer path.deinit();

        const options = args.nextEat();
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class, ptr.request_payer);
        defer blob.detach();
        return S3File.getPresignUrlFrom(&blob, globalThis, options);
    }

    pub fn exists(ptr: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: jsc.Node.PathLike = try jsc.Node.PathLike.fromJS(globalThis, &args) orelse {
            if (args.len() == 0) {
                return globalThis.ERR(.MISSING_ARGS, "Expected a path to check if it exists", .{}).throw();
            }
            return globalThis.throwInvalidArguments("Expected a path to check if it exists", .{});
        };
        errdefer path.deinit();
        const options = args.nextEat();
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class, ptr.request_payer);
        defer blob.detach();
        return S3File.S3BlobStatTask.exists(globalThis, &blob);
    }

    pub fn size(ptr: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: jsc.Node.PathLike = try jsc.Node.PathLike.fromJS(globalThis, &args) orelse {
            if (args.len() == 0) {
                return globalThis.ERR(.MISSING_ARGS, "Expected a path to check the size of", .{}).throw();
            }
            return globalThis.throwInvalidArguments("Expected a path to check the size of", .{});
        };
        errdefer path.deinit();
        const options = args.nextEat();
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class, ptr.request_payer);
        defer blob.detach();
        return S3File.S3BlobStatTask.size(globalThis, &blob);
    }

    pub fn stat(ptr: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: jsc.Node.PathLike = try jsc.Node.PathLike.fromJS(globalThis, &args) orelse {
            if (args.len() == 0) {
                return globalThis.ERR(.MISSING_ARGS, "Expected a path to check the stat of", .{}).throw();
            }
            return globalThis.throwInvalidArguments("Expected a path to check the stat of", .{});
        };
        errdefer path.deinit();
        const options = args.nextEat();
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class, ptr.request_payer);
        defer blob.detach();
        return S3File.S3BlobStatTask.stat(globalThis, &blob);
    }

    pub fn write(ptr: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(3).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: jsc.Node.PathLike = try jsc.Node.PathLike.fromJS(globalThis, &args) orelse {
            return globalThis.ERR(.MISSING_ARGS, "Expected a path to write to", .{}).throw();
        };
        errdefer path.deinit();
        const data = args.nextEat() orelse {
            return globalThis.ERR(.MISSING_ARGS, "Expected a Blob-y thing to write", .{}).throw();
        };

        const options = args.nextEat();
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class, ptr.request_payer);
        defer blob.detach();
        var blob_internal: PathOrBlob = .{ .blob = blob };
        return Blob.writeFileInternal(globalThis, &blob_internal, data, .{
            .mkdirp_if_not_exists = false,
            .extra_options = options,
        });
    }

    pub fn listObjects(ptr: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const args = callframe.argumentsAsArray(2);

        const object_keys = args[0];
        const options = args[1];

        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, .{ .string = bun.PathString.empty }, options, ptr.credentials, ptr.options, null, null, ptr.request_payer);

        defer blob.detach();
        return blob.store.?.data.s3.listObjects(blob.store.?, globalThis, object_keys, options);
    }

    pub fn unlink(ptr: *@This(), globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();
        const path: jsc.Node.PathLike = try jsc.Node.PathLike.fromJS(globalThis, &args) orelse {
            return globalThis.ERR(.MISSING_ARGS, "Expected a path to unlink", .{}).throw();
        };
        errdefer path.deinit();
        const options = args.nextEat();
        var blob = try S3File.constructS3FileWithS3CredentialsAndOptions(globalThis, path, options, ptr.credentials, ptr.options, ptr.acl, ptr.storage_class, ptr.request_payer);
        defer blob.detach();
        return blob.store.?.data.s3.unlink(blob.store.?, globalThis, options);
    }

    pub fn deinit(this: *@This()) void {
        this.credentials.deref();
        bun.destroy(this);
    }

    pub fn finalize(
        this: *@This(),
    ) void {
        this.deinit();
    }

    // Static methods

    pub fn staticWrite(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        return S3File.write(globalThis, callframe);
    }

    pub fn staticPresign(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        return S3File.presign(globalThis, callframe);
    }

    pub fn staticExists(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        return S3File.exists(globalThis, callframe);
    }

    pub fn staticSize(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        return S3File.size(globalThis, callframe);
    }

    pub fn staticUnlink(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        return S3File.unlink(globalThis, callframe);
    }

    pub fn staticFile(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const arguments = callframe.arguments_old(2).slice();
        var args = jsc.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
        defer args.deinit();

        const path = (try jsc.Node.PathLike.fromJS(globalThis, &args)) orelse {
            return globalThis.throwInvalidArguments("Expected file path string", .{});
        };

        return try S3File.constructInternalJS(globalThis, path, args.nextEat());
    }
    pub fn staticStat(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        return S3File.stat(globalThis, callframe);
    }

    pub fn staticListObjects(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
        const args = callframe.argumentsAsArray(2);
        const object_keys = args[0];
        const options = args[1];

        // get credentials from env
        const existing_credentials = globalThis.bunVM().transpiler.env.getS3Credentials();

        var blob = try S3File.constructS3FileWithS3Credentials(globalThis, .{ .string = bun.PathString.empty }, options, existing_credentials);

        defer blob.detach();
        return blob.store.?.data.s3.listObjects(blob.store.?, globalThis, object_keys, options);
    }
};

const S3File = @import("./S3File.zig");

const bun = @import("bun");
const S3Credentials = bun.S3.S3Credentials;

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const Blob = jsc.WebCore.Blob;
const PathOrBlob = jsc.Node.PathOrBlob;
