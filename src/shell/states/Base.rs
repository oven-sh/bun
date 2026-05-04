//! This is the base header struct that all state nodes include in their layout.
//!
//! TODO: Is this still needed?

use core::marker::PhantomData;

use bun_alloc::{Allocator, AllocationScope};
use bun_jsc::EventLoopHandle;
use bun_sys;

use bun_shell::interpret::{throw_shell_err, StateKind};
use bun_shell::interpreter::{Interpreter, ShellExecEnv, IO};
use bun_shell::ShellErr;

// TODO(port): `bun.Environment.enableAllocScopes` — mapped to `debug_assertions` here;
// Phase B should wire this to the actual cargo feature/cfg that gates AllocationScope.
macro_rules! enable_alloc_scopes {
    () => {
        cfg!(debug_assertions)
    };
}

pub struct Base<'a> {
    pub kind: StateKind,
    // BACKREF: Interpreter owns the state tree and passes itself in.
    pub interpreter: *const Interpreter,
    /// This type is borrowed or owned in specific cases. This affects whether or
    /// not this state node should be responsible for deinitializing this
    /// `*ShellExecEnv`.
    ///
    /// Q: When is this the `shell: *ShellExecEnv` field owned?
    /// A: When we must create a new shell execution environment. This is
    ///    essentially all locations where `shell.dupeForSubshell(...)` is called:
    ///
    ///    1. A `Script` owns it's shell execution environment
    ///    2. Each command in a pipeline is executed in it's own shell execution
    ///       environment.
    ///    3. Subshells
    ///    4. Command substitutions
    ///
    /// When `shell: *ShellExecEnv` is owned it must be deinitialized. That is why you
    /// only see `this.base.shell.deinit()` in `Script`, `Subshell`, and the
    /// children of a `Pipeline`.
    pub shell: *mut ShellExecEnv, // TODO(port): lifetime — enum Owned(Box)/Borrowed(&'a) per LIFETIMES.tsv
    #[cfg(debug_assertions)]
    __alloc_scope: AllocScope<'a>,
    #[cfg(not(debug_assertions))]
    __alloc_scope: (),
    _p: PhantomData<&'a ()>,
}

enum AllocScope<'a> {
    Owned(AllocationScope),
    Borrowed(&'a mut AllocationScope),
}

impl<'a> AllocScope<'a> {
    // NOTE: Zig `deinit` only frees the `.owned` arm. In Rust, dropping the enum
    // drops `Owned(AllocationScope)` automatically and `Borrowed` is a `&mut` (no-op).
    // Kept as an explicit method because `Base::end_scope` triggers it mid-lifetime,
    // not at scope exit.
    // TODO(port): consider modeling `end_scope` as taking the scope by value instead.
    fn deinit(&mut self) {
        if enable_alloc_scopes!() {
            if let AllocScope::Owned(scope) = self {
                // TODO(port): AllocationScope teardown — relies on Drop in Rust;
                // explicit call kept for parity with Zig's `this.owned.deinit()`.
                core::mem::drop(core::mem::replace(
                    scope,
                    // SAFETY: placeholder; Phase B should restructure so we don't
                    // need a dummy value here (e.g. Option<AllocScope>).
                    unsafe { core::mem::zeroed() },
                ));
            }
        }
    }

    fn allocator(&mut self) -> &dyn Allocator {
        match self {
            AllocScope::Borrowed(scope) => scope.allocator(),
            AllocScope::Owned(scope) => scope.allocator(),
        }
    }

    fn scoped_allocator(&mut self) -> &mut AllocationScope {
        match self {
            AllocScope::Borrowed(scope) => scope,
            AllocScope::Owned(scope) => scope,
        }
    }

    fn leak_slice<T>(&mut self, memory: &[T]) {
        if enable_alloc_scopes!() {
            // Zig: `_ = @typeInfo(@TypeOf(memory)).pointer;` — compile-time assert
            // that `memory` is a pointer/slice. Encoded here via the `&[T]` param type.
            if let Err(err) = self.scoped_allocator().track_external_free(memory, None) {
                panic!("invalid free: {}", err);
            }
        }
    }
}

impl<'a> Base<'a> {
    /// Creates a _new_ allocation scope for this state node.
    pub fn init_with_new_alloc_scope(
        kind: StateKind,
        interpreter: *const Interpreter,
        shell: *mut ShellExecEnv,
    ) -> Self {
        Self {
            kind,
            interpreter,
            shell,
            #[cfg(debug_assertions)]
            __alloc_scope: AllocScope::Owned(AllocationScope::init()),
            #[cfg(not(debug_assertions))]
            __alloc_scope: (),
            _p: PhantomData,
        }
    }

