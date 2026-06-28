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

use bun_file_index::{CompleteOptions, CrawlResult, EntryKind, Store};
use bun_fuzzy::{Scorer, ScorerOptions};
use bun_ignore::{IgnoreChain, IgnoreFile};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, SysErrorJsc as _,
};
use bun_paths::resolve_path::join_string_buf;
use bun_paths::{PathBuffer, platform};
use bun_sys::{Fd, File, O};

mod crawl_task;
mod grep_task;

pub use crate::generated_classes::js_FileIndex as js;
pub use crawl_task::CrawlTask;
pub use grep_task::GrepTask;

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
        let options = parse_options(global, options_arg)?;
        let max_memory = options.max_memory;

        let index = Box::new(FileIndex {
            root,
            options,
            closed: Cell::new(false),
            store: RefCell::new(Store::new(max_memory)),
            scorer: RefCell::new(Scorer::new(ScorerOptions::default())),
            crawl_truncated: Cell::new(false),
            reported_bytes: AtomicUsize::new(0),
        });

        // The initial crawl. Its completion resolves `ready` with `this`; the
        // promise is also cached in the `readyPromise` slot for the getter.
        let ready = crawl_task::start(global, this_value, &index);
        js::ready_promise_set_cached(this_value, global, ready);
        Ok(index)
    }

    pub fn finalize(self: Box<Self>) {
        jsc::mark_binding();
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
        // The filesystem watcher is not implemented yet (`watch: true` is
        // rejected by the constructor), so an index is never watching.
        JSValue::js_boolean(false)
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

    /// `index.close()` — idempotent; releases the store. In-flight crawl and
    /// grep promises still settle (their tasks own everything they need).
    #[bun_jsc::host_fn(method)]
    pub fn close(&self, _global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        if !self.closed.replace(true) {
            *self.store.borrow_mut() = Store::new(0);
            self.reported_bytes.store(0, Ordering::Relaxed);
        }
        Ok(JSValue::UNDEFINED)
    }
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

    /// Replace the store with a crawl's result and re-report retained bytes.
    /// JS thread only.
    pub(crate) fn apply_crawl(&self, global: &JSGlobalObject, result: CrawlResult) {
        let new_bytes = {
            let mut store = self.store.borrow_mut();
            *store = Store::new(self.options.max_memory);
            store.bulk_load(result.entries);
            store.memory_usage()
        };
        self.crawl_truncated.set(result.truncated);
        let old = self.reported_bytes.swap(new_bytes, Ordering::Relaxed);
        if let Some(grown) = new_bytes.checked_sub(old)
            && grown > 0
        {
            global.vm().report_extra_memory(grown);
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

fn parse_options(global: &JSGlobalObject, options_arg: JSValue) -> JsResult<Options> {
    let mut options = Options {
        gitignore: true,
        max_memory: DEFAULT_MAX_MEMORY,
        max_file_size: DEFAULT_MAX_FILE_SIZE,
        ignore: Vec::new(),
    };
    if options_arg.is_undefined_or_null() {
        return Ok(options);
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
    if let Some(v) = options_arg.get(global, "watch")?
        && v.to_boolean()
    {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.FileIndex: watch is not implemented yet"
        )));
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

    Ok(options)
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
