use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{EnvRc, Interpreter, Node, NodeId, StateKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;
use std::rc::Rc;

pub struct Stmt {
    pub(crate) base: Base,
    pub node: bun_ptr::BackRef<ast::Stmt>,
    pub(crate) idx: usize,
    pub(crate) last_exit_code: Option<ExitCode>,
    pub(crate) currently_executing: Option<NodeId>,
    pub(crate) io: IO,
}

impl Stmt {
    pub(crate) fn init(
        interp: &Interpreter,
        shell: EnvRc,
        node: bun_ptr::BackRef<ast::Stmt>,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        let id = interp.alloc_node(Node::Stmt(Stmt {
            base: Base::new(parent, shell),
            node,
            idx: 0,
            last_exit_code: None,
            currently_executing: None,
            io,
        }));
        log!("Stmt {} init", id);
        id
    }

    pub(crate) fn start(interp: &Interpreter, this: NodeId) -> Yield {
        let me = interp.as_stmt(this);
        debug_assert!(me.idx == 0);
        debug_assert!(me.last_exit_code.is_none());
        debug_assert!(me.currently_executing.is_none());
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        let (idx, len, parent, last, shell, node, io) = {
            let me = interp.as_stmt(this);
            (
                me.idx,
                Self::expr_count(&me),
                me.base.parent,
                me.last_exit_code,
                Rc::clone(&me.base.shell),
                me.node,
                me.io.clone(),
            )
        };
        if idx >= len {
            return interp.child_done(parent, this, last.unwrap_or(0));
        }
        let expr = &node.get().exprs[idx];
        let (child, y) = interp.spawn_expr(&shell, expr, this, io);
        interp.as_stmt_mut(this).currently_executing = child;
        y
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        log!("Stmt {} childDone exit={}", this, exit_code);
        {
            let mut me = interp.as_stmt_mut(this);
            me.last_exit_code = Some(exit_code);
            me.idx += 1;
            me.currently_executing = None;
        }
        // Async children are *not* freed here (they outlive their parent's
        // notion of "done"); see `Async`'s empty `deinit`.
        if !matches!(interp.kind(child), StateKind::Async) {
            interp.deinit_node(child);
        }
        if interp.interrupted(this) {
            let mut me = interp.as_stmt_mut(this);
            me.idx = Self::expr_count(&me);
        }
        Yield::Next(this)
    }

    pub(crate) fn deinit(interp: &Interpreter, this: NodeId) {
        let exec = interp.as_stmt_mut(this).currently_executing.take();
        if let Some(exec) = exec {
            interp.deinit_node(exec);
        }
    }

    #[inline]
    fn expr_count(me: &Stmt) -> usize {
        me.node.exprs.len()
    }
}
