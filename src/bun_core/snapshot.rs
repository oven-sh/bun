//! Snapshot process state: are we building a snapshot, and which restore epoch are we in.
use core::sync::atomic::{AtomicU32, Ordering};

// One epoch for the whole process (Rust, C++ and vendored C): the exported `bun_snapshot_epoch` symbol, defined here.
#[unsafe(no_mangle)]
pub static bun_snapshot_epoch: AtomicU32 = AtomicU32::new(0);
static BUILDING: AtomicU32 = AtomicU32::new(0);

/// 0 in a normally booted process; bumped each time this process resumed from a snapshot.
#[inline]
pub fn epoch() -> u32 {
    bun_snapshot_epoch.load(Ordering::Acquire)
}
#[inline]
pub fn restored() -> bool {
    epoch() != 0
}
/// Called once per restore (the C++ restore sequence has already bumped `bun_snapshot_epoch`).
pub fn did_restore() {
    BUILDING.store(0, Ordering::Release);
}
/// True while this process is producing a snapshot: OS resources created now will not exist when the snapshot runs.
#[inline]
pub fn building() -> bool {
    BUILDING.load(Ordering::Acquire) != 0
}
pub fn set_building(on: bool) {
    BUILDING.store(on as u32, Ordering::Release);
}

/// A `Once` whose "done" state belongs to a process epoch: work that created OS state (threads, fds, ports) re-runs after a snapshot restore.
pub struct SnapshotOnce {
    done_epoch: AtomicU32, // epoch+1 in which it last ran; 0 = never
    lock: std::sync::Mutex<()>,
}
impl SnapshotOnce {
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

/// A cached value derived from the launch context (argv, env, cwd, uid, terminal…), recomputed after a restore; use it instead of `Once`/`OnceLock` for anything read from the OS and cached.
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
    /// The current process's value: `init` runs on first use after each restore; earlier values are leaked so references stay valid.
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

/// What the snapshot run may touch on the build machine (`--snapshot-io`); every allowed use is recorded and reported when the snapshot is written.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum IoPolicy {
    Strict,
    Local,
    /// BUN_SNAPSHOT_IO=network: the network too — its answers are frozen into every launch — still recorded and reported.
    Network,
}
pub fn io_policy() -> IoPolicy {
    match crate::env_var::BUN_SNAPSHOT_IO.get() {
        Some(b"local") => IoPolicy::Local,
        Some(b"network") => IoPolicy::Network,
        _ => IoPolicy::Strict,
    }
}
/// Whether the policy admits an operation of this class, which the gate then records.
pub fn io_allowed(kind: &str) -> bool {
    let local_class = matches!(kind, "node:fs" | "Bun.spawn" | "Bun.listen" | "dns");
    match io_policy() {
        IoPolicy::Strict => false,
        IoPolicy::Local => local_class,
        IoPolicy::Network => true,
    }
}

/// Local I/O performed while building, keyed by (kind, JS call site) -> count. Only ever touched on the JS thread of the builder.
static LOCAL_IO_AUDIT: std::sync::Mutex<Vec<(&'static str, Vec<u8>, u32)>> =
    std::sync::Mutex::new(Vec::new());
pub fn note_local_io(kind: &'static str, site: Vec<u8>) {
    let mut audit = LOCAL_IO_AUDIT.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(entry) = audit.iter_mut().find(|(k, s, _)| *k == kind && *s == site) {
        entry.2 += 1;
    } else {
        audit.push((kind, site, 1));
    }
}
static STDIO_NOTES: std::sync::Mutex<Vec<(i32, Vec<u8>)>> = std::sync::Mutex::new(Vec::new());
/// A `process.std*` stream was created during the snapshot run: whatever the app derived from it (isTTY, colors) describes the build's descriptors.
pub fn note_stdio_stream(fd: i32, site: Vec<u8>) {
    STDIO_NOTES
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push((fd, site));
}
pub fn take_stdio_notes() -> Vec<(i32, Vec<u8>)> {
    std::mem::take(&mut *STDIO_NOTES.lock().unwrap_or_else(|e| e.into_inner()))
}
/// The audit, most frequent first; empty unless the build did local I/O.
pub fn take_local_io_audit() -> Vec<(&'static str, Vec<u8>, u32)> {
    let mut audit = std::mem::take(&mut *LOCAL_IO_AUDIT.lock().unwrap_or_else(|e| e.into_inner()));
    audit.sort_by_key(|entry| core::cmp::Reverse(entry.2));
    audit
}

static SNAPSHOT_REQUESTED: AtomicU32 = AtomicU32::new(0);
static SNAPSHOT_PATH: std::sync::Mutex<Option<Vec<u8>>> = std::sync::Mutex::new(None);
/// Ask the main run loop to leave JS entirely and take the snapshot at top level (caller then unwinds via a termination exception).
pub fn request_snapshot(path: &[u8]) {
    *SNAPSHOT_PATH.lock().unwrap_or_else(|e| e.into_inner()) = Some(path.to_owned());
    SNAPSHOT_REQUESTED.store(1, Ordering::Release);
}
#[inline]
pub fn snapshot_requested() -> bool {
    SNAPSHOT_REQUESTED.load(Ordering::Acquire) != 0
}
static SNAPSHOT_IN_PROGRESS: AtomicU32 = AtomicU32::new(0);
/// Set once the runtime is draining the process for the snapshot; later `take()` calls only contribute their options.
pub fn set_snapshot_in_progress() {
    SNAPSHOT_IN_PROGRESS.store(1, Ordering::Release);
}
pub fn snapshot_in_progress() -> bool {
    SNAPSHOT_IN_PROGRESS.load(Ordering::Acquire) != 0
}
pub fn take_snapshot_request() -> Option<Vec<u8>> {
    if SNAPSHOT_REQUESTED.swap(0, Ordering::AcqRel) == 0 {
        return None;
    }
    SNAPSHOT_PATH
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .take()
}

/// What `Bun.startupSnapshot.take()` does about timers that are still armed when the process goes quiet.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum SnapshotTimers {
    /// Armed timers keep the process from being snapshotted (the default: the app is expected to clear them itself).
    Refuse = 0,
    /// Timers survive the snapshot; their deadlines are re-based onto the restoring process's clock.
    Keep = 1,
    /// The runtime drops every armed timer as part of taking the snapshot (the app re-arms what it needs after restore).
    Cancel = 2,
}
static SNAPSHOT_TIMERS: core::sync::atomic::AtomicU8 = core::sync::atomic::AtomicU8::new(0);
pub fn set_snapshot_timers(mode: SnapshotTimers) {
    SNAPSHOT_TIMERS.store(mode as u8, Ordering::Release);
}
pub fn snapshot_timers() -> SnapshotTimers {
    match SNAPSHOT_TIMERS.load(Ordering::Acquire) {
        1 => SnapshotTimers::Keep,
        2 => SnapshotTimers::Cancel,
        _ => SnapshotTimers::Refuse,
    }
}

/// Monotonic (sec, nsec) at the moment the snapshot was frozen; lives in __DATA so the restored process can compute how far its own clock is from it.
pub static SNAPSHOT_MONOTONIC: [core::sync::atomic::AtomicI64; 2] = [
    core::sync::atomic::AtomicI64::new(0),
    core::sync::atomic::AtomicI64::new(0),
];
