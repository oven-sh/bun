const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const picohttp = bun.picohttp;

pub const ACL = @import("./acl.zig").ACL;
pub const S3HttpDownloadStreamingTask = @import("./download_stream.zig").S3HttpDownloadStreamingTask;
pub const MultiPartUploadOptions = @import("./multipart_options.zig").MultiPartUploadOptions;
pub const MultiPartUpload = @import("./multipart.zig").MultiPartUpload;
pub const StorageClass = @import("./storage_class.zig").StorageClass;

pub const Error = @import("./error.zig");
pub const throwSignError = Error.throwSignError;
pub const getJSSignError = Error.getJSSignError;

const Credentials = @import("./credentials.zig");
pub const S3Credentials = Credentials.S3Credentials;
pub const S3CredentialsWithOptions = Credentials.S3CredentialsWithOptions;

const S3SimpleRequest = @import("./simple_request.zig");
pub const S3HttpSimpleTask = S3SimpleRequest.S3HttpSimpleTask;
pub const S3UploadResult = S3SimpleRequest.S3UploadResult;
pub const S3StatResult = S3SimpleRequest.S3StatResult;
pub const S3DownloadResult = S3SimpleRequest.S3DownloadResult;
pub const S3DeleteResult = S3SimpleRequest.S3DeleteResult;
const S3ListObjects = @import("./list_objects.zig");
pub const S3ListObjectsResult = S3SimpleRequest.S3ListObjectsResult;
pub const S3ListObjectsOptions = @import("./list_objects.zig").S3ListObjectsOptions;
pub const getListObjectsOptionsFromJS = S3ListObjects.getListObjectsOptionsFromJS;

pub fn stat(
    this: *S3Credentials,
    path: []const u8,
    callback: *const fn (S3StatResult, *anyopaque) void,
    callback_context: *anyopaque,
    proxy_url: ?[]const u8,
) void {
    S3SimpleRequest.executeSimpleS3Request(this, .{
        .path = path,
        .method = .HEAD,
        .proxy_url = proxy_url,
        .body = "",
    }, .{ .stat = callback }, callback_context);
}

pub fn download(
    this: *S3Credentials,
    path: []const u8,
    callback: *const fn (S3DownloadResult, *anyopaque) void,
    callback_context: *anyopaque,
    proxy_url: ?[]const u8,
) void {
    S3SimpleRequest.executeSimpleS3Request(this, .{
        .path = path,
        .method = .GET,
        .proxy_url = proxy_url,
        .body = "",
    }, .{ .download = callback }, callback_context);
}

pub fn downloadSlice(
    this: *S3Credentials,
    path: []const u8,
    offset: usize,
    size: ?usize,
    callback: *const fn (S3DownloadResult, *anyopaque) void,
    callback_context: *anyopaque,
    proxy_url: ?[]const u8,
) void {
    const range = brk: {
        if (size) |size_| {
            var end = (offset + size_);
            if (size_ > 0) {
                end -= 1;
            }
            break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-{}", .{ offset, end }) catch bun.outOfMemory();
        }
        if (offset == 0) break :brk null;
        break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-", .{offset}) catch bun.outOfMemory();
    };

    S3SimpleRequest.executeSimpleS3Request(this, .{
        .path = path,
        .method = .GET,
        .proxy_url = proxy_url,
        .body = "",
        .range = range,
    }, .{ .download = callback }, callback_context);
}

pub fn delete(
    this: *S3Credentials,
    path: []const u8,
    callback: *const fn (S3DeleteResult, *anyopaque) void,
    callback_context: *anyopaque,
    proxy_url: ?[]const u8,
) void {
    S3SimpleRequest.executeSimpleS3Request(this, .{
        .path = path,
        .method = .DELETE,
        .proxy_url = proxy_url,
        .body = "",
    }, .{ .delete = callback }, callback_context);
}

