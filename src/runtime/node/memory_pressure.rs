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

use bun_event_loop::ConcurrentTask::task_tag;
use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

/// Pressure level passed to JS. Values are the `NOTE_MEMORYSTATUS_PRESSURE_*`
/// bits on macOS so the kqueue dispatch can pass `fflags` through unchanged.
pub(crate) mod level {
    pub(crate) const WARNING: i32 = 0x00000002;
    pub(crate) const CRITICAL: i32 = 0x00000004;
}

unsafe extern "C" {
    safe fn Process__emitMemoryPressureEvent(global: &JSGlobalObject, level: i32);
}

/// `run_task` target for `task_tag::MemoryPressureTask`. `lvl` is the packed
/// task payload (macOS kevent `fflags`, or `level::CRITICAL` elsewhere).
pub(crate) fn emit(global: &JSGlobalObject, lvl: i32) {
    // macOS can deliver WARN|CRITICAL together under EV_CLEAR; pick the more severe.
    let lvl = if lvl & level::CRITICAL != 0 || lvl & level::WARNING == 0 {
        level::CRITICAL
    } else {
        level::WARNING
    };
    Process__emitMemoryPressureEvent(global, lvl);
}

/// The queued form of a pressure notification: `Task::ptr` packs the level,
/// there is no allocation.
pub(crate) struct MemoryPressureTask;
impl bun_event_loop::Taskable for MemoryPressureTask {
    const TAG: bun_event_loop::TaskTag = task_tag::MemoryPressureTask;
    /// Nothing is owned (`this` is the packed level).
    unsafe fn release_unrun(_: *mut Self) {}
    /// The process's memory pressure: listeners of the realm.
    unsafe fn context(_: *const Self) -> bun_event_loop::ContextId {
        bun_event_loop::ContextId::NONE
    }
}

fn pressure_task(lvl: i32) -> *mut MemoryPressureTask {
    lvl as usize as *mut MemoryPressureTask
}

#[cfg(not(windows))]
pub(crate) type WatcherSlot = bun_jsc::JsCell<Option<posix::MemoryPressureWatcher>>;
#[cfg(windows)]
pub(crate) type WatcherSlot = bun_jsc::JsCell<Option<windows::MemoryPressureWatcher>>;

fn slot(vm: &VirtualMachine) -> &WatcherSlot {
    &crate::jsc_hooks::runtime_state_of(vm).memory_pressure_watcher
}

// ────────────────────────────────────────────────────────────────────────────
// POSIX backend (macOS EVFILT_MEMORYSTATUS, Linux PSI) via FilePoll
// ────────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
mod posix {
    use bun_io::OwnedFilePoll;
    use bun_io::posix_event_loop::FlagsSet;
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
    use bun_io::posix_event_loop::{Flags, Owner, PollTag};
    use bun_jsc::JSGlobalObject;
    use bun_jsc::virtual_machine::VirtualMachine;

    use super::slot;

    /// `poll` is `None` without an OS backend: `isInstalled` still reflects listener presence.
    #[derive(Default)]
    pub(crate) struct MemoryPressureWatcher {
        poll: Option<OwnedFilePoll>,
        /// After `poll`, which watches it.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        psi: Option<bun_sys::CloseOnDrop>,
        /// PSI `some total=` at arm time, then at the last emitted event.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        psi_some_total: u64,
    }

