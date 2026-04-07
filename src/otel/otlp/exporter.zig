//! OTLP/HTTP exporter. Thin wrapper around `bun.http.AsyncHTTP` that POSTs
//! protobuf-encoded ExportTraceServiceRequest bodies to `<endpoint>/v1/traces`.
//!
//! The send is fire-and-forget from the BatchProcessor's perspective: it hands
//! ownership of the encoded body here, we schedule on the HTTP thread, and the
//! processor's completion callback is invoked on the JS thread once the request
//! finishes (or exhausts retries).

const log = bun.Output.scoped(.otel, .visible);

pub const OnComplete = *const fn (ctx: *anyopaque, ok: bool, status: u32, rejected_spans: i64, err_msg: []const u8) void;

pub const OtlpHttpExporter = struct {
    allocator: std.mem.Allocator,
    vm: *jsc.VirtualMachine,

    /// Owned. Full traces URL: `<endpoint>/v1/traces`.
    traces_url_buf: []const u8,
    traces_url: bun.URL,
    headers: http.Headers,

    pub const new = bun.TrivialNew(@This());

    pub fn init(
        allocator: std.mem.Allocator,
        vm: *jsc.VirtualMachine,
        endpoint: []const u8,
        extra_headers: []const Config.KV,
    ) !*OtlpHttpExporter {
        const trimmed = std.mem.trimRight(u8, endpoint, "/");
        const url_buf = try std.fmt.allocPrint(allocator, "{s}/v1/traces", .{trimmed});
        errdefer allocator.free(url_buf);

        var headers: http.Headers = .{ .allocator = allocator };
        errdefer headers.deinit();
        try headers.append("Content-Type", "application/x-protobuf");
        try headers.append("User-Agent", "bun/" ++ bun.Environment.version_string);
        for (extra_headers) |h| try headers.append(h.name, h.value);

        http.HTTPThread.init(&.{});

        return OtlpHttpExporter.new(.{
            .allocator = allocator,
            .vm = vm,
            .traces_url_buf = url_buf,
            .traces_url = bun.URL.parse(url_buf),
            .headers = headers,
        });
    }

    pub fn deinit(self: *OtlpHttpExporter) void {
        self.headers.deinit();
        self.allocator.free(self.traces_url_buf);
        bun.destroy(self);
    }

    /// Takes ownership of `body` (allocated with bun.default_allocator).
    pub fn send(self: *OtlpHttpExporter, body: std.ArrayList(u8), ctx: *anyopaque, on_complete: OnComplete) void {
        const req = ExportRequest.new(.{
            .exporter = self,
            .body = body,
            .response_buffer = bun.MutableString.initEmpty(bun.default_allocator),
            .async_http = undefined,
            .on_complete = on_complete,
            .ctx = ctx,
        });

        req.async_http = http.AsyncHTTP.init(
            bun.default_allocator,
            .POST,
            self.traces_url,
            self.headers.entries,
            self.headers.buf.items,
            &req.response_buffer,
            req.body.items,
            http.HTTPClientResult.Callback.New(*ExportRequest, ExportRequest.httpCallback).init(req),
            .manual,
            .{},
        );

        bun.http.http_thread.schedule(ThreadPool.Batch.from(&req.async_http.task));
    }
};

const max_retries: u8 = 3;

