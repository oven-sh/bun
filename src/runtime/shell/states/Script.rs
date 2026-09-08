//! State node for a shell script. Used for the top-level script as well as
//! command-substitution and subshell bodies.

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{EnvRc, Interpreter, Node, NodeId, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::stmt::Stmt;
use crate::shell::yield_::Yield;
use std::rc::Rc;

pub struct Script {
    pub(crate) base: Base,
    /// Back-reference into the parsed-script arena (`ShellArgs`). The arena
    /// outlives every state node (it's reset/dropped only after they are all
    /// freed), so the BackRef invariant holds.
    pub node: bun_ptr::BackRef<ast::Script>,
    pub(crate) io: IO,
    pub(crate) state: ScriptState,
}

pub enum ScriptState {
    Normal { idx: usize },
}

impl Default for ScriptState {
    fn default() -> Self {
        ScriptState::Normal { idx: 0 }
    }
}

impl Script {
    /// `shell` is this script's env: the caller's own for the root script and
    /// subshell bodies, a fresh dupe for command substitution (dropped with
    /// the node).
    pub(crate) fn init(
        interp: &Interpreter,
        shell: EnvRc,
        node: bun_ptr::BackRef<ast::Script>,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        let id = interp.alloc_node(Node::Script(Script {
            base: Base::new(parent, shell),
            node,
            io,
            state: ScriptState::default(),
        }));
        log!("Script {} init (parent={})", id, parent);
        id
    }

    pub(crate) fn start(interp: &Interpreter, this: NodeId) -> Yield {
        if Self::stmt_count(interp, this) == 0 {
            return Self::finish(interp, this, 0);
        }
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        let (idx, shell, node) = {
            let mut me = interp.as_script_mut(this);
            let len = Self::stmt_count_of(&me);
            let ScriptState::Normal { idx } = &mut me.state;
            if *idx >= len {
                return Yield::suspended();
            }
            let i = *idx;
            *idx += 1;
            (i, Rc::clone(&me.base.shell), me.node)
        };
        let stmt_node = bun_ptr::BackRef::new(&node.get().stmts[idx]);
        let stmt = Stmt::init(interp, shell, stmt_node, this);
        Stmt::start(interp, stmt)
    }

    fn finish(interp: &Interpreter, this: NodeId, exit_code: ExitCode) -> Yield {
        let parent = interp.as_script(this).base.parent;
        interp.child_done(parent, this, exit_code)
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        interp.deinit_node(child);
        let (idx, len) = {
            let me = interp.as_script(this);
            let ScriptState::Normal { idx } = me.state;
            (idx, Self::stmt_count_of(&me))
        };
        if idx >= len || interp.interrupted(this) {
            return Self::finish(interp, this, exit_code);
        }
        Self::next(interp, this)
    }

    pub(crate) fn deinit(_interp: &Interpreter, this: NodeId) {
        log!("Script {} deinit", this);
        // `io` and the env handle drop with the slot
        // (`Interpreter::free_node`); a command-substitution env this Script
        // owned is freed there.
    }

    // ── AST helpers ────────────────────────────────────────────────────────

    #[inline]
    fn stmt_count(interp: &Interpreter, this: NodeId) -> usize {
        Self::stmt_count_of(&interp.as_script(this))
    }

    #[inline]
    fn stmt_count_of(me: &Script) -> usize {
        me.node.stmts.len()
    }
}
