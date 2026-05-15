use core::cell::Cell;
use core::ptr;

use bun_alloc::Arena;

use crate::expr;
use crate::stmt;

// PERF(port): Zig used `std.heap.StackFallbackAllocator(@min(8192, std.heap.page_size_min))`
// — a small inline stack buffer with heap fallback. `bun_alloc::Arena`
// (`MimallocArena`) has no stack buffer; instead the owned arena is recycled
// per thread via `ARENA_POOL` below so the per-module callers don't pay a fresh
// `mi_heap_new` + first-segment page faults every file. (A real inline
// stack-fallback would still avoid the heap entirely for small modules — left
// for a follow-up.)

// TODO(port): `Expr.Data.Store.memory_allocator` / `Stmt.Data.Store.memory_allocator` are
// `threadlocal var ?*ASTMemoryAllocator` in Zig, read/written directly. Phase B must expose
// `memory_allocator() -> *mut ASTMemoryAllocator`, `set_memory_allocator(*mut ASTMemoryAllocator)`,
// and `begin()` on the Rust `expr::data::Store` / `stmt::data::Store` (thread_local! + Cell).

// ── Thread-local arena pool ──────────────────────────────────────────────
//
// Zig's `ASTMemoryAllocator` was a `StackFallbackAllocator(8192, fallback)`:
// the 8 KB stack buffer absorbed most per-module AST scratch without touching
// the heap, and the spill went to a long-lived `fallback` arena whose pages
// stayed resident across modules. The Rust port collapsed that to one owned
// `MimallocArena` per `ASTMemoryAllocator`, so a fresh per-module instance
// (`RuntimeTranspilerStore::run`, `Bun.Transpiler.*`, the dev server) paid a
// fresh `mi_heap_new` + first-segment page faults every file, and `enter()`'s
// reset then destroyed-and-recreated that just-created heap before it was even
// used.
//
// Instead, recycle one `MimallocArena` per thread: `Drop` cleans the arena
// (`reset()` bulk-frees this module's nodes — leaving it pristine) and parks
// it here; the next `ASTMemoryAllocator` on this thread reclaims it, reusing
// its committed pages. The pool holds at most one arena (nested scopes — rare
// — fall back to a fresh `Arena::new()`). `#[thread_local]` (not the
// `thread_local!` macro) so there is no destructor: a parked arena at thread
// exit is reclaimed by mimalloc's own thread-teardown, avoiding an unspecified
// destructor-ordering hazard with `mi_heap_destroy`.
#[thread_local]
static ARENA_POOL: Cell<Option<Arena>> = Cell::new(None);

#[inline]
fn take_pooled_arena() -> Arena {
    ARENA_POOL.take().unwrap_or_else(Arena::new)
}

/// Park a *clean* (reset) arena for reuse by the next `ASTMemoryAllocator` on
/// this thread. If the slot is already occupied (nested scopes), the surplus
/// arena is dropped here (`mi_heap_destroy`).
#[inline]
fn return_pooled_arena(arena: Arena) {
    drop(ARENA_POOL.replace(Some(arena)));
}

pub struct ASTMemoryAllocator {
    // Zig fields `stack_arena: SFA` + `bump_std.mem.Allocator param` (the vtable into
    // the SFA) collapse to a single bump arena. The `arena: std.mem.Allocator` fallback
    // field is dropped — bumpalo uses the global arena implicitly.
    // TODO(port): if any caller passed a non-default arena into `enter` /
    // `init_without_stack`, that routing is lost here; revisit.
    arena: Arena,
    /// `true` once a scope on this instance armed `arena` for allocation (via
    /// [`Self::enter`] / [`Self::push`]) since the last reset. Lets
    /// [`Self::enter`] / [`Self::reset`] skip the `mi_heap_destroy` +
    /// `mi_heap_new` churn when `arena` is already pristine — the common case
    /// for the per-module callers, each of which takes a freshly-pooled (clean)
    /// arena and arms it exactly once.
    arena_dirty: bool,
    previous: *mut ASTMemoryAllocator,
    previous_logger: *const Arena,
    previous_heap: *mut bun_alloc::mimalloc::Heap,
}

