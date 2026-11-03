//! One pool task runs every operand of `mkdir` or `touch` in the order typed, so that `mkdir a a/b` works.

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, IoKind, Kind, OutputRuns};
use crate::shell::interpreter::{
    FlagParser, Interpreter, NodeId, ParseError, ShellTask, ShellTaskCtx, parse_flags,
};
use crate::shell::yield_::Yield;

/// A builtin whose operand is one blocking call that prints to stdout and fails with one errno.
pub(crate) trait OperandBuiltin: BuiltinState + 'static {
    const KIND: Kind;
    /// The tag whose `runtime::dispatch` arms name `OperandWalkTask<Self>`.
    const TASK_TAG: bun_event_loop::TaskTag;
    type Opts: FlagParser + Default + Copy + Send + 'static;

    fn walk_state(&mut self) -> &mut Walk;

    /// Pool thread. `spill` is scratch for the whole walk. What is in `stdout` is printed on `Err` too.
    fn run_operand(
        opts: Self::Opts,
        cwd: &[u8],
        operand: &bun_core::ZStr,
        spill: &mut Vec<u8>,
        stdout: &mut Vec<u8>,
    ) -> bun_sys::Result<()>;
}

/// Main-thread state of a walk. Lives in the builtin's `Impl` payload.
#[derive(Default)]
pub(crate) enum Walk {
    #[default]
    Idle,
    /// The pool task has the operands.
    Walking,
    /// `write_output` has the output. `completed` counts the chunks that completed inside `enqueue`.
    Queueing {
        completed: usize,
    },
    /// Chunks of `output` are on an `IOWriter`.
    Writing {
        output: OutputRuns,
        exit_code: ExitCode,
    },
    /// A usage or option error is on an `IOWriter`.
    WaitingWriteErr,
    Done,
}

/// Parses the flags, then hands the operands to one pool task.
pub(crate) fn start<B: OperandBuiltin>(interp: &Interpreter, cmd: NodeId) -> Yield {
    let mut opts = B::Opts::default();
    let args = Builtin::of(interp, cmd).args_slice();
    let error = match parse_flags(&mut opts, args) {
        Ok(Some(operands)) => {
            let args_start = args.len() - operands.len();
            return schedule::<B>(interp, cmd, opts, args_start);
        }
        Ok(None) => ParseError::ShowUsage,
        Err(e) => e,
    };
    Builtin::fail_parse(interp, cmd, B::KIND, &error, || {
        *B::state_mut(interp, cmd).walk_state() = Walk::WaitingWriteErr
    })
}

fn schedule<B: OperandBuiltin>(
    interp: &Interpreter,
    cmd: NodeId,
    opts: B::Opts,
    args_start: usize,
) -> Yield {
    let mut task = Box::new(OperandWalkTask::<B> {
        cmd,
        opts,
        cwd: Builtin::shell(interp, cmd).cwd().to_vec(),
        operands: copy_operands(interp, cmd, args_start),
        output: OutputRuns::default(),
        failed: false,
        task: ShellTask::new(Builtin::event_loop(interp, cmd)),
    });
    task.task.interp = interp.as_ctx_ptr();
    *B::state_mut(interp, cmd).walk_state() = Walk::Walking;
    // SAFETY: a fresh heap allocation, freed by `run_from_main_thread` or `release_unrun`.
    unsafe { ShellTask::schedule(bun_core::heap::into_raw(task)) };
    Yield::suspended()
}

/// `argv[args_start..]` in typed order, each operand followed by its NUL.
fn copy_operands(interp: &Interpreter, cmd: NodeId, args_start: usize) -> Vec<u8> {
    let me = Builtin::of(interp, cmd);
    let mut operands = Vec::new();
    for i in args_start..me.args_slice().len() {
        operands.extend_from_slice(me.arg_zstr(i).as_bytes_with_nul());
    }
    operands
}