pub fn listObjects(
    this: *S3Credentials,
    listOptions: S3ListObjectsOptions,
    callback: *const fn (S3ListObjectsResult, *anyopaque) void,
    callback_context: *anyopaque,
    proxy_url: ?[]const u8,
) void {
    var search_params: bun.ByteList = .{};

    search_params.append(bun.default_allocator, "?") catch bun.outOfMemory();

    if (listOptions.continuation_token) |continuation_token| {
        var buff: [1024]u8 = undefined;
        const encoded = S3Credentials.encodeURIComponent(continuation_token, &buff, true) catch bun.outOfMemory();
        search_params.appendFmt(bun.default_allocator, "continuation-token={s}", .{encoded}) catch bun.outOfMemory();
    }

    if (listOptions.delimiter) |delimiter| {
        var buff: [1024]u8 = undefined;
        const encoded = S3Credentials.encodeURIComponent(delimiter, &buff, true) catch bun.outOfMemory();

        if (listOptions.continuation_token != null) {
            search_params.appendFmt(bun.default_allocator, "&delimiter={s}", .{encoded}) catch bun.outOfMemory();
        } else {
            search_params.appendFmt(bun.default_allocator, "delimiter={s}", .{encoded}) catch bun.outOfMemory();
        }
    }

    if (listOptions.encoding_type != null) {
        if (listOptions.continuation_token != null or listOptions.delimiter != null) {
            search_params.append(bun.default_allocator, "&encoding-type=url") catch bun.outOfMemory();
        } else {
            search_params.append(bun.default_allocator, "encoding-type=url") catch bun.outOfMemory();
        }
    }

    if (listOptions.fetch_owner) |fetch_owner| {
        if (listOptions.continuation_token != null or listOptions.delimiter != null or listOptions.encoding_type != null) {
            search_params.appendFmt(bun.default_allocator, "&fetch-owner={}", .{fetch_owner}) catch bun.outOfMemory();
        } else {
            search_params.appendFmt(bun.default_allocator, "fetch-owner={}", .{fetch_owner}) catch bun.outOfMemory();
        }
    }

    if (listOptions.continuation_token != null or listOptions.delimiter != null or listOptions.encoding_type != null or listOptions.fetch_owner != null) {
        search_params.append(bun.default_allocator, "&list-type=2") catch bun.outOfMemory();
    } else {
        search_params.append(bun.default_allocator, "list-type=2") catch bun.outOfMemory();
    }

    if (listOptions.max_keys) |max_keys| {
        search_params.appendFmt(bun.default_allocator, "&max-keys={}", .{max_keys}) catch bun.outOfMemory();
    }

    if (listOptions.prefix) |prefix| {
        var buff: [1024]u8 = undefined;
        const encoded = S3Credentials.encodeURIComponent(prefix, &buff, true) catch bun.outOfMemory();
        search_params.appendFmt(bun.default_allocator, "&prefix={s}", .{encoded}) catch bun.outOfMemory();
    }

    if (listOptions.start_after) |start_after| {
        var buff: [1024]u8 = undefined;
        const encoded = S3Credentials.encodeURIComponent(start_after, &buff, true) catch bun.outOfMemory();
        search_params.appendFmt(bun.default_allocator, "&start-after={s}", .{encoded}) catch bun.outOfMemory();
    }

    const result = this.signRequest(.{
        .path = "",
        .method = .GET,
        .search_params = search_params.slice(),
    }, true, null) catch |sign_err| {
        search_params.deinitWithAllocator(bun.default_allocator);

        const error_code_and_message = Error.getSignErrorCodeAndMessage(sign_err);
        callback(.{ .failure = .{ .code = error_code_and_message.code, .message = error_code_and_message.message } }, callback_context);

        return;
    };

    search_params.deinitWithAllocator(bun.default_allocator);

    const headers = bun.http.Headers.fromPicoHttpHeaders(result.headers(), bun.default_allocator) catch bun.outOfMemory();

    const task = bun.new(S3HttpSimpleTask, .{
        .http = undefined,
        .range = null,
        .sign_result = result,
        .callback_context = callback_context,
        .callback = .{ .listObjects = callback },
        .headers = headers,
        .vm = JSC.VirtualMachine.get(),
    });

    task.poll_ref.ref(task.vm);

    const url = bun.URL.parse(result.url);
    const proxy = proxy_url orelse "";

    task.http = bun.http.AsyncHTTP.init(
        bun.default_allocator,
        .GET,
        url,
        task.headers.entries,
        task.headers.buf.items,
        &task.response_buffer,
        "",
        bun.http.HTTPClientResult.Callback.New(
            *S3HttpSimpleTask,
            S3HttpSimpleTask.httpCallback,
        ).init(task),
        .follow,
        .{
            .http_proxy = if (proxy.len > 0) bun.URL.parse(proxy) else null,
            .verbose = task.vm.getVerboseFetch(),
            .reject_unauthorized = task.vm.getTLSRejectUnauthorized(),
        },
    );

    // queue http request
    bun.http.HTTPThread.init(&.{});
    var batch = bun.ThreadPool.Batch{};
    task.http.schedule(bun.default_allocator, &batch);
    bun.http.http_thread.schedule(batch);
}

