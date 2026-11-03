//! Process-pool coordinator for `bun test --parallel`. Owns the worker slice,
//! drives the event loop, routes IPC frames to per-test output, and handles
//! crash accounting / panic-abort / bail / lazy scale-up. Construction and
//! the run loop entry live in `runner.rs`; this file is the per-run state
//! and its methods.

use core::ffi::c_void;
#[cfg(unix)]
use core::mem::MaybeUninit;
use core::sync::atomic::{AtomicI32, Ordering};
use std::io::Write as _;

use bun_core::strings;
use bun_core::{Global, Output};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_ptr::Interned;
use bun_sys::FdExt as _;

use super::file_range::FileRange;
use super::frame::{self, Frame};
use super::parts::{self, Part, PartBuilder, PartState, Parts};
use super::reservation::{Reservation, Room, own_kilobytes_in};
use super::worker::{SpawnContext, Worker, WorkerPipe};
use crate::cli::command::TestOptions;
use crate::cli::run_compiled::{
    PART_HAS_NO_PROGRAM, PART_HAS_NO_ROOM, PART_IS_BUILT_AGAIN, PROGRAMS_CAN_WAIT_IN_MEMORY,
    TestPartKind, log_first_time_in_test_run, log_step_of_test_run,
};
use crate::test_command::CommandLineReporter;

// `Status` lives in `crate::api::bun::process`
// (not the lower-tier `bun_spawn` crate). Worker.exit_status is this type.
use crate::api::bun::process::Status as SpawnStatus;

