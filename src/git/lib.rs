//! In-process git: repository discovery, refs, the `.git/index`, the object
//! store (loose + pack), HEAD-tree flattening, porcelain-v1 status, and a
//! line diff. Never spawns the git binary.
//!
//! Everything under `.git/` is treated as attacker-controlled input: every
//! length, offset and count read from disk is bounds-checked and surfaces
//! as a [`GitError`], never a panic.
//!
//! This is a pure leaf crate (no JSC, no event loop): callers hand it bytes
//! and worktree listings and inject the blob reader / hasher, so every
//! format parser and the status/diff logic are unit-testable on in-memory
//! fixtures. The authoritative format documents are cited per module
//! (`Documentation/gitformat-index.txt`, `gitformat-pack.txt`,
//! `gitrepository-layout.txt`, `git-status.txt` in git.git).

mod delta;
mod diff;
mod error;
mod hash;
mod index;
mod odb;
mod oid;
mod pack;
mod refs;
mod repo;
mod status;
mod tree;
mod util;

pub use diff::{DiffLine, DiffOrigin, Hunk, diff_lines};
pub use error::GitError;
pub use hash::hash_blob;
pub use index::{EntryFlags, Index, IndexEntry, StatCache};
pub use odb::{MAX_OBJECT_SIZE, ObjectKind, Odb};
pub use oid::{OID_HEX_LEN, OID_RAW_LEN, Oid};
pub use refs::{Head, PackedRefs};
pub use repo::Repository;
pub use status::{StatusCode, StatusOptions, WorktreeEntry, status};
pub use tree::{
    MAX_TREE_DEPTH, MAX_TREE_ENTRIES, MODE_FILE, MODE_GITLINK, MODE_SYMLINK, MODE_TREE,
    MODE_TYPE_MASK, TreeEntry, flatten_tree, is_gitlink_mode, is_symlink_mode, is_tree_mode,
};
