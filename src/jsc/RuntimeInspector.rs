//! Starting the inspector in a running process (`kill -USR1 <pid>` / `process._debugProcess(pid)`), as Node does.
//!
//! POSIX: the SIGUSR1 handler posts a semaphore; the `SignalInspector` thread parked on it sets
//! `ACTIVATION_REQUESTED`, fires a `NeedDebuggerBreak` trap on the main VM (reaches a JS thread that
//! never returns to the event loop) and wakes the event loop (reaches an idle one). JSC services the
//! trap by calling the callback in `BunDebugger.cpp`, which calls [`Bun__tryActivateInspector`].
//! Windows: the named mapping `bun-debug-handler-<pid>` holds a function pointer that the signalling
//! process runs in this process via `CreateRemoteThread`, Node's protocol.

use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU8, Ordering};

use crate::debugger::{Debugger, Mode, Wait};
use crate::{VM, VirtualMachineRef as VirtualMachine};

bun_core::declare_scope!(RuntimeInspector, hidden);

/// Default port for runtime-activated inspector. Overridden by `--inspect-port`.
const DEFAULT_INSPECTOR_PORT: &[u8] = b"6499";

/// What SIGUSR1 does while no user `process.on("SIGUSR1")` listener is registered.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum Sigusr1 {
    /// `--disable-sigusr1`: the disposition is never touched, so the default action (terminate) applies.
    Default = 0,
    /// An inspector exists already (`--inspect*`), so the signal is ignored.
    Ignore = 1,
    /// Start the inspector; on Windows this also publishes the `process._debugProcess` mapping.
    StartInspector = 2,
}

/// The [`Sigusr1`] that [`configure`] put in place; re-applied once a user listener gets removed again.
static DISPOSITION: AtomicU8 = AtomicU8::new(Sigusr1::Default as u8);
static ACTIVATION_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Published by [`on_main_vm_ready`] with the trap callback installed; the only VM pointer the signal thread may read.
static MAIN_JSC_VM: AtomicPtr<VM> = AtomicPtr::new(core::ptr::null_mut());

unsafe extern "C" {
    fn Bun__installDebuggerTrapCallback(vm: *mut VM);
    fn Bun__activateRuntimeInspectorMode();
    #[cfg(unix)]
    fn Bun__gcSuspendResumeSignal() -> core::ffi::c_int;
}

/// Main thread, from `VirtualMachine::init` once `jsc_vm` exists; no-op unless [`configure`] chose [`Sigusr1::StartInspector`].
///
/// # Safety
/// `jsc_vm` is the main thread's `JSC::VM`, which is never destroyed before process exit.
pub unsafe fn on_main_vm_ready(jsc_vm: *mut VM) {
    if disposition() != Sigusr1::StartInspector || jsc_vm.is_null() {
        return;
    }
    // SAFETY: per fn contract.
    unsafe { Bun__installDebuggerTrapCallback(jsc_vm) };
    MAIN_JSC_VM.store(jsc_vm, Ordering::Release);
}

/// Ordinary thread context (the SignalInspector thread, or the thread `_debugProcess` injects on Windows).
fn request_inspector_activation() {
    ACTIVATION_REQUESTED.store(true, Ordering::Release);

    // Busy JS thread: trap it. Null only if the signal raced `VirtualMachine::init`; the wakeup below still works.
    let jsc_vm = MAIN_JSC_VM.load(Ordering::Acquire);
    if !jsc_vm.is_null() {
        VM::opaque_ref(jsc_vm).notify_need_debugger_break();
    }

    // Idle JS thread parked in epoll/kqueue: nothing checks the trap until it wakes, so wake it.
    if let Some(vm) = VirtualMachine::get_main_thread_vm() {
        // SAFETY: the main VM lives until process exit and `EventLoop::wakeup` may be called from any thread.
        unsafe { (*(*vm).event_loop()).wakeup() };
    }
}

/// Every main-thread event-loop tick: picks the request up when the JS thread was idle rather than trapped.
#[inline]
pub fn check_and_activate_inspector() {
    // Plain load first: this runs every tick, and only the signal thread ever stores here.
    if !ACTIVATION_REQUESTED.load(Ordering::Relaxed) {
        return;
    }
    if !ACTIVATION_REQUESTED.swap(false, Ordering::AcqRel) {
        return;
    }
    if try_activate_inspector() {
        // Same switch to trap-assisted CDP delivery that the trap path makes after `Bun__tryActivateInspector`.
        // SAFETY: pure C++ atomic store.
        unsafe { Bun__activateRuntimeInspectorMode() };
    }
}

