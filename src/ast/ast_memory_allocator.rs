use core::cell::Cell;
use core::ptr;

use bun_alloc::Arena;
use bun_alloc::ast_alloc::{self, AstAllocState};

use crate::expr;
use crate::stmt;

// PERF(port): Zig used `std.heap.StackFallbackAllocator(@min(8192, std.heap.page_size_min))`
// — a small inline stack buffer with heap fallback. `bun_alloc::Arena`
// (`MimallocArena`) has no stack buffer; instead the owned arena is recycled
// per thread via `ARENA_POOL` below so the per-module callers don't pay a fresh
// `mi_heap_new` + first-segment page faults every file. (The `AstAlloc` side
// *does* have an inline buffer now — see `bun_alloc::ast_alloc::AstAllocState`.)

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
    ARENA_POOL.take().unwrap_or_default()
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
    // the SFA) collapse to a single bump arena. Zig's SFA *borrowed* the
    // caller's per-job arena as its fallback; the Rust port grew an owned
    // arena here, which doubled the `mi_heap_new`/`mi_heap_destroy` count per
    // transpile job. [`Self::borrowing`] restores the Zig shape for callers
    // whose arena strictly outlives this allocator; `external_arena` is null
    // for owned instances.
    arena: Arena,
    /// When non-null, the allocator routes every allocation to this
    /// caller-owned arena instead of `self.arena`, and `Drop`/`reset` never
    /// destroy or pool anything — the caller owns the arena's lifecycle. The
    /// pointee must outlive `self` (the [`Self::borrowing`] contract; same
    /// shape as `data_store_override`).
    external_arena: *const Arena,
    /// `true` once a scope on this instance armed `arena` for allocation (via
    /// [`Self::enter`] / [`Self::push`]) since the last reset. Lets
    /// [`Self::enter`] / [`Self::reset`] skip the `mi_heap_destroy` +
    /// `mi_heap_new` churn when `arena` is already pristine — the common case
    /// for the per-module callers, each of which takes a freshly-pooled (clean)
    /// arena and arms it exactly once.
    arena_dirty: bool,
    /// The `AstAlloc` allocation state for this allocator's scope (`AstVec`
    /// buffers: `named_exports`, `DeclList`, `PropertyList`, …). Owned here
    /// while no scope is active; moved into the `AST_ALLOC` thread-local by
    /// [`Self::push`] / `Scope::enter` and moved back by [`Self::pop`] /
    /// `Scope::exit`. Lazily acquired on the first push. `None` both before
    /// the first push and while pushed — `ast_pushed` disambiguates.
    ast_state: Option<Box<AstAllocState>>,
    /// `true` while `ast_state` is installed in the `AST_ALLOC` thread-local
    /// (i.e. the box is *not* in `ast_state`).
    ast_pushed: bool,
    previous: *mut ASTMemoryAllocator,
    previous_logger: *const Arena,
    /// The `AST_ALLOC` occupant displaced by [`Self::push`], restored by
    /// [`Self::pop`].
    previous_ast_state: Option<Box<AstAllocState>>,
}

impl Default for ASTMemoryAllocator {
    fn default() -> Self {
        Self {
            arena: take_pooled_arena(),
            external_arena: ptr::null(),
            arena_dirty: false,
            ast_state: None,
            ast_pushed: false,
            previous: ptr::null_mut(),
            previous_logger: ptr::null(),
            previous_ast_state: None,
        }
    }
}

