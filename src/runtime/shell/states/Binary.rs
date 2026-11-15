use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnvId, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;

pub(crate) struct Binary<'a> {
    pub(crate) base: Base,
    shell: ShellExecEnvId,
    pub node: &'a ast::Binary<'a>,
    pub(crate) io: IO,
    /// Once `left` is done, this holds its exit code; `None` while running left.
    pub(crate) left: Option<ExitCode>,
    pub(crate) right: Option<ExitCode>,
    pub(crate) currently_executing: Option<NodeId>,
}

impl<'a> Binary<'a> {
    pub(crate) fn init(
        interp: &mut Interpreter<'a>,
        shell: ShellExecEnvId,
        node: &'a ast::Binary<'a>,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Binary(Binary {
            base: Base::new(parent),
            shell,
            node,
            io,
            left: None,
            right: None,
            currently_executing: None,
        }))
    }

    pub(crate) fn start(_interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        log!("Binary {} start", this);
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        let (left_exit, right_exit, parent, shell, n) = {
            let me = interp.as_binary(this);
            (me.left, me.right, me.base.parent, me.shell, me.node)
        };

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
            let io = interp.as_binary(this).io;
            let (child, y) = interp.spawn_expr(shell, n.right, this, io);
            interp.as_binary_mut(this).currently_executing = child;
            return y;
        }

        let io = interp.as_binary(this).io;
        let (child, y) = interp.spawn_expr(shell, n.left, this, io);
        interp.as_binary_mut(this).currently_executing = child;
        y
    }

    pub(crate) fn child_done(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        interp.deinit_node(child);
        let stop = interp.interrupted(this);
        {
            let me = interp.as_binary_mut(this);
            me.currently_executing = None;
            if me.left.is_none() && !stop {
                me.left = Some(exit_code);
            } else {
                me.right = Some(exit_code);
            }
        }
        Yield::Next(this)
    }

    pub(crate) fn deinit(interp: &mut Interpreter<'a>, this: NodeId) {
        let exec = interp.as_binary_mut(this).currently_executing.take();
        if let Some(exec) = exec {
            interp.deinit_node(exec);
        }
    }
}
