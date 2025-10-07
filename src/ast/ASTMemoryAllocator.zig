const SFA = std.heap.StackFallbackAllocator(@min(8192, std.heap.page_size_min));

stack_allocator: SFA = undefined,
bump_allocator: std.mem.Allocator = undefined,
allocator: std.mem.Allocator,
previous: ?*ASTMemoryAllocator = null,

pub fn enter(this: *ASTMemoryAllocator, allocator: std.mem.Allocator) ASTMemoryAllocator.Scope {
    this.allocator = allocator;
    this.stack_allocator = SFA{
        .buffer = undefined,
        .fallback_allocator = allocator,
        .fixed_buffer_allocator = undefined,
    };
    this.bump_allocator = this.stack_allocator.get();
    this.previous = null;
    var ast_scope = ASTMemoryAllocator.Scope{
        .current = this,
        .previous = Stmt.Data.Store.memory_allocator,
    };
    ast_scope.enter();
    return ast_scope;
}
pub const Scope = struct {
    current: ?*ASTMemoryAllocator = null,
    previous: ?*ASTMemoryAllocator = null,

    pub fn enter(this: *@This()) void {
        bun.debugAssert(Expr.Data.Store.memory_allocator == Stmt.Data.Store.memory_allocator);

        this.previous = Expr.Data.Store.memory_allocator;

        const current = this.current;

        Expr.Data.Store.memory_allocator = current;
        Stmt.Data.Store.memory_allocator = current;

        if (current == null) {
            Stmt.Data.Store.begin();
            Expr.Data.Store.begin();
        }
    }

    pub fn exit(this: *const @This()) void {
        Expr.Data.Store.memory_allocator = this.previous;
        Stmt.Data.Store.memory_allocator = this.previous;
    }
};

pub fn reset(this: *ASTMemoryAllocator) void {
    this.stack_allocator = SFA{
        .buffer = undefined,
        .fallback_allocator = this.allocator,
        .fixed_buffer_allocator = undefined,
    };
    this.bump_allocator = this.stack_allocator.get();
}

pub fn push(this: *ASTMemoryAllocator) void {
    Stmt.Data.Store.memory_allocator = this;
    Expr.Data.Store.memory_allocator = this;
}

pub fn pop(this: *ASTMemoryAllocator) void {
    const prev = this.previous;
    bun.assert(prev != this);
    Stmt.Data.Store.memory_allocator = prev;
    Expr.Data.Store.memory_allocator = prev;
    this.previous = null;
}

pub fn append(this: ASTMemoryAllocator, comptime ValueType: type, value: anytype) *ValueType {
    const ptr = this.bump_allocator.create(ValueType) catch unreachable;
    ptr.* = value;
    return ptr;
}

/// Initialize ASTMemoryAllocator as `undefined`, and call this.
pub fn initWithoutStack(this: *ASTMemoryAllocator, arena: std.mem.Allocator) void {
    this.stack_allocator = SFA{
        .buffer = undefined,
        .fallback_allocator = arena,
        .fixed_buffer_allocator = .init(&.{}),
    };
    this.bump_allocator = this.stack_allocator.get();
}

const bun = @import("bun");
const std = @import("std");

const js_ast = bun.ast;
const ASTMemoryAllocator = js_ast.ASTMemoryAllocator;
const Expr = js_ast.Expr;
const Stmt = js_ast.Stmt;
