//! One spawned `bun test --test-worker --isolate` process plus its three
//! pipes. Tightly coupled with `Coordinator` (which owns the worker slice and
//! routes IPC frames); this file holds only the per-process state and the
//! spawn/dispatch/shutdown mechanics.

use std::sync::Arc;

use bun_core::{self, Output};
use bun_jsc as jsc;
use bun_aio as r#async;
use bun_io;
use bun_sys;
// TODO(port): `bun.spawn` lives under src/runtime/api/bun/process.zig — confirm crate path in Phase B.
use bun_runtime::spawn::{self, Process, Rusage, SpawnOptions, Status, Stdio};

use super::channel::Channel;
use super::coordinator::Coordinator;
use super::file_range::FileRange;
use super::frame::Frame;

pub struct Worker {
    // TODO(port): LIFETIMES.tsv classifies this BACKREF → *const, but the Zig
    // mutates through it (live_workers, onWorkerExit, frame). Phase B: either
    // *mut or interior mutability on Coordinator.
    pub coord: *const Coordinator,
    pub idx: u32,
    pub process: Option<Arc<Process>>,

    /// Bidirectional IPC over fd 3. POSIX: usockets adopted from a socketpair.
    /// Windows: `uv.Pipe` (the parent end of `.buffer` extra-fd, full-duplex).
    /// Commands and results both flow through this channel; backpressure is
    /// handled by the loop, so a busy worker writing thousands of `test_done`
    /// frames never truncates and the coordinator never blocks.
    // TODO(port): Zig `Channel(Worker, "ipc")` — second comptime arg is the
    // field name for `@fieldParentPtr` recovery. Rust side likely uses
    // `offset_of!(Worker, ipc)` or an explicit owner-ptr; revisit in Phase B.
    pub ipc: Channel<Worker>,
    pub out: WorkerPipe,
    pub err: WorkerPipe,

    /// Index into `Coordinator.files` currently running on this worker.
    pub inflight: Option<u32>,
    /// Contiguous slice of `Coordinator.files` owned by this worker. `files`
    /// is sorted lexicographically so adjacent indices share parent dirs (and
    /// likely imports); each worker walks its range front-to-back. When the
    /// range is empty the worker steals one file from the *end* of whichever
    /// range has the most remaining — the end is furthest from that worker's
    /// hot region.
    pub range: FileRange,
    /// `std.time.milliTimestamp()` at the most recent dispatch; drives lazy
    /// scale-up.
    pub dispatched_at: i64,
    /// Worker stdout+stderr since the last `test_done`. Flushed atomically
    /// under the right file header so concurrent files don't interleave.
    pub captured: Vec<u8>,
    pub alive: bool,
    /// Set when the process-exit notification arrives. Reaping waits for both
    /// this and `ipc.done` so trailing IPC frames are decoded first.
    pub exit_status: Option<Status>,
    pub extra_fd_stdio: [Stdio; 1],
}

