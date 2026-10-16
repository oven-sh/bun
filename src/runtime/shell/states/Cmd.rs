//! A shell primarily runs commands, so this is the main state node.
//!
//! Execution proceeds: expand assigns → expand redirect → expand argv atoms
//! → apply the redirect → resolve to builtin or spawn subprocess → await exit.

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::builtin::{Builtin, Kind as BuiltinKind};
use crate::shell::interpreter::{
    Interpreter, Node, NodeId, ShellExecEnv, StateKind, is_pollable_from_mode, log, shell_openat,
};
use crate::shell::io::{ArrayBufSink, CmdIO, CmdIn, CmdOut, IO, JsObject, OutFd};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::shell_body::subproc::{Readable, ShellSubprocess, StdioKind};
use crate::shell::states::assigns::{AssignCtx, Assigns};
use crate::shell::states::base::Base;
use crate::shell::states::expansion::Expansion;
use crate::shell::subproc::{ShellIO, SpawnArgs};
use crate::shell::util::{OutKind, Stdio};
use crate::shell::yield_::Yield;
use crate::webcore::blob::store::Data as StoreData;
use crate::webcore::node_types::PathOrFileDescriptor;
use bun_collections::VecExt;
use bun_jsc::PinnedArrayBuffer;

pub(crate) struct Cmd {
    pub(crate) base: Base,
    pub node: bun_ptr::BackRef<ast::Cmd>,
    /// As inherited until `apply_redirect`, then with the redirect applied.
    pub(crate) io: CmdIO,
    pub(crate) state: CmdState,
    pub args: Vec<Vec<u8>>,
    pub(crate) redirection_file: Vec<u8>,
    pub(crate) exec: Exec,
    pub(crate) exit_code: Option<ExitCode>,
    /// `apply_redirect` gave the command the stderr in `io`.
    stderr_redirected: bool,
}

// `Node` is as large as its largest state, and this is it.
const _: () = assert!(size_of::<Cmd>() <= 176);

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
pub(crate) enum Exec {
    #[default]
    None,
    Builtin(Box<Builtin>),
    Subproc(Box<SubprocExec>),
}

/// Who uses the streams of a command.
#[derive(Clone, Copy)]
enum ExecForm {
    /// A builtin: this process reads and writes the streams.
    Builtin,
    /// A child process gets the streams, or the command has no name.
    Spawn,
}

/// The streams that a redirect gives a command. `None`: as inherited.
#[derive(Default)]
struct Redirected {
    stdin: Option<CmdIn>,
    stdout: Option<CmdOut>,
    stderr: Option<CmdOut>,
}

impl Redirected {
    /// `out` is the target of `>`, `2>` or `&>`.
    fn set_out(&mut self, streams: (bool, bool), out: CmdOut) {
        match streams {
            (true, true) => {
                self.stderr = Some(out.dup());
                self.stdout = Some(out);
            }
            (true, false) => self.stdout = Some(out),
            (false, true) => self.stderr = Some(out),
            (false, false) => {}
        }
    }
}

/// Why a redirect was not performed.
enum RedirectError {
    /// A JS error is thrown.
    Thrown,
    /// The message for the stderr that the command inherits.
    Message(Vec<u8>),
}

impl RedirectError {
    /// `target` did not open.
    fn open(e: &bun_sys::Error, target: &[u8]) -> RedirectError {
        use std::io::Write as _;
        let mut message = Vec::new();
        let _ = write!(
            &mut message,
            "bun: {}: {}",
            e.to_shell_system_error().message,
            bstr::BStr::new(target)
        );
        RedirectError::Message(message)
    }
}

/// Whether a redirect to a target is for stdout and for stderr.
///
/// A target after `2>&1` or `1>&2` comes from the parser reading the next
/// word as one. Each exec form keeps what it did with it: a child gets both
/// streams on the target, a builtin gets only the stream that the flags name.
fn out_streams(flags: ast::RedirectFlags, form: ExecForm) -> (bool, bool) {
    let both = matches!(form, ExecForm::Spawn) && flags.duplicate_out();
    (flags.stdout() || both, flags.stderr() || both)
}

impl Cmd {
    /// Borrow the AST node this `Cmd` was built from.
    ///
    /// `node` is a [`BackRef`](bun_ptr::BackRef) into the parsed-script arena,
    /// which is owned by the `Interpreter` and outlives every `Cmd` slot (the
    /// arena is dropped only in `Interpreter::deinit`).
    #[inline]
    pub(crate) fn ast_node(&self) -> &ast::Cmd {
        self.node.get()
    }
}

pub(crate) struct SubprocExec {
    pub(crate) child: *mut ShellSubprocess,
    pub(crate) buffered_closed: BufferedIoClosed,
    /// NodeId-arena backrefs so the legacy `&mut self` subprocess callbacks
    /// (`buffered_output_close` / `on_exit`) can hand a [`Yield`] back to the
    /// trampoline. The `Cmd` lives inside `interp.nodes`, so we stash the
    /// indices and
    /// return `Yield::Next(this_id)` for the caller (`PipeReader::run_yield`)
    /// to drive.
    pub(crate) interp: *mut Interpreter,
    pub(crate) this_id: NodeId,
}

