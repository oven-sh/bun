//! `bun test --aot --aot-memory-limit`: a test file starts only where there is room for what it took when it was last measured.
//!
//! A build inside a test takes gigabytes within a second or two, so a look at what is resident comes too late. Room is set aside
//! instead, from when a file starts to when it ends: what `--timings` says the file took. Beside the files stand what each worker
//! holds between two files, the builds of test files, the coordinator, and what the control group counts that no process owns.
//! All of those are measured in the run.

use std::io::Write as _;

/// Everything is in megabytes.
pub(crate) struct Reservation {
    limit: u32,
    workers: Vec<Option<WorkerAtWork>>,
    /// What a worker holds from its start on is much the same for all. It is seen with something on top: when a worker has run its
    /// first test, with what its file has taken so far; when its first file has ended, with what the file left behind. The file's
    /// own record covers both, so the least that was seen counts.
    rest_of_new_worker: Option<u32>,
    /// The most that a file without a record took in this run: the next such file may take as much.
    largest_without_record: u32,
    /// The most that a build of test files held.
    largest_build: u32,
    /// The coordinator itself.
    own: u32,
    /// What the processes held that stood in the control group when the run began.
    of_others: u32,
    /// The kernel's own memory for the control group, and files that live in memory.
    of_no_process: u32,
    /// The folder of the control group whose limit binds, where it can be read.
    group: Option<Vec<u8>>,
    looked_at_ms: i64,
}

/// The most that a file may take to start now. None: no file may.
#[derive(Default, Clone, Copy)]
pub(crate) struct Room {
    pub(crate) for_heavy: Option<u32>,
    pub(crate) for_light: Option<u32>,
    /// The heaviest file that waits for nothing but room, or will in a moment, and what it needs. A lighter one leaves that free.
    pub(crate) heaviest_that_waits: (u32, u32),
}

impl Room {
    pub(crate) fn has_for_heavy(&self, file: u32) -> bool {
        let (heaviest, its_need) = self.heaviest_that_waits;
        let beside = if file < heaviest { its_need } else { 0 };
        self.for_heavy
            .is_some_and(|room| file.saturating_add(beside) <= room)
    }

    pub(crate) fn has_for_light(&self, file: u32) -> bool {
        self.for_light.is_some_and(|room| file <= room)
    }
}

#[derive(Clone, Copy)]
struct WorkerAtWork {
    /// What it held when its last file had ended. None: it has ended none.
    rest: Option<u32>,
    /// What its file took. None between two files.
    file: Option<u32>,
    has_run_test: bool,
    is_heavy: bool,
}

impl Reservation {
    pub(crate) const MS_BETWEEN_LOOKS: i64 = 200;

    pub(crate) fn new(limit_in_bytes: u64, workers: usize) -> Reservation {
        let mut reservation = Reservation {
            limit: u32::try_from(limit_in_bytes >> 20).unwrap_or(u32::MAX),
            workers: vec![None; workers],
            rest_of_new_worker: None,
            largest_without_record: 0,
            largest_build: 0,
            own: 0,
            of_others: 0,
            of_no_process: 0,
            group: super::super::memory_of_job::limit_of_control_groups().map(|(_, group)| group),
            looked_at_ms: 0,
        };
        reservation.look(&[]);
        let of_processes = reservation.read_of_group(&[b"anon "]).unwrap_or(0);
        reservation.of_others = of_processes.saturating_sub(reservation.own);
        reservation
    }

    /// A worker's share of the limit. A file that took more is heavy.
    pub(crate) fn share_of_worker(&self) -> u32 {
        self.limit / (self.workers.len() as u32).max(1)
    }

    pub(crate) fn largest_without_record(&self) -> u32 {
        self.largest_without_record
    }

    /// What a worker that starts will hold beside its files.
    pub(crate) fn rest_of_new_worker(&self) -> u32 {
        self.rest_of_new_worker.unwrap_or(0)
    }

