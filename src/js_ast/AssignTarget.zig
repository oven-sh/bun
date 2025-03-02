//! Enum representing different types of assignment operations

/// Represents the type of assignment in an expression
pub const AssignTarget = enum(u2) {
    /// No assignment
    none = 0,

    /// Direct replacement assignment (a = b)
    replace = 1,

    /// Update assignment with operation (a += b, etc)
    update = 2,

    pub fn jsonStringify(self: *const @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};
