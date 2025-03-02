//! Representation of a value within an enum declaration
//! Used to track enum members with their initializers

/// Represents an enum value in a TypeScript enum declaration
/// Source location of this enum value
loc: logger.Loc,

/// Reference to the symbol for this enum value
ref: Ref,

/// Name of the enum value
name: []const u8,

/// Optional initializer expression
value: ?ExprNodeIndex,

/// Utility to convert the name to a string expression
pub fn nameAsEString(enum_value: EnumValue, allocator: std.mem.Allocator) E.String {
    return E.String.initReEncodeUTF8(enum_value.name, allocator);
}

const EnumValue = @This();

const std = @import("std");
const logger = bun.logger;
const bun = @import("root").bun;
const js_ast = @import("js_ast.zig");
const ExprNodeIndex = js_ast.ExprNodeIndex;
const E = js_ast.E;
const Ref = js_ast.Ref;
