const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const strings = bun.strings;
const SignResult = @import("./credentials.zig").S3Credentials.SignResult;
const S3Error = @import("./error.zig").S3Error;
const getSignErrorCodeAndMessage = @import("./error.zig").getSignErrorCodeAndMessage;
const S3Credentials = @import("./credentials.zig").S3Credentials;
const picohttp = bun.picohttp;
const ACL = @import("./acl.zig").ACL;
const StorageClass = @import("./storage_class.zig").StorageClass;
const ListObjects = @import("./list_objects.zig");

pub const S3StatResult = union(enum) {
    success: struct {
        size: usize = 0,
        /// etag is not owned and need to be copied if used after this callback
        etag: []const u8 = "",
        /// format: Mon, 06 Jan 2025 22:40:57 GMT, lastModified is not owned and need to be copied if used after this callback
        lastModified: []const u8 = "",
        /// format: text/plain, contentType is not owned and need to be copied if used after this callback
        contentType: []const u8 = "",
    },
    not_found: S3Error,

    /// failure error is not owned and need to be copied if used after this callback
    failure: S3Error,
};
pub const S3DownloadResult = union(enum) {
    success: struct {
        /// etag is not owned and need to be copied if used after this callback
        etag: []const u8 = "",
        /// body is owned and dont need to be copied, but dont forget to free it
        body: bun.MutableString,
    },
    not_found: S3Error,
    /// failure error is not owned and need to be copied if used after this callback
    failure: S3Error,
};
pub const S3UploadResult = union(enum) {
    success: void,
    /// failure error is not owned and need to be copied if used after this callback
    failure: S3Error,
};
pub const S3DeleteResult = union(enum) {
    success: void,
    not_found: S3Error,

    /// failure error is not owned and need to be copied if used after this callback
    failure: S3Error,
};
pub const S3ListObjectsResult = union(enum) {
    success: ListObjects.S3ListObjectsV2Result,
    not_found: S3Error,

    /// failure error is not owned and need to be copied if used after this callback
    failure: S3Error,
};

// commit result also fails if status 200 but with body containing an Error
pub const S3CommitResult = union(enum) {
    success: void,
    /// failure error is not owned and need to be copied if used after this callback
    failure: S3Error,
};
// commit result also fails if status 200 but with body containing an Error
pub const S3PartResult = union(enum) {
    etag: []const u8,
    /// failure error is not owned and need to be copied if used after this callback
    failure: S3Error,
};

