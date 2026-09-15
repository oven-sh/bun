//! Base header struct embedded in every state-machine node.
//!
//! The interpreter is passed as `&Interpreter` to every method, so only
//! `parent: NodeId` and the `*mut ShellExecEnv` (which may be owned or
//! borrowed — see field doc) are stored here.

use crate::shell::interpreter::{NodeId, ShellExecEnv};

pub struct Base {
    /// Index of the parent node in `Interpreter::nodes`, or
    /// `NodeId::INTERPRETER` if the parent is the interpreter itself.
    pub(crate) parent: NodeId,
    /// Borrowed or owned in specific cases — affects whether this node must
    /// `deinit` it. Owned when created via `dupe_for_subshell` (Script,
    /// pipeline children, subshells, command substitutions); otherwise
    /// borrows the parent's env.
    // Kept raw (not an Owned(Box)/Borrowed enum) because the env may outlive
    // this node's slot (shared across multiple children) and is freed by the
    // owning node, not by Drop on Base.
    pub shell: *mut ShellExecEnv,
    /// This node, or the part of it that decides its status, was killed by a
    /// Ctrl+C the interpreter left to it. See `Interpreter::propagate_interrupt`.
    pub(crate) interrupted: bool,
}

impl Base {
    pub(crate) fn new(parent: NodeId, shell: *mut ShellExecEnv) -> Self {
        Self {
            parent,
            shell,
            interrupted: false,
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
    pub(crate) fn shell_mut(&mut self) -> &mut ShellExecEnv {
        // SAFETY: see `shell()`. Mutation is single-threaded (interpreter
        // runs on one thread) and the trampoline only holds one `&mut` at a
        // time.
        unsafe { &mut *self.shell }
    }
}
