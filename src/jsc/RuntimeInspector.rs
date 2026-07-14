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

use core::sync::atomic::{AtomicBool, Ordering};

use crate::debugger::{Debugger, Mode, Wait};
use crate::{VM, VirtualMachineRef as VirtualMachine};

bun_core::declare_scope!(RuntimeInspector, hidden);

/// Default port for runtime-activated inspector. Overridden by `--inspect-port`.
const DEFAULT_INSPECTOR_PORT: &[u8] = b"6499";

static INSTALLED: AtomicBool = AtomicBool::new(false);
static ACTIVATION_REQUESTED: AtomicBool = AtomicBool::new(false);

unsafe extern "C" {
    fn Bun__installDebuggerTrapCallback(vm: *mut VM);
    fn Bun__activateRuntimeInspectorMode();
    #[cfg(unix)]
    fn Bun__gcSuspendResumeSignal() -> core::ffi::c_int;
}

static TRAP_CALLBACK_INSTALLED: AtomicBool = AtomicBool::new(false);

/// Called from the SignalInspector thread (POSIX) or remote thread (Windows).
/// Runs in normal thread context, so calling thread-safe JSC APIs is fine.
fn request_inspector_activation() {
    ACTIVATION_REQUESTED.store(true, Ordering::Release);

    let Some(vm) = VirtualMachine::get_main_thread_vm() else {
        return;
    };
    // SAFETY: main VM pointer is valid for process lifetime. `jsc_vm` may be
    // null only if SIGUSR1 arrives during the tiny window before
    // `VirtualMachine::init` writes it; in that case the event-loop wakeup
    // path below still activates via `check_and_activate_inspector`.
    // `setDebuggerTrapCallback` and `notifyNeedDebuggerBreak` are
    // CONCURRENT_SAFE; `EventLoop::wakeup` is safe from any thread.
    unsafe {
        let jsc_vm = (*vm).jsc_vm;
        if !jsc_vm.is_null() {
            if !TRAP_CALLBACK_INSTALLED.swap(true, Ordering::AcqRel) {
                Bun__installDebuggerTrapCallback(jsc_vm);
            }
            VM::opaque_ref(jsc_vm).notify_need_debugger_break();
        }
        (*(*vm).event_loop()).wakeup();
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
        // Arm the trap callback for subsequent CDP message delivery; on this
        // path the initial activation didn't go through the trap.
        if !TRAP_CALLBACK_INSTALLED.swap(true, Ordering::AcqRel) {
            if let Some(vm) = VirtualMachine::get_main_thread_vm() {
                // SAFETY: main-thread; `jsc_vm` set by the time the event
                // loop ticks.
                let jsc_vm = unsafe { (*vm).jsc_vm };
                if !jsc_vm.is_null() {
                    // SAFETY: `jsc_vm` is the live main JSC::VM*.
                    unsafe { Bun__installDebuggerTrapCallback(jsc_vm) };
                }
            }
        }
        // SAFETY: pure C++ atomic store.
        unsafe { Bun__activateRuntimeInspectorMode() };
    }
}

fn try_activate_inspector() -> bool {
    let Some(vm_ptr) = VirtualMachine::get_main_thread_vm() else {
        return false;
    };
    // SAFETY: single-JS-thread invariant; called from the main-thread event
    // loop tick or from the trap callback on the main VM's owning thread. Raw
    // pointer is used (not `&mut`) because `Debugger::create` materializes its
    // own `&VirtualMachine` from the thread-local, which would alias.
    unsafe {
        if (*vm_ptr).is_shutting_down {
            bun_core::scoped_log!(RuntimeInspector, "VM shutting down, ignoring activation");
            return false;
        }
        if (*vm_ptr).debugger.is_some() {
            bun_core::scoped_log!(RuntimeInspector, "debugger already active");
            return false;
        }

        if let Err(e) = activate_inspector(vm_ptr) {
            bun_core::pretty_errorln!("Failed to activate inspector: {}", e.name());
            bun_core::output::flush();
            return false;
        }
    }
    true
}