pub fn upload(
    this: *S3Credentials,
    path: []const u8,
    content: []const u8,
    content_type: ?[]const u8,
    acl: ?ACL,
    proxy_url: ?[]const u8,
    storage_class: ?StorageClass,
    callback: *const fn (S3UploadResult, *anyopaque) void,
    callback_context: *anyopaque,
) void {
    S3SimpleRequest.executeSimpleS3Request(this, .{
        .path = path,
        .method = .PUT,
        .proxy_url = proxy_url,
        .body = content,
        .content_type = content_type,
        .acl = acl,
        .storage_class = storage_class,
    }, .{ .upload = callback }, callback_context);
}
/// returns a writable stream that writes to the s3 path
pub fn writableStream(
    this: *S3Credentials,
    path: []const u8,
    globalThis: *JSC.JSGlobalObject,
    options: MultiPartUploadOptions,
    content_type: ?[]const u8,
    proxy: ?[]const u8,
    storage_class: ?StorageClass,
) bun.JSError!JSC.JSValue {
    const Wrapper = struct {
        pub fn callback(result: S3UploadResult, sink: *JSC.WebCore.NetworkSink) void {
            if (sink.endPromise.hasValue()) {
                const event_loop = sink.globalThis.bunVM().eventLoop();
                event_loop.enter();
                defer event_loop.exit();
                switch (result) {
                    .success => {
                        sink.endPromise.resolve(sink.globalThis, JSC.jsNumber(0));
                    },
                    .failure => |err| {
                        if (!sink.done) {
                            sink.abort();
                            return;
                        }

                        sink.endPromise.reject(sink.globalThis, err.toJS(sink.globalThis, sink.path()));
                    },
                }
            }
            sink.finalize();
        }
    };
    const proxy_url = (proxy orelse "");
    this.ref(); // ref the credentials
    const task = bun.new(MultiPartUpload, .{
        .ref_count = .init(),
        .credentials = this,
        .path = bun.default_allocator.dupe(u8, path) catch bun.outOfMemory(),
        .proxy = if (proxy_url.len > 0) bun.default_allocator.dupe(u8, proxy_url) catch bun.outOfMemory() else "",
        .content_type = if (content_type) |ct| bun.default_allocator.dupe(u8, ct) catch bun.outOfMemory() else null,
        .storage_class = storage_class,

        .callback = @ptrCast(&Wrapper.callback),
        .callback_context = undefined,
        .globalThis = globalThis,
        .options = options,
        .vm = JSC.VirtualMachine.get(),
    });

    task.poll_ref.ref(task.vm);

    task.ref(); // + 1 for the stream
    var response_stream = JSC.WebCore.NetworkSink.new(.{
        .task = .{ .s3_upload = task },
        .buffer = .{},
        .globalThis = globalThis,
        .encoded = false,
        .endPromise = JSC.JSPromise.Strong.init(globalThis),
    }).toSink();

    task.callback_context = @ptrCast(response_stream);
    var signal = &response_stream.sink.signal;

    signal.* = JSC.WebCore.NetworkSink.JSSink.SinkSignal.init(.zero);

    // explicitly set it to a dead pointer
    // we use this memory address to disable signals being sent
    signal.clear();
    bun.assert(signal.isDead());
    return response_stream.sink.toJS(globalThis);
}

