//! GPUI as a guest of Bun's event loop.

#[cfg_attr(target_os = "macos", path = "host/macos.rs")]
#[cfg_attr(target_os = "windows", path = "host/windows.rs")]
#[cfg_attr(
    not(any(target_os = "macos", target_os = "windows")),
    path = "host/linux.rs"
)]
mod platform;
pub mod thread;
#[cfg(unix)]
mod unix;

use std::cell::{Cell, OnceCell, RefCell};
use std::rc::Rc;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use anyhow::{Context as _, Result, ensure};
use gpui::embed::{Painter, RawKey};
use gpui::{
    AnyWindowHandle, App, AppContext as _, ApplicationHandle, AsyncApp, DispatchEventResult,
    Platform, PlatformInput, Window, WindowId, accesskit,
};

use crate::{accessibility, app, bridge, input, native, surface, window};

struct Running {
    handle: ApplicationHandle,
    app: AsyncApp,
    platform: Rc<dyn Platform>,
}

const FOR_RESIZE: Duration = Duration::from_millis(100);

type DeferredFrame = (WindowId, Box<dyn FnOnce()>);

thread_local! {
    /// Never dropped: the process exits with the display's connection open.
    static RUNNING: OnceCell<&'static Running> = const { OnceCell::new() };
    static TICK: Cell<Option<extern "C" fn()>> = const { Cell::new(None) };
    /// The event loop is waiting in `pump`, and neither it nor JavaScript is in the middle of something.
    static CAN_TICK: Cell<bool> = const { Cell::new(false) };
    static DID_TICK: Cell<bool> = const { Cell::new(false) };
    static LAST_PUMP: Cell<Option<Instant>> = const { Cell::new(None) };
    static DEFERRED_FRAMES: RefCell<Vec<DeferredFrame>> = RefCell::default();
    static DEFERRED_SINCE: Cell<Option<Instant>> = const { Cell::new(None) };
    /// What `bridge::taken` was when JavaScript last finished with its events.
    static HANDLED: Cell<[u32; 2]> = const { Cell::new([0; 2]) };
    /// JavaScript was not done with the last frame when this one began.
    static WAS_LATE: Cell<bool> = const { Cell::new(false) };
    static IS_IN_FRAME: Cell<bool> = const { Cell::new(false) };
    static IS_URGENT: Cell<bool> = const { Cell::new(false) };
}

fn running() -> Option<&'static Running> {
    RUNNING.with(|running| running.get().copied())
}

static INTERVAL: AtomicU32 = AtomicU32::new(16_667);

/// Between two frames of the display that was drawn for last.
pub fn interval() -> Duration {
    Duration::from_micros(INTERVAL.load(Ordering::Relaxed).into())
}

pub fn set_interval(interval: Duration) {
    INTERVAL.store(
        (interval.as_micros() as u32).clamp(2_000, 50_000),
        Ordering::Relaxed,
    );
}

pub fn init(has_main_thread: bool) {
    platform::init();
    match has_main_thread {
        true => thread::expect(),
        false => thread::spawn(run_ui_thread),
    }
}

pub fn set_tick(tick: extern "C" fn()) {
    TICK.set(Some(tick));
}

pub fn run_main_thread() -> ! {
    run_ui_thread();
    unreachable!()
}

/// For an event that was queued.
pub fn wake() {
    // This thread looks at the queue before it waits.
    if TICK.get().is_none() {
        platform::wake();
    }
}

struct Hooks;

impl gpui::embed::Host for Hooks {
    fn raw_key(&self, key: RawKey) {
        input::raw_key(key);
    }

    fn input(&self, window: WindowId, event: &PlatformInput) -> Option<DispatchEventResult> {
        input::handle(&*window::state_for(window)?, event)
    }

    fn before_frame(&self, window: WindowId) {
        let was_deferred = thread::exists() && native::paints_pixels();
        if platform::IS_REENTRANT
            && !was_deferred
            && let Some(state) = window::state_for(window)
        {
            surface::begin_frame(&state);
            IS_IN_FRAME.set(true);
            if !IS_URGENT.take() || !thread::exists() {
                deliver_events(interval() / 2);
            }
            IS_IN_FRAME.set(false);
        }
    }

    fn defer_frame(&self, window: WindowId, frame: Box<dyn FnOnce()>) {
        if let Some(state) = window::state_for(window) {
            WAS_LATE.set(HANDLED.get() != bridge::emitted());
            surface::begin_frame(&state);
        }
        DEFERRED_FRAMES.with_borrow_mut(|frames| frames.push((window, frame)));
        DEFERRED_SINCE.set(DEFERRED_SINCE.get().or_else(|| Some(Instant::now())));
    }

