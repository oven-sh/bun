//! Dependency representation for AST parts

/// Source index in the dependency graph
source_index: Index = Index.invalid,

/// Part index in the source
part_index: Index.Int = 0,

/// List of dependencies
pub const List = BabyList(Dependency);

/// Initialize a new dependency
pub fn init(source_index: Index, part_index: Index.Int) Dependency {
    return .{
        .source_index = source_index,
        .part_index = part_index,
    };
}

/// Check if this dependency is valid
pub fn isValid(self: Dependency) bool {
    return !self.source_index.eql(Index.invalid);
}

const std = @import("std");
const bun = @import("root").bun;
const BabyList = bun.BabyList;
const Index = @import("js_ast.zig").Index;

/// Represents a dependency between AST parts
const Dependency = @This();
