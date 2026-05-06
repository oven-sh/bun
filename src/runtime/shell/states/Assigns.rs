//! In pipeline expressions, assigns (e.g. `FOO=bar BAR=baz | echo hi`) have
//! no effect on the environment of the shell, so we can skip them.

use crate::shell::ast;
use crate::shell::interpreter::{log, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;
use crate::shell::{EnvStr, ExitCode};

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum AssignCtx {
    Cmd,
    Shell,
    Exported,
}

pub struct Assigns {
    pub base: Base,
    pub node: *const [ast::Assign],
    pub io: IO,
    pub state: AssignsState,
    pub ctx: AssignCtx,
}

#[derive(Default)]
pub enum AssignsState {
    #[default]
    Idle,
    Expanding {
        idx: u32,
        current_out: Vec<u8>,
        expansion: NodeId,
    },
    Done,
}

impl Assigns {
    pub fn init(
        interp: &mut Interpreter,
        shell: *mut ShellExecEnv,
        node: *const [ast::Assign],
        parent: NodeId,
        ctx: AssignCtx,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Assigns(Assigns {
            base: Base::new(StateKind::Assign, parent, shell),
            node,
            io,
            state: AssignsState::Idle,
            ctx,
        }))
    }

    pub fn start(_interp: &mut Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        // TODO(b2-blocked): ast::Assign::{label, value} — full body (~130
        // lines) gated. Shape: for each assign, run an Expansion on the value,
        // then `shell.assign_var(ctx, label, expanded)` and advance.
        // See Assigns.zig:next() for the reference loop.
        let _ = EnvStr::init_slice;
        let parent = interp.as_assigns(this).base.parent;
        interp.child_done(parent, this, 0)
    }

    pub fn child_done(
        interp: &mut Interpreter,
        this: NodeId,
        child: NodeId,
        _exit_code: ExitCode,
    ) -> Yield {
        // Child is always an Expansion.
        interp.deinit_node(child);
        if let AssignsState::Expanding { idx, .. } = &mut interp.as_assigns_mut(this).state {
            *idx += 1;
        }
        Yield::Next(this)
    }

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        log!("Assigns {} deinit", this);
        interp.as_assigns_mut(this).base.end_scope();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Assigns.zig (236 lines)
//   confidence: medium (NodeId conversion; expansion loop body gated)
//   blocked_on: ast::Assign, EnvStr/EnvMap set_var
// ──────────────────────────────────────────────────────────────────────────
