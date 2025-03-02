//! Named export representation
const std = @import("std");
const bun = @import("root").bun;
const logger = bun.logger;
const Ref = @import("js_ast.zig").Ref;

/// Represents a named export in JavaScript
const NamedExport = @This();

/// Reference to the exported symbol
ref: Ref,

/// Location of the alias in source code
alias_loc: logger.Loc,

/// Map of named exports
pub const Map = bun.StringArrayHashMapUnmanaged(NamedExport);

/// Initialize a new named export
pub fn init(ref: Ref, alias_loc: logger.Loc) NamedExport {
    return .{
        .ref = ref,
        .alias_loc = alias_loc,
    };
}

/// Check if two named exports are equal
pub fn eql(self: NamedExport, other: NamedExport) bool {
    return self.ref.eql(other.ref) and
        self.alias_loc.eql(other.alias_loc);
}
