use bun_sema::messages;
use bun_sema_driver::host;
use bun_sema_driver::{Category, MessageChain, ProjectMetadata, Report};

use crate::path::{FileFilter, is_same_path, resolve_against};

pub fn category_name(category: Category) -> &'static str {
    match category {
        Category::Error => "error",
        Category::Warning => "warning",
        Category::Suggestion => "suggestion",
        Category::Message => "message",
    }
}

fn render_line(args: &[Box<[u8]>], code: u32) -> Vec<u8> {
    let template = messages::message(code).map_or("", |m| m.1);
    let mut out = Vec::new();
    messages::format(&mut out, template, args);
    out
}

/// Render a message the way `bun check` prints it: first line, then each
/// elaboration line indented by two spaces per level.
fn render_text(args: &[Box<[u8]>], code: u32, chain: &[MessageChain]) -> Vec<u8> {
    let mut out = render_line(args, code);
    fn append(out: &mut Vec<u8>, entry: &MessageChain, level: usize) {
        out.push(b'\n');
        out.extend(std::iter::repeat_n(b' ', 2 * level));
        let template = messages::message(entry.code).map_or("", |m| m.1);
        messages::format(out, template, &entry.args);
        for child in &entry.message_chain {
            append(out, child, level + 1);
        }
    }
    for entry in chain {
        append(&mut out, entry, 1);
    }
    out
}

/// Where a diagnostic is. `pos` is `None` when it has no source range, and then so are the line and column fields.
#[derive(Clone, Default)]
pub struct Location {
    pub file_name: Option<Vec<u8>>,
    pub pos: Option<u32>,
    pub end: Option<u32>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub end_line: Option<u32>,
    pub end_column: Option<u32>,
}

#[derive(Clone)]
pub struct DiagnosticData {
    pub location: Location,
    pub code: u32,
    pub category: &'static str,
    pub text: Vec<u8>,
    pub message_chain: Vec<ChainData>,
    pub related: Vec<DiagnosticData>,
    pub project: u32,
}

/// An entry of a message chain. `text` is the entry's own line, and its elaboration is in `message_chain`.
#[derive(Clone)]
pub struct ChainData {
    pub location: Location,
    pub code: u32,
    pub category: &'static str,
    pub text: Vec<u8>,
    pub message_chain: Vec<ChainData>,
}

fn chain_data(chain: &MessageChain, location: &Location) -> ChainData {
    let category = messages::message(chain.code)
        .map(|(c, _)| category_name(c))
        .unwrap_or("message");
    ChainData {
        location: location.clone(),
        code: chain.code,
        category,
        text: render_line(&chain.args, chain.code),
        message_chain: chain
            .message_chain
            .iter()
            .map(|child| chain_data(child, location))
            .collect(),
    }
}

/// Convert a checker path to a native JS path. Embedded libraries come out as
/// `bundled:///libs/...`, which is how typescript-go prints them.
pub fn native_file_name(checker_path: &[u8]) -> Option<Vec<u8>> {
    if checker_path.is_empty() {
        return None;
    }
    let native = host::to_native(checker_path);
    Some(native.to_vec())
}

fn diagnostic_data(diagnostic: &bun_sema_driver::Diagnostic) -> DiagnosticData {
    let has_range = !diagnostic.has_undefined_range
        && diagnostic.utf16_start.is_some()
        && diagnostic.utf16_end.is_some();
    let file = if diagnostic.path.is_empty() {
        None
    } else {
        native_file_name(&diagnostic.path)
    };
    let text = render_text(&diagnostic.args, diagnostic.code, &diagnostic.message_chain);
    let related = diagnostic
        .related
        .iter()
        .map(|r| diagnostic_data(r))
        .collect();
    let location = Location {
        file_name: file,
        pos: has_range.then_some(diagnostic.utf16_start.unwrap_or(0)),
        end: has_range.then_some(diagnostic.utf16_end.unwrap_or(0)),
        line: has_range.then_some(diagnostic.line),
        column: has_range.then_some(diagnostic.column),
        end_line: has_range.then_some(diagnostic.end_line),
        end_column: has_range.then_some(diagnostic.end_column),
    };
    let chain_location = match diagnostic.chain_at_error {
        true => location.clone(),
        false => Location::default(),
    };
    DiagnosticData {
        message_chain: (diagnostic.message_chain.iter())
            .map(|entry| chain_data(entry, &chain_location))
            .collect(),
        location,
        code: diagnostic.code,
        category: category_name(diagnostic.category),
        text,
        related,
        project: diagnostic.project,
    }
}

