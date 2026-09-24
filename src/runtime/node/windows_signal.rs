//! Where `process.on(<signal>)` gets its signals on Windows. Console control
//! events stand in for SIGINT, SIGBREAK and SIGHUP, and a change of the
//! console's size for SIGWINCH. Each is reported through `Bun__onPosixSignal`,
//! so from the signal ring onwards a signal takes the path it takes on POSIX.
//! SIGTERM and SIGQUIT can be listened for and are never raised.
//!
//! The console reports a change of its size in two ways. Whoever reads its
//! input in raw mode gets a record for it, which `bun_io`'s reader passes on. A
//! console that has a window also raises the `EVENT_CONSOLE_LAYOUT` WinEvent,
//! which reaches [`layout_thread`] whatever this process reads. A pseudoconsole
//! raises no WinEvents: under one, a process hears of a resize only while it
//! reads the console's input in raw mode.

use core::ffi::{c_int, c_void};
use core::sync::atomic::{AtomicBool, AtomicPtr, AtomicU32, AtomicU64, Ordering};

use bun_jsc::posix_signal_handle::Bun__onPosixSignal;
use bun_sys::windows as win;

// The numbers `os.constants.signals` reports on Windows.
const SIGHUP: c_int = 1;
const SIGINT: c_int = 2;
const SIGBREAK: c_int = 21;
const SIGWINCH: c_int = 28;

#[link(name = "kernel32")]
unsafe extern "system" {
    safe fn Sleep(dwMilliseconds: win::DWORD);
}

/// Bit `n` is set while signal `n`, one a console control event stands for,
/// has a listener.
static WATCHED: AtomicU32 = AtomicU32::new(0);

/// The process's only console control routine. It runs on a thread the system
/// creates for each event. While the event's signal has no listener it is left
/// to the default routine, which ends the process without running anything
/// registered for exit, so the console's modes are put back first.
extern "system" fn on_console_ctrl(ctrl_type: win::DWORD) -> win::BOOL {
    let signal = match ctrl_type {
        win::CTRL_C_EVENT => SIGINT,
        win::CTRL_BREAK_EVENT => SIGBREAK,
        win::CTRL_CLOSE_EVENT => SIGHUP,
        // Logoff and shutdown are only sent to services, which have their own
        // notification for them.
        _ => return win::FALSE,
    };
    if WATCHED.load(Ordering::Acquire) & (1 << signal) == 0 {
        bun_core::output::source::stdio::restore();
        bun_io::windows::tty::reset_console_mode();
        return win::FALSE;
    }
    Bun__onPosixSignal(signal);
    if ctrl_type == win::CTRL_CLOSE_EVENT {
        // The system terminates the process when this handler returns, and
        // after about five seconds if it does not. Not returning is what gives
        // the listener that time (libuv: uv__signal_control_handler).
        Sleep(win::INFINITE);
    }
    win::TRUE
}

/// Once, at startup. Windows calls control routines newest first, so one
/// added at the first `process.on("SIGINT")` would come before every routine
/// registered earlier, such as the one `vm`'s `breakOnSigint` installs.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__installWindowsSignalHandler() {
    let _ = win::SetConsoleCtrlHandler(Some(on_console_ctrl), win::TRUE);
}

/// First `process.on(<signal>)` listener for `signum` on the main thread.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__watchWindowsSignal(signum: c_int) {
    match signum {
        SIGINT | SIGBREAK | SIGHUP => {
            WATCHED.fetch_or(1 << signum, Ordering::Release);
        }
        SIGWINCH => watch_console_size(),
        _ => {}
    }
}

/// Last listener for `signum` removed.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__unwatchWindowsSignal(signum: c_int) {
    match signum {
        SIGINT | SIGBREAK | SIGHUP => {
            WATCHED.fetch_and(!(1 << signum), Ordering::Release);
        }
        SIGWINCH => unwatch_console_size(),
        _ => {}
    }
}

// ──────────────────────────────────────────────────────────────────────────
// SIGWINCH
// ──────────────────────────────────────────────────────────────────────────

