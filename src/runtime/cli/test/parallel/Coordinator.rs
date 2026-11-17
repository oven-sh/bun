//! Process-pool coordinator for `bun test --parallel`. Owns the worker slice,
//! drives the event loop, routes IPC frames to per-test output, and handles
//! crash accounting / panic-abort / bail / lazy scale-up. Construction and
//! the run loop entry live in `runner.rs`; this file is the per-run state
//! and its methods.

#[cfg(unix)]
use core::ffi::c_void;
use core::sync::atomic::{AtomicI32, Ordering};
use std::io::Write as _;

use bun_core::strings;
use bun_core::{Global, Output};
use bun_ptr::CellExt as _;
use bun_test_schedule::{Free, Next, Phase, Schedule};

use super::frame::{self, Frame};
use super::worker::{SpawnContext, Worker};
use crate::api::bun::process::Status as SpawnStatus;
use crate::cli::run_compiled::log_first_time_in_test_run;
use crate::cli::test::timings::Timings;
use crate::test_command::CommandLineReporter;

pub(crate) struct Coordinator<'a> {
    pub(crate) reporter: &'a CommandLineReporter,
    /// `reporter.timings`, until `drive` returns.
    pub(crate) timings: Option<Box<Timings>>,
    /// Its slots are those of `workers`.
    pub(crate) schedule: Schedule,
    pub(crate) spawn: SpawnContext<'a>,
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
    pub(crate) last_header_idx: Option<usize>,
    pub frame: Frame,
    /// A compiled run with `--update-timings`.
    pub(crate) children_of_workers: Option<ChildrenOfWorkers>,
    pub(crate) max_worker_peak_rss_mb: u32,
    pub(crate) scale_up_after_ms: i64,
    pub(crate) spawned_count: usize,
    pub(crate) aborted: Option<u32>,
    pub(crate) stop_reason: Option<StopReason>,
}

/// What the processes that test files start hold. A worker leads a process group, and what it starts stays in the group. Five times a
/// second the coordinator adds up the memory of their own that the members of each group hold beside the worker, and keeps the highest
/// sum. What a process says when it has ended is no help where a test starts nine at once: that is its own highest size, and not even
/// that where it stayed smaller than the worker.
#[derive(Default)]
pub(crate) struct ChildrenOfWorkers {
    groups: Vec<GroupOfWorker>,
    looked_at_ms: i64,
}

struct GroupOfWorker {
    /// The worker's process, which leads the group.
    leader: i64,
    /// The highest sum so far, in kilobytes.
    highest: u64,
}

/// What a process holds and shares with nobody, out of its /proc/<pid>/statm: "size resident shared ..", counted in pages, which are 4, 16 or
/// 64 KB by the kernel.
fn own_kilobytes_in(statm: &[u8], page_size: usize) -> Option<u64> {
    let mut pages = bun_core::strings::split(statm, b" ")
        .map(|field| bun_core::fmt::parse_int::<u64>(field, 10).ok());
    let (resident, shared) = (pages.nth(1)??, pages.next()??);
    Some(resident.saturating_sub(shared) * (page_size as u64 / 1024))
}

impl ChildrenOfWorkers {
    pub(crate) const MS_BETWEEN_LOOKS: i64 = 200;

