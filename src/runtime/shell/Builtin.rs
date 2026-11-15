//! A builtin command runs inside a `Cmd` state node. The builtin stores the
//! `NodeId` of its owning Cmd and every method takes the `Interpreter`.

use bun_collections::VecExt;
use bun_jsc::{JsResult, PinnedArrayBuffer};
use std::rc::Rc;

use crate::node::fs::{note_shell_redirect, open_embedded_shell_operand, refuse_shell_redirect};
use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{
    Interpreter, Node, NodeId, ParseError, ShellExecEnv, ShellExecEnvId, ShellExecEnvs,
    ShellInterpreter, is_pollable_from_mode, shell_openat,
};
use crate::shell::io::{OutFd, OutKind};
use crate::shell::io_reader::{IOReader, IOReaderId};
use crate::shell::io_writer::{self, IOWriter, IOWriterId};
use crate::shell::states::cmd::{Cmd, CmdState};
use crate::shell::yield_::{ReentrantAction, Yield};

pub(crate) struct Builtin {
    pub(crate) kind: Kind,
    /// NUL-terminated by `Cmd::transition_to_exec` (argv[0] is the builtin name).
    args: Vec<Vec<u8>>,
    pub(crate) stdin: BuiltinInput,
    pub(crate) stdout: BuiltinIO,
    pub(crate) stderr: BuiltinIO,
    /// Opened for `< path`.
    redirect_reader: Option<IOReaderId>,
    /// Opened for `> path`.
    redirect_writer: Option<IOWriterId>,
    pub(crate) impl_: Impl,
}

// ──────────────────────────────────────────────────────────────────────────
// shell_builtins! — single source of truth for the builtin set.
//
// This table macro keeps the single-definition property: each row declares
// {Variant, argv0 name, module path, storage shape, usage, posix-gate} once
// and the macro emits `Kind`, `Impl`, `as_str`, `usage_string`,
// `from_argv0_raw`, `DISABLED_ON_POSIX`, `make_impl`, `start`,
// `on_io_writer_chunk`, and the per-variant [`BuiltinState`] downcast impls.
//
// Rows are grouped by storage shape (`unit` → bare variant, `inline` →
// `Variant(T)`, `boxed` → `Variant(Box<T>)`) because `macro_rules!` cannot
// expand a per-row helper in enum-variant position; grouping keeps the table
// declarative without a tt-muncher.
// ──────────────────────────────────────────────────────────────────────────

/// Per-builtin state downcast. Replaces the 17 hand-rolled
/// `fn state_mut(interp, cmd) -> &mut Self { match Builtin::of_mut(..).impl_ {
/// Impl::X(v) => v, _ => unreachable!() } }` copies that every
/// `src/runtime/shell/builtin/*.rs` carried.
///
/// `extract` is the bare variant projection (knows whether the payload is
/// boxed in `Impl`); `state_mut` is the convenience entry point every builtin
/// actually calls. Call sites keep writing `Self::state_mut(interp, cmd)` —
/// they only need this trait in scope. Impls are generated per-row by
/// [`shell_builtins!`].
pub(crate) trait BuiltinState: Sized {
    /// Project `&mut Impl` → `&mut Self`. `unreachable!` on variant mismatch.
    fn extract(impl_: &mut Impl) -> &mut Self;

    #[inline]
    #[track_caller]
    fn state_mut<'i>(interp: &'i mut Interpreter<'_>, cmd: NodeId) -> &'i mut Self {
        Self::extract(&mut Builtin::of_mut(interp, cmd).impl_)
    }
}

