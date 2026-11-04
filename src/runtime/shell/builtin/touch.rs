use crate::shell::builtin::{Builtin, BuiltinState, Impl, IoKind, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, FlagParser, Interpreter, NodeId, ParseFlagResult, ShellTask, parse_flags,
};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use bun_core::strings;

#[derive(Default)]
pub(crate) struct Touch {
    pub(crate) state: State,
}

#[derive(Default)]
pub(crate) enum State {
    #[default]
    Idle,
    /// The pool task that walks the operands is out.
    Exec,
    /// The error lines in operand order, for a stderr that is an `IOWriter`.
    /// `lines[..sent]` is written or is the one chunk in flight.
    WritingErrs {
        lines: Vec<u8>,
        sent: usize,
    },
    WaitingWriteErr,
    Done,
}

/// An `IOWriter` gets the error lines in chunks of whole lines, at most this
/// many bytes each, or one longer line. A `write` of more than a page to a
/// blocking pipe waits for the reader, and that holds the interpreter thread.
const CHUNK: usize = 4096;

impl Touch {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        let mut opts = Opts::default();
        let args_start = {
            let args = Builtin::of(interp, cmd).args_slice();
            match parse_flags(&mut opts, args) {
                Ok(Some(rest)) => args.len() - rest.len(),
                Ok(None) => {
                    Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
                    return Builtin::write_failing_error(
                        interp,
                        cmd,
                        Kind::Touch.usage_string(),
                        1,
                    );
                }
                Err(e) => {
                    return Builtin::fail_parse(interp, cmd, Kind::Touch, &e, || {
                        Self::state_mut(interp, cmd).state = State::WaitingWriteErr
                    });
                }
            }
        };
        let builtin = Builtin::of(interp, cmd);
        let argc = builtin.args_slice().len();
        let len = |operand| builtin.arg_bytes(operand).len() + 1;
        let mut operands = Vec::with_capacity((args_start..argc).map(len).sum());
        for operand in args_start..argc {
            operands.extend_from_slice(builtin.arg_bytes(operand));
            operands.push(0);
        }
        let cwd = Builtin::shell(interp, cmd).cwd().to_vec();
        let evtloop = Builtin::event_loop(interp, cmd);
        let task = ShellTouchTask::create(cmd, operands, cwd, evtloop, interp.as_ctx_ptr());
        Self::state_mut(interp, cmd).state = State::Exec;
        // SAFETY: freshly heap-allocated.
        unsafe { ShellTask::schedule(task) };
        Yield::suspended()
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        // A stderr that failed takes no more chunks.
        if let Some(_err) = e {
            Self::state_mut(interp, cmd).state = State::Done;
            return Builtin::done(interp, cmd, 1);
        }
        match Self::state_mut(interp, cmd).state {
            State::WritingErrs { .. } => Self::write_errs(interp, cmd),
            // The usage or option error is written.
            _ => Builtin::done(interp, cmd, 1),
        }
    }

    /// The walk is done. `errs` has the operands that failed, in operand order.
    fn on_shell_touch_task_done(interp: &Interpreter, cmd: NodeId, errs: &[bun_sys::Error]) {
        if errs.is_empty() {
            Self::state_mut(interp, cmd).state = State::Done;
            return Builtin::done(interp, cmd, 0).run(interp);
        }
        let mut lines = Vec::new();
        for e in errs {
            lines.extend_from_slice(Builtin::task_error_to_string(interp, cmd, Kind::Touch, e));
        }
        if Builtin::of(interp, cmd).stderr.needs_io().is_none() {
            let _ = Builtin::write_no_io(interp, cmd, IoKind::Stderr, &lines);
            Self::state_mut(interp, cmd).state = State::Done;
            return Builtin::done(interp, cmd, 1).run(interp);
        }
        Self::state_mut(interp, cmd).state = State::WritingErrs { lines, sent: 0 };
        Self::write_errs(interp, cmd).run(interp);
    }

    /// Queues the next chunk of error lines on the `IOWriter` of stderr, or
    /// finishes with exit code 1 after the last one.
    fn write_errs(interp: &Interpreter, cmd: NodeId) -> Yield {
        // `stderr` and `impl_` are disjoint fields of `Builtin`, so the chunk
        // is enqueued out of `lines` without a copy.
        let builtin = Builtin::of_mut(interp, cmd);
        let Impl::Touch(touch) = &mut builtin.impl_ else {
            unreachable!()
        };
        let State::WritingErrs { lines, sent } = &mut touch.state else {
            unreachable!()
        };
        let start = *sent;
        if start == lines.len() {
            touch.state = State::Done;
            return Builtin::done(interp, cmd, 1);
        }
        let end = start + chunk_len(&lines[start..]);
        *sent = end;
        let Some(safeguard) = builtin.stderr.needs_io() else {
            unreachable!("only a stderr with an IOWriter gets here")
        };
        // Nothing follows the enqueue: on Windows a write that fails inside it
        // completes the chunk there, and that ends the command.
        let child = ChildPtr::new(cmd, WriterTag::Builtin);
        builtin.stderr.enqueue(child, &lines[start..end], safeguard)
    }
}

