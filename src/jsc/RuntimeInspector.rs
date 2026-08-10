//! Runtime Inspector Activation (SIGUSR1 / `process._debugProcess`)
//!
//! Activates the inspector at runtime, matching Node.js behaviour where
//! `kill -USR1 <pid>` attaches a debugger to a running process.
//!
//! POSIX: a dedicated `SignalInspector` thread sleeps on an async-signal-safe
//! semaphore; the SIGUSR1 handler only posts to it. The woken thread sets a
//! flag, fires `notifyNeedDebuggerBreak` on the main VM (thread-safe; sets a
//! trap bit and starts JSC's SignalSender), and wakes the event loop for the
//! idle case. `VMTraps::handleTraps(NeedDebuggerBreak)` then invokes the
//! per-VM callback registered in `BunDebugger.cpp`, which activates the
//! inspector and (when a frontend has asked for a pause) enters
//! `Debugger::breakProgram()`.
//!
//! Windows: a named file mapping `bun-debug-handler-<pid>` holds a function
//! pointer that an external tool invokes via `CreateRemoteThread`, exactly as
//! Node.js does.

use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};

use crate::debugger::{Debugger, Mode, Wait};
use crate::{VM, VirtualMachineRef as VirtualMachine};

bun_core::declare_scope!(RuntimeInspector, hidden);

/// Default port for runtime-activated inspector. Overridden by `--inspect-port`.
const DEFAULT_INSPECTOR_PORT: &[u8] = b"6499";

/// Set once by [`install_if_not_already`] when this process is eligible for
/// runtime activation (not `--disable-sigusr1`, not already `--inspect`ing,
/// GC does not own SIGUSR1). Never cleared; a user SIGUSR1 listener only
/// changes the signal disposition, see [`reinstall_after_user_handler`].
static ARMED: AtomicBool = AtomicBool::new(false);
static ACTIVATION_REQUESTED: AtomicBool = AtomicBool::new(false);

/// The main thread's `JSC::VM*`, published by [`on_main_vm_ready`] once
/// `VirtualMachine::init` has written it, with the trap callback already
/// installed. The SignalInspector thread reads this (Acquire) instead of
/// the plain `VirtualMachine::jsc_vm` field so the cross-thread read is
/// properly ordered against the main thread's write.
static MAIN_JSC_VM: AtomicPtr<VM> = AtomicPtr::new(core::ptr::null_mut());

unsafe extern "C" {
    fn Bun__installDebuggerTrapCallback(vm: *mut VM);
    fn Bun__activateRuntimeInspectorMode();
    #[cfg(unix)]
    fn Bun__gcSuspendResumeSignal() -> core::ffi::c_int;
}

/// Main thread, from `VirtualMachine::init` after `jsc_vm` is set. Installs
/// the per-VM trap callback and publishes the VM for the signal thread.
///
/// # Safety
/// `jsc_vm` is the main thread's live `JSC::VM`, which outlives the process
/// (the main VM is never destroyed before exit).
pub unsafe fn on_main_vm_ready(jsc_vm: *mut VM) {
    if !ARMED.load(Ordering::Acquire) || jsc_vm.is_null() {
        return;
    }
    // SAFETY: per fn contract.
    unsafe { Bun__installDebuggerTrapCallback(jsc_vm) };
    MAIN_JSC_VM.store(jsc_vm, Ordering::Release);
}

/// Called from the SignalInspector thread (POSIX) or remote thread (Windows).
/// Runs in normal thread context, so calling thread-safe JSC APIs is fine.
fn request_inspector_activation() {
    ACTIVATION_REQUESTED.store(true, Ordering::Release);

    // Busy-loop path: fire the trap. `notifyNeedDebuggerBreak` is
    // CONCURRENT_SAFE. Null only if the signal raced `VirtualMachine::init`;
    // the event-loop wakeup below still activates in that case.
    let jsc_vm = MAIN_JSC_VM.load(Ordering::Acquire);
    if !jsc_vm.is_null() {
        VM::opaque_ref(jsc_vm).notify_need_debugger_break();
    }

    // Idle path: the JS thread is parked in epoll/kqueue and no trap check
    // runs until it wakes, so kick the loop; `check_and_activate_inspector`
    // picks the request up on the next tick.
    if let Some(vm) = VirtualMachine::get_main_thread_vm() {
        // SAFETY: main VM pointer is valid for process lifetime and
        // `EventLoop::wakeup` is safe to call from any thread.
        unsafe { (*(*vm).event_loop()).wakeup() };
    }
}