macro_rules! shell_builtins {
    (
        unit:   { $( $UV:ident => ($u_mod:ident :: $UT:ident, $u_name:literal, $u_usage:expr) ),* $(,)? }
        inline: { $( $IV:ident => ($i_mod:ident :: $IT:ident, $i_name:literal, $i_usage:expr) ),* $(,)? }
        boxed:  { $( $BV:ident => ($b_mod:ident :: $BT:ident, $b_name:literal, $b_usage:expr) ),* $(,)? }
        posix_disabled: [ $( $PD:ident ),* $(,)? ]
    ) => {
        #[repr(u8)]
        #[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
        pub enum Kind { $( $UV, )* $( $IV, )* $( $BV, )* }

        /// Per-builtin state.
        pub(crate) enum Impl {
            $( $UV, )*
            $( $IV(crate::shell::builtins::$i_mod::$IT), )*
            // Heavy builtins boxed to keep `Node` small.
            $( $BV(Box<crate::shell::builtins::$b_mod::$BT>), )*
        }

        impl Kind {
            /// Builtins disabled on POSIX (delegate to the system binary) unless
            /// the experimental feature flag is set.
            pub const DISABLED_ON_POSIX: &'static [Kind] = &[ $( Kind::$PD ),* ];

            /// Lowercase tag for error prefixes (`"{kind}: ..."`).
            pub fn as_str(self) -> &'static str {
                match self {
                    $( Kind::$UV => $u_name, )*
                    $( Kind::$IV => $i_name, )*
                    $( Kind::$BV => $b_name, )*
                }
            }

            pub fn usage_string(self) -> &'static [u8] {
                match self {
                    $( Kind::$UV => $u_usage, )*
                    $( Kind::$IV => $i_usage, )*
                    $( Kind::$BV => $b_usage, )*
                }
            }

            /// argv[0] → `Kind`, no POSIX gating.
            fn from_argv0_raw(s: &[u8]) -> Option<Kind> {
                $( if s == $u_name.as_bytes() { return Some(Kind::$UV); } )*
                $( if s == $i_name.as_bytes() { return Some(Kind::$IV); } )*
                $( if s == $b_name.as_bytes() { return Some(Kind::$BV); } )*
                None
            }
        }

        $( impl BuiltinState for crate::shell::builtins::$i_mod::$IT {
            #[inline]
            fn extract(impl_: &mut Impl) -> &mut Self {
                match impl_ { Impl::$IV(v) => v, _ => unreachable!() }
            }
        } )*
        $( impl BuiltinState for crate::shell::builtins::$b_mod::$BT {
            #[inline]
            fn extract(impl_: &mut Impl) -> &mut Self {
                match impl_ { Impl::$BV(v) => &mut **v, _ => unreachable!() }
            }
        } )*

        impl Builtin {
            #[inline]
            fn make_impl(kind: Kind) -> Impl {
                match kind {
                    $( Kind::$UV => Impl::$UV, )*
                    $( Kind::$IV => Impl::$IV(Default::default()), )*
                    $( Kind::$BV => Impl::$BV(Box::default()), )*
                }
            }

            /// Hoisted dispatch: start the builtin's state machine.
            pub(crate) fn start(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
                // Match on a copied Kind, then
                // call the per-builtin `start(interp, cmd)`. Each builtin reaches its
                // own state via `Builtin::of_mut(interp, cmd).impl_`.
                match Self::kind_of(interp, cmd) {
                    $( Kind::$UV => crate::shell::builtins::$u_mod::$UT::start(interp, cmd), )*
                    $( Kind::$IV => crate::shell::builtins::$i_mod::$IT::start(interp, cmd), )*
                    $( Kind::$BV => crate::shell::builtins::$b_mod::$BT::start(interp, cmd), )*
                }
            }

            /// Hoisted dispatch for the `onIOWriterChunk` callback.
            pub(crate) fn on_io_writer_chunk(
                interp: &mut Interpreter<'_>,
                cmd: NodeId,
                written: usize,
                err: Option<bun_sys::SystemError>,
            ) -> Yield {
                match Self::kind_of(interp, cmd) {
                    $( Kind::$UV => crate::shell::builtins::$u_mod::$UT::on_io_writer_chunk(interp, cmd, written, err), )*
                    $( Kind::$IV => crate::shell::builtins::$i_mod::$IT::on_io_writer_chunk(interp, cmd, written, err), )*
                    $( Kind::$BV => crate::shell::builtins::$b_mod::$BT::on_io_writer_chunk(interp, cmd, written, err), )*
                }
            }
        }
    };
}

