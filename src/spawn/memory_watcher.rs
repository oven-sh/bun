//! `Bun.spawn({ maxMemory })`: kill a child tree that crosses its memory limit. The kernel enforces it where it can (Windows job, Linux cgroup); one thread samples otherwise.

use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use bun_threading::{Condvar, Guarded};

use crate::process::PidT;

/// False where this module cannot measure a process tree, so `maxMemory` and `memoryUsage()` must be refused.
pub const SUPPORTED: bool = cfg!(any(
    target_os = "macos",
    target_os = "linux",
    target_os = "android",
    windows
));

/// The start time of a pid. `Unknown` is a read that failed for a reason other than "no such process", so it must not end a watch.
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Identity {
    Is(u64),
    Gone,
    Unknown,
}

/// A process seen in the tree, with its start time so a recycled pid is never counted or signalled.
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
struct Member {
    pid: PidT,
    identity: u64,
    /// False until `kill` reached it, so a later sample can signal a process that was new or could not be read.
    signalled: bool,
}

pub struct Watch {
    #[cfg(not(windows))]
    pid: PidT,
    limit: u64,
    #[cfg(not(windows))]
    signal: u8,
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    identity: u64,
    /// Kept across samples so a descendant that is reparented to init stays in the tree.
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    members: Guarded<Vec<Member>>,
    last: AtomicU64,
    peak: AtomicU64,
    exceeded: AtomicBool,
    done: AtomicBool,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    cgroup: Option<cgroup::Cgroup>,
    #[cfg(windows)]
    id: usize,
    #[cfg(windows)]
    job: bun_sys::windows::HANDLE,
    #[cfg(windows)]
    process: bun_sys::windows::HANDLE,
    #[cfg(windows)]
    notified: AtomicBool,
}

// SAFETY: HANDLEs are process-global kernel object references; every other field is atomic, locked or immutable.
#[cfg(windows)]
unsafe impl Send for Watch {}
#[cfg(windows)]
unsafe impl Sync for Watch {}

impl Watch {
    /// What enforces the limit: `"job"` or `"cgroup"` when the kernel does, `"sampler"` when this module's thread does.
    pub fn route(&self) -> &'static str {
        #[cfg(windows)]
        if self.notified.load(Ordering::Acquire) {
            return "job";
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if self.cgroup.is_some() {
            return "cgroup";
        }
        "sampler"
    }

    pub fn exceeded(&self) -> bool {
        self.exceeded.load(Ordering::Acquire)
    }

    pub fn peak(&self) -> u64 {
        self.peak.load(Ordering::Acquire)
    }

    /// Call when the root process has exited, before its pid can be reused.
    pub fn unwatch(&self) {
        self.done.store(true, Ordering::Release);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if let Some(cgroup) = &self.cgroup {
            if cgroup.settle() {
                self.exceeded.store(true, Ordering::Release);
            }
        }
        #[cfg(windows)]
        os::finish(self);
    }

    /// The tree's memory right now. This runs on the JS thread, so it uses only the cheap per-process numbers.
    pub fn sample_now(&self) -> u64 {
        self.sample()
    }

    fn sample(&self) -> u64 {
        // A tick that could not be measured changes nothing: it must not kill, and it must not end the watch.
        let Some(usage) = self.measure() else {
            return self.last.load(Ordering::Acquire);
        };
        self.last.store(usage, Ordering::Release);
        self.peak.fetch_max(usage, Ordering::AcqRel);
        // After the first kill, later samples signal any member that is new or was missed.
        if usage > self.limit || self.exceeded() {
            self.kill();
        }
        usage
    }

