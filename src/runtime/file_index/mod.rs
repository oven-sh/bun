//! `Bun.FileIndex` — an in-memory codebase index for agent tooling: fuzzy
//! filename autocomplete, gitignore-aware crawling, and parallel content
//! search. The native store lives in `bun_file_index` (`src/file_index/`);
//! gitignore semantics in `bun_ignore` (`src/ignore/`); fuzzy scoring in
//! `bun_fuzzy` (`src/fuzzy/`).
//!
//! # Threading
//!
//! The [`bun_file_index::Store`] is owned by the JS thread (behind a
//! `RefCell`) and never crosses it. The crawl ([`crawl_task`]) and `grep()`
//! ([`grep_task`]) fan out on the work pool over owned, `Send` snapshots and
//! hand an owned, inert result back to the JS thread via a `ConcurrentTask`.

use core::cell::{Cell, RefCell};
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_core::ZStr;
use bun_file_index::{
    CompleteCache, CompleteOptions, CrawlEntry, CrawlResult, EntryKind, Meta, Store,
};
use bun_fuzzy::{Scorer, ScorerOptions};
use bun_ignore::{IgnoreChain, IgnoreFile};
use bun_io::KeepAlive;
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{
    self as jsc, CallFrame, ErrorCode, JSGlobalObject, JSValue, JsRef, JsResult, StringJsc as _,
    SysErrorJsc as _,
};
use bun_paths::resolve_path::join_string_buf;
use bun_paths::{PathBuffer, platform};
use bun_sys::Fd;

mod crawl_task;
mod git_task;
mod grep_task;
mod watcher;

pub use crate::generated_classes::js_FileIndex as js;
pub use crawl_task::CrawlTask;
pub use git_task::{GitDiffTask, GitStatusTask};
pub use grep_task::{GrepReadTask, GrepTask};
pub use watcher::WatchDelivery;

/// Default hard cap on bytes retained by the index (`maxMemory`).
const DEFAULT_MAX_MEMORY: usize = 64 * 1024 * 1024;
/// Default size above which `grep()` skips a file (`maxFileSize`).
const DEFAULT_MAX_FILE_SIZE: usize = 1024 * 1024;
/// Default `limit` for `complete()` when the caller does not pass one.
const DEFAULT_COMPLETE_LIMIT: usize = bun_file_index::DEFAULT_COMPLETE_LIMIT;

/// Options parsed once from `new Bun.FileIndex(root, options)`. They are
/// consumed by the crawl and grep paths.
pub(crate) struct Options {
    pub gitignore: bool,
    pub max_memory: usize,
    pub max_file_size: usize,
    /// Extra ignore patterns (gitignore syntax), applied as if appended to a
    /// `.gitignore` at the root.
    pub ignore: Vec<Box<[u8]>>,
    /// Keep the index live with a filesystem watcher (`watch: true`).
    pub watch: bool,
}

// Every JS-exposed method takes `&self` (`sharedThis`); per-field interior
// mutability via `Cell` / `RefCell`. `root` and `options` are read-only after
// construction. The `RefCell`s are never held across a call that can re-enter
// JS: results are copied out before any JS object is built.
#[bun_jsc::JsClass]
pub struct FileIndex {
    /// Absolute, `/`-separated root with no trailing separator.
    root: Box<[u8]>,
    options: Options,
    closed: Cell<bool>,
    store: RefCell<Store>,
    /// Reusable fuzzy-match scratch for `complete()`.
    scorer: RefCell<Scorer>,
    /// The previous `complete()` call's survivor set: while the user keeps
    /// typing (each query extending the last, same options) against an
    /// unmutated store, the next call only re-scores those survivors.
    /// Semantically invisible (`Store::generation` guards staleness);
    /// replaced after every call, dropped by `refresh()` and `close()`.
    complete_cache: RefCell<Option<CompleteCache>>,
    /// `HEAD`'s flattened tree, keyed by commit oid: `gitStatus()` and
    /// `gitDiff()` workers only re-flatten the (large) tree when `HEAD`
    /// actually moved. JS-thread state, like the store.
    git_head: RefCell<Option<git_task::HeadTreeCache>>,
    /// [`HeadTreeCache::memory_cost`] of `git_head`, folded into the bytes
    /// reported to the GC.
    git_head_bytes: Cell<usize>,
    /// The last crawl hit `maxMemory` before handing entries to the store.
    crawl_truncated: Cell<bool>,
    /// Entries/subtrees the last crawl skipped because of an I/O error
    /// (e.g. an `EACCES` subdirectory). Exposed as `index.errors`.
    crawl_errors: Cell<usize>,
    /// Bytes retained by the native store, mirrored here because
    /// `estimated_size` runs on the GC thread and must not touch the store.
    reported_bytes: AtomicUsize,
    /// The live filesystem watcher (`watch: true`), until `close()`.
    watcher: RefCell<Option<watcher::WatchHandle>>,
    /// `ready`/`refresh()` promises waiting for the watcher to acknowledge
    /// the post-crawl registration sync: `await index.ready` must imply
    /// "changes from here on are tracked".
    pending_ready: RefCell<Vec<jsc::JSPromiseStrong>>,
    /// Re-crawl diff events held back until the same acknowledgement, so a
    /// handler cannot observe rules the watcher is not yet enforcing.
    pending_events: RefCell<Vec<(WatchEventKind, Vec<u8>)>>,
    /// Self-reference, `Strong` while watching: a watching index (and its
    /// `onchange` slot) must never be collected before `close()`. `Weak`
    /// (i.e. inert) when not watching.
    this_ref: RefCell<JsRef>,
    /// Keeps the event loop alive while watching (like `fs.watch`), until
    /// `close()`.
    keep_alive: RefCell<KeepAlive>,
}

