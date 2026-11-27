use crate::shell::builtin::{Builtin, IoKind, Sink, State};
use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId};
use crate::shell::yield_::Yield;

use bun_event_loop::AnyTaskWithExtraContext::{AnyTaskWithExtraContext, MiniTask};
use bun_event_loop::{BoxedTask, TaskTag, task_tag};

pub(crate) fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
    let mut line = Vec::new();
    for arg in Builtin::of(interp, cmd).args() {
        line.extend_from_slice(arg);
        line.push(b' ');
    }
    match line.last_mut() {
        Some(last) => *last = b'\n',
        None => line.extend_from_slice(b"y\n"),
    }

    const BUFSIZ: usize = 8192;
    let chunk = line.repeat((BUFSIZ / line.len()).max(1));
    if let Sink::Fd(_) = Builtin::sink(interp, cmd, IoKind::Stdout) {
        Builtin::of_mut(interp, cmd).state = State::Yes(chunk);
        return write(interp, cmd);
    }
    let task = YesTask {
        chunk,
        interp: interp.as_ctx_ptr(),
        cmd,
        mini_task: AnyTaskWithExtraContext::default(),
    };
    Box::new(task).write(interp)
}

pub(crate) fn write(interp: &Interpreter, cmd: NodeId) -> Yield {
    let sink = Builtin::sink(interp, cmd, IoKind::Stdout);
    match (sink, &Builtin::of(interp, cmd).state) {
        (Sink::Fd(fd), State::Yes(chunk)) => fd.enqueue(chunk),
        _ => Yield::suspended(),
    }
}

/// `yes` to memory, where no write completes later.
pub(crate) struct YesTask {
    chunk: Vec<u8>,
    /// Only this task can finish `cmd`, which the interpreter waits for.
    interp: *mut Interpreter,
    cmd: NodeId,
    mini_task: AnyTaskWithExtraContext,
}

impl YesTask {
    /// Four chunks, then the event loop gets a turn.
    fn write(self: Box<Self>, interp: &Interpreter) -> Yield {
        let cmd = self.cmd;
        for _ in 0..4 {
            if let Sink::Memory(memory) = Builtin::sink(interp, cmd, IoKind::Stdout)
                && let Err(e) = memory.write(&self.chunk)
            {
                drop(self);
                let name = bstr::BStr::new(e.name());
                return Builtin::fail(interp, cmd, format_args!("{name}\n"));
            }
        }
        match interp.event_loop {
            // Next loop iteration, after I/O has had a turn.
            EventLoopHandle::Js { owner } => {
                owner.enqueue_task_after_yield(bun_jsc::Task::from_boxed(self));
            }
            EventLoopHandle::Mini(mini) => {
                mini.loop_.tick();
                mini.post(self, |this| &mut this.mini_task);
            }
        }
        Yield::suspended()
    }
}

impl BoxedTask for YesTask {
    const TAG: TaskTag = task_tag::ShellYesTask;
    fn release_unrun(self: Box<Self>) {}
    /// See [`ShellTask`](crate::shell::interpreter::ShellTask): a step of a shell script always runs.
    fn context(&self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl MiniTask for YesTask {
    fn run_from_main_thread(self: Box<Self>) {
        // SAFETY: see the field; this is its thread.
        let interp = unsafe { &*self.interp };
        self.write(interp).run(interp);
    }
}
