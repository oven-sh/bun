//! A shell primarily runs commands, so this is the main state node.
//!
//! Execution proceeds: expand assigns → expand argv atoms → expand redirects
//! → resolve to builtin or spawn subprocess → await exit.

use crate::shell::ast;
use crate::shell::builtin::Builtin;
use crate::shell::interpreter::{log, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::base::Base;
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct Cmd {
    pub base: Base,
    pub node: *const ast::Cmd,
    pub io: IO,
    pub state: CmdState,
    pub args: Vec<Vec<u8>>,
    pub redirects_expanded: Vec<Vec<u8>>,
    pub exec: Exec,
    pub exit_code: Option<ExitCode>,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum CmdState {
    #[default]
    Idle,
    ExpandingAssigns,
    ExpandingArgs { idx: u32 },
    ExpandingRedirects { idx: u32 },
    Exec,
    WaitingWriteErr,
    Done,
}

pub enum Exec {
    None,
    Builtin(Box<Builtin>),
    // TODO(b2-blocked): Subprocess — bun_spawn / shell::subproc gated.
    Subproc(*mut ()),
}

impl Default for Exec {
    fn default() -> Self { Exec::None }
}

impl Cmd {
    pub fn init(
        interp: &mut Interpreter,
        shell: *mut ShellExecEnv,
        node: *const ast::Cmd,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Cmd(Cmd {
            base: Base::new(StateKind::Cmd, parent, shell),
            node,
            io,
            state: CmdState::Idle,
            args: Vec::new(),
            redirects_expanded: Vec::new(),
            exec: Exec::None,
            exit_code: None,
        }))
    }

    pub fn start(_interp: &mut Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        // The full body (~550 lines) drives the state machine through
        // ExpandingAssigns → ExpandingArgs → ExpandingRedirects → Exec.
        // It spawns Assigns/Expansion children, then either constructs a
        // Builtin (and calls `Builtin::start(interp, this)`) or spawns a
        // subprocess via `subproc::ShellSubprocess::spawn`.
        //
        // Gated until: ast::Cmd::{assigns, name_and_args, redirects},
        // Builtin::Kind::from_argv0, subproc, IOWriter redirect open.
        #[cfg(any())]
        {
            include!("Cmd_next_body.rs");
        }
        match &interp.as_cmd(this).state {
            CmdState::Done => {
                let exit = interp.as_cmd(this).exit_code.unwrap_or(0);
                let parent = interp.as_cmd(this).base.parent;
                interp.child_done(parent, this, exit)
            }
            _ => Yield::suspended(),
        }
    }

    pub fn child_done(
        interp: &mut Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        // Children are Assigns or Expansion nodes.
        interp.deinit_node(child);
        let _ = exit_code;
        Yield::Next(this)
    }

    /// Called by `Builtin::done` / subprocess exit handler.
    pub fn on_exec_done(interp: &mut Interpreter, this: NodeId, exit_code: ExitCode) -> Yield {
        log!("Cmd {} execDone exit={}", this, exit_code);
        {
            let me = interp.as_cmd_mut(this);
            me.exit_code = Some(exit_code);
            me.state = CmdState::Done;
        }
        Yield::Next(this)
    }

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        log!("Cmd {} deinit", this);
        let me = interp.as_cmd_mut(this);
        me.args.clear();
        me.redirects_expanded.clear();
        me.exec = Exec::None;
        // TODO(b2-blocked): close redirect fds, deinit duped shell env if any.
        me.base.end_scope();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Cmd.zig (1018 lines)
//   confidence: low (NodeId scaffolding only; main state-machine body gated)
//   blocked_on: ast::Cmd, Builtin::Kind, subproc::ShellSubprocess,
//               IOWriter redirect handling
// ──────────────────────────────────────────────────────────────────────────
