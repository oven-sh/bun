use core::ffi::CStr;

use crate::shell::builtin::{Builtin, IoKind};
use crate::shell::interpreter::{EventLoopHandle, Interpreter, NodeId, OutputNeedsIOSafeGuard};
use crate::shell::io_writer::{ChildPtr, WriterTag};
use crate::shell::yield_::Yield;
use crate::shell::ExitCode;

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
    pub task: YesTask,
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
        {
            let me = Self::state_mut(interp, cmd);
            me.buffer = buf;
            me.buffer_used = filled;
            me.task = YesTask { cmd, evtloop };
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
            // Builtin::write_no_io is infallible in the current port (Zig
            // returned Maybe(usize); the error arm is TODO once arraybuf
            // outputs are wired).
            Builtin::write_no_io(interp, cmd, IoKind::Stdout, &chunk);
        }
        // TODO(b2-blocked): YesTask::enqueue — bounce back via the event loop.
        // Until EventLoopTask is real, suspend (the JS side never observes
        // `yes` without IO anyway — captured/ignored stdout has no consumer).
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

/// Re-queues `yes` onto the event loop after a burst of no-IO writes so we
/// don't block the main thread forever. Spec: yes.zig `YesTask`.
pub struct YesTask {
    pub cmd: NodeId,
    pub evtloop: EventLoopHandle,
    // TODO(b2-blocked): bun_jsc::EventLoopTask — concurrent_task field.
}

impl Default for YesTask {
    fn default() -> Self {
        YesTask { cmd: NodeId::NONE, evtloop: EventLoopHandle::default() }
    }
}

impl YesTask {
    pub fn enqueue(&mut self) {
        // TODO(b2-blocked): EventLoopHandle is opaque until bun_jsc compiles.
        // Zig: tick the loop, then enqueueTaskConcurrent(self).
    }

    pub fn run_from_main_thread(&mut self, interp: &mut Interpreter) {
        Yes::write_no_io_loop(interp, self.cmd).run(interp);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/builtin/yes.zig (181 lines)
//   confidence: medium (NodeId style; YesTask enqueue stubbed)
//   blocked_on: bun_jsc::EventLoopTask, IOWriter::enqueue body
// ──────────────────────────────────────────────────────────────────────────