shell_builtins! {
    unit: {
        True     => (true_::True,       "true",     b""),
        False    => (false_::False,     "false",    b""),
    }
    inline: {
        Pwd      => (pwd::Pwd,          "pwd",      b""),
        Exit     => (exit::Exit,        "exit",     b"usage: exit [n]\n"),
        Basename => (basename::Basename,"basename", b"usage: basename string\n"),
        Dirname  => (dirname::Dirname,  "dirname",  b"usage: dirname string\n"),
        Cd       => (cd::Cd,            "cd",       b""),
        Echo     => (echo::Echo,        "echo",     b""),
        Export   => (export::Export,    "export",   b""),
        Seq      => (seq::Seq,          "seq",      b"usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n"),
    }
    boxed: {
        Cat      => (cat::Cat,          "cat",      b"usage: cat [-belnstuv] [file ...]\n"),
        Mv       => (mv::Mv,            "mv",       b"usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n"),
        Rm       => (rm::Rm,            "rm",       b"usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n"),
        Which    => (which::Which,      "which",    b""),
        Ls       => (ls::Ls,            "ls",       b"usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]\n"),
        Mkdir    => (mkdir::Mkdir,      "mkdir",    b"usage: mkdir [-pv] [-m mode] directory_name ...\n"),
        Touch    => (touch::Touch,      "touch",    b"usage: touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]]\n       [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...\n"),
        Cp       => (cp::Cp,            "cp",       b"usage: cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory\n"),
        Yes      => (yes::Yes,          "yes",      b"usage: yes [expletive]\n"),
    }
    posix_disabled: [Cat, Cp]
}

impl Kind {
    fn force_enable_on_posix() -> bool {
        bun_core::env_var::feature_flag::BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS
            .get()
            .unwrap_or(false)
    }

    /// Maps argv[0] to a builtin kind, or `None` to fall through to
    /// subprocess spawn.
    pub(crate) fn from_argv0(s: &[u8]) -> Option<Kind> {
        let result = Self::from_argv0_raw(s)?;
        if cfg!(windows) || Self::force_enable_on_posix() {
            return Some(result);
        }
        if Self::DISABLED_ON_POSIX.contains(&result) {
            return None;
        }
        Some(result)
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum IoKind {
    Stdout,
    Stderr,
}

// ──────────────────────────────────────────────────────────────────────────
// BuiltinIO
//
// Distinct from `IO::OutKind` because builtins can target ArrayBuffer/Blob
// JS objects (`> ${buf}`) and accumulate into a per-builtin `.buf` when the
// Cmd's IO is `.pipe`. The `.buf` arm is reshaped in the NodeId port: instead
// of a local Vec flushed in `done()`, `write_no_io` appends straight to the
// shell env's captured buffer (one less copy). The variant carries its flush
// target so `2>&1` (which makes `stderr` a shallow copy of `stdout`) routes
// stderr writes to `buffered_stdout`.
// ──────────────────────────────────────────────────────────────────────────

/// One output stream of a builtin (stdout or stderr).
pub(crate) enum BuiltinIO {
    /// Async writer (real fd). `needs_io()` returns Some.
    Fd(OutFd),
    /// Captured pipe — writes go to the shell env's `_buffered_{stdout,stderr}`.
    /// Writes go through immediately (see module doc).
    /// The payload names which shell-env bytelist to append to — set at
    /// `from_out_kind` and copied verbatim by `dup_ref` so `2>&1` keeps
    /// stderr aimed at stdout's buffer.
    Buf(IoKind),
    ArrayBuf {
        buf: PinnedArrayBuffer,
        i: u32,
    },
    Blob(Rc<BuiltinBlob>),
}

/// Input stream of a builtin.
pub(crate) enum BuiltinInput {
    Fd(IOReaderId),
    ArrayBuf { buf: PinnedArrayBuffer },
    Blob(Rc<BuiltinBlob>),
}

/// Refcounted wrapper around a `webcore.Blob`. `Rc` provides the refcount.
pub(crate) struct BuiltinBlob {
    pub(crate) blob: crate::webcore::Blob,
}

impl BuiltinIO {
    /// From the Cmd's IO::OutKind. `target`
    /// is the shell-env bytelist this stream flushes to (Stdout or Stderr).
    fn from_out_kind(ok: OutKind, target: IoKind) -> BuiltinIO {
        match ok {
            OutKind::Fd(fd) => BuiltinIO::Fd(fd),
            OutKind::Pipe => BuiltinIO::Buf(target),
        }
    }

    /// Bump refcounts and return a shallow copy. Only reachable from the
    /// `duplicate_out` path, which fires before any `.jsbuf` redirect, so
    /// `ArrayBuf`/`Blob` are unreachable here. The `Buf` target is copied
    /// verbatim so stderr writes accumulate in (and flush from) stdout's
    /// buffer; that aliasing is the carried `IoKind`.
    fn dup_ref(&self) -> BuiltinIO {
        match self {
            BuiltinIO::Fd(fd) => BuiltinIO::Fd(*fd),
            BuiltinIO::Buf(target) => BuiltinIO::Buf(*target),
            BuiltinIO::Blob(b) => BuiltinIO::Blob(Rc::clone(b)),
            BuiltinIO::ArrayBuf { .. } => {
                unreachable!("duplicate_out precedes jsbuf redirects")
            }
        }
    }

    #[inline]
    pub(crate) fn needs_io(&self) -> Option<OutFd> {
        match self {
            BuiltinIO::Fd(fd) => Some(*fd),
            _ => None,
        }
    }

    /// Body of [`Builtin::write_no_io`] with the Cmd split-borrow already
    /// performed by the caller. Exists so builtins whose payload lives in
    /// `Builtin.impl_` (disjoint from `stdout`/`stderr`) can write a borrowed
    /// slice without an intermediate heap clone.
    ///
    /// `shell` is the env of this builtin (i.e. `cmd.shell`);
    /// only used for the [`BuiltinIO::Buf`] arm.
    pub(crate) fn write_no_io_to(
        &mut self,
        shells: &mut ShellExecEnvs<'_>,
        shell: ShellExecEnvId,
        buf: &[u8],
    ) -> bun_sys::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        match self {
            BuiltinIO::Fd(_) => {
                panic!("write_no_io called on fd output; caller must check needs_io()")
            }
            BuiltinIO::Buf(target) => {
                // Writes go straight through to `buffered_{stdout,stderr}`;
                // `target` is the destination identity, fixed at construction
                // and preserved across `dup_ref` so `2>&1` lands in stdout's
                // bytelist.
                shells.buffered_mut(shell, *target).append_slice(buf);
                Ok(buf.len())
            }
            BuiltinIO::ArrayBuf { buf: arraybuf, i } => {
                // JS can resize the buffer between chunks.
                let dst_all = arraybuf.live_slice_mut();
                let idx = *i as usize;
                let total = dst_all.len();
                if idx >= total {
                    return Err(bun_sys::Error::from_code(
                        bun_sys::E::ENOSPC,
                        bun_sys::Tag::write,
                    ));
                }
                let write_len = (total - idx).min(buf.len());
                let dst = &mut dst_all[idx..idx + write_len];
                dst.copy_from_slice(&buf[..write_len]);
                *i = i.saturating_add(write_len as u32);
                Ok(write_len)
            }
            BuiltinIO::Blob(_) => Ok(buf.len()),
        }
    }
}

impl Builtin {
    /// `argv[1..]`
    #[inline]
    pub(crate) fn args_slice(&self) -> &[Vec<u8>] {
        &self.args[1..]
    }

