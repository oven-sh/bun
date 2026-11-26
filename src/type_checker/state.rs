//! Desired state, queues, and snapshot lifetime for `Bun.TypeChecker`.
//!
//! Everything in this module is JS-thread owned except the owned per-call
//! image handed to the worker. No checker `Session` or `Program` is kept
//! between snapshots.

use bun_sema::util::FxHashMap;

use crate::path::canonical_key;

/// One canonical path. The key of [`DesiredState`] maps.
pub type CanonicalPath = Box<[u8]>;

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
    /// Canonical config selector -> selector as first opened. A project is held at most once.
    pub open_projects: FxHashMap<CanonicalPath, Box<[u8]>>,
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

    /// Applies one update's `closeProjects` and `openProjects` like typescript-go's API session
    /// (`handleUpdateSnapshot`): both lists are matched against the projects held before the update,
    /// so opening a held project and closing a project that is not held do nothing, and a project
    /// named in both lists is closed.
    pub fn apply_projects(&mut self, close: &[Vec<u8>], open: &[Vec<u8>]) {
        let case_sensitive = self.case_sensitive;
        let to_close: Vec<Vec<u8>> = close
            .iter()
            .map(|selector| canonical_key(selector, case_sensitive))
            .filter(|key| self.open_projects.contains_key(&key[..]))
            .collect();
        let to_open: Vec<(Vec<u8>, &Vec<u8>)> = open
            .iter()
            .map(|selector| (canonical_key(selector, case_sensitive), selector))
            .filter(|(key, _)| !self.open_projects.contains_key(&key[..]))
            .collect();
        for key in to_close {
            self.open_projects.remove(&key[..]);
        }
        for (key, selector) in to_open {
            self.open_projects
                .entry(key.into_boxed_slice())
                .or_insert_with(|| Box::from(&selector[..]));
        }
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
            .map(|(key, selector)| (&**key, &**selector))
            .collect();
        keyed.sort_unstable_by_key(|(key, _)| *key);
        keyed.into_iter().map(|(_, selector)| selector).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sel(s: &[u8]) -> Vec<Vec<u8>> {
        vec![s.to_vec()]
    }

    #[test]
    fn a_project_is_held_at_most_once() {
        let mut state = DesiredState::default();
        state.apply_projects(
            &[],
            &[b"/a/tsconfig.json".to_vec(), b"/a/tsconfig.json".to_vec()],
        );
        assert_eq!(state.open_projects.len(), 1);
        state.apply_projects(&[], &sel(b"/a/tsconfig.json"));
        // One close releases it: opening twice never took two references.
        state.apply_projects(&sel(b"/a/tsconfig.json"), &[]);
        assert!(state.open_projects.is_empty());
        // Closing a project that is not held does nothing.
        state.apply_projects(&sel(b"/never"), &[]);
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
        state.apply_projects(&[], &sel(b"/a/tsconfig.json"));
        let captured = state.clone();
        state.apply_projects(&sel(b"/a/tsconfig.json"), &[]);
        state.apply_source(b"/a.ts", Some(b"x".to_vec()));
        assert_eq!(captured.open_projects.len(), 1);
        assert!(captured.sources.is_empty());
        assert!(state.open_projects.is_empty());
    }

    #[test]
    fn close_and_open_in_one_update_are_matched_against_the_held_projects() {
        let mut state = DesiredState::default();
        state.apply_projects(&[], &sel(b"/a/tsconfig.json"));
        // Held: the open is skipped and the close applies, so the project ends up closed.
        state.apply_projects(&sel(b"/a/tsconfig.json"), &sel(b"/a/tsconfig.json"));
        assert!(state.open_projects.is_empty());
        // Not held: the close is skipped and the open applies.
        state.apply_projects(&sel(b"/a/tsconfig.json"), &sel(b"/a/tsconfig.json"));
        assert_eq!(state.open_projects.len(), 1);
    }

    #[test]
    fn case_insensitive_open_and_close_share_one_entry() {
        let mut state = DesiredState::new(false);
        state.apply_projects(
            &[],
            &[
                b"/W/App/tsconfig.json".to_vec(),
                b"/w/app/tsconfig.json".to_vec(),
            ],
        );
        assert_eq!(state.open_projects.len(), 1);
        assert_eq!(
            state.project_selectors(),
            vec![&b"/W/App/tsconfig.json"[..]]
        );
        state.apply_projects(&sel(b"/w/APP/TSCONFIG.json"), &[]);
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
        state.apply_projects(
            &[],
            &[b"/a/tsconfig.json".to_vec(), b"/A/tsconfig.json".to_vec()],
        );
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
