//! Base header struct embedded in every state-machine node.

use crate::shell::interpreter::{NodeId, ShellExecEnvId};

pub(crate) struct Base {
    /// Index of the parent node in `Interpreter::nodes`, or
    /// `NodeId::INTERPRETER` if the parent is the interpreter itself.
    pub(crate) parent: NodeId,
    /// This node, or the part of it that decides its status, was killed by a
    /// Ctrl+C the interpreter left to it. See `Interpreter::propagate_interrupt`.
    pub(crate) interrupted: bool,
}

impl Base {
    pub(crate) fn new(parent: NodeId) -> Self {
        Self {
            parent,
            interrupted: false,
        }
    }
}

pub(crate) enum Env {
    /// Of a command substitution or of a member of a pipeline. `Interpreter::free_node` removes it.
    Owned(ShellExecEnvId),
    Inherited(ShellExecEnvId),
}

impl Env {
    pub(crate) fn id(&self) -> ShellExecEnvId {
        match *self {
            Env::Owned(id) | Env::Inherited(id) => id,
        }
    }
}
