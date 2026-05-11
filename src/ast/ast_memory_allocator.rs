use core::ptr;

use bun_alloc::Arena;

use crate::expr;
use crate::stmt;

// PERF(port): Zig used `std.heap.StackFallbackAllocator(@min(8192, std.heap.page_size_min))`
// — a small inline stack buffer with heap fallback. `bun_alloc::Arena` (bumpalo::Bump)
// heap-allocates its first chunk instead; profile.

// TODO(port): `Expr.Data.Store.memory_allocator` / `Stmt.Data.Store.memory_allocator` are
// `threadlocal var ?*ASTMemoryAllocator` in Zig, read/written directly. Phase B must expose
// `memory_allocator() -> *mut ASTMemoryAllocator`, `set_memory_allocator(*mut ASTMemoryAllocator)`,
// and `begin()` on the Rust `expr::data::Store` / `stmt::data::Store` (thread_local! + Cell).

pub struct ASTMemoryAllocator {
    // Zig fields `stack_arena: SFA` + `bump_std.mem.Allocator param` (the vtable into
    // the SFA) collapse to a single bump arena. The `arena: std.mem.Allocator` fallback
    // field is dropped — bumpalo uses the global arena implicitly.
    // TODO(port): if any caller passed a non-default arena into `enter` /
    // `init_without_stack`, that routing is lost here; revisit.
    arena: Arena,
    previous: *mut ASTMemoryAllocator,
    previous_logger: *const Arena,
    previous_heap: *mut bun_alloc::mimalloc::Heap,
}

impl Default for ASTMemoryAllocator {
    fn default() -> Self {
        Self {
            arena: Arena::new(),
            previous: ptr::null_mut(),
            previous_logger: ptr::null(),
            previous_heap: ptr::null_mut(),
        }
    }
}

impl ASTMemoryAllocator {
    /// Construct a fresh arena.
    ///
    /// Zig callers wrote `var a: ASTMemoryAllocator = undefined;` then
    /// `a.enter(arena)` (passing the fallback `std.mem.Allocator`). In the
    /// Rust port the SFA + fallback collapse to a single internal `Arena`, so
    /// the passed arena is currently unused — kept for call-site shape compat.
    // TODO(port): if Phase B routes the parser bump arena through here instead
    // of allocating a fresh one, thread `_fallback` into `self.arena`.
    pub fn new(_fallback: &Arena) -> Self {
        // PERF(port): was stack-fallback — profile
        Self::default()
    }

    /// Zig: `var a: ASTMemoryAllocator = undefined; a.initWithoutStack(arena);`
    /// — collapsed to a constructor that returns a ready instance.
    pub fn new_without_stack(_fallback: &Arena) -> Self {
        Self::default()
    }

    pub fn enter(&mut self) -> Scope<'_> {
        // Zig: this.stack_allocator = SFA{ .fallback_allocator = arena, .. };
        //      this.bump_allocator = this.stack_allocator.get();
        // The Zig spec OVERWRITES the entire SFA on every `enter()` (fresh
        // 8 KB stack buffer + rewired fallback to the per-call arena), so any
        // bytes bump-allocated by the previous `enter()` are released. The
        // Rust port collapsed SFA+fallback into a single internal `Arena`
        // owned by `self`, so the equivalent re-init is `arena.reset()` —
        // otherwise a thread-local `ASTMemoryAllocator` reused across
        // `RuntimeTranspilerStore::run()` calls grows unboundedly (one full
        // AST worth of nodes per import).
        //
        // Retain (not destroy) up to 8 MiB: this runs once per async
        // `import()` on a transpiler-pool worker, and a fresh `mi_heap`'s
        // first alloc memsets a per-heap arena bitmap. `Scope::enter` →
        // `push()` re-publishes `heap_ptr()` to `AST_HEAP`, so when the limit
        // *is* crossed and a real `reset()` runs underneath, the new heap
        // pointer is wired through correctly.
        self.arena.reset_retain_with_limit(8 * 1024 * 1024);
        self.previous = ptr::null_mut();
        let mut ast_scope = Scope {
            current: Some(self),
            previous: Some(stmt::data::Store::memory_allocator()),
            previous_logger: ptr::null(),
            previous_heap: ptr::null_mut(),
        };
        ast_scope.enter();
        ast_scope
    }

    pub fn reset(&mut self) {
        // Zig rebuilt the SFA against the stored fallback arena; Arena::reset is equivalent.
        // PERF(port): was stack-fallback — profile
        self.arena.reset();
    }

    /// Per-iteration reset for hot reuse paths (`initialize_mini_store`'s
    /// per-workspace-child re-entry). Thin delegate to
    /// [`bun_alloc::Arena::reset_retain_with_limit`]; the cold init paths
    /// (`bundler::ThreadPool::Worker::init`, `BundleThread::generate_in_new_
    /// thread`) keep calling [`Self::reset`].
    pub fn reset_retain_with_limit(&mut self, limit: usize) {
        self.arena.reset_retain_with_limit(limit);
    }

    pub fn push(&mut self) {
        self.previous_logger = crate::data_store_override();
        self.previous_heap = bun_alloc::ast_alloc::thread_heap();
        let arena: *const Arena = &self.arena;
        stmt::data::Store::set_memory_allocator(std::ptr::from_mut::<Self>(self));
        expr::data::Store::set_memory_allocator(std::ptr::from_mut::<Self>(self));
        crate::set_data_store_override(arena);
        bun_alloc::ast_alloc::set_thread_heap(self.arena.heap_ptr());
    }

    pub fn pop(&mut self) {
        let prev = self.previous;
        debug_assert!(prev != std::ptr::from_mut::<Self>(self));
        stmt::data::Store::set_memory_allocator(prev);
        expr::data::Store::set_memory_allocator(prev);
        crate::set_data_store_override(self.previous_logger);
        bun_alloc::ast_alloc::set_thread_heap(self.previous_heap);
        self.previous = ptr::null_mut();
        self.previous_logger = ptr::null();
        self.previous_heap = ptr::null_mut();
    }

    #[inline]
    pub fn append<T>(&self, value: T) -> crate::StoreRef<T> {
        // Zig: `this.bump_allocator.create(ValueType) catch unreachable; ptr.* = value;`
        // bumpalo's `alloc` aborts on OOM, matching `catch unreachable`.
        // SAFETY: bumpalo never returns null.
        crate::StoreRef::from_bump(self.arena.alloc(value))
    }

    /// Zig: `this.stack_allocator.get()` — the `std.mem.Allocator` vtable into
    /// the stack-fallback buffer. In Phase A both `stack_allocator` and
    /// `bump_allocator` collapse to the single `Arena`, so this returns it.
    #[inline]
    pub fn stack_allocator(&self) -> &Arena {
        &self.arena
    }

    /// Alias for callers that addressed the Zig `bump_allocator` field.
    #[inline]
    pub fn bump_allocator(&self) -> &Arena {
        &self.arena
    }

    /// Initialize ASTMemoryAllocator as `undefined`, and call this.
    pub fn init_without_stack(&mut self) {
        // Zig set up the SFA with an empty fixed buffer so every alloc goes to the fallback
        // `arena`. With bumpalo there is no stack buffer either way; just (re)initialize.
        // PERF(port): was stack-fallback — profile
        self.arena = Arena::new();
    }
}

