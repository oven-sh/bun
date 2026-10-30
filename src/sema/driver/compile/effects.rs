use super::{BuildDiagnostic, WithoutBunTypes};
use crate::{Category, Diagnostic, MessageChain};
use bun_sema::atom::Atom;
use bun_sema::check::Requested;
use bun_sema::check::aot::{DiagnosticClass, DiagnosticSubject, Effect, FileOrigin, effect_of};
use bun_sema::import_sites::ImportSpecifier;
use bun_sema::program::{CodeAnswer, FileId, FileRole, Files, Sym};
use bun_sema::resolve::CodeHost;

pub(super) fn compute_origins(
    files: &Files<'_>,
    host: &dyn CodeHost,
    project_origin: FileOrigin,
) -> Vec<FileOrigin> {
    let file_ids = (0..files.modules.len()).map(|index| FileId(index as u32));
    file_ids
        .map(|file| origin_of(files, host, file, project_origin))
        .collect()
}

fn origin_of(
    files: &Files<'_>,
    host: &dyn CodeHost,
    file: FileId,
    project_origin: FileOrigin,
) -> FileOrigin {
    match project_origin {
        FileOrigin::Runtime => return FileOrigin::Runtime,
        FileOrigin::NoFile
        | FileOrigin::ProgramSource
        | FileOrigin::ProgramJavaScript
        | FileOrigin::DependencySource
        | FileOrigin::DependencyJavaScript
        | FileOrigin::Declarations
        | FileOrigin::EvaluatedText => {}
    }
    if files.is_compiled(file) && host.is_evaluated_text(files.module(file).file_name()) {
        return FileOrigin::EvaluatedText;
    }
    let is_dependency = files.module(file).is_from_external_library
        || project_origin == FileOrigin::DependencySource;
    match (files.role(file), is_dependency) {
        (FileRole::TypesOnly, _) => FileOrigin::Declarations,
        (FileRole::Checked, true) => FileOrigin::DependencySource,
        (FileRole::Checked, false) => FileOrigin::ProgramSource,
        (FileRole::Inferred, true) => FileOrigin::DependencyJavaScript,
        (FileRole::Inferred, false) => FileOrigin::ProgramJavaScript,
    }
}

fn has_effect(origin: FileOrigin, class: DiagnosticClass) -> bool {
    [Category::Error, Category::Warning]
        .into_iter()
        .any(|category| match effect_of(origin, class, category) {
            Effect::Dropped => false,
            Effect::StopsBuild | Effect::Warns | Effect::WithdrawsTrust | Effect::InternalError => {
                true
            }
        })
}

fn is_reported_for(role: FileRole, class: DiagnosticClass) -> bool {
    match role {
        FileRole::Inferred => class == DiagnosticClass::EarlyError,
        FileRole::Checked | FileRole::TypesOnly => true,
    }
}

pub(super) fn can_lose_trust(origin: FileOrigin, role: FileRole) -> bool {
    DiagnosticClass::ALL
        .into_iter()
        .filter(|&class| is_reported_for(role, class))
        .any(|class| effect_of(origin, class, Category::Error) == Effect::WithdrawsTrust)
}

pub(super) fn requested_diagnostics(origin: FileOrigin, role: FileRole) -> Requested {
    match (origin, role) {
        (FileOrigin::Runtime, FileRole::Inferred | FileRole::TypesOnly) => return Requested::Types,
        (FileOrigin::Runtime, FileRole::Checked)
        | (
            FileOrigin::NoFile
            | FileOrigin::ProgramSource
            | FileOrigin::ProgramJavaScript
            | FileOrigin::DependencySource
            | FileOrigin::DependencyJavaScript
            | FileOrigin::Declarations
            | FileOrigin::EvaluatedText,
            _,
        ) => {}
    }
    let needs_types = DiagnosticClass::ALL
        .into_iter()
        .filter(|&class| class != DiagnosticClass::EarlyError && is_reported_for(role, class))
        .any(|class| has_effect(origin, class));
    match (needs_types, has_effect(origin, DiagnosticClass::EarlyError)) {
        (true, _) => Requested::All,
        (false, true) => Requested::EarlyErrors,
        (false, false) => Requested::Types,
    }
}