/// Main thread only.
fn try_activate_inspector() -> bool {
    // `&` only: `start_at_runtime` re-borrows the VM through the thread-local accessor.
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

/// Main thread at startup, before [`on_main_vm_ready`]. Leaves the signal alone where JSC's GC suspends threads with it (FreeBSD).
pub fn configure(wanted: Sigusr1) {
    if wanted == Sigusr1::Default || gc_owns_sigusr1() {
        return;
    }
    if wanted == Sigusr1::StartInspector && !platform::install() {
        return;
    }
    DISPOSITION.store(wanted as u8, Ordering::Release);
    platform::apply(wanted);
}

/// BunProcess.cpp removed the last user `process.on("SIGUSR1")` listener and reset the signal to its default action.
pub fn reinstall_after_user_handler() {
    platform::apply(disposition());
}

fn disposition() -> Sigusr1 {
    match DISPOSITION.load(Ordering::Acquire) {
        1 => Sigusr1::Ignore,
        2 => Sigusr1::StartInspector,
        _ => Sigusr1::Default,
    }
}

fn gc_owns_sigusr1() -> bool {
    #[cfg(unix)]
    {
        // SAFETY: pure read of g_wtfConfig.
        return unsafe { Bun__gcSuspendResumeSignal() } == libc::SIGUSR1;
    }
    #[allow(unreachable_code)]
    false
}

#[cfg(unix)]
mod platform {
    use super::*;
    use core::ffi::c_void;
    use core::sync::atomic::AtomicPtr;

    // `Bun::Semaphore` (vm/Semaphore.cpp): Mach semaphore on macOS, `sem_t` elsewhere; both are async-signal-safe to post.
    unsafe extern "C" {
        fn Bun__Semaphore__create(value: core::ffi::c_uint) -> *mut c_void;
        fn Bun__Semaphore__destroy(sem: *mut c_void);
        fn Bun__Semaphore__signal(sem: *mut c_void) -> bool;
        fn Bun__Semaphore__wait(sem: *mut c_void) -> bool;
    }

    /// Never destroyed once published: the signal handler and the parked thread use it for the rest of the process.
    static SEMAPHORE: AtomicPtr<c_void> = AtomicPtr::new(core::ptr::null_mut());

    extern "C" fn sigusr1_handler(_: libc::c_int) {
        // Signal context: nothing but the post may happen here.
        let sem = SEMAPHORE.load(Ordering::Acquire);
        if !sem.is_null() {
            // SAFETY: `sem` is live for the rest of the process (see `SEMAPHORE`).
            unsafe { Bun__Semaphore__signal(sem) };
        }
    }

    fn signal_inspector_thread(sem: *mut c_void) {
        bun_core::output::Source::configure_named_thread(bun_core::zstr!("SignalInspector"));
        loop {
            // SAFETY: `sem` is live for the rest of the process (see `SEMAPHORE`).
            unsafe { Bun__Semaphore__wait(sem) };
            bun_core::scoped_log!(RuntimeInspector, "SignalInspector woke");
            request_inspector_activation();
        }
    }

    pub(super) fn install() -> bool {
        if !SEMAPHORE.load(Ordering::Acquire).is_null() {
            return true;
        }
        // SAFETY: FFI to `new Bun::Semaphore(0)`.
        let sem = unsafe { Bun__Semaphore__create(0) };
        if sem.is_null() {
            bun_core::scoped_log!(RuntimeInspector, "semaphore create failed");
            return false;
        }

        struct SendPtr(*mut c_void);
        // SAFETY: the pointee is a `Bun::Semaphore`, internally synchronized and live for the rest of the process.
        unsafe impl Send for SendPtr {}
        let thread_sem = SendPtr(sem);
        let spawn = std::thread::Builder::new()
            .name("SignalInspector".to_string())
            .stack_size(512 * 1024)
            .spawn(move || {
                // Captures the wrapper rather than its `!Send` field (edition 2021 disjoint captures).
                let thread_sem = thread_sem;
                signal_inspector_thread(thread_sem.0)
            });
        if spawn.is_err() {
            bun_core::scoped_log!(RuntimeInspector, "thread spawn failed");
            // SAFETY: `sem` was just created above; no other thread holds it.
            unsafe { Bun__Semaphore__destroy(sem) };
            return false;
        }

        // Published only once the consumer thread exists, so no post is ever lost.
        SEMAPHORE.store(sem, Ordering::Release);
        true
    }

    pub(super) fn apply(wanted: Sigusr1) {
        let handler: libc::sighandler_t = match wanted {
            Sigusr1::Default => return,
            Sigusr1::Ignore => libc::SIG_IGN,
            Sigusr1::StartInspector => sigusr1_handler as *const () as libc::sighandler_t,
        };
        // SAFETY: `sigaction` is plain data for which all-zero is valid; `handler` is SIG_IGN or a live fn.
        unsafe {
            let mut act: libc::sigaction = bun_core::ffi::zeroed();
            act.sa_sigaction = handler;
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

    /// Keeps the named mapping alive for the rest of the process (the view itself is unmapped right after the write).
    static MAPPING_HANDLE: AtomicPtr<void> = AtomicPtr::new(core::ptr::null_mut());

    unsafe extern "system" fn start_debug_thread_proc(_: *mut void) -> DWORD {
        request_inspector_activation();
        0
    }

    pub(super) fn install() -> bool {
        if !MAPPING_HANDLE.load(Ordering::Acquire).is_null() {
            return true;
        }
        // SAFETY: plain Win32 calls; every pointer below is null, NUL-terminated, or was returned by the kernel.
        unsafe {
            let name: Vec<u16> = format!("bun-debug-handler-{}\0", GetCurrentProcessId())
                .encode_utf16()
                .collect();

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

    pub(super) fn apply(_: Sigusr1) {}
}

#[cfg(not(any(unix, windows)))]
mod platform {
    pub(super) fn install() -> bool {
        false
    }

    pub(super) fn apply(_: super::Sigusr1) {}
}

/// Called from BunProcess.cpp when the last user SIGUSR1 listener is removed.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__Sigusr1Handler__reinstall() {
    reinstall_after_user_handler();
}

/// Called by `onDebuggerTrap` (BunDebugger.cpp) on the JS thread; true if this trap started the inspector.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__tryActivateInspector() -> bool {
    if !ACTIVATION_REQUESTED.swap(false, Ordering::AcqRel) {
        return false;
    }
    try_activate_inspector()
}