impl FileIndex {
    pub fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<Box<FileIndex>> {
        let [root_arg, options_arg] = callframe.arguments_as_array::<2>();
        if !root_arg.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "new Bun.FileIndex(root) expects a directory path string"
            )));
        }

        let root_slice = root_arg.to_slice(global)?;
        if root_slice.slice().is_empty() {
            return Err(global.throw_invalid_arguments(format_args!(
                "new Bun.FileIndex(root): root must not be empty"
            )));
        }

        let root = resolve_root(global, root_slice.slice())?;
        let (options, onchange) = parse_options(global, options_arg)?;
        let max_memory = options.max_memory;
        let watch = options.watch;

        let index = Box::new(FileIndex {
            root,
            options,
            closed: Cell::new(false),
            store: RefCell::new(Store::new(max_memory)),
            scorer: RefCell::new(Scorer::new(ScorerOptions::default())),
            complete_cache: RefCell::new(None),
            git_head: RefCell::new(None),
            git_head_bytes: Cell::new(0),
            crawl_truncated: Cell::new(false),
            crawl_errors: Cell::new(0),
            reported_bytes: AtomicUsize::new(0),
            watcher: RefCell::new(None),
            pending_ready: RefCell::new(Vec::new()),
            pending_events: RefCell::new(Vec::new()),
            this_ref: RefCell::new(JsRef::empty()),
            keep_alive: RefCell::new(KeepAlive::default()),
        });
        if let Some(onchange) = onchange {
            js::onchange_set_cached(this_value, global, onchange);
        }
        if watch {
            let handle = match watcher::WatchHandle::start(global, &index) {
                Ok(handle) => handle,
                Err(err) => {
                    let err_js = err.to_js(global);
                    return Err(global.throw_value(err_js));
                }
            };
            *index.watcher.borrow_mut() = Some(handle);
            // The wrapper (and its `onchange` slot) must survive without any
            // JS reference until `close()`; a watching index also keeps the
            // event loop alive, like `fs.watch`.
            index.this_ref.borrow_mut().set_strong(this_value, global);
            index.keep_alive.borrow_mut().ref_(bun_io::js_vm_ctx());
        }

        // The initial crawl. Its completion resolves `ready` with `this`; the
        // promise is also cached in the `readyPromise` slot for the getter.
        let ready = crawl_task::start_initial(global, this_value, &index);
        js::ready_promise_set_cached(this_value, global, ready);
        Ok(index)
    }

    // `onchange` is declared with `this: true` in `FileIndex.classes.ts`, so
    // the codegen thunk passes the wrapper cell as `this_value`. The pair
    // reads/writes the codegen'd `onchange` `values:` slot. An unassigned
    // slot reads back as `null` (the documented initial value), never
    // `undefined`.
    pub fn get_onchange(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::onchange_get_cached(this_value).unwrap_or(JSValue::NULL)
    }

    pub fn set_onchange(&self, this_value: JSValue, global: &JSGlobalObject, value: JSValue) {
        js::onchange_set_cached(this_value, global, value);
    }

    // The codegen'd finalizer hands back ownership of the heap allocation
    // and requires `fn finalize(self: Box<Self>)`; clippy::boxed_local is a
    // false positive on that contract.
    #[allow(clippy::boxed_local)]
    pub fn finalize(self: Box<Self>) {
        jsc::mark_binding();
        // A watcher can still be live here only when the heap is torn down
        // with a watching index (`finalize` cannot run earlier: the index
        // holds a strong self-reference until `close()`). Join its thread
        // before the state it points at is freed.
        let handle = self.watcher.borrow_mut().take();
        if let Some(mut handle) = handle {
            handle.close();
        }
        self.this_ref.borrow_mut().finalize();
    }

    /// Called from the GC thread: must only read plain atomics.
    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<FileIndex>() + self.reported_bytes.load(Ordering::Relaxed)
    }

    pub fn get_root(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_core::String::clone_utf8(&self.root).to_js(global)
    }

    pub fn get_ready(&self, this_value: JSValue, _global: &JSGlobalObject) -> JSValue {
        js::ready_promise_get_cached(this_value).unwrap_or(JSValue::UNDEFINED)
    }

    pub fn get_size(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(self.store.borrow().len() as u64)
    }

    pub fn get_memory_usage(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(self.reported_bytes.load(Ordering::Relaxed) as u64)
    }

    pub fn get_truncated(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(self.crawl_truncated.get() || self.store.borrow().truncated())
    }

    pub fn get_watching(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(self.is_watching())
    }

    pub fn get_errors(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(self.crawl_errors.get() as u64)
    }

    /// `index.complete(query, { limit, cwd, directories })`
    #[bun_jsc::host_fn(method)]
    pub fn complete(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let [query_arg, options_arg] = callframe.arguments_as_array::<2>();
        if !query_arg.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "FileIndex.complete(query) expects a string"
            )));
        }
        let query = query_arg.to_slice(global)?;

        let mut limit = DEFAULT_COMPLETE_LIMIT;
        let mut cwd: Vec<u8> = Vec::new();
        let mut dirs_only = false;
        if !options_arg.is_undefined_or_null() {
            if !options_arg.is_object() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "FileIndex.complete: options must be an object"
                )));
            }
            if let Some(v) = options_arg.get(global, "limit")?
                && !v.is_undefined_or_null()
            {
                limit = non_negative_int_option(global, v, "FileIndex.complete", "limit")?;
            }
            if let Some(v) = options_arg.get_truthy(global, "cwd")? {
                cwd = dir_prefix(global, v, "FileIndex.complete")?;
            }
            if let Some(v) = options_arg.get_truthy(global, "directories")? {
                dirs_only = v.to_boolean();
            }
        }

        // Copy the winners out of the store before building any JS value.
        // The per-keystroke narrowing cache is consulted (and replaced) here;
        // it is semantically invisible: `bun_file_index::complete_with_cache`
        // only reuses it for an extending query over an unmutated store.
        let matches: Vec<(Vec<u8>, i32, Vec<u32>)> = {
            let store = self.store();
            if !cwd_is_indexed_dir(&store, &cwd) {
                Vec::new()
            } else {
                let mut scorer = self.scorer.borrow_mut();
                let prev = self.complete_cache.borrow_mut().take();
                let (matches, cache) = bun_file_index::complete_with_cache(
                    &store,
                    &mut scorer,
                    query.slice(),
                    &CompleteOptions {
                        limit,
                        cwd_prefix: &cwd,
                        dirs_only,
                    },
                    prev.as_ref(),
                );
                *self.complete_cache.borrow_mut() = Some(cache);
                matches
                    .into_iter()
                    .map(|m| {
                        // Returned paths (and `positions`) are cwd-relative.
                        let path = &store.path(m.id)[cwd.len()..];
                        let mut positions = m.positions;
                        byte_positions_to_utf16(path, &mut positions);
                        (path.to_vec(), m.score, positions)
                    })
                    .collect()
            }
        };

        JSValue::create_array_from_iter(global, matches.into_iter(), |(path, score, positions)| {
            let obj = JSValue::create_empty_object(global, 3);
            obj.put(global, "path", utf8_js(global, &path)?);
            obj.put(global, "score", JSValue::js_number(f64::from(score)));
            let positions = JSValue::create_array_from_iter(global, positions.into_iter(), |p| {
                Ok(JSValue::js_number_from_uint64(u64::from(p)))
            })?;
            obj.put(global, "positions", positions);
            Ok(obj)
        })
    }

    /// `index.glob(pattern, { limit, cwd, onlyFiles })` — match indexed
    /// paths, no I/O. `cwd` has `Bun.Glob`'s semantics: the pattern is
    /// interpreted relative to it and the returned paths are relative to it.
    #[bun_jsc::host_fn(method)]
    pub fn glob(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let [pattern_arg, options_arg] = callframe.arguments_as_array::<2>();
        if !pattern_arg.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "FileIndex.glob(pattern) expects a string"
            )));
        }
        let pattern = pattern_arg.to_slice(global)?;
        let mut limit = usize::MAX;
        let mut cwd: Vec<u8> = Vec::new();
        let mut only_files = true;
        if !options_arg.is_undefined_or_null() {
            if !options_arg.is_object() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "FileIndex.glob: options must be an object"
                )));
            }
            if let Some(v) = options_arg.get(global, "limit")?
                && !v.is_undefined_or_null()
            {
                limit = non_negative_int_option(global, v, "FileIndex.glob", "limit")?;
            }
            if let Some(v) = options_arg.get_truthy(global, "cwd")? {
                cwd = dir_prefix(global, v, "FileIndex.glob")?;
            }
            if let Some(v) = options_arg.get(global, "onlyFiles")?
                && !v.is_undefined_or_null()
            {
                only_files = v.to_boolean();
            }
        }

        let paths: Vec<Vec<u8>> = {
            let store = self.store();
            if !cwd_is_indexed_dir(&store, &cwd) {
                Vec::new()
            } else {
                bun_file_index::glob(&store, pattern.slice(), &cwd)
                    .into_iter()
                    .filter(|&id| !only_files || store.kind(id) == EntryKind::File)
                    .take(limit)
                    .map(|id| store.path(id)[cwd.len()..].to_vec())
                    .collect()
            }
        };
        JSValue::create_array_from_iter(global, paths.into_iter(), |p| utf8_js(global, &p))
    }

    #[bun_jsc::host_fn(method)]
    pub fn has(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let path = rel_path_arg(global, callframe.argument(0), "FileIndex.has", "path")?;
        Ok(JSValue::js_boolean(
            self.store.borrow().get(&path).is_some(),
        ))
    }

    /// `index.stat(path)` — synchronous. The crawl is enumeration-only, so
    /// the first ask for an entry's stat is the one `lstat` that fills it;
    /// after that it is served from the store until a watcher event (or a
    /// `gitStatus()` re-stat) replaces it.
    #[bun_jsc::host_fn(method)]
    pub fn stat(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let path = rel_path_arg(global, callframe.argument(0), "FileIndex.stat", "path")?;
        let cached = {
            let store = self.store.borrow();
            match store.get(&path) {
                None => return Ok(JSValue::NULL),
                Some(id) => store.stat(id).copied(),
            }
        };
        let meta = match cached {
            Some(meta) => meta,
            None => match self.lstat_rel(&path) {
                Some(meta) => {
                    let mut store = self.store.borrow_mut();
                    if let Some(id) = store.get(&path) {
                        store.fill_stat(id, meta);
                    }
                    meta
                }
                // Indexed but no longer statable (it vanished, or became a
                // fifo/socket/device): nothing truthful to report. Only the
                // watcher mutates the entry set, never a read.
                None => return Ok(JSValue::NULL),
            },
        };
        let obj = JSValue::create_empty_object(global, 4);
        // `size` and `mtimeMs` are doubles, like `fs.Stats`.
        obj.put(global, "size", JSValue::js_number(meta.size as f64));
        let mtime_ms = meta.mtime_s as f64 * 1000.0 + f64::from(meta.mtime_ns) / 1_000_000.0;
        obj.put(global, "mtimeMs", JSValue::js_number(mtime_ms));
        obj.put(
            global,
            "mode",
            JSValue::js_number_from_uint64(u64::from(meta.mode)),
        );
        let kind: &[u8] = match meta.kind {
            EntryKind::File => b"file",
            EntryKind::Dir => b"dir",
            EntryKind::Symlink => b"symlink",
        };
        obj.put(global, "kind", utf8_js(global, kind)?);
        Ok(obj)
    }

    /// `index.touch(path)` — record an access (boosts `complete()` ranking).
    #[bun_jsc::host_fn(method)]
    pub fn touch(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let path = rel_path_arg(global, callframe.argument(0), "FileIndex.touch", "path")?;
        let mut store = self.store.borrow_mut();
        if let Some(id) = store.get(&path) {
            store.touch(id);
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn recent(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let limit_arg = callframe.argument(0);
        let limit = if limit_arg.is_undefined_or_null() {
            usize::MAX
        } else {
            non_negative_int_option(global, limit_arg, "FileIndex.recent", "limit")?
        };
        let paths: Vec<Vec<u8>> = {
            let store = self.store.borrow();
            store
                .recent(limit)
                .into_iter()
                .map(|id| store.path(id).to_vec())
                .collect()
        };
        JSValue::create_array_from_iter(global, paths.into_iter(), |p| utf8_js(global, &p))
    }

    /// `index.refresh()` — full re-crawl; resolves with `this`.
    #[bun_jsc::host_fn(method)]
    pub fn refresh(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        Ok(crawl_task::start_refresh(global, callframe.this(), self))
    }

    /// Native half of `index.grep()` (bound to the `pull` private symbol):
    /// validates, snapshots the candidate paths, and resolves with the full
    /// (capped) match array once the work-pool task finishes.
    #[bun_jsc::host_fn(method)]
    pub fn __grep(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let [pattern_arg, options_arg] = callframe.arguments_as_array::<2>();
        grep_task::start(self, global, pattern_arg, options_arg)
    }

    /// `grep(RegExp)` support (the `paths` private symbol): the same
    /// glob/cwd-admitted candidate snapshot the literal fast path uses (as
    /// relative path strings), plus the effective `maxFileSize`, so
    /// `src/js/builtins/FileIndex.ts` can read and test each candidate on
    /// the JS thread with the same per-file admission rules.
    #[bun_jsc::host_fn(method)]
    pub fn __grep_candidates(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        self.check_open(global)?;
        grep_task::candidates_js(self, global, callframe.argument(0))
    }

    /// `grep(RegExp)` support (the `read` private symbol): read ONE
    /// candidate off the JS thread through the same guarded
    /// open → `fstat(fd)` → read every other by-name open of an indexed
    /// path uses. Resolves with the decoded text, or `null` for a path
    /// that vanished, is no longer a regular file (a symlink swapped in is
    /// never followed, a writer-less FIFO never blocks), is over
    /// `maxFileSize`, or looks binary.
    #[bun_jsc::host_fn(method)]
    pub fn __grep_read(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let [path_arg, max_arg] = callframe.arguments_as_array::<2>();
        let path = rel_path_arg(global, path_arg, "FileIndex.grep", "path")?;
        let max_file_size = positive_int_option(global, max_arg, "FileIndex.grep", "maxFileSize")?;
        Ok(grep_task::start_read(self, global, &path, max_file_size))
    }

    /// `close()` observer for the `grep()` async iterator (the
    /// `closeRequested` private symbol). Never throws — it is exactly the
    /// query the post-close guard needs.
    #[bun_jsc::host_fn(method)]
    pub fn __closed(&self, _global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        Ok(JSValue::js_boolean(self.closed.get()))
    }

    /// `index.gitStatus()` — `git status --porcelain=v1` of the indexed view,
    /// computed in-process on the work pool. Resolves with `null` when `root`
    /// is not inside a git work tree. Callers should `await index.ready`
    /// first: the worktree side comes from the in-memory index (see
    /// [`git_task`]).
    #[bun_jsc::host_fn(method)]
    pub fn git_status(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        Ok(git_task::start_status(self, global, callframe.this()))
    }

    /// `index.gitDiff(path)` — line diff of the worktree file against `HEAD`,
    /// computed in-process on the work pool. Resolves with `null` when `root`
    /// is not inside a git work tree, or when `path` exists neither in `HEAD`
    /// nor in the worktree.
    #[bun_jsc::host_fn(method)]
    pub fn git_diff(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let path = rel_path_arg(global, callframe.argument(0), "FileIndex.gitDiff", "path")?;
        if path.is_empty() {
            return Err(global.throw_invalid_arguments(format_args!(
                "FileIndex.gitDiff(path): path must not be empty"
            )));
        }
        Ok(git_task::start_diff(self, global, callframe.this(), path))
    }

    /// `index.close()` — idempotent. Stops the watcher (signals its thread,
    /// closes the OS resources, and joins the thread), releases the store,
    /// and drops the self-reference so the wrapper can be collected.
    /// In-flight crawl and grep promises still settle (their tasks own
    /// everything they need).
    #[bun_jsc::host_fn(method)]
    pub fn close(&self, global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        if !self.closed.replace(true) {
            // Promises waiting on a watcher acknowledgement that will never
            // come still settle.
            self.settle_pending_ready(global);
            self.stop_watching();
            *self.complete_cache.borrow_mut() = None;
            *self.store.borrow_mut() = Store::new(0);
            *self.git_head.borrow_mut() = None;
            self.git_head_bytes.set(0);
            self.reported_bytes.store(0, Ordering::Relaxed);
        }
        Ok(JSValue::UNDEFINED)
    }
}

// Watcher integration. JS thread only.
impl FileIndex {
    /// Tear down the watcher (joining its thread) and release the self
    /// reference + event-loop ref it justified. Idempotent.
    fn stop_watching(&self) {
        let handle = self.watcher.borrow_mut().take();
        if let Some(mut handle) = handle {
            handle.close();
        }
        self.pending_events.borrow_mut().clear();
        self.keep_alive.borrow_mut().unref(bun_io::js_vm_ctx());
        // `downgrade`, not `Finalized`: `finalize` has not run.
        self.this_ref.borrow_mut().downgrade();
    }

    /// Hand the watcher the directory set of the (re)crawled index.
    fn sync_watcher(&self) {
        let watcher = self.watcher.borrow();
        let Some(watcher) = watcher.as_ref() else {
            return;
        };
        let dirs: Vec<Vec<u8>> = {
            let store = self.store();
            store
                .iter_sorted()
                .filter(|&id| store.kind(id) == EntryKind::Dir)
                .map(|id| store.path(id).to_vec())
                .collect()
        };
        watcher.sync(dirs, self.root_ignore_chain());
    }

    /// Apply one delivery of coalesced watch batches: re-`lstat` every dirty
    /// path, update the store (and the GC's view of retained memory), and
    /// only then invoke `onchange` with the resulting events.
    pub(crate) fn apply_watch_batches(
        &self,
        global: &JSGlobalObject,
        batches: Vec<watcher::Batch>,
    ) {
        if self.closed.get() {
            return;
        }
        let mut recrawl = false;
        let mut synced = false;
        let mut events: Vec<(WatchEventKind, Vec<u8>)> = Vec::new();
        {
            let mut store = self.store.borrow_mut();
            // The per-path reconcile reads `range_with_prefix`; an initial
            // crawl batch may have left the order dirty.
            store.ensure_sorted();
            for batch in batches {
                recrawl |= batch.recrawl;
                synced |= batch.synced;
                for path in batch.paths {
                    self.apply_one_path(&mut store, path, &mut events);
                }
            }
        }
        self.report_memory(global);
        // The re-crawl is started before the callback so a throwing
        // `onchange` cannot skip it.
        if recrawl && let Some(this_value) = self.this_value() {
            crawl_task::start_recrawl(global, this_value, self);
        }
        if synced {
            self.on_watch_synced(global);
        }
        self.emit_onchange(global, events);
    }

    /// `ready` (and `refresh()`) must not resolve, and re-crawl diffs must
    /// not be observable, before the watcher acknowledges the registration
    /// of that crawl's directories. Returns the promise unconsumed when
    /// there is nothing to wait for. JS thread.
    pub(crate) fn defer_until_synced(
        &self,
        promise: jsc::JSPromiseStrong,
    ) -> Option<jsc::JSPromiseStrong> {
        if self.closed.get() || self.watcher.borrow().is_none() {
            return Some(promise);
        }
        self.pending_ready.borrow_mut().push(promise);
        None
    }

    /// The watcher applied the latest [`watcher::WatchHandle::sync`]: settle
    /// everything that was waiting on it.
    fn on_watch_synced(&self, global: &JSGlobalObject) {
        self.settle_pending_ready(global);
        let events = core::mem::take(&mut *self.pending_events.borrow_mut());
        self.emit_onchange(global, events);
    }

    fn settle_pending_ready(&self, global: &JSGlobalObject) {
        let pending = core::mem::take(&mut *self.pending_ready.borrow_mut());
        if pending.is_empty() {
            return;
        }
        let this_value = self.this_value().unwrap_or(JSValue::UNDEFINED);
        for mut promise in pending {
            // `JsTerminated` here means the VM is going away; there is
            // nothing left to settle.
            let _ = promise.swap().resolve(global, this_value);
        }
    }

    /// Re-crawl completion for a watcher-initiated background re-crawl:
    /// replace the store, re-sync the watcher's directory set, and report
    /// the difference (paths that appeared / disappeared) as one batch.
    pub(crate) fn apply_recrawl(&self, global: &JSGlobalObject, result: CrawlResult) {
        let old_paths: Vec<Vec<u8>> = {
            let store = self.store();
            store
                .iter_sorted()
                .map(|id| store.path(id).to_vec())
                .collect()
        };
        self.apply_crawl(global, result);
        let mut events: Vec<(WatchEventKind, Vec<u8>)> = Vec::new();
        {
            let store = self.store.borrow();
            let mut new_iter = store.iter_sorted().peekable();
            let mut old_iter = old_paths.iter().peekable();
            // Both sides are sorted by path: a linear merge yields the diff.
            loop {
                match (old_iter.peek(), new_iter.peek()) {
                    (None, None) => break,
                    (Some(old), Some(&new_id)) => {
                        let new = store.path(new_id);
                        match old.as_slice().cmp(new) {
                            core::cmp::Ordering::Less => {
                                events.push((
                                    WatchEventKind::Delete,
                                    old_iter.next().cloned().unwrap_or_default(),
                                ));
                            }
                            core::cmp::Ordering::Greater => {
                                events.push((WatchEventKind::Create, new.to_vec()));
                                new_iter.next();
                            }
                            core::cmp::Ordering::Equal => {
                                old_iter.next();
                                new_iter.next();
                            }
                        }
                    }
                    (Some(_), None) => {
                        events.push((
                            WatchEventKind::Delete,
                            old_iter.next().cloned().unwrap_or_default(),
                        ));
                    }
                    (None, Some(&new_id)) => {
                        events.push((WatchEventKind::Create, store.path(new_id).to_vec()));
                        new_iter.next();
                    }
                }
            }
        }
        // Held back until the watcher acknowledges the new registration
        // (`on_watch_synced`), so the handler observes rules the watcher is
        // already enforcing. A non-watching index never gets here, but emit
        // directly if it somehow does.
        if self.watcher.borrow().is_some() {
            self.pending_events.borrow_mut().extend(events);
        } else {
            self.emit_onchange(global, events);
        }
    }

    /// Re-`lstat` one dirty path and reconcile the store with the result.
    /// A path that vanished and was an indexed directory takes its indexed
    /// descendants with it (the watcher cannot enumerate a tree that no
    /// longer exists).
    fn apply_one_path(
        &self,
        store: &mut Store,
        path: Vec<u8>,
        events: &mut Vec<(WatchEventKind, Vec<u8>)>,
    ) {
        if path.is_empty() {
            return;
        }
        match self.lstat_rel(&path) {
            // A path that now names a socket/fifo/device (or is gone) is
            // not indexable.
            Some(meta) => {
                let existed = store.get(&path).is_some();
                // A budget failure leaves the entry unindexed; `truncated`
                // already reports that state.
                let _ = store.upsert(&path, meta);
                if store.get(&path).is_some() {
                    let kind = if existed {
                        WatchEventKind::Modify
                    } else {
                        WatchEventKind::Create
                    };
                    events.push((kind, path));
                }
            }
            None => self.remove_path(store, &path, events),
        }
    }

    /// `lstat(<root>/<rel>)`, as a [`Meta`] (its stat block is real and may
    /// be fed to [`Store::fill_stat`]). `None` for an unstattable path or a
    /// kind the index never holds (socket/fifo/device).
    fn lstat_rel(&self, rel: &[u8]) -> Option<Meta> {
        let mut abs = Vec::with_capacity(self.root.len() + 1 + rel.len() + 1);
        abs.extend_from_slice(&self.root);
        abs.push(b'/');
        abs.extend_from_slice(rel);
        abs.push(0);
        let abs_z = ZStr::from_buf(&abs, abs.len() - 1);
        let raw = bun_sys::lstatat(Fd::cwd(), abs_z).ok()?;
        meta_from_stat(&bun_sys::PosixStat::init(&raw))
    }

    fn remove_path(
        &self,
        store: &mut Store,
        path: &[u8],
        events: &mut Vec<(WatchEventKind, Vec<u8>)>,
    ) {
        let Some(id) = store.get(path) else { return };
        if store.kind(id) == EntryKind::Dir {
            let mut prefix = path.to_vec();
            prefix.push(b'/');
            let descendants: Vec<Vec<u8>> = store
                .range_with_prefix(&prefix)
                .map(|id| store.path(id).to_vec())
                .collect();
            for descendant in descendants {
                store.remove(&descendant);
                events.push((WatchEventKind::Delete, descendant));
            }
        }
        store.remove(path);
        events.push((WatchEventKind::Delete, path.to_vec()));
    }

    /// Invoke `onchange` with `events` through `runCallback` semantics: a
    /// throwing callback is reported as an uncaught exception and breaks
    /// neither the watcher nor later deliveries.
    fn emit_onchange(&self, global: &JSGlobalObject, events: Vec<(WatchEventKind, Vec<u8>)>) {
        if events.is_empty() || self.closed.get() {
            return;
        }
        let Some(this_value) = self.this_value() else {
            return;
        };
        let Some(onchange) = js::onchange_get_cached(this_value) else {
            return;
        };
        if !onchange.is_callable() {
            return;
        }
        let array = JSValue::create_array_from_iter(global, events.into_iter(), |(kind, path)| {
            let obj = JSValue::create_empty_object(global, 2);
            obj.put(global, "kind", utf8_js(global, kind.as_str())?);
            obj.put(global, "path", utf8_js(global, &path)?);
            Ok(obj)
        });
        let array = match array {
            Ok(array) => array,
            Err(err) => {
                global.report_active_exception_as_unhandled(err);
                return;
            }
        };
        global
            .bun_vm()
            .event_loop_mut()
            .run_callback(onchange, global, this_value, &[array]);
    }

    /// The JS wrapper, while it is alive (always, between a `watch: true`
    /// construction and `close()`).
    fn this_value(&self) -> Option<JSValue> {
        self.this_ref.borrow().try_get()
    }

    /// The cached HEAD tree handed to a `gitStatus()`/`gitDiff()` worker
    /// (an `Arc` clone; the worker never mutates it).
    pub(crate) fn head_tree_cache(&self) -> Option<git_task::HeadTreeCache> {
        self.git_head.borrow().clone()
    }

    /// A worker had to (re)flatten the HEAD tree: cache it for the next
    /// call and fold its retained bytes into what the GC sees. JS thread.
    pub(crate) fn cache_head_tree(&self, global: &JSGlobalObject, cache: git_task::HeadTreeCache) {
        if self.closed.get() {
            return;
        }
        self.git_head_bytes.set(cache.memory_cost());
        *self.git_head.borrow_mut() = Some(cache);
        self.report_memory(global);
    }

    /// Re-report retained native bytes to the GC after a store mutation.
    fn report_memory(&self, global: &JSGlobalObject) {
        let new_bytes = self.store.borrow().memory_usage() + self.git_head_bytes.get();
        let old = self.reported_bytes.swap(new_bytes, Ordering::Relaxed);
        if let Some(grown) = new_bytes.checked_sub(old)
            && grown > 0
        {
            global.vm().report_extra_memory(grown);
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WatchEventKind {
    Create,
    Modify,
    Delete,
}

impl WatchEventKind {
    fn as_str(self) -> &'static [u8] {
        match self {
            WatchEventKind::Create => b"create",
            WatchEventKind::Modify => b"modify",
            WatchEventKind::Delete => b"delete",
        }
    }
}

pub(crate) fn meta_from_stat(stat: &bun_sys::PosixStat) -> Option<Meta> {
    let kind = match bun_core::kind_from_mode(stat.mode as bun_core::Mode) {
        bun_sys::EntryKind::Directory => EntryKind::Dir,
        bun_sys::EntryKind::File => EntryKind::File,
        bun_sys::EntryKind::SymLink => EntryKind::Symlink,
        _ => return None,
    };
    Some(Meta {
        size: stat.size,
        mode: stat.mode as u32,
        mtime_s: stat.mtim.sec,
        mtime_ns: stat.mtim.nsec as u32,
        ctime_s: stat.ctim.sec,
        ctime_ns: stat.ctim.nsec as u32,
        dev: stat.dev,
        ino: stat.ino,
        uid: stat.uid as u32,
        gid: stat.gid as u32,
        kind,
    })
}

// JS-thread helpers shared with the crawl/grep task modules.
impl FileIndex {
    fn check_open(&self, global: &JSGlobalObject) -> JsResult<()> {
        if self.closed.get() {
            return Err(global
                .err(
                    ErrorCode::INVALID_STATE,
                    format_args!("FileIndex is closed; create a new index to keep querying"),
                )
                .throw());
        }
        Ok(())
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.closed.get()
    }

    pub(crate) fn is_watching(&self) -> bool {
        self.watcher.borrow().is_some()
    }

    pub(crate) fn root_bytes(&self) -> &[u8] {
        &self.root
    }

    pub(crate) fn options(&self) -> &Options {
        &self.options
    }

    /// Borrow the store for a synchronous, JS-free read in path order. A
    /// progressive crawl batch may have left the sorted order dirty; this is
    /// the one place that re-sorts it (amortized over the batches applied
    /// since the last ordered read). Must not be called with the store
    /// already borrowed.
    pub(crate) fn store(&self) -> core::cell::Ref<'_, Store> {
        self.store.borrow_mut().ensure_sorted();
        self.store.borrow()
    }

    /// Ignore rules in force at the root before any per-directory
    /// `.gitignore` the crawl discovers, in increasing precedence
    /// (gitignore(5)): the global excludes file (`core.excludesFile`, else
    /// `$XDG_CONFIG_HOME/git/ignore`, else `~/.config/git/ignore`), then
    /// `$GIT_COMMON_DIR/info/exclude`, then every ancestor `.gitignore`
    /// from the work-tree top down to (but excluding) the index root, then
    /// the user's `ignore` patterns. All of the git sources require a
    /// discovered repository and `gitignore: true`; `.git/` itself is
    /// always excluded by the crawler.
    ///
    /// This is the ONE place the chain below the crawl is built; the
    /// initial crawl, `refresh()`, watcher re-crawls and the watcher's own
    /// event filter all start from it.
    pub(crate) fn root_ignore_chain(&self) -> IgnoreChain {
        let mut chain = IgnoreChain::empty();
        if self.options.gitignore
            && let Ok(Some(repo)) = bun_git::Repository::discover(&self.root)
        {
            // The index root relative to the work-tree top: every source
            // below lives in an ancestor of the root and is anchored there.
            let above = root_above_prefix(repo.work_tree(), &self.root);
            if let Some(file) = read_global_excludes(&repo, &above) {
                chain = chain.append(file);
            }
            let exclude = join_abs(repo.common_dir(), b"info/exclude");
            if let Some(file) = read_ignore_file_above(&exclude, &above) {
                chain = chain.append(file);
            }
            // Ancestor `.gitignore`s, work-tree top first (deepest wins),
            // down to but NOT including the index root (the crawl reads the
            // root's own `.gitignore` itself, like every other directory).
            let mut dir = repo.work_tree().to_vec();
            let mut rest: &[u8] = &above;
            while !rest.is_empty() {
                let path = join_abs(&dir, b".gitignore");
                if let Some(file) = read_ignore_file_above(&path, rest) {
                    chain = chain.append(file);
                }
                let Some(slash) = memchr::memchr(b'/', rest) else {
                    break;
                };
                dir.push(b'/');
                dir.extend_from_slice(&rest[..slash]);
                rest = &rest[slash + 1..];
            }
        }
        if !self.options.ignore.is_empty() {
            chain = chain.append(IgnoreFile::from_lines(
                b"",
                self.options.ignore.iter().map(|p| &**p),
            ));
        }
        chain
    }

    /// Replace the store with a crawl's result, re-report retained bytes,
    /// and hand the watcher (if any) the new directory set. JS thread only.
    pub(crate) fn apply_crawl(&self, global: &JSGlobalObject, result: CrawlResult) {
        // The cached survivor ids name entries of the outgoing store.
        *self.complete_cache.borrow_mut() = None;
        {
            let mut store = self.store.borrow_mut();
            // The touch/recency ring is keyed by `FileId`, which a store swap
            // invalidates: re-key it by path across the swap so `recent()` and
            // `complete()`'s frecency boost survive `refresh()`.
            let touched: Vec<Vec<u8>> = store
                .recent(usize::MAX)
                .into_iter()
                .map(|id| store.path(id).to_vec())
                .collect();
            // `new_after`: the replacement's generation starts past the old
            // store's, so a result snapshotted against the old store (the
            // gitStatus stat write-back) can never be applied to the new one
            // by an exact generation wraparound.
            *store = Store::new_after(self.options.max_memory, store.generation());
            store.bulk_load_enumerated(result.entries);
            // `recent()` is newest-first; replay oldest-first to preserve order.
            for path in touched.iter().rev() {
                if let Some(id) = store.get(path) {
                    store.touch(id);
                }
            }
        }
        self.crawl_truncated.set(result.truncated);
        self.crawl_errors.set(result.errors);
        self.report_memory(global);
        self.sync_watcher();
    }

    /// Apply one progressive batch of the initial crawl to the live store
    /// as it arrives, so `size` grows and `complete()`/`glob()`/`has()`
    /// answer on partial data before `ready` resolves. Appends without
    /// re-sorting; the next ordered read re-sorts once
    /// ([`FileIndex::store`]). JS thread only.
    pub(crate) fn apply_crawl_batch(&self, global: &JSGlobalObject, batch: Vec<CrawlEntry>) {
        if self.closed.get() {
            return;
        }
        self.store.borrow_mut().extend_enumerated(batch);
        self.report_memory(global);
    }

    /// Completion of the progressive initial crawl: its entries are already
    /// in the store ([`FileIndex::apply_crawl_batch`]); record the counters
    /// and hand the watcher the directory set to register. Registration is
    /// deliberately not per-batch: `ready` does not resolve until the
    /// watcher acknowledges this sync ([`FileIndex::defer_until_synced`]),
    /// so "after `await ready`, changes are tracked" holds either way, and a
    /// single registration pass is what keeps the watcher's full-replacement
    /// `sync` O(dirs).
    pub(crate) fn finish_initial_crawl(&self, global: &JSGlobalObject, result: &CrawlResult) {
        self.store.borrow_mut().ensure_sorted();
        self.crawl_truncated.set(result.truncated);
        self.crawl_errors.set(result.errors);
        self.report_memory(global);
        self.sync_watcher();
    }

    /// Write the status worker's freshly-`lstat`ed candidates back into the
    /// stat cache (git's `core.fsmonitor` model: the next `gitStatus()` of a
    /// *watching* index only re-stats what changed since). `None` means the
    /// candidate could not be stat'ed: a cached stat for it now lies.
    /// Dropped wholesale if the store mutated under the in-flight task.
    pub(crate) fn absorb_fresh_stats(
        &self,
        generation: u64,
        fresh: Vec<(Box<[u8]>, Option<Meta>)>,
    ) {
        if self.closed.get() {
            return;
        }
        let mut store = self.store.borrow_mut();
        if store.generation() != generation {
            return;
        }
        for (path, meta) in fresh {
            // The generation is unchanged, so every snapshotted path is
            // still present.
            let Some(id) = store.get(&path) else { continue };
            match meta {
                Some(meta) => store.fill_stat(id, meta),
                None => store.invalidate_stat(id),
            }
        }
    }
}

/// Resolve a user-supplied root to an absolute, separator-normalized path with
/// no trailing slash. Relative roots resolve against the process cwd.
fn resolve_root(global: &JSGlobalObject, root: &[u8]) -> JsResult<Box<[u8]>> {
    let mut out = PathBuffer::uninit();
    if bun_paths::is_absolute(root) {
        let joined = join_string_buf::<platform::Auto>(&mut out, &[root]);
        return Ok(Box::from(joined));
    }
    let mut cwd_buf = PathBuffer::uninit();
    let cwd = match bun_sys::getcwd_z(&mut cwd_buf) {
        Ok(z) => z.as_bytes(),
        Err(err) => {
            let err_js = err.to_js(global);
            return Err(global.throw_value(err_js));
        }
    };
    let joined = join_string_buf::<platform::Auto>(&mut out, &[cwd, root]);
    Ok(Box::from(joined))
}

/// Returns the parsed options and the `onchange` callback to seed the cached
/// slot with (if any).
fn parse_options(
    global: &JSGlobalObject,
    options_arg: JSValue,
) -> JsResult<(Options, Option<JSValue>)> {
    let mut options = Options {
        gitignore: true,
        max_memory: DEFAULT_MAX_MEMORY,
        max_file_size: DEFAULT_MAX_FILE_SIZE,
        ignore: Vec::new(),
        watch: false,
    };
    let mut onchange = None;
    if options_arg.is_undefined_or_null() {
        return Ok((options, onchange));
    }
    if !options_arg.is_object() {
        return Err(global.throw_invalid_arguments(format_args!(
            "new Bun.FileIndex: options must be an object"
        )));
    }

    if let Some(v) = options_arg.get(global, "gitignore")?
        && !v.is_undefined_or_null()
    {
        options.gitignore = v.to_boolean();
    }
    if let Some(v) = options_arg.get(global, "watch")? {
        options.watch = v.to_boolean();
    }
    if let Some(v) = options_arg.get(global, "onchange")?
        && !v.is_undefined_or_null()
    {
        if !v.is_callable() {
            return Err(global.throw_invalid_arguments(format_args!(
                "new Bun.FileIndex: onchange must be a function"
            )));
        }
        onchange = Some(v);
    }
    if let Some(v) = options_arg.get_truthy(global, "maxMemory")? {
        options.max_memory = positive_int_option(global, v, "new Bun.FileIndex", "maxMemory")?;
    }
    if let Some(v) = options_arg.get_truthy(global, "maxFileSize")? {
        options.max_file_size = positive_int_option(global, v, "new Bun.FileIndex", "maxFileSize")?;
    }
    if let Some(v) = options_arg.get_truthy(global, "ignore")? {
        options.ignore = parse_ignore_patterns(global, v)?;
    }

    Ok((options, onchange))
}

fn positive_int_option(
    global: &JSGlobalObject,
    v: JSValue,
    api: &str,
    name: &str,
) -> JsResult<usize> {
    if !v.is_number() {
        return Err(global.throw_invalid_arguments(format_args!("{api}: {name} must be a number")));
    }
    let n = v.to_int64();
    if n <= 0 {
        return Err(global
            .err(
                ErrorCode::OUT_OF_RANGE,
                format_args!("{api}: {name} must be a positive integer, got {n}"),
            )
            .throw());
    }
    Ok(usize::try_from(n).unwrap_or(usize::MAX))
}

fn non_negative_int_option(
    global: &JSGlobalObject,
    v: JSValue,
    api: &str,
    name: &str,
) -> JsResult<usize> {
    if !v.is_number() {
        return Err(global.throw_invalid_arguments(format_args!("{api}: {name} must be a number")));
    }
    let n = v.to_int64();
    if n < 0 {
        return Err(global
            .err(
                ErrorCode::OUT_OF_RANGE,
                format_args!("{api}: {name} must not be negative, got {n}"),
            )
            .throw());
    }
    Ok(usize::try_from(n).unwrap_or(usize::MAX))
}

/// `ignore: string | string[]` — each entry is one gitignore-syntax line.
fn parse_ignore_patterns(global: &JSGlobalObject, v: JSValue) -> JsResult<Vec<Box<[u8]>>> {
    let mut out: Vec<Box<[u8]>> = Vec::new();
    if v.is_string() {
        let s = v.to_slice(global)?;
        if !s.slice().is_empty() {
            out.push(Box::from(s.slice()));
        }
        return Ok(out);
    }
    if v.js_type() == jsc::JSType::Array {
        let len = v.get_length(global)?;
        let mut i: u32 = 0;
        while u64::from(i) < len {
            let item = v.get_index(global, i)?;
            if !item.is_string() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "new Bun.FileIndex: ignore must be a string or an array of strings"
                )));
            }
            let s = item.to_slice(global)?;
            if !s.slice().is_empty() {
                out.push(Box::from(s.slice()));
            }
            i += 1;
        }
        return Ok(out);
    }
    Err(global.throw_invalid_arguments(format_args!(
        "new Bun.FileIndex: ignore must be a string or an array of strings"
    )))
}

