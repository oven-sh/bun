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
//!     posts a `ConcurrentTask` back to the JS event loop when it signals,
//!     with a 30 s holdoff before re-waiting (the handle is level-triggered).
//!
//! Armed lazily on the first listener and disarmed on the last removal via
//! `onDidChangeListeners` in `BunProcess.cpp`, matching how signal handlers
//! are wired. The watcher does not keep the event loop alive.

use bun_jsc::JSGlobalObject;

/// Pressure level passed to JS. Values are the `NOTE_MEMORYSTATUS_PRESSURE_*`
/// bits on macOS so the kqueue dispatch can pass `fflags` through unchanged.
pub mod level {
    pub const WARNING: i32 = 0x00000002;
    pub const CRITICAL: i32 = 0x00000004;
}

unsafe extern "C" {
    /// Defined in `src/jsc/bindings/BunProcess.cpp`. Builds the level string
    /// and emits `"memoryPressure"` on the process object.
    fn Process__emitMemoryPressureEvent(global: *mut JSGlobalObject, level: i32);
}

/// Emit the `"memoryPressure"` event on the given global's process object.
/// Called from the `FilePoll` dispatch arm (already on the JS thread).
pub fn emit(global: &JSGlobalObject, lvl: i32) {
    // Anything other than WARN is reported as critical. On Linux the PSI
    // trigger doesn't carry a level, and on Windows there is only
    // `LowMemoryResourceNotification`; both map to critical.
    let lvl = if lvl & level::WARNING != 0 {
        level::WARNING
    } else {
        level::CRITICAL
    };
    // SAFETY: `global` is the live per-thread global; the C++ side handles
    // the "no listeners" case via `hasEventListeners`.
    unsafe { Process__emitMemoryPressureEvent(core::ptr::from_ref(global).cast_mut(), lvl) };
}

// ────────────────────────────────────────────────────────────────────────────
// POSIX backend (macOS EVFILT_MEMORYSTATUS, Linux PSI) via FilePoll
// ────────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
mod posix {
    use core::ptr::{self, NonNull};

    use bun_io::posix_event_loop::{EventLoopCtx, FilePoll, Flags, Owner, poll_tag};
    use bun_jsc::JSGlobalObject;
    use bun_jsc::virtual_machine::VirtualMachine;
    use bun_sys::Fd;

    /// Per-VM watcher. Stored type-erased in `RareData.memory_pressure_watcher`.
    pub(super) struct MemoryPressureWatcher {
        /// Back-pointer so the poll dispatch can reach JS without going through
        /// the per-thread VM singleton (workers each have their own global).
        global: *mut JSGlobalObject,
        /// Always set once `install` returns. The poll owns the PSI fd on Linux
        /// (closed in `uninstall`); on macOS the fd slot is the kevent ident (0).
        poll: *mut FilePoll,
        /// Whether `poll` was successfully registered with kqueue/epoll. On
        /// Linux this is false when PSI is unavailable or requires privileges
        /// we don't have; the emit path is still functional for tests.
        registered: bool,
    }

    fn slot(vm: &mut VirtualMachine) -> &mut Option<NonNull<core::ffi::c_void>> {
        vm.rare_data().memory_pressure_watcher_slot()
    }

