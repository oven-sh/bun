//! A shell primarily runs commands, so this is the main state node.
//!
//! Execution proceeds: expand assigns → expand redirect → expand argv atoms
//! → resolve to builtin or spawn subprocess → await exit.

use bun_ptr::AsCtxPtr;

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::builtin::{Builtin, Kind as BuiltinKind};
use crate::shell::interpreter::{CowFd, Interpreter, Node, NodeId, ShellExecEnv, StateKind, log};
use crate::shell::io::{IO, OutKind as IoOutKind};
use crate::shell::shell_body::subproc::{Readable, ShellSubprocess, StdioKind};
use crate::shell::states::assigns::{AssignCtx, Assigns};
use crate::shell::states::base::Base;
use crate::shell::states::expansion::{Expansion, ExpansionOpts};
use crate::shell::subproc::{ShellIO, SpawnArgs};
use crate::shell::util::{OutKind, Stdio};
use crate::shell::yield_::Yield;
use bun_collections::{ByteVecExt, VecExt};

pub struct Cmd {
    pub base: Base,
    pub node: bun_ptr::BackRef<ast::Cmd>,
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

pub enum Exec {
    None,
    Builtin(Box<Builtin>),
    Subproc(Box<SubprocExec>),
}

impl Default for Exec {
    fn default() -> Self {
        Exec::None
    }
}

impl Cmd {
    /// Borrow the AST node this `Cmd` was built from.
    ///
    /// `node` is a [`BackRef`](bun_ptr::BackRef) into the parsed-script arena,
    /// which is owned by the `Interpreter` and outlives every `Cmd` slot (the
    /// arena is dropped only in `Interpreter::deinit`).
    #[inline]
    pub fn ast_node(&self) -> &ast::Cmd {
        self.node.get()
    }
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
    Closed(Vec<u8>),
}

impl BufferedIoState {
    #[inline]
    pub fn closed(&self) -> bool {
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
    /// Spec: `BufferedIoClosed.fromStdio`.
    pub fn from_stdio(io: &[Stdio; 3]) -> Self {
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
        shell_buf: *mut Vec<u8>,
    ) {
        let Some(state) = slot.as_mut() else { return };
        let Readable::Pipe(pipe) = readable else {
            // Not a pipe: nothing to capture. Mark closed with an empty
            // buffer so `all_closed()` is satisfied.
            *state = BufferedIoState::Closed(Vec::<u8>::default());
            return;
        };
        // If the shell state is piped (inside a cmd substitution) aggregate
        // the output of this command.
        if io_is_pipe && !redirects_elsewhere && !shell_buf.is_null() {
            let the_slice = pipe.slice();
            // SAFETY: `shell_buf` points into `ShellExecEnv::_buffered_*`,
            // which the owning Cmd's `base.shell` keeps live for the duration
            // of the command. Single-threaded.
            unsafe { (*shell_buf).append_slice(the_slice) };
        }
        // SAFETY: `Arc<PipeReader>` interior mutability — the shell is
        // single-threaded and this is the same pattern `subproc::on_close_io`
        // uses to take the done buffer.
        let buffer = unsafe { &mut *(std::sync::Arc::as_ptr(pipe).cast_mut()) }.take_buffer();
        *state = BufferedIoState::Closed(Vec::<u8>::move_from_list(buffer));
    }
}

impl Cmd {
    pub fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
        node: &ast::Cmd,
        parent: NodeId,
        io: IO,
    ) -> NodeId {
        interp.alloc_node(Node::Cmd(Cmd {
            base: Base::new(StateKind::Cmd, parent, shell),
            node: bun_ptr::BackRef::new(node),
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

    pub fn start(_interp: &Interpreter, this: NodeId) -> Yield {
        Yield::Next(this)
    }

    pub fn next(interp: &Interpreter, this: NodeId) -> Yield {
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
                                ExpansionOpts {
                                    for_spawn: false,
                                    single: true,
                                },
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
                    let atom: *const ast::Atom = &raw const args[idx as usize];
                    let io = interp.as_cmd(this).io.clone();
                    let child = Expansion::init(
                        interp,
                        shell,
                        atom,
                        this,
                        io,
                        ExpansionOpts {
                            for_spawn: true,
                            single: false,
                        },
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
        interp: &Interpreter,
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
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        let child_kind = interp.node(child).kind();
        // Spec (Cmd.zig childDone lines 364-398): a nonzero exit from an
        // Assigns or Expansion child aborts the command — write the failing
        // error to stderr and finish with exit 1. Do NOT advance idx.
        if exit_code != 0 && matches!(child_kind, StateKind::Assign | StateKind::Expansion) {
            // Spec (Cmd.zig childDone 384-396): pull the expansion error out
            // before deiniting the child, then write it to stderr via
            // `writeFailingError("{f}\n", err)` and finish with exit 1.
            let err = if matches!(child_kind, StateKind::Expansion) {
                Expansion::take_err(interp, child)
            } else {
                None
            };
            interp.deinit_node(child);
            if let Some(err) = err {
                let y = Builtin::cmd_write_failing_error(interp, this, format_args!("{}\n", err));
                err.deinit();
                return y;
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
                    // Spec (Cmd.zig childDone 400-409): when the sole
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
                    // PORT NOTE: Zig used `out.bounds` to split into multiple
                    // argv words (glob/IFS); preserved here verbatim.
                    let me = interp.as_cmd_mut(this);
                    if out.bounds.is_empty() {
                        // Spec (Expansion.zig pushCurrentOut 652): an empty
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
                    // Spec (Expansion.zig pushCurrentOut): NUL-terminate a
                    // non-empty result; leave an empty expansion empty so the
                    // ambiguous-redirect check in `Builtin::init_redirections`
                    // still fires.
                    let mut buf = out.buf;
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

    /// Spec: Cmd.zig `transitionToExecStateAndYield()` + `initSubproc()` up
    /// through the `Builtin.Kind.fromStr` branch. Resolves argv[0] to a
    /// builtin or falls through to subprocess spawn (still gated).
    fn transition_to_exec(interp: &Interpreter, this: NodeId) -> Yield {
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
        // `child_done` from `Expansion::out_exit_code`), else 0.
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

        // ── Subprocess path (Spec: Cmd.zig `initSubproc` lines 487-546) ────
        // PORT NOTE: `SpawnArgs` borrows only the local `arena` (its
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

        // Resolve argv[0] via PATH (`bun_which::which`). Spec lines 487-498.
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
            // Spec (Cmd.zig:493): writeFailingError("bun: command not found:
            // {s}\n") → `.waiting_write_err` → onIOWriterChunk →
            // `parent.childDone(this, 1)`.
            drop(spawn_args);
            return Builtin::cmd_write_failing_error(
                interp,
                this,
                format_args!("bun: command not found: {}\n", bstr::BStr::new(&first_arg)),
            );
        };
        // Replace argv[0] with the resolved absolute path (NUL-terminated for
        // `execve`).
        resolved.push(0);
        interp.as_cmd_mut(this).args[0] = resolved;

        // Fill env from export_env + cmd_local_env. Spec lines 502-506.
        {
            let env = interp.as_cmd_mut(this).base.shell_mut();
            let mut iter = env.export_env.iterator();
            spawn_args.fill_env::<false>(&mut iter);
            let mut iter = env.cmd_local_env.iterator();
            spawn_args.fill_env::<false>(&mut iter);
        }

        // Convert shell IO → subprocess stdio. Spec lines 509-511.
        let mut shellio = ShellIO::default();
        interp
            .as_cmd(this)
            .io
            .to_subproc_stdio(&mut spawn_args.stdio, &mut shellio);

        // Spec lines 513-515 / 548-640: apply file/jsbuf/`2>&1` redirects on
        // top of the IO-derived stdio.
        match Self::init_subproc_redirections(interp, this, &mut spawn_args.stdio) {
            Ok(None) => {}
            Ok(Some(y)) => {
                drop(spawn_args);
                drop(arena);
                return y;
            }
            Err(_) => {
                drop(spawn_args);
                drop(arena);
                return Yield::failed();
            }
        }

        // Stage the exec slot *before* spawning so PipeReader / process-exit
        // callbacks (which deref `cmd_parent.exec`) see a populated `Subproc`
        // with the correct `child` once `spawn_async` writes through
        // `out_subproc`. `interp` is left null until `spawn_async` and the
        // `did_exit_immediately` handling have returned: a synchronous
        // `Cmd::on_exit` reached via the process exit handler would otherwise
        // drive the trampoline (`Yield::run(&*interp)`) while this frame
        // still holds `&Interpreter`, tearing the Cmd down (and freeing
        // `child`) underneath the live `subproc` borrow. With `interp` null,
        // `on_exit` records `exit_code`/`state = Done` and returns; we resume
        // via the Yield we hand back below.
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
        // across the call (spec: `.result => this.exec.subproc.child`).
        let child: *mut ShellSubprocess = match &interp.as_cmd(this).exec {
            Exec::Subproc(sub) => sub.child,
            _ => unreachable!(),
        };
        // SAFETY: `spawn_async` Ok ⇒ wrote a live `heap::alloc` subprocess
        // pointer into `*child_out` (== `sub.child`); valid until `Cmd::deinit`
        // reclaims the box. Single-threaded.
        let subproc = unsafe { &mut *child };
        // Spec order (Cmd.zig 531-533): `subproc.ref()` precedes
        // `spawn_arena_freed = true; arena.deinit()`.
        subproc.r#ref();
        interp.as_cmd_mut(this).spawn_arena_freed = true;
        drop(arena);

        if did_exit_immediately {
            // Spec lines 535-544. `watch()` failed → process already gone.
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

    /// Spec: Cmd.zig `initRedirections` (lines 548-640). Applies the AST
    /// redirect (`> file`, `< ${blob}`, `2>&1`, …) onto the subprocess stdio
    /// triple. Returns `Ok(Some(yield))` when the redirect failed and a
    /// failing-error write was queued; `Err` when a JS exception was raised.
    fn init_subproc_redirections(
        interp: &Interpreter,
        this: NodeId,
        stdio: &mut [Stdio; 3],
    ) -> crate::jsc::JsResult<Option<Yield>> {
        const STDIN_NO: usize = 0;
        const STDOUT_NO: usize = 1;
        const STDERR_NO: usize = 2;

        let node: &ast::Cmd = interp.as_cmd(this).ast_node();
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
            return Ok(None);
        };

        match redirect {
            ast::Redirect::JsBuf(val) => {
                // Safe accessor — single `unsafe` deref lives in
                // `Interpreter::global_this_ref`.
                let global = interp
                    .global_this_ref()
                    .expect("JS values not allowed in this context");
                let idx = val.idx as usize;
                if idx >= interp.jsobjs.len() {
                    return Err(global.throw(format_args!("Invalid JS object reference in shell")));
                }
                let jsval = interp.jsobjs[idx];

                if let Some(buf) = jsval.as_array_buffer(global) {
                    let mk = || {
                        Stdio::ArrayBuffer(crate::jsc::array_buffer::ArrayBufferStrong {
                            array_buffer: buf,
                            held: crate::jsc::StrongOptional::create(buf.value, global),
                        })
                    };
                    if flags.stdin() {
                        stdio[STDIN_NO] = mk();
                    }
                    if flags.duplicate_out() {
                        stdio[STDOUT_NO] = mk();
                        stdio[STDERR_NO] = mk();
                    } else {
                        if flags.stdout() {
                            stdio[STDOUT_NO] = mk();
                        }
                        if flags.stderr() {
                            stdio[STDERR_NO] = mk();
                        }
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
                } else if crate::webcore::ReadableStream::from_js(jsval, global)?.is_some() {
                    panic!("TODO SHELL READABLE STREAM");
                } else if let Some(req) = jsval.as_::<crate::webcore::Response>() {
                    // SAFETY: `as_` returns a live JSC-owned `*mut Response`.
                    let req = unsafe { &mut *req };
                    req.get_body_value().to_blob_if_possible();
                    if flags.stdin() {
                        let b = req.get_body_value().use_as_any_blob();
                        stdio[STDIN_NO].extract_blob(global, b, STDIN_NO as i32)?;
                    }
                    if flags.stdout() {
                        let b = req.get_body_value().use_as_any_blob();
                        stdio[STDOUT_NO].extract_blob(global, b, STDOUT_NO as i32)?;
                    }
                    if flags.stderr() {
                        let b = req.get_body_value().use_as_any_blob();
                        stdio[STDERR_NO].extract_blob(global, b, STDERR_NO as i32)?;
                    }
                } else {
                    return Err(global.throw(format_args!(
                        "Unknown JS value used in shell: {}",
                        jsval.fmt_string(global)
                    )));
                }
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
                    return Ok(Some(Builtin::cmd_write_failing_error(
                        interp,
                        this,
                        format_args!(
                            "bun: ambiguous redirect: at `{}`\n",
                            bstr::BStr::new(&argv0)
                        ),
                    )));
                }
                let path_buf: Vec<u8> = {
                    let raw = &interp.as_cmd(this).redirection_file;
                    let len = raw.len().saturating_sub(1);
                    let mut v = raw[..len].to_vec();
                    v.push(0);
                    v
                };
                let path = bun_core::ZStr::from_buf(&path_buf, path_buf.len() - 1);
                log!("Expanded Redirect: {}\n", bstr::BStr::new(path.as_bytes()));
                let cwd_fd = interp.as_cmd(this).base.shell().cwd_fd;
                let redirfd = match crate::shell::interpreter::shell_openat(
                    cwd_fd,
                    path,
                    flags.to_flags(),
                    0o666,
                ) {
                    Ok(f) => f,
                    Err(e) => {
                        let sys_err = e.to_shell_system_error();
                        return Ok(Some(Builtin::cmd_write_failing_error(
                            interp,
                            this,
                            format_args!(
                                "bun: {}: {}",
                                sys_err.message,
                                bstr::BStr::new(path.as_bytes())
                            ),
                        )));
                    }
                };
                interp.as_cmd_mut(this).redirection_fd = Some(CowFd::init(redirfd));
                set_stdio_from_redirect(stdio, flags, redirfd);
            }
        }
        Ok(None)
    }

    /// Called by `Builtin::done` / subprocess exit handler.
    pub fn on_exec_done(interp: &Interpreter, this: NodeId, exit_code: ExitCode) -> Yield {
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
    pub fn on_subprocess_done(interp: &Interpreter, this: NodeId, exit_code: ExitCode) {
        Self::on_exec_done(interp, this, exit_code).run(interp);
    }

    pub fn deinit(interp: &Interpreter, this: NodeId) {
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
            Exec::Subproc(sub) if !sub.child.is_null() => {
                // SAFETY: `child` was set by `initSubproc` from a
                // `heap::alloc(ShellSubprocess)` and stays valid until this
                // drop. Single-threaded. Reclaiming the box runs
                // `ShellSubprocess::drop` → `finalize_sync` (closes stdio).
                let mut child = unsafe { bun_core::heap::take(sub.child) };
                if !child.has_exited() {
                    let _ = child.try_kill(9);
                }
                child.unref::<true>();
                drop(child);
                // `sub.buffered_closed` drops here, freeing any captured
                // `Vec<u8>`s (spec `buffered_closed.deinit()`).
            }
            // `Exec::Subproc` with null `child`: spawn failed before the
            // subprocess box was returned. Nothing to tear down.
            Exec::Subproc(_) => {}
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
    // `PipeReader::run_yield` without aliasing `&Interpreter` against
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
        let redirect = self.ast_node().redirect;
        let Exec::Subproc(sub) = &mut self.exec else {
            return;
        };
        // Raw deref keeps the borrow disjoint from `sub.buffered_closed` below.
        // SAFETY: `child` is the live subprocess owned by this Cmd.
        let child = unsafe { &mut *sub.child };
        // Spec: tee into the JS-side captured buffer if `io.stdout == .fd`
        // with a `captured` slot and the redirect didn't send stdout
        // elsewhere.
        if let IoOutKind::Fd(fd) = &self.io.stdout {
            // SAFETY: single-threaded; the captured `Vec<u8>` lives in the
            // owning `ShellExecEnv` and no other borrow of it is live here.
            if let Some(captured) = unsafe { fd.captured_mut() } {
                if !redirect.redirects_elsewhere(ast::IoKind::Stdout) {
                    if let Readable::Pipe(pipe) = &child.stdout {
                        captured.append_slice(pipe.slice());
                    }
                }
            }
        }
        BufferedIoClosed::close_out(
            &mut sub.buffered_closed.stdout,
            &mut child.stdout,
            matches!(self.io.stdout, IoOutKind::Pipe),
            redirect.redirects_elsewhere(ast::IoKind::Stdout),
            self.base.shell_mut().buffered_stdout(),
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
        let redirect = self.ast_node().redirect;
        let Exec::Subproc(sub) = &mut self.exec else {
            return;
        };
        // Raw deref keeps the borrow disjoint from `sub.buffered_closed` below.
        // SAFETY: `child` is the live subprocess owned by this Cmd.
        let child = unsafe { &mut *sub.child };
        if let IoOutKind::Fd(fd) = &self.io.stderr {
            // SAFETY: single-threaded; the captured `Vec<u8>` lives in the
            // owning `ShellExecEnv` and no other borrow of it is live here.
            if let Some(captured) = unsafe { fd.captured_mut() } {
                if !redirect.redirects_elsewhere(ast::IoKind::Stderr) {
                    if let Readable::Pipe(pipe) = &child.stderr {
                        captured.append_slice(pipe.slice());
                    }
                }
            }
        }
        BufferedIoClosed::close_out(
            &mut sub.buffered_closed.stderr,
            &mut child.stderr,
            matches!(self.io.stderr, IoOutKind::Pipe),
            redirect.redirects_elsewhere(ast::IoKind::Stderr),
            self.base.shell_mut().buffered_stderr(),
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
            // this point so the `&Interpreter` borrow does not alias it.
            // The caller (`ShellSubprocess::on_process_exit`) does not touch
            // its `*mut Cmd` again after this returns.
            Yield::Next(this_id).run(unsafe { &*interp });
        }
    }
}

/// Spec: Cmd.zig `setStdioFromRedirect`.
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

// ported from: src/shell/states/Cmd.zig