/// A path argument: a string, normalized to the index's relative,
/// `/`-separated form (no leading `./`, no trailing `/`).
///
/// SECURITY: `gitDiff` joins its argument to `root` and reads it, so this is
/// a boundary. NUL bytes, absolute paths, and any `..` component are
/// rejected (`ERR_INVALID_ARG_VALUE`), never normalized away.
fn rel_path_arg(global: &JSGlobalObject, v: JSValue, api: &str, arg: &str) -> JsResult<Vec<u8>> {
    if !v.is_string() {
        return Err(global.throw_invalid_arguments(format_args!("{api}: {arg} expects a string")));
    }
    let s = v.to_slice(global)?;
    let raw = s.slice();
    if let Some(reason) = invalid_rel_path(raw) {
        return Err(global
            .err(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!(
                    "{api}: {arg} must be a relative path inside the index root \
                     ({reason}); received {}",
                    bun_core::fmt::quote(raw)
                ),
            )
            .throw());
    }
    Ok(normalize_rel(raw).to_vec())
}

/// `Some(reason)` when `p` cannot name an index entry: a NUL byte, an
/// absolute path, or a `..` component (`..`, `../x`, `x/..`, `a/../b`).
fn invalid_rel_path(p: &[u8]) -> Option<&'static str> {
    if memchr::memchr(0, p).is_some() {
        return Some("it contains a NUL byte");
    }
    if bun_paths::is_absolute(p) || p.first() == Some(&b'/') {
        return Some("it is absolute");
    }
    // `\` is a separator on Windows; treating it as one everywhere keeps the
    // `..` rejection from depending on the host platform.
    if p.split(|&b| b == b'/' || b == b'\\').any(|c| c == b"..") {
        return Some("it contains a \"..\" component");
    }
    None
}

