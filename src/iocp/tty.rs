#![cfg(windows)]

//! Console (TTY) handle class — the `uv_tty_t` replacement.
//!
//! Console handles cannot use IOCP/overlapped I/O at all, so nothing here is
//! ever associated with the port: raw-mode read readiness comes from a
//! thread-pool wait registration, cooked reads block a pool worker inside
//! `ReadConsoleW`, and writes run synchronously on the loop thread with their
//! completions injected through the pending queue. // quirk: TTY-56, TTY-25,
//! TTY-35, TTY-24
//!
//! Design decisions (named project outcomes, not oversights):
//!
//! - **UTF-16 at the boundary.** `write`/`try_write` take UTF-16 code units
//!   and line-mode reads deliver UTF-16 straight from `ReadConsoleW`; the
//!   WTF-8 conversion lives in the consumer's strings layer. libuv's
//!   byte-at-a-time UTF-8 decoder (its TTY-12 state machine) is therefore
//!   not ported — its cross-write-statefulness requirement survives as the
//!   pending-high-surrogate carry, so a surrogate pair split across two
//!   `write()` calls is still joined. Raw-mode reads deliver WTF-8 bytes
//!   (VT100 sequences are byte strings; Node's keypress ecosystem parses
//!   them as bytes). // quirk: TTY-12, TTY-13, TTY-31
//! - **VT passthrough always; no ANSI emulator.** The probe (TTY-08) enables
//!   ENABLE_VIRTUAL_TERMINAL_PROCESSING once per process; when the console
//!   rejects it (legacy-console checkbox, ancient hosts) escape sequences
//!   are passed through *unparsed* — Bun's 1809+ baseline already forces VT
//!   for its own output, and the emulator (TTY-14) plus its dependents
//!   (TTY-11/17/18/19/20/21/22) are skipped per the ledger dispositions.
//! - **Every adopted handle is privately duplicated.** libuv duplicates only
//!   fds 0-2; duplicating unconditionally gives every tty the cancellation
//!   property (close may CloseHandle freely) and removes the CRT-fd close
//!   split — fd lifecycle stays in the fd layer. // quirk: TTY-03, TTY-06
//! - **The raw wait is unregistered on the loop thread**, at completion
//!   dispatch, instead of inside the wait callback: the callback only posts.
//!   `UnregisterWait` is non-blocking and the post happens-before dispatch,
//!   so teardown is still ack'd by the waiter side and the endgame invariant
//!   (wait gone before close completes) holds. // quirk: TTY-46, TTY-25

use core::cell::UnsafeCell;
use core::ffi::c_void;
use core::mem;
use core::ptr;
use core::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
// std Mutex/Once (not bun_threading): bun_threading pulls bun_alloc, which
// would break this crate's natively-linkable test binary (see Cargo.toml);
// these guard cold paths (process init, resize debounce).
#[allow(clippy::disallowed_types)]
use std::sync::{Mutex, Once};

use bun_windows_sys::kernel32::{
    CreateEventW, DuplicateHandle, GetConsoleScreenBufferInfo, GetModuleHandleW, QueueUserWorkItem, SetConsoleCursorPosition,
    WT_EXECUTELONGFUNCTION,
};
use bun_windows_sys::{
    BOOLEAN, CONSOLE_SCREEN_BUFFER_INFO, CloseHandle, CreateFileW, CreateSemaphoreW,
    DUPLICATE_SAME_ACCESS, DWORD, ENABLE_ECHO_INPUT, ENABLE_LINE_INPUT, ENABLE_PROCESSED_INPUT,
    ENABLE_VIRTUAL_TERMINAL_INPUT, ENABLE_VIRTUAL_TERMINAL_PROCESSING, ENABLE_WINDOW_INPUT,
    ENHANCED_KEY, EVENT_CONSOLE_LAYOUT, FALSE, FILE_SHARE_READ, FILE_SHARE_WRITE, FOCUS_EVENT,
    GENERIC_READ, GENERIC_WRITE, GetConsoleMode, GetCurrentProcess, GetNumberOfConsoleInputEvents,
    GetProcAddress, HANDLE, INFINITE, INPUT_RECORD, INPUT_RECORD_Event, INVALID_HANDLE_VALUE,
    KEY_EVENT, KEY_EVENT_RECORD, KEY_EVENT_RECORD_uChar, LEFT_ALT_PRESSED, LEFT_CTRL_PRESSED,
    MAPVK_VK_TO_VSC, NT_SUCCESS, NtQueryInformationProcess, OPEN_EXISTING, OVERLAPPED,
    ProcessConsoleHostProcess, RIGHT_ALT_PRESSED, RIGHT_CTRL_PRESSED, ReadConsoleInputW,
    ReadConsoleW, RegisterWaitForSingleObject, ReleaseSemaphore, ResetEvent, SHIFT_PRESSED,
    SetConsoleMode, SetEvent, Sleep, TRUE, ULONG, UnregisterWait, VK_CLEAR, VK_DECIMAL, VK_DELETE,
    VK_DOWN, VK_END, VK_F1, VK_F2, VK_F3, VK_F4, VK_F5, VK_F6, VK_F7, VK_F8, VK_F9, VK_F10, VK_F11,
    VK_F12, VK_HOME, VK_INSERT, VK_LEFT, VK_MENU, VK_NEXT, VK_NUMPAD0, VK_NUMPAD1, VK_NUMPAD2,
    VK_NUMPAD3, VK_NUMPAD4, VK_NUMPAD5, VK_NUMPAD6, VK_NUMPAD7, VK_NUMPAD8, VK_NUMPAD9, VK_PRIOR,
    VK_RETURN, VK_RIGHT, VK_UP, WAIT_OBJECT_0, WINDOW_BUFFER_SIZE_EVENT, WINEVENT_OUTOFCONTEXT,
    WORD, WT_EXECUTEINWAITTHREAD, WT_EXECUTEONLYONCE, WaitForSingleObject, Win32Error,
    WriteConsoleInputW, WriteConsoleW,
};

use crate::event_loop::Loop;
use crate::handle::HandleCore;
use crate::req::{Req, ReqKind};

/// WriteConsoleW chunk cap — larger single console writes fail outright.
/// // quirk: TTY-15
const MAX_CONSOLE_CHAR: usize = 8192;
/// Cooked-read request size: libuv budgets 8192 *bytes* of WTF-8 and sizes
/// the UTF-16 request as bytes/3 (one UTF-16 unit never expands past 3 WTF-8
/// bytes); the unit count is what matters at this layer. // quirk: TTY-35
const MAX_LINE_READ_UNITS: usize = 8192 / 3;
/// Translated-key staging buffer: 1 (ESC prefix) + the longest VT100 table
/// sequence (6) fits, as does ESC + lone-surrogate WTF-8 + WTF-8 char (7).
const LAST_KEY_CAP: usize = 8;

const CR: u16 = 0x0D;
const LF: u16 = 0x0A;

// ── callback types ─────────────────────────────────────────────────────────

/// What a read completion delivers. Raw mode emits translated VT100/WTF-8
/// bytes into the caller's `read_start` buffer; line (cooked) mode lends the
/// UTF-16 units `ReadConsoleW` produced — valid only for the duration of the
/// callback (consume or copy synchronously). // quirk: TTY-27, TTY-31, TTY-35
#[derive(Copy, Clone, Debug)]
pub enum TtyReadData {
    Bytes { ptr: *mut u8, len: usize },
    Utf16 { ptr: *const u16, len: usize },
}

/// Read callback. `err == SUCCESS` delivers at least one byte/unit; any
/// other code delivers exactly once with an empty payload and stops reading.
pub type TtyReadCb = unsafe fn(&mut Loop, *mut c_void, TtyReadData, Win32Error);
/// Write callback: `(loop, data, units accepted, err)`. Fires exactly once
/// per `write()`, always asynchronously. // quirk: TTY-24
pub type TtyWriteCb = unsafe fn(&mut Loop, *mut c_void, usize, Win32Error);
/// Shutdown callback: queued writes drained (`SUCCESS`), or
/// `OPERATION_ABORTED` when the handle closed first. // quirk: TTY-47
pub type TtyShutdownCb = unsafe fn(&mut Loop, *mut c_void, Win32Error);
/// Close callback, run from the endgame once every in-flight request
/// drained; only then may the owner free the handle box.
pub type TtyCloseCb = unsafe fn(&mut Loop, *mut c_void);
/// Console-resize callback. Process-global; invoked from the resize watcher
/// thread or the loop thread — it must be thread-safe (the SIGWINCH dispatch
/// contract). // quirk: TTY-52
pub type TtyResizeCb = unsafe fn();

/// Console input mode. `Normal` is cooked (line editing, echo, ^C as
/// signal); `Raw` delivers translated keystrokes; `RawVt` additionally asks
/// conhost for VT input sequences, silently degrading to `Raw` when
/// rejected. There is no `IO` mode — a termios concept Windows cannot
/// express (libuv's UV_TTY_MODE_IO → ENOTSUP is unrepresentable here by
/// construction). // quirk: TTY-43, TTY-44, TTY-45
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum TtyMode {
    Normal,
    Raw,
    RawVt,
}

#[inline]
fn is_raw_mode(mode: TtyMode) -> bool {
    matches!(mode, TtyMode::Raw | TtyMode::RawVt)
}

/// Console-mode flag sets per [`TtyMode`]: `(flags, try_set_flags)`. NORMAL
/// deliberately omits ENABLE_EXTENDED_FLAGS so the user's insert/quick-edit
/// preferences survive; RAW is ENABLE_WINDOW_INPUT only (no PROCESSED — ^C
/// arrives as data); RAW_VT additionally *tries* the VT-input flag.
/// // quirk: TTY-43, TTY-44
fn mode_flags(mode: TtyMode) -> (DWORD, DWORD) {
    match mode {
        TtyMode::Normal => (
            ENABLE_ECHO_INPUT | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT,
            0,
        ),
        TtyMode::Raw => (ENABLE_WINDOW_INPUT, 0),
        TtyMode::RawVt => (ENABLE_WINDOW_INPUT, ENABLE_VIRTUAL_TERMINAL_INPUT),
    }
}

// ── process-global console state ───────────────────────────────────────────

static CONOUT_NAME: [u16; 8] = [
    b'C' as u16,
    b'O' as u16,
    b'N' as u16,
    b'O' as u16,
    b'U' as u16,
    b'T' as u16,
    b'$' as u16,
    0,
];
static CONIN_NAME: [u16; 7] = [
    b'C' as u16,
    b'O' as u16,
    b'N' as u16,
    b'I' as u16,
    b'N' as u16,
    b'$' as u16,
    0,
];
static USER32_NAME: [u16; 11] = [
    b'u' as u16,
    b's' as u16,
    b'e' as u16,
    b'r' as u16,
    b'3' as u16,
    b'2' as u16,
    b'.' as u16,
    b'd' as u16,
    b'l' as u16,
    b'l' as u16,
    0,
];

/// CONOUT$ / CONIN$ handles captured once at init (0 = absent — a GUI or
/// detached process simply has no console). // quirk: TTY-01
static CONOUT_HANDLE: AtomicUsize = AtomicUsize::new(0);
static CONIN_HANDLE: AtomicUsize = AtomicUsize::new(0);
/// Original console *input* mode snapshot, restored at exit when armed
/// (sentinel = never captured). // quirk: TTY-01, TTY-44
static ORIGINAL_IN_MODE: AtomicU32 = AtomicU32::new(u32::MAX);
static NEED_MODE_RESET: AtomicBool = AtomicBool::new(false);

/// The global output lock — a Win32 semaphore (initial count 1), because the
/// line-read cancellation protocol acquires it on the loop thread and
/// releases it on the ReadConsoleW worker thread; mutexes have thread
/// affinity. Serializes writes, SetConsoleMode, the VT probe, and the
/// cancel-time screen save/restore across ALL tty handles (one shared
/// console). // quirk: TTY-10
static OUTPUT_SEM: AtomicUsize = AtomicUsize::new(0);

