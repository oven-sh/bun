//! Menus, drags and the frames of windows run loops of their own, so whatever the UI thread has to notice is a message.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::ffi::c_void;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::time::Duration;

use crate::platform::{Platform, windows};
use crate::win32::*;

pub const IS_REENTRANT: bool = true;
pub const RUNS_ON_ANY_THREAD: bool = true;

const WAKE: u32 = WM_APP;
const LATER: u32 = WM_APP + 1;

static WINDOW: AtomicIsize = AtomicIsize::new(0);
static IS_WOKEN: AtomicBool = AtomicBool::new(false);
static TIMER: AtomicIsize = AtomicIsize::new(0);
/// What JavaScript waits for, once it has.
static PORT: AtomicIsize = AtomicIsize::new(0);
static EVENT: AtomicIsize = AtomicIsize::new(0);

thread_local! {
    /// How many callbacks of the system are running, and whether `turn` is below them.
    static DEPTH: Cell<u32> = const { Cell::new(0) };
    static IS_TURNING: Cell<bool> = const { Cell::new(true) };
    static POSTPONED: RefCell<VecDeque<Box<dyn FnOnce()>>> = RefCell::default();
}

pub fn init() {
    EVENT.store(CreateEventW(0, 0, 0, Str::NULL), Ordering::Relaxed);
}

pub fn started() {}

pub fn wake() {
    SetEvent(EVENT.load(Ordering::Relaxed));
    let port = PORT.load(Ordering::SeqCst);
    if port != 0 {
        // SAFETY: the event loop skips what has no request.
        unsafe { PostQueuedCompletionStatus(port, 0, 0, std::ptr::null_mut()) };
    }
}

pub fn wake_ui() {
    if !IS_WOKEN.swap(true, Ordering::SeqCst) {
        PostMessageW(WINDOW.load(Ordering::SeqCst), WAKE, 0, 0);
    }
}

pub fn arm(_: Option<isize>, timeout: Option<Duration>) {
    match timeout {
        Some(Duration::ZERO) => wake_ui(),
        Some(timeout) => {
            _ = SetWaitableTimer(
                TIMER.load(Ordering::Relaxed),
                &-((timeout.as_nanos() / 100) as i64 + 1),
                0,
                0,
                0,
                0,
            )
        }
        None => _ = CancelWaitableTimer(TIMER.load(Ordering::Relaxed)),
    }
}

/// For what runs a loop: not in the middle of something else, and without JavaScript waiting for it.
pub fn later(work: impl FnOnce() + 'static) {
    POSTPONED.with_borrow_mut(|it| it.push_back(Box::new(work)));
    PostMessageW(window(), LATER, 0, 0);
}

/// Around a callback of the system.
pub fn callback<R>(otherwise: R, work: impl FnOnce() -> R) -> R {
    DEPTH.set(DEPTH.get() + 1);
    let result = crate::guard("error", otherwise, work);
    DEPTH.set(DEPTH.get() - 1);
    // It may be from another loop than the one in `wait`.
    if DEPTH.get() > 0 && !IS_TURNING.get() {
        wake_ui();
    }
    result
}

fn turn_in_another_loop() {
    if !IS_TURNING.replace(true) {
        crate::guard("fatal", (), || {
            windows::begin_frames();
            super::turn();
            windows::before_waiting();
            arm(None, super::time_until_next_turn());
        });
        IS_TURNING.set(false);
    }
}

unsafe extern "system" fn handle(window: Handle, message: u32, w: usize, l: isize) -> isize {
    match message {
        WAKE => {
            IS_WOKEN.store(false, Ordering::SeqCst);
            turn_in_another_loop();
        }
        // Nothing could wake this thread without it.
        WM_CLOSE => {}
        // `wait` sees to it.
        LATER if IS_TURNING.get() => {}
        LATER => POSTPONED
            .with_borrow_mut(VecDeque::pop_front)
            .into_iter()
            .for_each(|work| callback((), work)),
        _ => {
            let answer = callback(None, || windows::system_message(message, w, l));
            // SAFETY: as it came.
            return answer.unwrap_or_else(|| unsafe { DefWindowProcW(window, message, w, l) });
        }
    }
    0
}