fn normalize_rel(mut p: &[u8]) -> &[u8] {
    while let Some(rest) = p.strip_prefix(b"./") {
        p = rest;
    }
    while let Some(rest) = p.strip_suffix(b"/") {
        p = rest;
    }
    if p == b"." { b"" } else { p }
}

/// The `cwd` option as a `range_with_prefix` prefix: `b""` for the root,
/// otherwise the normalized directory followed by `/`. Same validation as
/// [`rel_path_arg`].
fn dir_prefix(global: &JSGlobalObject, v: JSValue, api: &str) -> JsResult<Vec<u8>> {
    let rel = rel_path_arg(global, v, api, "cwd")?;
    if rel.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = rel;
    out.push(b'/');
    Ok(out)
}

/// True when `cwd` (the validated output of [`dir_prefix`]: `b""` or a
/// `/`-terminated relative directory) names the root or an indexed
/// directory. A `cwd` that is not an indexed directory yields no candidates:
/// `complete()`/`glob()`/`grep()` over it return nothing, the in-memory
/// analogue of `Bun.Glob`'s nonexistent `cwd` (which has no entries to
/// yield). Symlinks are never followed, so a symlink to a directory is not a
/// usable `cwd`.
pub(crate) fn cwd_is_indexed_dir(store: &Store, cwd: &[u8]) -> bool {
    if cwd.is_empty() {
        return true;
    }
    let dir = &cwd[..cwd.len() - 1];
    store
        .get(dir)
        .is_some_and(|id| store.kind(id) == EntryKind::Dir)
}

