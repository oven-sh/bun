//! `Bun.TypeChecker` — async TypeScript diagnostics.
//!
//! Only the root is publicly constructible. Snapshot/project/program objects
//! come from their parents and are immutable observations of one full check.

pub(crate) mod convert;
pub(crate) mod state;
pub(crate) mod task;

use std::sync::Arc;

use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope};
use bun_jsc::{DOMURL, ErrorCode, JSGlobalObject, JSPromiseStrong, JSValue, Job, JsCell};
use bun_ptr::{BackRef, RefPtr};

use crate::api::js_type_checker::state::DesiredState;
use crate::api::js_type_checker::task::{CheckJs, CheckTask};
use crate::generated_bindgen::type_checker::{
    TypeCheckerOptions, TypeCheckerSnapshotUpdate, js_TypeCheckerProgram as js_program,
    js_TypeCheckerProject as js_project, js_TypeCheckerSnapshot as js_snapshot,
};

// ── errors ────────────────────────────────────────────────────────────────

pub(crate) fn closed_error_pub<'a>(heap: &JsHeap<'a>) -> bun_jsc::bindgen::Error<'a> {
    heap.error_with_code(
        ErrorCode::BUN_TYPE_CHECKER_CLOSED,
        format_args!("Bun.TypeChecker: this TypeChecker is closed"),
    )
}

fn disposed_error<'a>(heap: &JsHeap<'a>) -> bun_jsc::bindgen::Error<'a> {
    heap.error_with_code(
        ErrorCode::BUN_TYPE_CHECKER_SNAPSHOT_DISPOSED,
        format_args!("Bun.TypeChecker: this snapshot has been disposed"),
    )
}

fn unavailable_error<'a>(heap: &JsHeap<'a>) -> bun_jsc::bindgen::Error<'a> {
    heap.error_with_code(
        ErrorCode::BUN_TYPE_CHECKER_UNAVAILABLE,
        format_args!("Bun.TypeChecker: type checking is not available in this build"),
    )
}

// ── path parsing ──────────────────────────────────────────────────────────

fn path_from_value<'a>(
    heap: &JsHeap<'a>,
    value: JSValue,
    what: &'a str,
) -> Result<Vec<u8>, bun_jsc::bindgen::Error<'a>> {
    // SAFETY: `heap` belongs to this call; allocating runs no JavaScript.
    let global = unsafe { heap.global() };
    if value.is_string() {
        let text = value.to_utf8(global)?;
        let bytes = text.slice().to_vec();
        if bytes.contains(&0) {
            return Err(heap.error_with_code(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("Bun.TypeChecker: {what} contains a NUL byte"),
            ));
        }
        return Ok(bytes);
    }
    if let Some(url) = DOMURL::cast(&value) {
        return match url.file_system_path() {
            Ok(path) => {
                let bytes = path.to_utf8().slice().to_vec();
                if bytes.contains(&0) {
                    Err(heap.error_with_code(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Bun.TypeChecker: {what} contains a NUL byte"),
                    ))
                } else {
                    Ok(bytes)
                }
            }
            Err(_) => Err(heap.error_with_code(
                ErrorCode::INVALID_ARG_VALUE,
                format_args!("Bun.TypeChecker: {what} must be a file: URL"),
            )),
        };
    }
    Err(heap.error_with_code(
        ErrorCode::INVALID_ARG_TYPE,
        format_args!("Bun.TypeChecker: {what} must be a string or a URL"),
    ))
}

/// Resolve a path against `cwd` and normalize lexically. No filesystem
/// access: the path may not exist.
fn resolve_against(cwd: &[u8], path: &[u8]) -> Vec<u8> {
    if bun_paths::is_absolute(path) {
        bun_paths::Path::resolve(&[path]).as_bytes().to_vec()
    } else {
        bun_paths::Path::resolve(&[cwd, path]).as_bytes().to_vec()
    }
}

fn is_tsconfig_name(path: &[u8]) -> bool {
    bun_paths::basename(path) == b"tsconfig.json"
}

