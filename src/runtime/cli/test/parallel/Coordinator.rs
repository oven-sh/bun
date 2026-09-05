//! Process-pool coordinator for `bun test --parallel`. Owns the worker slice,
//! drives the event loop, routes IPC frames to per-test output, and handles
//! crash accounting / panic-abort / bail / lazy scale-up. Construction and
//! the run loop entry live in `runner.rs`; this file is the per-run state
//! and its methods.

use core::ffi::c_void;
#[cfg(unix)]
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicBool, Ordering};
use std::io::Write as _;

use bun_core::strings;
use bun_core::{Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::Interned;

use super::file_range::FileRange;
use super::frame::{self, Frame};
use super::worker::{Worker, WorkerPipe};
use crate::test_command::CommandLineReporter;

// `Status` lives in `crate::api::bun::process`
// (not the lower-tier `bun_spawn` crate). Worker.exit_status is this type.
use crate::api::bun::process::Status as SpawnStatus;

pub struct Coordinator<'a> {
    pub(crate) vm: &'a VirtualMachine,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub(crate) event_loop_handle: bun_jsc::EventLoopHandle,
    pub(crate) reporter: &'a mut CommandLineReporter,
    pub(crate) files: Vec<Interned>,
    /// `--changed-first`: head of `files` that every worker drains before
    /// touching its own `range`. Empty when the flag was not passed.
    pub(crate) priority: FileRange,
    /// `--timings`: recorded cost per `files` index; stealing then goes by remaining time and takes the victim's slowest file.
    pub(crate) costs: Option<Vec<u64>>,
    pub(crate) cwd: &'a [u8],
    // [:null]?[*:0]const u8 — null-sentinel-terminated slice of C strings;
    // backing storage has a null at [len] for execve-style consumers.
    pub(crate) argv: Box<[bun_spawn::CStrPtr]>,
    /// One envp per worker slot — same base, with that slot's JEST_WORKER_ID
    /// and BUN_TEST_WORKER_ID appended.
    pub(crate) envps: Vec<bun_dotenv::NullDelimitedEnvMap>,

    pub(crate) workers: &'a mut [Worker],
    /// Per file index, when a structured reporter (JUnit) is configured: the
    /// `TestDone` records received for it, replayed in file order at the end
    /// so the document matches a serial run. Empty otherwise.
    pub(crate) test_records: Vec<FileTestRecords>,
    /// Per source path: coverage folded across every worker that loaded it.
    pub(crate) coverage_files:
        bun_collections::StringArrayHashMap<bun_sourcemap_jsc::code_coverage::MergedReport>,
    /// File index whose `path:` header was most recently written. Result lines
    /// from concurrent workers interleave; whenever the source file changes the
    /// header is re-emitted so every line has visible context. None at start.
    pub(crate) last_header_idx: Option<u32>,
    pub frame: Frame,
    pub(crate) parallel_limit: u32,
    pub(crate) scale_up_after_ms: i64,
    pub(crate) bail: u32,
    pub(crate) dots: bool,
    pub(crate) files_done: u32,
    pub(crate) spawned_count: u32,
    pub(crate) live_workers: u32,
    pub(crate) crashed_files: Vec<u32>,
    pub(crate) aborted: Option<u32>,
    pub(crate) stop_reason: Option<StopReason>,
    pub(crate) last_printed_dot: bool,
    /// Kill-on-close Job Object so the OS reaps workers if the coordinator dies
    /// without running its signal handler (e.g. SIGKILL / TerminateProcess).
    #[cfg(windows)]
    pub(crate) windows_job: Option<*mut c_void>,
}

#[derive(Default)]
pub(crate) struct FileTestRecords {
    /// `TestDone` payloads past the formatted line; see `runner::decode_test_case`.
    pub(crate) tests: Vec<Box<[u8]>>,
    pub(crate) elapsed_ns: u64,
}

/// Consecutive pre-`.ready` exits a worker slot tolerates before the slot
/// stops respawning.
const MAX_STARTUP_FAILURES: u8 = 2;

/// Why the run stopped dispatching files. A worker panic overrides `Bail`
/// (see `abort_on_worker_panic`); nothing clears it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum StopReason {
    /// `--bail=N` reached: idle workers are shut down, inflight files finish.
    Bail,
    /// A worker died of a crash signal and every other worker was terminated,
    /// so the siblings' inflight files are collateral, not crashes of their own.
    WorkerPanicked,
}

impl<'a> Coordinator<'a> {
    fn is_done(&self) -> bool {
        (self.files_done as usize >= self.files.len() || self.stop_reason.is_some())
            && self.live_workers == 0
    }

    fn has_undispatched_files(&self) -> bool {
        if !self.priority.is_empty() {
            return true;
        }
        for w in self.workers.iter() {
            if !w.range.is_empty() {
                return true;
            }
        }
        false
    }

    /// The worker (spawned or not) whose range has the most files remaining.
    fn find_steal_victim(&mut self) -> Option<*mut Worker> {
        // Callers (assign_work) hold a live `&mut Worker` pointing
        // into `self.workers`. `iter_mut()` would materialize a second
        // `&mut Worker` for that same slot — instant UB under Stacked Borrows
        // regardless of what the loop body does. Iterate via raw pointers
        // instead.
        let mut victim: Option<*mut Worker> = None;
        let mut most: u64 = 0;
        let base: *mut Worker = self.workers.as_mut_ptr();
        let len = self.workers.len();
        for i in 0..len {
            // SAFETY: `i < len`; read-only inspection of `range` through *mut.
            let v = unsafe { base.add(i) };
            // SAFETY: `v = base.add(i)` with `i < len` is in-bounds for
            // `self.workers`; field read through *mut so no `&mut Worker` is
            // formed that could alias the caller's live `w`.
            let r = unsafe { (*v).range };
            let n: u64 = match &self.costs {
                Some(c) => c[r.lo as usize..r.hi as usize].iter().sum(),
                None => u64::from(r.len()),
            };
            if n > most {
                most = n;
                victim = Some(v);
            }
        }
        victim
    }