pub(crate) fn utf8_js(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
    bun_core::String::clone_utf8(bytes).to_js(global)
}

/// Leak a freshly-built [`ConcurrentPromiseTask`] onto the work pool and
/// return its promise (the `gitStatus`/`gitDiff`/`__grepRead` shape: one
/// task owns the promise and runs start to finish on one pool thread).
pub(crate) fn schedule<C: ConcurrentPromiseTaskContext>(
    global: &JSGlobalObject,
    job: Box<C>,
) -> JSValue {
    let task = ConcurrentPromiseTask::create_on_js_thread(global, job);
    let promise = task.promise.value();
    let raw = bun_core::heap::into_raw(task);
    // SAFETY: `raw` is freshly leaked; `schedule()` only writes the intrusive
    // `task` field into the work-pool queue (same hand-off as
    // `grep_task::start`). Freed by `run_then_destroy!` after dispatch.
    unsafe { (*raw).schedule() };
    promise
}

/// `dir` is absolute with no trailing separator; `rel` is `/`-separated.
pub(crate) fn join_abs(dir: &[u8], rel: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(dir.len() + rel.len() + 1);
    out.extend_from_slice(dir);
    out.push(b'/');
    out.extend_from_slice(rel);
    out
}

/// The index root relative to the repository work tree (no separators at
/// either end; empty when the root IS the work-tree top). This is the
/// `above` prefix every ancestor ignore source is anchored with.
fn root_above_prefix(work_tree: &[u8], root: &[u8]) -> Vec<u8> {
    let rest = root.strip_prefix(work_tree).unwrap_or_default();
    rest.strip_prefix(b"/").unwrap_or(rest).to_vec()
}

