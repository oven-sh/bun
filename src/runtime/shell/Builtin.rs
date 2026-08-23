//! A builtin command runs inside a `Cmd` state node. The builtin stores the
//! `NodeId` of its owning Cmd and every method takes `&Interpreter`.

use bun_collections::VecExt;
use bun_jsc::PinnedArrayBuffer;
use bun_ptr::{JsCellRef, JsCellRefMut, RefPtr};
use std::rc::Rc;
use std::sync::Arc;

use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::interpreter::{
    CapturedBuf, Interpreter, NodeId, OutputNeedsIOSafeGuard, ParseError, is_pollable_from_mode,
    shell_openat,
};
use crate::shell::io::{InKind, OutFd, OutKind};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::states::cmd::{Cmd, CmdState};
use crate::shell::yield_::Yield;

pub struct Builtin {
    pub(crate) kind: Kind,
    /// argv[1..], each NUL-terminated (argv[0], the builtin name, stays on
    /// the Cmd). Moved out of the Cmd's `args` by `init`.
    pub args: Vec<Vec<u8>>,
    pub(crate) stdin: BuiltinInput,
    pub(crate) stdout: BuiltinIO,
    pub(crate) stderr: BuiltinIO,
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

    /// Borrow this builtin's state out of the Cmd node. An exclusive borrow
    /// of the node: keep it short and never hold it across a call that
    /// touches the same Cmd (`Builtin::of*`, `write_no_io`, `done`, ...).
    #[inline(always)]
    #[track_caller]
    fn state_mut(interp: &Interpreter, cmd: NodeId) -> JsCellRefMut<'_, Self> {
        JsCellRefMut::map(Builtin::of_mut(interp, cmd), |b| {
            Self::extract(&mut b.impl_)
        })
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
        pub enum Impl {
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
            pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
                // Match on a copied Kind, then
                // call the per-builtin `start(interp, cmd)`. Each builtin reaches its
                // own state via `Builtin::of_mut(interp, cmd).impl_`.
                match Self::kind_of(interp, cmd) {
                    $( Kind::$UV => crate::shell::builtins::$u_mod::$UT::start(interp, cmd), )*
                    $( Kind::$IV => crate::shell::builtins::$i_mod::$IT::start(interp, cmd), )*
                    $( Kind::$BV => crate::shell::builtins::$b_mod::$BT::start(interp, cmd), )*
                }
            }

