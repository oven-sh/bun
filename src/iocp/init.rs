#![cfg(windows)]

//! Process-wide one-time initialization and the loop registry.
//!
//! These behaviors previously rode libuv's `uv__once_init` side effects; the
//! loop owns them now so they cannot silently vanish. // quirk: FSIO-44

use core::ffi::c_void;
// std Mutex (not bun_threading::Mutex): bun_threading pulls bun_alloc, which
// would break this crate's natively-linkable test binary (see Cargo.toml);
// the registry lock is cold-path (loop create/destroy, system resume).
#[allow(clippy::disallowed_types)]
use std::sync::{Mutex, Once};

use bun_windows_sys::kernel32::{PostQueuedCompletionStatus, SetErrorMode};
use bun_windows_sys::ws2_32::{WSADATA, WSAStartup};
use bun_windows_sys::{
    DEVICE_NOTIFY_CALLBACK, DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS, HANDLE, PBT_APMRESUMEAUTOMATIC,
    PBT_APMRESUMESUSPEND, PowerRegisterSuspendResumeNotification, SEM_FAILCRITICALERRORS,
    SEM_NOGPFAULTERRORBOX, SEM_NOOPENFILEERRORBOX, ULONG,
};

/// Every live loop's completion port. Registration is the LAST step of loop
/// construction and removal the FIRST step of teardown, so a registered port
/// is always valid and the resume waker can never post to a dying one.
/// // quirk: LOOP-37, LOOP-39
#[allow(clippy::disallowed_types)]
static LOOPS: Mutex<Vec<usize>> = Mutex::new(Vec::new());

pub(crate) fn register_loop(iocp: HANDLE) {
    LOOPS.lock().unwrap().push(iocp.expose_provenance());
}

pub(crate) fn unregister_loop(iocp: HANDLE) {
    let mut loops = LOOPS.lock().unwrap();
    // A loop that failed mid-construction was never added; ignore.
    if let Some(i) = loops.iter().position(|&p| p == iocp.addr()) {
        loops.swap_remove(i);
    }
}

/// Post a null completion packet to every registered loop. Each wakes, drops
/// the packet (the null filter), recomputes its timers against real time, and
/// fires anything overdue — IOCP waits get no credit for time the machine
/// spent suspended, so without this a 30-minute timer fires 30 minutes after
/// resume. // quirk: LOOP-38
pub fn wake_all_loops() {
    let loops = LOOPS.lock().unwrap();
    for &iocp in loops.iter() {
        // SAFETY: ports stay registered only while their loop is alive
        // (unregister precedes CloseHandle, under this lock).
        unsafe {
            PostQueuedCompletionStatus(
                core::ptr::with_exposed_provenance_mut::<c_void>(iocp),
                0,
                0,
                core::ptr::null_mut(),
            );
        }
    }
}

unsafe extern "system" fn system_resume_callback(
    _context: *mut c_void,
    ty: ULONG,
    _setting: *mut c_void,
) -> ULONG {
    // RESUMEAUTOMATIC fires on every resume; RESUMESUSPEND only follows when
    // there was user input. Waking twice is harmless (null packets coalesce
    // into at most two dequeues). // quirk: LOOP-38
    if ty == PBT_APMRESUMEAUTOMATIC || ty == PBT_APMRESUMESUSPEND {
        wake_all_loops();
    }
    0
}

/// ucrt's invalid-parameter hook. Default behavior terminates the process
/// (or pops a dialog in debug CRTs) when a CRT function receives e.g. a bad
/// fd; with a no-op installed, those calls fail with errors instead.
type InvalidParameterHandler = Option<
    unsafe extern "C" fn(
        expression: *const u16,
        function: *const u16,
        file: *const u16,
        line: u32,
        reserved: usize,
    ),
>;

unsafe extern "C" {
    fn _set_invalid_parameter_handler(handler: InvalidParameterHandler) -> InvalidParameterHandler;
}

unsafe extern "C" fn noop_invalid_parameter_handler(
    _expression: *const u16,
    _function: *const u16,
    _file: *const u16,
    _line: u32,
    _reserved: usize,
) {
}

/// Process-wide init, idempotent; runs on first loop creation (callable
/// earlier from startup). All three effects are process-global by nature.
pub fn process_init() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // No Windows Error Reporting dialogs, ever: hard errors and
        // removable-media probes must fail with codes, not freeze the
        // process behind a modal box. // quirk: LOOP-40, FSIO-44
        SetErrorMode(SEM_FAILCRITICALERRORS | SEM_NOGPFAULTERRORBOX | SEM_NOOPENFILEERRORBOX);

        // CRT calls with bad fds (reachable through N-API addons and any
        // remaining CRT-fd interop) must return EBADF-style errors, not
        // terminate. Process-wide by nature. // quirk: LOOP-41, ADD-05
        // SAFETY: installing a handler with the documented signature; the
        // no-op handler itself touches nothing.
        unsafe { _set_invalid_parameter_handler(Some(noop_invalid_parameter_handler)) };

        // Win8+ API, always present on the supported baseline — registered
        // directly, no GetProcAddress probe. The registration handle is
        // deliberately leaked (process lifetime). // quirk: LOOP-38
        let mut params = DEVICE_NOTIFY_SUBSCRIBE_PARAMETERS {
            Callback: system_resume_callback,
            Context: core::ptr::null_mut(),
        };
        let mut registration: *mut c_void = core::ptr::null_mut();
        // SAFETY: params outlives the call; the callback is registered for
        // process lifetime so no dangling context exists (Context is null).
        unsafe {
            PowerRegisterSuspendResumeNotification(
                DEVICE_NOTIFY_CALLBACK,
                &raw mut params,
                &raw mut registration,
            );
        }

        // Console-ctrl delivery + the SIGWINCH bridge: hooked once for the
        // process lifetime, never unhooked. // quirk: SIGEV-01, SIGEV-17
        crate::signal::signals_init();
    });
}

/// Winsock 2.2, process-wide, initialized at the first ACTUAL WSA consumer
/// (socket creation, AFD peer setup, work-pool `getaddrinfo`) — never at
/// startup, so network-free invocations skip the service-provider catalog
/// load entirely (libuv paid it in `uv__winsock_init` on every run).
/// Safe mode (SM_CLEANBOOT) has no winsock: skip like libuv does and let
/// socket calls fail with WSANOTINITIALISED instead of aborting.
pub fn ensure_winsock() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        if bun_windows_sys::user32::GetSystemMetrics(bun_windows_sys::user32::SM_CLEANBOOT) != 1 {
            let mut wsa_data = core::mem::MaybeUninit::<WSADATA>::zeroed();
            // SAFETY: valid out-pointer; winsock 2.2 always available.
            let r = unsafe { WSAStartup(0x0202, wsa_data.as_mut_ptr()) };
            assert_eq!(r, 0, "WSAStartup failed: {r}");
        }
    });
}

/// C-ABI twin for the C consumers (usockets `bsd_create_socket`, the uv
/// polyfills).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__ensure_winsock() {
    ensure_winsock();
}