/// Parse the gitignore-format file at the absolute path `abs` (which lives
/// in `above`'s ancestor directory; see [`IgnoreFile::parse_above`]).
/// Absent, non-regular and empty files yield `None`. The open is the
/// guarded TOCTOU-safe one: these are by-name opens of derived paths.
fn read_ignore_file_above(abs: &[u8], above: &[u8]) -> Option<IgnoreFile> {
    match bun_file_index::read_regular_at(Fd::cwd(), abs, u64::MAX) {
        Ok(bun_file_index::FileReadOutcome::Contents(bytes)) => {
            let file = IgnoreFile::parse_above(above, &bytes);
            (!file.is_empty()).then_some(file)
        }
        _ => None,
    }
}

/// git's global excludes file (gitignore(5)): `core.excludesFile` from the
/// repository config if set, else `$XDG_CONFIG_HOME/git/ignore`, else
/// `~/.config/git/ignore`. Silently absent when none of those exist.
fn read_global_excludes(repo: &bun_git::Repository, above: &[u8]) -> Option<IgnoreFile> {
    let config_path = join_abs(repo.common_dir(), b"config");
    let configured = match bun_file_index::read_regular_at(Fd::cwd(), &config_path, u64::MAX) {
        Ok(bun_file_index::FileReadOutcome::Contents(bytes)) => {
            git_config_value(&bytes, b"core", b"excludesfile").map(|v| expand_user(&v))
        }
        _ => None,
    };
    let path = configured.or_else(default_global_excludes_path)?;
    read_ignore_file_above(&path, above)
}

