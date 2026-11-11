use bun_core::strings;
use bun_sema::check::aot::{Effect, FileOrigin, effect_of};

use super::int32_flows::write_int32_message;
use super::sink::{append_location, to_driver_diagnostic, to_log_message};
use super::{COMPILER_DIAGNOSTIC_CLASS, Diagnostic, Diagnostics, Severity, new_driver_diagnostic};
use crate::diagnostic_codes::Code;
use crate::engine::{
    EngineResult, InternalErrorRecord, Position, UserDiagnosticRecord, position_of,
};
use crate::ir::ModuleId;
use crate::ir::generated::{DiagnosticSeverity, UserDiagnosticKind, Witness};
use crate::report::{ModuleLocator, ModuleOrigin, SourceTexts};

fn is_about_load_by_unknown_name(record: &UserDiagnosticRecord) -> bool {
    matches!(
        record.kind,
        UserDiagnosticKind::NonConstantImportPath
            | UserDiagnosticKind::NonConstantModuleName
            | UserDiagnosticKind::RequirePassedToUnseenCode
    )
}

pub(super) fn package_name_in(path: &[u8]) -> Option<&[u8]> {
    const FOLDER: &[u8] = b"node_modules/";
    let name = &path[strings::last_index_of(path, FOLDER)? + FOLDER.len()..];
    let parts = if name.starts_with(b"@") { 2 } else { 1 };
    let mut slashes = (0..name.len()).filter(|&index| name[index] == b'/');
    Some(&name[..slashes.nth(parts - 1)?])
}

pub(crate) fn package_with_slow_code<'t>(
    record: &UserDiagnosticRecord,
    texts: &'t SourceTexts,
) -> Option<&'t [u8]> {
    if record.kind != UserDiagnosticKind::RegExpPatternNotConstant {
        return None;
    }
    let module = position_of(record.location)?.module;
    match texts.origin(module) {
        ModuleOrigin::Dependency => package_name_in(texts.path(module)),
        ModuleOrigin::Program | ModuleOrigin::Runtime => None,
    }
}

impl Diagnostics {
    pub(crate) fn add_engine_records(
        &mut self,
        result: &EngineResult,
        texts: &SourceTexts,
        runs_tests: bool,
        lists_slow_code_in_packages: bool,
    ) {
        let mut locator = ModuleLocator::new(texts);
        for record in result
            .user_diagnostics()
            .iter()
            .filter(|record| !(runs_tests && is_about_load_by_unknown_name(record)))
            .filter(|record| {
                lists_slow_code_in_packages || package_with_slow_code(record, texts).is_none()
            })
        {
            self.add_user_diagnostic(record, result.text(record.message), texts, &mut locator);
        }
        for record in result.internal_errors() {
            self.add_internal_error_record(record, result.text(record.message), &mut locator);
        }
    }

    pub(crate) fn add_at_witness(
        &mut self,
        code: Code,
        arguments: &[&[u8]],
        witness: &Witness,
        texts: &SourceTexts,
    ) {
        let diagnostic = Diagnostic::new(code, None, arguments);
        let reported = to_driver_diagnostic(None, &diagnostic);
        let reported = match position_of(witness.location) {
            Some(position) => ModuleLocator::new(texts).locate(position, reported),
            None => reported,
        };
        self.add_message(
            code.number(),
            to_log_message(&reported, diagnostic.severity),
        );
    }

    pub(crate) fn add_worker_start_without_name(&mut self, witness: &Witness, texts: &SourceTexts) {
        if witness.function_id().is_some() {
            self.add_at_witness(Code::WorkerStartedFromUnknownValue, &[], witness, texts);
        }
    }

    pub(super) fn add_internal_error_record(
        &mut self,
        record: &InternalErrorRecord,
        text: &[u8],
        locator: &mut ModuleLocator<'_>,
    ) {
        let message = internal_error_text(record, text, locator);
        let stage = record.kind.stage();
        self.report_internal_error(stage, message);
    }

    pub(super) fn add_user_diagnostic(
        &mut self,
        record: &UserDiagnosticRecord,
        text: &[u8],
        texts: &SourceTexts,
        locator: &mut ModuleLocator<'_>,
    ) {
        let kind = record.kind;
        let severity = severity_of(kind.severity());
        let position = position_of(record.location);
        let flow = position.and_then(|position| {
            let path = texts.path(position.module).to_vec();
            self.int32_flows.get(&(path, position.offset))
        });
        let written = write_int32_message(record, flow);
        let text = match &written {
            Some((written, _)) => written.as_slice(),
            None => text_or_template(text, kind.message()),
        };
        let position = match (position, &written) {
            (Some(position), &Some((_, Some(offset)))) => Some(Position { offset, ..position }),
            (position, _) => position,
        };
        let origin = origin_of(position, texts);
        match effect_of(origin, COMPILER_DIAGNOSTIC_CLASS, severity.category()) {
            Effect::Dropped => return,
            Effect::InternalError => {
                let mut message = text.to_vec();
                if let Some(position) = position {
                    append_module_path(&mut message, texts, position.module);
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
    locator: &mut ModuleLocator<'_>,
) -> Vec<u8> {
    let mut message = record.kind.name().as_bytes().to_vec();
    message.extend_from_slice(b": ");
    message.extend_from_slice(text_or_template(text, record.kind.message()));
    let position = position_of(record.location).and_then(|position| locator.position_of(position));
    if let Some(position) = position {
        append_location(&mut message, &position.path, position.line, position.column);
    }
    message
}

fn append_module_path(text: &mut Vec<u8>, texts: &SourceTexts, module: ModuleId) {
    let path = texts.path(module);
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

fn origin_of(position: Option<Position>, texts: &SourceTexts) -> FileOrigin {
    match position.map(|position| texts.origin(position.module)) {
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
