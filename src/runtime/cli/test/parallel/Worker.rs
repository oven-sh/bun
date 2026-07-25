//! One spawned `bun test --test-worker --isolate` process plus its three
//! pipes. Tightly coupled with `Coordinator` (which owns the worker slice and
//! routes IPC frames); this file holds only the per-process state and the
//! spawn/dispatch/shutdown mechanics.

use core::ffi::c_void;

#[cfg(unix)]
use crate::api::bun::process::PosixStdio as Stdio;
#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
#[cfg(not(unix))]
use crate::api::bun::process::WindowsStdio as Stdio;
use crate::api::bun::process::{self as spawn, Process, Rusage, SpawnOptions, Status};
use bun_core::{self, Output};
use bun_io as r#async;
use bun_io;
use bun_jsc as jsc;
use bun_sys;

use super::channel::{Channel, ChannelOwner};
use super::coordinator::Coordinator;
use super::file_range::FileRange;
use super::frame;

pub struct Worker {
    // BACKREF to the owning Coordinator. Stored as `*const` for LIFETIMES.tsv
    // parity, but mutation sites (`live_workers`, `on_worker_exit`, `frame`)
    // go through `cast_mut()`. The pointer is created from `&raw mut coord` in
    // runner.rs, so it carries write provenance (preserved across const casts);
    // that removes the read-only-provenance layer of UB but does NOT make the
    // pattern fully sound: runner.rs takes a fresh `&mut coord` to call
    // `coord.drive()` after the backref is stored, and every backref write
    // happens during drive(), so the aliasing remains UB-adjacent under
    // Stacked/Tree Borrows. The full fix is a `*mut` backref (or interior
    // mutability) threaded through runner.rs/Coordinator.rs together.
    // `Coordinator<'a>` carries borrowed slices; the lifetime is erased to
    // `'static` here because this is a raw backref pointer that is only ever
    // dereferenced unsafely.
    pub coord: *const Coordinator<'static>,
    pub idx: u32,
    // Intrusive-refcounted (`ThreadSafeRefCount`); `to_process` returns a
    // `heap::alloc`ed `*mut Process`.
    pub process: Option<*mut Process>,

    /// Bidirectional IPC over fd 3. POSIX: usockets adopted from a socketpair.
    /// Windows: `uv.Pipe` (the parent end of `.buffer` extra-fd, full-duplex).
    /// Commands and results both flow through this channel; backpressure is
    /// handled by the loop, so a busy worker writing thousands of `test_done`
    /// frames never truncates and the coordinator never blocks.
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
    /// Millisecond timestamp at the most recent dispatch; drives lazy
    /// scale-up.
    pub dispatched_at: i64,
    /// Worker stdout+stderr since the last `test_done`. Flushed atomically
    /// under the right file header so concurrent files don't interleave.
    pub captured: Vec<u8>,
    pub alive: bool,
    /// Set when the process-exit notification arrives. Reaping waits for both
    /// this and `ipc.done` so trailing IPC frames are decoded first.
    pub exit_status: Option<Status>,
}

