const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const S3Credentials = @import("./credentials.zig").S3Credentials;
const ACL = @import("./acl.zig").ACL;
const Storageclass = @import("./storage_class.zig").StorageClass;
const JSC = bun.JSC;
const MultiPartUploadOptions = @import("./multipart_options.zig").MultiPartUploadOptions;
const S3SimpleRequest = @import("./simple_request.zig");
const executeSimpleS3Request = S3SimpleRequest.executeSimpleS3Request;
const S3Error = @import("./error.zig").S3Error;
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

    const Self = @This();
    const RefCount = bun.ptr.RefCount(Self, "ref_count", deinit, .{});
    pub const ref = RefCount.ref;
    pub const deref = RefCount.deref;

    const log = bun.Output.scoped(.S3MultiPartUpload, true);

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

        pub fn onPartResponse(result: S3SimpleRequest.S3PartResult, this: *@This()) void {
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
                        this.perform();
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
                    this.freeAllocatedSlice();
                    // we will need to order this
                    this.ctx.multipart_etags.append(bun.default_allocator, .{
                        .number = this.partNumber,
                        .etag = bun.default_allocator.dupe(u8, etag) catch bun.outOfMemory(),
                    }) catch bun.outOfMemory();
                    this.state = .not_assigned;
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
            if (this.state != .pending or this.ctx.state != .multipart_completed) return;
            this.ctx.ref();
            this.state = .started;
            this.perform();
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
        this.credentials.deref();
        this.uploadid_buffer.deinit();
        for (this.multipart_etags.items) |tag| {
            bun.default_allocator.free(tag.etag);
        }
        if (this.multipart_etags.capacity > 0)
            this.multipart_etags.deinit(bun.default_allocator);
        if (this.multipart_upload_list.cap > 0)
            this.multipart_upload_list.deinitWithAllocator(bun.default_allocator);
        bun.destroy(this);
    }

    pub fn singleSendUploadResponse(result: S3SimpleRequest.S3UploadResult, this: *@This()) void {
        if (this.state == .finished) return;
        switch (result) {
            .failure => |err| {
                if (this.options.retry > 0) {
                    log("singleSendUploadResponse {} retry", .{this.options.retry});
                    this.options.retry -= 1;
                    executeSimpleS3Request(this.credentials, .{
                        .path = this.path,
                        .method = .PUT,
                        .proxy_url = this.proxyUrl(),
                        .body = this.buffered.items,
                        .content_type = this.content_type,
                        .acl = this.acl,
                        .storage_class = this.storage_class,
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
            const queue = bun.default_allocator.alloc(UploadPart, queueSize) catch bun.outOfMemory();
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
        const data = if (needs_clone) bun.default_allocator.dupe(u8, chunk) catch bun.outOfMemory() else chunk;
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
    fn drainEnqueuedParts(this: *@This()) void {
        if (this.state == .finished or this.state == .singlefile_started) {
            return;
        }
        // check pending to start or transformed buffered ones into tasks
        if (this.state == .multipart_completed) {
            if (this.queue) |queue| {
                for (queue) |*part| {
                    if (part.state == .pending) {
                        // lets start the part request
                        part.start();
                    }
                }
            }
        }
        const partSize = this.partSizeInBytes();
        if (this.ended or this.buffered.items.len >= partSize) {
            this.processMultiPart(partSize);
        }

        if (this.ended and this.available.mask == std.bit_set.IntegerBitSet(MAX_QUEUE_SIZE).initFull().mask) {
            // we are done and no more parts are running
            this.done();
        }
    }
    /// Finalize the upload with a failure
    pub fn fail(this: *@This(), _err: S3Error) void {
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
            this.callback(.{ .failure = _err }, this.callback_context);

            if (old_state == .multipart_completed) {
                // we are a multipart upload so we need to rollback
                // will deref after rollback
                this.rollbackMultiPartRequest();
            } else {
                // single file upload no need to rollback
                this.deref();
            }
        }
    }
    /// Finalize successful the upload
    fn done(this: *@This()) void {
        if (this.state == .multipart_completed) {
            // we are a multipart upload so we need to send the etags and commit
            this.state = .finished;
            // sort the etags
            std.sort.block(UploadPart.UploadPartResult, this.multipart_etags.items, this, UploadPart.sortEtags);
            // start the multipart upload list
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
            // single file upload no need to commit
            this.callback(.{ .success = {} }, this.callback_context);
            this.state = .finished;
            this.deref();
        }
    }

    /// Result of the Multipart request, after this we can start draining the parts
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
                // start draining the parts
                this.drainEnqueuedParts();
            },
            // this is "unreachable" but we cover in case AWS returns 404
            .not_found => this.fail(.{
                .code = "UnknownError",
                .message = "Failed to initiate multipart upload",
            }),
        }
    }

    /// We do a best effort to commit the multipart upload, if it fails we will retry, if it still fails we will fail the upload
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
    /// We do a best effort to rollback the multipart upload, if it fails we will retry, if it still we just deinit the upload
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
    fn enqueuePart(this: *@This(), chunk: []const u8, allocated_size: usize, needs_clone: bool) bool {
        const part = this.getCreatePart(chunk, allocated_size, needs_clone) orelse return false;

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
                .storage_class = this.storage_class,
            }, .{ .download = @ptrCast(&startMultiPartRequestResult) }, this);
        } else if (this.state == .multipart_completed) {
            part.start();
        }
        return true;
    }

    fn processMultiPart(this: *@This(), part_size: usize) void {
        log("processMultiPart {s} {d}", .{ this.path, part_size });
        // need to split in multiple parts because of the size
        var buffer = this.buffered.items[this.offset..];
        defer if (this.offset >= this.buffered.items.len) {
            this.buffered.clearRetainingCapacity();
            this.offset = 0;
        };

        while (buffer.len > 0) {
            const len = @min(part_size, buffer.len);
            if (len < part_size and !this.ended) {
                log("processMultiPart {s} {d} slice too small", .{ this.path, len });
                //slice is too small, we need to wait for more data
                break;
            }
            // if is one big chunk we can pass ownership and avoid dupe
            if (len == this.buffered.items.len) {
                // we need to know the allocated size to free the memory later
                const allocated_size = this.buffered.capacity;
                const slice = this.buffered.items;

                // we dont care about the result because we are sending everything
                if (this.enqueuePart(slice, allocated_size, false)) {
                    log("processMultiPart {s} {d} full buffer enqueued", .{ this.path, slice.len });

                    // queue is not full, we can clear the buffer part now owns the data
                    // if its full we will retry later
                    this.buffered = .{};
                    this.offset = 0;
                    return;
                }
                log("processMultiPart {s} {d} queue full", .{ this.path, slice.len });

                return;
            }

            const slice = buffer[0..len];
            buffer = buffer[len..];
            // allocated size is the slice len because we dupe the buffer
            if (this.enqueuePart(slice, slice.len, true)) {
                log("processMultiPart {s} {d} slice enqueued", .{ this.path, slice.len });
                // queue is not full, we can set the offset
                this.offset += len;
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
        if (this.ended and this.buffered.items.len < this.partSizeInBytes() and this.state == .not_started) {
            log("processBuffered {s} singlefile_started", .{this.path});
            this.state = .singlefile_started;
            // we can do only 1 request
            executeSimpleS3Request(this.credentials, .{
                .path = this.path,
                .method = .PUT,
                .proxy_url = this.proxyUrl(),
                .body = this.buffered.items,
                .content_type = this.content_type,
                .acl = this.acl,
                .storage_class = this.storage_class,
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
            if (this.buffered.items.len > 0) {
                this.processBuffered(this.partSizeInBytes());
            }
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
