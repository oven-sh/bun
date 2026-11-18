//! The window system as a guest of Bun's event loop.

pub mod alarm;
#[cfg_attr(target_os = "macos", path = "host/macos.rs")]
#[cfg_attr(not(target_os = "macos"), path = "host/linux.rs")]
mod system;
pub mod thread;
mod unix;

use std::cell::{Cell, OnceCell, RefCell};
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use crate::diagnostics::{self, Step};
use crate::error::{Context as _, Result};
use crate::platform::Platform;
use crate::remote::{guest, pages};
use crate::{app, bridge, canvas, input, surface, window};

const FOR_RESIZE: Duration = Duration::from_millis(100);

thread_local! {
    /// Never dropped: the process exits with the display's connection open.
    static PLATFORM: OnceCell<&'static dyn Platform> = const { OnceCell::new() };
    static TICK: Cell<Option<extern "C" fn()>> = const { Cell::new(None) };
    /// The event loop is waiting in `pump`, and neither it nor JavaScript is in the middle of something.
    static CAN_TICK: Cell<bool> = const { Cell::new(false) };
    static DID_TICK: Cell<bool> = const { Cell::new(false) };
    static LAST_PUMP: Cell<Option<Instant>> = const { Cell::new(None) };
    static DEFERRED_FRAMES: RefCell<Vec<u32>> = RefCell::default();
    static DEFERRED_SINCE: Cell<Option<Instant>> = const { Cell::new(None) };
    /// What `bridge::taken` was when JavaScript last finished with its events.
    static HANDLED: Cell<[u32; 3]> = const { Cell::new([0; 3]) };
    /// JavaScript was not done with the last frame when this one began.
    static WAS_LATE: Cell<bool> = const { Cell::new(false) };
    static IS_IN_FRAME: Cell<bool> = const { Cell::new(false) };
    static IS_URGENT: Cell<bool> = const { Cell::new(false) };
}

pub fn platform() -> Result<&'static dyn Platform> {
    PLATFORM
        .with(|platform| platform.get().copied())
        .context("the UI has not been started")
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
    system::init();
    match has_main_thread {
        true => thread::expect(),
        false => thread::spawn(|| {
            thread::set_name(c"UI");
            thread::enter();
            if guest::is_on() {
                thread::only_run_jobs()
            } else {
                run_ui_thread()
            }
        }),
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
        system::wake();
    }
}

pub fn frame_is_due(window: u32) {
    let Ok(state) = window::state(window) else {
        return;
    };
    crate::diagnostics::trace!("frame of window {window}");
    if system::IS_REENTRANT && !thread::exists() {
        IS_IN_FRAME.set(true);
        surface::begin_frame(&state);
        IS_URGENT.set(false);
        deliver_events(Duration::ZERO);
        IS_IN_FRAME.set(false);
        return window::draw_if_stale(window);
    }
    pages::forgive(FOR_RESIZE);
    WAS_LATE.set(is_handled() != [true; 3]);
    if !is_about_to_draw(window) {
        DEFERRED_FRAMES.with_borrow_mut(|frames| frames.push(window));
    }
    surface::begin_frame(&state);
    DEFERRED_SINCE.set(DEFERRED_SINCE.get().or_else(|| Some(Instant::now())));
    #[cfg(target_os = "macos")]
    if presentation_deadline().is_some_and(|deadline| deadline <= Instant::now()) {
        present();
        window::layers::flush();
    }
}

/// For a frame that the platform has not asked for yet.
pub fn wait_for_frame(window: u32, since: Instant) {
    if !is_about_to_draw(window) {
        DEFERRED_FRAMES.with_borrow_mut(|frames| frames.push(window));
    }
    DEFERRED_SINCE.set(DEFERRED_SINCE.get().or(Some(since)));
}

/// The window has another size, and shows what is drawn next together with that.
#[cfg(target_os = "macos")]
pub fn before_resized_frame(window: u32) {
    let Some(state) = window::state(window)
        .ok()
        .filter(|it| it.is_shown() && it.cover.get().is_none())
    else {
        return;
    };
    if IS_IN_FRAME.replace(true) {
        return;
    }
    let deadline = Instant::now() + FOR_RESIZE / 2;
    crate::guard("error", (), || {
        deliver_events(FOR_RESIZE / 2);
        surface::begin_frames_at_once(&state);
        deliver_events(deadline.saturating_duration_since(Instant::now()));
    });
    IS_IN_FRAME.set(false);
}