fn canonicalize_selector(cwd: &[u8], resolved: &[u8]) -> Vec<u8> {
    // A directory selector names the tsconfig inside it; the worker expands
    // it through the driver's own resolution. We canonicalize lexically,
    // appending `tsconfig.json` for directory-shaped selectors (no
    // extension) so `sub` and `sub/tsconfig.json` share one refcount.
    let _ = cwd;
    if is_tsconfig_name(resolved) {
        resolved.to_vec()
    } else if bun_paths::extension(resolved).is_empty() {
        bun_paths::Path::from_parts(&[resolved, b"tsconfig.json"])
            .as_bytes()
            .to_vec()
    } else {
        resolved.to_vec()
    }
}

// ── root ──────────────────────────────────────────────────────────────────

#[derive(bun_ptr::RefCounted)]
pub(crate) struct TypeChecker {
    ref_count: bun_ptr::RefCount<TypeChecker>,
    cwd: Box<[u8]>,
    desired: JsCell<DesiredState>,
    queue: JsCell<state::RootQueue>,
    next_sequence: core::cell::Cell<u64>,
    shared: Arc<state::RootShared>,
}

impl TypeChecker {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        options: Option<&TypeCheckerOptions<'a>>,
    ) -> Result<RefPtr<Self>, bun_jsc::bindgen::Error<'a>> {
        let heap = &cx.heap;
        // Removed-`Check` builds fail with a catchable error, never abort.
        if bun_removable_features::is_removed(bun_removable_features::Feature::Check) {
            return Err(unavailable_error(heap));
        }
        let cwd: Box<[u8]> = match options {
            Some(opts) if !opts.cwd.is_undefined() => {
                let bytes = path_from_value(heap, opts.cwd.to_js(), "cwd")?;
                if bytes.contains(&0) {
                    return Err(heap.error_with_code(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Bun.TypeChecker: cwd contains a NUL byte"),
                    ));
                }
                if !bun_paths::is_absolute(&bytes) {
                    return Err(heap.error_with_code(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Bun.TypeChecker: cwd must be absolute"),
                    ));
                }
                Box::from(&*bytes)
            }
            _ => {
                // Default: process.cwd() at construction.
                let mut buf = bun_paths::path_buffer_pool::get();
                match bun_sys::getcwd_z(&mut buf) {
                    Ok(cwd) => Box::from(cwd.to_vec()),
                    Err(_) => Box::from(&b"/"[..]),
                }
            }
        };
        let checker = TypeChecker {
            ref_count: bun_ptr::RefCount::init(),
            cwd,
            desired: JsCell::new(DesiredState::default()),
            queue: JsCell::new(state::RootQueue::new()),
            next_sequence: core::cell::Cell::new(0),
            shared: state::RootShared::new(),
        };
        Ok(RefPtr::new(checker))
    }

    fn check_not_closing<'a>(&self, heap: &JsHeap<'a>) -> Result<(), bun_jsc::bindgen::Error<'a>> {
        if self.queue.get().closing {
            return Err(closed_error_pub(heap));
        }
        Ok(())
    }

    /// Parse and validate one `updateSnapshot` argument. Returns the
    /// validated update, or an error; desired state is not mutated here.
    fn parse_update<'a>(
        &self,
        cx: &mut JsScope<'a>,
        update: Option<&TypeCheckerSnapshotUpdate<'a>>,
    ) -> Result<ValidatedUpdate, bun_jsc::bindgen::Error<'a>> {
        let heap = &cx.heap;
        // SAFETY: `heap` and `global` denote the same object; `global` is
        // only used while the call that produced `heap` is live.
        let global = unsafe { heap.global() };
        let mut close_selectors: Vec<Vec<u8>> = Vec::new();
        let mut open_selectors: Vec<Vec<u8>> = Vec::new();
        let mut sources: Vec<(Vec<u8>, Option<Vec<u8>>)> = Vec::new();

        if let Some(update) = update {
            let cwd: &[u8] = &self.cwd;
            // closeProjects first, then openProjects (close-and-reopen reloads).
            for entry in js_array_items(heap, global, update.close_projects)? {
                let raw = path_from_value(heap, entry, "closeProjects entry")?;
                let resolved = resolve_against(cwd, &raw);
                close_selectors.push(canonicalize_selector(cwd, &resolved));
            }
            for entry in js_array_items(heap, global, update.open_projects)? {
                let raw = path_from_value(heap, entry, "openProjects entry")?;
                let resolved = resolve_against(cwd, &raw);
                open_selectors.push(canonicalize_selector(cwd, &resolved));
            }
            if !update.source_changes.to_js().is_undefined() && !update.source_changes.to_js().is_null() {
                let map_js = update.source_changes.to_js();
                if !map_js.is_cell() || bun_jsc::JSMap::from_js(map_js).is_none() {
                    return Err(heap.error_with_code(
                        ErrorCode::INVALID_ARG_TYPE,
                        format_args!("Bun.TypeChecker: sourceChanges must be a Map"),
                    ));
                }
                // Iterate the Map in iteration order.
                let iterator_fn = map_js.get(global, b"entries")?.unwrap_or(JSValue::UNDEFINED);
                let iterator = iterator_fn.call(global, map_js, &[])?;
                let next_fn = iterator.get(global, b"next")?.unwrap_or(JSValue::UNDEFINED);
                loop {
                    let step = next_fn.call(global, iterator, &[])?;
                    let done = step.get(global, b"done")?.unwrap_or(JSValue::FALSE);
                    if done.to_boolean() {
                        break;
                    }
                    let value = step.get(global, b"value")?.unwrap_or(JSValue::UNDEFINED);
                    let mut iter = value.array_iterator(global)?;
                    let key = iter.next()?.unwrap_or(JSValue::UNDEFINED);
                    let val = iter.next()?.unwrap_or(JSValue::UNDEFINED);
                    let key_path = path_from_value(heap, key, "sourceChanges key")?;
                    let resolved = resolve_against(cwd, &key_path);
                    if val.is_undefined() {
                        return Err(heap.error_with_code(
                            ErrorCode::INVALID_ARG_TYPE,
                            format_args!(
                                "Bun.TypeChecker: sourceChanges value for '{}' must be a string or null",
                                bstr::BStr::new(&resolved)
                            ),
                        ));
                    } else if val.is_null() {
                        sources.push((resolved, None));
                    } else if val.is_string() {
                        let text = val.to_utf8(global)?.slice().to_vec();
                        sources.push((resolved, Some(text)));
                    } else {
                        return Err(heap.error_with_code(
                            ErrorCode::INVALID_ARG_TYPE,
                            format_args!(
                                "Bun.TypeChecker: sourceChanges value for '{}' must be a string or null",
                                bstr::BStr::new(&resolved)
                            ),
                        ));
                    }
                }
            }
        }
        Ok(ValidatedUpdate {
            close_selectors,
            open_selectors,
            sources,
        })
    }

    /// `updateSnapshot(update?) -> Promise<Snapshot>`.
    pub(crate) fn update_snapshot<'a>(
        &self,
        _this_value: bun_jsc::bindgen::JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        update: Option<&TypeCheckerSnapshotUpdate<'a>>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        self.check_not_closing(&cx.heap)?;
        let validated = self.parse_update(cx, update)?;

        // Apply to desired state; capture the per-call image.
        self.desired.with_mut(|desired| {
            for selector in &validated.close_selectors {
                desired.apply_close(selector);
            }
            for selector in &validated.open_selectors {
                desired.apply_open(selector);
            }
            for (path, text) in &validated.sources {
                desired.apply_source(path, text.clone());
            }
        });
        let captured = self.desired.get().clone();
        let sequence = self.next_sequence.get();
        self.next_sequence.set(sequence + 1);

        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        self.queue.with_mut(|queue| {
            queue.queued += 1;
            queue.undelivered.push(sequence);
        });
        let shared = self.shared.clone();
        let detached = std::sync::Arc::new(core::sync::atomic::AtomicBool::new(false));
        if shared.running.load(core::sync::atomic::Ordering::Acquire) == 0 {
            *shared.running_detached.lock().unwrap() = Some(detached.clone());
        }
        let js = CheckJs {
            promise,
            global_this: BackRef::new(cx.global()),
            root: self.shared.clone(),
            detached,
        };
        if shared.running.load(core::sync::atomic::Ordering::Acquire) == 0 {
            shared
                .running
                .fetch_add(1, core::sync::atomic::Ordering::AcqRel);
            let task = CheckTask {
                job: task::CheckJob {
                    cwd: self.cwd.to_vec(),
                    state: captured,
                    sequence,
                    result: None,
                    shared,
                },
            };
            Job::<CheckTask>::schedule(&cx.js_thread(), task, js);
        } else {
            // Serialized: runs after the current check finishes.
            // SAFETY: only pushed/popped on the JS thread.
            let entry = Box::new(task::PendingEntry {
                cwd: self.cwd.to_vec(),
                state: captured,
                sequence,
                js,
            });
            shared
                .pending
                .lock()
                .unwrap()
                .push_back(state::PendingPtr(Box::into_raw(entry)));
        }
        Ok(JsLocal::new(&cx.heap, value))
    }

    /// `close() -> Promise<void>`. Idempotent; repeated calls return the
    /// same promise.
    pub(crate) fn close<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        // Idempotent: repeated calls return the same completion promise.
        {
            let guard = self.shared.close_promise.lock().unwrap();
            if let Some(state::ClosePromisePtr(raw)) = *guard {
                // SAFETY: only written/read on the JS thread.
                let value = unsafe { (*raw).value() };
                return Ok(JsLocal::new(&cx.heap, value));
            }
        }
        self.queue.with_mut(|queue| {
            queue.closing = true;
            queue.undelivered.clear();
        });
        // Reject queued (not yet started) updates with CLOSED.
        {
            let mut pending = self.shared.pending.lock().unwrap();
            while let Some(state::PendingPtr(raw)) = pending.pop_front() {
                // SAFETY: only pushed/popped on the JS thread.
                let entry = unsafe { Box::from_raw(raw) };
                let mut p = entry.js.promise;
                // `into_js_error` leaves an exception pending; reject with Ok(value)
                // to avoid entangling the pending exception with this call.
                let err_value = bun_jsc::ErrorCode::BUN_TYPE_CHECKER_CLOSED.fmt(
                    cx.global(),
                    format_args!("Bun.TypeChecker: this TypeChecker is closed"),
                );
                let _ = p.swap().reject_as_handled(cx.global(), err_value);
            }
        }
        // Detach the running job: its promise rejects with CLOSED in `finish`.
        if let Some(flag) = self.shared.running_detached.lock().unwrap().clone() {
            flag.store(true, core::sync::atomic::Ordering::Release);
        }
        // Invalidate all live snapshots.
        let snapshots: Vec<Arc<state::SnapshotLifetime>> =
            std::mem::take(&mut *self.shared.live_snapshots.lock().unwrap());
        for snapshot in &snapshots {
            snapshot.dispose();
        }
        // The close promise resolves when the last running job finishes
        // (see `finish`); if the queue is already idle it resolves now.
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        *self.shared.close_promise.lock().unwrap() = Some(state::ClosePromisePtr(Box::into_raw(Box::new(promise))));
        if self.shared.running.load(core::sync::atomic::Ordering::Acquire) == 0 {
            resolve_close_promise(&self.shared, cx.global())?;
        }
        Ok(JsLocal::new(&cx.heap, value))
    }

    /// `[Symbol.asyncDispose]()` delegates to `close()`.
    pub(crate) fn async_dispose<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        self.close(cx)
    }
}

