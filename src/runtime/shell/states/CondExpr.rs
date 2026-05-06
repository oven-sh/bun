//! https://www.gnu.org/software/bash/manual/bash.html#Bash-Conditional-Expressions

use crate::shell::ast;
use crate::shell::interpreter::{log, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct CondExpr {
    pub base: Base,
    pub node: *const ast::CondExpr,
    pub io: IO,
    pub state: CondExprState,
    pub args: Vec<Vec<u8>>,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum CondExprState {
    #[default]
    Idle,
    ExpandingArgs { idx: u32 },
    WaitingStat,
    WaitingWriteErr,
    Done,
}

impl CondExpr {
    pub fn init(
        interp: &mut Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::CondExpr,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::CondExpr(CondExpr {
            base: Base::new(StateKind::Condexpr, parent, shell),
            node,
            io,
            state: CondExprState::Idle,
            args: Vec::new(),
        }))
    }

    pub fn start(_interp: &mut Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        // TODO(b2-blocked): ast::CondExpr::{op, args} + bun_sys stat/lstat —
        // full body (~250 lines) gated. Shape: expand each arg via Expansion,
        // then evaluate the operator (-e/-f/-d/-z/-n/==/!= etc.).
        
        {
            include!("CondExpr_next_body.rs");
        }
        let parent = interp.as_condexpr(this).base.parent;
        interp.child_done(parent, this, 0)
    }

    pub fn child_done(
        interp: &mut Interpreter,
        this: NodeId,
        child: NodeId,
        _exit_code: ExitCode,
    ) -> Yield {
        // Child is always an Expansion that produced one arg.
        interp.deinit_node(child);
        Yield::Next(this)
    }

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        log!("CondExpr {} deinit", this);
        let me = interp.as_condexpr_mut(this);
        me.args.clear();
        me.base.end_scope();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/CondExpr.zig (343 lines)
//   confidence: medium (NodeId conversion; operator-eval body gated)
//   blocked_on: ast::CondExpr, bun_sys::{stat,lstat,access}
// ──────────────────────────────────────────────────────────────────────────