/// VT-processing support, probed once on the first output tty (under the
/// output lock) or forced by the embedder. // quirk: TTY-08, TTY-09
static NEED_CHECK_VTERM: AtomicBool = AtomicBool::new(true);
static VTERM_SUPPORTED: AtomicBool = AtomicBool::new(false);

/// `MapVirtualKeyW` resolved from user32 if it is already loaded (never
/// LoadLibrary — quirk: TTY-53); 0 = unavailable, fall back to the fixed
/// PC/AT scan code for Enter.
static MAP_VIRTUAL_KEY_W: AtomicUsize = AtomicUsize::new(0);
/// PC/AT set-1 scan code for Enter, stable since the original AT keyboard.
const ENTER_SCAN_CODE_FALLBACK: WORD = 0x1C;

/// 4-state interlocked handshake between the line-read worker and the
/// canceller. // quirk: TTY-39
const READ_NOT_STARTED: u32 = 0;
const READ_IN_PROGRESS: u32 = 1;
const READ_TRAP_REQUESTED: u32 = 2;
const READ_COMPLETED: u32 = 3;
static READ_CONSOLE_STATUS: AtomicU32 = AtomicU32::new(READ_NOT_STARTED);
/// Whether the canceller captured a screen snapshot to restore after the
/// injected VK_RETURN's echo. // quirk: TTY-38
static RESTORE_SCREEN: AtomicBool = AtomicBool::new(false);

/// Screen snapshot shared between canceller and trapped reader. Plain cell:
/// the TTY-39 protocol gives exclusive phases — only the canceller writes
/// (before its Release store to RESTORE_SCREEN), only the trapped reader
/// reads (after its Acquire load observes `true`).
struct SavedScreen(UnsafeCell<CONSOLE_SCREEN_BUFFER_INFO>);
// SAFETY: access is serialized by the RESTORE_SCREEN release/acquire pair
// described on the struct; there is at most one canceller (loop thread,
// under the output lock) and one trapped reader per cycle.
unsafe impl Sync for SavedScreen {}
static SAVED_SCREEN: SavedScreen = SavedScreen(UnsafeCell::new(CONSOLE_SCREEN_BUFFER_INFO {
    dwSize: bun_windows_sys::COORD { X: 0, Y: 0 },
    dwCursorPosition: bun_windows_sys::COORD { X: 0, Y: 0 },
    wAttributes: 0,
    srWindow: bun_windows_sys::SMALL_RECT {
        Left: 0,
        Top: 0,
        Right: 0,
        Bottom: 0,
    },
    dwMaximumWindowSize: bun_windows_sys::COORD { X: 0, Y: 0 },
}));

/// Manual-reset event the layout hook signals; the watcher debounces it.
/// // quirk: TTY-51
static RESIZED_EVENT: AtomicUsize = AtomicUsize::new(0);

struct ResizeState {
    width: i32,
    height: i32,
    cb: Option<TtyResizeCb>,
}
/// Cached console size + the resize callback; compare-and-dispatch runs
/// under this lock, the callback outside it. // quirk: TTY-51
#[allow(clippy::disallowed_types)] // std Mutex: see the module-level import note
static RESIZE_STATE: Mutex<ResizeState> = Mutex::new(ResizeState {
    width: -1,
    height: -1,
    cb: None,
});

fn handle_from_bits(bits: usize) -> Option<HANDLE> {
    if bits == 0 {
        None
    } else {
        Some(ptr::with_exposed_provenance_mut::<c_void>(bits))
    }
}

fn console_out() -> Option<HANDLE> {
    handle_from_bits(CONOUT_HANDLE.load(Ordering::Acquire))
}

fn console_in() -> Option<HANDLE> {
    handle_from_bits(CONIN_HANDLE.load(Ordering::Acquire))
}

fn output_lock_acquire() {
    let sem = handle_from_bits(OUTPUT_SEM.load(Ordering::Acquire))
        .expect("tty output lock used before console_init");
    // SAFETY: the semaphore handle lives for the process lifetime.
    let r = unsafe { WaitForSingleObject(sem, INFINITE) };
    debug_assert_eq!(r.ok(), Some(WAIT_OBJECT_0));
}

fn output_lock_release() {
    let sem = handle_from_bits(OUTPUT_SEM.load(Ordering::Acquire))
        .expect("tty output lock used before console_init");
    // SAFETY: the semaphore handle lives for the process lifetime; releasing
    // from a different thread than the acquirer is the whole point of using
    // a semaphore. // quirk: TTY-10
    let ok = unsafe { ReleaseSemaphore(sem, 1, ptr::null_mut()) };
    debug_assert!(ok != 0);
}

/// Process-wide console initialization, idempotent. Opens CONOUT$/CONIN$
/// (best-effort — a detached process has no console), snapshots the original
/// input mode and the initial size, and starts the resize machinery. The
/// size is captured BEFORE the resize thread is queued — a layout event can
/// arrive the instant a listener exists. // quirk: TTY-01, TTY-02
pub fn console_init() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // The output lock first: everything below (and every later caller)
        // may take it. Creation failing means the kernel is out of handles
        // at process init — unrecoverable. // quirk: TTY-10
        // SAFETY: null attributes/name; counts are by-value.
        let sem = unsafe { CreateSemaphoreW(ptr::null_mut(), 1, 1, ptr::null()) };
        assert!(
            !sem.is_null(),
            "CreateSemaphoreW(tty output lock): {:?}",
            Win32Error::get()
        );
        OUTPUT_SEM.store(sem.expose_provenance(), Ordering::Release);

        // SAFETY: NUL-terminated static name; no other pointers.
        let conout = unsafe {
            CreateFileW(
                CONOUT_NAME.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_WRITE,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        // CreateFileW reports failure as INVALID_HANDLE_VALUE, never null.
        // // quirk: TTY-01
        if conout != INVALID_HANDLE_VALUE {
            CONOUT_HANDLE.store(conout.expose_provenance(), Ordering::Release);
            let mut info = zero_screen_info();
            // SAFETY: valid out-pointer; conout is a live console handle.
            if unsafe { GetConsoleScreenBufferInfo(conout, &raw mut info) } != 0 {
                let mut size = lock_resize_state();
                size.width = i32::from(info.dwSize.X);
                size.height = i32::from(info.srWindow.Bottom) - i32::from(info.srWindow.Top) + 1;
            }
            // Size cached above, only now spawn the watcher. // quirk: TTY-02
            // SAFETY: the thread proc touches only process-global state.
            unsafe {
                QueueUserWorkItem(
                    tty_resize_message_loop_thread,
                    ptr::null_mut(),
                    WT_EXECUTELONGFUNCTION,
                );
            }
        }

        // SAFETY: NUL-terminated static name; no other pointers.
        let conin = unsafe {
            CreateFileW(
                CONIN_NAME.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ,
                ptr::null_mut(),
                OPEN_EXISTING,
                0,
                ptr::null_mut(),
            )
        };
        if conin != INVALID_HANDLE_VALUE {
            CONIN_HANDLE.store(conin.expose_provenance(), Ordering::Release);
            let mut mode: DWORD = 0;
            // SAFETY: valid out-pointer; conin is a live console handle.
            if unsafe { GetConsoleMode(conin, &raw mut mode) } != 0 {
                ORIGINAL_IN_MODE.store(mode, Ordering::Release);
            }
        }

        // MapVirtualKeyW lives in user32: resolve only if user32 is already
        // loaded (GetModuleHandle, never LoadLibrary). // quirk: TTY-53
        // SAFETY: NUL-terminated static module name.
        let user32 = unsafe { GetModuleHandleW(USER32_NAME.as_ptr()) };
        if !user32.is_null() {
            // SAFETY: user32 is a live module; the name is NUL-terminated.
            let p = unsafe { GetProcAddress(user32, c"MapVirtualKeyW".as_ptr()) };
            MAP_VIRTUAL_KEY_W.store(p.expose_provenance(), Ordering::Release);
        }
    });
}

#[allow(clippy::disallowed_types)] // std Mutex: see the module-level import note
fn lock_resize_state() -> std::sync::MutexGuard<'static, ResizeState> {
    RESIZE_STATE.lock().unwrap_or_else(|p| p.into_inner())
}

const fn zero_screen_info() -> CONSOLE_SCREEN_BUFFER_INFO {
    CONSOLE_SCREEN_BUFFER_INFO {
        dwSize: bun_windows_sys::COORD { X: 0, Y: 0 },
        dwCursorPosition: bun_windows_sys::COORD { X: 0, Y: 0 },
        wAttributes: 0,
        srWindow: bun_windows_sys::SMALL_RECT {
            Left: 0,
            Top: 0,
            Right: 0,
            Bottom: 0,
        },
        dwMaximumWindowSize: bun_windows_sys::COORD { X: 0, Y: 0 },
    }
}

const fn zero_input_record() -> INPUT_RECORD {
    INPUT_RECORD {
        EventType: 0,
        Event: INPUT_RECORD_Event {
            KeyEvent: KEY_EVENT_RECORD {
                bKeyDown: 0,
                wRepeatCount: 0,
                wVirtualKeyCode: 0,
                wVirtualScanCode: 0,
                uChar: KEY_EVENT_RECORD_uChar { UnicodeChar: 0 },
                dwControlKeyState: 0,
            },
        },
    }
}

/// The dummy record `read_stop` injects to make a registered console wait
/// fire. FOCUS_EVENT because the drain ignores non-KEY records — and the
/// EventType MUST be a valid type: some Windows builds reject 0 with
/// ERROR_INVALID_PARAMETER (others accept it, so only this pin — not a
/// runtime test — can hold the line). // quirk: TTY-34
const fn raw_wake_record() -> INPUT_RECORD {
    let mut record = zero_input_record();
    record.EventType = FOCUS_EVENT;
    record
}

/// Restore the startup-captured console input mode iff a RAW_VT switch armed
/// the reset. Idempotent (atomic swap) and lock-free, so it is safe from
/// exit and crash paths. Shells reset *output* VT flags when a child exits
/// but not input flags — a process dying in RAW_VT would otherwise leave the
/// parent shell's stdin unusable. // quirk: TTY-44
pub fn reset_mode() {
    let Some(conin) = console_in() else { return };
    let original = ORIGINAL_IN_MODE.load(Ordering::Acquire);
    if original == u32::MAX {
        return;
    }
    if !NEED_MODE_RESET.swap(false, Ordering::AcqRel) {
        return;
    }
    // SAFETY: conin is the process-lifetime CONIN$ handle.
    unsafe { SetConsoleMode(conin, original) };
}

/// Embedder override of the VT-support state (FORCE_COLOR-style plumbing);
/// also suppresses the lazy probe. // quirk: TTY-09
pub fn set_vterm_state(supported: bool) {
    console_init();
    output_lock_acquire();
    NEED_CHECK_VTERM.store(false, Ordering::Release);
    VTERM_SUPPORTED.store(supported, Ordering::Release);
    output_lock_release();
}

/// Whether the console accepted ENABLE_VIRTUAL_TERMINAL_PROCESSING (probed
/// on the first output tty) or the embedder forced it. // quirk: TTY-08, TTY-09
pub fn vterm_supported() -> bool {
    console_init();
    output_lock_acquire();
    let v = VTERM_SUPPORTED.load(Ordering::Acquire);
    output_lock_release();
    v
}