const S3UploadStreamWrapper = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    ref_count: RefCount,
    readable_stream_ref: JSC.WebCore.ReadableStream.Strong,
    sink: *JSC.WebCore.NetworkSink,
    task: *MultiPartUpload,
    callback: ?*const fn (S3UploadResult, *anyopaque) void,
    callback_context: *anyopaque,
    path: []const u8, // this is owned by the task not by the wrapper
    global: *JSC.JSGlobalObject,

    pub fn resolve(result: S3UploadResult, self: *@This()) void {
        const sink = self.sink;
        defer self.deref();
        if (sink.endPromise.hasValue()) {
            switch (result) {
                .success => sink.endPromise.resolve(self.global, JSC.jsNumber(0)),
                .failure => |err| {
                    if (!sink.done) {
                        sink.abort();
                        return;
                    }
                    sink.endPromise.reject(self.global, err.toJS(self.global, self.path));
                },
            }
        }
        if (self.callback) |callback| {
            callback(result, self.callback_context);
        }
    }

    fn deinit(self: *@This()) void {
        self.readable_stream_ref.deinit();
        self.sink.finalize();
        self.sink.deinit();
        self.task.deref();
        bun.destroy(self);
    }
};

pub fn onUploadStreamResolveRequestStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var args = callframe.arguments_old(2);
    var this = args.ptr[args.len - 1].asPromisePtr(S3UploadStreamWrapper);
    defer this.deref();

    if (this.readable_stream_ref.get(globalThis)) |stream| {
        stream.done(globalThis);
    }
    this.readable_stream_ref.deinit();
    this.task.continueStream();

    return .js_undefined;
}

pub fn onUploadStreamRejectRequestStream(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const args = callframe.arguments_old(2);
    var this = args.ptr[args.len - 1].asPromisePtr(S3UploadStreamWrapper);
    defer this.deref();

    const err = args.ptr[0];
    if (this.sink.endPromise.hasValue()) {
        this.sink.endPromise.reject(globalThis, err);
    }

    if (this.readable_stream_ref.get(globalThis)) |stream| {
        stream.cancel(globalThis);
        this.readable_stream_ref.deinit();
    }
    if (this.sink.task) |task| {
        if (task == .s3_upload) {
            task.s3_upload.fail(.{
                .code = "UnknownError",
                .message = "ReadableStream ended with an error",
            });
        }
    }
    this.task.continueStream();

    return .js_undefined;
}
comptime {
    const jsonResolveRequestStream = JSC.toJSHostFn(onUploadStreamResolveRequestStream);
    @export(&jsonResolveRequestStream, .{ .name = "Bun__S3UploadStream__onResolveRequestStream" });
    const jsonRejectRequestStream = JSC.toJSHostFn(onUploadStreamRejectRequestStream);
    @export(&jsonRejectRequestStream, .{ .name = "Bun__S3UploadStream__onRejectRequestStream" });
}

