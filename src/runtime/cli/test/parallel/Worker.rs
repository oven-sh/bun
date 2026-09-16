//! One spawned `bun test --test-worker --isolate` process plus its three
//! pipes. Tightly coupled with `Coordinator` (which owns the worker slice and
//! routes IPC frames); this file holds only the per-process state and the
//! spawn/dispatch/shutdown mechanics.

use core::ffi::c_void;

use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{self as spawn, Process, Rusage, SpawnOptions, Status, Stdio};
use bun_core::{self, Output};
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
    pub(crate) coord: *const Coordinator<'static>,
    pub(crate) idx: u32,
    pub(crate) process: Option<spawn::ProcessHandle>,

    /// Bidirectional IPC over fd 3. POSIX: usockets adopted from a socketpair.
    /// Windows: `bun_io::windows::Pipe` (the parent end of `.buffer` extra-fd, full-duplex).
    /// Commands and results both flow through this channel; backpressure is
    /// handled by the loop, so a busy worker writing thousands of `test_done`
    /// frames never truncates and the coordinator never blocks.
    pub(crate) ipc: Channel<Worker>,
    pub out: WorkerPipe,
    pub(crate) err: WorkerPipe,

    /// Index into `Coordinator.files` currently running on this worker.
    pub(crate) inflight: Option<u32>,
    /// Contiguous slice of `Coordinator.files` owned by this worker. `files`
    /// is sorted lexicographically so adjacent indices share parent dirs (and
    /// likely imports); each worker walks its range front-to-back. When the
    /// range is empty the worker steals one file from the *end* of whichever
    /// range has the most remaining — the end is furthest from that worker's
    /// hot region.
    pub(crate) range: FileRange,
    /// Millisecond timestamp at the most recent dispatch; drives lazy
    /// scale-up.
    pub(crate) dispatched_at: i64,
    /// Worker stdout+stderr since the last `test_done`. Flushed atomically
    /// under the right file header so concurrent files don't interleave.
    pub(crate) captured: Vec<u8>,
    pub(crate) alive: bool,
    /// Set when the process-exit notification arrives. Reaping waits for both
    /// this and `ipc.done` so trailing IPC frames are decoded first.
    pub(crate) exit_status: Option<Status>,
    pub(crate) reap_pending: bool,
    /// Set when this process sends `.ready`; reset before each respawn.
    /// `inflight == None` with `!reached_ready` at reap distinguishes a
    /// startup failure from a clean post-shutdown exit.
    pub(crate) reached_ready: bool,
    /// Consecutive (re)spawns of this slot that exited before `.ready`;
    /// reset on `.ready`. Bounds the respawn loop in `reap_worker`.
    pub(crate) startup_failures: u8,
}

impl Worker {
    pub(crate) fn start(&mut self) -> crate::Result<()> {
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
                if !p.has_exited() {
                    let _ = p.kill(9);
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
            this.out = WorkerPipe::new(self_ptr);
            this.err = WorkerPipe::new(self_ptr);
        });

        // `.buffer` extra_fd creates an AF_UNIX socketpair (a duplex pipe
        // on Windows); the parent end is adopted into the `Channel`.
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
        this.process = Some(
            spawned.to_process_handle(bun_event_loop::EventLoopHandle::init(
                coord.vm.event_loop().cast(),
            )),
        );
        // The parent ends nothing has taken yet, closed when a step below fails.
        let mut unadopted = scopeguard::guard(
            [stdout, stderr, extra_pipes.first().map(|pipe| pipe.fd())],
            |fds| {
                use bun_sys::FdExt as _;
                for fd in fds.into_iter().flatten() {
                    fd.close();
                }
            },
        );
        {
            let worker: &mut Worker = &mut **this;
            for (i, pipe) in [&mut worker.out, &mut worker.err].into_iter().enumerate() {
                let Some(fd) = unadopted[i] else { continue };
                // A reader that fails to start (Windows only) has not taken the fd.
                if pipe.reader.start(fd, true).is_err() {
                    return Err(crate::Error::PipeStartFailed);
                }
                unadopted[i] = None;
            }
        }
        // `adopt` closes the fd when it fails.
        if let Some(ipc_fd) = unadopted[2].take() {
            if !Channel::adopt(&raw mut this.ipc, coord.vm, ipc_fd, false) {
                return Err(crate::Error::ChannelAdoptFailed);
            }
        } else {
            this.ipc.done.set(true);
        }

