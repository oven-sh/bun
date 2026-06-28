//! Porcelain-v1 status computation.
//!
//! Reference: `Documentation/git-status.txt` ("Short Format" / porcelain v1
//! XY codes) and `read-cache.c:{ie_match_stat, ce_match_stat_basic,
//! is_racy_timestamp, ce_modified}` for the worktree-vs-index stat-cache
//! comparison.
//!
//! v1 limitations (documented deviations from git, all on the conservative
//! side of "recompute by hashing"):
//! * No content filters: no CRLF conversion, no `.gitattributes`, no
//!   clean/smudge. The worktree hash is `sha1("blob <len>\0" + raw bytes)`,
//!   so a repository relying on `core.autocrlf` may report `M` for files
//!   git would consider clean.
//! * `core.fileMode` is assumed true on POSIX: an executable-bit difference
//!   on a regular file reports `M`.
//! * Nanosecond stat fields are not compared (matching a default
//!   `USE_NSEC`-less git build).
//! * Type changes report `M`, not `T`.
//! * Submodules (gitlink entries) are never inspected: their worktree column
//!   is always `' '`.

use crate::error::GitError;
use crate::index::{EntryFlags, Index, IndexEntry};
use crate::oid::Oid;
use crate::tree::{MODE_FILE, MODE_TYPE_MASK, TreeEntry, is_gitlink_mode};

/// One worktree file as seen by the caller's (already gitignore-filtered)
/// crawl. `mode` is the raw `st_mode`; times are `lstat` values.
#[derive(Clone, Copy, Debug)]
pub struct WorktreeEntry<'a> {
    pub path: &'a [u8],
    pub size: u64,
    pub mode: u32,
    pub mtime_s: i64,
    pub mtime_ns: u32,
    pub ctime_s: i64,
    pub ctime_ns: u32,
    pub dev: u64,
    pub ino: u64,
    pub uid: u32,
    pub gid: u32,
}

/// A porcelain-v1 `XY` pair. `staged` is the index-vs-HEAD column,
/// `worktree` the worktree-vs-index column. Untracked files are `??`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StatusCode {
    pub staged: u8,
    pub worktree: u8,
}

impl StatusCode {
    pub const UNTRACKED: StatusCode = StatusCode {
        staged: b'?',
        worktree: b'?',
    };
    pub const UNMERGED: StatusCode = StatusCode {
        staged: b'U',
        worktree: b'U',
    };
}

#[derive(Clone, Copy, Debug)]
pub struct StatusOptions {
    pub include_untracked: bool,
}

impl Default for StatusOptions {
    fn default() -> StatusOptions {
        StatusOptions {
            include_untracked: true,
        }
    }
}