pub struct Scope<'a> {
    current: Option<&'a mut ASTMemoryAllocator>,
    previous: Option<*mut ASTMemoryAllocator>,
    previous_logger: *const Arena,
    previous_heap: *mut bun_alloc::mimalloc::Heap,
}

impl<'a> Default for Scope<'a> {
    fn default() -> Self {
        Self { current: None, previous: None, previous_logger: ptr::null(), previous_heap: ptr::null_mut() }
    }
}

impl<'a> Scope<'a> {
    pub fn enter(&mut self) {
        debug_assert!(expr::data::Store::memory_allocator() == stmt::data::Store::memory_allocator());

        self.previous = Some(expr::data::Store::memory_allocator());
        self.previous_logger = crate::data_store_override();
        self.previous_heap = bun_alloc::ast_alloc::thread_heap();

        let (current, arena, heap): (*mut ASTMemoryAllocator, *const Arena, *mut bun_alloc::mimalloc::Heap) =
            match &mut self.current {
                Some(r) => {
                    let arena: *const Arena = &r.arena;
                    (std::ptr::from_mut::<ASTMemoryAllocator>(*r), arena, r.arena.heap_ptr())
                }
                None => (ptr::null_mut(), ptr::null(), ptr::null_mut()),
            };

        expr::data::Store::set_memory_allocator(current);
        stmt::data::Store::set_memory_allocator(current);
        crate::set_data_store_override(arena);
        bun_alloc::ast_alloc::set_thread_heap(heap);

        if current.is_null() {
            stmt::data::Store::begin();
            expr::data::Store::begin();
        }
    }

    pub fn exit(&self) {
        let prev = self.previous.unwrap_or(ptr::null_mut());
        expr::data::Store::set_memory_allocator(prev);
        stmt::data::Store::set_memory_allocator(prev);
        crate::set_data_store_override(self.previous_logger);
        if !prev.is_null() {
            // Returning into an outer `ASTMemoryAllocator` scope: its arena's
            // `heap_ptr()` cannot have changed while it was suspended
            // (`Store::reset` early-returns while `MEMORY_ALLOCATOR` is set,
            // and the outer arena is only `reset()` by its own `enter()`), so
            // the snapshot is valid.
            bun_alloc::ast_alloc::set_thread_heap(self.previous_heap);
        } else {
            // Returning into the raw `Stmt.Data.Store` block-store (no
            // `ASTMemoryAllocator` was active before this scope). The
            // `store_ast_alloc_heap` side arena owns `AST_HEAP` there. We
            // cannot trust `self.previous_heap`: if `enter()` ran
            // `Store::begin()` → `store_ast_alloc_heap::reset()`, that
            // `mi_heap_destroy`+rebuild left the snapshot dangling. And we
            // cannot leave `AST_HEAP` as-is: when `current` was `Some`, it
            // still points at *this* scope's arena, which the caller is about
            // to drop. Re-read the side arena's live heap (or null if none
            // exists yet — i.e. no block-store on this thread).
            bun_alloc::ast_alloc::set_thread_heap(
                crate::store_ast_alloc_heap::current_heap(),
            );
        }
    }
}

// Zig callers write `defer ast_scope.exit()` immediately after `enter()`;
// porting that as RAII so `let _scope = alloc.enter();` restores the previous
// `Expr/Stmt.Data.Store.memory_allocator` on every return path. `exit()` is
// idempotent (just rewrites the thread-locals to `previous`), so an explicit
// `.exit()` followed by Drop is harmless.
impl<'a> Drop for Scope<'a> {
    fn drop(&mut self) {
        self.exit();
    }
}

// ported from: src/js_parser/ast/ASTMemoryAllocator.zig
