const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const Blob = JSC.WebCore.Blob;
const PathOrBlob = JSC.Node.PathOrBlob;
const Method = bun.http.Method;
const strings = bun.strings;
const Output = bun.Output;
const S3Client = @import("./S3Client.zig");
const S3 = bun.S3;
const S3Stat = @import("./S3Stat.zig").S3Stat;
pub fn writeFormat(s3: *Blob.Store.S3, comptime Formatter: type, formatter: *Formatter, writer: anytype, comptime enable_ansi_colors: bool, content_type: []const u8, offset: usize) !void {
    try writer.writeAll(comptime Output.prettyFmt("<r>S3Ref<r>", enable_ansi_colors));
    const credentials = s3.getCredentials();
    // detect virtual host style bucket name
    const bucket_name = if (credentials.virtual_hosted_style and credentials.endpoint.len > 0) S3.S3Credentials.guessBucket(credentials.endpoint) orelse credentials.bucket else credentials.bucket;

    if (bucket_name.len > 0) {
        try writer.print(
            comptime Output.prettyFmt(" (<green>\"{s}/{s}\"<r>)<r> {{", enable_ansi_colors),
            .{
                bucket_name,
                s3.path(),
            },
        );
    } else {
        try writer.print(
            comptime Output.prettyFmt(" (<green>\"{s}\"<r>)<r> {{", enable_ansi_colors),
            .{
                s3.path(),
            },
        );
    }

    if (content_type.len > 0) {
        try writer.writeAll("\n");
        formatter.indent += 1;
        defer formatter.indent -|= 1;

        try formatter.writeIndent(@TypeOf(writer), writer);
        try writer.print(
            comptime Output.prettyFmt("type<d>:<r> <green>\"{s}\"<r>", enable_ansi_colors),
            .{
                content_type,
            },
        );

        try formatter.printComma(@TypeOf(writer), writer, enable_ansi_colors);
        if (offset > 0) {
            try writer.writeAll("\n");
        }
    }

    if (offset > 0) {
        formatter.indent += 1;
        defer formatter.indent -|= 1;

        try formatter.writeIndent(@TypeOf(writer), writer);

        try writer.print(
            comptime Output.prettyFmt("offset<d>:<r> <yellow>{d}<r>", enable_ansi_colors),
            .{
                offset,
            },
        );

        try formatter.printComma(@TypeOf(writer), writer, enable_ansi_colors);
    }
    try S3Client.writeFormatCredentials(credentials, s3.options, s3.acl, Formatter, formatter, writer, enable_ansi_colors);
    try formatter.writeIndent(@TypeOf(writer), writer);
    try writer.writeAll("}");
    formatter.resetLine();
}
pub fn presign(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }

    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("Expected a S3 or path to presign", .{});
    }

    switch (path_or_blob) {
        .path => |path| {
            if (path == .fd) {
                return globalThis.throwInvalidArguments("Expected a S3 or path to presign", .{});
            }
            const options = args.nextEat();
            var blob = try constructS3FileInternalStore(globalThis, path.path, options);
            defer blob.deinit();
            return try getPresignUrlFrom(&blob, globalThis, options);
        },
        .blob => return try getPresignUrlFrom(&path_or_blob.blob, globalThis, args.nextEat()),
    }
}

pub fn unlink(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }
    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("Expected a S3 or path to delete", .{});
    }

    switch (path_or_blob) {
        .path => |path| {
            if (path == .fd) {
                return globalThis.throwInvalidArguments("Expected a S3 or path to delete", .{});
            }
            const options = args.nextEat();
            var blob = try constructS3FileInternalStore(globalThis, path.path, options);
            defer blob.deinit();
            return try blob.store.?.data.s3.unlink(blob.store.?, globalThis, options);
        },
        .blob => |blob| {
            return try blob.store.?.data.s3.unlink(blob.store.?, globalThis, args.nextEat());
        },
    }
}