/// True on platforms where JSC's GC thread-suspend/resume handler owns
/// SIGUSR1 (e.g. FreeBSD); installing our handler there would hang GC.
pub fn gc_owns_sigusr1() -> bool {
    #[cfg(unix)]
    {
        // SAFETY: pure read of g_wtfConfig.
        return unsafe { Bun__gcSuspendResumeSignal() } == libc::SIGUSR1;
    }
    #[allow(unreachable_code)]
    false
}

/// Called on the main thread from the event loop tick. Handles the idle-VM
/// case where the JS thread is blocked in epoll/kqueue and the trap never
/// fires.
#[inline]
pub fn check_and_activate_inspector() {
    // Hot path: one relaxed load of a flag that only the SignalInspector
    // thread ever writes, so no cacheline bouncing in the common case.
    if !ACTIVATION_REQUESTED.load(Ordering::Relaxed) {
        return;
    }
    if !ACTIVATION_REQUESTED.swap(false, Ordering::AcqRel) {
        return;
    }
    if try_activate_inspector() {
        // The trap callback itself was installed in `on_main_vm_ready`; this
        // just flips BunDebugger.cpp into trap-assisted CDP delivery, same as
        // the trap path does after `Bun__tryActivateInspector`.
        // SAFETY: pure C++ atomic store.
        unsafe { Bun__activateRuntimeInspectorMode() };
    }
}

/// Main thread only (event-loop tick or the trap callback). Starts the
/// inspector unless one is already configured or the VM is going away.
fn try_activate_inspector() -> bool {
    // Short-lived `&` only: `start_at_runtime` re-enters the VM through the
    // thread-local accessor.
    let vm: &VirtualMachine = VirtualMachine::get();
    if vm.is_shutting_down || !crate::debugger::can_start_at_runtime() {
        bun_core::scoped_log!(RuntimeInspector, "ignoring activation request");
        return false;
    }
    bun_core::scoped_log!(RuntimeInspector, "activating");
    let port = vm.inspect_port.unwrap_or(DEFAULT_INSPECTOR_PORT);
    let started = crate::debugger::start_at_runtime(Debugger {
        path_or_port: Some(port),
        wait_for_connection: Wait::Off,
        mode: Mode::Listen,
        ..Default::default()
    });
    if !started {
        bun_core::pretty_errorln!("<red>error<r>: failed to start the inspector");
        bun_core::output::flush();
    }
    started
}

/// Arm runtime activation: start the platform delivery mechanism and (POSIX)
/// point SIGUSR1 at it. Idempotent. Must run before `on_main_vm_ready`.
pub fn install_if_not_already() {
    if ARMED.swap(true, Ordering::AcqRel) {
        return;
    }
    if !platform::install() {
        ARMED.store(false, Ordering::Release);
    }
}

/// The last user `process.on("SIGUSR1")` listener was removed. While it was
/// registered, BunProcess.cpp had pointed the signal at its own forwarder;
/// nothing on our side was torn down (the SignalInspector thread stayed
/// parked on its semaphore), so handing the signal back is just re-applying
/// the sigaction. No-op unless this process was armed at startup.
pub fn reinstall_after_user_handler() {
    if !ARMED.load(Ordering::Acquire) {
        return;
    }
    #[cfg(unix)]
    platform::install_sigaction();
}

/// Reset SIGUSR1 to default action for `--disable-sigusr1`.
pub fn set_default_sigusr1_action() {
    #[cfg(unix)]
    // SAFETY: `sigaction` with `SIG_DFL` is always valid.
    unsafe {
        let mut act: libc::sigaction = bun_core::ffi::zeroed();
        act.sa_sigaction = libc::SIG_DFL;
        libc::sigemptyset(&raw mut act.sa_mask);
        libc::sigaction(libc::SIGUSR1, &raw const act, core::ptr::null_mut());
    }
}