impl Worker {
    // TODO(port): narrow error set
    pub fn start(&mut self) -> Result<(), bun_core::Error> {
        debug_assert!(!self.alive);
        let coord_ptr = self.coord;
        // SAFETY: coord backref is valid for the worker's lifetime (Coordinator owns workers slice).
        let coord = unsafe { &*coord_ptr };

        // SAFETY: out/err are fields of self; setParent stores the raw parent
        // pointer for later @fieldParentPtr-style callback recovery. The
        // pointers remain valid as long as `self` is not moved (Coordinator
        // holds workers in a stable slice).
        unsafe {
            let out_ptr: *mut WorkerPipe = &mut self.out;
            (*out_ptr).reader.set_parent(out_ptr);
            let err_ptr: *mut WorkerPipe = &mut self.err;
            (*err_ptr).reader.set_parent(err_ptr);
        }

        // All resource cleanup on any error return — including watchOrReap
        // failure below. Each guard checks for null/unstarted so the order in
        // which fields are populated doesn't matter.
        let mut this = scopeguard::guard(self, |this| {
            if let Some(p) = this.process.take() {
                // TODO(port): Arc<Process> gives only &Process; exit_handler
                // reset / kill / close mutate. Process is ThreadSafeRefCount
                // (intrusive) in Zig — Phase B may need IntrusiveArc<Process>
                // or interior mutability on these fields.
                p.exit_handler = Default::default();
                if !p.has_exited() {
                    let _ = p.kill(9);
                }
                p.close();
            }
            // Reset to fresh state after deinit so reapWorker's `!respawned`
            // cleanup (which can't tell whether start() ran) doesn't deinit on
            // undefined ArrayList memory.
            // PORT NOTE: assignment drops the old value (≡ Zig deinit + reinit).
            let self_ptr: *const Worker = this as *const Worker;
            this.ipc = Channel::default();
            this.out = WorkerPipe::new(PipeRole::Stdout, self_ptr);
            this.err = WorkerPipe::new(PipeRole::Stderr, self_ptr);
        });

        #[cfg(unix)]
        {
            // `.buffer` extra_fd creates an AF_UNIX socketpair; the parent end is
            // adopted into a usockets `Channel`.
            this.extra_fd_stdio = [Stdio::Buffer];
            let options = SpawnOptions {
                stdin: Stdio::Ignore,
                stdout: Stdio::Buffer,
                stderr: Stdio::Buffer,
                extra_fds: &mut this.extra_fd_stdio,
                cwd: coord.cwd,
                stream: true,
                // Own pgrp so abortAll can kill(-pid, SIGTERM) the worker and
                // anything it spawned. PDEATHSIG is the SIGKILL safety net on
                // Linux for the worker itself.
                new_process_group: true,
                #[cfg(target_os = "linux")]
                linux_pdeathsig: Some(bun_sys::linux::SIGKILL),
                #[cfg(not(target_os = "linux"))]
                linux_pdeathsig: None,
                ..Default::default()
            };
            // TODO(port): spawnProcess returns `!Maybe(Spawned)`; `.unwrap()` here is the
            // bun_sys::Result → Result conversion, not core::Result::unwrap.
            let mut spawned =
                spawn::spawn_process(&options, coord.argv.as_ptr(), coord.envps[this.idx as usize].as_ptr())?
                    .unwrap()?;
            // (Zig `defer spawned.extra_pipes.deinit()` — handled by Drop.)
            this.process = Some(spawned.to_process(coord.vm.event_loop(), false));
            if let Some(fd) = spawned.stdout {
                this.out.reader.start(fd, true).unwrap()?;
            }
            if let Some(fd) = spawned.stderr {
                this.err.reader.start(fd, true).unwrap()?;
            }
            if !spawned.extra_pipes.is_empty() {
                if !this.ipc.adopt(coord.vm, spawned.extra_pipes[0].fd()) {
                    return Err(bun_core::err!("ChannelAdoptFailed"));
                }
            } else {
                this.ipc.done = true;
            }
        }
        #[cfg(not(unix))]
        {
            // Windows: `.ipc` extra_fd creates a duplex `uv.Pipe` (named pipe
            // under the hood, UV_READABLE | UV_WRITABLE | UV_OVERLAPPED) and
            // initialises the parent end with uv_pipe_init(loop, ipc=1) — the
            // same dance Bun.spawn({ipc}) / process.send() use. The child opens
            // CRT fd 3 with uv_pipe_init(ipc=1) + uv_pipe_open in Channel.adopt.
            // Both ends agreeing on the libuv IPC framing is what matters; our
            // own [u32 len][u8 kind] frames ride inside it unchanged.
            use bun_sys::windows::libuv as uv;

            // SAFETY: all-zero is a valid uv::Pipe (matches Zig std.mem.zeroes).
            let ipc_pipe = Box::into_raw(Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() }));
            // TODO(port): errdefer — if adoptPipe below is never reached, closeAndDestroy(ipc_pipe).
            // A nested scopeguard cannot hold `&mut *this` here while the outer guard already
            // holds it; Phase B should fold this into the outer cleanup path (check
            // `this.ipc.backend.pipe.is_none()` and close_and_destroy the leaked pipe).