impl Drop for ASTMemoryAllocator {
    fn drop(&mut self) {
        // Park the (cursor-reset) `AstAlloc` state box in the thread-local
        // spare slot *before* touching the arena: the state's spill pointer
        // targets `self.arena()`'s heap, so it must be cleared before that
        // heap can be destroyed below. If the state is still installed (push
        // without pop), leave it where it is: the thread-local owns the box,
        // so dropping nothing here turns a scope imbalance into a leak rather
        // than a use-after-free.
        debug_assert!(
            !self.ast_pushed,
            "ASTMemoryAllocator dropped while its AstAllocState is still installed"
        );
        if let Some(state) = self.ast_state.take() {
            ast_alloc::release_state(state);
        }
        if !self.external_arena.is_null() {
            // Borrowed arena: the caller owns its lifecycle; everything this
            // allocator put in it is reclaimed when the caller resets/drops it.
            return;
        }
        // Recycle the owned arena for the next `ASTMemoryAllocator` on this
        // thread (see `ARENA_POOL`). Clean it first so a pooled arena is always
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
    /// Construct with an **owned** arena (recycled via the per-thread pool).
    ///
    /// Zig callers wrote `var a: ASTMemoryAllocator = undefined;` then
    /// `a.enter(arena)` (passing the fallback `std.mem.Allocator`). Callers
    /// whose `fallback` arena strictly outlives the allocator should use
    /// [`Self::borrowing`] instead so the job pays for one `mi_heap_t`, not
    /// two. This constructor remains for callers that `reset()` the allocator
    /// independently of the passed arena (the bundler worker, `BundleThread`,
    /// the package manager's `MiniStore`).
    pub fn new(_fallback: &Arena) -> Self {
        Self::default()
    }

    /// Construct an allocator that routes every allocation into `arena`
    /// instead of owning a heap of its own. One transpile job then uses a
    /// single `mi_heap_t` for the parser scratch, the AST node store, and the
    /// `AstVec` spill.
    ///
    /// Contract: `arena` must strictly outlive the returned allocator (and
    /// every `Scope` derived from it), and the caller — not this allocator —
    /// is responsible for resetting/destroying it. Re-`enter()`ing a borrowing
    /// allocator does **not** free the previous scope's data.
    pub fn borrowing(arena: &Arena) -> Self {
        Self {
            // Never allocated from and never pooled; `borrowing_default()`'s
            // Drop is a no-op.
            arena: Arena::borrowing_default(),
            external_arena: ptr::from_ref(arena),
            arena_dirty: false,
            ast_state: None,
            ast_pushed: false,
            previous: ptr::null_mut(),
            previous_logger: ptr::null(),
            previous_ast_state: None,
        }
    }

    /// Zig: `var a: ASTMemoryAllocator = undefined; a.initWithoutStack(arena);`
    /// — collapsed to a constructor that returns a ready instance.
    pub fn new_without_stack(_fallback: &Arena) -> Self {
        Self::default()
    }

    /// The arena every allocation routes to: the caller-owned one for
    /// [`Self::borrowing`] instances, else the owned pooled one.
    #[inline]
    fn arena(&self) -> &Arena {
        if self.external_arena.is_null() {
            &self.arena
        } else {
            // SAFETY: `borrowing()`'s contract — the pointee strictly outlives
            // `self`.
            unsafe { &*self.external_arena }
        }
    }

    /// Raw pointer form of [`Self::arena`] for the `data_store_override`
    /// thread-local (which stores `*const Arena`).
    #[inline]
    fn arena_raw(&self) -> *const Arena {
        if self.external_arena.is_null() {
            &raw const self.arena
        } else {
            self.external_arena
        }
    }

    /// Bulk-free everything allocated through this allocator's `AstAlloc`
    /// state, wherever the state currently lives (owned here, or installed in
    /// the thread-local by a `push()` that has not been `pop()`ed — the
    /// package manager's `MiniStore` re-arms without popping).
    fn reset_ast_state(&mut self) {
        if let Some(state) = self.ast_state.as_deref_mut() {
            state.reset();
        } else if self.ast_pushed {
            debug_assert!(
                self.ast_state_is_active(),
                "ASTMemoryAllocator::reset while another AstAllocState is installed"
            );
            ast_alloc::reset_active_state();
        }
    }

    /// Take this allocator's `AstAlloc` state (if any) and recycle it into the
    /// per-thread spare slot. For owners that are arena-allocated and never
    /// run `Drop` (the dev server's bundle-setup allocator) — without this the
    /// 16 KB state box is stranded in the owner's bump chunk when the bundle
    /// heap is bulk-freed. The AST-node arena is unaffected; only the `AstVec`
    /// inline chunk is recycled, so call this only once nothing reads `AstVec`s
    /// allocated under this allocator's scope.
    pub fn release_ast_state(&mut self) {
        debug_assert!(
            !self.ast_pushed,
            "release_ast_state while the AstAllocState is still installed"
        );
        if let Some(state) = self.ast_state.take() {
            ast_alloc::release_state(state);
        }
    }

    /// Debug-only: is the installed `AST_ALLOC` state the one this allocator
    /// pushed? Only meaningful while `ast_pushed`.
    fn ast_state_is_active(&self) -> bool {
        // While pushed the box lives in the thread-local, so the only identity
        // we can compare against is "something is installed". A stronger check
        // would require keeping a raw alias to the box across the move.
        !ast_alloc::active_state_id().is_null()
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
        // ...but a *pristine* arena (fresh from `new()` / the thread-local
        // pool, or just `reset()`) has nothing to discard, so the
        // `mi_heap_destroy` + `mi_heap_new` round-trip is skipped in that case
        // (the common one — per-module callers create a fresh instance,
        // `enter()` once, and drop it). A borrowed arena is never reset here —
        // its owner decides when its contents die.
        if self.arena_dirty {
            self.reset_ast_state();
            if self.external_arena.is_null() {
                self.arena.reset();
            }
        }
        self.arena_dirty = true;
        self.previous = ptr::null_mut();
        let mut ast_scope = Scope {
            current: Some(self),
            previous: Some(stmt::data::Store::memory_allocator()),
            previous_logger: ptr::null(),
            previous_ast_state: None,
            entered: false,
        };
        ast_scope.enter();
        ast_scope
    }

    pub fn reset(&mut self) {
        // Zig rebuilt the SFA against the stored fallback arena; Arena::reset is equivalent.
        // PERF(port): was stack-fallback — profile
        // Skip the `mi_heap_destroy` + `mi_heap_new` when already pristine.
        if self.arena_dirty {
            // The AST state's spill pointer targets the arena's heap; null it
            // before that heap is destroyed.
            self.reset_ast_state();
            if self.external_arena.is_null() {
                self.arena.reset();
            }
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
            debug_assert!(
                self.external_arena.is_null(),
                "reset_retain_with_limit on a borrowing ASTMemoryAllocator"
            );
            // Mirror the arena's retain-or-recycle decision for the `AstAlloc`
            // state: when the arena heap is retained, the previous iteration's
            // `AstVec` buffers (spill blocks in that heap *and* the inline
            // chunk) survive too — callers like `--define` hold `StoreRef`s
            // across this reset. When it is recycled, the spill heap is gone:
            // null the state's pointer to it and rewind the chunk; the next
            // `push()` re-points the spill at the fresh heap.
            if !self.arena.reset_retain_with_limit(limit) {
                self.reset_ast_state();
            }
            self.arena_dirty = false;
        }
    }

    pub fn push(&mut self) {
        // `push()` arms `arena` for allocation (the bundler workers allocate
        // directly into it across many modules with no intervening `reset()`).
        self.arena_dirty = true;
        self.previous_logger = crate::data_store_override();
        let arena: *const Arena = self.arena_raw();
        stmt::data::Store::set_memory_allocator(std::ptr::from_mut::<Self>(self));
        expr::data::Store::set_memory_allocator(std::ptr::from_mut::<Self>(self));
        crate::set_data_store_override(arena);
        let spill = self.arena().heap_ptr();
        if !self.ast_pushed {
            let mut state = self
                .ast_state
                .take()
                .unwrap_or_else(ast_alloc::acquire_state);
            // `AstVec` spill allocations share this allocator's arena — one
            // `mi_heap_t` per scope, not two.
            state.set_spill_heap(spill);
            self.previous_ast_state = ast_alloc::swap_state(Some(state));
            self.ast_pushed = true;
        } else {
            // Already installed (`push()` without an intervening `pop()`, e.g.
            // the package manager's `MiniStore` re-arms per workspace child).
            // Re-point the installed state's spill at the (possibly just
            // recycled) arena heap; the saved previous occupant stays as is.
            ast_alloc::set_active_spill_heap(spill);
        }
    }

    pub fn pop(&mut self) {
        let prev = self.previous;
        debug_assert!(prev != std::ptr::from_mut::<Self>(self));
        stmt::data::Store::set_memory_allocator(prev);
        expr::data::Store::set_memory_allocator(prev);
        crate::set_data_store_override(self.previous_logger);
        if self.ast_pushed {
            // Take the state back from the thread-local and restore whatever
            // was installed before `push()`. The state's contents (the AST the
            // bundler worker just built) stay alive in the box until the owner
            // resets or drops this allocator.
            self.ast_state = ast_alloc::swap_state(self.previous_ast_state.take());
            self.ast_pushed = false;
            debug_assert!(
                self.ast_state.is_some(),
                "ASTMemoryAllocator::pop: the pushed AstAllocState was uninstalled by someone else"
            );
        }
        self.previous = ptr::null_mut();
        self.previous_logger = ptr::null();
    }

    #[inline]
    pub fn append<T>(&self, value: T) -> crate::StoreRef<T> {
        // Zig: `this.bump_allocator.create(ValueType) catch unreachable; ptr.* = value;`
        // bumpalo's `alloc` aborts on OOM, matching `catch unreachable`.
        // SAFETY: bumpalo never returns null.
        crate::StoreRef::from_bump(self.arena().alloc(value))
    }

    /// Zig: `this.stack_allocator.get()` — the `std.mem.Allocator` vtable into
    /// the stack-fallback buffer. In the Rust port both `stack_allocator` and
    /// `bump_allocator` collapse to the single `Arena`, so this returns it.
    #[inline]
    pub fn stack_allocator(&self) -> &Arena {
        self.arena()
    }

    /// Alias for callers that addressed the Zig `bump_allocator` field.
    #[inline]
    pub fn bump_allocator(&self) -> &Arena {
        self.arena()
    }

    /// Initialize ASTMemoryAllocator as `undefined`, and call this.
    pub fn init_without_stack(&mut self) {
        // Zig set up the SFA with an empty fixed buffer so every alloc goes to the fallback
        // `arena`. With bumpalo there is no stack buffer either way; just (re)initialize.
        // PERF(port): was stack-fallback — profile
        self.arena = Arena::new();
        self.external_arena = ptr::null();
        self.arena_dirty = false;
    }
}

pub struct Scope<'a> {
    current: Option<&'a mut ASTMemoryAllocator>,
    previous: Option<*mut ASTMemoryAllocator>,
    previous_logger: *const Arena,
    /// The `AST_ALLOC` occupant displaced by [`Self::enter`], restored by
    /// [`Self::exit`].
    previous_ast_state: Option<Box<AstAllocState>>,
    /// `true` between `enter()` and the first `exit()`. Makes `exit()`
    /// idempotent (Zig callers write `defer ast_scope.exit()` *and* the Rust
    /// port runs it again from `Drop`) and makes dropping a never-entered
    /// `Scope::default()` a no-op instead of clobbering the thread-locals.
    entered: bool,
}

