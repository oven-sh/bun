use bun_ast::Kind;
use bun_core::fmt::QuotedFormatter;
use bun_sema::atom::Interner;
use bun_sema::check::aot::{DiagnosticClass, Effect};
use bun_sema::fold::{FoldError, FoldErrorKind};
use bun_sema::hir::{self, DiagnosticKind, File, StmtKind};
use bun_sema::messages::{self, Category};
use bun_sema::module_format::CommonJsEvidence;
use bun_sema::node::NodeData;
use bun_sema::program::FileId;
use bun_sema::resolve::CodeFailure;
use bun_sema_driver::host::to_native;
use bun_sema_driver::{BuildDiagnostic, EntryPointFailure, Incomplete, LoadFailure, log_message};

use super::sink::{append_location, to_log_message};
use super::{
    Diagnostic, Diagnostics, ProgramView, Severity, Span, SpanLocator, new_driver_diagnostic,
};
use crate::builtins::table;
use crate::diagnostic_codes::Code;
use crate::emit::EmitError;
use crate::link::LinkError;
use crate::load::sources::parsed_source;
use crate::modules::{FailureEffect, ModuleFailureKind, ModuleGraph, ModuleRef};
use crate::statistics::{LimitValues, Stage};

impl Diagnostics {
    pub(crate) fn add_load_failure(&mut self, failure: LoadFailure, entry_points: &[Vec<u8>]) {
        for &(index, reason) in &failure.unresolved_entry_points {
            let code = match reason {
                EntryPointFailure::NotFound(_) => Code::EntryPointNotFound,
                EntryPointFailure::BuiltinModule => Code::EntryPointIsBuiltinModule,
                EntryPointFailure::External => Code::EntryPointIsExternal,
            };
            let entry_point = entry_points[index].as_slice();
            self.add(None, Diagnostic::new(code, None, &[entry_point]));
        }
        self.add_build_diagnostics(Stage::Load, failure.diagnostics);
    }

    pub(crate) fn add_build_diagnostics(
        &mut self,
        stage: Stage,
        diagnostics: Vec<BuildDiagnostic>,
    ) {
        for BuildDiagnostic { diagnostic, effect } in diagnostics {
            let kind = match effect {
                Effect::StopsBuild => Kind::Err,
                Effect::Warns => Kind::Warn,
                Effect::WithdrawsTrust => {
                    debug_assert!(false, "report_package_errors groups these by package");
                    continue;
                }
                Effect::Dropped => {
                    debug_assert!(false, "the driver returns no dropped diagnostic");
                    continue;
                }
                Effect::InternalError => {
                    let mut message = format!("TS{}: ", diagnostic.code).into_bytes();
                    message.extend_from_slice(&diagnostic.text);
                    if !diagnostic.path.is_empty() {
                        let path = to_native(&diagnostic.path);
                        append_location(&mut message, path, diagnostic.line, diagnostic.column);
                    }
                    self.report_internal_error(stage, message);
                    continue;
                }
            };
            let mut message =
                log_message(&diagnostic).expect("the driver drops suggestions and messages");
            message.kind = kind;
            self.add_message(diagnostic.code, message);
        }
    }

    pub(crate) fn add_fold_errors(&mut self, view: ProgramView<'_, '_>, file: FileId) {
        let files = view.files();
        let hir = files.hir(file);
        let mut locator = SpanLocator::new(view);
        for error in files.analysis(file).errors {
            let diagnostic = fold_error_diagnostic(hir, &files.atoms, file, error);
            self.add_with_locator(Some(&mut locator), diagnostic);
        }
    }

