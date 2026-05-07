use core::ffi::CStr;
use std::sync::Arc;

use crate::shell::builtin::{Builtin, BuiltinIO, BuiltinInput, IoKind, Kind};
use crate::shell::interpreter::{
    parse_flags, shell_openat, unsupported_flag, FlagParser, Interpreter, NodeId, ParseError,
    ParseFlagResult,
};
use crate::shell::io_reader::{ChildPtr as ReaderChildPtr, IOReader, ReaderTag};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

#[derive(Default)]
pub struct Cat {
    pub opts: Opts,
    pub state: CatState,
}

#[derive(Default)]
pub enum CatState {
    #[default]
    Idle,
    /// Spec cat.zig `.exec_stdin`.
    ExecStdin {
        in_done: bool,
        chunks_queued: usize,
        chunks_done: usize,
        errno: ExitCode,
    },
    /// Spec cat.zig `.exec_filepath_args`.
    ExecFilepathArgs {
        /// Index into argv where filepath args start.
        args_start: usize,
        /// Current index into the filepath args.
        idx: usize,
        /// Per-file reader (Spec: `reader: ?*IOReader`). Dropping the `Arc`
        /// IS the Zig `r.deref()`.
        reader: Option<Arc<IOReader>>,
        chunks_queued: usize,
        chunks_done: usize,
        out_done: bool,
        in_done: bool,
    },
    WaitingWriteErr,
    Done,
}

/// Internal: what to do after dropping the &mut state borrow.
enum Step {
    Suspend,
    Done(ExitCode),
    Next,
}

impl Cat {
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        let mut opts = Opts::default();
        let filepath_start = {
            let args = Builtin::of(interp, cmd).args_slice();
            match parse_flags(&mut opts, args) {
                Ok(Some(rest)) => Some(args.len() - rest.len()),
                Ok(None) => None,
                Err(e) => return Self::fail_parse(interp, cmd, e),
            }
        };
        Self::state_mut(interp, cmd).opts = opts;

        let argc = Builtin::of(interp, cmd).args_slice().len();
        let should_read_from_stdin =
            filepath_start.is_none() || filepath_start == Some(argc);

        Self::state_mut(interp, cmd).state = if should_read_from_stdin {
            CatState::ExecStdin {
                in_done: false,
                chunks_queued: 0,
                chunks_done: 0,
                errno: 0,
            }
        } else {
            CatState::ExecFilepathArgs {
                args_start: filepath_start.unwrap(),
                idx: 0,
                reader: None,
                chunks_queued: 0,
                chunks_done: 0,
                out_done: false,
                in_done: false,
            }
        };

