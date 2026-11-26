use bun_sema::util::FxHashMap;
use bun_sema_driver::host::{AlreadyRead, BundledLibs, Provided};
use bun_sema_driver::{Libs, PlanOptions, Request};

use crate::merge::merge_results;
use crate::path::is_same_path;
use crate::snapshot::{AdapterError, SnapshotData};
use crate::state::DesiredState;

/// Whether the run for `selector` produced the project that `selector` names. It does not when the
/// file is missing or is a directory, which the driver reports as a config error, not as a project.
fn names_a_project(data: &SnapshotData, selector: &[u8], case_sensitive: bool) -> bool {
    data.projects
        .iter()
        .any(|project| is_same_path(&project.config_path, selector, case_sensitive))
}

/// Checks every open project of `state` and merges the reports.
pub fn run_check(
    cwd: &[u8],
    state: &DesiredState,
    libs: BundledLibs,
) -> Result<SnapshotData, AdapterError> {
    let selectors = state.project_selectors();

    // `already_read` keys are in the checker's path format (tspath),
    // like `already_read()` in check_command.rs: resolve then convert.
    let mut already_read: AlreadyRead = FxHashMap::default();
    for overlay in state.sources.values() {
        let (path, text) = (&overlay.path, &overlay.text);
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
                libs: Libs::Bundled(libs),
                progress: None,
                order: 1,
                plan_options: PlanOptions::default(),
                stops_like_tsc: true,
                uses_typescript_wording: false,
                after_file: None,
            };
            let report = bun_sema_driver::check_provided_then(&request, provided, |report| report);
            match SnapshotData::check_adapter(&report) {
                Ok(()) => {
                    let data = SnapshotData::from_report(report);
                    results.push(Ok(
                        if names_a_project(&data, selector, state.case_sensitive) {
                            data
                        } else {
                            SnapshotData::unloaded(selector)
                        },
                    ))
                }
                Err(e) => {
                    results.push(Err(e));
                    break;
                }
            }
        }
    }

    merge_results(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_sema_standalone as _;

    #[test]
    fn a_run_without_the_selected_config_is_an_unloaded_project() {
        let data = SnapshotData::unloaded(b"/w/missing.json");
        assert!(names_a_project(&data, b"/w/missing.json", true));
        assert!(!names_a_project(&data, b"/w/sub", true));
        assert!(!names_a_project(&data, b"/w/MISSING.json", true));
        assert!(names_a_project(&data, b"/w/MISSING.json", false));
        assert!(data.diagnostics.is_empty());
        assert_eq!(data.by_project, vec![Vec::<u32>::new()]);
    }

    #[test]
    fn no_open_projects_gives_an_empty_snapshot() {
        let snapshot = run_check(
            b"/w",
            &DesiredState::default(),
            bun_sema_standalone::TYPESCRIPT_LIBS,
        )
        .unwrap();
        assert!(snapshot.projects.is_empty());
        assert!(snapshot.diagnostics.is_empty());
        assert!(snapshot.fs_case_sensitive);
    }
}