/// Tracks which subprocess stdio pipes are still open. Each `Option` is `None`
/// if that fd was *not* piped (e.g. inherited / fd-backed), so it never gates
/// completion. `Some(state)` means it was piped and must reach `Closed` before
/// [`Cmd::has_finished`] returns true.
#[derive(Default)]
pub(crate) struct BufferedIoClosed {
    pub(crate) stdin: Option<bool>,
    pub(crate) stdout: Option<BufferedIoState>,
    pub(crate) stderr: Option<BufferedIoState>,
}

#[derive(Default)]
pub(crate) enum BufferedIoState {
    #[default]
    Open,
    Closed(Vec<u8>),
}

impl BufferedIoState {
    #[inline]
    fn closed(&self) -> bool {
        matches!(self, BufferedIoState::Closed(_))
    }
}

impl Drop for BufferedIoState {
    fn drop(&mut self) {
        // Spec `BufferedIoState.deinit`: the closed buffer was taken via
        // `PipeReader.take_buffer()`; we own it regardless of the original
        // stdio variant. `Vec<u8>`'s own Drop frees the storage.
        if let BufferedIoState::Closed(list) = self {
            list.clear_and_free();
        }
    }
}

impl BufferedIoClosed {
    /// Build the per-fd closed/buffering state from the command's `Stdio` triple.
    fn from_stdio(io: &[Stdio; 3]) -> Self {
        const STDIN_NO: usize = 0;
        const STDOUT_NO: usize = 1;
        const STDERR_NO: usize = 2;
        Self {
            stdin: if io[STDIN_NO].is_piped() {
                Some(false)
            } else {
                None
            },
            stdout: if io[STDOUT_NO].is_piped() {
                Some(BufferedIoState::Open)
            } else {
                None
            },
            stderr: if io[STDERR_NO].is_piped() {
                Some(BufferedIoState::Open)
            } else {
                None
            },
        }
    }

