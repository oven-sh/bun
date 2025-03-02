//! Reference type for AST nodes
//! Used to reference symbols and identifiers throughout the AST

const std = @import("std");
const ast_base = @import("../ast/base.zig");

pub const Ref = ast_base.Ref;