impl Default for ASTMemoryAllocator {
    fn default() -> Self {
        Self {
            arena: take_pooled_arena(),
            arena_dirty: false,
            previous: ptr::null_mut(),
            previous_logger: ptr::null(),
            previous_heap: ptr::null_mut(),
        }
    }
}

impl Drop for ASTMemoryAllocator {
    fn drop(&mut self) {
        // Recycle the arena for the next `ASTMemoryAllocator` on this thread
        // (see `ARENA_POOL`). Clean it first so a pooled arena is always
        // pristine — `push()` callers (the bundler workers) allocate straight
        // into it with no intervening `reset()`. By the time this runs nothing
        // aliases `self.arena`: `enter()`'s returned `Scope` borrows `&mut
        // self`, so it drops first and `Scope::exit()` has already restored the
        // `Expr/Stmt.Data.Store.memory_allocator` / `data_store_override` /
        // `ast_alloc` thread-locals; `push()` callers pair with `pop()` before
        // teardown.
        if self.arena_dirty {
            self.arena.reset();
        }
        // Move the (now-clean) owned arena out; leave a no-op `borrowing_default`
        // arena behind so the field's own `Drop` does nothing.
        let arena = core::mem::replace(&mut self.arena, Arena::borrowing_default());
        return_pooled_arena(arena);
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
        // This is the `AST_HEAP` for `AstAlloc` data (`named_exports` etc.)
        // — bulk-free-only. `9ae903e` made this `reset_retain_with_limit(8M)`
        // but `AstAlloc` bypasses `track_alloc` (raw `mi_heap_malloc`), so
        // the limit never trips and every previous import's AST data leaks.
        // See `store_ast_alloc_heap::reset` for the full analysis.
        //
        // ...but a *pristine* arena (fresh from `new()` / the thread-local
        // pool, or just `reset()`) has nothing to discard, so the
        // `mi_heap_destroy` + `mi_heap_new` round-trip is skipped in that case
        // (the common one — per-module callers create a fresh instance,
        // `enter()` once, and drop it).
        if self.arena_dirty {
            self.arena.reset();
        }
        self.arena_dirty = true;
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
        // Skip the `mi_heap_destroy` + `mi_heap_new` when already pristine.
        if self.arena_dirty {
            self.arena.reset();
            self.arena_dirty = false;
        }
    }

    /// Per-iteration reset for hot reuse paths (`initialize_mini_store`'s
    /// per-workspace-child re-entry). Thin delegate to
    /// [`bun_alloc::Arena::reset_retain_with_limit`]; the cold init paths
    /// (`bundler::ThreadPool::Worker::init`, `BundleThread::generate_in_new_
    /// thread`) keep calling [`Self::reset`].
    pub fn reset_retain_with_limit(&mut self, limit: usize) {
        if self.arena_dirty {
            self.arena.reset_retain_with_limit(limit);
            self.arena_dirty = false;
        }
    }

    pub fn push(&mut self) {
        // `push()` arms `arena` for allocation (the bundler workers allocate
        // directly into it across many modules with no intervening `reset()`).
        self.arena_dirty = true;
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
        self.arena_dirty = false;
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
        Self {
            current: None,
            previous: None,
            previous_logger: ptr::null(),
            previous_heap: ptr::null_mut(),
        }
    }
}

impl<'a> Scope<'a> {
    pub fn enter(&mut self) {
        debug_assert!(
            expr::data::Store::memory_allocator() == stmt::data::Store::memory_allocator()
        );

        self.previous = Some(expr::data::Store::memory_allocator());
        self.previous_logger = crate::data_store_override();
        self.previous_heap = bun_alloc::ast_alloc::thread_heap();

        let (current, arena, heap): (
            *mut ASTMemoryAllocator,
            *const Arena,
            *mut bun_alloc::mimalloc::Heap,
        ) = match &mut self.current {
            Some(r) => {
                let arena: *const Arena = &r.arena;
                (
                    std::ptr::from_mut::<ASTMemoryAllocator>(*r),
                    arena,
                    r.arena.heap_ptr(),
                )
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
            bun_alloc::ast_alloc::set_thread_heap(crate::store_ast_alloc_heap::current_heap());
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
