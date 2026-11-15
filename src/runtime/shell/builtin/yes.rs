use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinState, Kind};
use crate::shell::interpreter::{
    EventLoopHandle, Interpreter, NodeId, ShellInterpreter, ShellInterpreterRef,
};
use crate::shell::io::OutFd;
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::states::cmd::Exec;
use crate::shell::yield_::{ReentrantAction, Yield};

use bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use bun_event_loop::{BoxedTask, TaskTag, task_tag};
use core::ptr::NonNull;

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum State {
    #[default]
    Idle,
    WaitingWriteErr,
    WaitingIo,
    Err,
}

#[derive(Default)]
pub(crate) struct Yes {
    pub(crate) state: State,
    /// Populated in `start()`. `None` while it is queued.
    task: Option<Box<YesTask>>,
}

impl Yes {
    pub(crate) fn start(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
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
        buf.truncate(filled);

        Self::state_mut(interp, cmd).task = Some(Box::new(YesTask {
            interp: None,
            cmd,
            buffer: buf,
            concurrent_task: AnyTaskWithExtraContext::default(),
        }));

        if let Some(fd) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            return Self::enqueue_chunk(interp, cmd, fd);
        }

        Self::write_no_io_loop(interp, cmd)
    }

    /// Write 4 chunks then bounce to the event loop so we don't hog the main
    /// thread.
    fn write_no_io_loop(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
        // Split-borrow the Cmd so the tiled buffer (in `impl_`) and `stdout`
        // are accessible simultaneously — the buffer is written zero-copy,
        // which matters for `yes` throughput.
        let err = {
            let cmd_node = interp.nodes[cmd.idx()].as_cmd_mut();
            let shell = cmd_node.shell.id();
            let Exec::Builtin(me) = &mut cmd_node.exec else {
                unreachable!()
            };
            let chunk = Self::extract(&mut me.impl_).chunk();
            let mut err = None;
            for _ in 0..4 {
                if let Err(e) = me.stdout.write_no_io_to(&mut interp.shells, shell, chunk) {
                    err = Some(e);
                    break;
                }
            }
            err
        };
        if let Some(e) = err {
            let buf = Builtin::fmt_error(
                Some(Kind::Yes),
                format_args!("{}\n", bstr::BStr::new(e.name())),
            );
            return Self::write_failing_error(interp, cmd, &buf, 1);
        }
        // Bounce back via the event loop so we don't block the main thread.
        if let EventLoopHandle::Mini(_) = interp.event_loop {
            return Yield::Action(ReentrantAction::TickMiniLoop(cmd));
        }
        Self::enqueue_task(interp, cmd)
    }

    pub(crate) fn tick_mini_loop(shell_interp: &ShellInterpreter, cmd: NodeId) -> Yield {
        if let EventLoopHandle::Mini(mini) = shell_interp.event_loop {
            mini.loop_.tick();
        }
        shell_interp
            .with_interp(|interp| Self::enqueue_task(interp, cmd))
            .expect("the script waits for this Cmd")
    }

    fn enqueue_task(interp: &mut Interpreter<'_>, cmd: NodeId) -> Yield {
        let task = Self::state_mut(interp, cmd).task.take();
        task.expect("YesTask is not queued").enqueue(interp);
        Yield::suspended()
    }

    fn enqueue_chunk(interp: &mut Interpreter<'_>, cmd: NodeId, fd: OutFd) -> Yield {
        let child = ChildPtr::new(cmd, WriterTag::Builtin);
        // Split-borrow so the tiled buffer is enqueued zero-copy.
        let Exec::Builtin(me) = &mut interp.nodes[cmd.idx()].as_cmd_mut().exec else {
            unreachable!()
        };
        let chunk = Self::extract(&mut me.impl_).chunk();
        interp.io_writers[fd.writer].enqueue(&mut interp.shells, child, fd.captured, chunk)
    }

    fn write_failing_error(
        interp: &mut Interpreter<'_>,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
        Builtin::write_failing_error(interp, cmd, buf, exit_code)
    }

    pub(crate) fn on_io_writer_chunk(
        interp: &mut Interpreter<'_>,
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
        let fd = Builtin::of(interp, cmd).stdout.needs_io();
        Self::enqueue_chunk(interp, cmd, fd.expect("wrote the last chunk"))
    }

    fn chunk(&self) -> &[u8] {
        &self.task.as_deref().expect("YesTask is not queued").buffer
    }
}

/// Re-queues `yes` onto the event loop after a burst of no-IO writes so we
/// don't block the main thread forever.
pub(crate) struct YesTask {
    /// `Some` while it is queued.
    interp: Option<ShellInterpreterRef>,
    cmd: NodeId,
    /// The output line (`"y\n"` or joined argv + `'\n'`), tiled out to ~BUFSIZ.
    buffer: Vec<u8>,
    /// For the mini loop.
    concurrent_task: AnyTaskWithExtraContext,
}

impl BoxedTask for YesTask {
    const TAG: TaskTag = task_tag::ShellYesTask;
    fn release_unrun(self: Box<Self>) {}
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl YesTask {
    fn enqueue(mut self: Box<Self>, interp: &mut Interpreter<'_>) {
        self.interp = Some(ShellInterpreterRef::new(interp));
        match interp.event_loop {
            // Next loop iteration, after I/O has had a turn.
            EventLoopHandle::Js { owner } => {
                owner.enqueue_task_after_yield(bun_jsc::Task::from_boxed(self));
            }
            EventLoopHandle::Mini(mini) => {
                let this = bun_core::heap::into_raw(self);
                // SAFETY: the box that was just leaked.
                let at = unsafe { &mut (*this).concurrent_task }.from(this, |this, _| {
                    // SAFETY: the loop of the script calls this once.
                    unsafe { bun_core::heap::take(this).run_from_main_thread() }
                });
                // SAFETY: a field of the leaked box, which the callback takes back on this thread.
                unsafe { mini.enqueue_task_concurrent(NonNull::new(at).expect("intrusive task")) };
            }
        }
    }

    /// # Safety
    /// Called by the event loop that `enqueue` gave `self` to.
    pub(crate) unsafe fn run_from_main_thread(mut self: Box<Self>) {
        let interp_ref = self.interp.take().expect("set by enqueue");
        let resume = |interp: &mut Interpreter<'_>| {
            let cmd = self.cmd;
            Yes::state_mut(interp, cmd).task = Some(self);
            Yes::write_no_io_loop(interp, cmd)
        };
        // SAFETY: caller contract.
        unsafe { interp_ref.run_yield_with(resume) };
    }
}