/// Sets `project` of a diagnostic and of its related diagnostics to their numbers in `new_index`.
fn renumber(diagnostic: &mut DiagnosticData, new_index: &[Option<u32>]) {
    if let Some(Some(new)) = new_index.get(diagnostic.project as usize) {
        diagnostic.project = *new;
    }
    for related in &mut diagnostic.related {
        renumber(related, new_index);
    }
}

pub struct ProjectData {
    pub index: u32,
    pub config_path: Vec<u8>,
    /// The files of the project's program, as native names.
    pub program_files: Vec<Vec<u8>>,
}

pub struct SnapshotData {
    pub projects: Vec<ProjectData>,
    pub diagnostics: Vec<DiagnosticData>,
    /// Project index -> diagnostic indices, in report order.
    pub by_project: Vec<Vec<u32>>,
    pub fs_case_sensitive: bool,
}

impl SnapshotData {
    pub fn empty() -> Self {
        Self {
            projects: Vec::new(),
            diagnostics: Vec::new(),
            by_project: Vec::new(),
            fs_case_sensitive: true,
        }
    }

    /// `root`: the config file the check was asked for, as an absolute native path.
    ///
    /// Like `tsc`, the check reports the project it is given and not the ones it only reads through `references`. A
    /// configuration file with nothing but `references` is followed, and then every project is reported. Listing a
    /// project that was not checked would show an empty list that does not mean it is clean.
    pub fn from_report(report: Report, root: &[u8]) -> Self {
        let case_sensitive = report.is_case_sensitive;
        let root = resolve_against(b"/", root);
        let config_path = |p: &ProjectMetadata| {
            native_file_name(&p.config_path).unwrap_or_else(|| p.config_path.clone())
        };
        let is_root = |p: &ProjectMetadata| {
            is_same_path(
                &resolve_against(b"/", &config_path(p)),
                &root,
                case_sensitive,
            )
        };
        let reports_all = report.follows_references || !report.projects.iter().any(is_root);
        let mut new_index: Vec<Option<u32>> = vec![None; report.projects.len()];
        let mut projects: Vec<ProjectData> = Vec::new();
        for p in &report.projects {
            if !(reports_all || is_root(p)) {
                continue;
            }
            let Some(slot) = new_index.get_mut(p.project_index as usize) else {
                continue;
            };
            *slot = Some(projects.len() as u32);
            projects.push(ProjectData {
                index: projects.len() as u32,
                config_path: config_path(p),
                program_files: p
                    .program_files
                    .iter()
                    .filter_map(|file| native_file_name(file))
                    .collect(),
            });
        }
        let mut diagnostics: Vec<DiagnosticData> = Vec::with_capacity(report.diagnostics.len());
        let mut by_project: Vec<Vec<u32>> = vec![Vec::new(); projects.len()];
        for diagnostic in &report.diagnostics {
            let mut data = diagnostic_data(diagnostic);
            let Some(project) = new_index.get(data.project as usize).copied().flatten() else {
                continue;
            };
            renumber(&mut data, &new_index);
            by_project[project as usize].push(diagnostics.len() as u32);
            diagnostics.push(data);
        }
        Self {
            projects,
            diagnostics,
            by_project,
            fs_case_sensitive: case_sensitive,
        }
    }

    /// Whether `filter` names a file of this project: one of its program's files, or one that has a diagnostic in it.
    pub fn knows_file(&self, project: usize, filter: &FileFilter) -> bool {
        let case_sensitive = self.fs_case_sensitive;
        let in_program = self.projects[project]
            .program_files
            .iter()
            .any(|file| filter.matches(file, case_sensitive));
        in_program
            || self.by_project[project].iter().any(|&index| {
                let diagnostic = &self.diagnostics[index as usize];
                (diagnostic.location.file_name.as_deref())
                    .is_some_and(|file| filter.matches(file, case_sensitive))
            })
    }