pub(super) struct ProgramOrigins<'a, 's> {
    pub files: Option<&'a Files<'s>>,
    pub origins: &'a [FileOrigin],
    pub project_origin: FileOrigin,
    pub without_bun_types: Option<&'a WithoutBunTypes>,
    pub lacks_installed_bun_types: bool,
}

const UNKNOWN_MODULE_CODES: [u32; 4] = [2307, 2792, 2882, 7016];

const USES_OF_WHAT_HAS_NO_DECLARATION_CODES: [u32; 2] = [2347, 2709];

const UNKNOWN_TYPE_LIBRARY_CODE: u32 = 2688;
const UNUSED_EXPECT_ERROR_CODE: u32 = 2578;

const EXACT_OPTIONAL_PROPERTY_CODES: [u32; 3] = [2375, 2379, 2412];

const UNKNOWN_MEMBER_CODES: [u32; 5] = [2305, 2339, 2551, 2694, 2724];

fn is_about_exact_optional_property(code: u32, chain: &[MessageChain]) -> bool {
    EXACT_OPTIONAL_PROPERTY_CODES.contains(&code)
        || chain
            .iter()
            .any(|link| is_about_exact_optional_property(link.code, &link.message_chain))
}

impl ProgramOrigins<'_, '_> {
    fn origin_of(&self, diagnostic: &Diagnostic) -> FileOrigin {
        match diagnostic.file {
            Some(file) => self.origins[file.idx()],
            None => self.project_origin,
        }
    }

    fn is_for_lack_of_bun_types(&self, origin: FileOrigin, diagnostic: &Diagnostic) -> bool {
        let Some(missing) = self.without_bun_types else {
            return false;
        };
        let code = diagnostic.code;
        if origin != FileOrigin::ProgramSource {
            return false;
        }
        if UNKNOWN_MODULE_CODES.contains(&code) {
            match diagnostic.subject {
                DiagnosticSubject::ModuleSpecifier(specifier) => {
                    self.is_import_that_the_build_loads(diagnostic.file, specifier)
                }
                DiagnosticSubject::None | DiagnosticSubject::MemberContainer(_) => false,
            }
        } else if UNKNOWN_MEMBER_CODES.contains(&code) {
            match diagnostic.subject {
                DiagnosticSubject::MemberContainer(container) => {
                    missing.incomplete_containers.contains(&Some(container))
                        || self.is_declared_for_browsers(container)
                }
                DiagnosticSubject::None | DiagnosticSubject::ModuleSpecifier(_) => false,
            }
        } else if diagnostic.class == DiagnosticClass::Style {
            !missing.has_configuration_file
        } else {
            USES_OF_WHAT_HAS_NO_DECLARATION_CODES.contains(&code)
        }
    }

    fn is_declared_for_browsers(&self, container: Sym) -> bool {
        let Some(files) = self.files else {
            return false;
        };
        let path = files.module(container.file).file_name();
        let name = path.strip_prefix(&files.options.lib_dir[..]);
        name.is_some_and(|name| {
            name.starts_with(b"/lib.dom.") || name.starts_with(b"/lib.webworker.")
        })
    }

    fn is_from_option_the_file_does_not_have(&self, diagnostic: &Diagnostic) -> bool {
        let (Some(files), Some(file)) = (self.files, diagnostic.file) else {
            return false;
        };
        !files.module_options(file).exact_optional_property_types
            && is_about_exact_optional_property(diagnostic.code, &diagnostic.message_chain)
    }

    fn is_import_that_the_build_loads(&self, file: Option<FileId>, specifier: Atom) -> bool {
        let (Some(files), Some(file)) = (self.files, file) else {
            return false;
        };
        let Some(compiled) = files.compiled(file) else {
            return false;
        };
        let sites = compiled
            .analysis
            .import_sites
            .iter()
            .zip(compiled.code_answers);
        sites.into_iter().any(|(site, answer)| {
            site.specifier == ImportSpecifier::Constant(specifier)
                && !matches!(
                    answer,
                    CodeAnswer::Erased | CodeAnswer::Computed(_) | CodeAnswer::NotFound(_)
                )
        })
    }

