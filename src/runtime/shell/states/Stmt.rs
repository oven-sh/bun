use crate::shell::ast;
use crate::shell::interpreter::{log, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct Stmt {
    pub base: Base,
    pub node: *const ast::Stmt,
    pub idx: usize,
    pub last_exit_code: Option<ExitCode>,
    pub currently_executing: Option<NodeId>,
    pub io: IO,
}

impl Stmt {
    pub fn init(
        interp: &mut Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Stmt,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        let id = interp.alloc_node(Node::Stmt(Stmt {
            base: Base::new(StateKind::Stmt, parent, shell),
            node,
            idx: 0,
            last_exit_code: None,
            currently_executing: None,
            io,
        }));
        log!("Stmt {} init", id);
        id
    }

    pub fn start(interp: &mut Interpreter, this: NodeId) -> Yield {
        let me = interp.as_stmt(this);
        debug_assert!(me.idx == 0);
        debug_assert!(me.last_exit_code.is_none());
        debug_assert!(me.currently_executing.is_none());
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        let (idx, len, parent, last) = {
            let me = interp.as_stmt(this);
            (me.idx, Self::expr_count(me), me.base.parent, me.last_exit_code)
        };
        if idx >= len {
            return interp.child_done(parent, this, last.unwrap_or(0));
        }
        // TODO(b2-blocked): ast::Stmt::exprs — match on the expr kind and
        // dispatch to Binary/Pipeline/Cmd/Assigns/If/CondExpr/Subshell/Async.
        // The full body (~120 lines) is preserved gated below; until the AST
        // type is real, we cannot match on it.
        #[cfg(any())]
        {
            include!("Stmt_next_body.rs");
        }
        let _ = idx;
        Yield::suspended()
    }

    pub fn child_done(
        interp: &mut Interpreter,
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

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        let exec = interp.as_stmt_mut(this).currently_executing.take();
        if let Some(exec) = exec {
            interp.deinit_node(exec);
        }
        interp.as_stmt_mut(this).base.end_scope();
    }

    #[inline]
    fn expr_count(_me: &Stmt) -> usize {
        // TODO(b2-blocked): ast::Stmt::exprs.len()
        0
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Stmt.zig (171 lines)
//   confidence: medium (NodeId conversion done; expr-dispatch body gated on ast)
//   blocked_on: ast::Stmt::exprs / ast::Expr enum
// ──────────────────────────────────────────────────────────────────────────
