use crate::shell::ast;
use crate::shell::interpreter::{log, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct Binary {
    pub base: Base,
    pub node: *const ast::Binary,
    pub io: IO,
    /// Once `left` is done, this holds its exit code; `None` while running left.
    pub left: Option<ExitCode>,
    pub right: Option<ExitCode>,
    pub currently_executing: Option<NodeId>,
}

impl Binary {
    pub fn init(
        interp: &mut Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Binary,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Binary(Binary {
            base: Base::new(StateKind::Binary, parent, shell),
            node,
            io,
            left: None,
            right: None,
            currently_executing: None,
        }))
    }

    pub fn start(interp: &mut Interpreter, this: NodeId) -> Yield {
        log!("Binary {} start", this);
        // TODO(b2-blocked): ast::Binary::left — spawn the left expr.
        // Body gated until ast::Expr is real.
        let _ = interp;
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        // TODO(b2-blocked): ast::Binary::{op, left, right} — full body (~90
        // lines) preserved gated. Shape: if left is None spawn left; else if
        // op==And && left!=0 → done(left); else spawn right; else done(right).
        #[cfg(any())]
        {
            include!("Binary_next_body.rs");
        }
        let parent = interp.as_binary(this).base.parent;
        interp.child_done(parent, this, 0)
    }

    pub fn child_done(
        interp: &mut Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        interp.deinit_node(child);
        {
            let me = interp.as_binary_mut(this);
            me.currently_executing = None;
            if me.left.is_none() {
                me.left = Some(exit_code);
            } else {
                me.right = Some(exit_code);
            }
        }
        Yield::Next(this)
    }

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        let exec = interp.as_binary_mut(this).currently_executing.take();
        if let Some(exec) = exec {
            interp.deinit_node(exec);
        }
        interp.as_binary_mut(this).base.end_scope();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Binary.zig (179 lines)
//   confidence: medium (NodeId conversion; And/Or dispatch gated on ast)
//   blocked_on: ast::Binary::{op, left, right}
// ──────────────────────────────────────────────────────────────────────────
