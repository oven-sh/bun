//! Base header struct embedded in every state-machine node.
//!
//! The interpreter is passed as `&Interpreter` to every method, so only
//! `parent: NodeId` and the `*mut ShellExecEnv` (which may be owned or
//! borrowed — see field doc) are stored here.

use crate::shell::interpreter::{ExitCode, NodeId, ShellExecEnv, StateKind};

pub struct Base {
    pub kind: StateKind,
    /// Index of the parent node in `Interpreter::nodes`, or
    /// `NodeId::INTERPRETER` if the parent is the interpreter itself.
    pub parent: NodeId,
    /// Borrowed or owned in specific cases — affects whether this node must
    /// `deinit` it. Owned when created via `dupe_for_subshell` (Script,
    /// pipeline children, subshells, command substitutions); otherwise
    /// borrows the parent's env.
    // Kept raw (not an Owned(Box)/Borrowed enum) because the env may outlive
    // this node's slot (shared across multiple children) and is freed by the
    // owning node, not by Drop on Base.
    pub shell: *mut ShellExecEnv,
}

impl Base {
    pub fn new(kind: StateKind, parent: NodeId, shell: *mut ShellExecEnv) -> Self {
        Self {
            kind,
            parent,
            shell,
        }
    }

    /// No-op kept for call-site parity.
    #[inline]
    pub fn end_scope(&mut self) {}

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

    /// `Some(status)` once `exit` ran in this node's execution context: stop
    /// walking children and unwind with it. See `ShellExecEnv::exit_requested`.
    #[inline]
    pub fn exit_requested(&self) -> Option<ExitCode> {
        self.shell().exit_requested
    }
}

/// `error{Sys}` — see `Interpreter::try_`.
#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum TryError {
    #[error("Sys")]
    Sys,
}
