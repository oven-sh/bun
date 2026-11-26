//! `Bun.TypeChecker` — async TypeScript diagnostics.
//!
//! Only the root is publicly constructible. Snapshot/project/program objects
//! come from their parents and are immutable observations of one full check.

pub(crate) mod convert;
pub(crate) mod state;
pub(crate) mod task;

use std::cell::Cell;
use std::rc::Rc;

use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope};
use bun_jsc::{DOMURL, ErrorCode, JSGlobalObject, JSPromiseStrong, JSValue, Job, JsCell, JsThread};
use bun_ptr::RefPtr;
use bun_type_checker::{DesiredState, canonical_selector, check_no_nul, normalize_for_filter, resolve_against};

use crate::api::js_type_checker::state::{PendingEntry, RootState};
use crate::api::js_type_checker::task::{CheckJs, CheckTask};
use crate::generated_bindgen::type_checker::{
    TypeCheckerOptions, TypeCheckerSnapshotUpdate, js_TypeCheckerProgram as js_program,
    js_TypeCheckerProject as js_project, js_TypeCheckerSnapshot as js_snapshot,
};

// ── errors ────────────────────────────────────────────────────────────────

pub(crate) fn closed_error_value(global: &JSGlobalObject) -> JSValue {
    ErrorCode::BUN_TYPE_CHECKER_CLOSED.fmt(
        global,
        format_args!("Bun.TypeChecker: this TypeChecker is closed"),
    )
}

fn closed_error<'a>(heap: &JsHeap<'a>) -> bun_jsc::bindgen::Error<'a> {
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

// ── path parsing ──────────────────────────────────────────────────────────

fn nul_error<'a>(heap: &JsHeap<'a>, what: &str) -> bun_jsc::bindgen::Error<'a> {
    heap.error_with_code(
        ErrorCode::INVALID_ARG_VALUE,
        format_args!("Bun.TypeChecker: {what} contains a NUL byte"),
    )
}

fn path_from_value<'a>(
    heap: &JsHeap<'a>,
    value: JSValue,
    what: &'a str,
) -> Result<Vec<u8>, bun_jsc::bindgen::Error<'a>> {
    // SAFETY: `heap` belongs to this call; allocating runs no JavaScript.
    let global = unsafe { heap.global() };
    let bytes = if value.is_string() {
        value.to_utf8(global)?.slice().to_vec()
    } else if let Some(url) = DOMURL::cast(&value) {
        match url.file_system_path() {
            Ok(path) => path.to_utf8().slice().to_vec(),
            Err(_) => {
                return Err(heap.error_with_code(
                    ErrorCode::INVALID_ARG_VALUE,
                    format_args!("Bun.TypeChecker: {what} must be a file: URL"),
                ));
            }
        }
    } else {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_TYPE,
            format_args!("Bun.TypeChecker: {what} must be a string or a URL"),
        ));
    };
    if check_no_nul(&bytes).is_err() {
        return Err(nul_error(heap, what));
    }
    Ok(bytes)
}

// ── root ──────────────────────────────────────────────────────────────────

#[derive(bun_ptr::RefCounted)]
pub(crate) struct TypeChecker {
    ref_count: bun_ptr::RefCount<TypeChecker>,
    pub(crate) cwd: Box<[u8]>,
    desired: JsCell<DesiredState>,
    root: JsCell<RootState>,
    /// Set by `close()`; snapshots hold a clone so they stop answering.
    closed: Rc<Cell<bool>>,
}

