//! A builtin command runs inside a `Cmd` state node and is reached through that node's `NodeId`.

use bstr::BStr;
use bun_collections::VecExt;
use bun_jsc::PinnedArrayBuffer;
use bun_ptr::BackRef;
use core::fmt;
use core::sync::atomic::{AtomicBool, AtomicUsize};
use std::rc::Rc;

use crate::node::fs::{note_shell_redirect, open_embedded_shell_operand, refuse_shell_redirect};
use crate::shell::ExitCode;
use crate::shell::ast;
use crate::shell::builtins::batch::Batch;
use crate::shell::builtins::{
    basename, cat, cd, cp, dirname, echo, exit, export, ls, mkdir, mv, pwd, rm, seq, touch, which,
    yes,
};
use crate::shell::interpreter::{Interpreter, NodeId, is_pollable_from_mode, shell_openat};
use crate::shell::io::{InKind, OutFd, OutKind};
use crate::shell::io_reader::IOReader;
use crate::shell::io_writer::{self, IOWriter};
use crate::shell::states::cmd::{Cmd, CmdState, Exec};
use crate::shell::yield_::Yield;

/// Points into the `args` of the Cmd, which outlive the builtin.
pub(crate) type Arg = BackRef<[u8]>;

pub(crate) struct Builtin {
    kind: Kind,
    /// argv[1..]
    args: Vec<Arg>,
    pub(crate) stdin: BuiltinInput,
    stdout: BuiltinIO,
    stderr: BuiltinIO,
    pub(crate) state: State,
    /// Reports a [`Batch`] still waits for. A pool task adds the ones it causes before it reports.
    pub(crate) running: AtomicUsize,
    /// Tells the pool tasks of `rm` and `mv` that one of them has failed.
    pub(crate) stop: AtomicBool,
}

/// What a builtin keeps between events.
pub(crate) enum State {
    /// No write is in flight.
    Idle,
    /// The last write is in flight.
    Exiting(ExitCode),
    Batch(Batch),
    Cat(cat::Cat),
    Mv(mv::Mv),
    Which {
        next: usize,
        missing: bool,
    },
    Yes(Box<yes::Yes>),
}

macro_rules! shell_builtins {
    ($( $kind:ident $name:literal $start:expr, )*) => {
        #[repr(u8)]
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub(crate) enum Kind { $( $kind, )* }

        impl Kind {
            pub(crate) fn as_str(self) -> &'static str {
                match self { $( Kind::$kind => $name, )* }
            }

            /// No POSIX gating.
            fn from_argv0_raw(s: &[u8]) -> Option<Kind> {
                $( if s == $name.as_bytes() { return Some(Kind::$kind); } )*
                None
            }
        }

        impl Builtin {
            pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
                match Self::of(interp, cmd).kind { $( Kind::$kind => $start(interp, cmd), )* }
            }
        }
    };
}

shell_builtins! {
    True     "true"     |interp, cmd| Builtin::done(interp, cmd, 0),
    False    "false"    |interp, cmd| Builtin::done(interp, cmd, 1),
    Pwd      "pwd"      pwd::start,
    Exit     "exit"     exit::start,
    Basename "basename" basename::start,
    Dirname  "dirname"  dirname::start,
    Cd       "cd"       cd::start,
    Echo     "echo"     echo::start,
    Export   "export"   export::start,
    Cat      "cat"      cat::start,
    Mv       "mv"       mv::start,
    Rm       "rm"       rm::start,
    Which    "which"    which::start,
    Ls       "ls"       ls::start,
    Mkdir    "mkdir"    mkdir::start,
    Touch    "touch"    touch::start,
    Cp       "cp"       cp::start,
    Seq      "seq"      seq::start,
    Yes      "yes"      yes::start,
}

impl Kind {
    /// Left to the system binary unless the experimental feature flag is set.
    pub(crate) const DISABLED_ON_POSIX: &'static [Kind] = &[Kind::Cat, Kind::Cp];

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

    fn exit_code_of_failed_write(self, err: &bun_sys::SystemError) -> ExitCode {
        match self {
            // The negated errno, wrapped.
            Kind::Echo | Kind::Which => err.errno as ExitCode,
            Kind::Cat | Kind::Rm => err.get_errno() as ExitCode,
            _ => 1,
        }
    }