    /// Nobody knows what a worker holds until one has run a test. Until then two run.
    pub(crate) fn may_start_worker(&self) -> bool {
        self.rest_of_new_worker.is_some() || self.workers.iter().flatten().count() < 2
    }

    pub(crate) fn knows_rest_of_workers(&self) -> bool {
        self.rest_of_new_worker.is_some()
    }

    pub(crate) fn largest_build(&self) -> u32 {
        self.largest_build
    }

    pub(crate) fn runs_heavy_file(&self) -> bool {
        self.workers.iter().flatten().any(|worker| worker.is_heavy)
    }

    fn taken(&self, builds: u32) -> u32 {
        let of_workers = self.workers.iter().flatten().map(|worker| {
            worker.rest.unwrap_or_else(|| self.rest_of_new_worker()) + worker.file.unwrap_or(0)
        });
        of_workers.sum::<u32>()
            + builds * self.largest_build
            + self.own
            + self.of_others
            + self.of_no_process
    }

    /// What is left where `more` is set aside as well. None: not even that fits.
    /// `builds`: how many builds of test files run. Where nothing runs there is room for anything: a run comes to its end.
    pub(crate) fn room_beside(&self, more: u32, builds: u32) -> Option<u32> {
        if builds == 0
            && self
                .workers
                .iter()
                .flatten()
                .all(|worker| worker.file.is_none())
        {
            return Some(u32::MAX);
        }
        self.limit
            .checked_sub(self.taken(builds).saturating_add(more))
    }

    /// How many workers live and have no file, and how many have not been started.
    pub(crate) fn workers_without_file(&self) -> (u32, u32) {
        let idle = self
            .workers
            .iter()
            .flatten()
            .filter(|worker| worker.file.is_none());
        let not_started = self.workers.iter().filter(|worker| worker.is_none());
        (idle.count() as u32, not_started.count() as u32)
    }

    /// `file`: what is set aside for the file that it will ask for.
    pub(crate) fn worker_starts(&mut self, slot: usize, file: Option<u32>, is_heavy: bool) {
        self.workers[slot] = Some(WorkerAtWork {
            rest: None,
            file,
            has_run_test: false,
            is_heavy,
        });
    }

    /// It has loaded what every worker loads.
    pub(crate) fn worker_has_run_test(&mut self, slot: usize, process: i64) {
        let Some(worker) = &mut self.workers[slot] else {
            return;
        };
        if core::mem::replace(&mut worker.has_run_test, true) {
            return;
        }
        let mut pid = Vec::new();
        let _ = write!(&mut pid, "{process}");
        if let Some(holds) = own_memory_of(&pid) {
            self.saw_new_worker_hold(holds);
        }
    }

    fn saw_new_worker_hold(&mut self, megabytes: u32) {
        let least = self
            .rest_of_new_worker
            .map_or(megabytes, |least| least.min(megabytes));
        self.rest_of_new_worker = Some(least);
    }

    pub(crate) fn file_starts(&mut self, slot: usize, file: u32, is_heavy: bool) {
        let before = self.workers[slot];
        self.workers[slot] = Some(WorkerAtWork {
            rest: before.and_then(|worker| worker.rest),
            file: Some(file),
            has_run_test: before.is_some_and(|worker| worker.has_run_test),
            is_heavy,
        });
    }

    /// The worker asks for a file: what was set aside when it started is free again.
    pub(crate) fn worker_asks(&mut self, slot: usize) {
        let before = self.workers[slot];
        self.workers[slot] = Some(WorkerAtWork {
            rest: before.and_then(|worker| worker.rest),
            file: None,
            has_run_test: before.is_some_and(|worker| worker.has_run_test),
            is_heavy: false,
        });
    }

