//! A builtin command runs inside a `Cmd` state node. In Zig the builtin
//! recovered its parent `*Cmd` via `@fieldParentPtr`; in the NodeId port the
//! builtin stores the `NodeId` of its owning Cmd and every method takes
//! `&mut Interpreter`.

use bun_collections::{VecExt, ByteVecExt};
use core::ffi::c_char;
use std::sync::Arc;

use crate::shell::ast;
use crate::shell::interpreter::{
    is_pollable_from_mode, shell_openat, Interpreter, NodeId, OutputNeedsIOSafeGuard,
};
use crate::shell::io::{InKind, OutFd, OutKind};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::states::cmd::{Cmd, CmdState};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct Builtin {
    /// Owning Cmd node. Replaces Zig's `@fieldParentPtr("impl", ...)` chain.
    pub cmd: NodeId,
    pub kind: Kind,
    /// argv[1..] as NUL-terminated strings (argv[0] is the builtin name).
    /// Points into the Cmd's `args` storage.
    pub args: Vec<*const c_char>,
    pub stdin: BuiltinInput,
    pub stdout: BuiltinIO,
    pub stderr: BuiltinIO,
    /// Set by `done()` and stashed by `write_failing_error` so the async
    /// `on_io_writer_chunk` path can recover the intended exit code.
    pub exit_code: Option<ExitCode>,
    /// Scratch for `fmt_error_arena` (replaces the Zig per-Cmd bump arena).
    /// One outstanding error string at a time — same constraint as Zig, where
    /// the arena is reset per-builtin.
    pub err_buf: Vec<u8>,
    pub impl_: Impl,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum Kind {
    Cd, Echo, Export, Exit, Pwd, True, False, Which, Rm, Mv, Ls, Mkdir,
    Touch, Cat, Cp, Seq, Dirname, Basename, Yes,
}

impl Kind {
    /// Builtins disabled on POSIX (delegate to the system binary) unless the
    /// experimental feature flag is set. Spec: Builtin.zig `Kind.DISABLED_ON_POSIX`.
    pub const DISABLED_ON_POSIX: &'static [Kind] = &[Kind::Cat, Kind::Cp];

    fn force_enable_on_posix() -> bool {
        bun_core::env_var::feature_flag::BUN_ENABLE_EXPERIMENTAL_SHELL_BUILTINS
            .get()
            .unwrap_or(false)
    }

    /// Spec: Builtin.zig `Kind.fromStr`. Maps argv[0] to a builtin kind, or
    /// `None` to fall through to subprocess spawn.
    pub fn from_argv0(s: &[u8]) -> Option<Kind> {
        let result = match s {
            b"cat" => Kind::Cat,
            b"touch" => Kind::Touch,
            b"mkdir" => Kind::Mkdir,
            b"export" => Kind::Export,
            b"cd" => Kind::Cd,
            b"echo" => Kind::Echo,
            b"pwd" => Kind::Pwd,
            b"which" => Kind::Which,
            b"rm" => Kind::Rm,
            b"mv" => Kind::Mv,
            b"ls" => Kind::Ls,
            b"exit" => Kind::Exit,
            b"true" => Kind::True,
            b"false" => Kind::False,
            b"yes" => Kind::Yes,
            b"seq" => Kind::Seq,
            b"dirname" => Kind::Dirname,
            b"basename" => Kind::Basename,
            b"cp" => Kind::Cp,
            _ => return None,
        };
        if cfg!(windows) || Self::force_enable_on_posix() {
            return Some(result);
        }
        if Self::DISABLED_ON_POSIX.contains(&result) {
            return None;
        }
        Some(result)
    }

    /// Spec: Builtin.zig `Kind.usageString`.
    pub fn usage_string(self) -> &'static [u8] {
        match self {
            Kind::Cat => b"usage: cat [-belnstuv] [file ...]\n",
            Kind::Touch => b"usage: touch [-A [-][[hh]mm]SS] [-achm] [-r file] [-t [[CC]YY]MMDDhhmm[.SS]]\n       [-d YYYY-MM-DDThh:mm:SS[.frac][tz]] file ...\n",
            Kind::Mkdir => b"usage: mkdir [-pv] [-m mode] directory_name ...\n",
            Kind::Export => b"",
            Kind::Cd => b"",
            Kind::Echo => b"",
            Kind::Pwd => b"",
            Kind::Which => b"",
            Kind::Rm => b"usage: rm [-f | -i] [-dIPRrvWx] file ...\n       unlink [--] file\n",
            Kind::Mv => b"usage: mv [-f | -i | -n] [-hv] source target\n       mv [-f | -i | -n] [-v] source ... directory\n",
            Kind::Ls => b"usage: ls [-@ABCFGHILOPRSTUWabcdefghiklmnopqrstuvwxy1%,] [--color=when] [-D format] [file ...]\n",
            Kind::Exit => b"usage: exit [n]\n",
            Kind::True => b"",
            Kind::False => b"",
            Kind::Yes => b"usage: yes [expletive]\n",
            Kind::Seq => b"usage: seq [-w] [-f format] [-s string] [-t string] [first [incr]] last\n",
            Kind::Dirname => b"usage: dirname string\n",
            Kind::Basename => b"usage: basename string\n",
            Kind::Cp => b"usage: cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file target_file\n       cp [-R [-H | -L | -P]] [-fi | -n] [-aclpsvXx] source_file ... target_directory\n",
        }
    }

    /// Lowercase tag for error prefixes (`"{kind}: ..."`). Spec: Zig
    /// `@tagName(kind)`.
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Cat => "cat",
            Kind::Touch => "touch",
            Kind::Mkdir => "mkdir",
            Kind::Export => "export",
            Kind::Cd => "cd",
            Kind::Echo => "echo",
            Kind::Pwd => "pwd",
            Kind::Which => "which",
            Kind::Rm => "rm",
            Kind::Mv => "mv",
            Kind::Ls => "ls",
            Kind::Exit => "exit",
            Kind::True => "true",
            Kind::False => "false",
            Kind::Yes => "yes",
            Kind::Seq => "seq",
            Kind::Dirname => "dirname",
            Kind::Basename => "basename",
            Kind::Cp => "cp",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IoKind { Stdin, Stdout, Stderr }

// ──────────────────────────────────────────────────────────────────────────
// BuiltinIO — Spec: Builtin.zig `BuiltinIO.{Output,Input}`.
//
// Distinct from `IO::OutKind` because builtins can target ArrayBuffer/Blob
// JS objects (`> ${buf}`) and accumulate into a per-builtin `.buf` when the
// Cmd's IO is `.pipe`. The `.buf` arm is reshaped in the NodeId port: instead
// of a local Vec flushed in `done()`, `write_no_io` appends straight to the
// shell env's captured buffer (one less copy). The variant carries its flush
// target so `2>&1` (which makes `stderr` a shallow copy of `stdout`) routes
// stderr writes to `buffered_stdout`, matching the Zig aliasing semantics.
// ──────────────────────────────────────────────────────────────────────────

/// One output stream of a builtin (stdout or stderr). Spec: Builtin.zig
/// `BuiltinIO.Output`.
pub enum BuiltinIO {
    /// Async writer (real fd). `needs_io()` returns Some.
    Fd(OutFd),
    /// Captured pipe — writes go to the shell env's `_buffered_{stdout,stderr}`.
    /// PORT NOTE: Zig kept a local `ArrayList(u8)` here and flushed it in
    /// `done()`; the NodeId port writes through immediately (see module doc).
    /// The payload names which shell-env bytelist to append to — set at
    /// `from_out_kind` and copied verbatim by `dup_ref` so `2>&1` keeps
    /// stderr aimed at stdout's buffer.
    Buf(IoKind),
    ArrayBuf { buf: crate::jsc::array_buffer::ArrayBufferStrong, i: u32 },
    Blob(Arc<BuiltinBlob>),
    Ignore,
}

/// Input stream of a builtin. Spec: Builtin.zig `BuiltinIO.Input`.
pub enum BuiltinInput {
    Fd(Arc<IOReader>),
    /// Buffer not owned by the builtin (Zig: `array list not owned by this
    /// type`). In the NodeId port no producer wires this yet; reserved for
    /// pipeline-from-builtin.
    Buf(Vec<u8>),
    ArrayBuf { buf: crate::jsc::array_buffer::ArrayBufferStrong, i: u32 },
    Blob(Arc<BuiltinBlob>),
    Ignore,
}

/// Spec: Builtin.zig `BuiltinIO.Blob` — refcounted wrapper around a
/// `webcore.Blob`. `Arc` provides the refcount; `Drop` runs `Blob::deinit`.
pub struct BuiltinBlob {
    pub blob: crate::webcore::Blob,
}
// `BuiltinBlob` is auto-`Send + Sync`: its sole field is `webcore::Blob`,
// which already asserts `Send + Sync`. No `unsafe impl` needed.
const _: fn() = || { fn assert<T: Send + Sync>() {} assert::<BuiltinBlob>(); };

impl BuiltinIO {
    /// From the Cmd's IO::OutKind. Spec: Builtin.zig `init` stdin/stdout/stderr
    /// switch — `.fd` → `dupeRef`, `.pipe` → `.buf`, `.ignore` → `.ignore`.
    /// `Arc::clone` (via `OutFd: Clone`) IS the `dupeRef` — it bumps the
    /// `IOWriter` refcount; `Drop` decrements it symmetrically. `target` is
    /// the shell-env bytelist this stream flushes to (Stdout or Stderr).
    fn from_out_kind(ok: &OutKind, target: IoKind) -> BuiltinIO {
        match ok {
            OutKind::Fd(fd) => BuiltinIO::Fd(fd.clone()),
            OutKind::Pipe => BuiltinIO::Buf(target),
            OutKind::Ignore => BuiltinIO::Ignore,
        }
    }

    /// Spec: Builtin.zig `BuiltinIO.Output.ref` — bump refcounts and return a
    /// shallow copy. Only reachable from the `duplicate_out` path, which fires
    /// before any `.jsbuf` redirect, so `ArrayBuf`/`Blob` are unreachable here.
    /// The `Buf` target is copied verbatim: in Zig `stderr = stdout.ref().*`
    /// shallow-copies stdout's ArrayList so stderr writes accumulate in (and
    /// flush from) stdout's buffer; here that aliasing is the carried `IoKind`.
    fn dup_ref(&self) -> BuiltinIO {
        match self {
            BuiltinIO::Fd(fd) => BuiltinIO::Fd(fd.clone()),
            BuiltinIO::Buf(target) => BuiltinIO::Buf(*target),
            BuiltinIO::Ignore => BuiltinIO::Ignore,
            BuiltinIO::Blob(b) => BuiltinIO::Blob(b.clone()),
            BuiltinIO::ArrayBuf { .. } => {
                unreachable!("duplicate_out precedes jsbuf redirects")
            }
        }
    }

    #[inline]
    pub fn needs_io(&self) -> Option<OutputNeedsIOSafeGuard> {
        match self {
            BuiltinIO::Fd(_) => Some(OutputNeedsIOSafeGuard::OutputNeedsIo),
            _ => None,
        }
    }

    /// Body of [`Builtin::write_no_io`] with the Cmd split-borrow already
    /// performed by the caller. Exists so builtins whose payload lives in
    /// `Builtin.impl_` (disjoint from `stdout`/`stderr`) can write a borrowed
    /// slice without an intermediate heap clone.
    ///
    /// Spec: Builtin.zig `writeNoIO` (match arm body).
    ///
    /// # Safety
    /// `shell` must point to the live `ShellExecEnv` owning this builtin
    /// (i.e. `cmd.base.shell`); only dereferenced for the [`BuiltinIO::Buf`]
    /// arm.
    pub unsafe fn write_no_io_to(
        &mut self,
        shell: *mut crate::shell::interpreter::ShellExecEnv,
        buf: &[u8],
    ) -> bun_sys::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        match self {
            BuiltinIO::Fd(_) => panic!(
                "write_no_io called on fd output; caller must check needs_io()"
            ),
            BuiltinIO::Buf(target) => {
                // PORT NOTE: Zig appended to a local `io.buf` and flushed in
                // `done()` to `buffered_{stdout,stderr}` keyed on which field
                // the buffer lives in. The NodeId port writes straight through;
                // `target` is that field identity, fixed at construction and
                // preserved across `dup_ref` so `2>&1` lands in stdout's
                // bytelist (matching Zig's shallow-copied ArrayList aliasing).
                // SAFETY: caller contract — shell env outlives the Cmd node;
                // single-threaded.
                let captured = unsafe {
                    match *target {
                        IoKind::Stdout => (*shell).buffered_stdout(),
                        IoKind::Stderr | IoKind::Stdin => (*shell).buffered_stderr(),
                    }
                };
                // SAFETY: `captured` points into a live `ShellExecEnv` Bufio.
                bun_core::handle_oom(unsafe { (*captured).append_slice(buf) });
                Ok(buf.len())
            }
            BuiltinIO::ArrayBuf { buf: arraybuf, i } => {
                // Spec: Builtin.zig writeNoIO .arraybuf — `len = buf.len` stays
                // usize so `i + len > byte_len` is computed at usize width and
                // cannot overflow. Mirror that here; only the stored cursor is u32.
                let idx = *i as usize;
                let total = arraybuf.array_buffer.byte_len as usize;
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

    /// Queue `buf` on this stream's IOWriter and arrange for `child`'s
    /// `on_io_writer_chunk` to fire when the chunk completes. Spec: Builtin.zig
    /// `BuiltinIO.Output.enqueue` — delegates to `fd.writer.enqueue` passing
    /// `fd.captured` as the tee bytelist.
    ///
    /// `_safeguard` proves the caller checked `needs_io()`.
    pub fn enqueue(
        &mut self,
        child: io_writer::ChildPtr,
        buf: &[u8],
        _safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        match self {
            BuiltinIO::Fd(fd) => fd.writer.enqueue(child, fd.captured, buf),
            _ => unreachable!("enqueue() on non-fd output; caller must check needs_io()"),
        }
    }

    /// Spec: Builtin.zig `BuiltinIO.Output.enqueueFmtBltn` — format with the
    /// optional `"{kind}: "` prefix and enqueue on the underlying IOWriter.
    pub fn enqueue_fmt(
        &mut self,
        child: io_writer::ChildPtr,
        kind: Option<Kind>,
        args: core::fmt::Arguments<'_>,
        _safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        match self {
            BuiltinIO::Fd(fd) => fd.writer.enqueue_fmt_bltn(child, fd.captured, kind, args),
            _ => unreachable!("enqueue_fmt() on non-fd output; caller must check needs_io()"),
        }
    }
}

impl BuiltinInput {
    fn from_in_kind(ik: &InKind) -> BuiltinInput {
        match ik {
            // `Arc::clone` IS the `dupeRef` (bumps the IOReader refcount).
            InKind::Fd(r) => BuiltinInput::Fd(r.clone()),
            InKind::Ignore => BuiltinInput::Ignore,
        }
    }

    #[inline]
    pub fn needs_io(&self) -> bool {
        matches!(self, BuiltinInput::Fd(_))
    }
}

/// Per-builtin state. In Zig this was a `union(Kind)`; in Rust an enum.
pub enum Impl {
    True,
    False,
    Pwd(crate::shell::builtins::pwd::Pwd),
    Exit(crate::shell::builtins::exit::Exit),
    Basename(crate::shell::builtins::basename::Basename),
    Dirname(crate::shell::builtins::dirname::Dirname),
    Cd(crate::shell::builtins::cd::Cd),
    Echo(crate::shell::builtins::echo::Echo),
    Export(crate::shell::builtins::export::Export),
    // Heavy builtins boxed to keep `Node` small.
    Cat(Box<crate::shell::builtins::cat::Cat>),
    Mv(Box<crate::shell::builtins::mv::Mv>),
    Rm(Box<crate::shell::builtins::rm::Rm>),
    Which(Box<crate::shell::builtins::which::Which>),
    Ls(Box<crate::shell::builtins::ls::Ls>),
    Mkdir(Box<crate::shell::builtins::mkdir::Mkdir>),
    Touch(Box<crate::shell::builtins::touch::Touch>),
    Cp(Box<crate::shell::builtins::cp::Cp>),
    Seq(Box<crate::shell::builtins::seq::Seq>),
    Yes(Box<crate::shell::builtins::yes::Yes>),
}

impl Builtin {
    #[inline]
    pub fn args_slice(&self) -> &[*const c_char] {
        &self.args
    }

    /// Construct a `Builtin` for `kind`, install it into the owning Cmd's
    /// `exec` slot, then wire up file/jsbuf/`2>&1` redirections. Returns
    /// `None` (meaning: caller should now call `Builtin::start`). A
    /// `Some(yield)` return means setup wrote a failing error (or threw) and
    /// the caller should propagate that yield instead.
    ///
    /// Spec: Builtin.zig `init()`.
    pub fn init(interp: &mut Interpreter, cmd: NodeId, kind: Kind) -> Option<Yield> {
        use crate::shell::builtins;
        use crate::shell::states::cmd::Exec;

        // Borrow argv[1..] as `*const c_char` into the Cmd's `args` storage.
        // The Cmd's `args: Vec<Vec<u8>>` are NUL-terminated by
        // `Cmd::transition_to_exec` before this is called.
        let (args, stdin, stdout, stderr) = {
            let me = interp.as_cmd(cmd);
            let mut argv: Vec<*const c_char> = Vec::with_capacity(me.args.len().saturating_sub(1));
            for a in me.args.iter().skip(1) {
                argv.push(a.as_ptr().cast::<c_char>());
            }
            // Spec: `.fd → dupeRef`. `Arc::clone` (inside `OutFd: Clone` /
            // `InKind: Clone`) bumps the `IOWriter`/`IOReader` refcount; the
            // builtin's `Drop` decrements it symmetrically. No double-deref.
            (
                argv,
                BuiltinInput::from_in_kind(&me.io.stdin),
                BuiltinIO::from_out_kind(&me.io.stdout, IoKind::Stdout),
                BuiltinIO::from_out_kind(&me.io.stderr, IoKind::Stderr),
            )
        };

        let impl_ = match kind {
            Kind::True => Impl::True,
            Kind::False => Impl::False,
            Kind::Pwd => Impl::Pwd(builtins::pwd::Pwd::default()),
            Kind::Exit => Impl::Exit(builtins::exit::Exit::default()),
            Kind::Basename => Impl::Basename(builtins::basename::Basename::default()),
            Kind::Dirname => Impl::Dirname(builtins::dirname::Dirname::default()),
            Kind::Cd => Impl::Cd(builtins::cd::Cd::default()),
            Kind::Echo => Impl::Echo(builtins::echo::Echo::default()),
            Kind::Export => Impl::Export(builtins::export::Export::default()),
            Kind::Cat => Impl::Cat(Box::default()),
            Kind::Mv => Impl::Mv(Box::default()),
            Kind::Rm => Impl::Rm(Box::default()),
            Kind::Which => Impl::Which(Box::default()),
            Kind::Ls => Impl::Ls(Box::default()),
            Kind::Mkdir => Impl::Mkdir(Box::default()),
            Kind::Touch => Impl::Touch(Box::default()),
            Kind::Cp => Impl::Cp(Box::default()),
            Kind::Seq => Impl::Seq(Box::default()),
            Kind::Yes => Impl::Yes(Box::default()),
        };

        interp.as_cmd_mut(cmd).exec = Exec::Builtin(Box::new(Builtin {
            cmd,
            kind,
            args,
            stdin,
            stdout,
            stderr,
            exit_code: None,
            err_buf: Vec::new(),
            impl_,
        }));

        Self::init_redirections(interp, cmd, kind)
    }

    /// Spec: Builtin.zig `initRedirections` (lines 413-627). Opens redirect
    /// files / wires ArrayBuffer & Blob targets / handles `2>&1` (`duplicate_out`).
    fn init_redirections(interp: &mut Interpreter, cmd: NodeId, kind: Kind) -> Option<Yield> {
        // SAFETY: `node` points into the AST arena which outlives every state
        // node (see Cmd::next).
        let node: &ast::Cmd = unsafe { &*interp.as_cmd(cmd).node };
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
                // PORT NOTE: reshaped for borrowck — clone path bytes so the
                // `&mut interp` open call below doesn't overlap a borrow into
                // the Cmd node.
                let path_buf: Vec<u8> = {
                    let raw = &interp.as_cmd(cmd).redirection_file;
                    let len = raw.len().saturating_sub(1);
                    let mut v = raw[..len].to_vec();
                    v.push(0);
                    v
                };
                // SAFETY: `path_buf` ends in NUL by construction.
                let path = unsafe {
                    bun_core::ZStr::from_raw(path_buf.as_ptr(), path_buf.len() - 1)
                };
                let perm: bun_sys::Mode = 0o666;
                let cwd_fd = Self::cwd(interp, cmd);
                let evtloop = interp.event_loop;

                // Regular files are not pollable on linux/macos.
                let is_pollable_default: bool = cfg!(windows);

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
                        path,
                        redirect.to_flags(),
                        perm,
                        &mut pollable,
                        &mut is_socket,
                        false,
                        &mut is_nonblocking,
                        (),
                        |_| {},
                        is_pollable_from_mode,
                        // Spec: passes `ShellSyscall.openat`. The Rust
                        // `shell_openat` has the matching `(Fd,&ZStr,i32,Mode)`
                        // signature.
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
                    let me = Self::of_mut(interp, cmd);
                    me.stdin = BuiltinInput::Fd(IOReader::init(redirfd, evtloop));
                }

                if !redirect.stdout() && !redirect.stderr() {
                    return None;
                }

                // Spec (Builtin.zig:429/502): the IOWriter receives the
                // hardcoded platform const `is_pollable` (false on POSIX, true
                // on Windows); the `var pollable` out-param populated by
                // `openForWritingImpl` is a dead store in Zig and is ignored
                // here too so polling behaviour matches the spec exactly.
                let _ = pollable;
                let redirect_writer = IOWriter::init(
                    redirfd,
                    io_writer::Flags {
                        pollable: is_pollable_default,
                        nonblock: is_nonblocking,
                        is_socket,
                        ..Default::default()
                    },
                    evtloop,
                );
                // `defer redirect_writer.deref()` — `redirect_writer: Arc` drops
                // here; each assigned slot holds its own clone.

                if redirect.stdout() {
                    let me = Self::of_mut(interp, cmd);
                    me.stdout = BuiltinIO::Fd(OutFd {
                        writer: redirect_writer.clone(),
                        captured: None,
                    });
                }
                if redirect.stderr() {
                    let me = Self::of_mut(interp, cmd);
                    me.stderr = BuiltinIO::Fd(OutFd {
                        writer: redirect_writer.clone(),
                        captured: None,
                    });
                }
            }
            Some(ast::Redirect::JsBuf(jsbuf)) => {
                // ── JS object redirect (`> ${arraybuf}` / `> ${blob}`).
                let idx = jsbuf.idx as usize;
                let global = interp.global_this;
                if global.is_null() || idx >= interp.jsobjs.len() {
                    interp.throw(crate::shell::ShellErr::Custom(
                        b"Invalid JS object reference in shell"
                            .to_vec()
                            .into_boxed_slice(),
                    ));
                    return Some(Yield::failed());
                }
                // SAFETY: `global_this` is set by `create_shell_interpreter`
                // and outlives the interpreter.
                let global = unsafe { &*global };
                let jsval = interp.jsobjs[idx];

                if let Some(buf) = jsval.as_array_buffer(global) {
                    // Each slot gets its own Strong (sharing one would
                    // double-free on Drop).
                    let mk = || crate::jsc::array_buffer::ArrayBufferStrong {
                        array_buffer: buf,
                        held: crate::jsc::StrongOptional::create(buf.value, global),
                    };
                    let me = Self::of_mut(interp, cmd);
                    if redirect.stdin() {
                        me.stdin = BuiltinInput::ArrayBuf { buf: mk(), i: 0 };
                    }
                    if redirect.stdout() {
                        me.stdout = BuiltinIO::ArrayBuf { buf: mk(), i: 0 };
                    }
                    if redirect.stderr() {
                        me.stderr = BuiltinIO::ArrayBuf { buf: mk(), i: 0 };
                    }
                } else if let Some(body) = crate::webcore::body::Value::from_request_or_response(jsval) {
                    // SAFETY: returned a live JSC-owned `*mut Value` borrowed
                    // from a Response/Request wrapper.
                    let body = unsafe { &mut *body };
                    // Spec: `body.* == .Blob and !body.Blob.needsToReadFile()`.
                    let is_file_blob = matches!(body, crate::webcore::body::Value::Blob(b)
                        if !b.needs_to_read_file());
                    if (redirect.stdout() || redirect.stderr()) && !is_file_blob {
                        let _ = global.throw(format_args!(
                            "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                        ));
                        return Some(Yield::failed());
                    }
                    let original_blob = body.use_();
                    if !redirect.stdin() && !redirect.stdout() && !redirect.stderr() {
                        drop(original_blob);
                        return None;
                    }
                    let blob = Arc::new(BuiltinBlob { blob: original_blob.dupe() });
                    drop(original_blob);
                    let me = Self::of_mut(interp, cmd);
                    if redirect.stdin() {
                        me.stdin = BuiltinInput::Blob(blob.clone());
                    }
                    if redirect.stdout() {
                        me.stdout = BuiltinIO::Blob(blob.clone());
                    }
                    if redirect.stderr() {
                        me.stderr = BuiltinIO::Blob(blob.clone());
                    }
                } else if let Some(blob_ptr) = jsval.as_::<crate::webcore::Blob>() {
                    // SAFETY: `as_` returns a live JSC-owned `*mut Blob`.
                    let blob_ref = unsafe { &*blob_ptr };
                    if (redirect.stdout() || redirect.stderr()) && !blob_ref.needs_to_read_file() {
                        let _ = global.throw(format_args!(
                            "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                        ));
                        return Some(Yield::failed());
                    }
                    let theblob = Arc::new(BuiltinBlob { blob: blob_ref.dupe() });
                    let me = Self::of_mut(interp, cmd);
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

    /// Spec: Cmd.zig `writeFailingError` — sets the owning Cmd's state to
    /// `WaitingWriteErr` and writes to the *Cmd's* `io.stderr` (not the
    /// builtin's, which may already have been redirected). Hoisted here
    /// because `init_redirections` and `Cmd::transition_to_exec` (the
    /// "command not found" / spawn-error paths) are the only callers.
    pub(crate) fn cmd_write_failing_error(
        interp: &mut Interpreter,
        cmd: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let mut buf = Vec::new();
        let _ = buf.write_fmt(args);
        if let Some(_safeguard) = interp.as_cmd(cmd).io.stderr.needs_io() {
            // Spec: `enqueueCb(ctx)` — only the `.fd` arm transitions state.
            interp.as_cmd_mut(cmd).state = CmdState::WaitingWriteErr;
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Cmd);
            // SAFETY: `OutKind::Fd` guaranteed by `needs_io()`.
            if let OutKind::Fd(fd) = &interp.as_cmd(cmd).io.stderr {
                return fd.writer.enqueue(child, fd.captured, &buf);
            }
            unreachable!()
        }
        // No-IO path: append to the shell env's captured stderr and finish
        // synchronously with exit 1 (Cmd::on_io_writer_chunk's behaviour).
        let shell = interp.as_cmd(cmd).base.shell;
        // SAFETY: shell env outlives the Cmd node.
        if let OutKind::Pipe = &interp.as_cmd(cmd).io.stderr {
            bun_core::handle_oom(unsafe { (*(*shell).buffered_stderr()).append_slice(&buf) });
        }
        let parent = interp.as_cmd(cmd).base.parent;
        interp.child_done(parent, cmd, 1)
    }

    /// Finish the builtin with `exit_code` and signal the owning Cmd.
    /// Spec: Builtin.zig `done`.
    pub fn done(interp: &mut Interpreter, cmd: NodeId, exit_code: ExitCode) -> Yield {
        Self::of_mut(interp, cmd).exit_code = Some(exit_code);
        // PORT NOTE: Zig `done` flushes `.buf` into `shell.buffered_stdout()`
        // here. The NodeId port writes through immediately in `write_no_io`,
        // so there is nothing to flush.
        Cmd::on_exec_done(interp, cmd, exit_code)
    }

    /// Hoisted dispatch: start the builtin's state machine.
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        use crate::shell::builtins::*;
        // PORT NOTE: reshaped for borrowck — match on a copied Kind, then
        // call the per-builtin `start(interp, cmd)`. Each builtin reaches its
        // own state via `Builtin::of_mut(interp, cmd).impl_`.
        let kind = Self::kind_of(interp, cmd);
        match kind {
            Kind::True => true_::True::start(interp, cmd),
            Kind::False => false_::False::start(interp, cmd),
            Kind::Pwd => pwd::Pwd::start(interp, cmd),
            Kind::Exit => exit::Exit::start(interp, cmd),
            Kind::Basename => basename::Basename::start(interp, cmd),
            Kind::Dirname => dirname::Dirname::start(interp, cmd),
            Kind::Cd => cd::Cd::start(interp, cmd),
            Kind::Echo => echo::Echo::start(interp, cmd),
            Kind::Export => export::Export::start(interp, cmd),
            Kind::Cat => cat::Cat::start(interp, cmd),
            Kind::Mv => mv::Mv::start(interp, cmd),
            Kind::Rm => rm::Rm::start(interp, cmd),
            Kind::Which => which::Which::start(interp, cmd),
            Kind::Ls => ls::Ls::start(interp, cmd),
            Kind::Mkdir => mkdir::Mkdir::start(interp, cmd),
            Kind::Touch => touch::Touch::start(interp, cmd),
            Kind::Cp => cp::Cp::start(interp, cmd),
            Kind::Seq => seq::Seq::start(interp, cmd),
            Kind::Yes => yes::Yes::start(interp, cmd),
        }
    }

    /// Hoisted dispatch for the `onIOWriterChunk` callback.
    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        written: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        use crate::shell::builtins::*;
        let kind = Self::kind_of(interp, cmd);
        match kind {
            Kind::True => true_::True::on_io_writer_chunk(interp, cmd, written, err),
            Kind::False => false_::False::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Pwd => pwd::Pwd::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Exit => exit::Exit::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Basename => basename::Basename::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Dirname => dirname::Dirname::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Cd => cd::Cd::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Echo => echo::Echo::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Export => export::Export::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Cat => cat::Cat::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Mv => mv::Mv::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Rm => rm::Rm::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Which => which::Which::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Ls => ls::Ls::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Mkdir => mkdir::Mkdir::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Touch => touch::Touch::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Cp => cp::Cp::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Seq => seq::Seq::on_io_writer_chunk(interp, cmd, written, err),
            Kind::Yes => yes::Yes::on_io_writer_chunk(interp, cmd, written, err),
        }
    }

    /// Look up the Builtin inside a Cmd's `exec` slot.
    #[inline]
    #[track_caller]
    pub fn of<'a>(interp: &'a Interpreter, cmd: NodeId) -> &'a Builtin {
        match &interp.as_cmd(cmd).exec {
            crate::shell::states::cmd::Exec::Builtin(b) => b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        }
    }

    #[inline]
    #[track_caller]
    pub fn of_mut<'a>(interp: &'a mut Interpreter, cmd: NodeId) -> &'a mut Builtin {
        match &mut interp.as_cmd_mut(cmd).exec {
            crate::shell::states::cmd::Exec::Builtin(b) => b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        }
    }

    #[inline]
    fn kind_of(interp: &Interpreter, cmd: NodeId) -> Kind {
        Self::of(interp, cmd).kind
    }

    /// Spec: Builtin.zig `readStdinNoIO`. Returns the bytes available on
    /// stdin when it is *not* an async fd (arraybuf / piped buf / blob).
    pub fn read_stdin_no_io<'a>(interp: &'a Interpreter, cmd: NodeId) -> &'a [u8] {
        match &Self::of(interp, cmd).stdin {
            BuiltinInput::ArrayBuf { buf, .. } => buf.slice(),
            BuiltinInput::Buf(b) => &b[..],
            BuiltinInput::Blob(b) => b.blob.shared_view(),
            BuiltinInput::Fd(_) | BuiltinInput::Ignore => b"",
        }
    }

    /// Write `buf` to stdout/stderr without going through IOWriter (the
    /// stream is a captured buffer / arraybuffer / blob / /dev/null).
    ///
    /// Spec: Builtin.zig `writeNoIO`. Returns `Err(ENOSPC)` when an
    /// ArrayBuffer target is already full (Zig: `Maybe(usize).initErr`).
    /// **WARNING**: caller must have checked `needs_io() == None` first.
    pub fn write_no_io(
        interp: &mut Interpreter,
        cmd: NodeId,
        io_kind: IoKind,
        buf: &[u8],
    ) -> bun_sys::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        // PORT NOTE: reshaped for borrowck — split-borrow the Cmd so `shell`
        // and the builtin's stdout/stderr are accessible simultaneously.
        let cmd_node = interp.as_cmd_mut(cmd);
        let shell = cmd_node.base.shell;
        let crate::shell::states::cmd::Exec::Builtin(me) = &mut cmd_node.exec else {
            panic!("Cmd {} is not running a builtin", cmd);
        };
        let out: &mut BuiltinIO = match io_kind {
            IoKind::Stdout => &mut me.stdout,
            IoKind::Stderr => &mut me.stderr,
            IoKind::Stdin => return Ok(0),
        };
        // SAFETY: `shell` is `cmd_node.base.shell`, live for the Cmd's lifetime.
        unsafe { out.write_no_io_to(shell, buf) }
    }

    /// Shell exec env of the owning Cmd.
    #[inline]
    pub fn shell<'a>(interp: &'a Interpreter, cmd: NodeId) -> &'a crate::shell::interpreter::ShellExecEnv {
        // SAFETY: see Base::shell.
        unsafe { &*interp.as_cmd(cmd).base.shell }
    }

    /// The owning `Cmd` state node. Spec: Builtin.zig `parentCmd` (Zig used
    /// `@fieldParentPtr`; in the NodeId port the builtin already stores `cmd`).
    #[inline]
    pub fn parent_cmd<'a>(interp: &'a Interpreter, cmd: NodeId) -> &'a Cmd {
        interp.as_cmd(cmd)
    }

    #[inline]
    pub fn parent_cmd_mut<'a>(interp: &'a mut Interpreter, cmd: NodeId) -> &'a mut Cmd {
        interp.as_cmd_mut(cmd)
    }

    /// Event loop handle (forwarded from the interpreter). Spec: Builtin.zig
    /// `eventLoop` → `parentCmd().base.eventLoop()`.
    #[inline]
    pub fn event_loop(interp: &Interpreter, _cmd: NodeId) -> crate::shell::interpreter::EventLoopHandle {
        interp.event_loop
    }

    /// Spec: Builtin.zig `throw` → `parentCmd().base.throw(err)`. In the
    /// NodeId port the interpreter owns the throw path directly.
    #[inline]
    pub fn throw(interp: &mut Interpreter, _cmd: NodeId, err: crate::shell::ShellErr) {
        interp.throw(err);
    }

    /// Cwd fd of the owning Cmd's shell env. Spec: Builtin.zig `this.cwd` /
    /// `parentCmd().base.shell.cwd_fd`.
    #[inline]
    pub fn cwd(interp: &Interpreter, cmd: NodeId) -> bun_sys::Fd {
        Self::shell(interp, cmd).cwd_fd
    }

    /// Format `"{kind}: {fmt}"` into a fresh heap buffer. Spec: Builtin.zig
    /// `fmtErrorArena` (Zig allocates from the Cmd's bump arena; we use a
    /// `Vec` — the per-builtin arena isn't ported yet).
    ///
    /// Stored on the `Builtin` so the returned `&[u8]` borrow stays valid
    /// across the immediate `write_no_io` / `enqueue` call (matches the Zig
    /// arena lifetime).
    pub fn fmt_error_arena<'a>(
        interp: &'a mut Interpreter,
        cmd: NodeId,
        kind: Option<Kind>,
        args: core::fmt::Arguments<'_>,
    ) -> &'a [u8] {
        use std::io::Write as _;
        let mut buf = Vec::new();
        if let Some(k) = kind {
            let _ = write!(&mut buf, "{}: ", k.as_str());
        }
        let _ = buf.write_fmt(args);
        let me = Self::of_mut(interp, cmd);
        me.err_buf = buf;
        &me.err_buf
    }

    /// Error messages formatted to match bash. Spec: Builtin.zig
    /// `taskErrorToString` (the `bun.shell.ShellErr` arm — dispatches on the
    /// variant; `.sys` recurses into the `jsc.SystemError` formatter).
    pub fn shell_err_to_string<'a>(
        interp: &'a mut Interpreter,
        cmd: NodeId,
        kind: Kind,
        err: &crate::shell::ShellErr,
    ) -> &'a [u8] {
        use crate::shell::ShellErr;
        match err {
            ShellErr::Sys(sys) => {
                // Spec: Builtin.zig `taskErrorToString` (the `jsc.SystemError`
                // arm) — `"{message}\n"` or `"{message}: {path}\n"`.
                if sys.path.is_empty() {
                    Self::fmt_error_arena(
                        interp,
                        cmd,
                        Some(kind),
                        format_args!("{}\n", bstr::BStr::new(sys.message.byte_slice())),
                    )
                } else {
                    Self::fmt_error_arena(
                        interp,
                        cmd,
                        Some(kind),
                        format_args!(
                            "{}: {}\n",
                            bstr::BStr::new(sys.message.byte_slice()),
                            sys.path,
                        ),
                    )
                }
            }
            ShellErr::Custom(s) => Self::fmt_error_arena(
                interp, cmd, Some(kind), format_args!("{}\n", bstr::BStr::new(s)),
            ),
            ShellErr::InvalidArguments { val } => Self::fmt_error_arena(
                interp, cmd, Some(kind), format_args!("{}\n", bstr::BStr::new(val)),
            ),
            ShellErr::Todo(s) => Self::fmt_error_arena(
                interp, cmd, Some(kind), format_args!("{}\n", bstr::BStr::new(s)),
            ),
        }
    }

    /// Error messages formatted to match bash. Spec: Builtin.zig
    /// `taskErrorToString` (the `Syscall.Error` arm) — maps the errno through
    /// `bun.sys.coreutils_error_map` so output matches GNU coreutils
    /// (e.g. `ENOENT` → "No such file or directory"); falls back to
    /// `"unknown error {errno}"` when unmapped.
    pub fn task_error_to_string<'a>(
        interp: &'a mut Interpreter,
        cmd: NodeId,
        kind: Kind,
        err: &bun_sys::Error,
    ) -> &'a [u8] {
        if let Some((_code, sys_errno)) = err.get_error_code_tag_name() {
            if let Some(message) = bun_sys::coreutils_error_map::get(sys_errno) {
                if !err.path.is_empty() {
                    return Self::fmt_error_arena(
                        interp,
                        cmd,
                        Some(kind),
                        format_args!("{}: {}\n", bstr::BStr::new(&err.path[..]), message),
                    );
                }
                return Self::fmt_error_arena(
                    interp,
                    cmd,
                    Some(kind),
                    format_args!("{}\n", message),
                );
            }
        }
        Self::fmt_error_arena(
            interp,
            cmd,
            Some(kind),
            format_args!("unknown error {}\n", err.errno),
        )
    }

    /// Write `buf` to stderr (async if needed) then finish with `exit_code`.
    /// Shared helper for builtins whose only failure path is "print error and
    /// exit". Spec: per-builtin `writeFailingError` in Zig — hoisted here so
    /// the NodeId-style builtins don't each repeat the needs_io branch.
    ///
    /// Stashes `exit_code` on the `Builtin` so the async path
    /// (`on_io_writer_chunk`) can finish with it; callers that need to mark a
    /// per-builtin `state = WaitingWriteErr` must still do so before calling.
    pub fn write_failing_error(
        interp: &mut Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: crate::shell::ExitCode,
    ) -> Yield {
        Self::of_mut(interp, cmd).exit_code = Some(exit_code);
        if let Some(safeguard) = Self::of(interp, cmd).stderr.needs_io() {
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Builtin);
            // PORT NOTE: reshaped for borrowck — clone buf so the &mut on
            // `stderr` doesn't overlap a borrow into `err_buf`.
            let owned = buf.to_vec();
            return Self::of_mut(interp, cmd)
                .stderr
                .enqueue(child, &owned, safeguard);
        }
        let _ = Self::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Self::done(interp, cmd, exit_code)
    }
}

// `deinit`: Spec Builtin.zig `deinit` — per-impl cleanup + `stdin/stdout/
// stderr.deref()`. In the Rust port every `Impl` variant owns its state via
// `Box`/`Vec`/`Arc`, and `BuiltinIO`/`BuiltinInput` hold `Arc<IOWriter>` /
// `Arc<IOReader>` / `ArrayBufferStrong` / `Arc<BuiltinBlob>` whose `Drop`
// already decrements the refcount. So `deinit` is fully covered by `Drop` on
// `Box<Builtin>` (called from `Cmd::deinit`). No explicit body needed.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/Builtin.zig
//   confidence: medium-high (NodeId dispatch; init_redirections ported;
//               BuiltinIO Output/Input full variant set; coreutils error map)
//   notes:      `.buf` flush folded into write_no_io (intentional reshape);
//               refcounts via Arc::clone (== Zig dupeRef).
// ──────────────────────────────────────────────────────────────────────────