    pub(crate) fn drive(&mut self) {
        let _ = self.spawn_worker();
        self.run_pending_reaps();
        while !self.is_done() {
            if abort_handler::SHOULD_ABORT.load(Ordering::Acquire) {
                self.abort_all();
                return;
            }
            self.vm.event_loop_ref().tick();
            self.run_pending_reaps();
            self.maybe_scale_up();
            self.run_pending_reaps();
            if self.is_done() {
                break;
            }
            if self.spawned_count < self.parallel_limit
                && self.has_undispatched_files()
                && self.stop_reason.is_none()
            {
                // Bound the wait so we wake to scale up even if no I/O arrives.
                const MS_PER_S: i64 = bun_core::time::MS_PER_S as i64;
                let ts = bun_core::Timespec {
                    sec: self.scale_up_after_ms / MS_PER_S,
                    nsec: (self.scale_up_after_ms % MS_PER_S) * bun_core::time::NS_PER_MS as i64,
                };
                // SAFETY: event_loop()/usockets_loop() return live pointers for the VM lifetime.
                unsafe {
                    (*(*self.vm.event_loop()).usockets_loop())
                        .tick_with_timeout(Some(&ts), bun_uws::NOW_NS_UNKNOWN);
                }
            } else {
                self.vm.event_loop_ref().auto_tick();
            }
            self.run_pending_reaps();
        }
    }

    /// SIGINT/SIGTERM: terminate every worker (and its descendants) and exit.
    /// Workers run in their own process group, so kill(-pid, SIGTERM) reaches
    /// everything they spawned. Kernel-level safety nets cover the case where
    /// the coordinator can't run this (SIGKILL): PDEATHSIG on Linux,
    /// kill-on-close Job Object on Windows. macOS has neither; the process
    /// group kill here plus stdin EOF in the worker loop is the best effort.
    fn abort_all(&mut self) {
        abort_handler::uninstall();
        let now = bun_core::time::milli_timestamp();
        let workers = &self.workers[..self.spawned_count as usize];
        let running: Vec<(u32, i64)> = workers
            .iter()
            .filter_map(|w| w.inflight.map(|idx| (idx, now - w.dispatched_at)))
            .collect();
        for (idx, ms) in &running {
            self.reporter.summary().fail += 1;
            self.reporter.summary().files += 1;
            self.mark_crashed(*idx, *ms);
            self.files_done += 1;
        }
        if !running.is_empty() {
            bun_core::pretty_errorln!("<r>\n<red>Interrupted<r> while still running:");
            for (idx, running_ms) in &running {
                bun_core::pretty_errorln!(
                    "  {} <d>({}s)<r>",
                    bstr::BStr::new(self.rel_path(*idx)),
                    running_ms / 1000
                );
            }
            let not_started: u32 =
                self.priority.len() + self.workers.iter().map(|w| w.range.len()).sum::<u32>();
            if not_started > 0 {
                bun_core::pretty_errorln!("{} file(s) had not started:", not_started);
                for idx in self.priority.lo..self.priority.hi {
                    bun_core::pretty_errorln!("  {}", bstr::BStr::new(self.rel_path(idx)));
                }
                for w in self.workers.iter() {
                    for idx in w.range.lo..w.range.hi {
                        bun_core::pretty_errorln!("  {}", bstr::BStr::new(self.rel_path(idx)));
                    }
                }
            }
            Output::flush();
        }
        for w in self.workers[..self.spawned_count as usize].iter_mut() {
            if let Some(p) = &w.process {
                #[cfg(unix)]
                {
                    // SAFETY: FFI call; -pid targets the worker's process group.
                    unsafe {
                        let _ = libc::kill(-(p.pid as libc::pid_t), libc::SIGTERM);
                    }
                }
                #[cfg(not(unix))]
                {
                    // SIGKILL → TerminateProcess; libuv-win ENOSYSes signals
                    // other than SIGQUIT/SIGTERM/SIGKILL/SIGINT.
                    let _ = p.kill(9);
                }
            }
        }
        self.aborted = Some(130);
    }

    fn spawn_worker(&mut self) -> bool {
        debug_assert!(self.spawned_count < self.parallel_limit);
        let w = &mut self.workers[self.spawned_count as usize];
        // A prior failed start()'s errdefer leaves ipc.done = true; reset so a
        // retry on the same slot starts with a fresh channel.
        w.ipc = Default::default();
        // Intrusive backref (raw ptr).
        // Built via from_mut so the stored `*const` carries write provenance:
        // WorkerPipe::on_read_chunk later mutates the Worker through cast_mut().
        let w_ptr = std::ptr::from_mut::<Worker>(w).cast_const();
        w.out = WorkerPipe::new(w_ptr);
        w.err = WorkerPipe::new(w_ptr);
        match w.start() {
            Ok(()) => {}
            Err(e) => {
                Output::err(e, "failed to spawn test worker", ());
                if self.live_workers == 0 {
                    Global::exit(1);
                }
                return false;
            }
        }
        self.spawned_count += 1;
        true
    }

    /// Once every live worker has been busy for at least `scale_up_after_ms`,
    /// spawn the remaining workers. A suite of trivially fast files therefore
    /// runs on one worker with zero spawn overhead; the first slow file
    /// triggers full scale-up so longer suites aren't staircased.
    fn maybe_scale_up(&mut self) {
        if self.spawned_count >= self.parallel_limit {
            return;
        }
        if self.stop_reason.is_some() || !self.has_undispatched_files() {
            return;
        }
        let now = bun_core::time::milli_timestamp();
        for w in self.workers[..self.spawned_count as usize].iter() {
            if !w.alive {
                continue;
            }
            if w.inflight.is_none() {
                return;
            }
            if now - w.dispatched_at < self.scale_up_after_ms {
                return;
            }
        }
        let want = self
            .parallel_limit
            .min(u32::try_from(self.files.len()).unwrap() - self.files_done);
        while self.spawned_count < want {
            // On failure, leave the slot unconsumed so the next drive() tick
            // can retry; don't loop here or a hard spawn error would spin.
            if !self.spawn_worker() {
                break;
            }
        }
    }

