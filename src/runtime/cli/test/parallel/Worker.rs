//! One spawned `bun test --test-worker --isolate` process plus its three
//! pipes. Tightly coupled with `Coordinator` (which owns the worker slice and
//! routes IPC frames); this file holds only the per-process state and the
//! spawn/dispatch/shutdown mechanics.

use core::ffi::c_void;

use bun_core::{self, Output};
use bun_jsc as jsc;
use bun_aio as r#async;
use bun_io;
use bun_sys;
// `bun.spawn` lives under src/runtime/api/bun/process.zig → mounted at
// `crate::api::bun_process`, re-exported as `crate::api::bun::process`.
use crate::api::bun::process::{self as spawn, Process, ProcessExitVTable, Rusage, SpawnOptions, SpawnResultExt as _, Status};
#[cfg(unix)]
use crate::api::bun::process::PosixStdio as Stdio;
#[cfg(not(unix))]
use crate::api::bun::process::WindowsStdio as Stdio;

use super::channel::{Channel, ChannelOwner};
use super::coordinator::Coordinator;
use super::file_range::FileRange;
use super::frame;

pub struct Worker {
    // TODO(port): LIFETIMES.tsv classifies this BACKREF → *const, but the Zig
    // mutates through it (live_workers, onWorkerExit, frame). Phase B: either
    // *mut or interior mutability on Coordinator.
    // PORT NOTE: `Coordinator<'a>` carries borrowed slices; the lifetime is
    // erased to `'static` here because this is a raw backref pointer that is
    // only ever dereferenced unsafely (constructor casts via `as *const _`).
    pub coord: *const Coordinator<'static>,
    pub idx: u32,
    // Intrusive-refcounted (`ThreadSafeRefCount`); `to_process` returns a
    // `heap::alloc`ed `*mut Process`. Matches Zig `?*bun.spawn.Process`.
    pub process: Option<*mut Process>,

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
            // PORT NOTE: assignment drops the old value (≡ Zig deinit + reinit).
            let self_ptr: *const Worker = std::ptr::from_ref::<Worker>(this);
            this.ipc = Channel::default();
            this.out = WorkerPipe::new(PipeRole::Stdout, self_ptr);
            this.err = WorkerPipe::new(PipeRole::Stderr, self_ptr);
        });

        #[cfg(unix)]
        {
            // `.buffer` extra_fd creates an AF_UNIX socketpair; the parent end is
            // adopted into a usockets `Channel`.
            // PORT NOTE: SpawnOptions.extra_fds is `Box<[Stdio]>` (owned) in the
            // Rust port, so the `extra_fd_stdio` field is no longer borrowed here.
            this.extra_fd_stdio = [Stdio::Buffer];
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
                #[cfg(target_os = "linux")]
                linux_pdeathsig: Some(libc::SIGKILL as u8),
                #[cfg(not(target_os = "linux"))]
                linux_pdeathsig: None,
                ..Default::default()
            };
            // Zig: `try (try spawnProcess(...)).unwrap()` — outer `?` for the
            // anyerror, inner map for the bun_sys::Result.
            let mut spawned =
                spawn::spawn_process(&options, coord.argv.as_ptr(), coord.envps[this.idx as usize].as_ptr())?
                    .map_err(|e| {
                        Output::err(e, "spawnProcess failed for test worker", ());
                        bun_core::err!("SpawnFailed")
                    })?;
            let stdout = spawned.stdout;
            let stderr = spawned.stderr;
            // (Zig `defer spawned.extra_pipes.deinit()` — handled by Drop.)
            let extra_pipes = core::mem::take(&mut spawned.extra_pipes);
            this.process = Some(spawned.to_process(
                bun_event_loop::EventLoopHandle::init(coord.vm.event_loop().cast()),
                false,
            ));
            if let Some(fd) = stdout {
                this.out
                    .reader
                    .start(fd, true)
                    .map_err(|_| bun_core::err!("PipeStartFailed"))?;
            }
            if let Some(fd) = stderr {
                this.err
                    .reader
                    .start(fd, true)
                    .map_err(|_| bun_core::err!("PipeStartFailed"))?;
            }
            if !extra_pipes.is_empty() {
                // coord.vm backref valid for worker lifetime; adopt() mutates the
                // loop's socket context via interior mutability on the C side.
                if !this.ipc.adopt(coord.vm, extra_pipes[0].fd()) {
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
            let ipc_pipe = bun_core::heap::leak(Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() }));
            // TODO(port): errdefer — if adoptPipe below is never reached, closeAndDestroy(ipc_pipe).
            // A nested scopeguard cannot hold `&mut *this` here while the outer guard already
            // holds it; Phase B should fold this into the outer cleanup path (check
            // `this.ipc.backend.pipe.is_none()` and close_and_destroy the leaked pipe).

            this.extra_fd_stdio = [Stdio::Ipc(ipc_pipe)];
            let options = SpawnOptions {
                stdin: Stdio::Ignore,
                // SAFETY: all-zero is a valid uv::Pipe.
                stdout: Stdio::Buffer(bun_core::heap::leak(Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() }))),
                // SAFETY: all-zero is a valid uv::Pipe.
                stderr: Stdio::Buffer(bun_core::heap::leak(Box::new(unsafe { core::mem::zeroed::<uv::Pipe>() }))),
                extra_fds: &mut this.extra_fd_stdio,
                cwd: coord.cwd,
                windows: spawn::WindowsOptions { loop_: jsc::EventLoopHandle::init(coord.vm), ..Default::default() },
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
        // SAFETY: see coord_ptr note above; mutation requires *mut cast (TODO(port): interior mutability).
        unsafe { (*coord_ptr.cast_mut()).live_workers += 1 };
        process.set_exit_handler(
            (&raw mut **this).cast::<()>(),
            &WORKER_EXIT_VTABLE,
        );
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
        unsafe { (*self.coord.cast_mut()).on_worker_exit(self, status) };
    }

    pub fn event_loop(&self) -> *mut jsc::event_loop::EventLoop {
        // SAFETY: coord backref valid for worker lifetime.
        unsafe { (*self.coord).vm.event_loop() }
    }
    pub fn loop_(&self) -> *mut r#async::Loop {
        // SAFETY: coord backref valid for worker lifetime.
        unsafe { (*self.coord).vm.uv_loop() }
    }

    pub fn dispatch(&mut self, file_idx: u32, file: &[u8]) {
        // SAFETY: coord backref valid; frame mutation — see field TODO.
        let f = unsafe { &mut (*self.coord.cast_mut()).frame };
        f.begin(frame::Kind::Run);
        f.u32_(file_idx);
        f.str(file);
        self.ipc.send(f.finish());
        self.inflight = Some(file_idx);
        // TODO(port): std.time.milliTimestamp() → confirm bun_core helper name.
        self.dispatched_at = bun_core::time::milli_timestamp();
    }

    pub fn shutdown(&mut self) {
        // SAFETY: coord backref valid; frame mutation — see field TODO.
        let f = unsafe { &mut (*self.coord.cast_mut()).frame };
        f.begin(frame::Kind::Shutdown);
        self.ipc.send(f.finish());
        // Leave the channel open so the reader drains trailing
        // repeat_bufs/junit_file/coverage_file frames; the worker exits on
        // `.shutdown` and its exit closes the peer end.
    }

    /// `Channel` owner callback: a decoded frame arrived.
    pub fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>) {
        // SAFETY: coord backref valid; mutation — see field TODO.
        unsafe { (*self.coord.cast_mut()).on_frame(self, kind, rd) };
    }

    /// `Channel` owner callback: peer closed, errored, or sent a corrupt frame.
    /// Gates `tryReap` so kernel-buffered frames written just before exit() are
    /// decoded before the worker slot is torn down.
    pub fn on_channel_done(&mut self) {
        if self.ipc.is_attached() {
            // Corrupt frame path — kill the worker so onWorkerExit accounts for
            // the in-flight file and the slot can respawn.
            if let Some(p) = self.process {
                // SAFETY: `p` is the live intrusive-refcounted *mut Process.
                let _ = unsafe { (*p).kill(9) };
            }
        }
        // SAFETY: coord backref valid; mutation — see field TODO.
        unsafe { (*self.coord.cast_mut()).try_reap(self) };
    }
}

