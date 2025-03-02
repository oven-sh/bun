//! Memory allocator for AST nodes
//! Provides a wrapper for std.mem.Allocator with push/pop capabilities

/// Memory allocator for JavaScript AST nodes
/// Adds stack-like push/pop semantics for tracking allocator state
const SFA = std.heap.StackFallbackAllocator(@min(8192, bun.page_size));

stack_allocator: SFA = undefined,
bump_allocator: std.mem.Allocator = undefined,
allocator: std.mem.Allocator,
previous: ?*ASTMemoryAllocator = null,

/// Reset the allocator to its initial state
pub fn reset(this: *ASTMemoryAllocator) void {
    this.stack_allocator = SFA{
        .buffer = undefined,
        .fallback_allocator = this.allocator,
        .fixed_buffer_allocator = undefined,
    };
    this.bump_allocator = this.stack_allocator.get();
}

/// Push the current allocator state onto the stack
pub fn push(this: *ASTMemoryAllocator) void {
    Stmt.Data.Store.memory_allocator = this;
    Expr.Data.Store.memory_allocator = this;
}

/// Pop and restore a previously pushed allocator state
pub fn pop(this: *ASTMemoryAllocator) void {
    const prev = this.previous;
    bun.assert(prev != this);
    Stmt.Data.Store.memory_allocator = prev;
    Expr.Data.Store.memory_allocator = prev;
    this.previous = null;
}

/// Append a value to the allocator
pub fn append(this: ASTMemoryAllocator, comptime ValueType: type, value: anytype) *ValueType {
    const ptr = this.bump_allocator.create(ValueType) catch unreachable;
    ptr.* = value;
    return ptr;
}

const ASTMemoryAllocator = @This();
const std = @import("std");
const bun = @import("root").bun;
const Expr = js_ast.Expr;
const Stmt = js_ast.Stmt;
const js_ast = @import("js_ast.zig");
