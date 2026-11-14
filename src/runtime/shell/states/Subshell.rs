use bun_ptr::AliasableBox;

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{Interpreter, Node, NodeId, ShellExecEnv, ShellExecEnvKind, log};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::script::Script;
use crate::shell::yield_::Yield;

pub(crate) struct Subshell {
    pub(crate) base: Base,
    /// What `base.shell` points to. `None` in a pipeline, which owns its members' envs.
    _env: Option<AliasableBox<ShellExecEnv>>,
    pub node: bun_ptr::BackRef<ast::Subshell>,
    pub(crate) io: IO,
    pub(crate) state: SubshellState,
    pub(crate) exit_code: ExitCode,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum SubshellState {
    #[default]
    Idle,
    Exec,
    Done,
}

impl Subshell {
    /// `shell` is the env that the parent Pipeline duped for this member.
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::Subshell,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        Self::alloc(interp, Base::new(parent, shell), None, node, io)
    }

    fn alloc(
        interp: &Interpreter,
        base: Base,
        env: Option<AliasableBox<ShellExecEnv>>,
        node: &ast::Subshell,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Subshell(Subshell {
            base,
            _env: env,
            node: bun_ptr::BackRef::new(node),
            io,
            state: SubshellState::Idle,
            exit_code: 0,
        }))
    }

    /// Runs in a dupe of the parent env.
    /// Called by Stmt/Binary via `Interpreter::spawn_expr`. Pipeline does
    /// NOT use this (it dupes per-child itself and calls `init` directly).
    ///
    /// # Safety
    /// `parent_shell` must point to a live `ShellExecEnv` owned by the parent
    /// state for the duration of this call.
    // Caller (Interpreter::spawn_expr) holds the parent env as a raw pointer;
    // the safety contract is documented above and at the call site.
    pub(crate) fn init_dupe_shell_state(
        interp: &Interpreter,
        parent_shell: *mut ShellExecEnv,
        node: &ast::Subshell,
        parent: NodeId,
        io: IO,
    ) -> bun_sys::Result<NodeId> {
        // SAFETY: caller guarantees `parent_shell` points to a live
        // `ShellExecEnv` owned by the parent state for the duration of this
        // call (see `# Safety` above).
        let env = unsafe { (*parent_shell).dupe_for_subshell(&io, ShellExecEnvKind::Subshell) }?;
        let base = Base::new(parent, env.as_ptr());
        Ok(Self::alloc(interp, base, Some(env), node, io))
    }

    pub(crate) fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        let (state_tag, parent) = {
            let me = interp.as_subshell(this);
            (<&'static str>::from(&me.state), me.base.parent)
        };
        log!("Subshell {} next state={}", this, state_tag);
        match interp.as_subshell(this).state {
            SubshellState::Idle => {
                // Spawn Script directly with
                // `this.base.shell`. The env was already duped at construction
                // (by `init_dupe_shell_state` or by Pipeline) — do NOT dupe
                // again here.
                let (shell, io, node) = {
                    let me = interp.as_subshell(this);
                    (me.base.shell, me.io.clone(), me.node)
                };
                interp.as_subshell_mut(this).state = SubshellState::Exec;
                // `node.redirect` is always `None` here: the parser rejects
                // subshells with redirections ("Subshells with redirections
                // are currently not supported", shell_parser/parse.rs).
                let script = Script::init(interp, shell, &node.script, this, io);
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
            let me = interp.as_subshell_mut(this);
            me.exit_code = exit_code;
            me.state = SubshellState::Done;
        }
        Yield::Next(this)
    }

    pub(crate) fn deinit(_interp: &Interpreter, this: NodeId) {
        log!("Subshell {} deinit", this);
    }
}
