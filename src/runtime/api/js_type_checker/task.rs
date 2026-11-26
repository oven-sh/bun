//! Background check task for `Bun.TypeChecker`.
//!
//! The worker builds a borrowed `Request` from owned buffers inside `run()`,
//! calls `check_provided_then` with `Provided { already_read, ends_the_process: false }`,
//! and converts the `Report` into owned `SnapshotData`. Nothing JSC crosses
//! to the worker.

use bun_jsc::{JSPromiseStrong, JobContext, JsResult, JsThread};
use bun_ptr::RefPtr;
use bun_sema::util::FxHashMap;
use bun_sema_driver::host::{AlreadyRead, Provided};
use bun_sema_driver::{Libs, PlanOptions, Request};

use super::TypeChecker;
use super::convert::{AdapterError, SnapshotData};
use super::state::DesiredState;

/// Owned job: everything the worker needs, copied on the JS thread.
pub(crate) struct CheckJob {
    pub(crate) cwd: Vec<u8>,
    pub(crate) state: DesiredState,
    pub(crate) result: Option<Result<SnapshotData, AdapterError>>,
}

/// JS-side owner of a running job: its promise and the root to report back to.
pub(crate) struct CheckJs {
    pub(crate) promise: JSPromiseStrong,
    pub(crate) root: RefPtr<TypeChecker>,
}

// SAFETY: `CheckJs` is only touched on the JS thread: it is handed to the
// worker's `Job` as an opaque payload and comes back in `then`.
unsafe impl bun_jsc::job::JsAffine for CheckJs {}

pub(crate) struct CheckTask {
    pub(crate) job: CheckJob,
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
        let cwd = &job.cwd;
        let state = &job.state;
        let selectors = state.project_selectors();

        // `already_read` keys are in the checker's path format (tspath),
        // like `already_read()` in check_command.rs: resolve then convert.
        let mut already_read: AlreadyRead = FxHashMap::default();
        for (path, text) in &state.sources {
            let resolved = bun_paths::Path::resolve(&[cwd, path]);
            let checker_path = bun_sema_driver::host::from_native(resolved.as_bytes());
            already_read.insert(checker_path, text.clone());
        }

        let mut results: Vec<Result<SnapshotData, AdapterError>> = Vec::new();

        if selectors.is_empty() {
            results.push(Ok(SnapshotData::empty()));
        } else {
            for selector in selectors {
                let provided = Provided {
                    already_read: already_read.clone(),
                    before_read: None,
                    scripts_of_page: None,
                    keeps_byte_order_marks: false,
                    ends_the_process: false,
                };
                let request = Request {
                    cwd,
                    project: Some(selector),
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
    }

    /// Settles this job's promise, then starts the next pending update, then
    /// resolves a waiting `close()` if the root went idle.
    fn finish(self, js: CheckJs, cx: &JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let CheckJs { mut promise, root } = js;
        let promise = promise.swap();
        let settled = if root.is_closed() {
            promise.reject_as_handled(global, super::closed_error_value(global))
        } else {
            match self.job.result {
                Some(Ok(data)) => super::make_snapshot_js(
                    global,
                    data,
                    root.cwd.clone(),
                    root.closed_flag(),
                )
                .and_then(|snapshot| promise.resolve(global, snapshot)),
                Some(Err(e)) => promise.reject(global, Ok(e.to_error_value(global))),
                None => {
                    let err = global.create_error_instance(format_args!(
                        "Bun.TypeChecker: check did not run"
                    ));
                    promise.reject(global, Ok(err))
                }
            }
        };
        let idle = root.job_finished(cx);
        settled.and(idle)
    }
}

fn merge_results(
    results: Vec<Result<SnapshotData, AdapterError>>,
) -> Result<SnapshotData, AdapterError> {
    // The driver can list a referenced project more than once, in one run or
    // across per-selector runs, and attach diagnostics to either occurrence.
    // Projects merge by config path; a diagnostic that two occurrences both
    // report (same project, file, range, code and text) is kept once.
    type Key = (u32, Vec<u8>, Option<u32>, Option<u32>, u32, Vec<u8>);
    let mut projects: Vec<super::convert::ProjectData> = Vec::new();
    let mut config_to_index: std::collections::HashMap<Vec<u8>, u32> = Default::default();
    let mut diagnostics = Vec::new();
    let mut by_project: Vec<Vec<u32>> = Vec::new();
    let mut seen: std::collections::HashSet<Key> = Default::default();
    let mut case_sensitive = true;
    for result in results {
        let data = result?;
        let mut remap: Vec<u32> = Vec::with_capacity(data.projects.len());
        for project in &data.projects {
            let index = *config_to_index
                .entry(project.config_path.clone())
                .or_insert_with(|| {
                    let index = projects.len() as u32;
                    projects.push(super::convert::ProjectData {
                        index,
                        config_path: project.config_path.clone(),
                    });
                    by_project.push(Vec::new());
                    index
                });
            remap.push(index);
        }
        for mut diagnostic in data.diagnostics {
            let Some(&merged) = remap.get(diagnostic.project as usize) else {
                continue;
            };
            diagnostic.project = merged;
            let key = (
                merged,
                diagnostic.file_name.clone().unwrap_or_default(),
                diagnostic.pos,
                diagnostic.end,
                diagnostic.code,
                diagnostic.text.clone(),
            );
            if seen.insert(key) {
                by_project[merged as usize].push(diagnostics.len() as u32);
                diagnostics.push(diagnostic);
            }
        }
        case_sensitive = case_sensitive && data.fs_case_sensitive;
    }
    Ok(SnapshotData {
        projects,
        diagnostics,
        by_project,
        fs_case_sensitive: case_sensitive,
    })
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