pub(crate) struct Coordinator<'a> {
    pub(crate) vm: &'a VirtualMachine,
    /// Typed enum mirror of `vm.event_loop()` for the io-layer FilePoll vtable
    /// (`bun_io::EventLoopHandle` wraps `*const EventLoopHandle`).
    pub(crate) event_loop_handle: bun_jsc::EventLoopHandle,
    pub(crate) reporter: &'a mut CommandLineReporter,
    pub(crate) files: Vec<Interned>,
    /// `--timings`: recorded cost per `files` index; stealing then goes by remaining time and takes the victim's slowest file.
    pub(crate) costs: Option<Vec<u64>>,
    pub(crate) cwd: &'a [u8],
    /// Where the run was started. A build is handed the arguments as they were typed, so a relative `--cwd` among them is
    /// followed once more, from here.
    pub(crate) cwd_of_builds: &'a [u8],
    // [:null]?[*:0]const u8 — null-sentinel-terminated slice of C strings;
    // backing storage has a null at [len] for execve-style consumers.
    pub(crate) argv: Box<[bun_spawn::CStrPtr]>,
    /// One envp per worker slot — same base, with that slot's `WORKER_ID_VARIABLES`.
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
    /// Where the run ends as in one process: the file that the worker has begun. It has printed the header itself.
    pub(crate) header_printed_by_worker: Option<u32>,
    pub frame: Frame,
    pub(crate) parallel_limit: u32,
    /// A compiled run with `--timings` that say how much memory files took: no two files that took over a gigabyte run at once, and
    /// beside one the others get the lightest files that are left.
    pub(crate) keeps_heavy_files_apart: bool,
    /// What the heaviest file of the run took, in megabytes: `Timings::largest_growth`.
    pub(crate) room_for_heavy_files: u32,
    /// A compiled run with `--update-timings`.
    pub(crate) children_of_workers: Option<ChildrenOfWorkers>,
    /// What the other workers take together where each runs an average file: `Timings::growth_of_average_files`. As long as heavy
    /// files are left, the files beside them are chosen to take no more.
    pub(crate) room_beside_heavy_files: u32,
    /// In a run of one program.
    pub(crate) heavy_files_to_hand_out: u32,
    /// A compiled run with `--aot-memory-limit`. It takes the place of the rule above: a file starts where there is room for it.
    pub(crate) reservation: Option<Reservation>,
    /// `Timings::growth_of_running_light_file`.
    pub(crate) growth_of_running_light_file: u32,
    pub(crate) max_worker_peak_rss_mb: u32,
    pub(crate) max_exited_worker_rss_mb: u32,
    pub(crate) scale_up_after_ms: i64,
    pub(crate) bail: u32,
    pub(crate) dots: bool,
    pub(crate) files_done: u32,
    pub(crate) spawned_count: u32,
    /// `bun test --aot` over several programs. All of `workers` count as spawned; a slot with no process takes a part when one is ready.
    pub(crate) parts: Option<Box<Parts>>,
    pub(crate) live_workers: u32,
    pub(crate) aborted: Option<u32>,
    /// Plain `bun test` runs these files in its own process: there is no `--parallel`, or it comes to one worker. They run in workers
    /// because their programs are several, one after another, and the run ends as it does in one process.
    /// Where plain `bun test` starts workers, a run ends with 0 whatever a test has stored, and its summary counts no snapshots.
    pub(crate) ends_as_in_one_process: bool,
    /// `process.exitCode = 3` in a test: what the last file that changed it has left. Each file starts from there, whichever worker runs it.
    pub(crate) exit_code_left_by_tests: Option<u8>,
    pub(crate) failed_to_write_inline_snapshots: bool,
    pub(crate) stop_reason: Option<StopReason>,
    pub(crate) last_printed_dot: bool,
    /// Kill-on-close Job Object so the OS reaps workers if the coordinator dies
    /// without running its signal handler (e.g. SIGKILL / TerminateProcess).
    #[cfg(windows)]
    pub(crate) windows_job: Option<*mut c_void>,
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
    /// Unix time in milliseconds, or 0 if the file never started.
    pub(crate) started_unix_ms: i64,
    /// The name and message of the failing test case that stands for what the file didn't get to run.
    pub(crate) unfinished: Option<(&'static [u8], Box<[u8]>)>,
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
            && self
                .parts
                .as_ref()
                .is_none_or(|parts| parts.builders.is_empty())
    }

    fn has_undispatched_files(&self) -> bool {
        if let Some(parts) = &self.parts {
            return parts.has_undispatched_files();
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
        if self.parts.is_some() {
            self.advance_parts();
        } else {
            let _ = self.spawn_worker();
        }
        self.run_pending_reaps();
        while !self.is_done() {
            let signal = abort_handler::ABORT_SIGNAL.load(Ordering::Acquire);
            if signal != 0 {
                self.abort_all(signal);
                return;
            }
            self.vm.event_loop_ref().tick();
            self.run_pending_reaps();
            self.assign_work_to_waiting_workers();
            if let Some(children) = &mut self.children_of_workers {
                children.look();
            }
            self.look_at_builds();
            self.maybe_scale_up();
            self.run_pending_reaps();
            if self.is_done() {
                break;
            }
            let may_scale_up = self.spawned_count < self.parallel_limit
                && self.has_undispatched_files()
                && self.stop_reason.is_none();
            // Bound the wait so we wake to scale up, or to look at the workers' children, even if no I/O arrives.
            let longest_wait_ms = [
                may_scale_up.then_some(self.scale_up_after_ms),
                (self.children_of_workers.as_ref()).map(|_| ChildrenOfWorkers::MS_BETWEEN_LOOKS),
                (self.reservation.as_ref()).map(|_| Reservation::MS_BETWEEN_LOOKS),
            ];
            if let Some(wait_ms) = longest_wait_ms.into_iter().flatten().min() {
                const MS_PER_S: i64 = bun_core::time::MS_PER_S as i64;
                let ts = bun_core::Timespec {
                    sec: wait_ms / MS_PER_S,
                    nsec: (wait_ms % MS_PER_S) * bun_core::time::NS_PER_MS as i64,
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
    /// Exits with 128 + `signal`, the status a shell reports for a signal death.
    fn abort_all(&mut self, signal: i32) {
        abort_handler::uninstall();
        self.end_builds();
        let now = bun_core::time::milli_timestamp();
        let workers = &self.workers[..self.spawned_count as usize];
        let running: Vec<(u32, i64)> = workers
            .iter()
            .filter_map(|w| w.inflight.map(|idx| (idx, now - w.dispatched_at)))
            .collect();
        for (idx, ms) in &running {
            self.reporter.summary().fail += 1;
            self.reporter.summary().files += 1;
            self.mark_cut_short(
                *idx,
                *ms,
                b"(interrupted)",
                b"interrupted while still running",
            );
            self.files_done += 1;
        }
        for w in self.workers.iter() {
            for idx in w.range.lo..w.range.hi {
                if let Some(file) = self.test_records.get_mut(idx as usize) {
                    file.unfinished = Some((
                        b"(aborted)",
                        b"interrupted before it started".as_slice().into(),
                    ));
                }
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
            let not_started: u32 = self.workers.iter().map(|w| w.range.len()).sum();
            if not_started > 0 {
                bun_core::pretty_errorln!("{} file(s) had not started:", not_started);
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
                terminate_process_group(p.pid);
                #[cfg(not(unix))]
                {
                    // SIGKILL → TerminateProcess; libuv-win ENOSYSes signals
                    // other than SIGQUIT/SIGTERM/SIGKILL/SIGINT.
                    let _ = p.kill(9);
                }
            }
        }
        self.aborted = Some(u32::from(bun_sys::SignalCode(signal as u8).to_exit_code()));
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
        match w.start(&SpawnContext {
            vm: self.vm,
            cwd: self.cwd,
            argv: &self.argv,
            envps: &self.envps,
            compiled_program: crate::cli::run_compiled::graph_descriptor(),
            programs_below: &[],
            inherits_output: false,
            #[cfg(windows)]
            windows_job: self.windows_job,
        }) {
            Ok(()) => self.live_workers += 1,
            Err(e) => {
                Output::err(e, "failed to spawn test worker", ());
                if self.live_workers == 0 {
                    Global::exit(1);
                }
                return false;
            }
        }
        if let Some(reservation) = &mut self.reservation {
            reservation.worker_starts(self.spawned_count as usize, None, false);
        }
        self.spawned_count += 1;
        true
    }

    /// Once every live worker has been busy for at least `scale_up_after_ms`,
    /// spawn the remaining workers. A suite of trivially fast files therefore
    /// runs on one worker with zero spawn overhead; the first slow file
    /// triggers full scale-up so longer suites aren't staircased.
    fn maybe_scale_up(&mut self) {
        if self.parts.is_some() {
            return self.advance_parts();
        }
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
            if self
                .room_for_next_file(true)
                .is_some_and(|room| room.for_light.is_none())
            {
                break;
            }
            // On failure, leave the slot unconsumed so the next drive() tick
            // can retry; don't loop here or a hard spawn error would spin.
            if !self.spawn_worker() {
                break;
            }
        }
    }

    fn is_heavy(&self, file_idx: u32) -> bool {
        let timings = self.reporter.timings.as_ref();
        self.keeps_heavy_files_apart
            && timings.is_some_and(|t| t.is_heavy(self.files[file_idx as usize].as_bytes()))
    }

    /// In megabytes. 0 for a file that is not heavy.
    fn heavy_growth_of(&self, file_idx: u32) -> u32 {
        let path = self.files[file_idx as usize].as_bytes();
        let growth = (self.reporter.timings.as_ref()).and_then(|t| t.growth_of(path));
        growth.filter(|_| self.is_heavy(file_idx)).unwrap_or(0)
    }

    /// What the heavy files that run took together.
    fn heavy_growth_running(&self) -> u32 {
        if !self.keeps_heavy_files_apart {
            return 0;
        }
        if let Some(parts) = &self.parts {
            return parts.heavy_growth_running();
        }
        // The caller may hold a `&mut Worker` of the slice: see `find_steal_victim`.
        let base: *const Worker = self.workers.as_ptr();
        let growths = (0..self.workers.len()).map(|i| {
            // SAFETY: `i < len`; a read of one field through the raw pointer.
            let inflight = unsafe { (*base.add(i)).inflight };
            inflight.map_or(0, |file_idx| self.heavy_growth_of(file_idx))
        });
        growths.sum()
    }

    fn has_heavy_files_left(&self) -> bool {
        match &self.parts {
            Some(parts) => parts.has_heavy_files_left(),
            None => self.heavy_files_to_hand_out > 0,
        }
    }

    /// What the files that run and are not heavy took together.
    fn growth_running_beside_heavy_files(&self) -> u32 {
        let Some(timings) = self.reporter.timings.as_ref() else {
            return 0;
        };
        // The caller may hold a `&mut Worker` of the slice: see `find_steal_victim`.
        let base: *const Worker = self.workers.as_ptr();
        let growths = (0..self.workers.len()).filter_map(|i| {
            // SAFETY: `i < len`; a read of one field through the raw pointer.
            let file_idx = unsafe { (*base.add(i)).inflight }?;
            let growth = timings.growth_of(self.files[file_idx as usize].as_bytes())?;
            (!self.is_heavy(file_idx)).then_some(growth)
        });
        growths.sum()
    }

    /// The next file of `range`. As long as heavy files are left, that is a heavy one for which there is room, else the first one
    /// that fits beside them, else the lightest, and none where only heavy ones are left: what is begun before a heavy file runs
    /// on beside it. None of the files of a range has been handed out, so their order is free.
    fn take_next(&mut self, range: &mut FileRange) -> Option<u32> {
        if let Some(room) = self.room_for_next_file(false) {
            return self.take_next_that_has_room(range, room);
        }
        let running = self.heavy_growth_running();
        let is_chosen =
            self.keeps_heavy_files_apart && (running > 0 || self.has_heavy_files_left());
        if !range.is_empty() && is_chosen {
            let timings = self.reporter.timings.as_ref()?;
            // Most files take next to nothing, so one without a record counts as light. A table may then hold the large ones alone.
            let growth_of = |file_idx: &u32| {
                let growth = timings.growth_of(self.files[*file_idx as usize].as_bytes());
                growth.unwrap_or(0)
            };
            let has_room = |file_idx: &u32| {
                let growth = self.heavy_growth_of(*file_idx);
                growth > 0 && (running == 0 || running + growth <= self.room_for_heavy_files)
            };
            let beside = self.growth_running_beside_heavy_files();
            let fits_beside = |file_idx: &u32| {
                !self.is_heavy(*file_idx)
                    && beside + growth_of(file_idx) <= self.room_beside_heavy_files
            };
            let next = (range.lo..range.hi)
                .find(has_room)
                .or_else(|| (range.lo..range.hi).find(fits_beside))
                .or_else(|| (range.lo..range.hi).min_by_key(growth_of))?;
            if self.is_heavy(next) {
                if !has_room(&next) {
                    return None;
                }
                self.heavy_files_to_hand_out = self.heavy_files_to_hand_out.saturating_sub(1);
            }
            self.files.swap(range.lo as usize, next as usize);
            if let Some(costs) = &mut self.costs {
                costs.swap(range.lo as usize, next as usize);
            }
        }
        range.pop_front()
    }

    /// What the file is taken to need, in megabytes: what it took, or as much as the largest file of which nothing was known.
    fn record_of(&self, file_idx: u32) -> u32 {
        let path = self.files[file_idx as usize].as_bytes();
        let record = (self.reporter.timings.as_ref()).and_then(|t| t.growth_of(path));
        let of_unknown =
            || (self.reservation.as_ref()).map_or(0, Reservation::largest_without_record);
        record.unwrap_or_else(of_unknown)
    }

    fn builds_of_test_files(&self) -> impl Iterator<Item = &PartBuilder> {
        let builders = self.parts.iter().flat_map(|parts| parts.builders.iter());
        (builders.map(|builder| &**builder))
            .filter(|builder| parts::layer_of(builder.part).is_none())
    }

    fn look_at_builds(&mut self) {
        if self.reservation.is_none() {
            return;
        }
        let processes = self
            .builds_of_test_files()
            .filter_map(|build| build.process.as_ref());
        let builds: Vec<i64> = processes.map(|process| process.pid as i64).collect();
        if let Some(reservation) = &mut self.reservation {
            reservation.look(&builds);
        }
    }

    /// The heaviest file that waits for nothing but room, or will in a moment.
    fn heaviest_file_that_waits(&self) -> u32 {
        if let Some(parts) = &self.parts {
            return parts.heaviest_on_its_way();
        }
        if self.heavy_files_to_hand_out == 0 {
            return 0;
        }
        // The caller may hold a `&mut Worker` of the slice: see `find_steal_victim`.
        let base: *const Worker = self.workers.as_ptr();
        let files = (0..self.workers.len()).flat_map(|i| {
            // SAFETY: `i < len`; a read of one field through the raw pointer.
            let range = unsafe { (*base.add(i)).range };
            range.lo..range.hi
        });
        files
            .map(|file_idx| self.heavy_growth_of(file_idx))
            .max()
            .unwrap_or(0)
    }

    fn has_light_files_left(&self) -> bool {
        if let Some(parts) = &self.parts {
            return parts.has_light_files_left();
        }
        // The caller may hold a `&mut Worker` of the slice: see `find_steal_victim`.
        let base: *const Worker = self.workers.as_ptr();
        // SAFETY: `i < len`; a read of one field through the raw pointer.
        let left = (0..self.workers.len()).map(|i| unsafe { (*base.add(i)).range.len() });
        left.sum::<u32>() > self.heavy_files_to_hand_out
    }

    /// With `--aot-memory-limit`: the most that a file may take to start now.
    /// One heavy file has the right of way: while none runs and one is ready, the others leave its room free, so it does not wait
    /// for the end of the run. A further heavy file starts where the workers that have no file can still each run an average light
    /// one: else a few heavy files would keep most of the workers out.
    fn room_for_next_file(&self, in_new_worker: bool) -> Option<Room> {
        let reservation = self.reservation.as_ref()?;
        if in_new_worker && !reservation.may_start_worker() {
            return Some(Room::default());
        }
        let builds = self.builds_of_test_files().count() as u32;
        let rest = reservation.rest_of_new_worker();
        let (idle, not_started) = reservation.workers_without_file();
        let (idle, not_started) = match in_new_worker {
            true => (idle, not_started.saturating_sub(1)),
            false => (idle.saturating_sub(1), not_started),
        };
        let company = match self.has_light_files_left() {
            true => (idle + not_started) * self.growth_of_running_light_file + not_started * rest,
            false => 0,
        };
        let heaviest_that_waits = match self.heaviest_file_that_waits() {
            0 => (0, 0),
            growth => (growth, growth + if self.parts.is_some() { rest } else { 0 }),
        };
        let (beside_heavy, beside_light) = match reservation.runs_heavy_file() {
            true => (company, 0),
            false => (0, heaviest_that_waits.1),
        };
        let of_worker = if in_new_worker { rest } else { 0 };
        Some(Room {
            for_heavy: reservation.room_beside(of_worker + beside_heavy, builds),
            for_light: reservation.room_beside(of_worker + beside_light, builds),
            heaviest_that_waits,
        })
    }

    /// The heaviest of the heavy files for which there is room, else the first of the others. None of the files of a range has been
    /// handed out, so one may be taken out of the middle; the rest keep their order.
    fn take_next_that_has_room(&mut self, range: &mut FileRange, room: Room) -> Option<u32> {
        let heavy = (range.lo..range.hi)
            .filter(|idx| self.is_heavy(*idx) && room.has_for_heavy(self.record_of(*idx)))
            .max_by_key(|idx| self.record_of(*idx));
        let next = heavy.or_else(|| {
            let mut light = (range.lo..range.hi)
                .filter(|idx| !self.is_heavy(*idx) && room.has_for_light(self.record_of(*idx)));
            // Nobody knows what a worker holds until one has ended a file: the sooner the better.
            match self.reservation.as_ref()?.knows_rest_of_workers() {
                true => light.next(),
                false => light.min_by_key(|file_idx| {
                    let path = self.files[*file_idx as usize].as_bytes();
                    (self.reporter.timings.as_ref())
                        .and_then(|t| t.get(path))
                        .unwrap_or(u32::MAX)
                }),
            }
        })?;
        if self.is_heavy(next) {
            self.heavy_files_to_hand_out = self.heavy_files_to_hand_out.saturating_sub(1);
        }
        self.files[range.lo as usize..=next as usize].rotate_right(1);
        if let Some(costs) = &mut self.costs {
            costs[range.lo as usize..=next as usize].rotate_right(1);
        }
        range.pop_front()
    }

    /// A worker that found only heavy files, and no room for one, waits. It asks again and again: a heavy file may have ended.
    fn assign_work_to_waiting_workers(&mut self) {
        if !self.keeps_heavy_files_apart || self.parts.is_some() {
            return;
        }
        let base: *mut Worker = self.workers.as_mut_ptr();
        for i in 0..self.workers.len() {
            // SAFETY: `i < len`, and no other `&mut Worker` is live: `drive` calls this between events.
            let w = unsafe { &mut *base.add(i) };
            if w.alive && core::mem::take(&mut w.waits_for_heavy_file_to_end) {
                self.assign_work(w);
            }
        }
    }

    fn assign_work(&mut self, w: &mut Worker) {
        if self.stop_reason.is_some() {
            return w.shutdown(&mut self.frame);
        }
        if let Some(reservation) = &mut self.reservation {
            reservation.worker_asks(w.idx as usize);
        }
        if self.parts.is_some() {
            let part = w.part as usize;
            let Part {
                mut range,
                heavy_growth,
                ..
            } = self.parts.as_ref().expect("has parts").list[part];
            // The heavy file that runs is its own.
            let next = match heavy_growth > 0 {
                true => range.pop_front(),
                false => self.take_next(&mut range),
            };
            self.parts.as_mut().expect("has parts").list[part].range = range;
            return match next {
                Some(idx) => self.dispatch_to(w, idx),
                None => w.shutdown(&mut self.frame),
            };
        }
        let mut range = w.range;
        let next = self.take_next(&mut range);
        w.range = range;
        if let Some(idx) = next {
            return self.dispatch_to(w, idx);
        }
        if !w.range.is_empty() {
            w.waits_for_heavy_file_to_end = true;
            return;
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
                let mut range = v.range;
                let next = self.take_next(&mut range);
                v.range = range;
                if let Some(idx) = next {
                    return self.dispatch_to(w, idx);
                }
                w.waits_for_heavy_file_to_end = true;
                return;
            } else if let Some(stolen) = v.range.steal_back_half() {
                w.range = stolen;
                if let Some(idx) = w.range.pop_front() {
                    return self.dispatch_to(w, idx);
                }
            }
        }
        w.shutdown(&mut self.frame);
    }

    fn bail_out(&mut self) {
        if self.stop_reason.is_some() {
            return;
        }
        self.stop_reason = Some(StopReason::Bail);
        self.end_builds();
        self.break_dots();
        if !self.ends_as_in_one_process {
            bun_core::pretty_error!(
                "\nBailed out after {} failure{}<r>\n",
                self.bail,
                if self.bail == 1 { "" } else { "s" }
            );
        }
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
                    (*other).shutdown(&mut self.frame);
                }
            }
        }
    }

    /// In megabytes, since this was last asked. From now on the worker's children are looked at.
    fn take_highest_of_children(&mut self, w: &Worker) -> u32 {
        let pid = w.process.as_ref().map(|process| process.pid);
        match (&mut self.children_of_workers, pid) {
            (Some(children), Some(pid)) => children.take_highest(pid as i64),
            _ => 0,
        }
    }

    fn record_timing(&mut self, file_idx: u32, dispatched_at: i64) {
        if let Some(t) = self.reporter.timings.as_mut() {
            t.record_since(self.files[file_idx as usize].as_bytes(), dispatched_at);
        }
    }

    fn keep_timing(&mut self, file_idx: u32) {
        if let Some(t) = self.reporter.timings.as_mut() {
            t.keep(self.files[file_idx as usize].as_bytes());
        }
    }

    pub(crate) fn rel_path(&self, file_idx: u32) -> &[u8] {
        bun_paths::resolve_path::relative(
            bun_paths::fs::FileSystem::instance().top_level_dir(),
            self.files[file_idx as usize].as_bytes(),
        )
    }

    fn ensure_header(&mut self, file_idx: u32) {
        if self.last_header_idx == Some(file_idx) || self.header_printed_by_worker == Some(file_idx)
        {
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
                log_first_time_in_test_run("the first worker is ready");
                w.reached_ready = true;
                w.startup_failures = 0;
                self.take_highest_of_children(w);
                self.assign_work_or_retry(w);
            }
            frame::Kind::FileStart => {
                log_first_time_in_test_run("the first test file has begun");
                let idx = rd.u32();
                if self.ends_as_in_one_process {
                    self.header_printed_by_worker = Some(idx);
                }
            }
            frame::Kind::TestDone => {
                log_first_time_in_test_run("the first result is there");
                let idx = rd.u32();
                let formatted = rd.str();
                if w.inflight != Some(idx) {
                    return;
                }
                if let (Some(reservation), Some(process)) = (&mut self.reservation, &w.process) {
                    reservation.worker_has_run_test(w.idx as usize, process.pid as i64);
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
                let mut nums = [0u32; 10];
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
                    shuffled,
                    unhandled,
                ] = nums;
                let elapsed_ns = rd.u64();
                let rd_growth = rd.u32();
                let largest_child = rd.u32();
                self.max_worker_peak_rss_mb = self.max_worker_peak_rss_mb.max(rd.u32());
                let rest = rd.u32();
                let exit_code_left = rd.u32();
                let first_loads = rd.str();
                // Of the two views of the children, one sees the short-lived and one sees those that run at once.
                let growth = rd_growth + largest_child.max(self.take_highest_of_children(w));
                if let Some(file) = self.test_records.get_mut(idx as usize) {
                    file.elapsed_ns = elapsed_ns;
                    file.started_unix_ms = bun_core::time::milli_timestamp()
                        - (file.elapsed_ns / bun_core::time::NS_PER_MS) as i64;
                }

                w.read_output_written_so_far();
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
                if let (true, Some(code)) =
                    (self.ends_as_in_one_process, exit_code_left.checked_sub(1))
                {
                    self.exit_code_left_by_tests = Some(code as u8);
                }
                w.first_loads.clear();
                w.first_loads.extend_from_slice(first_loads);

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
                    summary.shuffled += shuffled;
                }
                self.reporter.jest.unhandled_errors_between_tests += unhandled;
                self.record_timing(idx, w.dispatched_at);
                if let Some(reservation) = &mut self.reservation {
                    let path = self.files[idx as usize].as_bytes();
                    let record = (self.reporter.timings.as_ref()).and_then(|t| t.growth_of(path));
                    reservation.file_ends(w.idx as usize, rest, record.is_none().then_some(growth));
                }
                // A worker that can measure holds something itself. What it measured is written down where it is nothing too: a file
                // without a record is one that nobody has measured.
                if let Some(timings) =
                    (self.reporter.timings.as_mut()).filter(|_| growth > 0 || rest > 0)
                {
                    timings.record_growth(self.files[idx as usize].as_bytes(), growth);
                }

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
            frame::Kind::RefusedChange => {
                crate::cli::run_compiled::add_refused_change(rd.str().to_vec());
            }
            frame::Kind::Snapshots => {
                let [total, passed, failed, added, unwritten] = [(); 5].map(|()| rd.u32() as usize);
                if self.ends_as_in_one_process {
                    let snapshots = &mut self.reporter.jest.snapshots;
                    snapshots.total += total;
                    snapshots.passed += passed;
                    snapshots.failed += failed;
                    snapshots.added += added;
                    self.failed_to_write_inline_snapshots |= unwritten != 0;
                }
            }
            frame::Kind::Run | frame::Kind::Shutdown => {}
        }
    }

    fn dispatch_to(&mut self, w: &mut Worker, idx: u32) {
        let (record, is_heavy) = (self.record_of(idx), self.is_heavy(idx));
        if let Some(reservation) = &mut self.reservation {
            reservation.file_starts(w.idx as usize, record, is_heavy);
        }
        let file = self.files[idx as usize].as_bytes();
        let failures_until_bail = match self.ends_as_in_one_process {
            true => self.bail.saturating_sub(self.reporter.jest.summary.fail),
            false => 0,
        };
        w.dispatch(
            &mut self.frame,
            idx,
            file,
            self.exit_code_left_by_tests,
            self.ends_as_in_one_process,
            failures_until_bail,
        );
    }

    pub(crate) fn on_worker_exit(&mut self, w: &mut Worker, status: SpawnStatus, peak_rss_mb: u32) {
        self.max_exited_worker_rss_mb = self.max_exited_worker_rss_mb.max(peak_rss_mb);
        if let (Some(children), Some(process)) = (&mut self.children_of_workers, &w.process) {
            children.forget(process.pid as i64);
        }
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

    #[optimize(size)]
    fn run_pending_reaps(&mut self) {
        let n = self.spawned_count as usize;
        for i in 0..n {
            // SAFETY: `i < spawned_count <= workers.len()`. `base` is re-derived
            // each iteration: `reap_worker`'s slot walks retag the buffer,
            // popping any earlier derivation.
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

    #[optimize(size)]
    fn reap_worker(&mut self, slot: usize, status: &SpawnStatus) {
        // SAFETY: `slot < spawned_count <= workers.len()`; fresh root derivation, like each reborrow below.
        let w = unsafe { &mut *self.workers.as_mut_ptr().add(slot) };
        // Decrement here (not in onProcessExit) so drive() keeps pumping until
        // the IPC pipe has been drained and this reap actually runs.
        self.live_workers -= 1;
        if let Some(reservation) = &mut self.reservation {
            reservation.worker_ends(slot);
        }
        w.read_output_written_so_far();
        self.flush_captured(w);
        // Exited before the IPC handshake. `inflight` is None for these, so
        // the mid-file handling below never fires; the per-slot cap is what
        // bounds the respawn loop.
        let startup_failure = w.inflight.is_none() && !w.reached_ready;
        let worker_idx = w.idx;
        if let Some(idx) = w.inflight {
            // The dead worker skipped the between-files cleanup of what its
            // test spawned; it led its own process group, so kill(-pid) does it.
            #[cfg(unix)]
            if let Some(p) = &w.process {
                terminate_process_group(p.pid);
            }
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
            let panicked = is_panic_status(status) && !self.goes_on_after_crash();
            if self.stop_reason == Some(StopReason::WorkerPanicked) && !panicked {
                self.account_unfinished(idx, b"aborted: sibling worker panicked");
            } else {
                self.keep_timing(idx);
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
        } else if startup_failure && is_panic_status(status) && self.goes_on_after_crash() {
            // No file ran yet. The next file of the part pays, so that a part whose program brings every worker down comes to an end.
            let part = w.part as usize;
            let next = (self.parts.as_mut()).and_then(|parts| parts.list[part].range.pop_front());
            if let Some(idx) = next {
                self.break_dots();
                self.ensure_header(idx);
                let mut buf = [0u8; 32];
                self.account_crash(
                    idx,
                    bun_core::time::milli_timestamp(),
                    format_args!(
                        "worker crashed during startup: {}",
                        bstr::BStr::new(describe_status(&mut buf, status))
                    ),
                );
                Output::flush();
            }
        } else if startup_failure {
            w.startup_failures += 1;
            // A crash signal during init aborts the whole run, same as a
            // mid-file crash.
            if is_panic_status(status) {
                self.abort_on_worker_startup_panic(status);
            }
        } else if is_panic_status(status) && self.stop_reason != Some(StopReason::WorkerPanicked) {
            self.abort_on_idle_worker_panic(status);
        }

        // SAFETY: fresh derivation — `abort_on_worker_panic` above retags the slots.
        let w = unsafe { &mut *self.workers.as_mut_ptr().add(slot) };
        w.process = None;
        let startup_failures = w.startup_failures;
        if let Some(parts) = &mut self.parts {
            parts.worker_ended(w.part);
        }

        let can_respawn = self.parts.is_none()
            && self.stop_reason.is_none()
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
            match w.start(&SpawnContext {
                vm: self.vm,
                cwd: self.cwd,
                argv: &self.argv,
                envps: &self.envps,
                compiled_program: crate::cli::run_compiled::graph_descriptor(),
                programs_below: &[],
                inherits_output: false,
                #[cfg(windows)]
                windows_job: self.windows_job,
            }) {
                Ok(()) => {
                    self.live_workers += 1;
                    respawned = true;
                }
                Err(e) => {
                    Output::err(e, "failed to respawn test worker", ());
                }
            }
        }

        if !respawned {
            if self.parts.is_none() && self.stop_reason.is_none() && self.live_workers == 0 {
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

    /// In a run of several programs a worker that crashes costs the file that it ran. The rest of its part goes to another worker and
    /// no other worker is stopped, so that one run shows every crash of the compiled code and not the first.
    fn goes_on_after_crash(&self) -> bool {
        self.parts.is_some()
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
        if let Some(file) = self.test_records.get_mut(file_idx as usize) {
            file.unfinished = Some((b"(aborted)", reason.into()));
        }
    }

    fn mark_cut_short(
        &mut self,
        file_idx: u32,
        elapsed_ms: i64,
        name: &'static [u8],
        message: &[u8],
    ) {
        if let Some(file) = self.test_records.get_mut(file_idx as usize) {
            file.elapsed_ns = u64::try_from(elapsed_ms).unwrap_or(0) * bun_core::time::NS_PER_MS;
            file.started_unix_ms = bun_core::time::milli_timestamp() - elapsed_ms.max(0);
            file.unfinished = Some((name, message.into()));
        }
    }

    #[optimize(size)]
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
        self.mark_cut_short(
            file_idx,
            bun_core::time::milli_timestamp() - dispatched_at,
            b"(worker crashed)",
            b"worker process crashed before reporting results",
        );
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

    /// Like `abort_on_worker_panic`, for a worker that was idle or exiting after `.shutdown`.
    /// Every file may already have passed, so the crash is counted as its own error.
    fn abort_on_idle_worker_panic(&mut self, status: &SpawnStatus) {
        self.break_dots();
        let mut buf = [0u8; 32];
        bun_core::pretty_error!(
            concat!(
                "\n<red>error<r>: a test worker process crashed with <b>{}<r> while it was not running a test file.\n",
                "This indicates a bug in Bun or in a native addon, not in the test itself. Aborting.\n",
            ),
            bstr::BStr::new(describe_status(&mut buf, status)),
        );
        Output::flush();
        self.reporter.jest.unhandled_errors_between_tests += 1;
        self.terminate_workers_after_panic(b"aborted: worker panicked between files");
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
                terminate_process_group(p.pid);
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
        self.end_builds();
        if already_stopped {
            return;
        }
        self.abort_queued_files(sweep_reason);
    }

    /// Mark every not-yet-dispatched file as failed so `drive()` can exit
    /// instead of spinning when no live worker remains to make progress.
    fn abort_queued_files(&mut self, reason: &[u8]) {
        if let Some(mut parts) = self.parts.take() {
            for part in &mut parts.list {
                while let Some(idx) = part.range.pop_front() {
                    self.account_unfinished(idx, reason);
                }
            }
            self.parts = Some(parts);
        }
        for w in self.workers.iter_mut() {
            while let Some(idx) = w.range.pop_front() {
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
                if let Some(file) = self.test_records.get_mut(idx as usize) {
                    file.unfinished = Some((b"(aborted)", reason.into()));
                }
            }
        }
        Output::flush();
    }

    /// Takes what builds have finished, starts builds, and gives each free worker slot a part that has a program.
    fn advance_parts(&mut self) {
        self.take_finished_builds();
        if self.stop_reason.is_some() {
            return;
        }
        self.start_builds();
        self.start_workers();
    }

    fn take_finished_builds(&mut self) {
        let finished = match &mut self.parts {
            Some(parts) if !parts.finished.is_empty() => core::mem::take(&mut parts.finished),
            _ => return,
        };
        let mut a_layer_failed = false;
        for (index, status) in finished {
            let index = index as usize;
            let parts = self.parts.as_mut().expect("has parts");
            let position = (parts.builders.iter())
                .position(|builder| builder.part as usize == index)
                .expect("each finished build has a builder");
            let builder = parts.builders.swap_remove(position);
            match parts::layer_of(index as u32) {
                Some(_) => log_step_of_test_run(format_args!(
                    "the build has ended: {}",
                    parts.kind_of(index as u32).name()
                )),
                None => log_first_time_in_test_run("the first build of test files has ended"),
            }
            let messages = builder.take_messages();
            let exit_code = match &status {
                SpawnStatus::Exited(exited) => Some(u32::from(exited.code)),
                _ => None,
            };
            if let Some(layer) = parts::layer_of(index as u32) {
                // It was built beside a layer that failed, and was ended with it.
                if parts.layers[layer].state == PartState::Finished {
                    continue;
                }
                // Plain `bun test` needs no room there. The next build says again what this one has said.
                if exit_code == Some(PART_HAS_NO_ROOM)
                    && PROGRAMS_CAN_WAIT_IN_MEMORY
                    && !parts.layers[layer].is_in_memory
                {
                    parts.temporary_directory_is_full = true;
                    parts.layers[layer].state = PartState::Waiting;
                    parts.layers[layer].file = None;
                    // It holds the file that had no room.
                    parts.tell_build_above(layer, None);
                    self.break_dots();
                    bun_core::pretty_error!(
                        "<r><yellow>warn<r>: the temporary directory {} has no room for what the test files import, compiled. It is compiled again and kept in memory\n",
                        bstr::BStr::new(bun_resolver::fs::RealFS::tmpdir_path()),
                    );
                    Output::flush();
                    continue;
                }
                parts.print_messages(&messages);
                if exit_code == Some(0) {
                    parts.layers[layer].state = PartState::Ready;
                    parts.tell_build_above(layer, Some(true));
                    continue;
                }
                // Nothing of it could be compiled. What is built above it holds those files itself, and says what is wrong with them.
                if exit_code == Some(PART_HAS_NO_PROGRAM) {
                    parts.layers[layer].state = PartState::Ready;
                    parts.layers[layer].file = None;
                    parts.tell_build_above(layer, Some(false));
                    continue;
                }
                if exit_code == Some(PART_IS_BUILT_AGAIN) {
                    parts.layers[layer].state = PartState::Waiting;
                    parts.layers[layer].file = None;
                    continue;
                }
                parts.tell_build_above(layer, None);
                a_layer_failed = true;
                let failed = match parts.kind_of(index as u32) {
                    TestPartKind::SharedPackages => "the packages",
                    TestPartKind::SharedComputed => "what imports with computed names reach",
                    _ => "the files of the project",
                };
                // No test file has a program without it. That is said once, not for each of them.
                let file_count: u32 = parts.list.iter().map(|part| part.range.len()).sum();
                for part in parts.layers.iter_mut().chain(&mut parts.list) {
                    part.state = PartState::Finished;
                    part.file = None;
                    part.range = FileRange { lo: 0, hi: 0 };
                }
                let mut buf = [0u8; 32];
                self.break_dots();
                bun_core::pretty_error!(
                    "<r><red>error<r>: what the test files import {}, in the build of {}. None of the {} test files ran\n",
                    bstr::BStr::new(&describe_failed_build(&mut buf, &status)),
                    failed,
                    file_count,
                );
                Output::flush();
                self.reporter.summary().fail += file_count;
                self.reporter.summary().files += file_count;
                self.files_done += file_count;
                continue;
            }
            if self.stop_reason.is_some() {
                parts.list[index].state = PartState::Finished;
                continue;
            }
            let part = &mut parts.list[index];
            if matches!(exit_code, Some(0) | Some(PART_HAS_NO_PROGRAM)) {
                part.state = PartState::Ready;
                part.has_program = exit_code == Some(0);
                // Parts are cut by path, so that a program holds neighbours, which share imports. None of the
                // part's files has been handed out, so their order is free.
                let in_given_order = keeps_given_order(self.reporter.jest.test_options);
                let timings = self.reporter.timings.as_ref();
                if let Some(timings) = timings.filter(|t| !t.is_empty() && !in_given_order) {
                    let FileRange { lo, hi } = part.range;
                    timings.sort_slowest_first(&mut self.files[lo as usize..hi as usize]);
                }
                parts.print_messages_of_test_files(&messages);
                continue;
            }
            let mut buf = [0u8; 32];
            let file_count = parts.list[index].range.len();
            if file_count > 1 {
                parts.cut_into_single_files(index);
                if bun_core::env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true) {
                    parts.print_messages_of_test_files(&messages);
                }
                self.break_dots();
                bun_core::pretty_error!(
                    "<r><yellow>warn<r>: {} test files together {}. Each is compiled by itself\n",
                    file_count,
                    bstr::BStr::new(&describe_failed_build(&mut buf, &status)),
                );
                Output::flush();
                continue;
            }
            parts.print_messages_of_test_files(&messages);
            let part = &mut parts.list[index];
            let mut range = core::mem::replace(&mut part.range, FileRange { lo: 0, hi: 0 });
            part.state = PartState::Finished;
            part.file = None;
            let reason = describe_failed_build(&mut buf, &status);
            while let Some(file_idx) = range.pop_front() {
                self.keep_timing(file_idx);
                self.account_unfinished(file_idx, &reason);
            }
            Output::flush();
        }
        if a_layer_failed {
            self.end_builds();
        }
    }

    fn start_builds(&mut self) {
        while let Some(index) = self.parts.as_ref().and_then(|parts| {
            let in_given_order = keeps_given_order(self.reporter.jest.test_options);
            let timings = self.reporter.timings.as_ref();
            let timings = timings.filter(|t| !t.is_empty() && !in_given_order);
            let time_of = timings.map(|timings| {
                |files: FileRange| -> u64 {
                    let files = &self.files[files.lo as usize..files.hi as usize];
                    timings.costs_where_unknown_is_slow(files).iter().sum()
                }
            });
            let is_free = |w: &&Worker| {
                !w.alive
                    && w.process.is_none()
                    && !w.reap_pending
                    && w.exit_status.is_none()
                    && w.startup_failures < MAX_STARTUP_FAILURES
            };
            parts.next_to_build(
                self.workers.iter().filter(is_free).count() as u32,
                time_of.as_ref().map(|f| f as &dyn Fn(FileRange) -> u64),
                self.reservation.is_some(),
            )
        }) {
            // A build of test files takes room like a file.
            if let (None, Some(room), Some(reservation)) = (
                parts::layer_of(index),
                self.room_for_next_file(false),
                &self.reservation,
            ) && !room.has_for_light(reservation.largest_build())
            {
                return;
            }
            let parts = self.parts.as_mut().expect("has parts");
            let parts_ptr = &raw mut **parts;
            let layer = parts::layer_of(index);
            let kind = parts.kind_of(index);
            let below = parts.programs_below(layer.unwrap_or(parts.layers.len()));
            let is_above_library = parts.stands_on_library_of_this_bun;
            let in_memory = layer.is_some() && parts.temporary_directory_is_full;
            let pipe = match layer {
                Some(layer) if parts.begins_beside_build_below(layer) => {
                    let Ok(pipe) = bun_sys::pipe() else {
                        return;
                    };
                    parts.layers[layer - 1].tells_build_above = Some(pipe[1]);
                    Some(pipe)
                }
                _ => None,
            };
            let part = match layer {
                Some(layer) => &mut parts.layers[layer],
                None => &mut parts.list[index as usize],
            };
            let paths = self.files[part.range.lo as usize..part.range.hi as usize]
                .iter()
                .map(|path| path.as_bytes());
            // A program of test files is small, and it is built beside the tests and beside other such builds: it gets its share of
            // the processors. More threads cost more for the same work on a busy machine: 3.35, 4.3, 4.4 and 6.3 s of processor
            // time on 1, 2, 4 and 16, and past four it is no sooner done on an idle one. A layer is built alone.
            let share = u32::from(bun_core::get_thread_count()) / self.workers.len().max(1) as u32;
            let threads = (kind == TestPartKind::TestFiles).then_some(share.clamp(1, 4));
            let started = PartBuilder::start(
                index,
                paths,
                self.cwd_of_builds,
                self.vm,
                &self.envps[0],
                parts_ptr,
                kind,
                in_memory,
                &below,
                is_above_library,
                threads,
                pipe.map(|[read, _]| read),
                #[cfg(windows)]
                self.windows_job,
            );
            if let Some([read, _]) = pipe {
                read.close();
            }
            match started {
                Ok((builder, file)) => {
                    part.file = Some(file);
                    part.is_in_memory = in_memory;
                    part.state = PartState::Building;
                    parts.builders.push(builder);
                    match layer {
                        Some(_) => {
                            log_step_of_test_run(format_args!("the build begins: {}", kind.name()))
                        }
                        None => log_first_time_in_test_run("the first build of test files begins"),
                    }
                }
                Err(error) => {
                    Output::err(error, "failed to start the build of test files", ());
                    if self.live_workers == 0 && parts.builders.is_empty() {
                        Global::exit(1);
                    }
                    return;
                }
            }
        }
    }

    fn start_workers(&mut self) {
        let mut slot = 0;
        let mut any_can_start = false;
        while slot < self.workers.len() {
            let w = &self.workers[slot];
            let is_free =
                !w.alive && w.process.is_none() && !w.reap_pending && w.exit_status.is_none();
            let may_start = w.startup_failures < MAX_STARTUP_FAILURES;
            any_can_start |= may_start;
            if !is_free || !may_start {
                slot += 1;
                continue;
            }
            let waiting: Vec<u32> = (self.workers.iter())
                .filter(|w| w.alive && w.inflight.is_none())
                .map(|w| w.part)
                .collect();
            let parts = self.parts.as_ref().expect("has parts");
            let in_given_order = keeps_given_order(self.reporter.jest.test_options);
            let timings = self.reporter.timings.as_ref();
            let timings = timings.filter(|t| !t.is_empty() && !in_given_order);
            // A file nobody has timed may be slow, so it counts as the slowest, as in `sort_slowest_first`.
            let time_of = timings.map(|timings| {
                |file: FileRange| -> u64 {
                    let path = self.files[file.lo as usize].as_bytes();
                    timings.get(path).map_or(u64::MAX, u64::from)
                }
            });
            let time_of = time_of.as_ref().map(|f| f as &dyn Fn(FileRange) -> u64);
            let room = self.room_for_next_file(true);
            // The file of the part, from the given one on, that a worker would get now.
            let first_with_room = |part: &Part, first: u32| -> Option<u32> {
                let room = room.as_ref()?;
                let mut light =
                    (first..part.range.hi).filter(|idx| room.has_for_light(self.record_of(*idx)));
                match part.heavy_growth {
                    0 => light.next(),
                    growth => room.has_for_heavy(growth).then_some(first),
                }
            };
            let has_room_for = |part: &Part, first: u32| first_with_room(part, first).is_some();
            let has_room_for =
                (room.as_ref()).map(|_| &has_room_for as &dyn Fn(&Part, u32) -> bool);
            let next = match self.reporter.jest.test_options.parallel {
                0 => parts.next_in_order(),
                _ => parts.next_for_worker(&waiting, time_of, has_room_for),
            };
            let Some(index) = next else {
                break;
            };
            // Room is set aside from here on: the worker asks for its file only when it has started.
            let part = &parts.list[index as usize];
            let set_aside = first_with_room(part, part.range.lo)
                .map(|file_idx| (self.record_of(file_idx), part.heavy_growth > 0));
            if let (Some(reservation), Some((record, is_heavy))) =
                (&mut self.reservation, set_aside)
            {
                reservation.worker_starts(slot, Some(record), is_heavy);
            }
            self.start_worker_on_part(slot, index);
            slot += 1;
        }
        let parts = self.parts.as_ref().expect("has parts");
        if !any_can_start && self.live_workers == 0 && parts.builders.is_empty() {
            self.abort_queued_files(b"no live workers");
        }
    }

    fn start_worker_on_part(&mut self, slot: usize, index: u32) {
        log_first_time_in_test_run("the first worker is started");
        let parts = self.parts.as_mut().expect("has parts");
        let programs_below = parts.programs_below(parts.layers.len());
        let part = &mut parts.list[index as usize];
        let file = part.file.as_ref().expect("a part that is ready has a file");
        // After stdio and the channel to the coordinator.
        let flag = crate::cli::run_compiled::image_flag_of_test_worker(
            part.has_program,
            file.number_in_child(4),
            5..5 + programs_below.len(),
        );
        self.argv[parts.image_flag_slot] = crate::cli::cli_dupe_z(&flag);
        let compiled_program = cfg!(unix).then_some(file.descriptor);
        // SAFETY: `slot < workers.len()`.
        let w = unsafe { &mut *self.workers.as_mut_ptr().add(slot) };
        w.part = index;
        w.ipc = Default::default();
        // from_mut: keep write provenance on the stored backref (see spawn_worker).
        let w_ptr = std::ptr::from_mut::<Worker>(w).cast_const();
        w.out = WorkerPipe::new(w_ptr);
        w.err = WorkerPipe::new(w_ptr);
        w.reached_ready = false;
        match w.start(&SpawnContext {
            vm: self.vm,
            cwd: self.cwd,
            argv: &self.argv,
            envps: &self.envps,
            compiled_program,
            programs_below: &programs_below,
            inherits_output: self.ends_as_in_one_process,
            #[cfg(windows)]
            windows_job: self.windows_job,
        }) {
            Ok(()) => {
                part.workers += 1;
                self.live_workers += 1;
            }
            Err(e) => {
                w.startup_failures += 1;
                if let Some(reservation) = &mut self.reservation {
                    reservation.worker_ends(slot);
                }
                Output::err(e, "failed to spawn test worker", ());
            }
        }
    }

    /// Bail and panic stop the run, and the builds with it.
    fn end_builds(&mut self) {
        let Some(parts) = &self.parts else {
            return;
        };
        let builders = parts.builders.iter();
        let processes = builders.filter_map(|builder| builder.process.as_ref());
        for p in processes {
            #[cfg(unix)]
            terminate_process_group(p.pid);
            #[cfg(not(unix))]
            {
                let _ = p.kill(9);
            }
        }
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

/// SIGTERM to the process group a worker leads: the worker and everything it
/// spawned. Safe after the worker exited: the pid stays reserved while any
/// member of the group lives, and an empty group gives ESRCH.
#[cfg(unix)]
fn terminate_process_group(pid: libc::pid_t) {
    // SAFETY: FFI call; -pid targets the worker's process group.
    unsafe {
        let _ = libc::kill(-pid, libc::SIGTERM);
    }
}

/// Without `--parallel` the files run in the order in which plain `bun test` runs them in its one process.
fn keeps_given_order(options: &TestOptions) -> bool {
    options.randomize || options.parallel == 0
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

const SIGKILL: u8 = 9;

fn describe_failed_build(buf: &mut [u8; 32], status: &SpawnStatus) -> Vec<u8> {
    match status {
        SpawnStatus::Signaled(SIGKILL) => {
            b"could not be compiled: the system killed the build (SIGKILL), as it does when memory runs out"
                .to_vec()
        }
        SpawnStatus::Exited(exited) if u32::from(exited.code) == PART_HAS_NO_ROOM => {
            match PROGRAMS_CAN_WAIT_IN_MEMORY {
                true => &b"could not be compiled: neither memory nor the temporary directory has room for the program"[..],
                false => b"could not be compiled: the temporary directory has no room for the program",
            }
            .to_vec()
        }
        _ => [b"could not be compiled: ", describe_status(buf, status)].concat(),
    }
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

    /// The signal that asked for the abort, or 0. Windows console events count as SIGINT.
    pub(crate) static ABORT_SIGNAL: AtomicI32 = AtomicI32::new(0);

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
