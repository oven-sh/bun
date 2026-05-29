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

use bun_core::{Global, Output};
use bun_core::{PathString, strings};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys::FdExt as _;

use super::frame::{self, Frame};
use super::worker::{PipeRole, Worker, WorkerPipe};
use crate::test_command::CommandLineReporter;

// PORT NOTE: `bun.spawn.Status` lives in src/runtime/api/bun/process.zig
// (not the lower-tier `bun_spawn` crate). Worker.exit_status is this type.
use crate::api::bun::process::Process;
use crate::api::bun::process::Status as SpawnStatus;

pub struct Coordinator<'a> {
    pub vm: &'a VirtualMachine,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub event_loop_handle: bun_jsc::EventLoopHandle,
    pub reporter: &'a mut CommandLineReporter,
    pub files: Vec<PathString>,
    pub cwd: &'a [u8],
    // [:null]?[*:0]const u8 — null-sentinel-terminated slice of C strings;
    // backing storage has a null at [len] for execve-style consumers.
    pub argv: Box<[bun_spawn::CStrPtr]>,
    /// One envp per worker slot — same base, with that slot's JEST_WORKER_ID
    /// and BUN_TEST_WORKER_ID appended.
    // TODO(port): []const [:null]?[*:0]const u8 — see argv note.
    pub envps: Vec<bun_dotenv::NullDelimitedEnvMap>,

    pub workers: &'a mut [Worker],
    /// Temp dir for per-worker JUnit XML and LCOV coverage fragments; None
    /// when neither was requested.
    pub worker_tmpdir: Option<&'a [u8]>,
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
        let mut victim: Option<*mut Worker> = None;
        let mut most: u32 = 0;
        let base: *mut Worker = self.workers.as_mut_ptr();
        let len = self.workers.len();
        for i in 0..len {
            // SAFETY: `i < len`; read-only inspection of `range` through *mut.
            let v = unsafe { base.add(i) };
            // SAFETY: `v = base.add(i)` with `i < len` is in-bounds for
            // `self.workers`; field read through *mut so no `&mut Worker` is
            // formed that could alias the caller's live `w`.
            let n = unsafe { (*v).range.len() };
            if n > most {
                most = n;
                victim = Some(v);
            }
        }
        victim
    }

    pub(crate) fn drive(&mut self) {
        let _ = self.spawn_worker();
        while !self.is_done() {
            if abort_handler::SHOULD_ABORT.load(Ordering::Acquire) {
                self.abort_all();
            }
            self.vm.event_loop_ref().tick();
            self.maybe_scale_up();
            if self.is_done() {
                break;
            }
            if self.spawned_count < self.parallel_limit
                && self.has_undispatched_files()
                && !self.bailed
            {
                // Bound the wait so we wake to scale up even if no I/O arrives.
                const MS_PER_S: i64 = bun_core::time::MS_PER_S as i64;
                let ts = bun_core::Timespec {
                    sec: self.scale_up_after_ms / MS_PER_S,
                    nsec: (self.scale_up_after_ms % MS_PER_S) * bun_core::time::NS_PER_MS as i64,
                };
                // SAFETY: event_loop()/usockets_loop() return live pointers for the VM lifetime.
                unsafe {
                    (*(*self.vm.event_loop()).usockets_loop()).tick_with_timeout(Some(&ts));
                }
            } else {
                self.vm.event_loop_ref().auto_tick();
            }
        }
    }

    fn abort_all(&mut self) -> ! {
        abort_handler::uninstall();
        for w in self.workers[..self.spawned_count as usize].iter_mut() {
            if let Some(p) = w.process {
                #[cfg(unix)]
                {
                    // SAFETY: `p` is the live intrusive-refcounted *mut Process;
                    // FFI call; -pid targets the worker's process group.
                    unsafe {
                        let _ = libc::kill(-((*p).pid as libc::pid_t), libc::SIGTERM);
                    }
                }
                #[cfg(not(unix))]
                {
                    // SAFETY: `p` is the live intrusive-refcounted *mut Process.
                    let _ = unsafe { (*p).kill(1) };
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
        // The Zig stores a back-pointer; in Rust this is an intrusive backref (raw ptr).
        w.out = WorkerPipe::new(PipeRole::Stdout, std::ptr::from_ref::<Worker>(w));
        w.err = WorkerPipe::new(PipeRole::Stderr, std::ptr::from_ref::<Worker>(w));
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
        if let Some(v_ptr) = self.find_steal_victim() {
            // SAFETY: v_ptr points into self.workers. `w` cannot be the victim:
            // `w.range` is empty here (pop_front just returned None) while the
            // victim has the largest *non-empty* range, so `v_ptr != w` and the
            // two `&mut Worker` are disjoint. find_steal_victim itself iterates
            // via raw pointers and never forms a `&mut Worker` for `w`'s slot.
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

    pub(crate) fn rel_path(&self, file_idx: u32) -> &[u8] {
        bun_paths::resolve_path::relative(
            bun_paths::fs::FileSystem::instance().top_level_dir(),
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

    pub(crate) fn on_frame(&mut self, w: &mut Worker, kind: frame::Kind, rd: &mut frame::Reader) {
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

                self.flush_captured(w);

                if w.inflight != Some(idx) {
                    return;
                }

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

                w.inflight = None;
                self.files_done += 1;
                let fail_now = self.reporter.summary().fail;
                if self.bail > 0 && fail_now >= self.bail {
                    self.bail_out();
                }
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

    pub(crate) fn on_worker_exit(&mut self, w: &mut Worker, status: SpawnStatus) {
        w.exit_status = Some(status);
        // The Channel delivers any remaining buffered data then close (which
        // sets ipc.done and calls tryReap), so no explicit drain is needed —
        // tryReap here covers the case where the channel already closed first.
        self.try_reap(w);
    }

    pub(crate) fn try_reap(&mut self, w: &mut Worker) {
        // PORT NOTE: SpawnStatus is not Copy (Err arm owns a path); take()
        // instead of pattern-match-by-copy.
        if w.exit_status.is_none() || !w.ipc.done {
            return;
        }
        let status = w.exit_status.take().expect("checked above");
        self.reap_worker(w, &status);
    }

    fn reap_worker(&mut self, w: &mut Worker, status: &SpawnStatus) {
        // Decrement here (not in onProcessExit) so drive() keeps pumping until
        // the IPC pipe has been drained and this reap actually runs.
        self.live_workers -= 1;
        self.flush_captured(w);
        if let Some(idx) = w.inflight {
            self.break_dots();
            self.ensure_header(idx);
            let panicked = is_panic_status(status);
            self.account_crash(idx, status);
            Output::flush();
            w.inflight = None;
            if panicked {
                self.abort_on_worker_panic(idx, status);
            }
        }

        if let Some(p) = w.process.take() {
            // SAFETY: `p` is the live `*mut Process` from `to_process`; sole owner now.
            unsafe {
                (*p).detach();
                Process::deref(p);
            }
        }

        let mut respawned = false;
        if !self.bailed && self.has_undispatched_files() {
            // TODO(port): explicit deinit of ipc/out/err — in Rust these become
            // Drop on assignment; verify no double-free with Default::default().
            w.ipc = Default::default();
            w.out = WorkerPipe::new(PipeRole::Stdout, std::ptr::from_ref::<Worker>(w));
            w.err = WorkerPipe::new(PipeRole::Stderr, std::ptr::from_ref::<Worker>(w));
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
            if !self.bailed && self.live_workers == 0 {
                self.abort_queued_files(b"no live workers");
            }
            w.ipc = Default::default();
            w.out = WorkerPipe::new(PipeRole::Stdout, core::ptr::null());
            w.err = WorkerPipe::new(PipeRole::Stderr, core::ptr::null());
            let _ = core::mem::take(&mut w.captured);
        }
    }

    fn account_crash(&mut self, file_idx: u32, status: &SpawnStatus) {
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

    fn abort_on_worker_panic(&mut self, file_idx: u32, status: &SpawnStatus) {
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
            if let Some(p) = unsafe { (*other).process } {
                #[cfg(unix)]
                {
                    // SAFETY: `p` is the live intrusive-refcounted *mut Process;
                    // FFI call; -pid targets the worker's process group.
                    unsafe {
                        let _ = libc::kill(-((*p).pid as libc::pid_t), libc::SIGTERM);
                    }
                }
                #[cfg(not(unix))]
                {
                    // SAFETY: `p` is the live intrusive-refcounted *mut Process.
                    let _ = unsafe { (*p).kill(1) };
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
        let base: *mut Worker = self.workers.as_mut_ptr();
        let len = self.workers.len();
        for i in 0..len {
            // SAFETY: `i < len`; range mutation through *mut so no
            // `&mut Worker` aliases the caller's live `w`.
            let wp = unsafe { base.add(i) };
            // SAFETY: `wp` is in-bounds (see above); mutating `.range` through
            // *mut forms no `&mut Worker` aliasing the caller's live `w`.
            while let Some(idx) = unsafe { (*wp).range.pop_front() } {
                Output::pretty_error(format_args!(
                    "<r><red>✗<r> <b>{}<r> <d>({})<r>\n",
                    // PORT NOTE: reshaped for borrowck — inline rel_path body
                    // since `self.workers` is mutably borrowed.
                    bstr::BStr::new(bun_paths::resolve_path::relative(
                        bun_paths::fs::FileSystem::instance().top_level_dir(),
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
    pub(crate) fn create_windows_kill_on_close_job() -> Option<*mut c_void> {
        use bun_sys::windows;
        // SAFETY: Win32 FFI calls.
        unsafe {
            let job = windows::CreateJobObjectA(core::ptr::null_mut(), core::ptr::null_mut());
            if job.is_null() {
                return None;
            }
            let mut jeli: windows::JOBOBJECT_EXTENDED_LIMIT_INFORMATION = bun_core::ffi::zeroed();
            jeli.BasicLimitInformation.LimitFlags = windows::JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
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

fn is_panic_status(status: &SpawnStatus) -> bool {
    let Some(sig) = status.signal_code() else {
        return false;
    };
    use bun_core::SignalCode;
    matches!(
        sig,
        SignalCode::SIGILL
            | SignalCode::SIGTRAP
            | SignalCode::SIGABRT
            | SignalCode::SIGBUS
            | SignalCode::SIGFPE
            | SignalCode::SIGSEGV
            | SignalCode::SIGSYS
    )
}

fn describe_status<'b>(buf: &'b mut [u8; 32], status: &SpawnStatus) -> &'b [u8] {
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
            // PORT NOTE: bun_process::Status::Signaled carries the raw u8 (RT
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
        SpawnStatus::Err(e) => <&'static str>::from(e.get_errno()).as_bytes(),
        SpawnStatus::Running => b"running",
    }
}

pub mod abort_handler {
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
            // PORT NOTE: `&raw mut` + cast (MaybeUninit<T> is repr(transparent))
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
            // PORT NOTE: `&raw const` + cast avoids creating & to a `static mut`.
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

// ported from: src/cli/test/parallel/Coordinator.zig