pub const S3HttpSimpleTask = struct {
    http: bun.http.AsyncHTTP,
    vm: *JSC.VirtualMachine,
    sign_result: SignResult,
    headers: JSC.WebCore.Headers,
    callback_context: *anyopaque,
    callback: Callback,
    response_buffer: bun.MutableString = .{
        .allocator = bun.default_allocator,
        .list = .{
            .items = &.{},
            .capacity = 0,
        },
    },
    result: bun.http.HTTPClientResult = .{},
    concurrent_task: JSC.ConcurrentTask = .{},
    range: ?[]const u8,
    poll_ref: bun.Async.KeepAlive = bun.Async.KeepAlive.init(),

    usingnamespace bun.New(@This());
    pub const Callback = union(enum) {
        stat: *const fn (S3StatResult, *anyopaque) void,
        download: *const fn (S3DownloadResult, *anyopaque) void,
        upload: *const fn (S3UploadResult, *anyopaque) void,
        delete: *const fn (S3DeleteResult, *anyopaque) void,
        listObjects: *const fn (S3ListObjectsResult, *anyopaque) void,
        commit: *const fn (S3CommitResult, *anyopaque) void,
        part: *const fn (S3PartResult, *anyopaque) void,

        pub fn fail(this: @This(), code: []const u8, message: []const u8, context: *anyopaque) void {
            switch (this) {
                inline .upload,
                .download,
                .stat,
                .delete,
                .listObjects,
                .commit,
                .part,
                => |callback| callback(.{
                    .failure = .{
                        .code = code,
                        .message = message,
                    },
                }, context),
            }
        }
        pub fn notFound(this: @This(), code: []const u8, message: []const u8, context: *anyopaque) void {
            switch (this) {
                inline .download,
                .stat,
                .delete,
                .listObjects,
                => |callback| callback(.{
                    .not_found = .{
                        .code = code,
                        .message = message,
                    },
                }, context),
                else => this.fail(code, message, context),
            }
        }
    };
    pub fn deinit(this: *@This()) void {
        if (this.result.certificate_info) |*certificate| {
            certificate.deinit(bun.default_allocator);
        }
        this.poll_ref.unref(this.vm);
        this.response_buffer.deinit();
        this.headers.deinit();
        this.sign_result.deinit();
        this.http.clearData();
        if (this.range) |range| {
            bun.default_allocator.free(range);
        }
        if (this.result.metadata) |*metadata| {
            metadata.deinit(bun.default_allocator);
        }
        this.destroy();
    }

    const ErrorType = enum {
        not_found,
        failure,
    };
    fn errorWithBody(this: @This(), comptime error_type: ErrorType) void {
        var code: []const u8 = "UnknownError";
        var message: []const u8 = "an unexpected error has occurred";
        var has_error_code = false;
        if (this.result.fail) |err| {
            code = @errorName(err);
            has_error_code = true;
        } else if (this.result.body) |body| {
            const bytes = body.list.items;
            if (bytes.len > 0) {
                message = bytes[0..];
                if (strings.indexOf(bytes, "<Code>")) |start| {
                    if (strings.indexOf(bytes, "</Code>")) |end| {
                        code = bytes[start + "<Code>".len .. end];
                        has_error_code = true;
                    }
                }
                if (strings.indexOf(bytes, "<Message>")) |start| {
                    if (strings.indexOf(bytes, "</Message>")) |end| {
                        message = bytes[start + "<Message>".len .. end];
                    }
                }
            }
        }

        if (error_type == .not_found) {
            if (!has_error_code) {
                code = "NoSuchKey";
                message = "The specified key does not exist.";
            }
            this.callback.notFound(code, message, this.callback_context);
        } else {
            this.callback.fail(code, message, this.callback_context);
        }
    }

    fn failIfContainsError(this: *@This(), status: u32) bool {
        var code: []const u8 = "UnknownError";
        var message: []const u8 = "an unexpected error has occurred";

        if (this.result.fail) |err| {
            code = @errorName(err);
        } else if (this.result.body) |body| {
            const bytes = body.list.items;
            var has_error = false;
            if (bytes.len > 0) {
                message = bytes[0..];
                if (strings.indexOf(bytes, "<Error>") != null) {
                    has_error = true;
                    if (strings.indexOf(bytes, "<Code>")) |start| {
                        if (strings.indexOf(bytes, "</Code>")) |end| {
                            code = bytes[start + "<Code>".len .. end];
                        }
                    }
                    if (strings.indexOf(bytes, "<Message>")) |start| {
                        if (strings.indexOf(bytes, "</Message>")) |end| {
                            message = bytes[start + "<Message>".len .. end];
                        }
                    }
                }
            }
            if (!has_error and status == 200 or status == 206) {
                return false;
            }
        } else if (status == 200 or status == 206) {
            return false;
        }
        this.callback.fail(code, message, this.callback_context);
        return true;
    }
    /// this is the task callback from the last task result and is always in the main thread
    pub fn onResponse(this: *@This()) void {
        defer this.deinit();
        if (!this.result.isSuccess()) {
            this.errorWithBody(.failure);
            return;
        }
        bun.assert(this.result.metadata != null);
        const response = this.result.metadata.?.response;
        switch (this.callback) {
            .stat => |callback| {
                switch (response.status_code) {
                    200 => {
                        callback(.{
                            .success = .{
                                .etag = response.headers.get("etag") orelse "",
                                .lastModified = response.headers.get("last-modified") orelse "",
                                .contentType = response.headers.get("content-type") orelse "",
                                .size = if (response.headers.get("content-length")) |content_len| (std.fmt.parseInt(usize, content_len, 10) catch 0) else 0,
                            },
                        }, this.callback_context);
                    },
                    404 => {
                        this.errorWithBody(.not_found);
                    },
                    else => {
                        this.errorWithBody(.failure);
                    },
                }
            },
            .delete => |callback| {
                switch (response.status_code) {
                    200, 204 => {
                        callback(.{ .success = {} }, this.callback_context);
                    },
                    404 => {
                        this.errorWithBody(.not_found);
                    },
                    else => {
                        this.errorWithBody(.failure);
                    },
                }
            },
            .listObjects => |callback| {
                switch (response.status_code) {
                    200 => {
                        if (this.result.body) |body| {
                            const success = ListObjects.parseS3ListObjectsResult(body.slice()) catch {
                                this.errorWithBody(.failure);
                                return;
                            };

                            callback(.{ .success = success }, this.callback_context);
                        } else {
                            this.errorWithBody(.failure);
                        }
                    },
                    404 => {
                        this.errorWithBody(.not_found);
                    },
                    else => {
                        this.errorWithBody(.failure);
                    },
                }
            },
            .upload => |callback| {
                switch (response.status_code) {
                    200 => {
                        callback(.{ .success = {} }, this.callback_context);
                    },
                    else => {
                        this.errorWithBody(.failure);
                    },
                }
            },
            .download => |callback| {
                switch (response.status_code) {
                    200, 204, 206 => {
                        const body = this.response_buffer;
                        this.response_buffer = .{
                            .allocator = bun.default_allocator,
                            .list = .{
                                .items = &.{},
                                .capacity = 0,
                            },
                        };
                        callback(.{
                            .success = .{
                                .etag = response.headers.get("etag") orelse "",
                                .body = body,
                            },
                        }, this.callback_context);
                    },
                    404 => {
                        this.errorWithBody(.not_found);
                    },
                    else => {
                        //error
                        this.errorWithBody(.failure);
                    },
                }
            },
            .commit => |callback| {
                // commit multipart upload can fail with status 200
                if (!this.failIfContainsError(response.status_code)) {
                    callback(.{ .success = {} }, this.callback_context);
                }
            },
            .part => |callback| {
                if (!this.failIfContainsError(response.status_code)) {
                    if (response.headers.get("etag")) |etag| {
                        callback(.{ .etag = etag }, this.callback_context);
                    } else {
                        this.errorWithBody(.failure);
                    }
                }
            },
        }
    }

    /// this is the callback from the http.zig AsyncHTTP is always called from the HTTPThread
    pub fn httpCallback(this: *@This(), async_http: *bun.http.AsyncHTTP, result: bun.http.HTTPClientResult) void {
        const is_done = !result.has_more;
        this.result = result;
        this.http = async_http.*;
        this.response_buffer = async_http.response_buffer.*;
        if (is_done) {
            this.vm.eventLoop().enqueueTaskConcurrent(this.concurrent_task.from(this, .manual_deinit));
        }
    }
};