/// `ProcessExitHandler` vtable entry — recovers `&mut Worker` from the erased
/// owner pointer registered via `set_exit_handler` (Zig: `setExitHandler(this)`).
unsafe fn worker_on_process_exit(
    owner: *mut (),
    process: *mut Process,
    status: Status,
    rusage: *const Rusage,
) {
    // SAFETY: `owner` is the `*mut Worker` stored in `set_exit_handler`;
    // `process`/`rusage` are non-null per `ProcessExitHandler::call`.
    unsafe { (*owner.cast::<Worker>()).on_process_exit(&*process, status, &*rusage) };
}

static WORKER_EXIT_VTABLE: ProcessExitVTable = ProcessExitVTable {
    on_process_exit: worker_on_process_exit,
};

impl ChannelOwner for Worker {
    /// `offset_of!(Worker, ipc)` — recovers `&mut Worker` from `&mut Channel<Worker>`
    /// in platform callbacks (Zig: `@fieldParentPtr("ipc", ...)`).
    const CHANNEL_OFFSET: usize = core::mem::offset_of!(Worker, ipc);

    fn on_channel_frame(&mut self, kind: frame::Kind, rd: &mut frame::Reader<'_>) {
        // SAFETY: coord backref valid; mutation — see field TODO.
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
        // SAFETY: coord backref valid; mutation — see field TODO.
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
        unsafe { (*self.worker.cast_mut()).captured.extend_from_slice(chunk) };
        true
    }
    pub fn on_reader_done(&mut self) {
        self.done = true;
    }
    pub fn on_reader_error(&mut self, _: bun_sys::Error) {
        self.done = true;
    }
    pub fn event_loop(&self) -> *mut jsc::event_loop::EventLoop {
        // SAFETY: worker/coord backrefs valid for pipe lifetime.
        unsafe { (*(*self.worker).coord).vm.event_loop() }
    }
    pub fn loop_(&self) -> *mut r#async::Loop {
        // SAFETY: worker/coord backrefs valid for pipe lifetime.
        unsafe { (*(*self.worker).coord).vm.uv_loop() }
    }
}

