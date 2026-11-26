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
                        program_files: Vec::new(),
                    });
                    by_project.push(Vec::new());
                    index
                });
            if projects[index as usize].program_files.is_empty() {
                projects[index as usize].program_files = project.program_files.clone();
            }
            remap.push(index);
        }
        for mut diagnostic in data.diagnostics {
            let Some(&merged) = remap.get(diagnostic.project as usize) else {
                continue;
            };
            diagnostic.project = merged;
            let key = (
                merged,
                diagnostic.location.file_name.clone().unwrap_or_default(),
                diagnostic.location.pos,
                diagnostic.location.end,
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
    let mut merged = SnapshotData {
        projects,
        diagnostics,
        by_project,
        fs_case_sensitive: case_sensitive,
    };
    sort_projects(&mut merged);
    Ok(merged)
}

/// Orders projects by config file path, like `ProjectCollection.Projects()` sorts by `Project.Name()`
/// (`cmp.Compare` on the config file name, byte-wise and as spelled), and renumbers `project` on every
/// diagnostic, its related diagnostics, and `by_project`.
fn sort_projects(data: &mut SnapshotData) {
    let key = |path: &[u8]| -> Vec<u8> {
        if cfg!(windows) {
            path.iter()
                .map(|&b| if b == b'\\' { b'/' } else { b })
                .collect()
        } else {
            path.to_vec()
        }
    };
    let mut order: Vec<usize> = (0..data.projects.len()).collect();
    order.sort_by(|&a, &b| {
        key(&data.projects[a].config_path).cmp(&key(&data.projects[b].config_path))
    });
    if order.iter().enumerate().all(|(new, &old)| new == old) {
        return;
    }
    let mut new_index = vec![0u32; order.len()];
    for (new, &old) in order.iter().enumerate() {
        new_index[old] = new as u32;
    }
    let mut old_projects: Vec<Option<ProjectData>> = std::mem::take(&mut data.projects)
        .into_iter()
        .map(Some)
        .collect();
    let mut old_by_project: Vec<Vec<u32>> = std::mem::take(&mut data.by_project);
    for (new, &old) in order.iter().enumerate() {
        let mut project = old_projects[old].take().expect("each project moves once");
        project.index = new as u32;
        data.projects.push(project);
        data.by_project
            .push(std::mem::take(&mut old_by_project[old]));
    }
    fn remap(diagnostic: &mut crate::DiagnosticData, new_index: &[u32]) {
        if let Some(&new) = new_index.get(diagnostic.project as usize) {
            diagnostic.project = new;
        }
        for related in &mut diagnostic.related {
            remap(related, new_index);
        }
    }
    for diagnostic in &mut data.diagnostics {
        remap(diagnostic, &new_index);
    }
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
                program_files: Vec::new(),
            }],
            diagnostics: vec![],
            by_project: vec![vec![]],
            fs_case_sensitive: true,
        };
        let b = SnapshotData {
            projects: vec![ProjectData {
                index: 0,
                config_path: b"/b/tsconfig.json".to_vec(),
                program_files: Vec::new(),
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
            location: crate::Location {
                file_name: Some(b"/a.ts".to_vec()),
                pos: Some(pos),
                end: Some(pos + 1),
                line: Some(0),
                column: Some(pos),
                end_line: Some(0),
                end_column: Some(pos + 1),
            },
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
                program_files: Vec::new(),
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

    #[test]
    fn merge_sorts_projects_by_config_path_and_remaps_diagnostics() {
        let mut referenced = diagnostic(0, b"in z");
        referenced.project = 0;
        let mut related_to_root = diagnostic(1, b"in root");
        related_to_root.project = 1;
        related_to_root.related = vec![{
            let mut r = diagnostic(2, b"related");
            r.project = 1;
            r
        }];
        let run = SnapshotData {
            projects: vec![
                ProjectData {
                    index: 0,
                    config_path: b"/w/z/tsconfig.json".to_vec(),
                    program_files: Vec::new(),
                },
                ProjectData {
                    index: 1,
                    config_path: b"/w/a/tsconfig.json".to_vec(),
                    program_files: Vec::new(),
                },
                ProjectData {
                    index: 2,
                    config_path: b"/w/tsconfig.json".to_vec(),
                    program_files: Vec::new(),
                },
            ],
            diagnostics: vec![referenced, related_to_root],
            by_project: vec![vec![0], vec![1], vec![]],
            fs_case_sensitive: true,
        };
        let merged = merge_results(vec![Ok(run)]).unwrap();
        let paths: Vec<&[u8]> = merged.projects.iter().map(|p| &p.config_path[..]).collect();
        assert_eq!(
            paths,
            vec![
                &b"/w/a/tsconfig.json"[..],
                b"/w/tsconfig.json",
                b"/w/z/tsconfig.json"
            ]
        );
        assert_eq!(
            merged.projects.iter().map(|p| p.index).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert_eq!(merged.by_project, vec![vec![1], vec![], vec![0]]);
        assert_eq!(merged.diagnostics[0].project, 2);
        assert_eq!(merged.diagnostics[1].project, 0);
        assert_eq!(merged.diagnostics[1].related[0].project, 0);
    }
}