            /// Hoisted dispatch for the `onIOWriterChunk` callback. `seq != 0`
            /// names a parked [`OutputTask`](crate::shell::interpreter::OutputTask)
            /// chunk of an ls/mkdir/touch/cp, or one of rm's numbered chunks.
            pub fn on_io_writer_chunk(
                interp: &Interpreter,
                cmd: NodeId,
                seq: u32,
                written: usize,
                err: Option<bun_sys::SystemError>,
            ) -> Yield {
                use crate::shell::interpreter::OutputTask;
                use crate::shell::builtins::{cp::Cp, ls::Ls, mkdir::Mkdir, touch::Touch};
                if seq != 0 {
                    return match Self::kind_of(interp, cmd) {
                        Kind::Ls => OutputTask::<Ls>::on_chunk(interp, cmd, seq, written, err),
                        Kind::Mkdir => OutputTask::<Mkdir>::on_chunk(interp, cmd, seq, written, err),
                        Kind::Touch => OutputTask::<Touch>::on_chunk(interp, cmd, seq, written, err),
                        Kind::Cp => OutputTask::<Cp>::on_chunk(interp, cmd, seq, written, err),
                        // rm numbers its verbose and error chunks only so that
                        // each is called back.
                        Kind::Rm => crate::shell::builtins::rm::Rm::on_io_writer_chunk(interp, cmd, written, err),
                        other => unreachable!("{} queues no numbered chunks", other.as_str()),
                    };
                }
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
        Seq      => (seq::Seq,          "seq",      b"usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n"),
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
pub enum IoKind {
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
pub enum BuiltinIO {
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
    Blob(Arc<BuiltinBlob>),
    Ignore,
}

/// Input stream of a builtin.
pub enum BuiltinInput {
    Fd(RefPtr<IOReader>),
    ArrayBuf { buf: PinnedArrayBuffer, i: u32 },
    Blob(Arc<BuiltinBlob>),
    Ignore,
}

/// Refcounted wrapper around a `webcore.Blob`. `Arc` provides the refcount;
/// `Drop` runs `Blob::deinit`.
pub struct BuiltinBlob {
    pub(crate) blob: crate::webcore::Blob,
}
// `BuiltinBlob` is auto-`Send + Sync`: its sole field is `webcore::Blob`,
// which already asserts `Send + Sync`.
const _: fn() = || {
    fn assert<T: Send + Sync>() {}
    assert::<BuiltinBlob>();
};

impl BuiltinIO {
    /// From the Cmd's IO::OutKind. `Rc::clone` (via `OutFd: Clone`) bumps
    /// the `IOWriter` refcount; `Drop` decrements it symmetrically. `target`
    /// is the shell-env bytelist this stream flushes to (Stdout or Stderr).
    fn from_out_kind(ok: &OutKind, target: IoKind) -> BuiltinIO {
        match ok {
            OutKind::Fd(fd) => BuiltinIO::Fd(fd.clone()),
            OutKind::Pipe => BuiltinIO::Buf(target),
            OutKind::Ignore => BuiltinIO::Ignore,
        }
    }

    /// Bump refcounts and return a shallow copy. Only reachable from the
    /// `duplicate_out` path, which fires before any `.jsbuf` redirect, so
    /// `ArrayBuf`/`Blob` are unreachable here. The `Buf` target is copied
    /// verbatim so stderr writes accumulate in (and flush from) stdout's
    /// buffer; that aliasing is the carried `IoKind`.
    fn dup_ref(&self) -> BuiltinIO {
        match self {
            BuiltinIO::Fd(fd) => BuiltinIO::Fd(fd.clone()),
            BuiltinIO::Buf(target) => BuiltinIO::Buf(*target),
            BuiltinIO::Ignore => BuiltinIO::Ignore,
            BuiltinIO::Blob(b) => BuiltinIO::Blob(Arc::clone(b)),
            BuiltinIO::ArrayBuf { .. } => {
                unreachable!("duplicate_out precedes jsbuf redirects")
            }
        }
    }

    #[inline]
    pub(crate) fn needs_io(&self) -> Option<OutputNeedsIOSafeGuard> {
        match self {
            BuiltinIO::Fd(_) => Some(OutputNeedsIOSafeGuard::OutputNeedsIo),
            _ => None,
        }
    }

    /// Body of [`Builtin::write_no_io`] with the Cmd split-borrow already
    /// performed by the caller. Exists so builtins whose payload lives in
    /// `Builtin.impl_` (disjoint from `stdout`/`stderr`) can write a borrowed
    /// slice without an intermediate heap clone. `shell` is the Cmd's env
    /// (`cmd.base.shell`); only used for the [`BuiltinIO::Buf`] arm.
    pub(crate) fn write_no_io_to(
        &mut self,
        shell: &crate::shell::interpreter::ShellExecEnv,
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
                let _ = shell.captured(*target).borrow_mut().append_slice(buf);
                Ok(buf.len())
            }
            BuiltinIO::ArrayBuf { buf: arraybuf, i } => {
                // `len = buf.len` stays usize so `i + len > byte_len` is
                // computed at usize width and cannot overflow; only the
                // stored cursor is u32.
                let idx = *i as usize;
                let total = arraybuf.byte_len;
                if idx >= total {
                    return Err(bun_sys::Error::from_code(
                        bun_sys::E::ENOSPC,
                        bun_sys::Tag::write,
                    ));
                }
                let write_len = (total - idx).min(buf.len());
                let dst = &mut arraybuf.slice_mut()[idx..idx + write_len];
                dst.copy_from_slice(&buf[..write_len]);
                *i = i.saturating_add(write_len as u32);
                Ok(write_len)
            }
            BuiltinIO::Blob(_) | BuiltinIO::Ignore => Ok(buf.len()),
        }
    }

    /// The writer and tee buffer, for callers holding the
    /// [`OutputNeedsIOSafeGuard`] that proves this is `Fd`.
    fn out_fd(
        &self,
        _safeguard: OutputNeedsIOSafeGuard,
    ) -> (RefPtr<IOWriter>, Option<CapturedBuf>) {
        match self {
            BuiltinIO::Fd(fd) => (fd.writer.clone(), fd.captured.clone()),
            _ => unreachable!("non-fd output; caller must check needs_io()"),
        }
    }
}

impl Builtin {
    fn out_fd(
        interp: &Interpreter,
        cmd: NodeId,
        to: IoKind,
        safeguard: OutputNeedsIOSafeGuard,
    ) -> (RefPtr<IOWriter>, Option<CapturedBuf>) {
        let me = Self::of(interp, cmd);
        match to {
            IoKind::Stdout => me.stdout.out_fd(safeguard),
            IoKind::Stderr => me.stderr.out_fd(safeguard),
        }
    }