    /// `PinnedArrayBuffer::drop`'s unpin would write to a `JSC::ArrayBuffer`
    /// impl the heap sweep already deleted; see
    /// `SubprocExec::defuse_array_buf_pins`. VM-shutdown finalizer
    /// only.
    pub(crate) fn defuse_array_buf_pins(&mut self) {
        if let BuiltinInput::ArrayBuf { buf, .. } = &mut self.stdin {
            buf.defuse();
        }
        if let BuiltinIO::ArrayBuf { buf, .. } = &mut self.stdout {
            buf.defuse();
        }
        if let BuiltinIO::ArrayBuf { buf, .. } = &mut self.stderr {
            buf.defuse();
        }
    }

    /// Borrow `argv[1..][idx]` up to its first NUL.
    #[inline]
    pub(crate) fn arg_bytes(&self, idx: usize) -> &[u8] {
        bun_core::slice_to_nul(&self.args[idx + 1])
    }

    /// Borrow `argv[1..][idx]` as `&ZStr` (NUL-terminated view).
    #[inline]
    pub(crate) fn arg_zstr(&self, idx: usize) -> &bun_core::ZStr {
        let arg = core::ffi::CStr::from_bytes_until_nul(&self.args[idx + 1]);
        bun_core::ZStr::from_cstr(arg.expect("terminated by transition_to_exec"))
    }

    /// Construct a `Builtin` for `kind`, install it into the owning Cmd's
    /// `exec` slot, then wire up file/jsbuf/`2>&1` redirections. Returns
    /// `None` (meaning: caller should now call `Builtin::start`). A
    /// `Some(yield)` return means setup wrote a failing error (or needs JS) and
    /// the caller should propagate that yield instead.
    pub(crate) fn init(interp: &mut Interpreter<'_>, cmd: NodeId, kind: Kind) -> Option<Yield> {
        use crate::shell::states::cmd::Exec;

        let me = interp.as_cmd_mut(cmd);
        me.exec = Exec::Builtin(Box::new(Builtin {
            kind,
            args: core::mem::take(&mut me.args),
            stdin: BuiltinInput::Fd(me.io.stdin),
            stdout: BuiltinIO::from_out_kind(me.io.stdout, IoKind::Stdout),
            stderr: BuiltinIO::from_out_kind(me.io.stderr, IoKind::Stderr),
            redirect_reader: None,
            redirect_writer: None,
            impl_: Self::make_impl(kind),
        }));

        Self::init_redirections(interp, cmd, kind)
    }

