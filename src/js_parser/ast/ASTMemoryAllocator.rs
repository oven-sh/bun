use core::ptr;

use bun_alloc::Arena;

use crate::ast::expr;
use crate::ast::stmt;

// PERF(port): Zig used `std.heap.StackFallbackAllocator(@min(8192, std.heap.page_size_min))`
// — a small inline stack buffer with heap fallback. `bun_alloc::Arena` (bumpalo::Bump)
// heap-allocates its first chunk instead; profile in Phase B.

// TODO(port): `Expr.Data.Store.memory_allocator` / `Stmt.Data.Store.memory_allocator` are
// `threadlocal var ?*ASTMemoryAllocator` in Zig, read/written directly. Phase B must expose
// `memory_allocator() -> *mut ASTMemoryAllocator`, `set_memory_allocator(*mut ASTMemoryAllocator)`,
// and `begin()` on the Rust `expr::data::Store` / `stmt::data::Store` (thread_local! + Cell).

pub struct ASTMemoryAllocator {
    // Zig fields `stack_allocator: SFA` + `bump_allocator: std.mem.Allocator` (the vtable into
    // the SFA) collapse to a single bump arena. The `allocator: std.mem.Allocator` fallback
    // field is dropped — bumpalo uses the global allocator implicitly.
    // TODO(port): if any caller passed a non-default allocator into `enter` /
    // `init_without_stack`, that routing is lost here; revisit in Phase B.
    arena: Arena,
    previous: *mut ASTMemoryAllocator,
}

impl ASTMemoryAllocator {
    pub fn enter(&mut self) -> Scope<'_> {
        // Zig: this.allocator = allocator;
        //      this.stack_allocator = SFA{ .buffer = undefined, .fallback_allocator = allocator, .fixed_buffer_allocator = undefined };
        //      this.bump_allocator = this.stack_allocator.get();
        self.arena = Arena::new();
        // PERF(port): was stack-fallback — profile in Phase B
        self.previous = ptr::null_mut();
        let mut ast_scope = Scope {
            current: Some(self),
            previous: Some(stmt::data::Store::memory_allocator()),
        };
        ast_scope.enter();
        ast_scope
    }

    pub fn reset(&mut self) {
        // Zig rebuilt the SFA against the stored fallback allocator; Arena::reset is equivalent.
        // PERF(port): was stack-fallback — profile in Phase B
        self.arena.reset();
    }

    pub fn push(&mut self) {
        stmt::data::Store::set_memory_allocator(self as *mut Self);
        expr::data::Store::set_memory_allocator(self as *mut Self);
    }

    pub fn pop(&mut self) {
        let prev = self.previous;
        debug_assert!(prev != self as *mut Self);
        stmt::data::Store::set_memory_allocator(prev);
        expr::data::Store::set_memory_allocator(prev);
        self.previous = ptr::null_mut();
    }

    pub fn append<T>(&self, value: T) -> &mut T {
        // Zig: `this.bump_allocator.create(ValueType) catch unreachable; ptr.* = value;`
        // bumpalo's `alloc` aborts on OOM, matching `catch unreachable`.
        self.arena.alloc(value)
    }

    /// Initialize ASTMemoryAllocator as `undefined`, and call this.
    pub fn init_without_stack(&mut self) {
        // Zig set up the SFA with an empty fixed buffer so every alloc goes to the fallback
        // `arena`. With bumpalo there is no stack buffer either way; just (re)initialize.
        // PERF(port): was stack-fallback — profile in Phase B
        self.arena = Arena::new();
    }
}

pub struct Scope<'a> {
    current: Option<&'a mut ASTMemoryAllocator>,
    previous: Option<*mut ASTMemoryAllocator>,
}

impl<'a> Default for Scope<'a> {
    fn default() -> Self {
        Self { current: None, previous: None }
    }
}

impl<'a> Scope<'a> {
    pub fn enter(&mut self) {
        debug_assert!(expr::data::Store::memory_allocator() == stmt::data::Store::memory_allocator());

        self.previous = Some(expr::data::Store::memory_allocator());

        let current: *mut ASTMemoryAllocator = match &mut self.current {
            Some(r) => *r as *mut ASTMemoryAllocator,
            None => ptr::null_mut(),
        };

        expr::data::Store::set_memory_allocator(current);
        stmt::data::Store::set_memory_allocator(current);

        if current.is_null() {
            stmt::data::Store::begin();
            expr::data::Store::begin();
        }
    }

    pub fn exit(&self) {
        let prev = self.previous.unwrap_or(ptr::null_mut());
        expr::data::Store::set_memory_allocator(prev);
        stmt::data::Store::set_memory_allocator(prev);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/ASTMemoryAllocator.zig (94 lines)
//   confidence: medium
//   todos:      2
//   notes:      SFA+vtable+fallback fields collapsed to one bun_alloc::Arena; Store threadlocal accessors (memory_allocator/set/begin) assumed — Phase B must define them on expr::data::Store / stmt::data::Store.
// ──────────────────────────────────────────────────────────────────────────
