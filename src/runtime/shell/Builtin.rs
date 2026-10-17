//! A builtin command runs inside a `Cmd` state node. The builtin stores the
//! `NodeId` of its owning Cmd and every method takes `&Interpreter`.

use core::ffi::c_char;

use crate::shell::ExitCode;
use crate::shell::interpreter::{Interpreter, NodeId, ParseError};
use crate::shell::io::{CmdIn, CmdOut};
use crate::shell::io_writer;
use crate::shell::states::cmd::{Cmd, CmdState};
use crate::shell::yield_::Yield;

/// The streams of a builtin are those of its `Cmd`: `Cmd::io`.
pub(crate) struct Builtin {
    pub(crate) kind: Kind,
    /// argv[1..] as NUL-terminated strings (argv[0] is the builtin name).
    /// Points into the Cmd's `args` storage.
    pub args: Vec<*const c_char>,
    /// Scratch for `fmt_error_arena`. One outstanding error string at a time.
    pub(crate) err_buf: Vec<u8>,
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
    fn state_mut(interp: &Interpreter, cmd: NodeId) -> &mut Self {
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
            pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
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
                interp: &Interpreter,
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
pub(crate) enum IoKind {
    Stdout,
    Stderr,
}

impl Builtin {
    #[inline]
    pub(crate) fn args_slice(&self) -> &[*const c_char] {
        &self.args
    }

    /// Borrow `argv[1..][idx]` as `&[u8]` (NUL excluded).
    ///
    /// Every entry in `self.args` borrows into the owning `Cmd`'s
    /// `args: Vec<Vec<u8>>`, NUL-terminated by `Cmd::transition_to_exec` and
    /// outliving this `Builtin` (the `Cmd` slot is freed only after
    /// `Builtin::done`). Localises the per-callsite
    /// `unsafe { CStr::from_ptr(...) }` that previously appeared at every
    /// builtin's flag/operand parser.
    ///
    /// The returned slice's lifetime is intentionally **decoupled from
    /// `&self`**: the raw `*const c_char` is copied out of `self.args` first,
    /// so the borrow of `self` ends before `CStr::from_ptr`. This lets callers
    /// hold the result across an `interp.as_cmd_mut(...)` reborrow (cat/ls/mv
    /// flag loops). Soundness rests on the architectural invariant above —
    /// argv storage is a separate heap allocation that is not freed or
    /// reallocated while the `Builtin` is live — not on `'a`.
    #[inline]
    pub(crate) fn arg_bytes<'a>(&self, idx: usize) -> &'a [u8] {
        let p: *const c_char = self.args[idx];
        // SAFETY: see doc comment — `p` is a valid NUL-terminated pointer
        // into the Cmd's argv storage, live for the Builtin's lifetime.
        unsafe { core::ffi::CStr::from_ptr(p) }.to_bytes()
    }

    /// Borrow `argv[1..][idx]` as `&ZStr` (NUL-terminated view).
    ///
    /// Same invariant and lifetime decoupling as [`arg_bytes`]; for callers
    /// that need to pass the argument to a `&ZStr`-taking syscall wrapper
    /// without re-copying.
    #[inline]
    pub(crate) fn arg_zstr<'a>(&self, idx: usize) -> &'a bun_core::ZStr {
        let p: *const c_char = self.args[idx];
        // SAFETY: see `arg_bytes` — valid NUL-terminated argv pointer.
        bun_core::ZStr::from_cstr(unsafe { core::ffi::CStr::from_ptr(p) })
    }

    /// Construct a `Builtin` for `kind` and install it into the owning Cmd's
    /// `exec` slot. The caller then calls `Builtin::start`.
    pub(crate) fn init(interp: &Interpreter, cmd: NodeId, kind: Kind) {
        use crate::shell::states::cmd::Exec;

        let me = interp.as_cmd_mut(cmd);
        // Borrow argv[1..] as `*const c_char` into the Cmd's `args` storage.
        // The Cmd's `args: Vec<Vec<u8>>` are NUL-terminated by
        // `Cmd::transition_to_exec` before this is called.
        let args = me
            .args
            .iter()
            .skip(1)
            .map(|a| a.as_ptr().cast::<c_char>())
            .collect();
        me.exec = Exec::Builtin(Box::new(Builtin {
            kind,
            args,
            err_buf: Vec::new(),
            impl_: Self::make_impl(kind),
        }));
    }

    /// Writes a message of the shell about the command to the command's
    /// stderr, and finishes the command with exit code 1. Before
    /// `Cmd::apply_redirect` that is the stderr the command inherits: an
    /// expansion error and a redirect that cannot be set up are reported
    /// there. After it, it is the stderr that the redirect gave the command.
    pub(crate) fn cmd_write_failing_error(
        interp: &Interpreter,
        cmd: NodeId,
        args: core::fmt::Arguments<'_>,
    ) -> Yield {
        use std::io::Write as _;
        let mut buf = Vec::new();
        let _ = buf.write_fmt(args);
        if interp
            .as_cmd_mut(cmd)
            .io
            .stderr
            .make_writable(interp)
            .is_err()
        {
            return Yield::Failed(cmd);
        }
        if let Some(safeguard) = interp.as_cmd(cmd).io.stderr.needs_io() {
            interp.as_cmd_mut(cmd).state = CmdState::WaitingWriteErr;
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Cmd);
            return interp.as_cmd(cmd).io.stderr.enqueue(child, &buf, safeguard);
        }
        // No-IO path: the message goes to the captured buffer or the
        // `> ${buffer}` target, and the command finishes synchronously
        // (Cmd::on_io_writer_chunk's behaviour).
        let me = interp.as_cmd_mut(cmd);
        let shell = me.base.shell;
        // SAFETY: `shell` is `me.base.shell`, live for the Cmd's lifetime.
        let _ = unsafe { me.io.stderr.write_no_io_to(shell, &buf) };
        let parent = me.base.parent;
        interp.child_done(parent, cmd, 1)
    }

    /// Finish the builtin with `exit_code` and signal the owning Cmd.
    pub(crate) fn done(interp: &Interpreter, cmd: NodeId, exit_code: ExitCode) -> Yield {
        // Output is written through immediately in `write_no_io`, so there
        // is nothing to flush here.
        Cmd::on_exec_done(interp, cmd, exit_code)
    }

    /// Look up the Builtin inside a Cmd's `exec` slot.
    #[inline]
    #[track_caller]
    pub(crate) fn of<'a>(interp: &'a Interpreter, cmd: NodeId) -> &'a Builtin {
        match &interp.as_cmd(cmd).exec {
            crate::shell::states::cmd::Exec::Builtin(b) => b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        }
    }

    #[inline]
    #[track_caller]
    pub(crate) fn of_mut<'a>(interp: &'a Interpreter, cmd: NodeId) -> &'a mut Builtin {
        match &mut interp.as_cmd_mut(cmd).exec {
            crate::shell::states::cmd::Exec::Builtin(b) => b,
            _ => panic!("Cmd {} is not running a builtin", cmd),
        }
    }

    #[inline]
    fn kind_of(interp: &Interpreter, cmd: NodeId) -> Kind {
        Self::of(interp, cmd).kind
    }

    /// Returns the bytes available on stdin when it is *not* an async fd
    /// (arraybuf / piped buf / blob).
    pub(crate) fn read_stdin_no_io<'a>(interp: &'a Interpreter, cmd: NodeId) -> &'a [u8] {
        match &interp.as_cmd(cmd).io.stdin {
            CmdIn::ArrayBuf(buf) => buf.slice(),
            CmdIn::Blob(blob) => blob.shared_view(),
            CmdIn::Fd(_) | CmdIn::File(_) | CmdIn::Js(_) | CmdIn::Ignore => b"",
        }
    }

    /// Write `buf` to stdout/stderr without going through IOWriter (the
    /// stream is a captured buffer / arraybuffer / nothing).
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
        let cmd_node = interp.as_cmd_mut(cmd);
        let shell = cmd_node.base.shell;
        let out: &mut CmdOut = match io_kind {
            IoKind::Stdout => &mut cmd_node.io.stdout,
            IoKind::Stderr => &mut cmd_node.io.stderr,
        };
        // SAFETY: `shell` is `cmd_node.base.shell`, live for the Cmd's lifetime.
        unsafe { out.write_no_io_to(shell, buf) }
    }

    /// Shell exec env of the owning Cmd.
    #[inline]
    pub(crate) fn shell<'a>(
        interp: &'a Interpreter,
        cmd: NodeId,
    ) -> &'a crate::shell::interpreter::ShellExecEnv {
        interp.as_cmd(cmd).base.shell()
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
        Self::shell(interp, cmd).cwd_fd
    }

    /// Format `"{kind}: {fmt}"` into a fresh heap buffer.
    ///
    /// Stored on the `Builtin` so the returned `&[u8]` borrow stays valid
    /// across the immediate `write_no_io` / `enqueue` call.
    pub(crate) fn fmt_error_arena<'a>(
        interp: &'a Interpreter,
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

    /// Error messages formatted to match bash. Dispatches on the variant;
    /// `Sys` recurses into the system-error formatter.
    pub(crate) fn shell_err_to_string<'a>(
        interp: &'a Interpreter,
        cmd: NodeId,
        kind: Kind,
        err: &crate::shell::ShellErr,
    ) -> &'a [u8] {
        use crate::shell::ShellErr;
        match err {
            ShellErr::Sys(sys) => {
                // `"{message}\n"` or `"{message}: {path}\n"`.
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
                interp,
                cmd,
                Some(kind),
                format_args!("{}\n", bstr::BStr::new(s)),
            ),
        }
    }

    /// Error messages formatted to match bash. Maps the errno through
    /// `bun_sys::coreutils_error_map` so output matches GNU coreutils
    /// (e.g. `ENOENT` → "No such file or directory"); falls back to
    /// `"unknown error {errno}"` when unmapped.
    pub(crate) fn task_error_to_string<'a>(
        interp: &'a Interpreter,
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
                interp,
                cmd,
                Some(kind),
                format_args!("illegal option -- {}\n", bstr::BStr::new(e.opt())),
            )
            .to_vec(),
            ParseError::ShowUsage => kind.usage_string().to_vec(),
            ParseError::Unsupported(_) => Self::fmt_error_arena(
                interp,
                cmd,
                Some(kind),
                format_args!(
                    "unsupported option, please open a GitHub issue -- {}\n",
                    bstr::BStr::new(e.opt())
                ),
            )
            .to_vec(),
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
        if let Some(safeguard) = interp.as_cmd(cmd).io.stderr.needs_io() {
            let child = io_writer::ChildPtr::new(cmd, io_writer::WriterTag::Builtin);
            return interp.as_cmd(cmd).io.stderr.enqueue(child, buf, safeguard);
        }
        let _ = Self::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Self::done(interp, cmd, exit_code)
    }
}

// Cleanup: every `Impl` variant owns its state via `Box`/`Vec`/`Arc`. So
// cleanup is fully covered by `Drop` on `Box<Builtin>` (called from
// `Cmd::deinit`). No explicit deinit needed.