/// The size of the whole lines at the start of `lines` that fit in [`CHUNK`],
/// or of the first line when that line alone is longer.
fn chunk_len(lines: &[u8]) -> usize {
    if lines.len() <= CHUNK {
        return lines.len();
    }
    let newline = strings::last_index_of_char(&lines[..CHUNK], b'\n')
        .or_else(|| strings::index_of_char_usize(lines, b'\n'));
    newline.map_or(lines.len(), |newline| newline + 1)
}

/// Touches the operands of one command on a worker thread, one after the
/// other in the order of the command line.
pub(crate) struct ShellTouchTask {
    pub(crate) cmd: NodeId,
    /// The operands in the order of the command line, each followed by a NUL.
    pub(crate) operands: Vec<u8>,
    pub(crate) cwd_path: Vec<u8>,
    /// The operands that failed, in the order of the command line.
    pub(crate) errs: Vec<bun_sys::Error>,
    pub task: ShellTask,
}

impl ShellTouchTask {
    pub(crate) fn create(
        cmd: NodeId,
        operands: Vec<u8>,
        cwd_path: Vec<u8>,
        evtloop: EventLoopHandle,
        interp: *mut Interpreter,
    ) -> *mut ShellTouchTask {
        let mut task = Box::new(ShellTouchTask {
            cmd,
            operands,
            cwd_path,
            errs: Vec::new(),
            task: ShellTask::new(evtloop),
        });
        task.task.interp = interp;
        bun_core::heap::into_raw(task)
    }

    pub(crate) fn run_from_thread_pool(this: &mut ShellTouchTask) {
        let mut spill = Vec::new();
        let mut rest = &this.operands[..];
        while let Some(len) = strings::index_of_char_usize(rest, 0) {
            if let Err(e) = Self::touch_one(&this.cwd_path, &rest[..len], &mut spill) {
                this.errs.push(e);
            }
            rest = &rest[len + 1..];
        }
        // Worker→main bounce-back is posted by `shell_task_trampoline` after
        // this returns.
    }

