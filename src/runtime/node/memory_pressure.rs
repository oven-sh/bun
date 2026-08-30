//! `process.on("memoryPressure", level => ...)` — OS-level low-memory
//! notifications without polling.
//!
//! Backends:
//!   - macOS: `EVFILT_MEMORYSTATUS` on the main event loop's kqueue (the same
//!     filter libdispatch's `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` uses). The
//!     kernel delivers `NOTE_MEMORYSTATUS_PRESSURE_WARN` / `_CRITICAL` in
//!     `fflags` when `kern.memorystatus_level` crosses the warn/critical
//!     thresholds.
//!   - Linux: a PSI trigger on `/proc/pressure/memory` (or the cgroup's own
//!     `memory.pressure`), emitted as `critical`. Needs `CONFIG_PSI=y`, and
//!     `CAP_SYS_RESOURCE` before kernel 6.4. Plus the cgroup v2 `memory.events`
//!     file of the process's own cgroup, which is readable on the read-only
//!     cgroup mount a container gets and signals `POLLPRI` on every counter
//!     change: `low`/`high`/`max` emit `warning`, `oom*` emit `critical`.
//!     A source that cannot be set up is skipped.
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
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, bun_string_jsc};
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

/// `RareData.memory_pressure_watcher`: the erased `Box` of the backend's watcher.
type Slot = Option<NonNull<core::ffi::c_void>>;