/// consumes the readable stream and upload to s3
pub fn uploadStream(
    this: *S3Credentials,
    path: []const u8,
    readable_stream: JSC.WebCore.ReadableStream,
    globalThis: *JSC.JSGlobalObject,
    options: MultiPartUploadOptions,
    acl: ?ACL,
    storage_class: ?StorageClass,
    content_type: ?[]const u8,
    proxy: ?[]const u8,
    callback: ?*const fn (S3UploadResult, *anyopaque) void,
    callback_context: *anyopaque,
) JSC.JSValue {
    this.ref(); // ref the credentials
    const proxy_url = (proxy orelse "");

    if (readable_stream.isDisturbed(globalThis)) {
        return JSC.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, bun.String.static("ReadableStream is already disturbed").toErrorInstance(globalThis));
    }

    switch (readable_stream.ptr) {
        .Invalid => {
            return JSC.JSPromise.dangerouslyCreateRejectedPromiseValueWithoutNotifyingVM(globalThis, bun.String.static("ReadableStream is invalid").toErrorInstance(globalThis));
        },
        inline .File, .Bytes => |stream| {
            if (stream.pending.result == .err) {
                // we got an error, fail early
                const err = stream.pending.result.err;
                stream.pending = .{ .result = .{ .done = {} } };
                const js_err, const was_strong = err.toJSWeak(globalThis);
                if (was_strong == .Strong) {
                    js_err.unprotect();
                }
                js_err.ensureStillAlive();
                return JSC.JSPromise.rejectedPromise(globalThis, js_err).toJS();
            }
        },
        else => {},
    }

    const task = bun.new(MultiPartUpload, .{
        .ref_count = .init(),
        .credentials = this,
        .path = bun.default_allocator.dupe(u8, path) catch bun.outOfMemory(),
        .proxy = if (proxy_url.len > 0) bun.default_allocator.dupe(u8, proxy_url) catch bun.outOfMemory() else "",
        .content_type = if (content_type) |ct| bun.default_allocator.dupe(u8, ct) catch bun.outOfMemory() else null,
        .callback = @ptrCast(&S3UploadStreamWrapper.resolve),
        .callback_context = undefined,
        .globalThis = globalThis,
        .state = .wait_stream_check,
        .options = options,
        .acl = acl,
        .storage_class = storage_class,
        .vm = JSC.VirtualMachine.get(),
    });

    task.poll_ref.ref(task.vm);

    task.ref(); // + 1 for the stream sink

    var response_stream = JSC.WebCore.NetworkSink.new(.{
        .task = .{ .s3_upload = task },
        .buffer = .{},
        .globalThis = globalThis,
        .encoded = false,
        .endPromise = JSC.JSPromise.Strong.init(globalThis),
    }).toSink();
    task.ref(); // + 1 for the stream wrapper

    const endPromise = response_stream.sink.endPromise.value();
    const ctx = bun.new(S3UploadStreamWrapper, .{
        .ref_count = .init(),
        .readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(readable_stream, globalThis),
        .sink = &response_stream.sink,
        .callback = callback,
        .callback_context = callback_context,
        .path = task.path,
        .task = task,
        .global = globalThis,
    });
    task.callback_context = @ptrCast(ctx);
    // keep the task alive until we are done configuring the signal
    task.ref();
    defer task.deref();

    var signal = &response_stream.sink.signal;

    signal.* = JSC.WebCore.NetworkSink.JSSink.SinkSignal.init(.zero);

    // explicitly set it to a dead pointer
    // we use this memory address to disable signals being sent
    signal.clear();
    bun.assert(signal.isDead());

    // We are already corked!
    const assignment_result: JSC.JSValue = JSC.WebCore.NetworkSink.JSSink.assignToStream(
        globalThis,
        readable_stream.value,
        response_stream,
        @as(**anyopaque, @ptrCast(&signal.ptr)),
    );

    assignment_result.ensureStillAlive();

    // assert that it was updated
    bun.assert(!signal.isDead());

    if (assignment_result.toError()) |err| {
        if (response_stream.sink.endPromise.hasValue()) {
            response_stream.sink.endPromise.reject(globalThis, err);
        }

        task.fail(.{
            .code = "UnknownError",
            .message = "ReadableStream ended with an error",
        });
        readable_stream.cancel(globalThis);
        return endPromise;
    }

    if (!assignment_result.isEmptyOrUndefinedOrNull()) {
        assignment_result.ensureStillAlive();
        // it returns a Promise when it goes through ReadableStreamDefaultReader
        if (assignment_result.asAnyPromise()) |promise| {
            switch (promise.status(globalThis.vm())) {
                .pending => {
                    // if we eended and its not canceled the promise is the endPromise
                    // because assignToStream can return the sink.end() promise
                    // we set the endPromise in the NetworkSink so we need to resolve it
                    if (response_stream.sink.ended and !response_stream.sink.cancel) {
                        task.continueStream();

                        readable_stream.done(globalThis);
                        return endPromise;
                    }
                    ctx.ref();

                    assignment_result.then(
                        globalThis,
                        task.callback_context,
                        onUploadStreamResolveRequestStream,
                        onUploadStreamRejectRequestStream,
                    );
                    // we need to wait the promise to resolve because can be an error/cancel here
                    if (!task.ended)
                        task.continueStream();
                },
                .fulfilled => {
                    task.continueStream();

                    readable_stream.done(globalThis);
                },
                .rejected => {
                    if (response_stream.sink.endPromise.hasValue()) {
                        response_stream.sink.endPromise.reject(globalThis, promise.result(globalThis.vm()));
                    }

                    task.fail(.{
                        .code = "UnknownError",
                        .message = "ReadableStream ended with an error",
                    });
                    readable_stream.cancel(globalThis);
                },
            }
        } else {
            if (response_stream.sink.endPromise.hasValue()) {
                response_stream.sink.endPromise.reject(globalThis, assignment_result);
            }

            task.fail(.{
                .code = "UnknownError",
                .message = "ReadableStream ended with an error",
            });
            readable_stream.cancel(globalThis);
        }
    }
    return endPromise;
}

