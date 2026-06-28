//! `FileIndex.gitStatus()` / `FileIndex.gitDiff()` — in-process git status
//! and per-file line diffs (`bun_git`); Bun never spawns the `git` binary.
//!
//! The JS thread snapshots everything the worker needs (the absolute root
//! and, for status, the store's worktree listing). One work-pool task then
//! does all repository discovery, `.git` parsing and file hashing over that
//! owned snapshot and hands plain data back; the JS thread only marshals it.
//!
//! `gitStatus()` is computed from the *indexed* view of the worktree (the
//! same gitignore-filtered listing the rest of `FileIndex` exposes), not a
//! fresh disk walk, so callers should `await index.ready` first. Two
//! consequences:
//! * an ignored file is never reported `??` (matching git);
//! * a tracked path matching a `.gitignore` rule IS in the store (the crawl
//!   exempts git's tracked set from git's own ignore sources), so it is
//!   compared like any other entry;
//! * the rare *tracked* path still missing from the store (excluded by a
//!   user `ignore:` pattern, dropped by `maxMemory` truncation, or hidden
//!   because the exemption set could not be read) is `lstat`ed on the worker
//!   before the comparison, so it is classified for real (`git status`
//!   semantics: the tracked set is not subject to ignore rules) rather than
//!   reported ` D`.

use std::sync::Arc;

use bun_event_loop::TaskTag;
use bun_file_index::{EntryKind, FileReadOutcome, Meta, read_regular_at};
use bun_git::{
    DiffOrigin, GitError, Hunk, Oid, Repository, StatusOptions, TreeEntry, WorktreeEntry,
    diff_lines, hash_blob, is_gitlink_mode, is_symlink_mode,
};
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    JSGlobalObject, JSPromise, JSValue, JsResult, JsTerminated, StringJsc as _, Strong,
    SysErrorJsc as _,
};
use bun_sys::{E, Fd};

use super::{FileIndex, join_abs, schedule, utf8_js};

/// `gitDiff()` does not read either side of the diff past this many bytes;
/// an over-limit file is reported exactly like a binary one.
const MAX_DIFF_FILE_SIZE: u64 = 64 * 1024 * 1024;
/// A NUL byte in the first 8 KiB classifies a file as binary
/// (git's `buffer_is_binary` uses the same window).
const BINARY_SNIFF_LEN: usize = 8 * 1024;
/// Lines of context around each `gitDiff()` hunk (git's default).
const DIFF_CONTEXT_LINES: u32 = 3;
/// Symlink targets longer than this are corrupt input, not paths.
const MAX_SYMLINK_TARGET: usize = 1024 * 1024;

pub type GitStatusTask<'a> = ConcurrentPromiseTask<'a, GitStatusJob<'a>>;
pub type GitDiffTask<'a> = ConcurrentPromiseTask<'a, GitDiffJob<'a>>;

/// `HEAD`'s flattened tree, cached on the `FileIndex` (JS-thread state) and
/// keyed by the resolved `HEAD` commit. Re-reading and re-flattening the
/// whole tree out of the odb (packfile + delta + zlib for thousands of tree
/// objects) dominated `gitStatus()` on large repositories; the worker now
/// resolves `HEAD` cheaply and only rebuilds when the commit moved.
#[derive(Clone)]
pub(crate) struct HeadTreeCache {
    /// The (peeled) commit `HEAD` pointed at when `tree` was flattened.
    oid: Oid,
    /// Path-sorted; shared with in-flight workers by refcount.
    tree: Arc<Vec<TreeEntry>>,
}

impl HeadTreeCache {
    /// Approximate retained bytes, mirrored into the index's GC-visible
    /// `estimatedSize`.
    pub(crate) fn memory_cost(&self) -> usize {
        self.tree
            .iter()
            .map(|e| e.path.capacity() + size_of::<TreeEntry>())
            .sum()
    }
}