    fn look(&mut self) {
        let now = bun_core::time::milli_timestamp();
        if now - self.looked_at_ms < Self::MS_BETWEEN_LOOKS {
            return;
        }
        self.looked_at_ms = now;
        let Ok(processes) = bun_sys::Dir::open(b"/proc") else {
            return;
        };
        let mut sums = vec![0u64; self.groups.len()];
        let number = |field: Option<&[u8]>| {
            field.and_then(|field| bun_core::fmt::parse_int::<i64>(field, 10).ok())
        };
        let read = |pid: &[u8], file: &[u8]| {
            let path = [b"/proc/", pid, b"/", file].concat();
            bun_sys::File::read_from(bun_sys::Fd::cwd(), &path).ok()
        };
        let mut iterator = bun_sys::dir_iterator::iterate(processes.fd());
        while let Ok(Some(entry)) = iterator.next() {
            let name = entry.name.slice_u8();
            let (Some(pid), Some(stat)) = (number(Some(name)), read(name, b"stat")) else {
                continue;
            };
            // "pid (name) state parent group ..": the name may hold anything.
            let Some(after_name) = bun_core::strings::last_index_of_char(&stat, b')') else {
                continue;
            };
            let mut fields = bun_core::strings::split(&stat[after_name + 1..], b" ")
                .filter(|field| !field.is_empty());
            let group = number(fields.nth(2));
            let is_its_group = |of: &GroupOfWorker| Some(of.leader) == group && of.leader != pid;
            let Some(at) = self.groups.iter().position(is_its_group) else {
                continue;
            };
            // "session terminal foreground-group flags". Until a child starts its program, what it has is its parent's memory.
            const FORKED_AND_NOT_YET_STARTED: i64 = 0x40;
            if number(fields.nth(3)).is_none_or(|flags| flags & FORKED_AND_NOT_YET_STARTED != 0) {
                continue;
            }
            let Some(statm) = read(name, b"statm") else {
                continue;
            };
            sums[at] += own_kilobytes_in(&statm, bun_sys::page_size()).unwrap_or(0);
        }
        for (group, sum) in self.groups.iter_mut().zip(sums) {
            group.highest = group.highest.max(sum);
        }
    }

    /// In megabytes, since this was last asked for `leader`, whose group is looked at from now on.
    fn take_highest(&mut self, leader: i64) -> u32 {
        let kilobytes = match self.groups.iter_mut().find(|group| group.leader == leader) {
            Some(group) => core::mem::take(&mut group.highest),
            None => {
                self.groups.push(GroupOfWorker { leader, highest: 0 });
                0
            }
        };
        u32::try_from(kilobytes / 1024).unwrap_or(u32::MAX)
    }

    fn forget(&mut self, leader: i64) {
        self.groups.retain(|group| group.leader != leader);
    }
}

#[derive(Default)]
pub(crate) struct FileTestRecords {
    /// `TestDone` payloads past the formatted line; see `runner::decode_test_case`.
    pub(crate) tests: Vec<Box<[u8]>>,
    pub(crate) elapsed_ns: u64,
    pub(crate) started_unix_ms: Option<i64>,
    /// The name and message of the failing test case that stands for what the file didn't get to run.
    pub(crate) unfinished: Option<(&'static str, &'static str)>,
}

impl FileTestRecords {
    fn ran_until_now(&mut self, elapsed_ns: u64) {
        let elapsed_ms = (elapsed_ns / bun_core::time::NS_PER_MS) as i64;
        self.elapsed_ns = elapsed_ns;
        self.started_unix_ms = Some(bun_core::time::milli_timestamp() - elapsed_ms);
    }
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
    /// Until the last one is reaped, which aborts the files that are still queued.
    fn has_live_workers(&self) -> bool {
        self.workers.iter().any(|w| w.process.is_some())
    }

    fn has_work_to_hand_out(&self) -> bool {
        self.stop_reason.is_none() && self.schedule.has_queued()
    }

    fn may_scale_up(&self) -> bool {
        self.spawned_count < self.workers.len() && self.has_work_to_hand_out()
    }