    fn assign_work(&mut self, w: &mut Worker) {
        if self.stop_reason.is_some() {
            return w.shutdown();
        }
        if let Some(idx) = self.priority.pop_front() {
            return w.dispatch(idx, self.files[idx as usize].as_bytes());
        }
        if let Some(idx) = w.range.pop_front() {
            return w.dispatch(idx, self.files[idx as usize].as_bytes());
        }
        // Steal the back half of the largest remaining range as a contiguous
        // block. The thief walks it forward via popFront, so both workers keep
        // directory locality and total steals are O(K log N) instead of O(N).
        // Stealing from not-yet-spawned workers is fine — their range is just
        // an unclaimed reservation.
        // Reshaped for borrowck — find_steal_victim returns *mut so
        // we can borrow `w` and the victim disjointly.
        if let Some(v_ptr) = self.find_steal_victim() {
            // SAFETY: v_ptr points into self.workers. `w` cannot be the victim:
            // `w.range` is empty here (pop_front just returned None) while the
            // victim has the largest *non-empty* range, so `v_ptr != w` and the
            // two `&mut Worker` are disjoint. find_steal_victim itself iterates
            // via raw pointers and never forms a `&mut Worker` for `w`'s slot.
            let v = unsafe { &mut *v_ptr };
            if self.costs.is_some() {
                if let Some(idx) = v.range.pop_front() {
                    return w.dispatch(idx, self.files[idx as usize].as_bytes());
                }
            } else if let Some(stolen) = v.range.steal_back_half() {
                w.range = stolen;
                if let Some(idx) = w.range.pop_front() {
                    return w.dispatch(idx, self.files[idx as usize].as_bytes());
                }
            }
        }
        w.shutdown();
    }

    fn bail_out(&mut self) {
        if self.stop_reason.is_some() {
            return;
        }
        self.stop_reason = Some(StopReason::Bail);
        self.break_dots();
        bun_core::pretty_error!(
            "\nBailed out after {} failure{}<r>\n",
            self.bail,
            if self.bail == 1 { "" } else { "s" }
        );
        Output::flush();
        // Reachable from on_frame/account_crash with the caller's
        // `w: &mut Worker` still live and used afterward; iter_mut() here
        // would create a second `&mut Worker` for `w`'s slot (UB). Iterate
        // via raw pointers.
        let base: *mut Worker = self.workers.as_mut_ptr();
        let n = self.spawned_count as usize;
        for i in 0..n {
            // SAFETY: `i < spawned_count <= workers.len()`; access through
            // *mut so no `&mut Worker` aliases the caller's `w`.
            unsafe {
                let other = base.add(i);
                if (*other).alive && (*other).inflight.is_none() {
                    (*other).shutdown();
                }
            }
        }
    }

    fn record_timing(&mut self, file_idx: u32, dispatched_at: i64) {
        if let Some(t) = self.reporter.timings.as_mut() {
            t.record_since(self.files[file_idx as usize].as_bytes(), dispatched_at);
        }
    }

    pub(crate) fn rel_path(&self, file_idx: u32) -> &[u8] {
        bun_paths::resolve_path::relative(
            bun_paths::fs::FileSystem::instance().top_level_dir(),
            self.files[file_idx as usize].as_bytes(),
        )
    }

    fn ensure_header(&mut self, file_idx: u32) {
        if self.last_header_idx == Some(file_idx) {
            return;
        }
        self.end_group();
        self.last_header_idx = Some(file_idx);
        let file_prefix: &[u8] = if Output::is_github_action() {
            b"::group::"
        } else {
            b""
        };
        let mut header: Vec<u8> = Vec::with_capacity(64);
        let _ = write!(
            header,
            "\n{}{}:\n",
            bstr::BStr::new(file_prefix),
            bstr::BStr::new(self.rel_path(file_idx))
        );
        let _ = Output::error_writer().write_all(&header);
    }

    pub(crate) fn end_group(&mut self) {
        if self.last_header_idx.take().is_some() && Output::is_github_action() {
            let _ = Output::error_writer().write_all(b"\n::endgroup::\n");
        }
    }

    fn break_dots(&mut self) {
        if self.last_printed_dot {
            let _ = Output::error_writer().write_all(b"\n");
            self.last_printed_dot = false;
        }
    }

    fn flush_captured(&mut self, w: &mut Worker) {
        if w.captured.is_empty() {
            return;
        }
        self.break_dots();
        if let Some(idx) = w.inflight {
            self.ensure_header(idx);
        }
        let _ = Output::error_writer().write_all(&w.captured);
        if !strings::ends_with_char(&w.captured, b'\n') {
            let _ = Output::error_writer().write_all(b"\n");
        }
        w.captured.clear();
    }

