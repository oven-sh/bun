use bun_sema::messages;
use bun_sema_driver::host;
use bun_sema_driver::{Category, MessageChain, ProjectMetadata, Report};

pub fn category_name(category: Category) -> &'static str {
    match category {
        Category::Error => "error",
        Category::Warning => "warning",
        Category::Suggestion => "suggestion",
        Category::Message => "message",
    }
}

/// Render a message the way `bun check` prints it: first line, then each
/// elaboration line indented by two spaces per level.
fn render_text(args: &[Box<[u8]>], code: u32, chain: &[MessageChain]) -> Vec<u8> {
    let template = messages::message(code).map_or("", |m| m.1);
    let mut out = Vec::new();
    messages::format(&mut out, template, args);
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

#[derive(Clone)]
pub struct DiagnosticData {
    pub file_name: Option<Vec<u8>>,
    pub pos: Option<u32>,
    pub end: Option<u32>,
    pub line: Option<u32>,
    pub column: Option<u32>,
    pub end_line: Option<u32>,
    pub end_column: Option<u32>,
    pub code: u32,
    pub category: &'static str,
    pub text: Vec<u8>,
    pub message_chain: Vec<ChainData>,
    pub related: Vec<DiagnosticData>,
    pub project: u32,
}

#[derive(Clone)]
pub struct ChainData {
    pub code: u32,
    pub category: &'static str,
    pub text: Vec<u8>,
    pub message_chain: Vec<ChainData>,
}

fn chain_data(chain: &MessageChain) -> ChainData {
    let category = messages::message(chain.code)
        .map(|(c, _)| category_name(c))
        .unwrap_or("message");
    ChainData {
        code: chain.code,
        category,
        text: render_text(&chain.args, chain.code, &chain.message_chain),
        message_chain: chain.message_chain.iter().map(chain_data).collect(),
    }
}

/// Convert a file-reference error (from `is_below_backslash` handling and
/// from the driver's own path display) to a native JS path.
pub fn native_file_name(checker_path: &[u8]) -> Option<Vec<u8>> {
    if host::is_bundled(checker_path) {
        // Embedded libraries keep their `bundled:///libs/...` identity.
        return Some(checker_path.to_vec());
    }
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
    DiagnosticData {
        file_name: file,
        pos: has_range.then_some(diagnostic.utf16_start.unwrap_or(0)),
        end: has_range.then_some(diagnostic.utf16_end.unwrap_or(0)),
        line: has_range.then_some(diagnostic.line),
        column: has_range.then_some(diagnostic.column),
        end_line: has_range.then_some(diagnostic.end_line),
        end_column: has_range.then_some(diagnostic.end_column),
        code: diagnostic.code,
        category: category_name(diagnostic.category),
        text,
        message_chain: diagnostic.message_chain.iter().map(chain_data).collect(),
        related,
        project: diagnostic.project,
    }
}

pub struct ProjectData {
    pub index: u32,
    pub config_path: Vec<u8>,
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

    pub fn from_report(report: Report) -> Self {
        let projects: Vec<ProjectData> = report
            .projects
            .iter()
            .map(|p: &ProjectMetadata| ProjectData {
                index: p.project_index,
                config_path: native_file_name(&p.config_path)
                    .unwrap_or_else(|| p.config_path.clone()),
            })
            .collect();
        let mut diagnostics: Vec<DiagnosticData> = Vec::with_capacity(report.diagnostics.len());
        let mut by_project: Vec<Vec<u32>> = vec![Vec::new(); projects.len()];
        for diagnostic in &report.diagnostics {
            let data = diagnostic_data(diagnostic);
            let project = data.project as usize;
            if project < by_project.len() {
                by_project[project].push(diagnostics.len() as u32);
            }
            diagnostics.push(data);
        }
        Self {
            projects,
            diagnostics,
            by_project,
            fs_case_sensitive: report.is_case_sensitive,
        }
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

/// Normalize a resolved path for file filtering: lexical, case per the
/// snapshot's filesystem.
pub fn normalize_for_filter(path: &[u8], case_sensitive: bool) -> Vec<u8> {
    let resolved = bun_paths::Path::resolve(&[path]);
    let bytes = resolved.as_bytes().to_vec();
    if case_sensitive {
        bytes
    } else {
        bytes.iter().map(|b| b.to_ascii_lowercase()).collect()
    }
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

    #[test]
    fn native_file_name_converts_checker_path() {
        // On POSIX, a checker path is already native.
        assert_eq!(native_file_name(b"/a/b.ts"), Some(b"/a/b.ts".to_vec()));
        assert_eq!(native_file_name(b""), None);
        assert_eq!(
            native_file_name(b"bundled:///libs/lib.es5.d.ts"),
            Some(b"bundled:///libs/lib.es5.d.ts".to_vec())
        );
    }
}
