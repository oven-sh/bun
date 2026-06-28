//! `FileIndex.grep()` — parallel literal content search over indexed files.
//!
//! The JS thread snapshots the candidate paths (glob/cwd filtered,
//! size-admitted) out of the store, then a single work-pool task reads each
//! file (one fd at a time) and runs `bun_file_index::grep_file` over it,
//! honoring `limit` and `context`. Nothing is retained; the promise resolves
//! with the full (capped) match array, which `src/js/builtins/FileIndex.ts`
//! exposes as an async iterable.

use bun_event_loop::TaskTag;
use bun_file_index::{GrepHit, GrepQuery, grep_file};
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{JSGlobalObject, JSPromise, JSValue, JsResult, JsTerminated};
use bun_sys::{Dir, O};

use super::{FileIndex, utf8_js};

pub type GrepTask<'a> = ConcurrentPromiseTask<'a, GrepJob<'a>>;

/// One `grep()` call: an owned snapshot of its inputs, run start to finish by
/// one work-pool task, plus the owned hits it produced.
pub struct GrepJob<'a> {
    global: &'a JSGlobalObject,
    root: Box<[u8]>,
    /// Candidate paths relative to `root`, in store (path) order.
    paths: Vec<Box<[u8]>>,
    query: GrepQuery,
    /// Total hit cap across all files (`usize::MAX` when unlimited).
    limit: usize,
    /// Lines of context captured before and after each hit.
    context: usize,
    hits: Vec<OwnedHit>,
}

/// One match, fully owned (the file's bytes do not outlive the read).
struct OwnedHit {
    path: Box<[u8]>,
    line: u32,
    column: u32,
    line_text: Box<[u8]>,
    before: Vec<Box<[u8]>>,
    after: Vec<Box<[u8]>>,
}

/// `grep()` options, validated once on the JS thread and shared by the
/// literal fast path ([`start`]) and the RegExp candidate snapshot
/// (`FileIndex::__grep_candidates`).
pub(crate) struct GrepArgs {
    glob: Option<Vec<u8>>,
    /// Empty, or a `/`-terminated `cwd` prefix.
    cwd: Vec<u8>,
    limit: usize,
    max_file_size: usize,
    case_sensitive: bool,
    context: usize,
}

pub(crate) fn parse_grep_options(
    index: &FileIndex,
    global: &JSGlobalObject,
    options_arg: JSValue,
) -> JsResult<GrepArgs> {
    let mut args = GrepArgs {
        glob: None,
        cwd: Vec::new(),
        limit: usize::MAX,
        max_file_size: index.options().max_file_size,
        case_sensitive: true,
        context: 0,
    };
    if options_arg.is_undefined_or_null() {
        return Ok(args);
    }
    if !options_arg.is_object() {
        return Err(global
            .throw_invalid_arguments(format_args!("FileIndex.grep: options must be an object")));
    }
    if let Some(v) = options_arg.get_truthy(global, "glob")? {
        if !v.is_string() {
            return Err(global
                .throw_invalid_arguments(format_args!("FileIndex.grep: glob must be a string")));
        }
        args.glob = Some(v.to_slice(global)?.slice().to_vec());
    }
    if let Some(v) = options_arg.get_truthy(global, "cwd")? {
        args.cwd = super::dir_prefix(global, v, "FileIndex.grep")?;
    }
    if let Some(v) = options_arg.get(global, "limit")?
        && !v.is_undefined_or_null()
    {
        args.limit = super::non_negative_int_option(global, v, "FileIndex.grep", "limit")?;
    }
    if let Some(v) = options_arg.get_truthy(global, "maxFileSize")? {
        args.max_file_size =
            super::positive_int_option(global, v, "FileIndex.grep", "maxFileSize")?;
    }
    if let Some(v) = options_arg.get(global, "caseSensitive")?
        && !v.is_undefined_or_null()
    {
        args.case_sensitive = v.to_boolean();
    }
    if let Some(v) = options_arg.get_truthy(global, "context")? {
        args.context = super::non_negative_int_option(global, v, "FileIndex.grep", "context")?;
    }
    Ok(args)
}

/// The store snapshot a grep over `args` searches: glob/cwd filtered, files
/// only, at most `max_file_size` bytes, in store (path) order.
pub(crate) fn candidate_paths(index: &FileIndex, args: &GrepArgs) -> Vec<Box<[u8]>> {
    let store = index.store();
    let admits = |id: bun_file_index::FileId| {
        let meta = store.meta(id);
        meta.kind == bun_file_index::EntryKind::File && meta.size <= args.max_file_size as u64
    };
    match &args.glob {
        Some(pattern) => bun_file_index::glob(&store, pattern)
            .into_iter()
            .filter(|&id| store.path(id).starts_with(args.cwd.as_slice()) && admits(id))
            .map(|id| Box::from(store.path(id)))
            .collect(),
        None => store
            .range_with_prefix(&args.cwd)
            .filter(|&id| admits(id))
            .map(|id| Box::from(store.path(id)))
            .collect(),
    }
}

