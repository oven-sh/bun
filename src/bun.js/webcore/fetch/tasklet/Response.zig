const Response = @This();
/// buffer used to stream response to JS
scheduled_response_buffer: MutableString = .{
    .allocator = bun.default_allocator,
    .list = .{
        .items = &.{},
        .capacity = 0,
    },
},
check_server_identity: jsc.Strong.Optional = .empty,
flags: Flags = .{},
/// stream strong ref if any is available
readable_stream_ref: jsc.WebCore.ReadableStream.Strong = .{},
/// response weak ref we need this to track the response JS lifetime
response: jsc.Weak(FetchTasklet) = .{},
/// native response ref if we still need it when JS is discarted
native_response: ?*Response = null,

/// For Http Client requests
/// when Content-Length is provided this represents the whole size of the request
/// If chunked encoded this will represent the total received size (ignoring the chunk headers)
/// If is not chunked encoded and Content-Length is not provided this will be unknown
body_size: http.HTTPClientResult.BodySize = .unknown,

state: enum {
    created,
    enqueued,
    // information_headers,
    headers_received,
    receiving_body, // can be sent with the headers or separately
    // receiving_trailer_headers,
    failed,
    done,
} = .created,

pub const Flags = packed struct(u8) {
    ignore_data: bool = false,
    upgraded_connection: bool = false,
    reject_unauthorized: bool = true,
    _padding: u5 = 0,
};

pub fn onReadableStreamAvailable(ctx: *anyopaque, globalThis: *jsc.JSGlobalObject, readable: jsc.WebCore.ReadableStream) void {
    const this = bun.cast(*FetchTasklet, ctx);
    this.readable_stream_ref = jsc.WebCore.ReadableStream.Strong.init(readable, globalThis);
}

pub fn checkServerIdentity(this: *FetchTasklet, certificate_info: http.CertificateInfo) bool {
    if (this.check_server_identity.get()) |check_server_identity| {
        check_server_identity.ensureStillAlive();
        if (certificate_info.cert.len > 0) {
            const cert = certificate_info.cert;
            var cert_ptr = cert.ptr;
            if (BoringSSL.d2i_X509(null, &cert_ptr, @intCast(cert.len))) |x509| {
                const globalObject = this.global_this;
                defer x509.free();
                const js_cert = X509.toJS(x509, globalObject) catch |err| {
                    switch (err) {
                        error.JSError => {},
                        error.OutOfMemory => globalObject.throwOutOfMemory() catch {},
                        error.JSTerminated => {},
                    }
                    const check_result = globalObject.tryTakeException().?;
                    // mark to wait until deinit
                    this.is_waiting_abort = this.result.has_more;
                    this.abort_reason.set(globalObject, check_result);
                    this.signal_store.aborted.store(true, .monotonic);
                    this.tracker.didCancel(this.global_this);
                    // we need to abort the request
                    if (this.http) |http_| http.http_thread.scheduleShutdown(http_);
                    this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
                    return false;
                };
                var hostname: bun.String = bun.String.cloneUTF8(certificate_info.hostname);
                defer hostname.deref();
                const js_hostname = hostname.toJS(globalObject);
                js_hostname.ensureStillAlive();
                js_cert.ensureStillAlive();
                const check_result = check_server_identity.call(globalObject, .js_undefined, &.{ js_hostname, js_cert }) catch |err| globalObject.takeException(err);

                // > Returns <Error> object [...] on failure
                if (check_result.isAnyError()) {
                    // mark to wait until deinit
                    this.is_waiting_abort = this.result.has_more;
                    this.abort_reason.set(globalObject, check_result);
                    this.signal_store.aborted.store(true, .monotonic);
                    this.tracker.didCancel(this.global_this);

                    // we need to abort the request
                    if (this.http) |http_| {
                        http.http_thread.scheduleShutdown(http_);
                    }
                    this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
                    return false;
                }

                // > On success, returns <undefined>
                // We treat any non-error value as a success.
                return true;
            }
        }
    }
    this.result.fail = error.ERR_TLS_CERT_ALTNAME_INVALID;
    return false;
}