    pub(crate) fn on_frame(&mut self, w: &mut Worker, kind: frame::Kind, rd: &mut frame::Reader) {
        match kind {
            frame::Kind::Ready => {
                w.reached_ready = true;
                w.startup_failures = 0;
                self.assign_work_or_retry(w);
            }
            frame::Kind::FileStart => {
                let _ = rd.u32();
            }
            frame::Kind::TestDone => {
                let idx = rd.u32();
                let formatted = rd.str();
                if w.inflight != Some(idx) {
                    return;
                }
                if let Some(file) = self.test_records.get_mut(idx as usize) {
                    file.tests.push(Box::from(rd.p));
                }
                self.flush_captured(w);
                if formatted.is_empty() {
                    return; // e.g. pass under --only-failures
                }
                // dots-mode failures print a full line (writeTestStatusLine);
                // dots themselves are unterminated.
                let is_dot = self.dots && !strings::ends_with_char(formatted, b'\n');
                if !is_dot {
                    self.break_dots();
                    self.ensure_header(idx);
                }
                let _ = Output::error_writer().write_all(formatted);
                self.last_printed_dot = is_dot;
                Output::flush();
            }
            frame::Kind::FileDone => {
                let mut nums = [0u32; 9];
                for n in nums.iter_mut() {
                    *n = rd.u32();
                }
                let [
                    idx,
                    pass,
                    fail,
                    skip,
                    todo,
                    expectations,
                    skipped_label,
                    files,
                    unhandled,
                ] = nums;
                if let Some(file) = self.test_records.get_mut(idx as usize) {
                    file.elapsed_ns = rd.u64();
                }

                self.flush_captured(w);
                if self.last_header_idx == Some(idx) {
                    self.end_group();
                }

                // A worker can write file_done and crash before the coordinator
                // reads the frame; onWorkerExit() will already have called
                // accountCrash() and cleared inflight. Ignore the buffered frame
                // so we don't double-count.
                if w.inflight != Some(idx) {
                    return;
                }

                // Reshaped for borrowck — `summary()` mutably borrows
                // `self.reporter`, so the unhandled-errors counter (also on
                // `self.reporter.jest`) and `bail_out()` must run after the
                // summary borrow is released.
                {
                    let summary = self.reporter.summary();
                    summary.pass += pass;
                    summary.fail += fail;
                    summary.skip += skip;
                    summary.todo += todo;
                    summary.expectations += expectations;
                    summary.skipped_because_label += skipped_label;
                    summary.files += files;
                }
                self.reporter.jest.unhandled_errors_between_tests += unhandled;
                self.record_timing(idx, w.dispatched_at);

                w.inflight = None;
                self.files_done += 1;
                let fail_now = self.reporter.summary().fail;
                if self.bail > 0 && fail_now >= self.bail {
                    self.bail_out();
                }
                // A dead worker can deliver a buffered file_done during the
                // pre-reap drain; don't dispatch into it (stdin is gone, the
                // file index would be consumed and skipped). reapWorker()
                // handles the next dispatch via respawn.
                if w.alive {
                    self.assign_work(w);
                }
            }
            frame::Kind::RepeatBufs => {
                // Unrolled because an array of disjoint &mut fields needs
                // explicit splitting.
                self.reporter
                    .failures_to_repeat_buf
                    .extend_from_slice(rd.str());
                self.reporter
                    .skips_to_repeat_buf
                    .extend_from_slice(rd.str());
                self.reporter
                    .todos_to_repeat_buf
                    .extend_from_slice(rd.str());
            }
            frame::Kind::CoverageFile => {
                use bun_sourcemap_jsc::code_coverage::wire;
                // fd 3 is writable from test JS, so a frame that doesn't
                // decode is dropped rather than trusted.
                if let Some(report) = wire::decode(rd.str()) {
                    let merged =
                        bun_core::handle_oom(self.coverage_files.get_or_put(&report.source_url));
                    bun_core::handle_oom(merged.value_ptr.add(&report));
                }
            }
            frame::Kind::Run | frame::Kind::Shutdown => {}
        }
    }

    pub(crate) fn on_worker_exit(&mut self, w: &mut Worker, status: SpawnStatus) {
        w.exit_status = Some(status);
        // The Channel delivers any remaining buffered data then close (which
        // sets ipc.done and calls tryReap), so no explicit drain is needed —
        // tryReap here covers the case where the channel already closed first.
        self.try_reap(w);
    }

    pub(crate) fn try_reap(&mut self, w: &mut Worker) {
        if w.exit_status.is_none() || !w.ipc.done.get() {
            return;
        }
        w.reap_pending = true;
    }

    fn run_pending_reaps(&mut self) {
        let n = self.spawned_count as usize;
        for i in 0..n {
            // SAFETY: `i < spawned_count <= workers.len()`. `base` is re-derived
            // each iteration: `reap_worker`'s slot walks (`as_mut_ptr` in the
            // abort paths) retag the buffer, popping any earlier derivation.
            let w: *mut Worker = unsafe { self.workers.as_mut_ptr().add(i) };
            // SAFETY: `w` is a live slot; short place accesses only.
            let status = unsafe {
                if !core::mem::take(&mut (*w).reap_pending) {
                    continue;
                }
                // SpawnStatus is not Copy (Err arm owns a path); take()
                // instead of pattern-match-by-copy.
                (*w).exit_status
                    .take()
                    .expect("reap_pending set only after exit_status")
            };
            self.reap_worker(i, &status);
        }
    }

