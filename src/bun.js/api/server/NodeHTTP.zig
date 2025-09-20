const StreamBuffer = extern struct {
    buffer: ?[*]u8 = null,
    bufferLength: usize = 0,
    bufferPosition: usize = 0,
    bytesWritten: usize = 0,

    pub fn update(this: *StreamBuffer, stream_buffer: bun.io.StreamBuffer) void {
        if (stream_buffer.list.capacity > 0) {
            this.buffer = stream_buffer.list.items.ptr;
        } else {
            this.buffer = null;
        }
        this.bufferLength = stream_buffer.list.items.len;
        this.bufferPosition = stream_buffer.cursor;
    }
    pub fn wrote(this: *StreamBuffer, written: usize) void {
        this.bytesWritten +|= written;
    }

    pub fn toBunIOStreamBuffer(this: *StreamBuffer) bun.io.StreamBuffer {
        return .{
            .list = if (this.buffer) |buffer_ptr| .{
                .allocator = bun.default_allocator,
                .items = buffer_ptr[0..this.bufferLength],
                .capacity = this.bufferLength,
            } else .{
                .allocator = bun.default_allocator,
                .items = &.{},
                .capacity = 0,
            },
            .cursor = this.bufferPosition,
        };
    }

    pub fn deinit(this: *StreamBuffer) void {
        if (this.buffer) |buffer| {
            bun.default_allocator.free(buffer[0..this.bufferLength]);
        }
        this.buffer = null;
        this.bufferLength = 0;
        this.bufferPosition = 0;
        this.bytesWritten = 0;
    }
};

pub export fn Bun__NodeHTTP_freeStreamBuffer(buffer: *StreamBuffer) void {
    buffer.deinit();
}

pub export fn Bun__NodeHTTP_rawWrite(
    socket: *uws.us_socket_t,
    is_ssl: bool,
    ended: bool,
    buffer: *StreamBuffer,
    globalObject: *jsc.JSGlobalObject,
    data: jsc.JSValue,
    encoding: jsc.JSValue,
) jsc.JSValue {
    // convever it back to StreamBuffer
    var stream_buffer = buffer.toBunIOStreamBuffer();
    var total_written: usize = 0;
    // update the buffer pointer to the new buffer
    defer {
        buffer.update(stream_buffer);
        buffer.wrote(total_written);
    }

    var stack_fallback = std.heap.stackFallback(16 * 1024, bun.default_allocator);
    const node_buffer: jsc.Node.BlobOrStringOrBuffer = if (data.isUndefined())
        jsc.Node.BlobOrStringOrBuffer{ .string_or_buffer = jsc.Node.StringOrBuffer.empty }
    else
        jsc.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueMaybeAsyncAllowRequestResponse(globalObject, stack_fallback.get(), data, encoding, false, true) catch {
            return .zero;
        } orelse {
            if (!globalObject.hasException()) {
                return globalObject.throwInvalidArgumentTypeValue("data", "string, buffer, or blob", data) catch .zero;
            }
            return .zero;
        };

    defer node_buffer.deinit();
    if (node_buffer == .blob and node_buffer.blob.needsToReadFile()) {
        return globalObject.throw("File blob not supported yet in this function.", .{}) catch .zero;
    }

    const data_slice = node_buffer.slice();
    if (stream_buffer.isNotEmpty()) {
        // need to flush
        const to_flush = stream_buffer.slice();
        const written: u32 = @max(0, socket.write(is_ssl, to_flush));
        stream_buffer.wrote(written);
        total_written +|= written;
        if (written < to_flush.len) {
            if (data_slice.len > 0) {
                bun.handleOom(stream_buffer.write(data_slice));
            }
            return JSValue.jsNumber(written);
        }
        // stream buffer is empty now
    }

    if (data_slice.len > 0) {
        const written: u32 = @max(0, socket.write(is_ssl, data_slice));
        total_written +|= written;
        if (written < data_slice.len) {
            bun.handleOom(stream_buffer.write(data_slice[written..]));
            return JSValue.jsNumber(total_written);
        }
    }
    if (ended) {
        // last part so we shutdown the writable side of the socket aka send FIN
        socket.shutdown(is_ssl);
    }
    return JSValue.jsNumber(total_written);
}

const std = @import("std");
const bun = @import("bun");
const uws = @import("uws");
const jsc = @import("jsc");
const JSValue = jsc.JSValue;
