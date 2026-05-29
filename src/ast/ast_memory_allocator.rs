use core::cell::Cell;
use core::ptr;

use bun_alloc::Arena;
use bun_alloc::ast_alloc::{self, AstAllocState};

use crate::expr;
use crate::stmt;

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
    // the SFA) collapse to a single bump arena.
    arena: Arena,
    /// When non-null, allocations route to this caller-owned arena instead of
    /// `self.arena` and `Drop`/`reset` never destroy or pool anything. Must
    /// outlive `self` ([`Self::borrowing`] contract).
    external_arena: *const Arena,
    arena_dirty: bool,
    /// The `AstAlloc` state for this allocator's scope. Owned here while no
    /// scope is active; in the `AST_ALLOC` thread-local while pushed
    /// (`ast_pushed` disambiguates).
    ast_state: Option<Box<AstAllocState>>,
    /// `true` while `ast_state` is installed in the `AST_ALLOC` thread-local.
    ast_pushed: bool,
    previous: *mut ASTMemoryAllocator,
    previous_logger: *const Arena,
    /// The `AST_ALLOC` occupant displaced by `push()`, restored by `pop()`.
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
        // Recycle the AstAlloc state (whose spill pointer targets the arena's
        // heap) before the arena can be reset/destroyed below.
        debug_assert!(
            !self.ast_pushed,
            "ASTMemoryAllocator dropped while its AstAllocState is still installed"
        );
        if let Some(state) = self.ast_state.take() {
            ast_alloc::release_state(state);
        }
        if !self.external_arena.is_null() {
            // Borrowed arena: the caller owns its lifecycle.
            return;
        }
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
    /// Callers whose `fallback` arena outlives the allocator should use
    /// [`Self::borrowing`] instead.
    pub fn new(_fallback: &Arena) -> Self {
        Self::default()
    }

    pub fn borrowing(arena: &Arena) -> Self {
        Self {
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
    /// state, wherever the state currently lives (owned here, or installed by
    /// a `push()` that has not been `pop()`ed).
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

    /// Take this allocator's `AstAlloc` state (if any) and recycle it. For
    /// owners that are arena-allocated and never run `Drop`. Call only once
    /// nothing reads `AstVec`s allocated under this allocator's scope.
    pub fn release_ast_state(&mut self) {
        debug_assert!(
            !self.ast_pushed,
            "release_ast_state while the AstAllocState is still installed"
        );
        if self.ast_pushed {
            // Still installed in the thread-local; releasing here would let the
            // next scope reuse storage the current scope still writes to.
            return;
        }
        if let Some(state) = self.ast_state.take() {
            ast_alloc::release_state(state);
        }
    }

    /// Take this allocator's `AstAlloc` state without recycling it. The caller
    /// keeps the box alive for as long as `AstVec`s allocated under this
    /// allocator's scope are read, then drops it.
    pub fn take_ast_state(&mut self) -> Option<Box<AstAllocState>> {
        debug_assert!(
            !self.ast_pushed,
            "take_ast_state while the AstAllocState is still installed"
        );
        if self.ast_pushed {
            return None;
        }
        self.ast_state.take()
    }

    /// Debug-only: is the installed `AST_ALLOC` state the one this allocator
    /// pushed? Only meaningful while `ast_pushed`.
    fn ast_state_is_active(&self) -> bool {
        !ast_alloc::active_state_id().is_null()
    }

    pub fn enter(&mut self) -> Scope<'_> {
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

    pub fn reset_retain_with_limit(&mut self, limit: usize) {
        if self.arena_dirty {
            debug_assert!(
                self.external_arena.is_null(),
                "reset_retain_with_limit on a borrowing ASTMemoryAllocator"
            );
            // The AstAlloc state follows the arena's retain-or-recycle
            // decision: callers like `--define` hold `StoreRef`s across a
            // retained reset, so only clear it when the heap is recycled.
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
        let arena: *const Arena = self.arena_raw();
        stmt::data::Store::set_memory_allocator(std::ptr::from_mut::<Self>(self));
        expr::data::Store::set_memory_allocator(std::ptr::from_mut::<Self>(self));
        let spill = self.arena().heap_ptr();
        if !self.ast_pushed {
            // Capture the outer override only on the first (un-popped) push so
            // a re-arming `push()` doesn't clobber the saved outer value.
            self.previous_logger = crate::data_store_override();
            crate::set_data_store_override(arena);
            let mut state = self
                .ast_state
                .take()
                .unwrap_or_else(ast_alloc::acquire_state);
            // `AstVec` spill allocations share this allocator's arena.
            state.set_spill_heap(spill);
            self.previous_ast_state = ast_alloc::swap_state(Some(state));
            self.ast_pushed = true;
        } else {
            // Re-arming push (no intervening `pop()`, e.g. `MiniStore`):
            // re-publish the override and re-point the spill at the (possibly
            // recycled) arena heap.
            crate::set_data_store_override(arena);
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
            // Take the state back; its contents stay alive until the owner
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
}

pub struct Scope<'a> {
    current: Option<&'a mut ASTMemoryAllocator>,
    previous: Option<*mut ASTMemoryAllocator>,
    previous_logger: *const Arena,
    /// The `AST_ALLOC` occupant displaced by `enter()`, restored by `exit()`.
    previous_ast_state: Option<Box<AstAllocState>>,
    /// `true` between `enter()` and the first `exit()`; makes `exit()`
    /// idempotent and a never-entered `Scope::default()` drop a no-op.
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
                debug_assert!(
                    !r.ast_pushed,
                    "ASTMemoryAllocator::enter while its AstAllocState is already installed (push without pop)"
                );
                let arena: *const Arena = r.arena_raw();
                // Install this allocator's `AstAlloc` state; spill shares its arena.
                let mut state = r.ast_state.take().unwrap_or_else(ast_alloc::acquire_state);
                state.set_spill_heap(r.arena().heap_ptr());
                self.previous_ast_state = ast_alloc::swap_state(Some(state));
                r.ast_pushed = true;
                (std::ptr::from_mut::<ASTMemoryAllocator>(*r), arena)
            }
            None => {
                // Block-store scope with no `ASTMemoryAllocator`: detach
                // `AstAlloc` to the global-mimalloc fallback.
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
        if !self.entered {
            return;
        }
        self.entered = false;
        let prev = self.previous.unwrap_or(ptr::null_mut());
        expr::data::Store::set_memory_allocator(prev);
        stmt::data::Store::set_memory_allocator(prev);
        crate::set_data_store_override(self.previous_logger);
        // Restore the `AST_ALLOC` occupant displaced by `enter()`.
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
                // `Scope::default()` installed nothing, so nothing should come back out.
                debug_assert!(installed.is_none());
            }
        }
    }
}

impl<'a> Drop for Scope<'a> {
    fn drop(&mut self) {
        self.exit();
    }
}

// ported from: src/js_parser/ast/ASTMemoryAllocator.zig