            this.extra_fd_stdio = [Stdio::Ipc(ipc_pipe)];
            let options = SpawnOptions {
                stdin: Stdio::Ignore,
                // SAFETY: all-zero is a valid uv::Pipe.
                stdout: Stdio::Buffer(Box::into_raw(Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() }))),
                // SAFETY: all-zero is a valid uv::Pipe.
                stderr: Stdio::Buffer(Box::into_raw(Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() }))),
                extra_fds: &mut this.extra_fd_stdio,
                cwd: coord.cwd,
                windows: spawn::WindowsOptions { loop_: jsc::EventLoopHandle::init(coord.vm) },
                stream: true,
                ..Default::default()
            };
            let mut spawned =
                spawn::spawn_process(&options, coord.argv.as_ptr(), coord.envps[this.idx as usize].as_ptr())?
                    .unwrap()?;
            // (Zig `defer spawned.extra_pipes.deinit()` — handled by Drop.)
            this.process = Some(spawned.to_process(coord.vm.event_loop(), false));

            if let Stdio::Buffer(pipe) = spawned.stdout {
                this.out.reader.start_with_pipe(pipe).unwrap()?;
            }
            if let Stdio::Buffer(pipe) = spawned.stderr {
                this.err.reader.start_with_pipe(pipe).unwrap()?;
            }
            if !this.ipc.adopt_pipe(coord.vm, ipc_pipe) {
                return Err(bun_core::err!("ChannelAdoptFailed"));
            }
        }

        let process = this.process.as_ref().expect("set above");
        #[cfg(windows)]
        {
            if let Some(job) = coord.windows_job {
                if let spawn::Poller::Uv(ref uv) = process.poller {
                    // SAFETY: FFI call; handles are valid (just spawned).
                    unsafe {
                        let _ = bun_sys::windows::AssignProcessToJobObject(job, uv.process_handle);
                    }
                }
            }
        }
        this.alive = true;
        // SAFETY: see coord_ptr note above; mutation requires *mut cast (TODO(port): interior mutability).
        unsafe { (*(coord_ptr as *mut Coordinator)).live_workers += 1 };
        // TODO(port): setExitHandler(this) stores a *Worker callback target on
        // Process; with Arc<Process> this needs interior mutability.
        process.set_exit_handler(&mut **this as *mut Worker);
        match process.watch_or_reap() {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(e) => {
                // Surface to the caller (spawnWorker / onWorkerExit) instead of
                // synchronously firing onExit() — that would re-enter
                // onWorkerExit() → start(), which under persistent EMFILE
                // recurses unboundedly while spawning real processes each frame.
                // Resource cleanup is handled by the function-scope errdefer.
                this.alive = false;
                // SAFETY: see above.
                unsafe { (*(coord_ptr as *mut Coordinator)).live_workers -= 1 };
                Output::err(e, "watchOrReap failed for test worker");
                return Err(bun_core::err!("ProcessWatchFailed"));
            }
        }

        // Disarm the errdefer cleanup on success.
        let _ = scopeguard::ScopeGuard::into_inner(this);
        Ok(())
    }

    pub fn on_process_exit(&mut self, _: &Process, status: Status, _: &Rusage) {
        self.alive = false;
        // SAFETY: coord backref valid for worker lifetime; mutation — see field TODO.
        unsafe { (*(self.coord as *mut Coordinator)).on_worker_exit(self, status) };
    }

    pub fn event_loop(&self) -> &jsc::EventLoop {
        // SAFETY: coord backref valid for worker lifetime.
        unsafe { (*self.coord).vm.event_loop() }
    }
    pub fn loop_(&self) -> &r#async::Loop {
        // SAFETY: coord backref valid for worker lifetime.
        unsafe { (*self.coord).vm.uv_loop() }
    }

    pub fn dispatch(&mut self, file_idx: u32, file: &[u8]) {
        // SAFETY: coord backref valid; frame mutation — see field TODO.
        let f = unsafe { &mut (*(self.coord as *mut Coordinator)).frame };
        f.begin(Frame::Kind::Run);
        f.u32_(file_idx);
        f.str(file);
        self.ipc.send(f.finish());
        self.inflight = Some(file_idx);
        // TODO(port): std.time.milliTimestamp() → confirm bun_core helper name.
        self.dispatched_at = bun_core::time::milli_timestamp();
    }

    pub fn shutdown(&mut self) {
        // SAFETY: coord backref valid; frame mutation — see field TODO.
        let f = unsafe { &mut (*(self.coord as *mut Coordinator)).frame };
        f.begin(Frame::Kind::Shutdown);
        self.ipc.send(f.finish());
        // Leave the channel open so the reader drains trailing
        // repeat_bufs/junit_file/coverage_file frames; the worker exits on
        // `.shutdown` and its exit closes the peer end.
    }

    /// `Channel` owner callback: a decoded frame arrived.
    pub fn on_channel_frame(&mut self, kind: Frame::Kind, rd: &mut Frame::Reader) {
        // SAFETY: coord backref valid; mutation — see field TODO.
        unsafe { (*(self.coord as *mut Coordinator)).on_frame(self, kind, rd) };
    }

    /// `Channel` owner callback: peer closed, errored, or sent a corrupt frame.
    /// Gates `tryReap` so kernel-buffered frames written just before exit() are
    /// decoded before the worker slot is torn down.
    pub fn on_channel_done(&mut self) {
        if self.ipc.is_attached() {
            // Corrupt frame path — kill the worker so onWorkerExit accounts for
            // the in-flight file and the slot can respawn.
            if let Some(p) = &self.process {
                let _ = p.kill(9);
            }
        }
        // SAFETY: coord backref valid; mutation — see field TODO.
        unsafe { (*(self.coord as *mut Coordinator)).try_reap(self) };
    }
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum PipeRole {
    Stdout,
    Stderr,
}