impl TypeChecker {
    pub(crate) fn constructor<'a>(
        cx: &mut JsScope<'a>,
        options: Option<&TypeCheckerOptions<'a>>,
    ) -> Result<RefPtr<Self>, bun_jsc::bindgen::Error<'a>> {
        // `Check` is entered from the command line, so no executable compiled ahead of time has it, and
        // `features-bun.builtins.ts` cannot declare it for this constructor.
        if bun_removable_features::is_removed(bun_removable_features::Feature::Check) {
            return Err(crate::removed_feature::throw_for_removed_feature(
                cx.global(),
                bun_removable_features::Feature::Check,
            )
            .into());
        }
        let heap = &cx.heap;
        let cwd: Box<[u8]> = match options {
            Some(opts) if !opts.cwd.is_undefined() => {
                let bytes = path_from_value(heap, opts.cwd.to_js(), "cwd")?;
                if !bun_paths::is_absolute(&bytes) {
                    return Err(heap.error_with_code(
                        ErrorCode::INVALID_ARG_VALUE,
                        format_args!("Bun.TypeChecker: cwd must be absolute"),
                    ));
                }
                Box::from(&*bytes)
            }
            _ => {
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
            root: JsCell::new(RootState::default()),
            closed: Rc::new(Cell::new(false)),
        };
        Ok(RefPtr::new(checker))
    }

    pub(crate) fn is_closed(&self) -> bool {
        self.closed.get()
    }

    pub(crate) fn closed_flag(&self) -> Rc<Cell<bool>> {
        self.closed.clone()
    }

    /// Parse and validate one `updateSnapshot` argument. Runs user JS
    /// (getters, Map iteration), so the caller re-checks `closed` afterwards.
    /// Desired state is not mutated here.
    fn parse_update<'a>(
        &self,
        cx: &mut JsScope<'a>,
        update: JsLocal<'a>,
    ) -> Result<ValidatedUpdate, bun_jsc::bindgen::Error<'a>> {
        let heap = &cx.heap;
        // SAFETY: `heap` and `global` denote the same object; `global` is
        // only used while the call that produced `heap` is live.
        let global = unsafe { heap.global() };
        let mut validated = ValidatedUpdate::default();

        let update_js = update.to_js();
        if update_js.is_undefined() || update_js.is_null() {
            return Ok(validated);
        }
        if !update_js.is_object() {
            return Err(heap.error_with_code(
                ErrorCode::INVALID_ARG_TYPE,
                format_args!("Bun.TypeChecker: update must be an object"),
            ));
        }
        let update = TypeCheckerSnapshotUpdate {
            open_projects: JsLocal::new(heap, update_js.get(global, b"openProjects")?.unwrap_or(JSValue::UNDEFINED)),
            close_projects: JsLocal::new(heap, update_js.get(global, b"closeProjects")?.unwrap_or(JSValue::UNDEFINED)),
            source_changes: JsLocal::new(heap, update_js.get(global, b"sourceChanges")?.unwrap_or(JSValue::UNDEFINED)),
        };
        let cwd: &[u8] = &self.cwd;
        // closeProjects first, then openProjects (close-and-reopen reloads).
        for (list, what, out) in [
            (update.close_projects, "closeProjects entry", &mut validated.close_selectors),
            (update.open_projects, "openProjects entry", &mut validated.open_selectors),
        ] {
            let Some(array) = array_argument(heap, list.to_js())? else {
                continue;
            };
            let mut iter = array.array_iterator(global)?;
            while let Some(entry) = iter.next()? {
                let raw = path_from_value(heap, entry, what)?;
                out.push(canonical_selector(cwd, &raw));
            }
        }
        let map_js = update.source_changes.to_js();
        if map_js.is_undefined() || map_js.is_null() {
            return Ok(validated);
        }
        if !map_js.is_cell() || bun_jsc::JSMap::from_js(map_js).is_none() {
            return Err(heap.error_with_code(
                ErrorCode::INVALID_ARG_TYPE,
                format_args!("Bun.TypeChecker: sourceChanges must be a Map"),
            ));
        }
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
            if val.is_null() {
                validated.sources.push((resolved, None));
            } else if val.is_string() {
                let text = val.to_utf8(global)?.slice().to_vec();
                validated.sources.push((resolved, Some(text)));
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
        Ok(validated)
    }

    /// `updateSnapshot(update?) -> Promise<Snapshot>`. Invalid arguments and a
    /// closed root reject the returned promise; only the constructor throws.
    pub(crate) fn update_snapshot<'a>(
        &self,
        _this_value: bun_jsc::bindgen::JsWrapper<'a, Self>,
        cx: &mut JsScope<'a>,
        update: JsLocal<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        let mut promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();

        let parsed = if self.is_closed() {
            Err(closed_error(&cx.heap))
        } else {
            match self.parse_update(cx, update) {
                Ok(_) if self.is_closed() => Err(closed_error(&cx.heap)),
                other => other,
            }
        };
        let validated = match parsed {
            Ok(validated) => validated,
            Err(e) => {
                let global = cx.global();
                let err = e.to_error_value(global)?;
                if self.is_closed() {
                    promise.swap().reject_as_handled(global, err)?;
                } else {
                    promise.reject(global, Ok(err))?;
                }
                return Ok(JsLocal::new(&cx.heap, value));
            }
        };

        let captured = self.desired.with_mut(|desired| {
            for selector in &validated.close_selectors {
                desired.apply_close(selector);
            }
            for selector in &validated.open_selectors {
                desired.apply_open(selector);
            }
            for (path, text) in validated.sources {
                desired.apply_source(&path, text);
            }
            desired.clone()
        });
        self.root.with_mut(|root| {
            root.pending.push_back(PendingEntry {
                state: captured,
                promise,
            });
        });
        self.start_next(&cx.js_thread());
        Ok(JsLocal::new(&cx.heap, value))
    }

    /// Starts the oldest pending update unless a check is already running.
    fn start_next(&self, cx: &JsThread<'_>) {
        let entry = self.root.with_mut(|root| {
            if root.running || self.is_closed() {
                return None;
            }
            let entry = root.pending.pop_front()?;
            root.running = true;
            Some(entry)
        });
        let Some(entry) = entry else { return };
        let task = CheckTask {
            job: task::CheckJob {
                cwd: self.cwd.to_vec(),
                state: entry.state,
                result: None,
            },
        };
        // SAFETY: `self` is live for this call; `init_ref` takes its own ref.
        let root = unsafe { RefPtr::init_ref(self as *const Self as *mut Self) };
        Job::<CheckTask>::schedule(
            cx,
            task,
            CheckJs {
                promise: entry.promise,
                root,
            },
        );
    }

    /// The running check has been delivered: start the next one, or resolve
    /// `close()` if nothing is left.
    pub(crate) fn job_finished(&self, cx: &JsThread<'_>) -> bun_jsc::JsResult<()> {
        self.root.with_mut(|root| root.running = false);
        self.start_next(cx);
        let root = self.root.get();
        if root.running {
            return Ok(());
        }
        match &root.close {
            Some(close) => close.get().resolve(cx.global(), JSValue::UNDEFINED),
            None => Ok(()),
        }
    }

    /// `close() -> Promise<void>`. Idempotent; repeated calls return the
    /// same promise.
    pub(crate) fn close<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        if let Some(close) = &self.root.get().close {
            return Ok(JsLocal::new(&cx.heap, close.value()));
        }
        self.closed.set(true);
        self.desired.set(DesiredState::default());
        let pending = self.root.with_mut(|root| std::mem::take(&mut root.pending));
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        let idle = self.root.with_mut(|root| {
            root.close = Some(promise);
            !root.running
        });
        for mut entry in pending {
            let global = cx.global();
            entry
                .promise
                .swap()
                .reject_as_handled(global, closed_error_value(global))?;
        }
        if idle {
            if let Some(close) = &self.root.get().close {
                close.get().resolve(cx.global(), JSValue::UNDEFINED)?;
            }
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

/// `Some(array)` for an array, `None` for `undefined`/`null`.
fn array_argument<'a>(
    heap: &JsHeap<'a>,
    js: JSValue,
) -> Result<Option<JSValue>, bun_jsc::bindgen::Error<'a>> {
    if js.is_undefined() || js.is_null() {
        return Ok(None);
    }
    if !js.js_type().is_array() {
        return Err(heap.error_with_code(
            ErrorCode::INVALID_ARG_TYPE,
            format_args!("Bun.TypeChecker: expected an array"),
        ));
    }
    Ok(Some(js))
}

