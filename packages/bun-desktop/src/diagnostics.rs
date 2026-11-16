//! `BUN_DESKTOP_LOG=1` prints what happens, and `BUN_DESKTOP_LOG=frames` every frame as well.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use crate::surface::milliseconds;

static LOGS_FRAMES: AtomicBool = AtomicBool::new(false);

struct Logger;

impl log::Log for Logger {
    fn enabled(&self, metadata: &log::Metadata) -> bool {
        metadata.level() <= log::Level::Warn
            || ["bun_desktop", "gpui"]
                .iter()
                .any(|it| metadata.target().starts_with(it))
    }

    fn log(&self, record: &log::Record) {
        if self.enabled(record.metadata()) {
            let (time, level, target) = (
                milliseconds(Instant::now()),
                record.level(),
                record.target(),
            );
            eprintln!("[desktop {time:9.2}] {level} {target}: {}", record.args());
        }
    }

    fn flush(&self) {}
}

pub fn init() {
    let Some(what) = std::env::var_os("BUN_DESKTOP_LOG").filter(|it| it != "0") else {
        return;
    };
    LOGS_FRAMES.store(what == "frames", Ordering::Relaxed);
    log::set_logger(&Logger).ok();
    log::set_max_level(log::LevelFilter::Info);
    std::panic::set_hook(Box::new(|panic| {
        log::error!("{panic}\n{}", std::backtrace::Backtrace::force_capture())
    }));
    log::info!(
        "loaded on {} {}",
        std::env::consts::OS,
        std::env::consts::ARCH
    );
}

pub fn logs_frames() -> bool {
    LOGS_FRAMES.load(Ordering::Relaxed)
}