/// Compute porcelain-v1 status codes.
///
/// * `head_tree` — HEAD's flattened tree ([`crate::Repository::head_tree`]),
///   sorted by path.
/// * `worktree` — the caller's gitignore-filtered worktree listing, sorted
///   by path. Directories must not be listed (submodule work trees are
///   skipped entirely).
/// * `read_blob(path)` — returns the worktree contents git would hash for
///   `path` (the link target for symlinks). Only invoked for paths from
///   `worktree`, and only on a stat-cache miss.
/// * `hash_object(bytes)` — returns the git blob id of `bytes`
///   ([`crate::hash_blob`] in production; injectable so unit tests never
///   reach the linked SHA-1).
///
/// Clean paths are omitted. A path can appear twice (`D ` + `??` when it was
/// removed from the index but still exists on disk). Output is path-sorted.
// `StatusOptions` is one byte today but is an options struct that will grow
// (pathspecs, untracked-dir handling); `&` is the stable API shape.
#[expect(clippy::trivially_copy_pass_by_ref)]
pub fn status<'a>(
    index: &Index,
    head_tree: &[TreeEntry],
    worktree: &[WorktreeEntry<'a>],
    read_blob: &mut dyn FnMut(&[u8]) -> Result<Vec<u8>, GitError>,
    hash_object: &dyn Fn(&[u8]) -> Oid,
    opts: &StatusOptions,
) -> Result<Vec<(Vec<u8>, StatusCode)>, GitError> {
    if !head_tree.is_sorted_by(|a, b| a.path < b.path) {
        return Err(GitError::InvalidInput("head tree not sorted by path"));
    }
    if !worktree.is_sorted_by(|a, b| a.path < b.path) {
        return Err(GitError::InvalidInput(
            "worktree listing not sorted by path",
        ));
    }

    let entries = index.entries();
    let mut out: Vec<(Vec<u8>, StatusCode)> = Vec::new();
    let (mut hi, mut ii, mut wi) = (0usize, 0usize, 0usize);

    loop {
        let hp = head_tree.get(hi).map(|e| e.path.as_slice());
        let ip = entries.get(ii).map(|e| index.path(e));
        let wp = worktree.get(wi).map(|e| e.path);
        let Some(path) = min_path(hp, min_path(ip, wp)) else {
            break;
        };

        let head_entry = if hp == Some(path) {
            head_tree.get(hi)
        } else {
            None
        };
        let wt_entry = if wp == Some(path) {
            worktree.get(wi)
        } else {
            None
        };
        let mut stage_count = 0usize;
        if ip == Some(path) {
            while ii + stage_count < entries.len() && index.path(&entries[ii + stage_count]) == path
            {
                stage_count += 1;
            }
        }

        if stage_count > 0 {
            let stages = &entries[ii..ii + stage_count];
            if stages.iter().any(|e| e.stage != 0) {
                out.push((path.to_vec(), StatusCode::UNMERGED));
            } else {
                let e = &stages[0];
                let code = tracked_code(index, e, head_entry, wt_entry, read_blob, hash_object)?;
                if code.staged != b' ' || code.worktree != b' ' {
                    out.push((path.to_vec(), code));
                }
            }
        } else if head_entry.is_some() {
            // In HEAD but gone from the index: staged deletion. If the path
            // still exists on disk it is additionally untracked (git prints
            // both lines).
            out.push((
                path.to_vec(),
                StatusCode {
                    staged: b'D',
                    worktree: b' ',
                },
            ));
            if wt_entry.is_some() && opts.include_untracked {
                out.push((path.to_vec(), StatusCode::UNTRACKED));
            }
        } else if opts.include_untracked {
            out.push((path.to_vec(), StatusCode::UNTRACKED));
        }

        if hp == Some(path) {
            hi += 1;
        }
        ii += stage_count;
        if wp == Some(path) {
            wi += 1;
        }
    }

    Ok(out)
}

fn min_path<'a>(a: Option<&'a [u8]>, b: Option<&'a [u8]>) -> Option<&'a [u8]> {
    match (a, b) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, b) => b,
    }
}

fn tracked_code(
    index: &Index,
    e: &IndexEntry,
    head: Option<&TreeEntry>,
    wt: Option<&WorktreeEntry<'_>>,
    read_blob: &mut dyn FnMut(&[u8]) -> Result<Vec<u8>, GitError>,
    hash_object: &dyn Fn(&[u8]) -> Oid,
) -> Result<StatusCode, GitError> {
    if e.flags.contains(EntryFlags::INTENT_TO_ADD) {
        // `git add -N`: the entry is a placeholder, not yet staged content.
        return Ok(StatusCode {
            staged: b' ',
            worktree: if wt.is_some() { b'A' } else { b'D' },
        });
    }

    let staged = match head {
        None => b'A',
        Some(h) if h.oid != e.oid || h.mode != e.mode => b'M',
        Some(_) => b' ',
    };

    let worktree = if e.flags.contains(EntryFlags::SKIP_WORKTREE) || is_gitlink_mode(e.mode) {
        b' '
    } else {
        match wt {
            None => b'D',
            Some(w) => {
                if e.flags.contains(EntryFlags::ASSUME_VALID) {
                    b' '
                } else if worktree_modified(index, e, w, read_blob, hash_object)? {
                    b'M'
                } else {
                    b' '
                }
            }
        }
    };

    Ok(StatusCode { staged, worktree })
}

