use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind, Kind};
use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId, OutputNeedsIOSafeGuard};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

use bun_event_loop::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_event_loop::{task_tag, EventLoopTask, TaskTag, Taskable};

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
    pub fn start(interp: &mut Interpreter, cmd: NodeId) -> Yield {
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
                let p = Builtin::of(interp, cmd).args_slice()[i];
                // SAFETY: argv entries are NUL-terminated.
                one.extend_from_slice(unsafe { CStr::from_ptr(p) }.to_bytes());
            }
            one.push(b'\n');
        }

        // Tile to at least BUFSIZ for throughput.
        const BUFSIZ: usize = 8192;
        let bufalloc = if one.len() <= BUFSIZ / 2 { BUFSIZ } else { one.len() };
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
        let interp_ptr: *mut Interpreter = interp;
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
    fn write_no_io_loop(interp: &mut Interpreter, cmd: NodeId) -> Yield {
        for _ in 0..4 {
            // PORT NOTE: reshaped for borrowck — clone the slice each
            // iteration so write_no_io can take &mut Interpreter.
            let chunk = {
                let me = Self::state_mut(interp, cmd);
                me.buffer[..me.buffer_used].to_vec()
            };
            // Spec: yes.zig `writeOnceNoIO` — `.err` arm formats via
            // `fmtErrorArena(.yes, "{s}\n", .{e.name()})` and routes through
            // `writeFailingError`.
            if let Err(e) = Builtin::write_no_io(interp, cmd, IoKind::Stdout, &chunk) {
                let buf = Builtin::fmt_error_arena(
                    interp,
                    cmd,
                    Some(Kind::Yes),
                    format_args!("{}\n", bstr::BStr::new(e.name())),
                )
                .to_vec();
                return Self::write_failing_error(interp, cmd, &buf, 1);
            }
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
        interp: &mut Interpreter,
        cmd: NodeId,
        safeguard: OutputNeedsIOSafeGuard,
    ) -> Yield {
        let chunk = {
            let me = Self::state_mut(interp, cmd);
            me.buffer[..me.buffer_used].to_vec()
        };
        let child = ChildPtr::new(cmd, WriterTag::Builtin);
        Builtin::of_mut(interp, cmd)
            .stdout
            .enqueue(child, &chunk, safeguard)
    }

    pub fn write_failing_error(
        interp: &mut Interpreter,
        cmd: NodeId,
        buf: &[u8],
        exit_code: ExitCode,
    ) -> Yield {
        Self::state_mut(interp, cmd).state = State::WaitingWriteErr;
        Builtin::write_failing_error(interp, cmd, buf, exit_code)
    }

    pub fn on_io_writer_chunk(
        interp: &mut Interpreter,
        cmd: NodeId,
        _: usize,
        e: Option<bun_sys::SystemError>,
    ) -> Yield {
        if e.is_some() {
            Self::state_mut(interp, cmd).state = State::Err;
            return Builtin::done(interp, cmd, 1);
        }
        if Self::state_mut(interp, cmd).state == State::WaitingWriteErr {
            return Builtin::done(interp, cmd, 1);
        }
        debug_assert!(Builtin::of(interp, cmd).stdout.needs_io().is_some());
        Self::enqueue_chunk(interp, cmd, OutputNeedsIOSafeGuard::OutputNeedsIo)
    }

    #[inline]
    fn state_mut(interp: &mut Interpreter, cmd: NodeId) -> &mut Yes {
        match &mut Builtin::of_mut(interp, cmd).impl_ {
            crate::shell::builtin::Impl::Yes(y) => &mut **y,
            _ => unreachable!(),
        }
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
    /// Zig's `@fieldParentPtr` chain).
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
        // SAFETY: caller contract.
        let evtloop = unsafe { (*this).evtloop };
        match evtloop {
            EventLoopHandle::Js { owner, vtable } => {
                // SAFETY: vtable contract — `owner` is the live `*mut jsc::EventLoop`.
                unsafe { (vtable.tick)(owner) };
                // SAFETY: caller contract; `concurrent_task` was initialised
                // as `Js` via `EventLoopTask::from_event_loop`.
                let ct: *mut ConcurrentTask = match unsafe { &mut (*this).concurrent_task } {
                    EventLoopTask::Js(ct) => ct.from(this, AutoDeinit::ManualDeinit),
                    EventLoopTask::Mini(_) => unreachable!(),
                };
                // SAFETY: vtable contract.
                unsafe { (vtable.enqueue_task_concurrent)(owner, ct) };
            }
            EventLoopHandle::Mini(mini) => {
                // SAFETY: `mini` is a live backref; `loop_` is the live uws loop.
                unsafe { (*(*mini).loop_).tick() };
                // SAFETY: caller contract; `concurrent_task` was initialised
                // as `Mini` via `EventLoopTask::from_event_loop`.
                let at = match unsafe { &mut (*this).concurrent_task } {
                    EventLoopTask::Mini(at) => at.from(this, Self::run_from_main_thread_mini),
                    EventLoopTask::Js(_) => unreachable!(),
                };
                // SAFETY: `mini` is a live backref.
                unsafe { (*mini).enqueue_task_concurrent(at) };
            }
        }
    }

    /// Spec: yes.zig `YesTask.runFromMainThread`.
    ///
    /// # Safety
    /// `this` is the live task previously passed to [`enqueue`](Self::enqueue);
    /// `interp` outlives the builtin.
    pub unsafe fn run_from_main_thread(this: *mut Self) {
        // SAFETY: caller contract — `interp` set in `Yes::start`, outlives the builtin.
        let interp = unsafe { &mut *(*this).interp };
        let cmd = unsafe { (*this).cmd };
        Yes::write_no_io_loop(interp, cmd).run(interp);
    }

    /// Spec: yes.zig `YesTask.runFromMainThreadMini`. Signature matches
    /// [`AnyTaskWithExtraContext::from`](bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext::from)'s
    /// callback shape (`fn(*mut T, *mut ())`).
    fn run_from_main_thread_mini(this: *mut Self, _: *mut ()) {
        // SAFETY: `this` is the live task passed to `enqueue`.
        unsafe { Self::run_from_main_thread(this) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/yes.zig (181 lines)
//   confidence: medium — NodeId-arena style; JS-loop dispatch arm for
//               `ShellYesTask` panics in Zig (Task.zig else-arm), preserved.
// ──────────────────────────────────────────────────────────────────────────