pub fn onBodyReceived(this: *FetchTasklet) bun.JSTerminated!void {
    const success = this.result.isSuccess();
    const globalThis = this.global_this;
    // reset the buffer if we are streaming or if we are not waiting for bufferig anymore
    var buffer_reset = true;
    log("onBodyReceived success={} has_more={}", .{ success, this.result.has_more });
    defer {
        if (buffer_reset) {
            this.scheduled_response_buffer.reset();
        }
    }

    if (!success) {
        var err = this.onReject();
        var need_deinit = true;
        defer if (need_deinit) err.deinit();
        var js_err = JSValue.zero;
        // if we are streaming update with error
        if (this.readable_stream_ref.get(globalThis)) |readable| {
            if (readable.ptr == .Bytes) {
                js_err = err.toJS(globalThis);
                js_err.ensureStillAlive();
                try readable.ptr.Bytes.onData(
                    .{
                        .err = .{ .JSValue = js_err },
                    },
                    bun.default_allocator,
                );
            }
        }
        if (this.sink) |sink| {
            if (js_err == .zero) {
                js_err = err.toJS(globalThis);
                js_err.ensureStillAlive();
            }
            sink.cancel(js_err);
            return;
        }
        // if we are buffering resolve the promise
        if (this.getCurrentResponse()) |response| {
            need_deinit = false; // body value now owns the error
            const body = response.getBodyValue();
            try body.toErrorInstance(err, globalThis);
        }
        return;
    }

    if (this.readable_stream_ref.get(globalThis)) |readable| {
        log("onBodyReceived readable_stream_ref", .{});
        if (readable.ptr == .Bytes) {
            readable.ptr.Bytes.size_hint = this.getSizeHint();
            // body can be marked as used but we still need to pipe the data
            const scheduled_response_buffer = &this.scheduled_response_buffer.list;

            const chunk = scheduled_response_buffer.items;

            if (this.result.has_more) {
                try readable.ptr.Bytes.onData(
                    .{
                        .temporary = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                    },
                    bun.default_allocator,
                );
            } else {
                var prev = this.readable_stream_ref;
                this.readable_stream_ref = .{};
                defer prev.deinit();
                buffer_reset = false;

                try readable.ptr.Bytes.onData(
                    .{
                        .temporary_and_done = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                    },
                    bun.default_allocator,
                );
            }
            return;
        }
    }

    if (this.getCurrentResponse()) |response| {
        log("onBodyReceived Current Response", .{});
        const sizeHint = this.getSizeHint();
        response.setSizeHint(sizeHint);
        if (response.getBodyReadableStream(globalThis)) |readable| {
            log("onBodyReceived CurrentResponse BodyReadableStream", .{});
            if (readable.ptr == .Bytes) {
                const scheduled_response_buffer = this.scheduled_response_buffer.list;

                const chunk = scheduled_response_buffer.items;

                if (this.result.has_more) {
                    try readable.ptr.Bytes.onData(
                        .{
                            .temporary = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                        },
                        bun.default_allocator,
                    );
                } else {
                    readable.value.ensureStillAlive();
                    response.detachReadableStream(globalThis);
                    try readable.ptr.Bytes.onData(
                        .{
                            .temporary_and_done = bun.ByteList.fromBorrowedSliceDangerous(chunk),
                        },
                        bun.default_allocator,
                    );
                }

                return;
            }
        }

        // we will reach here when not streaming, this is also the only case we dont wanna to reset the buffer
        buffer_reset = false;
        if (!this.result.has_more) {
            var scheduled_response_buffer = this.scheduled_response_buffer.list;
            const body = response.getBodyValue();
            // done resolve body
            var old = body.*;
            const body_value = Body.Value{
                .InternalBlob = .{
                    .bytes = scheduled_response_buffer.toManaged(bun.default_allocator),
                },
            };
            body.* = body_value;
            log("onBodyReceived body_value length={}", .{body_value.InternalBlob.bytes.items.len});

            this.scheduled_response_buffer = .{
                .allocator = bun.default_allocator,
                .list = .{
                    .items = &.{},
                    .capacity = 0,
                },
            };

            if (old == .Locked) {
                log("onBodyReceived old.resolve", .{});
                try old.resolve(body, this.global_this, response.getFetchHeaders());
            }
        }
    }
}

