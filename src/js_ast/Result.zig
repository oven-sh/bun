//! Result union for AST operations
const std = @import("std");
const Ast = @import("Ast.zig");

/// Represents the result of an AST operation
/// Can be an already bundled resource, a cached result, or a full AST
pub const Result = union(enum) {
    already_bundled: AlreadyBundled,
    cached: void,
    ast: Ast,

    pub const AlreadyBundled = enum {
        bun,
        bun_cjs,
        bytecode,
        bytecode_cjs,
    };
};
