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

    pub fn start(_interp: &mut Interpreter, this: NodeId) -> Yield {
        log!("Binary {} start", this);
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        let (left_exit, right_exit, parent, shell, node) = {
            let me = interp.as_binary(this);
            (me.left, me.right, me.base.parent, me.base.shell, me.node)
        };
        // SAFETY: `node` points into the AST arena which outlives every state
        // node.
        let n = unsafe { &*node };

        if let Some(right) = right_exit {
            return interp.child_done(parent, this, right);
        }

        if let Some(left) = left_exit {
            // Short-circuit: `&&` stops on nonzero, `||` stops on zero.
            let short = match n.op {
                ast::BinaryOp::And => left != 0,
                ast::BinaryOp::Or => left == 0,
            };
            if short {
                return interp.child_done(parent, this, left);
            }
            let io = interp.as_binary(this).io.clone();
            let (child, y) = interp.spawn_expr(shell, &n.right, this, io);
            interp.as_binary_mut(this).currently_executing = child;
            return y;
        }

        let io = interp.as_binary(this).io.clone();
        let (child, y) = interp.spawn_expr(shell, &n.left, this, io);
        interp.as_binary_mut(this).currently_executing = child;
        y
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

// ported from: src/shell/states/Binary.zig