/// A chunk this builtin queued is written, or has failed.
pub(crate) fn on_io_writer_chunk<B: OperandBuiltin>(interp: &Interpreter, cmd: NodeId) -> Yield {
    let walk = B::state_mut(interp, cmd).walk_state();
    match core::mem::replace(walk, Walk::Done) {
        Walk::Writing {
            mut output,
            exit_code,
        } => {
            output.chunks_done(1);
            write_output::<B>(interp, cmd, output, exit_code)
        }
        Walk::Queueing { completed } => {
            *walk = Walk::Queueing {
                completed: completed + 1,
            };
            Yield::suspended()
        }
        Walk::WaitingWriteErr => Builtin::done(interp, cmd, 1),
        Walk::Idle | Walk::Walking | Walk::Done => panic!("Invalid state"),
    }
}

/// Writes what is left of `output`, then finishes the builtin.
fn write_output<B: OperandBuiltin>(
    interp: &Interpreter,
    cmd: NodeId,
    mut output: OutputRuns,
    exit_code: ExitCode,
) -> Yield {
    loop {
        *B::state_mut(interp, cmd).walk_state() = Walk::Queueing { completed: 0 };
        let written = Builtin::write_output_runs(interp, cmd, &mut output);
        let walk = B::state_mut(interp, cmd).walk_state();
        match *walk {
            // A Windows pipe that fails at submission completes the chunk inside `enqueue`.
            Walk::Queueing { completed } if completed > 0 => output.chunks_done(completed),
            _ if written => {
                *walk = Walk::Done;
                return Builtin::done(interp, cmd, exit_code);
            }
            _ => {
                *walk = Walk::Writing { output, exit_code };
                return Yield::suspended();
            }
        }
    }
}

/// The walk itself. The pool thread reads nothing that this does not own.
pub(crate) struct OperandWalkTask<B: OperandBuiltin> {
    cmd: NodeId,
    opts: B::Opts,
    cwd: Vec<u8>,
    /// The operands in typed order, each followed by a NUL.
    operands: Vec<u8>,
    output: OutputRuns,
    failed: bool,
    task: ShellTask,
}

impl<B: OperandBuiltin> OperandWalkTask<B> {
    /// A failed operand is reported, and the walk goes on to the next one.
    fn run(&mut self) {
        let mut spill = Vec::new();
        let mut rest = &self.operands[..];
        while let Some(len) = bun_core::strings::index_of_char_usize(rest, 0) {
            let operand = bun_core::ZStr::from_buf(rest, len);
            rest = &rest[len + 1..];
            let result = self.output.push_with(IoKind::Stdout, |stdout| {
                B::run_operand(self.opts, &self.cwd, operand, &mut spill, stdout)
            });
            if let Err(e) = result {
                self.failed = true;
                self.output.push_with(IoKind::Stderr, |stderr| {
                    Builtin::write_task_error(stderr, B::KIND, &e)
                });
            }
        }
    }
}

impl<B: OperandBuiltin> bun_event_loop::Taskable for OperandWalkTask<B> {
    const TAG: bun_event_loop::TaskTag = B::TASK_TAG;
    /// A pool completion that will not run. Nothing else frees the box.
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract — the box `schedule` made.
        unsafe {
            (*this).task.unref_unrun();
            drop(bun_core::heap::take(this));
        }
    }
    /// See [`ShellTaskCtx`]: a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl<B: OperandBuiltin> ShellTaskCtx for OperandWalkTask<B> {
    const TASK_OFFSET: usize = core::mem::offset_of!(Self, task);
    fn run_from_thread_pool(this: &mut Self) {
        this.run()
    }
    fn run_from_main_thread(this: *mut Self, interp: &Interpreter) {
        // SAFETY: `ShellTaskCtx` callers pass the box `schedule` made, once.
        let OperandWalkTask {
            cmd,
            output,
            failed,
            ..
        } = *unsafe { bun_core::heap::take(this) };
        write_output::<B>(interp, cmd, output, ExitCode::from(failed)).run(interp);
    }
}
