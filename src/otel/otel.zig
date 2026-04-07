//! Native OpenTelemetry support. PR1 surface: the OTLP protobuf codec
//! (`Bun.otel.encodeTraces` / `decodeTraces`) and the at-rest data model the
//! encoder walks. The live tracer, batch processor and exporter are PR2.

pub const span = @import("./span.zig");
pub const attributes = @import("./attributes.zig");
pub const protobuf = @import("./otlp/protobuf.zig");
pub const encode = @import("./otlp/encode.zig");
pub const js = @import("./js.zig");

pub const Span = span.Span;
pub const SpanContext = span.SpanContext;
pub const ResourceSpans = span.ResourceSpans;
pub const Attribute = attributes.Attribute;
pub const AnyValue = attributes.AnyValue;

comptime {
    _ = js;
}
