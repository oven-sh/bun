//! Heap-image (snapshot) process state: are we building an image, and which restore epoch are we in.
use core::sync::atomic::{AtomicU32, Ordering};

// One epoch for the whole process (Rust, C++ and vendored C): the exported `bun_image_epoch` symbol, defined here.
#[unsafe(no_mangle)]
pub static bun_image_epoch: AtomicU32 = AtomicU32::new(0);
static BUILDING: AtomicU32 = AtomicU32::new(0);

/// 0 in a normally booted process; bumped each time this process resumed from an image.
#[inline]
pub fn epoch() -> u32 {
    bun_image_epoch.load(Ordering::Acquire)
}
#[inline]
pub fn restored() -> bool {
    epoch() != 0
}
/// Called once per restore (the C++ restore sequence has already bumped `bun_image_epoch`).
pub fn did_restore() {
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

/// A lazily computed value derived from this process's launch context (argv, environment, cwd, uid, terminal…).
/// It is recomputed after a heap-image restore: the value in the image belongs to the process that built it.
/// Use this — not `Once`/`OnceLock`/`static mut` — for anything read from the OS at startup and cached.
pub struct ProcessDerived<T: 'static> {
    epoch_plus_one: AtomicU32,
    lock: std::sync::Mutex<()>,
    ptr: core::sync::atomic::AtomicPtr<T>,
}
impl<T: 'static> ProcessDerived<T> {
    pub const fn new() -> Self {
        Self {
            epoch_plus_one: AtomicU32::new(0),
            lock: std::sync::Mutex::new(()),
            ptr: core::sync::atomic::AtomicPtr::new(core::ptr::null_mut()),
        }
    }
    /// The value for the current process; `init` runs on first use and again on first use after each restore.
    /// Previous values are leaked, never dropped (references handed out earlier stay valid).
    pub fn get(&'static self, init: impl FnOnce() -> T) -> &'static T {
        let want = epoch() + 1;
        if self.epoch_plus_one.load(Ordering::Acquire) != want {
            let _g = self.lock.lock().unwrap_or_else(|e| e.into_inner());
            if self.epoch_plus_one.load(Ordering::Acquire) != want {
                self.ptr
                    .store(Box::leak(Box::new(init())), Ordering::Release);
                self.epoch_plus_one.store(want, Ordering::Release);
            }
        }
        // SAFETY: non-null (stored above for this epoch) and leaked for the process lifetime.
        unsafe { &*self.ptr.load(Ordering::Acquire) }
    }
    /// True if a value has been computed for the current process.
    pub fn is_current(&self) -> bool {
        self.epoch_plus_one.load(Ordering::Acquire) == epoch() + 1
    }
}

static SNAPSHOT_REQUESTED: AtomicU32 = AtomicU32::new(0);
static SNAPSHOT_PATH: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);
/// Ask the main run loop to leave JS entirely and take the image at top level (caller then unwinds via a termination exception).
pub fn request_snapshot(path: &str) {
    *SNAPSHOT_PATH.lock().unwrap_or_else(|e| e.into_inner()) = Some(path.to_owned());
    SNAPSHOT_REQUESTED.store(1, Ordering::Release);
}
#[inline]
pub fn snapshot_requested() -> bool {
    SNAPSHOT_REQUESTED.load(Ordering::Acquire) != 0
}
pub fn take_snapshot_request() -> Option<String> {
    if SNAPSHOT_REQUESTED.swap(0, Ordering::AcqRel) == 0 {
        return None;
    }
    SNAPSHOT_PATH
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

static CANCEL_TIMERS: AtomicU32 = AtomicU32::new(0);
/// The app asked the runtime to drop every armed timer as part of taking the snapshot (its intervals re-arm themselves after restore).
pub fn set_cancel_timers_at_snapshot(on: bool) {
    CANCEL_TIMERS.store(on as u32, Ordering::Release);
}
pub fn cancel_timers_at_snapshot() -> bool {
    CANCEL_TIMERS.load(Ordering::Acquire) != 0
}

static KEEP_TIMERS: AtomicU32 = AtomicU32::new(0);
/// The app keeps its armed timers across the snapshot; their deadlines are re-based onto the restoring process's monotonic clock.
pub fn set_keep_timers_at_snapshot(on: bool) {
    KEEP_TIMERS.store(on as u32, Ordering::Release);
}
pub fn keep_timers_at_snapshot() -> bool {
    KEEP_TIMERS.load(Ordering::Acquire) != 0
}

/// Monotonic (sec, nsec) at the moment the image was frozen; lives in __DATA so the restored process can compute how far its own clock is from it.
pub static SNAPSHOT_MONOTONIC: [core::sync::atomic::AtomicI64; 2] = [
    core::sync::atomic::AtomicI64::new(0),
    core::sync::atomic::AtomicI64::new(0),
];
