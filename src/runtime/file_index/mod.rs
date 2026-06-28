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
use bun_file_index::{CompleteOptions, CrawlResult, EntryKind, Meta, Store};
use bun_fuzzy::{Scorer, ScorerOptions};
use bun_ignore::{IgnoreChain, IgnoreFile};
use bun_io::KeepAlive;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, StringJsc as _,
    SysErrorJsc as _,
};
use bun_paths::resolve_path::join_string_buf;
use bun_paths::{PathBuffer, platform};
use bun_sys::{Fd, File, O};

mod crawl_task;
mod git_task;
mod grep_task;
mod watcher;

pub use crate::generated_classes::js_FileIndex as js;
pub use crawl_task::CrawlTask;
pub use git_task::{GitDiffTask, GitStatusTask};
pub use grep_task::GrepTask;
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
    /// The last crawl hit `maxMemory` before handing entries to the store.
    crawl_truncated: Cell<bool>,
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
            crawl_truncated: Cell::new(false),
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
        let ready = crawl_task::start(global, this_value, &index);
        js::ready_promise_set_cached(this_value, global, ready);
        Ok(index)
    }

    // `onchange` is declared with `this: true` in `FileIndex.classes.ts`, so
    // the codegen thunk passes the wrapper cell as `this_value`. The pair
    // reads/writes the codegen'd `onchange` `values:` slot.
    bun_jsc::cached_prop_hostfns! {
        crate::generated_classes::js_FileIndex;
        (get_onchange, set_onchange => onchange_get_cached, onchange_set_cached),
    }

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
        JSValue::js_boolean(self.watcher.borrow().is_some())
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
                limit = non_negative_int_option(global, v, "limit")?;
            }
            if let Some(v) = options_arg.get_truthy(global, "cwd")? {
                cwd = dir_prefix(global, v, "FileIndex.complete")?;
            }
            if let Some(v) = options_arg.get_truthy(global, "directories")? {
                dirs_only = v.to_boolean();
            }
        }

        // Copy the winners out of the store before building any JS value.
        let matches: Vec<(Vec<u8>, i32, Vec<u32>)> = {
            let store = self.store.borrow();
            let mut scorer = self.scorer.borrow_mut();
            bun_file_index::complete(
                &store,
                &mut scorer,
                query.slice(),
                &CompleteOptions {
                    limit,
                    cwd_prefix: &cwd,
                    dirs_only,
                },
            )
            .into_iter()
            .map(|m| (store.path(m.id).to_vec(), m.score, m.positions))
            .collect()
        };

        JSValue::create_array_from_iter(global, matches.into_iter(), |(path, score, positions)| {
            let obj = JSValue::create_empty_object(global, 3);
            obj.put(global, "path", utf8_js(global, &path)?);
            obj.put(global, "score", JSValue::js_number(f64::from(score)));
            let positions = JSValue::create_array_from_iter(
                global,
                positions.into_iter(),
                |p| Ok(JSValue::js_number_from_uint64(u64::from(p))),
            )?;
            obj.put(global, "positions", positions);
            Ok(obj)
        })
    }

    /// `index.glob(pattern, { limit, cwd })` — match indexed paths, no I/O.
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
        if !options_arg.is_undefined_or_null() {
            if !options_arg.is_object() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "FileIndex.glob: options must be an object"
                )));
            }
            if let Some(v) = options_arg.get(global, "limit")?
                && !v.is_undefined_or_null()
            {
                limit = non_negative_int_option(global, v, "limit")?;
            }
            if let Some(v) = options_arg.get_truthy(global, "cwd")? {
                cwd = dir_prefix(global, v, "FileIndex.glob")?;
            }
        }

        let paths: Vec<Vec<u8>> = {
            let store = self.store.borrow();
            bun_file_index::glob(&store, pattern.slice())
                .into_iter()
                .map(|id| store.path(id))
                .filter(|p| p.starts_with(&cwd))
                .take(limit)
                .map(<[u8]>::to_vec)
                .collect()
        };
        JSValue::create_array_from_iter(global, paths.into_iter(), |p| utf8_js(global, &p))
    }

    #[bun_jsc::host_fn(method)]
    pub fn has(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let path = rel_path_arg(global, callframe.argument(0), "FileIndex.has")?;
        Ok(JSValue::js_boolean(
            self.store.borrow().get(&path).is_some(),
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub fn stat(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let path = rel_path_arg(global, callframe.argument(0), "FileIndex.stat")?;
        let meta = {
            let store = self.store.borrow();
            store.get(&path).map(|id| *store.meta(id))
        };
        let Some(meta) = meta else {
            return Ok(JSValue::NULL);
        };
        let obj = JSValue::create_empty_object(global, 4);
        // `size` and `mtimeMs` are doubles, like `fs.Stats`.
        obj.put(global, "size", JSValue::js_number(meta.size as f64));
        let mtime_ms =
            meta.mtime_s as f64 * 1000.0 + f64::from(meta.mtime_ns) / 1_000_000.0;
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
        let path = rel_path_arg(global, callframe.argument(0), "FileIndex.touch")?;
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
            non_negative_int_option(global, limit_arg, "limit")?
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
        Ok(crawl_task::start(global, callframe.this(), self))
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

    /// `index.gitStatus()` — `git status --porcelain=v1` of the indexed view,
    /// computed in-process on the work pool. Resolves with `null` when `root`
    /// is not inside a git work tree. Callers should `await index.ready`
    /// first: the worktree side comes from the in-memory index (see
    /// [`git_task`]).
    #[bun_jsc::host_fn(method)]
    pub fn git_status(&self, global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        Ok(git_task::start_status(self, global))
    }

    /// `index.gitDiff(path)` — line diff of the worktree file against `HEAD`,
    /// computed in-process on the work pool. Resolves with `null` when `root`
    /// is not inside a git work tree, or when `path` exists neither in `HEAD`
    /// nor in the worktree.
    #[bun_jsc::host_fn(method)]
    pub fn git_diff(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.check_open(global)?;
        let path = rel_path_arg(global, callframe.argument(0), "FileIndex.gitDiff")?;
        if path.is_empty() {
            return Err(global.throw_invalid_arguments(format_args!(
                "FileIndex.gitDiff(path): path must not be empty"
            )));
        }
        Ok(git_task::start_diff(self, global, path))
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
            *self.store.borrow_mut() = Store::new(0);
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
            let store = self.store.borrow();
            store
                .iter_sorted()
                .filter(|&id| store.meta(id).kind == EntryKind::Dir)
                .map(|id| store.path(id).to_vec())
                .collect()
        };
        watcher.sync(dirs, self.root_ignore_chain());
    }

    /// Apply one delivery of coalesced watch batches: re-`lstat` every dirty
    /// path, update the store (and the GC's view of retained memory), and
    /// only then invoke `onchange` with the resulting events.
    pub(crate) fn apply_watch_batches(&self, global: &JSGlobalObject, batches: Vec<watcher::Batch>) {
        if self.closed.get() {
            return;
        }
        let mut recrawl = false;
        let mut synced = false;
        let mut events: Vec<(WatchEventKind, Vec<u8>)> = Vec::new();
        {
            let mut store = self.store.borrow_mut();
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
        if recrawl
            && let Some(this_value) = self.this_value()
        {
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
            let store = self.store.borrow();
            store.iter_sorted().map(|id| store.path(id).to_vec()).collect()
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
                                events.push((WatchEventKind::Delete, old_iter.next().map(Vec::clone).unwrap_or_default()));
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
                            old_iter.next().map(Vec::clone).unwrap_or_default(),
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
        let mut abs = Vec::with_capacity(self.root.len() + 1 + path.len() + 1);
        abs.extend_from_slice(&self.root);
        abs.push(b'/');
        abs.extend_from_slice(&path);
        abs.push(0);
        let abs_z = ZStr::from_buf(&abs, abs.len() - 1);
        match bun_sys::lstatat(Fd::cwd(), abs_z) {
            Ok(st) => {
                let stat = bun_sys::PosixStat::init(&st);
                let Some(meta) = meta_from_stat(&stat) else {
                    // The path now names a socket/fifo/device: not indexable.
                    self.remove_path(store, &path, events);
                    return;
                };
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
            Err(_) => self.remove_path(store, &path, events),
        }
    }

    fn remove_path(
        &self,
        store: &mut Store,
        path: &[u8],
        events: &mut Vec<(WatchEventKind, Vec<u8>)>,
    ) {
        let Some(id) = store.get(path) else { return };
        if store.meta(id).kind == EntryKind::Dir {
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

    /// Re-report retained native bytes to the GC after a store mutation.
    fn report_memory(&self, global: &JSGlobalObject) {
        let new_bytes = self.store.borrow().memory_usage();
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

fn meta_from_stat(stat: &bun_sys::PosixStat) -> Option<Meta> {
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
            return Err(global.throw(format_args!(
                "FileIndex is closed; create a new index to keep querying"
            )));
        }
        Ok(())
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.closed.get()
    }

    pub(crate) fn root_bytes(&self) -> &[u8] {
        &self.root
    }

    pub(crate) fn options(&self) -> &Options {
        &self.options
    }

    /// Borrow the store for a synchronous, JS-free read.
    pub(crate) fn store(&self) -> core::cell::Ref<'_, Store> {
        self.store.borrow()
    }

    /// Ignore rules in force at the root before any per-directory
    /// `.gitignore`: `.git/info/exclude` (when `gitignore` is on), then the
    /// user's `ignore` patterns. `.git/` itself is excluded by the crawler.
    pub(crate) fn root_ignore_chain(&self) -> IgnoreChain {
        let mut chain = IgnoreChain::empty();
        if self.options.gitignore
            && let Some(file) = self.read_git_info_exclude()
            && !file.is_empty()
        {
            chain = chain.append(file);
        }
        if !self.options.ignore.is_empty() {
            chain = chain.append(IgnoreFile::from_lines(
                b"",
                self.options.ignore.iter().map(|p| &**p),
            ));
        }
        chain
    }

    /// Absent or unreadable files are treated as empty (the crawl proceeds).
    fn read_git_info_exclude(&self) -> Option<IgnoreFile> {
        let mut path = self.root.to_vec();
        path.extend_from_slice(b"/.git/info/exclude");
        let file = File::openat(Fd::cwd(), &path, O::RDONLY | O::CLOEXEC, 0).ok()?;
        let bytes = file.read_to_end().ok()?;
        Some(IgnoreFile::parse(b"", &bytes))
    }

    /// Replace the store with a crawl's result, re-report retained bytes,
    /// and hand the watcher (if any) the new directory set. JS thread only.
    pub(crate) fn apply_crawl(&self, global: &JSGlobalObject, result: CrawlResult) {
        {
            let mut store = self.store.borrow_mut();
            *store = Store::new(self.options.max_memory);
            store.bulk_load(result.entries);
        }
        self.crawl_truncated.set(result.truncated);
        self.report_memory(global);
        self.sync_watcher();
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
            "Bun.FileIndex: options must be an object"
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
                "Bun.FileIndex: onchange must be a function"
            )));
        }
        onchange = Some(v);
    }
    if let Some(v) = options_arg.get_truthy(global, "maxMemory")? {
        options.max_memory = positive_int_option(global, v, "maxMemory")?;
    }
    if let Some(v) = options_arg.get_truthy(global, "maxFileSize")? {
        options.max_file_size = positive_int_option(global, v, "maxFileSize")?;
    }
    if let Some(v) = options_arg.get_truthy(global, "ignore")? {
        options.ignore = parse_ignore_patterns(global, v)?;
    }

    Ok((options, onchange))
}

fn positive_int_option(global: &JSGlobalObject, v: JSValue, name: &str) -> JsResult<usize> {
    if !v.is_number() {
        return Err(global
            .throw_invalid_arguments(format_args!("Bun.FileIndex: {name} must be a number")));
    }
    let n = v.to_int64();
    if n <= 0 {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.FileIndex: {name} must be a positive integer, got {n}"
        )));
    }
    Ok(usize::try_from(n).unwrap_or(usize::MAX))
}