    /// True once stdin, stdout, and stderr have all been closed.
    fn all_closed(&self) -> bool {
        let stdin_closed = self.stdin.unwrap_or(true);
        let stdout_closed = self.stdout.as_ref().is_none_or(BufferedIoState::closed);
        let stderr_closed = self.stderr.as_ref().is_none_or(BufferedIoState::closed);
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

    /// Mark stdin closed.
    fn close_stdin(&mut self) {
        self.stdin = Some(true);
    }

    /// Close the stdout/stderr side.
    ///
    /// `readable` is the subprocess's `stdout`/`stderr` `Readable`; if it was
    /// a pipe its buffered bytes are taken (ownership moves into
    /// `state.Closed`) and also copied to `capture`, the buffer that holds
    /// the captured output of the stream (`CmdOut::capture_buf`).
    fn close_out(
        slot: &mut Option<BufferedIoState>,
        readable: &mut Readable,
        capture: Option<*mut Vec<u8>>,
    ) {
        let Some(state) = slot.as_mut() else { return };
        let Readable::Pipe(pipe) = readable else {
            // Not a pipe: nothing to capture. Mark closed with an empty
            // buffer so `all_closed()` is satisfied.
            *state = BufferedIoState::Closed(Vec::<u8>::default());
            return;
        };
        if let Some(capture) = capture {
            let the_slice = pipe.slice();
            // SAFETY: `capture` points into `ShellExecEnv::_buffered_*`,
            // which the owning Cmd's `base.shell` (or an env above it) keeps
            // live for the duration of the command. Single-threaded.
            unsafe { (*capture).append_slice(the_slice) };
        }
        // SAFETY: `Arc<PipeReader>` interior mutability — the shell is
        // single-threaded and this is the same pattern `subproc::on_close_io`
        // uses to take the done buffer.
        let buffer = unsafe { &mut *(std::sync::Arc::as_ptr(pipe).cast_mut()) }.take_buffer();
        *state = BufferedIoState::Closed(Vec::<u8>::move_from_list(buffer));
    }
}

impl Cmd {
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::Cmd,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Cmd(Cmd {
            base: Base::new(parent, shell),
            node: bun_ptr::BackRef::new(node),
            io: io.into(),
            state: CmdState::Idle,
            args: Vec::new(),
            redirection_file: Vec::new(),
            exec: Exec::None,
            exit_code: None,
            stderr_redirected: false,
        }))
    }

    pub(crate) fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub(crate) fn next(interp: &Interpreter, this: NodeId) -> Yield {
        loop {
            let (shell, node) = {
                let me = interp.as_cmd(this);
                (me.base.shell, me.node)
            };
            let n = node.get();
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
                            let atom: *const ast::Atom = atom;
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
                    let atom: *const ast::Atom = &raw const args[idx as usize];
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
    /// `WaitingWriteErr`: finish the Cmd with exit code 1. A write to the
    /// inherited stderr that failed is thrown. A write to the stderr that the
    /// redirect gave the command is not: like the output of a builtin, the
    /// message is lost and the script goes on.
    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        this: NodeId,
        _written: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(err) = e
            && !interp.as_cmd(this).stderr_redirected
        {
            interp.throw(crate::shell::ShellErr::from_system(err));
            return Yield::Failed(this);
        }
        debug_assert!(matches!(
            interp.as_cmd(this).state,
            CmdState::WaitingWriteErr
        ));
        let parent = interp.as_cmd(this).base.parent;
        interp.child_done(parent, this, 1)
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
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
                        let n = interp.as_cmd(this).ast_node();
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
                    // empty so the ambiguous-redirect check in `apply_redirect` fires.
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

    /// Applies the redirect, then resolves argv[0] to a builtin or falls
    /// through to subprocess spawn (still gated).
    fn transition_to_exec(interp: &Interpreter, this: NodeId) -> Yield {
        // NUL-terminate every arg so builtins can borrow them as `*const c_char`.
        for a in &mut interp.as_cmd_mut(this).args {
            if a.last() != Some(&0) {
                a.push(0);
            }
        }

        let me = interp.as_cmd(this);
        let node = me.node;
        // Empty/null argv[0] → no command name.
        let first_arg: Option<Vec<u8>> = match me.args.first() {
            // strip the trailing NUL we just added
            Some(a) if a.len() > 1 => Some(a[..a.len() - 1].to_vec()),
            _ => None,
        };
        let builtin = first_arg.as_deref().and_then(BuiltinKind::from_argv0);

        // The redirect comes before the search for the command (POSIX 2.9.1).
        // So every exit below has the redirected streams, and a redirect that
        // fails is the only thing the command reports.
        let form = match builtin {
            Some(_) => ExecForm::Builtin,
            None => ExecForm::Spawn,
        };
        if let Some(y) = Self::apply_redirect(interp, this, node.get(), form) {
            return y;
        }

        let Some(first_arg) = first_arg else {
            // Exit with the exit code from a sole command-substitution
            // (stashed by `child_done` from `Expansion::out_exit_code`), else 0.
            let me = interp.as_cmd(this);
            let exit = me.exit_code.unwrap_or(0);
            let parent = me.base.parent;
            return interp.child_done(parent, this, exit);
        };

        if let Some(kind) = builtin {
            log!("Cmd {} exec builtin={:?}", this, kind);
            Builtin::init(interp, this, kind);
            return Builtin::start(interp, this);
        }

        // ── Subprocess path ─────────────────────────────────────────────────
        // `SpawnArgs` borrows only the local `arena` (its
        // `interp`/`argv` fields are raw pointers), so `interp: &mut
        // Interpreter` is freely re-borrowable at every step before
        // `spawn_async`. Re-enter the arena via `interp.as_cmd{,_mut}(this)`
        // for each short-lived access instead of caching raw `*mut Cmd`.
        let event_loop = interp.event_loop;

        let arena = bun_alloc::Arena::new();
        let mut spawn_args = SpawnArgs::default::<false>(&arena, interp.as_ctx_ptr(), event_loop);
        // Cache the raw `*mut ShellExecEnv` and deref it directly so the
        // `cwd: &[u8]` stored in `spawn_args` is decoupled from any borrow of
        // `*interp` — `Base::shell()` would tie the slice's lifetime to
        // `&interp`, blocking every `interp.as_cmd_mut(...)` below for the
        // life of `spawn_args`. The env is a separate heap allocation that
        // outlives this Cmd, so the slice remains valid across reborrows.
        let shell_ptr: *mut ShellExecEnv = interp.as_cmd(this).base.shell;
        // SAFETY: `shell_ptr` is the live env owned by this Cmd's scope chain.
        spawn_args.cwd = unsafe { &*shell_ptr }.cwd();

        // Fill env from export_env + cmd_local_env.
        {
            let env = interp.as_cmd_mut(this).base.shell_mut();
            let mut iter = env.export_env.iterator();
            spawn_args.fill_env::<false>(&mut iter);
            let mut iter = env.cmd_local_env.iterator();
            spawn_args.fill_env::<false>(&mut iter);
        }

        // Resolve argv[0] via PATH (`bun_which::which`).
        let resolved: Option<Vec<u8>> = {
            let mut path_buf = bun_paths::path_buffer_pool::get();
            match bun_which::which(&mut *path_buf, spawn_args.path, spawn_args.cwd, &first_arg) {
                Some(z) => Some(z.as_bytes().to_vec()),
                None if &first_arg[..] == b"bun" || &first_arg[..] == b"bun-debug" => {
                    bun_core::self_exe_path()
                        .ok()
                        .map(|z| z.as_bytes().to_vec())
                }
                None => None,
            }
        };
        let Some(mut resolved) = resolved else {
            // writeFailingError("bun: command not found: {s}\n") →
            // `.waiting_write_err` → onIOWriterChunk → `parent.childDone(this, 1)`.
            drop(spawn_args);
            return Builtin::cmd_write_failing_error(
                interp,
                this,
                format_args!("bun: command not found: {}\n", bstr::BStr::new(&first_arg)),
            );
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
                drop(spawn_args);
                return Builtin::cmd_write_failing_error(
                    interp,
                    this,
                    format_args!(
                        "bun: refusing to pass argument with cmd.exe special characters to a batch file: {}\n",
                        bstr::BStr::new(&arg)
                    ),
                );
            }
        }
        // Replace argv[0] with the resolved absolute path (NUL-terminated for
        // `execve`).
        resolved.push(0);
        interp.as_cmd_mut(this).args[0] = resolved;

        // Convert the command's streams → subprocess stdio.
        let mut shellio = ShellIO::default();
        if interp
            .as_cmd(this)
            .io
            .to_subproc_stdio(
                interp,
                &mut spawn_args.stdio,
                &mut shellio,
                &mut spawn_args.redirect_stdout,
                &mut spawn_args.redirect_stderr,
            )
            .is_err()
        {
            drop(spawn_args);
            drop(arena);
            return Yield::Failed(this);
        }

        // Stage the exec slot *before* spawning so PipeReader / process-exit
        // callbacks (which deref `cmd_parent.exec`) see a populated `Subproc`
        // with the correct `child` once `spawn_async` writes through
        // `out_subproc`. `interp` is left null until `spawn_async` and the
        // `did_exit_immediately` handling have returned: a synchronous
        // `Cmd::on_exit` (process exit handler) or `Cmd::buffered_output_close`
        // (an eager `read_all` on a pipe erroring inside the spawn) would
        // otherwise drive the trampoline (`Yield::run(&*interp)`) while this
        // frame still holds `&Interpreter`, tearing the Cmd down (and freeing
        // `child`) underneath the live `subproc` borrow. With `interp` null,
        // both record `exit_code`/`state = Done` and return; we resume via
        // the Yield we hand back below.
        let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
        let buffered_closed = BufferedIoClosed::from_stdio(&spawn_args.stdio);
        interp.as_cmd_mut(this).exec = Exec::Subproc(Box::new(SubprocExec {
            child: core::ptr::null_mut(),
            buffered_closed,
            interp: core::ptr::null_mut(),
            this_id: this,
        }));

        // Derive the raw backrefs `spawn_async` needs from a single
        // short-lived `&mut Cmd` borrow, then let it end before the call so no
        // `&Interpreter` is live across the re-entrant spawn. `child_out`
        // points into the `Box<SubprocExec>` heap allocation, which is
        // address-stable for the lifetime of the Cmd (only dropped in
        // `deinit`). argv pointers borrow `cmd.args[i]` storage, which is not
        // reallocated between here and `spawn_process`.
        //
        // `cmd_parent` is `(interp, NodeId)` rather than the spec's `*ShellCmd`
        // — the Cmd lives inline in `interp.nodes: Vec<Node>`, and a raw
        // `*mut Cmd` would dangle on the next `alloc_node` reallocation.
        let child_out: *mut *mut ShellSubprocess = {
            let cmd = interp.as_cmd_mut(this);
            spawn_args.argv.reserve_exact(cmd.args.len() + 1);
            for arg in &cmd.args {
                debug_assert_eq!(arg.last(), Some(&0));
                spawn_args.argv.push(arg.as_ptr().cast());
            }
            spawn_args.argv.push(core::ptr::null());
            match &mut cmd.exec {
                Exec::Subproc(sub) => core::ptr::addr_of_mut!(sub.child),
                _ => unreachable!(),
            }
        };
        let cmd_parent = crate::shell::subproc::CmdHandle {
            // SAFETY: `interp_ptr` is the live owning Interpreter (from
            // `&mut Interpreter` above); single-threaded, write provenance.
            interp: unsafe { bun_ptr::ParentRef::from_raw_mut(interp_ptr) },
            id: this,
        };

        let mut did_exit_immediately = false;
        // `spawn_async` is re-entrant: `watch()`/`read_all()` may fire
        // `on_process_exit` / `buffered_output_close` which reach back into
        // `interp` via the raw backrefs on `SubprocExec`. By NLL the `interp`
        // borrow above is dead here, so those callbacks do not alias a live
        // `&mut`.
        let spawn_result = ShellSubprocess::spawn_async(
            event_loop,
            &mut shellio,
            spawn_args,
            cmd_parent,
            child_out,
            &mut did_exit_immediately,
        );
        drop(shellio);

        if let Err(e) = spawn_result {
            drop(arena);
            // Revert exec so `deinit` doesn't free a null `child`.
            interp.as_cmd_mut(this).exec = Exec::None;
            return Builtin::cmd_write_failing_error(interp, this, format_args!("{}\n", e));
        }

        // Read the subprocess back via the arena instead of holding `child_out`
        // across the call.
        let child: *mut ShellSubprocess = match &interp.as_cmd(this).exec {
            Exec::Subproc(sub) => sub.child,
            _ => unreachable!(),
        };
        // SAFETY: `spawn_async` Ok ⇒ wrote a live `heap::alloc` subprocess
        // pointer into `*child_out` (== `sub.child`); valid until `Cmd::deinit`
        // reclaims the box. Single-threaded.
        let subproc = unsafe { &mut *child };
        subproc.r#ref();
        drop(arena);

        if did_exit_immediately {
            // `watch()` failed → process already gone.
            let process = subproc.proc();
            if process.has_exited() {
                let status = process.status.clone();
                process.on_exit(status, &crate::api::bun::process::rusage_zeroed());
            } else {
                process.wait(false);
            }
        }

        // Publish the interpreter backref now that all synchronous spawn-time
        // callbacks have returned, so subsequent async pipe-close /
        // process-exit notifications can drive the trampoline themselves. If a
        // synchronous callback already finished the command (`state = Done`),
        // resume here instead — the callback couldn't, with `interp` null.
        let me = interp.as_cmd_mut(this);
        if let Exec::Subproc(exec) = &mut me.exec {
            exec.interp = interp_ptr;
        }
        if matches!(me.state, CmdState::Done) {
            return Yield::Next(this);
        }
        Yield::suspended()
    }

    /// Performs the redirect of the command (`> file`, `< ${blob}`, `2>&1`, …)
    /// on its `io`. Every user of the streams comes after it: a builtin, the
    /// spawn of a child process, and the shell's message about a command that
    /// does not start.
    ///
    /// `Some`: the redirect failed. `io` is as inherited, and the yield
    /// finishes the command: the message is queued on the inherited stderr,
    /// or a JS error is thrown.
    fn apply_redirect(
        interp: &Interpreter,
        this: NodeId,
        node: &ast::Cmd,
        form: ExecForm,
    ) -> Option<Yield> {
        let flags = node.redirect;
        let redirected = match &node.redirect_file {
            None if !flags.duplicate_out() => return None,
            None => {
                let io = &interp.as_cmd(this).io;
                let mut redirected = Redirected::default();
                // The lexer keeps the stream that both become: `2>&1` is
                // `STDOUT`, `1>&2` is `STDERR`.
                if flags.stdout() {
                    redirected.stderr = Some(io.stdout.dup());
                }
                if flags.stderr() {
                    redirected.stdout = Some(io.stderr.dup());
                }
                Ok(redirected)
            }
            Some(ast::Redirect::Atom(_)) => {
                // `child_done` NUL-terminated the one word the target expanded to.
                let path = core::mem::take(&mut interp.as_cmd_mut(this).redirection_file);
                match path.len().checked_sub(1) {
                    Some(len) => Self::redirect_to_path(
                        interp,
                        this,
                        form,
                        bun_core::ZStr::from_buf(&path, len),
                    ),
                    None => Err(Self::ambiguous_redirect(interp, this)),
                }
            }
            Some(ast::Redirect::JsBuf(js)) => {
                Self::redirect_to_js_object(interp, this, form, js.idx)
            }
        };
        let redirected = match redirected {
            Ok(redirected) => redirected,
            Err(RedirectError::Thrown) => return Some(Yield::Failed(this)),
            Err(RedirectError::Message(message)) => {
                return Some(Builtin::cmd_write_failing_error(
                    interp,
                    this,
                    format_args!("{}", bstr::BStr::new(&message)),
                ));
            }
        };
        let me = interp.as_cmd_mut(this);
        if let Some(stdin) = redirected.stdin {
            me.io.stdin = stdin;
        }
        if let Some(stdout) = redirected.stdout {
            me.io.stdout = stdout;
        }
        if let Some(stderr) = redirected.stderr {
            me.io.stderr = stderr;
            me.stderr_redirected = true;
        }
        None
    }

    /// The target of the redirect expanded to no word, or to more than one.
    fn ambiguous_redirect(interp: &Interpreter, this: NodeId) -> RedirectError {
        use std::io::Write as _;
        let mut message = Vec::new();
        let _ = match interp.as_cmd(this).args.first() {
            // NUL-terminated by `transition_to_exec`.
            Some(argv0) => writeln!(
                &mut message,
                "bun: ambiguous redirect: at `{}`",
                bstr::BStr::new(&argv0[..argv0.len() - 1])
            ),
            None => writeln!(&mut message, "bun: ambiguous redirect"),
        };
        RedirectError::Message(message)
    }

    /// The redirect names a file by its path: open it. A builtin reads it
    /// through an `IOReader` and writes it through an `IOWriter`. A child
    /// process gets the fd.
    fn redirect_to_path(
        interp: &Interpreter,
        this: NodeId,
        form: ExecForm,
        path: &bun_core::ZStr,
    ) -> Result<Redirected, RedirectError> {
        let me = interp.as_cmd(this);
        let flags = me.ast_node().redirect;
        let cwd_fd = me.base.shell().cwd_fd;
        let streams = out_streams(flags, form);
        let mut redirected = Redirected::default();
        let opened = match form {
            ExecForm::Builtin if flags.stdin() => {
                shell_openat(cwd_fd, path, flags.to_flags(), 0o666).map(|fd| {
                    let reader = IOReader::init(fd, interp.event_loop);
                    reader.set_interp(interp.as_ctx_ptr());
                    redirected.stdin = Some(CmdIn::Fd(reader));
                })
            }
            ExecForm::Builtin => Self::open_writer(interp, cwd_fd, &path, flags.to_flags())
                .map(|out| redirected.set_out(streams, out)),
            ExecForm::Spawn => shell_openat(cwd_fd, path, flags.to_flags(), 0o666).map(|fd| {
                let file = bun_sys::File::from_fd(fd);
                if flags.stdin() {
                    redirected.stdin = Some(CmdIn::File(file));
                } else {
                    redirected.set_out(streams, CmdOut::File(file));
                }
            }),
        };
        match opened {
            Ok(()) => Ok(redirected),
            Err(e) => Err(RedirectError::open(&e, path.as_bytes())),
        }
    }

    /// Opens `target`, a path or an fd, for a builtin to write to.
    fn open_writer<P: bun_io::open_for_writing_mod::OpenForWritingInput>(
        interp: &Interpreter,
        cwd_fd: bun_sys::Fd,
        target: &P,
        flags: i32,
    ) -> bun_sys::Result<CmdOut> {
        let mut pollable = false;
        let mut is_socket = false;
        let mut is_nonblocking = false;
        let fd = bun_io::open_for_writing_impl(
            cwd_fd,
            target,
            flags,
            0o666,
            &mut pollable,
            &mut is_socket,
            false,
            &mut is_nonblocking,
            (),
            |_| {},
            is_pollable_from_mode,
            shell_openat,
        )?;
        #[cfg(windows)]
        let fd = {
            use bun_sys::FdExt as _;
            fd.make_lib_uv_owned_for_syscall(bun_sys::Tag::open, bun_sys::ErrorCase::CloseOnFail)?
        };
        // Honor the `pollable` computed by `open_for_writing_impl` on
        // POSIX so a FIFO/socket target (whose fd is now O_NONBLOCK)
        // takes the pollable path; Windows keeps the async writer.
        let writer = IOWriter::init(
            fd,
            io_writer::Flags {
                pollable: if cfg!(windows) { true } else { pollable },
                nonblock: is_nonblocking,
                is_socket,
                ..Default::default()
            },
            interp.event_loop,
        );
        writer.set_interp(interp.as_ctx_ptr());
        Ok(CmdOut::Fd(OutFd {
            writer,
            captured: None,
        }))
    }

    /// The redirect names a JS object: `> ${object}` or `< ${object}`.
    fn redirect_to_js_object(
        interp: &Interpreter,
        this: NodeId,
        form: ExecForm,
        idx: u32,
    ) -> Result<Redirected, RedirectError> {
        let Some((global, value)) = interp.js_object(idx) else {
            interp.throw(crate::shell::ShellErr::Custom(
                b"Invalid JS object reference in shell"
                    .to_vec()
                    .into_boxed_slice(),
            ));
            return Err(RedirectError::Thrown);
        };
        let Some(object) = JsObject::from_value(value) else {
            let _ = global.throw(format_args!(
                "Unknown JS value used in shell: {}",
                value.fmt_string(global)
            ));
            return Err(RedirectError::Thrown);
        };
        let flags = interp.as_cmd(this).ast_node().redirect;
        let streams = out_streams(flags, form);
        let mut redirected = Redirected::default();
        // `None` is out of memory.
        let pin = || {
            let buf = PinnedArrayBuffer::root(global, value);
            if buf.is_none() {
                let _ = global.throw_out_of_memory();
            }
            buf.ok_or(RedirectError::Thrown)
        };

        if flags.stdin() {
            redirected.stdin = Some(match (form, object) {
                // The spawn reads the object.
                (ExecForm::Spawn, _) => CmdIn::Js(idx),
                (ExecForm::Builtin, JsObject::ArrayBuffer(_)) => CmdIn::ArrayBuf(Box::new(pin()?)),
                (ExecForm::Builtin, JsObject::Blob(blob)) => CmdIn::Blob(Box::new(blob.dupe())),
                (ExecForm::Builtin, JsObject::Response(response)) => {
                    CmdIn::Blob(Box::new(response.get_body_value().use_()))
                }
            });
            return Ok(redirected);
        }

        // Output to a Blob, or to the body of a Response, goes to the file it is.
        let file = match object {
            JsObject::ArrayBuffer(_) => {
                match form {
                    ExecForm::Spawn => redirected.set_out(streams, CmdOut::JsBuf(idx)),
                    ExecForm::Builtin => {
                        // Each stream pins the buffer for itself and has its own offset.
                        if streams.0 {
                            let sink = ArrayBufSink { buf: pin()?, i: 0 };
                            redirected.stdout = Some(CmdOut::ArrayBuf(Box::new(sink)));
                        }
                        if streams.1 {
                            let sink = ArrayBufSink { buf: pin()?, i: 0 };
                            redirected.stderr = Some(CmdOut::ArrayBuf(Box::new(sink)));
                        }
                    }
                }
                return Ok(redirected);
            }
            JsObject::Blob(blob) => blob_file(blob),
            JsObject::Response(response) => {
                let body = response.get_body_value();
                body.to_blob_if_possible();
                match body.use_as_any_blob() {
                    crate::webcore::blob::Any::Blob(blob) => blob_file(&blob),
                    _ => None,
                }
            }
        };
        match file {
            Some(BlobFile::Fd(fd)) => {
                let out = match form {
                    // The builtin writes to a copy of the fd. The caller keeps its own.
                    ExecForm::Builtin => {
                        let cwd_fd = interp.as_cmd(this).base.shell().cwd_fd;
                        let target = bun_io::PathOrFileDescriptor::Fd(fd);
                        match Self::open_writer(interp, cwd_fd, &target, flags.to_flags()) {
                            Ok(out) => out,
                            Err(e) => return Err(RedirectError::open(&e, b"Bun.file(fd)")),
                        }
                    }
                    ExecForm::Spawn => CmdOut::BorrowedFd(fd),
                };
                redirected.set_out(streams, out);
                Ok(redirected)
            }
            Some(BlobFile::Path(mut path)) => {
                let len = path.len();
                path.push(0);
                Self::redirect_to_path(interp, this, form, bun_core::ZStr::from_buf(&path, len))
            }
            None => {
                let _ = match form {
                    ExecForm::Builtin => global.throw(format_args!(
                        "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                    )),
                    ExecForm::Spawn => global.throw_invalid_arguments(format_args!(
                        "Blobs are immutable, and cannot be used for stdout/stderr"
                    )),
                };
                Err(RedirectError::Thrown)
            }
        }
    }

    /// Called by `Builtin::done` / subprocess exit handler.
    pub(crate) fn on_exec_done(interp: &Interpreter, this: NodeId, exit_code: ExitCode) -> Yield {
        log!("Cmd {} execDone exit={}", this, exit_code);
        {
            let me = interp.as_cmd_mut(this);
            me.exit_code = Some(exit_code);
            me.state = CmdState::Done;
        }
        Yield::Next(this)
    }

    /// [`Self::deinit`] for the VM-shutdown finalizer: defuses the
    /// `> ${arraybuffer}` unpins first — the heap sweep already deleted the
    /// `JSC::ArrayBuffer` impls they would write to.
    #[cfg(not(windows))]
    pub(crate) fn deinit_from_finalizer(interp: &Interpreter, this: NodeId) {
        {
            let me = interp.as_cmd_mut(this);
            me.io.defuse_array_buf_pins();
            if let Exec::Subproc(sub) = &me.exec
                && !sub.child.is_null()
            {
                // SAFETY: `child` is the live heap::alloc'd subprocess;
                // the call only writes its own fields.
                unsafe { ShellSubprocess::defuse_array_buffer_unpins(sub.child) };
            }
        }
        Self::deinit(interp, this);
    }

    /// The script failed: stop the subprocess. Its exit finishes the Cmd through `on_exit`.
    pub(crate) fn kill_subprocess(interp: &Interpreter, this: NodeId) {
        let Exec::Subproc(sub) = &interp.as_cmd(this).exec else {
            return;
        };
        if sub.child.is_null() {
            return;
        }
        // SAFETY: `child` was set by `spawn_async` from a
        // `heap::alloc(ShellSubprocess)` and stays valid until `deinit`
        // reclaims the box. Single-threaded.
        let _ = unsafe { (*sub.child).try_kill(bun_core::SignalCode::SIGKILL as i32) };
    }

    pub(crate) fn deinit(interp: &Interpreter, this: NodeId) {
        log!("Cmd {} deinit", this);
        let exec = {
            let me = interp.as_cmd_mut(this);
            me.args.clear();
            me.redirection_file.clear();
            core::mem::take(&mut me.exec)
        };
        // `me`'s borrow ended above: the teardown below re-enters this Cmd
        // via stdin `on_stdin_writer_close` → `buffered_input_close` (a no-op once
        // `exec` is taken).
        match exec {
            Exec::None => {}
            Exec::Builtin(b) => drop(b),
            Exec::Subproc(sub) if !sub.child.is_null() => {
                // SAFETY: `child` was set by `spawn_async` from a
                // `heap::alloc(ShellSubprocess)` and stays valid until this
                // drop. Single-threaded. Reclaiming the box runs
                // `ShellSubprocess::drop` → `finalize_sync` (closes stdio).
                unsafe {
                    let child = sub.child;
                    if !(*child).has_exited() {
                        let _ = (*child).try_kill(9);
                    }
                    (*child).unref::<true>();
                    // Stop any still-active stdio before the drop (only the
                    // VM-shutdown path reaches here in flight).
                    #[cfg(not(windows))]
                    ShellSubprocess::deinit_in_flight_io(child);
                    drop(bun_core::heap::take(child));
                }
                // `sub.buffered_closed` drops here, freeing any captured
                // `Vec<u8>`s (spec `buffered_closed.deinit()`).
            }
            // `Exec::Subproc` with null `child`: spawn failed before the
            // subprocess box was returned. Nothing to tear down.
            Exec::Subproc(_) => {}
        }
        // Argv/env are heap-owned `Vec`s; there is no spawn arena to free.
        // `base.shell` is borrowed (or, when parent is Pipeline, freed by
        // `Pipeline::child_done` before this runs) — never freed here.
    }

    // ── Subprocess callbacks (legacy `*Cmd` backref shape) ────────────────
    // `ShellSubprocess` / `PipeReader` hold a `*mut Cmd` backref and call
    // these via `&mut self`. The NodeId-arena port stashes `(interp, this_id)`
    // on `SubprocExec` so the resulting `Yield` can be driven by the caller's
    // `PipeReader::run_yield` without aliasing `&Interpreter` against
    // `&mut self`.

    /// True once the command has both an exit code and (for subprocesses)
    /// all buffered stdio closed.
    pub(crate) fn has_finished(&self) -> bool {
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

    /// Mark the subprocess's buffered stdin as closed.
    pub(crate) fn buffered_input_close(&mut self) -> Yield {
        let Exec::Subproc(sub) = &mut self.exec else {
            return Yield::suspended();
        };
        sub.buffered_closed.close_stdin();
        self.finish_if_done()
    }

    /// Mark the subprocess's buffered stdout/stderr as closed (flushing the
    /// captured bytes into the shell buffers).
    pub(crate) fn buffered_output_close(
        &mut self,
        kind: OutKind,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        debug_assert!(matches!(self.exec, Exec::Subproc(_)));
        log!(
            "cmd close buffered {}",
            match kind {
                OutKind::Stdout => "stdout",
                OutKind::Stderr => "stderr",
            }
        );
        if let Some(e) = err {
            self.exit_code = Some(e.errno.unsigned_abs() as ExitCode);
        }
        if let Exec::Subproc(sub) = &mut self.exec {
            // Raw deref keeps the borrow disjoint from `sub.buffered_closed` below.
            // SAFETY: `child` is the live subprocess owned by this Cmd.
            let child = unsafe { &mut *sub.child };
            let (out, slot, readable, stdio) = match kind {
                OutKind::Stdout => (
                    &self.io.stdout,
                    &mut sub.buffered_closed.stdout,
                    &mut child.stdout,
                    StdioKind::Stdout,
                ),
                OutKind::Stderr => (
                    &self.io.stderr,
                    &mut sub.buffered_closed.stderr,
                    &mut child.stderr,
                    StdioKind::Stderr,
                ),
            };
            // The stream the command has says where its output is captured:
            // the JS-side buffer, or the buffer of the shell env.
            BufferedIoClosed::close_out(slot, readable, out.capture_buf(self.base.shell_mut()));
            child.close_io(stdio);
        }
        self.finish_if_done()
    }

    /// Called by `ShellSubprocess::on_process_exit`.
    pub(crate) fn on_exit(&mut self, exit_code: ExitCode) -> Yield {
        log!("cmd exit code={}", exit_code);
        // Keep the errno a stdio error already recorded.
        if self.exit_code.is_none() {
            self.exit_code = Some(exit_code);
        }
        self.finish_if_done()
    }

    /// `Done` once the exit code and every piped stdio are in; the caller runs
    /// the Yield.
    fn finish_if_done(&mut self) -> Yield {
        if matches!(self.state, CmdState::Done) || !self.has_finished() {
            return Yield::suspended();
        }
        self.state = CmdState::Done;
        let (interp, this_id) = match &self.exec {
            Exec::Subproc(sub) => (sub.interp, sub.this_id),
            // Builtins finish through `Builtin::done`.
            _ => return Yield::suspended(),
        };
        // Still inside the spawn; `transition_to_exec` resumes from `state`.
        if interp.is_null() {
            return Yield::suspended();
        }
        Yield::Next(this_id)
    }
}

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

/// The file that a Blob is: `Bun.file(fd)`, or a path.
enum BlobFile {
    Fd(bun_sys::Fd),
    Path(Vec<u8>),
}

/// `None`: the Blob holds its bytes in memory.
fn blob_file(blob: &crate::webcore::Blob) -> Option<BlobFile> {
    let StoreData::File(file) = &blob.store()?.data else {
        return None;
    };
    Some(match &file.pathlike {
        PathOrFileDescriptor::Fd(fd) => BlobFile::Fd(*fd),
        PathOrFileDescriptor::Path(path) => BlobFile::Path(path.slice().to_vec()),
    })
}
