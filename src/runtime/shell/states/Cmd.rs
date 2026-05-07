//! A shell primarily runs commands, so this is the main state node.
//!
//! Execution proceeds: expand assigns → expand redirect → expand argv atoms
//! → resolve to builtin or spawn subprocess → await exit.

use bun_collections::{VecExt, ByteVecExt};
use crate::shell::ast;
use crate::shell::builtin::{Builtin, Kind as BuiltinKind};
use crate::shell::interpreter::{log, ByteList, CowFd, Interpreter, Node, NodeId, ShellExecEnv, StateKind};
use crate::shell::io::{IO, OutKind as IoOutKind};
use crate::shell::shell_body::subproc::{Readable, ShellSubprocess, StdioKind};
use crate::shell::states::assigns::{AssignCtx, Assigns};
use crate::shell::states::base::Base;
use crate::shell::states::expansion::{Expansion, ExpansionOpts};
use crate::shell::util::{OutKind, Stdio};
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
    /// PORT NOTE: in Zig this guarded the `spawn_arena` (an `ArenaAllocator`
    /// holding argv/env scratch). The Rust port heap-allocates argv as
    /// `Vec<Vec<u8>>` so there is no arena to free, but the flag is kept to
    /// preserve `bufferedOutputClose`'s control-flow split (post-spawn vs
    /// pre-spawn completion).
    pub spawn_arena_freed: bool,
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
    Subproc(Box<SubprocExec>),
}

impl Default for Exec {
    fn default() -> Self { Exec::None }
}

/// Spec: Cmd.zig `Exec.subproc` anonymous struct.
pub struct SubprocExec {
    pub child: *mut ShellSubprocess,
    pub buffered_closed: BufferedIoClosed,
    /// NodeId-arena backrefs so the legacy `&mut self` subprocess callbacks
    /// (`buffered_output_close` / `on_exit`) can hand a [`Yield`] back to the
    /// trampoline. The Zig version called `this.next().run()` directly; here
    /// the `Cmd` lives inside `interp.nodes`, so we stash the indices and
    /// return `Yield::Next(this_id)` for the caller (`PipeReader::run_yield`)
    /// to drive.
    pub interp: *mut Interpreter,
    pub this_id: NodeId,
}

/// Spec: Cmd.zig `BufferedIoClosed`.
///
/// Tracks which subprocess stdio pipes are still open. Each `Option` is `None`
/// if that fd was *not* piped (e.g. inherited / fd-backed), so it never gates
/// completion. `Some(state)` means it was piped and must reach `Closed` before
/// [`Cmd::has_finished`] returns true.
#[derive(Default)]
pub struct BufferedIoClosed {
    pub stdin: Option<bool>,
    pub stdout: Option<BufferedIoState>,
    pub stderr: Option<BufferedIoState>,
}

#[derive(Default)]
pub enum BufferedIoState {
    #[default]
    Open,
    Closed(ByteList),
}

impl BufferedIoState {
    #[inline]
    pub fn closed(&self) -> bool { matches!(self, BufferedIoState::Closed(_)) }
}

impl Drop for BufferedIoState {
    fn drop(&mut self) {
        // Spec `BufferedIoState.deinit`: the closed buffer was taken via
        // `PipeReader.take_buffer()`; we own it regardless of the original
        // stdio variant. `ByteList`'s own Drop frees the storage.
        if let BufferedIoState::Closed(list) = self {
            list.clear_and_free();
        }
    }
}

impl BufferedIoClosed {
    /// Spec: `BufferedIoClosed.fromStdio`.
    pub fn from_stdio(io: &[Stdio; 3]) -> Self {
        const STDIN_NO: usize = 0;
        const STDOUT_NO: usize = 1;
        const STDERR_NO: usize = 2;
        Self {
            stdin: if io[STDIN_NO].is_piped() { Some(false) } else { None },
            stdout: if io[STDOUT_NO].is_piped() { Some(BufferedIoState::Open) } else { None },
            stderr: if io[STDERR_NO].is_piped() { Some(BufferedIoState::Open) } else { None },
        }
    }

