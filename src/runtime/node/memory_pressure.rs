//! `process.on("memoryPressure", level => ...)` — OS-level low-memory
//! notifications without polling.
//!
//! Backends:
//!   - macOS: `EVFILT_MEMORYSTATUS` on the main event loop's kqueue (the same
//!     filter libdispatch's `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` uses). The
//!     kernel delivers `NOTE_MEMORYSTATUS_PRESSURE_WARN` / `_CRITICAL` in
//!     `fflags` when `kern.memorystatus_level` crosses the warn/critical
//!     thresholds.
//!   - Linux, two independent sources. A PSI trigger on `/proc/pressure/memory`
//!     (or the cgroup v2 `memory.pressure` file for the process's own cgroup)
//!     signals via `POLLPRI` and is emitted as `critical`: tasks are stalling
//!     on reclaim. It needs `CAP_SYS_RESOURCE` before kernel 6.4 and
//!     `CONFIG_PSI=y`. The cgroup v2 `memory.events` file of the process's own
//!     cgroup is a kernfs file: it is readable on the read-only cgroup mount a
//!     container normally has, and kernfs signals `POLLPRI` each time one of
//!     its counters moves. `low`/`high`/`max` (reclaim at a limit) are emitted
//!     as `warning`, the `oom*` counters as `critical`, at most one of each
//!     per 2 s holdoff. A source that cannot be set up is skipped silently.
//!   - Windows: a dedicated thread blocks on
//!     `CreateMemoryResourceNotification(LowMemoryResourceNotification)` and
//!     posts back to the JS event loop when it signals, with a 30 s holdoff
//!     before re-waiting (the handle is level-triggered).
//!
//! Every source posts a `MemoryPressureTask` to the event loop rather than
//! calling into JS from the detector, so a listener removing itself during
//! `emit()` never races with the poll/thread that produced the event.
//!
//! Armed lazily on the first listener and disarmed on the last removal via
//! `onDidChangeListeners` in `BunProcess.cpp`, matching how signal handlers
//! are wired. The watcher does not keep the event loop alive.

use bun_event_loop::ConcurrentTask::{Task, task_tag};
#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_jsc::ArrayBuffer;
#[cfg(not(windows))]
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, bun_string_jsc};
#[cfg(not(windows))]
use core::ptr::NonNull;

/// Pressure level passed to JS. Values are the `NOTE_MEMORYSTATUS_PRESSURE_*`
/// bits on macOS so the kqueue dispatch can pass `fflags` through unchanged.
pub(crate) mod level {
    pub(crate) const WARNING: i32 = 0x00000002;
    pub(crate) const CRITICAL: i32 = 0x00000004;
}

unsafe extern "C" {
    fn Process__emitMemoryPressureEvent(global: *mut JSGlobalObject, level: i32);
}

/// `run_task` target for `task_tag::MemoryPressureTask`. `lvl` is the packed
/// task payload (macOS kevent `fflags`, or one `level` constant elsewhere).
pub(crate) fn emit(global: &JSGlobalObject, lvl: i32) {
    // macOS can deliver WARN|CRITICAL together under EV_CLEAR; pick the more severe.
    let lvl = if lvl & level::CRITICAL != 0 || lvl & level::WARNING == 0 {
        level::CRITICAL
    } else {
        level::WARNING
    };
    // SAFETY: FFI; `global` is the live per-thread global.
    unsafe { Process__emitMemoryPressureEvent(core::ptr::from_ref(global).cast_mut(), lvl) };
}

/// The queued form of a pressure notification: `Task::ptr` packs the level,
/// there is no allocation.
pub(crate) struct MemoryPressureTask;
impl bun_event_loop::Taskable for MemoryPressureTask {
    const TAG: bun_event_loop::TaskTag = task_tag::MemoryPressureTask;
    /// Nothing is owned (`this` is the packed level).
    unsafe fn release_unrun(_: *mut Self) {}
}

fn pressure_task(lvl: i32) -> Task {
    Task::init(lvl as usize as *mut MemoryPressureTask)
}

#[cfg(not(windows))]
fn slot(vm: &mut VirtualMachine) -> &mut Option<NonNull<core::ffi::c_void>> {
    vm.rare_data().memory_pressure_watcher_slot()
}