#[derive(Default)]
struct ValidatedUpdate {
    close_selectors: Vec<Vec<u8>>,
    open_selectors: Vec<Vec<u8>>,
    sources: Vec<(Vec<u8>, Option<Vec<u8>>)>,
}

// ── snapshot ──────────────────────────────────────────────────────────────

#[derive(bun_ptr::RefCounted)]
pub(crate) struct TypeCheckerSnapshot {
    ref_count: bun_ptr::RefCount<TypeCheckerSnapshot>,
    /// `None` once disposed (or once the root was closed and this was read).
    data: JsCell<Option<Rc<bun_type_checker::SnapshotData>>>,
    root_closed: Rc<Cell<bool>>,
    cwd: Box<[u8]>,
}

impl TypeCheckerSnapshot {
    /// The data, or the disposed error if `dispose()` ran or the root closed.
    fn data<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> Result<Rc<bun_type_checker::SnapshotData>, bun_jsc::bindgen::Error<'a>> {
        if self.root_closed.get() {
            self.data.set(None);
        }
        match self.data.get() {
            Some(data) => Ok(data.clone()),
            None => Err(disposed_error(heap)),
        }
    }

    pub(crate) fn get_projects<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        let data = self.data(&cx.heap)?;
        let array = JSValue::create_empty_array(cx.global(), data.projects.len())?;
        for (i, project) in data.projects.iter().enumerate() {
            let value = make_project_js(cx, self, project.index as usize);
            array.put_index(cx.global(), i as u32, value)?;
        }
        Ok(JsLocal::new(&cx.heap, array))
    }

    pub(crate) fn get_project<'a>(
        &self,
        cx: &mut JsScope<'a>,
        config_file: JsLocal<'a>,
    ) -> Result<Option<JsLocal<'a>>, bun_jsc::bindgen::Error<'a>> {
        let data = self.data(&cx.heap)?;
        let raw = path_from_value(&cx.heap, config_file.to_js(), "configFile")?;
        let wanted = canonical_selector(&self.cwd, &raw);
        let found = data
            .projects
            .iter()
            .find(|project| resolve_against(&self.cwd, &project.config_path) == wanted);
        Ok(found.map(|project| {
            let value = make_project_js(cx, self, project.index as usize);
            JsLocal::new(&cx.heap, value)
        }))
    }

    pub(crate) fn dispose(&self, _cx: &mut JsScope<'_>) {
        self.data.set(None);
    }
}