        let process: *mut Process = this.process.as_ref().expect("set above").as_ptr();
        // SAFETY: just spawned; sole owner until reaped.
        let process = unsafe { &mut *process };
        #[cfg(windows)]
        {
            if let Some(job) = coord.windows_job {
                // SAFETY: FFI call; handles are valid (just spawned).
                unsafe {
                    let _ =
                        bun_sys::windows::AssignProcessToJobObject(job, process.process_handle());
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

    pub(crate) fn on_process_exit(&mut self, _: &Process, status: Status, _: &Rusage) {
        self.alive = false;
        // SAFETY: coord backref valid for worker lifetime; mutation — see `coord` field doc (provenance caveats).
        unsafe { (*self.coord.cast_mut()).on_worker_exit(self, status) };
    }

    pub(crate) fn dispatch(&mut self, file_idx: u32, file: &[u8]) {
        // SAFETY: coord backref valid; frame mutation — see `coord` field doc (provenance caveats).
        let f = unsafe { &mut (*self.coord.cast_mut()).frame };
        f.begin(frame::Kind::Run);
        f.u32(file_idx);
        f.str(file);
        self.ipc.send(f.finish());
        self.inflight = Some(file_idx);
        self.dispatched_at = bun_core::time::milli_timestamp();
    }

    pub(crate) fn shutdown(&mut self) {
        // SAFETY: coord backref valid; frame mutation — see `coord` field doc (provenance caveats).
        let f = unsafe { &mut (*self.coord.cast_mut()).frame };
        f.begin(frame::Kind::Shutdown);
        self.ipc.send(f.finish());
        // Leave the channel open so the reader drains trailing
        // repeat_bufs / coverage_file frames; the worker exits on
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
            if let Some(p) = &self.process {
                let _ = p.kill(9);
            }
        }
        // SAFETY: coord backref valid; mutation — see `coord` field doc (provenance caveats).
        unsafe { (*self.coord.cast_mut()).try_reap(self) };
    }
}

/// Reads worker stdout/stderr. Accumulates into the worker's `captured` buffer
/// and flushes atomically with the next test result so console output from
/// concurrent files never interleaves.
pub struct WorkerPipe {
    pub(crate) reader: bun_io::BufferedReader,
    pub(crate) worker: *const Worker,
    /// EOF or error observed.
    pub(crate) done: bool,
}

impl WorkerPipe {
    pub(crate) fn new(worker: *const Worker) -> Self {
        Self {
            reader: bun_io::BufferedReader::init::<WorkerPipe>(),
            worker,
            done: false,
        }
    }

    pub(crate) fn on_read_chunk(&mut self, chunk: &[u8], _: bun_io::ReadState) -> bool {
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
    pub(crate) fn on_reader_done(&mut self) {
        self.done = true;
    }
    pub(crate) fn on_reader_error(&mut self, _: bun_sys::Error) {
        self.done = true;
    }
}

// `bun_io::BufferedReader` vtable parent.
// Callbacks touch only fields disjoint from `reader` (worker backref / done
// flag); worker/coord backrefs are valid for the pipe's lifetime.
bun_io::impl_buffered_reader_parent! {
    TestParallelWorkerPipe for WorkerPipe;
    has_on_read_chunk = true;
    on_read_chunk   = |this, chunk, state| (*this).on_read_chunk(&chunk, state);
    on_reader_done  = |this| (*this).on_reader_done();
    on_reader_error = |this, err| (*this).on_reader_error(err);
    loop_           = |this| (*(*(*this).worker).coord).vm.uws_loop();
    event_loop      = |this| (*(*(*this).worker).coord).event_loop_handle.as_event_loop_ctx();
}
