use crate::snapshot::{AdapterError, ProjectData, SnapshotData};

pub fn merge_results(
    results: Vec<Result<SnapshotData, AdapterError>>,
) -> Result<SnapshotData, AdapterError> {
    // The driver can list a referenced project more than once, in one run or
    // across per-selector runs, and attach diagnostics to either occurrence.
    // Projects merge by config path; a diagnostic that two occurrences both
    // report (same project, file, range, code and text) is kept once.
    type Key = (u32, Vec<u8>, Option<u32>, Option<u32>, u32, Vec<u8>);
    let mut projects: Vec<ProjectData> = Vec::new();
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
                    projects.push(ProjectData {
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
    use super::*;

    #[test]
    fn merge_remaps_project_indices() {
        let a = SnapshotData {
            projects: vec![ProjectData {
                index: 0,
                config_path: b"/a/tsconfig.json".to_vec(),
            }],
            diagnostics: vec![],
            by_project: vec![vec![]],
            fs_case_sensitive: true,
        };
        let b = SnapshotData {
            projects: vec![ProjectData {
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

    fn diagnostic(pos: u32, text: &[u8]) -> crate::DiagnosticData {
        crate::DiagnosticData {
            file_name: Some(b"/a.ts".to_vec()),
            pos: Some(pos),
            end: Some(pos + 1),
            line: Some(0),
            column: Some(pos),
            end_line: Some(0),
            end_column: Some(pos + 1),
            code: 2322,
            category: "error",
            text: text.to_vec(),
            message_chain: vec![],
            related: vec![],
            project: 0,
        }
    }

    fn snapshot(diagnostics: Vec<crate::DiagnosticData>) -> SnapshotData {
        let by_project = vec![(0..diagnostics.len() as u32).collect()];
        SnapshotData {
            projects: vec![ProjectData {
                index: 0,
                config_path: b"/a/tsconfig.json".to_vec(),
            }],
            diagnostics,
            by_project,
            fs_case_sensitive: true,
        }
    }

    #[test]
    fn merge_dedups_identical_diagnostics_across_runs() {
        let a = snapshot(vec![diagnostic(0, b"x")]);
        let b = snapshot(vec![diagnostic(0, b"x")]);
        let merged = merge_results(vec![Ok(a), Ok(b)]).unwrap();
        assert_eq!(merged.projects.len(), 1);
        assert_eq!(merged.diagnostics.len(), 1);
        assert_eq!(merged.by_project, vec![vec![0]]);
    }

    #[test]
    fn merge_keeps_identical_messages_at_different_positions() {
        let a = snapshot(vec![diagnostic(0, b"x"), diagnostic(5, b"x")]);
        let merged = merge_results(vec![Ok(a)]).unwrap();
        assert_eq!(merged.diagnostics.len(), 2);
        assert_eq!(merged.by_project, vec![vec![0, 1]]);
    }

    #[test]
    fn merge_case_sensitivity_is_conjunctive() {
        let a = snapshot(vec![]);
        let mut b = snapshot(vec![]);
        b.fs_case_sensitive = false;
        assert!(!merge_results(vec![Ok(a), Ok(b)]).unwrap().fs_case_sensitive);
    }
}