/// `$XDG_CONFIG_HOME/git/ignore`, else `$HOME/.config/git/ignore`
/// (`config.c:git_xdg_config_home`).
fn default_global_excludes_path() -> Option<Vec<u8>> {
    if let Some(xdg) = bun_core::env_var::XDG_CONFIG_HOME::get()
        && !xdg.is_empty()
    {
        return Some(join_abs(xdg, b"git/ignore"));
    }
    let home = bun_core::env_var::HOME::get()?;
    if home.is_empty() {
        return None;
    }
    Some(join_abs(home, b".config/git/ignore"))
}

/// A leading `~/` in a config-supplied path means `$HOME/` (git's
/// `interpolate_path`). Other `~user/` forms are returned untouched.
fn expand_user(path: &[u8]) -> Vec<u8> {
    if let Some(rest) = path.strip_prefix(b"~/")
        && let Some(home) = bun_core::env_var::HOME::get()
        && !home.is_empty()
    {
        return join_abs(home, rest);
    }
    path.to_vec()
}

/// Minimal `git config` lookup: the last `key = value` inside `[section]`.
/// Only what `core.excludesFile` needs (gitconfig(5) `[section]` headers,
/// `#`/`;` comments, optional surrounding double quotes on the value);
/// subsections, includes and backslash escapes are not interpreted.
fn git_config_value(data: &[u8], section: &[u8], key: &[u8]) -> Option<Vec<u8>> {
    fn trim(mut s: &[u8]) -> &[u8] {
        while let Some((&b, rest)) = s.split_first()
            && (b == b' ' || b == b'\t' || b == b'\r')
        {
            s = rest;
        }
        while let Some((&b, rest)) = s.split_last()
            && (b == b' ' || b == b'\t' || b == b'\r')
        {
            s = rest;
        }
        s
    }
    let mut in_section = false;
    let mut found: Option<Vec<u8>> = None;
    for line in data.split(|&b| b == b'\n') {
        let line = trim(line);
        match line.first() {
            None | Some(b'#') | Some(b';') => continue,
            Some(b'[') => {
                in_section = memchr::memchr(b']', line)
                    .is_some_and(|end| trim(&line[1..end]).eq_ignore_ascii_case(section));
                continue;
            }
            Some(_) => {}
        }
        if !in_section {
            continue;
        }
        let Some(eq) = memchr::memchr(b'=', line) else {
            continue;
        };
        if !trim(&line[..eq]).eq_ignore_ascii_case(key) {
            continue;
        }
        let mut value = trim(&line[eq + 1..]);
        if value.len() >= 2 && value.first() == Some(&b'"') && value.last() == Some(&b'"') {
            value = &value[1..value.len() - 1];
        }
        found = Some(value.to_vec());
    }
    found
}