impl<'a> Default for Scope<'a> {
    fn default() -> Self {
        Self {
            current: None,
            previous: None,
            previous_logger: ptr::null(),
            previous_ast_state: None,
            entered: false,
        }
    }
}

impl<'a> Scope<'a> {
    pub fn enter(&mut self) {
        debug_assert!(
            expr::data::Store::memory_allocator() == stmt::data::Store::memory_allocator()
        );
        debug_assert!(!self.entered);

        self.previous = Some(expr::data::Store::memory_allocator());
        self.previous_logger = crate::data_store_override();
        self.entered = true;

        let (current, arena): (*mut ASTMemoryAllocator, *const Arena) = match &mut self.current {
            Some(r) => {
                let arena: *const Arena = r.arena_raw();
                // Install this allocator's `AstAlloc` state for the scope.
                // `AstVec` spill allocations share the allocator's arena — one
                // `mi_heap_t` per scope, not two.
                let mut state = r.ast_state.take().unwrap_or_else(ast_alloc::acquire_state);
                state.set_spill_heap(r.arena().heap_ptr());
                self.previous_ast_state = ast_alloc::swap_state(Some(state));
                r.ast_pushed = true;
                (std::ptr::from_mut::<ASTMemoryAllocator>(*r), arena)
            }
            None => {
                // Block-store scope with no `ASTMemoryAllocator`: detach
                // `AstAlloc` to the global-mimalloc fallback. Callers that
                // want arena-lifetime `AstVec`s here install their own state
                // (`ScopedAstAlloc` in `transpile_source_code`).
                self.previous_ast_state = ast_alloc::swap_state(None);
                (ptr::null_mut(), ptr::null())
            }
        };

        expr::data::Store::set_memory_allocator(current);
        stmt::data::Store::set_memory_allocator(current);
        crate::set_data_store_override(arena);

        if current.is_null() {
            stmt::data::Store::begin();
            expr::data::Store::begin();
        }
    }

