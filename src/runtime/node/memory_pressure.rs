//! `process.on("memoryPressure", level => ...)` — OS-level low-memory
//! notifications without polling.
//!
//! Backends:
//!   - macOS: `EVFILT_MEMORYSTATUS` on the main event loop's kqueue (the same
//!     filter libdispatch's `DISPATCH_SOURCE_TYPE_MEMORYPRESSURE` uses). The
//!     kernel delivers `NOTE_MEMORYSTATUS_PRESSURE_WARN` / `_CRITICAL` in
//!     `fflags` when `kern.memorystatus_level` crosses the warn/critical
//!     thresholds.
//!   - Linux: PSI trigger on `/proc/pressure/memory` (or the cgroup v2
//!     `memory.pressure` file for the container's own cgroup). PSI triggers
//!     signal via `POLLPRI`. Requires `CAP_SYS_RESOURCE` before kernel 6.6,
//!     and PSI enabled (`CONFIG_PSI=y`). If neither path can be opened for
//!     writing, the watcher silently does nothing.
//!   - Windows: a dedicated thread blocks on
//!     `CreateMemoryResourceNotification(LowMemoryResourceNotification)` and
//!     posts back to the JS event loop when it signals, with a 30 s holdoff
//!     before re-waiting (the handle is level-triggered).
//!
//! All three backends post a `MemoryPressureTask` to the event loop rather
//! than calling into JS from the detector, so a listener removing itself
//! during `emit()` never races with the poll/thread that produced the event.
//!
//! Armed lazily on the first listener and disarmed on the last removal via
//! `onDidChangeListeners` in `BunProcess.cpp`, matching how signal handlers
//! are wired. The watcher does not keep the event loop alive.

use bun_event_loop::ConcurrentTask::{Task, task_tag};
use bun_jsc::JSGlobalObject;
#[cfg(not(windows))]
use bun_jsc::virtual_machine::VirtualMachine;
#[cfg(not(windows))]
use core::ptr::NonNull;

/// Pressure level passed to JS. Values are the `NOTE_MEMORYSTATUS_PRESSURE_*`
/// bits on macOS so the kqueue dispatch can pass `fflags` through unchanged.
pub mod level {
    pub const WARNING: i32 = 0x00000002;
    pub const CRITICAL: i32 = 0x00000004;
}

unsafe extern "C" {
    fn Process__emitMemoryPressureEvent(global: *mut JSGlobalObject, level: i32);
}

/// `run_task` target for `task_tag::MemoryPressureTask`. `lvl` is the packed
/// task payload (macOS kevent `fflags`, or `level::CRITICAL` elsewhere).
pub fn emit(global: &JSGlobalObject, lvl: i32) {
    // macOS can deliver WARN|CRITICAL together under EV_CLEAR; pick the more severe.
    let lvl = if lvl & level::CRITICAL != 0 || lvl & level::WARNING == 0 {
        level::CRITICAL
    } else {
        level::WARNING
    };
    // SAFETY: FFI; `global` is the live per-thread global.
    unsafe { Process__emitMemoryPressureEvent(core::ptr::from_ref(global).cast_mut(), lvl) };
}

pub(crate) fn pressure_task(lvl: i32) -> Task {
    Task::new(task_tag::MemoryPressureTask, lvl as usize as *mut ())
}

#[cfg(not(windows))]
fn slot(vm: &mut VirtualMachine) -> &mut Option<NonNull<core::ffi::c_void>> {
    vm.rare_data().memory_pressure_watcher_slot()
}