    pub(super) fn apply_effects(&self, mut diagnostics: Vec<Diagnostic>) -> Vec<BuildDiagnostic> {
        crate::sort_and_deduplicate(&mut diagnostics);
        let with_effects = diagnostics.into_iter().filter_map(|mut diagnostic| {
            let origin = self.origin_of(&diagnostic);
            if diagnostic.class == DiagnosticClass::EarlyError {
                diagnostic.category = Category::Error;
            }
            let is_for_lack_of_bun_types = self.is_for_lack_of_bun_types(origin, &diagnostic);
            let names_missing_type_library =
                self.lacks_installed_bun_types && diagnostic.code == UNKNOWN_TYPE_LIBRARY_CODE;
            let effect = match effect_of(origin, diagnostic.class, diagnostic.category) {
                Effect::Dropped => return None,
                Effect::StopsBuild | Effect::WithdrawsTrust
                    if self.is_from_option_the_file_does_not_have(&diagnostic) =>
                {
                    return None;
                }
                Effect::StopsBuild if diagnostic.code == UNUSED_EXPECT_ERROR_CODE => Effect::Warns,
                Effect::StopsBuild if is_for_lack_of_bun_types => return None,
                Effect::StopsBuild if names_missing_type_library => Effect::Warns,
                Effect::WithdrawsTrust if diagnostic.file.is_none() => Effect::InternalError,
                effect @ (Effect::StopsBuild
                | Effect::Warns
                | Effect::WithdrawsTrust
                | Effect::InternalError) => effect,
            };
            Some(BuildDiagnostic { diagnostic, effect })
        });
        with_effects.collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_sema::bind::SymbolId;
    use bun_sema::program::Sym;

    #[test]
    fn requested_follows_effect_table() {
        use FileOrigin::*;
        let expected = [
            (ProgramSource, FileRole::Checked, Requested::All),
            (
                ProgramJavaScript,
                FileRole::Inferred,
                Requested::EarlyErrors,
            ),
            (DependencySource, FileRole::Checked, Requested::All),
            (DependencySource, FileRole::Inferred, Requested::EarlyErrors),
            (
                DependencyJavaScript,
                FileRole::Inferred,
                Requested::EarlyErrors,
            ),
            (Declarations, FileRole::TypesOnly, Requested::EarlyErrors),
            (Runtime, FileRole::Checked, Requested::All),
            (Runtime, FileRole::Inferred, Requested::Types),
            (EvaluatedText, FileRole::Inferred, Requested::EarlyErrors),
        ];
        for (origin, role, requested) in expected {
            let is_expected = requested_diagnostics(origin, role) == requested;
            assert!(is_expected, "{origin:?} {role:?}");
        }
    }

    #[test]
    fn trust_is_lost_only_to_diagnostics_of_the_role() {
        use FileOrigin::*;
        let expected = [
            (DependencySource, FileRole::Checked, true),
            (DependencySource, FileRole::Inferred, false),
            (EvaluatedText, FileRole::Inferred, true),
            (ProgramSource, FileRole::Checked, false),
            (ProgramJavaScript, FileRole::Inferred, false),
            (Runtime, FileRole::Checked, true),
            (Runtime, FileRole::Inferred, false),
        ];
        for (origin, role, can_lose) in expected {
            assert_eq!(
                can_lose_trust(origin, role),
                can_lose,
                "{origin:?} {role:?}"
            );
        }
    }

    #[test]
    fn dropped_diagnostics_are_not_returned() {
        let origins = ProgramOrigins {
            files: None,
            origins: &[],
            project_origin: FileOrigin::NoFile,
            without_bun_types: None,
            lacks_installed_bun_types: false,
        };
        let error = crate::global(5083, &["a"]);
        let message = Diagnostic {
            category: Category::Message,
            ..crate::global(5083, &["b"])
        };
        let reported = origins.apply_effects(vec![message, error]);
        assert_eq!(reported.len(), 1);
        assert_eq!(reported[0].effect, Effect::StopsBuild);
        assert_eq!(&*reported[0].diagnostic.args[0], b"a");
    }

    #[test]
    fn what_bun_types_would_declare_stops_no_build_without_them() {
        let symbol = |id: u32| Sym {
            file: FileId(1),
            id: SymbolId(id),
        };
        let [bun_module, import_meta, own_type] = [symbol(0), symbol(1), symbol(2)];
        let incomplete_containers = [Some(bun_module), Some(import_meta), None];
        let without_configuration_file = WithoutBunTypes {
            has_configuration_file: false,
            incomplete_containers,
        };
        let with_configuration_file = WithoutBunTypes {
            has_configuration_file: true,
            incomplete_containers,
        };
        let stops_build = |without_bun_types: Option<&WithoutBunTypes>,
                           code: u32,
                           args: &[&str],
                           subject: DiagnosticSubject| {
            let origins = ProgramOrigins {
                files: None,
                origins: &[FileOrigin::ProgramSource],
                project_origin: FileOrigin::NoFile,
                without_bun_types,
                lacks_installed_bun_types: without_bun_types.is_some(),
            };
            let diagnostic = Diagnostic {
                file: Some(FileId(0)),
                class: DiagnosticClass::of_code(code),
                subject,
                ..crate::global(code, args)
            };
            let reported = origins.apply_effects(vec![diagnostic]);
            assert!(
                reported.iter().all(|it| it.effect == Effect::StopsBuild),
                "{code} {args:?}"
            );
            !reported.is_empty()
        };
        use DiagnosticSubject::{MemberContainer, None as NoSubject};
        let cases: [(u32, &[&str], DiagnosticSubject, bool); 14] = [
            (2584, &["document"], NoSubject, true),
            (2304, &["nothing"], NoSubject, true),
            (2307, &["./missing"], NoSubject, true),
            (2339, &["serve", "A"], MemberContainer(bun_module), false),
            (2305, &["A", "serve"], MemberContainer(bun_module), false),
            (2694, &["A", "Server"], MemberContainer(bun_module), false),
            (2339, &["dir", "A"], MemberContainer(import_meta), false),
            (2339, &["member", "Own"], MemberContainer(own_type), true),
            (
                2339,
                &["dir", "ImportMeta"],
                MemberContainer(own_type),
                true,
            ),
            (2339, &["dir", "ImportMeta"], NoSubject, true),
            (2339, &["length", "\"bun\""], NoSubject, true),
            (2347, &[], NoSubject, false),
            (2709, &["EventEmitter"], NoSubject, false),
            (2322, &["string", "number"], NoSubject, true),
        ];
        for (code, args, subject, still_stops) in cases {
            for missing in [&without_configuration_file, &with_configuration_file] {
                assert_eq!(
                    stops_build(Some(missing), code, args, subject),
                    still_stops,
                    "{code} {args:?}"
                );
            }
            assert!(stops_build(None, code, args, subject), "{code} {args:?}");
        }
        let implicit_any: (u32, &[&str]) = (7006, &["request", "any"]);
        assert!(!stops_build(
            Some(&without_configuration_file),
            implicit_any.0,
            implicit_any.1,
            NoSubject
        ));
        assert!(stops_build(
            Some(&with_configuration_file),
            implicit_any.0,
            implicit_any.1,
            NoSubject
        ));
    }

    #[test]
    fn configuration_error_of_runtime_project_is_internal() {
        let origins = ProgramOrigins {
            files: None,
            origins: &[],
            project_origin: FileOrigin::Runtime,
            without_bun_types: None,
            lacks_installed_bun_types: false,
        };
        let reported = origins.apply_effects(vec![crate::global(5083, &["a"])]);
        assert_eq!(reported[0].effect, Effect::InternalError);
    }
}