/// Resolve HEAD's flattened tree, reusing `cached` when HEAD still names
/// the same commit. The second element is `Some` when the tree had to be
/// rebuilt (the JS thread caches it).
///
/// The object database is only opened — through `odb`, which fills the
/// caller's slot — when the tree actually has to be rebuilt: `Odb::open`
/// reads and validates every `.idx` in the repository (O(objects)), which
/// profiling showed was the OTHER dominant per-call cost of `gitStatus()`
/// on a large repository, and a status served from the cache never needs
/// an object.
fn head_tree_cached(
    repo: &Repository,
    odb: &mut Option<bun_git::Odb>,
    cached: Option<&HeadTreeCache>,
) -> Result<(Arc<Vec<TreeEntry>>, Option<HeadTreeCache>), GitError> {
    match repo.head()?.oid() {
        None => Ok((Arc::new(Vec::new()), None)),
        Some(oid) => match cached {
            Some(cache) if cache.oid == oid => Ok((Arc::clone(&cache.tree), None)),
            _ => {
                let tree = Arc::new(repo.tree_at(odb_lazy(repo, odb)?, oid)?);
                let fresh = HeadTreeCache {
                    oid,
                    tree: Arc::clone(&tree),
                };
                Ok((tree, Some(fresh)))
            }
        },
    }
}

/// Open the repository's object database into `slot` on first use.
fn odb_lazy<'a>(
    repo: &Repository,
    slot: &'a mut Option<bun_git::Odb>,
) -> Result<&'a bun_git::Odb, GitError> {
    if slot.is_none() {
        *slot = Some(repo.odb()?);
    }
    // Filled by every path above.
    Ok(slot.as_ref().expect("odb slot was just filled"))
}

/// `index.gitStatus()`. Snapshots the store's non-directory entries (sorted,
/// root-relative) on the JS thread and resolves with the marshalled status.
///
/// Per design requirement 4 (git's `core.fsmonitor` model), a candidate's
/// cached stat is handed to the worker ONLY if the watcher has kept it
/// valid; every other candidate is `lstat`ed by the worker itself, on the
/// pool, and the fresh data is written back into the store's stat cache so
/// the *next* `gitStatus()` of a watching index re-stats nothing but what
/// changed. An unwatched index never trusts the cache (it has nothing
/// keeping it true), so its status is always computed from fresh stats.
pub(crate) fn start_status(
    index: &FileIndex,
    global: &JSGlobalObject,
    this_value: JSValue,
) -> JSValue {
    let watching = index.is_watching();
    let (generation, worktree) = {
        let store = index.store();
        let worktree: Vec<(Box<[u8]>, Option<Meta>)> = store
            .iter_sorted()
            .filter(|&id| store.kind(id) != EntryKind::Dir)
            .map(|id| {
                let cached = if watching {
                    store.stat(id).copied()
                } else {
                    None
                };
                (Box::from(store.path(id)), cached)
            })
            .collect();
        (store.generation(), worktree)
    };
    schedule(
        global,
        Box::new(GitStatusJob {
            global,
            // Created and consumed on the JS thread only (`then`/destroy);
            // the box's address crosses to the pool inert, exactly like
            // `CrawlTask::this_strong`. Keeps the index alive so the
            // write-back below has somewhere to land.
            this_strong: Strong::create(this_value, global),
            root: Box::from(index.root_bytes()),
            worktree,
            generation,
            cached_tree: index.head_tree_cache(),
            fresh_tree: None,
            fresh: Vec::new(),
            result: Ok(None),
        }),
    )
}

/// `index.gitDiff(path)`. `rel` is the normalized root-relative path.
pub(crate) fn start_diff(
    index: &FileIndex,
    global: &JSGlobalObject,
    this_value: JSValue,
    rel: Vec<u8>,
) -> JSValue {
    schedule(
        global,
        Box::new(GitDiffJob {
            global,
            this_strong: Strong::create(this_value, global),
            root: Box::from(index.root_bytes()),
            rel,
            cached_tree: index.head_tree_cache(),
            fresh_tree: None,
            result: Ok(None),
        }),
    )
}

/// `GitError` -> JS `Error`. I/O errors keep the full syscall error (errno,
/// syscall, path); everything else uses `GitError`'s own message.
fn git_error_js(global: &JSGlobalObject, err: GitError) -> JSValue {
    match err {
        GitError::Io(io) => io.to_js(global),
        other => {
            let message = other.to_string();
            bun_core::String::clone_utf8(message.as_bytes()).to_error_instance(global)
        }
    }
}