/// Number of UTF-16 code units `clone_utf8(bytes)` produces, so byte
/// offsets into a line can be reported as offsets into the JS string. An
/// astral scalar (4 UTF-8 bytes) is a surrogate pair; every invalid byte
/// becomes one U+FFFD, matching `clone_utf8`'s per-byte replacement.
pub(crate) fn utf16_units(bytes: &[u8]) -> usize {
    if bun_core::strings::first_non_ascii(bytes).is_none() {
        return bytes.len();
    }
    let mut units = 0usize;
    let mut at = 0usize;
    while at < bytes.len() {
        let (width, n) = match bytes[at] {
            0x00..=0x7F | 0x80..=0xBF | 0xC0..=0xC1 | 0xF5..=0xFF => (1, 1),
            0xC2..=0xDF => (2, 1),
            0xE0..=0xEF => (3, 1),
            0xF0..=0xF4 => (4, 2),
        };
        at += width;
        units += n;
    }
    units
}

/// `complete()` scores UTF-8 path bytes, but `path` reaches JS as a UTF-16
/// string: remap each ascending byte offset in `positions` to the index of
/// the JS string character that byte belongs to. Every byte of a multi-byte
/// scalar maps to the same index, so the result is deduplicated; an empty
/// no-op for the (common) all-ASCII path.
fn byte_positions_to_utf16(path: &[u8], positions: &mut Vec<u32>) {
    if positions.is_empty() || bun_core::strings::first_non_ascii(path).is_none() {
        return;
    }
    let mut byte = 0usize;
    let mut unit: u32 = 0;
    let mut i = 0;
    while i < positions.len() && byte < path.len() {
        // UTF-8 scalar width from the lead byte; an astral scalar (4 bytes)
        // is a surrogate pair (2 UTF-16 code units). Invalid bytes count as
        // one unit each, matching `clone_utf8`'s per-byte U+FFFD replacement.
        let (width, units) = match path[byte] {
            0x00..=0x7F | 0x80..=0xBF | 0xC0..=0xC1 | 0xF5..=0xFF => (1, 1),
            0xC2..=0xDF => (2, 1),
            0xE0..=0xEF => (3, 1),
            0xF0..=0xF4 => (4, 2),
        };
        let end = byte + width;
        while i < positions.len() && (positions[i] as usize) < end {
            positions[i] = unit;
            i += 1;
        }
        byte = end;
        unit += units;
    }
    while i < positions.len() {
        positions[i] = unit;
        i += 1;
    }
    positions.dedup();
}
