//! A shell primarily runs commands, so this is the main state node.
//!
//! Execution proceeds: expand assigns → expand redirect → expand argv atoms
//! → resolve to builtin or spawn subprocess → await exit.

use crate::node::fs::{note_shell_redirect, open_embedded_shell_operand, refuse_shell_redirect};
use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::builtin::{Builtin, IoKind, Kind as BuiltinKind};
use crate::shell::interpreter::{
    Interpreter, Node, NodeId, OwnedFd, ShellInterpreter, StateKind, log,
};
use crate::shell::io::{IO, OutKind};
use crate::shell::states::assigns::{AssignCtx, Assigns};
use crate::shell::states::base::{Base, Env};
use crate::shell::states::expansion::Expansion;
use crate::shell::subproc::{ShellSubprocess, SpawnArgs, StdioKind, SubprocExec};
use crate::shell::util::Stdio;
use crate::shell::yield_::{ReentrantAction, Yield};
use bun_collections::VecExt;
use core::ops::ControlFlow;

pub(crate) struct Cmd<'a> {
    pub(crate) base: Base,
    pub node: &'a ast::Cmd<'a>,
    pub(crate) io: IO,
    pub(crate) state: CmdState,
    pub args: Vec<Vec<u8>>,
    pub(crate) redirection_file: Vec<u8>,
    pub(crate) exec: Exec<'a>,
    pub(crate) exit_code: Option<ExitCode>,
    pub(crate) shell: Env,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum CmdState {
    #[default]
    Idle,
    ExpandingAssigns,
    ExpandingArgs {
        idx: u32,
    },
    ExpandingRedirect {
        idx: u32,
    },
    Exec,
    WaitingWriteErr,
    Done,
}

#[derive(Default)]
pub(crate) enum Exec<'a> {
    #[default]
    None,
    Builtin(Box<Builtin>),
    Subproc(Box<SubprocExec<'a>>),
}

pub(crate) struct JsRedirect {
    pub(crate) buf: ast::JSBuf,
    pub(crate) flags: ast::RedirectFlags,
}

