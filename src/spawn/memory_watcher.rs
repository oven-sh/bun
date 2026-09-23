//! `Bun.spawn({ maxMemory })`: kill a child tree that crosses its memory limit. The kernel enforces it where it can (Windows job, Linux cgroup); one thread samples otherwise.

use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bun_threading::{Condvar, Guarded};

use crate::process::PidT;

pub struct Watch {
    #[cfg(not(windows))]
    pid: PidT,
    limit: u64,
    #[cfg(not(windows))]
    signal: u8,
    /// Start time of `pid`, so a recycled pid is never signalled.
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    identity: u64,
    peak: AtomicU64,
    exceeded: AtomicBool,
    done: AtomicBool,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    cgroup: Option<cgroup::Cgroup>,
    #[cfg(windows)]
    job: bun_sys::windows::HANDLE,
    #[cfg(windows)]
    process: bun_sys::windows::HANDLE,
}

// SAFETY: HANDLEs are process-global kernel object references; every other field is atomic or immutable.
#[cfg(windows)]
unsafe impl Send for Watch {}
#[cfg(windows)]
unsafe impl Sync for Watch {}

impl Watch {
    pub fn exceeded(&self) -> bool {
        self.exceeded.load(Ordering::Relaxed)
    }
    pub fn peak(&self) -> u64 {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if let Some(cgroup) = &self.cgroup {
            self.peak.fetch_max(cgroup.peak(), Ordering::Relaxed);
        }
        self.peak.load(Ordering::Relaxed)
    }
    /// Call before the pid is reaped so a recycled pid is never sampled or signalled.
    pub fn unwatch(&self) {
        self.done.store(true, Ordering::Release);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if let Some(cgroup) = &self.cgroup {
            if cgroup.oom_killed() {
                self.exceeded.store(true, Ordering::Relaxed);
                cgroup.kill_all();
            }
        }
    }

    pub fn sample_now(&self) -> u64 {
        self.sample()
    }

    fn sample(&self) -> u64 {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if let Some(cgroup) = &self.cgroup {
            let usage = cgroup.current();
            self.peak.fetch_max(usage, Ordering::Relaxed);
            return usage;
        }
        let usage = os::tree_usage(self);
        self.peak.fetch_max(usage, Ordering::Relaxed);
        if usage > self.limit {
            self.kill_once();
        }
        usage
    }