/// Ignore SIGUSR1 when the debugger is already enabled via CLI flags.
pub fn ignore_sigusr1() {
    #[cfg(unix)]
    // SAFETY: `sigaction` with `SIG_IGN` is always valid.
    unsafe {
        let mut act: libc::sigaction = bun_core::ffi::zeroed();
        act.sa_sigaction = libc::SIG_IGN;
        libc::sigemptyset(&raw mut act.sa_mask);
        libc::sigaction(libc::SIGUSR1, &raw const act, core::ptr::null_mut());
    }
}

#[cfg(unix)]
mod platform {
    use super::*;
    use core::ffi::c_void;
    use core::sync::atomic::AtomicPtr;

    // Async-signal-safe semaphore (Mach on macOS, POSIX sem_t on Linux).
    unsafe extern "C" {
        fn Bun__Semaphore__create(value: core::ffi::c_uint) -> *mut c_void;
        fn Bun__Semaphore__destroy(sem: *mut c_void);
        fn Bun__Semaphore__signal(sem: *mut c_void) -> bool;
        fn Bun__Semaphore__wait(sem: *mut c_void) -> bool;
    }

    /// Live for the rest of the process once `install` succeeds; the thread
    /// parked on it is never joined (detaching is fine, it holds nothing).
    static SEMAPHORE: AtomicPtr<c_void> = AtomicPtr::new(core::ptr::null_mut());

    extern "C" fn sigusr1_handler(_: libc::c_int) {
        // Signal context: only async-signal-safe calls allowed. `sem_post` /
        // `semaphore_signal` are.
        let sem = SEMAPHORE.load(Ordering::Acquire);
        if !sem.is_null() {
            // SAFETY: `sem` is live for the rest of the process (see static doc).
            unsafe { Bun__Semaphore__signal(sem) };
        }
    }

    fn signal_inspector_thread(sem: *mut c_void) {
        bun_core::output::Source::configure_named_thread(bun_core::zstr!("SignalInspector"));
        loop {
            // SAFETY: `sem` is live for the rest of the process (see static doc).
            unsafe { Bun__Semaphore__wait(sem) };
            bun_core::scoped_log!(RuntimeInspector, "SignalInspector woke");
            request_inspector_activation();
        }
    }

    pub(super) fn install() -> bool {
        // SAFETY: FFI to `new Bun::Semaphore(0)`.
        let sem = unsafe { Bun__Semaphore__create(0) };
        if sem.is_null() {
            bun_core::scoped_log!(RuntimeInspector, "semaphore create failed");
            return false;
        }

        // `*mut` is `!Send`; the pointee is a `Bun::Semaphore`, internally
        // synchronized and live for the rest of the process, so moving the
        // address to the thread is sound.
        struct SendPtr(*mut c_void);
        // SAFETY: see above.
        unsafe impl Send for SendPtr {}
        let thread_sem = SendPtr(sem);
        let spawn = std::thread::Builder::new()
            .name("SignalInspector".to_string())
            .stack_size(512 * 1024)
            .spawn(move || {
                // Rebind the whole wrapper first: edition-2021 closures
                // otherwise capture the `!Send` field directly.
                let thread_sem = thread_sem;
                signal_inspector_thread(thread_sem.0)
            });
        if spawn.is_err() {
            bun_core::scoped_log!(RuntimeInspector, "thread spawn failed");
            // SAFETY: `sem` was just created above; no other thread holds it.
            unsafe { Bun__Semaphore__destroy(sem) };
            return false;
        }

        // Publish for the signal handler only once the consumer thread exists,
        // so a post can never be lost.
        SEMAPHORE.store(sem, Ordering::Release);
        install_sigaction();
        true
    }