pub fn write(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }

    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("Expected a S3 or path to upload", .{});
    }

    const data = args.nextEat() orelse {
        return globalThis.ERR(.MISSING_ARGS, "Expected a Blob-y thing to upload", .{}).throw();
    };

    switch (path_or_blob) {
        .path => |path| {
            const options = args.nextEat();
            if (path == .fd) {
                return globalThis.throwInvalidArguments("Expected a S3 or path to upload", .{});
            }
            var blob = try constructS3FileInternalStore(globalThis, path.path, options);
            defer blob.deinit();

            var blob_internal: PathOrBlob = .{ .blob = blob };
            return try Blob.writeFileInternal(globalThis, &blob_internal, data, .{
                .mkdirp_if_not_exists = false,
                .extra_options = options,
            });
        },
        .blob => return try Blob.writeFileInternal(globalThis, &path_or_blob, data, .{
            .mkdirp_if_not_exists = false,
            .extra_options = args.nextEat(),
        }),
    }
}

pub fn size(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }

    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("Expected a S3 or path to get size", .{});
    }

    switch (path_or_blob) {
        .path => |path| {
            const options = args.nextEat();
            if (path == .fd) {
                return globalThis.throwInvalidArguments("Expected a S3 or path to get size", .{});
            }
            var blob = try constructS3FileInternalStore(globalThis, path.path, options);
            defer blob.deinit();

            return S3BlobStatTask.size(globalThis, &blob);
        },
        .blob => |*blob| {
            return Blob.getSize(blob, globalThis);
        },
    }
}
pub fn exists(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }

    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("Expected a S3 or path to check if it exists", .{});
    }

    switch (path_or_blob) {
        .path => |path| {
            const options = args.nextEat();
            if (path == .fd) {
                return globalThis.throwInvalidArguments("Expected a S3 or path to check if it exists", .{});
            }
            var blob = try constructS3FileInternalStore(globalThis, path.path, options);
            defer blob.deinit();

            return S3BlobStatTask.exists(globalThis, &blob);
        },
        .blob => |*blob| {
            return Blob.getExists(blob, globalThis, callframe);
        },
    }
}

fn constructS3FileInternalStore(
    globalObject: *JSC.JSGlobalObject,
    path: JSC.Node.PathLike,
    options: ?JSC.JSValue,
) bun.JSError!Blob {
    // get credentials from env
    const existing_credentials = globalObject.bunVM().transpiler.env.getS3Credentials();
    return constructS3FileWithS3Credentials(globalObject, path, options, existing_credentials);
}
/// if the credentials have changed, we need to clone it, if not we can just ref/deref it
pub fn constructS3FileWithS3CredentialsAndOptions(
    globalObject: *JSC.JSGlobalObject,
    path: JSC.Node.PathLike,
    options: ?JSC.JSValue,
    default_credentials: *S3.S3Credentials,
    default_options: bun.S3.MultiPartUploadOptions,
    default_acl: ?bun.S3.ACL,
    default_storage_class: ?bun.S3.StorageClass,
) bun.JSError!Blob {
    var aws_options = try S3.S3Credentials.getCredentialsWithOptions(default_credentials.*, default_options, options, default_acl, default_storage_class, globalObject);
    defer aws_options.deinit();

    const store = brk: {
        if (aws_options.changed_credentials) {
            break :brk Blob.Store.initS3(path, null, aws_options.credentials, bun.default_allocator) catch bun.outOfMemory();
        } else {
            break :brk Blob.Store.initS3WithReferencedCredentials(path, null, default_credentials, bun.default_allocator) catch bun.outOfMemory();
        }
    };
    errdefer store.deinit();
    store.data.s3.options = aws_options.options;
    store.data.s3.acl = aws_options.acl;
    store.data.s3.storage_class = aws_options.storage_class;

    var blob = Blob.initWithStore(store, globalObject);
    if (options) |opts| {
        if (opts.isObject()) {
            if (try opts.getTruthyComptime(globalObject, "type")) |file_type| {
                inner: {
                    if (file_type.isString()) {
                        var allocator = bun.default_allocator;
                        var str = try file_type.toSlice(globalObject, bun.default_allocator);
                        defer str.deinit();
                        const slice = str.slice();
                        if (!strings.isAllASCII(slice)) {
                            break :inner;
                        }
                        blob.content_type_was_set = true;
                        if (globalObject.bunVM().mimeType(str.slice())) |entry| {
                            blob.content_type = entry.value;
                            break :inner;
                        }
                        const content_type_buf = allocator.alloc(u8, slice.len) catch bun.outOfMemory();
                        blob.content_type = strings.copyLowercase(slice, content_type_buf);
                        blob.content_type_allocated = true;
                    }
                }
            }
        }
    }
    return blob;
}

