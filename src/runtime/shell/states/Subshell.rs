use crate::shell::ast;
use crate::shell::interpreter::{log, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::script::Script;
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct Subshell {
    pub base: Base,
    pub node: *const ast::Subshell,
    pub io: IO,
    pub state: SubshellState,
    pub exit_code: ExitCode,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum SubshellState {
    #[default]
    Idle,
    Expanding,
    Exec,
    WaitWriteErr,
    Done,
}

impl Subshell {
    pub fn init(
        interp: &mut Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Subshell,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Subshell(Subshell {
            base: Base::new(StateKind::Subshell, parent, shell),
            node,
            io,
            state: SubshellState::Idle,
            exit_code: 0,
        }))
    }

    pub fn start(_interp: &mut Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        // TODO(b2-blocked): ast::Subshell::{script, redirects} + ShellExecEnv::dupe_for_subshell
        // — full body (~120 lines) gated. Shape: dupe shell env, spawn Script
        // with parent=this, on done deinit duped env.
        #[cfg(any())]
        {
            include!("Subshell_next_body.rs");
        }
        let _ = Script::init; // keep import live
        let parent = interp.as_subshell(this).base.parent;
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
            let me = interp.as_subshell_mut(this);
            me.exit_code = exit_code;
            me.state = SubshellState::Done;
        }
        Yield::Next(this)
    }

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        log!("Subshell {} deinit", this);
        let me = interp.as_subshell_mut(this);
        // TODO(b2-blocked): ShellExecEnv::deinit_impl — owned duped env.
        me.base.end_scope();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Subshell.zig (210 lines)
//   confidence: medium (NodeId conversion; redirect/dupe body gated)
//   blocked_on: ast::Subshell, ShellExecEnv::dupe_for_subshell
// ──────────────────────────────────────────────────────────────────────────