    pub(super) fn install_sigaction() {
        // SAFETY: `sigaction` POD; all-zero is valid, fields overwritten below.
        unsafe {
            let mut act: libc::sigaction = bun_core::ffi::zeroed();
            act.sa_sigaction = sigusr1_handler as *const () as usize;
            act.sa_flags = libc::SA_RESTART;
            libc::sigemptyset(&raw mut act.sa_mask);
            libc::sigaction(libc::SIGUSR1, &raw const act, core::ptr::null_mut());
        }
    }
}

#[cfg(windows)]
#[allow(non_camel_case_types, non_snake_case)]
mod platform {
    use super::*;
    use core::ffi::c_void as void;
    use core::sync::atomic::AtomicPtr;

    type HANDLE = *mut void;
    type DWORD = u32;
    type BOOL = i32;
    type LPCWSTR = *const u16;
    type LPTHREAD_START_ROUTINE = unsafe extern "system" fn(*mut void) -> DWORD;

    const INVALID_HANDLE_VALUE: HANDLE = usize::MAX as HANDLE;
    const PAGE_READWRITE: DWORD = 0x04;
    const FILE_MAP_ALL_ACCESS: DWORD = 0xF001F;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateFileMappingW(
            hFile: HANDLE,
            lpFileMappingAttributes: *mut void,
            flProtect: DWORD,
            dwMaximumSizeHigh: DWORD,
            dwMaximumSizeLow: DWORD,
            lpName: LPCWSTR,
        ) -> HANDLE;
        fn MapViewOfFile(
            hFileMappingObject: HANDLE,
            dwDesiredAccess: DWORD,
            dwFileOffsetHigh: DWORD,
            dwFileOffsetLow: DWORD,
            dwNumberOfBytesToMap: usize,
        ) -> *mut void;
        fn UnmapViewOfFile(lpBaseAddress: *const void) -> BOOL;
        fn CloseHandle(hObject: HANDLE) -> BOOL;
        fn GetCurrentProcessId() -> DWORD;
    }

    static MAPPING_HANDLE: AtomicPtr<void> = AtomicPtr::new(core::ptr::null_mut());

    unsafe extern "system" fn start_debug_thread_proc(_: *mut void) -> DWORD {
        request_inspector_activation();
        0
    }

    pub(super) fn install() -> bool {
        // SAFETY: plain Win32 calls; all pointers below are either null or
        // returned by the kernel.
        unsafe {
            let pid = GetCurrentProcessId();
            let mut name: [u16; 64] = [0; 64];
            let s = format!("bun-debug-handler-{}", pid);
            for (i, c) in s.encode_utf16().enumerate() {
                if i >= 63 {
                    break;
                }
                name[i] = c;
            }

            let mapping = CreateFileMappingW(
                INVALID_HANDLE_VALUE,
                core::ptr::null_mut(),
                PAGE_READWRITE,
                0,
                core::mem::size_of::<LPTHREAD_START_ROUTINE>() as DWORD,
                name.as_ptr(),
            );
            if mapping.is_null() {
                bun_core::scoped_log!(RuntimeInspector, "CreateFileMappingW failed");
                return false;
            }

            let view = MapViewOfFile(
                mapping,
                FILE_MAP_ALL_ACCESS,
                0,
                0,
                core::mem::size_of::<LPTHREAD_START_ROUTINE>(),
            );
            if view.is_null() {
                bun_core::scoped_log!(RuntimeInspector, "MapViewOfFile failed");
                CloseHandle(mapping);
                return false;
            }

            *(view as *mut LPTHREAD_START_ROUTINE) = start_debug_thread_proc;
            UnmapViewOfFile(view);
            MAPPING_HANDLE.store(mapping, Ordering::Release);
            true
        }
    }
}

#[cfg(not(any(unix, windows)))]
mod platform {
    pub(super) fn install() -> bool {
        false
    }
}

/// Called from BunProcess.cpp when the last user SIGUSR1 listener is removed.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Sigusr1Handler__reinstall() {
    reinstall_after_user_handler();
}

/// Called from the C++ debugger-trap callback on the JS thread.
/// Consumes the activation flag and activates the inspector if requested.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__tryActivateInspector() -> bool {
    if !ACTIVATION_REQUESTED.swap(false, Ordering::AcqRel) {
        return false;
    }
    try_activate_inspector()
}