    /// `"{kind}: {args}"`
    pub(crate) fn message(self, args: fmt::Arguments<'_>) -> Vec<u8> {
        format!("{}: {args}", self.as_str()).into_bytes()
    }

    /// In the words of GNU coreutils.
    pub(crate) fn task_error(self, err: &bun_sys::Error) -> Vec<u8> {
        let words = err
            .get_error_code_tag_name()
            .and_then(|(_, errno)| bun_sys::coreutils_error_map::get(errno));
        match words {
            Some(words) if err.path.is_empty() => self.message(format_args!("{words}\n")),
            Some(words) => self.message(format_args!("{}: {words}\n", BStr::new(&err.path))),
            None => self.message(format_args!("unknown error {}\n", err.errno)),
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum BadFlag<'a> {
    Illegal(&'a [u8]),
    Unsupported(&'a [u8]),
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum IoKind {
    Stdout,
    Stderr,
}

/// One output stream of a builtin (stdout or stderr).
enum BuiltinIO {
    Fd(OutFd),
    /// Which buffer of the shell env it appends to: `2>&1` aims stderr at stdout's.
    Buf(IoKind),
    ArrayBuf {
        buf: PinnedArrayBuffer,
        i: u32,
    },
    Blob(Rc<BuiltinBlob>),
    Ignore,
}

/// Input stream of a builtin.
pub(crate) enum BuiltinInput {
    Fd(Rc<IOReader>),
    ArrayBuf { buf: PinnedArrayBuffer },
    Blob(Rc<BuiltinBlob>),
    Ignore,
}

/// Refcounted wrapper around a `webcore.Blob`. `Rc` provides the refcount.
pub(crate) struct BuiltinBlob {
    pub(crate) blob: crate::webcore::Blob,
}

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
            BuiltinIO::Blob(b) => BuiltinIO::Blob(Rc::clone(b)),
            BuiltinIO::ArrayBuf { .. } => {
                unreachable!("duplicate_out precedes jsbuf redirects")
            }
        }
    }
}

/// Where a write goes.
pub(crate) enum Sink<'a> {
    Fd(FdSink<'a>),
    Memory(MemorySink<'a>),
}

/// A write can complete, and free the builtin, before it returns: set the state first.
pub(crate) struct FdSink<'a> {
    writer: &'a IOWriter,
    captured: Option<*mut Vec<u8>>,
    child: io_writer::ChildPtr,
}

impl FdSink<'_> {
    pub(crate) fn enqueue(self, buf: &[u8]) -> Yield {
        self.writer.enqueue(self.child, self.captured, buf)
    }

    pub(crate) fn cancel_queued(self) {
        self.writer.cancel_chunks(self.child);
    }
}

pub(crate) struct MemorySink<'a>(Memory<'a>);

enum Memory<'a> {
    Captured(*mut Vec<u8>),
    ArrayBuf {
        buf: &'a mut PinnedArrayBuffer,
        i: &'a mut u32,
    },
    Discard,
}

impl MemorySink<'_> {
    /// `ENOSPC` once an ArrayBuffer is full.
    pub(crate) fn write(self, bytes: &[u8]) -> bun_sys::Result<()> {
        match self.0 {
            // SAFETY: a buffer of the Cmd's env or of an ancestor, which outlive the builtin. Single-threaded.
            Memory::Captured(captured) => unsafe { (*captured).append_slice(bytes) },
            Memory::ArrayBuf { buf, i } => {
                // JS can resize the buffer between chunks.
                let dst = buf.live_slice_mut().get_mut(*i as usize..);
                let Some(dst) = dst.filter(|dst| !dst.is_empty()) else {
                    use bun_sys::{E, Error, Tag};
                    return Err(Error::from_code(E::ENOSPC, Tag::write));
                };
                let len = dst.len().min(bytes.len());
                dst[..len].copy_from_slice(&bytes[..len]);
                *i = i.saturating_add(len as u32);
            }
            Memory::Discard => {}
        }
        Ok(())
    }
}