// ────────────────────────────────────────────────────────────────────────────
// POSIX backend (macOS EVFILT_MEMORYSTATUS, Linux PSI + cgroup) via FilePoll
// ────────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
mod posix {
    use core::ptr::NonNull;

    use bun_io::posix_event_loop::FilePoll;
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    use bun_io::posix_event_loop::{Flags, Owner, poll_tag};
    use bun_jsc::JSGlobalObject;
    use bun_jsc::virtual_machine::VirtualMachine;
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    use bun_sys::Fd;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) use cgroup::{CgroupEvents, Counters};

    use super::slot;

    /// Stored type-erased in `RareData.memory_pressure_watcher`. Every source
    /// is `None` when it could not be set up, so the slot still records that
    /// listeners exist and `isInstalled` stays true.
    pub(super) struct MemoryPressureWatcher {
        /// macOS: the `EVFILT_MEMORYSTATUS` poll. Linux: the PSI trigger poll.
        poll: Option<NonNull<FilePoll>>,
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(super) cgroup: Option<CgroupEvents>,
    }

    pub(super) fn watcher_mut<'a>(
        vm: &mut VirtualMachine,
    ) -> Option<&'a mut MemoryPressureWatcher> {
        let raw = (*slot(vm))?;
        // SAFETY: slot is populated only by `install` with a `Box<MemoryPressureWatcher>`
        // that lives until `uninstall` takes it. Everything here runs on the
        // JS thread, and no caller holds a second reference across a call
        // that can reach `uninstall` (the sources enqueue a task instead of
        // running JS), so this is the only live reference.
        Some(unsafe { &mut *raw.as_ptr().cast::<MemoryPressureWatcher>() })
    }

    fn take_watcher(vm: &mut VirtualMachine) -> Option<Box<MemoryPressureWatcher>> {
        let raw = slot(vm).take()?;
        // SAFETY: slot is populated only by `install` with a `Box<MemoryPressureWatcher>`.
        Some(unsafe { bun_core::heap::take(raw.as_ptr().cast::<MemoryPressureWatcher>()) })
    }

    fn deinit_poll(poll: &mut FilePoll) {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let fd = poll.fd;
        poll.deinit();
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let _ = bun_sys::close(fd);
        }
    }

    /// Put `fd` on the event loop's poller for `POLLPRI`. Both Linux sources
    /// and the macOS filter signal that way. On failure the fd is closed.
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    fn register_pri_poll(global: &JSGlobalObject, fd: Fd) -> Option<NonNull<FilePoll>> {
        let ctx = global.bun_vm().loop_ctx();
        let poll = FilePoll::init(
            ctx,
            fd,
            Default::default(),
            Owner::new(
                poll_tag::MEMORY_PRESSURE,
                NonNull::<()>::dangling().as_ptr(),
            ),
        );
        // SAFETY: `poll` is the fresh hive slot; `platform_event_loop` is the live uws loop.
        let result =
            unsafe { (*poll).register(ctx.platform_event_loop(), Flags::MemoryPressure, false) };
        if result.is_err() {
            // SAFETY: fresh hive slot never handed out.
            deinit_poll(unsafe { &mut *poll });
            return None;
        }
        NonNull::new(poll)
    }

    /// 150 ms of "some"-stall in any 2 s window. 2 s is the only window an
    /// unprivileged PSI trigger may use (kernel 6.4+).
    ///
    /// The trailing NUL is part of the write: `psi_write()` in
    /// `kernel/sched/psi.c` replaces the last byte it receives with NUL
    /// before it parses the buffer. Without it the kernel sees
    /// `some 150000 200000` and rejects the 200 ms window with `EINVAL`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) const PSI_TRIGGER: &[u8] = b"some 150000 2000000\0";

    /// Open a PSI memory file and write a trigger. Tries the system-wide
    /// `/proc/pressure/memory` first, then the current cgroup's file.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn open_psi_fd(own_cgroup: Option<&cgroup::OwnCgroup>) -> Option<Fd> {
        use bun_sys::O;

        const FLAGS: i32 = O::RDWR | O::NONBLOCK | O::CLOEXEC;
        let system_wide = bun_sys::open(bun_core::zstr!("/proc/pressure/memory"), FLAGS, 0).ok();
        let candidates = [
            system_wide,
            own_cgroup.and_then(|cg| cg.open(b"memory.pressure", FLAGS)),
        ];
        for fd in candidates.into_iter().flatten() {
            if bun_sys::write(fd, PSI_TRIGGER).is_ok() {
                return Some(fd);
            }
            let _ = bun_sys::close(fd);
        }
        None
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn new_watcher(global: &JSGlobalObject) -> MemoryPressureWatcher {
        let own_cgroup = cgroup::OwnCgroup::detect();
        MemoryPressureWatcher {
            poll: open_psi_fd(own_cgroup.as_ref()).and_then(|fd| register_pri_poll(global, fd)),
            cgroup: own_cgroup.and_then(|cg| CgroupEvents::open(global, &cg)),
        }
    }

    #[cfg(target_os = "macos")]
    fn new_watcher(global: &JSGlobalObject) -> MemoryPressureWatcher {
        MemoryPressureWatcher {
            poll: register_pri_poll(global, Fd::from_native(0)),
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
    fn new_watcher(_global: &JSGlobalObject) -> MemoryPressureWatcher {
        MemoryPressureWatcher { poll: None }
    }

    pub(super) fn install(global: &JSGlobalObject) {
        let vm = global.bun_vm().as_mut();
        if slot(vm).is_some() {
            return;
        }
        let watcher = Box::new(new_watcher(global));
        *slot(global.bun_vm().as_mut()) = NonNull::new(bun_core::heap::into_raw(watcher).cast());
    }

    /// Names of the sources the installed watcher holds, for
    /// `bun:internal-for-testing`. Empty when nothing could be set up.
    pub(super) fn armed_sources(global: &JSGlobalObject) -> Vec<&'static str> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        const POLL_SOURCE: &str = "psi";
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        const POLL_SOURCE: &str = "memorystatus";

        let (poll, cgroup) = watcher_mut(global.bun_vm().as_mut()).map_or((false, false), |w| {
            (w.poll.is_some(), w.has_cgroup_source())
        });
        [(poll, POLL_SOURCE), (cgroup, "cgroup")]
            .into_iter()
            .filter_map(|(armed, name)| armed.then_some(name))
            .collect()
    }

    impl MemoryPressureWatcher {
        fn has_cgroup_source(&self) -> bool {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            {
                self.cgroup.is_some()
            }
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            {
                false
            }
        }
    }

    pub(super) fn uninstall(global: &JSGlobalObject) {
        let Some(watcher) = take_watcher(global.bun_vm().as_mut()) else {
            return;
        };
        if let Some(mut poll) = watcher.poll {
            // SAFETY: the sources enqueue a task instead of running user JS,
            // so this is never reached from inside a dispatch and no other
            // `&mut FilePoll` is live.
            deinit_poll(unsafe { poll.as_mut() });
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if let Some(mut events) = watcher.cgroup {
            // SAFETY: as above. The cgroup poll is only ever reached through
            // the dispatch, which has returned.
            deinit_poll(unsafe { events.poll.as_mut() });
        }
    }

    /// `__bun_run_file_poll` dispatch target. `fflags` is the kqueue `fflags`
    /// on macOS (carrying the pressure level) and 0 on Linux.
    pub(crate) fn on_poll(poll: &mut FilePoll, fflags: i64) {
        let vm = VirtualMachine::get_mut();

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let Some(watcher) = watcher_mut(vm) else {
                deinit_poll(poll);
                return;
            };
            if watcher
                .cgroup
                .as_ref()
                .is_some_and(|events| events.poll.as_ptr() == core::ptr::from_mut(poll))
            {
                let fd = poll.fd;
                match watcher.cgroup.as_mut().map(|events| events.read(fd)) {
                    Some(Ok(lvl)) => {
                        if let Some(lvl) = lvl {
                            vm.enqueue_task(super::pressure_task(lvl));
                        }
                    }
                    // The file is gone (the process was moved and its old
                    // cgroup removed). kernfs keeps reporting it ready, so
                    // drop the source instead of spinning.
                    Some(Err(())) | None => {
                        watcher.cgroup = None;
                        deinit_poll(poll);
                    }
                }
                return;
            }
            // `EPOLLERR`/`EPOLLHUP` on a PSI fd means the trigger is dead.
            // kernfs reports that permanently, so drop the source instead
            // of emitting, to avoid a level-triggered spin.
            if poll.flags.contains(Flags::Eof) || poll.flags.contains(Flags::Hup) {
                watcher.poll = None;
                deinit_poll(poll);
                return;
            }
        }

        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let _ = poll;
        #[cfg(target_os = "macos")]
        let lvl = fflags as i32;
        #[cfg(not(target_os = "macos"))]
        let lvl = {
            let _ = fflags;
            super::level::CRITICAL
        };
        vm.enqueue_task(super::pressure_task(lvl));
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    mod cgroup {
        use core::ptr::NonNull;
        use core::time::Duration;
        use std::time::Instant;

        use bun_core::strings;
        use bun_io::posix_event_loop::FilePoll;
        use bun_jsc::JSGlobalObject;
        use bun_sys::{Fd, O};

        use super::super::level;

        /// Shortest gap between two events of the same level from this
        /// source. The kernel coalesces `memory.events` notifications to one
        /// per 10 ms, and a cgroup sitting at `memory.max` produces one per
        /// reclaim pass, so without this a listener would run 100 times a
        /// second. 2 s matches the PSI trigger window.
        const CGROUP_HOLDOFF: Duration = Duration::from_secs(2);

        /// The cgroup v2 directory this process belongs to, relative to
        /// `/sys/fs/cgroup`, without a leading slash (empty for the root).
        pub(super) struct OwnCgroup {
            path: [u8; 512],
            len: usize,
        }

        impl OwnCgroup {
            /// Reads the `0::<path>` line of `/proc/self/cgroup`. `None` when
            /// the process is not on a cgroup v2 hierarchy.
            pub(super) fn detect() -> Option<Self> {
                let fd = bun_sys::open(bun_core::zstr!("/proc/self/cgroup"), O::RDONLY, 0).ok()?;
                let mut read = [0u8; 1024];
                let n = bun_sys::read(fd, &mut read).unwrap_or(0);
                let _ = bun_sys::close(fd);
                let rest =
                    strings::split(&read[..n], b"\n").find_map(|line| line.strip_prefix(b"0::"))?;
                let rest = rest.strip_prefix(b"/").unwrap_or(rest);
                let mut path = [0u8; 512];
                let dst = path.get_mut(..rest.len())?;
                dst.copy_from_slice(rest);
                Some(Self {
                    path,
                    len: rest.len(),
                })
            }

            /// Open `<dir>/<file>`. When that does not exist, retry at the
            /// mount root: a container that shares the host's cgroup
            /// namespace sees host paths in `/proc/self/cgroup`, but its
            /// `/sys/fs/cgroup` is mounted at the container's own cgroup.
            pub(super) fn open(&self, file: &[u8], flags: i32) -> Option<Fd> {
                let mut buf = [0u8; 512 + 64];
                let own = &self.path[..self.len];
                let file = core::str::from_utf8(file).ok()?;
                if !own.is_empty() {
                    let own = core::str::from_utf8(own).ok()?;
                    let path = bun_core::fmt::buf_print_z(
                        &mut buf,
                        format_args!("/sys/fs/cgroup/{own}/{file}"),
                    )
                    .ok()?;
                    match bun_sys::open(path, flags, 0) {
                        Ok(fd) => return Some(fd),
                        Err(err) if err.get_errno() == bun_sys::E::ENOENT => {}
                        Err(_) => return None,
                    }
                }
                let path =
                    bun_core::fmt::buf_print_z(&mut buf, format_args!("/sys/fs/cgroup/{file}"))
                        .ok()?;
                bun_sys::open(path, flags, 0).ok()
            }
        }

        /// The `memory.events` counters, folded into the two levels they map
        /// to. Each counter only ever grows, so a sum grows exactly when one
        /// of its members does.
        #[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
        pub(in crate::node::memory_pressure) struct Counters {
            /// `low` + `high` + `max`: reclaim ran because a limit was reached.
            reclaim: u64,
            /// `oom` + `oom_kill` + `oom_group_kill`: reclaim failed.
            oom: u64,
        }

        impl Counters {
            pub(in crate::node::memory_pressure) fn parse(text: &[u8]) -> Counters {
                let mut counters = Counters::default();
                for line in strings::split(text, b"\n") {
                    let Some((key, value)) = strings::split_once_char(line, b' ') else {
                        continue;
                    };
                    let Some(value) = core::str::from_utf8(value)
                        .ok()
                        .and_then(|v| v.trim_ascii().parse::<u64>().ok())
                    else {
                        continue;
                    };
                    match key {
                        b"low" | b"high" | b"max" => counters.reclaim += value,
                        b"oom" | b"oom_kill" | b"oom_group_kill" => counters.oom += value,
                        _ => {}
                    }
                }
                counters
            }

            /// The level a change from `self` to `next` means, if any. A
            /// counter this source does not classify can also move the file.
            fn level_of_change(self, next: Counters) -> Option<i32> {
                if next.oom > self.oom {
                    Some(level::CRITICAL)
                } else if next.reclaim > self.reclaim {
                    Some(level::WARNING)
                } else {
                    None
                }
            }
        }

        /// The `memory.events` source: an open fd on the event loop, the
        /// counters as of the last read, and the holdoff state.
        pub(in crate::node::memory_pressure) struct CgroupEvents {
            pub(super) poll: NonNull<FilePoll>,
            seen: Counters,
            last_warning: Option<Instant>,
            last_critical: Option<Instant>,
        }

        impl CgroupEvents {
            pub(super) fn open(global: &JSGlobalObject, own: &OwnCgroup) -> Option<Self> {
                let fd = own.open(b"memory.events", O::RDONLY | O::NONBLOCK | O::CLOEXEC)?;
                let Ok(seen) = read_counters(fd) else {
                    let _ = bun_sys::close(fd);
                    return None;
                };
                let poll = super::register_pri_poll(global, fd)?;
                Some(Self {
                    poll,
                    seen,
                    last_warning: None,
                    last_critical: None,
                })
            }

            /// Handle a `POLLPRI` wakeup on `fd` (this source's fd, taken from
            /// the poll the event loop handed us). Reading the file is what
            /// clears the kernfs notification, so this reads even while in
            /// holdoff. `Err` means the file is no longer readable.
            pub(super) fn read(&mut self, fd: Fd) -> Result<Option<i32>, ()> {
                let counters = read_counters(fd)?;
                Ok(self.observe(counters, Instant::now()))
            }

            /// Fold a new snapshot in. Returns the level to emit, or `None`
            /// when nothing relevant changed or the level is in holdoff. A
            /// warning also stays quiet right after a critical, so a cgroup
            /// that is both reclaiming and OOM-killing reports the worse one.
            pub(in crate::node::memory_pressure) fn observe(
                &mut self,
                counters: Counters,
                now: Instant,
            ) -> Option<i32> {
                let lvl = self.seen.level_of_change(counters)?;
                self.seen = counters;
                let quiet = |last: Option<Instant>| {
                    last.is_some_and(|at| now.saturating_duration_since(at) < CGROUP_HOLDOFF)
                };
                if lvl == level::CRITICAL {
                    if quiet(self.last_critical) {
                        return None;
                    }
                    self.last_critical = Some(now);
                } else {
                    if quiet(self.last_warning) || quiet(self.last_critical) {
                        return None;
                    }
                    self.last_warning = Some(now);
                }
                Some(lvl)
            }
        }

        fn read_counters(fd: Fd) -> Result<Counters, ()> {
            // Six short lines today (about 70 bytes). A longer file still
            // arms the notification again: kernfs records the read before
            // it renders the content.
            let mut buf = [0u8; 512];
            let n = bun_sys::pread(fd, &mut buf, 0).map_err(drop)?;
            Ok(Counters::parse(&buf[..n]))
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Windows backend: CreateMemoryResourceNotification on a dedicated thread
// ────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod windows {
    use core::ffi::c_void;
    use core::ptr::{self, NonNull};

    use bun_event_loop::ConcurrentTask::ConcurrentTask;
    use bun_jsc::JSGlobalObject;
    use bun_jsc::virtual_machine::VirtualMachine;

    type HANDLE = *mut c_void;
    type BOOL = i32;
    type DWORD = u32;
    const WAIT_OBJECT_0: DWORD = 0;
    const LOW_MEMORY_RESOURCE_NOTIFICATION: i32 = 0;
    /// The notification handle stays signalled while memory is low; after
    /// posting once we wait on `shutdown` alone for this long before
    /// re-checking, so sustained pressure fires at most every 30 s.
    const HOLDOFF_MS: DWORD = 30_000;

    unsafe extern "system" {
        fn CreateMemoryResourceNotification(kind: i32) -> HANDLE;
        fn CreateEventW(
            attrs: *mut c_void,
            manual_reset: BOOL,
            initial: BOOL,
            name: *const u16,
        ) -> HANDLE;
        fn SetEvent(h: HANDLE) -> BOOL;
        fn WaitForSingleObject(h: HANDLE, ms: DWORD) -> DWORD;
        fn WaitForMultipleObjects(n: DWORD, h: *const HANDLE, wait_all: BOOL, ms: DWORD) -> DWORD;
        fn CloseHandle(h: HANDLE) -> BOOL;
    }

    /// Owns a kernel HANDLE; closes on drop.
    struct OwnedHandle(HANDLE);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            // SAFETY: constructed only from a handle returned by the kernel.
            unsafe { CloseHandle(self.0) };
        }
    }

    struct MemoryPressureWatcher {
        /// Held only so it is closed on drop after the thread joins.
        _notify: OwnedHandle,
        shutdown: OwnedHandle,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    fn slot(vm: &mut VirtualMachine) -> &mut Option<NonNull<c_void>> {
        vm.rare_data().memory_pressure_watcher_slot()
    }

    fn thread_main(vm: bun_jsc::VmHandle, notify: usize, shutdown: usize) {
        bun_core::output::Source::configure_named_thread(bun_core::zstr!("MemoryPressure"));
        let handles: [HANDLE; 2] = [shutdown as HANDLE, notify as HANDLE];
        loop {
            // SAFETY: `uninstall` joins before closing the handles.
            let rc = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, u32::MAX) };
            if rc != WAIT_OBJECT_0 + 1 {
                break;
            }
            let task = ConcurrentTask::create(super::pressure_task(super::level::CRITICAL));
            if let bun_jsc::vm_handle::Posted::Refused(task) =
                vm.post(bun_jsc::LoopKind::Regular, task)
            {
                // VM torn down (uninstall joins us right after): drop the notification.
                // SAFETY: refused ⇒ we own the task box.
                unsafe { drop(bun_core::heap::take(task.as_ptr())) };
                break;
            }
            // SAFETY: `shutdown` is valid for the thread's lifetime.
            if unsafe { WaitForSingleObject(handles[0], HOLDOFF_MS) } == WAIT_OBJECT_0 {
                break;
            }
        }
    }

    pub(super) fn install(global: &JSGlobalObject) {
        let vm = global.bun_vm().as_mut();
        if slot(vm).is_some() {
            return;
        }

        // SAFETY: FFI; returns NULL on failure.
        let notify = unsafe { CreateMemoryResourceNotification(LOW_MEMORY_RESOURCE_NOTIFICATION) };
        if notify.is_null() {
            return;
        }
        let notify = OwnedHandle(notify);
        // SAFETY: FFI; manual-reset, initially non-signalled, unnamed.
        let shutdown = unsafe { CreateEventW(ptr::null_mut(), 1, 0, ptr::null()) };
        if shutdown.is_null() {
            return;
        }
        let shutdown = OwnedHandle(shutdown);

        let (vm, n, s) = (
            global.bun_vm().handle(),
            notify.0 as usize,
            shutdown.0 as usize,
        );
        let Ok(thread) = std::thread::Builder::new()
            .name("MemoryPressure".into())
            .stack_size(64 * 1024)
            .spawn(move || thread_main(vm, n, s))
        else {
            return;
        };

        let watcher = Box::new(MemoryPressureWatcher {
            _notify: notify,
            shutdown,
            thread: Some(thread),
        });
        *slot(global.bun_vm().as_mut()) = NonNull::new(bun_core::heap::into_raw(watcher).cast());
    }

    pub(super) fn uninstall(global: &JSGlobalObject) {
        let Some(raw) = slot(global.bun_vm().as_mut()).take() else {
            return;
        };
        // SAFETY: slot is populated only by `install` with a `Box<MemoryPressureWatcher>`.
        let mut watcher =
            unsafe { bun_core::heap::take(raw.as_ptr().cast::<MemoryPressureWatcher>()) };
        // SAFETY: FFI; `shutdown` is a valid event owned by `watcher`.
        unsafe { SetEvent(watcher.shutdown.0) };
        if let Some(thread) = watcher.thread.take() {
            let _ = thread.join();
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// C-ABI exports for BunProcess.cpp / InternalForTesting.cpp
// ────────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__MemoryPressure__install(global: &JSGlobalObject) {
    #[cfg(not(windows))]
    posix::install(global);
    #[cfg(windows)]
    windows::install(global);
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__MemoryPressure__uninstall(global: &JSGlobalObject) {
    #[cfg(not(windows))]
    posix::uninstall(global);
    #[cfg(windows)]
    windows::uninstall(global);
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__MemoryPressure__emit(global: &JSGlobalObject, lvl: i32) {
    emit(global, lvl);
}

#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__MemoryPressure__isInstalled(global: &JSGlobalObject) -> bool {
    global
        .bun_vm()
        .as_mut()
        .rare_data()
        .memory_pressure_watcher_slot()
        .is_some()
}

// ────────────────────────────────────────────────────────────────────────────
// bun:internal-for-testing hooks
// ────────────────────────────────────────────────────────────────────────────

/// `memoryPressurePsiTrigger()`: the bytes `open_psi_fd` writes, as a
/// `Buffer`. `null` where there is no PSI backend.
#[bun_jsc::host_fn]
pub(crate) fn js_psi_trigger(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        ArrayBuffer::create_buffer(global, posix::PSI_TRIGGER)
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = global;
        Ok(JSValue::NULL)
    }
}

/// `memoryPressureArmedSources()`: the names of the OS sources the watcher
/// installed by the current listeners holds. Linux: `"psi"` and `"cgroup"`.
/// macOS: `"memorystatus"`. Windows: `"notification"`. Empty when no source
/// could be set up, which `isInstalled` does not show.
#[bun_jsc::host_fn]
pub(crate) fn js_armed_sources(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(not(windows))]
    let names: Vec<&'static str> = posix::armed_sources(global);
    #[cfg(windows)]
    let names: Vec<&'static str> = if Bun__MemoryPressure__isInstalled(global) {
        vec!["notification"]
    } else {
        Vec::new()
    };
    JSValue::create_array_from_iter(global, names.into_iter(), |name| {
        bun_string_jsc::create_utf8_for_js(global, name.as_bytes())
    })
}

