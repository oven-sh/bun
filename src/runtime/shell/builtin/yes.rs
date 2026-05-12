use core::ffi::CStr;

use crate::shell::ExitCode;
use crate::shell::builtin::{Builtin, BuiltinIO, BuiltinState, Impl, Kind};
use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId, OutputNeedsIOSafeGuard};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::states::cmd::Exec;
use crate::shell::yield_::Yield;

use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_event_loop::{EventLoopTask, TaskTag, Taskable, task_tag};

#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum State {
    #[default]
    Idle,
    WaitingWriteErr,
    WaitingIo,
    Err,
    Done,
}

#[derive(Default)]
pub struct Yes {
    pub state: State,
    /// One repetition of the output (`"y\n"` or joined argv + `'\n'`), tiled
    /// out to ~BUFSIZ.
    pub buffer: Vec<u8>,
    pub buffer_used: usize,
    /// Zig: `task: YesTask = undefined` — populated in `start()`.
    pub task: Option<YesTask>,
}

impl Yes {
    pub fn start(interp: &Interpreter, cmd: NodeId) -> Yield {
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
            // PORT NOTE: Zig @memcpy on disjoint subslices → copy_within.
            buf.copy_within(0..to_copy, filled);
            filled += to_copy;
            copies -= 1;
        }

        let evtloop = Builtin::event_loop(interp, cmd);
        let interp_ptr: *mut Interpreter = interp.as_ctx_ptr();
        {
            let me = Self::state_mut(interp, cmd);
            me.buffer = buf;
            me.buffer_used = filled;
            me.task = Some(YesTask {
                interp: interp_ptr,
                cmd,
                evtloop,
                concurrent_task: EventLoopTask::from_event_loop(evtloop),
            });
        }

        if let Some(safeguard) = Builtin::of(interp, cmd).stdout.needs_io() {
            Self::state_mut(interp, cmd).state = State::WaitingIo;
            return Self::enqueue_chunk(interp, cmd, safeguard);
        }

        Self::write_no_io_loop(interp, cmd)
    }

    /// Write 4 chunks then bounce to the event loop so we don't hog the main
    /// thread. Spec: yes.zig `writeNoIO`.
    fn write_no_io_loop(interp: &Interpreter, cmd: NodeId) -> Yield {
        // Spec: yes.zig `writeOnceNoIO` — `.err` arm formats via
        // `fmtErrorArena(.yes, "{s}\n", .{e.name()})` and routes through
        // `writeFailingError`.
        //
        // Split-borrow the Cmd so the tiled buffer (in `impl_`) and `stdout`
        // are accessible simultaneously — Zig passes `this.buffer[0..]`
        // zero-copy, and matching that matters for `yes` throughput.
        let err = {
            let cmd_node = interp.as_cmd_mut(cmd);
            let shell = cmd_node.base.shell;
            let Exec::Builtin(me) = &mut cmd_node.exec else {
                unreachable!()
            };
            let (stdout, yes) = Self::split_stdout_state(me);
            let chunk = &yes.buffer[..yes.buffer_used];
            let mut err = None;
            for _ in 0..4 {
                // SAFETY: `shell` is `cmd_node.base.shell`, live for the Cmd.
                if let Err(e) = unsafe { stdout.write_no_io_to(shell, chunk) } {
                    err = Some(e);
                    break;
                }
            }
            err
        };
        if let Some(e) = err {
            let buf = Builtin::fmt_error_arena(
                interp,
                cmd,
                Some(Kind::Yes),
                format_args!("{}\n", bstr::BStr::new(e.name())),
            )
            .to_vec();
            return Self::write_failing_error(interp, cmd, &buf, 1);
        }
        // Bounce back via the event loop so we don't block the main thread.
        // SAFETY: `task` was set in `start()`; `Yes` lives in a `Box` inside
        // the interpreter arena, so the address is stable across the enqueue
        // and the later main-thread callback.
        let task: *mut YesTask = Self::state_mut(interp, cmd)
            .task
            .as_mut()
            .expect("YesTask set in start()");
        // PORT NOTE: `enqueue` ticks the event loop (Zig spec), which may
        // re-enter shell dispatch. We hold no `&mut` derived from `interp`
        // across the call; the parameter borrow itself is not re-used after.
        unsafe { YesTask::enqueue(task) };
        Yield::suspended()
    }

    fn enqueue_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        let child = ChildPtr::new(cmd, WriterTag::Builtin);
        // `stdout` and `impl_` are disjoint fields of `Builtin` — split-borrow
        // so the tiled buffer is enqueued zero-copy (Zig passes a slice).
        let (stdout, yes) = Self::split_stdout_state(Builtin::of_mut(interp, cmd));
        stdout.enqueue(child, &yes.buffer[..yes.buffer_used], safeguard)
    }

    pub fn write_failing_error(
        interp: &Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
        Builtin::write_failing_error(interp, cmd, buf, exit_code)
    }

    pub fn on_io_writer_chunk(
        interp: &Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if let Some(e) = e {
            // Spec: yes.zig `defer e.deref()` — release the SystemError's
            // owned BunString fields (no `Drop` impl on `bun_sys::SystemError`).
            e.deref();
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        if Self::state_mut(interp, cmd).state == State::WaitingWriteErr {
            return Builtin::done(interp, cmd, 1);
        }
        debug_assert!(Builtin::of(interp, cmd).stdout.needs_io().is_some());
        Self::enqueue_chunk(interp, cmd, OutputNeedsIOSafeGuard::OutputNeedsIo)
    }

    /// Split-borrow `&mut Builtin` into `(&mut stdout, &mut Yes)`; the fields
    /// are disjoint so this is a sound reborrow without `unsafe`.
    #[inline]
    fn split_stdout_state(me: &mut Builtin) -> (&mut BuiltinIO, &mut Yes) {
        let Impl::Yes(yes) = &mut me.impl_ else {
            unreachable!()
        };
        (&mut me.stdout, &mut **yes)
    }
}