fn js_array_items<'a>(
    heap: &JsHeap<'a>,
    global: &JSGlobalObject,
    value: bun_jsc::bindgen::JsLocal<'a>,
) -> Result<Vec<JSValue>, bun_jsc::bindgen::Error<'a>> {
    let js = value.to_js();
    if js.is_undefined() || js.is_null() {
        return Ok(Vec::new());
    }
    if !js.js_type().is_array() {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_TYPE,
            format_args!("Bun.TypeChecker: expected an array"),
        ));
    }
    let mut iter = js.array_iterator(global)?;
    let mut out = Vec::new();
    while let Some(item) = iter.next()? {
        out.push(item);
    }
    Ok(out)
}

struct ValidatedUpdate {
    close_selectors: Vec<Vec<u8>>,
    open_selectors: Vec<Vec<u8>>,
    sources: Vec<(Vec<u8>, Option<Vec<u8>>)>,
}

// ── snapshot ──────────────────────────────────────────────────────────────

#[derive(bun_ptr::RefCounted)]
pub(crate) struct TypeCheckerSnapshot {
    ref_count: bun_ptr::RefCount<TypeCheckerSnapshot>,
    data: Option<Arc<convert::SnapshotData>>,
    lifetime: Arc<state::SnapshotLifetime>,
    cwd: Box<[u8]>,
}

