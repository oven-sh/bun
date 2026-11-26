//! Desired state, queues, and snapshot lifetime for `Bun.TypeChecker`.
//!
//! Everything in this module is JS-thread owned except the owned per-call
//! image handed to the worker. No checker `Session` or `Program` is kept
//! between snapshots.

use bun_sema::util::FxHashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

/// One canonical path. The key of [`DesiredState`] maps.
pub(crate) type CanonicalPath = Box<[u8]>;

/// The desired state of one [`TypeChecker`](super::TypeChecker), captured
/// per `updateSnapshot` call.
#[derive(Clone, Default)]
pub(crate) struct DesiredState {
    /// Canonical config-or-directory selector -> open refcount.
    pub(crate) open_projects: FxHashMap<CanonicalPath, u32>,
    /// Canonical source path -> owned source text.
    pub(crate) sources: FxHashMap<CanonicalPath, Vec<u8>>,
}

impl DesiredState {
    pub(crate) fn apply_close(&mut self, selector: &[u8]) {
        match self.open_projects.get_mut(selector) {
            Some(count) if *count > 1 => *count -= 1,
            Some(_) => {
                self.open_projects.remove(selector);
            }
            None => {}
        }
    }

    pub(crate) fn apply_open(&mut self, selector: &[u8]) {
        *self.open_projects.entry(Box::from(selector)).or_insert(0) += 1;
    }

    pub(crate) fn apply_source(&mut self, path: &[u8], text: Option<Vec<u8>>) {
        match text {
            Some(text) => {
                self.sources.insert(Box::from(path), text);
            }
            None => {
                self.sources.remove(path);
            }
        }
    }

    /// Project selectors in a stable order for request building.
    pub(crate) fn project_selectors(&self) -> Vec<&[u8]> {
        let mut selectors: Vec<&[u8]> =
            self.open_projects.keys().map(|key| &**key).collect();
        selectors.sort_unstable();
        selectors
    }
}

/// Lifetime record shared by one snapshot and all of its project/program
/// views. `dispose()` and root close set `disposed` on the JS thread;
/// getters check it.
pub(crate) struct SnapshotLifetime {
    pub(crate) disposed: AtomicBool,
}

impl SnapshotLifetime {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            disposed: AtomicBool::new(false),
        })
    }

    pub(crate) fn is_disposed(&self) -> bool {
        self.disposed.load(Ordering::Acquire)
    }

    pub(crate) fn dispose(&self) {
        self.disposed.store(true, Ordering::Release);
    }
}

/// Per-root queue bookkeeping. All fields are JS-thread only; the mutable
/// fields live in `JsCell`s on the root struct.
pub(crate) struct RootQueue {
    /// Jobs enqueued but not yet started.
    pub(crate) queued: usize,
    /// Jobs whose completion has not yet been delivered to JS.
    pub(crate) undelivered: Vec<u64>,
    /// `close()` called.
    pub(crate) closing: bool,
}

impl RootQueue {
    pub(crate) fn new() -> Self {
        Self {
            queued: 0,
            undelivered: Vec::new(),
            closing: false,
        }
    }
}

/// Shared root state reachable from workers. Only the running counter lives
/// here.
/// Shared root state reachable from workers. `close_promise` is
/// JS-thread only (written in `close()`, read in `finish()`); the
/// `Mutex` exists only because `RootShared` is shared.
pub(crate) struct RootShared {
    /// Jobs currently running on workers.
    pub(crate) running: std::sync::atomic::AtomicUsize,
    /// Close promise, created on first `close()`; resolved when the queue drains.
    pub(crate) close_promise: std::sync::Mutex<Option<ClosePromisePtr>>,
    /// Jobs waiting for the running one to finish. Each entry carries its
    /// owned state image and JS-side delivery state. Only pushed/popped on
    /// the JS thread; the `Send` wrapper exists only for the `Mutex`.
    pub(crate) pending: std::sync::Mutex<std::collections::VecDeque<PendingPtr>>,
    /// Live snapshot lifetimes, invalidated by root close. JS-thread only.
    pub(crate) live_snapshots: std::sync::Mutex<Vec<Arc<SnapshotLifetime>>>,
    /// The running job's detached flag, set by `close()`.
    pub(crate) running_detached: std::sync::Mutex<Option<Arc<core::sync::atomic::AtomicBool>>>,
}

/// A raw pointer to a `PendingEntry`, `Send` because the queue is only
/// ever touched on the JS thread.
pub(crate) struct PendingPtr(pub(crate) *mut crate::api::js_type_checker::task::PendingEntry);

// SAFETY: only pushed/popped on the JS thread (see `RootShared::pending`).
unsafe impl Send for PendingPtr {}
// SAFETY: as above.
unsafe impl Sync for PendingPtr {}

/// A raw pointer to the close promise, `Send` because `RootShared` is
/// shared with workers but the promise is only touched on the JS thread.
pub(crate) struct ClosePromisePtr(pub(crate) *mut bun_jsc::JSPromiseStrong);

// SAFETY: as above.
unsafe impl Send for ClosePromisePtr {}
// SAFETY: as above.
unsafe impl Sync for ClosePromisePtr {}

impl RootShared {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            running: std::sync::atomic::AtomicUsize::new(0),
            close_promise: std::sync::Mutex::new(None),
            pending: std::sync::Mutex::new(std::collections::VecDeque::new()),
            live_snapshots: std::sync::Mutex::new(Vec::new()),
            running_detached: std::sync::Mutex::new(None),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refcounts_open_and_close() {
        let mut state = DesiredState::default();
        state.apply_open(b"/a/tsconfig.json");
        state.apply_open(b"/a/tsconfig.json");
        assert_eq!(state.open_projects.len(), 1);
        state.apply_close(b"/a/tsconfig.json");
        assert_eq!(state.open_projects.len(), 1);
        state.apply_close(b"/a/tsconfig.json");
        assert!(state.open_projects.is_empty());
        // Closing an unopened project is a no-op.
        state.apply_close(b"/never");
        assert!(state.open_projects.is_empty());
    }

    #[test]
    fn source_overlay_replace_and_remove() {
        let mut state = DesiredState::default();
        state.apply_source(b"/a.ts", Some(b"x".to_vec()));
        state.apply_source(b"/a.ts", Some(b"y".to_vec()));
        assert_eq!(state.sources[&b"/a.ts"[..]], b"y".to_vec());
        state.apply_source(b"/a.ts", None);
        assert!(state.sources.is_empty());
    }

    #[test]
    fn captured_state_is_independent() {
        let mut state = DesiredState::default();
        state.apply_open(b"/a/tsconfig.json");
        let captured = state.clone();
        state.apply_close(b"/a/tsconfig.json");
        state.apply_source(b"/a.ts", Some(b"x".to_vec()));
        assert_eq!(captured.open_projects.len(), 1);
        assert!(captured.sources.is_empty());
        assert!(state.open_projects.is_empty());
    }

    #[test]
    fn snapshot_lifetime_dispose_is_idempotent() {
        let lifetime = SnapshotLifetime::new();
        assert!(!lifetime.is_disposed());
        lifetime.dispose();
        lifetime.dispose();
        assert!(lifetime.is_disposed());
    }

    #[test]
    fn close_before_open_ordering() {
        let mut state = DesiredState::default();
        // close-then-open in one update reloads.
        state.apply_open(b"/a/tsconfig.json");
        state.apply_close(b"/a/tsconfig.json");
        state.apply_open(b"/a/tsconfig.json");
        assert_eq!(state.open_projects.len(), 1);
    }
}
