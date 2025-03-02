//! Named import representation

/// Represents a named import in JavaScript
const NamedImport = @This();

/// Parts within this file that use this import
local_parts_with_uses: BabyList(u32) = BabyList(u32){},

/// Optional alias name
alias: ?string,

/// Location of the alias in source code
alias_loc: ?logger.Loc = null,

/// Reference to the namespace
namespace_ref: ?Ref,

/// Index of the import record
import_record_index: u32,

/// If true, the alias refers to the entire export namespace object of a
/// module. This is no longer represented as an alias called "*" because of
/// the upcoming "Arbitrary module namespace identifier names" feature:
/// https://github.com/tc39/ecma262/pull/2154
alias_is_star: bool = false,

/// It's useful to flag exported imports because if they are in a TypeScript
/// file, we can't tell if they are a type or a value.
is_exported: bool = false,

/// Map of named imports
pub const Map = std.ArrayHashMapUnmanaged(Ref, NamedImport, RefHashCtx, true);

/// Add a local part that uses this import
pub fn addLocalPartWithUse(self: *NamedImport, allocator: std.mem.Allocator, part_index: u32) !void {
    try self.local_parts_with_uses.append(allocator, part_index);
}

/// Deinitialize and free resources
pub fn deinit(self: *NamedImport, allocator: std.mem.Allocator) void {
    self.local_parts_with_uses.deinit(allocator);
}

const std = @import("std");
const bun = @import("root").bun;
const logger = bun.logger;
const string = bun.string;
const BabyList = bun.BabyList;
const js_ast = @import("js_ast.zig");
const Ref = js_ast.Ref;
const RefHashCtx = Ref.HashCtx;