    pub(crate) fn deinit(&self, interp: &mut Interpreter<'_>) {
        if let Some(reader) = self.redirect_reader {
            interp.io_readers.remove(reader);
        }
        if let Some(writer) = self.redirect_writer {
            interp.io_writers.remove(writer);
        }
    }

    /// Opens redirect files / handles `2>&1` (`duplicate_out`).
    fn init_redirections(interp: &mut Interpreter<'_>, cmd: NodeId, kind: Kind) -> Option<Yield> {
        let node = interp.as_cmd(cmd).node;
        let redirect = node.redirect;

        match &node.redirect_file {
            Some(ast::Redirect::Atom(_)) => {
                // ── File redirect (`> path` / `< path` / `>> path` / `&> path`).
                if interp.as_cmd(cmd).redirection_file.is_empty() {
                    return Some(Self::cmd_write_failing_error(
                        interp,
                        cmd,
                        format_args!("bun: ambiguous redirect: at `{}`\n", kind.as_str()),
                    ));
                }

                // NUL-terminated by `Cmd::child_done`.
                let path_buf = core::mem::take(&mut interp.as_cmd_mut(cmd).redirection_file);
                let path = bun_core::ZStr::from_slice_with_nul(&path_buf[..]);
                let perm: bun_sys::Mode = 0o666;
                let cwd_fd = Self::cwd(interp, cmd);

                let mut pollable = false;
                let mut is_socket = false;
                let mut is_nonblocking = false;

                let redirfd: bun_sys::Fd = if redirect.stdin() {
                    let flags = redirect.to_flags();
                    let opened = shell_openat(cwd_fd, path, flags, perm).or_else(|error| {
                        let cwd = Self::shell(interp, cmd).cwd();
                        open_embedded_shell_operand(cwd, path.as_bytes(), flags, error)
                    });
                    match opened {
                        Err(e) => {
                            let sys = e.to_shell_system_error();
                            return Some(Self::cmd_write_failing_error(
                                interp,
                                cmd,
                                format_args!(
                                    "bun: {}: {}",
                                    bstr::BStr::new(sys.message.byte_slice()),
                                    bstr::BStr::new(path.as_bytes()),
                                ),
                            ));
                        }
                        Ok(f) => f,
                    }
                } else {
                    let cwd = Self::shell(interp, cmd).cwd();
                    let refused = refuse_shell_redirect(cwd, path.as_bytes(), redirect.to_flags());
                    let result = refused.and_then(|()| {
                        bun_io::open_for_writing_impl(
                            cwd_fd,
                            &path,
                            redirect.to_flags(),
                            perm,
                            &mut pollable,
                            &mut is_socket,
                            false,
                            &mut is_nonblocking,
                            (),
                            |_| {},
                            is_pollable_from_mode,
                            shell_openat,
                        )
                    });
                    match result {
                        Err(e) => {
                            let sys = e.to_shell_system_error();
                            return Some(Self::cmd_write_failing_error(
                                interp,
                                cmd,
                                format_args!(
                                    "bun: {}: {}",
                                    bstr::BStr::new(sys.message.byte_slice()),
                                    bstr::BStr::new(path.as_bytes()),
                                ),
                            ));
                        }
                        Ok(f) => {
                            note_shell_redirect(cwd, path.as_bytes(), redirect.to_flags());
                            f.into_raw()
                        }
                    }
                };

                if redirect.stdin() {
                    let r = IOReader::init(interp, redirfd);
                    let me = Self::of_mut(interp, cmd);
                    me.redirect_reader = Some(r);
                    me.stdin = BuiltinInput::Fd(r);
                }

                if !redirect.stdout() && !redirect.stderr() {
                    return None;
                }

                // Honor the `pollable` computed by `open_for_writing_impl` on
                // POSIX so a FIFO/socket target (whose fd is now O_NONBLOCK)
                // takes the pollable path; Windows keeps the async writer.
                let writer = IOWriter::init(
                    interp,
                    redirfd,
                    io_writer::Flags {
                        pollable: if cfg!(windows) { true } else { pollable },
                        nonblock: is_nonblocking,
                        is_socket,
                        ..Default::default()
                    },
                );
                let out = OutFd {
                    writer,
                    captured: None,
                };
                let me = Self::of_mut(interp, cmd);
                me.redirect_writer = Some(writer);
                if redirect.stdout() {
                    me.stdout = BuiltinIO::Fd(out);
                }
                if redirect.stderr() {
                    me.stderr = BuiltinIO::Fd(out);
                }
            }
            Some(ast::Redirect::JsBuf(jsbuf)) => {
                let action = ReentrantAction::StartBuiltinWithJsBuf(cmd, *jsbuf, redirect);
                return Some(Yield::Action(action));
            }
            None if redirect.duplicate_out() => {
                // `2>&1` (stderr=true,dup_out=true) → stderr := stdout
                // `1>&2` (stdout=true,dup_out=true) → stdout := stderr
                let me = Self::of_mut(interp, cmd);
                if redirect.stdout() {
                    me.stderr = me.stdout.dup_ref();
                }
                if redirect.stderr() {
                    me.stdout = me.stderr.dup_ref();
                }
            }
            None => {}
        }

        None
    }

