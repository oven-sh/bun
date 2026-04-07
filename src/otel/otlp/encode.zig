//! OTLP/protobuf trace encoder. Walks the Zig data model in `span.zig` and
//! emits an `ExportTraceServiceRequest` directly into a byte buffer — no
//! intermediate generated proto structs.
//!
//! Field tags come from the generated `OtlpProtoTags` module so a wrong field
//! number is a compile error against the vendored .proto, not silent corruption.

pub fn encodeExportTraceServiceRequest(
    gpa: std.mem.Allocator,
    resource_spans: []const span.ResourceSpans,
    out: *std.ArrayList(u8),
) OOM!void {
    const w = pb.Writer.init(gpa, out);
    for (resource_spans) |*rs| {
        try w.writeSubmessage(tags.ExportTraceServiceRequest.resource_spans, rs, encodeResourceSpans);
    }
}

fn encodeResourceSpans(w: pb.Writer, rs: *const span.ResourceSpans) OOM!void {
    if (rs.resource) |*res| {
        try w.writeSubmessage(tags.ResourceSpans.resource, res, encodeResource);
    }
    for (rs.scope_spans) |*ss| {
        try w.writeSubmessage(tags.ResourceSpans.scope_spans, ss, encodeScopeSpans);
    }
    if (rs.schema_url.len > 0) try w.writeString(tags.ResourceSpans.schema_url, rs.schema_url);
}

fn encodeResource(w: pb.Writer, res: *const span.Resource) OOM!void {
    try encodeAttrs(w, tags.Resource.attributes, res.attributes);
    if (res.dropped_attributes_count > 0) {
        try w.writeUint32(tags.Resource.dropped_attributes_count, res.dropped_attributes_count);
    }
}

fn encodeScopeSpans(w: pb.Writer, ss: *const span.ScopeSpans) OOM!void {
    if (ss.scope) |*scope| {
        try w.writeSubmessage(tags.ScopeSpans.scope, scope, encodeScope);
    }
    for (ss.spans) |*s| {
        try w.writeSubmessage(tags.ScopeSpans.spans, s, encodeSpan);
    }
    if (ss.schema_url.len > 0) try w.writeString(tags.ScopeSpans.schema_url, ss.schema_url);
}

fn encodeScope(w: pb.Writer, scope: *const span.InstrumentationScope) OOM!void {
    if (scope.name.len > 0) try w.writeString(tags.InstrumentationScope.name, scope.name);
    if (scope.version.len > 0) try w.writeString(tags.InstrumentationScope.version, scope.version);
    try encodeAttrs(w, tags.InstrumentationScope.attributes, scope.attributes);
    if (scope.dropped_attributes_count > 0) {
        try w.writeUint32(tags.InstrumentationScope.dropped_attributes_count, scope.dropped_attributes_count);
    }
}

fn encodeSpan(w: pb.Writer, s: *const span.Span) OOM!void {
    try w.writeBytes(tags.Span.trace_id, &s.trace_id);
    try w.writeBytes(tags.Span.span_id, &s.span_id);
    if (s.trace_state.len > 0) try w.writeString(tags.Span.trace_state, s.trace_state);
    if (!std.mem.eql(u8, &s.parent_span_id, &span.zero_span_id)) {
        try w.writeBytes(tags.Span.parent_span_id, &s.parent_span_id);
    }
    if (s.name.len > 0) try w.writeString(tags.Span.name, s.name);
    if (s.kind != .unspecified) try w.writeEnum(tags.Span.kind, @intFromEnum(s.kind));
    if (s.start_time_unix_nano > 0) try w.writeFixed64(tags.Span.start_time_unix_nano, s.start_time_unix_nano);
    if (s.end_time_unix_nano > 0) try w.writeFixed64(tags.Span.end_time_unix_nano, s.end_time_unix_nano);
    try encodeAttrs(w, tags.Span.attributes, s.attributes);
    if (s.dropped_attributes_count > 0) {
        try w.writeUint32(tags.Span.dropped_attributes_count, s.dropped_attributes_count);
    }
    for (s.events) |*e| {
        try w.writeSubmessage(tags.Span.events, e, encodeEvent);
    }
    if (s.dropped_events_count > 0) {
        try w.writeUint32(tags.Span.dropped_events_count, s.dropped_events_count);
    }
    for (s.links) |*l| {
        try w.writeSubmessage(tags.Span.links, l, encodeLink);
    }
    if (s.dropped_links_count > 0) {
        try w.writeUint32(tags.Span.dropped_links_count, s.dropped_links_count);
    }
    if (s.status.code != .unset or s.status.message.len > 0) {
        try w.writeSubmessage(tags.Span.status, &s.status, encodeStatus);
    }
    if (s.flags > 0) try w.writeFixed32(tags.Span.flags, s.flags);
}

