const std = @import("std");
const js_ast = @import("./js_ast.zig");

const GlobalDefinesKey = @import("./defines-table.zig").GlobalDefinesKey;

pub const defaultIdentifierDefines = comptime {};

pub const IdentifierDefine = struct {};

pub const DotDefine = struct {};

pub const Defines = struct {};
