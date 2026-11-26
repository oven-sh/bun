use bun_sema::util::FxHashMap;
use bun_sema_driver::host::{AlreadyRead, BundledLibs, Provided};
use bun_sema_driver::{Libs, PlanOptions, Request};

use crate::merge::merge_results;
use crate::snapshot::{AdapterError, SnapshotData};
use crate::state::DesiredState;

/// A selector that does not name a regular file is no project: typescript-go drops a project whose
/// config file cannot be read, without an error.
fn names_a_config_file(selector: &[u8]) -> bool {
    bun_sema_driver::host::is_regular_file(&bun_sema_driver::host::from_native(selector))
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
            if !names_a_config_file(selector) {
                continue;
            }
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
                plan_options: PlanOptions {
                    lists_program_files: true,
                    ..PlanOptions::default()
                },
                stops_like_tsc: true,
                uses_typescript_wording: false,
                after_file: None,
            };
            let report = bun_sema_driver::check_provided_then(&request, provided, |report| report);
            match SnapshotData::check_adapter(&report) {
                Ok(()) => results.push(Ok(SnapshotData::from_report(report, selector))),
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
    fn a_missing_file_or_a_directory_is_no_project() {
        assert!(!names_a_config_file(b"/definitely/not/here/tsconfig.json"));
        assert!(!names_a_config_file(b"/"));
        let snapshot = run_check(
            b"/",
            &{
                let mut state = DesiredState::default();
                state.apply_projects(&[], &[b"/definitely/not/here.json".to_vec(), b"/".to_vec()]);
                state
            },
            bun_sema_standalone::TYPESCRIPT_LIBS,
        )
        .unwrap();
        assert!(snapshot.projects.is_empty());
        assert!(snapshot.diagnostics.is_empty());
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