// ────────────────────────────────────────────────────────────────────────────
// POSIX backend (macOS EVFILT_MEMORYSTATUS, Linux PSI) via FilePoll
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

    use super::slot;

    /// Stored type-erased in `RareData.memory_pressure_watcher`. `poll` is
    /// `None` when the OS backend is unavailable so `isInstalled` still
    /// reflects listener presence.
    struct MemoryPressureWatcher {
        poll: Option<NonNull<FilePoll>>,
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

    /// Build `/sys/fs/cgroup/<current>/memory.pressure` from the cgroup v2
    /// entry in `/proc/self/cgroup`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn own_cgroup_pressure_path(buf: &mut [u8]) -> Option<&bun_core::ZStr> {
        use bun_sys::O;
        let fd = bun_sys::open(bun_core::zstr!("/proc/self/cgroup"), O::RDONLY, 0).ok()?;
        let mut read = [0u8; 256];
        let n = bun_sys::read(fd, &mut read).unwrap_or(0);
        let _ = bun_sys::close(fd);
        for line in read[..n].split(|&b| b == b'\n') {
            let Some(rest) = line.strip_prefix(b"0::") else {
                continue;
            };
            let rest = core::str::from_utf8(rest.strip_prefix(b"/").unwrap_or(rest)).ok()?;
            return bun_core::fmt::buf_print_z(
                buf,
                format_args!(
                    "/sys/fs/cgroup/{}{}memory.pressure",
                    rest,
                    if rest.is_empty() { "" } else { "/" }
                ),
            )
            .ok();
        }
        None
    }

    /// Open a PSI memory file and write a trigger. Tries the system-wide
    /// `/proc/pressure/memory` first, then the current cgroup's file.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn open_psi_fd() -> Option<Fd> {
        use bun_sys::O;

        /// 150 ms of "some"-stall in any 2 s window (the minimum for
        /// unprivileged PSI triggers, kernel 6.6+). psi_write NUL-terminates
        /// in place over the last byte written, so the NUL must be included.
        const TRIGGER: &[u8] = b"some 150000 2000000\0";

        let mut cgroup_buf = [0u8; 320];
        let paths = [
            Some(bun_core::zstr!("/proc/pressure/memory")),
            own_cgroup_pressure_path(&mut cgroup_buf),
        ];
        for path in paths.into_iter().flatten() {
            let Ok(fd) = bun_sys::open(path, O::RDWR | O::NONBLOCK | O::CLOEXEC, 0) else {
                continue;
            };
            if bun_sys::write(fd, TRIGGER).is_ok() {
                return Some(fd);
            }
            let _ = bun_sys::close(fd);
        }
        None
    }

    fn register_os_watch(global: &JSGlobalObject) -> Option<NonNull<FilePoll>> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let fd = open_psi_fd()?;
        #[cfg(target_os = "macos")]
        let fd = Fd::from_native(0);
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
        {
            let _ = global;
            return None;
        }
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
        {
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
            let result = unsafe {
                (*poll).register(ctx.platform_event_loop(), Flags::MemoryPressure, false)
            };
            if result.is_err() {
                // SAFETY: fresh hive slot never handed out.
                deinit_poll(unsafe { &mut *poll });
                return None;
            }
            NonNull::new(poll)
        }
    }

    pub(super) fn install(global: &JSGlobalObject) {
        let vm = global.bun_vm().as_mut();
        if slot(vm).is_some() {
            return;
        }
        let watcher = Box::new(MemoryPressureWatcher {
            poll: register_os_watch(global),
        });
        *slot(global.bun_vm().as_mut()) = NonNull::new(bun_core::heap::into_raw(watcher).cast());
    }

    pub(super) fn has_os_backend(global: &JSGlobalObject) -> bool {
        match slot(global.bun_vm().as_mut()) {
            // SAFETY: slot is populated only by `install` with a `Box<MemoryPressureWatcher>`.
            Some(raw) => unsafe { raw.cast::<MemoryPressureWatcher>().as_ref() }
                .poll
                .is_some(),
            None => false,
        }
    }

    pub(super) fn uninstall(global: &JSGlobalObject) {
        let Some(watcher) = take_watcher(global.bun_vm().as_mut()) else {
            return;
        };
        if let Some(mut poll) = watcher.poll {
            // SAFETY: `on_poll` enqueues a task instead of running user JS,
            // so this is never reached from inside the dispatch and no other
            // `&mut FilePoll` is live.
            deinit_poll(unsafe { poll.as_mut() });
        }
    }

    /// `__bun_run_file_poll` dispatch target. `fflags` is the kqueue `fflags`
    /// on macOS (carrying the pressure level) and 0 on Linux.
    pub fn on_poll(poll: &mut FilePoll, fflags: i64) {
        let vm = VirtualMachine::get_mut();

        // `EPOLLERR`/`EPOLLHUP` on a PSI fd means the trigger is dead (e.g.
        // the cgroup was removed). kernfs reports that permanently, so tear
        // the watch down instead of emitting to avoid a level-triggered spin.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if poll.flags.contains(Flags::Eof) || poll.flags.contains(Flags::Hup) {
            drop(take_watcher(vm));
            deinit_poll(poll);
            return;
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

    fn thread_main(vm_addr: usize, notify: usize, shutdown: usize) {
        bun_core::output::Source::configure_named_thread(bun_core::zstr!("MemoryPressure"));
        let handles: [HANDLE; 2] = [shutdown as HANDLE, notify as HANDLE];
        loop {
            // SAFETY: `uninstall` joins before closing the handles.
            let rc = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, u32::MAX) };
            if rc != WAIT_OBJECT_0 + 1 {
                break;
            }
            let task = ConcurrentTask::create(super::pressure_task(super::level::CRITICAL));
            // SAFETY: main-thread VM captured at install; process-lifetime.
            unsafe { &*(vm_addr as *const VirtualMachine) }
                .event_loop_shared()
                .enqueue_task_concurrent(task);
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

        let (vm_addr, n, s) = (
            core::ptr::from_ref(global.bun_vm()) as usize,
            notify.0 as usize,
            shutdown.0 as usize,
        );
        let Ok(thread) = std::thread::Builder::new()
            .name("MemoryPressure".into())
            .stack_size(64 * 1024)
            .spawn(move || thread_main(vm_addr, n, s))
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
pub extern "C" fn Bun__MemoryPressure__install(global: &JSGlobalObject) {
    #[cfg(not(windows))]
    posix::install(global);
    #[cfg(windows)]
    windows::install(global);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__MemoryPressure__uninstall(global: &JSGlobalObject) {
    #[cfg(not(windows))]
    posix::uninstall(global);
    #[cfg(windows)]
    windows::uninstall(global);
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__MemoryPressure__emit(global: &JSGlobalObject, lvl: i32) {
    emit(global, lvl);
}

/// Whether the installed watcher actually registered an OS-level signal
/// source (PSI trigger / kqueue filter / notification thread), as opposed to
/// the silent no-backend fallback. Windows installs are all-or-nothing.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__MemoryPressure__hasOsBackend(global: &JSGlobalObject) -> bool {
    #[cfg(not(windows))]
    {
        posix::has_os_backend(global)
    }
    #[cfg(windows)]
    {
        Bun__MemoryPressure__isInstalled(global)
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__MemoryPressure__isInstalled(global: &JSGlobalObject) -> bool {
    global
        .bun_vm()
        .as_mut()
        .rare_data()
        .memory_pressure_watcher_slot()
        .is_some()
}

#[cfg(not(windows))]
pub use posix::on_poll;
