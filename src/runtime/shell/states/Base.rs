//! Base header struct embedded in every state-machine node.

use core::ops::{Deref, DerefMut};

use bun_ptr::AliasableBox;

use crate::shell::interpreter::{NodeId, ShellExecEnv};

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

/// Owned by the interpreter or by an ancestor of the node that holds this.
pub(crate) struct InheritedEnv(pub(crate) *mut ShellExecEnv);

impl Deref for InheritedEnv {
    type Target = ShellExecEnv;
    fn deref(&self) -> &ShellExecEnv {
        // SAFETY: a node is freed before its ancestors.
        unsafe { &*self.0 }
    }
}

impl DerefMut for InheritedEnv {
    fn deref_mut(&mut self) -> &mut ShellExecEnv {
        // SAFETY: as in `deref`, and the trampoline runs one node at a time.
        unsafe { &mut *self.0 }
    }
}

pub(crate) enum Env {
    /// Of a command substitution or of a member of a pipeline.
    Owned(AliasableBox<ShellExecEnv>),
    Inherited(InheritedEnv),
}

impl Env {
    pub(crate) fn inherited(env: *mut ShellExecEnv) -> Self {
        Env::Inherited(InheritedEnv(env))
    }

    pub(crate) fn as_ptr(&self) -> *mut ShellExecEnv {
        match self {
            Env::Owned(env) => env.as_ptr(),
            Env::Inherited(env) => env.0,
        }
    }
}

impl Deref for Env {
    type Target = ShellExecEnv;
    fn deref(&self) -> &ShellExecEnv {
        match self {
            Env::Owned(env) => env,
            Env::Inherited(env) => env,
        }
    }
}

impl DerefMut for Env {
    fn deref_mut(&mut self) -> &mut ShellExecEnv {
        match self {
            // SAFETY: the trampoline runs one node at a time.
            Env::Owned(env) => unsafe { &mut *env.as_ptr() },
            Env::Inherited(env) => env,
        }
    }
}