pub(crate) fn make_snapshot_js(
    global: &JSGlobalObject,
    data: bun_type_checker::SnapshotData,
    cwd: Box<[u8]>,
    root_closed: Rc<Cell<bool>>,
) -> bun_jsc::JsResult<JSValue> {
    let snapshot = TypeCheckerSnapshot {
        ref_count: bun_ptr::RefCount::init(),
        data: JsCell::new(Some(Rc::new(data))),
        root_closed,
        cwd,
    };
    Ok(js_snapshot::to_js(RefPtr::new(snapshot), global))
}

fn make_project_js(
    cx: &mut JsScope<'_>,
    snapshot: &TypeCheckerSnapshot,
    project_index: usize,
) -> JSValue {
    // SAFETY: `snapshot` is live for this call (the caller holds it).
    let snapshot_ref = unsafe { RefPtr::init_ref(snapshot as *const TypeCheckerSnapshot as *mut _) };
    let project = TypeCheckerProject {
        ref_count: bun_ptr::RefCount::init(),
        snapshot: snapshot_ref,
        project_index,
    };
    js_project::to_js(RefPtr::new(project), cx.global())
}

// ── project ───────────────────────────────────────────────────────────────

#[derive(bun_ptr::RefCounted)]
pub(crate) struct TypeCheckerProject {
    ref_count: bun_ptr::RefCount<TypeCheckerProject>,
    snapshot: RefPtr<TypeCheckerSnapshot>,
    project_index: usize,
}

impl TypeCheckerProject {
    pub(crate) fn get_config_file_name<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        let data = self.snapshot.data(&cx.heap)?;
        let project = &data.projects[self.project_index];
        let value = bun_jsc::bun_string_jsc::create_utf8_for_js(cx.global(), &project.config_path)?;
        Ok(JsLocal::new(&cx.heap, value))
    }

    /// Each read makes a new wrapper over the same snapshot data.
    pub(crate) fn get_program<'a>(
        &self,
        cx: &mut JsScope<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        self.snapshot.data(&cx.heap)?;
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
    /// The diagnostics of this project, optionally of one file, as an array.
    fn collect_diagnostics<'a>(
        &self,
        cx: &mut JsScope<'a>,
        file: JsLocal<'a>,
    ) -> Result<JSValue, bun_jsc::bindgen::Error<'a>> {
        let data = self.snapshot.data(&cx.heap)?;
        let filter = if file.is_undefined() {
            None
        } else {
            let raw = path_from_value(&cx.heap, file.to_js(), "file")?;
            Some(resolve_against(&self.snapshot.cwd, &raw))
        };
        let case_sensitive = data.fs_case_sensitive;
        let wanted = filter.map(|f| normalize_for_filter(&f, case_sensitive));
        let array = JSValue::create_empty_array(cx.global(), 0)?;
        let mut next = 0u32;
        for &index in &data.by_project[self.project_index] {
            let diagnostic = &data.diagnostics[index as usize];
            if let Some(wanted) = &wanted {
                let Some(file_name) = &diagnostic.file_name else {
                    continue;
                };
                if &normalize_for_filter(file_name, case_sensitive) != wanted {
                    continue;
                }
            }
            let converted = convert::diagnostic_to_js(&cx.heap, diagnostic)?;
            array.put_index(cx.global(), next, converted.to_js())?;
            next += 1;
        }
        Ok(array)
    }

    pub(crate) fn get_diagnostics<'a>(
        &self,
        cx: &mut JsScope<'a>,
        file: JsLocal<'a>,
    ) -> Result<JsLocal<'a>, bun_jsc::bindgen::Error<'a>> {
        let mut promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        match self.collect_diagnostics(cx, file) {
            Ok(array) => promise.resolve(cx.global(), array)?,
            Err(e) => {
                let global = cx.global();
                let err = e.to_error_value(global)?;
                promise.reject(global, Ok(err))?;
            }
        }
        Ok(JsLocal::new(&cx.heap, value))
    }
}