/// Probe by *setting* the flag — there is no query API. The mode is
/// deliberately not restored: VT processing stays enabled on the shared
/// screen buffer for the process lifetime (shells reset output flags
/// themselves). Caller holds the output lock. // quirk: TTY-08
fn determine_vterm_state(handle: HANDLE) {
    NEED_CHECK_VTERM.store(false, Ordering::Release);
    let mut mode: DWORD = 0;
    // SAFETY: valid out-pointer; `handle` is a live console output handle.
    if unsafe { GetConsoleMode(handle, &raw mut mode) } == 0 {
        return;
    }
    // SAFETY: by-value flags on a live handle.
    if unsafe { SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING) } == 0 {
        return;
    }
    VTERM_SUPPORTED.store(true, Ordering::Release);
}

/// Install (or clear) the process-global console resize callback — the
/// SIGWINCH source. Fires from the watcher thread or the loop thread.
/// // quirk: TTY-52
pub fn set_resize_callback(cb: Option<TtyResizeCb>) {
    lock_resize_state().cb = cb;
}

/// Re-query the console size and dispatch the resize callback iff it
/// changed. Called from the watcher thread and from the raw-input drain
/// (WINDOW_BUFFER_SIZE_EVENT fallback). // quirk: TTY-50, TTY-51
fn signal_resize() {
    let Some(conout) = console_out() else { return };
    let mut info = zero_screen_info();
    // SAFETY: valid out-pointer; conout lives for the process lifetime.
    if unsafe { GetConsoleScreenBufferInfo(conout, &raw mut info) } == 0 {
        return;
    }
    let width = i32::from(info.dwSize.X);
    let height = i32::from(info.srWindow.Bottom) - i32::from(info.srWindow.Top) + 1;

    let cb;
    {
        let mut state = lock_resize_state();
        if width == state.width && height == state.height {
            return;
        }
        state.width = width;
        state.height = height;
        cb = state.cb;
        // The callback runs outside the lock: it may re-enter
        // set_resize_callback or query sizes. // quirk: TTY-51
    }
    if let Some(cb) = cb {
        // SAFETY: set_resize_callback's contract — the callback is
        // thread-safe and valid while installed.
        unsafe { cb() };
    }
}

// ── resize detection threads ───────────────────────────────────────────────

#[repr(C)]
#[allow(non_snake_case)] // mirrors winuser.h field spelling
struct MSG {
    hwnd: *mut c_void,
    message: u32,
    wParam: usize,
    lParam: isize,
    time: DWORD,
    pt: [i32; 2],
}

type SetWinEventHookFn = unsafe extern "system" fn(
    DWORD,
    DWORD,
    *mut c_void,
    WinEventProc,
    DWORD,
    DWORD,
    DWORD,
) -> *mut c_void;
type WinEventProc =
    unsafe extern "system" fn(*mut c_void, DWORD, *mut c_void, i32, i32, DWORD, DWORD);
type GetMessageWFn = unsafe extern "system" fn(*mut MSG, *mut c_void, u32, u32) -> i32;
type TranslateMessageFn = unsafe extern "system" fn(*const MSG) -> i32;
type DispatchMessageWFn = unsafe extern "system" fn(*const MSG) -> isize;

/// The layout hook only signals the debounce event; all real work happens on
/// the watcher thread. // quirk: TTY-51
unsafe extern "system" fn tty_resize_event_hook(
    _hook: *mut c_void,
    _event: DWORD,
    _hwnd: *mut c_void,
    _id_object: i32,
    _id_child: i32,
    _thread: DWORD,
    _time: DWORD,
) {
    if let Some(event) = handle_from_bits(RESIZED_EVENT.load(Ordering::Acquire)) {
        // SAFETY: the event handle lives for the process lifetime.
        unsafe { SetEvent(event) };
    }
}

/// Hook-registration + message-pump thread. WINEVENT_OUTOFCONTEXT callbacks
/// are delivered via this thread's message queue — without the GetMessage
/// pump no callback ever fires. Hooks ONLY the conhost PID; hooking pid 0
/// queues console events from every process on the machine (machine-hang
/// story). Every failure path is a graceful bail: the
/// WINDOW_BUFFER_SIZE_EVENT record fallback still detects resizes.
/// // quirk: TTY-49, TTY-51, TTY-53, TTY-50
unsafe extern "system" fn tty_resize_message_loop_thread(_arg: *mut c_void) -> DWORD {
    let mut conhost: usize = 0;
    // SAFETY: out-pointer sized exactly to the query; pseudo process handle.
    let status = unsafe {
        NtQueryInformationProcess(
            GetCurrentProcess(),
            ProcessConsoleHostProcess,
            (&raw mut conhost).cast::<c_void>(),
            size_of::<usize>() as ULONG,
            ptr::null_mut(),
        )
    };
    if !NT_SUCCESS(status) {
        return 0;
    }
    // The low 2 bits are flags; SetWinEventHook needs a real PID.
    // // quirk: TTY-49
    let conhost_pid = (conhost & !3) as DWORD;

    // SAFETY: null attributes/name; manual-reset, initially unsignaled.
    let event = unsafe { CreateEventW(ptr::null_mut(), TRUE, FALSE, ptr::null()) };
    if event.is_null() {
        return 0;
    }
    RESIZED_EVENT.store(event.expose_provenance(), Ordering::Release);
    // SAFETY: the watcher touches only process-global state.
    if unsafe {
        QueueUserWorkItem(
            tty_resize_watcher_thread,
            ptr::null_mut(),
            WT_EXECUTELONGFUNCTION,
        )
    } == 0
    {
        return 0;
    }

    // user32 may genuinely be absent (Server Core variants) or simply not
    // loaded; resolve-only, never LoadLibrary. // quirk: TTY-53
    // SAFETY: NUL-terminated static module name.
    let user32 = unsafe { GetModuleHandleW(USER32_NAME.as_ptr()) };
    if user32.is_null() {
        return 0;
    }
    // SAFETY: user32 is a live module; names are NUL-terminated.
    let (swe, gm, tm, dm) = unsafe {
        (
            GetProcAddress(user32, c"SetWinEventHook".as_ptr()),
            GetProcAddress(user32, c"GetMessageW".as_ptr()),
            GetProcAddress(user32, c"TranslateMessage".as_ptr()),
            GetProcAddress(user32, c"DispatchMessageW".as_ptr()),
        )
    };
    if swe.is_null() || gm.is_null() || tm.is_null() || dm.is_null() {
        return 0;
    }
    // SAFETY: the pointers were resolved from user32's export table for
    // exactly these documented signatures.
    let (swe, gm, tm, dm) = unsafe {
        (
            mem::transmute::<*mut c_void, SetWinEventHookFn>(swe),
            mem::transmute::<*mut c_void, GetMessageWFn>(gm),
            mem::transmute::<*mut c_void, TranslateMessageFn>(tm),
            mem::transmute::<*mut c_void, DispatchMessageWFn>(dm),
        )
    };

    // SAFETY: hooking only the conhost PID, out-of-context, with a callback
    // that touches only process-global state. Never pid 0. // quirk: TTY-49
    let hook = unsafe {
        swe(
            EVENT_CONSOLE_LAYOUT,
            EVENT_CONSOLE_LAYOUT,
            ptr::null_mut(),
            tty_resize_event_hook,
            conhost_pid,
            0,
            WINEVENT_OUTOFCONTEXT,
        )
    };
    if hook.is_null() {
        return 0;
    }

    // The pump: hook callbacks are delivered through this queue.
    // // quirk: TTY-51
    let mut msg = MSG {
        hwnd: ptr::null_mut(),
        message: 0,
        wParam: 0,
        lParam: 0,
        time: 0,
        pt: [0, 0],
    };
    loop {
        // SAFETY: valid MSG out-pointer; null filter args.
        if unsafe { gm(&raw mut msg, ptr::null_mut(), 0, 0) } == 0 {
            return 0;
        }
        // SAFETY: msg was just filled by GetMessageW.
        unsafe {
            tm(&raw const msg);
            dm(&raw const msg);
        }
    }
}

/// Debounce thread: at most ~30 size checks per second, and the event is
/// reset BEFORE the size check so a layout event landing during
/// `signal_resize` is not wiped (it re-signals the next round).
/// // quirk: TTY-51
unsafe extern "system" fn tty_resize_watcher_thread(_arg: *mut c_void) -> DWORD {
    loop {
        Sleep(33);
        let Some(event) = handle_from_bits(RESIZED_EVENT.load(Ordering::Acquire)) else {
            return 0;
        };
        // SAFETY: the event handle lives for the process lifetime.
        let _ = unsafe { WaitForSingleObject(event, INFINITE) };
        // SAFETY: same handle; reset-before-read ordering is load-bearing.
        unsafe { ResetEvent(event) };
        signal_resize();
    }
}

// ── raw key translation (pure; unit-tested without a console) ──────────────

/// Cygwin-compatible KEY_EVENT→VT100 table, byte-for-byte from libuv —
/// Node's readline keypress parser is built against these exact sequences.
/// Returns the full sequence including the leading ESC. // quirk: TTY-27
fn vt100_fn_key(vk: WORD, shift: bool, ctrl: bool) -> Option<&'static [u8]> {
    fn sel(
        shift: bool,
        ctrl: bool,
        n: &'static [u8],
        s: &'static [u8],
        c: &'static [u8],
        sc: &'static [u8],
    ) -> Option<&'static [u8]> {
        Some(match (shift, ctrl) {
            (true, true) => sc,
            (true, false) => s,
            (false, true) => c,
            (false, false) => n,
        })
    }
    match vk {
        VK_INSERT | VK_NUMPAD0 => sel(
            shift,
            ctrl,
            b"\x1b[2~",
            b"\x1b[2;2~",
            b"\x1b[2;5~",
            b"\x1b[2;6~",
        ),
        VK_END | VK_NUMPAD1 => sel(
            shift,
            ctrl,
            b"\x1b[4~",
            b"\x1b[4;2~",
            b"\x1b[4;5~",
            b"\x1b[4;6~",
        ),
        VK_DOWN | VK_NUMPAD2 => sel(
            shift,
            ctrl,
            b"\x1b[B",
            b"\x1b[1;2B",
            b"\x1b[1;5B",
            b"\x1b[1;6B",
        ),
        VK_NEXT | VK_NUMPAD3 => sel(
            shift,
            ctrl,
            b"\x1b[6~",
            b"\x1b[6;2~",
            b"\x1b[6;5~",
            b"\x1b[6;6~",
        ),
        VK_LEFT | VK_NUMPAD4 => sel(
            shift,
            ctrl,
            b"\x1b[D",
            b"\x1b[1;2D",
            b"\x1b[1;5D",
            b"\x1b[1;6D",
        ),
        VK_CLEAR | VK_NUMPAD5 => sel(
            shift,
            ctrl,
            b"\x1b[G",
            b"\x1b[1;2G",
            b"\x1b[1;5G",
            b"\x1b[1;6G",
        ),
        VK_RIGHT | VK_NUMPAD6 => sel(
            shift,
            ctrl,
            b"\x1b[C",
            b"\x1b[1;2C",
            b"\x1b[1;5C",
            b"\x1b[1;6C",
        ),
        VK_UP | VK_NUMPAD7 => sel(
            shift,
            ctrl,
            b"\x1b[A",
            b"\x1b[1;2A",
            b"\x1b[1;5A",
            b"\x1b[1;6A",
        ),
        VK_HOME | VK_NUMPAD8 => sel(
            shift,
            ctrl,
            b"\x1b[1~",
            b"\x1b[1;2~",
            b"\x1b[1;5~",
            b"\x1b[1;6~",
        ),
        VK_PRIOR | VK_NUMPAD9 => sel(
            shift,
            ctrl,
            b"\x1b[5~",
            b"\x1b[5;2~",
            b"\x1b[5;5~",
            b"\x1b[5;6~",
        ),
        VK_DELETE | VK_DECIMAL => sel(
            shift,
            ctrl,
            b"\x1b[3~",
            b"\x1b[3;2~",
            b"\x1b[3;5~",
            b"\x1b[3;6~",
        ),
        VK_F1 => sel(
            shift,
            ctrl,
            b"\x1b[[A",
            b"\x1b[23~",
            b"\x1b[11^",
            b"\x1b[23^",
        ),
        VK_F2 => sel(
            shift,
            ctrl,
            b"\x1b[[B",
            b"\x1b[24~",
            b"\x1b[12^",
            b"\x1b[24^",
        ),
        VK_F3 => sel(
            shift,
            ctrl,
            b"\x1b[[C",
            b"\x1b[25~",
            b"\x1b[13^",
            b"\x1b[25^",
        ),
        VK_F4 => sel(
            shift,
            ctrl,
            b"\x1b[[D",
            b"\x1b[26~",
            b"\x1b[14^",
            b"\x1b[26^",
        ),
        VK_F5 => sel(
            shift,
            ctrl,
            b"\x1b[[E",
            b"\x1b[28~",
            b"\x1b[15^",
            b"\x1b[28^",
        ),
        VK_F6 => sel(
            shift,
            ctrl,
            b"\x1b[17~",
            b"\x1b[29~",
            b"\x1b[17^",
            b"\x1b[29^",
        ),
        VK_F7 => sel(
            shift,
            ctrl,
            b"\x1b[18~",
            b"\x1b[31~",
            b"\x1b[18^",
            b"\x1b[31^",
        ),
        VK_F8 => sel(
            shift,
            ctrl,
            b"\x1b[19~",
            b"\x1b[32~",
            b"\x1b[19^",
            b"\x1b[32^",
        ),
        VK_F9 => sel(
            shift,
            ctrl,
            b"\x1b[20~",
            b"\x1b[33~",
            b"\x1b[20^",
            b"\x1b[33^",
        ),
        VK_F10 => sel(
            shift,
            ctrl,
            b"\x1b[21~",
            b"\x1b[34~",
            b"\x1b[21^",
            b"\x1b[34^",
        ),
        VK_F11 => sel(
            shift,
            ctrl,
            b"\x1b[23~",
            b"\x1b[23$",
            b"\x1b[23^",
            b"\x1b[23@",
        ),
        VK_F12 => sel(
            shift,
            ctrl,
            b"\x1b[24~",
            b"\x1b[24$",
            b"\x1b[24^",
            b"\x1b[24@",
        ),
        _ => None,
    }
}

