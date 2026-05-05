//! JSC bridges for `src/uws/` types. Keeps `uws/` free of JSC types.
//! Exports here are referenced via aliases on the original structs so call
//! sites do not change.

// ── create_bun_socket_error_t.toJS / us_bun_verify_error_t.toJS ────────────
pub fn createBunSocketErrorToJS(this: uws.create_bun_socket_error_t, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
    return switch (this) {
        // us_ssl_ctx_from_options only sets *err for the CA/cipher cases;
        // bad cert/key/DH return NULL with .none and the detail is on the
        // BoringSSL error queue. Surfacing it here keeps every
        // `createSSLContext(...) orelse return err.toJS()` site correct.
        .none => bun.BoringSSL.ERR_toJS(globalObject, bun.BoringSSL.c.ERR_get_error()),
        .load_ca_file => globalObject.ERR(.BORINGSSL, "Failed to load CA file", .{}).toJS(),
        .invalid_ca_file => globalObject.ERR(.BORINGSSL, "Invalid CA file", .{}).toJS(),
        .invalid_ca => globalObject.ERR(.BORINGSSL, "Invalid CA", .{}).toJS(),
        .invalid_ciphers => globalObject.ERR(.BORINGSSL, "Invalid ciphers", .{}).toJS(),
    };
}

pub fn verifyErrorToJS(this: *const uws.us_bun_verify_error_t, globalObject: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    const code = if (this.code == null) "" else this.code[0..bun.len(this.code)];
    const reason = if (this.reason == null) "" else this.reason[0..bun.len(this.reason)];

    const fallback = jsc.SystemError{
        .code = bun.String.cloneUTF8(code),
        .message = bun.String.cloneUTF8(reason),
    };

    return fallback.toErrorInstance(globalObject);
}

// ── AnyWebSocket.getTopicsAsJSArray ────────────────────────────────────────
extern fn uws_ws_get_topics_as_js_array(ssl: i32, ws: *uws.RawWebSocket, globalObject: *jsc.JSGlobalObject) jsc.JSValue;

pub fn anyWebSocketGetTopicsAsJSArray(this: uws.AnyWebSocket, globalObject: *jsc.JSGlobalObject) jsc.JSValue {
    return switch (this) {
        .ssl => uws_ws_get_topics_as_js_array(1, this.raw(), globalObject),
        .tcp => uws_ws_get_topics_as_js_array(0, this.raw(), globalObject),
    };
}

// ── us_socket_buffered_js_write (C-exported, called from JSNodeHTTPServerSocket.cpp) ──
export fn us_socket_buffered_js_write(
    socket: *uws.us_socket_t,
    // kept for ABI parity with the C++ caller; TLS is now per-socket
    _: bool,
    ended: bool,
    buffer: *us_socket_stream_buffer_t,
    globalObject: *jsc.JSGlobalObject,
    data: jsc.JSValue,
    encoding: jsc.JSValue,
) jsc.JSValue {
    var stream_buffer = buffer.toStreamBuffer();
    var total_written: usize = 0;
    defer {
        buffer.update(stream_buffer);
        buffer.wrote(total_written);
    }

    var stack_fallback = std.heap.stackFallback(16 * 1024, bun.default_allocator);
    const node_buffer: jsc.Node.BlobOrStringOrBuffer = if (data.isUndefined())
        jsc.Node.BlobOrStringOrBuffer{ .string_or_buffer = jsc.Node.StringOrBuffer.empty }
    else
        jsc.Node.BlobOrStringOrBuffer.fromJSWithEncodingValueAllowRequestResponse(globalObject, stack_fallback.get(), data, encoding, true) catch {
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
        const to_flush = stream_buffer.slice();
        const written: u32 = @max(0, socket.write(to_flush));
        stream_buffer.wrote(written);
        total_written +|= written;
        if (written < to_flush.len) {
            if (data_slice.len > 0) {
                bun.handleOom(stream_buffer.write(data_slice));
            }
            return .false;
        }
    }

    if (data_slice.len > 0) {
        const written: u32 = @max(0, socket.write(data_slice));
        total_written +|= written;
        if (written < data_slice.len) {
            bun.handleOom(stream_buffer.write(data_slice[written..]));
            return .false;
        }
    }
    if (ended) {
        socket.shutdown();
    }
    return .true;
}

comptime {
    _ = &us_socket_buffered_js_write;
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;

const uws = bun.uws;
const us_socket_stream_buffer_t = uws.us_socket_stream_buffer_t;
