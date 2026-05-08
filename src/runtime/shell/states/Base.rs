//! Base header struct embedded in every state-machine node.
//!
//! In Zig this carried `interpreter: *Interpreter` and `shell: *ShellExecEnv`
//! back-pointers. In the NodeId-arena port the interpreter is passed as
//! `&mut Interpreter` to every method, so only `parent: NodeId` and the
//! `*mut ShellExecEnv` (which may be owned or borrowed — see field doc) are
//! stored here.

#[cfg(debug_assertions)]
use crate::shell::alloc_scope::AllocScope;
use crate::shell::interpreter::{NodeId, ShellExecEnv, StateKind};

pub struct Base {
    pub kind: StateKind,
    /// Index of the parent node in `Interpreter::nodes`, or
    /// `NodeId::INTERPRETER` if the parent is the interpreter itself.
    /// Replaces Zig's `parent: ParentPtr` tagged-pointer back-ref.
    pub parent: NodeId,
    /// Borrowed or owned in specific cases — affects whether this node must
    /// `deinit` it. Owned when created via `dupe_for_subshell` (Script,
    /// pipeline children, subshells, command substitutions); otherwise
    /// borrows the parent's env.
    // TODO(port): lifetime — enum Owned(Box)/Borrowed once ShellExecEnv body
    // is un-gated. Kept raw because the env may outlive this node's slot
    // (shared across multiple children) and is freed by the owning node, not
    // by Drop on Base.
    pub shell: *mut ShellExecEnv,
    #[cfg(debug_assertions)]
    __alloc_scope: Option<AllocScope>,
}

impl Base {
    /// Create a new allocation scope for this state node.
    pub fn new(kind: StateKind, parent: NodeId, shell: *mut ShellExecEnv) -> Self {
        Self {
            kind,
            parent,
            shell,
            // TODO(b2-blocked): bun_alloc::default_allocator() — AllocScope
            // tracking is debug-only; pass a no-op until the alloc-scope API
            // stabilises.
            #[cfg(debug_assertions)]
            __alloc_scope: None,
        }
    }

    /// Borrow the parent's allocation scope instead of creating a new one.
    /// (In release builds the scope is a no-op either way.)
    pub fn new_borrowed_scope(kind: StateKind, parent: NodeId, shell: *mut ShellExecEnv) -> Self {
        Self {
            kind,
            parent,
            shell,
            #[cfg(debug_assertions)]
            __alloc_scope: None,
        }
    }

    pub fn end_scope(&mut self) {
        #[cfg(debug_assertions)]
        {
            self.__alloc_scope.take();
        }
    }

    /// Stop tracking `memory` (it has been handed off to e.g. an `EnvStr`).
    pub fn leak_slice<T>(&mut self, memory: &[T]) {
        #[cfg(debug_assertions)]
        if let Some(scope) = self.__alloc_scope.as_mut() {
            scope.leak_slice(memory);
        }
        #[cfg(not(debug_assertions))]
        {
            let _ = memory;
        }
    }

    #[inline]
    pub fn shell(&self) -> &ShellExecEnv {
        // SAFETY: `shell` is set in `new()` from a live env owned either by
        // the interpreter (root) or by an ancestor node that outlives this
        // node's slot (deinit order is child→parent).
        unsafe { &*self.shell }
    }

    #[inline]
    pub fn shell_mut(&mut self) -> &mut ShellExecEnv {
        // SAFETY: see `shell()`. Mutation is single-threaded (interpreter
        // runs on one thread) and the trampoline only holds one `&mut` at a
        // time.
        unsafe { &mut *self.shell }
    }
}

/// `error{Sys}` — see `Interpreter::try_`.
#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum TryError {
    #[error("Sys")]
    Sys,
}

// ported from: src/shell/states/Base.zig