    /// Build `/sys/fs/cgroup/<current>/memory.pressure` from the cgroup v2
    /// entry in `/proc/self/cgroup`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn own_cgroup_pressure_path(buf: &mut [u8]) -> Option<&bun_core::ZStr> {
        use bun_sys::O;
        let file = bun_sys::open(bun_core::zstr!("/proc/self/cgroup"), O::RDONLY, 0)
            .map(bun_sys::CloseOnDrop::new)
            .ok()?;
        let mut read = [0u8; 256];
        let n = file.read(&mut read).unwrap_or(0);
        for line in bun_core::strings::split(&read[..n], b"\n") {
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

    /// 150 ms of "some"-stall in any 2 s window. 2 s is the minimum
    /// window for unprivileged PSI triggers (kernel 6.6+).
    ///
    /// The trailing NUL is part of the write: `psi_write()` in
    /// `kernel/sched/psi.c` replaces the last byte it receives with NUL
    /// before it parses the buffer. Without it the kernel sees
    /// `some 150000 200000` and rejects the 200 ms window with `EINVAL`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) const PSI_TRIGGER: &[u8] = b"some 150000 2000000\0";

    /// The threshold in `PSI_TRIGGER`, in microseconds.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    const PSI_THRESHOLD_US: u64 = 150_000;

    /// The `some total=` field of a PSI file, in microseconds.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) fn parse_psi_some_total(contents: &[u8]) -> Option<u64> {
        use bun_core::strings;
        let line = strings::split(contents, b"\n").find_map(|line| line.strip_prefix(b"some "))?;
        let digits = &line[strings::index_of(line, b"total=")? + "total=".len()..];
        let end = digits.iter().take_while(|b| b.is_ascii_digit()).count();
        core::str::from_utf8(&digits[..end]).ok()?.parse().ok()
    }

