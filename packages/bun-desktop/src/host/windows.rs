use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::time::Duration;

use gpui::Platform;
use windows::Win32::Foundation::{HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::IO::{
    GetQueuedCompletionStatus, OVERLAPPED, PostQueuedCompletionStatus,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{CreateEventW, INFINITE, SetEvent, WaitForSingleObject};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, HWND_MESSAGE, KillTimer, MSG,
    MWMO_INPUTAVAILABLE, MsgWaitForMultipleObjectsEx, PM_REMOVE, PeekMessageW, PostMessageW,
    QS_ALLINPUT, RegisterClassW, SetTimer, WINDOW_EX_STYLE, WINDOW_STYLE, WM_APP, WM_TIMER,
    WNDCLASSW,
};
use windows::core::w;

pub const IS_REENTRANT: bool = true;
pub const RUNS_ON_ANY_THREAD: bool = false;

pub fn wake_ui() {}

const TIMER_ID: usize = 1;

static WINDOW: AtomicIsize = AtomicIsize::new(0);
static IS_READY: AtomicBool = AtomicBool::new(false);
static IS_WATCHING: AtomicBool = AtomicBool::new(false);
/// An event that tells the thread of `watch_port` to wait for the next completion.
static WATCH: OnceLock<isize> = OnceLock::new();

fn window() -> HWND {
    HWND(WINDOW.load(Ordering::Relaxed) as _)
}

/// `wait` drops these messages, so they come from the loop of a menu, a drag or a resize.
extern "system" fn procedure(hwnd: HWND, message: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if !matches!(message, WM_APP | WM_TIMER) {
        // SAFETY: the arguments that this was called with.
        return unsafe { DefWindowProcW(hwnd, message, wparam, lparam) };
    }
    super::tick();
    LRESULT(0)
}

pub fn init() {
    // SAFETY: the class name is static, and the class is registered before it is used.
    unsafe {
        let instance = GetModuleHandleW(None).ok().map(Into::into);
        let class = WNDCLASSW {
            lpfnWndProc: Some(procedure),
            hInstance: instance.unwrap_or_default(),
            lpszClassName: w!("BunDesktopHost"),
            ..WNDCLASSW::default()
        };
        RegisterClassW(&class);
        let (style, parent) = (WINDOW_STYLE::default(), Some(HWND_MESSAGE));
        let (name, extended) = (class.lpszClassName, WINDOW_EX_STYLE::default());
        let window = CreateWindowExW(
            extended, name, None, style, 0, 0, 0, 0, parent, None, instance, None,
        );
        WINDOW.store(
            window.expect("could not create a window").0 as isize,
            Ordering::Relaxed,
        );
    }
}

pub fn wake() {
    // SAFETY: no pointers are passed.
    unsafe { PostMessageW(Some(window()), WM_APP, WPARAM(0), LPARAM(0)).ok() };
}

pub fn started(_: &dyn Platform) {}

/// A completion port cannot be waited for together with messages. What is taken from it is put back.
fn watch_port(port: isize, watch: isize) {
    let (port, watch) = (HANDLE(port as _), HANDLE(watch as _));
    loop {
        let (mut bytes, mut key, mut overlapped) = (0, 0, std::ptr::null_mut::<OVERLAPPED>());
        // SAFETY: both handles stay open, and `overlapped` is only passed on.
        unsafe {
            WaitForSingleObject(watch, INFINITE);
            let result =
                GetQueuedCompletionStatus(port, &mut bytes, &mut key, &mut overlapped, INFINITE);
            if result.is_ok() || !overlapped.is_null() {
                PostQueuedCompletionStatus(port, bytes, key, Some(overlapped.cast_const())).ok();
            }
        }
        IS_WATCHING.store(false, Ordering::SeqCst);
        IS_READY.store(true, Ordering::SeqCst);
        wake();
    }
}

/// Makes any loop that dispatches messages notice `source` and the time.
pub fn arm(source: Option<isize>, timeout: Option<Duration>) {
    if let Some(port) = source.filter(|_| timeout != Some(Duration::ZERO))
        && !IS_WATCHING.swap(true, Ordering::SeqCst)
    {
        let watch = *WATCH.get_or_init(|| {
            // SAFETY: an unnamed event, which is never closed.
            let watch = unsafe { CreateEventW(None, false, false, None) }
                .expect("could not create an event")
                .0 as isize;
            std::thread::spawn(move || watch_port(port, watch));
            watch
        });
        // SAFETY: as above.
        unsafe { SetEvent(HANDLE(watch as _)).ok() };
    }
    // SAFETY: this thread's window, whose procedure gets the message.
    unsafe {
        match timeout {
            Some(timeout) => drop(SetTimer(
                Some(window()),
                TIMER_ID,
                milliseconds(timeout),
                None,
            )),
            None => drop(KillTimer(Some(window()), TIMER_ID)),
        }
    }
}

fn milliseconds(timeout: Duration) -> u32 {
    timeout
        .as_micros()
        .div_ceil(1000)
        .min(u128::from(INFINITE - 1)) as u32
}

pub fn wait(
    platform: Option<&dyn Platform>,
    source: Option<isize>,
    timeout: &mut dyn FnMut() -> Option<Duration>,
) -> bool {
    const MAX_MESSAGES: usize = 64;
    let timeout = timeout();
    arm(source, timeout);
    let mut message = MSG::default();
    // SAFETY: `message` is written before it is read.
    unsafe {
        MsgWaitForMultipleObjectsEx(
            None,
            timeout.map_or(INFINITE, milliseconds),
            QS_ALLINPUT,
            MWMO_INPUTAVAILABLE,
        );
        for _ in 0..MAX_MESSAGES {
            if !PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                break;
            }
            match platform {
                _ if message.hwnd == window() => {}
                Some(platform) => platform.dispatch_message((&raw const message).cast()),
                None => drop(DispatchMessageW(&message)),
            }
        }
    }
    IS_READY.swap(false, Ordering::SeqCst)
}

pub fn wait_for_events(_: Option<isize>, _: Option<Duration>) {}
