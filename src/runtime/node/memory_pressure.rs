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
//!   - Windows: `CreateMemoryResourceNotification(LowMemoryResourceNotification)`
//!     waited on a thread-pool thread via `RegisterWaitForSingleObject`; the
//!     callback posts back to the JS thread through a `uv_async_t`.
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
            return bun_core::fmt::buf_print_z(
                buf,
                format_args!(
                    "/sys/fs/cgroup/{}{}memory.pressure",
                    rest.escape_ascii(),
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
    pub fn on_poll(owner_ptr: *mut core::ffi::c_void, fflags: i64) {
        // SAFETY: `owner_ptr` was set via `Owner::new(MEMORY_PRESSURE, watcher)` in `install`.
        let watcher = unsafe { &*owner_ptr.cast::<MemoryPressureWatcher>() };
        // SAFETY: `global` is the live per-thread global captured at install time.
        let global = unsafe { &*watcher.global };
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
// Windows backend: CreateMemoryResourceNotification + RegisterWaitForSingleObject
// ────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod windows {
    use core::ffi::c_void;
    use core::mem::MaybeUninit;
    use core::ptr::{self, NonNull};
    use core::sync::atomic::{AtomicI32, Ordering};

    use bun_jsc::JSGlobalObject;
    use bun_jsc::virtual_machine::VirtualMachine;
    use bun_sys::windows::libuv;

    type HANDLE = *mut c_void;
    type BOOL = i32;
    type ULONG = u32;
    const INVALID_HANDLE_VALUE: HANDLE = usize::MAX as HANDLE;
    /// `LowMemoryResourceNotification` enum value.
    const LOW_MEMORY_RESOURCE_NOTIFICATION: i32 = 0;
    /// The notification handle is level-triggered: it stays signalled for as
    /// long as memory is low. A recurring wait would spin the thread pool, so
    /// each registration fires once and the JS thread re-arms after a holdoff.
    const WT_EXECUTEONLYONCE: ULONG = 0x00000008;
    /// Minimum gap between re-arming the wait, to avoid firing on every loop
    /// tick while the low-memory condition persists.
    const HOLDOFF_MS: u64 = 30_000;

    unsafe extern "system" {
        fn CreateMemoryResourceNotification(kind: i32) -> HANDLE;
        fn RegisterWaitForSingleObject(
            out_wait: *mut HANDLE,
            handle: HANDLE,
            callback: unsafe extern "system" fn(ctx: *mut c_void, timed_out: u8),
            ctx: *mut c_void,
            millis: ULONG,
            flags: ULONG,
        ) -> BOOL;
        fn UnregisterWaitEx(wait: HANDLE, completion_event: HANDLE) -> BOOL;
        fn CloseHandle(h: HANDLE) -> BOOL;
    }

    #[repr(C)]
    struct MemoryPressureWatcher {
        /// Must come first so the `uv_close` callback can recover `*mut Self`.
        async_: libuv::uv_async_t,
        /// Holdoff before re-arming the wait after a fire.
        holdoff: libuv::uv_timer_t,
        global: *mut JSGlobalObject,
        /// Signalled by the kernel when available memory is low.
        notify: HANDLE,
        /// Thread-pool wait registration. Only ever written on the JS thread;
        /// read on the thread-pool thread only while the wait it names is
        /// armed. Null between fires while the holdoff timer is pending.
        wait: HANDLE,
        /// Set from the thread-pool callback; read on the JS thread.
        pending_level: AtomicI32,
    }

    fn slot(vm: &mut VirtualMachine) -> &mut Option<NonNull<c_void>> {
        vm.rare_data().memory_pressure_watcher_slot()
    }

    /// Arm a one-shot thread-pool wait on `notify`. JS thread only.
    ///
    /// SAFETY: `watcher` is live and `(*watcher).notify` is a valid handle.
    unsafe fn arm_wait(watcher: *mut MemoryPressureWatcher) {
        let mut wait: HANDLE = ptr::null_mut();
        // SAFETY: `watcher` outlives the wait (uninstall blocks on
        // `UnregisterWaitEx(.., INVALID_HANDLE_VALUE)` before freeing).
        let ok = unsafe {
            RegisterWaitForSingleObject(
                &mut wait,
                (*watcher).notify,
                wait_callback,
                watcher.cast(),
                u32::MAX,
                WT_EXECUTEONLYONCE,
            )
        };
        // SAFETY: sole writer of `wait` on the JS thread.
        unsafe { (*watcher).wait = if ok != 0 { wait } else { ptr::null_mut() } };
    }

    /// Runs on a Windows thread-pool thread. May only touch `pending_level`
    /// and `uv_async_send` (which is documented thread-safe).
    unsafe extern "system" fn wait_callback(ctx: *mut c_void, _timed_out: u8) {
        // SAFETY: `ctx` is the watcher pointer passed at registration; the
        // wait is unregistered with `INVALID_HANDLE_VALUE` before we free it,
        // so it outlives every callback.
        let watcher = unsafe { &*ctx.cast::<MemoryPressureWatcher>() };
        watcher
            .pending_level
            .store(super::level::CRITICAL, Ordering::SeqCst);
        // SAFETY: `async_` was uv_async_init'd on the JS loop; uv_async_send is thread-safe.
        let _ = unsafe { libuv::uv_async_send(ptr::from_ref(&watcher.async_).cast_mut()) };
    }

    /// Runs on the JS thread.
    unsafe extern "C" fn on_async(handle: *mut libuv::uv_async_t) {
        // SAFETY: `data` was set to the watcher in `install`.
        let watcher = unsafe { (*handle).data.cast::<MemoryPressureWatcher>() };
        // SAFETY: `watcher` is live; JS thread.
        let lvl = unsafe { (*watcher).pending_level.swap(0, Ordering::SeqCst) };
        if lvl == 0 {
            return;
        }
        // SAFETY: `global` is the live per-thread global captured at install.
        super::emit(unsafe { &*(*watcher).global }, lvl);

        // The one-shot wait has fired; release its handle and start the
        // holdoff before re-arming. The `WT_EXECUTEONLYONCE` callback has
        // already returned (it posted the async that woke us), so a
        // blocking unregister here does not deadlock.
        // SAFETY: JS thread; `watcher` is live.
        unsafe {
            let wait = core::mem::replace(&mut (*watcher).wait, ptr::null_mut());
            if !wait.is_null() {
                UnregisterWaitEx(wait, INVALID_HANDLE_VALUE);
            }
            if !(*watcher).notify.is_null() {
                let _ = libuv::uv_timer_start(
                    ptr::addr_of_mut!((*watcher).holdoff),
                    Some(on_holdoff),
                    HOLDOFF_MS,
                    0,
                );
            }
        }
    }

    /// Runs on the JS thread when the holdoff timer expires.
    unsafe extern "C" fn on_holdoff(handle: *mut libuv::uv_timer_t) {
        // SAFETY: `data` was set to the watcher in `install`.
        let watcher = unsafe { (*handle).data.cast::<MemoryPressureWatcher>() };
        // SAFETY: JS thread; `watcher` is live; `notify` is valid (checked before the
        // timer was started).
        unsafe { arm_wait(watcher) };
    }

    extern "C" fn on_async_closed(handle: *mut libuv::uv_handle_t) {
        // SAFETY: `handle` is the leading `uv_async_t` field of a heap-allocated
        // `MemoryPressureWatcher`; the timer is the only other uv handle and is
        // closed next, with the final free in its close callback.
        let watcher = handle.cast::<MemoryPressureWatcher>();
        // SAFETY: `watcher` is live until `on_holdoff_closed` frees it.
        unsafe {
            libuv::uv_close(
                ptr::addr_of_mut!((*watcher).holdoff).cast(),
                Some(on_holdoff_closed),
            )
        };
    }

    extern "C" fn on_holdoff_closed(handle: *mut libuv::uv_handle_t) {
        // SAFETY: `data` is the watcher pointer; both uv handles are now
        // fully closed, so the allocation is unreferenced.
        unsafe { bun_core::heap::destroy((*handle).data.cast::<MemoryPressureWatcher>()) };
    }

    pub(super) fn install(global: &JSGlobalObject) {
        let vm = global.bun_vm_ptr();
        // SAFETY: same-thread VM access.
        let vm_ref = unsafe { &mut *vm };
        if slot(vm_ref).is_some() {
            return;
        }

        let uv_loop = global.bun_vm().uv_loop();
        let uninit: *mut MaybeUninit<MemoryPressureWatcher> =
            bun_core::heap::into_raw(Box::<MemoryPressureWatcher>::new_uninit());
        let watcher: *mut MemoryPressureWatcher = uninit.cast();

        // SAFETY: `watcher.async_` is a valid `uv_async_t`-sized slot; `uv_loop`
        // is the VM's live libuv loop.
        let rc = unsafe {
            libuv::uv_async_init(uv_loop, ptr::addr_of_mut!((*watcher).async_), Some(on_async))
        };
        if rc != 0 {
            // SAFETY: allocation is still `MaybeUninit`; never handed out.
            drop(unsafe { bun_core::heap::take(uninit) });
            return;
        }
        // SAFETY: `holdoff` is a valid `uv_timer_t`-sized slot; uv_timer_init
        // cannot fail on a live loop. Remaining fields are plain POD.
        unsafe {
            let _ = libuv::uv_timer_init(uv_loop, ptr::addr_of_mut!((*watcher).holdoff));
            libuv::uv_unref(ptr::addr_of_mut!((*watcher).async_).cast());
            libuv::uv_unref(ptr::addr_of_mut!((*watcher).holdoff).cast());
            (*watcher).async_.data = watcher.cast();
            (*watcher).holdoff.data = watcher.cast();
            (*watcher).global = ptr::from_ref(global).cast_mut();
            (*watcher).notify = ptr::null_mut();
            (*watcher).wait = ptr::null_mut();
            ptr::addr_of_mut!((*watcher).pending_level).write(AtomicI32::new(0));
        }

        // SAFETY: Win32 call; returns NULL on failure.
        let notify = unsafe { CreateMemoryResourceNotification(LOW_MEMORY_RESOURCE_NOTIFICATION) };
        if !notify.is_null() {
            // SAFETY: sole owner of `watcher`; `notify` is valid.
            unsafe {
                (*watcher).notify = notify;
                arm_wait(watcher);
            }
        }

        // SAFETY: same-thread VM access.
        *slot(unsafe { &mut *vm }) = NonNull::new(watcher.cast());
    }

    pub(super) fn uninstall(global: &JSGlobalObject) {
        let vm = global.bun_vm_ptr();
        // SAFETY: same-thread VM access.
        let Some(raw) = core::mem::take(slot(unsafe { &mut *vm })) else {
            return;
        };
        let watcher = raw.as_ptr().cast::<MemoryPressureWatcher>();

        // SAFETY: `watcher` is the live allocation from `install`.
        unsafe {
            let _ = libuv::uv_timer_stop(ptr::addr_of_mut!((*watcher).holdoff));
            if !(*watcher).wait.is_null() {
                // `INVALID_HANDLE_VALUE` blocks until any in-flight callback
                // returns, so `watcher` is guaranteed unreferenced by the
                // thread pool afterwards. The handle came from a successful
                // `RegisterWaitForSingleObject`, so this cannot fail with
                // `ERROR_INVALID_HANDLE`.
                UnregisterWaitEx((*watcher).wait, INVALID_HANDLE_VALUE);
                (*watcher).wait = ptr::null_mut();
            }
            if !(*watcher).notify.is_null() {
                CloseHandle((*watcher).notify);
                (*watcher).notify = ptr::null_mut();
            }
            // Close async → its callback closes holdoff → that callback frees.
            libuv::uv_close(
                ptr::addr_of_mut!((*watcher).async_).cast(),
                Some(on_async_closed),
            );
        }
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