    fn kill_once(&self) {
        if !self.done.load(Ordering::Acquire) && !self.exceeded.swap(true, Ordering::Relaxed) {
            os::kill_tree(self);
        }
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

/// Headroom below which sampling runs at `MIN_INTERVAL`; above it the interval scales linearly to `MAX_INTERVAL`.
const FAST_BELOW_HEADROOM: f64 = 0.15;

fn interval_for(min_headroom: f64) -> Duration {
    if min_headroom <= FAST_BELOW_HEADROOM {
        return MIN_INTERVAL;
    }
    let t = ((min_headroom - FAST_BELOW_HEADROOM) / (1.0 - FAST_BELOW_HEADROOM)).clamp(0.0, 1.0);
    MIN_INTERVAL + (MAX_INTERVAL - MIN_INTERVAL).mul_f64(t)
}

fn run() {
    let mut snapshot: Vec<Arc<Watch>> = Vec::new();
    let mut guard = ENTRIES.lock();
    loop {
        guard.retain(|e| !e.done.load(Ordering::Relaxed));
        if guard.is_empty() {
            WAKE.wait_guarded(&mut guard);
            continue;
        }
        snapshot.extend(guard.iter().map(Arc::clone));
        drop(guard);

        let mut min_headroom = 1.0f64;
        for e in &snapshot {
            if e.done.load(Ordering::Relaxed) || e.exceeded() {
                continue;
            }
            let usage = e.sample();
            let headroom = 1.0 - (usage as f64 / e.limit as f64);
            if headroom < min_headroom {
                min_headroom = headroom;
            }
        }
        snapshot.clear();

        guard = ENTRIES.lock();
        let _ = WAKE.timed_wait_guarded(&mut guard, interval_for(min_headroom).as_nanos() as u64);
    }
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
    /// The cgroup the child was spawned into. With one, the kernel enforces the limit and nothing samples.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub cgroup: Option<cgroup::Cgroup>,
}

pub fn watch(opts: &mut WatchOptions) -> std::io::Result<Arc<Watch>> {
    let entry = Arc::new(Watch {
        #[cfg(not(windows))]
        pid: opts.pid,
        limit: opts.limit,
        #[cfg(not(windows))]
        signal: opts.signal,
        #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
        identity: os::identity(opts.pid),
        peak: AtomicU64::new(0),
        exceeded: AtomicBool::new(false),
        done: AtomicBool::new(false),
        #[cfg(any(target_os = "linux", target_os = "android"))]
        cgroup: opts.cgroup.take(),
        #[cfg(windows)]
        job: os::create_job(opts.process),
        #[cfg(windows)]
        process: opts.process,
    });
    // A child can allocate a lot before the thread's first tick; sample once synchronously.
    entry.sample();

    #[cfg(windows)]
    if os::arm_kernel_limit(&entry) {
        return Ok(entry);
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if entry.cgroup.is_some() {
        return Ok(entry);
    }

    ENTRIES.lock().push(Arc::clone(&entry));
    if !THREAD_STARTED.swap(true, Ordering::AcqRel) {
        if let Err(e) = std::thread::Builder::new()
            .name("MemoryWatcher".into())
            .stack_size(256 * 1024)
            .spawn(run)
        {
            THREAD_STARTED.store(false, Ordering::Release);
            entry.unwatch();
            return Err(e);
        }
    }
    WAKE.notify_one();
    Ok(entry)
}

/// A memory cgroup that Bun creates for one child tree, so the kernel enforces `maxMemory` with no sampling.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub mod cgroup {
    use bun_core::ZBox;
    use bun_sys::{Fd, File, O};
    use core::sync::atomic::{AtomicU32, Ordering};

    pub struct Cgroup {
        path: Vec<u8>,
        v2: bool,
    }

    static NEXT: AtomicU32 = AtomicU32::new(0);
    static PENDING_RMDIR: bun_threading::Guarded<Vec<Vec<u8>>> =
        bun_threading::Guarded::new(Vec::new());

    fn read(dir: &[u8], name: &str) -> Option<Vec<u8>> {
        File::read_from(Fd::cwd(), &[dir, b"/", name.as_bytes()].concat()).ok()
    }

    fn write(dir: &[u8], name: &str, value: &[u8]) -> bool {
        match File::openat(
            Fd::cwd(),
            &[dir, b"/", name.as_bytes()].concat(),
            O::WRONLY,
            0,
        ) {
            Ok(f) => f.write_all(value).is_ok(),
            Err(_) => false,
        }
    }

    fn number(bytes: &[u8]) -> u64 {
        core::str::from_utf8(bytes)
            .ok()
            .and_then(|s| s.trim().parse().ok())
            .unwrap_or(0)
    }

    /// The value after `key` in a "key value" per line file such as `memory.events`.
    fn field(bytes: &[u8], key: &[u8]) -> u64 {
        for line in bun_core::strings::split(bytes, b"\n") {
            if let Some((k, v)) = bun_core::strings::split_once_char(line, b' ') {
                if k == key {
                    return number(v);
                }
            }
        }
        0
    }

    /// With swap and no swap cap, a child over its limit is swapped out and never killed.
    fn has_swap() -> bool {
        read(b"/proc", "swaps").is_some_and(|b| bun_core::strings::count_char(&b, b'\n') > 1)
    }

    fn rmdir(path: &[u8]) -> bool {
        bun_sys::rmdir(&ZBox::from_bytes(path)).is_ok()
    }

    fn retry_pending_rmdir() {
        PENDING_RMDIR.lock().retain(|path| !rmdir(path));
    }

    /// A v2 cgroup with processes cannot give controllers to its children, so v2 uses a sibling of our own cgroup.
    fn candidates(name: &str) -> Vec<(Vec<u8>, bool)> {
        let mut out = Vec::new();
        if read(b"/sys/fs/cgroup/memory", "memory.limit_in_bytes").is_some() {
            out.push((format!("/sys/fs/cgroup/memory/{name}").into_bytes(), false));
        }
        if read(b"/sys/fs/cgroup", "cgroup.controllers").is_some() {
            if let Some(own) = read(b"/proc/self", "cgroup") {
                for line in bun_core::strings::split(&own, b"\n") {
                    let Some(own_path) = line.strip_prefix(b"0::") else {
                        continue;
                    };
                    if let Some(slash) = bun_core::strings::last_index_of_char(own_path, b'/') {
                        let parent = &own_path[..slash];
                        out.push((
                            [b"/sys/fs/cgroup", parent, b"/", name.as_bytes()].concat(),
                            true,
                        ));
                    }
                }
            }
            out.push((format!("/sys/fs/cgroup/{name}").into_bytes(), true));
        }
        out
    }

    impl Cgroup {
        /// `None` when this process may not create a memory cgroup here; the caller then samples.
        pub fn create(limit: u64) -> Option<Cgroup> {
            retry_pending_rmdir();
            // SAFETY: getpid has no preconditions.
            let pid = unsafe { libc::getpid() };
            let name = format!("bun-{pid}-{}", NEXT.fetch_add(1, Ordering::Relaxed));
            let limit = limit.to_string();
            for (path, v2) in candidates(&name) {
                if bun_sys::mkdir(&ZBox::from_bytes(&path), 0o755).is_err() {
                    continue;
                }
                let ok = if v2 {
                    write(&path, "memory.max", limit.as_bytes())
                } else {
                    write(&path, "memory.limit_in_bytes", limit.as_bytes())
                };
                if !ok {
                    rmdir(&path);
                    continue;
                }
                let swap_capped = if v2 {
                    write(&path, "memory.swap.max", b"0")
                } else {
                    write(&path, "memory.memsw.limit_in_bytes", limit.as_bytes())
                };
                if !swap_capped && has_swap() {
                    rmdir(&path);
                    continue;
                }
                if v2 {
                    write(&path, "memory.oom.group", b"1");
                }
                return Some(Cgroup { path, v2 });
            }
            None
        }

        pub fn path(&self) -> &[u8] {
            &self.path
        }

        pub fn current(&self) -> u64 {
            let name = if self.v2 {
                "memory.current"
            } else {
                "memory.usage_in_bytes"
            };
            read(&self.path, name).map_or(0, |b| number(&b))
        }

        /// 0 when the kernel has no peak file (v2 before Linux 5.19).
        pub fn peak(&self) -> u64 {
            let name = if self.v2 {
                "memory.peak"
            } else {
                "memory.max_usage_in_bytes"
            };
            read(&self.path, name).map_or(0, |b| number(&b))
        }

        pub fn oom_killed(&self) -> bool {
            let name = if self.v2 {
                "memory.events"
            } else {
                "memory.oom_control"
            };
            read(&self.path, name).is_some_and(|b| field(&b, b"oom_kill") > 0)
        }

        /// Kill what the kernel left alive. One process can survive when `memory.oom.group` is not available.
        pub fn kill_all(&self) {
            if self.v2 && write(&self.path, "cgroup.kill", b"1") {
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
    }

    impl Drop for Cgroup {
        fn drop(&mut self) {
            if !rmdir(&self.path) {
                PENDING_RMDIR.lock().push(core::mem::take(&mut self.path));
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod os {
    use super::Watch;
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

    fn footprint(pid: c_int) -> u64 {
        let mut info = RusageInfoV0::default();
        // SAFETY: `info` is a valid out-buffer of the size `RUSAGE_INFO_V0` (flavor 0) writes.
        if unsafe { proc_pid_rusage(pid, 0, &raw mut info) } != 0 {
            return 0;
        }
        info.ri_phys_footprint
    }

    pub(super) fn for_each_in_tree(root: c_int, mut f: impl FnMut(c_int)) {
        let mut stack: Vec<c_int> = Vec::with_capacity(16);
        let mut buf: Vec<c_int> = vec![0; 64];
        stack.push(root);
        while let Some(pid) = stack.pop() {
            f(pid);
            loop {
                let cap = c_int::try_from(buf.len() * core::mem::size_of::<c_int>())
                    .unwrap_or(c_int::MAX);
                // SAFETY: `buf` is a writable buffer of `cap` bytes.
                let n = unsafe {
                    bun_sys::c::proc_listchildpids(pid, buf.as_mut_ptr().cast::<c_void>(), cap)
                };
                if n <= 0 {
                    break;
                }
                let n = n as usize;
                if n >= buf.len() {
                    buf.resize(buf.len() * 2, 0);
                    continue;
                }
                stack.extend_from_slice(&buf[..n]);
                break;
            }
        }
    }

    pub(super) fn tree_usage(w: &Watch) -> u64 {
        usage_of(w.pid)
    }

    pub(super) fn usage_of(root: c_int) -> u64 {
        let mut total = 0u64;
        for_each_in_tree(root, |pid| total += footprint(pid));
        total
    }

    pub(super) fn identity(pid: c_int) -> u64 {
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
        if n != size {
            return 0;
        }
        info.pbi_start_tvsec
            .wrapping_mul(1_000_000)
            .wrapping_add(info.pbi_start_tvusec)
    }

    pub(super) fn kill_tree(w: &Watch) {
        super::posix_kill_tree(w);
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
mod os {
    use super::Watch;
    use bun_sys::{Fd, FdExt, File, O, SizeHint};
    use core::ffi::c_int;

    fn read_small(path: &str, buf: &mut Vec<u8>) -> bool {
        buf.clear();
        match File::openat(Fd::cwd(), path.as_bytes(), O::RDONLY, 0) {
            Ok(f) => f
                .read_to_end_with_array_list(buf, SizeHint::ProbablySmall)
                .is_ok(),
            Err(_) => false,
        }
    }

    fn page_size() -> u64 {
        // SAFETY: sysconf has no preconditions.
        let n = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if n > 0 { n as u64 } else { 4096 }
    }

    /// Resident minus file-backed shared pages, from `/proc/<pid>/statm`; the closest cheap analogue of macOS `phys_footprint`.
    fn footprint(pid: c_int, buf: &mut Vec<u8>) -> u64 {
        if !read_small(&format!("/proc/{pid}/statm"), buf) {
            return 0;
        }
        let mut it = bun_core::strings::split(buf, b" ").skip(1).map(|f| {
            core::str::from_utf8(f)
                .ok()
                .and_then(|s| s.trim().parse::<u64>().ok())
                .unwrap_or(0)
        });
        let resident = it.next().unwrap_or(0);
        let shared = it.next().unwrap_or(0);
        resident.saturating_sub(shared) * page_size()
    }

    pub(super) fn for_each_in_tree(root: c_int, mut f: impl FnMut(c_int)) {
        let mut stack: Vec<c_int> = Vec::with_capacity(16);
        let mut buf: Vec<u8> = Vec::with_capacity(256);
        stack.push(root);
        while let Some(pid) = stack.pop() {
            f(pid);
            let Ok(task_dir) = bun_sys::open_dir_absolute(format!("/proc/{pid}/task").as_bytes())
            else {
                continue;
            };
            let mut tasks = bun_sys::iterate_dir(task_dir);
            while let Ok(Some(task)) = tasks.next() {
                let Ok(tid) = core::str::from_utf8(task.name.slice_u8()) else {
                    continue;
                };
                if !read_small(&format!("/proc/{pid}/task/{tid}/children"), &mut buf) {
                    continue;
                }
                for child in bun_core::strings::tokenize(&buf, b" ") {
                    if let Some(c) = core::str::from_utf8(child)
                        .ok()
                        .and_then(|s| s.trim().parse::<c_int>().ok())
                    {
                        stack.push(c);
                    }
                }
            }
            task_dir.close();
        }
    }

    pub(super) fn tree_usage(w: &Watch) -> u64 {
        usage_of(w.pid)
    }

    pub(super) fn usage_of(root: c_int) -> u64 {
        let mut total = 0u64;
        let mut buf: Vec<u8> = Vec::with_capacity(128);
        for_each_in_tree(root, |pid| total += footprint(pid, &mut buf));
        total
    }

    pub(super) fn identity(pid: c_int) -> u64 {
        let mut buf: Vec<u8> = Vec::with_capacity(256);
        if !read_small(&format!("/proc/{pid}/stat"), &mut buf) {
            return 0;
        }
        // comm may contain spaces/parens; fields after the last ')' are space-separated, starttime is the 20th of those.
        let Some(close) = bun_core::strings::last_index_of_char(&buf, b')') else {
            return 0;
        };
        bun_core::strings::tokenize(&buf[close + 1..], b" ")
            .nth(19)
            .and_then(|f| core::str::from_utf8(f).ok())
            .and_then(|s| s.trim().parse::<u64>().ok())
            .unwrap_or(0)
    }

    pub(super) fn kill_tree(w: &Watch) {
        super::posix_kill_tree(w);
    }
}

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
fn posix_kill_tree(w: &Watch) {
    if os::identity(w.pid) != w.identity {
        return;
    }
    let mut pids: Vec<libc::pid_t> = Vec::with_capacity(16);
    os::for_each_in_tree(w.pid, |pid| pids.push(pid));
    // Children first so a shell cannot observe its child dying and spawn a replacement before it is signalled itself.
    for pid in pids.iter().rev() {
        // SAFETY: kill(2) has no memory-safety preconditions.
        unsafe { libc::kill(*pid, w.signal as core::ffi::c_int) };
    }
}

#[cfg(windows)]
mod os {
    use super::Watch;
    use bun_sys::windows::{self, HANDLE};

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
        if !w.job.is_null() {
            // SAFETY: `job` is owned by this Watch.
            unsafe { windows::CloseHandle(w.job) };
        }
    }

    pub(super) fn tree_usage(w: &Watch) -> u64 {
        if !w.job.is_null() {
            let (current, peak) = windows::job_memory_usage(w.job);
            w.peak
                .fetch_max(peak, core::sync::atomic::Ordering::Relaxed);
            if let Some(current) = current {
                return current;
            }
        }
        windows::GetProcessMemoryInfo(w.process)
            .map(|c| c.PagefileUsage as u64)
            .unwrap_or(0)
    }

    static PORT: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    static NOTIFIED: bun_threading::Guarded<Vec<std::sync::Arc<Watch>>> =
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
            let mut watches = NOTIFIED.lock();
            let Some(index) = watches
                .iter()
                .position(|w| std::sync::Arc::as_ptr(w) as usize == key)
            else {
                continue;
            };
            match message {
                windows::JOB_OBJECT_MSG_NOTIFICATION_LIMIT => {
                    let w = std::sync::Arc::clone(&watches[index]);
                    drop(watches);
                    w.kill_once();
                }
                windows::JOB_OBJECT_MSG_ACTIVE_PROCESS_ZERO => {
                    watches.swap_remove(index);
                }
                _ => {}
            }
        }
    }

    /// True when the kernel now enforces the limit for this watch, so the sampler is not needed.
    pub(super) fn arm_kernel_limit(entry: &std::sync::Arc<Watch>) -> bool {
        if entry.job.is_null() {
            return false;
        }
        let Some(port) = port() else { return false };
        let key = std::sync::Arc::as_ptr(entry) as usize;
        NOTIFIED.lock().push(std::sync::Arc::clone(entry));
        if windows::job_notify_memory_limit(entry.job, port, key, entry.limit) {
            return true;
        }
        NOTIFIED
            .lock()
            .retain(|w| std::sync::Arc::as_ptr(w) as usize != key);
        false
    }

    pub(super) fn kill_tree(w: &Watch) {
        if !w.job.is_null() {
            // SAFETY: `job` is a live job handle.
            unsafe { windows::TerminateJobObject(w.job, 1) };
        } else {
            // SAFETY: `process` is a live process handle.
            unsafe { windows::TerminateProcess(w.process, 1) };
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
