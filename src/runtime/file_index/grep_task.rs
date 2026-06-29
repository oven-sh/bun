//! `FileIndex.grep()` — parallel literal content search over indexed files.
//!
//! The JS thread snapshots the candidate paths (glob/cwd filtered, files
//! only, path-sorted) out of the store, splits them into contiguous chunks,
//! and fans the chunks out as concurrent work-pool subtasks (the
//! `bun_file_index::crawl` shape: an atomic in-flight counter, results into
//! a mutexed accumulator, and the LAST subtask to finish re-schedules the
//! single owning [`ConcurrentPromiseTask`], which merges on the pool and
//! resolves on the JS thread). Each subtask reads its files through the
//! guarded `open(O_NOFOLLOW|O_NONBLOCK)` + `fstat(fd)` helper
//! ([`bun_file_index::read_regular_at`]) — one root fd plus at most one file
//! fd per subtask is ever open — and runs `bun_file_index::grep_file` over
//! the bytes, honoring `limit` and `context`. Nothing is retained; the
//! promise resolves with the full (capped) match array, sorted by
//! `(path, line, column)`, which `src/js/builtins/FileIndex.ts` exposes as
//! an async iterable.
//!
//! GC story: the ONE `ConcurrentPromiseTask` owns the promise; the chunk
//! subtasks share only an [`Arc<GrepShared>`] of plain data and never touch
//! a JS value.

use core::sync::atomic::{AtomicPtr, AtomicUsize, Ordering};
use std::sync::Arc;

use bun_core::handle_oom;
use bun_event_loop::TaskTag;
use bun_file_index::{
    FileReadOutcome, GrepHit, GrepQuery, grep_file, is_binary_prefix, read_regular_at,
};
use bun_jsc::concurrent_promise_task::{ConcurrentPromiseTask, ConcurrentPromiseTaskContext};
use bun_jsc::{JSGlobalObject, JSPromise, JSValue, JsResult, JsTerminated};
use bun_sys::{Dir, Fd, O};
use bun_threading::{GuardedBy, Mutex, WorkPoolTask, work_pool::WorkPool};

use super::{FileIndex, schedule, utf8_js, utf16_units};

pub type GrepTask<'a> = ConcurrentPromiseTask<'a, GrepJob<'a>>;
pub type GrepReadTask<'a> = ConcurrentPromiseTask<'a, GrepReadJob<'a>>;

/// Candidates per chunk below which a grep stays a single subtask.
const GREP_MIN_CHUNK: usize = 32;
/// Hard cap on concurrent grep subtasks (and therefore on the file
/// descriptors a grep can hold open at once: one shared root fd + at most
/// one file fd per subtask).
const GREP_MAX_CHUNKS: usize = 16;

/// One `grep()` call: the owning task. Its `run()` only merges what the
/// chunk subtasks accumulated in [`GrepShared`]; all file I/O happens in
/// the subtasks.
pub struct GrepJob<'a> {
    global: &'a JSGlobalObject,
    shared: Arc<GrepShared>,
    context: usize,
    hits: Vec<OwnedHit>,
}

/// State shared by every chunk subtask of one `grep()` (plain data; no JS).
struct GrepShared {
    /// The opened index root every chunk `openat`s its candidates from.
    /// `None` only when the root could not be opened (the grep is empty).
    dir: Option<Dir>,
    /// Candidate paths relative to the root, in path (= store) order.
    paths: Vec<Box<[u8]>>,
    /// Contiguous, in-order ranges of `paths`, one per subtask.
    chunks: Vec<core::ops::Range<usize>>,
    query: GrepQuery,
    /// Total hit cap across all files (`usize::MAX` when unlimited).
    limit: usize,
    /// Lines of context captured before and after each hit.
    context: usize,
    /// Per-chunk hit counts (relaxed). Chunks are contiguous in path order,
    /// so once `sum(counts[..=k]) >= limit` every further hit chunk `k`
    /// could produce is outside the first `limit` in `(path, line, column)`
    /// order and chunk `k` stops. A stale (low) read only delays the stop.
    counts: Vec<AtomicUsize>,
    /// `(chunk index, its hits)`, pushed once per finished chunk.
    results: GuardedBy<Vec<(usize, Vec<OwnedHit>)>, Mutex>,
    /// Chunks still running; the one that drops it to zero completes.
    pending: AtomicUsize,
    /// The parked owning task's intrusive work-pool node, scheduled exactly
    /// once by the last chunk. Stored before any chunk is spawned.
    node: AtomicPtr<WorkPoolTask>,
}

