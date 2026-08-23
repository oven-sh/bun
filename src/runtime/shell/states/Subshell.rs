use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{EnvRc, Interpreter, Node, NodeId, ShellExecEnvKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::script::Script;
use crate::shell::yield_::Yield;
use std::rc::Rc;

pub struct Subshell {
    pub(crate) base: Base,
    pub node: bun_ptr::BackRef<ast::Subshell>,
    pub(crate) io: IO,
    pub(crate) state: SubshellState,
    pub(crate) exit_code: ExitCode,
}

#[derive(Default, Clone, Copy, strum::IntoStaticStr)]
pub enum SubshellState {
    #[default]
    Idle,
    Exec,
    Done,
}

impl Subshell {
    /// `shell` must already be a duped env owned by this node (see
    /// `init_dupe_shell_state` for the Stmt/Binary path; Pipeline dupes the
    /// env itself before calling this). It is dropped with the node.
    pub(crate) fn init(
        interp: &Interpreter,
        shell: EnvRc,
        node: &ast::Subshell,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Subshell(Subshell {
            base: Base::new(parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            state: SubshellState::Idle,
            exit_code: 0,
        }))
    }

    /// Dupe the parent env and `init`.
    /// Called by Stmt/Binary via `Interpreter::spawn_expr`. Pipeline does
    /// NOT use this (it dupes per-child itself and calls `init` directly).
    pub(crate) fn init_dupe_shell_state(
        interp: &Interpreter,
        parent_shell: &EnvRc,
        node: &ast::Subshell,
        parent: NodeId,
        io: IO,
    ) -> bun_sys::Result<NodeId> {
        let duped = parent_shell
            .borrow()
            .dupe_for_subshell(&io, ShellExecEnvKind::Subshell)?;
        Ok(Self::init(interp, duped, node, parent, io))
    }

    pub(crate) fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        let (state, parent) = {
            let me = interp.as_subshell(this);
            (me.state, me.base.parent)
        };
        log!(
            "Subshell {} next state={}",
            this,
            <&'static str>::from(&state)
        );
        match state {
            SubshellState::Idle => {
                // Spawn Script directly with
                // `this.base.shell`. The env was already duped at construction
                // (by `init_dupe_shell_state` or by Pipeline) — do NOT dupe
                // again here.
                let (shell, io, node) = {
                    let me = interp.as_subshell(this);
                    (Rc::clone(&me.base.shell), me.io.clone(), me.node)
                };
                let script_node = bun_ptr::BackRef::new(&node.get().script);
                interp.as_subshell_mut(this).state = SubshellState::Exec;
                // `node.redirect` is always `None` here: the parser rejects
                // subshells with redirections ("Subshells with redirections
                // are currently not supported", shell_parser/parse.rs).
                let script = Script::init(interp, shell, script_node, this, io);
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
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        interp.deinit_node(child);
        {
            let mut me = interp.as_subshell_mut(this);
            me.exit_code = exit_code;
            me.state = SubshellState::Done;
        }
        Yield::Next(this)
    }

    pub(crate) fn deinit(_interp: &Interpreter, this: NodeId) {
        log!("Subshell {} deinit", this);
        // The duped env drops with the slot (`Interpreter::free_node`).
    }
}