// PORT NOTE: Zig `deinit` freed `buffer` and ended the alloc scope. In the
// Rust port `buffer: Vec<u8>` drops with the owning `Box<Yes>`; no explicit
// `Drop` impl needed (PORTING.md §Allocators).

/// Re-queues `yes` onto the event loop after a burst of no-IO writes so we
/// don't block the main thread forever. Spec: yes.zig `YesTask`.
#[repr(C)]
pub struct YesTask {
    /// Back-ref to the owning [`Interpreter`] (NodeId-arena port replaces
    /// Zig's `container_of` chain).
    pub interp: *mut Interpreter,
    pub cmd: NodeId,
    pub evtloop: EventLoopHandle,
    pub concurrent_task: EventLoopTask,
}

impl Taskable for YesTask {
    const TAG: TaskTag = task_tag::ShellYesTask;
}

impl YesTask {
    /// Spec: yes.zig `YesTask.enqueue`.
    ///
    /// # Safety
    /// `this` must point to a live `YesTask` whose storage is stable until the
    /// enqueued task fires (it lives inside `Box<Yes>` in the interpreter
    /// arena).
    pub unsafe fn enqueue(this: *mut Self) {
        // SAFETY: caller contract — `this` is live and stable; `evtloop` /
        // `concurrent_task` were initialised together by `Yes::start` so the
        // Js/Mini discriminants agree. `owner`/`mini` are live event-loop
        // backrefs (single-threaded shell).
        unsafe {
            match (*this).evtloop {
                EventLoopHandle::Js { owner } => {
                    owner.tick();
                    let ct: *mut ConcurrentTask = match &mut (*this).concurrent_task {
                        EventLoopTask::Js(ct) => ct.from(this, AutoDeinit::ManualDeinit),
                        EventLoopTask::Mini(_) => unreachable!(),
                    };
                    owner.enqueue_task_concurrent(ct);
                }
                EventLoopHandle::Mini(mut mini) => {
                    (*mini.loop_).tick();
                    let at = match &mut (*this).concurrent_task {
                        EventLoopTask::Mini(at) => at.from(this, Self::run_from_main_thread_mini),
                        EventLoopTask::Js(_) => unreachable!(),
                    };
                    mini.get_mut().enqueue_task_concurrent(at);
                }
            }
        }
    }

    /// Spec: yes.zig `YesTask.runFromMainThread`.
    ///
    /// Reached only via the concurrent-task dispatch installed in
    /// [`enqueue`](Self::enqueue), which always passes the live task whose
    /// storage is stable inside `Box<Yes>` in the interpreter arena.
    pub fn run_from_main_thread(this: *mut Self) {
        // SAFETY: dispatch contract — `this` is the live task previously passed
        // to `enqueue`; `interp` set in `Yes::start`, outlives the builtin.
        let (interp, cmd) = unsafe { (&*(*this).interp, (*this).cmd) };
        Yes::write_no_io_loop(interp, cmd).run(interp);
    }

    /// Spec: yes.zig `YesTask.runFromMainThreadMini`. Signature matches
    /// [`AnyTaskWithExtraContext::from`](bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext::from)'s
    /// callback shape (`fn(*mut T, *mut ())`).
    fn run_from_main_thread_mini(this: *mut Self, _: *mut ()) {
        Self::run_from_main_thread(this)
    }
}

// ported from: src/shell/builtin/yes.zig