pub fn onStartStreamingHTTPResponseBodyCallback(ctx: *anyopaque) jsc.WebCore.DrainResult {
    const this = bun.cast(*FetchTasklet, ctx);
    if (this.signal_store.aborted.load(.monotonic)) {
        return jsc.WebCore.DrainResult{
            .aborted = {},
        };
    }

    if (this.http) |http_| {
        http_.enableResponseBodyStreaming();

        // If the server sent the headers and the response body in two separate socket writes
        // and if the server doesn't close the connection by itself
        // and doesn't send any follow-up data
        // then we must make sure the HTTP thread flushes.
        bun.http.http_thread.scheduleResponseBodyDrain(http_.async_http_id);
    }

    this.mutex.lock();
    defer this.mutex.unlock();
    const size_hint = this.getSizeHint();

    var scheduled_response_buffer = this.scheduled_response_buffer.list;
    // This means we have received part of the body but not the whole thing
    if (scheduled_response_buffer.items.len > 0) {
        this.scheduled_response_buffer = .{
            .allocator = bun.default_allocator,
            .list = .{
                .items = &.{},
                .capacity = 0,
            },
        };

        return .{
            .owned = .{
                .list = scheduled_response_buffer.toManaged(bun.default_allocator),
                .size_hint = size_hint,
            },
        };
    }

    return .{
        .estimated_size = size_hint,
    };
}

fn getSizeHint(this: *FetchTasklet) Blob.SizeType {
    return switch (this.body_size) {
        .content_length => @truncate(this.body_size.content_length),
        .total_received => @truncate(this.body_size.total_received),
        .unknown => 0,
    };
}

fn toBodyValue(this: *FetchTasklet) Body.Value {
    if (this.getAbortError()) |err| {
        return .{ .Error = err };
    }
    if (this.is_waiting_body) {
        const response = Body.Value{
            .Locked = .{
                .size_hint = this.getSizeHint(),
                .task = this,
                .global = this.global_this,
                .onStartStreaming = FetchTasklet.onStartStreamingHTTPResponseBodyCallback,
                .onReadableStreamAvailable = FetchTasklet.onReadableStreamAvailable,
            },
        };
        return response;
    }

    var scheduled_response_buffer = this.scheduled_response_buffer.list;
    const response = Body.Value{
        .InternalBlob = .{
            .bytes = scheduled_response_buffer.toManaged(bun.default_allocator),
        },
    };
    this.scheduled_response_buffer = .{
        .allocator = bun.default_allocator,
        .list = .{
            .items = &.{},
            .capacity = 0,
        },
    };

    return response;
}

fn ignoreRemainingResponseBody(this: *FetchTasklet) void {
    log("ignoreRemainingResponseBody", .{});
    // enabling streaming will make the http thread to drain into the main thread (aka stop buffering)
    // without a stream ref, response body or response instance alive it will just ignore the result
    if (this.http) |http_| {
        http_.enableResponseBodyStreaming();
    }
    // we should not keep the process alive if we are ignoring the body
    const vm = this.javascript_vm;
    this.poll_ref.unref(vm);
    // clean any remaining refereces
    this.readable_stream_ref.deinit();
    this.response.deinit();

    if (this.native_response) |response| {
        response.unref();
        this.native_response = null;
    }

    this.ignore_data = true;
}

fn toResponse(this: *FetchTasklet) Response {
    log("toResponse", .{});
    bun.assert(this.metadata != null);
    // at this point we always should have metadata
    const metadata = this.metadata.?;
    const http_response = metadata.response;
    this.is_waiting_body = this.result.has_more;
    return Response.init(
        .{
            .headers = FetchHeaders.createFromPicoHeaders(http_response.headers),
            .status_code = @as(u16, @truncate(http_response.status_code)),
            .status_text = bun.String.createAtomIfPossible(http_response.status),
        },
        Body{
            .value = this.toBodyValue(),
        },
        bun.String.createAtomIfPossible(metadata.url),
        this.result.redirected,
    );
}

const bun = @import("bun");
const MutableString = bun.MutableString;
const jsc = bun.jsc;
const http = bun.http;
pub const ResumableSink = jsc.WebCore.ResumableFetchSink;
const FetchTasklet = @import("../FetchTasklet.zig");
const log = bun.Output.scoped(.FetchTaskletResponse, .visible);
const BoringSSL = bun.BoringSSL.c;
const FetchHeaders = bun.webcore.FetchHeaders;
const Body = jsc.WebCore.Body;
const X509 = @import("../../../api/bun/x509.zig").X509;
const JSValue = jsc.JSValue;
const Blob = jsc.WebCore.Blob;