    pub(crate) fn add_module_failures(&mut self, view: ProgramView<'_, '_>, modules: &ModuleGraph) {
        let atoms = &view.files().atoms;
        let mut locator = SpanLocator::new(view);
        let mut files_with_syntax_errors = Vec::new();
        for failure in modules.errors().iter().chain(modules.failures()) {
            // The build stops here, before the check that reports syntax errors. A file that does not parse exports
            // little, so its syntax errors say why the name is missing.
            if let ModuleFailureKind::ExportNotFound { exporter, .. } = failure.kind
                && let ModuleRef::File(exporter) = exporter
                && failure.effect() == FailureEffect::StopsBuild
                && syntax_errors_of(view.files().hir(exporter))
                    .next()
                    .is_some()
            {
                if !files_with_syntax_errors.contains(&exporter) {
                    files_with_syntax_errors.push(exporter);
                    self.add_syntax_errors(&mut locator, exporter);
                }
                continue;
            }
            let span = Some(Span {
                file: failure.importer,
                start: failure.start,
                end: failure.end,
            });
            let mut diagnostic = match failure.kind {
                ModuleFailureKind::Unresolved { specifier, reason }
                | ModuleFailureKind::UnresolvedAtLoad { specifier, reason } => {
                    Diagnostic::new(code_of_failure(reason), span, &[atoms.bytes(specifier)])
                }
                ModuleFailureKind::NotAProgram { .. } => {
                    let source = parsed_source(view.files(), failure.importer);
                    let reason = source.and_then(|source| source.parse_failure.as_deref());
                    let path = module_name(view, ModuleRef::File(failure.importer));
                    let arguments = [path, reason.unwrap_or_default()];
                    Diagnostic::new(Code::FileIsNotAProgram, None, &arguments)
                }
                ModuleFailureKind::ExportNotFound { exporter, name } => Diagnostic::new(
                    Code::ExportNotFound,
                    span,
                    &[module_name(view, exporter), atoms.bytes(name)],
                ),
                ModuleFailureKind::ExportAmbiguous { name, .. } => {
                    Diagnostic::new(Code::AmbiguousExport, span, &[atoms.bytes(name)])
                }
                // Nothing is known to be wrong: the run that ends without the name throws.
                ModuleFailureKind::ExportMayBeAbsent { .. } => continue,
            };
            diagnostic.severity = match failure.effect() {
                FailureEffect::StopsBuild => Severity::Error,
                FailureEffect::ThrowsAtSite => Severity::Warning,
            };
            self.add_with_locator(Some(&mut locator), diagnostic);
        }
    }

    fn add_syntax_errors(&mut self, locator: &mut SpanLocator<'_, '_>, file: FileId) {
        let view = locator.view();
        for error in syntax_errors_of(view.files().hir(file)) {
            let mut text = Vec::new();
            if let Some((_, template)) = messages::message(error.code) {
                messages::format(&mut text, template, &error.args);
            }
            let reported = new_driver_diagnostic(error.code, Category::Error, text, &[]);
            let end = match error.end {
                0 | hir::Diagnostic::NO_LENGTH => error.start,
                end => end,
            };
            let start = error.start;
            let located = locator.locate(Span { file, start, end }, reported);
            self.add_message(error.code, to_log_message(&located, Severity::Error));
        }
    }

    pub(crate) fn add_incomplete_files(&mut self, incomplete: &[Incomplete]) {
        for file in incomplete {
            let path = to_native(&file.path);
            if file.is_nested_too_deeply {
                let diagnostic = Diagnostic::new(Code::FileNestedTooDeeply, None, &[path]);
                self.add(None, diagnostic);
            } else {
                self.report_internal_error(Stage::Check, file.message(path));
            }
        }
    }

    pub(crate) fn add_link_errors(
        &mut self,
        errors: Vec<LinkError>,
        limits: &LimitValues,
        describe: &dyn Fn(&LinkError) -> Vec<u8>,
    ) {
        for error in errors {
            match error {
                LinkError::LimitExceeded { limit, count } => {
                    let (maximum, count) = (limits.get(limit).to_string(), count.to_string());
                    let arguments = [
                        limit.purpose().as_bytes(),
                        maximum.as_bytes(),
                        count.as_bytes(),
                    ];
                    let code = Code::ProgramLimitExceeded;
                    self.add(None, Diagnostic::new(code, None, &arguments));
                }
                _ => {
                    self.report_internal_error(Stage::LinkAndEmit, describe(&error));
                }
            }
        }
    }

    pub(crate) fn add_emit_error(&mut self, error: EmitError) {
        match error {
            EmitError::ProgramTooLarge { bytes } => {
                let bytes = bytes.to_string();
                let diagnostic = Diagnostic::new(Code::ProgramTooLarge, None, &[bytes.as_bytes()]);
                self.add(None, diagnostic);
            }
        }
    }
}