/// `CONOUT$`, opened by the first SIGWINCH listener and kept.
static CONSOLE_OUTPUT: AtomicPtr<c_void> = AtomicPtr::new(core::ptr::null_mut());
/// The size SIGWINCH was last raised for, as `process.stdout.columns` and
/// `rows` report it: columns in the high half, rows in the low half.
static CONSOLE_SIZE: AtomicU64 = AtomicU64::new(0);

fn console_output() -> Option<win::HANDLE> {
    let cached = CONSOLE_OUTPUT.load(Ordering::Acquire);
    if !cached.is_null() {
        return Some(cached);
    }
    // SAFETY: plain Win32 call; the name is NUL-terminated.
    let console = unsafe {
        win::CreateFileW(
            bun_core::w!("CONOUT$\0").as_ptr(),
            win::GENERIC_READ | win::GENERIC_WRITE,
            win::FILE_SHARE_READ | win::FILE_SHARE_WRITE,
            core::ptr::null_mut(),
            win::OPEN_EXISTING,
            0,
            core::ptr::null_mut(),
        )
    };
    if console == win::INVALID_HANDLE_VALUE {
        return None;
    }
    match CONSOLE_OUTPUT.compare_exchange(
        core::ptr::null_mut(),
        console,
        Ordering::AcqRel,
        Ordering::Acquire,
    ) {
        Ok(_) => Some(console),
        Err(theirs) => {
            // SAFETY: opened above and handed to nobody.
            unsafe { win::CloseHandle(console) };
            Some(theirs)
        }
    }
}

fn console_size() -> Option<u64> {
    let console = console_output()?;
    let mut info: win::CONSOLE_SCREEN_BUFFER_INFO = bun_core::ffi::zeroed();
    // SAFETY: `info` is a live local.
    if unsafe { win::kernel32::GetConsoleScreenBufferInfo(console, &raw mut info) } == 0 {
        return None;
    }
    // Text wraps at the width of the screen buffer, which a window can be
    // narrower than.
    let columns = info.dwSize.X as u16;
    let rows = (info.srWindow.Bottom - info.srWindow.Top + 1) as u16;
    Some(u64::from(columns) << 32 | u64::from(rows))
}

/// Raise SIGWINCH if the console is not the size it was last raised for. Any
/// thread: [`layout_thread`], and whichever loop reads raw console input when
/// the console reports a resize there.
fn raise_if_console_resized() {
    let Some(size) = console_size() else {
        return;
    };
    if CONSOLE_SIZE.swap(size, Ordering::AcqRel) != size {
        Bun__onPosixSignal(SIGWINCH);
    }
}

/// Held to read or change the three below.
static LAYOUT_LOCK: bun_threading::Mutex = bun_threading::Mutex::new();
/// SIGWINCH has a listener.
static LAYOUT_WANTED: AtomicBool = AtomicBool::new(false);
/// A [`layout_thread`] exists that has not decided to end.
static LAYOUT_THREAD_RUNNING: AtomicBool = AtomicBool::new(false);
/// That thread, once a message can be posted to it; 0 otherwise.
static LAYOUT_THREAD_ID: AtomicU32 = AtomicU32::new(0);
/// A layout event has come in since [`layout_thread`] last compared sizes. Only
/// that thread touches it: [`on_console_layout`] runs on it.
static LAYOUT_CHANGED: AtomicBool = AtomicBool::new(false);

fn watch_console_size() {
    // No console, nothing to watch.
    let Some(size) = console_size() else {
        return;
    };
    CONSOLE_SIZE.store(size, Ordering::Release);
    bun_io::windows::tty::set_resize_listener(Some(raise_if_console_resized));

    let _lock = LAYOUT_LOCK.lock_guard();
    LAYOUT_WANTED.store(true, Ordering::Release);
    if !LAYOUT_THREAD_RUNNING.load(Ordering::Acquire) {
        let spawned = std::thread::Builder::new()
            .name("ConsoleLayout".into())
            .spawn(layout_thread)
            .is_ok();
        LAYOUT_THREAD_RUNNING.store(spawned, Ordering::Release);
    }
}

fn unwatch_console_size() {
    bun_io::windows::tty::set_resize_listener(None);

    let _lock = LAYOUT_LOCK.lock_guard();
    LAYOUT_WANTED.store(false, Ordering::Release);
    let thread = LAYOUT_THREAD_ID.load(Ordering::Acquire);
    if thread != 0
        && let Some(Some(user32)) = USER32.get()
    {
        // Any message: it gets the thread out of `GetMessageW` to look at
        // `LAYOUT_WANTED`.
        // SAFETY: plain Win32 call.
        unsafe { (user32.PostThreadMessageW)(thread, WM_NULL, 0, 0) };
    }
}