// ───────────────────────────── gitStatus() ─────────────────────────────

pub struct GitStatusJob<'a> {
    global: &'a JSGlobalObject,
    /// The `FileIndex` wrapper, pinned for the task's lifetime (JS-thread
    /// handle; see [`start_status`]).
    this_strong: Strong,
    root: Box<[u8]>,
    /// Every indexed non-directory (root-relative, store order) and, only
    /// when the watcher has kept it valid, its cached stat. `None` entries
    /// are `lstat`ed by [`compute_status`] on the work pool.
    worktree: Vec<(Box<[u8]>, Option<Meta>)>,
    /// [`bun_file_index::Store::generation`] at snapshot time; the
    /// write-back is dropped if the store mutated under the task.
    generation: u64,
    /// The index's cached HEAD tree, if any (see [`HeadTreeCache`]).
    cached_tree: Option<HeadTreeCache>,
    /// Set by the worker when it had to (re)flatten the HEAD tree; cached
    /// on the index by `then`.
    fresh_tree: Option<HeadTreeCache>,
    /// What the worker `lstat`ed: the fresh stat to cache, or `None` for a
    /// candidate that is no longer statable.
    fresh: Vec<(Box<[u8]>, Option<Meta>)>,
    result: Result<Option<StatusOut>, GitError>,
}

/// Owned, JS-free status result produced on the work pool.
struct StatusOut {
    branch: Option<Vec<u8>>,
    oid: Option<bun_git::Oid>,
    detached: bool,
    /// Root-relative path + porcelain `XY`, path-sorted.
    files: Vec<(Vec<u8>, [u8; 2])>,
}

impl ConcurrentPromiseTaskContext for GitStatusJob<'_> {
    const TASK_TAG: TaskTag = bun_event_loop::task_tag::FileIndexGitStatusTask;

    fn run(&mut self) {
        self.result = compute_status(
            &self.root,
            &self.worktree,
            &mut self.fresh,
            self.cached_tree.as_ref(),
            &mut self.fresh_tree,
        );
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        let global = self.global;
        // Cache what the worker rebuilt before marshalling (JS thread).
        if let Some(index) = self.this_strong.get().as_class_ref::<FileIndex>() {
            if let Some(tree) = self.fresh_tree.take() {
                index.cache_head_tree(global, tree);
            }
            if !self.fresh.is_empty() {
                index.absorb_fresh_stats(self.generation, core::mem::take(&mut self.fresh));
            }
        }
        match core::mem::replace(&mut self.result, Ok(None)) {
            Err(err) => promise.reject(global, Ok(git_error_js(global, err))),
            Ok(None) => promise.resolve(global, JSValue::NULL),
            Ok(Some(out)) => match out.to_js(global) {
                Ok(value) => promise.resolve(global, value),
                Err(err) => promise.reject(global, Err(err)),
            },
        }
    }
}

impl StatusOut {
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, 4);
        let branch = match &self.branch {
            Some(name) => utf8_js(global, name)?,
            None => JSValue::NULL,
        };
        obj.put(global, "branch", branch);
        let oid = match &self.oid {
            Some(oid) => utf8_js(global, &oid.to_hex())?,
            None => JSValue::NULL,
        };
        obj.put(global, "oid", oid);
        obj.put(global, "detached", JSValue::js_boolean(self.detached));
        let files = JSValue::create_array_from_iter(global, self.files.iter(), |(path, xy)| {
            let file = JSValue::create_empty_object(global, 2);
            file.put(global, "path", utf8_js(global, path)?);
            file.put(global, "status", utf8_js(global, xy)?);
            Ok(file)
        })?;
        obj.put(global, "files", files);
        Ok(obj)
    }
}