pub const S3SimpleRequestOptions = struct {
    // signing options
    path: []const u8,
    method: bun.http.Method,
    search_params: ?[]const u8 = null,
    content_type: ?[]const u8 = null,
    content_disposition: ?[]const u8 = null,

    // http request options
    body: []const u8,
    proxy_url: ?[]const u8 = null,
    range: ?[]const u8 = null,
    acl: ?ACL = null,
    storage_class: ?StorageClass = null,
};

pub fn executeSimpleS3Request(
    this: *const S3Credentials,
    options: S3SimpleRequestOptions,
    callback: S3HttpSimpleTask.Callback,
    callback_context: *anyopaque,
) void {
    var result = this.signRequest(.{
        .path = options.path,
        .method = options.method,
        .search_params = options.search_params,
        .content_disposition = options.content_disposition,
        .acl = options.acl,
        .storage_class = options.storage_class,
    }, false, null) catch |sign_err| {
        if (options.range) |range_| bun.default_allocator.free(range_);
        const error_code_and_message = getSignErrorCodeAndMessage(sign_err);
        callback.fail(error_code_and_message.code, error_code_and_message.message, callback_context);
        return;
    };

    const headers = brk: {
        var header_buffer: [10]picohttp.Header = undefined;
        if (options.range) |range_| {
            const _headers = result.mixWithHeader(&header_buffer, .{ .name = "range", .value = range_ });
            break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(_headers, bun.default_allocator) catch bun.outOfMemory();
        } else {
            if (options.content_type) |content_type| {
                if (content_type.len > 0) {
                    const _headers = result.mixWithHeader(&header_buffer, .{ .name = "Content-Type", .value = content_type });
                    break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(_headers, bun.default_allocator) catch bun.outOfMemory();
                }
            }

            break :brk JSC.WebCore.Headers.fromPicoHttpHeaders(result.headers(), bun.default_allocator) catch bun.outOfMemory();
        }
    };
    const task = S3HttpSimpleTask.new(.{
        .http = undefined,
        .sign_result = result,
        .callback_context = callback_context,
        .callback = callback,
        .range = options.range,
        .headers = headers,
        .vm = JSC.VirtualMachine.get(),
    });
    task.poll_ref.ref(task.vm);

    const url = bun.URL.parse(result.url);
    const proxy = options.proxy_url orelse "";
    task.http = bun.http.AsyncHTTP.init(
        bun.default_allocator,
        options.method,
        url,
        task.headers.entries,
        task.headers.buf.items,
        &task.response_buffer,
        options.body,
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
