//! A builtin command runs inside a `Cmd` state node. In Zig the builtin
//! recovered its parent `*Cmd` via `@fieldParentPtr`; in the NodeId port the
//! builtin stores the `NodeId` of its owning Cmd and every method takes
//! `&mut Interpreter`.

use core::ffi::c_char;

use crate::shell::interpreter::{Interpreter, NodeId, OutputNeedsIOSafeGuard};
use crate::shell::io::OutKind;
use crate::shell::states::cmd::Cmd;
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

pub struct Builtin {
    /// Owning Cmd node. Replaces Zig's `@fieldParentPtr("impl", ...)` chain.
    pub cmd: NodeId,
    pub kind: Kind,
    /// argv[1..] as NUL-terminated strings (argv[0] is the builtin name).
    /// Points into the Cmd's `args` storage.
    pub args: Vec<*const c_char>,
    pub stdin: crate::shell::io::InKind,
    pub stdout: BuiltinIO,
    pub stderr: BuiltinIO,
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

/// One output stream of a builtin (stdout or stderr).
pub struct BuiltinIO {
    pub kind: OutKind,
}

impl BuiltinIO {
    #[inline]
    pub fn needs_io(&self) -> Option<OutputNeedsIOSafeGuard> {
        self.kind.needs_io()
    }

    /// Queue `buf` on this stream's IOWriter and arrange for `child`'s
    /// `on_io_writer_chunk` to fire when the chunk completes. Spec: Builtin.zig
    /// `BuiltinIO.Output.enqueue` — delegates to `fd.writer.enqueue` passing
    /// `fd.captured` as the tee bytelist.
    ///
    /// `_safeguard` proves the caller checked `needs_io()`.
    pub fn enqueue(
        &mut self,
        child: crate::shell::io_writer::ChildPtr,
        buf: &[u8],
        _safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        match &self.kind {
            OutKind::Fd(fd) => fd.writer.enqueue(child, fd.captured, buf),
            _ => unreachable!("enqueue() on non-fd output; caller must check needs_io()"),
        }
    }