/// download a file from s3 chunk by chunk aka streaming (used on readableStream)
pub fn downloadStream(
    this: *S3Credentials,
    path: []const u8,
    offset: usize,
    size: ?usize,
    proxy_url: ?[]const u8,
    callback: *const fn (chunk: bun.MutableString, has_more: bool, err: ?Error.S3Error, *anyopaque) void,
    callback_context: *anyopaque,
) void {
    const range = brk: {
        if (size) |size_| {
            if (offset == 0) break :brk null;

            var end = (offset + size_);
            if (size_ > 0) {
                end -= 1;
            }
            break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-{}", .{ offset, end }) catch bun.outOfMemory();
        }
        if (offset == 0) break :brk null;
        break :brk std.fmt.allocPrint(bun.default_allocator, "bytes={}-", .{offset}) catch bun.outOfMemory();
    };

    var result = this.signRequest(.{
        .path = path,
        .method = .GET,
    }, false, null) catch |sign_err| {
        if (range) |range_| bun.default_allocator.free(range_);
        const error_code_and_message = Error.getSignErrorCodeAndMessage(sign_err);
        callback(.{ .allocator = bun.default_allocator, .list = .{} }, false, .{
            .code = error_code_and_message.code,
            .message = error_code_and_message.message,
        }, callback_context);
        return;
    };

    var header_buffer: [10]picohttp.Header = undefined;
    const headers = brk: {
        if (range) |range_| {
            const _headers = result.mixWithHeader(&header_buffer, .{ .name = "range", .value = range_ });
            break :brk bun.http.Headers.fromPicoHttpHeaders(_headers, bun.default_allocator) catch bun.outOfMemory();
        } else {
            break :brk bun.http.Headers.fromPicoHttpHeaders(result.headers(), bun.default_allocator) catch bun.outOfMemory();
        }
    };
    const proxy = proxy_url orelse "";
    const owned_proxy = if (proxy.len > 0) bun.default_allocator.dupe(u8, proxy) catch bun.outOfMemory() else "";
    const task = S3HttpDownloadStreamingTask.new(.{
        .http = undefined,
        .sign_result = result,
        .proxy_url = owned_proxy,
        .callback_context = callback_context,
        .callback = callback,
        .range = range,
        .headers = headers,
        .vm = JSC.VirtualMachine.get(),
    });
    task.poll_ref.ref(task.vm);

    const url = bun.URL.parse(result.url);

    task.signals = task.signal_store.to();

    task.http = bun.http.AsyncHTTP.init(
        bun.default_allocator,
        .GET,
        url,
        task.headers.entries,
        task.headers.buf.items,
        &task.response_buffer,
        "",
        bun.http.HTTPClientResult.Callback.New(
            *S3HttpDownloadStreamingTask,
            S3HttpDownloadStreamingTask.httpCallback,
        ).init(task),
        .follow,
        .{
            .http_proxy = if (owned_proxy.len > 0) bun.URL.parse(owned_proxy) else null,
            .verbose = task.vm.getVerboseFetch(),
            .signals = task.signals,
            .reject_unauthorized = task.vm.getTLSRejectUnauthorized(),
        },
    );
    // enable streaming
    task.http.enableBodyStreaming();
    // queue http request
    bun.http.HTTPThread.init(&.{});
    var batch = bun.ThreadPool.Batch{};
    task.http.schedule(bun.default_allocator, &batch);
    bun.http.http_thread.schedule(batch);
}