    fn reap_worker(&mut self, slot: usize, status: &SpawnStatus) {
        // SAFETY: `slot < spawned_count <= workers.len()`; fresh root derivation, like each reborrow below.
        let w = unsafe { &mut *self.workers.as_mut_ptr().add(slot) };
        // Decrement here (not in onProcessExit) so drive() keeps pumping until
        // the IPC pipe has been drained and this reap actually runs.
        self.live_workers -= 1;
        self.flush_captured(w);
        // Exited before the IPC handshake. `inflight` is None for these, so
        // the mid-file handling below never fires; the per-slot cap is what
        // bounds the respawn loop.
        let startup_failure = w.inflight.is_none() && !w.reached_ready;
        let worker_idx = w.idx;
        if let Some(idx) = w.inflight {
            self.break_dots();
            self.ensure_header(idx);
            // A worker dying mid-file is never silently retried. If a test
            // intentionally exits (process.exit) that file is marked failed
            // and the run continues in a fresh worker. If the worker was
            // killed by a fatal signal — SIGABRT from Bun's own panic handler
            // or a JSC/WTF assertion, SIGSEGV/SIGBUS/SIGFPE/SIGILL from native
            // code — or died with the Windows NTSTATUS equivalent, that's a
            // Bun or addon bug and must not be
            // masked by the rest of the suite passing: abort the whole run so
            // the exit status reflects the crash. SIGKILL is treated as a
            // regular failure (commonly the OOM killer or the user). When the
            // kill was ours (`Worker::on_channel_done`, corrupt IPC stream),
            // the status says nothing the user can act on; report the cause.
            let panicked = is_panic_status(status);
            if self.stop_reason == Some(StopReason::WorkerPanicked) && !panicked {
                self.account_unfinished(idx, b"aborted: sibling worker panicked");
            } else {
                self.record_timing(idx, w.dispatched_at);
                if w.ipc.corrupt_frame.get() && !panicked {
                    self.account_crash(
                        idx,
                        w.dispatched_at,
                        format_args!("worker killed: corrupt IPC frame, something wrote to fd 3"),
                    );
                } else {
                    let mut buf = [0u8; 32];
                    self.account_crash(
                        idx,
                        w.dispatched_at,
                        format_args!(
                            "worker crashed: {}",
                            bstr::BStr::new(describe_status(&mut buf, status))
                        ),
                    );
                }
            }
            Output::flush();
            // SAFETY: fresh root derivation — `account_crash` can reach `bail_out`, which retags the slots.
            let w = unsafe { &mut *self.workers.as_mut_ptr().add(slot) };
            w.inflight = None;
            if panicked {
                self.abort_on_worker_panic(idx, status);
            }
        } else if startup_failure {
            w.startup_failures += 1;
            // A crash signal during init aborts the whole run, same as a
            // mid-file crash.
            if is_panic_status(status) {
                self.abort_on_worker_startup_panic(status);
            }
        }

        // SAFETY: fresh derivation — `abort_on_worker_panic` above retags the slots.
        let w = unsafe { &mut *self.workers.as_mut_ptr().add(slot) };
        w.process = None;
        let startup_failures = w.startup_failures;

        let can_respawn = self.stop_reason.is_none()
            && startup_failures < MAX_STARTUP_FAILURES
            && self.has_undispatched_files();

        if startup_failure && self.stop_reason.is_none() {
            // A false `can_respawn` is benign when no work remains; only the
            // cap warrants the red error.
            self.break_dots();
            let mut buf = [0u8; 32];
            let desc = bstr::BStr::new(describe_status(&mut buf, status));
            if can_respawn {
                bun_core::pretty_error!(
                    "<r><yellow>warn<r>: test worker {} exited during startup ({}), retrying\n",
                    worker_idx + 1,
                    desc,
                );
            } else if startup_failures >= MAX_STARTUP_FAILURES {
                bun_core::pretty_error!(
                    "<r><red>error<r>: test worker {} exited during startup ({}) {} times\n",
                    worker_idx + 1,
                    desc,
                    startup_failures,
                );
            } else {
                bun_core::pretty_error!(
                    "<r><d>test worker {} exited during startup ({})<r>\n",
                    worker_idx + 1,
                    desc,
                );
            }
            Output::flush();
        }

        let mut respawned = false;
        if can_respawn {
            // SAFETY: fresh derivation — `has_undispatched_files` read the slots.
            let w = unsafe { &mut *self.workers.as_mut_ptr().add(slot) };
            w.ipc = Default::default();
            // from_mut: keep write provenance on the stored backref (see spawn_worker).
            let w_ptr = std::ptr::from_mut::<Worker>(w).cast_const();
            w.out = WorkerPipe::new(w_ptr);
            w.err = WorkerPipe::new(w_ptr);
            w.reached_ready = false;
            match w.start() {
                Ok(()) => {
                    respawned = true;
                }
                Err(e) => {
                    Output::err(e, "failed to respawn test worker", ());
                }
            }
        }

        if !respawned {
            if self.stop_reason.is_none() && self.live_workers == 0 {
                self.abort_queued_files(b"no live workers");
            }
            // Explicit early release: `w` is a borrowed slot in self.workers, so
            // Drop won't fire until Coordinator teardown. Assigning defaults
            // drops the old values now (pipe FDs, capture buffer).
            // SAFETY: fresh derivation — `abort_queued_files` may retag the slots.
            let w = unsafe { &mut *self.workers.as_mut_ptr().add(slot) };
            w.ipc = Default::default();
            w.out = WorkerPipe::new(core::ptr::null());
            w.err = WorkerPipe::new(core::ptr::null());
            let _ = core::mem::take(&mut w.captured);
        }
    }

    fn account_unfinished(&mut self, file_idx: u32, reason: &[u8]) {
        self.break_dots();
        bun_core::pretty_error!(
            "<r><red>✗<r> <b>{}<r> <d>({})<r>\n",
            bstr::BStr::new(self.rel_path(file_idx)),
            bstr::BStr::new(reason),
        );
        self.reporter.summary().fail += 1;
        self.reporter.summary().files += 1;
        self.files_done += 1;
    }

    fn mark_crashed(&mut self, file_idx: u32, elapsed_ms: i64) {
        self.crashed_files.push(file_idx);
        if let Some(file) = self.test_records.get_mut(file_idx as usize) {
            file.elapsed_ns = u64::try_from(elapsed_ms).unwrap_or(0) * bun_core::time::NS_PER_MS;
        }
    }