fn encodeEvent(w: pb.Writer, e: *const span.Event) OOM!void {
    if (e.time_unix_nano > 0) try w.writeFixed64(tags.Span_Event.time_unix_nano, e.time_unix_nano);
    if (e.name.len > 0) try w.writeString(tags.Span_Event.name, e.name);
    try encodeAttrs(w, tags.Span_Event.attributes, e.attributes);
    if (e.dropped_attributes_count > 0) {
        try w.writeUint32(tags.Span_Event.dropped_attributes_count, e.dropped_attributes_count);
    }
}

fn encodeLink(w: pb.Writer, l: *const span.Link) OOM!void {
    try w.writeBytes(tags.Span_Link.trace_id, &l.trace_id);
    try w.writeBytes(tags.Span_Link.span_id, &l.span_id);
    if (l.trace_state.len > 0) try w.writeString(tags.Span_Link.trace_state, l.trace_state);
    try encodeAttrs(w, tags.Span_Link.attributes, l.attributes);
    if (l.dropped_attributes_count > 0) {
        try w.writeUint32(tags.Span_Link.dropped_attributes_count, l.dropped_attributes_count);
    }
    if (l.flags > 0) try w.writeFixed32(tags.Span_Link.flags, l.flags);
}

fn encodeStatus(w: pb.Writer, s: *const span.Status) OOM!void {
    if (s.message.len > 0) try w.writeString(tags.Status.message, s.message);
    if (s.code != .unset) try w.writeEnum(tags.Status.code, @intFromEnum(s.code));
}

inline fn encodeAttrs(w: pb.Writer, comptime field: anytype, list: attrs.AttrList) OOM!void {
    for (list.slice()) |*a| try w.writeSubmessage(field, a, encodeKeyValue);
}

fn encodeKeyValue(w: pb.Writer, kv: *const Attribute) OOM!void {
    const k = kv.key();
    if (k.len > 0) try w.writeString(tags.KeyValue.key, k);
    try w.writeSubmessage(tags.KeyValue.value, kv, encodeAnyValue);
}

fn encodeAnyValue(w: pb.Writer, kv: *const Attribute) OOM!void {
    switch (kv.tag()) {
        .string => try w.writeString(tags.AnyValue.string_value, kv.string()),
        .boolean => try w.writeBool(tags.AnyValue.bool_value, kv.boolean()),
        .int => try w.writeInt64(tags.AnyValue.int_value, kv.int()),
        .double => try w.writeDouble(tags.AnyValue.double_value, kv.double()),
        .bytes => try w.writeBytes(tags.AnyValue.bytes_value, kv.bytes()),
        .array => try w.writeSubmessage(tags.AnyValue.array_value, kv.array(), encodeArrayValue),
        .kvlist => try w.writeSubmessage(tags.AnyValue.kvlist_value, kv.kvlist(), encodeKeyValueList),
        .empty => {},
    }
}

fn encodeArrayValue(w: pb.Writer, arr: []const Attribute) OOM!void {
    for (arr) |*v| try w.writeSubmessage(tags.ArrayValue.values, v, encodeAnyValue);
}

fn encodeKeyValueList(w: pb.Writer, kvs: []const Attribute) OOM!void {
    for (kvs) |*kv| try w.writeSubmessage(tags.KeyValueList.values, kv, encodeKeyValue);
}

const pb = @import("./protobuf.zig");
const span = @import("../span.zig");
const std = @import("std");
const tags = @import("OtlpProtoTags");
const OOM = std.mem.Allocator.Error;

const attrs = @import("../attributes.zig");
const Attribute = attrs.Attribute;
