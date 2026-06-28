//! A persistent stack of [`IgnoreFile`]s from the index root down to one
//! directory, replicating git's `EXC_DIRS` exclude-list group
//! (dir.c `prep_exclude()` / `last_matching_pattern_from_lists()`).

use std::sync::Arc;

use crate::ignore_file::IgnoreFile;

/// Result of matching a path against a chain of ignore files.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Match {
    /// No pattern matched.
    None,
    /// Last matching pattern was a plain ignore pattern.
    Ignore,
    /// Last matching pattern was a negation (`!pattern`) — explicitly re-included.
    Whitelist,
}

struct Node {
    file: IgnoreFile,
    parent: Option<Arc<Node>>,
}

/// An immutable, cheaply-cloneable chain of [`IgnoreFile`]s from the root
/// down to one directory. `Send + Sync`. Deeper files take precedence over
/// shallower ones; within a file, the LAST matching pattern wins (git rule).
#[derive(Clone, Default)]
pub struct IgnoreChain {
    head: Option<Arc<Node>>,
}

impl IgnoreChain {
    pub fn empty() -> IgnoreChain {
        IgnoreChain { head: None }
    }

    /// Returns a NEW chain with `file` appended as the deepest level.
    /// `self` is unchanged (persistent data structure).
    #[must_use]
    pub fn append(&self, file: IgnoreFile) -> IgnoreChain {
        IgnoreChain {
            head: Some(Arc::new(Node {
                file,
                parent: self.head.clone(),
            })),
        }
    }

    /// Number of files in the chain.
    pub fn len(&self) -> usize {
        let mut n = 0;
        let mut node = self.head.as_deref();
        while let Some(cur) = node {
            n += 1;
            node = cur.parent.as_deref();
        }
        n
    }

    pub fn is_empty(&self) -> bool {
        self.head.is_none()
    }

    /// Total approximate heap bytes held by every file in the chain.
    pub fn memory_cost(&self) -> usize {
        let mut total = 0;
        let mut node = self.head.as_deref();
        while let Some(cur) = node {
            total += cur.file.memory_cost() + size_of::<Node>();
            node = cur.parent.as_deref();
        }
        total
    }

    /// Matches `rel_path` (relative to the INDEX ROOT, `/`-separated)
    /// assuming every ancestor directory of `rel_path` has already been
    /// checked and is NOT ignored. This is the hot path used by the
    /// directory walker (which prunes ignored dirs and never descends into
    /// them).
    ///
    /// The deepest file containing any matching line decides; within a file,
    /// the last matching line decides (gitignore(5) precedence).
    pub fn matches(&self, rel_path: &[u8], is_dir: bool) -> Match {
        if rel_path.is_empty() {
            return Match::None;
        }
        let basename = match memchr::memrchr(b'/', rel_path) {
            Some(i) => &rel_path[i + 1..],
            None => rel_path,
        };
        let mut node = self.head.as_deref();
        while let Some(cur) = node {
            // Skip files whose directory does not contain `rel_path` (e.g.
            // a sibling's chain reused for an out-of-tree query, or the
            // file's own directory).
            if let Some(rel_to_base) = cur.file.rel_to_base(rel_path)
                && let Some(negated) = cur.file.last_match(rel_to_base, basename, is_dir)
            {
                return if negated {
                    Match::Whitelist
                } else {
                    Match::Ignore
                };
            }
            node = cur.parent.as_deref();
        }
        Match::None
    }

    /// Full check for a path arriving out of context (e.g. a watcher event):
    /// also checks every ancestor directory component. Implements git's rule
    /// that "it is not possible to re-include a file if a parent directory
    /// of that file is excluded" (gitignore(5); dir.c `prep_exclude()` stops
    /// descending at the first excluded ancestor).
    pub fn is_ignored(&self, rel_path: &[u8], is_dir: bool) -> bool {
        // Each ancestor is evaluated as a directory using only the ignore
        // files ABOVE it; `rel_to_base` skips deeper files (git never loads
        // a `.gitignore` inside a directory it already decided to skip).
        for slash in memchr::memchr_iter(b'/', rel_path) {
            if self.matches(&rel_path[..slash], true) == Match::Ignore {
                return true;
            }
        }
        self.matches(rel_path, is_dir) == Match::Ignore
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chain_is_send_sync_and_cheap_to_clone() {
        fn assert_send_sync<T: Send + Sync + Clone>() {}
        assert_send_sync::<IgnoreChain>();
        assert_send_sync::<Match>();
    }
}