impl BuiltinInput {
    fn from_in_kind(ik: &InKind) -> BuiltinInput {
        match ik {
            // `Rc::clone` bumps the IOReader refcount.
            InKind::Fd(r) => BuiltinInput::Fd(Rc::clone(r)),
            InKind::Ignore => BuiltinInput::Ignore,
        }
    }
}

impl Builtin {
    pub(crate) fn args(&self) -> &[Arg] {
        &self.args
    }

    /// The leading arguments that start with `-`, and the operands.
    pub(crate) fn split_flags(&self) -> (&[Arg], &[Arg]) {
        let flags = self.args.iter().take_while(|arg| arg.starts_with(b"-"));
        self.args.split_at(flags.count())
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

    /// Construct a `Builtin` for `kind`, install it into the owning Cmd's
    /// `exec` slot, then wire up file/jsbuf/`2>&1` redirections. Returns
    /// `None` (meaning: caller should now call `Builtin::start`). A
    /// `Some(yield)` return means setup wrote a failing error (or threw) and
    /// the caller should propagate that yield instead.
    pub(crate) fn init(interp: &Interpreter, cmd: NodeId, kind: Kind) -> Option<Yield> {
        let me = interp.as_cmd(cmd);
        let args = me.args.iter().skip(1);
        let args = args.map(|arg| BackRef::new(bun_core::ffi::slice_to_nul(arg)));
        let builtin = Box::new(Builtin {
            kind,
            args: args.collect(),
            stdin: BuiltinInput::from_in_kind(&me.io.stdin),
            stdout: BuiltinIO::from_out_kind(&me.io.stdout, IoKind::Stdout),
            stderr: BuiltinIO::from_out_kind(&me.io.stderr, IoKind::Stderr),
            state: State::Idle,
            running: AtomicUsize::new(0),
            stop: AtomicBool::new(false),
        });
        interp.as_cmd_mut(cmd).exec = Exec::Builtin(builtin);

        Self::init_redirections(interp, cmd, kind)
    }

    /// Opens redirect files / wires ArrayBuffer & Blob targets / handles
    /// `2>&1` (`duplicate_out`).
    fn init_redirections(interp: &Interpreter, cmd: NodeId, kind: Kind) -> Option<Yield> {
        // `node` points into the AST arena which outlives every state node (see Cmd::next).
        let node: &ast::Cmd = &*interp.as_cmd(cmd).node;
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
                let raw = &interp.as_cmd(cmd).redirection_file;
                let path: &bun_core::ZStr = &bun_core::ZBox::from_bytes(&raw[..raw.len() - 1]);
                let perm: bun_sys::Mode = 0o666;
                let cwd_fd = Self::cwd(interp, cmd);
                let evtloop = interp.event_loop;

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
                    let me = Self::of_mut(interp, cmd);
                    me.stdout = BuiltinIO::Fd(OutFd {
                        writer: Rc::clone(&redirect_writer),
                        captured: None,
                    });
                }
                if redirect.stderr() {
                    let me = Self::of_mut(interp, cmd);
                    me.stderr = BuiltinIO::Fd(OutFd {
                        writer: redirect_writer,
                        captured: None,
                    });
                }
            }
            Some(ast::Redirect::JsBuf(jsbuf)) => {
                // ── JS object redirect (`> ${arraybuf}` / `> ${blob}`).
                // Safe accessor — single `unsafe` deref lives in
                // `Interpreter::global_this_ref`.
                let Some(global) = interp.global_this_ref() else {
                    interp.throw(crate::shell::ShellErr::Custom(
                        b"Invalid JS object reference in shell"
                            .to_vec()
                            .into_boxed_slice(),
                    ));
                    return Some(Yield::Failed(cmd));
                };
                let Ok(jsval) = interp.jsobj(global, jsbuf.idx) else {
                    return Some(Yield::Failed(cmd));
                };

                if jsval.js_type().is_array_buffer_like() {
                    // Each slot gets its own pin + GC root; `None` has thrown OOM.
                    let root = || {
                        let buf = PinnedArrayBuffer::root(global, jsval);
                        if buf.is_none() {
                            let _ = global.throw_out_of_memory();
                        }
                        buf
                    };
                    let me = Self::of_mut(interp, cmd);
                    if redirect.stdin() {
                        let Some(buf) = root() else {
                            return Some(Yield::Failed(cmd));
                        };
                        me.stdin = BuiltinInput::ArrayBuf { buf };
                    }
                    if redirect.stdout() {
                        let Some(buf) = root() else {
                            return Some(Yield::Failed(cmd));
                        };
                        me.stdout = BuiltinIO::ArrayBuf { buf, i: 0 };
                    }
                    if redirect.stderr() {
                        let Some(buf) = root() else {
                            return Some(Yield::Failed(cmd));
                        };
                        me.stderr = BuiltinIO::ArrayBuf { buf, i: 0 };
                    }
                } else if let Some(body) =
                    crate::webcore::body::Value::from_request_or_response(jsval)
                {
                    // SAFETY: returned a live JSC-owned `*mut Value` borrowed
                    // from a Response/Request wrapper.
                    let body = unsafe { &mut *body };
                    let is_file_blob = matches!(body, crate::webcore::body::Value::Blob(b)
                        if !b.needs_to_read_file());
                    if (redirect.stdout() || redirect.stderr()) && !is_file_blob {
                        let _ = global.throw(format_args!(
                            "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                        ));
                        return Some(Yield::Failed(cmd));
                    }
                    let original_blob = body.use_();
                    if !redirect.stdin() && !redirect.stdout() && !redirect.stderr() {
                        drop(original_blob);
                        return None;
                    }
                    let blob = Rc::new(BuiltinBlob {
                        blob: original_blob.dupe(),
                    });
                    drop(original_blob);
                    let me = Self::of_mut(interp, cmd);
                    if redirect.stdin() {
                        me.stdin = BuiltinInput::Blob(Rc::clone(&blob));
                    }
                    if redirect.stdout() {
                        me.stdout = BuiltinIO::Blob(Rc::clone(&blob));
                    }
                    if redirect.stderr() {
                        me.stderr = BuiltinIO::Blob(blob);
                    }
                } else if let Some(blob_ref) = jsval.as_class_ref::<crate::webcore::Blob>() {
                    if (redirect.stdout() || redirect.stderr()) && !blob_ref.needs_to_read_file() {
                        let _ = global.throw(format_args!(
                            "Cannot redirect stdout/stderr to an immutable blob. Expected a file"
                        ));
                        return Some(Yield::Failed(cmd));
                    }
                    let theblob = Rc::new(BuiltinBlob {
                        blob: blob_ref.dupe(),
                    });
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
                    return Some(Yield::Failed(cmd));
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
        let me = interp.as_cmd_mut(cmd);
        if let OutKind::Fd(fd) = &me.io.stderr {
            me.state = CmdState::WaitingWriteErr;
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Cmd);
            return fd.writer.enqueue(child, fd.captured, &buf);
        }
        // No-IO path: append to the shell env's captured stderr and finish
        // synchronously with exit 1 (Cmd::on_io_writer_chunk's behaviour).
        if let OutKind::Pipe = &interp.as_cmd(cmd).io.stderr {
            // SAFETY: single trampoline frame; no other borrow of the env's
            // (or its parent's) stderr buffer is live.
            let stderr = unsafe { interp.as_cmd_mut(cmd).shell.buffered_stderr_mut() };
            stderr.append_slice(&buf);
        }
        let parent = interp.as_cmd(cmd).base.parent;
        interp.child_done(parent, cmd, 1)
    }

    pub(crate) fn done(interp: &Interpreter, cmd: NodeId, exit_code: ExitCode) -> Yield {
        Cmd::on_exec_done(interp, cmd, exit_code)
    }

    /// Look up the Builtin inside a Cmd's `exec` slot.
    #[inline]
    #[track_caller]
    pub(crate) fn of<'a>(interp: &'a Interpreter, cmd: NodeId) -> &'a Builtin {
        match &interp.as_cmd(cmd).exec {
            Exec::Builtin(b) => b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        }
    }