fn slot(vm: &mut VirtualMachine) -> &mut Slot {
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

    use super::{Slot, slot};

    /// Stored type-erased in `RareData.memory_pressure_watcher`. It exists
    /// while listeners exist, even when no source could be set up.
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
        // that lives until `uninstall` takes it. Callers run on the JS thread
        // and never hold the reference across a call that can reach
        // `uninstall` (the sources enqueue a task instead of running JS).
        Some(unsafe { &mut *raw.as_ptr().cast::<MemoryPressureWatcher>() })
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

    /// Poll `fd` for `POLLPRI`, which is how every source here signals. On
    /// failure the fd is closed.
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

    /// Arm a PSI trigger on the system-wide `/proc/pressure/memory`, or
    /// failing that on the current cgroup's `memory.pressure`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn open_psi_fd(own_cgroup: Option<&cgroup::OwnCgroup>) -> Option<Fd> {
        use bun_sys::O;

        const FLAGS: i32 = O::RDWR | O::NONBLOCK | O::CLOEXEC;
        bun_sys::open(bun_core::zstr!("/proc/pressure/memory"), FLAGS, 0)
            .ok()
            .and_then(write_psi_trigger)
            .or_else(|| {
                own_cgroup?
                    .open(b"memory.pressure", FLAGS)
                    .and_then(write_psi_trigger)
            })
    }

    /// Returns `fd` armed, or closes it when the kernel rejects the trigger.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn write_psi_trigger(fd: Fd) -> Option<Fd> {
        if bun_sys::write(fd, PSI_TRIGGER).is_ok() {
            return Some(fd);
        }
        let _ = bun_sys::close(fd);
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

    /// For `bun:internal-for-testing`: which sources are set up.
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

    pub(super) fn release(slot: &mut Slot) {
        let Some(raw) = slot.take() else {
            return;
        };
        // SAFETY: slot is populated only by `install` with a `Box<MemoryPressureWatcher>`.
        let watcher = unsafe { bun_core::heap::take(raw.as_ptr().cast::<MemoryPressureWatcher>()) };
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
                    // kernfs reports a removed file as ready forever: drop
                    // the source rather than spin.
                    Some(Err(())) | None => {
                        watcher.cgroup = None;
                        deinit_poll(poll);
                    }
                }
                return;
            }
            // A dead PSI trigger reports `EPOLLERR` forever: drop the source
            // rather than spin.
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

        /// Per level. The kernel only coalesces `memory.events` notifications
        /// to one per 10 ms, and a cgroup at `memory.max` produces one per
        /// reclaim pass. 2 s is also the PSI trigger window.
        const CGROUP_HOLDOFF: Duration = Duration::from_secs(2);

        /// The `0::` entry of `/proc/self/cgroup`, without its leading slash.
        pub(super) struct OwnCgroup {
            path: [u8; 512],
            len: usize,
        }

        impl OwnCgroup {
            /// `None` when the process is not on a cgroup v2 hierarchy.
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

            /// A container in the host's cgroup namespace sees host paths in
            /// `/proc/self/cgroup`, but has its own cgroup mounted at
            /// `/sys/fs/cgroup`, so a missing path falls back to the root.
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

        /// `memory.events`, summed per level. The counters never decrease, so
        /// a sum grows exactly when one of its members does.
        #[derive(Clone, Copy, Default, PartialEq, Eq, Debug)]
        pub(in crate::node::memory_pressure) struct Counters {
            /// `low` + `high` + `max`.
            reclaim: u64,
            /// `oom` + `oom_kill` + `oom_group_kill`.
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

        pub(in crate::node::memory_pressure) struct CgroupEvents {
            pub(super) poll: NonNull<FilePoll>,
            seen: Counters,
            last_warning: Option<Instant>,
            last_critical: Option<Instant>,
            /// Origin of the `bun:internal-for-testing` clock, once a test
            /// has taken this source over.
            injected_epoch: Option<Instant>,
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
                    injected_epoch: None,
                })
            }

            /// The read is what clears the kernfs notification, so it happens
            /// on every wakeup, holdoff or not. `Err`: the file is unreadable.
            pub(super) fn read(&mut self, fd: Fd) -> Result<Option<i32>, ()> {
                let counters = read_counters(fd)?;
                Ok(self.observe(counters, Instant::now()))
            }

            /// The level to emit for the new snapshot, if any. A critical
            /// also silences warnings, so a cgroup that reclaims and OOM-kills
            /// at the same time reports the worse of the two.
            fn observe(&mut self, counters: Counters, now: Instant) -> Option<i32> {
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

            /// For `bun:internal-for-testing`. The first call on a source makes
            /// `counters` its baseline and starts the clock `at_ms` is read on.
            pub(in crate::node::memory_pressure) fn inject(
                &mut self,
                counters: Counters,
                at_ms: u64,
            ) -> Option<i32> {
                let Some(epoch) = self.injected_epoch else {
                    self.injected_epoch = Some(Instant::now());
                    self.seen = counters;
                    self.last_warning = None;
                    self.last_critical = None;
                    return None;
                };
                self.observe(counters, epoch + Duration::from_millis(at_ms))
            }
        }

        fn read_counters(fd: Fd) -> Result<Counters, ()> {
            // Six short lines. kernfs re-arms the notification on any read,
            // whatever its length.
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

    use super::{Slot, slot};

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

    pub(super) fn release(slot: &mut Slot) {
        let Some(raw) = slot.take() else {
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
    release(slot(global.bun_vm().as_mut()));
}

fn release(slot: &mut Slot) {
    #[cfg(not(windows))]
    posix::release(slot);
    #[cfg(windows)]
    windows::release(slot);
}

/// VM teardown and the `bun test --isolate` swap: the listeners the watcher
/// served belong to the outgoing global, so nothing removes them through
/// `onDidChangeListeners`. Runs while the event loop is still alive.
///
/// # Safety
/// `vm` is the live per-thread VM, on the JS thread.
pub(crate) unsafe fn shutdown_for_exit(vm: *mut VirtualMachine) {
    // Read the raw option so a VM that never used rare data does not
    // allocate it here.
    // SAFETY: per fn contract.
    if let Some(rare) = unsafe { &mut (*vm).rare_data }.as_deref_mut() {
        release(rare.memory_pressure_watcher_slot());
    }
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

/// `memoryPressureArmedSources()`: `"psi"` / `"cgroup"` / `"memorystatus"` /
/// `"notification"`, whichever are set up.
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

/// `memoryPressureInjectCgroupEvents(text, atMs)`: see `CgroupEvents::inject`.
/// `false` when no cgroup source is installed.
#[bun_jsc::host_fn]
pub(crate) fn js_inject_cgroup_events(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let [text, at_ms] = frame.arguments_as_array::<2>();
        let text = bun_core::OwnedString::new(text.to_bun_string(global)?);
        let counters = posix::Counters::parse(text.to_utf8().slice());
        let at_ms = at_ms.get_number().unwrap_or(0.0).max(0.0) as u64;

        let vm = global.bun_vm().as_mut();
        let Some(events) = posix::watcher_mut(vm).and_then(|w| w.cgroup.as_mut()) else {
            return Ok(JSValue::js_boolean(false));
        };
        if let Some(lvl) = events.inject(counters, at_ms) {
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
