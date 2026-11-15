use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnvId, ShellExecEnvKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::{Base, Env};
use crate::shell::states::script::Script;
use crate::shell::yield_::Yield;

pub(crate) struct Subshell<'a> {
    pub(crate) base: Base,
    pub node: &'a ast::Subshell<'a>,
    pub(crate) io: IO,
    pub(crate) state: SubshellState,
    pub(crate) exit_code: ExitCode,
    /// `Interpreter::free_node` removes it.
    pub(crate) shell: ShellExecEnvId,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum SubshellState {
    #[default]
    Idle,
    Exec,
    Done,
}

impl<'a> Subshell<'a> {
    pub(crate) fn init(
        interp: &mut Interpreter<'a>,
        shell: ShellExecEnvId,
        node: &'a ast::Subshell<'a>,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Subshell(Subshell {
            base: Base::new(parent),
            shell,
            node,
            io,
            state: SubshellState::Idle,
            exit_code: 0,
        }))
    }

    /// Runs in a dupe of the parent env.
    /// Called by Stmt/Binary via `Interpreter::spawn_expr`. Pipeline does
    /// NOT use this (it dupes per-child itself and calls `init` directly).
    pub(crate) fn init_dupe_shell_state(
        interp: &mut Interpreter<'a>,
        parent_shell: ShellExecEnvId,
        node: &'a ast::Subshell<'a>,
        parent: NodeId,
        io: IO,
    ) -> bun_sys::Result<NodeId> {
        let env = interp
            .shells
            .dupe_for_subshell(parent_shell, io, ShellExecEnvKind::Subshell)?;
        Ok(Self::init(interp, env, node, parent, io))
    }

    pub(crate) fn start(_interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        let (state_tag, parent) = {
            let me = interp.as_subshell(this);
            (<&'static str>::from(&me.state), me.base.parent)
        };
        log!("Subshell {} next state={}", this, state_tag);
        match interp.as_subshell(this).state {
            SubshellState::Idle => {
                // Spawn Script directly with
                // `this.shell`. The env was already duped at construction
                // (by `init_dupe_shell_state` or by Pipeline) — do NOT dupe
                // again here.
                let (shell, io, node) = {
                    let me = interp.as_subshell(this);
                    (me.shell, me.io, me.node)
                };
                interp.as_subshell_mut(this).state = SubshellState::Exec;
                // `node.redirect` is always `None` here: the parser rejects
                // subshells with redirections ("Subshells with redirections
                // are currently not supported", shell_parser/parse.rs).
                let script = Script::init(interp, Env::Inherited(shell), node.script, this, io);
                Script::start(interp, script)
            }
            SubshellState::Exec => Yield::suspended(),
            SubshellState::Done => {
                let exit = interp.as_subshell(this).exit_code;
                interp.child_done(parent, this, exit)
            }
        }
    }

    pub(crate) fn child_done(
        interp: &mut Interpreter<'a>,
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
}