    /// `pread` at offset 0 rewinds the seq_file, so the trigger fd is reusable.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn read_psi_file<'b>(file: &bun_sys::File, buf: &'b mut [u8; 256]) -> Option<&'b [u8]> {
        let n = bun_sys::pread(file.fd(), buf, 0).ok()?;
        Some(&buf[..n])
    }

    /// Whether a `POLLPRI` reports real pressure, not the false event of #42783.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) fn psi_growth_reached_threshold(last_total: &mut u64, contents: &[u8]) -> bool {
        let Some(total) = parse_psi_some_total(contents) else {
            return true;
        };
        if total.saturating_sub(*last_total) < PSI_THRESHOLD_US {
            return false;
        }
        *last_total = total;
        true
    }

    /// Open a PSI memory file and write a trigger. Tries the system-wide
    /// `/proc/pressure/memory` first, then the current cgroup's file.
    /// Returns `some total=` as read before the write.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn open_psi_file() -> Option<(bun_sys::CloseOnDrop, u64)> {
        use bun_sys::O;

        let mut cgroup_buf = [0u8; 320];
        let paths = [
            Some(bun_core::zstr!("/proc/pressure/memory")),
            own_cgroup_pressure_path(&mut cgroup_buf),
        ];
        for path in paths.into_iter().flatten() {
            let Ok(fd) = bun_sys::open(path, O::RDWR | O::NONBLOCK | O::CLOEXEC, 0) else {
                continue;
            };
            let file = bun_sys::CloseOnDrop::new(fd);
            let mut buf = [0u8; 256];
            let some_total = read_psi_file(&file, &mut buf)
                .and_then(parse_psi_some_total)
                .unwrap_or(0);
            if bun_sys::write(file.fd(), PSI_TRIGGER).is_ok() {
                return Some((file, some_total));
            }
        }
        None
    }

    fn register_os_watch(global: &JSGlobalObject) -> Option<MemoryPressureWatcher> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let (psi, psi_some_total) = open_psi_file()?;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let fd = psi.fd();
        #[cfg(target_os = "macos")]
        let fd = bun_sys::Fd::from_native(0);
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
        {
            let _ = global;
            return None;
        }
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "macos"))]
        {
            let owner = Owner::new(PollTag::MemoryPressure, core::ptr::null_mut());
            // SAFETY: this tag has no pointee.
            let poll = unsafe { OwnedFilePoll::new(global.bun_vm().loop_ctx(), fd, owner) };
            poll.register(Flags::MemoryPressure, false).ok()?;
            Some(MemoryPressureWatcher {
                poll: Some(poll),
                #[cfg(any(target_os = "linux", target_os = "android"))]
                psi: Some(psi),
                #[cfg(any(target_os = "linux", target_os = "android"))]
                psi_some_total,
            })
        }
    }

    pub(super) fn install(global: &JSGlobalObject) {
        let vm = global.bun_vm();
        if slot(vm).get().is_some() {
            return;
        }
        slot(vm).set(Some(register_os_watch(global).unwrap_or_default()));
    }

    /// Whether the installed watcher holds a live OS source. `install` still
    /// fills the slot when no backend could be registered, so `isInstalled`
    /// alone cannot tell the two apart.
    pub(super) fn has_os_backend(global: &JSGlobalObject) -> bool {
        let watcher = slot(global.bun_vm()).get().as_ref();
        watcher.is_some_and(|watcher| watcher.poll.is_some())
    }

    pub(super) fn uninstall(global: &JSGlobalObject) {
        slot(global.bun_vm()).set(None);
    }

    /// `__bun_run_io` dispatch target. `fflags` is the kqueue `fflags`
    /// on macOS (carrying the pressure level) and 0 on Linux.
    pub(crate) fn on_poll(flags: FlagsSet, fflags: i64) {
        let vm = VirtualMachine::get();

        // `EPOLLERR`/`EPOLLHUP` on a PSI fd means the trigger is dead (e.g.
        // the cgroup was removed). kernfs reports that permanently, so tear
        // the watch down instead of emitting to avoid a level-triggered spin.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if flags.contains(Flags::Eof) || flags.contains(Flags::Hup) {
            slot(vm).set(None);
            return;
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        if !slot(vm).with_mut(|watcher| {
            let Some(MemoryPressureWatcher {
                psi: Some(psi),
                psi_some_total,
                ..
            }) = watcher
            else {
                return false;
            };
            let mut buf = [0u8; 256];
            read_psi_file(psi, &mut buf)
                .is_none_or(|contents| psi_growth_reached_threshold(psi_some_total, contents))
        }) {
            return;
        }

        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        let _ = flags;
        #[cfg(target_os = "macos")]
        let lvl = fflags as i32;
        #[cfg(not(target_os = "macos"))]
        let lvl = {
            let _ = fflags;
            super::level::CRITICAL
        };
        vm.enqueue_task(bun_event_loop::Task::init(super::pressure_task(lvl)));
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Windows backend: CreateMemoryResourceNotification on a dedicated thread
// ────────────────────────────────────────────────────────────────────────────

#[cfg(windows)]
mod windows {
    use core::ffi::c_void;

    use bun_jsc::JSGlobalObject;
    use std::os::windows::io::{AsRawHandle as _, HandleOrNull, OwnedHandle};

    use super::slot;

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
        safe fn CreateMemoryResourceNotification(kind: i32) -> HANDLE;
        /// A bad handle yields `FALSE`.
        safe fn SetEvent(h: HANDLE) -> BOOL;
        /// A bad handle yields `WAIT_FAILED`.
        safe fn WaitForSingleObject(h: HANDLE, ms: DWORD) -> DWORD;
        fn WaitForMultipleObjects(n: DWORD, h: *const HANDLE, wait_all: BOOL, ms: DWORD) -> DWORD;
    }

    pub(crate) struct MemoryPressureWatcher {
        shutdown: OwnedHandle,
        thread: Option<std::thread::JoinHandle<()>>,
    }

    impl Drop for MemoryPressureWatcher {
        fn drop(&mut self) {
            SetEvent(self.shutdown.as_raw_handle());
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    fn thread_main(vm: bun_jsc::VmHandle, notify: &OwnedHandle, shutdown: usize) {
        bun_core::output::Source::configure_named_thread(bun_core::zstr!("MemoryPressure"));
        let handles: [HANDLE; 2] = [shutdown as HANDLE, notify.as_raw_handle()];
        loop {
            // SAFETY: the watcher joins before it closes `shutdown`.
            let rc = unsafe { WaitForMultipleObjects(2, handles.as_ptr(), 0, u32::MAX) };
            if rc != WAIT_OBJECT_0 + 1 {
                break;
            }
            let task = super::pressure_task(super::level::CRITICAL);
            if let bun_jsc::vm_handle::Posted::Refused(_) =
                vm.post(bun_jsc::LoopKind::Regular, task)
            {
                // VM torn down: drop the notification.
                break;
            }
            if WaitForSingleObject(handles[0], HOLDOFF_MS) == WAIT_OBJECT_0 {
                break;
            }
        }
    }

    pub(super) fn install(global: &JSGlobalObject) {
        let vm = global.bun_vm();
        if slot(vm).get().is_some() {
            return;
        }

        let notify = CreateMemoryResourceNotification(LOW_MEMORY_RESOURCE_NOTIFICATION);
        // SAFETY: a new handle, or null.
        let Ok(notify) = OwnedHandle::try_from(unsafe { HandleOrNull::from_raw_handle(notify) })
        else {
            return;
        };
        let Ok(shutdown) = bun_sys::windows::CreateEventW() else {
            return;
        };

        let (vm, s) = (global.bun_vm().handle(), shutdown.as_raw_handle() as usize);
        let Ok(thread) = std::thread::Builder::new()
            .name("MemoryPressure".into())
            .stack_size(64 * 1024)
            .spawn(move || thread_main(vm, &notify, s))
        else {
            return;
        };

        slot(global.bun_vm()).set(Some(MemoryPressureWatcher {
            shutdown,
            thread: Some(thread),
        }));
    }

    pub(super) fn uninstall(global: &JSGlobalObject) {
        slot(global.bun_vm()).set(None);
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
    slot(global.bun_vm()).get().is_some()
}

// ────────────────────────────────────────────────────────────────────────────
// bun:internal-for-testing hooks
// ────────────────────────────────────────────────────────────────────────────

/// `memoryPressurePsiTrigger()`: the bytes `open_psi_file` writes, as a
/// `Buffer`. `null` where there is no PSI backend.
pub(crate) fn psi_trigger<'a>(
    heap: &JsHeap<'a>,
) -> bindgen::Result<'a, Option<JsLocal<'a, BufferSource>>> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        heap.create_buffer(posix::PSI_TRIGGER).map(Some)
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = heap;
        Ok(None)
    }
}

