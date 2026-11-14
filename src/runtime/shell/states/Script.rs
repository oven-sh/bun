//! State node for a shell script. Used for the top-level script as well as
//! command-substitution and subshell bodies.

use bun_ptr::AliasableBox;

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::stmt::Stmt;
use crate::shell::yield_::Yield;

pub(crate) struct Script {
    pub(crate) base: Base,
    /// What `base.shell` points to, in a command substitution.
    _env: Option<AliasableBox<ShellExecEnv>>,
    /// Back-reference into the bumpalo-allocated AST (`ShellArgs::__arena`).
    /// The arena outlives every state node (it's dropped only when the
    /// interpreter is finalized), so the BackRef invariant holds. Stored
    /// lifetime-erased to keep `Node` lifetime-free.
    pub node: bun_ptr::BackRef<ast::Script>,
    pub(crate) io: IO,
    pub(crate) state: ScriptState,
}

pub(crate) enum ScriptState {
    Normal { idx: usize },
}

impl Default for ScriptState {
    fn default() -> Self {
        ScriptState::Normal { idx: 0 }
    }
}

impl Script {
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::Script,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        Self::alloc(interp, Base::new(parent, shell), None, node, io)
    }

    pub(crate) fn init_cmd_subst(
        interp: &Interpreter,
        env: AliasableBox<ShellExecEnv>,
        node: &ast::Script,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        let base = Base::new(parent, env.as_ptr());
        Self::alloc(interp, base, Some(env), node, io)
    }

    fn alloc(
        interp: &Interpreter,
        base: Base,
        env: Option<AliasableBox<ShellExecEnv>>,
        node: &ast::Script,
        io: IO,
    ) -> NodeId {
        let parent = base.parent;
        let id = interp.alloc_node(Node::Script(Script {
            base,
            _env: env,
            node: bun_ptr::BackRef::new(node),
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
        let (idx, shell) = {
            let me = interp.as_script_mut(this);
            let len = Self::stmt_count_of(me);
            let ScriptState::Normal { idx } = &mut me.state;
            if *idx >= len {
                return Yield::suspended();
            }
            let i = *idx;
            *idx += 1;
            (i, me.base.shell)
        };
        let stmt_node = Self::stmt_at(interp, this, idx);
        let io = interp.as_script(this).io.clone();
        let stmt = Stmt::init(interp, shell, stmt_node, this, io);
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
            (idx, Self::stmt_count_of(me))
        };
        if idx >= len || interp.interrupted(this) {
            return Self::finish(interp, this, exit_code);
        }
        Self::next(interp, this)
    }

    pub(crate) fn deinit(_interp: &Interpreter, this: NodeId) {
        log!("Script {} deinit", this);
    }

    // ── AST helpers ────────────────────────────────────────────────────────

    #[inline]
    fn stmt_count(interp: &Interpreter, this: NodeId) -> usize {
        Self::stmt_count_of(interp.as_script(this))
    }

    #[inline]
    fn stmt_count_of(me: &Script) -> usize {
        me.node.stmts.len()
    }

    #[inline]
    fn stmt_at(interp: &Interpreter, this: NodeId, idx: usize) -> &ast::Stmt {
        let me = interp.as_script(this);
        &me.node.stmts[idx]
    }
}