    /// Spec: `BufferedIoClosed.allClosed`.
    pub fn all_closed(&self) -> bool {
        let stdin_closed = self.stdin.unwrap_or(true);
        let stdout_closed = self.stdout.as_ref().map_or(true, BufferedIoState::closed);
        let stderr_closed = self.stderr.as_ref().map_or(true, BufferedIoState::closed);
        let ret = stdin_closed && stdout_closed && stderr_closed;
        log!(
            "BufferedIOClosed all_closed={} stdin={} stdout={} stderr={}",
            ret,
            stdin_closed,
            stdout_closed,
            stderr_closed
        );
        ret
    }

    /// Spec: `BufferedIoClosed.close` `.stdin` arm.
    pub fn close_stdin(&mut self) {
        self.stdin = Some(true);
    }

    /// Spec: `BufferedIoClosed.close` `.stdout`/`.stderr` arms.
    ///
    /// `readable` is the subprocess's `stdout`/`stderr` `Readable`; if it was
    /// a pipe its buffered bytes are taken (ownership moves into
    /// `state.Closed`) and, if the shell-side IO is `.pipe` and the AST
    /// redirect didn't send this stream elsewhere, also tee'd into the
    /// command-substitution aggregate buffer.
    fn close_out(
        slot: &mut Option<BufferedIoState>,
        readable: &mut Readable,
        io_is_pipe: bool,
        redirects_elsewhere: bool,
        shell_buf: *mut ByteList,
    ) {
        let Some(state) = slot.as_mut() else { return };
        let Readable::Pipe(pipe) = readable else {
            // Not a pipe: nothing to capture. Mark closed with an empty
            // buffer so `all_closed()` is satisfied.
            *state = BufferedIoState::Closed(ByteList::default());
            return;
        };
        // If the shell state is piped (inside a cmd substitution) aggregate
        // the output of this command.
        if io_is_pipe && !redirects_elsewhere && !shell_buf.is_null() {
            let the_slice = pipe.slice();
            // SAFETY: `shell_buf` points into `ShellExecEnv::_buffered_*`,
            // which the owning Cmd's `base.shell` keeps live for the duration
            // of the command. Single-threaded.
            bun_core::handle_oom(unsafe { (*shell_buf).append_slice(the_slice) });
        }
        // SAFETY: `Arc<PipeReader>` interior mutability — the shell is
        // single-threaded and this is the same pattern `subproc::on_close_io`
        // uses to take the done buffer.
        let buffer = unsafe { &mut *(std::sync::Arc::as_ptr(pipe).cast_mut()) }.take_buffer();
        *state = BufferedIoState::Closed(ByteList::move_from_list(buffer));
    }
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
            spawn_arena_freed: false,
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
                    if !n.assigns.is_empty() {
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
                    let args = n.name_and_args;
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
            interp.throw(crate::shell::ShellErr::from_system(err));
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
        // Spec (Cmd.zig deinit lines 715-730): tear down the running exec.
        match core::mem::take(&mut me.exec) {
            Exec::None => {}
            Exec::Builtin(b) => drop(b),
            Exec::Subproc(sub) => {
                // SAFETY: `child` was set by `initSubproc` from a
                // `Box::into_raw(ShellSubprocess)` and stays valid until
                // this drop. Single-threaded.
                let child = unsafe { &mut *sub.child };
                if !child.has_exited() {
                    let _ = child.try_kill(9);
                }
                child.unref::<true>();
                // SAFETY: reclaim the box; `ShellSubprocess::drop` runs
                // `finalize_sync` (closes stdin/stdout/stderr).
                drop(unsafe { Box::from_raw(sub.child) });
                // `sub.buffered_closed` drops here, freeing any captured
                // `ByteList`s (spec `buffered_closed.deinit()`).
            }
        }
        // PORT NOTE: spec frees `spawn_arena` here unless `spawn_arena_freed`.
        // Argv/env are heap-owned `Vec`s in the port; nothing arena-backed to
        // free.
        // `base.shell` is borrowed (or, when parent is Pipeline, freed by
        // `Pipeline::child_done` before this runs) — never freed here.
        me.base.end_scope();
    }

