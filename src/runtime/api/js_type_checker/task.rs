//! Background check task for `Bun.TypeChecker`.
//!
//! The worker builds a borrowed `Request` from owned buffers inside `run()`,
//! calls `check_provided_then` with `Provided { already_read, ends_the_process: false }`,
//! and converts the `Report` into owned `SnapshotData`. Nothing JSC crosses
//! to the worker.

use std::sync::Arc;

use bun_jsc::{JSGlobalObject, JSPromiseStrong, JobContext, JsResult, JsThread};
use bun_ptr::BackRef;
use bun_sema::util::FxHashMap;
use bun_sema_driver::host::{AlreadyRead, Provided};
use bun_sema_driver::{Libs, PlanOptions, Request};

use super::convert::{AdapterError, SnapshotData};
use super::state::{self, DesiredState, RootShared};

/// Owned job: everything the worker needs, copied on the JS thread.
pub(crate) struct CheckJob {
    pub(crate) cwd: Vec<u8>,
    pub(crate) state: DesiredState,
    /// Sequence number within the root, for ordering assertions.
    pub(crate) sequence: u64,
    pub(crate) result: Option<Result<SnapshotData, AdapterError>>,
    pub(crate) shared: Arc<RootShared>,
}

/// JS-side owner: promise, root back-reference, detached flag.
pub(crate) struct CheckJs {
    pub(crate) promise: JSPromiseStrong,
    pub(crate) global_this: BackRef<JSGlobalObject>,
    pub(crate) root: Arc<RootShared>,
    /// Set by `close()` on the JS thread: delivery is rejected with CLOSED.
    pub(crate) detached: Arc<core::sync::atomic::AtomicBool>,
}

// SAFETY: `promise`/`global_this` are plain JS handles; `root` is only read
// on the JS thread (the worker-side counter lives on the off-thread job);
// `detached` is written and read only on the JS thread.
unsafe impl bun_jsc::job::JsAffine for CheckJs {}

pub(crate) struct CheckTask {
    pub(crate) job: CheckJob,
}

/// One queued update waiting for the running check to finish.
pub(crate) struct PendingEntry {
    pub(crate) cwd: Vec<u8>,
    pub(crate) state: DesiredState,
    pub(crate) sequence: u64,
    pub(crate) js: CheckJs,
}

impl JobContext for CheckTask {
    type OffThread = Self;
    type Js = CheckJs;

    fn run(off: &mut Self, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        off.run_checked();
        Some(done)
    }

    fn then(off: Self, js: CheckJs, cx: &JsThread<'_>) -> JsResult<()> {
        off.finish(js, cx)
    }
}

impl CheckTask {
    fn run_checked(&mut self) {
        let job = &mut self.job;
        let _sequence = job.sequence;
        let cwd = job.cwd.clone();
        let state = job.state.clone();
        let selectors = state.project_selectors();

        // `already_read` keys are in the checker's path format (tspath),
        // like `already_read()` in check_command.rs: resolve then convert.
        let mut already_read: AlreadyRead = FxHashMap::default();
        for (path, text) in &state.sources {
            let resolved = bun_paths::Path::resolve(&[&cwd, path]);
            let checker_path = bun_sema_driver::host::from_native(resolved.as_bytes());
            already_read.insert(checker_path, text.clone());
        }

        let mut results: Vec<Result<SnapshotData, AdapterError>> = Vec::new();

        if selectors.is_empty() {
            results.push(Ok(SnapshotData::empty()));
        } else {
            for selector in selectors {
                let project_arg = resolve_selector(&cwd, selector);
                let provided = Provided {
                    already_read: already_read.clone(),
                    before_read: None,
                    scripts_of_page: None,
                    keeps_byte_order_marks: false,
                    ends_the_process: false,
                };
                let request = Request {
                    cwd: &cwd,
                    project: Some(&project_arg),
                    listed_projects: None,
                    build: false,
                    errors: &[],
                    paths: &[],
                    are_entry_points: false,
                    script_kinds: &[],
                    script_kinds_by_extension: &[],
                    conditions: &[],
                    compiler_options: &[],
                    threads: 0,
                    libs: Libs::Bundled(crate::cli::typescript_libs::BUNDLED),
                    progress: None,
                    order: 1,
                    plan_options: PlanOptions::default(),
                    stops_like_tsc: true,
                    uses_typescript_wording: false,
                    after_file: None,
                };
                let report =
                    bun_sema_driver::check_provided_then(&request, provided, |report| report);
                match SnapshotData::check_adapter(&report) {
                    Ok(()) => results.push(Ok(SnapshotData::from_report(report))),
                    Err(e) => {
                        results.push(Err(e));
                        break;
                    }
                }
            }
        }

        job.result = Some(merge_results(results));
        // Decrement only after `finish` started the next job (see `finish`).
        // `finish` re-increments synchronously when it schedules the next
        // entry, so the count never drops to zero mid-queue.
    }