    fn account_crash(
        &mut self,
        file_idx: u32,
        dispatched_at: i64,
        detail: core::fmt::Arguments<'_>,
    ) {
        self.break_dots();
        bun_core::pretty_error!(
            "<r><red>✗<r> <b>{}<r> <d>({})<r>\n",
            bstr::BStr::new(self.rel_path(file_idx)),
            detail,
        );
        self.reporter.summary().fail += 1;
        self.reporter.summary().files += 1;
        self.mark_crashed(file_idx, bun_core::time::milli_timestamp() - dispatched_at);
        self.files_done += 1;
        if self.bail > 0 && self.reporter.summary().fail >= self.bail {
            self.bail_out();
        }
    }

    /// A worker was killed by a crash signal — treat this as a Bun bug, not
    /// a test failure. Print the panic banner (even if --bail already
    /// stopped the run), terminate every other worker, and mark all remaining
    /// files as aborted so the run ends immediately with a non-zero exit
    /// and the panic's stderr (already flushed via flushCaptured) is the
    /// last meaningful output, not buried under hundreds of later passes.
    fn abort_on_worker_panic(&mut self, file_idx: u32, status: &SpawnStatus) {
        self.break_dots();
        let mut buf = [0u8; 32];
        bun_core::pretty_error!(
            concat!(
                "\n<red>error<r>: a test worker process crashed with <b>{}<r> while running <b>{}<r>.\n",
                "This indicates a bug in Bun or in a native addon, not in the test itself. Aborting.\n",
            ),
            bstr::BStr::new(describe_status(&mut buf, status)),
            bstr::BStr::new(self.rel_path(file_idx)),
        );
        Output::flush();
        self.terminate_workers_after_panic(b"aborted: worker panicked");
    }

    /// `abort_on_worker_panic` for the pre-`.ready` case: no file was
    /// dispatched yet, so there is none to name.
    fn abort_on_worker_startup_panic(&mut self, status: &SpawnStatus) {
        self.break_dots();
        let mut buf = [0u8; 32];
        bun_core::pretty_error!(
            concat!(
                "\n<red>error<r>: a test worker process crashed with <b>{}<r> during startup.\n",
                "This indicates a bug in Bun or in a native addon, not in the test itself. Aborting.\n",
            ),
            bstr::BStr::new(describe_status(&mut buf, status)),
        );
        Output::flush();
        self.terminate_workers_after_panic(b"aborted: worker panicked during startup");
    }

    fn terminate_workers_after_panic(&mut self, sweep_reason: &'static [u8]) {
        // .shutdown() only takes effect between files, so a worker that's
        // mid-file would keep producing output after the panic banner.
        // Terminate the whole process group (same as the SIGINT path) so the
        // run ends now; reapWorker() will account each inflight file as a
        // crash when the exit arrives. Runs even if --bail already stopped
        // the run, since bailOut() only shutdown()s idle workers and would
        // leave inflight ones running past the banner.
        // Reachable from reap_worker with the caller's
        // `w: &mut Worker` still live and used afterward; iter_mut() would
        // create a second `&mut Worker` for `w`'s slot (UB). Iterate via raw
        // pointers.
        let base: *mut Worker = self.workers.as_mut_ptr();
        let n = self.spawned_count as usize;
        for i in 0..n {
            // SAFETY: `i < spawned_count <= workers.len()`; field reads
            // through *mut so no `&mut Worker` aliases the caller's `w`.
            let other = unsafe { base.add(i) };
            // SAFETY: `other` is in-bounds (see above); reading `.alive`
            // through *mut forms no `&mut Worker` aliasing the caller's `w`.
            if unsafe { !(*other).alive } {
                continue;
            }
            // SAFETY: `other` is in-bounds (see above); reading `.process`
            // through *mut forms no `&mut Worker` aliasing the caller's `w`.
            if let Some(p) = unsafe { &(*other).process } {
                #[cfg(unix)]
                {
                    // SAFETY: FFI call; -pid targets the worker's process group.
                    unsafe {
                        let _ = libc::kill(-(p.pid as libc::pid_t), libc::SIGTERM);
                    }
                }
                #[cfg(not(unix))]
                {
                    // SIGKILL → TerminateProcess (libuv-win ENOSYSes most
                    // signals, so e.g. kill(1) would leave the sibling running
                    // past the banner); it reaps as Signaled(9) →
                    // "aborted: sibling worker panicked".
                    let _ = p.kill(9);
                }
            }
        }
        // Overrides an earlier --bail stop so the siblings terminated above
        // reap as collateral; the queued files are only swept when this panic
        // is what stopped the run.
        let already_stopped = self.stop_reason.is_some();
        self.stop_reason = Some(StopReason::WorkerPanicked);
        if already_stopped {
            return;
        }
        self.abort_queued_files(sweep_reason);
    }

    /// Mark every not-yet-dispatched file as failed so `drive()` can exit
    /// instead of spinning when no live worker remains to make progress.
    fn abort_queued_files(&mut self, reason: &[u8]) {
        while let Some(idx) = self.priority.pop_front() {
            bun_core::pretty_error!(
                "<r><red>✗<r> <b>{}<r> <d>({})<r>\n",
                bstr::BStr::new(bun_paths::resolve_path::relative(
                    bun_paths::fs::FileSystem::instance().top_level_dir(),
                    self.files[idx as usize].as_bytes(),
                )),
                bstr::BStr::new(reason),
            );
            self.reporter.summary().fail += 1;
            self.reporter.summary().files += 1;
            self.files_done += 1;
        }
        // Reachable from reap_worker/abort_on_worker_panic with the
        // caller's `w: &mut Worker` still live and used afterward; iter_mut()
        // would create a second `&mut Worker` for `w`'s slot (UB). Iterate via
        // raw pointers.
        let base: *mut Worker = self.workers.as_mut_ptr();
        let len = self.workers.len();
        for i in 0..len {
            // SAFETY: `i < len`; range mutation through *mut so no
            // `&mut Worker` aliases the caller's live `w`.
            let wp = unsafe { base.add(i) };
            // SAFETY: `wp` is in-bounds (see above); mutating `.range` through
            // *mut forms no `&mut Worker` aliasing the caller's live `w`.
            while let Some(idx) = unsafe { (*wp).range.pop_front() } {
                bun_core::pretty_error!(
                    "<r><red>✗<r> <b>{}<r> <d>({})<r>\n",
                    // Reshaped for borrowck — inline rel_path body
                    // since `self.workers` is mutably borrowed.
                    bstr::BStr::new(bun_paths::resolve_path::relative(
                        bun_paths::fs::FileSystem::instance().top_level_dir(),
                        self.files[idx as usize].as_bytes(),
                    )),
                    bstr::BStr::new(reason),
                );
                self.reporter.summary().fail += 1;
                self.reporter.summary().files += 1;
                self.files_done += 1;
            }
        }
        Output::flush();
    }

