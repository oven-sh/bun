use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{
    Bufio, Interpreter, Node, NodeId, ShellExecEnv, ShellExecEnvKind, StateKind, log,
};
use crate::shell::io::{IO, InKind, OutFd, OutKind};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer;
use crate::shell::io_writer::IOWriter;
use crate::shell::states::base::Base;
use crate::shell::states::expansion::Expansion;
use crate::shell::states::script::Script;
use crate::shell::yield_::Yield;

pub struct Subshell {
    pub(crate) base: Base,
    pub node: bun_ptr::BackRef<ast::Subshell>,
    pub(crate) io: IO,
    pub(crate) state: SubshellState,
    pub(crate) exit_code: ExitCode,
    /// NUL-terminated expanded redirect target path (set by the Expansion child).
    pub(crate) redirection_file: Vec<u8>,
}

#[derive(Default, strum::IntoStaticStr)]
pub enum SubshellState {
    #[default]
    Idle,
    ExpandingRedirect {
        idx: u32,
    },
    Exec,
    WaitWriteErr,
    Done,
}

impl Subshell {
    /// `shell` must already be a duped env owned by this node (see
    /// `init_dupe_shell_state` for the Stmt/Binary path; Pipeline dupes the
    /// env itself before calling this). `Subshell::deinit` frees it.
    pub(crate) fn init(
        interp: &Interpreter,
        shell: *mut ShellExecEnv,
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
            redirection_file: Vec::new(),
        }))
    }

    /// Dupe the parent env and `init`.
    /// Called by Stmt/Binary via `Interpreter::spawn_expr`. Pipeline does
    /// NOT use this (it dupes per-child itself and calls `init` directly).
    ///
    /// # Safety
    /// `parent_shell` must point to a live `ShellExecEnv` owned by the parent
    /// state for the duration of this call.
    // Caller (Interpreter::spawn_expr) holds the parent env as a raw pointer;
    // the safety contract is documented above and at the call site.
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
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
        let duped = unsafe { (*parent_shell).dupe_for_subshell(&io, ShellExecEnvKind::Subshell) }?;
        Ok(Self::init(interp, duped, node, parent, io))
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
                // If there's no redirect, skip straight to exec.
                let has_redirect = {
                    let me = interp.as_subshell(this);
                    let node = me.node.get();
                    node.redirect.is_some() || !node.redirect_flags.is_empty()
                };
                if !has_redirect {
                    return Self::transition_to_exec(interp, this);
                }
                interp.as_subshell_mut(this).state = SubshellState::ExpandingRedirect { idx: 0 };
                Yield::Next(this)
            }
            SubshellState::ExpandingRedirect { idx } => {
                // Only `Redirect::Atom` needs expansion.
                let me = interp.as_subshell(this);
                let node = me.node.get();
                if idx == 0 {
                    if let Some(ast::Redirect::Atom(atom)) = &node.redirect {
                        let atom_ptr: *const ast::Atom = atom;
                        let shell = me.base.shell;
                        let child = Expansion::init(interp, shell, atom_ptr, this);
                        return Expansion::start(interp, child);
                    }
                }
                // No atom to expand (JsBuf or fd-dup) — go directly to exec.
                Self::transition_to_exec(interp, this)
            }
            SubshellState::Exec | SubshellState::WaitWriteErr => Yield::suspended(),
            SubshellState::Done => {
                let exit = interp.as_subshell(this).exit_code;
                interp.child_done(parent, this, exit)
            }
        }
    }

    /// Applies pending redirects to `self.io`, then spawns the inner `Script`.
    fn transition_to_exec(interp: &Interpreter, this: NodeId) -> Yield {
        log!("Subshell {} transitionToExec", this);

        // Apply redirections to `self.io` before starting the script.
        let has_redirect = {
            let me = interp.as_subshell(this);
            let node = me.node.get();
            node.redirect.is_some() || !node.redirect_flags.is_empty()
        };
        if has_redirect {
            if let Some(y) = Self::apply_redirections(interp, this) {
                return y;
            }
        }

        let (shell, io, node) = {
            let me = interp.as_subshell(this);
            (me.base.shell, me.io.clone(), me.node)
        };
        let script_node: *const ast::Script = &raw const node.get().script;
        interp.as_subshell_mut(this).state = SubshellState::Exec;
        let script = Script::init(interp, shell, script_node, this, io);
        Script::start(interp, script)
    }

    /// Open the redirect target and rewire `self.io`; mirrors
    /// `Builtin::init_redirections`. `Some(yield)` when an error was queued.
    fn apply_redirections(interp: &Interpreter, this: NodeId) -> Option<Yield> {
        use crate::shell::interpreter::{is_pollable_from_mode, shell_openat};

        // Classify the redirect without borrowing across `as_subshell_mut`.
        enum RedirKind {
            None,
            Atom,
            JsBuf,
        }
        let (kind, redirect_flags) = {
            let me = interp.as_subshell(this);
            let node = me.node.get();
            let kind = match &node.redirect {
                None => RedirKind::None,
                Some(ast::Redirect::Atom(_)) => RedirKind::Atom,
                Some(ast::Redirect::JsBuf(_)) => RedirKind::JsBuf,
            };
            (kind, node.redirect_flags)
        };

        if matches!(kind, RedirKind::None) {
            // No redirect target — `2>&1` / `1>&2` (fd-dup) only.
            if redirect_flags.duplicate_out() {
                let me = interp.as_subshell_mut(this);
                if redirect_flags.stdout() {
                    // `2>&1`: route stderr to stdout's target. `OutKind::Pipe`
                    // resolves positionally, so also alias the capture buffer.
                    me.io.stderr = me.io.stdout.clone();
                    if matches!(me.io.stderr, OutKind::Pipe) {
                        let stdout_buf = me.base.shell_mut().buffered_stdout();
                        me.base.shell_mut()._buffered_stderr = Bufio::Borrowed(stdout_buf);
                    }
                }
                if redirect_flags.stderr() {
                    // `1>&2`: route stdout to stderr's target.
                    me.io.stdout = me.io.stderr.clone();
                    if matches!(me.io.stdout, OutKind::Pipe) {
                        let stderr_buf = me.base.shell_mut().buffered_stderr();
                        me.base.shell_mut()._buffered_stdout = Bufio::Borrowed(stderr_buf);
                    }
                }
            }
            return None;
        }

        match kind {
            RedirKind::None => unreachable!(),
            RedirKind::Atom => {
                if interp.as_subshell(this).redirection_file.is_empty() {
                    return Some(Self::write_failing_error(
                        interp,
                        this,
                        format_args!("bun: ambiguous redirect: at `subshell`\n"),
                    ));
                }

                // Clone the NUL-terminated path bytes so the open call below
                // doesn't overlap a borrow into the Subshell node.
                let path_buf: Vec<u8> = {
                    let raw = &interp.as_subshell(this).redirection_file;
                    let len = raw.len().saturating_sub(1);
                    let mut v = raw[..len].to_vec();
                    v.push(0);
                    v
                };
                // SAFETY: `path_buf` ends in NUL by construction.
                let path = bun_core::ZStr::from_slice_with_nul(&path_buf[..]);
                let perm: bun_sys::Mode = 0o666;
                let cwd_fd = interp.as_subshell(this).base.shell().cwd_fd;
                let evtloop = interp.event_loop;

                let mut pollable = false;
                let mut is_socket = false;
                let mut is_nonblocking = false;

                let redirfd: bun_sys::Fd = if redirect_flags.stdin() {
                    match shell_openat(cwd_fd, path, redirect_flags.to_flags(), perm) {
                        Err(e) => {
                            let sys = e.to_shell_system_error();
                            return Some(Self::write_failing_error(
                                interp,
                                this,
                                format_args!(
                                    "bun: {}: {}\n",
                                    bstr::BStr::new(sys.message.byte_slice()),
                                    bstr::BStr::new(path.as_bytes()),
                                ),
                            ));
                        }
                        Ok(f) => f,
                    }
                } else {
                    let result = bun_io::open_for_writing_impl(
                        cwd_fd,
                        &path,
                        redirect_flags.to_flags(),
                        perm,
                        &mut pollable,
                        &mut is_socket,
                        false,
                        &mut is_nonblocking,
                        (),
                        |_| {},
                        is_pollable_from_mode,
                        shell_openat,
                    );
                    match result {
                        Err(e) => {
                            let sys = e.to_shell_system_error();
                            return Some(Self::write_failing_error(
                                interp,
                                this,
                                format_args!(
                                    "bun: {}: {}\n",
                                    bstr::BStr::new(sys.message.byte_slice()),
                                    bstr::BStr::new(path.as_bytes()),
                                ),
                            ));
                        }
                        Ok(f) => {
                            #[cfg(windows)]
                            {
                                use bun_sys::FdExt as _;
                                match f.make_lib_uv_owned_for_syscall(
                                    bun_sys::Tag::open,
                                    bun_sys::ErrorCase::CloseOnFail,
                                ) {
                                    Err(e) => {
                                        let sys = e.to_shell_system_error();
                                        return Some(Self::write_failing_error(
                                            interp,
                                            this,
                                            format_args!(
                                                "bun: {}: {}\n",
                                                bstr::BStr::new(sys.message.byte_slice()),
                                                bstr::BStr::new(path.as_bytes()),
                                            ),
                                        ));
                                    }
                                    Ok(f2) => f2,
                                }
                            }
                            #[cfg(not(windows))]
                            {
                                f
                            }
                        }
                    }
                };

                let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                if redirect_flags.stdin() {
                    let r = IOReader::init(redirfd, evtloop);
                    r.set_interp(interp_ptr);
                    interp.as_subshell_mut(this).io.stdin = InKind::Fd(r);
                }

                if !redirect_flags.stdout() && !redirect_flags.stderr() {
                    return None;
                }

                // Honor the `pollable` computed by `open_for_writing_impl`
                // on POSIX; Windows keeps the async writer.
                let redirect_writer = IOWriter::init(
                    redirfd,
                    io_writer::Flags {
                        pollable: if cfg!(windows) { true } else { pollable },
                        nonblock: is_nonblocking,
                        is_socket,
                        ..Default::default()
                    },
                    evtloop,
                );
                redirect_writer.set_interp(interp_ptr);

                if redirect_flags.stdout() {
                    interp.as_subshell_mut(this).io.stdout = OutKind::Fd(OutFd {
                        writer: std::sync::Arc::clone(&redirect_writer),
                        captured: None,
                    });
                }
                if redirect_flags.stderr() {
                    interp.as_subshell_mut(this).io.stderr = OutKind::Fd(OutFd {
                        writer: redirect_writer,
                        captured: None,
                    });
                }
                None
            }
            RedirKind::JsBuf => {
                // JS object targets need Cmd's `spawn_args.stdio` path.
                Some(Self::write_failing_error(
                    interp,
                    this,
                    format_args!("bun: JS object redirections in subshells are not supported\n"),
                ))
            }
        }
    }

    /// Sets `exit_code = 1` and writes the error to `self.io.stderr`.
    fn write_failing_error(
        interp: &Interpreter,
        this: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let mut buf = Vec::new();
        let _ = buf.write_fmt(args);
        interp.as_subshell_mut(this).exit_code = 1;

        if interp.as_subshell(this).io.stderr.needs_io().is_some() {
            interp.as_subshell_mut(this).state = SubshellState::WaitWriteErr;
            let child = io_writer::ChildPtr::new(this, io_writer::WriterTag::Subshell);
            if let OutKind::Fd(fd) = &interp.as_subshell(this).io.stderr {
                return fd.writer.enqueue(child, fd.captured, &buf);
            }
            unreachable!()
        }
        // Pipe / ignore: append to the shell env's captured stderr buffer and
        // finish synchronously.
        if let OutKind::Pipe = &interp.as_subshell(this).io.stderr {
            // SAFETY: single trampoline frame; no other borrow is live.
            let stderr = unsafe {
                interp
                    .as_subshell_mut(this)
                    .base
                    .shell_mut()
                    .buffered_stderr_mut()
            };
            use bun_collections::VecExt;
            stderr.append_slice(&buf);
        }
        let parent = interp.as_subshell(this).base.parent;
        interp.child_done(parent, this, 1)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        this: NodeId,
        _written: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        debug_assert!(matches!(
            interp.as_subshell(this).state,
            SubshellState::WaitWriteErr
        ));
        drop(err);
        let (parent, exit) = {
            let me = interp.as_subshell_mut(this);
            me.state = SubshellState::Done;
            (me.base.parent, me.exit_code)
        };
        interp.child_done(parent, this, exit)
    }

    pub(crate) fn child_done(
        interp: &Interpreter,
        this: NodeId,
        child: NodeId,
        exit_code: ExitCode,
    ) -> Yield {
        let child_kind = interp.node(child).kind();

        // Expansion child: collect the expanded redirect path.
        if matches!(child_kind, StateKind::Expansion) {
            if exit_code != 0 {
                // Expansion failed — surface the error.
                let err = Expansion::take_err(interp, child);
                interp.deinit_node(child);
                if let Some(err) = err {
                    return Self::write_failing_error(interp, this, format_args!("{}\n", err));
                }
                let me = interp.as_subshell_mut(this);
                me.exit_code = 1;
                me.state = SubshellState::Done;
                return Yield::Next(this);
            }
            let out = Expansion::take_out(interp, child);
            // Zero words or >1 word (glob/brace split) leave the buffer
            // empty so the ambiguous-redirect check fires.
            let mut buf = if out.bounds.is_empty() {
                out.buf
            } else {
                Vec::new()
            };
            if !buf.is_empty() && buf.last() != Some(&0) {
                buf.push(0);
            }
            interp.as_subshell_mut(this).redirection_file = buf;
            // Advance idx so we don't re-enter expansion.
            if let SubshellState::ExpandingRedirect { ref mut idx } =
                interp.as_subshell_mut(this).state
            {
                *idx += 1;
            }
            interp.deinit_node(child);
            return Yield::Next(this);
        }

        // Script child: propagate its exit to our parent.
        interp.deinit_node(child);
        {
            let me = interp.as_subshell_mut(this);
            me.exit_code = exit_code;
            me.state = SubshellState::Done;
        }
        Yield::Next(this)
    }

    pub(crate) fn deinit(interp: &Interpreter, this: NodeId) {
        log!("Subshell {} deinit", this);
        let me = interp.as_subshell_mut(this);
        me.redirection_file.clear();
        // The env was duped at construction (either by Pipeline or by
        // `init_dupe_shell_state`) — Subshell always owns it.
        if !me.base.shell.is_null() {
            // SAFETY: `me.base.shell` is the duped env this Subshell owned;
            // null-checked and exclusively held here.
            ShellExecEnv::deinit_impl(me.base.shell);
            me.base.shell = core::ptr::null_mut();
        }
        me.base.end_scope();
    }
}
