//! Represents the different ways JavaScript strict mode can be enabled

/// Enum for tracking how strict mode is enabled in a JavaScript context
pub const StrictModeKind = enum(u4) {
    /// Default JavaScript behavior with no strict mode
    sloppy_mode,

    /// Strict mode was explicitly enabled with "use strict"
    explicit_strict_mode,

    /// Strict mode is implicitly enabled because of an import statement
    implicit_strict_mode_import,

    /// Strict mode is implicitly enabled because of an export statement
    implicit_strict_mode_export,

    /// Strict mode is implicitly enabled because of top-level await
    implicit_strict_mode_top_level_await,

    /// Strict mode is implicitly enabled because of a class definition
    implicit_strict_mode_class,

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};