fn compute_status(
    root: &[u8],
    snapshot: &[(Box<[u8]>, Option<Meta>)],
    fresh: &mut Vec<(Box<[u8]>, Option<Meta>)>,
    cached_tree: Option<&HeadTreeCache>,
    fresh_tree: &mut Option<HeadTreeCache>,
) -> Result<Option<StatusOut>, GitError> {
    let Some(repo) = Repository::discover(root)? else {
        return Ok(None);
    };
    let head = repo.head()?;
    let index = repo.read_index()?;
    // `status()` never reads an object: the odb is only opened (inside
    // `head_tree_cached`) when the HEAD tree is not already cached.
    let mut odb = None;
    let (head_tree, rebuilt) = head_tree_cached(&repo, &mut odb, cached_tree)?;
    *fresh_tree = rebuilt;

    // The git index and HEAD tree are work-tree-relative; the snapshot is
    // root-relative. When the index root is a subdirectory of the work tree,
    // prefix the snapshot for the comparison and report only (root-relative)
    // paths under it.
    let prefix = work_tree_prefix(repo.work_tree(), root);
    let work_tree = repo.work_tree().to_vec();
    // The stat side of the comparison: a candidate's watcher-fresh cached
    // stat, or (for the rest) an `lstat` done here, off the JS thread —
    // recorded in `fresh` so the JS thread can cache it. A candidate that
    // vanished (or is no longer a file/symlink) is dropped from the listing,
    // which is exactly what makes git report it deleted.
    let mut entries: Vec<(Vec<u8>, Meta)> = Vec::with_capacity(snapshot.len());
    for (path, cached) in snapshot {
        let meta = match cached {
            Some(meta) => *meta,
            None => {
                let abs = join_abs(root, path);
                let meta = bun_sys::lstat(zstr(&abs).as_zstr())
                    .ok()
                    .and_then(|raw| super::meta_from_stat(&bun_sys::PosixStat::init(&raw)));
                fresh.push((path.clone(), meta));
                match meta {
                    Some(meta) if meta.kind != EntryKind::Dir => meta,
                    _ => continue,
                }
            }
        };
        entries.push((join_rel(&prefix, path), meta));
    }
    // git's tracked set is not subject to ignore rules: a *tracked* path the
    // store excluded (a `.gitignore` rule or a user `ignore:` pattern) is not
    // deleted just because it is unindexed. `lstat` it here so it is
    // classified for real. `index.entries()` is path-sorted, so a `last()`
    // check dedupes the (consecutive) per-stage duplicates of one path.
    let indexed = entries.len();
    for tracked in index.entries() {
        let path = index.path(tracked);
        if !path.starts_with(prefix.as_slice())
            || entries[..indexed]
                .binary_search_by(|(p, _)| p.as_slice().cmp(path))
                .is_ok()
            || entries[indexed..].last().map(|(p, _)| p.as_slice()) == Some(path)
        {
            continue;
        }
        let abs = join_abs(&work_tree, path);
        if let Ok(raw) = bun_sys::lstat(zstr(&abs).as_zstr())
            && let Some(meta) = super::meta_from_stat(&bun_sys::PosixStat::init(&raw))
            && meta.kind != EntryKind::Dir
        {
            entries.push((path.to_vec(), meta));
        }
    }
    entries.sort_unstable_by(|a, b| a.0.cmp(&b.0));
    let worktree: Vec<WorktreeEntry<'_>> = entries
        .iter()
        .map(|(path, m)| WorktreeEntry {
            path,
            size: m.size,
            mode: m.mode,
            mtime_s: m.mtime_s,
            mtime_ns: m.mtime_ns,
            ctime_s: m.ctime_s,
            ctime_ns: m.ctime_ns,
            dev: m.dev,
            ino: m.ino,
            uid: m.uid,
            gid: m.gid,
        })
        .collect();

    let listing = &worktree;
    // `status()` only ever asks for paths it was handed in `listing`; the
    // lookup recovers that entry's lstat mode so symlinks hash their target.
    let mut read_blob = |path: &[u8]| -> Result<Vec<u8>, GitError> {
        let symlink = listing
            .binary_search_by(|e| e.path.cmp(path))
            .is_ok_and(|i| is_symlink_mode(listing[i].mode));
        read_worktree_file(&work_tree, path, symlink)
    };
    let codes = bun_git::status(
        &index,
        &head_tree,
        &worktree,
        &mut read_blob,
        &hash_blob,
        &StatusOptions::default(),
    )?;
    let files = codes
        .into_iter()
        .filter_map(|(path, code)| {
            let rel = path.strip_prefix(prefix.as_slice())?;
            Some((rel.to_vec(), [code.staged, code.worktree]))
        })
        .collect();

    Ok(Some(StatusOut {
        branch: head.branch_name().map(<[u8]>::to_vec),
        oid: head.oid(),
        detached: matches!(head, bun_git::Head::Detached(_)),
        files,
    }))
}

