use crate::shell::builtin::{Builtin, IoKind, Sink, State};
use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId};
use crate::shell::yield_::Yield;

use bun_event_loop::{EventLoopTask, TaskTag, Taskable, task_tag};

pub(crate) struct Yes {
    /// The line, tiled out to ~BUFSIZ.
    chunk: Vec<u8>,
    task: YesTask,
}

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
    let evtloop = interp.event_loop;
    Builtin::of_mut(interp, cmd).state = State::Yes(Box::new(Yes {
        chunk: line.repeat((BUFSIZ / line.len()).max(1)),
        task: YesTask {
            interp: interp.as_ctx_ptr(),
            cmd,
            evtloop,
            concurrent_task: EventLoopTask::from_event_loop(evtloop),
        },
    }));
    Yes::write(interp, cmd)
}

impl Yes {
    /// Four chunks to memory, then the event loop gets a turn.
    pub(crate) fn write(interp: &Interpreter, cmd: NodeId) -> Yield {
        let State::Yes(yes) = &mut Builtin::of_mut(interp, cmd).state else {
            return Yield::suspended();
        };
        let (chunk, task) = (yes.chunk.as_slice(), &raw mut yes.task);
        for _ in 0..4 {
            match Builtin::sink(interp, cmd, IoKind::Stdout) {
                Sink::Fd(fd) => return fd.enqueue(chunk),
                Sink::Memory(memory) => {
                    if let Err(e) = memory.write(chunk) {
                        let name = bstr::BStr::new(e.name());
                        return Builtin::fail(interp, cmd, format_args!("{name}\n"));
                    }
                }
            }
        }
        // SAFETY: boxed, and only the callback can finish the command. No `&mut` spans the call, which can re-enter.
        unsafe { YesTask::enqueue(task) };
        Yield::suspended()
    }
}

/// Re-queues `yes` onto the event loop after a burst of writes to memory.
#[repr(C)]
pub(crate) struct YesTask {
    /// Back-ref to the owning [`Interpreter`].
    interp: *mut Interpreter,
    cmd: NodeId,
    evtloop: EventLoopHandle,
    concurrent_task: EventLoopTask,
}

impl Taskable for YesTask {
    const TAG: TaskTag = task_tag::ShellYesTask;
    /// Lives inside the builtin's `Box<Yes>` and took nothing for the bounce.
    unsafe fn release_unrun(_: *mut Self) {}
    /// See [`ShellTaskCtx`](crate::shell::interpreter::ShellTaskCtx): a step of a shell script always runs.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

impl YesTask {
    /// # Safety
    /// `this` must point to a live `YesTask` whose storage is stable until the
    /// enqueued task fires (it lives inside `Box<Yes>` in the interpreter
    /// arena).
    unsafe fn enqueue(this: *mut Self) {
        // SAFETY: caller contract — `this` is live and stable; `evtloop` /
        // `concurrent_task` were initialised together by `start` so the
        // Js/Mini discriminants agree. `owner`/`mini` are live event-loop
        // backrefs (single-threaded shell).
        unsafe {
            match (*this).evtloop {
                // Next loop iteration, after I/O has had a turn.
                EventLoopHandle::Js { owner } => {
                    owner.enqueue_task_after_yield(bun_jsc::Task::init(this));
                }
                EventLoopHandle::Mini(mini) => {
                    mini.loop_.tick();
                    let at =
                        core::ptr::NonNull::new_unchecked(match &mut (*this).concurrent_task {
                            EventLoopTask::Mini(at) => {
                                at.from(this, Self::run_from_main_thread_mini)
                            }
                            EventLoopTask::Js(_) => unreachable!(),
                        });
                    mini.enqueue_task_concurrent(at);
                }
            }
        }
    }

    /// # Safety
    /// `this` was passed to [`enqueue`](Self::enqueue). The call can free it.
    pub(crate) unsafe fn run_from_main_thread(this: *mut Self) {
        // SAFETY: caller contract; `interp` was set in `start` and outlives the task.
        let (interp, cmd) = unsafe { (&*(*this).interp, (*this).cmd) };
        Yes::write(interp, cmd).run(interp);
    }

    fn run_from_main_thread_mini(this: *mut Self, _: *mut ()) {
        // SAFETY: the callback `enqueue` installed.
        unsafe { Self::run_from_main_thread(this) }
    }
}