/// One match, fully owned (the file's bytes do not outlive the read).
/// `column` is already in 1-based UTF-16 code units into `line_text`; it is
/// only narrowed (to an f64) when the hit object is built for JS.
struct OwnedHit {
    path: Box<[u8]>,
    line: u32,
    column: usize,
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
/// only, in store (path) order, *relative to `args.cwd`* (`Bun.Glob`'s `cwd`
/// semantics: the `glob` pattern is interpreted relative to it and hit paths
/// are reported relative to it). A `cwd` that is not an indexed directory
/// has no candidates. Admission is by kind alone — the index has no
/// crawl-time sizes; `maxFileSize` is enforced against the OPEN file
/// (`fstat`), by the worker for literal queries and by `__grepRead` for
/// RegExp ones.
pub(crate) fn candidate_paths(index: &FileIndex, args: &GrepArgs) -> Vec<Box<[u8]>> {
    let store = index.store();
    if !super::cwd_is_indexed_dir(&store, &args.cwd) {
        return Vec::new();
    }
    let strip = args.cwd.len();
    let admits = |id: bun_file_index::FileId| GrepQuery::admits(store.kind(id));
    match &args.glob {
        Some(pattern) => bun_file_index::glob(&store, pattern, &args.cwd)
            .into_iter()
            .filter(|&id| admits(id))
            .map(|id| Box::from(&store.path(id)[strip..]))
            .collect(),
        None => store
            .range_with_prefix(&args.cwd)
            .filter(|&id| admits(id))
            .map(|id| Box::from(&store.path(id)[strip..]))
            .collect(),
    }
}

/// The absolute directory candidate paths are relative to: the index root,
/// or `<root>/<cwd>` when the grep is scoped to a `cwd`.
fn grep_dir(index: &FileIndex, args: &GrepArgs) -> Vec<u8> {
    if args.cwd.is_empty() {
        return index.root_bytes().to_vec();
    }
    super::join_abs(index.root_bytes(), &args.cwd[..args.cwd.len() - 1])
}

/// `FileIndex.__grepCandidates(options)`: the RegExp path's snapshot. Same
/// (cwd-relative) candidate set as the literal fast path, plus the `cwd`
/// prefix `__grepRead` needs to locate each candidate from the root, and
/// the VALIDATED `maxFileSize`, `limit` and `context` the JS shim must use.
/// The shim never re-reads the user's options object: this is the one
/// parse, so the literal and RegExp engines agree on every option (and a
/// getter on the options object observably runs once).
pub(crate) fn candidates_js(
    index: &FileIndex,
    global: &JSGlobalObject,
    options_arg: JSValue,
) -> JsResult<JSValue> {
    let args = parse_grep_options(index, global, options_arg)?;
    let paths = candidate_paths(index, &args);
    let obj = JSValue::create_empty_object(global, 5);
    let paths =
        JSValue::create_array_from_iter(global, paths.into_iter(), |p| utf8_js(global, &p))?;
    obj.put(global, "paths", paths);
    obj.put(global, "prefix", utf8_js(global, &args.cwd)?);
    obj.put(
        global,
        "maxFileSize",
        JSValue::js_number_from_uint64(args.max_file_size as u64),
    );
    obj.put(
        global,
        "limit",
        JSValue::js_number_from_uint64(args.limit as u64),
    );
    obj.put(
        global,
        "context",
        JSValue::js_number_from_uint64(args.context as u64),
    );
    Ok(obj)
}

/// Validate the arguments, snapshot the candidate set, and fan it out.
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
    // A root (or cwd) that cannot be opened (it vanished) greps nothing,
    // exactly as if every candidate had vanished individually.
    let dir = Dir::open_with(&grep_dir(index, &args), O::CLOEXEC).ok();
    let chunks = if dir.is_some() {
        chunk_ranges(paths.len(), args.limit)
    } else {
        Vec::new()
    };
    let pending = chunks.len();
    let shared = Arc::new(GrepShared {
        dir,
        paths,
        counts: (0..pending).map(|_| AtomicUsize::new(0)).collect(),
        chunks,
        query,
        limit: args.limit,
        context: args.context,
        results: GuardedBy::init(Vec::new()),
        pending: AtomicUsize::new(pending),
        node: AtomicPtr::new(core::ptr::null_mut()),
    });
    let job = Box::new(GrepJob {
        global,
        shared: Arc::clone(&shared),
        context: args.context,
        hits: Vec::new(),
    });
    let task = GrepTask::create_on_js_thread(global, job);
    let promise = task.promise.value();
    let raw = bun_core::heap::into_raw(task);
    if pending == 0 {
        // Nothing to search: the task's `run` is the (empty) merge.
        // SAFETY: `raw` is freshly leaked; `schedule()` only writes the
        // intrusive `task` field into the work-pool queue (same hand-off as
        // `Image::schedule`). Freed by `run_then_destroy!` after dispatch.
        unsafe { (*raw).schedule() };
        return Ok(promise);
    }
    // SAFETY: `raw` is the freshly leaked, *parked* owning task: nothing
    // dereferences it until the chunk that drops `pending` to zero schedules
    // this node, exactly once, after which the normal work-pool → JS-thread
    // hand-off owns it. Only the node's address crosses threads.
    shared
        .node
        .store(unsafe { &raw mut (*raw).task }, Ordering::Release);
    for chunk in 0..pending {
        handle_oom(WorkPool::go(
            ChunkJob {
                shared: Arc::clone(&shared),
                index: chunk,
            },
            run_chunk,
        ));
    }
    Ok(promise)
}