/// It is never shown, and gets what the system tells the app.
pub fn window() -> Handle {
    unsafe extern "system" fn time_is_up(_: *mut c_void, _: u8) {
        wake_ui();
    }
    if WINDOW.load(Ordering::Relaxed) == 0 {
        super::thread::is_needed_for_frames();
        SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
        let timer = CreateWaitableTimerExW(
            0,
            Str::NULL,
            CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
            TIMER_ALL_ACCESS,
        );
        TIMER.store(timer, Ordering::Relaxed);
        // SAFETY: it needs no context.
        unsafe {
            RegisterWaitForSingleObject(
                &mut 0,
                timer,
                time_is_up,
                std::ptr::null_mut(),
                INFINITE,
                WT_EXECUTEINWAITTHREAD,
            )
        };
        let (class, size) = (wide!("BunDesktopApp"), size_of::<WndClassExW>() as u32);
        RegisterClassExW(&WndClassExW {
            cb_size: size,
            lpfn_wnd_proc: Some(handle),
            h_instance: module(),
            lpsz_class_name: class,
            ..Default::default()
        });
        WINDOW.store(
            CreateWindowExW(
                WS_EX_TOOLWINDOW,
                class,
                Str::NULL,
                WS_POPUP,
                0,
                0,
                0,
                0,
                0,
                0,
                module(),
                0,
            ),
            Ordering::SeqCst,
        );
        IS_WOKEN.store(false, Ordering::SeqCst);
    }
    WINDOW.load(Ordering::Relaxed)
}

pub fn wait(
    _: Option<&dyn Platform>,
    _: Option<isize>,
    timeout: &mut dyn FnMut() -> Option<Duration>,
) -> bool {
    const AT_A_TIME: usize = 64;
    let (own, mut message) = (window(), Msg::default());
    windows::before_waiting();
    arm(None, timeout());
    IS_TURNING.set(false);
    while let Some(work) = POSTPONED.with_borrow_mut(VecDeque::pop_front) {
        callback((), work);
        wake_ui();
    }
    if PeekMessageW(&mut message, 0, 0, 0, PM_NOREMOVE) == 0 {
        WaitMessage();
    }
    let mut was_woken = false;
    for _ in 0..AT_A_TIME {
        if PeekMessageW(&mut message, 0, 0, 0, PM_REMOVE) == 0 {
            break;
        }
        // There is no other until the input is handled, which comes after what is posted.
        if (message.hwnd, message.message) == (own, WAKE) {
            was_woken = true;
            continue;
        }
        if was_woken && windows::may_run_loop(&message) {
            was_woken = false;
            IS_WOKEN.store(false, Ordering::SeqCst);
            wake_ui();
        }
        TranslateMessage(&message);
        // SAFETY: as it came.
        unsafe { DispatchMessageW(&message) };
    }
    IS_TURNING.set(true);
    if was_woken {
        IS_WOKEN.store(false, Ordering::SeqCst);
    }
    windows::begin_frames();
    false
}

/// On the thread that runs JavaScript.
pub fn wait_for_events(source: Option<isize>, timeout: Option<Duration>) {
    let milliseconds = timeout.map_or(INFINITE, |it| {
        it.as_micros().div_ceil(1000).min(u128::from(INFINITE - 1)) as u32
    });
    let Some(port) = source else {
        WaitForSingleObject(EVENT.load(Ordering::Relaxed), milliseconds);
        return;
    };
    if PORT.swap(port, Ordering::SeqCst) != port {
        return;
    }
    let (mut entries, mut count, mut patience, mut more) = (
        [OverlappedEntry::default(); 16],
        0,
        milliseconds,
        Vec::new(),
    );
    // SAFETY: the array with its length. What is taken goes back, in the same order.
    unsafe {
        while GetQueuedCompletionStatusEx(
            port,
            entries.as_mut_ptr(),
            entries.len() as u32,
            &mut count,
            patience,
            0,
        ) != 0
            && count as usize == entries.len()
        {
            more.extend(entries);
            (count, patience) = (0, 0);
        }
        for it in more
            .iter()
            .chain(&entries[..count as usize])
            .filter(|it| !it.lp_overlapped.is_null())
        {
            PostQueuedCompletionStatus(
                port,
                it.dw_number_of_bytes_transferred,
                it.lp_completion_key,
                it.lp_overlapped,
            );
        }
    }
}
