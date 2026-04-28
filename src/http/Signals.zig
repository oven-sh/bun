const Signals = @This();

header_progress: ?*std.atomic.Value(bool) = null,
response_body_streaming: ?*std.atomic.Value(bool) = null,
/// Distinct from `response_body_streaming`: set only while a JS consumer
/// is wired to report drained bytes via `scheduleResponseBodyConsumed`.
/// `response_body_streaming` is also set by paths that never report
/// consumption (S3 streaming download, abandoned bodies via
/// `ignoreRemainingResponseBody`); gating flow-control on that would
/// deadlock those streams. The h2 client uses this signal — not
/// `response_body_streaming` — to decide whether per-stream WINDOW_UPDATE
/// should be consumption-gated or receipt-based.
body_consumption_tracked: ?*std.atomic.Value(bool) = null,
aborted: ?*std.atomic.Value(bool) = null,
cert_errors: ?*std.atomic.Value(bool) = null,
upgraded: ?*std.atomic.Value(bool) = null,
pub fn isEmpty(this: *const Signals) bool {
    return this.aborted == null and this.response_body_streaming == null and this.header_progress == null and this.cert_errors == null and this.upgraded == null;
}

pub const Store = struct {
    header_progress: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    response_body_streaming: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    body_consumption_tracked: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    aborted: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    cert_errors: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    upgraded: std.atomic.Value(bool) = std.atomic.Value(bool).init(false),
    pub fn to(this: *Store) Signals {
        return .{
            .header_progress = &this.header_progress,
            .response_body_streaming = &this.response_body_streaming,
            .body_consumption_tracked = &this.body_consumption_tracked,
            .aborted = &this.aborted,
            .cert_errors = &this.cert_errors,
            .upgraded = &this.upgraded,
        };
    }
};

pub fn get(this: Signals, comptime field: std.meta.FieldEnum(Signals)) bool {
    var ptr: *std.atomic.Value(bool) = @field(this, @tagName(field)) orelse return false;
    return ptr.load(.monotonic);
}

const std = @import("std");
