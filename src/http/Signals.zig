const Signals = @This();

header_progress: ?*std.atomic.Value(bool) = null,
response_body_streaming: ?*std.atomic.Value(bool) = null,
aborted: ?*std.atomic.Value(bool) = null,
cert_errors: ?*std.atomic.Value(bool) = null,
upgraded: ?*std.atomic.Value(bool) = null,
/// Set by the JS-side consumer (FetchTasklet) when the unread response body
/// buffered in memory has crossed the high-water mark. The HTTP thread
/// observes this after delivering a chunk and pauses the socket so TCP
/// backpressure engages instead of growing the buffer without bound.
/// Cleared by the consumer when the buffer drains below the low-water mark;
/// the HTTP thread then resumes the socket via the response-body-drain queue.
body_backpressure: ?*std.atomic.Value(bool) = null,
pub fn isEmpty(this: *const Signals) bool {
    return this.aborted == null and this.response_body_streaming == null and this.header_progress == null and this.cert_errors == null and this.upgraded == null and this.body_backpressure == null;
}

pub const Store = struct {
    header_progress: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    response_body_streaming: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    aborted: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    cert_errors: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    upgraded: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    body_backpressure: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    pub fn to(this: *Store) Signals {
        return .{
            .header_progress = &this.header_progress,
            .response_body_streaming = &this.response_body_streaming,
            .aborted = &this.aborted,
            .cert_errors = &this.cert_errors,
            .upgraded = &this.upgraded,
            .body_backpressure = &this.body_backpressure,
        };
    }
};

pub fn get(this: Signals, comptime field: std.meta.FieldEnum(Signals)) bool {
    var ptr: *std.atomic.Value(bool) = @field(this, @tagName(field)) orelse return false;
    return ptr.load(.monotonic);
}

const std = @import("std");
