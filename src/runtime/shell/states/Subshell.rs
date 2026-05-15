use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{
    Interpreter, Node, NodeId, ShellExecEnv, ShellExecEnvKind, StateKind, log,
};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::states::script::Script;
use crate::shell::yield_::Yield;

pub struct Subshell {
    pub base: Base,
    pub node: bun_ptr::BackRef<ast::Subshell>,
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
    /// `shell` must already be a duped env owned by this node (see
    /// `init_dupe_shell_state` for the Stmt/Binary path; Pipeline dupes the
    /// env itself before calling this). `Subshell::deinit` frees it.
    pub fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::Subshell,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Subshell(Subshell {
            base: Base::new(StateKind::Subshell, parent, shell),
            node: bun_ptr::BackRef::new(node),
            io,
            state: SubshellState::Idle,
            exit_code: 0,
        }))
    }

    /// Zig `Subshell.initDupeShellState` — dupe the parent env and `init`.
    /// Called by Stmt/Binary via `Interpreter::spawn_expr`. Pipeline does
    /// NOT use this (it dupes per-child itself and calls `init` directly).
    pub fn init_dupe_shell_state(
        interp: &Interpreter,
        parent_shell: *mut ShellExecEnv,
        node: &ast::Subshell,
        parent: NodeId,
        io: IO,
    ) -> bun_sys::Result<NodeId> {
        // SAFETY: `parent_shell` is a live env owned by the parent state.
        let duped = unsafe { (*parent_shell).dupe_for_subshell(&io, ShellExecEnvKind::Subshell) }?;
        Ok(Self::init(interp, duped, node, parent, io))
    }

    pub fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
        let (state_tag, parent) = {
            let me = interp.as_subshell(this);
            (<&'static str>::from(&me.state), me.base.parent)
        };
        log!("Subshell {} next state={}", this, state_tag);
        match interp.as_subshell(this).state {
            SubshellState::Idle => {
                // Spec (Subshell.zig start()): spawn Script directly with
                // `this.base.shell`. The env was already duped at construction
                // (by `init_dupe_shell_state` or by Pipeline) — do NOT dupe
                // again here.
                let (shell, io, node) = {
                    let me = interp.as_subshell(this);
                    (me.base.shell, me.io.clone(), me.node)
                };
                let script_node: *const ast::Script = &node.get().script;
                interp.as_subshell_mut(this).state = SubshellState::Exec;
                // TODO(b2-blocked): apply `(*node).redirect` / `redirect_flags`
                // to `io` once IOWriter redirect open is wired.
                let script = Script::init(interp, shell, script_node, this, io);
                Script::start(interp, script)
            }
            SubshellState::Expanding | SubshellState::Exec => Yield::suspended(),
            SubshellState::WaitWriteErr => Yield::suspended(),
            SubshellState::Done => {
                let exit = interp.as_subshell(this).exit_code;
                interp.child_done(parent, this, exit)
            }
        }
    }

    /// Spec: Subshell.zig `onIOWriterChunk` (lines 163-174).
    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        this: NodeId,
        _written: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        debug_assert!(matches!(
            interp.as_subshell(this).state,
            SubshellState::WaitWriteErr
        ));
        // Spec just `e.deref()` — Drop handles that.
        drop(err);
        let (parent, exit) = {
            let me = interp.as_subshell_mut(this);
            me.state = SubshellState::Done;
            (me.base.parent, me.exit_code)
        };
        interp.child_done(parent, this, exit)
    }

    pub fn child_done(
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

    pub fn deinit(interp: &Interpreter, this: NodeId) {
        log!("Subshell {} deinit", this);
        let me = interp.as_subshell_mut(this);
        // The env was duped at construction (either by Pipeline or by
        // `init_dupe_shell_state`) — Subshell always owns it.
        if !me.base.shell.is_null() {
            ShellExecEnv::deinit_impl(me.base.shell);
            me.base.shell = core::ptr::null_mut();
        }
        me.base.end_scope();
    }
}

// ported from: src/shell/states/Subshell.zig
