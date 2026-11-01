use core::fmt::Display;

use bun_sema::check::aot::{Effect, FileOrigin, effect_of};
use bun_sema::util::SharedSort;

use super::sink::to_log_message;
use super::{
    COMPILER_DIAGNOSTIC_CLASS, Diagnostics, Severity, SourcePosition, new_driver_diagnostic,
};
use crate::engine::{
    EngineResult, InternalErrorRecord, Position, UserDiagnosticRecord, position_of,
};
use crate::ir::generated::{DiagnosticSeverity, UserDiagnosticKind};
use crate::ir::{FunctionId, LayoutId, ModuleId};
use crate::link::{ModuleOrigin, ProgramNames};
use crate::report::{ModuleLocator, SourceTexts};

// The files of dependencies that declare an `int32` which the engine could not prove, by the paths that messages name them by.
fn find_dependencies_with_unproven_int32(
    result: &EngineResult,
    names: &ProgramNames,
) -> Vec<Vec<u8>> {
    let records = result
        .user_diagnostics()
        .iter()
        .filter(|record| is_about_dependency(record));
    let declared_in = records.filter_map(|record| Some(position_of(record.origin)?.module));
    let mut paths: Vec<Vec<u8>> = declared_in
        .map(|module| names.module_path(module).to_vec())
        .collect();
    paths.shared_sort_unstable();
    paths.dedup();
    paths
}

fn is_about_dependency(record: &UserDiagnosticRecord) -> bool {
    record.kind == UserDiagnosticKind::Int32OfDependencyNotProven
}

fn is_about_load_by_unknown_name(record: &UserDiagnosticRecord) -> bool {
    matches!(
        record.kind,
        UserDiagnosticKind::CodeOutsideImageIsRefused
            | UserDiagnosticKind::ModuleNamedAtRunTimeIsRefused
    )
}

impl Diagnostics {
    pub(crate) fn add_engine_records(
        &mut self,
        result: &EngineResult,
        names: &ProgramNames,
        texts: &SourceTexts,
        runs_tests: bool,
    ) {
        let mut locator = ModuleLocator::new(texts);
        for path in find_dependencies_with_unproven_int32(result, names) {
            let kind = UserDiagnosticKind::Int32OfDependencyNotProven;
            let severity = severity_of(kind.severity());
            let text = [
                &b"The compiler can't prove every 'int32' that \""[..],
                &path,
                b"\" declares, so it tests them when the program runs. The file still works, but runs slower.",
            ]
            .concat();
            let reported = new_driver_diagnostic(kind.code(), severity.category(), text, &[]);
            self.add_message(kind.code(), to_log_message(&reported, severity));
        }
        for record in result
            .user_diagnostics()
            .iter()
            .filter(|record| !is_about_dependency(record))
            // A suite has many such loads, and most find a file that was compiled. The test whose load is refused fails with an error that says so.
            .filter(|record| !(runs_tests && is_about_load_by_unknown_name(record)))
        {
            self.add_user_diagnostic(record, result.text(record.message), names, &mut locator);
        }
        for record in result.internal_errors() {
            self.add_internal_error_record(
                record,
                result.text(record.message),
                names,
                &mut locator,
            );
        }
    }

    pub(super) fn add_internal_error_record(
        &mut self,
        record: &InternalErrorRecord,
        text: &[u8],
        names: &ProgramNames,
        locator: &mut ModuleLocator<'_>,
    ) {
        let message = internal_error_text(record, text, names, locator);
        let stage = record.kind.stage();
        let start_of_function_module = || {
            let module = names.function_module(record.function_id()?)?;
            Some(Position { module, offset: 0 })
        };
        let position = position_of(record.location).or_else(start_of_function_module);
        // The path that the messages of users' errors have. `ProgramNames::module_path` may be relative.
        match position.and_then(|position| locator.position_of(position)) {
            Some(position) => self.report_internal_error_in_file(stage, message, position.path),
            None => self.report_internal_error(stage, message),
        }
    }

