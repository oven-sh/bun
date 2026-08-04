//! Heap-image (snapshot) process state: are we building an image, and which restore epoch are we in.
use core::sync::atomic::{AtomicU32, Ordering};

static EPOCH: AtomicU32 = AtomicU32::new(0);
static BUILDING: AtomicU32 = AtomicU32::new(0);

/// 0 in a normally booted process; bumped each time this process resumed from an image.
#[inline]
pub fn epoch() -> u32 {
    EPOCH.load(Ordering::Acquire)
}
#[inline]
pub fn restored() -> bool {
    epoch() != 0
}
pub fn did_restore() {
    EPOCH.fetch_add(1, Ordering::AcqRel);
    BUILDING.store(0, Ordering::Release);
}
/// True while this process is producing an image: OS resources created now will not exist when the image runs.
#[inline]
pub fn building() -> bool {
    BUILDING.load(Ordering::Acquire) != 0
}
pub fn set_building(on: bool) {
    BUILDING.store(on as u32, Ordering::Release);
}

/// A `Once` whose "done" state belongs to a process epoch: work that created OS state (threads, fds, ports) re-runs after an image restore.
pub struct ImageOnce {
    done_epoch: AtomicU32, // epoch+1 in which it last ran; 0 = never
    lock: std::sync::Mutex<()>,
}
impl ImageOnce {
    pub const fn new() -> Self {
        Self {
            done_epoch: AtomicU32::new(0),
            lock: std::sync::Mutex::new(()),
        }
    }
    #[inline]
    pub fn is_done(&self) -> bool {
        self.done_epoch.load(Ordering::Acquire) == epoch() + 1
    }
    pub fn call(&self, f: impl FnOnce()) {
        if self.is_done() {
            return;
        }
        let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
        if self.is_done() {
            return;
        }
        f();
        self.done_epoch.store(epoch() + 1, Ordering::Release);
    }
}