    // ── Subprocess callbacks (legacy `*Cmd` backref shape) ────────────────
    // Spec: Cmd.zig `bufferedInputClose` / `bufferedOutputClose` / `onExit`.
    // `ShellSubprocess` / `PipeReader` hold a `*mut Cmd` backref and call
    // these via `&mut self`. The NodeId-arena port stashes `(interp, this_id)`
    // on `SubprocExec` so the resulting `Yield` can be driven by the caller's
    // `PipeReader::run_yield` without aliasing `&mut Interpreter` against
    // `&mut self`.

    /// Spec: Cmd.zig `hasFinished`.
    pub fn has_finished(&self) -> bool {
        log!("Cmd has_finished exit_code={:?}", self.exit_code);
        if self.exit_code.is_none() {
            return false;
        }
        match &self.exec {
            Exec::None => true,
            Exec::Builtin(_) => false,
            Exec::Subproc(sub) => sub.buffered_closed.all_closed(),
        }
    }

    /// Spec: Cmd.zig `bufferedInputClose`.
    pub fn buffered_input_close(&mut self) {
        if let Exec::Subproc(sub) = &mut self.exec {
            sub.buffered_closed.close_stdin();
        }
    }

    /// Spec: Cmd.zig `bufferedOutputClose`.
    pub fn buffered_output_close(
        &mut self,
        kind: OutKind,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        match kind {
            OutKind::Stdout => self.buffered_output_close_stdout(err),
            OutKind::Stderr => self.buffered_output_close_stderr(err),
        }
        if self.has_finished() {
            // Spec: `if (!spawn_arena_freed)` enqueues a
            // `ShellAsyncSubprocessDone` task; else returns
            // `parent.childDone(this, exit_code)` directly. Both paths land in
            // `Cmd::next` → `CmdState::Done` → `interp.child_done(...)`. In
            // the NodeId-arena port we set `state = Done` and hand the Yield
            // back to the caller (`PipeReader::run_yield`), which drives the
            // trampoline with the `*mut Interpreter` it already holds —
            // semantically the `else` branch (post-spawn `spawn_arena_freed`
            // is always true by the time a pipe closes).
            self.state = CmdState::Done;
            let this_id = match &self.exec {
                Exec::Subproc(sub) => sub.this_id,
                // Only the subprocess path calls this; builtin output goes
                // through `Builtin::done` → `on_exec_done`.
                _ => return Yield::suspended(),
            };
            // PORT NOTE: the `!spawn_arena_freed` arm
            // (`ShellAsyncSubprocessDone::enqueue`) is unreachable here in
            // practice — `initSubproc` sets `spawn_arena_freed = true` before
            // any pipe can close. Kept as the same `Yield::Next` since the
            // task body (`runFromMainThread`) is identical.
            let _ = self.spawn_arena_freed;
            return Yield::Next(this_id);
        }
        Yield::suspended()
    }