    pub(super) fn add_user_diagnostic(
        &mut self,
        record: &UserDiagnosticRecord,
        text: &[u8],
        names: &ProgramNames,
        locator: &mut ModuleLocator<'_>,
    ) {
        let kind = record.kind;
        let severity = severity_of(kind.severity());
        let written = self.write_int32_message(record, names);
        let (text, position) = match &written {
            Some((written, shown)) => (written.as_slice(), *shown),
            None => (
                text_or_template(text, kind.message()),
                position_of(record.location),
            ),
        };
        let origin = origin_of(position, names);
        match effect_of(origin, COMPILER_DIAGNOSTIC_CLASS, severity.category()) {
            Effect::Dropped => return,
            Effect::InternalError => {
                let mut message = text.to_vec();
                if let Some(position) = position {
                    append_module_path(&mut message, names, position.module);
                }
                self.report_internal_error(kind.stage(), message);
                return;
            }
            Effect::StopsBuild | Effect::Warns | Effect::WithdrawsTrust => {}
        }
        let reported = new_driver_diagnostic(kind.code(), severity.category(), text.to_vec(), &[]);
        let reported = match position {
            Some(position) => locator.locate(position, reported),
            None => reported,
        };
        self.add_message(kind.code(), to_log_message(&reported, severity));
    }
}

pub(super) fn internal_error_text(
    record: &InternalErrorRecord,
    text: &[u8],
    names: &ProgramNames,
    locator: &mut ModuleLocator<'_>,
) -> Vec<u8> {
    let mut message = record.kind.name().as_bytes().to_vec();
    message.extend_from_slice(b": ");
    message.extend_from_slice(text_or_template(text, record.kind.message()));
    // The engine's text has every member of the record under the engine's ids. The record's function and layout are the ones the front end sent.
    let (function, layout) = (record.function_id(), record.layout_id());
    let position = position_of(record.location).and_then(|position| locator.position_of(position));
    append_subject(&mut message, names, function, layout, position.as_ref());
    message
}

fn append_subject(
    text: &mut Vec<u8>,
    names: &ProgramNames,
    function: Option<FunctionId>,
    layout: Option<LayoutId>,
    position: Option<&SourcePosition>,
) {
    if let Some(function) = function {
        text.extend_from_slice(b" in function ");
        append_name_or_id(text, names.function_name(function), function);
    }
    match (
        position,
        function.and_then(|function| names.function_module(function)),
    ) {
        (Some(position), _) => {
            text.extend_from_slice(b" at ");
            text.extend_from_slice(&position.path);
            text.extend_from_slice(format!(":{}:{}", position.line, position.column).as_bytes());
        }
        (None, Some(module)) => append_module_path(text, names, module),
        (None, None) => {}
    }
    if let Some(layout) = layout {
        text.extend_from_slice(b" of layout ");
        append_name_or_id(text, names.layout_name(layout), layout);
    }
}

fn append_name_or_id(text: &mut Vec<u8>, name: &[u8], id: impl Display) {
    if name.is_empty() {
        text.extend_from_slice(id.to_string().as_bytes());
        return;
    }
    text.push(b'\'');
    text.extend_from_slice(name);
    text.push(b'\'');
}

fn append_module_path(text: &mut Vec<u8>, names: &ProgramNames, module: ModuleId) {
    let path = names.module_path(module);
    if !path.is_empty() {
        text.extend_from_slice(b" at ");
        text.extend_from_slice(path);
    }
}

fn text_or_template<'a>(text: &'a [u8], template: &'static str) -> &'a [u8] {
    if text.is_empty() {
        template.as_bytes()
    } else {
        text
    }
}

fn origin_of(position: Option<Position>, names: &ProgramNames) -> FileOrigin {
    match position.map(|position| names.module_origin(position.module)) {
        Some(ModuleOrigin::Runtime) => FileOrigin::Runtime,
        Some(ModuleOrigin::Program | ModuleOrigin::Dependency) | None => FileOrigin::NoFile,
    }
}

fn severity_of(severity: DiagnosticSeverity) -> Severity {
    match severity {
        DiagnosticSeverity::Error => Severity::Error,
        DiagnosticSeverity::Warning => Severity::Warning,
        DiagnosticSeverity::Note => Severity::Note,
    }
}