    pub fn exit(&mut self) {
        // Idempotent: Zig callers write `defer ast_scope.exit()` immediately
        // after `enter()`, and the Rust `Drop` impl calls this again.
        if !self.entered {
            return;
        }
        self.entered = false;
        let prev = self.previous.unwrap_or(ptr::null_mut());
        expr::data::Store::set_memory_allocator(prev);
        stmt::data::Store::set_memory_allocator(prev);
        crate::set_data_store_override(self.previous_logger);
        // Restore the `AST_ALLOC` occupant that was displaced by `enter()`.
        // Ownership of the displaced box travelled into `previous_ast_state`,
        // so this is exact regardless of how the outer scope's state was
        // reset in the meantime (the box address never changes).
        let installed = ast_alloc::swap_state(self.previous_ast_state.take());
        match self.current.as_deref_mut() {
            Some(r) => {
                debug_assert!(
                    installed.is_some(),
                    "ASTMemoryAllocator::Scope::exit: the installed AstAllocState was taken by someone else"
                );
                r.ast_state = installed;
                r.ast_pushed = false;
            }
            None => {
                // `Scope::default()` installed nothing, so nothing should come
                // back out. (A `ScopedAstAlloc` opened inside this scope must
                // have been dropped already — it is declared after the scope.)
                debug_assert!(installed.is_none());
            }
        }
    }
}

// Zig callers write `defer ast_scope.exit()` immediately after `enter()`;
// porting that as RAII so `let _scope = alloc.enter();` restores the previous
// `Expr/Stmt.Data.Store.memory_allocator` on every return path. `exit()` is
// idempotent (guarded by `entered`), so an explicit `.exit()` followed by Drop
// is harmless.
impl<'a> Drop for Scope<'a> {
    fn drop(&mut self) {
        self.exit();
    }
}

// ported from: src/js_parser/ast/ASTMemoryAllocator.zig
