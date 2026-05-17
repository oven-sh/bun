use std::sync::Arc;

use bun_ptr::AsCtxPtr;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinInput, BuiltinState, IoKind, Kind};
use crate::shell::interpreter::{Interpreter, NodeId, shell_openat};
use crate::shell::io_reader::{ChildPtr as ReaderChildPtr, IOReader, ReaderTag};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;

#[derive(Default)]
pub struct Head {
    pub lines: usize,
    pub state: HeadState,
    /// Saved file-args context for resuming after async write.
    pub file_args: Option<FileArgsCtx>,
}

pub struct FileArgsCtx {
    pub args_start: usize,
    pub idx: usize,
}

#[derive(Default)]
pub enum HeadState {
    #[default]
    Idle,
    ExecStdin {
        collected: Vec<u8>,
        in_done: bool,
    },
    ExecFilepathArgs {
        args_start: usize,
        idx: usize,
        reader: Option<Arc<IOReader>>,
        collected: Vec<u8>,
        in_done: bool,
    },
    WaitingWriteErr,
    WaitingWriteOut,
    Done,
}

impl Head {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let argc = Builtin::of(interp, cmd).args_slice().len();

        // Manual arg parsing for -n <count>.
        let mut lines: usize = 10;
        let mut filepath_start: Option<usize> = None;
        let mut idx = 0usize;
        while idx < argc {
            let arg = Builtin::of(interp, cmd).arg_bytes(idx);
            if arg == b"--" {
                filepath_start = Some(idx + 1);
                break;
            }
            if arg == b"-n" {
                idx += 1;
                if idx >= argc {
                    return Self::fail(interp, cmd, b"head: option requires an argument -- n\n");
                }
                let val = Builtin::of(interp, cmd).arg_bytes(idx);
                match parse_usize(val) {
                    Some(n) => lines = n,
                    None => {
                        return Self::fail(interp, cmd, b"head: invalid number of lines\n");
                    }
                }
                idx += 1;
                continue;
            }
            if arg.starts_with(b"-n") && arg.len() > 2 {
                match parse_usize(&arg[2..]) {
                    Some(n) => lines = n,
                    None => {
                        return Self::fail(interp, cmd, b"head: invalid number of lines\n");
                    }
                }
                idx += 1;
                continue;
            }
            if arg.starts_with(b"--lines=") && arg.len() > 8 {
                match parse_usize(&arg[8..]) {
                    Some(n) => lines = n,
                    None => {
                        return Self::fail(interp, cmd, b"head: invalid number of lines\n");
                    }
                }
                idx += 1;
                continue;
            }
            // Not a flag — first positional arg.
            if arg.starts_with(b"-") && arg.len() > 1 {
                // Check for -<number> shorthand (e.g. head -5).
                if let Some(n) = parse_usize(&arg[1..]) {
                    lines = n;
                    idx += 1;
                    continue;
                }
                return Self::fail(interp, cmd, b"head: invalid option\n");
            }
            filepath_start = Some(idx);
            break;
        }

        Self::state_mut(interp, cmd).lines = lines;

        let has_files = filepath_start.is_some() && filepath_start.unwrap() < argc;

        Self::state_mut(interp, cmd).state = if has_files {
            HeadState::ExecFilepathArgs {
                args_start: filepath_start.unwrap(),
                idx: 0,
                reader: None,
                collected: Vec::new(),
                in_done: false,
            }
        } else {
            HeadState::ExecStdin {
                collected: Vec::new(),
                in_done: false,
            }
        };