/// Reads worker stdout/stderr. Accumulates into the worker's `captured` buffer
/// and flushes atomically with the next test result so console output from
/// concurrent files never interleaves.
pub struct WorkerPipe {
    // TODO(port): Zig default `BufferedReader.init(WorkerPipe)` passes the
    // owner type for callback vtable wiring. Rust side likely a generic param
    // or trait impl; revisit in Phase B.
    pub reader: bun_io::BufferedReader,
    pub worker: *const Worker,
    pub role: PipeRole,
    /// EOF or error observed.
    pub done: bool,
}

impl WorkerPipe {
    pub fn new(role: PipeRole, worker: *const Worker) -> Self {
        Self {
            reader: bun_io::BufferedReader::init::<WorkerPipe>(),
            worker,
            role,
            done: false,
        }
    }

    pub fn on_read_chunk(&mut self, chunk: &[u8], _: bun_io::ReadState) -> bool {
        // SAFETY: worker backref valid while WorkerPipe is embedded in Worker.
        // TODO(port): LIFETIMES.tsv says *const Worker but we mutate `captured`;
        // Phase B may need *mut or Cell/UnsafeCell on Worker.captured.
        unsafe { (*(self.worker as *mut Worker)).captured.extend_from_slice(chunk) };
        true
    }
    pub fn on_reader_done(&mut self) {
        self.done = true;
    }
    pub fn on_reader_error(&mut self, _: bun_sys::Error) {
        self.done = true;
    }
    pub fn event_loop(&self) -> &jsc::EventLoop {
        // SAFETY: worker/coord backrefs valid for pipe lifetime.
        unsafe { (*(*self.worker).coord).vm.event_loop() }
    }
    pub fn loop_(&self) -> &r#async::Loop {
        // SAFETY: worker/coord backrefs valid for pipe lifetime.
        unsafe { (*(*self.worker).coord).vm.uv_loop() }
    }
}

impl Drop for WorkerPipe {
    fn drop(&mut self) {
        // Body intentionally empty: Zig `deinit` only calls `reader.deinit()`,
        // which Rust handles via `BufferedReader: Drop`.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/test/parallel/Worker.zig (245 lines)
//   confidence: medium
//   todos:      12
//   notes:      BACKREF *const fields (coord, worker) are mutated through — Phase B needs *mut or interior mutability; Arc<Process> mutation; nested Windows errdefer left as TODO (cannot scopeguard while outer guard holds &mut *this).
// ──────────────────────────────────────────────────────────────────────────
