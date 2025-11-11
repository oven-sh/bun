const FetchTaskletRequest = @This();
request_body: ?HTTPRequestBody = null,
request_headers: Headers = Headers{ .allocator = undefined },
sink: ?*ResumableSink = null,
metadata: ?http.HTTPResponseMetadata = null,

// Custom Hostname
hostname: ?[]u8 = null,
/// This is url + proxy memory buffer and is owned by FetchTasklet
/// We always clone url and proxy (if informed)
url_proxy_buffer: []const u8 = "",

state: enum {
    created,
    enqueued,
    // information_headers,
    headers_sent,
    sending_body, // can be sent with the headers or separately
    // sending_trailer_headers,
    failed,
    done,
} = .created,

fn parent(this: *FetchTaskletRequest) *FetchTasklet {
    return @fieldParentPtr("request", this);
}

pub fn startRequestStream(this: *FetchTaskletRequest) void {
    this.is_waiting_request_stream_start = false;
    bun.assert(this.request_body == .ReadableStream);
    const tasklet = this.parent();
    if (this.request_body.ReadableStream.get(this.global_this)) |stream| {
        const globalThis = tasklet.global_this;
        if (tasklet.isAborted()) {
            stream.abort(globalThis);
            return;
        }

        tasklet.ref(); // lets only unref when sink is done
        // +1 because the task refs the sink
        const sink = ResumableSink.initExactRefs(globalThis, stream, this, 2);
        this.sink = sink;
    }
}
pub fn writeRequestData(this: *FetchTaskletRequest, data: []const u8) ResumableSinkBackpressure {
    log("writeRequestData {}", .{data.len});
    const tasklet = this.parent();
    if (tasklet.isAborted()) {
        return .done;
    }
    const thread_safe_stream_buffer = tasklet.shared.request_body_streaming_buffer orelse return .done;
    const stream_buffer = thread_safe_stream_buffer.acquire();
    defer thread_safe_stream_buffer.release();
    const highWaterMark = if (this.sink) |sink| sink.highWaterMark else 16384;

    var needs_schedule = false;
    defer if (needs_schedule) {
        // wakeup the http thread to write the data
        http.http_thread.scheduleRequestWrite(tasklet.http.?, .data);
    };

    // dont have backpressure so we will schedule the data to be written
    // if we have backpressure the onWritable will drain the buffer
    needs_schedule = stream_buffer.isEmpty();
    if (this.upgraded_connection) {
        bun.handleOom(stream_buffer.write(data));
    } else {
        //16 is the max size of a hex number size that represents 64 bits + 2 for the \r\n
        var formated_size_buffer: [18]u8 = undefined;
        const formated_size = std.fmt.bufPrint(
            formated_size_buffer[0..],
            "{x}\r\n",
            .{data.len},
        ) catch |err| switch (err) {
            error.NoSpaceLeft => unreachable,
        };
        bun.handleOom(stream_buffer.ensureUnusedCapacity(formated_size.len + data.len + 2));
        stream_buffer.writeAssumeCapacity(formated_size);
        stream_buffer.writeAssumeCapacity(data);
        stream_buffer.writeAssumeCapacity("\r\n");
    }

    // pause the stream if we hit the high water mark
    return if (stream_buffer.size() >= highWaterMark) .backpressure else .want_more;
}

pub fn writeEndRequest(this: *FetchTaskletRequest, err: ?jsc.JSValue) void {
    log("writeEndRequest hasError? {}", .{err != null});
    defer this.deref();
    if (err) |jsError| {
        if (this.signal_store.aborted.load(.monotonic) or this.abort_reason.has()) {
            return;
        }
        if (!jsError.isUndefinedOrNull()) {
            this.abort_reason.set(this.global_this, jsError);
        }
        this.abortTask();
    } else {
        if (!this.upgraded_connection) {
            // If is not upgraded we need to send the terminating chunk
            const thread_safe_stream_buffer = this.request_body_streaming_buffer orelse return;
            const stream_buffer = thread_safe_stream_buffer.acquire();
            defer thread_safe_stream_buffer.release();
            bun.handleOom(stream_buffer.write(http.end_of_chunked_http1_1_encoding_response_body));
        }
        if (this.http) |http_| {
            // just tell to write the end of the chunked encoding aka 0\r\n\r\n
            http.http_thread.scheduleRequestWrite(http_, .end);
        }
    }
}

/// This is ALWAYS called from the main thread
pub fn resumeRequestDataStream(this: *FetchTaskletRequest) void {
    // deref when done because we ref inside SharedData.resumeRequestDataStream
    const tasklet = this.parent();
    defer tasklet.deref();
    if (tasklet.isAborted()) {
        // already aborted; nothing to drain
        return;
    }
    log("resumeRequestDataStream", .{});
    if (this.sink) |sink| {
        sink.drain();
    }
}

pub fn deinit(this: *FetchTaskletRequest) void {
    if (this.request_body) |body| {
        body.detach();
        this.request_body = null;
    }
    if (this.request_body_streaming_buffer) |buffer| {
        this.request_body_streaming_buffer = null;
        buffer.deref();
    }
}

const HTTPRequestBody = @import("HTTPRequestBody.zig").HTTPRequestBody;
const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const http = bun.http;
const Headers = http.Headers;
const ResumableSinkBackpressure = jsc.WebCore.ResumableSinkBackpressure;
const ResumableSink = jsc.WebCore.ResumableFetchSink;
const log = bun.Output.scoped(.FetchTaskletRequest, .visible);
const FetchTasklet = @import("../FetchTasklet.zig").FetchTasklet;
