//! Specialized representation for inline enum values
//! Uses memory tagging tricks to efficiently store strings or numbers
/// Memory-efficient inlined enum value that can store either a string or number
/// Raw data storage using tagged pointer technique
raw_data: u64,

/// Possible decoded values from the inlined enum value
pub const Decoded = union(enum) {
    string: *E.String,
    number: f64,
};

/// See JSCJSValue.h in WebKit for more details
const double_encode_offset = 1 << 49;
/// See PureNaN.h in WebKit for more details
const pure_nan: f64 = @bitCast(@as(u64, 0x7ff8000000000000));

/// Normalize NaN values to a canonical representation
fn purifyNaN(value: f64) f64 {
    return if (std.math.isNan(value)) pure_nan else value;
}

/// Encode a string or number into an inlined enum value
pub fn encode(decoded: Decoded) InlinedEnumValue {
    const encoded: InlinedEnumValue = .{ .raw_data = switch (decoded) {
        .string => |ptr| @as(u48, @truncate(@intFromPtr(ptr))),
        .number => |num| @as(u64, @bitCast(purifyNaN(num))) + double_encode_offset,
    } };
    if (Environment.allow_assert) {
        bun.assert(switch (encoded.decode()) {
            .string => |str| str == decoded.string,
            .number => |num| @as(u64, @bitCast(num)) ==
                @as(u64, @bitCast(purifyNaN(decoded.number))),
        });
    }
    return encoded;
}

/// Decode an inlined enum value back to its original form
pub fn decode(encoded: InlinedEnumValue) Decoded {
    if (encoded.raw_data > 0x0000FFFFFFFFFFFF) {
        return .{ .number = @bitCast(encoded.raw_data - double_encode_offset) };
    } else {
        return .{ .string = @ptrFromInt(encoded.raw_data) };
    }
}

const std = @import("std");
const E = @import("expr/e.zig");
const Environment = bun.Environment;
const bun = @import("root").bun;
const InlinedEnumValue = @This();
