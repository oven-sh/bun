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
    pub impl_: Impl,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
pub enum Kind {
    Cd, Echo, Export, Exit, Pwd, True, False, Which, Rm, Mv, Ls, Mkdir,
    Touch, Cat, Cp, Seq, Dirname, Basename, Yes,
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
    // TODO(b2-blocked): Which, Ls, Mkdir, Touch, Cp, Seq, Yes — gated until
    // their async-task plumbing (ShellTask/WorkPool) is converted.
    Unimplemented,
}

impl Builtin {
    #[inline]
    pub fn args_slice(&self) -> &[*const c_char] {
        &self.args
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
            // TODO(b2-blocked): remaining builtins
            _ => Self::done(interp, cmd, 1),
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
            _ => Yield::done(),
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
}

// The full body (~900 lines: Kind::from_argv0, init, redirect handling,
// stdin/stdout/stderr open, write_failing_error_fmt, OutputSrc) is preserved
// gated — depends on ast::Cmd, IOWriter::enqueue, bun_sys open flags.
#[cfg(any())]
mod builtin_body {
    include!("Builtin_body_gated.rs");
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/Builtin.zig (1015 lines)
//   confidence: medium (NodeId dispatch; init/redirect body gated)
//   blocked_on: ast::Cmd, IOWriter::enqueue, bun_sys open
// ──────────────────────────────────────────────────────────────────────────
