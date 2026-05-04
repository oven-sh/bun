//! Process-pool coordinator for `bun test --parallel`. Owns the worker slice,
//! drives the event loop, routes IPC frames to per-test output, and handles
//! crash accounting / panic-abort / bail / lazy scale-up. Construction and
//! the run loop entry live in `runner.rs`; this file is the per-run state
//! and its methods.

use core::ffi::{c_char, c_void};
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicBool, Ordering};
use std::io::Write as _;

use bun_core::{Global, Output};
use bun_jsc::VirtualMachine;
use bun_str::{strings, ZStr};

use super::frame::{self, Frame};
use super::worker::Worker;
use crate::test_command::CommandLineReporter;

// TODO(port): verify crate path for bun.PathString (bun_fs vs bun_core)
use bun_fs::PathString;
// TODO(port): verify crate path for bun.spawn.Status
use bun_spawn::Status as SpawnStatus;

pub struct Coordinator<'a> {
    pub vm: &'a VirtualMachine,
    pub reporter: &'a mut CommandLineReporter,
    pub files: &'a [PathString],
    pub cwd: &'a ZStr,
    // TODO(port): [:null]?[*:0]const u8 — null-sentinel-terminated slice of C strings;
    // backing storage has a null at [len] for execve-style consumers.
    pub argv: &'a [*const c_char],
    /// One envp per worker slot — same base, with that slot's JEST_WORKER_ID
    /// and BUN_TEST_WORKER_ID appended.
    // TODO(port): []const [:null]?[*:0]const u8 — see argv note.
    pub envps: &'a [&'a [*const c_char]],

    pub workers: &'a mut [Worker],
    /// Temp dir for per-worker JUnit XML and LCOV coverage fragments; None
    /// when neither was requested.
    pub worker_tmpdir: Option<&'a ZStr>,
    pub junit_fragments: Vec<Box<[u8]>>,
    pub coverage_fragments: Vec<Box<[u8]>>,
    /// File index whose `path:` header was most recently written. Result lines
    /// from concurrent workers interleave; whenever the source file changes the
    /// header is re-emitted so every line has visible context. None at start.
    pub last_header_idx: Option<u32>,
    pub frame: Frame,
    pub parallel_limit: u32,
    pub scale_up_after_ms: i64,
    pub bail: u32,
    pub dots: bool,
    pub files_done: u32,
    pub spawned_count: u32,
    pub live_workers: u32,
    pub crashed_files: Vec<u32>,
    pub bailed: bool,
    pub last_printed_dot: bool,
    /// Kill-on-close Job Object so the OS reaps workers if the coordinator dies
    /// without running its signal handler (e.g. SIGKILL / TerminateProcess).
    #[cfg(windows)]
    pub windows_job: Option<*mut c_void>,
}

impl<'a> Coordinator<'a> {
    fn is_done(&self) -> bool {
        (self.files_done as usize >= self.files.len() || self.bailed) && self.live_workers == 0
    }

    fn has_undispatched_files(&self) -> bool {
        for w in self.workers.iter() {
            if !w.range.is_empty() {
                return true;
            }
        }
        false
    }

    /// The worker (spawned or not) whose range has the most files remaining.
    fn find_steal_victim(&mut self) -> Option<*mut Worker> {
        // PORT NOTE: reshaped for borrowck — return raw ptr so callers can
        // mutably borrow another worker simultaneously.
        let mut victim: Option<*mut Worker> = None;
        let mut most: u32 = 0;
        for v in self.workers.iter_mut() {
            if v.range.len() > most {
                most = v.range.len();
                victim = Some(v as *mut Worker);
            }
        }
        victim
    }