/// `read-cache.c:ie_match_stat` + `ce_modified_check_fs`: cheap stat-cache
/// comparison first, falling back to hashing the worktree file only when the
/// cached stat is inconclusive (or racily clean).
fn worktree_modified(
    index: &Index,
    e: &IndexEntry,
    w: &WorktreeEntry<'_>,
    read_blob: &mut dyn FnMut(&[u8]) -> Result<Vec<u8>, GitError>,
    hash_object: &dyn Fn(&[u8]) -> Oid,
) -> Result<bool, GitError> {
    // TYPE_CHANGED: regular vs symlink (vs anything else).
    if e.mode & MODE_TYPE_MASK != w.mode & MODE_TYPE_MASK {
        return Ok(true);
    }
    // MODE_CHANGED: executable bit on regular files (core.fileMode = true).
    if e.mode & MODE_TYPE_MASK == MODE_FILE && ((e.mode & 0o111 != 0) != (w.mode & 0o111 != 0)) {
        return Ok(true);
    }
    // DATA_CHANGED: with no content filters, a size difference is a content
    // difference. The index stores `st_size` truncated to 32 bits
    // (`gitformat-index.txt`), so compare in that width like git does.
    if e.stat.size != (w.size as u32) {
        return Ok(true);
    }
    // Remaining cached stat fields, all stored 32-bit-truncated on disk.
    // Nanoseconds are intentionally not compared (default git build).
    let stat_clean = e.stat.mtime_s == (w.mtime_s as u32)
        && e.stat.ctime_s == (w.ctime_s as u32)
        && e.stat.dev == (w.dev as u32)
        && e.stat.ino == (w.ino as u32)
        && e.stat.uid == w.uid
        && e.stat.gid == w.gid;
    // `is_racy_timestamp`: an entry written in the same second the index
    // file itself was written may have been modified after being hashed
    // without changing its stat data — it must be re-hashed. An unknown
    // index timestamp is treated as "always racy" (conservative).
    let racy = match index.timestamp() {
        Some((ts_s, _ts_ns)) => ts_s <= i64::from(e.stat.mtime_s),
        None => true,
    };
    if stat_clean && !racy {
        return Ok(false);
    }
    let contents = read_blob(w.path)?;
    Ok(hash_object(&contents) != e.oid)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::index::StatCache;
    use crate::index::test_encode::{SpecEntry, encode};
    use core::cell::Cell;

    /// Deterministic stand-in for the real blob hash (tests must never call
    /// the linked SHA-1). Collision-free enough for fixtures.
    fn fake_hash(bytes: &[u8]) -> Oid {
        let mut out = [0u8; 20];
        out[0] = 1;
        for (i, &b) in bytes.iter().enumerate() {
            out[1 + (i % 19)] = out[1 + (i % 19)].wrapping_mul(31).wrapping_add(b);
        }
        Oid(out)
    }

    const INDEX_TS: i64 = 1_000_000;

    /// Stat values that match `spec_stat` and are NOT racy w.r.t INDEX_TS.
    fn clean_stat() -> StatCache {
        StatCache {
            ctime_s: 500_000,
            ctime_ns: 1,
            mtime_s: 500_000,
            mtime_ns: 2,
            dev: 7,
            ino: 8,
            uid: 9,
            gid: 10,
            size: 4,
        }
    }

    fn wt<'a>(path: &'a [u8], stat: &StatCache) -> WorktreeEntry<'a> {
        WorktreeEntry {
            path,
            size: u64::from(stat.size),
            mode: 0o100644,
            mtime_s: i64::from(stat.mtime_s),
            mtime_ns: stat.mtime_ns,
            ctime_s: i64::from(stat.ctime_s),
            ctime_ns: stat.ctime_ns,
            dev: u64::from(stat.dev),
            ino: u64::from(stat.ino),
            uid: stat.uid,
            gid: stat.gid,
        }
    }

    struct Fixture {
        index_data: Vec<u8>,
        head: Vec<TreeEntry>,
        blobs: Vec<(Vec<u8>, Vec<u8>)>,
    }

    impl Fixture {
        fn run_opts(
            &self,
            worktree: &[WorktreeEntry<'_>],
            opts: StatusOptions,
            expect_hashes: Option<usize>,
        ) -> Vec<(Vec<u8>, StatusCode)> {
            let mut index = Index::parse(&self.index_data).unwrap();
            index.set_timestamp(INDEX_TS, 0);
            let reads = Cell::new(0usize);
            let mut read_blob = |path: &[u8]| -> Result<Vec<u8>, GitError> {
                reads.set(reads.get() + 1);
                self.blobs
                    .iter()
                    .find(|(p, _)| p == path)
                    .map(|(_, c)| c.clone())
                    .ok_or(GitError::InvalidInput("missing test blob"))
            };
            let result = status(
                &index,
                &self.head,
                worktree,
                &mut read_blob,
                &fake_hash,
                &opts,
            )
            .unwrap();
            if let Some(n) = expect_hashes {
                assert_eq!(reads.get(), n, "unexpected number of content reads");
            }
            result
        }

        fn run(&self, worktree: &[WorktreeEntry<'_>]) -> Vec<(Vec<u8>, StatusCode)> {
            self.run_opts(worktree, StatusOptions::default(), None)
        }
    }

    fn code(staged: u8, worktree: u8) -> StatusCode {
        StatusCode { staged, worktree }
    }

    fn tree_entry(path: &[u8], oid: Oid, mode: u32) -> TreeEntry {
        TreeEntry {
            path: path.to_vec(),
            oid,
            mode,
        }
    }

    #[test]
    fn everything_clean_produces_nothing_and_never_hashes() {
        let content = b"abcd".to_vec();
        let oid = fake_hash(&content);
        let mut e = SpecEntry::new(b"file.txt", 0);
        e.oid = oid;
        e.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(2, &[e]),
            head: vec![tree_entry(b"file.txt", oid, 0o100644)],
            blobs: vec![(b"file.txt".to_vec(), content)],
        };
        let stat = clean_stat();
        let listing = [wt(b"file.txt", &stat)];
        assert!(
            fx.run_opts(&listing, StatusOptions::default(), Some(0))
                .is_empty()
        );
    }

    #[test]
    fn untracked_and_option_off() {
        let fx = Fixture {
            index_data: encode(2, &[]),
            head: vec![],
            blobs: vec![],
        };
        let stat = clean_stat();
        let listing = [wt(b"new.txt", &stat)];
        assert_eq!(
            fx.run(&listing),
            vec![(b"new.txt".to_vec(), StatusCode::UNTRACKED)]
        );
        let opts = StatusOptions {
            include_untracked: false,
        };
        assert!(fx.run_opts(&listing, opts, Some(0)).is_empty());
    }

    #[test]
    fn worktree_deleted() {
        let mut e = SpecEntry::new(b"gone.txt", 3);
        e.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(2, &[e]),
            head: vec![tree_entry(b"gone.txt", Oid([3; 20]), 0o100644)],
            blobs: vec![],
        };
        assert_eq!(fx.run(&[]), vec![(b"gone.txt".to_vec(), code(b' ', b'D'))]);
    }

    #[test]
    fn staged_added_and_added_modified() {
        let content = b"abcd".to_vec();
        let oid = fake_hash(&content);
        let mut e = SpecEntry::new(b"new.txt", 0);
        e.oid = oid;
        e.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(2, &[e]),
            head: vec![],
            blobs: vec![(b"new.txt".to_vec(), b"different content!".to_vec())],
        };
        // Clean in the worktree -> "A ".
        let stat = clean_stat();
        let listing = [wt(b"new.txt", &stat)];
        assert_eq!(
            fx.run(&listing),
            vec![(b"new.txt".to_vec(), code(b'A', b' '))]
        );
        // Size mismatch -> "AM" with no content read.
        let mut dirty = clean_stat();
        dirty.size = 99;
        let listing = [wt(b"new.txt", &dirty)];
        assert_eq!(
            fx.run_opts(&listing, StatusOptions::default(), Some(0)),
            vec![(b"new.txt".to_vec(), code(b'A', b'M'))]
        );
    }

    #[test]
    fn staged_modified_and_staged_deleted() {
        let content = b"abcd".to_vec();
        let oid = fake_hash(&content);
        let mut e = SpecEntry::new(b"a.txt", 0);
        e.oid = oid;
        e.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(2, &[e]),
            head: vec![
                tree_entry(b"a.txt", Oid([0x99; 20]), 0o100644),
                tree_entry(b"removed.txt", Oid([0x77; 20]), 0o100644),
            ],
            blobs: vec![],
        };
        let stat = clean_stat();
        let listing = [wt(b"a.txt", &stat)];
        assert_eq!(
            fx.run(&listing),
            vec![
                (b"a.txt".to_vec(), code(b'M', b' ')),
                (b"removed.txt".to_vec(), code(b'D', b' ')),
            ]
        );
    }

    /// A staged mode-only change (644 -> 755) with the same oid is `M `.
    #[test]
    fn staged_mode_change() {
        let oid = Oid([5; 20]);
        let mut e = SpecEntry::new(b"x", 0);
        e.oid = oid;
        e.mode = 0o100755;
        e.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(2, &[e]),
            head: vec![tree_entry(b"x", oid, 0o100644)],
            blobs: vec![],
        };
        let stat = clean_stat();
        let mut w = wt(b"x", &stat);
        w.mode = 0o100755;
        assert_eq!(fx.run(&[w]), vec![(b"x".to_vec(), code(b'M', b' '))]);
    }

    /// Removed from the index but still on disk: `D ` plus `??`.
    #[test]
    fn head_only_path_still_on_disk() {
        let fx = Fixture {
            index_data: encode(2, &[]),
            head: vec![tree_entry(b"f", Oid([1; 20]), 0o100644)],
            blobs: vec![],
        };
        let stat = clean_stat();
        let listing = [wt(b"f", &stat)];
        assert_eq!(
            fx.run(&listing),
            vec![
                (b"f".to_vec(), code(b'D', b' ')),
                (b"f".to_vec(), StatusCode::UNTRACKED),
            ]
        );
        let opts = StatusOptions {
            include_untracked: false,
        };
        assert_eq!(
            fx.run_opts(&listing, opts, None),
            vec![(b"f".to_vec(), code(b'D', b' '))]
        );
    }

    #[test]
    fn worktree_modified_via_hash_and_false_positive_stat() {
        let content = b"abcd".to_vec();
        let oid = fake_hash(&content);
        let mut e = SpecEntry::new(b"f", 0);
        e.oid = oid;
        e.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(2, &[e]),
            head: vec![tree_entry(b"f", oid, 0o100644)],
            blobs: vec![(b"f".to_vec(), content)],
        };
        // mtime changed, same size, content actually identical: one hash,
        // reported clean ("touch f").
        let mut touched = clean_stat();
        touched.mtime_s += 10;
        let listing = [wt(b"f", &touched)];
        assert!(
            fx.run_opts(&listing, StatusOptions::default(), Some(1))
                .is_empty()
        );

        // Same stat shape but the file content on disk is different (the
        // blob map returns different bytes): " M".
        let fx2 = Fixture {
            blobs: vec![(b"f".to_vec(), b"dcba".to_vec())],
            index_data: fx.index_data.clone(),
            head: fx.head,
        };
        assert_eq!(
            fx2.run_opts(&listing, StatusOptions::default(), Some(1)),
            vec![(b"f".to_vec(), code(b' ', b'M'))]
        );
    }

    /// Entry mtime >= index timestamp ("racily clean"): the stat cache
    /// cannot be trusted even though it matches, so the content is hashed.
    #[test]
    fn racily_clean_entry_is_rehashed() {
        let content = b"abcd".to_vec();
        let oid = fake_hash(&content);
        let mut racy_stat = clean_stat();
        racy_stat.mtime_s = INDEX_TS as u32; // == index timestamp
        let mut e = SpecEntry::new(b"f", 0);
        e.oid = oid;
        e.stat = racy_stat;
        let fx = Fixture {
            index_data: encode(2, &[e]),
            head: vec![tree_entry(b"f", oid, 0o100644)],
            blobs: vec![(b"f".to_vec(), content)],
        };
        let listing = [wt(b"f", &racy_stat)];
        assert!(
            fx.run_opts(&listing, StatusOptions::default(), Some(1))
                .is_empty()
        );
    }

    /// Executable-bit and file-type changes are detected from stat alone.
    #[test]
    fn mode_and_type_changes_need_no_hashing() {
        let mut e = SpecEntry::new(b"f", 1);
        e.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(2, &[e]),
            head: vec![tree_entry(b"f", Oid([1; 20]), 0o100644)],
            blobs: vec![],
        };
        let stat = clean_stat();
        let mut exec = wt(b"f", &stat);
        exec.mode = 0o100755;
        assert_eq!(
            fx.run_opts(&[exec], StatusOptions::default(), Some(0)),
            vec![(b"f".to_vec(), code(b' ', b'M'))]
        );
        let mut link = wt(b"f", &stat);
        link.mode = 0o120000;
        assert_eq!(
            fx.run_opts(&[link], StatusOptions::default(), Some(0)),
            vec![(b"f".to_vec(), code(b' ', b'M'))]
        );
    }

    #[test]
    fn assume_valid_and_skip_worktree() {
        let mut av = SpecEntry::new(b"assume", 1);
        av.assume_valid = true;
        av.stat = clean_stat();
        let mut sw = SpecEntry::new(b"skip", 2);
        sw.skip_worktree = true;
        sw.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(3, &[av, sw]),
            head: vec![
                tree_entry(b"assume", Oid([1; 20]), 0o100644),
                tree_entry(b"skip", Oid([2; 20]), 0o100644),
            ],
            blobs: vec![],
        };
        // `assume` present but with wild stat differences: still clean.
        let mut wild = clean_stat();
        wild.size = 12345;
        wild.mtime_s = 1;
        let listing = [wt(b"assume", &wild)];
        // `skip` absent from the worktree: NOT reported deleted.
        assert!(
            fx.run_opts(&listing, StatusOptions::default(), Some(0))
                .is_empty()
        );
        // `assume` absent IS reported deleted (assume-valid only skips the
        // content comparison, not existence).
        assert_eq!(fx.run(&[]), vec![(b"assume".to_vec(), code(b' ', b'D'))]);
    }

    #[test]
    fn gitlink_entries_are_never_compared() {
        let mut e = SpecEntry::new(b"submodule", 4);
        e.mode = 0o160000;
        e.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(2, &[e]),
            head: vec![tree_entry(b"submodule", Oid([4; 20]), 0o160000)],
            blobs: vec![],
        };
        assert!(fx.run(&[]).is_empty());
    }

    #[test]
    fn intent_to_add() {
        let mut e = SpecEntry::new(b"ita", 0);
        e.intent_to_add = true;
        e.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(3, &[e]),
            head: vec![],
            blobs: vec![],
        };
        let stat = clean_stat();
        let listing = [wt(b"ita", &stat)];
        assert_eq!(fx.run(&listing), vec![(b"ita".to_vec(), code(b' ', b'A'))]);
        assert_eq!(fx.run(&[]), vec![(b"ita".to_vec(), code(b' ', b'D'))]);
    }

    #[test]
    fn unmerged_conflict_entries() {
        let mut s1 = SpecEntry::new(b"c", 1);
        s1.stage = 1;
        let mut s2 = SpecEntry::new(b"c", 2);
        s2.stage = 2;
        let mut s3 = SpecEntry::new(b"c", 3);
        s3.stage = 3;
        let fx = Fixture {
            index_data: encode(2, &[s1, s2, s3]),
            head: vec![tree_entry(b"c", Oid([1; 20]), 0o100644)],
            blobs: vec![],
        };
        let stat = clean_stat();
        let listing = [wt(b"c", &stat)];
        assert_eq!(
            fx.run(&listing),
            vec![(b"c".to_vec(), StatusCode::UNMERGED)]
        );
    }

    /// Every list populated at once, exercising the 3-way merge ordering.
    #[test]
    fn combined_ordering() {
        let clean_content = b"abcd".to_vec();
        let clean_oid = fake_hash(&clean_content);
        let mut a = SpecEntry::new(b"a-clean", 0);
        a.oid = clean_oid;
        a.stat = clean_stat();
        let mut b = SpecEntry::new(b"b-staged", 9);
        b.stat = clean_stat();
        let mut d = SpecEntry::new(b"d-new", 8);
        d.stat = clean_stat();
        let fx = Fixture {
            index_data: encode(2, &[a, b, d]),
            head: vec![
                tree_entry(b"a-clean", clean_oid, 0o100644),
                tree_entry(b"b-staged", Oid([1; 20]), 0o100644),
                tree_entry(b"c-gone", Oid([2; 20]), 0o100644),
            ],
            blobs: vec![],
        };
        let stat = clean_stat();
        let mut deleted_size = clean_stat();
        deleted_size.size = 9999;
        let listing = [
            wt(b"a-clean", &stat),
            wt(b"b-staged", &deleted_size),
            wt(b"z-untracked", &stat),
        ];
        assert_eq!(
            fx.run(&listing),
            vec![
                (b"b-staged".to_vec(), code(b'M', b'M')),
                (b"c-gone".to_vec(), code(b'D', b' ')),
                (b"d-new".to_vec(), code(b'A', b'D')),
                (b"z-untracked".to_vec(), StatusCode::UNTRACKED),
            ]
        );
    }

    #[test]
    fn unsorted_inputs_are_rejected() {
        let fx = Fixture {
            index_data: encode(2, &[]),
            head: vec![],
            blobs: vec![],
        };
        let index = Index::parse(&fx.index_data).unwrap();
        let stat = clean_stat();
        let listing = [wt(b"b", &stat), wt(b"a", &stat)];
        let mut read = |_: &[u8]| -> Result<Vec<u8>, GitError> { unreachable!() };
        let err = status(
            &index,
            &[],
            &listing,
            &mut read,
            &fake_hash,
            &StatusOptions::default(),
        )
        .unwrap_err();
        assert!(matches!(err, GitError::InvalidInput(_)));
        let head = vec![
            tree_entry(b"z", Oid([1; 20]), 0o100644),
            tree_entry(b"a", Oid([2; 20]), 0o100644),
        ];
        let err = status(
            &index,
            &head,
            &[],
            &mut read,
            &fake_hash,
            &StatusOptions::default(),
        )
        .unwrap_err();
        assert!(matches!(err, GitError::InvalidInput(_)));
    }

    #[test]
    fn read_blob_errors_propagate() {
        let mut e = SpecEntry::new(b"f", 1);
        e.stat = clean_stat();
        let mut index = Index::parse(&encode(2, &[e])).unwrap();
        index.set_timestamp(INDEX_TS, 0);
        let mut touched = clean_stat();
        touched.mtime_s += 1;
        let listing = [wt(b"f", &touched)];
        let mut read = |_: &[u8]| -> Result<Vec<u8>, GitError> {
            Err(GitError::Corrupt("simulated read failure"))
        };
        let err = status(
            &index,
            &[],
            &listing,
            &mut read,
            &fake_hash,
            &StatusOptions::default(),
        )
        .unwrap_err();
        assert!(matches!(err, GitError::Corrupt("simulated read failure")));
    }

    #[test]
    fn empty_everything() {
        let fx = Fixture {
            index_data: encode(2, &[]),
            head: vec![],
            blobs: vec![],
        };
        assert!(fx.run(&[]).is_empty());
    }
}