/// Split `n` path-sorted candidates into contiguous, in-order chunks: one
/// per [`GREP_MIN_CHUNK`] candidates, at most [`GREP_MAX_CHUNKS`]. A
/// `limit: 0` grep has nothing to do.
fn chunk_ranges(n: usize, limit: usize) -> Vec<core::ops::Range<usize>> {
    if n == 0 || limit == 0 {
        return Vec::new();
    }
    let chunks = n.div_ceil(GREP_MIN_CHUNK).clamp(1, GREP_MAX_CHUNKS);
    let per = n.div_ceil(chunks);
    (0..chunks)
        .map(|i| (i * per).min(n)..((i + 1) * per).min(n))
        .filter(|r| !r.is_empty())
        .collect()
}

/// One fan-out subtask: greps the contiguous candidate range
/// `shared.chunks[index]`.
struct ChunkJob {
    shared: Arc<GrepShared>,
    index: usize,
}

// `WorkPool::go` hands the job in by value; the chunk's `Arc` is dropped
// here, after the (possible) hand-off back to the owning task.
fn run_chunk(job: ChunkJob) {
    let ChunkJob { shared, index } = job;
    shared.grep_chunk(index);
    // AcqRel: the completing chunk must observe every other chunk's
    // `results` push (also ordered by the mutex) before it re-schedules the
    // owning task to merge them.
    if shared.pending.fetch_sub(1, Ordering::AcqRel) == 1 {
        WorkPool::schedule(shared.node.load(Ordering::Acquire));
    }
    drop(shared);
}

impl GrepShared {
    /// Hits already found by the chunks BEFORE `chunk`, all of which order
    /// before anything `chunk` could still produce.
    fn hits_before(&self, chunk: usize) -> usize {
        self.counts[..chunk]
            .iter()
            .map(|c| c.load(Ordering::Relaxed))
            .sum()
    }

    fn grep_chunk(&self, chunk: usize) {
        // `dir` is `Some` whenever any chunk was spawned.
        let Some(dir) = self.dir.as_ref() else { return };
        let mut local: Vec<OwnedHit> = Vec::new();
        for path in &self.paths[self.chunks[chunk].clone()] {
            let prior = self.hits_before(chunk);
            if prior + local.len() >= self.limit {
                break;
            }
            // A path that vanished (or was swapped for a symlink, a FIFO,
            // or anything else that is not a regular file) since the
            // snapshot is simply not searched; `maxFileSize` is enforced
            // against the OPEN fd. See `bun_file_index::read_regular_at`.
            let Ok(FileReadOutcome::Contents(bytes)) =
                read_regular_at(dir.fd(), path, self.query.max_file_size() as u64)
            else {
                continue;
            };
            grep_file(&bytes, &self.query, path, &mut |path, hit| {
                local.push(OwnedHit::capture(&bytes, path, &hit, self.context));
                prior + local.len() < self.limit
            });
            self.counts[chunk].store(local.len(), Ordering::Relaxed);
        }
        if !local.is_empty() {
            self.results.lock().push((chunk, local));
        }
    }
}