pub fn start(platform: Box<dyn Platform>) {
    crate::diagnostics::log!("launched");
    system::started();
    PLATFORM.with(|cell| cell.set(Box::leak(platform)).ok());
}

pub fn forget_frames(window: u32) {
    DEFERRED_FRAMES.with_borrow_mut(|frames| frames.retain(|id| *id != window));
}

/// Runs JavaScript from inside of a callback of the platform, if that is possible.
fn tick() {
    if !CAN_TICK.get() {
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
    if !system::IS_REENTRANT {
        return;
    }
    if !thread::exists() {
        if bridge::has_events() {
            tick();
        }
        return;
    }
    if patience.is_zero() || thread::is_answering() {
        return;
    }
    let deadline = Instant::now() + patience;
    while is_handled() != [true; 3] && thread::wait_for_jobs(deadline) {
        thread::run_jobs();
    }
}

/// Frames, sizes and bounds.
fn is_handled() -> [bool; 3] {
    let (handled, emitted, [frames, sizes]) = (HANDLED.get(), bridge::emitted(), pages::owed());
    [0, 1, 2].map(|it| handled[it] == emitted[it] && [frames, sizes, 0][it] == 0)
}

pub fn events_were_handled() {
    if guest::is_on() {
        return guest::events_were_handled();
    }
    let taken = bridge::taken();
    if thread::is_elsewhere() {
        if HANDLED.replace(taken) != taken {
            thread::post(move || HANDLED.set(taken));
        }
        thread::release_jobs();
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
    DEFERRED_FRAMES
        .take()
        .into_iter()
        .for_each(window::draw_if_stale);
}

pub fn is_about_to_draw(window: u32) -> bool {
    IS_IN_FRAME.get() || DEFERRED_FRAMES.with_borrow(|frames| frames.contains(&window))
}

/// The frame that begins does not wait for JavaScript.
pub fn present_at_once() {
    IS_URGENT.set(true);
}

/// When the UI thread stops waiting for what JavaScript paints.
fn presentation_deadline() -> Option<Instant> {
    let (since, [frames, resizes, _]) = (DEFERRED_SINCE.get()?, is_handled());
    if !resizes {
        Some(since + FOR_RESIZE)
    } else if frames || IS_URGENT.get() {
        Some(since)
    } else {
        window::any_is_stale().then(|| {
            if WAS_LATE.get() {
                since
            } else {
                since + interval() / if cfg!(target_os = "macos") { 3 } else { 2 }
            }
        })
    }
}

fn next_deadline() -> Option<Instant> {
    let deadlines = surface::next_deadline()
        .into_iter()
        .chain(window::next_redraw())
        .chain(canvas::next_chore());
    #[cfg(target_os = "macos")]
    let deadlines = deadlines.chain(window::layers::next_chore());
    deadlines.min()
}

fn run_what_is_due() {
    surface::begin_overdue_frames();
    window::redraw_what_is_due();
    canvas::do_chores();
    #[cfg(target_os = "macos")]
    window::layers::do_chores();
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
    diagnostics::measure(Step::Jobs, thread::run_jobs);
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
            system::wait(platform().ok(), None, &mut time_until_next_turn);
            turn();
        });
    }
}

fn has_work() -> bool {
    bridge::has_events()
        || DID_TICK.get()
        || DEFERRED_FRAMES.with_borrow(|frames| !frames.is_empty())
}

/// On the thread that runs JavaScript. Returns whether `other` is readable.
pub fn wait_for(source: Option<isize>, other: i32, timeout: Option<Duration>) -> bool {
    let mut others = vec![other];
    unix::poll(&unix::WAKE, source, &mut others, timeout);
    !others.is_empty()
}

pub fn has_input() -> bool {
    bridge::has_events_but_frames() || thread::has_calls()
}

pub fn pump(source: isize, timeout_ns: i64, from_tick: bool) -> bool {
    // An event loop that is busy asks after every task.
    const MIN_INTERVAL: Duration = Duration::from_millis(1);
    let (start, source) = (Instant::now(), Some(source).filter(|source| *source != -1));
    if guest::is_on() {
        return guest::pump(
            source,
            u64::try_from(timeout_ns).ok().map(Duration::from_nanos),
        );
    }
    if thread::is_elsewhere() {
        thread::release_jobs();
        if timeout_ns != 0 && !bridge::has_events() && !thread::has_calls() {
            system::wait_for_events(
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
        system::arm(
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
        let is_ready = system::wait(platform().ok(), source, &mut timeout);
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
