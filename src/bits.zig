//! Bitfield helper functions. T should be a packed struct of booleans.

/// If the right side is known at compile time, you should just perform field accesses
///
///     intersects(T, a, .{ .flag = true }) --> a.flag
///
pub inline fn intersects(comptime T: type, lhs: T, rhs: T) bool {
    return asInt(T, lhs) & asInt(T, rhs) != 0;
}

pub inline fn @"and"(comptime T: type, lhs: T, rhs: T) T {
    return fromInt(T, asInt(T, lhs) & asInt(T, rhs));
}

pub inline fn @"or"(comptime T: type, lhs: T, rhs: T) T {
    return fromInt(T, asInt(T, lhs) | asInt(T, rhs));
}

pub inline fn invert(comptime T: type, value: T) T {
    return fromInt(T, ~asInt(T, value));
}

/// Prefer a property assignment when possible
///
///     insert(T, &a, .{ .flag = true }) --> a.flag = true;
///
pub inline fn insert(comptime T: type, lhs: *T, rhs: T) void {
    lhs.* = @"or"(T, lhs.*, rhs);
}

pub inline fn contains(comptime T: type, lhs: T, rhs: T) bool {
    return (asInt(T, lhs) & asInt(T, rhs)) != 0;
}

pub inline fn maskOut(comptime T: type, lhs: *T, rhs: T) T {
    return @"and"(T, lhs, invert(T, rhs));
}

pub inline fn remove(comptime T: type, lhs: *T, rhs: T) void {
    lhs.* = @"and"(T, lhs.*, invert(T, rhs));
}

pub inline fn leadingZeros(comptime T: type, value: T) LeadingZerosInt(T) {
    return @clz(asInt(T, value));
}

pub fn LeadingZerosInt(comptime T: type) type {
    const backing_int = @typeInfo(T).@"struct".backing_integer.?;
    return std.math.IntFittingRange(0, @typeInfo(backing_int).int.bits);
}

pub inline fn fromInt(comptime T: type, bits: @typeInfo(T).@"struct".backing_integer.?) T {
    return @bitCast(bits);
}

pub inline fn asInt(comptime T: type, value: T) @typeInfo(T).@"struct".backing_integer.? {
    return @bitCast(value);
}

const std = @import("std");