    /// utimes() the path; on ENOENT
    /// fall back to `open(O_CREAT|O_WRONLY, 0o664)`.
    fn touch_one(cwd_path: &[u8], operand: &[u8], spill: &mut Vec<u8>) -> bun_sys::Result<()> {
        use bun_paths::resolve_path::{self, Platform, platform};
        use bun_sys::FdExt as _;
        // We have to give an absolute path. An operand that does not fit the
        // path buffer is still passed on whole, so the OS reports ENAMETOOLONG
        // for it like for any other operand.
        let filepath: &bun_core::ZStr = if Platform::AUTO.is_absolute(operand) {
            // Re-terminate (`operand` is the bare argv bytes without the
            // trailing NUL).
            resolve_path::join_z_spill::<platform::Auto>(spill, &[operand])
        } else {
            resolve_path::join_z_spill::<platform::Auto>(spill, &[cwd_path, operand])
        };

        // Call the bun_sys layer directly (uv_fs_utime on Windows) to avoid
        // the heavyweight NodeFS state.
        let milliseconds = bun_core::time::milli_timestamp();
        let atime = bun_sys::TimeLike {
            sec: milliseconds.div_euclid(1_000),
            nsec: milliseconds.rem_euclid(1_000) * 1_000_000,
        };
        let mtime = atime;
        if let Err(err) = bun_sys::utimens(filepath, atime, mtime) {
            'out: {
                if err.get_errno() == bun_sys::E::ENOENT {
                    const PERM: bun_sys::Mode = 0o664;
                    match bun_sys::open(filepath, bun_sys::O::CREAT | bun_sys::O::WRONLY, PERM) {
                        Ok(fd) => {
                            fd.close();
                            break 'out;
                        }
                        Err(e) => return Err(e.with_path(filepath.as_bytes())),
                    }
                }
                return Err(err.with_path(filepath.as_bytes()));
            }
        }
        Ok(())
    }

    /// # Safety
    /// `this` must be a live heap allocation produced by [`Self::create`];
    /// ownership is reclaimed here.
    fn run_from_main_thread(this: *mut ShellTouchTask, interp: &Interpreter) {
        // SAFETY: `this` is a live heap-allocated task.
        let task = unsafe { bun_core::heap::take(this) };
        Touch::on_shell_touch_task_done(interp, task.cmd, &task.errs);
    }
}

impl bun_event_loop::Taskable for ShellTouchTask {
    const TAG: bun_event_loop::TaskTag = bun_event_loop::task_tag::ShellTouchTask;
    /// A pool completion that will not run: drop the keep-alive and the box
    /// (nothing else frees an unrun one).
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box the builtin scheduled.
        unsafe {
            (*this).task.unref_unrun();
            drop(bun_core::heap::take(this));
        }
    }
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl crate::shell::interpreter::ShellTaskCtx for ShellTouchTask {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        Self::run_from_thread_pool(this)
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: `ShellTaskCtx` callers guarantee `this` is the live
        // heap-allocated task posted via `ShellTask::schedule`.
        Self::run_from_main_thread(this, interp)
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Opts {}

impl FlagParser for Opts {
    fn parse_long<'a>(&mut self, flag: &'a [u8]) -> Option<ParseFlagResult<'a>> {
        match flag {
            b"--no-create" => Some(ParseFlagResult::Unsupported(b"--no-create")),
            b"--date" => Some(ParseFlagResult::Unsupported(b"--date")),
            b"--reference" => Some(ParseFlagResult::Unsupported(b"--reference=FILE")),
            b"--time" => Some(ParseFlagResult::Unsupported(b"--reference=FILE")),
            _ => None,
        }
    }

    fn parse_short<'a>(
        &mut self,
        ch: u8,
        smallflags: &'a [u8],
        i: usize,
    ) -> Option<ParseFlagResult<'a>> {
        match ch {
            b'a' => Some(ParseFlagResult::Unsupported(b"-a")),
            b'c' => Some(ParseFlagResult::Unsupported(b"-c")),
            b'd' => Some(ParseFlagResult::Unsupported(b"-d")),
            b'h' => Some(ParseFlagResult::Unsupported(b"-h")),
            b'm' => Some(ParseFlagResult::Unsupported(b"-m")),
            b'r' => Some(ParseFlagResult::Unsupported(b"-r")),
            b't' => Some(ParseFlagResult::Unsupported(b"-t")),
            _ => Some(ParseFlagResult::IllegalOption(&smallflags[1 + i..])),
        }
    }
}
