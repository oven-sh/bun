//! Represents the different types of optional chaining operations in JavaScript

const std = @import("std");
const logger = @import("../logger.zig");

/// Union representing the different types of optional chaining
/// operations with their source ranges
pub const OptionalChain = enum(u1) {
    /// "a?.b"
    start,

    /// "a?.b.c" => ".c" is .continuation
    /// "(a?.b).c" => ".c" is null
    continuation,

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};