pub fn constructS3FileWithS3Credentials(
    globalObject: *JSC.JSGlobalObject,
    path: JSC.Node.PathLike,
    options: ?JSC.JSValue,
    existing_credentials: S3.S3Credentials,
) bun.JSError!Blob {
    var aws_options = try S3.S3Credentials.getCredentialsWithOptions(existing_credentials, .{}, options, null, null, globalObject);
    defer aws_options.deinit();
    const store = Blob.Store.initS3(path, null, aws_options.credentials, bun.default_allocator) catch bun.outOfMemory();
    errdefer store.deinit();
    store.data.s3.options = aws_options.options;
    store.data.s3.acl = aws_options.acl;
    store.data.s3.storage_class = aws_options.storage_class;

    var blob = Blob.initWithStore(store, globalObject);
    if (options) |opts| {
        if (opts.isObject()) {
            if (try opts.getTruthyComptime(globalObject, "type")) |file_type| {
                inner: {
                    if (file_type.isString()) {
                        var allocator = bun.default_allocator;
                        var str = try file_type.toSlice(globalObject, bun.default_allocator);
                        defer str.deinit();
                        const slice = str.slice();
                        if (!strings.isAllASCII(slice)) {
                            break :inner;
                        }
                        blob.content_type_was_set = true;
                        if (globalObject.bunVM().mimeType(str.slice())) |entry| {
                            blob.content_type = entry.value;
                            break :inner;
                        }
                        const content_type_buf = allocator.alloc(u8, slice.len) catch bun.outOfMemory();
                        blob.content_type = strings.copyLowercase(slice, content_type_buf);
                        blob.content_type_allocated = true;
                    }
                }
            }
        }
    }
    return blob;
}
fn constructS3FileInternal(
    globalObject: *JSC.JSGlobalObject,
    path: JSC.Node.PathLike,
    options: ?JSC.JSValue,
) bun.JSError!*Blob {
    var ptr = Blob.new(try constructS3FileInternalStore(globalObject, path, options));
    ptr.allocator = bun.default_allocator;
    return ptr;
}

