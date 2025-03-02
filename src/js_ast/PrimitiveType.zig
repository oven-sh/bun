//! JavaScript primitive types
//! Defines the core primitive types used in JavaScript

const std = @import("std");

/// JavaScript primitive type enum
pub const PrimitiveType = enum {
    unknown,
    mixed,
    null,
    undefined,
    boolean,
    number,
    string,
    bigint,

    pub const static = std.enums.EnumSet(PrimitiveType).init(.{
        .mixed = true,
        .null = true,
        .undefined = true,
        .boolean = true,
        .number = true,
        .string = true,
        // for our purposes, bigint is dynamic
        // it is technically static though
        // .@"bigint" = true,
    });

    pub inline fn isStatic(this: PrimitiveType) bool {
        return static.contains(this);
    }

    pub fn merge(left_known: PrimitiveType, right_known: PrimitiveType) PrimitiveType {
        if (right_known == .unknown or left_known == .unknown)
            return .unknown;

        return if (left_known == right_known)
            left_known
        else
            .mixed;
    }
};