    /// Queue `buf` on `to`'s IOWriter; `child`'s `on_io_writer_chunk` fires
    /// when the chunk completes. The Cmd node is not borrowed while the writer
    /// runs (it may call other children back, or this one on a synchronous
    /// failure).
    pub(crate) fn write_out(
        interp: &Interpreter,
        cmd: NodeId,
        to: IoKind,
        child: io_writer::ChildPtr,
        buf: &[u8],
        safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        let (writer, captured) = Self::out_fd(interp, cmd, to, safeguard);
        writer.enqueue(child, captured, buf)
    }

    /// [`write_out`](Self::write_out) with the bytes appended by `fill` (which
    /// may borrow the node; the borrow ends before the writer runs).
    pub(crate) fn write_out_with(
        interp: &Interpreter,
        cmd: NodeId,
        to: IoKind,
        child: io_writer::ChildPtr,
        safeguard: OutputNeedsIOSafeGuard,
        fill: impl FnOnce(&mut Vec<u8>),
    ) -> Yield {
        let (writer, captured) = Self::out_fd(interp, cmd, to, safeguard);
        writer.enqueue_with(child, captured, fill)
    }

    /// [`write_out`](Self::write_out), formatted with the optional
    /// `"{kind}: "` prefix.
    pub(crate) fn write_out_fmt(
        interp: &Interpreter,
        cmd: NodeId,
        to: IoKind,
        child: io_writer::ChildPtr,
        kind: Option<Kind>,
        args: core::fmt::Arguments<'_>,
        safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        let (writer, captured) = Self::out_fd(interp, cmd, to, safeguard);
        writer.enqueue_fmt_bltn(child, captured, kind, args)
    }
}

impl BuiltinInput {
    fn from_in_kind(ik: &InKind) -> BuiltinInput {
        match ik {
            // `Rc::clone` bumps the IOReader refcount.
            InKind::Fd(r) => BuiltinInput::Fd(r.clone()),
            InKind::Ignore => BuiltinInput::Ignore,
        }
    }

    #[inline]
    pub(crate) fn needs_io(&self) -> bool {
        matches!(self, BuiltinInput::Fd(_))
    }
}

impl Builtin {
    #[inline]
    pub(crate) fn args_slice(&self) -> &[Vec<u8>] {
        &self.args
    }

    /// [`parse_flags`](crate::shell::interpreter::parse_flags) over this
    /// builtin's argv. Returns the index of the first non-flag argument
    /// (`None`: there were no arguments at all).
    pub(crate) fn parse_flags<O: crate::shell::interpreter::FlagParser>(
        interp: &Interpreter,
        cmd: NodeId,
        opts: &mut O,
    ) -> Result<Option<usize>, ParseError> {
        let me = Self::of(interp, cmd);
        let args = me.args_slice();
        crate::shell::interpreter::parse_flags(opts, args)
            .map(|rest| rest.map(|rest| args.len() - rest.len()))
    }

    /// `argv[1..].len()`.
    #[inline]
    pub(crate) fn argc(interp: &Interpreter, cmd: NodeId) -> usize {
        Self::of(interp, cmd).args.len()
    }

    /// `PinnedArrayBuffer::drop`'s unpin would write to a `JSC::ArrayBuffer`
    /// impl the heap sweep already deleted; see
    /// `ShellSubprocess::defuse_array_buffer_unpins`. VM-shutdown finalizer
    /// only.
    #[cfg(not(windows))]
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

    /// `arg` (a NUL-terminated argv entry) up to its first NUL — what
    /// `execve` would see.
    #[inline]
    pub(crate) fn arg_bytes_of(arg: &[u8]) -> &[u8] {
        bun_core::slice_to_nul(arg)
    }

    /// Borrow `argv[1..][idx]` as `&[u8]` (NUL excluded).
    #[inline]
    pub(crate) fn arg_bytes(&self, idx: usize) -> &[u8] {
        Self::arg_bytes_of(&self.args[idx])
    }

