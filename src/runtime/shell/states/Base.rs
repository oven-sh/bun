//! Base header struct embedded in every state-machine node.
//!
//! The interpreter is passed as `&Interpreter` to every method, so only
//! `parent: NodeId` and the shell env handle are stored here.

use bun_ptr::{JsCellRef, JsCellRefMut};

use crate::shell::interpreter::{EnvRc, NodeId, ShellExecEnv};

pub struct Base {
    /// Index of the parent node in `Interpreter::nodes`, or
    /// `NodeId::INTERPRETER` if the parent is the interpreter itself.
    pub(crate) parent: NodeId,
    /// This node's env: a fresh dupe (Script for command substitution,
    /// pipeline children, subshells) or a share of the parent's. See
    /// [`EnvRc`].
    pub shell: EnvRc,
    /// This node, or the part of it that decides its status, was killed by a
    /// Ctrl+C the interpreter left to it. See `Interpreter::propagate_interrupt`.
    pub(crate) interrupted: bool,
}

impl Base {
    pub(crate) fn new(parent: NodeId, shell: EnvRc) -> Self {
        Self {
            parent,
            shell,
            interrupted: false,
        }
    }

    #[inline]
    #[track_caller]
    pub fn shell(&self) -> JsCellRef<'_, ShellExecEnv> {
        self.shell.borrow()
    }

    #[inline]
    #[track_caller]
    pub(crate) fn shell_mut(&self) -> JsCellRefMut<'_, ShellExecEnv> {
        self.shell.borrow_mut()
    }
}