    /// Spec: Cmd.zig `bufferedOutputCloseStdout`.
    fn buffered_output_close_stdout(&mut self, err: Option<bun_sys::SystemError>) {
        debug_assert!(matches!(self.exec, Exec::Subproc(_)));
        log!("cmd close buffered stdout");
        if let Some(e) = err {
            self.exit_code = Some(e.errno.unsigned_abs() as ExitCode);
        }
        // SAFETY: `node` points into the AST arena which outlives this Cmd.
        let redirect = unsafe { &*self.node }.redirect;
        let Exec::Subproc(sub) = &mut self.exec else { return };
        // SAFETY: `child` is the live subprocess owned by this Cmd.
        let child = unsafe { &mut *sub.child };
        // Spec: tee into the JS-side captured buffer if `io.stdout == .fd`
        // with a `captured` slot and the redirect didn't send stdout
        // elsewhere.
        if let IoOutKind::Fd(fd) = &self.io.stdout {
            if let Some(captured) = fd.captured {
                if !redirect.redirects_elsewhere(ast::IoKind::Stdout) {
                    if let Readable::Pipe(pipe) = &child.stdout {
                        let the_slice = pipe.slice();
                        // SAFETY: `captured` points into a live `ShellExecEnv`
                        // bufio (see `OutFd::captured` doc). Single-threaded.
                        bun_core::handle_oom(unsafe { (*captured).append_slice(the_slice) });
                    }
                }
            }
        }
        BufferedIoClosed::close_out(
            &mut sub.buffered_closed.stdout,
            &mut child.stdout,
            matches!(self.io.stdout, IoOutKind::Pipe),
            redirect.redirects_elsewhere(ast::IoKind::Stdout),
            // SAFETY: `base.shell` is live for the duration of the command.
            unsafe { &mut *self.base.shell }.buffered_stdout(),
        );
        child.close_io(StdioKind::Stdout);
    }

    /// Spec: Cmd.zig `bufferedOutputCloseStderr`.
    fn buffered_output_close_stderr(&mut self, err: Option<bun_sys::SystemError>) {
        debug_assert!(matches!(self.exec, Exec::Subproc(_)));
        log!("cmd close buffered stderr");
        if let Some(e) = err {
            self.exit_code = Some(e.errno.unsigned_abs() as ExitCode);
        }
        // SAFETY: see `buffered_output_close_stdout`.
        let redirect = unsafe { &*self.node }.redirect;
        let Exec::Subproc(sub) = &mut self.exec else { return };
        // SAFETY: `child` is the live subprocess owned by this Cmd.
        let child = unsafe { &mut *sub.child };
        if let IoOutKind::Fd(fd) = &self.io.stderr {
            if let Some(captured) = fd.captured {
                if !redirect.redirects_elsewhere(ast::IoKind::Stderr) {
                    if let Readable::Pipe(pipe) = &child.stderr {
                        let the_slice = pipe.slice();
                        // SAFETY: see `buffered_output_close_stdout`.
                        bun_core::handle_oom(unsafe { (*captured).append_slice(the_slice) });
                    }
                }
            }
        }
        BufferedIoClosed::close_out(
            &mut sub.buffered_closed.stderr,
            &mut child.stderr,
            matches!(self.io.stderr, IoOutKind::Pipe),
            redirect.redirects_elsewhere(ast::IoKind::Stderr),
            // SAFETY: `base.shell` is live for the duration of the command.
            unsafe { &mut *self.base.shell }.buffered_stderr(),
        );
        child.close_io(StdioKind::Stderr);
    }

    /// Spec: Cmd.zig `onExit` — called by `ShellSubprocess::on_process_exit`.
    pub fn on_exit(&mut self, exit_code: ExitCode) {
        self.exit_code = Some(exit_code);
        let has_finished = self.has_finished();
        log!("cmd exit code={} has_finished={}", exit_code, has_finished);
        if has_finished {
            self.state = CmdState::Done;
            // Spec: `this.next().run()`. In the NodeId-arena port `self` lives
            // inside `interp.nodes`, so we resume via the stashed backrefs.
            let (interp, this_id) = match &self.exec {
                Exec::Subproc(sub) => (sub.interp, sub.this_id),
                _ => return,
            };
            if interp.is_null() {
                return;
            }
            // SAFETY: `interp` outlives every spawned subprocess (it owns the
            // arena slot containing `self`). `&mut self` is dead by NLL after
            // this point so the `&mut Interpreter` borrow does not alias it.
            // The caller (`ShellSubprocess::on_process_exit`) does not touch
            // its `*mut Cmd` again after this returns.
            Yield::Next(this_id).run(unsafe { &mut *interp });
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/states/Cmd.zig (1018 lines)
//   confidence: medium (state-machine + expansion + builtin Exec wired)
//   blocked_on: subproc::ShellSubprocess (which() + spawn),
//               IOWriter redirect handling, writeFailingError
// ──────────────────────────────────────────────────────────────────────────
