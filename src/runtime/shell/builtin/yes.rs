use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinIO, BuiltinState, Impl, IoKind, Kind};
use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId, OutputNeedsIOSafeGuard};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::states::cmd::Exec;
use crate::shell::yield_::Yield;

use bun_event_loop::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, BoxedMiniTaskRunner};

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum State {
    #[default]
    Idle,
    WaitingWriteErr,
    WaitingIo,
    Err,
}

#[derive(Default)]
pub struct Yes {
    pub(crate) state: State,
    /// One repetition of the output (`"y\n"` or joined argv + `'\n'`), tiled
    /// out to ~BUFSIZ.
    pub(crate) buffer: Vec<u8>,
    pub(crate) buffer_used: usize,
    /// The bounce payload: created in `start()`, out on the event loop between
    /// `write_no_io_loop` and `YesTask::run`.
    pub task: Option<Box<YesTask>>,
}

impl Yes {
    pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
        // Build one copy of the output line.
        let argc = Builtin::of(interp, cmd).args_slice().len();
        let mut one = Vec::new();
        if argc == 0 {
            one.extend_from_slice(b"y\n");
        } else {
            for i in 0..argc {
                if i > 0 {
                    one.push(b' ');
                }
                one.extend_from_slice(Builtin::of(interp, cmd).arg_bytes(i));
            }
            one.push(b'\n');
        }

        // Tile to at least BUFSIZ for throughput.
        const BUFSIZ: usize = 8192;
        let bufalloc = if one.len() <= BUFSIZ / 2 {
            BUFSIZ
        } else {
            one.len()
        };
        let mut buf = vec![0u8; bufalloc];
        buf[..one.len()].copy_from_slice(&one);
        let mut filled = one.len();
        let copysize = one.len();
        let mut copies = bufalloc / copysize;
        while copies > 1 {
            let to_copy = copysize.min(bufalloc - filled);
            buf.copy_within(0..to_copy, filled);
            filled += to_copy;
            copies -= 1;
        }

        let evtloop = Builtin::event_loop(interp, cmd);
        {
            let mut me = Self::state_mut(interp, cmd);
            me.buffer = buf;
            me.buffer_used = filled;
            me.task = Some(Box::new(YesTask {
                interp: bun_ptr::ParentRef::new(interp),
                cmd,
                evtloop,
                concurrent_task: AnyTaskWithExtraContext::default(),
            }));
        }

        let stdout_needs_io = Builtin::of(interp, cmd).stdout.needs_io();

        if let Some(safeguard) = stdout_needs_io {
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            return Self::enqueue_chunk(interp, cmd, safeguard);
        }

        Self::write_no_io_loop(interp, cmd)
    }

    /// Write 4 chunks then bounce to the event loop so we don't hog the main
    /// thread.
    fn write_no_io_loop(interp: &Interpreter, cmd: NodeId) -> Yield {
        // Split-borrow the Cmd so the tiled buffer (in `impl_`) and `stdout`
        // are accessible simultaneously — the buffer is written zero-copy,
        // which matters for `yes` throughput.
        let err = {
            let mut cmd_node = interp.as_cmd_mut(cmd);
            let cmd_node = &mut *cmd_node;
            let shell = cmd_node.base.shell.borrow();
            let Exec::Builtin(me) = &mut cmd_node.exec else {
                unreachable!()
            };
            let (stdout, yes) = Self::split_stdout_state(me);
            let chunk = &yes.buffer[..yes.buffer_used];
            let mut err = None;
            for _ in 0..4 {
                if let Err(e) = stdout.write_no_io_to(&shell, chunk) {
                    err = Some(e);
                    break;
                }
            }
            err
        };
        if let Some(e) = err {
            let buf = Builtin::fmt_error_arena(
                Some(Kind::Yes),
                format_args!("{}\n", bstr::BStr::new(e.name())),
            );
            return Self::write_failing_error(interp, cmd, &buf, 1);
        }
        // Bounce back via the event loop so we don't block the main thread.
        // `enqueue` ticks the event loop and may re-enter shell dispatch — no
        // borrow of `interp` state is held across it.
        let task = Self::state_mut(interp, cmd)
            .task
            .take()
            .expect("YesTask set in start()");
        YesTask::enqueue(task);
        Yield::suspended()
    }

    fn enqueue_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        let child = ChildPtr::new(cmd, WriterTag::Builtin);
        Builtin::write_out_with(interp, cmd, IoKind::Stdout, child, safeguard, |buf| {
            let yes = Self::state_mut(interp, cmd);
            buf.extend_from_slice(&yes.buffer[..yes.buffer_used]);
        })
    }

    fn write_failing_error(
        interp: &Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
        Builtin::write_failing_error(interp, cmd, buf, exit_code)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(_err) = e {
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        if Self::state_mut(interp, cmd).state == State::WaitingWriteErr {
            return Builtin::done(interp, cmd, 1);
        }
        debug_assert!(Builtin::of(interp, cmd).stdout.needs_io().is_some());
        Self::enqueue_chunk(interp, cmd, OutputNeedsIOSafeGuard::OutputNeedsIo)
    }

    /// Split-borrow `&mut Builtin` into `(&mut stdout, &mut Yes)` (disjoint
    /// fields).
    #[inline]
    fn split_stdout_state(me: &mut Builtin) -> (&mut BuiltinIO, &mut Yes) {
        let Impl::Yes(yes) = &mut me.impl_ else {
            unreachable!()
        };
        (&mut me.stdout, &mut **yes)
    }
}

// `buffer: Vec<u8>` drops with the owning `Box<Yes>`; no explicit `Drop` impl
// needed (PORTING.md §Allocators).

/// Re-queues `yes` onto the event loop after a burst of no-IO writes so we
/// don't block the main thread forever.
pub struct YesTask {
    /// Back-ref to the owning [`Interpreter`].
    pub(crate) interp: bun_ptr::ParentRef<Interpreter>,
    pub(crate) cmd: NodeId,
    pub(crate) evtloop: EventLoopHandle,
    /// Intrusive node for the mini-loop post (the JS loop queues a `Task`).
    pub(crate) concurrent_task: AnyTaskWithExtraContext,
}

// `runtime::dispatch::run_task`'s `task_tag::ShellYesTask` arm reboxes the
// enqueued pointer as `YesTask`; both sides MUST agree.
bun_event_loop::boxed_taskable!(YesTask, ShellYesTask);

impl BoxedMiniTaskRunner<YesTask> for YesTask {
    fn run_from_loop_thread(owner: Box<YesTask>) {
        owner.run();
    }
}

impl YesTask {
    /// Next loop iteration, after I/O has had a turn.
    fn enqueue(self: Box<Self>) {
        let evtloop = self.evtloop;
        evtloop.enqueue_boxed_after_yield::<YesTask, YesTask>(self, |t| &mut t.concurrent_task);
    }

    /// Main thread: park the payload back on its `Yes` and write the next burst.
    pub(crate) fn run(self: Box<Self>) {
        let (interp, cmd) = (self.interp, self.cmd);
        Yes::state_mut(&interp, cmd).task = Some(self);
        Yes::write_no_io_loop(&interp, cmd).run(&interp);
    }
}