        Self::next(interp, cmd)
    }

    pub fn next(interp: &Interpreter, cmd: NodeId) -> Yield {
        enum Branch {
            Stdin,
            FileArg { args_start: usize, idx: usize },
            WaitingErr,
            WaitingOut,
            Done,
        }
        let branch = match &Self::state_mut(interp, cmd).state {
            HeadState::Idle => panic!("Invalid state"),
            HeadState::ExecStdin { .. } => Branch::Stdin,
            HeadState::ExecFilepathArgs {
                args_start, idx, ..
            } => Branch::FileArg {
                args_start: *args_start,
                idx: *idx,
            },
            HeadState::WaitingWriteErr => Branch::WaitingErr,
            HeadState::WaitingWriteOut => Branch::WaitingOut,
            HeadState::Done => Branch::Done,
        };
        match branch {
            Branch::Stdin => {
                let stdin_needs_io = Builtin::of(interp, cmd).stdin.needs_io();
                if !stdin_needs_io {
                    let buf = Builtin::read_stdin_no_io(interp, cmd).to_vec();
                    let n = Self::state_mut(interp, cmd).lines;
                    let output = first_n_lines(&buf, n);
                    return Self::write_output(interp, cmd, output);
                }
                let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                let reader = match &Builtin::of(interp, cmd).stdin {
                    BuiltinInput::Fd(r) => r.clone(),
                    _ => unreachable!("needs_io() returned true"),
                };
                reader.set_interp(interp_ptr);
                reader.add_reader(ReaderChildPtr {
                    node: cmd,
                    tag: ReaderTag::Head,
                });
                reader.start()
            }
            Branch::FileArg { args_start, idx } => {
                let argc = Builtin::of(interp, cmd).args_slice().len();
                let n_files = argc - args_start;
                if idx >= n_files {
                    if let HeadState::ExecFilepathArgs { reader, .. } =
                        &mut Self::state_mut(interp, cmd).state
                    {
                        *reader = None;
                    }
                    return Builtin::done(interp, cmd, 0);
                }
                if let HeadState::ExecFilepathArgs { reader, .. } =
                    &mut Self::state_mut(interp, cmd).state
                {
                    *reader = None;
                }

                let path = Builtin::of(interp, cmd).arg_zstr(args_start + idx);

                if let HeadState::ExecFilepathArgs { idx: i, .. } =
                    &mut Self::state_mut(interp, cmd).state
                {
                    *i += 1;
                }

                let dir = Builtin::cwd(interp, cmd);
                let fd = match shell_openat(dir, path, bun_sys::O::RDONLY, 0) {
                    Ok(fd) => fd,
                    Err(e) => {
                        let buf =
                            Builtin::task_error_to_string(interp, cmd, Kind::Head, &e).to_vec();
                        return Self::write_failing_error(interp, cmd, &buf, 1);
                    }
                };

                let evtloop = Builtin::event_loop(interp, cmd);
                let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
                let reader = IOReader::init(fd, evtloop);
                reader.set_interp(interp_ptr);
                if let HeadState::ExecFilepathArgs {
                    reader: slot,
                    in_done,
                    collected,
                    ..
                } = &mut Self::state_mut(interp, cmd).state
                {
                    *in_done = false;
                    collected.clear();
                    *slot = Some(reader.clone());
                }
                reader.add_reader(ReaderChildPtr {
                    node: cmd,
                    tag: ReaderTag::Head,
                });
                reader.start()
            }
            Branch::WaitingErr => Yield::failed(),
            Branch::WaitingOut => Yield::suspended(),
            Branch::Done => Builtin::done(interp, cmd, 0),
        }
    }

    fn fail(interp: &Interpreter, cmd: NodeId, msg: &[u8]) -> Yield {
        Self::state_mut(interp, cmd).state = HeadState::WaitingWriteErr;
        Builtin::write_failing_error(interp, cmd, msg, 1)
    }

    fn write_failing_error(
        interp: &Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        if let Some(safeguard) = Builtin::of(interp, cmd).stderr.needs_io() {
            Self::state_mut(interp, cmd).state = HeadState::WaitingWriteErr;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stderr
                .enqueue(child, buf, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, buf);
        Builtin::done(interp, cmd, exit_code)
    }

    fn write_output(interp: &Interpreter, cmd: NodeId, output: Vec<u8>) -> Yield {
        // Save file-args context before transitioning to WaitingWriteOut
        // so on_io_writer_chunk can restore and advance to the next file.
        if let HeadState::ExecFilepathArgs { args_start, idx, .. } =
            &Self::state_mut(interp, cmd).state
        {
            Self::state_mut(interp, cmd).file_args = Some(FileArgsCtx {
                args_start: *args_start,
                idx: *idx,
            });
        }

        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).state = HeadState::WaitingWriteOut;
            let child = ChildPtr::new(cmd, WriterTag::Builtin);
            return Builtin::of_mut(interp, cmd)
                .stdout
                .enqueue(child, &output, safeguard);
        }
        let _ = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &output);

        // For multi-file mode, advance to the next file.
        if Self::state_mut(interp, cmd).file_args.is_some() {
            let ctx = Self::state_mut(interp, cmd).file_args.take().unwrap();
            Self::state_mut(interp, cmd).state = HeadState::ExecFilepathArgs {
                args_start: ctx.args_start,
                idx: ctx.idx,
                reader: None,
                collected: Vec::new(),
                in_done: false,
            };
            Self::next(interp, cmd)
        } else {
            Builtin::done(interp, cmd, 0)
        }
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if err.is_some() {
            return Builtin::done(interp, cmd, 1);
        }
        match &Self::state_mut(interp, cmd).state {
            HeadState::WaitingWriteErr => Builtin::done(interp, cmd, 1),
            HeadState::WaitingWriteOut => {
                // Restore file-args context and advance to next file.
                if let Some(ctx) = Self::state_mut(interp, cmd).file_args.take() {
                    Self::state_mut(interp, cmd).state = HeadState::ExecFilepathArgs {
                        args_start: ctx.args_start,
                        idx: ctx.idx,
                        reader: None,
                        collected: Vec::new(),
                        in_done: false,
                    };
                    Self::next(interp, cmd)
                } else {
                    Self::state_mut(interp, cmd).state = HeadState::Done;
                    Builtin::done(interp, cmd, 0)
                }
            }
            _ => Builtin::done(interp, cmd, 0),
        }
    }

    /// Called by IOReader when a chunk of data is available.
    pub fn on_io_reader_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        chunk: &[u8],
        remove: &mut bool,
    ) -> Yield {
        *remove = false;
        let n = Self::state_mut(interp, cmd).lines;

        match &mut Self::state_mut(interp, cmd).state {
            HeadState::ExecStdin { collected, .. }
            | HeadState::ExecFilepathArgs { collected, .. } => {
                collected.extend_from_slice(chunk);
                // Check if we have enough lines to stop reading early.
                let line_count = collected.iter().filter(|&&b| b == b'\n').count();
                if line_count >= n {
                    *remove = true;
                }
            }
            _ => panic!("Invalid state"),
        }
        Yield::done()
    }

    /// Called by IOReader when all data has been read.
    pub fn on_io_reader_done(
        interp: &Interpreter,
        cmd: NodeId,
        err: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(e) = err {
            let errno = e.get_errno() as ExitCode;
            e.deref();
            return Builtin::done(interp, cmd, errno);
        }

        let n = Self::state_mut(interp, cmd).lines;

        let output = match &mut Self::state_mut(interp, cmd).state {
            HeadState::ExecStdin { collected, in_done, .. } => {
                *in_done = true;
                first_n_lines(collected, n)
            }
            HeadState::ExecFilepathArgs { collected, in_done, .. } => {
                *in_done = true;
                first_n_lines(collected, n)
            }
            _ => return Builtin::done(interp, cmd, 0),
        };

        Self::write_output(interp, cmd, output)
    }
}

/// Extract the first `n` lines from `data`.
fn first_n_lines(data: &[u8], n: usize) -> Vec<u8> {
    if n == 0 {
        return Vec::new();
    }
    let mut count = 0;
    for (i, &byte) in data.iter().enumerate() {
        if byte == b'\n' {
            count += 1;
            if count >= n {
                return data[..=i].to_vec();
            }
        }
    }
    // Fewer than n lines — return everything.
    data.to_vec()
}

fn parse_usize(bytes: &[u8]) -> Option<usize> {
    let s = core::str::from_utf8(bytes).ok()?;
    s.parse().ok()
}
