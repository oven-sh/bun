//! One spawned `bun test --test-worker --isolate` process plus its three
//! pipes. Tightly coupled with `Coordinator` (which owns the worker slice and
//! routes IPC frames); this file holds only the per-process state and the
//! spawn/dispatch/shutdown mechanics.

#[cfg(windows)]
use std::os::windows::io::{AsHandle, OwnedHandle};

use crate::api::bun::process::{
    self as spawn, Process, Rusage, SpawnOptions, SpawnResultExt as _, Status, Stdio,
};
use bun_core::{self, Output};
use bun_io::max_buf::Kind;
use bun_io::{BufferedReader, IoEvent, Owner, PollTag};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_spawn::RusageFields as _;

use super::channel::Channel;
use super::frame::{self, Frame};

pub(crate) struct Worker {
    pub(crate) event_loop: bun_jsc::EventLoopHandle,
    pub(crate) idx: u32,
    pub(crate) process: Option<spawn::ProcessHandle>,

    /// Bidirectional IPC over fd 3. POSIX: usockets adopted from a socketpair.
    /// Windows: the parent end of a duplex pipe.
    /// Commands and results both flow through this channel; backpressure is
    /// handled by the loop, so a busy worker writing thousands of `test_done`
    /// frames never truncates and the coordinator never blocks.
    pub(crate) ipc: Channel,
    pub(crate) out: BufferedReader,
    pub(crate) err: BufferedReader,

    /// Worker stdout+stderr since the last `test_done`. Flushed atomically
    /// under the right file header so concurrent files don't interleave.
    pub(crate) captured: Vec<u8>,
    pub(crate) alive: bool,
    /// Highest peak RSS among this slot's exited processes.
    pub(crate) peak_rss_mb: u32,
    /// Consecutive (re)spawns of this slot that exited before `.ready`;
    /// reset on `.ready`. Bounds the respawn loop in `reap_worker`.
    pub(crate) startup_failures: u8,
    /// `runner::first_loads` as of the last file that ran in this slot. The next process of the slot starts from there, as one process that ran all of them would.
    pub(crate) first_loads: Vec<u8>,
}

/// What every `Worker::start` of a run needs.
pub(crate) struct SpawnContext<'a> {
    pub(crate) vm: &'a VirtualMachine,
    pub(crate) cwd: &'a [u8],
    pub(crate) argv: bun_core::CStrList<'a>,
    pub(crate) envps: &'a [bun_core::CStringList],
    /// Windows hands it over as an inherited handle, which the worker's arguments name.
    pub(crate) compiled_program: Option<bun_sys::Fd>,
    #[cfg(windows)]
    pub(crate) windows_job: Option<&'a OwnedHandle>,
}

impl Worker {
    /// Takes in what the worker has written to its output so far, without waiting for the event loop to find it. What a worker
    /// reports and what it prints come by different pipes, so a report can be read before the text that was written ahead of it,
    /// and the text would then be printed under no file, or under the next one.
    pub(crate) fn read_output_written_so_far(&mut self) {
        #[cfg(windows)]
        for kind in [Kind::Stdout, Kind::Stderr] {
            let reader = if kind == Kind::Stdout {
                &self.out
            } else {
                &self.err
            };
            if let Some(event) = reader.take_available() {
                self.on_io(kind, event);
            }
        }
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

    /// On `Err` it has neither a process nor pipes.
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

        let options = SpawnOptions {
            stdin: Stdio::Ignore,
            stdout: Stdio::Buffer,
            stderr: Stdio::Buffer,
            extra_fds: core::iter::once(Stdio::Buffer)
                .chain(
                    coord
                        .compiled_program
                        .map(Stdio::Pipe)
                        .filter(|_| cfg!(unix)),
                )
                .collect(),
            cwd: coord.cwd.to_vec().into_boxed_slice(),
            stream: true,
            // Own pgrp so abortAll can kill(-pid, SIGTERM) the worker and
            // anything it spawned. PDEATHSIG is the SIGKILL safety net on
            // Linux for the worker itself.
            new_process_group: true,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            linux_pdeathsig: Some(libc::SIGKILL as u8),
            #[cfg(windows)]
            job: coord.windows_job.map(AsHandle::as_handle),
            #[cfg(windows)]
            inherited_handle: coord.compiled_program.map(bun_sys::Fd::native),
            ..Default::default()
        };
        let envp = coord.envps[this.idx as usize].as_list();
        let mut spawned = spawn::spawn_process(&options, coord.argv, Some(envp))?.map_err(|e| {
            Output::err(e, "spawnProcess failed for test worker", ());
            crate::Error::SpawnFailed
        })?;
        let stdout = spawned.stdout.take();
        let stderr = spawned.stderr.take();
        let channel = spawned.extra_pipes.swap_remove(0).into_owned();
        this.process = Some(spawned.to_process_handle(this.event_loop));
        for (reader, pipe) in [(&this.out, stdout), (&this.err, stderr)] {
            if let Some(pipe) = pipe {
                let _ = reader
                    .start_own_pipe(this.event_loop.as_event_loop_ctx(), pipe)
                    .map_err(|_| crate::Error::PipeStartFailed)?;
            }
        }
        if !channel.is_some_and(|end| this.ipc.adopt_own(coord.vm, end)) {
            return Err(crate::Error::ChannelAdoptFailed);
        }

        let process = this.process.as_ref().expect("set above").this_ptr();
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

    pub(crate) fn on_process_exit(&mut self, rusage: &Rusage) {
        self.alive = false;
        self.peak_rss_mb = (self.peak_rss_mb).max((rusage.maxrss() / (1024.0 * 1024.0)) as u32);
    }

    /// The end of the channel can arrive ahead of the exit.
    pub(crate) fn can_take_work(&self) -> bool {
        self.alive && !self.ipc.done.get()
    }

    /// Lets go of the process once it has exited and all that it sent has been read.
    pub(crate) fn take_exit(&mut self) -> Option<(bun_spawn::PidT, Status)> {
        let process = self.process.as_ref()?;
        let status = process.status().filter(|_| self.ipc.done.get())?;
        let exit = (process.pid, status.clone());
        self.process = None;
        Some(exit)
    }

    pub(crate) fn dispatch(
        &self,
        f: &mut Frame,
        file_idx: usize,
        file: &[u8],
        is_growth_written: bool,
    ) {
        f.begin(frame::Kind::Run);
        f.u32(file_idx as u32);
        f.str(file);
        f.str(&self.first_loads);
        f.u32(u32::from(is_growth_written));
        self.ipc.send(f.finish());
    }

    pub(crate) fn shutdown(&self, f: &mut Frame) {
        f.begin(frame::Kind::Shutdown);
        self.ipc.send(f.finish());
        // Leave the channel open so the reader drains trailing
        // repeat_bufs / coverage_file frames; the worker exits on
        // `.shutdown` and its exit closes the peer end.
    }
}

bun_spawn::link_impl_ProcessExit! {
    TestParallelWorker for Worker => |this| {
        on_process_exit(_status, rusage) => (*this).on_process_exit(rusage),
    }
}