// ───────────────────────────── gitDiff() ─────────────────────────────

pub struct GitDiffJob<'a> {
    global: &'a JSGlobalObject,
    /// JS-thread handle (see [`GitStatusJob::this_strong`]); keeps the
    /// index alive so the HEAD-tree write-back has somewhere to land.
    this_strong: Strong,
    root: Box<[u8]>,
    /// Normalized root-relative path of the file to diff.
    rel: Vec<u8>,
    /// See the same pair on [`GitStatusJob`].
    cached_tree: Option<HeadTreeCache>,
    fresh_tree: Option<HeadTreeCache>,
    result: Result<Option<DiffOut>, GitError>,
}

/// Owned, JS-free diff result produced on the work pool.
///
/// * Resolves `None` (JS `null`) outside a git work tree, or when the path
///   exists neither in `HEAD` nor in the worktree.
/// * A binary file (NUL in the first 8 KiB of either side) or one over
///   [`MAX_DIFF_FILE_SIZE`] yields `old_text: None, new_text: None,
///   hunks: []`.
/// * Otherwise `old_text` is `None` only when the path is not in `HEAD` and
///   `new_text` is `None` only when it is gone from the worktree. Each hunk
///   line's `text` is the exact line bytes without its trailing `\n`.
struct DiffOut {
    old_text: Option<Vec<u8>>,
    new_text: Option<Vec<u8>>,
    hunks: Vec<OwnedHunk>,
}

struct OwnedHunk {
    old_start: u32,
    old_lines: u32,
    new_start: u32,
    new_lines: u32,
    lines: Vec<(DiffOrigin, Box<[u8]>)>,
}

impl ConcurrentPromiseTaskContext for GitDiffJob<'_> {
    const TASK_TAG: TaskTag = bun_event_loop::task_tag::FileIndexGitDiffTask;

    fn run(&mut self) {
        self.result = compute_diff(
            &self.root,
            &self.rel,
            self.cached_tree.as_ref(),
            &mut self.fresh_tree,
        );
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        let global = self.global;
        if let Some(tree) = self.fresh_tree.take()
            && let Some(index) = self.this_strong.get().as_class_ref::<FileIndex>()
        {
            index.cache_head_tree(global, tree);
        }
        match core::mem::replace(&mut self.result, Ok(None)) {
            Err(err) => promise.reject(global, Ok(git_error_js(global, err))),
            Ok(None) => promise.resolve(global, JSValue::NULL),
            Ok(Some(out)) => match out.to_js(global) {
                Ok(value) => promise.resolve(global, value),
                Err(err) => promise.reject(global, Err(err)),
            },
        }
    }
}

impl DiffOut {
    fn to_js(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, 3);
        obj.put(
            global,
            "oldText",
            optional_text(global, self.old_text.as_deref())?,
        );
        obj.put(
            global,
            "newText",
            optional_text(global, self.new_text.as_deref())?,
        );
        let hunks = JSValue::create_array_from_iter(global, self.hunks.iter(), |hunk| {
            let h = JSValue::create_empty_object(global, 5);
            h.put(
                global,
                "oldStart",
                JSValue::js_number_from_uint64(u64::from(hunk.old_start)),
            );
            h.put(
                global,
                "oldLines",
                JSValue::js_number_from_uint64(u64::from(hunk.old_lines)),
            );
            h.put(
                global,
                "newStart",
                JSValue::js_number_from_uint64(u64::from(hunk.new_start)),
            );
            h.put(
                global,
                "newLines",
                JSValue::js_number_from_uint64(u64::from(hunk.new_lines)),
            );
            let lines =
                JSValue::create_array_from_iter(global, hunk.lines.iter(), |(origin, text)| {
                    let line = JSValue::create_empty_object(global, 2);
                    let kind: &[u8] = match origin {
                        DiffOrigin::Context => b"context",
                        DiffOrigin::Add => b"add",
                        DiffOrigin::Del => b"del",
                    };
                    line.put(global, "kind", utf8_js(global, kind)?);
                    line.put(global, "text", utf8_js(global, text)?);
                    Ok(line)
                })?;
            h.put(global, "lines", lines);
            Ok(h)
        })?;
        obj.put(global, "hunks", hunks);
        Ok(obj)
    }
}