impl Worker {
    pub fn start(&mut self) -> crate::Result<()> {
        debug_assert!(!self.alive);
        let coord_ptr = self.coord;
        // SAFETY: coord backref is valid for the worker's lifetime (Coordinator owns workers slice).
        let coord = unsafe { &*coord_ptr };

        // SAFETY: out/err are fields of self; setParent stores the raw parent
        // pointer for later `container_of`-style callback recovery. The
        // pointers remain valid as long as `self` is not moved (Coordinator
        // holds workers in a stable slice).
        unsafe {
            let out_ptr: *mut WorkerPipe = &raw mut self.out;
            (*out_ptr).reader.set_parent(out_ptr.cast::<c_void>());
            let err_ptr: *mut WorkerPipe = &raw mut self.err;
            (*err_ptr).reader.set_parent(err_ptr.cast::<c_void>());
        }

        // All resource cleanup on any error return — including watchOrReap
        // failure below. Each guard checks for null/unstarted so the order in
        // which fields are populated doesn't matter.
        let mut this = scopeguard::guard(self, |this| {
            if let Some(p) = this.process.take() {
                // SAFETY: `p` is a live intrusive-refcounted *mut Process
                // produced by `to_process` below; sole owner until reaped.
                unsafe {
                    (*p).exit_handler = Default::default();
                    if !(*p).has_exited() {
                        let _ = (*p).kill(9);
                    }
                    (*p).close();
                }
            }
            // Reset to fresh state after deinit so reapWorker's `!respawned`
            // cleanup (which can't tell whether start() ran) doesn't deinit on
            // undefined ArrayList memory.
            // Assignment drops the old value. Take the
            // backref from `&mut` so the stored `*const` keeps write provenance
            // (on_read_chunk mutates `captured` through it).
            let self_ptr: *const Worker = std::ptr::from_mut::<Worker>(this).cast_const();
            this.ipc = Channel::default();
            this.out = WorkerPipe::new(PipeRole::Stdout, self_ptr);
            this.err = WorkerPipe::new(PipeRole::Stderr, self_ptr);
        });

        #[cfg(unix)]
        {
            // `.buffer` extra_fd creates an AF_UNIX socketpair; the parent end is
            // adopted into a usockets `Channel`.
            let options = SpawnOptions {
                stdin: Stdio::Ignore,
                stdout: Stdio::Buffer,
                stderr: Stdio::Buffer,
                extra_fds: vec![Stdio::Buffer].into_boxed_slice(),
                cwd: coord.cwd.to_vec().into_boxed_slice(),
                stream: true,
                // Own pgrp so abortAll can kill(-pid, SIGTERM) the worker and
                // anything it spawned. PDEATHSIG is the SIGKILL safety net on
                // Linux for the worker itself.
                new_process_group: true,
                #[cfg(any(target_os = "linux", target_os = "android"))]
                linux_pdeathsig: Some(libc::SIGKILL as u8),
                #[cfg(not(any(target_os = "linux", target_os = "android")))]
                linux_pdeathsig: None,
                ..Default::default()
            };
            // SAFETY: `coord.argv`/`coord.envps[..]` are null-terminated
            // C-string arrays with argv[0] non-null; valid for this call.
            let mut spawned = unsafe {
                spawn::spawn_process(
                    &options,
                    coord.argv.as_ptr(),
                    coord.envps[this.idx as usize].as_ptr(),
                )
            }?
            .map_err(|e| {
                Output::err(e, "spawnProcess failed for test worker", ());
                crate::Error::SpawnFailed
            })?;
            let stdout = spawned.stdout;
            let stderr = spawned.stderr;
            let extra_pipes = core::mem::take(&mut spawned.extra_pipes);
            this.process = Some(spawned.to_process(
                bun_event_loop::EventLoopHandle::init(coord.vm.event_loop().cast()),
                false,
            ));
            if let Some(fd) = stdout {
                this.out
                    .reader
                    .start(fd, true)
                    .map_err(|_| crate::Error::PipeStartFailed)?;
            }
            if let Some(fd) = stderr {
                this.err
                    .reader
                    .start(fd, true)
                    .map_err(|_| crate::Error::PipeStartFailed)?;
            }
            if !extra_pipes.is_empty() {
                // coord.vm backref valid for worker lifetime; adopt() mutates the
                // loop's socket context via interior mutability on the C side.
                if !this.ipc.adopt(coord.vm, extra_pipes[0].fd()) {
                    return Err(crate::Error::ChannelAdoptFailed);
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

            let ipc_pipe = bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<uv::Pipe>()));
            // The guard owns the raw Box ptr; `close_and_destroy` handles both
            // never-initialized (loop_ null → free directly) and initialized
            // (uv_close + free in callback). Disarmed only after `adopt_pipe`
            // succeeds and the Channel takes ownership. The guard captures only
            // the raw ptr, so it nests cleanly under the outer `this` guard.
            let ipc_pipe_guard = scopeguard::guard(ipc_pipe, |p| {
                // SAFETY: `p` is the live Box-allocated uv_pipe_t; sole owner
                // on every error path (extra_pipes is drained back to raw below).
                unsafe { uv::Pipe::close_and_destroy(p) };
            });

            let options = SpawnOptions {
                stdin: Stdio::Ignore,
                stdout: Stdio::Buffer(bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<
                    uv::Pipe,
                >()))),
                stderr: Stdio::Buffer(bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<
                    uv::Pipe,
                >()))),
                extra_fds: vec![Stdio::Ipc(ipc_pipe)].into_boxed_slice(),
                cwd: coord.cwd.to_vec().into_boxed_slice(),
                windows: spawn::WindowsOptions {
                    loop_: jsc::EventLoopHandle::init(coord.vm.event_loop().cast()),
                    ..Default::default()
                },
                stream: true,
                ..Default::default()
            };
            // SAFETY: `coord.argv`/`coord.envps[..]` are null-terminated
            // C-string arrays with argv[0] non-null; valid for this call.
            let mut spawned = unsafe {
                spawn::spawn_process(
                    &options,
                    coord.argv.as_ptr(),
                    coord.envps[this.idx as usize].as_ptr(),
                )
            }?
            .map_err(|e| {
                Output::err(e, "spawnProcess failed for test worker", ());
                crate::Error::SpawnFailed
            })?;
            // `WindowsStdioResult::Buffer` holds `Box<uv::Pipe>`, and
            // `spawn_process_windows` does `heap::take(ipc_pipe)` into it — so
            // `extra_pipes` holds a second `Box` to the SAME heap address that
            // `ipc_pipe_guard` / `adopt_pipe` claim. Drain the Vec and release
            // each Box back to a raw ptr so the Vec drop is inert and
            // `ipc_pipe_guard` remains the sole owner across the
            // `start_with_pipe` error window below.
            for item in core::mem::take(&mut spawned.extra_pipes) {
                if let spawn::WindowsStdioResult::Buffer(p) = item {
                    let raw = bun_core::heap::into_raw(p);
                    debug_assert_eq!(raw, ipc_pipe, "extra_pipes Box must wrap ipc_pipe");
                    let _ = raw;
                }
            }
            this.process = Some(spawned.to_process(coord.vm.event_loop(), false));

            if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stdout.take() {
                // SAFETY: `pipe` is a Box<uv::Pipe> just produced by spawn_process;
                // ownership transfers into the reader's `Source` (heap::take inside).
                unsafe {
                    this.out
                        .reader
                        .start_with_pipe(bun_core::heap::into_raw(pipe))
                }
                .map_err(|_| crate::Error::PipeStartFailed)?;
            }
            if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stderr.take() {
                // SAFETY: see stdout above.
                unsafe {
                    this.err
                        .reader
                        .start_with_pipe(bun_core::heap::into_raw(pipe))
                }
                .map_err(|_| crate::Error::PipeStartFailed)?;
            }
            // `ipc_pipe` was Box-allocated via heap::into_raw above and
            // initialised by spawn_process; ownership of the *mut Pipe transfers
            // to the Channel on success (it does the Box::from_raw internally).
            // On failure the caller still owns it (Channel.rs:294) and the
            // `ipc_pipe_guard` errdefer performs `close_and_destroy`.
            if !this.ipc.adopt_pipe(coord.vm, ipc_pipe) {
                return Err(crate::Error::ChannelAdoptFailed);
            }
            // Channel now owns the Box; disarm the errdefer so end-of-block
            // doesn't double-close. Any later error (watch_or_reap) is handled
            // by the outer `this` guard, whose `Channel::default()` assignment
            // drops the old Channel and `close_and_destroy`s the pipe via Drop.
            let _ = scopeguard::ScopeGuard::into_inner(ipc_pipe_guard);
        }

        let process_ptr = this.process.expect("set above");
        // SAFETY: process_ptr is the live intrusive-refcounted *mut Process from
        // `to_process` above; sole owner until reaped.
        let process = unsafe { &mut *process_ptr };
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
        // SAFETY: see coord_ptr note above; the backref carries write
        // provenance, but see the `coord` field doc for the residual
        // &mut-Coordinator-during-drive aliasing caveat.
        unsafe { (*coord_ptr.cast_mut()).live_workers += 1 };
        // SAFETY: `this` is the live `Box<Worker>` slot in
        // `Coordinator.workers`; it outlives `process`.
        process.set_exit_handler(unsafe {
            bun_spawn::ProcessExit::new(
                bun_spawn::ProcessExitKind::TestParallelWorker,
                &raw mut **this,
            )
        });
        match process.watch_or_reap() {
            Ok(_) => {}
            Err(e) => {
                // Surface to the caller (spawnWorker / onWorkerExit) instead of
                // synchronously firing onExit() — that would re-enter
                // onWorkerExit() → start(), which under persistent EMFILE
                // recurses unboundedly while spawning real processes each frame.
                // Resource cleanup is handled by the function-scope errdefer.
                this.alive = false;
                // SAFETY: see above.
                unsafe { (*coord_ptr.cast_mut()).live_workers -= 1 };
                Output::err(e, "watchOrReap failed for test worker", ());
                return Err(crate::Error::ProcessWatchFailed);
            }
        }

        // Disarm the errdefer cleanup on success.
        let _ = scopeguard::ScopeGuard::into_inner(this);
        Ok(())
    }

    pub fn on_process_exit(&mut self, _: &Process, status: Status, _: &Rusage) {
        self.alive = false;
        // SAFETY: coord backref valid for worker lifetime; mutation — see `coord` field doc (provenance caveats).
        unsafe { (*self.coord.cast_mut()).on_worker_exit(self, status) };
    }

    /// Borrow the parent `Coordinator`.
    ///
    /// SAFETY (invariant): `coord` is a backref to the owning `Coordinator`,
    /// set at construction and valid for the worker's entire lifetime (the
    /// coordinator owns all workers). Never null.
    #[inline]
    fn coord(&self) -> &Coordinator<'static> {
        // SAFETY: see doc comment — non-null backref valid for `'_`.
        unsafe { &*self.coord }
    }

    pub fn event_loop(&self) -> *mut jsc::event_loop::EventLoop {
        self.coord().vm.event_loop()
    }
    pub fn loop_(&self) -> *mut r#async::Loop {
        self.coord().vm.uv_loop()
    }

    pub fn dispatch(&mut self, file_idx: u32, file: &[u8]) {
        // SAFETY: coord backref valid; frame mutation — see `coord` field doc (provenance caveats).
        let f = unsafe { &mut (*self.coord.cast_mut()).frame };
        f.begin(frame::Kind::Run);
        f.u32_(file_idx);
        f.str(file);
        self.ipc.send(f.finish());
        self.inflight = Some(file_idx);
        self.dispatched_at = bun_core::time::milli_timestamp();
    }

    pub fn shutdown(&mut self) {
        // SAFETY: coord backref valid; frame mutation — see `coord` field doc (provenance caveats).
        let f = unsafe { &mut (*self.coord.cast_mut()).frame };
        f.begin(frame::Kind::Shutdown);
        self.ipc.send(f.finish());
        // Leave the channel open so the reader drains trailing
        // repeat_bufs/junit_file/coverage_file frames; the worker exits on
        // `.shutdown` and its exit closes the peer end.
    }
}