    /// This will use the allocation scope provided by `scope`
    #[cfg(debug_assertions)]
    pub fn init_borrowed_alloc_scope(
        kind: StateKind,
        interpreter: *const Interpreter,
        shell: *mut ShellExecEnv,
        scope: &'a mut AllocationScope,
    ) -> Self {
        Self {
            kind,
            interpreter,
            shell,
            __alloc_scope: AllocScope::Borrowed(scope),
            _p: PhantomData,
        }
    }

    #[cfg(not(debug_assertions))]
    pub fn init_borrowed_alloc_scope(
        kind: StateKind,
        interpreter: *const Interpreter,
        shell: *mut ShellExecEnv,
        _scope: (),
    ) -> Self {
        Self {
            kind,
            interpreter,
            shell,
            __alloc_scope: (),
            _p: PhantomData,
        }
    }

    /// This ends the allocation scope associated with this state node.
    ///
    /// If the allocation scope is borrowed from the parent, this does nothing.
    ///
    /// This also does nothing in release builds.
    pub fn end_scope(&mut self) {
        #[cfg(debug_assertions)]
        {
            self.__alloc_scope.deinit();
        }
    }

    #[inline]
    pub fn event_loop(&self) -> EventLoopHandle {
        // SAFETY: `interpreter` is a backref to the owning Interpreter, which
        // outlives every state node it creates.
        unsafe { (*self.interpreter).event_loop }
    }

    /// FIXME: We should get rid of this
    pub fn throw(&self, err: &ShellErr) {
        let _ = throw_shell_err(err, self.event_loop()); // TODO:
    }

    /// Unwrap a `Maybe(T)` into `error{Sys}!T`, stashing the rich error on the interpreter.
    /// See `ThisInterpreter.try_` — this is sugar for `this.interpreter.try_(m)`.
    #[inline]
    pub fn try_<T>(&mut self, m: bun_sys::Result<T>) -> Result<T, TryError> {
        // SAFETY: backref; see `event_loop`. Cast to mut because `try_` stashes
        // the error on the interpreter.
        // TODO(port): LIFETIMES.tsv classifies `interpreter` as `*const`, but
        // `try_`/`take_err` require &mut — Phase B should reconcile (likely *mut).
        unsafe { (*(self.interpreter as *mut Interpreter)).try_(m) }
    }

    #[inline]
    pub fn take_err(&mut self) -> bun_sys::Error {
        // SAFETY: see `try_`.
        unsafe { (*(self.interpreter as *mut Interpreter)).take_err() }
    }

    pub fn root_io(&self) -> &IO {
        // SAFETY: backref; see `event_loop`.
        unsafe { (*self.interpreter).root_io() }
    }

    pub fn allocator(&mut self) -> &dyn Allocator {
        #[cfg(debug_assertions)]
        {
            return self.__alloc_scope.allocator();
        }
        #[cfg(not(debug_assertions))]
        {
            // Zig: `bun.default_allocator` — global mimalloc.
            // TODO(port): callers should drop the allocator param entirely outside
            // alloc-scope builds; kept for structural parity.
            bun_alloc::default_allocator()
        }
    }

    #[cfg(debug_assertions)]
    pub fn alloc_scope(&mut self) -> &mut AllocationScope {
        match &mut self.__alloc_scope {
            AllocScope::Borrowed(scope) => scope,
            AllocScope::Owned(scope) => scope,
        }
    }

    #[cfg(not(debug_assertions))]
    pub fn alloc_scope(&mut self) {}

    /// Stop tracking `memory`
    pub fn leak_slice<T>(&mut self, memory: &[T]) {
        #[cfg(debug_assertions)]
        {
            self.__alloc_scope.leak_slice(memory);
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = memory;
        }
    }
}

/// `error{Sys}` — see `Interpreter::try_`.
#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum TryError {
    #[error("Sys")]
    Sys,
}
// TODO(port): impl From<TryError> for bun_core::Error

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Base.zig (150 lines)
//   confidence: medium
//   todos:      6
//   notes:      enableAllocScopes mapped to cfg(debug_assertions); interpreter backref *const but try_/take_err need mut; shell ownership left raw per TSV UNKNOWN
// ──────────────────────────────────────────────────────────────────────────