/// # Safety
/// Must be called on the main JS thread; `vm` is the live main-thread VM.
unsafe fn activate_inspector(vm: *mut VirtualMachine) -> crate::CrateResult<()> {
    bun_core::scoped_log!(RuntimeInspector, "activating");

    // SAFETY: per fn contract; each access is a fresh short-lived borrow so
    // nothing aliases across the `Debugger::create` call below.
    let (saved, global) = unsafe {
        let port = (*vm).inspect_port.unwrap_or(DEFAULT_INSPECTOR_PORT);
        (*vm).debugger = Some(Box::new(Debugger {
            path_or_port: Some(port),
            from_environment_variable: b"",
            wait_for_connection: Wait::Off,
            set_breakpoint_on_first_line: false,
            mode: Mode::Listen,
            ..Default::default()
        }));

        let opts = &mut (*vm).transpiler.options;
        let saved = (
            opts.minify_identifiers,
            opts.minify_syntax,
            opts.minify_whitespace,
            opts.debugger,
        );
        opts.minify_identifiers = false;
        opts.minify_syntax = false;
        opts.minify_whitespace = false;
        opts.debugger = true;

        (saved, (*vm).global())
    };

    if let Err(e) = Debugger::create(vm, global) {
        // SAFETY: `vm` still valid; restore state on failure.
        unsafe {
            (*vm).debugger = None;
            let opts = &mut (*vm).transpiler.options;
            opts.minify_identifiers = saved.0;
            opts.minify_syntax = saved.1;
            opts.minify_whitespace = saved.2;
            opts.debugger = saved.3;
        }
        return Err(e);
    }
    crate::runtime_transpiler_cache::IS_DISABLED.store(true, Ordering::Relaxed);
    Ok(())
}

pub fn is_installed() -> bool {
    INSTALLED.load(Ordering::Acquire)
}

/// Install the runtime-inspector handler. Idempotent.
pub fn install_if_not_already() {
    if INSTALLED.swap(true, Ordering::AcqRel) {
        return;
    }
    let ok = platform::install();
    if !ok {
        INSTALLED.store(false, Ordering::Release);
    }
}

/// Uninstall when a user SIGUSR1 listener takes over (POSIX only).
pub fn uninstall_for_user_handler() {
    if !INSTALLED.swap(false, Ordering::AcqRel) {
        return;
    }
    #[cfg(unix)]
    platform::uninstall();
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

    static SEMAPHORE: AtomicPtr<c_void> = AtomicPtr::new(core::ptr::null_mut());
    static SHUTTING_DOWN: AtomicBool = AtomicBool::new(false);

    extern "C" fn sigusr1_handler(_: libc::c_int) {
        // Signal context: only async-signal-safe calls allowed. `sem_post` /
        // `semaphore_signal` are.
        let sem = SEMAPHORE.load(Ordering::Acquire);
        if !sem.is_null() {
            // SAFETY: `sem` points at a live `Bun::Semaphore` until process
            // exit (we never destroy it; see `uninstall`).
            unsafe { Bun__Semaphore__signal(sem) };
        }
    }

    fn signal_inspector_thread() {
        bun_core::output::Source::configure_named_thread(bun_core::zstr!("SignalInspector"));
        loop {
            let sem = SEMAPHORE.load(Ordering::Acquire);
            if sem.is_null() {
                return;
            }
            // SAFETY: `sem` remains live for process lifetime once installed.
            unsafe { Bun__Semaphore__wait(sem) };
            if SHUTTING_DOWN.load(Ordering::Acquire) {
                bun_core::scoped_log!(RuntimeInspector, "SignalInspector thread exiting");
                return;
            }
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
        SEMAPHORE.store(sem, Ordering::Release);

        let spawn = std::thread::Builder::new()
            .name("SignalInspector".to_string())
            .stack_size(512 * 1024)
            .spawn(signal_inspector_thread);
        if spawn.is_err() {
            bun_core::scoped_log!(RuntimeInspector, "thread spawn failed");
            SEMAPHORE.store(core::ptr::null_mut(), Ordering::Release);
            // SAFETY: `sem` was just created above; no other thread holds it.
            unsafe { Bun__Semaphore__destroy(sem) };
            return false;
        }

        // SAFETY: `sigaction` POD; all-zero is valid, fields overwritten below.
        unsafe {
            let mut act: libc::sigaction = bun_core::ffi::zeroed();
            act.sa_sigaction = sigusr1_handler as *const () as usize;
            act.sa_flags = libc::SA_RESTART;
            libc::sigemptyset(&raw mut act.sa_mask);
            libc::sigaction(libc::SIGUSR1, &raw const act, core::ptr::null_mut());
        }
        true
    }

    pub(super) fn uninstall() {
        // Signal the thread to exit. Not joined: called from JS context
        // (process.on('SIGUSR1', ..)) so blocking would stall JS; the thread
        // and semaphore live until process exit, which is fine for a
        // once-per-process transition.
        SHUTTING_DOWN.store(true, Ordering::Release);
        let sem = SEMAPHORE.load(Ordering::Acquire);
        if !sem.is_null() {
            // SAFETY: `sem` is live for process lifetime.
            unsafe { Bun__Semaphore__signal(sem) };
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

/// Called from C++ when a user installs their own SIGUSR1 handler.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Sigusr1Handler__uninstall() {
    uninstall_for_user_handler();
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