const EVENT_CONSOLE_LAYOUT: u32 = 0x4005;
const WINEVENT_OUTOFCONTEXT: u32 = 0;
const WM_NULL: u32 = 0;
const WM_USER: u32 = 0x0400;
const PM_NOREMOVE: u32 = 0;
const PM_REMOVE: u32 = 1;
const LOAD_LIBRARY_SEARCH_SYSTEM32: win::DWORD = 0x0000_0800;
/// `PROCESSINFOCLASS`: the process id of the console host, with flags in the
/// low two bits.
const PROCESS_CONSOLE_HOST_PROCESS: u32 = 49;

#[repr(C)]
#[allow(non_snake_case)]
struct MSG {
    hwnd: *mut c_void,
    message: u32,
    wParam: usize,
    lParam: isize,
    time: u32,
    pt: [i32; 2],
}

type WinEventProc = extern "system" fn(
    hook: *mut c_void,
    event: u32,
    hwnd: *mut c_void,
    id_object: i32,
    id_child: i32,
    event_thread: u32,
    event_time: u32,
);

/// What [`layout_thread`] needs of user32.dll, looked up there so that
/// nothing else loads the library or needs it to be installed.
#[allow(non_snake_case)]
struct User32 {
    SetWinEventHook: unsafe extern "system" fn(
        eventMin: u32,
        eventMax: u32,
        hmodWinEventProc: *mut c_void,
        pfnWinEventProc: WinEventProc,
        idProcess: u32,
        idThread: u32,
        dwFlags: u32,
    ) -> *mut c_void,
    UnhookWinEvent: unsafe extern "system" fn(hWinEventHook: *mut c_void) -> win::BOOL,
    PeekMessageW: unsafe extern "system" fn(
        lpMsg: *mut MSG,
        hWnd: *mut c_void,
        wMsgFilterMin: u32,
        wMsgFilterMax: u32,
        wRemoveMsg: u32,
    ) -> win::BOOL,
    GetMessageW: unsafe extern "system" fn(
        lpMsg: *mut MSG,
        hWnd: *mut c_void,
        wMsgFilterMin: u32,
        wMsgFilterMax: u32,
    ) -> win::BOOL,
    PostThreadMessageW: unsafe extern "system" fn(
        idThread: u32,
        Msg: u32,
        wParam: usize,
        lParam: isize,
    ) -> win::BOOL,
}

static USER32: bun_core::Once<Option<User32>> = bun_core::Once::new();

impl User32 {
    fn load() -> Option<User32> {
        // SAFETY: plain Win32 call; the name is NUL-terminated.
        let module = unsafe {
            win::kernel32::LoadLibraryExW(
                bun_core::w!("user32.dll\0").as_ptr(),
                core::ptr::null_mut(),
                LOAD_LIBRARY_SEARCH_SYSTEM32,
            )
        };
        if module.is_null() {
            return None;
        }
        let find = |name: &core::ffi::CStr| {
            // SAFETY: `module` is loaded and never freed; `name` is NUL-terminated.
            let symbol = unsafe { win::GetProcAddress(module, name.as_ptr()) };
            (!symbol.is_null()).then_some(symbol)
        };
        // SAFETY: each symbol is the user32 export of that name, whose
        // signature is the field's type.
        unsafe {
            Some(User32 {
                SetWinEventHook: core::mem::transmute::<*mut c_void, _>(find(c"SetWinEventHook")?),
                UnhookWinEvent: core::mem::transmute::<*mut c_void, _>(find(c"UnhookWinEvent")?),
                PeekMessageW: core::mem::transmute::<*mut c_void, _>(find(c"PeekMessageW")?),
                GetMessageW: core::mem::transmute::<*mut c_void, _>(find(c"GetMessageW")?),
                PostThreadMessageW: core::mem::transmute::<*mut c_void, _>(find(
                    c"PostThreadMessageW",
                )?),
            })
        }
    }
}