        Self::next(interp, cmd)
    }

    fn fail_parse(interp: &mut Interpreter, cmd: NodeId, e: ParseError) -> Yield {
        let buf: Vec<u8> = match e {
            ParseError::IllegalOption(s) => Builtin::fmt_error_arena(
                interp,
                cmd,
                Some(Kind::Cat),
                // SAFETY: payload borrows argv or is 'static.
                format_args!("illegal option -- {}\n", bstr::BStr::new(unsafe { &*s })),
            )
            .to_vec(),
            ParseError::ShowUsage => Kind::Cat.usage_string().to_vec(),
            ParseError::Unsupported(s) => Builtin::fmt_error_arena(
                interp,
                cmd,
                Some(Kind::Cat),
                format_args!(
                    "unsupported option, please open a GitHub issue -- {}\n",
                    // SAFETY: see above.
                    bstr::BStr::new(unsafe { &*s })
                ),
            )
            .to_vec(),
        };
        Self::write_failing_error(interp, cmd, &buf, 1)
    }

    /// Spec: cat.zig `writeFailingError`.
    fn write_failing_error(
        interp: &mut Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = CatState::WaitingWriteErr;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, exit_code)
    }

    /// Spec: cat.zig `next`.
    pub fn next(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        // PORT NOTE: reshaped for borrowck — read scalars, drop borrow, act.
        enum Branch {
            Stdin,
            FileArg { args_start: usize, idx: usize },
            WaitingErr,
            Done,
        }
        let branch = match &Self::state_mut(interp, cmd).state {
            CatState::Idle => panic!("Invalid state"),
            CatState::ExecStdin { .. } => Branch::Stdin,
            CatState::ExecFilepathArgs { args_start, idx, .. } => {
                Branch::FileArg { args_start: *args_start, idx: *idx }
            }
            CatState::WaitingWriteErr => Branch::WaitingErr,
            CatState::Done => Branch::Done,
        };
        match branch {
            Branch::Stdin => {
                // Stdin doesn't need IO (captured/ignored): read it all
                // synchronously and write straight to stdout.
                let stdin_needs_io = Builtin::of(interp, cmd).stdin.needs_io();
                if !stdin_needs_io {
                    if let CatState::ExecStdin { in_done, .. } =
                        &mut Self::state_mut(interp, cmd).state
                    {
                        *in_done = true;
                    }
                    // PORT NOTE: reshaped for borrowck — copy stdin bytes so
                    // the &mut on `stdout`/`write_no_io` doesn't overlap a
                    // borrow of `stdin`.
                    let buf = Builtin::read_stdin_no_io(interp, cmd).to_vec();
                    if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
                        let child = ChildPtr::new(cmd, WriterTag::Builtin);
                        return Builtin::of_mut(interp, cmd)
                            .stdout
                            .enqueue(child, &buf, safeguard);
                    }
                    let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &buf);
                    return Builtin::done(interp, cmd, 0);
                }
                // TODO(b2-blocked): IOReader::add_reader + start — register
                // ourselves on the stdin IOReader and pump chunks via
                // on_io_reader_chunk/on_io_reader_done.
                Yield::suspended()
            }
            Branch::FileArg { args_start, idx } => {
                let argc = Builtin::of(interp, cmd).args_slice().len();
                let n_files = argc - args_start;
                if idx >= n_files {
                    // exec.deinit() — drop the reader if any (gated).
                    return Builtin::done(interp, cmd, 0);
                }
                // Deref the previous reader (gated).

                let arg_ptr = Builtin::of(interp, cmd).args_slice()[args_start + idx];
                // SAFETY: argv entries are NUL-terminated.
                let arg = unsafe { CStr::from_ptr(arg_ptr) }.to_bytes().to_vec();
                if let CatState::ExecFilepathArgs {
                    idx: i,
                    chunks_done,
                    chunks_queued,
                    in_done,
                    out_done,
                    ..
                } = &mut Self::state_mut(interp, cmd).state
                {
                    *i += 1;
                    *chunks_done = 0;
                    *chunks_queued = 0;
                    *in_done = false;
                    *out_done = false;
                }

                let _cwd = Builtin::cwd(interp, cmd);
                // TODO(b2-blocked): ShellSyscall::openat(cwd, arg, O_RDONLY)
                // + IOReader::init + add_reader + start. On open error, format
                // via task_error_to_string and writeFailingError(1).
                let _ = arg;
                Yield::suspended()
            }
            Branch::WaitingErr => Yield::failed(),
            Branch::Done => Builtin::done(interp, cmd, 0),
        }
    }

    /// Spec: cat.zig `onIOWriterChunk`.
    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(e) = err {
            let errno = e.errno as ExitCode;
            // Writing to stdout errored: cancel everything and finish.
            let step = match &mut Self::state_mut(interp, cmd).state {
                CatState::ExecStdin { in_done, errno: st_errno, .. } => {
                    *st_errno = errno;
                    if !*in_done {
                        // TODO(b2-blocked): IOReader::remove_reader on stdin.
                        *in_done = true;
                    }
                    Step::Done(errno)
                }
                CatState::ExecFilepathArgs { .. } => {
                    // TODO(b2-blocked): reader.remove_reader + exec.deinit().
                    Step::Done(errno)
                }
                CatState::WaitingWriteErr => Step::Done(errno),
                _ => panic!("Invalid state"),
            };
            return match step {
                Step::Done(c) => Builtin::done(interp, cmd, c),
                _ => unreachable!(),
            };
        }

        let step = match &mut Self::state_mut(interp, cmd).state {
            CatState::ExecStdin { chunks_queued, chunks_done, in_done, .. } => {
                *chunks_done += 1;
                if *in_done && *chunks_done >= *chunks_queued {
                    Step::Done(0)
                } else {
                    Step::Suspend
                }
            }
            CatState::ExecFilepathArgs {
                chunks_queued,
                chunks_done,
                in_done,
                out_done,
                ..
            } => {
                *chunks_done += 1;
                if *chunks_done >= *chunks_queued {
                    *out_done = true;
                }
                if *in_done && *out_done { Step::Next } else { Step::Suspend }
            }
            CatState::WaitingWriteErr => Step::Done(1),
            _ => panic!("Invalid state"),
        };
        match step {
            Step::Suspend => Yield::suspended(),
            Step::Done(code) => Builtin::done(interp, cmd, code),
            Step::Next => Self::next(interp, cmd),
        }
    }

    /// Spec: cat.zig `onIOReaderChunk`.
    pub fn on_io_reader_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        chunk: &[u8],
        remove: &mut bool,
    ) -> Yield {
        *remove = false;
        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io();
        match &mut Self::state_mut(interp, cmd).state {
            CatState::ExecStdin { chunks_queued, .. }
            | CatState::ExecFilepathArgs { chunks_queued, .. } => {
                if let Some(safeguard) = stdout_needs_io {
                    *chunks_queued += 1;
                    let child = ChildPtr::new(cmd, WriterTag::Builtin);
                    return Builtin::of_mut(interp, cmd)
                        .stdout
                        .enqueue(child, chunk, safeguard);
                }
            }
            _ => panic!("Invalid state"),
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, chunk);
        Yield::done()
    }

    /// Spec: cat.zig `onIOReaderDone`.
    pub fn on_io_reader_done(
        interp: &mut Interpreter,
        cmd: NodeId,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        let errno: ExitCode = err.map(|e| e.errno as ExitCode).unwrap_or(0);
        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io().is_some();
        let step = match &mut Self::state_mut(interp, cmd).state {
            CatState::ExecStdin { chunks_queued, chunks_done, in_done, errno: st_errno } => {
                *st_errno = errno;
                *in_done = true;
                if errno != 0 {
                    if *chunks_done >= *chunks_queued || !stdout_needs_io {
                        Step::Done(errno)
                    } else {
                        // TODO(b2-blocked): IOWriter::cancel_chunks(self).
                        Step::Suspend
                    }
                } else if *chunks_done >= *chunks_queued || !stdout_needs_io {
                    Step::Done(0)
                } else {
                    Step::Suspend
                }
            }
            CatState::ExecFilepathArgs { chunks_queued, chunks_done, in_done, out_done, .. } => {
                *in_done = true;
                if errno != 0 {
                    if *out_done || !stdout_needs_io {
                        // exec.deinit() — gated.
                        Step::Done(errno)
                    } else {
                        // TODO(b2-blocked): IOWriter::cancel_chunks(self).
                        Step::Suspend
                    }
                } else if *out_done || *chunks_done >= *chunks_queued || !stdout_needs_io {
                    Step::Next
                } else {
                    Step::Suspend
                }
            }
            CatState::Done | CatState::WaitingWriteErr | CatState::Idle => Step::Suspend,
        };
        match step {
            Step::Suspend => Yield::suspended(),
            Step::Done(code) => Builtin::done(interp, cmd, code),
            Step::Next => Self::next(interp, cmd),
        }
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Cat {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Cat(c) => &mut **c,
            _ => unreachable!(),
        }
    }
}