pub const S3BlobStatTask = struct {
    promise: JSC.JSPromise.Strong,
    global: *JSC.JSGlobalObject,
    store: *Blob.Store,

    pub const new = bun.TrivialNew(S3BlobStatTask);

    pub fn onS3ExistsResolved(result: S3.S3StatResult, this: *S3BlobStatTask) void {
        defer this.deinit();
        switch (result) {
            .not_found => {
                this.promise.resolve(this.global, .false);
            },
            .success => |_| {
                // calling .exists() should not prevent it to download a bigger file
                // this would make it download a slice of the actual value, if the file changes before we download it
                // if (this.blob.size == Blob.max_size) {
                //     this.blob.size = @truncate(stat.size);
                // }
                this.promise.resolve(this.global, .true);
            },
            .failure => |err| {
                this.promise.reject(this.global, err.toJS(this.global, this.store.data.s3.path()));
            },
        }
    }

    pub fn onS3SizeResolved(result: S3.S3StatResult, this: *S3BlobStatTask) void {
        defer this.deinit();

        switch (result) {
            .success => |stat_result| {
                this.promise.resolve(this.global, JSValue.jsNumber(stat_result.size));
            },
            .not_found, .failure => |err| {
                this.promise.reject(this.global, err.toJS(this.global, this.store.data.s3.path()));
            },
        }
    }

    pub fn onS3StatResolved(result: S3.S3StatResult, this: *S3BlobStatTask) void {
        defer this.deinit();
        const globalThis = this.global;
        switch (result) {
            .success => |stat_result| {
                this.promise.resolve(globalThis, S3Stat.init(
                    stat_result.size,
                    stat_result.etag,
                    stat_result.contentType,
                    stat_result.lastModified,
                    globalThis,
                ).toJS(globalThis));
            },
            .not_found, .failure => |err| {
                this.promise.reject(globalThis, err.toJS(globalThis, this.store.data.s3.path()));
            },
        }
    }

    pub fn exists(globalThis: *JSC.JSGlobalObject, blob: *Blob) JSValue {
        const this = S3BlobStatTask.new(.{
            .promise = JSC.JSPromise.Strong.init(globalThis),
            .store = blob.store.?,
            .global = globalThis,
        });
        this.store.ref();
        const promise = this.promise.value();
        const credentials = blob.store.?.data.s3.getCredentials();
        const path = blob.store.?.data.s3.path();
        const env = globalThis.bunVM().transpiler.env;

        S3.stat(credentials, path, @ptrCast(&S3BlobStatTask.onS3ExistsResolved), this, if (env.getHttpProxy(true, null)) |proxy| proxy.href else null);
        return promise;
    }
    pub fn stat(globalThis: *JSC.JSGlobalObject, blob: *Blob) JSValue {
        const this = S3BlobStatTask.new(.{
            .promise = JSC.JSPromise.Strong.init(globalThis),
            .store = blob.store.?,
            .global = globalThis,
        });
        this.store.ref();
        const promise = this.promise.value();
        const credentials = blob.store.?.data.s3.getCredentials();
        const path = blob.store.?.data.s3.path();
        const env = globalThis.bunVM().transpiler.env;

        S3.stat(credentials, path, @ptrCast(&S3BlobStatTask.onS3StatResolved), this, if (env.getHttpProxy(true, null)) |proxy| proxy.href else null);
        return promise;
    }
    pub fn size(globalThis: *JSC.JSGlobalObject, blob: *Blob) JSValue {
        const this = S3BlobStatTask.new(.{
            .promise = JSC.JSPromise.Strong.init(globalThis),
            .store = blob.store.?,
            .global = globalThis,
        });
        this.store.ref();
        const promise = this.promise.value();
        const credentials = blob.store.?.data.s3.getCredentials();
        const path = blob.store.?.data.s3.path();
        const env = globalThis.bunVM().transpiler.env;

        S3.stat(credentials, path, @ptrCast(&S3BlobStatTask.onS3SizeResolved), this, if (env.getHttpProxy(true, null)) |proxy| proxy.href else null);
        return promise;
    }

    pub fn deinit(this: *S3BlobStatTask) void {
        this.store.deref();
        this.promise.deinit();
        bun.destroy(this);
    }
};

pub fn getPresignUrlFrom(this: *Blob, globalThis: *JSC.JSGlobalObject, extra_options: ?JSValue) bun.JSError!JSValue {
    if (!this.isS3()) {
        return globalThis.ERR(.INVALID_THIS, "presign is only possible for s3:// files", .{}).throw();
    }

    var method: bun.http.Method = .GET;
    var expires: usize = 86400; // 1 day default

    var credentialsWithOptions: S3.S3CredentialsWithOptions = .{
        .credentials = this.store.?.data.s3.getCredentials().*,
    };
    defer {
        credentialsWithOptions.deinit();
    }
    const s3 = &this.store.?.data.s3;

    if (extra_options) |options| {
        if (options.isObject()) {
            if (try options.getTruthyComptime(globalThis, "method")) |method_| {
                method = try Method.fromJS(globalThis, method_) orelse {
                    return globalThis.throwInvalidArguments("method must be GET, PUT, DELETE or HEAD when using s3 protocol", .{});
                };
            }
            if (try options.getOptional(globalThis, "expiresIn", i32)) |expires_| {
                if (expires_ <= 0) return globalThis.throwInvalidArguments("expiresIn must be greather than 0", .{});
                expires = @intCast(expires_);
            }
        }
        credentialsWithOptions = try s3.getCredentialsWithOptions(options, globalThis);
    }
    const path = s3.path();

    const result = credentialsWithOptions.credentials.signRequest(.{
        .path = path,
        .method = method,
        .acl = credentialsWithOptions.acl,
        .storage_class = credentialsWithOptions.storage_class,
    }, false, .{ .expires = expires }) catch |sign_err| {
        return S3.throwSignError(sign_err, globalThis);
    };
    defer result.deinit();
    return bun.String.createUTF8ForJS(this.globalThis, result.url);
}
pub fn getBucketName(
    this: *const Blob,
) ?[]const u8 {
    const store = this.store orelse return null;
    if (store.data != .s3) return null;
    const credentials = store.data.s3.getCredentials();
    var full_path = store.data.s3.path();
    if (strings.startsWith(full_path, "/")) {
        full_path = full_path[1..];
    }
    var bucket: []const u8 = credentials.bucket;

    if (bucket.len == 0) {
        if (strings.indexOf(full_path, "/")) |end| {
            bucket = full_path[0..end];
            if (bucket.len > 0) {
                return bucket;
            }
        }
        return null;
    }
    return bucket;
}