/// `memoryPressureInjectCgroupEvents(text, atMs)`: feed a `memory.events`
/// body to the installed cgroup source as if the kernel had signalled it.
/// `atMs` is the holdoff clock reading for this notification, on a clock
/// that starts at the first call, so a test drives the holdoff without
/// waiting. Emits exactly what a real notification with that content would.
/// Returns `false` when no cgroup source is installed.
#[bun_jsc::host_fn]
pub(crate) fn js_inject_cgroup_events(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        use std::time::{Duration, Instant};
        static CLOCK_START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();

        let [text, at_ms] = frame.arguments_as_array::<2>();
        let text = bun_core::OwnedString::new(text.to_bun_string(global)?);
        let at = *CLOCK_START.get_or_init(Instant::now)
            + Duration::from_millis(at_ms.to_int32().max(0) as u64);

        let vm = global.bun_vm().as_mut();
        let Some(events) = posix::watcher_mut(vm).and_then(|w| w.cgroup.as_mut()) else {
            return Ok(JSValue::js_boolean(false));
        };
        let counters = posix::Counters::parse(text.to_utf8().slice());
        if let Some(lvl) = events.observe(counters, at) {
            vm.enqueue_task(pressure_task(lvl));
        }
        Ok(JSValue::js_boolean(true))
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (global, frame);
        Ok(JSValue::js_boolean(false))
    }
}

#[cfg(not(windows))]
pub(crate) use posix::on_poll;
