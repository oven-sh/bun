use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, StateKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;

pub struct Stmt {
    pub base: Base,
    pub node: bun_ptr::BackRef<ast::Stmt>,
    pub idx: usize,
    pub last_exit_code: Option<ExitCode>,
    pub currently_executing: Option<NodeId>,
    pub io: IO,
}

impl Stmt {
    pub fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Stmt,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        let id = interp.alloc_node(Node::Stmt(Stmt {
            base: Base::new(StateKind::Stmt, parent, shell),
            // SAFETY: `node` is non-null and points into the AST arena
            // (`ShellArgs::__arena`), which the interpreter holds for its
            // entire lifetime — strictly outliving every state node (the
            // BackRef invariant). Callers pass `&raw const` only to escape
            // borrowck across the `&Interpreter` reborrow.
            node: unsafe { bun_ptr::BackRef::from_raw(node as *mut ast::Stmt) },
            idx: 0,
            last_exit_code: None,
            currently_executing: None,
            io,
        }));
        log!("Stmt {} init", id);
        id
    }

    pub fn start(interp: &Interpreter, this: NodeId) -> Yield {
        let me = interp.as_stmt(this);
        debug_assert!(me.idx == 0);
        debug_assert!(me.last_exit_code.is_none());
        debug_assert!(me.currently_executing.is_none());
        Yield::Next(this)
    }

    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
        let (idx, len, parent, last, shell) = {
            let me = interp.as_stmt(this);
            (
                me.idx,
                Self::expr_count(me),
                me.base.parent,
                me.last_exit_code,
                me.base.shell,
            )
        };
        if idx >= len {
            return interp.child_done(parent, this, last.unwrap_or(0));
        }
        let expr: ast::Expr = interp.as_stmt(this).node.exprs[idx];
        let io = interp.as_stmt(this).io.clone();
        let (child, y) = interp.spawn_expr(shell, &expr, this, io);
        interp.as_stmt_mut(this).currently_executing = child;
        y
    }

    pub fn child_done(
        interp: &Interpreter,
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
        // Zig: `defer child.deinit();` — child is not used below.
        // Async children are *not* freed here (they outlive their parent's
        // notion of "done"); see `Async`'s empty `deinit`.
        if !matches!(interp.node(child).kind(), StateKind::Async) {
            interp.deinit_node(child);
        }
        Yield::Next(this)
    }

    pub fn deinit(interp: &Interpreter, this: NodeId) {
        let exec = interp.as_stmt_mut(this).currently_executing.take();
        if let Some(exec) = exec {
            interp.deinit_node(exec);
        }
        interp.as_stmt_mut(this).base.end_scope();
    }

    #[inline]
    fn expr_count(me: &Stmt) -> usize {
        me.node.exprs.len()
    }
}

// ported from: src/shell/states/Stmt.zig