impl ConcurrentPromiseTaskContext for GrepJob<'_> {
    const TASK_TAG: TaskTag = bun_event_loop::task_tag::FileIndexGrepTask;

    /// Runs on the work pool only after every chunk subtask finished (or
    /// immediately, when there was nothing to search): merge, order, cap.
    fn run(&mut self) {
        let parts = core::mem::take(&mut *self.shared.results.lock());
        let mut hits: Vec<OwnedHit> = parts.into_iter().flat_map(|(_, hits)| hits).collect();
        // Chunks finish in any order: the documented result order is
        // (path, line, column), ascending — identical to a sequential scan
        // of the path-sorted candidate list.
        hits.sort_unstable_by(|a, b| {
            (&*a.path, a.line, a.column).cmp(&(&*b.path, b.line, b.column))
        });
        hits.truncate(self.shared.limit);
        self.hits = hits;
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

// ───────────────────────────── __grepRead() ─────────────────────────────

/// `FileIndex.__grepRead(path, maxFileSize)`: one guarded candidate read
/// for the JS-thread RegExp grep, off the JS thread.
pub(crate) fn start_read(
    index: &FileIndex,
    global: &JSGlobalObject,
    rel: &[u8],
    max_file_size: usize,
) -> JSValue {
    schedule(
        global,
        Box::new(GrepReadJob {
            global,
            abs: super::join_abs(index.root_bytes(), rel),
            max_file_size,
            text: None,
        }),
    )
}

pub struct GrepReadJob<'a> {
    global: &'a JSGlobalObject,
    abs: Vec<u8>,
    max_file_size: usize,
    /// The candidate's contents, or `None` for one that must not be
    /// searched (vanished, not a regular file, over the cap, or binary).
    text: Option<Vec<u8>>,
}

impl ConcurrentPromiseTaskContext for GrepReadJob<'_> {
    const TASK_TAG: TaskTag = bun_event_loop::task_tag::FileIndexGrepReadTask;

    fn run(&mut self) {
        if let Ok(FileReadOutcome::Contents(bytes)) =
            read_regular_at(Fd::cwd(), &self.abs, self.max_file_size as u64)
            && !is_binary_prefix(&bytes)
        {
            self.text = Some(bytes);
        }
    }

    fn then(&mut self, promise: &mut JSPromise) -> Result<(), JsTerminated> {
        let global = self.global;
        match &self.text {
            None => promise.resolve(global, JSValue::NULL),
            Some(bytes) => match utf8_js(global, bytes) {
                Ok(text) => promise.resolve(global, text),
                Err(err) => promise.reject(global, Err(err)),
            },
        }
    }
}

// ───────────────────────────── hit capture ─────────────────────────────

impl OwnedHit {
    fn capture(haystack: &[u8], path: &[u8], hit: &GrepHit<'_>, context: usize) -> OwnedHit {
        // `column` is the exact (1-based) byte column, so this recovers the
        // exact line start even for a hit deep into one enormous line.
        let column_byte = hit.column - 1;
        let line_start = hit.byte_offset - column_byte;
        let (before, after) = if context == 0 {
            (Vec::new(), Vec::new())
        } else {
            (
                lines_before(haystack, line_start, context),
                lines_after(haystack, line_start, context),
            )
        };
        // The leaf (`bun_file_index::GrepHit`) speaks 1-based BYTE offsets
        // into the line; JS speaks 1-based UTF-16 code units into
        // `lineText`. Convert here, once, for the emitted hit only.
        let prefix = &hit.line_text[..column_byte.min(hit.line_text.len())];
        OwnedHit {
            path: Box::from(path),
            line: hit.line,
            column: utf16_units(prefix) + 1,
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
        // The one (saturating) narrowing of `column`: JS numbers are f64.
        obj.put(
            global,
            "column",
            JSValue::js_number_from_uint64(self.column as u64),
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
