use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnvId, StateKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;

pub(crate) struct Stmt<'a> {
    pub(crate) base: Base,
    shell: ShellExecEnvId,
    pub node: &'a ast::Stmt<'a>,
    pub(crate) idx: usize,
    pub(crate) last_exit_code: Option<ExitCode>,
    pub(crate) currently_executing: Option<NodeId>,
    pub(crate) io: IO,
}

impl<'a> Stmt<'a> {
    pub(crate) fn init(
        interp: &mut Interpreter<'a>,
        shell: ShellExecEnvId,
        node: &'a ast::Stmt<'a>,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        let id = interp.alloc_node(Node::Stmt(Stmt {
            base: Base::new(parent),
            shell,
            node,
            idx: 0,
            last_exit_code: None,
            currently_executing: None,
            io,
        }));
        log!("Stmt {} init", id);
        id
    }

    pub(crate) fn start(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        let me = interp.as_stmt(this);
        debug_assert!(me.idx == 0);
        debug_assert!(me.last_exit_code.is_none());
        debug_assert!(me.currently_executing.is_none());
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        let (idx, len, parent, last, shell) = {
            let me = interp.as_stmt(this);
            (
                me.idx,
                Self::expr_count(me),
                me.base.parent,
                me.last_exit_code,
                me.shell,
            )
        };
        if idx >= len {
            return interp.child_done(parent, this, last.unwrap_or(0));
        }
        let expr = interp.as_stmt(this).node.exprs[idx];
        let io = interp.as_stmt(this).io;
        let (child, y) = interp.spawn_expr(shell, expr, this, io);
        interp.as_stmt_mut(this).currently_executing = child;
        y
    }

    pub(crate) fn child_done(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        log!("Stmt {} childDone exit={}", this, exit_code);
        {
            let me = interp.as_stmt_mut(this);
            me.last_exit_code = Some(exit_code);
            me.idx += 1;
            me.currently_executing = None;
        }
        // Async children are *not* freed here (they outlive their parent's
        // notion of "done").
        if !matches!(interp.node(child).kind(), StateKind::Async) {
            interp.deinit_node(child);
        }
        if interp.interrupted(this) {
            let me = interp.as_stmt_mut(this);
            me.idx = Self::expr_count(me);
        }
        Yield::Next(this)
    }

    pub(crate) fn deinit(interp: &mut Interpreter<'a>, this: NodeId) {
        let exec = interp.as_stmt_mut(this).currently_executing.take();
        if let Some(exec) = exec {
            interp.deinit_node(exec);
        }
    }

    #[inline]
    fn expr_count(me: &Stmt<'a>) -> usize {
        me.node.exprs.len()
    }
}
