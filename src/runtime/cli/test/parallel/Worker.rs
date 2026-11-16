//! One spawned `bun test --test-worker --isolate` process plus its three
//! pipes. Tightly coupled with `Coordinator` (which owns the worker slice and
//! routes IPC frames); this file holds only the per-process state and the
//! spawn/dispatch/shutdown mechanics.

#[cfg(windows)]
use core::ffi::c_void;

#[cfg(unix)]
use crate::api::bun::process::PosixStdio as Stdio;
#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
#[cfg(not(unix))]
use crate::api::bun::process::WindowsStdio as Stdio;
use crate::api::bun::process::{self as spawn, Process, Rusage, SpawnOptions, Status};
use bun_core::{self, Output};
use bun_io::max_buf::Kind;
use bun_io::{BufferedReader, IoEvent, Owner, PollTag};
#[cfg(windows)]
use bun_jsc as jsc;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_spawn::RusageFields as _;

use super::channel::Channel;
use super::file_range::FileRange;
use super::frame::{self, Frame};

pub(crate) struct Worker {
    pub(crate) event_loop: bun_jsc::EventLoopHandle,
    pub(crate) idx: u32,
    pub(crate) process: Option<spawn::ProcessHandle>,

    /// Bidirectional IPC over fd 3. POSIX: usockets adopted from a socketpair.
    /// Windows: `uv.Pipe` (the parent end of `.buffer` extra-fd, full-duplex).
    /// Commands and results both flow through this channel; backpressure is
    /// handled by the loop, so a busy worker writing thousands of `test_done`
    /// frames never truncates and the coordinator never blocks.
    pub(crate) ipc: Channel,
    pub(crate) out: BufferedReader,
    pub(crate) err: BufferedReader,

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
    /// Highest peak RSS among this slot's exited processes.
    pub(crate) peak_rss_mb: u32,
    /// Set when this process sends `.ready`; reset before each respawn.
    /// `inflight == None` with `!reached_ready` at reap distinguishes a
    /// startup failure from a clean post-shutdown exit.
    pub(crate) reached_ready: bool,
    /// Consecutive (re)spawns of this slot that exited before `.ready`;
    /// reset on `.ready`. Bounds the respawn loop in `reap_worker`.
    pub(crate) startup_failures: u8,
    /// Only files that take over a gigabyte are left, and one of them runs.
    pub(crate) waits_for_heavy_file_to_end: bool,
    /// `runner::first_loads` as of the last file that ran in this slot. The next process of the slot starts from there, as one process that ran all of them would.
    pub(crate) first_loads: Vec<u8>,
}

/// What `Worker::start` borrows from the `Coordinator`.
pub(crate) struct SpawnContext<'a> {
    pub(crate) vm: &'a VirtualMachine,
    pub(crate) cwd: &'a [u8],
    pub(crate) argv: bun_core::CStrList<'a>,
    pub(crate) envps: &'a [bun_core::CStringList],
    /// Windows hands it over as an inherited handle, which the worker's arguments name.
    #[cfg_attr(windows, expect(dead_code))]
    pub(crate) compiled_program: Option<bun_sys::Fd>,
    #[cfg(windows)]
    pub(crate) windows_job: Option<*mut c_void>,
}

impl Worker {
    /// Takes in what the worker has written to its output so far, without waiting for the event loop to find it. What a worker
    /// reports and what it prints come by different pipes, so a report can be read before the text that was written ahead of it,
    /// and the text would then be printed under no file, or under the next one.
    pub(crate) fn read_output_written_so_far(&mut self) {
        #[cfg(unix)]
        for descriptor in [self.out.get_fd(), self.err.get_fd()]
            .into_iter()
            .filter(|descriptor| descriptor.is_valid())
        {
            let mut chunk = [0u8; 16 * 1024];
            loop {
                let mut asked = [bun_sys::posix::PollFd {
                    fd: descriptor.native(),
                    events: bun_sys::posix::POLL_IN,
                    revents: 0,
                }];
                let is_readable = bun_sys::posix::poll(&mut asked, 0).is_ok_and(|count| count > 0)
                    && asked[0].revents & bun_sys::posix::POLL_IN != 0;
                if !is_readable {
                    break;
                }
                match bun_sys::read(descriptor, &mut chunk) {
                    Ok(count) if count > 0 => self.captured.extend_from_slice(&chunk[..count]),
                    _ => break,
                }
            }
        }
    }