fn non_negative_int_option(global: &JSGlobalObject, v: JSValue, name: &str) -> JsResult<usize> {
    if !v.is_number() {
        return Err(global
            .throw_invalid_arguments(format_args!("Bun.FileIndex: {name} must be a number")));
    }
    let n = v.to_int64();
    if n < 0 {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.FileIndex: {name} must not be negative, got {n}"
        )));
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
                    "Bun.FileIndex: ignore must be a string or an array of strings"
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
        "Bun.FileIndex: ignore must be a string or an array of strings"
    )))
}

/// A path argument: a string, normalized to the index's relative,
/// `/`-separated form (no leading `./` or `/`, no trailing `/`).
fn rel_path_arg(global: &JSGlobalObject, v: JSValue, api: &str) -> JsResult<Vec<u8>> {
    if !v.is_string() {
        return Err(global.throw_invalid_arguments(format_args!("{api}(path) expects a string")));
    }
    let s = v.to_slice(global)?;
    Ok(normalize_rel(s.slice()).to_vec())
}

fn normalize_rel(mut p: &[u8]) -> &[u8] {
    while let Some(rest) = p.strip_prefix(b"./") {
        p = rest;
    }
    while let Some(rest) = p.strip_prefix(b"/") {
        p = rest;
    }
    while let Some(rest) = p.strip_suffix(b"/") {
        p = rest;
    }
    if p == b"." { b"" } else { p }
}

/// The `cwd` option as a `range_with_prefix` prefix: `b""` for the root,
/// otherwise the normalized directory followed by `/`.
fn dir_prefix(global: &JSGlobalObject, v: JSValue, api: &str) -> JsResult<Vec<u8>> {
    if !v.is_string() {
        return Err(global.throw_invalid_arguments(format_args!("{api}: cwd must be a string")));
    }
    let s = v.to_slice(global)?;
    let rel = normalize_rel(s.slice());
    if rel.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = rel.to_vec();
    out.push(b'/');
    Ok(out)
}

pub(crate) fn utf8_js(global: &JSGlobalObject, bytes: &[u8]) -> JsResult<JSValue> {
    bun_core::String::clone_utf8(bytes).to_js(global)
}