/// WTF-8 encode one code point (lone surrogates included — they encode like
/// any other 3-byte scalar, which is exactly the degrade-to-WTF-8 behavior
/// the raw reader wants). Returns the byte count. // quirk: TTY-31
fn wtf8_encode(cp: u32, out: &mut [u8; 4]) -> usize {
    if cp < 0x80 {
        out[0] = cp as u8;
        1
    } else if cp < 0x800 {
        out[0] = 0xC0 | (cp >> 6) as u8;
        out[1] = 0x80 | (cp & 0x3F) as u8;
        2
    } else if cp < 0x1_0000 {
        out[0] = 0xE0 | (cp >> 12) as u8;
        out[1] = 0x80 | ((cp >> 6) & 0x3F) as u8;
        out[2] = 0x80 | (cp & 0x3F) as u8;
        3
    } else {
        out[0] = 0xF0 | (cp >> 18) as u8;
        out[1] = 0x80 | ((cp >> 12) & 0x3F) as u8;
        out[2] = 0x80 | ((cp >> 6) & 0x3F) as u8;
        out[3] = 0x80 | (cp & 0x3F) as u8;
        4
    }
}

/// Raw-mode translation state. `record` doubles as the repeat-expansion
/// carryover (`wRepeatCount` is decremented in place) and `last_key` as the
/// partial-emission carryover across user buffers and stop/start cycles.
/// // quirk: TTY-32, TTY-33
struct RawKeyState {
    record: INPUT_RECORD,
    last_key: [u8; LAST_KEY_CAP],
    last_key_len: u8,
    last_key_offset: u8,
    /// A high surrogate waiting for its partner from a later KEY_EVENT
    /// record (non-BMP input arrives as two records). // quirk: TTY-31
    high_surrogate: u16,
}

impl RawKeyState {
    const fn new() -> RawKeyState {
        RawKeyState {
            record: zero_input_record(),
            last_key: [0; LAST_KEY_CAP],
            last_key_len: 0,
            last_key_offset: 0,
            high_surrogate: 0,
        }
    }

    #[inline]
    fn has_bytes(&self) -> bool {
        self.last_key_len > 0
    }

    /// Next translated byte, honoring the partial-copy carryover and
    /// `wRepeatCount` expansion (one record may encode N keypresses). A
    /// repeat count of 0 — injectable via WriteConsoleInputW — emits once,
    /// never wraps (libuv's `--count > 0` underflows the WORD to 65535
    /// replays on that adversarial input; deliberate hardening).
    /// // quirk: TTY-32
    fn next_byte(&mut self) -> Option<u8> {
        loop {
            if self.last_key_offset < self.last_key_len {
                let b = self.last_key[self.last_key_offset as usize];
                self.last_key_offset += 1;
                return Some(b);
            }
            if self.last_key_len == 0 {
                return None;
            }
            // SAFETY: last_key_len > 0 implies `record` is the KEY_EVENT
            // that produced these bytes (translate_record contract).
            let repeat = unsafe { &mut self.record.Event.KeyEvent.wRepeatCount };
            if *repeat > 1 {
                *repeat -= 1;
                self.last_key_offset = 0;
                continue;
            }
            self.last_key_len = 0;
            return None;
        }
    }
}

enum RecordOutcome {
    /// Not a key worth emitting (mouse/menu/focus, keyups, compose noise).
    Skip,
    /// WINDOW_BUFFER_SIZE_EVENT — the resize fallback. // quirk: TTY-50
    Resize,
    /// `last_key` is loaded; drain bytes via [`RawKeyState::next_byte`].
    Key,
}

/// Translate `state.record` into bytes, mirroring libuv's filter chain
/// exactly. // quirk: TTY-27, TTY-28, TTY-29, TTY-30, TTY-31
fn translate_record(state: &mut RawKeyState) -> RecordOutcome {
    if state.record.EventType == WINDOW_BUFFER_SIZE_EVENT {
        return RecordOutcome::Resize;
    }
    if state.record.EventType != KEY_EVENT {
        return RecordOutcome::Skip;
    }
    // SAFETY: EventType == KEY_EVENT selects the KeyEvent union arm.
    let kev = unsafe { state.record.Event.KeyEvent };
    // SAFETY: KEY_EVENT_RECORD's uChar always carries UnicodeChar in the W
    // API family.
    let unicode = unsafe { kev.uChar.UnicodeChar };

    // Ignore keyups — UNLESS left-Alt was held and a character was
    // composed: Alt+Numpad (and IME/WSL-injected input) delivers the result
    // on the VK_MENU keyup. The `||` polarity here regressed once into
    // every-fn-key-twice (De Morgan slip). // quirk: TTY-28
    if kev.bKeyDown == 0 && (kev.wVirtualKeyCode != VK_MENU || unicode == 0) {
        return RecordOutcome::Skip;
    }

    // Suppress nav/numpad keyDOWNs while left-Alt is held (composition in
    // progress); the gray (ENHANCED_KEY) twins still pass. // quirk: TTY-29
    if kev.dwControlKeyState & LEFT_ALT_PRESSED != 0
        && kev.dwControlKeyState & ENHANCED_KEY == 0
        && matches!(
            kev.wVirtualKeyCode,
            VK_INSERT
                | VK_END
                | VK_DOWN
                | VK_NEXT
                | VK_LEFT
                | VK_CLEAR
                | VK_RIGHT
                | VK_HOME
                | VK_UP
                | VK_PRIOR
                | VK_NUMPAD0
                | VK_NUMPAD1
                | VK_NUMPAD2
                | VK_NUMPAD3
                | VK_NUMPAD4
                | VK_NUMPAD5
                | VK_NUMPAD6
                | VK_NUMPAD7
                | VK_NUMPAD8
                | VK_NUMPAD9
        )
    {
        return RecordOutcome::Skip;
    }

    if unicode != 0 {
        // Character key.
        if (0xD800..0xDC00).contains(&unicode) {
            // High surrogate: stash for the partner record. // quirk: TTY-31
            state.high_surrogate = unicode;
            return RecordOutcome::Skip;
        }

        // ESC-prefix when Alt is held — but never for AltGr, which arrives
        // as Ctrl+Alt on international layouts. // quirk: TTY-30
        let alt = kev.dwControlKeyState & (LEFT_ALT_PRESSED | RIGHT_ALT_PRESSED) != 0;
        let ctrl = kev.dwControlKeyState & (LEFT_CTRL_PRESSED | RIGHT_CTRL_PRESSED) != 0;
        let mut len = 0usize;
        if alt && !ctrl && kev.bKeyDown != 0 {
            state.last_key[0] = 0x1B;
            len = 1;
        }

        let mut scratch = [0u8; 4];
        if state.high_surrogate != 0 {
            let hi = mem::replace(&mut state.high_surrogate, 0);
            if (0xDC00..0xE000).contains(&unicode) {
                // Proper pair → one 4-byte scalar.
                let cp =
                    0x1_0000 + ((u32::from(hi) - 0xD800) << 10) + (u32::from(unicode) - 0xDC00);
                let n = wtf8_encode(cp, &mut scratch);
                state.last_key[len..len + n].copy_from_slice(&scratch[..n]);
                len += n;
            } else {
                // Unpaired: both degrade to WTF-8 instead of erroring.
                // // quirk: TTY-31
                let n = wtf8_encode(u32::from(hi), &mut scratch);
                state.last_key[len..len + n].copy_from_slice(&scratch[..n]);
                len += n;
                let n = wtf8_encode(u32::from(unicode), &mut scratch);
                state.last_key[len..len + n].copy_from_slice(&scratch[..n]);
                len += n;
            }
        } else {
            let n = wtf8_encode(u32::from(unicode), &mut scratch);
            state.last_key[len..len + n].copy_from_slice(&scratch[..n]);
            len += n;
        }

        state.last_key_len = len as u8;
        state.last_key_offset = 0;
        RecordOutcome::Key
    } else {
        // Function key.
        let Some(seq) = vt100_fn_key(
            kev.wVirtualKeyCode,
            kev.dwControlKeyState & SHIFT_PRESSED != 0,
            kev.dwControlKeyState & (LEFT_CTRL_PRESSED | RIGHT_CTRL_PRESSED) != 0,
        ) else {
            // Unmappable keys are silently dropped. // quirk: TTY-27
            return RecordOutcome::Skip;
        };
        // Fn keys ESC-prefix on any Alt — Ctrl is encoded in the table
        // variant instead, so no AltGr exclusion here. // quirk: TTY-30
        let mut len = 0usize;
        if kev.dwControlKeyState & (LEFT_ALT_PRESSED | RIGHT_ALT_PRESSED) != 0 {
            state.last_key[0] = 0x1B;
            len = 1;
        }
        debug_assert!(len + seq.len() <= LAST_KEY_CAP);
        state.last_key[len..len + seq.len()].copy_from_slice(seq);
        state.last_key_len = (len + seq.len()) as u8;
        state.last_key_offset = 0;
        RecordOutcome::Key
    }
}

// ── write transform (pure; unit-tested without a console) ──────────────────