    fn assign_work_or_retry(&mut self, w: &mut Worker) {
        // Kept as a separate entry point from assign_work so the .ready
        // handler has one call site; retry is gone but the indirection
        // costs nothing.
        self.assign_work(w);
    }

    #[cfg(windows)]
    pub(crate) fn create_windows_kill_on_close_job() -> Option<*mut c_void> {
        use bun_sys::windows;
        // SAFETY: Win32 FFI calls.
        unsafe {
            let job = windows::CreateJobObjectA(core::ptr::null_mut(), core::ptr::null_mut());
            if job.is_null() {
                return None;
            }
            let mut jeli: windows::JOBOBJECT_EXTENDED_LIMIT_INFORMATION = bun_core::ffi::zeroed();
            jeli.BasicLimitInformation.LimitFlags = windows::JOB_LIMIT_FLAGS_KILL_TREE_ON_CLOSE;
            if windows::SetInformationJobObject(
                job,
                windows::JobObjectExtendedLimitInformation,
                (&mut jeli as *mut windows::JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                core::mem::size_of::<windows::JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                windows::CloseHandle(job);
                return None;
            }
            Some(job)
        }
    }
}

/// Fatal signals that indicate Bun itself (or a native addon) crashed,
/// as opposed to the test calling process.exit() or being SIGKILL'd by
/// the OOM killer. Bun's panic handler re-raises the original fault
/// (SIGSEGV/SIGBUS/SIGFPE/SIGILL) or SIGABRT for panics; JSC/WTF
/// assertion failures abort() → SIGABRT.
///
/// Windows delivers no signals: an unhandled exception or `__fastfail`
/// exits with the NTSTATUS as the exit code, so recognized fatal values of
/// `Exited.raw` (the untruncated code; `Exited.code` is `u8`) classify as
/// panics too. A fault Bun's crash handler catches still exits with code
/// 3, indistinguishable from process.exit(3), and stays a per-file
/// failure, recognizable only by its banner in stderr.
fn is_panic_status(status: &SpawnStatus) -> bool {
    if let Some(sig) = status.signal_code() {
        use bun_core::SignalCode;
        return matches!(
            sig,
            SignalCode::SIGILL
                | SignalCode::SIGTRAP
                | SignalCode::SIGABRT
                | SignalCode::SIGBUS
                | SignalCode::SIGFPE
                | SignalCode::SIGSEGV
                | SignalCode::SIGSYS
        );
    }
    #[cfg(windows)]
    if let SpawnStatus::Exited(e) = status {
        return is_fatal_windows_exit_code(e.raw);
    }
    false
}

/// Fatal NTSTATUS exit codes — the Windows mirror of the signal list
/// above. An allowlist, not `>= 0xC0000000`, because high exit codes are
/// not all faults: 0xC000013A is Ctrl+C (the SIGINT analog), and foreign
/// code in the worker can exit with arbitrary DWORDs (CRT `exit(-1)` is
/// 0xFFFFFFFF). TerminateProcess (taskkill, job limits) stays a per-file
/// failure, like SIGKILL.
#[cfg(windows)]
#[rustfmt::skip]
fn is_fatal_windows_exit_code(code: u32) -> bool {
    matches!(
        code,
        0x8000_0003                  // STATUS_BREAKPOINT: unhandled int3 (SIGTRAP)
        | 0x8000_0004                // STATUS_SINGLE_STEP (SIGTRAP)
        | 0xC000_0005                // STATUS_ACCESS_VIOLATION (SIGSEGV)
        | 0xC000_0006                // STATUS_IN_PAGE_ERROR (SIGBUS)
        | 0xC000_001D                // STATUS_ILLEGAL_INSTRUCTION (SIGILL)
        | 0xC000_0025                // STATUS_NONCONTINUABLE_EXCEPTION
        | 0xC000_008C                // STATUS_ARRAY_BOUNDS_EXCEEDED
        | 0xC000_008D..=0xC000_0093  // STATUS_FLOAT_* faults (SIGFPE)
        | 0xC000_0094                // STATUS_INTEGER_DIVIDE_BY_ZERO (SIGFPE)
        | 0xC000_0095                // STATUS_INTEGER_OVERFLOW (SIGFPE)
        | 0xC000_0096                // STATUS_PRIVILEGED_INSTRUCTION (SIGILL)
        | 0xC000_00FD                // STATUS_STACK_OVERFLOW
        | 0xC000_0374                // STATUS_HEAP_CORRUPTION
        | 0xC000_0409                // STATUS_STACK_BUFFER_OVERRUN: __fastfail —
                                     // UCRT abort(), Rust abort, /GS checks (SIGABRT)
        | 0xC000_0417                // STATUS_INVALID_CRUNTIME_PARAMETER
        | 0xC000_041D                // STATUS_FATAL_USER_CALLBACK_EXCEPTION
        | 0xC000_0420                // STATUS_ASSERTION_FAILURE
        | 0xC000_0602                // STATUS_FAIL_FAST_EXCEPTION
    )
}

fn describe_status<'b>(buf: &'b mut [u8; 32], status: &SpawnStatus) -> &'b [u8] {
    match status {
        SpawnStatus::Exited(e) => {
            // Windows: report the untruncated code; NTSTATUS values print in
            // hex ("exit code 0xC0000409"), the form Windows tooling uses.
            #[cfg(windows)]
            let code: u32 = e.raw;
            #[cfg(not(windows))]
            let code: u32 = u32::from(e.code);
            let mut cursor: &mut [u8] = &mut buf[..];
            if code >= 0x8000_0000 {
                write!(cursor, "exit code 0x{code:08X}").expect("unreachable");
            } else {
                write!(cursor, "exit code {code}").expect("unreachable");
            }
            let remaining = cursor.len();
            &buf[..buf.len() - remaining]
        }
        // SignalCode is non-exhaustive (`_`); @tagName on an unnamed value
        // (e.g. Linux RT signals 32–64) is safety-checked illegal behavior.
        SpawnStatus::Signaled(sig) => {
            // bun_process::Status::Signaled carries the raw u8 (RT
            // signals included); bun_sys::SignalCode wraps it for name lookup.
            if let Some(name) = bun_sys::SignalCode(*sig).name() {
                name.as_bytes()
            } else {
                let mut cursor: &mut [u8] = &mut buf[..];
                write!(cursor, "signal {}", *sig as u32).expect("unreachable");
                let remaining = cursor.len();
                &buf[..buf.len() - remaining]
            }
        }
        SpawnStatus::Err(e) => e.name(),
        SpawnStatus::Running => b"running",
    }
}