fn optional_text(global: &JSGlobalObject, text: Option<&[u8]>) -> JsResult<JSValue> {
    match text {
        Some(bytes) => utf8_js(global, bytes),
        None => Ok(JSValue::NULL),
    }
}

fn compute_diff(
    root: &[u8],
    rel: &[u8],
    cached_tree: Option<&HeadTreeCache>,
    fresh_tree: &mut Option<HeadTreeCache>,
) -> Result<Option<DiffOut>, GitError> {
    let Some(repo) = Repository::discover(root)? else {
        return Ok(None);
    };
    let prefix = work_tree_prefix(repo.work_tree(), root);
    let repo_rel = join_rel(&prefix, rel);

    let mut odb = None;
    let (head_tree, rebuilt) = head_tree_cached(&repo, &mut odb, cached_tree)?;
    *fresh_tree = rebuilt;
    let mut too_large = false;

    let old_text = match head_tree.binary_search_by(|e| e.path.as_slice().cmp(repo_rel.as_slice()))
    {
        Err(_) => None,
        // A submodule has no blob to diff.
        Ok(i) if is_gitlink_mode(head_tree[i].mode) => None,
        Ok(i) => {
            let entry = &head_tree[i];
            let odb = odb_lazy(&repo, &mut odb)?;
            let (_, size) = odb.kind_and_size(entry.oid)?;
            if size > MAX_DIFF_FILE_SIZE {
                too_large = true;
                None
            } else {
                let mut body = Vec::new();
                if odb.read(entry.oid, &mut body)? != bun_git::ObjectKind::Blob {
                    return Err(GitError::Corrupt("HEAD tree entry is not a blob"));
                }
                Some(body)
            }
        }
    };

    let abs = join_abs(root, rel);
    let new_text = match bun_sys::lstat(zstr(&abs).as_zstr()) {
        Err(err) if matches!(err.get_errno(), E::ENOENT | E::ENOTDIR) => None,
        Err(err) => return Err(err.into()),
        Ok(raw) => {
            let st = bun_sys::PosixStat::init(&raw);
            let mode = st.mode as u32;
            if st.size > MAX_DIFF_FILE_SIZE {
                too_large = true;
                None
            } else if is_symlink_mode(mode) {
                Some(read_link_target(&abs)?)
            } else if (mode & bun_git::MODE_TYPE_MASK) == bun_git::MODE_FILE {
                match read_regular_at(Fd::cwd(), &abs, MAX_DIFF_FILE_SIZE)? {
                    FileReadOutcome::Contents(bytes) => Some(bytes),
                    FileReadOutcome::TooLarge => {
                        too_large = true;
                        None
                    }
                    // Vanished — or swapped for a symlink/FIFO — between the
                    // `lstat` above and this open: never read through, never
                    // block, never report out-of-tree bytes as the worktree.
                    FileReadOutcome::NotFound | FileReadOutcome::NotRegular => None,
                }
            } else {
                // A directory (or fifo/socket/device) is not a diffable file.
                None
            }
        }
    };

    if too_large || is_binary(old_text.as_deref()) || is_binary(new_text.as_deref()) {
        return Ok(Some(DiffOut {
            old_text: None,
            new_text: None,
            hunks: Vec::new(),
        }));
    }
    if old_text.is_none() && new_text.is_none() {
        return Ok(None);
    }

    let old = old_text.as_deref().unwrap_or(b"");
    let new = new_text.as_deref().unwrap_or(b"");
    let hunks = own_hunks(old, new, diff_lines(old, new, DIFF_CONTEXT_LINES));
    Ok(Some(DiffOut {
        old_text,
        new_text,
        hunks,
    }))
}