pub fn getBucket(this: *Blob, globalThis: *JSC.JSGlobalObject) callconv(JSC.conv) JSValue {
    if (getBucketName(this)) |name| {
        return bun.String.createUTF8ForJS(globalThis, name);
    }
    return .js_undefined;
}
pub fn getPresignUrl(this: *Blob, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const args = callframe.arguments_old(1);
    return getPresignUrlFrom(this, globalThis, if (args.len > 0) args.ptr[0] else null);
}

pub fn getStat(this: *Blob, globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(JSC.conv) JSValue {
    return S3BlobStatTask.stat(globalThis, this);
}

pub fn stat(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = JSC.CallFrame.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }

    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("Expected a S3 or path to get size", .{});
    }

    switch (path_or_blob) {
        .path => |path| {
            const options = args.nextEat();
            if (path == .fd) {
                return globalThis.throwInvalidArguments("Expected a S3 or path to get size", .{});
            }
            var blob = try constructS3FileInternalStore(globalThis, path.path, options);
            defer blob.deinit();

            return S3BlobStatTask.stat(globalThis, &blob);
        },
        .blob => |*blob| {
            return S3BlobStatTask.stat(globalThis, blob);
        },
    }
}

pub fn constructInternalJS(
    globalObject: *JSC.JSGlobalObject,
    path: JSC.Node.PathLike,
    options: ?JSC.JSValue,
) bun.JSError!JSValue {
    const blob = try constructS3FileInternal(globalObject, path, options);
    return blob.toJS(globalObject);
}

pub fn toJSUnchecked(
    globalObject: *JSC.JSGlobalObject,
    this: *Blob,
) JSValue {
    return BUN__createJSS3FileUnsafely(globalObject, this);
}

pub fn constructInternal(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!*Blob {
    const vm = globalObject.bunVM();
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.CallFrame.ArgumentsSlice.init(vm, arguments);
    defer args.deinit();

    const path = (try JSC.Node.PathLike.fromJS(globalObject, &args)) orelse {
        return globalObject.throwInvalidArguments("Expected file path string", .{});
    };
    return constructS3FileInternal(globalObject, path, args.nextEat());
}

pub fn construct(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(JSC.conv) ?*Blob {
    return constructInternal(globalObject, callframe) catch |err| switch (err) {
        error.JSError => null,
        error.OutOfMemory => {
            _ = globalObject.throwOutOfMemoryValue();
            return null;
        },
    };
}
pub fn hasInstance(_: JSC.JSValue, _: *JSC.JSGlobalObject, value: JSC.JSValue) callconv(JSC.conv) bool {
    JSC.markBinding(@src());
    const blob = value.as(Blob) orelse return false;
    return blob.isS3();
}

comptime {
    @export(&exports.JSS3File__presign, .{ .name = "JSS3File__presign" });
    @export(&construct, .{ .name = "JSS3File__construct" });
    @export(&hasInstance, .{ .name = "JSS3File__hasInstance" });
    @export(&getBucket, .{ .name = "JSS3File__bucket" });
    @export(&getStat, .{ .name = "JSS3File__stat" });
}

pub const exports = struct {
    pub const JSS3File__presign = JSC.toJSHostFnWithContext(Blob, getPresignUrl);
    pub const JSS3File__stat = JSC.toJSHostFnWithContext(Blob, getStat);
};
extern fn BUN__createJSS3File(*JSC.JSGlobalObject, *JSC.CallFrame) callconv(JSC.conv) JSValue;
extern fn BUN__createJSS3FileUnsafely(*JSC.JSGlobalObject, *Blob) callconv(JSC.conv) JSValue;
pub fn createJSS3File(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) JSValue {
    return BUN__createJSS3File(globalObject, callframe);
}
