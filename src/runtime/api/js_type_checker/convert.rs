//! Owned snapshot data and native `Report` -> JS conversion for
//! `Bun.TypeChecker`.
//!
//! `SnapshotData` is built on the worker from the driver `Report`: owned
//! bytes only, no arena/JSC/VM pointers, no retained `Session`.

use bun_jsc::bindgen::{JsHeap, JsLocal, Result as BindgenResult};
use bun_jsc::{JSValue, JsResult};
use bun_sema::messages;
use bun_sema_driver::host;
use bun_sema_driver::{Category, MessageChain, ProjectMetadata, Report};

pub(crate) fn category_name(category: Category) -> &'static str {
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
pub(crate) struct DiagnosticData {
    pub(crate) file_name: Option<Vec<u8>>,
    pub(crate) pos: Option<u32>,
    pub(crate) end: Option<u32>,
    pub(crate) line: Option<u32>,
    pub(crate) column: Option<u32>,
    pub(crate) end_line: Option<u32>,
    pub(crate) end_column: Option<u32>,
    pub(crate) code: u32,
    pub(crate) category: &'static str,
    pub(crate) text: Vec<u8>,
    pub(crate) message_chain: Vec<ChainData>,
    pub(crate) related: Vec<DiagnosticData>,
    pub(crate) project: u32,
}