    /// `took`: None for a file that had a record.
    pub(crate) fn file_ends(&mut self, slot: usize, rest: u32, took: Option<u32>) {
        if let Some(took) = took {
            self.largest_without_record = self.largest_without_record.max(took);
        }
        let Some(worker) = self.workers[slot] else {
            return;
        };
        if worker.rest.is_none() {
            self.saw_new_worker_hold(rest);
        }
        self.workers[slot] = Some(WorkerAtWork {
            rest: Some(rest),
            file: None,
            has_run_test: true,
            is_heavy: false,
        });
    }

    pub(crate) fn worker_ends(&mut self, slot: usize) {
        self.workers[slot] = None;
    }

    /// `builds`: the processes that build test files.
    pub(crate) fn look(&mut self, builds: &[i64]) {
        let now = bun_core::time::milli_timestamp();
        if now - self.looked_at_ms < Self::MS_BETWEEN_LOOKS {
            return;
        }
        self.looked_at_ms = now;
        self.own = own_memory_of(b"self").unwrap_or(self.own);
        for build in builds {
            let mut pid = Vec::new();
            let _ = write!(&mut pid, "{build}");
            self.largest_build = self.largest_build.max(own_memory_of(&pid).unwrap_or(0));
        }
        if let Some(of_no_process) = self.read_of_group(&[b"kernel ", b"shmem "]) {
            self.of_no_process = of_no_process;
        }
    }

    /// The sum of the lines of the group's memory.stat that begin with `names`.
    fn read_of_group(&self, names: &[&[u8]]) -> Option<u32> {
        let path = [self.group.as_deref()?, b"/memory.stat"].concat();
        let stat = bun_sys::File::read_from(bun_sys::Fd::cwd(), &path).ok()?;
        let bytes = bun_core::strings::split(&stat, b"\n").filter_map(|line| {
            let number = names.iter().find_map(|name| line.strip_prefix(*name))?;
            bun_core::fmt::parse_int::<u64>(number.trim_ascii(), 10).ok()
        });
        Some(u32::try_from(bytes.sum::<u64>() >> 20).unwrap_or(u32::MAX))
    }
}

/// What a process holds that it shares with nobody.
fn own_memory_of(pid: &[u8]) -> Option<u32> {
    let path = [b"/proc/", pid, b"/statm"].concat();
    let statm = bun_sys::File::read_from(bun_sys::Fd::cwd(), &path).ok()?;
    let kilobytes = own_kilobytes_in(&statm, bun_sys::page_size())?;
    Some(u32::try_from(kilobytes / 1024).unwrap_or(u32::MAX))
}

/// `statm`: /proc/<pid>/statm, "size resident shared ..", in pages. A page is 4 KB on most machines, 16 or 64 KB on some.
pub(crate) fn own_kilobytes_in(statm: &[u8], page_size: usize) -> Option<u64> {
    let mut pages = bun_core::strings::split(statm, b" ")
        .map(|field| bun_core::fmt::parse_int::<u64>(field.trim_ascii(), 10).ok());
    let (resident, shared) = (pages.nth(1)??, pages.next()??);
    Some(resident.saturating_sub(shared) * (page_size as u64 / 1024))
}

#[cfg(test)]
mod tests {
    use super::own_kilobytes_in;

    #[test]
    fn counts_pages_by_their_size() {
        let statm = b"500000 32768 768 1 0 40000 0\n";
        assert_eq!(own_kilobytes_in(statm, 4 << 10), Some(32000 * 4));
        assert_eq!(own_kilobytes_in(statm, 16 << 10), Some(32000 * 16));
        assert_eq!(own_kilobytes_in(statm, 64 << 10), Some(32000 * 64));
    }

    #[test]
    fn reads_what_the_kernel_may_write() {
        assert_eq!(own_kilobytes_in(b"9 1 2 0 0 0 0\n", 4 << 10), Some(0));
        assert_eq!(own_kilobytes_in(b"9 5 2\n", 4 << 10), Some(12));
        assert_eq!(own_kilobytes_in(b"9 5", 4 << 10), None);
        assert_eq!(own_kilobytes_in(b"", 4 << 10), None);
    }
}
