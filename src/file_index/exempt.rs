//! Git's tracked-file exemption from ignore rules.
//!
//! `git ls-files --cached --others --exclude-standard` — git's real file set
//! — is **tracked ∪ (untracked − ignored)**: ignore rules only ever hide
//! *untracked* paths. An index built with `gitignore: true` inside a git
//! repository must therefore keep a tracked file that matches an ignore
//! pattern, and must not prune an ignored directory that still contains
//! tracked files.
//!
//! This crate never reads `.git` (it must not depend on `bun_git`); the
//! runtime layer parses `.git/index` on the work pool and hands the crawl an
//! owned, `Send + Sync` [`ExemptSet`] of root-relative paths. The set is
//! rebuilt on every (re)crawl — `git add` of a previously-ignored file is
//! only reflected at the next crawl/refresh.
//!
//! Every decision point consults the exemption through ONE predicate,
//! [`ExemptSet::admits`], wrapped by [`classify_entry`] (the crawl's
//! per-entry check and directory pruning, the watcher's per-directory event
//! filter and dynamic directory registration) and [`classify_path`] (the
//! recursive watcher backends' out-of-context event filter).

use std::sync::Arc;

use bun_collections::StringSet;
use bun_core::handle_oom;
use bun_ignore::{IgnoreChain, Match};

/// The set of root-relative paths exempt from ignore rules (git's tracked
/// files under the index root), plus every ancestor directory of one (so the
/// walker never prunes an ignored directory that contains tracked files).
///
/// Owned, `Send + Sync`, built once per (re)crawl and shared by `Arc`.
#[derive(Default)]
pub struct ExemptSet {
    /// Root-relative paths of exempt (tracked) non-directory entries.
    files: StringSet,
    /// Every proper ancestor directory of an entry in `files` (the root
    /// itself, `b""`, is excluded — it is never a candidate for pruning).
    dirs: StringSet,
    /// Sum of the key byte lengths, for [`ExemptSet::memory_cost`].
    key_bytes: usize,
}

/// Per-key overhead beyond the path bytes themselves: the owning `Box<[u8]>`
/// (ptr + len), the `()` value slot, and the hash index entry.
const PER_KEY_OVERHEAD: usize = size_of::<Box<[u8]>>() + size_of::<u64>();

impl ExemptSet {
    /// Build from the root-relative, `/`-separated paths of every exempt
    /// file (no leading `./`, no trailing `/`). Empty paths and duplicates
    /// are ignored. Ancestor directories are derived here.
    pub fn from_files<'a>(paths: impl IntoIterator<Item = &'a [u8]>) -> ExemptSet {
        let mut set = ExemptSet::default();
        for path in paths {
            if path.is_empty() || set.files.contains(path) {
                continue;
            }
            handle_oom(set.files.insert(path));
            set.key_bytes += path.len();
            // Insert each proper ancestor, deepest first; an ancestor that is
            // already present implies all of its own ancestors are too.
            let mut end = path.len();
            while let Some(slash) = memchr::memrchr(b'/', &path[..end]) {
                let dir = &path[..slash];
                if dir.is_empty() || set.dirs.contains(dir) {
                    break;
                }
                handle_oom(set.dirs.insert(dir));
                set.key_bytes += dir.len();
                end = slash;
            }
        }
        set
    }

    /// An empty set behind an `Arc` (no repository, `gitignore: false`, or a
    /// `.git/index` that could not be read).
    #[must_use]
    pub fn none() -> Arc<ExemptSet> {
        Arc::default()
    }

    pub fn is_empty(&self) -> bool {
        self.files.is_empty()
    }

    /// Number of exempt files.
    pub fn len(&self) -> usize {
        self.files.count()
    }

    /// Approximate retained heap bytes, folded into the index's memory
    /// accounting when the set is kept alive past the crawl (the watcher's
    /// event filter holds one).
    pub fn memory_cost(&self) -> usize {
        self.key_bytes + (self.files.count() + self.dirs.count()) * PER_KEY_OVERHEAD
    }

    /// **The** exemption predicate. `true` when ignore rules must not drop
    /// `rel`: it is an exempt (tracked) file, or a directory containing one
    /// (git lists `node_modules/foo/file` if it is tracked, so an ignored
    /// directory with tracked content cannot be pruned).
    pub fn admits(&self, rel: &[u8], is_dir: bool) -> bool {
        if self.files.is_empty() {
            return false;
        }
        if is_dir {
            self.dirs.contains(rel)
        } else {
            self.files.contains(rel)
        }
    }
}