extern "system" fn on_console_layout(
    _hook: *mut c_void,
    _event: u32,
    _hwnd: *mut c_void,
    _id_object: i32,
    _id_child: i32,
    _event_thread: u32,
    _event_time: u32,
) {
    if LAYOUT_CHANGED.load(Ordering::Acquire) {
        return;
    }
    // Scrolling output raises these a line at a time. `GetMessageW` runs this
    // without returning, so the first event of a burst posts a message that
    // makes it return; one look at the size then covers the whole burst.
    // SAFETY: plain Win32 call.
    let posted = USER32
        .get()
        .and_then(Option::as_ref)
        .is_some_and(|user32| unsafe {
            (user32.PostThreadMessageW)(win::kernel32::GetCurrentThreadId(), WM_NULL, 0, 0) != 0
        });
    if posted {
        LAYOUT_CHANGED.store(true, Ordering::Release);
    } else {
        raise_if_console_resized();
    }
}

/// Hook the console host's layout events for this thread. `None` without
/// user32.dll, or when the system will not say which process hosts the console.
fn hook_console_layout() -> Option<(&'static User32, *mut c_void)> {
    let user32 = USER32.get_or_init(User32::load).as_ref()?;
    let mut console_host: usize = 0;
    // SAFETY: `console_host` is a live local of the size passed.
    let status = unsafe {
        win::ntdll::NtQueryInformationProcess(
            win::GetCurrentProcess(),
            PROCESS_CONSOLE_HOST_PROCESS,
            (&raw mut console_host).cast(),
            size_of::<usize>() as u32,
            core::ptr::null_mut(),
        )
    };
    if (status.0 as i32) < 0 {
        return None;
    }
    // SAFETY: plain Win32 calls; `message` is a live local.
    unsafe {
        // An out-of-context hook delivers through its thread's message queue,
        // which the first call that looks at the queue creates.
        let mut message: MSG = bun_core::ffi::zeroed_unchecked();
        (user32.PeekMessageW)(
            &raw mut message,
            core::ptr::null_mut(),
            WM_USER,
            WM_USER,
            PM_NOREMOVE,
        );
        let hook = (user32.SetWinEventHook)(
            EVENT_CONSOLE_LAYOUT,
            EVENT_CONSOLE_LAYOUT,
            core::ptr::null_mut(),
            on_console_layout,
            (console_host & !3) as u32,
            0,
            WINEVENT_OUTOFCONTEXT,
        );
        (!hook.is_null()).then_some((user32, hook))
    }
}

/// Lives while SIGWINCH has a listener. [`on_console_layout`] runs on it, from
/// inside `GetMessageW` and `PeekMessageW`.
fn layout_thread() {
    let Some((user32, hook)) = hook_console_layout() else {
        let _lock = LAYOUT_LOCK.lock_guard();
        LAYOUT_THREAD_RUNNING.store(false, Ordering::Release);
        return;
    };
    {
        let _lock = LAYOUT_LOCK.lock_guard();
        LAYOUT_THREAD_ID.store(win::kernel32::GetCurrentThreadId(), Ordering::Release);
    }
    // A resize between the listener's look at the size and the hook.
    raise_if_console_resized();
    let mut pumping = true;
    loop {
        {
            let _lock = LAYOUT_LOCK.lock_guard();
            if !pumping || !LAYOUT_WANTED.load(Ordering::Acquire) {
                LAYOUT_THREAD_ID.store(0, Ordering::Release);
                LAYOUT_THREAD_RUNNING.store(false, Ordering::Release);
                break;
            }
        }
        // SAFETY: plain Win32 calls; `message` is a live local.
        unsafe {
            let mut message: MSG = bun_core::ffi::zeroed_unchecked();
            pumping = (user32.GetMessageW)(&raw mut message, core::ptr::null_mut(), 0, 0) != -1;
            // Events that are already queued run their callback in here.
            while (user32.PeekMessageW)(&raw mut message, core::ptr::null_mut(), 0, 0, PM_REMOVE)
                != 0
            {}
        }
        if LAYOUT_CHANGED.swap(false, Ordering::AcqRel) {
            raise_if_console_resized();
        }
    }
    // SAFETY: `hook` was set by this thread and is unhooked once.
    unsafe { (user32.UnhookWinEvent)(hook) };
}