/// Stream UTF-16 units through EOL conversion and chunking into `emit`
/// (≤ MAX_CONSOLE_CHAR units per call, surrogate pairs never split across
/// chunks). On the first emit error, emission stops but the state keeps
/// advancing so the next write starts consistent. The trailing high
/// surrogate of a call is *held* in `pending_high` and resolved by the next
/// call (pair → joined; anything else → passed through unmolested) — the
/// cross-write-state requirement at the UTF-16 level. // quirk: TTY-15,
/// TTY-16, TTY-23, TTY-12, TTY-13
fn transform_units(
    pending_high: &mut u16,
    previous_eol: &mut u16,
    units: &[u16],
    emit: &mut dyn FnMut(&[u16]) -> Win32Error,
) -> Win32Error {
    let mut chunk = [0u16; MAX_CONSOLE_CHAR];
    let mut used = 0usize;
    let mut first_err = Win32Error::SUCCESS;

    macro_rules! flush {
        () => {
            if used > 0 {
                if first_err == Win32Error::SUCCESS {
                    first_err = emit(&chunk[..used]);
                }
                used = 0;
            }
        };
    }
    macro_rules! ensure {
        ($n:expr) => {
            if used + $n > MAX_CONSOLE_CHAR {
                flush!();
            }
        };
    }

    for &unit in units {
        if *pending_high != 0 {
            let hi = mem::replace(pending_high, 0);
            if (0xDC00..0xE000).contains(&unit) {
                // Pair joined across the call boundary — emit atomically.
                ensure!(2);
                chunk[used] = hi;
                chunk[used + 1] = unit;
                used += 2;
                *previous_eol = 0;
                continue;
            }
            // Lone high surrogate: pass through unmolested. // quirk: TTY-13
            ensure!(1);
            chunk[used] = hi;
            used += 1;
            *previous_eol = 0;
            // fall through: `unit` still needs processing
        }
        if (0xD800..0xDC00).contains(&unit) {
            *pending_high = unit;
            continue;
        }
        if unit == LF {
            if *previous_eol != CR {
                // \n not preceded by \r → \r\n. // quirk: TTY-16
                ensure!(2);
                chunk[used] = CR;
                chunk[used + 1] = LF;
                used += 2;
            } else {
                // The \n of \r\n — the \r was already emitted as-is.
                ensure!(1);
                chunk[used] = LF;
                used += 1;
            }
            *previous_eol = LF;
        } else if unit == CR {
            if *previous_eol == LF {
                // \n\r: the inserted \r\n already covered it — swallow.
                // // quirk: TTY-16
            } else {
                // Lone \r (progress bars/spinners) passes unchanged.
                ensure!(1);
                chunk[used] = CR;
                used += 1;
            }
            *previous_eol = CR;
        } else {
            ensure!(1);
            chunk[used] = unit;
            used += 1;
            *previous_eol = 0;
        }
    }
    // Final flush (no reset — `used` dies here).
    if used > 0 && first_err == Win32Error::SUCCESS {
        first_err = emit(&chunk[..used]);
    }
    first_err
}

// ── request blocks ─────────────────────────────────────────────────────────

/// One queued write completion. The write itself already ran synchronously
/// on the loop thread; this block carries the deferred callback through the
/// pending queue. `req` MUST stay the first field. // quirk: TTY-24
#[repr(C)]
struct TtyWriteReq {
    req: Req,
    cb: Option<TtyWriteCb>,
    data: *mut c_void,
    len: usize,
}

/// Heap block for one cooked read on the system pool. Worker-owned from
/// queue to post (the loop thread touches nothing in it while in flight);
/// the dispatcher reads the results and frees it. The UTF-16 buffer is
/// lent to the read callback for its duration only. // quirk: TTY-35
struct LineReadWork {
    handle: HANDLE,
    iocp: HANDLE,
    /// The handle's read req OVERLAPPED, passed BY VALUE to
    /// `PostQueuedCompletionStatus`; never dereferenced by the worker.
    overlapped: *mut OVERLAPPED,
    units: DWORD,
    error: Win32Error,
    utf16: [u16; MAX_LINE_READ_UNITS],
}