/// The verdict for one path: index it, index it knowing it is ignored, or
/// drop it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EntryVerdict {
    /// Not matched by the ignore rules.
    Keep,
    /// Ignored (or under an ignored directory) but exempt. A directory with
    /// this verdict is descended into with `parent_ignored = true`: git
    /// never re-includes under an excluded directory, so nothing inside it
    /// is kept unless the exemption admits it.
    KeepIgnored,
    /// Ignored and not exempt. A directory with this verdict is pruned.
    Drop,
}

impl EntryVerdict {
    /// The ignore rules match this path (whether or not it is exempt).
    pub fn is_ignored(self) -> bool {
        self != EntryVerdict::Keep
    }

    /// The path is dropped from the index / produces no watch event.
    pub fn is_dropped(self) -> bool {
        self == EntryVerdict::Drop
    }
}

/// The shared ignore decision for an entry enumerated *in context*: `chain`
/// is the ignore chain of `rel`'s immediate parent directory and
/// `parent_ignored` says whether that directory is itself ignored. Used by
/// the crawl's per-entry check and its directory pruning (the same call),
/// and by the watcher's per-directory event filter and dynamic directory
/// registration.
pub fn classify_entry(
    chain: &IgnoreChain,
    parent_ignored: bool,
    exempt: &ExemptSet,
    rel: &[u8],
    is_dir: bool,
) -> EntryVerdict {
    if !parent_ignored && chain.matches(rel, is_dir) != Match::Ignore {
        return EntryVerdict::Keep;
    }
    if exempt.admits(rel, is_dir) {
        EntryVerdict::KeepIgnored
    } else {
        EntryVerdict::Drop
    }
}

/// [`classify_entry`] for a path arriving *out of context* (a recursive
/// watcher event): `chain` belongs to the nearest known ancestor directory
/// (`ancestor_ignored` = that directory is itself ignored), and every
/// component between it and `rel` is also checked
/// ([`IgnoreChain::is_ignored`]).
pub fn classify_path(
    chain: &IgnoreChain,
    ancestor_ignored: bool,
    exempt: &ExemptSet,
    rel: &[u8],
    is_dir: bool,
) -> EntryVerdict {
    if !ancestor_ignored && !chain.is_ignored(rel, is_dir) {
        return EntryVerdict::Keep;
    }
    if exempt.admits(rel, is_dir) {
        EntryVerdict::KeepIgnored
    } else {
        EntryVerdict::Drop
    }
}

#[cfg(test)]
mod tests {
    use bun_ignore::IgnoreFile;

    use super::*;

    fn set(paths: &[&[u8]]) -> ExemptSet {
        ExemptSet::from_files(paths.iter().copied())
    }

    #[test]
    fn empty_set_admits_nothing() {
        let s = ExemptSet::default();
        assert!(s.is_empty());
        assert_eq!(s.len(), 0);
        assert!(!s.admits(b"a", false));
        assert!(!s.admits(b"a", true));
        assert_eq!(s.memory_cost(), 0);
    }

    /// File exemption: an exempt path is admitted only as a file, exact
    /// match only — never its siblings, never as a directory.
    #[test]
    fn file_predicate_is_exact() {
        let s = set(&[b"bench/.env", b".cargo/.gitkeep"]);
        assert_eq!(s.len(), 2);
        assert!(s.admits(b"bench/.env", false));
        assert!(s.admits(b".cargo/.gitkeep", false));
        assert!(!s.admits(b"bench/.env", true));
        assert!(!s.admits(b"bench/.env.local", false));
        assert!(!s.admits(b"bench", false));
        assert!(!s.admits(b".env", false));
        assert!(!s.admits(b"", false));
    }