    #[inline]
    #[track_caller]
    pub(crate) fn of_mut<'a>(interp: &'a Interpreter, cmd: NodeId) -> &'a mut Builtin {
        match &mut interp.as_cmd_mut(cmd).exec {
            Exec::Builtin(b) => b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        }
    }

    /// Shell exec env of the owning Cmd.
    #[inline]
    pub(crate) fn shell<'a>(
        interp: &'a Interpreter,
        cmd: NodeId,
    ) -> &'a crate::shell::interpreter::ShellExecEnv {
        &interp.as_cmd(cmd).shell
    }

    /// Cwd fd of the owning Cmd's shell env.
    #[inline]
    pub(crate) fn cwd(interp: &Interpreter, cmd: NodeId) -> bun_sys::Fd {
        Self::shell(interp, cmd).cwd_fd.fd()
    }

    pub(crate) fn sink(interp: &Interpreter, cmd: NodeId, to: IoKind) -> Sink<'_> {
        let me = Self::of_mut(interp, cmd);
        let out = match to {
            IoKind::Stdout => &mut me.stdout,
            IoKind::Stderr => &mut me.stderr,
        };
        Sink::Memory(MemorySink(match out {
            BuiltinIO::Fd(fd) => {
                return Sink::Fd(FdSink {
                    writer: &fd.writer,
                    captured: fd.captured,
                    child: io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Builtin),
                });
            }
            &mut BuiltinIO::Buf(target) => {
                let shell = &mut interp.as_cmd_mut(cmd).shell;
                Memory::Captured(match target {
                    IoKind::Stdout => shell.buffered_stdout(),
                    IoKind::Stderr => shell.buffered_stderr(),
                })
            }
            BuiltinIO::ArrayBuf { buf, i } => Memory::ArrayBuf { buf, i },
            BuiltinIO::Blob(_) | BuiltinIO::Ignore => Memory::Discard,
        }))
    }

    /// The last write. It drops the state, which must not own `buf` or what a task still uses.
    pub(crate) fn finish(
        interp: &Interpreter,
        cmd: NodeId,
        to: IoKind,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        Self::of_mut(interp, cmd).state = State::Exiting(exit_code);
        match Self::sink(interp, cmd, to) {
            Sink::Fd(fd) => fd.enqueue(buf),
            Sink::Memory(memory) => {
                let _ = memory.write(buf);
                Self::done(interp, cmd, exit_code)
            }
        }
    }

    /// [`Self::finish`] with `"{kind}: {args}"` on stderr and exit code 1.
    pub(crate) fn fail(interp: &Interpreter, cmd: NodeId, args: fmt::Arguments<'_>) -> Yield {
        let message = Self::of(interp, cmd).kind.message(args);
        Self::finish(interp, cmd, IoKind::Stderr, &message, 1)
    }

    pub(crate) fn fail_usage(interp: &Interpreter, cmd: NodeId, usage: &[u8]) -> Yield {
        Self::finish(interp, cmd, IoKind::Stderr, usage, 1)
    }

    pub(crate) fn fail_flag(interp: &Interpreter, cmd: NodeId, flag: BadFlag<'_>) -> Yield {
        let (problem, flag) = match flag {
            BadFlag::Illegal(flag) => ("illegal option", flag),
            BadFlag::Unsupported(flag) => ("unsupported option, please open a GitHub issue", flag),
        };
        let flag = BStr::new(flag);
        Self::fail(interp, cmd, format_args!("{problem} -- {flag}\n"))
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        let me = Self::of(interp, cmd);
        let failed = err.map(|err| me.kind.exit_code_of_failed_write(&err));
        match (&me.state, failed) {
            (State::Batch(_), _) => Batch::on_write(interp, cmd),
            (State::Cat(_), _) => cat::Cat::on_write(interp, cmd, failed),
            (State::Exiting(_) | State::Which { .. } | State::Yes(_), Some(code))
            | (&State::Exiting(code), None) => Self::done(interp, cmd, code),
            (&State::Which { next, missing }, None) => which::print(interp, cmd, next, missing),
            (State::Yes(_), None) => yes::Yes::write(interp, cmd),
            (State::Idle | State::Mv(_), _) => Yield::suspended(),
        }
    }
}