/// Which kind of console read the in-flight read req represents — libuv
/// discriminated on `read_line_buffer.len == 0` (a self-acknowledged hack);
/// the explicit enum replaces it, the one-outstanding-read invariant stays.
/// // quirk: TTY-41
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ReadKind {
    Raw,
    Line,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ShutdownState {
    Idle,
    /// `shutdown()` called; waiting for queued write completions to drain.
    Requested,
    /// Completion queued (or aborted by close); awaiting dispatch.
    Queued,
    Done,
}

// ── the handle ─────────────────────────────────────────────────────────────

/// A console handle on the IOCP loop. Strictly half-duplex: the direction is
/// probed at open (input handles answer GetNumberOfConsoleInputEvents,
/// screen buffers answer GetConsoleScreenBufferInfo) and never trusted from
/// the caller; input ttys never touch screen-buffer state. Heap-pinned by
/// its owner for as long as it is active or has requests in flight;
/// destruction is the deferred endgame protocol. // quirk: TTY-05, TTY-07
#[repr(C)]
pub struct TtyHandle {
    core: HandleCore,
    /// Always a private duplicate of the handle given to `open` — the
    /// original (often a stdio handle) is never closed or poked by the
    /// cancellation machinery. // quirk: TTY-03
    handle: HANDLE,
    readable: bool,
    mode: TtyMode,
    reading: bool,
    read_pending: bool,
    /// A line-read cancel was dispatched; its completion's data is dropped.
    /// // quirk: TTY-40
    cancellation_pending: bool,
    read_kind: ReadKind,
    /// Registered raw-input wait. Loop-thread-only: registered at queue,
    /// consumed (unregistered) at dispatch; the wait callback never touches
    /// it. Null whenever no wait is registered. // quirk: TTY-46
    read_raw_wait: HANDLE,
    /// IOCP snapshot the wait callback posts to (set before registration —
    /// the registration call is the synchronization point).
    raw_wait_iocp: HANDLE,
    read_req: Req,
    read_buf: *mut u8,
    read_len: usize,
    read_cb: Option<TtyReadCb>,
    read_data: *mut c_void,
    line_work: *mut LineReadWork,
    raw: RawKeyState,
    /// Cross-write surrogate carry (write side). // quirk: TTY-12
    pending_high_surrogate: u16,
    /// Cross-write EOL state (write side). // quirk: TTY-16
    previous_eol: u16,
    write_reqs_pending: usize,
    shutdown_state: ShutdownState,
    shutdown_req: Req,
    shutdown_cb: Option<TtyShutdownCb>,
    shutdown_data: *mut c_void,
    close_cb: Option<TtyCloseCb>,
    close_data: *mut c_void,
}

/// # Safety
/// `lp` must be a valid pinned loop that outlives the handle.
unsafe fn new_box(lp: *mut Loop, handle: HANDLE, readable: bool) -> Box<TtyHandle> {
    let mut h = Box::new(TtyHandle {
        // SAFETY: fn contract — the loop outlives the handle; the box is the
        // required heap pinning.
        core: unsafe { HandleCore::new(lp, tty_endgame) },
        handle,
        readable,
        mode: TtyMode::Normal,
        reading: false,
        read_pending: false,
        cancellation_pending: false,
        read_kind: ReadKind::Raw,
        read_raw_wait: ptr::null_mut(),
        raw_wait_iocp: ptr::null_mut(),
        read_req: Req::new(ReqKind::TtyRead, ptr::null_mut()),
        read_buf: ptr::null_mut(),
        read_len: 0,
        read_cb: None,
        read_data: ptr::null_mut(),
        line_work: ptr::null_mut(),
        raw: RawKeyState::new(),
        pending_high_surrogate: 0,
        previous_eol: 0,
        write_reqs_pending: 0,
        shutdown_state: ShutdownState::Idle,
        shutdown_req: Req::new(ReqKind::TtyShutdown, ptr::null_mut()),
        shutdown_cb: None,
        shutdown_data: ptr::null_mut(),
        close_cb: None,
        close_data: ptr::null_mut(),
    });
    let hp: *mut TtyHandle = &raw mut *h;
    h.read_req = Req::new(ReqKind::TtyRead, hp.cast::<c_void>());
    h.shutdown_req = Req::new(ReqKind::TtyShutdown, hp.cast::<c_void>());
    h
}

impl TtyHandle {

    /// Adopt a console handle. Probes console-ness via `GetConsoleMode`
    /// (NUL, pipes and files are rejected with the probe's raw error,
    /// typically `INVALID_HANDLE`), duplicates the handle so close/cancel
    /// never affect the caller's original, and autodetects direction —
    /// there is no trusted `readable` parameter (callers passed the wrong
    /// flag for a decade upstream). The first *output* tty also runs the
    /// one-shot VT probe. The caller keeps ownership of `handle` (a private
    /// duplicate is taken on success). // quirk: TTY-01, TTY-03, TTY-05,
    /// TTY-07, TTY-08
    ///
    /// # Safety
    /// `lp` must be a valid pinned loop outliving the handle; `handle` must
    /// be a valid kernel handle; the caller must keep the returned box alive
    /// until the close callback runs.
    pub unsafe fn open(lp: *mut Loop, handle: HANDLE) -> Result<Box<TtyHandle>, Win32Error> {
        console_init();

        let mut dup: HANDLE = ptr::null_mut();
        // SAFETY: pseudo process handles; valid out-pointer. // quirk: TTY-03
        let ok = unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                handle,
                GetCurrentProcess(),
                &raw mut dup,
                0,
                FALSE,
                DUPLICATE_SAME_ACCESS,
            )
        };
        if ok == 0 {
            return Err(Win32Error::get());
        }

        // The console probe: every real console handle (either direction)
        // answers GetConsoleMode; pipes/files/NUL fail it.
        let mut mode: DWORD = 0;
        // SAFETY: valid out-pointer; dup is a live handle owned here.
        if unsafe { GetConsoleMode(dup, &raw mut mode) } == 0 {
            let err = Win32Error::get();
            // SAFETY: dup was created above and not shared.
            unsafe { CloseHandle(dup) };
            return Err(err);
        }

        // Direction by probing, never by trusting the caller.
        // // quirk: TTY-05
        let mut events: DWORD = 0;
        // SAFETY: valid out-pointer on a live handle.
        let readable = unsafe { GetNumberOfConsoleInputEvents(dup, &raw mut events) } != 0;
        if !readable {
            let mut info = zero_screen_info();
            // SAFETY: valid out-pointer on a live handle.
            if unsafe { GetConsoleScreenBufferInfo(dup, &raw mut info) } == 0 {
                let err = Win32Error::get();
                // SAFETY: dup owned here.
                unsafe { CloseHandle(dup) };
                return Err(err);
            }
            // Output handles only: the VT probe mutates shared screen-buffer
            // state, so input ttys never reach it. // quirk: TTY-07, TTY-08
            output_lock_acquire();
            if NEED_CHECK_VTERM.load(Ordering::Acquire) {
                determine_vterm_state(dup);
            }
            output_lock_release();
        }

        // SAFETY: forwarded fn contract.
        Ok(unsafe { new_box(lp, dup, readable) })
    }

    #[inline]
    pub fn raw_handle(&self) -> HANDLE {
        self.handle
    }
    #[inline]
    pub fn is_readable(&self) -> bool {
        self.readable
    }
    /// Console ttys are strictly half-duplex. // quirk: TTY-07
    #[inline]
    pub fn is_writable(&self) -> bool {
        !self.readable
    }
    #[inline]
    pub fn is_closing(&self) -> bool {
        self.core.is_closing()
    }
    #[inline]
    pub fn mode(&self) -> TtyMode {
        self.mode
    }

    /// Drop the loop keep-alive without stopping I/O.
    pub fn unref(&mut self) {
        self.core.unref();
    }
    /// Restore the keep-alive dropped by [`unref`](Self::unref).
    pub fn ref_(&mut self) {
        self.core.ref_();
    }

    // ── mode ─────────────────────────────────────────────────────────────

    /// Switch the console input mode. Order is load-bearing: a pending read
    /// is stopped (with the full cancel discipline) BEFORE SetConsoleMode —
    /// a cooked ReadConsoleW racing the flip to raw misbehaves — and
    /// restarted after, with SetConsoleMode itself under the output lock.
    /// Same-mode switches are no-ops; non-readable ttys reject with
    /// INVALID_PARAMETER. RAW_VT arms the exit-time reset BEFORE attempting
    /// the flag and silently degrades to RAW when the console rejects VT
    /// input. // quirk: TTY-42, TTY-43, TTY-44, TTY-45
    pub fn set_mode(&mut self, mode: TtyMode) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if !self.readable {
            return Err(Win32Error::INVALID_PARAMETER); // quirk: TTY-45
        }
        if mode == self.mode {
            return Ok(()); // quirk: TTY-45
        }
        let (flags, try_flags) = mode_flags(mode);
        if mode == TtyMode::RawVt {
            // Armed BEFORE the attempt: even a rejected VT flag leaves the
            // console in a raw mode worth resetting. // quirk: TTY-44
            NEED_MODE_RESET.store(true, Ordering::Release);
        }

        let was_reading = self.reading;
        let (buf, len, cb, data) = (self.read_buf, self.read_len, self.read_cb, self.read_data);
        if was_reading {
            self.read_stop()?; // quirk: TTY-42 (stop BEFORE SetConsoleMode)
        }

        output_lock_acquire();
        // Two-step: try with the optional flags, silently retry without
        // (RAW_VT degrades to RAW with no error). // quirk: TTY-44
        // SAFETY: by-value flags on the live private handle.
        let ok = unsafe {
            SetConsoleMode(self.handle, flags | try_flags) != 0
                || SetConsoleMode(self.handle, flags) != 0
        };
        if !ok {
            let err = Win32Error::get();
            output_lock_release();
            return Err(err);
        }
        output_lock_release();

        self.mode = mode;

        if was_reading {
            if let Some(cb) = cb {
                // SAFETY: restarting with the exact pointers the caller's
                // still-standing read_start contract covers.
                unsafe { self.read_start(buf, len, cb, data)? };
            }
        }
        Ok(())
    }

    // ── winsize ──────────────────────────────────────────────────────────

    /// `(width, height)`: width from the screen *buffer*, height from the
    /// visible *window* — buffer height is scrollback (often 9001 rows) and
    /// must never be reported as terminal size. Requires an output handle
    /// (the query fails on input handles, error returned raw).
    /// // quirk: TTY-48
    pub fn get_winsize(&self) -> Result<(i32, i32), Win32Error> {
        let mut info = zero_screen_info();
        // SAFETY: valid out-pointer; the handle lives until close.
        if unsafe { GetConsoleScreenBufferInfo(self.handle, &raw mut info) } == 0 {
            return Err(Win32Error::get());
        }
        Ok((
            i32::from(info.dwSize.X),
            i32::from(info.srWindow.Bottom) - i32::from(info.srWindow.Top) + 1,
        ))
    }

    // ── reading ──────────────────────────────────────────────────────────

    /// Start reading. Raw mode translates key events into `buf` (delivered
    /// via `cb` as `TtyReadData::Bytes`); cooked mode lends UTF-16 from the
    /// worker's block (`TtyReadData::Utf16`) and uses `buf` only as the
    /// registered retarget destination for later raw reads. One console
    /// read of either kind is outstanding at a time. // quirk: TTY-41
    ///
    /// # Safety
    /// `buf..buf+len` must be writable and unaliased until the close
    /// callback or a later `read_start` retargets it; `data` must be valid
    /// whenever `cb` can run.
    pub unsafe fn read_start(
        &mut self,
        buf: *mut u8,
        len: usize,
        cb: TtyReadCb,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if !self.readable {
            return Err(Win32Error::INVALID_PARAMETER);
        }
        if buf.is_null() || len == 0 {
            return Err(Win32Error::INVALID_PARAMETER);
        }
        self.reading = true;
        self.read_buf = buf;
        self.read_len = len;
        self.read_cb = Some(cb);
        self.read_data = data;
        self.core.start();

        // A read request may still be pending from before a read_stop.
        if self.read_pending {
            return Ok(());
        }

        let lp = self.core.loop_;
        let hp: *mut TtyHandle = self;
        if self.raw.has_bytes() {
            // The user stopped mid-key: short-circuit with an immediately
            // successful request instead of waiting on the console; the
            // READ_PENDING flag above prevents a double insert.
            // // quirk: TTY-33
            self.read_kind = ReadKind::Raw;
            self.read_req.set_success(0);
            self.read_pending = true;
            self.core.req_submitted_uncounted();
            // SAFETY: the read req is free (no read in flight) and lives
            // inside the pinned handle.
            unsafe { (*lp).insert_pending(&raw mut self.read_req) };
            return Ok(());
        }

        // SAFETY: handle pinned, loop valid, not closing, no read pending.
        unsafe { queue_read(lp, hp) };
        Ok(())
    }

    /// Stop reading, synchronously. A pending raw wait is woken by writing a
    /// FOCUS_EVENT record (the EventType must be a *valid* type — zero is
    /// rejected by modern Windows); a blocked cooked read is cancelled via
    /// the VK_RETURN trap handshake, after which its result is silently
    /// discarded. // quirk: TTY-34, TTY-37, TTY-40
    pub fn read_stop(&mut self) -> Result<(), Win32Error> {
        self.reading = false;
        if !self.core.is_closing() {
            self.core.stop();
        }
        if !self.read_pending {
            return Ok(());
        }
        if is_raw_mode(self.mode) {
            let record = raw_wake_record();
            let mut written: DWORD = 0;
            // SAFETY: one valid record by pointer; live private handle.
            if unsafe { WriteConsoleInputW(self.handle, &raw const record, 1, &raw mut written) }
                == 0
            {
                return Err(Win32Error::get());
            }
        } else if !self.cancellation_pending {
            self.cancel_read_console()?;
            self.cancellation_pending = true; // quirk: TTY-40
        }
        Ok(())
    }

    /// Trap-and-inject cancellation of a blocked `ReadConsoleW`: closing the
    /// handle does NOT unblock it and CancelSynchronousIo does not work on
    /// console reads — the only reliable unblock is completing the line with
    /// a fake VK_RETURN. The output lock is acquired HERE and released by
    /// the READER thread (that cross-thread release is why the lock is a
    /// semaphore); the screen state is saved first so the reader can erase
    /// the phantom newline the fake Enter echoes. // quirk: TTY-37, TTY-38,
    /// TTY-39, TTY-10
    fn cancel_read_console(&mut self) -> Result<(), Win32Error> {
        output_lock_acquire();
        let prev = READ_CONSOLE_STATUS.swap(READ_TRAP_REQUESTED, Ordering::AcqRel);
        if prev != READ_IN_PROGRESS {
            // Trap armed before the worker reached ReadConsoleW, or the read
            // already finished — nothing to inject, release ourselves.
            output_lock_release();
            return Ok(());
        }

        // Save the ACTIVE screen buffer's state (fresh CONOUT$ — the handle
        // being cancelled is the input handle). // quirk: TTY-38
        // SAFETY: NUL-terminated static name.
        let conout = unsafe {
            CreateFileW(
                CONOUT_NAME.as_ptr(),
                GENERIC_READ | GENERIC_WRITE,
                FILE_SHARE_READ | FILE_SHARE_WRITE,
                ptr::null_mut(),
                OPEN_EXISTING,
                bun_windows_sys::FILE_ATTRIBUTE_NORMAL,
                ptr::null_mut(),
            )
        };
        if conout != INVALID_HANDLE_VALUE {
            let mut info = zero_screen_info();
            // SAFETY: valid out-pointer on the just-opened handle.
            if unsafe { GetConsoleScreenBufferInfo(conout, &raw mut info) } != 0 {
                // SAFETY: exclusive write phase of the SAVED_SCREEN protocol
                // (TRAP_REQUESTED set, RESTORE_SCREEN not yet released).
                unsafe { *SAVED_SCREEN.0.get() = info };
                RESTORE_SCREEN.store(true, Ordering::Release);
            }
        }

        // The fake Enter: a fully-formed keydown record. // quirk: TTY-37
        let scan = match handle_from_bits(MAP_VIRTUAL_KEY_W.load(Ordering::Acquire)) {
            Some(p) => {
                // SAFETY: resolved from user32's export table for the
                // documented (UINT, UINT) -> UINT signature.
                let map = unsafe {
                    mem::transmute::<*mut c_void, unsafe extern "system" fn(u32, u32) -> u32>(p)
                };
                // SAFETY: by-value args.
                unsafe { map(u32::from(VK_RETURN), MAPVK_VK_TO_VSC) as WORD }
            }
            None => ENTER_SCAN_CODE_FALLBACK,
        };
        let mut record = zero_input_record();
        record.EventType = KEY_EVENT;
        record.Event = INPUT_RECORD_Event {
            KeyEvent: KEY_EVENT_RECORD {
                bKeyDown: TRUE,
                wRepeatCount: 1,
                wVirtualKeyCode: VK_RETURN,
                wVirtualScanCode: scan,
                uChar: KEY_EVENT_RECORD_uChar {
                    UnicodeChar: b'\r' as u16,
                },
                dwControlKeyState: 0,
            },
        };
        let mut written: DWORD = 0;
        // SAFETY: one valid record by pointer; live private handle.
        let ok = unsafe { WriteConsoleInputW(self.handle, &raw const record, 1, &raw mut written) };
        let err = if ok == 0 {
            Win32Error::get()
        } else {
            Win32Error::SUCCESS
        };
        if conout != INVALID_HANDLE_VALUE {
            // SAFETY: opened above, not shared.
            unsafe { CloseHandle(conout) };
        }
        // NOTE: the output lock stays held — the reader releases it after
        // the (possible) screen restore. // quirk: TTY-39
        if err != Win32Error::SUCCESS {
            return Err(err);
        }
        Ok(())
    }

    // ── writing ──────────────────────────────────────────────────────────

    /// Queue a write of UTF-16 code units. The conversion + WriteConsoleW
    /// run synchronously on the loop thread under the global output lock
    /// (console writes have no overlapped form); the completion is deferred
    /// through the pending queue so `cb` always fires asynchronously.
    /// Escape sequences pass through to the console (VT passthrough — no
    /// emulator). // quirk: TTY-24, TTY-14
    ///
    /// # Safety
    /// `data` must be valid whenever `cb` can run.
    pub unsafe fn write(
        &mut self,
        units: &[u16],
        cb: Option<TtyWriteCb>,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if self.shutdown_state != ShutdownState::Idle {
            return Err(Win32Error::NO_DATA);
        }
        if self.readable || self.handle == INVALID_HANDLE_VALUE {
            return Err(Win32Error::NO_DATA); // quirk: TTY-07
        }

        let hp: *mut TtyHandle = self;
        let wr = Box::into_raw(Box::new(TtyWriteReq {
            req: Req::new(ReqKind::TtyWrite, hp.cast::<c_void>()),
            cb,
            data,
            len: units.len(),
        }));
        self.core.req_submitted();
        self.write_reqs_pending += 1;

        let err = self.write_units(units);
        let lp = self.core.loop_;
        // SAFETY: `wr` is a fresh heap block, pinned until its completion
        // dispatches; the loop is valid (init contract).
        unsafe {
            if err == Win32Error::SUCCESS {
                (*wr).req.set_success(units.len());
            } else {
                (*wr).req.set_error(err);
            }
            (*lp).insert_pending(&raw mut (*wr).req); // quirk: TTY-24
        }
        Ok(())
    }

    /// Synchronous write attempt: succeeds inline only when no queued write
    /// completion is pending (order preservation), else `WSAEWOULDBLOCK`.
    /// // quirk: TTY-24
    pub fn try_write(&mut self, units: &[u16]) -> Result<usize, Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if self.shutdown_state != ShutdownState::Idle {
            return Err(Win32Error::NO_DATA);
        }
        if self.readable || self.handle == INVALID_HANDLE_VALUE {
            return Err(Win32Error::NO_DATA);
        }
        if self.write_reqs_pending > 0 {
            return Err(Win32Error::WSAEWOULDBLOCK);
        }
        let err = self.write_units(units);
        if err == Win32Error::SUCCESS {
            Ok(units.len())
        } else {
            Err(err)
        }
    }

    fn write_units(&mut self, units: &[u16]) -> Win32Error {
        let handle = self.handle;
        output_lock_acquire();
        let err = transform_units(
            &mut self.pending_high_surrogate,
            &mut self.previous_eol,
            units,
            &mut |chunk: &[u16]| {
                let mut written: DWORD = 0;
                // SAFETY: chunk points at live stack data, length ≤ 8192;
                // the handle is the live private console handle.
                // // quirk: TTY-15
                let ok = unsafe {
                    WriteConsoleW(
                        handle,
                        chunk.as_ptr().cast::<c_void>(),
                        chunk.len() as DWORD,
                        &raw mut written,
                        ptr::null_mut(),
                    )
                };
                if ok == 0 {
                    Win32Error::get()
                } else {
                    Win32Error::SUCCESS
                }
            },
        );
        output_lock_release();
        err
    }

    // ── shutdown ─────────────────────────────────────────────────────────

    /// TTY shutdown is a no-op that still settles its callback: console
    /// output has no half-close, so `cb` fires (asynchronously) once every
    /// previously queued write completion has dispatched — with
    /// `OPERATION_ABORTED` instead when the handle closes first.
    /// // quirk: TTY-47
    ///
    /// # Safety
    /// `data` must be valid whenever `cb` can run.
    pub unsafe fn shutdown(
        &mut self,
        cb: Option<TtyShutdownCb>,
        data: *mut c_void,
    ) -> Result<(), Win32Error> {
        if self.core.is_closing() {
            return Err(Win32Error::INVALID_HANDLE);
        }
        if self.shutdown_state != ShutdownState::Idle {
            return Err(Win32Error::INVALID_PARAMETER);
        }
        if self.readable || self.handle == INVALID_HANDLE_VALUE {
            return Err(Win32Error::NO_DATA);
        }
        self.shutdown_state = ShutdownState::Requested;
        self.shutdown_cb = cb;
        self.shutdown_data = data;
        self.core.req_submitted();
        if self.write_reqs_pending == 0 {
            let lp = self.core.loop_;
            let hp: *mut TtyHandle = self;
            // SAFETY: handle pinned; the shutdown req is free.
            unsafe { settle_shutdown(lp, hp, Win32Error::SUCCESS) };
        }
        Ok(())
    }

    // ── close ────────────────────────────────────────────────────────────

    /// Begin the asynchronous close. Reads are stopped FIRST, while the
    /// handle is still open — the FOCUS_EVENT poke and the VK_RETURN trap
    /// both need a live handle; the original close-then-stop order left
    /// ReadConsole threads blocked forever. A held write-side surrogate is
    /// flushed, the private handle is closed, and an unsettled shutdown is
    /// completed with OPERATION_ABORTED. `cb` runs from the loop once every
    /// request drained; only then may the owner free the box.
    /// // quirk: TTY-06, TTY-47
    pub fn close(&mut self, cb: Option<TtyCloseCb>, data: *mut c_void) {
        self.close_cb = cb;
        self.close_data = data;

        // 1. Stop reads while the handle is valid. // quirk: TTY-06
        if self.reading {
            // Best-effort: a failed wake here means the console itself is
            // gone, and the pending completion will surface through the
            // normal drain.
            let _ = self.read_stop();
        }

        // 2. A held high surrogate is emitted before the handle goes away —
        //    pass-through, never dropped. // quirk: TTY-13
        if !self.readable && self.pending_high_surrogate != 0 && self.handle != INVALID_HANDLE_VALUE
        {
            let unit = mem::replace(&mut self.pending_high_surrogate, 0);
            output_lock_acquire();
            let mut written: DWORD = 0;
            // SAFETY: one unit from a live local; live private handle.
            unsafe {
                WriteConsoleW(
                    self.handle,
                    (&raw const unit).cast::<c_void>(),
                    1,
                    &raw mut written,
                    ptr::null_mut(),
                );
            }
            output_lock_release();
        }

        // 3. Release the private duplicate. // quirk: TTY-03
        if self.handle != INVALID_HANDLE_VALUE {
            // SAFETY: the duplicate is owned by this handle, closed once.
            unsafe { CloseHandle(self.handle) };
            self.handle = INVALID_HANDLE_VALUE;
        }

        // 4. A shutdown still waiting on writes settles with the abort
        //    shape. // quirk: TTY-47
        if self.shutdown_state == ShutdownState::Requested {
            let lp = self.core.loop_;
            let hp: *mut TtyHandle = self;
            // SAFETY: handle pinned; the shutdown req is free.
            unsafe { settle_shutdown(lp, hp, Win32Error::OPERATION_ABORTED) };
        }

        self.core.close();
    }
}