    pub(crate) fn drive(&mut self, abort_guard: &abort_handler::Guard) {
        let _ = self.spawn_worker();
        self.handle_worker_events();
        while self.has_live_workers() {
            let signal = abort_handler::ABORT_SIGNAL.load(Ordering::Acquire);
            if signal != 0 {
                abort_guard.uninstall();
                self.abort_all(signal);
                return;
            }
            self.spawn.vm.event_loop().tick();
            self.handle_worker_events();
            self.assign_work_to_waiting_workers();
            if let Some(children) = &mut self.children_of_workers {
                children.look();
            }
            self.maybe_scale_up();
            self.handle_worker_events();
            if !self.has_live_workers() {
                break;
            }
            // Bound the wait so we wake to scale up, or to look at the workers' children, even if no I/O arrives.
            let longest_wait_ms = [
                self.may_scale_up().then_some(self.scale_up_after_ms),
                (self.children_of_workers.as_ref()).map(|_| ChildrenOfWorkers::MS_BETWEEN_LOOKS),
            ];
            if let Some(wait_ms) = longest_wait_ms.into_iter().flatten().min() {
                const MS_PER_S: i64 = bun_core::time::MS_PER_S as i64;
                let ts = bun_core::Timespec {
                    sec: wait_ms / MS_PER_S,
                    nsec: (wait_ms % MS_PER_S) * bun_core::time::NS_PER_MS as i64,
                };
                let loop_ = self.spawn.vm.event_loop().usockets_loop();
                loop_.tick_with_timeout(Some(&ts), bun_uws::NOW_NS_UNKNOWN);
            } else {
                self.spawn.vm.event_loop().auto_tick();
            }
            self.handle_worker_events();
        }
        debug_assert!(self.schedule.running().next().is_none() && !self.has_work_to_hand_out());
    }

    /// SIGINT/SIGTERM: terminate every worker (and its descendants) and exit.
    /// Workers run in their own process group, so kill(-pid, SIGTERM) reaches
    /// everything they spawned. Kernel-level safety nets cover the case where
    /// the coordinator can't run this (SIGKILL): PDEATHSIG on Linux,
    /// kill-on-close Job Object on Windows. macOS has neither; the process
    /// group kill here plus stdin EOF in the worker loop is the best effort.
    /// Exits with 128 + `signal`, the status a shell reports for a signal death.
    fn abort_all(&mut self, signal: i32) {
        let now = bun_core::time::milli_timestamp();
        let running: Vec<(usize, i64)> = self
            .schedule
            .running()
            .map(|(file, since_ms)| (file, now - since_ms))
            .collect();
        for &(file, ran_ms) in &running {
            let test_case = ("(interrupted)", "interrupted while still running");
            self.count_unfinished(file, test_case, Some(ran_ms));
        }
        for file in self.schedule.queued() {
            if let Some(records) = self.test_records.get_mut(file) {
                records.unfinished = Some(("(aborted)", "interrupted before it started"));
            }
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
            let not_started = self.schedule.queued().count();
            if not_started > 0 {
                bun_core::pretty_errorln!("{} file(s) had not started:", not_started);
                for idx in self.schedule.queued() {
                    bun_core::pretty_errorln!("  {}", bstr::BStr::new(self.rel_path(idx)));
                }
            }
            Output::flush();
        }
        self.workers.iter().for_each(terminate);
        self.aborted = Some(u32::from(bun_sys::SignalCode(signal as u8).to_exit_code()));
    }

    fn spawn_worker(&mut self) -> bool {
        if let Err(e) = self.workers[self.spawned_count].start(&self.spawn) {
            Output::err(e, "failed to spawn test worker", ());
            if !self.has_live_workers() {
                Global::exit(1);
            }
            return false;
        }
        self.spawned_count += 1;
        true
    }

    /// Once every live worker has been busy for at least `scale_up_after_ms`,
    /// spawn the remaining workers. A suite of trivially fast files therefore
    /// runs on one worker with zero spawn overhead; the first slow file
    /// triggers full scale-up so longer suites aren't staircased.
    fn maybe_scale_up(&mut self) {
        if !self.may_scale_up() {
            return;
        }
        let now = bun_core::time::milli_timestamp();
        let is_busy = |slot| {
            let running = self.schedule.phase(slot).running();
            running.is_some_and(|(_, since_ms)| now - since_ms >= self.scale_up_after_ms)
        };
        if (0..self.spawned_count).any(|slot| self.workers[slot].alive && !is_busy(slot)) {
            return;
        }
        let files_left = self.schedule.queued().count() + self.schedule.running().count();
        let want = self.workers.len().min(files_left);
        while self.spawned_count < want {
            // On failure, leave the slot unconsumed so the next drive() tick
            // can retry; don't loop here or a hard spawn error would spin.
            if !self.spawn_worker() {
                break;
            }
        }
    }