    /// Build `/sys/fs/cgroup/<current>/memory.pressure` from the cgroup v2
    /// entry in `/proc/self/cgroup`. Inside a cgroup namespace the entry is
    /// `0::/`, which yields `/sys/fs/cgroup/memory.pressure` (the container's
    /// delegated root). Outside a namespace the path may be a systemd slice.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn own_cgroup_pressure_path(buf: &mut [u8]) -> Option<&bun_core::ZStr> {
        use bun_sys::O;
        let fd = bun_sys::open(bun_core::zstr!("/proc/self/cgroup"), O::RDONLY, 0).ok()?;
        let mut read = [0u8; 256];
        let n = bun_sys::read(fd, &mut read).unwrap_or(0);
        let _ = bun_sys::close(fd);
        // cgroup v2 line: "0::<path>\n". v1 lines are "N:controllers:<path>";
        // we only want the unified hierarchy.
        for line in read[..n].split(|&b| b == b'\n') {
            let Some(rest) = line.strip_prefix(b"0::") else {
                continue;
            };
            let rest = rest.strip_prefix(b"/").unwrap_or(rest);
            // cgroup v2 names are restricted to non-NUL, non-`/` bytes and in
            // practice systemd-escaped ASCII, so this always succeeds; go
            // through `str` so the bytes are spliced verbatim (systemd unit
            // names can contain literal `\` which `escape_ascii` would mangle).
            let rest = core::str::from_utf8(rest).ok()?;
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
    /// `/proc/pressure/memory` first, then the current cgroup's
    /// `memory.pressure` (relevant inside containers that can't write the
    /// global file). Returns the fd on success.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn open_psi_fd() -> Option<Fd> {
        use bun_sys::O;

        /// 150 ms of "some"-stall in any 2 s window. 2 s is the minimum window
        /// for unprivileged PSI triggers (kernel 6.6+).
        const TRIGGER: &[u8] = b"some 150000 2000000";

        let mut cgroup_buf = [0u8; 320];
        let paths: [Option<&bun_core::ZStr>; 2] = [
            Some(bun_core::zstr!("/proc/pressure/memory")),
            own_cgroup_pressure_path(&mut cgroup_buf),
        ];
        for path in paths.into_iter().flatten() {
            let fd = match bun_sys::open(path, O::RDWR | O::NONBLOCK | O::CLOEXEC, 0) {
                Ok(fd) => fd,
                Err(_) => continue,
            };
            match bun_sys::write(fd, TRIGGER) {
                Ok(_) => return Some(fd),
                Err(_) => {
                    let _ = bun_sys::close(fd);
                    continue;
                }
            }
        }
        None
    }

    pub(super) fn install(global: &JSGlobalObject) {
        let vm = global.bun_vm_ptr();
        // SAFETY: `bun_vm_ptr()` asserts same-thread; VM outlives this call.
        let vm_ref = unsafe { &mut *vm };
        if slot(vm_ref).is_some() {
            return;
        }

        // SAFETY: VM singleton is live for the JS thread.
        let ctx: EventLoopCtx = unsafe { VirtualMachine::event_loop_ctx(vm) };

        let watcher = bun_core::heap::into_raw(Box::new(MemoryPressureWatcher {
            global: ptr::from_ref(global).cast_mut(),
            poll: ptr::null_mut(),
            registered: false,
        }));

        #[cfg(any(target_os = "linux", target_os = "android"))]
        let fd = open_psi_fd();
        #[cfg(target_os = "macos")]
        let fd = Some(Fd::from_native(0));
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
        let fd: Option<Fd> = None;

        if let Some(fd) = fd {
            let poll = FilePoll::init(
                ctx,
                fd,
                Default::default(),
                Owner::new(poll_tag::MEMORY_PRESSURE, watcher.cast()),
            );
            // SAFETY: `poll` was just allocated by `FilePoll::init` (sole borrow);
            // `platform_event_loop` returns the live uws loop.
            let registered = match unsafe { &mut *poll }.register(
                unsafe { ctx.platform_event_loop() },
                Flags::MemoryPressure,
                false,
            ) {
                bun_sys::Result::Ok(()) => true,
                Err(_) => {
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    {
                        let _ = bun_sys::close(fd);
                    }
                    false
                }
            };
            // SAFETY: `watcher` was just heap-allocated above; sole owner.
            unsafe {
                (*watcher).poll = poll;
                (*watcher).registered = registered;
            }
        }

        // SAFETY: VM singleton is live; re-derive to avoid holding a `&mut` across the register.
        *slot(unsafe { &mut *vm }) = NonNull::new(watcher.cast());
    }

    pub(super) fn uninstall(global: &JSGlobalObject) {
        let vm = global.bun_vm_ptr();
        // SAFETY: same-thread VM access (asserted by `bun_vm_ptr`).
        let Some(raw) = core::mem::take(slot(unsafe { &mut *vm })) else {
            return;
        };
        // SAFETY: slot was populated by `install` with a `Box<MemoryPressureWatcher>`.
        let watcher = unsafe { bun_core::heap::take(raw.as_ptr().cast::<MemoryPressureWatcher>()) };

        if !watcher.poll.is_null() {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            let psi_fd = if watcher.registered {
                // SAFETY: `poll` is live until `deinit` below.
                Some(unsafe { (*watcher.poll).fd })
            } else {
                None
            };

            // `deinit` unregisters (kqueue EV_DELETE / epoll CTL_DEL) and returns
            // the slot to the hive; fd ownership is ours.
            // SAFETY: `poll` is a live hive slot until this call returns.
            unsafe { (*watcher.poll).deinit() };

            #[cfg(any(target_os = "linux", target_os = "android"))]
            if let Some(fd) = psi_fd {
                let _ = bun_sys::close(fd);
            }
        }
    }