impl<'a> Cmd<'a> {
    pub(crate) fn init(
        interp: &mut Interpreter<'a>,
        shell: Env,
        node: &'a ast::Cmd<'a>,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Cmd(Cmd {
            base: Base::new(parent),
            shell,
            node,
            io,
            state: CmdState::Idle,
            args: Vec::new(),
            redirection_file: Vec::new(),
            exec: Exec::None,
            exit_code: None,
        }))
    }

    pub(crate) fn start(_interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        loop {
            let (shell, n) = {
                let me = interp.as_cmd(this);
                (me.shell.id(), me.node)
            };
            log!(
                "Cmd {} next state={}",
                this,
                <&'static str>::from(&interp.as_cmd(this).state)
            );
            if interp.failed()
                && !matches!(
                    interp.as_cmd(this).state,
                    CmdState::WaitingWriteErr | CmdState::Done
                )
            {
                // The script failed: expand nothing more and do not spawn.
                let me = interp.as_cmd_mut(this);
                me.exit_code = Some(1);
                me.state = CmdState::Done;
                continue;
            }
            match interp.as_cmd(this).state {
                CmdState::Idle => {
                    if !n.assigns.is_empty() {
                        interp.as_cmd_mut(this).state = CmdState::ExpandingAssigns;
                        let child = Assigns::init(interp, shell, n.assigns, this, AssignCtx::Cmd);
                        return Assigns::start(interp, child);
                    }
                    interp.as_cmd_mut(this).state = CmdState::ExpandingRedirect { idx: 0 };
                    continue;
                }
                CmdState::ExpandingAssigns => {
                    interp.as_cmd_mut(this).state = CmdState::ExpandingRedirect { idx: 0 };
                    continue;
                }
                CmdState::ExpandingRedirect { idx } => {
                    match &n.redirect_file {
                        Some(ast::Redirect::Atom(atom)) if idx == 0 => {
                            let child = Expansion::init(interp, shell, atom, this, false);
                            return Expansion::start(interp, child);
                        }
                        // JsBuf redirects don't need expansion; nor does the
                        // "already expanded" re-entry (`idx > 0`).
                        _ => {}
                    }
                    interp.as_cmd_mut(this).state = CmdState::ExpandingArgs { idx: 0 };
                    continue;
                }
                CmdState::ExpandingArgs { idx } => {
                    let args = n.name_and_args;
                    if (idx as usize) >= args.len() {
                        interp.as_cmd_mut(this).state = CmdState::Exec;
                        continue;
                    }
                    let assign_ctx = idx > 0
                        && is_declaration_utility(&args[0])
                        && is_assignment_word(&args[idx as usize]);
                    let atom = &args[idx as usize];
                    let child = Expansion::init(interp, shell, atom, this, assign_ctx);
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

    /// IOWriter completion callback for the error message written in
    /// `WaitingWriteErr`: throw on write failure, otherwise finish the Cmd
    /// with exit code 1.
    pub(crate) fn on_io_writer_chunk(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        _written: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(err) = e {
            return Yield::throw(this, crate::shell::ShellErr::from_system(err));
        }
        debug_assert!(matches!(
            interp.as_cmd(this).state,
            CmdState::WaitingWriteErr
        ));
        let parent = interp.as_cmd(this).base.parent;
        interp.child_done(parent, this, 1)
    }

    pub(crate) fn child_done(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        let child_kind = interp.node(child).kind();
        // A nonzero exit from an
        // Assigns or Expansion child aborts the command — write the failing
        // error to stderr and finish with exit 1. Do NOT advance idx.
        if exit_code != 0 && matches!(child_kind, StateKind::Assign | StateKind::Expansion) {
            // Pull the expansion error out
            // before deiniting the child, then write it to stderr via
            // `writeFailingError("{f}\n", err)` and finish with exit 1.
            let err = if matches!(child_kind, StateKind::Expansion) {
                Expansion::take_err(interp, child)
            } else {
                None
            };
            interp.deinit_node(child);
            if let Some(err) = err {
                return Builtin::cmd_write_failing_error(interp, this, format_args!("{}\n", err));
            }
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
                    let new_idx = *idx;
                    // When the sole
                    // `name_and_args` atom is a `.simple == .cmd_subst`, stash
                    // `e.out_exit_code` so an empty-argv command consisting
                    // only of `$(cmd)` propagates `cmd`'s exit code via the
                    // empty-argv0 branch in `transition_to_exec` (POSIX: "if
                    // there is no command name, but the command contained a
                    // command substitution, the command shall complete with
                    // the exit status of the last command substitution
                    // performed").
                    {
                        let n = interp.as_cmd(this).node;
                        if new_idx == 1
                            && n.name_and_args.len() == 1
                            && matches!(
                                n.name_and_args[0],
                                ast::Atom::Simple(ast::SimpleAtom::CmdSubst(_))
                            )
                        {
                            interp.as_cmd_mut(this).exit_code = Some(out.out_exit_code);
                        }
                    }
                    // `out.bounds` splits the expansion into multiple argv
                    // words (glob/IFS).
                    let me = interp.as_cmd_mut(this);
                    if out.bounds.is_empty() {
                        // An empty
                        // expansion that did *not* see a `""` literal pushes
                        // no arg at all — `$unset` vanishes, only `""` yields
                        // an empty argv word.
                        if !out.buf.is_empty() || out.has_quoted_empty {
                            me.args.push(out.buf);
                        }
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
                    // Zero words or >1 word (glob/brace split) leave the buffer
                    // empty so the ambiguous-redirect check in
                    // `Builtin::init_redirections` / `init_subproc_redirections` fires.
                    let mut buf = if out.bounds.is_empty() {
                        out.buf
                    } else {
                        Vec::new()
                    };
                    if !buf.is_empty() && buf.last() != Some(&0) {
                        buf.push(0);
                    }
                    interp.as_cmd_mut(this).redirection_file = buf;
                }
                _ => {}
            }
        }
        interp.deinit_node(child);
        Yield::Next(this)
    }

    /// Resolves argv[0] to a builtin or falls through to subprocess spawn.
    fn transition_to_exec(interp: &mut Interpreter<'a>, this: NodeId) -> Yield {
        // NUL-terminate every arg for `Builtin::arg_zstr` and `spawn_process`.
        let me = interp.as_cmd_mut(this);
        for a in &mut me.args {
            if a.last() != Some(&0) {
                a.push(0);
            }
        }

        // Empty/null argv[0] → exit
        // with the exit code from a sole command-substitution (stashed by
        // `child_done` from `Expansion::out_exit_code`), else 0.
        let first_arg = match me.args.first() {
            // strip the trailing NUL we just added
            Some(a) if a.len() > 1 => &a[..a.len() - 1],
            _ => {
                let exit = me.exit_code.unwrap_or(0);
                let parent = me.base.parent;
                return interp.child_done(parent, this, exit);
            }
        };

        if let Some(kind) = BuiltinKind::from_argv0(first_arg) {
            log!("Cmd {} exec builtin={:?}", this, kind);
            if let Some(y) = Builtin::init(interp, this, kind) {
                return y;
            }
            debug_assert!(matches!(interp.as_cmd(this).exec, Exec::Builtin(_)));
            return Builtin::start(interp, this);
        }

        Yield::Action(ReentrantAction::Spawn(this))
    }

    pub(crate) fn spawn(
        shell_interp: &ShellInterpreter,
        this: NodeId,
    ) -> crate::jsc::JsResult<Yield> {
        let arena = bun_alloc::Arena::new();
        let mut spawn_args = SpawnArgs::default(&arena);
        let mut redirection_fd = None;

        let inited = shell_interp.with_interp(|interp| {
            Cmd::init_spawn_args(interp, this, &mut spawn_args, &mut redirection_fd)
        });
        match inited.expect("the script waits for this Cmd") {
            ControlFlow::Continue(None) => {}
            ControlFlow::Continue(Some(redirect)) => {
                Self::init_subproc_jsbuf_redirection(shell_interp, redirect, &mut spawn_args)?;
            }
            ControlFlow::Break(y) => return Ok(y),
        }

        Ok(ShellSubprocess::spawn_async(shell_interp, this, spawn_args))
    }

    /// Breaks when a failing-error write was queued. Continues with the `JsBuf` redirect to apply, if any.
    fn init_spawn_args(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        spawn_args: &mut SpawnArgs<'_>,
        redirection_fd: &mut Option<OwnedFd>,
    ) -> ControlFlow<Yield, Option<JsRedirect>> {
        let me = interp.as_cmd(this);
        let env = &interp.shells[me.shell.id()];
        spawn_args.fill_env(&env.export_env);
        spawn_args.fill_env(&env.cmd_local_env);

        let first_arg = &me.args[0][..me.args[0].len() - 1];
        let resolved = match spawn_args.which(interp.env_loader(), env.cwd(), first_arg) {
            None if first_arg == b"bun" || first_arg == b"bun-debug" => bun_core::self_exe_path()
                .ok()
                .map(|z| z.as_bytes().to_vec()),
            resolved => resolved,
        };
        let Some(mut resolved) = resolved else {
            // writeFailingError("bun: command not found: {s}\n") →
            // `.waiting_write_err` → onIOWriterChunk → `parent.childDone(this, 1)`.
            let first_arg = first_arg.to_vec();
            return ControlFlow::Break(Builtin::cmd_write_failing_error(
                interp,
                this,
                format_args!("bun: command not found: {}\n", bstr::BStr::new(&first_arg)),
            ));
        };
        // CreateProcessW runs `.bat`/`.cmd` files through `cmd.exe`, which
        // re-tokenizes the command line with shell metacharacter rules
        // (BatBadBut). libuv's MSVCRT-style quoting cannot make that safe, so
        // reject arguments that cmd.exe would reinterpret.
        if cfg!(windows) && bun_which::is_batch_file(&resolved) {
            let unsafe_arg: Option<Vec<u8>> = interp
                .as_cmd(this)
                .args
                .iter()
                .skip(1)
                .find(|a| bun_which::batch_arg_has_cmd_metachars(&a[..a.len() - 1]))
                .map(|a| a[..a.len() - 1].to_vec());
            if let Some(arg) = unsafe_arg {
                return ControlFlow::Break(Builtin::cmd_write_failing_error(
                    interp,
                    this,
                    format_args!(
                        "bun: refusing to pass argument with cmd.exe special characters to a batch file: {}\n",
                        bstr::BStr::new(&arg)
                    ),
                ));
            }
        }
        // Replace argv[0] with the resolved absolute path (NUL-terminated for
        // `execve`).
        resolved.push(0);
        interp.as_cmd_mut(this).args[0] = resolved;

        // Convert shell IO → subprocess stdio.
        let io = interp.as_cmd(this).io;
        io.to_subproc_stdio(interp, &mut spawn_args.stdio, &mut spawn_args.shellio);

        // Apply file/`2>&1` redirects on
        // top of the IO-derived stdio.
        Self::init_subproc_redirections(interp, this, &mut spawn_args.stdio, redirection_fd)
    }

    /// Applies `> file`, `2>&1`, … onto `stdio`. Returns like [`Self::init_spawn_args`].
    fn init_subproc_redirections(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        stdio: &mut [Stdio; 3],
        redirection_fd: &mut Option<OwnedFd>,
    ) -> ControlFlow<Yield, Option<JsRedirect>> {
        let node = interp.as_cmd(this).node;
        let flags = node.redirect;

        let Some(redirect) = &node.redirect_file else {
            if flags.duplicate_out() {
                if flags.stdout() {
                    stdio[STDERR_NO] = Stdio::Dup2(crate::api::bun_spawn::stdio::Dup2 {
                        out: StdioKind::Stderr,
                        to: StdioKind::Stdout,
                    });
                }
                if flags.stderr() {
                    stdio[STDOUT_NO] = Stdio::Dup2(crate::api::bun_spawn::stdio::Dup2 {
                        out: StdioKind::Stdout,
                        to: StdioKind::Stderr,
                    });
                }
            }
            return ControlFlow::Continue(None);
        };

        match redirect {
            ast::Redirect::JsBuf(buf) => {
                return ControlFlow::Continue(Some(JsRedirect { buf: *buf, flags }));
            }
            ast::Redirect::Atom(_) => {
                if interp.as_cmd(this).redirection_file.is_empty() {
                    let argv0 = interp
                        .as_cmd(this)
                        .args
                        .first()
                        .map(|a| &a[..a.len().saturating_sub(1)])
                        .unwrap_or(b"<unknown>")
                        .to_vec();
                    return ControlFlow::Break(Builtin::cmd_write_failing_error(
                        interp,
                        this,
                        format_args!(
                            "bun: ambiguous redirect: at `{}`\n",
                            bstr::BStr::new(&argv0)
                        ),
                    ));
                }
                // NUL-terminated by `child_done`.
                let path_buf = core::mem::take(&mut interp.as_cmd_mut(this).redirection_file);
                let path = bun_core::ZStr::from_slice_with_nul(&path_buf);
                log!("Expanded Redirect: {}\n", bstr::BStr::new(path.as_bytes()));
                let shell = Builtin::shell(interp, this);
                let cwd_fd = shell.cwd_fd.fd();
                let refused = refuse_shell_redirect(shell.cwd(), path.as_bytes(), flags.to_flags());
                let opened = refused.and_then(|()| {
                    crate::shell::interpreter::shell_openat(cwd_fd, path, flags.to_flags(), 0o666)
                });
                let opened = opened.inspect(|_| {
                    note_shell_redirect(shell.cwd(), path.as_bytes(), flags.to_flags());
                });
                let opened = opened.or_else(|error| {
                    open_embedded_shell_operand(
                        shell.cwd(),
                        path.as_bytes(),
                        flags.to_flags(),
                        error,
                    )
                });
                let redirfd = match opened {
                    Ok(fd) => redirection_fd.insert(OwnedFd(fd)),
                    Err(e) => {
                        let sys_err = e.to_shell_system_error();
                        return ControlFlow::Break(Builtin::cmd_write_failing_error(
                            interp,
                            this,
                            format_args!(
                                "bun: {}: {}",
                                sys_err.message,
                                bstr::BStr::new(path.as_bytes())
                            ),
                        ));
                    }
                };
                set_stdio_from_redirect(stdio, flags, redirfd.fd());
            }
        }
        ControlFlow::Continue(None)
    }

    /// `< ${blob}`, `> ${arraybuffer}`, …
    fn init_subproc_jsbuf_redirection(
        shell_interp: &ShellInterpreter,
        JsRedirect { buf: val, flags }: JsRedirect,
        spawn_args: &mut SpawnArgs<'_>,
    ) -> crate::jsc::JsResult<()> {
        let SpawnArgs {
            stdio,
            redirect_stdout,
            redirect_stderr,
            ..
        } = spawn_args;
        let global = shell_interp
            .global_this_ref()
            .expect("JS values not allowed in this context");
        let jsval = shell_interp.jsobj(global, val.idx)?;

        if let Some(buf) = jsval.as_array_buffer(global) {
            if flags.stdin() {
                let bytes = buf.byte_slice();
                // Like `Stdio::extract`, an empty buffer delivers EOF immediately.
                stdio[STDIN_NO] = if bytes.is_empty() {
                    Stdio::Ignore
                } else {
                    Stdio::Blob(crate::webcore::blob::Any::from_owned_slice(bytes.to_vec()))
                };
            }
            let mut redirect_out = |fd: usize, slot: &mut Option<crate::jsc::PinnedArrayBuffer>| {
                let Some(buf) = crate::jsc::PinnedArrayBuffer::root(global, jsval) else {
                    return Err(global.throw_out_of_memory());
                };
                stdio[fd] = Stdio::Pipe;
                *slot = Some(buf);
                Ok(())
            };
            if flags.duplicate_out() || flags.stdout() {
                redirect_out(STDOUT_NO, redirect_stdout)?;
            }
            if flags.duplicate_out() || flags.stderr() {
                redirect_out(STDERR_NO, redirect_stderr)?;
            }
        } else if let Some(blob_ref) = jsval.as_class_ref::<crate::webcore::Blob>() {
            let blob = blob_ref.dupe();
            if flags.stdin() {
                stdio[STDIN_NO].extract_blob(
                    global,
                    crate::webcore::blob::Any::Blob(blob),
                    STDIN_NO as i32,
                )?;
            } else if flags.stdout() {
                stdio[STDOUT_NO].extract_blob(
                    global,
                    crate::webcore::blob::Any::Blob(blob),
                    STDOUT_NO as i32,
                )?;
            } else if flags.stderr() {
                stdio[STDERR_NO].extract_blob(
                    global,
                    crate::webcore::blob::Any::Blob(blob),
                    STDERR_NO as i32,
                )?;
            }
        } else if let Some(req) = jsval.as_class_ref::<crate::webcore::Response>() {
            req.body().to_blob_if_possible();
            if flags.stdin() {
                let b = req.body().use_as_any_blob();
                stdio[STDIN_NO].extract_blob(global, b, STDIN_NO as i32)?;
            }
            if flags.stdout() {
                let b = req.body().use_as_any_blob();
                stdio[STDOUT_NO].extract_blob(global, b, STDOUT_NO as i32)?;
            }
            if flags.stderr() {
                let b = req.body().use_as_any_blob();
                stdio[STDERR_NO].extract_blob(global, b, STDERR_NO as i32)?;
            }
        } else {
            return Err(global.throw(format_args!(
                "Unknown JS value used in shell: {}",
                jsval.fmt_string(global)
            )));
        }
        Ok(())
    }

    /// Called by `Builtin::done`.
    pub(crate) fn on_exec_done(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        log!("Cmd {} execDone exit={}", this, exit_code);
        {
            let me = interp.as_cmd_mut(this);
            me.exit_code = Some(exit_code);
            me.state = CmdState::Done;
        }
        Yield::Next(this)
    }

    /// See [`SubprocExec::defuse_array_buf_pins`].
    pub(crate) fn defuse_array_buf_pins(&mut self) {
        match &mut self.exec {
            Exec::None => {}
            Exec::Builtin(b) => b.defuse_array_buf_pins(),
            Exec::Subproc(sub) => sub.defuse_array_buf_pins(),
        }
    }

    /// The script failed: stop the subprocess. Its exit finishes the Cmd through `on_exit`.
    pub(crate) fn kill_subprocess(&self) {
        if let Exec::Subproc(sub) = &self.exec {
            sub.kill();
        }
    }

    pub(crate) fn deinit(interp: &mut Interpreter<'a>, this: NodeId) {
        log!("Cmd {} deinit", this);
        match core::mem::take(&mut interp.as_cmd_mut(this).exec) {
            Exec::None => {}
            Exec::Builtin(b) => b.deinit(interp),
            Exec::Subproc(sub) => sub.kill(),
        }
    }

    // ── Subprocess callbacks ──────────────────────────────────────────────

    /// The subprocess's buffered stdout/stderr closed: flush the captured bytes into the shell buffers.
    pub(crate) fn buffered_output_close(
        interp: &mut Interpreter<'a>,
        this: NodeId,
        kind: IoKind,
        output: &[u8],
        errno: Option<ExitCode>,
    ) -> Yield {
        let me = interp.nodes[this.idx()].as_cmd_mut();
        if errno.is_some() {
            me.exit_code = errno;
        }
        let io = match kind {
            IoKind::Stdout => me.io.stdout,
            IoKind::Stderr => me.io.stderr,
        };
        if !me.node.redirect.redirects_elsewhere(kind) {
            let shell_buf = match io {
                // Tee into the JS-side captured buffer.
                OutKind::Fd(fd) => fd
                    .captured
                    .map(|captured| interp.shells.captured_mut(captured)),
                // Quiet, or inside a cmd substitution.
                OutKind::Pipe => Some(interp.shells.buffered_mut(me.shell.id(), kind)),
            };
            if let Some(shell_buf) = shell_buf {
                shell_buf.append_slice(output);
            }
        }
        me.finish_if_done(this)
    }

    /// Called by `ShellSubprocess::on_process_exit`.
    pub(crate) fn on_exit(&mut self, this: NodeId, exit_code: ExitCode) -> Yield {
        log!("cmd exit code={}", exit_code);
        // Keep the errno a stdio error already recorded.
        if self.exit_code.is_none() {
            self.exit_code = Some(exit_code);
        }
        self.finish_if_done(this)
    }

    /// `Done` once the exit code and every piped stdio are in.
    pub(crate) fn finish_if_done(&mut self, this: NodeId) -> Yield {
        match &self.exec {
            Exec::Subproc(sub) if sub.all_closed() && self.exit_code.is_some() => {
                self.state = CmdState::Done;
                if sub.is_spawning {
                    return Yield::suspended();
                }
                Yield::Next(this)
            }
            _ => Yield::suspended(),
        }
    }
}

const STDIN_NO: usize = 0;
const STDOUT_NO: usize = 1;
const STDERR_NO: usize = 2;

/// True when argv0 is the literal word `export`, the only declaration
/// builtin the Bun shell has.
fn is_declaration_utility(argv0: &ast::Atom) -> bool {
    matches!(argv0, ast::Atom::Simple(ast::SimpleAtom::Text(t)) if **t == b"export"[..])
}

/// True when the word starts with a literal `NAME=` prefix where `NAME` is a
/// valid shell identifier. A name produced by an expansion does not count,
/// like in bash.
fn is_assignment_word(atom: &ast::Atom) -> bool {
    let first = match atom {
        ast::Atom::Simple(s) => s,
        ast::Atom::Compound(c) => match c.atoms.first() {
            Some(s) => s,
            None => return false,
        },
    };
    let ast::SimpleAtom::Text(text) = first else {
        return false;
    };
    let Some(eq) = bun_core::strings::index_of_char_usize(text, b'=') else {
        return false;
    };
    let name = &text[..eq];
    let Some(&head) = name.first() else {
        return false;
    };
    (head.is_ascii_alphabetic() || head == b'_')
        && name[1..]
            .iter()
            .all(|&b| b.is_ascii_alphanumeric() || b == b'_')
}

fn set_stdio_from_redirect(stdio: &mut [Stdio; 3], flags: ast::RedirectFlags, fd: bun_sys::Fd) {
    if flags.stdin() {
        stdio[0] = Stdio::Fd(fd);
    }
    if flags.duplicate_out() {
        stdio[1] = Stdio::Fd(fd);
        stdio[2] = Stdio::Fd(fd);
    } else {
        if flags.stdout() {
            stdio[1] = Stdio::Fd(fd);
        }
        if flags.stderr() {
            stdio[2] = Stdio::Fd(fd);
        }
    }
}
