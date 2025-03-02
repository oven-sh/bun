//! Top-level await check for JavaScript modules

/// Represents a top-level await check for JavaScript modules
const TlaCheck = @This();

/// The depth in the dependency graph
depth: u32 = 0,

/// The parent index in the graph
parent: Index.Int = Index.invalid.get(),

/// The import record index
import_record_index: Index.Int = Index.invalid.get(),

/// Initialize a new TLA check
pub fn init() TlaCheck {
    return .{};
}

/// Initialize a TLA check with specific values
pub fn initWith(depth: u32, parent: Index.Int, import_record_index: Index.Int) TlaCheck {
    return .{
        .depth = depth,
        .parent = parent,
        .import_record_index = import_record_index,
    };
}

/// Check if this is a valid TLA check with a valid import record
pub fn hasValidImportRecord(self: TlaCheck) bool {
    return self.import_record_index != Index.invalid.get();
}

/// Check if this has a valid parent
pub fn hasValidParent(self: TlaCheck) bool {
    return self.parent != Index.invalid.get();
}

const std = @import("std");
const Index = @import("js_ast.zig").Index;
