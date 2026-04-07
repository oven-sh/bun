//! OTLP trace data model. These are the "at-rest" structs the encoder walks —
//! not the live recording span (that's PR2's `Tracer`/`Span` class). All slices
//! are borrowed; the owner is typically a per-batch arena.

pub const TraceId = [16]u8;
pub const SpanId = [8]u8;

pub const zero_trace_id: TraceId = [_]u8{0} ** 16;
pub const zero_span_id: SpanId = [_]u8{0} ** 8;

pub const SpanContext = extern struct {
    trace_id: TraceId,
    span_id: SpanId,
    flags: u8,

    pub fn isValid(self: *const SpanContext) bool {
        return !std.mem.eql(u8, &self.trace_id, &zero_trace_id) and
            !std.mem.eql(u8, &self.span_id, &zero_span_id);
    }
};

pub const SpanKind = enum(u8) {
    unspecified = 0,
    internal = 1,
    server = 2,
    client = 3,
    producer = 4,
    consumer = 5,
};

pub const StatusCode = enum(u8) {
    unset = 0,
    ok = 1,
    err = 2,
};

pub const Status = struct {
    code: StatusCode = .unset,
    message: []const u8 = "",
};

pub const Event = struct {
    time_unix_nano: u64,
    name: []const u8,
    attributes: []const Attribute = attrs.empty,
    dropped_attributes_count: u32 = 0,
};

pub const Link = struct {
    trace_id: TraceId,
    span_id: SpanId,
    trace_state: []const u8 = "",
    attributes: []const Attribute = attrs.empty,
    dropped_attributes_count: u32 = 0,
    flags: u32 = 0,
};

pub const Span = struct {
    trace_id: TraceId,
    span_id: SpanId,
    trace_state: []const u8 = "",
    parent_span_id: SpanId = zero_span_id,
    flags: u32 = 0,
    name: []const u8,
    kind: SpanKind = .internal,
    start_time_unix_nano: u64 = 0,
    end_time_unix_nano: u64 = 0,
    attributes: []const Attribute = attrs.empty,
    dropped_attributes_count: u32 = 0,
    events: []const Event = &.{},
    dropped_events_count: u32 = 0,
    links: []const Link = &.{},
    dropped_links_count: u32 = 0,
    status: Status = .{},
};

pub const InstrumentationScope = struct {
    name: []const u8 = "",
    version: []const u8 = "",
    attributes: []const Attribute = attrs.empty,
    dropped_attributes_count: u32 = 0,
};

pub const Resource = struct {
    attributes: []const Attribute = attrs.empty,
    dropped_attributes_count: u32 = 0,
};

pub const ScopeSpans = struct {
    scope: ?InstrumentationScope = null,
    spans: []const Span,
    schema_url: []const u8 = "",
};

pub const ResourceSpans = struct {
    resource: ?Resource = null,
    scope_spans: []const ScopeSpans,
    schema_url: []const u8 = "",
};

const std = @import("std");
const attrs = @import("./attributes.zig");
const Attribute = attrs.Attribute;