pub(crate) fn code_of_failure(failure: CodeFailure) -> Code {
    match failure {
        CodeFailure::ModuleNotFound => Code::ModuleNotFound,
        CodeFailure::PackageNotFound => Code::PackageNotFound,
        CodeFailure::BuiltinModuleNotFound => Code::BuiltinModuleNotFound,
        CodeFailure::PackagePathNotExported => Code::PackagePathNotExported,
        CodeFailure::PackageImportNotDefined => Code::PackageImportNotDefined,
        CodeFailure::InvalidModuleSpecifier => Code::InvalidModuleSpecifier,
        CodeFailure::InvalidPackageTarget => Code::InvalidPackageTarget,
        CodeFailure::InvalidPackageConfiguration => Code::InvalidPackageConfiguration,
        CodeFailure::UnsupportedDirectoryImport => Code::UnsupportedDirectoryImport,
        CodeFailure::QueryString => Code::QueryStringInSpecifier,
    }
}

fn syntax_errors_of<'a>(hir: &'a File<'_>) -> impl Iterator<Item = &'a hir::Diagnostic> {
    (hir.diagnostics.iter())
        .filter(|it| it.kind == DiagnosticKind::Parse && it.class == DiagnosticClass::EarlyError)
}

pub(super) fn fold_error_diagnostic(
    hir: &File<'_>,
    atoms: &Interner<'_>,
    file: FileId,
    error: &FoldError,
) -> Diagnostic {
    let span = Some(Span::of_node(hir, file, error.node));
    match error.kind {
        FoldErrorKind::FeatureArgumentCount => {
            Diagnostic::new(Code::FeatureArgumentCount, span, &[])
        }
        FoldErrorKind::FeatureArgumentNotString => {
            Diagnostic::new(Code::FeatureArgumentNotString, span, &[])
        }
        FoldErrorKind::FeatureFlagNotAscii => Diagnostic::new(Code::FeatureFlagNotAscii, span, &[]),
        FoldErrorKind::FeatureOutsideCondition => {
            Diagnostic::new(Code::FeatureOutsideCondition, span, &[])
        }
        FoldErrorKind::FeatureImportedTwice => {
            Diagnostic::new(Code::FeatureImportedTwice, span, &[])
        }
        FoldErrorKind::UnknownBundleExport(name) => {
            Diagnostic::new(Code::UnknownBundleExport, span, &[atoms.bytes(name)])
        }
        FoldErrorKind::ImportStatementInCommonJs(evidence) => {
            let specifier = quoted_import_specifier(hir, atoms, error.node);
            Diagnostic {
                related: commonjs_notes(span, &specifier, evidence),
                ..Diagnostic::new(Code::ImportStatementInCommonJs, span, &[])
            }
        }
        FoldErrorKind::MacroInExportStar => Diagnostic::new(Code::MacroInExportStar, span, &[]),
        FoldErrorKind::MacroInExportFrom => Diagnostic::new(Code::MacroInExportFrom, span, &[]),
    }
}

fn quoted_import_specifier(hir: &File<'_>, atoms: &Interner<'_>, node: NodeData) -> Vec<u8> {
    if let NodeData::Stmt(statement) = node
        && let StmtKind::Import(import) = hir[statement].kind
    {
        let text = atoms.bytes(hir[import].spec);
        return QuotedFormatter { text }.to_string().into_bytes();
    }
    b"\"..\"".to_vec()
}

fn commonjs_notes(
    span: Option<Span>,
    quoted_specifier: &[u8],
    evidence: CommonJsEvidence,
) -> Vec<Diagnostic> {
    let reasons: [(CommonJsEvidence, Code, &[&[u8]]); 3] = [
        (
            CommonJsEvidence::MODULE,
            Code::CommonJsBecauseModule,
            &[b"module"],
        ),
        (
            CommonJsEvidence::EXPORTS,
            Code::CommonJsBecauseExports,
            &[b"exports"],
        ),
        (
            CommonJsEvidence::WITH_STATEMENT,
            Code::CommonJsBecauseWith,
            &[],
        ),
    ];
    let suggestion = Diagnostic::new(Code::TryRequireInstead, span, &[quoted_specifier]);
    let mut notes = vec![suggestion];
    for (bit, code, arguments) in reasons {
        if evidence.contains(bit) {
            notes.push(Diagnostic::new(code, span, arguments));
        }
    }
    notes
}

fn module_name<'a>(view: ProgramView<'a, '_>, module: ModuleRef) -> &'a [u8] {
    match module {
        ModuleRef::File(file)
        | ModuleRef::Inner { file, .. }
        | ModuleRef::Face(file)
        | ModuleRef::Check(file) => view.sources.module_paths(file).display_path,
        ModuleRef::Runtime(module) => table::specifier_of(module),
        ModuleRef::External { specifier, .. } => view.files().atoms.bytes(specifier),
    }
}