/// `memoryPressurePsiFilter(armed, ...polls)`: one `bool` per poll, `null` off Linux.
pub(crate) fn psi_filter<'a>(
    cx: &mut JsScope<'a>,
    armed: &[u8],
    polls: &'a [JsLocal<'a>],
) -> JsResult<JSValue> {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let global = cx.global();
        let mut last_total = posix::parse_psi_some_total(armed).unwrap_or(0);
        JSValue::create_array_from_iter(global, polls.iter(), |contents| {
            let contents = contents.to_js().to_utf8(global)?;
            Ok(JSValue::js_boolean(posix::psi_growth_reached_threshold(
                &mut last_total,
                &contents,
            )))
        })
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = (cx, armed, polls);
        Ok(JSValue::NULL)
    }
}

/// `memoryPressureWatcherHasOsBackend()`: whether the watcher installed by
/// the current listeners registered an OS source. On Windows `install` either
/// starts the thread or leaves the slot empty, so this equals `isInstalled`.
pub(crate) fn watcher_has_os_backend(heap: &JsHeap<'_>) -> bool {
    // SAFETY: reads the watcher's slot in the VM.
    let global = unsafe { heap.global() };
    #[cfg(not(windows))]
    {
        posix::has_os_backend(global)
    }
    #[cfg(windows)]
    {
        Bun__MemoryPressure__isInstalled(global)
    }
}

#[cfg(not(windows))]
pub(crate) use posix::on_poll;