    /// `__bun_run_file_poll` dispatch target. `fflags` is the kqueue `fflags`
    /// on macOS (carrying the pressure level) and 0 on Linux.
    ///
    /// # Safety
    /// `poll` is the live `FilePoll` this dispatch is running for and
    /// `owner_ptr` is the `MemoryPressureWatcher` set via `Owner::new` in
    /// `install`; both outlive the call (guaranteed by `__bun_run_file_poll`).
    pub unsafe fn on_poll(poll: *mut FilePoll, owner_ptr: *mut core::ffi::c_void, fflags: i64) {
        let watcher = owner_ptr.cast::<MemoryPressureWatcher>();

        // `EPOLLERR`/`EPOLLHUP` on a PSI fd means the trigger is dead (e.g.
        // the cgroup whose `memory.pressure` we opened was removed). kernfs
        // reports that condition permanently, so a level-triggered
        // registration would spin the loop. Tear the watch down instead of
        // emitting; `uninstall` sees `poll == null` and skips the second
        // deinit. No equivalent on macOS: `EVFILT_MEMORYSTATUS` is system-wide.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        // SAFETY: caller contract above.
        unsafe {
            if (*poll).flags.contains(Flags::Eof) || (*poll).flags.contains(Flags::Hup) {
                let fd = (*poll).fd;
                (*poll).deinit();
                let _ = bun_sys::close(fd);
                (*watcher).poll = ptr::null_mut();
                (*watcher).registered = false;
                return;
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let _ = poll;

        // SAFETY: caller contract above; `global` was captured at install time.
        let global = unsafe { &*(*watcher).global };
        #[cfg(target_os = "macos")]
        let lvl = fflags as i32;
        #[cfg(not(target_os = "macos"))]
        let lvl = {
            let _ = fflags;
            super::level::CRITICAL
        };
        super::emit(global, lvl);
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Windows backend: CreateMemoryResourceNotification on a dedicated thread
// ────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod windows {
    use core::ffi::c_void;
    use core::ptr::{self, NonNull};

    use bun_event_loop::ConcurrentTask::{ConcurrentTask, Task, task_tag};
    use bun_jsc::JSGlobalObject;
    use bun_jsc::virtual_machine::VirtualMachine;

    type HANDLE = *mut c_void;
    type BOOL = i32;
    type DWORD = u32;
    const WAIT_OBJECT_0: DWORD = 0;
    /// `LowMemoryResourceNotification` enum value.
    const LOW_MEMORY_RESOURCE_NOTIFICATION: i32 = 0;
    /// The low-memory notification handle is level-triggered: it stays
    /// signalled while the condition holds. After posting one event we wait
    /// on `shutdown` alone for this long before re-checking `notify`, so a
    /// sustained low-memory state fires at most once every 30 s.
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

    /// Per-VM watcher. Stored type-erased in `RareData.memory_pressure_watcher`.
    struct MemoryPressureWatcher {
        /// Signalled by the kernel while available memory is low.
        notify: HANDLE,
        /// Manual-reset event signalled by `uninstall` to wake the thread.
        shutdown: HANDLE,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Drop for MemoryPressureWatcher {
        fn drop(&mut self) {
            // SAFETY: handles were created by the kernel and are owned here;
            // the thread has been joined so nothing references them.
            unsafe {
                CloseHandle(self.shutdown);
                CloseHandle(self.notify);
            }
        }
    }

    fn slot(vm: &mut VirtualMachine) -> &mut Option<NonNull<c_void>> {
        vm.rare_data().memory_pressure_watcher_slot()
    }

    /// Blocks on `[shutdown, notify]` and posts a `MemoryPressureTask` to the
    /// JS event loop when `notify` fires. Handles are passed as usize since
    /// `HANDLE` (`*mut c_void`) is not `Send`.
    fn thread_main(vm_addr: usize, notify: usize, shutdown: usize) {
        bun_core::output::Source::configure_named_thread(bun_core::zstr!("MemoryPressure"));
        let handles: [HANDLE; 2] = [shutdown as HANDLE, notify as HANDLE];
        loop {
            // SAFETY: both handles are valid for the thread's lifetime
            // (`uninstall` joins before closing them).
            let rc = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, u32::MAX) };
            match rc {
                WAIT_OBJECT_0 => break,
                r if r == WAIT_OBJECT_0 + 1 => {
                    let task = ConcurrentTask::create(Task::new(
                        task_tag::MemoryPressureTask,
                        super::level::CRITICAL as usize as *mut (),
                    ));
                    // SAFETY: `vm_addr` is the main-thread VM captured at
                    // install; it lives for the process.
                    // `enqueue_task_concurrent` is the documented thread-safe
                    // entry point (lock-free MPSC push + loop wakeup).
                    unsafe { &*(vm_addr as *const VirtualMachine) }
                        .event_loop_shared()
                        .enqueue_task_concurrent(task);
                    // Holdoff on `shutdown` only: `notify` stays signalled
                    // while memory is low, so waiting on it again would spin.
                    // SAFETY: `shutdown` is valid for the thread's lifetime.
                    if unsafe { WaitForSingleObject(handles[0], HOLDOFF_MS) } == WAIT_OBJECT_0 {
                        break;
                    }
                }
                _ => break,
            }
        }
    }

    pub(super) fn install(global: &JSGlobalObject) {
        let vm = global.bun_vm_ptr();
        // SAFETY: same-thread VM access (asserted by `bun_vm_ptr`).
        if slot(unsafe { &mut *vm }).is_some() {
            return;
        }

        // SAFETY: Win32 calls; both return NULL on failure.
        let notify = unsafe { CreateMemoryResourceNotification(LOW_MEMORY_RESOURCE_NOTIFICATION) };
        if notify.is_null() {
            return;
        }
        // SAFETY: manual-reset, initially non-signalled, unnamed.
        let shutdown = unsafe { CreateEventW(ptr::null_mut(), 1, 0, ptr::null()) };
        if shutdown.is_null() {
            // SAFETY: `notify` is owned here.
            unsafe { CloseHandle(notify) };
            return;
        }

        let (vm_addr, notify_addr, shutdown_addr) =
            (vm as usize, notify as usize, shutdown as usize);
        let thread = match std::thread::Builder::new()
            .name("MemoryPressure".into())
            .stack_size(64 * 1024)
            .spawn(move || thread_main(vm_addr, notify_addr, shutdown_addr))
        {
            Ok(t) => t,
            Err(_) => {
                // SAFETY: both handles are owned here and were never shared.
                unsafe {
                    CloseHandle(shutdown);
                    CloseHandle(notify);
                }
                return;
            }
        };

        let watcher = bun_core::heap::into_raw(Box::new(MemoryPressureWatcher {
            notify,
            shutdown,
            thread: Some(thread),
        }));
        // SAFETY: same-thread VM access.
        *slot(unsafe { &mut *vm }) = NonNull::new(watcher.cast());
    }

    pub(super) fn uninstall(global: &JSGlobalObject) {
        let vm = global.bun_vm_ptr();
        // SAFETY: same-thread VM access.
        let Some(raw) = core::mem::take(slot(unsafe { &mut *vm })) else {
            return;
        };
        // SAFETY: slot was populated by `install` with a `Box<MemoryPressureWatcher>`.
        let mut watcher =
            unsafe { bun_core::heap::take(raw.as_ptr().cast::<MemoryPressureWatcher>()) };
        // SAFETY: `shutdown` is a valid manual-reset event owned by `watcher`.
        unsafe { SetEvent(watcher.shutdown) };
        if let Some(thread) = watcher.thread.take() {
            let _ = thread.join();
        }
        // Any `MemoryPressureTask` the thread enqueued before `join` carries
        // only the packed level (no pointer into `watcher`), so dropping
        // `watcher` here is safe regardless of queue state. `Drop` closes the
        // handles.
    }
}

// ────────────────────────────────────────────────────────────────────────────
// C-ABI exports for BunProcess.cpp
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

/// Synthetic emit for `bun:internal-for-testing`. Bypasses the OS backend and
/// drives the same C++ emit path a real notification would.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__MemoryPressure__emit(global: &JSGlobalObject, lvl: i32) {
    emit(global, lvl);
}

/// For `bun:internal-for-testing`: whether the per-VM watcher is currently
/// installed (i.e. the `RareData` slot is populated). Lets tests observe
/// arm/disarm without depending on a real OS notification.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__MemoryPressure__isInstalled(global: &JSGlobalObject) -> bool {
    let vm = global.bun_vm_ptr();
    // SAFETY: same-thread VM access (asserted by `bun_vm_ptr`).
    unsafe { &mut *vm }
        .rare_data()
        .memory_pressure_watcher_slot()
        .is_some()
}

#[cfg(not(windows))]
pub use posix::on_poll;
