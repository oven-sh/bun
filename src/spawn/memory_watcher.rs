//! `Bun.spawn({ maxMemory })`: one background thread samples every watched child tree and kills a tree that crosses its limit.

use core::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex, OnceLock};
use std::time::Duration;

use crate::process::PidT;

pub struct Watch {
    #[cfg_attr(windows, allow(dead_code))]
    pid: PidT,
    limit: u64,
    #[cfg_attr(windows, allow(dead_code))]
    signal: u8,
    /// Start time of `pid`, so a recycled pid is never signalled.
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
    identity: u64,
    current: AtomicU64,
    peak: AtomicU64,
    exceeded: AtomicBool,
    done: AtomicBool,
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
        self.peak.load(Ordering::Relaxed)
    }
    pub fn current(&self) -> u64 {
        self.current.load(Ordering::Relaxed)
    }
    pub fn limit(&self) -> u64 {
        self.limit
    }
    /// Call before the pid is reaped so a recycled pid is never sampled or signalled.
    pub fn unwatch(&self) {
        self.done.store(true, Ordering::Release);
    }

    fn sample(&self) -> u64 {
        let usage = os::tree_usage(self);
        self.current.store(usage, Ordering::Relaxed);
        self.peak.fetch_max(usage, Ordering::Relaxed);
        if usage > self.limit
            && !self.done.load(Ordering::Acquire)
            && !self.exceeded.swap(true, Ordering::Relaxed)
        {
            os::kill_tree(self);
        }
        usage
    }
}

impl Drop for Watch {
    fn drop(&mut self) {
        #[cfg(windows)]
        os::close(self);
    }
}

struct Watcher {
    entries: Mutex<Vec<Arc<Watch>>>,
    wake: Condvar,
}

fn watcher() -> &'static Watcher {
    static W: OnceLock<Watcher> = OnceLock::new();
    W.get_or_init(|| Watcher {
        entries: Mutex::new(Vec::new()),
        wake: Condvar::new(),
    })
}

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
    let w = watcher();
    let mut snapshot: Vec<Arc<Watch>> = Vec::new();
    let mut guard = w.entries.lock().unwrap();
    loop {
        guard.retain(|e| !e.done.load(Ordering::Relaxed));
        if guard.is_empty() {
            guard = w.wake.wait(guard).unwrap();
            continue;
        }
        snapshot.clear();
        snapshot.extend(guard.iter().cloned());
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

        guard = w.entries.lock().unwrap();
        let (g, _) = w
            .wake
            .wait_timeout(guard, interval_for(min_headroom))
            .unwrap();
        guard = g;
    }
}

pub struct WatchOptions {
    pub pid: PidT,
    pub limit: u64,
    pub signal: u8,
    #[cfg(windows)]
    pub process: bun_sys::windows::HANDLE,
}

pub fn watch(opts: WatchOptions) -> std::io::Result<Arc<Watch>> {
    let entry = Arc::new(Watch {
        pid: opts.pid,
        limit: opts.limit,
        signal: opts.signal,
        #[cfg(any(target_os = "macos", target_os = "linux", target_os = "android"))]
        identity: os::identity(opts.pid),
        current: AtomicU64::new(0),
        peak: AtomicU64::new(0),
        exceeded: AtomicBool::new(false),
        done: AtomicBool::new(false),
        #[cfg(windows)]
        job: os::create_job(opts.process),
        #[cfg(windows)]
        process: opts.process,
    });
    // A child can allocate a lot before the thread's first tick; sample once synchronously.
    entry.sample();

    let w = watcher();
    w.entries.lock().unwrap().push(entry.clone());
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
    w.wake.notify_one();
    Ok(entry)
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
        if unsafe { proc_pid_rusage(pid, 0, &mut info) } != 0 {
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
        let mut total = 0u64;
        for_each_in_tree(w.pid, |pid| total += footprint(pid));
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
    use core::ffi::c_int;
    use std::io::Read;

    fn read_small(path: &str, buf: &mut Vec<u8>) -> bool {
        buf.clear();
        match std::fs::File::open(path) {
            Ok(mut f) => f.read_to_end(buf).is_ok(),
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
            let Ok(tasks) = std::fs::read_dir(format!("/proc/{pid}/task")) else {
                continue;
            };
            for task in tasks.flatten() {
                let tid = task.file_name();
                let Some(tid) = tid.to_str() else { continue };
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
        }
    }

    pub(super) fn tree_usage(w: &Watch) -> u64 {
        let mut total = 0u64;
        let mut buf: Vec<u8> = Vec::with_capacity(128);
        for_each_in_tree(w.pid, |pid| total += footprint(pid, &mut buf));
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
            if let Some(usage) = windows::job_memory_usage(w.job) {
                return usage;
            }
        }
        windows::GetProcessMemoryInfo(w.process)
            .map(|c| c.PagefileUsage as u64)
            .unwrap_or(0)
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