    /// False when the root is gone or its pid now names another process. `None` when that could not be read.
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    fn root_is_alive(&self) -> Option<bool> {
        match os::identity(self.pid) {
            Identity::Unknown => None,
            Identity::Gone => Some(false),
            Identity::Is(start) => Some(self.identity == 0 || start == self.identity),
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn measure(&self) -> Option<u64> {
        if !self.root_is_alive()? {
            self.done.store(true, Ordering::Release);
            return None;
        }
        if let Some(cgroup) = &self.cgroup {
            if cgroup.exceeded() {
                self.kill();
            }
            return Some(cgroup.usage());
        }
        let estimate = self.walk();
        // The cheap sum counts a shared page once per process, so it can only be too high. Confirm before a kill.
        if estimate > self.limit && !self.exceeded() {
            if let Some(exact) = self.exact() {
                return Some(exact);
            }
        }
        Some(estimate)
    }

    #[cfg(target_os = "macos")]
    fn measure(&self) -> Option<u64> {
        if !self.root_is_alive()? {
            self.done.store(true, Ordering::Release);
            return None;
        }
        Some(self.walk())
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
    fn measure(&self) -> Option<u64> {
        Some(os::tree_usage(self))
    }

    /// Refresh `members` and return the sum of their cheap footprints.
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    fn walk(&self) -> u64 {
        let mut members = self.members.lock();
        let mut walker = os::Walker::default();
        let mut order: Vec<PidT> = Vec::with_capacity(members.len() + 4);
        let mut kids: Vec<PidT> = Vec::new();
        let mut stack: Vec<PidT> = vec![self.pid];
        // A member that could not be read this time stays a member, but it is not walked or counted.
        let mut unreadable: Vec<Member> = Vec::new();
        for pass in 0..2 {
            while let Some(pid) = stack.pop() {
                if order.contains(&pid) {
                    continue;
                }
                order.push(pid);
                kids.clear();
                walker.children(pid, &mut kids);
                stack.extend_from_slice(&kids);
            }
            if pass == 0 {
                for m in members.iter().filter(|m| !order.contains(&m.pid)) {
                    match os::identity(m.pid) {
                        Identity::Is(start) if start == m.identity => stack.push(m.pid),
                        Identity::Unknown => unreadable.push(Member {
                            pid: m.pid,
                            identity: m.identity,
                            signalled: m.signalled,
                        }),
                        _ => {}
                    }
                }
            }
        }
        let mut total = 0u64;
        let mut next: Vec<Member> = Vec::with_capacity(order.len() + unreadable.len());
        for pid in order {
            let (identity, signalled) = match members.iter().find(|m| m.pid == pid) {
                Some(m) => (m.identity, m.signalled),
                None => match os::identity(pid) {
                    Identity::Is(start) => (start, false),
                    _ => continue,
                },
            };
            total += walker.footprint(pid);
            next.push(Member {
                pid,
                identity,
                signalled,
            });
        }
        next.append(&mut unreadable);
        *members = next;
        total
    }

    /// `None` on a kernel with no `smaps_rollup`. A member that cannot be read exactly uses its own cheap number, so one failed read cannot make the whole tree look too big.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn exact(&self) -> Option<u64> {
        if !os::has_exact_footprint() {
            return None;
        }
        let members = self.members.lock();
        let mut walker = os::Walker::default();
        Some(
            members
                .iter()
                .map(|m| os::exact_footprint(m.pid, &mut walker))
                .sum(),
        )
    }

    /// Safe to call on every sample: each member is signalled one time, and a member that was missed is tried again.
    fn kill(&self) {
        if self.done.load(Ordering::Acquire) {
            return;
        }
        self.exceeded.store(true, Ordering::Release);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if let Some(cgroup) = &self.cgroup {
            cgroup.kill_all();
            return;
        }
        self.kill_tree();
    }

    /// Children first, so a shell cannot see its child die and start a replacement before its own signal arrives.
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    fn kill_tree(&self) {
        for m in self
            .members
            .lock()
            .iter_mut()
            .rev()
            .filter(|m| !m.signalled)
        {
            if os::identity(m.pid) != Identity::Is(m.identity) {
                continue;
            }
            // SAFETY: kill(2) has no memory-safety preconditions.
            let sent = unsafe { libc::kill(m.pid, self.signal as core::ffi::c_int) } == 0;
            m.signalled =
                sent || std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH);
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
    fn kill_tree(&self) {
        os::kill_tree(self);
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        #[cfg(windows)]
        os::close(self);
    }
}

static ENTRIES: Guarded<Vec<Arc<Watch>>> = Guarded::new(Vec::new());
static WAKE: Condvar = Condvar::new();
static THREAD_STARTED: AtomicBool = AtomicBool::new(false);

const MIN_INTERVAL: Duration = Duration::from_millis(1);
const MAX_INTERVAL: Duration = Duration::from_millis(100);

/// A child that only touches fresh pages reaches about this rate. The sleep is how long such a child needs to use the headroom.
const WORST_CASE_BYTES_PER_SEC: u128 = 10 << 30;

/// Never spend more than a fifth of one core on sampling, however large the trees are.
fn interval_for(headroom_bytes: u64, sample_cost: Duration) -> Duration {
    let nanos = u128::from(headroom_bytes) * 1_000_000_000 / WORST_CASE_BYTES_PER_SEC;
    Duration::from_nanos(nanos.min(MAX_INTERVAL.as_nanos()) as u64)
        .max(MIN_INTERVAL)
        .max(sample_cost * 4)
}

#[cfg(any(target_os = "linux", target_os = "android"))]
fn has_background_work() -> bool {
    cgroup::has_pending_rmdir()
}

#[cfg(not(any(target_os = "linux", target_os = "android")))]
fn has_background_work() -> bool {
    false
}

fn run() {
    let mut snapshot: Vec<Arc<Watch>> = Vec::new();
    let mut guard = ENTRIES.lock();
    loop {
        // A watch can own a cgroup whose drop takes this lock, so the last reference must go away after the unlock.
        let mut dead: Vec<Arc<Watch>> = Vec::new();
        guard.retain(|e| {
            let done = e.done.load(Ordering::Acquire);
            if done {
                dead.push(Arc::clone(e));
            }
            !done
        });
        if !dead.is_empty() {
            drop(guard);
            drop(dead);
            guard = ENTRIES.lock();
            continue;
        }
        if guard.is_empty() && !has_background_work() {
            WAKE.wait_guarded(&mut guard);
            continue;
        }
        snapshot.extend(guard.iter().map(Arc::clone));
        drop(guard);

        let started = Instant::now();
        let mut min_headroom = u64::MAX;
        for e in &snapshot {
            if e.done.load(Ordering::Acquire) {
                continue;
            }
            let usage = e.sample();
            // A tree that is already being killed needs a retry now and then, not the 1 ms rate.
            if !e.exceeded() {
                min_headroom = min_headroom.min(e.limit.saturating_sub(usage));
            }
        }
        snapshot.clear();
        #[cfg(any(target_os = "linux", target_os = "android"))]
        cgroup::retry_pending_rmdir();
        let interval = interval_for(min_headroom, started.elapsed());

        guard = ENTRIES.lock();
        let _ = WAKE.timed_wait_guarded(&mut guard, interval.as_nanos() as u64);
    }
}

/// Start the background thread before the child exists, so a failure is an error and never a child with no limit.
pub fn ensure_ready() -> std::io::Result<()> {
    if THREAD_STARTED.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let spawned = std::thread::Builder::new()
        .name("MemoryWatcher".into())
        .stack_size(256 * 1024)
        .spawn(run);
    if let Err(e) = spawned {
        THREAD_STARTED.store(false, Ordering::Release);
        return Err(e);
    }
    Ok(())
}

/// Memory of an unwatched child's tree. Windows counts only the root process, because there is no Job Object to ask.
pub fn usage(pid: PidT, #[cfg(windows)] process: bun_sys::windows::HANDLE) -> u64 {
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    {
        os::usage_of(pid)
    }
    #[cfg(windows)]
    {
        let _ = pid;
        bun_sys::windows::GetProcessMemoryInfo(process)
            .map(|c| c.PagefileUsage as u64)
            .unwrap_or(0)
    }
    #[cfg(not(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "android",
        windows
    )))]
    {
        let _ = pid;
        0
    }
}

