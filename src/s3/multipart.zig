// When we start the request we will buffer data until partSize is reached or the last chunk is received.
// If the buffer is smaller than partSize, it will be sent as a single request. Otherwise, a multipart upload will be initiated.
// If we send a single request it will retry until the maximum retry count is reached. The single request do not increase the reference count of MultiPartUpload, as they are the final step.
// When sending a multipart upload, if there is space in the queue, the part is enqueued, and the request starts immediately.
// If the queue is full, it waits to be drained before starting a new part request.
// Each part maintains a reference to MultiPartUpload until completion.
// If a part is canceled or fails early, the allocated slice is freed, and the reference is removed. If a part completes successfully, an etag is received, the allocated slice is deallocated, and the etag is appended to multipart_etags. If a part request fails, it retries until the maximum retry count is reached. If it still fails, MultiPartUpload is marked as failed and its reference is removed.
// If all parts succeed, a complete request is sent.
// If any part fails, a rollback request deletes the uploaded parts. Rollback and commit requests do not increase the reference count of MultiPartUpload, as they are the final step. Once commit or rollback finishes, the reference count is decremented, and MultiPartUpload is freed. These requests retry up to the maximum retry count on a best-effort basis.

//                Start Upload
//                       │
//                       ▼
//               Buffer Incoming Data
//                       │
//                       │
//          ┌────────────┴────────────────┐
//          │                             │
//          ▼                             ▼
// Buffer < PartSize             Buffer >= PartSize
//  and is Last Chunk                     │
//          │                             │
//          │                             │
//          │                             │
//          │                             │
//          │                             ▼
//          │                  Start Multipart Upload
//          │                             │
//          │                  Initialize Parts Queue
//          │                             │
//          │                   Process Upload Parts
//          │                             │
//          │                  ┌──────────┴──────────┐
//          │                  │                     │
//          │                  ▼                     ▼
//          │             Queue Has Space       Queue Full
//          │                  │                     │
//          │                  │                     ▼
//          │                  │              Wait for Queue
//          │                  │                     │
//          │                  └──────────┬──────────┘
//          │                             │
//          │                             ▼
//          │                     Start Part Upload
//          │               (Reference MultiPartUpload)
//          │                             │
//          │                  ┌─────────┼─────────┐
//          │                  │         │         │
//          │                  ▼         ▼         ▼
//          │               Part      Success   Failure
//          │             Canceled       │         │
//          │                  │         │     Retry Part
//          │                  │         │         │
//          │               Free       Free    Max Retries?
//          │               Slice      Slice    │        │
//          │                  │         │      No       Yes
//          │               Deref    Add eTag   │        │
//          │                MPU    to Array    │    Fail MPU
//          │                  │         │      │        │
//          │                  │         │      │    Deref MPU
//          │                  └─────────┼──────┘        │
//          │                            │               │
//          │                            ▼               │
//          │                   All Parts Complete?      │
//          │                            │               │
//          │                    ┌───────┴───────┐       │
//          │                    │               │       │
//          │                    ▼               ▼       │
//          │               All Success     Some Failed  │
//          │                    │               │       │
//          │                    ▼               ▼       │
//          │              Send Commit     Send Rollback │
//          │             (No Ref Inc)    (No Ref Inc)   │
//          │                    │               │       │
//          │                    └───────┬───────┘       │
//          │                            │               │
//          │                            ▼               │
//          │                     Retry if Failed        │
//          │                    (Best Effort Only)      │
//          │                            │               │
//          │                            ▼               │
//          │                     Deref Final MPU        │
//          │                            │               │
//          ▼                            │               │
//  Single Upload Request                │               │
//          │                            │               │
//          └────────────────────────────┴───────────────┘
//                         │
//                         ▼
//                        End
pub const MultiPartUpload = struct {
    const OneMiB: usize = MultiPartUploadOptions.OneMiB;
    const MAX_SINGLE_UPLOAD_SIZE: usize = MultiPartUploadOptions.MAX_SINGLE_UPLOAD_SIZE; // we limit to 5 GiB
    const MIN_SINGLE_UPLOAD_SIZE: usize = MultiPartUploadOptions.MIN_SINGLE_UPLOAD_SIZE;
    const DefaultPartSize = MultiPartUploadOptions.DefaultPartSize;
    const MAX_QUEUE_SIZE = MultiPartUploadOptions.MAX_QUEUE_SIZE;
    const AWS = S3Credentials;
    queue: ?[]UploadPart = null,
    available: bun.bit_set.IntegerBitSet(MAX_QUEUE_SIZE) = bun.bit_set.IntegerBitSet(MAX_QUEUE_SIZE).initFull(),

    currentPartNumber: u16 = 1,
    ref_count: RefCount,
    ended: bool = false,

    options: MultiPartUploadOptions = .{},
    acl: ?ACL = null,
    storage_class: ?Storageclass = null,
    request_payer: bool = false,
    credentials: *S3Credentials,
    poll_ref: bun.Async.KeepAlive = bun.Async.KeepAlive.init(),
    vm: *jsc.VirtualMachine,
    globalThis: *jsc.JSGlobalObject,

    buffered: bun.io.StreamBuffer = .{},

    path: []const u8,
    proxy: []const u8,
    content_type: ?[]const u8 = null,
    content_disposition: ?[]const u8 = null,
    content_encoding: ?[]const u8 = null,
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

    callback: *const fn (S3SimpleRequest.S3UploadResult, *anyopaque) bun.JSTerminated!void,
    onWritable: ?*const fn (task: *MultiPartUpload, ctx: *anyopaque, flushed: u64) void = null,
    callback_context: *anyopaque,

    const Self = @This();
    const RefCount = bun.ptr.RefCount(Self, "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    const log = bun.Output.scoped(.S3MultiPartUpload, .hidden);

    pub const UploadPart = struct {
        data: []const u8,
        ctx: *MultiPartUpload,
        allocated_size: usize,
        state: enum(u8) {
            not_assigned = 0,
            pending = 1,
            started = 2,
            completed = 3,
            canceled = 4,
        },
        partNumber: u16, // max is 10,000
        retry: u8, // auto retry, decrement until 0 and fail after this
        index: u8,

        pub const UploadPartResult = struct {
            number: u16,
            etag: []const u8,
        };

        fn sortEtags(_: *MultiPartUpload, a: UploadPart.UploadPartResult, b: UploadPart.UploadPartResult) bool {
            return a.number < b.number;
        }

        fn freeAllocatedSlice(this: *@This()) void {
            const slice = this.allocatedSlice();
            if (slice.len > 0) {
                bun.default_allocator.free(slice);
            }
            this.data = "";
            this.allocated_size = 0;
        }

        fn allocatedSlice(this: *@This()) []const u8 {
            if (this.allocated_size > 0) {
                return this.data.ptr[0..this.allocated_size];
            }
            return "";
        }

        pub fn onPartResponse(result: S3SimpleRequest.S3PartResult, this: *@This()) bun.JSTerminated!void {
            if (this.state == .canceled or this.ctx.state == .finished) {
                log("onPartResponse {} canceled", .{this.partNumber});
                this.freeAllocatedSlice();
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
                        try this.perform();
                        return;
                    } else {
                        this.state = .not_assigned;
                        log("onPartResponse {} failed", .{this.partNumber});
                        this.freeAllocatedSlice();
                        defer this.ctx.deref();
                        return this.ctx.fail(err);
                    }
                },
                .etag => |etag| {
                    log("onPartResponse {} success", .{this.partNumber});
                    const sent = this.data.len;
                    this.freeAllocatedSlice();
                    // we will need to order this
                    this.ctx.multipart_etags.append(bun.default_allocator, .{
                        .number = this.partNumber,
                        .etag = bun.handleOom(bun.default_allocator.dupe(u8, etag)),
                    }) catch |err| bun.handleOom(err);
                    this.state = .not_assigned;
                    defer this.ctx.deref();
                    // mark as available
                    this.ctx.available.set(this.index);
                    // drain more
                    try this.ctx.drainEnqueuedParts(sent);
                },
            }
        }

        fn perform(this: *@This()) bun.JSTerminated!void {
            var params_buffer: [2048]u8 = undefined;
            const search_params = std.fmt.bufPrint(&params_buffer, "?partNumber={}&uploadId={s}&x-id=UploadPart", .{
                this.partNumber,
                this.ctx.upload_id,
            }) catch unreachable;
            try executeSimpleS3Request(this.ctx.credentials, .{
                .path = this.ctx.path,
                .method = .PUT,
                .proxy_url = this.ctx.proxyUrl(),
                .body = this.data,
                .search_params = search_params,
                .request_payer = this.ctx.request_payer,
            }, .{ .part = @ptrCast(&onPartResponse) }, this);
        }
        pub fn start(this: *@This()) bun.JSTerminated!void {
            if (this.state != .pending or this.ctx.state != .multipart_completed) return;
            this.ctx.ref();
            this.state = .started;
            try this.perform();
        }
        pub fn cancel(this: *@This()) void {
            const state = this.state;
            this.state = .canceled;

            switch (state) {
                .pending => {
                    this.freeAllocatedSlice();
                },
                // if is not pending we will free later or is already freed
                else => {},
            }
        }
    };

    fn deinit(this: *@This()) void {
        log("deinit", .{});
        if (this.queue) |queue| {
            this.queue = null;
            bun.default_allocator.free(queue);
        }
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
        if (this.content_disposition) |cd| {
            if (cd.len > 0) {
                bun.default_allocator.free(cd);
            }
        }
        if (this.content_encoding) |ce| {
            if (ce.len > 0) {
                bun.default_allocator.free(ce);
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
            this.multipart_upload_list.deinit(bun.default_allocator);
        bun.destroy(this);
    }

    pub fn singleSendUploadResponse(result: S3SimpleRequest.S3UploadResult, this: *@This()) bun.JSError!void {
        if (this.state == .finished) return;
        switch (result) {
            .failure => |err| {
                if (this.options.retry > 0) {
                    log("singleSendUploadResponse {} retry", .{this.options.retry});
                    this.options.retry -= 1;
                    try executeSimpleS3Request(this.credentials, .{
                        .path = this.path,
                        .method = .PUT,
                        .proxy_url = this.proxyUrl(),
                        .body = this.buffered.slice(),
                        .content_type = this.content_type,
                        .content_disposition = this.content_disposition,
                        .content_encoding = this.content_encoding,
                        .acl = this.acl,
                        .storage_class = this.storage_class,
                        .request_payer = this.request_payer,
                    }, .{ .upload = @ptrCast(&singleSendUploadResponse) }, this);

                    return;
                } else {
                    log("singleSendUploadResponse failed", .{});
                    return this.fail(err);
                }
            },
            .success => {
                log("singleSendUploadResponse success", .{});

                if (this.onWritable) |callback| {
                    callback(this, this.callback_context, this.buffered.size());
                }
                try this.done();
            },
        }
    }

    /// This is the only place we allocate the queue or the parts, this is responsible for the flow of parts and the max allowed concurrency
    fn getCreatePart(this: *@This(), chunk: []const u8, allocated_size: usize, needs_clone: bool) ?*UploadPart {
        const index = this.available.findFirstSet() orelse {
            // this means that the queue is full and we cannot flush it
            return null;
        };
        const queueSize = this.options.queueSize;
        if (index >= queueSize) {
            // ops too much concurrency wait more
            return null;
        }
        this.available.unset(index);
        defer this.currentPartNumber += 1;
        if (this.queue == null) {
            // queueSize will never change and is small (max 255)
            const queue = bun.handleOom(bun.default_allocator.alloc(UploadPart, queueSize));
            // zero set just in case
            @memset(queue, UploadPart{
                .data = "",
                .allocated_size = 0,
                .partNumber = 0,
                .ctx = this,
                .index = 0,
                .retry = 0,
                .state = .not_assigned,
            });
            this.queue = queue;
        }
        const data = if (needs_clone) bun.handleOom(bun.default_allocator.dupe(u8, chunk)) else chunk;
        const allocated_len = if (needs_clone) data.len else allocated_size;

        const queue_item = &this.queue.?[index];
        // always set all struct fields to avoid undefined behavior
        queue_item.* = .{
            .data = data,
            .allocated_size = allocated_len,
            .partNumber = this.currentPartNumber,
            .ctx = this,
            .index = @truncate(index),
            .retry = this.options.retry,
            .state = .pending,
        };
        return queue_item;
    }

    /// Drain the parts, this is responsible for starting the parts and processing the buffered data
    fn drainEnqueuedParts(this: *@This(), flushed: u64) bun.JSTerminated!void {
        if (this.state == .finished or this.state == .singlefile_started) {
            return;
        }
        // check pending to start or transformed buffered ones into tasks
        if (this.state == .multipart_completed) {
            if (this.queue) |queue| {
                for (queue) |*part| {
                    if (part.state == .pending) {
                        // lets start the part request
                        try part.start();
                    }
                }
            }
        }
        const partSize = this.partSizeInBytes();
        if (this.ended or this.buffered.size() >= partSize) {
            try this.processMultiPart(partSize);
        }

        // empty queue
        if (this.isQueueEmpty()) {
            if (this.onWritable) |callback| {
                callback(this, this.callback_context, flushed);
            }
            if (this.ended) {
                // we are done and no more parts are running
                try this.done();
            }
        } else if (!this.hasBackpressure() and flushed > 0) {
            // we have more space in the queue, we can drain more
            if (this.onWritable) |callback| {
                callback(this, this.callback_context, flushed);
            }
        }
    }
    /// Finalize the upload with a failure
    pub fn fail(this: *@This(), _err: S3Error) bun.JSTerminated!void {
        log("fail {s}:{s}", .{ _err.code, _err.message });
        this.ended = true;
        if (this.queue) |queue| {
            for (queue) |*task| {
                if (task.state != .not_assigned) {
                    task.cancel();
                }
            }
        }
        if (this.state != .finished) {
            const old_state = this.state;
            this.state = .finished;
            try this.callback(.{ .failure = _err }, this.callback_context);

            if (old_state == .multipart_completed) {
                // we are a multipart upload so we need to rollback
                // will deref after rollback
                try this.rollbackMultiPartRequest();
            } else {
                // single file upload no need to rollback
                this.deref();
            }
        }
    }
    /// Finalize successful the upload
    fn done(this: *@This()) bun.JSTerminated!void {
        if (this.state == .multipart_completed) {
            // we are a multipart upload so we need to send the etags and commit
            this.state = .finished;
            // sort the etags
            std.sort.block(UploadPart.UploadPartResult, this.multipart_etags.items, this, UploadPart.sortEtags);
            // start the multipart upload list
            bun.handleOom(this.multipart_upload_list.appendSlice(
                bun.default_allocator,
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?><CompleteMultipartUpload xmlns=\"http://s3.amazonaws.com/doc/2006-03-01/\">",
            ));
            for (this.multipart_etags.items) |tag| {
                bun.handleOom(this.multipart_upload_list.appendFmt(bun.default_allocator, "<Part><PartNumber>{}</PartNumber><ETag>{s}</ETag></Part>", .{ tag.number, tag.etag }));

                bun.default_allocator.free(tag.etag);
            }
            this.multipart_etags.deinit(bun.default_allocator);
            this.multipart_etags = .{};
            bun.handleOom(this.multipart_upload_list.appendSlice(
                bun.default_allocator,
                "</CompleteMultipartUpload>",
            ));
            // will deref and ends after commit
            try this.commitMultiPartRequest();
        } else if (this.state == .singlefile_started) {
            this.state = .finished;
            // single file upload no need to commit
            defer this.deref();
            try this.callback(.{ .success = {} }, this.callback_context);
        }
    }

    /// Result of the Multipart request, after this we can start draining the parts
    pub fn startMultiPartRequestResult(result: S3SimpleRequest.S3DownloadResult, this: *@This()) bun.JSError!void {
        defer this.deref();
        if (this.state == .finished) return;
        switch (result) {
            .failure => |err| {
                log("startMultiPartRequestResult {s} failed {s}: {s}", .{ this.path, err.message, err.message });
                try this.fail(err);
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
                    try this.fail(.{
                        .code = "UnknownError",
                        .message = "Failed to initiate multipart upload",
                    });
                    return;
                }
                log("startMultiPartRequestResult {s} success id: {s}", .{ this.path, this.upload_id });
                this.state = .multipart_completed;
                // start draining the parts
                try this.drainEnqueuedParts(0);
            },
            // this is "unreachable" but we cover in case AWS returns 404
            .not_found => try this.fail(.{
                .code = "UnknownError",
                .message = "Failed to initiate multipart upload",
            }),
        }
    }

    /// We do a best effort to commit the multipart upload, if it fails we will retry, if it still fails we will fail the upload
    pub fn onCommitMultiPartRequest(result: S3SimpleRequest.S3CommitResult, this: *@This()) bun.JSTerminated!void {
        log("onCommitMultiPartRequest {s}", .{this.upload_id});

        switch (result) {
            .failure => |err| {
                if (this.options.retry > 0) {
                    this.options.retry -= 1;
                    // retry commit
                    try this.commitMultiPartRequest();
                    return;
                }
                defer this.deref();
                this.state = .finished;
                try this.callback(.{ .failure = err }, this.callback_context);
            },
            .success => {
                defer this.deref();
                this.state = .finished;
                try this.callback(.{ .success = {} }, this.callback_context);
            },
        }
    }
    /// We do a best effort to rollback the multipart upload, if it fails we will retry, if it still we just deinit the upload
    pub fn onRollbackMultiPartRequest(result: S3SimpleRequest.S3UploadResult, this: *@This()) bun.JSTerminated!void {
        log("onRollbackMultiPartRequest {s}", .{this.upload_id});
        switch (result) {
            .failure => {
                if (this.options.retry > 0) {
                    this.options.retry -= 1;
                    // retry rollback
                    try this.rollbackMultiPartRequest();
                    return;
                }
                this.deref();
            },
            .success => {
                this.deref();
            },
        }
    }

    fn commitMultiPartRequest(this: *@This()) bun.JSTerminated!void {
        log("commitMultiPartRequest {s}", .{this.upload_id});
        var params_buffer: [2048]u8 = undefined;
        const searchParams = std.fmt.bufPrint(&params_buffer, "?uploadId={s}", .{
            this.upload_id,
        }) catch unreachable;

        try executeSimpleS3Request(this.credentials, .{
            .path = this.path,
            .method = .POST,
            .proxy_url = this.proxyUrl(),
            .body = this.multipart_upload_list.slice(),
            .search_params = searchParams,
            .request_payer = this.request_payer,
        }, .{ .commit = @ptrCast(&onCommitMultiPartRequest) }, this);
    }
    fn rollbackMultiPartRequest(this: *@This()) bun.JSTerminated!void {
        log("rollbackMultiPartRequest {s}", .{this.upload_id});
        var params_buffer: [2048]u8 = undefined;
        const search_params = std.fmt.bufPrint(&params_buffer, "?uploadId={s}", .{
            this.upload_id,
        }) catch unreachable;

        try executeSimpleS3Request(this.credentials, .{
            .path = this.path,
            .method = .DELETE,
            .proxy_url = this.proxyUrl(),
            .body = "",
            .search_params = search_params,
            .request_payer = this.request_payer,
        }, .{ .upload = @ptrCast(&onRollbackMultiPartRequest) }, this);
    }
    fn enqueuePart(this: *@This(), chunk: []const u8, allocated_size: usize, needs_clone: bool) bun.JSTerminated!bool {
        const part = this.getCreatePart(chunk, allocated_size, needs_clone) orelse return false;

        if (this.state == .not_started) {
            // will auto start later
            this.state = .multipart_started;
            this.ref();
            try executeSimpleS3Request(this.credentials, .{
                .path = this.path,
                .method = .POST,
                .proxy_url = this.proxyUrl(),
                .body = "",
                .search_params = "?uploads=",
                .content_type = this.content_type,
                .content_disposition = this.content_disposition,
                .content_encoding = this.content_encoding,
                .acl = this.acl,
                .storage_class = this.storage_class,
                .request_payer = this.request_payer,
            }, .{ .download = @ptrCast(&startMultiPartRequestResult) }, this);
        } else if (this.state == .multipart_completed) {
            try part.start();
        }
        return true;
    }

    fn processMultiPart(this: *@This(), part_size: usize) bun.JSTerminated!void {
        log("processMultiPart {s} {d}", .{ this.path, part_size });
        if (this.buffered.isEmpty() and this.isQueueEmpty() and this.ended) {
            // no more data to send and we are done
            try this.done();
            return;
        }
        // need to split in multiple parts because of the size
        defer if (this.buffered.isEmpty()) {
            this.buffered.reset();
        };

        while (this.buffered.isNotEmpty()) {
            const len = @min(part_size, this.buffered.size());
            if (len < part_size and !this.ended) {
                log("processMultiPart {s} {d} slice too small", .{ this.path, len });
                //slice is too small, we need to wait for more data
                break;
            }
            // if is one big chunk we can pass ownership and avoid dupe
            if (this.buffered.cursor == 0 and this.buffered.size() == len) {
                // we need to know the allocated size to free the memory later
                const allocated_size = this.buffered.memoryCost();
                const slice = this.buffered.slice();

                // we dont care about the result because we are sending everything
                if (try this.enqueuePart(slice, allocated_size, false)) {
                    log("processMultiPart {s} {d} full buffer enqueued", .{ this.path, slice.len });

                    // queue is not full, we can clear the buffer part now owns the data
                    // if its full we will retry later
                    this.buffered = .{};
                    return;
                }
                log("processMultiPart {s} {d} queue full", .{ this.path, slice.len });

                return;
            }

            const slice = this.buffered.slice()[0..len];
            // allocated size is the slice len because we dupe the buffer
            if (try this.enqueuePart(slice, slice.len, true)) {
                log("processMultiPart {s} {d} slice enqueued", .{ this.path, slice.len });
                // queue is not full, we can set the offset
                this.buffered.wrote(len);
            } else {
                log("processMultiPart {s} {d} queue full", .{ this.path, slice.len });
                // queue is full stop enqueue and retry later
                break;
            }
        }
    }

    pub fn proxyUrl(this: *@This()) ?[]const u8 {
        return this.proxy;
    }
    fn processBuffered(this: *@This(), part_size: usize) void {
        if (this.ended and this.buffered.size() < this.partSizeInBytes() and this.state == .not_started) {
            log("processBuffered {s} singlefile_started", .{this.path});
            this.state = .singlefile_started;
            // we can do only 1 request
            executeSimpleS3Request(this.credentials, .{
                .path = this.path,
                .method = .PUT,
                .proxy_url = this.proxyUrl(),
                .body = this.buffered.slice(),
                .content_type = this.content_type,
                .content_disposition = this.content_disposition,
                .content_encoding = this.content_encoding,
                .acl = this.acl,
                .storage_class = this.storage_class,
                .request_payer = this.request_payer,
            }, .{ .upload = @ptrCast(&singleSendUploadResponse) }, this) catch {}; // TODO: properly propagate exception upwards
        } else {
            // we need to split
            this.processMultiPart(part_size) catch {}; // TODO: properly propagate exception upwards
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

    pub fn hasBackpressure(this: *@This()) bool {
        // if we dont have any space in the queue, we have backpressure
        // since we are not allowed to send more data
        const index = this.available.findFirstSet() orelse return true;
        return index >= this.options.queueSize;
    }

    pub fn isQueueEmpty(this: *@This()) bool {
        return this.available.mask == std.bit_set.IntegerBitSet(MAX_QUEUE_SIZE).initFull().mask;
    }

    pub const WriteEncoding = enum {
        bytes,
        latin1,
        utf16,
    };

    fn write(this: *@This(), chunk: []const u8, is_last: bool, comptime encoding: WriteEncoding) bun.OOM!ResumableSinkBackpressure {
        if (this.ended) return .done; // no backpressure since we are done
        // we may call done inside processBuffered so we ensure that we keep a ref until we are done
        this.ref();
        defer this.deref();
        if (this.state == .wait_stream_check and chunk.len == 0 and is_last) {
            // we do this because stream will close if the file dont exists and we dont wanna to send an empty part in this case
            this.ended = true;
            if (this.buffered.size() > 0) {
                this.processBuffered(this.partSizeInBytes());
            }
            return if (this.hasBackpressure()) .backpressure else .want_more;
        }
        if (is_last) {
            this.ended = true;
            if (chunk.len > 0) {
                switch (encoding) {
                    .bytes => try this.buffered.write(chunk),
                    .latin1 => try this.buffered.writeLatin1(chunk, true),
                    .utf16 => try this.buffered.writeUTF16(@alignCast(std.mem.bytesAsSlice(u16, chunk))),
                }
            }
            this.processBuffered(this.partSizeInBytes());
        } else {
            // still have more data and receive empty, nothing todo here
            if (chunk.len == 0) return if (this.hasBackpressure()) .backpressure else .want_more;
            switch (encoding) {
                .bytes => try this.buffered.write(chunk),
                .latin1 => try this.buffered.writeLatin1(chunk, true),
                .utf16 => try this.buffered.writeUTF16(@alignCast(std.mem.bytesAsSlice(u16, chunk))),
            }
            const partSize = this.partSizeInBytes();
            if (this.buffered.size() >= partSize) {
                // send the part we have enough data
                this.processBuffered(partSize);
            }

            // wait for more
        }
        return if (this.hasBackpressure()) .backpressure else .want_more;
    }

    pub fn writeLatin1(this: *@This(), chunk: []const u8, is_last: bool) bun.OOM!ResumableSinkBackpressure {
        return try this.write(chunk, is_last, .latin1);
    }

    pub fn writeUTF16(this: *@This(), chunk: []const u8, is_last: bool) bun.OOM!ResumableSinkBackpressure {
        return try this.write(chunk, is_last, .utf16);
    }

    pub fn writeBytes(this: *@This(), chunk: []const u8, is_last: bool) bun.OOM!ResumableSinkBackpressure {
        return try this.write(chunk, is_last, .bytes);
    }
};

const std = @import("std");
const ACL = @import("./acl.zig").ACL;
const MultiPartUploadOptions = @import("./multipart_options.zig").MultiPartUploadOptions;
const S3Credentials = @import("./credentials.zig").S3Credentials;
const S3Error = @import("./error.zig").S3Error;
const Storageclass = @import("./storage_class.zig").StorageClass;

const S3SimpleRequest = @import("./simple_request.zig");
const executeSimpleS3Request = S3SimpleRequest.executeSimpleS3Request;

const bun = @import("bun");
const jsc = bun.jsc;
const strings = bun.strings;
const ResumableSinkBackpressure = jsc.WebCore.ResumableSinkBackpressure;