impl Default for WorkerPipe {
    fn default() -> Self {
        Self::new(PipeRole::Stdout, core::ptr::null())
    }
}

// `bun.io.BufferedReader.init(WorkerPipe)` — vtable parent. Maps the Zig
// `onReadChunk`/`onReaderDone`/`onReaderError`/`loop`/`eventLoop` decls.
impl bun_io::pipe_reader::BufferedReaderParent for WorkerPipe {
    const HAS_ON_READ_CHUNK: bool = true;
    // SAFETY (all): see `BufferedReaderParent` aliasing contract — `this` is the
    // `*mut Self` registered via `set_parent`; a `&mut` to the embedded reader
    // may be live on the caller's stack. These touch only fields disjoint from
    // `reader` (worker backref / done flag).
    unsafe fn on_read_chunk(this: *mut Self, chunk: &[u8], state: bun_io::ReadState) -> bool {
        unsafe { WorkerPipe::on_read_chunk(&mut *this, chunk, state) }
    }
    unsafe fn on_reader_done(this: *mut Self) {
        unsafe { WorkerPipe::on_reader_done(&mut *this) }
    }
    unsafe fn on_reader_error(this: *mut Self, err: bun_sys::Error) {
        unsafe { WorkerPipe::on_reader_error(&mut *this, err) }
    }
    unsafe fn loop_(this: *mut Self) -> *mut bun_aio::Loop {
        // SAFETY: worker/coord backrefs valid for pipe lifetime.
        // `vm.uv_loop()` is `*mut bun_aio::Loop` on every target (uv on
        // Windows, us_loop on POSIX) — exactly the trait's nominal.
        unsafe { (*(*(*this).worker).coord).vm.uv_loop() }
    }
    unsafe fn event_loop(this: *mut Self) -> bun_io::EventLoopHandle {
        // CYCLEBREAK: bun_io::EventLoopHandle is an opaque `*mut c_void`; pass
        // the address of the stored `bun_jsc::EventLoopHandle` so the
        // (runtime-registered) FilePoll vtable can recover it via `io_ev`.
        // SAFETY: worker/coord backrefs valid for pipe lifetime; the
        // `Coordinator` outlives every `WorkerPipe` callback.
        bun_io::EventLoopHandle(unsafe {
            core::ptr::addr_of!((*(*(*this).worker).coord).event_loop_handle).cast_mut().cast::<c_void>()
        })
    }
}

impl Drop for WorkerPipe {
    fn drop(&mut self) {
        // Body intentionally empty: Zig `deinit` only calls `reader.deinit()`,
        // which Rust handles via `BufferedReader: Drop`.
    }
}

// ported from: src/cli/test/parallel/Worker.zig
