pub const std = @import("std");
pub const logger = @import("../logger.zig");
pub const js_lexer = @import("../js_lexer.zig");
pub const importRecord = @import("../import_record.zig");
pub const js_ast = @import("../js_ast.zig");
pub const options = @import("../options.zig");
pub const alloc = @import("../alloc.zig");
pub const js_printer = @import("../js_printer.zig");
pub const renamer = @import("../renamer.zig");
const _runtime = @import("../runtime.zig");
pub const RuntimeImports = _runtime.Runtime.Imports;
pub const RuntimeFeatures = _runtime.Runtime.Features;
pub const fs = @import("../fs.zig");
const _hash_map = @import("../hash_map.zig");
pub usingnamespace @import("../global.zig");
pub usingnamespace @import("../ast/base.zig");
pub usingnamespace js_ast.G;
pub usingnamespace @import("../defines.zig");

pub const ImportKind = importRecord.ImportKind;
pub const BindingNodeIndex = js_ast.BindingNodeIndex;

pub const StmtNodeIndex = js_ast.StmtNodeIndex;
pub const ExprNodeIndex = js_ast.ExprNodeIndex;
pub const ExprNodeList = js_ast.ExprNodeList;
pub const StmtNodeList = js_ast.StmtNodeList;
pub const BindingNodeList = js_ast.BindingNodeList;

pub const assert = std.debug.assert;

pub const LocRef = js_ast.LocRef;
pub const S = js_ast.S;
pub const B = js_ast.B;
pub const G = js_ast.G;
pub const T = js_lexer.T;
pub const E = js_ast.E;
pub const Stmt = js_ast.Stmt;
pub const Expr = js_ast.Expr;
pub const Binding = js_ast.Binding;
pub const Symbol = js_ast.Symbol;
pub const Level = js_ast.Op.Level;
pub const Op = js_ast.Op;
pub const Scope = js_ast.Scope;
pub const locModuleScope = logger.Loc{ .start = -100 };

pub const StringHashMap = _hash_map.StringHashMap;
pub const AutoHashMap = _hash_map.AutoHashMap;
