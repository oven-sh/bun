//! State node for a shell script. Used for the top-level script as well as
//! command-substitution and subshell bodies.

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, log};
use crate::shell::io::IO;
use crate::shell::states::base::{Base, Env};
use crate::shell::states::stmt::Stmt;
use crate::shell::yield_::Yield;

pub(crate) struct Script<'a> {
    pub(crate) base: Base,
    pub(crate) shell: Env,
    pub node: ast::Script<'a>,
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

impl<'a> Script<'a> {
    pub(crate) fn init(
        interp: &mut Interpreter<'a>,
        shell: Env,
        node: ast::Script<'a>,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        let id = interp.alloc_node(Node::Script(Script {
            base: Base::new(parent),
            shell,
            node,
            io,
            state: ScriptState::default(),
        }));
        log!("Script {} init (parent={})", id, parent);
        id
    }

    pub(crate) fn start(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        if Self::stmt_count(interp, this) == 0 {
            return Self::finish(interp, this, 0);
        }
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        let (idx, shell) = {
            let me = interp.as_script_mut(this);
            let len = Self::stmt_count_of(me);
            let ScriptState::Normal { idx } = &mut me.state;
            if *idx >= len {
                return Yield::suspended();
            }
            let i = *idx;
            *idx += 1;
            (i, me.shell.id())
        };
        let stmt_node = Self::stmt_at(interp, this, idx);
        let io = interp.as_script(this).io;
        let stmt = Stmt::init(interp, shell, stmt_node, this, io);
        Stmt::start(interp, stmt)
    }

    fn finish(interp: &mut Interpreter<'a>, this: NodeId, exit_code: ExitCode) -> Yield {
        let parent = interp.as_script(this).base.parent;
        interp.child_done(parent, this, exit_code)
    }

    pub(crate) fn child_done(
        interp: &mut Interpreter<'a>,
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

    // ── AST helpers ────────────────────────────────────────────────────────

    #[inline]
    fn stmt_count(interp: &Interpreter<'a>, this: NodeId) -> usize {
        Self::stmt_count_of(interp.as_script(this))
    }

    #[inline]
    fn stmt_count_of(me: &Script<'a>) -> usize {
        me.node.stmts.len()
    }

    #[inline]
    fn stmt_at(interp: &Interpreter<'a>, this: NodeId, idx: usize) -> &'a ast::Stmt<'a> {
        let me = interp.as_script(this);
        &me.node.stmts[idx]
    }
}