/// Coordinator-side SIGINT/SIGTERM handling. The signal handler only sets a
/// flag; `Coordinator::drive` checks it and tears down workers itself so we
/// don't do non-signal-safe work in the handler. Linux PDEATHSIG and the
/// Windows Job Object are the safety net for when the coordinator can't run
/// this (SIGKILL).
pub(crate) mod abort_handler {
    use super::*;

    pub(crate) static SHOULD_ABORT: AtomicBool = AtomicBool::new(false);

    // PORTING.md §Global mutable state: written once in `install()` (single
    // call site), read once in `uninstall()`. RacyCell — `sigaction` is POD,
    // no concurrent access.
    #[cfg(unix)]
    static PREV_INT: bun_core::RacyCell<MaybeUninit<libc::sigaction>> =
        bun_core::RacyCell::new(MaybeUninit::uninit());
    #[cfg(unix)]
    static PREV_TERM: bun_core::RacyCell<MaybeUninit<libc::sigaction>> =
        bun_core::RacyCell::new(MaybeUninit::uninit());

    #[cfg(unix)]
    extern "C" fn posix_handler(_: i32, _: *const libc::siginfo_t, _: *const c_void) {
        SHOULD_ABORT.store(true, Ordering::Release);
    }

    #[cfg(windows)]
    extern "system" fn windows_ctrl_handler(
        ctrl: bun_sys::windows::DWORD,
    ) -> bun_sys::windows::BOOL {
        use bun_sys::windows;
        match ctrl {
            windows::CTRL_C_EVENT | windows::CTRL_BREAK_EVENT | windows::CTRL_CLOSE_EVENT => {
                SHOULD_ABORT.store(true, Ordering::Release);
                windows::TRUE
            }
            _ => windows::FALSE,
        }
    }

    /// Restores the previous SIGINT/SIGTERM (or Windows console-ctrl) handlers
    /// when dropped. Returned by [`install`].
    #[must_use = "dropping the guard uninstalls the abort handler"]
    pub(crate) struct Guard(());

    impl Drop for Guard {
        fn drop(&mut self) {
            uninstall();
        }
    }

    pub(crate) fn install() -> Guard {
        #[cfg(unix)]
        {
            // SAFETY: signal handler installation; PREV_* are written before
            // any read in uninstall(), single-threaded coordinator setup.
            // `&raw mut` + cast (MaybeUninit<T> is repr(transparent))
            // avoids creating &mut to a `static mut` (Rust 2024 hard error).
            unsafe {
                // SAFETY: POD, zero-valid — sigaction with handler=0/flags=0 is SIG_DFL.
                let mut act: libc::sigaction = bun_core::ffi::zeroed();
                act.sa_sigaction = posix_handler as *const () as usize;
                libc::sigemptyset(&raw mut act.sa_mask);
                act.sa_flags = libc::SA_SIGINFO;
                libc::sigaction(
                    libc::SIGINT,
                    &raw const act,
                    PREV_INT.get().cast::<libc::sigaction>(),
                );
                libc::sigaction(
                    libc::SIGTERM,
                    &raw const act,
                    PREV_TERM.get().cast::<libc::sigaction>(),
                );
            }
        }
        #[cfg(windows)]
        {
            let _ = bun_sys::c::SetConsoleCtrlHandler(
                Some(windows_ctrl_handler),
                bun_sys::windows::TRUE,
            );
        }
        Guard(())
    }

    pub(crate) fn uninstall() {
        #[cfg(unix)]
        {
            // SAFETY: PREV_* were initialized by install().
            // `&raw const` + cast avoids creating & to a `static mut`.
            unsafe {
                libc::sigaction(
                    libc::SIGINT,
                    PREV_INT.get().cast::<libc::sigaction>(),
                    core::ptr::null_mut(),
                );
                libc::sigaction(
                    libc::SIGTERM,
                    PREV_TERM.get().cast::<libc::sigaction>(),
                    core::ptr::null_mut(),
                );
            }
        }
        #[cfg(windows)]
        {
            let _ = bun_sys::c::SetConsoleCtrlHandler(
                Some(windows_ctrl_handler),
                bun_sys::windows::FALSE,
            );
        }
    }
}