    pub fn drive(&mut self) {
        let _ = self.spawn_worker();
        while !self.is_done() {
            if abort_handler::SHOULD_ABORT.load(Ordering::Acquire) {
                return self.abort_all();
            }
            self.vm.event_loop().tick();
            self.maybe_scale_up();
            if self.is_done() {
                break;
            }
            if self.spawned_count < self.parallel_limit
                && self.has_undispatched_files()
                && !self.bailed
            {
                // Bound the wait so we wake to scale up even if no I/O arrives.
                const MS_PER_S: i64 = 1000;
                const NS_PER_MS: i64 = 1_000_000;
                // TODO(port): verify bun_sys::Timespec field names/types
                let mut ts = bun_sys::Timespec {
                    sec: self.scale_up_after_ms / MS_PER_S,
                    nsec: (self.scale_up_after_ms % MS_PER_S) * NS_PER_MS,
                };
                self.vm.event_loop().usockets_loop().tick_with_timeout(&mut ts);
            } else {
                self.vm.event_loop().auto_tick();
            }
        }
    }

    /// SIGINT/SIGTERM: terminate every worker (and its descendants) and exit.
    /// Workers run in their own process group, so kill(-pid, SIGTERM) reaches
    /// everything they spawned. Kernel-level safety nets cover the case where
    /// the coordinator can't run this (SIGKILL): PDEATHSIG on Linux,
    /// kill-on-close Job Object on Windows. macOS has neither; the process
    /// group kill here plus stdin EOF in the worker loop is the best effort.
    fn abort_all(&mut self) -> ! {
        abort_handler::uninstall();
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
                    let _ = p.kill(1);
                }
            }
        }
        if let Some(d) = self.worker_tmpdir {
            let _ = bun_sys::Fd::cwd().delete_tree(d);
        }
        Global::exit(130);
    }

    fn spawn_worker(&mut self) -> bool {
        debug_assert!(self.spawned_count < self.parallel_limit);
        let w = &mut self.workers[self.spawned_count as usize];
        // A prior failed start()'s errdefer leaves ipc.done = true; reset so a
        // retry on the same slot starts with a fresh channel.
        w.ipc = Default::default();
        // TODO(port): Worker.out / Worker.err init — need StreamCapture { role, worker } shape.
        // The Zig stores a back-pointer; in Rust this is an intrusive backref (raw ptr).
        w.out = super::worker::StreamCapture::new(super::worker::Role::Stdout, w as *mut Worker);
        w.err = super::worker::StreamCapture::new(super::worker::Role::Stderr, w as *mut Worker);
        match w.start() {
            Ok(()) => {}
            Err(e) => {
                Output::err(e, format_args!("failed to spawn test worker"));
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
        if self.bailed || !self.has_undispatched_files() {
            return;
        }
        // TODO(port): std.time.milliTimestamp() — verify bun_core helper name.
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
        if self.bailed {
            return w.shutdown();
        }
        if let Some(idx) = w.range.pop_front() {
            return w.dispatch(idx, self.files[idx as usize].slice());
        }
        // Steal the back half of the largest remaining range as a contiguous
        // block. The thief walks it forward via popFront, so both workers keep
        // directory locality and total steals are O(K log N) instead of O(N).
        // Stealing from not-yet-spawned workers is fine — their range is just
        // an unclaimed reservation.
        // PORT NOTE: reshaped for borrowck — find_steal_victim returns *mut so
        // we can borrow `w` and the victim disjointly.
        if let Some(v_ptr) = self.find_steal_victim() {
            // SAFETY: v_ptr points into self.workers; w may alias v, but
            // steal_back_half on an empty range (w's, since we just popped None)
            // is a no-op so the alias case is benign. Mirrors Zig behavior.
            let v = unsafe { &mut *v_ptr };
            if let Some(stolen) = v.range.steal_back_half() {
                w.range = stolen;
                if let Some(idx) = w.range.pop_front() {
                    return w.dispatch(idx, self.files[idx as usize].slice());
                }
            }
        }
        w.shutdown();
    }

    fn bail_out(&mut self) {
        if self.bailed {
            return;
        }
        self.bailed = true;
        self.break_dots();
        Output::pretty_error(format_args!(
            "\nBailed out after {} failure{}<r>\n",
            self.bail,
            if self.bail == 1 { "" } else { "s" }
        ));
        Output::flush();
        for other in self.workers[..self.spawned_count as usize].iter_mut() {
            if other.alive && other.inflight.is_none() {
                other.shutdown();
            }
        }
    }

    pub fn rel_path(&self, file_idx: u32) -> &[u8] {
        // TODO(port): bun.fs.FileSystem.instance.top_level_dir — verify accessor.
        bun_paths::relative(
            bun_fs::FileSystem::instance().top_level_dir(),
            self.files[file_idx as usize].slice(),
        )
    }

    fn ensure_header(&mut self, file_idx: u32) {
        if self.dots {
            return;
        }
        if self.last_header_idx == Some(file_idx) {
            return;
        }
        self.last_header_idx = Some(file_idx);
        let _ = write!(
            Output::error_writer(),
            "\n{}:\n",
            bstr::BStr::new(self.rel_path(file_idx))
        );
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

    pub fn on_frame(&mut self, w: &mut Worker, kind: frame::Kind, rd: &mut frame::Reader) {
        match kind {
            frame::Kind::Ready => self.assign_work_or_retry(w),
            frame::Kind::FileStart => {
                let _ = rd.u32_();
            }
            frame::Kind::TestDone => {
                let idx = rd.u32_();
                let formatted = rd.str();
                if w.inflight != Some(idx) {
                    return;
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
                    *n = rd.u32_();
                }
                let [idx, pass, fail, skip, todo, expectations, skipped_label, files, unhandled] =
                    nums;

                self.flush_captured(w);

                // A worker can write file_done and crash before the coordinator
                // reads the frame; onWorkerExit() will already have called
                // accountCrash() and cleared inflight. Ignore the buffered frame
                // so we don't double-count.
                if w.inflight != Some(idx) {
                    return;
                }

                let summary = self.reporter.summary();
                summary.pass += pass;
                summary.fail += fail;
                summary.skip += skip;
                summary.todo += todo;
                summary.expectations += expectations;
                summary.skipped_because_label += skipped_label;
                summary.files += files;
                self.reporter.jest.unhandled_errors_between_tests += unhandled;

                w.inflight = None;
                self.files_done += 1;
                if self.bail > 0 && summary.fail >= self.bail {
                    // PORT NOTE: reshaped for borrowck — re-read fail after dropping summary borrow.
                    let fail_now = self.reporter.summary().fail;
                    if fail_now >= self.bail {
                        self.bail_out();
                    }
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
                // PORT NOTE: Zig `inline for` over a 3-tuple of &mut buffers;
                // unrolled here because an array of disjoint &mut fields needs
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
            frame::Kind::JunitFile | frame::Kind::CoverageFile => {
                let path = rd.str();
                if path.is_empty() {
                    return;
                }
                let list = if kind == frame::Kind::JunitFile {
                    &mut self.junit_fragments
                } else {
                    &mut self.coverage_fragments
                };
                list.push(Box::<[u8]>::from(path));
            }
            frame::Kind::Run | frame::Kind::Shutdown => {}
        }
    }

    pub fn on_worker_exit(&mut self, w: &mut Worker, status: SpawnStatus) {
        w.exit_status = Some(status);
        // The Channel delivers any remaining buffered data then close (which
        // sets ipc.done and calls tryReap), so no explicit drain is needed —
        // tryReap here covers the case where the channel already closed first.
        self.try_reap(w);
    }

    pub fn try_reap(&mut self, w: &mut Worker) {
        let Some(status) = w.exit_status else {
            return;
        };
        if !w.ipc.done {
            return;
        }
        w.exit_status = None;
        self.reap_worker(w, status);
    }

    fn reap_worker(&mut self, w: &mut Worker, status: SpawnStatus) {
        // Decrement here (not in onProcessExit) so drive() keeps pumping until
        // the IPC pipe has been drained and this reap actually runs.
        self.live_workers -= 1;
        self.flush_captured(w);
        if let Some(idx) = w.inflight {
            self.break_dots();
            self.ensure_header(idx);
            // A worker dying mid-file is never silently retried. If a test
            // intentionally exits (process.exit) that file is marked failed
            // and the run continues in a fresh worker. If the worker was
            // killed by a fatal signal — SIGILL/SIGTRAP from Bun's own panic
            // handler, SIGSEGV/SIGBUS/SIGFPE from native code, SIGABRT from a
            // JSC/WTF assertion — that's a Bun or addon bug and must not be
            // masked by the rest of the suite passing: abort the whole run so
            // the exit status reflects the crash. SIGKILL is treated as a
            // regular failure (commonly the OOM killer or the user).
            let panicked = is_panic_status(status);
            self.account_crash(idx, status);
            Output::flush();
            w.inflight = None;
            if panicked {
                self.abort_on_worker_panic(idx, status);
            }
        }

        let mut respawned = false;
        if !self.bailed && self.has_undispatched_files() {
            // TODO(port): explicit deinit of ipc/out/err — in Rust these become
            // Drop on assignment; verify no double-free with Default::default().
            w.ipc = Default::default();
            w.out = super::worker::StreamCapture::new(super::worker::Role::Stdout, w as *mut Worker);
            w.err = super::worker::StreamCapture::new(super::worker::Role::Stderr, w as *mut Worker);
            w.process = None;
            match w.start() {
                Ok(()) => {
                    respawned = true;
                }
                Err(e) => {
                    Output::err(e, format_args!("failed to respawn test worker"));
                }
            }
        }

        if !respawned {
            if !self.bailed && self.live_workers == 0 {
                self.abort_queued_files(b"no live workers");
            }
            // Explicit early release: `w` is a borrowed slot in self.workers, so
            // Drop won't fire until Coordinator teardown. Assigning defaults
            // drops the old values now (pipe FDs, capture buffer) to match the
            // Zig's explicit deinit() calls.
            w.ipc = Default::default();
            w.out = Default::default();
            w.err = Default::default();
            let _ = core::mem::take(&mut w.captured);
        }
    }

    fn account_crash(&mut self, file_idx: u32, status: SpawnStatus) {
        self.break_dots();
        let mut buf = [0u8; 32];
        Output::pretty_error(format_args!(
            "<r><red>✗<r> <b>{}<r> <d>(worker crashed: {})<r>\n",
            bstr::BStr::new(self.rel_path(file_idx)),
            bstr::BStr::new(describe_status(&mut buf, status)),
        ));
        self.reporter.summary().fail += 1;
        self.reporter.summary().files += 1;
        self.crashed_files.push(file_idx);
        self.files_done += 1;
        if self.bail > 0 && self.reporter.summary().fail >= self.bail {
            self.bail_out();
        }
    }

    /// A worker was killed by a crash signal — treat this as a Bun bug, not
    /// a test failure. Print the panic banner (even if --bail already set
    /// `bailed`), terminate every other worker, and mark all remaining
    /// files as aborted so the run ends immediately with a non-zero exit
    /// and the panic's stderr (already flushed via flushCaptured) is the
    /// last meaningful output, not buried under hundreds of later passes.
    fn abort_on_worker_panic(&mut self, file_idx: u32, status: SpawnStatus) {
        self.break_dots();
        let mut buf = [0u8; 32];
        Output::pretty_error(format_args!(
            concat!(
                "\n<red>error<r>: a test worker process crashed with <b>{}<r> while running <b>{}<r>.\n",
                "This indicates a bug in Bun or in a native addon, not in the test itself. Aborting.\n",
            ),
            bstr::BStr::new(describe_status(&mut buf, status)),
            bstr::BStr::new(self.rel_path(file_idx)),
        ));
        Output::flush();
        // .shutdown() only takes effect between files, so a worker that's
        // mid-file would keep producing output after the panic banner.
        // Terminate the whole process group (same as the SIGINT path) so the
        // run ends now; reapWorker() will account each inflight file as a
        // crash when the exit arrives. Runs even if --bail already set
        // `bailed`, since bailOut() only shutdown()s idle workers and would
        // leave inflight ones running past the banner.
        for other in self.workers[..self.spawned_count as usize].iter_mut() {
            if !other.alive {
                continue;
            }
            if let Some(p) = &other.process {
                #[cfg(unix)]
                {
                    // SAFETY: FFI call; -pid targets the worker's process group.
                    unsafe {
                        let _ = libc::kill(-(p.pid as libc::pid_t), libc::SIGTERM);
                    }
                }
                #[cfg(not(unix))]
                {
                    let _ = p.kill(1);
                }
            }
        }
        if self.bailed {
            return;
        }
        self.bailed = true;
        self.abort_queued_files(b"aborted: worker panicked");
    }

    /// Mark every not-yet-dispatched file as failed so `drive()` can exit
    /// instead of spinning when no live worker remains to make progress.
    fn abort_queued_files(&mut self, reason: &[u8]) {
        for w in self.workers.iter_mut() {
            while let Some(idx) = w.range.pop_front() {
                Output::pretty_error(format_args!(
                    "<r><red>✗<r> <b>{}<r> <d>({})<r>\n",
                    // PORT NOTE: reshaped for borrowck — inline rel_path body
                    // since `self.workers` is mutably borrowed.
                    bstr::BStr::new(bun_paths::relative(
                        bun_fs::FileSystem::instance().top_level_dir(),
                        self.files[idx as usize].slice(),
                    )),
                    bstr::BStr::new(reason),
                ));
                self.reporter.summary().fail += 1;
                self.reporter.summary().files += 1;
                self.crashed_files.push(idx);
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
    pub fn create_windows_kill_on_close_job() -> Option<*mut c_void> {
        use bun_sys::{c, windows};
        // SAFETY: Win32 FFI calls.
        unsafe {
            let job = windows::CreateJobObjectA(core::ptr::null_mut(), core::ptr::null_mut());
            if job.is_null() {
                return None;
            }
            // SAFETY: all-zero is a valid JOBOBJECT_EXTENDED_LIMIT_INFORMATION.
            let mut jeli: c::JOBOBJECT_EXTENDED_LIMIT_INFORMATION = core::mem::zeroed();
            jeli.BasicLimitInformation.LimitFlags = c::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if c::SetInformationJobObject(
                job,
                c::JobObjectExtendedLimitInformation,
                (&mut jeli as *mut c::JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                core::mem::size_of::<c::JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
            ) == 0
            {
                windows::CloseHandle(job);
                return None;
            }
            Some(job)
        }
    }

    #[cfg(not(windows))]
    pub fn create_windows_kill_on_close_job() -> Option<*mut c_void> {
        None
    }
}

/// Fatal signals that indicate Bun itself (or a native addon) crashed,
/// as opposed to the test calling process.exit() or being SIGKILL'd by
/// the OOM killer. Bun's panic handler ends in @trap() → SIGILL on
/// POSIX; JSC/WTF assertion failures abort() → SIGABRT. On Windows
/// neither surfaces as a signal — abort() is exit code 3 and NTSTATUS
/// fault codes arrive as a plain exit status, both indistinguishable
/// from process.exit(N) — so this classification is effectively
/// POSIX-only and Windows worker crashes fall into the non-panic
/// per-file-failure branch.
fn is_panic_status(status: SpawnStatus) -> bool {
    let Some(sig) = status.signal_code() else {
        return false;
    };
    use bun_spawn::SignalCode::*;
    matches!(sig, SIGILL | SIGTRAP | SIGABRT | SIGBUS | SIGFPE | SIGSEGV | SIGSYS)
}

fn describe_status(buf: &mut [u8; 32], status: SpawnStatus) -> &[u8] {
    // TODO(port): std.fmt.bufPrint — using io::Write on &mut [u8].
    match status {
        SpawnStatus::Exited(e) => {
            let mut cursor: &mut [u8] = &mut buf[..];
            write!(cursor, "exit code {}", e.code).expect("unreachable");
            let remaining = cursor.len();
            &buf[..buf.len() - remaining]
        }
        // SignalCode is non-exhaustive (`_`); @tagName on an unnamed value
        // (e.g. Linux RT signals 32–64) is safety-checked illegal behavior.
        SpawnStatus::Signaled(sig) => {
            if let Some(name) = sig.name() {
                name
            } else {
                let mut cursor: &mut [u8] = &mut buf[..];
                write!(cursor, "signal {}", sig as u32).expect("unreachable");
                let remaining = cursor.len();
                &buf[..buf.len() - remaining]
            }
        }
        SpawnStatus::Err(e) => <&'static str>::from(e.get_errno()).as_bytes(),
        SpawnStatus::Running => b"running",
    }
}

/// Coordinator-side SIGINT/SIGTERM handling. The signal handler only sets a
/// flag; `Coordinator::drive` checks it and tears down workers itself so we
/// don't do non-signal-safe work in the handler. Linux PDEATHSIG and the
/// Windows Job Object are the safety net for when the coordinator can't run
/// this (SIGKILL).
pub mod abort_handler {
    use super::*;

    pub static SHOULD_ABORT: AtomicBool = AtomicBool::new(false);

    #[cfg(unix)]
    static mut PREV_INT: MaybeUninit<libc::sigaction> = MaybeUninit::uninit();
    #[cfg(unix)]
    static mut PREV_TERM: MaybeUninit<libc::sigaction> = MaybeUninit::uninit();

    #[cfg(unix)]
    extern "C" fn posix_handler(_: i32, _: *const libc::siginfo_t, _: *const c_void) {
        SHOULD_ABORT.store(true, Ordering::Release);
    }

    #[cfg(windows)]
    extern "system" fn windows_ctrl_handler(ctrl: bun_sys::windows::DWORD) -> bun_sys::windows::BOOL {
        use bun_sys::windows;
        match ctrl {
            windows::CTRL_C_EVENT | windows::CTRL_BREAK_EVENT | windows::CTRL_CLOSE_EVENT => {
                SHOULD_ABORT.store(true, Ordering::Release);
                windows::TRUE
            }
            _ => windows::FALSE,
        }
    }

    pub fn install() {
        #[cfg(unix)]
        {
            // SAFETY: signal handler installation; PREV_* are written before
            // any read in uninstall(), single-threaded coordinator setup.
            unsafe {
                let mut act: libc::sigaction = core::mem::zeroed();
                act.sa_sigaction = posix_handler as usize;
                libc::sigemptyset(&mut act.sa_mask);
                act.sa_flags = libc::SA_SIGINFO;
                libc::sigaction(libc::SIGINT, &act, PREV_INT.as_mut_ptr());
                libc::sigaction(libc::SIGTERM, &act, PREV_TERM.as_mut_ptr());
            }
        }
        #[cfg(windows)]
        {
            // SAFETY: Win32 FFI.
            unsafe {
                let _ = bun_sys::c::SetConsoleCtrlHandler(
                    Some(windows_ctrl_handler),
                    bun_sys::windows::TRUE,
                );
            }
        }
    }

    pub fn uninstall() {
        #[cfg(unix)]
        {
            // SAFETY: PREV_* were initialized by install().
            unsafe {
                libc::sigaction(libc::SIGINT, PREV_INT.as_ptr(), core::ptr::null_mut());
                libc::sigaction(libc::SIGTERM, PREV_TERM.as_ptr(), core::ptr::null_mut());
            }
        }
        #[cfg(windows)]
        {
            // SAFETY: Win32 FFI.
            unsafe {
                let _ = bun_sys::c::SetConsoleCtrlHandler(
                    Some(windows_ctrl_handler),
                    bun_sys::windows::FALSE,
                );
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/test/parallel/Coordinator.zig (522 lines)
//   confidence: medium
//   todos:      8
//   notes:      borrowck reshapes around &mut self + &mut Worker (callers pass workers from self.workers); StreamCapture/Timespec/SpawnStatus crate paths guessed; argv/envps null-sentinel slices need a real type
// ──────────────────────────────────────────────────────────────────────────