    fn finish(self, mut js: CheckJs, cx: &JsThread<'_>) -> JsResult<()> {
        let _global_this = &js.global_this;
        let _shared = self.job.shared.clone();
        let global = cx.global();
        // Start the next queued update for this root, if any. It was
        // captured at `updateSnapshot` time and has not run yet.
        let root = js.root.clone();
        let next: Option<Box<PendingEntry>> = {
            let mut pending = root.pending.lock().unwrap();
            pending.pop_front().map(|state::PendingPtr(raw)| {
                // SAFETY: only pushed/popped on the JS thread.
                unsafe { Box::from_raw(raw) }
            })
        };
        if let Some(entry) = next {
            // Hand over the running slot to the next job.
            *root.running_detached.lock().unwrap() = Some(entry.js.detached.clone());
            let next_task = CheckTask {
                job: CheckJob {
                    cwd: entry.cwd,
                    state: entry.state,
                    sequence: entry.sequence,
                    result: None,
                    shared: root.clone(),
                },
            };
            bun_jsc::Job::<CheckTask>::schedule(cx, next_task, entry.js);
        } else {
            *root.running_detached.lock().unwrap() = None;
            // Queue drained: the root is idle again.
            root.running
                .fetch_sub(1, core::sync::atomic::Ordering::AcqRel);
            // If `close()` is waiting, resolve it now that native work drained.
            // Keep it stored so repeated `close()` returns the same promise.
            let _ = super::resolve_close_promise(&root, global);
        }
        let promise = js.promise.swap();
        if js.detached.load(core::sync::atomic::Ordering::Acquire) {
            // `close()` detached this job: reject with CLOSED instead of delivering.
            let err_value = bun_jsc::ErrorCode::BUN_TYPE_CHECKER_CLOSED.fmt(
                global,
                format_args!("Bun.TypeChecker: this TypeChecker is closed"),
            );
            return promise.reject_as_handled(global, err_value);
        }
        match self.job.result {
            Some(Ok(data)) => {
                let cwd = self.job.cwd.clone();
                let value = super::make_snapshot_js(global, data, cwd.into_boxed_slice(), js.root.clone())?;
                promise.resolve(global, value)
            }
            Some(Err(e)) => {
                let err = e.into_js_result(global)?;
                // `into_js_result` always errors; the `?` propagates the
                // pending JsError, so this line is unreachable.
                let _ = err;
                Ok(())
            }
            None => {
                let err = global.create_error_instance(format_args!(
                    "Bun.TypeChecker: check did not run"
                ));
                promise.reject(global, Ok(err))
            }
        }
    }
}

