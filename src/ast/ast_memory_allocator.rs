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
        // Bulk-free the `AstAlloc` state's heap and park the box in the
        // thread-local spare slot. If the state is still installed (push
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
    }
}

impl ASTMemoryAllocator {
    /// Construct a fresh arena.
    ///
    /// Zig callers wrote `var a: ASTMemoryAllocator = undefined;` then
    /// `a.enter(arena)` (passing the fallback `std.mem.Allocator`). In the
    /// Rust port the SFA + fallback collapse to a single internal `Arena`, so
    /// the passed arena is currently unused — kept for call-site shape compat.
    // TODO(port): if the parser bump arena is ever routed through here instead
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
        // `enter()` once, and drop it).
        if self.arena_dirty {
            self.arena.reset();
            self.reset_ast_state();
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
            self.arena.reset();
            self.reset_ast_state();
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
            // Mirror the arena's retain-or-recycle decision for the `AstAlloc`
            // state: when the arena heap is retained, the previous iteration's
            // `AstVec` buffers survive too (callers like `--define` hold
            // `StoreRef`s across this reset); when it is recycled, they are
            // bulk-freed alongside it.
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
        let arena: *const Arena = &raw const self.arena;
        stmt::data::Store::set_memory_allocator(std::ptr::from_mut::<Self>(self));
        expr::data::Store::set_memory_allocator(std::ptr::from_mut::<Self>(self));
        crate::set_data_store_override(arena);
        if !self.ast_pushed {
            let state = self
                .ast_state
                .take()
                .unwrap_or_else(ast_alloc::acquire_state);
            self.previous_ast_state = ast_alloc::swap_state(Some(state));
            self.ast_pushed = true;
        }
        // else: already installed (`push()` without an intervening `pop()`,
        // e.g. the package manager's `MiniStore` re-arms per workspace child).
        // The installed state and the saved previous occupant stay as they are.
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
        crate::StoreRef::from_bump(self.arena.alloc(value))
    }

    /// Zig: `this.stack_allocator.get()` — the `std.mem.Allocator` vtable into
    /// the stack-fallback buffer. In the Rust port both `stack_allocator` and
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
                let arena: *const Arena = &raw const r.arena;
                // Install this allocator's `AstAlloc` state for the scope.
                let state = r.ast_state.take().unwrap_or_else(ast_alloc::acquire_state);
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
