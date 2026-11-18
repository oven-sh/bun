//! The pace of the display.

use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use crate::host::{self, thread};
use crate::win32::*;

static IS_WANTED: AtomicBool = AtomicBool::new(false);
static HAS_TICKED: AtomicBool = AtomicBool::new(false);
static EVENT: AtomicIsize = AtomicIsize::new(0);
static INTERVAL: AtomicU32 = AtomicU32::new(16_667);

fn run() {
    const IDLE_TICKS: u32 = 4;
    thread::set_name(c"display");
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);
    let mut last = Instant::now();
    loop {
        WaitForSingleObject(EVENT.load(Ordering::Relaxed), INFINITE);
        // Or else the waits with a timeout are up to 16 ms late.
        timeBeginPeriod(1);
        let mut idle = 0;
        while idle < IDLE_TICKS {
            if wait_for_compositor_clock(0, 0, 100) == WAIT_FAILED {
                _ = DwmFlush();
            }
            // They do not wait while the display is off.
            let interval = Duration::from_micros(INTERVAL.load(Ordering::Relaxed).into());
            if last.elapsed() < interval / 4 {
                std::thread::sleep(interval.saturating_sub(last.elapsed()));
            }
            last = Instant::now();
            idle = if IS_WANTED.swap(false, Ordering::SeqCst) {
                0
            } else {
                idle + 1
            };
            if idle == 0 {
                HAS_TICKED.store(true, Ordering::SeqCst);
                host::system::wake_ui();
            }
        }
        timeEndPeriod(1);
    }
}

pub fn ask_for_tick(interval: Duration) {
    INTERVAL.store(interval.as_micros() as u32, Ordering::Relaxed);
    if EVENT.load(Ordering::Relaxed) == 0 {
        EVENT.store(CreateEventW(0, 0, 0, Str::NULL), Ordering::Relaxed);
        thread::detach(1 << 16, run);
    }
    if !IS_WANTED.swap(true, Ordering::SeqCst) {
        SetEvent(EVENT.load(Ordering::Relaxed));
    }
}

pub fn has_ticked() -> bool {
    HAS_TICKED.swap(false, Ordering::SeqCst)
}
