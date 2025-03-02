//! JavaScript AST entry point
//! Re-exports all AST components from their individual files

const std = @import("std");
const bun = @import("root").bun;

// Base storage mechanism
pub const store = @import("store.zig");
pub const NewStore = store.NewStore;

// Binding types
pub const Binding = @import("binding.zig").Binding;
pub const BindingNodeIndex = Binding;
pub const BindingNodeList = []Binding;
pub const B = @import("binding/b.zig").B;

// Expression types
pub const Expr = @import("expr.zig");
pub const ExprNodeIndex = Expr;
pub const ExprNodeList = bun.BabyList(Expr);
pub const E = @import("expr/e.zig");

// Statement types
pub const Stmt = @import("stmt.zig");
pub const StmtNodeIndex = Stmt;
pub const StmtNodeList = []Stmt;
pub const S = @import("stmt/s.zig");

// Global/generic components

pub const G = @import("globals.zig");

// Symbol representation
pub const Symbol = @import("Symbol.zig");
pub const DeclaredSymbol = @import("DeclaredSymbol.zig");

// Operator system
pub const Op = @import("Op.zig");

// Primitive types
pub const PrimitiveType = @import("PrimitiveType.zig").PrimitiveType;

// TypeScript extensions
pub const TSNamespaceScope = @import("TSNamespaceScope.zig");
pub const TSNamespaceMemberMap = TSNamespaceMember.Map;
pub const TSNamespaceMember = @import("TSNamespaceMember.zig");

// Utility structs
pub const LocRef = @import("LocRef.zig");
pub const ArrayBinding = @import("ArrayBinding.zig");
pub const Case = @import("Case.zig");
pub const ClauseItem = @import("ClauseItem.zig");
pub const SlotCounts = @import("SlotCounts.zig");
pub const CharFreq = @import("CharFreq.zig");
pub const NameMinifier = @import("NameMinifier.zig");
pub const CharAndCount = @import("CharAndCount.zig");

// Enums
pub const ImportItemStatus = @import("ImportItemStatus.zig").ImportItemStatus;
pub const AssignTarget = @import("AssignTarget.zig").AssignTarget;
pub const ExportsKind = @import("ExportsKind.zig").ExportsKind;
pub const StrictModeKind = @import("StrictModeKind.zig").StrictModeKind;
pub const OptionalChain = @import("OptionalChain.zig").OptionalChain;

// AST components
pub const EnumValue = @import("EnumValue.zig");
pub const InlinedEnumValue = @import("InlinedEnumValue.zig");
pub const Catch = @import("Catch.zig");
pub const Finally = @import("Finally.zig");
pub const StmtOrExpr = @import("StmtOrExpr.zig").StmtOrExpr;
pub const NamedImport = @import("NamedImport.zig");
pub const NamedExport = @import("NamedExport.zig");
pub const BundledAst = @import("BundledAst.zig");
pub const Part = @import("Part.zig");
pub const TlaCheck = @import("TlaCheck.zig");
pub const Ast = @import("Ast.zig");

// This index is used for the automatically-generated part containing code that
// calls "__export(exports, { ... getters ... })". This is used to generate
// getters on an exports object for ES6 export statements, and is both for
// ES6 star imports and CommonJS-style modules. All files have one of these,
// although it may contain no statements if there is nothing to export.
pub const namespace_export_part_index = 0;

// Re-export essential types from ast/base.zig until they are moved
pub const ast_base = @import("../ast/base.zig");
pub const Ref = ast_base.Ref;
pub const Index = ast_base.Index;

pub const Macro = @import("Macro.zig");

// Re-export allocator for AST

pub const ASTMemoryAllocator = @import("ASTMemoryAllocator.zig");

// Flag sets
pub const Flags = @import("flags.zig");

extern fn JSC__jsToNumber(latin1_ptr: [*]const u8, len: usize) f64;

pub const writeAnyToHasher = bun.writeAnyToHasher;
pub fn stringToEquivalentNumberValue(str: []const u8) f64 {
    // +"" -> 0
    if (str.len == 0) return 0;
    if (!bun.strings.isAllASCII(str))
        return std.math.nan(f64);
    return JSC__jsToNumber(str.ptr, str.len);
}

pub const UseDirective = @import("UseDirective.zig").UseDirective;
pub const ServerComponentBoundary = @import("ServerComponentBoundary.zig");
pub const Scope = @import("Scope.zig");
pub const Dependency = @import("Dependency.zig");
pub const Span = @import("Span.zig");
pub const Result = @import("Result.zig").Result;
pub const ToJSError = error{
    @"Cannot convert argument type to JS",
    @"Cannot convert identifier to JS. Try a statically-known value",
    MacroError,
    OutOfMemory,
};