fn merge_results(
    results: Vec<Result<SnapshotData, AdapterError>>,
) -> Result<SnapshotData, AdapterError> {
    // Deduplicate projects by config path: a referenced project can appear in
    // more than one per-selector run. Diagnostics from later occurrences of
    // the same config are dropped (they are duplicates).
    let mut projects: Vec<super::convert::ProjectData> = Vec::new();
    let mut config_to_index: std::collections::HashMap<Vec<u8>, u32> = Default::default();
    let mut diagnostics = Vec::new();
    let mut by_project: Vec<Vec<u32>> = Vec::new();
    let mut seen_diagnostics: std::collections::HashSet<(u32, Vec<u8>, u32, Vec<u8>)> = Default::default();
    let mut case_sensitive = true;
    for result in results {
        match result {
            Err(e) => return Err(e),
            Ok(data) => {
                // Remap this run's project indices onto the merged indices.
                let mut remap: Vec<u32> = vec![0; data.projects.len()];
                for (i, project) in data.projects.iter().enumerate() {
                    if let Some(&existing) = config_to_index.get(&project.config_path) {
                        remap[i] = existing;
                    } else {
                        let index = projects.len() as u32;
                        config_to_index.insert(project.config_path.clone(), index);
                        remap[i] = index;
                        projects.push(super::convert::ProjectData {
                            index,
                            config_path: project.config_path.clone(),
                        });
                        by_project.push(Vec::new());
                    }
                }
                for mut diagnostic in data.diagnostics {
                    if (diagnostic.project as usize) < remap.len() {
                        diagnostic.project = remap[diagnostic.project as usize];
                    }
                    // Drop exact duplicates only from the *same* project: the
                    // same file error reported by two different projects is
                    // two diagnostics.
                    let key = (
                        diagnostic.project,
                        diagnostic.file_name.clone().unwrap_or_default(),
                        diagnostic.code,
                        diagnostic.text.clone(),
                    );
                    if seen_diagnostics.insert(key) {
                        let idx = diagnostics.len() as u32;
                        if (diagnostic.project as usize) < by_project.len() {
                            by_project[diagnostic.project as usize].push(idx);
                        }
                        diagnostics.push(diagnostic);
                    }
                }
                case_sensitive = case_sensitive && data.fs_case_sensitive;
            }
        }
    }
    Ok(SnapshotData {
        projects,
        diagnostics,
        by_project,
        fs_case_sensitive: case_sensitive,
    })
}

/// A selector names a config file or a directory containing one. The driver
/// only takes a config file (or a directory it resolves itself via
/// `is_dir`); we resolve directories here, on the worker.
fn resolve_selector(cwd: &[u8], selector: &[u8]) -> Vec<u8> {
    let absolute = if bun_paths::is_absolute(selector) {
        bun_paths::Path::resolve(&[selector]).as_bytes().to_vec()
    } else {
        bun_paths::Path::resolve(&[cwd, selector]).as_bytes().to_vec()
    };
    // If it looks like a directory (exists and has no tsconfig extension),
    // point at its tsconfig.json.
    if !absolute.ends_with(b"tsconfig.json") {
        // Check if it's a directory on disk.
        let path = bun_paths::Path::from(&absolute);
        if let Ok(stat) = bun_sys::stat(&path) {
            if bun_sys::kind_from_mode(stat.st_mode as bun_sys::Mode) == bun_sys::FileKind::Directory
            {
                return bun_paths::Path::from_parts(&[&absolute, b"tsconfig.json"])
                    .as_bytes()
                    .to_vec();
            }
        }
    }
    absolute
}

#[cfg(test)]
mod tests {
    use super::merge_results;
    use crate::api::js_type_checker::convert::AdapterError;
    use crate::api::js_type_checker::convert::SnapshotData;

    #[test]
    fn merge_remaps_project_indices() {
        let a = SnapshotData {
            projects: vec![crate::api::js_type_checker::convert::ProjectData {
                index: 0,
                config_path: b"/a/tsconfig.json".to_vec(),
            }],
            diagnostics: vec![],
            by_project: vec![vec![]],
            fs_case_sensitive: true,
        };
        let b = SnapshotData {
            projects: vec![crate::api::js_type_checker::convert::ProjectData {
                index: 0,
                config_path: b"/b/tsconfig.json".to_vec(),
            }],
            diagnostics: vec![],
            by_project: vec![vec![]],
            fs_case_sensitive: true,
        };
        let merged = merge_results(vec![Ok(a), Ok(b)]).unwrap();
        assert_eq!(merged.projects.len(), 2);
        assert_eq!(merged.projects[1].index, 1);
    }

    #[test]
    fn merge_propagates_adapter_error() {
        let err = merge_results(vec![Err(AdapterError::Incomplete(b"/a.ts".to_vec()))]);
        assert!(matches!(err, Err(AdapterError::Incomplete(_))));
    }
}