fn is_binary(text: Option<&[u8]>) -> bool {
    text.is_some_and(|bytes| {
        memchr::memchr(0, &bytes[..bytes.len().min(BINARY_SNIFF_LEN)]).is_some()
    })
}

/// `diff_lines` line ranges index `old`/`new`; copy them out (without the
/// trailing `\n`) so the result owns nothing.
fn own_hunks(old: &[u8], new: &[u8], hunks: Vec<Hunk>) -> Vec<OwnedHunk> {
    hunks
        .into_iter()
        .map(|hunk| OwnedHunk {
            old_start: hunk.old_start,
            old_lines: hunk.old_lines,
            new_start: hunk.new_start,
            new_lines: hunk.new_lines,
            lines: hunk
                .lines
                .into_iter()
                .map(|line| {
                    let source = match line.origin {
                        DiffOrigin::Add => new,
                        DiffOrigin::Context | DiffOrigin::Del => old,
                    };
                    let bytes = &source[line.content];
                    let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
                    (line.origin, Box::from(bytes))
                })
                .collect(),
        })
        .collect()
}

// ───────────────────────────── shared helpers ─────────────────────────────

/// `root` relative to the repository work tree, as an (empty or
/// `/`-terminated) prefix to prepend to root-relative paths.
pub(super) fn work_tree_prefix(work_tree: &[u8], root: &[u8]) -> Vec<u8> {
    let rest = root.strip_prefix(work_tree).unwrap_or_default();
    let rest = rest.strip_prefix(b"/").unwrap_or(rest);
    if rest.is_empty() {
        Vec::new()
    } else {
        let mut prefix = rest.to_vec();
        prefix.push(b'/');
        prefix
    }
}

/// `prefix` is empty or `/`-terminated ([`work_tree_prefix`]'s contract).
fn join_rel(prefix: &[u8], rel: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(prefix.len() + rel.len());
    out.extend_from_slice(prefix);
    out.extend_from_slice(rel);
    out
}

/// The worktree bytes git would hash for `repo_rel`: the symlink target for
/// symlinks, the raw file contents otherwise (no content filters).
///
/// The by-name open of a regular file is the guarded one
/// ([`bun_file_index::read_regular_at`]): the path was classified by an
/// earlier `lstat` (or a cached stat), and between that and this read it
/// can have been swapped for a symlink (never read through) or a
/// writer-less FIFO (never blocks). A path that stopped being a regular
/// file hashes as empty — never as out-of-tree content — and is therefore
/// reported modified, exactly like a vanishing race in `git status`.
fn read_worktree_file(
    work_tree: &[u8],
    repo_rel: &[u8],
    symlink: bool,
) -> Result<Vec<u8>, GitError> {
    let abs = join_abs(work_tree, repo_rel);
    if symlink {
        return read_link_target(&abs);
    }
    match read_regular_at(Fd::cwd(), &abs, u64::MAX)? {
        FileReadOutcome::Contents(bytes) => Ok(bytes),
        FileReadOutcome::NotFound | FileReadOutcome::NotRegular | FileReadOutcome::TooLarge => {
            Ok(Vec::new())
        }
    }
}

fn read_link_target(abs: &[u8]) -> Result<Vec<u8>, GitError> {
    let path = zstr(abs);
    let mut buf = vec![0u8; 1024];
    loop {
        let len = bun_sys::readlink(path.as_zstr(), &mut buf)?;
        // A result that fills the buffer may be truncated; retry larger.
        if len < buf.len() {
            buf.truncate(len);
            return Ok(buf);
        }
        if buf.len() >= MAX_SYMLINK_TARGET {
            return Err(GitError::TooLarge("symlink target"));
        }
        buf = vec![0u8; buf.len() * 2];
    }
}

/// NUL-terminate a path for the `ZStr`-taking syscall wrappers.
fn zstr(path: &[u8]) -> ZPath {
    let mut bytes = Vec::with_capacity(path.len() + 1);
    bytes.extend_from_slice(path);
    bytes.push(0);
    ZPath(bytes)
}

struct ZPath(Vec<u8>);

impl ZPath {
    fn as_zstr(&self) -> &bun_core::ZStr {
        bun_core::ZStr::from_slice_with_nul(&self.0)
    }
}