// ── read machinery ─────────────────────────────────────────────────────────

/// Queue the mode-appropriate console read. // quirk: TTY-41
///
/// # Safety
/// `lp`/`h` valid and pinned; no read pending; handle open; not closing.
unsafe fn queue_read(lp: *mut Loop, h: *mut TtyHandle) {
    // SAFETY: forwarded fn contract.
    unsafe {
        if is_raw_mode((*h).mode) {
            queue_read_raw(lp, h);
        } else {
            queue_read_line(lp, h);
        }
    }
}

/// Wait-thread callback: the console input handle signaled. Only posts the
/// completion — record draining happens on the loop thread, and the wait is
/// unregistered there too (the post happens-before dispatch).
/// // quirk: TTY-25, TTY-26
unsafe extern "system" fn tty_raw_wait_cb(context: *mut c_void, _timed_out: BOOLEAN) {
    debug_assert!(_timed_out == 0, "INFINITE wait cannot time out");
    let h = context.cast::<TtyHandle>();
    // SAFETY: the handle is pinned until this req drains (endgame gating);
    // ownership of read_req transferred to the waiter at registration, and
    // raw_wait_iocp was written before the registration call.
    unsafe {
        (*h).read_req.set_success(0);
        crate::event_loop::post_or_die((*h).raw_wait_iocp, 0, 0, (*h).read_req.overlapped_ptr(), "tty read");
    }
}

/// Register the raw-readiness wait: console input handles are waitable
/// objects, so no reader thread blocks — and no IOCP, console handles can't.
/// // quirk: TTY-25, TTY-56
///
/// # Safety
/// `lp`/`h` valid and pinned; no read pending; handle open.
unsafe fn queue_read_raw(lp: *mut Loop, h: *mut TtyHandle) {
    // SAFETY: fn contract; the embedded req lives until its drain.
    unsafe {
        debug_assert!(!(*h).read_pending);
        debug_assert!((*h).read_raw_wait.is_null());
        (*h).read_kind = ReadKind::Raw;
        (*h).read_req.prime_pending();
        (*h).raw_wait_iocp = (*lp).iocp();
        (*h).read_pending = true;
        (*h).core.req_submitted_uncounted();

        let mut wait: HANDLE = ptr::null_mut();
        let ok = RegisterWaitForSingleObject(
            &raw mut wait,
            (*h).handle,
            tty_raw_wait_cb,
            h.cast::<c_void>(),
            INFINITE,
            WT_EXECUTEINWAITTHREAD | WT_EXECUTEONLYONCE,
        );
        if ok == 0 {
            // Synchronous failure becomes an asynchronous completion — one
            // delivery funnel.
            (*h).read_req.set_error(Win32Error::get());
            (*lp).insert_pending(&raw mut (*h).read_req);
            return;
        }
        (*h).read_raw_wait = wait;
    }
}

/// Cooked-read worker: blocks in `ReadConsoleW` on the system pool, runs the
/// reader half of the trap handshake, posts the completion. Touches only its
/// `LineReadWork` block and process-global trap state. // quirk: TTY-35,
/// TTY-38, TTY-39
unsafe extern "system" fn tty_line_read_thread_proc(arg: *mut c_void) -> DWORD {
    // SAFETY: `arg` is the LineReadWork leaked by queue_read_line; the
    // worker owns it exclusively until the post.
    unsafe {
        let work = arg.cast::<LineReadWork>();

        let prev = READ_CONSOLE_STATUS.swap(READ_IN_PROGRESS, Ordering::AcqRel);
        if prev == READ_TRAP_REQUESTED {
            // Pre-empted before the syscall: complete empty. The COMPLETED
            // store is load-bearing — omitting it left the status
            // IN_PROGRESS forever and deadlocked the NEXT cancel.
            // // quirk: TTY-39
            (*work).units = 0;
            (*work).error = Win32Error::SUCCESS;
            READ_CONSOLE_STATUS.swap(READ_COMPLETED, Ordering::AcqRel);
            crate::event_loop::post_or_die((*work).iocp, 0, 0, (*work).overlapped, "tty work");
            return 0;
        }

        let mut read: DWORD = 0;
        let ok = ReadConsoleW(
            (*work).handle,
            (*work).utf16.as_mut_ptr().cast::<c_void>(),
            MAX_LINE_READ_UNITS as DWORD,
            &raw mut read,
            ptr::null_mut(),
        );
        if ok != 0 {
            (*work).units = read;
            (*work).error = Win32Error::SUCCESS;
        } else {
            (*work).error = Win32Error::get();
        }

        let prev = READ_CONSOLE_STATUS.swap(READ_COMPLETED, Ordering::AcqRel);
        if prev == READ_TRAP_REQUESTED {
            // We were trapped: undo the fake Enter's visible echo, then
            // release the output lock the CANCELLER acquired (cross-thread
            // semaphore release). // quirk: TTY-38, TTY-39, TTY-10
            if ok != 0 && RESTORE_SCREEN.load(Ordering::Acquire) {
                let conout = CreateFileW(
                    CONOUT_NAME.as_ptr(),
                    GENERIC_READ | GENERIC_WRITE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    ptr::null_mut(),
                    OPEN_EXISTING,
                    bun_windows_sys::FILE_ATTRIBUTE_NORMAL,
                    ptr::null_mut(),
                );
                if conout != INVALID_HANDLE_VALUE {
                    // SAFETY: exclusive read phase of the SAVED_SCREEN
                    // protocol (RESTORE_SCREEN acquire-observed true).
                    let saved = *SAVED_SCREEN.0.get();
                    let mut pos = saved.dwCursorPosition;
                    // The echo SCROLLED the buffer if the cursor sat on the
                    // last buffer row. // quirk: TTY-38
                    if pos.Y == saved.dwSize.Y - 1 {
                        pos.Y -= 1;
                    }
                    SetConsoleCursorPosition(conout, pos);
                    CloseHandle(conout);
                }
            }
            output_lock_release();
        }

        crate::event_loop::post_or_die((*work).iocp, 0, 0, (*work).overlapped, "tty work");
    }
    0
}

/// Queue a cooked read on the system pool. Trap state is reset BEFORE
/// queueing (the queue call is the memory barrier). // quirk: TTY-35
///
/// # Safety
/// `lp`/`h` valid and pinned; no read pending; handle open.
unsafe fn queue_read_line(lp: *mut Loop, h: *mut TtyHandle) {
    // SAFETY: fn contract; the work block is heap-pinned until its
    // completion dispatches.
    unsafe {
        debug_assert!(!(*h).read_pending);
        (*h).read_kind = ReadKind::Line;
        (*h).read_req.prime_pending();
        RESTORE_SCREEN.store(false, Ordering::Release);
        READ_CONSOLE_STATUS.store(READ_NOT_STARTED, Ordering::Release);

        let work = Box::into_raw(Box::new(LineReadWork {
            handle: (*h).handle,
            iocp: (*lp).iocp(),
            overlapped: (*h).read_req.overlapped_ptr(),
            units: 0,
            error: Win32Error::SUCCESS,
            utf16: [0; MAX_LINE_READ_UNITS],
        }));
        (*h).line_work = work;
        (*h).read_pending = true;
        (*h).core.req_submitted_uncounted();

        if QueueUserWorkItem(
            tty_line_read_thread_proc,
            work.cast::<c_void>(),
            WT_EXECUTELONGFUNCTION,
        ) == 0
        {
            (*h).line_work = ptr::null_mut();
            drop(Box::from_raw(work));
            (*h).read_req.set_error(Win32Error::get());
            (*lp).insert_pending(&raw mut (*h).read_req);
        }
    }
}