    /// Borrow `argv[1..][idx]` as `&ZStr` (NUL-terminated view), for callers
    /// that pass the argument to a `&ZStr`-taking syscall wrapper without
    /// re-copying.
    #[inline]
    pub(crate) fn arg_zstr(&self, idx: usize) -> &bun_core::ZStr {
        let arg = &self.args[idx];
        debug_assert_eq!(arg.last(), Some(&0));
        bun_core::ZStr::from_buf(arg, arg.len() - 1)
    }

    /// Construct a `Builtin` for `kind`, install it into the owning Cmd's
    /// `exec` slot, then wire up file/jsbuf/`2>&1` redirections. Returns
    /// `None` (meaning: caller should now call `Builtin::start`). A
    /// `Some(yield)` return means setup wrote a failing error (or threw) and
    /// the caller should propagate that yield instead.
    pub(crate) fn init(interp: &Interpreter, cmd: NodeId, kind: Kind) -> Option<Yield> {
        use crate::shell::states::cmd::Exec;

        // Take argv[1..] from the Cmd's `args` (NUL-terminated by
        // `Cmd::transition_to_exec` before this is called); argv[0] stays.
        {
            let mut me = interp.as_cmd_mut(cmd);
            let args = me.args.split_off(1);
            // `Rc::clone` (inside `OutFd: Clone` / `InKind: Clone`) bumps
            // the `IOWriter`/`IOReader` refcount; the builtin's `Drop`
            // decrements it symmetrically. No double-deref.
            let (stdin, stdout, stderr) = (
                BuiltinInput::from_in_kind(&me.io.stdin),
                BuiltinIO::from_out_kind(&me.io.stdout, IoKind::Stdout),
                BuiltinIO::from_out_kind(&me.io.stderr, IoKind::Stderr),
            );
            me.exec = Exec::Builtin(Box::new(Builtin {
                kind,
                args,
                stdin,
                stdout,
                stderr,
                impl_: Self::make_impl(kind),
            }));
        }

        Self::init_redirections(interp, cmd, kind)
    }