pub struct WatchOptions {
    pub pid: PidT,
    pub limit: u64,
    pub signal: u8,
    #[cfg(windows)]
    pub process: bun_sys::windows::HANDLE,
    /// The cgroup the child was spawned into, where the kernel enforces the limit.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub cgroup: Option<cgroup::Cgroup>,
}

/// Call `ensure_ready` first.
pub fn watch(opts: &mut WatchOptions) -> Arc<Watch> {
    let entry = Arc::new(Watch {
        #[cfg(not(windows))]
        pid: opts.pid,
        limit: opts.limit,
        #[cfg(not(windows))]
        signal: opts.signal,
        #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
        identity: match os::identity(opts.pid) {
            Identity::Is(start) => start,
            _ => 0,
        },
        #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
        members: Guarded::new(Vec::new()),
        last: AtomicU64::new(0),
        peak: AtomicU64::new(0),
        exceeded: AtomicBool::new(false),
        done: AtomicBool::new(false),
        #[cfg(any(target_os = "linux", target_os = "android"))]
        cgroup: opts.cgroup.take(),
        #[cfg(windows)]
        id: os::next_id(),
        #[cfg(windows)]
        job: os::create_job(opts.process),
        #[cfg(windows)]
        process: os::duplicate(opts.process),
        #[cfg(windows)]
        notified: AtomicBool::new(false),
    });
    // A child can allocate a lot before the thread's first tick; sample once synchronously.
    entry.sample();

    #[cfg(windows)]
    if os::arm_kernel_limit(&entry) {
        return entry;
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if entry.cgroup.as_ref().is_some_and(|c| c.kills_whole_group()) {
        return entry;
    }

    ENTRIES.lock().push(Arc::clone(&entry));
    WAKE.notify_one();
    entry
}

/// A memory cgroup that Bun creates for one child tree, so the kernel enforces `maxMemory`.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub mod cgroup {
    use bun_core::ZBox;
    use bun_sys::{Fd, File, O};
    use core::sync::atomic::{AtomicU32, Ordering};

    pub struct Cgroup {
        path: Vec<u8>,
        v2: bool,
        group_kill: bool,
        /// v1 only: the kernel adds to this eventfd each time this cgroup itself runs out of memory.
        oom_events: Option<File>,
        own_oom: core::sync::atomic::AtomicBool,
    }

    static NEXT: AtomicU32 = AtomicU32::new(0);
    static PENDING_RMDIR: bun_threading::Guarded<Vec<Vec<u8>>> =
        bun_threading::Guarded::new(Vec::new());

    fn read(dir: &[u8], name: &str) -> Option<Vec<u8>> {
        File::read_from(Fd::cwd(), &[dir, b"/", name.as_bytes()].concat()).ok()
    }

    fn write(dir: &[u8], name: &str, value: &[u8]) -> bun_sys::Maybe<()> {
        File::openat(
            Fd::cwd(),
            &[dir, b"/", name.as_bytes()].concat(),
            O::WRONLY,
            0,
        )?
        .write_all(value)
    }

    fn number(bytes: &[u8]) -> u64 {
        core::str::from_utf8(bytes)
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0)
    }

    /// The value after `key` in a "key value" per line file such as `memory.events`.
    fn field(bytes: &[u8], key: &[u8]) -> Option<u64> {
        for line in bun_core::strings::split(bytes, b"\n") {
            if let Some((k, v)) = bun_core::strings::split_once_char(line, b' ') {
                if k == key {
                    return Some(number(v));
                }
            }
        }
        None
    }

    /// With swap and no swap cap, a child over its limit is swapped out and never killed.
    fn has_swap() -> bool {
        read(b"/proc", "swaps").is_some_and(|b| bun_core::strings::count_char(&b, b'\n') > 1)
    }

    fn rmdir(path: &[u8]) -> bun_sys::Maybe<()> {
        bun_sys::rmdir(&ZBox::from_bytes(path))
    }

    pub(super) fn has_pending_rmdir() -> bool {
        !PENDING_RMDIR.lock().is_empty()
    }

    /// Only a cgroup that still holds processes can be removed later. A directory that is gone, or not ours, never can.
    fn is_busy(err: &bun_sys::Error) -> bool {
        matches!(err.get_errno(), bun_sys::E::EBUSY | bun_sys::E::ENOTEMPTY)
    }

    /// A cgroup cannot be removed until its killed processes are gone, so the sampler thread retries.
    pub(super) fn retry_pending_rmdir() {
        PENDING_RMDIR
            .lock()
            .retain(|path| rmdir(path).is_err_and(|err| is_busy(&err)));
    }

    /// v1 has no counter for "this cgroup's own limit could not be met", so ask for the kernel's OOM event on it.
    fn register_v1_oom_events(path: &[u8]) -> Option<File> {
        // SAFETY: eventfd has no memory-safety preconditions.
        let raw = unsafe { libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC) };
        if raw < 0 {
            return None;
        }
        let events = File::from_fd(Fd::from_native(raw));
        let control = File::openat(
            Fd::cwd(),
            &[path, b"/memory.oom_control"].concat(),
            O::RDONLY,
            0,
        )
        .ok()?;
        let request = format!("{} {}", raw, control.handle().native());
        write(path, "cgroup.event_control", request.as_bytes()).ok()?;
        Some(events)
    }

    /// Only places inside our own cgroup: a sibling would leave our systemd unit or container and escape its limits.
    fn candidates(name: &str) -> Vec<(Vec<u8>, bool)> {
        let mut out = Vec::new();
        let Some(own) = read(b"/proc/self", "cgroup") else {
            return out;
        };
        for line in bun_core::strings::split(&own, b"\n") {
            let Some((controllers, path)) = bun_core::strings::split_once_char(line, b':')
                .and_then(|(_, rest)| bun_core::strings::split_once_char(rest, b':'))
            else {
                continue;
            };
            let path = path.strip_suffix(b"/").unwrap_or(path);
            if bun_core::strings::split(controllers, b",").any(|c| c == b"memory") {
                // v1 lets a cgroup that holds processes have child cgroups with their own limit.
                let dir = [b"/sys/fs/cgroup/memory", path, b"/", name.as_bytes()].concat();
                out.push((dir, false));
            } else if controllers.is_empty() && path.is_empty() {
                // v2 allows that only in the real root cgroup.
                out.push((format!("/sys/fs/cgroup/{name}").into_bytes(), true));
            }
        }
        out
    }

    impl Cgroup {
        /// `None` when this process may not create a memory cgroup inside its own; the caller then samples.
        pub fn create(limit: u64) -> Option<Cgroup> {
            // SAFETY: getpid has no preconditions.
            let pid = unsafe { libc::getpid() };
            let name = format!("bun-{pid}-{}", NEXT.fetch_add(1, Ordering::Relaxed));
            let limit = limit.to_string();
            for (path, v2) in candidates(&name) {
                if bun_sys::mkdir(&ZBox::from_bytes(&path), 0o755).is_err() {
                    continue;
                }
                let limited = if v2 {
                    write(&path, "memory.max", limit.as_bytes())
                } else {
                    write(&path, "memory.limit_in_bytes", limit.as_bytes())
                };
                let swap_capped = if v2 {
                    write(&path, "memory.swap.max", b"0")
                } else {
                    write(&path, "memory.memsw.limit_in_bytes", limit.as_bytes())
                };
                // A v1 cgroup must report its OOM kills (Linux 4.13) and must not inherit a disabled OOM killer, which freezes the tree at the limit.
                let reports_kills = v2
                    || read(&path, "memory.oom_control").is_some_and(|b| {
                        field(&b, b"oom_kill").is_some()
                            && field(&b, b"oom_kill_disable").unwrap_or(0) == 0
                    });
                if limited.is_err() || !reports_kills || (swap_capped.is_err() && has_swap()) {
                    let _ = rmdir(&path);
                    continue;
                }
                let oom_events = if v2 {
                    None
                } else {
                    register_v1_oom_events(&path)
                };
                if !v2 && oom_events.is_none() {
                    let _ = rmdir(&path);
                    continue;
                }
                let group_kill = v2 && write(&path, "memory.oom.group", b"1").is_ok();
                return Some(Cgroup {
                    path,
                    v2,
                    group_kill,
                    oom_events,
                    own_oom: core::sync::atomic::AtomicBool::new(false),
                });
            }
            None
        }

        pub fn path(&self) -> &[u8] {
            &self.path
        }

        /// False when the kernel kills one process at the limit and leaves the rest; the sampler thread then finishes the job.
        pub(super) fn kills_whole_group(&self) -> bool {
            self.group_kill
        }

        /// Anonymous and shared memory, which a process cannot give back. Page cache from file I/O is left out.
        pub(super) fn usage(&self) -> u64 {
            let Some(stat) = read(&self.path, "memory.stat") else {
                return 0;
            };
            let sum = |anon: &[u8], shmem: &[u8]| {
                Some(field(&stat, anon)? + field(&stat, shmem).unwrap_or(0))
            };
            if self.v2 {
                sum(b"anon", b"shmem").unwrap_or(0)
            } else {
                sum(b"total_rss", b"total_shmem")
                    .or_else(|| sum(b"rss", b"shmem"))
                    .unwrap_or(0)
            }
        }

        /// A member was OOM-killed because this cgroup's own limit could not be met. A kill by the host or by a parent cgroup does not count, and a limit hit that reclaim solved does not count.
        pub(super) fn exceeded(&self) -> bool {
            if self.v2 {
                let Some(events) = read(&self.path, "memory.events.local")
                    .or_else(|| read(&self.path, "memory.events"))
                else {
                    return false;
                };
                // `oom` rises only when this cgroup's own limit could not be met. `oom_group_kill` also rises for a host or parent OOM.
                return field(&events, b"oom").unwrap_or(0) > 0
                    && field(&events, b"oom_kill").unwrap_or(0) > 0;
            }
            if let Some(events) = &self.oom_events {
                let mut count = [0u8; 8];
                let fired =
                    events.read(&mut count).is_ok_and(|n| n == 8) && u64::from_ne_bytes(count) > 0;
                // The event also fires when a parent cgroup runs out of memory, so this cgroup must have reached its own limit too.
                if fired && self.reached_own_limit() {
                    self.own_oom.store(true, Ordering::Release);
                }
            }
            self.own_oom.load(Ordering::Acquire)
                && read(&self.path, "memory.oom_control")
                    .is_some_and(|b| field(&b, b"oom_kill").unwrap_or(0) > 0)
        }

        fn reached_own_limit(&self) -> bool {
            let peak = read(&self.path, "memory.max_usage_in_bytes").map(|b| number(&b));
            let limit = read(&self.path, "memory.limit_in_bytes").map(|b| number(&b));
            matches!((peak, limit), (Some(peak), Some(limit)) if limit > 0 && peak >= limit)
        }

        pub(super) fn kill_all(&self) {
            if self.v2 && write(&self.path, "cgroup.kill", b"1").is_ok() {
                return;
            }
            if let Some(procs) = read(&self.path, "cgroup.procs") {
                for pid in bun_core::strings::split(&procs, b"\n") {
                    let pid = number(pid) as libc::pid_t;
                    if pid > 0 {
                        // SAFETY: kill(2) has no memory-safety preconditions.
                        unsafe { libc::kill(pid, libc::SIGKILL) };
                    }
                }
            }
        }

        /// When the kernel killed for the limit, kill what it left alive and return true.
        pub fn settle(&self) -> bool {
            let exceeded = self.exceeded();
            if exceeded {
                self.kill_all();
            }
            exceeded
        }
    }

    impl Drop for Cgroup {
        fn drop(&mut self) {
            if rmdir(&self.path).is_err_and(|err| is_busy(&err)) {
                // The sampler checks this list under `ENTRIES` before it sleeps, so the push must be under it too.
                let entries = super::ENTRIES.lock();
                PENDING_RMDIR.lock().push(core::mem::take(&mut self.path));
                drop(entries);
                super::WAKE.notify_one();
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod os {
    use super::{Identity, PidT};
    use core::ffi::{c_int, c_void};

    #[repr(C)]
    #[derive(Default)]
    struct RusageInfoV0 {
        ri_uuid: [u8; 16],
        ri_user_time: u64,
        ri_system_time: u64,
        ri_pkg_idle_wkups: u64,
        ri_interrupt_wkups: u64,
        ri_pageins: u64,
        ri_wired_size: u64,
        ri_resident_size: u64,
        ri_phys_footprint: u64,
        ri_proc_start_abstime: u64,
        ri_proc_exit_abstime: u64,
    }

    unsafe extern "C" {
        fn proc_pid_rusage(pid: c_int, flavor: c_int, buffer: *mut RusageInfoV0) -> c_int;
    }

    pub(super) struct Walker {
        buf: Vec<c_int>,
    }

    impl Default for Walker {
        fn default() -> Self {
            Walker { buf: vec![0; 64] }
        }
    }

    impl Walker {
        pub(super) fn children(&mut self, pid: PidT, out: &mut Vec<PidT>) {
            loop {
                let cap = c_int::try_from(self.buf.len() * core::mem::size_of::<c_int>())
                    .unwrap_or(c_int::MAX);
                // SAFETY: `buf` is a writable buffer of `cap` bytes.
                let n = unsafe {
                    bun_sys::c::proc_listchildpids(pid, self.buf.as_mut_ptr().cast::<c_void>(), cap)
                };
                if n <= 0 {
                    return;
                }
                let n = n as usize;
                if n >= self.buf.len() {
                    self.buf.resize(self.buf.len() * 2, 0);
                    continue;
                }
                out.extend_from_slice(&self.buf[..n]);
                return;
            }
        }

        /// `phys_footprint` is what Activity Monitor shows and what the kernel's own limits use.
        pub(super) fn footprint(&mut self, pid: PidT) -> u64 {
            let mut info = RusageInfoV0::default();
            // SAFETY: `info` is a valid out-buffer of the size `RUSAGE_INFO_V0` (flavor 0) writes.
            if unsafe { proc_pid_rusage(pid, 0, &raw mut info) } != 0 {
                return 0;
            }
            info.ri_phys_footprint
        }
    }

    pub(super) fn usage_of(root: PidT) -> u64 {
        let mut walker = Walker::default();
        let mut stack = vec![root];
        let mut kids = Vec::new();
        let mut total = 0u64;
        while let Some(pid) = stack.pop() {
            total += walker.footprint(pid);
            kids.clear();
            walker.children(pid, &mut kids);
            stack.extend_from_slice(&kids);
        }
        total
    }

    pub(super) fn identity(pid: PidT) -> Identity {
        let mut info: bun_sys::c::struct_proc_bsdinfo = bun_core::ffi::zeroed();
        let size = core::mem::size_of::<bun_sys::c::struct_proc_bsdinfo>() as c_int;
        // SAFETY: `info` is a valid out-buffer of `size` bytes.
        let n = unsafe {
            bun_sys::c::proc_pidinfo(
                pid,
                bun_sys::c::PROC_PIDTBSDINFO,
                0,
                (&raw mut info).cast::<c_void>(),
                size,
            )
        };
        if n == size {
            return Identity::Is(
                info.pbi_start_tvsec
                    .wrapping_mul(1_000_000)
                    .wrapping_add(info.pbi_start_tvusec),
            );
        }
        if std::io::Error::last_os_error().raw_os_error() == Some(libc::ESRCH) {
            Identity::Gone
        } else {
            Identity::Unknown
        }
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
mod os {
    use super::{Identity, PidT};
    use bun_sys::{Fd, FdExt, File, O, SizeHint};
    use core::sync::atomic::{AtomicU8, Ordering};

    fn read_small(path: &str, buf: &mut Vec<u8>) -> bun_sys::Maybe<()> {
        buf.clear();
        File::openat(Fd::cwd(), path.as_bytes(), O::RDONLY, 0)?
            .read_to_end_with_array_list(buf, SizeHint::ProbablySmall)
            .map(|_| ())
    }

    /// Only these errors mean that the process does not exist. A full fd table or a hidden `/proc` entry does not.
    fn is_gone(err: &bun_sys::Error) -> bool {
        matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ESRCH)
    }

    fn parse<T: core::str::FromStr>(bytes: &[u8]) -> Option<T> {
        core::str::from_utf8(bytes).ok()?.trim().parse().ok()
    }

    fn page_size() -> u64 {
        // SAFETY: sysconf has no preconditions.
        let n = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if n > 0 { n as u64 } else { 4096 }
    }

    /// The fields of `/proc/<pid>/stat` after the command name, which can itself hold spaces and parentheses.
    fn stat_fields(buf: &[u8]) -> Option<bun_core::strings::TokenizeIterator<'_>> {
        let close = bun_core::strings::last_index_of_char(buf, b')')?;
        Some(bun_core::strings::tokenize(&buf[close + 1..], b" "))
    }

    const UNKNOWN: u8 = 0;
    const YES: u8 = 1;
    const NO: u8 = 2;
    /// `/proc/<pid>/task/<tid>/children` needs `CONFIG_PROC_CHILDREN`, which some kernels and sandboxes lack.
    static HAS_CHILDREN_FILES: AtomicU8 = AtomicU8::new(UNKNOWN);

    fn has_children_files() -> bool {
        match HAS_CHILDREN_FILES.load(Ordering::Relaxed) {
            YES => true,
            NO => false,
            _ => {
                // SAFETY: getpid has no preconditions.
                let pid = unsafe { libc::getpid() };
                let mut buf = Vec::new();
                let yes = read_small(&format!("/proc/{pid}/task/{pid}/children"), &mut buf).is_ok();
                HAS_CHILDREN_FILES.store(if yes { YES } else { NO }, Ordering::Relaxed);
                yes
            }
        }
    }

    #[derive(Default)]
    pub(super) struct Walker {
        buf: Vec<u8>,
        /// `(pid, parent)` for every process, built once per sample when the children files are missing.
        parents: Option<Vec<(PidT, PidT)>>,
    }

    impl Walker {
        pub(super) fn children(&mut self, pid: PidT, out: &mut Vec<PidT>) {
            if has_children_files() {
                self.children_from_files(pid, out);
            } else {
                self.children_from_scan(pid, out);
            }
        }

        fn children_from_files(&mut self, pid: PidT, out: &mut Vec<PidT>) {
            let Ok(task_dir) = bun_sys::open_dir_absolute(format!("/proc/{pid}/task").as_bytes())
            else {
                return;
            };
            let mut tasks = bun_sys::iterate_dir(task_dir);
            while let Ok(Some(task)) = tasks.next() {
                let Ok(tid) = core::str::from_utf8(task.name.slice_u8()) else {
                    continue;
                };
                if read_small(&format!("/proc/{pid}/task/{tid}/children"), &mut self.buf).is_err() {
                    continue;
                }
                out.extend(bun_core::strings::tokenize(&self.buf, b" ").filter_map(parse::<PidT>));
            }
            task_dir.close();
        }

        fn children_from_scan(&mut self, pid: PidT, out: &mut Vec<PidT>) {
            if self.parents.is_none() {
                let mut parents = Vec::new();
                if let Ok(proc_dir) = bun_sys::open_dir_absolute(b"/proc") {
                    let mut entries = bun_sys::iterate_dir(proc_dir);
                    while let Ok(Some(entry)) = entries.next() {
                        let Some(child) = parse::<PidT>(entry.name.slice_u8()) else {
                            continue;
                        };
                        if read_small(&format!("/proc/{child}/stat"), &mut self.buf).is_err() {
                            continue;
                        }
                        if let Some(parent) = stat_fields(&self.buf)
                            .and_then(|mut f| f.nth(1))
                            .and_then(parse::<PidT>)
                        {
                            parents.push((child, parent));
                        }
                    }
                    proc_dir.close();
                }
                self.parents = Some(parents);
            }
            if let Some(parents) = &self.parents {
                out.extend(parents.iter().filter(|(_, p)| *p == pid).map(|(c, _)| *c));
            }
        }

        /// `RssAnon + RssShmem`: memory the process cannot give back. A shared page counts once per process, so a sum can be too high.
        pub(super) fn footprint(&mut self, pid: PidT) -> u64 {
            if read_small(&format!("/proc/{pid}/status"), &mut self.buf).is_ok() {
                if let Some(kb) = sum_kb(&self.buf, &[b"RssAnon", b"RssShmem"]) {
                    return kb * 1024;
                }
            }
            // Before Linux 4.5 there is no split, so use resident minus shared from statm.
            if read_small(&format!("/proc/{pid}/statm"), &mut self.buf).is_err() {
                return 0;
            }
            let mut it = bun_core::strings::tokenize(&self.buf, b" ")
                .skip(1)
                .map(|f| parse::<u64>(f).unwrap_or(0));
            let resident = it.next().unwrap_or(0);
            let shared = it.next().unwrap_or(0);
            resident.saturating_sub(shared) * page_size()
        }
    }

    /// The digits after any spaces and tabs, as in "\t    1234 kB". `status` uses a tab and `smaps_rollup` uses spaces.
    fn leading_number(bytes: &[u8]) -> Option<u64> {
        let start = bytes.iter().position(|b| !matches!(b, b' ' | b'\t'))?;
        let digits = &bytes[start..];
        let end = digits
            .iter()
            .position(|b| !b.is_ascii_digit())
            .unwrap_or(digits.len());
        core::str::from_utf8(&digits[..end]).ok()?.parse().ok()
    }

    /// The sum of the named "Key:   123 kB" lines, or `None` when the text has none of them.
    fn sum_kb(text: &[u8], keys: &[&[u8]]) -> Option<u64> {
        let mut total = None;
        for line in bun_core::strings::split(text, b"\n") {
            let Some((key, rest)) = bun_core::strings::split_once_char(line, b':') else {
                continue;
            };
            if keys.contains(&key) {
                total = Some(total.unwrap_or(0) + leading_number(rest).unwrap_or(0));
            }
        }
        total
    }

    static HAS_SMAPS_ROLLUP: AtomicU8 = AtomicU8::new(UNKNOWN);

    /// `smaps_rollup` exists from Linux 4.14. Without it the cheap sum is the only number there is.
    pub(super) fn has_exact_footprint() -> bool {
        match HAS_SMAPS_ROLLUP.load(Ordering::Relaxed) {
            YES => true,
            NO => false,
            _ => {
                let mut buf = Vec::new();
                let yes = read_small("/proc/self/smaps_rollup", &mut buf).is_ok();
                HAS_SMAPS_ROLLUP.store(if yes { YES } else { NO }, Ordering::Relaxed);
                yes
            }
        }
    }

    /// Proportional memory: each shared page is divided between the processes that map it.
    pub(super) fn exact_footprint(pid: PidT, walker: &mut Walker) -> u64 {
        let mut buf = Vec::with_capacity(1024);
        match read_small(&format!("/proc/{pid}/smaps_rollup"), &mut buf) {
            // Linux 4.14 to 5.4 has only the total `Pss`, which counts file pages, so use the cheap number there.
            Ok(()) => match sum_kb(&buf, &[b"Pss_Anon", b"Pss_Shmem"]) {
                Some(kb) => kb * 1024,
                None => walker.footprint(pid),
            },
            Err(err) if is_gone(&err) => 0,
            Err(_) => walker.footprint(pid),
        }
    }

    pub(super) fn usage_of(root: PidT) -> u64 {
        let mut walker = Walker::default();
        let mut stack = vec![root];
        let mut kids = Vec::new();
        let mut total = 0u64;
        while let Some(pid) = stack.pop() {
            total += walker.footprint(pid);
            kids.clear();
            walker.children(pid, &mut kids);
            stack.extend_from_slice(&kids);
        }
        total
    }

    pub(super) fn identity(pid: PidT) -> Identity {
        let mut buf: Vec<u8> = Vec::with_capacity(256);
        match read_small(&format!("/proc/{pid}/stat"), &mut buf) {
            Err(err) if is_gone(&err) => Identity::Gone,
            Err(_) => Identity::Unknown,
            Ok(()) => stat_fields(&buf)
                .and_then(|mut f| f.nth(19))
                .and_then(parse::<u64>)
                .map_or(Identity::Unknown, Identity::Is),
        }
    }
}

#[cfg(windows)]
mod os {
    use super::Watch;
    use bun_sys::windows::{self, HANDLE};
    use core::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    static NEXT_ID: AtomicUsize = AtomicUsize::new(1);

    /// The completion key. It is never reused, so a late message cannot reach a newer watch.
    pub(super) fn next_id() -> usize {
        NEXT_ID.fetch_add(1, Ordering::Relaxed)
    }

    /// libuv closes its own process handle when the child is reaped, so the watch keeps its own.
    pub(super) fn duplicate(process: HANDLE) -> HANDLE {
        let mut out: HANDLE = core::ptr::null_mut();
        let me = windows::GetCurrentProcess();
        // SAFETY: `out` is a valid out-pointer; bad handles fail with 0.
        let ok = unsafe {
            windows::kernel32::DuplicateHandle(
                me,
                process,
                me,
                &raw mut out,
                0,
                0,
                windows::DUPLICATE_SAME_ACCESS,
            )
        };
        if ok == 0 { core::ptr::null_mut() } else { out }
    }

    pub(super) fn create_job(process: HANDLE) -> HANDLE {
        // SAFETY: null attributes/name are documented-valid.
        let job = unsafe { windows::CreateJobObjectA(core::ptr::null_mut(), core::ptr::null()) };
        if job.is_null() {
            return job;
        }
        // SAFETY: both handles are live.
        if unsafe { windows::AssignProcessToJobObject(job, process) } == 0 {
            // SAFETY: `job` was just created and is owned here.
            unsafe { windows::CloseHandle(job) };
            return core::ptr::null_mut();
        }
        job
    }

    pub(super) fn close(w: &Watch) {
        for handle in [w.job, w.process] {
            if !handle.is_null() {
                // SAFETY: both handles are owned by this Watch.
                unsafe { windows::CloseHandle(handle) };
            }
        }
    }

    pub(super) fn tree_usage(w: &Watch) -> u64 {
        if !w.job.is_null() {
            let (current, peak) = windows::job_memory_usage(w.job);
            w.peak.fetch_max(peak, Ordering::AcqRel);
            if let Some(current) = current {
                return current;
            }
        }
        if w.process.is_null() {
            return 0;
        }
        // The root has exited, so the sampler must let go of this watch.
        if windows::kernel32::WaitForSingleObject(w.process, 0) == 0 {
            w.done.store(true, Ordering::Release);
        }
        windows::GetProcessMemoryInfo(w.process)
            .map(|c| c.PagefileUsage as u64)
            .unwrap_or(0)
    }

    static PORT: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    static NOTIFIED: bun_threading::Guarded<Vec<Arc<Watch>>> =
        bun_threading::Guarded::new(Vec::new());

    fn port() -> Option<HANDLE> {
        let port = *PORT.get_or_init(|| {
            let Ok(port) = windows::CreateIoCompletionPort(
                windows::INVALID_HANDLE_VALUE,
                core::ptr::null_mut(),
                0,
                1,
            ) else {
                return 0;
            };
            let raw = port as usize;
            let spawned = std::thread::Builder::new()
                .name("MemoryWatcher".into())
                .stack_size(256 * 1024)
                .spawn(move || wait_for_limits(raw as HANDLE));
            if spawned.is_err() {
                // SAFETY: `port` was just created and nothing else holds it.
                unsafe { windows::CloseHandle(port) };
                return 0;
            }
            raw
        });
        (port != 0).then_some(port as HANDLE)
    }

    /// The kernel posts one message when a job crosses its limit, so this thread never polls.
    fn wait_for_limits(port: HANDLE) {
        loop {
            let mut message: windows::DWORD = 0;
            let mut key: windows::ULONG_PTR = 0;
            let mut overlapped: *mut windows::OVERLAPPED = core::ptr::null_mut();
            // SAFETY: all three out-pointers are valid for the call.
            let ok = unsafe {
                windows::kernel32::GetQueuedCompletionStatus(
                    port,
                    &raw mut message,
                    &raw mut key,
                    &raw mut overlapped,
                    windows::INFINITE,
                )
            };
            if ok == 0 {
                continue;
            }
            let Some(watch) = NOTIFIED.lock().iter().find(|w| w.id == key).map(Arc::clone) else {
                continue;
            };
            match message {
                windows::JOB_OBJECT_MSG_NOTIFICATION_LIMIT => watch.kill(),
                // The tree is gone. This releases a watch whose Subprocess object went away before the child did.
                windows::JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO => {
                    watch.done.store(true, Ordering::Release);
                    forget(&watch);
                }
                _ => {}
            }
        }
    }

    /// True when the kernel now reports the limit for this watch, so the sampler is not needed.
    pub(super) fn arm_kernel_limit(entry: &Arc<Watch>) -> bool {
        if entry.job.is_null() {
            return false;
        }
        let Some(port) = port() else { return false };
        NOTIFIED.lock().push(Arc::clone(entry));
        if windows::job_notify_memory_limit(entry.job, port, entry.id, entry.limit) {
            entry.notified.store(true, Ordering::Release);
            return true;
        }
        forget(entry);
        false
    }

    fn forget(w: &Watch) {
        NOTIFIED.lock().retain(|other| other.id != w.id);
    }

    /// The root exited: read the job's real peak, and stop holding the watch for a message that may never come.
    pub(super) fn finish(w: &Watch) {
        let _ = tree_usage(w);
        forget(w);
    }

    pub(super) fn kill_tree(w: &Watch) {
        // SAFETY: `job` is a live job handle.
        if !w.job.is_null() && unsafe { windows::TerminateJobObject(w.job, 1) } != 0 {
            return;
        }
        if !w.process.is_null() {
            // SAFETY: `process` is a live handle that this Watch owns. There is no further fallback if this fails too.
            let _ = unsafe { windows::TerminateProcess(w.process, 1) };
        }
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "linux",
    target_os = "android",
    windows
)))]
mod os {
    use super::Watch;
    pub(super) fn tree_usage(_: &Watch) -> u64 {
        0
    }
    pub(super) fn kill_tree(w: &Watch) {
        // SAFETY: kill(2) has no memory-safety preconditions.
        unsafe { libc::kill(w.pid, w.signal as core::ffi::c_int) };
    }
}
