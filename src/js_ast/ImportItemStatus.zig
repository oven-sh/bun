//! Status of an imported item, used to track whether imports exist
//! or should be handled specially in the linker/printer

/// Represents the status of an imported item in the AST
pub const ImportItemStatus = enum(u2) {
    /// Default status
    none,

    /// The linker doesn't report import/export mismatch errors
    generated,

    /// The printer will replace this import with "undefined"
    missing,

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};