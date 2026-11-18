//! `BUN_DESKTOP_LOG=1` prints what happens, `BUN_DESKTOP_LOG=misses` which frames each scroll has missed, and
//! `BUN_DESKTOP_LOG=frames` every frame as well.

use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use crate::surface::milliseconds;

static LOGS: AtomicBool = AtomicBool::new(false);
static LOGS_FRAMES: AtomicBool = AtomicBool::new(false);
static LOGS_MISSES: AtomicBool = AtomicBool::new(false);

pub fn logs() -> bool {
    LOGS.load(Ordering::Relaxed)
}

#[cold]
pub fn print(module: &str, message: std::fmt::Arguments) {
    eprintln!(
        "[desktop {:9.2}] {module}: {message}",
        milliseconds(Instant::now())
    );
}

macro_rules! log {
    ($($format:tt)+) => {
        if $crate::diagnostics::logs() {
            $crate::diagnostics::print(module_path!(), format_args!($($format)+))
        }
    };
}

pub(crate) use log;

#[cfg(target_os = "macos")]
fn age_of_process() -> Option<std::time::Duration> {
    let size = size_of::<libc::proc_bsdinfo>() as i32;
    // SAFETY: integers and arrays of them, and `size` is its size.
    let info = unsafe {
        let mut info: libc::proc_bsdinfo = std::mem::zeroed();
        (libc::proc_pidinfo(
            libc::getpid(),
            libc::PROC_PIDTBSDINFO,
            0,
            (&raw mut info).cast(),
            size,
        ) == size)
            .then_some(info)?
    };
    let start = std::time::UNIX_EPOCH
        + std::time::Duration::new(info.pbi_start_tvsec, info.pbi_start_tvusec as u32 * 1000);
    start.elapsed().ok()
}