    /// Whether this snapshot came from a report that failed adapter-level
    /// checks (incomplete or unreadable sources). The caller rejects before
    /// building `SnapshotData` in that case.
    pub fn check_adapter(report: &Report) -> Result<(), AdapterError> {
        if !report.incomplete.is_empty() {
            let path = report.incomplete[0].path.clone();
            return Err(AdapterError::Incomplete(path));
        }
        if !report.unreadable.is_empty() {
            return Err(AdapterError::ReadFailed(report.unreadable[0].clone()));
        }
        Ok(())
    }
}

#[derive(Debug)]
pub enum AdapterError {
    Incomplete(Vec<u8>),
    ReadFailed(Vec<u8>),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adapter_rejects_incomplete() {
        let mut report = Report::default();
        report.incomplete.push(bun_sema_driver::Incomplete {
            path: b"/a.ts".to_vec(),
            is_nested_too_deeply: false,
            deepest_nesting: 0,
            nested_too_deeply_at: None,
        });
        assert!(matches!(
            SnapshotData::check_adapter(&report),
            Err(AdapterError::Incomplete(_))
        ));
    }

    #[test]
    fn adapter_rejects_unreadable() {
        let mut report = Report::default();
        report.unreadable.push(b"/a.ts".to_vec());
        assert!(matches!(
            SnapshotData::check_adapter(&report),
            Err(AdapterError::ReadFailed(_))
        ));
    }

    #[test]
    fn adapter_accepts_clean_report() {
        let report = Report::default();
        assert!(SnapshotData::check_adapter(&report).is_ok());
    }

    fn report_of(follows_references: bool, files: &[&[u8]]) -> Report {
        let project = |index: u32, config: &[u8], files: &[&[u8]]| ProjectMetadata {
            project_index: index,
            config_path: config.to_vec(),
            program_files: files.iter().map(|file| file.to_vec()).collect(),
        };
        let mut report = Report::default();
        report.projects = vec![
            project(0, b"/w/a/tsconfig.json", &[b"/w/a/x.ts"]),
            project(1, b"/w/tsconfig.json", files),
        ];
        report.follows_references = follows_references;
        report.is_case_sensitive = true;
        report
    }

    #[test]
    fn a_project_that_was_only_read_is_not_listed() {
        let data = SnapshotData::from_report(report_of(false, &[b"/w/m.ts"]), b"/w/tsconfig.json");
        let names: Vec<&[u8]> = data.projects.iter().map(|p| &p.config_path[..]).collect();
        assert_eq!(names, vec![&b"/w/tsconfig.json"[..]]);
        assert_eq!(data.projects[0].index, 0);
        assert_eq!(data.projects[0].program_files, vec![b"/w/m.ts".to_vec()]);
        assert_eq!(data.by_project.len(), 1);
    }

    #[test]
    fn every_project_is_listed_when_the_root_only_has_references() {
        let data = SnapshotData::from_report(report_of(true, &[]), b"/w/tsconfig.json");
        assert_eq!(data.projects.len(), 2);
    }

    #[test]
    fn a_root_that_matches_no_project_lists_them_all() {
        let data = SnapshotData::from_report(report_of(false, &[]), b"/elsewhere/tsconfig.json");
        assert_eq!(data.projects.len(), 2);
    }

    #[test]
    fn a_file_is_known_if_it_is_in_the_program_or_has_a_diagnostic() {
        let data = SnapshotData::from_report(report_of(false, &[b"/w/m.ts"]), b"/w/tsconfig.json");
        assert!(data.knows_file(0, &FileFilter::new(b"/w", b"m.ts")));
        assert!(!data.knows_file(0, &FileFilter::new(b"/w", b"typo.ts")));
        assert!(!data.knows_file(0, &FileFilter::new(b"/w", b"a/x.ts")));
    }

    #[test]
    fn native_file_name_converts_checker_path() {
        // On POSIX, a checker path is already native.
        assert_eq!(native_file_name(b"/a/b.ts"), Some(b"/a/b.ts".to_vec()));
        assert_eq!(native_file_name(b""), None);
        assert_eq!(
            native_file_name(b"/bundled:///libs/lib.es5.d.ts"),
            Some(b"bundled:///libs/lib.es5.d.ts".to_vec())
        );
    }
}
