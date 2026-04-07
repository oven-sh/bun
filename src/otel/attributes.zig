//! OTLP attribute model. Mirrors `opentelemetry.proto.common.v1.KeyValue` /
//! `AnyValue` but as plain Zig data with borrowed slices — callers own the
//! backing memory (typically a per-batch arena).

pub const AnyValue = union(enum) {
    string: []const u8,
    boolean: bool,
    int: i64,
    double: f64,
    bytes: []const u8,
    array: []const AnyValue,
    kvlist: []const Attribute,
    /// Empty AnyValue (all oneof fields unset).
    empty,
};

pub const Attribute = struct {
    key: []const u8,
    value: AnyValue,
};

pub const empty: []const Attribute = &.{};

const std = @import("std");
