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
            if (sink.endPromise.hasValue() or sink.flushPromise.hasValue()) {
                const event_loop = sink.globalThis.bunVM().eventLoop();
                event_loop.enter();
                defer event_loop.exit();
                switch (result) {
                    .success => {
                        if (sink.flushPromise.hasValue()) {
                            sink.flushPromise.resolve(sink.globalThis, JSC.jsNumber(0));
                        }
                        if (sink.endPromise.hasValue()) {
                            sink.endPromise.resolve(sink.globalThis, JSC.jsNumber(0));
                        }
                    },
                    .failure => |err| {
                        const js_err = err.toJS(sink.globalThis, sink.path());
                        if (sink.flushPromise.hasValue()) {
                            sink.flushPromise.reject(sink.globalThis, js_err);
                        }
                        if (sink.endPromise.hasValue()) {
                            sink.endPromise.reject(sink.globalThis, js_err);
                        }
                        if (!sink.done) {
                            sink.abort();
                        }
                    },
                }
            }
            sink.finalize();
        }
    };
    const proxy_url = (proxy orelse "");
    this.ref(); // ref the credentials
    const task = bun.new(MultiPartUpload, .{
        .ref_count = .initExactRefs(2), // +1 for the stream
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

    var response_stream = JSC.WebCore.NetworkSink.new(.{
        .task = task,
        .globalThis = globalThis,
        .highWaterMark = @truncate(options.partSize),
    }).toSink();

    task.callback_context = @ptrCast(response_stream);
    task.onWritable = @ptrCast(&JSC.WebCore.NetworkSink.onWritable);
    var signal = &response_stream.sink.signal;

    signal.* = JSC.WebCore.NetworkSink.JSSink.SinkSignal.init(.zero);

    // explicitly set it to a dead pointer
    // we use this memory address to disable signals being sent
    signal.clear();
    bun.assert(signal.isDead());
    return response_stream.sink.toJS(globalThis);
}

pub const S3UploadStreamWrapper = struct {
    const RefCount = bun.ptr.RefCount(@This(), "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;
    pub const ResumableSink = @import("../bun.js/webcore/ResumableSink.zig").ResumableS3UploadSink;
    const log = bun.Output.scoped(.S3UploadStream, false);

    ref_count: RefCount,

    sink: ?*ResumableSink,
    task: *MultiPartUpload,
    endPromise: JSC.JSPromise.Strong,
    callback: ?*const fn (S3UploadResult, *anyopaque) void,
    callback_context: *anyopaque,
    path: []const u8, // this is owned by the task not by the wrapper
    global: *JSC.JSGlobalObject,

    fn detachSink(self: *@This()) void {
        log("detachSink {}", .{self.sink != null});
        if (self.sink) |sink| {
            self.sink = null;
            sink.deref();
        }
    }
    pub fn onWritable(task: *MultiPartUpload, self: *@This(), _: u64) void {
        log("onWritable {} {}", .{ self.sink != null, task.ended });
        // end was called we dont need to drain anymore
        if (task.ended) return;
        // we have more space in the queue, drain it
        if (self.sink) |sink| {
            sink.drain();
        }
    }

    pub fn writeRequestData(this: *@This(), data: []const u8) bool {
        log("writeRequestData {}", .{data.len});
        return this.task.writeBytes(data, false) catch bun.outOfMemory();
    }

    pub fn writeEndRequest(this: *@This(), err: ?JSC.JSValue) void {
        log("writeEndRequest {}", .{err != null});
        this.detachSink();
        defer this.deref();
        if (err) |js_err| {
            if (this.endPromise.hasValue() and !js_err.isEmptyOrUndefinedOrNull()) {
                // if we have a explicit error, reject the promise
                // if not when calling .fail will create a S3Error instance
                // this match the previous behavior
                this.endPromise.reject(this.global, js_err);
                this.endPromise = .empty;
            }
            if (!this.task.ended) {
                this.task.fail(.{
                    .code = "UnknownError",
                    .message = "ReadableStream ended with an error",
                });
            }
        } else {
            _ = this.task.writeBytes("", true) catch bun.outOfMemory();
        }
    }

    pub fn resolve(result: S3UploadResult, self: *@This()) void {
        log("resolve {any}", .{result});
        defer self.deref();
        switch (result) {
            .success => {
                if (self.endPromise.hasValue()) {
                    self.endPromise.resolve(self.global, JSC.jsNumber(0));
                    self.endPromise = .empty;
                }
            },
            .failure => |err| {
                if (self.sink) |sink| {
                    self.sink = null;
                    // sink in progress, cancel it (will call writeEndRequest for cleanup and will reject the endPromise)
                    sink.cancel(err.toJS(self.global, self.path));
                    sink.deref();
                } else if (self.endPromise.hasValue()) {
                    self.endPromise.reject(self.global, err.toJS(self.global, self.path));
                    self.endPromise = .empty;
                }
            },
        }

        if (self.callback) |callback| {
            callback(result, self.callback_context);
        }
    }

    fn deinit(self: *@This()) void {
        log("deinit {}", .{self.sink != null});
        self.detachSink();
        self.task.deref();
        self.endPromise.deinit();
        bun.destroy(self);
    }
};

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
        return JSC.JSPromise.rejectedPromise(globalThis, bun.String.static("ReadableStream is already disturbed").toErrorInstance(globalThis)).toJS();
    }

    switch (readable_stream.ptr) {
        .Invalid => {
            return JSC.JSPromise.rejectedPromise(globalThis, bun.String.static("ReadableStream is invalid").toErrorInstance(globalThis)).toJS();
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
        .ref_count = .initExactRefs(2), // +1 for the stream ctx (only deinit after task and context ended)
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

    const ctx = bun.new(S3UploadStreamWrapper, .{
        .ref_count = .initExactRefs(2), // +1 for the stream sink (only deinit after both sink and task ended)
        .sink = null,
        .callback = callback,
        .callback_context = callback_context,
        .path = task.path,
        .task = task,
        .endPromise = JSC.JSPromise.Strong.init(globalThis),
        .global = globalThis,
    });
    // +1 because the ctx refs the sink
    ctx.sink = S3UploadStreamWrapper.ResumableSink.initExactRefs(globalThis, readable_stream, ctx, 2);
    task.callback_context = @ptrCast(ctx);
    task.onWritable = @ptrCast(&S3UploadStreamWrapper.onWritable);
    task.continueStream();
    return ctx.endPromise.value();
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
