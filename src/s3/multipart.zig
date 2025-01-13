const std = @import("std");
const bun = @import("root").bun;
const strings = bun.strings;
const S3Credentials = @import("./credentials.zig").S3Credentials;
const ACL = @import("./acl.zig").ACL;
const JSC = bun.JSC;
const MultiPartUploadOptions = @import("./multipart_options.zig").MultiPartUploadOptions;
const S3SimpleRequest = @import("./simple_request.zig");
const executeSimpleS3Request = S3SimpleRequest.executeSimpleS3Request;
const S3Error = @import("./error.zig").S3Error;

pub const MultiPartUpload = struct {
    const OneMiB: usize = MultiPartUploadOptions.OneMiB;
    const MAX_SINGLE_UPLOAD_SIZE: usize = MultiPartUploadOptions.MAX_SINGLE_UPLOAD_SIZE; // we limit to 5 GiB
    const MIN_SINGLE_UPLOAD_SIZE: usize = MultiPartUploadOptions.MIN_SINGLE_UPLOAD_SIZE;
    const DefaultPartSize = MultiPartUploadOptions.DefaultPartSize;
    const MAX_QUEUE_SIZE = MultiPartUploadOptions.MAX_QUEUE_SIZE;
    const AWS = S3Credentials;
    queue: std.ArrayListUnmanaged(UploadPart) = .{},
    available: bun.bit_set.IntegerBitSet(MAX_QUEUE_SIZE) = bun.bit_set.IntegerBitSet(MAX_QUEUE_SIZE).initFull(),

    currentPartNumber: u16 = 1,
    ref_count: u16 = 1,
    ended: bool = false,

    options: MultiPartUploadOptions = .{},
    acl: ?ACL = null,
    credentials: *S3Credentials,
    poll_ref: bun.Async.KeepAlive = bun.Async.KeepAlive.init(),
    vm: *JSC.VirtualMachine,
    globalThis: *JSC.JSGlobalObject,

    buffered: std.ArrayListUnmanaged(u8) = .{},
    offset: usize = 0,

    path: []const u8,
    proxy: []const u8,
    content_type: ?[]const u8 = null,
    upload_id: []const u8 = "",
    uploadid_buffer: bun.MutableString = .{ .allocator = bun.default_allocator, .list = .{} },

    multipart_etags: std.ArrayListUnmanaged(UploadPart.UploadPartResult) = .{},
    multipart_upload_list: bun.ByteList = .{},

    state: enum {
        wait_stream_check,
        not_started,
        multipart_started,
        multipart_completed,
        singlefile_started,
        finished,
    } = .not_started,

    callback: *const fn (S3SimpleRequest.S3UploadResult, *anyopaque) void,
    callback_context: *anyopaque,

    pub usingnamespace bun.NewRefCounted(@This(), @This().deinit);

    const log = bun.Output.scoped(.S3MultiPartUpload, true);

    pub const UploadPart = struct {
        data: []const u8,
        state: enum {
            pending,
            started,
            completed,
            canceled,
        },
        owns_data: bool,
        partNumber: u16, // max is 10,000
        retry: u8, // auto retry, decrement until 0 and fail after this
        index: u8,
        ctx: *MultiPartUpload,

        pub const UploadPartResult = struct {
            number: u16,
            etag: []const u8,
        };
        fn sortEtags(_: *MultiPartUpload, a: UploadPart.UploadPartResult, b: UploadPart.UploadPartResult) bool {
            return a.number < b.number;
        }

        pub fn onPartResponse(result: S3SimpleRequest.S3PartResult, this: *@This()) void {
            if (this.state == .canceled or this.ctx.state == .finished) {
                log("onPartResponse {} canceled", .{this.partNumber});
                if (this.owns_data) bun.default_allocator.free(this.data);
                this.ctx.deref();
                return;
            }

            this.state = .completed;

            switch (result) {
                .failure => |err| {
                    if (this.retry > 0) {
                        log("onPartResponse {} retry", .{this.partNumber});
                        this.retry -= 1;
                        // retry failed
                        this.perform();
                        return;
                    } else {
                        log("onPartResponse {} failed", .{this.partNumber});
                        if (this.owns_data) bun.default_allocator.free(this.data);
                        defer this.ctx.deref();
                        return this.ctx.fail(err);
                    }
                },
                .etag => |etag| {
                    log("onPartResponse {} success", .{this.partNumber});

                    if (this.owns_data) bun.default_allocator.free(this.data);
                    // we will need to order this
                    this.ctx.multipart_etags.append(bun.default_allocator, .{
                        .number = this.partNumber,
                        .etag = bun.default_allocator.dupe(u8, etag) catch bun.outOfMemory(),
                    }) catch bun.outOfMemory();

                    defer this.ctx.deref();
                    // mark as available
                    this.ctx.available.set(this.index);
                    // drain more
                    this.ctx.drainEnqueuedParts();
                },
            }
        }

        fn perform(this: *@This()) void {
            var params_buffer: [2048]u8 = undefined;
            const search_params = std.fmt.bufPrint(&params_buffer, "?partNumber={}&uploadId={s}&x-id=UploadPart", .{
                this.partNumber,
                this.ctx.upload_id,
            }) catch unreachable;
            executeSimpleS3Request(this.ctx.credentials, .{
                .path = this.ctx.path,
                .method = .PUT,
                .proxy_url = this.ctx.proxyUrl(),
                .body = this.data,
                .search_params = search_params,
            }, .{ .part = @ptrCast(&onPartResponse) }, this);
        }
        pub fn start(this: *@This()) void {
            if (this.state != .pending or this.ctx.state != .multipart_completed or this.ctx.state == .finished) return;
            this.ctx.ref();
            this.state = .started;
            this.perform();
        }
        pub fn cancel(this: *@This()) void {
            const state = this.state;
            this.state = .canceled;

            switch (state) {
                .pending => {
                    if (this.owns_data) bun.default_allocator.free(this.data);
                },
                // if is not pending we will free later or is already freed
                else => {},
            }
        }
    };

    fn deinit(this: *@This()) void {
        log("deinit", .{});
        if (this.queue.capacity > 0)
            this.queue.deinit(bun.default_allocator);
        this.poll_ref.unref(this.vm);
        bun.default_allocator.free(this.path);
        if (this.proxy.len > 0) {
            bun.default_allocator.free(this.proxy);
        }
        if (this.content_type) |ct| {
            if (ct.len > 0) {
                bun.default_allocator.free(ct);
            }
        }
        this.credentials.deref();
        this.uploadid_buffer.deinit();
        for (this.multipart_etags.items) |tag| {
            bun.default_allocator.free(tag.etag);
        }
        if (this.multipart_etags.capacity > 0)
            this.multipart_etags.deinit(bun.default_allocator);
        if (this.multipart_upload_list.cap > 0)
            this.multipart_upload_list.deinitWithAllocator(bun.default_allocator);
        this.destroy();
    }

    pub fn singleSendUploadResponse(result: S3SimpleRequest.S3UploadResult, this: *@This()) void {
        defer this.deref();
        if (this.state == .finished) return;
        switch (result) {
            .failure => |err| {
                if (this.options.retry > 0) {
                    log("singleSendUploadResponse {} retry", .{this.options.retry});
                    this.options.retry -= 1;
                    this.ref();
                    // retry failed
                    executeSimpleS3Request(this.credentials, .{
                        .path = this.path,
                        .method = .PUT,
                        .proxy_url = this.proxyUrl(),
                        .body = this.buffered.items,
                        .content_type = this.content_type,
                        .acl = this.acl,
                    }, .{ .upload = @ptrCast(&singleSendUploadResponse) }, this);

                    return;
                } else {
                    log("singleSendUploadResponse failed", .{});
                    return this.fail(err);
                }
            },
            .success => {
                log("singleSendUploadResponse success", .{});
                this.done();
            },
        }
    }

    fn getCreatePart(this: *@This(), chunk: []const u8, owns_data: bool) ?*UploadPart {
        const index = this.available.findFirstSet() orelse {
            // this means that the queue is full and we cannot flush it
            return null;
        };

        if (index >= this.options.queueSize) {
            // ops too much concurrency wait more
            return null;
        }
        this.available.unset(index);
        defer this.currentPartNumber += 1;

        if (this.queue.items.len <= index) {
            this.queue.append(bun.default_allocator, .{
                .data = chunk,
                .partNumber = this.currentPartNumber,
                .owns_data = owns_data,
                .ctx = this,
                .index = @truncate(index),
                .retry = this.options.retry,
                .state = .pending,
            }) catch bun.outOfMemory();
            return &this.queue.items[index];
        }
        this.queue.items[index] = .{
            .data = chunk,
            .partNumber = this.currentPartNumber,
            .owns_data = owns_data,
            .ctx = this,
            .index = @truncate(index),
            .retry = this.options.retry,
            .state = .pending,
        };
        return &this.queue.items[index];
    }

    fn drainEnqueuedParts(this: *@This()) void {
        if (this.state == .finished) {
            return;
        }
        // check pending to start or transformed buffered ones into tasks
        if (this.state == .multipart_completed) {
            for (this.queue.items) |*part| {
                if (part.state == .pending) {
                    // lets start the part request
                    part.start();
                }
            }
        }
        const partSize = this.partSizeInBytes();
        if (this.ended or this.buffered.items.len >= partSize) {
            this.processMultiPart(partSize);
        }

        if (this.ended and this.available.mask == std.bit_set.IntegerBitSet(MAX_QUEUE_SIZE).initFull().mask) {
            // we are done
            this.done();
        }
    }
    pub fn fail(this: *@This(), _err: S3Error) void {
        log("fail {s}:{s}", .{ _err.code, _err.message });
        this.ended = true;
        for (this.queue.items) |*task| {
            task.cancel();
        }
        if (this.state != .finished) {
            const old_state = this.state;
            this.state = .finished;
            this.callback(.{ .failure = _err }, this.callback_context);

            if (old_state == .multipart_completed) {
                // will deref after rollback
                this.rollbackMultiPartRequest();
            } else {
                this.deref();
            }
        }
    }

    fn done(this: *@This()) void {
        if (this.state == .multipart_completed) {
            this.state = .finished;

            std.sort.block(UploadPart.UploadPartResult, this.multipart_etags.items, this, UploadPart.sortEtags);
            this.multipart_upload_list.append(bun.default_allocator, "<?xml version=\"1.0\" encoding=\"UTF-8\"?><CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">") catch bun.outOfMemory();
            for (this.multipart_etags.items) |tag| {
                this.multipart_upload_list.appendFmt(bun.default_allocator, "<Part><PartNumber>{}</PartNumber><ETag>{s}</ETag></Part>", .{ tag.number, tag.etag }) catch bun.outOfMemory();

                bun.default_allocator.free(tag.etag);
            }
            this.multipart_etags.deinit(bun.default_allocator);
            this.multipart_etags = .{};
            this.multipart_upload_list.append(bun.default_allocator, "</CompleteMultipartUpload>") catch bun.outOfMemory();
            // will deref and ends after commit
            this.commitMultiPartRequest();
        } else {
            this.callback(.{ .success = {} }, this.callback_context);
            this.state = .finished;
            this.deref();
        }
    }
    pub fn startMultiPartRequestResult(result: S3SimpleRequest.S3DownloadResult, this: *@This()) void {
        defer this.deref();
        if (this.state == .finished) return;
        switch (result) {
            .failure => |err| {
                log("startMultiPartRequestResult {s} failed {s}: {s}", .{ this.path, err.message, err.message });
                this.fail(err);
            },
            .success => |response| {
                const slice = response.body.list.items;
                this.uploadid_buffer = result.success.body;

                if (strings.indexOf(slice, "<UploadId>")) |start| {
                    if (strings.indexOf(slice, "</UploadId>")) |end| {
                        this.upload_id = slice[start + 10 .. end];
                    }
                }
                if (this.upload_id.len == 0) {
                    // Unknown type of response error from AWS
                    log("startMultiPartRequestResult {s} failed invalid id", .{this.path});
                    this.fail(.{
                        .code = "UnknownError",
                        .message = "Failed to initiate multipart upload",
                    });
                    return;
                }
                log("startMultiPartRequestResult {s} success id: {s}", .{ this.path, this.upload_id });
                this.state = .multipart_completed;
                this.drainEnqueuedParts();
            },
            // this is "unreachable" but we cover in case AWS returns 404
            .not_found => this.fail(.{
                .code = "UnknownError",
                .message = "Failed to initiate multipart upload",
            }),
        }
    }

    pub fn onCommitMultiPartRequest(result: S3SimpleRequest.S3CommitResult, this: *@This()) void {
        log("onCommitMultiPartRequest {s}", .{this.upload_id});

        switch (result) {
            .failure => |err| {
                if (this.options.retry > 0) {
                    this.options.retry -= 1;
                    // retry commit
                    this.commitMultiPartRequest();
                    return;
                }
                this.callback(.{ .failure = err }, this.callback_context);
                this.deref();
            },
            .success => {
                this.callback(.{ .success = {} }, this.callback_context);
                this.state = .finished;
                this.deref();
            },
        }
    }

    pub fn onRollbackMultiPartRequest(result: S3SimpleRequest.S3UploadResult, this: *@This()) void {
        log("onRollbackMultiPartRequest {s}", .{this.upload_id});
        switch (result) {
            .failure => {
                if (this.options.retry > 0) {
                    this.options.retry -= 1;
                    // retry rollback
                    this.rollbackMultiPartRequest();
                    return;
                }
                this.deref();
            },
            .success => {
                this.deref();
            },
        }
    }

    fn commitMultiPartRequest(this: *@This()) void {
        log("commitMultiPartRequest {s}", .{this.upload_id});
        var params_buffer: [2048]u8 = undefined;
        const searchParams = std.fmt.bufPrint(&params_buffer, "?uploadId={s}", .{
            this.upload_id,
        }) catch unreachable;

        executeSimpleS3Request(this.credentials, .{
            .path = this.path,
            .method = .POST,
            .proxy_url = this.proxyUrl(),
            .body = this.multipart_upload_list.slice(),
            .search_params = searchParams,
        }, .{ .commit = @ptrCast(&onCommitMultiPartRequest) }, this);
    }
    fn rollbackMultiPartRequest(this: *@This()) void {
        log("rollbackMultiPartRequest {s}", .{this.upload_id});
        var params_buffer: [2048]u8 = undefined;
        const search_params = std.fmt.bufPrint(&params_buffer, "?uploadId={s}", .{
            this.upload_id,
        }) catch unreachable;

        executeSimpleS3Request(this.credentials, .{
            .path = this.path,
            .method = .DELETE,
            .proxy_url = this.proxyUrl(),
            .body = "",
            .search_params = search_params,
        }, .{ .upload = @ptrCast(&onRollbackMultiPartRequest) }, this);
    }
    fn enqueuePart(this: *@This(), chunk: []const u8, owns_data: bool) bool {
        const part = this.getCreatePart(chunk, owns_data) orelse return false;

        if (this.state == .not_started) {
            // will auto start later
            this.state = .multipart_started;
            this.ref();
            executeSimpleS3Request(this.credentials, .{
                .path = this.path,
                .method = .POST,
                .proxy_url = this.proxyUrl(),
                .body = "",
                .search_params = "?uploads=",
                .content_type = this.content_type,
                .acl = this.acl,
            }, .{ .download = @ptrCast(&startMultiPartRequestResult) }, this);
        } else if (this.state == .multipart_completed) {
            part.start();
        }
        return true;
    }

    fn processMultiPart(this: *@This(), part_size: usize) void {
        // need to split in multiple parts because of the size
        var buffer = this.buffered.items[this.offset..];
        var queue_full = false;
        defer if (!this.ended and queue_full == false) {
            this.buffered = .{};
            this.offset = 0;
        };

        while (buffer.len > 0) {
            const len = @min(part_size, buffer.len);
            const slice = buffer[0..len];
            buffer = buffer[len..];
            // its one big buffer lets free after we are done with everything, part dont own the data
            if (this.enqueuePart(slice, this.ended)) {
                this.offset += len;
            } else {
                queue_full = true;
                break;
            }
        }
    }

    pub fn proxyUrl(this: *@This()) ?[]const u8 {
        return this.proxy;
    }
    fn processBuffered(this: *@This(), part_size: usize) void {
        if (this.ended and this.buffered.items.len < this.partSizeInBytes() and this.state == .not_started) {
            log("processBuffered {s} singlefile_started", .{this.path});
            this.state = .singlefile_started;
            this.ref();
            // we can do only 1 request
            executeSimpleS3Request(this.credentials, .{
                .path = this.path,
                .method = .PUT,
                .proxy_url = this.proxyUrl(),
                .body = this.buffered.items,
                .content_type = this.content_type,
                .acl = this.acl,
            }, .{ .upload = @ptrCast(&singleSendUploadResponse) }, this);
        } else {
            // we need to split
            this.processMultiPart(part_size);
        }
    }

    pub fn partSizeInBytes(this: *@This()) usize {
        return this.options.partSize;
    }

    pub fn continueStream(this: *@This()) void {
        if (this.state == .wait_stream_check) {
            this.state = .not_started;
            if (this.ended) {
                this.processBuffered(this.partSizeInBytes());
            }
        }
    }

    pub fn sendRequestData(this: *@This(), chunk: []const u8, is_last: bool) void {
        if (this.ended) return;
        if (this.state == .wait_stream_check and chunk.len == 0 and is_last) {
            // we do this because stream will close if the file dont exists and we dont wanna to send an empty part in this case
            this.ended = true;
            return;
        }
        if (is_last) {
            this.ended = true;
            if (chunk.len > 0) {
                this.buffered.appendSlice(bun.default_allocator, chunk) catch bun.outOfMemory();
            }
            this.processBuffered(this.partSizeInBytes());
        } else {
            // still have more data and receive empty, nothing todo here
            if (chunk.len == 0) return;
            this.buffered.appendSlice(bun.default_allocator, chunk) catch bun.outOfMemory();
            const partSize = this.partSizeInBytes();
            if (this.buffered.items.len >= partSize) {
                // send the part we have enough data
                this.processBuffered(partSize);
                return;
            }

            // wait for more
        }
    }
};