    pub(crate) fn reset_pipes(&mut self) {
        self.ipc = Channel::default();
        self.out = BufferedReader::init();
        self.err = BufferedReader::init();
    }

    /// The caller counts the worker in `live_workers` on `Ok`.
    pub(crate) fn start(&mut self, coord: &SpawnContext<'_>) -> crate::Result<()> {
        debug_assert!(!self.alive);

        let ptr = (&raw mut *self).cast();
        for (kind, reader) in [(Kind::Stdout, &self.out), (Kind::Stderr, &self.err)] {
            let owner = Owner::with_kind(PollTag::TestParallelWorker, kind, ptr);
            // SAFETY: `owner` points to the worker that holds this reader. Coordinator holds the workers in a stable slice.
            unsafe { reader.set_owner(owner) };
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
            this.reset_pipes();
        });

        #[cfg(unix)]
        {
            // `.buffer` extra_fd creates an AF_UNIX socketpair; the parent end is
            // adopted into a usockets `Channel`.
            let compiled_program = coord.compiled_program.map(Stdio::Pipe);
            let options = SpawnOptions {
                stdin: Stdio::Ignore,
                stdout: Stdio::Buffer,
                stderr: Stdio::Buffer,
                extra_fds: core::iter::once(Stdio::Buffer)
                    .chain(compiled_program)
                    .collect(),
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
            let envp = coord.envps[this.idx as usize].as_list();
            let mut spawned =
                spawn::spawn_process(&options, coord.argv, Some(envp))?.map_err(|e| {
                    Output::err(e, "spawnProcess failed for test worker", ());
                    crate::Error::SpawnFailed
                })?;
            let stdout = spawned.stdout.take();
            let stderr = spawned.stderr.take();
            let extra_pipes = core::mem::take(&mut spawned.extra_pipes);
            this.process = Some(
                spawned.to_process_handle(bun_event_loop::EventLoopHandle::init(
                    coord.vm.event_loop_ptr(),
                )),
            );
            for (reader, file) in [(&this.out, stdout), (&this.err, stderr)] {
                if let Some(fd) = file.map(bun_sys::File::into_raw) {
                    let _ = reader
                        .start(this.event_loop.as_event_loop_ctx(), fd, true)
                        .map_err(|_| crate::Error::PipeStartFailed)?;
                }
            }
            let first = extra_pipes.into_iter().next();
            if let Some(pipe) = first.and_then(bun_spawn::ExtraPipe::into_owned) {
                // adopt() mutates the loop's socket context via interior mutability on the C side.
                if !this.ipc.adopt(coord.vm, pipe) {
                    return Err(crate::Error::ChannelAdoptFailed);
                }
            } else {
                this.ipc.done.set(true);
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
            let options = SpawnOptions {
                stdin: Stdio::Ignore,
                stdout: Stdio::Buffer,
                stderr: Stdio::Buffer,
                extra_fds: Box::new([Stdio::Ipc]),
                cwd: coord.cwd.to_vec().into_boxed_slice(),
                windows: spawn::WindowsOptions {
                    loop_: jsc::EventLoopHandle::init(coord.vm.event_loop_ptr()),
                    ..Default::default()
                },
                stream: true,
                ..Default::default()
            };
            let envp = coord.envps[this.idx as usize].as_list();
            let mut spawned =
                spawn::spawn_process(&options, coord.argv, Some(envp))?.map_err(|e| {
                    Output::err(e, "spawnProcess failed for test worker", ());
                    crate::Error::SpawnFailed
                })?;
            this.process = Some(spawned.to_process_handle(coord.vm.event_loop()));

            if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stdout.take() {
                this.out
                    .start_with_pipe(pipe)
                    .map_err(|_| crate::Error::PipeStartFailed)?;
            }
            if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stderr.take() {
                this.err
                    .start_with_pipe(pipe)
                    .map_err(|_| crate::Error::PipeStartFailed)?;
            }
            let spawn::WindowsStdioResult::Buffer(ipc_pipe) = spawned.extra_pipes[0].take() else {
                unreachable!("Stdio::Ipc makes a pipe");
            };
            if !this.ipc.adopt_pipe(ipc_pipe) {
                return Err(crate::Error::ChannelAdoptFailed);
            }
        }

        let process = this.process.as_ref().expect("set above").this_ptr();
        #[cfg(windows)]
        {
            if let Some(job) = coord.windows_job {
                if let Some(handle) = process.os_handle() {
                    // SAFETY: FFI call; handles are valid (just spawned).
                    unsafe {
                        let _ = bun_sys::windows::AssignProcessToJobObject(job, handle);
                    }
                }
            }
        }
        this.alive = true;
        // SAFETY: `this` is the live `Box<Worker>` slot in
        // `Coordinator.workers`; it outlives `process`.
        process.set_exit_handler(unsafe {
            bun_spawn::ProcessExit::new(
                bun_spawn::ProcessExitKind::TestParallelWorker,
                &raw mut **this,
            )
        });
        match Process::watch_or_reap(process) {
            Ok(_) => {}
            Err(e) => {
                // Resource cleanup is handled by the function-scope errdefer.
                this.alive = false;
                Output::err(e, "watchOrReap failed for test worker", ());
                return Err(crate::Error::ProcessWatchFailed);
            }
        }

        // Disarm the errdefer cleanup on success.
        let _ = scopeguard::ScopeGuard::into_inner(this);
        Ok(())
    }

    pub(crate) fn on_io(&mut self, kind: Kind, event: IoEvent) {
        let reader = match kind {
            Kind::Stdout => &self.out,
            Kind::Stderr => &self.err,
        };
        let event_loop = self.event_loop.as_event_loop_ctx();
        // Ignored: `on_process_exit` ends the worker.
        let _ = reader.read_chunks(event_loop, Some(event), |chunk, _| {
            self.captured.extend_from_slice(&chunk);
            true
        });
    }

    pub(crate) fn on_process_exit(&mut self, status: Status, rusage: &Rusage) {
        self.alive = false;
        self.peak_rss_mb = (self.peak_rss_mb).max((rusage.maxrss() / (1024.0 * 1024.0)) as u32);
        self.exit_status = Some(status);
    }

    /// The end of the channel can arrive ahead of the exit.
    pub(crate) fn can_take_work(&self) -> bool {
        self.alive && !self.ipc.done.get()
    }

    pub(crate) fn dispatch(
        &mut self,
        f: &mut Frame,
        file_idx: u32,
        file: &[u8],
        is_growth_written: bool,
    ) {
        f.begin(frame::Kind::Run);
        f.u32(file_idx);
        f.str(file);
        f.str(&self.first_loads);
        f.u32(u32::from(is_growth_written));
        self.ipc.send(f.finish());
        self.inflight = Some(file_idx);
        self.dispatched_at = bun_core::time::milli_timestamp();
    }

    pub(crate) fn shutdown(&mut self, f: &mut Frame) {
        f.begin(frame::Kind::Shutdown);
        self.ipc.send(f.finish());
        // Leave the channel open so the reader drains trailing
        // repeat_bufs / coverage_file frames; the worker exits on
        // `.shutdown` and its exit closes the peer end.
    }
}

bun_spawn::link_impl_ProcessExit! {
    TestParallelWorker for Worker => |this| {
        on_process_exit(status, rusage) => (*this).on_process_exit(status, rusage),
    }
}