/// Validate the arguments, snapshot the candidate set, and schedule the task.
pub(crate) fn start(
    index: &FileIndex,
    global: &JSGlobalObject,
    pattern_arg: JSValue,
    options_arg: JSValue,
) -> JsResult<JSValue> {
    if !pattern_arg.is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "FileIndex.grep(pattern) expects a string or a RegExp"
        )));
    }
    let needle = pattern_arg.to_slice(global)?;
    if needle.slice().is_empty() {
        return Err(global.throw_invalid_arguments(format_args!(
            "FileIndex.grep(pattern): pattern must not be empty"
        )));
    }
    let args = parse_grep_options(index, global, options_arg)?;

    // The needle is non-empty (checked above), so the query always compiles.
    let Some(query) = GrepQuery::literal(needle.slice(), args.case_sensitive, args.max_file_size)
    else {
        return Err(global.throw_invalid_arguments(format_args!(
            "FileIndex.grep(pattern): pattern must not be empty"
        )));
    };
    let paths = candidate_paths(index, &args);
    let (limit, context) = (args.limit, args.context);

    let job = Box::new(GrepJob {
        global,
        root: Box::from(index.root_bytes()),
        paths,
        query,
        limit,
        context,
        hits: Vec::new(),
    });
    let task = GrepTask::create_on_js_thread(global, job);
    let promise = task.promise.value();
    let raw = bun_core::heap::into_raw(task);
    // SAFETY: `raw` is freshly leaked; `schedule()` only writes the intrusive
    // `task` field into the work-pool queue (same hand-off as
    // `Image::schedule`). Freed by `run_then_destroy!` after dispatch.
    unsafe { (*raw).schedule() };
    Ok(promise)
}

impl ConcurrentPromiseTaskContext for GrepJob<'_> {
    const TASK_TAG: TaskTag = bun_event_loop::task_tag::FileIndexGrepTask;

    /// Work-pool thread: reads each candidate with a single open fd at a time
    /// and never touches the store or any JS state.
    fn run(&mut self) {
        let Self {
            root,
            paths,
            query,
            limit,
            context,
            hits,
            ..
        } = self;
        let Ok(dir) = Dir::open_with(root, O::CLOEXEC) else {
            return;
        };
        for path in paths.iter() {
            if hits.len() >= *limit {
                break;
            }
            // A path that vanished (or was swapped for a symlink) since the
            // snapshot is simply not searched.
            let Ok(file) = dir.open_file(path, O::RDONLY | O::NOFOLLOW | O::CLOEXEC, 0) else {
                continue;
            };
            let Ok(bytes) = file.read_to_end() else {
                continue;
            };
            grep_file(&bytes, query, path, &mut |path, hit| {
                hits.push(OwnedHit::capture(&bytes, path, &hit, *context));
                hits.len() < *limit
            });
        }
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        let global = self.global;
        let with_context = self.context > 0;
        let array = JSValue::create_array_from_iter(global, self.hits.iter(), |hit| {
            hit.to_js(global, with_context)
        });
        match array {
            Ok(array) => promise.resolve(global, array),
            Err(err) => promise.reject(global, Err(err)),
        }
    }
}

impl OwnedHit {
    fn capture(haystack: &[u8], path: &[u8], hit: &GrepHit<'_>, context: usize) -> OwnedHit {
        let line_start = hit.byte_offset - (hit.column as usize - 1);
        let (before, after) = if context == 0 {
            (Vec::new(), Vec::new())
        } else {
            (
                lines_before(haystack, line_start, context),
                lines_after(haystack, line_start, context),
            )
        };
        OwnedHit {
            path: Box::from(path),
            line: hit.line,
            column: hit.column,
            line_text: Box::from(hit.line_text),
            before,
            after,
        }
    }

    fn to_js(&self, global: &JSGlobalObject, with_context: bool) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, if with_context { 6 } else { 4 });
        obj.put(global, "path", utf8_js(global, &self.path)?);
        obj.put(
            global,
            "line",
            JSValue::js_number_from_uint64(u64::from(self.line)),
        );
        obj.put(
            global,
            "column",
            JSValue::js_number_from_uint64(u64::from(self.column)),
        );
        obj.put(global, "lineText", utf8_js(global, &self.line_text)?);
        if with_context {
            obj.put(global, "before", lines_js(global, &self.before)?);
            obj.put(global, "after", lines_js(global, &self.after)?);
        }
        Ok(obj)
    }
}

fn lines_js(global: &JSGlobalObject, lines: &[Box<[u8]>]) -> JsResult<JSValue> {
    JSValue::create_array_from_iter(global, lines.iter(), |l| utf8_js(global, l))
}

fn strip_eol(line: &[u8]) -> &[u8] {
    line.strip_suffix(b"\r").unwrap_or(line)
}

/// Up to `n` whole lines preceding the line that starts at `line_start`
/// (which is either 0 or preceded by a `\n`), in file order.
fn lines_before(haystack: &[u8], line_start: usize, n: usize) -> Vec<Box<[u8]>> {
    let mut out: Vec<Box<[u8]>> = Vec::new();
    let mut end = line_start;
    while out.len() < n && end > 0 {
        let newline = end - 1;
        let start = memchr::memrchr(b'\n', &haystack[..newline]).map_or(0, |i| i + 1);
        out.push(Box::from(strip_eol(&haystack[start..newline])));
        end = start;
    }
    out.reverse();
    out
}

/// Up to `n` whole lines following the line that starts at `line_start`.
fn lines_after(haystack: &[u8], line_start: usize, n: usize) -> Vec<Box<[u8]>> {
    let mut out: Vec<Box<[u8]>> = Vec::new();
    // The terminator of the hit line (its `\n`, or end of file).
    let mut at =
        memchr::memchr(b'\n', &haystack[line_start..]).map_or(haystack.len(), |i| line_start + i);
    while out.len() < n && at < haystack.len() {
        let start = at + 1;
        if start >= haystack.len() {
            break;
        }
        let end = memchr::memchr(b'\n', &haystack[start..]).map_or(haystack.len(), |i| start + i);
        out.push(Box::from(strip_eol(&haystack[start..end])));
        at = end;
    }
    out
}