    /// JS object redirect (`> ${arraybuf}` / `> ${blob}`), and then [`Builtin::start`].
    pub(crate) fn start_with_jsbuf_redirection(
        shell_interp: &ShellInterpreter,
        cmd: NodeId,
        jsbuf: ast::JSBuf,
        redirect: ast::RedirectFlags,
    ) -> JsResult<Yield> {
        let Some(global) = shell_interp.global_this_ref() else {
            return Err(shell_interp.throw(crate::shell::ShellErr::Custom(
                b"Invalid JS object reference in shell"
                    .to_vec()
                    .into_boxed_slice(),
            )));
        };
        let jsval = shell_interp.jsobj(global, jsbuf.idx)?;
        let (mut stdin, mut stdout, mut stderr) = (None, None, None);

        if jsval.js_type().is_array_buffer_like() {
            // Each slot gets its own pin + GC root.
            let root = || {
                PinnedArrayBuffer::root(global, jsval).ok_or_else(|| global.throw_out_of_memory())
            };
            if redirect.stdin() {
                stdin = Some(BuiltinInput::ArrayBuf { buf: root()? });
            }
            if redirect.stdout() {
                stdout = Some(BuiltinIO::ArrayBuf { buf: root()?, i: 0 });
            }
            if redirect.stderr() {
                stderr = Some(BuiltinIO::ArrayBuf { buf: root()?, i: 0 });
            }
        } else if let Some(body) = crate::webcore::body::Value::from_request_or_response(jsval) {
            // SAFETY: returned a live JSC-owned `*mut Value` borrowed
            // from a Response/Request wrapper.
            let body = unsafe { &mut *body };
            let is_file_blob = matches!(body, crate::webcore::body::Value::Blob(b)
                if !b.needs_to_read_file());
            if (redirect.stdout() || redirect.stderr()) && !is_file_blob {
                return Err(global.throw(format_args!(
                    "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                )));
            }
            let blob = Rc::new(BuiltinBlob {
                blob: body.use_().dupe(),
            });
            if redirect.stdin() {
                stdin = Some(BuiltinInput::Blob(Rc::clone(&blob)));
            }
            if redirect.stdout() {
                stdout = Some(BuiltinIO::Blob(Rc::clone(&blob)));
            }
            if redirect.stderr() {
                stderr = Some(BuiltinIO::Blob(blob));
            }
        } else if let Some(blob_ref) = jsval.as_class_ref::<crate::webcore::Blob>() {
            if (redirect.stdout() || redirect.stderr()) && !blob_ref.needs_to_read_file() {
                return Err(global.throw(format_args!(
                    "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                )));
            }
            let theblob = Rc::new(BuiltinBlob {
                blob: blob_ref.dupe(),
            });
            if redirect.stdin() {
                stdin = Some(BuiltinInput::Blob(theblob));
            } else if redirect.stdout() {
                stdout = Some(BuiltinIO::Blob(theblob));
            } else if redirect.stderr() {
                stderr = Some(BuiltinIO::Blob(theblob));
            }
        } else {
            return Err(global.throw(format_args!(
                "Unknown JS value used in shell: {}",
                jsval.fmt_string(global)
            )));
        }

        let started = shell_interp.with_interp(|interp| {
            let me = Self::of_mut(interp, cmd);
            if let Some(stdin) = stdin {
                me.stdin = stdin;
            }
            if let Some(stdout) = stdout {
                me.stdout = stdout;
            }
            if let Some(stderr) = stderr {
                me.stderr = stderr;
            }
            Self::start(interp, cmd)
        });
        Ok(started.expect("the script waits for this Cmd"))
    }

    /// Sets the owning Cmd's state to
    /// `WaitingWriteErr` and writes to the *Cmd's* `io.stderr` (not the
    /// builtin's, which may already have been redirected). Hoisted here
    /// because `init_redirections` and `Cmd` (the
    /// "command not found" / spawn-error paths) are the only callers.
    pub(crate) fn cmd_write_failing_error(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let mut buf = Vec::new();
        let _ = buf.write_fmt(args);
        if let OutKind::Fd(fd) = interp.as_cmd(cmd).io.stderr {
            // Only the `Fd` arm transitions state.
            interp.as_cmd_mut(cmd).state = CmdState::WaitingWriteErr;
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Cmd);
            return interp.enqueue(fd, child, &buf);
        }
        // No-IO path: append to the shell env's captured stderr and finish
        // synchronously with exit 1 (Cmd::on_io_writer_chunk's behaviour).
        let shell = interp.as_cmd(cmd).shell.id();
        interp
            .shells
            .buffered_mut(shell, IoKind::Stderr)
            .append_slice(&buf);
        let parent = interp.as_cmd(cmd).base.parent;
        interp.child_done(parent, cmd, 1)
    }

    /// Finish the builtin with `exit_code` and signal the owning Cmd.
    pub(crate) fn done(interp: &mut Interpreter<'_>, cmd: NodeId, exit_code: ExitCode) -> Yield {
        // Output is written through immediately in `write_no_io`, so there
        // is nothing to flush here.
        Cmd::on_exec_done(interp, cmd, exit_code)
    }

    /// Look up the Builtin inside a Cmd's `exec` slot.
    #[inline]
    #[track_caller]
    pub(crate) fn of<'i>(interp: &'i Interpreter<'_>, cmd: NodeId) -> &'i Builtin {
        match &interp.as_cmd(cmd).exec {
            crate::shell::states::cmd::Exec::Builtin(b) => b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        }
    }

    #[inline]
    #[track_caller]
    pub(crate) fn of_mut<'i>(interp: &'i mut Interpreter<'_>, cmd: NodeId) -> &'i mut Builtin {
        match &mut interp.as_cmd_mut(cmd).exec {
            crate::shell::states::cmd::Exec::Builtin(b) => b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        }
    }

    #[inline]
    fn kind_of(interp: &Interpreter<'_>, cmd: NodeId) -> Kind {
        Self::of(interp, cmd).kind
    }

    /// Returns the bytes available on stdin when it is *not* an async fd
    /// (arraybuf / piped buf / blob).
    pub(crate) fn read_stdin_no_io<'i>(interp: &'i Interpreter<'_>, cmd: NodeId) -> &'i [u8] {
        match &Self::of(interp, cmd).stdin {
            BuiltinInput::ArrayBuf { buf, .. } => buf.slice(),
            BuiltinInput::Blob(b) => b.blob.shared_view(),
            BuiltinInput::Fd(_) => b"",
        }
    }

    /// Write `buf` to stdout/stderr without going through IOWriter (the
    /// stream is a captured buffer / arraybuffer / blob / /dev/null).
    ///
    /// Returns `Err(ENOSPC)` when an ArrayBuffer target is already full.
    /// **WARNING**: caller must have checked `needs_io() == None` first.
    pub(crate) fn write_no_io(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        io_kind: IoKind,
        buf: &[u8],
    ) -> bun_sys::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        // Split-borrow the interpreter so `shells`
        // and the builtin's stdout/stderr are accessible simultaneously.
        let Node::Cmd(cmd_node) = &mut interp.nodes[cmd.idx()] else {
            unreachable!()
        };
        let shell = cmd_node.shell.id();
        let crate::shell::states::cmd::Exec::Builtin(me) = &mut cmd_node.exec else {
            panic!("Cmd {} is not running a builtin", cmd);
        };
        let out: &mut BuiltinIO = match io_kind {
            IoKind::Stdout => &mut me.stdout,
            IoKind::Stderr => &mut me.stderr,
        };
        out.write_no_io_to(&mut interp.shells, shell, buf)
    }

    /// Shell exec env of the owning Cmd.
    #[inline]
    pub(crate) fn shell<'i, 'a>(interp: &'i Interpreter<'a>, cmd: NodeId) -> &'i ShellExecEnv<'a> {
        &interp.shells[interp.as_cmd(cmd).shell.id()]
    }

    /// Cwd fd of the owning Cmd's shell env.
    #[inline]
    pub(crate) fn cwd(interp: &Interpreter<'_>, cmd: NodeId) -> bun_sys::Fd {
        Self::shell(interp, cmd).cwd_fd.fd()
    }

    /// Format `"{kind}: {fmt}"` into a fresh heap buffer.
    pub(crate) fn fmt_error(kind: Option<Kind>, args: core::fmt::Arguments<'_>) -> Vec<u8> {
        use std::io::Write as _;
        let mut buf = Vec::new();
        if let Some(k) = kind {
            let _ = write!(&mut buf, "{}: ", k.as_str());
        }
        let _ = buf.write_fmt(args);
        buf
    }

    /// Error messages formatted to match bash. Dispatches on the variant;
    /// `Sys` recurses into the system-error formatter.
    pub(crate) fn shell_err_to_string(kind: Kind, err: &crate::shell::ShellErr) -> Vec<u8> {
        use crate::shell::ShellErr;
        match err {
            ShellErr::Sys(sys) => {
                // `"{message}\n"` or `"{message}: {path}\n"`.
                if sys.path.is_empty() {
                    Self::fmt_error(
                        Some(kind),
                        format_args!("{}\n", bstr::BStr::new(sys.message.byte_slice())),
                    )
                } else {
                    Self::fmt_error(
                        Some(kind),
                        format_args!(
                            "{}: {}\n",
                            bstr::BStr::new(sys.message.byte_slice()),
                            sys.path,
                        ),
                    )
                }
            }
            ShellErr::Custom(s) => {
                Self::fmt_error(Some(kind), format_args!("{}\n", bstr::BStr::new(s)))
            }
        }
    }

    /// Error messages formatted to match bash. Maps the errno through
    /// `bun_sys::coreutils_error_map` so output matches GNU coreutils
    /// (e.g. `ENOENT` → "No such file or directory"); falls back to
    /// `"unknown error {errno}"` when unmapped.
    pub(crate) fn task_error_to_string(kind: Kind, err: &bun_sys::Error) -> Vec<u8> {
        if let Some((_code, sys_errno)) = err.get_error_code_tag_name() {
            if let Some(message) = bun_sys::coreutils_error_map::get(sys_errno) {
                if !err.path.is_empty() {
                    return Self::fmt_error(
                        Some(kind),
                        format_args!("{}: {}\n", bstr::BStr::new(&err.path[..]), message),
                    );
                }
                return Self::fmt_error(Some(kind), format_args!("{}\n", message));
            }
        }
        Self::fmt_error(Some(kind), format_args!("unknown error {}\n", err.errno))
    }

    /// The `illegal option`, usage or `unsupported option` message for `e`.
    pub(crate) fn parse_error_to_string(kind: Kind, e: &ParseError<'_>) -> Vec<u8> {
        match e {
            ParseError::IllegalOption(_) => Self::fmt_error(
                Some(kind),
                format_args!("illegal option -- {}\n", bstr::BStr::new(e.opt())),
            ),
            ParseError::ShowUsage => kind.usage_string().to_vec(),
            ParseError::Unsupported(_) => Self::fmt_error(
                Some(kind),
                format_args!(
                    "unsupported option, please open a GitHub issue -- {}\n",
                    bstr::BStr::new(e.opt())
                ),
            ),
        }
    }

    /// Write `buf` to stderr (async if needed) then finish with `exit_code`.
    /// Shared helper for builtins whose only failure path is "print error and
    /// exit", so each builtin doesn't repeat the needs_io branch.
    pub(crate) fn write_failing_error(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        buf: &[u8],
        exit_code: crate::shell::ExitCode,
    ) -> Yield {
        if let Some(fd) = Self::of(interp, cmd).stderr.needs_io() {
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Builtin);
            return interp.enqueue(fd, child, buf);
        }
        let _ = Self::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Self::done(interp, cmd, exit_code)
    }
}