    fn a11y_action(&self, request: &accesskit::ActionRequest) {
        accessibility::perform(request);
    }

    fn paints_pixels(&self) -> bool {
        native::paints_pixels()
    }

    fn has_time_to_paint(&self) -> bool {
        thread::exists()
    }

    fn painter(&self, window: WindowId) -> Option<Painter> {
        window::painter(window)
    }

    #[cfg(target_os = "macos")]
    fn present(&self, window: WindowId, layer: *mut std::ffi::c_void) {
        // SAFETY: the layer of a view that is alive.
        if let Some(layer) = unsafe { objc2::rc::Retained::retain(layer.cast()) } {
            window::layers::present(window, layer);
        }
    }

    #[cfg(target_os = "macos")]
    fn accepts_first_mouse(&self, window: WindowId, position: gpui::Point<gpui::Pixels>) -> bool {
        window::state_for(window).is_none_or(|state| input::accepts_first_mouse(&state, position))
    }

    #[cfg(target_os = "macos")]
    fn before_resized_frame(&self, window: WindowId) {
        let Some(state) =
            window::state_for(window).filter(|it| it.is_shown() && it.cover.get().is_none())
        else {
            return;
        };
        let deadline = Instant::now() + FOR_RESIZE / 2;
        IS_IN_FRAME.set(true);
        deliver_events(FOR_RESIZE / 2);
        surface::begin_frames_at_once(&state);
        deliver_events(deadline.saturating_duration_since(Instant::now()));
        IS_IN_FRAME.set(false);
    }
}

pub fn is_started() -> bool {
    running().is_some()
}

pub fn start(platform: Rc<dyn Platform>, run: impl FnOnce() -> ApplicationHandle) {
    gpui::embed::set_host(Rc::new(Hooks));
    let handle = run();
    log::info!("launched");
    platform::started(&*platform);
    let running = Box::leak(Box::new(Running {
        app: handle.to_async(),
        handle,
        platform,
    }));
    RUNNING.with(|cell| cell.set(running).ok());
}

pub fn update<R>(f: impl FnOnce(&mut App) -> R) -> Result<R> {
    let running = running().context("the UI has not been started")?;
    ensure!(!running.handle.is_borrowed(), "the UI is busy");
    Ok(running.app.update(f))
}

pub fn update_window<R>(
    window: AnyWindowHandle,
    f: impl FnOnce(&mut Window, &mut App) -> R,
) -> Result<R> {
    let mut app = running()
        .context("the UI has not been started")?
        .app
        .clone();
    app.update_window(window, |_, window, cx| f(window, cx))
}

/// Gives the clipboard's contents to whoever keeps them once this process is gone.
pub fn hand_over_clipboard() {
    if let Some(running) =
        running().filter(|_| cfg!(any(target_os = "linux", target_os = "freebsd")))
    {
        running.platform.quit();
    }
}

pub fn forget_frames(window: WindowId) {
    let frames = DEFERRED_FRAMES.take();
    DEFERRED_FRAMES.set(frames.into_iter().filter(|(id, _)| *id != window).collect());
}

fn can_tick() -> bool {
    CAN_TICK.get() && running().is_some_and(|running| !running.handle.is_borrowed())
}

#[cfg(target_os = "macos")]
pub use platform::{leave_next_event, post_empty_event, run_when_idle};

/// Runs JavaScript from inside of a callback of the platform, if that is possible.
fn tick() {
    if !can_tick() {
        return;
    }
    CAN_TICK.set(false);
    if let Some(tick) = TICK.get() {
        tick();
    }
    CAN_TICK.set(true);
    DID_TICK.set(true);
}

/// For a callback whose result depends on what JavaScript does.
pub fn deliver_events(patience: Duration) {
    if !platform::IS_REENTRANT {
        return;
    }
    if !thread::exists() {
        if bridge::has_events() {
            tick();
        }
        return;
    }
    if patience.is_zero()
        || thread::is_answering()
        || running().is_none_or(|running| running.handle.is_borrowed())
    {
        return;
    }
    let deadline = Instant::now() + patience;
    while HANDLED.get() != bridge::emitted() && thread::wait_for_jobs(deadline) {
        thread::run_jobs();
    }
}

pub fn events_were_handled() {
    let taken = bridge::taken();
    if thread::is_elsewhere() {
        if HANDLED.replace(taken) != taken {
            thread::post(move || HANDLED.set(taken));
        }
    } else if taken == bridge::emitted()
        || DEFERRED_SINCE
            .get()
            .is_some_and(|since| since.elapsed() > FOR_RESIZE)
    {
        present();
    }
}

fn present() {
    DEFERRED_SINCE.set(None);
    IS_URGENT.set(false);
    for (_, frame) in DEFERRED_FRAMES.take() {
        frame();
    }
}

