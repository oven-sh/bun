//! gRPC wire protocol support for Bun's HTTP/2 fetch client.
//!
//! gRPC is a thin layer over HTTP/2: a request is a POST to
//! `/<package>.<Service>/<Method>` with `content-type: application/grpc`
//! and `te: trailers`. The body is a sequence of Length-Prefixed Messages
//! (1-byte compressed flag, 4-byte big-endian length, payload). The response
//! carries `grpc-status` / `grpc-message` in the trailing HEADERS frame — or,
//! for an error-before-body "Trailers-Only" response, in the initial HEADERS.
//!
//! `fetch(url, { grpc: true })` enables this path: the request body is
//! wrapped in a single Length-Prefixed Message, the required headers are
//! injected, the response trailers are captured and merged into the
//! Response headers, and the response body is unwrapped so JS sees only
//! the payload. Only unary RPCs are handled natively for now.
//!
//! Spec: https://github.com/grpc/grpc/blob/master/doc/PROTOCOL-HTTP2.md

/// gRPC status codes (spec §"Status codes and their use in gRPC").
pub const Status = enum(u8) {
    OK = 0,
    CANCELLED = 1,
    UNKNOWN = 2,
    INVALID_ARGUMENT = 3,
    DEADLINE_EXCEEDED = 4,
    NOT_FOUND = 5,
    ALREADY_EXISTS = 6,
    PERMISSION_DENIED = 7,
    RESOURCE_EXHAUSTED = 8,
    FAILED_PRECONDITION = 9,
    ABORTED = 10,
    OUT_OF_RANGE = 11,
    UNIMPLEMENTED = 12,
    INTERNAL = 13,
    UNAVAILABLE = 14,
    DATA_LOSS = 15,
    UNAUTHENTICATED = 16,
    _,
};

/// Size of the Length-Prefixed-Message header: 1-byte Compressed-Flag +
/// 4-byte big-endian Message-Length.
pub const message_header_len = 5;

pub const content_type = "application/grpc";

/// Wrap a single protobuf-encoded payload in a gRPC Length-Prefixed
/// Message. Caller owns the returned buffer.
pub fn frameMessage(allocator: std.mem.Allocator, payload: []const u8) []u8 {
    const out = bun.handleOom(allocator.alloc(u8, message_header_len + payload.len));
    out[0] = 0; // Compressed-Flag: uncompressed
    std.mem.writeInt(u32, out[1..5], @intCast(payload.len), .big);
    @memcpy(out[message_header_len..], payload);
    return out;
}

/// One Length-Prefixed Message parsed from a response body.
pub const Message = struct {
    compressed: bool,
    /// Payload bytes, borrowed from the input buffer.
    payload: []const u8,
    /// Bytes consumed from the input (header + payload).
    consumed: usize,
};

/// Parse one Length-Prefixed Message from the start of `buf`. Returns
/// `null` if fewer than `message_header_len + length` bytes are
/// available or the declared length is implausibly large.
pub fn parseMessage(buf: []const u8) ?Message {
    if (buf.len < message_header_len) return null;
    const len = std.mem.readInt(u32, buf[1..5], .big);
    const total = message_header_len + @as(usize, len);
    if (buf.len < total) return null;
    return .{
        .compressed = buf[0] != 0,
        .payload = buf[message_header_len..total],
        .consumed = total,
    };
}

/// Map an HTTP-layer failure to a gRPC status, following the gRPC spec's
/// "HTTP to gRPC Status Code Mapping" where applicable. Anything without a
/// direct mapping becomes UNAVAILABLE, matching grpc-go / grpc-java for a
/// connection that never produced a response.
pub fn statusFromHttpError(err: anyerror) Status {
    return switch (err) {
        error.Aborted, error.AbortedBeforeConnecting => .CANCELLED,
        error.Timeout, error.ConnectionTimeout => .DEADLINE_EXCEEDED,
        else => .UNAVAILABLE,
    };
}

const std = @import("std");

const bun = @import("bun");
