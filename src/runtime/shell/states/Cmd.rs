//! A shell primarily runs commands, so this is the main state node.
//!
//! Execution proceeds: expand assigns → expand redirect → expand argv atoms
//! → resolve to builtin or spawn subprocess → await exit.

use crate::shell::ast;
use crate::shell::builtin::{Builtin, Kind as BuiltinKind};
use crate::shell::interpreter::{log, CowFd, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::IO;
use crate::shell::states::assigns::{AssignCtx, Assigns};
use crate::shell::states::base::Base;
use crate::shell::states::expansion::{Expansion, ExpansionOpts};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct Cmd {
    pub base: Base,
    pub node: *const ast::Cmd,
    pub io: IO,
    pub state: CmdState,
    pub args: Vec<Vec<u8>>,
    pub redirection_file: Vec<u8>,
    pub redirection_fd: Option<*mut CowFd>,
    pub exec: Exec,
    pub exit_code: Option<ExitCode>,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum CmdState {
    #[default]
    Idle,
    ExpandingAssigns,
    ExpandingArgs { idx: u32 },
    ExpandingRedirect { idx: u32 },
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
            redirection_file: Vec::new(),
            redirection_fd: None,
            exec: Exec::None,
            exit_code: None,
        }))
    }

    pub fn start(_interp: &mut Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &mut Interpreter, this: NodeId) -> Yield {
        loop {
            let (shell, node) = {
                let me = interp.as_cmd(this);
                (me.base.shell, me.node)
            };
            // SAFETY: `node` points into the AST arena which outlives every
            // state node.
            let n = unsafe { &*node };
            log!(
                "Cmd {} next state={}",
                this,
                <&'static str>::from(&interp.as_cmd(this).state)
            );
            match interp.as_cmd(this).state {
                CmdState::Idle => {
                    // SAFETY: `n.assigns` is an arena slice; see above.
                    let has_assigns = unsafe { !(*n.assigns).is_empty() };
                    if has_assigns {
                        interp.as_cmd_mut(this).state = CmdState::ExpandingAssigns;
                        let io = interp.as_cmd(this).io.clone();
                        let child =
                            Assigns::init(interp, shell, n.assigns, this, AssignCtx::Cmd, io);
                        return Assigns::start(interp, child);
                    }
                    interp.as_cmd_mut(this).state = CmdState::ExpandingRedirect { idx: 0 };
                    continue;
                }
                CmdState::ExpandingAssigns => {
                    // Spec (Cmd.zig childDone Assigns arm): assigns → redirect.
                    interp.as_cmd_mut(this).state = CmdState::ExpandingRedirect { idx: 0 };
                    continue;
                }
                CmdState::ExpandingRedirect { idx } => {
                    match &n.redirect_file {
                        Some(ast::Redirect::Atom(atom)) if idx == 0 => {
                            let atom: *const ast::Atom = atom;
                            let io = interp.as_cmd(this).io.clone();
                            let child = Expansion::init(
                                interp,
                                shell,
                                atom,
                                this,
                                io,
                                ExpansionOpts { for_spawn: false, single: true },
                            );
                            return Expansion::start(interp, child);
                        }
                        // JsBuf redirects don't need expansion; nor does the
                        // "already expanded" re-entry (`idx > 0`).
                        _ => {}
                    }
                    // Spec (Cmd.zig next() expanding_redirect done): → args.
                    interp.as_cmd_mut(this).state = CmdState::ExpandingArgs { idx: 0 };
                    continue;
                }
                CmdState::ExpandingArgs { idx } => {
                    // SAFETY: `n.name_and_args` is an arena slice; see above.
                    let args = unsafe { &*n.name_and_args };
                    if (idx as usize) >= args.len() {
                        interp.as_cmd_mut(this).state = CmdState::Exec;
                        continue;
                    }
                    let atom: *const ast::Atom = &args[idx as usize];
                    let io = interp.as_cmd(this).io.clone();
                    let child = Expansion::init(
                        interp,
                        shell,
                        atom,
                        this,
                        io,
                        ExpansionOpts { for_spawn: true, single: false },
                    );
                    return Expansion::start(interp, child);
                }
                CmdState::Exec => {
                    return Self::transition_to_exec(interp, this);
                }
                CmdState::WaitingWriteErr => return Yield::suspended(),
                CmdState::Done => {
                    let exit = interp.as_cmd(this).exit_code.unwrap_or(0);
                    let parent = interp.as_cmd(this).base.parent;
                    return interp.child_done(parent, this, exit);
                }
            }
        }
    }

    /// Spec: Cmd.zig `onIOWriterChunk` (lines 355-362).
    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        this: NodeId,
        _written: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(err) = e {
            interp.throw(&crate::shell::ShellErr::from_system(&err));
            return Yield::failed();
        }
        debug_assert!(matches!(
            interp.as_cmd(this).state,
            CmdState::WaitingWriteErr
        ));
        let parent = interp.as_cmd(this).base.parent;
        interp.child_done(parent, this, 1)
    }

    pub fn child_done(
        interp: &mut Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        let child_kind = interp.node(child).kind();
        // Spec (Cmd.zig childDone lines 364-398): a nonzero exit from an
        // Assigns or Expansion child aborts the command — write the failing
        // error to stderr and finish with exit 1. Do NOT advance idx.
        if exit_code != 0 && matches!(child_kind, StateKind::Assign | StateKind::Expansion) {
            // TODO(b2-blocked): writeFailingError("{f}\n", err) — extract the
            // expansion error and enqueue an IOWriter stderr write, then
            // transition to `WaitingWriteErr`. Until IOWriter is wired, fail
            // synchronously with the spec's exit code.
            interp.deinit_node(child);
            let me = interp.as_cmd_mut(this);
            me.exit_code = Some(1);
            me.state = CmdState::Done;
            return Yield::Next(this);
        }
        // Collect output from Expansion children before freeing them; then
        // advance the state machine.
        if matches!(child_kind, StateKind::Expansion) {
            let out = Expansion::take_out(interp, child);
            match interp.as_cmd_mut(this).state {
                CmdState::ExpandingArgs { ref mut idx } => {
                    *idx += 1;
                    // Spec (Cmd.zig childDone 400-409): when the sole
                    // `name_and_args` atom is a `.simple == .cmd_subst`, stash
                    // `e.out_exit_code` so an empty-argv command consisting
                    // only of `$(cmd)` propagates `cmd`'s exit code via the
                    // empty-argv0 branch in `transition_to_exec`.
                    // TODO(b2-blocked): `ExpansionOut` has no `out_exit_code`
                    // yet (Expansion.rs body gated) and `ast::Atom` is opaque
                    // so the `.cmd_subst` check can't be expressed. Wire once
                    // Expansion exposes the substitution's exit code.
                    // PORT NOTE: Zig used `out.bounds` to split into multiple
                    // argv words (glob/IFS); preserved here verbatim.
                    let me = interp.as_cmd_mut(this);
                    if out.bounds.is_empty() {
                        me.args.push(out.buf);
                    } else {
                        let mut prev = 0usize;
                        for &b in &out.bounds {
                            me.args.push(out.buf[prev..b as usize].to_vec());
                            prev = b as usize;
                        }
                        me.args.push(out.buf[prev..].to_vec());
                    }
                }
                CmdState::ExpandingRedirect { ref mut idx } => {
                    *idx += 1;
                    interp.as_cmd_mut(this).redirection_file = out.buf;
                }
                _ => {}
            }
        }
        interp.deinit_node(child);
        Yield::Next(this)
    }

    /// Spec: Cmd.zig `transitionToExecStateAndYield()` + `initSubproc()` up
    /// through the `Builtin.Kind.fromStr` branch. Resolves argv[0] to a
    /// builtin or falls through to subprocess spawn (still gated).
    fn transition_to_exec(interp: &mut Interpreter, this: NodeId) -> Yield {
        // NUL-terminate every arg so builtins can borrow them as `*const c_char`.
        // (Zig stored argv as `[*:0]const u8`; the Rust port collected them as
        // `Vec<u8>` from Expansion.)
        for a in &mut interp.as_cmd_mut(this).args {
            if a.last() != Some(&0) {
                a.push(0);
            }
        }

        // Spec (Cmd.zig initSubproc lines 442-456): empty/null argv[0] → exit
        // with the exit code from a sole command-substitution (stashed by
        // `child_done` once Expansion exposes `out_exit_code`; see TODO there),
        // else 0.
        let first_arg: Vec<u8> = {
            let me = interp.as_cmd(this);
            match me.args.first() {
                Some(a) if a.len() > 1 => {
                    // strip the trailing NUL we just added
                    a[..a.len() - 1].to_vec()
                }
                _ => {
                    let exit = me.exit_code.unwrap_or(0);
                    let parent = me.base.parent;
                    return interp.child_done(parent, this, exit);
                }
            }
        };

        if let Some(kind) = BuiltinKind::from_argv0(&first_arg) {
            log!("Cmd {} exec builtin={:?}", this, kind);
            if let Some(y) = Builtin::init(interp, this, kind) {
                return y;
            }
            debug_assert!(matches!(interp.as_cmd(this).exec, Exec::Builtin(_)));
            return Builtin::start(interp, this);
        }

        // TODO(b2-blocked): subprocess path — `which()` lookup +
        // `subproc::ShellSubprocess::spawn`. Until bun_spawn is wired, fail
        // with the spec's "command not found" exit code.
        // Spec (Cmd.zig initSubproc lines 489-494): writeFailingError(
        // "bun: command not found: {s}\n") → `.waiting_write_err` →
        // onIOWriterChunk (Cmd.zig:360-362) → `parent.childDone(this, 1)`.
        // IOWriter not yet wired, so finish synchronously with the spec's
        // exit code (1, NOT 127).
        log!("Cmd {} exec: command not found: {:?}", this, first_arg);
        let me = interp.as_cmd_mut(this);
        me.exit_code = Some(1);
        me.state = CmdState::Done;
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

    /// Spec: interpreter.zig `ShellAsyncSubprocessDone.runFromMainThread` body.
    /// Main-thread re-entry for a subprocess exit posted from off-thread —
    /// equivalent to [`Self::on_exec_done`] but drives the trampoline itself
    /// since the dispatcher discards the [`Yield`].
    pub fn on_subprocess_done(interp: &mut Interpreter, this: NodeId, exit_code: ExitCode) {
        Self::on_exec_done(interp, this, exit_code).run(interp);
    }

    pub fn deinit(interp: &mut Interpreter, this: NodeId) {
        log!("Cmd {} deinit", this);
        let me = interp.as_cmd_mut(this);
        me.args.clear();
        me.redirection_file.clear();
        if let Some(fd) = me.redirection_fd.take() {
            CowFd::deref(fd);
        }
        me.exec = Exec::None;
        // `base.shell` is borrowed (or, when parent is Pipeline, freed by
        // `Pipeline::child_done` before this runs) — never freed here.
        me.base.end_scope();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Cmd.zig (1018 lines)
//   confidence: medium (state-machine + expansion + builtin Exec wired)
//   blocked_on: subproc::ShellSubprocess (which() + spawn),
//               IOWriter redirect handling, writeFailingError
// ──────────────────────────────────────────────────────────────────────────