pub fn is_about_to_draw(window: WindowId) -> bool {
    IS_IN_FRAME.get()
        || DEFERRED_FRAMES.with_borrow(|frames| frames.iter().any(|(id, _)| *id == window))
}

/// The frame that begins does not wait for JavaScript.
pub fn present_at_once() {
    IS_URGENT.set(true);
}

/// When the UI thread stops waiting for what JavaScript paints.
fn presentation_deadline() -> Option<Instant> {
    let (since, [frames, resizes], emitted) =
        (DEFERRED_SINCE.get()?, HANDLED.get(), bridge::emitted());
    if resizes != emitted[1] {
        Some(since + FOR_RESIZE)
    } else if frames == emitted[0] || IS_URGENT.get() {
        Some(since)
    } else {
        window::any_is_stale().then(|| {
            if WAS_LATE.get() {
                since
            } else {
                since + interval() / 2
            }
        })
    }
}

fn next_deadline() -> Option<Instant> {
    let deadlines = surface::next_deadline()
        .into_iter()
        .chain(window::next_redraw());
    #[cfg(target_os = "macos")]
    let deadlines = deadlines
        .chain(window::layers::next_release())
        .chain(crate::menu::next_change());
    deadlines.min()
}

fn run_what_is_due() {
    surface::begin_overdue_frames();
    window::redraw_what_is_due();
    #[cfg(target_os = "macos")]
    {
        window::layers::release_what_is_due();
        crate::menu::change_what_is_due();
    }
}

fn time_until_next_turn() -> Option<Duration> {
    let until = presentation_deadline()
        .into_iter()
        .chain(next_deadline())
        .min();
    let timeout = until.map(|until| until.saturating_duration_since(Instant::now()));
    if thread::has_jobs() {
        Some(Duration::ZERO)
    } else {
        timeout
    }
}

/// What the UI thread does whenever the platform is done.
fn turn() {
    input::flush_raw_key();
    thread::run_jobs();
    if app::is_exiting() {
        thread::stop();
    }
    run_what_is_due();
    if presentation_deadline().is_some_and(|deadline| deadline <= Instant::now()) {
        present();
    }
}

fn run_ui_thread() {
    loop {
        crate::guard("fatal", (), || {
            platform::wait(
                running().map(|running| &*running.platform),
                None,
                &mut time_until_next_turn,
            );
            turn();
        });
    }
}

fn has_work() -> bool {
    bridge::has_events()
        || DID_TICK.get()
        || DEFERRED_FRAMES.with_borrow(|frames| !frames.is_empty())
}

pub fn has_input() -> bool {
    bridge::has_events_but_frames() || thread::has_calls()
}

pub fn pump(source: isize, timeout_ns: i64, from_tick: bool) -> bool {
    // An event loop that is busy asks after every task.
    const MIN_INTERVAL: Duration = Duration::from_millis(1);
    let (start, source) = (Instant::now(), Some(source).filter(|source| *source != -1));
    if thread::is_elsewhere() {
        if timeout_ns != 0 && !bridge::has_events() && !thread::has_calls() {
            platform::wait_for_events(
                source,
                u64::try_from(timeout_ns).ok().map(Duration::from_nanos),
            );
        }
        return bridge::has_events() || thread::has_calls();
    }
    let deadline = u64::try_from(timeout_ns)
        .ok()
        .map(|timeout| start + Duration::from_nanos(timeout));
    let timeout = || {
        let until = deadline.into_iter().chain(next_deadline()).min();
        until.map(|until| until.saturating_duration_since(Instant::now()))
    };
    if from_tick {
        run_what_is_due();
        platform::arm(
            source,
            if bridge::has_events() {
                Some(Duration::ZERO)
            } else {
                timeout()
            },
        );
        return bridge::has_events();
    }
    if timeout_ns == 0
        && LAST_PUMP
            .get()
            .is_some_and(|last| start - last < MIN_INTERVAL)
    {
        return bridge::has_events();
    }
    let could_tick = CAN_TICK.replace(source.is_some());
    DID_TICK.set(false);
    loop {
        let mut timeout = || {
            if has_work() {
                Some(Duration::ZERO)
            } else {
                timeout()
            }
        };
        let is_ready = platform::wait(
            running().map(|running| &*running.platform),
            source,
            &mut timeout,
        );
        input::flush_raw_key();
        run_what_is_due();
        if bridge::has_events() && !IS_URGENT.get() {
            break;
        }
        present();
        if is_ready || has_work() || deadline.is_some_and(|deadline| Instant::now() >= deadline) {
            break;
        }
    }
    CAN_TICK.set(could_tick);
    LAST_PUMP.set(Some(Instant::now()));
    bridge::has_events()
}