impl TypeCheckerSnapshot {
    fn check_alive<'a>(&self, heap: &JsHeap<'a>) -> Result<(), bun_jsc::bindgen::Error<'a>> {
        if self.lifetime.is_disposed() {
            return Err(disposed_error(heap));
        }
        Ok(())
    }

    pub(crate) fn get_projects<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        self.check_alive(&cx.heap)?;
        // Build project values before borrowing `global` for the array.
        let values: Vec<JSValue> = {
            let data = self.data.as_ref().expect("snapshot data");
            let mut values = Vec::with_capacity(data.projects.len());
            for project in &data.projects {
                values.push(make_project_js(cx, self, project.index as usize)?);
            }
            values
        };
        let global = cx.global();
        let array = JSValue::create_empty_array(global, values.len())?;
        for (i, value) in values.iter().enumerate() {
            array.put_index(global, i as u32, *value)?;
        }
        Ok(JsLocal::new(&cx.heap, array))
    }

    pub(crate) fn get_project<'a>(
        &self,
        cx: &mut JsScope<'a>,
        config_file: JsLocal<'a>,
    ) -> Result<Option<JsLocal<'a>>, bun_jsc::bindgen::Error<'a>> {
        self.check_alive(&cx.heap)?;
        let heap = &cx.heap;
        let raw = path_from_value(heap, config_file.to_js(), "configFile")?;
        let resolved = resolve_against(&self.cwd, &raw);
        let canonical = canonicalize_selector(&self.cwd, &resolved);
        let data = self.data.as_ref().expect("snapshot data");
        // Match against the project's own config path, canonicalized.
        for project in &data.projects {
            let project_resolved = resolve_against(&self.cwd, &project.config_path);
            let project_canonical = canonicalize_selector(&self.cwd, &project_resolved);
            if project_canonical == canonical || project.config_path == resolved {
                let value = make_project_js(cx, self, project.index as usize)?;
                return Ok(Some(JsLocal::new(&cx.heap, value)));
            }
        }
        // The driver may return the config with a different lexical form
        // (e.g. `./sub/tsconfig.json`); compare resolved forms.
        for project in &data.projects {
            let a = resolve_against(&self.cwd, &project.config_path);
            if a == resolved {
                let value = make_project_js(cx, self, project.index as usize)?;
                return Ok(Some(JsLocal::new(&cx.heap, value)));
            }
        }
        Ok(None)
    }

    pub(crate) fn dispose(&self, cx: &mut JsScope<'_>) {
        let _ = cx;
        self.lifetime.dispose();
    }

}

