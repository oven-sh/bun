//! Desired state, queues, and snapshot lifetime for `Bun.TypeChecker`.
//!
//! Everything in this module is JS-thread owned except the owned per-call
//! image handed to the worker. No checker `Session` or `Program` is kept
//! between snapshots.

use bun_sema::util::FxHashMap;

use crate::path::canonical_key;

/// One canonical path. The key of [`DesiredState`] maps.
pub type CanonicalPath = Box<[u8]>;

/// An open project: the selector as the caller spelled it first, and how many opens it has.
#[derive(Clone)]
pub struct OpenProject {
    pub selector: Box<[u8]>,
    pub count: u32,
}

/// A source overlay: the path as the caller spelled it last, and its text.
#[derive(Clone)]
pub struct SourceOverlay {
    pub path: Box<[u8]>,
    pub text: Vec<u8>,
}

/// The desired state of one [`TypeChecker`](super::TypeChecker), captured
/// per `updateSnapshot` call.
///
/// Keys are `tspath.ToPath` of the path: lowercased by `ToFileNameLowerCase` when
/// the file system is case-insensitive. Values keep the spelling the checker is given.
#[derive(Clone)]
pub struct DesiredState {
    pub case_sensitive: bool,
    /// Canonical config selector -> open refcount.
    pub open_projects: FxHashMap<CanonicalPath, OpenProject>,
    /// Canonical source path -> overlay.
    pub sources: FxHashMap<CanonicalPath, SourceOverlay>,
}

impl Default for DesiredState {
    fn default() -> Self {
        Self::new(true)
    }
}

impl DesiredState {
    pub fn new(case_sensitive: bool) -> Self {
        Self {
            case_sensitive,
            open_projects: FxHashMap::default(),
            sources: FxHashMap::default(),
        }
    }

    pub fn apply_close(&mut self, selector: &[u8]) {
        let key = canonical_key(selector, self.case_sensitive);
        match self.open_projects.get_mut(&*key) {
            Some(open) if open.count > 1 => open.count -= 1,
            Some(_) => {
                self.open_projects.remove(&*key);
            }
            None => {}
        }
    }

    pub fn apply_open(&mut self, selector: &[u8]) {
        let key = canonical_key(selector, self.case_sensitive);
        self.open_projects
            .entry(key.into_boxed_slice())
            .or_insert_with(|| OpenProject {
                selector: Box::from(selector),
                count: 0,
            })
            .count += 1;
    }

    pub fn apply_source(&mut self, path: &[u8], text: Option<Vec<u8>>) {
        let key = canonical_key(path, self.case_sensitive);
        match text {
            Some(text) => {
                self.sources.insert(
                    key.into_boxed_slice(),
                    SourceOverlay {
                        path: Box::from(path),
                        text,
                    },
                );
            }
            None => {
                self.sources.remove(&*key);
            }
        }
    }

    /// Project selectors in a stable order for request building.
    pub fn project_selectors(&self) -> Vec<&[u8]> {
        let mut keyed: Vec<(&[u8], &[u8])> = self
            .open_projects
            .iter()
            .map(|(key, open)| (&**key, &*open.selector))
            .collect();
        keyed.sort_unstable_by_key(|(key, _)| *key);
        keyed.into_iter().map(|(_, selector)| selector).collect()
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
        assert_eq!(state.sources[&b"/a.ts"[..]].text, b"y".to_vec());
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

    #[test]
    fn case_insensitive_open_and_close_share_one_entry() {
        let mut state = DesiredState::new(false);
        state.apply_open(b"/W/App/tsconfig.json");
        state.apply_open(b"/w/app/tsconfig.json");
        assert_eq!(state.open_projects.len(), 1);
        assert_eq!(
            state.project_selectors(),
            vec![&b"/W/App/tsconfig.json"[..]]
        );
        state.apply_close(b"/W/APP/tsconfig.json");
        assert_eq!(state.open_projects.len(), 1);
        state.apply_close(b"/w/app/TSCONFIG.json");
        assert!(state.open_projects.is_empty());
    }

    #[test]
    fn case_insensitive_overlays_collapse_and_keep_latest_spelling() {
        let mut state = DesiredState::new(false);
        state.apply_source(b"/SRC/a.ts", Some(b"x".to_vec()));
        state.apply_source(b"/src/a.ts", Some(b"y".to_vec()));
        assert_eq!(state.sources.len(), 1);
        let overlay = &state.sources[&b"/src/a.ts"[..]];
        assert_eq!(&*overlay.path, b"/src/a.ts");
        assert_eq!(overlay.text, b"y");
        state.apply_source(b"/Src/A.ts", None);
        assert!(state.sources.is_empty());
    }

    #[test]
    fn case_sensitive_keeps_spellings_apart() {
        let mut state = DesiredState::new(true);
        state.apply_open(b"/a/tsconfig.json");
        state.apply_open(b"/A/tsconfig.json");
        state.apply_source(b"/SRC/a.ts", Some(b"x".to_vec()));
        state.apply_source(b"/src/a.ts", Some(b"y".to_vec()));
        assert_eq!(state.open_projects.len(), 2);
        assert_eq!(state.sources.len(), 2);
    }

    #[test]
    fn case_insensitive_uses_tsgo_lowering_not_ascii_only() {
        let mut state = DesiredState::new(false);
        state.apply_source("/\u{c9}.ts".as_bytes(), Some(b"x".to_vec()));
        state.apply_source("/\u{e9}.ts".as_bytes(), Some(b"y".to_vec()));
        assert_eq!(state.sources.len(), 1);
        // U+0130 is not lowered, so it stays apart from "i".
        state.apply_source("/\u{130}.ts".as_bytes(), Some(b"z".to_vec()));
        state.apply_source(b"/i.ts", Some(b"z".to_vec()));
        assert_eq!(state.sources.len(), 3);
    }
}
