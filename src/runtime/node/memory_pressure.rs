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
    unsafe { Process__emitMemoryPressureEvent(global as *const _ as *mut _, lvl) };
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

        let paths: [&bun_core::ZStr; 2] = [
            bun_core::zstr!("/proc/pressure/memory"),
            bun_core::zstr!("/sys/fs/cgroup/memory.pressure"),
        ];
        for path in paths {
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
            global: global as *const _ as *mut _,
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
    /// `WT_EXECUTEDEFAULT` — run the callback on a normal thread-pool thread,
    /// re-arm after each fire.
    const WT_EXECUTEDEFAULT: ULONG = 0;

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
        /// `uv_async_t` must come first so `async_.data` → `*mut Self` works in
        /// the close callback.
        async_: libuv::uv_async_t,
        global: *mut JSGlobalObject,
        /// Signalled by the kernel when available memory is low.
        notify: HANDLE,
        /// Thread-pool wait registration.
        wait: HANDLE,
        /// Set from the thread-pool callback; read on the JS thread.
        pending_level: AtomicI32,
    }

    fn slot(vm: &mut VirtualMachine) -> &mut Option<NonNull<c_void>> {
        vm.rare_data().memory_pressure_watcher_slot()
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
        let watcher = unsafe { &*(*handle).data.cast::<MemoryPressureWatcher>() };
        let lvl = watcher.pending_level.swap(0, Ordering::SeqCst);
        if lvl != 0 {
            // SAFETY: `global` is the live per-thread global captured at install.
            super::emit(unsafe { &*watcher.global }, lvl);
        }
    }

    extern "C" fn free_on_close(handle: *mut libuv::uv_handle_t) {
        // SAFETY: `handle` is the leading `uv_async_t` field of a heap-allocated
        // `MemoryPressureWatcher`; uv_close guarantees no further use.
        drop(unsafe { bun_core::heap::take(handle.cast::<MemoryPressureWatcher>()) });
    }

    pub(super) fn install(global: &JSGlobalObject) {
        let vm = global.bun_vm_ptr();
        // SAFETY: same-thread VM access.
        let vm_ref = unsafe { &mut *vm };
        if slot(vm_ref).is_some() {
            return;
        }

        // SAFETY: the allocation is fully written by uv_async_init + field stores below.
        let watcher: *mut MemoryPressureWatcher =
            bun_core::heap::into_raw(Box::<MemoryPressureWatcher>::new_uninit()).cast();

        // SAFETY: `watcher.async_` is a valid `uv_async_t`-sized slot; `uv_loop`
        // is the VM's live libuv loop.
        let rc = unsafe {
            libuv::uv_async_init(
                global.bun_vm().uv_loop(),
                ptr::addr_of_mut!((*watcher).async_),
                Some(on_async),
            )
        };
        if rc != 0 {
            // SAFETY: never handed out; just free the raw allocation.
            drop(unsafe { bun_core::heap::take(watcher) });
            return;
        }
        // SAFETY: `async_` is an initialized, active handle.
        unsafe { libuv::uv_unref(ptr::addr_of_mut!((*watcher).async_).cast()) };

        // SAFETY: `watcher` is a freshly allocated, uv-initialised struct.
        unsafe {
            (*watcher).async_.data = watcher.cast();
            (*watcher).global = global as *const _ as *mut _;
            (*watcher).notify = ptr::null_mut();
            (*watcher).wait = ptr::null_mut();
            ptr::addr_of_mut!((*watcher).pending_level).write(AtomicI32::new(0));
        }

        // SAFETY: Win32 call; returns NULL on failure.
        let notify = unsafe { CreateMemoryResourceNotification(LOW_MEMORY_RESOURCE_NOTIFICATION) };
        if !notify.is_null() {
            let mut wait: HANDLE = ptr::null_mut();
            // SAFETY: `notify` is a valid notification handle; `watcher`
            // outlives the wait (guaranteed by the blocking `UnregisterWaitEx`
            // in `uninstall`).
            let ok = unsafe {
                RegisterWaitForSingleObject(
                    &mut wait,
                    notify,
                    wait_callback,
                    watcher.cast(),
                    u32::MAX,
                    WT_EXECUTEDEFAULT,
                )
            };
            if ok != 0 {
                // SAFETY: sole owner of `watcher`.
                unsafe {
                    (*watcher).notify = notify;
                    (*watcher).wait = wait;
                }
            } else {
                // SAFETY: `notify` owned here; never registered.
                unsafe { CloseHandle(notify) };
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
            if !(*watcher).wait.is_null() {
                // `INVALID_HANDLE_VALUE` blocks until any in-flight callback returns,
                // so `watcher` is guaranteed unreferenced by the thread pool after this.
                UnregisterWaitEx((*watcher).wait, INVALID_HANDLE_VALUE);
            }
            if !(*watcher).notify.is_null() {
                CloseHandle((*watcher).notify);
            }
            libuv::uv_close(
                ptr::addr_of_mut!((*watcher).async_).cast(),
                Some(free_on_close),
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

#[cfg(not(windows))]
pub use posix::on_poll;