    /// Spec: Builtin.zig `BuiltinIO.Output.enqueueFmtBltn` — format with the
    /// optional `"{kind}: "` prefix and enqueue on the underlying IOWriter.
    pub fn enqueue_fmt(
        &mut self,
        child: crate::shell::io_writer::ChildPtr,
        kind: Option<Kind>,
        args: core::fmt::Arguments<'_>,
        _safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        match &self.kind {
            OutKind::Fd(fd) => fd.writer.enqueue_fmt_bltn(child, fd.captured, kind, args),
            _ => unreachable!("enqueue_fmt() on non-fd output; caller must check needs_io()"),
        }
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
    /// `exec` slot, and return `None` (meaning: caller should now call
    /// `Builtin::start`). A `Some(yield)` return means setup wrote a failing
    /// error and the caller should propagate that yield instead.
    ///
    /// Spec: Builtin.zig `init()`. Redirect handling (open files / arraybuf /
    /// blob targets) is still gated on IOWriter — for now stdin/stdout/stderr
    /// are taken straight from the Cmd's `io`.
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
                argv.push(a.as_ptr() as *const c_char);
            }
            (
                argv,
                me.io.stdin.clone(),
                BuiltinIO { kind: me.io.stdout.clone() },
                BuiltinIO { kind: me.io.stderr.clone() },
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
            err_buf: Vec::new(),
            impl_,
        }));

        // TODO(b2-blocked): redirect-file open (Builtin.zig init lines
        // 380-520) — needs IOWriter::init for the redirect fd and
        // ast::RedirectFlags inspection.
        None
    }

    /// Finish the builtin with `exit_code` and signal the owning Cmd.
    pub fn done(interp: &mut Interpreter, cmd: NodeId, exit_code: ExitCode) -> Yield {
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

    /// Write `buf` to stdout/stderr without going through IOWriter (the
    /// stream is a captured buffer or /dev/null).
    pub fn write_no_io(
        interp: &mut Interpreter,
        cmd: NodeId,
        io_kind: IoKind,
        buf: &[u8],
    ) -> usize {
        let captured = {
            let me = Self::of(interp, cmd);
            let out = match io_kind {
                IoKind::Stdout => &me.stdout,
                IoKind::Stderr => &me.stderr,
                IoKind::Stdin => return 0,
            };
            match &out.kind {
                OutKind::Fd(_) => unreachable!(
                    "write_no_io called on fd output; caller must check needs_io()"
                ),
                OutKind::Pipe => {
                    // Pipe → captured buffer on the shell env.
                    let shell = interp.as_cmd(cmd).base.shell;
                    // SAFETY: shell env outlives the Cmd node.
                    Some(unsafe {
                        match io_kind {
                            IoKind::Stdout => (*shell).buffered_stdout(),
                            _ => (*shell).buffered_stderr(),
                        }
                    })
                }
                OutKind::Ignore => return buf.len(),
            }
        };
        if let Some(ptr) = captured {
            // SAFETY: captured points into a live ShellExecEnv Bufio.
            let _ = unsafe { (*ptr).append_slice(buf) };
        }
        buf.len()
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
    /// `taskErrorToString` (the `Syscall.Error` arm).
    pub fn task_error_to_string<'a>(
        interp: &'a mut Interpreter,
        cmd: NodeId,
        kind: Kind,
        err: &bun_sys::Error,
    ) -> &'a [u8] {
        // TODO(b2-blocked): bun_sys::coreutils_error_map — map errno to the
        // GNU coreutils-style message. For now use the generic errno name.
        if !err.path.is_empty() {
            Self::fmt_error_arena(
                interp,
                cmd,
                Some(kind),
                format_args!(
                    "{}: {}\n",
                    bstr::BStr::new(&err.path[..]),
                    bstr::BStr::new(err.name()),
                ),
            )
        } else {
            Self::fmt_error_arena(
                interp,
                cmd,
                Some(kind),
                format_args!("{}\n", bstr::BStr::new(err.name())),
            )
        }
    }

    /// Write `buf` to stderr (async if needed) then finish with `exit_code`.
    /// Shared helper for builtins whose only failure path is "print error and
    /// exit". Spec: per-builtin `writeFailingError` in Zig — hoisted here so
    /// the NodeId-style builtins don't each repeat the needs_io branch.
    ///
    /// The caller must set its own `state = WaitingWriteErr` first if it needs
    /// to distinguish that in `on_io_writer_chunk`.
    pub fn write_failing_error(
        interp: &mut Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: crate::shell::ExitCode,
    ) -> Yield {
        if let Some(safeguard) = Self::of(interp, cmd).stderr.needs_io() {
            let child = crate::shell::io_writer::ChildPtr::new(
                cmd,
                crate::shell::io_writer::WriterTag::Builtin,
            );
            // PORT NOTE: reshaped for borrowck — clone buf so the &mut on
            // `stderr` doesn't overlap a borrow into `err_buf`.
            let owned = buf.to_vec();
            return Self::of_mut(interp, cmd)
                .stderr
                .enqueue(child, &owned, safeguard);
        }
        Self::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Self::done(interp, cmd, exit_code)
    }
}

// Remaining body (~700 lines: redirect handling, stdin/stdout/stderr open,
// write_failing_error_fmt, OutputSrc) — depends on IOWriter::enqueue,
// bun_sys open flags. The gated include was removed (file never materialised);
// port the remainder inline as the upstream pieces land.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/Builtin.zig (1015 lines)
//   confidence: medium (NodeId dispatch; from_argv0 + init wired)
//   blocked_on: redirect-file open (IOWriter::init), write_failing_error_fmt
// ──────────────────────────────────────────────────────────────────────────