    /// A worker that found only heavy files, and no room for one, waits. It asks again and again: a heavy file may have ended.
    fn assign_work_to_waiting_workers(&mut self) {
        for slot in 0..self.spawned_count {
            if let Some(free) = self.schedule.ask_again(slot) {
                self.assign_work(free);
            }
        }
    }

    fn assign_work(&mut self, free: Free) {
        let w = &self.workers[free.slot()];
        // Its reap respawns the slot.
        if !w.can_take_work() {
            return;
        }
        if self.stop_reason.is_some() {
            return w.shutdown(&mut self.frame);
        }
        let now = bun_core::time::milli_timestamp();
        match self.schedule.assign(free, now) {
            Next::Run(idx) => {
                let is_growth_written = self.children_of_workers.is_some();
                let file = self.schedule.path(idx);
                w.dispatch(&mut self.frame, idx, file, is_growth_written);
            }
            Next::Wait => {}
            Next::ShutDown => w.shutdown(&mut self.frame),
        }
    }

    fn bail_out_if_due(&mut self) {
        let bail = self.reporter.jest.bail;
        if bail == 0 || self.reporter.summary().fail < bail || self.stop_reason.is_some() {
            return;
        }
        self.stop_reason = Some(StopReason::Bail);
        self.break_dots();
        bun_core::pretty_error!(
            "\nBailed out after {} failure{}<r>\n",
            bail,
            if bail == 1 { "" } else { "s" }
        );
        Output::flush();
        for (slot, w) in self.workers.iter().enumerate() {
            if w.alive && self.schedule.phase(slot).file().is_none() {
                w.shutdown(&mut self.frame);
            }
        }
    }

    /// In megabytes, since this was last asked. From now on the worker's children are looked at.
    fn take_highest_of_children(&mut self, slot: usize) -> u32 {
        let pid = (self.workers[slot].process.as_ref()).map(|process| process.pid);
        match (&mut self.children_of_workers, pid) {
            (Some(children), Some(pid)) => children.take_highest(pid as i64),
            _ => 0,
        }
    }

    fn rel_path(&self, file_idx: usize) -> &[u8] {
        bun_paths::resolve_path::relative(
            bun_paths::fs::FileSystem::instance().top_level_dir(),
            self.schedule.path(file_idx),
        )
    }