/// Single delivery path for read completions (raw wakes, line completions,
/// short-circuits and synchronous failures), discriminated by the explicit
/// per-request kind. // quirk: TTY-41
pub(crate) fn process_tty_read_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<TtyHandle>();
    // SAFETY: `data` was set at init to the heap-pinned TtyHandle, kept
    // alive until all reqs drain (endgame protocol).
    unsafe {
        match (*h).read_kind {
            ReadKind::Raw => process_tty_read_raw(lp, h, req_ptr),
            ReadKind::Line => process_tty_read_line(lp, h, req_ptr),
        }
    }
}

/// Deliver a terminal read error: exactly once, reading stops. The flags are
/// not poisoned — a later `read_start` may try again. // quirk: TTY-55
///
/// # Safety
/// `lp`/`h` valid; caller is the dispatch path.
unsafe fn deliver_read_error(
    lp: *mut Loop,
    h: *mut TtyHandle,
    payload: TtyReadData,
    err: Win32Error,
) {
    // SAFETY: fn contract.
    unsafe {
        if !(*h).reading {
            return;
        }
        (*h).reading = false;
        (*h).core.stop();
        if let Some(cb) = (*h).read_cb {
            cb(&mut *lp, (*h).read_data, payload, err);
        }
    }
}

/// Raw drain: count, then read ONE record at a time, translating into the
/// user's buffer; `reading` is re-derived at every step because the callback
/// may stop/restart/close mid-drain. // quirk: TTY-26, TTY-55
///
/// # Safety
/// Dispatch-path contract: `h` pinned, req drained exactly once.
unsafe fn process_tty_read_raw(lp: *mut Loop, h: *mut TtyHandle, req: *mut Req) {
    // SAFETY: fn contract; borrows are short-lived and never held across
    // user callbacks.
    unsafe {
        (*h).read_pending = false;
        // The waiter posted (or never registered): retire the registration
        // on the loop thread. UnregisterWait is non-blocking; a still-
        // returning callback defers the deletion, never blocks the loop.
        // // quirk: TTY-46
        let wait = mem::replace(&mut (*h).read_raw_wait, ptr::null_mut());
        if !wait.is_null() {
            UnregisterWait(wait);
        }
        (*h).core.req_completed_uncounted();

        if !(*h).reading || !is_raw_mode((*h).mode) {
            requeue_read(lp, h);
            return;
        }
        if !(*req).success() {
            deliver_read_error(
                lp,
                h,
                TtyReadData::Bytes {
                    ptr: ptr::null_mut(),
                    len: 0,
                },
                (*req).error(),
            );
            return;
        }

        let mut records_left: DWORD = 0;
        if GetNumberOfConsoleInputEvents((*h).handle, &raw mut records_left) == 0 {
            deliver_read_error(
                lp,
                h,
                TtyReadData::Bytes {
                    ptr: ptr::null_mut(),
                    len: 0,
                },
                Win32Error::get(),
            );
            return;
        }

        let mut dbuf: *mut u8 = ptr::null_mut();
        let mut dcap = 0usize;
        let mut buf_used = 0usize;
        loop {
            if !(*h).reading {
                break;
            }
            if let Some(b) = (*h).raw.next_byte() {
                if buf_used == 0 {
                    // Snapshot the destination at fill start; a mid-drain
                    // read_start (from the callback) retargets the NEXT
                    // fill, never this one.
                    dbuf = (*h).read_buf;
                    dcap = (*h).read_len;
                }
                *dbuf.add(buf_used) = b;
                buf_used += 1;
                if buf_used == dcap {
                    if let Some(cb) = (*h).read_cb {
                        cb(
                            &mut *lp,
                            (*h).read_data,
                            TtyReadData::Bytes {
                                ptr: dbuf,
                                len: dcap,
                            },
                            Win32Error::SUCCESS,
                        );
                    }
                    buf_used = 0;
                }
                continue;
            }
            if records_left == 0 {
                break;
            }
            let mut got: DWORD = 0;
            if ReadConsoleInputW((*h).handle, &raw mut (*h).raw.record, 1, &raw mut got) == 0 {
                deliver_read_error(
                    lp,
                    h,
                    TtyReadData::Bytes {
                        ptr: ptr::null_mut(),
                        len: 0,
                    },
                    Win32Error::get(),
                );
                return;
            }
            records_left -= 1;
            match translate_record(&mut (*h).raw) {
                // The record-stream resize fallback. // quirk: TTY-50
                RecordOutcome::Resize => signal_resize(),
                RecordOutcome::Skip | RecordOutcome::Key => {}
            }
        }
        // Trailing flush — bytes already translated are delivered even when
        // the callback stopped reading mid-drain (libuv parity; the
        // alternative silently drops keystrokes).
        if buf_used > 0 {
            if let Some(cb) = (*h).read_cb {
                cb(
                    &mut *lp,
                    (*h).read_data,
                    TtyReadData::Bytes {
                        ptr: dbuf,
                        len: buf_used,
                    },
                    Win32Error::SUCCESS,
                );
            }
        }
        requeue_read(lp, h);
    }
}

/// Line-read completion: deliver the worker's UTF-16 (lent for the callback
/// duration), unless a cancellation discarded it; zero-unit reads never
/// reach the callback. // quirk: TTY-35, TTY-40
///
/// # Safety
/// Dispatch-path contract: `h` pinned, req drained exactly once.
unsafe fn process_tty_read_line(lp: *mut Loop, h: *mut TtyHandle, req: *mut Req) {
    // SAFETY: fn contract; the work block is exclusively loop-owned once its
    // completion is being dispatched.
    unsafe {
        (*h).read_pending = false;
        let work = mem::replace(&mut (*h).line_work, ptr::null_mut());
        (*h).core.req_completed_uncounted();

        let (units, err) = if work.is_null() {
            // QueueUserWorkItem failed synchronously; the req carries it.
            (0, (*req).error())
        } else if (*work).error == Win32Error::SUCCESS {
            ((*work).units as usize, Win32Error::SUCCESS)
        } else {
            (0, (*work).error)
        };

        if err != Win32Error::SUCCESS {
            deliver_read_error(
                lp,
                h,
                TtyReadData::Utf16 {
                    ptr: ptr::null(),
                    len: 0,
                },
                err,
            );
        } else {
            if !(*h).cancellation_pending && units > 0 {
                if let Some(cb) = (*h).read_cb {
                    cb(
                        &mut *lp,
                        (*h).read_data,
                        TtyReadData::Utf16 {
                            ptr: (*work).utf16.as_ptr(),
                            len: units,
                        },
                        Win32Error::SUCCESS,
                    );
                }
            }
            // One cancellation discards exactly one completion.
            // // quirk: TTY-40
            (*h).cancellation_pending = false;
        }

        requeue_read(lp, h);
        if !work.is_null() {
            drop(Box::from_raw(work));
        }
    }
}

/// Wait for more input iff the consumer still wants it and nothing is
/// already queued.
///
/// # Safety
/// Dispatch-path contract.
unsafe fn requeue_read(lp: *mut Loop, h: *mut TtyHandle) {
    // SAFETY: fn contract.
    unsafe {
        if (*h).reading
            && !(*h).read_pending
            && !(*h).core.is_closing()
            && (*h).handle != INVALID_HANDLE_VALUE
        {
            queue_read(lp, h);
        }
    }
}

// ── write/shutdown completion ──────────────────────────────────────────────

pub(crate) fn process_tty_write_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<TtyHandle>();
    // SAFETY: handle pinned until reqs drain (endgame protocol); the
    // TtyWriteReq is exclusively loop-owned at dispatch.
    unsafe {
        let wr = req_ptr.cast::<TtyWriteReq>();
        debug_assert!((*h).write_reqs_pending > 0);
        (*h).write_reqs_pending -= 1;
        (*h).core.req_completed();

        let success = (*req_ptr).success();
        let err = if success {
            Win32Error::SUCCESS
        } else {
            (*req_ptr).error()
        };
        let len = if success { (*wr).len } else { 0 };
        let cb = (*wr).cb;
        let data = (*wr).data;
        drop(Box::from_raw(wr));
        if let Some(cb) = cb {
            // Write callbacks fire on every terminal path, including during
            // close (one-shot promises).
            cb(&mut *lp, data, len, err);
        }
        // The last write completion releases a deferred shutdown.
        // // quirk: TTY-47
        if (*h).write_reqs_pending == 0
            && (*h).shutdown_state == ShutdownState::Requested
            && !(*h).core.is_closing()
        {
            settle_shutdown(lp, h, Win32Error::SUCCESS);
        }
    }
}

/// Queue the shutdown completion with its terminal status. // quirk: TTY-47
///
/// # Safety
/// `lp`/`h` valid and pinned; shutdown Requested; req free.
unsafe fn settle_shutdown(lp: *mut Loop, h: *mut TtyHandle, err: Win32Error) {
    // SAFETY: fn contract; the shutdown req lives inside the pinned handle.
    unsafe {
        debug_assert_eq!((*h).shutdown_state, ShutdownState::Requested);
        (*h).shutdown_state = ShutdownState::Queued;
        if err == Win32Error::SUCCESS {
            (*h).shutdown_req.set_success(0);
        } else {
            (*h).shutdown_req.set_error(err);
        }
        (*lp).insert_pending(&raw mut (*h).shutdown_req);
    }
}

pub(crate) fn process_tty_shutdown_req(loop_: &mut Loop, req: &mut Req) {
    let lp: *mut Loop = loop_;
    let req_ptr: *mut Req = req;
    let h = req.data().cast::<TtyHandle>();
    // SAFETY: handle pinned until reqs drain (endgame protocol).
    unsafe {
        (*h).shutdown_state = ShutdownState::Done;
        (*h).core.req_completed();
        let err = if (*h).core.is_closing() {
            Win32Error::OPERATION_ABORTED // quirk: TTY-47
        } else if !(*req_ptr).success() {
            (*req_ptr).error()
        } else {
            Win32Error::SUCCESS
        };
        let cb = (*h).shutdown_cb.take();
        let data = (*h).shutdown_data;
        if let Some(cb) = cb {
            cb(&mut *lp, data, err);
        }
    }
}

// ── endgame ────────────────────────────────────────────────────────────────

/// All requests drained: the raw wait must already be retired (the waiter
/// posted, dispatch unregistered — close never forces it) and the line
/// worker's block freed. Fires the close callback; the owner frees the box
/// afterwards. // quirk: TTY-46
unsafe fn tty_endgame(core: *mut HandleCore) {
    // SAFETY: the endgame drain passes the live, queued handle; `core` is
    // the first field of the #[repr(C)] TtyHandle.
    unsafe {
        let h = core.cast::<TtyHandle>();
        debug_assert!((*h).handle == INVALID_HANDLE_VALUE);
        debug_assert!((*h).read_raw_wait.is_null()); // quirk: TTY-46
        debug_assert!((*h).line_work.is_null());
        debug_assert!(!(*h).read_pending);
        let lp = (*h).core.loop_;
        let data = (*h).close_data;
        if let Some(cb) = (*h).close_cb.take() {
            cb(&mut *lp, data);
        }
    }
}

#[cfg(test)]
mod tests;
