//! Desired state, queues, and snapshot lifetime for `Bun.TypeChecker`.
//!
//! Everything in this module is JS-thread owned except the owned per-call
//! image handed to the worker. No checker `Session` or `Program` is kept
//! between snapshots.

use bun_sema::util::FxHashMap;

/// One canonical path. The key of [`DesiredState`] maps.
pub type CanonicalPath = Box<[u8]>;

/// The desired state of one [`TypeChecker`](super::TypeChecker), captured
/// per `updateSnapshot` call.
#[derive(Clone, Default)]
pub struct DesiredState {
    /// Canonical config-or-directory selector -> open refcount.
    pub open_projects: FxHashMap<CanonicalPath, u32>,
    /// Canonical source path -> owned source text.
    pub sources: FxHashMap<CanonicalPath, Vec<u8>>,
}

impl DesiredState {
    pub fn apply_close(&mut self, selector: &[u8]) {
        match self.open_projects.get_mut(selector) {
            Some(count) if *count > 1 => *count -= 1,
            Some(_) => {
                self.open_projects.remove(selector);
            }
            None => {}
        }
    }

    pub fn apply_open(&mut self, selector: &[u8]) {
        *self.open_projects.entry(Box::from(selector)).or_insert(0) += 1;
    }

    pub fn apply_source(&mut self, path: &[u8], text: Option<Vec<u8>>) {
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
    pub fn project_selectors(&self) -> Vec<&[u8]> {
        let mut selectors: Vec<&[u8]> = self.open_projects.keys().map(|key| &**key).collect();
        selectors.sort_unstable();
        selectors
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
    fn close_before_open_ordering() {
        let mut state = DesiredState::default();
        // close-then-open in one update reloads.
        state.apply_open(b"/a/tsconfig.json");
        state.apply_close(b"/a/tsconfig.json");
        state.apply_open(b"/a/tsconfig.json");
        assert_eq!(state.open_projects.len(), 1);
    }
}