pub(crate) fn make_snapshot_js(
    global: &JSGlobalObject,
    data: convert::SnapshotData,
    cwd: Box<[u8]>,
    root: Arc<state::RootShared>,
) -> bun_jsc::JsResult<JSValue> {
    let lifetime = state::SnapshotLifetime::new();
    root.live_snapshots.lock().unwrap().push(lifetime.clone());
    let snapshot = TypeCheckerSnapshot {
        ref_count: bun_ptr::RefCount::init(),
        data: Some(Arc::new(data)),
        lifetime,
        cwd,
    };
    let ptr = RefPtr::new(snapshot);
    Ok(js_snapshot::to_js(ptr, global))
}

pub(crate) fn resolve_close_promise(
    root: &Arc<state::RootShared>,
    global: &JSGlobalObject,
) -> bun_jsc::JsResult<()> {
    // Resolve through the rooted handle without consuming it, so repeated
    // `close()` returns the same promise.
    // SAFETY: only written/read on the JS thread.
    let guard = root.close_promise.lock().unwrap();
    let Some(state::ClosePromisePtr(raw)) = *guard else {
        return Ok(());
    };
    let promise = unsafe { &*raw };
    // `resolve` on `JSPromiseStrong` swaps (consuming the slot); resolve
    // through `get()` instead to keep the stored handle intact.
    promise.get().resolve(global, bun_jsc::JSValue::UNDEFINED)
}

fn make_project_js<'a>(
    cx: &mut JsScope<'a>,
    snapshot: &TypeCheckerSnapshot,
    project_index: usize,
) -> Result<JSValue, bun_jsc::bindgen::Error<'a>> {
    // SAFETY: `snapshot` is live for this call (the caller holds it).
    let snapshot_ref = unsafe {
        RefPtr::init_ref(snapshot as *const TypeCheckerSnapshot as *mut _)
    };
    let project = TypeCheckerProject {
        ref_count: bun_ptr::RefCount::init(),
        snapshot: snapshot_ref,
        project_index,
    };
    Ok(js_project::to_js(RefPtr::new(project), cx.global()))
}

