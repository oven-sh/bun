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
//! documented consequences:
//! * an ignored file is never reported `??` (matching git);
//! * a *tracked* path excluded from the index (by a user `ignore:` pattern,
//!   or because the crawl has not finished) is reported as deleted (` D`).

use bun_event_loop::TaskTag;
use bun_file_index::{EntryKind, Meta};
use bun_git::{
    DiffOrigin, GitError, Hunk, Repository, StatusOptions, WorktreeEntry, diff_lines, hash_blob,
    is_gitlink_mode, is_symlink_mode,
};
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    JSGlobalObject, JSPromise, JSValue, JsResult, JsTerminated, StringJsc as _, SysErrorJsc as _,
};
use bun_sys::{E, Fd, File};

use super::{FileIndex, utf8_js};

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

/// `index.gitStatus()`. Snapshots the store's non-directory entries (sorted,
/// root-relative) on the JS thread and resolves with the marshalled status.
pub(crate) fn start_status(index: &FileIndex, global: &JSGlobalObject) -> JSValue {
    let worktree: Vec<(Box<[u8]>, Meta)> = {
        let store = index.store();
        store
            .iter_sorted()
            .filter(|&id| store.meta(id).kind != EntryKind::Dir)
            .map(|id| (Box::from(store.path(id)), *store.meta(id)))
            .collect()
    };
    schedule(
        global,
        Box::new(GitStatusJob {
            global,
            root: Box::from(index.root_bytes()),
            worktree,
            result: Ok(None),
        }),
    )
}

/// `index.gitDiff(path)`. `rel` is the normalized root-relative path.
pub(crate) fn start_diff(index: &FileIndex, global: &JSGlobalObject, rel: Vec<u8>) -> JSValue {
    schedule(
        global,
        Box::new(GitDiffJob {
            global,
            root: Box::from(index.root_bytes()),
            rel,
            result: Ok(None),
        }),
    )
}

fn schedule<C: ConcurrentPromiseTaskContext>(global: &JSGlobalObject, job: Box<C>) -> JSValue {
    let task = ConcurrentPromiseTask::create_on_js_thread(global, job);
    let promise = task.promise.value();
    let raw = bun_core::heap::into_raw(task);
    // SAFETY: `raw` is freshly leaked; `schedule()` only writes the intrusive
    // `task` field into the work-pool queue (same hand-off as
    // `grep_task::start`). Freed by `run_then_destroy!` after dispatch.
    unsafe { (*raw).schedule() };
    promise
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
    root: Box<[u8]>,
    /// Root-relative path + crawl-time `lstat` data of every indexed
    /// non-directory, in store (path-sorted) order.
    worktree: Vec<(Box<[u8]>, Meta)>,
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
        self.result = compute_status(&self.root, &self.worktree);
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        let global = self.global;
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
    snapshot: &[(Box<[u8]>, Meta)],
) -> Result<Option<StatusOut>, GitError> {
    let Some(repo) = Repository::discover(root)? else {
        return Ok(None);
    };
    let head = repo.head()?;
    let index = repo.read_index()?;
    let odb = repo.odb()?;
    let head_tree = repo.head_tree(&odb)?;

    // The git index and HEAD tree are work-tree-relative; the snapshot is
    // root-relative. When the index root is a subdirectory of the work tree,
    // prefix the snapshot for the comparison and report only (root-relative)
    // paths under it.
    let prefix = work_tree_prefix(repo.work_tree(), root);
    let repo_paths: Vec<Vec<u8>> = snapshot
        .iter()
        .map(|(path, _)| join_rel(&prefix, path))
        .collect();
    let worktree: Vec<WorktreeEntry<'_>> = repo_paths
        .iter()
        .zip(snapshot.iter())
        .map(|(path, (_, m))| WorktreeEntry {
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

    let work_tree = repo.work_tree().to_vec();
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
    root: Box<[u8]>,
    /// Normalized root-relative path of the file to diff.
    rel: Vec<u8>,
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
        self.result = compute_diff(&self.root, &self.rel);
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        let global = self.global;
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
        obj.put(global, "oldText", optional_text(global, self.old_text.as_deref())?);
        obj.put(global, "newText", optional_text(global, self.new_text.as_deref())?);
        let hunks = JSValue::create_array_from_iter(global, self.hunks.iter(), |hunk| {
            let h = JSValue::create_empty_object(global, 5);
            h.put(global, "oldStart", JSValue::js_number_from_uint64(u64::from(hunk.old_start)));
            h.put(global, "oldLines", JSValue::js_number_from_uint64(u64::from(hunk.old_lines)));
            h.put(global, "newStart", JSValue::js_number_from_uint64(u64::from(hunk.new_start)));
            h.put(global, "newLines", JSValue::js_number_from_uint64(u64::from(hunk.new_lines)));
            let lines = JSValue::create_array_from_iter(
                global,
                hunk.lines.iter(),
                |(origin, text)| {
                    let line = JSValue::create_empty_object(global, 2);
                    let kind: &[u8] = match origin {
                        DiffOrigin::Context => b"context",
                        DiffOrigin::Add => b"add",
                        DiffOrigin::Del => b"del",
                    };
                    line.put(global, "kind", utf8_js(global, kind)?);
                    line.put(global, "text", utf8_js(global, text)?);
                    Ok(line)
                },
            )?;
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

fn compute_diff(root: &[u8], rel: &[u8]) -> Result<Option<DiffOut>, GitError> {
    let Some(repo) = Repository::discover(root)? else {
        return Ok(None);
    };
    let prefix = work_tree_prefix(repo.work_tree(), root);
    let repo_rel = join_rel(&prefix, rel);

    let odb = repo.odb()?;
    let head_tree = repo.head_tree(&odb)?;
    let mut too_large = false;

    let old_text = match head_tree.binary_search_by(|e| e.path.as_slice().cmp(repo_rel.as_slice()))
    {
        Err(_) => None,
        // A submodule has no blob to diff.
        Ok(i) if is_gitlink_mode(head_tree[i].mode) => None,
        Ok(i) => {
            let entry = &head_tree[i];
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
                Some(File::read_from(Fd::cwd(), &abs)?)
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
fn work_tree_prefix(work_tree: &[u8], root: &[u8]) -> Vec<u8> {
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

/// `dir` is absolute with no trailing separator; `rel` is `/`-separated.
fn join_abs(dir: &[u8], rel: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(dir.len() + rel.len() + 1);
    out.extend_from_slice(dir);
    out.push(b'/');
    out.extend_from_slice(rel);
    out
}

/// The worktree bytes git would hash for `repo_rel`: the symlink target for
/// symlinks, the raw file contents otherwise (no content filters).
fn read_worktree_file(
    work_tree: &[u8],
    repo_rel: &[u8],
    symlink: bool,
) -> Result<Vec<u8>, GitError> {
    let abs = join_abs(work_tree, repo_rel);
    if symlink {
        read_link_target(&abs)
    } else {
        Ok(File::read_from(Fd::cwd(), &abs)?)
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