const ExportRequest = struct {
    exporter: *OtlpHttpExporter,
    body: std.ArrayList(u8),
    response_buffer: bun.MutableString,
    async_http: http.AsyncHTTP,

    on_complete: OnComplete,
    ctx: *anyopaque,

    /// Filled on the HTTP thread, read on the JS thread.
    result_status: u32 = 0,
    result_ok: bool = false,
    result_fail: ?anyerror = null,
    retries: u8 = 0,

    pub const new = bun.TrivialNew(@This());

    /// Runs on the HTTP thread. Must not touch JS.
    fn httpCallback(self: *ExportRequest, async_http: *http.AsyncHTTP, result: http.HTTPClientResult) void {
        if (result.has_more) return;

        self.async_http = async_http.*;
        self.async_http.response_buffer = async_http.response_buffer;

        self.result_fail = result.fail;
        if (result.metadata) |meta| {
            self.result_status = @intCast(meta.response.status_code);
        }
        self.result_ok = result.isSuccess() and self.result_status >= 200 and self.result_status < 300;

        if (self.exporter.vm.isShuttingDown()) {
            self.destroyFromHttpThread();
            return;
        }
        self.exporter.vm.eventLoop().enqueueTaskConcurrent(
            jsc.ConcurrentTask.fromCallback(self, ExportRequest.runFromJS),
        );
    }

    /// Runs on the JS thread (via ManagedTask).
    pub fn runFromJS(self: *ExportRequest) error{}!void {
        if (!self.result_ok and isRetryable(self.result_status, self.result_fail) and self.retries < max_retries) {
            self.retries += 1;
            log("export retry {d}/{d} (status={d} err={?})", .{ self.retries, max_retries, self.result_status, self.result_fail });
            self.response_buffer.reset();
            self.async_http.clearData();
            // TODO: exponential backoff via event-loop timer; immediate for now.
            self.async_http = http.AsyncHTTP.init(
                bun.default_allocator,
                .POST,
                self.exporter.traces_url,
                self.exporter.headers.entries,
                self.exporter.headers.buf.items,
                &self.response_buffer,
                self.body.items,
                http.HTTPClientResult.Callback.New(*ExportRequest, ExportRequest.httpCallback).init(self),
                .manual,
                .{},
            );
            bun.http.http_thread.schedule(ThreadPool.Batch.from(&self.async_http.task));
            return;
        }

        var rejected: i64 = 0;
        var msg: []const u8 = "";
        if (self.result_ok) {
            decodePartialSuccess(self.response_buffer.list.items, &rejected, &msg);
        } else if (self.result_fail) |e| {
            log("export failed: {s}", .{@errorName(e)});
        } else {
            log("export rejected by collector: HTTP {d}", .{self.result_status});
        }

        self.on_complete(self.ctx, self.result_ok, self.result_status, rejected, msg);
        self.deinit();
    }

    fn destroyFromHttpThread(self: *ExportRequest) void {
        // VM is shutting down; just free without invoking the callback.
        self.deinit();
    }

    fn deinit(self: *ExportRequest) void {
        self.body.deinit(bun.default_allocator);
        self.response_buffer.deinit();
        self.async_http.clearData();
        bun.destroy(self);
    }
};

fn isRetryable(status: u32, fail: ?anyerror) bool {
    if (fail) |e| {
        // Transport-level failure: retry on network errors, not on protocol errors.
        return switch (e) {
            error.ConnectionRefused, error.ConnectionClosed, error.Timeout, error.ConnectionReset => true,
            else => false,
        };
    }
    return switch (status) {
        429, 502, 503, 504 => true,
        else => false,
    };
}

/// ExportTraceServiceResponse { 1: ExportTracePartialSuccess { 1: int64 rejected, 2: string msg } }
fn decodePartialSuccess(body: []const u8, rejected: *i64, msg: *[]const u8) void {
    var r = pb.Reader{ .buf = body };
    while (r.remaining() > 0) {
        const hdr = r.readTag() catch return;
        if (hdr.num == tags.ExportTraceServiceResponse.partial_success.num) {
            var sub = r.submessage() catch return;
            while (sub.remaining() > 0) {
                const h = sub.readTag() catch return;
                if (h.num == tags.ExportTracePartialSuccess.rejected_spans.num) {
                    rejected.* = @bitCast(sub.readVarint() catch return);
                } else if (h.num == tags.ExportTracePartialSuccess.error_message.num) {
                    msg.* = sub.readBytes() catch return;
                } else {
                    sub.skip(h.wire) catch return;
                }
            }
        } else {
            r.skip(hdr.wire) catch return;
        }
    }
}

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const http = bun.http;
const ThreadPool = bun.ThreadPool;

const pb = @import("./protobuf.zig");
const tags = @import("OtlpProtoTags");
const Config = @import("../tracer.zig").Config;