    /// Opens redirect files / wires ArrayBuffer & Blob targets / handles
    /// `2>&1` (`duplicate_out`).
    fn init_redirections(interp: &Interpreter, cmd: NodeId, kind: Kind) -> Option<Yield> {
        // `node` points into the AST arena which outlives every state node (see Cmd::next).
        let node = interp.as_cmd(cmd).node;
        let node: &ast::Cmd = node.get();
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

                // `redirection_file` was NUL-terminated by Expansion; build a
                // `&ZStr` over it (path = bytes excluding the trailing NUL).
                // Clone the path bytes so the
                // `&mut interp` open call below doesn't overlap a borrow into
                // the Cmd node.
                let path_buf: Vec<u8> = {
                    let me = interp.as_cmd(cmd);
                    let raw = &me.redirection_file;
                    let len = raw.len().saturating_sub(1);
                    let mut v = raw[..len].to_vec();
                    v.push(0);
                    v
                };
                // SAFETY: `path_buf` ends in NUL by construction.
                let path = bun_core::ZStr::from_slice_with_nul(&path_buf[..]);
                let perm: bun_sys::Mode = 0o666;
                let cwd_fd = Self::cwd(interp, cmd);
                let evtloop = interp.event_loop;

                let mut pollable = false;
                let mut is_socket = false;
                let mut is_nonblocking = false;

                let redirfd: bun_sys::Fd = if redirect.stdin() {
                    match shell_openat(cwd_fd, path, redirect.to_flags(), perm) {
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
                    let result = bun_io::open_for_writing_impl(
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
                    );
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
                            #[cfg(windows)]
                            {
                                use bun_sys::FdExt as _;
                                match f.make_lib_uv_owned_for_syscall(
                                    bun_sys::Tag::open,
                                    bun_sys::ErrorCase::CloseOnFail,
                                ) {
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

                if redirect.stdin() {
                    let r = IOReader::init(redirfd, evtloop);
                    r.set_interp(interp);
                    Self::of_mut(interp, cmd).stdin = BuiltinInput::Fd(r);
                }

                if !redirect.stdout() && !redirect.stderr() {
                    return None;
                }

                // Honor the `pollable` computed by `open_for_writing_impl` on
                // POSIX so a FIFO/socket target (whose fd is now O_NONBLOCK)
                // takes the pollable path; Windows keeps the async writer.
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
                redirect_writer.set_interp(interp);

                if redirect.stdout() {
                    let mut me = Self::of_mut(interp, cmd);
                    me.stdout = BuiltinIO::Fd(OutFd {
                        writer: redirect_writer.clone(),
                        captured: None,
                    });
                }
                if redirect.stderr() {
                    let mut me = Self::of_mut(interp, cmd);
                    me.stderr = BuiltinIO::Fd(OutFd {
                        writer: redirect_writer,
                        captured: None,
                    });
                }
            }
            Some(ast::Redirect::JsBuf(jsbuf)) => {
                // ── JS object redirect (`> ${arraybuf}` / `> ${blob}`).
                let idx = jsbuf.idx as usize;
                let Some(global) = interp
                    .global_this_ref()
                    .filter(|_| idx < interp.jsobjs.len())
                else {
                    interp.throw(crate::shell::ShellErr::Custom(
                        b"Invalid JS object reference in shell"
                            .to_vec()
                            .into_boxed_slice(),
                    ));
                    return Some(Yield::failed());
                };
                let jsval = interp.jsobjs[idx];

                if jsval.js_type().is_array_buffer_like() {
                    // Each slot gets its own pin + GC root; `None` has thrown OOM.
                    let root = || {
                        let buf = PinnedArrayBuffer::root(global, jsval);
                        if buf.is_none() {
                            let _ = global.throw_out_of_memory();
                        }
                        buf
                    };
                    let mut me = Self::of_mut(interp, cmd);
                    if redirect.stdin() {
                        let Some(buf) = root() else {
                            return Some(Yield::failed());
                        };
                        me.stdin = BuiltinInput::ArrayBuf { buf, i: 0 };
                    }
                    if redirect.stdout() {
                        let Some(buf) = root() else {
                            return Some(Yield::failed());
                        };
                        me.stdout = BuiltinIO::ArrayBuf { buf, i: 0 };
                    }
                    if redirect.stderr() {
                        let Some(buf) = root() else {
                            return Some(Yield::failed());
                        };
                        me.stderr = BuiltinIO::ArrayBuf { buf, i: 0 };
                    }
                } else if let Some(taken) =
                    crate::webcore::body::Value::with_request_or_response(jsval, |body| {
                        let is_file_blob = matches!(body, crate::webcore::body::Value::Blob(b)
                            if !b.needs_to_read_file());
                        if (redirect.stdout() || redirect.stderr()) && !is_file_blob {
                            return None;
                        }
                        Some(body.use_())
                    })
                {
                    let Some(original_blob) = taken else {
                        let _ = global.throw(format_args!(
                            "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                        ));
                        return Some(Yield::failed());
                    };
                    if !redirect.stdin() && !redirect.stdout() && !redirect.stderr() {
                        drop(original_blob);
                        return None;
                    }
                    let blob = Arc::new(BuiltinBlob {
                        blob: original_blob.dupe(),
                    });
                    drop(original_blob);
                    let mut me = Self::of_mut(interp, cmd);
                    if redirect.stdin() {
                        me.stdin = BuiltinInput::Blob(Arc::clone(&blob));
                    }
                    if redirect.stdout() {
                        me.stdout = BuiltinIO::Blob(Arc::clone(&blob));
                    }
                    if redirect.stderr() {
                        me.stderr = BuiltinIO::Blob(blob);
                    }
                } else if let Some(blob_ref) = jsval.as_class_ref::<crate::webcore::Blob>() {
                    if (redirect.stdout() || redirect.stderr()) && !blob_ref.needs_to_read_file() {
                        let _ = global.throw(format_args!(
                            "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                        ));
                        return Some(Yield::failed());
                    }
                    let theblob = Arc::new(BuiltinBlob {
                        blob: blob_ref.dupe(),
                    });
                    let mut me = Self::of_mut(interp, cmd);
                    if redirect.stdin() {
                        me.stdin = BuiltinInput::Blob(theblob);
                    } else if redirect.stdout() {
                        me.stdout = BuiltinIO::Blob(theblob);
                    } else if redirect.stderr() {
                        me.stderr = BuiltinIO::Blob(theblob);
                    }
                } else {
                    let _ = global.throw(format_args!(
                        "Unknown JS value used in shell: {}",
                        jsval.fmt_string(global)
                    ));
                    return Some(Yield::failed());
                }
            }
            None if redirect.duplicate_out() => {
                // `2>&1` (stderr=true,dup_out=true) → stderr := stdout
                // `1>&2` (stdout=true,dup_out=true) → stdout := stderr
                let mut me = Self::of_mut(interp, cmd);
                let me = &mut *me;
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

    /// Sets the owning Cmd's state to
    /// `WaitingWriteErr` and writes to the *Cmd's* `io.stderr` (not the
    /// builtin's, which may already have been redirected). Hoisted here
    /// because `init_redirections` and `Cmd::transition_to_exec` (the
    /// "command not found" / spawn-error paths) are the only callers.
    pub(crate) fn cmd_write_failing_error(
        interp: &Interpreter,
        cmd: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let mut buf = Vec::new();
        let _ = buf.write_fmt(args);
        let stderr = interp.as_cmd(cmd).io.stderr.clone();
        if let OutKind::Fd(fd) = stderr {
            // Only the `Fd` arm transitions state.
            interp.as_cmd_mut(cmd).state = CmdState::WaitingWriteErr;
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Cmd);
            return fd.writer.enqueue(child, fd.captured, &buf);
        }
        // No-IO path: append to the shell env's captured stderr and finish
        // synchronously with exit 1 (Cmd::on_io_writer_chunk's behaviour).
        if let OutKind::Pipe = stderr {
            let _ = interp
                .as_cmd(cmd)
                .base
                .shell()
                .buffered_stderr
                .borrow_mut()
                .append_slice(&buf);
        }
        let parent = interp.as_cmd(cmd).base.parent;
        interp.child_done(parent, cmd, 1)
    }

    /// Finish the builtin with `exit_code` and signal the owning Cmd.
    pub(crate) fn done(interp: &Interpreter, cmd: NodeId, exit_code: ExitCode) -> Yield {
        // Output is written through immediately in `write_no_io`, so there
        // is nothing to flush here.
        Cmd::on_exec_done(interp, cmd, exit_code)
    }

    /// Look up the Builtin inside a Cmd's `exec` slot. A shared borrow of the
    /// Cmd node: release it before anything borrows that node exclusively.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn of(interp: &Interpreter, cmd: NodeId) -> JsCellRef<'_, Builtin> {
        JsCellRef::map(interp.as_cmd(cmd), |c| match &c.exec {
            crate::shell::states::cmd::Exec::Builtin(b) => &**b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        })
    }

    /// [`of`](Self::of), mutably.
    #[inline(always)]
    #[track_caller]
    pub(crate) fn of_mut(interp: &Interpreter, cmd: NodeId) -> JsCellRefMut<'_, Builtin> {
        JsCellRefMut::map(interp.as_cmd_mut(cmd), |c| match &mut c.exec {
            crate::shell::states::cmd::Exec::Builtin(b) => &mut **b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        })
    }

    #[inline]
    fn kind_of(interp: &Interpreter, cmd: NodeId) -> Kind {
        Self::of(interp, cmd).kind
    }

    /// Returns the bytes available on stdin when it is *not* an async fd
    /// (arraybuf / piped buf / blob).
    pub(crate) fn read_stdin_no_io(&self) -> &[u8] {
        match &self.stdin {
            BuiltinInput::ArrayBuf { buf, .. } => buf.slice(),
            BuiltinInput::Blob(b) => b.blob.shared_view(),
            BuiltinInput::Fd(_) | BuiltinInput::Ignore => b"",
        }
    }

    /// Write `buf` to stdout/stderr without going through IOWriter (the
    /// stream is a captured buffer / arraybuffer / blob / /dev/null).
    ///
    /// Returns `Err(ENOSPC)` when an ArrayBuffer target is already full.
    /// **WARNING**: caller must have checked `needs_io() == None` first.
    pub(crate) fn write_no_io(
        interp: &Interpreter,
        cmd: NodeId,
        io_kind: IoKind,
        buf: &[u8],
    ) -> bun_sys::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        // Split-borrow the Cmd so `shell`
        // and the builtin's stdout/stderr are accessible simultaneously.
        let mut cmd_node = interp.as_cmd_mut(cmd);
        let cmd_node = &mut *cmd_node;
        let shell = cmd_node.base.shell.borrow();
        let crate::shell::states::cmd::Exec::Builtin(me) = &mut cmd_node.exec else {
            panic!("Cmd {} is not running a builtin", cmd);
        };
        let out: &mut BuiltinIO = match io_kind {
            IoKind::Stdout => &mut me.stdout,
            IoKind::Stderr => &mut me.stderr,
        };
        out.write_no_io_to(&shell, buf)
    }

    /// Shell exec env of the owning Cmd (a clone of the handle, so the Cmd
    /// node is not borrowed while it is used).
    #[inline]
    pub fn shell(interp: &Interpreter, cmd: NodeId) -> crate::shell::interpreter::EnvRc {
        Rc::clone(&interp.as_cmd(cmd).base.shell)
    }

    /// Event loop handle (forwarded from the interpreter).
    #[inline]
    pub(crate) fn event_loop(
        interp: &Interpreter,
        _cmd: NodeId,
    ) -> crate::shell::interpreter::EventLoopHandle {
        interp.event_loop
    }

    /// Cwd fd of the owning Cmd's shell env.
    #[inline]
    pub(crate) fn cwd(interp: &Interpreter, cmd: NodeId) -> bun_sys::Fd {
        interp.as_cmd(cmd).base.shell().cwd_fd
    }

    /// Format `"{kind}: {fmt}"` into a fresh heap buffer.
    pub(crate) fn fmt_error_arena(kind: Option<Kind>, args: core::fmt::Arguments<'_>) -> Vec<u8> {
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
                    Self::fmt_error_arena(
                        Some(kind),
                        format_args!("{}\n", bstr::BStr::new(sys.message.byte_slice())),
                    )
                } else {
                    Self::fmt_error_arena(
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
                Self::fmt_error_arena(Some(kind), format_args!("{}\n", bstr::BStr::new(s)))
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
                    return Self::fmt_error_arena(
                        Some(kind),
                        format_args!("{}: {}\n", bstr::BStr::new(&err.path[..]), message),
                    );
                }
                return Self::fmt_error_arena(Some(kind), format_args!("{}\n", message));
            }
        }
        Self::fmt_error_arena(Some(kind), format_args!("unknown error {}\n", err.errno))
    }

    /// Shared failure path for builtins whose option parser returns
    /// [`ParseError`]. Formats the canonical three-arm message
    /// (`illegal option` / usage / `unsupported option`), runs `set_wait_err`
    /// so the per-builtin state machine can move to its `WaitingWriteErr`
    /// variant, then writes the message to stderr and finishes with exit 1.
    pub(crate) fn fail_parse(
        interp: &Interpreter,
        cmd: NodeId,
        kind: Kind,
        e: &ParseError,
        set_wait_err: impl FnOnce(),
    ) -> Yield {
        let buf: Vec<u8> = match e {
            ParseError::IllegalOption(_) => Self::fmt_error_arena(
                Some(kind),
                format_args!("illegal option -- {}\n", bstr::BStr::new(e.opt())),
            ),
            ParseError::ShowUsage => kind.usage_string().to_vec(),
            ParseError::Unsupported(_) => Self::fmt_error_arena(
                Some(kind),
                format_args!(
                    "unsupported option, please open a GitHub issue -- {}\n",
                    bstr::BStr::new(e.opt())
                ),
            ),
        };
        set_wait_err();
        Self::write_failing_error(interp, cmd, &buf, 1)
    }

    /// Write `buf` to stderr (async if needed) then finish with `exit_code`.
    /// Shared helper for builtins whose only failure path is "print error and
    /// exit", so each builtin doesn't repeat the needs_io branch.
    pub(crate) fn write_failing_error(
        interp: &Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: crate::shell::ExitCode,
    ) -> Yield {
        let needs_io = Self::of(interp, cmd).stderr.needs_io();
        if let Some(safeguard) = needs_io {
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Builtin);
            return Self::write_out(interp, cmd, IoKind::Stderr, child, buf, safeguard);
        }
        let _ = Self::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Self::done(interp, cmd, exit_code)
    }
}

// Cleanup: every `Impl` variant owns its state via `Box`/`Vec`/`Arc`, and
// `BuiltinIO`/`BuiltinInput` hold `Rc<IOWriter>` / `Rc<IOReader>` /
// `PinnedArrayBuffer` / `Arc<BuiltinBlob>` whose `Drop` already decrements
// the refcount. So cleanup is fully covered by `Drop` on `Box<Builtin>`
// (called from `Cmd::deinit`). No explicit deinit needed.
