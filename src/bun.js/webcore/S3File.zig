const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const Blob = JSC.WebCore.Blob;
const PathOrBlob = JSC.Node.PathOrBlob;
const ZigString = JSC.ZigString;
const Method = bun.http.Method;

pub fn presign(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }

    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("S3.presign(pathOrS3, options) expects a S3 or path to presign", .{});
    }

    switch (path_or_blob) {
        .path => |path| {
            if (path == .fd) {
                return globalThis.throwInvalidArguments("S3.presign(pathOrS3, options) expects a S3 or path to presign", .{});
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
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }
    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("S3.unlink(pathOrS3) expects a S3 or path to delete", .{});
    }

    switch (path_or_blob) {
        .path => |path| {
            if (path == .fd) {
                return globalThis.throwInvalidArguments("S3.unlink(pathOrS3) expects a S3 or path to delete", .{});
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

pub fn upload(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(3).slice();
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }

    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("S3.upload(pathOrS3, blob) expects a S3 or path to upload", .{});
    }

    const data = args.nextEat() orelse {
        return globalThis.throwInvalidArguments("S3.upload(pathOrS3, blob) expects a Blob-y thing to upload", .{});
    };

    switch (path_or_blob) {
        .path => |path| {
            const options = args.nextEat();
            if (path == .fd) {
                return globalThis.throwInvalidArguments("S3.upload(pathOrS3, blob) expects a S3 or path to upload", .{});
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
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }

    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("S3.size(pathOrS3) expects a S3 or path to get size", .{});
    }

    switch (path_or_blob) {
        .path => |path| {
            const options = args.nextEat();
            if (path == .fd) {
                return globalThis.throwInvalidArguments("S3.size(pathOrS3) expects a S3 or path to get size", .{});
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
    var args = JSC.Node.ArgumentsSlice.init(globalThis.bunVM(), arguments);
    defer args.deinit();

    // accept a path or a blob
    var path_or_blob = try PathOrBlob.fromJSNoCopy(globalThis, &args);
    errdefer {
        if (path_or_blob == .path) {
            path_or_blob.path.deinit();
        }
    }

    if (path_or_blob == .blob and (path_or_blob.blob.store == null or path_or_blob.blob.store.?.data != .s3)) {
        return globalThis.throwInvalidArguments("S3.exists(pathOrS3) expects a S3 or path to check if it exists", .{});
    }

    switch (path_or_blob) {
        .path => |path| {
            const options = args.nextEat();
            if (path == .fd) {
                return globalThis.throwInvalidArguments("S3.exists(pathOrS3) expects a S3 or path to check if it exists", .{});
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

extern fn BUN__createJSS3FileConstructor(*JSC.JSGlobalObject) JSValue;

pub fn getJSS3FileConstructor(
    globalObject: *JSC.JSGlobalObject,
    _: *JSC.JSObject,
) callconv(JSC.conv) JSValue {
    return BUN__createJSS3FileConstructor(globalObject);
}

fn constructS3FileInternalStore(
    globalObject: *JSC.JSGlobalObject,
    path: JSC.Node.PathLike,
    options: ?JSC.JSValue,
) bun.JSError!Blob {
    // get credentials from env
    const existing_credentials = globalObject.bunVM().transpiler.env.getAWSCredentials();
    return constructS3FileWithAWSCredentials(globalObject, path, options, existing_credentials);
}
/// if the credentials have changed, we need to clone it, if not we can just ref/deref it
pub fn constructS3FileWithAWSCredentialsAndOptions(
    globalObject: *JSC.JSGlobalObject,
    path: JSC.Node.PathLike,
    options: ?JSC.JSValue,
    default_credentials: *AWS,
    default_options: bun.S3.MultiPartUpload.MultiPartUploadOptions,
) bun.JSError!Blob {
    var aws_options = try AWS.getCredentialsWithOptions(default_credentials.*, default_options, options, globalObject);
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

    var blob = Blob.initWithStore(store, globalObject);
    if (options) |opts| {
        if (try opts.getTruthy(globalObject, "type")) |file_type| {
            inner: {
                if (file_type.isString()) {
                    var allocator = bun.default_allocator;
                    var str = file_type.toSlice(globalObject, bun.default_allocator);
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
    return blob;
}

pub fn constructS3FileWithAWSCredentials(
    globalObject: *JSC.JSGlobalObject,
    path: JSC.Node.PathLike,
    options: ?JSC.JSValue,
    existing_credentials: AWS,
) bun.JSError!Blob {
    var aws_options = try AWS.getCredentialsWithOptions(existing_credentials, .{}, options, globalObject);
    defer aws_options.deinit();
    const store = Blob.Store.initS3(path, null, aws_options.credentials, bun.default_allocator) catch bun.outOfMemory();
    errdefer store.deinit();
    store.data.s3.options = aws_options.options;

    var blob = Blob.initWithStore(store, globalObject);
    if (options) |opts| {
        if (try opts.getTruthy(globalObject, "type")) |file_type| {
            inner: {
                if (file_type.isString()) {
                    var allocator = bun.default_allocator;
                    var str = file_type.toSlice(globalObject, bun.default_allocator);
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
pub fn constructS3FileInternalJS(
    globalObject: *JSC.JSGlobalObject,
    path: JSC.Node.PathLike,
    options: ?JSC.JSValue,
) bun.JSError!JSC.JSValue {
    var ptr = try constructS3FileInternal(globalObject, path, options);
    return ptr.toJS(globalObject);
}

pub fn constructS3File(
    globalObject: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const vm = globalObject.bunVM();
    const arguments = callframe.arguments_old(2).slice();
    var args = JSC.Node.ArgumentsSlice.init(vm, arguments);
    defer args.deinit();

    const path = (try JSC.Node.PathLike.fromJS(globalObject, &args)) orelse {
        return globalObject.throwInvalidArguments("Expected file path string", .{});
    };
    return constructS3FileInternalJS(globalObject, path, args.nextEat());
}

const AWS = bun.S3.AWSCredentials;

pub const S3BlobStatTask = struct {
    promise: JSC.JSPromise.Strong,
    store: *Blob.Store,
    usingnamespace bun.New(S3BlobStatTask);

    pub fn onS3ExistsResolved(result: AWS.S3StatResult, this: *S3BlobStatTask) void {
        defer this.deinit();
        const globalThis = this.promise.globalObject().?;
        switch (result) {
            .not_found => {
                this.promise.resolve(globalThis, .false);
            },
            .success => |_| {
                // calling .exists() should not prevent it to download a bigger file
                // this would make it download a slice of the actual value, if the file changes before we download it
                // if (this.blob.size == Blob.max_size) {
                //     this.blob.size = @truncate(stat.size);
                // }
                this.promise.resolve(globalThis, .true);
            },
            .failure => |err| {
                this.promise.rejectOnNextTick(globalThis, err.toJS(globalThis));
            },
        }
    }

    pub fn onS3SizeResolved(result: AWS.S3StatResult, this: *S3BlobStatTask) void {
        defer this.deinit();
        const globalThis = this.promise.globalObject().?;

        switch (result) {
            .not_found => {
                const js_err = globalThis
                    .ERR_S3_FILE_NOT_FOUND("File {} not found", .{bun.fmt.quote(this.store.data.s3.path())}).toJS();
                js_err.put(globalThis, ZigString.static("path"), ZigString.init(this.store.data.s3.path()).withEncoding().toJS(globalThis));

                this.promise.rejectOnNextTick(globalThis, js_err);
            },
            .success => |stat| {
                this.promise.resolve(globalThis, JSValue.jsNumber(stat.size));
            },
            .failure => |err| {
                this.promise.rejectOnNextTick(globalThis, err.toJS(globalThis));
            },
        }
    }

    pub fn exists(globalThis: *JSC.JSGlobalObject, blob: *Blob) JSValue {
        const this = S3BlobStatTask.new(.{
            .promise = JSC.JSPromise.Strong.init(globalThis),
            .store = blob.store.?,
        });
        this.store.ref();
        const promise = this.promise.value();
        const credentials = blob.store.?.data.s3.getCredentials();
        const path = blob.store.?.data.s3.path();
        const env = globalThis.bunVM().transpiler.env;

        credentials.s3Stat(path, @ptrCast(&S3BlobStatTask.onS3ExistsResolved), this, if (env.getHttpProxy(true, null)) |proxy| proxy.href else null);
        return promise;
    }

    pub fn size(globalThis: *JSC.JSGlobalObject, blob: *Blob) JSValue {
        const this = S3BlobStatTask.new(.{
            .promise = JSC.JSPromise.Strong.init(globalThis),
            .store = blob.store.?,
        });
        this.store.ref();
        const promise = this.promise.value();
        const credentials = blob.store.?.data.s3.getCredentials();
        const path = blob.store.?.data.s3.path();
        const env = globalThis.bunVM().transpiler.env;

        credentials.s3Stat(path, @ptrCast(&S3BlobStatTask.onS3SizeResolved), this, if (env.getHttpProxy(true, null)) |proxy| proxy.href else null);
        return promise;
    }

    pub fn deinit(this: *S3BlobStatTask) void {
        this.store.deref();
        this.promise.deinit();
        this.destroy();
    }
};

pub fn getPresignUrlFrom(this: *Blob, globalThis: *JSC.JSGlobalObject, extra_options: ?JSValue) bun.JSError!JSValue {
    if (!this.isS3()) {
        return globalThis.ERR_INVALID_THIS("presign is only possible for s3:// files", .{}).throw();
    }

    var method: bun.http.Method = .GET;
    var expires: usize = 86400; // 1 day default

    var credentialsWithOptions: AWS.AWSCredentialsWithOptions = .{
        .credentials = this.store.?.data.s3.getCredentials().*,
    };
    defer {
        credentialsWithOptions.deinit();
    }
    if (extra_options) |options| {
        if (options.isObject()) {
            if (try options.getTruthyComptime(globalThis, "method")) |method_| {
                method = Method.fromJS(globalThis, method_) orelse {
                    return globalThis.throwInvalidArguments("method must be GET, PUT, DELETE or HEAD when using s3 protocol", .{});
                };
            }
            if (try options.getOptional(globalThis, "expiresIn", i32)) |expires_| {
                if (expires_ <= 0) return globalThis.throwInvalidArguments("expiresIn must be greather than 0", .{});
                expires = @intCast(expires_);
            }
        }
        credentialsWithOptions = try this.store.?.data.s3.getCredentialsWithOptions(options, globalThis);
    }
    const path = this.store.?.data.s3.path();

    const result = credentialsWithOptions.credentials.signRequest(.{
        .path = path,
        .method = method,
    }, .{ .expires = expires }) catch |sign_err| {
        return AWS.throwSignError(sign_err, globalThis);
    };
    defer result.deinit();
    var str = bun.String.fromUTF8(result.url);
    return str.transferToJS(this.globalThis);
}

pub const exports = struct {
    pub const JSS3File__exists = JSC.toJSHostFunction(exists);
    pub const JSS3File__size = JSC.toJSHostFunction(size);
    pub const JSS3File__upload = JSC.toJSHostFunction(upload);
    pub const JSS3File__unlink = JSC.toJSHostFunction(unlink);
    pub const JSS3File__presign = JSC.toJSHostFunction(presign);

    pub fn JSS3File__hasInstance(_: JSC.JSValue, _: *JSC.JSGlobalObject, value: JSC.JSValue) callconv(JSC.conv) bool {
        JSC.markBinding(@src());
        const blob = value.as(Blob) orelse return false;
        return blob.isS3();
    }

    pub fn JSS3File__construct(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(JSC.conv) ?*Blob {
        const vm = globalThis.bunVM();
        const arguments = callframe.arguments_old(2).slice();
        var args = JSC.Node.ArgumentsSlice.init(vm, arguments);
        defer args.deinit();

        const path_or_fd = (JSC.Node.PathLike.fromJS(globalThis, &args)) catch |err| switch (err) {
            error.JSError => null,
            error.OutOfMemory => {
                globalThis.throwOutOfMemory() catch {};
                return null;
            },
        };
        if (path_or_fd == null) {
            globalThis.throwInvalidArguments("Expected file path string", .{}) catch return null;
            return null;
        }
        return constructS3FileInternal(globalThis, path_or_fd.?, args.nextEat()) catch |err| switch (err) {
            error.JSError => null,
            error.OutOfMemory => {
                globalThis.throwOutOfMemory() catch {};
                return null;
            },
        };
    }
};

const strings = bun.strings;

comptime {
    @export(exports.JSS3File__exists, .{ .name = "JSS3File__exists" });
    @export(exports.JSS3File__size, .{ .name = "JSS3File__size" });
    @export(exports.JSS3File__upload, .{ .name = "JSS3File__upload" });
    @export(exports.JSS3File__unlink, .{ .name = "JSS3File__unlink" });
    @export(exports.JSS3File__hasInstance, .{ .name = "JSS3File__hasInstance" });
    @export(exports.JSS3File__construct, .{ .name = "JSS3File__construct" });
    @export(exports.JSS3File__presign, .{ .name = "JSS3File__presign" });
}
