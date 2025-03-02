//! Represents the kind of exports a module has, used to determine
//! how imports and requires should be handled at compile-time and runtime

/// Enum representing the various module export styles
pub const ExportsKind = enum {
    /// This file doesn't have any kind of export, so it's impossible to say what
    /// kind of file this is. An empty file is in this category, for example.
    none,

    /// The exports are stored on "module" and/or "exports". Calling "require()"
    /// on this module returns "module.exports". All imports to this module are
    /// allowed but may return undefined.
    cjs,

    /// All export names are known explicitly. Calling "require()" on this module
    /// generates an exports object (stored in "exports") with getters for the
    /// export names. Named imports to this module are only allowed if they are
    /// in the set of export names.
    esm,

    /// Some export names are known explicitly, but others fall back to a dynamic
    /// run-time object. This is necessary when using the "export * from" syntax
    /// with either a CommonJS module or an external module (i.e. a module whose
    /// export names are not known at compile-time).
    ///
    /// Calling "require()" on this module generates an exports object (stored in
    /// "exports") with getters for the export names. All named imports to this
    /// module are allowed. Direct named imports reference the corresponding export
    /// directly. Other imports go through property accesses on "exports".
    esm_with_dynamic_fallback,

    /// Like "esm_with_dynamic_fallback", but the module was originally a CommonJS
    /// module.
    esm_with_dynamic_fallback_from_cjs,

    pub fn isDynamic(self: ExportsKind) bool {
        return switch (self) {
            .cjs, .esm_with_dynamic_fallback, .esm_with_dynamic_fallback_from_cjs => true,
            .none, .esm => false,
        };
    }

    pub fn isESMWithDynamicFallback(self: ExportsKind) bool {
        return switch (self) {
            .none, .cjs, .esm => false,
            .esm_with_dynamic_fallback, .esm_with_dynamic_fallback_from_cjs => true,
        };
    }

    pub fn jsonStringify(self: @This(), writer: anytype) !void {
        return try writer.write(@tagName(self));
    }
};