bun_spawn::link_impl_ProcessExit! {
    TestParallelWorker for Worker => |this| {
        on_process_exit(process, status, rusage) =>
            (*this).on_process_exit(&*process, status, rusage),
    }
}

bun_core::intrusive_field!(Worker, ipc: Channel<Worker>);
impl ChannelOwner for Worker {
    fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>) {
        // SAFETY: coord backref valid; mutation — see `coord` field doc (provenance caveats).
        unsafe { (*self.coord.cast_mut()).on_frame(self, kind, rd) };
    }

    fn on_channel_done(&mut self) {
        if self.ipc.is_attached() {
            // Corrupt frame path — kill the worker so onWorkerExit accounts for
            // the in-flight file and the slot can respawn.
            if let Some(p) = self.process {
                // SAFETY: `p` is the live intrusive-refcounted *mut Process.
                let _ = unsafe { (*p).kill(9) };
            }
        }
        // SAFETY: coord backref valid; mutation — see `coord` field doc (provenance caveats).
        unsafe { (*self.coord.cast_mut()).try_reap(self) };
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
        // Mutating `captured` through cast_mut requires write provenance on
        // the stored pointer; all backref creation sites (the runner.rs
        // coord_ptr, the Worker.rs start() errdefer guard, and the
        // Coordinator.rs spawn_worker/respawn sites via
        // `std::ptr::from_mut(..).cast_const()`) now establish it. The
        // residual `&mut Coordinator`-during-drive aliasing caveat described
        // in the `Worker::coord` field doc applies to this backref too. No
        // other reference to `captured` is live during the read callback.
        unsafe { (*self.worker.cast_mut()).captured.extend_from_slice(chunk) };
        true
    }
    pub fn on_reader_done(&mut self) {
        self.done = true;
    }
    pub fn on_reader_error(&mut self, _: bun_sys::Error) {
        self.done = true;
    }
}

impl Default for WorkerPipe {
    fn default() -> Self {
        Self::new(PipeRole::Stdout, core::ptr::null())
    }
}

// `bun_io::BufferedReader` vtable parent.
// Callbacks touch only fields disjoint from `reader` (worker backref / done
// flag); worker/coord backrefs are valid for the pipe's lifetime.
bun_io::impl_buffered_reader_parent! {
    TestParallelWorkerPipe for WorkerPipe;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, state| (*this).on_read_chunk(chunk, state);
    on_reader_done  = |this| (*this).on_reader_done();
    on_reader_error = |this, err| (*this).on_reader_error(err);
    // `vm.uv_loop()` is `*mut bun_io::Loop` on every target.
    loop_           = |this| (*(*(*this).worker).coord).vm.uv_loop();
    event_loop      = |this| (*(*(*this).worker).coord).event_loop_handle.as_event_loop_ctx();
}

impl Drop for WorkerPipe {
    fn drop(&mut self) {
        // Body intentionally empty: `BufferedReader: Drop` handles cleanup.
    }
}