#[derive(Clone)]
pub(crate) struct ChainData {
    pub(crate) code: u32,
    pub(crate) category: &'static str,
    pub(crate) text: Vec<u8>,
    pub(crate) message_chain: Vec<ChainData>,
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
pub(crate) fn native_file_name(checker_path: &[u8]) -> Option<Vec<u8>> {
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

pub(crate) struct ProjectData {
    pub(crate) index: u32,
    pub(crate) config_path: Vec<u8>,
}

pub(crate) struct SnapshotData {
    pub(crate) projects: Vec<ProjectData>,
    pub(crate) diagnostics: Vec<DiagnosticData>,
    /// Project index -> diagnostic indices, in report order.
    pub(crate) by_project: Vec<Vec<u32>>,
    pub(crate) fs_case_sensitive: bool,
}

impl SnapshotData {
    pub(crate) fn empty() -> Self {
        Self {
            projects: Vec::new(),
            diagnostics: Vec::new(),
            by_project: Vec::new(),
            fs_case_sensitive: true,
        }
    }

    pub(crate) fn from_report(report: Report) -> Self {
        let projects: Vec<ProjectData> = report
            .projects
            .iter()
            .map(|p: &ProjectMetadata| ProjectData {
                index: p.project_index,
                config_path: native_file_name(&p.config_path).unwrap_or_else(|| p.config_path.clone()),
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
    pub(crate) fn check_adapter(report: &Report) -> Result<(), AdapterError> {
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
pub(crate) enum AdapterError {
    Incomplete(Vec<u8>),
    ReadFailed(Vec<u8>),
}

impl AdapterError {
    pub(crate) fn into_error<'a>(self, heap: &JsHeap<'a>) -> bun_jsc::bindgen::Error<'a> {
        match self {
            AdapterError::Incomplete(path) => heap.error_with_code(
                bun_jsc::ErrorCode::BUN_TYPE_CHECKER_INCOMPLETE,
                format_args!(
                    "Bun.TypeChecker: the check did not complete for '{}'",
                    bstr::BStr::new(&path)
                ),
            ),
            AdapterError::ReadFailed(path) => heap.error_with_code(
                bun_jsc::ErrorCode::BUN_TYPE_CHECKER_READ_FAILED,
                format_args!(
                    "Bun.TypeChecker: could not read '{}'",
                    bstr::BStr::new(&path)
                ),
            ),
        }
    }

    pub(crate) fn into_js_result(self, global: &bun_jsc::JSGlobalObject) -> JsResult<JSValue> {
        let heap = JsHeap::from_global(global);
        Err(self.into_error(heap).into_js_error(global))
    }
}

// ── JS materialization ────────────────────────────────────────────────────

fn chain_to_js<'a>(heap: &JsHeap<'a>, chain: &ChainData) -> BindgenResult<'a, JsLocal<'a>> {
    // SAFETY: `heap` belongs to this call; allocating runs no JavaScript.
    let global = unsafe { heap.global() };
    let obj = JSValue::create_empty_object(global, 4);
    obj.put(global, b"code", JSValue::js_number(chain.code as f64));
    obj.put(
        global,
        b"category",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, chain.category.as_bytes())?,
    );
    obj.put(
        global,
        b"text",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &chain.text)?,
    );
    if !chain.message_chain.is_empty() {
        let arr = JSValue::create_empty_array(global, chain.message_chain.len())?;
        for (i, child) in chain.message_chain.iter().enumerate() {
            arr.put_index(global, i as u32, chain_to_js(heap, child)?.to_js())?;
        }
        obj.put(global, b"messageChain", arr);
    }
    Ok(JsLocal::new(heap, obj))
}

pub(crate) fn diagnostic_to_js<'a>(
    heap: &JsHeap<'a>,
    diagnostic: &DiagnosticData,
) -> BindgenResult<'a, JsLocal<'a>> {
    // SAFETY: as above.
    let global = unsafe { heap.global() };
    let obj = JSValue::create_empty_object(global, 11);
    if let Some(pos) = diagnostic.pos {
        if let Some(file_name) = &diagnostic.file_name {
            obj.put(
                global,
                b"fileName",
                bun_jsc::bun_string_jsc::create_utf8_for_js(global, file_name)?,
            );
        }
        obj.put(global, b"pos", JSValue::js_number(pos as f64));
        obj.put(
            global,
            b"end",
            JSValue::js_number(diagnostic.end.unwrap_or(pos) as f64),
        );
        obj.put(global, b"line", JSValue::js_number(diagnostic.line.unwrap_or(0) as f64));
        obj.put(
            global,
            b"column",
            JSValue::js_number(diagnostic.column.unwrap_or(0) as f64),
        );
        obj.put(
            global,
            b"endLine",
            JSValue::js_number(diagnostic.end_line.unwrap_or(0) as f64),
        );
        obj.put(
            global,
            b"endColumn",
            JSValue::js_number(diagnostic.end_column.unwrap_or(0) as f64),
        );
    } else if let Some(file_name) = &diagnostic.file_name {
        obj.put(
            global,
            b"fileName",
            bun_jsc::bun_string_jsc::create_utf8_for_js(global, file_name)?,
        );
    }
    obj.put(global, b"code", JSValue::js_number(diagnostic.code as f64));
    obj.put(
        global,
        b"category",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, diagnostic.category.as_bytes())?,
    );
    obj.put(
        global,
        b"text",
        bun_jsc::bun_string_jsc::create_utf8_for_js(global, &diagnostic.text)?,
    );
    if !diagnostic.message_chain.is_empty() {
        let arr = JSValue::create_empty_array(global, diagnostic.message_chain.len())?;
        for (i, child) in diagnostic.message_chain.iter().enumerate() {
            arr.put_index(global, i as u32, chain_to_js(heap, child)?.to_js())?;
        }
        obj.put(global, b"messageChain", arr);
    }
    if !diagnostic.related.is_empty() {
        let arr = JSValue::create_empty_array(global, diagnostic.related.len())?;
        for (i, child) in diagnostic.related.iter().enumerate() {
            arr.put_index(global, i as u32, diagnostic_to_js(heap, child)?.to_js())?;
        }
        obj.put(global, b"relatedInformation", arr);
    }
    Ok(JsLocal::new(heap, obj))
}

/// Normalize a resolved path for file filtering: lexical, case per the
/// snapshot's filesystem.
pub(crate) fn normalize_for_filter(path: &[u8], case_sensitive: bool) -> Vec<u8> {
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