    /// Directory predicate ("not prunable"): every proper ancestor of an
    /// exempt file, however deep, and nothing else.
    #[test]
    fn deep_ancestor_directories_are_not_prunable() {
        let s = set(&[b"node_modules/a/b/c/keep.txt"]);
        for dir in [
            b"node_modules".as_slice(),
            b"node_modules/a",
            b"node_modules/a/b",
            b"node_modules/a/b/c",
        ] {
            assert!(s.admits(dir, true), "{:?}", dir.escape_ascii().to_string());
        }
        // The file itself is not a directory; the root and non-ancestors are
        // not in the set; an ancestor is not an exempt *file*.
        assert!(!s.admits(b"node_modules/a/b/c/keep.txt", true));
        assert!(!s.admits(b"", true));
        assert!(!s.admits(b"node_modules/x", true));
        assert!(!s.admits(b"node_modules/a", false));
    }

    #[test]
    fn duplicates_and_empty_paths_are_ignored_and_cost_is_positive() {
        let s = set(&[b"a/b.txt", b"a/b.txt", b"", b"a/c.txt"]);
        assert_eq!(s.len(), 2);
        assert!(s.admits(b"a", true));
        assert!(s.memory_cost() > 0);
    }

    #[test]
    fn classify_entry_combines_chain_and_exemption() {
        let chain = IgnoreChain::empty()
            .append(IgnoreFile::parse(b"", b"*.log\nignored_dir/\n!keep.log\n"));
        let exempt = set(&[b"build.log", b"ignored_dir/keep/me.txt"]);

        // Not ignored at all.
        assert_eq!(
            classify_entry(&chain, false, &exempt, b"a.txt", false),
            EntryVerdict::Keep
        );
        // Re-included by `!keep.log`.
        assert_eq!(
            classify_entry(&chain, false, &exempt, b"keep.log", false),
            EntryVerdict::Keep
        );
        // Ignored but tracked.
        assert_eq!(
            classify_entry(&chain, false, &exempt, b"build.log", false),
            EntryVerdict::KeepIgnored
        );
        // Ignored, untracked.
        assert_eq!(
            classify_entry(&chain, false, &exempt, b"other.log", false),
            EntryVerdict::Drop
        );
        // An ignored directory containing tracked files is not pruned...
        assert_eq!(
            classify_entry(&chain, false, &exempt, b"ignored_dir", true),
            EntryVerdict::KeepIgnored
        );
        // ...and inside it (parent_ignored), the chain is never consulted:
        // only the exemption admits anything.
        assert_eq!(
            classify_entry(&chain, true, &exempt, b"ignored_dir/keep", true),
            EntryVerdict::KeepIgnored
        );
        assert_eq!(
            classify_entry(&chain, true, &exempt, b"ignored_dir/keep/me.txt", false),
            EntryVerdict::KeepIgnored
        );
        assert_eq!(
            classify_entry(&chain, true, &exempt, b"ignored_dir/keep/new.txt", false),
            EntryVerdict::Drop
        );
        // An ignored directory with no tracked content is still pruned.
        let bare = set(&[b"build.log"]);
        assert_eq!(
            classify_entry(&chain, false, &bare, b"ignored_dir", true),
            EntryVerdict::Drop
        );
    }

    /// `classify_path` re-checks every ancestor component, so an untracked
    /// file deep inside an ignored directory is dropped even when the chain
    /// of its nearest known ancestor does not directly match it.
    #[test]
    fn classify_path_checks_ancestors() {
        let chain = IgnoreChain::empty().append(IgnoreFile::parse(b"", b"ignored_dir/\n"));
        let exempt = set(&[b"ignored_dir/keep/me.txt"]);
        assert_eq!(
            classify_path(&chain, false, &exempt, b"ignored_dir/keep/me.txt", false),
            EntryVerdict::KeepIgnored
        );
        assert_eq!(
            classify_path(&chain, false, &exempt, b"ignored_dir/keep/new.txt", false),
            EntryVerdict::Drop
        );
        assert_eq!(
            classify_path(&chain, false, &exempt, b"top.txt", false),
            EntryVerdict::Keep
        );
        // An already-ignored ancestor short-circuits straight to the
        // exemption.
        assert_eq!(
            classify_path(&chain, true, &exempt, b"top.txt", false),
            EntryVerdict::Drop
        );
    }
}