#[derive(Clone, Copy, Default)]
pub struct Opts {
    /// `-b` — number the non-blank output lines, starting at 1.
    pub number_nonblank: bool,
    /// `-e` — display non-printing characters and a `$` at end of each line.
    pub show_ends: bool,
    /// `-n` — number the output lines, starting at 1.
    pub number_all: bool,
    /// `-s` — squeeze multiple adjacent empty lines.
    pub squeeze_blank: bool,
    /// `-t` — display non-printing characters and tabs as `^I`.
    pub show_tabs: bool,
    /// `-u` — disable output buffering.
    pub disable_output_buffering: bool,
    /// `-v` — display non-printing characters so they are visible.
    pub show_nonprinting: bool,
}

impl FlagParser for Opts {
    fn parse_long(&mut self, _flag: &[u8]) -> Option<ParseFlagResult> {
        None
    }

    fn parse_short(&mut self, ch: u8, smallflags: &[u8], i: usize) -> Option<ParseFlagResult> {
        match ch {
            b'b' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-b"))),
            b'e' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-e"))),
            b'n' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-n"))),
            b's' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-s"))),
            b't' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-t"))),
            b'u' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-u"))),
            b'v' => Some(ParseFlagResult::Unsupported(unsupported_flag(b"-v"))),
            _ => Some(ParseFlagResult::IllegalOption(
                &smallflags[1 + i..] as *const [u8],
            )),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/cat.zig (357 lines)
//   confidence: medium (NodeId style; full state machine; openat/IOReader stubbed)
//   blocked_on: ShellSyscall::openat, IOReader::{init,add_reader,start},
//               IOWriter::{enqueue,cancel_chunks}, Builtin::read_stdin_no_io
// ──────────────────────────────────────────────────────────────────────────