pub fn init() {
    let Some(what) = std::env::var_os("BUN_DESKTOP_LOG").filter(|it| it != "0") else {
        return;
    };
    LOGS_FRAMES.store(what == "frames", Ordering::Relaxed);
    LOGS_MISSES.store(what == "frames" || what == "misses", Ordering::Relaxed);
    LOGS.store(true, Ordering::Relaxed);
    std::panic::set_hook(Box::new(|panic| {
        log!("{panic}\n{}", std::backtrace::Backtrace::force_capture())
    }));
    log!(
        "loaded on {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
    #[cfg(target_os = "macos")]
    log!("the process started {:?} ago", age_of_process());
}

/// A step from an event to the pixels.
macro_rules! trace {
    ($($format:tt)+) => {
        if $crate::diagnostics::logs_frames() {
            $crate::diagnostics::log!($($format)+)
        }
    };
}

pub(crate) use trace;

#[derive(Clone, Copy)]
pub enum Step {
    Jobs,
    Flatten,
    Paint,
    #[cfg(target_os = "macos")]
    Commit,
}

#[derive(Clone, Copy)]
pub enum Incident {
    NothingMoved,
    CaughtUp,
    OffsetWasSet,
    WheelLeftToScript,
    #[cfg(any(test, target_os = "macos"))]
    NewSurface,
    #[cfg(any(test, target_os = "macos"))]
    PaintedByCpu,
}

/// The last one is for time that no `Step` took.
const STEPS: [&str; 5] = ["jobs", "flatten", "paint", "commit", "elsewhere"];
const INCIDENTS: [&str; 6] = [
    "nothing moved",
    "caught up",
    "offset was set",
    "wheel left to script",
    "new surface",
    "painted by the CPU",
];

#[derive(Default)]
struct Scroll {
    frames: u32,
    /// Of a frame that another one had to follow.
    began_at: Option<Instant>,
    /// Since then.
    spent: [Duration; 4],
    total: [Duration; 4],
    longest: [Duration; 4],
    missed: [u32; 5],
    slow: [u32; 5],
    incidents: [u32; 6],
    last_frame: Option<Instant>,
    /// How many moves came in each eighth of the time between two frames.
    phases: [u32; 8],
}

thread_local! {
    static SCROLL: RefCell<Scroll> = RefCell::default();
}

/// When each frame of a scroll was on the screen, and how long after it was painted, in seconds.
#[cfg(target_os = "macos")]
static SHOWN: std::sync::Mutex<Vec<[f64; 2]>> = std::sync::Mutex::new(Vec::new());

#[cfg(target_os = "macos")]
pub extern "C" fn was_shown(at: f64, delay: f64) {
    SHOWN.lock().iter_mut().for_each(|it| it.push([at, delay]));
}

#[cfg(target_os = "macos")]
fn print_what_was_shown(interval: Duration) {
    let mut all = SHOWN
        .lock()
        .map(|mut it| std::mem::take(&mut *it))
        .unwrap_or_default();
    if all.iter().any(|it| it[1] > 0.) {
        all.retain(|it| it[1] > 0.);
    }
    all.sort_by(|a, b| a[0].total_cmp(&b[0]));
    let frames = |[a, b]: &[[f64; 2]; 2]| ((b[0] - a[0]) / interval.as_secs_f64()).round() as u32;
    let uneven: Vec<_> = all
        .array_windows()
        .map(frames)
        .enumerate()
        .filter(|it| it.1 != 1)
        .collect();
    all.sort_by(|a, b| a[1].total_cmp(&b[1]));
    let delays = [0.02, 0.5, 0.98].map(|part| {
        all.get((all.len() as f64 * part) as usize)
            .map_or(0., |it| it[1] * 1000.)
    });
    log!(
        "shown {} times, {delays:.1?} ms after they were painted, and not for one frame: {uneven:?}",
        all.len()
    );
}

#[cfg(target_os = "macos")]
pub fn logs_misses() -> bool {
    LOGS_MISSES.load(Ordering::Relaxed)
}

pub fn measure<R>(step: Step, f: impl FnOnce() -> R) -> R {
    let start = LOGS_MISSES.load(Ordering::Relaxed).then(Instant::now);
    let result = f();
    if let Some(start) = start {
        SCROLL.with_borrow_mut(|it| it.spent[step as usize] += start.elapsed());
    }
    result
}

pub fn note(incident: Incident) {
    if LOGS_MISSES.load(Ordering::Relaxed) {
        SCROLL.with_borrow_mut(|it| it.incidents[incident as usize] += 1);
    }
}

pub fn fingers_moved(interval: Duration) {
    if LOGS_MISSES.load(Ordering::Relaxed) {
        SCROLL.with_borrow_mut(|it| {
            it.last_frame.iter().for_each(|last| {
                it.phases[((last.elapsed().div_duration_f64(interval) * 8.) as usize).min(7)] += 1
            })
        });
    }
}

pub fn frame_began(at: Instant, interval: Duration, is_scrolling: bool, is_followed: bool) {
    if !LOGS_MISSES.load(Ordering::Relaxed) {
        return;
    }
    SCROLL.with_borrow_mut(|it| {
        let spent = std::mem::take(&mut it.spent);
        it.last_frame = Some(at);
        if let Some(gap) =
            std::mem::replace(&mut it.began_at, is_followed.then_some(at)).map(|last| at - last)
        {
            let (busy, worst) = (
                spent.iter().sum::<Duration>(),
                (0..4).max_by_key(|step| spent[*step]).unwrap_or(0),
            );
            let missed = (gap.div_duration_f64(interval) - 0.5) as u32;
            it.frames += 1;
            it.missed[if busy > interval / 2 { worst } else { 4 }] += missed;
            it.slow[worst] += u32::from(missed == 0 && busy > interval / 2);
            for (step, spent) in spent.into_iter().enumerate() {
                (it.total[step], it.longest[step]) =
                    (it.total[step] + spent, it.longest[step].max(spent));
            }
            if missed > 0 || busy > interval / 2 {
                log!(
                    "{gap:.1?} between two frames, jobs, flatten, paint and commit took {spent:.1?}"
                );
            }
        }
        if !is_scrolling {
            let it = std::mem::take(it);
            let list = |names: &[&str], counts: &[u32]| {
                names
                    .iter()
                    .zip(counts)
                    .map(|(name, count)| format!(" {name} {count};"))
                    .collect::<String>()
            };
            if it.frames > 0 {
                log!(
                    "scrolled for {} frames of {interval:.1?}, missed:{} slow:{}",
                    it.frames,
                    list(&STEPS, &it.missed),
                    list(&STEPS, &it.slow)
                );
                log!(
                    "average {:.2?}, longest {:.1?},{} phases {:?}",
                    it.total.map(|total| total / it.frames),
                    it.longest,
                    list(&INCIDENTS, &it.incidents),
                    it.phases
                );
                #[cfg(target_os = "macos")]
                print_what_was_shown(interval);
            }
        }
    });
}

pub fn logs_frames() -> bool {
    LOGS_FRAMES.load(Ordering::Relaxed)
}