/// returns a readable stream that reads from the s3 path
pub fn readableStream(
    this: *S3Credentials,
    path: []const u8,
    offset: usize,
    size: ?usize,
    proxy_url: ?[]const u8,
    globalThis: *JSC.JSGlobalObject,
) JSC.JSValue {
    var reader = JSC.WebCore.ByteStream.Source.new(.{
        .context = undefined,
        .globalThis = globalThis,
    });

    reader.context.setup();
    const readable_value = reader.toReadableStream(globalThis);

    const S3DownloadStreamWrapper = struct {
        pub const new = bun.TrivialNew(@This());

        readable_stream_ref: JSC.WebCore.ReadableStream.Strong,
        path: []const u8,
        global: *JSC.JSGlobalObject,

        pub fn callback(chunk: bun.MutableString, has_more: bool, request_err: ?Error.S3Error, self: *@This()) void {
            defer if (!has_more) self.deinit();

            if (self.readable_stream_ref.get(self.global)) |readable| {
                if (readable.ptr == .Bytes) {
                    if (request_err) |err| {
                        readable.ptr.Bytes.onData(
                            .{ .err = .{ .JSValue = err.toJS(self.global, self.path) } },
                            bun.default_allocator,
                        );
                        return;
                    }
                    if (has_more) {
                        readable.ptr.Bytes.onData(
                            .{ .temporary = bun.ByteList.initConst(chunk.list.items) },
                            bun.default_allocator,
                        );
                        return;
                    }

                    readable.ptr.Bytes.onData(
                        .{ .temporary_and_done = bun.ByteList.initConst(chunk.list.items) },
                        bun.default_allocator,
                    );
                    return;
                }
            }
        }

        pub fn deinit(self: *@This()) void {
            self.readable_stream_ref.deinit();
            bun.default_allocator.free(self.path);
            bun.destroy(self);
        }

        pub fn opaqueCallback(chunk: bun.MutableString, has_more: bool, err: ?Error.S3Error, opaque_self: *anyopaque) void {
            const self: *@This() = @ptrCast(@alignCast(opaque_self));
            callback(chunk, has_more, err, self);
        }
    };

    downloadStream(
        this,
        path,
        offset,
        size,
        proxy_url,
        S3DownloadStreamWrapper.opaqueCallback,
        S3DownloadStreamWrapper.new(.{
            .readable_stream_ref = JSC.WebCore.ReadableStream.Strong.init(.{
                .ptr = .{ .Bytes = &reader.context },
                .value = readable_value,
            }, globalThis),
            .path = bun.default_allocator.dupe(u8, path) catch bun.outOfMemory(),
            .global = globalThis,
        }),
    );
    return readable_value;
}
