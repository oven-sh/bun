//! `Bun.FileIndex` — an in-memory codebase index for agent tooling: fuzzy
//! filename autocomplete, gitignore-aware crawling and watching, parallel
//! content search, and in-process git status. The native store lives in
//! `bun_file_index` (`src/file_index/`); gitignore semantics in `bun_ignore`
//! (`src/ignore/`); fuzzy scoring in `bun_fuzzy` (`src/fuzzy/`); git internals
//! in `bun_git` (`src/git/`).

use core::cell::Cell;
use core::sync::atomic::{AtomicUsize, Ordering};

use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsCell, JsRef, JsResult, StringJsc as _,
    SysErrorJsc as _,
};
use bun_paths::resolve_path::join_string_buf;
use bun_paths::{PathBuffer, platform};

pub use crate::generated_classes::js_FileIndex as js;

/// Default hard cap on bytes retained by the index (`maxMemory`).
const DEFAULT_MAX_MEMORY: usize = 64 * 1024 * 1024;
/// Default size above which `grep()` skips a file (`maxFileSize`).
const DEFAULT_MAX_FILE_SIZE: usize = 1024 * 1024;

/// Options parsed once from `new Bun.FileIndex(root, options)`. They are
/// consumed by the crawl, watcher, grep, and git paths.
#[allow(dead_code)]
pub(crate) struct Options {
    pub gitignore: bool,
    pub watch: bool,
    pub max_memory: usize,
    pub max_file_size: usize,
    /// Extra ignore patterns (gitignore syntax), applied as if appended to a
    /// `.gitignore` at the root.
    pub ignore: Vec<Box<[u8]>>,
}

// Every JS-exposed method takes `&self` (`sharedThis`); per-field interior
// mutability via `Cell` / `JsCell`. `root` and `options` are read-only after
// construction.
#[bun_jsc::JsClass]
pub struct FileIndex {
    /// Absolute, `/`-separated root with no trailing separator.
    root: Box<[u8]>,
    options: Options,
    closed: Cell<bool>,
    /// Weak ref to the JS wrapper, upgraded to Strong while background work
    /// (crawl, grep, git, watcher) must keep the wrapper (and its cached value
    /// slots) alive, then downgraded so an idle, unreferenced index can be
    /// collected without `hasPendingActivity` polling.
    this_ref: JsCell<JsRef>,
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

        Ok(Box::new(FileIndex {
            root,
            options,
            closed: Cell::new(false),
            this_ref: JsCell::new(JsRef::init_weak(this_value)),
            reported_bytes: AtomicUsize::new(0),
        }))
    }

    pub fn finalize(self: Box<Self>) {
        jsc::mark_binding();
        self.this_ref.with_mut(|r| r.finalize());
    }

    /// Called from the GC thread: must only read plain atomics.
    pub fn estimated_size(&self) -> usize {
        core::mem::size_of::<FileIndex>() + self.reported_bytes.load(Ordering::Relaxed)
    }

    pub fn get_root(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        bun_core::String::clone_utf8(&self.root).to_js(global)
    }

    pub fn get_size(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(0)
    }

    pub fn get_memory_usage(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number_from_uint64(self.reported_bytes.load(Ordering::Relaxed) as u64)
    }

    pub fn get_truncated(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(false)
    }

    pub fn get_watching(&self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_boolean(self.options.watch && !self.closed.get())
    }

    /// `index.close()` — idempotent; stops the watcher and releases the store.
    #[bun_jsc::host_fn(method)]
    pub fn close(&self, _global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
        if !self.closed.replace(true) {
            self.this_ref.with_mut(JsRef::downgrade);
        }
        Ok(JSValue::UNDEFINED)
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
        watch: false,
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

    if let Some(v) = options_arg.get(global, "gitignore")? {
        if !v.is_undefined_or_null() {
            options.gitignore = v.to_boolean();
        }
    }
    if let Some(v) = options_arg.get(global, "watch")? {
        if !v.is_undefined_or_null() {
            options.watch = v.to_boolean();
        }
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