// ── project ───────────────────────────────────────────────────────────────

#[derive(bun_ptr::RefCounted)]
pub(crate) struct TypeCheckerProject {
    ref_count: bun_ptr::RefCount<TypeCheckerProject>,
    snapshot: RefPtr<TypeCheckerSnapshot>,
    project_index: usize,
}

impl TypeCheckerProject {
    fn check_alive<'a>(&self, heap: &JsHeap<'a>) -> Result<(), bun_jsc::bindgen::Error<'a>> {
        if self.snapshot.lifetime.is_disposed() {
            return Err(disposed_error(heap));
        }
        Ok(())
    }

    pub(crate) fn get_config_file_name<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        self.check_alive(&cx.heap)?;
        let data = self.snapshot.data.as_ref().expect("snapshot data");
        let project = &data.projects[self.project_index];
        let value =
            bun_jsc::bun_string_jsc::create_utf8_for_js(cx.global(), &project.config_path)?;
        Ok(JsLocal::new(&cx.heap, value))
    }

    pub(crate) fn get_program<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        self.check_alive(&cx.heap)?;
        // SAFETY: `snapshot` is live for this call.
        let snapshot_ref = unsafe { RefPtr::init_ref(self.snapshot.as_ptr()) };
        let program = TypeCheckerProgram {
            ref_count: bun_ptr::RefCount::init(),
            snapshot: snapshot_ref,
            project_index: self.project_index,
        };
        let value = js_program::to_js(RefPtr::new(program), cx.global());
        Ok(JsLocal::new(&cx.heap, value))
    }
}

// ── program ───────────────────────────────────────────────────────────────

#[derive(bun_ptr::RefCounted)]
pub(crate) struct TypeCheckerProgram {
    ref_count: bun_ptr::RefCount<TypeCheckerProgram>,
    snapshot: RefPtr<TypeCheckerSnapshot>,
    project_index: usize,
}

impl TypeCheckerProgram {
    pub(crate) fn get_diagnostics<'a>(
        &self,
        cx: &mut JsScope<'a>,
        file: JsLocal<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        if self.snapshot.lifetime.is_disposed() {
            let err_value = bun_jsc::ErrorCode::BUN_TYPE_CHECKER_SNAPSHOT_DISPOSED.fmt(
                cx.global(),
                format_args!("Bun.TypeChecker: this snapshot has been disposed"),
            );
            let mut p = promise;
            p.reject(cx.global(), Ok(err_value))?;
            return Ok(JsLocal::new(&cx.heap, value));
        }
        // Validate the file argument now; invalid values reject.
        let filter: Option<Vec<u8>> = if file.is_undefined() {
            None
        } else {
            let heap = &cx.heap;
            let raw = match path_from_value(heap, file.to_js(), "file") {
                Ok(raw) => raw,
                Err(e) => {
                    return Err(e);
                }
            };
            Some(resolve_against(&self.snapshot.cwd, &raw))
        };
        let out: Vec<JSValue> = {
            let data = self.snapshot.data.as_ref().expect("snapshot data");
            let case_sensitive = data.fs_case_sensitive;
            let wanted = filter.map(|f| convert::normalize_for_filter(&f, case_sensitive));
            let indices = &data.by_project[self.project_index];
            let mut out: Vec<JSValue> = Vec::new();
            for &index in indices {
                let diagnostic = &data.diagnostics[index as usize];
                if let Some(wanted) = &wanted {
                    let Some(file_name) = &diagnostic.file_name else {
                        continue;
                    };
                    if &convert::normalize_for_filter(file_name, case_sensitive) != wanted {
                        continue;
                    }
                }
                let converted = convert::diagnostic_to_js(&cx.heap, diagnostic)?;
                out.push(converted.to_js());
            }
            out
        };
        let global = cx.global();
        let array = JSValue::create_empty_array(global, out.len())?;
        for (i, item) in out.iter().enumerate() {
            array.put_index(global, i as u32, *item)?;
        }
        let mut p = promise;
        p.resolve(global, array)?;
        Ok(JsLocal::new(&cx.heap, value))
    }
}