    fn ensure_header(&mut self, file_idx: usize) {
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

    fn break_dots(&self) {
        if self.reporter.last_printed_dot.take() {
            let _ = Output::error_writer().write_all(b"\n");
        }
    }

    /// Under the header of `file_idx`, if any.
    fn flush_captured(&mut self, slot: usize, file_idx: Option<usize>) {
        if self.workers[slot].captured.is_empty() {
            return;
        }
        self.break_dots();
        if let Some(idx) = file_idx {
            self.ensure_header(idx);
        }
        let w = &mut self.workers[slot];
        let _ = Output::error_writer().write_all(&w.captured);
        if !strings::ends_with_char(&w.captured, b'\n') {
            let _ = Output::error_writer().write_all(b"\n");
        }
        w.captured.clear();
    }

    /// fd 3 is writable from test JS, so `Ready`, `TestDone` and `FileDone` count only in the phase that expects them.
    fn on_frame(&mut self, slot: usize, kind: frame::Kind, rd: &mut frame::Reader) {
        match kind {
            frame::Kind::Ready => {
                log_first_time_in_test_run("the first worker is ready");
                // A worker that has exited stays `Starting`, so the exit counts in `startup_failures`.
                if !self.workers[slot].can_take_work() {
                    return;
                }
                if let Some(free) = self.schedule.ready(slot) {
                    self.workers[slot].startup_failures = 0;
                    self.take_highest_of_children(slot);
                    self.assign_work(free);
                } else if !self.has_work_to_hand_out() {
                    // The slot is reaped only when every holder of its channel has gone.
                    self.workers[slot].shutdown(&mut self.frame);
                }
            }
            frame::Kind::FileStart => {
                log_first_time_in_test_run("the first test file has begun");
            }
            frame::Kind::TestDone => {
                log_first_time_in_test_run("the first result is there");
                let idx = rd.u32() as usize;
                let formatted = rd.str();
                if self.schedule.phase(slot).file() != Some(idx) {
                    return;
                }
                if let Some(file) = self.test_records.get_mut(idx) {
                    file.tests.push(Box::from(rd.p));
                }
                self.flush_captured(slot, Some(idx));
                if formatted.is_empty() {
                    return; // e.g. pass under --only-failures
                }
                // dots-mode failures print a full line (writeTestStatusLine);
                // dots themselves are unterminated.
                let is_dot =
                    self.reporter.reporters.dots && !strings::ends_with_char(formatted, b'\n');
                if !is_dot {
                    self.break_dots();
                    self.ensure_header(idx);
                }
                let _ = Output::error_writer().write_all(formatted);
                self.reporter.last_printed_dot.set(is_dot);
                Output::flush();
            }
            frame::Kind::FileDone => self.on_file_done(slot, rd),
            frame::Kind::RepeatBufs => {
                for to_repeat in [
                    &self.reporter.failures_to_repeat_buf,
                    &self.reporter.skips_to_repeat_buf,
                    &self.reporter.todos_to_repeat_buf,
                ] {
                    to_repeat.with_taken(|buf| buf.extend_from_slice(rd.str()));
                }
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
            frame::Kind::RefusedChange => {
                crate::cli::run_compiled::add_refused_change(rd.str().to_vec());
            }
            frame::Kind::Run | frame::Kind::Shutdown => {}
        }
    }

    fn on_file_done(&mut self, slot: usize, rd: &mut frame::Reader) {
        let idx = rd.u32() as usize;
        let Some((free, since_ms)) = self.schedule.finish(slot, idx) else {
            return;
        };
        self.reporter.update_summary(|summary| {
            for counter in frame::counters(summary) {
                *counter += rd.u32();
            }
        });
        (self.reporter.jest.unhandled_errors_between_tests).update(|n| n + rd.u32());
        let elapsed_ns = rd.u64();
        let (growth_of_worker, largest_child) = (rd.u32(), rd.u32());
        self.max_worker_peak_rss_mb = self.max_worker_peak_rss_mb.max(rd.u32());
        rd.str().clone_into(&mut self.workers[slot].first_loads);
        // Of the two views of the children, one sees the short-lived and one sees those that run at once.
        let growth = growth_of_worker + largest_child.max(self.take_highest_of_children(slot));
        if let Some(file) = self.test_records.get_mut(idx) {
            file.ran_until_now(elapsed_ns);
        }

        self.workers[slot].read_output_written_so_far();
        self.flush_captured(slot, Some(idx));
        if self.last_header_idx == Some(idx) {
            self.end_group();
        }
        if let Some(timings) = &mut self.timings {
            timings.record_since(self.schedule.path(idx), since_ms);
            if growth > 0 {
                timings.record_growth(self.schedule.path(idx), growth);
            }
        }
        self.bail_out_if_due();
        self.assign_work(free);
    }

    /// Acts on what the event loop has left in the workers.
    #[optimize(size)]
    fn handle_worker_events(&mut self) {
        for slot in 0..self.spawned_count {
            let w = &mut self.workers[slot];
            if let Some(mut incoming) = w.ipc.take_incoming() {
                // Once is enough: frames that arrive together are all of one file.
                w.read_output_written_so_far();
                while let Some((kind, mut rd)) = incoming.next_frame() {
                    self.on_frame(slot, kind, &mut rd);
                }
                self.workers[slot].ipc.restore_incoming(incoming);
            }
        }
        // Only now: what a reap does depends on what the other workers have reported.
        for slot in 0..self.spawned_count {
            let w = &mut self.workers[slot];
            if w.ipc.kill_pending.take()
                && let Some(p) = &w.process
            {
                // So that the exit accounts for the in-flight file and the slot can respawn.
                let _ = p.kill(9);
            }
            if let Some((pid, status)) = w.take_exit() {
                self.reap_worker(slot, pid, &status);
            }
        }
    }

    #[optimize(size)]
    fn reap_worker(&mut self, slot: usize, pid: bun_spawn::PidT, status: &SpawnStatus) {
        if let Some(children) = &mut self.children_of_workers {
            children.forget(pid as i64);
        }
        let phase = self.schedule.vacate(slot);
        self.workers[slot].read_output_written_so_far();
        self.flush_captured(slot, phase.file());
        let panicked = is_panic_status(status);
        let is_after_panic = self.stop_reason == Some(StopReason::WorkerPanicked);
        match phase {
            // Never retried: a second attempt that passes would hide the crash.
            Phase::Running { file, since_ms } => {
                // The worker did not get to end what its test has started.
                #[cfg(unix)]
                terminate_process_group(pid);
                self.break_dots();
                self.ensure_header(file);
                if is_after_panic && !panicked {
                    self.abort_file(file, "aborted: sibling worker panicked");
                } else {
                    if let Some(timings) = &mut self.timings {
                        timings.keep(self.schedule.path(file));
                    }
                    // The status of a worker that was killed for it says nothing the user can act on.
                    if self.workers[slot].ipc.corrupt_frame.get() && !panicked {
                        let cause = "corrupt IPC frame, something wrote to fd 3";
                        self.print_unfinished(file, format_args!("worker killed: {cause}"));
                    } else {
                        let status = describe_status(status);
                        self.print_unfinished(file, format_args!("worker crashed: {status}"));
                    }
                    let ran_ms = bun_core::time::milli_timestamp() - since_ms;
                    let message = "worker process crashed before reporting results";
                    self.count_unfinished(file, ("(worker crashed)", message), Some(ran_ms));
                    self.bail_out_if_due();
                }
                Output::flush();
                if panicked {
                    self.abort_on_worker_panic(phase, status);
                }
            }
            Phase::Starting => {
                self.workers[slot].startup_failures += 1;
                if panicked {
                    self.abort_on_worker_panic(phase, status);
                }
            }
            Phase::WaitingForRoom | Phase::Idle => {
                if panicked && !is_after_panic {
                    self.abort_on_worker_panic(phase, status);
                }
            }
        }

        let startup_failures = self.workers[slot].startup_failures;
        let can_respawn = startup_failures < MAX_STARTUP_FAILURES && self.has_work_to_hand_out();

        if phase == Phase::Starting && self.stop_reason.is_none() {
            // A false `can_respawn` is benign when no work remains; only the
            // cap warrants the red error.
            self.break_dots();
            let desc = describe_status(status);
            if can_respawn {
                bun_core::pretty_error!(
                    "<r><yellow>warn<r>: test worker {} exited during startup ({}), retrying\n",
                    slot + 1,
                    desc,
                );
            } else if startup_failures >= MAX_STARTUP_FAILURES {
                bun_core::pretty_error!(
                    "<r><red>error<r>: test worker {} exited during startup ({}) {} times\n",
                    slot + 1,
                    desc,
                    startup_failures,
                );
            } else {
                bun_core::pretty_error!(
                    "<r><d>test worker {} exited during startup ({})<r>\n",
                    slot + 1,
                    desc,
                );
            }
            Output::flush();
        }

        let w = &mut self.workers[slot];
        w.reset_pipes();
        if can_respawn {
            match w.start(&self.spawn) {
                Ok(()) => return,
                Err(e) => Output::err(e, "failed to respawn test worker", ()),
            }
        }
        w.captured = Vec::new();
        if self.stop_reason.is_none() && !self.has_live_workers() {
            self.abort_queued_files("no live workers");
        }
    }

    fn print_unfinished(&self, file_idx: usize, why: core::fmt::Arguments<'_>) {
        bun_core::pretty_error!(
            "<r><red>✗<r> <b>{}<r> <d>({})<r>\n",
            bstr::BStr::new(self.rel_path(file_idx)),
            why,
        );
    }

    fn count_unfinished(
        &mut self,
        file_idx: usize,
        test_case: (&'static str, &'static str),
        ran_ms: Option<i64>,
    ) {
        self.reporter.count_failed_file();
        if let Some(file) = self.test_records.get_mut(file_idx) {
            file.unfinished = Some(test_case);
            if let Some(ms) = ran_ms {
                file.ran_until_now(u64::try_from(ms).unwrap_or(0) * bun_core::time::NS_PER_MS);
            }
        }
    }

    fn abort_file(&mut self, file_idx: usize, reason: &'static str) {
        self.print_unfinished(file_idx, format_args!("{reason}"));
        self.count_unfinished(file_idx, ("(aborted)", reason), None);
    }

    /// Ends the run at once, also after `--bail`, so that what the crash printed is the last output that matters.
    fn abort_on_worker_panic(&mut self, phase: Phase, status: &SpawnStatus) {
        self.break_dots();
        bun_core::pretty_error!(
            "\n<red>error<r>: a test worker process crashed with <b>{}<r> ",
            describe_status(status),
        );
        let sweep_reason = match phase {
            Phase::Running { file, .. } => {
                let path = bstr::BStr::new(self.rel_path(file));
                bun_core::pretty_error!("while running <b>{}<r>", path);
                "aborted: worker panicked"
            }
            Phase::Starting => {
                bun_core::pretty_error!("during startup");
                "aborted: worker panicked during startup"
            }
            Phase::WaitingForRoom | Phase::Idle => {
                bun_core::pretty_error!("while it was not running a test file");
                // Every file may have passed already, so the crash is an error of its own.
                (self.reporter.jest.unhandled_errors_between_tests).update(|n| n + 1);
                "aborted: worker panicked between files"
            }
        };
        bun_core::pretty_error!(
            ".\nThis indicates a bug in Bun or in a native addon, not in the test itself. Aborting.\n"
        );
        Output::flush();
        // `Shutdown` is read between files only.
        self.workers.iter().filter(|w| w.alive).for_each(terminate);
        // The queued files are swept only where this is what stopped the run.
        let earlier_stop = self.stop_reason.replace(StopReason::WorkerPanicked);
        if earlier_stop.is_none() {
            self.abort_queued_files(sweep_reason);
        }
    }

    fn abort_queued_files(&mut self, reason: &'static str) {
        while let Some(idx) = self.schedule.give_up_queued() {
            self.abort_file(idx, reason);
        }
        Output::flush();
    }
}

fn terminate(worker: &Worker) {
    if let Some(process) = &worker.process {
        #[cfg(unix)]
        terminate_process_group(process.pid);
        // TerminateProcess. Most other signals are ENOSYS.
        #[cfg(not(unix))]
        let _ = process.kill(9);
    }
}

/// SIGTERM to the process group a worker leads: the worker and everything it
/// spawned. Safe after the worker exited: the pid stays reserved while any
/// member of the group lives, and an empty group gives ESRCH.
#[cfg(unix)]
fn terminate_process_group(pid: libc::pid_t) {
    let _ = bun_spawn::ffi::kill(-pid, libc::SIGTERM);
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
    #[cfg(unix)]
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

fn describe_status(status: &SpawnStatus) -> impl core::fmt::Display {
    core::fmt::from_fn(move |f| match status {
        SpawnStatus::Exited(e) => {
            // Windows: report the untruncated code; NTSTATUS values print in
            // hex ("exit code 0xC0000409"), the form Windows tooling uses.
            #[cfg(windows)]
            let code: u32 = e.raw;
            #[cfg(not(windows))]
            let code: u32 = u32::from(e.code);
            if code >= 0x8000_0000 {
                write!(f, "exit code 0x{code:08X}")
            } else {
                write!(f, "exit code {code}")
            }
        }
        SpawnStatus::Signaled(sig) => match bun_sys::SignalCode(*sig).name() {
            Some(name) => f.write_str(name),
            None => write!(f, "signal {sig}"),
        },
        SpawnStatus::Err(e) => write!(f, "{}", bstr::BStr::new(e.name())),
        SpawnStatus::Running => f.write_str("running"),
    })
}

/// Coordinator-side SIGINT/SIGTERM handling. The signal handler only sets a
/// flag; `Coordinator::drive` checks it and tears down workers itself so we
/// don't do non-signal-safe work in the handler. Linux PDEATHSIG and the
/// Windows Job Object are the safety net for when the coordinator can't run
/// this (SIGKILL).
pub(crate) mod abort_handler {
    use super::*;

    /// The signal that asked for the abort, or 0. Windows console events count as SIGINT.
    pub(crate) static ABORT_SIGNAL: AtomicI32 = AtomicI32::new(0);

    #[cfg(unix)]
    extern "C" fn posix_handler(sig: i32, _: *const libc::siginfo_t, _: *const c_void) {
        ABORT_SIGNAL.store(sig, Ordering::Release);
    }

    #[cfg(windows)]
    extern "system" fn windows_ctrl_handler(
        ctrl: bun_sys::windows::DWORD,
    ) -> bun_sys::windows::BOOL {
        use bun_sys::windows;
        match ctrl {
            windows::CTRL_C_EVENT | windows::CTRL_BREAK_EVENT | windows::CTRL_CLOSE_EVENT => {
                ABORT_SIGNAL.store(libc::SIGINT, Ordering::Release);
                windows::TRUE
            }
            _ => windows::FALSE,
        }
    }

    /// Restores the previous SIGINT/SIGTERM (or Windows console-ctrl) handlers
    /// when dropped. Returned by [`install`].
    #[must_use = "dropping the guard uninstalls the abort handler"]
    pub(crate) struct Guard {
        #[cfg(unix)]
        previous: [(i32, libc::sigaction); 2],
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            self.uninstall();
        }
    }

    pub(crate) fn install() -> Guard {
        #[cfg(windows)]
        let _ =
            bun_sys::c::SetConsoleCtrlHandler(Some(windows_ctrl_handler), bun_sys::windows::TRUE);
        Guard {
            #[cfg(unix)]
            previous: [libc::SIGINT, libc::SIGTERM].map(|signal| {
                let mut act: libc::sigaction = bun_core::ffi::zeroed();
                act.sa_sigaction = posix_handler as *const () as usize;
                act.sa_flags = libc::SA_SIGINFO;
                let mut previous = bun_core::ffi::zeroed();
                // SAFETY: the handler has the signature that `SA_SIGINFO` asks for, and only stores to an atomic.
                unsafe {
                    libc::sigemptyset(&raw mut act.sa_mask);
                    libc::sigaction(signal, &raw const act, &raw mut previous);
                }
                (signal, previous)
            }),
        }
    }

    impl Guard {
        pub(crate) fn uninstall(&self) {
            #[cfg(unix)]
            for (signal, previous) in &self.previous {
                // SAFETY: `install` got `previous` from `sigaction` for this signal.
                unsafe { libc::sigaction(*signal, previous, core::ptr::null_mut()) };
            }
            #[cfg(windows)]
            let _ = bun_sys::c::SetConsoleCtrlHandler(
                Some(windows_ctrl_handler),
                bun_sys::windows::FALSE,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::own_kilobytes_in;

    #[test]
    fn pages_are_counted_at_the_size_that_the_kernel_has() {
        let statm = b"30000 1500 500 10 0 900 0\n";
        assert_eq!(own_kilobytes_in(statm, 4 << 10), Some(4_000));
        assert_eq!(own_kilobytes_in(statm, 16 << 10), Some(16_000));
        assert_eq!(own_kilobytes_in(statm, 64 << 10), Some(64_000));
        assert_eq!(own_kilobytes_in(b"30000 500 1500", 4 << 10), Some(0));
        assert_eq!(own_kilobytes_in(b"", 4 << 10), None);
    }
}
